# Text Library

A DA right-hand toolbar app for dragging reusable text styles onto a page.

## Setup

Create `/docs/library/text-styles` in the site being edited. Add a paragraph,
heading (H1-H6), list item, blockquote, or preformatted block for each sample.
Save the document; it does not need to be published. Inline formatting, text
classes, links, and inline typography styles are retained. Empty lines and DA
metadata are ignored. Lists supply one draggable entry per top-level item;
blockquotes and preformatted blocks stay together.

Add a row to the `library` sheet of the DA organization or site configuration:

| title | path | format | experience | icon | ref |
| --- | --- | --- | --- | --- | --- |
| Text Library | https://main--ew-extensions--adobe-rnd.aem.live/tools/text-library/text-library.html | | | | |

For branch testing, replace the origin with the deployment serving your branch.
The app must be deployed and the configuration row added before it appears in
the toolbar. No site configuration is modified automatically.

## Usage

Open **Text Library** in the DA canvas toolbar. Drag a sample onto the desired
position, or click it (Enter/Space also work) to insert at the cursor. The source
sample is copied, not moved. Click **Refresh** after saving library changes.

The app uses the host SDK's authenticated fetch and cross-iframe drag helper,
including its native HTML drag fallback for older hosts. The target site's editor
schema determines which formatting survives insertion. The panel shows basic
HTML previews; site-specific CSS classes are preserved in the payload but the
site's stylesheet is not loaded into the panel.

## SDK testing

Use `?sdk=<branch>` to load the SDK from an AEM branch deployment of `adobe/da-nx`,
for example:

`http://localhost:3001/tools/text-library/text-library.html?sdk=fix-sdk-drag-pointer-capture`

This loads
`https://fix-sdk-drag-pointer-capture--da-nx--adobe.aem.live/nx/utils/sdk.js`.
Use the lowercase, hyphenated branch name from the AEM deployment URL, not a full
URL or a slash-containing Git ref. The branch must be deployed and accessible to
the browser. Branch selection works for both local and hosted app URLs.

To test changes to the shared DA SDK, serve the `da-nx` checkout on port 6456
(`npm run local` in that repository) and use
`http://localhost:3001/tools/text-library/text-library.html?sdk=local`
as the extension URL. Only local app URLs accept `sdk=local`. Omitting the selector
or supplying an invalid value loads the default SDK from `https://da.live`.
