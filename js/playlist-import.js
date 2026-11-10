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
 *  - M3U import now classifies each entry as a channel, movie, or series episode using
 *    explicit, disclosed, conservative heuristics (see the comment above parseM3U below) —
 *    a plain M3U file carries no structured content-type flag the way Xtream's API does, so
 *    every classification here is an inference. The default on any ambiguity is "channel"
 *    (the least harmful misclassification), never an aggressive movie/series guess.
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

  // ---- M3U content-type heuristics (disclosed, conservative) ----
  // A plain M3U file carries no structured "this is a movie" flag the way Xtream's API does,
  // so every signal below is an inference, not a fact from the source data:
  //  - VOD_EXT: a direct file extension (mp4/mkv/avi/...) on the stream URL. Live channels in
  //    practice are served as .m3u8 or .ts (or no extension at all, via a token/path), so a
  //    file-style extension is a reasonably strong signal of on-demand content. HIGH confidence.
  //  - EPISODE_RE: a "S01E02" / "1x02" pattern in the title is a strong, common convention for
  //    a series episode. HIGH confidence for the pattern match itself; the series NAME it is
  //    grouped under (everything before the match) is a weaker inference — two differently-
  //    formatted titles for the same show will end up as two separate series rather than being
  //    merged, which is the conservative failure mode (more, smaller series) rather than the
  //    aggressive one (wrongly merging two different shows).
  //  - Anything that matches neither signal stays a CHANNEL, the conservative default, even if
  //    its group-title merely sounds VOD-ish (e.g. "Movies" as a live-channel category name is
  //    common on real panels) — a wrong "channel" costs the user one extra row in Live TV, a
  //    wrong "movie" would hide a live channel inside the wrong tab entirely.
  const VOD_EXT = /\.(mp4|mkv|avi|mov|m4v|flv|wmv|ts\.mp4)(\?.*)?$/i;
  const EPISODE_RE = /^(.*?)[\s._-]*[sS](\d{1,2})[\s._-]*[eE](\d{1,3})\b(.*)$/;
  const EPISODE_RE_X = /^(.*?)[\s._-]*(\d{1,2})x(\d{1,3})\b(.*)$/;

  function parseEpisode(name) {
    let m = EPISODE_RE.exec(name);
    if (m) return { series: m[1].trim().replace(/[\s._-]+$/, ''), season: Number(m[2]), episode: Number(m[3]), rest: m[4].trim() };
    m = EPISODE_RE_X.exec(name);
    if (m) return { series: m[1].trim().replace(/[\s._-]+$/, ''), season: Number(m[2]), episode: Number(m[3]), rest: m[4].trim() };
    return null;
  }

  /** M3U parser: every #EXTINF/url pair is classified as a channel (default), a movie (direct
   *  VOD file extension, no episode pattern), or a series episode (episode pattern in the
   *  title — grouped into one series per distinct inferred series name). See the heuristics
   *  comment above for exactly how and why. */
  function parseM3U(text) {
    const lines = text.split(/\r?\n/);
    const channels = [];
    const movies = [];
    const seriesMap = new Map(); // series name -> { name, group, logo, seasonsMap: Map(season -> episodes[]) }
    let pending = null;
    let n = 0, mN = 0;
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
        const isVodFile = VOD_EXT.test(line);
        const ep = isVodFile ? parseEpisode(pending.name) : null;
        if (ep && ep.series) {
          const key = ep.series.toLowerCase();
          if (!seriesMap.has(key)) seriesMap.set(key, { name: ep.series, group: pending.group || '', logo: pending.logo, seasonsMap: new Map() });
          const s = seriesMap.get(key);
          if (!s.seasonsMap.has(ep.season)) s.seasonsMap.set(ep.season, []);
          s.seasonsMap.get(ep.season).push({ season: ep.season, number: ep.episode, title: ep.rest || ('Episode ' + ep.episode), url: line });
        } else if (isVodFile) {
          mN += 1;
          movies.push({ kind: 'movie', id: 'm3u:m:' + mN, name: pending.name || 'Movie ' + mN, group: pending.group || '', logo: pending.logo, rating: null, addedAt: Date.now() - mN, url: line });
        } else {
          n += 1;
          channels.push({ kind: 'channel', id: 'm3u:c:' + n, name: pending.name || 'Channel ' + n, group: pending.group || '', logo: pending.logo, number: pending.number || n, url: line });
        }
        pending = null;
      }
    }
    let sN = 0;
    const series = [...seriesMap.values()].map((s) => {
      sN += 1;
      const seasons = [...s.seasonsMap.entries()].sort((a, b) => a[0] - b[0]).map(([number, episodes]) => ({ number, episodes: episodes.sort((a, b) => a.number - b.number) }));
      return { kind: 'series', id: 'm3u:s:' + sN, name: s.name, group: s.group, logo: s.logo, seasons, addedAt: Date.now() - sN };
    });
    return { channels, movies, series };
  }

  global.TvproPlaylistImport = { fetchXtreamLibrary, parseM3U, truncate, resolveUrl };
})(window);
