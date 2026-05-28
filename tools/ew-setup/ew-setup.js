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
        display: block; min-height: 100vh; background: #1a1a1a; color: #fff;
        font-family: adobe-clean, 'Source Sans Pro', -apple-system, BlinkMacSystemFont, sans-serif;
        padding: 40px 24px; box-sizing: border-box;
      }
      ew-setup-app .app-title { font-size: 24px; font-weight: 700; margin: 0 0 32px; }
      ew-setup-app .org-site-row { display: flex; gap: 12px; align-items: center; margin-bottom: 32px; max-width: 600px; }
      ew-setup-app .org-site-input {
        flex: 1; background: #2a2a2a; border: 1px solid #3a3a3a; border-radius: 6px;
        color: #fff; font-size: 14px; padding: 8px 12px; outline: none;
      }
      ew-setup-app .org-site-input:focus { border-color: #666; }
      ew-setup-app .steps { display: flex; gap: 8px; align-items: center; margin-bottom: 24px; }
      ew-setup-app .step-badge {
        width: 28px; height: 28px; border-radius: 50%; display: flex;
        align-items: center; justify-content: center; font-size: 13px; font-weight: 600;
        border: 2px solid #555; color: #555; flex-shrink: 0;
      }
      ew-setup-app .step-badge.active { background: #eb1000; border-color: #eb1000; color: #fff; }
      ew-setup-app .step-badge.done { border-color: #4caf50; color: #4caf50; }
      ew-setup-app .step-label { font-size: 13px; color: #888; }
      ew-setup-app .step-label.active { color: #fff; }
      ew-setup-app .step-divider { flex: 0 0 32px; height: 1px; background: #3a3a3a; }
      ew-setup-app .card { background: #2a2a2a; border: 1px solid #3a3a3a; border-radius: 10px; padding: 28px; max-width: 600px; }
      ew-setup-app .card-title { font-size: 18px; font-weight: 600; margin: 0 0 20px; }
      ew-setup-app .check-row { display: flex; align-items: flex-start; gap: 12px; padding: 12px 0; border-bottom: 1px solid #3a3a3a; }
      ew-setup-app .check-row:last-of-type { border-bottom: none; }
      ew-setup-app .check-icon { font-size: 18px; flex-shrink: 0; margin-top: 1px; }
      ew-setup-app .check-label { font-size: 14px; font-weight: 500; }
      ew-setup-app .check-error { font-size: 13px; color: #ff6b6b; margin-top: 4px; }
      ew-setup-app .remediation-link { display: inline-block; margin-top: 6px; font-size: 13px; color: #eb1000; }
      ew-setup-app .cta-bar { margin-top: 24px; display: flex; gap: 12px; align-items: center; }
      ew-setup-app .btn-primary {
        background: #eb1000; color: #fff; border: none; border-radius: 20px;
        padding: 10px 24px; font-size: 14px; font-weight: 600; cursor: pointer;
      }
      ew-setup-app .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
      ew-setup-app .btn-secondary {
        background: #3a3a3a; color: #fff; border: none; border-radius: 20px;
        padding: 10px 24px; font-size: 14px; cursor: pointer;
      }
      ew-setup-app .config-snippet {
        background: #111; border: 1px solid #3a3a3a; border-radius: 6px;
        padding: 12px; font-family: monospace; font-size: 13px;
        margin: 12px 0; white-space: pre-wrap; word-break: break-all;
      }
      ew-setup-app .success-msg { color: #4caf50; font-size: 14px; margin: 0 0 12px; }
      ew-setup-app .error-msg { color: #ff6b6b; font-size: 14px; line-height: 1.5; }
      ew-setup-app .spinner {
        width: 18px; height: 18px; border: 2px solid #444; border-top-color: #eb1000;
        border-radius: 50%; animation: ew-spin 0.7s linear infinite; flex-shrink: 0;
      }
      @keyframes ew-spin { to { transform: rotate(360deg); } }
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

    fetch(`${base}/scripts/scripts.js`)
      .then(async (r) => {
        if (!r.ok) { this._checkB = 'fail'; return; }
        const text = await r.text();
        this._checkB = /export\s+(async\s+)?function\s+loadPage/.test(text) ? 'pass' : 'fail';
      })
      .catch(() => { this._checkB = 'fail'; });
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
            <div class="check-label">loadPage export in scripts/scripts.js</div>
            ${this._checkB === 'fail' ? html`
              <div class="check-error">export function loadPage not found in scripts/scripts.js</div>
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
