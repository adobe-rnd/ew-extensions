# Quick Blocks: switch to Properties on block selection

## Intent
When Quick Blocks is showing its **Blocks** or **Assets** tab and the author
selects a block in the canvas (whole block or cursor in a block cell), the
sidebar switches to EW's **Block** (Properties) panel via
`actions.showPanel('block')`. The Block panel already tracks the selection
itself; only the switch is new.

## Goals
- Switch on a *change* of selected block: none → block, or block A → block B.
- Same notion of "selected" as the Block panel (`getSelectedBlock`).
- Only while the Quick Blocks iframe is actually visible.

## Non-goals
- No changes to the Block panel itself.
- No switch back to Quick Blocks on deselect.
- Fixing the `'quick-block'` vs `'quick-blocks'` panel id in
  `ew-block-properties.js` (separate issue).

## Anti-goals
- Jumping to Properties right after a Quick Blocks click/drag insert.
- Bouncing back to Properties when the author returns to Blocks/Assets while
  the same block is still selected.

## Approaches
- **A. Extension only, reuse `ew-properties-watch`** — rejected: reports the
  *closest* block, not the selected one, so cursor moves in plain text would
  trigger switches.
- **B. Small host signal, extension decides** — **chosen**. Host emits a
  selection-change message; extension owns the policy and the insert guard.
- **C. Host only (`tool-panel` auto-switches)** — rejected: hard-codes Quick
  Blocks behaviour in EW and cannot distinguish an insert from a selection.

## Design
### da-live (branch `devlive` only)
`blocks/canvas/ew-panel-extensions/iframe-protocol.js`:
- Subscribe to the same triggers the Block panel uses
  (`canvasBus.toolbarSelectionState`, `canvasBus.editorDocState`).
- Compute `getSelectedBlock(getView()?.state)`; remember the last block start
  (`from`). When it changes to a different non-null block **and**
  `iframe.checkVisibility()` is true, post
  `{ type: 'ew-block-selection', name }` to the iframe via `respondToPicker`.
- Track the last block even while hidden, so becoming visible with an already
  selected block does not fire.
- Unsubscribe in the protocol's existing teardown.
- Unit test in `test/unit/blocks/canvas/ew-panel-extensions/iframe-protocol.test.js`.

### ew-extensions
`tools/quick-blocks/quick-blocks.js`:
- Handle `ew-block-selection` in the existing origin-checked message handler.
- If `_tab` is `blocks` or `assets` and no recent self-insert, call
  `this._actions.showPanel('block')`.
- Insert guard: `_add` and drag start/end set a timestamp; selections within a
  short window (~500 ms, builder's call) after it are ignored.
- Unit tests in `test/unit/quick-blocks-component.test.js`.

## Left to the builder
- Exact guard window and how it's timed (injectable clock for tests).
- Whether the host message also carries `selected:false` (not needed now).
