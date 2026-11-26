import { expect } from '@esm-bundle/chai';
import {
  getOperatorRegistry, OperatorInspector, resetOperatorCache,
} from '../../../tools/block-editor/operators.js';

describe('block editor operators', () => {
  const location = { origin: 'https://main--ew-extensions--adobe-rnd.aem.live', hostname: 'main--ew-extensions--adobe-rnd.aem.live' };
  const blockHtml = '<div class="form"><div><div>{}</div></div></div>';
  const block = (overrides = {}) => ({
    key: 'doc:0:form', url: 'https://ops.test/form.js', name: 'Form', variant: '', blockIndex: 0, html: blockHtml, editable: true, ...overrides,
  });
  const operatorModule = (operator) => () => Promise.resolve({ default: operator });

  afterEach(() => resetOperatorCache());

  it('builds the registry from operator rows, first row wins', () => {
    const registry = getOperatorRegistry([
      { block: 'cards', property: 'multi' },
      { block: 'My_Form', property: 'operator', value: '/tools/form.js' },
      { block: 'my form', property: 'operator', value: 'https://other.test/form.js' },
      { block: 'bad', property: 'operator', value: 'javascript:alert(1)' },
    ], { org: 'org', site: 'site' }, location);
    expect([...registry]).to.deep.equal([
      ['my form', 'https://main--site--org.preview.da.live/tools/form.js'],
    ]);
  });

  it('mounts the inspector contract and commits validated HTML', async () => {
    const commits = [];
    let ctx;
    const inspector = new OperatorInspector({
      importer: operatorModule({
        create(c) { ctx = c; return { inspector: { mount: (el) => { el.textContent = 'operator'; return {}; } } }; },
      }),
      commit: async (request) => { commits.push(request); return { ok: true }; },
    });
    await inspector.sync(block());
    expect(inspector.mounted).to.be.true;
    expect(inspector.container.textContent).to.equal('operator');
    expect(ctx.surface).to.equal('inspector');

    expect((await ctx.commit('<div class="cards"></div>')).error).to.equal('INVALID_HTML');
    const next = '<div class="form"><div><div>{"a":1}</div></div></div>';
    expect(await ctx.commit(next)).to.deep.equal({ ok: true });
    expect(commits).to.deep.equal([{ blockIndex: 0, html: next, blockHtml }]);
  });

  it('maps host errors and rejects commits on a read-only document', async () => {
    let ctx;
    const inspector = new OperatorInspector({
      importer: operatorModule({ create(c) { ctx = c; return { inspector: { mount: () => ({}) } }; } }),
      commit: async () => ({ ok: false, error: 'STALE_LIVE', message: 'changed' }),
    });
    await inspector.sync(block());
    expect((await ctx.commit(blockHtml)).error).to.equal('STALE');
    await inspector.sync(block({ editable: false }));
    expect((await ctx.commit(blockHtml)).error).to.equal('NOT_EDITABLE');
  });

  it('falls back to the fields form when the operator has no inspector or throws', async () => {
    const plain = new OperatorInspector({ importer: operatorModule({ create: () => ({}) }) });
    await plain.sync(block());
    expect(plain.mounted).to.be.false;

    const warn = console.warn; // eslint-disable-line no-console
    console.warn = () => {}; // eslint-disable-line no-console
    try {
      const broken = new OperatorInspector({ importer: operatorModule({ create() { throw new Error('boom'); } }) });
      await broken.sync(block({ url: 'https://ops.test/broken.js' }));
      expect(broken.mounted).to.be.false;
      expect(broken.failed.size).to.equal(1);
    } finally {
      console.warn = warn; // eslint-disable-line no-console
    }
  });
});
