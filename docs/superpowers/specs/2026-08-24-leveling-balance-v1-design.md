# Leveling Balance V1 Design

**Status:** Vom Benutzer am 24.08.2026 freigegeben  
**Zielrelease:** naechste FHCC-Version nach `3.9.288`

## Ziel

Das Levelsystem belohnt jede legitime Chat-Nachricht und jede gueltige Voice-Minute ohne Cooldown, Tageslimit, Wochenlimit, Zufallswerte oder Aktivitaets-Abschwaechung. Die neue Kurve haelt die ersten Rollen erreichbar, macht die letzte konfigurierte Rolle aber zu einem langfristigen Ziel. Bestehende XP gehen nicht verloren; Level und verwaltete Discord-Rollen werden aus diesen XP neu berechnet und automatisch synchronisiert.

## Verbindliche Balance

- Eine legitime Nachricht gibt fest `5 XP`.
- Eine gueltige Voice-Minute gibt fest `1 XP`.
- Chat und Voice duerfen gleichzeitig XP erzeugen.
- Es gibt kein Tages- oder Wochenlimit, keinen Nachrichten-Cooldown und keine abnehmenden Multiplikatoren.
- Aktivitaetsliga, Server-Tag und Booster erzeugen keine Level-XP mehr. Ihre eigenen Rollen und Belohnungen bleiben davon unberuehrt.
- Die hoechste konfigurierte Level-Rolle ist das Max-Level. Ohne Rollen-Mapping gilt aus Kompatibilitaetsgruenden Level 110 als Anzeige-Maximum.
- Nach dem Max-Level steigt das sichtbare Level nicht weiter. Lifetime-XP und der Serverrang laufen unbegrenzt weiter.

## Chat-Qualifikation

Eine Nachricht ist legitim, wenn alle folgenden Bedingungen erfuellt sind:

- Autor ist ein Mensch; Bot-, Webhook- und Systemnachrichten zaehlen nicht.
- Kanal oder uebergeordnete Kategorie ist nicht ausgeschlossen.
- Das Mitglied traegt weder eine ausgeschlossene Rolle noch eine NO-XP-Rolle.
- Text enthaelt mindestens die konfigurierte Zahl an Buchstaben oder Ziffern, standardmaessig zwei; alternativ enthaelt die Nachricht mindestens einen Anhang oder Sticker.
- Derselbe normalisierte Text wurde von diesem Mitglied nicht bereits innerhalb der letzten zehn Minuten gewertet. Die Historie umfasst mehrere Nachrichten, damit abwechselnder Copy-Paste-Spam nicht durchkommt.

Antworten, Threads, Bilder, Dateien und Sticker zaehlen. Eine Bearbeitung erzeugt keine weiteren XP. Die Spam-Pruefung ist eine Inhaltsqualifikation und kein Aktivitaetslimit: Jede unterschiedliche legitime Nachricht wird unmittelbar gewertet.

## Voice-Abrechnung

Voice-Zeit ist gueltig, wenn das Mitglied und der Kanal wertbar sind und mindestens zwei wertbare Menschen gleichzeitig im Kanal sind. AFK-Kanal, ausgeschlossene Kanaele, Bots, ausgeschlossene Rollen, NO-XP-Rollen sowie selbst- oder servertaube Zeit zaehlen nicht. Normales Stummschalten bleibt erlaubt.

Die Runtime fuehrt fuer jedes Mitglied einen Abrechnungszeitpunkt und einen Restwert unter einer Minute. Vor jeder Voice-State-Aenderung wird das alte Intervall abgerechnet; danach beginnt das neue Intervall. Jeder periodische Tick setzt den Abrechnungszeitpunkt fuer alle Voice-States weiter, auch wenn ein Intervall ungueltig war. Dadurch kann allein, taub oder im AFK verbrachte Zeit nie spaeter nachgetragen werden. Beim Runtime-Start beginnt die Abrechnung bei null; Offline-Zeit wird nicht rueckwirkend gutgeschrieben.

## Levelkurve

Fuer Level `L` gilt die kumulative Schwelle:

```text
XP(L) = 60 * (L * (L + 4) + max(0, L - 20)^2)
```

Wichtige Schwellen:

| Level | Kumulative XP |
| ---: | ---: |
| 1 | 300 |
| 5 | 2.700 |
| 10 | 8.400 |
| 20 | 28.800 |
| 40 | 129.600 |
| 60 | 326.400 |
| 80 | 619.200 |
| 100 | 1.008.000 |
| 110 | 1.238.400 |

Die Umkehrung wird als monotone Ganzzahl-Suche implementiert und immer auf das konfigurierte Max-Level begrenzt. Alle Karten, Level-Up-Meldungen, Admin-Befehle, Mitgliederbeitritte und Rollen-Synchronisierungen verwenden dieselbe kanonische Berechnung.

## Datenmigration

`leveling-progress.json` erhaelt eine neue Store-Version und eine pro Guild gespeicherte Balance-Migrationskennung. Beim ersten Start mit Balance V1:

1. Bestehende `xp` bleiben unveraendert und gelten als Lifetime-XP.
2. Das gespeicherte `level` wird fuer jedes Profil aus `xp` und der neuen Kurve neu berechnet. Es darf dabei steigen oder sinken.
3. Veraltete Tages-, Bonus- und Cooldown-Zaehler bleiben nur zur Dateikompatibilitaet lesbar, beeinflussen aber keine neue XP-Vergabe.
4. Der atomare JSON-Store erstellt vor dem Ersetzen eine Sicherung.
5. Ein Migrationsbericht speichert Zeit, Profilanzahl, Anzahl gestiegener/gefallener/unveraenderter Level und den Rollenabgleich-Status.
6. Die Migration ist idempotent. Ein Abbruch darf beim naechsten Start sicher fortgesetzt werden.

Historische XP koennen nicht verlaesslich nach Quelle getrennt werden, weil der alte Store nur die Gesamtsumme dauerhaft fuehrt. Deshalb werden keine alten Bonus-XP geschaetzt oder entfernt.

## Rollenabgleich

Nach erfolgreicher Neuberechnung laedt der Bot alle Servermitglieder und bestimmt fuer jedes Nicht-Bot-Mitglied die gewuenschten Rollen aus dem neu berechneten Level. Bei nicht kumulativen Belohnungen bleibt nur die hoechste passende Level-Rolle; bei kumulativen Belohnungen bleiben alle erreichten Rollen. Falsche verwaltete Level-Rollen werden entfernt und fehlende werden hinzugefuegt.

Der Abgleich:

- sendet keine Level-Up-Meldungen waehrend der Migration,
- wartet Discord-Rate-Limits mit Backoff ab,
- meldet blockierte Rollen ehrlich,
- speichert den Rollen-Sync erst als abgeschlossen, wenn keine blockierten oder fehlgeschlagenen Aenderungen verbleiben,
- wird nach einer Balance-Migration automatisch gestartet,
- wird nach relevanten Level-Rollen-Konfigurationsaenderungen erneut gestartet,
- berechnet beim Mitgliederbeitritt das Level erneut aus XP statt einem moeglicherweise veralteten `profile.level` zu vertrauen.

## App-Oberflaeche

Die Leveling-Konfiguration zeigt nur noch aktive, verstaendliche Regeln:

- feste Chat-XP pro legitimer Nachricht,
- Mindestinhalt und Ausschluesse,
- Voice-XP und Mindestteilnehmer,
- Level-Rollen und kumulative Rollenoption,
- Max-Level und berechnete XP-Schwellen als klare Zusammenfassung.

Zufalls-Min/Max, Cooldown, Tageslimit sowie Liga-, Tag- und Booster-Levelboni werden aus der sichtbaren Leveling-Oberflaeche entfernt. Legacy-Werte bleiben beim Laden toleriert, werden fuer Balance V1 jedoch auf die freigegebenen Werte migriert.

Die Regeln-Embeds und Standard-Platzhalter nennen `5 XP`, `1 XP/Minute`, keinen Cooldown und keine passiven Levelboni. Eigene Studiotexte bleiben editierbar; bekannte alte Standardtexte werden auf den neuen Standard angehoben.

## Diagnose und Auswertung

Die App darf Aktivitaetsdaten auswerten und eine 30-Tage-Projektion anzeigen, veraendert die Balance aber niemals automatisch. Kurvenaenderungen benoetigen kuenftig eine neue explizite Versionskennung und Migration. Diagnosen zeigen mindestens Balance-Version, Max-Level, Schwelle des Max-Levels, migrierte Profile und letzten Rollen-Sync.

## Verifikation

Automatisierte Tests decken mindestens ab:

- alle freigegebenen Kurvenschwellen und die Umkehrung,
- Max-Level-Clamping bei weiter steigenden Lifetime-XP,
- zwei schnelle unterschiedliche Nachrichten geben jeweils 5 XP,
- Duplikate, Bots, Webhooks und ausgeschlossene Mitglieder geben keine XP,
- Anhang oder Sticker ohne Text gibt 5 XP,
- gueltige Voice-Minuten und Restsekunden,
- allein, taub oder im AFK verbrachte Zeit wird nach Wiederherstellung nie nachgetragen,
- Migration behaelt XP und korrigiert Level auch nach unten,
- Rollen-Sync entfernt falsche Rollen und vergibt die neue passende Rolle,
- zweiter Migrationslauf veraendert keine Daten erneut,
- Levelkarte zeigt am Maximum `MAX` statt einen nicht vorhandenen Folgerang.

Der Release wird erst gebaut, wenn Fokus-Smokes, Community-Suite, Release-Suite, Paketpruefung und Installer-Audit erfolgreich sind.
