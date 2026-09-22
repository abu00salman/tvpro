/** TV Pro Stream Gateway — Cloudflare Worker
 * Deploy this Worker, then set its HTTPS URL in TV Pro > Settings > Playback > HTTPS proxy.
 * Only use with streams you are authorized to access.
 */
const ALLOWED_ORIGINS = new Set(['https://tv-pro.app','https://www.tv-pro.app']);
const BLOCKED_HOSTS = /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[78]\d|9\d|1[01]\d|12[0-7])\.)/i;

function cors(origin) {
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : 'https://tv-pro.app';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
    'Access-Control-Allow-Headers': 'Range,Content-Type,Accept',
    'Access-Control-Expose-Headers': 'Content-Length,Content-Range,Accept-Ranges,Content-Type',
    'Vary': 'Origin',
  };
}
function safeTarget(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('Bad URL'); }
  if (!/^https?:$/.test(u.protocol) || BLOCKED_HOSTS.test(u.hostname) || u.hostname.endsWith('.local') || u.hostname.endsWith('.internal')) throw new Error('Blocked URL');
  return u;
}
function proxied(workerURL, absoluteURL) {
  const p = new URL('/proxy', workerURL.origin);
  p.searchParams.set('url', absoluteURL);
  return p.toString();
}
function rewriteManifest(text, sourceURL, workerURL) {
  const base = new URL(sourceURL);
  return text.split(/\r?\n/).map(line => {
    const s = line.trim();
    if (!s) return line;
    // URI="..." attributes (EXT-X-KEY, EXT-X-MAP, EXT-X-MEDIA, etc.)
    if (s.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, uri) => {
      try { return `URI="${proxied(workerURL, new URL(uri, base).toString())}"`; } catch { return `URI="${uri}"`; }
    });
    try { return proxied(workerURL, new URL(s, base).toString()); } catch { return line; }
  }).join('\n');
}
async function handleProxy(request, workerURL) {
  const raw = workerURL.searchParams.get('url');
  if (!raw) return new Response('TV Pro Stream Gateway', {status:200, headers:{...cors(request.headers.get('Origin')||''),'Content-Type':'text/plain;charset=utf-8'}});
  let target;
  try { target = safeTarget(raw); } catch { return new Response('Invalid target', {status:400, headers:cors(request.headers.get('Origin')||'')}); }

  const headers = new Headers();
  for (const h of ['range','accept','if-none-match','if-modified-since']) { const v=request.headers.get(h); if(v) headers.set(h,v); }
  headers.set('User-Agent', request.headers.get('User-Agent') || 'Mozilla/5.0');
  headers.set('Accept-Encoding','identity');

  let upstream;
  try {
    upstream = await fetch(target.toString(), {method:request.method, headers, redirect:'follow'});
  } catch (e) {
    return new Response('Upstream connection failed', {status:502, headers:cors(request.headers.get('Origin')||'')});
  }

  const out = new Headers(upstream.headers);
  Object.entries(cors(request.headers.get('Origin')||'')).forEach(([k,v])=>out.set(k,v));
  out.delete('content-security-policy'); out.delete('content-security-policy-report-only'); out.delete('x-frame-options');
  const ct=(upstream.headers.get('content-type')||'').toLowerCase();
  const finalURL=upstream.url || target.toString();
  const isM3U8 = /mpegurl|m3u8/.test(ct) || /\.m3u8(?:$|\?)/i.test(finalURL);
  if (request.method !== 'HEAD' && isM3U8 && upstream.ok) {
    const body = rewriteManifest(await upstream.text(), finalURL, workerURL);
    out.set('Content-Type','application/vnd.apple.mpegurl; charset=utf-8');
    out.set('Cache-Control','no-store');
    out.delete('Content-Length'); out.delete('Content-Encoding');
    return new Response(body,{status:upstream.status,headers:out});
  }
  return new Response(request.method==='HEAD'?null:upstream.body,{status:upstream.status,statusText:upstream.statusText,headers:out});
}
export default { async fetch(request) {
  const url=new URL(request.url), origin=request.headers.get('Origin')||'';
  if(request.method==='OPTIONS') return new Response(null,{status:204,headers:cors(origin)});
  if(url.pathname==='/' || url.pathname==='/health') return new Response('TV Pro Stream Gateway OK',{headers:{...cors(origin),'Content-Type':'text/plain;charset=utf-8'}});
  if(url.pathname==='/proxy' && (request.method==='GET'||request.method==='HEAD')) return handleProxy(request,url);
  return new Response('Not found',{status:404,headers:cors(origin)});
}};
