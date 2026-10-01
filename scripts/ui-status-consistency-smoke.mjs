#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const html = read('desktop', 'renderer', 'index.html');
const app = read('desktop', 'renderer', 'app.js');
const systemCss = read('desktop', 'renderer', 'ui-system.css');
const problems = [];
const expect = (condition, message) => { if (!condition) problems.push(message); };

expect(html.includes('id="module-page-total"'), 'Der Modulstatus muss aktive und gesamte Module getrennt anzeigen.');
expect(app.includes("setText('module-page-total'"), 'Die Gesamtzahl der Module wird nicht aktualisiert.');
expect(app.includes('enableAll.disabled = allEnabled || !state.authenticated || catalog.length === 0'), '„Alle aktivieren“ wird bei vollständig aktivem Stand nicht deaktiviert.');
expect(app.includes("enableAll.textContent = allEnabled ? 'Alle aktiv' : 'Alle aktivieren'"), 'Der Sammelbutton erklärt den vollständigen Zustand nicht.');
expect(app.includes("toggle.setAttribute('aria-pressed', String(enabled))"), 'Modulschalter geben ihren Aktivzustand nicht zugänglich aus.');

expect(systemCss.includes('.module-card.enabled .module-toggle'), 'Die letzte CSS-Schicht gestaltet aktive Modulschalter nicht explizit.');
expect(systemCss.includes('.module-card.enabled .module-toggle i::after'), 'Aktive Modulschalter besitzen keine eindeutige Hakenmarkierung.');
expect(!systemCss.includes('.module-toggle:checked'), 'Ein Button wird fälschlich mit dem Checkbox-Pseudostatus :checked angesprochen.');
expect(!systemCss.includes('body[data-theme="light"] body.authenticated'), 'Hellmodus-Regeln enthalten einen unmöglichen verschachtelten body-Selektor.');
expect(systemCss.includes('--o-text: #1c2030'), 'Der Hellmodus überschreibt die dunklen Obsidian-Texttokens nicht und erzeugt Weiß-auf-Weiß-Flächen.');
expect(systemCss.includes('Light contrast authority'), 'Die letzte CSS-Schicht besitzt keinen vollständigen Hellmodus-Kontrastschutz.');
expect(systemCss.includes('Light ID-level heading authority'), 'ID-spezifische Alt-Styles können Seitenüberschriften im Hellmodus weiterhin unsichtbar machen.');
expect(systemCss.includes('.fh-metric strong'), 'Dashboard-Kennzahlen werden im Hellmodus nicht gegen Weiß-auf-Weiß geschützt.');
expect(systemCss.includes('Appweite boolesche Schalter'), 'Die finale CSS-Schicht besitzt kein einheitliches Design für Ein/Aus-Schalter.');
expect(systemCss.includes('content: "AUS"'), 'Ein/Aus-Schalter zeigen den ausgeschalteten Zustand nicht als Text.');
expect(systemCss.includes('content: "AN"'), 'Ein/Aus-Schalter zeigen den eingeschalteten Zustand nicht als Text.');
expect(systemCss.includes('.module-field-toggle .module-toggle input:checked + i'), 'Aktive Modul-Einstellungsschalter werden nicht explizit gestaltet.');
expect(systemCss.includes('.skin-compact-toggle input:checked + b'), 'Aktive Skin-Studio-Schalter folgen nicht dem appweiten Zustandsdesign.');
expect(systemCss.includes('body[data-theme="light"].authenticated:not(.public-home) .module-field-toggle .module-toggle i'), 'Modul-Einstellungsschalter besitzen keinen eigenen Hellmodus-Kontrastschutz.');
expect(systemCss.includes('Light module filter authority'), 'Der Modulfilter kann im Hellmodus als unlesbarer dunkler Balken erscheinen.');

expect(app.includes('Automatische Nachrichten &amp; Embeds'), 'Heaven Economy besitzt keinen klar benannten Nachrichtenbereich.');
expect(app.includes('Boost-Meilenstein-Embed bearbeiten'), 'Das Boost-Meilenstein-Embed ist im Modul nicht direkt auffindbar.');

if (problems.length) {
  console.error('UI-Status-Consistency-Smoke fehlgeschlagen:');
  problems.forEach((problem) => console.error(`- ${problem}`));
  process.exit(1);
}

console.log('UI-Status-Consistency-Smoke bestanden: Modulstatus, aktive Controls, Hellmodus und Embed-Zugang sind konsistent.');
