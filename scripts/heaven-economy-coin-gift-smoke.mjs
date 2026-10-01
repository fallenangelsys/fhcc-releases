#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Collection } from 'discord.js';

const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fh-coin-gifts-'));
process.env.FALLEN_HEAVEN_DATA_DIR = temporaryRoot;

const {
  buildHeavenEconomyComponents,
  completeCoinGiftTransfer,
  createCoinGiftIntent,
  feature,
  getHeavenEconomyAdminSnapshot,
  updateHeavenEconomyAccount
} = await import(`../src/features/heavenEconomy.js?smoke=${Date.now()}`);

const senderId = '111111111111111111';
const recipientId = '222222222222222222';
const botId = '333333333333333333';
const actorId = '999999999999999999';
const makeMember = (id, name, bot = false) => ({
  id,
  displayName: name,
  user: { id, username: name.toLowerCase(), globalName: name, bot, displayAvatarURL: () => '' },
  roles: { cache: new Collection() }
});
const sender = makeMember(senderId, 'Sender');
const recipient = makeMember(recipientId, 'Empfaenger');
const bot = makeMember(botId, 'Bot', true);
const members = new Collection([[senderId, sender], [recipientId, recipient], [botId, bot]]);
const guild = {
  id: '444444444444444444',
  name: 'FALLEN HEAVEN TEST',
  memberCount: members.size,
  premiumSubscriptionCount: 0,
  members: { cache: members, fetch: async (id) => id ? members.get(String(id)) || null : members },
  roles: { cache: new Collection() },
  channels: { cache: new Collection(), fetch: async () => null },
  client: { users: { cache: new Collection(members.map((member) => [member.id, member.user])) } }
};
for (const member of members.values()) member.guild = guild;

const cfg = { heavenEconomy: {
  enabled: true,
  coinGiftsEnabled: true,
  coinGiftMinAmount: 1,
  coinGiftMaxAmount: 100000,
  coinGiftButtonLabel: 'Coins verschenken',
  vipRoleMappings: [],
  logChannelId: ''
} };

const labels = buildHeavenEconomyComponents(cfg).flatMap((row) => row.components.map((button) => button.data.label));
assert.ok(labels.includes('Coins verschenken'), 'Panel enthaelt den funktionalen Coin-Geschenk-Button');

await updateHeavenEconomyAccount({
  guild,
  cfg,
  actorId,
  payload: { userId: senderId, balance: 1000, boostRecord: 0, rewardedBoostLevels: [], vipRoleId: '', reason: 'Testguthaben', expectedRevision: 0 }
});

await assert.rejects(
  createCoinGiftIntent({ guild, cfg, senderId, recipientId: senderId, amount: 10 }),
  /selbst/i
);
await assert.rejects(
  createCoinGiftIntent({ guild, cfg, senderId, recipientId: botId, amount: 10 }),
  /Bot/i
);
await assert.rejects(
  createCoinGiftIntent({ guild, cfg, senderId, recipientId, amount: 0 }),
  /mindestens/i
);

const intent = await createCoinGiftIntent({
  guild,
  cfg,
  senderId,
  recipientId,
  amount: 275,
  message: 'Viel Freude damit!'
});
assert.match(intent.token, /^[a-f0-9]{24}$/);
assert.equal(intent.senderBalanceBefore, 1000);
assert.equal(intent.senderBalanceAfter, 725);

const first = await completeCoinGiftTransfer({ guild, cfg, token: intent.token, interactionId: 'confirm-1' });
assert.equal(first.ok, true);
assert.equal(first.amount, 275);
assert.equal(first.sender.balance, 725);
assert.equal(first.sender.giftedCoins, 275);
assert.equal(first.recipient.balance, 275);
assert.equal(first.recipient.receivedGiftCoins, 275);
assert.equal(first.transaction.type, 'coin-gift');
assert.equal(first.transaction.senderId, senderId);
assert.equal(first.transaction.recipientId, recipientId);
assert.equal(first.message, 'Viel Freude damit!');

const duplicate = await completeCoinGiftTransfer({ guild, cfg, token: intent.token, interactionId: 'confirm-1' });
assert.equal(duplicate.duplicate, true, 'dieselbe Bestaetigung bucht kein zweites Mal');

const snapshot = await getHeavenEconomyAdminSnapshot({ guild, cfg });
const senderRow = snapshot.rows.find((row) => row.id === senderId);
const recipientRow = snapshot.rows.find((row) => row.id === recipientId);
assert.equal(senderRow.account.balance + recipientRow.account.balance, 1000, 'Transfer erhaelt die Coin-Gesamtsumme');
assert.equal(snapshot.transactions[0].transactionId || snapshot.transactions[0].id, first.transaction.id);
assert.equal(snapshot.transactions[0].message, undefined, 'persoenliche Nachricht wird nicht im Audit gespeichert');

const stored = JSON.parse(await fs.readFile(path.join(temporaryRoot, 'heaven-economy.json'), 'utf8'));
assert.equal(stored.version, 3);
assert.equal(Object.keys(stored.guilds[guild.id].pendingCoinGifts || {}).length, 0, 'verbrauchte Auftraege werden entfernt');

let response = null;
await feature.onAnyInteraction({ interaction: {
  customId: 'fh_coin:coin-gift', guild, guildId: guild.id, member: sender, user: sender.user,
  isButton: () => true, isStringSelectMenu: () => false, isUserSelectMenu: () => false, isModalSubmit: () => false,
  reply: async (payload) => { response = payload; }
}, cfg });
assert.equal(response.components[0].components[0].data.custom_id, 'fh_coin:coin-gift-user');

let shownModal = null;
await feature.onAnyInteraction({ interaction: {
  customId: 'fh_coin:coin-gift-user', values: [recipientId], guild, guildId: guild.id, member: sender, user: sender.user,
  isButton: () => false, isStringSelectMenu: () => false, isUserSelectMenu: () => true, isModalSubmit: () => false,
  showModal: async (modal) => { shownModal = modal; }
}, cfg });
assert.equal(shownModal.data.custom_id, `fh_coin:coin-gift-modal:${recipientId}`);
assert.deepEqual(shownModal.components.map((row) => row.components[0].data.custom_id), ['amount', 'message']);

response = null;
await feature.onAnyInteraction({ interaction: {
  id: 'modal-1', customId: `fh_coin:coin-gift-modal:${recipientId}`, guild, guildId: guild.id, member: sender, user: sender.user,
  isButton: () => false, isStringSelectMenu: () => false, isUserSelectMenu: () => false, isModalSubmit: () => true,
  fields: { getTextInputValue: (key) => key === 'amount' ? '25' : 'Danke!' },
  reply: async (payload) => { response = payload; }
}, cfg });
assert.ok(response.content.includes('25 Coins'));
assert.ok(response.content.includes('Empfaenger'));
assert.match(response.components[0].components[0].data.custom_id, /^fh_coin:coin-gift-confirm:[a-f0-9]{24}$/);
assert.match(response.components[0].components[1].data.custom_id, /^fh_coin:coin-gift-cancel:[a-f0-9]{24}$/);

await fs.rm(temporaryRoot, { recursive: true, force: true });
console.log('Heaven-Economy-Coin-Gift-Smoke bestanden: Transfer, Limits, Audit und Deduplizierung sind konsistent.');
