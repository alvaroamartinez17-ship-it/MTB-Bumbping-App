/*
 * store.js — IndexedDB. This is where every run lives, and the only place it
 * lives unless you deliberately export one.
 *
 * Nothing here talks to the network. That is the point.
 */

const DB_NAME = 'mtbbump';
const STORE = 'runs';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
    t.onerror = () => reject(t.error);
  }));
}

const Store = {
  put: (run) => tx('readwrite', (s) => s.put(run)),
  get: (id) => tx('readonly', (s) => s.get(id)),
  all: () => tx('readonly', (s) => s.getAll()),
  remove: (id) => tx('readwrite', (s) => s.delete(id)),

  /**
   * Ask the browser not to evict this data.
   *
   * Safari deletes IndexedDB, localStorage, service worker registrations and
   * caches after seven days without interaction with the site. A web app added
   * to the Home Screen is explicitly exempt from that rule — it gets its own
   * storage, isolated from Safari, and ITP skips it.
   *
   * So: Home Screen is the real protection, and this call is a belt-and-braces
   * request on top. Neither is a backup.
   */
  async requestPersistence() {
    if (!navigator.storage || !navigator.storage.persist) return null;
    try {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    } catch { return null; }
  },

  async usage() {
    if (!navigator.storage || !navigator.storage.estimate) return null;
    try { return await navigator.storage.estimate(); } catch { return null; }
  },
};

window.Store = Store;
