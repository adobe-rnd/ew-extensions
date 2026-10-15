import { expect } from '@esm-bundle/chai';
import '../../tools/quick-blocks/quick-blocks.js';

describe('Quick Blocks Properties shortcut', () => {
  let element;
  let opened;

  beforeEach(() => {
    element = document.createElement('ew-quick-blocks');
    opened = [];
    element._actions = { showPanel: (name) => opened.push(name) };
  });

  it('opens the host Block panel without switching to a local Properties tab', () => {
    element._selectTab('properties');
    expect(opened).to.deep.equal(['block']);
    expect(element._tab).to.equal('blocks');
    expect(element.render().strings.join('')).not.to.include('quick-properties-panel');
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
});
