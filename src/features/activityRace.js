import crypto from 'node:crypto';
import path from 'node:path';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits
} from 'discord.js';

import { atomicWriteJson, readJsonWithRecovery } from '../runtime/atomicJsonStore.js';
import { applyManagedRolePolicy } from '../runtime/managedRoleService.js';
import { getServerIndexActivityMessages, getServerIndexSnapshot } from '../serverIndexStore.js';

const DATA_ROOT = process.env.FALLEN_HEAVEN_DATA_DIR || path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_ROOT, 'activity-race.json');
const DATA_VERSION = 5;
const PANEL_PREFIX = 'fh-activity-race:';
const PING_AUTO_DELETE_MS = 5 * 60_000; // Platzierungs-Pings löschen sich nach 5 Minuten selbst.
const TICK_MS = 30_000;
const SAVE_DELAY_MS = 2_000;
const ROLE_RECONCILE_DEBOUNCE_MS = 4_000;
const PANEL_REFRESH_DEBOUNCE_MS = 5_000;
const RETENTION_DAYS = 400;
const INDEX_RECONCILE_MIN_INTERVAL_MS = 60_000;
const INDEX_PAGE_SIZE = 10_000;
const TROPHY_EMOJIS = {
  1: { name: 'trophy1', id: '1533907289604493502', fallback: '🥇' },
  2: { name: 'trophy2', id: '1533907288379625673', fallback: '🥈' },
  3: { name: 'trophy3', id: '1533907290753732608', fallback: '🥉' }
};

const ACTIVITY_PERIOD_DEFINITIONS = [
  { key: 'daily', prefix: 'daily', label: 'Tageswertung', colors: { chat: [0xf3c85b, 0xaeb8c8, 0xc78557], voice: [0xffdc74, 0xb9c7df, 0xd19162] } },
  { key: 'weekly', prefix: 'weekly', label: 'Wochenwertung', colors: { chat: [0xb697ff, 0x8f7bc5, 0x9f6d59], voice: [0x956cff, 0x7660bd, 0x956249] } },
  { key: 'monthly', prefix: 'monthly', label: 'Monatswertung', colors: { chat: [0x6fd8ff, 0x72a7bd, 0xa6755c], voice: [0x57b7ff, 0x668fb3, 0x96664f] } }
];
const ACTIVITY_METRIC_DEFINITIONS = [
  { key: 'chat', suffix: 'Chat', label: 'Chat' },
  { key: 'voice', suffix: 'Voice', label: 'Sprachchat' }
];
const placementRoleKey = (period, metric, place, suffix = 'RoleId') => `${period}${metric}${place === 1 ? '' : `Top${place}`}${suffix}`;

export const ACTIVITY_RACE_ROLE_DEFINITIONS = [
  { key: 'separatorRoleId', nameKey: 'separatorRoleName', defaultName: '━━ AKTIVITÄTS-LIGA ━━', color: 0x151729, label: 'Trenner' },
  ...ACTIVITY_PERIOD_DEFINITIONS.flatMap((period) => ACTIVITY_METRIC_DEFINITIONS.flatMap((metric) => [1, 2, 3].map((place) => ({
    key: placementRoleKey(period.prefix, metric.suffix, place),
    nameKey: placementRoleKey(period.prefix, metric.suffix, place, 'RoleName'),
    defaultName: `${place === 1 ? '🥇' : place === 2 ? '🥈' : '🥉'} ${period.label} · ${metric.label} · Platz ${place}`,
    color: period.colors[metric.key][place - 1],
    label: `${period.label} · ${metric.label} · Platz ${place}`,
    period: period.key,
    metric: metric.key,
    place
  }))))
];

const LEGACY_DEFAULT_ROLE_NAMES = new Set([
  '━━ FALLEN ACTIVITY ━━',
  '✦ Daily · Chat', '✦ Daily · Voice',
  '✦ Weekly · Chat', '✦ Weekly · Voice',
  '♛ Monthly · Chat', '♛ Monthly · Voice'
]);

const PERIODS = {
  daily: { label: 'HEUTE', title: 'Heute', color: 0x6fd8ff },
  weekly: { label: 'WOCHENWERTUNG', title: 'Letzte abgeschlossene Woche', color: 0xa98aff },
  monthly: { label: 'MONATSWERTUNG', title: 'Letzter abgeschlossener Monat', color: 0xf2c66d }
};
const PERIOD_COMPLETION_COPY = {
  daily: 'Die Tagesrollen zeigen den aktuellen Stand und wechseln automatisch, sobald sich Platz 1 bis 3 verändern.',
  weekly: 'Die Rollen werden erst am Wochenabschluss für die vollständige Kalenderwoche vergeben.',
  monthly: 'Die Rollen werden erst am Monatsabschluss für den vollständigen Kalendermonat vergeben.'
};

const emptyStore = () => ({ version: DATA_VERSION, guilds: {} });
let store = null;
let loadPromise = null;
let saveTimer = null;
let saveQueue = Promise.resolve();
const runtimes = new Map();
const rolePlans = new Map();
const messageGuards = new Map();

const finiteInteger = (value, fallback, minimum, maximum) => {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
};

const resolveActivityRaceAvatar = (member, options = { size: 128, extension: 'png' }) => {
  const user = member?.user || null;
  if (!user?.id) return '';
  const resolved = member?.displayAvatarURL?.(options) || user?.displayAvatarURL?.(options);
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
  return '';
};

const uniqueIds = (value) => [...new Set((Array.isArray(value) ? value : String(value || '').split(/[\r\n,]+/))
  .map((entry) => String(entry || '').trim()).filter(Boolean))];
const safeRoleName = (value, fallback) => String(value || fallback || '').replace(/\s+/g, ' ').trim().slice(0, 100) || fallback;
const safeText = (value, fallback = '', maximum = 4096) => String(value ?? fallback).slice(0, maximum);
const safeHttpUrl = (value) => {
  const url = String(value || '').trim();
  return /^https?:\/\/[^\s]+$/i.test(url) ? url.slice(0, 2_000) : '';
};
const safeColor = (value, fallback = '#6fd8ff') => {
  const normalized = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized.toLowerCase() : fallback;
};
const defaultPanelDesign = () => ({
  content: '',
  outsideImageUrl: '',
  outsideImageAttachment: null,
  embed: {
    title: '{period}',
    url: '',
    description: 'Die aktivsten Mitglieder im Chat und Sprachchat.\n*{completion}*',
    color: '',
    authorName: 'FALLEN HEAVEN · AKTIVITÄTS-LIGA',
    authorIconUrl: '',
    thumbnailUrl: '',
    imageUrl: '',
    footerText: '{period} · nachvollziehbar und automatisch ausgewertet',
    footerIconUrl: '',
    timestamp: true,
    fields: []
  }
});
const normalizePanelAttachment = (value) => {
  if (!value || typeof value !== 'object') return null;
  const id = String(value.id || '').trim();
  const url = safeHttpUrl(value.url);
  if (!id || !url) return null;
  return {
    id,
    url,
    name: String(value.name || 'fallen-heaven-activity.png').replace(/[^a-z0-9._-]/gi, '_').slice(-120),
    size: finiteInteger(value.size, 0, 0, 25 * 1024 * 1024)
  };
};
const normalizePanelDesign = (value = {}) => {
  const fallback = defaultPanelDesign();
  const embed = value?.embed && typeof value.embed === 'object' ? value.embed : {};
  return {
    content: safeText(value?.content, fallback.content, 2_000),
    outsideImageUrl: safeHttpUrl(value?.outsideImageUrl),
    outsideImageAttachment: normalizePanelAttachment(value?.outsideImageAttachment),
    embed: {
      title: safeText(embed.title, fallback.embed.title, 256),
      url: safeHttpUrl(embed.url),
      description: safeText(embed.description, fallback.embed.description, 4_096),
      color: embed.color ? safeColor(embed.color, '') : '',
      authorName: safeText(embed.authorName, fallback.embed.authorName, 256),
      authorIconUrl: safeHttpUrl(embed.authorIconUrl),
      thumbnailUrl: safeHttpUrl(embed.thumbnailUrl),
      imageUrl: safeHttpUrl(embed.imageUrl),
      footerText: safeText(embed.footerText, fallback.embed.footerText, 2_048),
      footerIconUrl: safeHttpUrl(embed.footerIconUrl),
      timestamp: embed.timestamp !== false,
      fields: (Array.isArray(embed.fields) ? embed.fields : [])
        .slice(0, 21)
        .map((field) => ({
          name: safeText(field?.name, '', 256),
          value: safeText(field?.value, '', 1_024),
          inline: field?.inline === true
        }))
        .filter((field) => field.name || field.value)
    }
  };
};
const normalizedRoleName = (conf, definition) => {
  const current = safeRoleName(conf?.[definition.nameKey], definition.defaultName);
  return LEGACY_DEFAULT_ROLE_NAMES.has(current) ? definition.defaultName : current;
};
const normalizeConfig = (conf = {}) => ({
  enabled: conf?.enabled === true,
  panelChannelId: String(conf?.panelChannelId || '').trim(),
  ignoredChannelIds: uniqueIds(conf?.ignoredChannelIds),
  excludedRoleIds: uniqueIds(conf?.excludedRoleIds),
  messageCooldownSeconds: finiteInteger(conf?.messageCooldownSeconds, 10, 0, 300),
  duplicateWindowMinutes: finiteInteger(conf?.duplicateWindowMinutes, 10, 0, 1440),
  minimumMessageLength: finiteInteger(conf?.minimumMessageLength, 3, 1, 500),
  voiceMinimumParticipants: finiteInteger(conf?.voiceMinimumParticipants, 2, 2, 20),
  excludeDeafened: conf?.excludeDeafened !== false,
  placementPings: conf?.placementPings !== false,
  placementPingChannelId: String(conf?.placementPingChannelId || '').trim(),
  placementPingLifetimeMinutes: finiteInteger(conf?.placementPingLifetimeMinutes, 5, 1, 60),
  announceCompletedPeriods: conf?.announceCompletedPeriods !== false,
  announcementChannelId: String(conf?.announcementChannelId || '').trim(),
  panelDesign: normalizePanelDesign(conf?.panelDesign),
  ...Object.fromEntries(ACTIVITY_RACE_ROLE_DEFINITIONS.flatMap((definition) => [
    [definition.key, String(conf?.[definition.key] || '').trim()],
    [definition.nameKey, normalizedRoleName(conf, definition)]
  ]))
});

const normalizeUserDay = (value = {}) => ({
  messages: finiteInteger(value.messages, 0, 0, Number.MAX_SAFE_INTEGER),
  voiceMilliseconds: finiteInteger(value.voiceMilliseconds, 0, 0, Number.MAX_SAFE_INTEGER)
});
const normalizeHolderIds = (value) => uniqueIds(value).slice(0, 3);
const normalizeHolderRange = (value = {}) => ({
  start: /^\d{4}-\d{2}-\d{2}$/.test(String(value?.start || '')) ? String(value.start) : '',
  end: /^\d{4}-\d{2}-\d{2}$/.test(String(value?.end || '')) ? String(value.end) : ''
});
const nextUtcDateKey = (key) => {
  const date = new Date(`${key}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};
const normalizeGuildData = (value = {}) => {
  const days = Object.fromEntries(Object.entries(value?.days || {}).filter(([key]) => /^\d{4}-\d{2}-\d{2}$/.test(key)).map(([key, day]) => [
    key,
    { users: Object.fromEntries(Object.entries(day?.users || {}).map(([userId, user]) => [String(userId), normalizeUserDay(user)])) }
  ]));
  const earliestDay = Object.keys(days).sort()[0] || '';
  const storedCompleteFrom = String(value?.trackingCompleteFrom || '');
  return {
    days,
    trackingCompleteFrom: /^\d{4}-\d{2}-\d{2}$/.test(storedCompleteFrom)
      ? storedCompleteFrom
      : earliestDay ? nextUtcDateKey(earliestDay) : '',
    holders: {
      daily: { chat: normalizeHolderIds(value?.holders?.daily?.chat), voice: normalizeHolderIds(value?.holders?.daily?.voice) },
      weekly: { chat: normalizeHolderIds(value?.holders?.weekly?.chat), voice: normalizeHolderIds(value?.holders?.weekly?.voice) },
      monthly: { chat: normalizeHolderIds(value?.holders?.monthly?.chat), voice: normalizeHolderIds(value?.holders?.monthly?.voice) }
    },
    holderRanges: {
      daily: normalizeHolderRange(value?.holderRanges?.daily),
      weekly: normalizeHolderRange(value?.holderRanges?.weekly),
      monthly: normalizeHolderRange(value?.holderRanges?.monthly)
    },
    // Welche abgeschlossenen Wochen/Monate bereits angekündigt wurden – damit
    // jede Abschluss-Ankündigung genau einmal pro Zeitraum erscheint.
    announcedPeriods: {
      weekly: /^\d{4}-\d{2}-\d{2}$/.test(String(value?.announcedPeriods?.weekly || '')) ? String(value.announcedPeriods.weekly) : '',
      monthly: /^\d{4}-\d{2}-\d{2}$/.test(String(value?.announcedPeriods?.monthly || '')) ? String(value.announcedPeriods.monthly) : ''
    },
    panel: {
      channelId: String(value?.panel?.channelId || ''),
      messageId: String(value?.panel?.messageId || '')
    },
    indexBackfill: {
      rangeStart: /^\d{4}-\d{2}-\d{2}$/.test(String(value?.indexBackfill?.rangeStart || '')) ? String(value.indexBackfill.rangeStart) : '',
      rangeEnd: /^\d{4}-\d{2}-\d{2}$/.test(String(value?.indexBackfill?.rangeEnd || '')) ? String(value.indexBackfill.rangeEnd) : '',
      indexUpdatedAt: String(value?.indexBackfill?.indexUpdatedAt || ''),
      completedAt: String(value?.indexBackfill?.completedAt || ''),
      analyzedMessages: finiteInteger(value?.indexBackfill?.analyzedMessages, 0, 0, Number.MAX_SAFE_INTEGER),
      creditedMessages: finiteInteger(value?.indexBackfill?.creditedMessages, 0, 0, Number.MAX_SAFE_INTEGER),
      recoveredMessages: finiteInteger(value?.indexBackfill?.recoveredMessages, 0, 0, Number.MAX_SAFE_INTEGER),
      totalRecoveredMessages: finiteInteger(value?.indexBackfill?.totalRecoveredMessages, 0, 0, Number.MAX_SAFE_INTEGER),
      lastError: String(value?.indexBackfill?.lastError || '').slice(0, 500)
    },
    updatedAt: String(value?.updatedAt || '')
  };
};
const normalizeStore = (value) => ({
  version: DATA_VERSION,
  guilds: Object.fromEntries(Object.entries(value?.guilds || {}).map(([guildId, guild]) => [String(guildId), normalizeGuildData(guild)]))
});
const ensureLoaded = async () => {
  if (store) return store;
  if (!loadPromise) loadPromise = readJsonWithRecovery(DATA_FILE, { fallback: emptyStore(), backupLimit: 5 })
    .then((result) => { store = normalizeStore(result.value); return store; })
    .finally(() => { loadPromise = null; });
  return loadPromise;
};
const guildData = async (guildId) => {
  const data = await ensureLoaded();
  data.guilds[String(guildId)] ||= normalizeGuildData();
  return data.guilds[String(guildId)];
};
const flush = async () => {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!store) return;
  const snapshot = JSON.parse(JSON.stringify(store));
  saveQueue = saveQueue.catch(() => null).then(() => atomicWriteJson(DATA_FILE, snapshot, { backupLimit: 5 }));
  await saveQueue;
};
const scheduleSave = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flush().catch((error) => console.warn(`[activityRace] Speichern fehlgeschlagen: ${error?.message || error}`)), SAVE_DELAY_MS);
  saveTimer.unref?.();
};

const localDateKey = (timestamp = Date.now(), timezone = 'Europe/Berlin') => {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date(timestamp));
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${byType.year}-${byType.month}-${byType.day}`;
  } catch {
    return new Date(timestamp).toISOString().slice(0, 10);
  }
};
const shiftDateKey = (key, days) => {
  const date = new Date(`${key}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const periodStartKey = (period, today) => {
  if (period === 'monthly') return `${today.slice(0, 7)}-01`;
  if (period === 'weekly') {
    const date = new Date(`${today}T00:00:00.000Z`);
    const mondayOffset = (date.getUTCDay() + 6) % 7;
    return shiftDateKey(today, -mondayOffset);
  }
  return today;
};
const nextPeriodLabel = (period, timezone) => {
  const today = localDateKey(Date.now(), timezone);
  const nextKey = period === 'daily'
    ? shiftDateKey(today, 1)
    : period === 'weekly'
      ? shiftDateKey(periodStartKey('weekly', today), 7)
      : shiftDateKey(`${today.slice(0, 7)}-01`, 32).slice(0, 7) + '-01';
  try {
    const localNow = new Date(new Date().toLocaleString('en-US', { timeZone: timezone }));
    const localTarget = new Date(`${nextKey}T00:00:00`);
    const milliseconds = Math.max(0, localTarget.getTime() - localNow.getTime());
    const hours = Math.floor(milliseconds / 3_600_000);
    const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
    return `${hours} Std. ${minutes} Min.`;
  } catch {
    return nextKey;
  }
};

const aggregateRange = (data, start, end) => {
  const users = {};
  for (const [date, day] of Object.entries(data.days || {})) {
    if (date < start || date > end) continue;
    for (const [userId, row] of Object.entries(day?.users || {})) {
      users[userId] ||= { messages: 0, voiceMilliseconds: 0 };
      users[userId].messages += finiteInteger(row.messages, 0, 0, Number.MAX_SAFE_INTEGER);
      users[userId].voiceMilliseconds += finiteInteger(row.voiceMilliseconds, 0, 0, Number.MAX_SAFE_INTEGER);
    }
  }
  return { start, end, users };
};
const aggregatePeriod = (data, period, timezone, today = localDateKey(Date.now(), timezone)) => {
  return aggregateRange(data, periodStartKey(period, today), today);
};
const completedPeriodRange = (period, today) => {
  if (period === 'daily') {
    const previousDay = shiftDateKey(today, -1);
    return { start: previousDay, end: previousDay };
  }
  if (period === 'weekly') {
    const currentWeekStart = periodStartKey('weekly', today);
    const end = shiftDateKey(currentWeekStart, -1);
    return { start: shiftDateKey(end, -6), end };
  }
  const currentMonthStart = `${today.slice(0, 7)}-01`;
  const end = shiftDateKey(currentMonthStart, -1);
  return { start: `${end.slice(0, 7)}-01`, end };
};
const memberIsRankable = (guild, userId) => {
  const member = guild?.members?.cache?.get?.(String(userId));
  return Boolean(member && !member.user?.bot);
};
const ensureCompleteMemberCache = async (guild) => {
  const cached = Number(guild?.members?.cache?.size || 0);
  const expected = Number(guild?.memberCount || 0);
  if (cached > 0 && (!expected || cached >= expected)) return;
  await guild?.members?.fetch?.().catch(() => null);
};
const periodIncumbents = (data, period, metric, start, end) => {
  const range = data?.holderRanges?.[period];
  if (!range || range.start !== start || range.end !== end) return [];
  return data?.holders?.[period]?.[metric] || [];
};
const rankMetric = (guild, aggregate, metric, incumbentIds = []) => {
  const incumbents = normalizeHolderIds(incumbentIds);
  return Object.entries(aggregate.users || {})
  .filter(([userId]) => memberIsRankable(guild, userId))
  .map(([userId, row]) => ({ userId, value: finiteInteger(row?.[metric], 0, 0, Number.MAX_SAFE_INTEGER) }))
  .filter((entry) => entry.value > 0)
  .sort((left, right) => right.value - left.value
    || ((incumbents.indexOf(left.userId) === -1 ? Number.MAX_SAFE_INTEGER : incumbents.indexOf(left.userId))
      - (incumbents.indexOf(right.userId) === -1 ? Number.MAX_SAFE_INTEGER : incumbents.indexOf(right.userId)))
    || left.userId.localeCompare(right.userId));
};
const fullRankMetric = (guild, aggregate, metric) => {
  const members = [...(guild?.members?.cache?.values?.() || [])]
    .filter((member) => !member.user?.bot)
    .map((member) => ({
      userId: String(member.id),
      displayName: String(member.displayName || member.user?.globalName || member.user?.username || 'Mitglied'),
      username: String(member.user?.username || ''),
      avatarUrl: resolveActivityRaceAvatar(member, { size: 64, extension: 'png' }),
      value: finiteInteger(aggregate?.users?.[member.id]?.[metric], 0, 0, Number.MAX_SAFE_INTEGER)
    }))
    .sort((left, right) => right.value - left.value
      || left.displayName.localeCompare(right.displayName, 'de-DE', { sensitivity: 'base' })
      || left.userId.localeCompare(right.userId));
  let lastValue = null;
  let rank = 0;
  return members.map((entry, index) => {
    if (lastValue === null || entry.value !== lastValue) rank = index + 1;
    lastValue = entry.value;
    return { ...entry, rank, active: entry.value > 0 };
  });
};
const attachFullRankings = (guild, data, snapshot, timezone, today = localDateKey(Date.now(), timezone)) => {
  for (const [period, value] of Object.entries(snapshot?.periods || {})) {
    if (period !== 'daily' && value?.fullyTracked !== true) {
      value.fullChat = [];
      value.fullVoice = [];
      value.memberCount = [...(guild?.members?.cache?.values?.() || [])].filter((member) => !member.user?.bot).length;
      continue;
    }
    const aggregate = period === 'daily'
      ? aggregatePeriod(data, 'daily', timezone, today)
      : aggregateRange(data, value.start, value.end);
    value.fullChat = fullRankMetric(guild, aggregate, 'messages');
    value.fullVoice = fullRankMetric(guild, aggregate, 'voiceMilliseconds');
    value.memberCount = value.fullChat.length;
    value.activeChatMembers = value.fullChat.filter((entry) => entry.active).length;
    value.activeVoiceMembers = value.fullVoice.filter((entry) => entry.active).length;
  }
  return snapshot;
};
const periodSnapshot = (guild, data, conf, period, timezone, today = localDateKey(Date.now(), timezone)) => {
  const aggregate = aggregatePeriod(data, period, timezone, today);
  const chat = rankMetric(guild, aggregate, 'messages', periodIncumbents(data, period, 'chat', aggregate.start, aggregate.end));
  const voice = rankMetric(guild, aggregate, 'voiceMilliseconds', periodIncumbents(data, period, 'voice', aggregate.start, aggregate.end));
  const chatWinnerIds = chat.slice(0, 3).map((entry) => entry.userId);
  const voiceWinnerIds = voice.slice(0, 3).map((entry) => entry.userId);
  return {
    period,
    start: aggregate.start,
    end: aggregate.end,
    chat,
    voice,
    chatWinnerIds,
    voiceWinnerIds,
    chatWinnerId: chatWinnerIds[0] || '',
    voiceWinnerId: voiceWinnerIds[0] || ''
  };
};
const buildSnapshot = (guild, data, conf, timezone) => ({
  measuredAt: new Date().toISOString(),
  timezone,
  periods: Object.fromEntries(Object.keys(PERIODS).map((period) => [period, periodSnapshot(guild, data, conf, period, timezone)]))
});
const completedPeriodSnapshot = (guild, data, period, timezone, today = localDateKey(Date.now(), timezone)) => {
  const range = completedPeriodRange(period, today);
  const fullyTracked = Boolean(data.trackingCompleteFrom && range.start >= data.trackingCompleteFrom);
  const aggregate = aggregateRange(data, range.start, range.end);
  const rankedChat = rankMetric(guild, aggregate, 'messages', periodIncumbents(data, period, 'chat', range.start, range.end));
  const rankedVoice = rankMetric(guild, aggregate, 'voiceMilliseconds', periodIncumbents(data, period, 'voice', range.start, range.end));
  const chat = fullyTracked ? rankedChat : [];
  const voice = fullyTracked ? rankedVoice : [];
  return {
    period,
    ...range,
    fullyTracked,
    chat,
    voice,
    chatWinnerIds: chat.slice(0, 3).map((entry) => entry.userId),
    voiceWinnerIds: voice.slice(0, 3).map((entry) => entry.userId)
  };
};
const buildAwardSnapshot = (guild, data, conf, timezone, today = localDateKey(Date.now(), timezone)) => ({
  measuredAt: new Date().toISOString(),
  timezone,
  trackingCompleteFrom: data.trackingCompleteFrom,
  periods: {
    // Die Tagesrollen sind echte Live-Titel. Wochen- und Monatsrollen werden
    // dagegen ausschließlich aus vollständig abgeschlossenen Zeiträumen gebildet.
    daily: periodSnapshot(guild, data, conf, 'daily', timezone, today),
    weekly: completedPeriodSnapshot(guild, data, 'weekly', timezone, today),
    monthly: completedPeriodSnapshot(guild, data, 'monthly', timezone, today)
  }
});
const buildPanelSnapshot = (guild, data, conf, timezone) => {
  const today = localDateKey(Date.now(), timezone);
  return {
    measuredAt: new Date().toISOString(),
    timezone,
    panelDesign: normalizePanelDesign(conf?.panelDesign),
    periods: {
      daily: periodSnapshot(guild, data, conf, 'daily', timezone, today),
      weekly: completedPeriodSnapshot(guild, data, 'weekly', timezone, today),
      monthly: completedPeriodSnapshot(guild, data, 'monthly', timezone, today)
    }
  };
};

const ensureTrackingWindow = (data, timezone) => {
  if (data.trackingCompleteFrom) return false;
  data.trackingCompleteFrom = shiftDateKey(localDateKey(Date.now(), timezone), 1);
  data.updatedAt = new Date().toISOString();
  scheduleSave();
  return true;
};

const ensureDayUser = (data, timezone, userId, timestamp = Date.now()) => {
  const key = localDateKey(timestamp, timezone);
  data.days[key] ||= { users: {} };
  data.days[key].users[userId] ||= { messages: 0, voiceMilliseconds: 0 };
  return data.days[key].users[userId];
};
const pruneOldDays = (data, timezone) => {
  const cutoff = shiftDateKey(localDateKey(Date.now(), timezone), -RETENTION_DAYS);
  let changed = false;
  for (const key of Object.keys(data.days || {})) {
    if (key < cutoff) { delete data.days[key]; changed = true; }
  }
  return changed;
};

const ignoredChannel = (channel, conf) => {
  const ignored = new Set(conf.ignoredChannelIds);
  return ignored.has(String(channel?.id || ''))
    || ignored.has(String(channel?.parentId || ''))
    || ignored.has(String(channel?.parent?.parentId || ''));
};
const excludedMember = (member, conf) => Boolean(member?.roles?.cache?.some?.((role) => conf.excludedRoleIds.includes(String(role.id))));
const meaningfulMessage = (message, conf) => {
  if (message?.attachments?.size || message?.stickers?.size) return true;
  const normalized = String(message?.content || '')
    .replace(/<@!?\d+>|<@&\d+>|<#\d+>|<a?:\w+:\d+>/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' link ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.replace(/[^\p{L}\p{N}]/gu, '').length >= conf.minimumMessageLength;
};
const messageFingerprint = (message) => String(message?.content || '')
  .toLocaleLowerCase('de-DE')
  .replace(/<@!?\d+>/g, '@user')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 300);
const shouldCountMessage = (message, conf) => {
  if (!conf.enabled || !message?.guild || !message.member || message.author?.bot || message.webhookId) return false;
  if (ignoredChannel(message.channel, conf) || excludedMember(message.member, conf) || !meaningfulMessage(message, conf)) return false;
  const key = `${message.guildId}:${message.author.id}`;
  const now = Number(message.createdTimestamp || Date.now());
  const previous = messageGuards.get(key) || { at: 0, fingerprint: '', fingerprintAt: 0 };
  if (conf.messageCooldownSeconds > 0 && now - previous.at < conf.messageCooldownSeconds * 1000) return false;
  const fingerprint = messageFingerprint(message);
  if (conf.duplicateWindowMinutes > 0 && fingerprint && fingerprint === previous.fingerprint
    && now - previous.fingerprintAt < conf.duplicateWindowMinutes * 60_000) return false;
  messageGuards.set(key, { at: now, fingerprint, fingerprintAt: now });
  return true;
};

const indexedBackfillRange = (timezone, now = Date.now()) => {
  const today = localDateKey(now, timezone);
  const starts = [
    completedPeriodRange('monthly', today).start,
    completedPeriodRange('weekly', today).start,
    periodStartKey('monthly', today),
    today
  ];
  const retentionStart = shiftDateKey(today, -RETENTION_DAYS);
  const start = starts.sort()[0] < retentionStart ? retentionStart : starts.sort()[0];
  return { start, end: today, endExclusive: shiftDateKey(today, 1) };
};
const broadUtcRange = ({ start, endExclusive }) => ({
  startAt: new Date(Date.parse(`${start}T00:00:00.000Z`) - 14 * 60 * 60_000).toISOString(),
  endAt: new Date(Date.parse(`${endExclusive}T00:00:00.000Z`) + 14 * 60 * 60_000).toISOString()
});
const indexedChannelShape = (guild, row) => {
  const current = guild?.channels?.cache?.get?.(String(row?.channelId || ''));
  if (current) return current;
  return {
    id: String(row?.channelId || ''),
    parentId: String(row?.parentChannelId || ''),
    parent: null
  };
};
const createIndexedChatAccumulator = () => ({ days: {}, guards: new Map(), analyzedMessages: 0, creditedMessages: 0 });
const accumulateIndexedChatRecords = ({ guild, conf, timezone, records = [], range, accumulator }) => {
  const state = accumulator || createIndexedChatAccumulator();
  const ordered = [...records].sort((left, right) => String(left.createdAt || '').localeCompare(String(right.createdAt || ''))
    || String(left.id || '').localeCompare(String(right.id || '')));
  for (const row of ordered) {
    state.analyzedMessages += 1;
    const userId = String(row?.authorId || '');
    const member = guild?.members?.cache?.get?.(userId);
    const timestamp = Date.parse(row?.createdAt || '');
    if (!userId || !member || member.user?.bot || row?.authorBot || row?.webhookId || !Number.isFinite(timestamp)) continue;
    const dayKey = localDateKey(timestamp, timezone);
    if (dayKey < range.start || dayKey > range.end) continue;
    if (excludedMember(member, conf) || ignoredChannel(indexedChannelShape(guild, row), conf)) continue;
    const message = {
      content: String(row?.content || ''),
      attachments: { size: Array.isArray(row?.attachments) ? row.attachments.length : 0 },
      stickers: { size: Array.isArray(row?.stickers) ? row.stickers.length : 0 }
    };
    if (!meaningfulMessage(message, conf)) continue;
    const previous = state.guards.get(userId) || { at: 0, fingerprint: '', fingerprintAt: 0 };
    if (conf.messageCooldownSeconds > 0 && timestamp - previous.at < conf.messageCooldownSeconds * 1_000) continue;
    const fingerprint = messageFingerprint(message);
    if (conf.duplicateWindowMinutes > 0 && fingerprint && fingerprint === previous.fingerprint
      && timestamp - previous.fingerprintAt < conf.duplicateWindowMinutes * 60_000) continue;
    state.guards.set(userId, { at: timestamp, fingerprint, fingerprintAt: timestamp });
    state.days[dayKey] ||= {};
    state.days[dayKey][userId] = finiteInteger(state.days[dayKey][userId], 0, 0, Number.MAX_SAFE_INTEGER) + 1;
    state.creditedMessages += 1;
  }
  return state;
};
const reconstructIndexedChatDays = (options) => {
  const state = accumulateIndexedChatRecords({ ...options, accumulator: createIndexedChatAccumulator() });
  return { days: state.days, analyzedMessages: state.analyzedMessages, creditedMessages: state.creditedMessages };
};
const mergeIndexedChatDays = (data, reconstructed) => {
  let recoveredMessages = 0;
  let changed = false;
  for (const [dayKey, users] of Object.entries(reconstructed?.days || {})) {
    data.days[dayKey] ||= { users: {} };
    for (const [userId, indexedCount] of Object.entries(users || {})) {
      data.days[dayKey].users[userId] ||= { messages: 0, voiceMilliseconds: 0 };
      const row = data.days[dayKey].users[userId];
      const previous = finiteInteger(row.messages, 0, 0, Number.MAX_SAFE_INTEGER);
      const next = Math.max(previous, finiteInteger(indexedCount, 0, 0, Number.MAX_SAFE_INTEGER));
      if (next > previous) {
        row.messages = next;
        recoveredMessages += next - previous;
        changed = true;
      }
    }
  }
  return { changed, recoveredMessages };
};

const ensureRuntime = (guild, conf = {}) => {
  const id = String(guild.id);
  if (!runtimes.has(id)) runtimes.set(id, {
    guild,
    conf: normalizeConfig(conf),
    timezone: 'Europe/Berlin',
    voiceStates: new Map(),
    lastVoiceTickAt: Date.now(),
    tickTimer: null,
    roleTimer: null,
    panelTimer: null,
    lastPanelAt: 0,
    lastRoleAt: 0,
    lastIndexAttemptAt: 0,
    lastIndexSignature: '',
    indexSyncPromise: null,
    panelRunning: false,
    rolesRunning: false,
    lastError: '',
    lastPanelError: '',
    lastRoleError: ''
  });
  const runtime = runtimes.get(id);
  runtime.guild = guild;
  runtime.conf = normalizeConfig(conf);
  return runtime;
};
const voiceStateRow = (state) => ({
  channelId: String(state?.channelId || ''),
  selfDeaf: state?.selfDeaf === true,
  serverDeaf: state?.serverDeaf === true
});
const hydrateVoiceStates = (runtime) => {
  runtime.voiceStates.clear();
  for (const state of runtime.guild.voiceStates.cache.values()) {
    if (state?.member?.user?.bot) continue;
    runtime.voiceStates.set(String(state.id), voiceStateRow(state));
  }
  runtime.lastVoiceTickAt = Date.now();
};
const voiceEligibility = (runtime, userId, state) => {
  if (!state?.channelId) return false;
  const channel = runtime.guild.channels.cache.get(state.channelId);
  const member = runtime.guild.members.cache.get(userId);
  if (!channel || !member || member.user?.bot || excludedMember(member, runtime.conf) || ignoredChannel(channel, runtime.conf)) return false;
  if (String(runtime.guild.afkChannelId || '') === String(state.channelId)) return false;
  if (runtime.conf.excludeDeafened && (state.selfDeaf || state.serverDeaf)) return false;
  return true;
};
const settleVoice = async (runtime, now = Date.now()) => {
  const elapsed = Math.max(0, Math.min(5 * 60_000, now - Number(runtime.lastVoiceTickAt || now)));
  runtime.lastVoiceTickAt = now;
  if (!runtime.conf.enabled || elapsed < 250) return 0;
  const byChannel = new Map();
  for (const [userId, state] of runtime.voiceStates.entries()) {
    if (!voiceEligibility(runtime, userId, state)) continue;
    if (!byChannel.has(state.channelId)) byChannel.set(state.channelId, []);
    byChannel.get(state.channelId).push(userId);
  }
  const data = await guildData(runtime.guild.id);
  let credited = 0;
  for (const userIds of byChannel.values()) {
    if (userIds.length < runtime.conf.voiceMinimumParticipants) continue;
    for (const userId of userIds) {
      ensureDayUser(data, runtime.timezone, userId, now).voiceMilliseconds += elapsed;
      credited += 1;
    }
  }
  if (credited) {
    data.updatedAt = new Date().toISOString();
    scheduleSave();
  }
  return credited;
};

const reconcileActivityFromServerIndex = async (runtime, { force = false } = {}) => {
  if (!runtime?.conf?.enabled) return null;
  if (runtime.indexSyncPromise) return runtime.indexSyncPromise;
  if (!force && Date.now() - Number(runtime.lastIndexAttemptAt || 0) < INDEX_RECONCILE_MIN_INTERVAL_MS) return null;
  runtime.lastIndexAttemptAt = Date.now();
  runtime.indexSyncPromise = (async () => {
    const data = await guildData(runtime.guild.id);
    const range = indexedBackfillRange(runtime.timezone);
    try {
      await ensureCompleteMemberCache(runtime.guild);
      const indexSnapshot = await getServerIndexSnapshot(runtime.guild.id);
      const signature = `${range.start}:${range.end}:${indexSnapshot?.updatedAt || ''}:${Number(indexSnapshot?.totalMessages || 0)}`;
      if (signature === runtime.lastIndexSignature) return { skipped: true, reason: 'unchanged', ...data.indexBackfill };
      const queryRange = broadUtcRange(range);
      const accumulator = createIndexedChatAccumulator();
      let afterCreatedAt = null;
      let afterMessageId = null;
      while (true) {
        const page = await getServerIndexActivityMessages({
          guildId: runtime.guild.id,
          ...queryRange,
          afterCreatedAt,
          afterMessageId,
          limit: INDEX_PAGE_SIZE
        });
        if (!page.length) break;
        accumulateIndexedChatRecords({
          guild: runtime.guild,
          conf: runtime.conf,
          timezone: runtime.timezone,
          records: page,
          range,
          accumulator
        });
        const last = page[page.length - 1];
        afterCreatedAt = last.createdAt;
        afterMessageId = last.id;
        if (page.length < INDEX_PAGE_SIZE) break;
      }
      const merged = mergeIndexedChatDays(data, accumulator);
      const totalRecoveredMessages = finiteInteger(data.indexBackfill?.totalRecoveredMessages, 0, 0, Number.MAX_SAFE_INTEGER)
        + merged.recoveredMessages;
      data.indexBackfill = {
        rangeStart: range.start,
        rangeEnd: range.end,
        indexUpdatedAt: String(indexSnapshot?.updatedAt || ''),
        completedAt: new Date().toISOString(),
        analyzedMessages: accumulator.analyzedMessages,
        creditedMessages: accumulator.creditedMessages,
        recoveredMessages: merged.recoveredMessages,
        totalRecoveredMessages,
        lastError: ''
      };
      data.updatedAt = new Date().toISOString();
      runtime.lastIndexSignature = signature;
      scheduleSave();
      return { changed: merged.changed, ...data.indexBackfill };
    } catch (error) {
      data.indexBackfill = {
        ...(data.indexBackfill || {}),
        rangeStart: range.start,
        rangeEnd: range.end,
        lastError: String(error?.message || error).slice(0, 500)
      };
      scheduleSave();
      // The live league must remain available even if the historical index is
      // temporarily locked or Discord is still scanning old channels.
      return { changed: false, ...data.indexBackfill };
    }
  })().finally(() => { runtime.indexSyncPromise = null; });
  return runtime.indexSyncPromise;
};

const formatVoice = (milliseconds) => {
  const totalMinutes = Math.floor(Math.max(0, Number(milliseconds || 0)) / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours} Std. ${minutes} Min.` : `${minutes} Min.`;
};
const trophyEmoji = (guild, place) => {
  const definition = TROPHY_EMOJIS[place];
  if (!definition) return '';
  const emoji = guild?.emojis?.cache?.get?.(definition.id)
    || guild?.emojis?.cache?.find?.((entry) => entry?.name === definition.name);
  if (emoji?.id) return `<${emoji.animated ? 'a' : ''}:${emoji.name || definition.name}:${emoji.id}>`;
  return definition.id ? `<:${definition.name}:${definition.id}>` : definition.fallback;
};

/* --------------------------------------------------------------------------
   Platzierungs-Pings · Kanal bei Live-Platzwechseln (Top 1–3)
   --------------------------------------------------------------------------
   Wertet die Rollen-Änderungen eines Reconcile-Laufs aus und pingt die
   betroffenen Mitglieder im konfigurierten Ping-Kanal (Fallback: Ranglisten-
   Kanal): neu in die Top 3 gekommen, auf Platz 1 vorgestoßen oder aus den
   Top 3 verdrängt (mit @Mention des Überholers). Nach den Pings folgt eine
   kurze Erklärung der heutigen Top 3 (Chat + Sprachchat). Alle Nachrichten
   löschen sich nach konfigurierter Zeit selbst. Nutzt die im Bot hochgeladenen
   Trophy-Emojis (trophy1/2/3) mit Fallback-Medals.
   -------------------------------------------------------------------------- */
const periodPingLabel = (period) => ACTIVITY_PERIOD_DEFINITIONS.find((entry) => entry.key === period)?.label || period;
const metricPingLabel = (metric) => ACTIVITY_METRIC_DEFINITIONS.find((entry) => entry.key === metric)?.label || metric;

const buildPlacementRoleMap = (conf) => {
  const map = new Map();
  const roles = configuredAwardRoles(conf);
  for (const period of Object.keys(roles)) {
    for (const metric of Object.keys(roles[period])) {
      roles[period][metric].forEach((roleId, index) => {
        if (roleId) map.set(String(roleId), { roleId: String(roleId), period, metric, place: index + 1 });
      });
    }
  }
  return map;
};

// Verschiedene Satz-Varianten für die Platzierungs-Pings. Pro Ereignis wird per
// Zufall eine Variante gewählt, damit die Nachrichten nicht monoton klingen.
// Jede Pool-Funktion bekommt die Argumente ihrer Kategorie übergeben.
const PING_PHRASES = {
  downrankWithOvertaker: [
    (overtaker, place, scope) => `Du wurdest von ${overtaker} überholt und belegst jetzt **Platz ${place}** in der ${scope}.`,
    (overtaker, place, scope) => `${overtaker} hat dich überholt – du belegst jetzt **Platz ${place}** in der ${scope}.`,
    (overtaker, place, scope) => `Du bist in der ${scope} auf **Platz ${place}** zurückgefallen – überholt von ${overtaker}.`
  ],
  downrank: [
    (place, scope) => `Du wurdest überholt und belegst jetzt **Platz ${place}** in der ${scope}.`,
    (place, scope) => `Du bist in der ${scope} auf **Platz ${place}** zurückgefallen.`
  ],
  uprankFirst: [
    (trophy, scope) => `${trophy} **Platz 1** in der ${scope} – du führst jetzt die Wertung an!`,
    (trophy, scope) => `${trophy} **Platz 1** in der ${scope} – die Spitze gehört jetzt dir!`,
    (trophy, scope) => `${trophy} **Platz 1** in der ${scope} – du bist ganz oben angekommen!`
  ],
  uprank: [
    (trophy, place, scope) => `${trophy} **Platz ${place}** in der ${scope} – du hast dich verbessert. Weiter so!`,
    (trophy, place, scope) => `${trophy} **Platz ${place}** in der ${scope} – stark, du hast dich verbessert!`,
    (trophy, place, scope) => `${trophy} **Platz ${place}** in der ${scope} – ein Platz nach oben, du hast dich verbessert!`
  ],
  newTop3: [
    (trophy, place, scope) => `${trophy} **Platz ${place}** in der ${scope} – willkommen in den Top 3!`,
    (trophy, place, scope) => `${trophy} **Platz ${place}** in der ${scope} – du hast es in die Top 3 geschafft!`,
    (trophy, place, scope) => `${trophy} **Platz ${place}** in der ${scope} – neu dabei in den Top 3!`
  ],
  displaced: [
    (scope, overtaker) => `Du wurdest in der ${scope} aus den Top 3 verdrängt${overtaker ? ` – deinen Platz hat ${overtaker} übernommen` : ''}. Hol dir deinen Platz zurück!`,
    (scope, overtaker) => `Du bist in der ${scope} aus den Top 3 gefallen${overtaker ? ` – ${overtaker} hat deinen Platz übernommen` : ''}. Gib nicht auf!`,
    (scope, overtaker) => `Dein Platz in den Top 3 der ${scope} ist weg${overtaker ? ` – übernommen von ${overtaker}` : ''}. Hol dir deinen Platz zurück!`
  ]
};

const pickPhrase = (pool, random = Math.random) => {
  const variants = Array.isArray(pool) ? pool : [];
  return variants[Math.floor(random() * variants.length)] ?? variants[0];
};

const placementPingLines = (runtime, changes, conf) => {
  if (!conf?.placementPings) return [];
  const roleMap = buildPlacementRoleMap(conf);
  // Wer hat in diesem Lauf welche Platz-Rolle gewonnen? Daraus lässt sich beim
  // Abstieg der Überholer ableiten (die Person, die den alten Platz übernimmt).
  const roleWonBy = new Map();
  for (const change of changes || []) {
    for (const roleId of change?.addedRoleIds || []) {
      if (roleMap.has(String(roleId))) roleWonBy.set(String(roleId), change.userId);
    }
  }
  const lines = [];
  for (const change of changes || []) {
    if (!change?.userId || change.userId === runtime.guild.id) continue;
    const gained = (change.addedRoleIds || [])
      .map((roleId) => roleMap.get(String(roleId)))
      .filter(Boolean)
      .sort((left, right) => left.place - right.place);
    const lost = (change.removedRoleIds || [])
      .map((roleId) => roleMap.get(String(roleId)))
      .filter(Boolean);
    const lostByScope = new Map();
    for (const entry of lost) lostByScope.set(`${entry.period}.${entry.metric}`, entry);
    const lostScopes = new Set(lost.map((entry) => `${entry.period}.${entry.metric}`));
    const gainedScopes = new Set(gained.map((entry) => `${entry.period}.${entry.metric}`));
    for (const placement of gained) {
      const scopeKey = `${placement.period}.${placement.metric}`;
      const scope = `${periodPingLabel(placement.period)} · ${metricPingLabel(placement.metric)}`;
      const trophy = trophyEmoji(runtime.guild, placement.place) || TROPHY_EMOJIS[placement.place]?.fallback || '';
      const previous = lostByScope.get(scopeKey);
      let headline;
      if (previous && previous.place < placement.place) {
        // Abstieg: Der alte Platz war besser, der neue schlechter. Der Überholer
        // wird direkt in den Satz eingebaut (@Mention) statt als Anhang.
        const overtakerId = roleWonBy.get(String(previous.roleId));
        const overtaker = overtakerId && String(overtakerId) !== String(change.userId)
          ? `<@${overtakerId}>`
          : '';
        headline = `⚠️ ${overtaker
          ? pickPhrase(PING_PHRASES.downrankWithOvertaker)(overtaker, placement.place, scope)
          : pickPhrase(PING_PHRASES.downrank)(placement.place, scope)}`;
      // Hinweis: Das Warn-Emoji ⚠️ steht bewusst außerhalb der Abstiegs-Pools,
      // weil es ein fester Hinweis ist – nur der Satz selbst variiert. Die
      // Trophys dagegen stecken in den Aufstiegs-Pools, weil sie je Platz wechseln.
      } else if (previous && previous.place > placement.place) {
        // Aufstieg innerhalb der Top 3 – auch Platz 1 wird hier gekrönt.
        headline = placement.place === 1
          ? pickPhrase(PING_PHRASES.uprankFirst)(trophy, scope)
          : pickPhrase(PING_PHRASES.uprank)(trophy, placement.place, scope);
      } else {
        // Neu in den Top 3 oder gleicher Platz.
        headline = placement.place === 1
          ? pickPhrase(PING_PHRASES.uprankFirst)(trophy, scope)
          : pickPhrase(PING_PHRASES.newTop3)(trophy, placement.place, scope);
      }
      lines.push({ userId: change.userId, headline, scope, place: placement.place });
    }
    // Verdrängungen ohne neuen Platz in derselben Wertung.
    for (const scopeKey of lostScopes) {
      if (gainedScopes.has(scopeKey)) continue;
      const placement = lostByScope.get(scopeKey);
      const scope = `${periodPingLabel(placement.period)} · ${metricPingLabel(placement.metric)}`;
      const overtakerId = roleWonBy.get(String(placement.roleId));
      const overtaker = overtakerId && String(overtakerId) !== String(change.userId)
        ? `<@${overtakerId}>`
        : '';
      lines.push({
        userId: change.userId,
        headline: pickPhrase(PING_PHRASES.displaced)(scope, overtaker),
        scope,
        place: 0
      });
    }
  }
  return lines;
};

const rankValueText = (metric, value) => metric === 'messages'
  ? `${Number(value || 0).toLocaleString('de-DE')} Nachrichten`
  : formatVoice(value);
const rankingBlock = (runtime, rows, metric, label) => {
  if (!rows?.length) return [];
  return [`${label}:`, ...rows.slice(0, 3).map((entry, index) =>
    `${trophyEmoji(runtime.guild, index + 1) || `${index + 1}.`} <@${entry.userId}> – ${rankValueText(metric, entry.value)}`)];
};
const formatDateKey = (key) => {
  const parts = String(key || '').split('-');
  return parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : String(key || '');
};

/* Abschluss-Ankündigung: Wenn eine Kalenderwoche oder ein Kalendermonat
   vollständig abgeschlossen ist, werden die Sieger der Wertung verkündet.
   Erwartet das Awards-Snapshot (weekly/monthly = completedPeriodSnapshot). */
const buildCompletionAnnouncement = (runtime, awards, period) => {
  if (period === 'daily') return null;
  const rank = awards?.periods?.[period];
  if (!rank || rank.fullyTracked !== true) return null;
  const chat = (rank.chat || []).slice(0, 3);
  const voice = (rank.voice || []).slice(0, 3);
  if (!chat.length && !voice.length) return null;
  const header = period === 'weekly'
    ? '🏆 **Kalenderwoche abgeschlossen – die Sieger stehen fest!**'
    : '🏆 **Kalendermonat abgeschlossen – die Sieger stehen fest!**';
  const range = `*(${formatDateKey(rank.start)} – ${formatDateKey(rank.end)})*`;
  const parts = [
    ...rankingBlock(runtime, chat, 'messages', '💬 **Chat**'),
    ...rankingBlock(runtime, voice, 'voiceMilliseconds', '🔊 **Sprachchat**')
  ];
  return `${header}\n${range}\n\n${parts.join('\n')}`;
};

const announcementChannel = (guild, conf) => {
  const configured = String(conf?.announcementChannelId || '').trim();
  const channel = configured ? guild?.channels?.cache?.get?.(configured) : null;
  if (channel?.isTextBased?.()) return channel;
  // Kein eigener Ankündigungs-Kanal konfiguriert oder ungültig: Fallback auf den Ranglisten-Kanal.
  return panelChannel(guild, conf);
};

/* Sendet die Abschluss-Ankündigung für jede soeben abgeschlossene Woche bzw.
   jeden abgeschlossenen Monat – genau einmal pro Zeitraum (persistiert in
   data.announcedPeriods). Ankündigungen sind Meilensteine und bleiben stehen. */
const announceCompletedPeriods = async (runtime, data, awards, conf) => {
  if (conf?.announceCompletedPeriods === false) return 0;
  const channel = announcementChannel(runtime.guild, conf);
  if (!channel) return 0;
  let sent = 0;
  for (const period of ['weekly', 'monthly']) {
    const rank = awards?.periods?.[period];
    const endKey = rank?.fullyTracked ? String(rank.end || '') : '';
    if (!endKey || data.announcedPeriods?.[period] === endKey) continue;
    const announcement = buildCompletionAnnouncement(runtime, awards, period);
    if (!announcement) continue;
    try {
      await channel.send({ content: announcement });
      data.announcedPeriods ||= {};
      data.announcedPeriods[period] = endKey;
      sent += 1;
    } catch {
      // Kanal nicht erreichbar – der Zeitraum wird beim nächsten Lauf erneut versucht.
    }
  }
  if (sent > 0) scheduleSave();
  return sent;
};

const placementPingChannel = (guild, conf) => {
  const configured = String(conf?.placementPingChannelId || '').trim();
  const channel = configured ? guild?.channels?.cache?.get?.(configured) : null;
  if (channel?.isTextBased?.()) return channel;
  // Kein eigener Ping-Kanal konfiguriert oder ungültig: Fallback auf den Ranglisten-Kanal.
  return panelChannel(guild, conf);
};

const sendPlacementPings = async (runtime, changes, conf, options = {}) => {
  const lines = placementPingLines(runtime, changes, conf);
  if (!lines.length) return 0;
  const lifetimeSeconds = Number.isFinite(options.lifetimeSeconds)
    ? Math.max(0, Number(options.lifetimeSeconds))
    : Number.isFinite(conf?.placementPingLifetimeMinutes)
      ? conf.placementPingLifetimeMinutes * 60
      : PING_AUTO_DELETE_MS / 1000;
  const autoDeleteMs = lifetimeSeconds * 1000;
  // Die Pings erscheinen im konfigurierten Ping-Kanal (oder im Ranglisten-Kanal)
  // und erwähnen die betroffenen Mitglieder. Mehrere Änderungen derselben Person
  // in einem Lauf werden zu einer Nachricht gebündelt, damit der Kanal lesbar bleibt.
  const channel = placementPingChannel(runtime.guild, conf);
  if (!channel) return 0;
  const byUser = new Map();
  for (const line of lines) {
    if (!byUser.has(line.userId)) byUser.set(line.userId, []);
    byUser.get(line.userId).push(line.headline);
  }
  let sent = 0;
  for (const [userId, headlines] of byUser.entries()) {
    const member = runtime.guild.members.cache.get(userId);
    if (!member || member.user?.bot) continue;
    try {
      const message = await channel.send({
        content: `<@${userId}> ${headlines.join(' ')}`
      });
      // Nachrichten löschen sich selbst, damit der Kanal nicht mit Pings vollläuft.
      const deleteTimer = setTimeout(() => {
        message.delete().catch(() => null);
      }, autoDeleteMs);
      deleteTimer.unref?.();
      sent += 1;
    } catch {
      // Kanal nicht erreichbar – still ignorieren.
    }
  }
  return sent;
};
const rankingLines = (guild, rows, metric, emptyText = 'Noch keine Aktivität erfasst.') => {
  if (!rows?.length) return `*${emptyText}*`;
  return rows.slice(0, 3).map((entry, index) => {
    const value = metric === 'messages' ? `${entry.value.toLocaleString('de-DE')} Nachrichten` : formatVoice(entry.value);
    return `${trophyEmoji(guild, index + 1)} <@${entry.userId}>\n> **${value}**`;
  }).join('\n\n');
};
const panelColorNumber = (value, fallback) => {
  const normalized = safeColor(value, '').replace('#', '');
  const parsed = Number.parseInt(normalized, 16);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const formatPanelText = (value, context, maximum) => String(value || '')
  .replaceAll('{server}', context.server)
  .replaceAll('{period}', context.period)
  .replaceAll('{status}', context.status)
  .replaceAll('{completion}', context.completion)
  .replaceAll('{range}', context.range)
  .replaceAll('{nextEvaluation}', context.nextEvaluation)
  .slice(0, maximum);
const buildPanelNavigation = (selected) => new ActionRowBuilder().addComponents(
  new ButtonBuilder()
    .setCustomId(`${PANEL_PREFIX}rules`)
    .setLabel('REGELN')
    .setStyle(selected === 'rules' ? ButtonStyle.Primary : ButtonStyle.Secondary),
  new ButtonBuilder()
    .setCustomId(`${PANEL_PREFIX}personal`)
    .setLabel('MEIN RANG')
    .setStyle(selected === 'personal' ? ButtonStyle.Primary : ButtonStyle.Secondary)
);

/* Einzelnes Perioden-Embed für das neue 3-Embeds-Layout.
   Heute wird immer gerendert; Woche und Monat nur, wenn ein vollständig
   abgeschlossener Kalenderzeitraum vorliegt (fullyTracked). */
const buildPeriodEmbed = (guild, snapshot, period) => {
  const meta = PERIODS[period];
  const rank = snapshot.periods[period];
  const unavailable = period !== 'daily' && rank?.fullyTracked !== true;
  if (unavailable) return null;
  const completion = period === 'daily'
    ? PERIOD_COMPLETION_COPY.daily
    : period === 'weekly'
      ? 'Diese Kalenderwoche ist abgeschlossen – die Rollen für Platz 1–3 wurden vergeben.'
      : 'Dieser Kalendermonat ist abgeschlossen – die Rollen für Platz 1–3 wurden vergeben.';
  const context = {
    server: guild?.name || 'FALLEN HEAVEN',
    period: meta.title,
    status: period === 'daily' ? 'Live-Zwischenstand' : 'Abgeschlossen',
    completion,
    range: `${rank.start} – ${rank.end}`,
    nextEvaluation: nextPeriodLabel(period, snapshot.timezone)
  };
  const design = normalizePanelDesign(snapshot.panelDesign);
  const emptyRankingText = 'Noch keine Aktivität erfasst.';
  const embed = new EmbedBuilder()
    .setColor(panelColorNumber(design.embed.color, meta.color))
    .addFields(
      { name: 'CHAT', value: rankingLines(guild, rank.chat, 'messages', emptyRankingText), inline: true },
      { name: 'SPRACHCHAT', value: rankingLines(guild, rank.voice, 'voiceMilliseconds', emptyRankingText), inline: true },
      { name: 'NÄCHSTE AUSWERTUNG', value: context.nextEvaluation, inline: true },
      { name: 'ZEITRAUM', value: context.range, inline: true }
    );
  // Die Embed-Studio-Vorlage gilt für jedes Perioden-Embed; {period}, {status},
  // {range} usw. werden pro Zeitraum ersetzt. Abgeschlossene Woche/Monat erhalten
  // zusätzlich einen klaren Hinweis auf die Rollenvergabe.
  const title = formatPanelText(design.embed.title, context, 256);
  const description = formatPanelText(design.embed.description, context, 4_096);
  const authorName = formatPanelText(design.embed.authorName, context, 256);
  const footerText = formatPanelText(design.embed.footerText, context, 2_048);
  if (title) embed.setTitle(title);
  if (title && design.embed.url) embed.setURL(design.embed.url);
  if (description) embed.setDescription(description);
  if (authorName) embed.setAuthor({
    name: authorName,
    iconURL: design.embed.authorIconUrl || guild.iconURL?.({ size: 128 }) || undefined
  });
  if (design.embed.thumbnailUrl) embed.setThumbnail(design.embed.thumbnailUrl);
  if (design.embed.imageUrl) embed.setImage(design.embed.imageUrl);
  if (footerText) embed.setFooter({ text: footerText, iconURL: design.embed.footerIconUrl || undefined });
  if (design.embed.timestamp) embed.setTimestamp(new Date(snapshot.measuredAt));
  if (design.embed.fields.length) {
    embed.addFields(design.embed.fields.map((field) => ({
      name: formatPanelText(field.name, context, 256) || '\u200b',
      value: formatPanelText(field.value, context, 1_024) || '\u200b',
      inline: field.inline === true
    })));
  }
  if (period !== 'daily') {
    const note = period === 'weekly'
      ? 'Abgeschlossene Kalenderwoche · Rollen wurden vergeben'
      : 'Abgeschlossener Kalendermonat · Rollen wurden vergeben';
    // Die Vorlage kann {completion} bereits enthalten – dann nicht doppelt anhängen.
    const completionNote = `\n\n**${completion}**`;
    embed.setDescription(description.includes(completion) ? description : `${description}${completionNote}`);
    embed.setFooter({ text: note, iconURL: design.embed.footerIconUrl || undefined });
  }
  return embed;
};
const buildPanelPayload = (guild, snapshot, options = {}) => {
  // Neues Layout: Heute wird immer angezeigt, Woche und Monat nur dann, wenn
  // ein vollständig abgeschlossener Kalenderzeitraum vorliegt. Leere Zeiträume
  // werden nicht mehr als Platzhalter befüllt.
  const embeds = ['daily', 'weekly', 'monthly']
    .map((key) => buildPeriodEmbed(guild, snapshot, key))
    .filter(Boolean);
  const design = normalizePanelDesign(snapshot.panelDesign);
  const context = {
    server: guild?.name || 'FALLEN HEAVEN',
    period: PERIODS.daily.title,
    status: 'Live-Zwischenstand',
    completion: PERIOD_COMPLETION_COPY.daily,
    range: `${snapshot.periods.daily?.start || '?'} – ${snapshot.periods.daily?.end || '?'}`,
    nextEvaluation: nextPeriodLabel('daily', snapshot.timezone)
  };
  const savedAttachment = normalizePanelAttachment(design.outsideImageAttachment);
  const preserveAttachment = options.preserveAttachment === true && savedAttachment;
  const content = [
    formatPanelText(design.content, context, 2_000),
    options.outsideFile || preserveAttachment ? '' : design.outsideImageUrl
  ].filter(Boolean).join('\n').slice(0, 2_000);
  const payload = {
    content: content || undefined,
    embeds,
    components: [buildPanelNavigation('daily')],
    allowedMentions: { parse: [] }
  };
  if (options.outsideFile) {
    payload.files = [{ attachment: options.outsideFile, name: options.outsideFileName || 'fallen-heaven-activity.png' }];
    payload.attachments = [];
  } else if (preserveAttachment) {
    payload.attachments = [{ id: savedAttachment.id }];
  } else if (options.removeOutsideImage === true) {
    payload.attachments = [];
  }
  return payload;
};

const personalRankingField = (rows, userId, metric) => {
  const entry = rows?.find?.((row) => String(row.userId) === String(userId));
  if (!entry) return 'Noch keine belastbare Platzierung verfügbar.';
  const value = metric === 'messages'
    ? `${Number(entry.value || 0).toLocaleString('de-DE')} ${Number(entry.value || 0) === 1 ? 'Nachricht' : 'Nachrichten'}`
    : formatVoice(entry.value);
  const tied = rows.filter((row) => Number(row.value || 0) === Number(entry.value || 0)).length;
  const tie = tied > 1 ? `\nGleichstand mit ${tied - 1} ${tied === 2 ? 'weiteren Person' : 'weiteren Personen'}.` : '';
  const inactive = Number(entry.value || 0) > 0 ? '' : '\nHeute wurde in dieser Kategorie noch keine Aktivität gewertet.';
  return `Platz **${Number(entry.rank || 0)} von ${rows.length}**\n> **${value}**${tie}${inactive}`;
};

const buildPersonalRankPayload = (guild, snapshot, userId) => {
  const daily = snapshot?.periods?.daily || {};
  const member = guild?.members?.cache?.get?.(String(userId));
  const embed = new EmbedBuilder()
    .setColor(PERIODS.daily.color)
    .setTitle('Dein heutiger Liga-Stand')
    .setDescription('Deine persönliche Platzierung unter allen aktuellen Mitgliedern. Der Tagesstand reagiert live auf neue gewertete Aktivität.')
    .addFields(
      { name: 'CHAT-RANG', value: personalRankingField(daily.fullChat || [], userId, 'messages'), inline: true },
      { name: 'SPRACHCHAT-RANG', value: personalRankingField(daily.fullVoice || [], userId, 'voiceMilliseconds'), inline: true },
      { name: 'ZEITRAUM', value: `${daily.start || '?'} – ${daily.end || '?'}`, inline: false }
    )
    .setFooter({ text: 'Nur du siehst diese Ansicht · Gleichstände erhalten denselben Rang' })
    .setTimestamp(new Date(snapshot.measuredAt || Date.now()));
  const avatarUrl = resolveActivityRaceAvatar(member, { size: 128, extension: 'png' });
  if (avatarUrl) embed.setThumbnail(avatarUrl);
  return {
    embeds: [embed],
    components: [buildPanelNavigation('personal')],
    allowedMentions: { parse: [] }
  };
};
const buildRulesPayload = (guild, conf, timezone) => {
  const embed = new EmbedBuilder()
    .setColor(0x6f7cff)
    .setAuthor({ name: 'FALLEN HEAVEN · AKTIVITÄTS-LIGA', iconURL: guild.iconURL?.({ size: 128 }) || undefined })
    .setTitle('Regeln und Wertung')
    .setDescription('Diese private Übersicht erklärt, welche Aktivität zählt und wann Rollen vergeben werden.')
    .addFields(
      {
        name: 'CHAT',
        value: `• Mindestens **${conf.minimumMessageLength} Buchstaben oder Zahlen**\n• Anhänge und Sticker zählen als Inhalt\n• Pro Person höchstens eine Wertung alle **${conf.messageCooldownSeconds} Sekunden**\n• Identische Nachrichten zählen innerhalb von **${conf.duplicateWindowMinutes} Minuten** nur einmal\n• Bots, Webhooks sowie ausgeschlossene Kanäle und Rollen zählen nicht`
      },
      {
        name: 'SPRACHCHAT',
        value: `• Mindestens **${conf.voiceMinimumParticipants} wertbare Personen** gemeinsam im Kanal\n• AFK-Kanal zählt nicht\n• Bots und ausgeschlossene Kanäle oder Rollen zählen nicht\n• Vollständig taube Zeit zählt ${conf.excludeDeafened ? '**nicht**' : '**mit**'}; normales Stummschalten ist erlaubt`
      },
      {
        name: 'ZEITRÄUME',
        value: `• **Tag:** 00:00 bis 23:59 Uhr\n• **Woche:** Montag bis Sonntag\n• **Monat:** vollständiger Kalendermonat\n• Zeitzone: **${timezone}**`
      },
      {
        name: 'ROLLENVERGABE',
        value: '• **Tageswertung:** Platz 1, 2 und 3 erhalten ihre Rollen live; beim Überholen wechseln die Rollen automatisch\n• **Wochenwertung:** Rollen erst nach einer vollständig erfassten Kalenderwoche\n• **Monatswertung:** Rollen erst nach einem vollständig erfassten Kalendermonat\n• Die **Trennerrolle** wird mit jeder Liga-Auszeichnung automatisch vergeben und nach der letzten Auszeichnung wieder entzogen\n• Unvollständig erfasste Wochen oder Monate werden sicher übersprungen\n• Abgeschlossene Wochen- und Monatssieger behalten ihre Rolle bis zur nächsten gültigen Endwertung'
      }
    )
    .setFooter({ text: 'Diese Ansicht ist nur für dich sichtbar.' });
  return { embeds: [embed], components: [buildPanelNavigation('rules')], allowedMentions: { parse: [] } };
};

const normalizedChannelName = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('de-DE').replace(/[^a-z0-9]/g, '');
const panelChannel = (guild, conf) => {
  const allowed = (channel) => channel && [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(Number(channel.type)) && channel.isTextBased?.();
  const configured = guild.channels.cache.get(String(conf.panelChannelId || ''));
  if (allowed(configured)) return configured;
  const channels = [...guild.channels.cache.values()].filter(allowed);
  return channels.find((channel) => normalizedChannelName(channel.name) === 'aktivitatliga')
    || channels.find((channel) => normalizedChannelName(channel.name).includes('aktivitatliga'))
    || null;
};
const hasCompleteRoleSet = (conf) => ACTIVITY_RACE_ROLE_DEFINITIONS.every((definition) => String(conf?.[definition.key] || '').trim());
const validatePanelPermissions = (channel) => {
  const permissions = channel.permissionsFor?.(channel.guild.members.me);
  const required = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory];
  if (!permissions || required.some((permission) => !permissions.has(permission, false))) throw new Error('Dem Bot fehlen im Ranglisten-Kanal Anzeigen, Schreiben, Einbetten oder Nachrichtenverlauf.');
};
const ensurePanel = async (runtime, {
  force = false,
  outsideFile = null,
  outsideFileName = '',
  removeOutsideImage = false
} = {}) => {
  if (!runtime.conf.enabled || !hasCompleteRoleSet(runtime.conf) || runtime.panelRunning) return null;
  if (!force && Date.now() - runtime.lastPanelAt < 55_000) return null;
  runtime.panelRunning = true;
  try {
    await reconcileActivityFromServerIndex(runtime);
    await settleVoice(runtime);
    const data = await guildData(runtime.guild.id);
    if (!runtime.conf.panelChannelId) await runtime.guild.channels.fetch().catch(() => null);
    const channel = panelChannel(runtime.guild, runtime.conf);
    if (!channel) throw new Error('Der Textkanal „aktivität-liga“ wurde nicht gefunden. Du kannst alternativ einen Kanal auswählen.');
    validatePanelPermissions(channel);
    const snapshot = buildPanelSnapshot(runtime.guild, data, runtime.conf, runtime.timezone);
    let message = null;
    if (data.panel.messageId && data.panel.channelId === channel.id) message = await channel.messages.fetch(data.panel.messageId).catch(() => null);
    const payload = buildPanelPayload(runtime.guild, snapshot, {
      outsideFile,
      outsideFileName,
      removeOutsideImage: removeOutsideImage || Boolean(message && !runtime.conf.panelDesign?.outsideImageAttachment),
      preserveAttachment: Boolean(message && !outsideFile && !removeOutsideImage)
    });
    if (!message) {
      if (data.panel.messageId && data.panel.channelId && data.panel.channelId !== channel.id) {
        const oldChannel = runtime.guild.channels.cache.get(data.panel.channelId);
        await oldChannel?.messages?.fetch?.(data.panel.messageId).then((oldMessage) => oldMessage.delete()).catch(() => null);
      }
      message = await channel.send(payload);
      data.panel = { channelId: channel.id, messageId: message.id };
      scheduleSave();
    } else await message.edit(payload);
    runtime.lastPanelAt = Date.now();
    runtime.lastPanelError = '';
    const attachment = message.attachments?.first?.();
    return {
      channelId: channel.id,
      messageId: message.id,
      snapshot,
      outsideImageAttachment: attachment ? {
        id: String(attachment.id || ''),
        url: String(attachment.url || ''),
        name: String(attachment.name || outsideFileName || 'fallen-heaven-activity.png'),
        size: Number(attachment.size || 0)
      } : null
    };
  } catch (error) {
    runtime.lastPanelError = String(error?.message || error).slice(0, 500);
    throw error;
  } finally {
    runtime.panelRunning = false;
  }
};

const configuredAwardRoles = (conf) => Object.fromEntries(Object.keys(PERIODS).map((period) => [period, {
  chat: [1, 2, 3].map((place) => conf[placementRoleKey(period, 'Chat', place)]),
  voice: [1, 2, 3].map((place) => conf[placementRoleKey(period, 'Voice', place)])
}]));
const buildRoleAssignmentPlan = (conf, awards) => {
  const roles = configuredAwardRoles(conf);
  const separatorRoleId = String(conf?.separatorRoleId || '').trim();
  const desiredByRole = new Map();
  for (const period of Object.keys(PERIODS)) {
    for (const metric of ['chat', 'voice']) {
      const winners = awards?.periods?.[period]?.[`${metric}WinnerIds`] || [];
      roles[period][metric].forEach((roleId, index) => {
        if (roleId) desiredByRole.set(String(roleId), String(winners[index] || ''));
      });
    }
  }
  const desiredRolesByUser = new Map();
  for (const [roleId, userId] of desiredByRole.entries()) {
    if (!userId) continue;
    if (!desiredRolesByUser.has(userId)) desiredRolesByUser.set(userId, []);
    desiredRolesByUser.get(userId).push(roleId);
  }
  if (separatorRoleId) {
    for (const wanted of desiredRolesByUser.values()) {
      if (!wanted.includes(separatorRoleId)) wanted.push(separatorRoleId);
    }
  }
  return {
    roles,
    separatorRoleId,
    desiredByRole,
    desiredRolesByUser,
    managedRoleIds: [...new Set([...desiredByRole.keys(), separatorRoleId].filter(Boolean))]
  };
};
const configuredRoleSetIds = (conf) => ACTIVITY_RACE_ROLE_DEFINITIONS
  .map((definition) => String(conf?.[definition.key] || '').trim())
  .filter(Boolean);
const validateConfiguredRoleSet = async (runtime) => {
  const ids = configuredRoleSetIds(runtime.conf);
  if (ids.length !== ACTIVITY_RACE_ROLE_DEFINITIONS.length) {
    throw new Error('Das Aktivitäts-Liga-Rollenset ist unvollständig. Prüfe alle 19 Rollen im Modul.');
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error('Im Aktivitäts-Liga-Rollenset ist dieselbe Discord-Rolle mehrfach ausgewählt.');
  }
  if (ids.some((roleId) => !runtime.guild.roles.cache.has(roleId))) await runtime.guild.roles.fetch();
  const missing = ids.filter((roleId) => !runtime.guild.roles.cache.has(roleId));
  if (missing.length) throw new Error(`Aktivitäts-Liga-Rollen wurden auf Discord nicht gefunden: ${missing.join(', ')}`);
  const botMember = runtime.guild.members.me || await runtime.guild.members.fetchMe();
  if (!botMember?.permissions?.has?.(PermissionFlagsBits.ManageRoles)) throw new Error('Dem Bot fehlt „Rollen verwalten“.');
  const blocked = ids
    .map((roleId) => runtime.guild.roles.cache.get(roleId))
    .filter((role) => role?.managed || !role?.editable || Number(role?.position || 0) >= Number(botMember.roles?.highest?.position || 0));
  if (blocked.length) {
    throw new Error(`Diese Aktivitäts-Liga-Rollen liegen über der Bot-Rolle oder sind nicht verwaltbar: ${blocked.map((role) => `„${role.name}“`).join(', ')}`);
  }
  return ids;
};
const clearAwardRoles = async (runtime, sourceConf = runtime.conf) => {
  const roleIds = [...new Set([
    String(sourceConf?.separatorRoleId || '').trim(),
    ...Object.values(configuredAwardRoles(sourceConf)).flatMap((entry) => [...entry.chat, ...entry.voice])
  ].filter(Boolean))];
  if (!roleIds.length) return { removed: 0, errors: [] };
  let removed = 0;
  const errors = [];
  for (const member of runtime.guild.members.cache.values()) {
    const active = roleIds.filter((roleId) => member.roles.cache.has(roleId));
    if (!active.length || member.user?.bot) continue;
    try {
      const result = await applyManagedRolePolicy({
        member,
        removeRoleIds: active,
        reason: 'FALLEN HEAVEN Aktivitäts-Liga deaktiviert',
        verify: true,
        requireAll: false
      });
      removed += result.removedRoleIds.length;
    } catch (error) {
      errors.push({ userId: member.id, error: String(error?.message || error).slice(0, 300) });
    }
  }
  return { removed, errors };
};
const removePanel = async (runtime) => {
  const data = await guildData(runtime.guild.id);
  if (!data.panel.messageId) return false;
  const channel = runtime.guild.channels.cache.get(data.panel.channelId);
  const message = await channel?.messages?.fetch?.(data.panel.messageId).catch(() => null);
  if (message?.author?.id === runtime.guild.members.me?.id) await message.delete().catch(() => null);
  data.panel = { channelId: '', messageId: '' };
  scheduleSave();
  return true;
};
const reconcileRoles = async (runtime, { force = false } = {}) => {
  if (!runtime.conf.enabled || !hasCompleteRoleSet(runtime.conf) || runtime.rolesRunning) return null;
  if (!force && Date.now() - runtime.lastRoleAt < 25_000) return null;
  runtime.rolesRunning = true;
  try {
    await reconcileActivityFromServerIndex(runtime);
    await settleVoice(runtime);
    const data = await guildData(runtime.guild.id);
    ensureTrackingWindow(data, runtime.timezone);
    const snapshot = buildSnapshot(runtime.guild, data, runtime.conf, runtime.timezone);
    const awards = buildAwardSnapshot(runtime.guild, data, runtime.conf, runtime.timezone);
    await validateConfiguredRoleSet(runtime);
    const { desiredRolesByUser, managedRoleIds } = buildRoleAssignmentPlan(runtime.conf, awards);
    const affected = new Set([...desiredRolesByUser.keys()]);
    for (const member of runtime.guild.members.cache.values()) {
      if (managedRoleIds.some((roleId) => member.roles.cache.has(roleId))) affected.add(member.id);
    }
    const changes = [];
    const errors = [];
    for (const userId of affected) {
      const member = runtime.guild.members.cache.get(userId);
      if (!member || member.user?.bot) continue;
      const wanted = desiredRolesByUser.get(userId) || [];
      const remove = managedRoleIds.filter((roleId) => member.roles.cache.has(roleId) && !wanted.includes(roleId));
      try {
        const result = await applyManagedRolePolicy({
          member,
          addRoleIds: wanted,
          removeRoleIds: remove,
          reason: 'FALLEN HEAVEN Aktivitäts-Liga · Live-Tag und abgeschlossene Langzeitwertung',
          verify: true,
          requireAll: false
        });
        if (result.changed) changes.push({ userId, addedRoleIds: result.addedRoleIds, removedRoleIds: result.removedRoleIds });
        for (const blocked of result.blocked || []) {
          errors.push({ userId, roleId: blocked.roleId, error: String(blocked.reason || 'Rolle konnte nicht verwaltet werden.').slice(0, 300) });
        }
      } catch (error) {
        errors.push({ userId, error: String(error?.message || error).slice(0, 300) });
      }
    }
    // Der erste Lauf nach Start/Aktivierung ist die Baseline: Die Rollen werden
    // erstmals synchronisiert und lösen bewusst keine Platzierungs-Pings aus.
    if (changes.length && runtime.placementPingReady) {
      await sendPlacementPings(runtime, changes, runtime.conf);
    }
    runtime.placementPingReady = true;
    // Soeben abgeschlossene Woche/Monat einmalig ankündigen (Sieger + Trophys).
    // Erst nach dem Rollen-Abgleich, damit ein Fehler oben nicht den Zeitraum
    // als 'angekündigt' verbrennt – beim nächsten Lauf wird erneut versucht.
    await announceCompletedPeriods(runtime, data, awards, runtime.conf);
    let holdersChanged = false;
    for (const period of Object.keys(PERIODS)) {
      const nextHolders = {
        chat: awards.periods[period].chatWinnerIds,
        voice: awards.periods[period].voiceWinnerIds
      };
      const nextRange = { start: awards.periods[period].start, end: awards.periods[period].end };
      if (JSON.stringify(data.holders[period]) !== JSON.stringify(nextHolders)
        || JSON.stringify(data.holderRanges?.[period]) !== JSON.stringify(nextRange)) holdersChanged = true;
      data.holders[period] = nextHolders;
      data.holderRanges ||= {};
      data.holderRanges[period] = nextRange;
    }
    if (holdersChanged) {
      data.updatedAt = new Date().toISOString();
      scheduleSave();
    }
    runtime.lastRoleAt = Date.now();
    runtime.lastRoleError = errors[0]?.error || '';
    return { changes, errors, snapshot, awards };
  } catch (error) {
    runtime.lastRoleError = String(error?.message || error).slice(0, 500);
    throw error;
  } finally {
    runtime.rolesRunning = false;
  }
};

const scheduleRoleReconcile = (runtime) => {
  if (runtime.roleTimer) return;
  runtime.roleTimer = setTimeout(() => void reconcileRoles(runtime, { force: true }).catch((error) => {
    runtime.lastRoleError = String(error?.message || error).slice(0, 500);
  }).finally(() => { runtime.roleTimer = null; }), ROLE_RECONCILE_DEBOUNCE_MS);
  runtime.roleTimer.unref?.();
};
const schedulePanelRefresh = (runtime) => {
  if (runtime.panelTimer) return;
  runtime.panelTimer = setTimeout(() => {
    runtime.panelTimer = null;
    void ensurePanel(runtime, { force: true }).catch(() => null);
  }, PANEL_REFRESH_DEBOUNCE_MS);
  runtime.panelTimer.unref?.();
};
const startRuntime = (runtime) => {
  clearInterval(runtime.tickTimer);
  runtime.tickTimer = setInterval(() => {
    void reconcileActivityFromServerIndex(runtime).then(() => settleVoice(runtime)).then(() => {
      scheduleRoleReconcile(runtime);
      schedulePanelRefresh(runtime);
      void guildData(runtime.guild.id).then((data) => { if (pruneOldDays(data, runtime.timezone)) scheduleSave(); });
    }).catch((error) => { runtime.lastError = String(error?.message || error).slice(0, 500); });
  }, TICK_MS);
  runtime.tickTimer.unref?.();
};

const rolePlanSignature = (guildId, conf, entries) => JSON.stringify({ guildId, names: entries.map((entry) => [entry.key, entry.name, entry.action, entry.roleId]), ids: ACTIVITY_RACE_ROLE_DEFINITIONS.map((definition) => conf[definition.key]) });
const cleanExpiredRolePlans = () => {
  const now = Date.now();
  for (const [token, plan] of rolePlans.entries()) if (plan.expiresAt <= now) rolePlans.delete(token);
};
export const previewActivityRaceRoleSet = async ({ guild, conf = {} } = {}) => {
  if (!guild) throw new Error('Server wurde nicht gefunden.');
  cleanExpiredRolePlans();
  await guild.roles.fetch().catch(() => null);
  const normalized = normalizeConfig(conf);
  const botMember = guild.members.me || await guild.members.fetchMe();
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) throw new Error('Dem Bot fehlt „Rollen verwalten“.');
  const entries = ACTIVITY_RACE_ROLE_DEFINITIONS.map((definition) => {
    const configured = normalized[definition.key] ? guild.roles.cache.get(normalized[definition.key]) : null;
    const exact = !configured ? guild.roles.cache.find((role) => !role.managed && role.name === normalized[definition.nameKey] && role.editable) : null;
    const role = configured || exact || null;
    return {
      key: definition.key,
      nameKey: definition.nameKey,
      label: definition.label,
      name: normalized[definition.nameKey],
      color: definition.color,
      roleId: role?.id || '',
      action: configured && configured.name !== normalized[definition.nameKey] ? 'rename' : configured ? 'configured' : exact ? 'reuse' : 'create',
      assignable: role ? role.editable === true : true
    };
  });
  const invalid = entries.filter((entry) => entry.roleId && !entry.assignable);
  if (invalid.length) throw new Error(`Nicht verwaltbare Rollen: ${invalid.map((entry) => entry.name).join(', ')}`);
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = Date.now() + 5 * 60_000;
  rolePlans.set(token, { guildId: guild.id, conf: normalized, entries, signature: rolePlanSignature(guild.id, normalized, entries), expiresAt });
  return {
    token,
    expiresAt: new Date(expiresAt).toISOString(),
    entries,
    createCount: entries.filter((entry) => entry.action === 'create').length,
    renameCount: entries.filter((entry) => entry.action === 'rename').length,
    reuseCount: entries.filter((entry) => entry.action === 'reuse').length,
    configuredCount: entries.filter((entry) => entry.action === 'configured').length
  };
};
export const createActivityRaceRoleSet = async ({ guild, token, actorId = '' } = {}) => {
  cleanExpiredRolePlans();
  const plan = rolePlans.get(String(token || ''));
  if (!plan || plan.guildId !== guild?.id) throw new Error('Die Rollenvorschau ist abgelaufen. Bitte prüfe das Set erneut.');
  rolePlans.delete(String(token));
  await guild.roles.fetch();
  const patch = {};
  const created = [];
  const renamed = [];
  const reused = [];
  for (const entry of plan.entries) {
    let role = entry.roleId ? guild.roles.cache.get(entry.roleId) : null;
    if (!role && entry.action === 'reuse') role = guild.roles.cache.find((candidate) => !candidate.managed && candidate.name === entry.name && candidate.editable);
    if (!role) {
      role = await guild.roles.create({
        name: entry.name,
        color: entry.color,
        hoist: false,
        mentionable: false,
        permissions: [],
        reason: `Aktivitäts-Liga-Rollenset bestätigt${actorId ? ` von ${actorId}` : ''}`
      });
      created.push({ id: role.id, name: role.name, key: entry.key });
    } else if (entry.action === 'rename') {
      role = await role.edit({
        name: entry.name,
        color: entry.color,
        reason: `Aktivitäts-Liga-Rollenname bestätigt${actorId ? ` von ${actorId}` : ''}`
      });
      renamed.push({ id: role.id, name: role.name, key: entry.key });
    } else reused.push({ id: role.id, name: role.name, key: entry.key });
    patch[entry.key] = role.id;
  }
  return { patch, created, renamed, reused, entries: plan.entries.map((entry) => ({ ...entry, roleId: patch[entry.key] })) };
};

export const getActivityRaceSnapshot = async (guild) => {
  if (!guild) throw new Error('Server wurde nicht gefunden.');
  await ensureCompleteMemberCache(guild);
  const runtime = runtimes.get(String(guild.id));
  const conf = runtime?.conf || normalizeConfig();
  if (runtime) {
    await reconcileActivityFromServerIndex(runtime);
    await settleVoice(runtime);
  }
  const data = await guildData(guild.id);
  const timezone = runtime?.timezone || 'Europe/Berlin';
  if (conf.enabled) ensureTrackingWindow(data, timezone);
  const snapshot = attachFullRankings(guild, data, buildPanelSnapshot(guild, data, conf, timezone), timezone);
  return {
    ...snapshot,
    awards: buildAwardSnapshot(guild, data, conf, timezone),
    enabled: conf.enabled,
    panel: { ...data.panel, selectedPeriod: 'daily', lastError: runtime?.lastPanelError || '' },
    indexBackfill: { ...data.indexBackfill },
    roles: ACTIVITY_RACE_ROLE_DEFINITIONS.map((definition) => ({
      key: definition.key,
      label: definition.label,
      name: conf[definition.nameKey],
      roleId: conf[definition.key],
      exists: Boolean(conf[definition.key] && guild.roles.cache.has(conf[definition.key]))
    })),
    lastRoleError: runtime?.lastRoleError || '',
    storedDays: Object.keys(data.days || {}).length
  };
};
export const refreshActivityRace = async ({ guild, conf } = {}) => {
  const runtime = ensureRuntime(guild, conf);
  runtime.timezone = String(conf?.generalTimezone || runtime.timezone || 'Europe/Berlin');
  const backfill = await reconcileActivityFromServerIndex(runtime, { force: true });
  const roles = await reconcileRoles(runtime, { force: true });
  const panel = await ensurePanel(runtime, { force: true });
  return { backfill, roles, panel };
};

export const applyActivityRacePanelDesign = async ({
  guild,
  conf = {},
  panelDesign = {},
  panelChannelId = '',
  outsideFile = null,
  outsideFileName = '',
  removeOutsideImage = false
} = {}) => {
  if (!guild) throw new Error('Server wurde nicht gefunden.');
  if (outsideFile && outsideFile.length > 25 * 1024 * 1024) throw new Error('Das Außenbild darf maximal 25 MB groß sein.');
  const nextDesign = normalizePanelDesign(panelDesign);
  if (outsideFile) {
    nextDesign.outsideImageUrl = '';
    nextDesign.outsideImageAttachment = null;
  }
  if (removeOutsideImage) {
    nextDesign.outsideImageUrl = '';
    nextDesign.outsideImageAttachment = null;
  }
  const runtime = ensureRuntime(guild, {
    ...conf,
    panelChannelId: String(panelChannelId || conf?.panelChannelId || '').trim(),
    panelDesign: nextDesign
  });
  runtime.timezone = String(conf?.generalTimezone || runtime.timezone || 'Europe/Berlin');

  let panel = null;
  if (outsideFile && (!runtime.conf.enabled || !hasCompleteRoleSet(runtime.conf))) {
    throw new Error('Aktiviere und bestätige zuerst das Aktivitäts-Liga-Rollenset, bevor du ein Bild vom PC dauerhaft in das Live-Panel lädst. Bild-URLs kannst du bereits vorher speichern.');
  }
  if (runtime.conf.enabled && hasCompleteRoleSet(runtime.conf)) {
    panel = await ensurePanel(runtime, {
      force: true,
      outsideFile,
      outsideFileName: String(outsideFileName || 'fallen-heaven-activity.png').replace(/[^a-z0-9._-]/gi, '_').slice(-120),
      removeOutsideImage
    });
    if (outsideFile && panel?.outsideImageAttachment) {
      nextDesign.outsideImageUrl = panel.outsideImageAttachment.url;
      nextDesign.outsideImageAttachment = normalizePanelAttachment(panel.outsideImageAttachment);
      runtime.conf.panelDesign = normalizePanelDesign(nextDesign);
    }
  }
  return {
    panelDesign: normalizePanelDesign(nextDesign),
    panelChannelId: runtime.conf.panelChannelId,
    panel
  };
};

export const feature = {
  id: 'activityRace',
  name: 'Aktivitäts-Liga',
  commands: [],
  async onClientReady({ guild, cfg }) {
    await ensureLoaded();
    await guild.members.fetch().catch(() => null);
    const runtime = ensureRuntime(guild, cfg?.activityRace);
    runtime.timezone = String(cfg?.general?.timezone || 'Europe/Berlin');
    hydrateVoiceStates(runtime);
    startRuntime(runtime);
    const data = await guildData(guild.id);
    if (pruneOldDays(data, runtime.timezone)) scheduleSave();
    if (runtime.conf.enabled) {
      await reconcileActivityFromServerIndex(runtime, { force: true });
      await reconcileRoles(runtime, { force: true }).catch((error) => { runtime.lastRoleError = String(error?.message || error); });
      await ensurePanel(runtime, { force: true }).catch((error) => { runtime.lastPanelError = String(error?.message || error); });
    }
  },
  async onConfigUpdate({ guild, cfg }) {
    const existing = runtimes.get(String(guild.id));
    const previousConf = existing?.conf || normalizeConfig(cfg?.activityRace);
    if (existing) await settleVoice(existing);
    const runtime = ensureRuntime(guild, cfg?.activityRace);
    runtime.timezone = String(cfg?.general?.timezone || 'Europe/Berlin');
    if (!runtime.tickTimer) { hydrateVoiceStates(runtime); startRuntime(runtime); }
    if (runtime.conf.enabled) {
      scheduleRoleReconcile(runtime);
      schedulePanelRefresh(runtime);
    } else if (previousConf.enabled) {
      clearTimeout(runtime.roleTimer);
      clearTimeout(runtime.panelTimer);
      runtime.roleTimer = null;
      runtime.panelTimer = null;
      await clearAwardRoles(runtime, previousConf);
      await removePanel(runtime);
    }
  },
  async onMessageCreate({ message, cfg }) {
    const runtime = ensureRuntime(message.guild, cfg?.activityRace);
    runtime.timezone = String(cfg?.general?.timezone || 'Europe/Berlin');
    if (!shouldCountMessage(message, runtime.conf)) return;
    const data = await guildData(message.guildId);
    ensureDayUser(data, runtime.timezone, message.author.id, message.createdTimestamp).messages += 1;
    data.updatedAt = new Date().toISOString();
    scheduleSave();
    scheduleRoleReconcile(runtime);
    schedulePanelRefresh(runtime);
  },
  async onVoiceStateUpdate({ oldState, newState, cfg, guild }) {
    const runtime = ensureRuntime(guild, cfg?.activityRace);
    runtime.timezone = String(cfg?.general?.timezone || 'Europe/Berlin');
    await settleVoice(runtime);
    const userId = String(newState?.id || oldState?.id || '');
    if (!userId || newState?.member?.user?.bot || oldState?.member?.user?.bot) runtime.voiceStates.delete(userId);
    else if (newState?.channelId) runtime.voiceStates.set(userId, voiceStateRow(newState));
    else runtime.voiceStates.delete(userId);
    scheduleRoleReconcile(runtime);
    schedulePanelRefresh(runtime);
  },
  async onGuildMemberUpdate({ newMember, cfg, guild }) {
    const runtime = ensureRuntime(guild, cfg?.activityRace);
    if (!runtime.voiceStates.has(newMember.id)) return;
    await settleVoice(runtime);
    const state = newMember.voice;
    if (state?.channelId) runtime.voiceStates.set(newMember.id, voiceStateRow(state));
  },
  async onGuildMemberRemove({ member, cfg, guild }) {
    const runtime = ensureRuntime(guild, cfg?.activityRace);
    await settleVoice(runtime);
    runtime.voiceStates.delete(String(member.id));
    scheduleRoleReconcile(runtime);
    schedulePanelRefresh(runtime);
  },
  async onAnyInteraction({ interaction, cfg, guild }) {
    if (!interaction.isButton?.() || !String(interaction.customId || '').startsWith(PANEL_PREFIX)) return;
    const view = String(interaction.customId).slice(PANEL_PREFIX.length);
    if (!['rules', 'personal'].includes(view)) return;
    const runtime = ensureRuntime(guild, cfg?.activityRace);
    const data = await guildData(guild.id);
    const privateView = interaction.message?.flags?.has?.(MessageFlags.Ephemeral) === true;
    const publicPanel = String(interaction.message?.id || '') === String(data.panel.messageId || '');
    if (!privateView && !publicPanel) {
      await interaction.reply({ content: 'Dieses Ranglisten-Panel ist nicht mehr aktuell.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return;
    }
    const acknowledged = privateView
      ? await interaction.deferUpdate().then(() => true).catch(() => false)
      : await interaction.deferReply({ flags: MessageFlags.Ephemeral }).then(() => true).catch(() => false);
    if (!acknowledged) return;
    await reconcileActivityFromServerIndex(runtime);
    await settleVoice(runtime);
    ensureTrackingWindow(data, runtime.timezone);
    const snapshot = attachFullRankings(
      guild,
      data,
      buildPanelSnapshot(guild, data, runtime.conf, runtime.timezone),
      runtime.timezone
    );
    const payload = view === 'rules'
      ? buildRulesPayload(guild, runtime.conf, runtime.timezone)
      : buildPersonalRankPayload(guild, snapshot, interaction.user.id);
    await interaction.editReply(payload);
  }
};

export const _activityRaceInternals = {
  normalizeConfig,
  normalizeStore,
  localDateKey,
  periodStartKey,
  completedPeriodRange,
  aggregatePeriod,
  aggregateRange,
  periodSnapshot,
  completedPeriodSnapshot,
  buildPanelSnapshot,
  buildAwardSnapshot,
  buildRoleAssignmentPlan,
  rankMetric,
  meaningfulMessage,
  buildPanelPayload,
  buildRulesPayload,
  PING_PHRASES,
  pickPhrase,
  sendPlacementPings,
  buildCompletionAnnouncement,
  announceCompletedPeriods,
  normalizePanelDesign,
  panelChannel,
  formatVoice,
  ensureCompleteMemberCache,
  fullRankMetric,
  attachFullRankings,
  buildPersonalRankPayload,
  indexedBackfillRange,
  reconstructIndexedChatDays,
  mergeIndexedChatDays
};
