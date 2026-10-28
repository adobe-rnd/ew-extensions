import { expect } from '@esm-bundle/chai';
import { createDocumentActions, describeBlock, MAX_IMAGE_BYTES } from '../../../tools/block-editor/document.js';
import { EditorSession } from '../../../tools/block-editor/fields.js';

describe('block editor live HTML replacement adapter', () => {
  const original = `<main><div><p>Keep outside content</p><div class="cards compact">
    <div><div><h3>Unique title</h3><p><a href="/old">Link label</a></p><ul><li>One</li><li>Two</li></ul><picture><img src="/media.png"></picture></div></div>
    <div><div><h3>Second title</h3></div></div></div>
    <div class="metadata"><div><div>Key</div><div>Value</div></div></div></div></main>`;
  let live;
  let sdk;
  let actions;
  let snapshots;
  let calls;
  let resultError;

  beforeEach(() => {
    live = original;
    snapshots = [];
    calls = [];
    resultError = null;
    sdk = {
      project: { org: 'org', repo: 'site', path: '/page' },
      capabilities: { sendHTMLReplace: 1 },
      actions: {
        daFetch: async (url) => {
          calls.push(['daFetch', url]);
          return new Response(JSON.stringify({ library: { data: [] } }));
        },
        sendHTML: async (html, options) => {
          calls.push(['sendHTML', html, options]);
          if (resultError) return { ok: false, error: resultError };
          if (options.expected.html !== live) return { ok: false, error: 'STALE_LIVE' };
          const doc = new DOMParser().parseFromString(live, 'text/html');
          const blocks = [...doc.querySelectorAll('main > div > div[class], main > div > table')]
            .filter((element) => !element.matches('.metadata'));
          const replacement = new DOMParser().parseFromString(html, 'text/html').body.firstElementChild;
          blocks[options.expected.blockIndex].replaceWith(replacement);
          live = doc.querySelector('main').outerHTML;
          return { ok: true, html: live, selection: { blockIndex: options.expected.blockIndex }, editable: true };
        },
      },
    };
    actions = createDocumentActions(sdk, { onSnapshot: (snapshot) => snapshots.push(snapshot) });
  });
  afterEach(() => actions.dispose());
  const latest = () => snapshots[snapshots.length - 1];
  const select = (blockIndex = 0, html = live, editable = true) => (
    actions.receiveLiveDocument({ html, selection: { blockIndex }, editable })
  );
  const apply = (change, snapshot = latest()) => actions.applyChanges({
    documentId: snapshot.documentId, revision: snapshot.revision,
    liveBlockSignature: snapshot.liveBlockSignature, changes: [change],
  });
  const target = (extra = {}) => ({ ...latest().selectedBlock, rowIndex: 0, cellIndex: 0, fieldIndex: 0, ...extra });
  const imageFile = () => new File(['image'], 'photo.png', { type: 'image/png' });
  const imageRequest = () => ({
    documentId: latest().documentId, revision: latest().revision,
    liveBlockSignature: latest().liveBlockSignature, target: target({ fieldIndex: 3 }),
  });
  const serveUpload = (payload = { source: { contentUrl: 'https://content.da.live/org/site/.page/new.png' } }, status = 200) => {
    sdk.actions.daFetch = async (url, options) => {
      calls.push(['daFetch', url, options]);
      return new Response(JSON.stringify(payload), { status });
    };
  };
  const expectError = async (promise, code) => {
    let error;
    try { await promise; } catch (caught) { error = caught; }
    expect(error?.code).to.equal(code);
  };

  it('uses live selection immediately without reading saved source or requiring a saved/live match', () => {
    select();
    expect(calls).to.have.length(0);
    expect(latest().editable).to.equal(true);
    expect(latest().documentId).to.equal('/org/site/page.html');
    expect(latest().blocks[0].rows[0].cells[0].fields[3].previewSrc)
      .to.equal('https://main--site--org.aem.live/media.png');
    const edited = original.replace('Unique title', 'Unsaved canvas title');
    select(0, edited);
    expect(latest().editable).to.equal(true);
    expect(latest().revision).to.equal(edited);
  });
  it('reads library configuration through authenticated fetching, not document source', async () => {
    const config = await actions.getEditorConfig();
    expect(config.configs).to.have.length(2);
    expect(calls).to.deep.equal([
      ['daFetch', 'https://admin.da.live/config/org'],
      ['daFetch', 'https://admin.da.live/config/org/site'],
    ]);
  });
  it('sends only the full changed block with a host-side document and selection precondition', async () => {
    select();
    const signature = latest().liveBlockSignature;
    await apply({ type: 'setText', target: target(), value: '<script>literal</script>\nNext' });
    expect(calls).to.have.length(1);
    const [action, html, options] = calls[0];
    expect(action).to.equal('sendHTML');
    expect(options).to.deep.equal({ replace: true, expected: { html: original, blockIndex: 0 } });
    expect(html).not.to.include('<main>').and.not.to.include('Keep outside content');
    expect(html).to.include('&lt;script&gt;literal&lt;/script&gt;<br>Next');
    expect(live).to.include('Keep outside content').and.include('Key').and.include('/media.png');
    expect(latest().revision).to.equal(live);
    expect(latest().liveBlockSignature).not.to.equal(signature);
    expect(latest().editable).to.equal(true);
  });
  it('supports consecutive text and link edits without source reloads', async () => {
    select();
    await apply({ type: 'setText', target: target({ fieldIndex: 1 }), value: 'New label' });
    await apply({ type: 'setLink', target: target({ fieldIndex: 1 }), href: '/new' });
    expect(live).to.include('<a href="/new">New label</a>');
    await expectError(apply({ type: 'setLink', target: target({ fieldIndex: 1 }), href: 'javascript:alert(1)' }), 'INVALID_CHANGE');
    expect(calls).to.have.length(2);
  });
  it('edits uniformly formatted fields without removing headings or inline wrappers', async () => {
    live = original.replace('<h3>Unique title</h3>',
      '<h3 class="title"> <em><strong>Uniform heading</strong></em> </h3><p><strong>Display feature</strong></p>');
    select();
    const fields = latest().blocks[0].rows[0].cells[0].fields;
    expect(fields.slice(0, 2).map((field) => field.readOnly)).to.deep.equal([false, false]);
    await apply({ type: 'setText', target: target(), value: 'New <heading>\nNext line' });
    await apply({ type: 'setText', target: target({ fieldIndex: 1 }), value: 'New feature' });
    const doc = new DOMParser().parseFromString(live, 'text/html');
    expect(doc.querySelector('h3').outerHTML)
      .to.equal('<h3 class="title"> <em><strong>New &lt;heading&gt;<br>Next line</strong></em> </h3>');
    expect(doc.querySelector('.cards p strong').outerHTML).to.equal('<strong>New feature</strong>');
    expect(latest().blocks[0].rows[0].cells[0].fields[0].value).to.equal('New <heading>\nNext line');
  });
  it('preserves uniform formatting around and inside links and list items', async () => {
    live = original.replace('<h3>Unique title</h3>',
      '<h3><strong><a href="/old"><em>Uniform link</em></a></strong></h3>')
      .replace('<li>One</li>', '<li><p><strong>One</strong></p></li>');
    select();
    expect(latest().blocks[0].rows[0].cells[0].fields[0].readOnly).to.equal(false);
    expect(latest().blocks[0].rows[0].cells[0].fields[2].items[0].readOnly).to.equal(false);
    await apply({ type: 'setText', target: target(), value: 'New link' });
    await apply({ type: 'setLink', target: target(), href: '/new' });
    await apply({ type: 'setText', target: target({ fieldIndex: 2, itemIndex: 0 }), value: 'New item' });
    expect(live).to.include('<h3><strong><a href="/new"><em>New link</em></a></strong></h3>');
    expect(live).to.include('<li><p><strong>New item</strong></p></li>');
  });
  it('keeps partially formatted text and ambiguous links read-only without posting changes', async () => {
    const cases = [
      '<h3>Plain <strong>bold</strong></h3>',
      '<h3><strong>Bold <em>partially italic</em></strong></h3>',
      '<p><strong>$99.99 </strong><s><strong>$349.99</strong></s></p>',
      '<p>Prefix <a href="/old">link</a></p>',
      '<p><a href="/one">One</a><a href="/two">Two</a></p>',
    ];
    for (const html of cases) {
      live = original.replace('<h3>Unique title</h3>', html);
      select();
      expect(latest().blocks[0].rows[0].cells[0].fields[0].readOnly).to.equal(true);
      const before = live;
      await expectError(apply({ type: 'setText', target: target(), value: 'No' }), 'READ_ONLY');
      expect(live).to.equal(before);
    }
    expect(calls).to.have.length(0);
  });
  it('rebases a second focused field onto an acknowledged HTML replacement', async () => {
    select();
    const session = new EditorSession();
    session.receive(latest());
    const [title, link] = latest().blocks[0].rows[0].cells[0].fields;
    session.draft(title, 'value', 'New title');
    const first = session.edit(title, 'value', 'New title');
    const saving = apply({ type: 'setText', target: title.target, value: 'New title' }, first.request);
    session.draft(link, 'value', 'New label');
    await saving;
    session.receive(latest());
    expect(session.acknowledge(first, 'value', 'New title')).to.equal(true);
    const second = session.edit(link, 'value', 'New label');
    expect(second.conflict).to.equal(false);
    expect(second.request.revision).to.equal(latest().html);
    expect(second.request.liveBlockSignature).to.equal(latest().liveBlockSignature);
    await apply({ type: 'setText', target: link.target, value: 'New label' }, second.request);
    expect(live).to.include('<h3>New title</h3>').and.include('<a href="/old">New label</a>');
    expect(calls).to.have.length(2);
  });
  it('rebases newer typing in the same field without losing acknowledged intermediate text', async () => {
    select();
    const session = new EditorSession();
    session.receive(latest());
    const title = latest().blocks[0].rows[0].cells[0].fields[0];
    session.draft(title, 'value', 'First edit');
    const first = session.edit(title, 'value', 'First edit');
    const saving = apply({ type: 'setText', target: title.target, value: 'First edit' }, first.request);
    session.draft(title, 'value', 'Second edit');
    await saving;
    session.receive(latest());
    expect(session.acknowledge(first, 'value', 'First edit')).to.equal(true);
    const second = session.edit(title, 'value', 'Second edit');
    expect(second.conflict).to.equal(false);
    await apply({ type: 'setText', target: title.target, value: 'Second edit' }, second.request);
    session.receive(latest());
    expect(session.acknowledge(second, 'value', 'Second edit')).to.equal(true);
    expect(live).to.include('<h3>Second edit</h3>');
    expect(session.drafts.size).to.equal(0);
  });
  it('sends the updated table when the host snapshot contains a raw block table', async () => {
    live = '<main><div><table><tr><td>hero</td></tr><tr><td><h1>Original</h1></td></tr></table></div></main>';
    select();
    await apply({ type: 'setText', target: target(), value: 'Updated table' });
    expect(calls[0][1]).to.include('<h1>Updated table</h1>');
    expect(latest().blocks[0].rows[0].cells[0].fields[0].value).to.equal('Updated table');
  });
  it('supports list edits, additions, reordering and deletion', async () => {
    select();
    await apply({ type: 'setText', target: target({ fieldIndex: 2, itemIndex: 0 }), value: 'Updated' });
    await apply({ type: 'changeList', target: target({ fieldIndex: 2 }), from: null, to: null });
    await apply({ type: 'changeList', target: target({ fieldIndex: 2 }), from: 0, to: 2 });
    await apply({ type: 'changeList', target: target({ fieldIndex: 2 }), from: 0, to: null });
    expect(new DOMParser().parseFromString(live, 'text/html').querySelector('ul').textContent).to.equal('New itemUpdated');
  });
  it('supports variant, append, move and delete operations through live replacement', async () => {
    select();
    await apply({ type: 'setBlockVariant', target: latest().selectedBlock, value: 'wide, dark' });
    await apply({ type: 'appendBlockRow', target: latest().selectedBlock, html: '<tr><td><p>Third</p></td></tr>' });
    await apply({ type: 'moveBlockRow', target: latest().selectedBlock, from: 2, to: 0 });
    await apply({ type: 'deleteBlockRow', target: latest().selectedBlock, rowIndex: 1 });
    expect(latest().blocks[0].variant).to.equal('wide, dark');
    expect(latest().blocks[0].rows).to.have.length(2);
    expect(latest().blocks[0].rows[0].cells[0].fields[0].value).to.equal('Third');
  });
  it('can safely target an identical block by its live ordinal', async () => {
    const doc = new DOMParser().parseFromString(live, 'text/html');
    const block = doc.querySelector('.cards');
    block.after(block.cloneNode(true));
    live = doc.querySelector('main').outerHTML;
    select(1);
    await apply({ type: 'setText', target: target(), value: 'Only second block' });
    const blocks = new DOMParser().parseFromString(live, 'text/html').querySelectorAll('.cards');
    expect(blocks[0].textContent).to.include('Unique title');
    expect(blocks[1].textContent).to.include('Only second block');
  });
  it('rejects stale drafts and wrong selections before posting', async () => {
    select();
    const captured = latest();
    const change = { type: 'setText', target: target(), value: 'No' };
    select(0, original.replace('Unique title', 'Collaborator edit'));
    await expectError(apply(change, captured), 'STALE_LIVE');
    select();
    select(null);
    await expectError(apply(change, latest()), 'WRONG_SELECTION');
    expect(calls).to.have.length(0);
  });
  it('surfaces host-side stale state, permission, unsupported and timeout failures without clearing the snapshot', async () => {
    select();
    const before = latest();
    for (const error of ['STALE_LIVE', 'READ_ONLY', 'unsupported', 'timeout']) {
      resultError = error;
      await expectError(apply({ type: 'setText', target: target(), value: 'No' }), error);
      expect(latest()).to.equal(before);
    }
  });
  it('keeps read-only live documents non-editable and refuses unsupported SDKs', async () => {
    select(0, live, false);
    expect(latest().editable).to.equal(false);
    await expectError(apply({ type: 'setText', target: target(), value: 'No' }), 'READ_ONLY');
    select();
    delete sdk.capabilities.sendHTMLReplace;
    await expectError(apply({ type: 'setText', target: target(), value: 'No' }), 'UNSUPPORTED');
    expect(calls).to.have.length(0);
  });
  it('does not overwrite a newer live update with an older acknowledgement', async () => {
    select();
    sdk.actions.sendHTML = async () => {
      actions.receiveLiveDocument({ html: original.replace('Unique title', 'Newer edit'), selection: { blockIndex: 0 } });
      return { ok: true, html: original.replace('Unique title', 'Acknowledged edit'), selection: { blockIndex: 0 } };
    };
    await apply({ type: 'setText', target: target(), value: 'Acknowledged edit' });
    expect(latest().html).to.include('Newer edit');
  });
  it('blocks overlapping replacements and ignores late replies after removal', async () => {
    select();
    let release;
    sdk.actions.sendHTML = () => new Promise((resolve) => { release = resolve; });
    const pending = apply({ type: 'setText', target: target(), value: 'Pending' });
    await expectError(apply({ type: 'setText', target: target(), value: 'Overlap' }), 'BUSY');
    actions.dispose();
    release({ ok: true, html: original, selection: { blockIndex: 0 } });
    await expectError(pending, 'WRONG_DOCUMENT');
    expect(actions.receiveLiveDocument({ html: original, selection: { blockIndex: null } })).to.equal(null);
  });
  it('rejects malformed live snapshots and acknowledgements', async () => {
    select();
    sdk.actions.sendHTML = async () => ({ ok: true });
    await expectError(apply({ type: 'setText', target: target(), value: 'No' }), 'INVALID_RESPONSE');
    expect(() => actions.receiveLiveDocument({ html: live, selection: { blockIndex: -1 } })).to.throw('valid live document');
  });
  it('allows single images but keeps partially formatted text and ambiguous image fields read-only', () => {
    const block = describeBlock({ html: '<table><tr><td>Hero (wide)</td></tr><tr><td><p>Partially <strong>rich</strong></p><picture><img src="/image.png"></picture></td></tr></table>' });
    expect(block.name).to.equal('Hero');
    expect(block.variant).to.equal('wide');
    expect(block.rows[0].cells[0].fields.map((field) => field.readOnly)).to.deep.equal([true, false]);
    const ambiguous = describeBlock({ html: '<table><tr><td>Hero</td></tr><tr><td><p>Caption<img src="/one.png"></p><p><img src="/one.png"><img src="/two.png"></p></td></tr></table>' });
    expect(ambiguous.rows[0].cells[0].fields.every((field) => field.readOnly)).to.equal(true);
  });
  it('uploads only the asset with authentication and applies its returned URL through guarded replacement', async () => {
    select();
    serveUpload();
    const request = imageRequest();
    const file = imageFile();
    const { src } = await actions.uploadImage(request, file);
    expect(calls).to.have.length(1);
    const [, url, options] = calls[0];
    expect(url).to.match(/^https:\/\/admin\.da\.live\/source\/org\/site\/\.page\/photo-[\da-f-]+\.png$/);
    expect(options.method).to.equal('POST');
    expect(options.body).to.be.instanceOf(FormData);
    const uploaded = options.body.get('data');
    expect(uploaded.name).to.equal(url.split('/').pop());
    expect(uploaded.type).to.equal('image/png');
    expect(await uploaded.text()).to.equal(await file.text());
    expect(live).to.equal(original);
    await apply({ type: 'setImage', target: request.target, src });
    expect(calls[1][0]).to.equal('sendHTML');
    expect(calls[1][2]).to.deep.equal({ replace: true, expected: { html: original, blockIndex: 0 } });
    expect(latest().blocks[0].rows[0].cells[0].fields[3].value).to.equal(src);
    await apply({ type: 'setText', target: target(), value: 'After image replacement' });
    expect(live).to.include(src).and.include('After image replacement').and.include('Keep outside content');
  });
  it('uses the configured API environment, document folder and unique asset names', async () => {
    sdk.context = { path: '/folder/demo.html' };
    actions.dispose();
    actions = createDocumentActions(sdk, {
      admin: 'https://stage-admin.da.live', onSnapshot: (snapshot) => snapshots.push(snapshot),
    });
    select();
    serveUpload();
    await actions.uploadImage(imageRequest(), imageFile());
    await actions.uploadImage(imageRequest(), imageFile());
    expect(calls[0][1]).to.match(/^https:\/\/stage-admin\.da\.live\/source\/org\/site\/folder\/\.demo\/photo-/);
    expect(calls[0][1]).not.to.equal(calls[1][1]);
  });
  it('preserves alt text, picture structure and enclosing links while replacing all old responsive sources', async () => {
    live = original.replace('<picture><img src="/media.png"></picture>',
      '<a href="/destination"><picture><source srcset="/small.png 1x, /large.png 2x" type="image/png" sizes="50vw" media="(min-width: 600px)"><img src="/media.png" srcset="/large.png 2x" sizes="50vw" width="100" height="50" alt="Keep this alt"></picture></a>');
    select();
    await apply({ type: 'setImage', target: target({ fieldIndex: 3 }), src: 'https://content.da.live/new.jpg' });
    const doc = new DOMParser().parseFromString(live, 'text/html');
    const image = doc.querySelector('img');
    expect(image.getAttribute('src')).to.equal('https://content.da.live/new.jpg');
    expect(image.alt).to.equal('Keep this alt');
    expect(image.closest('a').getAttribute('href')).to.equal('/destination');
    for (const attribute of ['srcset', 'sizes', 'width', 'height']) expect(image.hasAttribute(attribute)).to.equal(false);
    const source = doc.querySelector('source');
    expect(source.getAttribute('srcset')).to.equal('https://content.da.live/new.jpg');
    expect(source.getAttribute('media')).to.equal('(min-width: 600px)');
    expect(source.hasAttribute('type')).to.equal(false);
    expect(source.hasAttribute('sizes')).to.equal(false);
  });
  it('rejects invalid, empty, oversized and unsafe filenames before uploading', async () => {
    select();
    const invalid = [
      null, new File([], 'empty.png', { type: 'image/png' }),
      new File(['x'], 'image.webp', { type: 'image/webp' }),
      new File(['x'], 'image.png', { type: 'text/html' }),
      new File(['x'], '../image.png', { type: 'image/png' }),
      new File(['x'], 'image.constructor'),
    ];
    for (const file of invalid) await expectError(actions.uploadImage(imageRequest(), file), 'INVALID_FILE');
    const file = imageFile();
    Object.defineProperty(file, 'size', { value: MAX_IMAGE_BYTES + 1, configurable: true });
    await expectError(actions.uploadImage(imageRequest(), file), 'IMAGE_TOO_LARGE');
    expect(calls).to.have.length(0);
    Object.defineProperty(file, 'size', { value: MAX_IMAGE_BYTES });
    serveUpload();
    expect((await actions.uploadImage(imageRequest(), file)).src).to.include('https://content.da.live/');
  });
  it('surfaces failed uploads and missing or unsafe URLs without sending editor HTML', async () => {
    select();
    serveUpload({}, 403);
    await expectError(actions.uploadImage(imageRequest(), imageFile()), 'UPLOAD_FAILED');
    for (const payload of [{}, { source: { contentUrl: 'data:image/png;base64,a' } }, { source: { contentUrl: '/broken.png' } }, { source: { contentUrl: 'https://' } }]) {
      serveUpload(payload);
      await expectError(actions.uploadImage(imageRequest(), imageFile()), 'INVALID_IMAGE');
    }
    expect(calls.every(([action]) => action === 'daFetch')).to.equal(true);
    serveUpload();
    expect(await actions.uploadImage(imageRequest(), imageFile())).to.have.property('src');
  });
  it('accepts supported image formats and restores availability after network or malformed response failures', async () => {
    select();
    for (const [name, type] of [
      ['photo.JPG', 'image/jpeg'], ['photo.jpeg', 'image/jpeg'],
      ['photo.gif', 'image/gif'], ['photo.svg', 'image/svg+xml'], ['photo.png', ''],
    ]) {
      serveUpload();
      expect(await actions.uploadImage(imageRequest(), new File(['image'], name, { type }))).to.have.property('src');
      expect(calls[calls.length - 1][2].body.get('data').type).to.equal(type || 'image/png');
    }
    for (const fetch of [
      async () => { throw new Error('Network unavailable'); },
      async () => new Response('not JSON'),
    ]) {
      sdk.actions.daFetch = fetch;
      let error;
      try { await actions.uploadImage(imageRequest(), imageFile()); } catch (caught) { error = caught; }
      expect(error).to.be.instanceOf(Error);
      expect(calls.some(([action]) => action === 'sendHTML')).to.equal(false);
    }
    serveUpload();
    expect(await actions.uploadImage(imageRequest(), imageFile())).to.have.property('src');
  });
  it('refuses stale, read-only and non-image upload targets before fetching', async () => {
    select();
    const captured = imageRequest();
    select(0, original.replace('Unique title', 'Changed'));
    await expectError(actions.uploadImage(captured, imageFile()), 'STALE_LIVE');
    select(0, live, false);
    await expectError(actions.uploadImage(imageRequest(), imageFile()), 'READ_ONLY');
    select();
    await expectError(actions.uploadImage({ ...imageRequest(), target: target() }, imageFile()), 'READ_ONLY');
    expect(calls).to.have.length(0);
  });
  it('blocks overlapping operations and rejects changes to the document or selection during upload', async () => {
    select();
    let release;
    sdk.actions.daFetch = () => new Promise((resolve) => { release = resolve; });
    const pending = actions.uploadImage(imageRequest(), imageFile());
    await expectError(actions.uploadImage(imageRequest(), imageFile()), 'BUSY');
    await expectError(apply({ type: 'setText', target: target(), value: 'Overlap' }), 'BUSY');
    select(null);
    release(new Response(JSON.stringify({ source: { contentUrl: 'https://content.da.live/new.png' } })));
    await expectError(pending, 'WRONG_SELECTION');
    select();
    const stale = actions.uploadImage(imageRequest(), imageFile());
    select(0, original.replace('Unique title', 'Collaborator'));
    release(new Response(JSON.stringify({ source: { contentUrl: 'https://content.da.live/new.png' } })));
    await expectError(stale, 'STALE_LIVE');
    const disposed = actions.uploadImage(imageRequest(), imageFile());
    actions.dispose();
    release(new Response(JSON.stringify({ source: { contentUrl: 'https://content.da.live/new.png' } })));
    await expectError(disposed, 'WRONG_DOCUMENT');
    expect(calls).to.have.length(0);
  });
});
