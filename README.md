<!-- prettier-ignore -->
<div align="center">

# DA Skills Editor

[![Build Status](https://img.shields.io/github/actions/workflow/status/exp-workspace/da-skills/main.yaml?style=flat-square&label=CI%20Checks)](https://github.com/exp-workspace/da-skills/actions)
![Node version](https://img.shields.io/badge/Node.js->=22-3c873a?style=flat-square)
[![JavaScript](https://img.shields.io/badge/JavaScript-yellow?style=flat-square&logo=javascript&logoColor=white)](https://www.openjs.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-white?style=flat-square)](LICENSE)
[![95% Vibe_Coded](https://img.shields.io/badge/95%25-Vibe_Coded-ff69b4?style=for-the-badge&logo=claude&logoColor=white)](https://github.com/ai-ecoverse/vibe-coded-badge-action)

[Overview](#overview) | [Architecture](#architecture) | [Local development](#local-development) | [File structure](#file-structure) | [Authentication](#authentication) | [Chat](#chat)

</div>

## Overview

Standalone DA app for managing skills, agents, MCP servers, prompts, and memory. Built as a [DA App SDK](https://docs.da.live/developers/guides/developing-apps-and-plugins) application and deployed on its own AEM Edge Delivery Services site.

Users access it at `https://da.live/app/{org}/{site}/tools/skills`.

## Architecture

The Skills Editor is a self-contained DA app, not a da-nx block. It follows the standard DA App SDK pattern:

1. **`tools/skills.html`** is the app entry point — a standalone HTML page that imports the DA App SDK and bootstraps the editor.
2. **DA hosts the app** via iframe at `da.live/app/{org}/{site}/tools/skills`. The SDK handles authentication by passing the user's IMS token into the app.
3. **The editor component** (`nx-skills-editor`) manages all UI and data operations against the DA Admin API.
4. **Chat** is shimmed into the app via a dynamic import URL, allowing the chat component to live alongside the editor in the same view.

The app is deployed to its own EDS site (`main--da-skills--exp-workspace.aem.live`). The [AEM Code Sync Bot](https://github.com/apps/aem-code-sync) keeps the CDN in sync with the `main` branch.

## Local development

```bash
# 1. Serve da-skills locally
cd ~/Projects/DA/da-skills
aem up
# or: python3 -m http.server 3001

# 2. Open the app with local override
# https://da.live/app/{org}/{site}/tools/skills?ref=local
```

The `?ref=local` parameter tells DA to load the app from `http://localhost:3000` instead of the CDN.

## File structure

```
tools/
├── skills.html              # DA App entry point (DA App SDK + import map)
└── skills/
    └── skills.js             # Re-exports apps/skills/skills.js

apps/skills/
├── skills.js                 # SDK bootstrap — awaits DA_SDK, calls initAuth(token)
├── nx-skills-editor.js       # Main LitElement component
├── skills-editor-api.js      # Data layer (config CRUD, .md I/O, MCP tools)
├── renderers.js              # Pure render helpers (skills, agents, MCPs, prompts, memory)
├── constants.js              # Enums, builtin server IDs, tab definitions
├── catalog.css               # Catalog and card styles
├── nx-skills-editor.css      # Component layout styles
├── tools.css                 # Tool selector styles
├── utils/
│   ├── da-fetch.js           # Authenticated fetch wrapper (token from DA App SDK)
│   ├── utils.js              # loadStyle, HashController
│   ├── sheet-utils.js        # Config sheet row helpers
│   ├── markdown.js           # Markdown utilities
│   ├── skill-frontmatter.js  # YAML frontmatter parser
│   └── skills-channel.js     # BroadcastChannel bridge for chat communication
└── shared/
    ├── tabs/                 # Tab bar component
    ├── card/                 # Reusable card component
    └── popover/              # Popover / context menu component
```

## Authentication

The DA App SDK handles authentication. When DA loads `tools/skills.html` in an iframe, the SDK passes the user's IMS access token via PostMessage. The app calls `initAuth(token)` to configure all subsequent DA Admin API requests.

No separate login flow is needed — the user is already authenticated in DA.

## Chat

The chat component is loaded into the Skills Editor via a dynamic import URL (`chatImportUrl`). This allows the chat panel to render alongside the editor within the same app frame, communicating through `skills-channel.js` using BroadcastChannel with sessionStorage and window event fallbacks for compatibility.

## CI

Linting (ESLint + Stylelint) runs on every push that touches `apps/`. E2e tests (Playwright) are available locally — see `test/e2e/README.md` for the tiered test strategy.
