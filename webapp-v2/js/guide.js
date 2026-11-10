/*
 * TV Pro v2 — TV guide (EPG), restyled with the app.css design language.
 * The Xtream now/next fetch logic itself (get_short_epg / get_simple_data_table, base64
 * title decoding, progress-bar math) is the SAME logic already shipped and working in
 * epg.html — reused here via js/xtream.js rather than re-derived, per the brief. Only the
 * markup/CSS and the at-most-3-in-flight lazy loader are new.
 */
(function (global) {
  'use strict';

  function decode(s) { return TvproXtream.b64(s); }
  const fmtTime = (ts) => new Date(ts * 1000).toLocaleTimeString(TvproI18n.currentLocale(), { hour: '2-digit', minute: '2-digit' });

  function progressHtml(item) {
    if (!item) return '<div class="eyebrow">' + TvproI18n.t('search.empty') + '</div>';
    const start = Number(item.start_timestamp), stop = Number(item.stop_timestamp);
    const now = Date.now() / 1000;
    const pct = stop > start ? Math.min(100, Math.max(0, ((now - start) / (stop - start)) * 100)) : 0;
    return '<div class="epg-now">' + (decode(item.title) || '—') + '</div>' +
      '<div class="epg-bar"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
      '<span class="epg-times">' + fmtTime(start) + ' – ' + fmtTime(stop) + '</span>';
  }

  function makeLimiter(max) {
    let active = 0; const queue = [];
    const next = () => { if (active >= max || !queue.length) return; active++; const job = queue.shift(); job().finally(() => { active--; next(); }); };
    return (job) => new Promise((resolve) => { queue.push(() => job().then(resolve, resolve)); next(); });
  }
  const limiter = makeLimiter(3);

  function renderChannel(ch, secret) {
    const row = document.createElement('div'); row.className = 'epg-row';
    row.innerHTML =
      '<div class="epg-row__head"><span class="epg-row__name">' + ch.name + '</span><span class="epg-row__num">#' + (ch.number || '') + '</span></div>' +
      '<div class="epg-nownext"><span class="eyebrow">' + TvproI18n.t('title.loading') + '</span></div>' +
      '<button type="button" class="epg-more-btn">' + TvproI18n.t('title.seasons') + '</button>' +
      '<div class="epg-day-list"></div>';
    const nowNext = row.querySelector('.epg-nownext');
    const dayList = row.querySelector('.epg-day-list');
    const moreBtn = row.querySelector('.epg-more-btn');
    moreBtn.textContent = 'Full day';
    let loaded = false;
    moreBtn.addEventListener('click', async () => {
      const open = dayList.classList.toggle('open');
      if (open && !loaded) {
        loaded = true;
        dayList.innerHTML = '<div class="eyebrow">' + TvproI18n.t('title.loading') + '</div>';
        try {
          const items = (await TvproXtream.getSimpleDataTable(secret, ch.xt.id)).slice(0, 40);
          const now = Date.now() / 1000;
          dayList.innerHTML = items.map((it) => {
            const start = Number(it.start_timestamp), stop = Number(it.stop_timestamp);
            const live = now >= start && now < stop;
            return '<div class="epg-day-item' + (live ? ' live' : '') + '"><span class="t">' + fmtTime(start) + '</span><span>' + (decode(it.title) || '-') + '</span></div>';
          }).join('') || '<div class="eyebrow">' + TvproI18n.t('search.empty') + '</div>';
        } catch (_e) { dayList.innerHTML = '<div class="eyebrow">' + TvproI18n.t('title.not_found') + '</div>'; }
      }
    });

    row._load = () => limiter(async () => {
      try {
        const items = await TvproXtream.getShortEpg(secret, ch.xt.id, 2);
        const [now, next] = items;
        nowNext.innerHTML = progressHtml(now) + (next ? '<div class="epg-next">Next: ' + (decode(next.title) || '-') + ' <span class="epg-times">' + fmtTime(Number(next.start_timestamp)) + '</span></div>' : '');
      } catch (_e) { nowNext.innerHTML = '<div class="eyebrow">' + TvproI18n.t('title.not_found') + '</div>'; }
    });
    return row;
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const statusEl = document.getElementById('guideStatus');
    const listEl = document.getElementById('guideList');
    const searchEl = document.getElementById('guideSearch');

    const library = await TvproApp.getLibrary();
    if (library.source === 'demo') {
      statusEl.textContent = TvproI18n.t('demo.badge');
      return;
    }
    if (!library.secret || library.secret.type !== 'xtream') {
      statusEl.textContent = 'EPG currently works only with Xtream Codes sources (an M3U source does not carry enough data to match channels).';
      return;
    }
    const channels = (library.channels || []).filter((c) => c.xt).sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0));
    if (!channels.length) { statusEl.textContent = TvproI18n.t('search.empty'); return; }
    statusEl.textContent = channels.length + ' channels';

    let observer;
    function observe(row) {
      if (!observer) {
        observer = new IntersectionObserver((entries) => {
          entries.forEach((e) => { if (e.isIntersecting) { observer.unobserve(e.target); e.target._load(); } });
        }, { rootMargin: '200px' });
      }
      observer.observe(row);
    }

    function render(list) {
      listEl.innerHTML = '';
      list.forEach((ch) => { const row = renderChannel(ch, library.secret); listEl.appendChild(row); observe(row); });
    }
    render(channels);

    let t;
    searchEl.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const q = searchEl.value.trim().toLowerCase();
        render(!q ? channels : channels.filter((c) => String(c.number).includes(q) || (c.name || '').toLowerCase().includes(q)));
      }, 150);
    });
  });
})(window);
