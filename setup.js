/*
 * setup.js — the bike configuration a session was ridden with.
 *
 * This replaced a free-text notes field, for one reason: text cannot be
 * compared. "26 psi, 3 clicks" and "26psi 3cl" are the same setup to you and
 * two different strings to the app, so it could never tell you which runs are
 * actually comparable. Structured fields can.
 *
 * The field that matters most is not a suspension setting. It's the mount.
 * Bar, stem, seatpost and frame transmit completely different signals, and a
 * rubber phone clamp is a mechanical low-pass filter. Two runs on different
 * mounts are not comparable at all, no matter how identical everything else
 * is. Change a fork click and you're measuring a fork click; change the mount
 * and you're measuring the mount.
 */

const PSI_PER_BAR = 14.503773773;

/*
 * Mount location. Split finer than "frame" because the top tube, down tube and
 * chainstay see genuinely different signals — the chainstay is behind the rear
 * suspension, the top tube in front of it.
 */
const MOUNTS = ['handlebar', 'stem', 'topTube', 'downTube', 'chainstay',
                'seatpost', 'backpack'];

/*
 * How it is fixed on. This matters as much as where.
 *
 * A zip-tied phone on thin dense padding is close to rigid, and transmits
 * almost everything the frame does. The same phone on thick soft foam is a
 * mass on a spring — and a 143 g iPhone 6s on soft foam resonates somewhere in
 * the tens of hertz, which lands inside the band being measured. That does not
 * add noise you can filter out; it adds a peak that looks like trail chatter.
 *
 * Fixing method is therefore treated as blocking, the same as location. Two
 * runs are not comparable across a change of either.
 */
const FIXINGS = ['zipTies', 'clamp', 'strap', 'adhesive', 'tape'];

/**
 * group: 'core' is always shown; 'fork', 'shock' and 'extra' collapse behind
 * disclosures, because nobody wants to scroll fourteen inputs at a trailhead
 * with cold hands.
 *
 * Damping adjusters are recorded as clicks from fully closed, which is how
 * they are marked and how you will actually count them. The app never
 * interprets them — it only needs to know whether two runs used the same
 * number.
 */
const FIELDS = [
  { key: 'bike',          type: 'text',     group: 'core' },
  { key: 'mount',         type: 'select',   group: 'core', options: MOUNTS, required: true },
  { key: 'mountFixing',   type: 'select',   group: 'core', options: FIXINGS, required: true },
  { key: 'tyreFront',     type: 'pressure', group: 'core' },
  { key: 'tyreRear',      type: 'pressure', group: 'core' },

  // Fork: air spring plus the four damping adjusters, as marked on the dial.
  { key: 'forkAir',       type: 'pressure', group: 'fork' },
  { key: 'forkLSR',       type: 'clicks',   group: 'fork' },
  { key: 'forkHSR',       type: 'clicks',   group: 'fork' },
  { key: 'forkLSC',       type: 'clicks',   group: 'fork' },
  { key: 'forkHSC',       type: 'clicks',   group: 'fork' },
  { key: 'forkTokens',    type: 'clicks',   group: 'fork' },

  { key: 'shockAir',      type: 'pressure', group: 'shock' },
  { key: 'shockLSR',      type: 'clicks',   group: 'shock' },
  { key: 'shockHSR',      type: 'clicks',   group: 'shock' },
  { key: 'shockLSC',      type: 'clicks',   group: 'shock' },
  { key: 'shockHSC',      type: 'clicks',   group: 'shock' },
  { key: 'shockTokens',   type: 'clicks',   group: 'shock' },

  { key: 'note',          type: 'text',     group: 'extra' },
];

/**
 * Fields that invalidate a comparison outright if they differ, versus fields
 * that are the thing you are deliberately testing.
 */
const BLOCKING = ['mount', 'mountFixing', 'bike'];

const LS_LAST = 'mtbbump.setup.last';
const LS_PRESETS = 'mtbbump.setup.presets';
const LS_UNITS = 'mtbbump.setup.units';

const BikeSetup = {
  FIELDS, MOUNTS, FIXINGS, BLOCKING,

  /* ---- units ---- */

  /**
   * psi or bar. German-speaking riders overwhelmingly use bar, so the default
   * follows the language rather than making everyone find a setting.
   */
  get units() {
    const saved = localStorage.getItem(LS_UNITS);
    if (saved) return saved;
    return (window.I18n && window.I18n.lang === 'de') ? 'bar' : 'psi';
  },

  setUnits(u) { localStorage.setItem(LS_UNITS, u); },

  /** Pressures are stored in psi always; the unit is a display concern. */
  toDisplay(psi) {
    if (psi === null || psi === undefined || psi === '') return '';
    return this.units === 'bar' ? psi / PSI_PER_BAR : psi;
  },

  fromDisplay(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = parseFloat(value);
    if (Number.isNaN(n)) return null;
    return this.units === 'bar' ? n * PSI_PER_BAR : n;
  },

  formatPressure(psi) {
    if (psi === null || psi === undefined) return '—';
    const v = this.toDisplay(psi);
    const digits = this.units === 'bar' ? 2 : 0;
    const n = window.I18n ? window.I18n.num(v, digits) : v.toFixed(digits);
    return n + ' ' + this.units;
  },

  /* ---- persistence ---- */

  /**
   * The setup from the last session, used to prefill the next one. You rarely
   * change more than one thing between rides, and retyping eight fields at a
   * trailhead is how a feature gets abandoned.
   */
  last() {
    try { return JSON.parse(localStorage.getItem(LS_LAST)) || this.blank(); }
    catch { return this.blank(); }
  },

  saveLast(setup) { localStorage.setItem(LS_LAST, JSON.stringify(setup)); },

  blank() {
    const s = {};
    for (const f of FIELDS) s[f.key] = f.type === 'text' ? '' : null;
    s.mount = 'topTube';
    s.mountFixing = 'zipTies';
    return s;
  },

  presets() {
    try { return JSON.parse(localStorage.getItem(LS_PRESETS)) || []; }
    catch { return []; }
  },

  savePreset(name, setup) {
    if (!name || !name.trim()) throw new Error('Preset needs a name.');
    const list = this.presets().filter((p) => p.name !== name.trim());
    list.push({ name: name.trim(), setup: { ...setup }, savedAt: new Date().toISOString() });
    localStorage.setItem(LS_PRESETS, JSON.stringify(list));
    return list;
  },

  deletePreset(name) {
    const list = this.presets().filter((p) => p.name !== name);
    localStorage.setItem(LS_PRESETS, JSON.stringify(list));
    return list;
  },

  /* ---- validation ---- */

  /** @returns array of field keys that are required and missing */
  validate(setup) {
    return FIELDS.filter((f) => f.required && !setup[f.key]).map((f) => f.key);
  },

  /* ---- comparison ---- */

  /**
   * Which fields differ across a group of setups.
   *
   * @returns { blocking: [keys], changed: [keys], identical: bool }
   *   blocking — mount or bike differs, so the runs are not comparable
   *   changed  — suspension or tyre values differ, which is usually the point
   */
  diff(setups) {
    const present = setups.filter(Boolean);
    if (present.length < 2) return { blocking: [], changed: [], identical: true };

    const differing = [];
    for (const f of FIELDS) {
      if (f.key === 'note') continue;
      const first = normalise(present[0][f.key]);
      if (present.some((s) => normalise(s[f.key]) !== first)) differing.push(f.key);
    }

    return {
      blocking: differing.filter((k) => BLOCKING.includes(k)),
      changed: differing.filter((k) => !BLOCKING.includes(k)),
      identical: differing.length === 0,
    };
  },

  /** One-line summary for a run list. */
  summary(setup) {
    if (!setup) return '';
    const bits = [];
    if (setup.bike) bits.push(setup.bike);
    if (setup.mount) {
      let m = this.label('mount.' + setup.mount);
      if (setup.mountFixing) m += ' (' + this.label('fixing.' + setup.mountFixing) + ')';
      bits.push(m);
    }
    if (setup.tyreFront !== null && setup.tyreFront !== undefined) {
      const r = setup.tyreRear !== null && setup.tyreRear !== undefined
        && setup.tyreRear !== setup.tyreFront;
      bits.push(this.formatPressure(setup.tyreFront) +
                (r ? ' / ' + this.formatPressure(setup.tyreRear) : ''));
    }
    return bits.join(' · ');
  },

  /** Human value of one field, for the diff table. */
  display(setup, key) {
    if (!setup) return '—';
    const f = FIELDS.find((x) => x.key === key);
    const v = setup[key];
    if (v === null || v === undefined || v === '') return '—';
    if (!f) return String(v);
    if (f.type === 'pressure') return this.formatPressure(v);
    if (f.type === 'select') {
      return this.label((key === 'mountFixing' ? 'fixing.' : 'mount.') + v);
    }
    if (f.type === 'clicks') return window.I18n ? window.I18n.int(v) : String(v);
    return String(v);
  },

  label(key) {
    return window.I18n ? window.I18n.t('setup.' + key) : key;
  },
};

/**
 * History of mount checks, keyed by the configuration they were taken on.
 * A check only means something compared to other checks of the same mount in
 * the same place with the same fixing.
 */
const LS_MOUNT = 'mtbbump.mountChecks';

BikeSetup.mountKey = function (setup) {
  if (!setup) return 'unknown';
  return [setup.bike || '', setup.mount || '', setup.mountFixing || ''].join('|');
};

BikeSetup.mountHistory = function (setup) {
  let all;
  try { all = JSON.parse(localStorage.getItem(LS_MOUNT)) || {}; }
  catch { all = {}; }
  return all[this.mountKey(setup)] || [];
};

BikeSetup.recordMountCheck = function (setup, rms) {
  let all;
  try { all = JSON.parse(localStorage.getItem(LS_MOUNT)) || {}; }
  catch { all = {}; }
  const key = this.mountKey(setup);
  const list = all[key] || [];
  list.push({ at: new Date().toISOString(), rms: Math.round(rms * 100) / 100 });
  // Keep the last 20; the baseline is a minimum, not a rolling average.
  all[key] = list.slice(-20);
  localStorage.setItem(LS_MOUNT, JSON.stringify(all));
  return all[key];
};

/**
 * Verdict for a fresh check.
 *
 * The reference is the lowest reading ever taken on this configuration,
 * because that is the mount done up properly. An average would drift upward
 * with the ties and slowly redefine "loose" as normal.
 *
 * The 60% threshold is a starting point, not a measurement. Watch what your
 * own checks scatter by across a few rides and tighten or loosen it.
 */
BikeSetup.mountVerdict = function (setup, rms) {
  const history = this.mountHistory(setup);
  if (history.length < 2) return { state: 'first', baseline: null };
  const baseline = Math.min.apply(null, history.map((h) => h.rms));
  if (baseline <= 0) return { state: 'first', baseline: null };
  const ratio = rms / baseline;
  return {
    state: ratio > 1.6 ? 'drift' : 'good',
    baseline,
    ratio,
  };
};

/**
 * A stable key for "this exact configuration", used to group runs that were
 * ridden on the same setup. Notes are excluded: a typo in a comment should not
 * split a group.
 */
BikeSetup.signature = function (setup) {
  if (!setup) return 'none';
  return FIELDS.filter((f) => f.key !== 'note')
    .map((f) => f.key + '=' + (normalise(setup[f.key]) === null ? '' : normalise(setup[f.key])))
    .join(';');
};

/**
 * Describe a setup by only the fields that differ from a reference — so a
 * group reads "LSC 2, air 85 psi" rather than repeating fourteen values that
 * were the same in every run.
 */
BikeSetup.describeFields = function (setup, keys) {
  if (!setup) return '—';
  if (!keys || !keys.length) return this.summary(setup) || '—';
  return keys.map((k) => this.label(k) + ' ' + this.display(setup, k)).join(', ');
};

BikeSetup.describeDifference = function (setup, reference) {
  if (!setup) return '—';
  if (!reference) return this.summary(setup);
  const bits = [];
  for (const f of FIELDS) {
    if (f.key === 'note') continue;
    if (normalise(setup[f.key]) === normalise(reference[f.key])) continue;
    bits.push(this.label(f.key) + ' ' + this.display(setup, f.key));
  }
  return bits.length ? bits.join(', ') : this.label('diff.baseline');
};

function normalise(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Math.round(v * 100) / 100;
  return String(v).trim().toLowerCase();
}

window.BikeSetup = BikeSetup;
