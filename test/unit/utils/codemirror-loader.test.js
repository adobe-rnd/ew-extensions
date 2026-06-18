import { expect } from '@esm-bundle/chai';
import { resolveNxOrigin, replaceDoc, destroyEditor } from '../../../blocks/skills/utils/codemirror-loader.js';

// ── resolveNxOrigin ─────────────────────────────────────────────────────────

describe('resolveNxOrigin', () => {
  it('returns da.live when no nx param is present', () => {
    expect(resolveNxOrigin('')).to.equal('https://da.live');
  });

  it('returns da.live when nx param is absent among other params', () => {
    expect(resolveNxOrigin('?foo=bar&baz=1')).to.equal('https://da.live');
  });

  it('returns localhost:6456 for nx=local', () => {
    expect(resolveNxOrigin('?nx=local')).to.equal('http://localhost:6456');
  });

  it('builds an aem.live branch URL for valid branch names', () => {
    expect(resolveNxOrigin('?nx=ew')).to.equal('https://ew--da-nx--adobe.aem.live');
  });

  it('builds an aem.live branch URL for hyphenated names', () => {
    expect(resolveNxOrigin('?nx=ew-omega-v2'))
      .to.equal('https://ew-omega-v2--da-nx--adobe.aem.live');
  });

  it('accepts names up to 63 characters', () => {
    const name = `a${'b'.repeat(62)}`;
    expect(resolveNxOrigin(`?nx=${name}`))
      .to.equal(`https://${name}--da-nx--adobe.aem.live`);
  });

  it('uses window.location.search when no arg provided', () => {
    const result = resolveNxOrigin();
    expect(result).to.be.a('string');
  });

  // ── Security: reject dangerous / invalid nx values ──

  it('falls back to da.live for names exceeding 63 characters', () => {
    expect(resolveNxOrigin(`?nx=${'a'.repeat(64)}`)).to.equal('https://da.live');
  });

  it('falls back to da.live for uppercase characters', () => {
    expect(resolveNxOrigin('?nx=EW')).to.equal('https://da.live');
  });

  it('falls back to da.live for names starting with a hyphen', () => {
    expect(resolveNxOrigin('?nx=-bad')).to.equal('https://da.live');
  });

  it('falls back to da.live for dots (subdomain injection)', () => {
    expect(resolveNxOrigin('?nx=evil.com')).to.equal('https://da.live');
  });

  it('falls back to da.live for slashes (path injection)', () => {
    expect(resolveNxOrigin('?nx=evil/path')).to.equal('https://da.live');
  });

  it('falls back to da.live for spaces', () => {
    expect(resolveNxOrigin('?nx=has%20space')).to.equal('https://da.live');
  });

  it('falls back to da.live for special characters', () => {
    expect(resolveNxOrigin('?nx=a@b')).to.equal('https://da.live');
  });

  it('falls back to da.live for empty nx param', () => {
    expect(resolveNxOrigin('?nx=')).to.equal('https://da.live');
  });

  it('falls back to da.live for protocol injection attempts', () => {
    expect(resolveNxOrigin('?nx=javascript:alert(1)')).to.equal('https://da.live');
  });

  it('falls back to da.live for template literal injection', () => {
    expect(resolveNxOrigin('?nx=${evil}')).to.equal('https://da.live');
  });

  it('falls back to da.live for backslash sequences', () => {
    expect(resolveNxOrigin('?nx=a\\b')).to.equal('https://da.live');
  });

  it('falls back to da.live for null bytes', () => {
    expect(resolveNxOrigin('?nx=a%00b')).to.equal('https://da.live');
  });
});

// ── replaceDoc ──────────────────────────────────────────────────────────────

describe('replaceDoc', () => {
  function makeMockView(initialDoc) {
    const dispatched = [];
    return {
      state: { doc: { toString: () => initialDoc } },
      dispatch(tx) { dispatched.push(tx); },
      _dispatched: dispatched,
    };
  }

  it('dispatches a replacement when text differs', () => {
    const view = makeMockView('old content');
    replaceDoc(view, 'new content');
    expect(view._dispatched).to.have.lengthOf(1);
    const { changes } = view._dispatched[0];
    expect(changes.from).to.equal(0);
    expect(changes.to).to.equal('old content'.length);
    expect(changes.insert).to.equal('new content');
  });

  it('skips dispatch when text is identical', () => {
    const view = makeMockView('same');
    replaceDoc(view, 'same');
    expect(view._dispatched).to.have.lengthOf(0);
  });

  it('handles empty-to-content transition', () => {
    const view = makeMockView('');
    replaceDoc(view, '# Hello');
    expect(view._dispatched).to.have.lengthOf(1);
    expect(view._dispatched[0].changes.insert).to.equal('# Hello');
  });

  it('handles null view gracefully', () => {
    expect(() => replaceDoc(null, 'text')).to.not.throw();
  });

  it('handles undefined view gracefully', () => {
    expect(() => replaceDoc(undefined, 'text')).to.not.throw();
  });
});

// ── destroyEditor ───────────────────────────────────────────────────────────

describe('destroyEditor', () => {
  it('calls destroy on the view', () => {
    let called = false;
    destroyEditor({ destroy() { called = true; } });
    expect(called).to.be.true;
  });

  it('handles null gracefully', () => {
    expect(() => destroyEditor(null)).to.not.throw();
  });

  it('handles undefined gracefully', () => {
    expect(() => destroyEditor(undefined)).to.not.throw();
  });
});
