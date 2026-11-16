import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

const defaultSdk = 'https://da.live/nx/utils/sdk.js';
const branchSdk = 'https://fix-sdk-drag-pointer-capture--da-nx--adobe.aem.live/nx/utils/sdk.js';

[
  { name: 'default SDK', selector: '', expected: defaultSdk },
  { name: 'local SDK', selector: 'local', expected: 'http://localhost:6456/nx/utils/sdk.js' },
  { name: 'branch SDK', selector: 'fix-sdk-drag-pointer-capture', expected: branchSdk },
  {
    name: 'branch SDK on a hosted app',
    origin: 'https://main--ew-extensions--adobe-rnd.aem.live',
    selector: 'fix-sdk-drag-pointer-capture',
    expected: branchSdk,
  },
  {
    name: 'local SDK rejected on a hosted app',
    origin: 'https://main--ew-extensions--adobe-rnd.aem.live',
    selector: 'local',
    expected: defaultSdk,
  },
  { name: 'arbitrary SDK URL rejected', selector: 'https://example.com/sdk.js', expected: defaultSdk },
  { name: 'slash-containing ref rejected', selector: 'fix/sdk-drag', expected: defaultSdk },
].forEach(({
  name, selector, expected, origin = 'http://localhost:3001',
}) => {
  test(`text library selects ${name}`, async ({ page }) => {
    await page.route('**/*.css', (route) => route.fulfill({ contentType: 'text/css', body: '' }));
    await page.route('**/tools/text-library/text-library.html*', (route) => route.fulfill({
      path: resolve('tools/text-library/text-library.html'),
    }));
    await page.route('**/tools/text-library/text-library.js', (route) => route.fulfill({
      contentType: 'text/javascript',
      body: `import sdk from '${defaultSdk}'; window.sdkSource = await sdk;`,
    }));
    await page.route('**/nx/utils/sdk.js', (route) => route.fulfill({
      contentType: 'text/javascript',
      headers: { 'access-control-allow-origin': '*' },
      body: 'export default Promise.resolve(import.meta.url);',
    }));
    const url = new URL('/tools/text-library/text-library.html', origin);
    if (selector) url.searchParams.set('sdk', selector);
    await page.goto(url.href);
    await expect.poll(() => page.evaluate(() => window.sdkSource)).toBe(expected);
  });
});
