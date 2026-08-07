import fs from 'node:fs/promises';
import path from 'node:path';
import { PermissionFlagsBits } from 'discord.js';
import { setBoostSystemIndexSchedule } from './boostSystemIndex.js';

import { recordDiagnosticError, runTrackedOperation } from '../runtime/liveDiagnostics.js';
import { applyRoleChangesSequentially } from '../runtime/managedRoleService.js';

const LEDGER_FILE = path.join(process.env.FALLEN_HEAVEN_DATA_DIR || path.join(process.cwd(), 'data'), 'boost-role-ledger.json');
// Only type 8 represents an individual member boost. Types 9-11 are guild
// tier milestones. Every unique type-8 message is one boost event. Discord's
// localized system text can additionally contain the member's verified total
// (for example "2 times"); this is useful when the first event predates the
// bot or the current index window.
const BOOST_MESSAGE_TYPES = new Set([8]);
const TRUSTED_BOOST_NOTIFICATION_BOT_IDS = new Set([
  String(process.env.BOOST_NOTIFICATION_BOT_ID || '1067880912538304583')
]);
const TRUSTED_BOOST_LOSS_CHANNEL_IDS = new Set([
  String(process.env.BOOST_LOSS_CHANNEL_ID || '1404532593575067690')
]);
const MAX_PROCESSED_MESSAGES = 50000;
const MAX_LEDGER_EVENTS = 100000;
const BOOST_EVIDENCE_MATCH_WINDOW_MS = 2 * 60 * 1000;
const BOOST_LOSS_SYNC_GRACE_MS = 60 * 60 * 1000;
const BOOST_GAIN_SYNC_GRACE_MS = 2 * 60 * 1000;
const memberQueues = new Map();
const boostVerificationJobs = new Map();
const syncDiagnosticCache = new Set();
const ledgerEventWaiters = new Map();
const completedLedgerEvents = new Map();
const BOOST_VERIFICATION_DELAYS_MS = [1500, 4000, 9000, 18000];
let ledger = null;
let ledgerMutation = Promise.resolve();

const LEDGER_VERSION = 8;
const RECONCILE_INTERVAL_MS = 15 * 60 * 1000;
const reconcileTimers = new Map();
const resolveBoostAvatarUrl = (entity, options = { size: 128 }) => {
  const user = entity?.user || entity || null;
  if (!user?.id) return null;
  const resolved = user?.displayAvatarURL?.(options);
  if (resolved) return String(resolved);
  if (entity?.avatar && entity?.guild?.id) {
    const extension = String(entity.avatar.startsWith('a_') ? 'gif' : (options.extension || 'png')).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png';
    const size = Number(options.size || 128);
    const normalizedSize = Number.isFinite(size) && size > 0 ? Math.min(4096, Math.max(16, Math.round(size))) : 128;
    return `https://cdn.discordapp.com/guilds/${String(entity.guild.id)}/users/${String(user.id)}/avatars/${String(entity.avatar)}.${extension}?size=${normalizedSize}`;
  }
  if (user.avatar) {
    const extension = String(user.avatar.startsWith('a_') ? 'gif' : (options.extension || 'png')).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png';
    const size = Number(options.size || 128);
    const normalizedSize = Number.isFinite(size) && size > 0 ? Math.min(4096, Math.max(16, Math.round(size))) : 128;
    return `https://cdn.discordapp.com/avatars/${String(user.id)}/${String(user.avatar)}.${extension}?size=${normalizedSize}`;
  }
  return user?.defaultAvatarURL || null;
};
const emptyLedger = () => ({ version: LEDGER_VERSION, guilds: {} });
const normalizeText = (value = '') => String(value || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim();
const parseReportedBoostCount = (value = '') => {
  const text = String(value || '').trim();
  if (/^\d{1,3}$/.test(text)) return Math.max(1, Math.min(99, Number(text)));
  const match = normalizeText(text).match(/(?:zum\s+)?(\d{1,3})\.?\s*(?:mal|x|boosts?)/i);
  return match ? Math.max(1, Math.min(99, Number(match[1]))) : 0;
};

const configuredChannelId = (value) => /^\d{15,25}$/.test(String(value || '').trim())
  ? String(value).trim()
  : '';

const normalizedChannelName = (channel) => normalizeText(channel?.name || '')
  .replace(/[^a-z0-9]+/g, '-');

const isBoostInfoChannel = (channel, conf = {}) => {
  const explicit = configuredChannelId(conf?.boostInfoChannelId);
  if (explicit) return String(channel?.id || '') === explicit;
  return /(?:^|-)boost-info(?:-|$)/.test(normalizedChannelName(channel));
};

const isBoostLossChannel = (channel, conf = {}) => {
  const explicit = configuredChannelId(conf?.boostEndLogChannelId);
  if (explicit) return String(channel?.id || '') === explicit;
  return TRUSTED_BOOST_LOSS_CHANNEL_IDS.has(String(channel?.id || ''))
    || /(?:^|-)boost-(?:log|notifications?)(?:-|$)/.test(normalizedChannelName(channel));
};

const messageEmbedText = (message) => {
  const embeds = Array.isArray(message?.embeds) ? message.embeds : [...(message?.embeds?.values?.() || [])];
  return embeds.map((embed) => [
    embed?.title,
    embed?.description,
    embed?.author?.name,
    embed?.footer?.text
  ].map((value) => String(value || '').trim()).filter(Boolean).join('\n')).filter(Boolean).join('\n');
};

const mentionedUserId = (value = '') => String(value || '').match(/<@!?(\d{15,25})>/)?.[1] || '';

const nativeBoostSystemText = (message) => {
  const values = [];
  for (const value of [message?.content, message?.systemContent, message?.cleanContent]) {
    const text = String(value || '').trim();
    if (text && !values.includes(text)) values.push(text);
  }
  return values.join(' ');
};

const nativeReportedBoostCount = (message) => BOOST_MESSAGE_TYPES.has(Number(message?.type))
  ? parseReportedBoostCount(nativeBoostSystemText(message))
  : 0;

const loadLedger = async () => {
  if (ledger) return ledger;
  try {
    const raw = await fs.readFile(LEDGER_FILE, 'utf8');
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
    ledger = parsed && typeof parsed === 'object' ? parsed : emptyLedger();
  } catch (error) {
    if (error?.code !== 'ENOENT') console.error('[boostRoles] Booster-Ledger konnte nicht gelesen werden', error);
    ledger = emptyLedger();
  }
  ledger.version = LEDGER_VERSION;
  ledger.guilds ||= {};
  return ledger;
};

const persistLedger = async () => {
  const temporaryFile = `${LEDGER_FILE}.tmp`;
  await fs.mkdir(path.dirname(LEDGER_FILE), { recursive: true });
  await fs.writeFile(temporaryFile, JSON.stringify(ledger, null, 2), 'utf8');
  await fs.rename(temporaryFile, LEDGER_FILE);
};

const mutateLedger = (operation) => {
  const current = ledgerMutation.then(async () => {
    await loadLedger();
    const result = await operation(ledger);
    await persistLedger();
    return result;
  });
  ledgerMutation = current.catch(() => {});
  return current;
};

const ledgerEventKey = (guildId, messageId) => `${String(guildId || '')}:${String(messageId || '')}`;
const rememberCompletedLedgerEvent = (guildId, messageId, result) => {
  const key = ledgerEventKey(guildId, messageId);
  if (!guildId || !messageId) return;
  const completed = { processed: true, guildId: String(guildId), messageId: String(messageId), ...result };
  completedLedgerEvents.set(key, completed);
  while (completedLedgerEvents.size > 2000) completedLedgerEvents.delete(completedLedgerEvents.keys().next().value);
  const waiters = ledgerEventWaiters.get(key) || [];
  ledgerEventWaiters.delete(key);
  waiters.forEach((resolve) => resolve(completed));
};

export const waitForBoostLedgerEvent = async (guildId, messageId, timeoutMs = 5000) => {
  const normalizedGuildId = String(guildId || '');
  const normalizedMessageId = String(messageId || '');
  if (!normalizedGuildId || !normalizedMessageId) return { processed: false, reason: 'missing-id' };
  const key = ledgerEventKey(normalizedGuildId, normalizedMessageId);
  if (completedLedgerEvents.has(key)) return completedLedgerEvents.get(key);
  await ledgerMutation.catch(() => {});
  const data = await loadLedger();
  if (getGuildLedger(data, normalizedGuildId).processedMessages.includes(normalizedMessageId)) {
    return { processed: true, guildId: normalizedGuildId, messageId: normalizedMessageId, restored: true };
  }
  if (completedLedgerEvents.has(key)) return completedLedgerEvents.get(key);
  return new Promise((resolve) => {
    const waiters = ledgerEventWaiters.get(key) || [];
    waiters.push(resolve);
    ledgerEventWaiters.set(key, waiters);
    if (completedLedgerEvents.has(key)) {
      const completed = completedLedgerEvents.get(key);
      ledgerEventWaiters.delete(key);
      resolve(completed);
      return;
    }
    const timer = setTimeout(() => {
      const current = ledgerEventWaiters.get(key) || [];
      const remaining = current.filter((entry) => entry !== resolve);
      if (remaining.length) ledgerEventWaiters.set(key, remaining);
      else ledgerEventWaiters.delete(key);
      resolve({ processed: false, guildId: normalizedGuildId, messageId: normalizedMessageId, reason: 'timeout' });
    }, Math.max(100, Number(timeoutMs) || 5000));
    timer.unref?.();
  });
};

const getGuildLedger = (data, guildId) => {
  data.guilds[guildId] ||= { members: {}, processedMessages: [], events: [] };
  data.guilds[guildId].members ||= {};
  data.guilds[guildId].processedMessages ||= [];
  data.guilds[guildId].events ||= [];
  data.guilds[guildId].evidenceSchemaVersion = Math.max(0, Number(data.guilds[guildId].evidenceSchemaVersion || 0));
  data.guilds[guildId].consistency ||= {
    state: 'unknown',
    checkedAt: null,
    assignedBoostCount: 0,
    discordBoostCount: 0,
    rawDifference: 0
  };
  delete data.guilds[guildId].manualOverrides;
  delete data.guilds[guildId].manualAudit;
  data.guilds[guildId].historyCheckpoints ||= {};
  if (data.guilds[guildId].activityImport) {
    data.guilds[guildId].activityImport.rows = Array.isArray(data.guilds[guildId].activityImport.rows)
      ? data.guilds[guildId].activityImport.rows
      : [];
    data.guilds[guildId].activityImport.memberBaselines = data.guilds[guildId].activityImport.memberBaselines
      && typeof data.guilds[guildId].activityImport.memberBaselines === 'object'
      ? data.guilds[guildId].activityImport.memberBaselines
      : {};
    data.guilds[guildId].activityImport.editAudit = Array.isArray(data.guilds[guildId].activityImport.editAudit)
      ? data.guilds[guildId].activityImport.editAudit.slice(-500)
      : [];
  }
  return data.guilds[guildId];
};

const needsBoostEvidenceBackfill = async (guildId) => {
  const data = await loadLedger();
  return Number(getGuildLedger(data, String(guildId || '')).evidenceSchemaVersion || 0) < 1;
};

const createMemberRecord = (count = 0, source = 'unknown', cycleStartedAt = 0) => {
  const normalizedCount = Math.max(0, Math.floor(Number(count) || 0));
  return {
    count: normalizedCount,
    automaticCount: normalizedCount,
    active: normalizedCount > 0,
    source,
    confidence: normalizedCount > 0 && !String(source).includes('fallback') ? 'medium' : 'low',
    cycleStartedAt: Math.max(0, Number(cycleStartedAt) || 0),
    highestReportedCount: normalizedCount,
    reportedCountConfirmed: false,
    evidenceMessageIds: [],
    lastReconciledAt: null,
    updatedAt: new Date().toISOString()
  };
};

const getMemberRecord = (guildLedger, userId) => {
  guildLedger.members[userId] ||= createMemberRecord();
  const record = guildLedger.members[userId];
  record.count = Math.max(0, Math.floor(Number(record.count ?? record.automaticCount) || 0));
  record.automaticCount = record.count;
  record.cycleStartedAt = Math.max(0, Number(record.cycleStartedAt) || 0);
  record.highestReportedCount = Math.max(0, Number(record.highestReportedCount || 0));
  record.reportedCountConfirmed = Boolean(record.reportedCountConfirmed);
  record.evidenceMessageIds = Array.isArray(record.evidenceMessageIds) ? record.evidenceMessageIds.map(String).slice(-500) : [];
  record.confidence ||= record.count > 0 && !String(record.source || '').includes('fallback') ? 'medium' : 'low';
  record.lastReconciledAt ||= null;
  return record;
};

const parseTierMappings = (value) => {
  const lines = Array.isArray(value) ? value : String(value || '').split('\n');
  const mappings = [];
  lines.forEach((entry, index) => {
    const text = String(entry || '').trim();
    if (!text) return;
    const explicit = text.match(/^(\d{1,2})\s*(?:=|:|\||,)\s*(\d{15,25})$/);
    if (explicit) {
      mappings.push({ count: Math.max(1, Number(explicit[1])), roleId: explicit[2] });
      return;
    }
    const roleOnly = text.match(/^(\d{15,25})$/);
    if (roleOnly) mappings.push({ count: index + 1, roleId: roleOnly[1] });
  });
  return Array.from(new Map(mappings.map((item) => [item.count, item])).values()).sort((a, b) => a.count - b.count);
};

const parseRoleIds = (value) => (Array.isArray(value) ? value : String(value || '').split('\n'))
  .map((entry) => String(entry || '').trim())
  .filter((entry) => /^\d{15,25}$/.test(entry));

const desiredRoleIds = (count, mappings, cumulative) => {
  if (!(count > 0) || !mappings.length) return [];
  const eligible = mappings.filter((mapping) => mapping.count <= count);
  if (!eligible.length) return [];
  return cumulative ? eligible.map((mapping) => mapping.roleId) : [eligible.at(-1).roleId];
};

export const resolveManagedBoosterRoles = ({
  active = false,
  boostCount = 0,
  automaticRoleIds = [],
  previousManagedRoleIds = [],
  tierRoleMappings = [],
  cumulativeRoles = false
} = {}) => {
  const automaticIds = parseRoleIds(automaticRoleIds);
  const mappings = parseTierMappings(tierRoleMappings);
  const managedRoleIds = [...new Set([
    ...automaticIds,
    ...mappings.map((mapping) => mapping.roleId),
    ...parseRoleIds(previousManagedRoleIds)
  ])];
  const wantedRoleIds = active
    ? [...new Set([
        ...automaticIds,
        ...desiredRoleIds(Math.max(1, Math.floor(Number(boostCount) || 1)), mappings, cumulativeRoles === true)
      ])]
    : [];
  return { automaticIds, mappings, managedRoleIds, wantedRoleIds };
};

const getNativeDiscordBoosterRole = (guild) => guild?.roles?.premiumSubscriberRole
  || guild?.roles?.cache?.find?.((role) => role?.tags?.premiumSubscriberRole === true)
  || null;

// premiumSince is Discord's canonical member-level boost state. The managed
// premium role can arrive a little earlier or later in guildMemberUpdate and
// is therefore diagnostic evidence, not a prerequisite for automation.
const isActiveDiscordBooster = (member) => Boolean(
  member?.premiumSince || Number(member?.premiumSinceTimestamp || 0) > 0
);

const currentBoostCycleStart = (member) => Math.max(
  0,
  Number(member?.premiumSinceTimestamp || member?.premiumSince?.getTime?.() || 0)
);

const isNativeBoostLedgerEvent = (event) => (
  event?.type === 'boost' && (
    BOOST_MESSAGE_TYPES.has(Number(event?.discordMessageType))
    || String(event?.source || '').startsWith('native-system')
  )
) || (event?.type === 'boost-info' && String(event?.source || '').startsWith('boost-info'))
  || (event?.type === 'expired' && String(event?.source || '').startsWith('trusted-boost-loss'));

export const parseTrustedBoostLossMessage = (message, conf = {}) => {
  if (!message?.guild || !message?.author?.bot) return null;
  if (!TRUSTED_BOOST_NOTIFICATION_BOT_IDS.has(String(message.author.id || ''))) return null;
  if (!isBoostLossChannel(message.channel || { id: message.channelId }, conf)) return null;
  const embeds = Array.isArray(message.embeds) ? message.embeds : [...(message.embeds?.values?.() || [])];
  for (const embed of embeds) {
    const title = String(embed?.title || '');
    const description = String(embed?.description || '');
    if (!/wir haben einen booster verloren/i.test(title)) continue;
    const userId = description.match(/<@!?(\d{15,25})>\s+hat aufgehört den Server zu boosten/i)?.[1] || '';
    if (userId) return { userId, title, description };
  }
  return null;
};

export const parseBoostInfoMessage = (message, conf = {}) => {
  if (!message?.guild || !message?.author?.bot || !isBoostInfoChannel(message.channel || { id: message.channelId }, conf)) return null;
  const combined = [message?.content, messageEmbedText(message)].map((value) => String(value || '').trim()).filter(Boolean).join('\n');
  if (!/(?:danke\s+für\s+den\s+boost|danke\s+<@!?\d{15,25}>\s*,?\s*dass\s+du\s+den\s+server\s+boostest|wir\s+haben\s+einen\s+neuen\s+booster)/i.test(combined)) return null;
  const userId = mentionedUserId(combined);
  return userId ? { userId, text: combined.slice(0, 500) } : null;
};

const isCurrentBoostCycleEvent = (member, timestamp) => {
  if (!isActiveDiscordBooster(member)) return false;
  const cycleStartedAt = currentBoostCycleStart(member);
  return cycleStartedAt > 0 && Number(timestamp || 0) >= cycleStartedAt;
};

const isAdditionalBoostEvent = (member, timestamp) => {
  const cycleStartedAt = currentBoostCycleStart(member);
  return isCurrentBoostCycleEvent(member, timestamp) && Number(timestamp || 0) > cycleStartedAt;
};

const berlinDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

const dateKeyInBerlin = (timestamp = Date.now()) => {
  const parts = Object.fromEntries(berlinDateFormatter.formatToParts(new Date(Number(timestamp) || Date.now()))
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const previousDateKey = (dateKey) => {
  const [year, month, day] = String(dateKey || '').split('-').map(Number);
  if (!year || !month || !day) return '';
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
};

export const calculateActivityBaselineCount = ({
  active = false,
  rows = [],
  cycleDateKey = '',
  todayDateKey = ''
} = {}) => {
  if (!active) return 0;
  const currentRows = (Array.isArray(rows) ? rows : []).filter((row) => {
    const dateKey = String(row?.dateKey || '');
    if (!dateKey) return false;
    if (cycleDateKey && dateKey < cycleDateKey) return false;
    if (todayDateKey && dateKey > todayDateKey) return false;
    return true;
  });
  const given = currentRows.filter((row) => row.action === 'given').length;
  const expired = currentRows.filter((row) => row.action === 'expired').length;
  // premiumSince proves that one boost was already active at the start of the
  // current cycle. Discord's activity list sometimes starts later and only
  // shows subsequent changes. Add that implicit first boost only when there is
  // no visible "given" entry on the cycle's first Berlin calendar day.
  const includesCycleStart = Boolean(cycleDateKey && currentRows.some(
    (row) => row.action === 'given' && row.dateKey === cycleDateKey
  ));
  return Math.max(1, given - expired + (includesCycleStart ? 0 : 1));
};

const weightedBoostEvents = (events = []) => {
  const ordered = [...events].sort((left, right) => Number(left.timestamp || 0) - Number(right.timestamp || 0));
  const nativeBoosts = ordered.filter((event) => event?.type === 'boost');
  const countedSupport = [];
  return ordered.map((event) => {
    if (event?.type === 'expired') return { event, delta: -1 };
    if (event?.type === 'boost') return { event, delta: 1 };
    if (event?.type !== 'boost-info') return { event, delta: 0 };
    const timestamp = Number(event.timestamp || 0);
    const matchedNative = nativeBoosts.some((nativeEvent) => (
      Math.abs(Number(nativeEvent.timestamp || 0) - timestamp) <= BOOST_EVIDENCE_MATCH_WINDOW_MS
    ));
    const duplicateSupport = countedSupport.some((supportEvent) => (
      String(supportEvent.channelId || '') !== String(event.channelId || '')
      && Math.abs(Number(supportEvent.timestamp || 0) - timestamp) <= BOOST_EVIDENCE_MATCH_WINDOW_MS
    ));
    if (matchedNative || duplicateSupport) return { event, delta: 0 };
    countedSupport.push(event);
    return { event, delta: 1 };
  });
};

export const calculateVerifiedBoostCount = ({
  userId = '',
  premiumSinceTimestamp = 0,
  hasSystemBoosterRole = false,
  events = [],
  activityImport = null,
  nowTimestamp = Date.now()
} = {}) => {
  const cycleStartedAt = Math.max(0, Number(premiumSinceTimestamp) || 0);
  if (!hasSystemBoosterRole || cycleStartedAt <= 0) return 0;
  const today = Math.max(cycleStartedAt, Number(nowTimestamp) || Date.now());
  const uniqueEvents = new Map();
  for (const event of events) {
    if (!isNativeBoostLedgerEvent(event) || String(event.userId || '') !== String(userId || '')) continue;
    const timestamp = Number(event.timestamp || 0);
    if (timestamp < cycleStartedAt || timestamp > today) continue;
    const id = String(event.messageId || event.id || '');
    if (id) uniqueEvents.set(id, event);
  }
  const orderedEvents = [...uniqueEvents.values()].sort((left, right) => Number(left.timestamp || 0) - Number(right.timestamp || 0));
  const weightedEvents = weightedBoostEvents(orderedEvents);
  const deltaByEvent = new Map(weightedEvents.map(({ event, delta }) => [event, delta]));
  const eventDelta = (event) => Number(deltaByEvent.get(event) || 0);
  const reportedCurrentCount = (sourceEvents) => sourceEvents.reduce((highest, event, index) => {
    const reported = Math.max(0, Number(event?.reportedCount || 0));
    if (!reported || event?.type !== 'boost') return highest;
    const laterDelta = sourceEvents.slice(index + 1).reduce((sum, later) => sum + eventDelta(later), 0);
    return Math.max(highest, reported + laterDelta);
  }, 0);
  const activityRows = Array.isArray(activityImport?.rows)
    ? activityImport.rows.filter((row) => String(row.userId || '') === String(userId || ''))
    : [];
  const memberBaseline = activityImport?.memberBaselines?.[String(userId || '')] || null;
  const memberBaselineAt = Math.max(0, Number(memberBaseline?.snapshotAt || 0));
  if (memberBaseline && memberBaselineAt >= cycleStartedAt && memberBaselineAt <= today) {
    const verifiedAfterBaseline = orderedEvents
      .filter((event) => Number(event.timestamp || 0) > memberBaselineAt);
    const eventTotal = Math.max(1, Number(memberBaseline.count || 0))
      + verifiedAfterBaseline.reduce((sum, event) => sum + eventDelta(event), 0);
    const reportedTotal = reportedCurrentCount(verifiedAfterBaseline);
    return Math.max(1, eventTotal, reportedTotal);
  }
  if (activityRows.length) {
    const cycleDateKey = dateKeyInBerlin(cycleStartedAt);
    const todayDateKey = dateKeyInBerlin(today);
    const baselineCount = calculateActivityBaselineCount({
      active: true,
      rows: activityRows,
      cycleDateKey,
      todayDateKey
    });
    const snapshotAt = Math.max(0, Number(activityImport?.snapshotAt || 0));
    const verifiedAfterSnapshot = orderedEvents
      .filter((event) => Number(event.timestamp || 0) > snapshotAt)
      .reduce((sum, event) => sum + eventDelta(event), 0);
    return Math.max(1, baselineCount + verifiedAfterSnapshot);
  }
  const eventBalance = orderedEvents.reduce((sum, event) => sum + eventDelta(event), 0);
  const highestNativeTotal = reportedCurrentCount(orderedEvents);
  // premiumSince + the managed Discord booster role prove at least one active
  // boost. The event count and Discord's reported total corroborate each other;
  // the higher verified value prevents an already active 2x booster becoming 1x
  // merely because the first announcement is outside the readable history.
  return Math.max(1, eventBalance, highestNativeTotal);
};

const verifiedBoostCountForMember = (member, events = [], activityImport = null) => {
  return calculateVerifiedBoostCount({
    userId: member?.id,
    premiumSinceTimestamp: currentBoostCycleStart(member),
    hasSystemBoosterRole: isActiveDiscordBooster(member),
    events,
    activityImport
  });
};

const fetchFreshMember = async (member) => {
  if (!member?.guild?.id || !member?.id) return member;
  const fresh = await member.guild.members.fetch({ user: member.id, force: true }).catch(() => null);
  return fresh || member.guild.members.cache.get(member.id) || member;
};

const reportSyncDiagnostic = (guildId, code, message, error = null) => {
  const cacheKey = `${guildId}:${code}`;
  if (syncDiagnosticCache.has(cacheKey) && !error) return;
  syncDiagnosticCache.add(cacheKey);
  if (error) console.error(`[boostRoles] ${message}`, error);
  else console.warn(`[boostRoles] ${message}`);
};

const updateRecordEvidence = (record, event) => {
  const messageId = String(event?.messageId || event?.id || '');
  if (messageId && !record.evidenceMessageIds.includes(messageId)) {
    record.evidenceMessageIds.push(messageId);
    record.evidenceMessageIds = record.evidenceMessageIds.slice(-500);
  }
  const sources = new Set([String(record.source || ''), String(event?.source || '')]);
  record.confidence = record.count > 0
    ? (sources.has('native-system') || sources.has('native-system-index') ? 'high' : 'medium')
    : 'low';
};

const getNativeBoostChannels = (guild) => {
  return guild.systemChannel?.isTextBased?.() ? [guild.systemChannel] : [];
};

const getBoostEvidenceChannels = (guild, conf = {}) => {
  const channels = new Map();
  const add = (channel) => {
    if (channel?.isTextBased?.()) channels.set(String(channel.id), channel);
  };
  getNativeBoostChannels(guild).forEach(add);
  for (const channel of guild?.channels?.cache?.values?.() || []) {
    if (isBoostInfoChannel(channel, conf) || isBoostLossChannel(channel, conf)) add(channel);
  }
  for (const channelId of [conf?.boostInfoChannelId, conf?.boostEndLogChannelId, ...TRUSTED_BOOST_LOSS_CHANNEL_IDS]) {
    const normalizedId = configuredChannelId(channelId);
    if (normalizedId) add(guild?.channels?.cache?.get?.(normalizedId));
  }
  return [...channels.values()];
};

const sendAuditLog = async (guild, conf, content) => {
  const channelId = String(conf?.logChannelId || '').trim();
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId);
  if (!channel?.isTextBased?.()) return;
  await channel.send({ content, allowedMentions: { parse: [], users: [], roles: [] } }).catch(() => {});
};

const removableColorRoleIds = (member, conf) => {
  const explicit = new Set(parseRoleIds(conf?.removableColorRoleIds));
  return member.roles.cache
    .filter((role) => explicit.has(role.id))
    .map((role) => role.id);
};

export const applyManagedRoleChanges = async ({ member, toRemove = [], toAdd = [], reason = '' } = {}) => {
  return applyRoleChangesSequentially({ member, toRemove, toAdd, reason });
};

const queueMemberSync = (member, conf, count, reason, removePerks = false, previousManagedRoleIds = [], safety = {}) => {
  const queueKey = `${member.guild.id}:${member.id}`;
  const previous = memberQueues.get(queueKey) || Promise.resolve();
  const next = previous.then(async () => {
    member = await fetchFreshMember(member);
    if (!member?.guild || member.user?.bot) return;
    await member.guild.roles.fetch().catch((error) => {
      reportSyncDiagnostic(member.guild.id, 'role-cache-refresh', `${member.guild.name}: Discord-Rollen konnten nicht aktualisiert werden.`, error);
    });
    const isActiveBooster = isActiveDiscordBooster(member);
    const rolePlan = resolveManagedBoosterRoles({
      active: isActiveBooster,
      boostCount: count,
      automaticRoleIds: conf?.automaticRoleIds,
      previousManagedRoleIds,
      tierRoleMappings: conf?.tierRoleMappings,
      cumulativeRoles: conf?.cumulativeRoles
    });
    const managedRoleIds = new Set(rolePlan.managedRoleIds);
    if (!managedRoleIds.size && isActiveBooster) {
      reportSyncDiagnostic(member.guild.id, 'missing-role-configuration', `${member.guild.name}: Keine gültigen automatischen Booster-Rollen konfiguriert.`);
      return;
    }
    const verifiedCount = isActiveBooster
      ? Math.max(1, Math.floor(Number(count) || 1))
      : 0;
    const wantedRoleIds = new Set(
      safety?.freezeTierRoles === true && isActiveBooster
        ? [
            ...rolePlan.automaticIds,
            ...rolePlan.managedRoleIds.filter((roleId) => member.roles.cache.has(roleId))
          ]
        : rolePlan.wantedRoleIds
    );
    const botMember = member.guild.members.me || await member.guild.members.fetchMe().catch(() => null);
    const manageability = (roleId) => {
      const role = member.guild.roles.cache.get(roleId);
      if (!role) return { ok: false, reason: `Rolle ${roleId} wurde auf dem Server nicht gefunden.` };
      if (role.managed) return { ok: false, reason: `Rolle „${role.name}“ wird von Discord verwaltet.` };
      if (!botMember) return { ok: false, reason: 'Bot-Mitglied konnte nicht geladen werden.' };
      if (!botMember.permissions?.has?.(PermissionFlagsBits.ManageRoles)) return { ok: false, reason: 'Dem Bot fehlt die Discord-Berechtigung „Rollen verwalten“.' };
      if (role.position >= botMember.roles.highest.position) return { ok: false, reason: `Rolle „${role.name}“ liegt über oder auf gleicher Höhe wie die höchste Bot-Rolle.` };
      return { ok: true, role };
    };
    const blocked = [];
    const toAdd = [...wantedRoleIds].filter((roleId) => {
      if (member.roles.cache.has(roleId)) return false;
      const result = manageability(roleId);
      if (!result.ok) blocked.push(result.reason);
      return result.ok;
    });
    const removalSet = new Set(
      [...managedRoleIds].filter((roleId) => member.roles.cache.has(roleId) && !wantedRoleIds.has(roleId))
    );
    if (removePerks || !isActiveBooster || verifiedCount <= 0) {
      removableColorRoleIds(member, conf).forEach((roleId) => removalSet.add(roleId));
    }
    const toRemove = [...removalSet].filter((roleId) => {
      const result = manageability(roleId);
      if (!result.ok) blocked.push(result.reason);
      return result.ok;
    });
    if (blocked.length) {
      reportSyncDiagnostic(
        member.guild.id,
        `blocked:${member.id}:${[...wantedRoleIds].join(',')}`,
        `${member.guild.name}: Booster-Rollen für ${member.user?.tag || member.id} blockiert: ${[...new Set(blocked)].join(' ')}`
      );
    }
    // discord.js applies array based role changes through a full role-set PATCH.
    // Keep the returned member between removal and addition; otherwise the
    // following add can reuse the stale pre-removal cache and silently restore
    // an obsolete tier role.
    member = await applyManagedRoleChanges({ member, toRemove, toAdd, reason });
    if (toAdd.length || toRemove.length) {
      const refreshed = await fetchFreshMember(member);
      const missingAfterWrite = toAdd.filter((roleId) => !refreshed.roles.cache.has(roleId));
      const staleAfterWrite = toRemove.filter((roleId) => refreshed.roles.cache.has(roleId));
      if (missingAfterWrite.length || staleAfterWrite.length) {
        throw new Error([
          missingAfterWrite.length ? `fehlend: ${missingAfterWrite.join(', ')}` : '',
          staleAfterWrite.length ? `nicht entfernt: ${staleAfterWrite.join(', ')}` : ''
        ].filter(Boolean).join(' | '));
      }
      if (toAdd.length) {
        console.log(`[boostRoles] ${member.guild.name}: ${toAdd.length} Booster-Rolle(n) an ${member.user?.tag || member.id} vergeben (${verifiedCount} Boost${verifiedCount === 1 ? '' : 's'}).`);
      }
      if (toRemove.length) {
        console.log(`[boostRoles] ${member.guild.name}: ${toRemove.length} veraltete Booster-Rolle(n) bei ${member.user?.tag || member.id} entfernt.`);
      }
    }
    if (toAdd.length || toRemove.length) {
      const validation = isActiveBooster ? 'Discord-Status aktiv' : 'Discord-Status inaktiv';
      await sendAuditLog(member.guild, conf, `Booster-Rollen synchronisiert: <@${member.id}> | ${verifiedCount} Boost${verifiedCount === 1 ? '' : 's'} | ${validation} | +${toAdd.length} / -${toRemove.length}`);
    }
  }).catch((error) => {
    console.error(`[boostRoles] Rollenabgleich für ${member.id} fehlgeschlagen`, error);
    recordDiagnosticError('Booster-Rollenabgleich', error, {
      featureId: 'boostRoles',
      hook: 'roleSync',
      guildId: member?.guild?.id,
      userId: member?.id
    });
  }).finally(() => {
    if (memberQueues.get(queueKey) === next) memberQueues.delete(queueKey);
  });
  memberQueues.set(queueKey, next);
  return next;
};

const scheduleVerifiedBoostSync = (member, conf, count, reason) => {
  if (!member?.guild?.id || !member?.id) return;
  const key = `${member.guild.id}:${member.id}`;
  const existing = boostVerificationJobs.get(key);
  if (existing) {
    existing.count = Math.max(existing.count, Math.max(1, Number(count) || 1));
    existing.reason = reason || existing.reason;
    return;
  }
  const job = { count: Math.max(1, Number(count) || 1), reason, timer: null };
  boostVerificationJobs.set(key, job);

  const verify = async (attempt = 0) => {
    if (boostVerificationJobs.get(key) !== job) return;
    const fresh = await fetchFreshMember(member);
    if (isActiveDiscordBooster(fresh)) {
      boostVerificationJobs.delete(key);
      await queueMemberSync(fresh, conf, job.count, job.reason || 'Verifizierter Discord Server-Boost');
      return;
    }
    if (attempt >= BOOST_VERIFICATION_DELAYS_MS.length) {
      boostVerificationJobs.delete(key);
      reportSyncDiagnostic(
        member.guild.id,
        `boost-status-timeout:${member.id}`,
        `${member.guild.name}: Boost für ${member.user?.tag || member.id} erkannt, Discord meldet das Mitglied nach mehreren Prüfungen aber noch nicht als aktiven Booster. Es wurde sicherheitshalber keine Rolle vergeben.`
      );
      return;
    }
    job.timer = setTimeout(() => void verify(attempt + 1), BOOST_VERIFICATION_DELAYS_MS[attempt]);
    job.timer.unref?.();
  };

  void verify(0);
};

const registerLedgerEvent = async ({ message, member, userId, type, delta = 1, reportedCount = 0, source = 'unknown' }) => {
  const result = await mutateLedger((data) => {
  const guildLedger = getGuildLedger(data, message.guild.id);
  if (guildLedger.processedMessages.includes(message.id)) {
    const record = getMemberRecord(guildLedger, userId);
    const correctedCount = member && isActiveDiscordBooster(member)
      ? verifiedBoostCountForMember(member, guildLedger.events, guildLedger.activityImport)
      : Number(record.count || 0);
    record.count = correctedCount;
    record.automaticCount = correctedCount;
    return { duplicate: true, count: correctedCount };
  }
  guildLedger.processedMessages.push(message.id);
  guildLedger.processedMessages = guildLedger.processedMessages.slice(-MAX_PROCESSED_MESSAGES);
  const timestamp = message.createdTimestamp || Date.now();
  const positiveEvidence = type === 'boost' || type === 'boost-info';
  const normalizedDelta = positiveEvidence
    ? Math.max(1, Number(delta) || 1)
    : type === 'expired' ? -1 : 0;
  const normalizedReportedCount = type === 'boost' ? Math.max(0, Math.floor(Number(reportedCount) || 0)) : 0;
  const nativeActive = isActiveDiscordBooster(member);
  const cycleStartedAt = currentBoostCycleStart(member);
  const belongsToCycle = !['boost', 'boost-info', 'expired'].includes(type) || isCurrentBoostCycleEvent(member, timestamp);
  const accepted = belongsToCycle && !(type === 'ended' && nativeActive);
  const additionalBoost = positiveEvidence && accepted && isAdditionalBoostEvent(member, timestamp);
  const event = {
    messageId: message.id,
    type,
    source,
    userId,
    timestamp,
    channelId: message.channelId,
    discordMessageType: BOOST_MESSAGE_TYPES.has(Number(message.type)) ? Number(message.type) : null,
    delta: normalizedDelta,
    reportedCount: normalizedReportedCount,
    accepted,
    nativeActiveAtCapture: nativeActive,
    cycleStartedAt
  };
  event.countedDelta = additionalBoost ? normalizedDelta : 0;
  event.matchedUnits = 0;
  guildLedger.events.push(event);
  guildLedger.events = guildLedger.events.slice(-MAX_LEDGER_EVENTS);
  const record = getMemberRecord(guildLedger, userId);
  if (nativeActive && cycleStartedAt && record.cycleStartedAt !== cycleStartedAt) {
    Object.assign(record, createMemberRecord(1, 'discord-system-role-baseline', cycleStartedAt));
  } else if (nativeActive && Number(record.count || 0) < 1) {
    record.count = 1;
    record.automaticCount = 1;
    record.active = true;
  }
  const previousCount = Math.max(0, Number(record.count) || 0);
  record.count = accepted && type === 'ended'
    ? 0
    : accepted && ['boost', 'boost-info', 'expired'].includes(type) && nativeActive
      ? verifiedBoostCountForMember(member, guildLedger.events, guildLedger.activityImport)
      : previousCount;
  event.countedDelta = record.count - previousCount;
  record.automaticCount = record.count;
  record.highestReportedCount = accepted && type === 'ended'
    ? 0
    : Math.max(normalizedReportedCount, Number(record.highestReportedCount || 0));
  record.reportedCountConfirmed = accepted && type === 'ended'
    ? false
    : Boolean(record.reportedCountConfirmed || normalizedReportedCount > 0);
  record.active = record.count > 0;
  record.source = nativeActive
    ? (type === 'expired' || additionalBoost ? source : 'discord-system-role-baseline')
    : source;
  if (cycleStartedAt) record.cycleStartedAt = cycleStartedAt;
  updateRecordEvidence(record, event);
  record.updatedAt = new Date().toISOString();
  return {
    duplicate: false,
    count: record.count,
    countedDelta: event.countedDelta,
    corroborated: positiveEvidence && event.countedDelta === 0,
    accepted,
    stateChanged: accepted && (type === 'ended' || record.count !== previousCount)
  };
  });
  rememberCompletedLedgerEvent(message.guild.id, message.id, {
    ...result,
    userId: String(userId || ''),
    type,
    source
  });
  return result;
};

export const getBoostKnowledgeContext = async (guildId, { guild = null, discordBoostCount = null } = {}) => {
  const data = await loadLedger();
  const guildLedger = getGuildLedger(data, String(guildId || ''));
  const isCurrentMember = (userId) => !guild || guild.members?.cache?.has?.(String(userId || ''));
  const events = [...guildLedger.events]
    .filter(isNativeBoostLedgerEvent)
    .filter((event) => isCurrentMember(event.userId))
    .sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
  const latestBoost = events.find((event) => event.type === 'boost');
  const activeRows = Object.entries(guildLedger.members)
    .filter(([userId, record]) => Number(record?.count || 0) > 0 && isCurrentMember(userId))
    .filter(([userId]) => !guild || Boolean(guild.members.cache.get(String(userId))?.premiumSinceTimestamp));
  const assignedBoostCount = activeRows.reduce((total, [, record]) => total + Number(record?.count || 0), 0);
  const expectedBoostCount = Number.isFinite(Number(discordBoostCount))
    ? Number(discordBoostCount)
    : Number(guild?.premiumSubscriptionCount || 0);
  const consistent = !guild || assignedBoostCount === expectedBoostCount;
  const active = consistent
    ? activeRows.map(([userId, record]) => `<@${userId}>: ${Number(record.count)} Boost${Number(record.count) === 1 ? '' : 's'}`)
    : [];
  return [
    'VERIFIZIERTER BOOST-LEDGER (Discord-premiumSince und native Systemmeldungen):',
    latestBoost ? `Letzter registrierter Boost: <@${latestBoost.userId}> am ${new Date(latestBoost.timestamp).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}.` : 'Noch kein verifizierter Boost registriert.',
    consistent
      ? (active.length ? `Aktive, im Ledger und Discord bestätigte Booster: ${active.join(', ')}.` : 'Im Ledger ist aktuell kein aktiver, noch auf dem Server befindlicher Booster vermerkt.')
      : `Der Ledger ist nicht konsistent mit Discord (${assignedBoostCount} zugeordnet, ${expectedBoostCount} von Discord). Deshalb wird keine Personenliste ausgegeben.`,
    'Behaupte keine anderen Namen oder Anzahlen.'
  ].filter(Boolean).join('\n');
};

const BOOST_SOURCE_LABELS = {
  'native-system': 'Discord-System',
  'native-system-index': 'Discord-Systemindex',
  'discord-system-role-baseline': 'Discord-Boosterrolle',
  'discord-activity-baseline-edit': 'Korrigierte Boost-Basis',
  'trusted-boost-loss': 'Boost-Log · bestätigt',
  'trusted-boost-loss-index': 'Boost-Log · Serverindex',
  'boost-info-live': 'Boost-Info · live',
  'boost-info-index': 'Boost-Info · Serverindex',
  'discord-activity-import': 'Discord-Boost-Aktivitätsliste'
};

export const evaluateBoostConsistency = ({
  assignedBoostCount = 0,
  discordBoostCount = 0,
  events = [],
  nowTimestamp = Date.now()
} = {}) => {
  const assigned = Math.max(0, Math.floor(Number(assignedBoostCount) || 0));
  const discord = Math.max(0, Math.floor(Number(discordBoostCount) || 0));
  const rawDifference = assigned - discord;
  const latestEvidenceAt = (Array.isArray(events) ? events : []).reduce((latest, event) => (
    isNativeBoostLedgerEvent(event) ? Math.max(latest, Number(event?.timestamp || 0)) : latest
  ), 0);
  const evidenceAgeMs = latestEvidenceAt > 0 ? Math.max(0, Number(nowTimestamp || Date.now()) - latestEvidenceAt) : null;
  const graceMs = rawDifference < 0 ? BOOST_LOSS_SYNC_GRACE_MS : BOOST_GAIN_SYNC_GRACE_MS;
  const pending = rawDifference !== 0 && evidenceAgeMs !== null && evidenceAgeMs <= graceMs;
  const state = rawDifference === 0 ? 'synchronized' : pending ? 'discord-pending' : 'mismatch';
  return {
    state,
    countsMatch: state !== 'mismatch',
    assignedBoostCount: assigned,
    discordBoostCount: discord,
    rawDifference,
    boostCountDifference: pending ? 0 : rawDifference,
    latestEvidenceAt: latestEvidenceAt ? new Date(latestEvidenceAt).toISOString() : null,
    evidenceAgeMs,
    distributionLocked: state === 'mismatch'
  };
};

export const getBoostStatusSnapshot = async (guild) => {
  if (!guild?.id) return { active: [], ended: [], unclear: [], events: [] };
  const data = await loadLedger();
  const guildLedger = getGuildLedger(data, guild.id);
  const events = [...guildLedger.events].sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
  const timelineEvents = events;
  const latestByUser = new Map();
  events.forEach((event) => {
    if (event?.userId && !latestByUser.has(event.userId)) latestByUser.set(event.userId, event);
  });

  const userIds = new Set(Object.keys(guildLedger.members || {}));
  guild.members.cache.forEach((member) => {
    if (!member.user?.bot && isActiveDiscordBooster(member)) userIds.add(member.id);
  });

  const groups = { active: [], ended: [], unclear: [] };
  const statusByUser = new Map();
  for (const userId of userIds) {
    const member = guild.members.cache.get(userId) || null;
    const record = guildLedger.members?.[userId] || createMemberRecord(0, 'discord-live');
    const latest = latestByUser.get(userId) || null;
    const nativeActive = Boolean(member && isActiveDiscordBooster(member));
    const automaticBoostCount = nativeActive
      ? verifiedBoostCountForMember(member, guildLedger.events, guildLedger.activityImport)
      : 0;
    const effectiveBoostCount = nativeActive ? automaticBoostCount : 0;
    let status = 'ended';
    if (nativeActive) status = 'active';
    else if (Number(record.count || 0) > 0 && latest?.type !== 'ended') status = 'unclear';
    statusByUser.set(userId, status);
    groups[status].push({
      id: userId,
      mention: `<@${userId}>`,
      displayName: member?.displayName || member?.user?.globalName || member?.user?.username || `Mitglied ${userId}`,
      username: member?.user?.username || userId,
      avatar: resolveBoostAvatarUrl(member?.user || member, { size: 128 }),
      avatarUrl: resolveBoostAvatarUrl(member?.user || member, { size: 128 }),
      premiumSince: member?.premiumSince?.toISOString?.() || null,
      boostCount: effectiveBoostCount,
      automaticBoostCount,
      reportedBoostCount: nativeActive ? Math.max(0, Number(record.highestReportedCount || 0)) : 0,
      nativeActive,
      source: record.source || latest?.source || 'unknown',
      sourceLabel: BOOST_SOURCE_LABELS[record.source] || record.source || 'Unbekannt',
      confidence: record.confidence || (automaticBoostCount > 1 ? 'medium' : 'low'),
      cycleStartedAt: currentBoostCycleStart(member) || Number(record.cycleStartedAt || 0),
      evidenceCount: Array.isArray(record.evidenceMessageIds) ? record.evidenceMessageIds.length : 0,
      lastReconciledAt: record.lastReconciledAt || null,
      updatedAt: latest?.timestamp ? new Date(latest.timestamp).toISOString() : record.updatedAt || null,
      lastEventType: latest?.type || null,
      lastEventSource: latest?.source || null
    });
  }

  groups.active.sort((a, b) => Number(b.boostCount || 0) - Number(a.boostCount || 0)
    || new Date(a.premiumSince || 0) - new Date(b.premiumSince || 0));
  groups.ended.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  groups.unclear.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));

  const assignedBoostCount = groups.active.reduce((sum, member) => sum + Math.max(1, Number(member.boostCount || 0)), 0);
  const discordBoostCount = Math.max(0, Number(guild.premiumSubscriptionCount || 0));
  const consistency = evaluateBoostConsistency({
    assignedBoostCount,
    discordBoostCount,
    events: timelineEvents
  });
  guildLedger.consistency = {
    ...consistency,
    checkedAt: new Date().toISOString()
  };

  return {
    active: groups.active,
    ended: groups.ended.slice(0, 200),
    unclear: groups.unclear.slice(0, 200),
    summary: {
      activeBoosterCount: groups.active.length,
      assignedBoostCount,
      discordBoostCount,
      unresolvedBoostCount: Math.max(0, discordBoostCount - assignedBoostCount),
      boostCountDifference: consistency.boostCountDifference,
      rawBoostCountDifference: consistency.rawDifference,
      countsMatch: consistency.countsMatch,
      consistencyState: consistency.state,
      latestEvidenceAt: consistency.latestEvidenceAt,
      distributionLocked: consistency.distributionLocked
    },
    activityImport: guildLedger.activityImport ? {
      importedAt: guildLedger.activityImport.importedAt || null,
      baselineCompletedAt: guildLedger.activityImport.baselineCompletedAt || guildLedger.activityImport.importedAt || null,
      baselineSource: guildLedger.activityImport.baselineSource || 'discord-activity-list',
      totalRows: Number(guildLedger.activityImport.totalRows || 0),
      matchedRows: Number(guildLedger.activityImport.matchedRows || 0),
      unresolvedRows: Number(guildLedger.activityImport.unresolvedRows || 0),
      ignoredRows: Number(guildLedger.activityImport.ignoredRows ?? guildLedger.activityImport.unresolvedRows ?? 0),
      baselineMemberCount: Object.keys(guildLedger.activityImport.memberBaselines || {}).length,
      discordBoostCount: Number(guildLedger.activityImport.discordBoostCount || 0),
      calculatedBoostCount: Number(guildLedger.activityImport.calculatedBoostCount || 0),
      editCount: Array.isArray(guildLedger.activityImport.editAudit) ? guildLedger.activityImport.editAudit.length : 0
    } : null,
    events: timelineEvents.slice(0, 300).map((event) => ({
      messageId: event.messageId || event.id || '',
      channelId: event.channelId || '',
      userId: event.userId || '',
      type: event.type,
      source: event.source,
      sourceLabel: BOOST_SOURCE_LABELS[event.source] || event.source || 'Unbekannt',
      delta: Number(event.countedDelta ?? event.delta ?? 0),
      timestamp: Number(event.timestamp || 0),
      currentStatus: statusByUser.get(event.userId) || 'unclear',
      actorId: event.actorId || '',
      reason: event.reason || '',
      mode: event.mode || ''
    }))
  };
};

// Personal answers must use the same per-member value that is displayed and
// edited in the Control Center. A global Discord/ledger mismatch can pause
// automatic distribution, but it must not hide a deliberately confirmed
// member baseline.
export const getConfirmedMemberBoostCount = async (guild, userId) => {
  const targetId = String(userId || '').trim();
  if (!guild?.id || !targetId) return null;
  const member = guild.members.cache.get(targetId) || await guild.members.fetch(targetId).catch(() => null);
  if (!member || member.user?.bot) return null;
  const snapshot = await getBoostStatusSnapshot(guild);
  const data = await loadLedger();
  const memberBaseline = getGuildLedger(data, guild.id).activityImport?.memberBaselines?.[targetId] || null;
  const row = (snapshot.active || []).find((entry) => String(entry.id || entry.userId || '') === targetId);
  if (!row) {
    return {
      userId: targetId,
      active: false,
      count: 0,
      source: 'discord-live',
      sourceLabel: 'Discord-Livestatus',
      confirmedInApp: false,
      globalConsistencyState: snapshot.summary?.consistencyState || 'unknown'
    };
  }
  const source = String(row.source || 'unknown');
  return {
    userId: targetId,
    active: row.nativeActive === true,
    count: Math.max(0, Math.floor(Number(row.boostCount || 0))),
    source,
    sourceLabel: row.sourceLabel || BOOST_SOURCE_LABELS[source] || source,
    confirmedInApp: memberBaseline?.source === 'manual-baseline-correction'
      || ['discord-activity-baseline-edit', 'manual-baseline-correction'].includes(source),
    confirmedBaselineCount: memberBaseline ? Math.max(0, Math.floor(Number(memberBaseline.count || 0))) : null,
    updatedAt: row.updatedAt || null,
    globalConsistencyState: snapshot.summary?.consistencyState || 'unknown'
  };
};

export const verifyBoostCount = async ({ guild, conf, userId, actorId = '' }) => {
  if (!guild?.id) throw new Error('Server wurde nicht gefunden.');
  if (!conf?.enabled) throw new Error('Das Booster-Rollen-Modul ist nicht aktiviert.');
  const targetId = String(userId || '').trim();
  const member = guild.members.cache.get(targetId) || await guild.members.fetch(targetId).catch(() => null);
  if (!member || member.user?.bot) throw new Error('Das ausgewählte Mitglied wurde nicht gefunden.');
  if (!isActiveDiscordBooster(member)) throw new Error('Das Mitglied ist laut Discord aktuell kein aktiver Booster.');

  const data = await loadLedger();
  const guildLedger = getGuildLedger(data, guild.id);
  const cycleStartedAt = currentBoostCycleStart(member);
  const nativeEvents = (guildLedger.events || []).filter((event) => event?.type === 'boost'
    && String(event.userId || '') === member.id
    && String(event.source || '').startsWith('native-system')
    && cycleStartedAt > 0
    && Number(event.timestamp || 0) >= cycleStartedAt
    && Number(event.timestamp || 0) <= Date.now());
  const confirmedEventsById = new Map();
  for (const event of nativeEvents) {
    confirmedEventsById.set(String(event.messageId || event.id || ''), event);
  }
  const confirmedEvents = [...confirmedEventsById.values()].filter((event) => event.messageId || event.id);
  const verifiedCount = verifiedBoostCountForMember(member, confirmedEvents, guildLedger.activityImport);
  await queueMemberSync(member, conf, verifiedCount, `Discord-Boost-Anzahl verifiziert${actorId ? ` durch ${actorId}` : ''}`);
  return {
    userId: member.id,
    count: verifiedCount,
    verified: true,
    source: 'discord-system-message',
    evidenceMessageIds: [...new Set(confirmedEvents.map((event) => String(event.messageId || event.id || '')).filter(Boolean))]
  };
};

const fetchChannelHistory = async (channel, { limit = 0, oldestTimestamp = 0, afterMessageId = '' } = {}) => {
  const messages = [];
  let cursor = String(afterMessageId || '');
  const unlimited = Number(limit) <= 0;
  try {
    if (cursor) {
      while (unlimited || messages.length < limit) {
        const pageSize = unlimited ? 100 : Math.min(100, limit - messages.length);
        const page = await channel.messages.fetch({ limit: pageSize, after: cursor });
        if (!page.size) break;
        const ordered = [...page.values()].sort((left, right) => Number(left.createdTimestamp || 0) - Number(right.createdTimestamp || 0));
        messages.push(...ordered);
        const nextCursor = String(ordered.at(-1)?.id || '');
        if (!nextCursor || nextCursor === cursor || page.size < pageSize) break;
        cursor = nextCursor;
      }
    } else {
      let before = '';
      while (unlimited || messages.length < limit) {
        const pageSize = unlimited ? 100 : Math.min(100, limit - messages.length);
        const page = await channel.messages.fetch({ limit: pageSize, ...(before ? { before } : {}) });
        if (!page.size) break;
        messages.push(...page.values());
        const nextBefore = String(page.last()?.id || '');
        const oldestInPage = Number(page.last()?.createdTimestamp || 0);
        if (oldestTimestamp > 0 && oldestInPage > 0 && oldestInPage <= oldestTimestamp) break;
        if (!nextBefore || nextBefore === before || page.size < pageSize) break;
        before = nextBefore;
      }
    }
    const newest = [...messages].sort((left, right) => Number(right.createdTimestamp || 0) - Number(left.createdTimestamp || 0))[0] || null;
    return { ok: true, channelId: channel.id, messages, newestMessageId: String(newest?.id || afterMessageId || '') };
  } catch (error) {
    console.error(`[boostRoles] Verlauf aus #${channel.name} konnte nicht gelesen werden`, error);
    return { ok: false, channelId: channel.id, messages: [], newestMessageId: String(afterMessageId || '') };
  }
};

const rebuildLedgerFromHistory = async (guild, conf, options = {}) => {
  const reportProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  reportProgress({ progress: 10, stage: 'Discord-Systemnachrichten werden vorbereitet' });
  const channelPlans = new Map();
  const addChannel = (channel) => {
    if (!channel) return;
    channelPlans.set(channel.id, { channel });
  };
  getBoostEvidenceChannels(guild, conf).forEach(addChannel);
  const dataBeforeScan = await loadLedger();
  const guildLedgerBeforeScan = getGuildLedger(dataBeforeScan, guild.id);
  const checkpoints = guildLedgerBeforeScan.historyCheckpoints || {};
  const fullHistory = conf?.fullHistoryScan !== false;
  const compatibilityLimit = Math.min(50000, Math.max(100, Number(conf?.historyScanLimit || 2000)));
  const activeCycleStarts = guild.members.cache
    .filter((member) => !member.user?.bot && isActiveDiscordBooster(member))
    .map((member) => Number(member.premiumSinceTimestamp || member.premiumSince?.getTime?.() || 0))
    .filter((timestamp) => timestamp > 0);
  const oldestActiveCycle = activeCycleStarts.length ? Math.min(...activeCycleStarts) : 0;
  const plans = [...channelPlans.values()];
  let completedChannels = 0;
  const histories = await Promise.all(plans.map(async (plan) => {
    const checkpoint = checkpoints[plan.channel.id] || {};
    const history = await fetchChannelHistory(plan.channel, {
      // The persistent server index below is the complete cross-channel source.
      // Keep the live Discord request deliberately small so startup cannot be
      // held for minutes by years of messages in a busy system channel.
      limit: fullHistory ? Math.min(100, compatibilityLimit) : compatibilityLimit,
      oldestTimestamp: checkpoint.newestMessageId ? 0 : oldestActiveCycle,
      afterMessageId: checkpoint.newestMessageId || ''
    });
    completedChannels += 1;
    reportProgress({
      progress: 10 + Math.round((completedChannels / Math.max(1, plans.length)) * 40),
      stage: 'Boost-Historie wird geladen',
      detail: `${completedChannels} von ${plans.length} Quellkanälen`,
      completedUnits: completedChannels,
      totalUnits: plans.length
    });
    return history;
  }));
  if (histories.length && !histories.some((history) => history.ok)) return false;

  const events = [];
  reportProgress({ progress: 55, stage: 'Boost-Ereignisse werden ausgewertet' });
  for (const message of histories.flatMap((history) => history.messages)) {
    const trustedLoss = parseTrustedBoostLossMessage(message, conf);
    const boostInfo = trustedLoss ? null : parseBoostInfoMessage(message, conf);
    const nativeBoost = BOOST_MESSAGE_TYPES.has(Number(message.type));
    if (!trustedLoss && !boostInfo && !nativeBoost) continue;
    const userId = String(trustedLoss?.userId || boostInfo?.userId || message.author?.id || '');
    const member = guild.members.cache.get(userId)
      || await guild.members.fetch(userId).catch(() => null);
    if (!member || !isActiveDiscordBooster(member)) continue;
    const eventTimestamp = Number(message.createdTimestamp || 0);
    if (!isCurrentBoostCycleEvent(member, eventTimestamp)) continue;
    events.push({
      id: message.id,
      messageId: message.id,
      channelId: message.channelId,
      userId: member.id,
      type: trustedLoss ? 'expired' : boostInfo ? 'boost-info' : 'boost',
      source: trustedLoss ? 'trusted-boost-loss' : boostInfo ? 'boost-info-live' : 'native-system',
      delta: trustedLoss ? -1 : 1,
      reportedCount: nativeBoost ? nativeReportedBoostCount(message) : 0,
      discordMessageType: nativeBoost ? Number(message.type) : null,
      timestamp: eventTimestamp
    });
  }
  try {
    const activeBoosters = [...guild.members.cache.values()].filter(isActiveDiscordBooster);
    const activeUserIds = activeBoosters.map((member) => member.id);
    const premiumSinceValues = activeBoosters
      .map((member) => Number(member.premiumSinceTimestamp || member.premiumSince?.getTime?.() || 0))
      .filter((timestamp) => timestamp > 0);
    const since = premiumSinceValues.length
      ? Math.max(0, Math.min(...premiumSinceValues))
      : Date.now() - (180 * 24 * 60 * 60 * 1000);
    const nativeChannelIds = [...guild.channels.cache.values()]
      .filter((channel) => channel?.isTextBased?.())
      .map((channel) => channel.id);
    const { getIndexedBoostEvidenceEvents, getIndexedNativeBoostEvents } = await import('./boostSystemIndex.js');
    const indexedEvents = await getIndexedNativeBoostEvents({
      guild,
      channelIds: nativeChannelIds,
      activeUserIds,
      since,
      maxLegacyChecks: 0
    });
    const evidenceChannelIds = getBoostEvidenceChannels(guild, conf).map((channel) => channel.id);
    const indexedEvidence = getIndexedBoostEvidenceEvents({
      guildId: guild.id,
      channelIds: evidenceChannelIds,
      activeUserIds,
      since
    });
    events.push(...indexedEvents, ...indexedEvidence);
  } catch (error) {
    console.warn(`[Boost-Rollen] Native Systemhistorie aus dem Serverindex konnte nicht gelesen werden: ${error.message}`);
  }

  events.sort((a, b) => a.timestamp - b.timestamp);
  reportProgress({
    progress: 72,
    stage: 'Boost-Ledger wird rekonstruiert',
    detail: `${events.length.toLocaleString('de-DE')} relevante Ereignisse`
  });

  await mutateLedger((data) => {
    const guildLedger = getGuildLedger(data, guild.id);
    const mergedEvents = new Map();
    for (const event of (guildLedger.events || []).filter(isNativeBoostLedgerEvent)) {
      const eventId = String(event.messageId || event.id || '');
      if (eventId) mergedEvents.set(eventId, { ...event });
    }
    for (const event of events) mergedEvents.set(String(event.messageId || event.id), { ...event });
    const chronologicalEvents = [...mergedEvents.values()]
      .map((event) => {
        const discordMessageType = Number(event.discordMessageType ?? (Number(event.type) || 0));
        const nativeBoost = BOOST_MESSAGE_TYPES.has(discordMessageType);
        return {
          ...event,
          type: nativeBoost ? 'boost' : event.type,
          source: nativeBoost && !event.source ? 'native-system-index' : event.source,
          discordMessageType: nativeBoost ? discordMessageType : (event.discordMessageType ?? null),
          delta: nativeBoost ? Math.max(1, Number(event.delta || 1)) : event.delta,
          reportedCount: Math.max(0, Number(event.reportedCount || 0))
        };
      })
      .filter((event) => {
        const member = guild.members.cache.get(String(event.userId || ''));
        return isCurrentBoostCycleEvent(member, Number(event.timestamp || 0));
      })
      .sort((left, right) => Number(left.timestamp || 0) - Number(right.timestamp || 0))
      .slice(-MAX_LEDGER_EVENTS);
    guildLedger.members = {};
    guildLedger.processedMessages = [];
    guildLedger.events = [];
    for (const member of guild.members.cache.values()) {
      if (member.user?.bot || !isActiveDiscordBooster(member)) continue;
      guildLedger.members[member.id] = createMemberRecord(1, 'discord-system-role-baseline', currentBoostCycleStart(member));
    }
    for (const event of chronologicalEvents) {
      event.matchedUnits = 0;
      event.corroboratedBy = [];
      const member = guild.members.cache.get(String(event.userId || '')) || null;
      const cycleStartedAt = currentBoostCycleStart(member);
      const record = getMemberRecord(guildLedger, event.userId);
      const additionalBoost = isAdditionalBoostEvent(member, event.timestamp);
      const previousCount = Math.max(1, Number(record.count || 1));
      const reportedCount = additionalBoost ? Math.max(0, Number(event.reportedCount || 0)) : 0;
      guildLedger.events.push(event);
      record.count = verifiedBoostCountForMember(member, guildLedger.events, guildLedger.activityImport);
      event.countedDelta = Math.max(0, record.count - previousCount);
      record.automaticCount = record.count;
      record.highestReportedCount = Math.max(reportedCount, Number(record.highestReportedCount || 1));
      record.reportedCountConfirmed = Boolean(record.reportedCountConfirmed || reportedCount > 0);
      record.active = record.count > 0;
      record.source = additionalBoost ? `history-${event.source}` : 'discord-system-role-baseline';
      record.updatedAt = new Date(event.timestamp || Date.now()).toISOString();
      if (cycleStartedAt) record.cycleStartedAt = cycleStartedAt;
      updateRecordEvidence(record, event);
      guildLedger.processedMessages.push(event.messageId || event.id);
    }
    guildLedger.processedMessages = guildLedger.processedMessages.slice(-MAX_PROCESSED_MESSAGES);
    for (const history of histories) {
      if (!history.ok || !history.channelId) continue;
      const previous = guildLedger.historyCheckpoints[history.channelId] || {};
      guildLedger.historyCheckpoints[history.channelId] = {
        newestMessageId: history.newestMessageId || previous.newestMessageId || '',
        lastSuccessfulScanAt: new Date().toISOString(),
        fullHistory
      };
    }
    guildLedger.lastHistoryScanAt = new Date().toISOString();
    guildLedger.evidenceSchemaVersion = 1;
  });
  console.log(`[boostRoles] ${guild.name}: ${events.length} relevante Boost-Events aus den Quellkanälen rekonstruiert.`);
  return true;
};

const reconcileGuild = async (guild, conf, options = {}) => {
  if (!conf?.enabled) return;
  const reportProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const fetchMembers = options.fetchMembers !== false;
  const rebuildHistory = options.rebuildHistory === true;
  reportProgress({ progress: 2, stage: 'Discord-System-Boosterrolle wird geprüft' });
  await guild.roles.fetch().catch((error) => {
    reportSyncDiagnostic(guild.id, 'system-booster-role-fetch', `${guild.name}: Discord-Systemrollen konnten nicht aktualisiert werden.`, error);
    return guild.roles.cache;
  });
  const systemBoosterRole = getNativeDiscordBoosterRole(guild);
  if (!systemBoosterRole) {
    reportSyncDiagnostic(guild.id, 'missing-system-booster-role', `${guild.name}: Die verwaltete Discord-Boosterrolle ist aktuell nicht im Rollen-Cache. Der Abgleich verwendet den eindeutigen premiumSince-Status der Mitglieder.`);
  }
  reportProgress({ progress: 4, stage: 'Discord-Mitglieder werden geladen', detail: systemBoosterRole ? `Systemrolle „${systemBoosterRole.name}“ (${systemBoosterRole.id}) erkannt` : 'Discord-Booststatus wird direkt über premiumSince geprüft' });
  const members = fetchMembers
    ? await guild.members.fetch().catch((error) => {
      console.error(`[boostRoles] Mitgliederabruf für ${guild.name} fehlgeschlagen`, error);
      return guild.members.cache;
    })
    : guild.members.cache;
  const configuredManagedRoleIds = resolveManagedBoosterRoles({
    automaticRoleIds: conf?.automaticRoleIds,
    tierRoleMappings: conf?.tierRoleMappings
  }).managedRoleIds;
  let previousManagedRoleIds = [];
  if (rebuildHistory) await rebuildLedgerFromHistory(guild, conf, { onProgress: reportProgress });
  else {
    reportProgress({ progress: 48, stage: 'Gespeicherte Discord-Systemmeldungen werden geprüft' });
    reportProgress({ progress: 62, stage: 'Gespeicherte einzelne Boost-Events sind aktuell' });
  }
  await mutateLedger((data) => {
    const guildLedger = getGuildLedger(data, guild.id);
    previousManagedRoleIds = parseRoleIds(guildLedger.managedRoleIds);
    guildLedger.managedRoleIds = configuredManagedRoleIds;
    guildLedger.events = (guildLedger.events || []).filter((event) => {
      if (!isNativeBoostLedgerEvent(event)) return false;
      const member = members.get(String(event.userId || ''));
      return isCurrentBoostCycleEvent(member, event.timestamp);
    });
    guildLedger.processedMessages = guildLedger.events
      .map((event) => String(event.messageId || event.id || ''))
      .filter(Boolean)
      .slice(-MAX_PROCESSED_MESSAGES);
    for (const member of members.values()) {
      if (member.user?.bot) continue;
      const activeBooster = isActiveDiscordBooster(member);
      const cycleStartedAt = currentBoostCycleStart(member);
      if (!activeBooster) {
        const record = guildLedger.members[member.id];
        if (record && Number(record.count || 0) > 0) {
          guildLedger.members[member.id] = createMemberRecord(0, 'discord-inactive-validation');
        }
        continue;
      }
      const memberEvents = guildLedger.events.filter((event) => String(event.userId || '') === member.id);
      const verifiedCount = verifiedBoostCountForMember(member, memberEvents, guildLedger.activityImport);
      const hasImportedActivity = guildLedger.activityImport?.rows?.some((row) => String(row.userId || '') === member.id);
      const currentRecord = createMemberRecord(
        verifiedCount,
        hasImportedActivity
          ? 'discord-activity-import'
          : verifiedCount > 1 ? 'native-system-current-cycle' : 'discord-system-role-baseline',
        cycleStartedAt
      );
      currentRecord.confidence = verifiedCount > 1 ? 'high' : 'medium';
      currentRecord.lastReconciledAt = new Date().toISOString();
      currentRecord.highestReportedCount = Math.max(verifiedCount, ...memberEvents.map((event) => Number(event.reportedCount || 0)));
      currentRecord.reportedCountConfirmed = memberEvents.some((event) => isAdditionalBoostEvent(member, event.timestamp) && Number(event.reportedCount || 0) > 1);
      for (const event of memberEvents) {
        updateRecordEvidence(currentRecord, event);
      }
      guildLedger.members[member.id] = currentRecord;
    }
  });

  const data = await loadLedger();
  const guildLedger = getGuildLedger(data, guild.id);
  const knownMembers = guildLedger.members || {};
  const assignedBoostCount = members.reduce((total, member) => {
    if (member.user?.bot || !isActiveDiscordBooster(member)) return total;
    return total + Math.max(1, Number(knownMembers[member.id]?.count || 1));
  }, 0);
  const consistency = evaluateBoostConsistency({
    assignedBoostCount,
    discordBoostCount: Math.max(0, Number(guild.premiumSubscriptionCount || 0)),
    events: guildLedger.events
  });
  const freezeTierRoles = consistency.distributionLocked;
  if (freezeTierRoles) {
    reportSyncDiagnostic(
      guild.id,
      `boost-distribution-lock:${consistency.rawDifference}`,
      `${guild.name}: Unmögliche Boost-Verteilung erkannt (${consistency.assignedBoostCount} persönlich / ${consistency.discordBoostCount} Discord). Der periodische Abgleich verändert keine bestehenden Staffelrollen und verteilt die Differenz niemals auf Mitglieder.`
    );
  }
  const managedRoleIds = new Set([...configuredManagedRoleIds, ...previousManagedRoleIds]);
  const candidates = members.filter((member) => !member.user?.bot && (
    Boolean(knownMembers[member.id])
    || isActiveDiscordBooster(member)
    || member.roles.cache.some((role) => managedRoleIds.has(role.id))
    || removableColorRoleIds(member, conf).length > 0
  ));
  console.log(`[boostRoles] ${guild.name}: ${candidates.size} Booster-/Rollen-Kandidaten werden synchronisiert.`);
  let synchronized = 0;
  reportProgress({
    progress: 84,
    stage: 'Booster-Rollen werden synchronisiert',
    detail: `${candidates.size.toLocaleString('de-DE')} Kandidaten`,
    completedUnits: 0,
    totalUnits: candidates.size
  });
  for (const member of candidates.values()) {
    const record = knownMembers[member.id];
    const activeBooster = isActiveDiscordBooster(member);
    const ledgerCount = record
      ? Math.max(0, Number(record.count) || 0)
      : 0;
    const requestedCount = activeBooster ? Math.max(1, Number(ledgerCount) || 1) : 0;
    const count = activeBooster ? requestedCount : 0;
    await queueMemberSync(
      member,
      conf,
      count,
      'Booster-Rollen Startabgleich',
      !activeBooster || count <= 0,
      previousManagedRoleIds,
      { freezeTierRoles }
    );
    synchronized += 1;
    reportProgress({
      progress: 84 + Math.round((synchronized / Math.max(1, candidates.size)) * 16),
      stage: 'Booster-Rollen werden synchronisiert',
      detail: `${synchronized} von ${candidates.size} Kandidaten`,
      completedUnits: synchronized,
      totalUnits: candidates.size
    });
  }
  console.log(`[boostRoles] ${guild.name}: Rollenabgleich abgeschlossen.`);
  reportProgress({ progress: 100, stage: 'Booster-Abgleich abgeschlossen' });
};

const guildReconcileJobs = new Map();

const scheduleGuildReconcile = (guild, conf, options = {}) => {
  const guildId = String(guild?.id || '');
  if (!guildId) return Promise.resolve();
  const running = guildReconcileJobs.get(guildId);
  if (running) {
    running.next = { conf, options };
    return running.promise;
  }

  const state = { next: { conf, options }, promise: null };
  state.promise = (async () => {
    while (state.next) {
      const job = state.next;
      state.next = null;
      await reconcileGuild(guild, job.conf, job.options);
    }
  })().finally(() => {
    if (guildReconcileJobs.get(guildId) === state) guildReconcileJobs.delete(guildId);
  });
  guildReconcileJobs.set(guildId, state);
  return state.promise;
};

export const waitForBoostRoleReconcile = (guildId) => (
  guildReconcileJobs.get(String(guildId || ''))?.promise || Promise.resolve()
);

export const startBoostRoleReconcile = ({ guild, conf, actorId = '' } = {}) => {
  if (!guild?.id) throw new Error('Server wurde nicht gefunden.');
  if (!conf?.enabled) throw new Error('Das Booster-Rollen-Modul ist nicht aktiviert.');
  const queued = guildReconcileJobs.has(String(guild.id));
  void runTrackedOperation('Manueller Booster-Rollenabgleich', {
    featureId: 'boostRoles',
    hook: 'manualReconcile',
    guildId: guild.id,
    actorId: String(actorId || '')
  }, ({ reportProgress }) => scheduleGuildReconcile(guild, conf, {
    fetchMembers: true,
    rebuildHistory: false,
    onProgress: reportProgress
  }), {
    timeoutMs: 30 * 60_000
  }).catch((error) => {
    console.error(`[boostRoles] Manueller Abgleich für ${guild.name} fehlgeschlagen`, error);
  });
  return { started: true, queued, guildId: guild.id };
};

const normalizeActivityName = (value = '') => String(value || '')
  .normalize('NFKC')
  .replace(/^[^\p{L}\p{N}_<@.]+/u, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLocaleLowerCase('de-DE');

const parseActivityDateKey = (value, todayKey) => {
  const token = String(value || '').trim().replace(/[.,]$/, '');
  if (/^heute$/i.test(token)) return todayKey;
  if (/^gestern$/i.test(token)) return previousDateKey(todayKey);
  const match = token.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return '';
  const dateKey = `${match[3]}-${String(match[2]).padStart(2, '0')}-${String(match[1]).padStart(2, '0')}`;
  const parsed = new Date(`${dateKey}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === dateKey ? dateKey : '';
};

const parseBoostActivityText = (text, snapshotAt = Date.now()) => {
  const todayKey = dateKeyInBerlin(snapshotAt);
  const rows = [];
  const invalid = [];
  for (const [lineIndex, sourceLine] of String(text || '').split(/\r?\n/).entries()) {
    const line = sourceLine.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const dateOnly = parseActivityDateKey(line, todayKey);
    if (dateOnly && rows.length && !rows.at(-1).dateKey) {
      rows.at(-1).dateKey = dateOnly;
      rows.at(-1).timestamp = Date.parse(`${dateOnly}T12:00:00Z`);
      continue;
    }
    const match = line.match(/^(.*?)\s+(?:hat\s+)?1\s+Boost\s+(gegeben|ist\s+abgelaufen)\.?\s*(Heute|Gestern|\d{1,2}\.\d{1,2}\.\d{4})?$/i);
    if (!match) {
      if (/\bBoost\b/i.test(line)) invalid.push({ line: lineIndex + 1, text: line.slice(0, 180) });
      continue;
    }
    const rawName = String(match[1] || '').trim();
    const dateKey = parseActivityDateKey(match[3], todayKey);
    rows.push({
      line: lineIndex + 1,
      rawName,
      normalizedName: normalizeActivityName(rawName),
      action: /abgelaufen/i.test(match[2]) ? 'expired' : 'given',
      dateKey,
      timestamp: dateKey ? Date.parse(`${dateKey}T12:00:00Z`) : 0
    });
  }
  for (const row of rows) {
    if (!row.dateKey) invalid.push({ line: row.line, text: `${row.rawName}: Datum fehlt` });
  }
  return { rows: rows.filter((row) => row.normalizedName && row.dateKey), invalid };
};

const uniqueByMemberId = (members = []) => [...new Map(members.map((member) => [member.id, member])).values()];

const matchActivityMember = (guild, row) => {
  const directId = row.normalizedName.match(/^(?:<@!?)?(\d{15,25})>?$/)?.[1] || '';
  if (directId) {
    const member = guild.members.cache.get(directId);
    return member ? { member, mode: 'id', candidates: [] } : { member: null, mode: 'unmatched', candidates: [] };
  }
  const aliases = [];
  for (const member of guild.members.cache.values()) {
    if (member.user?.bot) continue;
    for (const value of [member.user?.username, member.user?.globalName, member.nickname, member.displayName]) {
      const normalized = normalizeActivityName(value);
      if (normalized) aliases.push({ normalized, member });
    }
  }
  const exact = uniqueByMemberId(aliases.filter((entry) => entry.normalized === row.normalizedName).map((entry) => entry.member));
  if (exact.length === 1) return { member: exact[0], mode: 'exact', candidates: [] };
  if (exact.length > 1) return { member: null, mode: 'ambiguous', candidates: exact };
  const truncated = /(?:\.\.\.|…)\s*$/.test(row.rawName);
  const prefix = normalizeActivityName(row.rawName.replace(/(?:\.\.\.|…)\s*$/, ''));
  if (truncated && prefix.length >= 4) {
    const prefixed = uniqueByMemberId(aliases.filter((entry) => entry.normalized.startsWith(prefix)).map((entry) => entry.member));
    if (prefixed.length === 1) return { member: prefixed[0], mode: 'prefix', candidates: [] };
    if (prefixed.length > 1) return { member: null, mode: 'ambiguous', candidates: prefixed };
  }
  return { member: null, mode: 'unmatched', candidates: [] };
};

const buildBoostActivityPreview = async (guild, text, snapshotAt = Date.now()) => {
  await guild.members.fetch().catch(() => guild.members.cache);
  const parsed = parseBoostActivityText(text, snapshotAt);
  const matchedRows = [];
  const unresolved = [];
  for (const row of parsed.rows) {
    const match = matchActivityMember(guild, row);
    if (match.member) {
      matchedRows.push({
        userId: match.member.id,
        displayName: match.member.displayName,
        username: match.member.user?.username || '',
        action: row.action,
        dateKey: row.dateKey,
        timestamp: row.timestamp,
        rawName: row.rawName,
        matchMode: match.mode
      });
    } else {
      unresolved.push({
        rawName: row.rawName,
        action: row.action,
        dateKey: row.dateKey,
        reason: match.mode,
        candidates: match.candidates.map((member) => ({ id: member.id, displayName: member.displayName }))
      });
    }
  }
  const byMember = new Map();
  for (const row of matchedRows) {
    if (!byMember.has(row.userId)) byMember.set(row.userId, []);
    byMember.get(row.userId).push(row);
  }
  const members = [...byMember.entries()].map(([userId, rows]) => {
    const member = guild.members.cache.get(userId);
    const cycleDateKey = dateKeyInBerlin(currentBoostCycleStart(member));
    const currentRows = rows.filter((row) => !cycleDateKey || row.dateKey >= cycleDateKey);
    const given = currentRows.filter((row) => row.action === 'given').length;
    const expired = currentRows.filter((row) => row.action === 'expired').length;
    const active = isActiveDiscordBooster(member);
    return {
      userId,
      displayName: member?.displayName || rows[0]?.displayName || userId,
      active,
      premiumSince: member?.premiumSince?.toISOString?.() || null,
      given,
      expired,
      count: calculateActivityBaselineCount({
        active,
        rows: currentRows,
        cycleDateKey,
        todayDateKey: dateKeyInBerlin(snapshotAt)
      })
    };
  }).sort((left, right) => Number(right.active) - Number(left.active) || right.count - left.count || left.displayName.localeCompare(right.displayName, 'de'));
  const activeWithoutRows = guild.members.cache
    .filter((member) => !member.user?.bot && isActiveDiscordBooster(member) && !byMember.has(member.id))
    .map((member) => ({ userId: member.id, displayName: member.displayName, username: member.user?.username || '' }));
  const importedByUserId = new Map(members.filter((member) => member.active).map((member) => [member.userId, member]));
  const baselineMembers = guild.members.cache
    .filter((member) => !member.user?.bot && isActiveDiscordBooster(member))
    .map((member) => {
      const imported = importedByUserId.get(member.id);
      return {
        userId: member.id,
        displayName: member.displayName,
        username: member.user?.username || '',
        avatar: resolveBoostAvatarUrl(member.user || member, { size: 128 }),
        avatarUrl: resolveBoostAvatarUrl(member.user || member, { size: 128 }),
        premiumSince: member.premiumSince?.toISOString?.() || null,
        count: Math.max(1, Number(imported?.count || 1)),
        matchedActivity: Boolean(imported)
      };
    })
    .sort((left, right) => right.count - left.count || left.displayName.localeCompare(right.displayName, 'de'));
  const calculatedBoostCount = baselineMembers.reduce((sum, member) => sum + member.count, 0);
  const discordBoostCount = Math.max(0, Number(guild.premiumSubscriptionCount || 0));
  const boostCountDifference = calculatedBoostCount - discordBoostCount;
  return {
    snapshotAt,
    parsedRows: parsed.rows.length,
    matchedRows: matchedRows.length,
    unresolvedRows: unresolved.length,
    ignoredRows: unresolved.length,
    invalidRows: parsed.invalid.length,
    matched: matchedRows,
    unresolved: unresolved.slice(0, 100),
    invalid: parsed.invalid.slice(0, 100),
    members,
    activeWithoutRows,
    baselineMembers,
    calculatedBoostCount,
    discordBoostCount,
    boostCountDifference,
    countsMatch: boostCountDifference === 0,
    canApply: matchedRows.length > 0
  };
};

export const previewBoostActivityImport = async ({ guild, text }) => {
  if (!guild?.id) throw new Error('Server wurde nicht gefunden.');
  return buildBoostActivityPreview(guild, text, Date.now());
};

export const importBoostActivityList = async ({ guild, conf, text, actorId = '' }) => {
  if (!guild?.id) throw new Error('Server wurde nicht gefunden.');
  if (!conf?.enabled) throw new Error('Das Booster-Rollen-Modul ist nicht aktiviert.');
  const preview = await buildBoostActivityPreview(guild, text, Date.now());
  if (!preview.matchedRows) throw new Error('Keine Aktivitätszeile konnte eindeutig einem Servermitglied zugeordnet werden.');
  await mutateLedger((data) => {
    const guildLedger = getGuildLedger(data, guild.id);
    const memberBaselines = Object.fromEntries(preview.baselineMembers.map((member) => [member.userId, {
      count: member.count,
      snapshotAt: preview.snapshotAt,
      cycleStartedAt: Number(guild.members.cache.get(member.userId)?.premiumSinceTimestamp || 0),
      source: member.matchedActivity ? 'discord-activity-list' : 'discord-active-member-fallback',
      editedAt: null,
      editedBy: ''
    }]));
    guildLedger.activityImport = {
      version: 2,
      snapshotAt: preview.snapshotAt,
      importedAt: new Date(preview.snapshotAt).toISOString(),
      baselineCompletedAt: new Date(preview.snapshotAt).toISOString(),
      baselineSource: 'discord-activity-list',
      importedBy: String(actorId || ''),
      totalRows: preview.parsedRows,
      matchedRows: preview.matchedRows,
      unresolvedRows: preview.unresolvedRows,
      ignoredRows: preview.ignoredRows,
      discordBoostCount: preview.discordBoostCount,
      calculatedBoostCount: preview.calculatedBoostCount,
      memberBaselines,
      editAudit: [],
      rows: preview.matched.map((row) => ({
        userId: row.userId,
        action: row.action,
        dateKey: row.dateKey,
        timestamp: row.timestamp,
        rawName: row.rawName,
        matchMode: row.matchMode
      }))
    };
  });
  await scheduleGuildReconcile(guild, conf, { fetchMembers: false, rebuildHistory: false });
  return {
    importedAt: new Date(preview.snapshotAt).toISOString(),
    parsedRows: preview.parsedRows,
    matchedRows: preview.matchedRows,
    unresolvedRows: preview.unresolvedRows,
    ignoredRows: preview.ignoredRows,
    invalidRows: preview.invalidRows,
    members: preview.members,
    activeWithoutRows: preview.activeWithoutRows,
    baselineMembers: preview.baselineMembers,
    calculatedBoostCount: preview.calculatedBoostCount,
    discordBoostCount: preview.discordBoostCount,
    boostCountDifference: preview.boostCountDifference,
    countsMatch: preview.countsMatch
  };
};

export const updateBoostBaselineMember = async ({ guild, conf, userId, count, actorId = '' }) => {
  if (!guild?.id) throw new Error('Server wurde nicht gefunden.');
  if (!conf?.enabled) throw new Error('Das Booster-Rollen-Modul ist nicht aktiviert.');
  const targetId = String(userId || '').trim();
  const targetCount = Number(count);
  if (!Number.isInteger(targetCount) || targetCount < 1 || targetCount > 99) {
    throw new Error('Die Boost-Anzahl muss eine ganze Zahl zwischen 1 und 99 sein.');
  }
  const member = guild.members.cache.get(targetId) || await guild.members.fetch(targetId).catch(() => null);
  if (!member || member.user?.bot) throw new Error('Das ausgewählte Mitglied wurde nicht gefunden.');
  if (!isActiveDiscordBooster(member)) throw new Error('Discord führt dieses Mitglied aktuell nicht als aktiven Booster.');

  const editedAt = Date.now();
  let summary = null;
  await mutateLedger((data) => {
    const guildLedger = getGuildLedger(data, guild.id);
    if (!guildLedger.activityImport?.baselineCompletedAt && !guildLedger.activityImport?.importedAt) {
      throw new Error('Lege zuerst einmalig den Basisstand aus der Discord-Aktivitätsliste an.');
    }
    guildLedger.activityImport.version = 2;
    guildLedger.activityImport.memberBaselines ||= {};
    guildLedger.activityImport.editAudit ||= [];
    const previousCount = verifiedBoostCountForMember(member, guildLedger.events, guildLedger.activityImport);
    guildLedger.activityImport.memberBaselines[targetId] = {
      count: targetCount,
      snapshotAt: editedAt,
      cycleStartedAt: currentBoostCycleStart(member),
      source: 'manual-baseline-correction',
      editedAt: new Date(editedAt).toISOString(),
      editedBy: String(actorId || '')
    };
    guildLedger.activityImport.editAudit.push({
      userId: targetId,
      previousCount,
      count: targetCount,
      editedAt: new Date(editedAt).toISOString(),
      editedBy: String(actorId || '')
    });
    guildLedger.activityImport.editAudit = guildLedger.activityImport.editAudit.slice(-500);
    const record = createMemberRecord(targetCount, 'discord-activity-baseline-edit', currentBoostCycleStart(member));
    record.confidence = 'high';
    record.lastReconciledAt = new Date(editedAt).toISOString();
    guildLedger.members[targetId] = record;
    const activeMembers = guild.members.cache.filter((entry) => !entry.user?.bot && isActiveDiscordBooster(entry));
    const calculatedBoostCount = activeMembers.reduce(
      (total, entry) => total + verifiedBoostCountForMember(entry, guildLedger.events, guildLedger.activityImport),
      0
    );
    const discordBoostCount = Math.max(0, Number(guild.premiumSubscriptionCount || 0));
    guildLedger.activityImport.calculatedBoostCount = calculatedBoostCount;
    guildLedger.activityImport.discordBoostCount = discordBoostCount;
    summary = {
      userId: targetId,
      displayName: member.displayName,
      previousCount,
      count: targetCount,
      calculatedBoostCount,
      discordBoostCount,
      boostCountDifference: calculatedBoostCount - discordBoostCount,
      countsMatch: calculatedBoostCount === discordBoostCount,
      editedAt: new Date(editedAt).toISOString()
    };
  });
  await queueMemberSync(member, conf, targetCount, `Boost-Basis korrigiert${actorId ? ` durch ${actorId}` : ''}`);
  return summary;
};

const ensurePeriodicReconcile = (guild, conf) => {
  const guildId = String(guild?.id || '');
  if (!guildId) return;
  const previous = reconcileTimers.get(guildId);
  if (previous) clearInterval(previous);
  reconcileTimers.delete(guildId);
  if (!conf?.enabled) return;
  setBoostSystemIndexSchedule(guildId, {
    intervalMs: RECONCILE_INTERVAL_MS,
    nextSyncAt: new Date(Date.now() + RECONCILE_INTERVAL_MS).toISOString()
  });
  const timer = setInterval(() => {
    setBoostSystemIndexSchedule(guildId, {
      intervalMs: RECONCILE_INTERVAL_MS,
      lastStartedAt: new Date().toISOString(),
      nextSyncAt: new Date(Date.now() + RECONCILE_INTERVAL_MS).toISOString()
    });
    void Promise.resolve(scheduleGuildReconcile(guild, conf, {
      fetchMembers: false,
      rebuildHistory: false
    })).finally(() => setBoostSystemIndexSchedule(guildId, {
      intervalMs: RECONCILE_INTERVAL_MS,
      lastSyncAt: new Date().toISOString(),
      nextSyncAt: new Date(Date.now() + RECONCILE_INTERVAL_MS).toISOString()
    }));
  }, RECONCILE_INTERVAL_MS);
  timer.unref?.();
  reconcileTimers.set(guildId, timer);
};

export const feature = {
  id: 'boostRoles',
  name: 'Booster-Rollen',

  async onClientReady({ guild, cfg }) {
    ensurePeriodicReconcile(guild, cfg?.boostRoles);
    const rebuildEvidence = await needsBoostEvidenceBackfill(guild.id).catch(() => false);
    void runTrackedOperation('Booster-Basis und Rollenabgleich', {
      featureId: 'boostRoles',
      hook: 'backgroundReconcile',
      guildId: guild.id
    }, ({ reportProgress }) => scheduleGuildReconcile(guild, cfg?.boostRoles, {
      // READY already populated the guild member cache through GuildMembers.
      // A second full websocket member request can stall large guilds and
      // delays all role/economy reconciliation without adding fresher data.
      fetchMembers: false,
      rebuildHistory: rebuildEvidence,
      onProgress: reportProgress
    }), {
      timeoutMs: 30 * 60_000
    }).catch((error) => {
      console.error(`[boostRoles] Startabgleich für ${guild.name} fehlgeschlagen`, error);
    });
  },

  async onConfigUpdate({ guild, cfg, patch }) {
    if (!patch || !Object.prototype.hasOwnProperty.call(patch, 'boostRoles')) return;
    ensurePeriodicReconcile(guild, cfg?.boostRoles);
    void runTrackedOperation('Booster-Konfiguration wird angewendet', {
      featureId: 'boostRoles',
      hook: 'configReconcile',
      guildId: guild.id
    }, ({ reportProgress }) => scheduleGuildReconcile(guild, cfg?.boostRoles, {
      fetchMembers: false,
      rebuildHistory: false,
      onProgress: reportProgress
    }), {
      timeoutMs: 30 * 60_000
    }).catch((error) => {
      console.error(`[boostRoles] Konfigurationsabgleich für ${guild.name} fehlgeschlagen`, error);
    });
  },

  async onMessageCreate({ message, cfg }) {
    const conf = cfg?.boostRoles;
    if (!conf?.enabled || !message?.guild) return;
    const trustedLoss = parseTrustedBoostLossMessage(message, conf);
    if (trustedLoss) {
      const member = message.guild.members.cache.get(trustedLoss.userId)
        || await message.guild.members.fetch(trustedLoss.userId).catch(() => null);
      const result = await registerLedgerEvent({
        message,
        member,
        userId: trustedLoss.userId,
        type: 'expired',
        delta: -1,
        source: 'trusted-boost-loss'
      });
      if (!result.duplicate && result.accepted && member) {
        await queueMemberSync(
          member,
          conf,
          result.count,
          'Bestätigte Boost-Beendigung aus Boost-Log',
          !isActiveDiscordBooster(member) || result.count <= 0
        );
      }
      return;
    }
    const boostInfo = parseBoostInfoMessage(message, conf);
    if (boostInfo) {
      const member = message.guild.members.cache.get(boostInfo.userId)
        || await message.guild.members.fetch(boostInfo.userId).catch(() => null);
      const result = await registerLedgerEvent({
        message,
        member,
        userId: boostInfo.userId,
        type: 'boost-info',
        delta: 1,
        source: 'boost-info-live'
      });
      if (!result.duplicate && result.stateChanged && member) {
        scheduleVerifiedBoostSync(member, conf, result.count, 'Bestätigte Boost-Info');
      }
      return;
    }
    if (!BOOST_MESSAGE_TYPES.has(Number(message.type))) return;
    const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
    const result = await registerLedgerEvent({
      message,
      member,
      userId: message.author.id,
      type: 'boost',
      delta: 1,
      reportedCount: nativeReportedBoostCount(message),
      source: 'native-system'
    });
    if (!result.duplicate && result.stateChanged) {
      if (member) scheduleVerifiedBoostSync(member, conf, result.count, 'Nativer Discord Server-Boost');
    }
  },

  async onBotMessageCreate({ message, cfg }) {
    await feature.onMessageCreate({ message, cfg });
  },

  async onGuildMemberUpdate({ oldMember, newMember, cfg }) {
    const conf = cfg?.boostRoles;
    if (!conf?.enabled || !newMember?.guild || newMember.user?.bot) return;
    const wasBoosting = isActiveDiscordBooster(oldMember);
    const isBoosting = isActiveDiscordBooster(newMember);
    const cycleChanged = isBoosting && currentBoostCycleStart(oldMember) !== currentBoostCycleStart(newMember);
    if (wasBoosting === isBoosting && !cycleChanged) return;

    if (isBoosting && (!wasBoosting || cycleChanged)) {
      const count = 1;
      await mutateLedger((data) => {
        const guildLedger = getGuildLedger(data, newMember.guild.id);
        guildLedger.members[newMember.id] = createMemberRecord(count, 'discord-system-role-baseline', currentBoostCycleStart(newMember));
      });
      await queueMemberSync(newMember, conf, count, 'Discord-System-Boosterrolle bestätigt');
      void scheduleGuildReconcile(newMember.guild, conf, { fetchMembers: false, rebuildHistory: false });
    }
    if (wasBoosting && !isBoosting) {
      await mutateLedger((data) => {
        const guildLedger = getGuildLedger(data, newMember.guild.id);
        guildLedger.members[newMember.id] = createMemberRecord(0, 'discord-system-role-removed');
      });
      await queueMemberSync(newMember, conf, 0, 'Discord Boost vollständig beendet', true);
    }
  },

  async onGuildMemberRemove({ member }) {
    if (!member?.guild?.id || !member.id) return;
    await mutateLedger((data) => {
      const members = data.guilds?.[member.guild.id]?.members;
      if (members) delete members[member.id];
    });
  }
};
