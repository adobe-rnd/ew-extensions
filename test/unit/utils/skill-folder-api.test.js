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
  const isOk = ok !== undefined ? ok : status >= 200 && status < 300;
  return {
    ok: isOk,
    status,
    statusText: '',
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (json !== null ? json : (typeof body === 'string' ? JSON.parse(body || 'null') : body)),
  };
}

// Scoped fetch mock: always restores even when beforeEach throws.
const realFetch = window.fetch;
let fetchHandler = null;
const fetchCalls = [];

function installMock() {
  fetchCalls.length = 0;
  fetchHandler = null;
  window.fetch = async (url, opts = {}) => {
    const entry = { url: String(url), method: (opts.method || 'GET').toUpperCase(), opts };
    fetchCalls.push(entry);
    return fetchHandler ? fetchHandler(entry) : mockResponse({ status: 404, ok: false });
  };
}

function removeMock() {
  window.fetch = realFetch;
  fetchHandler = null;
  fetchCalls.length = 0;
}

beforeEach(installMock);
afterEach(removeMock);

describe('skill-folder-api: constants', () => {
  it('points at the .da/skills folder', () => {
    expect(SKILLS_FOLDER_BASE).to.equal('.da/skills');
    expect(SKILL_BODY_FILENAME).to.equal('skill.md');
  });

  it('keeps snapshot disabled until da-admin supports markdown', () => {
    expect(SNAPSHOT_ON_SAVE_ENABLED).to.equal(false);
  });
});

describe('writeSkillFolderMd', () => {
  it('PUTs to .da/skills/<id>/skill.md and returns ok', async () => {
    fetchHandler = ({ url, method }) => {
      expect(url).to.include(`/source/${ORG}/${SITE}/.da/skills/my-skill/skill.md`);
      expect(method).to.equal('PUT');
      return mockResponse({ status: 201 });
    };
    const result = await writeSkillFolderMd(ORG, SITE, 'my-skill', '# Body');
    expect(result.ok).to.be.true;
    expect(result.status).to.equal(201);
    expect(fetchCalls).to.have.lengthOf(1);
  });

  it('rejects unsafe skill ids without making a network call', async () => {
    const result = await writeSkillFolderMd(ORG, SITE, '../escape', 'body');
    expect(result.ok).to.be.false;
    expect(fetchCalls).to.have.lengthOf(0);
  });

  it('rejects empty ids', async () => {
    const result = await writeSkillFolderMd(ORG, SITE, '', 'body');
    expect(result.ok).to.be.false;
    expect(fetchCalls).to.have.lengthOf(0);
  });

  it('propagates non-2xx status', async () => {
    fetchHandler = () => mockResponse({ status: 500, ok: false });
    const result = await writeSkillFolderMd(ORG, SITE, 'ok', 'body');
    expect(result.ok).to.be.false;
    expect(result.status).to.equal(500);
  });
});

describe('readSkillFolderMd', () => {
  it('GETs skill.md and returns text', async () => {
    fetchHandler = ({ url, method }) => {
      expect(method).to.equal('GET');
      expect(url).to.include(`/source/${ORG}/${SITE}/.da/skills/foo/skill.md`);
      return mockResponse({ status: 200, body: '---\nname: foo\n---\n\nbody' });
    };
    const result = await readSkillFolderMd(ORG, SITE, 'foo');
    expect(result.text).to.include('name: foo');
    expect(result.status).to.equal(200);
  });

  it('returns empty text on 404', async () => {
    fetchHandler = () => mockResponse({ status: 404, ok: false });
    const result = await readSkillFolderMd(ORG, SITE, 'gone');
    expect(result.text).to.equal('');
    expect(result.status).to.equal(404);
  });

  it('returns empty text on unsafe id without fetching', async () => {
    const result = await readSkillFolderMd(ORG, SITE, '../bad');
    expect(result.text).to.equal('');
    expect(fetchCalls).to.have.lengthOf(0);
  });
});

describe('deleteSkillFolder', () => {
  it('DELETEs the folder path (no .md extension)', async () => {
    fetchHandler = ({ url, method }) => {
      expect(method).to.equal('DELETE');
      expect(url).to.include(`/source/${ORG}/${SITE}/.da/skills/foo`);
      expect(url).to.not.include('skill.md');
      return mockResponse({ status: 204 });
    };
    const result = await deleteSkillFolder(ORG, SITE, 'foo');
    expect(result.ok).to.be.true;
    expect(result.deleted).to.be.true;
    expect(result.wasMissing).to.be.false;
  });

  it('treats 404 as ok=true with wasMissing=true', async () => {
    fetchHandler = () => mockResponse({ status: 404, ok: false });
    const result = await deleteSkillFolder(ORG, SITE, 'foo');
    expect(result.ok).to.be.true;
    expect(result.wasMissing).to.be.true;
    expect(result.deleted).to.be.false;
  });

  it('rejects unsafe ids without fetching', async () => {
    const result = await deleteSkillFolder(ORG, SITE, '..');
    expect(result.ok).to.be.false;
    expect(fetchCalls).to.have.lengthOf(0);
  });
});

describe('snapshotSkillVersion', () => {
  it('POSTs to /versionsource path', async () => {
    fetchHandler = ({ url, method }) => {
      expect(method).to.equal('POST');
      expect(url).to.include(`/versionsource/${ORG}/${SITE}/.da/skills/foo/skill.md`);
      return mockResponse({ status: 200 });
    };
    const result = await snapshotSkillVersion(ORG, SITE, 'foo');
    expect(result.ok).to.be.true;
  });

  it('rejects empty ids without fetching', async () => {
    const result = await snapshotSkillVersion(ORG, SITE, '');
    expect(result.ok).to.be.false;
    expect(fetchCalls).to.have.lengthOf(0);
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
      alpha: '---\nname: alpha\ndescription: A skill\nversion: 3\nstatus: approved\n---\n\n# Alpha',
      beta: '---\nname: beta\ndescription: B skill\nversion: 1\nstatus: draft\n---\n\n# Beta',
    };
    fetchHandler = ({ url }) => {
      if (url.includes('/list/')) return mockResponse({ status: 200, json: listPayload });
      const match = url.match(/\/source\/.*\/\.da\/skills\/([^/]+)\/skill\.md$/);
      if (match) {
        const id = match[1];
        return bodies[id]
          ? mockResponse({ status: 200, body: bodies[id] })
          : mockResponse({ status: 404, ok: false });
      }
      return mockResponse({ status: 500 });
    };
    const { entries, listFailed } = await listSkillFolders(ORG, SITE);
    expect(listFailed).to.be.false;
    expect(entries).to.have.lengthOf(2);
    const byId = Object.fromEntries(entries.map((e) => [e.id, e]));
    expect(byId.alpha).to.deep.include({ id: 'alpha', description: 'A skill', version: 3, status: 'approved' });
    expect(byId.beta).to.deep.include({ id: 'beta', description: 'B skill', version: 1, status: 'draft' });
  });

  it('skips folders whose skill.md cannot be loaded', async () => {
    fetchHandler = ({ url }) => {
      if (url.includes('/list/')) return mockResponse({ status: 200, json: [{ name: 'orphan', path: 'x' }] });
      return mockResponse({ status: 404, ok: false });
    };
    const { entries } = await listSkillFolders(ORG, SITE);
    expect(entries).to.deep.equal([]);
  });

  it('returns listFailed=false + empty entries on 4xx (treat as no skills yet)', async () => {
    fetchHandler = () => mockResponse({ status: 403, ok: false });
    const result = await listSkillFolders(ORG, SITE);
    expect(result.listFailed).to.be.false;
    expect(result.entries).to.deep.equal([]);
    expect(result.status).to.equal(403);
  });

  it('returns listFailed=true on 5xx so editor can show error banner', async () => {
    fetchHandler = () => mockResponse({ status: 503, ok: false });
    const result = await listSkillFolders(ORG, SITE);
    expect(result.listFailed).to.be.true;
    expect(result.entries).to.deep.equal([]);
  });

  it('accepts list payload shaped as { items: [...] }', async () => {
    fetchHandler = ({ url }) => {
      if (url.includes('/list/')) return mockResponse({ status: 200, json: { items: [{ name: 'wrapped', path: 'x' }] } });
      return mockResponse({ status: 200, body: '---\nname: wrapped\ndescription: ok\nversion: 1\n---\n\nBody' });
    };
    const { entries } = await listSkillFolders(ORG, SITE);
    expect(entries).to.have.lengthOf(1);
    expect(entries[0].id).to.equal('wrapped');
  });

  it('filters out unsafe-id folders', async () => {
    fetchHandler = ({ url }) => {
      if (url.includes('/list/')) {
        return mockResponse({ status: 200, json: [{ name: '..', path: 'x' }, { name: 'has space', path: 'x' }, { name: 'good', path: 'x' }] });
      }
      return mockResponse({ status: 200, body: '---\nname: good\ndescription: ok\nversion: 1\n---\n\nBody' });
    };
    const { entries } = await listSkillFolders(ORG, SITE);
    expect(entries).to.have.lengthOf(1);
    expect(entries[0].id).to.equal('good');
  });
});
