import { expect } from '@esm-bundle/chai';
import {
  isSensitiveHeaderName,
  rowHeadersToArray,
  skillRowStatus,
  skillRowEnabled,
  skillsRowsToMapAndStatuses,
  markSkillDeleted,
  isSkillRecentlyDeleted,
  parseActionsHasWrite,
  fetchSkillsPermission,
  setSkillsBackend,
  fetchSkillsFromAo,
  fetchSkillFileFromAo,
  uploadSkillFileToAo,
  removePersonalSkillSource,
} from '../../blocks/skills/skills-editor-api.js';
import { initAuth } from '../../blocks/skills/utils/da-fetch.js';

describe('skillRowStatus', () => {
  it('returns "approved" for null/undefined/non-object', () => {
    expect(skillRowStatus(null)).to.equal('approved');
    expect(skillRowStatus(undefined)).to.equal('approved');
    expect(skillRowStatus('string')).to.equal('approved');
  });

  it('returns "approved" when no status field', () => {
    expect(skillRowStatus({})).to.equal('approved');
    expect(skillRowStatus({ key: 'test' })).to.equal('approved');
  });

  it('returns "draft" for status=draft (case-insensitive)', () => {
    expect(skillRowStatus({ status: 'draft' })).to.equal('draft');
    expect(skillRowStatus({ status: 'Draft' })).to.equal('draft');
    expect(skillRowStatus({ status: ' DRAFT ' })).to.equal('draft');
  });

  it('returns "approved" for any non-draft status', () => {
    expect(skillRowStatus({ status: 'approved' })).to.equal('approved');
    expect(skillRowStatus({ status: 'active' })).to.equal('approved');
    expect(skillRowStatus({ status: '' })).to.equal('approved');
  });
});

describe('skillRowEnabled', () => {
  it('returns true by default', () => {
    expect(skillRowEnabled({})).to.be.true;
    expect(skillRowEnabled({ key: 'test' })).to.be.true;
  });

  it('respects enabled=false', () => {
    expect(skillRowEnabled({ enabled: false })).to.be.false;
    expect(skillRowEnabled({ enabled: 'false' })).to.be.false;
  });

  it('respects disabled=true', () => {
    expect(skillRowEnabled({ disabled: true })).to.be.false;
    expect(skillRowEnabled({ disabled: 'true' })).to.be.false;
  });

  it('respects enabled=true', () => {
    expect(skillRowEnabled({ enabled: true })).to.be.true;
    expect(skillRowEnabled({ enabled: 'yes' })).to.be.true;
  });
});

describe('skillsRowsToMapAndStatuses', () => {
  it('builds map and statuses from rows', () => {
    const rows = [
      { key: 'skill-a', content: 'Body A', status: 'approved' },
      { key: 'skill-b', content: 'Body B', status: 'draft' },
    ];
    const { map, statuses } = skillsRowsToMapAndStatuses(rows);
    expect(map['skill-a']).to.equal('Body A');
    expect(map['skill-b']).to.equal('Body B');
    expect(statuses['skill-a']).to.equal('approved');
    expect(statuses['skill-b']).to.equal('draft');
  });

  it('strips .md from keys', () => {
    const rows = [{ key: 'skill.md', content: 'Body' }];
    const { map } = skillsRowsToMapAndStatuses(rows);
    expect(map.skill).to.equal('Body');
    expect(map['skill.md']).to.be.undefined;
  });

  it('uses value/body as content fallbacks', () => {
    const rows = [
      { key: 'a', value: 'from-value' },
      { key: 'b', body: 'from-body' },
    ];
    const { map } = skillsRowsToMapAndStatuses(rows);
    expect(map.a).to.equal('from-value');
    expect(map.b).to.equal('from-body');
  });

  it('uses id as key fallback', () => {
    const rows = [{ id: 'from-id', content: 'Body' }];
    const { map } = skillsRowsToMapAndStatuses(rows);
    expect(map['from-id']).to.equal('Body');
  });

  it('skips rows without key/id or content', () => {
    const rows = [
      { key: 'good', content: 'ok' },
      { key: '', content: 'no key' },
      { key: 'no-content', content: '' },
      null,
      'not an object',
    ];
    const { map } = skillsRowsToMapAndStatuses(rows);
    expect(Object.keys(map)).to.deep.equal(['good']);
  });

  it('handles non-array input', () => {
    const { map, statuses } = skillsRowsToMapAndStatuses(null);
    expect(map).to.deep.equal({});
    expect(statuses).to.deep.equal({});
  });
});

describe('markSkillDeleted / isSkillRecentlyDeleted', () => {
  it('marks a skill as recently deleted', () => {
    markSkillDeleted('temp-skill');
    expect(isSkillRecentlyDeleted('temp-skill')).to.be.true;
  });

  it('strips .md extension for matching', () => {
    markSkillDeleted('ext-skill.md');
    expect(isSkillRecentlyDeleted('ext-skill')).to.be.true;
    expect(isSkillRecentlyDeleted('ext-skill.md')).to.be.true;
  });

  it('returns false for non-deleted skills', () => {
    expect(isSkillRecentlyDeleted('never-deleted')).to.be.false;
  });

  it('handles empty/null input', () => {
    expect(isSkillRecentlyDeleted('')).to.be.false;
    expect(isSkillRecentlyDeleted(null)).to.be.false;
  });
});

describe('rowHeadersToArray', () => {
  it('returns empty array for missing/empty row', () => {
    expect(rowHeadersToArray(null)).to.deep.equal([]);
    expect(rowHeadersToArray({})).to.deep.equal([]);
    expect(rowHeadersToArray({ headers: [] })).to.deep.equal([]);
  });

  it('converts headers array to name/value objects', () => {
    const row = { headers: [{ name: 'X-Foo', value: 'bar' }, { name: 'Accept', value: 'text/html' }] };
    expect(rowHeadersToArray(row)).to.deep.equal([
      { name: 'X-Foo', value: 'bar' },
      { name: 'Accept', value: 'text/html' },
    ]);
  });

  it('skips entries with empty name or value', () => {
    const row = { headers: [{ name: '', value: 'v' }, { name: 'n', value: '' }, { name: 'ok', value: 'ok' }] };
    expect(rowHeadersToArray(row)).to.deep.equal([{ name: 'ok', value: 'ok' }]);
  });

  it('falls back to legacy authHeaderName/authHeaderValue', () => {
    const row = { authHeaderName: 'x-api-key', authHeaderValue: 'secret123' };
    expect(rowHeadersToArray(row)).to.deep.equal([{ name: 'x-api-key', value: 'secret123' }]);
  });

  it('prefers headers array over legacy when both present', () => {
    const row = {
      headers: [{ name: 'x-api-key', value: 'new-val' }],
      authHeaderName: 'x-api-key',
      authHeaderValue: 'old-val',
    };
    const result = rowHeadersToArray(row);
    expect(result).to.have.length(1);
    expect(result[0].value).to.equal('new-val');
  });

  it('merges legacy header when name differs from headers array entries', () => {
    const row = {
      headers: [{ name: 'Accept', value: 'text/html' }],
      authHeaderName: 'x-api-key',
      authHeaderValue: 'legacy-secret',
    };
    const result = rowHeadersToArray(row);
    expect(result).to.have.length(2);
    expect(result[0]).to.deep.equal({ name: 'Accept', value: 'text/html' });
    expect(result[1]).to.deep.equal({ name: 'x-api-key', value: 'legacy-secret' });
  });

  it('trims whitespace from names and values', () => {
    const row = { headers: [{ name: '  X-Foo  ', value: '  bar  ' }] };
    expect(rowHeadersToArray(row)).to.deep.equal([{ name: 'X-Foo', value: 'bar' }]);
  });
});

describe('isSensitiveHeaderName', () => {
  it('returns true for authorization-family headers', () => {
    expect(isSensitiveHeaderName('Authorization')).to.be.true;
    expect(isSensitiveHeaderName('authorization')).to.be.true;
    expect(isSensitiveHeaderName('AUTHORIZATION')).to.be.true;
    expect(isSensitiveHeaderName('Proxy-Authorization')).to.be.true;
  });

  it('returns true for api key and token headers', () => {
    expect(isSensitiveHeaderName('x-api-key')).to.be.true;
    expect(isSensitiveHeaderName('X-API-Key')).to.be.true;
    expect(isSensitiveHeaderName('x-auth-token')).to.be.true;
    expect(isSensitiveHeaderName('x-token')).to.be.true;
    expect(isSensitiveHeaderName('X-Token-Session')).to.be.true;
  });

  it('returns true for cookie and CSRF headers', () => {
    expect(isSensitiveHeaderName('Cookie')).to.be.true;
    expect(isSensitiveHeaderName('x-csrf-token')).to.be.true;
    expect(isSensitiveHeaderName('X-XSRF-TOKEN')).to.be.true;
  });

  it('returns false for non-sensitive headers', () => {
    expect(isSensitiveHeaderName('Content-Type')).to.be.false;
    expect(isSensitiveHeaderName('Accept')).to.be.false;
    expect(isSensitiveHeaderName('X-Store-Code')).to.be.false;
    expect(isSensitiveHeaderName('X-Environment-Id')).to.be.false;
    expect(isSensitiveHeaderName('X-Catalog-Endpoint')).to.be.false;
  });

  it('handles empty/null input', () => {
    expect(isSensitiveHeaderName('')).to.be.false;
    expect(isSensitiveHeaderName(null)).to.be.false;
    expect(isSensitiveHeaderName(undefined)).to.be.false;
  });
});

describe('parseActionsHasWrite', () => {
  it('returns true when write is present', () => {
    expect(parseActionsHasWrite('/author-kit=read,write')).to.be.true;
  });

  it('returns false when write is absent', () => {
    expect(parseActionsHasWrite('/author-kit=read')).to.be.false;
  });

  it('handles multiple path entries', () => {
    expect(parseActionsHasWrite('/other=read /author-kit=write')).to.be.true;
    expect(parseActionsHasWrite('/other=read /author-kit=read')).to.be.false;
  });

  it('is not fooled by "write" in a path name', () => {
    expect(parseActionsHasWrite('/write-only=read')).to.be.false;
  });

  it('returns false for empty or missing header', () => {
    expect(parseActionsHasWrite('')).to.be.false;
    expect(parseActionsHasWrite(null)).to.be.false;
    expect(parseActionsHasWrite(undefined)).to.be.false;
  });
});

describe('fetchSkillsPermission', () => {
  const realFetch = window.fetch;
  afterEach(() => { window.fetch = realFetch; });

  function mockFetch({ status = 200, headers = {} } = {}) {
    window.fetch = async () => ({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    });
  }

  it('returns true when x-da-actions includes write', async () => {
    mockFetch({ headers: { 'x-da-actions': '/da/skills=read,write' } });
    expect(await fetchSkillsPermission('org', 'site')).to.be.true;
  });

  it('returns false when x-da-actions excludes write', async () => {
    mockFetch({ headers: { 'x-da-actions': '/da/skills=read' } });
    expect(await fetchSkillsPermission('org', 'site')).to.be.false;
  });

  it('returns true (optimistic) when no x-da-actions header', async () => {
    mockFetch({ headers: {} });
    expect(await fetchSkillsPermission('org', 'site')).to.be.true;
  });

  it('returns true (optimistic) on network error', async () => {
    window.fetch = async () => { throw new Error('network'); };
    expect(await fetchSkillsPermission('org', 'site')).to.be.true;
  });
});

describe('AO / bridge backend switch', () => {
  const realFetch = window.fetch;
  const realAdobeIMS = window.adobeIMS;

  const AO_SKILLS_RESPONSE = {
    skills: [
      {
        name: 'my-skill', scope: 'owner', description: 'desc', display_name: 'My Skill', lineCount: 3,
      },
    ],
  };
  const BRIDGE_SKILLS_RESPONSE = {
    data: [{ id: 'skill-uuid-1' }],
    skills: [
      {
        id: 'skill-uuid-1', name: 'my-skill', scope: 'owner', description: 'desc', display_name: 'My Skill', lineCount: 3,
      },
    ],
  };

  function mockAuth() {
    initAuth('test-ims-token');
    window.adobeIMS = {
      getAccessToken: () => ({ token: 'test-ims-token' }),
      getProfile: async () => ({
        userId: 'user-123',
        projectedProductContext: [{ prodCtx: { owningEntity: 'ORGID123@AdobeOrg' } }],
      }),
    };
  }

  function trackFetch(handler) {
    const calls = [];
    window.fetch = async (url, opts = {}) => {
      calls.push({ url, opts });
      return handler(url, opts);
    };
    return calls;
  }

  beforeEach(() => {
    mockAuth();
  });

  afterEach(() => {
    window.fetch = realFetch;
    window.adobeIMS = realAdobeIMS;
    setSkillsBackend({ altHarness: false });
    initAuth(null);
  });

  describe('altHarness off (AO, byte-for-byte unchanged)', () => {
    it('fetchSkillsFromAo hits the AO base with no x-user-id header', async () => {
      const calls = trackFetch(() => ({ ok: true, json: async () => AO_SKILLS_RESPONSE }));
      const result = await fetchSkillsFromAo();
      expect(calls).to.have.length(1);
      expect(calls[0].url).to.equal('https://agent-orchestrator-stage-va7.adobe.io/api/v1/skills?manifest_id=experience-workspace');
      expect(calls[0].opts.headers['x-user-id']).to.be.undefined;
      expect(calls[0].opts.headers.authorization).to.equal('Bearer test-ims-token');
      expect(result[0].id).to.equal('my-skill');
      expect(result[0].skillId).to.be.undefined;
    });

    it('fetchSkillFileFromAo hits the per-skill files endpoint', async () => {
      const calls = trackFetch(() => ({ ok: true, json: async () => ({ content: '# Hello' }) }));
      const text = await fetchSkillFileFromAo('my-skill');
      expect(calls[0].url).to.include('/api/v1/skills/my-skill/files');
      expect(calls[0].opts.headers['x-user-id']).to.be.undefined;
      expect(text).to.equal('# Hello');
    });

    it('removePersonalSkillSource rewrites overrides via GET+PUT with x-user-id (AO contract)', async () => {
      const calls = trackFetch((url, opts) => {
        if (opts.method === undefined) {
          return { ok: true, json: async () => ({ settings: { skills: { sources: [{ name: 'my-skill' }] } } }) };
        }
        return { ok: true, json: async () => ({}) };
      });
      const result = await removePersonalSkillSource('my-skill');
      expect(result.ok).to.be.true;
      expect(calls).to.have.length(2);
      expect(calls[0].url).to.equal('https://agent-orchestrator-stage-va7.adobe.io/api/v1/overrides/user');
      expect(calls[1].opts.method).to.equal('PUT');
      // AO branch always sent x-user-id already — unchanged either way.
      expect(calls[1].opts.headers['x-user-id']).to.equal('user-123');
    });

    it('uploadSkillFileToAo uses the presigned initiate/PUT/finalize flow', async () => {
      const file = new File(['# Body'], 'my-skill.md', { type: 'text/markdown' });
      const calls = trackFetch((url) => {
        if (url.includes('/api/v1/files/upload')) {
          return { ok: true, json: async () => ({ upload_url: 'https://blob.example/x', file_id: 'f1' }) };
        }
        if (url === 'https://blob.example/x') return { ok: true };
        if (url.includes('/finalize')) return { ok: true, json: async () => ({ skill_registration_ok: true }) };
        return { ok: false };
      });
      const result = await uploadSkillFileToAo(file);
      expect(result.ok).to.be.true;
      expect(calls).to.have.length(3);
      expect(calls[0].url).to.include('/api/v1/files/upload');
    });
  });

  describe('altHarness on (bridge)', () => {
    beforeEach(() => setSkillsBackend({ altHarness: true }));

    it('fetchSkillsFromAo hits the bridge base with x-user-id and maps skillId', async () => {
      const calls = trackFetch(() => ({ ok: true, json: async () => BRIDGE_SKILLS_RESPONSE }));
      const result = await fetchSkillsFromAo();
      expect(calls[0].url).to.equal('https://aem-sites-claudebridge-va6.adobe.io/api/v1/skills?manifest_id=experience-workspace');
      expect(calls[0].opts.headers['x-user-id']).to.equal('user-123');
      expect(result[0].id).to.equal('my-skill');
      expect(result[0].skillId).to.equal('skill-uuid-1');
    });

    it('fetchSkillFileFromAo resolves skill_id then GETs /api/v1/skills/:skillId', async () => {
      const b64 = btoa('# Hello bridge');
      const calls = trackFetch((url) => {
        if (url.includes('?manifest_id=')) return { ok: true, json: async () => BRIDGE_SKILLS_RESPONSE };
        return {
          ok: true,
          json: async () => ({ files: [{ path: 'skills/my-skill/SKILL.md', content: b64 }] }),
        };
      });
      const text = await fetchSkillFileFromAo('my-skill', 'SKILL.md');
      expect(calls[1].url).to.equal('https://aem-sites-claudebridge-va6.adobe.io/api/v1/skills/skill-uuid-1');
      expect(calls[1].opts.headers['x-user-id']).to.equal('user-123');
      expect(text).to.equal('# Hello bridge');
    });

    it('fetchSkillFileFromAo uses a provided skillId without a catalog lookup', async () => {
      const b64 = btoa('# Direct');
      const calls = trackFetch(() => ({
        ok: true,
        json: async () => ({ files: [{ path: 'SKILL.md', content: b64 }] }),
      }));
      const text = await fetchSkillFileFromAo('my-skill', 'SKILL.md', 'skill-uuid-1');
      expect(calls).to.have.length(1);
      expect(calls[0].url).to.equal('https://aem-sites-claudebridge-va6.adobe.io/api/v1/skills/skill-uuid-1');
      expect(text).to.equal('# Direct');
    });

    it('uploadSkillFileToAo posts multipart/form-data to /api/v1/skills', async () => {
      const file = new File(['# Body'], 'my-skill.md', { type: 'text/markdown' });
      const calls = trackFetch(() => ({ ok: true, json: async () => ({ id: 'skill-uuid-2' }) }));
      const result = await uploadSkillFileToAo(file);
      expect(result.ok).to.be.true;
      expect(calls).to.have.length(1);
      expect(calls[0].url).to.equal('https://aem-sites-claudebridge-va6.adobe.io/api/v1/skills');
      expect(calls[0].opts.method).to.equal('POST');
      expect(calls[0].opts.body).to.be.instanceOf(FormData);
      expect(calls[0].opts.body.get('file').name).to.equal('my-skill.md');
      expect(calls[0].opts.body.get('display_title')).to.equal('my-skill');
      expect(calls[0].opts.headers['x-user-id']).to.equal('user-123');
    });

    it('removePersonalSkillSource resolves skill_id then DELETEs /api/v1/skills/:skillId', async () => {
      const calls = trackFetch((url) => {
        if (url.includes('?manifest_id=')) return { ok: true, json: async () => BRIDGE_SKILLS_RESPONSE };
        return { ok: true, json: async () => ({}) };
      });
      const result = await removePersonalSkillSource('my-skill');
      expect(result.ok).to.be.true;
      expect(calls[1].url).to.equal('https://aem-sites-claudebridge-va6.adobe.io/api/v1/skills/skill-uuid-1');
      expect(calls[1].opts.method).to.equal('DELETE');
      expect(calls[1].opts.headers['x-user-id']).to.equal('user-123');
    });

    it('removePersonalSkillSource uses a provided skillId without a catalog lookup', async () => {
      const calls = trackFetch(() => ({ ok: true, json: async () => ({}) }));
      const result = await removePersonalSkillSource('my-skill', 'skill-uuid-9');
      expect(result.ok).to.be.true;
      expect(calls).to.have.length(1);
      expect(calls[0].url).to.equal('https://aem-sites-claudebridge-va6.adobe.io/api/v1/skills/skill-uuid-9');
    });
  });
});
