# E2E Tests — Skills Editor

End-to-end tests for the standalone `da-skills` editor, ported from
`da-live/test/e2e/tests/skills-lab.spec.js`.

## Test tiers

### Tier 1 — Stub-only (no auth, runs in CI)

The majority of the suite. `stubDaApi` intercepts all DA Admin and IMS
network calls with in-memory fixtures so tests execute without any
credentials.

Covers: rendering, catalog navigation, keyboard accessibility, drawer
state, performance UX, Memory tab, gate form, cross-tab regression, MCP
editor flows, agent card structure.

### Tier 2 — Write operations (needs real IMS session, local only)

Tests guarded by `test.skip(!HAS_AUTH, ...)`. They perform real
create / edit / delete operations against the DA Admin API.

Covers: Skills CRUD, Prompts CRUD, Drawer persistence, Tool references,
Skills loader.

These are **skipped in CI** and run only when `DA_AUTH_OK=1` is set
(typically after completing the IMS login flow locally via
`auth.setup.js`).

### Tests that remain in da-live

Two test groups depend on `nx-chat` and cannot run standalone:

- **Chat menu navigation** — verifies "Manage Skills / Prompts" menu
  items inside the chat drawer.
- **Skill suggestion rendering** — verifies `[SKILL_SUGGESTION]` block
  parsing, handoff event, and form pre-fill via the chat SSE stream.

These stay in `da-live/test/e2e/tests/skills-lab.spec.js`.

## Running locally

```bash
# Install deps (from da-skills root)
npm install
npx playwright install --with-deps chromium

# Tier 1 only (default — no auth needed)
npm run test:e2e

# All browsers
npm run test:e2e:all

# Interactive UI mode
npm run test:e2e:ui

# With write tests (requires prior IMS login)
DA_AUTH_OK=1 npm run test:e2e
```

## CI

The GitHub Actions workflow (`.github/workflows/main.yaml`) runs
Tier 1 tests on every push after linting passes. No secrets are
required. Tier 2 tests skip gracefully.

When a service account is available for the test org/site, Tier 2 can
be enabled by adding the IMS credentials as GitHub Actions secrets and
setting `DA_AUTH_OK=1` in the workflow environment.
