# DA-NX Migration Guide

When da-skills is deployed to AEM CDN, the following changes are needed in da-nx.

## 1. Chat navigation target

In `nx2/blocks/chat/chat.js`, update `_navigateToSkillsEditor`:

```js
// Before:
window.open(`/apps/skills${search}#/${org}/${site}`, '_blank');

// After (replace {da-skills-org} with the org hosting da-skills):
window.open(`/app/{da-skills-org}/da-skills/tools/skills${search}#/${org}/${site}`, '_blank');
```

## 2. DA-Live apps page

In `da-live/apps/skills.md`, redirect to the new app URL or keep as a fallback that loads the iframe shell.

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
