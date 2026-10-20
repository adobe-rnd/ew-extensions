export function createImagePreviews(sdk, { admin, onChange }) {
  const sessions = new Map();
  const context = { ...sdk.project, ...sdk.context };
  const ref = context.branch || context.ref || 'main';
  const branch = ref === 'local' ? 'main' : ref;
  const domain = new URL(admin).hostname === 'stage-admin.da.live'
    ? 'stage-preview.da.live' : 'preview.da.live';

  return (src) => {
    let source;
    try { source = new URL(src); } catch { return src; }
    if (source.protocol !== 'https:'
      || !['content.da.live', 'stage-content.da.live'].includes(source.hostname)) return src;
    const [, org, site, ...path] = source.pathname.split('/');
    if (![branch, org, site].every((part) => typeof part === 'string' && /^[a-z0-9-]+$/i.test(part))) {
      throw new Error('Unable to build the image preview URL: invalid branch, organization, or site.');
    }
    const origin = `https://${branch}--${site}--${org}.${domain}`;
    const preview = `${origin}/${path.join('/')}${source.search}${source.hash}`;
    if (!sessions.has(origin)) {
      const session = { ready: false };
      sessions.set(origin, session);
      Promise.resolve().then(async () => {
        if (!sdk.token) throw new Error('The host did not supply an authentication token.');
        const response = await sdk.actions.daFetch(`${origin}/gimme_cookie`, {
          credentials: 'include',
          headers: { Authorization: `Bearer ${sdk.token}` },
          noRedirect: true,
        });
        if (!response.ok) throw new Error(`Preview cookie request failed: ${response.status}`);
        session.ready = true;
        onChange();
      }).catch((error) => {
        onChange(`Unable to authenticate image previews for ${org}/${site}: ${error.message}. Reload to retry.`);
      });
    }
    return sessions.get(origin).ready ? preview : undefined;
  };
}
