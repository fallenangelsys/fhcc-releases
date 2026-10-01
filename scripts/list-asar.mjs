// Listet Einträge eines app.asar und filtert sie optional per Suchbegriff.
import * as asar from '@electron/asar';

const source = process.argv[2];
const pattern = process.argv[3] ? new RegExp(process.argv[3], 'i') : null;

if (!source) {
  console.error('Aufruf: node scripts/list-asar.mjs <app.asar> [Suchmuster]');
  process.exit(1);
}

const list = asar.listPackage(source);
console.log('Einträge gesamt:', list.length);

const hits = pattern ? list.filter((entry) => pattern.test(entry)) : list;
console.log(`Treffer${pattern ? ' für /' + process.argv[3] + '/' : ''}:`, hits.length);
for (const entry of hits.slice(0, 60)) console.log('  ' + entry);
