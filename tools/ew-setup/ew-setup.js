import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { LitElement, html, css, nothing } from 'da-lit';
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

  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
      background: #1a1a1a;
      color: #fff;
      font-family: adobe-clean, 'Source Sans Pro', -apple-system, BlinkMacSystemFont, sans-serif;
      padding: 40px 24px;
      box-sizing: border-box;
    }
    .app-title { font-size: 24px; font-weight: 700; margin: 0 0 32px; }

    .org-site-row { display: flex; gap: 12px; align-items: center; margin-bottom: 32px; max-width: 600px; }
    .org-site-input {
      flex: 1; background: #2a2a2a; border: 1px solid #3a3a3a; border-radius: 6px;
      color: #fff; font-size: 14px; padding: 8px 12px; outline: none;
    }
    .org-site-input:focus { border-color: #666; }

    .steps { display: flex; gap: 8px; align-items: center; margin-bottom: 24px; }
    .step-badge {
      width: 28px; height: 28px; border-radius: 50%; display: flex;
      align-items: center; justify-content: center; font-size: 13px; font-weight: 600;
      border: 2px solid #555; color: #555; flex-shrink: 0;
    }
    .step-badge.active { background: #eb1000; border-color: #eb1000; color: #fff; }
    .step-badge.done   { border-color: #4caf50; color: #4caf50; }
    .step-label { font-size: 13px; color: #888; }
    .step-label.active { color: #fff; }
    .step-divider { flex: 0 0 32px; height: 1px; background: #3a3a3a; }

    .card { background: #2a2a2a; border: 1px solid #3a3a3a; border-radius: 10px; padding: 28px; max-width: 600px; }
    .card-title { font-size: 18px; font-weight: 600; margin: 0 0 20px; }

    .check-row {
      display: flex; align-items: flex-start; gap: 12px;
      padding: 12px 0; border-bottom: 1px solid #3a3a3a;
    }
    .check-row:last-of-type { border-bottom: none; }
    .check-icon { font-size: 18px; flex-shrink: 0; margin-top: 1px; }
    .check-label { font-size: 14px; font-weight: 500; }
    .check-error { font-size: 13px; color: #ff6b6b; margin-top: 4px; }
    .remediation-link { display: inline-block; margin-top: 6px; font-size: 13px; color: #eb1000; }

    .cta-bar { margin-top: 24px; display: flex; gap: 12px; align-items: center; }
    .btn-primary {
      background: #eb1000; color: #fff; border: none; border-radius: 20px;
      padding: 10px 24px; font-size: 14px; font-weight: 600; cursor: pointer;
    }
    .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-secondary {
      background: #3a3a3a; color: #fff; border: none; border-radius: 20px;
      padding: 10px 24px; font-size: 14px; cursor: pointer;
    }

    .config-snippet {
      background: #111; border: 1px solid #3a3a3a; border-radius: 6px;
      padding: 12px; font-family: monospace; font-size: 13px;
      margin: 12px 0; white-space: pre-wrap; word-break: break-all;
    }
    .success-msg { color: #4caf50; font-size: 14px; margin: 0 0 12px; }
    .error-msg   { color: #ff6b6b; font-size: 14px; line-height: 1.5; }

    .spinner {
      width: 18px; height: 18px; border: 2px solid #444; border-top-color: #eb1000;
      border-radius: 50%; animation: spin 0.7s linear infinite; flex-shrink: 0;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  `;

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
  }

  connectedCallback() {
    super.connectedCallback();
    this._init();
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

  render() {
    return html`<p class="app-title">Enable Experience Workspace</p><p>Loading…</p>`;
  }
}

customElements.define('ew-setup-app', EwSetupApp);
