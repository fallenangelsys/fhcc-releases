import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('desktop/renderer/index.html');
const renderer = read('desktop/renderer/server-management.js');
const styles = read('desktop/renderer/styles.css');
const dashboard = read('src/dashboard.js');
const backend = read('src/index.js');
const economy = read('src/features/heavenEconomy.js');

for (const id of [
  'vip-summary',
  'vip-reconcile',
  'vip-search',
  'vip-filter',
  'vip-member-select',
  'vip-account-list',
  'vip-account-detail',
  'vip-ledger-list',
  'vip-confirm-dialog'
]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `UI-Element ${id} fehlt.`);
}
assert.match(html, /data-community-tab="vip"/);
assert.match(html, /data-community-panel="vip"/);
assert.doesNotMatch(html, /value="departed"/, 'Die VIP-Verwaltung darf keinen Filter für ausgetretene Mitglieder anbieten.');
assert.match(renderer, /async function loadVipEconomy/);
assert.match(renderer, /function stageVipUpdate/);
assert.match(renderer, /heaven-economy\/account/);
assert.match(renderer, /heaven-economy\/reconcile/);
assert.match(renderer, /async function reconcileVipEconomy/);
assert.match(renderer, /showModal\(\)/);
assert.doesNotMatch(renderer, /window\.confirm\s*\(/);
assert.match(styles, /Heaven Economy Control Center/);
assert.match(styles, /body\[data-theme="light"\].*vip/);
assert.match(styles, /@media\(max-width:820px\).*vip-summary/s);
assert.match(dashboard, /app\.get\('\/api\/guild\/:guildId\/heaven-economy'/);
assert.match(dashboard, /app\.patch\('\/api\/guild\/:guildId\/heaven-economy\/account'/);
assert.match(dashboard, /app\.post\('\/api\/guild\/:guildId\/heaven-economy\/reconcile'/);
assert.match(backend, /getHeavenEconomyAdminSnapshot/);
assert.match(backend, /updateHeavenEconomyAccount/);
assert.match(economy, /const ECONOMY_VERSION = 2/);
assert.match(economy, /ECONOMY_REVISION_CONFLICT/);
assert.match(economy, /Heaven Economy Rollback/);

const mojibakePattern = /(?:\u00c3.|\u00c2.|\u00e2\u20ac|\u00f0\u0178)/;
for (const [name, source] of [['HTML', html], ['Renderer', renderer], ['Backend', economy]]) {
  assert.doesNotMatch(source, mojibakePattern, `${name} enthält beschädigte UTF-8-Zeichen.`);
}

console.log('Heaven-Economy-UI-Smoke bestanden: Verwaltung, Dialog, API, Themes und UTF-8 sind vollständig verdrahtet.');
