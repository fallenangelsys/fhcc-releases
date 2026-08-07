import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Collection } from 'discord.js';

import {
  ACTIVITY_RACE_ROLE_DEFINITIONS,
  _activityRaceInternals,
  previewActivityRaceRoleSet
} from '../src/features/activityRace.js';
import { normalizeConfig as normalizeGuildConfig } from '../src/defaultConfig.js';

const {
  normalizeConfig,
  normalizeStore,
  localDateKey,
  periodStartKey,
  completedPeriodRange,
  aggregatePeriod,
  periodSnapshot,
  completedPeriodSnapshot,
  buildPanelSnapshot,
  buildAwardSnapshot,
  buildRoleAssignmentPlan,
  panelChannel,
  meaningfulMessage,
  buildPanelPayload,
  buildRulesPayload,
  PING_PHRASES,
  pickPhrase,
  sendPlacementPings,
  buildCompletionAnnouncement,
  announceCompletedPeriods,
  formatVoice,
  fullRankMetric,
  attachFullRankings,
  buildPersonalRankPayload,
  indexedBackfillRange,
  reconstructIndexedChatDays,
  mergeIndexedChatDays
} = _activityRaceInternals;

const conf = normalizeConfig({ enabled: true });
assert.equal(conf.messageCooldownSeconds, 10);
assert.equal(conf.voiceMinimumParticipants, 2);
assert.equal(conf.announceCompletedPeriods, true);
assert.equal(conf.announcementChannelId, '');
assert.equal(conf.dailyChatRoleName, '🥇 Tageswertung · Chat · Platz 1');
assert.equal(conf.dailyChatTop2RoleName, '🥈 Tageswertung · Chat · Platz 2');
assert.equal(conf.monthlyVoiceTop3RoleName, '🥉 Monatswertung · Sprachchat · Platz 3');
assert.equal(ACTIVITY_RACE_ROLE_DEFINITIONS.length, 19);
assert.equal(normalizeConfig({ dailyChatRoleName: '✦ Daily · Chat' }).dailyChatRoleName, '🥇 Tageswertung · Chat · Platz 1');

const persistedDesign = normalizeGuildConfig({
  guildId: 'guild-1',
  activityRace: {
    panelDesign: {
      content: 'Eigener Text',
      outsideImageUrl: 'https://cdn.example.com/outside.png',
      outsideImageAttachment: { id: 'attachment-1', url: 'https://cdn.example.com/outside.png', name: 'liga.png', size: 1234 },
      embed: {
        title: '{period} · Spezial',
        url: 'https://example.com/liga',
        imageUrl: 'https://cdn.example.com/inside.png',
        timestamp: false,
        fields: [{ name: 'Hinweis', value: '{status}', inline: true }]
      }
    }
  }
}).activityRace.panelDesign;
assert.equal(persistedDesign.content, 'Eigener Text');
assert.equal(persistedDesign.outsideImageUrl, 'https://cdn.example.com/outside.png');
assert.equal(persistedDesign.embed.title, '{period} · Spezial');
assert.equal(persistedDesign.embed.imageUrl, 'https://cdn.example.com/inside.png');
assert.equal(persistedDesign.embed.url, 'https://example.com/liga');
assert.equal(persistedDesign.embed.fields[0].value, '{status}');
assert.equal(persistedDesign.outsideImageAttachment.id, 'attachment-1');
assert.equal(persistedDesign.embed.timestamp, false);

assert.equal(periodStartKey('weekly', '2026-08-03'), '2026-08-03');
assert.equal(periodStartKey('weekly', '2026-08-09'), '2026-08-03');
assert.equal(periodStartKey('monthly', '2026-08-31'), '2026-08-01');
assert.deepEqual(completedPeriodRange('daily', '2026-08-03'), { start: '2026-08-02', end: '2026-08-02' });
assert.deepEqual(completedPeriodRange('weekly', '2026-08-03'), { start: '2026-07-27', end: '2026-08-02' });
assert.deepEqual(completedPeriodRange('monthly', '2026-08-03'), { start: '2026-07-01', end: '2026-07-31' });
assert.match(localDateKey(Date.UTC(2026, 7, 3, 12), 'Europe/Berlin'), /^2026-08-03$/);

const data = normalizeStore({ guilds: { g1: { days: {
  '2026-08-01': { users: { u1: { messages: 5, voiceMilliseconds: 60_000 } } },
  '2026-08-03': { users: { u1: { messages: 8, voiceMilliseconds: 120_000 }, u2: { messages: 4 } } }
} } } }).guilds.g1;
const aggregate = aggregatePeriod(data, 'monthly', 'Europe/Berlin');
assert.equal(aggregate.users.u1.messages, 13);
assert.equal(aggregate.users.u1.voiceMilliseconds, 180_000);
assert.equal(aggregate.users.u2.messages, 4);
assert.deepEqual(data.holders.daily.chat, []);

assert.equal(meaningfulMessage({ content: 'Hi!', attachments: { size: 0 }, stickers: { size: 0 } }, conf), false);
assert.equal(meaningfulMessage({ content: 'Hallo zusammen', attachments: { size: 0 }, stickers: { size: 0 } }, conf), true);
assert.equal(meaningfulMessage({ content: '', attachments: { size: 1 }, stickers: { size: 0 } }, conf), true);
assert.equal(formatVoice(3_720_000), '1 Std. 2 Min.');

const backfillRange = indexedBackfillRange('Europe/Berlin', Date.UTC(2026, 7, 5, 12));
assert.deepEqual(backfillRange, { start: '2026-07-01', end: '2026-08-05', endExclusive: '2026-08-06' });
const indexedGuild = {
  members: { cache: new Collection([
    ['u1', { id: 'u1', user: { bot: false }, roles: { cache: new Collection() } }],
    ['u2', { id: 'u2', user: { bot: false }, roles: { cache: new Collection() } }]
  ]) },
  channels: { cache: new Collection() }
};
const indexedConf = normalizeConfig({
  enabled: true,
  ignoredChannelIds: ['ignored'],
  messageCooldownSeconds: 10,
  duplicateWindowMinutes: 10,
  minimumMessageLength: 3
});
const reconstructed = reconstructIndexedChatDays({
  guild: indexedGuild,
  conf: indexedConf,
  timezone: 'Europe/Berlin',
  range: backfillRange,
  records: [
    { id: '1', authorId: 'u1', channelId: 'chat', createdAt: '2026-08-05T08:00:00.000Z', content: 'Hallo Liga' },
    { id: '2', authorId: 'u1', channelId: 'chat', createdAt: '2026-08-05T08:05:00.000Z', content: 'Hallo Liga' },
    { id: '3', authorId: 'u1', channelId: 'chat', createdAt: '2026-08-05T08:20:00.000Z', content: 'Hallo Liga' },
    { id: '4', authorId: 'u2', channelId: 'chat', createdAt: '2026-08-05T09:00:00.000Z', content: 'Hi' },
    { id: '5', authorId: 'u2', channelId: 'chat', createdAt: '2026-08-05T09:01:00.000Z', content: '', attachments: [{ id: 'a' }] },
    { id: '6', authorId: 'u2', channelId: 'ignored', createdAt: '2026-08-05T09:20:00.000Z', content: 'Wird ignoriert' },
    { id: '7', authorId: 'left-server', channelId: 'chat', createdAt: '2026-08-05T09:30:00.000Z', content: 'Nicht mehr Mitglied' }
  ]
});
assert.equal(reconstructed.analyzedMessages, 7);
assert.equal(reconstructed.creditedMessages, 3);
assert.deepEqual(reconstructed.days['2026-08-05'], { u1: 2, u2: 1 });
const indexedData = { days: { '2026-08-05': { users: { u1: { messages: 1, voiceMilliseconds: 123_000 } } } } };
const firstMerge = mergeIndexedChatDays(indexedData, reconstructed);
assert.deepEqual(firstMerge, { changed: true, recoveredMessages: 2 });
assert.equal(indexedData.days['2026-08-05'].users.u1.messages, 2);
assert.equal(indexedData.days['2026-08-05'].users.u1.voiceMilliseconds, 123_000, 'Die Index-Nachholung darf vorhandene Sprachchatzeit nicht verändern.');
assert.equal(indexedData.days['2026-08-05'].users.u2.messages, 1);
assert.deepEqual(mergeIndexedChatDays(indexedData, reconstructed), { changed: false, recoveredMessages: 0 }, 'Ein zweiter Index-Abgleich darf Nachrichten nicht doppelt zählen.');

const guildForPanel = {
  iconURL: () => null,
  name: 'FALLEN HEAVEN'
};
const panel = buildPanelPayload(guildForPanel, {
  measuredAt: new Date().toISOString(),
  timezone: 'Europe/Berlin',
  periods: {
    daily: { start: '2026-08-03', end: '2026-08-03', chat: [{ userId: '123', value: 12 }, { userId: '124', value: 11 }, { userId: '125', value: 10 }], voice: [{ userId: '456', value: 3_600_000 }, { userId: '457', value: 2_400_000 }, { userId: '458', value: 1_800_000 }], chatWinnerIds: ['123', '124', '125'], voiceWinnerIds: ['456', '457', '458'], chatWinnerId: '123', voiceWinnerId: '456', chatMinimum: 10, voiceMinimumMilliseconds: 900_000 },
    weekly: {},
    monthly: {}
  }
});
// Ohne abgeschlossene Woche/Monat erscheint nur das Heute-Embed.
assert.equal(panel.embeds.length, 1, 'Ohne abgeschlossene Woche/Monat nur Heute.');
assert.equal(panel.components[0].components.length, 2, 'Nur Regeln + Mein Rang.');
assert.equal(panel.components[0].components[0].data.label, 'REGELN');
assert.equal(panel.components[0].components[1].data.label, 'MEIN RANG');
assert.match(panel.embeds[0].data.title, /Heute/);
assert.match(panel.embeds[0].data.description, /Tagesrollen zeigen den aktuellen Stand/);
assert.match(panel.embeds[0].data.author.name, /AKTIVITÄTS-LIGA/);
assert.equal(panel.embeds[0].data.fields[0].name, 'CHAT');
assert.match(panel.embeds[0].data.fields[0].value, /<:trophy1:1533907289604493502>/);
assert.match(panel.embeds[0].data.fields[0].value, /<:trophy2:1533907288379625673>/);
assert.match(panel.embeds[0].data.fields[0].value, /<:trophy3:1533907290753732608>/);
assert.equal(panel.embeds[0].data.fields.length, 4);
assert.doesNotMatch(panel.embeds[0].data.fields[0].value, /Rolle ab/);

// Mit vollständig abgeschlossener Woche UND Monat erscheinen 3 Embeds.
const panelComplete = buildPanelPayload(guildForPanel, {
  measuredAt: new Date().toISOString(),
  timezone: 'Europe/Berlin',
  periods: {
    daily: { start: '2026-08-03', end: '2026-08-03', chat: [{ userId: '123', value: 12 }, { userId: '124', value: 11 }, { userId: '125', value: 10 }], voice: [{ userId: '456', value: 3_600_000 }, { userId: '457', value: 2_400_000 }, { userId: '458', value: 1_800_000 }], chatWinnerIds: ['123', '124', '125'], voiceWinnerIds: ['456', '457', '458'], chatWinnerId: '123', voiceWinnerId: '456', chatMinimum: 10, voiceMinimumMilliseconds: 900_000 },
    weekly: { start: '2026-07-27', end: '2026-08-02', fullyTracked: true, chat: [{ userId: '123', value: 80 }, { userId: '124', value: 70 }, { userId: '125', value: 60 }], voice: [{ userId: '456', value: 9_600_000 }, { userId: '457', value: 8_400_000 }, { userId: '458', value: 7_200_000 }], chatWinnerIds: ['123', '124', '125'], voiceWinnerIds: ['456', '457', '458'], chatWinnerId: '123', voiceWinnerId: '456' },
    monthly: { start: '2026-07-01', end: '2026-07-31', fullyTracked: true, chat: [{ userId: '123', value: 300 }, { userId: '124', value: 290 }, { userId: '125', value: 280 }], voice: [{ userId: '456', value: 40_000_000 }, { userId: '457', value: 38_000_000 }, { userId: '458', value: 36_000_000 }], chatWinnerIds: ['123', '124', '125'], voiceWinnerIds: ['456', '457', '458'], chatWinnerId: '123', voiceWinnerId: '456' }
  }
});
assert.equal(panelComplete.embeds.length, 3, 'Abgeschlossene Woche + Monat ergeben 3 Embeds.');
assert.match(panelComplete.embeds[0].data.title, /Heute/);
assert.match(panelComplete.embeds[1].data.title, /Wochenwertung|Woche/);
assert.match(panelComplete.embeds[2].data.title, /Monats|Monat/);
assert.equal(panelComplete.components[0].components.length, 2);

const rules = buildRulesPayload(guildForPanel, conf, 'Europe/Berlin');
assert.equal(rules.components[0].components.length, 2);
assert.match(rules.embeds[0].data.title, /Regeln/);
assert.match(rules.embeds[0].data.fields[3].value, /Tageswertung.*live/s);
assert.match(rules.embeds[0].data.fields[3].value, /Wochenwertung.*vollständig/s);

const rankGuild = { members: { cache: new Collection([
  ['u1', { id: 'u1', user: { bot: false } }],
  ['u2', { id: 'u2', user: { bot: false } }],
  ['u3', { id: 'u3', user: { bot: false } }],
  ['u4', { id: 'u4', user: { bot: false } }]
]) } };
const ranked = periodSnapshot(rankGuild, {
  days: { [localDateKey()]: { users: {
    u1: { messages: 40, voiceMilliseconds: 4_000_000 },
    u2: { messages: 30, voiceMilliseconds: 3_000_000 },
    u3: { messages: 20, voiceMilliseconds: 2_000_000 },
    u4: { messages: 10, voiceMilliseconds: 1_000_000 }
  } } },
  holders: { daily: { chat: [], voice: [] } }
}, conf, 'daily', 'Europe/Berlin');
assert.deepEqual(ranked.chatWinnerIds, ['u1', 'u2', 'u3']);
assert.deepEqual(ranked.voiceWinnerIds, ['u1', 'u2', 'u3']);

const fullRanking = fullRankMetric(rankGuild, { users: {
  u1: { messages: 40 },
  u2: { messages: 20 },
  u3: { messages: 20 }
} }, 'messages');
assert.equal(fullRanking.length, 4, 'Die Tagesrangliste muss jedes aktuelle menschliche Mitglied enthalten.');
assert.deepEqual(fullRanking.map((entry) => [entry.userId, entry.rank, entry.value]), [
  ['u1', 1, 40],
  ['u2', 2, 20],
  ['u3', 2, 20],
  ['u4', 4, 0]
]);
const fullSnapshot = attachFullRankings(rankGuild, {
  days: { '2026-08-04': { users: { u1: { messages: 40, voiceMilliseconds: 120_000 }, u2: { messages: 20, voiceMilliseconds: 60_000 } } } }
}, {
  measuredAt: '2026-08-04T12:00:00.000Z',
  periods: {
    daily: { start: '2026-08-04', end: '2026-08-04' },
    weekly: { fullyTracked: false },
    monthly: { fullyTracked: false }
  }
}, 'Europe/Berlin', '2026-08-04');
assert.equal(fullSnapshot.periods.daily.fullChat.length, 4);
assert.equal(fullSnapshot.periods.daily.activeChatMembers, 2);
assert.deepEqual(fullSnapshot.periods.weekly.fullChat, [], 'Unvollständige Wochen dürfen auch in der Vollansicht keine Rangliste vortäuschen.');
const personalRank = buildPersonalRankPayload(rankGuild, fullSnapshot, 'u2');
assert.match(personalRank.embeds[0].data.fields[0].value, /Platz \*\*2 von 4\*\*/);
assert.match(personalRank.embeds[0].data.fields[0].value, /20 Nachrichten/);
assert.match(personalRank.embeds[0].data.fields[1].value, /1 Min\./);
assert.equal(personalRank.components[0].components[1].data.label, 'MEIN RANG');

const completedData = {
  trackingCompleteFrom: '2026-07-27',
  days: {
    '2026-07-27': { users: { u1: { messages: 10, voiceMilliseconds: 600_000 }, u2: { messages: 8, voiceMilliseconds: 500_000 }, u3: { messages: 6, voiceMilliseconds: 400_000 } } },
    '2026-08-02': { users: { u1: { messages: 1, voiceMilliseconds: 60_000 }, u2: { messages: 2, voiceMilliseconds: 60_000 }, u3: { messages: 3, voiceMilliseconds: 60_000 } } }
  },
  holders: { weekly: { chat: [], voice: [] } }
};
const completedWeek = completedPeriodSnapshot(rankGuild, completedData, 'weekly', 'Europe/Berlin', '2026-08-03');
assert.equal(completedWeek.fullyTracked, true);
assert.deepEqual(completedWeek.chatWinnerIds, ['u1', 'u2', 'u3']);
const incompleteWeek = completedPeriodSnapshot(rankGuild, { ...completedData, trackingCompleteFrom: '2026-07-28' }, 'weekly', 'Europe/Berlin', '2026-08-03');
assert.equal(incompleteWeek.fullyTracked, false);
assert.deepEqual(incompleteWeek.chatWinnerIds, []);
assert.deepEqual(incompleteWeek.voiceWinnerIds, []);
assert.deepEqual(incompleteWeek.chat, []);
assert.deepEqual(incompleteWeek.voice, []);

const roleConfigInput = { enabled: true };
ACTIVITY_RACE_ROLE_DEFINITIONS.forEach((definition, index) => { roleConfigInput[definition.key] = `role-${index + 1}`; });
const roleConf = normalizeConfig(roleConfigInput);
const liveAwardData = normalizeStore({ guilds: { live: {
  trackingCompleteFrom: '2026-08-05',
  days: {
    '2026-08-04': { users: {
      u1: { messages: 12, voiceMilliseconds: 1_200_000 },
      u2: { messages: 18, voiceMilliseconds: 600_000 },
      u3: { messages: 8, voiceMilliseconds: 1_800_000 }
    } }
  }
} } }).guilds.live;
const liveAwards = buildAwardSnapshot(rankGuild, liveAwardData, roleConf, 'Europe/Berlin', '2026-08-04');
assert.deepEqual(liveAwards.periods.daily.chatWinnerIds, ['u2', 'u1', 'u3'], 'Tagesrollen müssen den aktuellen Tag live auswerten.');
assert.deepEqual(liveAwards.periods.daily.voiceWinnerIds, ['u3', 'u1', 'u2']);
assert.equal(liveAwards.periods.weekly.fullyTracked, false, 'Eine unvollständig erfasste Woche darf keine Rollen erzeugen.');
assert.equal(liveAwards.periods.monthly.fullyTracked, false, 'Ein unvollständig erfasster Monat darf keine Rollen erzeugen.');
const liveRolePlan = buildRoleAssignmentPlan(roleConf, liveAwards);
assert.equal(liveRolePlan.desiredByRole.get(roleConf.dailyChatRoleId), 'u2');
assert.equal(liveRolePlan.desiredByRole.get(roleConf.dailyChatTop2RoleId), 'u1');
assert.equal(liveRolePlan.desiredByRole.get(roleConf.dailyChatTop3RoleId), 'u3');
assert.equal(liveRolePlan.desiredByRole.get(roleConf.weeklyChatRoleId), '', 'Wochenrollen müssen bis zum echten Abschluss leer bleiben.');
assert.equal(liveRolePlan.desiredByRole.get(roleConf.monthlyVoiceRoleId), '', 'Monatsrollen müssen bis zum echten Abschluss leer bleiben.');
assert.equal(liveRolePlan.managedRoleIds.includes(roleConf.separatorRoleId), true, 'Die Trennerrolle muss Teil des verwalteten Rollensets sein.');
for (const [userId, wantedRoleIds] of liveRolePlan.desiredRolesByUser.entries()) {
  assert.equal(wantedRoleIds.includes(roleConf.separatorRoleId), true, `${userId} muss zusammen mit einer Liga-Auszeichnung die Trennerrolle erhalten.`);
  assert.equal(wantedRoleIds.filter((roleId) => roleId === roleConf.separatorRoleId).length, 1, 'Die Trennerrolle darf pro Mitglied nur einmal eingeplant werden.');
}
const emptyRolePlan = buildRoleAssignmentPlan(roleConf, {
  periods: Object.fromEntries(['daily', 'weekly', 'monthly'].map((period) => [period, { chatWinnerIds: [], voiceWinnerIds: [] }]))
});
assert.equal(emptyRolePlan.desiredRolesByUser.size, 0, 'Ohne Liga-Auszeichnung darf niemand die Trennerrolle behalten.');
assert.equal(emptyRolePlan.managedRoleIds.includes(roleConf.separatorRoleId), true, 'Der Abgleich muss eine veraltete Trennerrolle auch ohne aktuelle Sieger entfernen können.');

const incompleteWeekPanel = buildPanelPayload(guildForPanel, {
  measuredAt: new Date().toISOString(),
  timezone: 'Europe/Berlin',
  periods: { daily: {}, weekly: incompleteWeek, monthly: {} }
});
// Unvollständige Wochen werden nicht mehr als Platzhalter-Embed befüllt.
assert.equal(incompleteWeekPanel.embeds.length, 1, 'Ohne abgeschlossene Woche erscheint nur das Heute-Embed.');
assert.doesNotMatch(JSON.stringify(incompleteWeekPanel.embeds[0].data), /<@/);
assert.match(incompleteWeekPanel.embeds[0].data.title, /Heute/);

const customPanel = buildPanelPayload(guildForPanel, {
  measuredAt: '2026-08-03T12:00:00.000Z',
  timezone: 'Europe/Berlin',
  panelDesign: {
    content: 'Live auf {server}',
    outsideImageUrl: 'https://cdn.example.com/outside.png',
    embed: {
      authorName: 'Eigene Liga',
      title: '{period} · {status}',
      description: 'Zeitraum: {range}',
      color: '#123456',
      imageUrl: 'https://cdn.example.com/inside.png',
      footerText: '{completion}',
      timestamp: false,
      fields: [{ name: 'Eigener Hinweis', value: '{status} · {nextEvaluation}', inline: false }]
    }
  },
  periods: {
    daily: { start: '2026-08-03', end: '2026-08-03', chat: [], voice: [] },
    weekly: completedWeek,
    monthly: {}
  }
});
// Die Vorlage gilt für jedes Perioden-Embed; embeds[0]=Heute, embeds[1]=Woche.
assert.equal(customPanel.content, 'Live auf FALLEN HEAVEN\nhttps://cdn.example.com/outside.png');
assert.equal(customPanel.embeds.length, 2, 'Heute + abgeschlossene Woche ergeben 2 Embeds.');
assert.equal(customPanel.embeds[0].data.author.name, 'Eigene Liga');
assert.match(customPanel.embeds[0].data.title, /Heute · Live-Zwischenstand/);
assert.match(customPanel.embeds[1].data.title, /Letzte abgeschlossene Woche · Abgeschlossen/);
assert.equal(customPanel.embeds[1].data.color, 0x123456);
assert.equal(customPanel.embeds[1].data.image.url, 'https://cdn.example.com/inside.png');
assert.equal(customPanel.embeds[1].data.timestamp, undefined);
assert.equal(customPanel.embeds[1].data.fields.length, 5);
assert.equal(customPanel.embeds[1].data.fields[4].name, 'Eigener Hinweis');
assert.match(customPanel.embeds[1].data.fields[4].value, /Abgeschlossen/);

const attachmentPanel = buildPanelPayload(guildForPanel, {
  measuredAt: '2026-08-03T12:00:00.000Z',
  timezone: 'Europe/Berlin',
  panelDesign: {
    outsideImageUrl: 'https://cdn.discordapp.com/attachments/channel/attachment/liga.png',
    outsideImageAttachment: {
      id: 'attachment',
      url: 'https://cdn.discordapp.com/attachments/channel/attachment/liga.png',
      name: 'liga.png',
      size: 100
    }
  },
  periods: { daily: { start: '2026-08-03', end: '2026-08-03', chat: [], voice: [] }, weekly: {}, monthly: {} }
}, { preserveAttachment: true });
assert.deepEqual(attachmentPanel.attachments, [{ id: 'attachment' }]);
assert.equal(attachmentPanel.content, undefined);

const panelSnapshot = buildPanelSnapshot(rankGuild, completedData, conf, 'Europe/Berlin');
assert.ok(panelSnapshot.panelDesign);
assert.ok(panelSnapshot.periods.daily);
assert.ok(panelSnapshot.periods.weekly);

const channelCollection = new Collection([
  ['channel-1', { id: 'channel-1', name: 'aktivität-liga', type: 0, isTextBased: () => true }]
]);
assert.equal(panelChannel({ channels: { cache: channelCollection } }, {}).id, 'channel-1');

const roles = new Collection();
const fakeGuild = {
  id: 'guild-1',
  roles: {
    cache: roles,
    fetch: async () => roles
  },
  members: {
    me: {
      permissions: { has: () => true },
      roles: { highest: { position: 10 } }
    },
    fetchMe: async () => fakeGuild.members.me
  }
};
const preview = await previewActivityRaceRoleSet({ guild: fakeGuild, conf });
assert.equal(preview.createCount, 19);
assert.equal(preview.entries[0].name, '━━ AKTIVITÄTS-LIGA ━━');
assert.match(preview.token, /^[a-f0-9]{48}$/);

const [rendererHtml, rendererJs, dashboardSource] = await Promise.all([
  readFile(new URL('../desktop/renderer/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../desktop/renderer/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/dashboard.js', import.meta.url), 'utf8')
]);
assert.match(rendererHtml, /data-template="activityRace"/);
assert.match(rendererJs, /saveActivityRaceStudioTemplate/);
assert.match(rendererJs, /activity-race\/design/);
assert.match(rendererJs, /renderActivityRaceFullRanking/);
assert.match(rendererJs, /data-activity-race-ranking-search/);
assert.match(rendererJs, /data-activity-race-ranking-metric/);
assert.doesNotMatch(rendererJs, /\(feature\.id === 'activityRace' \? activityRaceEmbedDesigner/);
assert.doesNotMatch(rendererJs, /window\.(?:confirm|alert|prompt)\s*\(/, 'Native Windows-Dialoge dürfen nicht mehr verwendet werden.');
assert.match(rendererJs, /showAppConfirm/);
assert.match(dashboardSource, /activity-race\/design/);

// Platzierungs-Pings: Auto-Delete nach konfigurierbarer Zeit hält den Kanal sauber.
let deleted = false;
let sentContent = '';
let usedChannel = '';
const pingChannel = {
  async send({ content }) {
    sentContent = content;
    usedChannel = 'ping-chan';
    return {
      async delete() { deleted = true; }
    };
  }
};
const pingFallbackChannel = {
  async send({ content }) {
    sentContent = content;
    usedChannel = 'rank-chan';
    return {
      async delete() { deleted = true; }
    };
  }
};
const pingRuntime = {
  guild: {
    id: 'guild-1',
    channels: {
      cache: new Collection([
        ['ping-chan', { ...pingChannel, id: 'ping-chan', name: 'liga-pings', type: 0, isTextBased: () => true }],
        ['rank-chan', { ...pingFallbackChannel, id: 'rank-chan', name: 'aktivität-liga', type: 0, isTextBased: () => true }]
      ])
    },
    members: { cache: new Collection([['u1', { id: 'u1', user: { bot: false } }]]) }
  },
  conf: { placementPings: true }
};
const pingConf = {
  placementPings: true,
  placementPingChannelId: 'ping-chan',
  placementPingLifetimeMinutes: 1,
  dailyChatRoleId: 'r-daily-chat-1',
  dailyChatTop2RoleId: 'r-daily-chat-2',
  dailyChatTop3RoleId: 'r-daily-chat-3'
};
await sendPlacementPings(pingRuntime, [{ userId: 'u1', addedRoleIds: ['r-daily-chat-2'] }], pingConf, { lifetimeSeconds: 0.02 });
assert.equal(usedChannel, 'ping-chan', 'Eigener Ping-Kanal wird genutzt.');
assert.match(sentContent, /<@u1>/);
assert.match(sentContent, /Platz 2/);
await new Promise((resolve) => setTimeout(resolve, 5));
assert.equal(deleted, false, 'Nachricht existiert noch vor Ablauf.');
await new Promise((resolve) => setTimeout(resolve, 80));
assert.equal(deleted, true, 'Ping löscht sich nach konfigurierter Zeit selbst.');
// Ohne konfigurierten Ping-Kanal fällt auf den Ranglisten-Kanal zurück.
deleted = false;
sentContent = '';
usedChannel = '';
await sendPlacementPings(pingRuntime, [{ userId: 'u1', addedRoleIds: ['r-daily-chat-2'] }], { ...pingConf, placementPingChannelId: '' });
assert.equal(usedChannel, 'rank-chan', 'Fallback auf Ranglisten-Kanal.');

// Abstieg: jemand wird von Platz 2 auf Platz 3 verdrängt – das muss als
// Überholt-werden erkannt werden (nicht als Erfolg gefeiert).
deleted = false;
sentContent = '';
usedChannel = '';
const overtakeRuntime = {
  guild: {
    id: 'guild-1',
    channels: { cache: new Collection([['chan', { ...pingChannel, id: 'chan', name: 'aktivität-liga', type: 0, isTextBased: () => true }]]) },
    members: {
      cache: new Collection([
        ['u1', { id: 'u1', user: { bot: false } }],
        ['u2', { id: 'u2', displayName: 'SOMA', user: { bot: false } }]
      ])
    }
  },
  conf: { placementPings: true }
};
// u2 (SOMA) erobert Platz 2, u1 rutscht von Platz 2 auf Platz 3 ab.
await sendPlacementPings(overtakeRuntime, [
  { userId: 'u2', addedRoleIds: ['r-daily-chat-2'] },
  { userId: 'u1', addedRoleIds: ['r-daily-chat-3'], removedRoleIds: ['r-daily-chat-2'] }
], { ...pingConf, placementPingChannelId: 'chan' }, { lifetimeSeconds: 0.02 });
assert.match(sentContent, /überholt/);
assert.match(sentContent, /Platz 3/);
// Der Überholer wird als echte @Mention gepingt (nicht nur als Textname).
assert.match(sentContent, /<@u2>/);
assert.doesNotMatch(sentContent, /Weiter so!/);

// Aufstieg innerhalb der Top 3: u2 rückt von Platz 3 auf Platz 2 vor.
deleted = false;
sentContent = '';
usedChannel = '';
await sendPlacementPings(overtakeRuntime, [
  { userId: 'u2', addedRoleIds: ['r-daily-chat-2'], removedRoleIds: ['r-daily-chat-3'] }
], { ...pingConf, placementPingChannelId: 'chan' }, { lifetimeSeconds: 0.02 });
assert.match(sentContent, /Platz 2/);
assert.match(sentContent, /verbessert/);
assert.doesNotMatch(sentContent, /überholt/);

// Aufstieg auf Platz 1: von Platz 2 auf Platz 1 vorgerückt -> Krone, nicht 'verbessert'.
deleted = false;
sentContent = '';
usedChannel = '';
await sendPlacementPings(overtakeRuntime, [
  { userId: 'u2', addedRoleIds: ['r-daily-chat-1'], removedRoleIds: ['r-daily-chat-2'] }
], { ...pingConf, placementPingChannelId: 'chan' }, { lifetimeSeconds: 0.02 });
assert.match(sentContent, /Platz 1/);
// Platz-1-Krönung: eine der drei Krönungs-Varianten muss drin sein.
assert.match(sentContent, /du führst jetzt die Wertung an|die Spitze gehört jetzt dir|du bist ganz oben angekommen/);
assert.doesNotMatch(sentContent, /verbessert/);

// Satz-Varianten: pickPhrase wählt bei unterschiedlichen Zufallswerten
// verschiedene Sätze aus dem Pool (deterministisch getestet).
assert.notEqual(
  pickPhrase(PING_PHRASES.uprank, () => 0),
  pickPhrase(PING_PHRASES.uprank, () => 0.99),
  'pickPhrase wählt verschiedene Varianten.'
);
for (const [name, pool] of Object.entries(PING_PHRASES)) {
  assert.ok(pool.length >= 2, `Pool "${name}" hat mindestens 2 Varianten.`);
}
// Und tatsächlich: Mehrere Pings an denselben Nutzer führen zu verschiedenen Sätzen.
deleted = false;
sentContent = '';
usedChannel = '';
const seenUprank = new Set();
for (let index = 0; index < 12; index += 1) {
  await sendPlacementPings(overtakeRuntime, [
    { userId: 'u2', addedRoleIds: ['r-daily-chat-2'], removedRoleIds: ['r-daily-chat-3'] }
  ], { ...pingConf, placementPingChannelId: 'chan' }, { lifetimeSeconds: 0.02 });
  seenUprank.add(sentContent);
}
assert.ok(seenUprank.size > 1, 'Mehrere Pings erzeugen unterschiedliche Sätze.');

// Abschluss-Ankündigung: abgeschlossene Kalenderwoche verkündet die Sieger.
const announceRuntime = {
  guild: {
    id: 'guild-1',
    channels: { cache: new Collection([['chan', { id: 'chan', name: 'aktivität-liga', type: 0, isTextBased: () => true, send: async () => ({}) }]]) },
    members: { cache: new Collection([['u1', { id: 'u1', user: { bot: false } }], ['u2', { id: 'u2', user: { bot: false } }]]) }
  },
  conf: { placementPings: true }
};
const completedWeekly = {
  periods: {
    weekly: {
      period: 'weekly',
      start: '2026-07-27',
      end: '2026-08-02',
      fullyTracked: true,
      chat: [{ userId: 'u2', value: 42 }, { userId: 'u1', value: 30 }],
      voice: [{ userId: 'u1', value: 3_720_000 }]
    },
    monthly: { period: 'monthly', fullyTracked: false, chat: [], voice: [] }
  }
};
const weeklyText = buildCompletionAnnouncement(announceRuntime, completedWeekly, 'weekly');
assert.match(weeklyText, /Kalenderwoche abgeschlossen/);
assert.match(weeklyText, /27\.07\.2026 – 02\.08\.2026/);
assert.match(weeklyText, /Chat/);
assert.match(weeklyText, /Sprachchat/);
assert.match(weeklyText, /<@u2>/);
assert.match(weeklyText, /42 Nachrichten/);
assert.match(weeklyText, /1 Std\. 2 Min\./);
assert.equal(buildCompletionAnnouncement(announceRuntime, completedWeekly, 'daily'), null, 'Tageswertung wird nicht angekündigt.');
assert.equal(buildCompletionAnnouncement(announceRuntime, completedWeekly, 'monthly'), null, 'Nicht abgeschlossener Monat wird nicht angekündigt.');

// announceCompletedPeriods: sendet genau einmal pro abgeschlossenem Zeitraum.
let announcementCount = 0;
const announceChannel = {
  async send() { announcementCount += 1; return {}; }
};
const announceData = {
  announcedPeriods: { weekly: '', monthly: '' }
};
const announceConf = {
  announceCompletedPeriods: true,
  placementPingChannelId: '',
  dailyChatRoleId: 'r-daily-chat-1'
};
const announceGuild = {
  id: 'guild-1',
  channels: { cache: new Collection([['chan', { ...announceChannel, id: 'chan', name: 'aktivität-liga', type: 0, isTextBased: () => true }]]) },
  members: { cache: new Collection([['u1', { id: 'u1', user: { bot: false } }], ['u2', { id: 'u2', user: { bot: false } }]]) }
};
// Eigener Ankündigungs-Kanal wird genutzt statt des Ranglisten-Kanals.
let announcementChannelUsed = '';
const customAnnounceChannel = {
  async send() { announcementChannelUsed = 'announce-chan'; return {}; }
};
const customAnnounceGuild = {
  id: 'guild-1',
  channels: {
    cache: new Collection([
      ['announce-chan', { ...customAnnounceChannel, id: 'announce-chan', name: 'liga-sieger', type: 0, isTextBased: () => true }],
      ['chan', { ...announceChannel, id: 'chan', name: 'aktivität-liga', type: 0, isTextBased: () => true }]
    ])
  },
  members: { cache: new Collection([['u1', { id: 'u1', user: { bot: false } }], ['u2', { id: 'u2', user: { bot: false } }]]) }
};
await announceCompletedPeriods({ guild: customAnnounceGuild }, { announcedPeriods: { weekly: '', monthly: '' } }, completedWeekly,
  { ...announceConf, announcementChannelId: 'announce-chan' });
assert.equal(announcementChannelUsed, 'announce-chan', 'Konfigurierter Ankündigungs-Kanal wird genutzt.');

announcementCount = 0;
await announceCompletedPeriods({ guild: announceGuild }, announceData, completedWeekly, announceConf);
assert.equal(announcementCount, 1, 'Abgeschlossene Woche wird einmal angekündigt.');
assert.equal(announceData.announcedPeriods.weekly, '2026-08-02', 'End-Datum wird persistiert.');
// Zweiter Lauf: gleicher Zeitraum -> keine erneute Ankündigung.
await announceCompletedPeriods({ guild: announceGuild }, announceData, completedWeekly, announceConf);
assert.equal(announcementCount, 1, 'Zeitraum wird nicht doppelt angekündigt.');
// Deaktiviert: nichts senden.
await announceCompletedPeriods({ guild: announceGuild }, announceData, completedWeekly, { ...announceConf, announceCompletedPeriods: false });
assert.equal(announcementCount, 1, 'Deaktivierte Ankündigungen senden nichts.');

console.log('activity-race-smoke: ok');
