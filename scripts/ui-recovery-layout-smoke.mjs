import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const html = read('desktop', 'renderer', 'index.html');
const css = read('desktop', 'renderer', 'ui-recovery-v10.css');
const problems = [];
const expect = (condition, message) => { if (!condition) problems.push(message); };

expect(/ui-recovery-v10\.css/.test(html), 'Der UI-Recovery-Layer ist nicht eingebunden.');
expect(html.lastIndexOf('ui-recovery-v10.css') > html.lastIndexOf('server-management-v2.css'), 'Der UI-Recovery-Layer muss nach den historischen Modulstilen geladen werden.');
for (const selector of [
  '.module-layout', '.module-grid', '.module-card', '.module-config-head', '.module-field-grid', '.module-field', '.studio-shell',
  '.discord-message-preview', '.outside-message-image', '.stable-embed-preview',
  '#community-view .member-management-layout', '#community-view .member-table-row'
]) {
  expect(css.includes(selector), `Strukturschutz für ${selector} fehlt.`);
}
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

if (problems.length) {
  console.error(`UI-Recovery-Prüfung fehlgeschlagen (${problems.length}):`);
  problems.forEach((problem) => console.error(`- ${problem}`));
  process.exit(1);
}

console.log('UI-Recovery-Prüfung: Modulraster, Studio-Vorschau und Mitgliederlayout abgesichert.');
