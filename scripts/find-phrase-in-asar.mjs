// Schnellsuche in grossen Binärdateien (z. B. app.asar) nach einem Textstück.
// Streamt in Bloecken und liefert den Umgebungscontext jeder Fundstelle.
import fs from 'node:fs';

const [file, needle, contextArg] = process.argv.slice(2);
if (!file || !needle) {
  console.error('Aufruf: node scripts/find-phrase-in-asar.mjs <datei> <text> [kontext]');
  process.exit(1);
}
const context = Number(contextArg || 80);
const needleBuf = Buffer.from(needle, 'latin1');

const CHUNK = 8 * 1024 * 1024;
const OVERLAP = needleBuf.length + context * 2 + 16;
const fd = fs.openSync(file, 'r');
const size = fs.fstatSync(fd).size;
const buf = Buffer.alloc(CHUNK + OVERLAP);

let position = 0;
let carry = Buffer.alloc(0);
let hits = 0;

while (position < size) {
  const read = fs.readSync(fd, buf, 0, Math.min(CHUNK, size - position), position);
  if (read <= 0) break;
  const chunk = Buffer.concat([carry, buf.subarray(0, read)]);
  let from = 0;
  for (;;) {
    const at = chunk.indexOf(needleBuf, from);
    if (at === -1) break;
    hits += 1;
    const start = Math.max(0, at - context);
    const end = Math.min(chunk.length, at + needleBuf.length + context);
    const snippet = chunk.subarray(start, end).toString('latin1').replace(/[^\x20-\x7e]/g, '.');
    console.log(`--- Fund @ ${position - carry.length + at} ---`);
    console.log(snippet);
    from = at + 1;
    if (hits >= 25) {
      console.log('(mehr als 25 Fundstellen, Suche abgebrochen)');
      fs.closeSync(fd);
      process.exit(0);
    }
  }
  carry = chunk.subarray(Math.max(0, chunk.length - OVERLAP));
  position += read;
}

fs.closeSync(fd);
console.log(`Fertig: ${hits} Fundstelle(n) fuer "${needle}" in ${file}.`);
process.exit(hits ? 0 : 2);