# TempVoice: persoenliche Profile und sichere Kanalsteuerung

**Datum:** 2026-08-24  
**Status:** Vom Nutzer freigegeben  
**Zielrelease:** FHCC 3.9.290

## Ausgangslage

TempVoice speichert in `temp-voice.json` derzeit nur aktive Kanaele. Beim Loeschen eines leeren TempVoice-Kanals wird dessen Eintrag entfernt. Ein vom Besitzer geaenderter Kanalname, das Benutzerlimit und die RTC-Region gehen dadurch verloren. Beim naechsten Beitritt zum Setup-Kanal verwendet die Erstellung wieder ausschliesslich das globale Namensschema und die globalen Standardwerte.

Weitere bestaetigte Schwachstellen im bestehenden Ablauf:

- Das Limit-Modal startet immer mit `0`, auch wenn der Kanal bereits ein anderes Limit hat.
- Rename und Limit koennen nach einem Discord-API-Fehler trotzdem noch eine Erfolgsmeldung senden.
- `Freigeben` setzt `Connect` lediglich auf `null`. Ist der Kanal ueber `@everyone` gesperrt, kann die Person danach weiterhin nicht beitreten.
- Das Interface zeigt den aktuellen Namen, das Limit, die Region und den Zugangsstatus nicht kompakt an.
- Gleichzeitige Creator-Events fuer dieselbe Person sind nicht durch einen Erstellungs-Lock serialisiert.
- Beim automatischen oder manuellen Loeschen kann der State auch dann entfernt werden, wenn Discord den Kanal nicht geloescht hat. Dadurch kann ein nicht mehr verwalteter TempVoice-Kanal entstehen.

## Produktentscheidung

TempVoice erhaelt ein persoenliches Profil je Server und Mitglied. Das Profil speichert nur komfortbezogene Einstellungen:

- letzter erfolgreich gesetzter benutzerdefinierter Kanalname,
- letztes erfolgreich gesetztes Benutzerlimit,
- letzte erfolgreich gesetzte RTC-Region.

Folgende sicherheits- und sitzungsbezogene Daten werden ausdruecklich **nicht** in das Profil uebernommen:

- gesperrt/offen,
- blockierte Mitglieder,
- explizit zugelassene Mitglieder,
- Besitzer und Besitzuebertragungen,
- Threads.

Damit sieht ein neuer Kanal wieder so aus, wie das Mitglied ihn bevorzugt, startet aber ohne alte Zugriffsentscheidungen. Die Kategorie- und App-Standards bleiben die Sicherheitsbasis.

## Ziele

1. Ein erfolgreich umbenannter Kanal erscheint beim naechsten Erstellen mit exakt demselben, Discord-gueltigen Namen.
2. Limit und Region werden ebenfalls pro Mitglied und Server wiederhergestellt.
3. Alte Zugriffsrechte werden niemals in einen neuen Kanal getragen.
4. Das TempVoice-Interface zeigt den tatsaechlichen Live-Zustand und bestaetigt nur erfolgreiche Aktionen.
5. Mitglieder koennen in einem gesperrten Kanal gezielt zugelassen und wieder entfernt werden.
6. Die App zeigt aktive Kanaele und gespeicherte Profile verstaendlich an und kann Profile kontrolliert zuruecksetzen.
7. Bestehende State-Dateien und aktive Kanaele funktionieren nach dem Update weiter.

## Nicht-Ziele

- Keine dauerhafte Freundes-, Block- oder Whitelist ueber mehrere Kanaele hinweg.
- Keine automatische Uebernahme fremder Profile bei Claim oder Transfer.
- Keine unbegrenzte Historie frueherer Kanalnamen.
- Kein neues Moderations- oder Voice-XP-System innerhalb von TempVoice.
- Keine Aenderung an den grundsaetzlichen Discord-Kategorie-Berechtigungen des Servers.

## Persistenzmodell

Der TempVoice-State wird von Version 3 auf Version 4 erweitert:

```json
{
  "version": 4,
  "channels": {
    "CHANNEL_ID": {
      "guildId": "GUILD_ID",
      "ownerId": "USER_ID",
      "ownerName": "Anzeigename",
      "createdAt": "2026-08-24T12:00:00.000Z",
      "interfaceChannelId": "CHANNEL_ID",
      "interfaceMessageId": "MESSAGE_ID"
    }
  },
  "profiles": {
    "GUILD_ID": {
      "USER_ID": {
        "customName": "Gaming mit Freunden",
        "userLimit": 6,
        "rtcRegion": "europe",
        "updatedAt": "2026-08-24T12:05:00.000Z"
      }
    }
  }
}
```

Regeln:

- `customName` wird mit derselben zentralen Namensnormalisierung wie ein Live-Rename gespeichert und auf 100 Zeichen begrenzt.
- `userLimit` ist eine ganze Zahl von 0 bis 99. `0` bedeutet unbegrenzt.
- `rtcRegion` ist `automatic` oder ein Wert aus der bestehenden Region-Liste.
- Unbekannte Felder, falsche Typen und ungueltige Werte werden beim Laden verworfen oder normalisiert.
- Version-3-Dateien werden verlustfrei um `profiles: {}` ergaenzt. Aktive Kanal-Eintraege bleiben erhalten.
- Ein Profil wird erst nach einer erfolgreich abgeschlossenen Discord-Aenderung gespeichert.
- Profil-Schreibvorgaenge laufen ueber die vorhandene atomare JSON-Persistenz und dieselbe serialisierte Save-Queue wie Kanal-Eintraege.

## Erstellen eines Kanals

Beim Beitritt zu einem konfigurierten Creator-Kanal gilt folgende Prioritaet:

1. Hat das Mitglied bereits einen aktiven TempVoice-Kanal, wird es wie bisher dorthin verschoben.
2. Ein Lock mit dem Schluessel `guildId:userId` verhindert parallele Doppelerstellungen.
3. Wenn `rememberUserProfiles` aktiv ist, werden gueltige Profilwerte geladen.
4. Fuer den Namen gilt: `profile.customName` vor `channelNameTemplate`.
5. Fuer das Limit gilt: `profile.userLimit` vor `defaultUserLimit`.
6. Fuer die Region gilt: `profile.rtcRegion` vor `defaultRegion`.
7. Berechtigungen werden immer frisch aus der konfigurierten Kategorie beziehungsweise den vorhandenen TempVoice-Standards aufgebaut.
8. Sperren, Blockierungen und Zulassungen des vorherigen Kanals werden nicht angewendet.
9. Der Erstellungs-Lock wird in einem `finally`-Pfad immer freigegeben.

Kann der Kanal nicht erstellt oder das Mitglied nicht verschoben werden, erhaelt das Mitglied eine klare Rueckmeldung. Ein teilweise erstellter Kanal wird entweder kontrolliert weiterverwaltet oder aufgeraeumt; es darf kein stilles Doppel- oder Waisenkonstrukt entstehen.

## Profilaktualisierung

### Umbenennen

- Das Modal ist mit dem aktuellen Kanalnamen vorbelegt.
- Erst `channel.setName(...)`, danach Profil speichern.
- Bei Discord-Fehler: genau eine Fehlermeldung, keine Erfolgsmeldung, Profil unveraendert.
- Bei Persistenzfehler nach erfolgreichem Discord-Rename: der Live-Rename bleibt bestehen; die Rueckmeldung weist darauf hin, dass die Einstellung nicht fuer den naechsten Kanal gespeichert werden konnte.

### Benutzerlimit

- Das Modal ist mit `channel.userLimit` vorbelegt.
- Nur eine ganze Zahl von 0 bis 99 wird akzeptiert. Ungueltige Texte werden nicht still zu `0` umgedeutet.
- Erst `channel.setUserLimit(...)`, danach Profil speichern.
- Fehler- und Erfolgspfad sind gegenseitig exklusiv.

### Region

- Das Auswahlmenue markiert beziehungsweise benennt die aktuelle Region nachvollziehbar.
- Erst `channel.setRTCRegion(...)`, danach Profil speichern.
- `automatic` wird live als `null`, im Profil aber kanonisch als `automatic` gespeichert.

### Reset

Die Aktion `Profil zuruecksetzen`:

- loescht ausschliesslich das Profil des aktuellen Besitzers auf dem aktuellen Server,
- setzt den aktiven Kanal nach Bestaetigung auf das aktuelle Namensschema, Standardlimit und die Standardregion zurueck,
- veraendert keine Blockierungen, Zulassungen, Sperre oder Besitzdaten,
- meldet Teilfehler eindeutig, falls eine Live-Aenderung nicht angewendet werden konnte.

## Claim und Transfer

- Ein aktiver Kanal behaelt beim Claim oder Transfer seine aktuellen Live-Einstellungen.
- Das Profil des alten Besitzers bleibt unveraendert.
- Das Profil des neuen Besitzers wird nicht automatisch mit den Werten des uebernommenen Kanals ueberschrieben.
- Erst wenn der neue Besitzer Name, Limit oder Region selbst aendert, wird diese Aenderung in seinem eigenen Profil gespeichert.
- Ein neuer Kanal des neuen Besitzers nutzt weiterhin dessen eigenes Profil oder die App-Standards.

## Zugang und Privatsphaere

Die Zugangssteuerung bleibt pro aktivem Kanal und wird funktional getrennt:

- **Sperren/Oeffnen:** schaltet den allgemeinen Zutritt des aktiven Kanals um.
- **Zulassen:** setzt fuer ein ausgewaehltes Mitglied mindestens `ViewChannel: true` und `Connect: true`, damit es auch bei allgemeiner Sperre beitreten kann.
- **Zulassung entfernen:** entfernt nur die temporaere Zulassung und stellt die vorherige Berechtigungsbasis wieder her.
- **Blockieren:** setzt `Connect: false` und trennt ein anwesendes Mitglied sofort.
- **Blockierung entfernen:** stellt die vorherige Berechtigungsbasis wieder her. Bei weiterhin gesperrtem Kanal wird nicht faelschlich behauptet, die Person koenne bereits beitreten.

Vor der ersten Aenderung eines Mitglied-Overwrites wird dessen relevante Ausgangslage fuer den aktiven Kanal festgehalten. Ruecknahme-Aktionen stellen diese Ausgangslage wieder her, statt Kategorie- oder importierte Berechtigungen pauschal mit `null` zu zerstoeren. Diese Baselines gehoeren nur zum aktiven Kanal-Eintrag und werden beim Loeschen des Kanals entfernt; sie sind kein Nutzerprofil.

## Discord-Interface

Das Interface zeigt neben Besitzer und Erstellungszeit einen kompakten Live-Status:

- aktueller Kanalname,
- Benutzerlimit oder `Unbegrenzt`,
- aktuelle Region oder `Automatisch`,
- `Offen` oder `Gesperrt`,
- Anzahl aktuell verbundener Mitglieder.

Nach Rename, Limit, Region, Sperren/Oeffnen, Zugangsaenderung, Claim und Transfer wird das vorhandene Interface aktualisiert. Alte Custom-IDs fuer Blockieren und Freigeben bleiben waehrend der Migration verarbeitbar, damit vor einem Neustart bereits gesendete Nachrichten nicht unkontrolliert fehlschlagen.

Die Zugangsaktionen werden in einem gemeinsamen, ephemeral geoeffneten Zugangsdialog gebuendelt. Dadurch bleibt das Hauptinterface trotz der zusaetzlichen Funktionen uebersichtlich. `Profil zuruecksetzen` erfordert vor der Ausfuehrung eine Bestaetigung.

## App-Konfiguration und Live-Ansicht

Neue Konfiguration:

```json
{
  "tempVoice": {
    "rememberUserProfiles": true
  }
}
```

- Standard ist `true`, damit der explizit gewuenschte Rename-Merker direkt funktioniert.
- Wird die Option deaktiviert, werden beim Erstellen nur die globalen Standards benutzt und neue Aenderungen nicht ins Profil geschrieben.
- Bereits gespeicherte Profile werden beim blossen Deaktivieren nicht automatisch geloescht.

Die TempVoice-Live-Ansicht der App erhaelt:

- Anzahl aktiver Kanaele,
- Anzahl gespeicherter Profile,
- eine kompakte Liste aktiver Kanaele mit Besitzer, Name, Mitgliedern, Limit, Region und Zugangsstatus,
- eine Liste gespeicherter Profile mit Mitglied, gespeichertem Namen, Limit, Region und Aktualisierungszeit,
- Aktion zum Zuruecksetzen eines einzelnen Profils,
- Aktion zum Zuruecksetzen aller Profile mit expliziter Bestaetigung.

Die Status-API wird entsprechend erweitert. Fuer Live-Kanaldaten wird der Discord-Guild-Cache verwendet; Profilseiten werden begrenzt und nach `updatedAt` sortiert, damit grosse Server die App nicht ausbremsen.

Vorgesehene API-Aktionen:

- `GET /api/guild/:guildId/temp-voice`
- `DELETE /api/guild/:guildId/temp-voice/profiles/:userId`
- `DELETE /api/guild/:guildId/temp-voice/profiles`

Alle Routen verwenden die bestehende Dashboard-Authentifizierung und Guild-Zugriffspruefung.

## Loesch- und Wiederherstellungslogik

- Ein Kanal-Eintrag wird erst entfernt, wenn Discord die Loeschung bestaetigt oder der Kanal nachweislich nicht mehr existiert.
- Schlaegt die Loeschung fehl, bleibt der Eintrag erhalten und der Fehler ist diagnostizierbar.
- Beim Start werden fehlende Kanaele weiterhin aus `channels` entfernt; `profiles` bleiben davon unberuehrt.
- Cleanup-Timer werden vor manueller Loeschung abgebrochen und bei Re-Join wie bisher entfernt.
- Profil-Reset und Kanal-Cleanup verwenden dieselbe serialisierte Persistenz, damit sich parallele Schreibvorgaenge nicht gegenseitig ueberschreiben.

## Tests und Abnahmekriterien

Die Umsetzung erfolgt testgetrieben. Mindestens folgende Regressionen werden abgedeckt:

1. Version-3-State migriert zu Version 4, ohne aktive Kanaele zu verlieren.
2. Erfolgreicher Rename speichert den exakten normalisierten Namen.
3. Fehlgeschlagener Rename speichert nichts und sendet keine Erfolgsmeldung.
4. Ein neuer Kanal verwendet den gespeicherten Namen vor dem globalen Template.
5. Gespeichertes Limit und gespeicherte Region haben dieselbe Prioritaet.
6. Deaktiviertes `rememberUserProfiles` verwendet ausschliesslich globale Standards.
7. Limit-Modal zeigt den aktuellen Wert und lehnt ungueltige Eingaben ab.
8. Claim und Transfer kopieren oder ueberschreiben kein Profil.
9. Lock, Blockliste und Zulassungen erscheinen nie im neuen Nutzerprofil.
10. `Zulassen` funktioniert auch bei `@everyone -> Connect: false`.
11. Ruecknahme einer Zugangsaktion stellt die urspruengliche Berechtigungsbasis wieder her.
12. Zwei parallele Creator-Ereignisse erzeugen hoechstens einen Kanal.
13. Fehlgeschlagene Kanal-Loeschung entfernt den aktiven State-Eintrag nicht.
14. Profil-Reset loescht nur das angeforderte Profil und stellt Live-Standardwerte her.
15. App-Status und Reset-Routen sind authentifiziert, Guild-begrenzt und liefern normalisierte Daten.
16. Das Discord-Interface zeigt nach Aenderungen den neuen Live-Zustand.

Fokusverifikation:

- `node scripts/temp-voice-smoke.mjs`
- `node scripts/state-restore-smoke.mjs`
- neue beziehungsweise erweiterte TempVoice-App-UI-Smokes
- `npm run test:community`
- vor Release die vollstaendige `npm run test:release`-Kette

## Dokumentation und Release

Nach der Implementierung wird `PROJEKT-WISSEN.md` detailliert ergaenzt mit:

- Root Cause des verlorenen Kanalnamens,
- State-Version und Migrationsregeln,
- Profil-Prioritaeten und bewusst nicht persistierten Daten,
- Claim-/Transfer-Semantik,
- Zugangsmodell und Permission-Baselines,
- App-Routen und Bedienung,
- ausgefuehrten Tests und Release-Artefakt.

Das Release wird erst freigegeben, wenn die Fokus-, Community- und Release-Pruefungen erfolgreich sind und die neue EXE samt SHA-256 dokumentiert wurde.
