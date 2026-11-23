import { expect } from '@esm-bundle/chai';
import { ProposalReview } from '../../../tools/proposal-review/api.js';

const ROOT = '/org/site/.da/proposals';
const DRAFT = `${ROOT}/campaigns/demo.html`;
const ORIGINAL = '/org/site/campaigns/demo.html';

function server() {
  const files = new Map([[DRAFT, '<h1>Proposed</h1>'], [ORIGINAL, '<h1>Current</h1>']]);
  const listings = new Map([
    [ROOT, [{ path: `${ROOT}/campaigns`, name: 'campaigns' }, { path: `${ROOT}/skills.md`, ext: 'md' }]],
    [`${ROOT}/campaigns`, [{ path: DRAFT, ext: 'html', name: 'demo' }]],
  ]);
  const calls = [];
  const state = {
    files, listings, calls, failSave: 0, failDelete: 0, keepDraft: false, noEtag: false,
  };
  state.daFetch = async (url, options = {}) => {
    const { pathname } = new URL(url);
    const method = options.method || 'GET';
    calls.push({ path: pathname, method, options });
    if (pathname.startsWith('/list')) {
      const listing = listings.get(pathname.slice(5));
      if (listing instanceof Response) return listing;
      return new Response(JSON.stringify(listing || []));
    }
    const path = pathname.slice('/source'.length);
    if (method === 'PUT') {
      if (state.failSave) return new Response(null, { status: state.failSave });
      files.set(path, await options.body.get('data').text());
      state.afterSave?.();
      return new Response(null, { status: 201 });
    }
    if (method === 'DELETE') {
      if (state.failDelete) return new Response(null, { status: state.failDelete });
      if (!state.keepDraft) files.delete(path);
      return new Response(null, { status: 204 });
    }
    return files.has(path)
      ? new Response(files.get(path), { headers: state.noEtag ? {} : { etag: '"revision-1"' } })
      : new Response(null, { status: 404 });
  };
  state.review = new ProposalReview({ org: 'org', site: 'site', daFetch: state.daFetch });
  return state;
}

async function failure(operation, message) {
  let error;
  try { await operation(); } catch (caught) { error = caught; }
  expect(error, 'expected operation to reject').to.be.instanceOf(Error);
  expect(error.message).to.include(message);
}

describe('Proposal review API', () => {
  it('lists staged HTML recursively, following pagination without listing unrelated files', async () => {
    const state = server();
    state.files.set(`${ROOT}/index.html`, '<h1>Home</h1>');
    const fetchImpl = state.review.fetch;
    state.review.fetch = async (url, options) => {
      if (url.endsWith(`/list${ROOT}`)) {
        if (options.headers['da-continuation-token'] === 'next') {
          return new Response(JSON.stringify([
            { path: `${ROOT}/campaigns`, name: 'campaigns' },
            { path: `${ROOT}/skills.md`, ext: 'md' },
          ]));
        }
        return new Response(JSON.stringify([
          { path: `${ROOT}/index.html`, ext: 'html' },
          { path: `${ROOT}/../outside.html`, ext: 'html' },
          { path: '/other/site/.da/proposals/secret.html', ext: 'html' },
          { path: '/org/site/.da/legacy.html', ext: 'html' },
          { path: '/org/site/.da/skills/page.html', ext: 'html' },
          { path: '/org/site/.da/proposals-other/page.html', ext: 'html' },
          { path: `${ROOT}/%2e%2e`, name: 'escape' },
          { path: `${ROOT}/.da-versions`, name: '.da-versions' },
        ]), { headers: { 'da-continuation-token': 'next' } });
      }
      return fetchImpl(url, options);
    };
    expect(await state.review.list()).to.deep.equal([DRAFT, `${ROOT}/index.html`]);
    expect(state.calls.every(({ options }) => options.cache === 'no-store')).to.equal(true);
    expect(state.calls.some(({ path }) => path.includes('skills'))).to.equal(false);
  });

  it('does not silently truncate repeated pagination tokens', async () => {
    const { review } = server();
    review.fetch = async () => new Response('[]', { headers: { 'da-continuation-token': 'same' } });
    await failure(() => review.list(), 'repeated a page token');
  });

  it('only discovers page proposals and leaves legacy and other staged content untouched', async () => {
    const state = server();
    const outside = ['/org/site/.da/legacy.html', '/org/site/.da/skills/page.html'];
    outside.forEach((path) => state.files.set(path, '<h1>Unrelated draft</h1>'));
    state.listings.set('/org/site/.da', [
      { path: ROOT, name: 'proposals' },
      ...outside.map((path) => ({ path, ext: 'html' })),
    ]);
    expect(await state.review.list()).to.deep.equal([DRAFT]);
    expect(state.calls.filter(({ path }) => path.startsWith('/list'))
      .every(({ path }) => path.startsWith(`/list${ROOT}`))).to.equal(true);
    await state.review.mutate(DRAFT, true);
    outside.forEach((path) => expect(state.files.get(path)).to.equal('<h1>Unrelated draft</h1>'));
    expect(state.files.get(ORIGINAL)).to.equal('<h1>Proposed</h1>');
  });

  it('skips missing or inaccessible folders without exposing other content', async () => {
    const state = server();
    state.listings.set(`${ROOT}/campaigns`, new Response(null, { status: 403 }));
    expect(await state.review.list()).to.deep.equal([]);
    state.listings.set(ROOT, new Response(null, { status: 404 }));
    expect(await state.review.list()).to.deep.equal([]);
  });

  it('checks individual read access because a listing can include restricted children', async () => {
    const state = server();
    const fetchImpl = state.review.fetch;
    state.review.fetch = async (url, options) => {
      if (options?.method === 'HEAD') return new Response(null, { status: 403 });
      return fetchImpl(url, options);
    };
    expect(await state.review.list()).to.deep.equal([]);
  });

  it('reports listing failures instead of claiming there are no drafts', async () => {
    const state = server();
    state.listings.set(ROOT, new Response(null, { status: 500 }));
    await failure(() => state.review.list(), 'Could not list');
    state.listings.set(ROOT, new Response(null, { status: 401 }));
    await failure(() => state.review.list(), '401');
  });

  it('rejects unsafe paths, non-HTML files, and other sites before any request', async () => {
    const { review, calls } = server();
    const paths = [
      '/other/site/.da/proposals/demo.html', `${ROOT}/../demo.html`, `${ROOT}/%2e%2e/demo.html`,
      '/org/site/.da/demo.html', '/org/site/.da/skills/demo.html', '/org/site/.da/proposals-other/demo.html',
      `${ROOT}/nested/.da/demo.html`, `${ROOT}/nested//demo.html`, `${ROOT}/demo.md`,
      `${ROOT}/demo.html?x=1`, `${ROOT}/de\\mo.html`, `${ROOT}/.html`,
    ];
    for (const path of paths) {
      // eslint-disable-next-line no-await-in-loop
      await failure(() => review.mutate(path, true), 'Choose a staged HTML');
      // eslint-disable-next-line no-await-in-loop
      await failure(() => review.mutate(path, false), 'Choose a staged HTML');
      expect(() => review.original(path)).to.throw('Choose a staged HTML');
    }
    expect(calls).to.have.length(0);
    expect(() => new ProposalReview({ org: '../org', site: 'site' })).to.throw('Open this extension');
  });

  it('overwrites with the full draft without a revision precondition before deleting and verifying it', async () => {
    const state = server();
    const source = '<html><head><title>Page</title></head><body><h1>Proposed</h1></body></html>';
    state.files.set(DRAFT, source);
    await state.review.mutate(DRAFT, true);
    expect(state.files.get(ORIGINAL)).to.equal(source);
    expect(state.files.has(DRAFT)).to.equal(false);
    const writes = state.calls.filter(({ method }) => method !== 'GET');
    expect(writes.map(({ method, path }) => [method, path])).to.deep.equal([
      ['PUT', `/source${ORIGINAL}`], ['DELETE', `/source${DRAFT}`],
    ]);
    expect(writes[0].options.headers).to.equal(undefined);
    expect(writes[0].options.body.get('data').type).to.equal('text/html');
    expect(state.calls.at(-1).path).to.equal(`/source${DRAFT}`);
    expect(state.review.saved.size).to.equal(0);
  });

  it('discards only the draft and never writes an original', async () => {
    const { review, files, calls } = server();
    await review.mutate(DRAFT, false);
    expect(files.has(DRAFT)).to.equal(false);
    expect(files.get(ORIGINAL)).to.equal('<h1>Current</h1>');
    expect(calls.filter(({ method }) => method !== 'GET').map(({ path, method }) => [path, method]))
      .to.deep.equal([[`/source${DRAFT}`, 'DELETE']]);
  });

  [500, 403, 412].forEach((status) => {
    it(`retains the draft when saving fails with ${status}`, async () => {
      const state = server();
      state.failSave = status;
      await failure(() => state.review.mutate(DRAFT, true), 'Draft retained');
      expect(state.files.has(DRAFT)).to.equal(true);
      expect(state.files.get(ORIGINAL)).to.equal('<h1>Current</h1>');
      expect(state.calls.some(({ method }) => method === 'DELETE')).to.equal(false);
      expect(state.review.busy).to.equal(false);
    });
  });

  it('overwrites an existing original without an ETag and removes the draft', async () => {
    const state = server();
    state.noEtag = true;
    state.files.set(ORIGINAL, '<h1>Saved after the proposal</h1>');
    await state.review.mutate(DRAFT, true);
    expect(state.files.get(ORIGINAL)).to.equal('<h1>Proposed</h1>');
    expect(state.files.has(DRAFT)).to.equal(false);
    expect(state.calls.find(({ method }) => method === 'PUT').options.headers).to.equal(undefined);
  });

  it('refuses to create a missing original and retains its draft', async () => {
    const state = server();
    state.files.delete(ORIGINAL);
    await failure(() => state.review.mutate(DRAFT, true), '404');
    expect(state.calls.some(({ method }) => method !== 'GET')).to.equal(false);
    expect(state.files.has(DRAFT)).to.equal(true);
  });

  it('retries failed cleanup without saving the original a second time', async () => {
    const state = server();
    state.failDelete = 500;
    await failure(() => state.review.mutate(DRAFT, true), 'Original saved');
    expect(state.review.saved.has(DRAFT)).to.equal(true);
    await failure(() => state.review.mutate(DRAFT, false), 'already applied');
    state.failDelete = 0;
    state.files.set(ORIGINAL, '<h1>Edited after apply</h1>');
    await state.review.mutate(DRAFT, true);
    expect(state.files.get(ORIGINAL)).to.equal('<h1>Edited after apply</h1>');
    expect(state.files.has(DRAFT)).to.equal(false);
    expect(state.calls.filter(({ method }) => method === 'PUT')).to.have.length(1);
  });

  it('detects an acknowledged but unsuccessful delete', async () => {
    const state = server();
    state.keepDraft = true;
    await failure(() => state.review.mutate(DRAFT, true), 'Draft still exists');
    expect(state.review.saved.has(DRAFT)).to.equal(true);
    expect(state.files.has(DRAFT)).to.equal(true);
  });

  it('preserves a draft changed during apply', async () => {
    const state = server();
    state.afterSave = () => state.files.set(DRAFT, '<h1>Newer draft</h1>');
    await failure(() => state.review.mutate(DRAFT, true), 'newer draft has been retained');
    expect(state.files.get(ORIGINAL)).to.equal('<h1>Proposed</h1>');
    expect(state.files.get(DRAFT)).to.equal('<h1>Newer draft</h1>');
    expect(state.calls.some(({ method }) => method === 'DELETE')).to.equal(false);
  });

  it('requires a new review if a draft changed before retrying cleanup', async () => {
    const state = server();
    state.failDelete = 500;
    await failure(() => state.review.mutate(DRAFT, true), 'Original saved');
    state.files.set(DRAFT, '<h1>Newer draft</h1>');
    await failure(() => state.review.mutate(DRAFT, true), 'Review and apply the new draft');
    expect(state.files.has(DRAFT)).to.equal(true);
    expect(state.review.saved.has(DRAFT)).to.equal(false);
  });

  it('skips already missing drafts without saving and treats missing discard as success', async () => {
    const state = server();
    state.files.delete(DRAFT);
    await state.review.mutate(DRAFT, true);
    await state.review.mutate(DRAFT, false);
    expect(state.calls.some(({ method }) => method === 'PUT')).to.equal(false);
  });

  it('rejects overlapping mutations', async () => {
    const state = server();
    const fetchImpl = state.review.fetch;
    let release;
    state.review.fetch = (...args) => new Promise((resolve) => {
      release = () => resolve(fetchImpl(...args));
    });
    const first = state.review.mutate(DRAFT, true);
    await failure(() => state.review.mutate(DRAFT, false), 'in progress');
    expect(state.review.busy).to.equal(true);
    state.review.fetch = fetchImpl;
    release();
    await first;
  });
});
