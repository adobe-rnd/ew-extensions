/**
 * Resolves which Experience Governance MFE bundle to embed.
 *
 * Priority:
 *  1. `?egov=<local|qa|stage|prod>`: explicit override (same pattern as
 *     `?nx=`/`?da-admin=`), for pointing at a local MFE dev server or a
 *     specific deployed env regardless of where da-live itself is hosted.
 *  2. da-live's own hostname, using the same stage/prod split as the IMS tier
 *     (see da-nx/nx/scripts/nexter.js): localhost / *.aem.page → stage;
 *     da.live / *.aem.live → prod.
 */

import { EGOV_MFE } from '../constants.js';

/** Host URL params this module owns: the env, API, and deep-link overrides. */
const EGOV_ENV_PARAM = 'egov';
const EGOV_API_PARAM = 'ec';
const EGOV_PATH_PARAM = 'egovPath';

const EGOV_API_ENVS = {
  prod: 'https://experience-context.adobe.io/api',
  stage: 'https://experience-context-stage.adobe.io/api',
};
// Kept as one expression so the exact host allow-list stays easy to audit.
// eslint-disable-next-line max-len
const EGOV_EPHEMERAL_API_HOST = /^adobe-aem-foundation-brand-governance-agent-deploy-[0-9a-f]{6}\.stage\.cloud\.adobe\.io$/;
const SAFE_EGOV_PARAM = /^(local|qa|stage|prod)$/;

/** Governance-relative deep-link path (see the MFE's useGovernancePath), e.g. `/brands/123/knowledge/connectors`. */
const SAFE_EGOV_PATH = /^\/[a-zA-Z0-9\-_/%.]*$/;

export function resolveEgovEnv(location = window.location) {
  const override = new URLSearchParams(location.search).get(EGOV_ENV_PARAM);
  if (override && SAFE_EGOV_PARAM.test(override)) return override;

  const { hostname } = location;
  if (hostname === 'localhost' || hostname.endsWith('.aem.page')) return 'stage';
  return 'prod';
}

export function resolveEgovEmbedUrl(location = window.location) {
  const env = resolveEgovEnv(location);
  return EGOV_MFE.EMBED_URLS[env] || EGOV_MFE.EMBED_URLS.prod;
}

/**
 * Host env → the MFE's own `Env` union (see its src/types/env.ts), which picks
 * the backend API host. The MFE does no case normalization: anything outside
 * this exact uppercase set silently falls back to its own STAGE API, which is
 * why we always send an explicit value.
 *
 * `local` maps to STAGE, not DEV, because `?egov=local` means "serve the MFE
 * *bundle* from a local dev server", not "use a local backend". DEV would
 * point the API at https://localhost:8080/api (usually not running) and, per
 * the MFE's EnvProvider, force every feature flag on.
 */
const EGOV_MFE_ENVS = {
  local: 'STAGE',
  qa: 'QA',
  stage: 'STAGE',
  prod: 'PROD',
};

/**
 * Resolves the `env` value to hand the MFE, so it targets the backend matching
 * the bundle we embedded. Falls back to PROD to match `resolveEgovEnv`: an
 * unrecognized env should not quietly serve stage data to a production user.
 */
export function resolveEgovMfeEnv(location = window.location) {
  return EGOV_MFE_ENVS[resolveEgovEnv(location)] || 'PROD';
}

function resolveEgovApiOverride(value) {
  if (Object.hasOwn(EGOV_API_ENVS, value)) return EGOV_API_ENVS[value];
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  return EGOV_EPHEMERAL_API_HOST.test(url.hostname) ? `${url.origin}/api` : null;
}

/**
 * Resolves an explicit experience-context API override from
 * `?ec=prod|stage|<ephemeral URL>`. Without a valid `ec` parameter, no URL is
 * returned and the MFE chooses its API from the `env` prop instead.
 *
 * @param {Location} [location]
 * @returns {string|undefined} API base URL ending in `/api`
 */
export function resolveEgovApiUrl(location = window.location) {
  const query = new URLSearchParams(location.search).get(EGOV_API_PARAM);
  return resolveEgovApiOverride(query) ?? undefined;
}

/**
 * Reads a governance-relative deep-link path from `?egovPath=`, e.g.
 * `?egovPath=/brands/123/knowledge/connectors`. Falls back to `/` (brand
 * list) if absent or malformed.
 */
export function resolveEgovPath(location = window.location) {
  const raw = new URLSearchParams(location.search).get(EGOV_PATH_PARAM);
  return raw && SAFE_EGOV_PATH.test(raw) ? raw : '/';
}

/**
 * Reflects the MFE's current internal route into the host URL's `?egovPath=`,
 * so the deep link is shareable and survives reload. Always replaces rather
 * than pushes: the MFE owns its own router and can't be driven from a popstate
 * yet, so added history entries would move the URL without moving the MFE.
 *
 * The query string is built by hand because `URLSearchParams` percent-encodes
 * every `/`, turning a readable `/brands/123/knowledge/connectors` into
 * `%2Fbrands%2F123%2F...`. RFC 3986 doesn't require escaping `/` in a query, so
 * un-escaping just `%2F` keeps the param valid and legible.
 *
 * `location`/`history` are injectable for tests.
 */
export function setEgovPath(path, {
  location = window.location,
  history = window.history,
} = {}) {
  if (!path || !SAFE_EGOV_PATH.test(path)) return;
  const url = new URL(location.href);
  const params = new URLSearchParams(url.search);
  params.delete(EGOV_PATH_PARAM);
  const query = params.toString();
  const encodedPath = encodeURIComponent(path).replace(/%2F/g, '/');
  const egovPathParam = path === '/' ? '' : `${EGOV_PATH_PARAM}=${encodedPath}`;
  url.search = [query, egovPathParam].filter(Boolean).join('&');
  history.replaceState(history.state, '', url);
}
