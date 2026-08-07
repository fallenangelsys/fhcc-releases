import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PermissionFlagsBits } from 'discord.js';

const temporaryData = await fs.mkdtemp(path.join(os.tmpdir(), 'fhcc-ai-direct-facts-'));
process.env.FALLEN_HEAVEN_DATA_DIR = temporaryData;

const store = await import('../src/serverIndexStore.js');
const { _aiChatInternals } = await import('../src/features/aiChat.js');
const {
  latestBoostEvidence,
  buildLatestBoostAnswer,
  buildRecentChannelAnswer,
  buildDirectServerAnswer,
  buildDataCapabilitiesAnswer,
  buildChannelInfoAnswer,
  buildChannelPermissionsAnswer,
  buildChannelActivityAnswer,
  buildServerSettingsAnswer,
  buildRoleInfoAnswer,
  buildVoiceStateAnswer,
  buildMemberPresenceAnswer
} = _aiChatInternals;

const guildId = '1276125977805721640';
const channelId = '1524484484236578919';
const boosterId = '918550968440860723';
const createdAt = new Date().toISOString();
await store.persistServerIndexMessages([{
  id: '1534255511000000001',
  guildId,
  channelId,
  channelName: 'boost-info',
  authorId: boosterId,
  authorName: 'FALLEN ANGEL',
  authorBot: false,
  type: 8,
  system: true,
  systemEvent: 'boost_started',
  createdAt,
  content: 'FALLEN ANGEL hat den Server gerade 2-mal geboostet!',
  embeds: [],
  attachments: []
}]);

const readablePermissions = { has: () => true };
const requester = { id: '542068115161350174' };
const booster = { id: boosterId, user: { bot: false }, premiumSinceTimestamp: Date.parse(createdAt) };
const channel = {
  id: channelId,
  name: 'boost-info',
  createdTimestamp: Date.now(),
  permissionsFor: () => readablePermissions
};
const guild = {
  id: guildId,
  premiumSubscriptionCount: 2,
  members: { cache: new Map([[boosterId, booster]]) },
  channels: { cache: new Map([[channelId, channel]]) }
};
const message = { guild, member: requester, author: requester, content: 'Wer hat zuletzt geboostet?' };

const evidence = await latestBoostEvidence(message);
assert.equal(evidence?.userId, boosterId);
assert.equal(evidence?.source, 'discord-system-index');
const answer = await buildLatestBoostAnswer(message);
assert.match(answer, new RegExp(`<@${boosterId}>`));
assert.match(answer, /zuletzt.*geboostet/i);
assert.doesNotMatch(answer, /Telegram|Spiel|Web|https?:/i);

const channelAnswer = buildRecentChannelAnswer(message, 'Welche Channels kamen heute neu?');
assert.match(channelAnswer, new RegExp(`<#${channelId}>`));
channel.lastMessageId = '1534255511000000001';
const channelActivity = await buildChannelActivityAnswer({ guild, channel, content: 'Wie viele Nachrichten sind hier?' });
assert.match(channelActivity, /\*\*1 Nachricht/);
assert.match(channelActivity, /letzte Discord-Nachricht/);

const capabilities = buildDataCapabilitiesAnswer();
assert.match(capabilities, /Live-Mitglieder/);
assert.match(capabilities, /Aktivitäts-Liga/);
assert.match(capabilities, /Websuche.*nur für externe Themen/i);

const forum = {
  id: '1534255511000000100',
  parentId: '1534255511000000101',
  type: 15,
  createdTimestamp: Date.parse('2026-08-01T08:00:00.000Z'),
  topic: 'Hier werden Community-Projekte vorgestellt.',
  nsfw: false,
  rateLimitPerUser: 15,
  availableTags: [{ name: 'Vorstellung' }, { name: 'Projekt' }]
};
const channelInfo = await buildChannelInfoAnswer(forum);
assert.match(channelInfo, /Forum/);
assert.match(channelInfo, /<#1534255511000000101>/);
assert.match(channelInfo, /Langsammodus: 15 Sek\./);
assert.match(channelInfo, /`Vorstellung`/);

const channelPermissionBits = new Set([
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.AddReactions,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.CreatePublicThreads
]);
const permissionChannel = {
  id: '1534255511000000110',
  type: 0,
  permissionsFor: () => ({ has: (flag) => channelPermissionBits.has(flag) })
};
const permissionOverview = buildChannelPermissionsAnswer(permissionChannel, requester, 'Welche Rechte habe ich hier?');
assert.match(permissionOverview, /Nachrichten schreiben/);
assert.match(permissionOverview, /den Kanal verwalten/);
assert.match(permissionOverview, /Nicht erlaubt/);
assert.match(buildChannelPermissionsAnswer(permissionChannel, requester, 'Darf ich hier Nachrichten schreiben?'), /^Ja,/);
assert.match(buildChannelPermissionsAnswer(permissionChannel, requester, 'Kann ich hier Nachrichten verwalten?'), /^Nein,/);

Object.assign(guild, {
  afkChannelId: '1534255511000000120',
  afkTimeout: 900,
  systemChannelId: '1534255511000000121',
  rulesChannelId: '1534255511000000122',
  publicUpdatesChannelId: '1534255511000000123',
  safetyAlertsChannelId: '1534255511000000124',
  explicitContentFilter: 2,
  defaultMessageNotifications: 1,
  mfaLevel: 1,
  premiumProgressBarEnabled: true,
  features: ['COMMUNITY']
});
assert.match(buildServerSettingsAnswer(guild, 'Welcher AFK-Kanal ist eingestellt?'), /15 Min\./);
assert.match(buildServerSettingsAnswer(guild, 'Was ist der Regelkanal?'), /<#1534255511000000122>/);
assert.match(buildServerSettingsAnswer(guild, 'Wie ist der Inhaltsfilter eingestellt?'), /für alle Mitglieder/);
assert.match(buildServerSettingsAnswer(guild, 'Ist der Community-Modus aktiv?'), /aktiv/);

const roleMember = { id: '1534255511000000200', user: { bot: false } };
const botRoleMember = { id: '1534255511000000201', user: { bot: true } };
const role = {
  id: '1534255511000000202',
  name: 'VIP: DIAMANT',
  position: 42,
  hexColor: '#9b59b6',
  mentionable: true,
  managed: false,
  members: new Map([[roleMember.id, roleMember], [botRoleMember.id, botRoleMember]])
};
guild.roles = { cache: new Map([[guild.id, { id: guild.id, name: '@everyone' }], [role.id, role]]) };
const roleInfo = buildRoleInfoAnswer(guild, `Was ist die Rolle <@&${role.id}>?`);
assert.match(roleInfo, /Mitglieder: 1/);
assert.match(roleInfo, /#9b59b6/i);
const roleMembers = buildRoleInfoAnswer(guild, `Wer hat <@&${role.id}>?`);
assert.match(roleMembers, new RegExp(`<@${roleMember.id}>`));
assert.doesNotMatch(roleMembers, new RegExp(`<@${botRoleMember.id}>`));

const visibleVoiceId = '1534255511000000300';
const hiddenVoiceId = '1534255511000000301';
const voiceMember = { id: '1534255511000000302', user: { bot: false }, voice: { channelId: visibleVoiceId } };
const hiddenVoiceMember = { id: '1534255511000000303', user: { bot: false }, voice: { channelId: hiddenVoiceId } };
const visibleVoice = {
  id: visibleVoiceId,
  type: 2,
  permissionsFor: () => ({ has: () => true }),
  members: new Map([[voiceMember.id, voiceMember]])
};
const hiddenVoice = {
  id: hiddenVoiceId,
  type: 2,
  permissionsFor: () => ({ has: () => false }),
  members: new Map([[hiddenVoiceMember.id, hiddenVoiceMember]])
};
guild.members.cache.set(voiceMember.id, voiceMember);
guild.members.cache.set(hiddenVoiceMember.id, hiddenVoiceMember);
guild.channels.cache.set(visibleVoice.id, visibleVoice);
guild.channels.cache.set(hiddenVoice.id, hiddenVoice);
const voiceOverview = buildVoiceStateAnswer({ guild, requester });
assert.match(voiceOverview, new RegExp(`<#${visibleVoiceId}>`));
assert.doesNotMatch(voiceOverview, new RegExp(hiddenVoiceId));
assert.match(buildVoiceStateAnswer({ guild, requester, targetId: voiceMember.id }), new RegExp(`<#${visibleVoiceId}>`));
assert.match(buildVoiceStateAnswer({ guild, requester, targetId: hiddenVoiceMember.id }), /nicht sichtbar/);

const presenceMember = {
  id: '1534255511000000400',
  presence: {
    status: 'idle',
    clientStatus: { desktop: 'idle', mobile: 'idle' },
    activities: [{ type: 0, name: 'Minecraft', details: 'FALLEN HEAVEN' }]
  }
};
assert.match(buildMemberPresenceAnswer({ member: presenceMember, query: 'Was spielt er gerade?' }), /Minecraft/);
assert.match(buildMemberPresenceAnswer({ member: presenceMember, query: 'Welches Gerät nutzt er?' }), /Desktop.*Mobilgerät/);
assert.match(buildMemberPresenceAnswer({ member: presenceMember, self: true, query: 'Was ist mein Status?' }), /abwesend.*Du spielst/s);

const eventStart = new Date(Date.now() + 86_400_000).toISOString();
const eventSnapshot = {
  events: [{ name: 'Community-Abend', description: 'Gemeinsam spielen und reden.', startsAt: eventStart, endsAt: '', channelId: visibleVoiceId, location: '' }]
};
assert.match(buildDirectServerAnswer({ type: 'events' }, eventSnapshot, 'Wann beginnt das nächste Serverevent?', message), /Community-Abend.*<t:/);
assert.match(buildDirectServerAnswer({ type: 'events' }, eventSnapshot, 'Wo findet das nächste Serverevent statt?', message), new RegExp(`<#${visibleVoiceId}>`));
assert.match(buildDirectServerAnswer({ type: 'events' }, eventSnapshot, 'Was passiert beim nächsten Serverevent?', message), /Gemeinsam spielen/);

channel.permissionsFor = () => ({ has: () => false });
assert.equal(await latestBoostEvidence(message), null, 'Unsichtbare Systemkanäle dürfen keine Boost-Person offenlegen.');

await store.closeServerIndex();
await fs.rm(temporaryData, { recursive: true, force: true });

console.log('AI-Direktdaten-Smoke bestanden: letzter Boost, Kanaländerungen, Kanal-/Rollen-/Voice-Daten, Datenkatalog und Fail-Closed-Rechte sind belegt.');
