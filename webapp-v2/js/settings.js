/*
 * TV Pro v2 — Settings + add/import playlist.
 * See js/playlist-import.js for exactly what is and isn't reproduced faithfully here.
 */
(function (global) {
  'use strict';

  function statusBox(el, kind, text) {
    el.className = 'eyebrow' + (kind === 'error' ? ' settings-error' : '');
    el.textContent = text;
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const t = TvproI18n.t;
    const library = await TvproApp.getLibrary();

    const currentEl = document.getElementById('currentPlaylist');
    if (library.source === 'real' && library.playlistId) {
      currentEl.textContent = 'Active playlist: ' + (library.channels.length + library.movies.length + library.series.length) + ' items (' +
        library.channels.length + ' channels, ' + library.movies.length + ' movies, ' + library.series.length + ' series).';
    } else {
      currentEl.textContent = t('demo.badge');
    }

    const typeSel = document.getElementById('plType');
    const xtreamFields = document.getElementById('xtreamFields');
    const m3uFields = document.getElementById('m3uFields');
    function syncFields() {
      const isXtream = typeSel.value === 'xtream';
      xtreamFields.style.display = isXtream ? '' : 'none';
      m3uFields.style.display = isXtream ? 'none' : '';
    }
    typeSel.addEventListener('change', syncFields);
    syncFields();

    const form = document.getElementById('addPlaylistForm');
    const statusEl = document.getElementById('addStatus');
    const submitBtn = form.querySelector('[type="submit"]');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      submitBtn.disabled = true;
      statusBox(statusEl, 'info', t('title.loading'));
      try {
        const name = document.getElementById('plName').value.trim() || 'My playlist';
        let result;
        if (typeSel.value === 'xtream') {
          const secretPlain = {
            type: 'xtream',
            server: document.getElementById('xtServer').value.trim(),
            username: document.getElementById('xtUser').value.trim(),
            password: document.getElementById('xtPass').value,
          };
          if (!secretPlain.server || !secretPlain.username || !secretPlain.password) throw new Error('missing-fields');
          const lib = await TvproPlaylistImport.fetchXtreamLibrary(secretPlain);
          if (!lib.channels.length && !lib.movies.length && !lib.series.length) throw new Error('empty');
          result = await TvproStorage.createPlaylist({ type: 'xtream', name, secretPlain, ...lib });
        } else {
          const url = document.getElementById('m3uUrl').value.trim();
          if (!url) throw new Error('missing-fields');
          const res = await TvproGateway.fetchWithFallback(url, {}, 15000);
          const text = await res.text();
          if (!/#EXTM3U|#EXTINF/i.test(text.slice(0, 4096))) throw new Error('not-m3u');
          const lib = TvproPlaylistImport.parseM3U(text);
          if (!lib.channels.length) throw new Error('empty');
          result = await TvproStorage.createPlaylist({ type: 'm3u-url', name, secretPlain: { type: 'm3u-url', url }, ...lib });
        }
        statusBox(statusEl, 'ok', 'Added "' + result.playlist.name + '" (' + result.playlist.counts.channels + ' channels, ' +
          result.playlist.counts.movies + ' movies, ' + result.playlist.counts.series + ' series). Reloading…');
        setTimeout(() => { location.href = 'index.html'; }, 1200);
      } catch (err) {
        const msg = err && err.message === 'missing-fields' ? 'Please fill in every field.'
          : err && err.message === 'empty' ? 'No channels/movies/series were returned — check the login details.'
          : err && err.message === 'not-m3u' ? 'That URL did not return a valid M3U playlist.'
          : 'Could not reach the server through any gateway. This sandbox has no outbound network to real IPTV providers, so this path is untested end-to-end here — try it on a real device.';
        statusBox(statusEl, 'error', msg);
      } finally {
        submitBtn.disabled = false;
      }
    });
  });
})(window);
