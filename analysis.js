/*
 * analysis.js — roughness metrics and run comparison.
 *
 * Direct port of RunAnalysis.swift so the web and native paths produce
 * identical numbers from identical input. No dependencies.
 */

const G = 9.80665;

/* ---------------------------------------------------------------- filters */

/** Direct-form-I biquad, RBJ cookbook coefficients. */
class Biquad {
  constructor(b0, b1, b2, a1, a2) {
    Object.assign(this, { b0, b1, b2, a1, a2 });
  }

  static lowpass(fc, fs, q = Math.SQRT1_2) {
    const w = (2 * Math.PI * Math.min(fc, fs * 0.49)) / fs;
    const cw = Math.cos(w), sw = Math.sin(w), alpha = sw / (2 * q);
    const a0 = 1 + alpha;
    return new Biquad(
      (1 - cw) / 2 / a0, (1 - cw) / a0, (1 - cw) / 2 / a0,
      (-2 * cw) / a0, (1 - alpha) / a0
    );
  }

  static highpass(fc, fs, q = Math.SQRT1_2) {
    const w = (2 * Math.PI * Math.max(fc, 1e-4)) / fs;
    const cw = Math.cos(w), sw = Math.sin(w), alpha = sw / (2 * q);
    const a0 = 1 + alpha;
    return new Biquad(
      (1 + cw) / 2 / a0, -(1 + cw) / a0, (1 + cw) / 2 / a0,
      (-2 * cw) / a0, (1 - alpha) / a0
    );
  }

  apply(x) {
    const y = new Float64Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = this.b0 * x[i] + this.b1 * x1 + this.b2 * x2 - this.a1 * y1 - this.a2 * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
      y[i] = v;
    }
    return y;
  }

  /** Forward-backward: zero phase lag, so impacts stay aligned to GPS positions. */
  filtfilt(x) {
    const fwd = this.apply(x);
    const rev = this.apply(Float64Array.from(fwd).reverse());
    return Float64Array.from(rev).reverse();
  }
}

/*
 * Band edges are narrower than the native app's because the browser samples at
 * ~60 Hz, not 100 Hz. Nyquist is 30 Hz, and anything within a few Hz of Nyquist
 * is unreliable, so the working band stops at 25 Hz and chatter at 25 Hz too.
 */
const BANDS = {
  work:    { hp: 0.5, lp: 25 },
  body:    { hp: 0.5, lp: 8 },
  chatter: { hp: 8,   lp: 25 },
};

function bandpass(x, fs, band) {
  const hp = Biquad.highpass(band.hp, fs).filtfilt(x);
  return Biquad.lowpass(Math.min(band.lp, fs * 0.4), fs).filtfilt(hp);
}

/* ---------------------------------------------------------------- metrics */

const IMPACT_THRESHOLD_G = 1.5;
const IMPACT_REFRACTORY = 0.15; // s

/**
 * @param {Float64Array} aVertG  vertical acceleration in g, up positive
 * @param {Uint8Array}   clip    1 where the sensor saturated
 * @param {number} fs            effective sample rate, Hz
 * @param {number} distance      metres covered by this slice
 */
function computeMetrics(aVertG, clip, fs, distance) {
  const m = {
    duration: 0, distance, meanSpeed: 0, rms: 0, vdv: 0, p95: 0, peak: 0,
    crest: 0, impactsPerKm: 0, body: 0, chatter: 0, energyPerMetre: 0,
    clippedFraction: 0, samples: aVertG.length,
  };
  if (aVertG.length < 8) return m;

  const dt = 1 / fs;
  m.duration = aVertG.length * dt;
  m.meanSpeed = m.duration > 0 ? distance / m.duration : 0;

  let clipped = 0;
  for (let i = 0; i < clip.length; i++) if (clip[i]) clipped++;
  m.clippedFraction = clipped / aVertG.length;

  const raw = new Float64Array(aVertG.length);
  for (let i = 0; i < aVertG.length; i++) raw[i] = aVertG[i] * G;

  const a = bandpass(raw, fs, BANDS.work);

  let sum2 = 0, sum4 = 0, peak = 0;
  for (let i = 0; i < a.length; i++) {
    const s = a[i] * a[i];
    sum2 += s;
    sum4 += s * s;
    const abs = Math.abs(a[i]);
    if (abs > peak) peak = abs;
  }
  m.rms = Math.sqrt(sum2 / a.length);
  m.vdv = Math.pow(sum4 * dt, 0.25);
  m.peak = peak;
  m.crest = m.rms > 0 ? peak / m.rms : 0;

  const sorted = Array.from(a, Math.abs).sort((p, q) => p - q);
  m.p95 = sorted[Math.floor((sorted.length - 1) * 0.95)];

  m.body = rms(bandpass(raw, fs, BANDS.body));
  m.chatter = rms(bandpass(raw, fs, BANDS.chatter));

  // Roughness density. Far less speed-sensitive than RMS, so this is the
  // number to compare across runs.
  m.energyPerMetre = distance > 1 ? (sum2 * dt) / distance : 0;

  const thr = IMPACT_THRESHOLD_G * G;
  let count = 0, blockedUntil = -1;
  for (let i = 0; i < a.length; i++) {
    const t = i * dt;
    if (t < blockedUntil) continue;
    if (Math.abs(a[i]) > thr) { count++; blockedUntil = t + IMPACT_REFRACTORY; }
  }
  m.impactsPerKm = distance > 1 ? count / (distance / 1000) : 0;

  return m;
}

function rms(x) {
  if (!x.length) return 0;
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / x.length);
}

/**
 * Effective rate from the recorded timestamps. Never trust the nominal 60 Hz —
 * Safari throttles when the tab loses focus, when the battery is low, and
 * whenever it feels like it.
 */
function effectiveRate(t) {
  if (t.length < 2) return 60;
  const span = t[t.length - 1] - t[0];
  return span > 0 ? (t.length - 1) / span : 60;
}

/* --------------------------------------------------------------- geometry */

const EARTH_R = 6371000;
const mPerDegLat = () => (EARTH_R * Math.PI) / 180;
const mPerDegLon = (lat) => (EARTH_R * Math.PI / 180) * Math.cos((lat * Math.PI) / 180);

function projectFix(fix, originLat, originLon) {
  return {
    x: (fix.lon - originLon) * mPerDegLon(originLat),
    y: (fix.lat - originLat) * mPerDegLat(),
  };
}

function fixDistance(a, b) {
  const dx = (b.lon - a.lon) * mPerDegLon(a.lat);
  const dy = (b.lat - a.lat) * mPerDegLat();
  return Math.sqrt(dx * dx + dy * dy);
}

function cumulativeDistance(fixes) {
  const out = [0];
  for (let i = 1; i < fixes.length; i++) {
    const good = fixes[i].acc > 0 && fixes[i].acc < 25;
    out.push(out[i - 1] + (good ? fixDistance(fixes[i - 1], fixes[i]) : 0));
  }
  return out;
}

/* ------------------------------------------------------ chainage matching */

/**
 * Maps any run onto a reference run's distance axis by projecting each GPS fix
 * onto the reference polyline. Tolerates different start points, different
 * lines through corners, and different speeds.
 */
class ChainageMatcher {
  constructor(reference) {
    const gps = reference.gps;
    if (!gps || gps.length < 3) throw new Error('Reference run has too few GPS fixes');
    this.originLat = gps[0].lat;
    this.originLon = gps[0].lon;
    this.chain = cumulativeDistance(gps);
    this.pts = gps.map((f) => projectFix(f, this.originLat, this.originLon));
    this.gpsRef = gps;
    this.totalLength = this.chain[this.chain.length - 1];
  }

  /** Nearest point on the reference polyline: chainage in metres, plus the
   *  perpendicular offset so off-track fixes can be rejected. */
  chainageFor(fix) {
    const p = projectFix(fix, this.originLat, this.originLon);
    let bestD2 = Infinity, bestChain = 0;

    for (let i = 0; i < this.pts.length - 1; i++) {
      const a = this.pts[i], b = this.pts[i + 1];
      const vx = b.x - a.x, vy = b.y - a.y;
      const len2 = vx * vx + vy * vy;
      let t = 0;
      if (len2 > 1e-9) {
        t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
        t = Math.min(Math.max(t, 0), 1);
      }
      const dx = p.x - (a.x + t * vx), dy = p.y - (a.y + t * vy);
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestChain = this.chain[i] + t * (this.chain[i + 1] - this.chain[i]);
      }
    }
    return { chainage: bestChain, offset: Math.sqrt(bestD2) };
  }

  /** Latitude/longitude at a given chainage along the reference track. */
  pointAt(chainage) {
    const c = this.chain;
    if (chainage <= 0) return { lat: this.gpsRef[0].lat, lon: this.gpsRef[0].lon };
    for (let i = 0; i < c.length - 1; i++) {
      if (chainage <= c[i + 1]) {
        const span = c[i + 1] - c[i];
        const f = span > 1e-9 ? (chainage - c[i]) / span : 0;
        const a = this.gpsRef[i], b = this.gpsRef[i + 1];
        return { lat: a.lat + f * (b.lat - a.lat), lon: a.lon + f * (b.lon - a.lon) };
      }
    }
    const last = this.gpsRef[this.gpsRef.length - 1];
    return { lat: last.lat, lon: last.lon };
  }

  /** Per-sample chainage, interpolated between GPS fixes. null where unknown. */
  chainagePerSample(run, maxOffset = 30) {
    const knots = [];
    for (const fix of run.gps) {
      if (!(fix.acc > 0 && fix.acc < 25)) continue;
      const r = this.chainageFor(fix);
      if (r.offset > maxOffset) continue;
      knots.push({ t: fix.t, c: r.chainage });
    }

    const t = run.motion.t;
    const out = new Array(t.length).fill(null);
    if (knots.length < 2) return out;

    let k = 0;
    for (let i = 0; i < t.length; i++) {
      while (k < knots.length - 2 && knots[k + 1].t < t[i]) k++;
      const a = knots[k], b = knots[k + 1];
      if (t[i] < a.t - 1 || t[i] > b.t + 1 || b.t <= a.t) continue;
      out[i] = a.c + ((t[i] - a.t) / (b.t - a.t)) * (b.c - a.c);
    }
    return out;
  }
}

/* -------------------------------------------------------------- profiling */

/**
 * Reduce a run to fixed-length bins along the reference chainage axis.
 * 10 m is a floor, not a preference: it needs to exceed the horizontal GPS
 * error you get under tree cover.
 */
function profile(run, matcher, binLength = 10) {
  const chain = matcher.chainagePerSample(run);
  const fs = effectiveRate(run.motion.t);
  const nBins = Math.max(1, Math.ceil(matcher.totalLength / binLength));

  const buckets = Array.from({ length: nBins }, () => ({ a: [], c: [] }));
  for (let i = 0; i < chain.length; i++) {
    if (chain[i] === null || chain[i] < 0) continue;
    const b = Math.min(nBins - 1, Math.floor(chain[i] / binLength));
    buckets[b].a.push(run.motion.aVert[i]);
    buckets[b].c.push(run.motion.clip[i]);
  }

  const bins = [];
  buckets.forEach((bucket, idx) => {
    if (bucket.a.length < 8) return;
    const centre = matcher.pointAt(idx * binLength + binLength / 2);
    bins.push({
      index: idx,
      startMetre: idx * binLength,
      lat: centre.lat,
      lon: centre.lon,
      metrics: computeMetrics(
        Float64Array.from(bucket.a), Uint8Array.from(bucket.c), fs, binLength
      ),
    });
  });
  return bins;
}

/**
 * Per-sample vertical acceleration against distance, for the distance/g frame.
 * Decimated to `maxPoints` by taking the min and max of each block, so peaks
 * survive the thinning instead of being averaged away.
 */
function distanceSeries(run, maxPoints = 900) {
  let matcher;
  try { matcher = new ChainageMatcher(run); } catch { return null; }

  const chain = matcher.chainagePerSample(run);
  const fs = effectiveRate(run.motion.t);
  const raw = Float64Array.from(run.motion.aVert, (v) => v * G);
  const filtered = bandpass(raw, fs, BANDS.work);

  const pts = [];
  for (let i = 0; i < chain.length; i++) {
    if (chain[i] === null) continue;
    pts.push([chain[i], filtered[i] / G]);
  }
  if (!pts.length) return null;
  pts.sort((a, b) => a[0] - b[0]);

  const step = Math.max(1, Math.ceil(pts.length / maxPoints));
  const out = [];
  for (let i = 0; i < pts.length; i += step) {
    let lo = Infinity, hi = -Infinity;
    for (let j = i; j < Math.min(i + step, pts.length); j++) {
      if (pts[j][1] < lo) lo = pts[j][1];
      if (pts[j][1] > hi) hi = pts[j][1];
    }
    out.push({ d: pts[i][0], lo, hi });
  }
  return { points: out, totalLength: matcher.totalLength, matcher };
}

function summarise(run) {
  const fs = effectiveRate(run.motion.t);
  const dist = run.gps && run.gps.length > 1
    ? cumulativeDistance(run.gps).slice(-1)[0]
    : 0;
  return computeMetrics(
    Float64Array.from(run.motion.aVert),
    Uint8Array.from(run.motion.clip),
    fs, dist
  );
}

/* ------------------------------------------------------------ comparison */

function compareRuns(reference, other, binLength = 10) {
  const matcher = new ChainageMatcher(reference);
  const refBins = profile(reference, matcher, binLength);
  const othBins = profile(other, matcher, binLength);

  const byIndex = new Map(othBins.map((b) => [b.index, b.metrics]));

  return refBins.flatMap((rb) => {
    const om = byIndex.get(rb.index);
    if (!om) return [];
    const e = rb.metrics.energyPerMetre;
    const s = rb.metrics.meanSpeed;
    return [{
      index: rb.index,
      startMetre: rb.startMetre,
      reference: rb.metrics,
      other: om,
      energyDeltaPercent: e > 0 ? ((om.energyPerMetre - e) / e) * 100 : 0,
      speedDeltaPercent: s > 0 ? ((om.meanSpeed - s) / s) * 100 : 0,
    }];
  });
}

/**
 * Sections worth looking at. Run-to-run spread on an identical setup is
 * routinely 10%, so anything under that threshold is noise, not a finding.
 */
function notableSections(comps, thresholdPercent = 15) {
  return comps
    .filter((c) => Math.abs(c.energyDeltaPercent) >= thresholdPercent)
    .sort((a, b) => Math.abs(b.energyDeltaPercent) - Math.abs(a.energyDeltaPercent));
}

window.Analysis = {
  G, Biquad, BANDS, computeMetrics, rms, effectiveRate,
  cumulativeDistance, ChainageMatcher, profile, summarise, distanceSeries,
  compareRuns, notableSections,
};
