'use strict';
// Encrypted local storage for IPTV subscription credentials (Xtream username/password, M3U URLs that embed
// credentials). Uses Electron's safeStorage, which is backed by the OS keychain (macOS Keychain, Windows DPAPI,
// libsecret on Linux) — the encryption key itself never touches disk in plaintext. Never log a value; only log
// key names and booleans. The renderer never sees the raw file path or the encryption primitive, only get/set/
// delete/clear through IPC (see preload.js + main.js's ipcMain.handle wiring).
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const KEY_RE = /^[a-z0-9_-]{1,64}$/i;
let dir = null;

function secureDir() {
  if (!dir) { dir = path.join(app.getPath('userData'), 'secure'); fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); }
  return dir;
}

function assertValidKey(key) {
  if (typeof key !== 'string' || !KEY_RE.test(key)) throw new Error('invalid credential key');
  return key;
}

function fileFor(key) { return path.join(secureDir(), assertValidKey(key) + '.bin'); }

function isAvailable() {
  try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
}

function set(key, value) {
  if (!isAvailable()) throw new Error('OS secure storage is not available on this system');
  const json = JSON.stringify(value ?? null);
  const enc = safeStorage.encryptString(json);
  fs.writeFileSync(fileFor(key), enc, { mode: 0o600 });
  return true;
}

function get(key) {
  const f = fileFor(key);
  if (!fs.existsSync(f)) return null;
  if (!isAvailable()) throw new Error('OS secure storage is not available on this system');
  const enc = fs.readFileSync(f);
  try { return JSON.parse(safeStorage.decryptString(enc)); } catch { return null; }
}

function del(key) {
  const f = fileFor(key);
  if (fs.existsSync(f)) fs.unlinkSync(f);
  return true;
}

function listKeys() {
  try { return fs.readdirSync(secureDir()).filter((f) => f.endsWith('.bin')).map((f) => f.slice(0, -4)); }
  catch { return []; }
}

function clearAll() {
  for (const k of listKeys()) del(k);
  return true;
}

module.exports = { isAvailable, set, get, delete: del, listKeys, clearAll };
