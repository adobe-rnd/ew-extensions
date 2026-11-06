# Brand Visibility Extension

Review Adobe Brand Visibility (LLMO) opportunities in Experience Workspace (EW),
and find suggestions for the page you are editing. The first marketplace version
is review-only: it does not include an **Apply suggestion** button.
The panel shows only opportunities tagged `isElmo` by the API.

## Prerequisites

- An authenticated EW session with access to the DA organization and site.
- An LLMO site ID and permission to read that site's opportunities and suggestions.
  The LLMO site ID is separate from the DA organization and repository names.
- An EW host that loads DA App SDK extensions. Draft discovery requires the
  host's `daFetch` action.
- Existing opportunities in Brand Visibility. This extension does not create
  audits or configure the site's Brand Visibility integration.

## Setup

### Register the Panel

Add the extension to the `library` sheet of your DA organization or site
configuration, following your host's sidebar extension configuration. For the
repository's main deployment, use this entry after confirming it is published:

| title | path | format | experience | icon | ref |
| --- | --- | --- | --- | --- | --- |
| Brand Visibility | https://main--ew-extensions--adobe-rnd.aem.live/tools/brand-visibility/brand-visibility.html?site-id=YOUR_LLMO_SITE_ID | | | | |

Replace `YOUR_LLMO_SITE_ID` with the site's actual LLMO ID. If using another
deployment, replace the URL origin with that deployment's origin. The entry point
is [brand-visibility.html](brand-visibility.html).

The `site-id` parameter must reach the extension iframe URL, not just the EW
shell URL. There is no site-ID input in the panel. Once supplied, the panel caches
the ID in browser local storage using the DA organization and repository as the
key. Keep it in the configured URL so new users and browsers get the same setup.
To switch LLMO sites, change the parameter and reload the panel.

### Authentication

EW supplies the user's IMS access token through the DA App SDK. The extension
exchanges it for a SpaceCat session token at:

```text
POST https://llmo.experiencecloud.live/api/v1/auth/login
```

The session token is cached in the current tab's session storage and reused until
shortly before expiry. The panel then reads opportunities and suggestions from
the LLMO API. No separate login form is provided.

### Optional Draft Comparison

For **Compare drafts**, the EW host must resolve `showPanel('drafts-preview')` to
the [Drafts Preview entry point](../drafts-preview/drafts-preview.html). Serve both
tools from the same origin: draft metadata is passed through local storage.
Registering Brand Visibility alone does not configure this host panel mapping.

## Using the Panel

1. Open a page in the EW canvas, then open **Brand Visibility**.
2. Wait for the panel to load opportunities and match suggestions to the page.
   When the host supplies a page path, the initial view is scoped to that page.
3. Expand an opportunity by clicking its card or **Show details**. Review the
  suggested content and any available draft links.
4. Make any desired changes separately in the canvas and review them before
  publishing through your normal workflow. The panel does not send prompts to
  the EW assistant or apply changes automatically.

### Page and Site Views

Use **Show all opportunities** to browse the site's LLMO opportunities and
**Show only this page** to return to the current page. If the host provides no
page path, only the site-wide view is available. Site-wide cards show titles and
descriptions, without expansion or apply controls.

Page matching compares URL paths, ignoring the hostname, a trailing `.html`, and
a trailing slash. Only `NEW` and `FIXED` suggestions matching that path appear.
Reload the panel after navigating if it still shows the previous page's path.

Search matches titles, descriptions, types, and tags. Open **Filters** to filter
by opportunity status or sort by **Most recent**, **A-Z**, or **Type**. Use
**Load more** when more than 50 results match.

### Reviewing Suggestions

- **Table of contents:** displays the proposed TOC entries.
- **Summarization:** displays the proposed summary or key points.
- **Prerender:** displays the available summary and impact metrics.
- **Other types:** displays the suggestion's data fields.

Use these details to inform your edits. This version does not generate content,
copy assistant prompts, or publish pages.

`FIXED` suggestions remain visible as history.
A card with only fixed matches displays **Fixed**,
but the status filter still uses the opportunity's API status. The panel does
not write status changes back to the API. Reload to pick up API status changes.

### Reviewing Drafts

When files exist under `/drafts/brand-visibility/<opportunity-id>/`, they appear
under **Draft content**. Open a draft link to edit it
in the DA canvas, or select **Compare drafts** to open the preview panel. Draft
lists refresh when the host reports relevant file changes; reload if necessary.
The panel does not create these drafts in this version.

## Local Development

Serve this repository with the AEM CLI from the repository root:

```bash
aem up --port 3001
```

Open the following URL, substituting your LLMO site ID and a URL-encoded,
short-lived IMS access token:

```text
http://localhost:3001/tools/brand-visibility/brand-visibility.html?site-id=YOUR_LLMO_SITE_ID&page-path=%2Fexample&token=YOUR_IMS_ACCESS_TOKEN
```

Standalone mode bypasses the SDK wait but does not provide DA draft access or
host panel navigation. Test those features inside EW.

| Parameter | Purpose |
| --- | --- |
| `site-id` | LLMO site ID; cached in browser local storage. |
| `page-path` | Override the page path, for example `/example`. |
| `llmo-api` | Override the API base, including `/api/v1` if required by that server. Defaults to `https://llmo.experiencecloud.live/api/v1`. |
| `token` | Override the IMS access token for development; not a SpaceCat session token. |

Use `token` only for local testing. URL tokens can leak through browser history,
logs, screenshots, and shared links. Never put one in library configuration,
source control, or support reports. Only use a trusted `llmo-api` endpoint: the
extension sends the IMS token to that endpoint's `/auth/login` route. A different
API origin must allow requests from the extension origin through CORS.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Sign-in message | Open the panel inside an authenticated EW session; standalone testing requires the development token override. |
| No LLMO site ID configured | Add `site-id` to the extension iframe URL and reload. |
| Session exchange failure or HTTP 401/403 | Check the IMS session, LLMO access permissions, API endpoint, and site ID. Sign in again or reopen the panel, then use **Retry**. |
| No brand visibility opportunities | Verify the selected LLMO site has opportunities tagged `isElmo`. Untagged opportunities are not shown. |
| No suggestions for this page | Check the displayed page path and try **Show all opportunities**. Only matching `NEW` and `FIXED` suggestions qualify; failed suggestion requests can also leave the page view empty. |
| Drafts missing or comparison does not open | Verify DA read permissions, the draft folder, the host's `drafts-preview` mapping, and same-origin local-storage access. |

For setup and support, share the extension URL with credentials removed, the
displayed page path, and the HTTP status of the failed request. Do not share
tokens or authorization headers.