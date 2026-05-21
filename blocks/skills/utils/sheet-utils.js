/**
 * Pure utilities for working with DA config sheet row objects.
 * No DOM, no component state, no side effects.
 */

const SAFE_ID_RE = /^[a-zA-Z0-9_-]+$/;

/**
 * Validates that a string is safe for use as a path segment (skill ID, agent ID).
 * Rejects empty strings, paths with slashes, `..` traversal, and special characters.
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isSafeId(value) {
  return typeof value === 'string' && value.length > 0 && SAFE_ID_RE.test(value);
}

/**
 * Validates that a sub-path does not contain traversal sequences.
 * Allows slashes (for nested paths) but rejects `..` segments.
 *
 * @param {string} pathStr
 * @returns {boolean}
 */
export function isSafeSubPath(pathStr) {
  if (typeof pathStr !== 'string' || !pathStr.trim()) return false;
  return !pathStr.split('/').some((seg) => seg === '..' || seg === '.');
}

/**
 * Normalises a config sheet row's key to a canonical string.
 * Falls back from `key` → `id` → empty string, strips a trailing `.md` extension,
 * and trims whitespace.
 *
 * @param {Record<string, unknown>} row
 * @returns {string}
 */
export function normaliseRowKey(row) {
  return String(row?.key ?? row?.id ?? '').trim().replace(/\.md$/i, '');
}

/**
 * Coerces a config sheet cell value to a boolean.
 * Spreadsheets often store booleans as the strings 'true'/'false', '1'/'0',
 * or 'yes'/'no'. Actual JS booleans are returned as-is.
 *
 * @param {unknown} value
 * @param {boolean|undefined} [fallback] - returned when value cannot be coerced
 * @returns {boolean|undefined}
 */
export function parseSheetBoolean(value, fallback = undefined) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'true' || v === '1' || v === 'yes') return true;
    if (v === 'false' || v === '0' || v === 'no') return false;
  }
  return fallback;
}
