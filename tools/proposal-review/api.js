const ADMIN = 'https://admin.da.live';

function safeSegments(path) {
  return typeof path === 'string' && !/[%\\?#\s]/.test(path)
    && ![...path].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    && path.split('/').every((part) => part && !part.startsWith('.'));
}

export class ProposalReview {
  constructor({ org, site, daFetch }) {
    if (!safeSegments(org) || org.includes('/') || !safeSegments(site) || site.includes('/')) {
      throw new Error('Open this extension in an Experience Workspace site.');
    }
    if (typeof daFetch !== 'function') throw new Error('Authenticated fetching is unavailable.');
    this.root = `/${org}/${site}/.da`;
    this.siteRoot = `/${org}/${site}`;
    this.fetch = daFetch;
    this.saved = new Map();
    this.busy = false;
  }

  original(path) {
    if (!path?.startsWith(`${this.root}/`) || !path.endsWith('.html')
      || !safeSegments(path.slice(this.root.length + 1))
      || path.split('/').pop() === '.html') {
      throw new Error('Choose a staged HTML page in the current site.');
    }
    return `${this.siteRoot}/${path.slice(this.root.length + 1)}`;
  }

  async list() {
    const folders = [this.root];
    const visited = new Set();
    const pages = new Set();
    while (folders.length) {
      const folder = folders.shift();
      if (visited.has(folder)) continue;
      visited.add(folder);
      let token;
      const tokens = new Set();
      do {
        // eslint-disable-next-line no-await-in-loop
        const response = await this.fetch(`${ADMIN}/list${folder}`, {
          cache: 'no-store',
          headers: token ? { 'da-continuation-token': token } : {},
        });
        if ([403, 404].includes(response.status)) break;
        if (!response.ok) throw new Error(`Could not list staged pages (${response.status}).`);
        // eslint-disable-next-line no-await-in-loop
        const items = await response.json();
        if (!Array.isArray(items)) throw new Error('Invalid staged page listing.');
        items.forEach((item) => {
          const { path, ext } = item;
          if (typeof path !== 'string' || !path.startsWith(`${folder}/`)) return;
          const child = path.slice(folder.length + 1);
          if (!safeSegments(child) || child.includes('/')) return;
          if (ext === 'html') {
            this.original(path);
            pages.add(path);
          } else if (!ext && !child.includes('.')) folders.push(path);
        });
        token = response.headers.get('da-continuation-token');
        if (token && tokens.has(token)) throw new Error('The staged page listing repeated a page token. Refresh to retry.');
        tokens.add(token);
      } while (token);
    }
    const candidates = [...pages];
    const readable = [];
    let next = 0;
    const worker = async () => {
      while (next < candidates.length) {
        const path = candidates[next];
        next += 1;
        // A readable directory can still contain files with more restrictive ACLs.
        // eslint-disable-next-line no-await-in-loop
        const response = await this.fetch(`${ADMIN}/source${path}`, { method: 'HEAD', cache: 'no-store' });
        if ([403, 404].includes(response.status)) continue;
        if (!response.ok) throw new Error(`Could not check access to ${path} (${response.status}).`);
        readable.push(path);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, worker));
    return readable.sort();
  }

  async read(path, { missing = false } = {}) {
    const response = await this.fetch(`${ADMIN}/source${path}`, { cache: 'no-store' });
    if (missing && response.status === 404) return null;
    if (!response.ok) throw new Error(`Could not read ${path} (${response.status}).`);
    return { body: await response.text(), etag: response.headers.get('etag') };
  }

  async compare(path) {
    const original = this.original(path);
    const [current, proposed] = await Promise.all([this.read(original), this.read(path)]);
    return { current: current.body, proposed: proposed.body, original };
  }

  async remove(path) {
    const response = await this.fetch(`${ADMIN}/source${path}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Could not discard ${path} (${response.status}).`);
    }
    // DA can acknowledge a delete whose underlying storage operation failed.
    if (await this.read(path, { missing: true })) {
      throw new Error(`Draft still exists at ${path}. Retry cleanup.`);
    }
    this.saved.delete(path);
  }

  async mutate(path, apply) {
    const original = this.original(path);
    if (this.busy) throw new Error('Another proposal action is in progress.');
    this.busy = true;
    try {
      if (!apply) {
        if (this.saved.has(path)) throw new Error('This page was already applied. Retry cleanup instead.');
        await this.remove(path);
        return;
      }
      const draft = await this.read(path, { missing: true });
      if (!draft) {
        this.saved.delete(path);
        return;
      }
      if (this.saved.has(path) && this.saved.get(path) !== draft.body) {
        this.saved.delete(path);
        throw new Error('The draft changed after applying. Review and apply the new draft; it has been retained.');
      }
      if (!this.saved.has(path)) {
        const current = await this.read(original);
        if (!current.etag) throw new Error('The original has no revision identifier. Cannot safely apply changes.');
        const body = new FormData();
        body.append('data', new Blob([draft.body], { type: 'text/html' }), 'proposal.html');
        const response = await this.fetch(`${ADMIN}/source${original}`, {
          method: 'PUT', headers: { 'If-Match': current.etag }, body,
        });
        if (!response.ok) {
          const reason = response.status === 412 ? 'The original changed. Review the diff again.'
            : `Could not save the original (${response.status}).`;
          throw new Error(`${reason} Draft retained.`);
        }
        this.saved.set(path, draft.body);
      }
      const latest = await this.read(path, { missing: true });
      if (latest && latest.body !== this.saved.get(path)) {
        this.saved.delete(path);
        throw new Error('The original was saved, but the draft changed during apply. The newer draft has been retained.');
      }
      try {
        if (latest) await this.remove(path);
        else this.saved.delete(path);
      } catch (error) {
        throw new Error(`Original saved. ${error.message} Apply again to retry cleanup without saving again.`);
      }
    } finally {
      this.busy = false;
    }
  }
}
