// Wiederherstellung von Quelldateien aus einem installierten app.asar.
//
// WICHTIG: Das schreibt ausschliesslich in das angegebene Zielverzeichnis.
// `npx asar extract-file` schreibt dagegen relativ zum aktuellen
// Arbeitsverzeichnis und hat dabei schon einmal Projektdateien ueberschrieben.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import * as asar from '@electron/asar';

const target = process.argv[2];
const source = process.argv[3];
const files = process.argv.slice(4);

if (!target || !source || !files.length) {
  console.error('Aufruf: node scripts/extract-from-asar.mjs <zielOrdner> <app.asar> <datei...>');
  process.exit(1);
}

mkdirSync(target, { recursive: true });
for (const file of files) {
  const buffer = asar.extractFile(source, file);
  const destination = path.join(target, file.replace(/[\\/]/g, '__'));
  writeFileSync(destination, buffer);
  console.log(file.padEnd(34), String(buffer.length).padStart(8), 'Bytes');
}
