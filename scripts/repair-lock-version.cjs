const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const lockPath = path.join(root, 'package-lock.json');
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
const appVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

let repaired = 0;
for (const [location, entry] of Object.entries(lock.packages || {})) {
  // Abhaengigkeiten bekommen ihre Version aus node_modules, nicht aus dem
  // App-Versionsfeld. Nur die beiden Root-Eintraege gehoeren zur App-Version.
  if (!location) continue;
  const installed = path.join(root, location, 'package.json');
  if (!fs.existsSync(installed)) continue;
  let real;
  try { real = JSON.parse(fs.readFileSync(installed, 'utf8')).version; } catch { continue; }
  if (!real || entry.version === real) continue;
  console.log(`  ${location}: ${entry.version} -> ${real}`);
  entry.version = real;
  repaired += 1;
}

lock.version = appVersion;
if (lock.packages['']) lock.packages[''].version = appVersion;
fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n', 'utf8');

console.log(`[repair-lock] App-Version ${appVersion}, ${repaired} Abhaengigkeit(en) korrigiert.`);
process.exit(0);