// Installationsvorbereitung fuer den manuellen Weg: stoppt FHCC und wendet
// exakt die Vorab-Entfernung an, die das Release jetzt bei jedem Auto-Update
// benutzt. Damit startet der abstuerzende NSIS-Deinstaller nicht und der
// Installer legt die neue Version direkt auf. Nutzerdaten in %APPDATA% werden
// nicht beruehrt. Erfordert --apply, damit es nicht versehentlich loescht.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildUpdateRunnerScript } = require('../desktop/update-check.cjs');

const installDir = path.join(process.env.LOCALAPPDATA, 'Programs', 'FHCC');
const regQuery = (key) => {
  try { return execFileSync('reg.exe', ['query', key], { encoding: 'utf8' }); } catch { return ''; }
};

// Das Skript beendet die App und loescht den Installationsordner. Ohne
// ausdrueckliches --apply passiert deshalb nichts - sonst waere es eine
// Falle, die beim verseentlichen Aufruf die Installation zerlegt.
if (!process.argv.includes('--apply')) {
  console.log('Abbruch: dieses Skript beendet FHCC und entfernt die alte Installation.');
  console.log(`Ziel: ${installDir}`);
  console.log('Aufruf zum Ausfuehren:  node scripts/prepare-clean-install.mjs --apply');
  process.exit(0);
}

console.log('Vorher:');
console.log('  FHCC.exe      :', existsSync(path.join(installDir, 'FHCC.exe')));
console.log('  Registry-Einträge:', regQuery('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall').split('\r\n').filter((line) => line.includes('FHCC')).length);

// 1. App beenden
try {
  execFileSync('taskkill.exe', ['/F', '/IM', 'FHCC.exe'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  console.log('\nFHCC beendet.');
} catch (error) {
  console.log('\nFHCC lief nicht:', String(error.stdout || '').trim().split('\n')[0] || '');
}

// 2. Vorab-Entfernung exakt aus dem ausgelieferten Update-Skript ziehen
const runner = buildUpdateRunnerScript({ installer: 'C:\\x\\a.exe', installDir, logFile: 'C:\\x\\l.log', appPid: 0 });
const line = runner.split('\r\n').find((entry) => entry.includes('CurrentVersion'));
const command = line.slice(line.indexOf('-Command "') + 10, line.lastIndexOf('" >nul'))
  .replace(/%FHCC_INSTALL_DIR%/g, installDir)
  .replace(/%FHCC_EXE%/g, path.join(installDir, 'FHCC.exe'));
execFileSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

console.log('\nNachher:');
console.log('  FHCC.exe                    :', existsSync(path.join(installDir, 'FHCC.exe')));
console.log('  Registry-Einträge mit FHCC  :', regQuery('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall').split('\r\n').filter((l) => l.includes('FHCC')).length);
console.log('  Nutzerdaten vorhanden       :', existsSync(path.join(process.env.APPDATA, 'FALLEN HEAVEN Control Center', 'runtime', 'data', 'boost-role-ledger.json')));
