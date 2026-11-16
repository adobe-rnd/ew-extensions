const TEXT_ELEMENTS = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, pre';
const METADATA = '.metadata, .section-metadata, .da-metadata, .library-metadata';
const ALLOWED_ELEMENTS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE',
  'A', 'SPAN', 'STRONG', 'EM', 'B', 'I', 'U', 'S', 'DEL', 'SUB', 'SUP', 'CODE', 'BR', 'MARK',
]);
const TEXT_PROPERTIES = new Set([
  'color', 'background-color', 'font-family', 'font-size', 'font-weight', 'font-style',
  'line-height', 'letter-spacing', 'text-align', 'text-decoration', 'text-transform',
  'white-space',
]);

function copyTextElement(source) {
  const element = document.createElement(source.tagName.toLowerCase());
  ['class', 'title', 'lang', 'dir'].forEach((name) => {
    if (source.hasAttribute(name)) element.setAttribute(name, source.getAttribute(name));
  });
  if (source.matches('ol[start], li[value]')) {
    const name = source.tagName === 'OL' ? 'start' : 'value';
    if (/^-?\d+$/.test(source.getAttribute(name))) element.setAttribute(name, source.getAttribute(name));
  }
  if (source.tagName === 'A') {
    const href = source.getAttribute('href')?.trim();
    if (href) {
      try {
        const { protocol } = new URL(href, 'https://da.live');
        if (['https:', 'http:', 'mailto:', 'tel:'].includes(protocol)) element.setAttribute('href', href);
      } catch {
        // Invalid links remain plain text.
      }
    }
  }
  [...source.style].forEach((name) => {
    const value = source.style.getPropertyValue(name);
    if (TEXT_PROPERTIES.has(name) && !/url\s*\(|var\s*\(/i.test(value)) {
      element.style.setProperty(name, value);
    }
  });
  [...source.childNodes].forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) element.append(document.createTextNode(child.textContent));
    else if (child.nodeType === Node.ELEMENT_NODE && ALLOWED_ELEMENTS.has(child.tagName)) {
      element.append(copyTextElement(child));
    }
  });
  return element;
}

export function parseTextStyles(source) {
  const doc = new DOMParser().parseFromString(source, 'text/html');
  const content = doc.querySelector('main') || doc.body;
  return [...content.querySelectorAll(TEXT_ELEMENTS)]
    .filter((element) => !element.closest(METADATA)
      && !element.parentElement.closest(TEXT_ELEMENTS)
      && element.textContent.trim())
    .map((sourceElement) => {
      let element = copyTextElement(sourceElement);
      if (sourceElement.tagName === 'LI') {
        const list = copyTextElement(sourceElement.parentElement);
        list.replaceChildren(element);
        element = list;
      }
      return {
        label: sourceElement.tagName.toLowerCase(),
        text: element.textContent.trim(),
        html: element.outerHTML,
      };
    });
}

export async function loadTextStyles(sdk) {
  const org = sdk.context?.org || sdk.project?.org;
  const siteName = sdk.context?.site || sdk.context?.repo || sdk.project?.site || sdk.project?.repo;
  if (!org || !siteName) throw new Error('Open Text Library from a page in DA to select a site.');
  const url = `https://admin.da.live/source/${encodeURIComponent(org)}/${encodeURIComponent(siteName)}/docs/library/text-styles.html`;
  const response = await sdk.actions.daFetch(url, { cache: 'no-store' });
  if (response.status === 404) throw new Error('Create /docs/library/text-styles in this site, then refresh.');
  if (response.status === 401 || response.status === 403) {
    throw new Error('Access denied. Sign in to DA and check access to /docs/library/text-styles.');
  }
  if (!response.ok) throw new Error(`Unable to load text styles (${response.status}).`);
  return parseTextStyles(await response.text());
}

export function mountTextLibrary(root, sdk) {
  if (typeof sdk.actions?.makeDraggable !== 'function'
    || typeof sdk.actions?.daFetch !== 'function'
    || typeof sdk.actions?.sendHTML !== 'function') {
    throw new Error('This editor needs an updated DA SDK with drag-and-drop support.');
  }
  root.innerHTML = `
    <header><h1>Text Library</h1><button type="button">Refresh</button></header>
    <p class="instructions">Drag a style onto the page, or click it to insert at the cursor.</p>
    <p class="status" role="status" aria-live="polite"></p>
    <div class="styles" aria-label="Text styles"></div>`;
  const status = root.querySelector('.status');
  const styles = root.querySelector('.styles');
  const refresh = root.querySelector('button');
  let generation = 0;
  let disposers = [];
  const cleanup = () => {
    disposers.forEach((dispose) => dispose());
    disposers = [];
  };
  const report = (result) => {
    if (result?.ok === false) {
      if (result.error !== 'cancelled') status.textContent = `Unable to insert text (${result.error || 'unknown error'}).`;
    } else status.textContent = 'Text inserted.';
  };
  const insert = async (item) => {
    try {
      report(await sdk.actions.sendHTML(item.html));
    } catch (error) {
      status.textContent = `Unable to insert text: ${error.message}`;
    }
  };
  const reload = async () => {
    generation += 1;
    const current = generation;
    cleanup();
    styles.replaceChildren();
    refresh.disabled = true;
    root.setAttribute('aria-busy', 'true');
    status.textContent = 'Loading text styles...';
    try {
      const items = await loadTextStyles(sdk);
      if (current !== generation) return;
      const bindings = await Promise.allSettled(items.map(async (item) => {
        const card = document.createElement('article');
        card.className = 'style-card';
        const label = document.createElement('span');
        label.className = 'style-label';
        label.textContent = item.label;
        const preview = document.createElement('div');
        preview.className = 'style-preview';
        preview.setAttribute('role', 'button');
        preview.setAttribute('tabindex', '0');
        preview.setAttribute('aria-label', `Insert ${item.label}: ${item.text}`);
        preview.innerHTML = item.html;
        preview.addEventListener('click', (event) => {
          event.preventDefault();
          insert(item);
        });
        preview.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            insert(item);
          }
        });
        card.append(label, preview);
        styles.append(card);
        const dispose = await sdk.actions.makeDraggable({
          element: card,
          getData: () => ({ data: { 'text/html': item.html, 'text/plain': item.text } }),
          onResult: report,
        });
        if (current !== generation) dispose();
        else disposers.push(dispose);
      }));
      if (current === generation) {
        const failed = bindings.find((binding) => binding.status === 'rejected');
        if (failed) throw failed.reason;
        status.textContent = items.length ? `${items.length} text styles` : 'No text styles yet. Add text to /docs/library/text-styles, then refresh.';
      }
    } catch (error) {
      if (current === generation) {
        cleanup();
        styles.replaceChildren();
        status.textContent = error.message;
      }
    } finally {
      if (current === generation) {
        refresh.disabled = false;
        root.setAttribute('aria-busy', 'false');
      }
    }
  };
  refresh.addEventListener('click', reload);
  reload();
  return () => {
    generation += 1;
    cleanup();
    refresh.removeEventListener('click', reload);
    styles.replaceChildren();
  };
}
