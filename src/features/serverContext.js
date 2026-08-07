import fs from 'node:fs/promises';
import path from 'node:path';
import {
  formatDiscordSystemEventText,
  getDiscordSystemEventCategory,
  getDiscordSystemEventLabel,
  getDiscordSystemEventName,
  getServerIndexSystemEvents,
  persistServerIndexMessages
} from '../serverIndexStore.js';

const DATA_ROOT = path.join(process.env.FALLEN_HEAVEN_DATA_DIR || path.join(process.cwd(), 'data'), 'server-context');
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TEXT_LENGTH = 6000;
const MAX_TAIL_BYTES = 384 * 1024;
const writeQueues = new Map();
const systemScanRunners = new Map();
const systemScanStates = new Map();
const systemHeadRefreshRunners = new Map();
const systemHeadRefreshTimers = new Map();
let lastCleanupAt = 0;
const discordSystemEvent = (message) => {
  const messageType = Number(message?.type ?? 0);
  const eventName = getDiscordSystemEventName(messageType) || (message?.system ? 'discord_system' : null);
  if (!eventName) return null;
  const userName = message.member?.displayName || message.author?.globalName || message.author?.username || '';
  const rawCount = String(message?.content || '').trim();
  const boostCount = eventName === 'boost_started' && /^\d+$/.test(rawCount) ? Math.max(1, Number(rawCount)) : null;
  return {
    type: eventName,
    text: formatDiscordSystemEventText({ messageType, eventName, userName, content: rawCount }),
    metadata: {
      discordMessageType: messageType,
      boostTierMessage: messageType >= 9 && messageType <= 11 ? messageType - 8 : 0,
      ...(boostCount ? { boostCount } : {}),
      nativeDiscordSystemMessage: true,
      source: 'discord',
      category: getDiscordSystemEventCategory(eventName),
      label: getDiscordSystemEventLabel(eventName)
    }
  };
};

const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};
const safeId = (value) => String(value || '').replace(/[^0-9A-Za-z_-]/g, '').slice(0, 128);
const dayKey = (timestamp = Date.now()) => new Date(timestamp).toISOString().slice(0, 10);
const guildDirectory = (guildId) => path.join(DATA_ROOT, safeId(guildId));
const dailyFile = (guildId, timestamp) => path.join(guildDirectory(guildId), `${dayKey(timestamp)}.jsonl`);
const systemScanFile = (guildId) => path.join(guildDirectory(guildId), 'system-event-scan.json');
const snowflakeTimestamp = (value) => {
  try {
    return Number((BigInt(String(value || '0')) >> 22n) + 1420070400000n);
  } catch {
    return 0;
  }
};
const historicalCoverage = (channel, channelState) => {
  if (channelState?.complete) return 100;
  const oldestScannedAt = snowflakeTimestamp(channelState?.before);
  const channelStartedAt = Number(channel?.createdTimestamp || channel?.guild?.createdTimestamp || 0);
  if (!oldestScannedAt || !channelStartedAt || oldestScannedAt <= channelStartedAt) return 0;
  const totalDuration = Math.max(1, Date.now() - channelStartedAt);
  const coveredDuration = Math.max(0, Date.now() - oldestScannedAt);
  return Math.min(99.9, Math.max(0.1, (coveredDuration / totalDuration) * 100));
};

const readSystemScanState = async (guildId) => {
  const key = safeId(guildId);
  if (systemScanStates.has(key)) return systemScanStates.get(key);
  const state = await fs.readFile(systemScanFile(key), 'utf8').then((value) => JSON.parse(value)).catch(() => ({ version: 1, channels: {} }));
  state.version = 1;
  state.channels ||= {};
  systemScanStates.set(key, state);
  return state;
};

const saveSystemScanState = async (guildId, state) => {
  const file = systemScanFile(guildId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(state, null, 2), 'utf8');
  await fs.rename(temporary, file).catch(async () => {
    await fs.rm(file, { force: true }).catch(() => {});
    await fs.rename(temporary, file);
  });
};

const scanChannelCandidates = (guild, cfg = {}) => {
  const ids = new Set([guild?.systemChannelId].map(String).filter(Boolean));
  return [...ids].map((id) => guild.channels.cache.get(id)).filter((channel) => channel?.isTextBased?.() && channel?.messages?.fetch);
};

const indexedSystemRecord = (message, event) => ({
  id: String(message.id),
  guildId: String(message.guildId || message.guild?.id || ''),
  channelId: String(message.channelId || message.channel?.id || ''),
  channelName: String(message.channel?.name || ''),
  parentChannelId: message.channel?.parentId ? String(message.channel.parentId) : null,
  thread: Boolean(message.channel?.isThread?.()),
  authorId: String(event.userId || message.author?.id || ''),
  authorName: String(message.mentions?.members?.first?.()?.displayName || message.member?.displayName || message.author?.globalName || message.author?.username || ''),
  authorBot: Boolean(message.author?.bot),
  type: Number(message.type || 0),
  system: true,
  systemEvent: event.type,
  createdAt: new Date(message.createdTimestamp || Date.now()).toISOString(),
  editedAt: message.editedAt?.toISOString?.() || null,
  content: event.text,
  metadata: event.metadata || {},
  attachments: [],
  embeds: []
});

export const startServerSystemEventBackfill = (guild, cfg = {}) => {
  if (!guild?.id || systemScanRunners.has(guild.id)) return;
  const runner = (async () => {
    const state = await readSystemScanState(guild.id);
    const systemChannelId = String(guild.systemChannelId || '');
    state.systemChannelId = systemChannelId;
    state.channels = Object.fromEntries(
      Object.entries(state.channels || {}).filter(([channelId]) => channelId === systemChannelId)
    );
    state.running = true;
    state.startedAt ||= new Date().toISOString();
    state.updatedAt = new Date().toISOString();
    await saveSystemScanState(guild.id, state);
    for (const channel of scanChannelCandidates(guild, cfg)) {
      const channelState = state.channels[channel.id] ||= {
        channelName: channel.name || channel.id,
        before: '',
        complete: false,
        scannedMessages: 0,
        foundEvents: 0
      };
      if (channelState.complete) continue;
      while (!channelState.complete) {
        try {
          const page = await channel.messages.fetch({ limit: 100, ...(channelState.before ? { before: channelState.before } : {}) });
          if (!page.size) {
            channelState.complete = true;
          } else {
            const messages = [...page.values()];
            const records = [];
            for (const message of messages) {
              const event = discordSystemEvent(message) || (message.author?.bot ? botSystemEvent(message) : null);
              if (event) records.push(indexedSystemRecord(message, event));
            }
            if (records.length) await persistServerIndexMessages(records, { source: 'system-event-backfill', batchId: `system-${channel.id}-${messages.at(-1)?.id || Date.now()}` });
            channelState.scannedMessages = Number(channelState.scannedMessages || 0) + messages.length;
            channelState.foundEvents = Number(channelState.foundEvents || 0) + records.length;
            channelState.before = messages.reduce((oldest, message) => !oldest || BigInt(message.id) < BigInt(oldest) ? message.id : oldest, '');
            if (page.size < 100) channelState.complete = true;
          }
          channelState.lastError = null;
          channelState.updatedAt = new Date().toISOString();
          channelState.progress = channelState.complete ? 100 : Math.max(
            Number(channelState.progress || 0),
            historicalCoverage(channel, channelState)
          );
          state.updatedAt = channelState.updatedAt;
          await saveSystemScanState(guild.id, state);
        } catch (error) {
          channelState.lastError = String(error?.message || error).slice(0, 300);
          channelState.updatedAt = new Date().toISOString();
          state.updatedAt = channelState.updatedAt;
          await saveSystemScanState(guild.id, state);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
    state.running = false;
    state.complete = Object.values(state.channels).length > 0 && Object.values(state.channels).every((channel) => channel.complete);
    for (const channelState of Object.values(state.channels)) {
      if (channelState.complete) channelState.progress = 100;
    }
    state.completedAt = state.complete ? new Date().toISOString() : null;
    state.updatedAt = new Date().toISOString();
    await saveSystemScanState(guild.id, state);
  })().catch((error) => console.error(`[serverContext] Systemereignis-Backfill fehlgeschlagen: ${error?.message || error}`)).finally(() => systemScanRunners.delete(guild.id));
  systemScanRunners.set(guild.id, runner);
};

const normalizedConfig = (cfg = {}) => {
  const source = cfg?.serverContext || cfg || {};
  return {
    enabled: source.enabled !== false,
    retentionDays: clamp(source.retentionDays, 1, 30, 30),
    maxStorageGb: clamp(source.maxStorageGb, 1, 50, 50),
    maxContextEntries: clamp(source.maxContextEntries, 10, 200, 80),
    channelIds: Array.isArray(source.channelIds) ? source.channelIds.map(String).filter(Boolean) : [],
    excludedChannelIds: Array.isArray(source.excludedChannelIds) ? source.excludedChannelIds.map(String).filter(Boolean) : [],
    storeAttachmentLinks: source.storeAttachmentLinks !== false
  };
};

const channelAllowed = (channelId, conf) => {
  const id = String(channelId || '');
  if (!id || conf.excludedChannelIds.includes(id)) return false;
  return !conf.channelIds.length || conf.channelIds.includes(id);
};

const appendLine = async (filePath, line) => {
  const previous = writeQueues.get(filePath) || Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, `${line}\n`, 'utf8');
  });
  writeQueues.set(filePath, next);
  try {
    await next;
  } finally {
    if (writeQueues.get(filePath) === next) writeQueues.delete(filePath);
  }
};

const listContextFiles = async () => {
  const files = [];
  let guildFolders = [];
  try {
    guildFolders = await fs.readdir(DATA_ROOT, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return files;
    throw error;
  }
  for (const guildFolder of guildFolders) {
    if (!guildFolder.isDirectory()) continue;
    const folder = path.join(DATA_ROOT, guildFolder.name);
    const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const filePath = path.join(folder, entry.name);
      const stat = await fs.stat(filePath).catch(() => null);
      if (stat) files.push({ filePath, size: stat.size, mtimeMs: stat.mtimeMs });
    }
  }
  return files;
};

export const maintainServerContextStorage = async (cfg = {}) => {
  const conf = normalizedConfig(cfg);
  const now = Date.now();
  const cutoff = now - conf.retentionDays * DAY_MS;
  let files = await listContextFiles();
  for (const file of files) {
    const parsedDate = Date.parse(`${path.basename(file.filePath, '.jsonl')}T00:00:00.000Z`);
    if ((Number.isFinite(parsedDate) ? parsedDate : file.mtimeMs) < cutoff) {
      await fs.rm(file.filePath, { force: true }).catch(() => {});
    }
  }
  files = await listContextFiles();
  const capBytes = conf.maxStorageGb * 1024 * 1024 * 1024;
  let totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > capBytes) {
    files.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const file of files) {
      if (totalBytes <= capBytes) break;
      await fs.rm(file.filePath, { force: true }).catch(() => {});
      totalBytes -= file.size;
    }
  }
  lastCleanupAt = now;
  return { totalBytes: Math.max(0, totalBytes), capBytes, retentionDays: conf.retentionDays };
};

export const recordServerEvent = async ({ cfg, guildId, channelId, channelName = '', userId = '', userName = '', type = 'chat', text = '', messageId = '', timestamp = Date.now(), attachments = [], metadata = {}, respectChannelFilter = true } = {}) => {
  const conf = normalizedConfig(cfg);
  if (!conf.enabled || !safeId(guildId) || (respectChannelFilter && !channelAllowed(channelId, conf))) return false;
  const cleanText = String(text || '').replace(/\u0000/g, '').trim().slice(0, MAX_TEXT_LENGTH);
  const safeAttachments = conf.storeAttachmentLinks ? attachments.slice(0, 10).map((attachment) => ({
    name: String(attachment?.name || '').slice(0, 256),
    url: String(attachment?.url || '').slice(0, 2048),
    contentType: String(attachment?.contentType || '').slice(0, 128),
    size: Number(attachment?.size || 0)
  })) : [];
  if (!cleanText && !safeAttachments.length && !Object.keys(metadata || {}).length) return false;
  const entry = {
    v: 1,
    ts: Number(timestamp) || Date.now(),
    type: String(type || 'chat').slice(0, 64),
    messageId: safeId(messageId),
    guildId: safeId(guildId),
    channelId: safeId(channelId),
    channelName: String(channelName || '').slice(0, 160),
    userId: safeId(userId),
    userName: String(userName || '').slice(0, 160),
    text: cleanText,
    attachments: safeAttachments,
    metadata: metadata && typeof metadata === 'object' ? metadata : {}
  };
  await appendLine(dailyFile(entry.guildId, entry.ts), JSON.stringify(entry));
  if (Date.now() - lastCleanupAt > 6 * 60 * 60 * 1000) await maintainServerContextStorage(conf).catch(() => {});
  return true;
};

const refreshLatestSystemEventHead = async (guild, pageLimit = 5) => {
  const guildId = String(guild?.id || '');
  const systemChannelId = String(guild?.systemChannelId || '');
  if (!guildId || !systemChannelId) return { scanned: 0, events: 0 };
  if (systemHeadRefreshRunners.has(guildId)) return systemHeadRefreshRunners.get(guildId);
  const runner = (async () => {
    const channel = guild.channels?.cache?.get(systemChannelId)
      || await guild.channels?.fetch?.(systemChannelId).catch(() => null);
    if (!channel?.isTextBased?.() || !channel.messages?.fetch) return { scanned: 0, events: 0 };
    let before;
    let scanned = 0;
    const records = [];
    for (let pageIndex = 0; pageIndex < Math.max(1, Number(pageLimit || 1)); pageIndex += 1) {
      const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
      if (!page?.size) break;
      const messages = [...page.values()];
      scanned += messages.length;
      for (const message of messages) {
        const event = discordSystemEvent(message);
        if (event) records.push(indexedSystemRecord(message, event));
      }
      before = messages.reduce((oldest, message) => !oldest || BigInt(message.id) < BigInt(oldest) ? message.id : oldest, '');
      if (page.size < 100) break;
    }
    if (records.length) {
      await persistServerIndexMessages(records, {
        source: 'system-event-head-refresh',
        batchId: `system-head-${systemChannelId}-${Date.now()}`
      });
    }
    return { scanned, events: records.length };
  })().finally(() => systemHeadRefreshRunners.delete(guildId));
  systemHeadRefreshRunners.set(guildId, runner);
  return runner;
};

const scheduleSystemEventHeadRefresh = (guild) => {
  const guildId = String(guild?.id || '');
  if (!guildId) return;
  const previous = systemHeadRefreshTimers.get(guildId);
  if (previous) clearInterval(previous);
  const timer = setInterval(() => {
    refreshLatestSystemEventHead(guild).catch((error) => console.error('[Server Context] Systemkanal-Kopfabgleich fehlgeschlagen:', error));
  }, 2 * 60 * 1000);
  timer.unref?.();
  systemHeadRefreshTimers.set(guildId, timer);
};

const AUDIT_EVENT = Object.freeze({
  MEMBER_KICK: 20,
  MEMBER_BAN_ADD: 22,
  MEMBER_UPDATE: 24
});

const waitForAuditLog = (delayMs = 1_200) => new Promise((resolve) => setTimeout(resolve, delayMs));

const findRecentMemberAuditEntry = async (guild, type, userId, windowMs = 30_000) => {
  if (!guild?.fetchAuditLogs || !userId) return null;
  const audit = await guild.fetchAuditLogs({ type, limit: 10 }).catch(() => null);
  if (!audit?.entries) return null;
  const now = Date.now();
  return audit.entries.find((entry) => {
    const targetId = String(entry?.targetId || entry?.target?.id || '');
    const createdAt = Number(entry?.createdTimestamp || entry?.createdAt?.getTime?.() || 0);
    return targetId === String(userId) && createdAt > 0 && Math.abs(now - createdAt) <= windowMs;
  }) || null;
};

const recordMemberLifecycleEvent = async ({ cfg, member, type, text, auditEntry = null, metadata = {} }) => {
  const guild = member?.guild;
  if (!guild?.id || !member?.id) return false;
  const occurredAt = Number(auditEntry?.createdTimestamp || Date.now());
  return recordServerEvent({
    cfg,
    guildId: guild.id,
    channelId: '',
    channelName: '',
    userId: member.id,
    userName: member.displayName || member.user?.globalName || member.user?.username || member.id,
    type,
    text,
    messageId: auditEntry?.id ? `audit:${auditEntry.id}` : `gateway:${type}:${member.id}:${occurredAt}`,
    timestamp: occurredAt,
    metadata: {
      source: auditEntry ? 'discord-audit-log' : 'discord-gateway',
      auditVerified: Boolean(auditEntry),
      executorId: String(auditEntry?.executorId || auditEntry?.executor?.id || ''),
      executorName: String(auditEntry?.executor?.globalName || auditEntry?.executor?.username || ''),
      reason: String(auditEntry?.reason || ''),
      ...metadata
    },
    respectChannelFilter: false
  });
};

const readTail = async (filePath) => {
  const handle = await fs.open(filePath, 'r').catch(() => null);
  if (!handle) return [];
  try {
    const stat = await handle.stat();
    const length = Math.min(stat.size, MAX_TAIL_BYTES);
    if (!length) return [];
    const start = stat.size - length;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    let text = buffer.toString('utf8');
    if (start > 0) text = text.slice(Math.max(0, text.indexOf('\n') + 1));
    return text.split(/\r?\n/).filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } finally {
    await handle.close();
  }
};

const queryTerms = (query) => [...new Set(String(query || '').toLocaleLowerCase('de-DE')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .split(/\s+/)
  .filter((word) => word.length >= 3 && !['aber', 'auch', 'dann', 'eine', 'einen', 'einer', 'haben', 'hier', 'oder', 'sind', 'über', 'wurde', 'wer', 'was', 'wie'].includes(word))
  .slice(0, 16))];

export const shouldUseServerContext = (query, serverIntent = null) => {
  if (serverIntent) return true;
  const text = String(query || '').trim().toLocaleLowerCase('de-DE');
  if (!text || /^(?:lol|lmao|haha+|hehe+|xd+|moin|hallo|hi|hey|ok(?:ay)?|ja|nein|danke|gn8|gute nacht)[.!? ]*$/.test(text)) return false;
  if (/\b(?:server|channel|kanal|boost|booster|mitglied|member|rolle|event|regel|regeln|regelwerk|richtlinie|erlaubt|verboten|heute|gestern|zuletzt|vorhin|thema|gesagt|geschrieben|gepostet|passiert)\b/i.test(text)) return true;
  if (/\b(?:wo sind wir|in welchem kanal|aktueller kanal|darf ich|darf man)\b/i.test(text)) return true;
  return queryTerms(text).length >= 4 && /[?]$/.test(text);
};

export const getRecentServerContext = async ({
  guildId,
  channelId = '',
  query = '',
  cfg = {},
  allowedChannelIds = null,
  excludedChannelIds = [],
  excludeMessageIds = [],
  maxEntries
} = {}) => {
  const conf = normalizedConfig(cfg);
  if (!conf.enabled || !safeId(guildId)) return '';
  const allowedChannels = Array.isArray(allowedChannelIds)
    ? new Set(allowedChannelIds.map(String).filter(Boolean))
    : null;
  // Ein AI-Aufruf muss seine Sicht explizit mitgeben. Ohne sicheren Scope darf
  // der historische Fallback keine Nachrichteninhalte liefern.
  if (!allowedChannels?.size) return '';
  const limit = clamp(maxEntries, 5, 200, conf.maxContextEntries);
  const terms = queryTerms(query);
  const excludedChannels = new Set((excludedChannelIds || []).map(String).filter(Boolean));
  const excludedMessages = new Set((excludeMessageIds || []).map(String).filter(Boolean));
  const entries = [];
  const now = Date.now();
  for (let day = 0; day < conf.retentionDays; day += 1) {
    const rows = await readTail(dailyFile(guildId, now - day * DAY_MS));
    for (const row of rows) {
      if (!row?.ts || now - Number(row.ts) > conf.retentionDays * DAY_MS) continue;
      if (!allowedChannels.has(String(row.channelId || ''))) continue;
      if (excludedChannels.has(String(row.channelId || '')) || excludedMessages.has(String(row.messageId || ''))) continue;
      const searchable = `${row.type || ''} ${row.channelName || ''} ${row.userName || ''} ${row.text || ''}`.toLocaleLowerCase('de-DE');
      const hits = terms.reduce((sum, term) => sum + (searchable.includes(term) ? 1 : 0), 0);
      const sameChannel = String(row.channelId || '') === String(channelId || '');
      const boostQuery = /boost/i.test(query) && /^boost/.test(String(row.type || ''));
      const score = hits * 20 + (sameChannel ? 8 : 0) + (boostQuery ? 50 : 0) + Math.max(0, 30 - day);
      if (!terms.length || hits || boostQuery) entries.push({ ...row, score });
    }
  }
  const selected = entries.sort((a, b) => b.score - a.score || Number(b.ts) - Number(a.ts)).slice(0, limit).sort((a, b) => Number(a.ts) - Number(b.ts));
  if (!selected.length) return '';
  const lines = selected.map((entry) => {
    const when = new Date(Number(entry.ts)).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
    const where = entry.channelName ? `#${entry.channelName}` : `Kanal ${entry.channelId}`;
    const who = entry.userName || entry.userId || 'System';
    const attachmentNote = entry.attachments?.length ? ` [${entry.attachments.length} Anhang/Anhänge]` : '';
    return `- ${when} | ${where} | ${who} | ${entry.type}: ${entry.text || '(Ereignis)'}${attachmentNote}`;
  });
  return ['LOKALER SERVER-KONTEXT (echte Discord-Ereignisse, getrennt vom persönlichen AI-Memory, maximal 30 Tage):', 'Nutze nur passende Einträge. Erfinde nichts und sage klar, wenn die Notizen keine sichere Antwort enthalten.', ...lines].join('\n');
};

export const getServerSystemEvents = async ({ guildId, maxEntries = 0, retentionDays = 0 } = {}) => {
  if (!safeId(guildId)) return { events: [], summary: { total: 0, boosts: 0, joins: 0, ended: 0 } };
  const scanState = await readSystemScanState(guildId).catch(() => ({ channels: {} }));
  const systemChannelId = String(scanState.systemChannelId || '');
  const belongsToSystemHistory = (entry) => {
    const channelId = String(entry?.channelId || entry?.channel_id || '');
    const channelName = String(entry?.channelName || entry?.channel_name || '').toLocaleLowerCase('de-DE');
    if (/^boost[-_ ]?(?:info|log)$/.test(channelName)) return false;
    return systemChannelId ? channelId === systemChannelId : true;
  };
  const rows = [];
  const seen = new Set();
  const rowIndexByKey = new Map();
  const localFiles = await fs.readdir(guildDirectory(guildId), { withFileTypes: true }).then((entries) => entries
    .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.jsonl$/i.test(entry.name))
    .map((entry) => path.join(guildDirectory(guildId), entry.name))
    .sort((left, right) => right.localeCompare(left))).catch(() => []);
  for (const file of localFiles) {
    const entries = await readTail(file);
    for (const entry of entries) {
      if (!belongsToSystemHistory(entry)) continue;
      const entryType = String(entry?.type || '');
      if (/^boost_/.test(entryType) && entry?.metadata?.nativeDiscordSystemMessage !== true) continue;
      const isTrackedSystemEvent = Boolean(entry?.metadata?.nativeDiscordSystemMessage)
        || getDiscordSystemEventCategory(entryType) !== 'other'
        || ['discord_system', 'member_left'].includes(entryType);
      if (!isTrackedSystemEvent) continue;
      const key = String(entry.messageId || `${entry.type}:${entry.userId}:${entry.ts}`);
      if (seen.has(key)) continue;
      seen.add(key);
      rowIndexByKey.set(key, rows.length);
      rows.push(entry);
    }
  }
  const indexedEvents = await getServerIndexSystemEvents({
    guildId,
    limit: Number(maxEntries) > 0 ? Number(maxEntries) : 0,
    retentionDays
  }).catch(() => []);
  for (const entry of indexedEvents) {
    if (!belongsToSystemHistory(entry)) continue;
    const key = String(entry.messageId || entry.id || `${entry.type}:${entry.userId}:${entry.ts}`);
    if (seen.has(key)) {
      const existingIndex = rowIndexByKey.get(key) ?? -1;
      if (existingIndex >= 0) {
        const existing = rows[existingIndex];
        rows[existingIndex] = {
          ...existing,
          ...entry,
          metadata: {
            ...(existing.metadata || {}),
            ...(entry.metadata || {})
          }
        };
      }
      continue;
    }
    seen.add(key);
    rowIndexByKey.set(key, rows.length);
    rows.push(entry);
  }
  const sortedEvents = rows.sort((left, right) => Number(right.ts || Date.parse(right.createdAt || '') || 0) - Number(left.ts || Date.parse(left.createdAt || '') || 0));
  const selectedEvents = Number(maxEntries) > 0 ? sortedEvents.slice(0, Number(maxEntries)) : sortedEvents;
  const events = selectedEvents.map((entry) => ({
    ...entry,
    nativeText: String(entry.text || entry.content || ''),
    displayText: String(entry.text || entry.content || ''),
    metadata: {
      ...(entry.metadata || {}),
      category: entry.metadata?.category || getDiscordSystemEventCategory(entry.type),
      label: entry.metadata?.label || getDiscordSystemEventLabel(entry.type)
    }
  }));
  const scanChannels = Object.values(scanState.channels || {});
  const completedChannels = scanChannels.filter((channel) => channel.complete).length;
  const scanProgress = scanState.complete
    ? 100
    : scanChannels.length
      ? scanChannels.reduce((sum, channel) => sum + Math.min(100, Math.max(0, Number(channel.progress || 0))), 0) / scanChannels.length
      : 0;
  const categories = events.reduce((result, entry) => {
    const category = String(entry?.metadata?.category || getDiscordSystemEventCategory(entry?.type) || 'other');
    result[category] = Number(result[category] || 0) + 1;
    return result;
  }, {});
  return {
    events,
    scan: {
      running: Boolean(scanState.running || systemScanRunners.has(String(guildId))),
      complete: Boolean(scanState.complete),
      progress: scanProgress,
      scannedMessages: scanChannels.reduce((sum, channel) => sum + Number(channel.scannedMessages || 0), 0),
      foundEvents: scanChannels.reduce((sum, channel) => sum + Number(channel.foundEvents || 0), 0),
      completedChannels,
      totalChannels: scanChannels.length,
      lastError: scanChannels.find((channel) => channel.lastError)?.lastError || null,
      updatedAt: scanState.updatedAt || null
    },
    summary: {
      total: events.length,
      boosts: Number(categories.boosts || 0),
      joins: events.filter((entry) => entry.type === 'member_joined').length,
      ended: events.filter((entry) => entry.type === 'boost_ended' || entry.type === 'member_left').length,
      categories
    }
  };
};

export const feature = {
  id: 'serverContext',
  async onClientReady({ cfg, guild }) {
    await maintainServerContextStorage(cfg).catch(() => {});
    await refreshLatestSystemEventHead(guild).catch((error) => console.error('[Server Context] Initialer Systemkanal-Kopfabgleich fehlgeschlagen:', error));
    scheduleSystemEventHeadRefresh(guild);
    startServerSystemEventBackfill(guild, cfg);
  },
  async onConfigUpdate({ cfg }) {
    await maintainServerContextStorage(cfg).catch(() => {});
  },
  async onGuildMemberRemove({ member, cfg }) {
    if (!member?.guild || !member?.id) return;
    await waitForAuditLog();
    const banEntry = await findRecentMemberAuditEntry(member.guild, AUDIT_EVENT.MEMBER_BAN_ADD, member.id);
    const kickEntry = banEntry ? null : await findRecentMemberAuditEntry(member.guild, AUDIT_EVENT.MEMBER_KICK, member.id);
    const auditEntry = banEntry || kickEntry;
    const displayName = member.displayName || member.user?.globalName || member.user?.username || 'Das Mitglied';
    const type = banEntry ? 'member_banned' : kickEntry ? 'member_kicked' : 'member_left';
    const text = banEntry
      ? `${displayName} wurde vom Server gebannt.`
      : kickEntry
        ? `${displayName} wurde vom Server gekickt.`
        : `${displayName} hat den Server verlassen.`;
    await recordMemberLifecycleEvent({ cfg, member, type, text, auditEntry });
  },
  async onGuildMemberUpdate({ oldMember, newMember, cfg }) {
    if (!newMember?.guild || !newMember?.id) return;
    const oldTimeout = Number(oldMember?.communicationDisabledUntilTimestamp || 0);
    const newTimeout = Number(newMember.communicationDisabledUntilTimestamp || 0);
    if (oldTimeout === newTimeout) return;
    const now = Date.now();
    const timeoutStarted = newTimeout > now;
    const timeoutEnded = oldTimeout > now && newTimeout <= now;
    if (!timeoutStarted && !timeoutEnded) return;
    await waitForAuditLog(750);
    const auditEntry = await findRecentMemberAuditEntry(newMember.guild, AUDIT_EVENT.MEMBER_UPDATE, newMember.id);
    const displayName = newMember.displayName || newMember.user?.globalName || newMember.user?.username || 'Das Mitglied';
    const type = timeoutStarted ? 'timeout_started' : 'timeout_ended';
    const text = timeoutStarted
      ? `${displayName} hat einen Timeout bis ${new Date(newTimeout).toLocaleString('de-DE')} erhalten.`
      : `Der Timeout von ${displayName} wurde beendet.`;
    await recordMemberLifecycleEvent({
      cfg,
      member: newMember,
      type,
      text,
      auditEntry,
      metadata: { timeoutUntil: newTimeout > 0 ? new Date(newTimeout).toISOString() : null }
    });
  },
  async onMessageCreate({ message, cfg }) {
    const conf = normalizedConfig(cfg);
    const systemEvent = discordSystemEvent(message);
    if (conf.enabled && systemEvent) {
      await recordServerEvent({
        cfg,
        guildId: message.guildId,
        channelId: message.channelId,
        channelName: message.channel?.name || '',
        userId: message.author?.id,
        userName: message.member?.displayName || message.author?.globalName || message.author?.username || '',
        type: systemEvent.type,
        text: systemEvent.text,
        messageId: message.id,
        timestamp: message.createdTimestamp,
        metadata: systemEvent.metadata,
        respectChannelFilter: false
      });
      return;
    }
    if (!conf.enabled || message.author?.bot || !channelAllowed(message.channelId, conf)) return;
    await recordServerEvent({
      cfg,
      guildId: message.guildId,
      channelId: message.channelId,
      channelName: message.channel?.name || '',
      userId: message.author?.id,
      userName: message.member?.displayName || message.author?.globalName || message.author?.username || '',
      type: 'chat',
      text: message.content || '',
      messageId: message.id,
      timestamp: message.createdTimestamp,
      attachments: [...message.attachments.values()].map((attachment) => ({ name: attachment.name, url: attachment.url, contentType: attachment.contentType, size: attachment.size }))
    });
  }
};
