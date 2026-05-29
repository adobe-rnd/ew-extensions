import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { LitElement, html, nothing } from 'da-lit';
import { parseOrgSite, findEditorPathRows, hasEditorPathForSite, buildUpdatedConfig, hasCorrectSidekickConfig, buildUpdatedSidekickConfig } from './utils.js';

const CORS_PROXY = 'https://da-etc.adobeaem.workers.dev/cors?url=';
const proxyFetch = (url) => fetch(`${CORS_PROXY}${encodeURIComponent(url)}`);

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
    _headAuthBlocked: { state: true },
    _sidekickStatus: { state: true }, // 'idle'|'loading'|'exists'|'written'|'error'
    _sidekickErrorMsg: { state: true },
    _sidekickErrorSource: { state: true }, // 'read'|'write'
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
    this._headAuthBlocked = false;
    this._sidekickStatus = 'idle';
    this._sidekickErrorMsg = null;
    this._sidekickErrorSource = null;
    this._sidekickJson = null;
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
    this._headAuthBlocked = false;
    this._sidekickStatus = 'idle';
    this._sidekickErrorMsg = null;
    this._sidekickErrorSource = null;
    this._sidekickJson = null;
    this._runChecks();
  }

  async _runChecks() {
    const base = `https://main--${this._site}--${this._org}.aem.live`;

    // Check B first: resolve scripts.js from head.html
    try {
      const headResp = await proxyFetch(`${base}/head.html`);
      if (headResp.status === 401) {
        this._headAuthBlocked = true;
        this._checkB = 'fail';
        this._checkA = 'fail';
        return;
      }
      if (!headResp.ok) { this._checkB = 'fail'; this._checkA = 'fail'; return; }
      const doc = new DOMParser().parseFromString(await headResp.text(), 'text/html');
      const scriptTag = [...doc.querySelectorAll('script[src]')]
        .find((s) => s.getAttribute('src').endsWith('scripts.js'));
      if (!scriptTag) { this._checkB = 'fail'; } else {
        const src = scriptTag.getAttribute('src');
        const scriptUrl = src.startsWith('http') ? src : `${base}${src}`;
        const scriptResp = await proxyFetch(scriptUrl);
        if (!scriptResp.ok) { this._checkB = 'fail'; } else {
          const text = await scriptResp.text();
          this._checkB = /export\s+(async\s+)?function\s+loadPage/.test(text) ? 'pass' : 'fail';
        }
      }
    } catch {
      this._checkB = 'fail';
      this._checkA = 'fail';
      return;
    }

    // Check A only once the site is confirmed reachable via head.html
    proxyFetch(`${base}/tools/quick-edit/quick-edit.js`)
      .then((r) => { this._checkA = r.ok ? 'pass' : 'fail'; })
      .catch(() => { this._checkA = 'fail'; });
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

        ${this._headAuthBlocked ? html`
          <div class="check-auth-notice">
            ⚠️ This tool cannot verify the code requirements because the EDS site has site authentication enabled.
            You can still continue if you are sure the requirements are met.
          </div>` : nothing}

        <div class="check-row">
          ${this._renderIcon(this._checkB)}
          <div>
            <div class="check-label">loadPage export in scripts.js</div>
            <div class="check-info">Script path resolved from <code>head.html</code></div>
            ${this._checkB === 'fail' ? html`
              <div class="check-error">export function loadPage not found in scripts.js</div>
              <a class="remediation-link" href="https://docs.da.live/about/early-access/experience-workspace#setup" target="_blank">
                View setup instructions →
              </a>` : nothing}
          </div>
        </div>

        <div class="check-row">
          ${this._renderIcon(this._checkA)}
          <div>
            <div class="check-label">Quick Edit module</div>
            ${this._checkA === 'fail' ? html`
              <div class="check-error">tools/quick-edit/quick-edit.js not found</div>
              <a class="remediation-link" href="https://docs.da.live/about/early-access/experience-workspace#setup" target="_blank">
                View setup instructions →
              </a>
              <div class="check-tip">
                💡 Use the <a href="https://github.com/exp-workspace/plugin-claude" target="_blank">Experience Workspace enablement</a>
                — a skill for Claude or Cursor to enable Quick Edit automatically.
              </div>` : nothing}
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
    let s2Class = '';
    if (this._step === 2) s2Class = 'active';
    else if (this._step === 3) s2Class = 'done';
    const s3Class = this._step === 3 ? 'active' : '';
    return html`
      <div class="steps">
        <div class="step-badge ${s1Class}">1</div>
        <span class="step-label ${this._step === 1 ? 'active' : ''}">Check Requirements</span>
        <div class="step-divider"></div>
        <div class="step-badge ${s2Class}">2</div>
        <span class="step-label ${this._step === 2 ? 'active' : ''}">Enable Experience Workspace</span>
        <div class="step-divider"></div>
        <div class="step-badge ${s3Class}">3</div>
        <span class="step-label ${this._step === 3 ? 'active' : ''}">Configure Sidekick</span>
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

  async _onNextSidekick() {
    this._step = 3;
    this._sidekickStatus = 'loading';
    await this._readSidekickConfig();
  }

  async _readSidekickConfig() {
    try {
      const resp = await fetch(`https://admin.hlx.page/config/${this._org}/sites/${this._site}/sidekick.json`, {
        headers: { Authorization: `Bearer ${this._token}` },
      });
      if (resp.status === 401 || resp.status === 403) {
        this._sidekickStatus = 'error';
        this._sidekickErrorMsg = 'permission';
        this._sidekickErrorSource = 'read';
        return;
      }
      if (!resp.ok) {
        if (resp.status === 404) {
          this._sidekickJson = null;
          await this._writeSidekickConfig();
        } else {
          this._sidekickStatus = 'error';
          this._sidekickErrorMsg = `Unexpected server error (HTTP ${resp.status})`;
          this._sidekickErrorSource = 'read';
        }
        return;
      }
      const json = await resp.json();
      this._sidekickJson = json;
      if (hasCorrectSidekickConfig(json)) {
        this._sidekickStatus = 'exists';
      } else {
        await this._writeSidekickConfig();
      }
    } catch {
      this._sidekickStatus = 'error';
      this._sidekickErrorMsg = 'network';
      this._sidekickErrorSource = 'read';
    }
  }

  async _writeSidekickConfig() {
    try {
      const updated = buildUpdatedSidekickConfig(this._sidekickJson);
      const resp = await fetch(`https://admin.hlx.page/config/${this._org}/sites/${this._site}/sidekick.json`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this._token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updated),
      });
      if (resp.ok) {
        this._sidekickStatus = 'written';
      } else if (resp.status === 401 || resp.status === 403) {
        this._sidekickStatus = 'error';
        this._sidekickErrorMsg = 'permission';
        this._sidekickErrorSource = 'write';
      } else {
        this._sidekickStatus = 'error';
        this._sidekickErrorMsg = `Unexpected server error (HTTP ${resp.status})`;
        this._sidekickErrorSource = 'write';
      }
    } catch {
      this._sidekickStatus = 'error';
      this._sidekickErrorMsg = 'network';
      this._sidekickErrorSource = 'write';
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
          <div class="cta-bar">
            <sl-button class="ew-fill-accent" @click=${() => this._onNextSidekick()}>
              Next: Configure Sidekick
            </sl-button>
          </div>
        </div>`;
    }

    if (this._configStatus === 'written') {
      return html`
        <div class="card">
          <p class="card-title">Step 2 — Enable Experience Workspace</p>
          <p class="success-msg">✅ Experience Workspace is now enabled for ${this._org}/${this._site}</p>
          <div class="config-snippet">${configValue}</div>
          <div class="cta-bar">
            <sl-button class="ew-fill-accent" @click=${() => this._onNextSidekick()}>
              Next: Configure Sidekick
            </sl-button>
          </div>
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

  _renderStep3() {
    const editUrlPattern = 'https://da.live/canvas#/{{org}}/{{site}}{{pathname}}';

    if (this._sidekickStatus === 'loading') {
      return html`
        <div class="card">
          <p class="card-title">Step 3 — Configure Sidekick</p>
          <div style="display:flex;gap:12px;align-items:center;padding:16px 0">
            <div class="spinner"></div><span>Reading sidekick config…</span>
          </div>
        </div>`;
    }

    if (this._sidekickStatus === 'exists') {
      return html`
        <div class="card">
          <p class="card-title">Step 3 — Configure Sidekick</p>
          <p class="success-msg">✅ Sidekick already configured</p>
          <div class="config-snippet">${editUrlPattern}</div>
        </div>`;
    }

    if (this._sidekickStatus === 'written') {
      return html`
        <div class="card">
          <p class="card-title">Step 3 — Configure Sidekick</p>
          <p class="success-msg">✅ Sidekick configured for ${this._org}/${this._site}</p>
          <div class="config-snippet">${editUrlPattern}</div>
        </div>`;
    }

    if (this._sidekickStatus === 'error' && this._sidekickErrorMsg === 'permission') {
      const snippet = `"editUrlPattern": "${editUrlPattern}"`;
      return html`
        <div class="card">
          <p class="card-title">Step 3 — Configure Sidekick</p>
          <p class="error-msg">
            ❌ You don't have permission to update the sidekick config for '${this._org}/${this._site}'.<br>
            Please ask a project admin to add the following entry to the sidekick config manually.
            See the <a href="https://www.aem.live/developer/sidekick-development#custom-edit-urls" target="_blank" style="color:var(--s2-red-900)">sidekick configuration docs</a> for details.
          </p>
          <div class="config-snippet">${snippet}</div>
          <sl-button class="ew-quiet-secondary" @click=${() => navigator.clipboard?.writeText(snippet)}>
            Copy
          </sl-button>
        </div>`;
    }

    if (this._sidekickStatus === 'error') {
      const msg = this._sidekickErrorMsg === 'network' ? 'Network error — check your connection and try again.' : this._sidekickErrorMsg;
      return html`
        <div class="card">
          <p class="card-title">Step 3 — Configure Sidekick</p>
          <p class="error-msg">❌ ${msg}</p>
          ${this._sidekickErrorSource === 'write' ? html`
            <a class="remediation-link" href="https://www.aem.live/developer/sidekick-development#custom-edit-urls" target="_blank">
              View sidekick configuration docs →
            </a>` : html`
            <div class="cta-bar">
              <sl-button class="ew-quiet-secondary" @click=${() => this._readSidekickConfig()}>Retry</sl-button>
            </div>`}
        </div>`;
    }

    return nothing;
  }

  render() {
    const canContinue = !!parseOrgSite(this._orgSiteInput);
    return html`
      <p class="app-title">Enable Experience Workspace</p>
      <p class="app-intro">
        This app helps you enable your current project for Experience Workspace in two simple steps.
        It is meant to be run once per project, but can also be used as a checker to verify that
        your project is ready for Experience Workspace.<br>
        Note: enabling a project requires the current user to have permissions to modify the DA org-level config
        and EDS config admin permissions to update the sidekick configuration.
      </p>

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
      ${this._step === 3 ? this._renderStep3() : nothing}
      ${this._renderWarningDialog()}
    `;
  }
}

customElements.define('ew-setup-app', EwSetupApp);
