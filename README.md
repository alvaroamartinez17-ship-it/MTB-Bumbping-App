# MTB Bumping App — trail roughness logger for iPhone 6s

Start a session at the car park, ride. The app logs vertical acceleration only
while you're descending, splits the session into one run per descent, and holds
them on the phone until you're back on Wi-Fi. Then it syncs to this repo and
you compare runs of the same trail metre-by-metre.

Built for an iPhone 6s with no SIM: the recorder is a service-worker PWA that
opens and records with no network at all.

**Your ride data never leaves the phone.** The repo holds the app; IndexedDB on
the device holds the runs. Backups are files you export deliberately, encrypted
if you want them to be. See §9.

A static web app on GitHub Pages. Records in Safari, stores runs on the device.
No Xcode, no sideloading, no developer account, nothing that expires after
seven days.

---

## 1. What the existing products actually do

Two very different families:

**Suspension telemetry (hardware).** BYB Telemetry, Motion Instruments System 2,
Trailmetry (WitMotion BLE sensors), and the open-source Sufni project all measure
*suspension travel* with linear potentiometers, rotary encoders, induction or LiDAR
sensors, sampled at 500–1000 Hz, with an IMU and GPS alongside. They answer "is my
rebound too slow", not "how rough is this trail". Not what you're building, but
Sufni's repo is a good reference for session storage and the web analysis UI.

**Phone-only.** ShockTune is the closest analogue: a free app that you strap to the
bar or seatpost and that reads the phone's accelerometer to infer forces. The
comment threads on it raise exactly the two objections you'll hit — sensor range
and mounting compliance. Both are manageable if you design around them (§4).

**The most useful prior art is actually road-roughness research**, not MTB.
Roadroid, RoadLab Pro and Road IRI estimate the International Roughness Index from
smartphone accelerometer + GNSS. The published methods converge on the same recipe:

- rigid mount, vertical axis only;
- RMS of vertical acceleration over fixed-length segments (usually 100 m);
- speed correction, because roughness response scales with velocity;
- per-vehicle calibration, because the mass/suspension of the carrier changes the
  transfer function.

There's also a bicycle-specific paper that splits roughness into two indices — a
**Bicycle Roughness Index** for sustained discomfort and a **Faulting Impact Index**
for acute vertical shocks. That split is the right model for MTB: chatter and big
hits are different sensations and should be different numbers. This design copies it.

**Conclusion for us:** don't try to compute a "real" IRI. It requires a calibrated
quarter-car model. Compute a *relative* index that is repeatable for one rider, one
bike, one mount — which is all you need to compare runs of the same trail.

---

## 2. Metrics

All computed on `a_vert`, the acceleration component along the gravity vector, sign
flipped so up is positive. Projecting onto gravity instead of using a fixed device
axis means the mount angle doesn't matter — you can clamp the phone at any tilt.

Band-passed 0.5–40 Hz (zero-phase, so no time lag) before anything else:
below 0.5 Hz is pedalling and terrain grade, above 40 Hz is above the useful band
at 100 Hz sampling.

| Metric | Formula | What it tells you |
|---|---|---|
| `rms` | √(mean(a²)) | overall vibration level, m/s² |
| `vdv` | (∫a⁴dt)^¼ | ISO 2631-style dose; heavily weights big hits |
| `p95`, `peak` | percentiles of \|a\| | worst-case impacts |
| `crest` | peak / rms | is the section chattery or spiky? |
| `impacts_per_km` | count of \|a\| > 1.5 g, 150 ms refractory | discrete hits |
| `chatter` | RMS in 8–30 Hz band (8–25 Hz on web) | buzz, tyre/surface texture |
| `body` | RMS in 0.5–8 Hz band | suspension-scale movement, rollers, drops |
| `energy_per_m` | ∫a²dt / distance | speed-robust roughness density |

**`rms` alone is not comparable between runs at different speeds.** Ride the same
trail 20% faster and every roughness metric goes up. Use `energy_per_m` as the
headline "how rough was this section" number, and keep `rms` for "how rough did it
feel", which legitimately depends on speed. The app reports both plus average speed
per bin so you can see when a difference is just pace.

---

## 3. Comparing runs of the same trail

Time is useless as an x-axis — you never ride a trail at the same speed twice.
Distance from the start drifts if you begin recording at a different point. The
robust approach:

1. Pick one run as the **reference**.
2. For every GPS fix in the other run, find the nearest point on the reference
   polyline and take that point's **chainage** — distance along the reference.
3. Interpolate a chainage for every accelerometer sample from the GPS timestamps.
4. Bin into fixed 10 m buckets of reference chainage.
5. Compare bin by bin.

This tolerates different start points, different lines through corners, and
stops. 10 m bins are a floor, not a preference: the bucket has to be wider than
the horizontal GPS error, which under tree cover is 5–10 m.

### Grouping runs into trails automatically

Runs are matched to each other by track overlap, so you never tell the app which
trail you rode. For a pair of runs, project each of B's fixes onto A's polyline
and measure the fraction landing within 25 m; require that in **both**
directions, plus similar total length. Runs passing both tests are the same
trail, clustered with union-find.

Two caveats. Clustering is single-linkage, so two genuinely different trails
sharing a long fire road can merge — the coverage threshold is set high (75%)
to make that unlikely. And a run carrying an explicit `trail` field always beats
the geometry, because a guess should never override something you stated.

### What several runs give you that two don't

Two runs give a difference. Three or more give **the spread**, which is the only
thing that makes a difference meaningful.

For every 10 m bin the app takes the median across the selected runs plus an
interquartile band, then reports a single headline number: run-to-run spread as
a percentage. Anything smaller than that is you riding the trail twice, not a
change in the trail or the bike. I've been telling you to assume 10%; with a
stack of real runs you get to stop assuming.

The band also separates two things that look identical in a single run:

- **Low scatter, high median** — the trail does this to you every time. A rock
  garden, a set of braking bumps. Worth acting on.
- **High scatter** — the runs disagree. Line choice or speed, not terrain.
  Acting on it would be chasing your own inconsistency.

Both lists are on the analysis page, and the map colours the track by median
roughness so a rough section has a place rather than just a number.

---

## 4. Session model and descent gating

One session per outing. Motion sampling runs the whole time, but samples are
only *kept* while the descent detector says you're going down. Climbing,
pushing and standing around produce nothing.

```
Start session ─┬─► armed ──(descent detected)──► recording ─┐
               │                                            │
               └────────── (flattened or stopped) ◄─────────┘
```

**Detection is from GPS altitude**, because no browser exposes barometric
pressure — the 6s has a barometer and it would be the better sensor, but it's
unreachable from Safari. GPS altitude is roughly three times noisier than
horizontal position, commonly ±10–20 m, so the detector is built defensively:

- altitude is exponentially smoothed before use;
- the decision comes from a least-squares slope over a 12 s window, not from
  two fixes subtracted;
- the test is **grade** (metres down per metre along), so it doesn't care how
  fast you ride;
- entry needs four consecutive qualifying windows. This matters more than it
  sounds. In simulation, noise alone on a *flat* run-out produced eight false
  descents without the debounce and none with it;
- entry and exit thresholds differ (−3% in, −0.8% out), so a flat section
  mid-trail doesn't split one run into three.

**Pre-roll.** A descent takes ~12 s to confirm, which would cost you the top of
every trail. The recorder keeps a rolling 20 s buffer of samples while armed
and replays it into the segment when one opens. The start of the trail is in
the data before the app knows it's on one.

**A run needs 30 m of vertical drop to be kept.** Anything less is a dip, a
driveway or a link road, not a trail. This threshold does real work beyond
tidiness: GPS altitude error is commonly ±10–20 m, so an 8 m threshold is
inside the noise and the keep/discard decision is close to a coin flip. At 30 m
the decision is reliable. A 100 m minimum length is a secondary guard.

Net drop is measured as the median of the first few altitudes minus the median
of the last few, not first-fix minus last-fix. One bad fix can move a single
endpoint by 15 m, which at a 30 m threshold is the difference between keeping a
run and binning it.

**Stitching.** Raising the threshold creates a failure mode: a 70 m trail with a
flat mid-section can be detected as two 35 m halves, and if the detector is
slightly pessimistic both get discarded. So a descent that ends doesn't finalise
immediately — it goes into a *holding* state for 45 s, and if you start
descending again it's the same run. The window has to exceed the exit window
plus re-confirmation time; in simulation, a 35 s flat section produced a 26 s
gap between detector events, so 25 s would have been too tight. Everything after
the pause is trimmed on finalise, so the generous window costs nothing in the
data.

Both thresholds are adjustable in the app, and there's a **Force record** button
for when detection misses a trail — forced runs bypass the minimums entirely.

---

## 5. Hard constraints — read before building

### No SIM

The phone has a real GNSS receiver and it works without a SIM. Two consequences:

**Cold fixes are slow.** No cellular means no assistance data, so first fix
takes one to three minutes instead of seconds. Stand still with a clear view of
the sky and wait for the GPS indicator to go green before dropping in. The app
warms the receiver up as soon as you grant permission.

**The app must work with no network.** A service worker precaches everything the
recorder needs, so it opens at the trailhead with the radio finding nothing.
Runs go to IndexedDB and sit there until you're home; *Sync all* pushes the
backlog. Add it to the Home Screen — iOS evicts caches for sites you haven't
visited in weeks, and a home-screen app is far less likely to be cleared.

### The browser is the platform

**~60 Hz, not 100.** Safari fires `devicemotion` at roughly display refresh
rate. Nyquist is 30 Hz and the top few Hz are never trustworthy, so the working
band stops at 25 Hz. Frame vibration is mostly below that, but you lose the
25–40 Hz slice the native version keeps.

**No background recording. At all.** Lock the screen or switch apps and the page
suspends. iOS 15 has no Screen Wake Lock API — that landed in Safari 16.4, which
the 6s can never run. The only fix is Auto-Lock → Never, and the app in front
for the whole descent.

This is the one real cost of staying on the web, and it is worth being clear
about: a native build would sample at 100 Hz and keep recording with the screen
off. It would also need Xcode, a developer account, and re-signing every seven
days on a free Apple ID. For a phone that lives zip-tied to a top tube and gets
used a few times a week, that maintenance is the worse trade.

**HTTPS is mandatory** and `DeviceMotionEvent.requestPermission()` must come
from a real tap — a click or `touchend`, not `touchstart`, never on page load.
Pages is HTTPS so this works; serving the same files over plain HTTP from the
laptop on the LAN does not.

**Gravity comes out by subtraction.** `accelerationIncludingGravity` minus
`acceleration` is the gravity vector; normalise it and project onto it. Same
mount-angle independence as the native version. iOS reports these with the
opposite sign to the spec, hence the one-tap calibration — though every metric
is sign-independent, so it only affects the live readout.

### Physical constraints

**The accelerometer clips at about ±8 g per axis.** A hard landing saturates it.
Saturated samples are flagged and drawn in orange; in those bins `peak` and
`vdv` are lower bounds, not measurements. This is the easiest way to produce
nonsense and not notice.

**Mounting compliance dominates.** A rubbery quad-lock mount is a mechanical
low-pass filter; a rigid clamp isn't. Bar, stem, seatpost and frame see
completely different signals. Numbers are comparable only within one mounting
configuration.

**Battery.** Screen-on, high-accuracy GPS and 60 Hz sensors on a decade-old
battery is brutal. A couple of hours at best.

---

## 6. Bike setup

Entered once per session, before Start, and frozen onto every run recorded in
that session. Changing the bike mid-session would silently mislabel everything
recorded before the change, so it is captured once rather than edited live.

This replaced a free-text notes field for one reason: text cannot be compared.
"26 psi, 3 clicks" and "26psi 3cl" are one setup to you and two strings to the
app, so it could never work out which runs are actually comparable.

Fields: bike, phone mount, tyre pressure front and rear, fork and shock
pressure, rebound, low-speed compression, volume spacers, and a free note.
Only the mount is required. Everything prefills from the last session, because
you rarely change more than one thing between rides and retyping eight fields at
a trailhead is how a feature gets abandoned. Named presets cover the rest.

**Pressure is stored in psi and displayed in whatever you use.** German
defaults to bar, English to psi, and the unit is a display concern only — the
stored value never changes, so switching units cannot corrupt old runs.

### Top tube, zip ties

The reference configuration. It is a good choice for this measurement and a
slightly awkward one for the app, for the same reason: it is rigid.

**Why it is good.** The top tube sits between the fork and the rear shock, so
it sees what the frame sees rather than what your hands see. For "how rough is
this trail" — as opposed to "how is my fork behaving" — that is the more
representative location. And zip ties on thin dense padding are close to
rigid, so almost nothing is filtered out before it reaches the sensor.

**Why it is awkward.** A bar mount's rubber is a mechanical low-pass filter,
and losing it means more energy arrives at the accelerometer. Expect the ±8 g
clipping indicator to appear more often on rough sections than it would on the
bars. Clipped samples are flagged and their bins drawn in orange; peaks there
are floors, not measurements.

**Padding matters more than it looks.** A 143 g iPhone 6s on thick soft foam is
a mass on a spring, and that system resonates somewhere in the tens of hertz —
inside the band being measured. It does not add noise you can filter out, it
adds a peak that looks exactly like trail chatter. Thin and dense, tied tight.

**Zip ties creep.** They loosen through a cold morning into a hot afternoon,
and a loosening mount does not fail loudly. It quietly raises the vibration
floor, which inflates every roughness number without ever looking wrong. The
mount check exists for this: ten seconds with the bike still, measuring the
noise floor in milli-g, compared against the lowest reading ever taken on this
configuration. The reference is the minimum rather than an average, because an
average drifts upward with the ties and slowly redefines loose as normal.

Do it before the first run of each session. It costs ten seconds and is the
only way to catch the failure.

### The mount is the field that matters

Not a suspension setting. Bar, stem, seatpost and frame transmit completely
different signals, and a rubber phone clamp is a mechanical low-pass filter.
Change a fork click and you are measuring a fork click; change the mount and
you are measuring the mount.

So the setup diff sorts differences into two kinds:

- **Blocking** — mount position, fixing method or bike differs. The analysis
  page says outright that the runs are not comparable, because no amount of
  statistics fixes this. Fixing method blocks as hard as position: the same
  spot on the top tube with a clamp instead of ties is a different measurement.
- **Changed** — tyre pressure, suspension, spacers. This is usually the thing
  you were deliberately testing, and it is shown as a table of what differed
  between which runs.

When every selected run shares a setup, it says so. That matters as much as the
warnings: it is the confirmation that a difference you are looking at came from
the trail or the bike, not from an uncontrolled variable.

---

## 7. Field protocol
Repeatability comes from the protocol, not the code:

1. Same mount, same position, same tension. Mark the top tube with tape so the
   phone goes back in the same place, and run the mount check before the first
   descent.
2. Same tyre pressure unless that is what you are testing. 2 psi moves these
   numbers more than most suspension clicks do.
3. Enter the bike setup before tapping Start. It attaches to every run in the
   session and is what lets the analysis tell you which runs are comparable.
4. Start recording 20–30 m before the trailhead, stop 20–30 m after. Gives the
   chainage matcher clean lead-in.
5. Do a **static baseline**: 10 s stationary at the start of every run. Used to
   estimate the noise floor and confirm the mount isn't rattling loose.
6. Three runs per configuration, minimum. Run-to-run spread is large; a single run
   difference of <10% in `energy_per_m` is noise.

---

## 8. Files

```
docs/                 web app, served by GitHub Pages — code only, no data
  index.html          recorder
  analyse.html        viewer and comparison
  js/i18n.js          EN/DE strings, locale dates and numbers
  js/setup.js         bike configuration, presets, setup diffing
  js/appmanage.js     update flow, erase everything
  js/tiles.js         opt-in satellite / topo imagery
  js/store.js         IndexedDB; the only place runs live
  js/crypto.js        AES-GCM passphrase encryption for exports
  js/backup.js        export / restore / erase
  js/analysis.js      filters, metrics, chainage matching
  js/trails.js        GPS trail grouping, multi-run aggregation
  js/trackmap.js      canvas track map, no dependencies, no tiles
  js/descent.js       descent detection
  js/recorder.js      session recording, segmentation
  sw.js               service worker — offline, same-origin only
```

A run is one JSON object, held in IndexedDB and written out only on export:

```json
{
  "id": "…", "name": "Lap 1", "notes": "26 psi, 3 clicks rebound",
  "startedAt": "2026-08-30T09:12:04.000Z",
  "sampleRateHz": 59.8,
  "motion": { "t": [0, 0.0167, …], "aVert": [0.01, -0.04, …], "clip": [0, 0, …] },
  "gps": [ { "t": 0.4, "lat": …, "lon": …, "alt": …, "acc": 8, "spd": 4.1 } ]
}
```

Parallel arrays rather than an array of objects: about a third the bytes, and
it drops straight into NumPy. A five-minute run at 60 Hz is roughly 18,000
samples and around 400 KB.

## 9. Security and privacy

A GPS track is not neutral data. It shows where you were and when, and because
rides start from a house or a regular parking spot, it points at where you live.
Ride the same trail weekly and the pattern identifies you on its own. The design
follows from that.

### Data stays on the device

Runs are written to IndexedDB and nowhere else. There is no upload, no
telemetry, no analytics, no sync. The analysis page reads the same local store.
Both pages carry a Content-Security-Policy with `connect-src 'none'`, so neither
can make a network request even if something managed to inject code that tried.

**The earlier design pushed runs into this repo, and that was wrong.** A GitHub
Pages site is public even when the repository behind it is private — private
Pages requires an Enterprise Cloud organisation, which this isn't. Anything
committed to `docs/` is world-readable. `.gitignore` now blocks ride data,
backup files and credentials.

### No token on the phone

The old version kept a GitHub personal access token with write access in
`localStorage`. Anyone with the unlocked phone could read it, and so could any
script that ended up running on the origin. That's gone. If you want runs in
version control, export an encrypted backup and commit it from the laptop,
where your git credentials already live behind an OS keychain.

### No third-party code, no map tiles

The analysis page reads your entire ride history. A script loaded from a CDN
onto that page can read everything the page can, so a compromised or
substituted CDN file would have full access — this is why Leaflet was dropped in
favour of a canvas renderer with no dependencies.

Map tiles are fetched by coordinate, which tells the tile server where you ride,
on every page load, with your IP attached. There is no way to have a tile
backdrop without that, so there is no backdrop. You get track shape, relative
position and a scale bar.

### Map imagery is the one deliberate exception

Satellite and topographic backdrops are available on the analysis page, off by
default, behind a confirmation that says plainly what it costs. Tiles are
fetched by coordinate, so every request tells the imagery server which few
hundred metres of ground you are looking at, with your IP attached. There is no
tiled map without that.

What the exception does *not* open up: the CSP grants `img-src` to the two tile
hosts and nothing else. `connect-src` stays `'none'`, so the page still cannot
POST, fetch or upload anything anywhere. Images come in; nothing goes out but
the request. Tiles are also excluded from the service worker cache, so imagery
never persists a record of where you ride in a place the erase function would
have to know about.

Precisely what a tile server sees: the tile coordinates (at zoom 15, about
826 m per tile, and since the view is fitted to your track, the set of tiles is
a bounding box of the trail), the zoom level, which implies its length, your IP
or your hotspot's, a timestamp, and a user-agent that on a 2015 phone is
distinctive. It cannot see accelerometer samples, roughness metrics, individual
GPS points, notes, or when you rode — only when you looked.

The `Referer` header is stripped. Safari's default would attach
`https://<username>.github.io` to every tile request, putting a named person
and a bounding box of their local trail in the same log line — worse than
either alone. Both a page-level `no-referrer` policy and a per-image
`referrerPolicy` are set.

Tethering to another phone changes whose IP is attached, not whether the
disclosure happens.

### Exports

Export is a deliberate action with three choices:

- **Encrypted** — AES-256-GCM, key from PBKDF2-SHA256 at 210,000 iterations.
  Safe to put on a cloud drive or in a repo. Lose the passphrase and the data is
  gone; there is no recovery, which is what makes it worth anything.
- **Unencrypted** — behind a confirmation, for feeding into Python at home.
- **Trimming** — optionally strips the first and last 100–250 m of every track.
  That's usually the house or the car park. It reduces obvious exposure; it is
  not anonymisation.

### Storage is not backup

Safari deletes IndexedDB, localStorage and service worker registrations after
seven days without interaction with a site. **A web app added to the Home Screen
is explicitly exempt** — it gets its own storage, isolated from Safari, and ITP
skips it. So installing to the Home Screen isn't cosmetic here, it's what stops
your data evaporating during a quiet fortnight.

The app also calls `navigator.storage.persist()`, which asks the browser not to
evict. Neither measure is a backup. Delete the app, reset the phone or lose it,
and the runs are gone. Export regularly.

---

## 10. Housekeeping features

**Language.** English and German, switchable in Settings and remembered per
device. First run picks from `navigator.language`.

Dates go through `Intl` with an explicit locale rather than the browser
default, because 08.09.2026 means 8 September to a German reader and 9 August
to an English one — a ride log where you can't tell which is worse than no
dates at all. German also takes a comma as the decimal separator, so roughness
reads 3,84 rather than 3.84, and thousands group as 1.420.

Export filenames stay ISO (`mtbbump-2026-09-08-a1b2c3d4.json`) regardless of
language, so they sort correctly in Files and on the laptop.

**Connections to GitHub happen only when you ask.** The service worker is
cache-only: a cached file is served and the network is never touched, not even
in the background. An earlier version used the common stale-while-revalidate
pattern — serve the cache, quietly refetch for next time — which meant every
screen you opened reached out to GitHub. That is a steady trickle of requests
announcing when and how often you use the app, and it buys nothing when the app
only changes if you push to the repo.

Three things enforce it: the cache-only worker; `register()` only when no
registration exists, since calling it every launch makes the browser compare
the worker script; and `updateViaCache: 'all'`, letting the browser serve
`sw.js` from its own HTTP cache.

One request remains outside our control. The spec has the browser check the
worker script on navigation if it hasn't been checked for 24 hours, and a page
cannot opt out. Worst case that is one request for `sw.js` per day. It carries
no ride data — nothing does. The app records the time of every check you make,
so you can see for yourself when it last connected.

**Updates.** A new version installs but deliberately does *not* take over —
`skipWaiting()` was removed from the install handler. A worker swapping in
mid-session would reload the page and lose the descent being recorded. Instead
a banner appears, and applying it is refused outright while a session is
running. The app also re-checks whenever it's reopened, since a Home Screen app
may go days between navigations and would otherwise never notice.

**Erase everything.** Clears IndexedDB, deletes the database, drops every
cache, unregisters the service worker and removes the `mtbbump.*` settings
keys. iOS gives no way to delete a Home Screen icon from script, so that last
step is yours — and doing it *first* would leave all the data behind, which is
the whole reason this exists.

**Load and download.** Covered by the backup panel: encrypted or plain export,
optional track trimming, restore from file. Restore never overwrites a run that
is already present.

---

## 11. Roadmap

1. Recording, local storage, live g readout. *(done)*
2. Per-run metrics and a distance-binned roughness profile. *(done)*
3. Reference-run chainage matching and multi-run aggregation. *(done)*
4. Automatic descent detection and trail grouping. *(done)*
5. Optional ISO 2631-1 Wk frequency weighting for a comfort-referenced number.
6. Export to the Sufni-style session format if you ever add real suspension sensors.
7. Splitting and merging runs after the fact, for when the detector gets it wrong.
