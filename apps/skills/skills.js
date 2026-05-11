/**
 * DA Skills Editor — app bootstrap.
 *
 * Two modes:
 *   1. Shell mode  — loaded inside da-live iframe; SDK delivers token + context.
 *   2. Standalone  — opened directly in a browser tab; falls back to IMS auth
 *                    and reads org/site from the URL hash (#/org/site).
 */
import { initAuth } from './utils/da-fetch.js';
import './nx-skills-editor.js';

const SDK_TIMEOUT_MS = 2000;
const IMS_LIB_URL = 'https://auth.services.adobe.com/imslib/imslib.min.js';
const IMS_CLIENT_ID = 'nexter';
const IMS_SCOPE = 'ab.manage,AdobeID,gnav,openid,org.read,read_organizations,session,additional_info.ownerOrg,additional_info.projectedProductContext,account_cluster.read';

/**
 * Try the SDK handshake (shell sends a postMessage with token + context).
 * Resolves on success, rejects on timeout.
 */
function waitForSdk(ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SDK timeout')), ms);
    window.addEventListener('message', (e) => {
      if (e.data?.token) {
        clearTimeout(timer);
        resolve(e.data);
      }
    });
  });
}

/**
 * Standalone IMS login — loads adobeIMS lib and gets an access token.
 */
function loginWithIms() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('IMS timeout')), 8000);
    window.adobeid = {
      client_id: IMS_CLIENT_ID,
      scope: IMS_SCOPE,
      locale: 'en_US',
      autoValidateToken: true,
      environment: 'prod',
      useLocalStorage: true,
      onReady: () => {
        clearTimeout(timeout);
        const accessToken = window.adobeIMS?.getAccessToken();
        if (accessToken?.token) {
          resolve(accessToken.token);
        } else {
          window.adobeIMS.signIn();
        }
      },
      onError: (err) => {
        clearTimeout(timeout);
        reject(err);
      },
    };
    const script = document.createElement('script');
    script.src = IMS_LIB_URL;
    script.onerror = () => reject(new Error('Failed to load IMS lib'));
    document.head.append(script);
  });
}

(async function init() {
  let token;

  try {
    const sdk = await waitForSdk(SDK_TIMEOUT_MS);
    token = sdk.token;
  } catch {
    // Not in shell — standalone mode, use direct IMS
    token = await loginWithIms();
  }

  initAuth(token);
}());
