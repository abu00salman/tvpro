'use strict';
const { app, BrowserWindow, ipcMain, shell, dialog, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const { registerAppScheme, registerAppProtocolHandler, appUrl, SCHEME } = require('./appProtocol');
const windowState = require('./windowState');
const secureStore = require('./secureStore');
const { createLocalGateway } = require('./localProxy');
const { buildMenu } = require('./menu');

const isDev = process.argv.includes('--dev');
const SITE_ROOT = path.join(__dirname, '..', 'site');
const GATEWAY_SOURCE = app.isPackaged
  ? path.join(process.resourcesPath, 'tvpro-gateway-deno.ts')
  : path.join(__dirname, '..', '..', 'tvpro-gateway-deno.ts');

let mainWindow = null;
let localGatewayUrl = null;
let localGateway = null;

// ---------------------------------------------------------------- single instance ----
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

// ---------------------------------------------------------------- privileged scheme ----
registerAppScheme();

function createWindow() {
  if (!fs.existsSync(SITE_ROOT)) {
    dialog.showErrorBox(
      'TV Pro — ملف الموقع غير موجود',
      'لم يتم العثور على desktop/site. شغّل "npm run build:site" داخل مجلد desktop أولًا، ثم أعد تشغيل التطبيق.',
    );
    app.quit();
    return;
  }

  const state = windowState.load();
  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 760,
    minHeight: 480,
    show: true,
    backgroundColor: '#0b0e14', // matches the site's dark shell background; avoids a white flash before paint
    title: 'TV Pro',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      additionalArguments: localGatewayUrl ? [`--tvpro-local-gateway=${localGatewayUrl}`] : [],
    },
  });

  windowState.track(mainWindow);
  if (state.isFullScreen) mainWindow.setFullScreen(true);
  else if (state.isMaximized) mainWindow.maximize();

  // ---- navigation guards: the window may only ever show our own packaged app. Any attempt to navigate to, or
  // open a new window for, anything else is handled by the user's real default browser instead. ----
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${SCHEME}://`)) { event.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // ---- load failure -> a clear, native retry dialog instead of a blank/white window ----
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    if (errorCode === -3) return; // ERR_ABORTED: a normal navigation that was itself cancelled, not a failure
    const target = mainWindow;
    dialog
      .showMessageBox(target, {
        type: 'error',
        buttons: ['إعادة المحاولة', 'إغلاق'],
        defaultId: 0,
        title: 'تعذّر تحميل TV Pro',
        message: `تعذّر تحميل التطبيق (${errorDescription || errorCode}).`,
        detail: `الرابط: ${validatedURL}\n\nتحقق من الاتصال بالإنترنت إن كان الخطأ متعلقًا بموارد خارجية، أو أعد تشغيل التطبيق إن تكرر هذا دائمًا.`,
      })
      .then(({ response }) => { if (response === 0 && target && !target.isDestroyed()) target.loadURL(appUrl('/')); });
  });

  // Branded splash first (a local static file, no network, effectively instant) so the window never shows a
  // blank/white frame, then hand off to the real app. The deliberate interruption of the splash's own navigation
  // below fires a harmless did-fail-load(-3 ERR_ABORTED), already filtered out above.
  mainWindow.loadFile(path.join(__dirname, 'loading.html'));
  mainWindow.loadURL(appUrl('/'));

  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });

  setupMenu();
}

function setupMenu() {
  Menu.setApplicationMenu(
    buildMenu({
      getWindow: () => mainWindow,
      isDev,
      onClearData: async () => {
        secureStore.clearAll();
        if (!mainWindow) return;
        await new Promise((resolve) => {
          ipcMain.once('desktop:clear-all-data-ack', resolve);
          mainWindow.webContents.send('desktop:clear-all-data');
          setTimeout(resolve, 4000); // don't hang forever if the page never acks
        });
        dialog.showMessageBox(mainWindow, { type: 'info', message: 'تم مسح كل البيانات المحلية.' });
        mainWindow.loadURL(appUrl('/'));
      },
    }),
  );
}

// ---------------------------------------------------------------- secure credential IPC ----
require('./ipcHandlers').registerIpcHandlers();

// ---------------------------------------------------------------- app lifecycle ----
if (gotLock) {
  app.whenReady().then(async () => {
    try {
      localGateway = createLocalGateway(GATEWAY_SOURCE);
      localGatewayUrl = await localGateway.start();
    } catch (err) {
      // Non-fatal: the web app's own external gateways (Cloudflare/Deno) remain available as before.
      console.warn('local gateway failed to start; falling back to the external gateways only:', err.message);
    }
    registerAppProtocolHandler(SITE_ROOT);
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else { mainWindow.show(); mainWindow.focus(); }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', async (event) => {
    if (localGateway) { event.preventDefault(); await localGateway.stop(); localGateway = null; app.quit(); }
  });

  // Defense in depth, consistent with the navigation guard above: block any accidental new-window creation
  // before a WindowOpenHandler is even attached, and strip webview/node-remote-content risk at the app level.
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
}

module.exports = {};
