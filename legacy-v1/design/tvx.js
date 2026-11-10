/*
 * TV Pro design layer — Home hero (source: design/tvx.js, loaded as a plain <script> next
 * to the compiled app, same pattern as design/tvx.css -> compiled CSS).
 *
 * Why this exists: the app ships only as a built Next.js bundle (no committed buildable
 * frontend source), so structural additions like a cinematic hero on Home cannot be made
 * by editing component source. This script is a small, additive, progressive-enhancement
 * layer: it NEVER edits the compiled JS bundle, NEVER moves or removes a React-owned DOM
 * node (that would break React's reconciliation on the next render), and NEVER invents
 * data. It only reads text/attributes TV Pro's own React app already rendered (a title,
 * a poster image, a hue token) and paints one new, purely decorative sibling element with
 * a "play" control that proxies a real click to the real, still-mounted button — so the
 * hero always opens whatever the underlying card actually opens, for real user content.
 *
 * If a real buildable frontend source becomes available, this file should be retired in
 * favor of an actual <Hero> component with proper data loading, a real slider and a
 * favorite action, as called for in the design brief.
 */
(function () {
  'use strict';

  var AR = { featured: 'مميز', play: 'تشغيل', open: 'عرض' };
  var EN = { featured: 'Featured', play: 'Play', open: 'View' };
  function t() { return (document.documentElement.lang || '').toLowerCase().indexOf('ar') === 0 ? AR : EN; }

  function isHomeRoute() {
    var h = location.hash.replace(/^#/, '');
    return h === '' || h === '/' || h === '/home';
  }

  function findHomeSections() {
    var main = document.getElementById('main');
    if (!main) return null;
    var h1 = main.querySelector('header h1');
    if (!h1) return null;
    // Home's own header has no breadcrumb/filter row — distinguish it from
    // Movies/Series/Live, whose <header> carries a counter paragraph in a
    // different layout (items-end/justify-between). Home's is "pb-8 pt-2".
    var header = h1.closest('header');
    if (!header || !/pb-8/.test(header.className)) return null;
    var container = header.parentElement;
    if (!container) return null;
    return { container: container, header: header };
  }

  function pickSourceButton(container) {
    var order = ['Continue watching', 'Recently added', 'Live now', 'Top rated'];
    for (var i = 0; i < order.length; i++) {
      var section = container.querySelector('section[aria-label="' + order[i] + '"]');
      var btn = section && section.querySelector('button.group');
      if (btn) return { btn: btn, section: section };
    }
    var any = container.querySelector('section[aria-label] button.group');
    var sec = any ? any.closest('section[aria-label]') : null;
    return any ? { btn: any, section: sec } : null;
  }

  function buildHero(picked) {
    var btn = picked.btn, section = picked.section;
    var titleEl = btn.querySelector('span[dir]');
    var title = titleEl ? titleEl.textContent.trim() : '';
    if (!title) return null;
    var metaEl = titleEl ? titleEl.nextElementSibling : null;
    var meta = metaEl && /text-xs/.test(metaEl.className) ? metaEl.textContent.trim() : '';
    var poster = btn.querySelector('.tvx-poster, .aspect-video, [class*="aspect-"]');
    var img = poster ? poster.querySelector('img') : null;
    var hue = poster ? (poster.getAttribute('data-tvx-h') || poster.style.getPropertyValue('--tvx-h')) : '';

    var strings = t();
    var isLive = section && section.getAttribute('aria-label') === 'Live now';

    var hero = document.createElement('div');
    hero.className = 'tvx-hero';
    hero.setAttribute('data-tvx-hero', '1');

    if (img && img.src) {
      var media = document.createElement('img');
      media.className = 'tvx-hero__media';
      media.src = img.src;
      media.alt = '';
      media.setAttribute('aria-hidden', 'true');
      hero.appendChild(media);
    } else {
      var fallback = document.createElement('div');
      fallback.className = 'tvx-hero__media';
      fallback.setAttribute('data-fallback', '1');
      if (hue) fallback.style.setProperty('--tvx-h', hue);
      hero.appendChild(fallback);
    }

    var body = document.createElement('div');
    body.className = 'tvx-hero__body';

    var eyebrow = document.createElement('span');
    eyebrow.className = 'tvx-hero__eyebrow';
    eyebrow.textContent = strings.featured;
    body.appendChild(eyebrow);

    var h = document.createElement('p');
    h.className = 'tvx-hero__title';
    h.dir = titleEl.getAttribute('dir') || 'auto';
    h.textContent = title;
    body.appendChild(h);

    if (meta) {
      var metaRow = document.createElement('div');
      metaRow.className = 'tvx-hero__meta';
      var chip = document.createElement('span');
      chip.textContent = meta;
      metaRow.appendChild(chip);
      body.appendChild(metaRow);
    }

    var actions = document.createElement('div');
    actions.className = 'tvx-hero__actions';
    var play = document.createElement('button');
    play.type = 'button';
    play.className = 'tvx-hero__play';
    play.textContent = (isLive ? strings.play : strings.open);
    play.addEventListener('click', function () {
      // Proxy a real click to the real, still-mounted React button: the hero
      // never carries its own navigation/playback logic.
      btn.click();
    });
    actions.appendChild(play);
    body.appendChild(actions);

    hero.appendChild(body);
    return hero;
  }

  function removeExisting(container) {
    var existing = container.querySelectorAll('[data-tvx-hero]');
    for (var i = 0; i < existing.length; i++) existing[i].remove();
  }

  function run() {
    if (!isHomeRoute()) return;
    var found = findHomeSections();
    if (!found) return;
    removeExisting(found.container);
    var picked = pickSourceButton(found.container);
    if (!picked) return; // no real content yet (e.g. empty library) — show nothing, never fake data
    var hero = buildHero(picked);
    if (!hero) return;
    found.header.insertAdjacentElement('afterend', hero);
  }

  var scheduled = null;
  function schedule() {
    if (scheduled) return;
    scheduled = setTimeout(function () { scheduled = null; run(); }, 180);
  }

  window.addEventListener('hashchange', schedule);
  document.addEventListener('DOMContentLoaded', schedule);
  schedule();

  var root = document.getElementById('__next') || document.body;
  if (root && 'MutationObserver' in window) {
    new MutationObserver(schedule).observe(root, { childList: true, subtree: true });
  }
})();
