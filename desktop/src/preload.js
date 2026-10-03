'use strict';
// Runs with contextIsolation:true and sandbox:true — this is the ONLY code that can reach ipcRenderer; the page
// itself (the regular tv-pro.app bundle) never gets nodeIntegration and never sees `require`. Everything exposed
// below is deliberately small and single-purpose.
const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED_SEND = new Set(['desktop:clear-all-data-ack']);
const ALLOWED_ON = new Set(['menu:open-diagnostics', 'desktop:clear-all-data']);
const ALLOWED_INVOKE = new Set([
  'credentials:get', 'credentials:set', 'credentials:delete', 'credentials:list', 'credentials:available',
  'app:getVersion', 'app:openExternal',
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
