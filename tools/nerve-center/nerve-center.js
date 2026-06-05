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
    _completed: { state: true },
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
    this._completed = new Set();
    // Non-reactive — don't trigger re-renders
    this._actions = null;
    this._org = null;
    this._site = null;
    this._draftsStarted = false;
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

    const completedParam = params.get('nerve-center-completed');
    if (completedParam) {
      this._completed = new Set(completedParam.split(',').map((id) => id.trim()).filter(Boolean));
    } else {
      try {
        const stored = localStorage.getItem('nc-completed');
        if (stored) this._completed = new Set(JSON.parse(stored));
      } catch { /* ignore */ }
    }

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

  _toggleComplete(obsId) {
    const next = new Set(this._completed);
    if (next.has(obsId)) next.delete(obsId);
    else next.add(obsId);
    this._completed = next;
    try { localStorage.setItem('nc-completed', JSON.stringify([...next])); } catch { /* ignore */ }
  }

  _canvasUrl(item) {
    // item.path is like /org/site/drafts/... — strip leading slash and extension
    const hash = item.ext
      ? item.path.slice(1, -(item.ext.length + 1))
      : item.path.replace(/^\//, '');
    return `${DA_CANVAS}#/${hash}`;
  }

  _draftName(item) {
    const seg = item.path.split('/').pop() ?? '';
    const base = item.ext ? seg.slice(0, -(item.ext.length + 1)) : seg;
    return base.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  _assignedRole(item) {
    const roles = ['Technical Writer', 'Editor', 'Product Marketing', 'Brand Marketing'];
    const hash = item.path.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return roles[hash % roles.length];
  }

  _renderDrafts(obsId) {
    const entry = this._drafts[obsId];
    if (!entry) return nothing;
    if (entry.loading) return html`<p class="drafts-loading">Loading drafts…</p>`;
    if (entry.items.length === 0) return nothing;

    return html`
      <div class="drafts">
        <table class="drafts-table">
          <thead>
            <tr>
              <th>Draft Page</th>
              <th>Assign to</th>
            </tr>
          </thead>
          <tbody>
            ${entry.items.map((item) => html`
              <tr>
                <td>
                  <a class="draft-link" href=${this._canvasUrl(item)} target="_blank">
                    ${this._draftName(item)}
                  </a>
                </td>
                <td>
                  <span class="draft-role">${this._assignedRole(item)}</span>
                </td>
              </tr>
            `)}
          </tbody>
        </table>
        <sl-button class="ew-outline-accent nc-preview-btn" @click=${() => {
        window.parent.postMessage({ type: 'nx-show-draft-preview', obsId, items: entry.items, org: this._org, site: this._site }, '*');
      }}>Compare drafts</sl-button>
      </div>`;
  }


  _renderButton(obs) {
    if (obs.status?.toLowerCase() === 'draft') return nothing;
    const drafts = this._drafts[obs.id];
    const hasDrafts = drafts && !drafts.loading && drafts.items.length > 0;
    const label = hasDrafts ? 'Start Publish Workflow' : 'Generate content from observation';
    const prompt = hasDrafts
      ? this._buildPublishPrompt(obs, drafts.items)
      : this._buildPrompt(obs);

    return html`
      <sl-button class="ew-fill-accent obs-chat-btn" @click=${() => {
        window.parent.postMessage({ type: 'nx-open-chat' }, '*');
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

    const pending = this._observations.filter((obs) => !this._completed.has(obs.id));
    const done = this._observations.filter((obs) => this._completed.has(obs.id));

    return html`
      ${pending.map((obs) => html`
        <div class="card observation-item">
          <div class="obs-meta">
            <span class="badge badge--${obs.status?.toLowerCase()}">${obs.status}</span>
            ${obs.priority ? html`<span class="badge badge--priority--${obs.priority?.toLowerCase()}">${obs.priority}</span>` : nothing}
            ${obs.classification ? html`<span class="badge">${obs.classification}</span>` : nothing}
          </div>

          <div class="obs-header">
            <p class="obs-name">${obs.name}</p>
            <div class="obs-header-actions">
              <button class="obs-complete-btn" aria-label="Details"
                @click=${() => window.parent.postMessage({ type: 'nx-show-obs-details', obs }, '*')}>Learn more</button>
            </div>
          </div>
          ${obs.description ? html`<p class="obs-description">${this._renderWithLinks(obs.description)}</p>` : nothing}
          ${obs.confidence ? html`
            <div class="confidence-wrap">
              <span class="confidence-label">Confidence</span>
              <div class="confidence-bar">
                <div class="confidence-fill confidence-fill--${obs.confidence}"></div>
              </div>
            </div>
          ` : nothing}
          ${this._renderDrafts(obs.id)}
        </div>
      `)}
      ${done.length ? html`
        <p class="completed-label">Completed</p>
        ${done.map((obs) => html`
          <div class="card observation-item obs-completed">
            <div class="obs-header">
              <p class="obs-name"><span class="obs-check">✓</span>${obs.name}</p>
              <button class="obs-complete-btn obs-complete-btn--done"
                @click=${() => this._toggleComplete(obs.id)}>Undo</button>
            </div>
            <div class="obs-insights">
              <p class="obs-insights-label">💡 Insights</p>
              <p class="obs-insights-summary">One week after the public announcement of Contentful acquisition by Salesforce, the newly created page "how to migrate from Contentful to AEM" shows promising signals of engagement:</p>
              <ul class="obs-insights-metrics">
                <li><span class="obs-metric-name">Page Visits</span><span class="obs-metric-value">0 → several thousand</span></li>
                <li><span class="obs-metric-name">Referrals</span><span class="obs-metric-value">200 visits · 45% from LLMs, 55% from Social</span></li>
                <li><span class="obs-metric-name">Agentic visits</span><span class="obs-metric-value">0 → hundreds (potential citations)</span></li>
                <li><span class="obs-metric-name">AI citations</span><span class="obs-metric-value">Referenced in 6 of 15 prompts on CMS modernization</span></li>
              </ul>
            </div>
          </div>
        `)}
      ` : nothing}`;
  }

  render() {
    return html`
      <div class="app-header">
        <svg xmlns="http://www.w3.org/2000/svg" class="nc-logo" viewBox="0 0 160 160" focusable="false" aria-hidden="true"><defs><linearGradient id="00c6af__e" x1="-40.209" x2="219.921" y1="142.983" y2="-15.277" gradientUnits="userSpaceOnUse"><stop offset="0.06" stop-color="#8480FE"></stop><stop offset="0.6" stop-color="#8480FE" stop-opacity="0"></stop></linearGradient><linearGradient id="00c6af__f" x1="168.544" x2="56.949" y1="29.472" y2="149.467" gradientUnits="userSpaceOnUse"><stop stop-color="#EB1000"></stop><stop offset="1" stop-color="#EB1000" stop-opacity="0"></stop></linearGradient><linearGradient id="00c6af__g" x1="32.925" x2="230.753" y1="166.029" y2="55.209" gradientUnits="userSpaceOnUse"><stop stop-color="#FC7D00" stop-opacity="0"></stop><stop offset="0.432" stop-color="#FC7D00"></stop><stop offset="0.609" stop-color="#FC7D00"></stop><stop offset="1" stop-color="#FC7D00" stop-opacity="0"></stop></linearGradient><radialGradient id="00c6af__d" cx="0" cy="0" r="1" gradientTransform="rotate(90 42.131 48.337)scale(69.6088)" gradientUnits="userSpaceOnUse"><stop offset="0.167" stop-color="#FF709F"></stop><stop offset="1" stop-color="#FF709F" stop-opacity="0"></stop></radialGradient><radialGradient id="00c6af__h" cx="0" cy="0" r="1" gradientTransform="rotate(90 60.885 89.79)scale(69.6088)" gradientUnits="userSpaceOnUse"><stop offset="0.167" stop-color="#EB1000"></stop><stop offset="1" stop-color="#EB1000" stop-opacity="0"></stop></radialGradient><clipPath id="00c6af__a"><path fill="#fff" d="M0 0h160v160H0z"></path></clipPath><clipPath id="00c6af__c"><rect width="160" height="160" fill="#fff" rx="5.125"></rect></clipPath></defs><g clip-path="url(#00c6af__a)"><clipPath id="00c6af__b"><path fill="#fff" fill-rule="evenodd" d="M14.537 30.564c-.696.178-1.243.716-1.433 1.41-.19.692.007 1.434.515 1.942l15.729 15.729c.415.415.991.627 1.576.579l12.068-.982 22.952 22.951c1.562 1.562 4.094 1.562 5.657 0s1.562-4.094 0-5.657L48.65 43.586l.982-12.07c.048-.585-.164-1.161-.579-1.576l-15.73-15.73c-.507-.508-1.249-.704-1.942-.514s-1.23.736-1.409 1.433l-3.147 12.287zm65.284-2.62c-6.31 0-12.35 1.122-17.936 3.173-2.074.762-4.372-.302-5.134-2.376s.302-4.372 2.376-5.133c6.456-2.372 13.429-3.664 20.694-3.664 33.152 0 60.028 26.875 60.028 60.027S112.973 140 79.821 140s-60.027-26.875-60.027-60.028c0-7.074 1.225-13.87 3.479-20.184.742-2.08 3.03-3.165 5.111-2.422s3.166 3.031 2.423 5.112c-1.95 5.462-3.013 11.35-3.013 17.494C27.794 108.705 51.087 132 79.82 132s52.028-23.294 52.028-52.028-23.294-52.027-52.028-52.027M79.82 54.46c-3.393 0-6.62.66-9.571 1.855-2.047.83-4.38-.158-5.21-2.205-.829-2.048.159-4.38 2.207-5.21 3.888-1.574 8.135-2.44 12.574-2.44 18.506 0 33.508 15.003 33.508 33.509s-15.002 33.509-33.508 33.509c-18.507 0-33.509-15.003-33.509-33.509 0-4.136.751-8.106 2.129-11.775.776-2.068 3.082-3.115 5.15-2.339s3.115 3.083 2.34 5.15c-1.046 2.784-1.619 5.802-1.619 8.964 0 14.088 11.42 25.509 25.509 25.509 14.088 0 25.508-11.421 25.508-25.509S93.908 54.461 79.82 54.461m-9.138 31.165c7.73-.72 13.881-6.873 14.6-14.602 3.09 1.861 5.158 5.25 5.158 9.12 0 5.875-4.763 10.639-10.639 10.639-3.87 0-7.257-2.067-9.119-5.157"></path></clipPath><g clip-path="url(#00c6af__b)"><g clip-path="url(#00c6af__c)"><rect width="160" height="160" fill="#FFECCF" rx="5.125"></rect><path fill="#FFECCF" d="M0 0h160v160H0z"></path><circle cx="90.468" cy="6.206" r="69.609" fill="url(#00c6af__d)" transform="rotate(-.08 90.468 6.206)"></circle><path fill="url(#00c6af__e)" d="M61.07-28.263c-12.288-7.603-27.857-7.65-40.19-.12l-123.358 75.318c-12.081 7.377-12.101 24.788-.036 32.193l122.542 75.211c12.315 7.557 27.884 7.548 40.188-.027l122.29-75.281c12.001-7.39 12.023-24.703.037-32.12z"></path><path fill="url(#00c6af__f)" d="M23.058 75.965C25.793 16.232 76.433-29.975 136.166-27.24c59.732 2.735 105.938 53.375 103.204 113.108s-53.375 105.939-113.108 103.204C66.53 186.337 20.324 135.697 23.058 75.965"></path><path fill="url(#00c6af__g)" d="M-64.825 115.35c23.744-10.129 49.351-9.695 71.537-.835 44.394 17.773 70.225 6.784 88.141-37.508 8.925-22.226 26.348-41.049 50.119-51.19 47.525-20.243 102.392 1.723 122.607 49.108 20.214 47.385-1.912 102.165-49.426 122.435-23.824 10.163-49.48 9.687-71.7.747-44.322-17.678-70.104-6.648-87.998 37.698-8.947 22.173-26.366 40.931-50.11 51.061-47.488 20.258-102.354-1.707-122.558-49.066-20.203-47.359 1.9-102.191 49.388-122.45"></path><circle cx="150.675" cy="28.906" r="69.609" fill="url(#00c6af__h)" transform="rotate(-.08 150.675 28.906)"></circle></g></g></g></svg>
        <h3>Trend Identifier</h3>
      </div>
      ${this._renderContent()}
    `;
  }
}

customElements.define('nerve-center-app', NerveCenterApp);
