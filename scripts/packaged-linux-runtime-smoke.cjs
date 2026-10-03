const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

assert.equal(process.platform, 'linux', 'Der Linux-Paket-Smoke-Test muss auf einem Linux-Host laufen.');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const dist = path.join(root, 'dist');
const appDir = path.join(dist, 'linux-unpacked');
const resources = path.join(appDir, 'resources');
const executable = path.join(appDir, 'fhcc');
const appAsar = path.join(resources, 'app.asar');
const runtimeProbe = path.join(appAsar, 'scripts', 'packaged-runtime-probe.cjs');
const sqliteNative = path.join(resources, 'app.asar.unpacked', 'node_modules', 'better-sqlite3', 'prebuilds', 'linux-x64.node');
// linux.artifactName in package.json gilt fuer JEDEN Linux-Target und setzt
// daher auch den deb-Namen auf FHCC-<version>-x64.deb. Der Fallback akzeptiert
// zusätzlich den FPM-Standardnamen, falls das Muster spaeter entfernt wird.
const findArtifact = (extension) => {
  const expectedName = `FHCC-${packageJson.version}-x64.${extension}`;
  const exactPath = path.join(dist, expectedName);
  if (fs.existsSync(exactPath)) return exactPath;
  const candidates = fs.readdirSync(dist).filter((name) => name.endsWith(`.${extension}`) && name.includes(packageJson.version));
  assert.equal(candidates.length, 1, `Linux-Artefakt ${extension} fehlt oder ist mehrdeutig: ${candidates.join(', ') || '(keine)'}`);
  return path.join(dist, candidates[0]);
};
const appImage = findArtifact('AppImage');
const deb = findArtifact('deb');
for (const file of [appImage, deb, executable, appAsar, sqliteNative]) {
  assert.ok(fs.existsSync(file), `Linux-Build-Artefakt fehlt: ${path.relative(root, file)}`);
}
assert.ok(fs.statSync(executable).mode & 0o111, 'Linux-App-Binary ist nicht ausführbar.');

// Erst der Wirts-seitige Vergleich: stimmt das Archiv nicht mit der Quelle
// überein, ist das Paket kaputt und der Runtime-Probe wäre nur die Folge.
{
  const verify = require('node:child_process').spawnSync(process.execPath, [
    path.join(root, 'scripts', 'verify-packaged-asar.cjs'),
    appAsar,
    'scripts/packaged-runtime-probe.cjs',
    'scripts/packaged-linux-runtime-smoke.cjs',
    'desktop/main.cjs',
    'src/index.js'
  ], { cwd: root, encoding: 'utf8', timeout: 60_000 });
  assert.equal(verify.status, 0, `Linux-Archivprüfung fehlgeschlagen.\n${verify.stderr || verify.stdout}`);
  console.log(String(verify.stdout || '').trim());
}

const probe = spawnSync(executable, [runtimeProbe], {
  cwd: appDir,
  encoding: 'utf8',
  timeout: 60_000,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
});
if (probe.status !== 0) {
  // Der Release-Workflow zeigt nur die ersten zehn Logzeilen als Annotation.
  // Deshalb muss der komplette Befund in EINER Zeile stehen, sonst bleibt nur
  // einFragment der Node-Fehlermeldung uebrig.
  console.error(`PROBE-FEHLER ${JSON.stringify({
    ausfuehrbar: executable,
    probe: runtimeProbe,
    cwd: appDir,
    exit: probe.status,
    signal: probe.signal,
    spawnFehler: probe.error ? String(probe.error.message || probe.error) : null,
    stdout: String(probe.stdout || '').slice(0, 1500),
    stderr: String(probe.stderr || '').slice(0, 1500)
  })}`);
}
assert.equal(probe.status, 0, `Linux-Runtime-Probe fehlgeschlagen.\n${probe.stderr || probe.stdout}`);
const result = JSON.parse(String(probe.stdout || '{}'));
assert.equal(result.packagedAsar, true, 'Runtime-Probe wurde nicht aus app.asar ausgeführt.');
assert.equal(result.ok, true, 'Gepackte Dateien oder better-sqlite3 sind nicht betriebsbereit.');
assert.equal(result.electron, packageJson.devDependencies.electron, 'Gepackte Electron-Version stimmt nicht mit package.json überein.');
assert.equal(result.platform, 'linux', 'Gepackter Runtime-Probe läuft nicht unter Linux.');
assert.equal(result.arch, 'x64', 'Linux-x64-Paket enthält eine falsche Architektur.');

console.log(`Linux-Paket-Smoke bestanden: AppImage, .deb und Electron ${result.electron} mit Linux-x64-SQLite-Binary sind vorhanden.`);
