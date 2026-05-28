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
    _showContinueWarning: { state: true },
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
    this._showContinueWarning = false;
  }

  createRenderRoot() { return this; }

  connectedCallback() {
    super.connectedCallback();
    this._init();
  }

  async _init() {
    try {
      const { token } = await DA_SDK;
      this._token = token;
    } catch {
      // SDK unavailable in standalone/dev — token stays null
    }
    const parsed = parseOrgSite(window.location.hash.replace(/^#/, ''));
    if (parsed) {
      this._org = parsed.org;
      this._site = parsed.site;
      this._orgSiteInput = `/${parsed.org}/${parsed.site}`;
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

  _renderWarningDialog() {
    if (!this._showContinueWarning) return nothing;
    return html`
      <div class="dialog-overlay" @click=${() => { this._showContinueWarning = false; }}>
        <div class="dialog-panel" @click=${(e) => e.stopPropagation()}>
          <p class="dialog-title">Continue without passing checks?</p>
          <p class="dialog-body">
            Only continue if you know what you are doing. Quick Edit must be properly set up
            in your project — without it, Experience Workspace functionality will be limited.
          </p>
          <div class="cta-bar">
            <sl-button class="ew-fill-accent" @click=${() => { this._showContinueWarning = false; this._onNext(); }}>
              Continue anyway
            </sl-button>
            <sl-button class="ew-quiet-secondary" @click=${() => { this._showContinueWarning = false; }}>Cancel</sl-button>
          </div>
        </div>
      </div>`;
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
            <sl-button class="ew-fill-accent" @click=${() => this._onNext()}>
              Next: Enable Experience Workspace
            </sl-button>` : nothing}
          ${anyFail ? html`
            <sl-button class="ew-quiet-secondary" @click=${() => this._runChecks()}>Re-check</sl-button>
            <sl-button class="ew-quiet-secondary" @click=${() => { this._showContinueWarning = true; }}>Continue anyway</sl-button>
          ` : nothing}
          ${pending && !anyFail ? html`
            <sl-button class="ew-fill-accent" disabled>Checking…</sl-button>` : nothing}
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
            <a href="https://da.live/config#/${this._org}/" target="_blank" style="color:var(--ew-accent)">
              da.live/config#/${this._org}/
            </a> manually:
          </p>
          <div class="config-snippet">${manualSnippet}</div>
          <sl-button class="ew-quiet-secondary" @click=${() => navigator.clipboard?.writeText(manualSnippet)}>
            Copy
          </sl-button>
        </div>`;
    }

    if (this._configStatus === 'error') {
      return html`
        <div class="card">
          <p class="card-title">Step 2 — Enable Experience Workspace</p>
          <p class="error-msg">❌ ${this._errorMsg === 'network' ? 'Network error — check your connection and try again.' : this._errorMsg}</p>
          <div class="cta-bar">
            <sl-button class="ew-quiet-secondary" @click=${() => this._readConfig()}>Retry</sl-button>
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
        <div class="org-site-field">
          <label class="org-site-label">Org / Site</label>
          <sl-input
            type="text"
            placeholder="/org/site"
            .value=${this._orgSiteInput}
            @input=${(e) => { this._orgSiteInput = e.target.value; }}
          ></sl-input>
        </div>
        <sl-button class="ew-fill-accent org-site-submit" ?disabled=${!canContinue} @click=${() => this._onContinue()}>
          Check Requirements
        </sl-button>
      </div>

      ${this._step !== 'input' ? this._renderStepIndicator() : nothing}
      ${this._step === 1 ? this._renderStep1() : nothing}
      ${this._step === 2 ? this._renderStep2() : nothing}
      ${this._renderWarningDialog()}
    `;
  }
}

customElements.define('ew-setup-app', EwSetupApp);
