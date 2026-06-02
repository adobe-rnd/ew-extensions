import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { LitElement, html, nothing } from 'da-lit';

const API_BASE_URL = 'https://d31bkz463thsuv.cloudfront.net';

class NerveCenterApp extends LitElement {
  static properties = {
    _token: { state: true },
    _siteId: { state: true },
    _apiKey: { state: true },
    _observations: { state: true },
    _loading: { state: true },
    _error: { state: true },
  };

  constructor() {
    super();
    this._token = null;
    this._siteId = null;
    this._apiKey = null;
    this._observations = [];
    this._loading = false;
    this._error = null;
  }

  createRenderRoot() { return this; }

  connectedCallback() {
    super.connectedCallback();
    this._init();
  }

  async _init() {
    const params = new URLSearchParams(window.location.search);
    this._siteId = params.get('nerve-center-site-id');
    this._apiKey = params.get('nerve-center-key');

    if (this._siteId && this._apiKey) {
      this._fetchObservations();
    }

    try {
      const { token } = await DA_SDK;
      this._token = token;
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
    } catch (err) {
      this._error = err.message;
    } finally {
      this._loading = false;
    }
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
            ${obs.description ? html`<p class="obs-description">${obs.description}</p>` : nothing}
            <div class="obs-meta">
              <span class="badge">${obs.status}</span>
              ${obs.classification ? html`<span class="badge">${obs.classification}</span>` : nothing}
              ${obs.confidence != null ? html`<span class="badge confidence">${(obs.confidence * 100).toFixed(0)}% confidence</span>` : nothing}
            </div>
            <sl-button class="ew-fill-accent obs-chat-btn">Chat about this</sl-button>
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
