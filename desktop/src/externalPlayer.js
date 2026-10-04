'use strict';
// Launches a real desktop media player for a stream the bundled player can't play (wrong container/codec).
// The website's own "Open in VLC/Infuse" buttons use `vlc-x-callback://` and `infuse://` — iOS-only URL schemes
// that macOS VLC/Infuse do not register, so on desktop those buttons silently do nothing. Electron's main process
// can do what a browser tab never could: actually launch a real macOS app with the stream URL, via the same `open
// -a <App> <url>` mechanism as dragging a link onto the app's Dock icon. This also sidesteps the browser's CORS/
// mixed-content restrictions entirely, since VLC/Infuse are native apps making their own direct HTTP(S) request.
const { execFile } = require('node:child_process');
const { dialog, shell } = require('electron');

const APPS = {
  vlc: { name: 'VLC', downloadUrl: 'https://www.videolan.org/vlc/download-macosx.html', ar: 'VLC', en: 'VLC' },
  infuse: { name: 'Infuse', downloadUrl: 'https://apps.apple.com/app/id1136220934', ar: 'Infuse', en: 'Infuse' },
};

function openWith(appName, url) {
  return new Promise((resolve) => {
    execFile('open', ['-a', appName, url], (error, _stdout, stderr) => {
      if (!error) return resolve({ ok: true });
      const notInstalled = /unable to find application/i.test(stderr || '') || error.code === 1;
      resolve({ ok: false, notInstalled, message: stderr || error.message });
    });
  });
}

/** @param {'vlc'|'infuse'} appKey @param {string} url an http(s) stream URL (never a vlc-x-callback/infuse:// link) */
async function openInExternalPlayer(appKey, url, window) {
  if (process.platform !== 'darwin') return { ok: false, reason: 'unsupported_platform' };
  const app = APPS[appKey];
  if (!app) return { ok: false, reason: 'unknown_app' };
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return { ok: false, reason: 'invalid_url' };

  const result = await openWith(app.name, url);
  if (result.ok) return { ok: true };

  if (result.notInstalled) {
    const { response } = await dialog.showMessageBox(window, {
      type: 'info',
      buttons: ['إلغاء', `تحميل ${app.ar}`],
      defaultId: 1,
      title: `${app.ar} غير مثبَّت`,
      message: `لم يُعثر على تطبيق ${app.ar} على جهازك.`,
      detail: `ثبّت ${app.ar} ثم أعد المحاولة. سيعمل بعدها على فتح البث مباشرة دون قيود المتصفح.`,
    });
    if (response === 1) shell.openExternal(app.downloadUrl);
    return { ok: false, reason: 'not_installed' };
  }

  dialog.showMessageBox(window, {
    type: 'error',
    title: `تعذّر فتح ${app.ar}`,
    message: `حدث خطأ أثناء محاولة فتح ${app.ar}.`,
    detail: result.message || '',
  });
  return { ok: false, reason: 'launch_failed', message: result.message };
}

module.exports = { openInExternalPlayer };
