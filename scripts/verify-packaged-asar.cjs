const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');

// Prueft OHNE Electron, ob das gebaute app.asar wirklich die gebauten Quellen
// enthaelt. Im Release-Build lieferte Electron aus dem Archiv den Inhalt einer
// Nachbardatei - diese Pruefung trennt "das Archiv ist kaputt" (hier) von
// "Electron liest das Archiv falsch" (im Runtime-Probe danach).
const files = process.argv.slice(2);
if (!files.length) {
  console.error('Aufruf: verify-packaged-asar.cjs <app.asar> <datei-im-archiv> ...');
  process.exit(2);
}

const archive = path.resolve(files[0]);
const root = path.resolve(__dirname, '..');

if (!fs.existsSync(archive)) {
  console.error(`ASAR-PRUEFUNG: ${archive} fehlt.`);
  process.exit(1);
}

const problems = [];
for (const entry of files.slice(1)) {
  const inside = entry.split('/').join(path.sep);
  const source = path.join(root, inside);
  let archived = null;
  try {
    archived = asar.extractFile(archive, inside);
  } catch (error) {
    problems.push(`${entry}: nicht im Archiv lesbar (${error.message})`);
    continue;
  }
  if (!fs.existsSync(source)) {
    problems.push(`${entry}: Quelle fehlt im Arbeitsordner - Vergleich nicht möglich.`);
    continue;
  }
  const original = fs.readFileSync(source);
  if (!archived.equals(original)) {
    problems.push(
      `${entry}: Archiv-Inhalt weicht ab (Archiv ${archived.length} Bytes, Quelle ${original.length} Bytes, `
      + `Archiv-Anfang ${JSON.stringify(archived.toString('utf8', 0, 60))})`
    );
  }
}

if (problems.length) {
  console.error(`ASAR-PRUEFUNG fehlgeschlagen (${problems.length}):`);
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}
console.log(`ASAR-PRUEFUNG bestanden: ${files.length - 1} Datei(en) im app.asar stimmen mit der Quelle überein (${archive}).`);
