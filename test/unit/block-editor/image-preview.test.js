import { expect } from '@esm-bundle/chai';
import { createImagePreviews } from '../../../tools/block-editor/image-preview.js';

describe('block editor authenticated image previews', () => {
  const source = 'https://content.da.live/org/site/.page/photo.jpg?width=200#image';
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  let sdk;
  let calls;
  let updates;
  let managers;
  let updateWaiters;
  const imageBytes = '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>';
  const imageResponse = () => new Response(new Blob([imageBytes], { type: 'image/svg+xml' }));

  beforeEach(() => {
    calls = [];
    updates = [];
    managers = [];
    updateWaiters = [];
    sdk = {
      token: 'test-token',
      context: { org: 'org', site: 'site', ref: 'plugin-dev', branch: 'feature' },
      actions: {
        daFetch: async (url, options) => {
          calls.push({ url, options });
          return imageResponse();
        },
      },
    };
  });

  afterEach(() => managers.forEach((manager) => manager.dispose()));

  const previews = () => {
    const manager = createImagePreviews(sdk, {
      onChange: (error) => {
        updates.push(error);
        updateWaiters.forEach(({ count, resolve }) => { if (updates.length >= count) resolve(); });
      },
    });
    managers.push(manager);
    return manager;
  };
  const waitForUpdates = (count) => new Promise((resolve) => {
    if (updates.length >= count) resolve();
    else updateWaiters.push({ count, resolve });
  });

  it('downloads image bytes with authentication but without cookies', async () => {
    const manager = previews();
    expect(manager.get(source)).to.equal(undefined);
    await waitForUpdates(1);
    expect(calls).to.have.length(1);
    expect(calls[0].url).to.equal('https://content.da.live/org/site/.page/photo.jpg?width=200');
    expect(calls[0].options.credentials).to.equal('omit');
    expect(calls[0].options.headers).to.deep.equal({ Authorization: 'Bearer test-token' });
    expect(calls[0].options.noRedirect).to.equal(true);
    expect(calls[0].options.signal).to.be.instanceOf(AbortSignal);
    const blobUrl = manager.get(source);
    expect(blobUrl).to.match(/^blob:/);
    expect(blobUrl.endsWith('#image')).to.equal(true);
    const image = new Image();
    image.src = blobUrl;
    await image.decode();
    expect(image.naturalWidth).to.equal(2);
    expect(image.naturalHeight).to.equal(2);
    expect(updates).to.deep.equal([undefined]);
  });

  it('shares pending and completed downloads for the same image', async () => {
    let finish;
    sdk.actions.daFetch = (url) => {
      calls.push(url);
      return new Promise((resolve) => { finish = resolve; });
    };
    const manager = previews();
    manager.get(source);
    expect(manager.get(source.replace('#image', '#other'))).to.equal(undefined);
    await flush();
    expect(calls).to.have.length(1);
    expect(manager.get(source)).to.equal(undefined);
    finish(imageResponse());
    await waitForUpdates(1);
    expect(manager.get(source)).to.match(/^blob:/);
    expect(manager.get(source.replace('#image', '#other'))).to.equal(manager.get(source).replace('#image', '#other'));
    expect(calls).to.have.length(1);
  });

  it('downloads separate images and supports stage-content without rewriting their origins', async () => {
    const manager = previews();
    manager.get(source);
    const stage = 'https://stage-content.da.live/org/site/stage.png';
    manager.get(stage);
    await waitForUpdates(2);
    expect(calls[1].url).to.equal(stage);
    expect(manager.get(source)).to.match(/^blob:/);
    expect(manager.get(stage)).to.match(/^blob:/);
    expect(manager.get(stage)).not.to.equal(manager.get(source));
    expect(calls).to.have.length(2);
  });

  it('leaves unrelated and relative URLs untouched without sending authentication', async () => {
    const manager = previews();
    for (const src of [
      '/media.png', './media_123.png', 'https://example.com/image.png',
      'https://content.da.live.example.com/org/site/image.png',
      'https://main--site--org.preview.da.live/image.png',
    ]) expect(manager.get(src)).to.equal(src);
    await flush();
    expect(calls).to.have.length(0);
  });

  it('surfaces download failures without falling back to a cookie-dependent image URL', async () => {
    sdk.actions.daFetch = async () => new Response('', { status: 403 });
    const manager = previews();
    manager.get(source);
    await flush();
    expect(updates[0]).to.include('Image download failed: 403');
    expect(manager.get(source)).to.equal(undefined);
    await flush();
    expect(updates).to.have.length(1);
  });

  it('surfaces missing tokens and network failures', async () => {
    sdk.token = '';
    let manager = previews();
    manager.get(source);
    await flush();
    expect(updates[0]).to.include('did not supply an authentication token');
    expect(calls).to.have.length(0);
    sdk.token = 'test-token';
    sdk.actions.daFetch = async () => { throw new Error('Network error'); };
    manager = previews();
    manager.get(source);
    await flush();
    expect(updates[1]).to.include('Network error');
    expect(manager.get(source)).to.equal(undefined);
  });

  it('rejects successful responses that are empty or are not images', async () => {
    for (const response of [
      new Response('', { headers: { 'Content-Type': 'image/jpeg' } }),
      new Response('<html>Sign in</html>', { headers: { 'Content-Type': 'text/html' } }),
    ]) {
      sdk.actions.daFetch = async () => response;
      const manager = previews();
      manager.get(source);
      await flush();
      expect(updates[updates.length - 1]).to.include('empty or did not contain an image');
      expect(manager.get(source)).to.equal(undefined);
    }
  });

  it('revokes downloaded blob URLs and aborts requests when disposed', async () => {
    const manager = previews();
    manager.get(source);
    await waitForUpdates(1);
    const blobUrl = manager.get(source);
    const revoke = URL.revokeObjectURL;
    const revoked = [];
    URL.revokeObjectURL = (url) => { revoked.push(url); revoke.call(URL, url); };
    try {
      manager.dispose();
      manager.dispose();
      expect(revoked).to.deep.equal([blobUrl.split('#')[0]]);
      expect(calls[0].options.signal.aborted).to.equal(true);
      expect(manager.get(source)).to.equal(undefined);
    } finally {
      URL.revokeObjectURL = revoke;
    }
  });

  it('does not create blob URLs or notify after disposal during a download', async () => {
    let finish;
    sdk.actions.daFetch = () => new Promise((resolve) => { finish = resolve; });
    const manager = previews();
    manager.get(source);
    await flush();
    manager.dispose();
    finish(imageResponse());
    await flush();
    expect(updates).to.have.length(0);
    expect(manager.get(source)).to.equal(undefined);
  });

  it('does not begin downloads after immediate disposal', async () => {
    const manager = previews();
    manager.get(source);
    manager.dispose();
    await flush();
    expect(calls).to.have.length(0);
    expect(updates).to.have.length(0);
  });
});
