---
name: new-extension
description: >-
  Scaffold a new ew-extension (block or tool) with the correct file structure,
  block contract, Lit boilerplate, CSS, standalone HTML, and test stubs.
  Use when the user wants to create a new extension, add a new block, add a new
  tool, scaffold an ew- component, or start a new DA extension.
---

# New Extension Scaffold

Scaffold a new extension inside `ew-extensions`.
Two flavours exist — pick based on intent:

| Type | Location | Integration |
|------|----------|-------------|
| **Block** | `blocks/{name}/` | Loaded by da-nx `loadBlock()` via the `ew-` provider class prefix |
| **Tool** | `tools/{name}/` | Full-page DA App SDK app, accessed directly at `/tools/{name}/{name}.html` |

## Step 0 — Gather info

Use AskQuestion to collect:

1. **Extension name** — lowercase, hyphen-separated (e.g. `my-widget`). This becomes the folder name and the custom-element tag prefix.
2. **Type** — Block or Tool.
3. **One-line description** — what it does (used in the HTML `<title>` and code comments).

## Step 1 — Create the file tree

### Block extension: `blocks/{name}/`

```
blocks/{name}/
├── {name}.js          # Block contract entry point
├── {name}.html        # Standalone HTML for local dev / testing
├── {name}.css         # Block-level styles (optional, loaded by loadStyle)
├── nx-{name}.js       # Main LitElement custom element
└── nx-{name}.css      # Component styles
```

### Tool extension: `tools/{name}/`

```
tools/{name}/
├── {name}.html        # Full-page HTML entry (loads DA SDK)
├── {name}.js          # LitElement app + DA_SDK init
├── {name}.css         # Styles
└── utils.js           # Pure helpers (easily testable)
```

### Unit test stub

```
test/unit/{name}/
└── {name}.test.js     # or utils.test.js for tools
```

## Step 2 — Generate files from templates

Use the templates in [templates.md](templates.md).
Replace every `__NAME__` placeholder with the kebab-case extension name
and every `__TAG__` with the custom-element tag (`nx-{name}` for blocks,
`{name}-app` for tools — or whatever the user prefers).

## Step 3 — Wire lint & test configs

1. **ESLint** — `package.json` script `lint:js` currently targets `blocks/`.
   If the new extension is a **tool**, extend the glob:
   ```
   "lint:js": "eslint blocks/ tools/{name}/"
   ```
2. **Stylelint** — same pattern for `lint:css` if CSS lives outside `blocks/`.
3. **Unit tests** — already covered by `./test/unit/**/*.test.js` glob; no change needed.

## Step 4 — Local dev reminder

Print a short reminder for the developer:

> **Local development**
>
> 1. `node serve-local.mjs` — serves ew-extensions on `http://localhost:3001`
> 2. Open `http://localhost:3001/blocks/{name}/{name}.html` (block) or
>    `http://localhost:3001/tools/{name}/{name}.html` (tool) for standalone testing.
> 3. To test inside da-live, add `?da-skills=local` to the da-live URL.

## Step 5 — da-live / da-nx wiring (blocks only)

For block extensions, the developer also needs to:

1. **da-live**: Create a shell page (e.g. `da-live/apps/{name}.md`) containing
   a `div` with class `ew-{name}`.
2. **da-nx**: The `ew` provider is already registered; `loadBlock` resolves
   `ew-{name}` → `{ew-origin}/blocks/{name}/{name}.js` automatically.

Mention this so the developer knows, but do NOT make changes in other repos
unless asked.

## References

- [Provider strategy](references/provider-strategy.md) — how `ew-` class prefixes route to this repo via da-nx `loadBlock()`
- [Block contract](references/block-contract.md) — `decorate(block)` signature, auth, cross-origin imports, CSP, LitElement conventions
- [Local development](references/local-development.md) — three-server setup, `?da-skills=` override, branch preview testing, CORS
