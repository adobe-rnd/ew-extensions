/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import { expect } from '@esm-bundle/chai';
import { renderSkillsCatalog } from '../../blocks/skills/renderers.js';

/**
 * Site-scope skills (issue #384): the bridge catalog response can include
 * `scope: "site"` items alongside personal ("owner") and org ones. The
 * catalog must badge them "Site" (grid card + list row) and NOT show a
 * delete/edit affordance for them, reusing the same `.badge` style the MCP
 * tab already uses for its personal/org badges.
 */
describe('renderSkillsCatalog — site-scope skill badge', () => {
  // Same string-flatten approach as the other renderers.js suites: da-lit is
  // stubbed (html -> { strings, values }), so flatten the template to text.
  function flatten(node) {
    if (node == null || typeof node === 'boolean' || typeof node === 'function') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(flatten).join('');
    if (node.strings) return node.strings.reduce((acc, s, i) => acc + s + flatten(node.values[i]), '');
    return '';
  }

  function baseVm(over = {}) {
    return {
      skills: { 'my-skill': '# Body', 'site-skill': '# Body' },
      skillScopes: { 'my-skill': 'owner', 'site-skill': 'site' },
      skillDisplayNames: { 'my-skill': 'My Skill', 'site-skill': 'Site Skill' },
      skillDescriptions: {},
      skillLineCounts: { 'my-skill': 2, 'site-skill': 3 },
      promptSearch: '',
      catalogFilter: 'all',
      catalogViewMode: 'grid',
      viewingSkillId: null,
      agents: [],
      onCardClick(e, fn) { fn(); },
      onCardKeydown(e, fn) { fn(); },
      onViewSkill() {},
      setCatalogFilter() {},
      setCatalogViewMode() {},
      ...over,
    };
  }

  it('grid view: badges a site-scope skill "Site" with the shared .badge class', () => {
    const out = flatten(renderSkillsCatalog(baseVm({ catalogViewMode: 'grid' })));
    expect(out).to.include('data-skill-id=site-skill');
    expect(out).to.include('<span class="badge">Site</span>');
  });

  it('list view: badges a site-scope skill "Site" with the shared .badge class', () => {
    const out = flatten(renderSkillsCatalog(baseVm({ catalogViewMode: 'list' })));
    expect(out).to.include('data-skill-id=site-skill');
    expect(out).to.include('<span class="badge">Site</span>');
  });

  it('does not badge a personal (owner-scope) skill as "Site"', () => {
    const out = flatten(renderSkillsCatalog(baseVm({ catalogViewMode: 'grid' })));
    expect(out).to.include('plugin-card-badge">Personal</span>');
    expect(out.match(/<span class="badge">Site<\/span>/g)).to.have.length(1);
  });
});
