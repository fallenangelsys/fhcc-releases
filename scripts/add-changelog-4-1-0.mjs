import fs from 'node:fs';

const file = new URL('../bot-changelog.json', import.meta.url);
const target = '4.1.0';

const changes = [
  'Neu: Linux-Build. FHCC wird für Linux x64 als AppImage (keine Installation, kein Root) und als Debian-/Ubuntu-Paket (.deb) ausgeliefert. Das .deb zieht die benötigten Electron-Bibliotheken sowie libsecret-1-0 automatisch nach.',
  'Neu: Der verschlüsselte Datenumzug (.fhccbackup) überträgt den kompletten Arbeitsstand auf einen anderen Rechner – Serverdaten, Bilder, Embed-Entwürfe, Einstellungen und Zugangsdaten. Der Import ist transaktional: Erst wenn Daten und Oberfläche übernommen sind, gilt er als abgeschlossen; sonst bleibt der vorherige Stand unangetastet.',
  'Neu: GitHub Actions baut Windows und Linux jetzt parallel zu jedem Versions-Tag und hängt beide Paketarten an dasselbe Release. Der Tag wird gegen die Version in package.json geprüft, ein falscher Tag bricht den Build ab.',
  'Sicherheit: Unter Linux wird der System-Schlüsselbund (GNOME Keyring oder KDE Wallet) genutzt. Der unsicherte basic_text-Fallback wird abgelehnt, statt Tokens ungeschützt abzulegen. Auf Windows bleibt DPAPI, dazu macOS-Keychain-Unterstützung.',
  'Sicherheit: Secret-Dateien werden mit restriktiven Dateirechten geschrieben, damit sie nicht für andere Benutzer des Systems lesbar sind.',
  'Neu: Unter Linux werden Daten aus früheren Beta-Installationen automatisch in den neuen App-Datenordner übernommen, damit ein Wechsel nicht mit einem leeren Datenstand startet.',
  'Neu: Das Update-Center erkennt Linux und schaltet die Windows-Installer-Aktualisierung dort bewusst ab – der Hinweis erklärt, wie ein neues AppImage oder .deb eingespielt wird.',
  'Neu: Das Repository-README zeigt Produktbild, Oberflächen-Galerie, Installations- und Sicherheitsübersicht inklusive Architekturdiagramm.',
  'Neu: @ 4.1.0 - Die gepackte Linux-Runtime wird nach dem Build mit einer eigenen Smoke-Prüfung verifiziert: ausführbares Binary, app.asar und das linux-x64-SQLite-Prebuild müssen vorhanden sein.'
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
