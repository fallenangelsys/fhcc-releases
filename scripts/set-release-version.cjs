#!/usr/bin/env node
// Setzt eine explizite Zielversion fuer ein Release.
//
// Warum nicht scripts/bump-version.cjs: das Skript erhoeht ausschliesslich die
// Patch-Stufe. Ein Release, das eine neue Plattform und den verschluesselten
// Datenumzug einfuehrt, ist aber eine Minor-Version. Der Aufruf ist deshalb
// explizit:  node scripts/set-release-version.cjs 4.1.0
//
// Angepasst werden genau die Stellen, die eine Release-Pruefung liest:
//   package.json          version
//   package-lock.json     version + packages[""].version
//   desktop/renderer/index.html   Cache-Buster (?v=…) der App-Oberflaeche
//   bot-changelog.json    Eintrag fuer die neue Version
//
// Verweigert den Lauf bei ungueltigem Format, bei einer nicht groesseren
// Version und wenn der Changelog-Eintrag noch fehlt. Ein Release mit leerem
// Changelog zeigt im Update-Embed falsche Aenderungen an - deshalb ist das ein
// harter Fehler und kein Hinweis.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const writeJson = (relative, value) => fs.writeFileSync(path.join(root, relative), JSON.stringify(value, null, 2) + '\n', 'utf8');

const target = String(process.argv[2] || '').trim();
if (!/^\d+\.\d+\.\d+$/.test(target)) {
  console.error(`[set-release-version] Ungueltige Version: "${target}" (erwartet z. B. 4.1.0)`);
  process.exit(1);
}

const pkgPath = 'package.json';
const lockPath = 'package-lock.json';
const htmlPath = 'desktop/renderer/index.html';
const changelogPath = 'bot-changelog.json';

const pkg = readJson(pkgPath);
const current = String(pkg.version || '').trim();
const compare = (a, b) => {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1;
  }
  return 0;
};

if (!/^\d+\.\d+\.\d+$/.test(current)) {
  console.error(`[set-release-version] package.json traegt keine gueltige Version: "${current}"`);
  process.exit(1);
}
if (compare(target, current) <= 0) {
  console.error(`[set-release-version] Abbruch: ${target} ist nicht groesser als die aktuelle Version ${current}.`);
  process.exit(1);
}

pkg.version = target;
writeJson(pkgPath, pkg);
console.log(`[set-release-version] package.json ${current} -> ${target}`);

const lock = readJson(lockPath);
if (String(lock.version || '') === current) {
  lock.version = target;
  writeJson(lockPath, lock);
  console.log('[set-release-version] package-lock.json version aktualisiert.');
} else {
  console.log(`[set-release-version] package-lock.json version ist "${lock.version}" - unberuehrt.`);
}
if (lock.packages && lock.packages[''] && String(lock.packages[''].version || '') === current) {
  lock.packages[''].version = target;
  writeJson(lockPath, lock);
  console.log('[set-release-version] package-lock.json packages[""] aktualisiert.');
}

const htmlFile = path.join(root, htmlPath);
if (fs.existsSync(htmlFile)) {
  const raw = fs.readFileSync(htmlFile, 'utf8');
  // Nur die Ziffernfolge ersetzen. Ein aeusseres Gruppierungsmuster um den
  // gesamten Treffer wuerde das Praefix "?v=" ein zweites Mal anhaengen und
  // "?v=4.0.4?v=4.1.0" erzeugen.
  const updated = raw.replace(/(["'?&]v=)\d+\.\d+\.\d+(["'\s])/g, `$1${target}$2`);
  if (updated !== raw) {
    fs.writeFileSync(htmlFile, updated, 'utf8');
    console.log(`[set-release-version] Cache-Buster in ${htmlPath} auf ${target} gehoben.`);
  } else {
    console.log(`[set-release-version] Kein versionsgebundener Cache-Buster in ${htmlPath} gefunden.`);
  }
}

const changelogFile = path.join(root, changelogPath);
if (fs.existsSync(changelogFile)) {
  const changelog = readJson(changelogPath);
  const entries = Array.isArray(changelog.entries) ? changelog.entries : [];
  const exists = entries.some((entry) => String(entry?.version || '') === target);
  if (!exists) {
    console.error(`[set-release-version] Abbruch: bot-changelog.json hat keinen Eintrag fuer ${target}.`);
    console.error('  Erst den Eintrag schreiben, dann die Version setzen - das Update-Embed zeigt sonst falsche Aenderungen.');
    process.exit(1);
  }
  console.log(`[set-release-version] Changelog-Eintrag fuer ${target} ist vorhanden (${entries.find((e) => e.version === target).changes.length} Punkte).`);
}

console.log(`[set-release-version] ${current} -> ${target} abgeschlossen.`);
