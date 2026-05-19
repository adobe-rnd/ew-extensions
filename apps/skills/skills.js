import { initAuth } from './utils/da-fetch.js';
import './nx-skills-editor.js';

export default async function decorate(block) {
  block.textContent = '';
  const editor = document.createElement('nx-skills-editor');
  block.append(editor);

  if (window.self !== window.top) {
    const { default: DA_SDK } = await import('https://da.live/nx/utils/sdk.js');
    const { token } = await DA_SDK;
    initAuth(token);
  }
}
