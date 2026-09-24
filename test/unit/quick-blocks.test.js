import { expect } from '@esm-bundle/chai';
import {
  BASIC_GROUPS, PARAGRAPH_ELEMENT, blockSources, firstSheet, libraryFetch,
  loadBlocks, loadVariants, matches, parseVariants, resolveEditorOrigin, setHtmlDragData,
} from '../../tools/quick-blocks/library.js';
import { parseAssetPage } from '../../tools/quick-blocks/assets.js';

describe('Quick Blocks library', () => {
  it('uses the host-provided origin even when the iframe has no referrer', () => {
    expect(resolveEditorOrigin({ editorOrigin: 'https://qe-drop--da-live--adobe.aem.live' }, ''))
      .to.equal('https://qe-drop--da-live--adobe.aem.live');
    expect(resolveEditorOrigin({}, 'https://da.live/canvas')).to.equal('https://da.live');
    expect(resolveEditorOrigin({}, '')).to.equal(null);
    expect(() => resolveEditorOrigin({ editorOrigin: 'https://da.live/canvas' }, ''))
      .to.throw('Invalid Experience Workspace editor origin');
  });

  it('resolves the same site-first Blocks config and comma-separated sources as EW', () => {
    const configs = [
      { library: { data: [{ title: 'Blocks', path: '/org-blocks.json' }] } },
      { library: { data: [{ title: 'Blocks', path: '/site-blocks.json, https://example.com/more.json' }] } },
    ];
    expect(blockSources(configs, 'dev', 'org', 'site')).to.deep.equal([
      'https://dev--site--org.aem.live/site-blocks.json',
      'https://example.com/more.json',
    ]);
    expect(blockSources(configs, 'local', 'org', 'site')[0])
      .to.equal('http://localhost:3000/site-blocks.json');
    expect(blockSources(configs, 'main', 'org', 'site').length).to.equal(2);
  });

  it('uses org fallback and respects configured refs', () => {
    const configs = [
      { library: { data: [{ title: 'Blocks', path: '/org.json' }] } },
      { library: { data: [{ title: 'Blocks', path: '/dev.json', ref: 'dev' }] } },
    ];
    expect(blockSources(configs, 'main', 'org', 'site'))
      .to.deep.equal(['https://main--site--org.aem.live/org.json']);
    expect(blockSources(configs, 'dev', 'org', 'site'))
      .to.deep.equal(['https://dev--site--org.aem.live/dev.json']);
    expect(blockSources([], 'main', 'org', 'site')).to.deep.equal([]);
  });

  it('reads both plain and multi-sheet block sheets', () => {
    expect(firstSheet({ data: [{ name: 'Cards' }] })).to.deep.equal([{ name: 'Cards' }]);
    expect(firstSheet({ blocks: { data: [{ name: 'Hero' }] }, ':type': 'multi-sheet' }))
      .to.deep.equal([{ name: 'Hero' }]);
    expect(firstSheet({
      ':type': 'multi-sheet', ':names': ['blocks'], blocks: { data: [{ name: 'Cards' }] },
    })).to.deep.equal([{ name: 'Cards' }]);
  });

  it('loads block rows and fails explicitly when a source fails', async () => {
    const daFetch = async (url) => {
      if (url.includes('/config/')) return { ok: true, json: async () => ({ library: { data: [{ title: 'Blocks', path: '/blocks.json' }] } }) };
      return { ok: true, json: async () => ({ data: [{ name: 'Hero', path: 'https://example.com/hero' }, { name: 'Incomplete' }] }) };
    };
    const blocks = await loadBlocks({ org: 'org', site: 'site', daFetch });
    expect(blocks).to.have.length(1);
    expect(blocks[0].name).to.equal('Hero');
    try {
      await loadBlocks({ org: 'org', site: 'site', daFetch: async () => ({ ok: false, status: 403 }) });
      throw new Error('Expected a failure');
    } catch (error) {
      expect(error.message).to.include('403');
    }
  });

  it('uses the host-selected stage admin instead of the production config', async () => {
    const urls = [];
    const blocks = await loadBlocks({
      org: 'org', site: 'site', daAdmin: 'https://stage-admin.da.live',
      daFetch: async (url) => {
        urls.push(url);
        if (url.includes('/config/')) {
          return { ok: true, json: async () => ({ library: { data: [{ title: 'Blocks', path: '/blocks.json' }] } }) };
        }
        return { ok: true, json: async () => ({ data: [{ name: 'Cards', path: '/cards' }] }) };
      },
    });
    expect(blocks).to.have.length(1);
    expect(urls.slice(0, 2)).to.deep.equal([
      'https://stage-admin.da.live/config/org',
      'https://stage-admin.da.live/config/org/site',
    ]);
  });

  it('uses the forwarded token without trying to start IMS in the iframe', async () => {
    const calls = [];
    const fetcher = async (url, options) => {
      calls.push({ url, headers: options.headers });
      return { ok: false, status: 401 };
    };
    const daFetch = libraryFetch('stage-token', 'https://stage-admin.da.live', fetcher);
    const response = await daFetch('https://stage-admin.da.live/config/org');
    expect(response.status).to.equal(401);
    expect(calls[0].headers.get('Authorization')).to.equal('Bearer stage-token');
    await daFetch('https://example.com/blocks.json');
    expect(calls[1].headers.has('Authorization')).to.equal(false);
    expect(() => libraryFetch(null, 'https://stage-admin.da.live', fetcher))
      .to.throw('Sign in to Experience Workspace');
    expect(() => libraryFetch('stage-token', 'https://example.com', fetcher))
      .to.throw('Unsupported DA Admin origin');
  });

  it('converts variant blocks to tables, strips metadata, and supports search', () => {
    const variants = parseVariants(`<main><div>
      <h2>Cards</h2>
      <div class="cards dark"><div><div>First</div><div>Second</div></div>
        <div><div>Last</div></div>
        <div class="library-metadata"><div><div>Searchtags</div><div>promo</div></div>
      </div>
    </div></main>`, 'https://example.com/cards');
    expect(variants).to.have.length(1);
    expect(variants[0].name).to.equal('Cards');
    expect(variants[0].variants).to.equal('dark');
    expect(variants[0].dom.querySelector('.library-metadata')).to.be.null;
    expect(variants[0].dom.querySelector('tr:nth-child(3) td').colSpan).to.equal(2);
    expect(variants[0].dom.outerHTML).to.include('<td colspan="2">cards (dark)</td>');
    expect(matches('promo dark', { name: 'Cards' }, variants[0])).to.be.true;
  });

  it('keeps grouped content together as multiple tables', () => {
    const variants = parseVariants(`<main><div>
      <h2>Collection</h2><div class="library-container-start"></div>
      <div class="hero"><div><div>Hero</div></div></div>
      <p>Between blocks</p>
      <div class="cards"><div><div>Cards</div></div></div>
      <div class="library-container-end"></div>
    </div></main>`, 'https://example.com/group');
    expect(variants[0].name).to.equal('Collection');
    expect(variants[0].dom.querySelectorAll('table')).to.have.length(2);
    expect(variants[0].dom.querySelector('p').textContent).to.equal('Between blocks');
  });

  it('requests AEM plain HTML for variants and propagates failures', async () => {
    const requested = [];
    const fetcher = async (url) => {
      requested.push(url);
      return { ok: true, text: async () => '<main><div><div class="hero"><div><div>Hi</div></div></div></div></main>' };
    };
    expect(await loadVariants('https://main--site--org.aem.live/hero', fetcher)).to.have.length(1);
    expect(requested).to.deep.equal(['https://main--site--org.aem.live/hero.plain.html']);
  });

  it('groups all heading levels and both list styles with sample content', () => {
    expect(BASIC_GROUPS.map((group) => group.name)).to.deep.equal(['Heading', 'List']);
    expect(BASIC_GROUPS[0].variants).to.have.length(6);
    BASIC_GROUPS[0].variants.forEach((item, index) => {
      expect(item.name).to.equal(`Heading ${index + 1}`);
      expect(item.html).to.equal(`<h${index + 1}>Heading</h${index + 1}>`);
    });
    expect(BASIC_GROUPS[1].variants).to.deep.equal([
      { name: 'Unordered List', html: '<ul><li>List item</li></ul>' },
      { name: 'Ordered List', html: '<ol><li>List item</li></ol>' },
    ]);
    expect(PARAGRAPH_ELEMENT).to.deep.equal({ name: 'Paragraph', html: '<p>Paragraph</p>' });
  });

  it('drags the same HTML as click-to-insert without custom MIME types', () => {
    const variant = parseVariants(
      '<main><div><div class="hero"><div><div>Hi</div></div></div></div></main>',
      'https://example.com/hero',
    )[0];
    const transfer = {
      data: {},
      setData(type, value) { this.data[type] = value; },
      effectAllowed: 'none',
    };
    setHtmlDragData(transfer, variant.dom.outerHTML);
    expect(transfer.effectAllowed).to.equal('copy');
    expect(Object.keys(transfer.data)).to.deep.equal(['text/html']);
    expect(transfer.data['text/html']).to.equal(variant.dom.outerHTML);
    setHtmlDragData(transfer, BASIC_GROUPS[0].variants[1].html);
    expect(transfer.data['text/html']).to.equal('<h2>Heading</h2>');
    setHtmlDragData(transfer, BASIC_GROUPS[1].variants[0].html);
    expect(transfer.data['text/html']).to.equal('<ul><li>List item</li></ul>');
  });

  it('prepares paginated image cards without loading the AEM selector', () => {
    const thumbnail = new Blob(['preview'], { type: 'image/png' });
    const asset = { 'aem:formatName': 'JPEG', 'repo:id': 'example' };
    const page = parseAssetPage({
      assets: [{ asset, name: 'Image', thumbnail }],
      hasMore: true,
    }, () => 'blob:preview');
    expect(page).to.deep.equal({
      assets: [{
        asset,
        name: 'Image',
        thumbnailUrl: 'blob:preview',
      }],
      hasMore: true,
    });
    expect(parseAssetPage({ assets: [], hasMore: false }).assets).to.deep.equal([]);
    expect(() => parseAssetPage({ assets: [{ asset, name: '' }], hasMore: false }))
      .to.throw('The asset list returned invalid data.');
    expect(() => parseAssetPage({
      assets: [{ asset, name: 'Image', thumbnail: 'url' }],
      hasMore: false,
    })).to.throw('The asset list returned invalid data.');
    expect(() => parseAssetPage({ assets: [], hasMore: 'yes' }))
      .to.throw('The asset list returned invalid data.');
  });
});
