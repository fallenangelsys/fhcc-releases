import fs from 'node:fs';

const file = new URL('../bot-changelog.json', import.meta.url);
const target = '4.1.2';
// 4.1.0 und 4.1.1 wurden nie veröffentlicht (beide Release-Läufe brachen vor dem
// Publish ab). Ihre Hinweise stehen deshalb gebündelt unter der echten Version,
// statt zwei nicht existierende Releases im Changelog zu zeigen.
const superseded = '4.1.1';

const changes = [
  'Neu: Erste veröffentlichte Linux-Version. FHCC kommt für Linux x64 als AppImage (keine Installation, kein Root) und als Debian-/Ubuntu-Paket (.deb); das .deb zieht die benötigten Electron-Bibliotheken sowie libsecret-1-0 automatisch nach.',
  'Neu: Der verschlüsselte Datenumzug (.fhccbackup) überträgt den kompletten Arbeitsstand auf einen anderen Rechner – Serverdaten, Bilder, Embed-Entwürfe, Einstellungen und Zugangsdaten. Der Import ist transaktional: Erst wenn Daten und Oberfläche übernommen sind, gilt er als abgeschlossen; sonst bleibt der vorherige Stand unangetastet.',
  'Fix: Die Inaktivitäts-Erinnerung zeigt „Letzte Nachricht / Letzter Call“ im deutschen Format „TT.MM.JJJJ um HH:MM Uhr“ und in der Zeitzone des Rechners, auf dem der Bot läuft. Die automatische Release-Prüfung hatte dafür eine feste Ortszeit hinterlegt.',
  'Neu: GitHub Actions baut Windows und Linux parallel zu jedem Versions-Tag und hängt beide Paketarten an dasselbe Release. Die vollständige Prüfung läuft einmal je Plattform in einem eigenen Schritt; schlägt etwas fehl, nennt die Meldung das betroffene Prüfskript und das komplette Protokoll wird als Artefakt gespeichert.',
  'Neu: Das Repository-README zeigt Produktbild, Oberflächen-Galerie, Installations- und Sicherheitsübersicht inklusive Architekturdiagramm.'
];

const changelog = JSON.parse(fs.readFileSync(file, 'utf8'));
const entries = Array.isArray(changelog.entries) ? changelog.entries : [];
const withoutSuperseded = entries.filter((entry) => String(entry?.version || '') !== superseded);
const index = withoutSuperseded.findIndex((entry) => String(entry?.version || '') === target);
const entry = { version: target, date: new Date().toISOString().slice(0, 10), changes };
if (index >= 0) withoutSuperseded[index] = entry;
else withoutSuperseded.unshift(entry);
changelog.entries = withoutSuperseded;
fs.writeFileSync(file, JSON.stringify(changelog, null, 2) + '\n', 'utf8');
console.log(`[changelog] ${target} geschrieben (${changes.length} Punkte, ${withoutSuperseded.length} Einträge gesamt, ${superseded} zusammengeführt).`);
