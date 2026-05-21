import { initAuth } from './utils/da-fetch.js';
import './nx-skills-editor.js';

export default function decorate(block) {
  const token = window.adobeIMS?.getAccessToken()?.token;
  if (token) initAuth(token);
  block.textContent = '';
  block.append(document.createElement('nx-skills-editor'));
}
