# Heaven Economy VIP-Vorteile-Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Heaven-Economy-Hauptpanel wird zu einem voll editierbaren VIP-Vorteile-Embed mit sieben echten Funktionsbuttons und ohne separaten VIP-Vorteile-Button.

**Architecture:** `heavenEconomy.panelTemplate` ist die einzige Inhaltsquelle des kanonischen Economy-Panels. `ensurePanel(...)` rendert diese Vorlage und haengt immer `buildHeavenEconomyComponents(cfg)` an; das Embed Studio speichert die Vorlage ueber einen eigenen persistenten Design-Endpunkt und wartet auf den Live-Abgleich.

**Tech Stack:** Node.js ESM, discord.js, Electron-Renderer, Express-Dashboard, JSON-Guild-Config, bestehendes Embed Studio und Smoke-Tests.

## Global Constraints

- Genau ein oeffentliches VIP-Vorteile-Panel pro Guild.
- Kein Discord-Button `VIP-Vorteile` und kein neuer Ersatzbutton.
- Coin-Geschenke deaktiviert: Button verschwindet; alle anderen sechs Funktionen bleiben.
- Panelinhalt und funktionale Komponenten bleiben getrennt.
- Bestehende Guild-Konfigurationen erhalten einen vollstaendigen Standard ohne Datenverlust.
- Live-Refresh-Fehler werden sichtbar gemeldet, waehrend die gespeicherte Vorlage erhalten bleibt.
- Bestehende fremde Workspace-Aenderungen werden nicht zurueckgesetzt.

---

### Task 1: Panelvorlage und Komponentenvertrag

**Files:**
- Modify: `src/defaultConfig.js`
- Modify: `src/features/heavenEconomy.js`
- Modify: `scripts/heaven-economy-admin-smoke.mjs`
- Modify: `scripts/heaven-economy-ui-smoke.mjs`

**Interfaces:**
- Produces: `heavenEconomy.panelTemplate`, `normalizeEconomyPanelTemplate(template)` und ein Komponentenarray mit sechs oder sieben Buttons.

- [x] **Step 1: Failing tests schreiben**

Tests fordern eine Default-`panelTemplate`, sieben Buttons ohne `fh_coin:perks`, sechs Buttons bei deaktivierten Coin-Geschenken und `coinGiftMaxAmount >= coinGiftMinAmount`.

- [x] **Step 2: RED ausfuehren**

Run: `node scripts/heaven-economy-admin-smoke.mjs && node scripts/heaven-economy-ui-smoke.mjs`
Expected: FAIL wegen fehlender Panelvorlage bzw. vorhandenem Vorteile-Button.

- [x] **Step 3: Minimale Implementierung**

Default und Normalisierung fuer `panelTemplate` ergaenzen, `perksButtonLabel` aus sichtbarer Konfiguration und Komponenten entfernen, deaktivierte Coin-Geschenke filtern und Min/Max gemeinsam klemmen.

- [x] **Step 4: GREEN ausfuehren**

Run: `node scripts/heaven-economy-admin-smoke.mjs && node scripts/heaven-economy-ui-smoke.mjs`
Expected: beide Tests bestehen.

### Task 2: Kanonischer Panel-Renderer und sicherer Live-Abgleich

**Files:**
- Modify: `src/features/heavenEconomy.js`
- Create: `scripts/heaven-economy-panel-studio-smoke.mjs`

**Interfaces:**
- Produces: `buildHeavenEconomyPanelPayload(cfg)`, `saveHeavenEconomyPanelDesign({ guild, cfg, template, channelId })` und serialisierten `ensurePanel(...)`-Abgleich.

- [x] **Step 1: Failing Panel-Test schreiben**

Der Test verlangt freie Embed-Felder, genau sieben echte Buttons, Edit einer bestehenden Nachricht, einmalige Neuerstellung einer geloeschten Nachricht und nur einen Send bei parallelen Refreshes.

- [x] **Step 2: RED ausfuehren**

Run: `node scripts/heaven-economy-panel-studio-smoke.mjs`
Expected: FAIL, weil Export und Save-Schnittstelle fehlen.

- [x] **Step 3: Renderer und Save implementieren**

Vorlage normalisieren, Platzhalter `{server}`, `{coinEmoji}` und `{boostMilestoneReward}` rendern, genau ein Embed bauen, Komponenten zentral anhaengen und Refreshes pro Guild serialisieren.

- [x] **Step 4: Reparatur und Fehlervertrag implementieren**

Vorhandene Message editieren; bei Discord-Unknown-Message eine neue senden; neue Message-ID speichern; Save-Ergebnis mit `liveUpdated`, `messageId` und einem klaren Refreshfehler zurueckgeben.

- [x] **Step 5: GREEN ausfuehren**

Run: `node scripts/heaven-economy-panel-studio-smoke.mjs`
Expected: alle Panel-, Parallelitaets- und Reparaturpruefungen bestehen.

### Task 3: API und Embed-Studio

**Files:**
- Modify: `src/index.js`
- Modify: `src/dashboard.js`
- Modify: `desktop/renderer/app.js`
- Modify: `scripts/heaven-economy-ui-smoke.mjs`

**Interfaces:**
- Consumes: `saveHeavenEconomyPanelDesign(...)` aus Task 2.
- Produces: `PUT /api/guild/:guildId/heaven-economy/panel-design` und Studio-Modus `economyPanel`.

- [x] **Step 1: Failing UI/API-Test ergaenzen**

Der Test fordert Endpoint, Studio-Einstieg `VIP-Vorteile-Panel bearbeiten`, Preview-Platzhalter und Save-Weiterleitung ohne frei speicherbare Komponenten.

- [x] **Step 2: RED ausfuehren**

Run: `node scripts/heaven-economy-ui-smoke.mjs`
Expected: FAIL wegen fehlendem Endpoint und Studio-Modus.

- [x] **Step 3: Backend-Save verdrahten**

`persistEmbedDesign(...)` speichert `panelTemplate` und `panelChannelId`; der Live-Refresh nutzt denselben `ensurePanel(...)`-Pfad und gibt seinen echten Status zurueck.

- [x] **Step 4: Studio-Ansicht verdrahten**

Vorlage laden, Vorschauwerte rendern, genau ein Embed validieren, zum neuen Endpoint speichern und die App-Rueckmeldung aus dem Live-Status bilden.

- [x] **Step 5: GREEN ausfuehren**

Run: `node scripts/heaven-economy-ui-smoke.mjs && node scripts/heaven-economy-panel-studio-smoke.mjs`
Expected: UI und Backend sind vollstaendig verbunden.

### Task 4: Regression, Wissen und Windows-Update

**Files:**
- Modify: `package.json`
- Modify: `PROJEKT-WISSEN.md`
- Modify: `bot-changelog.json`
- Modify: `docs/superpowers/plans/2026-08-27-heaven-economy-benefits-panel.md`
- Modify: versionierte Dateien ueber `scripts/bump-version.cjs`

**Interfaces:**
- Consumes: alle vorherigen Tasks.
- Produces: getestete Patch-Version und freigegebenen Windows-Installer.

- [x] **Step 1: Panel-Test in `test:economy` aufnehmen**

Run: `npm run test:economy`
Expected: gesamte Economy-Suite besteht inklusive Panel-Studio-Test.

- [x] **Step 2: Projektwissen aktualisieren**

Datenquelle, Komponentenvertrag, Migration, Panel-Reparatur, API, Studio und Diagnosebefehle detailliert dokumentieren.

- [x] **Step 3: Patch-Version erhoehen**

Run: `node scripts/bump-version.cjs`
Expected: Paket, Lockfile, Renderer-Cache-Buster und Changelog-Ziel verwenden dieselbe neue Version.

- [x] **Step 4: Release bauen**

Run: `npm run build:win`
Expected: Release-Suite, NSIS-Build, Packaged-Runtime und Artefakt-Audit bestehen.

- [x] **Step 5: Artefakt unabhaengig pruefen**

Version, Dateigroesse, SHA-256 und `dist/latest.yml` abgleichen und die Freigabedaten in `PROJEKT-WISSEN.md` eintragen.
