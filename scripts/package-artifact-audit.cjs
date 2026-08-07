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

for (const target of [appAsar, installer, blockmap, manifest, nativeSqlite]) {
  assert.ok(fs.existsSync(target), `Release-Artefakt fehlt: ${path.relative(root, target)}`);
}

const entries = asar.listPackage(appAsar).map((entry) => entry.replaceAll('\\', '/').replace(/^\/+/, ''));
for (const required of [
  'desktop/main.cjs',
  'desktop/renderer/index.html',
  'src/index.js',
  'src/runtime/launcher.cjs',
  'scripts/packaged-runtime-probe.cjs'
]) assert.ok(entries.includes(required), `Datei fehlt in app.asar: ${required}`);

const forbidden = entries.filter((entry) =>
  /(^|\/)\.env(?:\.|$)/i.test(entry) ||
  /^(?:data|runtime)(?:\/|$)/i.test(entry) ||
  /(?:^|\/)runtime\/backups(?:\/|$)/i.test(entry)
);
assert.deepEqual(forbidden, [], `Private Dateien wurden paketiert: ${forbidden.join(', ')}`);

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
  asarEntries: entries.length,
  nativeSqliteBytes: fs.statSync(nativeSqlite).size,
  privateFilesPackaged: forbidden.length,
  updateManifest: path.basename(manifest)
}, null, 2));
