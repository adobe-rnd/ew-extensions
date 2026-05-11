import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { initAuth } from './utils/da-fetch.js';
import './nx-skills-editor.js';

(async function init() {
  const { context, token } = await DA_SDK;
  initAuth(token);
}());
