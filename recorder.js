/*
 * recorder.js — session recording with automatic descent segmentation.
 *
 * Model: you start one session at the car park and end it when you're done.
 * Motion runs the whole time but is only *kept* while the descent detector
 * says you're going down, plus a pre-roll so the top of each trail isn't lost.
 * Each descent becomes its own run, saved to IndexedDB.
 *
 * Requires a secure context (HTTPS). Works fully offline once the service
 * worker has cached the app, and never contacts the network at any point —
 * recorded data is written to IndexedDB on this device and stays there.
 */

const CLIP_G = 7.9;
const CLIP_MS2 = CLIP_G * 9.80665;
const PREROLL_SECONDS = 20;

/* ---------------------------------------------------------------- storage */

// Runs live only in IndexedDB on this device. See store.js.
const Store = window.Store;

/* --------------------------------------------------------------- recorder */

class SessionRecorder extends EventTarget {
  constructor() {
    super();
    this.active = false;
    this.detector = new window.Descent.DescentDetector();
    // iOS reports accelerationIncludingGravity with the opposite sign to the
    // spec. Every metric is sign-independent; only the live readout cares.
    this.flipVertical = /iPad|iPhone|iPod/.test(navigator.userAgent);
    this.manualOverride = false;
    this._resetSession();
  }

  _resetSession() {
    this.sessionId = null;
    this.segments = [];
    this.gpsAll = [];
    this.preRoll = [];        // rolling buffer: [t, aVert, clip]
    this.current = null;      // active segment being kept
    this.t0 = 0;
    this.peak = 0;
    this.sampleCount = 0;
    this.clipCount = 0;
    this.lastEmit = 0;
    this.lastFixAt = null;
    this.watchId = null;
    this._g = null;
  }

  static supported() {
    return typeof DeviceMotionEvent !== 'undefined' && 'geolocation' in navigator;
  }

  /** Must be called from a click or touchend. Not touchstart, not page load. */
  static requestPermission() {
    if (typeof DeviceMotionEvent.requestPermission !== 'function') {
      return Promise.resolve('granted');
    }
    return DeviceMotionEvent.requestPermission();
  }

  /* ---- session control ---- */

  startSession({ name, notes, setup }) {
    if (this.active) return;
    this._resetSession();
    this.detector.reset();
    this.active = true;
    this.sessionId = uuid();
    this.sessionName = name || new Date().toISOString().slice(0, 16).replace('T', ' ');
    this.sessionNotes = notes || '';
    // Frozen at session start. Changing the bike mid-session would silently
    // mislabel every run recorded before the change, so it is captured once.
    this.sessionSetup = setup ? JSON.parse(JSON.stringify(setup)) : null;
    this.startedAt = new Date().toISOString();
    this.t0 = performance.now() / 1000;

    this._onMotion = (ev) => this._handleMotion(ev);
    window.addEventListener('devicemotion', this._onMotion);

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this._handleFix(pos),
      (err) => this._emit('gpserror', err.message),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }
    );
  }

  async endSession() {
    if (!this.active) return [];
    this.active = false;
    window.removeEventListener('devicemotion', this._onMotion);
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);

    if (this.current) await this._finaliseSegment('session ended');

    const saved = this.segments.slice();
    this._resetSession();
    return saved;
  }

  /** Manual start/stop, for when the detector misses a trail. */
  toggleManual() {
    this.manualOverride = !this.manualOverride;
    if (this.manualOverride && !this.current) this._openSegment('manual');
    if (!this.manualOverride && this.current && this.current.trigger === 'manual') {
      this._finaliseSegment('manual stop');
    }
    return this.manualOverride;
  }

  get recordingSegment() { return this.current !== null; }

  /* ---- motion ---- */

  _handleMotion(ev) {
    const r = this._verticalG(ev);
    if (!r) return;

    const t = performance.now() / 1000 - this.t0;
    this.sampleCount++;
    if (r.saturated) this.clipCount++;
    const abs = Math.abs(r.vert);
    if (abs > this.peak) this.peak = abs;

    const sample = [
      Math.round(t * 10000) / 10000,
      Math.round(r.vert * 100000) / 100000,
      r.saturated ? 1 : 0,
    ];

    if (this.current) {
      this.current.t.push(sample[0]);
      this.current.aVert.push(sample[1]);
      this.current.clip.push(sample[2]);
    } else {
      // Pre-roll: keeps the last 20 s so a descent detected 12 s late still
      // has the top of the trail in it.
      this.preRoll.push(sample);
      const cutoff = t - PREROLL_SECONDS;
      while (this.preRoll.length && this.preRoll[0][0] < cutoff) this.preRoll.shift();
    }

    const now = performance.now() / 1000;
    if (now - this.lastEmit > 0.15) {
      this.lastEmit = now;
      this._emit('tick', {
        vert: r.vert,
        peak: this.peak,
        samples: this.sampleCount,
        clipped: this.clipCount,
        elapsed: t,
        rate: t > 2 ? this.sampleCount / t : 0,
        grade: this.detector.currentGrade(),
        descending: this.detector.descending,
        recording: Boolean(this.current) && this.current.pausedAt === null,
        paused: Boolean(this.current) && this.current.pausedAt !== null,
        segmentSamples: this.current ? this.current.t.length : 0,
        segments: this.segments.length,
        gpsAge: this.lastFixAt === null ? null : t - this.lastFixAt,
        fixes: this.gpsAll.length,
      });
    }
  }

  /** Vertical acceleration in g, gravity removed, independent of mount angle. */
  _verticalG(ev) {
    const a = ev.acceleration;
    const ag = ev.accelerationIncludingGravity;
    if (!ag || ag.x === null) return null;

    let ux, uy, uz, gx, gy, gz;
    if (a && a.x !== null) {
      ux = a.x; uy = a.y; uz = a.z;
      gx = ag.x - a.x; gy = ag.y - a.y; gz = ag.z - a.z;
    } else {
      if (!this._g) this._g = { x: ag.x, y: ag.y, z: ag.z };
      const k = 0.02;
      this._g.x += k * (ag.x - this._g.x);
      this._g.y += k * (ag.y - this._g.y);
      this._g.z += k * (ag.z - this._g.z);
      gx = this._g.x; gy = this._g.y; gz = this._g.z;
      ux = ag.x - gx; uy = ag.y - gy; uz = ag.z - gz;
    }

    const gn = Math.sqrt(gx * gx + gy * gy + gz * gz);
    if (gn < 1) return null;
    let vert = (ux * gx + uy * gy + uz * gz) / gn;
    if (this.flipVertical) vert = -vert;

    const saturated = Math.abs(ag.x) >= CLIP_MS2
      || Math.abs(ag.y) >= CLIP_MS2 || Math.abs(ag.z) >= CLIP_MS2;

    return { vert: vert / 9.80665, saturated };
  }

  /* ---- gps and segmentation ---- */

  _handleFix(pos) {
    if (!this.active) return;
    const t = performance.now() / 1000 - this.t0;
    this.lastFixAt = t;

    const fix = {
      t: Math.round(t * 1000) / 1000,
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      alt: pos.coords.altitude,
      acc: pos.coords.accuracy,
      spd: pos.coords.speed,
    };
    this.gpsAll.push(fix);
    if (this.current) this.current.gps.push(fix);

    // A paused segment that has stayed flat long enough is really finished.
    if (this.current && this.current.pausedAt !== null
        && t - this.current.pausedAt > this.detector.opts.rejoinGap) {
      this._finaliseSegment('flattened');
    }

    const ev = this.detector.push(fix);
    if (!ev) return;

    if (ev.type === 'start') {
      if (this.current && this.current.pausedAt !== null) {
        // Same trail, not a new one. A flat mid-section or a brief stop must
        // not split one descent into two halves — at a 30 m threshold that
        // would discard both.
        this.current.pausedAt = null;
        this._emit('segmentresumed', ev);
      } else if (!this.current) {
        this._openSegment('auto', ev.t);
        this._emit('segmentstart', ev);
      }
    } else if (ev.type === 'end' && this.current
               && this.current.trigger === 'auto' && this.current.pausedAt === null) {
      this.current.pausedAt = t;
      this._emit('segmentpaused', ev);
    }
  }

  _openSegment(trigger, startedAtT) {
    const from = startedAtT !== undefined ? startedAtT : null;

    this.current = {
      id: uuid(),
      trigger,
      t: [], aVert: [], clip: [], gps: [],
      openedAt: new Date().toISOString(),
      pausedAt: null,
    };

    // Replay the pre-roll into the new segment.
    for (const [t, v, c] of this.preRoll) {
      if (from !== null && t < from - 2) continue;
      this.current.t.push(t);
      this.current.aVert.push(v);
      this.current.clip.push(c);
    }
    this.preRoll = [];

    // And the GPS fixes covering the same stretch.
    const first = this.current.t.length ? this.current.t[0] : 0;
    this.current.gps = this.gpsAll.filter((f) => f.t >= first - 2);
  }

  async _finaliseSegment(reason) {
    const seg = this.current;
    this.current = null;
    if (!seg || !seg.t.length) return;

    // If the segment ended while paused, everything after the pause is flat
    // run-out or standing around. Keeping it would dilute every metric, so the
    // tail is trimmed — the rejoin window can then be generous without cost.
    if (seg.pausedAt !== null) {
      const cut = seg.pausedAt;
      let n = seg.t.length;
      while (n > 0 && seg.t[n - 1] > cut) n--;
      if (n > 8) {
        seg.t.length = n; seg.aVert.length = n; seg.clip.length = n;
      }
      seg.gps = seg.gps.filter((f) => f.t <= cut + 2);
    }

    const gps = seg.gps;
    const dist = gps.length > 1
      ? window.Analysis.cumulativeDistance(gps).slice(-1)[0] : 0;
    const drop = window.Descent.DescentDetector.netDrop(gps);

    if (seg.trigger !== 'manual' && !this.detector.worthKeeping(drop, dist)) {
      this._emit('discarded', { reason, dist, drop });
      return;
    }

    const run = {
      id: seg.id,
      sessionId: this.sessionId,
      name: `${this.sessionName} — run ${this.segments.length + 1}`,
      notes: this.sessionNotes,
      setup: this.sessionSetup,
      trigger: seg.trigger,
      startedAt: seg.openedAt,
      endReason: reason,
      sampleRateHz: window.Analysis.effectiveRate(seg.t),
      descent: { drop: Math.round(drop * 10) / 10, length: Math.round(dist) },
      motion: { t: seg.t, aVert: seg.aVert, clip: seg.clip },
      gps,
    };

    await Store.put(run);
    this.segments.push(run);
    this._emit('segmentsaved', run);
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  /* ---- mount check ---- */

  /**
   * Ten seconds with the bike stationary, measuring the noise floor.
   *
   * Zip ties are a rigid mount right up until they aren't. They creep,
   * especially through a cold morning and a hot afternoon, and a loosening
   * mount does not fail loudly — it quietly raises the vibration floor, which
   * inflates every roughness number without ever looking wrong. A run recorded
   * on a loose mount reads rougher than the same trail on a tight one.
   *
   * The only way to catch it is to measure the mount against itself over time.
   * Compare each check to the best one ever recorded for this configuration:
   * that best value is what the mount looks like when it is properly done up.
   *
   * @returns { rms, peak, moved } — rms in milli-g, moved true if the bike was
   *          disturbed, which invalidates the check
   */
  mountCheck(seconds = 10) {
    return new Promise((resolve) => {
      const samples = [];
      let gx = null, gy = null, gz = null, moved = false;

      const handler = (ev) => {
        const r = this._verticalG(ev);
        if (!r) return;
        samples.push(r.vert);

        // Watch the gravity vector. If it swings, the bike was leaned or
        // knocked, and the reading is of that rather than of the mount.
        const g = ev.accelerationIncludingGravity;
        const a = ev.acceleration;
        if (g && a && a.x !== null) {
          const cx = g.x - a.x, cy = g.y - a.y, cz = g.z - a.z;
          if (gx === null) { gx = cx; gy = cy; gz = cz; }
          else if (Math.abs(cx - gx) > 1.5 || Math.abs(cy - gy) > 1.5
                   || Math.abs(cz - gz) > 1.5) {
            moved = true;
          }
        }
      };

      window.addEventListener('devicemotion', handler);
      setTimeout(() => {
        window.removeEventListener('devicemotion', handler);
        if (samples.length < 30) return resolve(null);

        const mean = samples.reduce((s2, v) => s2 + v, 0) / samples.length;
        let sum = 0, peak = 0;
        for (const v of samples) {
          const d = v - mean;
          sum += d * d;
          if (Math.abs(d) > peak) peak = Math.abs(d);
        }
        resolve({
          rms: Math.sqrt(sum / samples.length) * 1000,   // milli-g
          peak: peak * 1000,
          samples: samples.length,
          moved,
        });
      }, seconds * 1000);
    });
  }

  /* ---- calibration ---- */

  /** Phone flat on a table, screen up. Pins down the iOS sign convention. */
  calibrateSign(sampleMs = 800) {
    return new Promise((resolve) => {
      const readings = [];
      const handler = (ev) => {
        const ag = ev.accelerationIncludingGravity;
        const a = ev.acceleration;
        if (ag && ag.z !== null) {
          readings.push(a && a.z !== null ? ag.z - a.z : ag.z);
        }
      };
      window.addEventListener('devicemotion', handler);
      setTimeout(() => {
        window.removeEventListener('devicemotion', handler);
        if (!readings.length) return resolve(null);
        const mean = readings.reduce((s, v) => s + v, 0) / readings.length;
        // Screen-up means device +z points at the sky. If the gravity estimate
        // agrees, the convention is inverted.
        this.flipVertical = mean > 0;
        resolve(this.flipVertical);
      }, sampleMs);
    });
  }
}

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/* ------------------------------------------------------------ screen sleep */

/**
 * iOS 15 has no Screen Wake Lock API — it arrived in Safari 16.4, which the 6s
 * can never run. Auto-Lock must be set to Never by hand.
 */
const WakeLock = {
  sentinel: null,
  supported: 'wakeLock' in navigator,
  acquire() {
    if (!this.supported) return Promise.resolve(false);
    return navigator.wakeLock.request('screen').then((s) => {
      this.sentinel = s;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && !this.sentinel) this.acquire();
      });
      return true;
    }).catch(() => false);
  },
  release() {
    if (this.sentinel) { this.sentinel.release(); this.sentinel = null; }
  },
};

window.Recorder = { SessionRecorder, WakeLock, CLIP_G, PREROLL_SECONDS };
