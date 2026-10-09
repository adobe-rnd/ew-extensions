import { expect } from '@esm-bundle/chai';
import {
  parseVariants, getBlockTableHtml, getBlockFieldTemplate, getBlockVariantOptions,
  getBlockVariantChoices,
} from '../../../tools/block-editor/library.js';
import { getRuntime, validateBase } from '../../../tools/block-editor/runtime.js';

describe('block editor library parsing', () => {
  it('preserves original templates, metadata labels, and variant headers', () => {
    const [item] = parseVariants(`<main><div><h2>Cards Display</h2>
      <div class="cards compact"><div><div><h3>Original</h3><p>Text</p></div></div></div>
      <div class="library-metadata"><div><div>fields</div><div><table>
      <tr><td>Fields</td></tr><tr><td><p>Title</p><p>Body</p></td></tr>
      </table></div></div><div><div>description</div><div>Keep me</div></div></div>
      </div></main>`, 'https://example.com/library');
    expect(item.name).to.equal('Cards Display');
    expect(item.dom.rows[0].textContent).to.equal('cards (compact)');
    expect(item.dom.rows[1].cells[0].innerHTML).to.equal('<h3>Original</h3><p>Text</p>');
    expect(item.fields.rows[1].textContent).to.equal('TitleBody');
    expect(item.description).to.equal('Keep me');
    expect(item.dom.querySelector('.library-metadata')).to.equal(null);
  });
  it('pads only the final cell of a short row', () => {
    const block = document.createElement('div');
    block.className = 'example';
    block.innerHTML = '<div><div>A</div><div>B</div><div>C</div></div><div><div>D</div><div>E</div></div>';
    const table = getBlockTableHtml(block);
    expect(table.rows[2].cells[0].colSpan).to.equal(1);
    expect(table.rows[2].cells[1].colSpan).to.equal(2);
  });
  it('matches host-normalized original table descriptors, not DOM heuristics', async () => {
    const [item] = parseVariants('<main><div><div class="cards compact"><div><div>Text</div></div></div></div></main>', 'https://example.com/library');
    let request;
    const blocks = [{ path: '/library/cards', loadVariants: Promise.resolve([item]) }];
    const matched = await getBlockFieldTemplate(blocks, 'Cards', 'compact', {
      describeBlock: async (args) => { request = args; return { name: 'cards', variant: 'compact', rows: [] }; },
    });
    expect(request.html).to.equal(item.dom.outerHTML);
    expect(matched.path).to.equal('/library/cards');
    expect(await getBlockVariantOptions(blocks, 'cards')).to.deep.equal(['compact']);
  });
  it('associates preceding and nested metadata', () => {
    const source = `<main><div><h2>Display</h2><div class="library-metadata">
      <div><div>description</div><div>Description</div></div></div>
      <div class="cards"><div><div>Text</div></div></div></div></main>`;
    const [item] = parseVariants(source, 'https://example.com/library');
    expect(item.name).to.equal('Display');
    expect(item.description).to.equal('Description');
  });
  it('uses library display labels without writing them as source variants', async () => {
    const items = parseVariants(`<main><div><h2>Hero (Text Start)</h2>
      <div class="hero left"><div><div>Title</div></div></div></div></main>`,
    'https://example.com/library');
    const choices = await getBlockVariantChoices([{ loadVariants: Promise.resolve(items) }], 'hero');
    expect(choices).to.deep.equal([{ value: 'left', label: 'Text Start' }]);
  });
});

describe('block editor local asset configuration', () => {
  it('defaults to local da-nx and da-live on localhost', () => {
    expect(getRuntime('', 'localhost')).to.deep.equal({
      nx: 'http://localhost:3001/nx', nx2: 'http://localhost:3001/nx2',
      live: 'http://localhost:3001', ref: 'local',
    });
  });
  it('never falls back to production when either local override is supplied', () => {
    expect(getRuntime('?nx=http://localhost:4001', 'extension.example').live).to.equal('http://localhost:3001');
    expect(getRuntime('?live=http://localhost:4000', 'extension.example').nx).to.equal('http://localhost:3001/nx');
  });
  it('rejects unsafe schemes, credentials, and ambiguous asset URLs', () => {
    ['javascript:alert(1)', 'https://user:pass@example.com', 'https://example.com/?a=b', 'https://example.com/#hash']
      .forEach((value) => expect(() => validateBase(value)).to.throw());
  });
  it('validates explicit local library indexes without production config loading', () => {
    expect(getRuntime('?library=http%3A%2F%2Flocalhost%3A3001%2Flibrary.json', 'localhost').library)
      .to.equal('http://localhost:3001/library.json');
    expect(() => getRuntime('?library=javascript%3Aalert(1)', 'localhost')).to.throw();
  });
});
