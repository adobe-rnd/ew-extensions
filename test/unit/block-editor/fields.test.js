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

  describe('field-aware draft rebasing', () => {
    const state = (revision = 1, values = [['Title', 'Caption']]) => ({
      documentId: 'doc',
      revision,
      liveBlockSignature: `block-${revision}`,
      editable: true,
      selectedBlock: blockTarget,
      blocks: [{
        name: 'Cards',
        variant: '',
        target: blockTarget,
        rows: values.map((entries, rowIndex) => row(...entries.map((value, fieldIndex) => text(value, {
          tagName: 'P', target: { ...target, rowIndex, fieldIndex },
        })))),
      }],
    });
    const at = (snapshot, rowIndex = 0, fieldIndex = 0) => (
      snapshot.blocks[0].rows[rowIndex].cells[0].fields[fieldIndex]
    );
    let session;
    let original;
    let field;
    beforeEach(() => {
      session = new EditorSession();
      original = state();
      session.receive(original);
      field = at(original);
      session.draft(field, 'value', 'Typing');
    });

    it('rebases an unchanged field onto the latest document and block revision', () => {
      session.receive(state(2, [['Title', 'Remote caption']]));
      const edit = session.edit(field, 'value', 'Typing');
      expect(edit.conflict).to.equal(false);
      expect(edit.request.revision).to.equal(2);
      expect(edit.request.liveBlockSignature).to.equal('block-2');
      expect(edit.request).not.to.have.property('snapshot');
      expect(session.value(field, 'value')).to.equal('Typing');
    });

    it('keeps link and label baselines independent', () => {
      field.href = '/old';
      session.drafts.clear();
      session.draft(field, 'value', 'Typing');
      session.draft(field, 'href', '/mine');
      const next = state(2);
      at(next).href = '/remote';
      session.receive(next);
      expect(session.edit(field, 'value', 'Typing').conflict).to.equal(false);
      expect(session.edit(field, 'href', '/mine').conflict).to.equal(true);
    });

    it('does not rebase a genuine same-field conflict', () => {
      session.receive(state(2, [['Remote title', 'Caption']]));
      const edit = session.edit(field, 'value', 'Typing');
      expect(edit.conflict).to.equal(true);
      expect(edit.request.revision).to.equal(1);
      expect(session.value(at(session.snapshot), 'value')).to.equal('Typing');
    });

    it('rejects a stale field descriptor even if its value still matches', () => {
      session.drafts.clear();
      const next = state(2);
      at(next).tagName = 'H2';
      session.receive(next);
      session.draft(field, 'value', 'Typing');
      expect(session.edit(field, 'value', 'Typing').conflict).to.equal(true);
    });

    for (const [name, change] of [
      ['removed fields', (next) => next.blocks[0].rows[0].cells[0].fields.shift()],
      ['inserted rows', (next) => next.blocks[0].rows.push(row(text('Added')))],
      ['changed markup', (next) => { at(next).tagName = 'H2'; }],
      ['changed variants', (next) => { next.blocks[0].variant = 'compact'; }],
      ['changed selection', (next) => { next.selectedBlock = null; }],
      ['read-only documents', (next) => { next.editable = false; }],
      ['read-only fields', (next) => { at(next).readOnly = true; }],
      ['changed cell spans', (next) => { next.blocks[0].rows[0].cells[0].colspan = 2; }],
    ]) {
      it(`preserves drafts instead of rebasing across ${name}`, () => {
        const next = state(2);
        change(next);
        session.receive(next);
        expect(session.edit(field, 'value', 'Typing').conflict).to.equal(true);
        expect(session.value(field, 'value')).to.equal('Typing');
      });
    }

    it('rejects reordered rows even when the focused values are identical', () => {
      original = state(1, [['Shared', 'First'], ['Shared', 'Second']]);
      session.receive(original);
      session.drafts.clear();
      field = at(original);
      session.draft(field, 'value', 'Typing');
      session.receive(state(2, [['Shared', 'Second'], ['Shared', 'First']]));
      expect(session.edit(field, 'value', 'Typing').conflict).to.equal(true);
    });

    it('rejects swapped links with identical labels', () => {
      original = state(1, [['Shared', 'Shared']]);
      at(original).href = '/first';
      at(original, 0, 1).href = '/second';
      session.receive(original);
      session.drafts.clear();
      field = at(original);
      session.draft(field, 'value', 'Typing');
      const next = state(2, [['Shared', 'Shared']]);
      at(next).href = '/second';
      at(next, 0, 1).href = '/first';
      session.receive(next);
      expect(session.edit(field, 'value', 'Typing').conflict).to.equal(true);
    });

    it('rejects ambiguous changes to several unkeyed rows of the same shape', () => {
      original = state(1, [['Shared', 'First'], ['Shared', 'Second']]);
      session.receive(original);
      session.drafts.clear();
      field = at(original);
      session.draft(field, 'value', 'Typing');
      session.receive(state(2, [['Shared', 'Changed first'], ['Shared', 'Changed second']]));
      expect(session.edit(field, 'value', 'Typing').conflict).to.equal(true);
    });

    it('preserves newer typing in the same field across its own acknowledgement', () => {
      const edit = session.edit(field, 'value', 'Typing');
      session.draft(field, 'value', 'More typing');
      session.receive(state(2, [['Typing', 'Caption']]));
      expect(session.acknowledge(edit, 'value', 'Typing')).to.equal(true);
      expect(session.value(at(session.snapshot), 'value')).to.equal('More typing');
      const next = session.edit(field, 'value', 'More typing');
      expect(next.conflict).to.equal(false);
      expect(next.request.revision).to.equal(2);
      session.receive(state(3, [['More typing', 'Caption']]));
      session.acknowledge(next, 'value', 'More typing');
      expect(session.drafts.size).to.equal(0);
    });

    it('can restore the original value after an acknowledged intermediate edit', () => {
      const edit = session.edit(field, 'value', 'Typing');
      session.draft(field, 'value', 'Title');
      session.receive(state(2, [['Typing', 'Caption']]));
      session.acknowledge(edit, 'value', 'Typing');
      expect(session.edit(field, 'value', 'Title').request.revision).to.equal(2);
    });

    it('advances other pending drafts after each own edit, including across several similar rows', () => {
      original = state(1, [['Title', 'Caption'], ['Second title', 'Second caption']]);
      session.receive(original);
      session.drafts.clear();
      const title = at(original);
      const caption = at(original, 0, 1);
      const secondTitle = at(original, 1);
      session.draft(title, 'value', 'New title');
      const first = session.edit(title, 'value', 'New title');
      const captionKey = session.draft(caption, 'value', 'Typing caption');
      session.draft(secondTitle, 'value', 'New second title');
      session.receive(state(2, [['New title', 'Caption'], ['Second title', 'Second caption']]));
      session.acknowledge(first, 'value', 'New title');
      expect(session.drafts.get(captionKey).revision).to.equal(2);
      const second = session.edit(secondTitle, 'value', 'New second title');
      session.receive(state(3, [['New title', 'Caption'], ['New second title', 'Second caption']]));
      session.acknowledge(second, 'value', 'New second title');
      expect(session.drafts.get(captionKey).revision).to.equal(3);
      expect(session.edit(caption, 'value', 'Typing caption').conflict).to.equal(false);
    });

    it('uses the known own edit when a label becomes identical to a neighbouring link', () => {
      original = state(1, [['First', 'Second']]);
      at(original).href = '/same';
      at(original, 0, 1).href = '/same';
      session.receive(original);
      session.drafts.clear();
      field = at(original);
      session.draft(field, 'value', 'Second');
      const edit = session.edit(field, 'value', 'Second');
      session.draft(field, 'href', '/new');
      const next = state(2, [['Second', 'Second']]);
      at(next).href = '/same';
      at(next, 0, 1).href = '/same';
      session.receive(next);
      expect(session.acknowledge(edit, 'value', 'Second')).to.equal(true);
      const link = session.edit(field, 'href', '/new');
      expect(link.conflict).to.equal(false);
      expect(link.request.revision).to.equal(2);
    });

    it('does not treat an unrelated list insertion as a change to a text field', () => {
      const list = {
        type: 'list', tagName: 'UL', target: { ...target, fieldIndex: 1 },
        items: [text('Item', { target: { ...target, fieldIndex: 1, itemIndex: 0 } })],
      };
      original.blocks[0].rows[0].cells[0].fields[1] = list;
      const next = structuredClone(original);
      next.revision = 2;
      next.liveBlockSignature = 'block-2';
      next.blocks[0].rows[0].cells[0].fields[1].items.push(
        text('Added', { target: { ...target, fieldIndex: 1, itemIndex: 1 } }),
      );
      session.receive(next);
      expect(session.edit(field, 'value', 'Typing').conflict).to.equal(false);
    });

    it('does not mistake a newer conflicting snapshot for its own acknowledgement', () => {
      const edit = session.edit(field, 'value', 'Typing');
      session.draft(field, 'value', 'More typing');
      session.receive(state(2, [['Remote title', 'Caption']]));
      expect(session.acknowledge(edit, 'value', 'Typing')).to.equal(false);
      expect(session.edit(field, 'value', 'More typing').conflict).to.equal(true);
      expect(session.value(field, 'value')).to.equal('More typing');
    });

    it('does not let an older no-op blur delete newer queued typing', () => {
      expect(session.edit(field, 'value', 'Title')).to.equal(null);
      expect(session.value(field, 'value')).to.equal('Typing');
    });
  });
  it('retains draft value and original revision across incoming transactions', () => {
    const field = text();
    session.draft(field, 'value', 'Typing');
    session.receive({ documentId: 'doc', revision: 2 });
    expect(session.value(text('Remote'), 'value')).to.equal('Typing');
    expect(session.edit(field, 'value', 'Typing').request.revision).to.equal(1);
  });
  it('keeps the original live block identity when the canvas changes during a draft', () => {
    const field = text();
    session.receive({ documentId: 'doc', revision: 1, liveBlockSignature: 'before' });
    session.draft(field, 'value', 'Typing');
    session.receive({ documentId: 'doc', revision: 1, liveBlockSignature: 'after' });
    expect(session.edit(field, 'value', 'Typing').request.liveBlockSignature).to.equal('before');
    expect(session.capture(target).liveBlockSignature).to.equal('after');
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
