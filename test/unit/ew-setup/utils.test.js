import { expect } from '@esm-bundle/chai';
import {
  parseOrgSite,
  findEditorPathRows,
  hasEditorPathForSite,
  buildUpdatedConfig,
  hasCorrectSidekickConfig,
  buildUpdatedSidekickConfig,
} from '../../../tools/ew-setup/utils.js';

describe('parseOrgSite', () => {
  it('parses /org/site', () => {
    expect(parseOrgSite('/myorg/mysite')).to.deep.equal({ org: 'myorg', site: 'mysite' });
  });
  it('parses org/site without leading slash', () => {
    expect(parseOrgSite('myorg/mysite')).to.deep.equal({ org: 'myorg', site: 'mysite' });
  });
  it('strips trailing slashes', () => {
    expect(parseOrgSite('/myorg/mysite/')).to.deep.equal({ org: 'myorg', site: 'mysite' });
  });
  it('returns null for empty input', () => {
    expect(parseOrgSite('')).to.be.null;
    expect(parseOrgSite(null)).to.be.null;
  });
  it('returns null when only one segment', () => {
    expect(parseOrgSite('/myorg')).to.be.null;
  });
  it('returns null when three or more segments', () => {
    expect(parseOrgSite('/myorg/mysite/extra')).to.be.null;
  });
});

describe('findEditorPathRows', () => {
  it('returns rows from flat sheet', () => {
    const json = { data: [{ key: 'editor.path', value: '/o/s=https://da.live/canvas#' }] };
    const { sheetKey, rows } = findEditorPathRows(json);
    expect(sheetKey).to.be.null;
    expect(rows).to.have.length(1);
  });
  it('returns rows from named sheet', () => {
    const json = { ':type': 'multi-sheet', settings: { data: [{ key: 'editor.path', value: '/o/s=x' }] } };
    const { sheetKey, rows } = findEditorPathRows(json);
    expect(sheetKey).to.equal('settings');
    expect(rows).to.have.length(1);
  });
  it('returns empty rows for null', () => {
    const { sheetKey, rows } = findEditorPathRows(null);
    expect(sheetKey).to.be.null;
    expect(rows).to.have.length(0);
  });
  it('returns empty rows when all keys are colon-prefixed', () => {
    const json = { ':type': 'multi-sheet', ':names': ['settings'] };
    const { sheetKey, rows } = findEditorPathRows(json);
    expect(sheetKey).to.be.null;
    expect(rows).to.have.length(0);
  });
});

describe('hasEditorPathForSite', () => {
  it('returns true when site entry exists', () => {
    const rows = [{ key: 'editor.path', value: '/myorg/mysite=https://da.live/canvas#' }];
    expect(hasEditorPathForSite(rows, 'myorg', 'mysite')).to.be.true;
  });
  it('returns false when only other sites exist', () => {
    const rows = [{ key: 'editor.path', value: '/myorg/othersite=https://da.live/canvas#' }];
    expect(hasEditorPathForSite(rows, 'myorg', 'mysite')).to.be.false;
  });
  it('returns false for empty rows', () => {
    expect(hasEditorPathForSite([], 'myorg', 'mysite')).to.be.false;
  });
  it('returns false for rows without a value property', () => {
    const rows = [{ key: 'editor.path' }, { key: 'other' }];
    expect(hasEditorPathForSite(rows, 'myorg', 'mysite')).to.be.false;
  });
});

describe('hasCorrectSidekickConfig', () => {
  const PATTERN = 'https://da.live/canvas#/{{org}}/{{site}}{{pathname}}';
  it('returns true when editUrlPattern matches', () => {
    expect(hasCorrectSidekickConfig({ editUrlPattern: PATTERN })).to.be.true;
  });
  it('returns false when editUrlPattern differs', () => {
    expect(hasCorrectSidekickConfig({ editUrlPattern: 'https://other.example.com' })).to.be.false;
  });
  it('returns false when editUrlPattern is missing', () => {
    expect(hasCorrectSidekickConfig({ project: 'My Project' })).to.be.false;
  });
  it('returns false for null input', () => {
    expect(hasCorrectSidekickConfig(null)).to.be.false;
  });
});

describe('buildUpdatedSidekickConfig', () => {
  const PATTERN = 'https://da.live/canvas#/{{org}}/{{site}}{{pathname}}';
  it('creates bare minimum config when existingJson is null', () => {
    const result = buildUpdatedSidekickConfig(null);
    expect(result).to.deep.equal({ project: 'Experience Workspace Project', editUrlPattern: PATTERN });
  });
  it('injects editUrlPattern into existing config', () => {
    const result = buildUpdatedSidekickConfig({ project: 'My Project', plugins: [] });
    expect(result.editUrlPattern).to.equal(PATTERN);
    expect(result.project).to.equal('My Project');
    expect(result.plugins).to.deep.equal([]);
  });
  it('overwrites an existing editUrlPattern', () => {
    const result = buildUpdatedSidekickConfig({ editUrlPattern: 'https://old.example.com' });
    expect(result.editUrlPattern).to.equal(PATTERN);
  });
  it('does not mutate the input object', () => {
    const input = { project: 'My Project' };
    buildUpdatedSidekickConfig(input);
    expect(input).to.not.have.property('editUrlPattern');
  });
});

describe('buildUpdatedConfig', () => {
  it('creates flat config when existingJson is null', () => {
    const result = buildUpdatedConfig(null, 'myorg', 'mysite');
    expect(result.data).to.have.length(1);
    expect(result.data[0]).to.deep.equal({
      key: 'editor.path',
      value: '/myorg/mysite=https://da.live/canvas#',
    });
  });
  it('appends to existing flat sheet rows', () => {
    const json = { data: [{ key: 'editor.path', value: '/myorg/other=https://da.live/canvas#' }] };
    const result = buildUpdatedConfig(json, 'myorg', 'mysite');
    expect(result.data).to.have.length(2);
    expect(result.data[1].value).to.equal('/myorg/mysite=https://da.live/canvas#');
  });
  it('appends to named sheet and preserves other sheets', () => {
    const json = {
      ':type': 'multi-sheet',
      ':names': ['settings'],
      settings: { data: [{ key: 'editor.path', value: '/myorg/other=x' }] },
    };
    const result = buildUpdatedConfig(json, 'myorg', 'mysite');
    expect(result.settings.data).to.have.length(2);
    expect(result[':type']).to.equal('multi-sheet');
  });
  it('does not mutate the input object', () => {
    const json = { data: [{ key: 'editor.path', value: '/o/s=x' }] };
    buildUpdatedConfig(json, 'org2', 'site2');
    expect(json.data).to.have.length(1);
  });
  it('returns existingJson unchanged when site is already configured', () => {
    const json = { data: [{ key: 'editor.path', value: '/myorg/mysite=https://da.live/canvas#' }] };
    const result = buildUpdatedConfig(json, 'myorg', 'mysite');
    expect(result).to.equal(json); // same reference — not a copy
    expect(result.data).to.have.length(1);
  });
});
