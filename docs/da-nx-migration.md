# DA-NX Migration Guide

When ew-extensions is deployed to AEM CDN, the following changes are needed in da-nx and da-live.

## 1. Provider support in loadBlock (done)

da-nx PR #446 added `providers` config to `loadBlock`. A block class like `ew-skills` splits on the first `-`, looks up `providers['ew']`, and loads `${provider}/blocks/skills/skills.js`.

## 2. DA-Live config

da-live's `scripts/scripts.js` must register `providers.ew` pointing to the ew-extensions AEM origin so `loadBlock` can resolve `ew-*` blocks.

## 3. DA-Live apps page

`da-live/apps/skills.md` contains `<div class="ew-skills"></div>` — the page shell that triggers provider block loading.

## 4. Chat navigation target

In `nx2/blocks/chat/chat.js`, the + menu opens `/apps/skills?tab={skills|prompts}#/${org}/${site}`.

## 3. Session storage keys (no change needed for v1)

The following `sessionStorage` keys are shared between chat and the skills editor. Since both run on `da.live` origin, they continue to work across tabs:

- `da-skills-editor-suggestion` -- skill suggestion handoff from chat
- `da-skills-editor-nav:{org}/{site}` -- initial tab navigation
- `da-skills-editor-data:{org}/{site}` -- cached data snapshot

## 4. Custom events (future v2)

These `window` events currently work because chat and skills editor share the same DOM. In the iframe model they won't fire across the boundary. For v1 this is acceptable since:
- Skill suggestions are persisted to `sessionStorage` and consumed on page load
- The skills editor runs in a separate tab, not an inline panel

For v2 (inline panel via iframe), extend `shell.js` `port1.onmessage` to relay:
- `da-skills-editor-suggestion-handoff`
- `da-skills-editor-prompt-send`
- `da-skills-editor-prompt-add-to-chat`
