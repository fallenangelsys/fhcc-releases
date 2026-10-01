import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
const html = read('desktop/renderer/index.html');
const css = read('desktop/renderer/ui-base.css');
const renderer = read('desktop/renderer/server-management.js');
const backend = read('src/index.js');

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

assert(html.includes(`ui-base.css?v=${pkg.version}`), 'Serververwaltung-CSS fehlt oder hat einen veralteten Cache-Buster.');
[
  '.member-toolbar',
  '.member-summary',
  '.member-management-layout',
  '.member-table-head',
  '.member-table-row',
  '.member-detail',
  '.boost-summary',
  '.boost-filter-tabs',
  '.boost-workspace',
  '.booster-card',
  '.system-event-progress',
  '.system-event-summary',
  '.system-event-table',
  '.community-load-error'
].forEach((selector) => assert(css.includes(selector), `Basislayout fehlt: ${selector}`));

assert(css.includes('container: server-management / inline-size'), 'Container-responsives Layout fehlt.');
assert(css.includes('body[data-theme="light"] #community-view'), 'Vollständiger Hellmodus für die Serververwaltung fehlt.');
assert(!renderer.includes('const autoSync = sync || !hasRenderedMembers'), 'Erster Mitgliederaufruf erzwingt weiterhin einen blockierenden Discord-Vollabgleich.');
assert(renderer.includes("sync: sync ? '1' : '0'"), 'Expliziter Mitgliederabgleich wird nicht sauber vom normalen Laden getrennt.');
assert(renderer.includes('Discord wird abgeglichen ...'), 'Mitgliederabgleich besitzt keinen sichtbaren Arbeitszustand.');
assert(renderer.includes('data-system-events-retry'), 'Systemereignis-Fehlerzustand besitzt keine Wiederholen-Aktion.');
assert(backend.includes('const visibleMembers = await Promise.all(visibleRows.map'), 'Profilbilder werden nicht auf die sichtbare Mitgliederseite begrenzt.');
assert(backend.includes('members: visibleMembers'), 'Optimierte Mitgliederseite wird nicht ausgeliefert.');

let balance = 0;
for (const character of css) {
  if (character === '{') balance += 1;
  if (character === '}') balance -= 1;
  assert(balance >= 0, 'Serververwaltung-CSS enthält eine vorzeitig geschlossene Klammer.');
}
assert(balance === 0, 'Serververwaltung-CSS enthält unausgeglichene Klammern.');

console.log(`Serververwaltung UI smoke OK (${pkg.version})`);
