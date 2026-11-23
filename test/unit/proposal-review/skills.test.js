import { expect } from '@esm-bundle/chai';
import { hasPageProposalSkill } from '../../../tools/proposal-review/skills.js';

const AO = 'https://agent-orchestrator-prod-va7.adobe.io';
const CMA = 'https://aem-sites-claudebridge-va6.adobe.io';

describe('Proposal review Coworker skill lookup', () => {
  let profile;
  let profileStatus;
  let orgConfig;
  let siteConfig;
  let catalog;
  let catalogStatus;
  let resolved;
  let resolvedStatus;
  let requests;
  let search;

  beforeEach(() => {
    profile = {
      userId: 'test-user',
      projectedProductContext: [{ prodCtx: { owningEntity: 'ims-tenant' } }],
    };
    profileStatus = 200;
    orgConfig = { flags: { data: [
      { key: 'ew.coworker', value: 'cma' },
      { key: 'ew.coworkerManifest', value: 'org-manifest' },
    ] } };
    siteConfig = { flags: { data: [
      { key: 'ew.coworker', value: 'true' },
      { key: 'ew.coworkerManifest', value: 'site-manifest' },
    ] } };
    catalog = { skills: [{ name: 'page-proposals', hidden: true, user_invocable: false }] };
    catalogStatus = 200;
    resolved = { manifest_id: 'personal-manifest' };
    resolvedStatus = 200;
    requests = [];
    search = '';
  });

  const lookup = () => hasPageProposalSkill({
    org: 'org',
    site: 'site',
    search,
    daFetch: async (url, options) => {
      requests.push({ url: new URL(url), ...options, headers: { ...options.headers } });
      const { pathname } = new URL(url);
      if (pathname === '/ims/profile/v1') return Response.json(profile, { status: profileStatus });
      if (pathname === '/config/org/') return Response.json(orgConfig);
      if (pathname === '/config/org/site/') {
        return siteConfig ? Response.json(siteConfig) : new Response(null, { status: 404 });
      }
      if (pathname === '/api/v1/overrides/user/resolved') {
        return Response.json(resolved, { status: resolvedStatus });
      }
      if (pathname === '/api/v1/skills') return Response.json(catalog, { status: catalogStatus });
      throw new Error(`Unexpected request: ${url}`);
    },
  });

  const skillRequest = () => requests.find(({ url }) => url.pathname === '/api/v1/skills');
  const fails = async (message) => {
    let error;
    try { await lookup(); } catch (caught) { error = caught; }
    expect(error).to.be.instanceOf(Error);
    expect(error.message).to.include(message);
    expect(requests.every(({ method }) => !method || method === 'GET')).to.equal(true);
  };

  it('uses IMS tenant context and site overrides, including configured non-menu skills', async () => {
    expect(await lookup()).to.equal(true);
    const request = skillRequest();
    expect(request.url.origin).to.equal(AO);
    expect(request.url.searchParams.get('manifest_id')).to.equal('site-manifest');
    expect(request.headers).to.deep.equal({ 'x-tenant-id': 'ims-tenant' });
    expect(request.cache).to.equal('no-store');
    const account = requests.find(({ url }) => url.pathname === '/ims/profile/v1');
    expect(account.url.searchParams.get('client_id')).to.equal('darkalley');
    expect(account.headers).to.deep.equal({ client_id: 'darkalley' });
    expect(requests.some(({ url }) => url.pathname.includes('overrides'))).to.equal(false);
    expect(requests.every(({ method }) => !method || method === 'GET')).to.equal(true);
  });

  it('selects CMA only with an entitlement on the selected tenant and supplies the user ID', async () => {
    siteConfig.flags.data[0].value = 'cma';
    profile.projectedProductContext.push({ prodCtx: {
      owningEntity: 'ims-tenant', serviceCode: 'acp',
    } });
    expect(await lookup()).to.equal(true);
    expect(skillRequest().url.origin).to.equal(CMA);
    expect(skillRequest().headers).to.deep.equal({
      'x-tenant-id': 'ims-tenant', 'x-user-id': 'test-user',
    });
  });

  it('does not mistake another tenant entitlement for a configured CMA account', async () => {
    siteConfig.flags.data[0].value = 'cma';
    profile.projectedProductContext.push({ prodCtx: {
      owningEntity: 'another-tenant', serviceCode: 'acp',
    } });
    await fails('Coworker is not enabled');
    expect(skillRequest()).to.equal(undefined);
  });

  it('uses the profile-selected AO region and resolved personal manifest', async () => {
    orgConfig = {};
    siteConfig.flags.data.pop();
    profile.projectedProductContext[0].prodCtx = {
      owningEntity: 'ims-tenant',
      serviceCode: 'dma_tartan',
      statusCode: 'ACTIVE',
      fulfillable_data: JSON.stringify({ region: 'IRL1', environment: 'PROD' }),
    };
    expect(await lookup()).to.equal(true);
    expect(skillRequest().url.origin).to.equal('https://agent-orchestrator-prod-irl1.adobe.io');
    expect(skillRequest().url.searchParams.get('manifest_id')).to.equal('personal-manifest');
    const request = requests.find(({ url }) => url.pathname.includes('overrides'));
    expect(request.url.origin).to.equal(skillRequest().url.origin);
    expect(request.headers).to.deep.equal({ 'x-tenant-id': 'ims-tenant' });
  });

  it('uses org flags and the default manifest without materializing missing config or overrides', async () => {
    orgConfig = { flags: { data: [{ key: 'ew.coworker', value: 'true' }] } };
    siteConfig = null;
    resolvedStatus = 404;
    expect(await lookup()).to.equal(true);
    expect(skillRequest().url.searchParams.get('manifest_id')).to.equal('experience-workspace');
    expect(requests.every(({ method }) => !method || method === 'GET')).to.equal(true);
  });

  it('honors explicit chat and manifest query overrides on the extension URL', async () => {
    orgConfig = {};
    siteConfig = {};
    search = '?nx-chat-ao=true&nx-chat-ao-manifest=query%2Fmanifest';
    expect(await lookup()).to.equal(true);
    expect(skillRequest().url.searchParams.get('manifest_id')).to.equal('query/manifest');
    expect(skillRequest().url.search).to.equal('?manifest_id=query%2Fmanifest');
  });

  [[], [{ name: 'another-skill' }]].forEach((skills) => {
    it(`reports the skill missing in a valid ${skills.length ? 'other-skill' : 'empty'} catalog`, async () => {
      catalog = { skills };
      expect(await lookup()).to.equal(false);
    });
  });

  [401, 503].forEach((status) => {
    it(`does not interpret a ${status} catalog failure as an absent skill`, async () => {
      catalogStatus = status;
      await fails(`Coworker skills (${status})`);
    });
  });

  [{}, { skills: [null] }].forEach((response) => {
    it('does not interpret a malformed catalog as an absent skill', async () => {
      catalog = response;
      await fails('Invalid Coworker skills');
    });
  });

  it('does not guess a manifest after a failed resolved-manifest request', async () => {
    orgConfig = {};
    siteConfig.flags.data.pop();
    resolvedStatus = 503;
    await fails('Coworker manifest (503)');
    expect(skillRequest()).to.equal(undefined);
  });

  it('does not substitute the DA org for missing IMS tenant context', async () => {
    profile.projectedProductContext = [];
    await fails('Coworker account organization is unavailable');
    expect(skillRequest()).to.equal(undefined);
  });

  it('does not interpret an IMS authentication failure as an absent skill', async () => {
    profileStatus = 401;
    await fails('Coworker account (401)');
    expect(skillRequest()).to.equal(undefined);
  });

  it('keeps regional requests on approved Adobe hosts if profile location data is malformed', async () => {
    profile.projectedProductContext[0].prodCtx = {
      owningEntity: 'ims-tenant',
      serviceCode: 'acp',
      statusCode: 'ACTIVE',
      fulfillable_data: JSON.stringify({ region: 'va7.attacker.test/path', environment: 'prod' }),
    };
    expect(await lookup()).to.equal(true);
    expect(skillRequest().url.origin).to.equal(AO);
  });
});
