'use strict';
// All IPC entry points the renderer can reach, in one place. Every handler re-validates the sender frame's
// origin (assertTrustedSender) and the shape of its input; nothing here ever logs a credential value.
const { app, ipcMain, shell } = require('electron');
const secureStore = require('./secureStore');
const { SCHEME } = require('./appProtocol');

function assertTrustedSender(event) {
  const frameUrl = event.senderFrame && event.senderFrame.url;
  if (!frameUrl || !frameUrl.startsWith(`${SCHEME}://`)) throw new Error('untrusted sender');
}

function registerIpcHandlers() {
  ipcMain.handle('credentials:available', (event) => { assertTrustedSender(event); return secureStore.isAvailable(); });
  ipcMain.handle('credentials:get', (event, key) => { assertTrustedSender(event); return secureStore.get(key); });
  ipcMain.handle('credentials:set', (event, key, value) => {
    assertTrustedSender(event);
    if (value !== null && typeof value !== 'object') throw new Error('credential value must be an object or null');
    return secureStore.set(key, value);
  });
  ipcMain.handle('credentials:delete', (event, key) => { assertTrustedSender(event); return secureStore.delete(key); });
  ipcMain.handle('credentials:list', (event) => { assertTrustedSender(event); return secureStore.listKeys(); });
  ipcMain.handle('app:getVersion', (event) => { assertTrustedSender(event); return app.getVersion(); });
  ipcMain.handle('app:openExternal', (event, url) => {
    assertTrustedSender(event);
    if (typeof url !== 'string' || !/^https:\/\//.test(url)) throw new Error('only https:// links may be opened externally');
    return shell.openExternal(url);
  });
}

module.exports = { registerIpcHandlers, assertTrustedSender };
