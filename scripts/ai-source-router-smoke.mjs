import assert from 'node:assert/strict';

import { classifyAiRequest } from '../src/features/aiRouter.js';
import { _aiChatInternals } from '../src/features/aiChat.js';
import { normalizeConfig } from '../src/defaultConfig.js';

const { classifyServerKnowledgeIntent, buildDirectServerAnswer, buildMemberTimelineAnswer, normalizeSnowflakeIds, buildServerSnapshot } = _aiChatInternals;

assert.deepEqual(classifyServerKnowledgeIntent('Wer ist alles Owner hier im Server?'), { type: 'owner', direct: true });
assert.deepEqual(classifyServerKnowledgeIntent('Wer gehört alles zum Staff und Team?'), { type: 'staff', direct: true });
assert.deepEqual(classifyServerKnowledgeIntent('Wer hat aktuell VIP Gold?'), { type: 'economy', direct: false });
assert.deepEqual(classifyServerKnowledgeIntent('Wie sieht die Aktivitäts-Liga aus?'), { type: 'activity', direct: false });
assert.deepEqual(classifyServerKnowledgeIntent('Welches Level habe ich?'), { type: 'leveling', direct: false });
assert.deepEqual(classifyServerKnowledgeIntent('Habe ich ein offenes Support-Ticket?'), { type: 'tickets', direct: false });
assert.deepEqual(classifyServerKnowledgeIntent('Trage ich den Server-Tag?'), { type: 'server-tag', direct: false });
assert.deepEqual(classifyServerKnowledgeIntent('Wer ist alles auf diesem Server?'), { type: 'member-directory', direct: true });
assert.deepEqual(classifyServerKnowledgeIntent('Zeig die vollständige Mitgliederliste von unserem Server'), { type: 'member-directory', direct: true });
assert.deepEqual(classifyServerKnowledgeIntent('Wer hat zuletzt geboostet?'), { type: 'boosts', direct: true });
assert.deepEqual(classifyServerKnowledgeIntent('Wer hat FALLEN HEAVEN zuletzt geboostet?'), { type: 'boosts', direct: true });
assert.deepEqual(classifyServerKnowledgeIntent('Wer hat heute den Server verlassen?'), { type: 'member-left', direct: false });
assert.deepEqual(classifyServerKnowledgeIntent('Welche Channels kamen heute neu dazu?'), { type: 'channel-created', direct: false });
assert.deepEqual(classifyServerKnowledgeIntent('Was ist heute auf dem Server passiert?'), { type: 'server-history', direct: false });
assert.deepEqual(classifyServerKnowledgeIntent('Welche Informationen kannst du auf diesem Discord-Server abrufen?'), { type: 'data-capabilities', direct: true });
assert.equal(classifyServerKnowledgeIntent('Was sind die heutigen Nachrichten aus Deutschland?'), null);

const economyRoute = classifyAiRequest({ content: 'Wer hat VIP?', serverIntentType: 'economy' });
assert.equal(economyRoute.route, 'server_knowledge');
assert.equal(economyRoute.source, 'economy-store');
const activityRoute = classifyAiRequest({ content: 'Top Chatter', serverIntentType: 'activity' });
assert.equal(activityRoute.source, 'activity-store');
const ownerRoute = classifyAiRequest({ content: 'Wer ist Owner?', serverIntentType: 'owner' });
assert.equal(ownerRoute.source, 'discord-live');
assert.equal(classifyAiRequest({ content: 'Erzähl was über mich' }).route, 'personal_discord');
assert.equal(classifyAiRequest({ content: 'Zeig meine Timeline' }).memberField, 'timeline');
assert.equal(classifyAiRequest({ content: 'Welche Events gibt es heute in Berlin?', webEnabled: true }).route, 'web_research');
assert.equal(classifyAiRequest({ content: 'Fass die neuesten OpenAI News zusammen', webEnabled: true }).route, 'web_research');
assert.equal(classifyAiRequest({ content: 'Was hältst du von den heutigen OpenAI-News?', webEnabled: true }).route, 'web_research');
assert.equal(classifyAiRequest({ content: 'Was ist 2+2?', webEnabled: true }).route, 'local_conversation');
assert.equal(classifyAiRequest({ content: 'Wer hat zuletzt geboostet?', serverIntentType: 'boosts', webEnabled: true }).route, 'server_knowledge');
assert.equal(classifyAiRequest({ content: 'Welche Informationen kannst du über diesen Server abrufen?', serverIntentType: 'data-capabilities', webEnabled: true }).route, 'server_knowledge');

const ownerAnswer = buildDirectServerAnswer({ type: 'owner' }, {
  name: 'FALLEN HEAVEN',
  ownerId: '123456789012345678',
  ownerRoleMembers: [
    { id: '123456789012345678', roleName: 'Owner' },
    { id: '223456789012345678', roleName: 'Co-Owner' }
  ]
}, 'Wer ist Owner?');
assert.match(ownerAnswer, /<@123456789012345678>/);
assert.match(ownerAnswer, /<@223456789012345678>/);
assert.doesNotMatch(ownerAnswer, /Serverindexbelegen/);

const migratedConfig = normalizeConfig({
  guildId: '1276125977805721640',
  general: {
    staffRoleIds: '1371908853679132784\n1305621766286082058',
    ownerUserIds: '918550968440860723, 542068115161350174'
  }
});
assert.deepEqual(migratedConfig.general.staffRoleIds, ['1371908853679132784', '1305621766286082058']);
assert.deepEqual(migratedConfig.general.ownerUserIds, ['918550968440860723', '542068115161350174']);
assert.deepEqual(normalizeSnowflakeIds('1371908853679132784; 1305621766286082058'), ['1371908853679132784', '1305621766286082058']);

const liveMembers = new Map([
  ['123456789012345678', {
    id: '123456789012345678',
    displayName: 'Testmitglied',
    user: { username: 'testmitglied', bot: false },
    roles: { cache: new Map() },
    joinedAt: new Date('2026-08-01T12:00:00.000Z'),
    joinedTimestamp: Date.parse('2026-08-01T12:00:00.000Z'),
    premiumSinceTimestamp: null
  }]
]);
const malformedLegacySnapshot = await buildServerSnapshot({
  guild: {
    id: '1276125977805721640',
    name: 'FALLEN HEAVEN',
    ownerId: '123456789012345678',
    description: '',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    memberCount: 1,
    premiumSubscriptionCount: 0,
    premiumTier: 0,
    members: { cache: liveMembers, fetch: async () => liveMembers },
    roles: { cache: new Map() },
    channels: { cache: new Map() },
    scheduledEvents: { cache: new Map() },
    emojis: { cache: new Map() },
    stickers: { cache: new Map() }
  },
  member: null,
  cfg: { general: { staffRoleIds: '1371908853679132784\n1305621766286082058', ownerUserIds: '918550968440860723,542068115161350174' } },
  cacheSeconds: 0
});
assert.equal(malformedLegacySnapshot.humanCount, 1, 'Alte String-Konfigurationen dürfen den Live-Serverdatenpfad nicht mehr abstürzen lassen.');
assert.equal(malformedLegacySnapshot.members[0].id, '123456789012345678');

const requester = { id: '123456789012345678' };
const readableChannel = {
  id: '323456789012345678', name: 'sichtbar', type: 0, parentId: null, topic: '',
  permissionsFor: () => ({ has: () => true }), isTextBased: () => true, isThread: () => false
};
const hiddenChannel = {
  id: '423456789012345678', name: 'versteckt', type: 0, parentId: null, topic: '',
  permissionsFor: () => ({ has: () => false }), isTextBased: () => true, isThread: () => false
};
const permissionScopedSnapshot = await buildServerSnapshot({
  guild: {
    id: '1276125977805721640', name: 'FALLEN HEAVEN', ownerId: requester.id, description: '',
    createdAt: new Date('2024-01-01T00:00:00.000Z'), memberCount: 1, premiumSubscriptionCount: 0, premiumTier: 0,
    members: { cache: liveMembers, fetch: async () => liveMembers }, roles: { cache: new Map() },
    channels: { cache: new Map([[readableChannel.id, readableChannel], [hiddenChannel.id, hiddenChannel]]) },
    scheduledEvents: { cache: new Map() }, emojis: { cache: new Map() }, stickers: { cache: new Map() }
  },
  member: requester,
  cfg: {},
  cacheSeconds: 0
});
assert.equal(permissionScopedSnapshot.channelCount, 1, 'Versteckte Kanäle dürfen nicht einmal über die Kanalanzahl offengelegt werden.');

const directoryAnswer = buildDirectServerAnswer({ type: 'member-directory' }, {
  name: 'FALLEN HEAVEN',
  members: [
    { id: '123456789012345678' },
    { id: '223456789012345678' }
  ]
}, 'Wer ist alles auf diesem Server?');
assert.match(directoryAnswer, /2 Menschen/);
assert.match(directoryAnswer, /<@123456789012345678>/);

const timelineAnswer = buildMemberTimelineAnswer({ systemTimeline: [
  { type: 'member_joined', createdAt: '2026-08-01T12:00:00.000Z' },
  { type: 'boost_expired', createdAt: '2026-08-03T12:00:00.000Z' }
] }, 'dich');
assert.match(timelineAnswer, /Server-Boost ausgelaufen/);
assert.match(timelineAnswer, /Dem Server beigetreten/);

console.log('AI-Quellenrouter-Smoke bestanden: Vollständige Mitgliederliste, Profile, Timeline, Owner/Staff, VIP und Aktivitäts-Liga werden getrennt und migrationssicher geroutet.');
