import fs from 'node:fs';

const file = new URL('../bot-changelog.json', import.meta.url);
const target = '4.0.2';

const changes = [
  'Der Bot startet jetzt auch nach einem Rechnerwechsel nicht von allein. Bisher genügte ein kopierter Datenordner, damit die App als "eingerichtet" galt und der Bot sofort startete.',
  'Der Standard ist jetzt "Erst manuell starten". Nur wer bewusst "Automatisch starten" wählt, hat nach dem Neustart wieder einen sofortigen Start.',
  'Behoben: Ungültige oder beschädigte Werte der Start-Einstellung führen nicht mehr zu einem automatischen Start, sondern immer zum sicheren manuellen Modus.',
  'Alle Nachhole- und Abgleichmodule (Rollen, Verifizierung, Boost, ActivityRace, Server-Tags) laufen erst, wenn der Bot bewusst gestartet wurde - ein Umzug löst damit keine Embeds-Flut mehr aus.',
  'Die Oberfläche erklärt unter System ausdrücklich, dass der Schutz auch für übernommene Datenordner gilt.'
];

const changelog = JSON.parse(fs.readFileSync(file, 'utf8'));
const entries = Array.isArray(changelog.entries) ? changelog.entries : [];
const index = entries.findIndex((entry) => String(entry?.version || '') === target);
const entry = {
  version: target,
  date: new Date().toISOString().slice(0, 10),
  changes
};

if (index >= 0) entries[index] = entry;
else entries.unshift(entry);

changelog.entries = entries;
fs.writeFileSync(file, JSON.stringify(changelog, null, 2) + '\n', 'utf8');
console.log(`[changelog] ${target} geschrieben (${changes.length} Punkte, ${entries.length} Einträge gesamt).`);
process.exit(0);