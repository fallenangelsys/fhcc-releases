# Coin Gifts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mitglieder koennen Heaven Coins sicher, ohne Gebuehr und ohne Tageslimit an andere Servermitglieder verschenken und beide Seiten erhalten voll editierbare DM-Embeds.

**Architecture:** Ein persistenter, kurzlebiger Geschenkauftrag enthaelt Empfaenger, Betrag und optionale Nachricht. Die Bestaetigung fuehrt genau eine serialisierte Mutation aus, die beide Konten, Statistiken, Wiederholungsschutz und einen gemeinsamen Audit-Eintrag atomar aktualisiert; Discord-DMs und Logs folgen erst nach erfolgreicher Buchung.

**Tech Stack:** Node.js ESM, discord.js, JSON-Persistenz, Electron-Renderer, vorhandenes Embed Studio, Smoke-Tests.

## Global Constraints

- Sofortiger Transfer ohne Annahme, Gebuehr oder Tageslimit.
- Nur ganze positive Betraege; Selbstgeschenke, Bots und serverfremde Nutzer sind gesperrt.
- Der Bestaetigungs-Custom-ID vertraut weder Betrag noch Empfaenger, sondern nur einem gespeicherten Einmal-Token.
- DM- und Log-Fehler duerfen eine erfolgreiche Buchung nicht rueckgaengig machen.
- Persoenliche Nachrichten werden nach der Buchung nicht dauerhaft gespeichert oder geloggt.
- Bestehende nicht zugehoerige Workspace-Aenderungen bleiben unangetastet.

---

### Task 1: Transfer-Vertrag und Persistenz

**Files:**
- Modify: `src/features/heavenEconomy.js`
- Test: `scripts/heaven-economy-coin-gift-smoke.mjs`

**Interfaces:**
- Produces: `createCoinGiftIntent(...)`, `completeCoinGiftTransfer(...)` und normalisierte Kontofelder `giftedCoins`/`receivedGiftCoins`.

- [x] Einen fehlschlagenden Smoke-Test fuer Migration, Auftragserstellung, Ablaufzeit, atomare Doppelbuchungssperre und Summenerhaltung schreiben.
- [x] Den Test ausfuehren und das erwartete Fehlen der Transfer-Schnittstellen bestaetigen.
- [x] Economy-Daten auf Version 3 migrieren, Geschenkauftraege normalisieren und alte Auftraege entfernen.
- [x] Auftragserstellung und atomare Bestaetigung mit aktueller Kontostandspruefung implementieren.
- [x] Test erneut ausfuehren und alle Transferfaelle bestehen lassen.

### Task 2: Discord-Interaktion

**Files:**
- Modify: `src/features/heavenEconomy.js`
- Test: `scripts/heaven-economy-coin-gift-smoke.mjs`

**Interfaces:**
- Consumes: Transfer-Schnittstellen aus Task 1.
- Produces: `fh_coin:coin-gift`, Benutzerwahl, Betragsmodal, Bestaetigen/Abbrechen und ephemere Quittung.

- [x] Fehlschlagende Tests fuer Button, Empfaengerfilter, Modalvalidierung, Bestaetigungsdaten und Abbruch schreiben.
- [x] Tests ausfuehren und die fehlenden Komponenten bestaetigen.
- [x] Den neuen Button in das vorhandene Funktionsset integrieren und den Drei-Schritt-Ablauf implementieren.
- [x] Vor der Buchung Mitgliedschaft, Botstatus, Betrag, Kontostand und Empfaengerlimit erneut pruefen.
- [x] Interaktionstests erneut ausfuehren.

### Task 3: DM-Embeds und Audit

**Files:**
- Modify: `src/features/heavenEconomy.js`
- Modify: `scripts/heaven-economy-vip-dm-smoke.mjs`
- Test: `scripts/heaven-economy-coin-gift-smoke.mjs`

**Interfaces:**
- Produces: Sektionen `coinGiftReceived`/`coinGiftSent` und Platzhalter fuer beide Kontostaende, Nachricht und Transaktionsnummer.

- [x] Fehlschlagende Tests fuer beide Vorlagen, Feld-Platzhalter, neue DM pro Transaktion und DM-unabhaengige Buchung schreiben.
- [x] Tests ausfuehren und die fehlenden Sektionen sowie verworfenen Felder bestaetigen.
- [x] Economy-DM-Normalisierung und Rendering um bis zu 25 Felder und neue Transferplatzhalter erweitern.
- [x] Nach erfolgreicher Buchung beide DMs mit `forceNew` senden und ein Log ohne persoenliche Nachricht erzeugen.
- [x] DM- und Transfer-Tests erneut ausfuehren.

### Task 4: Konfiguration und Desktop-App

**Files:**
- Modify: `src/defaultConfig.js`
- Modify: `desktop/renderer/app.js`
- Modify: `desktop/renderer/index.html`
- Modify: `scripts/heaven-economy-ui-smoke.mjs`
- Modify: `scripts/heaven-economy-admin-smoke.mjs`

**Interfaces:**
- Produces: Schalter, Mindest-/Hoechstbetrag, Buttonlabel, zwei Studio-Einstiege, Vorschauplatzhalter und lesbare Auditdaten.

- [x] Fehlschlagende UI- und Konfigurationstests fuer alle neuen Bedienelemente schreiben.
- [x] Tests ausfuehren und die fehlenden Oberflaechen bestaetigen.
- [x] Standardwerte und Normalisierung fuer `coinGiftsEnabled`, `coinGiftMinAmount`, `coinGiftMaxAmount` und `coinGiftButtonLabel` ergaenzen.
- [x] Zwei DM-Kacheln, Studio-Hilfe, Vorschauwerte sowie Konto-/Auditdarstellung ergaenzen.
- [x] UI- und Admin-Tests erneut ausfuehren.

### Task 5: Regression, Wissen und Release

**Files:**
- Modify: `package.json`
- Modify: `PROJEKT-WISSEN.md`
- Modify: `bot-changelog.json`
- Modify: version files selected by `scripts/bump-version.cjs`

**Interfaces:**
- Consumes: alle vorherigen Tasks.
- Produces: reproduzierbare Tests, dokumentierte Architektur und freigabefaehiges Windows-Artefakt.

- [x] Den neuen Smoke-Test in `test:economy` aufnehmen und die gesamte Economy-Suite ausfuehren.
- [x] Syntax-/Importpruefung und relevante UI-Qualitaetspruefungen ausfuehren.
- [x] Projektwissen mit Datenmodell, Ablauf, Platzhaltern, Fehlerverhalten und Testbefehlen aktualisieren.
- [x] Version mit dem vorhandenen Skript erhoehen und Changelog ergaenzen.
- [x] Die Windows-EXE mit dem vorhandenen Release-Befehl bauen und das Artefakt verifizieren.
