<!-- prettier-ignore -->
<div align="center">

# EW Extensions

[![99% Vibe_Coded](https://img.shields.io/badge/99%25-Vibe_Coded-ff69b4?style=for-the-badge&logo=githubcopilot&logoColor=white)](https://github.com/ai-ecoverse/vibe-coded-badge-action)

<img src="./assets/ew-mascot-skills.png" alt="ew extensions" align="center" height="120" style="margin-bottom: 20px;" />

[![Build Status](https://img.shields.io/github/actions/workflow/status/exp-workspace/ew-extensions/main.yaml?style=flat-square&label=CI%20Checks)](https://github.com/exp-workspace/ew-extensions/actions)
[![Node version](https://img.shields.io/badge/Node.js->=22-3c873a?style=flat-square)](https://nodejs.org)
[![JavaScript](https://img.shields.io/badge/JavaScript-yellow?style=flat-square&logo=javascript&logoColor=white)](https://www.openjs.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-white?style=flat-square)](LICENSE)

[Overview](#overview) | [Extensions](#extensions) | [Architecture](#architecture) | [Local development](#local-development) | [Adding an extension](#adding-an-extension)

</div>

## Overview

This repository hosts **extensions** for the Experience Workspace (EW). Each extension is a self-contained [DA App SDK](https://docs.da.live/developers/guides/developing-apps-and-plugins) application deployed on its own AEM Edge Delivery Services site and loaded into the EW shell.

Extensions add capabilities to EW — editors, panels, tools, and integrations — without modifying the core platform.

## Extensions

| Extension | Path | Entry point | Description |
|-----------|------|-------------|-------------|
| **Skills Editor** | `apps/skills/` | `tools/skills.html` | Manage skills, agents, MCP servers, prompts, and memory |
| **Quick Blocks** | `tools/quick-blocks/` | `tools/quick-blocks/quick-blocks.html` | Add blocks or browse AEM Assets from the EW sidebar |

> More extensions coming soon.

To enable **Quick Blocks**, add a row to the org or site DA config's `library`
sheet: `title` = `Quick Blocks`, `path` = the deployed URL of
`/tools/quick-blocks/quick-blocks.html`, `experience` = `inline`. Keep the
existing `Blocks` row: Quick Blocks uses its sheet sources and variant pages,
including their library metadata. The new entry appears under **Extensions**
in the EW sidebar. Its UI uses the EW NX2 stylesheets for Adobe Clean, shared
colors, and form controls. The text section above the blocks offers expandable
Heading (H1–H6) and List (unordered/ordered) groups and a paragraph, all with
sample content. Click any text item or block variant to insert it at the editor
cursor; the sidebar stays open for repeated inserts.
The extension requires an EW page editor and the DA SDK iframe channel (it
does not insert content when opened standalone).
The **Assets** tab lists images from the site's configured AEM Assets repository
(`aem.repositoryId`) in pages. Images are drag-only; clicking them does not insert
anything. EW fetches the listing and thumbnails using its existing sign-in;
the extension never loads the AEM Assets selector. The host checks approval,
fetches the original image with authentication as the pointer enters a card,
and relays its file bytes to the existing-image replacement target on drop.
If the download is still in progress, wait briefly and drag again; no
publish-URL HTML is inserted as a fallback.
In EW layout mode, drag a text item or variant into the page to insert it before
or after the nearest block. Because the sidebar and preview are separate iframes, EW
places a transparent drag handle over each visible item in the host page
and bridges the drop through a temporary surface over the preview. Other
sources can drop ordinary `text/html` directly onto the preview; ProseMirror
parses the content according to the editor schema. Native OS image drops use
the preview's file target directly; sidebar assets need the relay because
browsers do not carry script-created files through native drag-and-drop.
On a `localhost:3000` EW host, the Assets tab shows a bundled **Sample JPEG (local
mock)** instead of requesting AEM Assets, so the file-replacement drag can be
tried without a configured repository. The mock is never shown by a deployed
EW host.
For local development, the plugin uses the DA Admin environment and IMS token
provided by its EW host. Sign in through EW on `localhost:3000` first; opening
the plugin directly on `localhost:3001` does not initiate a separate IMS login.

## Architecture

Every extension follows the same pattern:

1. **Block contract** — each extension exports a `decorate(block)` function, loaded by da-nx's `loadBlock` via `providers.ew` routing (triggered by the `ew-` class prefix).
2. **EW hosts the extension** at `da.live/apps/{extension}#/{org}/{site}`. The page contains a `<div class="ew-{extension}">` that `loadBlock` resolves to this repo.
3. **Extension component** — a LitElement (or vanilla JS module) that owns its own UI, state, and data operations against the DA Admin API.

## Local development

To develop locally, run three servers:

```bash
# 1. da-live (port 3000)
cd ~/Projects/DA/da-live && aem up

# 2. da-nx (port 6456)
cd ~/Projects/DA/da-nx && npm run local

# 3. ew-extensions (port 3001)
cd ~/Projects/DA/da-skills && aem up --port 3001
```

Then navigate to:

```
http://localhost:3000/apps/skills?nx=local&nxver=2#/{org}/{site}
```

The `?nx=local&nxver=2` params tell da-live to load da-nx from localhost, which in turn resolves `ew-*` blocks to `:3001`.

For isolated extension development (no auth, no da-nx routing):

```
http://localhost:3001/apps/skills/skills.html
```

## Adding an extension

1. Create a new directory under `apps/{your-extension}/`.
2. Add an entry point at `tools/{your-extension}.html` that imports the DA App SDK.
3. Implement your extension component — see `apps/skills/` for a reference implementation.
4. Update the extensions table above.

## Authentication

The DA App SDK handles authentication for all extensions. When EW loads an extension in an iframe, the SDK passes the user's IMS access token via PostMessage. Extensions call `initAuth(token)` to configure subsequent DA Admin API requests.

No separate login flow is needed — the user is already authenticated in EW.

## CI

Linting (ESLint + Stylelint) runs on every push that touches `apps/`. E2e tests (Playwright) are available locally — see `test/e2e/README.md` for the tiered test strategy.
