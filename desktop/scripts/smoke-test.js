'use strict';
// Deterministic, non-interactive smoke test for the Electron shell itself (window creation, the app:// protocol,
// preload bridge, IPC, local gateway). Run under Xvfb on this Linux sandbox: `npm run smoke`.
// This proves the shell loads and wires correctly; it does NOT prove anything macOS-specific (Dock, native
// .app bundle behavior, codesigning) -- that needs a real Mac. See README-ar.md.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const assert = require('node:assert/strict');

process.on('uncaughtException', (e) => { console.error('UNCAUGHT in main:', e); process.exitCode = 1; app.quit(); });

const { registerAppScheme, registerAppProtocolHandler, appUrl } = require('../src/appProtocol');
const { createLocalGateway } = require('../src/localProxy');
const { registerIpcHandlers } = require('../src/ipcHandlers');

registerAppScheme();
registerIpcHandlers();

app.whenReady().then(async () => {
  let failed = false;
  const fail = (msg) => { console.error('✗', msg); failed = true; };
  const ok = (msg) => console.log('✓', msg);

  try {
    const gw = createLocalGateway(path.join(__dirname, '..', '..', 'tvpro-gateway-deno.ts'));
    const base = await gw.start();
    assert.ok(base.startsWith('http://127.0.0.1:'));
    ok('local gateway starts inside the real Electron main process: ' + base);
    await gw.stop();
  } catch (e) { fail('local gateway failed to start under Electron: ' + e.message); }

  registerAppProtocolHandler(path.join(__dirname, '..', 'site'));

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  const consoleErrors = [];
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) consoleErrors.push(message); });

  const loaded = new Promise((resolve, reject) => {
    win.webContents.once('did-finish-load', resolve);
    win.webContents.once('did-fail-load', (_e, code, desc) => reject(new Error(`did-fail-load ${code} ${desc}`)));
    setTimeout(() => reject(new Error('timed out waiting for did-finish-load')), 15000);
  });

  await win.loadURL(appUrl('/'));
  try { await loaded; ok('app:// page reached did-finish-load (index.html served from desktop/site)'); }
  catch (e) { fail(e.message); }

  try {
    const hasBridge = await win.webContents.executeJavaScript('typeof window.tvproDesktop === "object" && window.tvproDesktop.isDesktop === true');
    assert.equal(hasBridge, true);
    ok('contextBridge exposed window.tvproDesktop to the page');
  } catch (e) { fail('tvproDesktop bridge missing: ' + e.message); }

  try {
    const hasNode = await win.webContents.executeJavaScript('typeof require === "undefined" && typeof process === "undefined"');
    assert.equal(hasNode, true);
    ok('no Node integration leaked into the page (require/process are undefined)');
  } catch (e) { fail('Node integration leaked into the page: ' + e.message); }

  try {
    const version = await win.webContents.executeJavaScript('window.tvproDesktop.app.getVersion()');
    assert.equal(typeof version, 'string');
    ok('IPC round-trip works (app:getVersion -> "' + version + '")');
  } catch (e) { fail('IPC round-trip failed: ' + e.message); }

  try {
    const avail = await win.webContents.executeJavaScript('window.tvproDesktop.credentials.available()');
    ok('secure storage availability check returned: ' + avail + (avail ? '' : ' (expected false — no OS keychain in this sandboxed container)'));
    const setResult = await win.webContents.executeJavaScript('window.tvproDesktop.credentials.set("smoke-test", {hello:"world"}).catch(e=>"ERR:"+e.message)');
    if (avail) {
      assert.equal(setResult, true);
      const read = await win.webContents.executeJavaScript('window.tvproDesktop.credentials.get("smoke-test")');
      assert.deepEqual(read, { hello: 'world' });
      await win.webContents.executeJavaScript('window.tvproDesktop.credentials.delete("smoke-test")');
      ok('secure credential set/get/delete round-trips through IPC');
    } else {
      assert.ok(String(setResult).startsWith('ERR:'));
      ok('secure storage correctly refuses to store a credential when OS encryption is unavailable (sandbox has no keychain)');
    }
  } catch (e) { fail('secure storage IPC failed: ' + e.message); }

  try {
    // Simulate the website's own "Open in VLC" button (built by ext.js inside [data-tvpro-ext]) and confirm the
    // desktop-only interceptor in preload.js (a) fires on a real click, (b) correctly derives the .ts stream URL
    // from window.__tvproSrc the same way the website's own extSrc() does, and (c) blocks the original (broken,
    // iOS-only vlc-x-callback://) button handler from running at all.
    const result = await win.webContents.executeJavaScript(`(function(){
      return new Promise(function(resolve){
        window.__tvproSrc = 'http://panel.example.com/live/u/p/501.m3u8';
        window.__tvproLive = true;
        var originalHandlerRan = false;
        var panel = document.createElement('div'); panel.setAttribute('data-tvpro-ext','1');
        var btn = document.createElement('button'); btn.textContent = 'افتح في VLC';
        btn.onclick = function(){ originalHandlerRan = true; };
        panel.appendChild(btn); document.body.appendChild(panel);
        document.addEventListener('tvpro-desktop-open-external-player', function(e){
          resolve({ detail: e.detail, originalHandlerRan: originalHandlerRan });
        }, { once: true });
        btn.click();
        setTimeout(function(){ resolve({ timeout: true, originalHandlerRan: originalHandlerRan }); }, 2000);
      });
    })()`);
    assert.equal(result.timeout, undefined, 'the bridge event never fired (main-world injection or cross-world dispatch failed)');
    assert.equal(result.originalHandlerRan, false, 'the broken iOS-scheme button handler ran anyway (should have been blocked)');
    assert.equal(result.detail.app, 'vlc');
    assert.equal(result.detail.url, 'http://panel.example.com/live/u/p/501.ts', 'did not convert .m3u8 -> .ts the same way the website\'s own extSrc() does');
    ok('desktop VLC/Infuse button fix: click intercepted, original iOS-scheme handler blocked, correct .ts URL bridged across the isolation boundary');
  } catch (e) { fail('external-player button interception failed: ' + e.message); }

  if (consoleErrors.length) {
    console.warn('(page console errors — likely just blocked network calls in this sandboxed environment, see below)');
    consoleErrors.slice(0, 5).forEach((m) => console.warn('  ' + m.slice(0, 200)));
  }

  console.log(failed ? '\nSMOKE TEST: FAILED' : '\nSMOKE TEST: all checks passed');
  app.exit(failed ? 1 : 0);
});
