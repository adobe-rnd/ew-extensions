<!-- prettier-ignore -->
<div align="center">

# DA Skills Editor

[![Build Status](https://img.shields.io/github/actions/workflow/status/exp-workspace/da-skills/main.yaml?style=flat-square&label=CI%20Checks)](https://github.com/exp-workspace/da-skills/actions)
![Node version](https://img.shields.io/badge/Node.js->=22-3c873a?style=flat-square)
[![JavaScript](https://img.shields.io/badge/JavaScript-yellow?style=flat-square&logo=javascript&logoColor=white)](https://www.openjs.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-white?style=flat-square)](LICENSE)
[![0% Vibe_Coded](https://img.shields.io/badge/0%25-Vibe_Coded-ff69b4?style=for-the-badge&logo=claude&logoColor=white)](https://github.com/ai-ecoverse/vibe-coded-badge-action)

[Overview](#overview) | [How it works](#how-it-works) | [Local development](#local-development) | [File structure](#file-structure)

</div>

## Overview

Standalone DA app for managing skills, agents, MCP servers, tool overrides, and prompts.

Extracted from [da-nx](https://github.com/adobe-rnd/da-nx) `nx2/blocks/skills-editor/` to be independently deployable and replaceable.

## How it works

The app is deployed as a static site (AEM Edge Delivery). da-nx loads it as a block via a thin shim (`nx2/blocks/skills-editor/skills-editor.js`), which dynamically imports the component from the deployed CDN origin.

Users access it at `https://da.live/apps/skills#/{org}/{site}`.

## Local development

da-nx's shim supports a `?da-skills=local` override (stored in localStorage) that makes it load the component from `http://localhost:3001` instead of the CDN. Port 3001 avoids conflict with da-live (port 3000).

```bash
# 1. Serve da-skills locally
cd ~/Projects/DA/da-skills
python3 -m http.server 3001

# 2. Open da.live with the local override
# https://da.live/apps/skills?da-skills=local#/{org}/{site}

# 3. To reset back to CDN
# https://da.live/apps/skills?da-skills=reset
```

## File structure

```
apps/skills/
├── skills.html           # Entry HTML (import map + DA App SDK)
├── skills.js             # SDK bootstrap — calls initAuth(token)
├── nx-skills-editor.js   # Main LitElement component
├── skills-editor-api.js  # Data layer (config CRUD, .md I/O, MCP)
├── renderers.js          # Pure render helpers
├── constants.js          # Enums, builtin IDs
├── *.css                 # Component styles
├── utils/
│   ├── da-fetch.js       # Authenticated fetch (token from DA App SDK)
│   ├── utils.js          # loadStyle, HashController
│   ├── sheet-utils.js    # Config row helpers
│   ├── markdown.js       # Markdown utilities
│   ├── skill-frontmatter.js  # YAML frontmatter parser
│   └── skills-channel.js # BroadcastChannel bridge for chat integration
└── shared/
    ├── tabs/
    ├── card/
    └── popover/
```

## Authentication

When loaded via `da.live/apps/skills`, da-nx's shim injects the user's IMS token before mounting the component. No separate login flow needed.

## Chat integration

The skills editor communicates with da-nx chat via `skills-channel.js`, which uses BroadcastChannel (cross-tab) with fallback to window events and sessionStorage for legacy compatibility.
