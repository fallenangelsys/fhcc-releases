import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Collection, PermissionFlagsBits } from 'discord.js';

import { _memberIntelligenceInternals } from '../src/features/memberIntelligenceEngine.js';

const {
  resolveAllowedChannels,
  filterStateForReadScope,
  filterSystemTimelineForReadScope
} = _memberIntelligenceInternals;

const requester = {
  id: 'reader',
  permissions: { has: (flag) => flag === PermissionFlagsBits.ManageGuild }
};
const channel = (id, readable) => ({
  id,
  isTextBased: () => true,
  isThread: () => false,
  permissionsFor: () => ({ has: (flag) => readable && [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory].includes(flag) })
});
const guild = {
  id: 'guild',
  ownerId: 'owner',
  systemChannelId: 'public',
  channels: { cache: new Collection([['public', channel('public', true)], ['private', channel('private', false)]]) }
};

assert.deepEqual(resolveAllowedChannels(guild, requester), ['public'], 'ManageGuild darf private Kanäle nicht freischalten');

const visible = filterStateForReadScope({
  assertions: [
    { value: 'öffentlich', evidence: [{ channelId: 'public', createdAt: '2026-08-01T10:00:00.000Z' }] },
    { value: 'privat', evidence: [{ channelId: 'private', createdAt: '2026-08-03T10:00:00.000Z' }] }
  ],
  unclear: [{ evidence: { channelId: 'private' } }],
  introduction: { fields: [{ channelId: 'public', label: 'Hobby', value: 'Gaming', createdAt: '2026-08-01T10:00:00.000Z' }, { channelId: 'private', label: 'Geheim', value: 'Nein' }] },
  channels: [{ channelId: 'public', count: 4, lastMessageAt: '2026-08-01T10:00:00.000Z' }, { channelId: 'private', count: 99, lastMessageAt: '2026-08-03T10:00:00.000Z' }],
  links: [{ channelId: 'private', url: 'https://example.com/private' }],
  media: [{ channelId: 'private', url: 'https://example.com/private.png' }],
  evidence: [{ channelId: 'public', content: 'sichtbar', createdAt: '2026-08-01T10:00:00.000Z' }, { channelId: 'private', content: 'geheim', createdAt: '2026-08-03T10:00:00.000Z' }]
}, { count: 4, lastMessageAt: '2026-08-01T10:00:00.000Z' }, ['public']);

assert.deepEqual(visible.assertions.map((entry) => entry.value), ['öffentlich']);
assert.equal(visible.analyzedMessageCount, 4);
assert.equal(visible.totalMessages, 4);
assert.equal(visible.lastMessageAt, '2026-08-01T10:00:00.000Z');
assert.equal(visible.links.length, 0);
assert.equal(visible.media.length, 0);
assert.equal(visible.introduction.fields.length, 1);

const events = [
  { type: 'boost_started', channelId: 'public', channelName: 'hauptchat', createdAt: '2026-08-01T10:00:00.000Z' },
  { type: 'member_banned', channelId: 'public', createdAt: '2026-08-02T10:00:00.000Z' },
  { type: 'boost_started', channelId: 'private', createdAt: '2026-08-03T10:00:00.000Z' }
];
assert.deepEqual(
  filterSystemTimelineForReadScope({ events, allowedChannelIds: ['public'], guild, requester: { id: 'other', permissions: { has: () => false } }, targetUserId: 'target' }).map((entry) => entry.type),
  ['boost_started']
);
assert.deepEqual(
  filterSystemTimelineForReadScope({ events, allowedChannelIds: ['public'], guild, requester: { id: 'target', permissions: { has: () => false } }, targetUserId: 'target' }).map((entry) => entry.type),
  ['member_banned', 'boost_started']
);

const appSource = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
assert.match(appSource, /const rows = candidateMembers\.map\(\(member\) => \{/, 'Mitgliederliste muss sortierbare synchrone Basiszeilen erzeugen');
assert.match(appSource, /const visibleRows = rows\.slice\(/, 'Mitgliederliste muss vor teuren Profilauflösungen paginieren');
assert.match(appSource, /const visibleMembers = await Promise\.all\(visibleRows\.map\(/, 'Nur die sichtbare Seite darf asynchrone Profilbilder auflösen');
assert.doesNotMatch(appSource, /Promise\.all\(candidateMembers\.map\(async/, 'Profilbilder dürfen nicht für die gesamte Serverliste gleichzeitig aufgelöst werden');

console.log('Member-Intelligence-Rechtescope-Smoke bestanden.');
