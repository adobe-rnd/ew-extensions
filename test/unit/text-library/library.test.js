import { expect } from '@esm-bundle/chai';
import {
  loadTextStyles, mountTextLibrary, parseTextStyles,
} from '../../../tools/text-library/library.js';

describe('text library parsing', () => {
  it('extracts paragraphs and all heading levels in document order with rich formatting', () => {
    const items = parseTextStyles(`<header><p>Not a sample</p></header><main><div>
      <h1 class="display">Display <em>heading</em></h1>
      <h2>Heading 2</h2><h3>Heading 3</h3><h4>Heading 4</h4>
      <h5>Heading 5</h5><h6>Heading 6</h6>
      <p class="intro" style="font-size: 24px; color: red"><strong>Body</strong>
      <a href="/about">link</a><sub>2</sub><br><span>second line</span></p>
      </div></main><footer><p>Not a sample either</p></footer>`);
    expect(items.map((item) => item.label)).to.deep.equal(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p']);
    expect(items[0].html).to.equal('<h1 class="display">Display <em>heading</em></h1>');
    expect(items[6].html).to.include('class="intro"').and.include('font-size: 24px;');
    expect(items[6].html).to.include('<strong>Body</strong>').and.include('<a href="/about">link</a>');
    expect(items[6].html).to.include('<sub>2</sub><br><span>second line</span>');
  });

  it('supports plain fragments and skips empty lines and DA metadata', () => {
    const source = '<p>Sample</p><p><br></p><h2> </h2>';
    const metadata = ['metadata', 'section-metadata', 'da-metadata', 'library-metadata']
      .map((name) => `<div class="${name}"><div><p>Hidden</p></div></div>`).join('');
    expect(parseTextStyles(source + metadata).map((item) => item.text)).to.deep.equal(['Sample']);
  });

  it('emits one entry per list item and does not duplicate nested paragraphs or quotes', () => {
    const items = parseTextStyles(`<main><div>
      <ul class="bullets"><li><p>First</p><ul><li>Nested</li></ul></li><li>Second</li></ul>
      <ol start="3"><li value="4"><p>Numbered</p></li></ol>
      <blockquote><p><em>Quote</em></p><p>Attribution</p></blockquote>
      <pre><code>const sample = true;</code></pre>
      </div></main>`);
    expect(items.map((item) => item.label)).to.deep.equal(['li', 'li', 'li', 'blockquote', 'pre']);
    expect(items[0].html).to.equal('<ul class="bullets"><li><p>First</p><ul><li>Nested</li></ul></li></ul>');
    expect(items[1].html).to.equal('<ul class="bullets"><li>Second</li></ul>');
    expect(items[2].html).to.equal('<ol start="3"><li value="4"><p>Numbered</p></li></ol>');
    expect(items[3].html).to.include('<p><em>Quote</em></p><p>Attribution</p>');
  });

  it('removes active content and attributes without losing safe text formatting', () => {
    const [item] = parseTextStyles(`<p id="duplicate" onclick="alert(1)"
      style="position: fixed; background-image: url(https://example.com/image); font-weight: bold">
      Text<script>alert(1)</script><iframe src="https://example.com"></iframe>
      <a href="javascript:alert(1)" onmouseover="alert(1)">bad link</a>
      <a href="java&#10;script:alert(1)">obfuscated</a><a href="https://example.com">safe</a>
      <span style="color: var(--external); font-style: italic">formatted</span>
      </p>`);
    expect(item.html).not.to.match(/script|iframe|onclick|onmouseover|id=|position|background-image|var\(/);
    expect(item.html).to.include('font-weight: bold').and.include('font-style: italic');
    expect(item.html).to.include('<a>bad link</a>').and.include('<a>obfuscated</a>');
    expect(item.html).to.include('<a href="https://example.com">safe</a>');
  });
});

describe('text library source loading', () => {
  it('reads the current site source through authenticated SDK fetch without a publish step', async () => {
    let request;
    const items = await loadTextStyles({
      project: { org: 'other', site: 'other' },
      context: { org: 'example', site: 'website' },
      actions: {
        daFetch: async (...args) => {
          request = args;
          return new Response('<main><div><h2>Sample</h2></div></main>');
        },
      },
    });
    expect(request).to.deep.equal([
      'https://admin.da.live/source/example/website/docs/library/text-styles.html',
      { cache: 'no-store' },
    ]);
    expect(items[0].text).to.equal('Sample');
  });

  it('supports project repo context and reports missing context before fetching', async () => {
    let calls = 0;
    const actions = {
      daFetch: async (url) => {
        calls += 1;
        expect(url).to.include('/source/example/website/');
        return new Response('<p>Text</p>');
      },
    };
    expect(await loadTextStyles({ project: { org: 'example', repo: 'website' }, actions })).to.have.length(1);
    try {
      await loadTextStyles({ actions });
      expect.fail('Expected a context error');
    } catch (error) {
      expect(error.message).to.include('Open Text Library from a page');
    }
    expect(calls).to.equal(1);
  });

  it('prefers the active context repo over the project site', async () => {
    let requested;
    await loadTextStyles({
      project: { org: 'other', site: 'other' },
      context: { org: 'current', repo: 'current-site' },
      actions: {
        daFetch: async (url) => {
          requested = url;
          return new Response('');
        },
      },
    });
    expect(requested).to.equal('https://admin.da.live/source/current/current-site/docs/library/text-styles.html');
  });

  [401, 403, 404, 500].forEach((status) => {
    it(`reports source HTTP ${status} without falling back to published content`, async () => {
      let calls = 0;
      try {
        await loadTextStyles({
          context: { org: 'example', site: 'website' },
          actions: {
            daFetch: async () => {
              calls += 1;
              return new Response('', { status });
            },
          },
        });
        expect.fail('Expected a source error');
      } catch (error) {
        if (status === 404) expect(error.message).to.include('Create /docs/library/text-styles');
        else if (status === 401 || status === 403) expect(error.message).to.include('Access denied');
        else expect(error.message).to.include('(500)');
      }
      expect(calls).to.equal(1);
    });
  });
});

describe('text library panel', () => {
  let root;
  let destroy;
  let sdk;
  let dragOptions;
  let inserted;
  let disposed;

  const ready = async () => {
    await new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        if (root.getAttribute('aria-busy') === 'false') {
          observer.disconnect();
          resolve();
        }
      });
      if (root.getAttribute('aria-busy') === 'false') resolve();
      else observer.observe(root, { attributes: true });
    });
  };

  beforeEach(() => {
    root = document.createElement('main');
    document.body.append(root);
    dragOptions = [];
    inserted = [];
    disposed = 0;
    sdk = {
      context: { org: 'example', site: 'website' },
      actions: {
        daFetch: async () => new Response('<h2 class="display">Heading <em>style</em></h2><p>Body</p>'),
        makeDraggable: async (options) => {
          dragOptions.push(options);
          return () => { disposed += 1; };
        },
        sendHTML: (html) => { inserted.push(html); },
      },
    };
  });

  afterEach(() => {
    destroy?.();
    destroy = undefined;
    root.remove();
  });

  it('registers HTML and plain-text drag payloads and inserts the same HTML by click or keyboard', async () => {
    destroy = mountTextLibrary(root, sdk);
    await ready();
    expect(dragOptions).to.have.length(2);
    const payload = dragOptions[0].getData();
    expect(payload).to.deep.equal({
      data: { 'text/html': '<h2 class="display">Heading <em>style</em></h2>', 'text/plain': 'Heading style' },
    });
    const previews = root.querySelectorAll('.style-preview');
    expect(dragOptions[0].element).to.equal(root.querySelector('.style-card'));
    expect(dragOptions[0].element.contains(root.querySelector('.style-label'))).to.equal(true);
    previews[0].click();
    previews[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    previews[1].dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(inserted).to.deep.equal([payload.data['text/html'], '<p>Body</p>', '<p>Body</p>']);
    dragOptions[0].onResult({ ok: false, error: 'read-only' });
    expect(root.querySelector('.status').textContent).to.include('read-only');
    dragOptions[0].onResult({ ok: true });
    expect(root.querySelector('.status').textContent).to.equal('Text inserted.');
  });

  it('refreshes source content and disposes old drag bindings', async () => {
    destroy = mountTextLibrary(root, sdk);
    await ready();
    sdk.actions.daFetch = async () => new Response('<p>New text</p>');
    root.querySelector('button').click();
    await ready();
    expect(disposed).to.equal(2);
    expect(root.querySelectorAll('.style-card')).to.have.length(1);
    expect(dragOptions[2].getData().data['text/html']).to.equal('<p>New text</p>');
    destroy();
    destroy = undefined;
    expect(disposed).to.equal(3);
  });

  it('shows an error with a working retry and then an empty state', async () => {
    sdk.actions.daFetch = async () => new Response('', { status: 404 });
    destroy = mountTextLibrary(root, sdk);
    await ready();
    expect(root.querySelector('.status').textContent).to.include('Create /docs/library/text-styles');
    expect(root.querySelector('button').disabled).to.equal(false);
    sdk.actions.daFetch = async () => new Response('<p><br></p>');
    root.querySelector('button').click();
    await ready();
    expect(root.querySelector('.status').textContent).to.include('No text styles yet');
    expect(dragOptions).to.have.length(0);
  });

  it('does not render a source response after the panel is destroyed', async () => {
    let finish;
    sdk.actions.daFetch = () => new Promise((resolve) => { finish = resolve; });
    destroy = mountTextLibrary(root, sdk);
    destroy();
    destroy = undefined;
    finish(new Response('<p>Too late</p>'));
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(root.querySelectorAll('.style-card')).to.have.length(0);
    expect(dragOptions).to.have.length(0);
  });

  it('cleans up every binding when another drag registration fails', async () => {
    sdk.actions.makeDraggable = async ({ getData }) => {
      if (getData().data['text/plain'] === 'Body') throw new Error('Drag unavailable');
      await new Promise((resolve) => { setTimeout(resolve, 0); });
      return () => { disposed += 1; };
    };
    destroy = mountTextLibrary(root, sdk);
    await ready();
    expect(root.querySelector('.status').textContent).to.equal('Drag unavailable');
    expect(root.querySelectorAll('.style-card')).to.have.length(0);
    expect(disposed).to.equal(1);
  });

  it('disposes bindings that finish registering after the panel is destroyed', async () => {
    const pending = [];
    sdk.actions.makeDraggable = () => new Promise((resolve) => { pending.push(resolve); });
    const registrations = new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        if (pending.length === 2) {
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(root, { subtree: true, childList: true });
    });
    destroy = mountTextLibrary(root, sdk);
    await registrations;
    destroy();
    destroy = undefined;
    pending.forEach((resolve) => resolve(() => { disposed += 1; }));
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(disposed).to.equal(2);
    expect(root.querySelectorAll('.style-card')).to.have.length(0);
  });
});
