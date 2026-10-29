/**
 * Data layer for Skills Editor — config sheet CRUD, .md file I/O,
 * MCP / agent-presets, and chat suggestion events.
 *
 * Ported from exp-workspace nx/blocks/browse/skills-lab-api.js,
 * adapted for nx2 imports and the skills-editor naming convention.
 */

import { DA_ORIGIN, daFetch, getToken, waitForImsToken } from './utils/da-fetch.js';
import { parseSheetBoolean, normaliseRowKey, isSafeId, isSafeSubPath } from './utils/sheet-utils.js';
import { parseFrontmatter } from './utils/skill-frontmatter.js';

// ─── agent origin ───────────────────────────────────────────────────────────

export function getAgentOrigin() {
  const params = new URLSearchParams(window.location.search);
  const isLocal = params.get('ref') === 'local' || params.get('nx') === 'local';
  return isLocal ? 'http://localhost:4002' : 'https://da-agent.adobeaem.workers.dev';
}

// ─── lightweight in-memory caches (per org/site) ────────────────────────────

const CACHE_TTL_MS = 15000;
const configCache = new Map();
const inflightConfig = new Map();
const skillMdCache = new Map();
const inflightSkillMd = new Map();

function siteKey(org, site) {
  return site ? `${org}/${site}` : String(org);
}

function getCached(map, key) {
  const entry = map.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    map.delete(key);
    return null;
  }
  return entry.value;
}

function setCached(map, key, value) {
  map.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

function invalidateConfigCache(org, site) {
  configCache.delete(siteKey(org, site));
  inflightConfig.delete(siteKey(org, site));
}

function invalidateSkillMdCache(org, site) {
  skillMdCache.delete(siteKey(org, site));
  inflightSkillMd.delete(siteKey(org, site));
}

// ─── chat ↔ skills-editor suggestion (sessionStorage + custom events) ────────

const SKILL_CHAT_PROSE_KEY = 'da-skills-editor-skill-chat-prose';
const LEGACY_SKILL_CHAT_PROSE_KEY = 'da-skills-lab-skill-chat-prose';
const SUGGEST_HANDOFF_KEY = 'da-skills-editor-suggestion';
const LEGACY_SUGGEST_HANDOFF_KEY = 'da-skills-lab-suggest-handoff';

export const DA_SKILLS_EDITOR_SUGGESTION_HANDOFF = 'da-skills-editor-suggestion-handoff';
export const DA_SKILLS_EDITOR_FORM_DISMISS = 'da-skills-editor-form-column-dismiss';
export const DA_SKILLS_EDITOR_CLEAR_FORM_FROM_CHAT = 'da-skills-editor-clear-form-from-chat';
export const DA_SKILLS_EDITOR_PROMPT_ADD_TO_CHAT = 'da-skills-editor-prompt-add-to-chat';
export const DA_SKILLS_LAB_SUGGESTION_HANDOFF = 'da-skills-lab-suggestion-handoff';
export const DA_SKILLS_LAB_FORM_DISMISS = 'da-skills-lab-form-column-dismiss';
export const DA_SKILLS_LAB_CLEAR_FORM_FROM_CHAT = 'da-skills-lab-clear-form-from-chat';
export const DA_SKILLS_LAB_PROMPT_ADD_TO_CHAT = 'da-skills-lab-prompt-add-to-chat';

export function setSkillChatProse(text) {
  try {
    if (text && String(text).trim()) {
      const prose = String(text);
      sessionStorage.setItem(SKILL_CHAT_PROSE_KEY, prose);
      sessionStorage.setItem(LEGACY_SKILL_CHAT_PROSE_KEY, prose);
    } else {
      sessionStorage.removeItem(SKILL_CHAT_PROSE_KEY);
      sessionStorage.removeItem(LEGACY_SKILL_CHAT_PROSE_KEY);
    }
  } catch { /* noop */ }
}

export function consumeSkillChatProse() {
  try {
    const t = sessionStorage.getItem(SKILL_CHAT_PROSE_KEY)
      || sessionStorage.getItem(LEGACY_SKILL_CHAT_PROSE_KEY);
    sessionStorage.removeItem(SKILL_CHAT_PROSE_KEY);
    sessionStorage.removeItem(LEGACY_SKILL_CHAT_PROSE_KEY);
    return t && String(t).trim() ? String(t) : '';
  } catch { return ''; }
}

/** @param {{ prose?: string, id?: string, body?: string } | null} payload */
export function setSuggestionHandoff(payload) {
  try {
    if (!payload || typeof payload !== 'object') {
      sessionStorage.removeItem(SUGGEST_HANDOFF_KEY);
      sessionStorage.removeItem(LEGACY_SUGGEST_HANDOFF_KEY);
      return;
    }
    const { prose = '', id = '', body = '' } = payload;
    if (!prose.trim() && !id.trim() && !body.trim()) {
      sessionStorage.removeItem(SUGGEST_HANDOFF_KEY);
      sessionStorage.removeItem(LEGACY_SUGGEST_HANDOFF_KEY);
      return;
    }
    const serialized = JSON.stringify({ prose, id: id.trim(), body });
    sessionStorage.setItem(SUGGEST_HANDOFF_KEY, serialized);
    sessionStorage.setItem(LEGACY_SUGGEST_HANDOFF_KEY, serialized);
  } catch { /* noop */ }
}

/** @returns {{ prose: string, id: string, body: string } | null} */
export function consumeSuggestionHandoff() {
  try {
    const raw = sessionStorage.getItem(SUGGEST_HANDOFF_KEY)
      || sessionStorage.getItem(LEGACY_SUGGEST_HANDOFF_KEY);
    sessionStorage.removeItem(SUGGEST_HANDOFF_KEY);
    sessionStorage.removeItem(LEGACY_SUGGEST_HANDOFF_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    if (!payload || typeof payload !== 'object') return null;
    return { prose: String(payload.prose || ''), id: String(payload.id || '').trim(), body: String(payload.body || '') };
  } catch { return null; }
}

export function clearSuggestionSession() {
  try {
    sessionStorage.removeItem(SUGGEST_HANDOFF_KEY);
    sessionStorage.removeItem(LEGACY_SUGGEST_HANDOFF_KEY);
    sessionStorage.removeItem(SKILL_CHAT_PROSE_KEY);
    sessionStorage.removeItem(LEGACY_SKILL_CHAT_PROSE_KEY);
  } catch { /* noop */ }
}

// ─── config sheet helpers ───────────────────────────────────────────────────

function rowEnabledState(row, defaultEnabled = true) {
  if (!row || typeof row !== 'object') return defaultEnabled;
  const explicitEnabled = parseSheetBoolean(row.enabled);
  if (typeof explicitEnabled === 'boolean') return explicitEnabled;
  const explicitDisabled = parseSheetBoolean(row.disabled);
  if (typeof explicitDisabled === 'boolean') return !explicitDisabled;
  return defaultEnabled;
}

function syncConfigMeta(cfg) {
  const names = Object.keys(cfg).filter(
    (k) => !k.startsWith(':') && !k.startsWith('private-') && typeof cfg[k] === 'object',
  );
  if (names.length) {
    cfg[':names'] = names;
    cfg[':type'] = 'multi-sheet';
  }
}

export async function saveDaConfig(org, site, fullConfig) {
  syncConfigMeta(fullConfig);
  const path = site ? `${org}/${site}` : org;
  const body = new FormData();
  body.append('config', JSON.stringify(fullConfig));
  const resp = await daFetch(`${DA_ORIGIN}/config/${path}/`, { method: 'POST', body });
  if (resp.ok) invalidateConfigCache(org, site);
  return { ok: resp.ok, status: resp.status };
}

const inflightBootstrap = new Map();

async function materializeConfigAfter404(org, site) {
  const path = site ? `${org}/${site}` : org;
  let boot = inflightBootstrap.get(path);
  if (!boot) {
    boot = saveDaConfig(org, site, {});
    inflightBootstrap.set(path, boot);
    boot.finally(() => inflightBootstrap.delete(path)).catch(() => { /* bootstrap cleanup */ });
  }
  await boot;
}

const EMPTY_CONFIG = Object.freeze({
  ok: true,
  json: {},
  mcpRows: [],
  agentRows: [],
  configuredMcpServers: {},
  configuredMcpServerHeaders: {},
  toolOverrides: {},
});

const TOOL_OVERRIDES_SHEET = 'tool-overrides';

// Experience Workspace flags live in the `flags` sheet, keyed `ew.*`.
const EW_FLAG_PREFIX = 'ew.';

const AUTH_FAIL = {
  ok: false,
  status: 401,
  error: 'Unauthorized',
  mcpRows: [],
  agentRows: [],
  configuredMcpServers: {},
  configuredMcpServerHeaders: {},
  toolOverrides: {},
};

export async function fetchDaConfigSheets(org, site, options = {}) {
  const cacheKey = siteKey(org, site);
  if (!options.force) {
    const cached = getCached(configCache, cacheKey);
    if (cached) return cached;
    const inflight = inflightConfig.get(cacheKey);
    if (inflight) return inflight;
  }

  const path = site ? `${org}/${site}` : org;
  const url = `${DA_ORIGIN}/config/${path}/`;
  const promise = (async () => {
    try {
      let resp = await daFetch(url);
      if (resp.status === 401) return { ...AUTH_FAIL };
      if (resp.status === 404) {
        // Org-level flag reads must not create an org config doc as a side
        // effect — callers pass skipMaterialize to just resolve to empty.
        if (options.skipMaterialize) return { ...EMPTY_CONFIG };
        await materializeConfigAfter404(org, site);
        resp = await daFetch(url);
        if (resp.status === 401) return { ...AUTH_FAIL };
      }

      if (!resp.ok) {
        return resp.status === 404
          ? { ...EMPTY_CONFIG }
          // eslint-disable-next-line max-len
          : {
            ok: false,
            status: resp.status,
            mcpRows: [],
            agentRows: [],
            configuredMcpServers: {},
            configuredMcpServerHeaders: {},
            toolOverrides: {},
          };
      }

      const json = await resp.json();
      const mcpRows = json?.['mcp-servers']?.data || [];
      const servers = {};
      const serverHeaders = {};
      mcpRows.forEach((row) => {
        const rowUrl = row.url || row.value;
        const s = String(row?.status ?? '').trim().toLowerCase();
        const approved = s !== 'draft';
        const enabled = rowEnabledState(row, true);
        const rowKey = String(row?.key || '').trim();
        if (rowKey && rowUrl && approved && enabled) {
          servers[rowKey] = rowUrl;
          // eslint-disable-next-line no-use-before-define
          const hdrs = parseRowHeaders(row);
          if (Object.keys(hdrs).length) serverHeaders[rowKey] = hdrs;
        }
      });
      const agentRows = (json?.agents?.data || [])
        .filter((r) => r.key && (r.url || r.value))
        .map((r) => ({ ...r, url: r.url || r.value }));
      const toolOverrides = {};
      (json?.[TOOL_OVERRIDES_SHEET]?.data ?? []).forEach((r) => {
        const rowKey = String(r.key || '').trim();
        if (rowKey) toolOverrides[rowKey] = rowEnabledState(r, true);
      });

      const result = {
        ok: true,
        json,
        mcpRows,
        configuredMcpServers: servers,
        configuredMcpServerHeaders: serverHeaders,
        agentRows,
        toolOverrides,
      };
      setCached(configCache, cacheKey, result);
      return result;
    } catch (err) {
      return {
        ok: false,
        error: String(err?.message ?? err),
        mcpRows: [],
        agentRows: [],
        configuredMcpServers: {},
        configuredMcpServerHeaders: {},
        toolOverrides: {},
      };
    } finally {
      inflightConfig.delete(cacheKey);
    }
  })();
  inflightConfig.set(cacheKey, promise);
  return promise;
}

/**
 * Reads `ew.*` flags merged across the ORG-level and SITE-level DA config, with
 * site overriding org — mirroring da-nx's getEWFlags (nx2/utils/ewFlags.js) so
 * the editor's altHarness detection agrees with the chat. Without the org-level
 * read, an `ew.altHarness` set only at the org level is missed and the editor
 * silently falls back to the empty da-agent path (no CMA skills, no bridge MCP
 * servers). `siteConfig` lets a caller pass an already-fetched site config to
 * avoid a duplicate request; the org read skips 404-materialization so it never
 * creates an org config doc as a side effect.
 */
export async function fetchEwFlags(org, site, siteConfig = null) {
  const [orgConfig, resolvedSite] = await Promise.all([
    fetchDaConfigSheets(org, undefined, { skipMaterialize: true }),
    siteConfig || fetchDaConfigSheets(org, site),
  ]);
  const flags = {};
  // Org first, site last: site-level values overwrite org-level ones.
  for (const cfg of [orgConfig, resolvedSite]) {
    for (const row of cfg?.json?.flags?.data ?? []) {
      if (typeof row?.key === 'string' && row.key.startsWith(EW_FLAG_PREFIX)) {
        flags[row.key] = row.value;
      }
    }
  }
  return flags;
}

// ─── generic config sheet mutation helpers ──────────────────────────────────
// Every config sheet mutator follows the same flow:
//   1. fetchDaConfigSheets  2. ensure sheet exists  3. mutate data[]  4. saveDaConfig
// These two helpers centralize that lifecycle and the { ok, error, status } shape.

/**
 * Upsert a row in a config sheet.
 * @param {string} org
 * @param {string} site
 * @param {string} sheetName
 * @param {(row: object) => boolean} matchFn — identifies existing row
 * @param {(prev: object) => object} buildRowFn — receives prev row ({} if new) and returns next row
 * @param {string} label — human-readable name for error messages (e.g. "skill", "prompt")
 */
async function upsertSheetRow(org, site, sheetName, matchFn, buildRowFn, label = 'row') {
  const loaded = await fetchDaConfigSheets(org, site);
  if (!loaded.ok) {
    return { ok: false, error: loaded.error || `Could not load config (${loaded.status})` };
  }
  const cfg = { ...(loaded.json || {}) };
  if (!cfg[sheetName]) cfg[sheetName] = { total: 0, limit: 1000, offset: 0, data: [] };
  const sheet = cfg[sheetName];
  const data = [...(sheet.data || [])];
  const idx = data.findIndex(matchFn);
  const prev = idx >= 0 ? data[idx] : {};
  const nextRow = buildRowFn(prev);
  if (idx >= 0) data[idx] = nextRow;
  else data.push(nextRow);
  cfg[sheetName] = { ...sheet, data, total: data.length };
  const save = await saveDaConfig(org, site, cfg);
  if (!save.ok) return { ok: false, error: `${label} save failed (${save.status})` };
  return { ok: true, status: save.status };
}

/**
 * Delete a row from a config sheet.
 * @param {string} org
 * @param {string} site
 * @param {string} sheetName
 * @param {(row: object) => boolean} matchFn — identifies the row to remove
 * @param {string} label
 */
async function deleteSheetRow(org, site, sheetName, matchFn, label = 'row') {
  const loaded = await fetchDaConfigSheets(org, site);
  if (!loaded.ok) {
    return { ok: false, error: loaded.error || `Could not load config (${loaded.status})` };
  }
  const cfg = { ...(loaded.json || {}) };
  const sheet = cfg[sheetName];
  if (!sheet?.data?.length) return { ok: false, error: `No ${label}s in config` };
  const data = sheet.data.filter((r) => !matchFn(r));
  if (data.length === sheet.data.length) return { ok: false, error: `${label} not found` };
  cfg[sheetName] = { ...sheet, data, total: data.length };
  const save = await saveDaConfig(org, site, cfg);
  if (!save.ok) return { ok: false, error: `${label} delete failed (${save.status})` };
  return { ok: true, status: save.status };
}

// ─── skills CRUD (config sheet + .md file) ──────────────────────────────────

const SKILLS_SHEET = 'skills';

const recentlyDeletedSkills = new Set();
const DELETED_GUARD_MS = 15_000;

export function markSkillDeleted(skillId) {
  const id = String(skillId || '').trim().replace(/\.md$/i, '');
  recentlyDeletedSkills.add(id);
  setTimeout(() => recentlyDeletedSkills.delete(id), DELETED_GUARD_MS);
}

export function isSkillRecentlyDeleted(skillId) {
  return recentlyDeletedSkills.has(String(skillId || '').trim().replace(/\.md$/i, ''));
}

export function skillRowStatus(row) {
  if (!row || typeof row !== 'object') return 'approved';
  return String(row.status ?? '').trim().toLowerCase() === 'draft' ? 'draft' : 'approved';
}

export function skillRowEnabled(row) {
  return rowEnabledState(row, true);
}

export function skillsRowsToMapAndStatuses(rows) {
  const map = {};
  const statuses = {};
  (Array.isArray(rows) ? rows : []).forEach((r) => {
    if (!r || typeof r !== 'object') return;
    const key = String(r.key ?? r.id ?? '').trim().replace(/\.md$/i, '');
    const content = String(r.content ?? r.value ?? r.body ?? '');
    if (key && content) {
      map[key] = content;
      statuses[key] = skillRowStatus(r);
    }
  });
  return { map, statuses };
}

/**
 * Load all skill .md files from /.da/skills/ and return them as { id → markdown } map.
 * Merges with config sheet: .md body wins, config status wins.
 */
async function loadSkillsFromMdFiles(org, site) {
  const cacheKey = siteKey(org, site);
  const cached = getCached(skillMdCache, cacheKey);
  if (cached) return cached;
  const inflight = inflightSkillMd.get(cacheKey);
  if (inflight) return inflight;

  const folder = `/${org}/${site}/.da/skills`;
  const promise = (async () => {
    try {
      const resp = await daFetch(`${DA_ORIGIN}/list${folder}`);
      if (!resp.ok) return {};
      const payload = await resp.json();
      const items = Array.isArray(payload) ? payload : (payload?.items ?? []);
      const out = {};
      await Promise.all(items.map(async (item) => {
        const ext = String(item?.ext || '').trim().toLowerCase();
        const name = String(item?.name || '').trim();
        if (!name) return;
        if (ext !== 'md' && !name.toLowerCase().endsWith('.md')) return;
        const pathStr = typeof item?.path === 'string' ? item.path.trim() : '';
        let filename;
        if (pathStr) {
          filename = pathStr.split('/').pop();
        } else if (ext === 'md') {
          filename = `${name}.md`;
        } else {
          filename = name;
        }
        const fileKey = filename.replace(/\.md$/i, '').trim();
        if (!fileKey) return;
        const srcPath = pathStr || `${folder}/${filename}`;
        try {
          const r = await daFetch(`${DA_ORIGIN}/source${srcPath}`);
          if (!r.ok) return;
          const text = await r.text();
          if (text) out[fileKey] = text;
        } catch { /* skip */ }
      }));
      setCached(skillMdCache, cacheKey, out);
      return out;
    } catch {
      return {};
    } finally {
      inflightSkillMd.delete(cacheKey);
    }
  })();
  inflightSkillMd.set(cacheKey, promise);
  return promise;
}

export async function mergeSkillsWithMdFiles(sheetRows, org, site) {
  const fileMap = await loadSkillsFromMdFiles(org, site);
  const { map: cfgMap, statuses: cfgStatuses } = skillsRowsToMapAndStatuses(sheetRows || []);
  // .md body wins over config body; config status wins
  const mergedMap = { ...cfgMap, ...fileMap };
  const mergedStatuses = { ...cfgStatuses };
  Object.keys(fileMap).forEach((k) => {
    if (!mergedStatuses[k]) mergedStatuses[k] = 'approved';
  });
  return { map: mergedMap, statuses: mergedStatuses };
}

export async function loadSkillsWithStatuses(org, site, loadedConfig = null, options = {}) {
  const loaded = loadedConfig || await fetchDaConfigSheets(org, site);
  if (!loaded.ok || !loaded.json) return { map: {}, statuses: {} };
  if (options.includeMdFiles === false) {
    return skillsRowsToMapAndStatuses(loaded.json[SKILLS_SHEET]?.data);
  }
  return mergeSkillsWithMdFiles(loaded.json[SKILLS_SHEET]?.data, org, site);
}

// ─── AO skills catalog (read-only id list — replaces the config-sheet list) ─
// Mirrors chat-controller-ao.js's _fetchSkillsFromApi()/parseSkillsListResponse()
// in da-nx: GET /api/v1/skills?manifest_id=experience-workspace, IMS bearer +
// x-tenant-id (IMS Org ID, not the DA org slug). Content/status still come from
// DA (config sheet + .da/skills/*.md) — AO only tells us which ids to show.

const AO_HTTP_BASE = {
  prod: 'https://agent-orchestrator-prod-va7.adobe.io',
  stage: 'https://agent-orchestrator-stage-va7.adobe.io',
};

// CMA "claudebridge" REST plane — used instead of AO when the site config flag
// `ew.altHarness` is true (see setSkillsBackend below). Bridge skills endpoints
// are keyed by Managed Agents skill_id and always require x-user-id.
const BRIDGE_HTTP_BASE = 'https://aem-sites-claudebridge-va6.adobe.io';

const AO_MANIFEST_ID = 'experience-workspace';

// Module-level backend switch, set once by nx-skills-editor.js after it reads
// the `ew.altHarness` site-config flag (mirrors da-nx's ewFlags.js pattern:
// flags['ew.*'] === 'true'). Defaults to AO so every existing caller that
// never calls this keeps behaving exactly as before.
let altHarnessEnabled = false;

export function setSkillsBackend({ altHarness } = {}) {
  altHarnessEnabled = altHarness === true;
}

// True on the CMA/claudebridge (altHarness) path; false on AO-direct/da-agent.
export function isSkillsBackendAltHarness() {
  return altHarnessEnabled;
}

function aoEnv() {
  const { hostname } = window.location;
  if (hostname.endsWith('.aem.live')) return 'prod';
  if (!['--', 'local'].some((check) => hostname.includes(check))) return 'prod';
  return 'stage';
}

// ims.js's own tenantId is a human-readable label, not the "ORGID@AdobeOrg" shape
// AO's x-tenant-id expects — pull that from owningEntity instead, same as da-nx.
function getImsOrgId(projectedProductContext) {
  return projectedProductContext?.find((p) => p.prodCtx?.owningEntity)?.prodCtx.owningEntity;
}

function parseAoSkillsResponse(json) {
  const skills = Array.isArray(json?.skills) ? json.skills : null;
  if (!skills) return null;
  return skills
    .filter((s) => !s?.hidden && s?.user_invocable !== false)
    .map((s) => ({
      id: String(s?.name || '').trim(),
      skillId: s?.id,
      scope: s?.scope,
      description: String(s?.description || '').trim(),
      displayName: String(s?.display_name || '').trim(),
      lineCount: Number.isFinite(s?.lineCount) ? s.lineCount : 0,
    }))
    .filter((s) => /^[a-z0-9][a-z0-9_-]{1,60}$/i.test(s.id));
}

async function aoAuthContext() {
  const token = await waitForImsToken();
  if (!token) return null;
  const profile = await window.adobeIMS?.getProfile();
  return {
    token,
    orgId: getImsOrgId(profile?.projectedProductContext),
    userId: profile?.userId,
    bridge: altHarnessEnabled,
    base: altHarnessEnabled
      ? BRIDGE_HTTP_BASE
      : (AO_HTTP_BASE[aoEnv()] || AO_HTTP_BASE.stage),
  };
}

export async function fetchSkillsFromAo() {
  const ctx = await aoAuthContext();
  if (!ctx) return null;
  try {
    const headers = {
      authorization: `Bearer ${ctx.token}`,
      'x-tenant-id': ctx.orgId,
    };
    if (ctx.bridge) headers['x-user-id'] = ctx.userId || '';
    const resp = await fetch(`${ctx.base}/api/v1/skills?manifest_id=${AO_MANIFEST_ID}`, { headers });
    if (!resp.ok) return null;
    return parseAoSkillsResponse(await resp.json());
  } catch {
    return null;
  }
}

/**
 * The CMA agent's real MCP servers (+ org/user overrides), for the MCPs tab's
 * "Connected" list on the altHarness/bridge path. Without this the tab renders
 * a hardcoded preset list (da-tools/eds-preview) that doesn't reflect what the
 * agent actually runs. Returns null off-bridge or on any failure, so the caller
 * keeps its built-in default and the AO path is unchanged.
 */
export async function fetchMcpServersFromBridge() {
  const ctx = await aoAuthContext();
  if (!ctx || !ctx.bridge) return null;
  try {
    const resp = await fetch(`${ctx.base}/api/v1/mcp-servers`, {
      headers: {
        authorization: `Bearer ${ctx.token}`,
        'x-tenant-id': ctx.orgId,
        'x-user-id': ctx.userId || '',
      },
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    const toCard = (s, scope) => {
      const id = s.name || s.key || s.url;
      if (!id) return null;
      return {
        id,
        // Carry the override entry's key + url explicitly so the UI can edit/
        // delete user/org-scope servers (deleteMcpServer is keyed by `key`).
        key: s.key || s.name || id,
        url: s.url || s.value || '',
        description: s.url || s.value || scope,
        transport: 'built-in',
        scope,
        // Carry the agent group's resolved tools through (overrides.ts
        // getAgentMcpServersWithTools) instead of dropping them, so the MCP
        // card can list them on the CMA/bridge path. NOTE: these are the
        // bridge's already-resolved tools, not a live tools/list probe against
        // the server URL — the card renders them directly.
        tools: Array.isArray(s.tools) ? s.tools : [],
      };
    };
    // Dedupe by server URL across agent/org/user (agent wins) — the same server
    // configured on the agent AND in an org/user override would otherwise show
    // twice (e.g. AEM MCP listed twice).
    const tagged = [
      ...(json.agent || []).map((s) => [s, 'agent']),
      ...(json.org || []).map((s) => [s, 'org']),
      ...(json.user || []).map((s) => [s, 'user']),
    ];
    const seen = new Set();
    const cards = [];
    for (const [s, scope] of tagged) {
      const key = String(s.url || s.value || s.name || s.key || '').toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const card = toCard(s, scope);
      if (card) cards.push(card);
    }
    return cards;
  } catch {
    return null;
  }
}

/**
 * Reads a file out of a skill's directory via AO — mirrors Coworker's own
 * "view SKILL.md" call (GET /api/v1/skills/{skill_name}/files?path=...&manifest_id=...),
 * confirmed against aep-ai's read_skill_file handler. Returns the raw file
 * text (frontmatter included) or null on any failure.
 */
// Resolves a skill name to its Managed Agents skill_id via the bridge catalog,
// used when a caller doesn't already have the id handed to it.
async function resolveBridgeSkillId(skillName) {
  const skills = await fetchSkillsFromAo();
  return skills?.find((s) => s.id === skillName)?.skillId || null;
}

function base64ToText(base64) {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Like fetchSkillFileFromAo but distinguishes a service/transport failure from a
 * genuinely empty/absent file, so the viewer can show an honest message:
 *   { content: '...', error: false } -> loaded
 *   { content: null,  error: false } -> request succeeded, no such file / empty
 *   { content: null,  error: true  } -> request failed (HTTP error / network / unauth)
 */
export async function fetchSkillFileResultFromAo(skillName, path = 'SKILL.md', skillId = null) {
  const ctx = await aoAuthContext();
  if (!ctx) return { content: null, error: true };
  try {
    if (ctx.bridge) {
      const id = skillId || await resolveBridgeSkillId(skillName);
      if (!id) return { content: null, error: true };
      const resp = await fetch(`${ctx.base}/api/v1/skills/${encodeURIComponent(id)}`, {
        headers: {
          authorization: `Bearer ${ctx.token}`,
          'x-tenant-id': ctx.orgId,
          'x-user-id': ctx.userId || '',
        },
      });
      if (!resp.ok) return { content: null, error: true };
      const json = await resp.json();
      const files = Array.isArray(json?.files) ? json.files : [];
      const file = files.find((f) => String(f?.path || '').split('/').pop() === path);
      if (!file || typeof file.content !== 'string') return { content: null, error: false };
      return { content: base64ToText(file.content), error: false };
    }
    const url = `${ctx.base}/api/v1/skills/${encodeURIComponent(skillName)}/files`
      + `?path=${encodeURIComponent(path)}&manifest_id=${AO_MANIFEST_ID}`;
    const resp = await fetch(url, {
      headers: {
        authorization: `Bearer ${ctx.token}`,
        'x-tenant-id': ctx.orgId,
      },
    });
    if (!resp.ok) return { content: null, error: true };
    const json = await resp.json();
    return typeof json?.content === 'string'
      ? { content: json.content, error: false }
      : { content: null, error: false };
  } catch {
    return { content: null, error: true };
  }
}

export async function fetchSkillFileFromAo(skillName, path = 'SKILL.md', skillId = null) {
  const { content } = await fetchSkillFileResultFromAo(skillName, path, skillId);
  return content;
}

/**
 * Uploads a SKILL.md file as a new personal skill via AO's presigned-upload
 * flow — mirrors aep-ai's reference web client (services/web/lib/upload-presigned.ts
 * uploadToPresignedUrl with category: "skill"): initiate (POST /api/v1/files/upload),
 * PUT the raw bytes to the returned presigned URL, then finalize
 * (POST /api/v1/files/{file_id}/finalize?manifest_id=...), which installs the
 * skill server-side. A 409 with needs_confirmation means a skill of that name
 * already exists for this user (not auto-overwritten here).
 */
// TODO: org-scope create needs an admin-gated scope selector in the UI; defaults to owner.
export async function uploadSkillFileToAo(file, scope = 'owner') {
  const ctx = await aoAuthContext();
  if (!ctx) return { ok: false, error: 'Not signed in' };

  if (ctx.bridge) {
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      // Display title comes from the skill's frontmatter `name`, NOT the
      // filename — a bare SKILL.md would otherwise surface as "SKILL" on the
      // card. Fall back to omitting it (bridge then uses the parsed name).
      let displayTitle = '';
      try {
        displayTitle = String(parseFrontmatter(await file.text())?.fields?.name || '').trim();
      } catch { /* no readable frontmatter — let the bridge derive the name */ }
      if (displayTitle) form.append('display_title', displayTitle);
      if (scope === 'org') form.append('scope', 'org');
      const resp = await fetch(`${ctx.base}/api/v1/skills`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${ctx.token}`,
          'x-tenant-id': ctx.orgId,
          'x-user-id': ctx.userId || '',
        },
        body: form,
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        if (resp.status === 409) {
          return { ok: false, error: body?.detail || `A skill named "${file.name}" already exists.` };
        }
        return { ok: false, error: body?.detail || `Upload failed (${resp.status})` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err?.message ?? err) };
    }
  }

  try {
    const initResp = await fetch(`${ctx.base}/api/v1/files/upload`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ctx.token}`,
        'x-tenant-id': ctx.orgId,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        filename: file.name,
        content_type: file.type || 'text/markdown',
        scope: 'user',
        category: 'skill',
        item_name: file.name.replace(/\.md$/i, ''),
      }),
    });
    if (!initResp.ok) return { ok: false, error: `Upload failed (${initResp.status})` };
    const { upload_url: uploadUrl, file_id: fileId } = await initResp.json();
    if (!uploadUrl || !fileId) return { ok: false, error: 'Upload service returned an invalid response' };

    const putResp = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'content-type': file.type || 'text/markdown',
        ...(uploadUrl.includes('.blob.core.windows.net') ? { 'x-ms-blob-type': 'BlockBlob' } : {}),
      },
      body: file,
    });
    if (!putResp.ok) return { ok: false, error: `Storage upload failed (${putResp.status})` };

    const finalizeResp = await fetch(
      `${ctx.base}/api/v1/files/${fileId}/finalize?manifest_id=${AO_MANIFEST_ID}`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${ctx.token}`,
          'x-tenant-id': ctx.orgId,
        },
      },
    );
    if (!finalizeResp.ok) {
      const body = await finalizeResp.json().catch(() => ({}));
      if (finalizeResp.status === 409 && body?.needs_confirmation) {
        return { ok: false, error: `A skill named "${body.skill_name || file.name}" already exists.` };
      }
      return { ok: false, error: body?.detail || `Finalize failed (${finalizeResp.status})` };
    }
    const finalizeData = await finalizeResp.json();
    if (finalizeData?.skill_registration_ok === false) {
      return { ok: false, error: finalizeData.detail || 'Skill could not be registered.' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

/**
 * Deletes a personal ("owner"-scope) skill by rewriting the user's `skills`
 * override settings with that skill's entry removed from `sources` — mirrors
 * aep-ai's reference web client (services/web/hooks/use-skill-sources.ts
 * removeSource + use-user-overrides.ts setSetting): GET /api/v1/overrides/user
 * to read the current sources array, then PUT
 * /api/v1/overrides/user/settings/skills with { value: { ...skills, sources } }
 * minus the deleted entry. Unlike the dedicated .../skills/{name}/disable
 * route (which only hides a skill by adding it to disabled_skills, leaving
 * the source in place), this actually removes the personal skill's source
 * entry — the real "delete", confirmed against Coworker's own network calls.
 */
export async function removePersonalSkillSource(id, skillId = null) {
  const ctx = await aoAuthContext();
  if (!ctx) return { ok: false, error: 'Not signed in' };

  if (ctx.bridge) {
    try {
      const bridgeId = skillId || await resolveBridgeSkillId(id);
      if (!bridgeId) return { ok: false, error: 'Skill not found' };
      const resp = await fetch(`${ctx.base}/api/v1/skills/${encodeURIComponent(bridgeId)}`, {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${ctx.token}`,
          'x-tenant-id': ctx.orgId,
          'x-user-id': ctx.userId || '',
        },
      });
      if (!resp.ok) return { ok: false, error: `Delete failed (${resp.status})` };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err?.message ?? err) };
    }
  }

  const headers = {
    authorization: `Bearer ${ctx.token}`,
    'x-tenant-id': ctx.orgId,
    'x-user-id': ctx.userId || '',
  };
  try {
    const getResp = await fetch(`${ctx.base}/api/v1/overrides/user`, { headers });
    if (!getResp.ok) return { ok: false, error: `Could not load overrides (${getResp.status})` };
    const overrides = await getResp.json();
    const skills = overrides?.settings?.skills || {};
    const sources = Array.isArray(skills.sources)
      ? skills.sources.filter((s) => s?.name !== id)
      : [];

    const putResp = await fetch(`${ctx.base}/api/v1/overrides/user/settings/skills`, {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ value: { ...skills, sources } }),
    });
    if (!putResp.ok) return { ok: false, error: `Delete failed (${putResp.status})` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

/**
 * Saves an edited skill body as a new Managed Agents version via the bridge
 * (PUT /api/v1/skills/:skillId, multipart SKILL.md). CMA/bridge only — the
 * AO-direct/da-agent edit path stays on the config sheet. `skillId` is the
 * Managed Agents id (this._skillIds[name]); the bridge reuses the skill's
 * existing directory prefix, so a bare SKILL.md upload is correct.
 */
export async function updateSkillOnAo(skillId, body, displayTitle) {
  const ctx = await aoAuthContext();
  if (!ctx) return { ok: false, error: 'Not signed in' };
  if (!ctx.bridge) return { ok: false, error: 'Editing is only supported on the CMA harness' };
  if (!skillId) return { ok: false, error: 'Skill not found' };
  try {
    const form = new FormData();
    const file = new File([body], 'SKILL.md', { type: 'text/markdown' });
    form.append('file', file, 'SKILL.md');
    if (displayTitle) form.append('display_title', displayTitle);
    const resp = await fetch(`${ctx.base}/api/v1/skills/${encodeURIComponent(skillId)}`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${ctx.token}`,
        'x-tenant-id': ctx.orgId,
        'x-user-id': ctx.userId || '',
      },
      body: form,
    });
    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      return { ok: false, error: errBody?.error || errBody?.detail || `Save failed (${resp.status})` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

/**
 * Extends loadSkillsWithStatuses' { map, statuses } shape with AO-only fields:
 * `scopes` ("owner" | "application" | ... — identifies personal skills),
 * `descriptions`, `displayNames`, and `lineCounts`. The id list comes from
 * AO's catalog; falls back to the plain DA-only shape (empty AO fields) if AO
 * is unreachable. Content/status still come from the config sheet only — no
 * .da/skills/*.md reads.
 */
export async function loadSkillsFromAo(org, site, loadedConfig = null) {
  const [aoSkills, daResult] = await Promise.all([
    fetchSkillsFromAo(),
    loadSkillsWithStatuses(org, site, loadedConfig, { includeMdFiles: false }),
  ]);
  if (!aoSkills) {
    return {
      ...daResult, scopes: {}, descriptions: {}, displayNames: {}, lineCounts: {}, skillIds: {},
    };
  }

  const map = {};
  const statuses = {};
  const scopes = {};
  const descriptions = {};
  const displayNames = {};
  const lineCounts = {};
  const skillIds = {};
  aoSkills.forEach(({
    id, skillId, scope, description, displayName, lineCount,
  }) => {
    // Skip skills the user just deleted: the bridge catalog is eventually
    // consistent and may still return a freshly-removed skill for a short
    // window, which would make a successful delete look like it did nothing.
    if (isSkillRecentlyDeleted(id)) return;
    map[id] = daResult.map[id] || '';
    statuses[id] = daResult.statuses[id] || 'approved';
    scopes[id] = scope;
    descriptions[id] = description;
    displayNames[id] = displayName || id;
    lineCounts[id] = lineCount;
    if (skillId) skillIds[id] = skillId;
  });
  return {
    map, statuses, scopes, descriptions, displayNames, lineCounts, skillIds,
  };
}

export const AO_SCOPE_PERSONAL = 'owner';

function skillKeyMatch(id) {
  return (r) => normaliseRowKey(r) === id;
}

/**
 * Bidirectional sync between .da/skills/*.md files and the config `skills` sheet.
 *
 * 1. .md orphans (file exists, no config row) → back-fill config entry
 * 2. Config orphans (config row exists, no .md file) → write .md file
 *
 * This guarantees that every skill is visible to both the editor (reads .md)
 * and the agent/slash commands (reads config sheet).
 *
 * @returns {Promise<{ configBackfilled: string[], filesWritten: string[] }>}
 */
export async function syncOrphanSkillsToConfig(org, site) {
  const [fileMap, loaded] = await Promise.all([
    loadSkillsFromMdFiles(org, site),
    fetchDaConfigSheets(org, site),
  ]);
  if (!loaded.ok) return { configBackfilled: [], filesWritten: [] };

  const cfg = { ...(loaded.json || {}) };
  if (!cfg[SKILLS_SHEET]) cfg[SKILLS_SHEET] = { total: 0, limit: 1000, offset: 0, data: [] };
  const sheet = cfg[SKILLS_SHEET];
  const data = [...(sheet.data || [])];

  const configKeys = new Set(
    data.map((r) => String(r.key ?? r.id ?? '').trim().replace(/\.md$/i, '')),
  );
  const fileKeys = new Set(Object.keys(fileMap));

  // 1. .md files missing from config → add config rows (skip recently deleted)
  const configBackfilled = [...fileKeys].filter(
    (k) => k && !configKeys.has(k) && !isSkillRecentlyDeleted(k),
  );

  // 2. Config rows missing .md files → write files
  const configOnlyIds = [...configKeys].filter((k) => k && !fileKeys.has(k));
  const configOnlyRows = configOnlyIds.map((id) => {
    const row = data.find(
      (r) => String(r.key ?? r.id ?? '').trim().replace(/\.md$/i, '') === id,
    );
    return row ? { id, body: String(row.content ?? row.value ?? row.body ?? '') } : null;
  }).filter((e) => e && e.body.trim());

  // Back-fill config sheet
  if (configBackfilled.length) {
    configBackfilled.forEach((id) => {
      data.push({ key: id, content: fileMap[id], status: 'approved' });
    });
    cfg[SKILLS_SHEET] = { ...sheet, data, total: data.length };
    await saveDaConfig(org, site, cfg);
    invalidateConfigCache(org, site);
  }

  // Write missing .md files (fire-and-forget, don't block load)
  const filesWritten = [];
  await Promise.all(configOnlyRows.map(async ({ id, body }) => {
    // eslint-disable-next-line no-use-before-define
    const result = await writeSkillMdFile(org, site, id, body);
    if (result.ok) filesWritten.push(id);
  }));

  if (filesWritten.length) invalidateSkillMdCache(org, site);

  return { configBackfilled, filesWritten };
}

export async function upsertSkillInConfig(org, site, skillId, content, options = {}) {
  const id = String(skillId || '').trim().replace(/\.md$/i, '');
  if (!id) return { ok: false, error: 'Skill id required' };
  if (!isSafeId(id)) return { ok: false, error: 'Invalid skill id' };
  const nextStatus = options.status === 'draft' || options.status === 'approved'
    ? options.status : undefined;
  return upsertSheetRow(
    org,
    site,
    SKILLS_SHEET,
    skillKeyMatch(id),
    (prev) => ({
      ...prev,
      key: id,
      content,
      status: nextStatus ?? skillRowStatus(prev),
    }),
    'Skill',
  );
}

export async function deleteSkillFromConfig(org, site, skillId) {
  const id = String(skillId || '').trim().replace(/\.md$/i, '');
  if (!id) return { ok: false, error: 'Skill id required' };
  if (!isSafeId(id)) return { ok: false, error: 'Invalid skill id' };
  markSkillDeleted(id);
  return deleteSheetRow(org, site, SKILLS_SHEET, skillKeyMatch(id), 'Skill');
}

/** Write skill markdown to .da/skills/{id}.md via DA Admin source API. */
export async function writeSkillMdFile(org, site, skillId, markdown) {
  const id = String(skillId || '').trim().replace(/\.md$/i, '');
  if (!id) return { ok: false, error: 'Skill id required' };
  if (!isSafeId(id)) return { ok: false, error: 'Invalid skill id' };
  const path = `/${org}/${site}/.da/skills/${id}.md`;
  const blob = new Blob([markdown], { type: 'text/markdown' });
  const body = new FormData();
  body.append('data', blob, `${id}.md`);
  try {
    const resp = await daFetch(`${DA_ORIGIN}/source${path}`, { method: 'PUT', body });
    if (resp.ok) invalidateSkillMdCache(org, site);
    return { ok: resp.ok, status: resp.status };
  } catch {
    return { ok: false, error: 'Network error writing skill file' };
  }
}

/** Read skill markdown from .da/skills/{id}.md. */
export async function readSkillMdFile(org, site, skillId) {
  const id = String(skillId || '').trim().replace(/\.md$/i, '');
  if (!id || !isSafeId(id)) return { text: '' };
  const path = `/${org}/${site}/.da/skills/${id}.md`;
  try {
    const resp = await daFetch(`${DA_ORIGIN}/source${path}`);
    if (!resp.ok) return { text: '' };
    return { text: await resp.text() };
  } catch { return { text: '' }; }
}

/** Delete skill .md file from .da/skills/{id}.md. */
export async function deleteSkillMdFile(org, site, skillId) {
  const id = String(skillId || '').trim().replace(/\.md$/i, '');
  if (!id) return { ok: false, error: 'Skill id required' };
  if (!isSafeId(id)) return { ok: false, error: 'Invalid skill id' };
  const path = `/${org}/${site}/.da/skills/${id}.md`;
  try {
    const resp = await daFetch(`${DA_ORIGIN}/source${path}`, { method: 'DELETE' });
    // 404 means the file never existed — treat as success so callers don't error
    const ok = resp.ok || resp.status === 404;
    if (ok) invalidateSkillMdCache(org, site);
    return { ok, status: resp.status };
  } catch {
    return { ok: false, error: 'Network error deleting skill file' };
  }
}

// ─── prompts CRUD ───────────────────────────────────────────────────────────

const PROMPTS_SHEET = 'prompts';

export async function upsertPromptInConfig(org, site, row, options = {}) {
  const title = String(row.title || '').trim();
  const promptText = String(row.prompt || '').trim();
  if (!title || !promptText) return { ok: false, error: 'Title and prompt are required' };

  const matchTitle = String(options.originalTitle ?? title).trim();
  const nextStatus = options.status === 'draft' || options.status === 'approved'
    ? options.status : undefined;

  return upsertSheetRow(
    org,
    site,
    PROMPTS_SHEET,
    (r) => String(r.title ?? '').trim() === matchTitle,
    (prev) => ({
      ...prev,
      title,
      prompt: promptText,
      category: row.category !== undefined ? row.category : (prev.category ?? ''),
      icon: row.icon !== undefined ? row.icon : (prev.icon ?? ''),
      status: nextStatus ?? skillRowStatus(prev),
    }),
    'Prompt',
  );
}

export async function deletePromptFromConfig(org, site, title) {
  const titleStr = String(title || '').trim();
  if (!titleStr) return { ok: false, error: 'Title required' };
  return deleteSheetRow(
    org,
    site,
    PROMPTS_SHEET,
    (r) => String(r.title ?? '').trim() === titleStr,
    'Prompt',
  );
}

// ─── tool overrides ─────────────────────────────────────────────────────────

export async function setToolOverride(org, site, serverId, toolName, enabled) {
  const key = `${serverId}/${toolName}`;
  return upsertSheetRow(
    org,
    site,
    TOOL_OVERRIDES_SHEET,
    (r) => String(r.key || '').trim() === key,
    (prev) => ({ ...prev, key, server: serverId, tool: toolName, enabled: !!enabled }),
    'Tool override',
  );
}

export async function deleteToolOverride(org, site, serverId, toolName) {
  const key = `${serverId}/${toolName}`;
  return deleteSheetRow(
    org,
    site,
    TOOL_OVERRIDES_SHEET,
    (r) => String(r.key || '').trim() === key,
    'Tool override',
  );
}

// ─── MCP header helpers ─────────────────────────────────────────────────────

const SENSITIVE_HEADER_RE = /^(authorization|x-api-key|x-auth|x-token|cookie|proxy-authorization|x-csrf|x-xsrf)/i;

/**
 * Return true when a header name is likely to carry a secret value
 * (auth tokens, API keys, cookies, CSRF tokens).
 */
export function isSensitiveHeaderName(name) {
  return SENSITIVE_HEADER_RE.test(String(name || '').trim());
}

/**
 * Read headers from a config row, supporting both the new `headers` array
 * and legacy `authHeaderName`/`authHeaderValue` single-pair columns.
 * @returns {Record<string, string>}
 */
function parseRowHeaders(row) {
  const out = {};
  if (Array.isArray(row?.headers)) {
    row.headers.forEach((h) => {
      const n = String(h?.name || '').trim();
      const v = String(h?.value || '').trim();
      if (n && v) out[n] = v;
    });
  }
  // Legacy single-header fallback (only if `headers` array didn't already cover it)
  const legacyName = String(row?.authHeaderName || '').trim();
  const legacyValue = String(row?.authHeaderValue || '').trim();
  if (legacyName && legacyValue && !(legacyName in out)) {
    out[legacyName] = legacyValue;
  }
  return out;
}

/**
 * Read headers from a config row as a `[{ name, value }]` array for the editor form.
 */
export function rowHeadersToArray(row) {
  const map = parseRowHeaders(row);
  return Object.entries(map).map(([name, value]) => ({ name, value }));
}

// ─── MCP servers ────────────────────────────────────────────────────────────

const MCP_SHEET = 'mcp-servers';

function mcpKeyMatch(serverKey) {
  return (r) => normaliseRowKey(r) === serverKey;
}

// ─── MCP servers on the CMA bridge (AO `overrides.settings.mcp_servers`) ─────
// On the alt harness, MCP servers live in the bridge's per-user overrides
// instead of the DA config sheet. Each entry keeps the same shape as an
// `mcp-servers` config row ({ key, url, description?, headers?, enabled? }) so
// the editor UI round-trips unchanged.
// TODO: org-scope MCP needs an admin-gated scope selector in the UI; personal only for now.
function bridgeHeaders(ctx) {
  return {
    authorization: `Bearer ${ctx.token}`,
    'x-tenant-id': ctx.orgId,
    'x-user-id': ctx.userId || '',
  };
}

async function bridgeGetMcpServers(ctx) {
  const resp = await fetch(`${ctx.base}/api/v1/overrides/user`, { headers: bridgeHeaders(ctx) });
  if (!resp.ok) throw new Error(`Could not load overrides (${resp.status})`);
  const json = await resp.json();
  const servers = json?.settings?.mcp_servers;
  return Array.isArray(servers) ? servers : [];
}

async function bridgePutMcpServers(ctx, servers) {
  const resp = await fetch(`${ctx.base}/api/v1/overrides/user/settings/mcp_servers`, {
    method: 'PUT',
    headers: { ...bridgeHeaders(ctx), 'content-type': 'application/json' },
    body: JSON.stringify({ value: servers }),
  });
  if (!resp.ok) throw new Error(`Save failed (${resp.status})`);
}

/**
 * Read-modify-write the bridge's personal `mcp_servers` array. `mutate(servers)`
 * returns the new array, or `{ error }` to abort without writing. The single
 * place register/enable-disable/delete share for the CMA path.
 */
async function bridgeMutateMcpServers(mutate) {
  const ctx = await aoAuthContext();
  if (!ctx) return { ok: false, error: 'Not signed in' };
  try {
    const next = mutate(await bridgeGetMcpServers(ctx));
    if (next && next.error) return { ok: false, error: next.error };
    await bridgePutMcpServers(ctx, next);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

export async function registerMcpServer(
  org,
  site,
  key,
  url,
  description = '',
  headers = [],
) {
  const serverKey = String(key || '').trim();
  const serverUrl = String(url || '').trim();
  if (!serverKey || !serverUrl) return { ok: false, error: 'Key and URL required' };
  const safeHeaders = (Array.isArray(headers) ? headers : [])
    .map((h) => ({
      name: String(h?.name || '').trim(),
      value: String(h?.value || '').trim(),
    }))
    .filter((h) => h.name && h.value);

  if (altHarnessEnabled) {
    return bridgeMutateMcpServers((servers) => {
      const entry = { key: serverKey, url: serverUrl };
      if (description) entry.description = String(description).trim();
      if (safeHeaders.length) entry.headers = safeHeaders;
      const idx = servers.findIndex((s) => s?.key === serverKey);
      const prevEnabled = idx >= 0 ? servers[idx]?.enabled : undefined;
      if (prevEnabled !== undefined) entry.enabled = prevEnabled;
      return idx >= 0 ? servers.map((s, i) => (i === idx ? entry : s)) : [...servers, entry];
    });
  }

  return upsertSheetRow(
    org,
    site,
    MCP_SHEET,
    mcpKeyMatch(serverKey),
    (prev) => {
      const row = { ...prev, key: serverKey, url: serverUrl };
      if (description) row.description = String(description).trim();
      if (safeHeaders.length) row.headers = safeHeaders;
      else delete row.headers;
      delete row.authHeaderName;
      delete row.authHeaderValue;
      return row;
    },
    'MCP server',
  );
}

export async function setMcpServerEnabled(org, site, key, enabled) {
  const serverKey = String(key || '').trim();
  if (!serverKey) return { ok: false, error: 'Server id required' };

  if (altHarnessEnabled) {
    return bridgeMutateMcpServers((servers) => {
      const idx = servers.findIndex((s) => s?.key === serverKey);
      if (idx < 0) return { error: 'Server not found' };
      return servers.map((s, i) => (i === idx ? { ...s, enabled: !!enabled } : s));
    });
  }

  const loaded = await fetchDaConfigSheets(org, site);
  if (!loaded.ok) return { ok: false, error: 'Could not load config' };

  const cfg = { ...(loaded.json || {}) };
  const sheet = cfg[MCP_SHEET];
  if (!sheet?.data?.length) return { ok: false, error: 'No MCP servers' };

  const data = [...sheet.data];
  const idx = data.findIndex(mcpKeyMatch(serverKey));
  if (idx < 0) return { ok: false, error: 'Server not found' };
  data[idx] = { ...data[idx], enabled: !!enabled };
  cfg[MCP_SHEET] = { ...sheet, data, total: data.length };

  const save = await saveDaConfig(org, site, cfg);
  return save.ok ? { ok: true } : { ok: false, error: `Save failed (${save.status})` };
}

export async function deleteMcpServer(org, site, key) {
  const serverKey = String(key || '').trim();
  if (!serverKey) return { ok: false, error: 'Key required' };

  if (altHarnessEnabled) {
    return bridgeMutateMcpServers((servers) => servers.filter((s) => s?.key !== serverKey));
  }

  return deleteSheetRow(org, site, MCP_SHEET, mcpKeyMatch(serverKey), 'MCP server');
}

export async function fetchMcpToolsFromAgent(servers, serverHeaders = {}) {
  if (!Object.keys(servers || {}).length) return { servers: [] };
  try {
    const payload = { servers, serverHeaders };
    const token = getToken();
    if (token) payload.imsToken = token;

    const resp = await fetch(`${getAgentOrigin()}/mcp-tools`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    return resp.ok ? resp.json() : null;
  } catch { return null; }
}

// ─── plugins (Claude marketplace, CMA bridge only) ──────────────────────────
// Issue aem-sites-claudebridge#163 made plugin installation do real work on
// the bridge: an enabled installed plugin's manifest `repository` is
// resolved and its skills/MCP servers are registered + composed into new
// sessions. Browsing/discovery (aem-sites-claudebridge#189's open question)
// is solved on the ew-extensions side only: one permanent, non-removable
// built-in source (the public `adobe/skills` marketplace, the same repo the
// bridge's own plugin resolver was verified against) plus any number of
// site-registered custom sources the user adds (stored in the `.da` config
// sheet below, same per-site storage as mcp-servers/agents - a shared/org
// concern, not a personal bridge override). AO has no plugin-install
// equivalent at all, so install/enable/disable/uninstall stay bridge-only,
// same posture as updateSkillOnAo; browsing the catalog itself has no such
// restriction.
export const BUILT_IN_MARKETPLACE_SOURCES = [
  { owner: 'adobe', repo: 'skills' },
];

const MARKETPLACE_SOURCES_SHEET = 'marketplace-sources';

function sourceKey({ owner, repo } = {}) {
  return `${String(owner || '').toLowerCase()}/${String(repo || '').toLowerCase()}`;
}

// GitHub owner/repo charset: letters, digits, hyphens (not leading/trailing
// for owners), dots/underscores allowed in repo names. Deliberately strict -
// this value is used to build a `raw.githubusercontent.com` URL path, so
// rejecting anything outside this charset (slashes, `..`, whitespace, etc.)
// rules out path traversal / request-smuggling via a pasted source string.
const GITHUB_OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const GITHUB_REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Parses a user-entered marketplace source - `owner/repo`, or a
 * `https://github.com/owner/repo` URL (optionally with a trailing `.git`,
 * `/`, or further path segments, which are ignored) - into `{ owner, repo }`.
 * Returns `null` for anything that doesn't resolve to a well-formed,
 * safe-charset owner/repo pair.
 */
export function parseMarketplaceSourceInput(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  let rest = raw;
  const urlMatch = raw.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)/i);
  if (urlMatch) {
    rest = `${urlMatch[1]}/${urlMatch[2]}`;
  }
  const parts = rest.replace(/\.git$/i, '').split('/').filter(Boolean);
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  if (!GITHUB_OWNER_RE.test(owner) || !GITHUB_REPO_RE.test(repo)) return null;
  return { owner, repo };
}

const MARKETPLACE_CATALOG_TTL_MS = 5 * 60 * 1000;
const marketplaceCatalogCache = new Map(); // `${owner}/${repo}` -> { entries, fetchedAt }

/**
 * Test-only: clears the in-memory marketplace catalog cache so each test can
 * control whether fetchMarketplaceCatalog re-fetches.
 */
export function __resetMarketplaceCatalogCacheForTests() {
  marketplaceCatalogCache.clear();
}

// Default branches to try, in order, when fetching a public repo file from
// raw.githubusercontent.com (which requires an explicit branch - there's no
// "default branch" alias). `main` then `master` covers essentially all repos
// without an api.github.com call (which is rate-limited to 60/hr anonymous).
// A 404 on one candidate falls through to the next; any other failure
// (network/timeout/non-404) gives up so we don't hammer. Repos whose default
// branch is neither (rare: trunk/develop/...) won't resolve - acceptable for
// a browse-only catalog read; the bridge's own install path resolves the real
// default branch via the Contents API independently.
const GITHUB_DEFAULT_BRANCHES = ['main', 'master'];

async function fetchPublicGithubJson(owner, repo, path) {
  for (const branch of GITHUB_DEFAULT_BRANCHES) {
    let resp;
    try {
      // eslint-disable-next-line no-await-in-loop
      resp = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`, {
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return null; // network/timeout - don't try further candidates
    }
    if (resp.ok) {
      try {
        // eslint-disable-next-line no-await-in-loop
        return await resp.json();
      } catch {
        return null; // reachable but not valid JSON - a real error, not a wrong-branch miss
      }
    }
    if (resp.status !== 404) return null; // non-404 (403/5xx) - give up, don't hammer
    // 404: this branch doesn't have the file; try the next candidate branch
  }
  return null;
}

/**
 * The browsable plugin catalog: every entry in each configured marketplace
 * source's `.claude-plugin/marketplace.json`, normalized to the manifest
 * shape `PUT .../settings/plugins` expects (`{ name, description, version,
 * author, repository, license, keywords }` - see
 * docs/claudebridge-skills-spec.md section 9.3 in aem-sites-claudebridge).
 * In-memory cached per source for MARKETPLACE_CATALOG_TTL_MS so switching
 * tabs doesn't re-fetch every time. Never throws; `hadError` is true if any
 * configured source failed to load (network/parse failure), so the caller
 * can tell that apart from a source that's just legitimately empty.
 *
 * `sources` defaults to just the built-in source; callers that also want the
 * caller's registered custom sources should pass
 * `[...BUILT_IN_MARKETPLACE_SOURCES, ...customSources]` (see
 * `loadMarketplaceSources`). A plugin `name` that appears in more than one
 * source keeps its first (built-in-first, then registration order) entry -
 * a later duplicate never silently shadows/overwrites an earlier source's
 * manifest for the same name.
 */
export async function fetchMarketplaceCatalog(sources = BUILT_IN_MARKETPLACE_SOURCES) {
  const entries = [];
  const seenNames = new Set();
  let hadError = false;
  await Promise.all(sources.map(async ({ owner, repo }) => {
    const cacheKey = sourceKey({ owner, repo });
    const builtIn = BUILT_IN_MARKETPLACE_SOURCES.some((s) => sourceKey(s) === cacheKey);
    let sourceEntries = marketplaceCatalogCache.get(cacheKey);
    if (sourceEntries && Date.now() - sourceEntries.fetchedAt < MARKETPLACE_CATALOG_TTL_MS) {
      sourceEntries = sourceEntries.entries;
    } else {
      const marketplace = await fetchPublicGithubJson(owner, repo, '.claude-plugin/marketplace.json');
      if (marketplace == null) {
        hadError = true;
        return;
      }
      const plugins = Array.isArray(marketplace?.plugins) ? marketplace.plugins : [];
      sourceEntries = plugins
        .filter((p) => p && typeof p.name === 'string' && p.name.trim())
        .map((p) => ({
          name: p.name,
          description: p.description || '',
          version: p.version,
          author: p.author,
          repository: p.repository || `https://github.com/${owner}/${repo}`,
          license: p.license,
          keywords: Array.isArray(p.keywords) ? p.keywords : [],
          sourceOwner: owner,
          sourceRepo: repo,
          builtIn,
        }));
      marketplaceCatalogCache.set(cacheKey, { entries: sourceEntries, fetchedAt: Date.now() });
    }
    sourceEntries.forEach((entry) => {
      if (seenNames.has(entry.name)) return;
      seenNames.add(entry.name);
      entries.push(entry);
    });
  }));
  return { entries, hadError };
}

// Authorization for managing marketplace sources is DA's own CONFIG ACL, the
// authoritative, SERVER-ENFORCED gate - not a re-derived client-side role.
// The `marketplace-sources` sheet is written via `POST /config/{org}/{site}/`
// (saveDaConfig above); da-admin's config route gates that write behind the
// `CONFIG` ACL keyword and returns 403 to anyone without config-write
// (da-admin src/routes/config.js + src/utils/auth.js - note: a content-write
// grant does NOT implicitly unlock config-write; it must target the CONFIG
// keyword explicitly). So the real enforcement already exists at the API; a
// direct config POST by a non-authorized caller is refused regardless of the
// UI. `canWriteConfig` below just reads the SAME permission DA already
// computed - exposed on the `x-da-actions` response header (same mechanism as
// fetchSkillsPermission) - so the client can hide controls that would 403.
//
// Hard-gate rule (workspace convention): whenever a DA-stored resource needs
// a hard authorization gate, the gate is DA config-write permission, not an
// IMS role, product entitlement, or bridge check. It's server-enforced by
// da-admin's CONFIG ACL and surfaced to clients via `x-da-actions`.
//
// NOTE: this is a GET, not a HEAD. da-admin only serves HEAD for `/source`,
// `/list`, etc. (src/handlers/head.js) - NOT for `/config`, which 404s on
// HEAD. A GET `/config/{org}/{site}/` is handled (getConfig) and its response
// carries the `X-da-actions` header reflecting CONFIG-ACL permissions
// (daResp.js sets it whenever an aclCtx is present and status < 500). So we
// read the caller's config-write grant off that header. (fetchSkillsPermission
// above HEADs `/source` because /source DOES have a HEAD handler - the method
// is per-API, don't copy it blindly.)
//
// Unlike fetchSkillsPermission (which fails OPEN/optimistic for a soft
// write-affordance hint), this is a security gate, so it fails CLOSED: any
// non-2xx, missing header, or error resolves to `false` (not authorized).
export async function canWriteConfig(org, site) {
  try {
    const resp = await daFetch(`${DA_ORIGIN}/config/${org}/${site}/`);
    if (!resp.ok) return false;
    const actions = resp.headers?.get('x-da-actions') || '';
    return parseActionsHasWrite(actions);
  } catch {
    return false;
  }
}

/**
 * Registered marketplace sources for a site: the permanent built-in source
 * plus whatever the user has added, read from the `marketplace-sources` `.da`
 * config sheet (a shared/site-level concern - same storage class as
 * `mcp-servers`/`agents` - independent of the personal, bridge-only
 * install/enable/disable state above). Best-effort: an unreachable config
 * degrades to just the built-in source rather than breaking the tab.
 */
export async function loadMarketplaceSources(org, site) {
  const loaded = await fetchDaConfigSheets(org, site);
  if (!loaded.ok) return [];
  const rows = loaded.json?.[MARKETPLACE_SOURCES_SHEET]?.data;
  if (!Array.isArray(rows)) return [];
  const seen = new Set();
  const sources = [];
  rows.forEach((row) => {
    const parsed = parseMarketplaceSourceInput(row?.source);
    if (!parsed) return;
    const key = sourceKey(parsed);
    if (seen.has(key)) return;
    seen.add(key);
    sources.push(parsed);
  });
  return sources;
}

/**
 * Registers a new marketplace source for the site (GitHub `owner/repo` or a
 * `github.com` URL). Rejects anything that doesn't parse to a well-formed
 * owner/repo (`parseMarketplaceSourceInput`), the built-in source, or one
 * already registered (case-insensitive) - all before writing, so the sheet
 * never accumulates unreachable or duplicate rows. Does not validate that
 * the repo actually has a `.claude-plugin/marketplace.json`; that surfaces
 * as this source's `hadError`/empty-catalog state on the next fetch, same as
 * the built-in source's own failure mode, rather than blocking registration
 * on a synchronous network round trip.
 *
 * Config-write gated (`canWriteConfig`, DA's server-enforced CONFIG ACL) -
 * checked here too, not just by the UI hiding the Add form, so any other
 * caller of this exported function gets the same gate. (The write itself is
 * also refused server-side by da-admin with a 403 if the caller lacks
 * config-write, so this is the fail-fast, not the enforcement boundary.)
 */
export async function addMarketplaceSource(org, site, input) {
  if (!(await canWriteConfig(org, site))) {
    return { ok: false, error: 'You need config-write access to register marketplace sources' };
  }
  const parsed = parseMarketplaceSourceInput(input);
  if (!parsed) {
    return { ok: false, error: 'Enter a GitHub repo as owner/repo or a github.com URL' };
  }
  const key = sourceKey(parsed);
  const label = `${parsed.owner}/${parsed.repo}`;
  if (BUILT_IN_MARKETPLACE_SOURCES.some((s) => sourceKey(s) === key)) {
    return { ok: false, error: `${label} is already built in` };
  }
  const loaded = await fetchDaConfigSheets(org, site, { force: true });
  if (!loaded.ok) return { ok: false, error: loaded.error || `Could not load config (${loaded.status})` };
  const cfg = { ...(loaded.json || {}) };
  const sheet = cfg[MARKETPLACE_SOURCES_SHEET] || { total: 0, limit: 1000, offset: 0, data: [] };
  const data = [...(sheet.data || [])];
  const alreadyRegistered = data.some((row) => {
    const existing = parseMarketplaceSourceInput(row?.source);
    return existing && sourceKey(existing) === key;
  });
  if (alreadyRegistered) {
    return { ok: false, error: `${label} is already registered` };
  }
  data.push({ source: label });
  cfg[MARKETPLACE_SOURCES_SHEET] = { ...sheet, data, total: data.length };
  const save = await saveDaConfig(org, site, cfg);
  if (!save.ok) return { ok: false, error: `Save failed (${save.status})` };
  return { ok: true };
}

/**
 * Unregisters a custom marketplace source. The built-in source can't be
 * removed through this path (no matching row exists for it in the sheet);
 * removing a source only stops it being browsed going forward - it does not
 * touch any plugin already installed from it (installPlugin's record is
 * keyed by the plugin's own `ref`/`repository`, not by source). Config-write
 * gated, same as addMarketplaceSource.
 */
export async function removeMarketplaceSource(org, site, owner, repo) {
  if (!(await canWriteConfig(org, site))) {
    return { ok: false, error: 'You need config-write access to manage marketplace sources' };
  }
  const key = sourceKey({ owner, repo });
  return deleteSheetRow(
    org,
    site,
    MARKETPLACE_SOURCES_SHEET,
    (row) => {
      const parsed = parseMarketplaceSourceInput(row?.source);
      return !!parsed && sourceKey(parsed) === key;
    },
    'marketplace source',
  );
}

function pluginRefMatches(ref) {
  return (r) => (r?.ref || r?.manifest?.name) === ref;
}

async function bridgeGetPlugins(ctx) {
  const resp = await fetch(`${ctx.base}/api/v1/overrides/user`, { headers: bridgeHeaders(ctx) });
  if (!resp.ok) throw new Error(`Could not load overrides (${resp.status})`);
  const json = await resp.json();
  const installed = json?.settings?.plugins?.installed;
  return Array.isArray(installed) ? installed : [];
}

async function bridgePutPlugins(ctx, installed) {
  const resp = await fetch(`${ctx.base}/api/v1/overrides/user/settings/plugins`, {
    method: 'PUT',
    headers: { ...bridgeHeaders(ctx), 'content-type': 'application/json' },
    body: JSON.stringify({ value: { installed } }),
  });
  if (!resp.ok) throw new Error(`Save failed (${resp.status})`);
  const json = await resp.json().catch(() => null);
  return Array.isArray(json?.settings?.plugins?.installed)
    ? json.settings.plugins.installed
    : installed;
}

/**
 * Loads the caller's personally-installed plugins. Bridge-only; returns `[]`
 * off-bridge (no AO equivalent) and on any failure (best-effort, same as
 * loadAgentPresets - an unreachable settings store degrades to an empty
 * list rather than breaking the tab).
 * TODO: org-scope install needs an admin-gated scope selector in the UI,
 * same deferred gap as registerMcpServer's org-scope TODO above; personal
 * only for now.
 */
export async function loadInstalledPlugins() {
  const ctx = await aoAuthContext();
  if (!ctx || !ctx.bridge) return [];
  try {
    return await bridgeGetPlugins(ctx);
  } catch {
    return [];
  }
}

/**
 * Installs a plugin from the marketplace catalog: appends `{ ref, manifest,
 * enabled: true }` to the caller's personal `settings.plugins.installed`, or
 * refreshes+re-enables an existing entry for the same ref (reinstall). The
 * bridge resolves/materializes the plugin's skills+MCP as part of this write
 * (aem-sites-claudebridge#163) - a resolution failure (bad/unreachable
 * repository) still returns `ok: true` here (the plugin IS installed, same
 * "record first, materialize best-effort" contract the bridge itself
 * follows) with no `resolved` block on its entry, which the catalog card
 * surfaces as "Installed (not yet available)" rather than silently looking
 * identical to a working install.
 */
export async function installPlugin(manifest) {
  const ctx = await aoAuthContext();
  if (!ctx) return { ok: false, error: 'Not signed in' };
  if (!ctx.bridge) return { ok: false, error: 'Plugins are only supported on the CMA harness' };
  const ref = String(manifest?.name || '').trim();
  if (!ref) return { ok: false, error: 'Plugin manifest has no name' };
  try {
    const current = await bridgeGetPlugins(ctx);
    const idx = current.findIndex(pluginRefMatches(ref));
    const entry = { ref, manifest, enabled: true };
    const next = idx >= 0
      ? current.map((r, i) => (i === idx ? { ...r, ...entry } : r))
      : [...current, entry];
    const installed = await bridgePutPlugins(ctx, next);
    return { ok: true, installed };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

export async function setPluginEnabled(ref, enabled) {
  const ctx = await aoAuthContext();
  if (!ctx) return { ok: false, error: 'Not signed in' };
  if (!ctx.bridge) return { ok: false, error: 'Plugins are only supported on the CMA harness' };
  try {
    const current = await bridgeGetPlugins(ctx);
    const idx = current.findIndex(pluginRefMatches(ref));
    if (idx < 0) return { ok: false, error: 'Plugin not installed' };
    const next = current.map((r, i) => (i === idx ? { ...r, enabled: !!enabled } : r));
    const installed = await bridgePutPlugins(ctx, next);
    return { ok: true, installed };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

export async function uninstallPlugin(ref) {
  const ctx = await aoAuthContext();
  if (!ctx) return { ok: false, error: 'Not signed in' };
  if (!ctx.bridge) return { ok: false, error: 'Plugins are only supported on the CMA harness' };
  try {
    const current = await bridgeGetPlugins(ctx);
    const next = current.filter((r) => !pluginRefMatches(ref)(r));
    const installed = await bridgePutPlugins(ctx, next);
    return { ok: true, installed };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

// ─── agent presets ──────────────────────────────────────────────────────────

const AGENTS_PATH = '.da/agents';

export async function loadAgentPresets(org, site) {
  const out = [];
  try {
    const listResp = await daFetch(`${DA_ORIGIN}/list/${org}/${site}/${AGENTS_PATH}`);
    if (!listResp.ok) return out;
    const json = await listResp.json().catch(() => null);
    if (!Array.isArray(json)) return out;
    const jsonFiles = json.filter((item) => item.ext === 'json' || (item.name || '').endsWith('.json'));
    await Promise.all(jsonFiles.map(async (item) => {
      const id = (item.name || '').replace(/\.json$/i, '');
      if (!id) return;
      try {
        const src = await daFetch(`${DA_ORIGIN}/source${item.path}`);
        if (!src.ok) return;
        const preset = JSON.parse(await src.text());
        if (preset && typeof preset === 'object') {
          out.push({
            id,
            preset,
            ...preset,
          });
        }
      } catch { /* skip */ }
    }));
  } catch { /* noop */ }
  return out;
}

export async function saveAgentPresetFile(org, site, agentId, preset) {
  const id = String(agentId || '').trim().replace(/\.json$/i, '');
  if (!id) return { ok: false, error: 'Agent id required' };
  if (!isSafeId(id)) return { ok: false, error: 'Invalid agent id' };
  const path = `/${org}/${site}/${AGENTS_PATH}/${id}.json`;
  const body = new FormData();
  body.append(
    'data',
    new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' }),
    `${id}.json`,
  );
  try {
    const resp = await daFetch(`${DA_ORIGIN}/source${path}`, { method: 'POST', body });
    return resp.ok ? { ok: true, status: resp.status } : { ok: false, error: `Save failed (${resp.status})` };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

export async function deleteAgentPresetFile(org, site, agentId) {
  const id = String(agentId || '').trim().replace(/\.json$/i, '');
  if (!id) return { ok: false, error: 'Agent id required' };
  if (!isSafeId(id)) return { ok: false, error: 'Invalid agent id' };
  const path = `/${org}/${site}/${AGENTS_PATH}/${id}.json`;
  try {
    const resp = await daFetch(`${DA_ORIGIN}/source${path}`, { method: 'DELETE' });
    const ok = resp.ok || resp.status === 404;
    return ok ? { ok: true } : { ok: false, error: `Delete failed (${resp.status})` };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

// ─── utilities ──────────────────────────────────────────────────────────────

export { extractToolRefs } from './utils/markdown.js';

/**
 * Parses an `x-da-actions` header value and returns whether `write` is granted.
 * Header format: `/path=perm1,perm2` (multiple entries may be whitespace/semicolon-separated).
 *
 * @param {string} actionsHeader
 * @returns {boolean}
 */
export function parseActionsHasWrite(actionsHeader) {
  return String(actionsHeader || '').split(/[\s;]+/).some((entry) => {
    const eqIdx = entry.indexOf('=');
    if (eqIdx === -1) return false;
    return entry.slice(eqIdx + 1).split(',').some((p) => p.trim() === 'write');
  });
}

/**
 * Returns true if the current user has write permission on the skills folder,
 * false only when the server returns a definitive x-da-actions header without write.
 * Defaults to true on missing header, non-2xx response, or network error.
 *
 * @param {string} org
 * @param {string} site
 * @returns {Promise<boolean>}
 */
export async function fetchSkillsPermission(org, site) {
  try {
    const resp = await daFetch(`${DA_ORIGIN}/source/${org}/${site}/.da/skills/`, { method: 'HEAD' });
    if (!resp.ok) return true; // non-2xx: optimistic, header won't be reliable
    const actions = resp.headers?.get('x-da-actions') || '';
    if (!actions) return true;
    return parseActionsHasWrite(actions);
  } catch {
    return true;
  }
}

/**
 * Fetch site source text by path under site (e.g. /drafts/page.html).
 * Used by the memory tab to load/display the agent memory file.
 */
export async function fetchSiteSourceText(org, site, pathUnderSite) {
  const p = String(pathUnderSite || '').replace(/^\//, '');
  if (!p) return { error: 'Path required' };
  if (!isSafeSubPath(p)) return { error: 'Invalid path' };
  try {
    const resp = await daFetch(`${DA_ORIGIN}/source/${org}/${site}/${p}`);
    if (resp.status === 404) return { text: '' };
    if (!resp.ok) return { error: `HTTP ${resp.status}` };
    return { text: await resp.text() };
  } catch (e) {
    return { error: String(e?.message ?? e) };
  }
}
