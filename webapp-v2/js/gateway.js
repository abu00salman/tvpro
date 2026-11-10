/*
 * TV Pro v2 — gateway fallback chain.
 *
 * Same fallback list and /proxy?url= convention as the shipped app and the existing
 * diag.html / epg.html pages (read from the compiled bundle: _next/static/chunks/app/page-*.js,
 * the string embedded next to the "tvpro:settings" localStorage key). A user's own custom
 * gateway (settings.proxyUrl) is tried first when present, exactly like diag.html does.
 */
(function (global) {
  'use strict';

  const GATEWAYS = [
    'https://great-fox-5853.abu00salmanr.deno.net',
    'https://tvpro-gateway.rmz.deno.net',
    'https://gateway.tv-pro.app',
    'https://tvpro-gateway.abu00salman-r.workers.dev',
  ];

  function via(gateway, url) {
    const u = new URL(gateway.replace(/\/?$/, '/proxy'));
    u.searchParams.set('url', url);
    return u.toString();
  }

  function routes(url) {
    let custom = null;
    try { custom = (global.TvproStorage && global.TvproStorage.readSettings().proxyUrl) || null; } catch (_e) {}
    const list = [custom, ...GATEWAYS].filter((g, i, a) => g && a.indexOf(g) === i);
    return list.map((g) => via(g, url));
  }

  async function fetchWithFallback(url, opts, timeoutMs) {
    let lastErr;
    for (const routeUrl of routes(url)) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs || 10000);
      try {
        const res = await fetch(routeUrl, { ...opts, signal: ctl.signal, cache: 'no-store' });
        clearTimeout(timer);
        if (res.ok) return res;
        lastErr = new Error('HTTP ' + res.status);
      } catch (e) {
        clearTimeout(timer);
        lastErr = e;
      }
    }
    throw lastErr || new Error('all-gateways-failed');
  }

  global.TvproGateway = { GATEWAYS, via, routes, fetchWithFallback };
})(window);
