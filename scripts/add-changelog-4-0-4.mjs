import fs from 'node:fs';

const file = new URL('../bot-changelog.json', import.meta.url);
const target = '4.0.4';

const changes = [
  'Behoben: Discord-Anmeldung öffnet die Discord-OAuth-Seite im normalen Standardbrowser statt im eingebetteten Electron-Fenster. Discords Web-Client benötigt globale Browser-Variablen und zeigte im eingebetteten Fenster "Global environment variables not set!".',
  'Das FHCC-Statusfenster blockiert jetzt Discord-Seiten in Electron. Nur der lokale OAuth-Callback darf im App-Fenster geladen werden; alle externen HTTP(S)-Seiten gehen in den Standardbrowser.',
  'Vor dem Öffnen wird die OAuth-URL auf HTTPS und exakt discord.com validiert.',
  'Auth-Regressionstest stellt sicher, dass Discord nie wieder in das Electron-WebView geladen wird.'
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