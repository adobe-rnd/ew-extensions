const AEM_ORIGINS = ['hlx.page', 'hlx.live', 'aem.page', 'aem.live'];
const ADMIN_ORIGINS = new Set([
  'https://admin.da.live',
  'https://stage-admin.da.live',
  'https://admin.da.page',
  'http://localhost:8787',
]);
const TOKEN_ORIGINS = new Set([
  ...ADMIN_ORIGINS,
  'https://content.da.live',
  'https://stage-content.da.live',
  'https://api.aem.live',
  'https://admin.aem.live',
  'https://admin.hlx.page',
]);

export const BASIC_GROUPS = [
  {
    name: 'Heading',
    variants: Array.from({ length: 6 }, (_, index) => {
      const level = index + 1;
      return { name: `Heading ${level}`, html: `<h${level}>Heading</h${level}>` };
    }),
  },
  {
    name: 'List',
    variants: [
      { name: 'Unordered List', html: '<ul><li>List item</li></ul>' },
      { name: 'Ordered List', html: '<ol><li>List item</li></ol>' },
    ],
  },
];

export const PARAGRAPH_ELEMENT = { name: 'Paragraph', html: '<p>Paragraph</p>' };

export function resolveEditorOrigin(project, referrer = document.referrer) {
  if (project?.editorOrigin) {
    const origin = new URL(project.editorOrigin);
    if (origin.origin !== project.editorOrigin || !['http:', 'https:'].includes(origin.protocol)) {
      throw new Error('Invalid Experience Workspace editor origin.');
    }
    return origin.origin;
  }
  return referrer ? new URL(referrer).origin : null;
}

export function libraryFetch(token, adminOrigin, fetcher = fetch) {
  if (!token) throw new Error('Sign in to Experience Workspace before loading blocks.');
  if (!ADMIN_ORIGINS.has(adminOrigin)) throw new Error('Unsupported DA Admin origin.');
  return (url, options = {}) => {
    const { origin } = new URL(url, window.location.href);
    const headers = new Headers(options.headers);
    if (TOKEN_ORIGINS.has(origin)) headers.set('Authorization', `Bearer ${token}`);
    return fetcher(url, { ...options, headers });
  };
}

export function firstSheet(json) {
  if (Array.isArray(json)) return json;
  if (json?.[':type'] === 'multi-sheet') {
    const name = json[':names']?.[0]
      || Object.keys(json).find((key) => Array.isArray(json[key]?.data));
    return json[name]?.data || [];
  }
  return json?.data || [];
}

export function blockSources(configs, ref, org, site) {
  const rows = configs.filter(Boolean).reverse()
    .flatMap((config) => config.library?.data || []);
  const row = rows.find((entry) => entry.title?.trim().toLowerCase() === 'blocks'
    && (!entry.ref || entry.ref === 'main' || ref === 'local' || entry.ref === ref));
  if (!row) return [];
  if (!row.path?.trim()) throw new Error('The Blocks library has no source path.');
  return row.path.split(',').map((source) => {
    const path = source.trim();
    if (!path) throw new Error('The Blocks library has an empty source path.');
    if (!path.startsWith('/')) return path;
    return ref === 'local'
      ? `http://localhost:3000${path}`
      : `https://${ref}--${site}--${org}.aem.live${path}`;
  });
}

async function fetchJson(url, daFetch) {
  const response = await daFetch(url, { noRedirect: true });
  if (!response.ok) throw new Error(`Unable to load ${url} (HTTP ${response.status}).`);
  return response.json();
}

export async function loadBlocks({
  org, site, ref = 'main', daAdmin = 'https://admin.da.live', daFetch,
}) {
  const configs = await Promise.all([org, `${org}/${site}`].map(async (path) => {
    const response = await daFetch(`${daAdmin}/config/${path}`);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Unable to load library configuration (HTTP ${response.status}).`);
    return response.json();
  }));
  const sources = blockSources(configs, ref, org, site);
  const sheets = await Promise.all(sources.map((source) => fetchJson(source, daFetch)));
  return sheets.flatMap((sheet) => firstSheet(sheet)
    .filter((row) => row.name && row.path)
    .map((row) => ({ ...row, loadVariants: () => loadVariants(row.path, daFetch) })));
}

function isHeading(el) {
  return ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(el?.nodeName);
}

function blockTable(block) {
  const [name, ...variants] = block.className.split(' ');
  const rows = [...block.children];
  const maxCols = Math.max(1, ...rows.map((row) => row.children.length));
  const table = document.createElement('table');
  table.setAttribute('border', '1');
  const header = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = maxCols;
  cell.textContent = variants.length ? `${name} (${variants.join(', ')})` : name;
  header.append(cell);
  table.append(header);
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    [...row.children].forEach((col, i) => {
      const td = document.createElement('td');
      if (i === row.children.length - 1 && row.children.length < maxCols) {
        td.colSpan = maxCols - i;
      }
      td.innerHTML = col.innerHTML;
      tr.append(td);
    });
    table.append(tr);
  });
  return table;
}

function groupBlocks(doc) {
  const elements = [...doc.querySelectorAll('body > div, main > div')]
    .flatMap((section) => [...section.children]);
  const blocks = [];
  let group = null;
  elements.forEach((el) => {
    if (el.classList.contains('library-container-start')) {
      group = document.createElement('div');
      group.dataset.groupheading = isHeading(el.previousElementSibling)
        ? el.previousElementSibling.textContent : '';
    } else if (el.classList.contains('library-container-end') && group) {
      if (el.nextElementSibling?.classList.contains('library-metadata')) {
        group.append(el.nextElementSibling.cloneNode(true));
      }
      blocks.push(group);
      group = null;
    } else if (group) {
      group.append(el.cloneNode(true));
    } else if (el.nodeName === 'DIV' && !el.classList.contains('library-metadata')) {
      blocks.push(el);
    }
  });
  return blocks;
}

export function parseVariants(markup, path) {
  const doc = new DOMParser().parseFromString(markup, 'text/html');
  let origin;
  try {
    origin = new URL(path).origin;
  } catch {
    origin = window.location.origin;
  }
  doc.querySelectorAll('img[src^="./"]').forEach((img) => {
    img.src = new URL(img.getAttribute('src'), `${origin}/`).href;
  });
  return groupBlocks(doc).map((block) => {
    const heading = block.previousElementSibling?.classList.contains('library-metadata')
      ? block.previousElementSibling.previousElementSibling : block.previousElementSibling;
    const [name, ...classes] = block.className.split(' ');
    const item = {
      name: block.dataset.groupheading || (isHeading(heading) ? heading.textContent : name),
      variants: classes.length ? classes.join(', ') : undefined,
    };
    const metadata = [block.nextElementSibling, block.previousElementSibling,
      block.querySelector('.library-metadata')]
      .find((el) => el?.classList.contains('library-metadata'));
    if (metadata) {
      [...metadata.children].forEach((row) => {
        const key = row.children[0]?.textContent.trim().toLowerCase();
        const value = row.children[1]?.textContent.trim();
        if (key === 'name' && value) item.name = value;
        if (key === 'searchtags') item.tags = value;
        if (key === 'description') item.description = value;
      });
      metadata.remove();
    }
    if (block.dataset.groupheading !== undefined) {
      const container = document.createElement('div');
      [...block.children].forEach((child) => {
        container.append(child.tagName === 'DIV' ? blockTable(child) : child.cloneNode(true));
      });
      item.dom = container;
    } else {
      item.dom = blockTable(block);
    }
    return item;
  });
}

export async function loadVariants(path, daFetch) {
  const isAemHosted = AEM_ORIGINS.some((host) => {
    try {
      return new URL(path).hostname.endsWith(`.${host}`);
    } catch {
      return false;
    }
  });
  const url = `${path}${isAemHosted ? '.plain.html' : ''}`;
  const response = await daFetch(url, { noRedirect: true });
  if (!response.ok) throw new Error(`Unable to load block variants (HTTP ${response.status}).`);
  return parseVariants(await response.text(), path);
}

export function matches(query, block, variant) {
  const text = [block.name, variant?.name, variant?.variants, variant?.tags, variant?.description]
    .filter(Boolean).join(' ').toLowerCase();
  return query.toLowerCase().trim().split(/\s+/).every((term) => text.includes(term));
}

export function setHtmlDragData(dataTransfer, markup) {
  dataTransfer.setData('text/html', markup);
  dataTransfer.effectAllowed = 'copy';
}
