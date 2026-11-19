import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';

const extension = new URL('../../../tools/proposal-review/', import.meta.url);
const DRAFT = '/org/site/.da/campaigns/demo.html';
const ORIGINAL = '/org/site/campaigns/demo.html';
let server;
let origin;

test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'proposal-review.html';
    if (!/^[a-z-]+\.(html|js|css)$/.test(name)) {
      res.writeHead(404).end();
      return;
    }
    try {
      const body = await readFile(fileURLToPath(new URL(name, extension)));
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

test('reviews a real HTML diff, applies saved source, and discards a subsequent draft', async ({ page, request }) => {
  // Use the deployed shared renderer, not a test approximation of its algorithm.
  const renderer = await request.get('https://da.live/blocks/shared/version/htmldiff.js');
  expect(renderer.ok()).toBeTruthy();
  const rendererBody = await renderer.text();
  await page.route('https://da.live/blocks/shared/version/htmldiff.js', (route) => route.fulfill({
    contentType: 'text/javascript', body: rendererBody,
  }));
  await page.route('https://da.live/nx/styles/nexter.css', (route) => route.fulfill({
    contentType: 'text/css', body: '',
  }));
  await page.route('https://da.live/nx/utils/sdk.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `export default Promise.resolve({
      project: { org: 'org', repo: 'site' },
      actions: { daFetch: (...args) => fetch(...args) }
    });`,
  }));
  const files = new Map([
    [DRAFT, '<body><main><h1>Proposed heading</h1><p>Unchanged text.</p><script>window.pwned = true</script></main></body>'],
    [ORIGINAL, '<body><main><h1>Current heading</h1><p>Unchanged text.</p></main></body>'],
  ]);
  const writes = [];
  await page.route('https://admin.da.live/**', async (route) => {
    const req = route.request();
    const { pathname } = new URL(req.url());
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'ETag' };
    if (req.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: {
        ...headers, 'Access-Control-Allow-Methods': '*', 'Access-Control-Allow-Headers': '*',
      } });
      return;
    }
    if (pathname.startsWith('/list')) {
      const folder = pathname.slice(5);
      const items = folder.endsWith('/campaigns')
        ? [...files.keys()].filter((path) => path.startsWith(`${folder}/`)).map((path) => ({ path, ext: 'html' }))
        : [{ path: '/org/site/.da/campaigns', name: 'campaigns' }];
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
        headers: { ...headers, ETag: '"current-revision"' },
        body: files.get(path) || '',
      });
    }
  });
  await page.goto(origin);
  await expect(page.getByText('1 page staged', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View diff', exact: true }).click();
  const frame = page.frameLocator('iframe[title="Current content and proposed changes"]');
  await expect(frame.locator('ins')).toContainText('Proposed');
  await expect(frame.locator('del')).toContainText('Current');
  await expect(frame.locator('script')).toHaveCount(0);
  await expect(page.locator('iframe')).toHaveAttribute('sandbox', '');
  await page.getByText('Compare full HTML source', { exact: true }).click();
  await expect(page.locator('.source-comparison')).toContainText('<script>window.pwned = true</script>');
  await expect(page.locator('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'View diff', exact: true })).toBeFocused();
  const proposed = files.get(DRAFT);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  expect(writes).toHaveLength(0);
  await page.getByRole('button', { name: 'Confirm apply', exact: true }).click();
  await expect(page.getByText('No staged pages to review.', { exact: true })).toBeVisible();
  expect(files.get(ORIGINAL)).toBe(proposed);
  expect(files.has(DRAFT)).toBe(false);
  expect(writes[0].match).toBe('"current-revision"');
  expect(writes[0].body).toContain(proposed);
  expect(writes.map(({ method, path }) => [method, path])).toEqual([['PUT', ORIGINAL], ['DELETE', DRAFT]]);
  files.set(DRAFT, '<h1>Another proposal</h1>');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.locator('article')).toHaveCount(1);
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm discard', exact: true }).click();
  await expect(page.locator('article')).toHaveCount(0);
  expect(files.get(ORIGINAL)).toBe(proposed);
  expect(writes.at(-1)).toEqual({ path: DRAFT, method: 'DELETE' });
});
