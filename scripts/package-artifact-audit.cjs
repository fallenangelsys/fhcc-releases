const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const dist = path.join(root, 'dist');
const appAsar = path.join(dist, 'win-unpacked', 'resources', 'app.asar');
const installerName = `FHCC-Setup-${packageJson.version}-x64.exe`;
const installer = path.join(dist, installerName);
const blockmap = installer + '.blockmap';
const manifest = path.join(dist, 'latest.yml');
const nativeSqlite = path.join(dist, 'win-unpacked', 'resources', 'app.asar.unpacked', 'node_modules', 'better-sqlite3', 'prebuilds', 'win32-x64.node');

// win-unpacked wird nach dem Build aufgeräumt (cleanup-dist.cjs), um Platz zu
// sparen. Direkt nach dem Build läuft der Audit vollständig (inkl. asar), im
// aufgeräumten Zustand werden die Installer-/Manifest-Checks weiter erzwungen
// und die asar-internen Checks übersprungen – nicht stillschweigend geschwächt.
const hasUnpacked = fs.existsSync(appAsar);
for (const target of [installer, blockmap, manifest, ...(hasUnpacked ? [appAsar, nativeSqlite] : [])]) {
  assert.ok(fs.existsSync(target), `Release-Artefakt fehlt: ${path.relative(root, target)}`);
}

let asarEntries = 0;
let forbidden = [];
if (hasUnpacked) {
  const entries = asar.listPackage(appAsar).map((entry) => entry.replaceAll('\\', '/').replace(/^\/+/, ''));
  asarEntries = entries.length;
  for (const required of [
    'desktop/main.cjs',
    'desktop/renderer/index.html',
    'src/index.js',
    'src/runtime/launcher.cjs',
    'scripts/packaged-runtime-probe.cjs'
  ]) assert.ok(entries.includes(required), `Datei fehlt in app.asar: ${required}`);

  // Verbotene Einträge: private Dateien UND veraltete/entfernte Quellkopien.
  // .check-installed/ enthält z.B. die gelöschte AI-Codebasis (aiChat, aiRouter,
  // webSearch, src/ai/…) – die darf nie wieder ins Paket. docs/ und harness/
  // sind reine Entwicklungs-Artefakte ohne Laufzeitbezug.
  forbidden = entries.filter((entry) =>
    /(^|\/)\.env(?:\.|$)/i.test(entry) ||
    /^(?:data|runtime)(?:\/|$)/i.test(entry) ||
    /(?:^|\/)runtime\/backups(?:\/|$)/i.test(entry) ||
    /^\.check-installed(?:\/|$)/.test(entry) ||
    /^docs(?:\/|$)/.test(entry) ||
    /^harness(?:\/|$)/.test(entry) ||
    /(?:^|\/)src\/ai(?:\/|$)/.test(entry) ||
    /(?:^|\/)src\/features\/(?:aiChat|aiRouter|webSearch|ollama[^/]*)\.js$/.test(entry) ||
    /(?:^|\/)scripts\/ai-[^/]+\.mjs$/.test(entry)
  );
  assert.deepEqual(forbidden, [], `Verbotene/veraltete Dateien wurden paketiert: ${forbidden.join(', ')}`);
} else {
  console.log('[package-artifact-audit] win-unpacked wurde bereits aufgeräumt – asar-interne Checks übersprungen (im Build laufen sie vollständig).');
}

const manifestText = fs.readFileSync(manifest, 'utf8');
const installerBytes = fs.readFileSync(installer);
const sha512 = crypto.createHash('sha512').update(installerBytes).digest('base64');
const sha256 = crypto.createHash('sha256').update(installerBytes).digest('hex').toUpperCase();
assert.match(manifestText, new RegExp(`^version: ${packageJson.version.replaceAll('.', '\\.')}\r?$`, 'm'));
assert.ok(manifestText.includes(`path: ${installerName}`));
assert.ok(manifestText.includes(`sha512: ${sha512}`));

console.log(JSON.stringify({
  ok: true,
  version: packageJson.version,
  installer: installerName,
  installerBytes: installerBytes.length,
  installerMiB: Math.round(installerBytes.length / 104857.6) / 10,
  sha256,
  asarEntries,
  nativeSqliteBytes: hasUnpacked ? fs.statSync(nativeSqlite).size : 0,
  privateFilesPackaged: forbidden.length,
  leftoverFilesPackaged: forbidden.length,
  updateManifest: path.basename(manifest)
}, null, 2));
