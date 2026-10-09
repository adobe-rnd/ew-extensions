export function validateBase(value, fallback) {
  const url = new URL(value || fallback);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.search || url.hash) throw new Error('Asset bases must be HTTP(S) URLs without credentials, query, or hash.');
  return url.href.replace(/\/$/, '');
}

export function getRuntime(search = window.location.search, hostname = window.location.hostname) {
  const params = new URLSearchParams(search);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
    || params.has('nx') || params.has('live');
  const config = {
    nx: validateBase(params.get('nx'), local ? 'http://localhost:3001/nx' : 'https://da.live/nx'),
    live: validateBase(params.get('live'), local ? 'http://localhost:3001' : 'https://da.live'),
    ref: params.get('ref') || (local ? 'local' : 'main'),
  };
  config.nx2 = validateBase(params.get('nx2'), `${config.nx.replace(/\/nx2?$/, '')}/nx2`);
  if (params.has('library')) config.library = validateBase(params.get('library'));
  return config;
}

export const runtime = typeof window === 'undefined' ? null : getRuntime();
