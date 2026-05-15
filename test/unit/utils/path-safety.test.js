import { expect } from '@esm-bundle/chai';
import { isSafeId, isSafeSubPath } from '../../../apps/skills/utils/sheet-utils.js';

describe('isSafeId', () => {
  it('accepts valid slugs', () => {
    expect(isSafeId('my-skill')).to.be.true;
    expect(isSafeId('skill_v2')).to.be.true;
    expect(isSafeId('ABC-123')).to.be.true;
    expect(isSafeId('a')).to.be.true;
  });

  it('rejects empty or whitespace-only', () => {
    expect(isSafeId('')).to.be.false;
    expect(isSafeId('  ')).to.be.false;
  });

  it('rejects path traversal sequences', () => {
    expect(isSafeId('../etc/passwd')).to.be.false;
    expect(isSafeId('../../secrets')).to.be.false;
    expect(isSafeId('foo/bar')).to.be.false;
  });

  it('rejects slashes', () => {
    expect(isSafeId('path/to/thing')).to.be.false;
    expect(isSafeId('/absolute')).to.be.false;
  });

  it('rejects special characters', () => {
    expect(isSafeId('skill name')).to.be.false;
    expect(isSafeId('skill.name')).to.be.false;
    expect(isSafeId('skill@org')).to.be.false;
    expect(isSafeId('<script>')).to.be.false;
  });

  it('rejects non-string input', () => {
    expect(isSafeId(null)).to.be.false;
    expect(isSafeId(undefined)).to.be.false;
    expect(isSafeId(123)).to.be.false;
    expect(isSafeId({})).to.be.false;
  });
});

describe('isSafeSubPath', () => {
  it('accepts valid relative paths', () => {
    expect(isSafeSubPath('drafts/memory')).to.be.true;
    expect(isSafeSubPath('file.html')).to.be.true;
    expect(isSafeSubPath('.da/skills/my-skill.md')).to.be.true;
  });

  it('rejects path traversal with ..', () => {
    expect(isSafeSubPath('../etc/passwd')).to.be.false;
    expect(isSafeSubPath('foo/../../bar')).to.be.false;
    expect(isSafeSubPath('..')).to.be.false;
  });

  it('rejects single dot segments', () => {
    expect(isSafeSubPath('./foo')).to.be.false;
    expect(isSafeSubPath('foo/./bar')).to.be.false;
  });

  it('rejects empty or whitespace-only', () => {
    expect(isSafeSubPath('')).to.be.false;
    expect(isSafeSubPath('   ')).to.be.false;
  });

  it('rejects non-string input', () => {
    expect(isSafeSubPath(null)).to.be.false;
    expect(isSafeSubPath(undefined)).to.be.false;
    expect(isSafeSubPath(42)).to.be.false;
  });
});
