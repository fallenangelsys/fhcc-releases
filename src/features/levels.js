import path from 'node:path';
import process from 'node:process';
import { EmbedBuilder } from 'discord.js';

import { atomicWriteJson, readJsonWithRecovery } from '../runtime/atomicJsonStore.js';
import { applyManagedRolePolicy } from '../runtime/managedRoleService.js';

const LEVEL_FILE = path.join(process.env.FALLEN_HEAVEN_DATA_DIR || path.join(process.cwd(), 'data'), 'leveling-progress.json');
let store = null;
let loadPromise = null;
let saveTimer = null;
let saveQueue = Promise.resolve();

const emptyStore = () => ({ version: 2, guilds: {} });
const normalizeProfile = (value = {}) => ({
  xp: Math.max(0, Math.floor(Number(value.xp || 0))),
  level: Math.max(0, Math.floor(Number(value.level || 0))),
  lastAt: Math.max(0, Number(value.lastAt || 0)),
  dailyKey: String(value.dailyKey || ''),
  dailyXp: Math.max(0, Math.floor(Number(value.dailyXp || 0))),
  lastFingerprint: String(value.lastFingerprint || ''),
  lastFingerprintAt: Math.max(0, Number(value.lastFingerprintAt || 0)),
  updatedAt: value.updatedAt || null
});
const normalizeStore = (value) => {
  if (value?.version === 2 && value.guilds) {
    const normalized = emptyStore();
    for (const [guildId, users] of Object.entries(value.guilds || {})) {
      normalized.guilds[guildId] = {};
      for (const [userId, profile] of Object.entries(users || {})) normalized.guilds[guildId][userId] = normalizeProfile(profile);
    }
    return normalized;
  }
  const migrated = emptyStore();
  for (const [guildId, users] of Object.entries(value || {})) {
    if (guildId === 'version' || guildId === 'guilds' || !users || typeof users !== 'object') continue;
    migrated.guilds[guildId] = {};
    for (const [userId, profile] of Object.entries(users)) migrated.guilds[guildId][userId] = normalizeProfile(profile);
  }
  return migrated;
};
const ensureLoaded = async () => {
  if (store) return store;
  if (!loadPromise) loadPromise = readJsonWithRecovery(LEVEL_FILE, { fallback: emptyStore(), backupLimit: 5 })
    .then((result) => { store = normalizeStore(result.value); return store; })
    .finally(() => { loadPromise = null; });
  return loadPromise;
};

export const getLevelProfileSnapshot = async (guildId, userId) => {
  const data = await ensureLoaded();
  const profile = normalizeProfile(data.guilds?.[String(guildId || '')]?.[String(userId || '')] || {});
  return { ...profile, userId: String(userId || ''), guildId: String(guildId || '') };
};
const flush = async () => {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!store) return;
  const snapshot = JSON.parse(JSON.stringify(store));
  saveQueue = saveQueue.catch(() => null).then(() => atomicWriteJson(LEVEL_FILE, snapshot, { backupLimit: 5 }));
  await saveQueue;
};
const scheduleSave = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flush().catch((error) => console.warn(`[levels] Fortschritt konnte nicht gespeichert werden: ${error?.message || error}`)), 2500);
  saveTimer.unref?.();
};

const randomBetween = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const levelFromXp = (xp) => Math.floor(0.1 * Math.sqrt(Math.max(0, Number(xp))));
const dateKey = (timezone = 'Europe/Berlin') => {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  catch { return new Date().toISOString().slice(0, 10); }
};
const fingerprint = (content) => String(content || '').toLocaleLowerCase('de-DE').replace(/<@!?\d+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 180);
const parseMappings = (values) => (Array.isArray(values) ? values : [])
  .map((entry) => {
    if (entry && typeof entry === 'object') return { level: Number(entry.level || entry.count), roleId: String(entry.roleId || '') };
    const match = /^(\d+)\s*[=:|]\s*(\d+)$/.exec(String(entry || '').trim());
    return match ? { level: Number(match[1]), roleId: match[2] } : null;
  })
  .filter((entry) => entry && Number.isInteger(entry.level) && entry.level > 0 && entry.roleId)
  .sort((a, b) => a.level - b.level);

const findEmbedTemplate = (cfg, id) => (Array.isArray(cfg?.embeds?.templates) ? cfg.embeds.templates : [])
  .find((template) => template.id === id && template.enabled !== false) || null;

const resolveLevelAvatar = (user, options = { size: 256 }) => {
  if (!user?.id) return '';
  const resolved = user.displayAvatarURL?.(options);
  if (resolved) return String(resolved);
  if (user?.avatar) {
    const member = user.member || null;
    if (member?.avatar && member?.guild?.id) {
      const extension = String(member.avatar.startsWith('a_') ? 'gif' : (options.extension || 'png')).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png';
      const size = Number(options.size || 128);
      const normalizedSize = Number.isFinite(size) && size > 0 ? Math.min(4096, Math.max(16, Math.round(size))) : 128;
      return `https://cdn.discordapp.com/guilds/${String(member.guild.id)}/users/${String(user.id)}/avatars/${String(member.avatar)}.${extension}?size=${normalizedSize}`;
    }
    const extension = String(user.avatar.startsWith('a_') ? 'gif' : (options.extension || 'png')).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png';
    const size = Number(options.size || 128);
    const normalizedSize = Number.isFinite(size) && size > 0 ? Math.min(4096, Math.max(16, Math.round(size))) : 128;
    return `https://cdn.discordapp.com/avatars/${String(user.id)}/${String(user.avatar)}.${extension}?size=${normalizedSize}`;
  }
  return user.defaultAvatarURL || '';
};

const formatTemplate = (value, { guild, user, level }) => String(value || '')
  .replaceAll('{user}', user?.toString?.() || '').replaceAll('{username}', user?.username || '')
  .replaceAll('{userAvatar}', resolveLevelAvatar(user, { size: 256 }) || '').replaceAll('{guild}', guild?.name || 'Server')
  .replaceAll('{level}', String(level || 0)).replaceAll('{memberCount}', String(guild?.memberCount || 0));
const parseColor = (value) => {
  const parsed = Number.parseInt(String(value || '#27c4e8').replace('#', ''), 16);
  return Number.isFinite(parsed) ? parsed : 0x27c4e8;
};
const buildEmbedMessage = (template, context) => {
  const data = template?.embed || {};
  const embed = new EmbedBuilder().setColor(parseColor(data.color));
  const title = formatTemplate(data.title, context).slice(0, 256);
  const description = formatTemplate(data.description, context).slice(0, 4096);
  if (title) embed.setTitle(title);
  if (description) embed.setDescription(description);
  if (data.thumbnailUrl && /^https?:\/\//i.test(formatTemplate(data.thumbnailUrl, context))) embed.setThumbnail(formatTemplate(data.thumbnailUrl, context));
  if (data.imageUrl && /^https?:\/\//i.test(formatTemplate(data.imageUrl, context))) embed.setImage(formatTemplate(data.imageUrl, context));
  const footer = formatTemplate(data.footerText, context).slice(0, 2048);
  if (footer) embed.setFooter({ text: footer });
  if (data.timestamp) embed.setTimestamp();
  const fields = (Array.isArray(data.fields) ? data.fields : []).slice(0, 25).map((field) => ({
    name: formatTemplate(field?.name, context).slice(0, 256) || '\u200b',
    value: formatTemplate(field?.value, context).slice(0, 1024) || '\u200b',
    inline: Boolean(field?.inline)
  }));
  if (fields.length) embed.addFields(fields);
  return { content: formatTemplate(template?.content, context).slice(0, 2000), embeds: [embed], allowedMentions: { users: [context.user.id], roles: [] } };
};

const synchronizeLevelRoles = async (member, conf, level) => {
  const mappings = parseMappings(conf.levelRoleMappings);
  if (!mappings.length || !member) return;
  const eligible = mappings.filter((entry) => entry.level <= level);
  const wanted = conf.cumulativeRoleRewards === true ? eligible.map((entry) => entry.roleId) : eligible.slice(-1).map((entry) => entry.roleId);
  const managed = mappings.map((entry) => entry.roleId);
  const remove = managed.filter((roleId) => member.roles.cache.has(roleId) && !wanted.includes(roleId));
  await applyManagedRolePolicy({ member, addRoleIds: wanted, removeRoleIds: remove, reason: `Level-Rollenabgleich · Level ${level}`, verify: true, requireAll: false });
};

const shouldAward = (message, cfg, profile, now) => {
  const conf = cfg?.levels || {};
  if (!conf.enabled || !message?.guild || message.author?.bot || !message.member) return { ok: false, reason: 'disabled' };
  const ignoredChannels = new Set((conf.ignoredChannelIds || []).map(String));
  if (ignoredChannels.has(String(message.channelId)) || ignoredChannels.has(String(message.channel?.parentId || ''))) return { ok: false, reason: 'channel' };
  const excludedRoles = new Set((conf.excludedRoleIds || []).map(String));
  if (message.member.roles.cache.some((role) => excludedRoles.has(String(role.id)))) return { ok: false, reason: 'role' };
  const contentFingerprint = fingerprint(message.content);
  const meaningfulLength = contentFingerprint.replace(/[^\p{L}\p{N}]/gu, '').length;
  if (meaningfulLength < Math.max(1, Number(conf.minMessageLength || 3))) return { ok: false, reason: 'short' };
  if (now - profile.lastAt < Math.max(5, Number(conf.cooldownSeconds || 60)) * 1000) return { ok: false, reason: 'cooldown' };
  if (contentFingerprint && contentFingerprint === profile.lastFingerprint && now - profile.lastFingerprintAt < 10 * 60_000) return { ok: false, reason: 'duplicate' };
  return { ok: true, fingerprint: contentFingerprint };
};

export const feature = {
  id: 'levels',
  name: 'Leveling',
  commands: [],
  async onClientReady() { await ensureLoaded(); },
  async onMessageCreate({ message, cfg }) {
    const data = await ensureLoaded();
    const guildId = message?.guildId;
    const userId = message?.author?.id;
    if (!guildId || !userId) return;
    data.guilds[guildId] ||= {};
    const profile = data.guilds[guildId][userId] ||= normalizeProfile();
    const now = Date.now();
    const decision = shouldAward(message, cfg, profile, now);
    if (!decision.ok) return;
    const conf = cfg.levels || {};
    const today = dateKey(cfg.general?.timezone);
    if (profile.dailyKey !== today) { profile.dailyKey = today; profile.dailyXp = 0; }
    const dailyLimit = Math.max(50, Math.floor(Number(conf.maxXpPerDay || 500)));
    if (profile.dailyXp >= dailyLimit) return;
    const min = Math.max(1, Math.floor(Number(conf.xpPerMessageMin || 6)));
    const max = Math.max(min, Math.floor(Number(conf.xpPerMessageMax || 16)));
    const xp = Math.min(randomBetween(min, max), dailyLimit - profile.dailyXp);
    profile.lastAt = now;
    profile.lastFingerprint = decision.fingerprint;
    profile.lastFingerprintAt = now;
    profile.dailyXp += xp;
    profile.xp += xp;
    profile.updatedAt = new Date(now).toISOString();
    const nextLevel = levelFromXp(profile.xp);
    const leveledUp = nextLevel > profile.level;
    if (leveledUp) profile.level = nextLevel;
    scheduleSave();
    if (!leveledUp) return;
    await synchronizeLevelRoles(message.member, conf, nextLevel).catch((error) => console.warn(`[levels] Rollenabgleich für ${message.author.tag} fehlgeschlagen: ${error?.message || error}`));
    if (!conf.announce) return;
    const channel = conf.announceChannelId ? message.guild.channels.cache.get(conf.announceChannelId) : message.channel;
    if (!channel?.isTextBased?.()) return;
    const template = findEmbedTemplate(cfg, 'level-up');
    if (template) await channel.send(buildEmbedMessage(template, { guild: message.guild, user: message.author, level: nextLevel })).catch(() => null);
    else {
      const announcement = formatTemplate(conf.levelUpMessage || '{user} erreicht Level {level}!', { guild: message.guild, user: message.author, level: nextLevel });
      await channel.send({ content: announcement, allowedMentions: { users: [message.author.id], roles: [] } }).catch(() => null);
    }
  },
  async onConfigUpdate() { await flush(); }
};

export const _levelInternals = { normalizeStore, normalizeProfile, levelFromXp, fingerprint, parseMappings, shouldAward };
