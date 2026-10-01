import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const html = read('desktop', 'renderer', 'index.html');
// Seit 3.9.139 sind alle Einzel-Sheets zu einem ui-base.css zusammengeführt –
// die Prüfungen laufen gegen das konsolidierte Sheet, die Schichten-Reihenfolge
// ist über die Sektions-Positionen im File abgesichert.
const css = read('desktop', 'renderer', 'ui-base.css');
const problems = [];
const expect = (condition, message) => { if (!condition) problems.push(message); };

expect(/ui-base\.css/.test(html), 'Das konsolidierte Stylesheet ui-base.css ist nicht eingebunden.');
expect(!/@import\s+url\(['"]?https?:\/\//i.test(css), 'Das Hauptfenster darf beim Start keine externen Font-Stylesheets laden; lokale WOFF2-Dateien sind vorhanden.');
expect(html.split('stylesheet').length >= 2 && /ui-base\.css/.test(html), 'Die App lädt genau ein Stylesheet-Bündel (ui-base.css).');
expect(css.indexOf('/* --- ui-recovery-v10.css --- */') > css.indexOf('/* --- server-management-v2.css --- */'), 'Der UI-Recovery-Abschnitt muss im konsolidierten Sheet nach den historischen Modulstilen stehen.');
for (const selector of [
  '.module-layout', '.module-grid', '.module-card', '.module-config-head', '.module-field-grid', '.module-field', '.studio-shell',
  '.discord-message-preview', '.outside-message-image', '.stable-embed-preview',
  '#community-view .member-management-layout', '#community-view .member-table-row'
]) {
  expect(css.includes(selector), `Strukturschutz für ${selector} fehlt.`);
}
// Embed-Studio-Vorschau: Feldnamen werden als <strong> gerendert und müssen blockartig
// über dem Feldwert stehen (sonst überlappen Name und Wert wie im alten Bug).
expect(css.includes('.embed-field :is(b, strong)'), 'Embed-Feldnamen (strong) brauchen das Block-Layout in der Studio-Vorschau.');
expect(css.includes('.stable-embed-preview .message-inline-emoji'), 'Embed-Vorschau braucht Emojis in Textgröße statt 22px.');
for (const required of [
  'display: grid !important',
  'grid-template-columns: repeat(2, minmax(0, 1fr))',
  '.module-field > :is(input, select, textarea',
  'max-height: 380px',
  'overflow-wrap: anywhere',
  '@media (max-width: 980px)'
]) {
  expect(css.includes(required), `Wichtige Schutzregel fehlt: ${required}`);
}

// Sektions-Header: Icon links, Titel + Untertitel als gestapelte Spalte daneben
expect(css.includes('.form-section-title {') && /display: flex !important/.test(css), 'Sektions-Header brauchen das Flex-Zeilenlayout (Icon neben Text).');
expect(css.includes('.form-section-title > div > small { display: block'), 'Sektions-Header: Untertitel muss unter dem Titel stehen.');

// Modul-Config-Icon: Pille statt festem Quadrat, damit lange Kürzel (STEAM, FORUM) nicht überlaufen
expect(css.includes('.module-config-icon {') && css.includes('min-width: 42px') && css.includes('white-space: nowrap'), 'Modul-Icon muss als wachsende Pille gerendert werden (min-width + nowrap).');

// Community-Seite: Struktur-/VIP-Workspace dürfen bei schmalen Panels nicht mehr
// über den Panel-Rand laufen (feste minmax-Mindestbreiten in styles.css).
expect(css.includes('#community-view .structure-layout') && css.includes('minmax(0, .72fr)'), 'Struktur-Layout braucht flexible Spalten (minmax(0, …)).');
expect(css.includes('@container server-management (max-width: 1100px)') && css.includes('.structure-layout .channel-reader { grid-column: 1 / -1'), 'Struktur-Layout: Kanal-Inhalt muss bei schmalen Panels unter die Spalten stapeln.');
expect(css.includes('#community-view .vip-workspace') && css.includes('minmax(0, 1.05fr)'), 'VIP-Workspace braucht flexible Spalten (minmax(0, …)).');
expect(css.includes('@container server-management (max-width: 1000px)') && css.includes('#community-view .vip-account-detail { position: static'), 'VIP-Detail muss bei schmalen Panels unter die Konten stapeln.');

// Community-Seite: Member-Tabelle reagiert jetzt auf die Panel-Breite (Container).
expect(css.includes('@container server-management (max-width: 1080px)') && css.includes('#community-view .member-management-layout { grid-template-columns: minmax(0, 1fr)'), 'Member-Layout muss bei schmalen Panels stapeln (Tabelle über Detail).');
expect(css.includes('#community-view .member-table-row > time { display: none'), 'Member-Tabelle: Beigetreten-Spalte muss bei schmalen Panels weichen.');
expect(css.includes('#community-view .member-profile-head h3 { overflow-wrap: anywhere'), 'Member-Detail: lange Profilnamen müssen umbrechen.');

// Community-Seite: Rollen-Editor im Kanal-Leser war komplett ungestylt.
expect(css.includes('#community-view .role-editor {') && css.includes('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)'), 'Rollen-Editor braucht ein Formularraster (war ungestylt).');
expect(css.includes('#community-view .role-editor .role-check'), 'Rollen-Editor: Checkbox-Zeilen fehlen.');
expect(css.includes('body[data-theme="light"] #community-view .role-editor .role-permissions p span'), 'Rollen-Editor braucht Light-Mode-Kontrast für Chips.');

// Community-Seite: VIP-Summary/Ledger + Systemereignis-Zeilen
for (const marker of [
  '@container server-management (max-width: 1080px)',
  '#community-view .vip-summary { grid-template-columns: repeat(3, minmax(0, 1fr))',
  '#community-view .vip-account-row b { overflow: hidden',
  '#community-view .vip-ledger-list b { overflow: hidden',
  '#community-view .boost-baseline-list',
  '#community-view .system-event-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1.35fr)'
]) {
  expect(css.includes(marker), `Community-Responsive-Marker fehlt: ${marker}`);
}

// Skin-Editor: Icon-only-Kollaps der Toolbar-Buttons darf nicht von globalen
// Button-Regeln (font-size: 12px !important) überschrieben werden, sonst läuft
// der volle Text über die 36px-Buttons (≤1480/≤1160/≤920px).
const skin = css;
for (const marker of [
  '.skin-file-actions button { font-size: 0 !important',
  '.skin-walk-toggle { width: 36px; padding: 0; font-size: 0 !important',
  '.skin-export-button { padding: 0 10px; font-size: 0 !important',
  '.skin-mode-switch button { min-width: 36px; font-size: 0 !important'
]) {
  expect(skin.includes(marker), `Skin-Editor-Icon-Kollaps fehlt: ${marker}`);
}
// Skin-Editor: Rail-Buttons dürfen kein horizontales Padding aus globalen
// Button-Regeln erben (sonst überlaufen Undo/Redo ihre 1fr-Spalten).
// (Die Datei nutzt CRLF-Zeilenenden – der Selektoren-Check ist daher
// zeilenendungs-agnostisch formuliert.)
expect(/\.skin-tool-stack button,\r?\n\.skin-history-stack button/.test(skin) && /padding: 0;/.test(skin), 'Skin-Editor: Rail-Buttons brauchen padding: 0 (geerbtes 12px-Padding lässt die History-Spalten überlaufen).');

// Effekte- & Checkbox-Layer (letzte Autorität) – im konsolidierten Sheet der
// vorletzte Abschnitt (performance.css), gefolgt nur vom finalen ui-fallen-v12.
const design = css;
for (const marker of [
  'fh-surface-in',
  '.quick-card button[data-view]:hover',
  '.studio-emoji-trigger:hover',
  "input[type='checkbox']:not(.module-toggle input)",
  '.skin-layer-visibility input',
  'dialog[open]'
]) {
  expect(design.includes(marker), `Design-System-Marker fehlt: ${marker}`);
}

if (problems.length) {
  console.error(`UI-Recovery-Prüfung fehlgeschlagen (${problems.length}):`);
  problems.forEach((problem) => console.error(`- ${problem}`));
  process.exit(1);
}

console.log('UI-Recovery-Prüfung: Modulraster, Studio-Vorschau und Mitgliederlayout abgesichert.');
