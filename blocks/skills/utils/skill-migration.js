/**
 * Skills storage migration: flat `.md` + config sheet → folder layout.
 *
 * Transforms `.da/skills/<id>.md` files (and sheet-only rows) into
 * `.da/skills/<id>/skill.md` files with valid frontmatter.
 *
 * This module ships DORMANT — nothing calls `migrateSkillsIfNeeded` yet.
 * The call site is wired in PR-5 (editor swap). Do not import this module
 * from any component or bootstrap path until then.
 *
 * ## Migration lifecycle
 * 1. Check `.da/skills/.migrated.json` marker. If `migrationVersion` matches
 *    `MIGRATION_VERSION`, skip entirely.
 * 2. Acquire a `localStorage` advisory lease (60 s TTL). Concurrent tabs that
 *    lose the race skip gracefully — idempotent writes are the safety net.
 * 3. Read all legacy skills: flat `.md` wins over sheet content; sheet `status`
 *    wins for both sources.
 * 4. Migrate each skill into `.da/skills/<id>/skill.md` with valid frontmatter.
 *    snake_case IDs are auto-converted to kebab-case.
 * 5. Drop the `skills` sheet key from the config and update `:names`.
 * 6. Write the marker file.
 * 7. Release the lease, broadcast `migration-complete`.
 *
 * See `private-docs/skills-storage-redesign-plan.md § D` for the full design.
 */

import { DA_ORIGIN, daFetch } from './da-fetch.js';
import { toSafeId, normaliseRowKey } from './sheet-utils.js';
import { ensureSkillFrontmatter } from './skill-frontmatter.js';
import { writeSkillFolderMd, readSkillFolderMd } from './skill-folder-api.js';
import { fetchDaConfigSheets, saveDaConfig } from '../skills-editor-api.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Bump this integer when the migration logic changes in a way that requires
 * re-running on already-migrated sites (e.g. new frontmatter fields, ID
 * normalisation changes). Sites will re-migrate on next editor open.
 */
export const MIGRATION_VERSION = 1;

const MARKER_FILENAME = '.migrated.json';
const LEASE_KEY_PREFIX = 'da-skills-migration:';
const LEASE_TTL_MS = 60_000;
const BC_CHANNEL = 'da-skills-editor';

// ---------------------------------------------------------------------------
// BroadcastChannel helpers
// ---------------------------------------------------------------------------

function broadcast(type, payload = {}) {
  try {
    const bc = new BroadcastChannel(BC_CHANNEL);
    bc.postMessage({ type, payload });
    bc.close();
  } catch { /* non-critical */ }
}

// ---------------------------------------------------------------------------
// Marker file
// ---------------------------------------------------------------------------

function markerPath(org, site) {
  return `/${org}/${site}/.da/skills/${MARKER_FILENAME}`;
}

/**
 * Read the migration marker. Returns `null` when absent or unreadable.
 * @param {string} org
 * @param {string} site
 * @returns {Promise<{ migrationVersion: number, completedAt: string, migratedIds: string[] } | null>}
 */
export async function readMigrationMarker(org, site) {
  try {
    const resp = await daFetch(`${DA_ORIGIN}/source${markerPath(org, site)}`);
    if (!resp.ok) return null;
    const text = await resp.text();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Write the migration marker.
 * @param {string} org
 * @param {string} site
 * @param {string[]} migratedIds
 * @returns {Promise<{ ok: boolean }>}
 */
async function writeMigrationMarker(org, site, migratedIds) {
  const content = JSON.stringify({
    migrationVersion: MIGRATION_VERSION,
    completedAt: new Date().toISOString(),
    migratedIds,
  });
  const blob = new Blob([content], { type: 'application/json' });
  const body = new FormData();
  body.append('data', blob, MARKER_FILENAME);
  try {
    const resp = await daFetch(
      `${DA_ORIGIN}/source${markerPath(org, site)}`,
      { method: 'PUT', body },
    );
    return { ok: resp.ok };
  } catch {
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Advisory lease (localStorage)
// ---------------------------------------------------------------------------

function leaseKey(org, site) {
  return `${LEASE_KEY_PREFIX}${org}/${site}`;
}

function makeLeaseId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Attempt to acquire the migration lease.
 * Returns a lease ID string on success, `null` if another tab holds a fresh lease.
 *
 * @param {string} org
 * @param {string} site
 * @returns {string | null}
 */
export function acquireLease(org, site) {
  const key = leaseKey(org, site);
  try {
    const existing = localStorage.getItem(key);
    if (existing) {
      const parsed = JSON.parse(existing);
      if (parsed?.claimedAt && Date.now() - parsed.claimedAt < LEASE_TTL_MS) {
        return null; // another tab holds a valid lease
      }
    }
    const id = makeLeaseId();
    localStorage.setItem(key, JSON.stringify({ claimedAt: Date.now(), claimedBy: id }));
    return id;
  } catch {
    // localStorage unavailable (private browsing etc.) — proceed without lease
    return makeLeaseId();
  }
}

/**
 * Release the migration lease.
 * Only removes the entry if the stored lease ID matches ours.
 *
 * @param {string} org
 * @param {string} site
 * @param {string} leaseId
 */
export function releaseLease(org, site, leaseId) {
  const key = leaseKey(org, site);
  try {
    const existing = localStorage.getItem(key);
    if (!existing) return;
    const parsed = JSON.parse(existing);
    if (parsed?.claimedBy === leaseId) localStorage.removeItem(key);
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Per-skill migration
// ---------------------------------------------------------------------------

/**
 * Derive a description for a skill from its markdown body.
 * Takes the first non-empty, non-heading line (up to 200 chars).
 * Falls back to the skill ID when no usable line is found.
 *
 * @param {string} body - markdown without frontmatter
 * @param {string} skillId
 * @returns {string}
 */
function deriveDescription(body, skillId) {
  const lines = body.split('\n');
  for (const line of lines) {
    const trimmed = line.replace(/^#+\s*/, '').trim();
    if (trimmed && trimmed.length >= 4) {
      return trimmed.slice(0, 200);
    }
  }
  return skillId;
}

/**
 * Migrate a single skill to the folder layout.
 *
 * @param {string} org
 * @param {string} site
 * @param {string} rawId - original skill ID (may be snake_case)
 * @param {string} body - markdown body (frontmatter stripped or absent)
 * @param {'approved' | 'draft'} status
 * @returns {Promise<{ ok: boolean, id: string, error?: string }>}
 */
export async function migrateOneSkill(org, site, rawId, body, status) {
  const id = toSafeId(rawId) || String(rawId).trim();
  if (!id) return { ok: false, id: rawId, error: 'empty id after normalisation' };

  // compose frontmatter — ensureSkillFrontmatter fills name, version, status;
  // we patch in the derived description before writing.
  const description = deriveDescription(body || '', id);
  const preComposed = `---\nname: ${id}\ndescription: ${description}\nversion: 1\nstatus: ${status}\n---\n${(body || '').trimStart()}`;
  const { markdown: composed } = ensureSkillFrontmatter(preComposed, id, status);

  const writeResult = await writeSkillFolderMd(org, site, id, composed);
  if (!writeResult.ok) {
    return { ok: false, id, error: `write failed (${writeResult.status ?? writeResult.error})` };
  }

  // round-trip verify
  const readBack = await readSkillFolderMd(org, site, id);
  if (!readBack.text) {
    return { ok: false, id, error: 'round-trip read returned empty' };
  }

  return { ok: true, id };
}

// ---------------------------------------------------------------------------
// Config-sheet cleanup
// ---------------------------------------------------------------------------

/**
 * Remove the `skills` sheet key from the DA config and update `:names`.
 *
 * @param {string} org
 * @param {string} site
 * @param {Record<string, unknown>} cfg - the full config JSON object (mutated in place)
 * @returns {Record<string, unknown>} the mutated config
 */
export function dropSkillsFromConfig(cfg) {
  const updated = { ...cfg };
  delete updated.skills;
  if (Array.isArray(updated[':names'])) {
    updated[':names'] = updated[':names'].filter((n) => n !== 'skills');
  }
  return updated;
}

// ---------------------------------------------------------------------------
// Delete legacy flat .md file
// ---------------------------------------------------------------------------

async function deleteLegacyMdFile(org, site, id) {
  const path = `/${org}/${site}/.da/skills/${id}.md`;
  try {
    const resp = await daFetch(`${DA_ORIGIN}/source${path}`, { method: 'DELETE' });
    return { ok: resp.ok || resp.status === 404, status: resp.status };
  } catch {
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Concurrency helper
// ---------------------------------------------------------------------------

/**
 * Map items through an async function with at most `limit` concurrent calls.
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<R>} fn
 * @returns {Promise<(R | undefined)[]>}
 */
async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  const queue = items.map((item, i) => [item, i]);

  async function runNext() {
    const entry = queue.shift();
    if (!entry) return undefined;
    const [item, i] = entry;
    try { results[i] = await fn(item); } catch { results[i] = undefined; }
    return runNext();
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext));
  return results;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run the skills storage migration if needed.
 *
 * - Idempotent: safe to call on every editor load.
 * - Dormant: this function exists in PR-4 but is not called anywhere yet.
 *   The call site is wired in PR-5.
 * - Non-destructive: writes new files before deleting old ones.
 *   A crash mid-migration leaves the site in a readable state (da-agent
 *   legacy fallback will serve old skills until migration completes).
 *
 * @param {string} org
 * @param {string} site
 * @returns {Promise<{
 *   skipped: boolean,
 *   migratedIds: string[],
 *   failedIds: string[],
 *   markerWritten: boolean
 * }>}
 */
export async function migrateSkillsIfNeeded(org, site) {
  // 1. Check marker — skip if already migrated at current version
  const marker = await readMigrationMarker(org, site);
  if (marker?.migrationVersion >= MIGRATION_VERSION) {
    return { skipped: true, migratedIds: [], failedIds: [], markerWritten: false };
  }

  // 2. Acquire lease
  const leaseId = acquireLease(org, site);
  if (!leaseId) {
    // another tab is migrating — skip, they'll broadcast completion
    return { skipped: true, migratedIds: [], failedIds: [], markerWritten: false };
  }

  broadcast('migration-started', { org, site });

  const migratedIds = [];
  const failedIds = [];

  try {
    // 3. Read all legacy skills
    const loaded = await fetchDaConfigSheets(org, site);
    if (!loaded.ok) {
      return { skipped: false, migratedIds, failedIds, markerWritten: false };
    }

    const sheetRows = loaded.json?.skills?.data ?? [];
    const sheetMap = {};
    const statusMap = {};
    sheetRows.forEach((row) => {
      const id = normaliseRowKey(row);
      const content = String(row.content ?? row.value ?? row.body ?? '');
      if (id && content) {
        sheetMap[id] = content;
        statusMap[id] = String(row.status ?? '').trim().toLowerCase() === 'draft' ? 'draft' : 'approved';
      }
    });

    // Collect all skill IDs from both sources
    const allIds = new Set(Object.keys(sheetMap));

    // Also discover flat .md files from the /list endpoint
    try {
      const listResp = await daFetch(`${DA_ORIGIN}/list/${org}/${site}/.da/skills`);
      if (listResp.ok) {
        const payload = await listResp.json();
        const items = Array.isArray(payload) ? payload : (payload?.items ?? []);
        items.forEach((item) => {
          const ext = String(item?.ext || '').trim().toLowerCase();
          const name = String(item?.name || '').trim();
          if (!name) return;
          if (ext === 'md' || name.toLowerCase().endsWith('.md')) {
            const fileId = name.replace(/\.md$/i, '');
            if (fileId) allIds.add(fileId);
          }
        });
      }
    } catch { /* best-effort discovery */ }

    // 4. Migrate each skill (parallel with a concurrency cap to avoid rate-limits)
    const allIdsList = Array.from(allIds);

    const migrationResults = await mapPool(allIdsList, 4, async (rawId) => {
      let body = sheetMap[rawId] || '';
      const status = statusMap[rawId] || 'approved';

      // Read flat .md — body wins over sheet if present
      try {
        const flatResp = await daFetch(
          `${DA_ORIGIN}/source/${org}/${site}/.da/skills/${rawId}.md`,
        );
        if (flatResp.ok) {
          const flatText = await flatResp.text();
          if (flatText && flatText.trim()) body = flatText;
        }
      } catch { /* sheet body is the fallback */ }

      const result = await migrateOneSkill(org, site, rawId, body, status);
      if (result.ok) {
        // Delete legacy flat .md (best-effort — migration marker gates re-runs)
        await deleteLegacyMdFile(org, site, rawId);
      }
      return result;
    });

    migrationResults.forEach((result) => {
      if (!result) return;
      if (result.ok) migratedIds.push(result.id);
      else failedIds.push(result.id ?? '?');
    });

    // 5. Drop skills sheet from config (only if all skills migrated successfully)
    if (failedIds.length === 0 && migratedIds.length >= 0) {
      const updatedCfg = dropSkillsFromConfig(loaded.json);
      await saveDaConfig(org, site, updatedCfg);
    }

    // 6. Write migration marker
    const { ok: markerWritten } = await writeMigrationMarker(org, site, migratedIds);

    broadcast('migration-complete', { org, site, migratedIds, failedIds });
    return { skipped: false, migratedIds, failedIds, markerWritten };
  } catch (err) {
    broadcast('skills-out-of-sync', { org, site, reason: String(err?.message ?? err) });
    return { skipped: false, migratedIds, failedIds, markerWritten: false };
  } finally {
    releaseLease(org, site, leaseId);
  }
}
