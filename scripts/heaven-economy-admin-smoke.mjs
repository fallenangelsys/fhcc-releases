import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Collection } from 'discord.js';

const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fh-heaven-economy-'));
process.env.FALLEN_HEAVEN_DATA_DIR = temporaryRoot;

const { defaultGuildConfig, normalizeConfig } = await import(`../src/defaultConfig.js?smoke=${Date.now()}`);

const {
  getHeavenEconomyAdminSnapshot,
  updateHeavenEconomyAccount,
  buildHeavenEconomyComponents
} = await import(`../src/features/heavenEconomy.js?smoke=${Date.now()}`);

// Panel-Buttons editierbar (3.9.222-Prinzip).
{
  const custom = buildHeavenEconomyComponents({ heavenEconomy: {
    accountButtonLabel: 'Mein Konto', shopButtonLabel: 'Shop', giftButtonLabel: 'Schenken',
    coinGiftButtonLabel: 'Coins schenken',
    buyButtonLabel: 'Coins holen', progressButtonLabel: 'Boost', adminButtonLabel: 'Admin'
  } }).map((row) => row.components.map((b) => b.data.label));
  assert.deepEqual(custom, [['Mein Konto', 'Shop', 'Schenken', 'Coins schenken'], ['Coins holen', 'Boost', 'Admin']], 'VIP-Panel-Buttons editierbar');
  const defaults = buildHeavenEconomyComponents({ heavenEconomy: {} }).map((row) => row.components.map((b) => b.data.label));
  assert.deepEqual(defaults, [['Mein Konto', 'VIP-Shop', 'VIP verschenken', 'Coins verschenken'], ['Coins kaufen', 'Boost-Fortschritt', 'Coin-Verwaltung']], 'VIP-Panel-Buttons Defaults stabil');
  const disabled = buildHeavenEconomyComponents({ heavenEconomy: { coinGiftsEnabled: false } })
    .flatMap((row) => row.components.map((button) => button.data.custom_id));
  assert.equal(disabled.includes('fh_coin:coin-gift'), false, 'deaktivierte Coin-Geschenke verschwinden vollstaendig');
  assert.equal(disabled.includes('fh_coin:perks'), false, 'VIP-Vorteile ist kein separater Button mehr');
  console.log('  ✅ VIP-Panel: sieben Buttons, kein Vorteile-Button, deaktivierte Funktionen verschwinden');
}

const defaultEconomy = defaultGuildConfig('111111111111111111', 'FALLEN HEAVEN').heavenEconomy;
assert.equal(defaultEconomy.panelTemplate.embeds.length, 1, 'Economy besitzt eine editierbare Panelvorlage');
assert.ok(defaultEconomy.panelTemplate.embeds[0].title.includes('VIP'), 'Standardvorlage ist das VIP-Vorteile-Embed');
const normalizedPanelEmbeds = normalizeConfig({ heavenEconomy: { panelTemplate: { embeds: Array.from({ length: 12 }, (_, index) => ({ title: `Embed ${index + 1}` })) } } }).heavenEconomy.panelTemplate.embeds;
assert.equal(normalizedPanelEmbeds.length, 10, 'Guild-Config bewahrt bis zu zehn Economy-Embeds');
assert.equal(normalizedPanelEmbeds[9].title, 'Embed 10');
const normalizedGiftLimits = normalizeConfig({ heavenEconomy: { coinGiftMinAmount: 500, coinGiftMaxAmount: 100 } }).heavenEconomy;
assert.equal(normalizedGiftLimits.coinGiftMinAmount, 500);
assert.equal(normalizedGiftLimits.coinGiftMaxAmount, 500, 'Hoechstbetrag kann nie kleiner als der Mindestbetrag sein');

const userId = '123456789012345678';
const departedUserId = '333333333333333333';
const actorId = '987654321098765432';
const vipRoleId = '111111111111111111';
const requestedAvatarOptions = [];
const roleCache = new Collection();
const vipRole = { id: vipRoleId, name: 'VIP', managed: false, editable: true, position: 2 };
const member = {
  id: userId,
  displayName: 'Test Engel',
  premiumSince: null,
  user: {
    id: userId,
    username: 'test_engel',
    globalName: 'Test Engel',
    bot: false,
    displayAvatarURL: (options) => {
      requestedAvatarOptions.push(options || {});
      return 'https://cdn.discordapp.com/embed/avatars/0.png';
    }
  },
  roles: {
    cache: roleCache,
    async add(value) {
      for (const id of Array.isArray(value) ? value : [value]) roleCache.set(String(id), vipRole);
    },
    async remove(value) {
      for (const id of Array.isArray(value) ? value : [value]) roleCache.delete(String(id));
    }
  }
};

const members = new Collection([[userId, member]]);
const memberManager = {
  cache: members,
  fetch: async (value) => value ? members.get(String(value)) || null : members
};
const users = new Collection([[userId, member.user], [actorId, {
  id: actorId,
  username: 'owner',
  globalName: 'Owner',
  displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/1.png'
}]]);
const guild = {
  id: '222222222222222222',
  name: 'FALLEN HEAVEN TEST',
  memberCount: 1,
  members: memberManager,
  roles: { cache: new Collection([[vipRoleId, vipRole]]) },
  channels: { cache: new Collection(), fetch: async () => null },
  client: { users: { cache: users } }
};
member.guild = guild;

const cfg = {
  heavenEconomy: {
    enabled: true,
    coinEmoji: '🪙',
    boostMilestoneReward: 100,
    vipRoleMappings: [{ threshold: 500, roleId: vipRoleId }],
    logChannelId: ''
  }
};

const initial = await getHeavenEconomyAdminSnapshot({ guild, cfg });
assert(requestedAvatarOptions.some((options) => options.size === 128), 'VIP-Kontoliste muss ein scharfes 128-px-Avatar anfordern.');
assert(requestedAvatarOptions.every((options) => [16, 32, 64, 128, 256, 512, 1024, 2048, 4096].includes(options.size)), 'VIP-Panel darf nur von Discord.js unterstützte Avatargrößen anfordern.');
assert.equal(initial.schemaVersion, 3);
assert.equal(initial.rows.length, 1);
assert.equal(initial.rows[0].account.balance, 0);
assert.equal(initial.rows[0].vip, null);

const first = await updateHeavenEconomyAccount({
  guild,
  cfg,
  actorId,
  payload: {
    userId,
    balance: 600,
    boostRecord: 2,
    rewardedBoostLevels: [1, 2],
    vipRoleId,
    reason: 'Bestätigte Testkorrektur',
    expectedRevision: 0
  }
});
assert.equal(first.after.balance, 600);
assert.equal(first.after.earned, 600);
assert.deepEqual(first.after.rewardedBoostLevels, [1, 2]);
assert.equal(first.vipRoleId, vipRoleId);
assert.equal(roleCache.has(vipRoleId), true);
assert.equal(first.transaction.type, 'admin-account-correction');

await assert.rejects(
  updateHeavenEconomyAccount({
    guild,
    cfg,
    actorId,
    payload: {
      userId,
      balance: 700,
      boostRecord: 2,
      rewardedBoostLevels: [1, 2],
      vipRoleId,
      reason: 'Veraltete Änderung',
      expectedRevision: 0
    }
  }),
  /inzwischen geändert/
);

const second = await updateHeavenEconomyAccount({
  guild,
  cfg,
  actorId,
  payload: {
    userId,
    balance: 500,
    boostRecord: 2,
    rewardedBoostLevels: [1],
    vipRoleId: '',
    reason: 'Zweite bestätigte Testkorrektur',
    expectedRevision: 1
  }
});
assert.equal(second.after.balance, 500);
assert.equal(second.after.spent, 100);
assert.deepEqual(second.after.rewardedBoostLevels, [1]);
assert.equal(roleCache.has(vipRoleId), false);

await updateHeavenEconomyAccount({
  guild,
  cfg,
  actorId,
  payload: {
    userId: departedUserId,
    balance: 100,
    boostRecord: 0,
    rewardedBoostLevels: [],
    vipRoleId: '',
    reason: 'Historisches Konto eines ausgetretenen Mitglieds',
    expectedRevision: 0
  }
});

const finalSnapshot = await getHeavenEconomyAdminSnapshot({ guild, cfg });
assert.equal(finalSnapshot.summary.accounts, 1);
assert.equal(finalSnapshot.summary.storedAccounts, 2);
assert.equal(finalSnapshot.summary.totalBalance, 500);
assert.equal(finalSnapshot.summary.transactions, 2);
assert.equal(finalSnapshot.summary.storedTransactions, 3);
assert.equal(finalSnapshot.rows.length, 1, 'Ehemalige Mitglieder dürfen nicht in der VIP-Kontoliste erscheinen.');
assert.equal(finalSnapshot.rows.some((row) => row.id === departedUserId), false);
assert.equal(finalSnapshot.transactions.some((entry) => entry.userId === departedUserId), false, 'Ehemalige Mitglieder dürfen nicht im sichtbaren VIP-Audit erscheinen.');
assert.equal(finalSnapshot.rows[0].account.revision, 2);
assert.equal(finalSnapshot.rows[0].vip, null);

const stored = JSON.parse(await fs.readFile(path.join(temporaryRoot, 'heaven-economy.json'), 'utf8'));
assert.equal(stored.version, 3);
assert.equal(stored.guilds[guild.id].accounts[userId].balance, 500);
assert.equal(stored.guilds[guild.id].accounts[departedUserId].balance, 100, 'Historische Kontodaten bleiben für einen Wiedereintritt erhalten.');

await fs.rm(temporaryRoot, { recursive: true, force: true });
console.log('Heaven-Economy-Smoke-Test bestanden: VIP, Coins, Boost-Meilensteine, Audit und Revisionsschutz sind konsistent.');
