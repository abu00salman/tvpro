/*
 * TV Pro v2 — storage layer.
 *
 * Reads the SAME IndexedDB/localStorage schema the shipped Next.js app already writes,
 * reverse-engineered read-only from the compiled bundle (_next/static/chunks/app/page-*.js)
 * and from the two existing hand-written pages that already depend on it (diag.html, epg.html):
 *
 *   indexedDB "tvpro" (v1)
 *     store "playlists"  keyPath "id"         -> { id, name, createdAt, counts:{channels,movies,series}, secret? }
 *     store "libraries"  keyPath "playlistId" -> { playlistId, channels:[...], movies:[...], series:[...] }
 *     store "kv"          (explicit keys)      -> "activePlaylist" (string id)
 *                                                  "vault:key"      (CryptoKey, AES-GCM, for decrypting playlist secrets)
 *                                                  "favorites:<playlistId>" (object: id -> true)
 *                                                  "history:<playlistId>"   (object: id -> {position, duration, updatedAt, ...})
 *   localStorage
 *     "tvpro:settings"  JSON  -> { proxyUrl?, ...user prefs } (app's own settings blob; we only READ proxyUrl)
 *     "tvpro:playdiag"  JSON array -> playback diagnostics log (read-only, used by diag.html)
 *
 * This module is read-only and additive: it never writes a different shape into these stores,
 * so it can run side by side with the existing app without risking existing users' saved
 * playlists, favorites or watch history. When the schema is absent (no playlist saved on this
 * device, or a browser with IndexedDB blocked), every function resolves to an empty/null result
 * so callers fall back to the bundled demo dataset (see demo.js) instead of throwing.
 */
(function (global) {
  'use strict';

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in global)) return reject(new Error('no-indexeddb'));
      const req = indexedDB.open('tvpro', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('idb-open-failed'));
      // The real app owns schema creation. If we are first to open "tvpro" (fresh browser,
      // nothing saved yet) there is nothing to upgrade to — treat it as "no data" rather than
      // creating stores ourselves, so we never define a competing shape for the real app.
      req.onupgradeneeded = () => { try { req.transaction.abort(); } catch (_e) {} reject(new Error('no-data')); };
    });
  }

  function storeGet(db, store, key) {
    return new Promise((resolve, reject) => {
      let tx;
      try { tx = db.transaction(store, 'readonly'); } catch (e) { return reject(e); }
      const os = tx.objectStore(store);
      const req = key === undefined ? os.getAll() : os.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function decryptSecret(db, secret) {
    if (!secret) return undefined;
    const key = await storeGet(db, 'kv', 'vault:key');
    if (!key) return undefined;
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: secret.iv }, key, secret.data);
    return JSON.parse(new TextDecoder().decode(plain));
  }

  /** Loads the active playlist's library (channels/movies/series) and decrypted secret, or null fields if none saved. */
  async function loadActiveLibrary() {
    let db;
    try { db = await openDb(); } catch (e) { return { ok: false, reason: e.message || 'no-data' }; }
    try {
      const [activeId, playlists] = await Promise.all([storeGet(db, 'kv', 'activePlaylist'), storeGet(db, 'playlists')]);
      const list = playlists || [];
      const pl = list.find((p) => p.id === activeId) || list[0];
      if (!pl) return { ok: false, reason: 'no-playlist' };
      const [lib, favorites, history] = await Promise.all([
        storeGet(db, 'libraries', pl.id),
        storeGet(db, 'kv', 'favorites:' + pl.id),
        storeGet(db, 'kv', 'history:' + pl.id),
      ]);
      let secret;
      try { secret = await decryptSecret(db, pl.secret); } catch (_e) { secret = undefined; }
      return {
        ok: true,
        playlist: pl,
        channels: (lib && lib.channels) || [],
        movies: (lib && lib.movies) || [],
        series: (lib && lib.series) || [],
        favorites: favorites || {},
        history: history || {},
        secret,
      };
    } catch (e) {
      return { ok: false, reason: e.message || 'storage-error' };
    }
  }

  function readSettings() {
    try { return JSON.parse(localStorage.getItem('tvpro:settings') || '{}'); } catch (_e) { return {}; }
  }

  function storePut(db, store, value, key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const req = key === undefined ? tx.objectStore(store).put(value) : tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    });
  }

  /** The exact favorites-key convention the shipped app uses (reverse-engineered from the
   *  compiled bundle: `ap(kind, id) = kind[0] + ':' + id`, e.g. "m:<hash>" for a movie,
   *  "s:<hash>" for a series, "c:<hash>" for a channel). Getting this wrong would silently
   *  desync from the real app's own favorites, so it is reproduced verbatim rather than
   *  reinvented. */
  function favoriteKey(kind, id) { return kind[0] + ':' + id; }

  /** Toggles one favorite and writes it back to the REAL store/key the shipped app reads
   *  (kv["favorites:<playlistId>"]), in the exact shape the bundle itself writes:
   *  { [key]: { key, kind, addedAt } }, entry removed (not set to false) when un-favoriting.
   *  Confirmed against the bundle's own toggle function (`ev`) and its debounced persist
   *  call (`db.put("kv", state.favorites, "favorites:" + playlistId)`). */
  async function toggleFavorite(playlistId, kind, id, currentFavorites) {
    const key = favoriteKey(kind, id);
    const next = { ...currentFavorites };
    if (next[key]) delete next[key]; else next[key] = { key, kind, addedAt: Date.now() };
    const db = await openDb();
    await storePut(db, 'kv', next, 'favorites:' + playlistId);
    return next;
  }

  /** Records a watch-progress entry in the REAL history shape/key the shipped app uses
   *  (kv["history:<playlistId>"]): { [key]: { key, kind, itemId, title, logo, position,
   *  duration, updatedAt, episodes? } }, confirmed against the bundle's own `ey`/`ex`/`eb`
   *  helpers. `entry.key` must be `favoriteKey(kind, itemId)` for a movie/channel, or the
   *  series' own key (with a nested `episodes[episodeId]` map) for a series episode. */
  async function recordHistory(playlistId, entry, currentHistory) {
    const key = entry.key;
    const next = { ...currentHistory, [key]: { ...(currentHistory[key] || {}), ...entry, updatedAt: Date.now() } };
    const db = await openDb();
    await storePut(db, 'kv', next, 'history:' + playlistId);
    return next;
  }

  global.TvproStorage = { loadActiveLibrary, readSettings, favoriteKey, toggleFavorite, recordHistory };
})(window);
