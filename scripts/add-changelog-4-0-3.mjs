import fs from 'node:fs';

const file = new URL('../bot-changelog.json', import.meta.url);
const target = '4.0.3';

const changes = [
  'Behoben: Die Discord-Anmeldung funktioniert wieder. Seit 4.0.1 hat die gepackte App nur noch die .env neben den Appdaten gelesen; Installationen, deren OAuth-Zugangsdaten noch in Documents/Discord Bot/.env lagen, konnten sich danach nicht mehr anmelden.',
  'Der Schutz gegen fremde Zugangsdaten bleibt bestehen: Eine frische Installation liest diese geerbten Werte weiterhin nicht.',
  'Behoben: 4.0.2 stellte den Standard auf "Erst manuell starten" um. Für Einrichtungen vor 4.0.1 ist dadurch die Anmeldung ausgefallen, weil der Anmeldedienst die Zugangsdaten nicht mehr fand.'
];

const changelog = JSON.parse(fs.readFileSync(file, 'utf8'));
const entries = Array.isArray(changelog.entries) ? changelog.entries : [];
const index = entries.findIndex((entry) => String(entry?.version || '') === target);
const entry = { version: target, date: new Date().toISOString().slice(0, 10), changes };

if (index >= 0) entries[index] = entry;
else entries.unshift(entry);

changelog.entries = entries;
fs.writeFileSync(file, JSON.stringify(changelog, null, 2) + '\n', 'utf8');
console.log(`[changelog] ${target} geschrieben (${changes.length} Punkte, ${entries.length} Einträge gesamt).`);
process.exit(0);