import ENV from './env.js';

export function getQuery() {
  const { GITHUB_HEAD_REF: branch } = process.env;
  if (branch === 'local' || branch === 'local-https') {
    return '?da-admin=local&da-collab=local';
  }
  return '';
}

const QUERY = getQuery();

/**
 * Returns the Skills Lab URL for the given org and site.
 * Appends ?nx=local&nxver=2 on localhost so tests load the local da-nx instance.
 */
export function getSkillsLabURL(org, site) {
  const isLocal = ENV.startsWith('http://localhost') || ENV.startsWith('https://localhost');
  const nxParams = isLocal
    ? (QUERY ? '&nx=local&nxver=2' : '?nx=local&nxver=2')
    : '';
  return `${ENV}/apps/skills${QUERY}${nxParams}#/${org}/${site}`;
}

/**
 * Skills Lab URL without a hash — shows the org/site entry gate form.
 */
export function getSkillsLabGateURL() {
  const isLocal = ENV.startsWith('http://localhost') || ENV.startsWith('https://localhost');
  const nxParams = isLocal ? (QUERY ? '&nx=local&nxver=2' : '?nx=local&nxver=2') : '';
  return `${ENV}/apps/skills${QUERY}${nxParams}`;
}

export async function tabForward(page) {
  const browserName = page.context().browser()?.browserType().name();
  const key = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  await page.keyboard.press(key);
}

export async function tabBackward(page) {
  const browserName = page.context().browser()?.browserType().name();
  const key = browserName === 'webkit' ? 'Shift+Alt+Tab' : 'Shift+Tab';
  await page.keyboard.press(key);
}
