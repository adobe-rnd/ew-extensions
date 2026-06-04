import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { LitElement, html, nothing } from 'da-lit';

const API_BASE_URL = 'https://d31bkz463thsuv.cloudfront.net';
const DA_ADMIN = 'https://admin.da.live';
const DA_CANVAS = 'https://da.live/canvas';

class NerveCenterApp extends LitElement {
  static properties = {
    _token: { state: true },
    _siteId: { state: true },
    _apiKey: { state: true },
    _observations: { state: true },
    _loading: { state: true },
    _error: { state: true },
    _drafts: { state: true },
    _previewingId: { state: true },
  };

  constructor() {
    super();
    this._token = null;
    this._siteId = null;
    this._apiKey = null;
    this._observations = [];
    this._loading = false;
    this._error = null;
    this._drafts = {};
    this._previewingId = null;
    // Non-reactive — don't trigger re-renders
    this._actions = null;
    this._org = null;
    this._site = null;
    this._draftsStarted = false;
    this._previewedIds = new Set();
  }

  createRenderRoot() { return this; }

  connectedCallback() {
    super.connectedCallback();
    this._onAgentChange = (e) => {
      if (e.data?.action !== 'agentChange') return;
      const { detail } = e.data;
      if (detail?.scope !== 'file') return;
      const prefix = '/drafts/nerve-center/';
      for (const p of detail.paths ?? []) {
        const idx = p.indexOf(prefix);
        if (idx === -1) continue;
        const obsId = p.slice(idx + prefix.length).split('/')[0];
        if (obsId && this._observations.some((obs) => obs.id === obsId)) {
          this._fetchDrafts(obsId);
        }
      }
    };
    window.addEventListener('message', this._onAgentChange);
    this._init();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('message', this._onAgentChange);
  }

  async _init() {
    const params = new URLSearchParams(window.location.search);
    this._siteId = params.get('nerve-center-site-id');
    this._apiKey = params.get('nerve-center-key');

    if (this._siteId && this._apiKey) {
      this._fetchObservations();
    }

    try {
      const { token, actions, project } = await DA_SDK;
      this._token = token;
      this._actions = actions;
      this._org = project?.org;
      this._site = project?.repo;
      this._checkFetchDrafts();
    } catch {
      // SDK unavailable in standalone/dev
    }
  }

  async _fetchObservations() {
    this._loading = true;
    this._error = null;

    try {
      const resp = await fetch(`${API_BASE_URL}/api/sites/${this._siteId}/observations?pageSize=3`, {
        headers: { Authorization: `Bearer ${this._apiKey}` },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const { data } = await resp.json();
      this._observations = data.items?.slice(0, 3) ?? [];
      this._checkFetchDrafts();
    } catch (err) {
      this._error = err.message;
    } finally {
      this._loading = false;
    }
  }

  _checkFetchDrafts() {
    if (this._actions && this._org && this._site && this._observations.length > 0 && !this._draftsStarted) {
      this._draftsStarted = true;
      Promise.all(this._observations.map((obs) => this._fetchDrafts(obs.id)));
    }
  }

  async _fetchDrafts(obsId) {
    this._drafts = { ...this._drafts, [obsId]: { loading: true, items: [] } };
    try {
      const url = `${DA_ADMIN}/list/${this._org}/${this._site}/drafts/nerve-center/${obsId}`;
      const resp = await this._actions.daFetch(url);
      if (!resp.ok) {
        this._drafts = { ...this._drafts, [obsId]: { loading: false, items: [] } };
        return;
      }
      const payload = await resp.json();
      const items = Array.isArray(payload) ? payload.filter((i) => i.ext) : [];
      this._drafts = { ...this._drafts, [obsId]: { loading: false, items } };
    } catch {
      this._drafts = { ...this._drafts, [obsId]: { loading: false, items: [] } };
    }
  }

  _buildPrompt(obs) {
    const lines = [
      `Observation: ${obs.name}`,
      obs.description ? `Description: ${obs.description}` : null,
      obs.summary ? `Summary: ${obs.summary}` : null,
      obs.classification ? `Classification: ${obs.classification}` : null,
      Number.isFinite(obs.confidence) ? `Confidence: ${(obs.confidence * 100).toFixed(0)}%` : null,
      obs.recommendedAction ? `Recommended action: ${obs.recommendedAction}` : null,
      obs.recommendedActionRationale ? `Rationale: ${obs.recommendedActionRationale}` : null,
      obs.businessImpact ? `Business impact: ${obs.businessImpact}` : null,
    ].filter(Boolean);

    return [
      lines.join('\n'),
      '',
      'Based on this observation, generate three pages that can help drive traffic or conversions on our website.',
      `Create 3 different variations of content based on the observation at /drafts/nerve-center/${obs.id}/`,
    ].join('\n');
  }

  _buildPublishPrompt(obs, draftItems) {
    const variantList = draftItems
      .map((item, i) => `${i + 1}. ${item.name} (${item.path})`)
      .join('\n');

    return [
      `I have ${draftItems.length} content variant${draftItems.length > 1 ? 's' : ''} in drafts for the observation "${obs.name}":`,
      '',
      variantList,
      '',
      'Please ask me which variant I prefer, then:',
      '1. Move the chosen page out of the drafts folder to an appropriate location on the site',
      '2. Preview the page',
      `3. Ask me if I want to clean up the remaining draft pages under /drafts/nerve-center/${obs.id}/`,
    ].join('\n');
  }

  _renderWithLinks(text) {
    const parts = [];
    const re = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
    let last = 0;
    let match;
    while ((match = re.exec(text)) !== null) {
      if (match.index > last) parts.push(text.slice(last, match.index));
      parts.push(html`<a href=${match[2]} target="_blank" rel="noopener noreferrer">${match[1]}</a>`);
      last = match.index + match[0].length;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts;
  }

  _toast(message) {
    const el = document.createElement('div');
    el.className = 'nc-toast';
    el.textContent = message;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('nc-toast--visible'));
    setTimeout(() => {
      el.classList.remove('nc-toast--visible');
      el.addEventListener('transitionend', () => el.remove(), { once: true });
    }, 2500);
  }

  _canvasUrl(item) {
    // item.path is like /org/site/drafts/... — strip leading slash and extension
    const hash = item.ext
      ? item.path.slice(1, -(item.ext.length + 1))
      : item.path.replace(/^\//, '');
    return `${DA_CANVAS}#/${hash}`;
  }

  _renderDrafts(obsId) {
    const entry = this._drafts[obsId];
    if (!entry) return nothing;
    if (entry.loading) return html`<p class="drafts-loading">Loading drafts…</p>`;
    if (entry.items.length === 0) return nothing;

    return html`
      <div class="drafts">
        <p class="drafts-label">Draft pages</p>
        ${entry.items.map((item) => html`
          <a class="draft-link" href=${this._canvasUrl(item)} target="_blank">${item.name}</a>
        `)}
        <sl-button class="ew-outline-accent nc-preview-btn"
          ?loading=${this._previewingId === obsId}
          ?disabled=${this._previewingId !== null}
          @click=${async () => {
          this._previewingId = obsId;
          try {
            if (!this._previewedIds.has(obsId)) {
              const prefix = `/${this._org}/${this._site}`;
              await Promise.all(entry.items.map((item) => {
                const path = item.path.startsWith(prefix) ? item.path.slice(prefix.length) : item.path;
                const withoutExt = item.ext ? path.slice(0, -(item.ext.length + 1)) : path;
                return this._actions.daFetch(
                  `https://admin.hlx.page/preview/${this._org}/${this._site}/main${withoutExt}`,
                  { method: 'POST' },
                );
              }));
              this._previewedIds.add(obsId);
            }
            const payload = { items: entry.items, org: this._org, site: this._site };
            localStorage.setItem('da-drafts-preview', JSON.stringify(payload));
            const bc = new BroadcastChannel('da-drafts-preview');
            bc.postMessage(payload);
            bc.close();
            this._actions?.showPanel?.('drafts-preview');
          } finally {
            this._previewingId = null;
          }
        }}>Preview drafts</sl-button>
      </div>`;
  }


  _renderButton(obs) {
    const drafts = this._drafts[obs.id];
    const hasDrafts = drafts && !drafts.loading && drafts.items.length > 0;
    const label = hasDrafts ? 'Start Publish Workflow' : 'Generate content from observation';
    const prompt = hasDrafts
      ? this._buildPublishPrompt(obs, drafts.items)
      : this._buildPrompt(obs);

    return html`
      <sl-button class="ew-fill-accent obs-chat-btn" @click=${() => {
        if (this._actions?.setPrompt) {
          this._actions.setPrompt(prompt, { autoSend: true });
        } else {
          navigator.clipboard?.writeText(prompt).then(() => this._toast('Prompt copied to clipboard'));
        }
      }}>${label}</sl-button>`;
  }

  _renderContent() {
    if (!this._siteId || !this._apiKey) {
      return html`
        <div class="card error">
          <p class="card-title">Configuration Error</p>
          <p>Missing required query parameters:</p>
          <ul>
            ${!this._siteId ? html`<li><code>nerve-center-site-id</code></li>` : nothing}
            ${!this._apiKey ? html`<li><code>nerve-center-key</code></li>` : nothing}
          </ul>
        </div>`;
    }

    if (this._loading) {
      return html`
        <div class="card">
          <sl-skeleton effect="pulse" style="height:56px;margin-bottom:12px;"></sl-skeleton>
          <sl-skeleton effect="pulse" style="height:56px;margin-bottom:12px;"></sl-skeleton>
          <sl-skeleton effect="pulse" style="height:56px;"></sl-skeleton>
        </div>`;
    }

    if (this._error) {
      return html`
        <div class="card error">
          <p>Failed to load observations: ${this._error}</p>
          <sl-button class="ew-fill-accent" @click=${() => this._fetchObservations()}>Retry</sl-button>
        </div>`;
    }

    if (this._observations.length === 0) {
      return html`<div class="card"><p>No observations found for this site.</p></div>`;
    }

    return html`
      <div class="card">
        ${this._observations.map((obs) => html`
          <div class="observation-item">
            <p class="obs-name">${obs.name}</p>
            ${obs.description ? html`<p class="obs-description">${this._renderWithLinks(obs.description)}</p>` : nothing}
            <div class="obs-meta">
              <span class="badge">${obs.status}</span>
              ${obs.classification ? html`<span class="badge">${obs.classification}</span>` : nothing}
              ${Number.isFinite(obs.confidence) ? html`<span class="badge confidence">${(obs.confidence * 100).toFixed(0)}% confidence</span>` : nothing}
            </div>
            ${this._renderDrafts(obs.id)}
            ${this._renderButton(obs)}
          </div>
        `)}
      </div>`;
  }

  render() {
    return html`
      <p class="app-title">Nerve Center</p>
      ${this._renderContent()}
    `;
  }
}

customElements.define('nerve-center-app', NerveCenterApp);
