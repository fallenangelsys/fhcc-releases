import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Collection } from 'discord.js';

const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fh-boost-economy-'));
process.env.FALLEN_HEAVEN_DATA_DIR = temporaryRoot;

const guildId = '222222222222222222';
const userId = '123456789012345678';
const cycleStartedAt = Date.now() - 60_000;
await fs.writeFile(path.join(temporaryRoot, 'boost-role-ledger.json'), JSON.stringify({
  version: 8,
  guilds: {
    [guildId]: {
      processedMessages: ['boost-message-1', 'boost-message-2'],
      events: [1, 2].map((level) => ({
        messageId: `boost-message-${level}`,
        userId,
        type: 'boost',
        source: 'native-system',
        discordMessageType: 8,
        timestamp: cycleStartedAt + (level * 1000),
        delta: 1,
        reportedCount: level,
        accepted: true
      })),
      members: {
        [userId]: {
          count: 2,
          automaticCount: 2,
          active: true,
          source: 'native-system',
          confidence: 'high',
          cycleStartedAt,
          evidenceMessageIds: ['boost-message-1', 'boost-message-2']
        }
      }
    }
  }
}, null, 2), 'utf8');

const boostRoles = await import(`../src/features/boostRoles.js?reliability=${Date.now()}`);
const economy = await import(`../src/features/heavenEconomy.js?reliability=${Date.now()}`);

const member = {
  id: userId,
  displayName: 'Zweifach-Booster',
  premiumSince: new Date(cycleStartedAt),
  premiumSinceTimestamp: cycleStartedAt,
  user: {
    id: userId,
    username: 'two_boosts',
    bot: false,
    displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png'
  },
  roles: { cache: new Collection() }
};
const members = new Collection([[userId, member]]);
const guild = {
  id: guildId,
  name: 'FALLEN HEAVEN TEST',
  premiumSubscriptionCount: 2,
  memberCount: 1,
  members: {
    cache: members,
    fetch: async (value) => {
      if (!value) return members;
      const id = typeof value === 'object' ? value.user : value;
      return members.get(String(id)) || null;
    }
  },
  roles: { cache: new Collection() },
  channels: { cache: new Collection(), fetch: async () => null },
  client: { users: { cache: new Collection([[userId, member.user]]) } }
};
member.guild = guild;

const cfg = {
  boostRoles: { enabled: true },
  heavenEconomy: { enabled: true, boostMilestoneReward: 100, vipRoleMappings: [], logChannelId: '' }
};

assert.equal(typeof boostRoles.feature.onBotMessageCreate, 'function', 'Boost-Info- und Verlust-Botnachrichten müssen live verarbeitet werden.');
const processed = await boostRoles.waitForBoostLedgerEvent(guildId, 'boost-message-2', 100);
assert.equal(processed.processed, true, 'Economy muss auf die persistierte Boost-Ereignis-ID warten können.');

const first = await economy.reconcileHeavenEconomyBoostMilestones({ guild, cfg, source: 'smoke' });
assert.equal(first.status, 'completed');
assert.equal(first.checkedAccounts, 1);
assert.equal(first.creditedAccounts, 1);
assert.equal(first.creditedLevels, 2);
assert.equal(first.creditedCoins, 200);

const second = await economy.reconcileHeavenEconomyBoostMilestones({ guild, cfg, source: 'smoke-repeat' });
assert.equal(second.status, 'completed');
assert.equal(second.creditedAccounts, 0);
assert.equal(second.creditedCoins, 0, 'Ein wiederholter Abgleich darf niemals dieselben Boost-Stufen doppelt vergüten.');

const snapshot = await economy.getHeavenEconomyAdminSnapshot({ guild, cfg });
assert.equal(snapshot.rows[0].activeBoostCount, 2);
assert.equal(snapshot.rows[0].account.balance, 200);
assert.deepEqual(snapshot.rows[0].account.rewardedBoostLevels, [1, 2]);
assert.equal(snapshot.rows[0].boostMilestones.pendingCoins, 0);
assert.equal(snapshot.summary.pendingBoostMilestones, 0);
assert.equal(snapshot.summary.boostConsistencyState, 'synchronized');

await fs.rm(temporaryRoot, { recursive: true, force: true });
console.log('Boost-Economy-Reliability-Smoke bestanden: Bot-Quellen, Ereignisbarriere, 2x-Gutschrift und Wiederholschutz funktionieren.');
