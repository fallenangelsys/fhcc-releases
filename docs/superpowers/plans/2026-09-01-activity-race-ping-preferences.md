# Activity Race Ping Preferences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persoenliche Liga-Pings standardmaessig aktiv lassen und jedem Mitglied einen persistenten, sicheren Ein-/Aus-Schalter in einem frei editierbaren vierten Info-Panel geben.

**Architecture:** `activityRace.js` bleibt Besitzer von Ranking, Pingversand, Panel-Ledger und Interaktionen. Opt-outs liegen im vorhandenen atomaren Guild-Store; der Pingpfad verwendet konstante Lookups. Das vorhandene Activity-Race-Studio erhaelt einen expliziten `ping-info`-Abschnitt, waehrend der Backend-Save-Pfad den echten Toggle-Button stets serverseitig ergaenzt.

**Tech Stack:** Node.js ESM, discord.js, Electron Renderer, bestehender Atomic JSON Store und Embed-Studio-Pipeline, assert-basierte Smoke-Tests.

## Global Constraints

- Standardzustand fuer jedes Mitglied ist Ping aktiviert.
- Nur ausdrueckliche Opt-outs werden gespeichert.
- Kein Mitgliederscan, keine Discord-Rolle und kein periodischer Timer fuer Ping-Einstellungen.
- Das Info-Panel bleibt eine eigene Nachricht unter den drei Ranking-Nachrichten.
- Der aktuelle Funktionsbutton kann durch Studio-Daten weder entfernt noch dupliziert werden.
- Bestehende fremde Aenderungen in der Arbeitskopie bleiben erhalten.

---

### Task 1: Persistente Einstellung und Pingfilter

**Files:**
- Modify: `scripts/activity-race-smoke.mjs`
- Modify: `src/features/activityRace.js`

**Interfaces:**
- Produces: `isPlacementPingEnabled(data, userId) -> boolean`
- Produces: `setPlacementPingEnabled(guildId, userId, enabled) -> Promise<boolean>`
- Consumes: `guildData(guildId)` und `scheduleSave()`

- [ ] Test fuer Default-an und persistierten Opt-out schreiben.
- [ ] Test fuer Filter vor Versand und fehlenden Cooldown schreiben.
- [ ] Tests rot ausfuehren.
- [ ] `pingOptOuts` normalisieren und Toggle-Helfer implementieren.
- [ ] `sendPlacementPings` vor Gruppierung und direkt vor Versand filtern.
- [ ] Tests gruen ausfuehren.

### Task 2: Sicherer Discord-Button

**Files:**
- Modify: `scripts/activity-race-smoke.mjs`
- Modify: `src/features/activityRace.js`

**Interfaces:**
- Produces: `buildPingInfoComponents(conf) -> ActionRowBuilder[]`
- Produces: `handlePingPreferenceButton(interaction, cfg, guild) -> Promise<void>`
- Consumes: aktuelle `data.panel.pingInfo`-Nachrichtenreferenz

- [ ] Test fuer echten Toggle und klare ephemeral Antwort schreiben.
- [ ] Test fuer veraltete Nachricht und Bot-No-op schreiben.
- [ ] Tests rot ausfuehren.
- [ ] Buttonhandler mit fruehem Acknowledge und Nachrichtenvalidierung implementieren.
- [ ] Handler in `onAnyInteraction` registrieren und Tests gruen ausfuehren.

### Task 3: Viertes editierbares Info-Panel

**Files:**
- Modify: `scripts/activity-race-smoke.mjs`
- Modify: `src/features/activityRace.js`
- Modify: `src/defaultConfig.js`
- Modify: `src/features/defaultConfig.js`

**Interfaces:**
- Produces: `buildPingInfoPayload(guild, conf, options) -> Discord payload`
- Extends: `data.panel.pingInfo = { channelId, messageId }`
- Consumes: `activityRace.pingInfoDesign`, `activityRace.pingToggleButtonLabel`

- [ ] Payload-Test fuer Content, mehrere Embeds, Bilder, Aussenbild und genau einen Funktionsbutton schreiben.
- [ ] Panel-Ledger- und Reihenfolgetest schreiben.
- [ ] Tests rot ausfuehren.
- [ ] Defaults, Normalisierung, Payload und Ensure-/Remove-Pfade implementieren.
- [ ] Info-Panel nur nach spaeter neu gesendeten Perioden-Panels kontrolliert neu erstellen.
- [ ] Tests gruen ausfuehren.

### Task 4: Studio und App-UI

**Files:**
- Modify: `desktop/renderer/activity-race-studio.js`
- Modify: `desktop/renderer/app.js`
- Modify: `src/index.js`
- Modify: `scripts/activity-race-smoke.mjs`

**Interfaces:**
- Extends: Studio-Abschnitt `ping-info`
- Extends: `/api/guild/:guildId/activity-race/design`-Payload um `section: "ping-info"`
- Produces: App-Befehl `data-activity-race-open-studio="ping-info"`

- [ ] Strukturtest fuer vierten Studio-Button und Abschnitt schreiben.
- [ ] Save-/Reload-Test fuer `pingInfoDesign` schreiben.
- [ ] Tests rot ausfuehren.
- [ ] Studio-Vorlage, Preview, Save-Routing und Backend-Persistenz implementieren.
- [ ] Uebersichtstext auf drei Rankings plus Info-Panel korrigieren.
- [ ] Tests und UI-Audit gruen ausfuehren.

### Task 5: Dokumentation und Release

**Files:**
- Modify: `PROJEKT-WISSEN.md`
- Modify: `bot-changelog.json`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: naechste Patch-Version, NSIS-Installer und `dist/latest.yml`

- [ ] Datenfluss, Sicherheitspruefung, Panel-Reihenfolge, Studio und Performance detailliert dokumentieren.
- [ ] Changelog und Patch-Version aktualisieren.
- [ ] `npm run test:community`, `npm run test:quality` und `git diff --check` ausfuehren.
- [ ] `npm run build:win` ausfuehren.
- [ ] Installer, SHA-256, Manifest, Packaged Runtime, ASAR-Audit und Interaktions-Soak in `PROJEKT-WISSEN.md` festhalten.
