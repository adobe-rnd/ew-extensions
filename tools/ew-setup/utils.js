export function parseOrgSite(raw) {
  const normalized = (raw || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length !== 2) return null;
  return { org: parts[0], site: parts[1] };
}

export function findEditorPathRows(json) {
  if (!json) return { sheetKey: null, rows: [] };
  if (Array.isArray(json.data)) return { sheetKey: null, rows: json.data };
  for (const key of Object.keys(json)) {
    if (key.startsWith(':')) continue;
    if (Array.isArray(json[key]?.data)) return { sheetKey: key, rows: json[key].data };
  }
  return { sheetKey: null, rows: [] };
}

export function hasEditorPathForSite(rows, org, site) {
  if (!rows?.length) return false;
  const needle = `/${org}/${site}=`;
  return rows.some((r) => typeof r.value === 'string' && r.value.includes(needle));
}

const SIDEKICK_EDIT_URL = 'https://da.live/canvas#/{{org}}/{{site}}{{pathname}}';

export function hasCorrectSidekickConfig(json) {
  return json?.editUrlPattern === SIDEKICK_EDIT_URL;
}

export function buildUpdatedSidekickConfig(existingJson) {
  if (!existingJson) return { project: 'Experience Workspace Project', editUrlPattern: SIDEKICK_EDIT_URL };
  return { ...existingJson, editUrlPattern: SIDEKICK_EDIT_URL };
}

export function buildUpdatedConfig(existingJson, org, site) {
  const newRow = { key: 'editor.path', value: `/${org}/${site}=https://da.live/canvas#` };
  if (!existingJson) return { data: [newRow] };
  const { sheetKey, rows } = findEditorPathRows(existingJson);
  if (hasEditorPathForSite(rows, org, site)) return existingJson;
  const updatedRows = [...rows.filter((r) => r.key || r.value), newRow];
  if (sheetKey) {
    return { ...existingJson, [sheetKey]: { ...existingJson[sheetKey], data: updatedRows } };
  }
  return { ...existingJson, data: updatedRows };
}
