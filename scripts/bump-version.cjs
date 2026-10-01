#!/usr/bin/env node
// Erhöht die Patch-Version vor jedem Build (3.9.67 -> 3.9.68 -> 3.9.69 …).
// Aktualisiert package.json, package-lock.json und die Renderer-Preview-Ersetzung,
// damit jede gebaute EXE eine eigene, aufsteigende Versionsnummer trägt.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const packagePath = path.join(root, 'package.json');
const lockPath = path.join(root, 'package-lock.json');
const appPath = path.join(root, 'desktop', 'renderer', 'app.js');

const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const current = String(pkg.version || '3.9.0').trim();
const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(current);
if (!match) {
  console.error(`[bump-version] Ungültiges Versionsformat: "${current}"`);
  process.exit(1);
}
const next = `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;

pkg.version = next;
fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

for (const file of [lockPath]) {
  if (!fs.existsSync(file)) continue;
  const raw = fs.readFileSync(file, 'utf8');
  const updated = raw
    .replace(new RegExp(`("version"\\s*:\\s*")${escapeRegExp(current)}(")`, 'g'), `$1${next}$2`);
  if (updated !== raw) fs.writeFileSync(file, updated, 'utf8');
}

// Renderer-Live-Vorschau: {version} mit der echten Version ersetzen.
if (fs.existsSync(appPath)) {
  let appSource = fs.readFileSync(appPath, 'utf8');
  const pattern = new RegExp(`replaceAll\\('\\{version\\}', '[^']*'\\)`);
  if (pattern.test(appSource)) {
    appSource = appSource.replace(pattern, `replaceAll('{version}', '${next}')`);
    fs.writeFileSync(appPath, appSource, 'utf8');
  }
}

// Cache-Buster (?v=…) in allen HTML-Dateien auf die neue Version heben.
// Nur desktop/renderer/index.html ist die echte App-Oberfläche – die frühere
// Root-Kopie war totes Gewicht im Installer und wurde entfernt.
for (const htmlFile of ['desktop/renderer/index.html']) {
  const file = path.join(root, htmlFile);
  if (!fs.existsSync(file)) continue;
  const raw = fs.readFileSync(file, 'utf8');
  const updated = raw.replace(
    /(["'?&]v=)(\d+\.\d+\.\d+)(["'\s])/g,
    `$1${next}$3`
  );
  if (updated !== raw) fs.writeFileSync(file, updated, 'utf8');
}

// Changelog-Sicherheit: Jede gebaute EXE muss einen passenden Changelog-Eintrag
// haben, sonst zeigt das Update-Embed die falsche Version an. Falls für die neue
// Version noch kein Eintrag existiert, wird ein Platzhalter (Inhalt = neuester
// Eintrag) angelegt – die echten Punkte schreibe ich vor dem Build für die
// erwartete Version in bot-changelog.json.
const changelogPath = path.join(root, 'bot-changelog.json');
if (fs.existsSync(changelogPath)) {
  try {
    const changelog = JSON.parse(fs.readFileSync(changelogPath, 'utf8'));
    const entries = Array.isArray(changelog.entries) ? changelog.entries : [];
    const already = entries.some((entry) => String(entry?.version || '') === next);
    if (!already) {
      const base = entries.find((entry) => String(entry?.version || '') === current) || entries[0] || null;
      entries.unshift({
        version: next,
        date: new Date().toISOString().slice(0, 10),
        changes: Array.isArray(base?.changes) ? [...base.changes] : ['Automatisch generierter Changelog-Eintrag.']
      });
      changelog.entries = entries;
      fs.writeFileSync(changelogPath, JSON.stringify(changelog, null, 2) + '\n', 'utf8');
      console.log(`[bump-version] Changelog-Eintrag für ${next} ergänzt.`);
    }
  } catch (error) {
    console.warn(`[bump-version] Changelog konnte nicht aktualisiert werden: ${error?.message || error}`);
  }
}

console.log(`[bump-version] ${current} -> ${next}`);
process.exit(0);

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
