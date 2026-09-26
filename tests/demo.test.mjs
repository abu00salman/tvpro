// Demo library builder: node --test tests/gateway.test.mjs tests/demo.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const page = readFileSync(new URL('../_next/static/chunks/app/' + /page-[a-f0-9]+\.js/.exec(html)[0], import.meta.url), 'utf8');
globalThis.window = globalThis;
// the builder is appended to the page chunk after the player helpers; run only that part
(0, eval)(page.slice(page.indexOf(';(function(){if(typeof window==="undefined"||window.__tvproBuildDemo)return;')));
const base = { channels: [1, 2, 3, 4].map((n) => ({ kind: 'channel', id: 'demo-c' + n, playlistId: 'demo', number: n, name: 'c' + n, url: 'https://x/' + n + '.m3u8' })), movies: [1, 2, 3].map((n) => ({ kind: 'movie', id: 'demo-m' + n, playlistId: 'demo', name: 'm' + n, url: 'https://x/m' + n + '.m3u8' })), series: [{ kind: 'series', id: 'demo-s1', playlistId: 'demo', name: 's1', seasons: [] }] };

const ok = (j) => new Response(JSON.stringify(j), { headers: { 'content-type': 'application/json' } });
function archive({ failSearch = [], failMeta = [] } = {}) {
  return async (url) => {
    const u = new URL(url);
    if (u.pathname === '/advancedsearch.php') {
      const q = u.searchParams.get('q');
      if (failSearch.some((f) => q.includes(f))) return new Response('err', { status: 503 });
      const slug = q.replace(/[^a-z]/gi, '').slice(-12);
      return ok({ response: { docs: [1, 2, 3].map((n) => ({ identifier: slug + '_' + n, title: slug + ' ' + n })) } });
    }
    const m = /^\/metadata\/(.+)$/.exec(u.pathname);
    if (m) {
      const id = decodeURIComponent(m[1]);
      if (failMeta.some((f) => id.includes(f))) return ok({ files: [{ name: 'x.ogv', format: 'Ogg Video' }] });
      return ok({ metadata: { title: id }, files: [{ name: id + '.ia.mp4', format: 'MPEG4' }, { name: id + '.mkv', format: 'Matroska' }, { name: id + '_512kb.mp4', format: 'h.264', size: '300000000' }, { name: id + '.mpeg', format: 'MPEG2' }] });
    }
    throw new TypeError('unexpected ' + url);
  };
}

test('everything resolves → 7 channels, 7 movies, 7 series, all with playable H.264 MP4 links', async () => {
  globalThis.fetch = archive();
  const lib = await window.__tvproBuildDemo(base);
  assert.equal(lib.channels.length, 7);
  assert.equal(lib.movies.length, 7);
  assert.equal(lib.series.length, 7);
  for (const m of lib.movies) assert.ok(m.url && m.kind === 'movie' && m.playlistId === 'demo');
  for (const s of lib.series.slice(1)) {
    assert.ok(s.seasons[0].episodes.length >= 1);
    for (const e of s.seasons[0].episodes) assert.match(e.url, /^https:\/\/archive\.org\/download\/.+_512kb\.mp4$/, 'H.264 derivative, never .ia.mp4/mkv');
  }
  assert.deepEqual(lib.channels.map((c) => c.number), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(new Set([...lib.channels, ...lib.movies, ...lib.series].map((x) => x.id)).size, 21, 'unique ids');
});

test('titles that do not resolve are left out (no broken entries)', async () => {
  globalThis.fetch = archive({ failSearch: ['Popeye', 'Nosferatu'], failMeta: ['Superman'] });
  const lib = await window.__tvproBuildDemo(base);
  assert.equal(lib.series.length, 5);
  assert.ok(!lib.series.some((s) => /Popeye|Superman/.test(s.name)));
  assert.equal(lib.movies.length, 6);
  assert.ok(!lib.movies.some((m) => m.name === 'Nosferatu'));
});

test('Internet Archive unreachable → the static demo still works (7 channels, 4 movies, 1 series)', async () => {
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  const lib = await window.__tvproBuildDemo(base);
  assert.deepEqual([lib.channels.length, lib.movies.length, lib.series.length], [7, 4, 1]);
});
