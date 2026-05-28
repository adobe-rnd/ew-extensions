/**
 * Folder-based skill storage API.
 *
 * Skills live at `.da/skills/<skill-id>/skill.md` rather than the legacy
 * `.da/skills/<skill-id>.md` flat layout. The folder is the unit of storage:
 * later additions (references, scripts, attachments) live alongside `skill.md`
 * without affecting the contract.
 *
 * This module is ADDITIVE: nothing in the editor calls it yet. The editor
 * swap and migration happen in later PRs in the skills-storage redesign
 * sequence (see `private-docs/skills-storage-redesign-plan.md`).
 *
 * Versioning:
 *   - Each skill carries a monotonic integer in its frontmatter (`version: N`),
 *     bumped by the caller via `bumpSkillVersion` before write.
 *   - DA Admin's `/versionsource` snapshot is implemented in
 *     `snapshotSkillVersion` but disabled by default
 *     (`SNAPSHOT_ON_SAVE_ENABLED = false`) because da-admin's current
 *     `shouldCreateVersion` allowlist excludes `text/markdown`. Calling the
 *     endpoint silently no-ops. Flip the flag (and re-test) once da-admin's
 *     content-type allowlist includes markdown.
 */

import { DA_ORIGIN, daFetch } from './da-fetch.js';
import { isSafeId } from './sheet-utils.js';
import { parseSkillIndexEntry } from './skill-frontmatter.js';

export const SKILLS_FOLDER_BASE = '.da/skills';
export const SKILL_BODY_FILENAME = 'skill.md';

/** Max simultaneous body reads when building the skills manifest. */
const LIST_READ_CONCURRENCY = 8;

/**
 * Master switch for invoking DA Admin's `/versionsource` snapshot on save.
 * Stays `false` until da-admin's `shouldCreateVersion` accepts text/markdown.
 * No code change beyond this constant is needed to enable it.
 */
export const SNAPSHOT_ON_SAVE_ENABLED = false;

function warn(...args) {
  // eslint-disable-next-line no-console
  console.warn('[skill-folder-api]', ...args);
}

function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let nextIndex = 0;
  function worker() {
    if (nextIndex >= items.length) return Promise.resolve();
    const i = nextIndex;
    nextIndex += 1;
    return Promise.resolve(fn(items[i], i)).then((result) => {
      out[i] = result;
      return worker();
    });
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  return Promise.all(workers).then(() => out);
}

function buildFolderPath(org, site, id) {
  return `/${org}/${site}/${SKILLS_FOLDER_BASE}/${id}`;
}

function buildBodyPath(org, site, id) {
  return `${buildFolderPath(org, site, id)}/${SKILL_BODY_FILENAME}`;
}

/**
 * Writes a skill's `skill.md` to `.da/skills/<id>/skill.md`. The caller is
 * responsible for any frontmatter handling (use `ensureSkillFrontmatter` and
 * `bumpSkillVersion` from `./skill-frontmatter.js` before calling).
 *
 * @param {string} org
 * @param {string} site
 * @param {string} skillId
 * @param {string} markdown - full markdown including frontmatter
 * @returns {Promise<{ ok: boolean, status?: number, error?: string }>}
 */
export async function writeSkillFolderMd(org, site, skillId, markdown) {
  const id = String(skillId || '').trim();
  if (!id) return { ok: false, error: 'Skill id required' };
  if (!isSafeId(id)) return { ok: false, error: 'Invalid skill id' };
  const path = buildBodyPath(org, site, id);
  const blob = new Blob([markdown ?? ''], { type: 'text/markdown' });
  const body = new FormData();
  body.append('data', blob, SKILL_BODY_FILENAME);
  try {
    const resp = await daFetch(`${DA_ORIGIN}/source${path}`, { method: 'PUT', body });
    return { ok: resp.ok, status: resp.status };
  } catch (err) {
    warn('writeSkillFolderMd failed', { id, err });
    return { ok: false, error: String(err?.message || 'Network error writing skill file') };
  }
}

/**
 * Reads `.da/skills/<id>/skill.md`. Returns `{ text: '' }` when missing or on
 * error — never throws.
 *
 * @param {string} org
 * @param {string} site
 * @param {string} skillId
 * @returns {Promise<{ text: string, status?: number }>}
 */
export async function readSkillFolderMd(org, site, skillId) {
  const id = String(skillId || '').trim();
  if (!id || !isSafeId(id)) return { text: '' };
  const path = buildBodyPath(org, site, id);
  try {
    const resp = await daFetch(`${DA_ORIGIN}/source${path}`);
    if (!resp.ok) return { text: '', status: resp.status };
    return { text: await resp.text(), status: resp.status };
  } catch (err) {
    warn('readSkillFolderMd failed', { id, err });
    return { text: '' };
  }
}

/**
 * Deletes the entire skill folder at `.da/skills/<id>`. DA Admin's DELETE
 * handler treats extension-less paths as a prefix and removes all children
 * (`skill.md`, future `references/*`, etc.) plus the matching `.props` row.
 *
 * @param {string} org
 * @param {string} site
 * @param {string} skillId
 * @returns {Promise<{ ok: boolean, status?: number, error?: string }>}
 */
export async function deleteSkillFolder(org, site, skillId) {
  const id = String(skillId || '').trim();
  if (!id) return { ok: false, error: 'Skill id required' };
  if (!isSafeId(id)) return { ok: false, error: 'Invalid skill id' };
  const path = buildFolderPath(org, site, id);
  try {
    const resp = await daFetch(`${DA_ORIGIN}/source${path}`, { method: 'DELETE' });
    const wasMissing = resp.status === 404;
    const ok = resp.ok || wasMissing;
    return {
      ok, status: resp.status, deleted: resp.ok, wasMissing,
    };
  } catch (err) {
    warn('deleteSkillFolder failed', { id, err });
    return { ok: false, error: String(err?.message || 'Network error deleting skill folder') };
  }
}

/**
 * Snapshots the current `skill.md` via DA Admin's `/versionsource` POST.
 *
 * NOTE: Currently a soft no-op when called against an `.md` file because
 * `da-admin/src/storage/version/put.js#shouldCreateVersion` accepts only
 * `text/html` and `application/json`. The endpoint returns 200 but writes no
 * version object. The function is here so a future da-admin patch unlocks
 * versioning without any further client work; the editor will start calling
 * it once `SNAPSHOT_ON_SAVE_ENABLED` is flipped to `true`.
 *
 * @param {string} org
 * @param {string} site
 * @param {string} skillId
 * @returns {Promise<{ ok: boolean, status?: number, error?: string }>}
 */
export async function snapshotSkillVersion(org, site, skillId) {
  const id = String(skillId || '').trim();
  if (!id) return { ok: false, error: 'Skill id required' };
  if (!isSafeId(id)) return { ok: false, error: 'Invalid skill id' };
  const path = buildBodyPath(org, site, id);
  try {
    const resp = await daFetch(`${DA_ORIGIN}/versionsource${path}`, { method: 'POST' });
    return { ok: resp.ok, status: resp.status };
  } catch (err) {
    warn('snapshotSkillVersion failed', { id, err });
    return { ok: false, error: String(err?.message || 'Network error creating version snapshot') };
  }
}

function parseListPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.items)) return payload.items;
  return [];
}

function isFolderItem(item) {
  if (!item || typeof item.name !== 'string') return false;
  if (item.ext) return false;
  return isSafeId(item.name);
}

/**
 * Lists skill folders under `.da/skills/` and returns a frontmatter-only
 * manifest. The body is never loaded. Use `readSkillFolderMd` for on-demand
 * body access.
 *
 * Per-skill reads are pooled (concurrency cap `LIST_READ_CONCURRENCY`) so a
 * large catalog does not fan out hundreds of simultaneous DA Admin requests.
 *
 * Items where `skill.md` is missing or unreadable are skipped silently — the
 * folder exists but isn't a usable skill. The migration tool produces these
 * folders as a single transaction, so partial states should be rare.
 *
 * Failure modes:
 *   - `/list` failure (network error or 5xx): returns `{ entries: [],
 *     listFailed: true, status }` so the editor can show an error banner
 *     instead of an empty state.
 *   - `/list` 4xx (auth, missing folder): returns `{ entries: [],
 *     listFailed: false, status }` — treated as "no skills yet" which is
 *     the correct UX for a fresh site.
 *
 * @param {string} org
 * @param {string} site
 * @returns {Promise<{
 *   entries: Array<{
 *     id: string,
 *     name: string,
 *     description: string,
 *     version: number,
 *     status: 'approved'|'draft'
 *   }>,
 *   listFailed: boolean,
 *   status?: number
 * }>}
 */
export async function listSkillFolders(org, site) {
  const folder = `/${org}/${site}/${SKILLS_FOLDER_BASE}`;
  let folders;
  let listStatus;
  try {
    const resp = await daFetch(`${DA_ORIGIN}/list${folder}`);
    listStatus = resp.status;
    if (!resp.ok) {
      const listFailed = resp.status >= 500;
      return { entries: [], listFailed, status: resp.status };
    }
    const payload = await resp.json();
    folders = parseListPayload(payload).filter(isFolderItem);
  } catch (err) {
    warn('listSkillFolders /list failed', { err });
    return { entries: [], listFailed: true, status: listStatus };
  }

  const raw = await mapPool(folders, LIST_READ_CONCURRENCY, async (item) => {
    const id = String(item.name);
    const read = await readSkillFolderMd(org, site, id);
    if (!read.text) return null;
    const indexed = parseSkillIndexEntry(read.text);
    return {
      id,
      name: indexed.name || id,
      description: indexed.description,
      version: indexed.version,
      status: indexed.status,
    };
  });

  return { entries: raw.filter(Boolean), listFailed: false, status: listStatus };
}
