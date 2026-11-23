import { expect } from '@esm-bundle/chai';
import '../../../tools/proposal-review/proposal-review.js';
import {
  chatTurnSubscribers, comparisonRequests, promptRequests, sdk,
} from './fixtures/sdk.js';
import pageProposalsSkill from '../../../tools/proposal-review/page-proposals.js';

const ROOT = '/org/site/.da/proposals';
const FIRST = `${ROOT}/first.html`;
const SECOND = `${ROOT}/second.html`;
const { openComparison, setPrompt } = sdk.actions;

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

function finishChatTurn(status = 'completed') {
  chatTurnSubscribers.forEach((callback) => callback({ status }));
}

describe('Proposed changes extension UI', () => {
  let app;
  let files;
  let calls;
  let failSecond;
  let failListing;
  let skills;
  let skillsStatus;

  beforeEach(async () => {
    files = new Map([
      [FIRST, '<h1>First draft</h1>'], [SECOND, '<h1>Second draft</h1>'],
      ['/org/site/first.html', '<h1>Original first</h1>'],
      ['/org/site/second.html', '<h1>Original second</h1>'],
    ]);
    calls = [];
    failSecond = false;
    failListing = false;
    skills = [{ name: 'page-proposals' }];
    skillsStatus = 200;
    comparisonRequests.length = 0;
    promptRequests.length = 0;
    window.proposalReviewFetch = async (url, options = {}) => {
      const { pathname } = new URL(url);
      if (pathname === '/ims/profile/v1') {
        return Response.json({
          userId: 'test-user',
          projectedProductContext: [{ prodCtx: { owningEntity: 'test-tenant' } }],
        });
      }
      if (pathname.startsWith('/config/')) {
        return Response.json({ flags: { data: [
          { key: 'ew.coworker', value: 'true' },
          { key: 'ew.coworkerManifest', value: 'test-manifest' },
        ] } });
      }
      if (pathname === '/api/v1/skills') {
        return Response.json({ skills }, { status: skillsStatus });
      }
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
    await until(() => app.querySelectorAll('article').length === 2 && !app._checkingSkills);
  });

  afterEach(() => {
    app.remove();
    sdk.capabilities.chatTurnCompleted = 1;
    sdk.actions.openComparison = openComparison;
    sdk.actions.setPrompt = setPrompt;
    delete window.proposalReviewFetch;
  });

  it('lists the current site and requires explicit confirmation before discarding', async () => {
    expect(app.textContent).to.include('org/site');
    expect(app.textContent).to.include('/.da/proposals/');
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
    click(app, 'Apply this change', app.querySelector('article'));
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

  ['completed', 'aborted', 'error'].forEach((status) => {
    it(`refreshes staged pages when a chat turn ends with ${status}`, async () => {
      files.set(`${ROOT}/new.html`, '<h1>New draft</h1>');
      finishChatTurn(status);
      await until(() => app.querySelectorAll('article').length === 3);
      expect(app.textContent).to.include('/new.html');
    });
  });

  it('coalesces turn-end refreshes while confirmation is open and refreshes after cancel', async () => {
    click(app, 'Apply this change', app.querySelector('article'));
    const listings = calls.filter(({ pathname }) => pathname.startsWith('/list')).length;
    files.set(`${ROOT}/new.html`, '<h1>New draft</h1>');
    finishChatTurn();
    finishChatTurn('aborted');
    expect(app.querySelector('.confirmation')).not.to.equal(null);
    expect(calls.filter(({ pathname }) => pathname.startsWith('/list'))).to.have.length(listings);
    click(app, 'Cancel');
    await until(() => app.querySelectorAll('article').length === 3);
    expect(calls.filter(({ pathname }) => pathname.startsWith('/list'))).to.have.length(listings + 1);
    expect(calls.some(({ method }) => ['PUT', 'DELETE'].includes(method))).to.equal(false);
  });

  it('defers refresh until apply completes and preserves partial failure details', async () => {
    failSecond = true;
    const daFetch = window.proposalReviewFetch;
    let notified = false;
    window.proposalReviewFetch = (url, options) => {
      if (options?.method === 'PUT' && !notified) {
        notified = true;
        files.set(`${ROOT}/new.html`, '<h1>New draft</h1>');
        finishChatTurn();
      }
      return daFetch(url, options);
    };
    click(app, 'Apply all changes');
    click(app, 'Confirm apply');
    await until(() => !app._busy && app.textContent.includes('/new.html'));
    expect(app.querySelectorAll('article')).to.have.length(2);
    expect(app.querySelector('[role="alert"]').textContent).to.include('500');
    expect(app.querySelector('[role="status"]').textContent).to.include('1 of 2 pages completed');
    expect(files.has(FIRST)).to.equal(false);
    expect(files.has(SECOND)).to.equal(true);
    expect(files.has(`${ROOT}/new.html`)).to.equal(true);
  });

  it('unsubscribes on disconnect and restores a single subscription on reconnect', async () => {
    expect(chatTurnSubscribers.size).to.equal(1);
    app.remove();
    expect(chatTurnSubscribers.size).to.equal(0);
    const count = calls.length;
    files.set(`${ROOT}/new.html`, '<h1>New draft</h1>');
    finishChatTurn();
    expect(calls).to.have.length(count);
    document.body.append(app);
    await until(() => app.querySelectorAll('article').length === 3);
    expect(chatTurnSubscribers.size).to.equal(1);
  });

  it('keeps manual refresh available when the host does not support turn notifications', async () => {
    app.remove();
    sdk.capabilities.chatTurnCompleted = undefined;
    document.body.append(app);
    await until(() => !app._busy);
    expect(chatTurnSubscribers.size).to.equal(0);
    files.set(`${ROOT}/new.html`, '<h1>New draft</h1>');
    click(app, 'Refresh');
    await until(() => app.querySelectorAll('article').length === 3);
  });

  it('asks the host to compare the draft with its original without reading or embedding the diff', () => {
    const count = calls.length;
    click(app, 'View diff', app.querySelector('article'));
    expect(comparisonRequests).to.deep.equal([{
      candidate: FIRST, baseline: '/org/site/first.html',
    }]);
    expect(calls).to.have.length(count);
    expect(app.querySelector('dialog, iframe')).to.equal(null);
    expect(app._busy).to.equal(false);
  });

  it('continues refreshing chat proposals after requesting a host comparison', async () => {
    click(app, 'View diff', app.querySelector('article'));
    files.set(`${ROOT}/new.html`, '<h1>New draft</h1>');
    finishChatTurn();
    await until(() => app.querySelectorAll('article').length === 3);
    expect(comparisonRequests).to.have.length(1);
    expect(app.querySelector('dialog, iframe')).to.equal(null);
  });

  it('reports an unsupported host comparison without falling back to an inline viewer', () => {
    sdk.actions.openComparison = undefined;
    click(app, 'View diff', app.querySelector('article'));
    expect(app.querySelector('[role="alert"]').textContent).to.include('Host comparison is unavailable');
    expect(app.querySelector('dialog, iframe')).to.equal(null);
    expect(files.has(FIRST)).to.equal(true);
    expect(calls.some(({ method }) => ['PUT', 'DELETE'].includes(method))).to.equal(false);
  });

  it('explains how to update an SDK that rejects source-path comparisons', () => {
    sdk.actions.openComparison = () => { throw new TypeError('invalid-comparison'); };
    click(app, 'View diff', app.querySelector('article'));
    expect(app.querySelector('[role="alert"]').textContent).to.include('?nx=<branch>');
    expect(app.querySelector('dialog, iframe')).to.equal(null);
    expect(calls.some(({ method }) => ['PUT', 'DELETE'].includes(method))).to.equal(false);
  });

  it('does not offer or send an already configured personal skill', () => {
    expect(app.querySelector('.skill-notice')).to.equal(null);
    expect(promptRequests).to.have.length(0);
  });

  it('offers a missing skill only on request and rechecks after the installation turn', async () => {
    skills = [];
    finishChatTurn();
    await until(() => app._skillState === 'missing' && !app._busy && !app._checkingSkills);
    expect(promptRequests).to.have.length(0);
    click(app, 'Add personal skill');
    app._addSkill();
    expect(promptRequests).to.deep.equal([{
      text: `add this personal skill\n\n${pageProposalsSkill}`, options: { autoSend: true },
    }]);
    expect(app.querySelector('.skill-notice').textContent).to.include('Request sent to chat');
    expect(calls.some(({ method }) => ['PUT', 'DELETE'].includes(method))).to.equal(false);
    skills = [{ name: 'page-proposals' }];
    finishChatTurn();
    await until(() => app.querySelector('.skill-notice') === null);
    expect(promptRequests).to.have.length(1);
  });

  it('keeps catalog failures retryable without blocking review or claiming a missing skill', async () => {
    skillsStatus = 503;
    finishChatTurn();
    await until(() => app._skillState === 'error' && !app._busy && !app._checkingSkills);
    expect(app.querySelector('.skill-notice').textContent).to.include('503');
    expect(app.querySelector('.skill-notice').textContent).not.to.include('Add personal skill');
    expect(app.querySelectorAll('article')).to.have.length(2);
    click(app, 'View diff', app.querySelector('article'));
    expect(comparisonRequests).to.have.length(1);
    skillsStatus = 200;
    skills = [];
    click(app, 'Check skills');
    await until(() => app._skillState === 'missing' && !app._checkingSkills);
    expect(promptRequests).to.have.length(0);
  });

  it('rechecks missing skills on manual refresh without sending a second request automatically', async () => {
    skills = [];
    click(app, 'Refresh');
    await until(() => app._skillState === 'missing' && !app._busy && !app._checkingSkills);
    click(app, 'Add personal skill');
    click(app, 'Refresh');
    await until(() => app._skillState === 'missing' && !app._busy && !app._checkingSkills);
    expect(promptRequests).to.have.length(1);
    expect(app.querySelector('.skill-notice').textContent).to.include('Add personal skill');
  });

  it('retains the install offer after a chat dispatch failure and permits retry', async () => {
    skills = [];
    finishChatTurn();
    await until(() => app._skillState === 'missing' && !app._busy && !app._checkingSkills);
    sdk.actions.setPrompt = () => { throw new Error('Chat is unavailable'); };
    click(app, 'Add personal skill');
    expect(app.querySelector('.skill-notice').textContent).to.include('Chat is unavailable');
    expect(promptRequests).to.have.length(0);
    sdk.actions.setPrompt = setPrompt;
    click(app, 'Add personal skill');
    expect(promptRequests).to.have.length(1);
    expect(app.querySelector('.skill-notice').textContent).not.to.include('Chat is unavailable');
  });

  it('reports an SDK without chat dispatch instead of claiming the skill was installed', async () => {
    skills = [];
    finishChatTurn();
    await until(() => app._skillState === 'missing' && !app._busy && !app._checkingSkills);
    sdk.actions.setPrompt = undefined;
    click(app, 'Add personal skill');
    expect(app.querySelector('.skill-notice').textContent).to.include('Update the Experience Workspace SDK');
    expect(app._skillState).to.equal('missing');
    expect(promptRequests).to.have.length(0);
  });

  it('keeps page review responsive and coalesces chat notifications during a slow skill lookup', async () => {
    const daFetch = window.proposalReviewFetch;
    let release;
    let slow = true;
    let catalogRequests = 0;
    window.proposalReviewFetch = (url, options) => {
      if (new URL(url).pathname === '/api/v1/skills') {
        catalogRequests += 1;
        if (slow) return new Promise((resolve) => {
          release = () => resolve(Response.json({ skills }));
        });
      }
      return daFetch(url, options);
    };
    files.set(`${ROOT}/new.html`, '<h1>New draft</h1>');
    finishChatTurn();
    await until(() => release && app.querySelectorAll('article').length === 3 && !app._busy);
    click(app, 'View diff', app.querySelector('article'));
    expect(comparisonRequests).to.have.length(1);
    finishChatTurn();
    finishChatTurn();
    await until(() => app._skillCheckPending && !app._busy);
    slow = false;
    release();
    await until(() => !app._checkingSkills && !app._skillCheckPending);
    expect(catalogRequests).to.equal(2);
  });
});
