// Reine Update-Prüflogik ohne Electron-Abhängigkeit – damit die Versions- und
// Manifest-Logik testbar bleibt (scripts/auto-update-smoke.mjs). Der Main-
// Prozess reicht die aktuelle App-Version einfach als Parameter durch.
const crypto = require('node:crypto');
const { existsSync, readdirSync, readFileSync, statSync } = require('node:fs');
const path = require('node:path');

const parseVersion = (value) => {
  const match = String(value || '').match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return { raw: match[0], parts: match.slice(1, 4).map((part) => Number(part) || 0) };
};

const isVersionNewer = (candidate, current) => {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let index = 0; index < 3; index += 1) {
    if (a.parts[index] !== b.parts[index]) return a.parts[index] > b.parts[index];
  }
  return false;
};

// latest.yml ist das minimale YAML von scripts/generate-update-manifest.cjs.
const parseLatestManifest = (text) => {
  const manifest = {};
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
    if (!match) continue;
    const key = match[1];
    const value = match[2].replace(/^['"]|['"]$/g, '');
    if (key === 'version') manifest.version = value;
    if (key === 'path') manifest.path = value;
    if (key === 'sha512') manifest.sha512 = value;
    if (key === 'releaseDate') manifest.releaseDate = value;
    if (key === 'url') manifest.url = value;
    if (key === 'size') manifest.size = Number(value) || 0;
  }
  return manifest;
};

const findUpdateArtifact = (folder) => {
  if (!folder || !existsSync(folder)) return null;
  try {
    const manifestPath = path.join(folder, 'latest.yml');
    let manifest = null;
    if (existsSync(manifestPath)) {
      manifest = parseLatestManifest(readFileSync(manifestPath, 'utf8'));
    } else {
      // Kein Manifest: bestes FHCC-Setup-*.exe im Ordner nehmen.
      const candidates = readdirSync(folder)
        .filter((name) => /^FHCC-Setup-\d+\.\d+\.\d+-x64\.exe$/i.test(name))
        .sort();
      const latest = candidates[candidates.length - 1];
      if (!latest) return null;
      const version = parseVersion(latest)?.raw;
      manifest = { version, path: latest, sha512: '', releaseDate: '' };
    }
    if (!manifest?.version) return null;
    const artifactName = String(manifest.path || `FHCC-Setup-${manifest.version}-x64.exe`);
    const artifactPath = path.join(folder, path.basename(artifactName));
    if (!existsSync(artifactPath)) return null;
    let size = 0;
    try { size = statSync(artifactPath).size; } catch {}
    return { manifest, artifactPath, artifactName: path.basename(artifactName), size };
  } catch (error) {
    return null;
  }
};

const checkForUpdate = (folder, currentVersion) => {
  const artifact = findUpdateArtifact(folder);
  const current = String(currentVersion || '');
  if (!artifact) {
    return { checked: true, current, available: false, folder: folder || '', reason: 'no-artifact' };
  }
  const available = isVersionNewer(artifact.manifest.version, current);
  return {
    checked: true,
    current,
    available,
    folder: folder || '',
    version: artifact.manifest.version,
    size: artifact.size || 0,
    releaseDate: artifact.manifest.releaseDate || '',
    artifactName: artifact.artifactName,
    sha512: artifact.manifest.sha512 || '',
    reason: available ? 'ready' : 'up-to-date'
  };
};

const verifyArtifactSha512 = (artifactPath, expectedSha512) => {
  if (!expectedSha512) return true; // Ohne Manifest kein Hash vorhanden.
  try {
    const digest = crypto.createHash('sha512').update(readFileSync(artifactPath)).digest('base64');
    return String(digest).toLocaleLowerCase('de-DE') === String(expectedSha512).toLocaleLowerCase('de-DE');
  } catch {
    return false;
  }
};

// Batch-Skript, das die App nach dem Beenden auf die neue Version hebt.
//
// NSIS scheitert unter Windows regelmäßig beim Deinstallieren der Vorversion:
// old-uninstaller.exe stirbt mit 0xC0000374 (Heap-Korruption in ntdll.dll),
// nachdem er die Dateien gelöscht hat. Ergebnis war zweimal (29./30.09.2026)
// eine leere Installation ohne Registry-Eintrag – ohne neue Version, ohne
// Rollback und ohne jede Meldung an den Nutzer. Darum:
//   1. auf das echte Beenden des App-Prozesses warten, nicht blind schlafen,
//   2. die Vorversion selbst entfernen (Registry-Eintrag + Installationsordner),
//      damit NSIS den abstürzenden Deinstaller gar nicht erst startet,
//   3. den stillen Lauf ausführen und danach das Ergebnis PRÜFEN,
//   4. bei fehlender Installation denselben Installer ohne /S erneut starten,
//      damit der Nutzer die Oberfläche sieht statt einer stillen Pleite.
const buildUpdateRunnerScript = ({ installer, installDir, logFile, exeName = 'FHCC.exe', appPid = 0 } = {}) => {
  const quoteBatch = (value) => String(value || '').replace(/"/g, '');
  // Registry-Einträge von electron-builder führen KEIN InstallLocation, sondern
  // nur UninstallString und DisplayIcon - deshalb alle drei Felder prüfen. Der
  // Ordner wird nur entfernt, wenn dort nachweislich unsere App liegt.
  const cleanup = [
    "$d = ('%FHCC_INSTALL_DIR%').TrimEnd('\\').ToLower()",
    "if (-not $d) { exit 0 }",
    "Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' | ForEach-Object {",
    '  $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue',
    '  if ($p -and (($p.InstallLocation -and $p.InstallLocation.TrimEnd(\'\\\').ToLower() -eq $d) -or ($p.UninstallString -and $p.UninstallString.ToLower().Contains($d)) -or ($p.DisplayIcon -and $p.DisplayIcon.ToLower().Contains($d)))) {',
    '    Remove-Item $_.PSPath -Recurse -Force -ErrorAction SilentlyContinue',
    '  }',
    '}',
    "if ((Test-Path '%FHCC_INSTALL_DIR%') -and (Test-Path '%FHCC_EXE%')) {",
    "  Remove-Item '%FHCC_INSTALL_DIR%' -Recurse -Force -ErrorAction SilentlyContinue",
    '}'
  ].join('; ');
  const lines = [
    '@echo off',
    'setlocal EnableExtensions',
    `set "FHCC_INSTALLER=${quoteBatch(installer)}"`,
    `set "FHCC_INSTALL_DIR=${quoteBatch(installDir)}"`,
    `set "FHCC_EXE=${quoteBatch(installDir)}\\${quoteBatch(exeName)}"`,
    `set "FHCC_LOG=${quoteBatch(logFile)}"`,
    '> "%FHCC_LOG%" echo FHCC-Update %DATE% %TIME%',
    `powershell -NoProfile -Command "try { Wait-Process -Id ${Number(appPid) || 0} -Timeout 60 -ErrorAction SilentlyContinue } catch {}" >nul 2>&1`,
    'timeout /t 3 /nobreak >nul',
    '>> "%FHCC_LOG%" echo Vorversion wird entfernt, damit der NSIS-Deinstaller nicht startet.',
    `powershell -NoProfile -Command "${cleanup}" >nul 2>&1`,
    'start "" /wait "%FHCC_INSTALLER%" /S --updated --force-run',
    'set "FHCC_RC=%ERRORLEVEL%"',
    '>> "%FHCC_LOG%" echo Stiller Lauf beendet, Code %FHCC_RC%',
    'if exist "%FHCC_EXE%" goto :verify',
    '>> "%FHCC_LOG%" echo Installation fehlt - Rueckfall mit Oberflaeche.',
    'start "" /wait "%FHCC_INSTALLER%"',
    'set "FHCC_RC2=%ERRORLEVEL%"',
    '>> "%FHCC_LOG%" echo Zweiter Lauf beendet, Code %FHCC_RC2%',
    ':verify',
    'if exist "%FHCC_EXE%" (',
    '  >> "%FHCC_LOG%" echo OK: %FHCC_EXE% vorhanden.',
    ') else (',
    '  >> "%FHCC_LOG%" echo FEHLER: %FHCC_EXE% fehlt weiterhin.',
    ')',
    'del "%~f0" >nul 2>&1'
  ];
  return `${lines.join('\r\n')}\r\n`;
};

module.exports = {
  parseVersion,
  isVersionNewer,
  parseLatestManifest,
  findUpdateArtifact,
  checkForUpdate,
  verifyArtifactSha512,
  buildUpdateRunnerScript
};
