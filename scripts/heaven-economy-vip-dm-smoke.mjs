#!/usr/bin/env node
/**
 * Smoke-Test: VIP-Trennerrolle + editierbare VIP-DM-Embeds (Heaven Economy).
 * Verifiziert:
 *  1. Default-Config: separatorRoleName/-Id + 6 DM-Sektionen vorhanden.
 *  2. normalizeConfig erhält Separator-Felder und DM-Designs.
 *  3. saveEconomyDmDesign normalisiert eine Sektion und behält andere.
 *  4. sendEconomyDm sendet genau EIN DM und editiert die bestehende Nachricht
 *     statt eine zweite zu stapeln (kein DM-Spam).
 *  5. syncVipSeparatorRole vergibt die Trennerrolle an VIP-Mitglieder und
 *     entzieht sie Mitgliedern ohne VIP-Stufe.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fh-economy-dm-'));
process.env.FALLEN_HEAVEN_DATA_DIR = temporaryRoot;

const { defaultGuildConfig, normalizeConfig } = await import(`../src/defaultConfig.js?smoke=${Date.now()}`);
const {
  saveEconomyDmDesign,
  sendEconomyDm,
  syncVipSeparatorRole
} = await import(`../src/features/heavenEconomy.js?smoke=${Date.now()}`);

/* ------------------------- 1. Config-Defaults --------------------------- */
const base = defaultGuildConfig('111111111111111111', 'FALLEN HEAVEN');
assert.equal(base.heavenEconomy.separatorRoleName, '━━ VIP ━━');
assert.equal(base.heavenEconomy.separatorRoleId, '');
assert.deepEqual(Object.keys(base.heavenEconomy.dmDesigns || {}).sort(), [
  'boostMilestone', 'coinGiftReceived', 'coinGiftSent', 'coinsReceived', 'giftReceived', 'vipPurchased'
]);
assert.ok(base.heavenEconomy.dmDesigns.giftReceived.description.includes('{targetMention}'));
assert.ok(base.heavenEconomy.dmDesigns.giftReceived.description.includes('{tier}'));
assert.ok(base.heavenEconomy.dmDesigns.coinsReceived.description.includes('{coins}'));
assert.ok(base.heavenEconomy.dmDesigns.boostMilestone.description.includes('{levels}'));
assert.ok(base.heavenEconomy.dmDesigns.vipPurchased.description.includes('{price}'));
assert.ok(base.heavenEconomy.dmDesigns.coinGiftReceived.description.includes('{giverMention}'));
assert.ok(base.heavenEconomy.dmDesigns.coinGiftSent.description.includes('{transactionId}'));

/* ------------------- 2. normalizeConfig erhält alles --------------------- */
const normalized = normalizeConfig({
  heavenEconomy: {
    enabled: true,
    separatorRoleId: 'sep-1',
    dmDesigns: {
      giftReceived: { title: 'EIGENES GESCHENK', color: '#123456' }
    }
  }
});
assert.equal(normalized.heavenEconomy.separatorRoleId, 'sep-1');
assert.equal(normalized.heavenEconomy.separatorRoleName, '━━ VIP ━━');
assert.equal(normalized.heavenEconomy.dmDesigns.giftReceived.title, 'EIGENES GESCHENK');
assert.equal(normalized.heavenEconomy.dmDesigns.giftReceived.color, '#123456');
// Andere Sektionen fallen auf Defaults zurück.
assert.ok(normalized.heavenEconomy.dmDesigns.coinsReceived.title.includes('Coins'));
assert.ok(normalized.heavenEconomy.dmDesigns.vipPurchased.title.includes('VIP'));
assert.ok(normalized.heavenEconomy.dmDesigns.coinGiftReceived.title.includes('Coins'));

/* --------------------- 3. saveEconomyDmDesign ---------------------------- */
const designGuild = { id: 'g-design' };
const saved = await saveEconomyDmDesign({
  guild: designGuild,
  cfg: { heavenEconomy: { dmDesigns: { coinsReceived: { title: 'ALT' } } } },
  section: 'boostMilestone',
  template: {
    embeds: [{
      title: '⚡ NEUE BELOHNUNG',
      description: '**{targetMention}** – du hast {coins} erhalten.',
      color: '#57f287',
      footerText: 'NEUER FOOTER',
      fields: [{ name: 'Transaktion {transactionId}', value: '{giverBalance} → {targetBalance}', inline: true }]
    }]
  }
});
assert.equal(saved.section, 'boostMilestone');
assert.equal(saved.normalizedDesign.boostMilestone.title, '⚡ NEUE BELOHNUNG');
assert.equal(saved.normalizedDesign.boostMilestone.color, '#57f287');
assert.equal(saved.normalizedDesign.boostMilestone.footerText, 'NEUER FOOTER');
assert.deepEqual(saved.normalizedDesign.boostMilestone.fields, [{ name: 'Transaktion {transactionId}', value: '{giverBalance} → {targetBalance}', inline: true }]);
// Bestehende coinsReceived-Designs bleiben unangetastet.
assert.equal(saved.normalizedDesign.coinsReceived.title, 'ALT');
// Unbekannte Sektionen werden auf die erste bekannte Sektion zurückgeführt.
const unknown = await saveEconomyDmDesign({
  guild: designGuild,
  cfg: { heavenEconomy: {} },
  section: 'doesNotExist',
  template: { embeds: [{ title: 'X' }] }
});
assert.equal(unknown.section, 'giftReceived');

/* ---------------------- 4. sendEconomyDm (kein Spam) --------------------- */
const makeDmChannel = (id) => {
  const channel = {
    id,
    messages: new Map(),
    async fetch(messageId) {
      return channel.messages.get(String(messageId)) || null;
    },
    async send(payload) {
      const message = { id: 'msg-' + (channel.messages.size + 1), author: { id: 'bot-1' }, payload };
      channel.messages.set(message.id, message);
      return message;
    }
  };
  channel.messages.fetch = async (messageId) => channel.fetch(messageId);
  return channel;
};
const dmChannel = makeDmChannel('dm-chan-1');
const dmEditChannel = makeDmChannel('dm-chan-2');
const usersCache = new Map([
  ['u-1', { id: 'u-1', username: 'max', bot: false, createDM: async () => dmChannel }],
  ['u-2', { id: 'u-2', username: 'lina', bot: false, createDM: async () => dmEditChannel }]
]);
const channelsCache = new Map([['dm-chan-1', dmChannel], ['dm-chan-2', dmEditChannel]]);
const client = {
  user: { id: 'bot-1' },
  users: {
    cache: usersCache,
    fetch: async (id) => usersCache.get(String(id)) || null
  },
  channels: {
    cache: channelsCache,
    fetch: async (id) => channelsCache.get(String(id)) || null
  }
};
const dmGuild = { id: 'g-dm', name: 'FALLEN HEAVEN', client };
const dmCfg = { heavenEconomy: { enabled: true, dmDesigns: {} } };

const first = await sendEconomyDm({
  guild: dmGuild,
  cfg: dmCfg,
  userId: 'u-1',
  section: 'coinsReceived',
  context: { coins: '500 Coins', balance: '1.200 Coins' }
});
// edit() muss auf der gespeicherten Nachricht verfügbar sein (edit statt neuer send).
for (const message of dmChannel.messages.values()) {
  message.edit = async (payload) => { message.payload = payload; return message; };
}
assert.equal(first.sent, true, 'erste DM wird gesendet');
assert.ok(first.messageId);
const firstPayload = dmChannel.messages.get(first.messageId).payload;
assert.ok(firstPayload.embeds[0].data.title.includes('Coins'), 'Titel stammt aus Default-Design');
assert.ok(firstPayload.embeds[0].data.description.includes('<@u-1>'), 'echter Mention im Embed');
assert.ok(firstPayload.embeds[0].data.description.includes('500 Coins'), 'Kontext-Ersetzung funktioniert');

const second = await sendEconomyDm({
  guild: dmGuild,
  cfg: dmCfg,
  userId: 'u-1',
  section: 'coinsReceived',
  context: { coins: '250 Coins', balance: '1.450 Coins' }
});
assert.equal(second.edited, true, 'zweite DM editiert statt neu zu senden');
assert.equal(second.messageId, first.messageId, 'gleiche Nachricht wird editiert');
assert.equal(dmChannel.messages.size, 1, 'es existiert genau EINE DM-Nachricht');

// Verschiedene Sektionen stapeln nicht: Neues Geschenk-Embed wird zusätzlich
// gesendet (eigene Nachricht), damit keine Information verloren geht.
const gift = await sendEconomyDm({
  guild: dmGuild,
  cfg: dmCfg,
  userId: 'u-2',
  section: 'giftReceived',
  context: { tier: 'VIP: GOLD', giver: 'Lena' }
});
assert.equal(gift.sent, true);
assert.ok(gift.messageId);
const giftPayload = dmEditChannel.messages.get(gift.messageId).payload;
assert.ok(giftPayload.embeds[0].data.title.includes('geschenkt'));
assert.ok(giftPayload.embeds[0].data.description.includes('VIP: GOLD'));
assert.ok(giftPayload.embeds[0].data.description.includes('Lena'));

const receiptOne = await sendEconomyDm({
  guild: dmGuild,
  cfg: { heavenEconomy: { dmDesigns: { coinGiftSent: {
    title: 'Geschenk {transactionId}',
    description: '{target} erhielt {coins}. Nachricht: {message}',
    fields: [{ name: 'Kontostaende', value: '{giverBalance} / {targetBalance}', inline: true }]
  } } } },
  userId: 'u-2',
  section: 'coinGiftSent',
  forceNew: true,
  context: {
    target: 'Max', coins: '25 Coins', message: 'Viel Freude', transactionId: 'FH-TEST',
    giverBalance: '75 Coins', targetBalance: '25 Coins'
  }
});
const receiptTwo = await sendEconomyDm({
  guild: dmGuild,
  cfg: dmCfg,
  userId: 'u-2',
  section: 'coinGiftSent',
  forceNew: true,
  context: { transactionId: 'FH-TEST-2' }
});
assert.notEqual(receiptOne.messageId, receiptTwo.messageId, 'Transaktions-DMs werden nicht ueberschrieben');
const receiptPayload = dmEditChannel.messages.get(receiptOne.messageId).payload.embeds[0].data;
assert.equal(receiptPayload.title, 'Geschenk FH-TEST');
assert.ok(receiptPayload.description.includes('Viel Freude'));
assert.deepEqual(receiptPayload.fields, [{ name: 'Kontostaende', value: '75 Coins / 25 Coins', inline: true }]);

await Promise.all([
  sendEconomyDm({ guild: dmGuild, cfg: dmCfg, userId: 'u-1', section: 'coinGiftReceived', forceNew: true, context: { transactionId: 'PAR-A' } }),
  sendEconomyDm({ guild: dmGuild, cfg: dmCfg, userId: 'u-2', section: 'coinGiftSent', forceNew: true, context: { transactionId: 'PAR-B' } })
]);
const parallelStore = JSON.parse(await fs.readFile(path.join(temporaryRoot, 'heaven-economy.json'), 'utf8'));
assert.ok(parallelStore.guilds['g-dm'].dmMessages['u-1'].coinGiftReceived, 'parallele Empfaenger-DM bleibt gespeichert');
assert.ok(parallelStore.guilds['g-dm'].dmMessages['u-2'].coinGiftSent, 'parallele Absender-DM bleibt gespeichert');

/* ------------------ 5. syncVipSeparatorRole (Trennerrolle) ---------------- */
const vipRoleId = '222222222222222222';
const goldRoleId = '333333333333333333';
const separatorRoleId = '444444444444444444';
const rolesCache = new Map([
  [vipRoleId, { id: vipRoleId, name: 'VIP', managed: false, editable: true, position: 1 }],
  [goldRoleId, { id: goldRoleId, name: 'VIP: GOLD', managed: false, editable: true, position: 2 }],
  [separatorRoleId, { id: separatorRoleId, name: '━━ VIP ━━', managed: false, editable: true, position: 3 }]
]);
const makeMember = (id, roleIds) => ({
  id,
  user: { id, bot: false },
  roles: {
    cache: new Map(roleIds.map((roleId) => [roleId, rolesCache.get(roleId)]))
  }
});
const vipMember = makeMember('m-vip', [vipRoleId]);
const goldMember = makeMember('m-gold', [goldRoleId, separatorRoleId]); // hat Trenner schon
const normalMember = makeMember('m-normal', [separatorRoleId]); // VIP verloren → Trenner muss weg
const applyHistory = [];
const membersCache = new Map([
  ['m-vip', vipMember],
  ['m-gold', goldMember],
  ['m-normal', normalMember]
]);
const syncGuild = {
  id: 'g-sync',
  name: 'FALLEN HEAVEN',
  roles: { cache: rolesCache },
  members: { cache: membersCache }
};
const syncCfg = {
  heavenEconomy: {
    enabled: true,
    separatorRoleId,
    vipRoleMappings: [`500=${vipRoleId}`, `4000=${goldRoleId}`]
  }
};
// applyManagedRolePolicy erwartet member.guild + fetch – minimal mocken.
for (const member of membersCache.values()) {
  member.guild = {
    id: 'g-sync',
    members: { me: { id: 'bot-1', roles: { highest: { position: 99 } }, permissions: { has: () => true } }, fetch: async () => member },
    roles: { cache: rolesCache }
  };
  member.manageable = true;
  member.roles.add = async (ids, reason) => {
    for (const id of Array.isArray(ids) ? ids : [ids]) member.roles.cache.set(String(id), rolesCache.get(String(id)));
    applyHistory.push({ member: member.id, action: 'add', ids: [].concat(ids), reason });
    return member;
  };
  member.roles.remove = async (ids, reason) => {
    for (const id of Array.isArray(ids) ? ids : [ids]) member.roles.cache.delete(String(id));
    applyHistory.push({ member: member.id, action: 'remove', ids: [].concat(ids), reason });
    return member;
  };
}
const syncResult = await syncVipSeparatorRole({ guild: syncGuild, cfg: syncCfg });
assert.equal(syncResult.ok, true);
assert.equal(syncResult.granted, 1, 'genau ein Mitglied erhält die Trennerrolle neu');
assert.equal(syncResult.removed, 1, 'genau ein Mitglied verliert die Trennerrolle');
assert.equal(vipMember.roles.cache.has(separatorRoleId), true, 'VIP-Mitglied hat jetzt die Trennerrolle');
assert.equal(normalMember.roles.cache.has(separatorRoleId), false, 'Nicht-VIP hat keine Trennerrolle');
assert.equal(goldMember.roles.cache.has(separatorRoleId), true, 'VIP mit Trenner behält sie');
assert.ok(applyHistory.some((entry) => entry.member === 'm-vip' && entry.action === 'add'));
assert.ok(applyHistory.some((entry) => entry.member === 'm-normal' && entry.action === 'remove'));

// Ohne konfigurierte Rolle oder bei deaktiviertem Modul: kein Abgleich.
const inactive = await syncVipSeparatorRole({ guild: syncGuild, cfg: { heavenEconomy: { enabled: false, separatorRoleId } } });
assert.equal(inactive.ok, false);
const unconfigured = await syncVipSeparatorRole({ guild: syncGuild, cfg: { heavenEconomy: { enabled: true, separatorRoleId: '' } } });
assert.equal(unconfigured.ok, false);

console.log('Heaven-Economy-VIP-DM-Smoke bestanden: Trennerrolle, DM-Designs, DM-Deduplizierung und Separator-Abgleich sind konsistent.');
