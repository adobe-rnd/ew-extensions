import { expect } from '@esm-bundle/chai';
import { normaliseRowKey, parseSheetBoolean, toSafeId } from '../../../blocks/skills/utils/sheet-utils.js';

describe('normaliseRowKey', () => {
  it('returns trimmed key from row.key', () => {
    expect(normaliseRowKey({ key: '  my-skill  ' })).to.equal('my-skill');
  });

  it('falls back to row.id when no key', () => {
    expect(normaliseRowKey({ id: 'fallback-id' })).to.equal('fallback-id');
  });

  it('strips .md extension', () => {
    expect(normaliseRowKey({ key: 'my-skill.md' })).to.equal('my-skill');
    expect(normaliseRowKey({ key: 'my-skill.MD' })).to.equal('my-skill');
  });

  it('returns empty string for null/undefined/empty', () => {
    expect(normaliseRowKey(null)).to.equal('');
    expect(normaliseRowKey(undefined)).to.equal('');
    expect(normaliseRowKey({})).to.equal('');
  });

  it('prefers key over id', () => {
    expect(normaliseRowKey({ key: 'from-key', id: 'from-id' })).to.equal('from-key');
  });
});

describe('parseSheetBoolean', () => {
  it('returns actual booleans as-is', () => {
    expect(parseSheetBoolean(true)).to.be.true;
    expect(parseSheetBoolean(false)).to.be.false;
  });

  it('coerces "true"/"1"/"yes" to true', () => {
    expect(parseSheetBoolean('true')).to.be.true;
    expect(parseSheetBoolean('1')).to.be.true;
    expect(parseSheetBoolean('yes')).to.be.true;
    expect(parseSheetBoolean('TRUE')).to.be.true;
    expect(parseSheetBoolean('  Yes  ')).to.be.true;
  });

  it('coerces "false"/"0"/"no" to false', () => {
    expect(parseSheetBoolean('false')).to.be.false;
    expect(parseSheetBoolean('0')).to.be.false;
    expect(parseSheetBoolean('no')).to.be.false;
    expect(parseSheetBoolean('FALSE')).to.be.false;
    expect(parseSheetBoolean('  No  ')).to.be.false;
  });

  it('returns fallback for non-coercible values', () => {
    expect(parseSheetBoolean('maybe')).to.be.undefined;
    expect(parseSheetBoolean('maybe', true)).to.be.true;
    expect(parseSheetBoolean(42)).to.be.undefined;
    expect(parseSheetBoolean(null, false)).to.be.false;
    expect(parseSheetBoolean(undefined)).to.be.undefined;
  });
});

describe('toSafeId', () => {
  it('converts spaces to hyphens and lowercases', () => {
    expect(toSafeId('My Cool Skill')).to.equal('my-cool-skill');
  });

  it('converts underscores to hyphens', () => {
    expect(toSafeId('my_cool_skill')).to.equal('my-cool-skill');
  });

  it('strips special characters', () => {
    expect(toSafeId('skill@#$name!')).to.equal('skillname');
  });

  it('collapses multiple hyphens', () => {
    expect(toSafeId('skill---name')).to.equal('skill-name');
    expect(toSafeId('a - - b')).to.equal('a-b');
  });

  it('trims leading and trailing hyphens', () => {
    expect(toSafeId('-leading-')).to.equal('leading');
    expect(toSafeId('  --test--  ')).to.equal('test');
  });

  it('handles already-valid IDs unchanged', () => {
    expect(toSafeId('my-valid-id')).to.equal('my-valid-id');
    expect(toSafeId('skill123')).to.equal('skill123');
  });

  it('returns empty string for empty/whitespace input', () => {
    expect(toSafeId('')).to.equal('');
    expect(toSafeId('   ')).to.equal('');
    expect(toSafeId(null)).to.equal('');
    expect(toSafeId(undefined)).to.equal('');
  });

  it('handles mixed case and special chars', () => {
    expect(toSafeId('SEO Optimization (v2)')).to.equal('seo-optimization-v2');
  });
});
