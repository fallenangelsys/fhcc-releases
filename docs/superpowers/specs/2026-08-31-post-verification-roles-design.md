# Rollen nach Verifizierung - Design

## Ziel

Wenn die konfigurierte Unverified-Rolle eines menschlichen Mitglieds entfernt wird, vergibt das bestehende Welcome/Farewell-Modul mehrere frei auswählbare Basisrollen. Die Rollenvergabe funktioniert unabhaengig von der Welcome-Nachricht und holt waehrend eines Bot-Ausfalls verpasste Verifizierungen beim naechsten Start nach.

## Verhalten

- `postVerificationRolesEnabled` aktiviert die Rollenvergabe.
- `postVerificationRoleIds` enthaelt eine eindeutige Liste von Discord-Rollen-IDs.
- Ausloeser im Live-Betrieb ist ausschliesslich der echte Uebergang "Unverified vorhanden" zu "Unverified nicht vorhanden".
- Bots, Mitglieder mit noch vorhandener Unverified-Rolle und Mitglieder, die bereits alle Zielrollen haben, werden ohne Discord-Schreibzugriff uebersprungen.
- Die Welcome-Nachricht bleibt separat ueber `welcomeEnabled` und `welcomeAfterVerification` steuerbar.
- Beim Bot-Start sowie nach einer relevanten Konfigurationsaenderung wird die Mitgliederliste einmal geladen und abgeglichen. Es gibt keinen periodischen Vollscan.

## Performance und Sicherheit

- Live-Ereignisse sind O(1) bezogen auf die Servergroesse.
- Startabgleiche laufen pro Server als Single-Flight und mit begrenzter Parallelitaet.
- Nur Mitglieder mit tatsaechlich fehlenden Zielrollen erzeugen Rollen-API-Aufrufe.
- Alle Rollen werden je Mitglied gesammelt ueber `applyManagedRolePolicy` vergeben. Der zentrale Service prueft Bot-Rechte, Rollenhierarchie sowie verwaltete Rollen und serialisiert konkurrierende Aenderungen pro Mitglied.
- Nicht verwaltbare Zielrollen verhindern nicht, dass andere gueltige Zielrollen vergeben werden; Fehler werden ueber `quietLog` diagnostizierbar gehalten.

## UI und Bereitschaft

Das bestehende Welcome/Farewell-Modul erhaelt einen Schalter und eine `multiRoleSelect`-Auswahl. Die Modulbereitschaft meldet eine fehlende Unverified-Rolle oder eine leere Zielrollenauswahl als Konfigurationsfehler, sobald die Funktion aktiv ist.

## Tests

Der Welcome-Verifizierungs-Smoke prueft Mehrfachvergabe beim Rollenentzug, Unabhaengigkeit von der Welcome-Nachricht, keine Doppelvergabe bei Folgeupdates, Ueberspringen von Bots und bereits vollstaendigen Mitgliedern sowie den einmaligen Startabgleich fuer Offline-Verifizierungen.
