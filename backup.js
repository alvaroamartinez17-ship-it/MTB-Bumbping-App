/*
 * backup.js — getting runs off the phone, on purpose, one deliberate action at
 * a time.
 *
 * There is no automatic upload anywhere. Nothing leaves the device unless you
 * tap export and choose where the file goes.
 */

/**
 * Trim the first and last N metres of a track.
 *
 * Rides start and end somewhere real — usually a house or a regular parking
 * spot. Anyone holding the file can read that straight off the coordinates.
 * Trimming the ends costs a little data at the top and bottom of the descent
 * and removes the most identifying part of the track.
 *
 * This is not anonymisation. A trail you ride repeatedly is itself
 * identifying, and trimming 150 m off a track that starts at your gate still
 * points at your neighbourhood. Treat it as reducing obvious exposure, not as
 * making the file safe to publish.
 */
function trimEnds(run, metres) {
  if (!metres || !run.gps || run.gps.length < 4) return run;

  const cum = window.Analysis.cumulativeDistance(run.gps);
  const total = cum[cum.length - 1];
  if (total < metres * 3) return run;   // too short to trim meaningfully

  const keep = run.gps.filter((f, i) => cum[i] >= metres && cum[i] <= total - metres);
  if (keep.length < 3) return run;

  const from = keep[0].t, to = keep[keep.length - 1].t;
  const idx = [];
  run.motion.t.forEach((t, i) => { if (t >= from && t <= to) idx.push(i); });

  return {
    ...run,
    gps: keep.map((f) => ({ ...f, t: Math.round((f.t - from) * 1000) / 1000 })),
    motion: {
      t: idx.map((i) => Math.round((run.motion.t[i] - from) * 10000) / 10000),
      aVert: idx.map((i) => run.motion.aVert[i]),
      clip: idx.map((i) => run.motion.clip[i]),
    },
    trimmedMetres: metres,
  };
}

function saveFile(name, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function stamp() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
         '-' + String(d.getDate()).padStart(2, '0');
}

/**
 * @param {object} opts
 *   passphrase  encrypt with this; omit for a plain file
 *   trimMetres  strip this much from each end of every track
 *   ids         export only these runs; omit for all
 */
async function exportAll(opts = {}) {
  let runs = await window.Store.all();
  if (opts.ids) runs = runs.filter((r) => opts.ids.includes(r.id));
  if (!runs.length) throw new Error('Nothing to export.');

  const payload = {
    format: 'mtbbump-runs',
    version: 1,
    exportedAt: new Date().toISOString(),
    trimmedMetres: opts.trimMetres || 0,
    runs: runs.map((r) => trimEnds(stripLocalFields(r), opts.trimMetres)),
  };

  if (opts.passphrase) {
    const env = await window.Crypto.encryptJSON(payload, opts.passphrase);
    saveFile(`mtbbump-${stamp()}.enc.json`, JSON.stringify(env));
    return { count: runs.length, encrypted: true };
  }

  saveFile(`mtbbump-${stamp()}.json`, JSON.stringify(payload));
  return { count: runs.length, encrypted: false };
}

/**
 * Strip bookkeeping that only meant something on the device that wrote it.
 * `synced` is a leftover from the version that pushed runs to a repo; runs no
 * longer carry it, but a backup restored from that era still might.
 */
function stripLocalFields(run) {
  const { synced, ...rest } = run;
  return rest;
}

async function importFile(file, passphrase) {
  const text = await file.text();
  let payload;
  try { payload = JSON.parse(text); }
  catch { throw new Error('That file is not valid JSON.'); }

  if (payload.format === 'mtbbump-encrypted') {
    if (!passphrase) throw new Error('This backup is encrypted — enter the passphrase.');
    payload = await window.Crypto.decryptJSON(payload, passphrase);
  }

  const runs = payload.format === 'mtbbump-runs' ? payload.runs
             : Array.isArray(payload) ? payload
             : payload.motion ? [payload]
             : null;
  if (!runs) throw new Error('No runs found in that file.');

  let added = 0, skipped = 0;
  for (const run of runs) {
    if (!run || !run.id || !run.motion || !run.gps) { skipped++; continue; }
    const existing = await window.Store.get(run.id);
    if (existing) { skipped++; continue; }   // never silently overwrite
    await window.Store.put(run);
    added++;
  }
  return { added, skipped };
}

async function wipeAll() {
  const runs = await window.Store.all();
  for (const r of runs) await window.Store.remove(r.id);
  return runs.length;
}

window.Backup = { exportAll, importFile, wipeAll, trimEnds, saveFile };
