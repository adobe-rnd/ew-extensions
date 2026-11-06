import { expect } from '@esm-bundle/chai';
import {
  getSpacecatSessionToken,
  sessionTokenExpiry,
} from '../../../tools/brand-visibility/session-auth.js';

const NOW = 2_000_000_000_000;
const API_BASE = 'https://llmo.example/api/v1';

function jwt(exp) {
  const encode = (value) => btoa(JSON.stringify(value))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${encode({ alg: 'none' })}.${encode({ exp })}.signature`;
}

function memoryStorage() {
  let value = null;
  return {
    getItem: () => value,
    setItem: (_key, next) => { value = next; },
    removeItem: () => { value = null; },
  };
}

function okResponse(sessionToken) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ sessionToken }),
  };
}

describe('SpaceCat session authentication', () => {
  it('reads the expiry from the session JWT', () => {
    expect(sessionTokenExpiry(jwt(2_000_000_100))).to.equal(2_000_000_100_000);
    expect(sessionTokenExpiry('not-a-jwt')).to.be.null;
  });

  it('exchanges the access token using the documented login request', async () => {
    const token = jwt((NOW / 1000) + 3600);
    let request;
    const result = await getSpacecatSessionToken(`${API_BASE}/`, 'ims-token', {
      storage: memoryStorage(),
      now: () => NOW,
      fetchImpl: async (url, options) => {
        request = { url, options };
        return okResponse(token);
      },
    });

    expect(result).to.equal(token);
    expect(request.url).to.equal(`${API_BASE}/auth/login`);
    expect(request.options.method).to.equal('POST');
    expect(request.options.headers).to.deep.equal({ 'Content-Type': 'application/json' });
    expect(JSON.parse(request.options.body)).to.deep.equal({ accessToken: 'ims-token' });
  });

  it('reuses a cached session token while it is unexpired', async () => {
    const storage = memoryStorage();
    const token = jwt((NOW / 1000) + 3600);
    let exchanges = 0;
    const options = {
      storage,
      now: () => NOW,
      fetchImpl: async () => {
        exchanges += 1;
        return okResponse(token);
      },
    };

    expect(await getSpacecatSessionToken(API_BASE, 'ims-token', options)).to.equal(token);
    expect(await getSpacecatSessionToken(API_BASE, 'ims-token', options)).to.equal(token);
    expect(exchanges).to.equal(1);
  });

  it('exchanges again once the cached session token expires', async () => {
    const storage = memoryStorage();
    let currentTime = NOW;
    let exchanges = 0;
    const first = jwt((NOW / 1000) + 60);
    const second = jwt((NOW / 1000) + 7200);
    const options = {
      storage,
      now: () => currentTime,
      fetchImpl: async () => {
        exchanges += 1;
        return okResponse(exchanges === 1 ? first : second);
      },
    };

    expect(await getSpacecatSessionToken(API_BASE, 'ims-token', options)).to.equal(first);
    currentTime += 61_000;
    expect(await getSpacecatSessionToken(API_BASE, 'ims-token', options)).to.equal(second);
    expect(exchanges).to.equal(2);
  });

  it('does not reuse a session token for a different access token', async () => {
    const storage = memoryStorage();
    let exchanges = 0;
    const fetchImpl = async () => {
      exchanges += 1;
      return okResponse(jwt((NOW / 1000) + 3600 + exchanges));
    };

    await getSpacecatSessionToken(API_BASE, 'first-user', { storage, fetchImpl, now: () => NOW });
    await getSpacecatSessionToken(API_BASE, 'second-user', { storage, fetchImpl, now: () => NOW });
    expect(exchanges).to.equal(2);
  });

  it('still exchanges when browser storage is unavailable', async () => {
    const token = jwt((NOW / 1000) + 3600);
    const storage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    };

    const result = await getSpacecatSessionToken(API_BASE, 'ims-token', {
      storage,
      now: () => NOW,
      fetchImpl: async () => okResponse(token),
    });
    expect(result).to.equal(token);
  });

  it('rejects a successful response that has no session token', async () => {
    let error;
    try {
      await getSpacecatSessionToken(API_BASE, 'ims-token', {
        storage: memoryStorage(),
        fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }),
      });
    } catch (caught) {
      error = caught;
    }
    expect(error?.message).to.equal('Session token exchange returned no session token');
  });
});
