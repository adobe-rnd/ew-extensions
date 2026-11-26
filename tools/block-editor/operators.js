import { normalizeBlockName } from './fields.js';

const modules = new Map();

const COMMIT_ERRORS = {
  READ_ONLY: 'NOT_EDITABLE',
  STALE_LIVE: 'STALE',
  WRONG_SELECTION: 'STALE',
  WRONG_DOCUMENT: 'STALE',
};
export const toCommitError = (code) => COMMIT_ERRORS[code] ?? code ?? 'COMMIT_FAILED';

/**
 * Origin that site-relative operator paths resolve against. The page's own origin when it
 * belongs to the site (preview.da.live, aem.page, aem.live, …): a same-origin import needs no
 * CORS. Otherwise preview.da.live, which sends CORS headers (aem.live and aem.page don't).
 */
export function operatorBase({ org, site } = {}, location = window.location) {
  const own = `--${site}--${org}.`.toLowerCase();
  if (location?.origin && location.hostname?.toLowerCase().includes(own)) return location.origin;
  return `https://main--${site}--${org}.preview.da.live`;
}

/** Maps normalized block names to operator module URLs from the block library `editor` rows. */
export function getOperatorRegistry(rows, { org, site } = {}, location = window.location) {
  const registry = new Map();
  (rows || []).forEach((row) => {
    if (row?.property?.toLowerCase().trim() !== 'operator') return;
    const name = normalizeBlockName(row.block);
    const value = String(row.value ?? '').trim();
    if (!name || !value || registry.has(name)) return;
    if (value.startsWith('/') && (!org || !site)) return;
    try {
      const url = value.startsWith('/') ? new URL(value, operatorBase({ org, site }, location)) : new URL(value);
      if (['https:', 'http:'].includes(url.protocol)) registry.set(name, url.href);
    } catch { /* invalid operator URL */ }
  });
  return registry;
}

export function loadOperator(url, importer = (href) => import(href)) {
  if (!modules.has(url)) {
    modules.set(url, Promise.resolve().then(() => importer(url)).then((module) => {
      const operator = module?.default;
      if (typeof operator?.create !== 'function') throw new Error(`${url} does not export a block operator.`);
      return operator;
    }).catch((error) => { modules.delete(url); throw error; }));
  }
  return modules.get(url);
}
export const resetOperatorCache = () => modules.clear();

export function isBlockHtml(html, name) {
  if (typeof html !== 'string') return false;
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  const nodes = [...template.content.childNodes]
    .filter((node) => node.nodeType !== Node.TEXT_NODE || node.textContent.trim());
  const [element] = nodes;
  return nodes.length === 1 && element.tagName === 'DIV'
    && normalizeBlockName(element.classList[0]) === normalizeBlockName(name);
}

const fail = (error, message) => ({ ok: false, error, message });

/**
 * Hosts the `inspector` contract of block operators for the selected block.
 * `sync` receives the selected block, or null; `onChange` fires when the mounted state changes.
 * `connect({ scope, onSelect })` optionally shares the selected item with other surfaces and
 * returns `{ publish(message), requestSelection() }`; without it, `ctx.select` stays local.
 */
export class OperatorInspector {
  constructor({
    styles = [], commit, onChange, importer, scope = () => null, connect = () => null,
  } = {}) {
    this.styles = styles;
    this.hostCommit = commit;
    this.onChange = onChange;
    this.importer = importer;
    this.scope = scope;
    this.container = document.createElement('div');
    this.container.className = 'ew-block-operator';
    this.active = null;
    this.pending = null;
    this.failed = new Set();
    this.selection = null;
    this.connection = connect({
      scope: () => this.scope(),
      onSelect: (message) => {
        this.selection = message;
        if (this.active?.instance) this.notifySelection(this.active);
      },
    });
    this.connection?.requestSelection();
  }

  get mounted() { return !!this.active?.mount; }

  async sync(block) {
    const failKey = block && `${block.key}|${block.url}`;
    if (!block?.url || this.failed.has(failKey)) {
      this.teardown();
      return;
    }
    if (this.active?.key === block.key && this.active.url === block.url) {
      this.update(block);
      return;
    }
    if (this.pending?.key === block.key && this.pending.url === block.url) {
      this.pending.block = block;
      return;
    }
    this.teardown();
    const pending = { key: block.key, url: block.url, block };
    this.pending = pending;
    let operator;
    try {
      operator = await loadOperator(block.url, this.importer);
    } catch (error) {
      if (this.pending === pending) this.fail(pending, error);
      return;
    }
    if (this.pending !== pending) return;
    this.pending = null;
    this.create(operator, pending);
  }

  create(operator, { key, url, block }) {
    const state = {
      key, url, block, instance: null, mount: null, listeners: new Set(), itemId: undefined,
    };
    this.active = state;
    try {
      if (typeof operator.matches === 'function'
        && !operator.matches({ name: block.name, variant: block.variant })) return;
      state.instance = operator.create(this.context(state));
      if (typeof state.instance?.inspector?.mount !== 'function') {
        state.instance?.destroy?.();
        state.instance = null;
        return;
      }
      state.mount = state.instance.inspector.mount(this.container) || {};
      this.onChange?.();
      this.notifySelection(state);
    } catch (error) {
      this.fail(state, error);
    }
  }

  context(state) {
    const { block } = state;
    return {
      name: block.name,
      variant: block.variant,
      blockIndex: block.blockIndex,
      html: block.html,
      editable: block.editable,
      styles: this.styles,
      surface: 'inspector',
      commit: (html) => this.commit(state, html),
      select: (itemId) => this.select(state, itemId),
      onEditorSelect: (callback) => {
        if (typeof callback !== 'function') throw new TypeError('callback must be a function');
        state.listeners.add(callback);
        return () => state.listeners.delete(callback);
      },
    };
  }

  update(block) {
    const state = this.active;
    const previous = state.block;
    state.block = block;
    if (!state.instance) return;
    try {
      if (previous.html !== block.html || previous.editable !== block.editable) {
        state.instance.update?.(this.context(state));
      }
      this.notifySelection(state);
    } catch (error) {
      this.fail(state, error);
    }
  }

  /**
   * The shared selection's item when it targets this block (same index, or an item it has);
   * null when it clears this block's selection, undefined when it is about another block.
   */
  selectedItem(state) {
    const message = this.selection;
    if (!message || normalizeBlockName(message.block) !== normalizeBlockName(state.block.name)) {
      return undefined;
    }
    if (message.itemId == null) return message.blockIndex === state.block.blockIndex ? null : undefined;
    if (message.blockIndex === state.block.blockIndex) return message.itemId;
    return state.instance.locate?.(message.itemId) ? message.itemId : undefined;
  }

  notifySelection(state) {
    if (!this.selection) return;
    let itemId;
    try {
      itemId = this.selectedItem(state);
    } catch (error) {
      this.fail(state, error);
      return;
    }
    if (itemId === undefined || itemId === state.itemId) return;
    state.itemId = itemId;
    state.listeners.forEach((callback) => {
      try {
        callback(itemId);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Block operator selection listener failed:', error);
      }
    });
  }

  async commit(state, html) {
    if (this.active !== state) return fail('STALE', 'The block operator is no longer active.');
    if (!state.block.editable) return fail('NOT_EDITABLE', 'The editor is read-only.');
    if (!isBlockHtml(html, state.block.name)) {
      return fail('INVALID_HTML', `The HTML must be exactly one ${state.block.name} block.`);
    }
    if (typeof this.hostCommit !== 'function') return fail('NO_EDITOR', 'No editor is connected.');
    try {
      const result = await this.hostCommit({
        blockIndex: state.block.blockIndex, html, blockHtml: state.block.html,
      });
      return result?.ok === true ? { ok: true } : fail(toCommitError(result?.error), result?.message || 'Unable to replace the block.');
    } catch (error) {
      return fail(toCommitError(error.code), error.message);
    }
  }

  /** A selection made in the inspector: share it through the `connect` hook, if any. */
  select(state, itemId) {
    if (this.active !== state || !state.instance) return fail('STALE', 'The block operator is no longer active.');
    let found;
    try {
      found = itemId == null || state.instance.locate?.(itemId);
    } catch (error) {
      this.fail(state, error);
      return fail('OPERATOR_FAILED', error.message);
    }
    if (!found) return fail('NOT_FOUND', `Unable to locate ${itemId}.`);
    state.itemId = itemId ?? null;
    const message = {
      blockIndex: state.block.blockIndex,
      block: state.block.name,
      itemId: itemId ?? null,
      source: 'inspector',
    };
    this.selection = { type: 'block-operator-select', ...this.scope(), ...message };
    this.connection?.publish(message);
    return { ok: true };
  }

  fail(state, error) {
    this.failed.add(`${state.key}|${state.url}`);
    // eslint-disable-next-line no-console
    console.warn(`Block operator ${state.url} failed; using the default inspector.`, error);
    if (this.pending === state) this.pending = null;
    if (this.active === state) this.teardown();
  }

  teardown() {
    this.pending = null;
    const state = this.active;
    if (!state) return;
    this.active = null;
    try { state.mount?.unmount?.(); } catch { /* operator cleanup failed */ }
    try { state.instance?.destroy?.(); } catch { /* operator cleanup failed */ }
    this.container.replaceChildren();
    if (state.mount) this.onChange?.();
  }
}
