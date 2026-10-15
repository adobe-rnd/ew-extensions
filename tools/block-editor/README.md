# Block editor extension (local prototype)

Experimental block-properties sidebar using `sdk.actions.subscribeLiveDocument`.
Live HTML and the zero-based selected block index populate the sidebar on canvas
changes and caret movement. Edits send the **whole selected block** through
`sdk.actions.sendHTML(html, { replace: true })`, updating the live editor through
its normal collaboration and autosave. No document source API reads or writes
are needed. Parsing and editing are local to the extension, not the SDK.

## Run locally

Serve this repository with your local HTTP development server (port 3001 in this
example). Configure a sidebar extension in the canvas's library configuration
using this tool URL; the canvas host and SDK must support live subscriptions and
HTML replacement:

```text
http://localhost:3001/tools/block-editor/block-editor.html
```

`nx` is the base containing `utils/sdk.js`. The shared picker component and
styles use `nx2`, derived as the sibling `/nx2` base unless explicitly overridden.
The extension initializes nx2 configuration before loading those components.
Lit is mapped statically in the HTML to `https://da.live/deps/lit/dist/index.js`
before any module loads, avoiding Firefox's dynamic import-map timing issue.
`live` still controls local library source resolution; it no longer changes Lit.
Icons are copies of the DA SVG assets
under this tool's `img/icons/`; both sidebar controls and the shared picker
components use this same-origin asset base. External SVG `<use>` references
cannot cross origins, including different localhost ports, even with CORS.
Both accept HTTP(S) bases, including a path prefix, and reject credentials, query
strings, and fragments. Defaults use the published SDK (`https://da.live/nx`),
UI assets (`https://da.live/nx2`) and `ref=main`, including on localhost.
Until the new SDK is deployed, set `nx` to the local da-nx `blockext` asset base;
`nx2` defaults to its sibling path unless explicitly overridden. Each override
applies only to its own base. `ref=local` resolves relative library index
sources against `live`; otherwise they resolve to the site AEM live origin.

Open through the canvas extension panel, not a standalone tab: the SDK requires
the parent handshake. The extension requires `sdk.capabilities.liveDocument === 1`
and `sdk.capabilities.sendHTMLReplace === 1`, plus
`sdk.actions.subscribeLiveDocument(callback)`, which returns an unsubscribe
function. The callback supplies `{ html, selection: { blockIndex }, editable }`: `html` is
EDS-shaped live `<main>` HTML and `blockIndex` is a zero-based document-wide block
ordinal, or `null` outside a block. Both live document changes and caret-only
selection changes update the sidebar. Image URLs retain the original editor
sources, rather than site-preview-relative URLs, so unchanged images can be sent
back without URL reconstruction. Unsupported hosts show a clear error rather
than falling back to `getSelection` text matching. Removal unsubscribes and ignores
late replacement replies. The extension resolves org/site/path from SDK `context` or
`project` (`repo` is also accepted as the site). `daFetch`, `showPanel('blocks')`,
and optionally `setPrompt` are used for API and panel operations. On localhost
and loopback IPs, the default API is `https://stage-admin.da.live`; other hosts
default to `https://admin.da.live`. An explicit `admin` query parameter
(URL-encoded in the tool URL) overrides either default with a validated HTTP(S)
API base.
The extension's API environment must match the canvas; it cannot infer the
parent's environment from the SDK.

Place the caret inside a block to see live values; selected text is unnecessary.
The sidebar follows the live block automatically, and clears its selection outside
a block. Changes apply on blur/change through live HTML replacement, including
unsaved canvas content. The acknowledgement supplies the updated live document,
so consecutive edits do not require a reload. Read-only editors disable field
editing. Conflict recovery offers **Discard drafts**, returning to the latest live
values without making an API request or reloading the canvas.

The block name button opens the host's existing **Blocks** library modal through
`sdk.actions.showPanel('blocks')`. Choosing a template is handled by the canvas
host; it replaces the selected live block. This action remains separate from
sidebar field edits.

### Fixture library without IMS

Append `&library=http%3A%2F%2Flocalhost%3A3001%2Ftools%2Fsdk-block-editor%2Flibrary.json`
to bypass the host's library configuration lookup. The validated HTTP(S) index URL is fetched
through SDK `actions.daFetch`, as are the referenced template documents. Refresh
refetches that index and those documents. The SDK still supplies org/site/path context.

Failed template requests or parsing failures do not prevent other templates from
loading. Unavailable templates are logged to the console without a sidebar
warning. For failures affecting the selected block, the sidebar provides
**Retry loading library** to refetch the index and templates. A selected block
whose template failed cannot generate fields from that missing template. If every
template fails, or the index itself cannot be loaded, the sidebar shows an error
instead of treating the library as empty.

Example `/tools/sdk-block-editor/library.json`:

```json
{
  "data": [
    { "name": "Cards", "path": "http://localhost:3001/tools/sdk-block-editor/cards.html" }
  ],
  "editor": { "data": [{ "block": "cards", "property": "multi" }] },
  "options": { "data": [{ "blocks": "all", "key": "Color", "values": "Red=red|Blue=blue" }] }
}
```

Example `/tools/sdk-block-editor/cards.html` (no `.plain.html` suffix is added to
localhost document URLs):

```html
<main><div>
  <div class="cards">
    <div><div><h3>First title</h3><p>First body</p></div></div>
    <div><div><h3>Second title</h3><p>Second body</p></div></div>
  </div>
  <div class="library-metadata">
    <div><div>fields</div><div><table>
      <tr><td>Fields</td></tr>
      <tr><td><p>Title</p><p>Body</p></td></tr>
    </table></div></div>
  </div>
</div></main>
```

Only the first content row supplies the shared schema because the index's
`editor` sheet explicitly configures this block as multi-item. Without that
configuration, metadata must describe both content rows.

## Expected functionality and limitations

| Feature | Status |
| --- | --- |
| Block selection | Live zero-based block index, updated on caret movement; selection outside blocks clears the sidebar |
| Plain text, headings, line breaks, simple links | Editable; rich/nested markup is read-only rather than flattened |
| Library field labels and simple key/value dropdowns | Supported; library config is fetched directly from DA |
| Lists | Plain items and simple links editable; add/delete/reorder supported |
| Multi-item blocks | Library-configured row previews, expand, append/delete and keyboard/drag reorder supported |
| Block variants | Supported by replacing the live block with updated classes |
| Generate/repair fields and library refresh | Uses existing `setPrompt` when available; refresh refetches library sources |
| Images | Replace single-image fields by PNG, JPEG, GIF or SVG upload (up to 20 MB); AEM Assets unavailable |
| Replace block with library template | Block name button opens the existing host Blocks modal via SDK `showPanel('blocks')`; host replaces in live canvas |
| Click item to navigate canvas | Unavailable; expands sidebar item only |
| Canvas live updates, undo/redo, collaborative edits | Sidebar writes use the live editor's collaboration, history and autosave |

Each edit applies semantic changes to the selected live block and sends its full
HTML with `replace: true` and an `expected` guard containing the captured live
document HTML and selected zero-based block ordinal. The host verifies both before
dispatching a single editor transaction. Changed content or a moved selection is
rejected instead of overwriting a collaborator's edit or replacing the wrong block.
Identical blocks are safe to target by ordinal within this guarded live snapshot.
Success confirms the editor update, not completion of durable persistence.

Content outside the selected block remains untouched. The host parses the block
into its existing schema and preserves local selection where possible without
stealing focus from the sidebar. Drafts retain their original live revision and
block signature; conflicts keep the draft and are shown explicitly, never silently
rebased. Unchanged blur values do not write. Failed and timed-out replacements are
not automatically retried.

**Replace image** uploads the chosen file through authenticated SDK `daFetch` to
the DA source API, in the document's `.<document-name>/` media folder. Each upload
uses a unique filename so replacing one image cannot overwrite a shared asset.
Only the asset is uploaded through the API: its returned `contentUrl` is applied
to the image and picture sources through the same guarded live block replacement
as text edits. Alt text and enclosing links are preserved; old responsive URLs and
dimensions are cleared. The image target and revision are captured before opening
the file picker and rechecked after upload. Changed selections, collaborative edits
and read-only state prevent replacement; a file already uploaded may remain unused.
Mixed text/image fields and fields containing multiple images remain read-only.
This upload path uses the DA source store, not the Helix 6 media-bus API or AEM Assets.

## Validate

```sh
npx wtr --config ./web-test-runner.config.mjs \
  'test/unit/block-editor/*.test.js' --node-resolve --port=2001
npx eslint tools/block-editor/*.js
npx stylelint 'tools/block-editor/*.css'
```

Tests exercise pure schema/label matching, multi-row configuration, options,
read-only/list rules, local URL validation, subscription lifecycle, SDK panel
navigation, guarded live replacement, semantic operations, draft conflict behavior,
and prompt generation.
SDK adapter unit tests use the repository's existing Lit stub; real iframe
rendering and integrated host dialog behavior require the live-capable host.
