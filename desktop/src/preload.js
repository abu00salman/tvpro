'use strict';
// Runs with contextIsolation:true and sandbox:true — this is the ONLY code that can reach ipcRenderer; the page
// itself (the regular tv-pro.app bundle) never gets nodeIntegration and never sees `require`. Everything exposed
// below is deliberately small and single-purpose.
const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED_SEND = new Set(['desktop:clear-all-data-ack']);
const ALLOWED_ON = new Set(['menu:open-diagnostics', 'desktop:clear-all-data']);
const ALLOWED_INVOKE = new Set([
  'credentials:get', 'credentials:set', 'credentials:delete', 'credentials:list', 'credentials:available',
  'app:getVersion', 'app:openExternal', 'app:openInExternalPlayer',
]);

function invoke(channel, ...args) {
  if (!ALLOWED_INVOKE.has(channel)) return Promise.reject(new Error('blocked channel: ' + channel));
  return ipcRenderer.invoke(channel, ...args);
}

// main.js passes the local gateway's base URL via a `--tvpro-local-gateway=...` extra argument (BrowserWindow's
// webPreferences.additionalArguments), since contextIsolation means preload cannot just read a variable the main
// process set on `window` directly. Exposed to the PAGE itself (not nested under tvproDesktop) because the
// bundled web app's own gateway-selection code looks for a plain `window.__tvproLocalGateway` global — the same
// pattern every other desktop/runtime hook in this codebase already uses (see ext.js, gulf.js on the website).
const localGwArg = process.argv.find((a) => a.startsWith('--tvpro-local-gateway='));
const localGatewayUrl = localGwArg ? localGwArg.slice('--tvpro-local-gateway='.length) : null;
contextBridge.exposeInMainWorld('__tvproLocalGateway', localGatewayUrl);

// ---------------------------------------------------------------------------------------------------------------
// Fix the website's "Open in VLC / Infuse" buttons for desktop. The bundled player (ext.js) builds those buttons
// with `vlc-x-callback://` and `infuse://` — iOS-only URL schemes that macOS VLC/Infuse never register, so on
// desktop those buttons silently do nothing. This intercepts a click on either button (capturing phase, before
// the page's own onclick runs) and routes it to the real native "open -a VLC <url>" launch instead (see
// src/externalPlayer.js). It never touches the website's own bundle; this is desktop-only behavior layered on top.
//
// Why inject a <script> instead of handling it entirely here: this file runs in the isolated world, but the
// stream URL (`window.__tvproSrc`) is a plain global the page's own bundle sets in the MAIN world — contextIsolation
// means this file's `window` is a different object from the page's. An inline <script> tag's contents always run
// in the main world regardless of who inserted the element, so it alone can read that global; it then hands the
// URL back across the isolation boundary via a CustomEvent, since DOM events (unlike JS globals) are visible on
// both sides of the isolation boundary.
const EXTERNAL_PLAYER_BRIDGE_EVENT = 'tvpro-desktop-open-external-player';
const MAIN_WORLD_INTERCEPTOR = `(function(){
  if (window.__tvproDesktopExternalPlayerHook) return; window.__tvproDesktopExternalPlayerHook = 1;
  function extSrc() {
    var s = window.__tvproSrc;
    if (s && window.__tvproLive) {
      var m = /^(https?:\\/\\/[^/]+\\/(?:live\\/)?[^/]+\\/[^/]+\\/\\d+)\\.m3u8(\\?.*)?$/i.exec(s);
      if (m) return m[1] + '.ts' + (m[2] || '');
    }
    return s;
  }
  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('button') : null;
    if (!btn || !btn.closest('[data-tvpro-ext]')) return;
    var text = (btn.textContent || '').trim();
    var app = /VLC/.test(text) ? 'vlc' : /Infuse/.test(text) ? 'infuse' : null;
    if (!app) return;
    var url = extSrc();
    if (!url) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    document.dispatchEvent(new CustomEvent(${JSON.stringify(EXTERNAL_PLAYER_BRIDGE_EVENT)}, { detail: { app: app, url: url } }));
  }, true);
})();`;

function injectExternalPlayerInterceptor() {
  try {
    const script = document.createElement('script');
    script.textContent = MAIN_WORLD_INTERCEPTOR;
    (document.documentElement || document.head || document.body).appendChild(script);
    script.remove();
  } catch { /* best effort; worst case the old (broken) iOS-scheme buttons remain as before */ }
}
if (document.documentElement) injectExternalPlayerInterceptor();
else document.addEventListener('DOMContentLoaded', injectExternalPlayerInterceptor, { once: true });

document.addEventListener(EXTERNAL_PLAYER_BRIDGE_EVENT, (e) => {
  const { app, url } = (e && e.detail) || {};
  invoke('app:openInExternalPlayer', app, url).catch(() => {});
});

contextBridge.exposeInMainWorld('tvproDesktop', {
  isDesktop: true,
  platform: process.platform,

  credentials: {
    available: () => invoke('credentials:available'),
    get: (key) => invoke('credentials:get', key),
    set: (key, value) => invoke('credentials:set', key, value),
    delete: (key) => invoke('credentials:delete', key),
    list: () => invoke('credentials:list'),
  },

  app: {
    getVersion: () => invoke('app:getVersion'),
  },

  openExternal: (url) => invoke('app:openExternal', url),
  openInExternalPlayer: (appKey, url) => invoke('app:openInExternalPlayer', appKey, url),

  /** The local loopback gateway's base URL (e.g. "http://127.0.0.1:53211"), or null if it failed to start. */
  localGatewayUrl,

  onOpenDiagnostics: (cb) => {
    if (typeof cb !== 'function') return;
    ipcRenderer.on('menu:open-diagnostics', () => cb());
  },

  /** Fired when the user picks "Clear local data" from the native menu. The page should clear its own storage
   *  (IndexedDB/localStorage/caches) and then this module also clears the OS-secure credential store. */
  onClearAllData: (cb) => {
    if (typeof cb !== 'function') return;
    ipcRenderer.on('desktop:clear-all-data', async () => {
      try { await cb(); } finally { ipcRenderer.send('desktop:clear-all-data-ack'); }
    });
  },
});
