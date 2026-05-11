/**
 * Communication bridge between da-skills and da-nx chat.
 *
 * Supports three transports (checked in order):
 *   1. BroadcastChannel  — future-ready, works across tabs + iframes (same origin)
 *   2. sessionStorage     — legacy compat with current da-nx chat (same origin, cross-tab via storage event)
 *   3. window events      — fallback for same-document usage (e.g. testing)
 *
 * da-skills always LISTENS on all available transports.
 * da-skills always SENDS on BroadcastChannel + sessionStorage (for legacy da-nx chat).
 */

const CHANNEL_NAME = 'da-skills-editor';

const SESSION_KEYS = {
  suggestion: 'da-skills-editor-suggestion',
  legacySuggestion: 'da-skills-lab-suggest-handoff',
  nav: (org, site) => `da-skills-editor-nav:${org}/${site}`,
  data: (org, site) => `da-skills-editor-data:${org}/${site}`,
};

const EVENT_NAMES = {
  suggestionHandoff: 'da-skills-editor-suggestion-handoff',
  legacySuggestionHandoff: 'da-skills-lab-suggestion-handoff',
  clearForm: 'da-skills-editor-clear-form-from-chat',
  legacyClearForm: 'da-skills-lab-clear-form-from-chat',
  formDismiss: 'da-skills-editor-form-dismiss',
  legacyFormDismiss: 'da-skills-lab-form-dismiss',
  promptSend: 'da-skills-editor-prompt-send',
  legacyPromptSend: 'da-skills-lab-prompt-send',
  promptAdd: 'da-skills-editor-prompt-add-to-chat',
  legacyPromptAdd: 'da-skills-lab-prompt-add-to-chat',
};

let _bc = null;
const _listeners = new Map();

function getBroadcastChannel() {
  if (!_bc && typeof BroadcastChannel !== 'undefined') {
    _bc = new BroadcastChannel(CHANNEL_NAME);
    _bc.onmessage = (e) => {
      const { type, payload } = e.data ?? {};
      const fns = _listeners.get(type);
      if (fns) fns.forEach((fn) => fn(payload));
    };
  }
  return _bc;
}

/**
 * Listen for a message type from chat.
 * @param {string} type — e.g. 'suggestion-handoff', 'clear-form'
 * @param {(payload: any) => void} callback
 * @returns {() => void} unsubscribe
 */
export function onMessage(type, callback) {
  getBroadcastChannel();
  if (!_listeners.has(type)) _listeners.set(type, new Set());
  _listeners.get(type).add(callback);
  return () => _listeners.get(type)?.delete(callback);
}

/**
 * Send a message to chat.
 * Posts on BroadcastChannel (for future da-nx) AND dispatches a window
 * CustomEvent (for legacy da-nx that listens on window).
 *
 * @param {string} type — e.g. 'prompt-send', 'form-dismiss'
 * @param {any} [payload]
 */
export function sendMessage(type, payload) {
  const bc = getBroadcastChannel();
  if (bc) {
    try { bc.postMessage({ type, payload }); } catch { /* closed */ }
  }

  const eventMap = {
    'prompt-send': [EVENT_NAMES.promptSend, EVENT_NAMES.legacyPromptSend],
    'prompt-add': [EVENT_NAMES.promptAdd, EVENT_NAMES.legacyPromptAdd],
    'form-dismiss': [EVENT_NAMES.formDismiss, EVENT_NAMES.legacyFormDismiss],
  };

  const events = eventMap[type];
  if (events) {
    events.forEach((name) => {
      window.dispatchEvent(new CustomEvent(name, {
        detail: payload,
        bubbles: true,
      }));
    });
  }
}

/**
 * Consume a suggestion from sessionStorage (legacy da-nx chat writes here).
 * Returns the parsed suggestion or null.
 * @returns {{ prose: string, id: string, body: string } | null}
 */
export function consumeSuggestionFromStorage() {
  for (const key of [SESSION_KEYS.suggestion, SESSION_KEYS.legacySuggestion]) {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) continue;
      sessionStorage.removeItem(key);
      sessionStorage.removeItem(SESSION_KEYS.suggestion);
      sessionStorage.removeItem(SESSION_KEYS.legacySuggestion);
      return JSON.parse(raw);
    } catch { /* ignore */ }
  }
  return null;
}

/**
 * Read the navigation hint left by chat when opening the skills editor.
 * @param {string} org
 * @param {string} site
 * @returns {{ tab: string, editorOpen: boolean } | null}
 */
export function consumeNavHint(org, site) {
  const key = SESSION_KEYS.nav(org, site);
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    sessionStorage.removeItem(key);
    return JSON.parse(raw);
  } catch { return null; }
}

/**
 * Listen for cross-tab storage writes (legacy chat writes suggestion to sessionStorage).
 * @param {(suggestion: any) => void} callback
 * @returns {() => void} unsubscribe
 */
export function onStorageSuggestion(callback) {
  const handler = (e) => {
    if (e.key !== SESSION_KEYS.suggestion && e.key !== SESSION_KEYS.legacySuggestion) return;
    if (!e.newValue) return;
    try {
      const data = JSON.parse(e.newValue);
      callback(data);
    } catch { /* ignore */ }
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

export { SESSION_KEYS, EVENT_NAMES };
