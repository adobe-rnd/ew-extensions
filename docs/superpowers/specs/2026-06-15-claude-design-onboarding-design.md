# DA Onboarding Plugin — Design Spec

**Date:** 2026-06-15  
**Plugin name:** `claude-design-onboarding`  
**Location:** `tools/claude-design-onboarding/`

---

## Overview

A DA library plugin that delivers a guided onboarding experience — similar to VS Code's welcome walkthrough — rendered as a sidebar panel. It shows 6 hardcoded steps, lets users mark each step complete, tracks progress with a progress bar, and shows a completion screen when all steps are done. Progress persists in localStorage keyed by the current URL for 24 hours.

---

## Files

```
tools/claude-design-onboarding/
├── claude-design-onboarding.html   # plugin entry point
├── claude-design-onboarding.js     # LitElement component
└── claude-design-onboarding.css    # styles
```

---

## Architecture

### HTML Entry Point (`claude-design-onboarding.html`)

Mirrors the `ew-setup.html` pattern:
- Importmap defining `da-lit` → `https://da.live/deps/lit/dist/index.js`
- `nexter.css` for base Spectrum 2 design tokens
- `https://da.live/nx/public/sl/components.js` for `sl-*` UI components
- `https://da.live/nx/utils/sdk.js` for the DA SDK
- The plugin JS module
- Body contains `<onboarding-app></onboarding-app>`

### JavaScript (`claude-design-onboarding.js`)

Single `<onboarding-app>` LitElement. Uses `createRenderRoot() { return this; }` for light DOM rendering (matches ew-setup pattern).

**State properties:**
| Property | Type | Description |
|---|---|---|
| `_activeStep` | `number` (0–5) | Index of the currently displayed step card |
| `_completedSteps` | `Set<number>` | Indices of completed steps |
| `_done` | `boolean` | True when all 6 steps are completed; triggers completion screen |

**Hardcoded `STEPS` array** — 6 entries, each `{ title, description }`:
1. Welcome to your demo site
2. Edit on the canvas
3. Add a section
4. Ask the AI Assistant
5. Run a skill
6. Preview & publish

**localStorage:**
- Key: `` `da-onboarding-${window.location.href}` ``
- Value: `{ completedSteps: number[], activeStep: number, savedAt: number }`
- On `connectedCallback`: read saved state; discard if `savedAt` is older than 24h
- On each step completion: write updated state

**SDK:** `DA_SDK` is awaited for `token` (available but not required for this plugin's core functionality — no API calls needed).

**Step completion logic:**
1. Add current `_activeStep` index to `_completedSteps`
2. If `_completedSteps.size === 6`: set `_done = true`
3. Otherwise: find the next uncompleted step (wrap around if needed) and set as `_activeStep`
4. Persist to localStorage

**Lesson navigation:** Clicking any row in the lessons list sets `_activeStep` to that step's index (regardless of completion state), allowing the user to revisit steps.

### CSS (`claude-design-onboarding.css`)

- Scoped under `onboarding-app { ... }`
- Spectrum 2 tokens: `--s2-gray-*`, `--s2-blue-900`, `--s2-green-700`
- Component accent: `--ob-accent: var(--s2-blue-900)`
- `sl-button` variants styled via `::part(base)` with `ob-fill-accent` / `ob-quiet-secondary` classes
- Compact layout for sidebar panel: `padding: 16px`, `max-width: 100%`

---

## UI Layout

Single scrollable column, always one screen. Four regions:

### 1. Header (always visible)
- Small caps label: "GUIDED ONBOARDING"
- Large bold title: "Make this site yours"
- Subtitle: one line of descriptive text

### 2. Progress Bar (always visible)
- Row: "YOUR PROGRESS" label left, "X of 6" counter right
- Thin bar below: grey track, accent-colored fill, `width = completedSteps.size / 6 * 100%`, animated with `transition: width 0.3s ease`

### 3. Active Step Card (hidden when `_done`)
- Bordered white card with subtle shadow
- Small caps: "STEP X / 6"
- Bold title (from STEPS array)
- Description text
- Primary CTA button: "Mark complete →" — marks step done, advances to next uncompleted step

### 4. Lessons List (hidden when `_done`)
- "ALL LESSONS" label
- 6 rows, each: numbered badge + step title
  - **Pending:** grey outline badge, grey text
  - **Active:** accent-filled badge, dark text, highlighted row background
  - **Completed:** green checkmark icon replaces badge, muted text
- Clicking any row sets `_activeStep` to that index

### 5. Completion Screen (shown only when `_done`)
Replaces the step card and lessons list:
- Large checkmark or success icon
- Heading: "You're all done!"
- Short congratulations message
- "Start over" link — clears localStorage, resets `_completedSteps`, `_activeStep`, `_done`

---

## Constraints & Decisions

- **No external API calls** — the plugin is purely client-side; it does not use DA source API or admin API
- **No `actions.closeLibrary`** — the panel stays open throughout the onboarding flow
- **Steps are not individually closable** — the user must explicitly "Start over" to reset
- **Lesson navigation is unrestricted** — users can jump to any step, including already-completed ones, to re-read the content; re-clicking "Mark complete" on an already-completed step is a no-op
- **24h expiry** checked on mount only — no background timer invalidation
