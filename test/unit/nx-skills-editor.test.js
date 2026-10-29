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
import { renderChatDrawer, renderMarketplacePluginDetail } from '../../blocks/skills/renderers.js';
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

  // ─── chat harness selection (legacy da-agent must keep working) ──────────
  const CHAT_URL = 'https://da.live/nx2/blocks/chat/chat.js';
  const CHAT_AO_URL = 'https://da.live/nx2/blocks/chat-ao/chat-ao.js';

  // The stub LitElement does no attribute↔property reflection, so set the
  // import-url properties directly. _isChatOpen stays false (element never
  // connected), so _reload's finally does NOT trigger a real dynamic import of
  // the external da.live URL — we only assert the selection logic.
  function makeChatEditor(org, site) {
    const el = makeEditor(org, site);
    el._isChatOpen = false; // guard: keep _reload's finally from importing a real URL
    el.chatImportUrl = CHAT_URL;
    el.chatAoImportUrl = CHAT_AO_URL;
    return el;
  }

  it('legacy: with no ew.altHarness, the drawer selects the da-agent chat URL', async () => {
    stubFetch({ orgFlags: [], siteFlags: [] });
    const el = makeChatEditor('ew-unflagged', 'site-chat-1');

    await el._reload();

    expect(el._activeChatImportUrl()).to.equal(CHAT_URL);
    expect(el._chatActivationKey).to.equal(null);
  });

  it('alt harness: the drawer selects the nx-chat-ao URL and carries the activation key', async () => {
    stubFetch({ orgFlags: [], siteFlags: [{ key: 'ew.altHarness', value: 'cma-key' }] });
    const el = makeChatEditor('ew-site-flagged', 'site-chat-2');

    await el._reload();

    expect(el._activeChatImportUrl()).to.equal(CHAT_AO_URL);
    expect(el._chatActivationKey).to.equal('cma-key');
  });

  it('falls back to the da-agent chat URL when no chat-ao URL is provided', async () => {
    stubFetch({ orgFlags: [], siteFlags: [{ key: 'ew.altHarness', value: 'cma-key' }] });
    const el = makeEditor('ew-site-flagged', 'site-chat-3');
    el._isChatOpen = false;
    el.chatImportUrl = CHAT_URL; // chatAoImportUrl intentionally unset

    await el._reload();

    expect(el._activeChatImportUrl()).to.equal(CHAT_URL);
  });
});

/**
 * Pure regression guard for the drawer branching: the legacy da-agent path
 * must keep mounting <nx-chat>, and only the alt harness mounts <nx-chat-ao>.
 * da-lit is stubbed (html -> { strings, values }), so flatten the template to
 * text and assert on the tag it renders.
 */
describe('renderChatDrawer — harness branching', () => {
  function flattenTemplate(node) {
    if (node == null || typeof node === 'boolean' || typeof node === 'function') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(flattenTemplate).join('');
    if (node.strings) {
      return node.strings.reduce((acc, s, i) => acc + s + flattenTemplate(node.values[i]), '');
    }
    return '';
  }

  const baseVm = {
    isChatOpen: true,
    chatAgentId: 'skills-engineer',
    chatHarnessConfig: { key: 'org/site', altHarness: true, activationKey: 'k' },
    onToggleChat() {},
  };

  it('mounts the legacy da-agent nx-chat when altHarness is off', () => {
    const out = flattenTemplate(renderChatDrawer({ ...baseVm, chatAltHarness: false }));
    expect(out).to.include('<nx-chat ');
    expect(out).to.not.include('nx-chat-ao');
  });

  it('mounts nx-chat-ao when altHarness is on', () => {
    const out = flattenTemplate(renderChatDrawer({ ...baseVm, chatAltHarness: true }));
    expect(out).to.include('nx-chat-ao');
  });

  it('mounts no chat element while the drawer is closed (either harness)', () => {
    const legacyClosed = flattenTemplate(renderChatDrawer({ ...baseVm, isChatOpen: false, chatAltHarness: false }));
    const cmaClosed = flattenTemplate(renderChatDrawer({ ...baseVm, isChatOpen: false, chatAltHarness: true }));
    expect(legacyClosed).to.not.include('<nx-chat');
    expect(cmaClosed).to.not.include('<nx-chat');
  });
});

// ─── Marketplace tab: catalog/installed load, config-write gate, plugin detail ──
describe('NxSkillsEditor — Marketplace tab (list + detail)', () => {
  const realFetch = window.fetch;
  const realAdobeIMS = window.adobeIMS;

  function stubMarketplaceFetch({ write = true, installed = [], catalog } = {}) {
    const plugins = catalog || [{ name: 'web', description: 'Browser automation', version: '1.0.0' }];
    window.fetch = async (url) => {
      const u = String(url);
      if (u.includes('raw.githubusercontent.com')) {
        return { ok: true, status: 200, headers: new Headers(), json: async () => ({ plugins }) };
      }
      if (u.includes('/api/v1/overrides/user')) {
        return { ok: true, status: 200, headers: new Headers(), json: async () => ({ settings: { plugins: { installed } } }) };
      }
      if (u.includes('/config/')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(write ? { 'x-da-actions': '/s=read,write' } : {}),
          json: async () => ({ flags: { data: [] }, 'marketplace-sources': { data: [] }, 'mcp-servers': { data: [] }, agents: { data: [] } }),
          text: async () => '',
        };
      }
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({}), text: async () => '' };
    };
  }

  function makeEditor(org, site) {
    const el = document.createElement('nx-skills-editor');
    el._hash = { value: { org, site } };
    el._loadedKey = `${org}/${site}`;
    return el;
  }

  beforeEach(() => {
    initAuth('test-ims-token');
    window.adobeIMS = {
      getAccessToken: () => ({ token: 'test-ims-token' }),
      getProfile: async () => ({ userId: 'user-123', projectedProductContext: [{ prodCtx: { owningEntity: 'ORGID123@AdobeOrg' } }] }),
    };
  });

  afterEach(() => {
    window.fetch = realFetch;
    window.adobeIMS = realAdobeIMS;
    setSkillsBackend({ altHarness: false });
    initAuth(null);
  });

  it('loads the catalog + installed plugins, gates manage on config-write, opens the detail', async () => {
    setSkillsBackend({ altHarness: true });
    stubMarketplaceFetch({
      write: true,
      installed: [{
        ref: 'web', enabled: true, manifest: { name: 'web', description: 'Browser automation' }, resolved: { skills: [1], mcpServers: [] },
      }],
      catalog: [
        { name: 'web', description: 'Browser automation', version: '1.0.0' },
        { name: 'commerce', description: 'Commerce ops', version: '2.0.0' },
      ],
    });
    const el = makeEditor('ew-mkt', 'site-mkt');

    await el._ensurePluginsLoaded();

    // catalog loaded from the (built-in) source
    expect(el._marketplaceCatalog.map((e) => e.name)).to.include.members(['web', 'commerce']);
    // installed plugins loaded from the bridge
    expect(el._plugins.map((p) => p.ref)).to.deep.equal(['web']);
    // Add/Remove gated on config-write (x-da-actions granted write)
    expect(el._canManageSources).to.be.true;

    // clicking a plugin opens the detail drill-down
    el._onViewPlugin('web');
    expect(el._viewingPluginName).to.equal('web');
    expect(el._isEditorOpen).to.be.true;
    expect(el._catalogTab).to.equal('marketplace');

    // closing the detail clears it
    el._closeEditor();
    expect(el._viewingPluginName).to.equal(null);
    expect(el._isEditorOpen).to.be.false;
  });

  it('fails the manage gate closed when config-write is not granted', async () => {
    setSkillsBackend({ altHarness: true });
    stubMarketplaceFetch({ write: false });
    const el = makeEditor('ew-mkt2', 'site-mkt2');
    await el._ensurePluginsLoaded();
    expect(el._canManageSources).to.be.false;
  });
});

// ─── Marketplace plugin detail render (name/description/source + Adobe logo) ────
describe('renderMarketplacePluginDetail', () => {
  // String-flatten a lit-stub template (same approach as the chat-drawer tests).
  function flatten(node) {
    if (node == null || typeof node === 'boolean' || typeof node === 'function') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(flatten).join('');
    if (node.strings) return node.strings.reduce((acc, s, i) => acc + s + flatten(node.values[i]), '');
    return '';
  }

  function detailVm(over = {}) {
    return {
      viewingPluginName: 'web',
      plugins: [],
      marketplaceCatalog: [{
        name: 'web', description: 'Browser automation and web testing', version: '1.0.0',
        sourceOwner: 'adobe', sourceRepo: 'skills', builtIn: true, repository: 'https://github.com/adobe/skills',
      }],
      pluginBusyRef: {},
      onInstallPlugin() {}, onTogglePlugin() {}, onUninstallPlugin() {},
      ...over,
    };
  }

  it('renders full name, description, source, repo link + the Adobe logo for an adobe source', () => {
    const out = flatten(renderMarketplacePluginDetail(detailVm()));
    expect(out).to.include('web');
    expect(out).to.include('Browser automation and web testing');
    expect(out).to.include('adobe/skills');
    expect(out, 'Adobe logo').to.include('plugin-adobe-logo');
    expect(out, 'repo link').to.include('https://github.com/adobe/skills');
  });

  it('shows an Install action when not installed, Uninstall + Disable when installed', () => {
    expect(flatten(renderMarketplacePluginDetail(detailVm()))).to.include('Install');

    const installed = flatten(renderMarketplacePluginDetail(detailVm({
      plugins: [{ ref: 'web', enabled: true, manifest: { name: 'web', description: 'Browser automation and web testing', repository: 'https://github.com/adobe/skills' }, resolved: { skills: [1, 2], mcpServers: [] } }],
    })));
    expect(installed).to.include('Uninstall');
    expect(installed).to.include('Disable');
  });

  it('does NOT show the Adobe logo for a non-adobe source', () => {
    const out = flatten(renderMarketplacePluginDetail(detailVm({
      marketplaceCatalog: [{ name: 'web', description: 'x', sourceOwner: 'acme', sourceRepo: 'plugins', builtIn: false, repository: 'https://github.com/acme/plugins' }],
    })));
    expect(out).to.not.include('plugin-adobe-logo');
    expect(out).to.include('acme/plugins');
  });
});
