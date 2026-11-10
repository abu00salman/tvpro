/*
 * TV Pro v2 — title/detail page.
 * Real detail (plot/genre/duration/backdrop, season/episode list) is fetched live via
 * get_vod_info/get_series_info (js/xtream.js) when a real Xtream playlist is active;
 * otherwise falls back to the item's own already-loaded fields (M3U-sourced items never had
 * this extra detail in the shipped app either) or, for a demo item, the local placeholder
 * fields from demo.js. Nothing here is ever invented to look like real metadata.
 */
(function (global) {
  'use strict';

  function fmtDuration(seconds) {
    if (!seconds) return null;
    const h = Math.floor(seconds / 3600), m = Math.round((seconds % 3600) / 60);
    return h ? h + 'h ' + m + 'm' : m + 'm';
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(location.search);
    const kind = params.get('kind');
    const id = params.get('id');
    const t = TvproI18n.t;
    const root = document.getElementById('titleRoot');

    const library = await TvproApp.getLibrary();
    TvproApp.renderDemoBanner(document.getElementById('main'), library.source);
    const item = kind && id ? TvproApp.resolveItem(library, kind, id) : null;
    if (!item) { root.innerHTML = '<div class="empty-state">' + t('title.not_found') + '</div>'; return; }

    document.title = item.name + ' — TV Pro';

    // ---- real detail fetch (best effort; falls back to whatever the item already carries) ----
    let detail = { plot: item.plot, genre: item.genre || item.group, duration: item.duration, backdrop: item.logo, year: item.year };
    let seasons = item.seasons || [];
    const isXtream = library.source === 'real' && library.secret && library.secret.type === 'xtream';
    if (isXtream && item.xt) {
      try {
        if (kind === 'movie') {
          const info = await TvproXtream.getVodInfo(library.secret, item.xt.id);
          detail = { ...detail, ...Object.fromEntries(Object.entries(info).filter(([, v]) => v !== undefined)) };
        } else if (kind === 'series') {
          seasons = await TvproXtream.getSeriesInfo(library.secret, item.xt.id);
        }
      } catch (_e) { /* panel unreachable — show what we already have rather than an error wall */ }
    }

    const posterSrc = detail.backdrop && /^https?:\/\//i.test(detail.backdrop)
      ? TvproGateway.via(TvproGateway.GATEWAYS[0], detail.backdrop)
      : TvproRows.posterUrl(item);

    const hero = document.createElement('div');
    hero.className = 'title-hero';
    hero.style.setProperty('--h', item.hue != null ? item.hue : 215);
    hero.innerHTML =
      '<button type="button" class="icon-btn title-back" data-action="back" aria-label="' + t('title.back') + '" style="background:rgba(0,0,0,.4);color:#fff">&#8592;</button>' +
      (posterSrc ? '<img class="title-hero__media" src="' + posterSrc + '" alt="">' : '<div class="title-hero__media" data-fallback="1"></div>');

    const body = document.createElement('div');
    body.className = 'title-hero__body';
    const h1 = document.createElement('h1'); h1.className = 'title-hero__title'; h1.textContent = item.name; h1.dir = 'auto';
    body.appendChild(h1);

    const meta = document.createElement('div'); meta.className = 'title-hero__meta';
    [item.rating != null ? '★ ' + item.rating : null, detail.year, detail.genre, fmtDuration(detail.duration)].filter(Boolean).forEach((txt) => {
      const s = document.createElement('span'); s.textContent = txt; meta.appendChild(s);
    });
    body.appendChild(meta);

    const plot = document.createElement('p'); plot.className = 'title-hero__plot';
    plot.textContent = detail.plot || t('title.synopsis_missing');
    body.appendChild(plot);

    const actions = document.createElement('div'); actions.className = 'title-hero__actions';
    if (kind !== 'series') {
      const playBtn = document.createElement('button'); playBtn.type = 'button'; playBtn.className = 'hero-play';
      playBtn.textContent = t('title.play');
      playBtn.addEventListener('click', () => TvproApp.openPlayer(item, library));
      actions.appendChild(playBtn);
    }
    const favBtn = document.createElement('button'); favBtn.type = 'button'; favBtn.className = 'title-fav';
    function paintFav() {
      const fav = TvproApp.isFavorite(item, library);
      favBtn.setAttribute('aria-pressed', String(fav));
      favBtn.innerHTML = (fav ? '&#9829; ' : '&#9825; ') + t(fav ? 'title.favorited' : 'title.favorite');
    }
    favBtn.addEventListener('click', async () => { await TvproApp.toggleFavorite(item, library); paintFav(); });
    paintFav();
    actions.appendChild(favBtn);
    body.appendChild(actions);
    if (library.source === 'demo') {
      const note = document.createElement('div'); note.className = 'title-demo-note'; note.textContent = t('title.demo_note');
      body.appendChild(note);
    }
    hero.appendChild(body);
    root.appendChild(hero);

    hero.querySelector('[data-action="back"]').addEventListener('click', () => { history.length > 1 ? history.back() : (location.href = 'index.html'); });

    if (kind === 'series' && seasons.length) {
      const seasonsWrap = document.createElement('div');
      seasons.forEach((season) => {
        const block = document.createElement('div'); block.className = 'season-block';
        const h3 = document.createElement('h3'); h3.textContent = t('title.season') + ' ' + season.number; block.appendChild(h3);
        season.episodes.forEach((ep) => {
          const row = document.createElement('button'); row.type = 'button'; row.className = 'episode-row';
          row.innerHTML =
            '<span class="episode-row__num">' + ep.number + '</span>' +
            '<span style="flex:1"><div class="episode-row__title">' + (ep.title || t('title.episode') + ' ' + ep.number) + '</div>' +
            (ep.duration ? '<div class="episode-row__meta">' + fmtDuration(ep.duration) + '</div>' : '') + '</span>';
          row.addEventListener('click', () => TvproApp.openPlayer({ ...item, name: item.name + ' — ' + t('title.episode') + ' ' + ep.number, xt: ep.xt }, library));
          block.appendChild(row);
        });
        seasonsWrap.appendChild(block);
      });
      root.appendChild(seasonsWrap);
    }
  });
})(window);
