/*
 * trails.js — works out which runs are the same trail, and what a stack of
 * runs on that trail collectively says.
 *
 * The single most useful output here is not the average. It's the spread.
 * With two runs you can measure a difference; with five you can find out
 * whether that difference is bigger than your own inconsistency, which is the
 * only thing that makes it a finding rather than a number.
 */

const TRAIL_DEFAULTS = {
  tolerance: 25,        // m; how far off the reference line still counts as on it
  minCoverage: 0.75,    // fraction of fixes that must be within tolerance
  lengthRatio: 0.6,     // shorter/longer track length must exceed this
};

/**
 * How much of run B lies on run A's line.
 * Asymmetric on purpose — a short run inside a long one scores high one way
 * and low the other, which is exactly the distinction we want.
 */
function coverage(matcherA, runB, tolerance) {
  const fixes = runB.gps.filter((f) => f.acc > 0 && f.acc < 30);
  if (fixes.length < 3) return 0;
  let on = 0;
  for (const f of fixes) {
    if (matcherA.chainageFor(f).offset <= tolerance) on++;
  }
  return on / fixes.length;
}

function trackLength(run) {
  if (!run.gps || run.gps.length < 2) return 0;
  return window.Analysis.cumulativeDistance(run.gps).slice(-1)[0];
}

/**
 * Group runs into trails.
 *
 * A run carrying an explicit `trail` field wins over the geometry — clustering
 * is a guess, and a guess should never override something you stated.
 *
 * Clustering is single-linkage, which means two distinct trails sharing a long
 * fire road can merge into one. The coverage threshold is set high to make
 * that unlikely, but if it happens, name the runs explicitly rather than
 * fighting the thresholds.
 */
function groupTrails(runs, opts = {}) {
  const o = { ...TRAIL_DEFAULTS, ...opts };
  const usable = runs.filter((r) => r.gps && r.gps.length >= 3);

  const parent = usable.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a, b) => { parent[find(a)] = find(b); };

  const matchers = usable.map((r) => {
    try { return new window.Analysis.ChainageMatcher(r); } catch { return null; }
  });
  const lengths = usable.map(trackLength);

  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      // Explicit labels short-circuit the geometry in both directions.
      if (usable[i].trail && usable[j].trail) {
        if (usable[i].trail === usable[j].trail) union(i, j);
        continue;
      }
      if (!matchers[i] || !matchers[j]) continue;

      const ratio = Math.min(lengths[i], lengths[j]) / Math.max(lengths[i], lengths[j], 1);
      if (ratio < o.lengthRatio) continue;

      const cij = coverage(matchers[i], usable[j], o.tolerance);
      if (cij < o.minCoverage) continue;
      const cji = coverage(matchers[j], usable[i], o.tolerance);
      if (cji < o.minCoverage) continue;

      union(i, j);
    }
  }

  const groups = new Map();
  usable.forEach((run, i) => {
    const key = find(i);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ run, length: lengths[i] });
  });

  return Array.from(groups.values()).map((members) => {
    // The reference should be the run with the best geometry, not the first
    // one recorded: most fixes, tie-broken on median accuracy.
    const ranked = members.slice().sort((a, b) => {
      const d = b.run.gps.length - a.run.gps.length;
      return d !== 0 ? d : medianAcc(a.run) - medianAcc(b.run);
    });
    const reference = ranked[0].run;
    const explicit = members.find((m) => m.run.trail);

    return {
      id: reference.id,
      name: explicit ? explicit.run.trail : trailNameFrom(members.map((m) => m.run)),
      referenceId: reference.id,
      runIds: members
        .slice()
        .sort((a, b) => (a.run.startedAt < b.run.startedAt ? -1 : 1))
        .map((m) => m.run.id),
      length: Math.round(ranked[0].length),
      drop: reference.descent ? reference.descent.drop : null,
    };
  }).sort((a, b) => b.runIds.length - a.runIds.length);
}

function medianAcc(run) {
  const a = run.gps.map((f) => f.acc).filter((v) => v > 0).sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : 999;
}

/** Longest shared prefix of the run names, falling back to the first name. */
function trailNameFrom(runs) {
  const names = runs.map((r) => (r.name || '').replace(/\s*—\s*run\s*\d+\s*$/i, '').trim());
  let prefix = names[0] || 'Unnamed trail';
  for (const n of names.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < n.length && prefix[i] === n[i]) i++;
    prefix = prefix.slice(0, i);
  }
  prefix = prefix.replace(/[\s\-—:]+$/, '').trim();
  return prefix.length >= 3 ? prefix : (names[0] || 'Unnamed trail');
}

/* ------------------------------------------------- multi-run aggregation */

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (i - lo) * (sorted[hi] - sorted[lo]);
}

/**
 * Per-bin statistics across several runs of one trail, on the reference's
 * distance axis.
 *
 * Each bin gets a median and an interquartile band. The band is the point:
 * a bin where every run agrees is a property of the trail, and a bin where
 * they scatter is a property of how you ride it.
 */
function aggregateProfile(runs, reference, binLength = 10) {
  const matcher = new window.Analysis.ChainageMatcher(reference);
  const perRun = runs.map((run) => ({
    run,
    bins: window.Analysis.profile(run, matcher, binLength),
  }));

  const byIndex = new Map();
  for (const { run, bins } of perRun) {
    for (const b of bins) {
      if (!byIndex.has(b.index)) {
        byIndex.set(b.index, { index: b.index, startMetre: b.startMetre,
                               lat: b.lat, lon: b.lon, values: [], speeds: [],
                               clipped: false, runIds: [] });
      }
      const slot = byIndex.get(b.index);
      slot.values.push(b.metrics.energyPerMetre);
      slot.speeds.push(b.metrics.meanSpeed);
      slot.runIds.push(run.id);
      if (b.metrics.clippedFraction > 0.001) slot.clipped = true;
    }
  }

  const bins = Array.from(byIndex.values())
    .filter((s) => s.values.length >= 2)
    .sort((a, b) => a.index - b.index)
    .map((s) => {
      const sorted = s.values.slice().sort((a, b) => a - b);
      const median = percentile(sorted, 0.5);
      const p25 = percentile(sorted, 0.25);
      const p75 = percentile(sorted, 0.75);
      const mean = s.values.reduce((a, b) => a + b, 0) / s.values.length;
      const sd = Math.sqrt(
        s.values.reduce((a, v) => a + (v - mean) ** 2, 0) / s.values.length
      );
      return {
        index: s.index, startMetre: s.startMetre, lat: s.lat, lon: s.lon,
        n: s.values.length, median, p25, p75,
        cv: mean > 0 ? sd / mean : 0,
        meanSpeed: s.speeds.reduce((a, b) => a + b, 0) / s.speeds.length,
        clipped: s.clipped,
      };
    });

  return { matcher, bins, perRun };
}

/**
 * Run-to-run spread: the smallest difference that means anything.
 *
 * Computed over the bins every selected run covers, so a run that only made it
 * halfway down can't distort it. Returned as a percentage — a change smaller
 * than this is indistinguishable from riding the trail twice.
 */
function noiseFloor(aggregate) {
  const common = aggregate.bins.filter((b) => b.n === aggregate.perRun.length);
  if (common.length < 5 || aggregate.perRun.length < 2) return null;

  const totals = aggregate.perRun.map(({ run, bins }) => {
    const byIndex = new Map(bins.map((b) => [b.index, b.metrics.energyPerMetre]));
    const vals = common.map((c) => byIndex.get(c.index)).filter((v) => v !== undefined);
    return {
      id: run.id,
      name: run.name,
      startedAt: run.startedAt,
      energy: vals.reduce((a, b) => a + b, 0) / Math.max(vals.length, 1),
    };
  });

  const mean = totals.reduce((a, t) => a + t.energy, 0) / totals.length;
  const sd = Math.sqrt(
    totals.reduce((a, t) => a + (t.energy - mean) ** 2, 0) / totals.length
  );

  const cvs = common.map((b) => b.cv).sort((a, b) => a - b);

  return {
    runs: totals.length,
    bins: common.length,
    meanEnergy: mean,
    spreadPercent: mean > 0 ? (sd / mean) * 100 : 0,
    medianBinCV: percentile(cvs, 0.5) * 100,
    perRun: totals.map((t) => ({
      ...t,
      deltaPercent: mean > 0 ? ((t.energy - mean) / mean) * 100 : 0,
    })),
  };
}

/**
 * Bins that are consistently rough across every run — high median, low
 * scatter. These are features of the trail rather than of a given run, and
 * they're the ones worth doing something about.
 */
function consistentFeatures(aggregate, { minRuns = 3, maxCV = 0.35, topN = 8 } = {}) {
  const eligible = aggregate.bins.filter((b) => b.n >= Math.min(minRuns, aggregate.perRun.length));
  if (!eligible.length) return [];
  const medians = eligible.map((b) => b.median).sort((a, b) => a - b);
  // Two cutoffs, not one. A relative cutoff alone lets near-flat bins through
  // whenever the distribution is skewed — on a mostly-smooth trail the 75th
  // percentile can sit at almost nothing. The absolute floor keeps the list to
  // sections that are actually rough.
  const cutoff = Math.max(percentile(medians, 0.75), medians[medians.length - 1] * 0.25);

  return eligible
    .filter((b) => b.median >= cutoff && b.cv <= maxCV)
    .sort((a, b) => b.median - a.median)
    .slice(0, topN);
}

/** The opposite: bins where runs disagree most. Line choice, not terrain. */
function variableSections(aggregate, { topN = 6 } = {}) {
  return aggregate.bins
    .filter((b) => b.n >= Math.min(3, aggregate.perRun.length))
    .slice()
    .sort((a, b) => b.cv - a.cv)
    .slice(0, topN);
}

/**
 * Roughness grouped by bike setup.
 *
 * This is the question the whole app exists to answer: did changing LSC
 * actually make the trail hit me less, or did I just ride it differently?
 *
 * Energy is averaged only over sections every run covers, so a run that
 * stopped halfway cannot drag a group up or down. Each group also reports its
 * own spread where it has more than one run — a group of one has no spread and
 * must be read as a single sample, not a result.
 */
function groupBySetup(aggregate, noise) {
  const B = window.BikeSetup;
  if (!B) return [];

  const common = aggregate.bins.filter((b) => b.n === aggregate.perRun.length);
  if (common.length < 5) return [];
  const commonIdx = new Set(common.map((b) => b.index));

  const groups = new Map();
  for (const { run, bins } of aggregate.perRun) {
    const sig = B.signature(run.setup);
    if (!groups.has(sig)) groups.set(sig, { signature: sig, setup: run.setup, runs: [] });
    const vals = bins.filter((b) => commonIdx.has(b.index))
                     .map((b) => b.metrics.energyPerMetre);
    if (!vals.length) continue;
    groups.get(sig).runs.push({
      id: run.id,
      startedAt: run.startedAt,
      energy: vals.reduce((a, b) => a + b, 0) / vals.length,
    });
  }

  const out = Array.from(groups.values())
    .filter((g) => g.runs.length)
    .map((g) => {
      const e = g.runs.map((r) => r.energy);
      const mean = e.reduce((a, b) => a + b, 0) / e.length;
      const sd = e.length > 1
        ? Math.sqrt(e.reduce((a, v) => a + (v - mean) ** 2, 0) / e.length) : 0;
      const sorted = e.slice().sort((a, b) => a - b);
      return {
        ...g,
        n: g.runs.length,
        median: percentile(sorted, 0.5),
        mean,
        spreadPercent: mean > 0 ? (sd / mean) * 100 : 0,
        thin: g.runs.length < 2,
      };
    })
    .sort((a, b) => a.median - b.median);

  // Difference from the smoothest group, and whether it clears the noise floor.
  const best = out[0];
  const floor = noise ? noise.spreadPercent : null;
  for (const g of out) {
    g.deltaPercent = best.median > 0
      ? ((g.median - best.median) / best.median) * 100 : 0;
    g.meaningful = floor === null ? null : Math.abs(g.deltaPercent) > floor;
  }
  return out;
}

window.Trails = {
  TRAIL_DEFAULTS, groupTrails, coverage, trackLength,
  aggregateProfile, noiseFloor, consistentFeatures, variableSections, percentile,
  groupBySetup,
};
