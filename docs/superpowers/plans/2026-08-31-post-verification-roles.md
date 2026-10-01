# Rollen nach Verifizierung Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mehrere konfigurierbare Basisrollen nach Entfernung der Unverified-Rolle sofort und nach Bot-Ausfaellen beim Start vergeben.

**Architecture:** Das vorhandene Welcome/Farewell-Feature bleibt Besitzer des Verifizierungsereignisses. Ein fokussierter Rollenhelfer nutzt den zentralen `applyManagedRolePolicy`; ein Single-Flight-Startabgleich verarbeitet nur Mitglieder, denen Zielrollen fehlen, mit begrenzter Parallelitaet.

**Tech Stack:** Node.js ESM, discord.js, bestehender Managed Role Service, assert-basierte Smoke-Tests.

## Global Constraints

- Kein periodischer Mitgliedervollscan.
- Welcome-Nachricht und Rollenvergabe muessen unabhaengig schaltbar sein.
- Bots und Mitglieder mit Unverified-Rolle duerfen keine Zielrollen erhalten.
- Bestehende fremde Arbeitskopie-Aenderungen bleiben unangetastet.

---

### Task 1: Verhalten testgetrieben festlegen

**Files:**
- Modify: `scripts/welcome-verification-smoke.mjs`

**Interfaces:**
- Consumes: `feature.onGuildMemberUpdate`, `feature.onClientReady`
- Produces: Regressionserwartungen fuer Live- und Startabgleich

- [ ] Mehrfachrollenvergabe bei echtem Entzug testen.
- [ ] Rollenvergabe bei deaktivierter Welcome-Nachricht testen.
- [ ] Folgeupdate, Bot und bereits vollstaendige Mitglieder als No-op testen.
- [ ] Startabgleich fuer ein waehrend der Offline-Zeit verifiziertes Mitglied testen.
- [ ] `node scripts/welcome-verification-smoke.mjs` ausfuehren und das erwartete Fehlschlagen bestaetigen.

### Task 2: Konfiguration und Rollenlogik implementieren

**Files:**
- Modify: `src/defaultConfig.js`
- Modify: `src/features/defaultConfig.js`
- Modify: `src/features/welcomeFarewell.js`
- Modify: `src/runtime/moduleReadiness.js`

**Interfaces:**
- Consumes: `applyManagedRolePolicy({ member, addRoleIds, reason, verify, requireAll })`
- Produces: `assignPostVerificationRoles(member, conf, source)` und `reconcilePostVerificationRoles(guild, conf)`

- [ ] UI-Felder und Defaults fuer Schalter sowie Mehrfachrollenauswahl ergaenzen.
- [ ] Zielrollen normalisieren und fehlende Rollen je Mitglied bestimmen.
- [ ] Live-Ereignispfad von der Welcome-Nachricht entkoppeln.
- [ ] Single-Flight-Startabgleich mit begrenzzter Parallelitaet implementieren.
- [ ] Bereitschaftspruefung um bedingte Pflichtfelder erweitern.
- [ ] Smoke-Test erneut ausfuehren und gruen bestaetigen.

### Task 3: Gesamtsystem dokumentieren und verifizieren

**Files:**
- Modify: `PROJEKT-WISSEN.md`
- Modify: `bot-changelog.json`

**Interfaces:**
- Consumes: implementiertes Verhalten und Testergebnisse
- Produces: nachvollziehbares Projektwissen fuer nachfolgende Agenten

- [ ] Architektur, Ereignisfluss, Neustartverhalten und Performance dokumentieren.
- [ ] Changelog-Eintrag fuer die neue Funktion ergaenzen.
- [ ] Welcome-Smoke, Community-Suite und relevante Qualitaetspruefungen ausfuehren.
