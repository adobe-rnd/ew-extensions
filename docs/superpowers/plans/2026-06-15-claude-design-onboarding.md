# Claude Design Onboarding Plugin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a DA library plugin that guides users through 6 hardcoded onboarding steps with a progress bar, step card, lessons list, and completion screen, persisting progress in localStorage keyed by URL for 24 hours.

**Architecture:** Single `<onboarding-app>` LitElement component in `tools/claude-design-onboarding/`, following the exact patterns of the existing `ew-setup` plugin. Pure business logic (localStorage read/write, step advancement) is extracted to `utils.js` for testability.

**Tech Stack:** LitElement (`da-lit` importmap), DA SDK (`https://da.live/nx/utils/sdk.js`), Spectrum 2 CSS tokens, `sl-button` from `https://da.live/nx/public/sl/components.js`, Web Test Runner + Chai for unit tests.

---

## File Map

| File | Status | Responsibility |
|---|---|---|
| `tools/claude-design-onboarding/claude-design-onboarding.html` | Create | Plugin entry point — importmap, stylesheets, scripts |
| `tools/claude-design-onboarding/claude-design-onboarding.css` | Create | All styles scoped to `onboarding-app` |
| `tools/claude-design-onboarding/utils.js` | Create | Pure functions: localStorage persistence, step advancement |
| `tools/claude-design-onboarding/claude-design-onboarding.js` | Create | LitElement component — all rendering and state |
| `test/unit/claude-design-onboarding/utils.test.js` | Create | Unit tests for utils.js |

---

## Task 1: HTML entry point

**Files:**
- Create: `tools/claude-design-onboarding/claude-design-onboarding.html`

- [ ] **Step 1: Create the HTML entry point**

Create `tools/claude-design-onboarding/claude-design-onboarding.html` with the following content (mirrors `ew-setup.html` exactly):

```html
<!DOCTYPE html>
<html>
  <head>
    <title>Guided Onboarding</title>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <link rel="icon" href="data:,">
    <script type="importmap">
      { "imports": { "da-lit": "https://da.live/deps/lit/dist/index.js" } }
    </script>
    <link rel="stylesheet" href="https://da.live/nx/styles/nexter.css">
    <link rel="stylesheet" href="/tools/claude-design-onboarding/claude-design-onboarding.css">
    <style>html { display: flex; } html, body { min-height: 100%; min-width: 100%; } body { display: block; }</style>
    <script src="https://da.live/nx/public/sl/components.js" type="module"></script>
    <script src="https://da.live/nx/utils/sdk.js" type="module"></script>
    <script src="/tools/claude-design-onboarding/claude-design-onboarding.js" type="module"></script>
  </head>
  <body style="display: block; background-color: #fff;">
    <onboarding-app></onboarding-app>
  </body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add tools/claude-design-onboarding/claude-design-onboarding.html
git commit -m "feat(onboarding): add HTML entry point"
```

---

## Task 2: Pure utility functions (TDD)

**Files:**
- Create: `tools/claude-design-onboarding/utils.js`
- Test: `test/unit/claude-design-onboarding/utils.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/unit/claude-design-onboarding/utils.test.js`:

```js
import { expect } from '@esm-bundle/chai';
import {
  storageKey,
  loadProgress,
  saveProgress,
  clearProgress,
  getNextActiveStep,
  isComplete,
} from '../../../tools/claude-design-onboarding/utils.js';

const TEST_URL = 'https://da.live/test-page';

afterEach(() => {
  localStorage.removeItem(storageKey(TEST_URL));
});

describe('storageKey', () => {
  it('returns a prefixed key', () => {
    expect(storageKey('https://da.live/foo')).to.equal('da-onboarding-https://da.live/foo');
  });
});

describe('loadProgress', () => {
  it('returns null when nothing is stored', () => {
    expect(loadProgress(TEST_URL)).to.be.null;
  });

  it('returns stored progress when valid and not expired', () => {
    saveProgress(TEST_URL, new Set([0, 1]), 2);
    const result = loadProgress(TEST_URL);
    expect(result).to.not.be.null;
    expect(result.completedSteps).to.deep.equal(new Set([0, 1]));
    expect(result.activeStep).to.equal(2);
  });

  it('returns null and removes entry when savedAt is older than 24h', () => {
    const expired = Date.now() - (25 * 60 * 60 * 1000);
    localStorage.setItem(storageKey(TEST_URL), JSON.stringify({
      completedSteps: [0],
      activeStep: 1,
      savedAt: expired,
    }));
    expect(loadProgress(TEST_URL)).to.be.null;
    expect(localStorage.getItem(storageKey(TEST_URL))).to.be.null;
  });

  it('returns null and does not throw on malformed JSON', () => {
    localStorage.setItem(storageKey(TEST_URL), 'not-json');
    expect(loadProgress(TEST_URL)).to.be.null;
  });
});

describe('saveProgress', () => {
  it('persists completedSteps as an array and activeStep', () => {
    saveProgress(TEST_URL, new Set([2, 4]), 5);
    const raw = JSON.parse(localStorage.getItem(storageKey(TEST_URL)));
    expect(raw.completedSteps).to.have.members([2, 4]);
    expect(raw.activeStep).to.equal(5);
  });

  it('stores a savedAt timestamp close to now', () => {
    const before = Date.now();
    saveProgress(TEST_URL, new Set(), 0);
    const raw = JSON.parse(localStorage.getItem(storageKey(TEST_URL)));
    expect(raw.savedAt).to.be.at.least(before);
    expect(raw.savedAt).to.be.at.most(Date.now());
  });
});

describe('clearProgress', () => {
  it('removes the stored entry', () => {
    saveProgress(TEST_URL, new Set([0]), 1);
    clearProgress(TEST_URL);
    expect(localStorage.getItem(storageKey(TEST_URL))).to.be.null;
  });

  it('does not throw when nothing is stored', () => {
    expect(() => clearProgress(TEST_URL)).to.not.throw();
  });
});

describe('getNextActiveStep', () => {
  it('returns the next uncompleted step after current', () => {
    expect(getNextActiveStep(new Set([0]), 0, 6)).to.equal(1);
  });

  it('skips already-completed steps', () => {
    expect(getNextActiveStep(new Set([0, 1, 2]), 0, 6)).to.equal(3);
  });

  it('wraps around to the beginning when remaining steps are all complete', () => {
    expect(getNextActiveStep(new Set([3, 4, 5]), 3, 6)).to.equal(0);
  });

  it('returns current step when all other steps are completed (only one left)', () => {
    // completedSteps has 5 of 6 done; current is the last uncompleted one
    expect(getNextActiveStep(new Set([0, 1, 2, 3, 4]), 5, 6)).to.equal(5);
  });
});

describe('isComplete', () => {
  it('returns true when completedSteps.size equals totalSteps', () => {
    expect(isComplete(new Set([0, 1, 2, 3, 4, 5]), 6)).to.be.true;
  });

  it('returns false when not all steps are completed', () => {
    expect(isComplete(new Set([0, 1, 2]), 6)).to.be.false;
  });

  it('returns false for an empty set', () => {
    expect(isComplete(new Set(), 6)).to.be.false;
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx wtr --config ./web-test-runner.config.mjs "./test/unit/claude-design-onboarding/utils.test.js" --node-resolve --port=2000
```

Expected: import error — `utils.js` does not exist yet.

- [ ] **Step 3: Implement utils.js**

Create `tools/claude-design-onboarding/utils.js`:

```js
const EXPIRY_MS = 24 * 60 * 60 * 1000;

export function storageKey(url) {
  return `da-onboarding-${url}`;
}

export function loadProgress(url) {
  try {
    const raw = localStorage.getItem(storageKey(url));
    if (!raw) return null;
    const { completedSteps, activeStep, savedAt } = JSON.parse(raw);
    if (Date.now() - savedAt > EXPIRY_MS) {
      localStorage.removeItem(storageKey(url));
      return null;
    }
    return { completedSteps: new Set(completedSteps), activeStep };
  } catch {
    return null;
  }
}

export function saveProgress(url, completedSteps, activeStep) {
  localStorage.setItem(storageKey(url), JSON.stringify({
    completedSteps: [...completedSteps],
    activeStep,
    savedAt: Date.now(),
  }));
}

export function clearProgress(url) {
  localStorage.removeItem(storageKey(url));
}

export function getNextActiveStep(completedSteps, currentActiveStep, totalSteps) {
  for (let i = currentActiveStep + 1; i < totalSteps; i++) {
    if (!completedSteps.has(i)) return i;
  }
  for (let i = 0; i < currentActiveStep; i++) {
    if (!completedSteps.has(i)) return i;
  }
  return currentActiveStep;
}

export function isComplete(completedSteps, totalSteps) {
  return completedSteps.size >= totalSteps;
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx wtr --config ./web-test-runner.config.mjs "./test/unit/claude-design-onboarding/utils.test.js" --node-resolve --port=2000
```

Expected: all tests pass, no failures.

- [ ] **Step 5: Commit**

```bash
git add tools/claude-design-onboarding/utils.js test/unit/claude-design-onboarding/utils.test.js
git commit -m "feat(onboarding): add localStorage utils with tests"
```

---

## Task 3: CSS

**Files:**
- Create: `tools/claude-design-onboarding/claude-design-onboarding.css`

- [ ] **Step 1: Create the CSS file**

Create `tools/claude-design-onboarding/claude-design-onboarding.css`:

```css
onboarding-app {
  --ob-accent: var(--s2-blue-900, #0265dc);
  --ob-accent-hover: var(--s2-blue-1000, #0054b6);

  display: block;
  padding: var(--spacing-300, 16px);
  box-sizing: border-box;
  -webkit-font-smoothing: antialiased;
  font-family: var(--body-font-family, adobe-clean, 'Source Sans Pro', -apple-system, sans-serif);
  color: var(--s2-gray-800, #222);
}

/*
 * sl-button hosts must NOT use nexter class names (.accent etc.):
 * nexter buttons.css targets those and paints the host while ::part(base) paints
 * the inner button — causing a nested double-pill. Use ob- prefixed classes instead.
 */
sl-button.ob-fill-accent,
sl-button.ob-quiet-secondary {
  background: transparent;
  border: none;
  padding: 0;
  vertical-align: middle;
}

sl-button.ob-fill-accent::part(base) {
  background: var(--ob-accent);
  border-color: var(--ob-accent);
  color: var(--s2-gray-75, #fff);
}

sl-button.ob-fill-accent::part(base):hover:not(:disabled) {
  background: var(--ob-accent-hover);
  border-color: var(--ob-accent-hover);
}

sl-button.ob-quiet-link {
  background: transparent;
  border: none;
  padding: 0;
}

sl-button.ob-quiet-link::part(base) {
  background: transparent;
  border: none;
  color: var(--ob-accent);
  font-size: var(--s2-body-s-size, 13px);
  padding: 0;
}

sl-button.ob-quiet-link::part(base):hover {
  text-decoration: underline;
}

/* Header */

onboarding-app .ob-eyebrow {
  display: block;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ob-accent);
  margin: 0 0 var(--spacing-100, 8px);
}

onboarding-app .ob-title {
  font-size: var(--s2-heading-l-size, 24px);
  font-weight: 700;
  margin: 0 0 var(--spacing-75, 6px);
  color: var(--s2-gray-900, #1a1a1a);
  letter-spacing: -0.01em;
  line-height: 1.2;
}

onboarding-app .ob-subtitle {
  font-size: var(--s2-body-s-size, 13px);
  color: var(--s2-gray-600, #767676);
  margin: 0 0 var(--spacing-400, 24px);
  line-height: 1.5;
}

/* Progress */

onboarding-app .ob-progress {
  margin-bottom: var(--spacing-300, 16px);
}

onboarding-app .ob-progress-label {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--s2-gray-600, #767676);
  margin-bottom: var(--spacing-75, 6px);
}

onboarding-app .ob-progress-track {
  height: 4px;
  background: var(--s2-gray-200, #e0e0e0);
  border-radius: 99px;
  overflow: hidden;
}

onboarding-app .ob-progress-fill {
  height: 100%;
  background: var(--ob-accent);
  border-radius: 99px;
  transition: width 0.3s ease;
}

/* Step card */

onboarding-app .ob-step-card {
  background: #fff;
  border: 1px solid var(--s2-gray-200, #e0e0e0);
  border-radius: var(--s2-radius-200, 10px);
  padding: var(--spacing-300, 16px);
  margin-bottom: var(--spacing-300, 16px);
  box-shadow: 0 1px 4px rgb(0 0 0 / 0.06);
}

onboarding-app .ob-step-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--s2-gray-600, #767676);
  margin: 0 0 var(--spacing-75, 6px);
}

onboarding-app .ob-step-title {
  font-size: var(--s2-heading-s-size, 18px);
  font-weight: 700;
  margin: 0 0 var(--spacing-100, 8px);
  color: var(--s2-gray-900, #1a1a1a);
  line-height: 1.3;
}

onboarding-app .ob-step-desc {
  font-size: var(--s2-body-s-size, 13px);
  color: var(--s2-gray-700, #444);
  line-height: 1.6;
  margin: 0 0 var(--spacing-300, 16px);
}

/* Lessons list */

onboarding-app .ob-lessons-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--s2-gray-600, #767676);
  margin: 0 0 var(--spacing-100, 8px);
}

onboarding-app .ob-lessons-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-75, 4px);
}

onboarding-app .ob-lesson-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-200, 12px);
  padding: var(--spacing-150, 10px) var(--spacing-200, 12px);
  border-radius: var(--s2-radius-100, 6px);
  cursor: pointer;
  transition: background 0.15s ease;
}

onboarding-app .ob-lesson-row:hover {
  background: var(--s2-gray-75, #f5f5f5);
}

onboarding-app .ob-lesson-row.active {
  background: var(--s2-blue-100, #e8f4fd);
}

onboarding-app .ob-lesson-badge {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--s2-body-s-size, 13px);
  font-weight: 700;
  flex-shrink: 0;
  border: 2px solid var(--s2-gray-300, #ccc);
  color: var(--s2-gray-500, #999);
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

onboarding-app .ob-lesson-row.active .ob-lesson-badge {
  background: var(--ob-accent);
  border-color: var(--ob-accent);
  color: #fff;
}

onboarding-app .ob-lesson-row.completed .ob-lesson-badge {
  background: transparent;
  border-color: var(--s2-green-700, #2d9e4f);
  color: var(--s2-green-700, #2d9e4f);
  font-size: 14px;
}

onboarding-app .ob-lesson-title {
  font-size: var(--s2-body-m-size, 14px);
  color: var(--s2-gray-800, #222);
}

onboarding-app .ob-lesson-row.completed .ob-lesson-title {
  color: var(--s2-gray-500, #999);
}

/* Completion screen */

onboarding-app .ob-completion {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: var(--spacing-600, 40px) var(--spacing-300, 16px);
  gap: var(--spacing-200, 12px);
}

onboarding-app .ob-completion-icon {
  font-size: 48px;
  line-height: 1;
}

onboarding-app .ob-completion-title {
  font-size: var(--s2-heading-l-size, 24px);
  font-weight: 700;
  color: var(--s2-gray-900, #1a1a1a);
  margin: 0;
}

onboarding-app .ob-completion-msg {
  font-size: var(--s2-body-m-size, 14px);
  color: var(--s2-gray-600, #767676);
  line-height: 1.6;
  margin: 0;
  max-width: 260px;
}
```

- [ ] **Step 2: Commit**

```bash
git add tools/claude-design-onboarding/claude-design-onboarding.css
git commit -m "feat(onboarding): add plugin CSS"
```

---

## Task 4: LitElement component

**Files:**
- Create: `tools/claude-design-onboarding/claude-design-onboarding.js`

- [ ] **Step 1: Create the component**

Create `tools/claude-design-onboarding/claude-design-onboarding.js`:

```js
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { LitElement, html, nothing } from 'da-lit';
import { loadProgress, saveProgress, clearProgress, getNextActiveStep, isComplete } from './utils.js';

const STEPS = [
  {
    title: 'Welcome to your demo site',
    description: 'This is a live demo site. Every section is real and editable, and nothing here touches production. Take a look around, then make it yours.',
  },
  {
    title: 'Edit on the canvas',
    description: 'Click any text or image to start editing directly on the page. Changes are saved automatically — no publish needed while you explore.',
  },
  {
    title: 'Add a section',
    description: 'Use the + button between sections to insert a new block. Choose from layouts, media, and more to build out your page.',
  },
  {
    title: 'Ask the AI Assistant',
    description: 'Open the AI panel and ask it to write, rewrite, or summarize any section. Try: "Make this headline more compelling."',
  },
  {
    title: 'Run a skill',
    description: 'Skills are reusable AI actions — things like translating a page, generating metadata, or checking for broken links. Open the Skills panel to browse what\'s available.',
  },
  {
    title: 'Preview & publish',
    description: 'When you\'re happy with your changes, hit Preview to see them live, then Publish to make them public. Your audience sees only published content.',
  },
];

class OnboardingApp extends LitElement {
  static properties = {
    _activeStep: { state: true },
    _completedSteps: { state: true },
    _done: { state: true },
  };

  constructor() {
    super();
    this._activeStep = 0;
    this._completedSteps = new Set();
    this._done = false;
  }

  createRenderRoot() { return this; }

  connectedCallback() {
    super.connectedCallback();
    this._init();
  }

  async _init() {
    try {
      await DA_SDK;
    } catch {
      // SDK unavailable in standalone/dev
    }
    const saved = loadProgress(window.location.href);
    if (saved) {
      this._completedSteps = saved.completedSteps;
      this._activeStep = saved.activeStep;
      this._done = isComplete(this._completedSteps, STEPS.length);
    }
  }

  _onMarkComplete() {
    const next = new Set(this._completedSteps);
    next.add(this._activeStep);
    if (isComplete(next, STEPS.length)) {
      this._completedSteps = next;
      this._done = true;
      saveProgress(window.location.href, next, this._activeStep);
      return;
    }
    const nextStep = getNextActiveStep(next, this._activeStep, STEPS.length);
    this._completedSteps = next;
    this._activeStep = nextStep;
    saveProgress(window.location.href, next, nextStep);
  }

  _onNavigateToStep(index) {
    this._activeStep = index;
  }

  _onStartOver() {
    clearProgress(window.location.href);
    this._completedSteps = new Set();
    this._activeStep = 0;
    this._done = false;
  }

  _renderStepCard() {
    const step = STEPS[this._activeStep];
    const isAlreadyDone = this._completedSteps.has(this._activeStep);
    return html`
      <div class="ob-step-card">
        <p class="ob-step-label">Step ${this._activeStep + 1} / ${STEPS.length}</p>
        <p class="ob-step-title">${step.title}</p>
        <p class="ob-step-desc">${step.description}</p>
        <sl-button
          class="ob-fill-accent"
          ?disabled=${isAlreadyDone}
          @click=${() => this._onMarkComplete()}
        >
          ${isAlreadyDone ? 'Completed ✓' : 'Mark complete →'}
        </sl-button>
      </div>`;
  }

  _renderLessonsList() {
    return html`
      <p class="ob-lessons-label">All Lessons</p>
      <ul class="ob-lessons-list">
        ${STEPS.map((step, i) => {
          const completed = this._completedSteps.has(i);
          const active = this._activeStep === i;
          const cls = `ob-lesson-row${active ? ' active' : ''}${completed ? ' completed' : ''}`;
          const badge = completed ? '✓' : String(i + 1);
          return html`
            <li class=${cls} @click=${() => this._onNavigateToStep(i)}>
              <span class="ob-lesson-badge">${badge}</span>
              <span class="ob-lesson-title">${step.title}</span>
            </li>`;
        })}
      </ul>`;
  }

  _renderCompletion() {
    return html`
      <div class="ob-completion">
        <span class="ob-completion-icon">🎉</span>
        <p class="ob-completion-title">You're all done!</p>
        <p class="ob-completion-msg">
          You've completed all ${STEPS.length} lessons. You're ready to make this site your own.
        </p>
        <sl-button class="ob-quiet-link" @click=${() => this._onStartOver()}>
          Start over
        </sl-button>
      </div>`;
  }

  render() {
    const fillPct = (this._completedSteps.size / STEPS.length) * 100;
    return html`
      <span class="ob-eyebrow">Guided Onboarding</span>
      <h1 class="ob-title">Make this site yours</h1>
      <p class="ob-subtitle">Follow these lessons to get started — everything here is a safe sandbox.</p>

      <div class="ob-progress">
        <div class="ob-progress-label">
          <span>Your Progress</span>
          <span>${this._completedSteps.size} of ${STEPS.length}</span>
        </div>
        <div class="ob-progress-track">
          <div class="ob-progress-fill" style="width: ${fillPct}%"></div>
        </div>
      </div>

      ${this._done ? this._renderCompletion() : html`
        ${this._renderStepCard()}
        ${this._renderLessonsList()}
      `}
    `;
  }
}

customElements.define('onboarding-app', OnboardingApp);
```

- [ ] **Step 2: Run the full unit test suite to confirm nothing is broken**

```bash
npm test
```

Expected: all tests pass (including the new utils tests from Task 2).

- [ ] **Step 3: Commit**

```bash
git add tools/claude-design-onboarding/claude-design-onboarding.js
git commit -m "feat(onboarding): add LitElement component"
```

---

## Task 5: Smoke test in browser

**Files:** none

- [ ] **Step 1: Open the plugin in a browser**

Open `tools/claude-design-onboarding/claude-design-onboarding.html` via a local dev server. If using the DA dev environment, navigate to `https://da.live/canvas#/<org>/<site>` and load the plugin from the library panel. Otherwise, run any static server on the project root:

```bash
npx serve . -l 3000
```

Then open: `http://localhost:3000/tools/claude-design-onboarding/claude-design-onboarding.html`

- [ ] **Step 2: Verify the happy path**

Check the following manually:
1. Plugin loads without JS errors in the browser console
2. Header shows "Guided Onboarding", "Make this site yours", and subtitle text
3. Progress bar shows "0 of 6" and the fill is at 0%
4. Step card shows "Step 1 / 6", the first step title + description, and "Mark complete →" button
5. "All Lessons" list shows all 6 steps — step 1 badge is accent-colored, others are grey
6. Clicking "Mark complete →" on step 1: badge turns to a green checkmark, step 2 becomes active, progress bar fills to ~17%, localStorage entry is written
7. After completing all 6 steps: completion screen shows "You're all done!" with 🎉 icon
8. Clicking "Start over" resets to step 1 with empty progress, localStorage entry removed
9. Reloading the page restores progress (if within 24h)
10. Clicking a lesson row in "All Lessons" navigates to that step

- [ ] **Step 3: Final commit**

```bash
git add .
git commit -m "feat(onboarding): complete claude-design-onboarding plugin"
```
