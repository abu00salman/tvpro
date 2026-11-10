/*
 * TV Pro v2 — local demo dataset.
 *
 * Used ONLY when no real playlist is saved on this device (storage.loadActiveLibrary()
 * returns ok:false) so the interface can be built, tested and screenshotted without a live
 * IPTV subscription or network access. Every item here is placeholder/sample data: titles are
 * generic, posters are CSS gradients (no copied artwork), and no rating/metadata is invented
 * to look like a real scraped value — `rating` is left `null` and the UI must render that as
 * "—", never as a fabricated number. This is NOT shipped as real content and must never be
 * mixed with a real library (storage.js keeps the two paths separate; app.js only reaches for
 * this file when storage reports no saved playlist).
 */
(function (global) {
  'use strict';

  const GENRES = ['Action', 'Drama', 'Comedy', 'Sci-Fi', 'Documentary', 'Animation'];
  const PLATFORMS = ['Demo Network', 'Sample Studio', 'Open Library'];

  function hue(seed) {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
    return h;
  }

  function makeItems(kind, count) {
    const out = [];
    for (let i = 1; i <= count; i++) {
      const id = kind + '-' + i;
      const year = 2018 + ((i * 7) % 8);
      out.push({
        id,
        type: kind,
        name: 'Demo ' + (kind === 'movie' ? 'Movie' : kind === 'series' ? 'Series' : kind === 'anime' ? 'Anime' : 'Channel') + ' ' + i,
        group: GENRES[i % GENRES.length],
        genre: GENRES[i % GENRES.length],
        year,
        platform: PLATFORMS[i % PLATFORMS.length],
        rating: null, // never fabricated — render as "—"
        hue: hue(id),
        addedAt: Date.now() - i * 86400000,
      });
    }
    return out;
  }

  const demo = {
    label: 'DEMO',
    channels: makeItems('channel', 14).map((c, i) => ({ ...c, number: i + 1, live: i < 3 })),
    movies: makeItems('movie', 24),
    series: makeItems('series', 18),
    anime: makeItems('anime', 10),
  };

  function heroItems() {
    // Multi-item hero: a handful of "featured" picks across movies/series for the slider.
    return [...demo.movies.slice(0, 4), ...demo.series.slice(0, 3)];
  }

  function searchAll(query) {
    const q = (query || '').trim().toLowerCase();
    const bucket = (arr, type) => (!q ? arr : arr.filter((it) => it.name.toLowerCase().includes(q))).map((it) => ({ ...it, type }));
    return {
      movies: bucket(demo.movies, 'movie'),
      series: bucket(demo.series, 'series'),
      anime: bucket(demo.anime, 'anime'),
      live: bucket(demo.channels, 'live'),
    };
  }

  global.TvproDemo = { ...demo, heroItems, searchAll, GENRES, PLATFORMS };
})(window);
