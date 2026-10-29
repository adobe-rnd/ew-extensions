// Resolves the base URL the e2e suite loads `/apps/skills` from.
//
// Precedence:
//   1. E2E_BASE_URL / PLAYWRIGHT_BASE_URL  — explicit override (use this for a
//      branch preview, e.g. https://<branch>--ew-extensions--adobe-rnd.aem.page)
//   2. GITHUB_HEAD_REF=local / local-https — a locally-served `aem up` (3000)
//   3. the EDS site for this repo           — <branch>--<repo>--<owner>.aem.live,
//      derived from GITHUB_REPOSITORY ("owner/repo") when set, else the
//      ew-extensions default. (Was hardcoded to `da-live`/`adobe` — a leftover
//      from the da-live port that made local runs test da.live, not this repo.)
//
// Note: the e2e suite is NOT run in CI (main.yaml runs lint + unit only), so
// this default only affects local developer runs. To exercise YOUR branch's
// code rather than whatever is published, set E2E_BASE_URL to its preview URL
// or run `GITHUB_HEAD_REF=local` against `aem up`.
function getEnv() {
  const explicit = (typeof process.env.E2E_BASE_URL === 'string' && process.env.E2E_BASE_URL.trim())
    || (typeof process.env.PLAYWRIGHT_BASE_URL === 'string' && process.env.PLAYWRIGHT_BASE_URL.trim());
  if (explicit) {
    return explicit.replace(/\/$/, '');
  }

  const { GITHUB_HEAD_REF: branch = 'main', GITHUB_REPOSITORY: repoSlug } = process.env;
  if (branch === 'local') return 'http://localhost:3000';
  if (branch === 'local-https') return 'https://localhost';

  const [slugOwner, slugRepo] = (repoSlug || '').split('/');
  const owner = slugOwner || 'adobe-rnd';
  const repo = slugRepo || 'ew-extensions';
  return `https://${branch}--${repo}--${owner}.aem.live`;
}

const ENV = (() => getEnv())();
export default ENV;
