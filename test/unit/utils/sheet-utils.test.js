import { expect } from '@esm-bundle/chai';
import { normaliseRowKey, parseSheetBoolean } from '../../../blocks/skills/utils/sheet-utils.js';

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
