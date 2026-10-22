import { initAuth } from './utils/da-fetch.js';
import './nx-skills-editor.js';

const SAFE_NX_PARAM = /^[a-z0-9][a-z0-9-]{0,62}$/;
const CHAT_PATH = '/nx2/blocks/chat/chat.js';
const CHAT_AO_PATH = '/nx2/blocks/chat-ao/chat-ao.js';

function resolveChatUrl(path) {
  const { search } = window.location;
  const nxParam = new URLSearchParams(search).get('nx');
  if (!nxParam) return `https://da.live${path}`;
  if (nxParam === 'local') return `http://localhost:6456${path}`;
  if (!SAFE_NX_PARAM.test(nxParam)) return `https://da.live${path}`;
  return `https://${nxParam}--da-nx--adobe.aem.live${path}`;
}

export default function decorate(block) {
  const token = window.adobeIMS?.getAccessToken()?.token;
  if (token) initAuth(token);
  block.textContent = '';
  const el = document.createElement('nx-skills-editor');
  // The da-agent chat (nx-chat) and the CMA/alt-harness chat (nx-chat-ao) are
  // separate components; the editor picks nx-chat-ao once it resolves the
  // site's `ew.altHarness` flag, so the embedded chat follows the same CMA
  // routing as canvas/browse instead of always talking to da-agent.
  el.setAttribute('chat-import-url', resolveChatUrl(CHAT_PATH));
  el.setAttribute('chat-ao-import-url', resolveChatUrl(CHAT_AO_PATH));
  el.setAttribute('chat-agent-id', 'skills-engineer');
  block.append(el);
}
