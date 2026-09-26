/** TV Pro Stream Gateway v5 — Cloudflare Worker
 * Deploy this Worker, then set its HTTPS URL in TV Pro > Settings > Playback > HTTPS proxy.
 * Only use with streams you are authorized to access.
 *
 * The shared gateway core below is identical in tvpro-gateway-deno.ts; only the platform wrapper differs.
 * Every failure carries an X-TVPro-Error code (UPSTREAM_403, UPSTREAM_TIMEOUT, UPSTREAM_BLOCKED, …) and
 * X-TVPro-Upstream-Status, so the player and diag.html can tell where a request failed. Target URLs are
 * never logged: they carry the subscriber's IPTV credentials.
 *
 * Cloudflare limits: Workers cannot open connections to bare IP addresses (Cloudflare error 1003) or to ports
 * outside the list below. IPTV panels often redirect to exactly such addresses, so those requests fail fast with
 * GATEWAY_UNSUPPORTED_TARGET / GATEWAY_UNSUPPORTED_PORT and TV Pro moves on to a Deno gateway.
 */
const MAX_REDIRECTS = 5;
const MAX_PLAYLIST_BYTES = 4 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = globalThis.TVPRO_UPSTREAM_TIMEOUT_MS || 15000; // until response headers arrive; the body itself streams without a deadline
const FALLBACK_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

// ---- destination validation (SSRF protection) ----
const BLOCKED_NAMES = new Set(['localhost', 'metadata', 'metadata.google.internal', 'instance-data']);
function isIPv4(h) { return /^\d{1,3}(\.\d{1,3}){3}$/.test(h); }
function isPrivateIPv4(h) {
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = +m[1], b = +m[2];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
function isBlockedHost(host) {
  const h = host.toLowerCase();
  if (BLOCKED_NAMES.has(h) || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || isPrivateIPv4(h)) return true;
  if (h.startsWith('[')) { const v = h.slice(1, -1); return v === '::1' || v === '::' || /^f[cd]/i.test(v) || /^fe[89ab]/i.test(v) || v.startsWith('::ffff:'); }
  return false;
}
function validateTarget(raw) {
  try { const u = new URL(raw); return /^https?:$/.test(u.protocol) && !u.username && !u.password && !isBlockedHost(u.hostname) ? u : null; } catch { return null; }
}

// ---- responses ----
class GatewayError extends Error { constructor(code, status, detail) { super(code); this.code = code; this.status = status; this.detail = detail || ''; } }
function errorResponse(cors, code, status, detail, extra = {}) {
  return new Response(code + (detail ? ': ' + detail : ''), { status, headers: cors({ 'Content-Type': 'text/plain;charset=utf-8', 'Cache-Control': 'no-store', 'X-TVPro-Error': code, ...extra }) });
}
function upstreamErrorCode(status) {
  if (status === 401 || status === 403 || status === 404 || status === 429) return 'UPSTREAM_' + status;
  if (status >= 500) return 'UPSTREAM_5XX';
  return 'UPSTREAM_' + status;
}

// ---- HLS ----
function proxied(origin, absoluteURL) { return origin + '/proxy?url=' + encodeURIComponent(absoluteURL); }
function absolute(ref, base) { try { return new URL(ref, base).toString(); } catch { return null; } }
function rewriteManifest(text, sourceURL, origin) {
  return text.split(/\r?\n/).map((line) => {
    const s = line.trim();
    if (!s) return line;
    // URI="..." attributes (EXT-X-KEY, EXT-X-MAP, EXT-X-MEDIA, EXT-X-I-FRAME-STREAM-INF, …); a line may carry several
    if (s.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (all, uri) => { const abs = absolute(uri, sourceURL); return abs ? 'URI="' + proxied(origin, abs) + '"' : all; });
    const abs = absolute(s, sourceURL); // relative segment/variant paths resolve against the final (post-redirect) URL; query tokens are kept
    return abs ? proxied(origin, abs) : line;
  }).join('\n');
}
const isPlaylistPath = (u) => /\.m3u8?$/i.test(u.pathname);

/** Reads only the first chunk to tell an HLS playlist from a media stream. Playlists are buffered (they must be
 *  rewritten); anything else is re-assembled and streamed through untouched, so a live .ts or a movie is never
 *  held in memory. Panels label playlists inconsistently, so the body decides, not the label. */
async function sniff(body) {
  const reader = body.getReader();
  const first = await reader.read();
  const head = first.done ? new Uint8Array() : first.value;
  const text64 = new TextDecoder().decode(head.slice(0, 64)).replace(/^﻿/, '').trimStart();
  if (!text64.startsWith('#EXTM3U')) {
    const stream = new ReadableStream({
      start(c) { if (head.length) c.enqueue(head); if (first.done) c.close(); },
      async pull(c) { const r = await reader.read(); if (r.done) c.close(); else c.enqueue(r.value); },
      cancel(reason) { return reader.cancel(reason); },
    });
    return { text: null, stream, head, empty: first.done && !head.length };
  }
  const parts = [head];
  let size = head.length;
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    parts.push(r.value);
    size += r.value.length;
    if (size > MAX_PLAYLIST_BYTES) { await reader.cancel(); throw new GatewayError('PLAYLIST_TOO_LARGE', 413); }
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.length; }
  return { text: new TextDecoder().decode(all), stream: null };
}

/** Panels answer refused/expired/blocked requests with a short text or HTML body and status 200. */
function classifyNonMedia(head, ct) {
  const t = new TextDecoder().decode(head.slice(0, 512)).trim();
  if (!t) return 'EMPTY_RESPONSE';
  if (/\bblock(ed)?\b|\bbanned?\b/i.test(t)) return 'UPSTREAM_BLOCKED';
  if (/expired|disabled|not\s+allowed|max(imum)?\s+connections?|too\s+many/i.test(t)) return 'UPSTREAM_REFUSED';
  if (ct.startsWith('text/html')) return 'UPSTREAM_HTML_NOT_MEDIA';
  return 'HLS_MANIFEST_INVALID';
}

// ---- upstream fetch ----
async function fetchValidated(url, init, checkTarget, left = MAX_REDIRECTS) {
  checkTarget(url);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), UPSTREAM_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url.toString(), { ...init, redirect: 'manual', signal: ctl.signal });
  } catch (e) {
    if (ctl.signal.aborted) throw new GatewayError('UPSTREAM_TIMEOUT', 504, 'no response within ' + UPSTREAM_TIMEOUT_MS / 1000 + 's');
    throw new GatewayError('CONNECTION_FAILED', 502, /reset|refused|closed|dns|resolve|lookup|tls|ssl|certificate/i.test(String(e && e.message)) ? String(e.message).slice(0, 80) : 'network error');
  } finally { clearTimeout(timer); }
  if ([301, 302, 303, 307, 308].includes(res.status)) {
    const loc = res.headers.get('location');
    try { res.body && res.body.cancel(); } catch {}
    if (!loc) throw new GatewayError('UPSTREAM_BAD_REDIRECT', 502, 'redirect without location');
    if (left <= 0) throw new GatewayError('TOO_MANY_REDIRECTS', 508);
    const next = validateTarget(new URL(loc, url).toString());
    if (!next) throw new GatewayError('BLOCKED_REDIRECT', 403, 'redirect to a private or invalid address');
    return fetchValidated(next, init, checkTarget, left - 1);
  }
  return { res, finalURL: url };
}

/** Shared /proxy handler. `platform.checkTarget(url)` throws GatewayError for destinations this platform cannot reach. */
async function handleProxy(request, reqUrl, cors, platform) {
  const raw = reqUrl.searchParams.get('url');
  if (!raw) return new Response('Missing url parameter', { status: 400, headers: cors({ 'Content-Type': 'text/plain;charset=utf-8', 'X-TVPro-Error': 'MISSING_URL' }) });
  const target = validateTarget(raw);
  if (!target) return errorResponse(cors, 'BLOCKED_TARGET', 403, 'private, local or invalid address');

  const headers = { 'User-Agent': request.headers.get('user-agent') || FALLBACK_UA, 'Accept': '*/*', 'Accept-Encoding': 'identity' };
  const range = request.headers.get('range');
  if (range && !isPlaylistPath(target)) headers['Range'] = range; // seeking in movies; never for playlists (some panels return a truncated 206 list)

  let upstream, finalURL;
  try {
    // Many IPTV panels reject HEAD, so HEAD is answered from a GET whose body is discarded.
    ({ res: upstream, finalURL } = await fetchValidated(target, { method: 'GET', headers }, platform.checkTarget));
  } catch (e) {
    if (e instanceof GatewayError) return errorResponse(cors, e.code, e.status, e.detail);
    throw e;
  }
  const ct = (upstream.headers.get('content-type') || '').toLowerCase();
  const diag = { 'X-TVPro-Upstream-Status': String(upstream.status), 'X-TVPro-Final-Host': finalURL.host };

  if (!upstream.ok) {
    try { upstream.body && upstream.body.cancel(); } catch {}
    return errorResponse(cors, upstreamErrorCode(upstream.status), upstream.status === 429 ? 429 : upstream.status >= 500 ? 502 : upstream.status, '', diag);
  }

  const namedPlaylist = ct.includes('mpegurl') || isPlaylistPath(finalURL) || isPlaylistPath(target);
  let body = upstream.body;
  if (!body) {
    if (request.method !== 'HEAD' && (namedPlaylist || upstream.headers.get('content-length') === '0')) return errorResponse(cors, 'EMPTY_RESPONSE', 502, '', diag);
  } else if (request.method !== 'HEAD' && (namedPlaylist || ct.startsWith('text/') || ct === '' || ct.includes('octet-stream'))) {
    let sniffed;
    try { sniffed = await sniff(body); } catch (e) { if (e instanceof GatewayError) return errorResponse(cors, e.code, e.status, e.detail, diag); throw e; }
    if (sniffed.text !== null) {
      return new Response(rewriteManifest(sniffed.text, finalURL.toString(), reqUrl.origin), {
        status: 200, headers: cors({ 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store', ...diag }),
      });
    }
    if (sniffed.empty) return errorResponse(cors, 'EMPTY_RESPONSE', 502, '', diag);
    // Media types (video/*, audio/*, octet-stream) stream through unless the body is plainly a refusal message.
    const media = /^(video|audio)\//.test(ct) || ct.includes('mp2t') || ct.includes('octet-stream');
    const refusal = media && sniffed.head.length < 512 && /^[\x09\x0a\x0d\x20-\x7e]*$/.test(new TextDecoder().decode(sniffed.head)) && /block|bann?ed|expired|disabled|denied/i.test(new TextDecoder().decode(sniffed.head));
    if (refusal || (!media && (namedPlaylist || ct.startsWith('text/')))) {
      sniffed.stream.cancel();
      // A refusal message from the panel is a refusal (403), not a gateway fault: the player must not retry it through other gateways.
      const code = classifyNonMedia(sniffed.head, ct);
      return errorResponse(cors, code, code === 'HLS_MANIFEST_INVALID' ? 502 : 403, '', diag);
    }
    body = sniffed.stream;
  }

  const out = cors({ 'Content-Type': ct || 'application/octet-stream', 'Cache-Control': 'no-store', ...diag });
  for (const n of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) { const v = upstream.headers.get(n); if (v) out[n] = v; }
  if (!out['accept-ranges'] && upstream.status === 206) out['accept-ranges'] = 'bytes';
  if (request.method === 'HEAD') { try { body && body.cancel(); } catch {} return new Response(null, { status: upstream.status, headers: out }); }
  return new Response(body, { status: upstream.status, headers: out });
}

// ---- Cloudflare platform wrapper ----
const ALLOWED_ORIGINS = new Set(['https://tv-pro.app', 'https://www.tv-pro.app']);
const CF_PORTS = new Set(['', '80', '8080', '8880', '2052', '2082', '2086', '2095', '443', '2053', '2083', '2087', '2096', '8443']);
const corsFor = (origin) => (extra = {}) => ({
  'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://tv-pro.app',
  'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
  'Access-Control-Allow-Headers': 'Range,Content-Type,Accept',
  'Access-Control-Expose-Headers': 'Content-Length,Content-Range,Accept-Ranges,Content-Type,X-TVPro-Error,X-TVPro-Upstream-Status,X-TVPro-Final-Host',
  'Vary': 'Origin',
  ...extra,
});
const platform = {
  checkTarget(u) {
    if (!CF_PORTS.has(u.port)) throw new GatewayError('GATEWAY_UNSUPPORTED_PORT', 502, 'Cloudflare Workers cannot connect to port ' + u.port);
    if (isIPv4(u.hostname) || u.hostname.startsWith('[')) throw new GatewayError('GATEWAY_UNSUPPORTED_TARGET', 502, 'Cloudflare Workers cannot connect to a bare IP address (error 1003)');
  },
};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const cors = corsFor(request.headers.get('Origin') || '');
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors({ 'Access-Control-Max-Age': '86400' }) });
      if (url.pathname === '/' || url.pathname === '/health') return new Response('TV Pro Stream Gateway OK', { headers: cors({ 'Content-Type': 'text/plain;charset=utf-8' }) });
      if (url.pathname === '/proxy' && (request.method === 'GET' || request.method === 'HEAD')) return await handleProxy(request, url, cors, platform);
      return new Response('Not found', { status: 404, headers: cors() });
    } catch {
      return errorResponse(cors, 'GATEWAY_FAILURE', 500, '');
    }
  },
};
