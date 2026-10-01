import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const appSource = await fs.readFile(new URL('../desktop/renderer/app.js', import.meta.url), 'utf8');
const moduleSource = await fs.readFile(new URL('../desktop/renderer/temp-voice-ui.js', import.meta.url), 'utf8').catch(() => '');
const htmlSource = await fs.readFile(new URL('../desktop/renderer/index.html', import.meta.url), 'utf8');
const cssSource = await fs.readFile(new URL('../desktop/renderer/ui-base.css', import.meta.url), 'utf8');
const packageSource = await fs.readFile(new URL('../package.json', import.meta.url), 'utf8');

const functionBlock = (source, name, nextName) => {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} fehlt.`);
  const end = nextName ? source.indexOf(`function ${nextName}`, start + 1) : source.length;
  return source.slice(start, end === -1 ? source.length : end);
};

assert.match(moduleSource, /window\.FHCCTempVoiceUI\s*=\s*\{/, 'Das ausgelagerte TempVoice-Renderer-Modul fehlt.');
assert.match(moduleSource, /function create\s*\(dependencies\)/, 'TempVoice-UI braucht eine Factory mit injizierten Abhängigkeiten.');
assert.match(htmlSource, /<script src="temp-voice-ui\.js\?v=[^"]+"><\/script>[\s\S]*?<script src="app\.js\?v=/, 'TempVoice-UI muss vor app.js geladen werden.');
assert.match(appSource, /window\.FHCCTempVoiceUI\.create\s*\(/, 'app.js muss den TempVoice-Modulvertrag initialisieren.');
assert.doesNotMatch(appSource, /function tempVoiceOverview\s*\(/, 'Die TempVoice-Übersicht darf nicht in app.js dupliziert bleiben.');
assert.doesNotMatch(appSource, /function renderTempVoiceStatus\s*\(/, 'Das TempVoice-Rendering darf nicht in app.js dupliziert bleiben.');
assert.match(appSource, /function tempVoiceStudioTemplate\(config\)\s*\{\s*return tempVoiceUi\.studioTemplate\(config\);\s*\}/, 'Der alte Studio-Einstieg darf nur als dünner Moduladapter bestehen bleiben.');
assert.ok(functionBlock(appSource, 'tempVoiceStudioTemplate', 'openTempVoiceStudio').length < 120, 'Im app.js-Adapter darf keine TempVoice-Studiologik dupliziert werden.');

for (const marker of [
  'data-temp-voice-profiles',
  'data-temp-voice-channels',
  'data-temp-voice-reset-profile',
  'data-temp-voice-reset-all',
  'data-temp-voice-profile-count'
]) {
  assert.match(moduleSource, new RegExp(marker), `TempVoice-UI-Marker ${marker} fehlt.`);
}

const renderBlock = functionBlock(moduleSource, 'renderStatus', 'resetProfile');
assert.match(renderBlock, /escapeHtml\(profile\.customName/, 'Profilnamen müssen escaped gerendert werden.');
assert.match(renderBlock, /escapeHtml\(channel\.(?:name|channelName)/, 'Kanalnamen müssen escaped gerendert werden.');
assert.match(renderBlock, /escapeHtml\(channel\.(?:ownerName|owner)/, 'Besitzernamen müssen escaped gerendert werden.');
assert.match(renderBlock, /escapeAttr\(profile\.userId/, 'Profil-IDs müssen im Attribut escaped werden.');
assert.match(renderBlock, /title="[^"]+"[^>]+aria-label="[^"]+"[^>]+data-temp-voice-reset-profile=/, 'Reset braucht title, aria-label und Profil-ID.');
assert.match(moduleSource, /data-temp-voice-live[^>]+aria-live="polite"/, 'Der dynamische TempVoice-Status braucht eine höfliche Live-Region.');
assert.match(moduleSource, /data-temp-voice-profiles[^>]+aria-live="polite"/, 'Die dynamische Profilliste braucht eine höfliche Live-Region.');

const refreshBlock = moduleSource.slice(
  moduleSource.indexOf('let refreshTimer'),
  moduleSource.indexOf('function renderStatus')
);
assert.match(refreshBlock, /refreshGeneration/, 'TempVoice-Refresh braucht eine Generation gegen veraltete Antworten.');
assert.match(refreshBlock, /refreshInFlight/, 'TempVoice-Refresh braucht Single-Flight pro Server.');
assert.match(refreshBlock, /generation\s*!==\s*refreshGeneration/, 'Veraltete Refresh-Antworten müssen verworfen werden.');
assert.match(refreshBlock, /dataset\.state\s*=\s*'error'/, 'Ein fehlgeschlagener Refresh braucht einen sichtbaren Fehler-Endzustand.');
assert.match(refreshBlock, /progress\.style\.width\s*=\s*'0%'/, 'Der Fortschritt muss auch nach einem Fehler beendet werden.');
assert.match(refreshBlock, /Status konnte nicht geladen werden|Laden fehlgeschlagen/, 'Der Fehler-Endzustand muss verständlichen Text zeigen.');

const componentPreview = functionBlock(appSource, 'renderStudioComponentsPreview', 'welcomeFarewellStudioTemplate');
for (const setting of ['allowRename', 'allowLimit', 'allowThreads', 'allowRegion', 'allowLock', 'allowTransfer', 'rememberUserProfiles']) {
  assert.match(componentPreview, new RegExp(`config\\?\\.${setting}|config\\.${setting}`), `Button-Vorschau muss ${setting} aus der aktuellen Config berücksichtigen.`);
}
assert.doesNotMatch(componentPreview, /\['✏️',\s*'🔢',\s*'🧵'/, 'Die TempVoice-Vorschau darf keine feste Buttonliste verwenden.');

const stablePreview = functionBlock(appSource, 'createStableEmbedPreview', 'renderStableStudioPreview');
assert.match(stablePreview, /tempVoiceUi\.plainPreview/, 'TempVoice-Feldnamen und Footer brauchen den Plain-Text-Renderer des Moduls.');
assert.match(stablePreview, /name\.textContent\s*=\s*tempVoiceUi\.plainPreview/, 'TempVoice-Feldnamen dürfen nicht als Rich Text dargestellt werden.');
assert.match(stablePreview, /footerText\.textContent\s*=\s*tempVoiceUi\.plainPreview/, 'TempVoice-Footer darf nicht als Rich Text dargestellt werden.');

const specialUi = functionBlock(appSource, 'renderStudioSpecialTemplateUi', 'renderStudioEmbedTabs');
assert.match(specialUi, /thread-section[\s\S]*?hidden\s*=\s*tempVoiceActive/, 'Der Thread-Bereich muss im TempVoice-Spezialmodus ausgeblendet und danach reaktiviert werden.');
assert.doesNotMatch(specialUi, /TempVoice-Embed speichern/, 'Kein TempVoice-Save darf verschweigen, dass aktive Interfaces live aktualisiert werden.');
assert.match(specialUi, /Speichern\s*&\s*aktive Interfaces aktualisieren/g, 'Beide TempVoice-Save-Aktionen müssen die Live-Aktualisierung benennen.');

const leaveGuard = functionBlock(moduleSource, 'confirmLeaveStudio', 'openStudio');
assert.match(leaveGuard, /hasUnsavedStudioChanges\(/, 'Der Leave-Guard muss echte TempVoice-Änderungen erkennen.');
assert.match(leaveGuard, /deps\.showConfirm\(/, 'Ungespeicherte TempVoice-Änderungen brauchen eine injizierte Bestätigung.');
assert.match(appSource, /bindId\('template-row'[\s\S]{0,1200}await tempVoiceUi\.confirmLeaveStudio\(/, 'Vor einem Vorlagenwechsel muss der TempVoice-Leave-Guard laufen.');
assert.match(appSource, /bindId\('studio-special-back'[\s\S]{0,600}await tempVoiceUi\.confirmLeaveStudio\(/, 'Vor „Normales Embed“ muss der TempVoice-Leave-Guard laufen.');
assert.match(appSource, /async function setView[\s\S]{0,500}tempVoiceUi\.confirmLeaveStudio\(/, 'Auch das Verlassen der Studio-Ansicht muss geschützt sein.');

const singleReset = functionBlock(moduleSource, 'resetProfile', 'resetAllProfiles');
assert.match(singleReset, /deps\.showConfirm\(/);
assert.match(singleReset, /method:\s*'DELETE'/);
assert.match(singleReset, /temp-voice\/profiles\/'\s*\+\s*encodeURIComponent\(userId\)/);
assert.match(singleReset, /button\.disabled\s*=\s*true/);
assert.match(singleReset, /await refreshStatus\(/);

const allReset = functionBlock(moduleSource, 'resetAllProfiles', 'defaultStudioEmbed');
assert.match(allReset, /deps\.showConfirm\(/);
assert.match(allReset, /method:\s*'DELETE'/);
assert.match(allReset, /temp-voice\/profiles'/);
assert.match(allReset, /removedCount/);
assert.match(allReset, /button\.disabled\s*=\s*true/);
assert.match(allReset, /await refreshStatus\(/);

assert.match(appSource, /closest\('\[data-temp-voice-reset-profile\]'/, 'Profil-Reset muss per Event-Delegation angebunden sein.');
assert.match(appSource, /closest\('\[data-temp-voice-reset-all\]'/, 'Gesamt-Reset muss per Event-Delegation angebunden sein.');

assert.match(cssSource, /\.temp-voice-lists\s*\{/);
assert.match(cssSource, /\.temp-voice-list\s*\{/);
assert.match(cssSource, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
assert.match(cssSource, /@media\s*\(max-width:\s*720px\)[\s\S]*?\.temp-voice-lists\s*\{[^}]*grid-template-columns:\s*1fr/);
assert.match(cssSource, /\.temp-voice-profile-row\s*\{[^}]*content-visibility:\s*auto/, 'Lange Profillisten brauchen content-visibility.');
assert.match(cssSource, /@media\s*\(max-width:\s*720px\)[\s\S]*?\.temp-voice-panel[^}]*header\s*>\s*div\s*\{[^}]*flex-wrap:\s*wrap/, 'Mobile TempVoice-Headeraktionen müssen umbrechen.');
assert.match(cssSource, /@media\s*\(max-width:\s*720px\)[\s\S]*?\.temp-voice-panel[^}]*header\s+button\s*\{[^}]*min-width:\s*0/, 'Mobile TempVoice-Buttons dürfen keine unabschneidbare Mindestbreite behalten.');
assert.doesNotMatch(cssSource.match(/\.temp-voice-lists\s*\{[\s\S]*?\n\}/)?.[0] || '', /gradient|border:/, 'Listenbereiche bleiben ungerahmt und ohne Gradient.');

const packageJson = JSON.parse(packageSource);
assert.match(packageJson.scripts['test:community'], /temp-voice-ui-smoke\.mjs/, 'UI-Smoke muss im Community-Test laufen.');

console.log('TempVoice-UI-Smoke bestanden: Live-Listen, sichere Profil-Resets und Mobile-Layout sind verbunden.');
