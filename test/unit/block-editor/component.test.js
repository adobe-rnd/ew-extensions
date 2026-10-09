import { expect } from '@esm-bundle/chai';
import { EditorSession } from '../../../tools/block-editor/fields.js';

describe('block editor SDK workflow adapter', () => {
  let Component;
  let sdk;
  let element;
  let calls;
  let library;
  let unsubscribeCount = 0;
  const blockTarget = { attribute: 'data-block-index', index: 10 };
  const fieldTarget = { ...blockTarget, rowIndex: 0, cellIndex: 0, fieldIndex: 0 };
  const field = { type: 'text', value: 'Hello', target: fieldTarget, readOnly: false };
  const block = { target: blockTarget, name: 'Cards', variant: '', rows: [{ cells: [{ fields: [field] }] }] };
  const snapshot = (revision = 1) => ({
    documentId: 'doc', revision, html: '<main>Preview</main>', editable: true, blocks: [block], selectedBlock: blockTarget,
  });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  before(async () => {
    calls = [];
    sdk = {
      capabilities: { editor: 1 },
      context: {},
      actions: {
        subscribeDocument: async (callback) => {
          sdk.callback = callback;
          callback(snapshot());
          return () => { unsubscribeCount += 1; };
        },
        applyChanges: async (request) => {
          calls.push(['applyChanges', request]);
          return { documentId: request.documentId, revision: request.revision + 1 };
        },
        selectTarget: async (request) => { calls.push(['selectTarget', request]); return {}; },
        pickAsset: async (request) => { calls.push(['pickAsset', request]); return { cancelled: true }; },
        uploadImage: async (request) => { calls.push(['uploadImage', request]); return {}; },
        openBlockLibrary: async (request) => { calls.push(['openBlockLibrary', request]); return { cancelled: true }; },
        setPrompt: async (...args) => { calls.push(['setPrompt', ...args]); },
      },
    };
    window.blockEditorTestSdk = sdk;
    const url = window.location.href;
    const base = `${window.location.origin}/test/unit/block-editor/fixtures`;
    const indexUrl = `${window.location.origin}/fixture/library.json`;
    window.history.replaceState(null, '',
      `?nx=${encodeURIComponent(base)}&nx2=${encodeURIComponent(base)}&live=${encodeURIComponent(window.location.origin)}&library=${encodeURIComponent(indexUrl)}`);
    const originalFetch = window.fetch;
    window.fetch = (resource, options) => (String(resource).endsWith('.css')
      ? Promise.resolve(new Response('')) : originalFetch(resource, options));
    try {
      ({ EwBlockProperties: Component } = await import('../../../tools/block-editor/block-editor.js'));
      library = await import('../../../tools/block-editor/library.js');
    } finally {
      window.fetch = originalFetch;
      window.history.replaceState(null, '', url);
    }
  });

  beforeEach(async () => {
    calls.length = 0;
    sdk.capabilities.editor = 1;
    element = new Component();
    element.attachShadow({ mode: 'open' });
    document.body.append(element);
    await flush();
    element._fieldDefinitions = [{
      key: 'title', label: 'Title', rowIndex: 0, cellIndex: 0, fieldIndex: 0,
      type: 'text', rowCount: 1, cellCount: 1, fieldCount: 1,
    }];
  });
  afterEach(() => element.remove());

  it('subscribes, receives the initial snapshot, and tears down once', () => {
    expect(element._name).to.equal('Cards');
    expect(element._session.snapshot.html).to.equal('<main>Preview</main>');
    const previous = unsubscribeCount;
    element.remove();
    expect(unsubscribeCount).to.equal(previous + 1);
    sdk.callback({ ...snapshot(), selectedBlock: null });
    expect(element._name).to.equal('Cards');
  });
  it('renders an explicit unsupported-host state', async () => {
    element.remove();
    sdk.capabilities.editor = 0;
    document.body.append(element);
    await flush();
    expect(element._hostError).to.include('does not support');
  });
  it('commits text and link changes using opaque field targets', async () => {
    const current = element._fields[0];
    await element._commitText(current, 'Updated');
    await element._commitLink({ ...current, href: '/old' }, '/new');
    expect(calls[0][1].changes[0]).to.deep.equal({ type: 'setText', target: fieldTarget, value: 'Updated' });
    expect(calls[1][1].changes[0]).to.deep.equal({ type: 'setLink', target: fieldTarget, href: '/new' });
  });
  it('makes identical blur a no-op and read-only fields non-editable', async () => {
    await element._commitText(element._fields[0], 'Hello');
    await element._commitText({ ...element._fields[0], readOnly: true }, 'No');
    expect(calls).to.have.length(0);
  });
  it('surfaces stale failures while preserving drafts and their original revisions', async () => {
    const current = element._fields[0];
    element._session.draft(current, 'value', 'Typing');
    sdk.callback(snapshot(2));
    const original = sdk.actions.applyChanges;
    sdk.actions.applyChanges = async (request) => {
      calls.push(['applyChanges', request]);
      throw Object.assign(new Error('Stale'), { code: 'STALE_REVISION' });
    };
    try {
      await element._commitText(element._fields[0], 'Typing');
      expect(calls[0][1].revision).to.equal(1);
      expect(element._fieldError).to.include('STALE_REVISION');
      expect(element._session.value(element._fields[0], 'value')).to.equal('Typing');
    } finally { sdk.actions.applyChanges = original; }
  });
  it('enforces minimum one list item and final-index reorder bounds', () => {
    const list = { ...element._fields[0], type: 'list', items: [field] };
    element._changeList(list, 0, null);
    element._changeList(list, 0, -1);
    expect(calls).to.have.length(0);
    element._changeList(list, null);
    expect(calls[0][1].changes[0]).to.include({ type: 'changeList', from: null, to: null });
  });
  it('navigates rows without computing ProseMirror offsets', () => {
    element._isMulti = true;
    element._scrollToItem(0);
    expect(calls[0]).to.deep.equal(['selectTarget', {
      documentId: 'doc', revision: 1, target: { ...blockTarget, rowIndex: 0 },
    }]);
  });
  it('appends original template rows and deletes content rows zero-based', () => {
    element._isMulti = true;
    const table = document.createElement('table');
    table.innerHTML = '<tr><td><p>Original</p></td></tr>';
    element._multiTemplateRow = table.rows[0];
    element._onAddItem();
    element._onDeleteItem(0);
    expect(calls[0][1].changes[0]).to.include({ type: 'appendBlockRow', html: '<tr><td><p>Original</p></td></tr>' });
    expect(calls[1][1].changes[0]).to.include({ type: 'deleteBlockRow', rowIndex: 0 });
  });
  it('moves multi rows to final content indexes for both keyboard and drag actions', async () => {
    sdk.callback({ ...snapshot(), blocks: [{ ...block, rows: [...block.rows, ...block.rows] }] });
    element._isMulti = true;
    element.updateComplete = Promise.resolve();
    const request = element._session.capture(blockTarget);
    await element._moveItem(request, 0, 1);
    element._dragSource = { ...request, index: 0 };
    element._dropIndex = 2;
    element._onItemDrop({ preventDefault() {}, stopPropagation() {} }, 2);
    expect(calls.map(([, payload]) => payload.changes[0])).to.deep.equal([
      { type: 'moveBlockRow', target: blockTarget, from: 0, to: 1 },
      { type: 'moveBlockRow', target: blockTarget, from: 0, to: 1 },
    ]);
  });
  it('delegates assets, uploads, and scoped block replacement to the host', async () => {
    await element._openFieldAssets(element._fields[0]);
    const file = new File(['svg'], 'image.svg', { type: 'image/svg+xml' });
    await element._uploadFieldImage(element._fields[0], element._captureField(element._fields[0]), file);
    await element._openLibrary();
    expect(calls.map(([action]) => action)).to.deep.equal(['pickAsset', 'uploadImage', 'openBlockLibrary']);
    expect(calls[1][1].file).to.equal(file);
    expect(calls[2][1].target).to.equal(blockTarget);
    expect(element._assetTarget).to.equal(null);
  });
  it('rejects uploads chosen against an obsolete revision', async () => {
    const captured = element._captureField(element._fields[0]);
    sdk.callback(snapshot(2));
    await element._uploadFieldImage(element._fields[0], captured, new File(['png'], 'image.png', { type: 'image/png' }));
    expect(calls).to.have.length(0);
    expect(element._fieldError).to.include('STALE_REVISION');
  });
  it('generates the complete library schema prompt through the chat SDK', () => {
    element._generateFieldsContext = {
      org: 'org', site: 'site', name: 'Cards', variant: '', multi: true,
      librarySources: ['https://library.example/index.json'], templateRowCount: 3,
      validationError: 'Invalid labels',
    };
    element._onGenerateFields();
    expect(calls[0][0]).to.equal('setPrompt');
    expect(calls[0][1]).to.include('exactly two rows').and.include('Invalid labels').and.include('IGNORE');
    expect(calls[0][2]).to.deep.equal({ autoSend: true });
  });
  it('retains explicit selected-block state on selection-only snapshots', () => {
    sdk.callback({ ...snapshot(), selectedBlock: null });
    expect(element._hasBlock).to.equal(false);
    expect(element._disabled).to.equal(true);
    expect(element._session.snapshot.revision).to.equal(1);
  });
  it('handles unavailable-document lifecycle snapshots explicitly', () => {
    sdk.callback({
      available: false, documentId: null, revision: 0, html: '', editable: false, blocks: [], selectedBlock: null,
    });
    expect(element._available).to.equal(false);
    expect(element._hasBlock).to.equal(false);
    expect(element._disabled).to.equal(true);
  });
  it('captures only SDK document identifiers and semantic targets', () => {
    expect(element._session).to.be.instanceOf(EditorSession);
    expect(element._captureField(element._fields[0])).to.deep.equal({
      documentId: 'doc', revision: 1, target: fieldTarget,
    });
  });
  it('keeps valid templates usable, warns about failures, and retries without changing the document', async () => {
    let recovered = false;
    const actions = {
      ...sdk.actions,
      daFetch: async (url) => {
        if (url.endsWith('.json')) {
          return new Response(JSON.stringify({
            data: ['cards', 'embed', 'broken'].map((name) => ({
              name, path: `${window.location.origin}/fixture/${name}.html`,
            })),
            editor: { data: [{ block: 'cards', property: 'multi' }] },
            options: { data: [{ blocks: 'cards', key: 'Color', values: 'Red=red' }] },
          }));
        }
        if (!recovered && url.endsWith('/embed.html')) return new Response('', { status: 404 });
        if (!recovered && url.endsWith('/broken.html')) throw new Error('Network unavailable');
        const name = url.endsWith('/cards.html') ? 'cards' : 'embed';
        return new Response(`<main><div><h2>${name} (Default)</h2>
          <div class="${name}"><div><div><p>Original</p></div></div></div>
          <h2>${name} (Left)</h2>
          <div class="${name} left"><div><div><p>Original</p></div></div></div>
        </div></main>`);
      },
      describeBlock: async ({ html }) => {
        const header = new DOMParser().parseFromString(html, 'text/html').querySelector('td').textContent;
        return { name: header.split(' (')[0], variant: header.includes('(left)') ? 'left' : '', rows: [] };
      },
    };
    library.configureLibrary(actions);
    library.resetBlockLibraryCache();
    element._hashState = { org: 'org', site: 'site' };
    element._actions = actions;
    try {
      const loaded = await library.loadBlockLibrary('org', 'site');
      expect(loaded.blocks.map((entry) => entry.name)).to.deep.equal(['cards']);
      expect(loaded.warnings.map((warning) => warning.name)).to.deep.equal(['embed', 'broken']);
      expect(loaded.warnings[0].message).to.include('404');
      expect(loaded.warnings[1].message).to.equal('Network unavailable');
      await element._reloadLibrary();
      expect(element._fieldError).to.equal('');
      expect(element._variantOptions).to.deep.equal([{ value: 'left', label: 'Left' }]);
      expect(element._multiTemplateRow.textContent).to.equal('Original');
      const rendered = JSON.stringify(element.render());
      expect(rendered).to.include('Other blocks remain available');
      expect(rendered).to.include('404');
      expect(rendered).to.include('Retry loading library');
      expect(element._generateFieldsContext.blockPath).to.include('/cards.html');
      expect(await library.loadBlockOptions('org', 'site')).to.have.length(1);

      element._name = 'embed';
      element._itemTable = { ...block, name: 'embed' };
      await element._reloadLibrary();
      expect(element._fieldError).to.include('template for embed is unavailable');
      expect(element._generateFieldsContext).to.equal(null);
      recovered = true;
      await element._onRefreshLibrary();
      expect(element._libraryWarnings).to.deep.equal([]);
      expect(element._fieldError).to.equal('');
      expect(element._generateFieldsContext.blockPath).to.include('/embed.html');
      expect(calls.some(([action]) => action === 'applyChanges')).to.equal(false);
    } finally {
      library.configureLibrary(sdk.actions);
      library.resetBlockLibraryCache();
    }
  });
  it('reports complete template failure and retries failed library loads', async () => {
    let fetches = 0;
    library.configureLibrary({
      daFetch: async (url) => {
        fetches += 1;
        return url.endsWith('.json')
          ? new Response(JSON.stringify({ data: [{ name: 'Cards', path: `${window.location.origin}/fixture/cards.html` }] }))
          : new Response('', { status: 404 });
      },
    });
    library.resetBlockLibraryCache();
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let failure;
        try {
          await library.loadBlockLibrary('org', 'site');
        } catch (error) {
          failure = error;
        }
        expect(failure).to.be.instanceOf(Error);
        expect(failure.message).to.include('No block templates could be loaded');
        expect(failure.message).to.include('404');
      }
      expect(fetches).to.equal(4);
    } finally {
      library.configureLibrary(sdk.actions);
      library.resetBlockLibraryCache();
    }
  });
  it('loads explicit local library indexes through SDK fetch and resets all sheet caches', async () => {
      let fetches = 0;
      const actions = {
        daFetch: async (url) => {
          fetches += 1;
          return new Response(url.endsWith('.json') ? JSON.stringify({
            data: { data: [{ name: 'Cards', path: `${window.location.origin}/fixture/cards.html` }] },
            ':names': ['data', 'editor', 'options'],
            editor: { data: [{ block: 'cards', property: 'multi' }] },
            options: { data: [{ blocks: 'cards', key: 'Color', values: 'Red=red' }] },
          }) : '<main><div><div class="cards"><div><div><p>Original</p></div></div></div></div></main>');
        },
      };
      library.configureLibrary(actions);
      library.resetBlockLibraryCache();
      try {
        const loaded = await library.loadBlockLibrary('org', 'site');
        expect(loaded.ext.sources[0]).to.equal(`${window.location.origin}/fixture/library.json`);
        expect(loaded.blocks).to.have.length(1);
        expect(await library.isMultiBlock('org', 'site', 'cards')).to.equal(true);
        expect(await library.loadBlockOptions('org', 'site')).to.have.length(1);
        expect(fetches).to.equal(2);
        library.resetBlockOptionsCache();
        await library.loadBlockLibrary('org', 'site');
        expect(fetches).to.equal(4);
      } catch (error) {
        console.error(error.stack);
        throw error;
      } finally {
        library.configureLibrary(sdk.actions);
        library.resetBlockLibraryCache();
      }
  });
});
