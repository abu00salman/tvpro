// Gateway behaviour tests: node --test tests/
// Both gateway builds (Cloudflare, Deno) are loaded as-is with a mocked upstream `fetch`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.TVPRO_UPSTREAM_TIMEOUT_MS = 300;
const load = async (file) => (await import('data:text/javascript,' + encodeURIComponent(readFileSync(new URL('../' + file, import.meta.url), 'utf8')))).default;
const builds = { cloudflare: await load('cloudflare-worker.js'), deno: await load('tvpro-gateway-deno.ts') };

// ---- mock upstream ----
let routes = {}, calls = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url, range: init.headers && init.headers.Range });
  const r = routes[url];
  if (!r) throw new TypeError('connect ECONNREFUSED (no route ' + url + ')');
  return r(init);
};
const redirect = (to) => () => new Response(null, { status: 302, headers: { location: to } });
const text = (body, ct = 'application/vnd.apple.mpegurl', status = 200) => () => new Response(body, { status, headers: { 'content-type': ct } });
const endless = (ct) => () => new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(188).fill(0x47)); } }), { headers: { 'content-type': ct } });
const call = (gw, target, headers = {}, method = 'GET') => gw.fetch(new Request('https://gw.test/proxy?url=' + encodeURIComponent(target), { method, headers: { Origin: 'https://tv-pro.app', ...headers } }), {});
const withTimeout = (p, ms = 2000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('gateway hung')), ms))]);

const PANEL = 'http://panel.example.com';
for (const [name, gw] of Object.entries(builds)) {
  test.beforeEach(() => { routes = {}; calls = []; });

  test(`${name}: live HLS on a domain host — redirect, relative segments, key URI, query tokens`, async () => {
    routes[PANEL + '/live/u/p/1.m3u8'] = redirect('http://edge.example.com/hls/tok123/index.m3u8?t=abc');
    routes['http://edge.example.com/hls/tok123/index.m3u8?t=abc'] = text('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin?k=1"\n#EXTINF:10,\nseg-1.ts?t=abc\n#EXTINF:10,\n/abs/seg-2.ts\n', 'application/octet-stream');
    const r = await call(gw, PANEL + '/live/u/p/1.m3u8');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/vnd.apple.mpegurl');
    const body = await r.text();
    assert.ok(body.includes('URI="https://gw.test/proxy?url=' + encodeURIComponent('http://edge.example.com/hls/tok123/key.bin?k=1') + '"'));
    assert.ok(body.includes('https://gw.test/proxy?url=' + encodeURIComponent('http://edge.example.com/hls/tok123/seg-1.ts?t=abc')));
    assert.ok(body.includes('https://gw.test/proxy?url=' + encodeURIComponent('http://edge.example.com/abs/seg-2.ts')));
    assert.equal(calls.length, 2, 'exactly one request per hop, no retries');
  });

  test(`${name}: nested master playlist variants are rewritten`, async () => {
    routes[PANEL + '/live/u/p/2.m3u8'] = text('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nlow/index.m3u8\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio/a.m3u8"\n');
    const body = await (await call(gw, PANEL + '/live/u/p/2.m3u8')).text();
    assert.ok(body.includes(encodeURIComponent(PANEL + '/live/u/p/low/index.m3u8')));
    assert.ok(body.includes(encodeURIComponent(PANEL + '/live/u/p/audio/a.m3u8')));
  });

  test(`${name}: .m3u8 that redirects to an endless live .ts is streamed, not buffered`, async () => {
    routes[PANEL + '/live/u/p/3.m3u8'] = redirect('http://edge.example.com/stream/3.ts');
    routes['http://edge.example.com/stream/3.ts'] = endless('video/mp2t');
    const r = await withTimeout(call(gw, PANEL + '/live/u/p/3.m3u8'));
    assert.equal(r.status, 200);
    const chunk = await r.body.getReader().read();
    assert.equal(chunk.value[0], 0x47);
  });

  test(`${name}: live MPEG-TS labelled octet-stream is streamed through without buffering`, async () => {
    routes[PANEL + '/live/u/p/4.ts'] = endless('application/octet-stream');
    const r = await withTimeout(call(gw, PANEL + '/live/u/p/4.ts'));
    assert.equal(r.status, 200);
    assert.equal((await r.body.getReader().read()).value[0], 0x47);
  });

  test(`${name}: extension-less text/plain playlist is detected by content`, async () => {
    routes[PANEL + '/play/abc'] = text('#EXTM3U\n#EXTINF:4,\nchunk.ts\n', 'text/plain');
    const body = await (await call(gw, PANEL + '/play/abc')).text();
    assert.ok(body.includes(encodeURIComponent(PANEL + '/play/chunk.ts')));
  });

  test(`${name}: movie MP4 Range request → 206 with Content-Range / Accept-Ranges / Content-Length`, async () => {
    routes[PANEL + '/movie/u/p/9.mp4'] = (init) => new Response(new Uint8Array(100), { status: 206, headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-99/5000', 'content-length': '100', 'accept-ranges': 'bytes' } });
    const r = await call(gw, PANEL + '/movie/u/p/9.mp4', { Range: 'bytes=0-99' });
    assert.equal(r.status, 206);
    assert.equal(r.headers.get('content-range'), 'bytes 0-99/5000');
    assert.equal(r.headers.get('content-length'), '100');
    assert.equal(r.headers.get('accept-ranges'), 'bytes');
    assert.equal(calls[0].range, 'bytes=0-99', 'range forwarded upstream');
  });

  test(`${name}: MKV movie (octet-stream) streams without buffering the file`, async () => {
    routes[PANEL + '/movie/u/p/8.mkv'] = endless('application/octet-stream');
    const r = await withTimeout(call(gw, PANEL + '/movie/u/p/8.mkv', { Range: 'bytes=0-' }));
    assert.equal(r.status, 200);
    assert.ok((await r.body.getReader().read()).value.length > 0);
  });

  test(`${name}: series episode path and HEAD (served from GET, no body)`, async () => {
    routes[PANEL + '/series/u/p/77.mp4'] = () => new Response(new Uint8Array(10), { headers: { 'content-type': 'video/mp4', 'content-length': '10' } });
    const r = await call(gw, PANEL + '/series/u/p/77.mp4', {}, 'HEAD');
    assert.equal(r.status, 200);
    assert.equal(await r.text(), '');
    assert.equal(r.headers.get('content-length'), '10');
  });

  for (const [status, code, expectStatus] of [[401, 'UPSTREAM_401', 401], [403, 'UPSTREAM_403', 403], [404, 'UPSTREAM_404', 404], [429, 'UPSTREAM_429', 429], [500, 'UPSTREAM_5XX', 502], [503, 'UPSTREAM_5XX', 502]]) {
    test(`${name}: upstream ${status} → ${code}`, async () => {
      routes[PANEL + '/live/u/p/5.m3u8'] = text('nope', 'text/plain', status);
      const r = await call(gw, PANEL + '/live/u/p/5.m3u8');
      assert.equal(r.status, expectStatus);
      assert.equal(r.headers.get('x-tvpro-error'), code);
      assert.equal(r.headers.get('x-tvpro-upstream-status'), String(status));
      assert.equal(r.headers.get('access-control-allow-origin') !== null, true, 'CORS on errors');
    });
  }

  test(`${name}: panel answers "Blocked" with 200 → UPSTREAM_BLOCKED (not rewritten into a fake segment URL)`, async () => {
    routes[PANEL + '/live/u/p/6.m3u8'] = text('Blocked', 'application/vnd.apple.mpegurl');
    const r = await call(gw, PANEL + '/live/u/p/6.m3u8');
    assert.equal(r.status, 403);
    assert.equal(r.headers.get('x-tvpro-error'), 'UPSTREAM_BLOCKED');
  });

  test(`${name}: expired-account HTML page → UPSTREAM_HTML_NOT_MEDIA`, async () => {
    routes[PANEL + '/live/u/p/7.m3u8'] = text('<html>Account expired</html>', 'text/html');
    const r = await call(gw, PANEL + '/live/u/p/7.m3u8');
    assert.equal(r.status, 403);
    assert.equal(r.headers.get('x-tvpro-error'), 'UPSTREAM_REFUSED');
  });

  test(`${name}: empty 200 response → EMPTY_RESPONSE`, async () => {
    routes[PANEL + '/live/u/p/8.m3u8'] = text('', 'application/vnd.apple.mpegurl');
    const r = await call(gw, PANEL + '/live/u/p/8.m3u8');
    assert.equal(r.headers.get('x-tvpro-error'), 'EMPTY_RESPONSE');
  });

  test(`${name}: upstream never answers → 504 UPSTREAM_TIMEOUT (bounded)`, async () => {
    routes[PANEL + '/live/u/p/9.m3u8'] = (init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
    const r = await withTimeout(call(gw, PANEL + '/live/u/p/9.m3u8'));
    assert.equal(r.status, 504);
    assert.equal(r.headers.get('x-tvpro-error'), 'UPSTREAM_TIMEOUT');
  });

  test(`${name}: connection reset → CONNECTION_FAILED`, async () => {
    routes[PANEL + '/live/u/p/10.m3u8'] = () => { throw new TypeError('connection reset by peer'); };
    const r = await call(gw, PANEL + '/live/u/p/10.m3u8');
    assert.equal(r.status, 502);
    assert.equal(r.headers.get('x-tvpro-error'), 'CONNECTION_FAILED');
  });

  for (const bad of ['http://localhost/x', 'http://127.0.0.1/x', 'http://10.0.0.5/x', 'http://169.254.169.254/latest', 'http://[::1]/x', 'http://metadata.google.internal/x', 'file:///etc/passwd', 'http://user:pw@panel.example.com/x']) {
    test(`${name}: SSRF protection rejects ${bad}`, async () => {
      const r = await call(gw, bad);
      assert.equal(r.status, 403);
      assert.equal(r.headers.get('x-tvpro-error'), 'BLOCKED_TARGET');
      assert.equal(calls.length, 0, 'never contacted');
    });
  }

  test(`${name}: redirect into a private network is refused`, async () => {
    routes[PANEL + '/live/u/p/11.m3u8'] = redirect('http://192.168.1.1/admin');
    const r = await call(gw, PANEL + '/live/u/p/11.m3u8');
    assert.equal(r.status, 403);
    assert.equal(r.headers.get('x-tvpro-error'), 'BLOCKED_REDIRECT');
    assert.equal(calls.length, 1);
  });

  test(`${name}: redirect loop stops`, async () => {
    routes[PANEL + '/loop'] = redirect(PANEL + '/loop');
    const r = await call(gw, PANEL + '/loop');
    assert.equal(r.headers.get('x-tvpro-error'), 'TOO_MANY_REDIRECTS');
    assert.ok(calls.length <= 6);
  });

  test(`${name}: missing url → 400`, async () => {
    const r = await gw.fetch(new Request('https://gw.test/proxy'), {});
    assert.equal(r.status, 400);
  });
}

// ---- platform differences ----
test('cloudflare: redirect to a bare IP fails fast with GATEWAY_UNSUPPORTED_TARGET (instead of Cloudflare 1003)', async () => {
  routes = { [PANEL + '/live/u/p/1.m3u8']: redirect('http://103.163.132.49/hls/tok/index.m3u8') }; calls = [];
  const r = await call(builds.cloudflare, PANEL + '/live/u/p/1.m3u8');
  assert.equal(r.status, 502);
  assert.equal(r.headers.get('x-tvpro-error'), 'GATEWAY_UNSUPPORTED_TARGET');
  assert.equal(calls.length, 1, 'the IP hop is never attempted');
});
test('cloudflare: non-standard port fails fast with GATEWAY_UNSUPPORTED_PORT', async () => {
  routes = {}; calls = [];
  const r = await call(builds.cloudflare, 'http://panel.example.com:25461/live/u/p/1.m3u8');
  assert.equal(r.headers.get('x-tvpro-error'), 'GATEWAY_UNSUPPORTED_PORT');
  assert.equal(calls.length, 0);
});
test('deno: redirect to a bare IP and odd port is followed', async () => {
  routes = {
    'http://panel.example.com:25461/live/u/p/1.m3u8': redirect('http://103.163.132.49/hls/tok/index.m3u8'),
    'http://103.163.132.49/hls/tok/index.m3u8': text('#EXTM3U\n#EXTINF:10,\n423408_1.ts\n'),
  }; calls = [];
  const body = await (await call(builds.deno, 'http://panel.example.com:25461/live/u/p/1.m3u8')).text();
  assert.ok(body.includes(encodeURIComponent('http://103.163.132.49/hls/tok/423408_1.ts')));
});
test('deno: an internal exception still answers with CORS (no opaque "Load failed")', async () => {
  const r = await builds.deno.fetch({ method: 'GET', url: 'https://gw.test/proxy?url=x', headers: { get() { throw new Error('boom'); } } }, {});
  assert.equal(r.status, 500);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.equal(r.headers.get('x-tvpro-error'), 'GATEWAY_FAILURE');
});
for (const [name, gw] of Object.entries(builds)) {
  test(`${name}: "Blocked" labelled octet-stream → UPSTREAM_BLOCKED`, async () => {
    routes = { [PANEL + '/live/u/p/12.m3u8']: text('Blocked', 'application/octet-stream') }; calls = [];
    const r = await call(gw, PANEL + '/live/u/p/12.m3u8');
    assert.equal(r.headers.get('x-tvpro-error'), 'UPSTREAM_BLOCKED');
  });
}
