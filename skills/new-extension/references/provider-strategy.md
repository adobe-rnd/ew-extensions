# Provider Strategy

How `ew-` prefixed blocks load from ew-extensions into the da-live shell via da-nx's `loadBlock()`.

## Origin mapping

The `ew` provider maps to a different origin per environment:

| Environment | Host example | EW origin |
|---|---|---|
| dev | `localhost:3000` | `http://localhost:3001` |
| stage | `main--da-live--adobe.aem.page` | `https://main--ew-extensions--adobe-rnd.aem.page` |
| prod | `da.live` | `https://main--ew-extensions--adobe-rnd.aem.live` |

Defined in both `da-nx/nx2/scripts/nx.js` and `da-live/scripts/scripts.js` as the `EW_ORIGINS` constant.

Environment detection uses the page host:

- Ends with `.aem.live` → `prod`
- Contains `--` → `stage`
- Otherwise (localhost) → `dev`

## loadBlock resolution flow

`loadBlock()` in `da-nx/nx2/scripts/nx.js` resolves a block's CSS class to a module URL:

```
<div class="ew-skills">
         │
         ▼
 Split on first hyphen
 ┌──────────────────┐
 │ prefix: "ew"     │
 │ name:   "skills"  │
 └──────────────────┘
         │
         ▼
 Lookup providers["ew"]
 → e.g. "http://localhost:3001"
         │
         ▼
 Module URL: {origin}/blocks/{name}/{name}.js
 → http://localhost:3001/blocks/skills/skills.js
         │
         ▼
 import(url) → call default export
 → decorate(block)
```

Only the **first** hyphen segment is the provider key. `ew-my-widget` → provider `ew`, block name `my-widget` → `.../blocks/my-widget/my-widget.js`.

### Other provider patterns for context

| CSS class | Provider | Module URL |
|---|---|---|
| `ew-skills` | `providers.ew` | `{ew-origin}/blocks/skills/skills.js` |
| `ew-my-widget` | `providers.ew` | `{ew-origin}/blocks/my-widget/my-widget.js` |
| `da-browse` | `providers.da` | `{da-live-origin}/blocks/browse/browse.js` |
| `browse` | no match → `codeBase` | `{da-live-origin}/blocks/browse/browse.js` |
| `nx-chat` | `nx-` special case | `{nxBase}/blocks/chat/chat.js` |

### NX version requirement

Provider routing exists only in NX2. The NX1 `nexter.js` does not support `providers`. Shell pages must use `?nxver=2` (or omit it — NX2 is the default on da.live prod).

## Who sets `providers.ew`?

da-live's `scripts.js` calls `setConfig()` with:

```js
providers: { da: window.location.origin, ew: getEwOrigin() }
```

`getEwOrigin()` resolves the origin using `EW_ORIGINS[env]` with an optional `?da-skills=` override (see [local-development.md](local-development.md)).

The `ew` provider is pre-registered — no da-nx code changes are needed to add a new `ew-*` block.
