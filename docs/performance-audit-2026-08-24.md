# FHCC Modul-, Effizienz- und Performance-Audit

Stand: 2026-08-24  
Gepruefte Version: 3.9.292  
Umfang: alle 30 registrierten Bot-Module, Dispatcher, Serverindex, Persistenz und Electron-Renderer.

## Kurzurteil

Die App ist funktional belastbar, aber noch nicht performance-fertig. Der zentrale Dispatcher, die SQLite-Indizes und die Interaktionsabsicherung sind gut aufgebaut. Die groessten Kosten entstehen nicht in kleinen Event-Modulen, sondern durch vier konkrete Pfade:

1. Die Aktivitaets-Liga aktualisiert alle 30 Sekunden Rollenlogik und drei Discord-Nachrichten. Ihr Tick laeuft auch bei deaktiviertem Modul weiter.
2. Public Call bearbeitet eine aktive Abstimmungsnachricht sekundenweise. Eine 60-Sekunden-Abstimmung kann dadurch etwa 60 Discord-Edits erzeugen.
3. Der Carl-bot-Voice-Import liest beim Start und vor jedem automatischen Inaktivitaetslauf die komplette bereits bekannte Historie erneut.
4. Der Electron-Renderer laedt beim Start alle grossen Routen und insgesamt rund 1,88 MB CSS/JavaScript, obwohl der Nutzer nur eine Ansicht braucht.

Es wurde in diesem Audit bewusst noch kein Produktionsverhalten geaendert.

## Gemessene Basis

- 30 registrierte Features in `src/index.js`, 33 JavaScript-Dateien im Feature-Ordner.
- Feature-Quellcode: 32.024 Zeilen, 1.578.741 Bytes.
- Zentrale Dateien: `src/index.js` 5.775 Zeilen, `desktop/renderer/app.js` 9.778 Zeilen, `server-management.js` 2.633 Zeilen.
- Eager geladene Renderer-Ressourcen: rund 1,88 MB CSS/JS plus 71,7 KB HTML, Bilder und Fonts.
- Groesste Startressourcen: `ui-base.css` 757.063 Bytes, `app.js` 561.081 Bytes, `server-management.js` 176.237 Bytes, `ui-aurora.css` 137.432 Bytes.
- Bot-Importpruefung: 575 ms auf diesem Rechner.
- Lokaler Projekt-Datenbestand: 75 Dateien, 13.629.985 Bytes. Aktuell besteht kein Speicherplatzproblem.
- Interaktions-Soak: 116/116 Klicks unter hoher simulierter I/O-, REST-, SQLite- und Nachrichtenlast rechtzeitig bestaetigt; maximale Ack-Latenz 1.984 ms.
- Serverindex: 13/13 Optimierungschecks gruen; Cache-Discovery 5/5 gruen; Dispatcher-Smoke gruen.

## Bestaetigte Fehler

### P1: Aktivitaets-Liga laeuft deaktiviert weiter

`activityRace.onClientReady` startet `startRuntime(runtime)` vor der Enabled-Pruefung. `onConfigUpdate` stoppt den 30-Sekunden-Tick beim Deaktivieren ebenfalls nicht. Rollen- und Panelmethoden brechen spaeter ab, aber Indexabgleich, Voice-Settlement, Pruning und Heartbeat bleiben aktiv.

Empfehlung: Tick nur bei `runtime.conf.enabled` starten und beim Deaktivieren vollstaendig stoppen. Beim erneuten Aktivieren neu hydrieren.

### P1: Aktivitaets-Liga erzeugt dauerhafte Discord-Last

Jeder 30-Sekunden-Tick plant mit `force: true` einen Rollenabgleich und einen Panelrefresh. `ensurePanel` fetch/editet dabei bis zu drei getrennte Ranglisten-Nachrichten. Das sind im stabilen Leerlauf bis zu 360 Nachrichtenoperationen pro Stunde und Server, zuzueglich Rollen- und Indexarbeit.

Empfehlung: Payload-Fingerprint pro Zeitraum speichern und nur bei einer sichtbaren Aenderung editieren. Rollen nur bei geaenderter Top-3-/Perioden-Signatur abgleichen. Den naechsten Auswertungszeitpunkt als Discord-Timestamp rendern, statt fuer eine laufende Uhr zu editieren.

### P1: Public-Call-Countdown editiert jede Sekunde

`startVoteTicker` editiert die Abstimmungsnachricht bei jeder geaenderten Restsekunde. Bei mehreren parallelen Votes vervielfacht sich diese Last und konkurriert mit echten Interaktionsantworten um Discord-Rate-Limits.

Empfehlung: Einen absoluten Discord-Timestamp wie `<t:...:R>` verwenden und nur bei Stimmen, Verlaengerung und Abschluss editieren. Der separate Endtimer bleibt fuer die Entscheidung erhalten.

### P2: Public-Call-Fehlerpfad verwendet undefinierte Variable

Im Catch des Ergebnis-Auto-Deletes wird `messageId` protokolliert, obwohl die Funktion nur `message` besitzt. Scheitert das Loeschen, kann der Fehlerhandler selbst einen `ReferenceError` erzeugen.

Empfehlung: `message.id` verwenden und den Fehlerpfad mit einem Regressionstest abdecken.

### P1: Voice-Historie wird wiederholt komplett verarbeitet

`runVoiceLogBackfill` fragt alle passenden Indexzeilen aufsteigend ab und parsed jede Zeile erneut. Die Menge der bereits verarbeiteten IDs verhindert doppelte Buchungen, verhindert aber nicht das erneute Laden, Parsen und Iterieren. Der Pfad laeuft beim Botstart und vor jedem automatischen Inaktivitaetsscan.

Empfehlung: Pro Guild/Kanal einen persistenten Index-Cursor speichern. Erstlauf bleibt vollstaendig; Folgelaeufe lesen nur Zeilen nach dem Cursor. Fuer Nachimporte oder geaenderte historische Daten bleibt ein expliziter Vollabgleich verfuegbar.

### P2: Verifizierungs-Reminder behaelt alte Konfiguration

`ensureReminderTimer(guild, cfg)` schliesst die damalige Config ein. `memberVerify.onConfigUpdate` aktualisiert oder stoppt den Timer nicht. Aenderungen an Aktivierung, Kanal, Intervall oder Reminderregeln gelten deshalb erst nach Neustart oder einer anderen Timer-Neuanlage.

Empfehlung: Wie beim Inaktivitaetsmodul eine `latestConfigs`-Map verwenden oder den Timer bei jeder relevanten Konfigurationsaenderung ersetzen.

### P2: Rich Presence besitzt nur einen globalen Guild-Scheduler

`customRichPresence` verwendet genau einen globalen Timer, Client und Signatur. Bei mehreren Guilds ueberschreibt der zuletzt initialisierte Server den vorherigen Zeitplan. Presence-Events aller Guilds laufen trotzdem in denselben Single-Flight-Pfad.

Empfehlung: Die App muss eine explizite aktive Guild fuer RPC waehlen oder Runtime-Zustaende sauber pro Guild fuehren. Presence-Events sollten zusaetzlich debounced werden.

## Architektur-Hotspots

### Renderer-Start

Alle Routen werden ueber klassische Script-Tags sofort geladen und geparsed, darunter Studio, Skin Studio, Serververwaltung und Diagnose. Die zentrale CSS-Datei ist groesser als der komplette Haupt-Renderer-Code vieler Desktop-Apps. Die bereits vorhandene Jobverwaltung pausiert Hintergrundjobs gut bei verstecktem Fenster, loest aber die Startkosten nicht.

Empfehlung: Shell und aktive Startansicht klein halten; Studio, Skin, Serververwaltung und Diagnose per dynamischem Import laden. CSS in Tokens/Shell und routenspezifische Dateien aufteilen. Erst danach minifizieren, damit tote Regeln wirklich verschwinden.

### Doppelte Aktivitaetspipelines

`memberManagement`, `levels`, `activityRace`, `serverContext` und `voiceLogImport` reagieren teilweise auf dieselben Nachrichten-/Voice-Ereignisse und pflegen getrennte Zustandsdateien. Das ist korrekt, verursacht aber mehrfaches Normalisieren, Queueing und Speichern.

Empfehlung: Einen schmalen internen Activity-Event-Service einfuehren. Der Serverindex bleibt kanonische Nachrichtenquelle; Leveling und Liga abonnieren normalisierte Events und halten nur ihren fachlichen Zustand.

### Synchrones SQLite im Hauptprozess

Der Serverindex nutzt WAL, `synchronous=NORMAL`, Transaktionen, Schreibbatching, partielle Indizes, Keyset-Pagination und Worker-VACUUM. Das ist gut. `better-sqlite3` bleibt jedoch synchron; grosse Lazy-Recomputes eines Mitglieds oder breite Analyseabfragen blockieren kurz den Event-Loop.

Empfehlung: Erst ueber Diagnostik reale Query-Dauern messen. Nur Abfragen oberhalb eines klaren Budgets in einen Worker verlagern; kleine Live-Ingest-Batches im Hauptprozess belassen.

### Regelpruefung pro Nachricht

Auto Responder baut Regeln, Sets und regulaere Ausdruecke pro Nachricht neu auf. Moderation normalisiert Wortlisten pro Nachricht. Instant Wort-Ban flacht und normalisiert seine Wortliste ebenfalls jedes Mal neu ab.

Empfehlung: Kompilierte Regelsaetze nach Config-Revision cachen. Cooldown-/Dedup-Maps ueber einen periodischen Pruner statt durch Volliteration bei jeder Nachricht bereinigen.

## Bewertung aller Module

| Modul | Lastprofil | Urteil | Wichtigste Massnahme |
|---|---|---|---|
| Aktivitaets-Liga | Nachricht, Voice, 30-s-Tick, Rollen, 3 Panels | Hoch | Disabled-Timer stoppen, Fingerprints, keine 30-s-Force-Edits |
| Raid-Schutz | Nur Beitritt, kleines Zeitfenster | Niedrig | Bestehendes Modell beibehalten |
| Auto Responder | Jede Nachricht, Regeln neu kompiliert | Mittel | Regeln/Sets/Regex nach Config cachen |
| Auto Role | Start und Beitritt | Niedrig | Cache-first beibehalten |
| Booster-Rollen | Boost-Events, Startabgleich, stuendlich | Mittel | Mit Economy einen gemeinsamen Boost-Reconcile nutzen |
| Bot Updates | Start und 10-min-Panelreparatur | Niedrig | Payload-Fingerprint fuer Reparaturedits sicherstellen |
| Counting | Relevanter Kanal, 800-ms-Save-Debounce | Mittel | Kanal-Gate und Debounce sind gut; State spaeter auf SQLite pruefen |
| Rich Presence | Timer plus Presence-Events | Mittel | Guild-Scheduler korrigieren, Events debounce |
| Emoji Manager | Nur Admin-Aktion | Niedrig | Keine Laufzeitmassnahme noetig |
| Forum Cleaner | Eventpfad plus taeglicher Tiefenscan | Mittel | Checkpoints je Forum und inkrementelle Archivseiten |
| Heaven Economy | Boost-Events, 30-min-Reconcile, Panels | Mittel | Boost-Abgleich mit Booster-Rollen zusammenfassen |
| Inaktivitaets-Erinnerung | Start/24 h, Full Member Fetch, Voice-Backfill | Hoch | Voice-Cursor; Quellenchecks und Single-Flight behalten |
| Instant Wort-Ban | Jede Nachricht, Wortliste neu normalisiert | Mittel | Kompilierten Matcher nach Config cachen |
| Leveling | Jede Nachricht, 60-s-Voice, JSON-Saves, Panels | Mittel | Activity-Service; Panel nur bei Aenderung; State-Wachstum beobachten |
| Serverprotokoll | Viele seltene Events, Audit-REST bei Aenderung | Mittel | Audit-Abfragen kurz cachen und gleichartige Events batchen |
| Member Management | Jede Nachricht, Index, periodische Discovery | Hoch | JSON-Metadaten nach SQLite verlagern; Query-Latenzen messen |
| Mitglieder-Verifizierung | Beitritt, Interaktionen, 60-s-Reminder | Mittel | Stale-Timer-Config beheben; faellige Nutzer statt alle Pending scannen |
| Moderation | Jede Nachricht, Wortlisten und Spamfenster | Mittel | Normalisierte Regeln cachen; Map-Pruning zentralisieren |
| Public Call | Voice/Interaktionen, sekundenweiser Vote-Edit | Hoch | Discord-Timestamp statt Sekunden-Edits; Delete-Bug beheben |
| Rollen-Saver | Leave/Join, atomare Datei | Niedrig | Bei starkem Wachstum spaeter SQLite, aktuell unkritisch |
| Rollen-Swap | Member-Update, einmaliger Startabgleich | Niedrig bis mittel | Nur geaenderte relevante Rollen vergleichen |
| Server-Backup | Taeglich, Check alle 30 Minuten | Niedrig | Due-Timer statt 30-min-Poll optional |
| Server Context | Systemevents, JSONL, Head-Abgleich | Mittel | SQLite als einzige Langzeitquelle anstreben |
| Server-Tag-Tracker | Eventbasiert, Vollscan nur manuell/Config | Niedrig | Aktuelle eventbasierte Architektur beibehalten |
| Steam Workshop | On demand, mindestens 15-min-Netzsync | Niedrig | Fingerprints und Single-Flight sind passend |
| Temp Voice | Voice-Events und Interaktionen | Niedrig | Aktuelles Single-Flight/Profilmodell beibehalten |
| Tickets | Startpanel und Interaktionen | Niedrig | Keine dringende Performancearbeit |
| Voice-Chat-Cleaner | Voice-Leave, gezielte Historie | Mittel | Pro Kanal single-flight und Cursor konsequent halten |
| Carl-bot Voice-Import | Live billig, historische Volliteration teuer | Hoch | Persistenter Cursor plus expliziter Vollabgleich |
| Welcome/Farewell | Join/Verify/Leave | Niedrig | Externe Asset-Aufloesung weiter cachen |

## Was bereits gut ist

- Dispatcher: Module laufen parallel; Reihenfolge bleibt pro Feature, Hook und Guild erhalten.
- Interaktionen: Watchdog bestaetigt auch bei langsamen Handlern vor Discords Frist.
- Serverindex: WAL, Write-Batching, Transaktionen, Precompute-Tabellen, partielle Indizes und Keyset-Pagination.
- Wartung: SQLite-VACUUM laeuft im Worker und nur bei relevantem freien Speicher.
- Renderer-Jobs: Single-Flight, Backoff und Pause bei verstecktem Fenster sind zentral vorhanden.
- Grosse Discord-Scans sind in mehreren Modulen bereits auf Cache-first oder manuelle Ausloesung umgestellt.
- Persistente JSON-Dateien werden ueber atomare Writes und Recovery-Backups geschuetzt.

## Empfohlene Reihenfolge

1. Aktivitaets-Liga: Disabled-Timer, Rollen-/Panel-Fingerprint und Updatefrequenz korrigieren.
2. Public Call: Sekunden-Edits entfernen und undefinierte Variable reparieren.
3. Voice-Log-Import: persistenten Cursor bauen, dann Inaktivitaetslauf darauf umstellen.
4. Member Verify: Timer-Config-Lifecycle korrigieren.
5. Renderer: Route-Lazy-Loading und CSS-Aufteilung mit Startmessung vor/nach dem Umbau.
6. Regelmodule: Auto Responder, Moderation und Instant Wort-Ban vorkompilieren.
7. Aktivitaetsdaten langfristig konsolidieren; SQLite-Worker nur fuer nachweislich langsame Queries einsetzen.

## Verifikation dieses Audits

- `node scripts/feature-dispatcher-smoke.mjs`: bestanden.
- `node scripts/index-optimizations-smoke.mjs`: 13 Checks gruen.
- `node scripts/server-index-discovery-smoke.mjs`: 5 Tests gruen.
- `node scripts/verify-bot-imports.mjs`: bestanden, gemessen 575 ms.
- `node scripts/watchdog-soak-stress.mjs --duration 12 --rate 20 --max-io 3500 --seed 7`: 116/116 rechtzeitig bestaetigt.

