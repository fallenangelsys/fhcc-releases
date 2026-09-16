import assert from 'node:assert/strict';

process.env.BOOST_NOTIFICATION_BOT_ID = '1067880912538304583';
process.env.BOOST_LOSS_CHANNEL_ID = '1404532593575067690';

const { defaultGuildConfig, normalizeConfig } = await import('../src/defaultConfig.js');
const {
  applyManagedRoleChanges,
  buildBoostAnnouncementPayload,
  buildBoostTopPayload,
  calculateActivityBaselineCount,
  calculateVerifiedBoostCount,
  evaluateBoostConsistency,
  filterCurrentServerBoosters,
  isActiveDiscordBooster,
  normalizeBoostTopConf,
  parseBoostInfoMessage,
  parseTrustedBoostLossMessage,
  resolveManagedBoosterRoles,
  resolveOutsideImagePreservation,
  sendBoostTopPings
} = await import('../src/features/boostRoles.js');
const { calculateBoostMilestoneCredit } = await import('../src/features/heavenEconomy.js');

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
// Produktion rechnet Boost-Zeilen in Berliner Datumsschlüsseln (dateKeyInBerlin).
// UTC-Datumsangaben wären kurz nach Mitternacht (Berlin) einen Tag verschoben und
// würden die Zeilen-Basis fälschlich herausfiltern.
const berlinDateKey = (timestamp) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
}).format(new Date(timestamp));
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

// Regression: Eigene Boost-Announcements des Bots dürfen nicht als
// Boost-Info-Beweis zurück in den Ledger fließen (Feedback-Schleife). Der
// Announce-Kanal heißt hier „boost-info“ und die Vorlage „Danke für den Boost“
// – ohne Ausschluss registriert sich jede eigene Announcement selbst als Beweis
// (beobachtet im Live-Ledger: dieselben Message-IDs in beiden Systemen).
assert.equal(parseBoostInfoMessage({
  guild: { id: '1276125977805721640' },
  channelId: '1370069606559125534',
  channel: { id: '1370069606559125534', name: '╰🚀〢boost-info' },
  author: { id: 'own-bot-id', bot: true },
  client: { user: { id: 'own-bot-id' } },
  content: '<@555555555555555555>',
  embeds: [{ title: 'Danke für den Boost, Max! 🚀💜', description: 'Du boostest jetzt **2×** und gibst FALLEN HEAVEN damit extra Power!' }]
}), null, 'Eigene Bot-Nachricht ist kein unabhängiger Boost-Info-Beweis.');
assert.equal(parseBoostInfoMessage({
  guild: { id: '1276125977805721640' },
  channelId: '1370069606559125534',
  channel: { id: '1370069606559125534', name: '╰🚀〢boost-info' },
  author: { id: '678344927997853742', bot: true },
  client: { user: { id: 'own-bot-id' } },
  content: '<@555555555555555555>',
  embeds: [{ title: 'Danke für den Boost!', description: 'Du gibst FALLEN HEAVEN gerade extra Power!' }]
})?.userId, '555555555555555555', 'Andere Bots bleiben unabhängige Boost-Info-Belege.');

// Die Discord-System-Boosterrolle ist der kanonische Live-Status: Nach dem
// Ende eines Boosts bleibt premiumSince (und der Discord-Zähler) bis zu drei
// Tage bestehen, aber die Boosterrolle ist sofort weg. Ohne Rolle boostet das
// Mitglied ab dann nicht mehr – der Count wird beim nächsten Abgleich auf 0
// neu aufgebaut und neue Boosts zählen ab dem Punkt frisch.
const roleGuild = {
  id: 'role-guild',
  roles: {
    premiumSubscriberRole: { id: 'sys-boost', tags: { premiumSubscriberRole: true } },
    cache: new Map([['sys-boost', { id: 'sys-boost', tags: { premiumSubscriberRole: true } }]])
  }
};
const memberWithRole = { id: 'u1', premiumSince: new Date(), premiumSinceTimestamp: Date.now(), roles: { cache: new Map([['sys-boost', {}]]) } };
const memberWithoutRole = { id: 'u2', premiumSince: new Date(), premiumSinceTimestamp: Date.now(), roles: { cache: new Map() } };
const memberNoPremium = { id: 'u3', premiumSinceTimestamp: 0, roles: { cache: new Map([['sys-boost', {}]]) } };
assert.equal(isActiveDiscordBooster(memberWithRole, roleGuild), true, 'Rolle + premiumSince = aktiver Booster.');
assert.equal(isActiveDiscordBooster(memberWithoutRole, roleGuild), false, 'Ohne Boosterrolle zählt premiumSince nicht (3-Tage-Restboost).');
assert.equal(isActiveDiscordBooster(memberNoPremium, roleGuild), false, 'Rolle ohne premiumSince ist kein aktiver Booster.');
// Fallback: Server ohne erkannte Systemrolle → premiumSince entscheidet wie bisher.
assert.equal(isActiveDiscordBooster(memberWithRole, { id: 'no-role-guild', roles: { cache: new Map() } }), true);
// Standardaufruf ohne Guild-Parameter nutzt member.guild.
assert.equal(isActiveDiscordBooster({ ...memberWithRole, guild: roleGuild }), true);
assert.equal(isActiveDiscordBooster({ ...memberWithoutRole, guild: roleGuild }), false);

// Regression: Eine veraltete Aktivitätslisten-Zeilen-Basis darf einen neuen
// Discord-Boost nicht doppelt zählen. Discord meldet per Systemmeldung die
// Gesamtzahl („hat den Server gerade 2-mal geboostet“ = 2 gesamt); diese
// autoritative Zahl muss Vorrang vor alten Zeilen haben (beobachteter Fehler:
// Bot zählte 3× statt 2× und der Basisstand musste manuell korrigiert werden).
const staleRowsImport = {
  version: 2,
  snapshotAt: currentCycleStartedAt + 10_000,
  memberBaselines: {},
  rows: [
    { userId: '555555555555555555', action: 'given', dateKey: berlinDateKey(currentCycleStartedAt) },
    { userId: '555555555555555555', action: 'given', dateKey: berlinDateKey(currentCycleStartedAt) }
  ]
};
const staleRowsWithNativeReport = calculateVerifiedBoostCount({
  userId: '555555555555555555',
  premiumSinceTimestamp: currentCycleStartedAt,
  hasSystemBoosterRole: true,
  events: [{
    messageId: 'stale-rows-native',
    userId: '555555555555555555',
    type: 'boost',
    source: 'native-system',
    discordMessageType: 8,
    timestamp: currentCycleStartedAt + 20_000,
    reportedCount: 2
  }],
  activityImport: staleRowsImport
});
assert.equal(staleRowsWithNativeReport, 2, 'Veraltete Zeilen + neue Discord-Systemmeldung ergeben 2 (keine Doppelzählung auf 3).');
// Ohne Discord-Systemmeldung bleibt die Zeilen-Basis die Quelle (2).
assert.equal(calculateVerifiedBoostCount({
  userId: '555555555555555555',
  premiumSinceTimestamp: currentCycleStartedAt,
  hasSystemBoosterRole: true,
  events: [],
  activityImport: staleRowsImport
}), 2, 'Ohne Systemmeldung zählt die Zeilen-Basis weiterhin 2.');

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

// Discord zählt nach dem Ende eines Boosts bis zu drei Tage weiter („Restboost“),
// während die Boosterrolle sofort weg ist. assigned < discord ist daher
// erwartbar: kein Einfrieren, keine Economy-Pausierung – der Abgleich läuft weiter.
const expectedRestBoost = evaluateBoostConsistency({
  assignedBoostCount: 61,
  discordBoostCount: 63,
  events: []
});
assert.equal(expectedRestBoost.state, 'discord-pending');
assert.equal(expectedRestBoost.countsMatch, true);
assert.equal(expectedRestBoost.distributionLocked, false, '3-Tage-Restboost (discord > assigned) friert nichts ein.');
assert.equal(expectedRestBoost.boostCountDifference, 0, 'Erwartbare Restboost-Differenz zählt nicht als Fehler.');
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

// --- Boost-Benachrichtigung (Boost-Embed) ---
const announceTemplate = {
  content: '{usermention}',
  embeds: [{
    title: 'Danke für den Boost, ${usernickname}! 🚀💜',
    description: 'Du boostest jetzt **{boostcount}×** und gibst ${guildname} damit extra Power!',
    fields: [{ name: 'Booster Farben?', value: '<#1305858566422401116>', inline: false }]
  }]
};
const announceGuild = { name: 'FALLEN HEAVEN' };
const announceMember = { user: { id: '999999999999999999', username: 'maxmuster' }, displayName: 'Max Muster' };
const announcePayload = await buildBoostAnnouncementPayload(announceGuild, announceMember, { boostAnnounceTemplate: announceTemplate }, 2);
assert.equal(announcePayload.content, '<@999999999999999999>');
assert.match(announcePayload.embeds[0].data.title, /^Danke für den Boost, Max Muster!/);
assert.match(announcePayload.embeds[0].data.description, /boostest jetzt \*\*2×\*\*/);
assert.match(announcePayload.embeds[0].data.description, /FALLEN HEAVEN/);
assert.equal(announcePayload.embeds[0].data.fields.length, 1);

// 1×-Booster zeigt „1×“, ohne Vorlage gibt es keinen Payload.
const firstAnnounce = await buildBoostAnnouncementPayload(announceGuild, announceMember, { boostAnnounceTemplate: announceTemplate }, 1);
assert.match(firstAnnounce.embeds[0].data.description, /\*\*1×\*\*/);
assert.equal(await buildBoostAnnouncementPayload(announceGuild, announceMember, {}, 1), null);
assert.equal(await buildBoostAnnouncementPayload(announceGuild, announceMember, null, 1), null);

// Config-Defaults enthalten die Boost-Benachrichtigung mit {boostcount}.
const announceDefaults = defaultGuildConfig('111111111111111111', 'FALLEN HEAVEN');
assert.equal(announceDefaults.boostRoles.boostAnnounceEnabled, false);
assert.equal(announceDefaults.boostRoles.boostAnnounceChannelId, '');
assert.ok(announceDefaults.boostRoles.boostAnnounceTemplate?.embeds?.[0]?.description.includes('{boostcount}'));
assert.ok(announceDefaults.boostRoles.boostAnnounceTemplate?.content.includes('{usermention}'));

// --- Top-Booster-Liga (Live-Embed + Platzierungs-Pings) ---
const boostTopDefaults = defaultGuildConfig('111111111111111111', 'FALLEN HEAVEN');
assert.equal(boostTopDefaults.boostRoles.boostTopEnabled, false);
assert.equal(boostTopDefaults.boostRoles.boostTopChannelId, '');
assert.equal(boostTopDefaults.boostRoles.boostTopPingsEnabled, true);
assert.ok(boostTopDefaults.boostRoles.boostTopTemplate?.embeds?.[0]?.authorName.includes('{server}'));
assert.ok(boostTopDefaults.boostRoles.boostTopTemplate?.embeds?.[0]?.footerText.includes('{boostcount}'));

const boostTopConf = normalizeBoostTopConf({
  boostTopEnabled: true,
  boostTopChannelId: 'top-chan',
  boostTopPingLifetimeMinutes: 7
});
assert.equal(boostTopConf.enabled, true);
assert.equal(boostTopConf.channelId, 'top-chan');
assert.equal(boostTopConf.pingLifetimeMinutes, 7);

const topSnapshot = {
  measuredAt: new Date('2026-08-08T12:00:00Z').toISOString(),
  top: [
    { userId: 'u1', displayName: 'Max', boostCount: 3 },
    { userId: 'u2', displayName: 'Lina', boostCount: 2 },
    { userId: 'u3', displayName: 'Tom', boostCount: 1 }
  ],
  activeBoosterCount: 5,
  boostCount: 12,
  assignedBoostCount: 10
};
const boostTopTemplate = {
  content: '',
  embeds: [{
    title: '🚀 Top-Booster · {server}',
    description: 'Stand {status} – {boostcount} Boosts gesamt.',
    footerText: 'Aktualisiert {range}',
    fields: []
  }]
};
const topPayload = buildBoostTopPayload({ name: 'FALLEN HEAVEN' }, { template: boostTopTemplate }, topSnapshot);
assert.match(topPayload.embeds[0].data.title, /FALLEN HEAVEN/);
assert.match(topPayload.embeds[0].data.description, /12 Boosts gesamt/);
assert.match(topPayload.embeds[0].data.fields[0].name, /PLATZ 1/);
assert.match(topPayload.embeds[0].data.fields[0].value, /<@u1>/);
assert.match(topPayload.embeds[0].data.fields[0].value, /\*\*3×\*\* geboostet/);
assert.match(topPayload.embeds[0].data.fields[2].name, /PLATZ 3/);
assert.match(topPayload.embeds[0].data.fields[2].value, /<@u3>/);
assert.match(topPayload.embeds[0].data.fields[3].name, /STATUS/);
assert.match(topPayload.embeds[0].data.fields[4].name, /NÄCHSTE AUSWERTUNG/);
assert.deepEqual(
  boostTopDefaults.boostRoles.boostTopTemplate.embeds[0].fields.slice(0, 3).map((field) => field.value),
  [
    '{boostMarker1} {boost1}\n> **{boostCount1}×** geboostet',
    '{boostMarker2} {boost2}\n> **{boostCount2}×** geboostet',
    '{boostMarker3} {boost3}\n> **{boostCount3}×** geboostet'
  ],
  'Top-Booster-Studio zeigt aufgeklappte Einzel-Platzhalter statt Block-Platzhalter'
);
assert.ok(
  !boostTopDefaults.boostRoles.boostTopTemplate.embeds[0].fields.some((field) => /\{(?:boostBlock|placeLine)\d+\}/.test(String(field.value || ''))),
  'Top-Booster-Defaults enthalten keine undurchsichtigen Boost-/Place-Line-Blöcke'
);
const migratedBoostBlockPayload = buildBoostTopPayload({ name: 'FALLEN HEAVEN' }, {
  template: {
    content: '',
    embeds: [{
      title: 'Alt',
      fields: [{ name: 'Alt 1', value: '{boostBlock1}', inline: true }]
    }]
  }
}, topSnapshot);
assert.match(migratedBoostBlockPayload.embeds[0].data.fields[0].value, /<@u1>/, 'Alter {boostBlock1} wird weiterhin gerendert');
assert.match(migratedBoostBlockPayload.embeds[0].data.fields[0].value, /\*\*3×\*\* geboostet/, 'Alter {boostBlock1} nutzt die aufgeklappte Standard-Zeile');

// Editierbare Texte der Top-Booster-Liga: Feldnamen + Zeilen-Vorlage kommen
// aus der Config (statt hartkodierter Strings).
const editedTopConf = {
  template: boostTopTemplate,
  boostTopPlaceFieldName: 'PODIUM {place}',
  boostTopPlaceLineTemplate: '{marker} Rang {place}: {mention} → {boostCount}×',
  boostTopStatusFieldName: 'LIVE',
  boostTopNextEvaluationFieldName: 'NÄCHSTER ABGLEICH',
  boostTopEmptyFieldName: 'LEER',
  boostTopEmptyText: 'Noch nichts erfasst.'
};
const editedTopPayload = buildBoostTopPayload({ name: 'FALLEN HEAVEN' }, editedTopConf, topSnapshot);
assert.equal(editedTopPayload.embeds[0].data.fields[0].name, 'PODIUM 1', 'Platz-Feldname editierbar');
assert.match(editedTopPayload.embeds[0].data.fields[0].value, /Rang 1: <@u1> → 3×/, 'Ranglisten-Zeilen-Vorlage editierbar');
assert.equal(editedTopPayload.embeds[0].data.fields[3].name, 'LIVE', 'Status-Feldname editierbar');
assert.equal(editedTopPayload.embeds[0].data.fields[4].name, 'NÄCHSTER ABGLEICH', 'Auswertungs-Feldname editierbar');
const editedEmptyTopPayload = buildBoostTopPayload({ name: 'FALLEN HEAVEN' }, editedTopConf, { ...topSnapshot, top: [] });
assert.equal(editedEmptyTopPayload.embeds[0].data.fields[0].name, 'LEER', 'Leer-Feldname editierbar');
assert.match(editedEmptyTopPayload.embeds[0].data.fields[0].value, /Noch nichts erfasst/, 'Leer-Text editierbar');

// Server-Trophäen: Wenn die hochgeladenen Pokal-Emojis im Cache liegen, werden
// sie statt der Standard-Medails verwendet (wie in der Aktivitäts-Liga).
const trophyGuild = {
  name: 'FALLEN HEAVEN',
  emojis: {
    cache: new Map([
      ['1533907289604493502', { id: '1533907289604493502', name: 'trophy1', animated: false }],
      ['1533907288379625673', { id: '1533907288379625673', name: 'trophy2', animated: false }],
      ['1533907290753732608', { id: '1533907290753732608', name: 'trophy3', animated: false }]
    ])
  }
};
const trophyPayload = buildBoostTopPayload(trophyGuild, { template: boostTopTemplate }, topSnapshot);
assert.match(trophyPayload.embeds[0].data.fields[0].value, /<:trophy1:1533907289604493502> <@u1>/);
assert.match(trophyPayload.embeds[0].data.fields[2].value, /<:trophy3:1533907290753732608> <@u3>/);

// Ohne Template greift die Standard-Vorlage; leere Top-3 zeigen einen Hinweis.
const emptyTopPayload = buildBoostTopPayload({ name: 'FALLEN HEAVEN' }, { template: null }, { ...topSnapshot, top: [] });
assert.match(emptyTopPayload.embeds[0].data.fields[0].value, /Noch keine aktiven Booster/);

// Außenbild: Ein hochgeladenes Bild landet als Datei im Payload, eine Bild-URL
// als eigene Zeile im Content, ein persistierter Anhang bleibt erhalten.
const outsideFilePayload = buildBoostTopPayload({ name: 'FALLEN HEAVEN' }, { template: { content: '', outsideImageUrl: '' } }, topSnapshot, { outsideFile: Buffer.from('png'), outsideFileName: 'boosters.png' });
assert.ok(Array.isArray(outsideFilePayload.files) && outsideFilePayload.files.length === 1);
assert.equal(outsideFilePayload.files[0].name, 'boosters.png');
const urlPayload = buildBoostTopPayload({ name: 'FALLEN HEAVEN' }, { template: { content: '', outsideImageUrl: 'https://cdn.example.com/boosters.png' } }, topSnapshot);
assert.match(urlPayload.content, /https:\/\/cdn\.example\.com\/boosters\.png/);
const preservePayload = buildBoostTopPayload({ name: 'FALLEN HEAVEN' }, { template: { content: '', outsideImageAttachment: { id: 'att-9', url: 'https://cdn.example.com/boosters.png' } } }, topSnapshot, { preserveAttachment: true });
assert.equal(preservePayload.attachments[0].id, 'att-9');
assert.doesNotMatch(String(preservePayload.content || ''), /cdn\.example/);

// Design-Save-Schutz: Ein bildloser Re-Save (z. B. zweiter Klick) darf das
// bereits hochgeladene Außenbild NIE überschreiben – nur Ersetzen oder
// explizites Entfernen ändert es.
const previousImage = { outsideImageUrl: 'https://cdn.discordapp.com/attachments/1/2/boosters.png', outsideImageAttachment: { id: 'att-9', url: 'https://cdn.discordapp.com/attachments/1/2/boosters.png', name: 'boosters.png', size: 947386 } };
const kept = resolveOutsideImagePreservation({ sourceOutsideImage: '', incomingAttachment: null, removeOutsideImage: false, previousTemplate: previousImage });
assert.equal(kept.preservePrevious, true);
assert.equal(kept.outsideImageUrl, previousImage.outsideImageUrl);
assert.equal(kept.outsideImageAttachment.id, 'att-9');
const removed = resolveOutsideImagePreservation({ sourceOutsideImage: '', incomingAttachment: null, removeOutsideImage: true, previousTemplate: previousImage });
assert.equal(removed.preservePrevious, false);
assert.equal(removed.outsideImageUrl, '');
assert.equal(removed.outsideImageAttachment, null);
const replaced = resolveOutsideImagePreservation({ outsideFile: Buffer.from('new'), sourceOutsideImage: 'data:image/png;base64,AA==', incomingAttachment: null, removeOutsideImage: false, previousTemplate: previousImage });
assert.equal(replaced.preservePrevious, false);
assert.equal(replaced.outsideImageUrl, '');
assert.equal(replaced.outsideImageAttachment, null);
const carried = resolveOutsideImagePreservation({ sourceOutsideImage: '', incomingAttachment: { id: 'att-10', url: 'https://cdn.discordapp.com/attachments/3/4/new.png' }, removeOutsideImage: false, previousTemplate: previousImage });
assert.equal(carried.outsideImageAttachment.id, 'att-10');

// Platzierungs-Pings: Aufstieg, Überholung und Verdrängung werden erkannt.
const pingChannel = {
  id: 'ping-chan',
  type: 0,
  isTextBased: () => true,
  send: async (payload) => ({ delete: async () => {} }),
  messages: {}
};
const pingGuild = {
  id: 'g1',
  name: 'FALLEN HEAVEN',
  channels: { cache: new Map([['top-chan', { ...pingChannel, id: 'top-chan' }], ['ping-chan', pingChannel]]) },
  members: {
    cache: new Map([
      ['u1', { id: 'u1', user: { bot: false } }],
      ['u2', { id: 'u2', user: { bot: false } }],
      ['u3', { id: 'u3', user: { bot: false } }]
    ])
  },
  emojis: { cache: new Map() }
};
let pingContent = '';
const capturingChannel = {
  id: 'ping-chan',
  type: 0,
  isTextBased: () => true,
  send: async (payload) => { pingContent = String(payload?.content || ''); return { delete: async () => {} }; },
  messages: {}
};
const captureGuild = {
  ...pingGuild,
  channels: { cache: new Map([['top-chan', capturingChannel], ['ping-chan', capturingChannel]]) }
};
// Neuer Top-3-Einsteiger wird begrüßt.
await sendBoostTopPings(captureGuild, boostTopConf, [], topSnapshot.top);
assert.match(pingContent, /Top 3|Top-Boostern/);
// Überholung/Verdrängung: u3 wird von u4 aus den Top 3 verdrängt.
await sendBoostTopPings(captureGuild, boostTopConf, topSnapshot.top, [
  { userId: 'u1', count: 3 },
  { userId: 'u2', count: 2 },
  { userId: 'u4', count: 1 }
]);
assert.match(pingContent, /überholt|verdrängt|gefallen/);
// Unveränderte Top-3 erzeugen keine Pings.
const unchanged = await sendBoostTopPings(captureGuild, boostTopConf, topSnapshot.top, topSnapshot.top);
assert.equal(unchanged, 0);

// Nur aktuell boostende Mitglieder, die noch auf dem Server sind, dürfen in
// der Top-Booster-Liga erscheinen (Boost beendet / Server verlassen = raus).
const filterGuild = {
  members: { cache: new Map([
    ['on-server', {}],
    ['on-server-2', {}],
    ['on-server-3', {}],
    ['on-server-4', {}],
    ['stopped-boosting', {}]
  ]) }
};
const filtered = filterCurrentServerBoosters([
  { id: 'on-server', nativeActive: true, boostCount: 3 },
  { id: 'left-server', nativeActive: true, boostCount: 5 },
  { id: 'stopped-boosting', nativeActive: false, boostCount: 1 },
  { id: 'on-server-2', nativeActive: true, boostCount: 2 },
  { id: 'on-server-3', nativeActive: true, boostCount: 2 },
  { id: 'on-server-4', nativeActive: true, boostCount: 2 }
], filterGuild);
assert.deepEqual(filtered.map((entry) => entry.id), ['on-server', 'on-server-2', 'on-server-3']);
assert.equal(filtered.length, 3, 'maximal Top 3');

// Idempotenz der Top-Booster-Normalisierung: saveBoostTopDesign übergibt eine
// bereits normalisierte Config (enabled statt boostTopEnabled) an
// ensureBoostTopPanel, das intern nochmal normalisiert. Die Funktion muss
// beide Formen akzeptieren, sonst bricht der Bild-Upload still mit null ab.
const rawConf = { boostTopEnabled: true, boostTopChannelId: 'top-chan', boostTopPingsEnabled: false };
const firstPass = normalizeBoostTopConf(rawConf);
assert.equal(firstPass.enabled, true);
assert.equal(firstPass.channelId, 'top-chan');
assert.equal(firstPass.pingsEnabled, false);
const secondPass = normalizeBoostTopConf(firstPass);
assert.equal(secondPass.enabled, true, 'bereits normalisierte Config darf enabled nicht verlieren');
assert.equal(secondPass.channelId, 'top-chan', 'bereits normalisierte Config behält den Kanal');
assert.equal(secondPass.pingsEnabled, false, 'bereits normalisierte Config behält Pings-Aus');

console.log('Booster-Smoke-Test bestanden: Rollenstaffel, unabhängige Coin-Meilensteine, Boost-Benachrichtigung und Top-Booster-Liga sind konsistent.');
