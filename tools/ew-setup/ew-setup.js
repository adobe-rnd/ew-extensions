import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { LitElement, html, nothing } from 'da-lit';
import { parseOrgSite, findEditorPathRows, hasEditorPathForSite, buildUpdatedConfig } from './utils.js';

class EwSetupApp extends LitElement {
  static properties = {
    _orgSiteInput: { state: true },
    _org: { state: true },
    _site: { state: true },
    _token: { state: true },
    _step: { state: true }, // 'input' | 1 | 2
    _checkA: { state: true }, // 'pending' | 'pass' | 'fail'
    _checkB: { state: true },
    _configStatus: { state: true }, // 'idle'|'loading'|'exists'|'written'|'error'
    _existingValue: { state: true },
    _errorMsg: { state: true },
  };

  constructor() {
    super();
    this._orgSiteInput = '';
    this._org = '';
    this._site = '';
    this._token = null;
    this._step = 'input';
    this._checkA = 'pending';
    this._checkB = 'pending';
    this._configStatus = 'idle';
    this._existingValue = null;
    this._errorMsg = null;
    this._configJson = null;
    this._configInFlight = false;
  }

  createRenderRoot() { return this; }

  connectedCallback() {
    super.connectedCallback();
    this._injectStyles();
    this._init();
  }

  _injectStyles() {
    if (document.getElementById('ew-setup-styles')) return;
    const style = document.createElement('style');
    style.id = 'ew-setup-styles';
    style.textContent = `
      ew-setup-app {
        --ew-accent: #eb1000;
        display: block;
        max-width: var(--grid-container-width, 900px);
        margin: var(--spacing-800, 48px) auto;
        padding: 0 var(--spacing-400, 24px);
        box-sizing: border-box;
        -webkit-font-smoothing: antialiased;
        font-family: var(--body-font-family, adobe-clean, 'Source Sans Pro', -apple-system, sans-serif);
        color: var(--s2-gray-800, #222);
      }
      ew-setup-app .app-title {
        font-size: var(--s2-heading-xl-size, 28px);
        font-weight: 700;
        margin: 0 0 var(--spacing-400, 24px);
        color: var(--s2-gray-900, #1a1a1a);
        letter-spacing: -0.02em;
      }
      ew-setup-app .org-site-row {
        display: flex; flex-wrap: wrap; gap: var(--spacing-300, 16px);
        align-items: flex-end; margin-bottom: var(--spacing-600, 40px);
      }
      ew-setup-app .org-site-field { flex: 1 1 18rem; min-width: 12rem; display: flex; flex-direction: column; gap: var(--spacing-75, 6px); }
      ew-setup-app .org-site-label { font-size: var(--s2-body-s-size, 13px); font-weight: 600; color: var(--s2-gray-800, #222); }
      ew-setup-app .org-site-input {
        width: 100%; background: var(--s2-gray-25, #fff);
        border: 1px solid var(--s2-gray-300, #ccc); border-radius: var(--s2-radius-100, 6px);
        color: var(--s2-gray-900, #1a1a1a); font-size: var(--s2-body-s-size, 13px);
        padding: var(--spacing-100, 8px) var(--spacing-200, 12px); outline: none;
        box-sizing: border-box; font-family: inherit;
      }
      ew-setup-app .org-site-input:focus { border-color: var(--s2-gray-600, #666); box-shadow: 0 0 0 2px var(--s2-gray-200, #eee); }
      ew-setup-app .org-site-submit { flex: 0 0 auto; align-self: flex-end; }

      ew-setup-app .steps {
        display: flex; gap: var(--spacing-100, 8px); align-items: center;
        margin-bottom: var(--spacing-400, 24px);
      }
      ew-setup-app .step-badge {
        width: 26px; height: 26px; border-radius: 50%; display: flex;
        align-items: center; justify-content: center;
        font-size: var(--s2-body-s-size, 13px); font-weight: 700;
        border: 2px solid var(--s2-gray-300, #ccc); color: var(--s2-gray-400, #aaa); flex-shrink: 0;
      }
      ew-setup-app .step-badge.active { background: var(--ew-accent); border-color: var(--ew-accent); color: #fff; }
      ew-setup-app .step-badge.done { border-color: var(--s2-green-700, #2d9e4f); color: var(--s2-green-700, #2d9e4f); }
      ew-setup-app .step-label { font-size: var(--s2-body-s-size, 13px); color: var(--s2-gray-600, #767676); }
      ew-setup-app .step-label.active { color: var(--s2-gray-900, #1a1a1a); font-weight: 600; }
      ew-setup-app .step-divider { flex: 0 0 28px; height: 1px; background: var(--s2-gray-200, #e0e0e0); }

      ew-setup-app .card {
        background: var(--s2-gray-50, #f9f9f9);
        border: 1px solid var(--s2-gray-200, #e0e0e0);
        border-radius: var(--s2-radius-200, 10px);
        padding: var(--spacing-400, 24px) var(--spacing-500, 32px);
      }
      ew-setup-app .card-title {
        font-size: var(--s2-heading-s-size, 18px); font-weight: 700;
        margin: 0 0 var(--spacing-300, 16px); color: var(--s2-gray-900, #1a1a1a);
      }

      ew-setup-app .check-row {
        display: flex; align-items: flex-start; gap: var(--spacing-200, 12px);
        padding: var(--spacing-200, 12px) 0; border-bottom: 1px solid var(--s2-gray-200, #e0e0e0);
      }
      ew-setup-app .check-row:last-of-type { border-bottom: none; padding-bottom: 0; }
      ew-setup-app .check-icon { font-size: 18px; flex-shrink: 0; margin-top: 1px; }
      ew-setup-app .check-label { font-size: var(--s2-body-m-size, 14px); font-weight: 600; color: var(--s2-gray-900, #1a1a1a); }
      ew-setup-app .check-info { font-size: 11px; color: var(--s2-gray-500, #999); margin-top: 2px; }
      ew-setup-app .check-info code { font-family: var(--fixed-font-family, monospace); }
      ew-setup-app .check-error { font-size: var(--s2-body-s-size, 13px); color: var(--s2-red-900, #c9271a); margin-top: var(--spacing-75, 4px); }
      ew-setup-app .remediation-link { display: inline-block; margin-top: var(--spacing-75, 6px); font-size: var(--s2-body-s-size, 13px); color: var(--ew-accent); }

      ew-setup-app .cta-bar { margin-top: var(--spacing-400, 24px); display: flex; gap: var(--spacing-200, 12px); align-items: center; }
      ew-setup-app .btn-primary {
        background: var(--ew-accent); color: #fff; border: none;
        border-radius: var(--s2-radius-300, 20px);
        padding: var(--spacing-150, 10px) var(--spacing-400, 24px);
        font-size: var(--s2-body-s-size, 13px); font-weight: 700; cursor: pointer;
        font-family: inherit;
      }
      ew-setup-app .btn-primary:hover:not(:disabled) { filter: brightness(0.92); }
      ew-setup-app .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
      ew-setup-app .btn-secondary {
        background: var(--s2-gray-75, #f0f0f0); color: var(--s2-gray-800, #222);
        border: 1px solid var(--s2-gray-300, #ccc); border-radius: var(--s2-radius-300, 20px);
        padding: var(--spacing-150, 10px) var(--spacing-400, 24px);
        font-size: var(--s2-body-s-size, 13px); cursor: pointer; font-family: inherit;
      }
      ew-setup-app .btn-secondary:hover { background: var(--s2-gray-100, #e8e8e8); }

      ew-setup-app .config-snippet {
        background: var(--s2-gray-100, #f0f0f0); border: 1px solid var(--s2-gray-200, #e0e0e0);
        border-radius: var(--s2-radius-100, 6px); padding: var(--spacing-200, 12px);
        font-family: var(--fixed-font-family, monospace); font-size: var(--s2-body-s-size, 13px);
        color: var(--s2-gray-900, #1a1a1a); margin: var(--spacing-200, 12px) 0;
        white-space: pre-wrap; word-break: break-all;
      }
      ew-setup-app .success-msg { color: var(--s2-green-900, #2d9e4f); font-size: var(--s2-body-s-size, 13px); margin: 0 0 var(--spacing-200, 12px); }
      ew-setup-app .error-msg { color: var(--s2-red-900, #c9271a); font-size: var(--s2-body-s-size, 13px); line-height: 1.5; }

      ew-setup-app .spinner {
        width: 20px; height: 20px;
        border: 2px solid var(--s2-gray-200, #e0e0e0); border-top-color: var(--ew-accent);
        border-radius: 50%; animation: ew-spin 0.85s linear infinite; flex-shrink: 0;
      }
      @keyframes ew-spin { to { transform: rotate(360deg); } }

      @media (max-width: 600px) {
        ew-setup-app .org-site-row { flex-direction: column; align-items: stretch; }
        ew-setup-app .org-site-submit { width: 100%; }
        ew-setup-app .card { padding: var(--spacing-300, 16px); }
      }
    `;
    document.head.append(style);
  }

  async _init() {
    try {
      const { context, token } = await DA_SDK;
      this._token = token;
      this._org = context.org || '';
      this._site = context.repo || context.site || '';
      this._orgSiteInput = (this._org && this._site) ? `/${this._org}/${this._site}` : '';
    } catch {
      // SDK unavailable in standalone/dev — leave fields empty for manual input
    }
  }

  _onContinue() {
    const parsed = parseOrgSite(this._orgSiteInput);
    if (!parsed) return;
    this._org = parsed.org;
    this._site = parsed.site;
    this._step = 1;
    this._checkA = 'pending';
    this._checkB = 'pending';
    this._configStatus = 'idle';
    this._existingValue = null;
    this._errorMsg = null;
    this._configJson = null;
    this._configInFlight = false;
    this._runChecks();
  }

  async _runChecks() {
    const base = `https://main--${this._site}--${this._org}.aem.live`;

    fetch(`${base}/tools/quick-edit/quick-edit.js`)
      .then((r) => { this._checkA = r.ok ? 'pass' : 'fail'; })
      .catch(() => { this._checkA = 'fail'; });

    (async () => {
      try {
        const headResp = await fetch(`${base}/head.html`);
        if (!headResp.ok) { this._checkB = 'fail'; return; }
        const doc = new DOMParser().parseFromString(await headResp.text(), 'text/html');
        const scriptTag = [...doc.querySelectorAll('script[src]')]
          .find((s) => s.getAttribute('src').endsWith('scripts.js'));
        if (!scriptTag) { this._checkB = 'fail'; return; }
        const src = scriptTag.getAttribute('src');
        const scriptUrl = src.startsWith('http') ? src : `${base}${src}`;
        const scriptResp = await fetch(scriptUrl);
        if (!scriptResp.ok) { this._checkB = 'fail'; return; }
        const text = await scriptResp.text();
        this._checkB = /export\s+(async\s+)?function\s+loadPage/.test(text) ? 'pass' : 'fail';
      } catch {
        this._checkB = 'fail';
      }
    })();
  }

  _renderIcon(status) {
    if (status === 'pending') return html`<div class="spinner"></div>`;
    return html`<span class="check-icon">${status === 'pass' ? '✅' : '❌'}</span>`;
  }

  _renderStep1() {
    const bothPass = this._checkA === 'pass' && this._checkB === 'pass';
    const anyFail = this._checkA === 'fail' || this._checkB === 'fail';
    const pending = this._checkA === 'pending' || this._checkB === 'pending';

    return html`
      <div class="card">
        <p class="card-title">Step 1 — Check Code Requirements</p>

        <div class="check-row">
          ${this._renderIcon(this._checkA)}
          <div>
            <div class="check-label">Quick Edit module</div>
            ${this._checkA === 'fail' ? html`
              <div class="check-error">tools/quick-edit/quick-edit.js not found</div>
              <a class="remediation-link" href="https://docs.da.live/about/early-access/quick-edit" target="_blank">
                View setup instructions →
              </a>` : nothing}
          </div>
        </div>

        <div class="check-row">
          ${this._renderIcon(this._checkB)}
          <div>
            <div class="check-label">loadPage export in scripts.js</div>
            <div class="check-info">Script path resolved from <code>head.html</code></div>
            ${this._checkB === 'fail' ? html`
              <div class="check-error">export function loadPage not found in scripts.js</div>
              <a class="remediation-link" href="https://docs.da.live/about/early-access/quick-edit" target="_blank">
                View setup instructions →
              </a>` : nothing}
          </div>
        </div>

        <div class="cta-bar">
          ${bothPass ? html`
            <button class="btn-primary" @click=${() => this._onNext()}>
              Next: Enable Experience Workspace
            </button>` : nothing}
          ${anyFail ? html`
            <button class="btn-secondary" @click=${() => this._runChecks()}>Re-check</button>
            <button class="btn-secondary" @click=${() => this._onNext()}>Continue anyway</button>
          ` : nothing}
          ${pending && !anyFail ? html`
            <button class="btn-primary" disabled>Checking…</button>` : nothing}
        </div>
      </div>`;
  }

  _renderStepIndicator() {
    const s1Class = this._step === 1 ? 'active' : 'done';
    const s2Class = this._step === 2 ? 'active' : '';
    return html`
      <div class="steps">
        <div class="step-badge ${s1Class}">1</div>
        <span class="step-label ${this._step === 1 ? 'active' : ''}">Check Requirements</span>
        <div class="step-divider"></div>
        <div class="step-badge ${s2Class}">2</div>
        <span class="step-label ${this._step === 2 ? 'active' : ''}">Enable Experience Workspace</span>
      </div>`;
  }

  async _onNext() {
    this._step = 2;
    this._configStatus = 'loading';
    await this._readConfig();
  }

  async _readConfig() {
    if (this._configInFlight) return;
    this._configInFlight = true;
    this._configStatus = 'loading';
    try {
      const resp = await fetch(`https://admin.da.live/config/${this._org}`, {
        headers: { Authorization: `Bearer ${this._token}` },
      });
      if (resp.status === 401 || resp.status === 403) {
        this._configStatus = 'error';
        this._errorMsg = 'permission';
        return;
      }
      if (!resp.ok) {
        if (resp.status === 404) {
          this._configJson = null;
          await this._writeConfig();
        } else {
          this._configStatus = 'error';
          this._errorMsg = `Unexpected server error (HTTP ${resp.status})`;
        }
        return;
      }
      const json = await resp.json();
      this._configJson = json;
      const { rows } = findEditorPathRows(json);
      if (hasEditorPathForSite(rows, this._org, this._site)) {
        const match = rows.find((r) => typeof r.value === 'string' && r.value.includes(`/${this._org}/${this._site}=`));
        this._existingValue = match?.value || '';
        this._configStatus = 'exists';
      } else {
        await this._writeConfig();
      }
    } catch {
      this._configStatus = 'error';
      this._errorMsg = 'network';
    } finally {
      this._configInFlight = false;
    }
  }

  async _writeConfig() {
    try {
      const updated = buildUpdatedConfig(this._configJson, this._org, this._site);
      const body = new FormData();
      body.append('config', JSON.stringify(updated));
      const resp = await fetch(`https://admin.da.live/config/${this._org}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this._token}` },
        body,
      });
      if (resp.ok) {
        this._configStatus = 'written';
      } else if (resp.status === 401 || resp.status === 403) {
        this._configStatus = 'error';
        this._errorMsg = 'permission';
      } else {
        this._configStatus = 'error';
        this._errorMsg = `Unexpected server error (HTTP ${resp.status})`;
      }
    } catch {
      this._configStatus = 'error';
      this._errorMsg = 'network';
    }
  }

  _renderStep2() {
    const configValue = `/${this._org}/${this._site}=https://da.live/canvas#`;
    const manualSnippet = `Key:   editor.path\nValue: ${configValue}`;

    if (this._configStatus === 'loading') {
      return html`
        <div class="card">
          <p class="card-title">Step 2 — Enable Experience Workspace</p>
          <div style="display:flex;gap:12px;align-items:center;padding:16px 0">
            <div class="spinner"></div><span>Reading org config…</span>
          </div>
        </div>`;
    }

    if (this._configStatus === 'exists') {
      return html`
        <div class="card">
          <p class="card-title">Step 2 — Enable Experience Workspace</p>
          <p class="success-msg">✅ Already configured</p>
          <p style="font-size:13px;color:#aaa;margin:0">Existing value:</p>
          <div class="config-snippet">${this._existingValue}</div>
        </div>`;
    }

    if (this._configStatus === 'written') {
      return html`
        <div class="card">
          <p class="card-title">Step 2 — Enable Experience Workspace</p>
          <p class="success-msg">✅ Experience Workspace is now enabled for ${this._org}/${this._site}</p>
          <div class="config-snippet">${configValue}</div>
        </div>`;
    }

    if (this._configStatus === 'error' && this._errorMsg === 'permission') {
      return html`
        <div class="card">
          <p class="card-title">Step 2 — Enable Experience Workspace</p>
          <p class="error-msg">
            ❌ You don't have permission to update the org config for '${this._org}'.<br>
            Org config changes require org admin access in DA. Please ask your DA org admin
            to add the following entry at
            <a href="https://da.live/config#/${this._org}/" target="_blank" style="color:#eb1000">
              da.live/config#/${this._org}/
            </a> manually:
          </p>
          <div class="config-snippet">${manualSnippet}</div>
          <button class="btn-secondary" @click=${() => navigator.clipboard?.writeText(manualSnippet)}>
            Copy
          </button>
        </div>`;
    }

    if (this._configStatus === 'error') {
      return html`
        <div class="card">
          <p class="card-title">Step 2 — Enable Experience Workspace</p>
          <p class="error-msg">❌ ${this._errorMsg === 'network' ? 'Network error — check your connection and try again.' : this._errorMsg}</p>
          <div class="cta-bar">
            <button class="btn-secondary" @click=${() => this._readConfig()}>Retry</button>
          </div>
        </div>`;
    }

    return nothing;
  }

  render() {
    const canContinue = !!parseOrgSite(this._orgSiteInput);
    return html`
      <p class="app-title">Enable Experience Workspace</p>

      <div class="org-site-row">
        <input
          class="org-site-input"
          type="text"
          placeholder="/org/site"
          .value=${this._orgSiteInput}
          @input=${(e) => { this._orgSiteInput = e.target.value; }}
        />
        <button class="btn-primary" ?disabled=${!canContinue} @click=${() => this._onContinue()}>
          Check Requirements
        </button>
      </div>

      ${this._step !== 'input' ? this._renderStepIndicator() : nothing}
      ${this._step === 1 ? this._renderStep1() : nothing}
      ${this._step === 2 ? this._renderStep2() : nothing}
    `;
  }
}

customElements.define('ew-setup-app', EwSetupApp);
