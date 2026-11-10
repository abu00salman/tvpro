/*
 * TV Pro v2 — shared poster/channel card + horizontal row renderer.
 * Used by Home, listing pages and search results so every card looks and behaves the same.
 */
(function (global) {
  'use strict';

  function card(item, onOpen, opts) {
    opts = opts || {};
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'card' + (opts.wide ? ' card--wide' : '');
    btn.addEventListener('click', () => onOpen(item));

    const poster = document.createElement('span');
    poster.className = 'card__poster';
    poster.style.setProperty('--h', item.hue != null ? item.hue : 215);
    if (item.poster) {
      const img = document.createElement('img');
      img.src = item.poster; img.alt = ''; img.loading = 'lazy';
      poster.appendChild(img);
    } else {
      poster.setAttribute('data-fallback', '1');
      const span = document.createElement('span');
      span.textContent = item.name;
      poster.appendChild(span);
    }
    if (item.live) { const badge = document.createElement('span'); badge.className = 'card__live-badge'; badge.textContent = 'LIVE'; poster.appendChild(badge); }
    btn.appendChild(poster);

    const title = document.createElement('div');
    title.className = 'card__title';
    title.textContent = item.name;
    btn.appendChild(title);

    const metaParts = [];
    if (item.year) metaParts.push(item.year);
    if (item.genre || item.group) metaParts.push(item.genre || item.group);
    if (item.rating != null) metaParts.push('★ ' + item.rating);
    if (metaParts.length) {
      const meta = document.createElement('div');
      meta.className = 'card__meta';
      meta.textContent = metaParts.join(' · ');
      btn.appendChild(meta);
    }
    return btn;
  }

  function row(container, titleKey, items, onOpen, opts) {
    if (!items || !items.length) return;
    const section = document.createElement('section');
    const head = document.createElement('div');
    head.className = 'row-head';
    const h2 = document.createElement('h2');
    h2.setAttribute('data-i18n', titleKey);
    h2.textContent = global.TvproI18n ? global.TvproI18n.t(titleKey) : titleKey;
    head.appendChild(h2);
    section.appendChild(head);

    const scroll = document.createElement('div');
    scroll.className = 'row-scroll';
    items.forEach((item) => scroll.appendChild(card(item, onOpen, opts)));
    section.appendChild(scroll);
    container.appendChild(section);
  }

  function grid(container, items, onOpen) {
    container.innerHTML = '';
    container.className = 'grid-posters';
    items.forEach((item) => container.appendChild(card(item, onOpen)));
  }

  global.TvproRows = { card, row, grid };
})(window);
