// Legt den 4.0.0-Changelog-Eintrag an (neuester Eintrag zuerst) und ist
// bewusst idempotent: läuft der Befehl zweimal, entsteht kein Duplikat.
import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../bot-changelog.json', import.meta.url);
const data = JSON.parse(readFileSync(file, 'utf8'));
const entries = Array.isArray(data.entries) ? data.entries : [];

if (entries.some((entry) => entry.version === '4.0.0')) {
  console.log('4.0.0 existiert bereits – nichts geändert.');
  process.exit(0);
}

const entry = {
  version: '4.0.0',
  date: '2026-10-01',
  changes: [
    'Neuer Update-Kanal: Die App lädt Updates aus einem privaten GitHub-Release-Repository statt aus einem Ordner. Damit ist die automatische Aktualisierung nicht mehr davon abhängig, dass auf diesem Rechner ein bestimmter Ordner mit dem Installer liegt.',
    'Der Zugriff auf das private Repository läuft über ein Token, das ausschließlich für dieses Benutzerkonto verschlüsselt gespeichert wird (Windows-DPAPI). Es steht nirgends im Klartext – weder in der App noch in der Konfigurationsdatei. Läuft es ab oder ist es ungültig, sagt die App das ausdrücklich, statt still anzunehmen, sie sei aktuell.',
    'Vor dem Start des Installers wird das Manifest geladen und die SHA-512-Prüfsumme geprüft. Stimmt sie nicht, wird der Installer gelöscht und nichts gestartet – ein beschädigter oder vertauschter Download kommt nicht mehr zur Ausführung.',
    'Neu: Die Wochen- und Monatswertung der Aktivitäts-Liga respektiert jetzt die persönliche Ping-Einstellung. Bisher wurden bei jedem Abschluss alle drei Gewinner benachrichtigt, auch wenn deren Ping-Wunsch deaktiviert war.',
    'Neu: Wird jemand in einer Platzierungsnachricht als Überholer genannt, gilt auch für ihn die Ping-Einstellung. Er steht im Satz dann als Name statt als Klick-Erwähnung – der Text bleibt lesbar, die Benachrichtigung entfällt.',
    'Neu: Die Gleichstands-Anzeige der Liga benachrichtigt ebenfalls niemanden mehr ungefragt, dessen Ping-Wunsch deaktiviert ist.',
    'Die Oberfläche hat einen neuen Bereich für das Release-Repository und das Token, dazu eine Anzeige des Download-Fortschritts, weil ein Update über 560 MB groß ist und die App sonst während des Ladens wie abgestürzt wirkt.',
    'Versionsprüfungen im Release-Prozess waren auf die alte 3.9-Linie festverdrahtet und hätten jeden Sprung auf eine Hauptversion blockiert. Sie akzeptieren jetzt beide Linien.'
  ]
};

entries.unshift(entry);
data.entries = entries;
writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log(`4.0.0 eingetragen. Einträge jetzt: ${entries.length}`);
