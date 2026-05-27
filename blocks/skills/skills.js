import { initAuth } from './utils/da-fetch.js';
import './nx-skills-editor.js';

const SAFE_NX_PARAM = /^[a-z0-9][a-z0-9-]{0,62}$/;
const CHAT_PATH = '/nx2/blocks/chat/chat.js';

function resolveChatUrl() {
  const { search } = window.location;
  const nxParam = new URLSearchParams(search).get('nx');
  if (!nxParam) return `https://da.live${CHAT_PATH}`;
  if (nxParam === 'local') return `http://localhost:6456${CHAT_PATH}`;
  if (!SAFE_NX_PARAM.test(nxParam)) return `https://da.live${CHAT_PATH}`;
  return `https://${nxParam}--da-nx--adobe.aem.live${CHAT_PATH}`;
}

export default function decorate(block) {
  const token = window.adobeIMS?.getAccessToken()?.token;
  if (token) initAuth(token);
  block.textContent = '';
  const el = document.createElement('nx-skills-editor');
  el.setAttribute('chat-import-url', resolveChatUrl());
  el.setAttribute('chat-agent-id', 'skills-engineer');
  block.append(el);
}
