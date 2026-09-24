/**
 * TV Pro Stream Gateway — Deno Deploy build.
 *
 * Identical logic to the Cloudflare Worker build; both use only Web-standard APIs, and
 * `export default { fetch }` is Deno Deploy's native entry point. Paste this whole file into a
 * Deno Deploy playground's main.ts and press Deploy — no environment variables, no npm install.
 * (The Node build in gateway.js is for Vercel/Railway/Render/Fly/VPS instead; it uses
 * CommonJS `require`, which a Deno playground's ESM main.ts cannot load.)
 *
 * Original header follows.
 *
 * TV Pro Stream Gateway — Cloudflare Worker build.
 *
 * A minimal, isolated proxy TV Pro's playback resolver falls back to when a stream can't be
 * reached directly from the browser (mixed content on an http:// source, or a CORS refusal on
 * an https:// source). It is never used for streams that already play directly.
 *
 * Usage: point TV Pro's Settings → Playback → "HTTPS proxy for http:// sources" (or the
 * NEXT_PUBLIC_TVPRO_GATEWAY_URL build variable) at this Worker's URL, e.g.
 *   https://your-worker.workers.dev
 * TV Pro appends /proxy?url=<source> itself — nothing else to configure.
 */

const BLOCKED_HOSTS = new Set([
  'localhost', '0.0.0.0', '127.0.0.1', '::1', '[::1]', '[::]',
  'metadata.google.internal', 'metadata', 'instance-data',
]);
const MAX_REDIRECTS = 5;
const MAX_PLAYLIST_BYTES = 4 * 1024 * 1024; // playlists are text and always buffered for rewriting
const RATE_LIMIT = { windowMs: 10_000, max: 120 }; // per IP, best-effort within one isolate

function isPrivateIPv4(host) {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = m.slice(1, 3).map(Number);
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) || // link-local + cloud metadata (169.254.169.254)
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    a >= 224
  );
}

function isBlockedHost(hostname) {
  const h = hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(h)) return true;
  if (h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (isPrivateIPv4(h)) return true;
  if (h.startsWith('[')) {
    const v6 = h.slice(1, -1);
    if (v6 === '::1' || v6 === '::' || /^f[cd]/i.test(v6) || /^fe[89ab]/i.test(v6) || v6.startsWith('::ffff:')) return true;
  }
  return false;
}

function validateTarget(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || isBlockedHost(url.hostname)) return null;
  return url;
}

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type, X-TVPro-Error',
    ...extra,
  };
}

/** Movies and episodes are fetched in byte ranges; Safari refuses to play a file at all unless
 *  the 206 response carries Content-Range and Content-Length. Pass the range metadata through. */
function passthroughHeaders(upstream, contentType) {
  const headers = { 'Content-Type': contentType || 'application/octet-stream', 'Cache-Control': 'no-store' };
  for (const name of ['content-length', 'content-range', 'accept-ranges']) {
    const value = upstream.headers.get(name);
    if (value) headers[name] = value;
  }
  if (!headers['accept-ranges']) headers['accept-ranges'] = 'bytes';
  return headers;
}

function proxied(workerOrigin, target) {
  return `${workerOrigin}/proxy?url=${encodeURIComponent(target)}`;
}

/** Rewrites URI lines/attributes inside an HLS playlist so every reference routes back through this gateway. */
function absolute(ref, base) {
  try { return new URL(ref, base).toString(); } catch { return null; }
}
function rewriteM3U8(text, sourceUrl, workerOrigin) {
  return text.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith('#')) {
      // EXT-X-KEY, EXT-X-MAP and EXT-X-MEDIA all carry a URI="..." attribute that also needs rewriting
      // (a line can carry more than one, and a malformed one is left as-is rather than failing the list).
      return line.replace(/URI="([^"]+)"/g, (all, uri) => {
        const abs = absolute(uri, sourceUrl);
        return abs ? `URI="${proxied(workerOrigin, abs)}"` : all;
      });
    }
    const abs = absolute(trimmed, sourceUrl);
    return abs ? proxied(workerOrigin, abs) : line;
  }).join('\n');
}

/** Follows redirects manually so every hop — not just the first URL — is checked against the block list. */
async function fetchValidated(url, init, redirectsLeft = MAX_REDIRECTS) {
  const res = await fetch(url.toString(), { ...init, redirect: 'manual' });
  if ([301, 302, 303, 307, 308].includes(res.status)) {
    const location = res.headers.get('location');
    if (!location || redirectsLeft <= 0) throw new Error('too many redirects');
    const next = validateTarget(new URL(location, url).toString());
    if (!next) throw new Error('redirect to a blocked host');
    return fetchValidated(next, init, redirectsLeft - 1);
  }
  // IPTV panels routinely redirect a channel URL to a different streaming server; relative
  // segment paths in the playlist belong to *that* server, so callers need the final URL.
  return { res, finalUrl: url };
}

/** IPTV panels commonly allow-list by User-Agent and answer anything unfamiliar with "Blocked".
 *  So the gateway presents the viewer's own browser identity, exactly as a direct request would,
 *  rather than announcing itself. Nothing else from the viewer is forwarded (no cookies, no referrer). */
const FALLBACK_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
function upstreamHeaders(request, target) {
  const headers = { 'User-Agent': request.headers.get('user-agent') || FALLBACK_UA, 'Accept': '*/*', 'Accept-Encoding': 'identity' };
  const range = request.headers.get('range');
  // Lets the player seek inside movies. Never sent for playlists: some panels answer with a truncated 206 list.
  if (range && !/\.m3u8?$/i.test(target.pathname)) headers['Range'] = range;
  return headers;
}

const buckets = new Map(); // best-effort per-isolate rate limiting; a KV or Durable Object gives real global limits
function rateLimited(ip) {
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket || now - bucket.start > RATE_LIMIT.windowMs) {
    buckets.set(ip, { start: now, count: 1 });
    return false;
  }
  bucket.count++;
  return bucket.count > RATE_LIMIT.max;
}

export default {
  async fetch(request, info) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });

    const reqUrl = new URL(request.url);
    if (reqUrl.pathname !== '/proxy') {
      return new Response('TV Pro Stream Gateway: use /proxy?url=<source>', { status: 200, headers: corsHeaders() });
    }

    // Cloudflare sets cf-connecting-ip; Deno Deploy passes the peer address as the second argument.
    // If the platform exposes neither, skip limiting rather than lump every visitor into one bucket.
    const ip = request.headers.get('cf-connecting-ip')
      || (request.headers.get('x-forwarded-for') || '').split(',')[0].trim()
      || info?.remoteAddr?.hostname
      || '';
    if (ip && rateLimited(ip)) return new Response('Too many requests', { status: 429, headers: corsHeaders() });

    const target = reqUrl.searchParams.get('url');
    if (!target) return new Response('Missing url parameter', { status: 400, headers: corsHeaders() });
    const parsed = validateTarget(target);
    if (!parsed) return new Response('Blocked or invalid host', { status: 403, headers: corsHeaders() });

    let upstream, finalUrl;
    try {
      // Never log `target` — it carries the person's IPTV username/password in query form.
      ({ res: upstream, finalUrl } = await fetchValidated(parsed, { headers: upstreamHeaders(request, parsed) }));
    } catch {
      return new Response('Upstream fetch failed', { status: 502, headers: corsHeaders() });
    }

    const contentType = upstream.headers.get('content-type') || '';
    // Decide by the *final* URL and content type only: panels often redirect a channel's .m3u8 to an
    // endless .ts live stream, which must be streamed through rather than buffered.
    const looksLikePlaylist = /\.m3u8?$/i.test(finalUrl.pathname) || contentType.toLowerCase().includes('mpegurl');

    if (looksLikePlaylist && upstream.ok && request.method !== 'HEAD') {
      const buf = await upstream.arrayBuffer();
      if (buf.byteLength > MAX_PLAYLIST_BYTES) return new Response('Playlist too large', { status: 413, headers: corsHeaders() });
      const text = new TextDecoder().decode(buf);
      // Expired or blocked accounts get an HTML/text page with status 200; report it as a failure so the player moves on.
      if (!text.trimStart().startsWith('#EXTM3U')) {
        return new Response('Upstream did not return a playlist', { status: 502, headers: corsHeaders({ 'X-TVPro-Error': 'upstream-not-a-playlist' }) });
      }
      const rewritten = rewriteM3U8(text, finalUrl.toString(), reqUrl.origin);
      return new Response(rewritten, {
        status: upstream.status,
        headers: corsHeaders({ 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' }),
      });
    }

    // Segments and everything else (.ts/.m4s/.aac/init.mp4/key files/…): stream through unchanged.
    if (request.method === 'HEAD') upstream.body?.cancel();
    return new Response(request.method === 'HEAD' ? null : upstream.body, {
      status: upstream.status,
      headers: corsHeaders(passthroughHeaders(upstream, contentType)),
    });
  },
};
