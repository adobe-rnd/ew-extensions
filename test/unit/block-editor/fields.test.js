import { expect } from '@esm-bundle/chai';
import {
  buildBlockFieldDefinitions, resolveBlockFields, matchFieldCount, isMultiBlockConfigured,
  processBlockOptions, EditorSession, sameTarget,
} from '../../../tools/block-editor/fields.js';

const blockTarget = { attribute: 'data-block-index', index: 10 };
const target = { ...blockTarget, rowIndex: 0, cellIndex: 0, fieldIndex: 0 };
const text = (value = 'Hello', extra = {}) => ({ type: 'text', value, readOnly: false, multiline: false, target, ...extra });
const row = (...fields) => ({ cells: [{ fields, colspan: 1, rowspan: 1 }] });
function metadata(html) {
  const table = document.createElement('table');
  table.innerHTML = html;
  return table;
}
const match = (rows, html) => ({
  template: { name: 'Cards', variant: '', rows },
  item: { fields: metadata(html) },
});
const schema = '<tr><td>Fields</td></tr><tr><td><p>Title</p></td></tr>';

describe('block editor metadata and source-faithful sidecars', () => {
  it('maps metadata labels and opaque targets without calculating offsets', () => {
    const definitions = buildBlockFieldDefinitions(match([row(text())], schema));
    const [field] = resolveBlockFields({ rows: [row(text())] }, definitions);
    expect(field.label).to.equal('Title');
    expect(field.target).to.equal(target);
    expect(field.value).to.equal('Hello');
  });
  it('keeps IGNORE positions and allows trailing current-page content', () => {
    const definitions = buildBlockFieldDefinitions(match([row(text('Key'), text('Value'))],
      '<tr><td>Fields</td></tr><tr><td><p>IGNORE</p><p>Value</p></td></tr>'));
    const [field] = resolveBlockFields({ rows: [row(text('Key'), text('Value'), text('Extra'))] }, definitions);
    expect(definitions).to.have.length(1);
    expect(field.fieldIndex).to.equal(1);
    expect(field.value).to.equal('Value');
    expect(field.error).to.equal('');
  });
  it('omits only redundant empty spacer fields around image-only content', () => {
    const image = { type: 'image', value: '/image.png', target, alt: 'Alt' };
    expect(matchFieldCount([text(''), image, text('')], 1)).to.deep.equal([image]);
    expect(matchFieldCount([text(''), text('content')], 1)).to.have.length(2);
  });
  it('rejects malformed metadata headers and label counts', () => {
    expect(() => buildBlockFieldDefinitions(match([row(text())], '<tr><td>Wrong</td></tr>'))).to.throw('Fields header');
    expect(() => buildBlockFieldDefinitions(match([row(text())],
      '<tr><td>Fields</td></tr><tr><td><p>One</p><p>Two</p></td></tr>'))).to.throw('names');
  });
  it('requires all rows for ordinary blocks', () => {
    expect(() => buildBlockFieldDefinitions(match([row(text()), row(text())], schema))).to.throw('rows');
  });
  it('requires exactly one shared schema row for configured multi blocks', () => {
    const definitions = buildBlockFieldDefinitions(match([row(text()), row(text())], schema), { multi: true });
    const secondTarget = { ...target, rowIndex: 1 };
    const [field] = resolveBlockFields({ rows: [row(text()), row(text('Second', { target: secondTarget }))] },
      definitions, { itemIndex: 1 });
    expect(field.value).to.equal('Second');
    expect(field.target).to.equal(secondTarget);
    expect(field.itemIndex).to.equal(1);
    expect(() => buildBlockFieldDefinitions(match([row(text()), row(text())],
      `${schema}<tr><td>Second</td></tr>`), { multi: true })).to.throw('exactly two rows');
  });
  it('disables shape mismatches instead of guessing another target', () => {
    const definitions = buildBlockFieldDefinitions(match([row(text())], schema));
    const [field] = resolveBlockFields({ rows: [row({ ...text(), type: 'image' })] }, definitions);
    expect(field.target).to.equal(null);
    expect(field.readOnly).to.equal(true);
    expect(field.error).to.include('structure');
  });
  it('preserves read-only, link, list item and multiline flags from the host', () => {
    const list = {
      type: 'list', value: 'Item', target, items: [
        text('Item', { readOnly: true, href: '/item', multiline: true }),
      ],
    };
    const definitions = buildBlockFieldDefinitions(match([row(list)], schema));
    const [field] = resolveBlockFields({ rows: [row(list)] }, definitions);
    expect(field.items[0]).to.include({ readOnly: true, href: '/item', multiline: true, label: 'Item 1' });
    expect(field.items[0].target).to.equal(target);
  });
  it('does not infer multi blocks from names or row counts', () => {
    expect(isMultiBlockConfigured([], 'cards')).to.equal(false);
    expect(isMultiBlockConfigured([{ block: 'CARDS', property: ' Multi ' }], 'cards')).to.equal(true);
  });
  it('merges All options without overwriting block-specific choices', () => {
    const options = processBlockOptions([
      { blocks: 'all', key: 'Color', values: 'Red=red|Blue=blue' },
      { blocks: 'cards, hero', key: 'Size', values: 'Large=lg' },
      { blocks: 'cards', key: 'Color', values: 'Green=green' },
    ]);
    expect(options.get('Cards').get('color')).to.deep.equal([{ title: 'Green', value: 'green' }]);
    expect(options.get('hero').get('color')).to.have.length(2);
    expect(options.get('unknown').get('color')).to.have.length(2);
  });
  it('matches selected blocks only by existing attribute and index', () => {
    expect(sameTarget(blockTarget, { ...blockTarget })).to.equal(true);
    expect(sameTarget(blockTarget, { ...blockTarget, index: 11 })).to.equal(false);
    expect(sameTarget(blockTarget, null)).to.equal(false);
  });
});

describe('revision-bound draft lifecycle', () => {
  let session;
  beforeEach(() => {
    session = new EditorSession();
    session.receive({ documentId: 'doc', revision: 1 });
  });
  it('retains draft value and original revision across incoming transactions', () => {
    const field = text();
    session.draft(field, 'value', 'Typing');
    session.receive({ documentId: 'doc', revision: 2 });
    expect(session.value(text('Remote'), 'value')).to.equal('Typing');
    expect(session.edit(field, 'value', 'Typing').request.revision).to.equal(1);
  });
  it('preserves typed link drafts independently from text drafts', () => {
    const field = text('Label', { href: '/old' });
    session.draft(field, 'href', '/new');
    expect(session.value(field, 'value')).to.equal('Label');
    expect(session.value(field, 'href')).to.equal('/new');
  });
  it('does not apply serialized identical blur values', () => {
    const field = text();
    session.draft(field, 'value', 'Hello');
    expect(session.edit(field, 'value', 'Hello')).to.equal(null);
    expect(session.drafts.size).to.equal(0);
  });
  it('does not carry targets or drafts into a different document', () => {
    session.draft(text(), 'value', 'Typing');
    session.receive({ documentId: 'other', revision: 1 });
    expect(session.drafts.size).to.equal(0);
    expect(session.capture(target).documentId).to.equal('other');
  });
});
