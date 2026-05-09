# DA Skills Editor

Standalone DA App for managing skills, agents, MCP servers, tool overrides, and prompts.

## Architecture

This app runs inside an iframe hosted by da-nx's shell (`da.live/app/{org}/da-skills/tools/skills`). It uses the [DA App SDK](https://docs.da.live/developers/guides/developing-apps-and-plugins) for authentication and communicates with DA Admin APIs directly.

## Local Development

```bash
# Start a local server on port 3000
npx http-server . -p 3000 --cors

# Then open:
# da.live/app/{org}/da-skills/tools/skills?ref=local#/{org}/{site}
```

When `ref=local`, da-nx's shell iframes `http://localhost:3000/tools/skills/skills.html` instead of the AEM CDN URL.

## File Structure

```
tools/skills/
├── skills.html           # Entry HTML (import map + SDK)
├── skills.js             # SDK bootstrap
├── nx-skills-editor.js   # Main LitElement component
├── skills-editor-api.js  # Data layer (config CRUD, .md I/O, MCP)
├── renderers.js          # Pure render helpers
├── constants.js          # Enums, builtin lists
├── *.css                 # Styles
├── utils/                # Local utilities
│   ├── da-fetch.js       # Authenticated fetch (token from SDK)
│   ├── utils.js          # loadStyle, HashController
│   ├── sheet-utils.js    # Config row helpers
│   ├── markdown.js       # Title extraction, tool refs
│   └── skill-frontmatter.js  # YAML frontmatter parser
└── shared/               # Shared UI components
    ├── tabs/             # nx-tabs
    ├── card/             # nx-card
    └── popover/          # nx-popover
```

## Origin

Extracted from [da-nx](https://github.com/adobe-rnd/da-nx) `nx2/blocks/skills-editor/`.
