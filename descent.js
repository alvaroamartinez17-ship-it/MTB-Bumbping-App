/*
 * descent.js — decides when you're going down.
 *
 * The iPhone 6s has a barometer, and it would be the right sensor for this,
 * but no browser exposes barometric pressure. So this works from GPS altitude,
 * which is roughly three times noisier than horizontal position — commonly
 * +/- 10-20 m. Everything below is built around that noise:
 *
 *   - altitude is exponentially smoothed before use;
 *   - decisions come from a least-squares slope over a window, not from the
 *     difference between two fixes;
 *   - the test is grade (metres down per metre along), which is independent of
 *     how fast you're riding;
 *   - entry and exit thresholds differ, so a flat spot mid-trail doesn't end
 *     the segment.
 */

const DESCENT_DEFAULTS = {
  enterWindow: 12,      // s of history needed to call a descent
  exitWindow: 20,       // s of not-descending before closing one
  enterGrade: -0.03,    // -3%: gentle enough for flowy trails
  exitGrade: -0.008,    // shallower, so rollers don't split a run
  minEnterDrop: 4,      // m lost within enterWindow; must beat GPS altitude noise
  enterConfirm: 4,      // consecutive qualifying fixes before committing
  minEnterDistance: 15, // m travelled within enterWindow
  stoppedDistance: 5,   // m in exitWindow counts as stopped
  altSmoothing: 0.35,   // exponential factor on raw GPS altitude
  maxAccuracy: 30,      // m; worse fixes are ignored entirely
  minDrop: 30,          // m of net descent; below this it isn't a trail
  minDropFloor: 15,     // hard lower limit; see clampMinDrop()
  minLength: 100,       // m; secondary guard against short steep drops
  rejoinGap: 45,        // s of not-descending before a segment is really over.
                        // Must exceed exitWindow + the time to re-confirm a
                        // descent, or a genuinely continuous trail with a flat
                        // mid-section gets split in two.
};

class DescentDetector {
  constructor(opts = {}) {
    this.opts = { ...DESCENT_DEFAULTS, ...opts };
    this.reset();
  }

  reset() {
    this.fixes = [];        // { t, lat, lon, alt (smoothed), acc, dist }
    this.descending = false;
    this.confirm = 0;
    this.smoothedAlt = null;
    this.cumDist = 0;
    this.lastFix = null;
    this.enteredAt = null;
  }

  /**
   * @returns {null | {type:'start'|'end', t:number, drop:number, length:number, grade:number}}
   */
  push(fix) {
    const o = this.opts;
    if (!(fix.acc > 0 && fix.acc < o.maxAccuracy)) return null;
    if (fix.alt === null || fix.alt === undefined || Number.isNaN(fix.alt)) return null;

    this.smoothedAlt = this.smoothedAlt === null
      ? fix.alt
      : this.smoothedAlt + o.altSmoothing * (fix.alt - this.smoothedAlt);

    if (this.lastFix) this.cumDist += haversine(this.lastFix, fix);
    this.lastFix = fix;

    this.fixes.push({ t: fix.t, lat: fix.lat, lon: fix.lon,
                      alt: this.smoothedAlt, acc: fix.acc, dist: this.cumDist });

    // Keep a little more than the longer of the two windows.
    const cutoff = fix.t - Math.max(o.enterWindow, o.exitWindow) - 5;
    while (this.fixes.length && this.fixes[0].t < cutoff) this.fixes.shift();

    return this.descending ? this._checkExit(fix) : this._checkEnter(fix);
  }

  _checkEnter(fix) {
    const o = this.opts;
    const w = this._window(fix.t, o.enterWindow);
    if (w.length < 4) return null;

    const span = w[w.length - 1].t - w[0].t;
    if (span < o.enterWindow * 0.6) return null;

    const dxy = w[w.length - 1].dist - w[0].dist;
    const drop = w[0].alt - w[w.length - 1].alt;
    const grade = slope(w);

    // Debounce. GPS altitude wanders by several metres even standing still, so
    // a single qualifying window is not evidence of anything — on a flat
    // run-out the noise alone will produce one every few seconds. Requiring
    // consecutive qualifying fixes is what separates a trail from jitter.
    if (dxy < o.minEnterDistance || drop < o.minEnterDrop || grade > o.enterGrade) {
      this.confirm = 0;
      return null;
    }
    if (++this.confirm < o.enterConfirm) return null;

    this.confirm = 0;
    this.descending = true;
    this.enteredAt = { t: w[0].t, dist: w[0].dist, alt: w[0].alt };
    return { type: 'start', t: w[0].t, drop, length: dxy, grade };
  }

  _checkExit(fix) {
    const o = this.opts;
    const w = this._window(fix.t, o.exitWindow);
    if (w.length < 4) return null;
    if (w[w.length - 1].t - w[0].t < o.exitWindow * 0.6) return null;

    const dxy = w[w.length - 1].dist - w[0].dist;
    const grade = slope(w);

    const stopped = dxy < o.stoppedDistance;
    const flattened = grade > o.exitGrade;
    if (!stopped && !flattened) return null;

    this.descending = false;
    const start = this.enteredAt;
    const end = this.fixes[this.fixes.length - 1];
    const result = {
      type: 'end',
      t: fix.t,
      drop: start ? start.alt - end.alt : 0,
      length: start ? end.dist - start.dist : 0,
      grade,
      reason: stopped ? 'stopped' : 'flattened',
    };
    this.enteredAt = null;
    return result;
  }

  _window(now, seconds) {
    const from = now - seconds;
    let i = this.fixes.length - 1;
    while (i > 0 && this.fixes[i - 1].t >= from) i--;
    return this.fixes.slice(i);
  }

  /** Live grade estimate for the UI, or null before enough fixes accumulate. */
  currentGrade() {
    const w = this._window(this.lastFix ? this.lastFix.t : 0, this.opts.enterWindow);
    return w.length >= 4 ? slope(w) : null;
  }

  /**
   * The drop threshold is adjustable, but not below 15 m.
   *
   * GPS vertical error is commonly +/- 10-20 m. At 15 m the keep-or-discard
   * decision is already marginal; below it the threshold is inside the noise
   * and the app would be sorting runs essentially at random. Anything under
   * 15 m needs a barometer, which no browser exposes.
   */
  static clampMinDrop(metres) {
    const v = parseFloat(metres);
    if (Number.isNaN(v)) return DESCENT_DEFAULTS.minDrop;
    return Math.max(DESCENT_DEFAULTS.minDropFloor, v);
  }

  /** Does a finished segment clear the minimums, or was it a speed bump? */
  worthKeeping(drop, length) {
    return drop >= this.opts.minDrop && length >= this.opts.minLength;
  }

  /**
   * Robust net drop for a set of fixes: median of the first few altitudes
   * minus the median of the last few. Using single endpoints would let one
   * bad fix move the answer by 15 m, which at a 30 m threshold is the
   * difference between keeping a run and binning it.
   */
  static netDrop(fixes) {
    const alts = fixes
      .filter((f) => f.acc > 0 && f.acc < 40 && f.alt !== null && !Number.isNaN(f.alt))
      .map((f) => f.alt);
    if (alts.length < 4) return 0;
    const n = Math.min(5, Math.floor(alts.length / 3));
    return median(alts.slice(0, n)) - median(alts.slice(-n));
  }
}

function median(a) {
  const s = a.slice().sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Least-squares slope of altitude against horizontal distance. */
function slope(w) {
  const n = w.length;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (const f of w) {
    sx += f.dist; sy += f.alt;
    sxy += f.dist * f.alt; sxx += f.dist * f.dist;
  }
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-9) return 0;
  return (n * sxy - sx * sy) / denom;
}

function haversine(a, b) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const lat = ((a.lat + b.lat) / 2) * rad;
  const x = dLon * Math.cos(lat);
  return Math.sqrt(dLat * dLat + x * x) * R;
}

window.Descent = { DescentDetector, DESCENT_DEFAULTS };
