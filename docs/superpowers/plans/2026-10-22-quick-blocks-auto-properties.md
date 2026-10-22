# Quick Blocks auto-switch to Properties Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While Quick Blocks shows Blocks or Assets, selecting a block in the canvas switches the sidebar to EW's Block panel.

**Architecture:** The da-live iframe protocol posts `ew-block-selection` to the plugin iframe when the selected block (per `getSelectedBlock`) changes to a different block while the iframe is visible. Quick Blocks reacts by calling `actions.showPanel('block')` unless it is not on Blocks/Assets or it just inserted content itself.

**Tech Stack:** Vanilla ES modules, Lit (`da-lit`), ProseMirror (`da-y-wrapper`), web-test-runner + chai + sinon.

**Spec:** `docs/superpowers/specs/2026-10-22-quick-blocks-auto-properties-design.md`

## Global Constraints
- da-live changes are made and committed **only on branch `devlive`** (`/Users/mhaack/source/da/da-live`). Verify `git branch --show-current` prints `devlive` before every da-live commit. Never push, never switch branches.
- ew-extensions changes go on the current branch `quickblk`.
- Message contract: `{ type: 'ew-block-selection', name: string }`, posted with the existing `respondToPicker` (window `postMessage` to `targetOrigin`).
- "Selected" = `getSelectedBlock(view.state)` from `blocks/canvas/editor-utils/blocks.js` (NodeSelection on a table, or cursor/selection inside a table).
- Fire only when the selected block's `from` differs from the last seen value and is non-null.
- Insert guard window: 500 ms.

## Review Focus
- Becoming visible (returning from Properties) while the same block is still selected must **not** fire — the last-seen `from` is tracked while hidden too. (Task 1 test.)
- Deselect then reselect the same block must fire again (null resets last-seen). (Task 1 test.)
- Typing inside a selected block (doc changes, same block `from`) must not fire repeatedly. (Task 1 test.)
- An `ew-block-selection` arriving right after a Quick Blocks click insert must not switch. (Task 2 test.)
- On a non-Blocks/Assets state or without `showPanel`, the message must be a silent no-op — no error banner. (Task 2 test.)

---

### Task 1: da-live — post `ew-block-selection` on block selection change

**Files (repo `/Users/mhaack/source/da/da-live`, branch `devlive`):**
- Modify: `blocks/canvas/ew-panel-extensions/iframe-protocol.js` (state block near lines 52–72; `destroy` near line 349)
- Test: `test/unit/blocks/canvas/ew-panel-extensions/iframe-protocol.test.js` (new `describe` at end)

**Interfaces:**
- Consumes: `getSelectedBlock(state) → { node, from, to } | null` from `../editor-utils/blocks.js`; `canvasBus.toolbarSelectionState`, `canvasBus.editorDocState` (`.subscribe(fn) → unsubscribe`).
- Produces: window message to the plugin `{ type: 'ew-block-selection', name }` where `name = getTableBlockName(node)` (exported from `../editor-utils/blocks.js`).

- [ ] **Step 0: Confirm branch**
Run: `git -C /Users/mhaack/source/da/da-live branch --show-current` → Expected: `devlive`. Stop if not.

- [ ] **Step 1: Write the failing tests** — append `describe('setupIframeChannel block selection', …)`:
  - Helpers: `tableJSON(name)` like `test/unit/blocks/canvas/editor-utils/blocks.test.js:39`; a doc `[paragraph 'Intro', tableJSON('cards'), tableJSON('hero')]` via `makeView`; `makeIframe()` extended with `checkVisibility: () => visible` (a `let visible = true`); `select(view, pos)` dispatches `TextSelection.create(doc, pos)`; `selections(iframe)` = `postMessage` calls filtered to `args[0].type === 'ew-block-selection'`.
  - `it('posts the block name when the cursor moves into a block')` — cursor in paragraph, emit `canvasBus.toolbarSelectionState.emit({})`, expect 0; cursor inside `cards` cell, emit, expect 1 with `{ type: 'ew-block-selection', name: 'cards' }` and target origin `'https://plugin.example.com'`.
  - `it('posts again when a different block is selected')` — cards then hero → 2 messages, second `name: 'hero'`.
  - `it('does not repeat for the same block on selection or doc changes')` — cursor in cards; emit `toolbarSelectionState` twice and `editorDocState.emit()` once → 1 message.
  - `it('does not post while hidden and stays quiet when shown with the same block')` — `visible = false`, select cards, emit → 0; `visible = true`, emit → 0.
  - `it('posts after leaving and re-entering the same block')` — cards, paragraph, cards (emit each) → 2 messages.
  - `it('stops after destroy')` — destroy, select cards, emit → 0.
  - Use `await wait(0)` after emits only if the implementation defers; call `destroy()` in `afterEach`.

- [ ] **Step 2: Run to verify failure**
Run: `npx wtr "./test/unit/blocks/canvas/ew-panel-extensions/iframe-protocol.test.js" --node-resolve --port=2000`
Expected: new tests FAIL (no `ew-block-selection` messages).

- [ ] **Step 3: Implement in `iframe-protocol.js`**
  - Import `getSelectedBlock, getTableBlockName` from `../editor-utils/blocks.js`.
  - After `respondToPicker`, add `let lastSelectedFrom = null;` and `const checkBlockSelection = () => { … }`:
    `const block = getSelectedBlock(getView()?.state); const from = block?.from ?? null; if (from === lastSelectedFrom) return; lastSelectedFrom = from; if (from === null || destroyed) return; if (iframe.checkVisibility?.() === false) return; respondToPicker('ew-block-selection', { name: getTableBlockName(block.node) });`
  - Subscribe: `const unsubscribeBlockSelection = canvasBus.toolbarSelectionState.subscribe(checkBlockSelection);` and `const unsubscribeBlockDoc = canvasBus.editorDocState.subscribe(checkBlockSelection);`
  - In `destroy`, call both unsubscribers next to `unsubscribeSelection()`.
  - Add one line to the top JSDoc: `Block selection changes post ew-block-selection { name } to the plugin.`

- [ ] **Step 4: Run to verify pass**
Run the Step 2 command. Expected: all tests in the file PASS. Then `npx eslint blocks/canvas/ew-panel-extensions/iframe-protocol.js test/unit/blocks/canvas/ew-panel-extensions/iframe-protocol.test.js` → no errors.

- [ ] **Step 5: Commit (devlive only)**
```bash
cd /Users/mhaack/source/da/da-live
test "$(git branch --show-current)" = devlive || exit 1
git add blocks/canvas/ew-panel-extensions/iframe-protocol.js test/unit/blocks/canvas/ew-panel-extensions/iframe-protocol.test.js
git commit -m "feat(canvas): notify plugin iframes when the selected block changes"
```

---

### Task 2: ew-extensions — switch to Properties on `ew-block-selection`

**Files (repo `/Users/mhaack/source/da/ew-extensions`, branch `quickblk`):**
- Modify: `tools/quick-blocks/quick-blocks.js` (constructor, `_onHandleMessage` in `connectedCallback`, `_add`, `_dragStart`, `_dragEnd`)
- Modify: `README.md` (Properties paragraph, ~line 46)
- Test: `test/unit/quick-blocks-component.test.js` (inside `describe('Quick Blocks Properties shortcut')`)

**Interfaces:**
- Consumes: message `{ type: 'ew-block-selection', name }` from Task 1.
- Produces: `QuickBlocks#_onBlockSelection(): void`; `this._now: () => number` (default `() => Date.now()`); `this._lastInsertAt: number` (default `-Infinity`).

- [ ] **Step 1: Write the failing tests**
  - `it('opens the Block panel when a block is selected on the Blocks or Assets tab')` — for `blocks` and `assets`: set `_tab`, call `element._onBlockSelection()`, expect `opened` to deep equal `['block']`; `_tab` unchanged.
  - `it('ignores block selection right after its own insert')` — `element._now = () => 1000; element._actions.sendHTML = () => {}; element._add('<p>x</p>'); element._now = () => 1400; element._onBlockSelection();` → `opened` empty; `element._now = () => 1501; element._onBlockSelection();` → `['block']`.
  - `it('ignores block selection right after a drag')` — `_now = () => 1000`, call `element._dragEnd()` (with `_editorOrigin` unset), `_now = () => 1200`, `_onBlockSelection()` → `opened` empty.
  - `it('ignores block selection silently without showPanel')` — `element._actions = {}`; `_onBlockSelection()`; expect `element._error` to equal `''`.

- [ ] **Step 2: Run to verify failure**
Run: `npx wtr --config ./web-test-runner.config.mjs "./test/unit/quick-blocks*.test.js" --node-resolve --port=2001`
Expected: new tests FAIL (`_onBlockSelection is not a function`).

- [ ] **Step 3: Implement in `quick-blocks.js`**
  - Constructor: `this._now = () => Date.now(); this._lastInsertAt = -Infinity;`
  - `_markInsert()` sets `this._lastInsertAt = this._now()`; call it in `_add` (after `sendHTML`), `_dragStart`, and `_dragEnd`.
  - `_onBlockSelection()`: return if `!['blocks','assets'].includes(this._tab)`, if `this._now() - this._lastInsertAt <= 500`, or if `!this._actions?.showPanel`; else `this._actions.showPanel('block')`.
  - In `_onHandleMessage` add branch `else if (type === 'ew-block-selection') this._onBlockSelection();` (stays behind the existing source/origin check).

- [ ] **Step 4: Run to verify pass**
Run the Step 2 command → all PASS. Then `npx eslint tools/quick-blocks test/unit/quick-blocks-component.test.js` → no errors.

- [ ] **Step 5: README**
After the Properties paragraph add: "While the Blocks or Assets tab is showing, selecting a block in the canvas (or placing the cursor in one of its cells) switches to the Block panel automatically. Selections caused by a Quick Blocks insert or drag in the previous half second are ignored. Requires an EW host that sends `ew-block-selection`."

- [ ] **Step 6: Commit**
```bash
cd /Users/mhaack/source/da/ew-extensions
git add tools/quick-blocks/quick-blocks.js test/unit/quick-blocks-component.test.js README.md
git commit -m "feat(quick-blocks): open properties when a block is selected"
```
