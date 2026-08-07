import assert from 'node:assert/strict';

import { defaultGuildConfig, normalizeConfig } from '../src/defaultConfig.js';
import {
  applyManagedRoleChanges,
  calculateActivityBaselineCount,
  calculateVerifiedBoostCount,
  evaluateBoostConsistency,
  parseBoostInfoMessage,
  parseTrustedBoostLossMessage,
  resolveManagedBoosterRoles
} from '../src/features/boostRoles.js';
import { calculateBoostMilestoneCredit } from '../src/features/heavenEconomy.js';

const baseRole = '111111111111111111';
const secondBaseRole = '222222222222222222';
const firstTierRole = '333333333333333333';
const secondTierRole = '444444444444444444';
const fifthTierRole = '777777777777777777';
const tenthTierRole = '888888888888888888';

const firstBoost = resolveManagedBoosterRoles({
  active: true,
  boostCount: 1,
  automaticRoleIds: [baseRole, secondBaseRole],
  tierRoleMappings: [`1=${firstTierRole}`, `2=${secondTierRole}`]
});
assert.deepEqual(firstBoost.wantedRoleIds, [baseRole, secondBaseRole, firstTierRole]);

const secondBoost = resolveManagedBoosterRoles({
  active: true,
  boostCount: 2,
  automaticRoleIds: [baseRole, secondBaseRole],
  tierRoleMappings: [`1=${firstTierRole}`, `2=${secondTierRole}`],
  cumulativeRoles: false
});
assert.deepEqual(secondBoost.wantedRoleIds, [baseRole, secondBaseRole, secondTierRole]);

const cumulative = resolveManagedBoosterRoles({
  active: true,
  boostCount: 2,
  automaticRoleIds: [baseRole],
  tierRoleMappings: [`1=${firstTierRole}`, `2=${secondTierRole}`],
  cumulativeRoles: true
});
assert.deepEqual(cumulative.wantedRoleIds, [baseRole, firstTierRole, secondTierRole]);

const ended = resolveManagedBoosterRoles({
  active: false,
  boostCount: 0,
  automaticRoleIds: [baseRole, secondBaseRole],
  tierRoleMappings: [`1=${firstTierRole}`, `2=${secondTierRole}`]
});
assert.deepEqual(ended.wantedRoleIds, []);
assert.deepEqual(ended.managedRoleIds, [baseRole, secondBaseRole, firstTierRole, secondTierRole]);

const replacedRole = resolveManagedBoosterRoles({
  active: true,
  boostCount: 1,
  automaticRoleIds: [secondBaseRole],
  previousManagedRoleIds: [baseRole]
});
assert.deepEqual(replacedRole.wantedRoleIds, [secondBaseRole]);
assert.deepEqual(replacedRole.managedRoleIds, [secondBaseRole, baseRole]);

const roleMutationCalls = [];
const memberAfterRemoval = {
  roles: {
    add: async (roles, reason) => {
      roleMutationCalls.push({ operation: 'add', roles, reason, member: 'after-removal' });
      return { id: 'member-after-add', roles: {} };
    }
  }
};
const memberBeforeRemoval = {
  roles: {
    remove: async (roles, reason) => {
      roleMutationCalls.push({ operation: 'remove', roles, reason, member: 'before-removal' });
      return memberAfterRemoval;
    },
    add: async () => {
      throw new Error('Die Hinzufügung darf nicht den veralteten Rollen-Cache verwenden.');
    }
  }
};
const memberAfterRoleMutation = await applyManagedRoleChanges({
  member: memberBeforeRemoval,
  toRemove: [fifthTierRole],
  toAdd: [secondTierRole],
  reason: 'Smoke Test'
});
assert.equal(memberAfterRoleMutation.id, 'member-after-add');
assert.deepEqual(roleMutationCalls, [
  { operation: 'remove', roles: [fifthTierRole], reason: 'Smoke Test', member: 'before-removal' },
  { operation: 'add', roles: [secondTierRole], reason: 'Smoke Test', member: 'after-removal' }
]);

const activityWithoutVisibleCycleStart = calculateActivityBaselineCount({
  active: true,
  cycleDateKey: '2026-06-09',
  todayDateKey: '2026-07-27',
  rows: [
    { action: 'given', dateKey: '2026-06-14' },
    { action: 'expired', dateKey: '2026-06-26' },
    { action: 'given', dateKey: '2026-07-17' }
  ]
});
assert.equal(activityWithoutVisibleCycleStart, 2);

const activityWithVisibleCycleStart = calculateActivityBaselineCount({
  active: true,
  cycleDateKey: '2026-06-14',
  todayDateKey: '2026-07-27',
  rows: [
    { action: 'given', dateKey: '2026-06-14' },
    { action: 'expired', dateKey: '2026-06-26' },
    { action: 'given', dateKey: '2026-07-17' }
  ]
});
assert.equal(activityWithVisibleCycleStart, 1);

const normalized = normalizeConfig({
  ...defaultGuildConfig('guild', 'Smoke Test'),
  boostRoles: {
    enabled: true,
    automaticRoleIds: `${baseRole}\n${secondBaseRole}`,
    tierRoleMappings: [`1=${firstTierRole}`]
  }
});
assert.equal(normalized.boostRoles.enabled, true);
assert.deepEqual(normalized.boostRoles.automaticRoleIds, [baseRole, secondBaseRole]);
assert.deepEqual(normalized.boostRoles.tierRoleMappings, [`1=${firstTierRole}`]);

const currentCycleStartedAt = Date.now() - 60_000;
const restoredSecondBoost = calculateVerifiedBoostCount({
  userId: '555555555555555555',
  premiumSinceTimestamp: currentCycleStartedAt,
  hasSystemBoosterRole: true,
  events: [{
    id: '666666666666666666',
    messageId: '666666666666666666',
    userId: '555555555555555555',
    type: 'boost',
    source: 'native-system-index',
    discordMessageType: 8,
    timestamp: currentCycleStartedAt + 1_000,
    reportedCount: 2
  }]
});
assert.equal(restoredSecondBoost, 2);

const sixBoostEvents = Array.from({ length: 6 }, (_, index) => ({
  id: `event-${index + 1}`,
  messageId: `event-${index + 1}`,
  userId: '555555555555555555',
  type: 'boost',
  source: 'native-system-index',
  discordMessageType: 8,
  timestamp: currentCycleStartedAt + 1_000 + index,
  reportedCount: index + 1
}));
const verifiedSixBoosts = calculateVerifiedBoostCount({
  userId: '555555555555555555',
  premiumSinceTimestamp: currentCycleStartedAt,
  hasSystemBoosterRole: true,
  events: sixBoostEvents
});
assert.equal(verifiedSixBoosts, 6);

const baselineSnapshotAt = currentCycleStartedAt + 20_000;
const importedBaseline = {
  version: 2,
  snapshotAt: baselineSnapshotAt,
  memberBaselines: {
    '555555555555555555': {
      count: 2,
      snapshotAt: baselineSnapshotAt,
      cycleStartedAt: currentCycleStartedAt
    }
  },
  rows: []
};
const oldAndNewEvents = [{
  id: 'before-baseline',
  messageId: 'before-baseline',
  userId: '555555555555555555',
  type: 'boost',
  source: 'native-system-index',
  discordMessageType: 8,
  timestamp: baselineSnapshotAt - 1_000,
  reportedCount: 2
}, {
  id: 'after-baseline',
  messageId: 'after-baseline',
  userId: '555555555555555555',
  type: 'boost',
  source: 'native-system',
  discordMessageType: 8,
  timestamp: baselineSnapshotAt + 1_000,
  reportedCount: 3
}];
assert.equal(calculateVerifiedBoostCount({
  userId: '555555555555555555',
  premiumSinceTimestamp: currentCycleStartedAt,
  hasSystemBoosterRole: true,
  events: oldAndNewEvents,
  activityImport: importedBaseline
}), 3);
const baselineAfterTrustedLoss = calculateVerifiedBoostCount({
  userId: '555555555555555555',
  premiumSinceTimestamp: currentCycleStartedAt,
  hasSystemBoosterRole: true,
  events: [...oldAndNewEvents, {
    id: 'trusted-loss',
    messageId: 'trusted-loss',
    userId: '555555555555555555',
    type: 'expired',
    source: 'trusted-boost-loss',
    timestamp: baselineSnapshotAt + 2_000
  }],
  activityImport: importedBaseline
});
assert.equal(baselineAfterTrustedLoss, 2);
assert.equal(calculateVerifiedBoostCount({
  userId: '555555555555555555',
  premiumSinceTimestamp: baselineSnapshotAt + 5_000,
  hasSystemBoosterRole: true,
  events: [],
  activityImport: importedBaseline
}), 1);

const trustedLoss = parseTrustedBoostLossMessage({
  guild: { id: '1276125977805721640' },
  channelId: '1404532593575067690',
  channel: { id: '1404532593575067690', name: 'boost-log' },
  author: { id: '1067880912538304583', bot: true },
  embeds: [{
    title: ':frowning2: Wir haben einen Booster verloren!',
    description: '<@500394719961153561> hat aufgehört den Server zu boosten!',
    footer: { text: 'v1.4.3 | © RappyTV, 2026' }
  }]
});
assert.equal(trustedLoss?.userId, '500394719961153561');
assert.equal(parseTrustedBoostLossMessage({
  guild: { id: '1276125977805721640' },
  channelId: '1404532593575067690',
  channel: { id: '1404532593575067690', name: 'boost-log' },
  author: { id: '1067880912538304583', bot: true },
  content: '<@500394719961153561> Boost läuft ab am 05.08.',
  embeds: []
}), null, 'Eine angekündigte Ablaufzeit ist noch kein beendeter Boost.');
assert.equal(parseTrustedBoostLossMessage({
  guild: { id: '1276125977805721640' },
  channelId: '1370069606559125534',
  author: { id: '678344927997853742', bot: true },
  embeds: [{ title: 'Danke für den Boost!', description: 'Boost-Info' }]
}), null);

const boostInfoEvidence = parseBoostInfoMessage({
  guild: { id: '1276125977805721640' },
  channelId: '1370069606559125534',
  channel: { id: '1370069606559125534', name: '╰🚀〢boost-info' },
  author: { id: '678344927997853742', bot: true },
  content: '<@555555555555555555>',
  embeds: [{ title: 'Danke für den Boost!', description: 'Du gibst FALLEN HEAVEN gerade extra Power!' }]
});
assert.equal(boostInfoEvidence?.userId, '555555555555555555');

const nativeAndInfoSameBoost = calculateVerifiedBoostCount({
  userId: '555555555555555555',
  premiumSinceTimestamp: currentCycleStartedAt,
  hasSystemBoosterRole: true,
  events: [{
    messageId: 'native-proof',
    userId: '555555555555555555',
    type: 'boost',
    source: 'native-system',
    discordMessageType: 8,
    channelId: 'main-chat',
    timestamp: currentCycleStartedAt + 10_000
  }, {
    messageId: 'info-proof',
    userId: '555555555555555555',
    type: 'boost-info',
    source: 'boost-info-live',
    channelId: 'boost-info',
    timestamp: currentCycleStartedAt + 11_000
  }]
});
assert.equal(nativeAndInfoSameBoost, 1, 'Boost-Info darf eine Discord-Systemnachricht nicht doppelt zählen.');

const twoNativeOneInfo = calculateVerifiedBoostCount({
  userId: '555555555555555555',
  premiumSinceTimestamp: currentCycleStartedAt,
  hasSystemBoosterRole: true,
  events: [{
    messageId: 'native-1', userId: '555555555555555555', type: 'boost', source: 'native-system', discordMessageType: 8, channelId: 'main-chat', timestamp: currentCycleStartedAt + 10_000
  }, {
    messageId: 'native-2', userId: '555555555555555555', type: 'boost', source: 'native-system', discordMessageType: 8, channelId: 'main-chat', timestamp: currentCycleStartedAt + 11_000
  }, {
    messageId: 'only-one-info', userId: '555555555555555555', type: 'boost-info', source: 'boost-info-live', channelId: 'boost-info', timestamp: currentCycleStartedAt + 12_000
  }]
});
assert.equal(twoNativeOneInfo, 2, 'Zwei Discord-Systemnachrichten bleiben zwei Boosts, auch wenn Boost-Info nur ein Embed sendet.');

const partialExpiryWhileStillBoosting = calculateVerifiedBoostCount({
  userId: '555555555555555555',
  premiumSinceTimestamp: currentCycleStartedAt,
  hasSystemBoosterRole: true,
  events: [...sixBoostEvents, {
    messageId: 'real-expiry',
    userId: '555555555555555555',
    type: 'expired',
    source: 'trusted-boost-loss',
    channelId: 'boost-log',
    timestamp: currentCycleStartedAt + 20_000
  }]
});
assert.equal(partialExpiryWhileStillBoosting, 5);

const pendingDiscordTotal = evaluateBoostConsistency({
  assignedBoostCount: 52,
  discordBoostCount: 53,
  events: [{ type: 'expired', source: 'trusted-boost-loss', timestamp: Date.now() - 60_000 }]
});
assert.equal(pendingDiscordTotal.state, 'discord-pending');
assert.equal(pendingDiscordTotal.boostCountDifference, 0);
assert.equal(pendingDiscordTotal.countsMatch, true);

const impossibleDistribution = evaluateBoostConsistency({
  assignedBoostCount: 57,
  discordBoostCount: 53,
  events: [{ type: 'boost', source: 'native-system', discordMessageType: 8, timestamp: Date.now() - (10 * 60_000) }]
});
assert.equal(impossibleDistribution.state, 'mismatch');
assert.equal(impossibleDistribution.rawDifference, 4);
assert.equal(impossibleDistribution.distributionLocked, true);
const sixthBoostRole = resolveManagedBoosterRoles({
  active: true,
  boostCount: verifiedSixBoosts,
  tierRoleMappings: [`1=${firstTierRole}`, `2=${secondTierRole}`, `5=${fifthTierRole}`, `10=${tenthTierRole}`]
});
assert.deepEqual(sixthBoostRole.wantedRoleIds, [fifthTierRole]);

const sixthBoostCredit = calculateBoostMilestoneCredit({
  rewardedBoostLevels: [],
  count: verifiedSixBoosts,
  reward: 100
});
assert.deepEqual(sixthBoostCredit.levels, [1, 2, 3, 4, 5, 6]);
assert.equal(sixthBoostCredit.amount, 600);

const onlyNewMilestoneCredit = calculateBoostMilestoneCredit({
  rewardedBoostLevels: [1, 2, 3, 4, 5],
  count: verifiedSixBoosts,
  reward: 100
});
assert.deepEqual(onlyNewMilestoneCredit.levels, [6]);
assert.equal(onlyNewMilestoneCredit.amount, 100);

const repeatedFirstBoost = calculateBoostMilestoneCredit({ rewardedBoostLevels: [1], count: 1, reward: 100 });
assert.deepEqual(repeatedFirstBoost.levels, []);
assert.equal(repeatedFirstBoost.amount, 0);
const repeatedSecondBoost = calculateBoostMilestoneCredit({ rewardedBoostLevels: [1, 2], count: 2, reward: 100 });
assert.deepEqual(repeatedSecondBoost.levels, []);
assert.equal(repeatedSecondBoost.amount, 0);
const firstActiveThirdBoost = calculateBoostMilestoneCredit({ rewardedBoostLevels: [1, 2], count: 3, reward: 100 });
assert.deepEqual(firstActiveThirdBoost.levels, [3]);
assert.equal(firstActiveThirdBoost.amount, 100);

console.log('Booster-Smoke-Test bestanden: Rollenstaffel und unabhängige Coin-Meilensteine sind konsistent.');
