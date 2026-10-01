import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const app = read('desktop', 'renderer', 'app.js');
const css = read('desktop', 'renderer', 'ui-base.css');
const problems = [];
const expect = (condition, message) => { if (!condition) problems.push(message); };

// 1) Die Linkify-Funktion muss existieren und http/https-URLs in <a>-Tags wrappen.
expect(app.includes('function studioRichText(value)'), 'studioRichText-Funktion fehlt in der Studio-Vorschau.');
expect(/href="' \+ url \+ '"/.test(app), 'studioRichText muss die URL als href setzen (klickbarer Link).');
expect(/target="_blank"/.test(app), 'studioRichText muss Links in neuem Tab öffnen.');
expect(/rel="noopener noreferrer"/.test(app), 'studioRichText muss noopener noreferrer setzen (Sicherheit).');
expect(app.includes('https?:\\/\\/') && app.includes('[^\\s<>"\']'), 'studioRichText darf nur http/https-Schemata verlinken (kein javascript:).');

// 2) Footer, Beschreibung, Titel und Felder der Vorschau müssen studioRichText nutzen,
//    damit Links dort sichtbar sind (die Beschwerde betraf explizit den Footer).
for (const [label, needle] of [
  ['Footer-Signatur', 'if (signature) signature.innerHTML = studioRichText(embed.footerText'],
  ['Stable-Preview-Footer', 'footerText.innerHTML = studioRichText(embed.footerText)'],
  ['Beschreibung (Stable-Preview)', 'description.innerHTML = studioRichText(embed.description)'],
  ['Beschreibung (Legacy-Preview)', "if (description) description.innerHTML = studioRichText(embed.description"],
  ['Feldname', "name.innerHTML = studioRichText(field.name"],
  ['Feldwert', "value.innerHTML = studioRichText(field.value"],
  ['Extra-Embed-Titel', "'<h3>' + studioRichText(item.title"],
  ['Extra-Embed-Beschreibung', "studioRichText(item.description"],
  ['Extra-Embed-Footer', "studioRichText(item.footerText"],
]) {
  expect(app.includes(needle), `Link-Rendering fehlt: ${label}`);
}

// 3) CSS: Links in der Vorschau müssen als Links aussehen (blau, unterstrichen bei Hover).
expect(css.includes('.stable-embed-preview .embed-content a'), 'CSS: Vorschau-Links brauchen eine Farbe.');
expect(css.includes('color: #00a8fc'), 'CSS: Vorschau-Links müssen in Link-Blau gerendert werden.');
expect(css.includes('.embed-footer a'), 'CSS: Footer-Links brauchen explizite Link-Farbe.');
expect(css.includes('.embed-fields a'), 'CSS: Feld-Links brauchen explizite Link-Farbe.');

if (problems.length) {
  console.error('EMBED-LINK-PREVIEW-SMOKE FEHLGESCHLAGEN:\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log('embed-link-preview-smoke: OK (Links in der Embed-Vorschau sichtbar + klickbar)');
