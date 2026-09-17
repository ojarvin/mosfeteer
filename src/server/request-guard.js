/**
 * The server can read and write files anywhere the user can, so it must only
 * answer the editor itself. Two browser attacks matter for a localhost server:
 *   - DNS rebinding: a hostile domain resolves to 127.0.0.1, so its requests
 *     carry that domain in `Host`. Only loopback host names are accepted.
 *   - Cross-site requests: any web page can send (but not read) requests to
 *     localhost. API calls with a foreign `Origin` or `Sec-Fetch-Site` are refused.
 * Non-browser clients (the CLI, tests) send neither header and are allowed.
 */

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

export function allowedHosts(port, extraHost) {
  const hosts = new Set(LOOPBACK_HOSTS.map((host) => `${host}:${port}`));
  if (extraHost && !['0.0.0.0', '::'].includes(extraHost)) {
    hosts.add(`${extraHost.includes(':') && !extraHost.startsWith('[') ? `[${extraHost}]` : extraHost}:${port}`.toLowerCase());
  }
  return hosts;
}

export function checkRequest({ headers = {}, api = false }, hosts) {
  const host = String(headers.host || '').toLowerCase();
  if (!hosts.has(host)) return 'unexpected Host header';
  if (!api) return null;
  const origin = headers.origin;
  if (origin !== undefined) {
    let originHost = null;
    try { originHost = new URL(origin).host.toLowerCase(); } catch { /* "null" or malformed */ }
    if (!originHost || !hosts.has(originHost)) return 'cross-origin request';
  }
  const site = headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return 'cross-site request';
  return null;
}
