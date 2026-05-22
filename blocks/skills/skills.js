import { initAuth } from './utils/da-fetch.js';
import './nx-skills-editor.js';

const SAFE_NX_PARAM = /^[a-z0-9][a-z0-9-]{0,62}$/;

function resolveChatUrl() {
  const { origin, search } = window.location;
  const nxParam = new URLSearchParams(search).get('nx');
  if (!nxParam) return `${origin}/nx2/blocks/chat/chat.js`;
  if (nxParam === 'local') return 'http://localhost:6456/nx2/blocks/chat/chat.js';
  if (!SAFE_NX_PARAM.test(nxParam)) return `${origin}/nx2/blocks/chat/chat.js`;
  return `https://${nxParam}--da-nx--adobe.aem.live/nx2/blocks/chat/chat.js`;
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
