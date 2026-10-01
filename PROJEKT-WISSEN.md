
## Zähl-Kanal: Lösch-/Verlierer-Verhalten (seit 3.9.185)
- Rolling-Window beim Zählen: Es bleiben immer nur `clearChannelKeepMessages` (Standard 5) neueste Zähl-Nachrichten. `cleanupDue(since, keep)` → Aufräumen läuft NUR wenn fällig (kein fetch/bulkDelete pro Zug), `clearCountingChannel` schützt Panel-Embed + Pins.
- Fehlversuch: falsche Nachricht + alles davor weg (keep 0). Verlierer-Nachricht wird SOFORT gesendet, bleibt `clearChannelDelaySeconds` (Standard 10) sichtbar und wird danach über `scheduleLossMessageRemoval` per ID entfernt – neue richtige Züge werden NIE gelöscht. Delay 0 = sofort entfernen. Kanal gewechselt → keine Löschung.
- WICHTIG: `clearChannelDelaySeconds` steuert die Anzeigedauer der Verlierer-Nachricht (war früher tote Einstellung). Smoke: `scripts/counting-smoke.mjs` (Fehlversuch-Flow + Removal-Test).

## Public-Call-Moderation: fehlende Embeds werden beim Live-Refresh repariert (seit 3.9.272, 2026-08-22)

### Gemeldetes Symptom
- Im Embed Studio ließ sich eine Public-Call-Moderationsvorlage speichern, aber in ausgewählten Voice-Calls erschien kein Moderations-Embed.
- Der Speichervorgang konnte trotzdem erfolgreich wirken, weil der zentrale Embed-Design-Pfad die Config persistierte und `refreshPublicCallVoteLive(...)` ohne sichtbaren Fehler zurückkehrte.

### Nachgewiesene Root Cause
- `src/index.js` bindet `savePublicCallVoteDesign` korrekt über `persistEmbedDesign(...)` an Config-Speicherung und Live-Refresh.
- Der Fehler lag in `src/features/publicCallVote.js` innerhalb von `refreshPublicCallVoteLive(...)`.
- Der alte Refresh-Pfad iterierte nur über bereits registrierte Einträge aus `data.panels[guildId]`. Wenn dort für einen ausgewählten Call keine Message-ID stand, wurde der Kanal sofort übersprungen.
- Dasselbe galt, wenn eine Panel-Nachricht auf Discord manuell gelöscht worden war und der State leer oder veraltet war: Der Live-Refresh stellte den Soll-Zustand nicht wieder her.
- Damit gab es eine falsche Erfolgssituation: Design gespeichert, Refresh ausgeführt, aber kein Panel gesendet.

### Fix und gewünschter Datenfluss
- `refreshPublicCallVoteLive({ guild, conf })` normalisiert weiterhin zuerst die Modul-Config.
- Danach ruft die Funktion jetzt immer `ensurePublicVotePanels({ guild, conf: normalized })` auf.
- `ensurePublicVotePanels(...)` ist der kanonische vollständige Abgleich:
  - bestehendes Panel aus Cache oder Discord laden und editieren,
  - gelöschte/nicht auffindbare Nachricht aus dem State entfernen,
  - fehlendes Panel mit Embed und Button neu senden,
  - neue Message-ID unter `public-call-vote.json -> panels[guildId][channelId]` speichern,
  - nicht mehr ausgewählte Panels entfernen und ihren Schutz deregistrieren.
- Erst danach aktualisiert `refreshPublicCallVoteLive(...)` weiterhin alle offenen Abstimmungsnachrichten mit dem aktuellen Vote-Design.
- Die vorher doppelte, unvollständige Panel-Edit-/Cleanup-Logik wurde aus dem Refresh entfernt. Dadurch existiert nur noch ein Panel-Abgleichspfad und das frühere Cleanup enthielt außerdem keinen Verweis mehr auf die dort undefinierte Variable `existingId`.

### Regressionstest (TDD)
- Testdatei: `scripts/public-call-vote-smoke.mjs`.
- Reproduktion: aktives Modul + ausgewählter Voice-Kanal + `panels: { g1: {} }` + leerer Vote-State.
- Erwartung: `refreshPublicCallVoteLive(...)` ruft den `send(...)`-Pfad des Voice-Kanals auf, sendet das konfigurierte Embed `NEUES PANEL` und persistiert die zurückgegebene ID `panel-msg-recreated`.
- RED vor dem Fix: Assertion `Live-Refresh erstellt ein fehlendes Moderations-Panel neu`, Istwert `undefined`, Erwartung `NEUES PANEL`.
- GREEN nach dem Fix: `node scripts/public-call-vote-smoke.mjs` endet mit `public-call-vote-smoke: alle Assertions grün`.

### Wichtige Betriebsdiagnose
- Entwicklungsdaten liegen standardmäßig unter `C:\Users\5gtag\Documents\Discord Bot\data`.
- Die Desktop-App setzt `FALLEN_HEAVEN_DATA_DIR` auf `C:\Users\5gtag\AppData\Roaming\FALLEN HEAVEN Control Center\runtime\data`.
- Der am 2026-08-22 lokal gefundene Desktop-App-Datensatz war zuletzt am 2026-08-13 geschrieben worden und damit kein verlässlicher Beleg für die aktuelle Auswahl in der App. Er enthielt `publicCallVote.enabled: false`, keine Call-IDs und einen leeren Panel-State; der Benutzer bestätigte ausdrücklich, dass die Calls in der aktuellen App ausgewählt sind. Dieser alte Snapshot darf deshalb nicht als Ursache des aktuellen Fehlers gewertet werden.
- Die Auswahl-UI wurde bis zum Backend verfolgt: `multiChannelInput(...)` rendert die Voice-Kanäle, `collectModuleConfig(...)` sammelt alle markierten IDs, `savePatch(...)` sendet den Modul-Patch an `PUT /api/config/:guildId`, und `normalizeConfig(...)` wandelt die zeilengetrennten IDs wieder in Arrays um. Für einen Verlust der Auswahl in diesem Pfad gab es keinen Beleg.
- Der relevante, reproduzierte Fehler war unabhängig davon der leere/fehlende Panel-State trotz aktiver Auswahl. Genau diesen Zustand repariert der neue vollständige Panel-Abgleich. Grundsätzlich werden Panels weiterhin nur erzeugt, wenn das Modul aktiv ist und mindestens ein Call in `callChannelIds`, `callChannelIds2`, `callChannelIds3` oder `callChannelIds4` konfiguriert ist.
- Bei erneutem Symptom in dieser Reihenfolge prüfen:
  1. tatsächliches Runtime-Datenverzeichnis der laufenden App,
  2. `publicCallVote.enabled === true`,
  3. mindestens eine gültige Voice-Channel-ID in einer der vier Call-Listen,
  4. Bot-Rechte zum Anzeigen und Schreiben im integrierten Textchat des Voice-Kanals,
  5. Runtime-Log auf `Panel-Send fehlgeschlagen`, `Panel-Edit fehlgeschlagen` oder `[publicCallVote] Vote-Panel`.

### Verifikation
- Fokus-Test: `node scripts/public-call-vote-smoke.mjs`.
- Breiter Community-Test: `npm run test:community`.
- Der Fokus-Test arbeitet mit einem temporären `FALLEN_HEAVEN_DATA_DIR` und verändert keine echten Guild-Daten.

### Release-Freigabe 3.9.272
- Die App-Version wurde für die neue EXE-Freigabe von `3.9.271` auf `3.9.272` gehoben.
- `package.json` und `package-lock.json` müssen beide `3.9.272` tragen; `release-readiness.cjs` blockiert abweichende Lockfile-Versionen.
- `desktop/renderer/index.html` und die Root-Kopie `index.html` tragen für die Haupt-CSS-/JS-Dateien `?v=3.9.272`. Ohne diesen Cache-Buster kann Chromium nach einem Update alte Renderer-Dateien weiterverwenden.
- `bot-changelog.json` enthält einen Eintrag für `3.9.272`, damit Update-Embeds den Public-Call-Fix korrekt anzeigen.
- Die neue Freigabe-EXE soll unter `dist/FHCC-Setup-3.9.272-x64.exe` liegen; `dist/latest.yml` muss nach dem Build ebenfalls auf `3.9.272` zeigen.
- Beim ersten 3.9.272-Build stoppte `scripts/package-artifact-audit.cjs`, weil `docs/` und `harness/` im `app.asar` lagen. `package.json -> build.files` schließt diese Entwicklungsordner jetzt mit `!docs/**` und `!harness/**` aus; bei späteren Releases muss der Artifact-Audit wieder `privateFilesPackaged: 0` und `leftoverFilesPackaged: 0` melden.
- Finale 3.9.272-Freigabe wurde am 2026-08-22 gebaut:
  - Installer: `dist/FHCC-Setup-3.9.272-x64.exe`
  - Größe: `191848903` Bytes (`183` MiB laut Artifact-Audit)
  - SHA-256: `95A0F4BE00F7B37DBCBAC908D47B0EC6B4F4D653F1EBEF67B365F0836AFC2368`
  - `dist/latest.yml` zeigt auf `version: 3.9.272`, `path: FHCC-Setup-3.9.272-x64.exe`, `size: 191848903`
  - Artifact-Audit: `privateFilesPackaged: 0`, `leftoverFilesPackaged: 0`, `asarEntries: 4649`

## Top-Booster-Embed: Platzhalter-Blöcke im Studio aufgeklappt (seit 3.9.273, 2026-08-22)

### Gemeldetes Symptom
- Im Top-Booster-Embed-Studio war `{boostBlock1}` bzw. danach `{placeLine1}` zu grob. Der Block enthielt Trophäe, User-Ping, Boost-Zahl und festen Text in einem unsichtbaren Paket.
- Gewünschtes Verhalten: Nur echte dynamische Werte bleiben Platzhalter; alles andere, z. B. `> **...×** geboostet`, ist direkt im Embed-Feld editierbarer Text.

### Fix
- `src/features/boostRoles.js` erzeugt Default-Platzfelder jetzt aufgeklappt:
  - Platz 1: `{boostMarker1} {boost1}\n> **{boostCount1}×** geboostet`
  - Platz 2: `{boostMarker2} {boost2}\n> **{boostCount2}×** geboostet`
  - Platz 3: `{boostMarker3} {boost3}\n> **{boostCount3}×** geboostet`
- Alte gespeicherte Werte `{boostBlock1..3}`, `{placeLine1..3}` und `{boostRanking}` werden beim Rendern auf diese offene Vorlage migriert, damit bestehende Designs weiter funktionieren.
- `boostTopPlaceLineTemplate` bleibt kompatibel: Aus `{marker} Rang {place}: {mention} -> {boostCount}×` wird intern pro Platz z. B. `{boostMarker1} Rang 1: {boost1} -> {boostCount1}×`.
- `src/defaultConfig.js` enthält die aufgeklappten Felder direkt in `boostTopTemplate`, damit neue Guild-Configs und Studio-Defaults sofort offen sind.
- `desktop/renderer/app.js` nutzt denselben offenen Fallback und die Platzhalterliste zeigt keine `{boostBlockX}`-Blöcke mehr.

### Regression
- `scripts/boost-auto-role-smoke.mjs` prüft jetzt:
  - Default-Top-Booster-Felder enthalten keine `{boostBlockX}`-/`{placeLineX}`-Blöcke.
  - Die sichtbaren Studio-Werte bestehen aus `{boostMarkerX}`, `{boostX}` und `{boostCountX}` plus editierbarem Text.
  - Alte `{boostBlock1}`-Designs rendern weiter korrekt mit User-Ping und Boost-Zahl.
- Release-Ziel: Diese Änderung ist für `3.9.273`; `package.json`, `package-lock.json`, `desktop/renderer/index.html`, Root-`index.html` und `bot-changelog.json` wurden entsprechend auf `3.9.273` synchronisiert.
- Finale 3.9.273-Freigabe wurde am 2026-08-22 gebaut:
  - Installer: `dist/FHCC-Setup-3.9.273-x64.exe`
  - Größe: `593965429` Bytes (`566.4` MiB laut Artifact-Audit)
  - SHA-256: `E61A470C61C7499A9FC8EFD95463F6CBCF79E2C81089FDE0A8D56FD43BC0B4AD`
  - `dist/latest.yml` zeigt auf `version: 3.9.273`, `path: FHCC-Setup-3.9.273-x64.exe`, `size: 593965429`
  - Artifact-Audit: `privateFilesPackaged: 0`, `leftoverFilesPackaged: 0`, `asarEntries: 4759`

## Embed-Block-Platzhalter-Audit: Activity-Race und Counting geöffnet (seit 3.9.273, 2026-08-22)

### Audit-Ergebnis
- Nach dem Top-Booster-Fix wurde der Code nach groben Embed-Platzhalter-Paketen durchsucht, u. a. `{...BlockX}`, `{...Ranking}`, `{...Lines}`.
- Relevante sichtbare Kandidaten waren:
  - Aktivitäts-Liga: `{chatBlock1..3}`, `{voiceBlock1..3}` in Backend-Defaults und teils Hilfetexten.
  - Zähl-Panel: `{topBlock1..3}` in Backend-Defaults und Renderer-Studio-Fallback.
  - Bot-Updates: `{changeBlock1..10}` im Standardfeld "Was ist neu".
  - Levelrollen: sichtbare UI-Hinweise nannten noch `{levelRoleBlockX}`, obwohl einzelne Slots vorhanden sind.
- Level-Regeln waren bereits abgesichert: `{noXpLines}` und `{excludedLines}` werden auf `{noXpRoleNames}`, `{excludedChannels}` und `{excludedRoles}` zurückmigriert.
- Top-Booster war bereits mit `3.9.273` geöffnet; verbleibende `{boostBlockX}`/`{placeLineX}`-Treffer sind Legacy-Kompatibilität in Migration/Tests.

### Fix
- `src/features/activityRace.js`:
  - `defaultStatusFields()` nutzt jetzt offene Platzhalter:
    - Chat: `{chatMarker1} {chat1} > **{chatValue1}**` usw.
    - Voice: `{voiceMarker1} {voice1} > **{voiceValue1}**` usw.
  - Migration erkennt jetzt auch alte Single-Newline-Defaults `{chatBlock1}\n{chatBlock2}\n{chatBlock3}` und `{voiceBlock1}\n{voiceBlock2}\n{voiceBlock3}`.
- `src/defaultConfig.js`:
  - Activity-Race-Normalisierung migriert dieselben alten Single-Newline-Blöcke.
  - Modul-Hilfetexte listen keine `chatBlock`/`voiceBlock`-Tokens mehr als empfohlene Platzhalter.
- `src/features/counting.js`:
  - Standardfeld `Beste Serien` nutzt jetzt `{topMarkerX}`, `{topX}` und `{topValueX}` mit editierbarem Text.
  - Alte `{top}`- und `{topBlock1..3}`-Designs werden beim Normalisieren auf die offene Form migriert.
- `desktop/renderer/app.js`:
  - Counting-Studio-Fallback nutzt offene Top-Platzhalter.
  - Alte gespeicherte Counting-Top-Blöcke werden beim Öffnen des Studios aufgeklappt.
  - Sichtbare Platzhalterleisten/Hilfetexte wurden für Activity-Race, Counting, Levelrollen und Bot-Updates von Block-Tokens bereinigt, soweit einzelne Slots vorhanden sind.
- `src/features/botUpdates.js` und `src/defaultConfig.js`:
  - Bot-Update-Standards nutzen jetzt `• {change1}` bis `• {change10}` statt `{changeBlock1}` bis `{changeBlock10}`.
  - Alte `{changelog}`- und `{changeBlockX}`-Designs werden beim Normalisieren auf die offene Form migriert.

### Regression
- `scripts/activity-race-smoke.mjs` prüft jetzt, dass Activity-Race-Defaultfelder keine `{chatBlockX}`, `{voiceBlockX}`, `{chatRanking}` oder `{voiceRanking}` mehr enthalten.
- `scripts/counting-smoke.mjs` prüft jetzt:
  - Backend- und Renderer-Defaults enthalten offene `{topMarkerX}`/`{topX}`/`{topValueX}`-Slots.
  - Alte Counting-Top-Blöcke werden beim Normalisieren auf offene Zeilen migriert.
- `scripts/leveling-autoresponder-smoke.mjs` prüft jetzt, dass Bot-Updates die offene `• {changeX}`-Form verwenden und alte `{changeBlockX}`-Designs migriert werden.

## Gesamt-Audit: Effizienz, Performance und Fehler (2026-08-22, Version 3.9.271)

### Audit-Umfang und Baseline
- Geprüft wurden Electron-Main/Supervisor, Renderer-Startpfad, Express/API, Discord-Eventdispatcher, Feature-Hooks, JSON-Speicher, SQLite-Serverindex, Timer, Runtime-Diagnose, Tests und Release-Pipeline.
- `src`, `desktop`, `public` und `scripts` umfassen beim Audit 254 Dateien mit rund 22,6 MB. Große Einzeldateien sind unter anderem `desktop/renderer/ui-base.css` (746.677 Bytes), `desktop/renderer/app.js` (556.680 Bytes), `src/defaultConfig.js` (247.964 Bytes) und `src/index.js` (247.650 Bytes).
- Das Hauptfenster lädt drei CSS-Dateien mit zusammen rund 908 KB unkomprimiert und mehrere eigene JS-Dateien. Gzip-Vergleich: `ui-base.css` rund 134,5 KB, `app.js` rund 122 KB, `server-management.js` rund 40,8 KB, `skin-editor.js` rund 18,6 KB.
- Die 2,5-MB-Datei `assets/discord-supplied.css` liegt nicht im Hauptfenster-Startpfad. Sie darf deshalb nicht als primäre Startzeitursache bewertet werden.
- Bereits gute Architektur vor diesem Audit: 3D-Bibliotheken werden erst beim Öffnen des Skin Studios geladen; Serverindex nutzt SQLite, partielle Indizes, inkrementelle Member-Stats und Keyset-Pagination; JSON-Writes sind atomar/gedrosselt; Interaktions-Acks und Event-Loop-Lag werden überwacht; lange Feature-Hooks besitzen Timeouts.

### Fix 1: Renderer-Cache-Buster auf Paketversion synchronisiert
- Befund: `package.json` war `3.9.271`, `desktop/renderer/index.html` referenzierte CSS/JS noch mit `?v=3.9.266`, die Root-Kopie sogar mit `?v=3.9.199`.
- Auswirkung: Nach App-Updates konnte Chromium alte Renderer-Dateien weiterverwenden. Neue UI-Auswahl und alter JavaScript-/CSS-Stand konnten dadurch gemischt auftreten.
- RED: `npm run test:quality` scheiterte bei `Serververwaltung nutzt den aktuellen Cache-Buster`.
- Fix: alle versionierten Haupt-CSS-/JS-Referenzen in beiden HTML-Dateien auf `3.9.271` gesetzt.
- GREEN: `node scripts/server-management-ui-smoke.mjs` meldet `Serververwaltung UI smoke OK (3.9.271)`.

### Fix 2: Externe Font-Abhängigkeit aus dem App-Start entfernt
- Befund: `ui-base.css` lud Google Fonts per `@import`, obwohl Inter, Space Grotesk und JetBrains Mono bereits lokal als WOFF2 ausgeliefert werden.
- Auswirkung: unnötiger DNS/TLS/HTTP-Pfad, schlechter Offline-Start, mögliche FOIT/FOUT und externe Abhängigkeit im nativen Control Center.
- RED: UI-Recovery-Test meldete einen externen Font-Stylesheet-Import.
- Fix: Google-Import entfernt; Basisfont auf lokal vorhandenes `Inter` mit System-Fallback gesetzt. Die späteren lokalen `@font-face`-Definitionen bleiben kanonisch.
- GREEN: `node scripts/ui-recovery-layout-smoke.mjs` besteht.

### Fix 3: Feature-Dispatcher blockiert unabhängige Guilds nicht mehr
- Befund: `queueKeyFor(featureId, hook, context)` ignorierte `context` vollständig und erzeugte nur `${featureId}:${hook}`. Ein langsamer Hook eines Servers blockierte deshalb denselben Feature-Hook auf allen anderen Servern.
- Auswirkung: serverübergreifende Head-of-Line-Blockierung, anwachsende Queues und unnötig verspätete Reaktionen bei mehreren Guilds.
- RED: Zwei 60-ms-Hooks für `guild-a` und `guild-b` liefen vollständig seriell.
- Fix: Queue-Key enthält nun die Guild-ID aus Guild, Message, Interaction, Thread oder Voice-State. Ohne Guild gilt weiterhin ein gemeinsamer `global`-Key.
- Sicherheitsvertrag: Hooks desselben Features und derselben Guild bleiben geordnet; verschiedene Features und verschiedene Guilds dürfen parallel laufen.
- GREEN: `node scripts/feature-dispatcher-smoke.mjs` besteht inklusive Cross-Guild-Überlappung.

### Fix 4: Public-Call-Timestamp-Fallback korrigiert
- Befund: `normalizeDesignSection` nutzte `embed.timestamp !== false`. Ein fehlender Wert wurde daher immer `true`, selbst wenn die Panel-Standardsektion `timestamp: false` vorgibt.
- Auswirkung: Studio-Saves konnten Zeitstempel unbemerkt aktivieren und das gespeicherte Design verändern.
- RED: fehlender Timestamp im Panel ergab `true !== false`.
- Fix: expliziter Boolean gewinnt; nur bei `undefined` wird `fallback.timestamp === true` übernommen.
- GREEN: `node scripts/public-call-vote-smoke.mjs` besteht.

### Fix 5: Verwaiste Testkopie aus Produktionsbaum entfernt
- Befund: `src/features/inactive-reminder-smoke.mjs` war eine alte, unreferenzierte 18-KB-Kopie; der aktuelle 48-KB-Test liegt unter `scripts/`. Die alte Kopie importierte aus ihrem falschen Standort nicht existierende Pfade.
- Auswirkung: ASAR-/Case-Sensitive-Import-Audit und damit die Release-Suite brachen ab; unnötige Datei wäre mit der App paketiert worden.
- Fix: alte Kopie entfernt, kanonischer Test bleibt unter `scripts/inactive-reminder-smoke.mjs`.
- GREEN: `node scripts/case-sensitive-import-audit.cjs` prüft 185 Dateien erfolgreich.

### Fix 6: Release-Metadaten im Lockfile synchronisiert
- Befund: `package.json` war auf `3.9.271`, während die Root-Metadaten in `package-lock.json` noch `3.9.216` und eine abweichende Node-Untergrenze enthielten.
- Auswirkung: Alle Funktions- und Belastungstests liefen durch, aber die abschließende Release-Readiness brach wegen inkonsistenter Paketmetadaten ab.
- Fix: ausschließlich die Root-Paketversion und Root-Engine-Angabe des Lockfiles an `package.json` angeglichen; Abhängigkeitsversionen wurden nicht verändert.
- GREEN: `node scripts/release-readiness.cjs` und anschließend der vollständige Lauf `npm run test:release` bestehen.

### Runtime-Diagnose und Einordnung
- Projekt-Diagnose: 1.026.294 Operationen, 38 Fehler, 2 Overdue. Die dominanten alten Meldungen betreffen absichtlich pausierte Economy-Vergütung bei abweichendem Boost-Basisstand, nicht einen Event-Loop-Crash.
- Alter Desktop-Snapshot vom 13.08.: 1.446.241 Operationen, 1.436 Fehler, 1.155 Overdue. Dominant waren Server-Tag-Mitglieder-Vollfetches mit Gateway-Opcode-8-Rate-Limits.
- Aktueller Code startet beim Server-Tag-Tracker weder periodische noch Startup-Vollscans. Vollscan erfolgt nur manuell oder einmalig nach direkter Config-Änderung; reguläre Arbeit läuft eventbasiert. Die historischen Rate-Limits belegen das frühere Problem, aber keinen aktuellen automatischen Scan-Bug.

### Bewusst nicht blind umgebaut
- Die sehr großen Dateien `app.js`, `index.js`, `defaultConfig.js` und `ui-base.css` sind Wartbarkeitsrisiken. Eine Aufteilung ohne isolierte Modulgrenzen hätte eine hohe Regressionsfläche und wurde nicht als vermeintliche Performanceoptimierung verkauft.
- PNG-Assets von 1,6 bis 2,3 MB sind Kandidaten für verlustarme Größen-/Formatoptimierung. Ohne visuelle Vergleichs- und Packaging-Prüfung wurden sie nicht automatisch ersetzt.
- 459 stille Catch-/Fallback-Stellen sind nicht automatisch Bugs; viele schützen Discord-Retry-/Optionalpfade. Sie sollten künftig anhand der Live-Diagnose priorisiert statt global entfernt werden.
- Das lokale Express-Serving läuft auf Loopback. Gzip/Brotli für das Electron-Hauptfenster kann mehr CPU als Latenz sparen; deshalb wurde keine neue Compression-Abhängigkeit nur für eine theoretische Kennzahl eingeführt.

### Relevante Verifikationsbefehle
- Vollständig: `npm run test:release`.
- Qualität/Stress: `npm run test:quality`.
- Serverindex: `node scripts/index-optimizations-smoke.mjs`.
- Dispatcher: `node scripts/feature-dispatcher-smoke.mjs`.
- Renderer: `node scripts/server-management-ui-smoke.mjs` und `node scripts/ui-recovery-layout-smoke.mjs`.
- Public Call: `node scripts/public-call-vote-smoke.mjs`.
- Imports/Packaging-Pfade: `node scripts/case-sensitive-import-audit.cjs` und `node scripts/verify-bot-imports.mjs`.

### Finale Verifikation und Messwerte
- Frischer Abschlusslauf am 2026-08-22: `npm run test:release`, Exit-Code 0. Dabei bestanden Import-, Auth-, Economy-, Security-, Backup-, Rollen-, Community-, Intelligence-, Design-Pipeline- und Quality-Suiten sowie Release-Readiness.
- Import-Audit: 185 produktive Dateien erfolgreich auf ASAR- und Groß-/Kleinschreibungs-Kompatibilität geprüft.
- UI-Feld-Audit: 499 Modulfelder und 271 feste UI-Elemente geprüft.
- Watchdog-Soak: 121 von 121 Interaktionen vor Discord-Ablauf bestätigt; p50 527 ms, p95 1.669 ms, p99 1.775 ms, Maximum 2.181 ms. Simuliert wurden 537.901 ms asynchrone I/O, 4.799 ms synchrone Stalls, 243 Rollen-API-Aufrufe, 2.750 SQLite-Writes und 680 Nachrichtenzeilen.
- Release-Readiness: bestanden. Nicht blockierende Hinweise sind lokales Node `24.16.0` gegenüber empfohlenem `24.17.0` sowie fehlende Windows-Code-Signierung.
- Nicht Bestandteil dieses Laufs waren ein echter Discord-End-to-End-Test mit produktiven Bot-Rechten, ein neu gebauter/signierter Installer und eine visuelle Messung des gepackten Electron-Starts. Diese Grenzen dürfen bei späteren Aussagen nicht verschwiegen werden.

### Ehrliche technische Bewertung nach dem Audit
- Funktionssicherheit: 9/10. Die automatisierte Abdeckung ist breit und der komplette Release-Lauf grün; echte Discord-E2E-Szenarien bleiben extern.
- Laufzeit und Reaktionsfähigkeit: 8,5/10. Der Belastungstest bleibt unter der 3-Sekunden-Frist und Cross-Guild-Blocking ist behoben; p95 liegt unter hoher künstlicher Last dennoch bei rund 1,67 Sekunden.
- Datenpfad und Backend-Effizienz: 8,5/10. SQLite-Indizes, Keyset-Pagination, inkrementelle Statistiken und atomare/gedrosselte Writes sind solide.
- Renderer-Start: 7/10. Externe Fonts und veraltete Cache-Buster sind behoben, aber große monolithische CSS-/JS-Dateien und mehrere große PNGs begrenzen weitere Fortschritte.
- Zuverlässigkeit und Diagnose: 9/10. Watchdog, Ack-Schutz, Timing-Telemetrie, Recovery und Release-Prüfungen sind stark.
- Wartbarkeit: 6,5/10. Sehr große Kerndateien, viele Fallback-Pfade und der umfangreiche gemischte Arbeitsbaum erschweren sichere Änderungen.
- Release-Reife/Sicherheit: 7,5/10. Sicherheits- und Paketprüfungen bestehen; fehlende Windows-Signierung und die leicht veraltete lokale Node-Patchversion bleiben offen.
- Gesamt: 8/10. Die App ist funktional und belastbar, aber noch nicht auf dem Niveau einer vollständig signierten, live-E2E-vermessenen und sauber modularisierten 9- bis 10-Punkte-Produktion.

## Embed-Studio Rollen-Buttons wiederhergestellt (2026-08-22)

### Nutzerziel
- Im Embed Studio sollen Panels wie “Boost-Farben” wieder direkt baubar sein: Embed/Bild plus echte Discord-Buttons unter der Nachricht.
- Beim Kopieren/Übernehmen einer bestehenden Discord-Nachricht dürfen vorhandene Rollen-Buttons nicht zu Fake-Vorschau oder verlorenen Reaktionen werden. Sie müssen als funktionale Studio-Einträge zurückkommen.

### Ursache
- Der vorhandene Klickhandler für Rollen-Buttons existierte bereits in `src/index.js`: Buttons mit `customId` im Format `fh_rr:<roleId>:<index>` werden von `handleReactionRoleButton` verarbeitet und vergeben/entfernen Rollen.
- Der Studio-Speicherpfad `configureMessageReactionRoles` erzeugte aber native Discord-Reaktionen (`message.react(...)`) und entfernte vorhandene `fh_rr`-Komponenten aus der Nachricht.
- Die Serververwaltung serialisierte Nachrichten bisher ohne `components`, deshalb konnte “ins Studio kopieren” bestehende funktionale Button-Panels nicht rekonstruieren.
- UI-Texte nannten den Abschnitt “Reaction Roles”, obwohl der gewünschte/unterstützte Interaktionspfad Rollen-Buttons sind.

### Fix
- `src/index.js`
  - Neue Serialisierung `serializeDashboardComponents(...)`, damit Serververwaltung/Studio echte Discord-Komponenten aus Nachrichten sehen.
  - Forum-Starter und normale Kanalnachrichten liefern jetzt `components` im Dashboard-Payload.
  - `configureMessageReactionRoles(...)` baut aus Studio-Rollen jetzt echte Discord-Button-Reihen über `buildReactionRoleButtonRows(...)`.
  - Jeder Button nutzt `setCustomId(rule.componentId)` mit `fh_rr:<roleId>:<index>` und wird dadurch vom bestehenden `handleReactionRoleButton` verarbeitet.
  - Nicht-`fh_rr`-Komponenten, z. B. Heaven-VIP-Funktionssets, werden beim Speichern erhalten.
  - Native `message.react(...)`-Erzeugung wurde aus diesem Studio-Pfad entfernt.
- `desktop/renderer/server-management.js`
  - “Alle Embeds übernehmen” liest jetzt zuerst vorhandene `fh_rr`-Message-Components.
  - Erkannte Buttons werden als `reactionRoles`-Studioeinträge mit Emoji, Rollen-ID, Gruppe und `exclusive: true` geladen.
  - Funktionale Button-Komponenten haben Vorrang vor der alten Reaktions-Fallback-Erkennung.
- `desktop/renderer/app.js`
  - Studio-Vorschau zeigt Rollen-Einträge als Button-Chips mit Rollenlabel statt Reaction-Zähler.
  - Zähler/Leerstates sprechen von Buttons statt Reaktionen.
- `desktop/renderer/index.html`, `src/features/index.html`, `index.html`
  - Studio-Abschnitt heißt sichtbar “Rollen-Buttons”.
  - Button zum Hinzufügen heißt “Button hinzufügen”.
  - Hinweistext erklärt “Nur eine Rolle” für Button-Gruppen.
- `scripts/reaction-role-buttons-smoke.mjs`
  - Regressionstest sichert ab, dass Studio-Rollen echte `fh_rr`-Buttons erzeugen und kopierte `fh_rr`-Komponenten übernommen werden.

### Verhalten nach dem Fix
- Im Embed Studio im Abschnitt “Rollen-Buttons” pro Farbe Emoji + Zielrolle auswählen, “Nur eine Rolle” aktiv lassen und senden.
- Die Discord-Nachricht erhält echte klickbare Buttons unter dem Embed.
- Klickt ein Mitglied einen Button, läuft der bestehende `reaction-role-button`/`fh_rr`-Handler:
  - Rolle vorhanden -> Rolle wird entfernt.
  - Rolle fehlt -> Rolle wird vergeben.
  - Bei “Nur eine Rolle” verhindert der Handler mehrere Rollen aus derselben Nachricht/Gruppe.
- Für Booster-Farben bleibt das Modul “Booster-Rollen” zuständig, um Farbrollen beim Boost-Ende über `removableColorRoleIds`/Prefix wieder zu entfernen.

### Verifikation
- RED vor Fix: `node scripts/reaction-role-buttons-smoke.mjs` scheiterte mit “Backend must build real role-button rows for studio role entries.”
- GREEN nach Fix: `node scripts/reaction-role-buttons-smoke.mjs` bestanden.
- `node scripts/verify-bot-imports.mjs` bestanden.
- `node scripts/ui-field-audit.mjs` bestanden.

### Wichtige Einordnung
- Der interne Datenname `reactionRoles` bleibt aus Kompatibilitätsgründen erhalten. Nicht umbenennen, ohne gespeicherte Entwürfe/Nachrichten zu migrieren.
- Funktional ist dieser Studio-Pfad jetzt Rollen-Button-basiert, nicht mehr native Discord-Reaktionen.
- Falls später ein echter Reaction-Role-Modus zurückkommen soll, muss er separat modelliert werden, statt den `fh_rr`-Buttonpfad wieder zu vermischen.

### Nachfix: Einzelnes Embed im Studio öffnen übernimmt Buttons (2026-08-22)
- Befund nach Nutzer-Link `discord.com/channels/1276125977805721640/1305858566422401116/1527670518977925161`: Der Button **“Im Studio öffnen”** direkt am einzelnen Embed nutzte einen separaten Codepfad und lud nur `content` + `embed`, aber keine `reactionRoles`.
- Der vorherige Fix griff nur beim Button **“Nachricht + Reaktionsrollen/Rollenbuttons”**.
- Fix in `desktop/renderer/server-management.js`:
  - Neuer gemeinsamer Helper `extractRoleButtonsFromMessage(message)` liest `message.components[*].components[*]`, erkennt `customId` im Format `fh_rr:<roleId>:<index>` und baut daraus Studio-`reactionRoles`.
  - Der Einzel-Embed-Pfad `data-copy-embed` übergibt jetzt `reactionRoles: extractRoleButtonsFromMessage(message)` an `loadStudioTemplate(...)`.
  - Der “alle Embeds”-Pfad verwendet denselben Helper und behält weiterhin den Reaktions-Fallback für alte Nachrichten.
- Regressionstest erweitert: `node scripts/reaction-role-buttons-smoke.mjs` prüft nun ausdrücklich, dass Einzel-Embed-Öffnen funktionale Rollenbuttons behält.

### Nachfix 2: Boost-Farben/alte Button-Panels ohne fh_rr erkennen (2026-08-22)
- Nutzer-Retest: Die Nachricht wurde weiterhin ohne Rollen-Buttons ins Studio geladen. Der erste Nachfix war zu eng, weil er nur neue Studio-Buttons mit `fh_rr:<roleId>:<index>` erkannte.
- Reale Ursache: Bestehende Panels wie “Boost-Farben” können Button-Komponenten enthalten, deren `customId` nicht `fh_rr` ist. In solchen Fällen ist die Zielrolle oft nur über das Button-Label (`boost orange`, `boost rot`, ...) oder eine irgendwo in der Custom-ID eingebettete Rollen-ID rekonstruierbar.
- Fix in `desktop/renderer/server-management.js`:
  - `resolveRoleButtonRoleId(component)` erkennt jetzt drei Varianten:
    1. neues Studio-Format `fh_rr:<roleId>:<index>`;
    2. ältere/Modul-Custom-IDs mit eingebetteter Discord-Rollen-ID;
    3. Button-Label gegen bekannte Serverrollen, normalisiert mit deutscher Kleinschreibung und ohne Sonderzeichen.
  - `findRoleByButtonLabel(label)` matcht zuerst exakt, danach vorsichtig per gegenseitigem Enthalten. Dadurch werden Labels wie `boost orange` auf die Rolle `boost orange` gemappt.
  - `extractRoleButtonsFromMessage(message)` nutzt diesen Resolver zentral, sodass Einzel-Embed und “alle Embeds” denselben robusten Button-Import bekommen.
- Regressionstest erweitert: `node scripts/reaction-role-buttons-smoke.mjs` prüft zusätzlich `resolveRoleButtonRoleId`, eingebettete Rollen-IDs, Label-Fallback und Nutzung von `component.label`.
- Wichtig für Folgeagenten: Nicht wieder nur auf `fh_rr` prüfen. `fh_rr` ist das Format für neu vom Studio gespeicherte Rollen-Buttons; bestehende Discord-Panels können andere Button-IDs haben.

### Nachfix 3: Kanalansicht rendert und importiert Discord-Components wirklich (2026-08-23)
- Nutzer-Retest nach `3.9.276`: Beim Scrollen im Kanal waren unter dem Embed keine Buttons sichtbar; folglich kamen beim Klick auf **“Im Studio öffnen”** auch keine Buttons im Studio an.
- Tatsächliche Ursache:
  - `desktop/renderer/server-management.js` renderte in `renderChannelMessages()` nur Content, Embeds, Attachments, Sticker und Reaktionen. `message.components` wurde komplett ignoriert. Dadurch konnte der Nutzer nicht sehen, ob die API Buttons geliefert hatte.
  - Der indexierte Kanalpfad in `src/index.js` baute Nachrichten aus dem lokalen Serverindex zusammen und gab dort keine `components` zurück. Alte Indexeinträge enthalten außerdem oft keine Components, weil diese früher gar nicht serialisiert wurden.
- Fix:
  - `src/index.js`: `buildIndexedChannelResponse(...)` holt für indexierte Nachrichten mit Embeds/Components die Live-Discord-Message per `channel.messages.fetch({ message: id, force: true })` nach. Daraus werden Attachments, Embeds, Reaktionen und vor allem `components: serializeDashboardComponents(liveMessage)` zurückgegeben. Wenn Live-Fetch scheitert, bleibt der alte Index-Fallback erhalten.
  - `desktop/renderer/server-management.js`: Neuer Renderer `renderMessageComponents(message)` zeigt Discord-Button-Komponenten direkt unter dem Embed in der Kanalansicht.
  - `desktop/renderer/ui-base.css`: Styles für `.message-components`, `.message-component-row` und `.message-component-button` ergänzt, inklusive Discord-Buttonfarben für primary/success/danger/link/secondary.
  - Der vorhandene Studio-Import `extractRoleButtonsFromMessage(message)` kann jetzt echte `message.components` aus der sichtbaren Kanalzeile verwenden.
- Regression:
  - `scripts/reaction-role-buttons-smoke.mjs` prüft jetzt zusätzlich, dass Kanalnachrichten Components rendern, Components direkt nach Embeds platziert werden und indexierte Kanalpages Live-Components aus `serializeDashboardComponents(liveMessage)` anreichern.
- Wichtig für Folgeagenten:
  - Bei Bugs rund um “Buttons fehlen beim Kopieren” zuerst prüfen, ob die Kanalansicht selbst `.message-components` rendert und ob die API-Antwort `messages[*].components` enthält.
  - Nur den Studio-Klickhandler zu ändern reicht nicht, wenn `channelRows` vorher ohne `components` befüllt wurde.

### Nachfix 4: Kanalinhalt wieder schnell laden (2026-08-23)
- Nutzer-Retest nach `3.9.277`: Kanalinhalt lud sehr langsam.
- Ursache: Der Nachfix 3 holte im indexierten Kanalpfad für jede Embed-/Component-Nachricht eine Live-Discord-Message (`channel.messages.fetch({ message, force: true })`). Bei 80 Nachrichten pro Seite konnte das bis zu 80 Discord-REST-Requests erzeugen.
- Fix:
  - `src/index.js`: Der normale indexierte Seitenaufbau nutzt wieder nur den lokalen Serverindex und führt keinen Live-Fetch pro Zeile mehr aus.
  - `src/dashboard.js`/`src/index.js`: Die Kanal-Messages-API akzeptiert jetzt `messageId`. Nur dieser gezielte Pfad lädt exakt eine Nachricht live von Discord und serialisiert dort `components`.
  - `desktop/renderer/server-management.js`: `hydrateMessageComponents(message)` wird erst beim Klick auf **“Im Studio öffnen”** oder **“Nachricht + Reaktionsrollen”** ausgeführt, falls die sichtbare Zeile noch keine Components hat. Danach wird nur diese eine Zeile in `channelRows` ersetzt und neu gerendert.
- Ergebnis:
  - Kanalinhalt ist wieder schnell, weil kein N+1-Fetch mehr pro Seite passiert.
  - Buttons bleiben importierbar, weil der konkrete Studio-Klick die einzelne Zielnachricht live anreichert.
- Regression:
  - `scripts/reaction-role-buttons-smoke.mjs` prüft, dass `hydrateMessageComponents` existiert, die API `messageId` durchreicht und `indexed.rows.map(...)` keinen `channel.messages.fetch({ message: ... })` mehr enthält.

### Level-Up-/Level-Up-Info-Studio speichert Kanalwahl und dynamische Regel-Platzhalter (2026-08-23)
- Nutzerbefund: Das Level-Up-Kanal-Embed speicherte Studio-Settings nicht zuverlässig, besonders die Kanal-/Studio-Auswahl. Außerdem hatte die Level-Up-Kanal-Info keine Platzhalter, die sich automatisch an geänderte Level-Regeln anpassen.
- Ursache:
  - `desktop/renderer/app.js` lud bei `levelUpStudioTemplate(...)` und `levelUpInfoStudioTemplate(...)` die Kanal-ID nur aus dem Embed-Template (`stored.channelId`). Die eigentlichen Level-Kanäle liegen aber in `levels.announceChannelId` bzw. `levels.levelUpInfoChannelId`.
  - `saveLevelUpStudioTemplate()` speicherte nur `embeds.templates`, aber nicht die im Studio gewählte Kanal-ID zurück nach `levels.announceChannelId`.
  - `saveLevelUpInfoDesign()` in `src/features/levels.js` ignorierte `template.channelId` und verwendete nur die bereits vorhandene Config.
  - `level-up-info` hatte harte Regeltexte statt dynamischer Platzhalter; bei geänderten XP-/Cooldown-/No-XP-/Exclude-Regeln blieb das Info-Embed veraltet.
- Fix:
  - Level-Up-Studio lädt Kanal aus `stored.channelId || config.levels.announceChannelId`.
  - Level-Up-Info-Studio lädt Kanal aus `stored.channelId || config.levels.levelUpInfoChannelId || config.levels.announceChannelId`.
  - `saveLevelUpStudioTemplate()` schreibt eine Studio-Kanalwahl nach `levels.announceChannelId`.
  - `saveLevelUpInfoDesign()` akzeptiert `template.channelId` und setzt beim Sync `levels.levelUpInfoChannelId`.
  - `level-up-info` Default-Template nutzt jetzt Platzhalter wie `{rulesChatFieldName}`, `{rulesChatFieldText}`, `{rulesVoiceFieldName}`, `{rulesVoiceFieldText}`, `{rulesBonusFieldName}`, `{rulesBonusFieldText}`.
  - `buildLevelUpInfoPayload()` ersetzt diese Platzhalter aus der bestehenden Level-Regel-Logik (`buildLevelsRulesPayload`/`levelRulesTexts`), sodass geänderte Level-Regeln im Info-Embed automatisch aktualisiert werden.
- Verifikation:
  - `node scripts/leveling-autoresponder-smoke.mjs` erweitert und grün.
  - Neue Assertions prüfen Kanal-Speichern für Level-Up-Studio, Kanal-Laden für Level-Up-Info-Studio und Regel-Platzhalter im Info-Template.

### Nachfix: Level-Up-Info zeigt Platzhalter im Studio und ersetzt sie live (2026-08-23)
- Nutzer-Retest nach `3.9.279`: Im Level-Up-Kanal-Info-Studio waren weiterhin keine Platzhalter sichtbar; außerdem konnten `{rules...}`-Platzhalter im Live-Embed stehen bleiben.
- Tatsächliche Ursache:
  - `desktop/renderer/app.js` hatte im Spezialbanner für `levelUpInfoActive` nur `{guild}` als sichtbaren Platzhalter-Chip. Die neuen Regel-Platzhalter waren zwar im Default-Template, aber für den Nutzer im Studio nicht auffindbar.
  - `formatLevelRulesText(...)` in `src/features/levels.js` ersetzte nur die Basiswerte (`{xpMin}`, `{voiceXp}`, `{noXpRoleNames}` usw.). Die neuen Block-Platzhalter `{rulesChatFieldText}`, `{rulesVoiceFieldText}`, `{rulesBonusFieldText}` usw. wurden dort noch nicht aufgelöst.
  - Der Studio-Button “Standard laden” rief `levelUpInfoStudioTemplate({ embeds: state.config.embeds })` auf und verlor damit die `levels`-Config. Dadurch konnte die gespeicherte Kanalwahl beim Reload/Reset wieder leer wirken.
  - Bereits gespeicherte alte Gold-Standardtemplates mit harten Überschriften wie `**SPRACHCHAT**` wurden nicht migriert, weil die Legacy-Erkennung nur das ältere lila Template kannte.
- Fix:
  - `desktop/renderer/app.js`: Level-Up-Info zeigt jetzt alle relevanten Chips: `{rulesTitle}`, `{rulesDescription}`, `{rulesFooter}`, alle `{rules...FieldName}`/`{rules...FieldText}`-Blöcke sowie `{noXpRoleNames}`, `{excludedChannels}` und `{excludedRoles}`.
  - `desktop/renderer/app.js`: Der Hilfetext nennt explizit `{rulesChatFieldText}`, `{rulesVoiceFieldText}` und `{rulesBonusFieldText}`.
  - `desktop/renderer/app.js`: “Standard laden” nutzt für `levelUp` und `levelUpInfo` wieder `state.config || {}` statt nur `embeds`, damit `levels.announceChannelId`/`levels.levelUpInfoChannelId` erhalten bleiben.
  - `desktop/renderer/app.js`: `saveLevelUpInfoStudioTemplate()` aktualisiert den lokalen `state.config` defensiv, egal ob die API nur den Embed-Block oder eine ganze Config liefert.
  - `src/features/levels.js`: `formatLevelRulesText(...)` ersetzt jetzt auch `{rulesChatFieldText}`, `{rulesVoiceFieldText}`, `{rulesActivityFieldText}`, `{rulesBonusFieldText}`, `{rulesCurveFieldText}`, `{rulesNoXpFieldText}`, `{rulesExcludedFieldText}` und die zugehörigen Namen/Titel/Footer.
  - `src/defaultConfig.js`: Alte goldene Standard-Level-Up-Info-Templates ohne `{rulesVoiceFieldText}` werden auf den neuen Placeholder-Standard migriert, ohne echte Custom-Designs pauschal zu überschreiben.
- Regression:
  - `scripts/leveling-autoresponder-smoke.mjs` prüft jetzt:
    - Level-Up-Info-Spezialbanner enthält die Regel-Platzhalter-Chips.
    - “Standard laden” ruft `levelUpInfoStudioTemplate(state.config || {})` auf.
    - `src/features/levels.js` ersetzt `{rulesChatFieldText}` und `{rulesVoiceFieldText}` im Renderpfad.
    - Alte Gold-Standardtemplates mit `**SPRACHCHAT**` werden auf `{rulesVoiceFieldText}` migriert.

### Nachfix 2: Level-Up-Info-Alttext mit CHAT-XP/VOICE-XP migrieren (2026-08-23)
- Nutzer zeigte nach `3.9.280` noch einen hart gespeicherten Level-Up-Info-Text mit Abschnitten `CHAT-XP`, `VOICE-XP`, `LEVEL PRÜFEN` und `NO-XP`, aber ohne `{rules...}`-Platzhalter.
- Ursache: Die Migration aus `3.9.280` erkannte nur ältere Lila-/Gold-Defaults mit Titel `Leveling – so funktioniert es` oder Marker `**SPRACHCHAT**`. Der echte gespeicherte Standard im Server hatte andere Abschnittsnamen und wurde deshalb als Custom-Text stehen gelassen.
- Fix in `src/defaultConfig.js`:
  - `migrateLegacyLevelTemplate(...)` erkennt `level-up-info` jetzt als alten Standard, wenn keine `{rules...}`-Platzhalter vorhanden sind und die Beschreibung typische alte Standardmarker enthält: `CHAT-XP` + `VOICE-XP`, `LEVEL PRÜFEN` + `NO-XP` oder `**SPRACHCHAT**`.
  - Templates, die bereits `{rules...}` enthalten, werden nicht migriert.
- Regression:
  - `scripts/leveling-autoresponder-smoke.mjs` enthält jetzt exakt eine alte `CHAT-XP`/`VOICE-XP`-Variante und erwartet danach `{rulesChatFieldText}` im migrierten Template.

### Aktivitäts-Liga: Heute/Woche/Monat als einzelne Panel-Nachrichten + Tie-Dropdown repariert (2026-08-23)
- Nutzerbefund: Im Kanal standen Heute, Woche und Monat als drei Embeds in **einer** Discord-Nachricht; unten gab es nur eine gemeinsame Button-Zeile. Gewünscht ist je Zeitraum eine eigene Nachricht, damit unter jedem einzelnen Embed ein eigener **MEIN RANG**-Button hängt. Außerdem funktionierte das Gleichstands-/Tie-System nicht und das Dropdown erschien nicht zuverlässig.
- Ursachen:
  - `syncPanel(...)` speicherte nur `data.panel.messageId` und editierte genau eine Discord-Nachricht mit `buildPanelPayload(...)`, das alle sichtbaren Zeiträume in `embeds[]` packt.
  - Der Button `fh-activity-race:personal` enthielt keinen Zeitraum. Dadurch konnte der Handler nur den Tagesrang zeigen.
  - `handlePanelButton(...)` machte bei öffentlichen Buttons `deferReply({ ephemeral })`, beendete aber danach mit `interaction.update(payload)`. Das ist die falsche Abschlussmethode für eine deferred reply und kann Button-Interaktionen kaputt wirken lassen.
  - `buildTieDropdown(...)` hatte einen echten Crash bei sichtbaren Gleichständen: `const label = ... ${label} ...` referenzierte wegen Shadowing die gerade deklarierte Variable statt den Schleifen-Parameter. Ergebnis: Sobald ein Tie-Dropdown gebaut werden sollte, warf der Code eine `ReferenceError`.
- Fix in `src/features/activityRace.js`:
  - Store ist rückwärtskompatibel erweitert: `panel.messages.daily/weekly/monthly` speichert je Zeitraum `channelId` + `messageId`; altes `panel.messageId` bleibt als Legacy-/Daily-Fallback erhalten.
  - Neuer Builder `buildPeriodPanelPayload(guild, snapshot, period, options)` baut genau **eine** Embed-Nachricht für `daily`, `weekly` oder `monthly`.
  - `syncPanel(...)` iteriert über `daily`, `weekly`, `monthly`, sendet/editiert pro sichtbarem Zeitraum eine eigene Discord-Nachricht und löscht nicht mehr sichtbare Perioden-Nachrichten.
  - Jede Perioden-Nachricht bekommt `REGELN` + `MEIN RANG`; der Rang-Button nutzt jetzt `fh-activity-race:personal:<period>`.
  - `buildPersonalRankPayload(...)` akzeptiert den Zeitraum und zeigt entsprechend täglichen, wöchentlichen oder monatlichen Rang.
  - `buildTieDropdown(...)` kann jetzt auf eine einzelne Periode begrenzt werden und nutzt keinen shadowenden `label`-Variablennamen mehr.
  - `handlePanelButton(...)` erkennt alle aktuellen `panel.messages[*].messageId`, parsed `personal:<period>` und antwortet mit `editReply(...)` nach `deferReply(...)`.
- Regression:
  - `scripts/activity-race-smoke.mjs` prüft:
    - `buildPeriodPanelPayload(...)` erzeugt je Zeitraum genau eine Embed-Nachricht.
    - Jede Perioden-Nachricht hat einen eigenen `MEIN RANG`-Button mit `personal:daily`, `personal:weekly`, `personal:monthly`.
    - `buildPersonalRankPayload(..., 'weekly')` zeigt den Wochenrang statt immer Tagesrang.
    - Ein sichtbarer Gleichstand erzeugt ein `fh-activity-race:tie-details`-Dropdown mit `fh-activity-race:tie:<period>:<metric>:<rank>`-Option.

### Server-Tag-Tracker: binäre Tag-Logik und klare App-UI (2026-08-23)
- Nutzerbefund: Die Server-Tag-Erkennung wirkte unnötig kompliziert. Obwohl Discord-Events frische Profildaten liefern, zeigte die App Begriffe wie **Prüfung offen**, **Bestätigung offen**, **Kandidaten** und **mehrfach geprüft**. Erwartet ist: hat unseren Server-Tag -> Rolle dran; hat ihn nicht -> Rolle weg; nur fehlende Discord-Daten -> nichts ändern.
- Ursache:
  - `src/features/serverTagTracker.js` hatte in der Normalisierung noch historische Bestätigungswerte als Default/Parameterlogik hängen. Erfolgreiche frische Discord-Profile wurden zwar schon autoritativ behandelt, aber Snapshot/UI konnten weiterhin unbestätigte Zwischenzustände anzeigen.
  - `desktop/renderer/app.js` stellte den zweiten Statuszähler als API-Prüfung/Kandidaten dar und zeigte pro Mitglied Bestätigungszähler an. Dadurch sah die eigentlich simple Automatik wie ein mehrstufiger Prüfprozess aus.
- Fix:
  - `assignmentConfirmations` und `removalConfirmations` sind nun standardmäßig `1` und werden auf `1..5` geklemmt. Man kann technische Geduld weiterhin konfigurieren, aber die Standardlogik ist sofort binär.
  - Snapshot-Bestätigung für `wearing` nutzt den gespeicherten `confirmed`-Status direkt und verlangt nicht mehr heimlich `positiveConfirmations >= 2`.
  - Rollenänderungsgründe und Logs sprechen nicht mehr von „mehrfach bestätigt“ oder „x Prüfungen nicht aktiv“.
  - App-UI zeigt im Server-Tag-Tracker jetzt:
    - **TRÄGT UNSEREN TAG**
    - **TRÄGT IHN NICHT**
    - **DISCORD-DATEN FEHLEN**
  - Mitgliederzeilen zeigen nur noch `TRÄGT TAG`, `TRÄGT TAG NICHT` oder `DISCORD-DATEN FEHLEN`; keine offenen Bestätigungszähler mehr.
  - Der Button heißt sichtbar **Jetzt vollständig abgleichen**. Der manuelle Vollabgleich bleibt als Fallback für verpasste Events/Offline-Zeit, nicht als normale Dauerprüfung.
- Regression:
  - `scripts/server-tag-tracker-smoke.mjs` prüft jetzt, dass die Standardentscheidung sofort `add`/`remove` ist, optionale 2er-Bestätigung weiterhin möglich bleibt und die Server-Tag-UI keine alten Begriffe wie `PRÜFUNG OFFEN`, `BESTÄTIGUNG OFFEN`, `mehrfach geprüft` oder `zweite frische Prüfung` mehr enthält.

### Aktivitäts-Liga: Außenbilder pro Zeitraum getrennt statt Daily-Vererbung (2026-08-23)
- Nutzerbefund nach `3.9.283`: Im Embed Studio wurde nur beim **Heute**-Embed ein Außenbild gesetzt, aber Woche/Monat zeigten es automatisch ebenfalls.
- Ursache:
  - `buildPeriodPanelPayload(...)` nutzte für den Message-Content und das Außenbild immer `snapshot.panelDesign` statt `snapshot.panelDesigns[period]`. Dadurch erbten einzelne Perioden-Nachrichten trotz separater Embeds den Daily-/Global-Außenbildwert.
  - `normalizeConfig(...)` setzte `panelDesignWeekly`/`panelDesignMonthly` bei fehlender eigener Config auf das komplette `panelDesign` zurück. Dadurch wurden `content`, `outsideImageUrl` und `outsideImageAttachment` aus Daily in andere Zeiträume kopiert.
  - `savePanelDesign(...)` entfernte bei Woche/Monat bisher Message-Content und Außenbild absichtlich per `stripPanelMessageParts(...)`. Das widerspricht dem neuen Ziel: jedes Zeitraum-Embed ist einzeln bearbeitbar.
  - `ensurePanel(...)` reichte hochgeladene Außenbild-Dateien nur an `daily` durch und speicherte danach Attachments immer zurück nach `panelDesign`.
- Fix:
  - `buildPeriodPanelPayload(...)` liest Außenbild/Content jetzt aus `snapshot.panelDesigns[period]`.
  - Wochen-/Monats-Fallback übernimmt nur den Embed-Aufbau aus Daily, aber **nicht** `content`, `outsideImageUrl` oder `outsideImageAttachment`.
  - Woche/Monat dürfen nun eigene `content`-/Außenbildwerte speichern.
  - `ensurePanel(...)` kennt `outsideImagePeriod` und hängt Uploads an die tatsächlich bearbeitete Perioden-Nachricht.
  - Nach Upload wird das Attachment in den korrekten Config-Key geschrieben: `panelDesign`, `panelDesignWeekly` oder `panelDesignMonthly`.
- Regression:
  - `scripts/activity-race-smoke.mjs` prüft jetzt:
    - Daily-Außenbild erscheint nur im Daily-Payload.
    - Wochen-/Monats-Payloads erben kein Daily-Außenbild.
    - Wochen-Design darf eigenes Außenbild und eigenen Message-Content speichern.
    - Monats-Design ohne eigene Config bleibt ohne Daily-Außenbild.

### App-Architektur: Activity-Race-Studio aus Renderer-Monolith extrahiert (2026-08-23)
- Ziel: Die App-UI soll schrittweise verständlicher werden, ohne einen riskanten Komplettumbau. Der erste Schnitt betrifft Activity-Race, weil dort in den letzten Fixes mehrere Bugs aus vermischter Studio-/Preview-/Designlogik entstanden sind.
- Änderung:
  - Neues Renderer-Modul `desktop/renderer/activity-race-studio.js`.
  - Das Modul exportiert `window.FHCCActivityRaceStudio` mit `studioTemplate`, `previewTemplate`, `resolvePreview`, `studioDescription`, `rawFields`, `completionText` und `previewValue`.
  - `desktop/renderer/app.js` ruft Activity-Race-Studio-Logik nur noch über diesen Adapter auf.
  - `desktop/renderer/index.html` und Root-`index.html` laden `activity-race-studio.js` vor `app.js`.
- Warum wichtig:
  - Activity-Race-Spezialfälle liegen nicht mehr als großer Block im allgemeinen Renderer.
  - Künftige Studio-Sektionen können nach demselben Muster aus `app.js` herausgezogen werden.
  - `scripts/activity-race-smoke.mjs` stellt sicher, dass das eigene Modul existiert, geladen wird und `activityRaceStudioTemplate(...)` nicht wieder direkt in `app.js` landet.

### Renderer-Wachstumsguard (2026-08-23)
- `scripts/ui-field-audit.mjs` prüft jetzt zusätzlich die Zeilenzahl von `desktop/renderer/app.js`.
- Grenze: `app.js` darf nicht über 9.850 Zeilen wachsen. Das ist bewusst ein aktueller Wachstumsdeckel nach der ersten Auslagerung plus funktionalem Komponenten-Import, keine Zielarchitektur. Neue UI- oder Studio-Logik muss stattdessen in eigene Renderer-Module ausgelagert werden.

### Embed Studio: echte Discord-Komponenten aus Kanalinhalt behalten (2026-08-23)
- Root Cause:
  - `src/index.js` serialisierte Live-Nachrichten bereits mit `components`, aber nur Button-Grunddaten. Select-Menüs/Dropdowns verloren Details wie `options`, `placeholder`, `min_values` und `max_values`.
  - `desktop/renderer/server-management.js` hydratisierte beim Klick auf “Im Studio öffnen” zwar die frische Discord-Nachricht, übergab danach aber nur `reactionRoles: extractRoleButtonsFromMessage(message)`.
  - `desktop/renderer/app.js` hatte nur `componentSet` (`none`/`heavenEconomy`) und `reactionRoles`. Dadurch wurden Public-Call-, Aktivitäts-Liga-, Verify-, Dropdown- und andere echte Bot-Komponenten beim Kopieren ins Studio nicht als funktionale Komponenten weitergetragen.
- Fix:
  - `src/index.js`:
    - `serializeDashboardComponent(...)` enthält jetzt neben Buttons auch Select-Menü-Daten (`options`, `placeholder`, `minValues`, `maxValues`).
    - `normalizeStudioTemplateComponents(...)` normalisiert vom Studio kommende Komponenten zurück in Discord-kompatible API-ActionRows mit `custom_id`, `min_values`, `max_values`, Emoji-Daten und maximalen Discord-Limits.
    - `applyStudioTemplateComponents(...)` hängt jetzt entweder das bekannte `heavenEconomy`-Set oder importierte `template.studioComponents` an. Bei `componentSet: none` werden Komponenten also nicht mehr automatisch geleert.
  - `desktop/renderer/server-management.js`:
    - Neuer Helper `normalizeMessageComponentsForStudio(...)`.
    - Einzelnes Embed öffnen und “Nachricht + Reaktionsrollen” übergeben jetzt zusätzlich `studioComponents: normalizeMessageComponentsForStudio(message.components)`.
  - `desktop/renderer/app.js`:
    - `state.studioComponents` hält importierte echte Discord-Komponenten.
    - `currentStudioTemplate()` schreibt `studioComponents` in das Template, damit Send/Edit sie ans Backend weitergibt.
    - `loadStudioTemplate()` lädt `data.studioComponents || data.components`.
    - `renderStudioComponentsPreview()` zeigt importierte funktionale Buttons/Dropdowns in der Discord-Vorschau separat zu Rollen-Buttons/Funktionssets.
- Wichtig für andere Agenten:
  - `reactionRoles` sind weiterhin nur für Rollen-Buttons (`fh_rr`) gedacht.
  - `componentSet` ist weiterhin nur für fertige Bot-Sets wie `heavenEconomy`.
  - Echte kopierte Discord-Komponenten gehören in `studioComponents`, sonst gehen Public-Call-/Liga-/Verify-/Dropdown-Funktionen wieder verloren.
  - Nicht wieder `payload.components = []` setzen, wenn `componentSet === 'none'`; zuerst `template.studioComponents` beachten.
- Absicherung:
  - `scripts/reaction-role-buttons-smoke.mjs` prüft jetzt, dass Kanalinhalt echte Komponenten ins Studio übergibt, der Renderer sie im Template hält und das Backend sie vor Send/Edit normalisiert.

### Embed Studio: Komponenten-Renderer aus app.js ausgelagert (2026-08-23)
- Datei:
  - `desktop/renderer/studio-components.js`
- Grund:
  - Nach dem funktionalen Komponenten-Import lag Normalisierung/Vorschau wieder direkt in `desktop/renderer/app.js`.
  - Das hätte den Renderer-Monolithen weiter wachsen lassen und die neue Button/Dropdown-Logik schwer auffindbar gemacht.
- Fix:
  - `window.FHCCStudioComponents` kapselt jetzt:
    - `normalizeComponent(...)`
    - `normalizeRow(...)`
    - `normalizeRows(...)`
    - `renderPreview(...)`
  - `desktop/renderer/app.js` ruft nur noch:
    - `window.FHCCStudioComponents.normalizeRows(...)`
    - `window.FHCCStudioComponents.renderPreview(...)`
  - `desktop/renderer/index.html` und Root-`index.html` laden `studio-components.js` vor `app.js`.
- Ergebnis:
  - `desktop/renderer/app.js` wurde von ca. 9.801 auf 9.719 Zeilen reduziert.
  - `scripts/reaction-role-buttons-smoke.mjs` prüft jetzt, dass `studio-components.js` existiert, geladen wird und die Normalisierung nicht wieder direkt in `app.js` landet.

### UI-Audit: mobile Lesbarkeit/Überlappung Skin Studio + Embed Studio (2026-08-23)
- Neuer Audit:
  - `scripts/ui-visual-audit.py`
  - Startet bei Bedarf selbst den Renderer-Preview-Server auf `http://127.0.0.1:3137/`.
  - Rendert `login`, `center`, `community`, `modules`, `studio`, `skin`, `system` jeweils in Desktop, Wide und Mobile.
  - Speichert Screenshots unter `reports/ui-visual-audit/`.
  - Prüft harte Layoutfehler:
    - horizontales Seiten-Overflow
    - sichtbare Text-/Control-Überläufe
    - echte Console-Errors, ohne Preview-Favicon/Resource-Noise
- Gefundene Root Causes:
  - Skin Studio:
    - `.skin-studio-app` hatte auf Mobile eine fixe `62px`-Kopfzeile, während Toolbar-Controls umbrechen durften. Dadurch liefen Header-Controls visuell in den Arbeitsbereich.
    - `.skin-3d-paint-card` überdeckte auf Mobile die Pinsel-/Symmetrie-Controls.
    - `#skin-view-reset` enthielt langen Text und brach unsauber um.
    - `Größe`/`Symmetrie` wurden in einem zu schmalen Dock wortweise zerhackt.
  - Embed Studio:
    - `.studio-sendbar` war auf Mobile als breite Button-Zeile zu starr.
    - `.studio-limit-status small` war für schmale Kacheln zu lang und konnte Label-Texte quetschen.
- Fix in `desktop/renderer/ui-base.css`:
  - Mobile Studio:
    - `.studio-sendbar` wird horizontal scrollbar und hält Buttons als stabile Mindestbreiten.
    - `.studio-limit-status` nutzt auf Mobile ein 2-Spalten-Raster mit kleineren, ellipsierten Labels.
  - Mobile Skin Studio:
    - `.skin-studio-app` nutzt `grid-template-rows: auto minmax(0, 1fr) 34px`, damit die Kopfzeile bei Umbruch echten Raum bekommt.
    - `.skin-studio-bar` darf umbrechen und bekommt feste Mindesthöhe.
    - `.skin-3d-paint-card` und `.skin-workspace-hints` werden auf Mobile ausgeblendet.
    - `#skin-view-reset` wird auf Mobile als Icon (`↺`) dargestellt.
    - Brush-Dock-Labels werden auf Mobile zu `PX` und `SYM`, ohne Funktion oder Zugänglichkeit zu entfernen.
- Verifikation:
  - `python scripts/ui-visual-audit.py`
  - `npm run test:visual-ui`
  - `node scripts/ui-recovery-layout-smoke.mjs`
  - `node scripts/server-management-ui-smoke.mjs`
  - `node scripts/ui-field-audit.mjs`
- Packaging:
  - `package.json` schließt `!reports/**` aus, damit generierte Audit-Screenshots nie in der EXE/App landen.
- Zweck: Die App bleibt schrittweise wartbarer; neue Features sollen nicht wieder im zentralen Renderer-Monolith landen.

### Leveling Balance V1: faire No-Limit-Kurve + automatische Rollen-Neuberechnung (2026-08-24)
- Nutzerziel:
  - Jede legitime Nachricht soll XP geben, ohne Cooldown oder Tageslimit.
  - Voice soll ein gleichwertiger, aber nicht uebermaechtiger Pfad sein.
  - Die letzte konfigurierte Level-Rolle ist das sichtbare Max-Level und ein langfristiges Ziel.
  - Bestehende XP duerfen nicht geloescht werden. Alte Level und Discord-Rollen muessen aus denselben XP neu berechnet werden.
- Alte Root Causes:
  - Chat vergab zufaellig `6-16 XP`, Voice `2 XP/Minute`; passive Liga-, Tag- und Booster-Boni speisten denselben XP-Store. Dadurch war die Progression nicht nachvollziehbar und bei hoher Aktivitaet zu schnell.
  - Die alte Kurve war fuer dauerhafte Chat- und Voice-Aktivitaet zu flach.
  - Der alte Voice-Pfad konnte ungueltige Zeit nach einer Zustandsaenderung nachtragen, wenn der Abrechnungsanker nicht fuer jedes Intervall weiterlief.
  - Gespeicherte `profile.level` und Discord-Levelrollen konnten nach einer Kurvenaenderung auseinanderlaufen.
  - Laufende Timer hielten nach Config-Aenderungen eine alte Config im Closure.
- Verbindliche Balance V1:
  - Chat: fester Standard `5 XP` pro legitimer Nachricht.
  - Voice: fester Standard `1 XP` pro gueltiger Minute.
  - Kein Cooldown, kein Tages-/Wochenlimit, keine Zufallswerte, keine Abschwaechung.
  - Chat und Voice duerfen gleichzeitig XP erzeugen.
  - Aktivitaets-Liga, Server-Tag und Booster vergeben keine Level-XP mehr.
  - Lifetime-XP laufen nach dem Max-Level weiter; sichtbares Level und Rollen bleiben am Maximum.
- Kanonische Kurve in `src/features/levels.js`:

```text
XP(L) = 60 * (L * (L + 4) + max(0, L - 20)^2)
```

| Level | Kumulative XP |
| ---: | ---: |
| 1 | 300 |
| 5 | 2.700 |
| 10 | 8.400 |
| 20 | 28.800 |
| 40 | 129.600 |
| 50 | 216.000 |
| 60 | 326.400 |
| 80 | 619.200 |
| 100 | 1.008.000 |
| 110 | 1.238.400 |

- Wichtige Implementierungsregeln:
  - `xpForLevel(level)` ist die einzige Schwellenfunktion.
  - `levelFromXp(xp, maxLevel)` nutzt eine monotone Ganzzahl-Binaersuche und clampet immer am Maximum.
  - `configuredMaxLevel(conf)` nimmt das hoechste `levels.levelRoleMappings`-Level; ohne Mapping bleibt `110` der Kompatibilitaetswert.
  - `/level`, Level-Up, `/levelset`, Member-Rejoin, normale XP-Vergabe, Massen-Rollensync und Migration leiten das Level immer kanonisch aus XP ab.
- Chat-Qualifikation:
  - Bots, Webhooks, Systemnachrichten, ausgeschlossene Kanaele/Kategorien, ausgeschlossene Rollen und NO-XP-Rollen zaehlen nicht.
  - Standardmaessig sind mindestens zwei Buchstaben/Ziffern erforderlich; Anhaenge und Sticker zaehlen auch ohne Text.
  - Es gibt keinen Zeit-Cooldown fuer unterschiedliche Nachrichten.
  - Ein normalisierter, bereits in den letzten zehn Minuten gewerteter Text zaehlt nicht erneut. Satzzeichen, Gross-/Kleinschreibung, Whitespace und User-Mentions umgehen den Schutz nicht.
  - Pro Profil werden die letzten 20 Fingerprints gespeichert, damit alternierender Copy/Paste-Spam erkannt wird.
- Voice-Zustandsmaschine:
  - `lastSettledAt` ist der letzte Abrechnungsanker, `voiceXpRemainder` der gueltige Rest unter einem vollen XP.
  - Vor jedem Voice-State-Event wird zuerst der alte Zustand ueber die serialisierte `voiceQueue` bis zum Eventzeitpunkt abgerechnet.
  - Jeder Tick verschiebt `lastSettledAt`, auch wenn das Intervall ungueltig war. Allein-, AFK-, ausgeschlossene oder taube Zeit kann deshalb spaeter nie nachlaufen.
  - Gueltig sind mindestens zwei wertbare Menschen im selben Kanal. Bots, AFK, ausgeschlossene Kanaele/Rollen, NO-XP sowie `selfDeaf`/`serverDeaf` sind ausgeschlossen; normales Muten bleibt erlaubt.
  - Beim Start wird der Anker auf jetzt gesetzt; Bot-Offline-Zeit wird nie rueckwirkend gutgeschrieben.
  - `runtime.cfg` wird bei jedem Config-Update ersetzt. Voice-, Panel- und Cleaner-Timer lesen die aktuelle Config statt eines alten Closure-Werts.
- Store und Migration:
  - Datei: `data/leveling-progress.json` unter `FALLEN_HEAVEN_DATA_DIR`.
  - Store-Version `3`: `{ version: 3, guilds: {}, balanceMigrations: {} }`; Version 2 bleibt lesbar.
  - Balance-ID: `progressive-v1`.
  - Beim ersten Start bleiben alle bestehenden `xp` exakt erhalten. Nur `profile.level` wird aus XP, Kurve und Rollenmaximum neu berechnet; es darf steigen oder sinken.
  - Legacy-Tages-/Bonusfelder bleiben nur lesbar, beeinflussen aber keine neue Vergabe. `awardXp(...)` lehnt `bonus`, `tag-bonus` und `boost-bonus` explizit mit `amount: 0` ab.
  - Vor dem Discord-Rollenabgleich wird atomar gespeichert; `atomicWriteJson` bewahrt Backups. Die Migration ist idempotent.
  - `balanceMigrations[guildId]` speichert Balance-Version, Max-Level, Zeitpunkte, Profilbericht, Rollen-Config-Signatur und letzten Rollen-Sync.
  - Read-only Vorschau auf den vorhandenen Store beim Umbau: 181 Profile, 6.076 XP unveraendert; 11 gespeicherte Level wurden durch die neue Level-1-Schwelle von 300 XP nach unten korrigiert. Das war nur eine Vorschau, die echte Migration geschieht kontrolliert beim Bot-Start.
- Automatische Discord-Rollenaktualisierung:
  - `ensureBalanceMigration(...)` laeuft in `onClientReady` vor dem Level-Runtime-Start und erneut bei Level-Config-Aenderungen.
  - Ausloeser fuer den Massenabgleich: neue Balance-ID, geaendertes Max-Level, korrigierte Profile, geaenderte Mapping-/Kumulativ-/NO-XP-/Ausschluss-Signatur, fehlender erfolgreicher Sync oder explizites Force-Sync.
  - `grantLevelRolesToAll(...)` laedt alle Mitglieder, entfernt falsche verwaltete Levelrollen und fuegt die aus XP berechnete Rolle hinzu.
  - Nicht kumulativ: nur die hoechste passende Rolle. Kumulativ: alle erreichten Mapping-Rollen.
  - NO-XP-/ausgeschlossene Mitglieder verlieren verwaltete Levelrollen und erhalten keine neue; ihre NO-XP-Rolle selbst bleibt bestehen.
  - Mitglieder ohne Profil, aber mit alter Levelrolle, werden als Level 0 behandelt und bereinigt.
  - Blockierte Rollen und Discord-Fehler setzen `rolesSynchronizedAt` nicht. Der naechste Start/Config-Lauf versucht den Abgleich erneut. Rate-Limits nutzen Retry/Backoff und sanftes Pacing.
  - Die Migration sendet keine Level-Up-Ankuendigungen.
- App-/Embed-Aenderungen:
  - Sichtbare Zufalls-Min/Max-, Cooldown-, Tageslimit-, Kurvenbasis- und passive Bonusfelder wurden aus dem Leveling-Modul entfernt.
  - Aktiv sind nur feste Chat-XP, Mindestinhalt/Ausschluesse, Voice-XP/Mindestteilnehmer, Rollen/Maximum, kumulative Rollen, Ankuendigung und Panel-/Regeltexte.
  - Bekannte alte Standard-Regeltexte werden auf `5 XP`, `1 XP/Minute`, No-Limit und die neue Kurve migriert; echte Custom-Texte bleiben erhalten.
  - Die Standard-Levelkarte zeigt `Lifetime-XP` statt des stillgelegten `Liga-Bonus`. Das exakte alte Standardfeld `Liga-Bonus: {bonusXp} XP` wird chirurgisch migriert, ohne den restlichen Custom-Aufbau zu ersetzen.
  - Am Rollenmaximum zeigt die Levelkarte `Level <max> · MAX`, `MAX-LEVEL`, `0 XP` bis zum naechsten Level und weiterlaufende Lifetime-XP.
- Tests:
  - `scripts/leveling-balance-smoke.mjs`: Kurvenschwellen, Umkehrung/Clamp, Legacy-Config, No-Limit-Chat, Duplikate, Medien, Webhooks, Voice-Rest/kein Catch-up, verlustfreie Migration, passive Quellen aus, NO-XP und Rollen-Neuvergabe.
  - `scripts/leveling-autoresponder-smoke.mjs`: Levelkarten-/Regel-Templates, Standardmigration, UI-Felder, Studio-Platzhalter und bestehende Autoresponder-Regressionen.
  - `npm run test:community`: bestanden am 24.08.2026.
  - `npm run test:release`: bestanden am 24.08.2026; 125/125 Interaktionen im Watchdog-Soak rechtzeitig bestaetigt.

### Aktivitaets-Liga: vergangene Woche/Monat statt laufender Zwischenstaende (2026-08-24)
- Nutzerbefund: Wochen- und Monats-Embed zeigten Daten der aktuellen Woche/des aktuellen Monats. Erwartet sind Daten des unmittelbar vergangenen abgeschlossenen Kalenderzeitraums, sofern Daten vorhanden sind.
- Root Cause:
  - Rollen/Awards nutzten bereits `completedPeriodSnapshot(...)`.
  - Das sichtbare Panel nutzte separat `periodSnapshot(...)` und aggregierte dadurch bewusst den laufenden Zeitraum. Oeffentliches Embed, Dropdown und `MEIN RANG` konnten deshalb eine andere Semantik als die Abschlussrollen haben.
- Fix in `src/features/activityRace.js`:
  - `buildPanelSnapshot(...)` verwendet fuer Woche/Monat `completedPeriodRange(...)` und den neuen historischen Anzeige-Snapshot.
  - Heute bleibt live. Woche ist Montag-Sonntag vor der aktuellen Kalenderwoche; Monat ist der vollstaendige Kalendermonat vor dem aktuellen Monat.
  - Ein Zeitraum ohne Chat- und Voice-Daten ist `visible: false`; eine alte leere Discord-Panelnachricht wird beim Sync entfernt.
  - Historische Teildaten duerfen sichtbar sein und tragen `Teilweise erfasst`. Vollstaendig seit `trackingCompleteFrom` erfasste Daten tragen `Abgeschlossen`.
  - Teildaten bleiben fuer Awards/Rollen gesperrt: `buildAwardSnapshot(...)` nutzt unveraendert `completedPeriodSnapshot(...)`, das Rankings bei `fullyTracked !== true` leert.
  - `attachFullRankings(...)` berechnet fuer sichtbare historische Teildaten trotzdem die Vollrangliste. Dadurch nutzt `MEIN RANG` exakt denselben Zeitraum wie das oeffentliche Embed.
  - Titel/Platzhalter sind `Vergangene Woche` und `Vergangener Monat`; Studio-Vorschau und App-Erklaertext wurden angeglichen.
- Regression in `scripts/activity-race-smoke.mjs`:
  - Woche am 03.08.2026 ist exakt 27.07.-02.08.2026.
  - Monat am 03.08.2026 ist exakt 01.07.-31.07.2026.
  - Vorhandene Teilhistorie bleibt sichtbar, erzeugt aber keine Rollen.
  - Monat ohne historische Daten erzeugt kein Embed.
  - Studio-Platzhalter zeigen korrekten Titel/Status.
  - `MEIN RANG` greift auf dieselbe vergangene Monats-/Wochenaggregation zu.

### Release 3.9.289 (2026-08-24)
- Installer: `C:\Users\5gtag\Documents\Discord Bot\dist\FHCC-Setup-3.9.289-x64.exe`
- Groesse: `594.023.548 Bytes` (`566,5 MiB`)
- SHA-256: `BECBBF7CB640ED1B493F8BFD9DBC5AD06CFDFF38C28668B4890E2E6DE0E507A9`
- Update-Manifest: `dist/latest.yml`; Version, Dateigroesse und SHA-512 wurden vom Build erzeugt und geprueft.
- Paket-Audit: `4764` ASAR-Eintraege, native SQLite-Binary vorhanden (`1.989.632 Bytes`), `0` private Dateien und `0` bekannte Build-Reste paketiert.
- Packaged-Runtime-Smoke: Electron `43.2.0`, Node `24.18.0`, ABI `148`, keine Discord-Verbindung im Test und kein Native-Modul-Fehler.
- Release-Verifikation:
  - `node scripts/leveling-balance-smoke.mjs`: bestanden.
  - `node scripts/leveling-autoresponder-smoke.mjs`: bestanden.
  - `node scripts/activity-race-smoke.mjs`: bestanden.
  - `npm run test:community`: bestanden.
  - `npm run test:release`: vor dem Build und im Build bestanden.
  - `npm run build:win`: bestanden, inklusive Packaged-Runtime- und Artefakt-Audit.
- Nicht blockierende Build-Hinweise:
  - Lokales Entwicklungs-Node war `24.16.0`, waehrend Release-Readiness `24.17.0+` empfiehlt. Die gepackte Runtime enthaelt Node `24.18.0` und bestand den Runtime-Smoke.
  - Windows-Code-Signierung ist nicht konfiguriert; der Installer ist daher technisch geprueft, aber nicht mit einem Herausgeberzertifikat signiert.

### TempVoice Profile, Studio und sichere Kanalverwaltung (Release 3.9.290, 2026-08-24)
- Nutzerziel:
  - Ein selbst umbenannter TempVoice-Kanal soll beim naechsten Erstellen exakt denselben Namen verwenden.
  - Zusaetzlich werden das zuletzt gewaehlte Benutzerlimit und die RTC-Region pro Server und Mitglied gemerkt.
  - Das Interface-Embed soll im bestehenden Embed Studio vollstaendig editierbar sein; die echten TempVoice-Buttons muessen funktional und vom Design getrennt bleiben.
  - App, Discord-Antworten und Persistenz duerfen keine Erfolge behaupten, wenn Discord oder der Datentraeger die Aktion abgelehnt haben.
- Root Causes vor dem Umbau:
  - `data/temp-voice.json` hatte State-Version 3 und speicherte nur aktive `channels`; Rename, Limit und Region veraenderten Discord, aber kein persoenliches Profil.
  - Join-Events hatten keinen Single-Flight-Lock. Zwei parallele Events konnten denselben Zustand lesen und zwei Kanaele erzeugen.
  - Rename/Limit/Region fingen Discord-Fehler ab und liefen danach teilweise trotzdem in den Erfolgspfad; Interaktionen konnten doppelt oder zu spaet beantwortet werden.
  - `Connect:null` wurde als allgemeines Entblocken benutzt. In einem ueber `@everyone` gesperrten Call erlaubt das keinen Zutritt und stellt auch keine vorherigen Rechte wieder her.
  - Claim/Transfer aenderten nur den JSON-Owner. Der neue Owner konnte in privaten/gesperrten Kanaelen ausgesperrt bleiben, waehrend der alte Owner Sonderrechte behielt.
  - Cleanup und manuelles Loeschen entfernten den State auch nach fehlgeschlagenem Discord-Delete; dadurch entstanden unverwaltete Kanaele.
  - Das Interface-Embed war hart codiert. Ein grosser Block-Platzhalter haette wieder Text und Live-Daten untrennbar gekoppelt.
- Persistenzmodell:
  - State-Version 4: `{ version: 4, channels: {}, profiles: {} }`.
  - `profiles[guildId][userId]` enthaelt nur `customName`, `userLimit`, `rtcRegion`, `updatedAt`.
  - `customName` nutzt dieselbe `safeName`-Normalisierung wie Live-Rename und maximal 100 Zeichen.
  - `userLimit` ist ganzzahlig `0..99`; `rtcRegion` ist `automatic` oder ein Eintrag aus `REGIONS`.
  - Niemals im Profil: Lock/Open, Block-/Allowlist, Permission-Baselines, Owner, Claim/Transfer, Threads oder Interface-Nachrichten.
  - Version-3-Dateien migrieren verlustfrei; bestehende Channel-Eintraege bleiben erhalten und `profiles` startet leer.
  - Alle Mutationen laufen serialisiert: State wird geklont, atomar geschrieben und erst nach erfolgreichem Write als In-Memory-State veroeffentlicht. Eingaben und Rueckgaben werden geklont; gefaehrliche Objekt-Keys werden abgewiesen.
- Erstellung und Profile:
  - Prioritaet ist immer `Profilwert -> Modul-Standard`.
  - Der Schalter `tempVoice.rememberUserProfiles` ist standardmaessig aktiv und kann Profile vollstaendig deaktivieren.
  - Ein Single-Flight pro `guildId:userId` umfasst die erneute Owner-Pruefung und Erstellung.
  - Profilwerte werden nur nach erfolgreicher Discord-Aenderung gespeichert. Das Limit-Modal zeigt den aktuellen Live-Wert; Region markiert den aktuellen Eintrag.
  - Profil-Reset ist bestaetigungspflichtig, setzt Name/Limit/Region auf Modulwerte und loescht nur das Profil des aktuellen Owners.
- Zugangs- und Owner-Sicherheit:
  - `permissionTriState(...)` unterscheidet fuer `ViewChannel` und `Connect` exakt `true`, `false` und `null`.
  - Vor der ersten Aenderung wird pro aktivem Kanal und Zielmitglied genau eine Baseline gespeichert. `allow` setzt `ViewChannel:true, Connect:true`; `revoke` und `unblock` restaurieren die exakte Baseline.
  - Auch die urspruengliche `@everyone.Connect`-Baseline wird gespeichert. Oeffnen einer urspruenglich privaten Kategorie macht sie deshalb nicht oeffentlich.
  - Access-Picker sind an die urspruengliche Channel-ID gebunden. Ein Call-Wechsel zwischen Oeffnen und Auswahl kann keinen fremden Voice-Kanal veraendern.
  - Access, Lock, Rename, Limit, Region, Profil-Reset, Claim, Transfer und Delete laufen ueber dieselbe Kanal-Queue und laden den Owner innerhalb der Operation erneut.
  - Transfer autorisiert zuerst den neuen Owner, restauriert danach die Vor-Owner-Baseline des alten Owners und aendert nur den aktiven Channel-State. Beide Nutzerprofile bleiben bytegenau unveraendert.
  - Der alte Thread-Button wurde entfernt: Discord-VoiceChannels besitzen keinen Thread-Manager; eine sichtbare, aber funktionslose Aktion ist nicht akzeptabel.
- Cleanup und Lifecycle:
  - `deleteTrackedChannel(...)` entfernt State nur nach erfolgreichem Discord-Delete oder explizitem Discord-Fehler `10003` (Unknown Channel). Cache-Miss, Netzwerk- oder Rechtefehler sind kein Loeschbeweis.
  - Cleanup, Delete, Claim und Transfer sind pro Kanal serialisiert. Direkt vor Delete wird erneut geprueft, ob der Kanal leer ist.
  - Cleanup laeuft auch, wenn das Modul spaeter deaktiviert wird, und nutzt bei temporaeren Fehlern begrenzten Retry mit Backoff.
  - `onChannelDelete` entfernt State fuer extern geloeschte Kanaele. Interface-Nachrichten oder Timer werden nicht vor einer bestaetigten Kanalloeschnung entfernt.
  - Join und Leave aktualisieren das Interface, damit `{memberCount}` wirklich live bleibt.
- Vollstaendig editierbares Interface-Design:
  - Config-Key: `tempVoice.interfaceDesign`.
  - Frei editierbar: Message-Content, Titel, Beschreibung, URL, Farbe, Autor, Thumbnail, Embed-Bild, beliebige Felder/Reihenfolge, Footer, Timestamp und Aussenbild.
  - Erlaubte atomare Platzhalter: `{owner}`, `{ownerName}`, `{channelName}`, `{createdAt}`, `{userLimit}`, `{region}`, `{accessState}`, `{memberCount}`, `{server}`.
  - Es existiert bewusst kein `{tempVoiceBlock}` oder anderer Paket-Platzhalter. Text und Layout bleiben einzeln editierbar.
  - Rich-Bereiche (Content, Description, Feldwerte) rendern Mention/Discord-Zeit; Plain-Bereiche (Titel, Autor, Feldnamen, Footer) rendern lesbaren Namen und Datum.
  - Das gespeicherte Design verwirft `componentSet`, Studio-Komponenten und Reaction Roles serverseitig. Jeder Discord-Payload baut die echten Komponenten neu aus `interfaceRows(...)`.
  - `allowedMentions` erlaubt nur den aktuellen Owner; editierbarer Text kann kein `@everyone` ausloesen.
  - Speichern aktualisiert alle aktiven Interfaces fehlertolerant und meldet echte `updated`-/`failed`-Zahlen. Gerenderte Embeds werden erneut gegen Discord-Limits geprueft.
- App und API:
  - `GET /api/guild/:guildId/temp-voice` liefert Cache-only-Livedaten zu aktiven Kanaelen plus maximal 100 zuletzt aktualisierte Profile und eine exakte `profileCount`.
  - `DELETE /api/guild/:guildId/temp-voice/profiles/:userId` und `DELETE /api/guild/:guildId/temp-voice/profiles` sind durch `requireAuth` und `requireGuildAccess` geschuetzt.
  - Die App zeigt aktive Kanaele und Profile getrennt, escaped alle API-Werte und bestaetigt Einzel-/Gesamt-Reset mit `showAppConfirm`.
  - TempVoice Studio warnt bei ungespeicherten Aenderungen, blendet fremde Thread-/Komponentenwerkzeuge aus, zeigt nur aktivierte echte Buttons und benennt jeden Save als sofortige Live-Aktualisierung.
  - Refresh nutzt Single-Flight/Generation-Schutz; Mobile-Aktionen wrappen ohne Abschneiden. 100 Profile bleiben scrollbar und nutzen `content-visibility`.
- Aussenbild-Hardening in `src/runtime/localImageStore.js`:
  - Server-Downloads erlauben nur oeffentliche HTTP(S)-Ziele. Private, lokale, Link-Local-, Metadata- und lokale IPv6-Adressen werden vor jedem Request und Redirect blockiert.
  - DNS-Ziele werden validiert und fuer den Socket gepinnt; maximal drei Redirects, zehn Sekunden Timeout, nur Image-Content-Type und maximal 25 MiB laut Header und tatsaechlich gelesenem Stream.
  - `purgeOrphanLocalImages(...)` loescht gueltige gespeicherte Assets nicht mehr allein aufgrund ihres Alters, weil die Funktion ohne Config-Referenzen nicht beweisen kann, dass sie verwaist sind. Entfernt werden nur klare Temp-/Ungueltig-Reste.
- Regressionen:
  - `scripts/temp-voice-smoke.mjs`: State/Profile, Single-Flight, Interaction-Phasen, Tri-State-Rechte, Lock-Baseline, Picker-Bindung, Races, Owner, Delete, Cleanup-Retry, Defer-Fehler und Lifecycle.
  - `scripts/temp-voice-embed-smoke.mjs`: freie Designs, neun Platzhalter, Plain/Rich, echte Buttons, Aussenbilder, Mehrfachrefresh und Studio/API-Vertrag.
  - `scripts/temp-voice-dashboard-smoke.mjs`: Cache-Snapshot, Profilgrenze und authentifizierte Reset-Routen.
  - `scripts/temp-voice-ui-smoke.mjs`: Live-Listen, Escaping, Confirm/DELETE, Studio-Schutz und Mobile-Vertrag.
  - `scripts/local-image-security-smoke.mjs`: SSRF, Redirects, DNS/IP, Content-Type, Header-/Stream-Limit, Timeout und Purge-Sicherheit.
  - `scripts/state-restore-smoke.mjs`: verlustfreie Version-3-zu-4-Migration ohne Recovery-Wrapper-Leak.
  - `npm run test:community`: nach allen Fixes am 24.08.2026 bestanden.

### Inaktivitaets-Erkennung: bestaetigte offene Risiken (Analyse 2026-08-24, noch nicht umgesetzt)
- Wichtig: Dieser Abschnitt dokumentiert Analyseergebnisse, keine bereits ausgelieferte Reparatur.
- Die App behauptet derzeit teilweise, es passiere nichts automatisch; der Code sendet aber beim Start, taeglich und nach Config-Aenderungen echte DMs.
- Fehler oder Nichtverfuegbarkeit von Nachrichtenindex/Voice-Backfill werden wie `keine Aktivitaet` behandelt. Ein produktiver Scan ist damit fail-open statt fail-closed.
- Echte Discord-VoiceStates sind keine direkte Quelle; Carl-bot-Logs koennen verzoegert oder unvollstaendig sein. Umgekehrt koennen veraltete offene Log-Sessions Nutzer dauerhaft faelschlich schuetzen.
- Der taegliche Timer haelt die beim ersten Start geschlossene alte Config. Neue Schwelle und ausgeschlossene Rollen gelten beim Folgetag moeglicherweise nicht.
- DM-Reservierung, manueller Versand, Kick, DM-Delete und Cleanup besitzen mehrere falsche Erfolgs-/Crash-Zustaende; manuelle DMs umgehen den Guild-Single-Flight.
- Vorgeschlagenes, noch zu bestaetigendes Ziel: Vorschau und Versand strikt trennen; Quellenqualitaet sichtbar machen; bei unbekannter/unvollstaendiger Quelle nie senden; Live-Voice persistent erfassen; klare Statusmaschine `pending-send/sent/dm-failed/stayed/leave-requested/kicked`; alle Aktionen pro Guild/User serialisieren; keine Kandidaten in der Vorschau vorauswaehlen.

### Release 3.9.290 (2026-08-24)
- Installer: `C:\Users\5gtag\Documents\Discord Bot\dist\FHCC-Setup-3.9.290-x64.exe`
- Groesse: `594.076.912 Bytes` (`566,6 MiB`).
- SHA-256: `408931FAD2D1C98B88E35D939C832C176E543794ADCDF3C2528F8D439C23A634`
- Update-Manifest: `dist/latest.yml`; Version `3.9.290`, Dateigroesse und SHA-512 wurden erzeugt und durch den Build geprueft.
- Paket-Audit: `4.769` ASAR-Eintraege, native SQLite-Binary vorhanden (`1.989.632 Bytes`), `0` private Dateien und `0` bekannte Build-Reste paketiert.
- Packaged-Runtime-Smoke: Electron `43.2.0`, Node `24.18.0`, ABI `148`, keine Discord-Verbindung im Test und kein Native-Modul-Fehler.
- Release-Verifikation:
  - `npm run test:release`: vor dem Build und innerhalb von `npm run build:win` bestanden.
  - Interaktions-Soak im finalen Build: `127/127` Klicks innerhalb der Discord-Frist bestaetigt.
  - `npm run build:win`: bestanden, inklusive Community-, TempVoice-, Inaktivitaets-, Sicherheits-, Packaged-Runtime- und Artefakt-Audits.
  - TempVoice-spezifisch bestanden: State/Profile, Dashboard/API, Embed Studio, UI, lokaler Bildspeicher und Neustart-Wiederherstellung.
- Nicht blockierende Build-Hinweise:
  - Lokales Entwicklungs-Node war `24.16.0`, waehrend Release-Readiness `24.17.0+` empfiehlt. Die gepackte Runtime enthaelt Node `24.18.0` und bestand den Runtime-Smoke.
  - Windows-Code-Signierung ist nicht konfiguriert; der Installer ist technisch geprueft, aber nicht mit einem Herausgeberzertifikat signiert.
- Abgrenzung: Die oben dokumentierte Inaktivitaets-Erkennung wurde in `3.9.290` nur analysiert. Ihre 27 vorhandenen Regressionstests sind gruen, die neuen fail-closed Datenqualitaets- und Statusmaschinen-Fixes sind noch nicht Bestandteil dieser EXE.

### Inaktivitaets-Erkennung: Sicherheitsumbau (Release 3.9.291, 2026-08-24)
- Ausloeser: Die Analyse fuer `3.9.290` bestaetigte, dass fehlende Quellen als leere Aktivitaet gewertet wurden, Lifecycle-Hooks entgegen der UI automatisch DMs senden konnten und mehrere Discord-Fehler als Erfolg gespeichert wurden.
- Versandmodell:
  - `settings(...).deliveryMode` ist fest `manual-confirmed`.
  - `onClientReady` und `onConfigUpdate` pflegen nur Datenquellen/Bereinigung; sie starten keinen DM-Scan mehr.
  - Der alte Dashboard-Endpunkt `runInactiveReminderScan` ist aus Kompatibilitaetsgruenden vorhanden, arbeitet aber nur noch als `dryRun`-Vorschau.
  - Echter Versand laeuft ausschliesslich ueber `runInactiveReminderSend` mit expliziten `userIds`, nachdem die App Vorschau, Auswahl und Bestaetigung gezeigt hat.
- Datenqualitaet und Kandidaten:
  - Vor jeder Vorschau und jedem bestaetigten Versand wird `guild.members.fetch()` ausgefuehrt. Scheitert der Abruf, lautet der Status `data-incomplete`; Kandidatenliste und Versand bleiben leer.
  - `getIndexActivitySource(...)` unterscheidet einen erreichbaren Index mit null Treffern von einem nicht erreichbaren/fehlerhaften Index. Ein Quellenfehler ist fail-closed und wird mit `sourceQuality` und einem lesbaren Grund an die App geliefert.
  - Der Scan ruft `getMemberActivitySnapshot(..., { includeOpenVoice: false })` auf. Veraltete offene Import-Sessions koennen einen Nutzer deshalb nicht mehr unbegrenzt als aktuell aktiv markieren.
  - Ein echter aktueller Discord-VoiceState (`member.voice.channelId` oder `guild.voiceStates.cache`) schliesst das Mitglied unmittelbar aus.
  - Vor dem Versand wird der komplette Kandidatenstand erneut berechnet. Aktivitaet oder eine bestehende Erinnerung zwischen Vorschau und Klick fuehrt zum Ueberspringen.
- Direkte Voice-Erfassung:
  - `inactiveReminder.onVoiceStateUpdate` schreibt Join, Move und Leave direkt per `setUserLastVoiceAt(...)` in `voice-log-state.sqlite3`.
  - Damit haengt neue Voice-Aktivitaet nicht mehr nur von Carl-bot-Log-Erkennung und Backfill ab. Historische Carl-Daten bleiben als zusaetzliche Quelle erhalten.
- Status- und Race-Sicherheit:
  - Pro `guildId:userId` serialisiert `withMemberOperation(...)` manuellen und ausgewaehlten Versand.
  - Vor dem Discord-Send gilt `pending-send`; erst nach echter Nachricht mit Referenz gilt `sent`.
  - Ein Sendefehler wird `dm-failed` und nach fruehestens 24 Stunden wieder fuer eine bewusste Vorschau freigegeben. Er wird nie mehr faelschlich als `stayed` gespeichert.
  - Ein Leave-Klick prueft zusaetzlich die User-ID des Buttons. `kicked` wird erst nach erfolgreichem `member.kick(...)` geschrieben; fehlende Rechte/Discord-Fehler ergeben `leave-requested`; ein bereits fehlendes Mitglied ergibt `left`.
  - Die erste Interaktionsantwort ist neutral. Die abschliessende Antwort nennt das echte Discord-Ergebnis statt vorab eine Entfernung zu behaupten.
- DM-Loeschung:
  - Referenzen werden nur nach echtem `message.delete()` oder Discord-Code `10003`/`10008` entfernt.
  - Cache-Miss, nicht erreichbarer DM-Kanal, Netzwerk- oder Rechtefehler liefern `ok:false`; der Datenbankeintrag bleibt fuer erneute Bearbeitung erhalten.
  - Gesamtloeschung meldet getrennt `deleted` und `failed`.
- App-UX:
  - Kandidaten starten immer unausgewaehlt; ein versehentlicher Massensend durch die bisherige Vorauswahl ist ausgeschlossen.
  - Quellenfehler erscheinen direkt im Vorschau-Bereich, nicht nur als Toast. Erfolgreiche Vorschauen nennen Datenqualitaet und Inaktivitaetsgrund pro Mitglied.
  - Neue sichtbare Status: `Versand laeuft`, `DM fehlgeschlagen`, `Entfernung offen`, `gekickt`.
  - Modultexte sagen jetzt durchgehend: kein Auto-Versand und kein Auto-Kick; direkte Discord-Voice-Daten plus historische Carl-bot-Ergaenzung.
- Regressionen und Verifikation:
  - `scripts/inactive-reminder-smoke.mjs` wurde von 27 auf 29 Gruppen erweitert: Quellen-Fail-Closed, direkte persistente Voice-Erfassung, keine Lifecycle-Sends, `dm-failed`, Loeschbeweis und fehlgeschlagener Kick.
  - `npm run test:community`: bestanden am 24.08.2026.
  - `node scripts/verify-bot-imports.mjs`, `node scripts/ui-field-audit.mjs` und `node scripts/quality-gate.cjs`: bestanden.
  - `npm run test:visual-ui`: 21 Screenshots, keine harten Layoutfehler.

### Release 3.9.291 (2026-08-24)
- Installer: `C:\Users\5gtag\Documents\Discord Bot\dist\FHCC-Setup-3.9.291-x64.exe`
- Groesse: `594.082.372 Bytes` (`566,6 MiB`).
- SHA-256: `AAC1AC1B2E207BFC9EAB66524857147C4498046D0FB2E8797650967C7A38FE54`
- Update-Manifest: `dist/latest.yml`; Version, Dateigroesse und SHA-512 wurden erzeugt und geprueft.
- Paket-Audit: `4.769` ASAR-Eintraege, native SQLite-Binary vorhanden (`1.989.632 Bytes`), `0` private Dateien und `0` bekannte Build-Reste paketiert.
- Packaged-Runtime-Smoke: Electron `43.2.0`, Node `24.18.0`, ABI `148`, keine Discord-Verbindung im Test und kein Native-Modul-Fehler.
- Release-Verifikation:
  - `npm run test:release`: vor dem Build und innerhalb von `npm run build:win` bestanden.
  - Inaktivitaets-Smoke: `29` Pruefgruppen gruen.
  - Interaktions-Soak: Vorab `127/127`, im finalen Build `107/107` Klicks innerhalb der Discord-Frist bestaetigt.
  - `npm run test:visual-ui`: `21` Screenshots ohne harte Layoutfehler.
  - `npm run build:win`: bestanden, inklusive Packaged-Runtime- und Artefakt-Audit.
- Nicht blockierende Build-Hinweise:
  - Lokales Entwicklungs-Node war `24.16.0`, waehrend Release-Readiness `24.17.0+` empfiehlt. Die gepackte Runtime enthaelt Node `24.18.0` und bestand den Runtime-Smoke.
  - Windows-Code-Signierung ist nicht konfiguriert; der Installer ist technisch geprueft, aber nicht mit einem Herausgeberzertifikat signiert.

### Inaktivitaets-Erkennung: sichere Automatik-Korrektur (Release 3.9.292, 2026-08-24)
- Nutzerkorrektur: Automatischer Versand war ausdruecklich gewuenscht. `3.9.291` hatte die Sicherheitsanalyse zu streng als rein manuellen Versand umgesetzt.
- Zielverhalten:
  - Bei aktiviertem Modul laeuft ein automatischer Scan nach dem Bot-Start und danach alle 24 Stunden.
  - Der automatische Lauf sendet an alle Kandidaten, aber nur wenn jede Datenquelle und jedes Mitgliedskriterium erfolgreich geprueft wurde.
  - Vorschau und ausgewaehlter Sofortversand bleiben zusaetzlich verfuegbar; sie ersetzen die Automatik nicht.
- Implementierung in `src/features/inactiveReminder.js`:
  - `settings(...).deliveryMode` ist `automatic-qualified`.
  - `runAutomaticInactiveReminderScan(...)` fuehrt zuerst `runVoiceLogBackfill(...)` aus. Nur Status `ok` gibt den eigentlichen Scan frei; `skipped`, `no-channel`, `fetch-error` oder Exceptions liefern `data-incomplete`, `blocked:true`, `sent:0`.
  - Danach gelten weiterhin die Fail-Closed-Pruefungen aus `3.9.291`: vollstaendiges `guild.members.fetch()`, erreichbarer Nachrichtenindex und erneute Live-Pruefung von Chat, Voice, Beitrittsalter, Ausschlussrollen sowie bestehender Erinnerung.
  - `onClientReady` registriert den Tageslauf und wartet auf den sicheren Startlauf.
  - `onConfigUpdate` ersetzt die gespeicherte Timer-Konfiguration und startet denselben sicheren Lauf. Der Timer schliesst nicht mehr die alte Config vom ersten Start ein.
  - `latestScanConfigs[guildId]` ist die einzige Timer-Configquelle; `stopInactiveReminderScan(...)` entfernt Timer, Config und Quellenstatus gemeinsam.
  - `voiceHistoryQuality[guildId]` speichert `ready`, Backfill-Status und Pruefzeit. Der Dashboard-Snapshot liefert dies als `automaticState`.
- App-Korrektur:
  - Modultexte erklaeren Start- und Tagesautomatik sowie die Fail-Closed-Bedingungen.
  - Der Live-Badge zeigt `AUTOMATIK AKTIV` oder `AUTOMATIK BLOCKIERT`.
  - Die Kandidaten-Vorschau bleibt versandfrei; der Auswahlbutton ist ein zusaetzlicher manueller Sofortlauf mit identischer erneuter Kriterienpruefung.
- Regression:
  - Der Inaktivitaets-Smoke erwartet `automatic-qualified`, prueft die Verdrahtung der Start-/Config-Hooks und beweist, dass fehlende Voice-Historie den automatischen Versand mit null DMs blockiert.
  - Alle 29 Inaktivitaets-Pruefgruppen und der UI-Feld-Audit sind nach der Korrektur gruen.
  - Ein vorhandener Reminder-Datensatz mit `sent`, `stayed`, `left`, `kicked` oder `dm-deleted` schliesst jede Folge-DM dauerhaft aus. Alte `nextReminderAt`-Werte werden ignoriert. Nur eine nachweislich nicht zugestellte `dm-failed`-DM darf nach 24 Stunden erneut Kandidat werden.
  - Die Standardtexte nach „Ja“ behaupten keine Folge-Erinnerung mehr, sondern bestaetigen, dass das Mitglied nicht erneut angeschrieben wird.
- Vollstaendige Carl-bot-Historie:
  - `getIndexVoiceLogs(...)` liest den erkannten Carl-bot-Log-Kanal aufsteigend ohne Zeilenlimit aus dem Serverindex. Das fruehere Limit `250.000` konnte bei groesseren Historien die neuesten Eintraege abschneiden und wurde entfernt.
  - Der Iterator verarbeitet damit den Kanal vom ersten bis zum neuesten indexierten Log und gibt weiterhin regelmaessig den Event-Loop frei.
  - Ein nicht erreichbarer oder fehlerhafter Serverindex ergibt `index-error`; der automatische Inaktivitaetslauf wird dann fail-closed blockiert und nutzt keinen unvollstaendigen REST-Ausschnitt als Versandbeweis.

### Release 3.9.292 (2026-08-24)
- Installer: `C:\Users\5gtag\Documents\Discord Bot\dist\FHCC-Setup-3.9.292-x64.exe`
- Groesse: `594.086.048 Bytes` (`566,6 MiB`).
- SHA-256: `8BF56D7AFE69F4EF577E0BE0EE7F87A97DFE93596B87DF94B981745F6995C5F6`
- Update-Manifest: `dist/latest.yml`; Version, Dateigroesse und SHA-512 wurden erzeugt und geprueft.
- Paket-Audit: `4.769` ASAR-Eintraege, native SQLite-Binary vorhanden (`1.989.632 Bytes`), `0` private Dateien und `0` bekannte Build-Reste paketiert.
- Packaged-Runtime-Smoke: Electron `43.2.0`, Node `24.18.0`, ABI `148`, keine Discord-Verbindung im Test und kein Native-Modul-Fehler.
- Release-Verifikation:
  - `npm run build:win`: bestanden, inklusive vollstaendigem `test:release`, Packaged-Runtime- und Artefakt-Audit.
  - Inaktivitaets-Smoke: `29` Pruefgruppen gruen, inklusive sicherer Automatik, Chat-/Voice-UND-Regel, vollstaendigem Carl-bot-Backfill-Schutz und dauerhaftem Wiederholschutz.
  - Interaktions-Soak im finalen Build: `125/125` Klicks innerhalb der Discord-Frist bestaetigt.
- Nicht blockierende Build-Hinweise:
  - Lokales Entwicklungs-Node war `24.16.0`, waehrend Release-Readiness `24.17.0+` empfiehlt. Die gepackte Runtime enthaelt Node `24.18.0` und bestand den Runtime-Smoke.
  - Windows-Code-Signierung ist nicht konfiguriert; der Installer ist technisch geprueft, aber nicht mit einem Herausgeberzertifikat signiert.

### Vollstaendiger Effizienz- und Performance-Audit (2026-08-24, Analyse ohne Produktionsaenderung)
- Vollbericht: `docs/performance-audit-2026-08-24.md`.
- Umfang: alle 30 registrierten Bot-Module, Dispatcher, Serverindex/Persistenz und Electron-Renderer.
- Gemessene Basis:
  - 33 Feature-JavaScriptdateien mit 32.024 Zeilen und 1.578.741 Bytes; davon 30 registrierte Features.
  - Der Renderer laedt beim Start rund 1,88 MB CSS/JavaScript plus 71,7 KB HTML. Hauptanteile: `ui-base.css` 757.063 Bytes, `app.js` 561.081 Bytes und `server-management.js` 176.237 Bytes.
  - Importpruefung des Bots: 575 ms. Lokaler Projekt-Datenbestand: 75 Dateien und 13.629.985 Bytes.
  - Dispatcher-Smoke, 13 Serverindex-Optimierungschecks und 5 Discovery-Checks bestanden.
  - Interaktions-Soak unter simulierter REST-/SQLite-/I/O-Last: 116/116 rechtzeitig bestaetigt, maximale Ack-Latenz 1.984 ms.
- Bestaetigte Performancefehler:
  - `activityRace` startet seinen 30-Sekunden-Tick auch deaktiviert und stoppt ihn beim Deaktivieren nicht. Im aktiven Zustand werden alle 30 Sekunden Rollenlogik und bis zu drei Ranglisten-Nachrichten mit `force:true` aktualisiert.
  - `publicCallVote` editiert eine laufende Vote-Nachricht sekundenweise. Eine normale 60-Sekunden-Abstimmung kann etwa 60 Discord-Edits erzeugen.
  - `voiceLogImport` liest und parsed beim Start sowie vor dem automatischen Inaktivitaetsscan die komplette bereits verarbeitete Carl-bot-Historie erneut. Deduplizierung verhindert Doppelbuchungen, nicht aber die Volliteration.
  - Der Renderer laedt grosse, selten gleichzeitig benoetigte Routen und Styles eager statt routeweise.
- Weitere bestaetigte Laufzeitfehler:
  - Der Auto-Delete-Catch in `publicCallVote` greift auf die nicht definierte Variable `messageId` zu; bei einem Discord-Loeschfehler kann der Fehlerpfad selbst scheitern.
  - Der Reminder-Timer von `memberVerify` schliesst die Start-Config ein. `onConfigUpdate` ersetzt oder stoppt ihn nicht, daher koennen neue Reminder-Einstellungen bis zum Neustart wirkungslos bleiben.
  - `customRichPresence` besitzt einen globalen Timer/Client/Signaturzustand fuer alle Guilds; bei mehreren Servern gewinnt der zuletzt geplante Server.
- Architekturbeobachtungen:
  - `memberManagement`, `levels`, `activityRace`, `serverContext` und `voiceLogImport` verarbeiten teilweise dieselben Activity-Events in getrennten Datenpfaden. Ein spaeterer schmaler Activity-Event-Service kann doppelte Normalisierung und Persistenz reduzieren.
  - Auto Responder, Moderation und Instant Wort-Ban bauen Wortlisten, Sets oder Regex pro Nachricht neu. Diese Daten sollten nach Config-Revision vorkompiliert werden.
  - `better-sqlite3` bleibt synchron, ist im Serverindex aber bereits sinnvoll durch WAL, Batching, Transaktionen, Precompute, partielle Indizes und Worker-VACUUM abgesichert. Worker-Auslagerung soll nur fuer gemessene langsame Queries erfolgen.
- Prioritaet fuer den naechsten Umbau: Aktivitaets-Liga, Public Call, Voice-Import/Inaktivitaet, Member-Verify-Timer, danach Renderer-Lazy-Loading und vorkompilierte Regelmodule.
- Abgrenzung: Dieser Abschnitt dokumentiert Analyseergebnisse. Es wurde keine Versionsnummer erhoeht und keine neue EXE gebaut.

### Counting-Durchsatz und garantierte Reaktionen (Release 3.9.293, 2026-08-25)
- Nutzervertrag:
  - Jede akzeptierte richtige Zahl erhaelt genau einen gruenen Haken (`successReaction`, standardmaessig `✅`).
  - Eine falsche Zahl erhaelt niemals den gruenen Erfolgshaken, sondern weiterhin ausschliesslich `failReaction` (standardmaessig `❌`) und den bestehenden Fehler-/Reset-Flow.
  - Die Zahlenreihenfolge und State-Mutation warten nicht auf Discord. Discord-Reaktionen laufen kontrolliert im Hintergrund nach.
- Ursachenanalyse:
  - Discord stellt pro Reaction nur einen einzelnen REST-Endpunkt bereit; es gibt keinen Batch fuer viele Nachrichten. Discord.js gruppiert und serialisiert die Requests anhand der Discord-Bucket-Header.
  - Der bisherige Fire-and-forget-Aufruf startete beliebig viele Reaction-Promises. Parallel konnte `clearCountingChannel(...)` eine Nachricht loeschen, deren Reaction-PUT noch in der REST-Queue wartete. Der Haken konnte danach wegen `Unknown Message` nicht mehr erscheinen.
  - Normales Cleanup lud wiederholt bis zu 100 Kanalnachrichten und mehrere Laeufe konnten ueberlappen.
  - `refreshStatusPanel(...)` verwarf jeden Aufruf innerhalb von zwei Sekunden ohne nachlaufenden Endstand.
  - Vor dem Dispatcher wartete `messageCreate` auf den allgemeinen Channel-Topic-Zaehler. Sein erstmaliger Dateizugriff konnte deshalb auch Counting verzoegern.
- Reaktions-FIFO in `src/features/counting.js`:
  - `reactionQueues` verwaltet genau einen Worker pro `channelId`.
  - `enqueueCountingReaction(...)` dedupliziert ueber die Discord-Message-ID und liefert strikt FIFO aus. Ein begrenztes Fenster von 2.000 abgeschlossenen IDs verhindert unbegrenztes Wachstum.
  - Offene Eintraege werden mit einem fortlaufenden Kopfindex verarbeitet. Dadurch entfallen wiederholte `Array.shift()`-Verschiebungen und die lokale Queue bleibt auch bei grossen Bursts linear.
  - Discord.js behandelt seine Rate-Limits weiterhin ueber die echten Response-Header. Zusaetzlich wiederholt Counting transiente Netzwerkfehler maximal dreimal mit begrenztem Backoff.
  - Terminale Fehler (`Unknown Message`, unbekanntes Emoji, fehlender Zugriff/Berechtigung sowie HTTP 400/401/403/404) werden nicht endlos wiederholt.
  - Der Completion-Promise wird immer aufgeloest. Bei `deleteWrongMessages` beginnt das direkte Loeschen erst danach, damit das rote X sichtbar ausgeliefert werden kann.
- Rolling-Window und Cleanup:
  - `cleanupWindows` hydratisiert einen Counting-Kanal beim ersten Cleanup einmal mit maximal 100 Nachrichten. Danach pflegen `onMessageCreate`, `onMessageDelete` und `onMessageBulkDelete` das lokale Fenster.
  - Erfolgs-, Fehler-, Milestone- und Loss-Nachrichten werden in das Fenster uebernommen; entfernte Loss-Nachrichten werden wieder vergessen.
  - `clearCountingChannel(...)` bestimmt weiterhin die neuesten `keep` Nachrichten ueber das ganze sichtbare Fenster. Eintraege mit offener Reaction bleiben vorlaeufig geschuetzt und werden nach Reaction-Abschluss erneut eingeplant.
  - `cleanupJobs` erlaubt maximal einen Lauf pro Kanal. Mehrere Anforderungen werden zu einem aktuellen Nachlauf zusammengefasst; `keep=0` gewinnt gegen weniger strenge Rolling-Anforderungen und `preserveIds` werden vereinigt.
  - Bulk-Delete verarbeitet weiterhin Batches. Nachrichten ueber 14 Tagen, die Discord aus `bulkDelete(..., true)` herausfiltert, werden einzeln geloescht und nicht faelschlich nur aus dem lokalen Fenster entfernt.
- Panel-Coalescing:
  - `panelRefreshJobs` erlaubt maximal einen Panel-Sync pro Guild.
  - Aufrufe innerhalb von `PANEL_MIN_UPDATE_MS` ersetzen nur den wartenden Zwischenstand. Nach Ablauf wird genau der neueste State einmal editiert.
  - Periodischer Repair darf einen bereits wartenden echten Zaehlerstand nicht mehr durch seinen no-op-Existenzcheck ersetzen.
  - Explizite Force-Aufrufe bleiben awaitbar und werden nach einem laufenden Sync sofort ausgefuehrt.
- Dispatcher und Diagnose:
  - `trackChannelMessageCount(...)` wird im zentralen `messageCreate`-Handler non-blocking gestartet. Der unabhaengige Topic-Zaehler kann Counting nicht mehr vor dem Dispatcher aufhalten.
  - `getCountingRuntimeSnapshot()` liefert Reaction-Werte (`enqueued`, `delivered`, `failed`, `retried`, `deduplicated`, `pending`, `oldestPendingMs`), Cleanup-Werte und Panel-Werte.
  - Der Snapshot ist Bestandteil von `GET /api/guild/:guildId/counting` (`runtime`) und der Live-Diagnose (`liveDiagnostics.counting`).
- Tests:
  - FIFO-Test mit blockierter erster Reaction beweist, dass spaetere Haken nicht ueberholen.
  - Cleanup-Test beweist, dass eine Nachricht bis zum Reaction-Abschluss nicht geloescht wird.
  - Einmal-Hydration-Test beweist, dass ein zweiter Cleanup keinen weiteren 100er-Fetch ausloest.
  - Single-Flight-Test beweist maximal einen gleichzeitigen Cleanup und hoechstens einen zusammengefassten Nachlauf.
  - Panel-Test beweist genau einen nachlaufenden Edit mit dem neuesten Stand `11`.
  - Burst-Test verarbeitet 100 richtige Zahlen lokal unter 500 ms und prueft danach 100/100 gruene Haken exakt in Message-Reihenfolge.
  - `node scripts/counting-smoke.mjs`, Syntaxpruefungen, Importpruefung und `npm run test:community` bestanden am 25.08.2026.
- Physische Grenze:
  - Bei einem Burst oberhalb des von Discord gelieferten Reaction-Buckets koennen Haken sichtbar nachlaufen. Die App darf dieses externe Limit nicht umgehen oder hart codieren. Neu ist, dass die lokale App dabei keine Haken mehr durch Parallelraces verliert und die echte Queue-Lage messbar bleibt.

### Release 3.9.293 (2026-08-25)
- Installer: `C:\Users\5gtag\Documents\Discord Bot\dist\FHCC-Setup-3.9.293-x64.exe`
- Groesse: `594.091.240 Bytes` (`566,6 MiB`).
- SHA-256: `6D5A0D576EA034A12D529998924323CEA66DD3621D5967608BAA3FF01F7BCABB`.
- Update-Manifest: `dist/latest.yml`; Version `3.9.293`, Dateigroesse `594.091.240` und SHA-512 wurden erzeugt, durch den Build geprueft und danach nochmals gegen die vorhandene EXE kontrolliert.
- Paket-Audit: `4.769` ASAR-Eintraege, native SQLite-Binary vorhanden (`1.989.632 Bytes`), `0` private Dateien und `0` bekannte Build-Reste paketiert.
- Packaged-Runtime-Smoke: Electron `43.2.0`, Node `24.18.0`, ABI `148`, keine Discord-Verbindung im Test und kein Native-Modul-Fehler.
- Release-Verifikation:
  - `npm run build:win`: bestanden, inklusive vollstaendigem `test:release`, NSIS-Build, Update-Manifest, Packaged-Runtime- und Artefakt-Audit.
  - `npm run test:community`: vorab und innerhalb des Release-Builds bestanden.
  - Counting-Smoke: FIFO, Retry, Cleanup-Schutz, Einmal-Hydration, Cleanup-Single-Flight, Panel-Nachlauf und 100-Nachrichten-Burst bestanden.
  - Reproduzierbarer Interaktions-Soak nach dem finalen Build: `111/111` Klicks innerhalb der Discord-Frist bestaetigt; maximale Ack-Latenz `1.703,43 ms`.
  - Nach dem Build bestanden `node scripts/counting-smoke.mjs`, `node scripts/verify-bot-imports.mjs`, Manifest-/SHA-256-Abgleich und `git diff --check` fuer die bearbeiteten getrackten Dateien.
- Nicht blockierende Build-Hinweise:
  - Lokales Entwicklungs-Node war `24.16.0`, waehrend Release-Readiness `24.17.0+` empfiehlt. Die gepackte Runtime enthaelt Node `24.18.0` und bestand den Runtime-Smoke.
  - Windows-Code-Signierung ist nicht mit einem eigenen verifizierten Herausgeberzertifikat konfiguriert; der Installer ist technisch geprueft.

### UI-Zustaende, Hellmodus und Boost-Meilenstein-Editor (Release 3.9.294, 2026-08-26)
- Nutzerbefunde:
  - Der Kopf der Modulansicht zeigte z. B. `22 AKTIV` in einer umrandeten Flaeche direkt neben `Alle aktivieren`. Der reine Status sah dadurch wie eine zweite Aktion aus.
  - Aktive Modulbuttons waren trotz gruener Beschriftung kaum als aktiv zu erkennen. Die Flaeche enthielt nur etwa sieben Prozent Gruen und der eigentliche Zustand hing visuell an einem sehr kleinen Punkt.
  - Das automatisch versendete Boost-Meilenstein-Embed war im Modul nicht auffindbar, obwohl Backend, Config, API und Embed-Studio-Pfad bereits existierten.
  - Der erweiterte Gesamtaudit fand ausserdem im Hellmodus weisse Ueberschriften und Kennzahlen auf weissen Karten.
- Ursachen:
  - `renderModules(...)` kannte nur `enabledCount`, stellte aber weder die Gesamtzahl dar noch leitete es einen `allEnabled`-Zustand fuer den Sammelbutton ab.
  - Die Katalogschalter sind echte `button`-Elemente. `ui-system.css` adressierte sie trotzdem mit `.module-toggle:checked`; dieser Checkbox-Pseudostatus kann bei einem Button nie eintreten.
  - `ui-base.css`, `ui-aurora.css` und `ui-system.css` enthalten historische Schichten mit `!important`. Der letzte Layer gab aktiven Schaltern keinen vollstaendigen Endzustand und ueberliess Teile der Darstellung den aelteren Regeln.
  - Der vorhandene Editorzugang lag unter der unklaren Ueberschrift `VIP-DM-Benachrichtigungen gestalten` zusammen mit drei weiteren Vorlagen. Der konkrete Begriff aus dem Discord-Embed tauchte im Aktionslabel nicht auf.
  - Hellmodus-Regeln in der letzten Schicht nutzten unmoegliche Selektoren wie `body[data-theme="light"] body.authenticated`. Ein `body` kann kein weiteres `body` enthalten. Zusaetzlich schlugen alte ID-spezifische `!important`-Regeln spaetere allgemeine Kontrastregeln.
- Modulstatus und Schalter:
  - Der Kopf zeigt jetzt `<aktiv> / <gesamt>` mit einem kleinen Statussignal ohne Kartenrahmen. Er ist damit eindeutig Information und keine Fake-Aktion.
  - `Alle aktivieren` wird bei vollstaendig aktivem Katalog zu `Alle aktiv`, deaktiviert sich und verwendet einen ruhigen gruener Zustand. Bei mindestens einem inaktiven Modul bleibt der normale Befehl erhalten.
  - Jeder Modulbutton erhaelt `aria-pressed`, `data-state` und `is-active`. Der aktive Zustand besitzt gruene Flaeche, helle Kontur, sichtbaren Glow und einen Haken; inaktiv bleibt neutral.
  - Tastaturfokus bleibt mit einem separaten Fokusrahmen sichtbar. Der Status ist daher nicht ausschliesslich ueber Farbe erkennbar.
- Boost-Meilenstein-Embed:
  - Heaven Economy zeigt den Bereich jetzt als `Automatische Nachrichten & Embeds`.
  - Die Aktion heisst exakt `Boost-Meilenstein-Embed bearbeiten` und oeffnet weiterhin den vorhandenen `vipDm`-Spezialmodus des vollstaendigen Embed Studios.
  - Dynamisch bleiben nur die vorhandenen Laufzeitwerte `{targetMention}`, `{levels}`, `{coins}`, `{balance}` und `{server}`. Titel, Beschreibung, Farbe, Autor, Bilder, Footer, Timestamp und Felder bleiben frei editierbar.
  - Es wurde keine zweite Speichertechnik eingebaut: Config-Normalisierung, `/heaven-economy/dm-design`, `saveEconomyDmDesign(...)` und `sendEconomyDm(...)` bleiben die gemeinsame Quelle.
- Appweiter Hellmodus-Fix:
  - Die verschachtelten `body`-Selektoren wurden korrigiert und `.module-toggle:checked` wurde entfernt.
  - Die letzte CSS-Schicht definiert echte helle Obsidian-Tokens fuer Hintergrund, Flaechen, Linien, Text, Schatten und Muted-Text.
  - Eine abschliessende Kontrastautoritaet schuetzt Seitenkoepfe, Dashboard-Kennzahlen, Modul-/Community-/Systemkarten, Formulare und Navigation gegen alte Weiss-auf-Weiss-Regeln.
  - ID-spezifische Seitenkopfregeln fuer Center, Community, Module, Studio, Skin, Diagnose und System werden im Hellmodus explizit ueberstimmt. Discord-Nachrichtenvorschauen und die absichtlich dunkle Skin-Arbeitsflaeche bleiben unberuehrt.
- Regression und visueller Audit:
  - Neuer Test `scripts/ui-status-consistency-smoke.mjs` prueft Statusmarkup, Gesamtzahl, All-Enabled-Verhalten, `aria-pressed`, aktive Endstyles, gueltige Hellmodus-Selektoren, Kontrastautoritaet und den direkten Meilenstein-Editorzugang.
  - Der Test ist Bestandteil von `npm run test:quality`.
  - `scripts/ui-visual-audit.py` rendert jetzt nicht mehr nur sieben Ansichten in Dark, sondern `7 Ansichten x 2 Themes x 3 Viewports = 42 Screenshots`.
  - Die Modulvorschau enthaelt echte aktive/inaktive Beispielkarten und den Status `22 / 24`; der vorherige leere Abmeldezustand konnte den gemeldeten Fehler nicht sichtbar machen.
  - Der Audit prueft weiterhin horizontales Seiten-Overflow, abgeschnittene Texte/Controls und Browser-Konsolenfehler. Die finalen Screenshots liegen unter `reports/ui-visual-audit`.

### Release 3.9.294 (2026-08-26)
- Installer: `C:\Users\5gtag\Documents\Discord Bot\dist\FHCC-Setup-3.9.294-x64.exe`.
- Groesse: `594.080.221 Bytes` (`566,6 MiB`).
- SHA-256: `19F3642E7ED73786A53E4CA9A1ADF67884F6D77C8828C23810D45CFA740A4A52`.
- Update-Manifest: `dist/latest.yml`; Version `3.9.294`, Dateigroesse `594.080.221` und SHA-512 wurden durch den Build erzeugt und anschliessend unabhaengig gegen die vorhandene EXE kontrolliert.
- Paket-Audit: `4.770` ASAR-Eintraege, native SQLite-Binary vorhanden (`1.989.632 Bytes`), `0` private Dateien und `0` bekannte Build-Reste paketiert.
- Packaged-Runtime-Smoke: Electron `43.2.0`, Node `24.18.0`, ABI `148`, keine Discord-Verbindung im Test und kein Native-Modul-Fehler.
- Release-Verifikation:
  - `npm run build:win`: bestanden, inklusive vollstaendigem `test:release`, NSIS-Build, Update-Manifest, Packaged-Runtime- und Artefakt-Audit.
  - Economy-Suite: Heaven-Economy-Admin, Migration, UI, Boost-Zuverlaessigkeit, VIP-Panel sowie editierbare VIP-/Boost-Meilenstein-DMs bestanden.
  - Qualitaets-Suite: neuer UI-Status-Test, UI-Feld-Audit mit `488` Modulfeldern und `272` festen Elementen, Import-Audit mit `195` Dateien sowie bestehende UI-/Sicherheitsregressionen bestanden.
  - Visueller Audit: `42/42` Screenshots ohne horizontales Seiten-Overflow, abgeschnittene Texte/Controls oder Browser-Konsolenfehler; Dark/Light und Desktop/Wide/Mobil geprueft.
  - Interaktions-Soak im finalen Release-Build: `110/110` Klicks innerhalb der Discord-Frist bestaetigt; maximale Ack-Latenz `1.917 ms`.
  - Nach dem Build wurden SHA-256 und `latest.yml` erneut gelesen; `ui-status-consistency-smoke` und `heaven-economy-vip-dm-smoke` bestanden erneut.
- Nicht blockierende Build-Hinweise:
  - Lokales Entwicklungs-Node war `24.16.0`, waehrend Release-Readiness `24.17.0+` empfiehlt. Die gepackte Runtime enthaelt Node `24.18.0` und bestand den Runtime-Smoke.
  - Windows-Code-Signierung ist nicht mit einem eigenen verifizierten Herausgeberzertifikat konfiguriert; der Installer ist technisch geprueft.

### Appweite AN/AUS-Schalter und Modulfilter (Release 3.9.295, 2026-08-26)
- Nutzerbefund:
  - Boolesche Einstellungen innerhalb geoeffneter Module erschienen als dunkle, pillenfoermige Flaeche mit einem weissen Punkt. Der Punkt war beinahe das einzige Zustandsmerkmal; `AN` und `AUS` waren weder ausgeschrieben noch ohne Kontext sicher unterscheidbar.
  - Der vorherige Audit hatte nur aktive/inaktive Modul-Katalogbuttons gerendert, aber keine boolesche Einstellung innerhalb der rechten Modulkonfiguration. Dadurch blieb diese zweite Schalterfamilie unbemerkt.
- Ursachen und Inventar:
  - Dynamische Modulfelder vom Typ `checkbox` werden in `desktop/renderer/app.js` als `.module-field-toggle .module-toggle` erzeugt und besassen einen eigenen 46-x-26-Pillenschalter in `ui-base.css`.
  - Das Skin Studio besass fuer `Symmetrie`, `Pixelraster` und `UV-Layout` nochmals einen separaten 28-x-16-Mini-Schalter. Beide Implementierungen drifteten gestalterisch auseinander.
  - Normale Mehrfachauswahlen fuer Kanaele, Rollen, Forum-Tags, Inaktivitaetskandidaten und Studio-Optionen sind echte Checkboxen und duerfen nicht wie Ein/Aus-Schalter aussehen.
- Umsetzung:
  - Die finale Schicht `desktop/renderer/ui-system.css` definiert nun ein gemeinsames 60-x-30-Zustandsmuster fuer Moduleinstellungen und die drei Skin-Schalter.
  - Der ausgeschaltete Zustand zeigt sichtbar `AUS` und einen eckigen Regler mit `x`; der aktive Zustand zeigt `AN`, einen gruenen Track und einen nach rechts bewegten Regler mit Haken. Der Zustand ist damit nicht nur ueber Farbe erkennbar.
  - Pillenradius und weisser Punkt wurden entfernt. Track und Regler besitzen kompakte technische Radien, getrennte Konturen und kontrollierte Schatten statt eines unklaren Lichtpunkts.
  - Hover, Tastaturfokus, deaktivierter Zustand, reduzierte Saettigung sowie eigene Dark-/Light-Kontraste werden in derselben finalen CSS-Sektion behandelt.
  - Dynamische Moduleinstellungen sowie die statischen Skin-Schalter tragen `role="switch"`. Ihre nativen Checkbox-Zustaende bleiben die funktionale Quelle; es wurde keine parallele JavaScript-Zustandslogik eingefuehrt.
- Zusaetzlicher Fund im visuellen Vergleich:
  - In der hellen Modulansicht wurde der Filter `Alle / Aktiv / Inaktiv` durch alte Dark-Tokens als schwarzer Balken mit praktisch unsichtbaren Labels dargestellt.
  - Eine abschliessende `Light module filter authority` setzt Container, inaktive Labels, Hover und aktiven Tab explizit. Der aktive Tab bleibt violett, alle inaktiven Optionen sind dunkel lesbar.
- Regression:
  - `scripts/ui-status-consistency-smoke.mjs` prueft nun die gemeinsame Schaltersektion, ausgeschriebene `AN`-/`AUS`-Zustaende, Modul- und Skin-Aktivselektoren, Hellmodus-Kontrast sowie die Modulfilter-Autoritaet.
  - `scripts/ui-visual-audit.py` injiziert in die geoeffnete Beispielkonfiguration je einen aktiven und inaktiven echten Einstellungsschalter. So sind beide Zustaende in Dark/Light und allen drei Viewports Bestandteil des Bildaudits.
  - Der erneute Audit bestand fuer `42/42` Screenshots ohne horizontales Seiten-Overflow, abgeschnittene Texte/Controls oder Browser-Konsolenfehler.

### Release 3.9.295 (2026-08-26)
- Installer: `C:\Users\5gtag\Documents\Discord Bot\dist\FHCC-Setup-3.9.295-x64.exe`.
- Groesse: `594.083.367 Bytes` (`566,6 MiB`).
- SHA-256: `2F6B2134334FF5ABA208874291F920836A8F392DA8DF0FE98165D6AC2BF3311F`.
- Update-Manifest: `dist/latest.yml`; Version `3.9.295`, Dateigroesse und SHA-512 wurden durch den Build erzeugt und anschliessend unabhaengig gegen die vorhandene EXE kontrolliert.
- Paket-Audit: `4.770` ASAR-Eintraege, native SQLite-Binary vorhanden (`1.989.632 Bytes`), `0` private Dateien und `0` bekannte Build-Reste paketiert.
- Packaged-Runtime-Smoke: Electron `43.2.0`, Node `24.18.0`, ABI `148`, keine Discord-Verbindung im Test und kein Native-Modul-Fehler.
- Release-Verifikation:
  - `npm run build:win` bestand inklusive vollstaendigem `test:release`, NSIS-Build, Update-Manifest, Packaged-Runtime- und Artefakt-Audit.
  - Qualitaets-Suite: `ui-status-consistency-smoke`, `488` Modulfelder, `272` feste UI-Elemente, `195` case-sensitive Importdateien sowie bestehende UI-, Sicherheits- und Funktionsregressionen bestanden.
  - Visueller Audit: `42/42` Screenshots in Dark/Light und Desktop/Wide/Mobil ohne harte Layout-, Textueberlauf- oder Browser-Konsolenfehler.
  - Interaktions-Soak: `124/124` Klicks innerhalb der Discord-Frist bestaetigt; maximale Ack-Latenz `1.876,11 ms`.
- Nicht blockierende Build-Hinweise:
  - Lokales Entwicklungs-Node war `24.16.0`, waehrend Release-Readiness `24.17.0+` empfiehlt. Die gepackte Runtime enthaelt Node `24.18.0` und bestand den Runtime-Smoke.
  - Windows-Code-Signierung ist nicht mit einem eigenen verifizierten Herausgeberzertifikat konfiguriert; der Installer ist technisch geprueft.

### TempVoice-Doppelpanel-Race und Altbereinigung (Release 3.9.296, 2026-08-27)
- Nutzerbefund:
  - Direkt nach der Erstellung eines TempVoice-Kanals standen im integrierten Textchat zwei nahezu identische Embed-Nachrichten mit zwei vollstaendigen Button-Reihen.
  - Die Panels zeigten dieselbe Erstellzeit, aber leicht unterschiedliche Mitgliederzahlen. Das bestaetigte zwei echte Sends aus unmittelbar aufeinanderfolgenden Laufzeitpfaden und keinen Discord-Anzeigefehler.
- Exakte Ursache:
  - `createTempChannel(...)` speichert zuerst den Kanal-State mit leerer `interfaceMessageId`, verschiebt danach das Mitglied und startet `sendInterface(...)` bewusst im Hintergrund.
  - Das Verschieben loest gleichzeitig `handleVoiceStateChange(...)` fuer den Beitritt in den gerade erzeugten Kanal aus. Der Join-Pfad findet den bereits gespeicherten Kanal, startet `refreshInterface(...)` und faellt wegen der noch leeren Message-ID ebenfalls auf `sendInterface(...)` zurueck.
  - Vor 3.9.296 konnten beide Aufrufe parallel denselben leeren State lesen. Beide sendeten eine Discord-Nachricht; erst danach speicherten sie jeweils ihre Message-ID. Der spaetere Write gewann, das andere Panel blieb als nicht getracktes Duplikat stehen.
- Laufzeitfix:
  - `sendInterface(...)` verwendet nun `runInterfaceOperation(...)`, eine eigene FIFO-Queue pro `guildId:channelId`.
  - Der zweite Upsert beginnt erst nach Abschluss des ersten, liest dann die gespeicherte `interfaceMessageId`, laedt die Nachricht aus Cache oder Discord und editiert sie statt erneut zu senden.
  - Die Interface-Queue ist absichtlich von `runChannelOperation(...)` getrennt. Mehrere Owner-Aktionen laufen bereits in der allgemeinen Kanal-Queue und rufen darin `refreshInterface(...)` auf; dieselbe Queue fuer den Interface-Fallback wuerde sich rekursiv selbst blockieren.
  - Der bestehende Deadlock-Test `Interface-Fallback erzeugt keinen rekursiven Queue-Deadlock` bleibt deshalb gruen.
- Bereits vorhandene Doppelpanels:
  - Alte Kanal-Eintraege ohne `interfaceReconciledAt` laden beim ersten erfolgreichen Refresh bis zu 50 aktuelle Nachrichten des eigenen TempVoice-Textchats.
  - Ein Duplikat gilt nur dann als loeschbar, wenn die Nachricht vom eigenen Bot stammt, nicht die gespeicherte kanonische `interfaceMessageId` besitzt und mindestens eine echte Komponente mit dem Prefix `fh_tv:` enthaelt.
  - Normale Nachrichten, fremde Autoren, andere Bot-Embeds und die kanonische Panelnachricht werden nicht geloescht.
  - Nur nach erfolgreicher Pruefung und erfolgreichen Loeschungen wird `interfaceReconciledAt` gespeichert. Bei Discord-/Rechtefehlern bleibt der Marker leer, damit ein spaeterer Refresh erneut sicher versuchen kann.
  - Neu erzeugte Kanaele erhalten den Marker direkt nach dem serialisierten ersten Send, weil der Race dort bereits strukturell ausgeschlossen ist.
- Regression und Verifikation:
  - `scripts/temp-voice-smoke.mjs` startet Kanal-Erstellung und das dadurch ausgeloeste Voice-Join-Refresh absichtlich parallel. Vor dem Fix schlug der Test mit `2 !== 1` fehl; nach dem Fix wird exakt ein Panel gesendet.
  - `scripts/temp-voice-embed-smoke.mjs` stellt eine kanonische, eine verwaiste TempVoice- und eine normale Bot-Nachricht bereit. Exakt das verwaiste Panel wird geloescht.
  - TempVoice-Core, TempVoice-Embed-Studio, Syntax, Diff-Check und die vollstaendige `npm run test:community`-Suite bestanden am 27.08.2026.

### Release 3.9.296 (2026-08-27)
- Installer: `C:\Users\5gtag\Documents\Discord Bot\dist\FHCC-Setup-3.9.296-x64.exe`.
- Groesse: `594.084.043 Bytes` (`566,6 MiB`).
- SHA-256: `D2F4D75A399964C04C04D03430E4DEB967F9F9EBBDDB698218AD79DD0C80F47B`.
- Update-Manifest: `dist/latest.yml`; Version `3.9.296`, Dateigroesse und SHA-512 wurden durch den Build erzeugt und anschliessend unabhaengig gegen die vorhandene EXE kontrolliert.
- Paket-Audit: `4.770` ASAR-Eintraege, native SQLite-Binary vorhanden (`1.989.632 Bytes`), `0` private Dateien und `0` bekannte Build-Reste paketiert.
- Packaged-Runtime-Smoke: Electron `43.2.0`, Node `24.18.0`, ABI `148`, keine Discord-Verbindung im Test und kein Native-Modul-Fehler.
- Release-Verifikation:
  - `npm run build:win` bestand inklusive vollstaendigem `test:release`, NSIS-Build, Update-Manifest, Packaged-Runtime- und Artefakt-Audit.
  - TempVoice-Race, bestehende Doppelpanel-Bereinigung, Deadlock-Schutz, Embed-Studio und vollstaendige Community-Suite bestanden.
  - Interaktions-Soak: `126/126` Klicks innerhalb der Discord-Frist bestaetigt; maximale Ack-Latenz `1.883,77 ms`.
- Nicht blockierende Build-Hinweise:
  - Lokales Entwicklungs-Node war `24.16.0`, waehrend Release-Readiness `24.17.0+` empfiehlt. Die gepackte Runtime enthaelt Node `24.18.0` und bestand den Runtime-Smoke.
  - Windows-Code-Signierung ist nicht mit einem eigenen verifizierten Herausgeberzertifikat konfiguriert; der Installer ist technisch geprueft.
## Heaven Economy: sichere Coin-Geschenke (Release 3.9.297, 2026-08-27)

### Fachlicher Vertrag
- Mitglieder koennen ohne Gebuehr, Annahme oder Tageslimit Coins an andere aktuelle Servermitglieder verschenken.
- Konfiguration: `heavenEconomy.coinGiftsEnabled`, `coinGiftMinAmount`, `coinGiftMaxAmount` und `coinGiftButtonLabel`.
- Gesperrt sind Selbstgeschenke, Bots, ausgetretene Mitglieder, Dezimal-/Negativbetraege, unzureichendes Guthaben und Empfaengerstaende ueber dem globalen Kontolimit von 10.000.000 Coins.
- Der Ablauf ist immer: Button `fh_coin:coin-gift` -> User-Select `fh_coin:coin-gift-user` -> Modal `fh_coin:coin-gift-modal:<recipientId>` -> ephemere Vorschau -> `fh_coin:coin-gift-confirm:<token>` oder Abbruch.
- Der Bestaetigungsbutton enthaelt nur einen zufaelligen 24-stelligen Hex-Token. Betrag, Empfaenger und Nachricht werden nicht aus dem Custom-ID vertraut.

### Persistenz und Atomaritaet
- `src/features/heavenEconomy.js` verwendet Economy-Schema Version 3.
- Guild-State besitzt `pendingCoinGifts[token]` mit `senderId`, `recipientId`, `amount`, `message`, `senderRevision`, `createdAt` und `expiresAt` (10 Minuten).
- `createCoinGiftIntent(...)` validiert Mitglieder und Grenzen, prueft den aktuellen Kontostand und ersetzt einen vorherigen offenen Auftrag desselben Absenders.
- `completeCoinGiftTransfer(...)` prueft Mitgliedschaft, Grenzen und beide Kontostaende erneut und bucht in genau einer `mutate(...)`-Operation:
  - Absender: `balance -= amount`, `spent += amount`, `giftedCoins += amount`.
  - Empfaenger: `balance += amount`, `earned += amount`, `receivedGiftCoins += amount`.
  - Beide Kontorevisionen und Zeitstempel werden gemeinsam erhoeht.
  - Genau eine Transaktion vom Typ `coin-gift` speichert Absender/Empfaenger und beide Vorher-/Nachherstaende.
  - Die Discord-Interaction-ID landet in `processedInteractions`; Wiederholung oder Doppelklick kann nicht erneut buchen.
  - Der verbrauchte Auftrag wird in derselben Mutation entfernt.
- Die persoenliche Nachricht existiert nur im kurzlebigen Auftrag und im direkten Ergebnis fuer die DMs. Sie wird weder im dauerhaften Transaktionsaudit noch im Economy-Log gespeichert.

### Discord-DMs und Embed Studio
- Neue voll editierbare Sektionen: `coinGiftReceived` und `coinGiftSent`.
- Beide werden pro Transaktion mit `forceNew: true` gesendet, damit keine alte Quittung ueberschrieben wird. Geschlossene DMs oder Logfehler rollen eine gueltige Coin-Buchung nicht zurueck.
- Platzhalter: `{server}`, `{target}`, `{targetMention}`, `{giver}`, `{giverMention}`, `{coins}`, `{balance}`, `{giverBalance}`, `{targetBalance}`, `{message}`, `{messageBlock}` und `{transactionId}`.
- `{messageBlock}` erzeugt nur bei vorhandener Nachricht einen fertigen Absatz; damit entstehen bei leerer Nachricht keine ungewollten Leerzeilen.
- Economy-DM-Designs unterstuetzen jetzt auch bis zu 25 frei editierbare Felder. Platzhalter werden in Feldname und Feldwert gerendert.
- Behobener Altfehler: `sendEconomyDm(...)` schrieb DM-Referenzen vorher per unkoordinierter Load/Save-Folge. Zwei parallele DMs konnten dadurch eine Referenz verlieren. Lesen wartet jetzt auf `mutationQueue`; jede Referenz wird ueber `rememberEconomyDmReference(...)` serialisiert gespeichert.

### App und Audit
- Das Heaven-Economy-Modul zeigt Aktivierung, Mindest-/Hoechstbetrag und Buttonlabel in der normalen Modulkonfiguration.
- Unter `Automatische Nachrichten & Embeds` stehen eigene Studio-Einstiege fuer empfangene und gesendete Coin-Geschenke.
- `Mein Konto` und die App-Kontodetails zeigen `Verschenkt` und `Geschenkt erhalten`.
- Die Auditliste zeigt Coin-Geschenke als `Absender -> Empfaenger`, Transaktions-ID und den Hinweis auf die atomare Doppelbuchung. Persoenlicher Nachrichtentext wird dort bewusst nicht angezeigt.
- Das Embed-Studio-Funktionsset `heavenEconomy` verwendet weiterhin `buildHeavenEconomyComponents(...)`; kopierte Economy-Embeds erhalten daher den echten Coin-Geschenk-Button und keine optische Attrappe.

### Regression und Diagnose
- Kern-/Interaktionstest: `node scripts/heaven-economy-coin-gift-smoke.mjs`.
- DM-/Parallelitaetstest: `node scripts/heaven-economy-vip-dm-smoke.mjs`.
- Gesamte Economy-Suite: `npm run test:economy`.
- `scripts/heaven-economy-coin-gift-smoke.mjs` prueft Summenerhaltung, Kontostatistiken, Selbst-/Bot-Schutz, Mindestbetrag, Tokenformat, Wiederholungsschutz, Audit-Privatsphaere, State-Aufraeumen sowie User-Select und Modal.
- `scripts/heaven-economy-vip-dm-smoke.mjs` prueft sechs Sektionen, Feldpersistenz, alle Transferplatzhalter, neue Quittung pro Geschenk und parallele DM-Referenzschreibvorgaenge.

### Release-Freigabe 3.9.297
- `npm run build:win` bestand am 27.08.2026 vollstaendig: Import-, Auth-, Economy-, Security-, Backup-, Rollen-, Community-, Intelligence-, Design-Pipeline-, Quality-, Release-Readiness-, Packaged-Runtime- und Artefaktpruefung.
- Installer: `C:\Users\5gtag\Documents\Discord Bot\dist\FHCC-Setup-3.9.297-x64.exe`.
- Groesse: `594088506` Bytes (`566.6 MiB`).
- SHA-256: `E1EE886783FE4BEBB044D922C72CA4A613BFBB9E74C45C368317B83E5E195E99`.
- `dist/latest.yml` wurde neu erzeugt und seine SHA-512-Angabe gegen die EXE geprueft.
- Artefakt-Audit: `asarEntries: 4771`, `privateFilesPackaged: 0`, `leftoverFilesPackaged: 0`, native SQLite-Datei vorhanden.
- Nicht blockierende Build-Hinweise: Lokales CLI-Node `24.16.0` liegt unter der empfohlenen `24.17.0`; die gepackte Electron-Runtime nutzt Node `24.18.0`. Eine Windows-Code-Signatur ist weiterhin nicht konfiguriert.

## Editierbares Heaven-Economy-Hauptpanel (Release 3.9.298, 2026-08-27)

### Ziel und sichtbares Verhalten
- Das bisher manuell erstellte VIP-Vorteile-Embed wird durch genau ein botverwaltetes Heaven-Economy-Hauptpanel ersetzt.
- Das Hauptpanel selbst zeigt die VIP-Vorteile. Deshalb wurde der separate Discord-Button `VIP-Vorteile` samt Interaktionspfad `fh_coin:perks` vollständig entfernt; es gibt keinen Ersatzbutton.
- Unter dem Embed stehen bei aktivierten Coin-Geschenken genau sieben echte Funktionen in zwei Reihen: `Mein Konto`, `VIP-Shop`, `VIP verschenken`, `Coins verschenken`, `Coins kaufen`, `Boost-Fortschritt` und `Coin-Verwaltung`.
- Ist `coinGiftsEnabled` aus, verschwindet nur `Coins verschenken`; die sechs übrigen Funktionen bleiben erhalten.
- Das ältere VIP-Mitglieder-/Stufenpanel (`vipPanelTemplate`) bleibt ein getrenntes System. `panelTemplate` ist ausschließlich das öffentliche Vorteile-/Economy-Hauptpanel.

### Konfiguration und Migration
- Die einzige Inhaltsquelle ist `heavenEconomy.panelTemplate` in der Guild-Config. Sie enthält `content` und 1 bis 10 Elemente in `embeds`.
- Frei editierbar sind Titel, URL, Beschreibung, Farbe, Autor und Autorbild, Thumbnail, Bild, Footer und Footerbild, Timestamp sowie bis zu 25 Felder.
- Wirklich dynamisch bleiben nur `{server}`, `{coinEmoji}` und `{boostMilestoneReward}`. Diese Platzhalter werden in Content, Titel, Beschreibung, Autor, Footer sowie Feldnamen und Feldwerten aufgelöst.
- `normalizeEconomyPanelTemplate(...)` begrenzt alle Discord-Längen und migriert fehlende bzw. ältere Werte auf einen vollständigen VIP-Vorteile-Standard, ohne andere Economy-Einstellungen zu verlieren.
- Die historische Config-Eigenschaft `perksButtonLabel` wird nur aus Kompatibilitätsgründen noch normalisiert. Sie ist nicht mehr in der App sichtbar und wird beim Komponentenbau nicht gelesen.
- Zusätzlich wird `coinGiftMaxAmount` beim Normalisieren mindestens auf `coinGiftMinAmount` geklemmt, sodass widersprüchliche Gift-Grenzen nicht in die Laufzeit gelangen.

### Kanonisches Panel und Parallelität
- `buildHeavenEconomyPanelPayload(guild, cfg)` rendert ausschließlich die normalisierte Vorlage und hängt immer `buildHeavenEconomyComponents(cfg)` an. Studio-Komponenten werden bewusst ignoriert; dadurch können gespeicherte JSON-Daten keine Fake- oder veralteten Buttons einschleusen.
- `refreshHeavenEconomyPanel({ guild, cfg })` serialisiert alle Refreshes pro Guild über `economyPanelRefreshJobs`. Gleichzeitiger Start-, Config- und Studio-Refresh erzeugen deshalb höchstens einen Send.
- Die kanonische Discord-Message-ID liegt weiterhin in `data/heaven-economy-panels.json`. Existiert die Nachricht, wird sie editiert. Ist sie gelöscht oder nicht mehr abrufbar, wird genau eine Ersatznachricht gesendet und ihre ID atomar gespeichert.
- `messageDelete` nutzt denselben Reparaturpfad. Es existiert keine zweite Sendelogik für dieses Panel.
- `saveHeavenEconomyPanelDesign(...)` liefert `liveUpdated`, `messageId` und `refreshError`. Ein Discord-Fehler verwirft die bearbeitete Vorlage nicht; die App meldet getrennt, dass gespeichert wurde, aber der Live-Abgleich noch aussteht.

### API und Embed Studio
- API: `PUT /api/guild/:guildId/heaven-economy/panel-design`, geschützt durch Authentifizierung und Guild-Zugriffsprüfung.
- Der Service in `src/index.js` verwendet den gemeinsamen `persistEmbedDesign(...)`-Pfad und persistiert `panelChannelId` plus `panelTemplate` in einem Config-Patch.
- Im Heaven-Economy-Modul steht oberhalb des getrennten VIP-Mitgliederpanels der eindeutige Einstieg `VIP-Vorteile-Panel bearbeiten` mit Live-/Kanalstatus.
- Die Renderer-Logik liegt bewusst in `desktop/renderer/economy-panel-studio.js`; `desktop/renderer/app.js` bleibt unter dem Qualitätslimit von 9.800 Zeilen.
- Studio-Spezialmodus ist `economyPanel`. Er lädt 1 bis 10 Embeds, zeigt die drei dynamischen Platzhalter und die aktuelle Buttonauswahl als Vorschau.
- Funktionsset- und Reaction-Role-Editor sind in diesem Modus verborgen. Die Vorschau nutzt `componentSet: 'heavenEconomy'`, während Discord beim Speichern immer die echten zentralen Buttons erhält.
- `Speichern`, der primäre Senden-Knopf und der sekundäre Senden-Knopf führen alle denselben Panel-Save aus. `VIP-Vorteile-Standard laden` setzt nur den editierbaren Inhalt zurück und behält den ausgewählten Kanal.

### Regression und Diagnose
- `scripts/heaven-economy-admin-smoke.mjs` prüft sieben bzw. sechs Buttons, Reihenfolge, Defaults, fehlenden `fh_coin:perks`-Pfad und konsistente Coin-Gift-Grenzen.
- `scripts/heaven-economy-panel-studio-smoke.mjs` prüft Platzhalter, freie Felder, echte Komponenten, parallele Refreshes, gelöschte Panels, kanonische Message-ID, Live-Edit und den Save-Vertrag.
- `scripts/heaven-economy-ui-smoke.mjs` prüft API, externes Studio-Modul, Einstieg, Spezialmodus und festen Economy-Komponentensatz.
- Der neue Panel-Test ist Bestandteil von `npm run test:economy`.
- Schnelle Einzelprüfung: `node scripts/heaven-economy-panel-studio-smoke.mjs`.
- Vollständige Economy-Regression: `npm run test:economy`.

### Release-Freigabe 3.9.298
- `npm run build:win` bestand am 27.08.2026 vollständig: Release-Suite, NSIS-Build, Update-Manifest, gepackte Electron-Runtime und Artefakt-Audit.
- Installer: `C:\Users\5gtag\Documents\Discord Bot\dist\FHCC-Setup-3.9.298-x64.exe`.
- Größe: `594105026` Bytes (`566,6 MiB`).
- SHA-256: `DF13C583FFC3BFC1E12A867168A2D9D897878870F9F4A259E16FD599DADD4397`.
- `dist/latest.yml`: Version `3.9.298`, Datei `FHCC-Setup-3.9.298-x64.exe`, Größe `594105026` Bytes; SHA-512 wurde beim Erzeugen gegen die EXE geprüft.
- Artefakt-Audit: `4773` ASAR-Einträge, native SQLite-Datei `1989632` Bytes, `0` private Dateien und `0` Build-Reste paketiert.
- Packaged-Runtime-Smoke: Electron `43.2.0`, Node `24.18.0`, ABI `148`, keine Discord-Verbindung im Test und kein Native-Modul-Fehler.
- Interaktions-Soak: `135/135` Interaktionen rechtzeitig bestätigt; maximale Ack-Latenz `1862,08 ms`.
- Unabhängiger Nachcheck: Paketversion, Manifestversion, EXE-Größe und Renderer-Cache-Buster stimmen überein; `npm run test:economy`, `ui-field-audit` und `quality-gate` wurden nach dem Build erneut grün ausgeführt.
- Nicht blockierende Hinweise: Lokales CLI-Node `24.16.0` liegt unter der empfohlenen `24.17.0`, die gepackte Runtime verwendet `24.18.0`. Eine eigene Windows-Herausgeber-Signatur ist weiterhin nicht konfiguriert.

## Economy-Panel mit bis zu 10 Embeds (Release 3.9.299, 2026-08-27)
- Korrektur der Begrifflichkeit aus 3.9.298: `genau ein Panel` bedeutet genau **eine kanonische Discord-Nachricht**, nicht genau eine Embed-Karte.
- Diese eine Nachricht darf jetzt Discords Maximum von 10 Embeds enthalten. Die Economy-Buttons erscheinen weiterhin nur einmal unter der gesamten Nachricht.
- `normalizeConfig(...)` und `normalizeEconomyPanelTemplate(...)` bewahren die ersten 10 vollständigen Embed-Definitionen. Ein elftes Element wird defensiv abgeschnitten.
- `buildHeavenEconomyPanelPayload(...)` baut für jedes gespeicherte Element einen eigenen `EmbedBuilder`. `{server}`, `{coinEmoji}` und `{boostMilestoneReward}` werden in jedem Embed einschließlich seiner Felder aufgelöst.
- Das Embed Studio lädt, rendert und speichert `embeds.slice(0, 10)`. `Embed hinzufügen`, Embed-Tabs und `Embed entfernen` sind im Spezialmodus `economyPanel` ausdrücklich freigegeben.
- Behobener UI-Blocker: `renderStudioEmbedTabs(...)` behandelte zuvor jede Modulvorlage als festes Einzel-Embed und deaktivierte deshalb Hinzufügen/Entfernen. Nur das Economy-Panel ist nun von dieser Sperre ausgenommen; andere automatisch strukturierte Module bleiben geschützt.
- Der Standard bleibt ein einzelnes VIP-Vorteile-Embed. Weitere Embeds werden nur angelegt, wenn sie im Studio ausdrücklich hinzugefügt werden; bestehende Serverkonfigurationen werden nicht künstlich vervielfacht.
- Regression: Der Panel-Smoke übergibt 12 Embeds, erwartet exakt 10, prüft Platzhalter und Felder im zehnten Embed sowie Save und Live-Edit aller zehn. Der UI-Smoke prüft zusätzlich die aktive Mehrfach-Embed-Bedienung.

### Release-Freigabe 3.9.299
- `npm run build:win` bestand am 27.08.2026 vollständig: Release-Suite, NSIS-Build, Update-Manifest, gepackte Electron-Runtime und Artefakt-Audit.
- Installer: `C:\Users\5gtag\Documents\Discord Bot\dist\FHCC-Setup-3.9.299-x64.exe`.
- Größe: `594106664` Bytes (`566,6 MiB`).
- SHA-256: `27A3D94B9099AD987E794EA03CB3EAA49A42ED3D4DB1F22BDDA6E93671C3604D`.
- `dist/latest.yml`: Version `3.9.299`, Datei `FHCC-Setup-3.9.299-x64.exe`, Größe `594106664` Bytes; SHA-512 wurde beim Erzeugen gegen die EXE geprüft.
- Artefakt-Audit: `4773` ASAR-Einträge, native SQLite-Datei `1989632` Bytes, `0` private Dateien und `0` Build-Reste paketiert.
- Packaged-Runtime-Smoke: Electron `43.2.0`, Node `24.18.0`, ABI `148`, keine Discord-Verbindung im Test und kein Native-Modul-Fehler.
- Interaktions-Soak: `140/140` Interaktionen rechtzeitig bestätigt; maximale Ack-Latenz `1772 ms`.
- Nicht blockierende Hinweise: Lokales CLI-Node `24.16.0` liegt unter der empfohlenen `24.17.0`, die gepackte Runtime verwendet `24.18.0`. Eine eigene Windows-Herausgeber-Signatur ist weiterhin nicht konfiguriert.

## Globaler JSON-Import im Embed Studio (Release 3.9.300, 2026-08-27)

### Nutzerworkflow
- Neben `JSON kopieren` steht im gesamten Embed Studio jetzt `JSON importieren`.
- Der Importdialog besitzt ein großes direkt editierbares JSON-Feld sowie `Aus Zwischenablage einfügen`. Die Zwischenablage ist optional; JSON kann immer manuell eingefügt oder geschrieben werden.
- `JSON laden` sendet und speichert nichts automatisch. Nach erfolgreicher Prüfung wird der Inhalt als Studio-Entwurf geladen, vollständig in der Vorschau gezeigt und anschließend über den normalen Modul-/Sendeweg gespeichert.
- Parser- oder Discord-Limitfehler bleiben im geöffneten Dialog sichtbar. Der bisherige Studio-Inhalt wird in diesem Fall nicht überschrieben.

### Unterstützte Formate
- Nativer FHCC-Export aus `JSON kopieren` mit `content`, `embeds`, Bildern, Komponenten und Reaktionsrollen.
- Normales Discord-Payload mit `content`, `embeds`, numerischer Farbe, `author`, `footer`, `thumbnail`, `image`, ISO-Timestamp und Feldern.
- Discohook-Struktur `messages[0].data` bzw. `messages[0]`.
- Ein einzelnes Discord-Embedobjekt oder ein direktes Array von Embedobjekten.
- Discord-Farben werden von Dezimalwerten in `#rrggbb` umgewandelt; verschachtelte Discord-Felder wie `author.icon_url` und `footer.icon_url` werden in das interne Studioformat überführt.
- Maximal 10 Embeds und 25 Felder pro Embed werden übernommen. Die bestehende Studio-Validierung prüft zusätzlich Nachrichtenlänge, gesamte Embed-Zeichen und alle Discord-Einzelgrenzen vor dem Laden.

### Modulschutz und Architektur
- Die reine Parser-/Merge-/Dialoglogik liegt in `desktop/renderer/studio-json-import.js`; `desktop/renderer/app.js` enthält nur die zentrale Initialisierung und bleibt unter 9.800 Zeilen.
- Importierter Inhalt darf niemals einen Spezialmodus aktivieren oder wechseln. `specialTemplate` stammt ausschließlich aus dem bereits geöffneten Studio.
- Bei Modul-Studios bleiben Zielkanal, Funktionsset, importierte Komponenten, Reaktionsrollen und modulspezifische Metadaten aus dem aktuellen Modul erhalten. JSON ersetzt dort nur den editierbaren Nachrichteninhalt.
- Damit können fremde JSON-Dateien weder `heavenEconomy`-Buttons vortäuschen noch TempVoice-, Counting-, Leveling-, Moderations- oder andere Modulworkflows umgehen.
- Bei normalen freien Studio-Entwürfen dürfen Discord-Komponenten und FHCC-Reaktionsrollen regulär importiert werden.
- `messageId` wird beim Import geleert. Ein Import kann deshalb nicht unbemerkt eine fremde bestehende Discord-Nachricht als Bearbeitungsziel einschleusen.

### Regression
- `scripts/studio-json-import-smoke.mjs` prüft FHCC-, Discord- und Discohook-Formate, Dezimalfarben, verschachtelte Bilder/Autor/Footer, Timestamp, zehn Embeds, ungültiges/leeres JSON und den vollständigen Modulschutz.
- Der Test ist fester Bestandteil von `npm run test:quality`.
- `scripts/heaven-economy-ui-smoke.mjs` prüft zusätzlich Button, Dialog, Script-Einbindung und Renderer-Initialisierung.

### Release-Freigabe 3.9.300
- `npm run build:win` bestand am 27.08.2026 vollständig: Release-Suite, Qualitätsprüfung, Interaktions-Soak, NSIS-Build, Update-Manifest, gepackte Electron-Runtime und Artefakt-Audit.
- Installer: `C:\Users\5gtag\Documents\Discord Bot\dist\FHCC-Setup-3.9.300-x64.exe`.
- Größe: `594115819` Bytes (`566,6 MiB`).
- SHA-256: `4D85F01AE25DF97967BAE3261FA1DEFF7D4EF07AC96683EEE3BFE96AA6B19684`.
- `dist/latest.yml`: Version `3.9.300`, Datei `FHCC-Setup-3.9.300-x64.exe`, Größe `594115819` Bytes; SHA-512 wurde beim Erzeugen gegen die EXE geprüft.
- Artefakt-Audit: `4775` ASAR-Einträge, native SQLite-Datei `1989632` Bytes, `0` private Dateien und `0` Build-Reste paketiert.
- Packaged-Runtime-Smoke: Electron `43.2.0`, Node `24.18.0`, ABI `148`, keine Discord-Verbindung im Test und kein Native-Modul-Fehler.
- Interaktions-Soak: `114/114` Interaktionen rechtzeitig bestätigt; maximale Ack-Latenz `1859 ms`.
- Nicht blockierende Hinweise: Lokales CLI-Node `24.16.0` liegt unter der empfohlenen `24.17.0`, die gepackte Runtime verwendet `24.18.0`. Eine eigene Windows-Herausgeber-Signatur ist weiterhin nicht konfiguriert.

## VIP-Vorteile-Panel: Außenbilder und Embed-Bildlinks (Release 3.9.301, 2026-08-27)

### Ursache
- `desktop/renderer/economy-panel-studio.js` setzte `outsideImageUrl`, `outsideImageName`, `outsideImageSize` und `outsideImageAttachment` beim Öffnen des Economy-Spezialmodus immer auf leere Werte. Ein zuvor gewähltes Außenbild verschwand deshalb nach Speichern und erneutem Laden.
- `normalizeEconomyPanelTemplate(...)` und die Economy-Normalisierung in `src/defaultConfig.js` kannten keine Außenbild-Metadaten. Selbst ein korrekt vom Renderer gesendeter lokaler Bildverweis wurde beim Speichern aus der Config entfernt.
- `buildHeavenEconomyPanelPayload(...)` verwendete einen vereinfachten Sonderrenderer. Dieser setzte nur externe Bild-URLs direkt. Discord-CDN-Anhangslinks wurden durch `isAllowedEmbedImageUrl(...)` absichtlich abgelehnt, aber anders als im normalen Studio nicht heruntergeladen und als `attachment://` neu hochgeladen. Dadurch zeigte die Studio-Vorschau ein Großbild, das Live-Panel ließ es jedoch still weg.

### Korrektur
- Das Economy-Studio lädt und speichert nun die vollständigen Außenbilddaten einschließlich lokaler Asset-Referenz, Dateiname, Größe und MIME-Typ.
- Der Economy-Panel-Builder ist asynchron und verwendet den zentralen `fetchEmbedAsset(...)`-Cache sowie `readLocalImage(...)`.
- Großbild, Thumbnail, Autor-Icon und Footer-Icon werden als echte Discord-Anhänge aufgebaut. Das funktioniert insbesondere für `cdn.discordapp.com`-Links und verhindert ablaufende Embed-Bilder.
- Das Außenbild wird separat als normaler Nachrichtenanhang gesendet. Außenbild und alle Embed-Bilder teilen sich Discords Maximum von zehn Dateien.
- Beim Live-Edit wird `attachments: []` gesetzt und der vollständige aktuelle Bildsatz erneut angehängt. Entfernte oder ersetzte Bilder bleiben dadurch nicht als alte Discord-Anhänge hängen.
- HTTP- und HTTPS-Titel-Links werden akzeptiert. Nicht erreichbare blockierte Bildlinks erzeugen einen klaren Fehler mit Embednummer und Feldname, statt unbemerkt ohne Bild zu senden.

### Regression
- `scripts/heaven-economy-panel-studio-smoke.mjs` reproduziert die alte Fehlerkette mit lokaler Außenbildreferenz und einem Discord-CDN-Großbild.
- Geprüft werden Persistenz der Außenbild-Metadaten, klickbarer Titel-Link, `attachment://fh-economy-asset-1.png`, beide hochgeladenen Dateien und kontrolliertes Ersetzen alter Anhänge.
- `npm run test:economy` deckt zusätzlich alle sieben Panel-Buttons, bis zu zehn Embeds, VIP/Coins, Transfers, Boost-Meilensteine, Migration, Deduplizierung und VIP-DMs ab.

### Release-Freigabe 3.9.301
- `npm run build:win` bestand am 27.08.2026 vollständig: Release-Suite, Qualitätsprüfung, Interaktions-Soak, NSIS-Build, Update-Manifest, gepackte Electron-Runtime und Artefakt-Audit.
- Installer: `C:\Users\5gtag\Documents\Discord Bot\dist\FHCC-Setup-3.9.301-x64.exe`.
- Größe: `594118835` Bytes (`566,6 MiB`).
- SHA-256: `2691479F6B32D8F080559D6C73E9A4DE533052EB96ED7090376E40858405A45A`.
- `dist/latest.yml`: Version `3.9.301`, Datei `FHCC-Setup-3.9.301-x64.exe`, Größe `594118835` Bytes; SHA-512 wurde beim Erzeugen gegen die EXE geprüft.
- Artefakt-Audit: `4775` ASAR-Einträge, native SQLite-Datei `1989632` Bytes, `0` private Dateien und `0` Build-Reste paketiert.
- Packaged-Runtime-Smoke: Electron `43.2.0`, Node `24.18.0`, ABI `148`, keine Discord-Verbindung im Test und kein Native-Modul-Fehler.
- Interaktions-Soak: `111/111` Interaktionen rechtzeitig bestätigt; maximale Ack-Latenz `1850,88 ms`.
- Nicht blockierende Hinweise: Lokales CLI-Node `24.16.0` liegt unter der empfohlenen `24.17.0`, die gepackte Runtime verwendet `24.18.0`. Eine eigene Windows-Herausgeber-Signatur ist weiterhin nicht konfiguriert.

## Gemeinsamer Embed-Payload-Builder für Studio und Economy (Release 3.9.302, 2026-08-27)

### Architektur
- Der vollständige, bisher in `src/index.js` eingebettete Studio-Payload-Builder liegt jetzt in `src/runtime/studioEmbedPayload.js` und wird als `buildStudioEmbedPayload(...)` exportiert.
- Der normale Embed-Studio-Versand in `src/index.js` delegiert direkt an dieses Runtime-Modul. Die frühere lokale Implementierung einschließlich ihrer Hilfsfunktionen wurde entfernt; es existiert nur noch eine produktive Quelle für diesen Ablauf.
- `src/features/heavenEconomy.js` importiert denselben Builder. Vorher wird eine lokale Außenbildreferenz mit `materializeOutsideImageTemplate(...)` aufgelöst; danach läuft das vollständige Economy-Template durch exakt denselben Payload-Code wie ein normales Studio-Embed.
- Economy besitzt keinen eigenen `fh-economy-asset-*`-Renderer mehr. Nach dem gemeinsamen Build ergänzt das Modul ausschließlich `buildHeavenEconomyComponents(cfg)` und `allowedMentions`.

### Einheitliches Verhalten
- Titel, Titel-Link, Beschreibung, Farbe, Autor, Thumbnail, großes Bild, Felder, Footer und Zeitstempel werden identisch verarbeitet.
- Außenbilder und eingebettete Bildlinks verwenden denselben `fetchEmbedAsset(...)`-Cache und dieselben `attachment://fh-asset-*`-Referenzen.
- Discords Grenzen für zehn Embeds, 6.000 gemeinsame Embed-Zeichen, 25 Felder je Embed, Einzeltextlängen und zehn Anhänge gelten zentral und können zwischen normalem Studio und VIP-Vorteilen nicht mehr auseinanderlaufen.
- Die Economy-Platzhalter `{server}`, `{coinEmoji}` und `{boostMilestoneReward}` werden über die Formatierungsfunktion des gemeinsamen Builders aufgelöst. Die normale Studio-Platzhalterlogik bleibt unverändert.

### Regression
- `scripts/heaven-economy-ui-smoke.mjs` verlangt den Import von `buildStudioEmbedPayload` in Economy und verbietet dauerhaft den alten Präfix `fh-economy-asset-`.
- `scripts/heaven-economy-panel-studio-smoke.mjs` erwartet für das Discord-CDN-Großbild jetzt die zentrale Referenz `attachment://fh-asset-1.png` und prüft weiterhin Außenbild, Speichern, zehn Embeds und sieben echte Buttons.
- `verify-bot-imports`, `embed-link-preview-smoke`, `embed-asset-cache-smoke`, `npm run test:economy` und `npm run test:design-pipeline` wurden nach der Extraktion grün ausgeführt.

### Release-Freigabe 3.9.302
- `npm run build:win` bestand am 27.08.2026 vollständig: Release-Suite, Qualitätsprüfung, Interaktions-Soak, NSIS-Build, Update-Manifest, gepackte Electron-Runtime und Artefakt-Audit.
- Installer: `C:\Users\5gtag\Documents\Discord Bot\dist\FHCC-Setup-3.9.302-x64.exe`.
- Größe: `594112475` Bytes (`566,6 MiB`).
- SHA-256: `D0DB50E1F56F612EB88078E9E1235CA0B37CF919FA456F637057950FA617D69B`.
- `dist/latest.yml`: Version `3.9.302`, Datei `FHCC-Setup-3.9.302-x64.exe`, Größe `594112475` Bytes; SHA-512 wurde beim Erzeugen gegen die EXE geprüft.
- Artefakt-Audit: `4776` ASAR-Einträge, native SQLite-Datei `1989632` Bytes, `0` private Dateien und `0` Build-Reste paketiert.
- Packaged-Runtime-Smoke: Electron `43.2.0`, Node `24.18.0`, ABI `148`, keine Discord-Verbindung im Test und kein Native-Modul-Fehler.
- Interaktions-Soak: `97/97` Interaktionen rechtzeitig bestätigt; maximale Ack-Latenz `2000 ms`.
- Nicht blockierende Hinweise: Lokales CLI-Node `24.16.0` liegt unter der empfohlenen `24.17.0`, die gepackte Runtime verwendet `24.18.0`. Eine eigene Windows-Herausgeber-Signatur ist weiterhin nicht konfiguriert.

## Aktivitäts-Liga: falsche Voice-Teilnehmer (Release 3.9.303, 2026-08-29)

### Gemeldetes Fehlerbild
- Ein Mitglied (konkret gemeldet: Lena) erschien in der Sprachchat-Auswertung, obwohl es sich nicht mehr in einem Sprachkanal befand.
- Die Liga zeigt grundsätzlich kumulierte Sprachzeit, nicht die aktuelle Call-Anwesenheit. Bereits korrekt oder fälschlich verbuchte historische Zeit bleibt deshalb in der gewählten Tages-, Wochen- oder Monatsauswertung sichtbar. Der fatale Fehler war, dass ein veralteter interner Zustand diese Zeit weiter erhöhen konnte.

### Bestätigte Ursachen
- `src/features/activityRace.js` führte zusätzlich zu Discords `guild.voiceStates.cache` eine eigene `runtime.voiceStates`-Map. Join-, Wechsel- und Disconnect-Ereignisse aktualisierten diese Map, der 30-Sekunden-Tick vertraute ihr jedoch ohne erneuten Abgleich.
- Ging ein `voiceStateUpdate` bei Reconnect, Gateway-Unterbrechung oder Prozesswechsel verloren, blieb der alte Kanal in der internen Map. Solange Kanal und Mitglied noch im Guild-Cache existierten, bestand `voiceEligibility(...)` weiterhin und die Liga schrieb alle 30 Sekunden zusätzliche Zeit gut.
- Beim Bot-Start schrieb `creditDowntimeVoice(...)` außerdem allen zu diesem Zeitpunkt sichtbaren Call-Teilnehmern bis zu zwei Stunden Offline-Zeit gut. Diese Annahme war nicht beweisbar: Discord liefert beim Neustart nur die aktuelle Belegung, keine historische Voice-Timeline für den Ausfall.

### Korrektur und Wahrheitsquelle
- Neue Funktion `reconcileVoiceStates(runtime)` baut die interne Map vollständig aus dem aktuellen `guild.voiceStates.cache` neu auf. Einträge ohne `channelId` und Bots werden verworfen; Kanal, Self-Deaf und Server-Deaf werden frisch übernommen.
- `settleVoice(...)` führt diesen autoritativen Abgleich standardmäßig vor jeder Gutschrift aus. Damit bereinigen periodische Ticks, Panel-Aktualisierungen, Rollenabgleiche und manuelle Snapshots automatisch verpasste Disconnects.
- Nur der echte `onVoiceStateUpdate`-Handler ruft `settleVoice(..., { reconcile: false })` auf. Das ist absichtlich so: Zuerst wird die Zeit bis zum Event anhand des bisherigen Zustands korrekt abgeschlossen, danach wird der betroffene User mit `newState` gesetzt oder bei Disconnect entfernt.
- Der komplette Offline-Voice-Nachtrag wurde entfernt. Chat kann weiterhin exakt über Nachrichtenindex und Discord-Verlauf nachgezogen werden; Voice bleibt während Bot-Ausfällen ungezählt, statt erfundene Zeit zu verteilen.
- Bestehende Liga-Daten werden nicht automatisch subtrahiert. Frühere Versionen speicherten weder pro User noch pro Tick, welcher Anteil aus einem veralteten State oder Offline-Nachtrag kam. Eine pauschale Bereinigung würde daher auch echte Voice-Zeit zerstören. Ab 3.9.303 wird ausschließlich neu entstehende falsche Zeit verhindert.

### Regression und Prüfung
- `scripts/activity-race-smoke.mjs` enthält einen gezielten Stale-State-Fall: Intern stehen `stale-user` und ein veralteter Kanal für `confirmed-user`; Discord bestätigt nur `confirmed-user` in einem anderen Kanal. Nach dem Abgleich existiert ausschließlich der aktuelle Discord-Eintrag mit frischen Deaf-Werten.
- Ein Quelltest verbietet den früheren Startpfad `await creditDowntimeVoice(runtime, offline)`, damit unbeweisbare Neustart-Gutschriften nicht unbemerkt zurückkehren.
- Der Test wurde vor der Implementierung rot ausgeführt (`TypeError: reconcileVoiceStates is not a function`) und lief nach der Korrektur grün (`activity-race-smoke: ok`).
- `npm run build:win` bestand vollständig: Release-Suite, alle Community- und Qualitätsprüfungen, NSIS-Build, Update-Manifest, gepackte Electron-Runtime und Artefakt-Audit.

### Betriebsdiagnose
- Auf diesem Entwicklungs-PC lief während der Analyse kein installierter FHCC-/Bot-Prozess. Der kanonische lokale Datenpfad `C:\Users\5gtag\AppData\Roaming\FALLEN HEAVEN Control Center\runtime\data\activity-race.json` war zuletzt am 13.08.2026 geändert und enthielt daher nicht den aktuell gemeldeten Live-Zustand.
- Eine exakte rückwirkende Zuordnung von Lenas bereits verbuchter Zeit war aus diesem lokalen Altbestand nicht möglich. Die Implementierungsursachen selbst wurden direkt im produktiven Zählpfad bestätigt und reproduzierbar abgesichert.

### Release-Freigabe 3.9.303
- Installer: `C:\Users\5gtag\Documents\Discord Bot\dist\FHCC-Setup-3.9.303-x64.exe`.
- Größe: `594114191` Bytes (`566,6 MiB`).
- SHA-256: `D3ADC4483DDD9ECA894A9A2BB19BCDFD90FAA5215EF77573BFAB2BACA705EFCF`.
- `dist/latest.yml`: Version `3.9.303`, Datei `FHCC-Setup-3.9.303-x64.exe`, Größe `594114191` Bytes; SHA-512 wurde beim Erzeugen und im unabhängigen Nachcheck gegen die EXE geprüft.
- Artefakt-Audit: `4776` ASAR-Einträge, native SQLite-Datei `1989632` Bytes, `0` private Dateien und `0` Build-Reste paketiert.
- Packaged-Runtime-Smoke: Electron `43.2.0`, Node `24.18.0`, ABI `148`, keine Discord-Verbindung im Test und kein Native-Modul-Fehler.
- Interaktions-Soak: `114/114` Interaktionen rechtzeitig bestätigt; maximale Ack-Latenz `2095,792 ms`.
- Nicht blockierende Hinweise: Lokales CLI-Node `24.16.0` liegt unter der empfohlenen `24.17.0`, die gepackte Runtime verwendet `24.18.0`. Eine eigene Windows-Herausgeber-Signatur ist weiterhin nicht konfiguriert.

## Aktivitäts-Liga aus Carl-bot-Voice-Logs (Release 3.9.304, 2026-08-29)

### Korrektur zu 3.9.303
- Die Aussage, historische falsche Voice-Zeit könne grundsätzlich nicht korrigiert werden, war zu pessimistisch. Der Server besitzt einen Carl-bot-Voice-Log-Kanal; dessen Nachrichten liegen im SQLite-Serverindex und enthalten Join, Leave und Move mit Ereigniszeitpunkt.
- `3.9.303` verhindert weiterhin korrekt neue Phantom-Zeit durch veraltete RAM-States. `3.9.304` ergänzt die fehlende historische Wahrheitsquelle und kann bereits gespeicherte Liga-Zeit auf eindeutig indexierten Tagen neu berechnen.

### Reale Indexanalyse
- Automatisch erkannter Log-Kanal: `1306078721840775290`.
- Lokaler Analysebestand: `83.273` indexierte Kanalnachrichten vom `13.11.2024` bis `13.08.2026`.
- Titelverteilung: `34.592` Join-, `34.294` Leave- und `11.000` Move-Ereignisse sowie `3.387` Cleaner-Meldungen.
- Ein Vollscan mit bereits bekannter Kanal-ID verarbeitete alle `83.273` Zeilen auf diesem PC in rund `462 ms`.
- Der alte Legacy-Import speicherte bis einschließlich 05.08.2026 zwar Titel und sichtbaren Mitgliedsnamen, aber keine Footer-User-ID. Eine Zuordnung anhand heutiger Namen wäre wegen Umbenennungen und Namensgleichheit unsicher.
- Ab 06.08.2026 sind die Voice-Ereignisse im vorhandenen lokalen Bestand vollständig mit User-ID und Zeitstempel gespeichert. Die Anwendung berechnet diese Grenze aus den Daten; das Datum ist nicht fest codiert.

### Session-Rekonstruktion
- `src/features/voiceLogImport.js` exportiert `reconstructVoiceLogSessions(...)` und `getIndexedVoiceLogSessions(...)`.
- Join öffnet eine Session, Leave schließt sie, Move schließt den alten Kanal und öffnet zum identischen Zeitstempel den neuen. Ein erneuter Join ersetzt eine noch offene Session kontrolliert.
- Indexzeilen werden strikt nach `created_at` und `message_id` verarbeitet. Die Session verwendet den Embed-Timestamp des Carl-Logs; die Nachrichtenzeit ist nur Fallback.
- Für jede Indexrevision werden geschlossene Sessions, offene Sessions, erste/letzte Ereigniszeit und nicht eindeutig parsebare Voice-Ereignisse gespeichert.
- Offene Sessions gelangen nur bis `now` in die Liga, wenn `guild.voiceStates.cache` denselben Nutzer aktuell in einem Kanal bestätigt. Ein altes Join ohne Leave bleibt sonst ohne laufende Gutschrift.

### Liga-Neuberechnung
- `reconcileVoiceFromLogs(...)` in `src/features/activityRace.js` filtert Bots, ausgeschlossene Rollen, ignorierte Kanäle und AFK-Kanäle mit der bestehenden Liga-Konfiguration.
- `buildVoiceLogDailyTotals(...)` führt je Sprachkanal einen Zeitachsen-Sweep aus. Bei `voiceMinimumParticipants > 1` zählt nur die echte Überschneidung, in der mindestens so viele Nutzer gleichzeitig im selben Kanal waren.
- `addVoiceIntervalToDays(...)` sucht die lokale Tagesgrenze binär und teilt Sessions dadurch millisekundengenau über Mitternacht und Sommer-/Winterzeit.
- `replaceVoiceDaysFromLogs(...)` setzt ausschließlich `voiceMilliseconds` neu. `messages`, Panelzustand, Gewinnerledger, Pings und alle anderen Ligadaten bleiben erhalten.
- Die sichere Startgrenze ist der Tag nach dem letzten Voice-Ereignis ohne eindeutige User-ID. Zusätzlich werden einzelne unvollständige Tage fail-closed übersprungen. Es werden niemals Namen geraten oder zweifelhafte Tage auf null gesetzt.
- Nach der Neuberechnung laufen Rollenabgleich und die drei Liga-Embeds mit den korrigierten Werten. Der persistierte Diagnoseblock `voiceIndexBackfill` enthält Kanal, Quelle, Revision, Zeitraum, Sessionzahl, übersprungene Tage und Abschlusszeit.

### Performance
- Der vorhandene `runVoiceLogBackfill(...)` baut während seines ohnehin nötigen Vollscans jetzt gleichzeitig den Session-Cache für die Liga auf. Aktivitäts-Liga und Inaktivitäts-/Profilimport lesen die große Historie beim Start daher nicht doppelt.
- Der Cache verwendet Kanal, Zeilenzahl, ältesten/neuesten Zeitstempel und neueste Message-ID als Revision.
- Bei unveränderter Revision erfolgt keine Neuberechnung. Bei angehängten Logs lädt die SQL-Abfrage nur Zeilen nach dem letzten `(created_at, message_id)`-Cursor. Ein Vollscan erfolgt nur bei Erststart, erzwungener Reparatur oder nicht monoton veränderter Historie.
- Während großer Scans gibt der Parser den Event-Loop regelmäßig frei; Discord-Interaktionen bleiben reaktionsfähig.

### Regression
- `scripts/voice-log-import-smoke.mjs` prüft die reine Join/Move/Leave-Paarung und eine echte SQLite-Session von exakt 30 Minuten.
- `scripts/activity-race-smoke.mjs` prüft Mindestteilnehmer-Überlappung, lokale Mitternachtsteilung, Entfernen eines falschen Lena-Voice-Werts bei erhaltenen Chatdaten, fail-closed Überspringen unvollständiger Tage und die dynamische sichere Startgrenze.
- `voice-log-import-smoke.mjs` ist jetzt fester Bestandteil von `npm run test:community` und damit jeder Release-Freigabe.

### Release-Freigabe 3.9.304
- Installer: `C:\Users\5gtag\Documents\Discord Bot\dist\FHCC-Setup-3.9.304-x64.exe`.
- Größe: `594120487` Bytes (`566,6 MiB`).
- SHA-256: `0F4DD55322887A2DE8CD20C73AFD9CF768A0C0AC5F9A62709C364BFA07931627`.
- `dist/latest.yml`: Version `3.9.304`, Datei `FHCC-Setup-3.9.304-x64.exe`, Größe `594120487` Bytes; SHA-512 wurde beim Erzeugen und im unabhängigen Nachcheck gegen die EXE geprüft.
- Artefakt-Audit: `4776` ASAR-Einträge, native SQLite-Datei `1989632` Bytes, `0` private Dateien und `0` Build-Reste paketiert.
- Packaged-Runtime-Smoke: Electron `43.2.0`, Node `24.18.0`, ABI `148`, keine Discord-Verbindung im Test und kein Native-Modul-Fehler.
- Interaktions-Soak: `111/111` Interaktionen rechtzeitig bestätigt; maximale Ack-Latenz `1790,525 ms`.
- Nicht blockierende Hinweise: Lokales CLI-Node `24.16.0` liegt unter der empfohlenen `24.17.0`, die gepackte Runtime verwendet `24.18.0`. Eine eigene Windows-Herausgeber-Signatur ist weiterhin nicht konfiguriert.

## Mehrere Rollen nach Verifizierung (Release 3.9.305, 2026-08-31)

### Anforderung und Einordnung
- Das bestehende Welcome/Farewell-Modul erkannte bereits den echten Uebergang, bei dem eine konfigurierte Unverified-Rolle entfernt wird. Es konnte danach jedoch nur eine Welcome-Nachricht senden; die alte `autoRoleName`-Option vergab genau eine Rolle direkt beim Serverbeitritt und war fuer externe Verifizierungsbots ungeeignet.
- Die neue Funktion bleibt im Welcome/Farewell-Modul, weil dort Ereignis, Unverified-Rolle und optionale Begruessung bereits zusammenlaufen. Es wurde bewusst kein zweiter konkurrierender Verify-Listener angelegt.

### Konfiguration und UI
- `welcomeFarewell.postVerificationRolesEnabled` aktiviert die Rollenregel unabhaengig von `welcomeEnabled`.
- `welcomeFarewell.postVerificationRoleIds` ist eine `multiRoleSelect`-Auswahl und speichert eine bereinigte, deduplizierte Liste von Rollen-IDs.
- `verificationRoleId` bleibt die gemeinsame Unverified-Rolle fuer verzögerte Begruessung und Rollenvergabe.
- `src/runtime/moduleReadiness.js` blockiert eine aktive Regel sichtbar, wenn Unverified-Rolle oder Zielrollen fehlen. Vorhandene Ressourcen werden weiterhin auf Existenz, Zuweisbarkeit und Bot-Berechtigung geprueft.

### Live-Ereignisfluss
- `verificationRoleWasRemoved(oldMember, newMember, roleId)` ist die einzige Live-Ausloesebedingung: Die Rolle muss im alten Member-State vorhanden und im neuen State entfernt sein.
- Der Handler beendet die Verarbeitung fuer Bots und beliebige Folgeupdates ohne diesen Uebergang sofort.
- `missingPostVerificationRoles(...)` filtert bereits vorhandene Zielrollen. `assignPostVerificationRoles(...)` uebergibt nur die fehlenden IDs gesammelt an `applyManagedRolePolicy(...)`; dadurch entsteht je Mitglied hoechstens ein Discord-Rollenaufruf statt eines Aufrufs pro Rolle.
- `requireAll: false` erlaubt die Vergabe gueltiger Rollen, auch wenn eine andere konfigurierte Rolle geloescht, verwaltet oder ausserhalb der Bot-Hierarchie liegt. Blockierte Rollen werden gedrosselt ueber `quietLog` sichtbar.
- Rollenvergabe und Welcome-Versand sind getrennte Zweige. Ein Rollenfehler verhindert die Begruessung nicht, und deaktiviertes Welcome verhindert die Rollenvergabe nicht.

### Offline-Nachtrag und Performance
- `reconcilePostVerificationRoles(...)` laedt beim Bot-Start einmal die Servermitglieder, damit Verifizierungen waehrend eines Bot-Ausfalls nachgetragen werden.
- Es gibt keinen periodischen Vollscan. Im normalen Betrieb kostet ein Rollenupdate O(1) bezogen auf die Servergroesse.
- Vor API-Schreibzugriffen werden Bots, Mitglieder mit weiterhin vorhandener Unverified-Rolle und Mitglieder mit bereits vollstaendigem Rollensatz rein lokal herausgefiltert.
- Fehlende Rollen werden mit maximal vier parallelen Workern vergeben. Der zentrale Managed-Role-Service serialisiert konkurrierende Aenderungen zusaetzlich pro Mitglied.
- Der Abgleich ist pro Server Single-Flight. Ein zweiter identischer Lauf teilt dieselbe Promise; eine waehrenddessen geaenderte Rollenregel wartet den alten Lauf ab und startet danach mit dem neuen Fingerprint.
- `postVerificationFingerprint(...)` enthaelt Aktivstatus, Unverified-Rolle und sortierte Zielrollen. Ein Speichern von Welcome-Text, Kanal oder Embed loest deshalb keinen erneuten Mitgliederscan aus. Ein echter Wechsel dieser Rollenregel startet dagegen sofort einen Konfigurationsabgleich.
- Feature-Ready-Hooks laufen im zentralen Dispatcher parallel zu anderen Features. Der einmalige Rollenabgleich blockiert damit weder Interaktionen noch die Initialisierung anderer Module.

### Regression
- `scripts/welcome-verification-smoke.mjs` prueft die Normalisierung von Rollen-IDs, gebuendelte Mehrfachvergabe bei deaktivierter Welcome-Nachricht, Auslassen bereits vorhandener Rollen, No-op bei Folgeupdates, Bot-Ausschluss, Schutz noch unverifizierter Mitglieder, Startnachtrag fuer Offline-Verifizierungen und den Fingerprint gegen unnoetige Folge-Scans.
- Beide neuen Kernfaelle wurden testgetrieben zuerst rot bestaetigt: fehlende Mehrfachvergabe sowie ein zweiter Vollabgleich nach reiner Textaenderung. Nach der Implementierung ist der Smoke-Test gruen.

### Release-Freigabe 3.9.305
- `npm run build:win` bestand am 31.08.2026 vollstaendig: Import-Audit, Auth, Economy, Security, Backup, Rollen, Community, Intelligence, Design-Pipeline, Qualitaet, Release-Readiness, NSIS-Build, Update-Manifest, gepackte Runtime und Artefakt-Audit.
- Installer: `C:\Users\5gtag\Documents\Discord Bot\dist\FHCC-Setup-3.9.305-x64.exe`.
- Groesse: `594125159` Bytes (`566,6 MiB`).
- SHA-256: `6CC38DBD607411EF0DB7168CFE417AB87F5ECB6B6C0A9D079ACC77550FB651DB`.
- `dist/latest.yml`: Version `3.9.305`, Datei `FHCC-Setup-3.9.305-x64.exe`, Groesse `594125159` Bytes; SHA-512 wurde beim Erzeugen und im Artefakt-Audit geprueft.
- Artefakt-Audit: `4776` ASAR-Eintraege, native SQLite-Datei `1989632` Bytes, `0` private Dateien und `0` Build-Reste paketiert.
- Packaged-Runtime-Smoke: Electron `43.2.0`, Node `24.18.0`, ABI `148`, keine Discord-Verbindung im Test und kein Native-Modul-Fehler.
- Interaktions-Soak der Release-Freigabe: `114/114` Interaktionen rechtzeitig bestaetigt; maximale Ack-Latenz `2048 ms` trotz simulierter Rollen-API-, SQLite-, Nachrichten- und I/O-Last.
- Nicht blockierende Hinweise: Lokales CLI-Node `24.16.0` liegt unter der empfohlenen `24.17.0`. Eine eigene Windows-Herausgeber-Signatur ist weiterhin nicht konfiguriert.

## Persönliche Aktivitäts-Liga-Pings (Release 3.9.306, 2026-09-01)

### Ziel und Nutzerverhalten
- Platzierungs-Pings bleiben global über `activityRace.placementPings` steuerbar und sind für einzelne Mitglieder standardmäßig aktiv.
- Jedes Mitglied kann seine eigenen Pings mit genau einem Discord-Button im neuen separaten Ping-Info-Panel umschalten. Das beeinflusst ausschließlich Erwähnungen; Aktivität, Ranking und Liga-Rollen laufen unverändert weiter.
- Es wird bewusst keine Opt-in-Liste gespeichert. `pingOptOuts` enthält nur Mitglieder, die Pings ausdrücklich deaktiviert haben. Dadurch sind neue Mitglieder automatisch aktiv und der Speicher wächst nur durch echte Abwahlen.
- Die Auswahl bleibt bei Neustarts und erneutem Serverbeitritt erhalten. Ein Rejoin löscht den Opt-out nicht automatisch.

### Persistenz und Datenmodell
- `src/features/activityRace.js` verwendet Store-Version `6` des vorhandenen atomaren `data/activity-race.json`.
- Pro Server enthält `pingOptOuts` die Form `{ "userId": "disabledAt-ISO" }`. `isPlacementPingEnabled(...)` ist dadurch ein O(1)-Property-Lookup.
- Das Panel-Ledger wurde um `panel.pingInfo = { channelId, messageId, fingerprint }` erweitert. `normalizeGuildData(...)` migriert Altbestände ohne Sonderlauf; fehlende Felder erhalten sichere Leerwerte.
- `setPlacementPingPreference(...)` entfernt beim Aktivieren den Schlüssel vollständig oder schreibt beim Deaktivieren den ISO-Zeitpunkt. Der Live-Button wartet anschließend auf `flush()`, damit eine bestätigte Auswahl bereits atomar auf Platte liegt.

### Ping-Pfad und Performance
- `sendPlacementPings(...)` lädt die Guild-Daten genau einmal pro tatsächlichem Ping-Lauf und filtert Opt-outs vor Cooldown-Prüfung und Gruppierung.
- Unmittelbar vor jeder Nachricht erfolgt ein zweiter direkter Lookup. Klickt ein Mitglied während eines größeren Ping-Laufs auf Aus, wird ein noch nicht gesendeter Ping desselben Laufs unterdrückt.
- Es gibt keinen Mitgliederscan, keine zusätzliche Discord-Rolle, keinen Rollen-Fetch, keinen Member-Fetch, keinen Polling-Timer und keinen periodischen Preference-Job.
- Bestehende Cooldowns, Ping-Bündelung, Auto-Löschung und Neustart-Catch-up bleiben unverändert. Ein Opt-out erzeugt keinen Cooldown, weil ausgefilterte Zeilen den Versandpfad gar nicht erreichen.

### Sicherer Discord-Button
- Funktions-ID: `fh-activity-race:ping-toggle`. Der Button wird ausschließlich in `buildPingInfoPanelPayload(...)` serverseitig angehängt; Studio-Komponenten werden für dieses System nicht übernommen.
- `handlePingToggleButton(...)` bestätigt die Interaction zuerst ephemeral und liest erst danach den Store. Dadurch bleibt Discords Antwortfrist auch bei langsamer Platte geschützt.
- Gültig ist ausschließlich die aktuell in `panel.pingInfo.messageId` gespeicherte Nachricht. Kopierte, manuell nachgebaute oder alte Buttons antworten mit einem Hinweis auf das aktuelle Panel und verändern keine Einstellung.
- Bots werden ignoriert. Die Antwort nennt den neuen Zustand eindeutig und erklärt bei Aus, dass Ranking und Wertung weiterlaufen.

### Viertes Panel und Reihenfolge
- Die drei Ranking-Nachrichten Heute, vergangene Woche und vergangener Monat bleiben getrennt. Darunter verwaltet `ensurePanel(...)` eine vierte eigenständige Ping-Info-Nachricht.
- Wenn ein fehlendes Wochen- oder Monats-Panel später neu gesendet wird, wird ausschließlich das Info-Panel kontrolliert neu erstellt. Damit steht es wieder unter allen Liga-Nachrichten; bestehende Rankings und deren IDs bleiben unberührt.
- Ein SHA-256-Fingerprint aus `pingInfoDesign` und Buttonlabel verhindert unnötige Message-Edits und erneutes Herunterladen von Bildern bei normalen 30-/60-Sekunden-Liga-Aktualisierungen.
- `removePanel(...)` entfernt das Info-Panel gemeinsam mit den drei Ranking-Panels und setzt das komplette Ledger zurück.

### Embed Studio und App-UI
- Die Aktivitäts-Liga-Übersicht bietet neben Heute, Woche und Monat den vierten Befehl `Ping-Info-Panel bearbeiten`.
- Studio-Sektion `ping-info` unterstützt bis zu zehn Embeds, Nachrichtentext, Felder, Titel-Links, große Bilder, Thumbnail, Autor-/Footer-Icon und Außenbild. Lokale Außenbilder laufen über denselben `localImageStore` und zentralen `buildStudioEmbedPayload(...)` wie die anderen vollständigen Studio-Systeme.
- Nur die wirklich dynamischen Platzhalter `{server}` und `{buttonLabel}` werden im Info-Studio angeboten. Die Ranglisten-Platzhalter und die reservierten vier Ranking-Felder gelten dort nicht.
- Der Renderer sendet die Sektion separat als `{ section: "ping-info", template }`. `src/index.js` speichert sie unabhängig als `activityRace.pingInfoDesign`; der zentrale Design-Pipeline-Refresh aktualisiert danach die Live-Nachricht.
- Das Backend akzeptiert höchstens zehn Embeds und Discords gemeinsame Grenze von 6.000 Embed-Zeichen. Der echte Toggle wird nach dem Rendern hinzugefügt und kann durch importiertes JSON weder entfernt noch vervielfacht werden.

### Regression
- Neuer isolierter Test: `scripts/activity-race-ping-preferences-smoke.mjs`. Er prüft Store-Migration, Default-an, Opt-out/Opt-in, Filterung, Schutz gegen alte Nachrichten, mehrere Info-Embeds, genau einen echten Button, Placeholder-Auflösung sowie Studio-/Backend-Verkabelung.
- Der neue Test wurde zuerst rot am fehlenden `panel.pingInfo`-Ledger und danach erneut rot an den fehlenden Filter-/Nachrichtenprüfungen bestätigt; nach der Implementierung läuft er grün.
- Beim Testlauf am 01.09.2026 wurde ein unabhängiger Monatswechsel-Fehler im bestehenden `activity-race-smoke.mjs` sichtbar: Das Fixture enthielt August-Daten, `aggregatePeriod(...)` verwendete jedoch implizit das echte aktuelle Datum und wechselte dadurch auf September. Der Test übergibt jetzt explizit `2026-08-03` und bleibt damit an jedem Kalendertag deterministisch.

### Release-Freigabe 3.9.306
- `npm run build:win` bestand am 01.09.2026 vollständig: Import-Audit, Auth, Economy, Security, Backup, Rollen, Community, Intelligence, Design-Pipeline, Qualität, Release-Readiness, NSIS-Build, Update-Manifest, gepackte Runtime und Artefakt-Audit.
- Installer: `C:\Users\5gtag\Documents\Discord Bot\dist\FHCC-Setup-3.9.306-x64.exe`.
- Größe: `594123565` Bytes (`566,6 MiB`).
- SHA-256: `A3C4C966A22AED47969C301BC0498B6A7F749A375DD5BC16822E2E068B98DCDB`.
- `dist/latest.yml`: Version `3.9.306`, Datei `FHCC-Setup-3.9.306-x64.exe`, Größe `594123565` Bytes; SHA-512 `FyNWSC8L9SfXRpgjr0G4lKbecVhXClQcFGwqTBjOp7cTojPDqSFttM2dNPIxyPCys6b+RnZK2TNB6oKRUO9x3g==` wurde beim Erzeugen geprüft.
- Artefakt-Audit: `4777` ASAR-Einträge, native SQLite-Datei `1989632` Bytes, `0` private Dateien und `0` Build-Reste paketiert.
- Packaged-Runtime-Smoke: Electron `43.2.0`, Node `24.18.0`, ABI `148`, keine Discord-Verbindung im Test und kein Native-Modul-Fehler.
- Interaktions-Soak der finalen Release-Freigabe: `118/118` Interaktionen rechtzeitig bestätigt; maximale Ack-Latenz `1909,5874 ms` trotz simulierter Rollen-API-, SQLite-, Nachrichten- und I/O-Last.
- App-, Lockfile- und Manifestversion wurden unabhängig als `3.9.306` nachgeprüft; der SHA-256 wurde nach dem Cleanup erneut direkt aus der verbliebenen EXE berechnet.
- Nicht blockierende Hinweise: Lokales CLI-Node `24.16.0` liegt unter der empfohlenen `24.17.0`. Eine eigene Windows-Herausgeber-Signatur ist weiterhin nicht konfiguriert.

## Kopierte Rollen-Buttons nicht mehr doppelt + Emoji-Bibliothek liefert neue Bot-/Server-Emojis (2026-09-01)

### Symptome
- Beim Kopieren einer Discord-Nachricht mit Rollen-Buttons (z. B. „Boost-Farben“) ins Embed Studio erschienen die Buttons doppelt: einmal als importierte Komponenten in der Vorschau und einmal als Einträge im Abschnitt „Rollen-Buttons“. Beim Senden/Bearbeiten konnte dasselbe Panel dadurch mit zwei Button-Sätzen auf Discord landen (Original-Custom-ID + neu angehängte `fh_rr`-Buttons).
- Neu angelegte Bot- und Server-Emojis wurden in der Studio-Emoji-Bibliothek nicht angezeigt, obwohl der Server die Emojis bereits besaß.

### Ursache 1: Doppelte Buttons beim Kopieren
- `desktop/renderer/server-management.js` übergab beim Kopieren sowohl `reactionRoles` (aus `extractRoleButtonsFromMessage`) als auch `studioComponents` mit **allen** Nachrichten-Komponenten (`normalizeMessageComponentsForStudio(message.components)`).
- Rollen-Buttons wurden dadurch in beiden Bereichen gerendert; beim Speichern blieb der Original-Button (nicht-`fh_rr`) als fremde Komponente erhalten und `configureMessageReactionRoles` hängte zusätzlich die neuen `fh_rr`-Buttons an -> echte Verdopplung auf Discord.

### Fix 1
- Neuer Helper `importedStudioComponents(message)` in `desktop/renderer/server-management.js`:
  - Filtert aus jeder Komponenten-Zeile alle Buttons heraus, für die `resolveRoleButtonRoleId(component)` eine Rolle auflösen kann (`fh_rr`, eingebettete Rollen-ID oder Button-Label).
  - Nur echte Fremd-/Nicht-Rollen-Komponenten (Select-Menüs, Link-Buttons, Funktionssets) landen in `studioComponents`.
- Beide Kopierpfade (Einzel-Embed „Im Studio öffnen“ und „Alle Embeds übernehmen“) nutzen jetzt `studioComponents: importedStudioComponents(message)`.
- Verhalten: Rollen-Buttons erscheinen exakt einmal im Abschnitt „Rollen-Buttons“; beim Senden existiert pro Rolle genau ein `fh_rr`-Button.

### Ursache 2: Emoji-Bibliothek zeigte keine neuen Emojis
- `desktop/renderer/app.js` lud die Emojis in `openMessageEmojiPicker` nur, wenn der Server gewechselt hatte oder die Liste leer war. Ein einmal geladener Cache blieb dauerhaft stehen.
- Der Reload-Button (↻) und der Leer-Fallback riefen `loadMessageEmojiCatalog()` auf – eine Funktion, die es im Renderer nicht mehr gibt (Relikt eines Refactors). Der Reload warf damit eine `ReferenceError`, neue Bot-/Server-Emojis konnten nie nachgeladen werden.

### Fix 2
- `state.messageEmojiFetchedAt` speichert den Zeitpunkt des letzten erfolgreichen Fetches; `loadMessageEmojis(...)` setzt ihn bei Erfolg.
- `messageEmojiCacheFresh(guildId)` gilt als frisch, wenn derselbe Server geladen wurde und der Fetch weniger als 30 Sekunden (`MESSAGE_EMOJI_REFRESH_TTL_MS`) zurückliegt.
- `openMessageEmojiPicker` fetcht neu, sobald der Cache veraltet ist – neue Bot- und Server-Emojis erscheinen damit automatisch, ohne App-Neustart.
- Die beiden kaputten `loadMessageEmojiCatalog()`-Aufrufe rufen jetzt das echte `loadMessageEmojis(state.selectedGuildId)` auf; der ↻-Button (`ensureCatalog(force)`) funktioniert damit wieder und erzwingt einen sofortigen Reload.
- `ensureCatalog` startet keinen Parallel-Fetch mehr, wenn bereits ein Ladevorgang läuft (`state.messageEmojiLoading`).

### Regression
- `scripts/reaction-role-buttons-smoke.mjs` prüft jetzt echtes Importverhalten statt nur Quelltextmuster: exakte Legacy-Boost-Labels bleiben Rollenbuttons, Linkbuttons und ähnlich benannte normale Funktionsbuttons bleiben Fremdkomponenten, Select-Menüs bleiben erhalten und nur der bestätigte Rollenbutton wird aus gemischten Zeilen entfernt.
- Die Rollenauflösung akzeptiert nur Discord-Buttons (`type=2`) ohne URL und niemals Linkbuttons (`style=5`). `fh_rr` und gültige eingebettete Rollen-IDs bleiben eindeutige Signale. Der für alte Boost-Panels notwendige Label-Fallback ist standardmäßig nur noch exakt; unscharfes Matching ist ausschließlich für Custom-IDs mit Rollen-/Reaction-/Boost-/Farb-Semantik erlaubt.
- `scripts/message-emoji-cache-smoke.mjs` simuliert zwei überlappende Server-Fetches, lässt die neuere Antwort zuerst und die alte Antwort zuletzt eintreffen und prüft, dass ausschließlich der aktuell ausgewählte Server sichtbar bleibt.
- Die Race-Sicherung lebt im eigenen Renderer-Modul `desktop/renderer/message-emoji-loader.js`, das vor `app.js` geladen wird. Die Factory hält eine monoton steigende Request-ID privat; nach dem Netzwerk-`await` darf nur die jüngste Anfrage für `state.selectedGuildId` den Katalog, Serverbezug, Fetch-Zeitpunkt oder Ladezustand verändern. Ein geworfener Netzwerkfehler räumt den Ladezustand der aktiven Anfrage ebenfalls auf. Dadurch bleibt `app.js` unter der im UI-Audit erzwungenen Grenze von 9.800 Zeilen.
- Beide neuen Regressionen sind direkt in `test:quality` aufgenommen und laufen dadurch automatisch in `npm run test:release` sowie vor jedem `npm run build:win`.
- RED-Nachweis vor dem Fix: Linkbutton `VIP` wurde zur Rolle `VIP`; eine verspätete Antwort für `guild-a` ersetzte nach dem Wechsel den bereits geladenen Katalog von `guild-b`.
- GREEN nach dem Fix: `node scripts/reaction-role-buttons-smoke.mjs` und `node scripts/message-emoji-cache-smoke.mjs` bestanden.
- Der erste anschließende Build-Lauf deckte zusätzlich eine flakige Zeitannahme in `scripts/temp-voice-smoke.mjs` auf: Der Test wartete pauschal 40 ms und konnte den zweiten Discord-Delete bereits sehen, bevor der danach laufende atomare State-Write fertig war. Der Test pollt den registrierten Kanal jetzt begrenzt bis zu 1 Sekunde und prüft damit deterministisch den abgeschlossenen Cleanup statt Rechnergeschwindigkeit.
- Wichtig für Folgeagenten: `ui-field-audit.mjs` begrenzt `desktop/renderer/app.js` auf 9.800 Zeilen (die 9.850 in älteren Notizen sind veraltet). Neue UI-Logik gehört in eigene Renderer-Module.

### Release-Freigabe 3.9.307
- Die App-Version wurde für das Update von `3.9.306` auf `3.9.307` gehoben (`node scripts/bump-version.cjs`).
- `package.json` und `package-lock.json` tragen beide `3.9.307`; `release-readiness.cjs` blockiert abweichende Lockfile-Versionen.
- `desktop/renderer/index.html` trägt für die Haupt-CSS-/JS-Dateien `?v=3.9.307` (einschließlich des neuen `message-emoji-loader.js`); die Renderer-Live-Vorschau ersetzt `{version}` mit `3.9.307`. Die Root-Kopie `index.html` (3.9.289) und `src/features/index.html` (3.9.198) sind bewusst veraltete Legacy-Kopien und werden vom aktuellen `bump-version.cjs` nicht mehr synchronisiert; die App lädt ausschließlich `desktop/renderer/index.html`.
- `bot-changelog.json` (Root, gitignored) enthält den echten 3.9.307-Eintrag mit vier Punkten: Button-Dopplung beim Kopieren behoben, genau ein `fh_rr`-Button pro Rolle beim Senden, Emoji-Bibliothek mit Kurzzeit-Cache und funktionierendem ↻-Reload. `src/features/bot-changelog.json` ist eine veraltete Kopie und wird von `src/features/botUpdates.js` nicht gelesen (der Bot liest `../../bot-changelog.json` vom Root).
- Nachprüfung vor dem Build: Die vollständige Release-Kette war grün; anschließend wurden die zwei zusätzlichen Randfälle aus dem Review testgetrieben abgesichert und in die Release-Kette aufgenommen.
- Finaler Build-Status: `npm run build:win` ist vollständig mit Exit-Code 0 durchgelaufen. Enthalten waren `npm run test:release`, NSIS-Build, Update-Manifest, Packaged-Runtime-Smoke, Artefakt-Audit und `cleanup-dist`.
- Freigabe-Artefakt: `dist/FHCC-Setup-3.9.307-x64.exe`, 594.124.753 Bytes (566,6 MiB), SHA-256 `D3C4B2537A8A66300A36A6D4873E968668418C32AD7D41FA7E15BE672482BBC3`.
- `dist/latest.yml` trägt `version: 3.9.307`, verweist auf exakt diesen Installer und enthält die vom Build geprüfte SHA-512 sowie Größe 594.124.753 Bytes.
- Packaged-Runtime: Electron `43.2.0`, Node `24.18.0`, ABI `148`; Start ohne Discord-Verbindung und ohne Native-Modul-Fehler bestanden.
- Artefakt-Audit: 4.779 ASAR-Einträge, native SQLite-Binary 1.989.632 Bytes, keine privaten Dateien und keine übrig gebliebenen Entwicklungsdateien im Paket.
- `cleanup-dist` hat die alten Versionsartefakte entfernt. Zur Freigabe bleiben die neue `3.9.307`-EXE, ihre `.blockmap` für differenzielle Updates und `latest.yml` erhalten.
- Nicht blockierende lokale Hinweise bleiben unverändert: CLI-Node `24.16.0` liegt unter der Empfehlung `24.17.0`; eine eigene Windows-Herausgeber-Signatur ist nicht konfiguriert.

## Gesamtes UI-Neudesign als Command-Deck-Prototyp (2026-09-05)

### Ziel und Abgrenzung
- Der Nutzer empfindet die aktuelle App insgesamt als generisch, unübersichtlich und optisch zu nah an typischen AI-/SaaS-Dashboards. Besonders unerwünscht sind Buchstaben in quadratischen Navigationskacheln, gleichförmige Kartenwände, unklare Statuslichter und dieselbe Struktur für fachlich unterschiedliche Bereiche.
- Der neue Entwurf ist zunächst bewusst ein eigenständiger, lokaler HTML-Prototyp unter `docs/fhcc-command-deck-preview.html`. Er verändert weder `desktop/renderer/index.html` noch produktive App-Logik oder Daten.
- Die freigegebene Designspezifikation liegt in `docs/superpowers/specs/2026-09-05-fhcc-ui-redesign-prototype-design.md`; der Umsetzungsplan liegt in `docs/superpowers/plans/2026-09-05-fhcc-ui-redesign-prototype.md`.

### Neue Informationsarchitektur
- **Command Deck:** Eine horizontale Hauptnavigation ersetzt die permanente Icon-Seitenleiste. Die fünf Arbeitsbereiche sind Übersicht, Server, Module, Embed Studio und System.
- **Server Atlas:** Die Übersicht verwendet das echte Fallen-Heaven-Hintergrundbild und zeigt Community-Automation, Mitglieder/Kanäle, Nachrichtensystem und Laufzeit als verbundenes System statt als Kennzahlenkarten.
- **Operator Console:** Serververwaltung nutzt Objektliste, zentrale Arbeitsfläche und kontextbezogenen Inspector. Module werden als scanbares Systemledger mit Klartextstatus und letzter Aktion dargestellt.
- **Eigenständige Werkzeuge:** Das Embed Studio besitzt Outline, große Discord-Vorschau und Eigenschaftenleiste. Das System besitzt eine chronologische Betriebsspur mit Quelle, Wirkung und Aktion.

### Visuelle Regeln
- Grundfarben sind neutrales Tiefschwarz, Eisen, gebrochenes Weiß und Grau. Violett markiert Auswahl/Heaven Line, Grün Gesundheit, Gelb Hinweise und Rot kritische Zustände.
- Radien bleiben bei maximal 6 px. Paneele werden durch echte Arbeitsgrenzen und feine Linien getrennt; es gibt keine verschachtelten Karten, dekorativen Orbs oder großen generischen Farbverläufe.
- Die einzige expressive Signatur ist die `Heaven Line`, die aktive Navigation und Arbeitskontext verbindet. `prefers-reduced-motion` schaltet Animationen praktisch ab.
- Windows-lokale Schriften (`Bahnschrift`, `Segoe UI Variable`, `Cascadia Mono`) halten den Prototyp ohne Webfont-Abhängigkeit vollständig lokal nutzbar.

### Interaktionen und Prüfung
- Alle fünf Hauptansichten sind anklickbar. Atlas-Knoten springen in den passenden Bereich; Serverobjekte, Module, Studio-Layer und Systemereignisse aktualisieren ihren jeweiligen Detailbereich.
- Die Befehlspalette öffnet über den sichtbaren Befehlsknopf oder `Ctrl+K`, filtert Ziele und schließt per Escape.
- `scripts/fhcc-command-deck-preview-smoke.mjs` prüft Struktur, Domainbegriffe, Navigations-/Auswahlhooks, Responsive-Regeln, reduzierte Bewegung und das Fehlen abgelehnter generischer Muster.
- `scripts/fhcc-command-deck-preview-visual.mjs` öffnet die Datei mit Playwright/Chrome bei 1.440 x 1.000 und 390 x 844 Pixeln, klickt jede Ansicht, verlangt exakt eine sichtbare Arbeitsfläche, prüft die Befehlspalette, Browser-Konsole und horizontalen Dokument-Overflow.
- Die Desktop-Screenshots jeder Ansicht sowie Desktop-/Mobile-Abnahmen liegen als `docs/fhcc-command-deck-preview-*.png` vor. Die visuelle Nachprüfung führte zu zwei Nachbesserungen: stärkere Lesbarkeit des Atlas-Hintergrunds und korrekte Grid-Struktur der Systemknoten.
- Finaler Prüfstand: struktureller Smoke-Test grün; visuelle Prüfung aller fünf Ansichten auf Desktop und Mobil grün; keine Konsolenfehler und kein horizontaler Dokument-Overflow.

### Gothic-Luxury-Revision nach Nutzerfeedback
- Der erste Command-Deck-Prototyp war funktional korrekt, wurde vom Nutzer optisch aber verworfen: Navigation, Typografie und gleichfoermige Flaechen wirkten noch zu nah an der alten App. Folgeagenten duerfen diesen ersten Sci-Fi-/SaaS-Look nicht als freigegebene Richtung behandeln.
- Die ausdruecklich gewaehlte und anschliessend freigegebene Richtung ist **Gothic Luxury**. Der Prototyp traegt deshalb am `body` das maschinenlesbare Merkmal `data-aesthetic="gothic-luxury"`.
- Die aktuelle Palette besteht aus `Void #070608`, `Lacquer #0d0b0f`, `Ivory #efe9de`, `Silver #b8b3bb`, `Oxblood #6f2234`, `Amethyst #8d79aa` und `Emerald #3ead7b`. Silber ist Struktur, Amethyst Auswahl, Oxblood Gefahr/Eingriff und Smaragd ein gesunder Live-Zustand.
- Bedeutende Titel nutzen lokal `Bodoni MT`, Didot oder eine Serif-Fallbackschrift. Bedienung bleibt in `Segoe UI`, technische Werte in Monospace. Dadurch unterscheiden sich Markenebene, Bedienebene und Datenebene klar.
- Die Startansicht besitzt jetzt einen `cathedral-frame`, eine schmale dreifarbige `stained-slit`, gravierte Rahmen und das echte Fallen-Heaven-Hintergrundmotiv. Paneele und Schaltflaechen sind scharfkantig; die vorherigen weichen Dashboard-Karten und pillenartigen Auswahlzustaende wurden entfernt.
- Das Redesign ist weiterhin nur ein lokaler visueller/bedienbarer Prototyp. Es aendert keine produktive Electron-Datei und kein Bot-Verhalten. Eine Produktivmigration soll die vorhandenen Arbeitsablaeufe nacheinander uebernehmen, nicht das HTML blind kopieren.
- Der Smoke-Test verlangt nun explizit Gothic-Luxury-Marker, Bodoni-Typografie, Kathedralrahmen, stained-glass-Signatur und Oxblood-Token. Die Playwright-Pruefung klickt weiterhin alle fuenf Bereiche sowie die Befehlspalette und kontrolliert bei 1.440 x 1.000 sowie 390 x 844 Pixeln Konsole und horizontalen Overflow.
- Abnahme am 05.09.2026 nach der Revision: struktureller Smoke-Test gruen, alle fuenf Desktopansichten gruen, Mobile gruen, keine Browserfehler und kein horizontaler Dokument-Overflow.

## Aktivitäts-Liga: Monatsrollen durch gekoppelte Chat-/Voice-Vollständigkeit blockiert (2026-09-09)

### Nutzerbefund und belegte Produktionsdaten
- Am 09.09.2026 waren für den abgeschlossenen August keine Monatsrollen eingetragen, obwohl sehr viele historische Daten vorhanden sind.
- Der echte Store unter `%APPDATA%\FALLEN HEAVEN Control Center\runtime\data\activity-race.json` enthält für den Server `1276125977805721640` alle 31 Augusttage und insgesamt `26.159` aus dem Serverindex rekonstruierte Chatnachrichten.
- Die konfigurierte Aktivitäts-Liga ist aktiv und das Rollenset ist vollständig: Trenner plus je drei Chat-/Voice-Rollen für Tag, Woche und Monat, insgesamt 19 verschiedene Discord-Rollen-IDs.
- Der August-Chat hat anhand der echten gespeicherten Werte die Gewinner `892756196765888513`, `1279782547064360990` und `706231728553066566`.

### Ursache
- `completedPeriodSnapshot(...)` nutzte für Chat und Voice ausschließlich das gemeinsame Feld `trackingCompleteFrom` (`2026-08-04`). Da der abgeschlossene Monat am `2026-08-01` beginnt, galt der gesamte Monat als unvollständig.
- Sobald eine der beiden Quellen nicht den ganzen Zeitraum abdeckte, setzte die Funktion **sowohl** `chat` als auch `voice` auf leer. Der Rollenplan erhielt dadurch für sämtliche Monatsrollen leere Gewinnerlisten. Die vollständigen Chatdaten wurden also nicht wegen fehlender Werte, sondern wegen einer fachlich falschen Kopplung verworfen.
- Der Carl-bot-Kanal wurde automatisch als `1306078721840775290` erkannt und enthält `91.306` indexierte Lognachrichten seit 13.11.2024. Das ist viel Historie, aber die alten Embeds enthalten keine stabile Nutzer-ID: Join/Leave enthalten oft nur damalige Benutzernamen; Move-Embeds enthalten vor dem Formatwechsel teilweise überhaupt keine Person. Der aktuelle eindeutige Parser kann erst ab 06.08.2026 eine lückenlose Voice-Beweiskette garantieren. Diese alten uneindeutigen Logs dürfen nicht künstlich zu Voice-Monatssiegern werden.

### Fix
- Store-Schema `DATA_VERSION` wurde von 6 auf 7 erhöht. `normalizeGuildData(...)` führt nun `trackingCompleteFromByMetric.chat` und `.voice`; alte Stores migrieren rückwärtskompatibel zunächst vom bisherigen `trackingCompleteFrom`.
- Erfolgreiche vollständige Serverindex-Abgleiche markieren über `mergeIndexedChatDays(..., { rangeStart })` dauerhaft die früheste belegte Chat-Abdeckung. Erfolgreiche Carl-Log-Rekonstruktion markiert unabhängig davon die belegte Voice-Abdeckung.
- `completedPeriodSnapshot(...)` berechnet jetzt `fullyTrackedByMetric`. Chatwerte und Chatrollen werden nur von der Chat-Abdeckung gesteuert; Voicewerte und Voice-Rollen nur von der Voice-Abdeckung. Das zusammenfassende `fullyTracked` bleibt nur dann wahr, wenn beide Quellen vollständig sind.
- `historicalPanelPeriodSnapshot(...)` liefert dieselben getrennten Vollständigkeitsinformationen, damit UI/Diagnose die Datenlage korrekt erklären können.
- `reconcileRoles(...)` erzwingt genau dann einen vollständigen relevanten Indexlauf, wenn die persistierte Chat-Abdeckung den vergangenen Monatsbeginn noch nicht erreicht. Sobald der Marker geschrieben ist, laufen wieder ausschließlich die performanten kurzen Checkpoint-Fenster. Damit funktioniert die Migration auch nach einem Offline-Neustart ohne manuellen UI-Refresh.
- Der Regeltext erklärt nun ausdrücklich, dass Chat und Sprachchat getrennt vergeben werden und nur die jeweils unvollständige Messart übersprungen wird.

### Erwartetes Verhalten für August 2026
- Monats-Chat Platz 1 bis 3 werden nach dem ersten Rollenabgleich mit dem neuen Code vergeben.
- Monats-Voice bleibt für August bewusst leer, weil 01.-05.08. nicht eindeutig und vollständig Personen zugeordnet werden können. Der erste nachweislich vollständige Voice-Monat wird automatisch normal vergeben.
- Vollständige Daten einer Messart werden nie wieder durch die unvollständige andere Messart blockiert.

### Regression und Prüfung
- `scripts/activity-race-smoke.mjs` enthält einen RED/GREEN-Fall mit Chat-Abdeckung ab 01.08. und Voice-Abdeckung ab 04.08. Erwartung: drei Chatgewinner, keine Voicegewinner.
- Ein zweiter Test prüft, dass ein erfolgreicher Vollindex-Lauf seinen `rangeStart` als persistente Chat-Abdeckung markiert.
- RED vor dem Fix: `fullyTrackedByMetric.chat` war `undefined`; der alte Snapshot löschte beide Gewinnerlisten.
- GREEN nach dem Fix: `activity-race-smoke`, `activity-race-ping-preferences-smoke` und alle 16 Prüfgruppen von `voice-log-import-smoke` bestanden.
- `npm run test:quality` bestand vollständig, einschließlich Import-Audit, Qualitäts-/UI-Audits, Auto-Update, Interaction-Watchdog und Soak-Test. Der Soak bestätigte `113/113` Interaktionen mit maximal `2023,9658 ms` Ack-Latenz unter simulierter API-, SQLite-, Nachrichten- und I/O-Last.

### Release-Freigabe 3.9.308
- Die App-Version wurde von `3.9.307` auf `3.9.308` erhöht. `package.json`, `package-lock.json`, Renderer-Versionsersetzung und sämtliche produktiven Cache-Buster tragen dieselbe Version.
- `bot-changelog.json` enthält den echten 3.9.308-Eintrag: getrennte Chat-/Voice-Vollständigkeit, persistente Chat-Abdeckung, rückwärtskompatible Migration, August-Chatrollen aus den vorhandenen Daten und bewusstes Fail-closed für uneindeutige alte Voice-Logs.
- `npm run build:win` lief vollständig mit Exit-Code 0 durch: komplette `test:release`-Kette, NSIS-Build, Manifest-Erzeugung, Packaged-Runtime-Smoke, Artefakt-Audit und Dist-Cleanup.
- Der finale Release-Soak innerhalb der Build-Kette bestätigte `119/119` Interaktionen rechtzeitig; maximale Ack-Latenz `1841,4431 ms` unter simulierter Rollen-API-, SQLite-, Nachrichten-, I/O- und Sync-Stall-Last.
- Freigabe-Artefakt: `dist/FHCC-Setup-3.9.308-x64.exe`, `594.128.020` Bytes (`566,6 MiB`), SHA-256 `8571F023C65B73EE6A7B79206B7E51010A597732A063A17C38050D27ED2DEFAF`.
- `dist/latest.yml` trägt `version: 3.9.308`, verweist auf exakt diese EXE und enthält die geprüfte SHA-512 `xnXKwYMNFEzPY50g3dtQdCqsNjbKe0gL791DZjNdteKz6VXL2O4y0Y6/no981wXZcnfhzpXmONOOh+dAydJU3w==` sowie dieselbe Dateigröße.
- Packaged-Runtime-Smoke: Electron `43.2.0`, Node `24.18.0`, ABI `148`, Start ohne Discord-Verbindung und ohne Native-Modul-Fehler bestanden.
- Artefakt-Audit: `4.781` ASAR-Einträge, native SQLite-Datei `1.989.632` Bytes, `0` private Dateien und `0` Build-Reste paketiert.
- Beim ersten Bot-Start mit 3.9.308 bestätigt der Rollenabgleich den relevanten Indexzeitraum, persistiert für Chat `trackingCompleteFromByMetric.chat = 2026-08-01` und vergibt anschließend die drei August-Monats-Chatrollen. Dafür ist kein manueller Datenimport und kein Studio-Refresh nötig.
- Nicht blockierende Hinweise: Lokales CLI-Node `24.16.0` liegt unter der Empfehlung `24.17.0`; eine eigene Windows-Herausgeber-Signatur ist weiterhin nicht konfiguriert.

## Desktop-App: Start-Splash darf nie dauerhaft blockieren (2026-09-16)

### Befund
- In FHCC 3.9.310 konnte die Desktop-App beim Splash `SICHERE SITZUNG PRÜFEN` stehen bleiben, obwohl der lokale Dashboard-Dienst auf `127.0.0.1:3000` erreichbar war.
- Ursache war der Renderer-Startpfad: `getInfo()` und die Wiederherstellung der Discord-Sitzung wurden vor dem Freigeben der Oberfläche abgewartet. Einzelne IPC-/HTTP-Aufrufe hatten dabei keine Renderer-seitige Gesamtobergrenze; ein hängender Aufruf hielt deshalb `body.auth-restoring` und damit den vollständigen Splash sichtbar.

### Schutz
- `desktop/renderer/app.js` besitzt jetzt `withStartupStageTimeout(...)` mit einer festen Obergrenze von 12 Sekunden für kritische Startschritte.
- Sowohl `api.getInfo()` als auch `refreshAuth({ startup: true })` laufen durch diesen Schutz. Läuft einer fest, geht der bestehende Initialisierungsfehlerpfad weiter: Splash wird entfernt und die App bleibt mit eingeschränkter Oberfläche bedienbar statt dauerhaft blockiert.
- `/api/auth/me` und `/api/dashboard/schema` erhalten explizit 8-Sekunden-Timeouts. So wartet der Renderer nicht mehr auf den 30-Sekunden-Standard der Main-Process-Proxy-Anfrage.

### Regression
- `scripts/startup-splash-recovery-smoke.mjs` erzwingt die 12-Sekunden-Startobergrenze, beide umschlossenen Startschritte und die kurzen Auth-/Schema-Timeouts.
- Nach dem Fix bestanden der neue Smoke-Test, `node --check desktop/renderer/app.js`, Electron `--headless-renderer-check` und `--headless-document-check`.

## UI-Bedienelemente: Zustandskonsistenz (2026-09-19)

- Geaendert: `desktop/renderer/ui-system.css`, die aktuell zuletzt geladene CSS-Schicht. Bestehende Basis- und Aurora-Schichten bleiben notwendig; deren vollstaendige Migration ist noch offen.
- Gemeinsame Obsidian-Radien sind jetzt 6/8/8px. Modulkarten bewegen sich beim Hover nicht mehr vertikal; die Hervorhebung bleibt ueber Rahmen erhalten.
- Primaere und sekundaere Hover-Regeln schliessen deaktivierte Buttons aus. Finale Regeln entfernen Schatten, Filter, Bewegung und Transitionen fuer native disabled- und aria-disabled-Buttons. Wichtig: aria-disabled ist hier nur eine Darstellung; die Ausfuehrung muss weiterhin im jeweiligen Handler verhindert werden.
- Fokusmarkierung fuer Buttons, Links, Formfelder, Summary und fokussierbare Elemente vereinheitlicht. Die schon vorhandenen Markierungen fuer versteckte Toggle-Inputs bleiben bestehen.
- Lange Aktionslabels in Seitenkopf und Studio-Toolbar duerfen umbrechen und erhalten automatische Hoehe. Dies ersetzt keine vollstaendige Layoutpruefung aller Views.
- Reduced-motion-Regeln beruecksichtigen die hohe Spezifitaet historischer View-Regeln; aktive Views reduzieren Animationen und Transitionen.
- Neue Browserpruefung: `node scripts/ui-control-browser-smoke.mjs`. Verwendet die drei echten App-Stylesheets auf einem isolierten Komponentenfixture, ohne Discord-Verbindung oder Datenmutation. Testet Dark/Light bei 1280/390px: Tastaturfokus, deaktivierten Hover, stabile Modulkarte, langes Label und Reduced Motion.
- Abhaengigkeiten des Tests: gebuendeltes Playwright und Chrome; alternative Pfade ueber `FHCC_PLAYWRIGHT_MODULE` und `FHCC_CHROME_PATH`.
- Verifiziert: Browserpruefung, `ui-status-consistency-smoke.mjs` und `ui-field-audit.mjs` bestanden (494 Modulfelder, 279 feste UI-Elemente). Kein neuer Installer gebaut. Gesamte authentifizierte App und alle Panels noch nicht visuell abgenommen.

## General-Presence nach Neustart (2026-09-16)

### Befund
- Änderungen an `general.onlineStatus` wirkten direkt nach dem Speichern, gingen nach einem App-/Bot-Neustart aber scheinbar auf `online` zurück.
- `configCache` speichert Einträge als `{ value, expiresAt }`. Beim `ClientReady` wurde versehentlich der gesamte Cache-Eintrag als Presence-Konfiguration verwendet.
- Dadurch war `first.general` leer und `applyPresence()` fiel korrekt, aber unerwünscht, auf die Standardwerte zurück.

### Fix
- `activePresenceConfig` erhält beim Neustart jetzt `firstCachedEntry.value` statt des Wrappers.
- `applyPresence()` entpackt den Cache-Eintrag zusätzlich defensiv, falls kein aktiver Presence-Snapshot vorhanden ist.
- Relevante Prüfungen: `custom-rich-presence-smoke`, `ui-status-consistency-smoke`, `module-readiness-smoke` und Syntaxprüfung bestanden.
