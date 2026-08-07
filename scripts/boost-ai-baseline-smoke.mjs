import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Collection } from 'discord.js';

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fh-boost-ai-'));
process.env.FALLEN_HEAVEN_DATA_DIR = dataDir;

const guildId = '111111111111111111';
const userId = '222222222222222222';
const cycleStartedAt = Date.now() - 30 * 24 * 60 * 60 * 1000;
await fs.writeFile(path.join(dataDir, 'boost-role-ledger.json'), JSON.stringify({
  version: 8,
  guilds: {
    [guildId]: {
      members: {
        [userId]: {
          count: 2,
          automaticCount: 2,
          active: true,
          source: 'discord-live',
          confidence: 'high',
          cycleStartedAt,
          evidenceMessageIds: []
        }
      },
      processedMessages: [],
      events: [],
      activityImport: {
        baselineCompletedAt: new Date().toISOString(),
        memberBaselines: {
          [userId]: {
            count: 2,
            snapshotAt: Date.now() - 1000,
            cycleStartedAt,
            source: 'manual-baseline-correction'
          }
        },
        rows: [],
        editAudit: []
      }
    }
  }
}), 'utf8');

const { getConfirmedMemberBoostCount } = await import(`../src/features/boostRoles.js?boost-ai-baseline=${Date.now()}`);
const member = {
  id: userId,
  displayName: 'FALLEN ANGEL',
  premiumSince: new Date(cycleStartedAt),
  premiumSinceTimestamp: cycleStartedAt,
  user: {
    id: userId,
    bot: false,
    username: 'fallenangel.sys',
    globalName: 'FALLEN ANGEL',
    displayAvatarURL: () => null
  }
};
const guild = {
  id: guildId,
  premiumSubscriptionCount: 53,
  members: {
    cache: new Collection([[userId, member]]),
    fetch: async (id) => id === userId ? member : null
  }
};

const result = await getConfirmedMemberBoostCount(guild, userId);
assert.equal(result.active, true);
assert.equal(result.count, 2, 'Die persönliche AI-Antwort muss den in der App bestätigten Wert verwenden.');
assert.equal(result.confirmedInApp, true);
assert.equal(result.confirmedBaselineCount, 2);
assert.equal(result.globalConsistencyState, 'mismatch', 'Der Test muss absichtlich eine globale Abweichung enthalten.');

await fs.rm(dataDir, { recursive: true, force: true });
console.log('Boost-AI-Baseline-Smoke: App-Basisstand bleibt trotz globaler Discord-Abweichung persönlich abrufbar.');
