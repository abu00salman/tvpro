'use strict';
// Remembers the main window's bounds and maximized/fullscreen state across launches.
const { app, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

function filePath() { return path.join(app.getPath('userData'), 'window-state.json'); }

const DEFAULTS = { width: 1280, height: 800, x: undefined, y: undefined, isMaximized: false, isFullScreen: false };

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
    const state = { ...DEFAULTS, ...raw };
    // discard saved position if it no longer fits any connected display (e.g. an external monitor was unplugged)
    const displays = screen.getAllDisplays();
    const fitsAny = displays.some((d) => {
      const a = d.workArea;
      return state.x >= a.x - 50 && state.y >= a.y - 50 && state.x < a.x + a.width && state.y < a.y + a.height;
    });
    if (typeof state.x !== 'number' || typeof state.y !== 'number' || !fitsAny) { state.x = undefined; state.y = undefined; }
    return state;
  } catch { return { ...DEFAULTS }; }
}

function save(win) {
  if (!win || win.isDestroyed()) return;
  const isMaximized = win.isMaximized();
  const isFullScreen = win.isFullScreen();
  const bounds = isMaximized || isFullScreen ? win.getNormalBounds() : win.getBounds();
  try { fs.writeFileSync(filePath(), JSON.stringify({ ...bounds, isMaximized, isFullScreen })); } catch { /* best effort */ }
}

/** Wires debounced auto-save on resize/move/close; call once right after creating the window. */
function track(win) {
  let timer = null;
  const scheduleSave = () => { clearTimeout(timer); timer = setTimeout(() => save(win), 400); };
  win.on('resize', scheduleSave);
  win.on('move', scheduleSave);
  win.on('close', () => { clearTimeout(timer); save(win); });
}

module.exports = { load, save, track };
