import { expect } from '@esm-bundle/chai';
import {
  MIGRATION_VERSION,
  readMigrationMarker,
  acquireLease,
  releaseLease,
  migrateOneSkill,
  dropSkillsFromConfig,
  migrateSkillsIfNeeded,
} from '../../../blocks/skills/utils/skill-migration.js';

// ---------------------------------------------------------------------------
// Fetch mock infrastructure
// ---------------------------------------------------------------------------

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

function restoreMock() {
  window.fetch = realFetch;
  fetchCalls.length = 0;
  fetchHandler = null;
}

function mockResponse({ status = 200, body = '', ok = undefined } = {}) {
  const isOk = ok !== undefined ? ok : status >= 200 && status < 300;
  return {
    ok: isOk,
    status,
    statusText: '',
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body || 'null') : body),
  };
}

// ---------------------------------------------------------------------------
// localStorage mock (jsdom in WTR provides real localStorage, but let's
// ensure a clean state between tests)
// ---------------------------------------------------------------------------

function clearLeases() {
  Object.keys(localStorage)
    .filter((k) => k.startsWith('da-skills-migration:'))
    .forEach((k) => localStorage.removeItem(k));
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ORG = 'adobe';
const SITE = 'test-site';

// ---------------------------------------------------------------------------
// MIGRATION_VERSION
// ---------------------------------------------------------------------------

describe('MIGRATION_VERSION', () => {
  it('is a positive integer', () => {
    expect(MIGRATION_VERSION).to.be.a('number');
    expect(Number.isInteger(MIGRATION_VERSION)).to.be.true;
    expect(MIGRATION_VERSION).to.be.greaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// readMigrationMarker
// ---------------------------------------------------------------------------

describe('readMigrationMarker', () => {
  beforeEach(installMock);
  afterEach(restoreMock);

  it('returns null when marker file is 404', async () => {
    fetchHandler = () => mockResponse({ status: 404, ok: false });
    const result = await readMigrationMarker(ORG, SITE);
    expect(result).to.be.null;
  });

  it('returns the parsed marker when present', async () => {
    const marker = { migrationVersion: 1, completedAt: '2026-01-01T00:00:00Z', migratedIds: ['foo'] };
    fetchHandler = () => mockResponse({ body: JSON.stringify(marker) });
    const result = await readMigrationMarker(ORG, SITE);
    expect(result).to.deep.equal(marker);
  });

  it('returns null when response body is malformed JSON', async () => {
    fetchHandler = () => mockResponse({ body: 'not-json' });
    const result = await readMigrationMarker(ORG, SITE);
    expect(result).to.be.null;
  });
});

// ---------------------------------------------------------------------------
// acquireLease / releaseLease
// ---------------------------------------------------------------------------

describe('acquireLease / releaseLease', () => {
  beforeEach(clearLeases);
  afterEach(clearLeases);

  it('returns a non-empty string when lease is free', () => {
    const id = acquireLease(ORG, SITE);
    expect(id).to.be.a('string').and.not.empty;
  });

  it('returns null when a fresh lease is held by another caller', () => {
    acquireLease(ORG, SITE); // first acquirer
    const second = acquireLease(ORG, SITE);
    expect(second).to.be.null;
  });

  it('allows acquisition after the TTL has expired', () => {
    const leaseKey = `da-skills-migration:${ORG}/${SITE}`;
    const staleTs = Date.now() - 70_000; // 70 s ago → expired
    localStorage.setItem(leaseKey, JSON.stringify({ claimedAt: staleTs, claimedBy: 'old-id' }));
    const id = acquireLease(ORG, SITE);
    expect(id).to.be.a('string').and.not.empty;
  });

  it('releaseLease removes the entry when IDs match', () => {
    const id = acquireLease(ORG, SITE);
    releaseLease(ORG, SITE, id);
    const id2 = acquireLease(ORG, SITE);
    expect(id2).to.be.a('string').and.not.empty;
  });

  it('releaseLease is a no-op when IDs do not match', () => {
    acquireLease(ORG, SITE);
    releaseLease(ORG, SITE, 'wrong-id'); // should leave lease in place
    const again = acquireLease(ORG, SITE);
    expect(again).to.be.null;
  });
});

// ---------------------------------------------------------------------------
// dropSkillsFromConfig
// ---------------------------------------------------------------------------

describe('dropSkillsFromConfig', () => {
  it('removes the skills key', () => {
    const cfg = { skills: { data: [] }, mcp: {}, ':names': ['skills', 'mcp'] };
    const result = dropSkillsFromConfig(cfg);
    expect(result).to.not.have.property('skills');
  });

  it('removes skills from :names array', () => {
    const cfg = { skills: { data: [] }, ':names': ['skills', 'agents'] };
    const result = dropSkillsFromConfig(cfg);
    expect(result[':names']).to.deep.equal(['agents']);
  });

  it('leaves other sheet keys intact', () => {
    const cfg = { skills: {}, agents: { data: [] }, ':names': ['skills', 'agents'] };
    const result = dropSkillsFromConfig(cfg);
    expect(result).to.have.property('agents');
    expect(result[':names']).to.deep.equal(['agents']);
  });

  it('handles configs without :names gracefully', () => {
    const cfg = { skills: {} };
    const result = dropSkillsFromConfig(cfg);
    expect(result).to.not.have.property('skills');
  });

  it('does not mutate the input object', () => {
    const cfg = { skills: {}, ':names': ['skills'] };
    dropSkillsFromConfig(cfg);
    expect(cfg).to.have.property('skills');
  });
});

// ---------------------------------------------------------------------------
// migrateOneSkill
// ---------------------------------------------------------------------------

describe('migrateOneSkill', () => {
  beforeEach(installMock);
  afterEach(restoreMock);

  function mockWriteAndRead(writtenMarkdown) {
    fetchHandler = (req) => {
      if (req.method === 'PUT') return mockResponse({ status: 200 });
      if (req.method === 'GET') return mockResponse({ body: writtenMarkdown });
      return mockResponse({ status: 404, ok: false });
    };
  }

  it('returns ok:true for a happy-path migration', async () => {
    mockWriteAndRead('---\nname: brand-voice\ndescription: Brand voice guide\nversion: 1\nstatus: approved\n---\nBody here.');
    const result = await migrateOneSkill(ORG, SITE, 'brand-voice', 'Body here.', 'approved');
    expect(result.ok).to.be.true;
    expect(result.id).to.equal('brand-voice');
  });

  it('converts snake_case ID to kebab-case', async () => {
    mockWriteAndRead('---\nname: brand-voice\ndescription: Brand voice guide\nversion: 1\nstatus: approved\n---\nBody.');
    const result = await migrateOneSkill(ORG, SITE, 'brand_voice', 'Body.', 'approved');
    expect(result.ok).to.be.true;
    expect(result.id).to.equal('brand-voice');
  });

  it('returns ok:false when write fails', async () => {
    fetchHandler = () => mockResponse({ status: 500, ok: false });
    const result = await migrateOneSkill(ORG, SITE, 'my-skill', 'Body.', 'approved');
    expect(result.ok).to.be.false;
    expect(result.error).to.be.a('string');
  });

  it('returns ok:false when round-trip read returns empty', async () => {
    fetchHandler = (req) => {
      if (req.method === 'PUT') return mockResponse({ status: 200 });
      return mockResponse({ body: '' }); // empty read-back
    };
    const result = await migrateOneSkill(ORG, SITE, 'my-skill', 'Body.', 'approved');
    expect(result.ok).to.be.false;
    expect(result.error).to.include('round-trip');
  });

  it('includes frontmatter in the written skill', async () => {
    let writtenBody = '';
    fetchHandler = async (req) => {
      if (req.method === 'PUT') {
        const fd = req.opts?.body;
        if (fd instanceof FormData) {
          const blob = fd.get('data');
          if (blob?.text) writtenBody = await blob.text();
        }
        return mockResponse({ status: 200 });
      }
      return mockResponse({ body: writtenBody || '---\nname: x\n---\n' });
    };
    await migrateOneSkill(ORG, SITE, 'my-skill', 'The actual body content here.', 'approved');
    expect(writtenBody).to.include('---');
    expect(writtenBody).to.include('name:');
    expect(writtenBody).to.include('version:');
  });

  it('correctly escapes a description containing colons and quotes', async () => {
    let writtenBody = '';
    fetchHandler = async (req) => {
      if (req.method === 'PUT') {
        const fd = req.opts?.body;
        if (fd instanceof FormData) {
          const blob = fd.get('data');
          if (blob?.text) writtenBody = await blob.text();
        }
        return mockResponse({ status: 200 });
      }
      return mockResponse({ body: writtenBody || '---\nname: x\n---\n' });
    };
    const body = 'SEO tips: always use "short" titles.\n\nFull body here.';
    await migrateOneSkill(ORG, SITE, 'seo-tips', body, 'approved');
    // description must be present and non-empty (not silently dropped due to YAML parse failure)
    expect(writtenBody).to.include('description:');
    const descLine = writtenBody.split('\n').find((l) => l.startsWith('description:'));
    expect(descLine).to.be.a('string');
    expect(descLine.length).to.be.greaterThan('description:'.length + 1);
  });

  it('strips existing frontmatter from body before composing', async () => {
    let writtenBody = '';
    fetchHandler = async (req) => {
      if (req.method === 'PUT') {
        const fd = req.opts?.body;
        if (fd instanceof FormData) {
          const blob = fd.get('data');
          if (blob?.text) writtenBody = await blob.text();
        }
        return mockResponse({ status: 200 });
      }
      return mockResponse({ body: writtenBody || '---\nname: x\n---\n' });
    };
    // body already has stale frontmatter — should not produce double frontmatter
    const bodyWithFm = '---\nname: old-name\nversion: 5\n---\nActual content here.';
    await migrateOneSkill(ORG, SITE, 'my-skill', bodyWithFm, 'approved');
    const fmMatches = (writtenBody.match(/^---$/gm) || []).length;
    expect(fmMatches).to.equal(2); // exactly one open and one close delimiter
  });
});

// ---------------------------------------------------------------------------
// migrateSkillsIfNeeded — high-level integration
// ---------------------------------------------------------------------------

describe('migrateSkillsIfNeeded', () => {
  beforeEach(() => { installMock(); clearLeases(); });
  afterEach(() => { restoreMock(); clearLeases(); });

  it('skips when marker shows current version', async () => {
    fetchHandler = () => mockResponse({
      body: JSON.stringify({ migrationVersion: MIGRATION_VERSION, completedAt: '', migratedIds: [] }),
    });
    const result = await migrateSkillsIfNeeded(ORG, SITE);
    expect(result.skipped).to.be.true;
  });

  it('skips when another tab holds the lease', async () => {
    fetchHandler = (req) => {
      if (req.url.includes('.migrated.json')) return mockResponse({ status: 404, ok: false });
      return mockResponse({ body: JSON.stringify({ ':names': [] }) });
    };
    acquireLease(ORG, SITE); // claim lease in this tab first
    const result = await migrateSkillsIfNeeded(ORG, SITE);
    expect(result.skipped).to.be.true;
  });

  it('returns skipped:false and writes marker when there are no skills to migrate', async () => {
    const markerPuts = [];
    fetchHandler = (req) => {
      if (req.url.includes('.migrated.json') && req.method === 'GET') {
        return mockResponse({ status: 404, ok: false });
      }
      if (req.url.includes('.migrated.json') && req.method === 'PUT') {
        markerPuts.push(req.url);
        return mockResponse({ status: 200 });
      }
      if (req.url.includes('/list/')) return mockResponse({ body: JSON.stringify([]) });
      if (req.method === 'POST' && req.url.includes('/config/')) return mockResponse({ status: 200 });
      if (req.url.includes('/config/')) {
        return mockResponse({ body: JSON.stringify({ ':names': [], ':type': 'multi-sheet' }) });
      }
      return mockResponse({ status: 404, ok: false });
    };
    const result = await migrateSkillsIfNeeded(ORG, SITE);
    expect(result.skipped).to.be.false;
    expect(result.migratedIds).to.deep.equal([]);
    expect(result.failedIds).to.deep.equal([]);
    expect(result.markerWritten).to.be.true;
    expect(markerPuts.length).to.equal(1);
  });

  it('migrates skills from the config sheet to the folder layout', async () => {
    const sheetData = [
      { key: 'brand-voice', content: 'Brand tone and voice guidelines.', status: 'approved' },
      { key: 'seo-checklist', content: 'SEO checklist for editors.', status: 'approved' },
    ];
    const writtenFiles = {};
    const configPosts = [];

    fetchHandler = async (req) => {
      // marker read
      if (req.url.includes('.migrated.json') && req.method === 'GET') {
        return mockResponse({ status: 404, ok: false });
      }
      // marker write
      if (req.url.includes('.migrated.json') && req.method === 'PUT') {
        return mockResponse({ status: 200 });
      }
      // config sheet GET
      if (req.method === 'GET' && req.url.includes('/config/')) {
        return mockResponse({
          body: JSON.stringify({
            ':names': ['skills'],
            skills: { data: sheetData },
          }),
        });
      }
      // config sheet POST (saveDaConfig)
      if (req.method === 'POST' && req.url.includes('/config/')) {
        configPosts.push(req.url);
        return mockResponse({ status: 200 });
      }
      // list flat .md files — none in this test
      if (req.url.includes('/list/')) return mockResponse({ body: JSON.stringify([]) });
      // folder skill.md PUT (write)
      if (req.method === 'PUT' && req.url.includes('/skill.md')) {
        const skillId = req.url.split('/.da/skills/')[1]?.split('/')[0];
        const fd = req.opts?.body;
        if (fd instanceof FormData) {
          const blob = fd.get('data');
          if (blob?.text) writtenFiles[skillId] = await blob.text();
        }
        return mockResponse({ status: 200 });
      }
      // folder skill.md GET (round-trip verify)
      if (req.method === 'GET' && req.url.includes('/skill.md')) {
        const skillId = req.url.split('/.da/skills/')[1]?.split('/')[0];
        return mockResponse({ body: writtenFiles[skillId] || '---\nname: x\n---\n' });
      }
      // flat .md reads — return 404 (no flat files); must come after skill.md checks
      if (req.method === 'GET' && req.url.includes('/.da/skills/') && req.url.endsWith('.md')) {
        return mockResponse({ status: 404, ok: false });
      }
      return mockResponse({ status: 404, ok: false });
    };

    const result = await migrateSkillsIfNeeded(ORG, SITE);

    expect(result.skipped).to.be.false;
    expect(result.failedIds).to.deep.equal([]);
    expect(result.migratedIds).to.have.members(['brand-voice', 'seo-checklist']);
    expect(result.markerWritten).to.be.true;
    // sheet was dropped (saveDaConfig called)
    expect(configPosts.length).to.equal(1);
    // written files have frontmatter
    expect(writtenFiles['brand-voice']).to.include('name: brand-voice');
    expect(writtenFiles['brand-voice']).to.include('version:');
  });

  it('populates failedIds and does NOT drop the sheet when a skill write fails', async () => {
    const sheetData = [
      { key: 'good-skill', content: 'Works fine.', status: 'approved' },
      { key: 'bad-skill', content: 'This one will fail to write.', status: 'approved' },
    ];
    const writtenFiles = {};
    const configPosts = [];

    fetchHandler = async (req) => {
      if (req.url.includes('.migrated.json') && req.method === 'GET') {
        return mockResponse({ status: 404, ok: false });
      }
      if (req.url.includes('.migrated.json') && req.method === 'PUT') {
        return mockResponse({ status: 200 });
      }
      if (req.method === 'GET' && req.url.includes('/config/')) {
        return mockResponse({
          body: JSON.stringify({ ':names': ['skills'], skills: { data: sheetData } }),
        });
      }
      if (req.method === 'POST' && req.url.includes('/config/')) {
        configPosts.push(req.url);
        return mockResponse({ status: 200 });
      }
      if (req.url.includes('/list/')) return mockResponse({ body: JSON.stringify([]) });
      if (req.method === 'PUT' && req.url.includes('/skill.md')) {
        const skillId = req.url.split('/.da/skills/')[1]?.split('/')[0];
        if (skillId === 'bad-skill') return mockResponse({ status: 500, ok: false });
        const fd = req.opts?.body;
        if (fd instanceof FormData) {
          const blob = fd.get('data');
          if (blob?.text) writtenFiles[skillId] = await blob.text();
        }
        return mockResponse({ status: 200 });
      }
      if (req.method === 'GET' && req.url.includes('/skill.md')) {
        const skillId = req.url.split('/.da/skills/')[1]?.split('/')[0];
        return mockResponse({ body: writtenFiles[skillId] || '---\nname: x\n---\n' });
      }
      // flat .md reads — must come after skill.md checks
      if (req.method === 'GET' && req.url.includes('/.da/skills/') && req.url.endsWith('.md')) {
        return mockResponse({ status: 404, ok: false });
      }
      return mockResponse({ status: 404, ok: false });
    };

    const result = await migrateSkillsIfNeeded(ORG, SITE);

    expect(result.failedIds).to.have.members(['bad-skill']);
    expect(result.migratedIds).to.have.members(['good-skill']);
    // sheet must NOT be dropped when there are failures
    expect(configPosts.length).to.equal(0);
  });
});
