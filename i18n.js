/*
 * i18n.js — English and German, with locale-correct dates and numbers.
 *
 * Date format is not decoration. 08.09.2026 is 8 September to a German reader
 * and 9 August to an English one, and a ride log where you can't tell which is
 * which is worse than useless. Everything user-facing goes through Intl with
 * an explicit locale rather than toLocaleString() with the browser default.
 *
 * German also uses a comma as the decimal separator, so "3,84" is one number,
 * not two. Intl handles that too.
 */

const DICT = {
  en: {
    'app.name': 'MTB Bump',
    'nav.analyse': 'Analyse',
    'nav.record': 'Record',

    'gate.intro': 'Safari only grants sensor access from a real tap, so this cannot be requested automatically.',
    'gate.button': 'Enable sensors',
    'gate.denied': 'Denied. Settings → Safari → Motion & Orientation Access, then reload.',
    'gate.https': 'This page must be served over HTTPS.',

    'state.idle': 'Idle',
    'state.idle.sub': 'Start a session at the top',
    'state.armed': 'Armed',
    'state.armed.sub': 'Waiting for a descent — climbing is not logged',
    'state.rec': 'Recording descent',
    'state.holding': 'Holding',
    'state.holding.sub': 'Flat section — still the same run unless it lasts',

    'stat.grade': 'grade %',
    'stat.peak': 'peak g',
    'stat.rate': 'Hz actual',
    'stat.runs': 'runs kept',
    'stat.session': 'session',
    'stat.gps': 'gps',
    'stat.nofix': 'no fix',
    'stat.stale': 'stale',
    'stat.fix': 'fix',

    'btn.start': 'Start session',
    'btn.end': 'End session',
    'btn.force': 'Force record this run',
    'btn.forceStop': 'Stop forced recording',
    'btn.export': 'Export',
    'btn.delete': 'Delete',
    'btn.apply': 'Apply',

    'setup.title': 'Bike setup',
    'setup.intro': 'Entered once per session and attached to every run in it.',
    'setup.sameAsLast': 'Same as last session',
    'setup.advanced': 'Extras',
    'setup.preset': 'Preset',
    'setup.presetSave': 'Save as preset',
    'setup.presetName': 'Preset name',
    'setup.units': 'Pressure units',
    'setup.required': 'Choose where the phone is mounted before starting.',
    'setup.bike': 'Bike',
    'setup.mount': 'Phone position',
    'setup.mountFixing': 'Fixing method',
    'setup.tyreFront': 'Tyre front',
    'setup.tyreRear': 'Tyre rear',
    'setup.fork': 'Fork',
    'setup.shock': 'Shock',
    'setup.forkAir': 'Fork air',
    'setup.forkLSR': 'Fork LSR',
    'setup.forkHSR': 'Fork HSR',
    'setup.forkLSC': 'Fork LSC',
    'setup.forkHSC': 'Fork HSC',
    'setup.forkTokens': 'Fork tokens',
    'setup.shockAir': 'Shock air',
    'setup.shockLSR': 'Shock LSR',
    'setup.shockHSR': 'Shock HSR',
    'setup.shockLSC': 'Shock LSC',
    'setup.shockHSC': 'Shock HSC',
    'setup.shockTokens': 'Shock tokens',
    'setup.clicksHint': 'Clicks from fully closed.',
    'setup.diff.baseline': 'baseline',
    'an.bySetup': 'Roughness by setup',
    'an.bySetup.intro': 'Median energy per metre for each configuration, over the sections all runs cover.',
    'an.bySetup.thin': 'Only one run on this setup — no spread, so treat it as a single sample.',
    'an.bySetup.belowFloor': 'Difference is inside your run-to-run spread. Not a result yet.',
    'setup.note': 'Note',
    'setup.mount.handlebar': 'Handlebar',
    'setup.mount.stem': 'Stem',
    'setup.mount.topTube': 'Top tube',
    'setup.mount.downTube': 'Down tube',
    'setup.mount.chainstay': 'Chainstay',
    'setup.mount.seatpost': 'Seatpost',
    'setup.mount.backpack': 'Backpack',
    'setup.fixing.zipTies': 'Zip ties',
    'setup.fixing.clamp': 'Clamp mount',
    'setup.fixing.strap': 'Velcro strap',
    'setup.fixing.adhesive': 'Adhesive pad',
    'setup.fixing.tape': 'Tape',
    'mount.title': 'Mount check',
    'mount.intro': 'Ten seconds with the bike still. Measures how much the mount rattles on its own — if this climbs between rides, the ties have loosened.',
    'mount.run': 'Run mount check',
    'mount.running': 'Hold the bike still…',
    'mount.result': 'Noise floor',
    'mount.baseline': 'Best recorded',
    'mount.good': 'Solid. Comparable to your best.',
    'mount.drift': 'Higher than your best — check the ties before trusting this session.',
    'mount.first': 'First check saved as your baseline.',
    'mount.moved': 'Bike moved during the check. Try again.',
    'setup.diff.blocking': 'These runs used different mounts or bikes. They are not comparable — a mount change alters the signal more than any suspension setting.',
    'setup.diff.changed': 'Setup differs between these runs:',
    'setup.diff.same': 'Same setup across all selected runs.',
    'setup.diff.missing': 'Some runs have no setup recorded.',
    'field.name': 'Session name',
    'field.notes': 'Pressure, clicks, mount position',

    'runs.title': 'Runs on this phone',
    'runs.empty': 'Nothing recorded yet.',

    'backup.title': 'Backup and export',
    'backup.intro': 'Runs are stored only on this phone. Nothing is uploaded anywhere.',
    'backup.pass': 'Passphrase (encrypts the file)',
    'backup.trim': 'Trim from each end of every track',
    'backup.trim.none': 'nothing',
    'backup.exportEnc': 'Export encrypted',
    'backup.exportPlain': 'Export unencrypted',
    'backup.restore': 'Restore from a backup file',
    'backup.wipe': 'Erase all runs',

    'settings.title': 'Settings',
    'settings.language': 'Language',
    'settings.dateFormat': 'Date format',

    'update.title': 'App version',
    'update.check': 'Check for updates',
    'update.available': 'A new version is ready.',
    'update.apply': 'Update and reload',
    'update.current': 'You have the latest version.',
    'update.checking': 'Checking…',
    'update.busy': 'An update is ready. It will install after you end the session.',
    'update.policy': 'This is the only time the app connects to GitHub. It never checks on its own.',
    'update.last': 'Last checked',
    'update.never': 'never',
    'update.offline': 'No connection. Try again on Wi-Fi.',

    'uninstall.title': 'Remove this app',
    'uninstall.warn': 'Erases every run, cached files and settings on this device. Export a backup first.',
    'uninstall.button': 'Erase everything',
    'uninstall.done': 'Erased. Now delete the icon from your Home Screen: press and hold, then Remove.',

    'detect.title': 'Descent detection',
    'detect.enter': 'Start below grade',
    'detect.exit': 'Stop above grade',
    'detect.minDrop': 'Discard runs under',
    'detect.minLen': 'Discard runs shorter than',
    'detect.rejoin': 'Rejoin if descending again within',

    'an.trail': 'Trail',
    'an.spread': 'Run-to-run spread',
    'an.runs': 'Runs on this trail',
    'an.rough': 'Consistently rough',
    'an.variable': 'Most variable',
    'an.empty': 'No runs on this device yet. Record a session, or restore a backup.',
    'an.satellite': 'Satellite imagery',
    'an.satellite.off': 'Off — no map tiles are requested',
    'an.satellite.on': 'On — tile requests reveal where you ride',

    'unit.m': 'm',
    'unit.km': 'km',
    'unit.s': 's',
  },

  de: {
    'app.name': 'MTB Bump',
    'nav.analyse': 'Auswerten',
    'nav.record': 'Aufnehmen',

    'gate.intro': 'Safari erlaubt den Sensorzugriff nur nach einer echten Berührung, daher lässt sich das nicht automatisch anfragen.',
    'gate.button': 'Sensoren freigeben',
    'gate.denied': 'Abgelehnt. Einstellungen → Safari → Bewegung und Ausrichtung, danach neu laden.',
    'gate.https': 'Diese Seite muss über HTTPS ausgeliefert werden.',

    'state.idle': 'Bereit',
    'state.idle.sub': 'Sitzung oben am Trail starten',
    'state.armed': 'Scharf',
    'state.armed.sub': 'Wartet auf Abfahrt — Auffahrten werden nicht gespeichert',
    'state.rec': 'Abfahrt wird aufgezeichnet',
    'state.holding': 'Pause',
    'state.holding.sub': 'Flachstück — bleibt dieselbe Abfahrt, wenn es kurz ist',

    'stat.grade': 'Gefälle %',
    'stat.peak': 'Spitze g',
    'stat.rate': 'Hz gemessen',
    'stat.runs': 'Abfahrten',
    'stat.session': 'Sitzung',
    'stat.gps': 'GPS',
    'stat.nofix': 'kein Signal',
    'stat.stale': 'veraltet',
    'stat.fix': 'Punkte',

    'btn.start': 'Sitzung starten',
    'btn.end': 'Sitzung beenden',
    'btn.force': 'Abfahrt manuell aufzeichnen',
    'btn.forceStop': 'Manuelle Aufzeichnung beenden',
    'btn.export': 'Exportieren',
    'btn.delete': 'Löschen',
    'btn.apply': 'Übernehmen',

    'setup.title': 'Bike-Einstellungen',
    'setup.intro': 'Einmal pro Sitzung eingeben, gilt für alle Abfahrten darin.',
    'setup.sameAsLast': 'Wie letzte Sitzung',
    'setup.advanced': 'Sonstiges',
    'setup.preset': 'Vorlage',
    'setup.presetSave': 'Als Vorlage speichern',
    'setup.presetName': 'Name der Vorlage',
    'setup.units': 'Druckeinheit',
    'setup.required': 'Vor dem Start festlegen, wo das Telefon montiert ist.',
    'setup.bike': 'Rad',
    'setup.mount': 'Telefonposition',
    'setup.mountFixing': 'Befestigung',
    'setup.tyreFront': 'Reifendruck vorn',
    'setup.tyreRear': 'Reifendruck hinten',
    'setup.fork': 'Gabel',
    'setup.shock': 'Dämpfer',
    'setup.forkAir': 'Gabel Luftdruck',
    'setup.forkLSR': 'Gabel LSR',
    'setup.forkHSR': 'Gabel HSR',
    'setup.forkLSC': 'Gabel LSC',
    'setup.forkHSC': 'Gabel HSC',
    'setup.forkTokens': 'Gabel Spacer',
    'setup.shockAir': 'Dämpfer Luftdruck',
    'setup.shockLSR': 'Dämpfer LSR',
    'setup.shockHSR': 'Dämpfer HSR',
    'setup.shockLSC': 'Dämpfer LSC',
    'setup.shockHSC': 'Dämpfer HSC',
    'setup.shockTokens': 'Dämpfer Spacer',
    'setup.clicksHint': 'Klicks von ganz geschlossen.',
    'setup.diff.baseline': 'Ausgangswert',
    'an.bySetup': 'Rauheit nach Einstellung',
    'an.bySetup.intro': 'Mittlere Energie pro Meter je Konfiguration, über die von allen Abfahrten befahrenen Abschnitte.',
    'an.bySetup.thin': 'Nur eine Abfahrt mit dieser Einstellung — keine Streuung, also als Einzelmessung behandeln.',
    'an.bySetup.belowFloor': 'Unterschied liegt innerhalb deiner Streuung. Noch kein Ergebnis.',
    'setup.note': 'Notiz',
    'setup.mount.handlebar': 'Lenker',
    'setup.mount.stem': 'Vorbau',
    'setup.mount.topTube': 'Oberrohr',
    'setup.mount.downTube': 'Unterrohr',
    'setup.mount.chainstay': 'Kettenstrebe',
    'setup.mount.seatpost': 'Sattelstütze',
    'setup.mount.backpack': 'Rucksack',
    'setup.fixing.zipTies': 'Kabelbinder',
    'setup.fixing.clamp': 'Klemmhalterung',
    'setup.fixing.strap': 'Klettband',
    'setup.fixing.adhesive': 'Klebepad',
    'setup.fixing.tape': 'Klebeband',
    'mount.title': 'Halterungstest',
    'mount.intro': 'Zehn Sekunden mit stehendem Rad. Misst, wie stark die Halterung von selbst klappert — steigt der Wert, haben sich die Kabelbinder gelockert.',
    'mount.run': 'Halterung prüfen',
    'mount.running': 'Rad ruhig halten…',
    'mount.result': 'Rauschpegel',
    'mount.baseline': 'Bester Wert',
    'mount.good': 'Fest. Entspricht deinem besten Wert.',
    'mount.drift': 'Höher als dein bester Wert — Kabelbinder prüfen, bevor du dieser Sitzung traust.',
    'mount.first': 'Erster Test als Referenz gespeichert.',
    'mount.moved': 'Rad hat sich bewegt. Bitte wiederholen.',
    'setup.diff.blocking': 'Diese Abfahrten wurden mit unterschiedlichen Halterungen oder Rädern gefahren. Sie sind nicht vergleichbar — die Halterung verändert das Signal stärker als jede Fahrwerkseinstellung.',
    'setup.diff.changed': 'Unterschiede in den Einstellungen:',
    'setup.diff.same': 'Gleiche Einstellungen bei allen ausgewählten Abfahrten.',
    'setup.diff.missing': 'Für einige Abfahrten sind keine Einstellungen hinterlegt.',
    'field.name': 'Name der Sitzung',
    'field.notes': 'Luftdruck, Klicks, Halterung',

    'runs.title': 'Abfahrten auf diesem Gerät',
    'runs.empty': 'Noch nichts aufgezeichnet.',

    'backup.title': 'Sicherung und Export',
    'backup.intro': 'Abfahrten liegen ausschließlich auf diesem Gerät. Es wird nichts hochgeladen.',
    'backup.pass': 'Passphrase (verschlüsselt die Datei)',
    'backup.trim': 'Von jedem Track-Ende abschneiden',
    'backup.trim.none': 'nichts',
    'backup.exportEnc': 'Verschlüsselt exportieren',
    'backup.exportPlain': 'Unverschlüsselt exportieren',
    'backup.restore': 'Aus Sicherungsdatei wiederherstellen',
    'backup.wipe': 'Alle Abfahrten löschen',

    'settings.title': 'Einstellungen',
    'settings.language': 'Sprache',
    'settings.dateFormat': 'Datumsformat',

    'update.title': 'App-Version',
    'update.check': 'Nach Updates suchen',
    'update.available': 'Eine neue Version ist bereit.',
    'update.apply': 'Aktualisieren und neu laden',
    'update.current': 'Die App ist aktuell.',
    'update.checking': 'Suche läuft…',
    'update.busy': 'Ein Update ist bereit. Es wird nach dem Ende der Sitzung installiert.',
    'update.policy': 'Nur hier verbindet sich die App mit GitHub. Von selbst sucht sie nie.',
    'update.last': 'Zuletzt geprüft',
    'update.never': 'nie',
    'update.offline': 'Keine Verbindung. Im WLAN erneut versuchen.',

    'uninstall.title': 'App entfernen',
    'uninstall.warn': 'Löscht alle Abfahrten, zwischengespeicherten Dateien und Einstellungen auf diesem Gerät. Vorher sichern.',
    'uninstall.button': 'Alles löschen',
    'uninstall.done': 'Gelöscht. Jetzt das Symbol vom Home-Bildschirm entfernen: gedrückt halten, dann Entfernen.',

    'detect.title': 'Abfahrtserkennung',
    'detect.enter': 'Start unter Gefälle',
    'detect.exit': 'Stopp über Gefälle',
    'detect.minDrop': 'Abfahrten verwerfen unter',
    'detect.minLen': 'Abfahrten verwerfen kürzer als',
    'detect.rejoin': 'Wieder verbinden, wenn erneut bergab innerhalb',

    'an.trail': 'Trail',
    'an.spread': 'Streuung zwischen Abfahrten',
    'an.runs': 'Abfahrten auf diesem Trail',
    'an.rough': 'Durchgehend rau',
    'an.variable': 'Am unterschiedlichsten',
    'an.empty': 'Noch keine Abfahrten auf diesem Gerät. Sitzung aufzeichnen oder Sicherung laden.',
    'an.satellite': 'Satellitenbilder',
    'an.satellite.off': 'Aus — es werden keine Kacheln geladen',
    'an.satellite.on': 'An — Kachelabrufe verraten, wo du fährst',

    'unit.m': 'm',
    'unit.km': 'km',
    'unit.s': 's',
  },
};

const LS_KEY = 'mtbbump.lang';

const I18n = {
  lang: 'en',

  init() {
    const saved = localStorage.getItem(LS_KEY);
    if (saved && DICT[saved]) {
      this.lang = saved;
    } else {
      // navigator.language can be 'de', 'de-DE', 'de-AT', 'de-CH'.
      const nav = (navigator.language || 'en').toLowerCase();
      this.lang = nav.startsWith('de') ? 'de' : 'en';
    }
    document.documentElement.lang = this.lang;
    return this.lang;
  },

  set(lang) {
    if (!DICT[lang]) return;
    this.lang = lang;
    localStorage.setItem(LS_KEY, lang);
    document.documentElement.lang = lang;
    this.apply();
  },

  t(key) {
    const d = DICT[this.lang] || DICT.en;
    return d[key] !== undefined ? d[key] : (DICT.en[key] !== undefined ? DICT.en[key] : key);
  },

  /** The BCP 47 tag Intl should use. de-DE gives 31.08.2026 and 3,84. */
  get locale() { return this.lang === 'de' ? 'de-DE' : 'en-GB'; },

  /** Swap every element carrying data-i18n / data-i18n-ph / data-i18n-title. */
  apply(root = document) {
    root.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = this.t(el.getAttribute('data-i18n'));
    });
    root.querySelectorAll('[data-i18n-ph]').forEach((el) => {
      el.placeholder = this.t(el.getAttribute('data-i18n-ph'));
    });
    root.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.textContent = this.t(el.getAttribute('data-i18n-title'));
    });
  },

  date(value) {
    const d = value instanceof Date ? value : new Date(value);
    return new Intl.DateTimeFormat(this.locale, {
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);
  },

  dateTime(value) {
    const d = value instanceof Date ? value : new Date(value);
    return new Intl.DateTimeFormat(this.locale, {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    }).format(d);
  },

  /** Short form for dense lists: 31.08. or 31/08 depending on locale. */
  dayMonth(value) {
    const d = value instanceof Date ? value : new Date(value);
    return new Intl.DateTimeFormat(this.locale, { day: '2-digit', month: '2-digit' }).format(d);
  },

  num(value, digits = 2) {
    return new Intl.NumberFormat(this.locale, {
      minimumFractionDigits: digits, maximumFractionDigits: digits,
    }).format(value);
  },

  int(value) {
    return new Intl.NumberFormat(this.locale, { maximumFractionDigits: 0 }).format(value);
  },

  /** Signed percentage, for run deltas. */
  pct(value, digits = 0) {
    const s = new Intl.NumberFormat(this.locale, {
      minimumFractionDigits: digits, maximumFractionDigits: digits,
      signDisplay: 'exceptZero',
    }).format(value);
    return s + ' %';
  },

  /** A filename-safe timestamp that sorts correctly in both locales. */
  fileStamp(d = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  },

  get available() { return Object.keys(DICT); },
};

window.I18n = I18n;
