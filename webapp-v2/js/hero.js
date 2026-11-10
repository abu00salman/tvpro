/*
 * TV Pro v2 — real multi-item hero slider.
 * Draggable (pointer events, mouse+touch unified), progress dots, autoplay that pauses on
 * any user interaction (drag, dot click, arrow click, pointer hover, or the explicit pause
 * button) and never fabricates data: every slide comes from whatever items the caller passes
 * (real library rows when available, demo items otherwise — see app.js).
 */
(function (global) {
  'use strict';

  function buildSlide(item, onPlay, onInfo) {
    const slide = document.createElement('div');
    slide.className = 'hero-slide';
    slide.style.setProperty('--h', item.hue != null ? item.hue : 215);

    function appendFallback() {
      const fallback = document.createElement('div');
      fallback.className = 'hero-slide__media';
      fallback.setAttribute('data-fallback', '1');
      slide.appendChild(fallback);
    }
    const src = global.TvproRows ? global.TvproRows.posterUrl(item) : item.logo;
    if (src) {
      const img = document.createElement('img');
      img.className = 'hero-slide__media';
      img.src = src; img.alt = ''; img.setAttribute('aria-hidden', 'true'); img.draggable = false;
      // Same reasoning as rows.js's card(): a real backdrop is proxied and not guaranteed
      // reachable, so fall back to the gradient panel instead of a broken-image icon.
      img.addEventListener('error', () => { img.remove(); appendFallback(); }, { once: true });
      slide.appendChild(img);
    } else {
      appendFallback();
    }

    const body = document.createElement('div');
    body.className = 'hero-slide__body';
    const strings = global.TvproI18n;
    const eyebrow = document.createElement('span');
    eyebrow.className = 'hero-slide__eyebrow';
    eyebrow.textContent = strings ? strings.t('home.featured') : 'Featured';
    body.appendChild(eyebrow);

    const h1 = document.createElement('p');
    h1.className = 'hero-slide__title';
    h1.textContent = item.name;
    body.appendChild(h1);

    const meta = document.createElement('div');
    meta.className = 'hero-slide__meta';
    if (item.year) { const s = document.createElement('span'); s.textContent = item.year; meta.appendChild(s); }
    if (item.genre || item.group) { const s = document.createElement('span'); s.textContent = item.genre || item.group; meta.appendChild(s); }
    if (item.rating != null) { const s = document.createElement('span'); s.textContent = '★ ' + item.rating; meta.appendChild(s); }
    body.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'hero-slide__actions';
    const play = document.createElement('button');
    play.type = 'button'; play.className = 'hero-play';
    play.textContent = strings ? strings.t('home.play') : 'Play';
    play.addEventListener('click', (e) => { e.stopPropagation(); onPlay(item); });
    const info = document.createElement('button');
    info.type = 'button'; info.className = 'hero-ghost';
    info.textContent = strings ? strings.t('home.more_info') : 'More info';
    info.addEventListener('click', (e) => { e.stopPropagation(); onInfo(item); });
    actions.appendChild(play); actions.appendChild(info);
    body.appendChild(actions);

    slide.appendChild(body);
    return slide;
  }

  function createHeroSlider(container, items, onPlay, onInfo) {
    if (!items || !items.length) { container.style.display = 'none'; return null; }
    container.innerHTML = '';
    container.classList.add('hero-slider');

    const track = document.createElement('div');
    track.className = 'hero-track';
    items.forEach((item) => track.appendChild(buildSlide(item, onPlay, onInfo || onPlay)));
    container.appendChild(track);

    let index = 0, autoplayTimer = null, dragging = false, startX = 0, startTranslate = 0, currentTranslate = 0, width = container.clientWidth;

    const dots = document.createElement('div');
    dots.className = 'hero-dots';
    dots.setAttribute('role', 'tablist');
    const dotEls = items.map((_, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('aria-label', 'Slide ' + (i + 1));
      b.addEventListener('click', () => goTo(i, true));
      dots.appendChild(b);
      return b;
    });
    container.appendChild(dots);

    if (items.length > 1) {
      const prev = document.createElement('button'); prev.type = 'button'; prev.className = 'hero-nav prev'; prev.setAttribute('aria-label', 'Previous'); prev.innerHTML = '&#8592;';
      const next = document.createElement('button'); next.type = 'button'; next.className = 'hero-nav next'; next.setAttribute('aria-label', 'Next'); next.innerHTML = '&#8594;';
      prev.addEventListener('click', () => goTo(index - 1, true));
      next.addEventListener('click', () => goTo(index + 1, true));
      container.appendChild(prev); container.appendChild(next);
    }

    const pauseBtn = document.createElement('button');
    pauseBtn.type = 'button'; pauseBtn.className = 'hero-pause'; pauseBtn.setAttribute('aria-label', 'Pause autoplay');
    pauseBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
    pauseBtn.addEventListener('click', () => { autoplaying = !autoplaying; updatePauseIcon(); autoplaying ? scheduleAutoplay() : clearTimeout(autoplayTimer); });
    container.appendChild(pauseBtn);

    let autoplaying = true;
    function updatePauseIcon() {
      pauseBtn.innerHTML = autoplaying
        ? '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5v14l12-7z"/></svg>';
    }

    function setTranslate(px, animate) {
      track.style.transition = animate ? 'transform .35s ' + getComputedStyle(document.documentElement).getPropertyValue('--ease') : 'none';
      track.style.transform = 'translateX(' + px + 'px)';
    }

    function goTo(i, userInitiated) {
      index = Math.max(0, Math.min(items.length - 1, i));
      width = container.clientWidth;
      const dir = document.documentElement.dir === 'rtl' ? 1 : -1;
      setTranslate(dir * index * width, true);
      dotEls.forEach((d, di) => d.setAttribute('aria-current', String(di === index)));
      if (userInitiated) restartAutoplay();
    }

    function scheduleAutoplay() {
      clearTimeout(autoplayTimer);
      if (!autoplaying || items.length < 2) return;
      autoplayTimer = setTimeout(() => { goTo((index + 1) % items.length); }, 5500);
    }
    function restartAutoplay() { clearTimeout(autoplayTimer); scheduleAutoplay(); }

    // ---- drag/swipe (pointer events: mouse + touch unified) ----
    track.addEventListener('pointerdown', (e) => {
      dragging = true; track.classList.add('dragging');
      startX = e.clientX; width = container.clientWidth;
      const dir = document.documentElement.dir === 'rtl' ? 1 : -1;
      startTranslate = dir * index * width;
      currentTranslate = startTranslate;
      clearTimeout(autoplayTimer);
      track.setPointerCapture(e.pointerId);
    });
    track.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      currentTranslate = startTranslate + dx;
      setTranslate(currentTranslate, false);
    });
    function endDrag() {
      if (!dragging) return;
      dragging = false; track.classList.remove('dragging');
      const dir = document.documentElement.dir === 'rtl' ? 1 : -1;
      const delta = currentTranslate - startTranslate;
      const threshold = width * 0.18;
      if (delta * dir < -threshold) goTo(index + 1, true);
      else if (delta * dir > threshold) goTo(index - 1, true);
      else goTo(index, true);
    }
    track.addEventListener('pointerup', endDrag);
    track.addEventListener('pointercancel', endDrag);
    container.addEventListener('mouseenter', () => clearTimeout(autoplayTimer));
    container.addEventListener('mouseleave', () => scheduleAutoplay());
    window.addEventListener('resize', () => goTo(index, false));

    goTo(0, false);
    updatePauseIcon();
    scheduleAutoplay();

    return { goTo, destroy() { clearTimeout(autoplayTimer); } };
  }

  global.TvproHero = { createHeroSlider };
})(window);
