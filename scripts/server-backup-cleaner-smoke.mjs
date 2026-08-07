import { strict as assert } from 'node:assert';
import { Collection, ChannelType, PermissionFlagsBits } from 'discord.js';

import { featureCards, normalizeConfig } from '../src/defaultConfig.js';
import { buildServerStructureSnapshot, _serverBackupInternals } from '../src/features/serverBackup.js';
import { _forumCleanerInternals } from '../src/features/forumCleaner.js';

const backupCard = featureCards.find((entry) => entry.id === 'serverBackup');
assert(backupCard, 'Server-Backup-Modul fehlt in der Modulübersicht.');
assert(backupCard.fields.some((field) => field.key === 'serverBackup.dailyHour'), 'Backup-Uhrzeit fehlt.');
assert(backupCard.fields.some((field) => field.key === 'serverBackup.restoreChannels'), 'Restore-Kanaloption fehlt.');

const normalized = normalizeConfig({
  guildId: 'guild',
  guildName: 'FALLEN HEAVEN',
  serverBackup: { dailyHour: 99, keepBackups: 1 },
  forumCleaner: { enabled: true, channelIds: ['forum'], deleteMissingStarter: true, deleteLeftAuthorPosts: true }
});
assert.equal(normalized.serverBackup.enabled, true, 'Server-Backup soll standardmäßig aktiv sein.');
assert.equal(normalized.serverBackup.dailyHour, 23, 'Backup-Stunde wird nicht begrenzt.');
assert.equal(normalized.serverBackup.keepBackups, 3, 'Backup-Aufbewahrung wird nicht begrenzt.');
assert.equal(normalized.forumCleaner.deleteMissingStarter, true, 'Gelöschte Startposts werden nicht aktiviert.');
assert.equal(normalized.forumCleaner.deleteLeftAuthorPosts, true, 'Ehemalige User werden nicht aktiviert.');

const role = {
  id: 'role-1',
  name: 'VIP',
  color: 0x8b82ff,
  hexColor: '#8b82ff',
  hoist: true,
  mentionable: false,
  managed: false,
  position: 2,
  rawPosition: 2,
  permissions: { bitfield: PermissionFlagsBits.ViewChannel },
  iconURL: () => null
};
const everyone = {
  ...role,
  id: 'guild',
  name: '@everyone',
  position: 0,
  rawPosition: 0
};
const category = {
  id: 'cat',
  name: 'Info',
  type: ChannelType.GuildCategory,
  parentId: null,
  position: 0,
  rawPosition: 0,
  permissionOverwrites: { cache: new Collection() },
  createdAt: new Date('2026-01-01T00:00:00Z'),
  isThread: () => false
};
const forum = {
  id: 'forum',
  name: 'vorstellung',
  type: ChannelType.GuildForum,
  parentId: 'cat',
  position: 1,
  rawPosition: 1,
  topic: 'Vorstellungen',
  nsfw: false,
  rateLimitPerUser: 0,
  defaultAutoArchiveDuration: 1440,
  defaultThreadRateLimitPerUser: 0,
  defaultForumLayout: 1,
  defaultSortOrder: 0,
  availableTags: [{ id: 'tag-1', name: 'Vorstellung', moderated: false, emojiId: null, emojiName: '✨' }],
  defaultReactionEmoji: { emojiId: null, emojiName: '✨' },
  permissionOverwrites: { cache: new Collection([['role-1', { id: 'role-1', type: 0, allow: { bitfield: PermissionFlagsBits.ViewChannel }, deny: { bitfield: 0n } }]]) },
  createdAt: new Date('2026-01-02T00:00:00Z'),
  isThread: () => false
};

const guild = {
  id: 'guild',
  name: 'FALLEN HEAVEN',
  description: 'Test',
  ownerId: 'owner',
  preferredLocale: 'de',
  verificationLevel: 1,
  explicitContentFilter: 2,
  defaultMessageNotifications: 1,
  afkChannelId: null,
  afkTimeout: 300,
  systemChannelId: null,
  rulesChannelId: null,
  publicUpdatesChannelId: null,
  premiumProgressBarEnabled: true,
  premiumTier: 2,
  premiumSubscriptionCount: 53,
  memberCount: 2245,
  features: ['COMMUNITY'],
  createdAt: new Date('2025-01-01T00:00:00Z'),
  iconURL: () => 'https://cdn.discordapp.com/icons/guild/icon.png',
  bannerURL: () => null,
  splashURL: () => null,
  discoverySplashURL: () => null,
  channels: {
    cache: new Collection([['cat', category], ['forum', forum]]),
    fetch: async () => null
  },
  roles: {
    everyone,
    cache: new Collection([['guild', everyone], ['role-1', role]]),
    fetch: async () => null
  },
  emojis: {
    cache: new Collection([['emoji-1', { id: 'emoji-1', name: 'fh', animated: false, available: true, managed: false, requiresColons: true, imageURL: () => 'https://cdn.discordapp.com/emojis/emoji-1.png', createdAt: new Date('2026-01-03T00:00:00Z') }]]),
    fetch: async () => null
  },
  stickers: {
    cache: new Collection([['sticker-1', { id: 'sticker-1', name: 'halo', description: 'Halo', tags: 'halo', format: 1, available: true, url: 'https://media.discordapp.net/stickers/sticker-1.png', createdAt: new Date('2026-01-04T00:00:00Z') }]]),
    fetch: async () => null
  },
  scheduledEvents: {
    cache: new Collection(),
    fetch: async () => null
  }
};

const snapshot = await buildServerStructureSnapshot(guild, normalized.serverBackup);
assert.equal(snapshot.chatContentsIncluded, false, 'Backups dürfen keine Chat-Inhalte enthalten.');
assert.equal(snapshot.stats.channelCount, 2, 'Kanäle werden nicht gezählt.');
assert.equal(snapshot.stats.roleCount, 1, 'Rollen werden nicht gezählt.');
assert.equal(snapshot.channels[1].availableTags[0].name, 'Vorstellung', 'Forum-Tags werden nicht gesichert.');
assert.equal(snapshot.channels[1].permissionOverwrites[0].allow, PermissionFlagsBits.ViewChannel.toString(), 'Kanalrechte werden nicht gesichert.');

const missing = _serverBackupInternals.missingByIdOrName([{ id: 'old', name: 'VIP' }, { id: 'missing', name: 'Team' }], [{ id: 'live', name: 'VIP' }]);
assert.equal(missing.length, 1, 'Restore-Vorschau erkennt fehlende Einträge nicht sauber.');

const cleanerConf = _forumCleanerInternals.normalizeForumCleanerConfig({
  enabled: true,
  channelIds: ['forum'],
  graceMinutes: 1,
  requireNoReplies: true,
  deleteMissingStarter: true,
  dryRun: false
});
let deletedReason = '';
const fakeThread = {
  id: 'thread',
  type: ChannelType.PublicThread,
  parentId: 'forum',
  parent: { type: ChannelType.GuildForum, permissionsFor: () => ({ has: () => true }) },
  guild: {
    id: 'guild',
    channels: { fetch: async () => fakeThread },
    members: { me: {}, cache: new Collection(), fetch: async () => null }
  },
  isThread: () => true,
  archived: false,
  locked: false,
  manageable: true,
  createdTimestamp: Date.now() - 120_000,
  flags: { has: () => false, bitfield: 0 },
  permissionsFor: () => ({ has: () => true }),
  fetchStarterMessage: async () => null,
  messages: { fetch: async () => new Collection() },
  delete: async (reason) => { deletedReason = reason; }
};
const cleanerResult = await _forumCleanerInternals.deleteIfEmpty(fakeThread, cleanerConf, 'smoke');
assert.equal(cleanerResult.deleted, true, 'Thread mit gelöschter Startnachricht wird nicht gelöscht.');
assert.match(deletedReason, /Startnachricht/, 'Löschgrund für gelöschten Startpost fehlt.');

console.log('Server-Backup/Forum-Cleaner-Smoke: Strukturbackup, Restore-Vorschau und gelöschte Forum-Startposts bestanden.');
