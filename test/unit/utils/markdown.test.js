import { expect } from '@esm-bundle/chai';
import { extractTitle, extractToolRefs } from '../../../apps/skills/utils/markdown.js';

describe('extractTitle', () => {
  it('returns first ATX heading text', () => {
    expect(extractTitle('# Hello World')).to.equal('Hello World');
  });

  it('trims whitespace from heading', () => {
    expect(extractTitle('#   Spaced Title   ')).to.equal('Spaced Title');
  });

  it('returns first heading when multiple exist', () => {
    expect(extractTitle('# First\n## Second\n# Third')).to.equal('First');
  });

  it('finds heading after body text', () => {
    expect(extractTitle('Some text\n# The Heading\nMore text')).to.equal('The Heading');
  });

  it('returns empty string when no heading', () => {
    expect(extractTitle('No heading here')).to.equal('');
    expect(extractTitle('')).to.equal('');
  });

  it('returns empty string for falsy input', () => {
    expect(extractTitle(null)).to.equal('');
    expect(extractTitle(undefined)).to.equal('');
  });

  it('does not match ## or ### as h1', () => {
    expect(extractTitle('## Sub Heading')).to.equal('');
  });
});

describe('extractToolRefs', () => {
  it('extracts MCP tool references', () => {
    const md = 'Use mcp__github__create_pr to create a PR';
    const refs = extractToolRefs(md);
    expect(refs).to.include('mcp__github__create_pr');
  });

  it('extracts DA built-in tool references', () => {
    const md = 'Use da_content_read and da_content_write';
    const refs = extractToolRefs(md);
    expect(refs).to.include('da_content_read');
    expect(refs).to.include('da_content_write');
  });

  it('extracts both MCP and DA refs from same text', () => {
    const md = 'mcp__server__tool and da_list_things together';
    const refs = extractToolRefs(md);
    expect(refs).to.have.lengthOf(2);
    expect(refs).to.include('mcp__server__tool');
    expect(refs).to.include('da_list_things');
  });

  it('deduplicates references', () => {
    const md = 'da_read and da_read again';
    const refs = extractToolRefs(md);
    expect(refs.filter((r) => r === 'da_read')).to.have.lengthOf(1);
  });

  it('returns empty array for no matches', () => {
    expect(extractToolRefs('No tools here')).to.deep.equal([]);
    expect(extractToolRefs('')).to.deep.equal([]);
  });

  it('handles null/undefined input', () => {
    expect(extractToolRefs(null)).to.deep.equal([]);
    expect(extractToolRefs(undefined)).to.deep.equal([]);
  });

  it('handles hyphens and numbers in MCP IDs', () => {
    const md = 'mcp__my-server-2__get_thing';
    const refs = extractToolRefs(md);
    expect(refs).to.include('mcp__my-server-2__get_thing');
  });
});
