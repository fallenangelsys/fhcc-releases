import fs from 'node:fs/promises';
import path from 'node:path';

import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits
} from 'discord.js';

import { recordDiagnosticError, runTrackedOperation } from '../runtime/liveDiagnostics.js';
import { atomicWriteJson } from '../runtime/atomicJsonStore.js';

const DATA_ROOT = process.env.FALLEN_HEAVEN_DATA_DIR || path.join(process.cwd(), 'data');
const BACKUP_ROOT = path.join(DATA_ROOT, 'server-backups');
const timers = new Map();
const lastDailyRun = new Map();

const MANAGE_EXPRESSIONS = PermissionFlagsBits.ManageGuildExpressions || PermissionFlagsBits.ManageEmojisAndStickers;
const CATEGORY_TYPES = new Set([ChannelType.GuildCategory]);
const TEXT_LIKE_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildMedia]);
const VOICE_LIKE_TYPES = new Set([ChannelType.GuildVoice, ChannelType.GuildStageVoice]);

const clamp = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
};

const normalizeBackupConfig = (conf = {}) => ({
  enabled: conf?.enabled !== false,
  dailyHour: clamp(conf?.dailyHour, 5, 0, 23),
  keepBackups: clamp(conf?.keepBackups, 30, 3, 365),
  startupSafetyBackup: conf?.startupSafetyBackup !== false,
  includeGuildAssets: conf?.includeGuildAssets !== false,
  includeEmojis: conf?.includeEmojis !== false,
  includeStickers: conf?.includeStickers !== false,
  includeScheduledEvents: conf?.includeScheduledEvents !== false,
  restoreServerSettings: conf?.restoreServerSettings !== false,
  restoreRoles: conf?.restoreRoles !== false,
  restoreChannels: conf?.restoreChannels !== false,
  restoreEmojis: conf?.restoreEmojis === true,
  restoreStickers: conf?.restoreStickers === true,
  logChannelId: String(conf?.logChannelId || '').trim()
});

const cloneJson = (value) => JSON.parse(JSON.stringify(value));
const backupFolder = (guildId) => path.join(BACKUP_ROOT, String(guildId));
const safeBackupId = (value) => path.basename(String(value || '').trim()).replace(/[^a-zA-Z0-9._-]/g, '');
const nowStamp = () => new Date().toISOString().replace(/[:.]/g, '-');

const snowflakeDate = (id) => {
  const raw = BigInt(String(id || '0'));
  if (!raw) return null;
  const discordEpoch = 1420070400000n;
  const ms = Number((raw >> 22n) + discordEpoch);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

const sortedByPosition = (left, right) =>
  Number(left.rawPosition ?? left.position ?? 0) - Number(right.rawPosition ?? right.position ?? 0)
  || String(left.name || '').localeCompare(String(right.name || ''), 'de', { sensitivity: 'base' });

const serializePermissionOverwrites = (channel) => {
  const overwrites = channel?.permissionOverwrites?.cache;
  if (!overwrites?.size) return [];
  return overwrites.map((overwrite) => ({
    id: String(overwrite.id),
    type: Number(overwrite.type),
    allow: overwrite.allow?.bitfield?.toString?.() || '0',
    deny: overwrite.deny?.bitfield?.toString?.() || '0'
  }));
};

const serializeRole = (role) => ({
  id: role.id,
  name: role.name,
  color: role.color || 0,
  hexColor: role.hexColor || '#000000',
  hoist: Boolean(role.hoist),
  mentionable: Boolean(role.mentionable),
  managed: Boolean(role.managed),
  position: Number(role.position || 0),
  rawPosition: Number(role.rawPosition ?? role.position ?? 0),
  permissions: role.permissions?.bitfield?.toString?.() || '0',
  unicodeEmoji: role.unicodeEmoji || '',
  icon: role.iconURL?.({ size: 128 }) || null,
  tags: role.tags ? {
    botId: role.tags.botId || null,
    integrationId: role.tags.integrationId || null,
    premiumSubscriberRole: Boolean(role.tags.premiumSubscriberRole)
  } : null
});

const serializeChannel = (channel) => {
  const base = {
    id: channel.id,
    name: channel.name || channel.id,
    type: Number(channel.type),
    parentId: channel.parentId || null,
    position: Number(channel.position ?? 0),
    rawPosition: Number(channel.rawPosition ?? channel.position ?? 0),
    permissionOverwrites: serializePermissionOverwrites(channel),
    createdAt: channel.createdAt?.toISOString?.() || snowflakeDate(channel.id)
  };

  if ('topic' in channel) base.topic = channel.topic || '';
  if ('nsfw' in channel) base.nsfw = Boolean(channel.nsfw);
  if ('rateLimitPerUser' in channel) base.rateLimitPerUser = Number(channel.rateLimitPerUser || 0);
  if ('defaultAutoArchiveDuration' in channel) base.defaultAutoArchiveDuration = Number(channel.defaultAutoArchiveDuration || 0);
  if ('defaultThreadRateLimitPerUser' in channel) base.defaultThreadRateLimitPerUser = Number(channel.defaultThreadRateLimitPerUser || 0);
  if ('defaultForumLayout' in channel) base.defaultForumLayout = Number(channel.defaultForumLayout || 0);
  if ('defaultSortOrder' in channel) base.defaultSortOrder = channel.defaultSortOrder ?? null;
  if ('availableTags' in channel) {
    base.availableTags = (channel.availableTags || []).map((tag) => ({
      id: String(tag.id || ''),
      name: String(tag.name || ''),
      moderated: Boolean(tag.moderated),
      emojiId: tag.emojiId || null,
      emojiName: tag.emojiName || null
    }));
  }
  if ('defaultReactionEmoji' in channel) {
    base.defaultReactionEmoji = channel.defaultReactionEmoji ? {
      emojiId: channel.defaultReactionEmoji.emojiId || null,
      emojiName: channel.defaultReactionEmoji.emojiName || null
    } : null;
  }
  if ('bitrate' in channel) base.bitrate = Number(channel.bitrate || 0);
  if ('userLimit' in channel) base.userLimit = Number(channel.userLimit || 0);
  if ('rtcRegion' in channel) base.rtcRegion = channel.rtcRegion || null;
  if ('videoQualityMode' in channel) base.videoQualityMode = channel.videoQualityMode ?? null;

  return base;
};

const serializeEmoji = (emoji) => ({
  id: emoji.id,
  name: emoji.name,
  animated: Boolean(emoji.animated),
  available: emoji.available !== false,
  managed: Boolean(emoji.managed),
  requiresColons: emoji.requiresColons !== false,
  url: emoji.imageURL?.({ extension: emoji.animated ? 'gif' : 'png', size: 128 }) || null,
  createdAt: emoji.createdAt?.toISOString?.() || snowflakeDate(emoji.id)
});

const serializeSticker = (sticker) => ({
  id: sticker.id,
  name: sticker.name,
  description: sticker.description || '',
  tags: sticker.tags || '',
  format: Number(sticker.format || 0),
  available: sticker.available !== false,
  url: sticker.url || `https://media.discordapp.net/stickers/${sticker.id}.png?size=320`,
  createdAt: sticker.createdAt?.toISOString?.() || snowflakeDate(sticker.id)
});

const serializeScheduledEvent = (event) => ({
  id: event.id,
  name: event.name,
  description: event.description || '',
  status: event.status,
  entityType: event.entityType,
  channelId: event.channelId || null,
  entityMetadata: cloneJson(event.entityMetadata || {}),
  scheduledStartAt: event.scheduledStartAt?.toISOString?.() || null,
  scheduledEndAt: event.scheduledEndAt?.toISOString?.() || null,
  privacyLevel: event.privacyLevel || null,
  image: event.coverImageURL?.({ size: 512 }) || null
});

export const buildServerStructureSnapshot = async (guild, conf = {}) => {
  const settings = normalizeBackupConfig(conf);
  await guild.channels.fetch().catch(() => null);
  await guild.roles.fetch?.().catch(() => null);
  if (settings.includeEmojis) await guild.emojis.fetch().catch(() => null);
  if (settings.includeStickers) await guild.stickers.fetch().catch(() => null);
  if (settings.includeScheduledEvents) await guild.scheduledEvents.fetch().catch(() => null);

  const roles = guild.roles.cache
    .filter((role) => role.id !== guild.id)
    .sort((left, right) => Number(left.position || 0) - Number(right.position || 0))
    .map(serializeRole);

  const everyone = guild.roles.everyone ? serializeRole(guild.roles.everyone) : null;

  const channels = guild.channels.cache
    .filter((channel) => !channel.isThread?.())
    .sort(sortedByPosition)
    .map(serializeChannel);

  return {
    schemaVersion: 1,
    kind: 'fallen-heaven-server-structure-backup',
    createdAt: new Date().toISOString(),
    source: 'bot',
    chatContentsIncluded: false,
    guild: {
      id: guild.id,
      name: guild.name,
      description: guild.description || '',
      ownerId: guild.ownerId,
      icon: settings.includeGuildAssets ? guild.iconURL?.({ size: 512, extension: 'png' }) || null : null,
      banner: settings.includeGuildAssets ? guild.bannerURL?.({ size: 1024, extension: 'png' }) || null : null,
      splash: settings.includeGuildAssets ? guild.splashURL?.({ size: 1024, extension: 'png' }) || null : null,
      discoverySplash: settings.includeGuildAssets ? guild.discoverySplashURL?.({ size: 1024, extension: 'png' }) || null : null,
      preferredLocale: guild.preferredLocale || 'de',
      verificationLevel: guild.verificationLevel,
      explicitContentFilter: guild.explicitContentFilter,
      defaultMessageNotifications: guild.defaultMessageNotifications,
      afkChannelId: guild.afkChannelId || null,
      afkTimeout: guild.afkTimeout || 300,
      systemChannelId: guild.systemChannelId || null,
      rulesChannelId: guild.rulesChannelId || null,
      publicUpdatesChannelId: guild.publicUpdatesChannelId || null,
      premiumProgressBarEnabled: Boolean(guild.premiumProgressBarEnabled),
      premiumTier: guild.premiumTier || 0,
      premiumSubscriptionCount: guild.premiumSubscriptionCount || 0,
      memberCount: guild.memberCount || 0,
      features: [...(guild.features || [])].sort(),
      createdAt: guild.createdAt?.toISOString?.() || snowflakeDate(guild.id)
    },
    roles: {
      everyone,
      items: roles
    },
    channels,
    emojis: settings.includeEmojis ? guild.emojis.cache.map(serializeEmoji).sort((a, b) => a.name.localeCompare(b.name, 'de')) : [],
    stickers: settings.includeStickers ? guild.stickers.cache.map(serializeSticker).sort((a, b) => a.name.localeCompare(b.name, 'de')) : [],
    scheduledEvents: settings.includeScheduledEvents ? guild.scheduledEvents.cache.map(serializeScheduledEvent).sort((a, b) => String(a.scheduledStartAt || '').localeCompare(String(b.scheduledStartAt || ''))) : [],
    stats: {
      roleCount: roles.length,
      channelCount: channels.length,
      emojiCount: settings.includeEmojis ? guild.emojis.cache.size : 0,
      stickerCount: settings.includeStickers ? guild.stickers.cache.size : 0,
      scheduledEventCount: settings.includeScheduledEvents ? guild.scheduledEvents.cache.size : 0
    }
  };
};

const readBackupFile = async (guildId, backupId) => {
  const id = safeBackupId(backupId);
  if (!id) throw new Error('Backup-ID fehlt.');
  const folder = path.resolve(backupFolder(guildId));
  const file = path.resolve(folder, id.endsWith('.json') ? id : `${id}.json`);
  if (file !== folder && !file.startsWith(`${folder}${path.sep}`)) throw new Error('Ungültige Backup-ID.');
  const raw = await fs.readFile(file, 'utf8');
  return { id: path.basename(file), file, snapshot: JSON.parse(raw.replace(/^\uFEFF/, '')) };
};

export const listServerStructureBackups = async (guildId) => {
  const folder = backupFolder(guildId);
  const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => []);
  const rows = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const file = path.join(folder, entry.name);
    const stat = await fs.stat(file).catch(() => null);
    let meta = {};
    try {
      const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
      meta = {
        createdAt: parsed.createdAt || null,
        guildName: parsed.guild?.name || '',
        stats: parsed.stats || {},
        chatContentsIncluded: parsed.chatContentsIncluded === true
      };
    } catch {
      meta = {};
    }
    rows.push({
      id: entry.name,
      size: stat?.size || 0,
      updatedAt: stat?.mtime?.toISOString?.() || null,
      ...meta
    });
  }
  return rows.sort((a, b) => String(b.createdAt || b.updatedAt || '').localeCompare(String(a.createdAt || a.updatedAt || '')));
};

const pruneBackups = async (guildId, keepBackups) => {
  const backups = await listServerStructureBackups(guildId);
  const stale = backups.slice(Math.max(0, keepBackups));
  await Promise.all(stale.map((entry) => fs.rm(path.join(backupFolder(guildId), safeBackupId(entry.id)), { force: true }).catch(() => null)));
};

const sendBackupLog = async (guild, conf, embed) => {
  const channelId = String(conf?.logChannelId || '').trim();
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
};

export const createServerStructureBackup = async ({ guild, conf = {}, actorId = '', source = 'manual' }) => {
  if (!guild?.id) throw new Error('Server wurde nicht gefunden.');
  const settings = normalizeBackupConfig(conf);
  const snapshot = await buildServerStructureSnapshot(guild, settings);
  snapshot.source = source;
  snapshot.actorId = actorId || null;
  const folder = backupFolder(guild.id);
  await fs.mkdir(folder, { recursive: true });
  const name = `${nowStamp()}_${guild.id}.json`;
  const file = path.join(folder, name);
  await atomicWriteJson(file, snapshot, { backupLimit: 0 });
  await pruneBackups(guild.id, settings.keepBackups);

  await sendBackupLog(guild, settings, new EmbedBuilder()
    .setColor(0x5eead4)
    .setTitle('Server-Backup gespeichert')
    .setDescription(`Struktur-Snapshot für **${guild.name}** wurde ohne Chat-Inhalte erstellt.`)
    .addFields(
      { name: 'Kanäle', value: String(snapshot.stats.channelCount), inline: true },
      { name: 'Rollen', value: String(snapshot.stats.roleCount), inline: true },
      { name: 'Emojis/Sticker', value: `${snapshot.stats.emojiCount}/${snapshot.stats.stickerCount}`, inline: true }
    )
    .setTimestamp(new Date(snapshot.createdAt)));

  return {
    id: name,
    createdAt: snapshot.createdAt,
    stats: snapshot.stats,
    size: Buffer.byteLength(JSON.stringify(snapshot), 'utf8')
  };
};

const missingByIdOrName = (backupItems, liveItems, typeFilter = null) => {
  const liveById = new Set(liveItems.map((item) => String(item.id)));
  const liveByName = new Set(liveItems
    .filter((item) => typeFilter === null || Number(item.type) === Number(typeFilter))
    .map((item) => String(item.name || '').toLocaleLowerCase('de')));
  return backupItems.filter((item) => !liveById.has(String(item.id)) && !liveByName.has(String(item.name || '').toLocaleLowerCase('de')));
};

export const previewServerStructureRestore = async ({ guild, backupId }) => {
  const { id, snapshot } = await readBackupFile(guild.id, backupId);
  const liveRoles = guild.roles.cache.filter((role) => role.id !== guild.id).map((role) => ({ id: role.id, name: role.name }));
  const liveChannels = guild.channels.cache.filter((channel) => !channel.isThread?.()).map((channel) => ({ id: channel.id, name: channel.name, type: Number(channel.type) }));
  const liveEmojis = guild.emojis.cache.map((emoji) => ({ id: emoji.id, name: emoji.name }));
  const liveStickers = guild.stickers.cache.map((sticker) => ({ id: sticker.id, name: sticker.name }));
  const missingRoles = missingByIdOrName((snapshot.roles?.items || []).filter((role) => !role.managed), liveRoles);
  const missingChannels = missingByIdOrName(snapshot.channels || [], liveChannels);
  const missingEmojis = missingByIdOrName((snapshot.emojis || []).filter((emoji) => !emoji.managed), liveEmojis);
  const missingStickers = missingByIdOrName(snapshot.stickers || [], liveStickers);
  return {
    id,
    createdAt: snapshot.createdAt,
    guildName: snapshot.guild?.name || '',
    chatContentsIncluded: snapshot.chatContentsIncluded === true,
    stats: snapshot.stats || {},
    missing: {
      roles: missingRoles.length,
      channels: missingChannels.length,
      emojis: missingEmojis.length,
      stickers: missingStickers.length
    },
    warnings: [
      'Restore löscht keine zusätzlichen aktuellen Rollen oder Kanäle.',
      'Chat-Inhalte sind nicht im Backup enthalten.',
      'User-spezifische Kanalrechte werden nur gesetzt, wenn der User noch auf dem Server ist.'
    ]
  };
};

const canManage = (guild, permission) => Boolean(guild.members.me?.permissions?.has?.(permission));

const findRole = (guild, source) => guild.roles.cache.get(String(source.id))
  || guild.roles.cache.find((role) => !role.managed && role.name === source.name)
  || null;

const rolePayload = (role) => ({
  name: String(role.name || 'Backup Rolle').slice(0, 100),
  color: Number(role.color || 0),
  hoist: Boolean(role.hoist),
  mentionable: Boolean(role.mentionable),
  permissions: BigInt(String(role.permissions || '0'))
});

const restoreRoles = async (guild, snapshot, result) => {
  if (!canManage(guild, PermissionFlagsBits.ManageRoles)) {
    result.warnings.push('Dem Bot fehlt „Rollen verwalten“.');
    return new Map();
  }
  const roleMap = new Map([[guild.id, guild.id]]);
  for (const source of snapshot.roles?.items || []) {
    if (source.managed) {
      result.skipped.roles += 1;
      continue;
    }
    let role = findRole(guild, source);
    try {
      if (role) {
        await role.edit(rolePayload(source), 'FALLEN HEAVEN Server-Backup Restore');
        result.updated.roles += 1;
      } else {
        role = await guild.roles.create({ ...rolePayload(source), reason: 'FALLEN HEAVEN Server-Backup Restore' });
        result.created.roles += 1;
      }
      roleMap.set(String(source.id), role.id);
    } catch (error) {
      result.errors.push(`Rolle ${source.name}: ${error?.message || error}`);
    }
  }
  for (const source of [...(snapshot.roles?.items || [])].sort((a, b) => Number(a.position || 0) - Number(b.position || 0))) {
    const liveId = roleMap.get(String(source.id));
    const role = liveId ? guild.roles.cache.get(liveId) : null;
    if (!role || role.managed) continue;
    await role.setPosition(Math.max(1, Number(source.position || 1)), { reason: 'FALLEN HEAVEN Server-Backup Rollenposition' }).catch(() => null);
  }
  return roleMap;
};

const findChannel = (guild, source, parentLiveId = null) => guild.channels.cache.get(String(source.id))
  || guild.channels.cache.find((channel) =>
    !channel.isThread?.()
    && Number(channel.type) === Number(source.type)
    && channel.name === source.name
    && (!parentLiveId || String(channel.parentId || '') === String(parentLiveId)))
  || null;

const mapPermissionOverwrites = async (guild, overwrites = [], roleMap = new Map()) => {
  const mapped = [];
  for (const overwrite of overwrites) {
    let id = roleMap.get(String(overwrite.id)) || String(overwrite.id || '');
    if (!id) continue;
    if (Number(overwrite.type) === 1) {
      const member = await guild.members.fetch(id).catch(() => null);
      if (!member) continue;
    }
    mapped.push({
      id,
      type: Number(overwrite.type),
      allow: BigInt(String(overwrite.allow || '0')),
      deny: BigInt(String(overwrite.deny || '0'))
    });
  }
  return mapped;
};

const channelEditPayload = (source, channelMap = new Map()) => {
  const payload = {
    name: String(source.name || 'backup-channel').slice(0, 100)
  };
  if (source.parentId && channelMap.has(String(source.parentId))) payload.parent = channelMap.get(String(source.parentId));
  if (TEXT_LIKE_TYPES.has(Number(source.type))) {
    if ('topic' in source) payload.topic = source.topic || null;
    if ('nsfw' in source) payload.nsfw = Boolean(source.nsfw);
    if ('rateLimitPerUser' in source) payload.rateLimitPerUser = Number(source.rateLimitPerUser || 0);
    if ('defaultAutoArchiveDuration' in source && source.defaultAutoArchiveDuration) payload.defaultAutoArchiveDuration = Number(source.defaultAutoArchiveDuration);
    if ('defaultThreadRateLimitPerUser' in source) payload.defaultThreadRateLimitPerUser = Number(source.defaultThreadRateLimitPerUser || 0);
    if (Array.isArray(source.availableTags)) payload.availableTags = source.availableTags.map((tag) => ({
      name: String(tag.name || '').slice(0, 20),
      moderated: Boolean(tag.moderated),
      emoji: tag.emojiId ? { id: String(tag.emojiId) } : tag.emojiName ? { name: String(tag.emojiName) } : undefined
    }));
    if ('defaultForumLayout' in source) payload.defaultForumLayout = source.defaultForumLayout;
    if ('defaultSortOrder' in source) payload.defaultSortOrder = source.defaultSortOrder;
  }
  if (VOICE_LIKE_TYPES.has(Number(source.type))) {
    if (source.bitrate) payload.bitrate = Number(source.bitrate);
    if ('userLimit' in source) payload.userLimit = Number(source.userLimit || 0);
    if ('rtcRegion' in source) payload.rtcRegion = source.rtcRegion || null;
    if ('videoQualityMode' in source) payload.videoQualityMode = source.videoQualityMode;
  }
  return payload;
};

const restoreChannels = async (guild, snapshot, roleMap, result) => {
  if (!canManage(guild, PermissionFlagsBits.ManageChannels)) {
    result.warnings.push('Dem Bot fehlt „Kanäle verwalten“.');
    return new Map();
  }
  const channelMap = new Map();
  const sources = [...(snapshot.channels || [])].sort((left, right) => {
    const leftCategory = CATEGORY_TYPES.has(Number(left.type));
    const rightCategory = CATEGORY_TYPES.has(Number(right.type));
    if (leftCategory !== rightCategory) return leftCategory ? -1 : 1;
    return Number(left.position || 0) - Number(right.position || 0);
  });
  for (const source of sources) {
    const parentLiveId = source.parentId ? channelMap.get(String(source.parentId)) : null;
    let channel = findChannel(guild, source, parentLiveId);
    try {
      const permissionOverwrites = await mapPermissionOverwrites(guild, source.permissionOverwrites || [], roleMap);
      if (channel) {
        await channel.edit(channelEditPayload(source, channelMap), 'FALLEN HEAVEN Server-Backup Restore');
        if (permissionOverwrites.length) await channel.permissionOverwrites.set(permissionOverwrites, 'FALLEN HEAVEN Server-Backup Rechte');
        result.updated.channels += 1;
      } else {
        channel = await guild.channels.create({
          ...channelEditPayload(source, channelMap),
          type: Number(source.type),
          permissionOverwrites,
          reason: 'FALLEN HEAVEN Server-Backup Restore'
        });
        result.created.channels += 1;
      }
      channelMap.set(String(source.id), channel.id);
      await channel.setPosition(Number(source.position || 0), { reason: 'FALLEN HEAVEN Server-Backup Kanalposition' }).catch(() => null);
    } catch (error) {
      result.errors.push(`Kanal ${source.name}: ${error?.message || error}`);
    }
  }
  return channelMap;
};

const fetchAssetBuffer = async (url) => {
  const target = String(url || '');
  if (!/^https:\/\/(?:cdn|media)\.discordapp\.(?:com|net)\//i.test(target)) return null;
  const response = await fetch(target).catch(() => null);
  if (!response?.ok) return null;
  return Buffer.from(await response.arrayBuffer());
};

const restoreEmojis = async (guild, snapshot, result) => {
  if (!canManage(guild, MANAGE_EXPRESSIONS)) {
    result.warnings.push('Dem Bot fehlt „Ausdrücke verwalten“ für Emojis.');
    return;
  }
  for (const source of snapshot.emojis || []) {
    if (source.managed) {
      result.skipped.emojis += 1;
      continue;
    }
    const existing = guild.emojis.cache.get(String(source.id)) || guild.emojis.cache.find((emoji) => emoji.name === source.name);
    if (existing) {
      if (existing.name !== source.name) await existing.edit({ name: source.name }, 'FALLEN HEAVEN Server-Backup Restore').catch(() => null);
      result.updated.emojis += 1;
      continue;
    }
    const image = await fetchAssetBuffer(source.url);
    if (!image) {
      result.errors.push(`Emoji ${source.name}: Bild konnte nicht geladen werden.`);
      continue;
    }
    await guild.emojis.create({ attachment: image, name: source.name, reason: 'FALLEN HEAVEN Server-Backup Restore' })
      .then(() => { result.created.emojis += 1; })
      .catch((error) => result.errors.push(`Emoji ${source.name}: ${error?.message || error}`));
  }
};

const restoreStickers = async (guild, snapshot, result) => {
  if (!canManage(guild, MANAGE_EXPRESSIONS)) {
    result.warnings.push('Dem Bot fehlt „Ausdrücke verwalten“ für Sticker.');
    return;
  }
  for (const source of snapshot.stickers || []) {
    const existing = guild.stickers.cache.get(String(source.id)) || guild.stickers.cache.find((sticker) => sticker.name === source.name);
    if (existing) {
      result.updated.stickers += 1;
      continue;
    }
    const file = await fetchAssetBuffer(source.url);
    if (!file) {
      result.errors.push(`Sticker ${source.name}: Datei konnte nicht geladen werden.`);
      continue;
    }
    await guild.stickers.create({
      file,
      name: source.name,
      tags: source.tags || '🙂',
      description: source.description || null,
      reason: 'FALLEN HEAVEN Server-Backup Restore'
    })
      .then(() => { result.created.stickers += 1; })
      .catch((error) => result.errors.push(`Sticker ${source.name}: ${error?.message || error}`));
  }
};

const restoreGuildSettings = async (guild, snapshot, channelMap, result) => {
  if (!canManage(guild, PermissionFlagsBits.ManageGuild)) {
    result.warnings.push('Dem Bot fehlt „Server verwalten“.');
    return;
  }
  const source = snapshot.guild || {};
  const payload = {
    name: source.name || guild.name,
    description: source.description || null,
    verificationLevel: source.verificationLevel,
    explicitContentFilter: source.explicitContentFilter,
    defaultMessageNotifications: source.defaultMessageNotifications,
    afkTimeout: Number(source.afkTimeout || guild.afkTimeout || 300),
    premiumProgressBarEnabled: Boolean(source.premiumProgressBarEnabled)
  };
  if (source.afkChannelId && channelMap.has(String(source.afkChannelId))) payload.afkChannel = channelMap.get(String(source.afkChannelId));
  if (source.systemChannelId && channelMap.has(String(source.systemChannelId))) payload.systemChannel = channelMap.get(String(source.systemChannelId));
  if (source.rulesChannelId && channelMap.has(String(source.rulesChannelId))) payload.rulesChannel = channelMap.get(String(source.rulesChannelId));
  if (source.publicUpdatesChannelId && channelMap.has(String(source.publicUpdatesChannelId))) payload.publicUpdatesChannel = channelMap.get(String(source.publicUpdatesChannelId));
  await guild.edit(payload, 'FALLEN HEAVEN Server-Backup Restore')
    .then(() => { result.updated.guild = 1; })
    .catch((error) => result.errors.push(`Server-Einstellungen: ${error?.message || error}`));

  const assets = [
    ['icon', source.icon, 'Server-Icon'],
    ['banner', source.banner, 'Server-Banner'],
    ['splash', source.splash, 'Einladungs-Splash'],
    ['discoverySplash', source.discoverySplash, 'Discovery-Splash']
  ];
  for (const [key, url, label] of assets) {
    if (!url) continue;
    const image = await fetchAssetBuffer(url);
    if (!image) {
      result.warnings.push(`${label}: Bildquelle war nicht mehr abrufbar.`);
      continue;
    }
    await guild.edit({ [key]: image }, `FALLEN HEAVEN Server-Backup Restore · ${label}`)
      .catch((error) => result.errors.push(`${label}: ${error?.message || error}`));
  }
};

export const restoreServerStructureBackup = async ({ guild, conf = {}, backupId, options = {}, actorId = '' }) => {
  if (!guild?.id) throw new Error('Server wurde nicht gefunden.');
  const settings = { ...normalizeBackupConfig(conf), ...(options || {}) };
  const { id, snapshot } = await readBackupFile(guild.id, backupId);
  if (snapshot.kind !== 'fallen-heaven-server-structure-backup' || snapshot.chatContentsIncluded === true) {
    throw new Error('Dieses Backup ist kein sicherer Server-Struktur-Snapshot.');
  }
  const result = {
    id,
    actorId: actorId || null,
    restoredAt: new Date().toISOString(),
    created: { roles: 0, channels: 0, emojis: 0, stickers: 0 },
    updated: { guild: 0, roles: 0, channels: 0, emojis: 0, stickers: 0 },
    skipped: { roles: 0, channels: 0, emojis: 0, stickers: 0 },
    warnings: [],
    errors: []
  };
  const roleMap = settings.restoreRoles ? await restoreRoles(guild, snapshot, result) : new Map([[guild.id, guild.id]]);
  const channelMap = settings.restoreChannels ? await restoreChannels(guild, snapshot, roleMap, result) : new Map();
  if (settings.restoreServerSettings) await restoreGuildSettings(guild, snapshot, channelMap, result);
  if (settings.restoreEmojis) await restoreEmojis(guild, snapshot, result);
  if (settings.restoreStickers) await restoreStickers(guild, snapshot, result);

  await sendBackupLog(guild, settings, new EmbedBuilder()
    .setColor(result.errors.length ? 0xffbd59 : 0x8b82ff)
    .setTitle('Server-Backup wiederhergestellt')
    .setDescription(`Restore aus **${id}** abgeschlossen. Zusätzliche aktuelle Rollen/Kanäle wurden nicht gelöscht.`)
    .addFields(
      { name: 'Erstellt', value: `${result.created.channels} Kanäle, ${result.created.roles} Rollen`, inline: true },
      { name: 'Aktualisiert', value: `${result.updated.channels} Kanäle, ${result.updated.roles} Rollen`, inline: true },
      { name: 'Hinweise/Fehler', value: `${result.warnings.length}/${result.errors.length}`, inline: true }
    )
    .setTimestamp(new Date()));

  return result;
};

const dueKey = (guildId) => `${guildId}:${new Date().toISOString().slice(0, 10)}`;

const runDailyIfDue = async (guild, cfg, source = 'daily') => {
  const conf = normalizeBackupConfig(cfg?.serverBackup);
  if (!conf.enabled) return null;
  const key = dueKey(guild.id);
  if (lastDailyRun.get(guild.id) === key) return null;
  if (source === 'daily' && new Date().getHours() < conf.dailyHour) return null;
  lastDailyRun.set(guild.id, key);
  return runTrackedOperation('Server-Backup täglich', {
    featureId: 'serverBackup',
    hook: source,
    guildId: guild.id
  }, () => createServerStructureBackup({ guild, conf, source }), {
    timeoutMs: 8 * 60_000
  }).catch((error) => {
    lastDailyRun.delete(guild.id);
    recordDiagnosticError('serverBackup.daily', error, { guildId: guild.id });
    console.warn(`[serverBackup] Backup für ${guild.name} fehlgeschlagen: ${error?.message || error}`);
    return null;
  });
};

const ensureSchedule = (guild, cfg) => {
  const conf = normalizeBackupConfig(cfg?.serverBackup);
  const previous = timers.get(guild.id);
  if (previous) clearInterval(previous);
  timers.delete(guild.id);
  if (!conf.enabled) return;
  if (conf.startupSafetyBackup) {
    setTimeout(() => void runDailyIfDue(guild, cfg, 'startup').catch(() => null), 20_000).unref?.();
  }
  const timer = setInterval(() => void runDailyIfDue(guild, cfg, 'daily').catch(() => null), 30 * 60_000);
  timer.unref?.();
  timers.set(guild.id, timer);
};

export const feature = {
  id: 'serverBackup',
  name: 'Server-Backup',

  async onClientReady({ guild, cfg }) {
    ensureSchedule(guild, cfg);
  },

  async onConfigUpdate({ guild, cfg, patch }) {
    if (!patch || !Object.prototype.hasOwnProperty.call(patch, 'serverBackup')) return;
    ensureSchedule(guild, cfg);
  }
};

export const _serverBackupInternals = {
  normalizeBackupConfig,
  serializeRole,
  serializeChannel,
  serializePermissionOverwrites,
  missingByIdOrName,
  safeBackupId
};
