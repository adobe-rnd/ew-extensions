import { expect } from '@esm-bundle/chai';
import {
  parseFrontmatter,
  validateSkillFrontmatter,
  ensureSkillFrontmatter,
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
});

describe('validateSkillFrontmatter', () => {
  it('returns empty array for valid frontmatter', () => {
    const errors = validateSkillFrontmatter({ name: 'my-skill', description: 'Does things' });
    expect(errors).to.deep.equal([]);
  });

  it('requires name field', () => {
    const errors = validateSkillFrontmatter({ description: 'ok' });
    expect(errors).to.have.lengthOf(1);
    expect(errors[0]).to.include('missing');
    expect(errors[0]).to.include('name');
  });

  it('requires description field', () => {
    const errors = validateSkillFrontmatter({ name: 'test' });
    expect(errors).to.have.lengthOf(1);
    expect(errors[0]).to.include('description');
  });

  it('enforces name max length (64)', () => {
    const long = 'a'.repeat(65);
    const errors = validateSkillFrontmatter({ name: long, description: 'ok' });
    expect(errors.some((e) => e.includes('64'))).to.be.true;
  });

  it('enforces lowercase/hyphens/numbers in name', () => {
    const errors = validateSkillFrontmatter({ name: 'Bad Name!', description: 'ok' });
    expect(errors.some((e) => e.includes('lowercase'))).to.be.true;
  });

  it('rejects XML tags in name', () => {
    const errors = validateSkillFrontmatter({ name: '<script>', description: 'ok' });
    expect(errors.some((e) => e.includes('XML'))).to.be.true;
  });

  it('rejects reserved words in name', () => {
    const errors = validateSkillFrontmatter({ name: 'my-anthropic-skill', description: 'ok' });
    expect(errors.some((e) => e.includes('anthropic'))).to.be.true;
  });

  it('rejects "claude" in name', () => {
    const errors = validateSkillFrontmatter({ name: 'claude-helper', description: 'ok' });
    expect(errors.some((e) => e.includes('claude'))).to.be.true;
  });

  it('enforces description max length (1024)', () => {
    const long = 'x'.repeat(1025);
    const errors = validateSkillFrontmatter({ name: 'test', description: long });
    expect(errors.some((e) => e.includes('1024'))).to.be.true;
  });

  it('rejects XML tags in description', () => {
    const errors = validateSkillFrontmatter({ name: 'test', description: '<div>bad</div>' });
    expect(errors.some((e) => e.includes('XML'))).to.be.true;
  });

  it('collects multiple errors', () => {
    const errors = validateSkillFrontmatter({});
    expect(errors.length).to.be.greaterThanOrEqual(2);
  });
});

describe('ensureSkillFrontmatter', () => {
  it('injects frontmatter when absent', () => {
    const result = ensureSkillFrontmatter('Just body text', 'my-skill', 'approved');
    expect(result.injected).to.be.true;
    expect(result.markdown).to.include('---');
    expect(result.markdown).to.include('name: my-skill');
    expect(result.markdown).to.include('status: approved');
    expect(result.markdown).to.include('Just body text');
    expect(result.warnings).to.deep.equal([]);
  });

  it('preserves existing frontmatter and validates', () => {
    const md = '---\nname: existing\ndescription: ok\n---\n\nBody';
    const result = ensureSkillFrontmatter(md, 'fallback', 'draft');
    expect(result.injected).to.be.false;
    expect(result.markdown).to.equal(md);
    expect(result.warnings).to.deep.equal([]);
  });

  it('returns warnings for invalid existing frontmatter', () => {
    const md = '---\nname: BAD NAME\ndescription: \n---\n\nBody';
    const result = ensureSkillFrontmatter(md, 'fallback', 'draft');
    expect(result.injected).to.be.false;
    expect(result.warnings.length).to.be.greaterThan(0);
  });

  it('handles null/undefined markdown', () => {
    const result = ensureSkillFrontmatter(null, 'my-skill', 'draft');
    expect(result.injected).to.be.true;
    expect(result.markdown).to.include('name: my-skill');
    expect(result.markdown).to.include('status: draft');
  });
});
