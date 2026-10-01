import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  parseVersion,
  isVersionNewer,
  parseLatestManifest,
  findUpdateArtifact,
  checkForUpdate,
  verifyArtifactSha512,
  buildUpdateRunnerScript
} = require('../desktop/update-check.cjs');

let passed = 0;
const ok = (name) => { passed += 1; console.log('  ✓ ' + name); };

// 1. Versionsvergleich
assert.deepEqual(parseVersion('3.9.96'), { raw: '3.9.96', parts: [3, 9, 96] });
assert.equal(parseVersion('garbage'), null);
assert.equal(isVersionNewer('3.9.97', '3.9.96'), true);
assert.equal(isVersionNewer('3.10.0', '3.9.99'), true);
assert.equal(isVersionNewer('3.9.96', '3.9.96'), false);
assert.equal(isVersionNewer('3.9.95', '3.9.96'), false);
ok('Versionsvergleich (major/minor/patch, Gleichstand, älter/neuer)');

// 2. latest.yml parsen
const yaml = [
  'version: 3.9.97',
  'files:',
  '  - url: FHCC-Setup-3.9.97-x64.exe',
  '    sha512: abc123',
  '    size: 143000000',
  'path: FHCC-Setup-3.9.97-x64.exe',
  "sha512: 'def456'",
  "releaseDate: '2026-08-11T10:00:00.000Z'",
  ''
].join('\n');
const manifest = parseLatestManifest(yaml);
assert.equal(manifest.version, '3.9.97');
assert.equal(manifest.path, 'FHCC-Setup-3.9.97-x64.exe');
assert.equal(manifest.sha512, 'def456'); // Top-Level, nicht aus der files-Liste
assert.equal(manifest.size, 143000000);
assert.ok(manifest.releaseDate.includes('2026-08-11'));
ok('latest.yml-Parsing (Top-Level-Felder, Dateiliste ignoriert)');

// 3. Artifact-Erkennung + Update-Check gegen echten Ordner
const dir = mkdtempSync(path.join(tmpdir(), 'fhcc-update-test-'));
try {
  const artifactPath = path.join(dir, 'FHCC-Setup-3.9.97-x64.exe');
  writeFileSync(artifactPath, Buffer.alloc(4096, 7));
  const realSha = createHash('sha512').update(Buffer.alloc(4096, 7)).digest('base64');
  writeFileSync(path.join(dir, 'latest.yml'), yaml.replace('def456', realSha));

  const artifact = findUpdateArtifact(dir);
  assert.ok(artifact, 'Artifact gefunden');
  assert.equal(artifact.artifactName, 'FHCC-Setup-3.9.97-x64.exe');
  assert.equal(artifact.size, 4096);

  const result = checkForUpdate(dir, '3.9.96');
  assert.equal(result.available, true);
  assert.equal(result.version, '3.9.97');
  assert.equal(result.reason, 'ready');
  ok('Update verfügbar erkannt (neue Version im Ordner)');

  const upToDate = checkForUpdate(dir, '3.9.97');
  assert.equal(upToDate.available, false);
  assert.equal(upToDate.reason, 'up-to-date');
  ok('Gleiche Version → up-to-date');

  assert.equal(checkForUpdate(dir, '3.9.98').available, false);
  ok('Älteres Paket → kein Update');

  assert.equal(checkForUpdate(path.join(dir, 'leer'), '3.9.96').reason, 'no-artifact');
  ok('Leerer/fehlender Ordner → no-artifact');

  // 4. SHA-512-Verifikation
  assert.equal(verifyArtifactSha512(artifactPath, realSha), true);
  assert.equal(verifyArtifactSha512(artifactPath, 'Y2FwdHVyZQ=='), false);
  assert.equal(verifyArtifactSha512(artifactPath, ''), true); // kein Manifest-Hash → überspringen
  ok('SHA-512-Prüfung (korrekt / falsch / fehlend)');

  // 5. Ohne latest.yml: EXE-Scan als Fallback
  const dir2 = mkdtempSync(path.join(tmpdir(), 'fhcc-update-test2-'));
  writeFileSync(path.join(dir2, 'FHCC-Setup-3.9.98-x64.exe'), Buffer.alloc(16));
  const fallback = checkForUpdate(dir2, '3.9.96');
  assert.equal(fallback.available, true);
  assert.equal(fallback.version, '3.9.98');
  ok('EXE-Scan-Fallback ohne latest.yml');
  rmSync(dir2, { recursive: true, force: true });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// 6. Update-Ausführungsskript: NSIS stürzt unter Windows beim Deinstallieren
// der Vorversion regelmäßig mit 0xC0000374 (Heap-Korruption in
// old-uninstaller.exe) ab – die Dateien sind dann gelöscht, die neue Version
// aber nie geschrieben. Produktionsfall 30.09.2026: stille Aktualisierung
// räumte FHCC auf und hinterließ nichts; der interaktive Lauf scheiterte an
// derselben Deinstallation. Das Skript muss das Ergebnis deshalb prüfen und
// selbstständig interaktiv nachinstallieren, statt still zu scheitern.
const runner = buildUpdateRunnerScript({
  installer: 'C:\\Users\\5gtag\\Documents\\Discord Bot\\Temp\\FHCC-Updates\\FHCC-Setup-3.9.318-x64.exe',
  installDir: 'C:\\Users\\5gtag\\AppData\\Local\\Programs\\FHCC',
  logFile: 'C:\\Users\\5gtag\\AppData\\Local\\Temp\\FHCC-Updates\\last-update.log',
  appPid: 4321
});
assert.ok(runner.includes('set "FHCC_INSTALLER=C:\\Users\\5gtag\\Documents\\Discord Bot\\Temp\\FHCC-Updates\\FHCC-Setup-3.9.318-x64.exe"'), 'Pfade mit Leerzeichen werden quotiert übernommen');
assert.ok(runner.includes('Wait-Process -Id 4321'), 'wartet auf das echte Beenden der App statt blind zu warten');
const runnerLines = runner.split('\r\n');
const startLine = 'start "" /wait "%FHCC_INSTALLER%"';
const silentRuns = runnerLines.filter((line) => line.startsWith(startLine) && line.includes('/S'));
const interactiveRuns = runnerLines.filter((line) => line === startLine);
assert.equal(silentRuns.length, 1, 'der erste Lauf bleibt still');
assert.equal(interactiveRuns.length, 1, 'bei fehlender Installation folgt genau ein interaktiver zweiter Lauf');
assert.ok(runnerLines.indexOf(interactiveRuns[0]) > runnerLines.indexOf(silentRuns[0]), 'der Rückfall läuft erst nach der Ergebnisprüfung');
assert.ok(runner.includes('if exist "%FHCC_EXE%" goto :verify'), 'das Ergebnis wird geprüft, bevor quittiert wird');
assert.ok(runner.includes('CurrentVersion\\Uninstall') && runner.includes('Remove-Item'), 'die Vorversion wird vor dem Installer entfernt, damit der abstürzende Deinstaller nicht startet');
// electron-builder schreibt beim Deinstall-Schlüssel KEIN InstallLocation
// (nur UninstallString und DisplayIcon). Wer nur darauf prüft, findet den
// Geistereintrag nicht und der zweite Lauf scheitert mit demselben Fehler.
assert.ok(runner.includes('UninstallString') && runner.includes('DisplayIcon'), 'der Registry-Abgleich prüft UninstallString und DisplayIcon mit, nicht nur InstallLocation');
assert.ok(runner.includes('.Contains($d)'), 'der Abgleich arbeitet mit Teilstring-Prüfung des Installationsordners');
assert.ok(runner.includes("if (-not $d) { exit 0 }"), 'ohne bekannten Installationsordner wird nichts gelöscht');
assert.ok(
  runner.indexOf("Test-Path '%FHCC_EXE%'") < runner.indexOf("Remove-Item '%FHCC_INSTALL_DIR%' -Recurse"),
  'der Installationsordner wird nur entfernt, wenn nachweislich die App darin liegt'
);
assert.ok(runner.indexOf('Vorversion wird entfernt') < runner.indexOf('/S --updated --force-run'), 'das Aufräumen passiert VOR dem stillen Installationslauf');
assert.ok(runner.includes('> "%FHCC_LOG%"'), 'der Lauf wird nachvollziehbar protokolliert');
assert.ok(runner.includes('\r\n') && !/[^\r]\n/.test(runner), 'Zeilenumbrüche CRLF für die Batch-Datei');
ok('Update-Skript: Ergebnisprüfung, interaktiver Rückfall und Aufräumen des Geisterzustands');

console.log(`\nAuto-Update-Smoke: ${passed} Prüfungen bestanden.`);
