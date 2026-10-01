import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('desktop/renderer/index.html');
const renderer = read('desktop/renderer/server-management.js');
const appRenderer = read('desktop/renderer/app.js');
const economyPanelStudio = fs.existsSync(path.join(root, 'desktop/renderer/economy-panel-studio.js'))
  ? read('desktop/renderer/economy-panel-studio.js')
  : '';
const studioJsonImport = fs.existsSync(path.join(root, 'desktop/renderer/studio-json-import.js'))
  ? read('desktop/renderer/studio-json-import.js')
  : '';
const config = read('src/defaultConfig.js');
const styles = read('desktop/renderer/ui-base.css');
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
assert.match(renderer, /const coinHtml = \(value\) =>/, 'Coin-Emoji muss über coinHtml gerendert werden (Custom-Emoji-Codes als Bild).');
assert.match(renderer, /Verschenkt/);
assert.match(renderer, /Geschenkt erhalten/);
assert.match(renderer, /coin-gift/);
assert.doesNotMatch(renderer, /\$\{safe\(coin\)\}/, 'Coin darf nirgends mehr als roher Text mit safe() gerendert werden.');
assert.match(renderer, /\$\{coinHtml\(coin\)\}/, 'Coin muss in Kontenliste und Detail-Pills als coinHtml erscheinen.');
assert.match(dashboard, /app\.patch\('\/api\/guild\/:guildId\/heaven-economy\/account'/);
assert.match(dashboard, /app\.post\('\/api\/guild\/:guildId\/heaven-economy\/reconcile'/);
assert.match(dashboard, /app\.put\('\/api\/guild\/:guildId\/heaven-economy\/panel-design'/);
assert.match(backend, /getHeavenEconomyAdminSnapshot/);
assert.match(backend, /updateHeavenEconomyAccount/);
assert.match(backend, /saveHeavenEconomyPanelDesign/);
assert.match(economy, /const ECONOMY_VERSION = 3/);
assert.doesNotMatch(economy, /fh_coin:perks/, 'Der separate VIP-Vorteile-Interaktionspfad muss entfernt sein.');
assert.match(config, /heavenEconomy\.coinGiftsEnabled/);
assert.match(config, /heavenEconomy\.coinGiftMinAmount/);
assert.match(config, /heavenEconomy\.coinGiftMaxAmount/);
assert.match(config, /heavenEconomy\.coinGiftButtonLabel/);
assert.doesNotMatch(config, /\{ key: 'heavenEconomy\.perksButtonLabel'/, 'VIP-Vorteile darf nicht mehr als Button-Einstellung erscheinen.');
assert.match(appRenderer, /data-vip-dm-studio="coinGiftReceived"/);
assert.match(appRenderer, /data-vip-dm-studio="coinGiftSent"/);
assert.match(appRenderer, /data-economy-panel-open-studio/);
assert.match(html, /economy-panel-studio\.js/);
assert.match(html, /id="import-content"/);
assert.match(html, /studio-json-import\.js/);
assert.match(studioJsonImport, /FHCCStudioJsonImport/);
assert.match(appRenderer, /FHCCStudioJsonImport\.create/);
assert.match(economyPanelStudio, /specialTemplate:\s*'economyPanel'/);
assert.match(economyPanelStudio, /heaven-economy\/panel-design/);
assert.match(economyPanelStudio, /componentSet:\s*'heavenEconomy'/);
assert.match(economyPanelStudio, /outsideImageAttachment:\s*source\.outsideImageAttachment\s*\?\s*cloneValue/, 'Das Economy-Studio muss die gespeicherte Außenbild-Referenz erneut laden.');
assert.match(economy, /import \{ buildStudioEmbedPayload \} from '\.\.\/runtime\/studioEmbedPayload\.js'/, 'Economy muss denselben zentralen Payload-Builder wie das normale Embed Studio verwenden.');
assert.doesNotMatch(economy, /fh-economy-asset-/, 'Economy darf keinen eigenen parallelen Bildrenderer mehr besitzen.');
assert.match(economyPanelStudio, /slice\(0,\s*10\)/, 'Das Economy-Studio muss bis zu zehn Embeds erhalten.');
assert.doesNotMatch(economyPanelStudio, /slice\(0,\s*1\)/, 'Das Economy-Studio darf nicht mehr auf ein Embed begrenzen.');
assert.match(appRenderer, /flexibleActivityInfo\s*=\s*state\.studioSpecialTemplate\s*===\s*'activityRace'\s*&&\s*state\.studioActivityRaceSection\s*===\s*'ping-info'/, 'Das Liga-Ping-Info-Studio muss Mehrfach-Embeds ausdrücklich freischalten.');
assert.match(appRenderer, /state\.studioSpecialTemplate\s*!==\s*'economyPanel'\s*&&\s*!flexibleActivityInfo/, 'Embed hinzufügen/entfernen muss in Economy und Liga-Ping-Info aktiv, in festen Automations-Embeds aber gesperrt bleiben.');
for (const placeholder of ['giverBalance', 'targetBalance', 'message', 'messageBlock', 'transactionId']) {
  assert.match(appRenderer, new RegExp(`\\{${placeholder}\\}`), `Studio-Platzhalter ${placeholder} fehlt.`);
}
assert.match(economy, /ECONOMY_REVISION_CONFLICT/);
assert.match(economy, /Heaven Economy Rollback/);

const mojibakePattern = /(?:\u00c3.|\u00c2.|\u00e2\u20ac|\u00f0\u0178)/;
for (const [name, source] of [['HTML', html], ['Renderer', renderer], ['Backend', economy]]) {
  assert.doesNotMatch(source, mojibakePattern, `${name} enthält beschädigte UTF-8-Zeichen.`);
}

console.log('Heaven-Economy-UI-Smoke bestanden: Verwaltung, Dialog, API, Themes und UTF-8 sind vollständig verdrahtet.');
