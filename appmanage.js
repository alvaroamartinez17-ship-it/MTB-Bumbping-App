/*
 * appmanage.js — updating and removing the app.
 *
 * A web app on a Home Screen has no App Store behind it, so both of these have
 * to be built by hand.
 *
 * CONNECTION POLICY: the app contacts GitHub only when you tap Check for
 * updates. Nothing polls, nothing refreshes in the background. Three things
 * make that true:
 *
 *   1. The service worker is cache-only, so opening a screen never fetches.
 *   2. register() runs only when there is no existing registration, because
 *      calling it on every launch prompts the browser to go and compare the
 *      worker script.
 *   3. updateViaCache 'all' lets the browser serve sw.js from its own HTTP
 *      cache instead of revalidating it.
 *
 * One residual request is outside our control. The spec has the browser check
 * the worker script on navigation if it has not been checked for 24 hours, and
 * a page cannot opt out. Worst case that is one request for sw.js per day. It
 * carries no ride data -- nothing does.
 */

const LAST_CHECK_KEY = 'mtbbump.lastUpdateCheck';

const AppManage = {
  registration: null,
  waiting: null,
  onUpdateReady: null,
  /** Set true while recording — an update must never interrupt a session. */
  busy: false,

  async init() {
    if (!('serviceWorker' in navigator)) return null;
    try {
      // Reuse an existing registration rather than registering again.
      this.registration = await navigator.serviceWorker.getRegistration();
      if (!this.registration) {
        this.registration = await navigator.serviceWorker.register('sw.js', {
          updateViaCache: 'all',
        });
      }
    } catch {
      return null;
    }

    if (this.registration.waiting) this._ready(this.registration.waiting);

    this.registration.addEventListener('updatefound', () => {
      const sw = this.registration.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        // 'installed' with an existing controller means a genuinely new
        // version is sitting behind the current one. Without a controller it
        // is the very first install, which needs no prompt.
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          this._ready(sw);
        }
      });
    });

    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });

    // Deliberately no automatic check. An earlier version re-checked on every
    // foreground, which meant the app phoned GitHub each time you opened it.

    return this.registration;
  },

  _ready(worker) {
    this.waiting = worker;
    if (this.onUpdateReady) this.onUpdateReady();
  },

  /**
   * The only place this app initiates a connection to GitHub.
   *
   * update() fetches sw.js and compares it byte for byte. If it differs, the
   * new worker installs and precaches the new files, so one tap performs the
   * whole update -- and nothing is downloaded if nothing changed.
   *
   * @returns 'updating' | 'current' | 'offline' | 'unavailable'
   */
  async check() {
    if (!this.registration) return 'unavailable';
    if (!navigator.onLine) return 'offline';
    try {
      await this.registration.update();
      localStorage.setItem(LAST_CHECK_KEY, new Date().toISOString());
      return this.waiting ? 'updating' : 'current';
    } catch {
      return 'offline';
    }
  },

  get lastCheck() {
    const v = localStorage.getItem(LAST_CHECK_KEY);
    return v ? new Date(v) : null;
  },

  /**
   * Activate the waiting worker. Refuses while a session is running — losing
   * a descent to a page reload would be a poor trade for a bug fix.
   */
  apply() {
    if (this.busy) return false;
    if (!this.waiting) return false;
    this.waiting.postMessage({ type: 'SKIP_WAITING' });
    return true;
  },

  get updateReady() { return Boolean(this.waiting); },

  /**
   * Erase everything this app holds on the device: runs, cached files, the
   * service worker, and settings.
   *
   * iOS gives no way to delete a Home Screen icon programmatically, so the
   * last step is the user's. Deleting the icon alone would leave the data
   * behind, which is why this exists at all.
   */
  async eraseEverything() {
    const result = { runs: 0, caches: 0, worker: false };

    try {
      const runs = await window.Store.all();
      for (const r of runs) await window.Store.remove(r.id);
      result.runs = runs.length;
    } catch { /* store may already be gone */ }

    try {
      indexedDB.deleteDatabase('mtbbump');
    } catch { /* not fatal */ }

    try {
      const keys = await caches.keys();
      for (const k of keys) await caches.delete(k);
      result.caches = keys.length;
    } catch { /* not fatal */ }

    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('mtbbump.')) localStorage.removeItem(key);
    }

    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
      result.worker = regs.length > 0;
    } catch { /* not fatal */ }

    return result;
  },

  async storageReport() {
    const est = await window.Store.usage();
    if (!est) return null;
    return {
      usedMB: (est.usage || 0) / 1048576,
      quotaMB: (est.quota || 0) / 1048576,
    };
  },
};

window.AppManage = AppManage;
