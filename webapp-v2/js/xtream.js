/*
 * TV Pro v2 — shared Xtream Codes API helper.
 *
 * The request shape and gateway fallback loop here are ported directly from the existing,
 * already-working epg.html (its `xtreamApi`/`serverOrigin`/`b64` functions) rather than
 * rewritten from scratch, per the brief — only the gateway loop itself is swapped for
 * gateway.js's shared `routes()`/fetch so there's one fallback-chain implementation instead
 * of two copies drifting apart. Used by title.js (get_vod_info / get_series_info) and will be
 * used by guide.js (get_short_epg / get_simple_data_table) for the EPG restyle.
 */
(function (global) {
  'use strict';

  function serverOrigin(s) {
    const t = String(s).trim();
    try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : 'http://' + t).origin; } catch (_e) { return t.replace(/\/+$/, ''); }
  }

  async function timed(url, ms) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms || 10000);
    try { return { r: await fetch(url, { signal: ctl.signal, cache: 'no-store' }) }; }
    catch (e) { return { err: e }; }
    finally { clearTimeout(timer); }
  }

  /** Same one-gateway-at-a-time-until-one-answers loop as epg.html's xtreamApi(), reusing
   *  gateway.js's via() for the actual URL building so both pages share one convention. */
  async function api(secret, action, extraQuery) {
    const base = new URL(serverOrigin(secret.server) + '/player_api.php');
    base.searchParams.set('username', secret.username);
    base.searchParams.set('password', secret.password);
    if (action) base.searchParams.set('action', action);
    let url = base.toString();
    if (extraQuery) url += extraQuery;
    for (const gw of global.TvproGateway.GATEWAYS) {
      const res = await timed(global.TvproGateway.via(gw, url), 10000);
      if (res.err || !res.r.ok) continue;
      try { return await res.r.json(); } catch (_e) { continue; }
    }
    throw new Error('xtream-unavailable');
  }

  function b64(s) {
    if (!s) return '';
    try { const bin = atob(s); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new TextDecoder('utf-8').decode(bytes); }
    catch (_e) { return s; }
  }

  async function getVodInfo(secret, vodId) {
    const data = await api(secret, 'get_vod_info', '&vod_id=' + encodeURIComponent(vodId));
    const info = (data && data.info) || {};
    return {
      plot: info.plot || info.description || undefined,
      genre: info.genre || undefined,
      duration: Number(info.duration_secs) || undefined,
      backdrop: Array.isArray(info.backdrop_path) ? info.backdrop_path[0] : info.backdrop_path,
      year: info.releasedate ? Number(String(info.releasedate).slice(0, 4)) : undefined,
    };
  }

  async function getSeriesInfo(secret, seriesId) {
    const data = await api(secret, 'get_series_info', '&series_id=' + encodeURIComponent(seriesId));
    const out = [];
    for (const [season, episodes] of Object.entries((data && data.episodes) || {})) {
      const list = (Array.isArray(episodes) ? episodes : Object.values(episodes || {})).flatMap((ep) => {
        const info = ep.info || {};
        if (!ep.id) return [];
        return [{
          season: Number(season) || 1,
          number: Number(ep.episode_num) || 0,
          title: ep.title || '',
          thumbnail: info.movie_image,
          duration: Number(info.duration_secs) || undefined,
          xt: { kind: 'series', id: ep.id, ext: ep.container_extension || 'mp4' },
        }];
      });
      if (list.length) out.push({ number: Number(season) || 1, episodes: list });
    }
    return out.sort((a, b) => a.number - b.number);
  }

  async function getShortEpg(secret, streamId, limit) {
    const data = await api(secret, 'get_short_epg', '&stream_id=' + encodeURIComponent(streamId) + '&limit=' + (limit || 2));
    return (data && data.epg_listings) || [];
  }

  async function getSimpleDataTable(secret, streamId) {
    const data = await api(secret, 'get_simple_data_table', '&stream_id=' + encodeURIComponent(streamId));
    return (data && data.epg_listings) || [];
  }

  async function getAccountInfo(secret) {
    const data = await api(secret, undefined, '');
    return (data && data.user_info) || null;
  }

  global.TvproXtream = { serverOrigin, api, b64, getVodInfo, getSeriesInfo, getShortEpg, getSimpleDataTable, getAccountInfo };
})(window);
