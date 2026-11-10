/*
 * TV Pro v2 — add/import a playlist (Xtream login or M3U URL), writing to the REAL
 * playlists/libraries/kv shape the shipped app itself uses.
 *
 * Confidence split, stated plainly because this writes real on-device data:
 *  - The WRITE SHAPE (playlists row, libraries row, kv["activePlaylist"], and the secret's
 *    AES-GCM encryption-at-rest via the vault key) is reproduced from the compiled bundle
 *    verbatim in storage.js's createPlaylist() — same field names, same
 *    crypto.subtle.encrypt({name:"AES-GCM"}, vaultKey, ...) call, same {iv, data} envelope.
 *    This is the part that could corrupt or desync real data if wrong, and it is not guessed.
 *  - The CONTENT MAPPING below for Xtream (get_live/vod/series_streams -> channel/movie/series
 *    items) mirrors the bundle's own field names closely (kind, id, group, logo, number,
 *    rating, xt, plot, genre, year, etc. — reverse-engineered from the same compiled bundle),
 *    but does NOT reproduce every edge case of its logo-backfill-from-channel-name or
 *    category-name-truncation helpers. It is a faithful but simplified reimplementation, not
 *    a byte-for-byte port, so a real import's channel groups/logos may differ slightly from
 *    what the shipped app itself would have produced for the same panel.
 *  - M3U import in this pass only produces CHANNEL entries (one per #EXTINF line), not movies/
 *    series: telling a VOD entry apart from a live channel in a raw M3U file needs heuristics
 *    (group-title keywords, URL shape) this pass does not attempt, so it is left out rather
 *    than guessed at and silently mis-filed as the wrong content type.
 * Because this always creates a NEW playlist (a fresh, separate row), nothing it does can
 * overwrite or corrupt an existing saved playlist/favorites/history — at worst, a user ends up
 * with an extra playlist they can delete from the existing app's own playlist manager.
 */
(function (global) {
  'use strict';

  function truncate(s, n) { return (s || '').length > n ? s.slice(0, n) : (s || ''); }
  function resolveUrl(u, origin) {
    if (!u) return undefined;
    try { return new URL(u, origin).toString(); } catch (_e) { return u; }
  }

  async function categoryMap(secret, action) {
    const list = await TvproXtream.api(secret, action);
    const map = new Map();
    (Array.isArray(list) ? list : []).forEach((c) => map.set(String(c.category_id || ''), truncate(c.category_name || '', 80)));
    return map;
  }

  async function fetchXtreamLibrary(secret) {
    const origin = TvproXtream.serverOrigin(secret.server);
    const [liveCats, liveList, vodCats, vodList, seriesCats, seriesList] = await Promise.all([
      categoryMap(secret, 'get_live_categories'), TvproXtream.api(secret, 'get_live_streams'),
      categoryMap(secret, 'get_vod_categories'), TvproXtream.api(secret, 'get_vod_streams'),
      categoryMap(secret, 'get_series_categories'), TvproXtream.api(secret, 'get_series'),
    ]);

    const channels = (Array.isArray(liveList) ? liveList : []).flatMap((e, n) => {
      const id = e.stream_id; if (!id) return [];
      return [{
        kind: 'channel', id: 'c:' + id, name: truncate(e.name || 'Channel ' + (n + 1), 100),
        group: liveCats.get(String(e.category_id || '')) || '', logo: resolveUrl(e.stream_icon, origin),
        number: Number(e.num) || n + 1, tvgId: e.epg_channel_id || undefined,
        xt: { kind: 'live', id, ext: 'ts' },
      }];
    });

    const movies = (Array.isArray(vodList) ? vodList : []).flatMap((e) => {
      const id = e.stream_id; if (!id) return [];
      return [{
        kind: 'movie', id: 'm:' + id, name: truncate(e.name || '', 100),
        group: vodCats.get(String(e.category_id || '')) || '', logo: resolveUrl(e.stream_icon, origin),
        rating: e.rating != null && e.rating !== '' ? Number(e.rating) : null,
        addedAt: Number(e.added) ? Number(e.added) * 1000 : Date.now(),
        xt: { kind: 'movie', id, ext: e.container_extension || 'mp4' },
      }];
    });

    const series = (Array.isArray(seriesList) ? seriesList : []).flatMap((e) => {
      const id = e.series_id; if (!id) return [];
      const backdrop = Array.isArray(e.backdrop_path) ? e.backdrop_path[0] : e.backdrop_path;
      return [{
        kind: 'series', id: 's:' + id, xtSeriesId: id, seasons: [],
        name: truncate(e.name || '', 100), group: seriesCats.get(String(e.category_id || '')) || '',
        logo: resolveUrl(e.cover, origin), plot: e.plot || undefined, genre: e.genre || undefined,
        rating: e.rating != null && e.rating !== '' ? Number(e.rating) : null,
        year: e.releaseDate ? Number(String(e.releaseDate).slice(0, 4)) : undefined,
        backdrop: resolveUrl(backdrop, origin), addedAt: Number(e.last_modified) ? Number(e.last_modified) * 1000 : Date.now(),
      }];
    });

    return { channels, movies, series };
  }

  /** Simplified M3U parser: #EXTINF/url pairs become channel entries only (see module header
   *  for why movies/series are not attempted here). */
  function parseM3U(text) {
    const lines = text.split(/\r?\n/);
    const channels = [];
    let pending = null;
    let n = 0;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('#EXTINF')) {
        const name = line.split(',').pop().trim();
        const logoMatch = line.match(/tvg-logo="([^"]*)"/i);
        const groupMatch = line.match(/group-title="([^"]*)"/i);
        const numMatch = line.match(/tvg-chno="([^"]*)"/i);
        pending = { name, logo: logoMatch ? logoMatch[1] : undefined, group: groupMatch ? groupMatch[1] : '', number: numMatch ? Number(numMatch[1]) : undefined };
      } else if (!line.startsWith('#') && pending) {
        n += 1;
        channels.push({ kind: 'channel', id: 'm3u:' + n, name: pending.name || 'Channel ' + n, group: pending.group || '', logo: pending.logo, number: pending.number || n, url: line });
        pending = null;
      }
    }
    return { channels, movies: [], series: [] };
  }

  global.TvproPlaylistImport = { fetchXtreamLibrary, parseM3U, truncate, resolveUrl };
})(window);
