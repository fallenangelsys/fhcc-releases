import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (relative) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

const {
  CONFIGURATION_MARKERS,
  DEFAULT_START_MODE,
  START_MODES,
  describeStartupMode,
  detectFreshInstall,
  isValidStartMode,
  normalizeStartMode,
  resolveAutoStart
} = await import('../desktop/startup-mode.cjs');

const expect = (label, fn) => {
  fn();
  console.log(`  ok  ${label}`);
};

console.log('startup-mode-smoke');

// --- Normalisierung -------------------------------------------------------
expect('Standard ist auto', () => assert.equal(DEFAULT_START_MODE, 'auto'));
expect('genau zwei Modi', () => assert.deepEqual(START_MODES, ['auto', 'manual']));
expect('manual bleibt manual', () => assert.equal(normalizeStartMode('manual'), 'manual'));
expect('GROSSBUCHSTABEN werden akzeptiert', () => assert.equal(normalizeStartMode('MANUAL'), 'manual'));
expect('leer ergibt Standard', () => assert.equal(normalizeStartMode(''), 'auto'));
expect('unbekannter Wert faellt auf Standard', () => assert.equal(normalizeStartMode('quatsch'), 'auto'));
expect('isValid erkennt erlaubte Werte', () => {
  assert.equal(isValidStartMode('auto'), true);
  assert.equal(isValidStartMode('manual'), true);
  assert.equal(isValidStartMode('quatsch'), false);
});

// --- Erkennung einer frischen Installation --------------------------------
expect('leerer Datenordner ist frisch', () => assert.equal(detectFreshInstall([]), true));
expect('nur Heartbeat ist frisch', () => assert.equal(
  detectFreshInstall(['activity-race-heartbeat.json', 'activity-race-heartbeat.json.bak.1']), true));
expect('vorhandene Guild-Konfiguration ist nicht frisch', () => assert.equal(
  detectFreshInstall(['guild-configs.json']), false));
for (const marker of CONFIGURATION_MARKERS) {
  expect(`Marker ${marker} gilt als eingerichtet`, () => {
    assert.equal(detectFreshInstall([marker]), false);
  });
}
expect('nicht-Array gilt als frisch', () => assert.equal(detectFreshInstall(undefined), true));

// --- Kernentscheidung -----------------------------------------------------
expect('frische Installation startet NICHT', () => {
  const d = resolveAutoStart({ freshInstall: true, botTokenConfigured: true, oauthConfigured: true });
  assert.equal(d.shouldStart, false);
  assert.equal(d.reason, 'fresh-install');
});
expect('frische Installation startet auch bei Token NICHT', () => {
  assert.equal(resolveAutoStart({ freshInstall: true, botTokenConfigured: true }).shouldStart, false);
});
expect('manueller Modus verhindert Start auch nach Einrichtung', () => {
  const d = resolveAutoStart({ freshInstall: false, startMode: 'manual', botTokenConfigured: true, oauthConfigured: true });
  assert.equal(d.shouldStart, false);
  assert.equal(d.reason, 'manual-mode');
});
expect('eingerichtet + auto startet', () => {
  const d = resolveAutoStart({ freshInstall: false, startMode: 'auto', botTokenConfigured: true, oauthConfigured: true });
  assert.equal(d.shouldStart, true);
  assert.equal(d.reason, 'auto');
});
expect('ohne Token und ohne OAuth startet nichts', () => {
  const d = resolveAutoStart({ freshInstall: false, startMode: 'auto', botTokenConfigured: false, oauthConfigured: false });
  assert.equal(d.shouldStart, false);
  assert.equal(d.reason, 'not-configured');
});
expect('expliziter CLI-Start gewinnt immer', () => {
  const a = resolveAutoStart({ explicitStart: true, freshInstall: true, startMode: 'manual' });
  assert.equal(a.shouldStart, true);
  assert.equal(a.reason, 'explicit-start');
  assert.equal(resolveAutoStart({ explicitStart: true, freshInstall: false, startMode: 'manual' }).shouldStart, true);
});
expect('frisch meldet sich ehrlich zurueck', () => {
  assert.equal(resolveAutoStart({ explicitStart: true, freshInstall: true }).freshInstall, true);
  assert.equal(resolveAutoStart({ freshInstall: false }).freshInstall, false);
});

// --- Beschreibungen fuer die Oberflaeche ----------------------------------
expect('Beschreibung nennt den manuellen Modus', () => {
  assert.match(describeStartupMode({ startMode: 'manual' }), /nicht automatisch/i);
});
expect('Beschreibung nennt die frische Installation', () => {
  assert.match(describeStartupMode({ startMode: 'auto', freshInstall: true }), /Frische Installation/i);
});

// --- Einbau in den Hauptprozess ------------------------------------------
const main = read('desktop/main.cjs');
expect('Hauptprozess laedt die Startlogik', () => assert.match(main, /require\('\.\/startup-mode\.cjs'\)/));
expect('Auto-Start haengt an resolveAutoStart', () => assert.match(main, /resolveAutoStart\(\{/));
expect('frische Installation wird geprueft', () => assert.match(main, /isFreshInstall\(\)/));
expect('die alte Bedingung "Token vorhanden startet sofort" ist entfernt', () => {
  assert.doesNotMatch(main, /if \(process\.argv\.includes\('--start-bot'\) \|\| botTokenConfigured\)/);
});
expect('IPC fuer das Lesen und Setzen existiert', () => {
  assert.match(main, /ipcMain\.handle\('app:startup-mode'/);
  assert.match(main, /ipcMain\.handle\('app:startup-mode-set'/);
});
expect('ungueltige Modi werden abgelehnt', () => assert.match(main, /isValidStartMode\(requested\)/));

const preload = read('desktop/preload.cjs');
expect('die Bruecke exponiert beide Funktionen', () => {
  assert.match(preload, /getStartupMode:/);
  assert.match(preload, /setStartupMode:/);
});

const html = read('desktop/renderer/index.html');
expect('die Oberflaeche hat das Auswahlfeld', () => assert.match(html, /id="startup-mode-select"/));
expect('das Auswahlfeld hat ein Label', () => assert.match(html, /<label for="startup-mode-select">/));
expect('beide Modi sind waehlbar', () => {
  assert.match(html, /value="auto"/);
  assert.match(html, /value="manual"/);
});

const renderer = read('desktop/renderer/app.js');
expect('die Oberflaeche laedt und speichert den Modus', () => {
  assert.match(renderer, /api\.getStartupMode\(/);
  assert.match(renderer, /api\.setStartupMode\(/);
});

// --- Leck geschlossen: kein Start mit fremden Daten -----------------------
const supervisor = read('desktop/process-supervisor.cjs');
expect('gepackte App uebernimmt keine alten Serverdaten', () => {
  assert.match(supervisor, /!this\.isPackaged && targetEmpty/);
});
expect('gepackte App liest kein .env aus fremden Ordnern', () => {
  assert.match(supervisor, /if \(this\.isPackaged\) return \[path\.join\(this\.app\.getPath\('userData'\), '\.env'\)\]/);
});
expect('Entwicklungsmodus behaelt die Rueckfaelle', () => {
  assert.match(supervisor, /'Discord Bot', '\.env'/);
});
expect('isFreshInstall nutzt die gemeinsame Erkennung', () => {
  assert.match(supervisor, /detectFreshInstall\(entries\)/);
});

console.log('startup-mode-smoke: alle Pruefungen bestanden.');
void fileURLToPath;