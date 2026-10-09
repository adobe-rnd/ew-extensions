# Block editor extension (local prototype)

Prototype port of the `blocktab` canvas block-properties sidebar. It retains the Lit
markup and styles, library field metadata, link/text/dropdown/list controls,
multi-row previews and editing, keyboard and drag reordering, variant picker,
image upload/AEM Assets, scoped block replacement, and field generation/repair
and refresh. The host owns schema parsing, selection, media handling, and every
document mutation; the extension contains no editor implementation.

## Run locally

With all three repositories as siblings, start the integration server from da-live:

```sh
node tools/sdk-block-editor/server.mjs
```

Open `http://localhost:3001/tools/sdk-block-editor/` for a fixture-backed editor.
For a configured canvas document, use this extension tool URL:

```text
http://localhost:3002/tools/block-editor/block-editor.html?nx=http%3A%2F%2Flocalhost%3A3001%2Fnx&live=http%3A%2F%2Flocalhost%3A3001&ref=local
```

`nx` is the base containing `utils/sdk.js`. Shared picker/menu components and
styles use `nx2`, derived as the sibling `/nx2` base unless explicitly overridden.
The extension initializes nx2 configuration before loading those components.
`live` contains `deps/lit/dist/index.js`. Icons are copies of the DA SVG assets
under this tool's `img/icons/`; both sidebar controls and shared picker/menu
components use this same-origin asset base. External SVG `<use>` references
cannot cross origins, including different localhost ports, even with CORS.
Both accept HTTP(S) bases, including a path prefix, and reject credentials, query
strings, and fragments. Localhost defaults are da-nx `:3001/nx`, da-live `:3001`.
Specifying **either** override makes the other default local too; the extension
never silently imports production SDK/assets when a local override is present.
Without overrides, non-local deployments use `https://da.live/nx` and
`https://da.live`. `ref=local` resolves relative library index sources against
`live`; otherwise they resolve to the corresponding site AEM live origin.

Open through the canvas extension panel, not a standalone tab: the SDK requires
the parent handshake and `capabilities.editor = 1`. Older hosts show an explicit
unsupported-host message. The extension resolves org/site from SDK
`context.org/site` or `project.org/site` (`repo` is also accepted as the site).

### Fixture library without IMS

Append `&library=http%3A%2F%2Flocalhost%3A3001%2Ftools%2Fsdk-block-editor%2Flibrary.json`
to bypass the host's library configuration lookup. The validated HTTP(S) index URL is fetched
through SDK `actions.daFetch`, as are the referenced template documents. Refresh
refetches that index and those documents. The SDK still supplies org/site context.

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

## SDK boundary

Requires `subscribeDocument`, `describeBlock`, `applyChanges`, `selectTarget`,
`uploadImage`, `pickAsset`, `openBlockLibrary`, `getEditorConfig`, `daFetch`, and
`setPrompt`. Mutations echo the original opaque field/block targets plus
`documentId` and exact `revision`. Document HTML remains the host's instrumented
preview, with its existing normalization/metadata limitations.

For key/value dropdown parity, text descriptors should include the source-faithful
`optionKey` (only the strict simple two-cell key/value case). List item descriptors
must retain their own targets and read-only/multiline/link flags. Image `value`
uses `previewSrc` for a preview-resolved URL while retaining the source `value`.

Typing drafts survive same-document snapshots. Focus captures the original
revision before typing; conflicts are shown explicitly, never silently rebased.
The **Discard drafts and reload current values** button is the explicit recovery
path. Unchanged blur values do not create an edit. Changing documents discards
the previous document's drafts. Asset and library cancellation does not trigger
another mutation or claim success.

## Validate

```sh
npx wtr --config ./web-test-runner.config.mjs \
  'test/unit/block-editor/*.test.js' --node-resolve --port=2001
npx eslint tools/block-editor/*.js
npx stylelint 'tools/block-editor/*.css'
```

Tests exercise pure schema/label matching, multi-row configuration, options,
read-only/list rules, local URL validation, SDK lifecycle, semantic operations,
draft conflict behavior, and prompt generation. SDK adapter unit tests use the
repository's existing Lit stub; real iframe rendering and integrated host dialog
behavior additionally require the SDK-enabled local host.
