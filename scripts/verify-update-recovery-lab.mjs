// Laborprüfung des Vorab-Aufräumens aus dem Update-Skript. Drei Fälle mit
// echten (temporären) Registry-Schlüsseln, danach alles wieder entfernt:
//   A) Geisterzustand: leerer Ordner + Deinstall-Schlüssel -> Schluessel weg
//   B) vollstaendige Alt-Installation (mit FHCC.exe)       -> Ordner weg
//   C) fremder Ordner ohne FHCC.exe                         -> bleibt stehen
// Die echte FHCC-Installation wird nie angefasst.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildUpdateRunnerScript } = require('../desktop/update-check.cjs');

const root = path.join(process.env.TEMP, 'fhcc-cleanup-lab');
const keyBase = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\';
const realDir = path.join(process.env.LOCALAPPDATA, 'Programs', 'FHCC');

const reg = (...args) => {
  try { execFileSync('reg.exe', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); return true; } catch { return false; }
};
const regHas = (key) => {
  try { return execFileSync('reg.exe', ['query', key], { encoding: 'utf8' }).includes('DisplayName'); } catch { return false; }
};
const ps = (code) => execFileSync('powershell.exe', ['-NoProfile', '-Command', code], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const preCleanCommand = (installDir, exeName = 'FHCC.exe') => {
  const runner = buildUpdateRunnerScript({ installer: 'C:\\x\\a.exe', installDir, logFile: 'C:\\x\\l.log', appPid: 4321 });
  const line = runner.split('\r\n').find((entry) => entry.includes('CurrentVersion'));
  return line.slice(line.indexOf('-Command "') + 10, line.lastIndexOf('" >nul'))
    .replace(/%FHCC_INSTALL_DIR%/g, installDir)
    .replace(/%FHCC_EXE%/g, path.join(installDir, exeName));
};

rmSync(root, { recursive: true, force: true });
for (const name of ['fhcclaba', 'fhcclabb', 'fhcclabc']) reg('delete', keyBase + name, '/f');

// --- Fall A: Geisterzustand
const dirA = path.join(root, 'A', 'FHCC');
mkdirSync(dirA, { recursive: true });
reg('add', keyBase + 'fhcclaba', '/v', 'UninstallString', '/t', 'REG_SZ', '/d', `${dirA}\\Uninstall FHCC.exe /currentuser`, '/f');
reg('add', keyBase + 'fhcclaba', '/v', 'DisplayIcon', '/t', 'REG_SZ', '/d', `${dirA}\\FHCC.exe,0`, '/f');
reg('add', keyBase + 'fhcclaba', '/v', 'DisplayName', '/t', 'REG_SZ', '/d', 'FHCC LaborA', '/f');

// --- Fall B: vollstaendige Alt-Installation
const dirB = path.join(root, 'B', 'FHCC');
mkdirSync(dirB, { recursive: true });
writeFileSync(path.join(dirB, 'FHCC.exe'), 'x');
reg('add', keyBase + 'fhcclabb', '/v', 'UninstallString', '/t', 'REG_SZ', '/d', `"${dirB}\\Uninstall FHCC.exe" /currentuser`, '/f');
reg('add', keyBase + 'fhcclabb', '/v', 'DisplayName', '/t', 'REG_SZ', '/d', 'FHCC LaborB', '/f');

// --- Fall C: fremder Ordner (keine App darin) + fremder Registry-Eintrag
const dirC = path.join(root, 'C', 'FremdeApp');
mkdirSync(dirC, { recursive: true });
reg('add', keyBase + 'fhcclabc', '/v', 'UninstallString', '/t', 'REG_SZ', '/d', '"C:\\Sonstiges\\FremdeApp\\Uninstall.exe"', '/f');
reg('add', keyBase + 'fhcclabc', '/v', 'DisplayName', '/t', 'REG_SZ', '/d', 'Fremde App', '/f');

ps(preCleanCommand(dirA));
ps(preCleanCommand(dirB));
ps(preCleanCommand(dirC));

console.log('Ergebnis des Vorab-Aufräumens:');
console.log('  A Geister-Schluessel weg:', !regHas(keyBase + 'fhcclaba'), '<-- entscheidend: ohne Eintrag startet NSIS keinen Deinstaller');
console.log('  A leerer Ordner bleibt :', existsSync(dirA), '(Schutzsperre: nur löschen, wenn nachweislich die App darin liegt)');
console.log('  B Alt-Installation weg  :', !existsSync(dirB), '(genau das ist der Zweck: NSIS startet den Deinstaller nicht)');
console.log('  B Schluessel weg        :', !regHas(keyBase + 'fhcclabb'));
console.log('  C fremder Ordner bleibt :', existsSync(dirC));
console.log('  C fremder Eintrag bleibt:', regHas(keyBase + 'fhcclabc'));
console.log('  Echte FHCC.exe da       :', existsSync(path.join(realDir, 'FHCC.exe')));

for (const name of ['fhcclaba', 'fhcclabb', 'fhcclabc']) reg('delete', keyBase + name, '/f');
rmSync(root, { recursive: true, force: true });
console.log('\nLabor aufgeraeumt:', !existsSync(root));
