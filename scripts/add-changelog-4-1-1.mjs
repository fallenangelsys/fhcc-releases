import fs from 'node:fs';

const file = new URL('../bot-changelog.json', import.meta.url);
const target = '4.1.1';

const changes = [
  'Fix @ 4.1.1 – Die Inaktivitäts-Erinnerung zeigt „Letzte Nachricht / Letzter Call“ weiterhin im deutschen Format „TT.MM.JJJJ um HH:MM Uhr“ und in der Zeitzone des Rechners, auf dem der Bot läuft. Die automatische Release-Prüfung hatte dafür eine feste Ortszeit hinterlegt und brach deshalb auf Servern mit UTC-Zeit ab; geprüft wird jetzt derselbe Zeitstempel in der jeweiligen Systemzeitzone.',
  'Neu @ 4.1.1 – Der Release-Build trennt Prüfung und Verpackung: Die vollständige Testsuite läuft einmal je Plattform in einem eigenen Prüfschritt, bevor Windows- und Linux-Pakete gebaut werden. Schlägt etwas fehl, nennt die Meldung direkt das betroffene Prüfskript statt nur „exit code 1“, und das komplette Protokoll wird als Artefakt zum Download gespeichert.'
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
