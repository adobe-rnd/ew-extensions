/**
 * DA Skills Editor — app bootstrap.
 *
 * Waits for the DA App SDK to deliver auth token + context, then
 * initialises the shared daFetch wrapper and mounts the editor.
 */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { initAuth } from './utils/da-fetch.js';
import './nx-skills-editor.js';

(async function init() {
  const { context, token } = await DA_SDK;
  initAuth(token);

  const editor = document.querySelector('nx-skills-editor');
  if (editor && context) {
    editor.sdkContext = context;
  }
}());
