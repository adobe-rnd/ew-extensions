# Extension Templates

All placeholders:

- `__NAME__` → kebab-case extension name (e.g. `my-widget`)
- `__TAG__` → custom element tag (e.g. `nx-my-widget` for blocks, `my-widget-app` for tools)
- `__TITLE__` → human-readable title (e.g. `My Widget`)
- `__CLASS__` → PascalCase class name (e.g. `NxMyWidget` for blocks, `MyWidgetApp` for tools)

---

## Block templates

### `blocks/__NAME__/__NAME__.js` — Block contract entry

```js
import './__TAG__.js';

export default function decorate(block) {
  block.textContent = '';
  const el = document.createElement('__TAG__');
  block.append(el);
}
```

### `blocks/__NAME__/utils/utils.js` — loadStyle utility

Inlined from `da-nx/nx2/utils/utils.js`. Loads CSS as `CSSStyleSheet` objects
for use with `adoptedStyleSheets`.

```js
export const loadStyle = (() => {
  const cache = {};

  return (supplied) => {
    const path = supplied.replace('.js', '.css');

    try {
      cache[path] ??= import(path, { with: { type: 'css' } })
        .then(({ default: sheet }) => sheet);
    } catch {
      cache[path] ??= new Promise((resolve) => {
        (async () => {
          const resp = await fetch(path);
          const text = await resp.text();
          const sheet = new CSSStyleSheet();
          sheet.path = path;
          sheet.replaceSync(text);
          resolve(sheet);
        })();
      });
    }
    return cache[path];
  };
})();
```

### `blocks/__NAME__/__TAG__.js` — Main LitElement

Uses shadow DOM (LitElement default) with `adoptedStyleSheets` for scoped CSS.

```js
import { LitElement, html, nothing } from 'da-lit';
import { loadStyle } from './utils/utils.js';

const styles = await loadStyle(import.meta.url);

class __CLASS__ extends LitElement {
  static properties = {
    _ready: { state: true },
  };

  constructor() {
    super();
    this._ready = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [styles];
    this._ready = true;
  }

  render() {
    if (!this._ready) return html`<p>Loading…</p>`;
    return html`
      <div class="__NAME__-container">
        <h2>__TITLE__</h2>
        <p>Extension loaded.</p>
      </div>
    `;
  }
}

customElements.define('__TAG__', __CLASS__);
```

### `blocks/__NAME__/__TAG__.css` — Component styles (shadow DOM scoped)

```css
.__NAME__-container {
  padding: 24px;
  font-family: adobe-clean, 'Source Sans Pro', -apple-system, BlinkMacSystemFont, sans-serif;
}
```

### `blocks/__NAME__/__NAME__.html` — Standalone dev page

```html
<!DOCTYPE html>
<html>
  <head>
    <title>__TITLE__</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="data:," />
    <script type="importmap">
      {
        "imports": {
          "da-lit": "https://da.live/deps/lit/dist/index.js"
        }
      }
    </script>
    <link rel="stylesheet" href="https://da.live/nx2/styles/styles.css" />
    <link rel="stylesheet" href="https://use.typekit.net/pfo1jpc.css" />
    <script src="/blocks/__NAME__/__NAME__.js" type="module"></script>
    <style>
      body { margin: 0; font-family: adobe-clean, 'Source Sans Pro', -apple-system, BlinkMacSystemFont, sans-serif; }
      __TAG__ { display: block; min-height: 100vh; }
    </style>
  </head>
  <body>
    <__TAG__></__TAG__>
  </body>
</html>
```

---

## Tool templates

### `tools/__NAME__/__NAME__.js` — LitElement app with DA SDK

```js
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { LitElement, html, nothing } from 'da-lit';

class __CLASS__ extends LitElement {
  static properties = {
    _token: { state: true },
    _ready: { state: true },
  };

  constructor() {
    super();
    this._token = null;
    this._ready = false;
  }

  createRenderRoot() { return this; }

  connectedCallback() {
    super.connectedCallback();
    this._init();
  }

  async _init() {
    try {
      const { token } = await DA_SDK;
      this._token = token;
    } catch {
      // SDK unavailable in standalone / local dev
    }
    this._ready = true;
  }

  render() {
    if (!this._ready) return html`<p>Loading…</p>`;
    return html`
      <p class="app-title">__TITLE__</p>
      <p class="app-intro">Tool loaded.</p>
    `;
  }
}

customElements.define('__TAG__', __CLASS__);
```

### `tools/__NAME__/__NAME__.html` — Full-page entry

```html
<!DOCTYPE html>
<html>
  <head>
    <title>__TITLE__</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="data:," />
    <script type="importmap">
      { "imports": { "da-lit": "https://da.live/deps/lit/dist/index.js" } }
    </script>
    <link rel="stylesheet" href="https://da.live/nx/styles/nexter.css" />
    <link rel="stylesheet" href="/tools/__NAME__/__NAME__.css" />
    <style>html { display: flex; } html, body { min-height: 100%; min-width: 100%; } body { display: block; }</style>
    <script src="https://da.live/nx/public/sl/components.js" type="module"></script>
    <script src="https://da.live/nx/utils/sdk.js" type="module"></script>
    <script src="/tools/__NAME__/__NAME__.js" type="module"></script>
  </head>
  <body style="display: block; background-color: #fff;">
    <__TAG__></__TAG__>
  </body>
</html>
```

### `tools/__NAME__/__NAME__.css` — Tool styles

```css
.app-title {
  font-size: 24px;
  font-weight: 700;
  margin: 24px 0 8px;
}

.app-intro {
  font-size: 14px;
  color: #666;
  margin: 0 0 24px;
}
```

### `tools/__NAME__/utils.js` — Pure helpers

```js
/**
 * Pure utility functions for __NAME__.
 * Keep side-effect-free for easy unit testing.
 */
```

---

## Unit test template

### `test/unit/__NAME__/__NAME__.test.js` (block) or `test/unit/__NAME__/utils.test.js` (tool)

```js
import { expect } from '@esm-bundle/chai';

describe('__NAME__', () => {
  it('placeholder — replace with real tests', () => {
    expect(true).to.be.true;
  });
});
```
