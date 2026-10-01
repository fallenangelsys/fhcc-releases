import fs from 'node:fs';

const file = new URL('../bot-changelog.json', import.meta.url);
const target = '4.0.1';

const changes = [
  'Bei einer frischen Installation startet der Bot nicht mehr von allein. Ohne abgeschlossene Einrichtung werden keine Discord-Nachrichten und keine Embeds gesendet - der Bot startet erst auf ausdrücklichen Befehl.',
  'Neue Option "Startverhalten des Bots" unter System: "Automatisch starten, sobald eingerichtet" oder "Erst manuell starten". Die Wahl wird dauerhaft gespeichert und überlebt Neustarts und Updates.',
  'Behoben: Die gepackte App übernahm beim Start den Bot-Token aus einem .env im Entwicklerordner. Dadurch lief auf einem frischen Rechner ein Bot mit fremden Zugangsdaten los.',
  'Behoben: Die gepackte App kopierte beim ersten Start die Serverdaten des Entwicklerrechners in den neuen Datenordner. Eine Neuinstallation ist damit wirklich leer.',
  'Der erzwungene Start über --start-bot bleibt unverändert möglich und überschreibt jede Einstellung.',
  'Neuer Regressionstest startup-mode-smoke mit 40 Prüfungen, eingebunden in test:quality.'
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