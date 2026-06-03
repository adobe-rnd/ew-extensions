# Block Contract

Every block extension must export a default `decorate` function as its entry point.

## Signature

```js
// blocks/{name}/{name}.js
export default function decorate(block) {
  // block is the <div class="ew-{name}"> element from the shell page
}
```

`loadBlock()` calls this function with the DOM element. The extension owns everything inside it.

## Reference implementation (Skills Editor)

```js
import { initAuth } from './utils/da-fetch.js';
import './nx-skills-editor.js';

export default function decorate(block) {
  const token = window.adobeIMS?.getAccessToken()?.token;
  if (token) initAuth(token);
  block.textContent = '';
  const el = document.createElement('nx-skills-editor');
  block.append(el);
}
```

### Common patterns

1. **Clear the block** — `block.textContent = ''` removes any placeholder content from the shell page.
2. **Create a custom element** — mount a LitElement (or vanilla CE) that owns the UI.
3. **Grab the IMS token** — `window.adobeIMS?.getAccessToken()?.token` is available when the extension loads inside da-live (IMS is initialized by the shell).
4. **Append, not replace** — use `block.append(el)`, don't replace the block node itself.

## Shell page wiring

For the block to load, da-live needs a shell page with the matching CSS class:

```markdown
<!-- da-live/apps/{name}.md -->
# My Extension

<div class="ew-{name}"></div>
```

The user navigates to `da.live/apps/{name}#/{org}/{site}`. NX2 discovers the `ew-{name}` div and calls `loadBlock()`.

## Authentication

| Context | Token source |
|---|---|
| Inside da-live | `window.adobeIMS.getAccessToken().token` — IMS is loaded by the da-live shell |
| Standalone HTML | Not available — use DA App SDK (`import DA_SDK from 'https://da.live/nx/utils/sdk.js'`) for tool-type extensions |

Block extensions typically use `window.adobeIMS` since they always run inside the da-live shell. Tool extensions use the DA SDK directly.

## Cross-origin imports

When a module in ew-extensions (port 3001) does a bare `import('/some/path.js')`, the browser resolves it relative to **the module's own origin** (3001), not the page origin (3000).

To import modules from da-nx or da-live, build the full URL:

```js
const CHAT_PATH = '/nx2/blocks/chat/chat.js';

function resolveChatUrl() {
  const nxParam = new URLSearchParams(window.location.search).get('nx');
  if (nxParam === 'local') return `http://localhost:6456${CHAT_PATH}`;
  return `https://da.live${CHAT_PATH}`;
}

const { default: chat } = await import(resolveChatUrl());
```

## CSP

da-live uses `strict-dynamic` CSP with a nonce. Cross-origin ew-extensions modules load via dynamic `import()` initiated by a nonce-trusted script, so `strict-dynamic` propagates trust automatically. No CSP changes are needed for new extensions.

## LitElement conventions

- Import Lit from the `da-lit` import map: `import { LitElement, html, css } from 'da-lit'`
- Use `createRenderRoot() { return this; }` to render into the light DOM (consistent with da-nx patterns)
- Load co-located CSS via `<link>` elements (see `templates.md` for the pattern)
- Custom element tags use `nx-{name}` prefix for blocks (e.g. `nx-skills-editor`)
