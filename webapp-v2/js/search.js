/*
 * TV Pro v2 — global search with content-type tabs, debounce and request cancellation.
 * The real library is searched synchronously in memory (it's already fully loaded on-device,
 * same as the shipped app's own search index — see the `class r{search(...)}` helper in the
 * compiled bundle), so "cancellation" here guards against a stale debounce timer finishing
 * after a newer keystroke, which is the real race in an in-memory search, not a network one.
 */
(function (global) {
  'use strict';

  const TABS = [
    { key: 'all', labelKey: 'search.tab.all' },
    { key: 'movie', labelKey: 'search.tab.movie' },
    { key: 'series', labelKey: 'search.tab.series' },
    { key: 'anime', labelKey: 'search.tab.anime' },
    { key: 'live', labelKey: 'search.tab.live' },
  ];

  function norm(s) { return (s || '').toLowerCase().trim(); }

  function searchLibrary(library, query) {
    const q = norm(query);
    const match = (name) => !q || norm(name).includes(q);
    return {
      movie: library.movies.filter((i) => match(i.name)),
      series: library.series.filter((i) => match(i.name)),
      anime: (library.anime || []).filter((i) => match(i.name)),
      live: library.channels.filter((i) => match(i.name)),
    };
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const library = await TvproApp.getLibrary();
    TvproApp.renderDemoBanner(document.getElementById('main'), library.source);

    const tabsEl = document.getElementById('searchTabs');
    const input = document.getElementById('searchInput');
    const resultsEl = document.getElementById('searchResults');
    let activeTab = 'all';
    let generation = 0;

    TABS.forEach((tab) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = TvproI18n.t(tab.labelKey); b.setAttribute('aria-selected', String(tab.key === activeTab));
      b.addEventListener('click', () => { activeTab = tab.key; [...tabsEl.children].forEach((c) => c.removeAttribute('aria-selected')); b.setAttribute('aria-selected', 'true'); run(); });
      tabsEl.appendChild(b);
    });

    function stateHtml(key) { return '<div class="search-state" data-i18n="' + key + '">' + TvproI18n.t(key) + '</div>'; }

    function run() {
      const q = input.value;
      const myGen = ++generation;
      if (!q.trim()) { resultsEl.className = ''; resultsEl.innerHTML = stateHtml('search.prompt'); return; }
      resultsEl.innerHTML = stateHtml('search.loading');
      // Simulated async boundary (debounce already delayed this call) so a slower future
      // real-network search can drop straight into this same generation-guarded path.
      Promise.resolve().then(() => {
        if (myGen !== generation) return; // a newer keystroke superseded this run — drop it
        try {
          const buckets = searchLibrary(library, q);
          const items = activeTab === 'all' ? [...buckets.movie, ...buckets.series, ...buckets.anime, ...buckets.live] : buckets[activeTab];
          if (!items.length) { resultsEl.innerHTML = stateHtml('search.empty'); return; }
          resultsEl.innerHTML = '';
          resultsEl.className = 'grid-posters';
          TvproRows.grid(resultsEl, items, (item) => TvproApp.openItem(item, library));
        } catch (_e) {
          resultsEl.innerHTML = stateHtml('search.error');
        }
      });
    }

    let debounceTimer;
    input.addEventListener('input', () => { clearTimeout(debounceTimer); debounceTimer = setTimeout(run, 220); });

    const params = new URLSearchParams(location.search);
    if (params.get('q')) { input.value = params.get('q'); run(); } else { resultsEl.innerHTML = stateHtml('search.prompt'); }
  });
})(window);
