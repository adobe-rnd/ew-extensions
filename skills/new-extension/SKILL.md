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

Before generating anything, interview the developer with AskQuestion to understand
what they're building. Ask these in sequence — each answer shapes the next question.

### Q1: What does this extension do?

Free-text. Ask the developer to describe the extension in one or two sentences.
Use their answer to derive the HTML `<title>`, component comments, and suggest
a name in Q2.

### Q2: Extension name

Suggest a kebab-case name based on Q1 (e.g. if they said "a tool for managing
content fragments" → suggest `content-fragments`). Let them override.
Constraints: lowercase, hyphen-separated, no spaces, 2–30 chars.
This becomes the folder name, file names, and custom-element tag prefix.

### Q3: Block or Tool?

Use AskQuestion with two options:

- **Block** — loaded inside the da-live shell via `loadBlock()` (like the Skills Editor).
  Best for extensions that appear as a page inside `da.live/apps/{name}`.
- **Tool** — standalone full-page DA App SDK app at `/tools/{name}/{name}.html`.
  Best for utilities, setup wizards, or anything that runs outside the da-live shell.

### Q4: Does it need authentication?

Use AskQuestion:

- **Yes — IMS token** (default for blocks) — the extension reads the user's IMS
  token from `window.adobeIMS` (injected by the da-live shell). Use this for
  anything calling DA Admin API or AEM APIs.
- **Yes — DA App SDK** (default for tools) — the extension gets the token via
  `const { token } = await DA_SDK`. Same token, different delivery mechanism.
- **No** — the extension works without auth (rare; e.g. static calculators,
  documentation viewers).

Pre-select the default based on the type chosen in Q3.

### Q5: Will it call DA Admin API endpoints?

Use AskQuestion:

- **Yes** — include the `da-fetch.js` auth wrapper in `utils/` (handles token
  attachment and origin resolution for admin/content/AEM URLs).
- **No** — skip `da-fetch.js`; the developer will add their own API layer later.

### Q6: Custom element tag name

Suggest a tag based on the name:
- Blocks: `nx-{name}` (e.g. `nx-content-fragments`)
- Tools: `{name}-app` (e.g. `content-fragments-app`)

Let the developer override if they prefer something else.
Validate: must contain a hyphen (web component requirement), lowercase, no spaces.

### Summary confirmation

Before generating files, print a summary table and ask the developer to confirm:

```
Extension:  {name}
Type:       Block / Tool
Tag:        {tag}
Auth:       IMS / DA SDK / None
DA Fetch:   Yes / No
Description: {their description from Q1}
```

## Step 1 — Create the file tree

### Block extension: `blocks/{name}/`

```
blocks/{name}/
├── {name}.js          # Block contract entry point
├── {name}.html        # Standalone HTML for local dev / testing
├── nx-{name}.js       # Main LitElement (shadow DOM + adoptedStyleSheets)
├── nx-{name}.css      # Component styles (scoped via adoptedStyleSheets)
└── utils/
    └── utils.js       # loadStyle utility (inlined from da-nx)
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
