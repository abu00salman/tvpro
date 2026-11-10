/*
 * TV Pro v2 — shell bootstrap: theme, active nav, library loading (real storage with a demo
 * fallback), and the shared player chrome + settings panel used from every page.
 */
(function (global) {
  'use strict';

  const THEME_KEY = 'tvpro-v2:theme';

  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (_e) {}
    if (saved === 'light' || saved === 'dark') document.documentElement.setAttribute('data-theme', saved);
    const btn = document.getElementById('themeToggle');
    if (btn) btn.addEventListener('click', toggleTheme);
  }
  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme')
      || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(THEME_KEY, next); } catch (_e) {}
  }

  function initLangToggle() {
    const btn = document.getElementById('langToggle');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const next = (global.TvproI18n.currentLocale() === 'ar') ? 'en' : 'ar';
      global.TvproI18n.setLocale(next);
    });
  }

  function markActiveNav() {
    const file = (location.pathname.split('/').pop() || 'index.html');
    document.querySelectorAll('[data-nav-link]').forEach((el) => {
      const target = el.getAttribute('data-nav-link');
      if (target === file) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
    });
  }

  /** Real library when a playlist is saved on this device, otherwise the bundled demo set
   *  (clearly tagged source:'demo' so callers can show the demo banner honestly). */
  async function getLibrary() {
    try {
      const result = await global.TvproStorage.loadActiveLibrary();
      if (result.ok) {
        return {
          source: 'real',
          playlistId: result.playlist && result.playlist.id,
          secret: result.secret,
          channels: result.channels,
          movies: result.movies,
          series: result.series,
          anime: [], // the real schema has no separate anime bucket yet; items live inside movies/series groups
          favorites: result.favorites,
          history: result.history,
        };
      }
    } catch (_e) { /* fall through to demo */ }
    const d = global.TvproDemo;
    return { source: 'demo', playlistId: null, secret: null, channels: d.channels, movies: d.movies, series: d.series, anime: d.anime, favorites: {}, history: {} };
  }

  function renderDemoBanner(root, source) {
    if (source !== 'demo') return;
    const banner = document.createElement('div');
    banner.className = 'demo-banner';
    banner.innerHTML = '<span>&#9432;</span><span data-i18n="demo.badge">' + global.TvproI18n.t('demo.badge') + '</span>';
    root.prepend(banner);
  }

  /** Finds an item by (kind, id) across every bucket of a loaded library — used by title.html
   *  and by the favorites/continue-watching rows to turn a stored key back into a real item. */
  function resolveItem(library, kind, id) {
    const pool = kind === 'channel' ? library.channels : kind === 'series' || kind === 'anime' ? [...library.series, ...(library.anime || [])] : library.movies;
    return (pool || []).find((it) => it.id === id) || null;
  }

  /** Card-click routing used everywhere: a channel opens the player directly (linear TV has
   *  no separate detail page, same as the shipped app); anything else goes to the detail page
   *  first, same as tapping a poster in the reference design opens a detail view before playback. */
  function openItem(item, library) {
    if (item.kind === 'channel') { openPlayer(item, library); return; }
    location.href = 'title.html?kind=' + encodeURIComponent(item.kind) + '&id=' + encodeURIComponent(item.id);
  }

  /** Toggles a favorite in memory AND persists it, in the exact real shape, when a real
   *  playlist is active. For demo data (no real playlist to write to) the toggle stays
   *  in-memory only for that page view — it is never written anywhere, and the caller should
   *  disclose that (see title.js). */
  async function toggleFavorite(item, library) {
    const kind = item.kind;
    if (library.source === 'real' && library.playlistId) {
      library.favorites = await global.TvproStorage.toggleFavorite(library.playlistId, kind, item.id, library.favorites);
    } else {
      const key = kind[0] + ':' + item.id;
      const next = { ...library.favorites };
      if (next[key]) delete next[key]; else next[key] = { key, kind, addedAt: Date.now() };
      library.favorites = next;
    }
    return library.favorites;
  }
  function isFavorite(item, library) { return !!(library.favorites && library.favorites[item.kind[0] + ':' + item.id]); }

  // ---- Player chrome + settings panel ----
  let playerEls = null;
  function ensurePlayerShell() {
    if (playerEls) return playerEls;
    const shell = document.createElement('div');
    shell.className = 'player-shell';
    shell.innerHTML =
      '<div class="player-topbar">' +
      '  <button type="button" data-action="close" aria-label="Close">&#10005;</button>' +
      '  <h3 data-el="title"></h3>' +
      '  <button type="button" data-action="settings" aria-label="Settings">&#9881;</button>' +
      '</div>' +
      '<video playsinline></video>' +
      '<div class="settings-panel" data-el="panel"></div>';
    document.body.appendChild(shell);
    const video = shell.querySelector('video');
    const panel = shell.querySelector('[data-el="panel"]');
    const titleEl = shell.querySelector('[data-el="title"]');
    shell.querySelector('[data-action="close"]').addEventListener('click', () => closePlayer());
    shell.querySelector('[data-action="settings"]').addEventListener('click', () => panel.classList.toggle('open'));
    playerEls = { shell, video, panel, titleEl };
    return playerEls;
  }

  function buildSettingsPanel(panel, item, ctx) {
    const t = global.TvproI18n.t;
    panel.innerHTML = '';
    function section(labelKey, rowsHtml) {
      const h = document.createElement('h4'); h.textContent = t(labelKey); panel.appendChild(h);
      const d = document.createElement('div'); d.innerHTML = rowsHtml; panel.appendChild(d);
    }
    // Quality: only populated once hls.js reports real manifest levels (ctx.levels). Never fabricated.
    if (ctx && ctx.levels && ctx.levels.length) {
      const opts = ['<option value="-1">' + t('player.auto') + '</option>']
        .concat(ctx.levels.map((lv, i) => '<option value="' + i + '">' + (lv.height ? lv.height + 'p' : lv.bitrate + 'bps') + '</option>'));
      section('player.quality', '<div class="settings-option"><span>' + t('player.quality') + '</span><select data-el="quality">' + opts.join('') + '</select></div>');
      panel.querySelector('[data-el="quality"]').addEventListener('change', (e) => { if (ctx.hls) ctx.hls.currentLevel = Number(e.target.value); });
    } else {
      section('player.quality', '<div class="settings-empty">' + t('player.auto') + '</div>');
    }
    // Subtitles / audio tracks: only shown when the source actually exposes them.
    if (ctx && ctx.subtitleTracks && ctx.subtitleTracks.length) {
      const opts = ['<option value="-1">' + t('player.off') + '</option>'].concat(ctx.subtitleTracks.map((tr, i) => '<option value="' + i + '">' + (tr.name || tr.lang || i) + '</option>'));
      section('player.subtitle', '<div class="settings-option"><span>' + t('player.subtitle') + '</span><select data-el="subs">' + opts.join('') + '</select></div>');
      panel.querySelector('[data-el="subs"]').addEventListener('change', (e) => { if (ctx.hls) ctx.hls.subtitleTrack = Number(e.target.value); });
    }
    if (ctx && ctx.audioTracks && ctx.audioTracks.length > 1) {
      const opts = ctx.audioTracks.map((tr, i) => '<option value="' + i + '">' + (tr.name || tr.lang || i) + '</option>');
      section('player.audio', '<div class="settings-option"><span>' + t('player.audio') + '</span><select data-el="audio">' + opts.join('') + '</select></div>');
      panel.querySelector('[data-el="audio"]').addEventListener('change', (e) => { if (ctx.hls) ctx.hls.audioTrack = Number(e.target.value); });
    }
    // Sleep timer: a local UI feature, always real regardless of source.
    section('player.sleep', '<div class="settings-option"><span>' + t('player.sleep') + '</span><select data-el="sleep">' +
      '<option value="0">' + t('player.off') + '</option><option value="15">15m</option><option value="30">30m</option><option value="60">60m</option></select></div>');
    panel.querySelector('[data-el="sleep"]').addEventListener('change', (e) => {
      clearTimeout(global.__tvproSleepTimer);
      const mins = Number(e.target.value);
      if (mins > 0) global.__tvproSleepTimer = setTimeout(() => closePlayer(), mins * 60000);
    });
  }

  function buildStreamUrl(item, secret) {
    // M3U-sourced items carry their own direct URL (same convention as diag.html's
    // channelUrl()) — no credentials to assemble, the URL is already playable as-is.
    if (item.url) return item.url;
    if (!secret || secret.type !== 'xtream' || !item.xt) return null;
    const origin = (() => { try { const t = secret.server.trim(); return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : 'http://' + t).origin; } catch (_e) { return secret.server; } })();
    return origin + '/' + item.xt.kind + '/' + encodeURIComponent(secret.username) + '/' + encodeURIComponent(secret.password) + '/' + item.xt.id + '.' + item.xt.ext;
  }

  async function openPlayer(item, library) {
    const els = ensurePlayerShell();
    els.shell.classList.add('open');
    els.titleEl.textContent = item.name;
    const ctx = {};
    buildSettingsPanel(els.panel, item, ctx);
    els.panel.classList.remove('open');

    const raw = buildStreamUrl(item, library && library.secret);
    if (!raw) {
      // Demo item or no decodable source: show chrome without pretending to stream real media.
      els.video.removeAttribute('src');
      return;
    }
    const proxied = global.TvproGateway.via(global.TvproGateway.GATEWAYS[0], raw);
    if (global.Hls && global.Hls.isSupported() && /\.m3u8?$/i.test(raw)) {
      const hls = new global.Hls();
      ctx.hls = hls;
      hls.on(global.Hls.Events.MANIFEST_PARSED, (_e, data) => {
        ctx.levels = hls.levels; ctx.audioTracks = hls.audioTracks; ctx.subtitleTracks = hls.subtitleTracks;
        buildSettingsPanel(els.panel, item, ctx);
      });
      hls.loadSource(proxied);
      hls.attachMedia(els.video);
    } else {
      els.video.src = proxied;
    }
    els.video.play().catch(() => {});

    // Continue-watching: only recorded for a REAL playlist, in the exact shape the shipped
    // app itself writes (see storage.js recordHistory / TvproStorage.recordHistory), sampled
    // every 20s of playback rather than on every timeupdate tick.
    if (library && library.source === 'real' && library.playlistId && item.kind !== 'channel') {
      let last = 0;
      const onTick = () => {
        const pos = els.video.currentTime, dur = els.video.duration;
        if (!dur || pos - last < 20) return;
        last = pos;
        const key = global.TvproStorage.favoriteKey(item.kind, item.id);
        global.TvproStorage.recordHistory(library.playlistId, { key, kind: item.kind, itemId: item.id, title: item.name, logo: item.poster || item.logo, position: pos, duration: dur }, library.history)
          .then((next) => { library.history = next; });
      };
      els.video.addEventListener('timeupdate', onTick);
      els.video.addEventListener('pause', onTick);
    }
  }

  function closePlayer() {
    if (!playerEls) return;
    playerEls.shell.classList.remove('open');
    playerEls.panel.classList.remove('open');
    try { playerEls.video.pause(); playerEls.video.removeAttribute('src'); playerEls.video.load(); } catch (_e) {}
    clearTimeout(global.__tvproSleepTimer);
  }

  document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initLangToggle();
    markActiveNav();
  });

  global.TvproApp = { getLibrary, renderDemoBanner, resolveItem, openItem, openPlayer, closePlayer, toggleFavorite, isFavorite };
})(window);
