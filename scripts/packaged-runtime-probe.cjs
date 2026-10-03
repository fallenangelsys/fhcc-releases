const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..');
const requiredFiles = [
  'desktop/main.cjs',
  'desktop/renderer/index.html',
  'src/index.js',
  'src/runtime/launcher.cjs',
  'public/index.html'
];
const missing = requiredFiles.filter((relative) => !fs.existsSync(path.join(appRoot, relative)));

let sqlite = null;
try {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  sqlite = db.prepare('SELECT sqlite_version() AS version, 1 AS ready').get();
  db.close();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    stage: 'better-sqlite3',
    error: error.message,
    versions: process.versions,
    appRoot,
    missing
  }, null, 2));
  process.exit(1);
}

const result = {
  ok: missing.length === 0 && sqlite?.ready === 1,
  packagedAsar: appRoot.toLowerCase().includes('app.asar'),
  appRoot,
  missing,
  sqlite: sqlite?.version || null,
  node: process.versions.node,
  electron: process.versions.electron || null,
  platform: process.platform,
  arch: process.arch,
  modules: process.versions.modules
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
