const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(root, relative));
const packageJson = JSON.parse(read('package.json'));
const packageLock = JSON.parse(read('package-lock.json'));
const failures = [];
const warnings = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function warn(condition, message) {
  if (!condition) warnings.push(message);
}

function parseVersion(value) {
  const match = String(value || '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : [0, 0, 0];
}

function atLeast(value, target) {
  const left = parseVersion(value);
  const right = parseVersion(target);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return true;
}

const mainSource = read('desktop/main.cjs');
const supervisorSource = read('desktop/process-supervisor.cjs');
const botSource = read('src/index.js');
const publicDashboard = exists('public/aaa-dashboard.js') ? read('public/aaa-dashboard.js') : '';
const buildFiles = Array.isArray(packageJson.build?.files) ? packageJson.build.files : [];
const unpack = Array.isArray(packageJson.build?.asarUnpack) ? packageJson.build.asarUnpack : [];

// Erlaubt sind die 3.9-Nachfolge und ab 4.0.0 die neue Hauptlinie.
// Fest verdrahtet war hier vorher nur /^3\.9\.\d+$/, wodurch jede
// Hauptversion (z. B. 4.0.0) den Release blockiert haette.
check(/^(3\.9\.\d+|4\.\d+\.\d+)$/.test(String(packageJson.version || '')), 'App-Version muss auf einer gueltigen FHCC-Releaseversion liegen (3.9.x oder 4.x).');
check(packageJson.main === 'desktop/main.cjs', 'Electron-Haupteinstiegspunkt fehlt.');
check(packageJson.build?.asar === true, 'Produktionspaket muss ASAR verwenden.');
check(packageJson.build?.npmRebuild === false, 'Node-API-Prebuilds dürfen nicht durch einen ABI-gebundenen Electron-Rebuild ersetzt werden.');
check(unpack.some((entry) => String(entry).includes('better-sqlite3')), 'better-sqlite3 wird nicht aus ASAR entpackt.');
check(buildFiles.some((entry) => String(entry).includes('!**/.env')), '.env wird nicht sicher vom Paket ausgeschlossen.');
check(buildFiles.some((entry) => String(entry).includes('!data/**')), 'Produktive Daten werden nicht sicher vom Paket ausgeschlossen.');
check(buildFiles.some((entry) => String(entry).includes('!runtime/**')), 'Runtime-Daten werden nicht sicher vom Paket ausgeschlossen.');
check(mainSource.includes('isPackaged: app.isPackaged'), 'Supervisor erhält den echten Paketmodus nicht.');
check(!mainSource.includes('isPackaged: false'), 'Installierte App wird weiterhin als Entwicklung behandelt.');
check(supervisorSource.includes("ELECTRON_RUN_AS_NODE: '1'"), 'Gepackter Bot nutzt Electron nicht als gebündelte Node-Laufzeit.');
check(botSource.includes('process.env.FALLEN_HEAVEN_RUNTIME_DIR'), 'Bot-Runtime ist nicht vom schreibgeschützten App-Paket getrennt.');
check(!botSource.includes("app.get('*'"), 'Express-5-inkompatible Catch-all-Route ist noch vorhanden.');

for (const file of [
  'desktop/main.cjs',
  'desktop/preload.cjs',
  'desktop/process-supervisor.cjs',
  'desktop/renderer/index.html',
  'src/index.js',
  'src/runtime/launcher.cjs',
  'public/assets/fallen-heaven-app.ico',
  'public/assets/fallen-heaven-app-icon.png',
  'scripts/packaged-runtime-probe.cjs'
]) check(exists(file), `Erforderliche Release-Datei fehlt: ${file}`);

const lockedRoot = packageLock.packages?.[''] || {};
check(lockedRoot.version === packageJson.version, 'package-lock.json enthält eine andere App-Version.');
for (const [name, requested] of Object.entries(packageJson.dependencies || {})) {
  const installed = packageLock.packages?.[`node_modules/${name}`]?.version;
  check(Boolean(installed), `Produktionsabhängigkeit fehlt im Lockfile: ${name}`);
  if (/^\d/.test(String(requested))) check(installed === requested, `${name} ist nicht exakt auf ${requested} gesperrt.`);
}

try {
  const sqlitePackage = JSON.parse(read('node_modules/better-sqlite3/package.json'));
  check(Number(String(sqlitePackage.version || '0').split('.')[0]) >= 13, 'ABI-unabhängige SQLite-Paketgeneration 13 oder neuer ist erforderlich.');
  check(exists('node_modules/better-sqlite3/prebuilds/win32-x64.node'), 'Windows-x64-Node-API-Binary für SQLite fehlt.');
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  const row = db.prepare('SELECT 1 AS ready').get();
  db.close();
  check(row?.ready === 1, 'Native SQLite-Probe lieferte ein falsches Ergebnis.');
} catch (error) {
  failures.push(`Native SQLite-Probe fehlgeschlagen: ${error.message}`);
}

warn(atLeast(process.versions.node, '24.17.0'), `Lokales Node ${process.versions.node} liegt unter der empfohlenen Version 24.17.0.`);
warn(Boolean(process.env.CSC_LINK || process.env.WIN_CSC_LINK || process.env.AZURE_TENANT_ID), 'Windows-Code-Signierung ist für diesen Build nicht konfiguriert.');
warn(!publicDashboard.includes('Coming soon'), 'Das separate Web-Dashboard enthält noch einen unfertigen Team-Bereich.');
warn(exists('.git'), 'Der Arbeitsordner besitzt noch keine Git-Versionshistorie.');

console.log(`Release-Prüfung: ${Object.keys(packageJson.dependencies || {}).length} Produktionspakete, ASAR aktiv, Node-API-Datenbank bereit.`);
for (const message of warnings) console.log(`HINWEIS: ${message}`);
if (failures.length) {
  for (const message of failures) console.error(`FEHLER: ${message}`);
  process.exitCode = 1;
} else {
  console.log(`Release-Prüfung bestanden (${warnings.length} nicht blockierende Hinweise).`);
}
