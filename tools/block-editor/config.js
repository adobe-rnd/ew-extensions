export function validateBase(value, fallback) {
  const url = new URL(value || fallback);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.search || url.hash) throw new Error('Asset bases must be HTTP(S) URLs without credentials, query, or hash.');
  return url.href.replace(/\/$/, '');
}

export function getConfig(search = window.location.search, hostname = window.location.hostname) {
  const params = new URLSearchParams(search);
  const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);
  const config = {
    live: validateBase(params.get('live'), 'https://da.live'),
    ref: params.get('ref') || 'main',
    admin: validateBase(params.get('admin'), local ? 'https://stage-admin.da.live' : 'https://admin.da.live'),
  };
  if (params.has('library')) config.library = validateBase(params.get('library'));
  return config;
}

export const config = typeof window === 'undefined' ? null : getConfig();
