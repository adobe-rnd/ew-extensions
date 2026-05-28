/**
 * Utilities for parsing, validating, and injecting YAML frontmatter in skill
 * markdown files, following Anthropic's SKILL.md frontmatter requirements
 * extended with DA-specific `version` and `status` fields.
 *
 *   name:
 *     - required
 *     - max 64 characters
 *     - lowercase letters, numbers, and hyphens only
 *     - no XML tags
 *     - no reserved words: "anthropic", "claude"
 *     - must equal the skill's folder name
 *
 *   description:
 *     - required
 *     - non-empty
 *     - max 1024 characters
 *     - no XML tags
 *
 *   version:
 *     - required
 *     - positive integer (monotonic, bumped on every save)
 *
 *   status:
 *     - optional, defaults to "approved"
 *     - one of: "approved" | "draft"
 *     - skills with "draft" status are excluded from the agent manifest
 *
 *   Extra keys are preserved on round-trip but ignored by the index.
 */

const FM_OPEN = '---';
const FM_RESERVED_WORDS = ['anthropic', 'claude'];
const FM_XML_RE = /<[^>]+>/;
const FM_NAME_FORMAT_RE = /^[a-z0-9-]+$/;
const FM_NAME_MAX = 64;
const FM_DESC_MAX = 1024;

const STATUS_APPROVED = 'approved';
const STATUS_DRAFT = 'draft';
const VALID_STATUSES = new Set([STATUS_APPROVED, STATUS_DRAFT]);

/**
 * The four fields that participate in the in-memory skills index built by the
 * agent and the editor card list. Any other frontmatter keys round-trip but
 * are not surfaced through the index.
 */
export const INDEX_ENTRY_KEYS = Object.freeze(['name', 'description', 'version', 'status']);

/**
 * Parses the YAML frontmatter block from a markdown string.
 * Only handles flat key: value pairs (no nested YAML).
 *
 * @param {string} markdown
 * @returns {{ fields: Record<string, string>, body: string } | null}
 *   null when no frontmatter block is present.
 */
export function parseFrontmatter(markdown) {
  const src = markdown ?? '';
  if (!src.trimStart().startsWith(FM_OPEN)) return null;

  const after = src.trimStart().slice(FM_OPEN.length);
  const closeIdx = after.indexOf(`\n${FM_OPEN}`);
  if (closeIdx === -1) return null;

  const block = after.slice(0, closeIdx);
  const body = after.slice(closeIdx + FM_OPEN.length + 1).trimStart();

  const fields = {};
  block.split('\n').forEach((line) => {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) return;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key) fields[key] = value;
  });

  return { fields, body };
}

/**
 * Returns the body portion of a markdown string with any leading YAML
 * frontmatter block removed. If no frontmatter is present, returns the
 * original input unchanged.
 *
 * Used by the agent's lazy-load path so it spends tokens only on the body.
 *
 * @param {string} markdown
 * @returns {string}
 */
export function stripFrontmatter(markdown) {
  const parsed = parseFrontmatter(markdown);
  return parsed ? parsed.body : (markdown ?? '');
}

function parseIntStrict(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Parses just the four index fields from a markdown string's frontmatter,
 * applying lenient defaults so a partially-migrated skill still produces a
 * usable entry. Used by both the agent (to build the manifest) and the editor
 * (to render the card list) without ever touching the body.
 *
 * - `name` defaults to '' (caller decides whether to fall back to the folder ID).
 * - `description` defaults to ''.
 * - `version` defaults to 1 when missing or invalid.
 * - `status` defaults to 'approved' when missing or not in the allowed set.
 *
 * @param {string} markdown
 * @returns {{ name: string, description: string, version: number, status: 'approved'|'draft' }}
 */
export function parseSkillIndexEntry(markdown) {
  const parsed = parseFrontmatter(markdown);
  const f = parsed?.fields ?? {};
  const versionNum = parseIntStrict(f.version) ?? 1;
  const statusRaw = String(f.status ?? '').trim().toLowerCase();
  const status = VALID_STATUSES.has(statusRaw) ? statusRaw : STATUS_APPROVED;
  return {
    name: String(f.name ?? '').trim(),
    description: String(f.description ?? '').trim(),
    version: versionNum,
    status,
  };
}

/**
 * Validates the frontmatter fields against the skill contract.
 *
 * @param {Record<string, string>} fields - parsed frontmatter key-value pairs
 * @returns {string[]} array of human-readable error messages (empty = valid)
 */
export function validateSkillFrontmatter(fields) {
  const errors = [];
  const name = (fields.name ?? '').trim();
  const description = (fields.description ?? '').trim();
  const versionRaw = fields.version;
  const statusRaw = String(fields.status ?? '').trim().toLowerCase();

  if (!name) {
    errors.push('Frontmatter is missing a required "name" field.');
  } else {
    if (name.length > FM_NAME_MAX) {
      errors.push(`"name" exceeds ${FM_NAME_MAX} characters (${name.length}).`);
    }
    if (!FM_NAME_FORMAT_RE.test(name)) {
      errors.push('"name" must contain only lowercase letters, numbers, and hyphens.');
    }
    if (FM_XML_RE.test(name)) {
      errors.push('"name" must not contain XML tags.');
    }
    const reserved = FM_RESERVED_WORDS.find((w) => name.toLowerCase().includes(w));
    if (reserved) {
      errors.push(`"name" must not contain the reserved word "${reserved}".`);
    }
  }

  if (!description) {
    errors.push('Frontmatter is missing a required "description" field.');
  } else {
    if (description.length > FM_DESC_MAX) {
      errors.push(`"description" exceeds ${FM_DESC_MAX} characters (${description.length}).`);
    }
    if (FM_XML_RE.test(description)) {
      errors.push('"description" must not contain XML tags.');
    }
  }

  if (versionRaw === undefined || versionRaw === null || versionRaw === '') {
    errors.push('Frontmatter is missing a required "version" field.');
  } else if (parseIntStrict(versionRaw) === null) {
    errors.push('"version" must be a positive integer.');
  }

  if (statusRaw && !VALID_STATUSES.has(statusRaw)) {
    errors.push(`"status" must be one of: ${[...VALID_STATUSES].join(', ')}.`);
  }

  return errors;
}

function buildFrontmatterBlock({
  name, description = '', version = 1, status = STATUS_APPROVED,
}) {
  return (
    `---\nname: ${name}\ndescription: ${description}\nversion: ${version}\nstatus: ${status}\n---\n\n`
  );
}

function serializeFields(fields, order) {
  const lines = [];
  const seen = new Set();
  order.forEach((key) => {
    if (key in fields) {
      lines.push(`${key}: ${fields[key]}`);
      seen.add(key);
    }
  });
  Object.entries(fields).forEach(([k, v]) => {
    if (seen.has(k)) return;
    lines.push(`${k}: ${v}`);
  });
  return `---\n${lines.join('\n')}\n---\n`;
}

/**
 * Ensures a skill markdown string has a valid frontmatter block. Auto-fills
 * the fields we can compute (`name` from the skill ID, `version` defaults
 * to 1, `status` to the supplied value) while preserving any other
 * frontmatter keys round-trip.
 *
 * Note: `description` is intentionally NOT auto-filled. The caller is
 * expected to inspect `isValid` and block the save when `description`
 * is empty — the skill is useless to the agent's discovery layer without one.
 *
 * @param {string} markdown - raw skill body
 * @param {string} skillId  - canonical skill ID (lowercase, hyphens)
 * @param {string} status   - 'approved' | 'draft' (used when injecting from scratch)
 * @returns {{ markdown: string, injected: boolean, warnings: string[], isValid: boolean }}
 *   `injected` is true when a full skeleton was written from scratch OR when
 *   any required field was auto-filled into an existing block.
 *   `isValid` is true only when the resulting frontmatter passes
 *   `validateSkillFrontmatter`.
 */
export function ensureSkillFrontmatter(markdown, skillId, status) {
  const src = markdown ?? '';
  const safeStatus = VALID_STATUSES.has(status) ? status : STATUS_APPROVED;
  const parsed = parseFrontmatter(src);

  if (!parsed) {
    const block = buildFrontmatterBlock({
      name: skillId, description: '', version: 1, status: safeStatus,
    });
    const updated = block + src.trimStart();
    const warnings = validateSkillFrontmatter({
      name: skillId, description: '', version: 1, status: safeStatus,
    });
    return {
      markdown: updated, injected: true, warnings, isValid: warnings.length === 0,
    };
  }

  // Auto-fill missing/auto-fillable keys in the existing block.
  const next = { ...parsed.fields };
  let didFill = false;
  if (!next.name || !next.name.trim()) {
    next.name = skillId;
    didFill = true;
  }
  if (next.version === undefined || next.version === null || String(next.version).trim() === ''
      || parseIntStrict(next.version) === null) {
    next.version = '1';
    didFill = true;
  }
  if (!next.status || !VALID_STATUSES.has(String(next.status).trim().toLowerCase())) {
    next.status = safeStatus;
    didFill = true;
  }

  const warnings = validateSkillFrontmatter(next);

  if (!didFill) {
    return {
      markdown: src, injected: false, warnings, isValid: warnings.length === 0,
    };
  }

  const rebuiltBlock = serializeFields(next, INDEX_ENTRY_KEYS);
  const updated = `${rebuiltBlock}\n${parsed.body}`;
  return {
    markdown: updated, injected: true, warnings, isValid: warnings.length === 0,
  };
}

/**
 * Increments the `version: N` integer in a markdown's frontmatter, returning
 * the rewritten markdown. Used on every save. If the frontmatter is missing
 * or has no valid `version` field, returns the markdown after running it
 * through `ensureSkillFrontmatter` with the provided skill ID — the result
 * has `version: 1` so the next bump produces `2`.
 *
 * @param {string} markdown
 * @param {string} skillId - fallback used only when no frontmatter exists
 * @returns {{ markdown: string, version: number }}
 */
export function bumpSkillVersion(markdown, skillId) {
  const parsed = parseFrontmatter(markdown);
  if (!parsed) {
    const ensured = ensureSkillFrontmatter(markdown, skillId, STATUS_APPROVED);
    return { markdown: ensured.markdown, version: 1 };
  }
  const current = parseIntStrict(parsed.fields.version);
  const next = current === null ? 1 : current + 1;
  const fields = { ...parsed.fields, version: String(next) };
  const rebuiltBlock = serializeFields(fields, INDEX_ENTRY_KEYS);
  return { markdown: `${rebuiltBlock}\n${parsed.body}`, version: next };
}
