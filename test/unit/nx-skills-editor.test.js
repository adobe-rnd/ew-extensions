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
import '../../blocks/skills/nx-skills-editor.js';
import { setSkillsBackend } from '../../blocks/skills/skills-editor-api.js';
import { initAuth } from '../../blocks/skills/utils/da-fetch.js';

/**
 * Component-level regression guard for the reported bug: when `ew.altHarness`
 * is set only at the ORG level, the chat switched to the CMA bridge but the
 * Skills Editor did not — so no CMA skills were listed and the MCP tab showed
 * presets instead of the agent's real AEM bridge servers.
 *
 * Drives the real `_reload()` with fetch + IMS stubbed, asserting that the
 * editor flips to the bridge and populates BOTH skills and the AEM MCP server.
 */
describe('NxSkillsEditor._reload — altHarness detection (org-level flag)', () => {
  const realFetch = window.fetch;
  const realAdobeIMS = window.adobeIMS;

  const BRIDGE_SKILLS = {
    skills: [{
      id: 'skill-uuid-1', name: 'my-skill', scope: 'owner', description: 'd', display_name: 'My Skill', lineCount: 2,
    }],
  };
  const BRIDGE_MCP = {
    agent: [{ name: 'AEM', url: 'https://aem-mcp.example/mcp', tools: [{ name: 'list_pages', description: '' }] }],
    org: [],
    user: [],
  };

  // Routes a stubbed response by URL. `orgFlags`/`siteFlags` populate the
  // respective DA config `flags` sheet so each test picks where the flag lives.
  function stubFetch({ orgFlags = [], siteFlags = [] } = {}) {
    const calls = [];
    window.fetch = async (url, opts = {}) => {
      const u = String(url);
      calls.push({ u, method: opts.method || 'GET' });
      const cfg = (flags) => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ flags: { data: flags }, 'mcp-servers': { data: [] }, agents: { data: [] } }),
        text: async () => '',
      });
      // DA config: site has two path segments after /config/, org has one.
      if (/\/config\/[^/]+\/[^/]+\/$/.test(u)) return cfg(siteFlags);
      if (/\/config\/[^/]+\/$/.test(u)) return cfg(orgFlags);
      // Skills permission HEAD on /source/.../.da/skills/ → 404 (optimistic true).
      if (u.includes('/.da/skills/')) return { ok: false, status: 404, headers: new Headers() };
      // Bridge endpoints.
      if (u.includes('/api/v1/skills')) return { ok: true, status: 200, json: async () => BRIDGE_SKILLS };
      if (u.includes('/api/v1/mcp-servers')) return { ok: true, status: 200, json: async () => BRIDGE_MCP };
      // Anything else: empty-ok.
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({}), text: async () => '' };
    };
    return calls;
  }

  function makeEditor(org, site) {
    const el = document.createElement('nx-skills-editor');
    // _org/_site are getters off the HashController; stub its resolved value.
    el._hash = { value: { org, site } };
    return el;
  }

  beforeEach(() => {
    initAuth('test-ims-token');
    window.adobeIMS = {
      getAccessToken: () => ({ token: 'test-ims-token' }),
      getProfile: async () => ({
        userId: 'user-123',
        projectedProductContext: [{ prodCtx: { owningEntity: 'ORGID123@AdobeOrg' } }],
      }),
    };
  });

  afterEach(() => {
    window.fetch = realFetch;
    window.adobeIMS = realAdobeIMS;
    setSkillsBackend({ altHarness: false });
    initAuth(null);
  });

  it('flips to the bridge when ew.altHarness is set ONLY at the org level', async () => {
    const calls = stubFetch({ orgFlags: [{ key: 'ew.altHarness', value: 'cma-key' }], siteFlags: [] });
    const el = makeEditor('ew-org-flagged', 'site-1');

    await el._reload();

    // altHarness is proven by its observable effects: the editor talked to the
    // bridge and populated skills + the AEM MCP server from it.
    // Skills came from the CMA bridge catalog, not the empty config sheet.
    expect(Object.keys(el._skills)).to.include('my-skill');
    // MCP "Connected" list is the agent's real AEM server, not a hardcoded preset.
    const aem = (el._builtinMcpServers || []).find((s) => s.id === 'AEM');
    expect(aem, 'AEM bridge MCP server should be present').to.exist;
    expect(aem.tools.map((t) => t.name)).to.include('list_pages');
    // Proof it actually talked to the bridge.
    expect(calls.some((c) => c.u.includes('/api/v1/skills'))).to.be.true;
    expect(calls.some((c) => c.u.includes('/api/v1/mcp-servers'))).to.be.true;
  });

  it('stays on the AO/da-agent path (no bridge calls) when no ew.altHarness anywhere', async () => {
    const calls = stubFetch({ orgFlags: [], siteFlags: [] });
    const el = makeEditor('ew-unflagged', 'site-2');

    await el._reload();

    // No bridge traffic and no bridge-sourced MCP servers on the AO path.
    expect(el._builtinMcpServers).to.deep.equal([]);
    expect(calls.some((c) => c.u.includes('/api/v1/mcp-servers'))).to.be.false;
  });
});
