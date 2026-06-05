import { expect } from '@esm-bundle/chai';
import {
  isSensitiveHeaderName,
  rowHeadersToArray,
  skillRowStatus,
  skillRowEnabled,
  skillsRowsToMapAndStatuses,
  markSkillDeleted,
  isSkillRecentlyDeleted,
} from '../../blocks/skills/skills-editor-api.js';

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
