/** Minimal promise wrapper around IndexedDB. Large data lives here, never in localStorage. */
const DB_NAME = 'tvpro';
const DB_VERSION = 1;
export type StoreName = 'playlists' | 'libraries' | 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('playlists')) db.createObjectStore('playlists', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('libraries')) db.createObjectStore('libraries', { keyPath: 'playlistId' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run<T>(store: StoreName, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = op(tx.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const db = {
  get: <T>(store: StoreName, key: string) => run<T | undefined>(store, 'readonly', (s) => s.get(key)),
  getAll: <T>(store: StoreName) => run<T[]>(store, 'readonly', (s) => s.getAll()),
  put: <T>(store: StoreName, value: T, key?: string) => run(store, 'readwrite', (s) => s.put(value, key)),
  delete: (store: StoreName, key: string) => run(store, 'readwrite', (s) => s.delete(key)),
};
