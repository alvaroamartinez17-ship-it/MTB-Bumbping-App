# Setup — GitHub Pages, no Xcode

## What runs where

```
MTB-Bumbping-App/
├── docs/                    ← GitHub Pages serves this folder
│   ├── index.html           recorder (open on the phone)
│   ├── analyse.html         viewer and run comparison (any device)
│   ├── css/app.css
│   ├── js/
│   │   ├── i18n.js          EN/DE strings, locale dates
│   │   ├── setup.js         bike setup, presets, comparability
│   │   ├── appmanage.js     updates, erase everything
│   │   ├── tiles.js         opt-in satellite imagery
│   │   ├── analysis.js      filters, metrics, chainage matching
│   │   ├── trails.js        GPS trail grouping, multi-run stats
│   │   ├── descent.js       decides when you're going down
│   │   ├── recorder.js      session recording, segmentation, IndexedDB
│   │   └── github.js        commits runs via the Contents API
│   ├── sw.js                service worker — makes it work with no network
│   ├── manifest.json
│   └── data/
│       ├── index.json       list of published runs
│       └── runs/*.json      one file per run
├── README.md
└── SETUP.md
```

The phone records in Safari, saves locally to IndexedDB, and pushes each run as
a JSON file straight into `docs/data/runs/`. Pages then serves those files as
static assets, so `analyse.html` reads them back with a plain `fetch` — no
token, no server, works on any device including the old iPad.

## 1. Publish

```bash
git clone https://github.com/alvaroamartinez17-ship-it/MTB-Bumbping-App.git
cd MTB-Bumbping-App
# copy the docs/ folder and the two .md files into place
git add .
git commit -m "Web-based recorder and analyser"
git push origin main
```

Then: repo → Settings → Pages → Source: *Deploy from a branch* → Branch `main`,
folder `/docs` → Save. A minute later the app is at

```
https://alvaroamartinez17-ship-it.github.io/MTB-Bumbping-App/
```

That URL is HTTPS, which is mandatory — Safari refuses sensor access outside a
secure context, so opening the HTML from a file or over plain HTTP on the LAN
will not work.

## 2. What is and isn't published

The repo holds the **app**. Your **runs** never go near it.

This matters more than it sounds: a GitHub Pages site is public even when the
repository behind it is private. Private Pages requires an Enterprise Cloud
organisation. So anything committed under `docs/` is readable by anyone who
finds the URL — and GPS tracks show where you ride and where you start from.

`.gitignore` blocks ride data, backup files and credentials. Before your first
push, check what you're about to commit:

```bash
git status --short
git ls-files | grep -Ei 'runs|\.csv|mtbbump-' && echo "STOP — data staged" || echo "clean"
```

If you ever do commit a track by accident, deleting it in a later commit is not
enough — it stays in the history and on any clone. Rewrite the history or, more
realistically, delete the repository and start a fresh one.

## 3. Add to Home Screen — not optional here

Safari → Share → Add to Home Screen.

With no SIM this is the step that makes the whole thing work. The service worker
precaches the app on first load over Wi-Fi, so it opens at the trailhead with no
network. iOS evicts caches for sites you haven't opened in a few weeks, and a
home-screen app is far less likely to be cleared than a tab.

Sensor permission is per-origin and gets asked again in the standalone window,
so tap *Enable sensors* once there too.

**Test it before you rely on it:** load the app on Wi-Fi, turn Wi-Fi off, force
quit, reopen from the Home Screen. It should come up normally and show
*offline* in the header. If it shows a Safari error page, the service worker
didn't register — check that you're on the Pages URL and not a `file://` path.

## 4. How a session goes

0. Zip-tie the phone to the top tube over thin dense padding, ties tight. Then
   open **Mount check** and run it with the bike standing still. Ten seconds.
   If it reports a higher noise floor than your best, the ties have crept —
   redo them before riding, or the whole session reads rougher than it is.
1. Open the app. Check the **Bike setup** panel — it prefills
   from your last session, so usually you only change what you actually
   changed. Pick a preset if you keep a few standard configurations. The phone
   mount is required; nothing else is.
2. Tap **Start session**. Wait for the GPS
   readout to go green — with no SIM this takes one to three minutes on a cold
   start, and the detector can't do anything without fixes.
3. Ride. The banner says *Armed* on the climb and *Recording descent* on the
   way down. Nothing is logged while you climb.
4. Each descent is saved as its own run once the trail has been flat for 45 s.
   The banner shows *Holding* during that window — if you start dropping again
   it stays one run rather than splitting in two.
5. **Runs need 30 m of vertical drop to be kept.** Less than that and it's
   discarded as a dip rather than a trail. The log line tells you what was
   thrown away and by how much, which is how you find out whether the threshold
   suits your local trails.
6. If a trail isn't detected, tap **Force record this run** — it records until
   you tap it again and skips the 30 m minimum.
7. At the end, tap **End session**. If you're online it syncs immediately;
   otherwise the runs wait and *Sync all* pushes them when you're home.

Tune the thresholds under *Descent detection* once you've seen how it behaves
on your local trails. Starting at −3% grade is deliberately generous; if it's
picking up gentle traverses, make it steeper.

## 5. Backups

Runs live in IndexedDB on the phone. That is deliberate, and it means the phone
is a single point of failure. Export regularly.

Record page → *Backup & export*:

- **Export encrypted** — passphrase, AES-256-GCM. Safe to drop on a cloud
  drive, email to yourself, or commit to a private repo from the laptop. Lose
  the passphrase and the data is unrecoverable; that's the trade.
- **Export unencrypted** — for analysis in Python at home. It contains your
  tracks in the clear, so keep it somewhere you control.
- **Trim from each end** — strips 100 or 250 m from the start and finish of
  every track, which is usually your house or a regular parking spot. Reduces
  exposure; doesn't anonymise anything.

Restore takes either kind of file and never overwrites a run that's already
present.

Reading an unencrypted export:

```python
import json
bundle = json.load(open('mtbbump-2026-08-30.json'))
for run in bundle['runs']:
    print(run['name'], len(run['motion']['t']), 'samples')
```

## 6. Before the first real run

1. **Calibrate the sign.** Phone flat on a table, screen up, tap *Calibrate
   sign*. iOS reports `accelerationIncludingGravity` with the opposite sign to
   the spec, and this pins it down rather than guessing from the user agent.
   Only the live readout depends on it — every metric is sign-independent.
2. **Auto-Lock → Never** in Settings → Display & Brightness. iOS 15 has no
   Screen Wake Lock API, so a sleeping screen suspends the page and ends the
   recording mid-descent.
3. **Low Power Mode off.** It throttles timers and sensor callbacks.
4. **Watch the Hz counter** on the first ride. It should sit near 60. If it
   drops below 40 the browser is throttling and the data is degraded.
5. **Bench check.** Record 30 s with the phone still. `aVert` should hover near
   zero and the RMS should be small. That's your noise floor.
6. **Noise-floor ride.** Same section twice, back to back, identical setup. The
   difference between those two runs is the smallest change you can ever detect.

## 7. Reading the analysis page

Runs are grouped into trails by GPS overlap — you never label anything. Pick a
trail and every run on it is selected by default; untick any to exclude it.

The number to look at first is **run-to-run spread**. It's the percentage
difference you get from riding the same trail twice with nothing changed, and
it sets the bar every comparison has to clear. Two runs give a weak estimate;
three or more is much steadier. Until you have that number, no comparison on
this page means anything.

Above that, check the **Bike setup** panel. If it says the runs used different
mounts or bikes, stop — they are not comparable and the spread figure below is
meaningless. If it lists changed settings, that is your independent variable.
If it says the setup is identical, any difference came from the trail or from
you.

Then the two tables. *Consistently rough* is high roughness with low scatter —
the trail does it to you every time, so it's worth acting on. *Most variable*
is where runs disagree, which is line choice or speed rather than terrain.
Chasing those is chasing your own inconsistency.

To force a grouping the geometry gets wrong, add a `"trail": "Some Name"` field
to a run before restoring it. An explicit label always wins.

The map has no backdrop on purpose: tiles are fetched by coordinate, which would
tell the tile server where you ride on every page load.

## 8. Satellite imagery

Analysis page → Satellite imagery → Satellite or Topographic. It is off by
default and asks for confirmation the first time.

Read the confirmation before accepting it. Tiles are fetched by coordinate, so
the imagery server learns which patch of ground you are looking at and your IP
address. Tethering to another phone means it learns *that* phone's IP instead.

The `Referer` header is stripped, so requests do not carry your GitHub Pages
URL — otherwise every tile would arrive tagged with your username next to your
trail's coordinates.

Two things the app still guarantees with imagery on: the page cannot upload
anything (`connect-src 'none'` — images in, nothing out), and tiles are kept
out of the service worker cache so no record of your trails persists there.

Works over Wi-Fi or a shared hotspot. It will not work at the trailhead with no
SIM, which is fine — the recorder never needs it, and the map is something you
look at afterwards. Tiles already loaded stay in memory for the session; reopen
the page offline and the backdrop is blank while the tracks still draw.

Imagery sources are Esri World Imagery and OpenTopoMap. Both require the
attribution the map already draws in the corner. Neither is a paid tier, so be
reasonable about volume.

## 9. Updates and removing the app

**Updating.** Push to the repo, then on the phone tap App version → Check for
updates. That single tap fetches `sw.js`, compares it byte for byte, and if it
differs, downloads the new files and offers the banner. Nothing is downloaded
if nothing changed.

The app does not check on its own. It will not notice your push until you ask
it to, which is the intended behaviour — the panel shows when it last
connected, and that timestamp only moves when you tap the button.

Applying an update is refused while a session is recording, since the reload
would lose the descent.

If an update seems stuck, the cause is almost always the old worker still
controlling the page. Close every instance of the app and reopen it.

To confirm the app is not talking to GitHub behind your back: put the phone in
Airplane Mode and use it normally. Recording, analysis, export and restore all
work unchanged. Only Check for updates fails, and satellite tiles stop loading
if you enabled them.

**Removing.** Settings → Remove this app → Erase everything. That clears the
runs, the database, every cache, the service worker and the settings. Then
delete the Home Screen icon by hand: press and hold, then Remove.

Do it in that order. Deleting the icon first leaves the data on the device with
no interface left to erase it — you'd have to go to Settings → Safari → Advanced
→ Website Data and find it there.

Export a backup before either step.

## 10. Pulling data out

Export an unencrypted backup, then AirDrop it or save it to Files → On My
iPhone and copy it across. `analysis.js` and `trails.js` have no DOM
dependencies, so the same metric code runs under Node against exported files if
you'd rather not reimplement it in Python.

## Known gaps

- The app can't record with the screen off or backgrounded. Platform limit, not
  a bug. Auto-Lock → Never is the workaround.
- Runs exist on one phone until you export. There is no automatic backup, and
  there deliberately isn't going to be one.
- The detector can't be corrected after the fact. If it merges two trails or
  splits one, you'd edit the exported JSON.
- The map has no geographic backdrop, so you match tracks by shape.
- No frequency weighting, so `body` and `chatter` are comparable to each other
  but not to published ISO 2631 comfort thresholds.
- `analyse.html` uses `flatMap`, template literals and `fetch`, so it needs a
  reasonably modern browser. The iOS 9.3.5 iPad would need the ES5 treatment
  before it can view runs.
