import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { featureCards } from '../src/defaultConfig.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = path.join(root, 'desktop', 'renderer', 'index.html');
const appPath = path.join(root, 'desktop', 'renderer', 'app.js');
const inputModulePath = path.join(root, 'desktop', 'renderer', 'module-config-inputs.js');
// Seit 3.9.139 sind alle Einzel-Sheets zu ui-base.css zusammengeführt – die
// Qualitätsschicht-Prüfungen laufen gegen das konsolidierte Sheet.
const qualityCssPath = path.join(root, 'desktop', 'renderer', 'ui-base.css');
const diagnosticsPath = path.join(root, 'desktop', 'renderer', 'live-diagnostics.js');
const html = fs.readFileSync(htmlPath, 'utf8');
const app = fs.readFileSync(appPath, 'utf8');
const inputModule = fs.readFileSync(inputModulePath, 'utf8');
const qualityCss = fs.readFileSync(qualityCssPath, 'utf8');
const diagnostics = fs.readFileSync(diagnosticsPath, 'utf8');
const problems = [];
const assert = (condition, message) => { if (!condition) problems.push(message); };
const luminance = (hex) => {
  const channels = hex.replace('#', '').match(/.{2}/g).map((value) => Number.parseInt(value, 16) / 255)
    .map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return (channels[0] * 0.2126) + (channels[1] * 0.7152) + (channels[2] * 0.0722);
};
const contrast = (foreground, background) => {
  const values = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (values[0] + 0.05) / (values[1] + 0.05);
};

const supportedTypes = new Set([
  'text', 'number', 'integer', 'textarea', 'arraylines', 'checkbox', 'select',
  'channelselect', 'multichannelselect', 'roleselect', 'multiroleselect',
  'rolemappingselect', 'roleswapselect', 'emoji', 'json', 'password'
]);
const keys = new Set();
let fieldCount = 0;

for (const feature of featureCards) {
  assert(feature?.id, 'Ein Modul besitzt keine ID.');
  for (const field of feature?.fields || []) {
    fieldCount += 1;
    const type = String(field.type || 'text').toLowerCase();
    assert(field.key, `${feature.id}: Feld ohne Schlüssel.`);
    assert(field.label, `${field.key || feature.id}: Feld ohne sichtbare Bezeichnung.`);
    assert(supportedTypes.has(type), `${field.key}: nicht unterstützter Feldtyp „${field.type}“.`);
    assert(!keys.has(field.key), `${field.key}: doppelter Feldschlüssel.`);
    keys.add(field.key);
    if (type === 'select') assert(Array.isArray(field.options) && field.options.length > 0, `${field.key}: Auswahl ohne Optionen.`);
    if (['number', 'integer'].includes(type) && field.min !== undefined && field.max !== undefined) {
      assert(Number(field.min) <= Number(field.max), `${field.key}: Min ist größer als Max.`);
    }
    if (/channelids$/i.test(field.key)) assert(type === 'multichannelselect', `${field.key}: mehrere Kanäle müssen auswählbar sein.`);
    else if (/channelid$/i.test(field.key)) assert(type === 'channelselect', `${field.key}: Kanal darf keine manuelle ID-Eingabe sein.`);
    if (/roleids$/i.test(field.key)) assert(type === 'multiroleselect', `${field.key}: mehrere Rollen müssen auswählbar sein.`);
    else if (/roleid$/i.test(field.key)) assert(type === 'roleselect', `${field.key}: Rolle darf keine manuelle ID-Eingabe sein.`);
    const isEmojiValue = /emoji/i.test(field.key)
      && !/^emojiManager\./i.test(field.key)
      && !/useServerEmojis|emojiUsage|includeEmojis|restoreEmojis/i.test(field.key);
    if (isEmojiValue) assert(type === 'emoji', `${field.key}: Emoji-Feld benötigt die Emoji-Bibliothek.`);
  }
}

const idMatches = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const duplicateIds = [...new Set(idMatches.filter((id, index) => idMatches.indexOf(id) !== index))];
assert(duplicateIds.length === 0, `Doppelte HTML-IDs: ${duplicateIds.join(', ')}`);

const labelBlocks = [...html.matchAll(/<label\b[\s\S]*?<\/label>/gi)].map((match) => match[0]);
const labelFors = new Set([...html.matchAll(/<label\b[^>]*\bfor="([^"]+)"/gi)].map((match) => match[1]));
const unlabelled = [];
for (const match of html.matchAll(/<(input|select|textarea)\b[^>]*\bid="([^"]+)"[^>]*>/gi)) {
  const [, tag, id] = match;
  const source = match[0];
  if (/type="(?:hidden|file)"/i.test(source)) continue;
  const nested = labelBlocks.some((block) => new RegExp(`\\bid="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(block));
  const described = /aria-label=|aria-labelledby=/i.test(source);
  if (!nested && !labelFors.has(id) && !described) unlabelled.push(`${tag}#${id}`);
}
assert(unlabelled.length === 0, `Felder ohne zugängliche Bezeichnung: ${unlabelled.join(', ')}`);

assert(/ui-base\.css/.test(html), 'Das konsolidierte Stylesheet ui-base.css ist nicht eingebunden.');
assert(qualityCss.indexOf('/* --- ui-quality-v9.css --- */') > qualityCss.indexOf('/* --- skin-editor.css --- */'), 'Die UI-Qualitätsschicht muss im konsolidierten Sheet nach den Modulstilen stehen.');
assert(/html\[data-theme="light"\]/.test(qualityCss), 'Vollständige Hellmodus-Tokens fehlen.');
assert(!/<label class="module-search"><svg/i.test(html), 'Modul-Suche darf kein Icon direkt vor dem Platzhalter anzeigen.');
assert(/\.module-search input\s*\{[^}]*padding-left:\s*14px\s*!important/.test(qualityCss), 'Modul-Suche braucht normalen linken Textabstand ohne Icon-Reservierung.');
assert(/\.command-palette > form > label input[\s\S]*padding-left:\s*50px\s*!important/.test(qualityCss), 'Schnellnavigation-Suche braucht genug linken Icon-Abstand.');
assert(/\.message-emoji-tools input[\s\S]*padding-left:\s*50px\s*!important/.test(qualityCss), 'Emoji-Suche braucht genug linken Icon-Abstand.');
assert(contrast('#f7f8ff', '#07091c') >= 7, 'Dunkelmodus unterschreitet den professionellen Textkontrast.');
assert(contrast('#171a36', '#eef1ff') >= 7, 'Hellmodus unterschreitet den professionellen Textkontrast.');
assert(contrast('#b3b8d2', '#07091c') >= 4.5, 'Dunkelmodus: Sekundärtext ist nicht gut lesbar.');
assert(contrast('#4f5879', '#eef1ff') >= 4.5, 'Hellmodus: Sekundärtext ist nicht gut lesbar.');
const fieldRendererSource = app + '\n' + inputModule;
assert(/data-setting-type="emoji"/.test(fieldRendererSource), 'Dynamische Emoji-Felder besitzen keine Bibliotheksanbindung.');
assert(/type === 'arraylines'/.test(fieldRendererSource), 'Mehrzeilige Konfigurationsfelder werden nicht als Textbereich gebaut.');
assert(/data-setting-type="channel-multi"/.test(fieldRendererSource), 'Mehrfach-Kanalauswahl fehlt.');
assert(!/score:\s*70[\s,]/.test(diagnostics), 'Live-Diagnose enthält noch einen erfundenen 70-Punkte-Fallback.');
assert(/Noch keine Detailmessung/.test(diagnostics), 'Live-Diagnose kennzeichnet fehlende Messwerte nicht verständlich.');
const appLines = app.split(/\r?\n/).length;
assert(appLines <= 9800, `desktop/renderer/app.js ist mit ${appLines} Zeilen zu groß. Neue UI-Logik muss in ein eigenes Renderer-Modul.`);

if (problems.length) {
  console.error(`UI-Feld-Audit fehlgeschlagen (${problems.length}):`);
  problems.forEach((problem) => console.error(`- ${problem}`));
  process.exit(1);
}

console.log(`UI-Feld-Audit: ${fieldCount} Modulfelder und ${idMatches.length} feste UI-Elemente geprüft.`);
