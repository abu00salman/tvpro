/*
 * TV Pro v2 — listing page (movies/series/anime): capsule filters (genre/year/sort/platform)
 * driven by whatever fields actually exist on the loaded items. A real library's items don't
 * currently carry genre/year/platform (the Xtream API/M3U groups only give `group`), so those
 * filters quietly hide themselves when the field is absent instead of showing an empty/fake
 * control — the genre filter falls back to `group` when present.
 */
(function (global) {
  'use strict';

  function uniqueSorted(values) { return [...new Set(values.filter((v) => v !== undefined && v !== null && v !== ''))].sort(); }

  function initListing(type, titleKey) {
    document.addEventListener('DOMContentLoaded', async () => {
      const library = await TvproApp.getLibrary();
      TvproApp.renderDemoBanner(document.getElementById('main'), library.source);
      const all = (library[type] || []).slice();

      const genreField = all.some((i) => i.genre) ? 'genre' : 'group';
      const genres = uniqueSorted(all.map((i) => i[genreField]));
      const years = uniqueSorted(all.map((i) => i.year)).sort((a, b) => b - a);
      const platforms = uniqueSorted(all.map((i) => i.platform));

      const bar = document.getElementById('filterBar');
      function select(id, labelKey, options) {
        if (!options.length) return null;
        const wrap = document.createElement('select');
        wrap.className = 'filter-select'; wrap.id = id;
        const t = TvproI18n.t;
        wrap.innerHTML = '<option value="">' + t(labelKey) + ': ' + t('filter.all') + '</option>' + options.map((o) => '<option value="' + o + '">' + o + '</option>').join('');
        bar.appendChild(wrap);
        return wrap;
      }
      const genreSel = select('fGenre', 'filter.genre', genres);
      const yearSel = select('fYear', 'filter.year', years);
      const platformSel = select('fPlatform', 'filter.platform', platforms);
      const sortSel = document.createElement('select');
      sortSel.className = 'filter-select'; sortSel.id = 'fSort';
      sortSel.innerHTML = '<option value="newest">' + TvproI18n.t('filter.sort.newest') + '</option><option value="az">' + TvproI18n.t('filter.sort.az') + '</option>';
      bar.appendChild(sortSel);

      const gridEl = document.getElementById('grid');
      const emptyEl = document.getElementById('emptyState');

      function apply() {
        let items = all;
        if (genreSel && genreSel.value) items = items.filter((i) => i[genreField] === genreSel.value);
        if (yearSel && yearSel.value) items = items.filter((i) => String(i.year) === yearSel.value);
        if (platformSel && platformSel.value) items = items.filter((i) => i.platform === platformSel.value);
        items = items.slice().sort((a, b) => sortSel.value === 'az' ? a.name.localeCompare(b.name) : (b.addedAt || 0) - (a.addedAt || 0));
        if (!items.length) { gridEl.innerHTML = ''; emptyEl.style.display = ''; return; }
        emptyEl.style.display = 'none';
        TvproRows.grid(gridEl, items, (item) => TvproApp.openPlayer(item, library));
      }
      [genreSel, yearSel, platformSel, sortSel].forEach((el) => el && el.addEventListener('change', apply));
      apply();
    });
  }

  global.TvproListing = { initListing };
})(window);
