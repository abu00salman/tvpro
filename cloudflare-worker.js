/** TV Pro Stream Gateway v4 — Cloudflare Worker
 * Deploy this Worker, then set its HTTPS URL in TV Pro > Settings > Playback > HTTPS proxy.
 * Only use with streams you are authorized to access.
 *
 * Cloudflare Workers can only open outbound connections on these ports. IPTV panels on any
 * other port (8000, 25461, 8789, …) cannot be reached from here: the Worker answers 502 at once
 * so TV Pro moves on to the next gateway (the Deno build has no port restriction).
 */
const ALLOWED_ORIGINS = new Set(['https://tv-pro.app','https://www.tv-pro.app']);
const CF_PORTS = new Set(['', '80', '8080', '8880', '2052', '2082', '2086', '2095', '443', '2053', '2083', '2087', '2096', '8443']);
const MAX_REDIRECTS = 5;
const MAX_PLAYLIST_BYTES = 4 * 1024 * 1024;

function isPrivateIPv4(h) {
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = +m[1], b = +m[2];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
function isBlockedHost(host) {
  const h = host.toLowerCase();
  if (['localhost', 'metadata', 'metadata.google.internal', 'instance-data'].includes(h)) return true;
  if (h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || isPrivateIPv4(h)) return true;
  if (h.startsWith('[')) { const v = h.slice(1, -1); return v === '::1' || v === '::' || /^f[cd]/i.test(v) || /^fe[89ab]/i.test(v) || v.startsWith('::ffff:'); }
  return false;
}
function validateTarget(raw) {
  try { const u = new URL(raw); return /^https?:$/.test(u.protocol) && !isBlockedHost(u.hostname) ? u : null; } catch { return null; }
}

function cors(origin, extra = {}) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://tv-pro.app',
    'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
    'Access-Control-Allow-Headers': 'Range,Content-Type,Accept',
    'Access-Control-Expose-Headers': 'Content-Length,Content-Range,Accept-Ranges,Content-Type,X-TVPro-Final-URL,X-TVPro-Error',
    'Vary': 'Origin',
    ...extra,
  };
}
function fail(origin, status, reason) {
  return new Response(reason, { status, headers: cors(origin, { 'Content-Type': 'text/plain;charset=utf-8', 'X-TVPro-Error': reason }) });
}

function proxied(workerURL, absoluteURL) {
  const p = new URL('/proxy', workerURL.origin);
  p.searchParams.set('url', absoluteURL);
  return p.toString();
}
function absolute(ref, base) {
  try { return new URL(ref, base).toString(); } catch { return null; }
}
function rewriteManifest(text, sourceURL, workerURL) {
  return text.split(/\r?\n/).map(line => {
    const s = line.trim();
    if (!s) return line;
    // URI="..." attributes (EXT-X-KEY, EXT-X-MAP, EXT-X-MEDIA, EXT-X-I-FRAME-STREAM-INF, …)
    if (s.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (all, uri) => {
      const abs = absolute(uri, sourceURL);
      return abs ? `URI="${proxied(workerURL, abs)}"` : all;
    });
    const abs = absolute(s, sourceURL);
    return abs ? proxied(workerURL, abs) : line;
  }).join('\n');
}

/** Follows redirects manually: every hop is checked against the block list and the port list,
 *  and the final URL is kept so relative segment paths resolve against the real streaming server. */
async function fetchValidated(url, init, left = MAX_REDIRECTS) {
  if (!CF_PORTS.has(url.port)) throw Object.assign(new Error('unsupported-port'), { status: 502 });
  const res = await fetch(url.toString(), { ...init, redirect: 'manual' });
  if ([301, 302, 303, 307, 308].includes(res.status)) {
    const loc = res.headers.get('location');
    if (!loc || left <= 0) throw Object.assign(new Error('too-many-redirects'), { status: 508 });
    const next = validateTarget(new URL(loc, url).toString());
    if (!next) throw Object.assign(new Error('blocked-redirect'), { status: 403 });
    return fetchValidated(next, init, left - 1);
  }
  return { res, finalURL: url };
}

const FALLBACK_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const isPlaylistPath = (u) => /\.m3u8?$/i.test(u.pathname);

async function handleProxy(request, workerURL) {
  const origin = request.headers.get('Origin') || '';
  const raw = workerURL.searchParams.get('url');
  if (!raw) return new Response('TV Pro Stream Gateway OK', { headers: cors(origin, { 'Content-Type': 'text/plain;charset=utf-8' }) });
  const target = validateTarget(raw);
  if (!target) return fail(origin, 403, 'blocked-or-invalid-url');

  const headers = new Headers({ 'User-Agent': request.headers.get('User-Agent') || FALLBACK_UA, 'Accept': '*/*', 'Accept-Encoding': 'identity' });
  // Range lets the player seek inside movies; never send it for playlists (some panels answer with a truncated 206 list).
  const range = request.headers.get('range');
  if (range && !isPlaylistPath(target)) headers.set('Range', range);

  let upstream, finalURL;
  try {
    // Many IPTV panels reject HEAD, so HEAD is served from a GET whose body is discarded.
    ({ res: upstream, finalURL } = await fetchValidated(target, { method: 'GET', headers }));
  } catch (e) {
    return fail(origin, e.status || 502, e.status ? e.message : 'upstream-connection-failed');
  }

  const ct = (upstream.headers.get('content-type') || '').toLowerCase();
  // Decide by the *final* URL and content type only: a .m3u8 that redirects to an endless .ts
  // live stream must be streamed through, not buffered.
  const isM3U8 = /mpegurl/.test(ct) || isPlaylistPath(finalURL);
  if (isM3U8 && upstream.ok && request.method !== 'HEAD') {
    const buf = await upstream.arrayBuffer();
    if (buf.byteLength > MAX_PLAYLIST_BYTES) return fail(origin, 413, 'playlist-too-large');
    const text = new TextDecoder().decode(buf);
    if (text.trimStart().startsWith('#EXTM3U')) {
      return new Response(rewriteManifest(text, finalURL.toString(), workerURL), {
        status: 200,
        headers: cors(origin, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store', 'X-TVPro-Final-URL': finalURL.toString() }),
      });
    }
    // Panels answer expired/blocked accounts with an HTML or text page and status 200.
    return fail(origin, 502, 'upstream-not-a-playlist');
  }

  const out = new Headers(cors(origin, { 'Content-Type': ct || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-TVPro-Final-URL': finalURL.toString() }));
  for (const n of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
    const v = upstream.headers.get(n);
    if (v) out.set(n, v);
  }
  if (request.method === 'HEAD') { upstream.body?.cancel(); return new Response(null, { status: upstream.status, headers: out }); }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export default { async fetch(request) {
  const url = new URL(request.url), origin = request.headers.get('Origin') || '';
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin, { 'Access-Control-Max-Age': '86400' }) });
  if (url.pathname === '/' || url.pathname === '/health') return new Response('TV Pro Stream Gateway OK', { headers: cors(origin, { 'Content-Type': 'text/plain;charset=utf-8' }) });
  if (url.pathname === '/proxy' && (request.method === 'GET' || request.method === 'HEAD')) return handleProxy(request, url);
  return new Response('Not found', { status: 404, headers: cors(origin) });
}};
