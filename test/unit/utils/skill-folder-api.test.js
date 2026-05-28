import { expect } from '@esm-bundle/chai';
import {
  SKILLS_FOLDER_BASE,
  SKILL_BODY_FILENAME,
  SNAPSHOT_ON_SAVE_ENABLED,
  writeSkillFolderMd,
  readSkillFolderMd,
  deleteSkillFolder,
  snapshotSkillVersion,
  listSkillFolders,
} from '../../../blocks/skills/utils/skill-folder-api.js';

const ORG = 'adobe';
const SITE = 'aem-marketing';

function mockResponse({
  status = 200, body = '', json = null, ok = undefined,
} = {}) {
  return {
    ok: ok !== undefined ? ok : status >= 200 && status < 300,
    status,
    statusText: '',
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (json !== null ? json : (typeof body === 'string' ? JSON.parse(body || 'null') : body)),
  };
}

function installFetchMock() {
  const calls = [];
  const realFetch = window.fetch;
  const mock = async (url, opts = {}) => {
    const entry = { url: String(url), method: (opts.method || 'GET').toUpperCase(), opts };
    const handler = mock.handler;
    if (!handler) {
      calls.push({ ...entry, responded: 404 });
      return mockResponse({ status: 404 });
    }
    const reply = await handler(entry);
    calls.push({ ...entry, responded: reply.status });
    return reply;
  };
  mock.handler = null;
  mock.calls = calls;
  mock.restore = () => { window.fetch = realFetch; };
  window.fetch = mock;
  return mock;
}

let fetchMock;

beforeEach(() => {
  fetchMock = installFetchMock();
});

afterEach(() => {
  fetchMock.restore();
  fetchMock = null;
});

describe('skill-folder-api: constants', () => {
  it('points at the .da/skills folder by default', () => {
    expect(SKILLS_FOLDER_BASE).to.equal('.da/skills');
    expect(SKILL_BODY_FILENAME).to.equal('skill.md');
  });

  it('keeps the /versionsource snapshot disabled until da-admin supports markdown', () => {
    expect(SNAPSHOT_ON_SAVE_ENABLED).to.equal(false);
  });
});

describe('writeSkillFolderMd', () => {
  it('PUTs to .da/skills/<id>/skill.md and returns ok', async () => {
    fetchMock.handler = ({ url, method }) => {
      expect(url).to.include(`/source/${ORG}/${SITE}/.da/skills/my-skill/skill.md`);
      expect(method).to.equal('PUT');
      return mockResponse({ status: 201 });
    };
    const result = await writeSkillFolderMd(ORG, SITE, 'my-skill', '# Body');
    expect(result.ok).to.be.true;
    expect(result.status).to.equal(201);
    expect(fetchMock.calls).to.have.lengthOf(1);
  });

  it('rejects unsafe skill ids without making a network call', async () => {
    fetchMock.handler = () => mockResponse({ status: 200 });
    const result = await writeSkillFolderMd(ORG, SITE, '../escape', 'body');
    expect(result.ok).to.be.false;
    expect(fetchMock.calls).to.have.lengthOf(0);
  });

  it('rejects empty ids', async () => {
    const result = await writeSkillFolderMd(ORG, SITE, '', 'body');
    expect(result.ok).to.be.false;
    expect(fetchMock.calls).to.have.lengthOf(0);
  });

  it('propagates non-2xx status', async () => {
    fetchMock.handler = () => mockResponse({ status: 500, ok: false });
    const result = await writeSkillFolderMd(ORG, SITE, 'ok', 'body');
    expect(result.ok).to.be.false;
    expect(result.status).to.equal(500);
  });
});

describe('readSkillFolderMd', () => {
  it('GETs skill.md and returns text', async () => {
    fetchMock.handler = ({ url, method }) => {
      expect(method).to.equal('GET');
      expect(url).to.include(`/source/${ORG}/${SITE}/.da/skills/foo/skill.md`);
      return mockResponse({ status: 200, body: '---\nname: foo\n---\n\nbody' });
    };
    const result = await readSkillFolderMd(ORG, SITE, 'foo');
    expect(result.text).to.include('name: foo');
    expect(result.status).to.equal(200);
  });

  it('returns empty text on 404', async () => {
    fetchMock.handler = () => mockResponse({ status: 404, ok: false });
    const result = await readSkillFolderMd(ORG, SITE, 'gone');
    expect(result.text).to.equal('');
    expect(result.status).to.equal(404);
  });

  it('returns empty text on unsafe id without fetching', async () => {
    fetchMock.handler = () => { throw new Error('should not be called'); };
    const result = await readSkillFolderMd(ORG, SITE, '../bad');
    expect(result.text).to.equal('');
    expect(fetchMock.calls).to.have.lengthOf(0);
  });
});

describe('deleteSkillFolder', () => {
  it('DELETEs the folder path (no extension)', async () => {
    fetchMock.handler = ({ url, method }) => {
      expect(method).to.equal('DELETE');
      expect(url).to.include(`/source/${ORG}/${SITE}/.da/skills/foo`);
      expect(url).to.not.include('skill.md');
      return mockResponse({ status: 204 });
    };
    const result = await deleteSkillFolder(ORG, SITE, 'foo');
    expect(result.ok).to.be.true;
  });

  it('treats 404 as success (already gone)', async () => {
    fetchMock.handler = () => mockResponse({ status: 404, ok: false });
    const result = await deleteSkillFolder(ORG, SITE, 'foo');
    expect(result.ok).to.be.true;
  });

  it('rejects unsafe ids without fetching', async () => {
    const result = await deleteSkillFolder(ORG, SITE, '..');
    expect(result.ok).to.be.false;
    expect(fetchMock.calls).to.have.lengthOf(0);
  });
});

describe('snapshotSkillVersion', () => {
  it('POSTs to /versionsource and returns ok regardless of markdown limitation', async () => {
    fetchMock.handler = ({ url, method }) => {
      expect(method).to.equal('POST');
      expect(url).to.include(`/versionsource/${ORG}/${SITE}/.da/skills/foo/skill.md`);
      return mockResponse({ status: 200 });
    };
    const result = await snapshotSkillVersion(ORG, SITE, 'foo');
    expect(result.ok).to.be.true;
    expect(result.status).to.equal(200);
  });

  it('rejects unsafe ids without fetching', async () => {
    const result = await snapshotSkillVersion(ORG, SITE, '');
    expect(result.ok).to.be.false;
    expect(fetchMock.calls).to.have.lengthOf(0);
  });
});

describe('listSkillFolders', () => {
  it('lists subdirectories, fetches each skill.md, returns manifest entries', async () => {
    const listPayload = [
      { name: 'alpha', path: `/${ORG}/${SITE}/.da/skills/alpha` },
      { name: 'beta', path: `/${ORG}/${SITE}/.da/skills/beta`, ext: '' },
      { name: 'README.md', path: `/${ORG}/${SITE}/.da/skills/README.md`, ext: 'md' },
    ];
    const bodies = {
      alpha: '---\nname: alpha\ndescription: A skill\nversion: 3\nstatus: approved\n---\n\n# Alpha\nBody',
      beta: '---\nname: beta\ndescription: B skill\nversion: 1\nstatus: draft\n---\n\n# Beta\nBody',
    };

    fetchMock.handler = ({ url, method }) => {
      if (url.includes('/list/')) {
        expect(method).to.equal('GET');
        return mockResponse({ status: 200, json: listPayload });
      }
      const match = url.match(/\/source\/.*\/\.da\/skills\/([^/]+)\/skill\.md$/);
      if (match) {
        const id = match[1];
        if (bodies[id]) return mockResponse({ status: 200, body: bodies[id] });
        return mockResponse({ status: 404, ok: false });
      }
      return mockResponse({ status: 500 });
    };

    const entries = await listSkillFolders(ORG, SITE);
    expect(entries).to.have.lengthOf(2);
    const byId = Object.fromEntries(entries.map((e) => [e.id, e]));
    expect(byId.alpha).to.deep.include({
      id: 'alpha', name: 'alpha', description: 'A skill', version: 3, status: 'approved',
    });
    expect(byId.beta).to.deep.include({
      id: 'beta', name: 'beta', description: 'B skill', version: 1, status: 'draft',
    });
  });

  it('skips folders whose skill.md cannot be loaded', async () => {
    fetchMock.handler = ({ url }) => {
      if (url.includes('/list/')) {
        return mockResponse({ status: 200, json: [{ name: 'orphan', path: 'x' }] });
      }
      return mockResponse({ status: 404, ok: false });
    };
    const entries = await listSkillFolders(ORG, SITE);
    expect(entries).to.deep.equal([]);
  });

  it('returns empty on list 4xx without fetching individual skills', async () => {
    let listCalls = 0;
    let sourceCalls = 0;
    fetchMock.handler = ({ url }) => {
      if (url.includes('/list/')) {
        listCalls += 1;
        return mockResponse({ status: 403, ok: false });
      }
      sourceCalls += 1;
      return mockResponse({ status: 200, body: '' });
    };
    const entries = await listSkillFolders(ORG, SITE);
    expect(entries).to.deep.equal([]);
    expect(listCalls).to.equal(1);
    expect(sourceCalls).to.equal(0);
  });

  it('accepts list payload shaped as { items: [...] }', async () => {
    fetchMock.handler = ({ url }) => {
      if (url.includes('/list/')) {
        return mockResponse({ status: 200, json: { items: [{ name: 'wrapped', path: 'x' }] } });
      }
      return mockResponse({
        status: 200,
        body: '---\nname: wrapped\ndescription: ok\nversion: 1\n---\n\nBody',
      });
    };
    const entries = await listSkillFolders(ORG, SITE);
    expect(entries).to.have.lengthOf(1);
    expect(entries[0].id).to.equal('wrapped');
  });

  it('filters out unsafe-id folders', async () => {
    fetchMock.handler = ({ url }) => {
      if (url.includes('/list/')) {
        return mockResponse({
          status: 200,
          json: [
            { name: '..', path: 'x' },
            { name: 'has space', path: 'x' },
            { name: 'good', path: 'x' },
          ],
        });
      }
      return mockResponse({
        status: 200, body: '---\nname: good\ndescription: ok\nversion: 1\n---\n\nBody',
      });
    };
    const entries = await listSkillFolders(ORG, SITE);
    expect(entries).to.have.lengthOf(1);
    expect(entries[0].id).to.equal('good');
  });
});
