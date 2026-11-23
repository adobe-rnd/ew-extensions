const IMS_CLIENT_ID = 'darkalley';
const IMS_PROFILE = `https://ims-na1.adobelogin.com/ims/profile/v1?client_id=${IMS_CLIENT_ID}`;
const AO_BASE = 'https://agent-orchestrator-prod-va7.adobe.io';
const CMA_BASE = 'https://aem-sites-claudebridge-va6.adobe.io';
const SERVICE_CODES = ['acp', 'dma_tartan'];

function aoBase(contexts) {
  const active = contexts.find(({ prodCtx } = {}) => prodCtx?.statusCode === 'ACTIVE'
    && SERVICE_CODES.includes(prodCtx.serviceCode));
  try {
    const location = JSON.parse(active?.prodCtx.fulfillable_data ?? 'null');
    const region = location?.region?.toLowerCase();
    const environment = location?.environment?.toLowerCase();
    if (/^[a-z0-9-]+$/.test(region || '') && /^[a-z0-9-]+$/.test(environment || '')) {
      return `https://agent-orchestrator-${environment}-${region}.adobe.io`;
    }
  } catch { /* Use NX's default AO region when location data is unavailable. */ }
  return AO_BASE;
}

export async function hasPageProposalSkill({
  org, site, daFetch, search = window.location.search,
}) {
  const read = async (url, label, { optional = false, headers } = {}) => {
    const response = await daFetch(url, {
      headers, cache: 'no-store', signal: AbortSignal.timeout(10000),
    });
    if (optional && response.status === 404) return {};
    if (!response.ok) throw new Error(`Could not load ${label} (${response.status}).`);
    const json = await response.json();
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      throw new Error(`Invalid ${label} response.`);
    }
    return json;
  };
  const configRoot = `https://admin.da.live/config/${encodeURIComponent(org)}`;
  const [profile, orgConfig, siteConfig] = await Promise.all([
    read(IMS_PROFILE, 'Coworker account', { headers: { client_id: IMS_CLIENT_ID } }),
    read(`${configRoot}/`, 'organization settings', { optional: true }),
    read(`${configRoot}/${encodeURIComponent(site)}/`, 'site settings', { optional: true }),
  ]);
  const flags = {};
  [orgConfig, siteConfig].forEach((config) => {
    (config.flags?.data ?? []).forEach(({ key, value }) => { flags[key] = value; });
  });
  const contexts = profile.projectedProductContext;
  if (!Array.isArray(contexts)) throw new Error('Coworker account context is unavailable.');
  const tenantId = contexts.find((entry) => entry?.prodCtx?.owningEntity)?.prodCtx.owningEntity;
  if (!tenantId) throw new Error('Coworker account organization is unavailable.');
  const entitled = contexts.some((entry) => entry?.prodCtx?.owningEntity === tenantId
    && SERVICE_CODES.includes(entry.prodCtx.serviceCode));
  const cma = flags['ew.coworker'] === 'cma' && entitled;
  const query = new URLSearchParams(search);
  if (!cma && flags['ew.coworker'] !== 'true' && query.get('nx-chat-ao') !== 'true') {
    throw new Error('Coworker is not enabled for this site and account.');
  }
  const headers = { 'x-tenant-id': tenantId };
  const base = aoBase(contexts);
  let manifest = query.get('nx-chat-ao-manifest') || flags['ew.coworkerManifest'];
  if (!manifest) {
    const resolved = await read(`${base}/api/v1/overrides/user/resolved`, 'Coworker manifest', {
      optional: true, headers,
    });
    manifest = resolved.manifest_id || 'experience-workspace';
  }
  if (cma) {
    if (!profile.userId) throw new Error('Coworker account user is unavailable.');
    headers['x-user-id'] = profile.userId;
  }
  const catalog = await read(
    `${cma ? CMA_BASE : base}/api/v1/skills?manifest_id=${encodeURIComponent(manifest)}`,
    'Coworker skills',
    { headers },
  );
  if (!Array.isArray(catalog.skills) || catalog.skills.some((skill) => (
    !skill || typeof skill.name !== 'string' || !skill.name.trim()
  ))) throw new Error('Invalid Coworker skills response.');
  return catalog.skills.some(({ name }) => name.trim().toLowerCase() === 'page-proposals');
}
