import { expect } from '@esm-bundle/chai';
import '../../../tools/proposal-review/proposal-review.js';

const ROOT = '/org/site/.da';
const FIRST = `${ROOT}/first.html`;
const SECOND = `${ROOT}/second.html`;

async function until(predicate) {
  for (let count = 0; count < 100; count += 1) {
    if (predicate()) return;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, 5); });
  }
  throw new Error('Timed out waiting for the review UI.');
}

function click(app, label, parent = app) {
  const button = [...parent.querySelectorAll('button')].find((item) => item.textContent === label);
  expect(button, label).to.exist;
  expect(button.disabled, `${label} should be enabled`).to.equal(false);
  button.click();
}

describe('Proposed changes extension UI', () => {
  let app;
  let files;
  let calls;
  let failSecond;
  let failListing;

  beforeEach(async () => {
    files = new Map([
      [FIRST, '<h1>First draft</h1>'], [SECOND, '<h1>Second draft</h1>'],
      ['/org/site/first.html', '<h1>Original first</h1>'],
      ['/org/site/second.html', '<h1>Original second</h1>'],
    ]);
    calls = [];
    failSecond = false;
    failListing = false;
    window.proposalReviewFetch = async (url, options = {}) => {
      const { pathname } = new URL(url);
      const method = options.method || 'GET';
      calls.push({ pathname, method });
      if (pathname.startsWith('/list')) {
        if (failListing) return new Response(null, { status: 500 });
        return new Response(JSON.stringify([...files.keys()].filter((path) => path.startsWith(ROOT))
          .map((path) => ({ path, ext: 'html' }))));
      }
      const path = pathname.slice('/source'.length);
      if (method === 'PUT') {
        if (failSecond && path === '/org/site/second.html') return new Response(null, { status: 500 });
        files.set(path, await options.body.get('data').text());
        return new Response(null, { status: 201 });
      }
      if (method === 'DELETE') {
        files.delete(path);
        return new Response(null, { status: 204 });
      }
      return files.has(path)
        ? new Response(files.get(path), { headers: { etag: '"original"' } })
        : new Response(null, { status: 404 });
    };
    app = document.createElement('proposal-review-app');
    document.body.append(app);
    await until(() => app.querySelectorAll('article').length === 2);
  });

  afterEach(() => {
    app.remove();
    delete window.proposalReviewFetch;
  });

  it('lists the current site and requires explicit confirmation before discarding', async () => {
    expect(app.textContent).to.include('org/site');
    click(app, 'Discard', app.querySelector('article'));
    expect(app.querySelector('.confirmation').textContent).to.include('/first.html');
    expect(calls.some(({ method }) => ['PUT', 'DELETE'].includes(method))).to.equal(false);
    click(app, 'Cancel');
    expect(app.querySelector('.confirmation')).to.equal(null);
    click(app, 'Discard', app.querySelector('article'));
    click(app, 'Confirm discard');
    await until(() => app.querySelectorAll('article').length === 1);
    expect(files.has(FIRST)).to.equal(false);
    expect(files.get('/org/site/first.html')).to.equal('<h1>Original first</h1>');
    expect(app.querySelector('[role="status"]').textContent).to.include('1 page discarded');
  });

  it('applies a single page without touching the other staged page', async () => {
    click(app, 'Apply', app.querySelector('article'));
    expect(app.querySelector('.confirmation').textContent).to.include('Nothing is published');
    click(app, 'Confirm apply');
    await until(() => app.querySelectorAll('article').length === 1);
    expect(files.get('/org/site/first.html')).to.equal('<h1>First draft</h1>');
    expect(files.has(FIRST)).to.equal(false);
    expect(files.has(SECOND)).to.equal(true);
    expect(calls.filter(({ method }) => method === 'PUT')).to.have.length(1);
  });

  it('reports partial apply-all failure and leaves failed drafts actionable', async () => {
    failSecond = true;
    click(app, 'Apply all changes');
    click(app, 'Confirm apply');
    await until(() => !!app.querySelector('[role="alert"]'));
    expect(app.querySelectorAll('article')).to.have.length(1);
    expect(app.querySelector('[role="status"]').textContent).to.include('1 of 2 pages completed');
    expect(files.has(FIRST)).to.equal(false);
    expect(files.has(SECOND)).to.equal(true);
    failSecond = false;
    click(app, 'Apply all changes');
    click(app, 'Confirm apply');
    await until(() => app.textContent.includes('No staged pages'));
    expect(files.has(SECOND)).to.equal(false);
  });

  it('can refresh the list and distinguishes a failed listing from an empty state', async () => {
    failListing = true;
    click(app, 'Refresh');
    await until(() => !!app.querySelector('[role="alert"]'));
    expect(app.textContent).not.to.include('No staged pages');
    failListing = false;
    files.delete(FIRST);
    files.delete(SECOND);
    click(app, 'Refresh');
    await until(() => app.textContent.includes('No staged pages'));
    expect(app.querySelector('[role="alert"]')).to.equal(null);
  });

  it('shows diff read errors in a closable dialog without mutating content', async () => {
    files.delete('/org/site/first.html');
    click(app, 'View diff', app.querySelector('article'));
    await until(() => !!app.querySelector('dialog [role="alert"]'));
    expect(app.querySelector('dialog').open).to.equal(true);
    expect(app.querySelector('dialog').textContent).to.include('404');
    click(app, 'Close diff', app.querySelector('dialog'));
    await until(() => !app.querySelector('dialog'));
    expect(calls.some(({ method }) => ['PUT', 'DELETE'].includes(method))).to.equal(false);
  });
});
