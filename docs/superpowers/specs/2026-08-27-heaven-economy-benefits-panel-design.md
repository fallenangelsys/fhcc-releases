# Heaven Economy VIP-Vorteile-Panel Design

**Datum:** 2026-08-27

## Ziel

Das bisherige statische Heaven-Coin-Panel wird zu einem einzigen, vollstaendig editierbaren VIP-Vorteile-Embed. Der Bot verwaltet diese Nachricht dauerhaft und setzt darunter automatisch das aktuelle Heaven-Economy-Funktionsset. Das manuelle Benutzer-Embed wird danach nicht mehr benoetigt.

## Eine gemeinsame Vorlage

`heavenEconomy.panelTemplate` ist die einzige Quelle fuer das oeffentliche VIP-Vorteile-Panel. Die Vorlage enthaelt Nachrichteninhalt, genau ein Embed, Farbe, Titel, Beschreibung, URL, Autor, Thumbnail, Bild, Footer, Zeitstempel und bis zu 25 Felder.

Das bestehende Embed Studio erhaelt im Heaven-Economy-Modul einen eindeutigen Einstieg `VIP-Vorteile-Panel bearbeiten`. Beim Oeffnen wird `panelTemplate` geladen. Beim Speichern wird die Vorlage normalisiert, in der Guild-Konfiguration persistiert und die kanonische Discord-Nachricht unmittelbar aktualisiert oder neu erstellt.

## Discord-Komponenten

Das Panel besitzt genau sieben Funktionsbuttons:

1. `Mein Konto`
2. `VIP-Shop`
3. `VIP verschenken`
4. `Coins verschenken`
5. `Coins kaufen`
6. `Boost-Fortschritt`
7. `Coin-Verwaltung`

Der bisherige Button `VIP-Vorteile` und sein separater ephemerer Hardcode-Embed-Pfad werden entfernt. Es kommt kein neuer Discord-Button hinzu. Die Vorteile stehen bereits im Hauptembed und werden dort im Studio bearbeitet.

`buildHeavenEconomyComponents(cfg)` bleibt die einzige Quelle fuer die funktionalen Komponenten. Deshalb erhalten sowohl das automatisch verwaltete Panel als auch ein ueber das Studio verwendetes Heaven-Economy-Funktionsset dieselben aktuellen Buttons. Deaktivierte Coin-Geschenke werden nicht als unbrauchbarer Button angezeigt.

## Panel-Lebenszyklus

`ensurePanel(guild, cfg)` gleicht den Soll-Zustand mit Discord ab:

- Modul deaktiviert oder kein Kanal konfiguriert: kein Versand.
- Gespeicherte Message-ID erreichbar: Inhalt, Embed und Komponenten aktualisieren.
- Message-ID fehlt oder Nachricht wurde geloescht: genau eine neue Panel-Nachricht senden und ID speichern.
- Parallel eintreffende Refresh-Anforderungen derselben Guild werden serialisiert, damit nicht zwei Panels entstehen.
- Ein erfolgreicher Save antwortet erst dann als vollstaendig aktualisiert, wenn Persistenz und Live-Refresh abgeschlossen sind.
- Ein Discord-Fehler behaelt die gespeicherte Vorlage, wird aber als Live-Refresh-Fehler an die App gemeldet.

## Konfiguration und Migration

Neue oder erweiterte Konfigurationswerte:

- `heavenEconomy.panelTemplate`: gemeinsame Studio-Vorlage.
- Bestehende `panelChannelId` und `panelMessageId` bleiben kanonisch.
- `perksButtonLabel` wird nicht mehr als sichtbare Einstellung angeboten und nicht mehr fuer Komponenten verwendet. Der Altwert darf bei der Normalisierung erhalten bleiben, damit keine fremde Config-Struktur unnoetig geloescht wird.
- Fehlt `panelTemplate`, erzeugt die Normalisierung den bisherigen statischen Panelinhalt als editierbaren Standard. Bestehende Server verlieren dadurch keinen Inhalt.
- `coinGiftMinAmount` und `coinGiftMaxAmount` werden gemeinsam normalisiert; das effektive Maximum ist immer mindestens so gross wie das Minimum.

## App-Verhalten

Im Heaven-Economy-Modul erscheint oberhalb der automatischen DM-Vorlagen ein eigener Bereich fuer das VIP-Vorteile-Panel:

- sichtbarer Status fuer Kanal, bestehende Message-ID und letzten Refresh,
- `VIP-Vorteile-Panel bearbeiten`,
- `Panel jetzt aktualisieren`, sofern Modul und Kanal aktiv sind.

Das Studio kennzeichnet die Ansicht als `Heaven Economy · VIP-Vorteile-Panel`. Die Funktionsbuttons sind nicht als frei gestaltete Fake-Komponenten Bestandteil der Vorlage; sie werden beim Discord-Versand immer aus `buildHeavenEconomyComponents(cfg)` angehaengt. Die Vorschau darf die sieben Funktionen sichtbar simulieren, der gespeicherte Embed-Inhalt bleibt davon getrennt.

## Fehler- und Sicherheitsregeln

- Eine leere oder ungueltige Embed-Vorlage faellt auf den vollstaendigen Standard zurueck und erzeugt keine leere Discord-Nachricht.
- Bild-URLs verwenden dieselbe Sicherheitsvalidierung wie die bestehenden persistenten Embed-Designs.
- Beim Speichern werden hoechstens ein Embed und 25 Felder akzeptiert.
- Panel-Refreshes veraendern keine Coin-Konten, VIP-Rollen oder Transaktionen.
- Das Loeschen des manuellen Benutzer-Embeds ist keine Bot-Aktion; der Bot verwaltet ausschliesslich seine eigene kanonische Panel-Message-ID.

## Tests und Freigabe

Die Regressionstests muessen folgende Faelle abdecken:

- Standardvorlage wird aus der Config geladen und vollstaendig normalisiert.
- Studio-Save persistiert Titel, Beschreibung, Bilder, Footer und Felder.
- Save aktualisiert eine vorhandene Panel-Nachricht mit genau sieben funktionalen Buttons.
- Geloeschtes Panel wird genau einmal neu erstellt.
- Parallele Refreshes erzeugen keine Doppelpanels.
- `VIP-Vorteile` ist weder als Button noch als Interaktionspfad vorhanden.
- Deaktivierte Coin-Geschenke entfernen nur den Coin-Geschenk-Button; die anderen sechs bleiben funktionsfaehig.
- Mindest- und Hoechstbetrag werden widerspruchsfrei normalisiert.
- Economy-, UI-, Persistenz- und Release-Suiten bestehen vor dem neuen Installer.

## Dokumentation und Release

Die fertige Aenderung wird mit Datenfluss, Konfigurationsfeldern, Panel-Reparatur und Testbefehlen in `PROJEKT-WISSEN.md` dokumentiert. Anschliessend werden Patch-Version, Changelog, Renderer-Cache-Buster und Windows-Installer gemeinsam aktualisiert und durch Packaged-Runtime- sowie Artefakt-Audit geprueft.
