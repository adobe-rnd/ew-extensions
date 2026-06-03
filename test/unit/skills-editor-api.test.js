import { expect } from '@esm-bundle/chai';
import {
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
