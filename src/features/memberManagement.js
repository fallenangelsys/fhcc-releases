import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteJson, readJsonWithRecovery } from '../runtime/atomicJsonStore.js';
import { quietLog, QUIET_LOG_SCOPE } from '../runtime/quietLog.js';
import {
  deleteServerIndexMessages,
  getServerEmbedKnowledgeResult,
  getServerIndexChannelScopes,
  getServerKnowledgeResult,
  migrateLegacyServerIndex,
  persistServerIndexMessages
} from '../serverIndexStore.js';
import { getPersistentMemberIntelligence, getPersistentMemberIntelligenceStatus } from './memberIntelligenceEngine.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';

const DATA_ROOT = process.env.FALLEN_HEAVEN_DATA_DIR
  || (process.platform === 'win32' && process.env.APPDATA
    ? path.join(process.env.APPDATA, 'FALLEN HEAVEN Control Center', 'runtime', 'data')
    : path.join(process.cwd(), 'data'));
const DB_FILE = path.join(DATA_ROOT, 'member-management.json');
const SERVER_INDEX_DIR = path.join(DATA_ROOT, 'server-index');
const panelSessions = new Map();
const historyScanRunners = new Map();
const historyScanRetryTimers = new Map();
const historyScanRefreshTimers = new Map();
const indexedKnowledgeCache = new Map();
const memberIntelligenceCache = new Map();
let dbLoaded = false;
const DISCORD_SYSTEM_EVENT_NAMES = new Map([
  [7, 'member_joined'],
  [8, 'boost_started'],
  [9, 'boost_tier_1_reached'],
  [10, 'boost_tier_2_reached'],
  [11, 'boost_tier_3_reached'],
  [12, 'channel_follow_added'],
  [18, 'thread_created']
]);
let saveTimer = null;
let db = {
  profiles: {},
  activity: {},
  daily: {},
  voiceSessions: {},
  openVoice: {},
  warnings: {},
  notes: {},
  logs: {}
};

const SORTS = ['lastActive', 'messages', 'voice', 'joinedAt', 'roles', 'warnings', 'notes', 'accountAge', 'username'];
const FILTERS = ['all', 'warnings', 'notes', 'noRoles', 'humans', 'bots', 'inactive7', 'new7', 'chatHeavy', 'voiceHeavy'];
const PAGE_SIZE_MIN = 10;
const PAGE_SIZE_MAX = 15;

const clamp = (value, min, max, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

const nowIso = () => new Date().toISOString();
const todayKey = (date = new Date()) => date.toISOString().slice(0, 10);
const randomId = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const mention = (userId) => `<@${userId}>`;
const roleMention = (roleId) => `<@&${roleId}>`;

const serializeIndexedMessage = (message) => ({
  id: message.id,
  type: Number(message.type || 0),
  system: Boolean(message.system),
  systemEvent: DISCORD_SYSTEM_EVENT_NAMES.get(Number(message.type || 0)) || null,
  guildId: message.guildId,
  channelId: message.channelId,
  channelName: message.channel?.name || '',
  parentChannelId: message.channel?.parentId || null,
  thread: Boolean(message.channel?.isThread?.()),
  authorId: message.author?.id || '',
  authorBot: Boolean(message.author?.bot),
  webhookId: String(message.webhookId || ''),
  applicationId: String(message.applicationId || ''),
  interactionId: String(message.interaction?.id || ''),
  createdAt: new Date(message.createdTimestamp || Date.now()).toISOString(),
  editedAt: message.editedAt?.toISOString?.() || null,
  content: message.content || '',
  attachments: message.attachments?.map?.((item) => ({
    id: item.id,
    name: item.name || 'Datei',
    url: item.url,
    contentType: item.contentType || '',
    size: item.size || 0
  })) || [],
  embeds: message.embeds?.map?.((item) => ({
    title: item.title || '',
    description: item.description || '',
    url: item.url || '',
    type: item.type || '',
    color: item.hexColor || '',
    image: item.image?.url || '',
    thumbnail: item.thumbnail?.url || '',
    video: item.video?.url || '',
    author: item.author ? {
      name: item.author.name || '',
      url: item.author.url || '',
      iconURL: item.author.iconURL || ''
    } : null,
    footer: item.footer ? {
      text: item.footer.text || '',
      iconURL: item.footer.iconURL || ''
    } : null,
    provider: item.provider ? {
      name: item.provider.name || '',
      url: item.provider.url || ''
    } : null,
    timestamp: item.timestamp?.toISOString?.() || item.timestamp || null,
    fields: item.fields?.map?.((field) => ({
      name: field.name || '',
      value: field.value || '',
      inline: Boolean(field.inline)
    })) || []
  })) || []
});

const persistIndexedMessages = persistServerIndexMessages;

const resolveIndexedKnowledgeChannels = ({ guild, requester, channelId = '', excludedChannelIds = [] } = {}) => {
  const excluded = new Set((excludedChannelIds || []).map(String).filter(Boolean));
  return guild.channels.cache
    .filter((channel) => {
      if (!channel?.isTextBased?.()) return false;
      if (excluded.has(String(channel.id))) return false;
      if (!requester) return channel.id === String(channelId || '');
      const permissions = channel.permissionsFor?.(requester);
      return Boolean(
        permissions?.has(PermissionFlagsBits.ViewChannel)
        && permissions.has(PermissionFlagsBits.ReadMessageHistory)
      );
    })
    .map((channel) => String(channel.id));
};

const resolveAllIndexedKnowledgeChannels = async (options = {}) => {
  const allowed = new Set(resolveIndexedKnowledgeChannels(options));
  const excluded = new Set((options.excludedChannelIds || []).map(String).filter(Boolean));
  if (!options.guild?.id || !options.requester) return [...allowed];
  const scopes = await getServerIndexChannelScopes(options.guild.id).catch(() => []);
  for (const scope of scopes) {
    if (allowed.has(scope.channelId) || excluded.has(scope.channelId)) continue;
    // Nicht mehr gecachte öffentliche/Ankündigungs-Threads erben ihre
    // Lesbarkeit vom sichtbaren Elternkanal. Private Threads werden ohne einen
    // aktuellen Discord-Berechtigungsbeleg niemals pauschal freigegeben.
    if (![ChannelType.AnnouncementThread, ChannelType.PublicThread].includes(Number(scope.channelType))) continue;
    const parent = options.guild.channels.cache.get(String(scope.parentChannelId || ''));
    const permissions = parent?.permissionsFor?.(options.requester);
    if (permissions?.has(PermissionFlagsBits.ViewChannel) && permissions.has(PermissionFlagsBits.ReadMessageHistory)) {
      allowed.add(scope.channelId);
    }
  }
  return [...allowed];
};

export const getIndexedServerKnowledgeResult = async ({
  guild,
  requester,
  channelId = '',
  query = '',
  authorId = '',
  excludedChannelIds = [],
  excludeMessageIds = [],
  maxEntries = 40,
  retentionDays = 30,
  fullHistory = false
} = {}) => {
  const guildId = String(guild?.id || '');
  if (!/^\d{15,25}$/.test(guildId)) return {
    context: '', evidence: [], completeness: 'unavailable', truncated: false, observedAt: null, revision: null
  };
  const allowedChannelIds = await resolveAllIndexedKnowledgeChannels({ guild, requester, channelId, excludedChannelIds });
  return getServerKnowledgeResult({
    guildId,
    query,
    authorId: String(authorId || '').trim(),
    channelId,
    allowedChannelIds,
    maxEntries,
    retentionDays,
    fullHistory,
    excludeMessageIds
  });
};

export const getIndexedServerEmbedKnowledgeResult = async ({
  guild,
  requester,
  channelId = '',
  query = '',
  excludedChannelIds = [],
  excludeMessageIds = [],
  maxEntries = 60
} = {}) => {
  const guildId = String(guild?.id || '');
  if (!/^\d{15,25}$/.test(guildId)) return {
    context: '', evidence: [], completeness: 'unavailable', truncated: false, observedAt: null, revision: null
  };
  const allowedChannelIds = await resolveAllIndexedKnowledgeChannels({ guild, requester, channelId, excludedChannelIds });
  return getServerEmbedKnowledgeResult({
    guildId,
    query,
    channelId,
    allowedChannelIds,
    excludeMessageIds,
    maxEntries,
    contextCharacterBudget: 15_000
  });
};

export const getIndexedServerKnowledge = async (options = {}) => {
  const guildId = String(options.guild?.id || '');
  const excluded = (options.excludedChannelIds || []).map(String).sort().join(',');
  const excludedMessages = (options.excludeMessageIds || []).map(String).sort().join(',');
  const cacheKey = `${guildId}:${options.requester?.id || ''}:${options.channelId || ''}:${options.authorId || ''}:${excluded}:${excludedMessages}:${options.fullHistory ? 'full' : options.retentionDays}:${String(options.query || '').toLocaleLowerCase('de-DE')}`;
  const cached = indexedKnowledgeCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 30_000) return cached.value;
  const result = await getIndexedServerKnowledgeResult(options);
  const value = String(result.context || '');
  indexedKnowledgeCache.set(cacheKey, { at: Date.now(), value });
  if (indexedKnowledgeCache.size > 300) indexedKnowledgeCache.delete(indexedKnowledgeCache.keys().next().value);
  return value;
};

export const getIndexedMemberIntelligence = async (options = {}) => getPersistentMemberIntelligence(options);
export const getIndexedMemberIntelligenceStatus = async (options = {}) => getPersistentMemberIntelligenceStatus(options);

const loadDb = async () => {
  if (dbLoaded) {
    return;
  }

  // Recovery-Pfad: liest bei einer beschädigten Hauptdatei automatisch die
  // neueste Backup-Kopie – zusammen mit dem atomaren Schreiben ist die DB
  // damit gegen Abstürze während des Speicherns abgesichert.
  const loaded = await readJsonWithRecovery(DB_FILE, { fallback: {}, backupLimit: 2 });
  db = { ...db, ...(loaded.value || {}) };
  dbLoaded = true;
};

const saveNow = async () => {
  // Atomar + gedrosselte Backup-Rotation über den gemeinsamen JSON-Store:
  // kein Risiko halbgeschriebener Dateien bei Absturz, und die teuren
  // Backup-Kopien laufen nur noch einmal pro Minute statt bei jedem Save.
  await atomicWriteJson(DB_FILE, db, { backupLimit: 2, spacing: 2 });
};

const scheduleSave = () => {
  if (saveTimer) {
    return;
  }

  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveNow().catch((error) => console.error('[memberManagement] Speichern fehlgeschlagen', error));
  }, 1200);
};

const guildStore = (key, guildId) => {
  db[key] ||= {};
  db[key][guildId] ||= {};
  return db[key][guildId];
};

const getCfg = (cfg = {}) => ({
  enabled: cfg.memberManagement?.enabled !== false,
  pageSize: clamp(cfg.memberManagement?.pageSize, PAGE_SIZE_MIN, PAGE_SIZE_MAX, 10),
  hideBots: Boolean(cfg.memberManagement?.hideBots),
  adminRoleIds: Array.isArray(cfg.memberManagement?.adminRoleIds) ? cfg.memberManagement.adminRoleIds : [],
  moderatorRoleIds: Array.isArray(cfg.memberManagement?.moderatorRoleIds)
    ? cfg.memberManagement.moderatorRoleIds
    : Array.isArray(cfg.general?.staffRoleIds)
      ? cfg.general.staffRoleIds
      : [],
  activityBackfillEnabled: cfg.memberManagement?.activityBackfillEnabled !== false,
  activityBackfillDays: clamp(cfg.memberManagement?.activityBackfillDays, 1, 3650, 365),
  logChannelId: String(cfg.memberManagement?.logChannelId || cfg.logging?.channelId || cfg.general?.commandLogChannelId || '').trim()
});

const truncate = (value, max = 100) => {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

const formatDate = (value) => {
  if (!value) {
    return 'unbekannt';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'unbekannt';
  }

  return `<t:${Math.floor(date.getTime() / 1000)}:f>`;
};

const formatRelative = (value) => {
  if (!value) {
    return 'keine Aktivität';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'keine Aktivität';
  }

  return `<t:${Math.floor(date.getTime() / 1000)}:R>`;
};

const formatDuration = (secondsValue) => {
  let seconds = Math.max(0, Math.floor(Number(secondsValue || 0)));
  const days = Math.floor(seconds / 86400);
  seconds %= 86400;
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);

  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m`;
  return `${Math.max(0, seconds)}s`;
};

const daysAgo = (days) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
};

const getDateKeys = (days) => {
  const keys = [];
  for (let i = 0; i < days; i += 1) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    keys.push(todayKey(date));
  }
  return keys;
};

const sumDaily = (guildId, userId, days, field) => {
  const daily = guildStore('daily', guildId)[userId] || {};
  return getDateKeys(days).reduce((sum, date) => sum + Number(daily[date]?.[field] || 0), 0);
};

const getActivity = (guildId, userId) => {
  const activity = guildStore('activity', guildId);
  activity[userId] ||= {
    guildId,
    userId,
    totalMessages: 0,
    totalVoiceSeconds: 0,
    lastMessageAt: null,
    lastVoiceAt: null,
    updatedAt: nowIso()
  };
  return activity[userId];
};

const getWarnings = (guildId, userId) =>
  Object.values(guildStore('warnings', guildId)).filter((warning) => warning.userId === userId && !warning.removedAt);

const getAllWarnings = (guildId, userId) =>
  Object.values(guildStore('warnings', guildId)).filter((warning) => warning.userId === userId);

const getNotes = (guildId, userId) =>
  Object.values(guildStore('notes', guildId)).filter((note) => note.userId === userId && !note.deletedAt);

const resolveMemberManagementAvatar = (member, options = { size: 256 }) => {
  const user = member?.user || null;
  if (!user?.id) return '';
  const resolved = user.displayAvatarURL?.(options);
  if (resolved) return String(resolved);
  const guildAvatar = String(member?.avatar || '').trim();
  if (guildAvatar && member?.guild?.id) {
    const extension = String(guildAvatar.startsWith('a_') ? 'gif' : (options.extension || 'png')).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png';
    const size = Number(options.size || 128);
    const normalizedSize = Number.isFinite(size) && size > 0 ? Math.min(4096, Math.max(16, Math.round(size))) : 128;
    return `https://cdn.discordapp.com/guilds/${String(member.guild.id)}/users/${String(user.id)}/avatars/${guildAvatar}.${extension}?size=${normalizedSize}`;
  }
  if (user.avatar) {
    const extension = String(user.avatar.startsWith('a_') ? 'gif' : (options.extension || 'png')).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png';
    const size = Number(options.size || 128);
    const normalizedSize = Number.isFinite(size) && size > 0 ? Math.min(4096, Math.max(16, Math.round(size))) : 128;
    return `https://cdn.discordapp.com/avatars/${String(user.id)}/${String(user.avatar)}.${extension}?size=${normalizedSize}`;
  }
  return user.defaultAvatarURL || '';
};

const profileFromMember = (member) => {
  const roles = member.roles.cache
    .filter((role) => role.id !== member.guild.id)
    .sort((a, b) => b.position - a.position)
    .map((role) => role.id);

  return {
    guildId: member.guild.id,
    userId: member.id,
    username: member.user.username,
    displayName: member.user.displayName || member.user.username,
    nickname: member.nickname || '',
    avatarUrl: resolveMemberManagementAvatar(member, { size: 256 }),
    isBot: Boolean(member.user.bot),
    joinedAt: member.joinedAt?.toISOString?.() || null,
    accountCreatedAt: member.user.createdAt?.toISOString?.() || null,
    highestRoleId: member.roles.highest?.id || '',
    roleIdsJson: JSON.stringify(roles),
    leftAt: null,
    lastSyncedAt: nowIso(),
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
};

const upsertMember = async (member) => {
  if (!member?.guild || !member?.user) {
    return null;
  }

  await loadDb();
  const profiles = guildStore('profiles', member.guild.id);
  const current = profiles[member.id] || {};
  profiles[member.id] = {
    ...current,
    ...profileFromMember(member),
    createdAt: current.createdAt || nowIso()
  };
  scheduleSave();
  return profiles[member.id];
};

const markLeft = async (member) => {
  await loadDb();
  const profiles = guildStore('profiles', member.guild.id);
  profiles[member.id] ||= {
    guildId: member.guild.id,
    userId: member.id,
    username: member.user?.username || 'unbekannt',
    displayName: member.user?.displayName || member.user?.username || 'unbekannt',
    createdAt: nowIso()
  };
  profiles[member.id].leftAt = nowIso();
  profiles[member.id].updatedAt = nowIso();
  scheduleSave();
};

const refreshMember = async (guild, userId) => {
  const member = await guild.members.fetch(userId).catch((error) => {
    quietLog(QUIET_LOG_SCOPE.memberManagement, error, `members.fetch fehlgeschlagen: ${userId}`);
    return null;
  });
  if (!member) {
    return null;
  }
  return upsertMember(member);
};

const getLastActive = (guildId, userId) => {
  const activity = getActivity(guildId, userId);
  const lastMessage = activity.lastMessageAt ? new Date(activity.lastMessageAt).getTime() : 0;
  const lastVoice = activity.lastVoiceAt ? new Date(activity.lastVoiceAt).getTime() : 0;
  return Math.max(lastMessage, lastVoice);
};

const getProfiles = (guildId, options = {}) => {
  const profiles = Object.values(guildStore('profiles', guildId));
  return options.hideBots ? profiles.filter((profile) => !profile.isBot) : profiles;
};

const applySearch = (profiles, query) => {
  const text = String(query || '').trim().toLowerCase();
  if (!text) {
    return profiles;
  }

  return profiles.filter((profile) => {
    const haystack = [
      profile.userId,
      profile.username,
      profile.displayName,
      profile.nickname
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(text);
  });
};

const applyFilter = (profiles, guildId, filter) => {
  const now = Date.now();
  const sevenDaysAgo = daysAgo(7).getTime();

  return profiles.filter((profile) => {
    const activity = getActivity(guildId, profile.userId);
    const roles = JSON.parse(profile.roleIdsJson || '[]');
    const lastActive = getLastActive(guildId, profile.userId);
    const joined = profile.joinedAt ? new Date(profile.joinedAt).getTime() : 0;

    if (filter === 'warnings') return getWarnings(guildId, profile.userId).length > 0;
    if (filter === 'notes') return getNotes(guildId, profile.userId).length > 0;
    if (filter === 'noRoles') return roles.length === 0;
    if (filter === 'humans') return !profile.isBot;
    if (filter === 'bots') return profile.isBot;
    if (filter === 'inactive7') return !lastActive || lastActive < sevenDaysAgo;
    if (filter === 'new7') return joined && now - joined <= 7 * 86400 * 1000;
    if (filter === 'chatHeavy') return sumDaily(guildId, profile.userId, 30, 'messageCount') >= 100;
    if (filter === 'voiceHeavy') return sumDaily(guildId, profile.userId, 30, 'voiceSeconds') >= 3600;
    return true;
  });
};

const sortProfiles = (profiles, guildId, sort) => {
  const sorted = [...profiles];
  sorted.sort((a, b) => {
    if (sort === 'username') return String(a.username || '').localeCompare(String(b.username || ''));
    if (sort === 'joinedAt') return new Date(b.joinedAt || 0).getTime() - new Date(a.joinedAt || 0).getTime();
    if (sort === 'roles') return JSON.parse(b.roleIdsJson || '[]').length - JSON.parse(a.roleIdsJson || '[]').length;
    if (sort === 'warnings') return getWarnings(guildId, b.userId).length - getWarnings(guildId, a.userId).length;
    if (sort === 'notes') return getNotes(guildId, b.userId).length - getNotes(guildId, a.userId).length;
    if (sort === 'accountAge') return new Date(a.accountCreatedAt || 0).getTime() - new Date(b.accountCreatedAt || 0).getTime();
    if (sort === 'messages') return getActivity(guildId, b.userId).totalMessages - getActivity(guildId, a.userId).totalMessages;
    if (sort === 'voice') return getActivity(guildId, b.userId).totalVoiceSeconds - getActivity(guildId, a.userId).totalVoiceSeconds;
    return getLastActive(guildId, b.userId) - getLastActive(guildId, a.userId);
  });
  return sorted;
};

const createSession = (interaction, initial = {}) => {
  const token = randomId('panel').slice(0, 18);
  panelSessions.set(token, {
    guildId: interaction.guildId,
    ownerId: interaction.user.id,
    page: 0,
    sort: 'lastActive',
    filter: 'all',
    query: '',
    selectedUserId: null,
    ...initial,
    createdAt: Date.now()
  });
  return token;
};

const getSession = async (interaction, token) => {
  const session = panelSessions.get(token);
  if (!session || session.guildId !== interaction.guildId) {
    await interaction.reply({ content: 'Dieses Member-Panel ist abgelaufen. Bitte neu öffnen.', ephemeral: true }).catch(() => {});
    return null;
  }

  if (session.ownerId !== interaction.user.id) {
    await interaction.reply({ content: 'Dieses Admin-Panel gehört nicht dir.', ephemeral: true }).catch(() => {});
    return null;
  }

  return session;
};

const isAllowed = (member, guild, cfg, mode = 'view') => {
  if (!member || !guild) {
    return false;
  }

  if (guild.ownerId === member.id) {
    return true;
  }

  if (member.permissions.has(PermissionFlagsBits.Administrator)) {
    return true;
  }

  const conf = getCfg(cfg);
  const allowedRoles = mode === 'view'
    ? [...conf.adminRoleIds, ...conf.moderatorRoleIds]
    : mode === 'admin'
      ? conf.adminRoleIds
      : [...conf.adminRoleIds, ...conf.moderatorRoleIds];

  return allowedRoles.some((roleId) => member.roles.cache.has(roleId));
};

const ensureCommandAllowed = async (interaction, cfg, mode = 'view') => {
  if (isAllowed(interaction.member, interaction.guild, cfg, mode)) {
    return true;
  }

  await interaction.reply({ content: 'Du hast keine Berechtigung für dieses Member-Admin-Panel.', ephemeral: true }).catch(() => {});
  await addLog(interaction.guild, cfg, {
    actionType: 'Permission denied',
    targetUserId: interaction.user.id,
    moderatorId: interaction.user.id,
    reason: `Command ${interaction.commandName || 'interaction'}`
  });
  return false;
};

const canModerateTarget = async (interaction, targetMember, action) => {
  const actor = interaction.member;
  const botMember = interaction.guild.members.me || (await interaction.guild.members.fetchMe().catch((error) => {
    quietLog(QUIET_LOG_SCOPE.memberManagement, error, `fetchMe fehlgeschlagen`);
    return null;
  }));

  const permissionMap = {
    kick: PermissionFlagsBits.KickMembers,
    ban: PermissionFlagsBits.BanMembers,
    timeout: PermissionFlagsBits.ModerateMembers,
    timeoutRemove: PermissionFlagsBits.ModerateMembers
  };

  const permission = permissionMap[action];
  if (permission && !actor.permissions.has(permission)) {
    return 'Dir fehlt die benötigte Discord-Permission.';
  }

  if (permission && !botMember?.permissions?.has(permission)) {
    return 'Dem Bot fehlt die benötigte Discord-Permission.';
  }

  if (targetMember.id === interaction.guild.ownerId) {
    return 'Der Server-Owner kann nicht moderiert werden.';
  }

  if (interaction.guild.ownerId !== actor.id && targetMember.roles.highest.position >= actor.roles.highest.position) {
    return 'Du kannst keinen Member moderieren, der gleich oder höher steht als du.';
  }

  if (botMember && targetMember.roles.highest.position >= botMember.roles.highest.position) {
    return 'Der Bot kann diesen Member wegen der Rollen-Hierarchie nicht moderieren.';
  }

  return null;
};

const addLog = async (guild, cfg, entry) => {
  if (!guild) {
    return;
  }

  await loadDb();
  const logs = guildStore('logs', guild.id);
  const id = randomId('log');
  logs[id] = {
    id,
    guildId: guild.id,
    targetUserId: entry.targetUserId || '',
    moderatorId: entry.moderatorId || '',
    actionType: entry.actionType || 'Unknown',
    reason: entry.reason || '',
    metadataJson: JSON.stringify(entry.metadata || {}),
    createdAt: nowIso()
  };
  scheduleSave();

  const logChannelId = getCfg(cfg).logChannelId;
  if (!logChannelId) {
    return;
  }

  const channel = guild.channels.cache.get(logChannelId) || (await guild.channels.fetch(logChannelId).catch((error) => {
    quietLog(QUIET_LOG_SCOPE.memberManagement, error, `channels.fetch (Log) fehlgeschlagen: ${logChannelId}`);
    return null;
  }));
  if (!channel?.isTextBased?.()) {
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(`Member-Log: ${entry.actionType}`)
    .setColor(0x27c4e8)
    .setDescription([
      entry.targetUserId ? `Ziel: ${mention(entry.targetUserId)}` : null,
      entry.moderatorId ? `Moderator: ${mention(entry.moderatorId)}` : null,
      entry.reason ? `Grund: ${entry.reason}` : null
    ].filter(Boolean).join('\n') || 'Aktion gespeichert.')
    .setTimestamp(new Date());

  await channel.send({ embeds: [embed], allowedMentions: { users: [entry.targetUserId, entry.moderatorId].filter(Boolean) } }).catch(() => {});
};

const getListData = (session, cfg) => {
  const conf = getCfg(cfg);
  const profiles = sortProfiles(
    applyFilter(applySearch(getProfiles(session.guildId, { hideBots: conf.hideBots }), session.query), session.guildId, session.filter),
    session.guildId,
    session.sort
  );
  const pageSize = conf.pageSize;
  const pageCount = Math.max(1, Math.ceil(profiles.length / pageSize));
  session.page = Math.min(Math.max(0, session.page), pageCount - 1);
  const pageProfiles = profiles.slice(session.page * pageSize, session.page * pageSize + pageSize);
  return { profiles, pageProfiles, pageSize, pageCount };
};

const buildListPanel = (interaction, cfg, token) => {
  const session = panelSessions.get(token);
  const { profiles, pageProfiles, pageCount } = getListData(session, cfg);

  const embed = new EmbedBuilder()
    .setTitle('Server Member Übersicht')
    .setColor(0x27c4e8)
    .setDescription([
      `Sortierung: **${session.sort}**`,
      `Filter: **${session.filter}**`,
      session.query ? `Suche: **${session.query}**` : null,
      `Seite **${session.page + 1}/${pageCount}** · Treffer: **${profiles.length}**`
    ].filter(Boolean).join('\n'))
    .setFooter({ text: 'Alle Member-Daten kommen aus Cache/Datenbank. Nutze Refresh für Discord-Abgleich.' })
    .setTimestamp(new Date());

  if (!pageProfiles.length) {
    embed.addFields({ name: 'Keine Member gefunden', value: 'Passe Suche oder Filter an.' });
  } else {
    pageProfiles.forEach((profile, index) => {
      const activity = getActivity(session.guildId, profile.userId);
      const warnings = getWarnings(session.guildId, profile.userId).length;
      const notes = getNotes(session.guildId, profile.userId).length;
      embed.addFields({
        name: `${session.page * getCfg(cfg).pageSize + index + 1}. ${mention(profile.userId)}${profile.isBot ? ' · Bot' : ''}`,
        value: [
          `Chat: **${activity.totalMessages || 0}** · 7d: **${sumDaily(session.guildId, profile.userId, 7, 'messageCount')}**`,
          `Voice: **${formatDuration(activity.totalVoiceSeconds)}** · 7d: **${formatDuration(sumDaily(session.guildId, profile.userId, 7, 'voiceSeconds'))}**`,
          `Letzte Aktivität: ${formatRelative(activity.lastMessageAt || activity.lastVoiceAt)}`,
          `Warnungen: **${warnings}** · Notizen: **${notes}**`
        ].join('\n')
      });
    });
  }

  const nav = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mm:first:${token}`).setLabel('Erste').setStyle(ButtonStyle.Secondary).setDisabled(session.page === 0),
    new ButtonBuilder().setCustomId(`mm:prev:${token}`).setLabel('Zurück').setStyle(ButtonStyle.Secondary).setDisabled(session.page === 0),
    new ButtonBuilder().setCustomId(`mm:next:${token}`).setLabel('Weiter').setStyle(ButtonStyle.Secondary).setDisabled(session.page >= pageCount - 1),
    new ButtonBuilder().setCustomId(`mm:last:${token}`).setLabel('Letzte').setStyle(ButtonStyle.Secondary).setDisabled(session.page >= pageCount - 1),
    new ButtonBuilder().setCustomId(`mm:refresh:${token}`).setLabel('Aktualisieren').setStyle(ButtonStyle.Primary)
  );

  const tools = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mm:sort:${token}`).setLabel('Sortierung ändern').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`mm:filter:${token}`).setLabel('Filter ändern').setStyle(ButtonStyle.Primary)
  );

  const components = [nav, tools];
  if (pageProfiles.length) {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`mm:select:${token}`)
          .setPlaceholder('Member auswählen')
          .addOptions(
            pageProfiles.slice(0, 25).map((profile) => ({
              label: truncate(profile.nickname || profile.displayName || profile.username || profile.userId, 90),
              description: truncate(`${profile.username || profile.userId} · ${profile.userId}`, 90),
              value: profile.userId
            }))
          )
      )
    );
  }

  return { embeds: [embed], components };
};

const buildDetailPanel = (interaction, cfg, token, userId) => {
  const session = panelSessions.get(token);
  const profile = guildStore('profiles', interaction.guildId)[userId];
  const activity = getActivity(interaction.guildId, userId);
  const warnings = getAllWarnings(interaction.guildId, userId);
  const activeWarnings = warnings.filter((warning) => !warning.removedAt);
  const notes = getNotes(interaction.guildId, userId);
  const roles = JSON.parse(profile?.roleIdsJson || '[]');

  const embed = new EmbedBuilder()
    .setTitle('Member Detailpanel')
    .setColor(0x35d07f)
    .setDescription(profile ? `${mention(userId)} · \`${userId}\`` : `${mention(userId)} · Profil noch nicht synchronisiert`)
    .addFields(
      {
        name: 'Profil',
        value: [
          `Username: **${profile?.username || 'unbekannt'}**`,
          `Displayname: **${profile?.displayName || 'unbekannt'}**`,
          `Nickname: **${profile?.nickname || '-'}**`,
          `Bot: **${profile?.isBot ? 'ja' : 'nein'}**`
        ].join('\n'),
        inline: true
      },
      {
        name: 'Zeitdaten',
        value: [
          `Account: ${formatDate(profile?.accountCreatedAt)}`,
          `Beigetreten: ${formatDate(profile?.joinedAt)}`,
          `Letzter Chat: ${formatRelative(activity.lastMessageAt)}`,
          `Letzte Voice: ${formatRelative(activity.lastVoiceAt)}`
        ].join('\n'),
        inline: true
      },
      {
        name: 'Aktivität',
        value: [
          `Nachrichten gesamt: **${activity.totalMessages || 0}**`,
          `Nachrichten 7d: **${sumDaily(interaction.guildId, userId, 7, 'messageCount')}**`,
          `Nachrichten 30d: **${sumDaily(interaction.guildId, userId, 30, 'messageCount')}**`,
          `Voice gesamt: **${formatDuration(activity.totalVoiceSeconds)}**`,
          `Voice 7d: **${formatDuration(sumDaily(interaction.guildId, userId, 7, 'voiceSeconds'))}**`,
          `Voice 30d: **${formatDuration(sumDaily(interaction.guildId, userId, 30, 'voiceSeconds'))}**`
        ].join('\n')
      },
      {
        name: 'Moderation',
        value: [
          `Aktive Warnungen: **${activeWarnings.length}**`,
          `Notizen: **${notes.length}**`,
          `Höchste Rolle: ${profile?.highestRoleId ? roleMention(profile.highestRoleId) : '-'}`,
          `Rollenanzahl: **${roles.length}**`
        ].join('\n')
      },
      {
        name: 'Rollen',
        value: roles.length ? roles.slice(0, 20).map(roleMention).join(' ') : 'Keine Rollen',
      }
    )
    .setFooter({ text: `Panel: ${session.sort}/${session.filter}` })
    .setTimestamp(new Date());

  if (profile?.avatarUrl) {
    embed.setThumbnail(profile.avatarUrl);
  }

  const actions = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mm:confirm:kick:${token}:${userId}`).setLabel('Kick').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`mm:confirm:ban:${token}:${userId}`).setLabel('Ban').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`mm:confirm:timeout:${token}:${userId}`).setLabel('Timeout 10m').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`mm:confirm:timeoutRemove:${token}:${userId}`).setLabel('Timeout entfernen').setStyle(ButtonStyle.Secondary)
  );

  const tools = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mm:modal:warn:${token}:${userId}`).setLabel('Warnung hinzufügen').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`mm:modal:note:${token}:${userId}`).setLabel('Notiz hinzufügen').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`mm:roles:${token}:${userId}`).setLabel('Rollen anzeigen').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`mm:memberRefresh:${token}:${userId}`).setLabel('Member refreshen').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`mm:back:${token}`).setLabel('Zurück zur Liste').setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [actions, tools] };
};

const showMembers = async (interaction, cfg, initial = {}) => {
  await loadDb();
  const token = createSession(interaction, initial);
  const payload = buildListPanel(interaction, cfg, token);
  await interaction.reply({ ...payload, allowedMentions: { parse: [] } });
};

const showMemberDetail = async (interaction, cfg, userId) => {
  await loadDb();
  await refreshMember(interaction.guild, userId).catch((error) => {
    quietLog(QUIET_LOG_SCOPE.memberManagement, error, `refreshMember fehlgeschlagen: ${userId}`);
  });
  const token = createSession(interaction, { selectedUserId: userId });
  const payload = buildDetailPanel(interaction, cfg, token, userId);
  await interaction.reply({ ...payload, allowedMentions: { users: [userId] } });
};

const showSearch = async (interaction, cfg, query) => {
  await showMembers(interaction, cfg, { query, sort: 'username' });
};

const addWarning = async (guild, userId, moderatorId, reason) => {
  const warnings = guildStore('warnings', guild.id);
  const id = randomId('warn');
  warnings[id] = {
    id,
    guildId: guild.id,
    userId,
    moderatorId,
    reason: reason || 'Kein Grund angegeben',
    createdAt: nowIso(),
    removedAt: null,
    removedBy: null,
    removeReason: ''
  };
  await saveNow();
  return warnings[id];
};

const addNote = async (guild, userId, moderatorId, text) => {
  const notes = guildStore('notes', guild.id);
  const id = randomId('note');
  notes[id] = {
    id,
    guildId: guild.id,
    userId,
    moderatorId,
    text: text || '',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    deletedAt: null,
    deletedBy: null
  };
  await saveNow();
  return notes[id];
};

const handleChatCommand = async (interaction, cfg) => {
  const conf = getCfg(cfg);
  if (!conf.enabled) {
    await interaction.reply({ content: 'Member-Management ist im Dashboard deaktiviert.', ephemeral: true });
    return;
  }

  if (!(await ensureCommandAllowed(interaction, cfg))) {
    return;
  }

  const command = interaction.commandName;
  if (command === 'members') {
    await showMembers(interaction, cfg);
    return;
  }

  if (command === 'member') {
    const user = interaction.options.getUser('user', true);
    await showMemberDetail(interaction, cfg, user.id);
    return;
  }

  if (command === 'member-search') {
    const query = interaction.options.getString('query', true);
    await showSearch(interaction, cfg, query);
    return;
  }

  if (command === 'member-refresh') {
    const user = interaction.options.getUser('user', true);
    const profile = await refreshMember(interaction.guild, user.id);
    await addLog(interaction.guild, cfg, {
      actionType: 'Member refreshed',
      targetUserId: user.id,
      moderatorId: interaction.user.id
    });
    await interaction.reply({
      content: profile ? `Member ${mention(user.id)} wurde aktualisiert.` : `Member ${mention(user.id)} konnte nicht geladen werden.`,
      allowedMentions: { users: [user.id] },
      ephemeral: true
    });
    return;
  }

  if (command === 'member-refresh-all') {
    await interaction.reply({ content: 'Sicherer Member-Sync wurde gestartet. Ich arbeite im Hintergrund in kleinen Schritten.', ephemeral: true });
    setTimeout(() => {
      refreshAllMembers(interaction.guild, cfg, interaction.user.id).catch((error) => console.error('[memberManagement] refresh-all failed', error));
    }, 100);
    return;
  }

  if (command === 'member-stats') {
    const user = interaction.options.getUser('user', true);
    await loadDb();
    await refreshMember(interaction.guild, user.id).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.memberManagement, error, `refreshMember (Join) fehlgeschlagen: ${user.id}`);
    });
    const token = createSession(interaction, { selectedUserId: user.id });
    const payload = buildDetailPanel(interaction, cfg, token, user.id);
    await interaction.reply({ ...payload, allowedMentions: { users: [user.id] } });
    return;
  }

  if (command === 'warnings') {
    const user = interaction.options.getUser('user', true);
    const warnings = getAllWarnings(interaction.guildId, user.id);
    const embed = new EmbedBuilder()
      .setTitle(`Warnungen für ${user.tag}`)
      .setColor(0xf1b84b)
      .setDescription(warnings.length ? warnings.slice(0, 20).map((warning) => `\`${warning.id}\` ${warning.removedAt ? 'entfernt' : 'aktiv'} · ${warning.reason} · ${formatDate(warning.createdAt)}`).join('\n') : 'Keine Warnungen gespeichert.');
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (command === 'notes') {
    const user = interaction.options.getUser('user', true);
    const notes = getNotes(interaction.guildId, user.id);
    const embed = new EmbedBuilder()
      .setTitle(`Interne Notizen für ${user.tag}`)
      .setColor(0x27c4e8)
      .setDescription(notes.length ? notes.slice(0, 20).map((note) => `\`${note.id}\` ${note.text} · ${formatDate(note.createdAt)}`).join('\n') : 'Keine Notizen gespeichert.');
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};

const refreshAllMembers = async (guild, cfg, moderatorId) => {
  const members = await guild.members.fetch().catch((error) => {
    quietLog(QUIET_LOG_SCOPE.memberManagement, error, `members.fetch (Full) fehlgeschlagen`);
    return null;
  });
  if (!members) {
    await addLog(guild, cfg, { actionType: 'Error', moderatorId, reason: 'Full member fetch failed' });
    return;
  }

  let count = 0;
  for (const member of members.values()) {
    await upsertMember(member);
    count += 1;
    if (count % 50 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  await saveNow();
  await addLog(guild, cfg, { actionType: 'Member refresh-all completed', moderatorId, reason: `${count} Member synchronisiert` });
};

const handleButton = async (interaction, cfg) => {
  const parts = interaction.customId.split(':');
  const [scope, action] = parts;
  if (scope !== 'mm') {
    return false;
  }

  const token = ['confirm', 'do'].includes(action) ? parts[3] : parts[2];
  const userId = ['confirm', 'do'].includes(action) ? parts[4] : parts[3];
  const session = await getSession(interaction, token);
  if (!session) {
    return true;
  }

  if (!(await ensureCommandAllowed(interaction, cfg))) {
    return true;
  }

  if (action === 'first') session.page = 0;
  if (action === 'prev') session.page -= 1;
  if (action === 'next') session.page += 1;
  if (action === 'last') session.page = 999999;
  if (action === 'sort') session.sort = SORTS[(SORTS.indexOf(session.sort) + 1) % SORTS.length];
  if (action === 'filter') session.filter = FILTERS[(FILTERS.indexOf(session.filter) + 1) % FILTERS.length];

  if (['first', 'prev', 'next', 'last', 'sort', 'filter', 'refresh'].includes(action)) {
    await interaction.update({ ...buildListPanel(interaction, cfg, token), allowedMentions: { parse: [] } });
    return true;
  }

  if (action === 'back') {
    await interaction.update({ ...buildListPanel(interaction, cfg, token), allowedMentions: { parse: [] } });
    return true;
  }

  if (action === 'memberRefresh') {
    await refreshMember(interaction.guild, userId).catch((error) => {
    quietLog(QUIET_LOG_SCOPE.memberManagement, error, `refreshMember fehlgeschlagen: ${userId}`);
  });
    await addLog(interaction.guild, cfg, {
      actionType: 'Member refreshed',
      targetUserId: userId,
      moderatorId: interaction.user.id
    });
    await interaction.update({ ...buildDetailPanel(interaction, cfg, token, userId), allowedMentions: { users: [userId] } });
    return true;
  }

  if (action === 'roles') {
    const profile = guildStore('profiles', interaction.guildId)[userId];
    const roles = JSON.parse(profile?.roleIdsJson || '[]');
    await interaction.reply({
      content: roles.length ? roles.map(roleMention).join(' ') : 'Dieser Member hat keine Rollen.',
      ephemeral: true
    });
    return true;
  }

  if (action === 'confirm') {
    const moderationAction = parts[2];
    await showConfirmation(interaction, cfg, moderationAction, token, userId);
    return true;
  }

  if (action === 'do') {
    const moderationAction = parts[2];
    await executeModeration(interaction, cfg, moderationAction, userId);
    return true;
  }

  return false;
};

const showConfirmation = async (interaction, cfg, action, token, userId) => {
  const target = await interaction.guild.members.fetch(userId).catch((error) => {
    quietLog(QUIET_LOG_SCOPE.memberManagement, error, `members.fetch (Target) fehlgeschlagen: ${userId}`);
    return null;
  });
  if (!target) {
    await interaction.reply({ content: 'Member wurde nicht gefunden.', ephemeral: true });
    return;
  }

  const reason = await canModerateTarget(interaction, target, action);
  if (reason) {
    await interaction.reply({ content: reason, ephemeral: true });
    return;
  }

  const labelMap = {
    kick: 'Kick',
    ban: 'Ban',
    timeout: 'Timeout 10 Minuten',
    timeoutRemove: 'Timeout entfernen'
  };

  const embed = new EmbedBuilder()
    .setTitle('Moderationsaktion bestätigen')
    .setColor(0xff6b6b)
    .setDescription([
      `Zielmember: ${mention(userId)}`,
      `Aktion: **${labelMap[action] || action}**`,
      'Diese Aktion wird erst nach Bestätigung ausgeführt und im Mod-Log gespeichert.'
    ].join('\n'));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mm:do:${action}:${token}:${userId}`).setLabel('Bestätigen').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`mm:cancel:${token}`).setLabel('Abbrechen').setStyle(ButtonStyle.Secondary)
  );

  await interaction.reply({ embeds: [embed], components: [row], ephemeral: true, allowedMentions: { users: [userId] } });
};

const executeModeration = async (interaction, cfg, action, userId) => {
  const target = await interaction.guild.members.fetch(userId).catch((error) => {
    quietLog(QUIET_LOG_SCOPE.memberManagement, error, `members.fetch (Target) fehlgeschlagen: ${userId}`);
    return null;
  });
  if (!target) {
    await interaction.update({ content: 'Member wurde nicht gefunden.', embeds: [], components: [] });
    return;
  }

  const permissionError = await canModerateTarget(interaction, target, action);
  if (permissionError) {
    await interaction.update({ content: permissionError, embeds: [], components: [] });
    return;
  }

  const reason = `Ausgeführt von ${interaction.user.tag} über Member-Panel`;
  if (action === 'kick') await target.kick(reason);
  if (action === 'ban') await interaction.guild.members.ban(target.id, { reason, deleteMessageSeconds: 0 });
  if (action === 'timeout') await target.timeout(10 * 60 * 1000, reason);
  if (action === 'timeoutRemove') await target.timeout(null, reason);

  await addLog(interaction.guild, cfg, {
    actionType: action,
    targetUserId: userId,
    moderatorId: interaction.user.id,
    reason
  });

  await interaction.update({ content: `Aktion **${action}** für ${mention(userId)} wurde ausgeführt.`, embeds: [], components: [], allowedMentions: { users: [userId] } });
};

const handleSelect = async (interaction, cfg) => {
  const [scope, action, token] = interaction.customId.split(':');
  if (scope !== 'mm' || action !== 'select') {
    return false;
  }

  const session = await getSession(interaction, token);
  if (!session) {
    return true;
  }

  const userId = interaction.values?.[0];
  session.selectedUserId = userId;
  await refreshMember(interaction.guild, userId).catch((error) => {
    quietLog(QUIET_LOG_SCOPE.memberManagement, error, `refreshMember fehlgeschlagen: ${userId}`);
  });
  await interaction.update({ ...buildDetailPanel(interaction, cfg, token, userId), allowedMentions: { users: [userId] } });
  return true;
};

const handleModalButton = async (interaction) => {
  const [scope, action, type, token, userId] = interaction.customId.split(':');
  if (scope !== 'mm' || action !== 'modal') {
    return false;
  }

  const modal = new ModalBuilder()
    .setCustomId(`mm:submit:${type}:${token}:${userId}`)
    .setTitle(type === 'warn' ? 'Warnung hinzufügen' : 'Notiz hinzufügen');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId(type === 'warn' ? 'reason' : 'text')
        .setLabel(type === 'warn' ? 'Grund' : 'Notiz')
        .setStyle(type === 'warn' ? TextInputStyle.Short : TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(type === 'warn' ? 300 : 1000)
    )
  );

  await interaction.showModal(modal);
  return true;
};

const handleModalSubmit = async (interaction, cfg) => {
  const [scope, action, type, token, userId] = interaction.customId.split(':');
  if (scope !== 'mm' || action !== 'submit') {
    return false;
  }

  const session = await getSession(interaction, token);
  if (!session) {
    return true;
  }

  if (type === 'warn') {
    const reason = interaction.fields.getTextInputValue('reason');
    await addWarning(interaction.guild, userId, interaction.user.id, reason);
    await addLog(interaction.guild, cfg, {
      actionType: 'Warning added',
      targetUserId: userId,
      moderatorId: interaction.user.id,
      reason
    });
  }

  if (type === 'note') {
    const text = interaction.fields.getTextInputValue('text');
    await addNote(interaction.guild, userId, interaction.user.id, text);
    await addLog(interaction.guild, cfg, {
      actionType: 'Note added',
      targetUserId: userId,
      moderatorId: interaction.user.id,
      reason: 'Interne Notiz erstellt'
    });
  }

  await interaction.reply({ content: type === 'warn' ? 'Warnung gespeichert.' : 'Notiz gespeichert.', ephemeral: true });
  return true;
};

const closeVoiceSession = async (guildId, userId, reason, endedAtInput = null) => {
  await loadDb();
  const openVoice = guildStore('openVoice', guildId);
  const session = openVoice[userId];
  if (!session) {
    return;
  }

  // endedAtInput erlaubt Backfill aus Logs (Carl-bot): Die Session-Dauer wird
  // dann exakt aus den Log-Zeitstempeln berechnet, nicht aus „jetzt“. Das ist
  // wichtig, damit nachgeholte Voice-Daten aus Offline-Zeiten korrekt sind.
  const endedAt = endedAtInput && !Number.isNaN(new Date(endedAtInput).getTime()) ? new Date(endedAtInput) : new Date();
  const startedAt = new Date(session.startedAt);
  const durationSeconds = Math.max(0, Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000));
  const voiceSessions = guildStore('voiceSessions', guildId);
  const id = randomId('voice');
  voiceSessions[id] = {
    id,
    guildId,
    userId,
    channelId: session.channelId,
    startedAt: session.startedAt,
    endedAt: endedAt.toISOString(),
    durationSeconds,
    closedReason: reason
  };

  const activity = getActivity(guildId, userId);
  activity.totalVoiceSeconds += durationSeconds;
  activity.lastVoiceAt = endedAt.toISOString();
  activity.updatedAt = nowIso();

  const daily = guildStore('daily', guildId);
  daily[userId] ||= {};
  daily[userId][todayKey(endedAt)] ||= { messageCount: 0, voiceSeconds: 0 };
  daily[userId][todayKey(endedAt)].voiceSeconds += durationSeconds;

  delete openVoice[userId];
  scheduleSave();
};

const openVoiceSession = async (guildId, userId, channelId, startedAtInput = null) => {
  await loadDb();
  const openVoice = guildStore('openVoice', guildId);
  // Alte offene Session (falls vorhanden) sauber schließen, bevor neu geöffnet
  // wird – z. B. beim Backfill, wenn ein Join-Log ohne Leave-Log davor liegt.
  if (openVoice[userId]) {
    await closeVoiceSession(guildId, userId, 'replaced', startedAtInput ? new Date(new Date(startedAtInput).getTime() - 1) : new Date());
  }
  openVoice[userId] = {
    guildId,
    userId,
    channelId,
    startedAt: startedAtInput && !Number.isNaN(new Date(startedAtInput).getTime()) ? new Date(startedAtInput).toISOString() : nowIso()
  };
  // Auch mitten im Call gilt der Voice-Einstieg als Aktivität: lastVoiceAt wird
  // direkt beim Betreten gesetzt (nicht erst beim Verlassen). Sonst würden
  // Nutzer, die NUR im Call sitzen und nie schreiben, in Aktivitäts-Listen und
  // bei der Inaktivitäts-Erinnerung fälschlich als inaktiv gelten, solange
  // ihre Session offen ist.
  const activity = getActivity(guildId, userId);
  const startedAtMs = new Date(openVoice[userId].startedAt).getTime();
  const currentVoiceMs = activity.lastVoiceAt ? new Date(activity.lastVoiceAt).getTime() : 0;
  if (Number.isFinite(startedAtMs) && startedAtMs >= currentVoiceMs) {
    activity.lastVoiceAt = new Date(startedAtMs).toISOString();
    activity.updatedAt = nowIso();
  }
  scheduleSave();
};

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const updateMessageActivity = async (message, cfg, countMessage) => {
  if (!message?.guild || !message.author?.id) return;
  await loadDb();
  if (countMessage && message.member) await upsertMember(message.member).catch((error) => {
    quietLog(QUIET_LOG_SCOPE.memberManagement, error, `upsertMember fehlgeschlagen: ${message.member?.id}`);
  });
  const activity = getActivity(message.guildId, message.author.id);
  const messageAt = new Date(Number(message.createdTimestamp || Date.now())).toISOString();
  const currentAt = activity.lastMessageAt ? new Date(activity.lastMessageAt).getTime() : 0;
  if (new Date(messageAt).getTime() >= currentAt) {
    activity.lastMessageAt = messageAt;
    activity.lastMessageChannelId = String(message.channelId || '');
    activity.lastMessageId = String(message.id || '');
  }
  activity.updatedAt = nowIso();
  if (countMessage) {
    activity.totalMessages += 1;
    const daily = guildStore('daily', message.guildId);
    daily[message.author.id] ||= {};
    daily[message.author.id][todayKey(new Date(message.createdTimestamp || Date.now()))] ||= { messageCount: 0, voiceSeconds: 0 };
    daily[message.author.id][todayKey(new Date(message.createdTimestamp || Date.now()))].messageCount += 1;
  }
  const scanState = guildStore('historyScan', message.guildId)[message.channelId];
  if (scanState) {
    if (countMessage && Number.isFinite(Number(scanState.indexedMessageCount))) {
      scanState.indexedMessageCount = Math.max(0, Math.trunc(Number(scanState.indexedMessageCount))) + 1;
      scanState.indexedMessageCountUpdatedAt = nowIso();
    }
    const currentLatest = String(scanState.latestMessageId || '0');
    const incoming = String(message.id || '0');
    try {
      if (BigInt(incoming) > BigInt(currentLatest)) scanState.latestMessageId = incoming;
    } catch {
      scanState.latestMessageId = incoming;
    }
    scanState.updatedAt = nowIso();
  }
  scheduleSave();
};

const INDEX_PAGE_SIZE = 100;
const INDEX_MAX_RETRIES = 5;
const INDEX_RETRY_DELAY = 2 * 60 * 1000;
const INDEX_REFRESH_INTERVAL = 10 * 60 * 1000;
const PERMANENT_INDEX_ERRORS = new Set(['10003', '50001', '50013']);
const TRANSIENT_INDEX_ERRORS = new Set([
  '429', '500', '502', '503', '504', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT',
  'EAI_AGAIN', 'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'
]);

const errorCode = (error) => String(error?.code || error?.status || error?.rawError?.code || error?.name || 'UNKNOWN');
const isPermanentIndexError = (error) => PERMANENT_INDEX_ERRORS.has(errorCode(error));

const retryDelayFor = (error, attempt) => {
  const discordSeconds = Number(error?.data?.retry_after || error?.rawError?.retry_after || 0);
  if (Number.isFinite(discordSeconds) && discordSeconds > 0) return Math.ceil(discordSeconds * 1000) + 250;
  const direct = Number(error?.retryAfter || 0);
  if (Number.isFinite(direct) && direct > 0) return Math.ceil(direct < 1000 ? direct * 1000 : direct) + 250;
  return Math.min(30_000, 750 * (2 ** attempt)) + Math.floor(Math.random() * 350);
};

const withIndexRetry = async (operation) => {
  let lastError;
  for (let attempt = 0; attempt < INDEX_MAX_RETRIES; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (isPermanentIndexError(error)) throw error;
      const code = errorCode(error);
      const retryable = TRANSIENT_INDEX_ERRORS.has(code)
        || /rate.?limit|socket|network|fetch failed|timeout|temporar/i.test(String(error?.message || ''));
      if (!retryable || attempt === INDEX_MAX_RETRIES - 1) throw error;
      await sleep(retryDelayFor(error, attempt));
    }
  }
  throw lastError;
};

const compareSnowflakes = (left, right) => {
  try {
    const a = BigInt(String(left || '0'));
    const b = BigInt(String(right || '0'));
    return a === b ? 0 : a > b ? 1 : -1;
  } catch {
    return String(left || '').localeCompare(String(right || ''));
  }
};

const FULL_DISCOVERY_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Kanäle entdecken. Mit `cacheOnly: true` (Standard bei periodischen Nachzügen)
// wird NUR der Gateway-Cache benutzt – keine REST-Calls für alle Kanäle, aktive
// Threads oder archivierte Threads. Das Gateway hält den Cache laufend aktuell
// (neue Kanäle/Threads kommen per Event rein), daher reicht das für den
// inkrementellen Nachzug vollkommen. Die teure Voll-Discovery (inkl. archivierter
// Threads pro Parent) läuft nur beim Bot-Start, bei Config-Änderung, manuell
// und als 6-Stunden-Sicherheitsnetz.
const discoverIndexChannels = async (guild, { cacheOnly = false } = {}) => {
  const channels = new Map();
  const discoveryErrors = [];
  const me = guild.members.me || await guild.members.fetchMe().catch((error) => {
    quietLog(QUIET_LOG_SCOPE.memberManagement, error, `fetchMe fehlgeschlagen (ActivityHistory)`);
    return null;
  });
  const fetched = cacheOnly
    ? guild.channels.cache
    : await withIndexRetry(() => guild.channels.fetch()).catch((error) => {
      discoveryErrors.push({ scope: 'guild_channels', code: errorCode(error), message: String(error?.message || error).slice(0, 240) });
      return guild.channels.cache;
    });
  const canRead = (channel) => {
    if (!channel?.isTextBased?.() || !channel.messages?.fetch) return false;
    const permissions = me ? channel.permissionsFor(me) : null;
    return !permissions
      || (permissions.has(PermissionFlagsBits.ViewChannel) && permissions.has(PermissionFlagsBits.ReadMessageHistory));
  };
  const add = (channel, source) => {
    if (canRead(channel)) channels.set(channel.id, { channel, source });
  };

  for (const channel of fetched.values()) add(channel, channel.isThread?.() ? 'cached_thread' : 'channel');
  if (cacheOnly) return { channels: [...channels.values()], discoveryErrors };

  const active = await withIndexRetry(() => guild.channels.fetchActiveThreads()).catch((error) => {
    discoveryErrors.push({ scope: 'active_threads', code: errorCode(error), message: String(error?.message || error).slice(0, 240) });
    return null;
  });
  for (const thread of active?.threads?.values?.() || []) add(thread, 'active_thread');

  const parents = [...fetched.values()].filter((channel) => channel?.threads?.fetchArchived);
  for (const parent of parents) {
    const permissions = me ? parent.permissionsFor(me) : null;
    if (permissions && (!permissions.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.ReadMessageHistory))) continue;
    const types = ['public'];
    if (parent.type === 0 && (!permissions || permissions.has(PermissionFlagsBits.ManageThreads))) types.push('private');
    for (const type of types) {
      try {
        const archived = await withIndexRetry(() => parent.threads.fetchArchived({ type, fetchAll: true, limit: 100 }));
        for (const thread of archived?.threads?.values?.() || []) add(thread, `archived_${type}_thread`);
      } catch (error) {
        discoveryErrors.push({ scope: `${parent.id}:${type}`, code: errorCode(error), message: String(error?.message || error).slice(0, 240) });
      }
      await sleep(200);
    }
  }
  return { channels: [...channels.values()], discoveryErrors };
};

const updateIndexMeta = (guildId, states, extra = {}) => {
  const rows = Object.values(states);
  db.indexMeta ||= {};
  const totalChannels = rows.length;
  const settledChannels = rows.filter((item) => item.complete || item.skipped).length;
  const touchedChannels = rows.filter((item) => item.complete || item.skipped || Number(item.pages || 0) > 0 || Number(item.catchupPages || 0) > 0).length;
  const measuredProgress = totalChannels
    ? (settledChannels >= totalChannels
      ? 100
      : Math.min(99, Math.round(((touchedChannels + settledChannels) / (totalChannels * 2)) * 100)))
    : 0;
  const previousProgress = Number(db.indexMeta[guildId]?.progress || 0);
  db.indexMeta[guildId] = {
    ...(db.indexMeta[guildId] || {}),
    totalChannels,
    completedChannels: rows.filter((item) => item.complete && !item.skipped).length,
    skippedChannels: rows.filter((item) => item.skipped).length,
    failedChannels: rows.filter((item) => item.lastError && !item.complete).length,
    indexedPages: rows.reduce((sum, item) => sum + Number(item.pages || 0) + Number(item.catchupPages || 0), 0),
    progress: Math.max(previousProgress, measuredProgress),
    updatedAt: nowIso(),
    ...extra
  };
  scheduleSave();
};

const startActivityHistoryScan = (guild, cfg, options = {}) => {
  const conf = getCfg(cfg);
  if (!conf.activityBackfillEnabled || !guild?.id || historyScanRunners.has(guild.id)) return;
  const retryTimer = historyScanRetryTimers.get(guild.id);
  if (retryTimer) {
    clearTimeout(retryTimer);
    historyScanRetryTimers.delete(guild.id);
  }
  let shouldRetry = false;
  const runner = (async () => {
    await loadDb();
    // Volle Discovery (alle Kanäle + alle archivierten Threads per REST) nur,
    // wenn ausdrücklich gewünscht (Start/Config/manuell) oder das 6-Stunden-
    // Sicherheitsnetz fällig ist. Periodische Nachzüge laufen über den Cache.
    const lastFullDiscoveryAt = Number(db.indexMeta?.[guild.id]?.lastFullDiscoveryAt || 0);
    const cacheOnly = options.cacheOnly !== false
      && Date.now() - lastFullDiscoveryAt < FULL_DISCOVERY_INTERVAL_MS;
    const discovery = await discoverIndexChannels(guild, { cacheOnly });
    if (!cacheOnly) {
      db.indexMeta ||= {};
      db.indexMeta[guild.id] ||= {};
      db.indexMeta[guild.id].lastFullDiscoveryAt = Date.now();
      scheduleSave();
    }
    const channels = discovery.channels;
    const states = guildStore('historyScan', guild.id);
    const queue = [];
    for (const { channel, source } of channels) {
      const state = states[channel.id] ||= {
        before: '',
        latestMessageId: '',
        complete: false,
        pages: 0,
        catchupPages: 0,
        updatedAt: null
      };
      state.name = channel.name || state.name || channel.id;
      state.source = source;
      state.parentId = channel.parentId || null;
      state.skipped = false;
      const needsCatchup = state.complete
        && state.latestMessageId
        && channel.lastMessageId
        && compareSnowflakes(channel.lastMessageId, state.latestMessageId) > 0;
      if (!state.complete || needsCatchup) {
        queue.push({
          channel,
          mode: needsCatchup ? 'catchup' : 'backfill',
          targetAfter: needsCatchup ? state.latestMessageId : ''
        });
      }
    }

    updateIndexMeta(guild.id, states, {
      running: true,
      startedAt: db.indexMeta?.[guild.id]?.startedAt || nowIso(),
      completedAt: null,
      discoveryErrors: discovery.discoveryErrors,
      discoveredChannels: channels.filter((item) => item.source === 'channel').length,
      discoveredThreads: channels.filter((item) => item.source !== 'channel').length
    });
    await saveNow().catch(() => {});

    let processedSinceSave = 0;
    while (queue.length) {
      const job = queue.shift();
      const { channel, mode } = job;
      const state = states[channel.id];
      try {
        const page = await withIndexRetry(() => channel.messages.fetch({
          limit: INDEX_PAGE_SIZE,
          ...(mode === 'catchup'
            ? job.before
              ? { before: job.before }
              : {}
            : state.before
              ? { before: state.before }
              : {})
        }));
        if (!page.size) {
          if (mode === 'backfill') state.complete = true;
        } else {
          const fetchedMessages = [...page.values()].sort((a, b) => compareSnowflakes(a.id, b.id));
          const targetAfter = String(job.targetAfter || '0');
          const messages = mode === 'catchup'
            ? fetchedMessages.filter((message) => compareSnowflakes(message.id, targetAfter) > 0)
            : fetchedMessages;
          const oldestFetched = fetchedMessages[0];
          if (messages.length) {
            const oldest = messages[0];
            const newest = messages[messages.length - 1];
            await persistIndexedMessages(messages, { batchId: `${mode}-${oldest.id}-${newest.id}` });
            if (Number.isFinite(Number(state.indexedMessageCount))) {
              state.indexedMessageCount = Math.max(0, Math.trunc(Number(state.indexedMessageCount))) + messages.length;
              state.indexedMessageCountUpdatedAt = nowIso();
            }
            for (const historicalMessage of messages) await updateMessageActivity(historicalMessage, cfg, false);
            if (!state.latestMessageId || compareSnowflakes(newest.id, state.latestMessageId) > 0) state.latestMessageId = newest.id;
          }
          if (mode === 'backfill') {
            state.before = oldestFetched.id;
            state.pages = Number(state.pages || 0) + 1;
            if (page.size < INDEX_PAGE_SIZE) state.complete = true;
          } else {
            state.catchupPages = Number(state.catchupPages || 0) + 1;
            const hasMoreNewerHistory = page.size >= INDEX_PAGE_SIZE
              && compareSnowflakes(oldestFetched.id, targetAfter) > 0;
            if (hasMoreNewerHistory) {
              job.before = oldestFetched.id;
              queue.push(job);
            }
          }
          if (mode === 'backfill' && page.size >= INDEX_PAGE_SIZE) queue.push(job);
        }
        state.lastError = null;
        state.errorCode = null;
        state.consecutiveErrors = 0;
        state.nextRetryAt = null;
        state.updatedAt = nowIso();
      } catch (error) {
        state.lastError = String(error?.message || error).slice(0, 240);
        state.errorCode = errorCode(error);
        state.consecutiveErrors = Number(state.consecutiveErrors || 0) + 1;
        state.updatedAt = nowIso();
        if (isPermanentIndexError(error)) {
          state.complete = true;
          state.skipped = true;
          state.skipReason = state.lastError;
        } else {
          state.nextRetryAt = new Date(Date.now() + INDEX_RETRY_DELAY).toISOString();
          shouldRetry = true;
        }
      }
      processedSinceSave += 1;
      updateIndexMeta(guild.id, states, { running: true });
      if (processedSinceSave >= 20) {
        processedSinceSave = 0;
        await saveNow().catch(() => {});
      }
      await sleep(220);
    }

    const remaining = Object.values(states).filter((state) => !state.complete && state.lastError).length;
    updateIndexMeta(guild.id, states, {
      running: false,
      completedAt: remaining ? null : nowIso(),
      nextRetryAt: remaining ? new Date(Date.now() + INDEX_RETRY_DELAY).toISOString() : null
    });
    await saveNow().catch(() => {});
  })().catch((error) => {
    shouldRetry = true;
    console.error(`[memberManagement] Aktivitäts-Historie für ${guild.name} fehlgeschlagen`, error);
    const states = guildStore('historyScan', guild.id);
    updateIndexMeta(guild.id, states, {
      running: false,
      fatalError: String(error?.message || error).slice(0, 300),
      nextRetryAt: new Date(Date.now() + INDEX_RETRY_DELAY).toISOString()
    });
    saveNow().catch(() => {});
  }).finally(() => {
    historyScanRunners.delete(guild.id);
    if (shouldRetry && !historyScanRetryTimers.has(guild.id)) {
      const timer = setTimeout(() => {
        historyScanRetryTimers.delete(guild.id);
        startActivityHistoryScan(guild, cfg, { cacheOnly: true });
      }, INDEX_RETRY_DELAY);
      timer.unref?.();
      historyScanRetryTimers.set(guild.id, timer);
    }
  });
  historyScanRunners.set(guild.id, runner);
};

const scheduleActivityHistoryRefresh = (guild, cfg) => {
  if (!guild?.id) return;
  const existing = historyScanRefreshTimers.get(guild.id);
  if (existing) clearInterval(existing);
  const configuredMinutes = Number(getCfg(cfg).indexRefreshMinutes || 10);
  const interval = Math.min(60, Math.max(1, configuredMinutes)) * 60 * 1000 || INDEX_REFRESH_INTERVAL;
  const timer = setInterval(() => startActivityHistoryScan(guild, cfg, { cacheOnly: true }), interval);
  timer.unref?.();
  historyScanRefreshTimers.set(guild.id, timer);
};

const indexedChannelCountReads = new Map();

export const getIndexedChannelMessageCount = async (guildId, channelId) => {
  const normalizedGuildId = String(guildId || '').trim();
  const normalizedChannelId = String(channelId || '').trim();
  if (!normalizedGuildId || !normalizedChannelId) return 0;
  await loadDb();
  const states = guildStore('historyScan', normalizedGuildId);
  const state = states[normalizedChannelId] || (states[normalizedChannelId] = {});
  if (Number.isFinite(Number(state.indexedMessageCount))) {
    return Math.max(0, Math.trunc(Number(state.indexedMessageCount)));
  }
  const cacheKey = `${normalizedGuildId}:${normalizedChannelId}`;
  if (indexedChannelCountReads.has(cacheKey)) return indexedChannelCountReads.get(cacheKey);
  const pending = (async () => {
    const directory = path.join(SERVER_INDEX_DIR, normalizedGuildId, normalizedChannelId);
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl')).map((entry) => path.join(directory, entry.name));
    let count = 0;
    const [{ createReadStream }, { createInterface }] = await Promise.all([import('node:fs'), import('node:readline')]);
    for (const fileName of files) {
      const lines = createInterface({ input: createReadStream(fileName, { encoding: 'utf8' }), crlfDelay: Infinity });
      for await (const line of lines) if (String(line || '').trim()) count += 1;
    }
    state.indexedMessageCount = count;
    state.indexedMessageCountUpdatedAt = nowIso();
    scheduleSave();
    return count;
  })().finally(() => indexedChannelCountReads.delete(cacheKey));
  indexedChannelCountReads.set(cacheKey, pending);
  return pending;
};

export const ensureMemberActivityIndex = async (guild, cfg) => {
  if (!guild?.id) return { activity: {}, status: null };
  await loadDb();
  startActivityHistoryScan(guild, cfg);
  const states = guildStore('historyScan', guild.id);
  const meta = db.indexMeta?.[guild.id] || {};
  const rows = Object.values(states);
  const totalChannels = Number(meta.totalChannels || rows.length || 0);
  const completedChannels = rows.filter((item) => item.complete && !item.skipped).length;
  const skippedChannels = rows.filter((item) => item.skipped).length;
  const failedChannels = rows.filter((item) => item.lastError && !item.complete).length;
  const settledChannels = completedChannels + skippedChannels;
  const touchedChannels = rows.filter((item) => item.complete || item.skipped || Number(item.pages || 0) > 0 || Number(item.catchupPages || 0) > 0).length;
  const measuredProgress = totalChannels
    ? (settledChannels >= totalChannels
      ? 100
      : Math.min(99, Math.round(((touchedChannels + settledChannels) / (totalChannels * 2)) * 100)))
    : 0;
  const resolvedProgress = Math.max(Number(meta.progress || 0), measuredProgress);
  const initialIndexComplete = resolvedProgress >= 100;
  if (initialIndexComplete && meta.running) {
    meta.running = false;
    meta.completedAt ||= nowIso();
    scheduleSave();
  }
  return {
    activity: { ...guildStore('activity', guild.id) },
    status: {
      running: !initialIndexComplete && (historyScanRunners.has(guild.id) || Boolean(meta.running)),
      totalChannels,
      completedChannels,
      skippedChannels,
      failedChannels,
      indexedPages: Math.max(
        Number(meta.indexedPages || 0),
        rows.reduce((sum, item) => sum + Number(item.pages || 0) + Number(item.catchupPages || 0), 0)
      ),
      progress: resolvedProgress,
      startedAt: meta.startedAt || null,
      updatedAt: meta.updatedAt || null,
      completedAt: meta.completedAt || null,
      nextRetryAt: meta.nextRetryAt || null,
      discoveredChannels: Number(meta.discoveredChannels || 0),
      discoveredThreads: Number(meta.discoveredThreads || 0),
      discoveryErrors: Array.isArray(meta.discoveryErrors) ? meta.discoveryErrors : []
    }
  };
};

export const feature = {
  id: 'memberManagement',
  name: 'Member Management',
  commands: [],

  async onClientReady({ guild, cfg }) {
    startActivityHistoryScan(guild, cfg);
    scheduleActivityHistoryRefresh(guild, cfg);
    void migrateLegacyServerIndex(guild.id).catch((error) => {
      console.warn(`[server-index] Migration für ${guild.name} fehlgeschlagen: ${error?.message || error}`);
    });
  },

  async onConfigUpdate({ guild, cfg }) {
    startActivityHistoryScan(guild, cfg, { cacheOnly: false });
    scheduleActivityHistoryRefresh(guild, cfg);
  },

  async onInteractionCreate({ interaction, cfg }) {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    const names = ['members', 'member', 'member-search', 'member-refresh', 'member-refresh-all', 'member-stats', 'warnings', 'notes'];
    if (!names.includes(interaction.commandName)) {
      return;
    }

    try {
      await handleChatCommand(interaction, cfg);
    } catch (error) {
      console.error('[memberManagement] command failed', error);
      const payload = { content: 'Member-Management Fehler. Die Aktion wurde nicht ausgeführt.', ephemeral: true };
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
    }
  },

  async onAnyInteraction({ interaction, cfg }) {
    try {
      if (interaction.isButton()) {
        if (await handleModalButton(interaction, cfg)) return;
        if (interaction.customId.startsWith('mm:cancel:')) {
          await interaction.update({ content: 'Aktion abgebrochen.', embeds: [], components: [] });
          return;
        }
        await handleButton(interaction, cfg);
      } else if (interaction.isStringSelectMenu()) {
        await handleSelect(interaction, cfg);
      } else if (interaction.isModalSubmit()) {
        await handleModalSubmit(interaction, cfg);
      }
    } catch (error) {
      console.error('[memberManagement] interaction failed', error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'Member-Panel Fehler. Bitte erneut versuchen.', ephemeral: true }).catch(() => {});
      }
    }
  },

  async onMessageCreate({ message, cfg }) {
    await persistIndexedMessages([message]).catch(() => {});
    await updateMessageActivity(message, cfg, true);
  },

  async onBotMessageCreate({ message, cfg }) {
    await persistIndexedMessages([message]).catch(() => {});
    await updateMessageActivity(message, cfg, true);
  },

  async onMessageUpdate({ newMessage }) {
    if (!newMessage?.guildId || !newMessage?.id) return;
    let current = newMessage;
    if (current.partial) current = await current.fetch().catch(() => current);
    await persistIndexedMessages([current], { source: 'live-update' });
    indexedKnowledgeCache.clear();
    memberIntelligenceCache.clear();
  },

  async onMessageDelete({ message }) {
    if (!message?.guildId || !message?.id) return;
    await deleteServerIndexMessages({ guildId: message.guildId, messageIds: [message.id] });
    indexedKnowledgeCache.clear();
    memberIntelligenceCache.clear();
  },

  async onMessageBulkDelete({ messages, guild, channel }) {
    const guildId = String(guild?.id || channel?.guildId || messages?.first?.()?.guildId || '');
    if (!guildId) return;
    const messageIds = typeof messages?.keys === 'function' ? [...messages.keys()] : [];
    await deleteServerIndexMessages({ guildId, messageIds });
    indexedKnowledgeCache.clear();
    memberIntelligenceCache.clear();
  },

  async onGuildMemberAdd({ member }) {
    await upsertMember(member).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.memberManagement, error, `upsertMember (Add) fehlgeschlagen: ${member?.id}`);
    });
  },

  async onGuildMemberRemove({ member }) {
    await markLeft(member).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.memberManagement, error, `markLeft fehlgeschlagen: ${member?.id}`);
    });
  },

  async onGuildMemberUpdate({ newMember }) {
    await upsertMember(newMember).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.memberManagement, error, `upsertMember (Update) fehlgeschlagen: ${newMember?.id}`);
    });
  }
};

// Liefert die zuletzt bekannte Aktivität (max(Nachricht, Voice)) je Mitglied –
// dieselbe Quelle wie „Serververwaltung → Mitglieder → Letzte Aktivität“.
// Rückgabe: { [userId]: lastActiveMs }. Basis für die Inaktivitäts-Erinnerung.
export const getMemberActivitySnapshot = (guildId, { includeOpenVoice = true } = {}) => {
  const activity = guildStore('activity', String(guildId || ''));
  const snapshot = {};
  for (const [userId, entry] of Object.entries(activity || {})) {
    const lastMessageAt = entry?.lastMessageAt ? Date.parse(entry.lastMessageAt) : 0;
    const lastVoiceAt = entry?.lastVoiceAt ? Date.parse(entry.lastVoiceAt) : 0;
    const lastActiveMs = Math.max(
      Number.isFinite(lastMessageAt) ? lastMessageAt : 0,
      Number.isFinite(lastVoiceAt) ? lastVoiceAt : 0
    );
    if (lastActiveMs > 0) snapshot[String(userId)] = lastActiveMs;
  }
  // Wer aktuell in einem Sprachkanal sitzt (offene Voice-Session), ist in
  // DIESEM Moment aktiv – egal ob er schreibt oder nicht. Damit werden reine
  // Call-Nutzer („nur im Call, schreibt nie“) nie fälschlich als inaktiv
  // markiert, selbst wenn ihre Session schon sehr lange läuft. Quelle sind die
  // Carl-bot-Logs (voiceLogImport) – dieselbe Voice-Datenbasis wie die Profile.
  if (includeOpenVoice) {
    const openVoice = guildStore('openVoice', String(guildId || ''));
    for (const userId of Object.keys(openVoice || {})) {
      const current = Number(snapshot[String(userId)] || 0);
      snapshot[String(userId)] = Math.max(current, Date.now());
    }
  }
  return snapshot;
};

// Detaillierte Aktivität je Mitglied: letzte Nachricht UND letzter Voice separat
// (für die Inaktivitäts-Erinnerung – Beweis im DM: „letzter Chat / letzte
// Voice“). Rückgabe: { [userId]: { lastMessageAt, lastVoiceAt } } – ISO-Strings
// oder null. Quelle ist dieselbe wie getMemberActivitySnapshot.
export const getMemberActivityDetail = (guildId) => {
  const activity = guildStore('activity', String(guildId || ''));
  const detail = {};
  for (const [userId, entry] of Object.entries(activity || {})) {
    detail[String(userId)] = {
      lastMessageAt: entry?.lastMessageAt || null,
      lastVoiceAt: entry?.lastVoiceAt || null
    };
  }
  return detail;
};

export const _memberManagementInternals = {
  discoverIndexChannels,
  FULL_DISCOVERY_INTERVAL_MS,
  compareSnowflakes
};

// Voice-Session-Schnittstelle für externe Quellen (z. B. Carl-bot-Voice-Logger):
// Das Voice-Log-Import-Modul speist damit Mitglieder-Profile („Voice gesamt /
// 7d / 30d“) aus den Log-Nachrichten. Beide Funktionen akzeptieren Zeitpunkte,
// damit nachgeholte Logs (Offline-Zeiten) exakt verbucht werden.
export const importVoiceSession = {
  open: (guildId, userId, channelId, startedAt = null) => openVoiceSession(guildId, userId, channelId, startedAt),
  close: (guildId, userId, reason = 'left', endedAt = null) => closeVoiceSession(guildId, userId, reason, endedAt),
  openSessions: (guildId) => ({ ...(guildStore('openVoice', String(guildId || '')) || {}) })
};
