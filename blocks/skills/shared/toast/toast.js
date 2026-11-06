import { LitElement, html, nothing } from 'da-lit';
import { loadStyle } from '../../utils/utils.js';

export const VARIANT_SUCCESS = 'success';
export const VARIANT_ERROR = 'error';
export const VARIANT_WARNING = 'warning';

const styles = await loadStyle(import.meta.url);
const hostSheet = await loadStyle(new URL('toast-host.css', import.meta.url).href);

const HOST_ID = 'nx-skills-toast-host';
const MIN_DURATION = 4000;

function ensureHost() {
  if (!document.adoptedStyleSheets.includes(hostSheet)) {
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, hostSheet];
  }
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = HOST_ID;
    host.setAttribute('role', 'region');
    host.setAttribute('aria-label', 'Notifications');
    document.body.append(host);
  }
  return host;
}

class NxSkillsToast extends LitElement {
  static properties = {
    message: { attribute: false },
    variant: { attribute: false },
  };

  duration = MIN_DURATION;

  _timerId;

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [styles];
    this.style.pointerEvents = 'auto';
    if (this.duration !== null) {
      const ms = Math.max(MIN_DURATION, Number(this.duration) || MIN_DURATION);
      this._timerId = window.setTimeout(this.dismiss, ms);
    }
  }

  disconnectedCallback() {
    window.clearTimeout(this._timerId);
    this._timerId = undefined;
    super.disconnectedCallback();
  }

  dismiss = () => {
    window.clearTimeout(this._timerId);
    this._timerId = undefined;
    this.remove();
  };

  render() {
    const text = this.message?.trim();
    if (!text) return nothing;
    const isError = this.variant === VARIANT_ERROR;
    const isWarning = this.variant === VARIANT_WARNING;
    const variantClass = isError || isWarning ? this.variant : VARIANT_SUCCESS;
    const role = isError || isWarning ? 'alert' : 'status';
    return html`
      <div class="toast toast-${variantClass}" role=${role}>
        <p class="text">${text}</p>
        <button
          type="button"
          class="close"
          aria-label="Dismiss"
          @click=${this.dismiss}
        >
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M15.3 4.7a1 1 0 0 0-1.4 0L10 8.6 6.1 4.7a1 1 0 1 0-1.4 1.4L8.6 10l-3.9 3.9a1 1 0 1 0 1.4 1.4L10 11.4l3.9 3.9a1 1 0 0 0 1.4-1.4L11.4 10l3.9-3.9a1 1 0 0 0 0-1.4z" />
          </svg>
        </button>
      </div>
    `;
  }
}

if (!customElements.get('nx-skills-toast')) {
  customElements.define('nx-skills-toast', NxSkillsToast);
}

/**
 * Shows a transient toast notification anchored to a fixed host at the bottom
 * of the viewport. Mirrors nx2's shared/toast UX so user actions in the skills
 * editor get the same confirmation feedback as the rest of the app.
 *
 * @param {object} opts
 * @param {string} opts.text - message to display (ignored when empty)
 * @param {'success'|'error'|'warning'} [opts.variant='success']
 * @param {number|null} [opts.timeout=4000] - auto-dismiss ms (null = sticky)
 */
export function showToast({ text, variant = VARIANT_SUCCESS, timeout = MIN_DURATION } = {}) {
  const messageText = text?.trim();
  if (!messageText) return;
  const toast = document.createElement('nx-skills-toast');
  toast.message = messageText;
  toast.variant = [VARIANT_ERROR, VARIANT_WARNING].includes(variant) ? variant : VARIANT_SUCCESS;
  toast.duration = timeout;
  ensureHost().append(toast);
}
