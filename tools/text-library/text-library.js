import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { mountTextLibrary } from './library.js';

const root = document.querySelector('#text-library');

try {
  const destroy = mountTextLibrary(root, await DA_SDK);
  window.addEventListener('pagehide', destroy, { once: true });
} catch (error) {
  root.textContent = `Unable to start Text Library: ${error.message}`;
}
