const TAGS = new Set('a p h1 h2 h3 h4 h5 h6 div span strong em b i u s del ins sub sup code pre blockquote ul ol li table thead tbody tfoot tr td th caption colgroup col br hr img figure figcaption'.split(' '));
const ATTRS = new Set(['href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'start']);

export function sanitizeContent(source, base) {
  const doc = new DOMParser().parseFromString(source, 'text/html');
  doc.querySelectorAll('script, style, iframe, object, embed, form, input, button, base, link, meta, template, svg, math, [data-mdast="ignore"]').forEach((el) => el.remove());
  [...doc.body.querySelectorAll('*')].reverse().forEach((el) => {
    if (!TAGS.has(el.localName)) {
      el.replaceWith(...el.childNodes);
      return;
    }
    [...el.attributes].forEach(({ name, value }) => {
      if (!ATTRS.has(name)) el.removeAttribute(name);
      else if (['href', 'src'].includes(name)) {
        try {
          const url = new URL(value, base);
          if (!['https:', 'http:', ...(name === 'href' ? ['mailto:', 'tel:'] : [])].includes(url.protocol)) {
            el.removeAttribute(name);
          } else el.setAttribute(name, url.href);
        } catch { el.removeAttribute(name); }
      }
    });
    if (el.localName === 'a') el.removeAttribute('href');
  });
  return doc.body.innerHTML;
}

export async function comparisonDocument({ current, proposed, base }) {
  const { htmlDiff } = await import('https://da.live/blocks/shared/version/htmldiff.js');
  const diff = htmlDiff(sanitizeContent(current, base), sanitizeContent(proposed, base));
  return `<!doctype html><html><head>
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
    <style>
      body { font: 16px/1.5 system-ui, sans-serif; color: #242424; padding: 16px; overflow-wrap: anywhere; }
      img { max-width: 100%; } table { border-collapse: collapse; width: 100%; }
      td, th { border: 1px solid #ccc; padding: 8px; }
      ins { background: #d7f4df; text-decoration: none; } del { background: #ffe0e0; }
      pre { white-space: pre-wrap; }
    </style></head><body>${diff}</body></html>`;
}
