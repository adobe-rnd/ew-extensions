import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { LitElement, html, nothing } from 'da-lit';
import { parseAssetPage } from './assets.js';
import {
  BASIC_GROUPS, PARAGRAPH_ELEMENT, libraryFetch, loadBlocks, matches,
  resolveEditorOrigin, setHtmlDragData,
} from './library.js';

class QuickBlocks extends LitElement {
  static properties = {
    _blocks: { state: true },
    _variants: { state: true },
    _expanded: { state: true },
    _search: { state: true },
    _error: { state: true },
    _ready: { state: true },
    _loadingVariants: { state: true },
    _tab: { state: true },
    _assetLoading: { state: true },
    _assetError: { state: true },
    _assets: { state: true },
    _assetHasMore: { state: true },
  };

  constructor() {
    super();
    this._blocks = [];
    this._variants = new Map();
    this._expanded = null;
    this._search = '';
    this._error = '';
    this._ready = false;
    this._loadingVariants = false;
    this._tab = 'blocks';
    this._assetLoading = false;
    this._assetError = '';
    this._assets = [];
    this._assetHasMore = false;
    this._assetsRequested = false;
    this._assetMorePending = false;
    this._assetRetry = false;
    this._assetDragError = false;
    this._assetObjectUrls = new Set();
    this._publishDragHandles = () => {
      if (!this._editorOrigin) return;
      const handles = [...this.querySelectorAll(
        '.quick-blocks-content:not([hidden]) .quick-add, .quick-assets-content:not([hidden]) .quick-asset-card',
      )].map((button) => {
        const rect = button.getBoundingClientRect();
        return {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
          ...(button.classList.contains('quick-asset-card')
            ? { assetId: button.assetId, clickable: false }
            : { html: button.dropHtml }),
        };
      });
      window.parent.postMessage({
        type: 'ew-table-drag-handles',
        handles,
      }, this._editorOrigin);
    };
  }

  createRenderRoot() { return this; }

  connectedCallback() {
    super.connectedCallback();
    this._onHandleMessage = (event) => {
      if (event.source !== window.parent || event.origin !== this._editorOrigin) return;
      const { type, index } = event.data || {};
      if (type === 'ew-table-drag-handle-click' && Number.isSafeInteger(index)) {
        const button = this.querySelectorAll(
          '.quick-blocks-content:not([hidden]) .quick-add, .quick-assets-content:not([hidden]) .quick-asset-card',
        )[index];
        button?.click();
      } else if (type === 'ew-table-drag-handle-wheel'
        && Number.isFinite(event.data?.deltaY)) {
        window.scrollBy(0, event.data.deltaY);
      } else if (type === 'ew-asset-list-result') {
        this._assetLoading = false;
        try {
          const page = parseAssetPage(event.data);
          page.assets.forEach((asset) => {
            if (asset.thumbnailUrl) this._assetObjectUrls.add(asset.thumbnailUrl);
          });
          this._assets = this._assetMorePending
            ? [...this._assets, ...page.assets] : page.assets;
          this._assetHasMore = page.hasMore;
          this._assetError = '';
          this._assetDragError = false;
        } catch (error) {
          this._assetError = error.message;
          this._assetRetry = true;
        }
      } else if (type === 'ew-asset-list-error') {
        this._assetLoading = false;
        this._assetError = event.data.error || 'Could not load AEM Assets.';
        this._assetRetry = true;
        this._assetDragError = false;
      } else if (type === 'ew-asset-drag-error') {
        this._assetError = event.data.error || 'Could not prepare the image for dragging.';
        this._assetRetry = false;
        this._assetDragError = true;
      } else if (type === 'ew-asset-drag-ready' && this._assetDragError) {
        this._assetError = '';
        this._assetDragError = false;
      }
    };
    window.addEventListener('message', this._onHandleMessage);
    window.addEventListener('resize', this._publishDragHandles);
    window.addEventListener('scroll', this._publishDragHandles, true);
    this._init();
  }

  disconnectedCallback() {
    window.removeEventListener('message', this._onHandleMessage);
    window.removeEventListener('resize', this._publishDragHandles);
    window.removeEventListener('scroll', this._publishDragHandles, true);
    this._assetObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    this._assetObjectUrls.clear();
    this._assets = [];
    this._assetsRequested = false;
    super.disconnectedCallback();
  }

  updated(changed) {
    super.updated(changed);
    this._publishDragHandles();
  }

  async _init() {
    try {
      const { project, actions, token } = await DA_SDK;
      this._actions = actions;
      this._token = token;
      if (!project?.org || !project?.repo) {
        throw new Error('Open a site in Experience Workspace to use Quick Blocks.');
      }
      this._project = project;
      this._editorOrigin = resolveEditorOrigin(project);
      this._daFetch = libraryFetch(token, project.daAdmin);
      if (this._tab === 'assets') this._selectTab('assets');
      await this._load();
    } catch (error) {
      this._error = error.message;
      if (this._tab === 'assets') this._assetError = error.message;
    }
  }

  async _load() {
    this._error = '';
    this._ready = false;
    try {
      this._blocks = await loadBlocks({
        org: this._project.org,
        site: this._project.repo,
        ref: this._project.ref,
        daAdmin: this._project.daAdmin,
        daFetch: this._daFetch,
      });
      this._variants = new Map();
      if (!BASIC_GROUPS.includes(this._expanded)) this._expanded = null;
      this._ready = true;
      this._loadingVariants = true;
      const errors = await Promise.all(this._blocks.map((block) => this._ensureVariants(block)));
      this._loadingVariants = false;
      this._error = errors.find(Boolean) || '';
    } catch (error) {
      this._loadingVariants = false;
      this._error = error.message;
    }
  }

  async _ensureVariants(block) {
    if (this._variants.has(block)) return null;
    try {
      const variants = await block.loadVariants();
      this._variants = new Map(this._variants).set(block, variants);
    } catch (error) {
      this._variants = new Map(this._variants).set(block, []);
      return error.message;
    }
    return null;
  }

  _toggle(block) {
    this._expanded = this._expanded === block ? null : block;
  }

  _selectTab(tab) {
    this._tab = tab;
    if (tab !== 'assets' || this._assetsRequested || this._assetLoading) return;
    this._requestAssets();
  }

  _requestAssets(more = false) {
    if (this._assetLoading) return;
    this._assetError = '';
    this._assetRetry = false;
    this._assetDragError = false;
    if (!this._actions) return;
    if (!this._editorOrigin) {
      this._assetError = 'The editor origin is unavailable.';
      return;
    }
    this._assetsRequested = true;
    this._assetMorePending = more;
    this._assetLoading = true;
    window.parent.postMessage(
      { type: 'ew-asset-list-request', more },
      this._editorOrigin,
    );
  }

  _add(markup) {
    if (!this._actions?.sendHTML) {
      this._error = 'The editor is not connected.';
      return;
    }
    this._actions.sendHTML(markup);
  }

  _dragStart(event, markup) {
    setHtmlDragData(event.dataTransfer, markup);
    if (!this._editorOrigin) {
      this._error = 'The editor origin is unavailable; drag into the page is disabled.';
      event.preventDefault();
      return;
    }
    window.parent.postMessage({
      type: 'ew-table-drag-start',
      html: markup,
    }, this._editorOrigin);
  }

  _dragEnd() {
    if (this._editorOrigin) {
      window.parent.postMessage({ type: 'ew-table-drag-end' }, this._editorOrigin);
    }
  }

  _visibleBlocks() {
    if (!this._search.trim()) return this._blocks;
    return this._blocks.filter((block) => matches(this._search, block)
      || (this._variants.get(block) || []).some((variant) => matches(this._search, block, variant)));
  }

  _renderAdd(item, markup) {
    return html`<button type="button" class="quick-add" draggable="true"
      .dropHtml=${markup}
      aria-label="Add ${item.name} to page"
      title=${item.description || `Drag or click to add ${item.name}`}
      @click=${() => this._add(markup)}
      @dragstart=${(event) => this._dragStart(event, markup)}
      @dragend=${() => this._dragEnd()}>
      <span><strong>${item.name}</strong>
        ${item.variants ? html`<small>${item.variants}</small>` : nothing}
      </span><span class="quick-add-icon" aria-hidden="true">+</span>
    </button>`;
  }

  _renderAsset(item) {
    return html`<li><div class="quick-asset-card"
      .assetId=${item.asset['repo:id'] || item.asset.path}
      title=${`Drag ${item.name} into the page`}
      >
      ${item.thumbnailUrl
    ? html`<img src=${item.thumbnailUrl} alt="" loading="lazy" draggable="false">`
    : html`<span class="quick-asset-placeholder" aria-hidden="true">▧</span>`}
      <span class="quick-asset-name">${item.name}</span>
    </div></li>`;
  }

  render() {
    const filtered = this._visibleBlocks();
    return html`
      <header class="quick-header">
        <h1>Quick Blocks</h1>
        <p>${this._tab === 'blocks'
    ? 'Click to add at the cursor, or drag into the page.'
    : 'Drag an image into the page.'}</p>
      </header>
      <nav class="quick-tabs" role="tablist" aria-label="Quick Blocks tools">
        <button type="button" id="quick-blocks-tab" role="tab"
          aria-controls="quick-blocks-panel" aria-selected=${this._tab === 'blocks'}
          @click=${() => this._selectTab('blocks')}>Blocks</button>
        <button type="button" id="quick-assets-tab" role="tab"
          aria-controls="quick-assets-panel" aria-selected=${this._tab === 'assets'}
          @click=${() => this._selectTab('assets')}>Assets</button>
      </nav>
      <section class="quick-blocks-content" id="quick-blocks-panel" role="tabpanel"
        aria-labelledby="quick-blocks-tab" ?hidden=${this._tab !== 'blocks'}>
      <section class="quick-elements" aria-label="Text elements">
        <h2>Text</h2>
        <ul class="quick-list">
          ${BASIC_GROUPS.map((group) => {
    const expanded = this._expanded === group;
    return html`<li class="quick-group">
              <button type="button" class="quick-group-button" aria-expanded=${expanded}
                @click=${() => this._toggle(group)}>
                <span class="quick-chevron" aria-hidden="true"></span>${group.name}
              </button>
              ${expanded ? html`<ul class="quick-variants">
                ${group.variants.map((item) => html`<li>${this._renderAdd(item, item.html)}</li>`)}
              </ul>` : nothing}
            </li>`;
  })}
          <li class="quick-group">${this._renderAdd(PARAGRAPH_ELEMENT, PARAGRAPH_ELEMENT.html)}</li>
        </ul>
      </section>
      <section class="quick-library" aria-label="Blocks library">
      <h2>Blocks</h2>
      <label class="quick-search">
        <span class="sr-only">Search blocks</span>
        <input class="nx-input" type="search" placeholder="Search blocks" .value=${this._search}
          @input=${(event) => { this._search = event.target.value; }}>
      </label>
      ${this._error ? html`<div class="quick-error" role="alert">
        ${this._error}
        ${this._project ? html`<button type="button" class="nx-action-btn nx-btn-sm"
          @click=${() => this._load()}>Retry</button>` : nothing}
      </div>` : nothing}
      ${!this._ready && !this._error ? html`<p class="quick-state">Loading blocks…</p>` : nothing}
      ${this._ready && !this._blocks.length && !this._error
    ? html`<p class="quick-state">No Blocks library is configured for this site.</p>` : nothing}
      ${this._ready && this._blocks.length && !filtered.length
    ? html`<p class="quick-state">${this._loadingVariants ? 'Searching variants…' : 'No matching blocks.'}</p>` : nothing}
      ${this._ready ? html`<ul class="quick-list">
        ${filtered.map((block) => {
    const variants = this._variants.get(block);
    const expanded = this._search.trim() || this._expanded === block;
    const matching = this._search.trim() && !matches(this._search, block)
      ? (variants || []).filter((variant) => matches(this._search, block, variant))
      : variants;
    return html`<li class="quick-group">
            <button type="button" class="quick-group-button" aria-expanded=${!!expanded}
              @click=${() => this._toggle(block)}>
              <span class="quick-chevron" aria-hidden="true"></span>${block.name}
            </button>
            ${expanded ? html`<ul class="quick-variants">
              ${matching === undefined ? html`<li class="quick-state">Loading variants…</li>` : nothing}
              ${matching?.length === 0 ? html`<li class="quick-state">No variants found.</li>` : nothing}
              ${matching?.map((variant) => html`<li>
                ${this._renderAdd(variant, variant.dom.outerHTML)}
              </li>`)}
            </ul>` : nothing}
          </li>`;
  })}
      </ul>` : nothing}
      </section>
      </section>
      <section class="quick-assets-content" id="quick-assets-panel" role="tabpanel"
        aria-labelledby="quick-assets-tab" ?hidden=${this._tab !== 'assets'}>
        ${this._assetError ? html`<div class="quick-error" role="alert">${this._assetError}</div>` : nothing}
        ${this._assets.length ? html`<ul class="quick-asset-grid">
          ${this._assets.map((asset) => this._renderAsset(asset))}
        </ul>` : nothing}
        ${this._assetLoading ? html`<p class="quick-state">Loading images…</p>` : nothing}
        ${!this._assetLoading && !this._assetError && this._assetsRequested && !this._assets.length
    ? html`<p class="quick-state">${this._assetHasMore
    ? 'No images in this batch. Load more to continue.'
    : 'No images found in this repository.'}</p>` : nothing}
        ${this._assetRetry ? html`<button type="button" class="nx-action-btn nx-btn-sm quick-asset-more"
          @click=${() => this._requestAssets(this._assetMorePending)}>Retry</button>` : nothing}
        ${this._assetHasMore && !this._assetLoading && !this._assetError
    ? html`<button type="button" class="nx-action-btn quick-asset-more"
      @click=${() => this._requestAssets(true)}>Load more images</button>` : nothing}
      </section>`;
  }
}

customElements.define('ew-quick-blocks', QuickBlocks);
