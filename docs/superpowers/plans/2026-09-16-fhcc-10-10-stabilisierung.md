# FHCC Stabilisierung und 10/10-Qualität Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die FALLEN HEAVEN Control Center App soll stabil, nachvollziehbar, performant und releasefähig werden, ohne dass ein Modul oder Setting beim Umbau andere Systeme beschädigt.

**Architecture:** Bestehende Pfade werden zuerst konsolidiert und durch Regressionstests abgesichert. Bot-Prozessstatus, Discord-Presence, Modul-Config und Renderer-State bleiben getrennte Verantwortlichkeiten, werden aber über klare Datenverträge verbunden. Große Module behalten ihre Funktion, werden jedoch bei Polling, Discord-Abfragen, Cache-Nutzung und Rendering messbar begrenzt.

**Tech Stack:** Electron 43, Node.js 24 ESM/CJS, Express 5, discord.js 14, better-sqlite3, native Renderer-JavaScript, bestehende Smoke- und Release-Skripte.

## Global Constraints

- Botstatus darf nur vom Process-Supervisor und `client.isReady()` abgeleitet werden.
- Discord-Presence-Einstellungen müssen nach Speichern und nach Neustart aus derselben normalisierten Config stammen.
- Kein Modul darf durch eine fehlende API-Antwort, leere Config oder verspätete Discord-Abfrage den Renderer-Start blockieren.
- Keine Tokens, OAuth-Secrets, vollständigen Error-Stacks oder privaten Dateipfade im Dashboard anzeigen.
- Jede neue oder geänderte Funktion bekommt mindestens einen fokussierten Smoke-Test.
- Bestehende Benutzerdaten in `data/` und `runtime/` werden nicht gelöscht oder still migriert.
- Vor jedem Release müssen Lint, UI-Audit, Modultests, Packaged-Runtime und Artefakt-Audit erfolgreich sein.

## Datei- und Verantwortungsübersicht

- `src/index.js`: Bot-Lifecycle, Discord-Presence, Config-Cache und Runtime-Status.
- `desktop/main.cjs`: Electron-Fenster, Supervisor, Update-Installation und Renderer-Diagnose.
- `desktop/process-supervisor.cjs`: Start, Stop, Restart und Prozessgesundheit.
- `desktop/renderer/app.js`: zentraler UI-State, Config-Laden, Modulstatus und Hauptnavigation.
- `desktop/renderer/module-config-inputs.js`: alle dynamischen Feldtypen und Discord-Ressourcen-Auswahlen.
- `src/defaultConfig.js`: normalisierte Defaults, Migrationen und Modul-Feldkatalog.
- `src/features/*.js`: einzelne Discord-Module.
- `scripts/*.mjs|*.cjs`: fokussierte Regression-, UI- und Release-Prüfungen.
- `PROJEKT-WISSEN.md`: dauerhafte technische Entscheidungen, Fehlerursachen und Betriebsregeln.

---

### Phase 1: Qualitätsbasis und Regressionen

**Dateien:**
- Modify: `scripts/ui-field-audit.mjs`
- Modify: `scripts/startup-splash-recovery-smoke.mjs`
- Create: `scripts/bot-status-presence-regression-smoke.mjs`
- Modify: `package.json`
- Modify: `PROJEKT-WISSEN.md`

- [ ] Status-Smoke für Cache-Wrapper, `active/ready/degraded`, `general.onlineStatus` und Neustartwerte schreiben.
- [ ] Status-Smoke rot gegen absichtlich falsche Cache-/Fallback-Auswertung ausführen.
- [ ] Status-Smoke grün gegen den korrigierten Code ausführen.
- [ ] UI-Audit und Splash-Smoke ausführen; Erwartung: 494 Felder, 0 UI-Feldfehler, keine permanente Splash-Sperre.
- [ ] Cache-Regel und Statusdefinition im Projektwissen dokumentieren.
- [ ] Commit: `test: cover bot and presence startup state`.

---

### Phase 2: Einheitlicher Settings- und Statusvertrag

**Dateien:**
- Modify: `src/defaultConfig.js`
- Modify: `src/index.js`
- Modify: `src/dashboard.js`
- Modify: `desktop/renderer/app.js`
- Modify: `desktop/renderer/module-config-inputs.js`
- Create: `scripts/module-settings-roundtrip-smoke.mjs`
- Create: `scripts/bot-status-ui-contract-smoke.mjs`

**Vertrag:**
- `GET /api/config/:guildId` liefert eine vollständig normalisierte Config.
- `PUT /api/config/:guildId` liefert exakt die gespeicherte normalisierte Config zurück.
- `GET /api/app/system/status` liefert `active`, `ready`, `phase` und eine verständliche Nachricht.
- Renderer verwendet für Modulansicht und Studio ausschließlich `state.config`.

- [ ] Roundtrip-Test für `general.statusMessage`, `general.statusType`, `general.onlineStatus`, `general.timezone` und `general.autoBackupMinutes` schreiben.
- [ ] Roundtrip-Test zunächst rot ausführen und den konkreten Vertragsbruch dokumentieren.
- [ ] Normalisierung als zentrale Quelle in `src/defaultConfig.js` bestätigen und doppelte Renderer-Fallbacks entfernen.
- [ ] Status-UI nur aus `active === true && ready === true` ableiten; Presence separat anzeigen.
- [ ] Focused Tests ausführen: Roundtrip, Status-UI, Rich-Presence, UI-Consistency.
- [ ] Commit: `fix: unify module settings and runtime status`.

---

### Phase 3: Performance der schweren Module

**Dateien:**
- Modify: `src/features/activityRace.js`
- Modify: `src/features/levels.js`
- Modify: `src/features/heavenEconomy.js`
- Modify: `src/features/tempVoice.js`
- Modify: `src/features/publicCallVote.js`
- Modify: `src/runtime/memberActivity.js`
- Create: `scripts/module-performance-smoke.mjs`
- Modify: `package.json`

- [ ] Baseline mit 1.000 Mitgliedern, 200 Channels, 100 Rollen und 10.000 Aktivitätsdatensätzen messen.
- [ ] Budgets festlegen: maximal 50 parallele Discord-Operationen, ein Refresh pro Modul, kein Vollabruf bei jedem UI-Poll.
- [ ] Activity-Race/Levels mit Snapshot-Signatur und getrenntem Role-Reconcile ausstatten.
- [ ] Economy-Transaktionen atomar lassen und TempVoice-Mutationen pro User serialisieren.
- [ ] Public-Call-Komponenten vor dem Payload normalisieren; leere Labels auf sichere Defaults setzen.
- [ ] Performance-Smoke ausführen und Query-Anzahl, Batch-Größe und Laufzeit protokollieren.
- [ ] Commit: `perf: bound heavy module refresh and reconciliation`.

---

### Phase 4: UI-Konsolidierung und End-to-End-Prüfung

**Dateien:**
- Modify: `desktop/renderer/app.js`
- Modify: `desktop/renderer/index.html`
- Modify: `desktop/renderer/ui-base.css`
- Modify: `desktop/renderer/ui-aurora.css`
- Modify: `desktop/renderer/ui-system.css`
- Modify: `desktop/renderer/live-diagnostics.js`
- Create: `scripts/ui-e2e-critical-path-smoke.mjs`
- Modify: `scripts/ui-visual-audit.py`

- [ ] Kritische Flows für Login, General, Rich Presence, TempVoice, Levels, Counting und Embed Studio testen.
- [ ] Aktive Toggles, gespeicherte Werte, Offline-Zustand und Presence-Zustand getrennt visualisieren.
- [ ] Desktopgrößen 1440x900 und 1280x720 sowie 390px Breite auf Überlappung, Overflow und fehlende Dropdowns prüfen.
- [ ] Studio-Vorschau und gesendeten Embed-Payload auf identische Texte, Bilder, Felder und Buttons prüfen.
- [ ] E2E- und Visual-Audit ausführen.
- [ ] Commit: `fix: unify control center interaction states`.

---

### Phase 5: Release-Gate

**Dateien:**
- Modify: `package.json`
- Modify: `PROJEKT-WISSEN.md`
- Modify: `bot-changelog.json`
- Create: `scripts/final-quality-report.mjs`

- [ ] `npm run lint`: 0 Errors; verbleibende Warnungen klassifizieren und begründen.
- [ ] `node scripts/ui-field-audit.mjs`: PASS.
- [ ] `npm run test:quality` und `npm run test:community`: PASS.
- [ ] `python scripts/ui-visual-audit.py`: PASS.
- [ ] Packaged-Runtime und Artefakt-Audit: PASS.
- [ ] Echten Start, Stop, Neustart, Settings-Save und Presence-Recovery mit `dist/win-unpacked/FHCC.exe` testen.
- [ ] Erst danach Installer bauen, Manifest erzeugen und SHA-512/SHA-256 prüfen.
- [ ] Finalbericht mit Modulscore, bekannten Restwarnungen und Release-Artefakt erzeugen.
- [ ] Commit: `chore: establish final release quality gate`.

## 10/10-Kriterien

- Keine reproduzierbaren Start-, Stop-, Save- oder Settings-Recovery-Fehler.
- Sichtbare UI-Zustände entsprechen dem echten Runtime-Zustand.
- Keine ungebremsten Polling- oder Discord-Abfrageketten.
- Alle 494 Modulfelder sind erreichbar, editierbar und rücklesbar.
- Keine konkurrierenden Fallback-Pfade für Status oder Config.
- Installer aktualisiert ohne Windows-Dateisperren.
- Jede größere Änderung ist durch einen fokussierten Test dokumentiert.

## Self-Review

Der Plan trennt Qualitätsbasis, Settingsvertrag, Performance, UI und Release. Die bekannten Presence-, Splash-, UI-Feld- und Update-Probleme sind explizit abgedeckt. Die verbleibenden 160 Warnungen werden nicht blind ignoriert, sondern vor der 10/10-Freigabe klassifiziert oder behoben.

