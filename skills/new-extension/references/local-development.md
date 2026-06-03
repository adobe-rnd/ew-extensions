# Local Development

## Three-server setup

Full integration testing requires three local servers:

| Server | Port | Command | Purpose |
|---|---|---|---|
| da-live | 3000 | `cd da-live && aem up` | Shell pages, auth |
| da-nx | 6456 | `cd da-nx && npm start` | NX2 framework, `loadBlock()` |
| ew-extensions | 3001 | `node serve-local.mjs` | Extension block modules |

The `da start` CLI manages all three (plus da-admin, da-collab, and da-agent).

## `?da-skills=` origin override

da-live's `getEwOrigin()` supports a query-param override that persists in `localStorage`:

| Query param | Effect |
|---|---|
| `?da-skills=local` | Sets EW origin to `http://localhost:3001`, persists in `localStorage` |
| `?da-skills=reset` | Removes override, reverts to CDN default |
| `?da-skills={full-url}` | Uses that URL directly, persists |
| `?da-skills={branch-slug}` | Prepends `https://`, persists |

Once set, the override sticks across page reloads until `?da-skills=reset`.

### Full local dev URL

```
http://localhost:3000/apps/skills?nxver=2&da-admin=local&da-collab=local&nx=local&da-skills=local#/{org}/{site}
```

## Standalone testing (no auth, no da-nx)

Each extension includes a standalone HTML page for isolated dev:

```
http://localhost:3001/blocks/{name}/{name}.html   (block)
http://localhost:3001/tools/{name}/{name}.html    (tool)
```

No IMS token is available in standalone mode — the extension should handle this gracefully.

## Branch preview testing

### CDN URL pattern

| Env | URL |
|---|---|
| Prod (main) | `https://main--ew-extensions--adobe-rnd.aem.live/` |
| Branch preview | `https://{slug}--ew-extensions--adobe-rnd.aem.live/` |
| Stage (.aem.page) | `https://main--ew-extensions--adobe-rnd.aem.page/` |

Branch slugs replace `/` with `--`:

| Git branch | Slug |
|---|---|
| `feat/my-extension` | `feat--my-extension` |

### Testing a branch inside da-live

Point da-live at a branch CDN:

```
?da-skills=feat--my-extension--ew-extensions--adobe-rnd.aem.page
```

Or combine with a local da-nx branch:

```
http://localhost:3000/apps/skills?nxver=2&nx=feat--my-nx-branch&da-skills=feat--my-ew-branch--ew-extensions--adobe-rnd.aem.page#/{org}/{site}
```

## CORS

The local dev server (`serve-local.mjs`) sets `Access-Control-Allow-Origin: *` so that da-live (port 3000) can `import()` modules cross-origin from port 3001. AEM CDN handles CORS automatically for `.aem.live` / `.aem.page` origins.
