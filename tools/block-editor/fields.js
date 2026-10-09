export const normalizeBlockName = (name) => (name || '').toLowerCase().replace(/[\s_-]+/g, ' ').trim();
export const normalizeVariant = (value) => (value || '').split(',').map(normalizeBlockName).sort().join(',');
export const normalizeForSlashMenu = (value) => value?.toLowerCase().trim().replace(/\s+/g, '-');
export const targetKey = (target) => JSON.stringify(target);
export const sameTarget = (a, b) => !!a && !!b && a.attribute === b.attribute && a.index === b.index;

export function matchFieldCount(fields, count) {
  if (fields.length === count) return fields;
  const content = fields.filter((field) => field.type !== 'text' || field.value);
  return content.length === count && content.every((field) => field.type === 'image') ? content : fields;
}

export function buildBlockFieldDefinitions(match, { multi = false } = {}) {
  if (!match || !('fields' in match.item)) return [];
  const { item, template } = match;
  const rows = item.fields?.rows;
  if (!rows || rows[0]?.cells.length !== 1 || rows[0].textContent.trim().toLowerCase() !== 'fields') {
    throw new Error('Block fields metadata must be a table with a Fields header.');
  }
  if (rows.length !== (multi ? 2 : template.rows.length + 1) || (multi && !template.rows.length)) {
    throw new Error(multi
      ? `Multi-item block fields metadata rows must contain exactly two rows: a Fields header and one shared first-item row. The library's ${template.rows.length} sample items do not need separate metadata rows, and a first template item must exist.`
      : 'Block fields metadata rows do not match the library template.');
  }
  const definitions = [];
  [...rows].slice(1).forEach((row, rowIndex) => {
    const templateRow = template.rows[rowIndex];
    if (row.cells.length !== templateRow.cells.length) {
      throw new Error('Block fields metadata cells do not match the library template.');
    }
    [...row.cells].forEach((cell, cellIndex) => {
      const labels = cell.children.length
        ? [...cell.children].map((el) => el.textContent.trim()) : [cell.textContent.trim()];
      const fields = matchFieldCount(templateRow.cells[cellIndex].fields, labels.length);
      if (labels.length !== fields.length) throw new Error('Block field names do not match the library template content.');
      labels.forEach((label, fieldIndex) => {
        if (!label || label.toUpperCase() === 'IGNORE') return;
        definitions.push({
          key: `${rowIndex}-${cellIndex}-${fieldIndex}`,
          label,
          rowIndex,
          cellIndex,
          fieldIndex,
          type: fields[fieldIndex].type,
          multiline: fields[fieldIndex].multiline,
          itemMultiline: fields[fieldIndex].items?.map((entry) => entry.multiline),
          multi,
          rowCount: template.rows.length,
          cellCount: templateRow.cells.length,
          fieldCount: fields.length,
        });
      });
    });
  });
  return definitions;
}

export function resolveBlockFields(block, definitions, { itemIndex = 0 } = {}) {
  if (!block) return [];
  return definitions.map((definition) => {
    const rowIndex = definition.multi ? itemIndex : definition.rowIndex;
    const row = block.rows[rowIndex];
    const cell = row?.cells[definition.cellIndex];
    const fields = matchFieldCount(cell?.fields || [], definition.fieldCount);
    const field = fields[definition.fieldIndex];
    const matches = (definition.multi || block.rows.length === definition.rowCount)
      && row?.cells.length === definition.cellCount && fields.length >= definition.fieldCount
      && field?.type === definition.type;
    return {
      ...definition,
      ...(matches ? field : { value: '', readOnly: true }),
      key: matches && field.target ? targetKey(field.target) : `${rowIndex}-${definition.key}`,
      target: matches ? field.target : null,
      itemIndex: definition.multi ? itemIndex : undefined,
      multiline: definition.multiline || field?.multiline,
      items: matches && field.type === 'list' ? (field.items || []).map((entry, index) => ({
        ...entry,
        key: entry.target ? targetKey(entry.target) : `${rowIndex}-${definition.key}-item-${index}`,
        label: `Item ${index + 1}`,
        multiline: entry.multiline || definition.itemMultiline?.[index] || definition.itemMultiline?.[0],
      })) : [],
      error: matches ? '' : 'This field does not match the selected block structure.',
    };
  });
}

export function isMultiBlockConfigured(rows, name) {
  return (rows || []).some((row) => normalizeBlockName(row.block) === normalizeBlockName(name)
    && row.property?.toLowerCase().trim() === 'multi');
}

export function processBlockOptions(data) {
  const map = new Map();
  (data || []).forEach((row) => {
    if (!row.blocks || !row.key || !row.values) return;
    const values = row.values.split('|').map((entry) => {
      const [title, value] = entry.split('=').map((part) => part.trim());
      return { title, value: value || title };
    });
    row.blocks.split(',').forEach((name) => {
      const key = normalizeForSlashMenu(name);
      if (!map.has(key)) map.set(key, new Map());
      map.get(key).set(normalizeForSlashMenu(row.key), values);
    });
  });
  map.forEach((options, name) => {
    if (name !== 'all') {
      map.get('all')?.forEach((values, key) => {
        if (!options.has(key)) options.set(key, values);
      });
    }
  });
  const get = map.get.bind(map);
  map.get = (name) => get(normalizeForSlashMenu(name)) || get('all');
  return map;
}

export class EditorSession {
  constructor() {
    this.snapshot = null;
    this.drafts = new Map();
  }

  receive(snapshot) {
    if (this.snapshot?.documentId !== snapshot.documentId) this.drafts.clear();
    this.snapshot = snapshot;
  }

  capture(target) {
    if (!this.snapshot || !target) return null;
    const { documentId, revision } = this.snapshot;
    return { documentId, revision, target };
  }

  draft(field, property, value) {
    const key = `${targetKey(field.target)}:${property}`;
    if (!this.drafts.has(key)) this.drafts.set(key, { ...this.capture(field.target), base: field[property] });
    this.drafts.get(key).value = value;
  }

  value(field, property) {
    return this.drafts.get(`${targetKey(field.target)}:${property}`)?.value ?? field[property];
  }

  edit(field, property, value) {
    const key = `${targetKey(field.target)}:${property}`;
    const draft = this.drafts.get(key);
    if (value === (draft?.base ?? field[property])) {
      this.drafts.delete(key);
      return null;
    }
    return { key, request: draft || this.capture(field.target) };
  }
}
