import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import pageProposalsSkill from '../../../tools/proposal-review/page-proposals.js';

const extension = new URL('../../../tools/proposal-review/', import.meta.url);
const nxLoader = new URL('../../../blocks/skills/utils/codemirror-loader.js', import.meta.url);
const DRAFT = '/org/site/.da/proposals/campaigns/demo.html';
const ORIGINAL = '/org/site/campaigns/demo.html';
let server;
let origin;

test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'proposal-review.html';
    const resource = name === 'blocks/skills/utils/codemirror-loader.js' ? nxLoader
      : /^[a-z-]+\.(html|js|css)$/.test(name) && new URL(name, extension);
    if (!resource) {
      res.writeHead(404).end();
      return;
    }
    try {
      const body = await readFile(fileURLToPath(resource));
      const types = { js: 'text/javascript', css: 'text/css', html: 'text/html' };
      res.writeHead(200, { 'Content-Type': types[name.split('.').pop()] }).end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('opens a host comparison, applies saved source, and refreshes subsequent drafts after chat', async ({ page }) => {
  await page.setViewportSize({ width: 585, height: 640 });
  await page.route('https://da.live/nx/styles/nexter.css', (route) => route.fulfill({
    contentType: 'text/css', body: 'body { background: rgb(245 245 245); }',
  }));
  await page.route('https://feature-diff--da-nx--adobe.aem.live/nx/utils/sdk.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `export default Promise.resolve({
      project: { org: 'org', repo: 'site' },
      capabilities: { chatTurnCompleted: 1 },
      actions: {
        daFetch: (url, options = {}) => fetch(url, {
          ...options, headers: { ...options.headers, Authorization: 'Bearer test-token' }
        }),
        setPrompt: (text, options) => {
          window.proposalReviewPrompts ||= [];
          window.proposalReviewPrompts.push({ text, options });
        },
        openComparison: (options) => {
          window.proposalReviewComparisons ||= [];
          window.proposalReviewComparisons.push(options);
        },
        subscribeChatTurnCompleted: (callback) => {
          window.proposalReviewTurnCompleted = callback;
          return () => { delete window.proposalReviewTurnCompleted; };
        }
      }
    });`,
  }));
  const files = new Map([
    [DRAFT, '<body><main><h1>Proposed heading</h1><p>Unchanged text.</p><script>window.pwned = true</script></main></body>'],
    [ORIGINAL, '<body><main><h1>Current heading</h1><p>Unchanged text.</p></main></body>'],
    ['/org/site/.da/non-page.html', '<h1>Unrelated draft</h1>'],
  ]);
  const writes = [];
  let skills = [{ name: 'page-proposals' }];
  await page.route('https://ims-na1.adobelogin.com/ims/profile/v1?client_id=darkalley', (route) => {
    expect(route.request().headers().client_id).toBe('darkalley');
    return route.fulfill({
      json: {
        userId: 'test-user',
        projectedProductContext: [{ prodCtx: { owningEntity: 'test-tenant' } }],
      },
    });
  });
  await page.route('https://agent-orchestrator-prod-va7.adobe.io/api/v1/skills?*', (route) => {
    expect(route.request().headers().authorization).toBe('Bearer test-token');
    expect(route.request().headers()['x-tenant-id']).toBe('test-tenant');
    expect(new URL(route.request().url()).searchParams.get('manifest_id')).toBe('test-manifest');
    return route.fulfill({ json: { skills } });
  });
  await page.route('https://admin.da.live/**', async (route) => {
    const req = route.request();
    const { pathname } = new URL(req.url());
    const headers = { 'Access-Control-Allow-Origin': '*' };
    if (req.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: {
        ...headers, 'Access-Control-Allow-Methods': '*', 'Access-Control-Allow-Headers': '*',
      } });
      return;
    }
    if (pathname.startsWith('/config/')) {
      await route.fulfill({ headers, json: { flags: { data: [
        { key: 'ew.coworker', value: 'true' },
        { key: 'ew.coworkerManifest', value: 'test-manifest' },
      ] } } });
      return;
    }
    if (pathname.startsWith('/list')) {
      const folder = pathname.slice(5);
      const items = folder.endsWith('/campaigns')
        ? [...files.keys()].filter((path) => path.startsWith(`${folder}/`)).map((path) => ({ path, ext: 'html' }))
        : [{ path: '/org/site/.da/proposals/campaigns', name: 'campaigns' }];
      await route.fulfill({ headers, json: items });
      return;
    }
    const path = pathname.slice('/source'.length);
    if (req.method() === 'PUT') {
      writes.push({ path, method: 'PUT', body: req.postData(), match: req.headers()['if-match'] });
      files.set(path, files.get(DRAFT));
      await route.fulfill({ status: 201, headers });
    } else if (req.method() === 'DELETE') {
      writes.push({ path, method: 'DELETE' });
      files.delete(path);
      await route.fulfill({ status: 204, headers });
    } else {
      await route.fulfill({
        status: files.has(path) ? 200 : 404,
        headers,
        body: files.get(path) || '',
      });
    }
  });
  await page.goto(`${origin}?nx=feature-diff`);
  await expect(page.getByText('1 page staged', { exact: true })).toBeVisible();
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.getByRole('button', { name: 'View diff', exact: true }).locator('svg')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Discard', exact: true }).locator('svg')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apply this change', exact: true }))
    .toHaveCSS('background-color', 'rgb(70, 92, 255)');
  await page.screenshot({ path: test.info().outputPath('proposal-review-wide.png'), fullPage: true });
  await page.getByRole('button', { name: 'View diff', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.proposalReviewComparisons))
    .toEqual([{ candidate: DRAFT, baseline: ORIGINAL }]);
  await expect(page.locator('dialog, iframe')).toHaveCount(0);
  expect(writes).toHaveLength(0);
  const proposed = files.get(DRAFT);
  await page.getByRole('button', { name: 'Apply this change', exact: true }).click();
  expect(writes).toHaveLength(0);
  await page.getByRole('button', { name: 'Confirm apply', exact: true }).click();
  await expect(page.getByText('No staged pages to review.', { exact: true })).toBeVisible();
  expect(files.get(ORIGINAL)).toBe(proposed);
  expect(files.has(DRAFT)).toBe(false);
  expect(writes[0].match).toBeUndefined();
  expect(writes[0].body).toContain(proposed);
  expect(writes.map(({ method, path }) => [method, path])).toEqual([['PUT', ORIGINAL], ['DELETE', DRAFT]]);
  files.set(DRAFT, '<h1>Another proposal</h1>');
  await page.setViewportSize({ width: 320, height: 640 });
  await page.evaluate(() => window.proposalReviewTurnCompleted({ status: 'completed' }));
  await expect(page.locator('article')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('proposal-review-narrow.png'), fullPage: true });
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm discard', exact: true }).click();
  await expect(page.locator('article')).toHaveCount(0);
  expect(files.get(ORIGINAL)).toBe(proposed);
  expect(writes.at(-1)).toEqual({ path: DRAFT, method: 'DELETE' });
  expect(files.get('/org/site/.da/non-page.html')).toBe('<h1>Unrelated draft</h1>');
  skills = [];
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add personal skill', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.proposalReviewPrompts || [])).toEqual([]);
  const writeCount = writes.length;
  await page.getByRole('button', { name: 'Add personal skill', exact: true }).click();
  await expect(page.getByText('Request sent to chat.', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => window.proposalReviewPrompts)).toEqual([{
    text: `add this personal skill\n\n${pageProposalsSkill}`, options: { autoSend: true },
  }]);
  expect(writes).toHaveLength(writeCount);
  skills = [{ name: 'page-proposals' }];
  await page.evaluate(() => window.proposalReviewTurnCompleted({ status: 'completed' }));
  await expect(page.getByRole('region', { name: 'Page proposals skill' })).toHaveCount(0);
});
