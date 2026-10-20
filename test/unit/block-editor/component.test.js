import { expect } from '@esm-bundle/chai';

describe('block editor sidebar workflow', () => {
  let Component;
  let sdk;
  let element;
  let calls;
  let library;
  let unsubscribeCount = 0;
  const liveHtml = '<main><div><div class="cards"><div><div><p>Hello</p></div></div></div></div></main>';
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
      context: { org: 'org', site: 'site', path: '/page' },
      capabilities: { liveDocument: 1, sendHTMLReplace: 1 },
      listeners: new Set(),
      actions: {
        subscribeLiveDocument: (callback) => {
          sdk.lastSubscriber = callback;
          sdk.listeners.add(callback);
          return () => { sdk.listeners.delete(callback); unsubscribeCount += 1; };
        },
        daFetch: async () => new Response(liveHtml),
        sendHTML: async () => ({ ok: true, html: liveHtml, selection: { blockIndex: 0 }, editable: true }),
        applyChanges: async (request) => {
          calls.push(['applyChanges', request]);
          return { documentId: request.documentId, revision: request.revision + 1 };
        },
        uploadImage: async (request, file) => {
          calls.push(['uploadImage', request, file]);
          return { src: 'https://content.da.live/org/site/.page/uploaded.png' };
        },
        setPrompt: async (...args) => { calls.push(['setPrompt', ...args]); },
        showPanel: (name) => { calls.push(['showPanel', name]); },
      },
    };
    sdk.emit = (value) => [...sdk.listeners].forEach((callback) => callback(value));
    window.blockEditorTestSdk = sdk;
    const url = window.location.href;
    const indexUrl = `${window.location.origin}/fixture/library.json`;
    window.history.replaceState(null, '',
      `?live=${encodeURIComponent(window.location.origin)}&library=${encodeURIComponent(indexUrl)}`);
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
    element = new Component();
    element.attachShadow({ mode: 'open' });
    document.body.append(element);
    await flush();
    element._sourceActions = element._actions;
    // Isolate UI workflows from the source adapter, which has its own integration tests.
    element._actions = sdk.actions;
    element._hashState = {};
    sdk.callback = (value) => {
      if (!element.isConnected) return;
      element._session.receive(value);
      element._refresh();
    };
    sdk.callback(snapshot());
    element._fieldDefinitions = [{
      key: 'title', label: 'Title', rowIndex: 0, cellIndex: 0, fieldIndex: 0,
      type: 'text', rowCount: 1, cellCount: 1, fieldCount: 1,
    }];
  });
  afterEach(() => element.remove());

  it('receives live caret updates and unsubscribes on removal', async () => {
    element._actions = element._sourceActions;
    sdk.emit({ html: liveHtml, selection: { blockIndex: 0 } });
    await flush();
    expect(element._name).to.equal('cards');
    expect(element._session.snapshot.html).to.equal(liveHtml);
    const selected = element._session.snapshot.liveBlockSignature;
    sdk.emit({ html: liveHtml, selection: { blockIndex: null } });
    expect(element._hasBlock).to.equal(false);
    sdk.emit({ html: liveHtml, selection: { blockIndex: 0 } });
    expect(element._session.snapshot.liveBlockSignature).to.equal(selected);
    const callback = sdk.lastSubscriber;
    const previous = unsubscribeCount;
    element.remove();
    expect(unsubscribeCount).to.equal(previous + 1);
    callback({ html: liveHtml.replace('Hello', 'Late'), selection: { blockIndex: 0 } });
    expect(element._session.snapshot.html).to.equal(liveHtml);
  });
  it('uses extension-local icons for sidebar controls and shared component configuration', async () => {
    const codeBase = `${window.location.origin}/tools/block-editor`;
    expect(window.blockEditorTestNxConfig.codeBase).to.equal(codeBase);
    const markup = (value) => {
      if (Array.isArray(value)) return value.map(markup).join('');
      if (value?.strings) return value.strings.map((text, index) => text + markup(value.values[index])).join('');
      return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
    };
    const rendered = markup([
      element.render(),
      element._renderListField({
        key: 'items', label: 'Items',
        items: [{ label: 'Item', value: 'Text', key: 'item', target: fieldTarget }],
      }, false),
    ]);
    for (const name of ['switch', 'addcircle', 'delete']) {
      expect(rendered).to.include(`${codeBase}/img/icons/s2-icon-${name}-20-n.svg#icon`);
    }
    for (const icon of ['switch-20', 'addcircle-20', 'delete-20', 'chevronleft-10']) {
      const url = `${codeBase}/img/icons/s2-icon-${icon}-n.svg`;
      const response = await fetch(url);
      expect(response.ok, url).to.equal(true);
      const doc = new DOMParser().parseFromString(await response.text(), 'image/svg+xml');
      expect(doc.querySelector('parsererror'), url).to.equal(null);
      expect(doc.querySelector('svg#icon path'), url).not.to.equal(null);
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', `${url}#icon`);
      svg.append(use);
      document.body.append(svg);
      try {
        for (let attempt = 0; attempt < 40 && !svg.getBBox().width; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        expect(svg.getBBox().width, url).to.be.greaterThan(0);
        expect(svg.getBBox().height, url).to.be.greaterThan(0);
      } finally {
        svg.remove();
      }
    }
  });
  it('renders an explicit unsupported-host state', async () => {
    element.remove();
    const original = sdk.capabilities.liveDocument;
    delete sdk.capabilities.liveDocument;
    try {
      document.body.append(element);
      await flush();
      expect(element._hostError).to.include('does not support live document subscriptions');
      expect(JSON.stringify(element.render())).to.include('does not support live document subscriptions');
    } finally { sdk.capabilities.liveDocument = original; }
  });
  it('connects via live subscription and displays live values without getSelection', async () => {
    element.remove();
    document.body.append(element);
    await flush();
    sdk.emit({ html: liveHtml, selection: { blockIndex: 0 } });
    await flush();
    expect(element._hostError).to.equal('');
    expect(element._name).to.equal('cards');
    expect(element._session.snapshot.documentId).to.equal('/org/site/page.html');
    expect(element._actions.describeBlock).to.be.a('function');
    expect(element._itemTable.rows[0].cells[0].fields[0].value).to.equal('Hello');
    expect(JSON.stringify(element.render())).not.to.include('Block values follow the live canvas');
    expect(JSON.stringify(element.render())).not.to.include('Sidebar edits save through');
    expect(JSON.stringify(element.render())).not.to.include('Reload saved document / discard drafts');
    expect(JSON.stringify(element.render())).not.to.include('Reload the canvas');
    sdk.emit({ html: liveHtml.replace('Hello', 'Caret update'), selection: { blockIndex: 0 } });
    expect(element._itemTable.rows[0].cells[0].fields[0].value).to.equal('Caret update');
  });
  it('does not carry sidebar state or pending callbacks to a new iframe document', async () => {
    element.remove();
    document.body.append(element);
    await flush();
    sdk.emit({ html: liveHtml, selection: { blockIndex: 0 } });
    await flush();
    const oldCallback = sdk.lastSubscriber;
    element.remove();
    sdk.context.path = '/next';
    try {
      document.body.append(element);
      await flush();
      sdk.emit({ html: liveHtml.replace('Hello', 'Next page'), selection: { blockIndex: 0 } });
      await flush();
      expect(element._session.snapshot.documentId).to.equal('/org/site/next.html');
      expect(element._itemTable.rows[0].cells[0].fields[0].value).to.equal('Next page');
      oldCallback({ html: liveHtml, selection: { blockIndex: 0 } });
      expect(element._session.snapshot.html).to.include('Next page');
    } finally { sdk.context.path = '/page'; }
  });
  it('commits text and link changes using opaque field targets', async () => {
    const current = element._fields[0];
    await element._commitText(current, 'Updated');
    await element._commitLink({ ...current, href: '/old' }, '/new');
    expect(calls[0][1].changes[0]).to.deep.equal({ type: 'setText', target: fieldTarget, value: 'Updated' });
    expect(calls[1][1].changes[0]).to.deep.equal({ type: 'setLink', target: fieldTarget, href: '/new' });
    expect(JSON.stringify(element.render())).not.to.include('Saved to DA');
  });
  it('does not render saving text while a document operation is pending', () => {
    element._documentBusy = true;
    expect(JSON.stringify(element.render())).not.to.include('Reading or saving document');
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
  it('enforces minimum one list item and final-index reorder bounds', async () => {
    const list = { ...element._fields[0], type: 'list', items: [field] };
    element._changeList(list, 0, null);
    element._changeList(list, 0, -1);
    expect(calls).to.have.length(0);
    element._changeList(list, null);
    await flush();
    expect(calls[0][1].changes[0]).to.include({ type: 'changeList', from: null, to: null });
  });
  it('expands rows without attempting canvas navigation', () => {
    element._isMulti = true;
    element._scrollToItem(0);
    expect(calls).to.have.length(0);
    expect(element._expandedItems.has(0)).to.equal(true);
  });
  it('appends original template rows and deletes content rows zero-based', async () => {
    element._isMulti = true;
    const table = document.createElement('table');
    table.innerHTML = '<tr><td><p>Original</p></td></tr>';
    element._multiTemplateRow = table.rows[0];
    element._onAddItem();
    await flush();
    element._onDeleteItem(0);
    await flush();
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
  it('opens the host block library for live replacement even when source editing is disabled', async () => {
    const rendered = JSON.stringify(element._renderField({
      type: 'image', value: '/image.png', label: 'Image', readOnly: true,
    }));
    expect(rendered).to.include('Replace image').and.not.to.include('Image editing is unavailable');
    element._disabled = true;
    await element._openBlockLibrary();
    expect(calls).to.deep.equal([['showPanel', 'blocks']]);
    element._documentBusy = true;
    await element._openBlockLibrary();
    expect(calls).to.have.length(1);
  });
  const chooseImage = () => {
    const image = { ...field, type: 'image', value: '/old.png' };
    sdk.callback({ ...snapshot(), blocks: [{ ...block, rows: [{ cells: [{ fields: [image] }] }] }] });
    element._fieldDefinitions = [{ ...element._fieldDefinitions[0], type: 'image' }];
    let clicked = false;
    const input = { value: 'previous', click: () => { clicked = true; } };
    element._chooseImage(element._fields[0], {
      currentTarget: { closest: () => ({ querySelector: () => input }) },
    });
    expect(clicked).to.equal(true);
    expect(input.value).to.equal('');
    return element._imageUploadTarget;
  };
  const imageEvent = (file = new File(['image'], 'image.png', { type: 'image/png' })) => ({
    target: { files: file ? [file] : [], value: 'selected' },
  });
  it('captures the image target before the picker and replaces it with the uploaded URL', async () => {
    const request = chooseImage();
    const event = imageEvent();
    const file = event.target.files[0];
    await element._uploadImage(event);
    expect(event.target.value).to.equal('');
    expect(element._imageUploadTarget).to.equal(null);
    expect(calls[0]).to.deep.equal(['uploadImage', request, file]);
    expect(calls[1]).to.deep.equal(['applyChanges', {
      ...request, changes: [{
        type: 'setImage', target: request.target, src: 'https://content.da.live/org/site/.page/uploaded.png',
      }],
    }]);
    expect(element._documentBusy).to.equal(false);
  });
  it('does nothing on picker cancellation or read-only image fields', async () => {
    chooseImage();
    await element._uploadImage(imageEvent(null));
    expect(calls).to.have.length(0);
    element._chooseImage({ ...element._fields[0], readOnly: true }, {});
    expect(element._imageUploadTarget).to.equal(null);
  });
  it('refuses an upload when the selection changed while the picker was open', async () => {
    chooseImage();
    sdk.callback({ ...snapshot(), selectedBlock: null });
    await element._uploadImage(imageEvent());
    expect(calls).to.have.length(0);
    expect(element._fieldError).to.include('selected image changed');
  });
  it('disables editing during upload and does not replace a selection changed during upload', async () => {
    chooseImage();
    const originalUpload = sdk.actions.uploadImage;
    let release;
    sdk.actions.uploadImage = () => new Promise((resolve) => { release = resolve; });
    try {
      const pending = element._uploadImage(imageEvent());
      expect(element._documentBusy).to.equal(true);
      expect(element._captureField(element._fields[0])).to.equal(null);
      sdk.callback(snapshot(2));
      release({ src: 'https://content.da.live/uploaded.png' });
      await pending;
      expect(calls).to.have.length(0);
      expect(element._fieldError).to.include('changed during upload');
      expect(element._documentBusy).to.equal(false);
    } finally { sdk.actions.uploadImage = originalUpload; }
  });
  it('shows upload errors and releases busy state without sending HTML', async () => {
    chooseImage();
    const originalUpload = sdk.actions.uploadImage;
    sdk.actions.uploadImage = async () => { throw Object.assign(new Error('Upload denied'), { code: 'UPLOAD_FAILED' }); };
    try {
      await element._uploadImage(imageEvent());
      expect(element._fieldError).to.equal('UPLOAD_FAILED: Upload denied');
      expect(element._documentBusy).to.equal(false);
      expect(calls).to.have.length(0);
    } finally { sdk.actions.uploadImage = originalUpload; }
  });
  it('ignores an upload completed after disconnect and leaves a reconnected sidebar usable', async () => {
    chooseImage();
    const originalUpload = sdk.actions.uploadImage;
    let release;
    sdk.actions.uploadImage = () => new Promise((resolve) => { release = resolve; });
    try {
      const pending = element._uploadImage(imageEvent());
      element.remove();
      document.body.append(element);
      await flush();
      release({ src: 'https://content.da.live/uploaded.png' });
      await pending;
      expect(calls).to.have.length(0);
      expect(element._documentBusy).to.equal(false);
      expect(element._imageUploadTarget).to.equal(null);
    } finally { sdk.actions.uploadImage = originalUpload; }
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
  it('shows a meaningful waiting state until live HTML arrives', async () => {
    element.remove();
    document.body.append(element);
    await flush();
    expect(JSON.stringify(element.render())).to.include('Waiting for a live canvas document');
  });
  it('keeps valid templates usable, logs failures only to console, and retries without changing the document', async () => {
    let recovered = false;
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args);
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
      expect(warnings).to.have.length(1);
      expect(warnings[0][1]).to.deep.equal(loaded.warnings);
      await element._reloadLibrary();
      expect(element._fieldError).to.equal('');
      expect(element._variantOptions).to.deep.equal([{ value: 'left', label: 'Left' }]);
      expect(element._multiTemplateRow.textContent).to.equal('Original');
      const rendered = JSON.stringify(element.render());
      expect(rendered).not.to.include('Some block templates could not be loaded');
      expect(rendered).not.to.include('404');
      expect(rendered).not.to.include('Retry loading library');
      expect(warnings).to.have.length(1);
      expect(element._generateFieldsContext.blockPath).to.include('/cards.html');
      expect(await library.loadBlockOptions('org', 'site')).to.have.length(1);

      element._name = 'embed';
      element._itemTable = { ...block, name: 'embed' };
      await element._reloadLibrary();
      expect(element._fieldError).to.include('template for embed is unavailable');
      expect(element._generateFieldsContext).to.equal(null);
      expect(JSON.stringify(element.render())).to.include('Retry loading library');
      recovered = true;
      await element._onRefreshLibrary();
      expect((await library.loadBlockLibrary('org', 'site')).warnings).to.deep.equal([]);
      expect(warnings).to.have.length(1);
      expect(element._fieldError).to.equal('');
      expect(element._generateFieldsContext.blockPath).to.include('/embed.html');
      expect(calls.some(([action]) => action === 'applyChanges')).to.equal(false);
    } finally {
      console.warn = originalWarn;
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
