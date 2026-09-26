// Demo library builder: node --test tests/gateway.test.mjs tests/demo.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const page = readFileSync(new URL('../_next/static/chunks/app/' + /page-[a-f0-9]+\.js/.exec(html)[0], import.meta.url), 'utf8');
globalThis.window = globalThis;
globalThis.document = { readyState: 'loading' };
globalThis.addEventListener = () => {};
(0, eval)(page.slice(page.indexOf(';(function(){if(typeof window==="undefined"||window.__tvproBuildDemo)return;')));

const ok = (body, ct = 'application/json') => new Response(typeof body === 'string' ? body : JSON.stringify(body), { headers: { 'content-type': ct } });
/* A fake internet: broadcasters' playlists, and the Internet Archive search/metadata APIs.
   `corsBlocked` hosts throw when fetched directly (as a CORS refusal does) but work through a gateway. */
function net({ deadChannels = [], corsBlocked = [], failSearch = [], noMp4 = [] } = {}) {
  const calls = { direct: 0, gateway: 0 };
  const handle = (url) => {
    const u = new URL(url);
    if (/\.m3u8$/.test(u.pathname)) return deadChannels.some((d) => url.includes(d)) ? new Response('gone', { status: 404 }) : ok('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nx.m3u8\n', 'application/vnd.apple.mpegurl');
    if (u.host === 'archive.org' && u.pathname === '/advancedsearch.php') {
      const q = u.searchParams.get('q');
      if (failSearch.some((f) => q.includes(f))) return new Response('err', { status: 503 });
      const slug = (/title:\(\"?([^")]+)/.exec(q) || [, 'x'])[1].replace(/\W+/g, '_');
      return ok({ response: { docs: [1, 2, 3, 4].map((n) => ({ identifier: slug + '_' + n, title: slug.replace(/_/g, ' ') + ' - Episode ' + n })) } });
    }
    const m = /^\/metadata\/(.+)$/.exec(u.pathname);
    if (u.host === 'archive.org' && m) {
      const id = decodeURIComponent(m[1]);
      if (noMp4.some((f) => id.includes(f))) return ok({ files: [{ name: 'a.ogv', format: 'Ogg Video' }] });
      return ok({ metadata: { title: id }, files: [{ name: id + '.ia.mp4', format: 'MPEG4' }, { name: id + '.mkv', format: 'Matroska' }, { name: id + '_512kb.mp4', format: 'h.264', size: '300000000', length: '1500.5' }] });
    }
    throw new TypeError('unexpected ' + url);
  };
  const f = async (url) => {
    const u = new URL(url);
    if (u.pathname === '/proxy') { calls.gateway++; return handle(u.searchParams.get('url')); }
    calls.direct++;
    if (corsBlocked.includes(u.host)) throw new TypeError('Failed to fetch');
    return handle(url);
  };
  f.calls = calls;
  return f;
}

test('7 channels, 7 movies, 7 real series; movies never appear as episodes; everything has artwork', async () => {
  globalThis.fetch = net();
  const lib = await window.__tvproBuildDemo(null);
  assert.deepEqual([lib.channels.length, lib.movies.length, lib.series.length], [7, 7, 7]);
  assert.deepEqual(lib.channels.map((c) => c.number), [1, 2, 3, 4, 5, 6, 7]);
  for (const c of lib.channels) assert.match(c.logo, /^data:image\/svg\+xml/);
  for (const m of lib.movies) { assert.match(m.url, /^https:\/\/archive\.org\/download\/.+_512kb\.mp4$/); assert.ok(m.logo && m.plot && m.year); }
  const movieUrls = new Set(lib.movies.map((m) => m.url));
  for (const s of lib.series) {
    assert.ok(s.logo, 'series artwork');
    const eps = s.seasons[0].episodes;
    assert.ok(eps.length >= 2);
    for (const e of eps) { assert.ok(!movieUrls.has(e.url), 'a movie inside a series'); assert.ok(e.thumbnail); assert.ok(!/^Sherlock Holmes/.test(e.title), 'series name stripped from episode title'); }
  }
  assert.equal(lib.demoVersion, 3);
  assert.equal(new Set([...lib.channels, ...lib.movies, ...lib.series].map((x) => x.id)).size, 21, 'unique ids');
});

test('dead channels and unresolvable titles are dropped; spare candidates keep the lists at 7', async () => {
  globalThis.fetch = net({ deadChannels: ['alhadath', 'france24.com/live/F24_AR'], failSearch: ['Bonanza'], noMp4: ['Charade'] });
  const lib = await window.__tvproBuildDemo(null);
  assert.equal(lib.channels.length, 7);
  assert.ok(!lib.channels.some((c) => /الحدث|فرانس 24 عربي/.test(c.name)));
  assert.equal(lib.movies.length, 7);
  assert.ok(!lib.movies.some((m) => m.name === 'Charade'));
  assert.equal(lib.series.length, 7);
  assert.ok(!lib.series.some((s) => s.name === 'Bonanza'));
});

test('Internet Archive search blocked for the browser (CORS) → resolved through the gateway', async () => {
  const f = net({ corsBlocked: ['archive.org'] });
  globalThis.fetch = f;
  const lib = await window.__tvproBuildDemo(null);
  assert.equal(lib.movies.length, 7);
  assert.equal(lib.series.length, 7);
  assert.ok(f.calls.gateway > 0);
});

test('fully offline → falls back to the built-in demo instead of an empty library', async () => {
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  const base = { channels: [{ id: 'x' }], movies: [], series: [] };
  assert.equal(await window.__tvproBuildDemo(base), base);
});
