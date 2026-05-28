import { expect } from '@esm-bundle/chai';
import {
  parseFrontmatter,
  parseSkillIndexEntry,
  stripFrontmatter,
  validateSkillFrontmatter,
  ensureSkillFrontmatter,
  bumpSkillVersion,
  INDEX_ENTRY_KEYS,
} from '../../../blocks/skills/utils/skill-frontmatter.js';

describe('parseFrontmatter', () => {
  it('returns null when no frontmatter block present', () => {
    expect(parseFrontmatter('Just a body')).to.be.null;
    expect(parseFrontmatter('')).to.be.null;
    expect(parseFrontmatter(null)).to.be.null;
    expect(parseFrontmatter(undefined)).to.be.null;
  });

  it('returns null for unclosed frontmatter', () => {
    expect(parseFrontmatter('---\nname: test\nbody without close')).to.be.null;
  });

  it('parses flat key-value frontmatter', () => {
    const md = '---\nname: my-skill\ndescription: Does things\n---\n\nBody here';
    const result = parseFrontmatter(md);
    expect(result).to.not.be.null;
    expect(result.fields.name).to.equal('my-skill');
    expect(result.fields.description).to.equal('Does things');
    expect(result.body).to.equal('Body here');
  });

  it('lowercases all keys', () => {
    const md = '---\nName: foo\nDESCRIPTION: bar\n---\n';
    const result = parseFrontmatter(md);
    expect(result.fields.name).to.equal('foo');
    expect(result.fields.description).to.equal('bar');
    expect(result.fields.Name).to.be.undefined;
  });

  it('handles leading whitespace before frontmatter', () => {
    const md = '  ---\nname: ws-skill\n---\n\nBody';
    const result = parseFrontmatter(md);
    expect(result).to.not.be.null;
    expect(result.fields.name).to.equal('ws-skill');
  });

  it('handles empty body after frontmatter', () => {
    const md = '---\nname: test\n---\n';
    const result = parseFrontmatter(md);
    expect(result).to.not.be.null;
    expect(result.fields.name).to.equal('test');
    expect(result.body).to.equal('');
  });

  it('handles values with colons (e.g. URLs)', () => {
    const md = '---\nname: test\nurl: https://example.com\n---\n';
    const result = parseFrontmatter(md);
    expect(result.fields.url).to.equal('https://example.com');
  });

  it('skips lines without colons', () => {
    const md = '---\nname: test\nno-colon-line\ndescription: ok\n---\n';
    const result = parseFrontmatter(md);
    expect(Object.keys(result.fields)).to.have.lengthOf(2);
    expect(result.fields.name).to.equal('test');
    expect(result.fields.description).to.equal('ok');
  });

  it('handles empty values', () => {
    const md = '---\nname: test\ndescription: \n---\n';
    const result = parseFrontmatter(md);
    expect(result.fields.description).to.equal('');
  });

  it('unescapes double-quoted values with colons', () => {
    const md = '---\ndescription: "hello: world"\n---\n';
    expect(parseFrontmatter(md).fields.description).to.equal('hello: world');
  });

  it('unescapes double-quoted values with hash', () => {
    const md = '---\ndescription: "# heading"\n---\n';
    expect(parseFrontmatter(md).fields.description).to.equal('# heading');
  });

  it('unescapes \\n escape sequence in double-quoted values', () => {
    const md = '---\ndescription: "line1\\nline2"\n---\n';
    expect(parseFrontmatter(md).fields.description).to.equal('line1\nline2');
  });
});

describe('stripFrontmatter', () => {
  it('returns body with frontmatter removed', () => {
    const md = '---\nname: test\ndescription: ok\nversion: 1\n---\n\n# Heading\nBody text';
    expect(stripFrontmatter(md)).to.equal('# Heading\nBody text');
  });

  it('returns input unchanged when no frontmatter present', () => {
    expect(stripFrontmatter('# Just a heading\nbody')).to.equal('# Just a heading\nbody');
  });

  it('handles null/undefined inputs gracefully', () => {
    expect(stripFrontmatter(null)).to.equal('');
    expect(stripFrontmatter(undefined)).to.equal('');
  });

  it('strips the unclosed opener line on malformed frontmatter', () => {
    const result = stripFrontmatter('---\nname: x\nnobody closes this');
    expect(result.startsWith('---')).to.be.false;
    expect(result).to.include('name: x');
  });
});

describe('parseSkillIndexEntry', () => {
  it('returns the four index fields from valid frontmatter', () => {
    const md = '---\nname: my-skill\ndescription: Does things\nversion: 3\nstatus: approved\n---\n\nBody';
    expect(parseSkillIndexEntry(md)).to.deep.equal({
      name: 'my-skill',
      description: 'Does things',
      version: 3,
      status: 'approved',
    });
  });

  it('defaults version to 1 when missing', () => {
    const md = '---\nname: test\ndescription: ok\n---\n\nBody';
    expect(parseSkillIndexEntry(md).version).to.equal(1);
  });

  it('defaults version to 1 when not a positive integer', () => {
    const md = '---\nname: test\ndescription: ok\nversion: not-a-number\n---\n';
    expect(parseSkillIndexEntry(md).version).to.equal(1);
  });

  it('defaults status to approved when missing or invalid', () => {
    const missing = '---\nname: test\ndescription: ok\n---\n';
    const invalid = '---\nname: test\ndescription: ok\nstatus: weird\n---\n';
    expect(parseSkillIndexEntry(missing).status).to.equal('approved');
    expect(parseSkillIndexEntry(invalid).status).to.equal('approved');
  });

  it('preserves draft status', () => {
    const md = '---\nname: test\ndescription: ok\nstatus: draft\n---\n';
    expect(parseSkillIndexEntry(md).status).to.equal('draft');
  });

  it('returns empty strings when frontmatter is absent', () => {
    const entry = parseSkillIndexEntry('# Just markdown\nNo frontmatter');
    expect(entry.name).to.equal('');
    expect(entry.description).to.equal('');
    expect(entry.version).to.equal(1);
    expect(entry.status).to.equal('approved');
  });

  it('does not touch the body (manifest-only)', () => {
    const md = '---\nname: tiny\ndescription: ok\nversion: 1\n---\n\nbody '.repeat(1000);
    const entry = parseSkillIndexEntry(md);
    expect(entry.description.length).to.be.lessThan(20);
  });
});

describe('INDEX_ENTRY_KEYS', () => {
  it('exposes exactly the four index fields', () => {
    expect([...INDEX_ENTRY_KEYS]).to.deep.equal(['name', 'description', 'version', 'status']);
  });
});

describe('validateSkillFrontmatter', () => {
  it('returns empty array for fully valid frontmatter', () => {
    const errors = validateSkillFrontmatter({
      name: 'my-skill', description: 'Does things', version: '1', status: 'approved',
    });
    expect(errors).to.deep.equal([]);
  });

  it('accepts version as a number value', () => {
    const errors = validateSkillFrontmatter({
      name: 'my-skill', description: 'Does things', version: 7,
    });
    expect(errors).to.deep.equal([]);
  });

  it('requires name field', () => {
    const errors = validateSkillFrontmatter({ description: 'ok', version: '1' });
    expect(errors.some((e) => e.includes('name'))).to.be.true;
  });

  it('requires description field', () => {
    const errors = validateSkillFrontmatter({ name: 'test', version: '1' });
    expect(errors.some((e) => e.includes('description'))).to.be.true;
  });

  it('requires version field', () => {
    const errors = validateSkillFrontmatter({ name: 'test', description: 'ok' });
    expect(errors.some((e) => e.toLowerCase().includes('version'))).to.be.true;
  });

  it('rejects non-positive-integer version', () => {
    ['0', '-1', '1.5', 'abc', ' '].forEach((v) => {
      const errors = validateSkillFrontmatter({ name: 't', description: 'ok', version: v });
      expect(errors.some((e) => e.includes('version')), `version=${v}`).to.be.true;
    });
  });

  it('rejects multi-line description', () => {
    const errors = validateSkillFrontmatter({ name: 't', description: 'line1\nline2', version: '1' });
    expect(errors.some((e) => e.includes('single line'))).to.be.true;
  });

  it('rejects unknown status values', () => {
    const errors = validateSkillFrontmatter({
      name: 't', description: 'ok', version: '1', status: 'pending',
    });
    expect(errors.some((e) => e.includes('status'))).to.be.true;
  });

  it('enforces name max length (64)', () => {
    const long = 'a'.repeat(65);
    const errors = validateSkillFrontmatter({ name: long, description: 'ok', version: '1' });
    expect(errors.some((e) => e.includes('64'))).to.be.true;
  });

  it('enforces lowercase/hyphens/numbers in name', () => {
    const errors = validateSkillFrontmatter({ name: 'Bad Name!', description: 'ok', version: '1' });
    expect(errors.some((e) => e.includes('lowercase'))).to.be.true;
  });

  it('rejects XML tags in name', () => {
    const errors = validateSkillFrontmatter({ name: '<script>', description: 'ok', version: '1' });
    expect(errors.some((e) => e.includes('XML'))).to.be.true;
  });

  it('rejects "claude" in name (word boundary)', () => {
    const errors = validateSkillFrontmatter({ name: 'claude-helper', description: 'ok', version: '1' });
    expect(errors.some((e) => e.includes('claude'))).to.be.true;
  });

  it('does NOT reject "claudine" (not a reserved word boundary match)', () => {
    const errors = validateSkillFrontmatter({ name: 'claudine', description: 'ok', version: '1' });
    expect(errors).to.deep.equal([]);
  });

  it('rejects "anthropic" in name (word boundary)', () => {
    const errors = validateSkillFrontmatter({ name: 'my-anthropic-skill', description: 'ok', version: '1' });
    expect(errors.some((e) => e.includes('anthropic'))).to.be.true;
  });

  it('does NOT reject "philanthropic"', () => {
    const errors = validateSkillFrontmatter({ name: 'philanthropic', description: 'ok', version: '1' });
    expect(errors).to.deep.equal([]);
  });

  it('enforces description max length (1024)', () => {
    const long = 'x'.repeat(1025);
    const errors = validateSkillFrontmatter({ name: 'test', description: long, version: '1' });
    expect(errors.some((e) => e.includes('1024'))).to.be.true;
  });

  it('rejects XML tags in description', () => {
    const errors = validateSkillFrontmatter({ name: 'test', description: '<div>bad</div>', version: '1' });
    expect(errors.some((e) => e.includes('XML'))).to.be.true;
  });

  it('collects multiple errors', () => {
    const errors = validateSkillFrontmatter({});
    expect(errors.length).to.be.greaterThanOrEqual(3);
  });
});

describe('ensureSkillFrontmatter', () => {
  it('injects a full skeleton when no frontmatter is present', () => {
    const result = ensureSkillFrontmatter('Just body text', 'my-skill', 'approved');
    expect(result.injected).to.be.true;
    expect(result.markdown).to.include('---');
    expect(result.markdown).to.include('name: my-skill');
    expect(result.markdown).to.include('version: 1');
    expect(result.markdown).to.include('status: approved');
    expect(result.markdown).to.include('Just body text');
  });

  it('flags isValid=false when injected body has no description', () => {
    const result = ensureSkillFrontmatter('Just body text', 'my-skill', 'approved');
    expect(result.isValid).to.be.false;
    expect(result.warnings.some((w) => w.includes('description'))).to.be.true;
  });

  it('preserves existing frontmatter when all required fields are present', () => {
    const md = '---\nname: existing\ndescription: ok\nversion: 2\nstatus: draft\n---\n\nBody';
    const result = ensureSkillFrontmatter(md, 'fallback', 'draft');
    expect(result.injected).to.be.false;
    expect(result.markdown).to.equal(md);
    expect(result.isValid).to.be.true;
  });

  it('auto-fills missing version on an existing block', () => {
    const md = '---\nname: legacy\ndescription: ok\n---\n\nBody';
    const result = ensureSkillFrontmatter(md, 'legacy', 'approved');
    expect(result.injected).to.be.true;
    expect(result.markdown).to.include('version: 1');
    expect(result.isValid).to.be.true;
  });

  it('auto-fills missing name from the skill ID', () => {
    const md = '---\ndescription: ok\nversion: 4\n---\n\nBody';
    const result = ensureSkillFrontmatter(md, 'rescued', 'approved');
    expect(result.injected).to.be.true;
    expect(result.markdown).to.include('name: rescued');
    expect(result.isValid).to.be.true;
  });

  it('does NOT auto-fill description (caller blocks the save instead)', () => {
    const md = '---\nname: x\nversion: 1\n---\n\nBody';
    const result = ensureSkillFrontmatter(md, 'x', 'approved');
    expect(result.isValid).to.be.false;
    expect(result.warnings.some((w) => w.includes('description'))).to.be.true;
  });

  it('preserves unknown frontmatter keys round-trip', () => {
    const md = '---\nname: x\ndescription: ok\nversion: 1\ntags: hello\nicon: rocket\n---\n\nBody';
    const result = ensureSkillFrontmatter(md, 'x', 'approved');
    expect(result.markdown).to.include('tags: hello');
    expect(result.markdown).to.include('icon: rocket');
  });

  it('handles null/undefined markdown by injecting a skeleton', () => {
    const result = ensureSkillFrontmatter(null, 'my-skill', 'draft');
    expect(result.injected).to.be.true;
    expect(result.markdown).to.include('name: my-skill');
    expect(result.markdown).to.include('status: draft');
    expect(result.markdown).to.include('version: 1');
  });
});

describe('bumpSkillVersion', () => {
  it('increments an existing version', () => {
    const md = '---\nname: x\ndescription: ok\nversion: 3\n---\n\nBody';
    const result = bumpSkillVersion(md, 'x');
    expect(result.version).to.equal(4);
    expect(result.markdown).to.include('version: 4');
    expect(result.markdown).to.include('Body');
  });

  it('defaults to version 1 when missing on existing frontmatter', () => {
    const md = '---\nname: x\ndescription: ok\n---\n\nBody';
    const result = bumpSkillVersion(md, 'x');
    expect(result.version).to.equal(1);
    expect(result.markdown).to.include('version: 1');
  });

  it('injects frontmatter from scratch when none exists', () => {
    const result = bumpSkillVersion('Bare body', 'fresh');
    expect(result.version).to.equal(1);
    expect(result.markdown).to.include('name: fresh');
    expect(result.markdown).to.include('version: 1');
    expect(result.markdown).to.include('Bare body');
  });

  it('preserves other frontmatter fields during bump', () => {
    const md = '---\nname: x\ndescription: ok\nversion: 9\nstatus: draft\ntags: a\n---\n\nBody';
    const result = bumpSkillVersion(md, 'x');
    expect(result.version).to.equal(10);
    expect(result.markdown).to.include('status: draft');
    expect(result.markdown).to.include('tags: a');
  });

  it('round-trips description containing a URL (colon)', () => {
    const md = '---\nname: x\ndescription: "https://example.com"\nversion: 1\n---\n\nbody';
    const result = bumpSkillVersion(md, 'x');
    const parsed = parseFrontmatter(result.markdown);
    expect(parsed.fields.description).to.equal('https://example.com');
  });

  it('round-trips description containing a hash', () => {
    const md = '---\nname: x\ndescription: "# My Skill"\nversion: 1\n---\n\nbody';
    const result = bumpSkillVersion(md, 'x');
    const parsed = parseFrontmatter(result.markdown);
    expect(parsed.fields.description).to.equal('# My Skill');
  });
});
