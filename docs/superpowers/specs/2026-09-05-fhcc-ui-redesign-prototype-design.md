# FHCC UI Redesign Prototype

## Ziel

Ein eigenstaendiger, anklickbarer HTML-Prototyp zeigt, wie die gesamte FHCC-App neu geordnet und visuell unverwechselbar gestaltet werden kann. Der Prototyp veraendert noch keine Produktionsoberflaeche. Er dient als gemeinsame visuelle Entscheidungsvorlage fuer den spaeteren Umbau.

Die Oberflaeche soll duester und cinematic wirken, aber als taegliches Verwaltungswerkzeug ruhig, schnell erfassbar und praezise bleiben. Sie darf weder wie ein generisches SaaS-Dashboard noch wie die aktuelle App mit neuem Farbschema aussehen.

## Informationsarchitektur

Die drei bestaetigten Richtungen werden nach Aufgabe kombiniert:

- **Command Deck:** Eine schmale horizontale Hauptnavigation ersetzt die permanente Icon-Seitenleiste. Sie enthaelt Uebersicht, Server, Module, Embed Studio und System.
- **Server Atlas:** Die Uebersicht zeigt den Server als zusammenhaengendes Betriebssystem mit laufenden Bereichen, Aktivitaet, Warnungen und direkten Spruengen. Keine Wand aus gleichfoermigen Kennzahlenkarten.
- **Operator Console:** Arbeitsbereiche verwenden eine dichte Dreiteilung aus Objektliste, Hauptarbeitsflaeche und kontextbezogenen Eigenschaften.

## Ansichten im Prototyp

### Uebersicht

- Der Servername FALLEN HEAVEN ist das staerkste Signal im ersten Viewport.
- Eine grosse operative Lageflaeche zeigt aktive Module, aktuelle Aktivitaet und wichtige Abweichungen als verbundenes System.
- Eine Ereignisspur zeigt reale Aufgabenbegriffe wie TempVoice, Aktivitaets-Liga, Counting und Server-Tag.
- Primaeraktionen fuehren direkt in den betroffenen Arbeitsbereich.

### Server

- Linke Spalte: Discord-Struktur mit Kategorien, Kanaelen und Mitgliedern als kompakte Textliste.
- Mitte: Kanalinhalt oder Mitgliedertabelle mit klarer Auswahl und echten Verwaltungsaktionen.
- Rechte Spalte: Eigenschaften des ausgewaehlten Objekts, nicht globale Einstellungen.
- Listen und Tabellen ersetzen dekorative Karten.

### Module

- Module werden als scanbare Systemzeilen gruppiert: Community, Sicherheit, Automationen und Wirtschaft.
- Status ist durch Punkt, Klartext und letzte Aktivitaet erkennbar; Farbe ist nie das einzige Signal.
- Auswahl oeffnet Konfiguration und Live-Zustand in der Hauptflaeche.
- Der globale Aktivzaehler wird Teil der Werkzeugleiste und kein isolierter Leuchtknopf.

### Embed Studio

- Linke Spalte: Inhalt und Embed-Struktur.
- Mitte: grosse Discord-nahe Vorschau.
- Rechte Spalte: Felder, Bilder, Komponenten und Platzhalter des ausgewaehlten Elements.
- Rollenbuttons, echte Funktionsbuttons und Dropdowns sind visuell getrennt und eindeutig benannt.

### System

- Prozesszustand, Logs, Updates und Diagnosen werden als zeitliche Betriebsspur dargestellt.
- Fehler besitzen Quelle, Zeitpunkt, Wirkung und konkrete Aktion.
- Keine grossen Ampelkarten ohne Kontext.

## Visuelle Sprache

### Farben

- `Void` `#050608`: Grundflaeche.
- `Iron` `#111318`: Arbeitsflaechen.
- `Ash` `#8A909B`: sekundaere Information.
- `Bone` `#E7E4DD`: primaerer Text.
- `Halo` `#A996FF`: aktive Navigation und Heaven Line, sparsam eingesetzt.
- `Signal` `#E35D6A`: Fehler und kritische Eingriffe.
- `Alive` `#52D39A`: gesunder Live-Zustand.

Die Palette wird nicht von einer einzigen Hue-Familie dominiert. Flaechen bleiben neutral; Akzentfarben codieren Bedeutung.

### Typografie

- Display: schmale, charaktervolle Grotesk fuer FALLEN HEAVEN und Bereichstitel.
- Text: gut lesbare Humanist-Sans fuer Bedienung und Erklaerungen.
- Daten: Monospace fuer IDs, Zeiten, Messwerte und Logs.
- Keine viewport-abhaengige Schriftgroesse und keine negative Laufweite.

### Form und Material

- Radien maximal 6 px, meistens 0 bis 4 px.
- Feine Trennlinien und versetzte Paneelkanten statt schwebender Karten.
- Keine Buchstaben in quadratischen Icon-Kacheln.
- Keine dekorativen Orbs, Bokeh-Flaechen oder grossen AI-typischen Farbverlaeufe.
- Rauch erscheint nur als sehr schwache Bitmap-Textur im Atlas und stoert keine Inhalte.

## Signatur: Heaven Line

Eine duenne, unterbrochene Lichtlinie verbindet aktive Navigation, aktuelle Auswahl und Live-Status. Ihre Segmente reagieren auf Ansichtswechsel und markieren den aktuellen Arbeitskontext. Sie ist das einzige expressive Bewegungselement; bei `prefers-reduced-motion` bleibt sie statisch.

## Interaktion

- Alle fuenf Hauptansichten sind im Prototyp anklickbar.
- Serverobjekte, Module und Studioelemente besitzen Auswahlzustaende und aktualisieren ihre Detailspalte.
- Eine globale Befehlssuche kann geoeffnet und geschlossen werden.
- Statusfilter und Studio-Tabs funktionieren sichtbar.
- Hover, Fokus und Tastaturbedienung sind eindeutig.
- Der Prototyp simuliert keine Backend-Aktionen und schreibt keine Projektdaten.

## Responsive Verhalten

- Desktop ab 1180 px: volle Drei-Spalten-Arbeitsbereiche.
- Tablet: Eigenschaften werden als rechte Schublade eingeblendet.
- Mobil: Hauptnavigation wird horizontal scrollbar; Listen, Arbeitsflaeche und Details werden zu klaren Ebenen statt gleichzeitig gequetscht.
- Feste Werkzeughoehen und Grid-Tracks verhindern Layoutspruenge.

## Technische Umsetzung

- Eine eigenstaendige HTML-Datei unter `docs/`, mit eingebettetem CSS und JavaScript.
- Keine Build-Abhaengigkeit und keine Veraenderung der Electron-App.
- Bestehende lokale Fallen-Heaven-Bildassets duerfen als Hintergrundtextur verwendet werden; der Inhalt bleibt auch ohne Asset lesbar.
- Icons werden als vertraute Unicode-/Textsymbole oder vorhandene Projektassets eingesetzt, da der Standalone-Prototyp keine neue Icon-Abhaengigkeit einfuehrt.

## Abnahmekriterien

- Der erste Eindruck ist klar von der aktuellen App und generischen Admin-Dashboards unterscheidbar.
- Jede Hauptansicht besitzt eine fuer ihre Aufgabe passende Struktur.
- Es gibt keine verschachtelten Kartenwaende, quadratischen Buchstabenbuttons oder unerklaerten Statuslichter.
- Der Prototyp funktioniert lokal per `file:///` und ist auf Desktop sowie Mobile ohne Ueberlappungen bedienbar.
- Screenshots und Interaktionen werden vor der Uebergabe im Browser geprueft.
