import { expect } from '@esm-bundle/chai';
import '../../tools/quick-blocks/quick-blocks.js';

describe('Quick Blocks add icon alignment', () => {
  let style;
  let button;

  before(async () => {
    style = document.createElement('style');
    const response = await fetch('/tools/quick-blocks/quick-blocks.css');
    expect(response.ok).to.equal(true);
    style.textContent = await response.text();
    document.head.append(style);
  });

  after(() => style.remove());
  afterEach(() => button.remove());

  [13, 18, 24].forEach((fontSize) => {
    it(`centers the plus independently of the ${fontSize}px inherited font`, () => {
      const element = document.createElement('ew-quick-blocks');
      const template = element._renderAdd({ name: 'Paragraph' }, '<p>Paragraph</p>');
      const parsed = new DOMParser().parseFromString(template.strings.join(''), 'text/html');
      const icon = parsed.querySelector('.quick-add-icon');
      expect(icon.getAttribute('aria-hidden')).to.equal('true');
      expect(icon.textContent.trim()).to.equal('');
      expect(icon.querySelector('svg').getAttribute('viewBox')).to.equal('0 0 12 12');

      button = document.createElement('button');
      button.className = 'quick-add';
      button.style.fontSize = `${fontSize}px`;
      button.style.width = '360px';
      button.append(document.createElement('span'), icon);
      document.body.append(button);

      const badge = icon.getBoundingClientRect();
      const glyph = icon.querySelector('svg').getBoundingClientRect();
      const bounds = button.getBoundingClientRect();
      expect(badge.width).to.equal(22);
      expect(badge.height).to.equal(22);
      expect(glyph.width).to.equal(12);
      expect(glyph.height).to.equal(12);
      expect(Math.abs((glyph.left + glyph.width / 2) - (badge.left + badge.width / 2)))
        .to.be.lessThan(0.5);
      expect(Math.abs((glyph.top + glyph.height / 2) - (badge.top + badge.height / 2)))
        .to.be.lessThan(0.5);
      expect(Math.abs((badge.top + badge.height / 2) - (bounds.top + bounds.height / 2)))
        .to.be.lessThan(0.5);
    });
  });
});

describe('Quick Blocks Properties shortcut', () => {
  let element;
  let opened;

  beforeEach(() => {
    element = document.createElement('ew-quick-blocks');
    opened = [];
    element._actions = { showPanel: (name) => opened.push(name) };
  });

  ['blocks', 'assets'].forEach((tab) => {
    it(`keeps the tab row above the heading and instructions on the ${tab} tab`, () => {
      element._tab = tab;
      const template = element.render();
      const parsed = new DOMParser().parseFromString(template.strings.join(''), 'text/html');
      expect(parsed.body.firstElementChild.className).to.equal('quick-tabs');
      expect(parsed.body.firstElementChild.nextElementSibling.className).to.equal('quick-header');
      expect(parsed.querySelector('.quick-header h1').textContent).to.equal('Quick Blocks');
    });
  });

  it('opens the host Block panel without switching to a local Properties tab', () => {
    element._selectTab('properties');
    expect(opened).to.deep.equal(['block']);
    expect(element._tab).to.equal('blocks');
    expect(element.render().strings.join('')).not.to.include('quick-properties-panel');
  });

  it('opens the block library with the exact requested item without inserting content', () => {
    const calls = [];
    element._actions.showPanel = (...args) => calls.push(args);
    element._openLibrary({ name: 'Cards', path: 'https://example.com/library/cards' });
    expect(calls).to.deep.equal([
      ['blocks', { blockPath: 'https://example.com/library/cards' }],
    ]);
    expect(element._tab).to.equal('blocks');
  });

  it('reports a disconnected editor when opening the block library', () => {
    element._actions = {};
    element._openLibrary({ name: 'Cards', path: 'https://example.com/library/cards' });
    expect(element._error).to.equal('The editor is not connected.');
  });

  it('selects Assets from navigation options and does not reload already requested images', () => {
    const messages = [];
    element._editorOrigin = window.location.origin;
    const original = window.parent.postMessage;
    window.parent.postMessage = (message) => messages.push(message);
    try {
      element._applyPanelOptions({ tab: 'assets' });
      expect(element._tab).to.equal('assets');
      expect(messages).to.deep.equal([{ type: 'ew-asset-list-request', more: false }]);
      element._assetLoading = false;
      element._applyPanelOptions({ tab: 'blocks' });
      expect(element._tab).to.equal('blocks');
      element._applyPanelOptions({ tab: 'assets' });
      expect(messages).to.have.length(1);
    } finally {
      window.parent.postMessage = original;
    }
  });

  it('preserves the Assets tab and its loaded images when opening the host panel', () => {
    element._tab = 'assets';
    element._assetsRequested = true;
    const assets = [{ name: 'Image', asset: { 'repo:id': 'image' } }];
    element._assets = assets;
    element._selectTab('properties');
    expect(opened).to.deep.equal(['block']);
    expect(element._tab).to.equal('assets');
    expect(element._assets).to.equal(assets);
    expect(element._assetLoading).to.equal(false);
  });

  it('reports an unavailable SDK action on either active tab', () => {
    element._actions = {};
    element._selectTab('properties');
    expect(element._error).to.equal('The editor is not connected.');
    expect(element._tab).to.equal('blocks');
    element._tab = 'assets';
    element._selectTab('properties');
    expect(element._assetError).to.equal('The editor is not connected.');
    expect(element._tab).to.equal('assets');
    expect(opened).to.deep.equal([]);
  });

  ['blocks', 'assets'].forEach((tab) => {
    it(`opens the Block panel when a block is selected on the ${tab} tab`, () => {
      element._tab = tab;
      element._onBlockSelection();
      expect(opened).to.deep.equal(['block']);
      expect(element._tab).to.equal(tab);
    });
  });

  it('ignores block selection right after its own insert', () => {
    element._now = () => 1000;
    element._actions.sendHTML = () => {};
    element._add('<p>x</p>');
    element._now = () => 1400;
    element._onBlockSelection();
    expect(opened).to.deep.equal([]);
    element._now = () => 1501;
    element._onBlockSelection();
    expect(opened).to.deep.equal(['block']);
  });

  it('ignores block selection right after a drag', () => {
    element._now = () => 1000;
    element._dragEnd();
    element._now = () => 1200;
    element._onBlockSelection();
    expect(opened).to.deep.equal([]);
  });

  it('ignores block selection silently without showPanel', () => {
    element._actions = {};
    element._onBlockSelection();
    expect(element._error).to.equal('');
  });
});
