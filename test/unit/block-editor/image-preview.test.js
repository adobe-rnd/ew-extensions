import { expect } from '@esm-bundle/chai';
import { createImagePreviews } from '../../../tools/block-editor/image-preview.js';

describe('block editor authenticated image previews', () => {
  const source = 'https://content.da.live/org/site/.page/photo.jpg?width=200#image';
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  let sdk;
  let calls;
  let updates;

  beforeEach(() => {
    calls = [];
    updates = [];
    sdk = {
      token: 'test-token',
      context: { org: 'org', site: 'site', ref: 'plugin-dev', branch: 'feature' },
      actions: {
        daFetch: async (url, options) => {
          calls.push({ url, options });
          return new Response('');
        },
      },
    };
  });

  const previews = (admin = 'https://admin.da.live') => createImagePreviews(sdk, {
    admin, onChange: (error) => updates.push(error),
  });

  it('waits for the authenticated cookie before returning a rewritten image URL', async () => {
    const getPreview = previews();
    expect(getPreview(source)).to.equal(undefined);
    await flush();
    expect(calls).to.have.length(1);
    expect(calls[0]).to.deep.equal({
      url: 'https://feature--site--org.preview.da.live/gimme_cookie',
      options: {
        credentials: 'include',
        headers: { Authorization: 'Bearer test-token' },
        noRedirect: true,
      },
    });
    expect(getPreview(source))
      .to.equal('https://feature--site--org.preview.da.live/.page/photo.jpg?width=200#image');
    expect(updates).to.deep.equal([undefined]);
  });

  it('shares pending and completed cookie requests across images on the same origin', async () => {
    let finish;
    sdk.actions.daFetch = (url) => {
      calls.push(url);
      return new Promise((resolve) => { finish = resolve; });
    };
    const getPreview = previews();
    getPreview(source);
    expect(getPreview('https://content.da.live/org/site/other.png')).to.equal(undefined);
    await flush();
    expect(calls).to.have.length(1);
    expect(getPreview(source)).to.equal(undefined);
    finish(new Response(''));
    await flush();
    expect(getPreview('https://content.da.live/org/site/other.png'))
      .to.equal('https://feature--site--org.preview.da.live/other.png');
    expect(calls).to.have.length(1);
  });

  it('matches the selected admin environment and supports stage-content images', async () => {
    const getPreview = previews('https://stage-admin.da.live');
    getPreview(source);
    getPreview('https://stage-content.da.live/org/site/stage.png');
    await flush();
    expect(calls[0].url).to.equal('https://feature--site--org.stage-preview.da.live/gimme_cookie');
    expect(getPreview(source)).to.include('.stage-preview.da.live/.page/photo.jpg');
    expect(getPreview('https://stage-content.da.live/org/site/stage.png'))
      .to.equal('https://feature--site--org.stage-preview.da.live/stage.png');
    expect(calls).to.have.length(1);
  });

  it('uses main for local refs and uses each content image own organization and site', async () => {
    sdk.context = { ref: 'local' };
    const getPreview = previews();
    getPreview(source);
    getPreview('https://content.da.live/other-org/other-site/image.png');
    await flush();
    expect(calls.map(({ url }) => url)).to.deep.equal([
      'https://main--site--org.preview.da.live/gimme_cookie',
      'https://main--other-site--other-org.preview.da.live/gimme_cookie',
    ]);
  });

  it('leaves unrelated and relative URLs untouched without sending authentication', async () => {
    const getPreview = previews();
    for (const src of [
      '/media.png', './media_123.png', 'https://example.com/image.png',
      'https://content.da.live.example.com/org/site/image.png',
      'https://main--site--org.preview.da.live/image.png',
    ]) expect(getPreview(src)).to.equal(src);
    await flush();
    expect(calls).to.have.length(0);
  });

  it('surfaces cookie failures without exposing the image or falling back to content URLs', async () => {
    sdk.actions.daFetch = async () => new Response('', { status: 403 });
    const getPreview = previews();
    getPreview(source);
    await flush();
    expect(updates[0]).to.include('Preview cookie request failed: 403');
    expect(getPreview(source)).to.equal(undefined);
    await flush();
    expect(updates).to.have.length(1);
  });

  it('surfaces missing tokens and network failures', async () => {
    sdk.token = '';
    let getPreview = previews();
    getPreview(source);
    await flush();
    expect(updates[0]).to.include('did not supply an authentication token');
    expect(calls).to.have.length(0);
    sdk.token = 'test-token';
    sdk.actions.daFetch = async () => { throw new Error('Network error'); };
    getPreview = previews();
    getPreview(source);
    await flush();
    expect(updates[1]).to.include('Network error');
    expect(getPreview(source)).to.equal(undefined);
  });
});
