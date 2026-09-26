// End-to-end playback test: the real TV Pro bundle in Chromium, a mock Xtream provider, and the real gateway code.
// Every request that reaches the "provider" is recorded, so each scenario proves how many upstream connections a
// play opens and where a failure is classified.
//
//   TVPRO_MEDIA=/path/to/media node tests/e2e/playback.e2e.mjs
//
// TVPRO_MEDIA must contain hls/index.m3u8 (+ init.mp4, seg*.m4s), movie.mp4 and movie.mkv, encoded as VP9/Opus
// (Playwright's Chromium has no H.264). Requires `playwright`; set CHROMIUM to a browser binary if needed.
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = path.resolve(new URL('../../', import.meta.url).pathname);
const MEDIA = process.env.TVPRO_MEDIA;
if (!MEDIA || !existsSync(path.join(MEDIA, 'hls/index.m3u8'))) { console.error('Set TVPRO_MEDIA (see header).'); process.exit(2); }
globalThis.TVPRO_UPSTREAM_TIMEOUT_MS = 1500;
const loadGw = async (f) => (await import('data:text/javascript,' + encodeURIComponent(readFileSync(path.join(ROOT, f), 'utf8')))).default;
const gateways = { deno: await loadGw('tvpro-gateway-deno.ts'), cloudflare: await loadGw('cloudflare-worker.js') };

// ---------------- mock Xtream provider ----------------
const P = { mode: {}, log: [] };
const json = (o) => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json' } });
const file = (f, ct, range) => {
  const buf = readFileSync(path.join(MEDIA, f));
  const m = range && /bytes=(\d*)-(\d*)/.exec(range);
  if (m) {
    const start = m[1] ? +m[1] : 0, end = m[2] ? Math.min(+m[2], buf.length - 1) : buf.length - 1;
    return new Response(buf.subarray(start, end + 1), { status: 206, headers: { 'content-type': ct, 'content-range': `bytes ${start}-${end}/${buf.length}`, 'content-length': String(end - start + 1), 'accept-ranges': 'bytes' } });
  }
  return new Response(buf, { headers: { 'content-type': ct, 'content-length': String(buf.length), 'accept-ranges': 'bytes' } });
};
async function provider(url, init = {}) {
  const u = new URL(url);
  const hdr = (n) => (init.headers && (init.headers[n] || (init.headers.get && init.headers.get(n)))) || '';
  P.log.push({ host: u.host, path: u.pathname, t: Date.now() });
  if (u.pathname === '/player_api.php') {
    if (u.searchParams.get('password') !== 's3cretpass') return json({ user_info: { auth: 0 } });
    const a = u.searchParams.get('action');
    const info = { auth: P.mode.auth ?? 1, status: P.mode.status || 'Active', max_connections: '1', active_cons: P.mode.active || '0', allowed_output_formats: ['m3u8', 'ts'] };
    const data = {
      '': { user_info: info, server_info: {} },
      get_live_categories: [{ category_id: '1', category_name: 'News' }],
      get_live_streams: [{ stream_id: 101, name: 'Live One', num: 1, category_id: '1' }, { stream_id: 102, name: 'Live Two', num: 2, category_id: '1' }],
      get_vod_categories: [{ category_id: '2', category_name: 'Films' }],
      get_vod_streams: [{ stream_id: 201, name: 'Movie MP4', container_extension: 'mp4', category_id: '2' }, { stream_id: 202, name: 'Movie MKV', container_extension: 'mkv', category_id: '2' }],
      get_series_categories: [{ category_id: '3', category_name: 'Shows' }],
      get_series: [{ series_id: 301, name: 'Show One', category_id: '3' }],
      get_series_info: { episodes: { 1: [{ id: '401', episode_num: 1, title: 'Pilot', container_extension: 'mp4' }] } },
      get_vod_info: { info: {}, movie_data: {} },
    }[a || ''];
    return json(data ?? []);
  }
  let m;
  if ((m = /^\/live\/tvuser\/s3cretpass\/(\d+)\.m3u8$/.exec(u.pathname))) {
    const mode = P.mode.live;
    if (mode === 'blocked') return new Response('Blocked', { headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
    if (mode === '403') return new Response('Forbidden', { status: 403 });
    if (mode === 'timeout') return new Promise((_, rej) => init.signal && init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
    // HTTPS providers usually answer the playlist directly (absolute segment URLs); HTTP panels redirect to a bare-IP edge.
    if (u.protocol === 'https:') return new Response(readFileSync(path.join(MEDIA, 'hls/index.m3u8'), 'utf8').replace(/^(?!#)(\S+)$/gm, `https://secure.example.com/hls/tok${m[1]}/$1`).replace(/URI="([^"]+)"/, `URI="https://secure.example.com/hls/tok${m[1]}/$1"`), { headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
    return new Response(null, { status: 302, headers: { location: `http://103.163.132.49/hls/tok${m[1]}/index.m3u8` } });
  }
  if ((m = /^\/hls\/tok\d+\/(index\.m3u8|init\.mp4|seg\d+\.m4s)$/.exec(u.pathname))) {
    const f = m[1];
    return f.endsWith('.m3u8') ? file('hls/index.m3u8', 'application/vnd.apple.mpegurl') : file('hls/' + f, 'video/mp4', hdr('Range'));
  }
  if (u.pathname === '/movie/tvuser/s3cretpass/201.mp4' || u.pathname === '/series/tvuser/s3cretpass/401.mp4') return file('movie.mp4', 'video/mp4', hdr('Range'));
  if (u.pathname === '/movie/tvuser/s3cretpass/202.mkv') return file('movie.mkv', 'video/x-matroska', hdr('Range'));
  return new Response('not found', { status: 404 });
}
globalThis.fetch = async (url, init) => {
  const h = new URL(url).host;
  if (h === 'panel.example.com' || h === '103.163.132.49' || h === 'secure.example.com') return provider(url, init);
  throw new TypeError('connect ECONNREFUSED ' + h);
};

// ---------------- browser plumbing ----------------
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain' };
const GW_HOSTS = { 'great-fox-5853.abu00salmanr.deno.net': 'deno', 'tvpro-gateway.rmz.deno.net': 'deno', 'gateway.tv-pro.app': 'cloudflare', 'tvpro-gateway.abu00salman-r.workers.dev': 'cloudflare' };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });

async function session(opts = {}) {
  const server = opts.server || 'http://panel.example.com';
  const ctx = await browser.newContext({ serviceWorkers: 'block', ...(opts.userAgent ? { userAgent: opts.userAgent } : {}) });
  const hits = [], direct = [];
  await ctx.route('**/*', async (route) => {
    const req = route.request(), u = new URL(req.url());
    if (u.origin === 'https://tv-pro.app') {
      let p = decodeURIComponent(u.pathname); if (p.endsWith('/')) p += 'index.html';
      const f = path.join(ROOT, p);
      return existsSync(f) ? route.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: readFileSync(f) }) : route.fulfill({ status: 404, body: 'nf' });
    }
    if (u.host === 'secure.example.com') {
      direct.push(u.pathname);
      // A CORS refusal reaches page scripts as a plain network error; Playwright relaxes CORS on mocked responses, so simulate it.
      if (opts.cors === false && u.pathname !== '/player_api.php') return route.abort('failed');
      const res = await provider(req.url(), { headers: req.headers() });
      const headers = {}; res.headers.forEach((v, k) => { headers[k] = v; });
      if (opts.cors !== false) headers['access-control-allow-origin'] = '*';
      if (res.status >= 300 && res.status < 400) return route.fulfill({ status: res.status, headers });
      return route.fulfill({ status: res.status, headers, body: Buffer.from(await res.arrayBuffer()) });
    }
    const gw = GW_HOSTS[u.host];
    if (gw) {
      if (u.pathname === '/proxy' && !/player_api/.test(u.searchParams.get('url') || '')) hits.push(u.host);
      if (opts.gatewayDown) return route.abort('connectionreset');
      const res = await gateways[gw].fetch(new Request(req.url(), { method: req.method(), headers: req.headers() }), {});
      const headers = {}; res.headers.forEach((v, k) => { headers[k] = v; });
      return route.fulfill({ status: res.status, headers, body: Buffer.from(await res.arrayBuffer()) });
    }
    return route.abort('blockedbyclient');
  });
  const page = await ctx.newPage();
  await page.goto('https://tv-pro.app/');
  await page.getByText('Sign in to a server').click();
  await page.getByLabel('Server / portal URL').fill(server);
  await page.getByLabel('Username').fill('tvuser');
  await page.getByLabel('Password', { exact: true }).fill('s3cretpass');
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.getByText('Live One').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {}); await page.waitForTimeout(500);
  return { ctx, page, hits, direct };
}
const outcome = (page, ms = 25000) => page.waitForFunction(() => {
  const v = document.querySelector('video');
  if (v && v.currentTime > 0.3 && !v.paused) return 'playing';
  const a = document.querySelector('[role="alert"]');
  return a && a.textContent.trim() ? 'error' : false;
}, null, { timeout: ms, polling: 250 }).then((h) => h.jsonValue(), () => 'timeout');
const streamRequests = (re) => P.log.filter((l) => re.test(l.path)).length;
const results = [];
async function scenario(name, fn) {
  P.mode = {}; P.log = [];
  const t0 = Date.now();
  try { const r = await fn(); results.push({ name, ok: true, ms: Date.now() - t0, ...r }); console.log('✓', name, JSON.stringify(r)); }
  catch (e) { results.push({ name, ok: false, error: e.message }); console.log('✗', name, e.message); }
}
const lastLog = (page) => page.evaluate(() => (window.__tvproPlayLog ? window.__tvproPlayLog() : []));
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

// ---------------- scenarios ----------------
await scenario('live HLS (panel domain → 302 to bare IP) plays through the Deno gateway with ONE provider session', async () => {
  const { ctx, page, hits } = await session();
  P.log = []; hits.length = 0;
  await page.goto('https://tv-pro.app/#/live'); await page.getByText('Live One').first().click();
  const o = await outcome(page); await page.waitForTimeout(1500);
  const sessions = streamRequests(/^\/live\//);
  assert.equal(o, 'playing'); assert.equal(sessions, 1, 'one /live/ request');
  assert.ok(!hits.some((h) => GW_HOSTS[h] === 'cloudflare'), 'Cloudflare never tried');
  await ctx.close(); return { outcome: o, liveSessions: sessions, gatewayHits: [...new Set(hits)] };
});
await scenario('channel switch releases the previous stream (no requests to channel 1 after switching)', async () => {
  const { ctx, page } = await session();
  await page.goto('https://tv-pro.app/#/live'); await page.getByText('Live One').first().click();
  assert.equal(await outcome(page), 'playing');
  await page.getByText('Live Two').first().click();
  const tSwitch = Date.now(); await page.waitForTimeout(6000);
  const after = P.log.filter((l) => l.t > tSwitch + 500 && /tok101/.test(l.path)).length;
  const two = streamRequests(/^\/live\/tvuser\/s3cretpass\/102/);
  assert.equal(after, 0, 'no channel-1 traffic after switch'); assert.equal(two, 1);
  await ctx.close(); return { channel1RequestsAfterSwitch: after, channel2Sessions: two };
});
await scenario('panel answers "Blocked" → one attempt, UPSTREAM_403, no retries across gateways', async () => {
  const { ctx, page, hits } = await session();
  const consoleText = []; page.on('console', (m) => consoleText.push(m.text()));
  P.mode.live = 'blocked'; P.log = []; hits.length = 0;
  await page.goto('https://tv-pro.app/#/live'); await page.getByText('Live One').first().click();
  const o = await outcome(page); await page.waitForTimeout(2000);
  const sessions = streamRequests(/^\/live\//), log = await lastLog(page);
  const err = log.filter((e) => e.ev === 'error').pop();
  assert.equal(o, 'error'); assert.equal(sessions, 1); assert.equal(err && err.code, 'UPSTREAM_403');
  // credentials never reach the diagnostic log, the error overlay (developer detail) or the console
  const exposed = JSON.stringify(log) + (await page.textContent('body'));
  assert.ok(!/tvuser|s3cretpass/.test(exposed), 'credentials exposed in diagnostics/UI');
  assert.ok(!/tvuser|s3cretpass/.test(consoleText.join('\n')), 'credentials in console');
  await ctx.close(); return { liveSessions: sessions, code: err.code, gatewaysTried: hits.length, credentialsExposed: false };
});
await scenario('connection limit: provider 403 + player_api active 1/1 → CONNECTION_LIMIT message', async () => {
  const { ctx, page } = await session();
  P.mode.live = '403'; P.mode.active = '1'; P.log = [];
  await page.goto('https://tv-pro.app/#/live'); await page.getByText('Live One').first().click();
  assert.equal(await outcome(page), 'error');
  await page.waitForSelector('[data-tvpro-ext]'); await page.waitForTimeout(2500);
  const msg = await page.textContent('[data-tvpro-ext]');
  assert.match(msg, /connection limit/i);
  const sessions = streamRequests(/^\/live\//);
  assert.equal(sessions, 1);
  await ctx.close(); return { liveSessions: sessions, message: msg.slice(0, 120) };
});
await scenario('upstream timeout → at most 3 attempts, then UPSTREAM/GATEWAY 504 classification', async () => {
  const { ctx, page } = await session();
  P.mode.live = 'timeout'; P.log = [];
  await page.goto('https://tv-pro.app/#/live'); await page.getByText('Live One').first().click();
  const o = await outcome(page, 60000); await page.waitForTimeout(1000);
  const sessions = streamRequests(/^\/live\//), log = await lastLog(page);
  assert.equal(o, 'error'); assert.ok(sessions <= 3, 'at most 3 attempts, got ' + sessions);
  await ctx.close(); return { liveSessions: sessions, code: (log.filter((e) => e.ev === 'error').pop() || {}).code };
});
await scenario('movie MP4 (container_extension=mp4) plays; URL /movie/tvuser/s3cretpass/201.mp4', async () => {
  const { ctx, page } = await session();
  P.log = [];
  await page.goto('https://tv-pro.app/#/movies'); await page.getByText('Movie MP4').first().click();
  await page.getByRole('button', { name: /^(Play|Resume)$/ }).first().click();
  const o = await outcome(page);
  const paths = [...new Set(P.log.map((l) => l.path).filter((p) => p.startsWith('/movie/')))];
  assert.equal(o, 'playing'); assert.deepEqual(paths, ['/movie/tvuser/s3cretpass/201.mp4']);
  await ctx.close(); return { outcome: o, urls: paths, rangeRequests: streamRequests(/^\/movie\//) };
});
await scenario('movie MKV on iPhone Safari → UNSUPPORTED_CONTAINER, external player offered, ZERO provider requests', async () => {
  const { ctx, page } = await session({ userAgent: IPHONE });
  P.log = [];
  await page.goto('https://tv-pro.app/#/movies'); await page.getByText('Movie MKV').first().click();
  await page.getByRole('button', { name: /^(Play|Resume)$/ }).first().click();
  assert.equal(await outcome(page), 'error');
  await page.waitForSelector('[data-tvpro-ext]');
  const buttons = await page.$$eval('[data-tvpro-ext] button', (b) => b.map((x) => x.textContent));
  const n = streamRequests(/^\/movie\//), code = ((await lastLog(page)).filter((e) => e.code).pop() || {}).code;
  assert.equal(n, 0); assert.equal(code, 'UNSUPPORTED_CONTAINER');
  await ctx.close(); return { providerRequests: n, code, buttons };
});
await scenario('series episode (container_extension=mp4) → /series/tvuser/s3cretpass/401.mp4 plays', async () => {
  const { ctx, page } = await session();
  P.log = [];
  await page.goto('https://tv-pro.app/#/series'); await page.getByText('Show One').first().click();
  await page.getByText('Pilot').first().click();
  const o = await outcome(page);
  const paths = [...new Set(P.log.map((l) => l.path).filter((p) => p.startsWith('/series/')))];
  assert.equal(o, 'playing'); assert.deepEqual(paths, ['/series/tvuser/s3cretpass/401.mp4']);
  await ctx.close(); return { outcome: o, urls: paths };
});
await scenario('all gateways unreachable → bounded attempts and a classified error (no endless spinner)', async () => {
  const { ctx, page, hits } = await session({});
  await ctx.unroute('**/*').catch(() => {});
  await ctx.close();
  const s2 = await session({ gatewayDown: false });
  await s2.ctx.route(/deno\.net|workers\.dev|gateway\.tv-pro\.app/, (r) => { const q = new URL(r.request().url()); if (q.pathname === '/proxy') (/player_api/.test(q.searchParams.get('url') || '') ? s2.api : s2.hits).push(q.host); r.abort('connectionreset'); });
  P.log = []; s2.hits.length = 0; s2.api = [];
  await s2.page.goto('https://tv-pro.app/#/live'); await s2.page.getByText('Live One').first().click();
  const o = await outcome(s2.page, 60000);
  const code = ((await lastLog(s2.page)).filter((e) => e.ev === 'error').pop() || {}).code;
  assert.equal(o, 'error'); assert.ok(s2.hits.length <= 3, 'gateway attempts ' + s2.hits.length);
  await s2.ctx.close(); return { streamAttempts: s2.hits.length, accountChecks: s2.api.length, code };
});
await scenario('wrong credentials are rejected at login (auth error, no streams requested)', async () => {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await ctx.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.origin === 'https://tv-pro.app') { let p = u.pathname.endsWith('/') ? u.pathname + 'index.html' : u.pathname; const f = path.join(ROOT, p); return existsSync(f) ? route.fulfill({ body: readFileSync(f), contentType: TYPES[path.extname(f)] }) : route.fulfill({ status: 404 }); }
    if (GW_HOSTS[u.host]) { const res = await gateways.deno.fetch(new Request(u.toString()), {}); const h = {}; res.headers.forEach((v, k) => { h[k] = v; }); return route.fulfill({ status: res.status, headers: h, body: Buffer.from(await res.arrayBuffer()) }); }
    return route.abort();
  });
  P.log = [];
  await page.goto('https://tv-pro.app/');
  await page.getByText('Sign in to a server').click();
  await page.getByLabel('Server / portal URL').fill('http://panel.example.com');
  await page.getByLabel('Username').fill('tvuser'); await page.getByLabel('Password', { exact: true }).fill('WRONG');
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.waitForTimeout(3000);
  const still = await page.getByLabel('Password', { exact: true }).isVisible();
  const streams = streamRequests(/^\/(live|movie|series)\//);
  assert.ok(still); assert.equal(streams, 0);
  await ctx.close(); return { stayedOnLogin: still, streamRequests: streams };
});

await scenario('HTTPS source with CORS plays DIRECTLY (gateway not used)', async () => {
  const { ctx, page, hits, direct } = await session({ server: 'https://secure.example.com' });
  hits.length = 0; direct.length = 0; P.log = [];
  await page.goto('https://tv-pro.app/#/live'); await page.getByText('Live One').first().click();
  const o = await outcome(page);
  const steps = (await lastLog(page)).map((e) => e.ev + (e.err ? ':' + e.err : '') + (e.detail ? '(' + e.detail + ')' : '') + '@' + e.route);
  assert.equal(o, 'playing'); assert.equal(hits.length, 0, 'no gateway ' + JSON.stringify(steps) + ' ' + JSON.stringify(direct)); assert.equal(streamRequests(/^\/live\//), 1);
  await ctx.close(); return { outcome: o, gatewayRequests: hits.length, directRequests: direct.length };
});
await scenario('HTTPS source refused by CORS → one gateway fallback, then plays', async () => {
  const { ctx, page, hits } = await session({ server: 'https://secure.example.com', cors: false });
  hits.length = 0; P.log = [];
  await page.goto('https://tv-pro.app/#/live'); await page.getByText('Live One').first().click();
  const o = await outcome(page);
  const log = await lastLog(page);
  assert.equal(o, 'playing'); assert.equal(hits.length > 0, true, 'gateway used'); assert.ok(streamRequests(/^\/live\//) <= 2);
  await ctx.close(); return { outcome: o, providerLiveRequests: streamRequests(/^\/live\//), gatewayUsed: [...new Set(hits)], steps: log.filter((e) => e.ev !== 'account').map((e) => e.ev + (e.err ? ':' + e.err : '') + '@' + e.route) };
});

await scenario('demo: 7 channels / 7 movies / 7 real series with artwork; an episode plays; an old demo is upgraded in place', async () => {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const iaReq = [];
  await ctx.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.origin === 'https://tv-pro.app') { let p = u.pathname.endsWith('/') ? u.pathname + 'index.html' : u.pathname; const f = path.join(ROOT, decodeURIComponent(p)); return existsSync(f) ? route.fulfill({ body: readFileSync(f), contentType: TYPES[path.extname(f)] || 'application/octet-stream' }) : route.fulfill({ status: 404 }); }
    const h = { 'access-control-allow-origin': '*' };
    if (u.host === 'archive.org') {
      iaReq.push(u.pathname);
      if (u.pathname === '/advancedsearch.php') { const slug = (/title:\(\"?([^")]+)/.exec(u.searchParams.get('q')) || [, 'x'])[1].replace(/\W+/g, '_'); return route.fulfill({ headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ response: { docs: [1, 2, 3].map((n) => ({ identifier: slug + '_' + n, title: slug.replace(/_/g, ' ') + ' - Episode ' + n })) } }) }); }
      if (u.pathname.startsWith('/metadata/')) { const id = decodeURIComponent(u.pathname.slice(10)); return route.fulfill({ headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ metadata: { title: id }, files: [{ name: id + '_512kb.mp4', format: 'h.264', size: '1000' }] }) }); }
      if (u.pathname.startsWith('/download/')) { const r = file('movie.mp4', 'video/mp4', route.request().headers().range); const hh = { ...h }; r.headers.forEach((v, k) => { hh[k] = v; }); return route.fulfill({ status: r.status, headers: hh, body: Buffer.from(await r.arrayBuffer()) }); }
      if (u.pathname.startsWith('/services/img/')) return route.fulfill({ headers: h, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="3"/>' });
      return route.fulfill({ status: 404 });
    }
    if (/\.m3u8$/.test(u.pathname)) return route.fulfill({ headers: { ...h, 'content-type': 'application/vnd.apple.mpegurl' }, body: '#EXTM3U\n' });
    return route.abort('blockedbyclient');
  });
  const page = await ctx.newPage();
  const libCounts = () => page.evaluate(() => new Promise((res) => { const r = indexedDB.open('tvpro'); r.onsuccess = () => { const q = r.result.transaction('libraries').objectStore('libraries').get('demo'); q.onsuccess = () => res(q.result && [q.result.channels.length, q.result.movies.length, q.result.series.length, q.result.demoVersion]); }; }));
  await page.goto('https://tv-pro.app/');
  await page.getByText('Try the demo').click();
  await page.getByText('Live').first().waitFor({ timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const counts = await libCounts();
  assert.deepEqual(counts, [7, 7, 7, 3]);
  await page.goto('https://tv-pro.app/#/series');
  await page.waitForTimeout(1500);
  const cards = await page.$$eval('img', (i) => i.filter((x) => x.src.includes('archive.org/services/img/')).length);
  assert.ok(cards >= 7, 'series artwork shown: ' + cards);
  await page.getByText('Sherlock Holmes').first().click();
  await page.getByText(/Episode 1/).first().click();
  const o = await outcome(page);
  assert.equal(o, 'playing');
  // an older demo library (as stored before this change) is upgraded automatically on the next visit
  await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('tvpro'); r.onsuccess = () => { const tx = r.result.transaction('libraries', 'readwrite'); tx.objectStore('libraries').put({ playlistId: 'demo', channels: [{ id: 'demo-c1' }], movies: [], series: [] }); tx.oncomplete = res; }; }));
  await page.evaluate(() => sessionStorage.clear());
  await page.reload(); await page.waitForTimeout(9000);
  const upgraded = await libCounts();
  assert.deepEqual(upgraded, [7, 7, 7, 3]);
  await ctx.close(); return { counts, seriesArtwork: cards, episode: o, upgraded };
});

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} scenarios passed`);
process.exit(failed.length ? 1 : 0);
