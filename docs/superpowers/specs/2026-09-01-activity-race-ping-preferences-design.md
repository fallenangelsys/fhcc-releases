# Aktivitaets-Liga: persoenliche Ping-Einstellungen - Design

## Ziel

Jedes menschliche Mitglied kann die persoenlichen Platzierungs-Pings der Aktivitaets-Liga ueber einen echten Discord-Button selbst ein- oder ausschalten. Pings bleiben standardmaessig aktiv, damit das bisherige Verhalten erhalten bleibt. Das zugehoerige Info-Embed ist als eigenes viertes Panel unter Heute, vergangener Woche und vergangenem Monat vollstaendig im Embed Studio bearbeitbar.

## Nutzererlebnis

- Die Liga pflegt im Ranglistenkanal bis zu drei getrennte Ranking-Nachrichten und danach genau eine eigene Ping-Info-Nachricht.
- Die Ping-Info-Nachricht besitzt genau einen funktionalen Toggle-Button. Das Standardlabel lautet `LIGA-PINGS EIN/AUS` und ist in den Moduleinstellungen bearbeitbar.
- Ein Klick schaltet den eigenen Zustand sofort um. Die Antwort ist ephemeral und nennt eindeutig den neuen Zustand.
- Der oeffentliche Button zeigt keinen nutzerspezifischen Zustand, weil dieselbe Nachricht von allen Mitgliedern gesehen wird.
- Mitglieder ohne gespeicherte Einstellung gelten als aktiviert. Persistiert werden nur Opt-outs.

## Datenmodell

- `activity-race.json` erhaelt je Guild `pingOptOuts` als Objekt `userId -> disabledAt`.
- Der Zeitstempel dient der Diagnose; fuer den Filter zaehlt allein das Vorhandensein einer User-ID.
- Die Daten werden ueber den bestehenden atomaren und gedrosselten Save-Pfad gespeichert und ueberleben Bot-Neustarts.
- Ein Serveraustritt loescht die Einstellung nicht. Bei einem spaeteren Wiedereintritt bleibt die ausdrueckliche Entscheidung erhalten.
- Das normalisierte Panel-Ledger erhaelt eine Referenz auf die Ping-Info-Nachricht, damit nur der aktuelle Button gueltig ist.

## Ping-Filter und Performance

- `sendPlacementPings(...)` laedt die bereits im Prozess vorhandenen Guild-Daten einmal und entfernt Opt-out-Mitglieder vor Gruppierung und Versand.
- Direkt vor dem einzelnen Versand wird der Zustand erneut geprueft, damit ein gleichzeitig ausgefuehrter Button-Klick respektiert wird.
- Der normale Aufwand ist O(1) je betroffenem Mitglied. Es entstehen keine Mitgliederscans, Rollenoperationen, Discord-Fetches oder periodischen Timer.
- Cooldown, Scope-Buendelung, Rate-Limit-Abstand und persistierte automatische Loeschung der Ping-Nachrichten bleiben unveraendert.
- Opt-out-Mitglieder erhalten keine Ping-Nachricht und verbrauchen keinen Cooldown.

## Ping-Info-Panel

- Das Panel verwendet einen eigenen Config-Schluessel `activityRace.pingInfoDesign` und eine eigene persistierte Nachrichtenreferenz.
- Frei bearbeitbar sind Content, bis zu zehn Embeds, Titel-Link, Beschreibung, Farbe, Autor, Thumbnail, grosses Bild, Felder, Footer, Zeitstempel und Aussenbild innerhalb der normalen Discord-Grenzen.
- Unter dem Studio-Payload wird serverseitig immer der echte Toggle-Button ergaenzt. Studio-Komponenten oder kopierte Fake-Buttons koennen den Funktionsbutton weder ersetzen noch duplizieren.
- Unterstuetzte Textplatzhalter sind `{server}` und `{buttonLabel}`. Funktionskritische Daten liegen nicht in grossen, uneditierbaren Platzhalterbloecken.
- Die App erhaelt in der Aktivitaets-Liga-Uebersicht den Befehl `Ping-Info-Embed bearbeiten` und beschreibt vier getrennte Nachrichten statt drei Embeds.

## Reihenfolge und Reparatur

- `ensurePanel(...)` pflegt zuerst Daily, Weekly und Monthly und danach das Ping-Info-Panel.
- Wird ein bisher unsichtbares Wochen- oder Monats-Panel neu erstellt, waehrend das Info-Panel bereits existiert, wird nur das Info-Panel geloescht und unmittelbar neu erstellt. Dadurch bleibt es unten, ohne alle Ranking-Nachrichten neu zu senden.
- Normale Ranking-Aktualisierungen und Studio-Saves editieren vorhandene Nachrichten und veraendern die Reihenfolge nicht.
- Deaktivieren oder Entfernen des Liga-Panels loescht auch das Info-Panel und bereinigt dessen Ledger-Referenz.

## Interaktionssicherheit

- Der Handler akzeptiert nur Button-IDs mit dem Aktivitaets-Liga-Praefix und dem exakten Toggle-Kind.
- Vor der Aenderung wird geprueft, ob die Interaktion von der aktuell gespeicherten Ping-Info-Nachricht stammt.
- Veraltete, kopierte oder manuell duplizierte Buttons antworten ephemeral mit `Dieses Liga-Ping-Panel ist nicht mehr aktuell.` und aendern keine Daten.
- Bots werden nicht gespeichert. Fehler beim Laden oder Speichern werden ueber den bestehenden Diagnosepfad sichtbar und liefern eine klare ephemeral Fehlermeldung.

## Studio-Roundtrip

- Das bestehende Activity-Race-Studio erhaelt neben `daily`, `weekly` und `monthly` den Abschnitt `ping-info`.
- Der Save-Endpunkt akzeptiert den Abschnitt explizit, validiert das normale Studio-Payload und speichert ausschliesslich `pingInfoDesign`.
- Nach erfolgreichem Speichern wird nur das Ping-Info-Panel aktualisiert; die drei Ranking-Nachrichten und deren getrennte Aussenbilder bleiben unberuehrt.
- Beim erneuten Oeffnen werden gespeicherte Bilder, Anhaenge, mehrere Embeds und alle Texte vollstaendig zurueckgeladen.

## Tests

- Default ist aktiviert, gespeicherter Opt-out ist deaktiviert.
- Toggle schreibt und entfernt den Opt-out atomar und ueberlebt einen Store-Neustart.
- Ein veralteter Button und ein Bot veraendern nichts.
- Opt-out-Mitglieder werden vor dem Pingversand entfernt und erhalten keinen Cooldown.
- Ein erneuter Check direkt vor `channel.send` verhindert einen Race-Ping nach gleichzeitigem Ausschalten.
- Das Info-Panel wird genau einmal erstellt, editiert und bei spaeter neu erstelltem Perioden-Panel wieder ans Ende gesetzt.
- Studio-Save und -Reload erhalten Content, mehrere Embeds, Bilder, Aussenbild und den echten Funktionsbutton.
- Community-, Qualitaets-, Interaktions-Soak-, Packaged-Runtime- und Artefakt-Tests laufen vor der EXE-Freigabe vollstaendig.
