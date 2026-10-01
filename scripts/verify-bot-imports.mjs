// Verifiziert ALLE lokalen Named-Imports von src/index.js und src/dashboard.js
// gegen die tatsächlichen Exports der Zielmodule. Genau dieser Fehlertyp
// (Name im _publicCallVoteInternals-Objekt statt als Named-Export) brachte den
// Bot beim Start zum Absturz – die Feature-Smokes decken ihn nicht ab, weil
// sie über das Internals-Objekt statt über Named-Imports zugreifen.
//
// Läuft im Release-Gate (npm run test:release).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceFiles = ['src/index.js', 'src/dashboard.js'];

const namedImportPattern = /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
const namespaceImportPattern = /import\s+\*\s+as\s+[^;]+\s+from\s*['"]([^'"]+)['"]/g;
const defaultImportPattern = /import\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g;

const problems = [];

const checkImports = async (file) => {
  const absolute = path.join(root, file);
  const source = fs.readFileSync(absolute, 'utf8');

  const targets = new Set();
  for (const match of source.matchAll(/from\s*['"](\.[^'"]+)['"]/g)) targets.add(match[1]);
  for (const match of source.matchAll(namedImportPattern)) targets.add(match[2]);
  for (const match of source.matchAll(namespaceImportPattern)) targets.add(match[1]);
  for (const match of source.matchAll(defaultImportPattern)) targets.add(match[2]);

  for (const target of targets) {
    if (!target.startsWith('./') && !target.startsWith('../')) continue;
    const resolved = path.resolve(path.dirname(absolute), target);
    // Nur lokale .js/.mjs/.cjs-Dateien im Projekt prüfen.
    if (!fs.existsSync(resolved) && !fs.existsSync(resolved + '.js')) continue;
    let moduleUrl = pathToFileURL(resolved);
    if (fs.existsSync(resolved + '.js')) moduleUrl = pathToFileURL(resolved + '.js');

    let namespace = null;
    try {
      namespace = await import(moduleUrl.href);
    } catch (error) {
      problems.push(`${file}: Modul ${target} konnte nicht geladen werden: ${error?.message || error}`);
      continue;
    }

    // Alle benannten Importe für dieses Ziel aus der Datei sammeln.
    for (const match of source.matchAll(namedImportPattern)) {
      if (match[2] !== target) continue;
      for (const rawName of match[1].split(',')) {
        const trimmed = rawName.trim();
        if (!trimmed) continue;
        const name = trimmed.includes(' as ') ? trimmed.split(' as ')[0].trim() : trimmed;
        if (!name || name === 'default') continue;
        if (typeof namespace[name] === 'undefined') {
          problems.push(`${file}: Import { ${name} } aus '${target}' existiert nicht (Modul hat es nicht als Named-Export).`);
        }
      }
    }
  }
};

await checkImports('src/index.js');
await checkImports('src/dashboard.js');

if (problems.length) {
  console.error('IMPORT-FEHLER GEFUNDEN:');
  for (const problem of problems) console.error(' - ' + problem);
  process.exit(1);
}
console.log('verify-bot-imports: alle lokalen Named-Imports von index.js und dashboard.js lösen auf.');
