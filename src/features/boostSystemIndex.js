import fs from 'fs';
import path from 'path';

// Discord message type 8 is one individual user boost event. A number in the
// content is preserved as metadata but never replaces the number of events.
const BOOST_MESSAGE_TYPES = new Set([8]);
const DATA_ROOT = path.resolve(
  String(process.env.FALLEN_HEAVEN_DATA_DIR || '').trim() ||
  path.join(
    String(process.env.APPDATA || process.cwd()),
    'FALLEN HEAVEN Control Center',
    'runtime',
    'data'
  )
);
const SERVER_INDEX_ROOT = path.join(DATA_ROOT, 'server-index');
const TYPE_CACHE_FILE = path.join(DATA_ROOT, 'boost-system-type-cache.json');
const CACHE_VERSION = 5;
const MAX_CACHE_ENTRIES = 50000;
const progressByGuild = new Map();
const scheduleByGuild = new Map();

const setProgress = (guildId, patch) => {
  const previous = progressByGuild.get(String(guildId)) || {};
  progressByGuild.set(String(guildId), {
    running: false,
    phase: 'idle',
    progress: 0,
    completed: 0,
    total: 0,
    detail: 'Noch kein Abgleich gestartet.',
    ...previous,
    ...patch,
    updatedAt: new Date().toISOString()
  });
};

export const setBoostSystemIndexSchedule = (guildId, patch = {}) => {
  const key = String(guildId || '');
  if (!key) return;
  const previous = scheduleByGuild.get(key) || {};
  scheduleByGuild.set(key, {
    intervalMs: null,
    nextSyncAt: null,
    lastSyncAt: null,
    lastStartedAt: null,
    ...previous,
    ...patch,
    updatedAt: new Date().toISOString()
  });
};

export const getBoostSystemIndexStatus = (guildId) => ({
  ...(progressByGuild.get(String(guildId)) || {
    running: false,
    phase: 'idle',
    progress: 0,
    completed: 0,
    total: 0,
    detail: 'Der Boost-Abgleich startet mit der nächsten Synchronisierung.',
    updatedAt: null
  }),
  schedule: scheduleByGuild.get(String(guildId)) || {
    intervalMs: null,
    nextSyncAt: null,
    lastSyncAt: null,
    lastStartedAt: null,
    updatedAt: null
  }
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readJson = (filePath, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
};

const writeJsonAtomic = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
  try {
    fs.renameSync(temporary, filePath);
  } catch {
    fs.rmSync(filePath, { force: true });
    fs.renameSync(temporary, filePath);
  }
};

const normalizeCache = (value) => ({
  version: CACHE_VERSION,
  files: value?.version === CACHE_VERSION && value.files && typeof value.files === 'object'
    ? value.files
    : {},
  messages: value?.version === CACHE_VERSION && value.messages && typeof value.messages === 'object'
    ? value.messages
    : {}
});

const monthKey = (timestamp) => new Date(timestamp).toISOString().slice(0, 7);
const parseReportedBoostCount = (value = '') => {
  const text = String(value || '').trim();
  if (/^\d{1,3}$/.test(text)) return Math.max(1, Math.min(99, Number(text)));
  const normalized = text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const match = normalized.match(/(?:zum\s+)?(\d{1,3})\.?\s*(?:mal|x|boosts?)/i);
  return match ? Math.max(1, Math.min(99, Number(match[1]))) : 0;
};

const reportedBoostSystemText = (message) => {
  const values = [];
  for (const value of [message?.content, message?.systemContent, message?.cleanContent, message?.systemText]) {
    const text = String(value || '').trim();
    if (text && !values.includes(text)) values.push(text);
  }
  return values.join(' ');
};

const indexedEmbedText = (row) => (Array.isArray(row?.embeds) ? row.embeds : [])
  .map((embed) => [embed?.title, embed?.description, embed?.author?.name, embed?.footer?.text]
    .map((value) => String(value || '').trim()).filter(Boolean).join('\n'))
  .filter(Boolean)
  .join('\n');

const parseIndexedSupportEvent = (row) => {
  if (row?.authorBot !== true) return null;
  const channelName = String(row?.channelName || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const combined = [row?.content, indexedEmbedText(row)].map((value) => String(value || '').trim()).filter(Boolean).join('\n');
  const userId = combined.match(/<@!?(\d{15,25})>/)?.[1] || '';
  if (!userId) return null;
  if (/boost[-_ ]?log/i.test(channelName)
      && /wir\s+haben\s+einen\s+booster\s+verloren/i.test(combined)
      && /hat\s+aufgehört\s+den\s+server\s+zu\s+boosten/i.test(combined)) {
    return { kind: 'expired', userId };
  }
  if (/(?:boost[-_ ]?info|boost[-_ ]?log)/i.test(channelName)
      && /(?:danke\s+für\s+den\s+boost|danke\s+<@!?\d{15,25}>\s*,?\s*dass\s+du\s+den\s+server\s+boostest|wir\s+haben\s+einen\s+neuen\s+booster)/i.test(combined)) {
    return { kind: 'boost-info', userId };
  }
  return null;
};

const isEmptyLegacyCandidate = (row) => {
  if (!row?.id || !row?.authorId || row.authorBot === true) return false;
  if (String(row.content || '').trim()) return false;
  if (Array.isArray(row.embeds) && row.embeds.length) return false;
  if (Array.isArray(row.attachments) && row.attachments.length) return false;
  return row.type === undefined || row.type === null;
};

const toEvent = (entry, messageId) => ({
  messageId: String(messageId),
  userId: String(entry.userId || ''),
  timestamp: Number(entry.timestamp || 0),
  source: 'native-system-index',
  type: 'boost',
  discordMessageType: Number(entry.type || 0),
  delta: 1,
  reportedCount: Math.max(0, Number(entry.reportedCount || 0))
});

const toSupportEvent = (entry, messageId) => ({
  messageId: String(messageId),
  userId: String(entry.userId || ''),
  channelId: String(entry.channelId || ''),
  timestamp: Number(entry.timestamp || 0),
  source: entry.kind === 'expired' ? 'trusted-boost-loss-index' : 'boost-info-index',
  type: entry.kind === 'expired' ? 'expired' : 'boost-info',
  discordMessageType: null,
  delta: entry.kind === 'expired' ? -1 : 1,
  reportedCount: 0
});

const pruneCache = (cache) => {
  const entries = Object.entries(cache.messages || {});
  if (entries.length <= MAX_CACHE_ENTRIES) return;
  entries.sort(([, left], [, right]) => Number(right?.timestamp || right?.checkedAt || 0)
    - Number(left?.timestamp || left?.checkedAt || 0));
  cache.messages = Object.fromEntries(entries.slice(0, MAX_CACHE_ENTRIES));
};

const collectChannelIndex = ({ cache, guildId, channelId, since, onProgress }) => {
  const channelRoot = path.join(SERVER_INDEX_ROOT, String(guildId), String(channelId));
  if (!fs.existsSync(channelRoot)) return;

  const minimumMonth = monthKey(since);
  const fileState = cache.files[channelId] || {};
  cache.files[channelId] = fileState;

  const files = fs.readdirSync(channelRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => entry.name)
    .filter((name) => name.slice(0, 7) >= minimumMonth)
    .sort();

  onProgress?.(0, files.length);
  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    const fileName = files[fileIndex];
    const immutable = fileName.includes('.backfill-') || fileName.includes('.catchup-');
    if (immutable && fileState[fileName]) {
      onProgress?.(fileIndex + 1, files.length);
      continue;
    }

    const filePath = path.join(channelRoot, fileName);
    let content = '';
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      onProgress?.(fileIndex + 1, files.length);
      continue;
    }

    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }

      const timestamp = Date.parse(row.createdAt || '') || 0;
      if (timestamp < since || !row.id) continue;
      const type = Number(row.type);
      const supportEvent = parseIndexedSupportEvent(row);

      if (BOOST_MESSAGE_TYPES.has(type)) {
        cache.messages[row.id] = {
          type,
          userId: String(row.authorId || ''),
          channelId: String(channelId),
          timestamp,
          reportedCount: parseReportedBoostCount(reportedBoostSystemText(row)),
          checkedAt: Date.now()
        };
      } else if (supportEvent) {
        cache.messages[row.id] = {
          type: 0,
          kind: supportEvent.kind,
          userId: supportEvent.userId,
          channelId: String(channelId),
          timestamp,
          checkedAt: Date.now()
        };
      } else if (isEmptyLegacyCandidate(row) && !cache.messages[row.id]) {
        cache.messages[row.id] = {
          type: null,
          userId: String(row.authorId),
          channelId: String(channelId),
          timestamp,
          checkedAt: 0
        };
      }
    }

    if (immutable) fileState[fileName] = true;
    if ((fileIndex + 1) % 20 === 0 || fileIndex + 1 === files.length) {
      onProgress?.(fileIndex + 1, files.length);
    }
  }
};

const verifyLegacyCandidates = async ({ guild, cache, activeUserIds, since, maxChecks, onProgress }) => {
  const active = new Set((activeUserIds || []).map(String));
  const candidates = Object.entries(cache.messages)
    .filter(([, entry]) => entry?.type === null)
    .filter(([, entry]) => Number(entry.timestamp || 0) >= since)
    .filter(([, entry]) => !active.size || active.has(String(entry.userId || '')))
    .sort(([, left], [, right]) => Number(right.timestamp || 0) - Number(left.timestamp || 0))
    .slice(0, maxChecks);

  onProgress?.(0, candidates.length);
  let dirty = false;
  let completed = 0;
  for (let index = 0; index < candidates.length; index += 4) {
    const batch = candidates.slice(index, index + 4);
    await Promise.all(batch.map(async ([messageId, candidate]) => {
      const channel = guild.channels.cache.get(String(candidate.channelId))
        || await guild.channels.fetch(String(candidate.channelId)).catch(() => null);
      if (!channel?.messages?.fetch) return;

      try {
        const message = await channel.messages.fetch(String(messageId));
        const type = Number(message.type || 0);
        cache.messages[messageId] = {
          type: BOOST_MESSAGE_TYPES.has(type) ? type : 0,
          userId: String(message.author?.id || candidate.userId || ''),
          channelId: String(candidate.channelId),
          timestamp: Number(message.createdTimestamp || candidate.timestamp || 0),
          reportedCount: parseReportedBoostCount(reportedBoostSystemText(message)),
          checkedAt: Date.now()
        };
        dirty = true;
        completed += 1;
      } catch (error) {
        const code = Number(error?.code || error?.rawError?.code || 0);
        if (code === 10008) {
          cache.messages[messageId] = { ...candidate, type: 0, checkedAt: Date.now() };
          dirty = true;
          completed += 1;
        }
      }
    }));

    if (dirty && (completed % 100 === 0 || index + 4 >= candidates.length)) {
      pruneCache(cache);
      writeJsonAtomic(TYPE_CACHE_FILE, cache);
      dirty = false;
    }
    onProgress?.(Math.min(index + batch.length, candidates.length), candidates.length);
    if (index + 4 < candidates.length) await sleep(80);
  }
};

export const getIndexedNativeBoostEvents = async ({
  guild,
  channelIds = [],
  activeUserIds = [],
  since = Date.now() - (180 * 24 * 60 * 60 * 1000),
  maxLegacyChecks = 0
} = {}) => {
  if (!guild?.id) return [];
  const uniqueChannels = [...new Set(channelIds.map(String).filter(Boolean))];
  if (!uniqueChannels.length) return [];
  const guildId = String(guild.id);
  setProgress(guildId, {
    running: true,
    phase: 'prepare',
    progress: 2,
    detail: 'Boost-Quellen und aktuellen Boosterstatus vorbereiten.'
  });

  try {
    const cache = normalizeCache(readJson(TYPE_CACHE_FILE, null));
    for (let channelIndex = 0; channelIndex < uniqueChannels.length; channelIndex += 1) {
      const channelId = uniqueChannels[channelIndex];
      const channelName = guild.channels.cache.get(channelId)?.name || channelId;
      collectChannelIndex({
        cache,
        guildId,
        channelId,
        since,
        onProgress: (completed, total) => {
          const channelPart = total ? completed / total : 1;
          const overallPart = (channelIndex + channelPart) / uniqueChannels.length;
          setProgress(guildId, {
            running: true,
            phase: 'scan',
            progress: Math.min(55, Math.max(3, Math.round(3 + (overallPart * 52)))),
            completed,
            total,
            detail: `Indexdateien aus #${channelName} lesen (${channelIndex + 1}/${uniqueChannels.length}).`
          });
        }
      });
    }
    pruneCache(cache);
    writeJsonAtomic(TYPE_CACHE_FILE, cache);

    await verifyLegacyCandidates({
      guild,
      cache,
      activeUserIds,
      since,
      maxChecks: Math.max(0, Math.trunc(Number(maxLegacyChecks) || 0)),
      onProgress: (completed, total) => setProgress(guildId, {
        running: true,
        phase: 'verify',
        progress: total ? Math.min(98, Math.round(55 + ((completed / total) * 43))) : 98,
        completed,
        total,
        detail: total
          ? 'Historische Systemmeldungen direkt bei Discord verifizieren.'
          : 'Keine ungeprüften Systemmeldungen mehr vorhanden.'
      })
    });

    const active = new Set(activeUserIds.map(String));
    const events = Object.entries(cache.messages)
      .filter(([, entry]) => BOOST_MESSAGE_TYPES.has(Number(entry?.type)))
      .filter(([, entry]) => uniqueChannels.includes(String(entry.channelId || '')))
      .filter(([, entry]) => Number(entry.timestamp || 0) >= since)
      .filter(([, entry]) => !active.size || active.has(String(entry.userId || '')))
      .map(([messageId, entry]) => toEvent(entry, messageId))
      .filter((event) => event.userId && event.timestamp)
      .sort((left, right) => left.timestamp - right.timestamp);

    setProgress(guildId, {
      running: false,
      phase: 'complete',
      progress: 100,
      completed: events.length,
      total: events.length,
      detail: `${events.length} bestätigte Boost-Systemmeldungen sind abgeglichen.`
    });
    return events;
  } catch (error) {
    setProgress(guildId, {
      running: false,
      phase: 'error',
      detail: `Boost-Abgleich fehlgeschlagen: ${error?.message || error}`
    });
    throw error;
  }
};

export const getIndexedBoostEvidenceEvents = ({
  guildId = '',
  channelIds = [],
  activeUserIds = [],
  since = Date.now() - (180 * 24 * 60 * 60 * 1000)
} = {}) => {
  if (!guildId) return [];
  const cache = normalizeCache(readJson(TYPE_CACHE_FILE, null));
  const channels = new Set(channelIds.map(String).filter(Boolean));
  const active = new Set(activeUserIds.map(String).filter(Boolean));
  return Object.entries(cache.messages || {})
    .filter(([, entry]) => entry?.kind === 'boost-info' || entry?.kind === 'expired')
    .filter(([, entry]) => !channels.size || channels.has(String(entry.channelId || '')))
    .filter(([, entry]) => Number(entry.timestamp || 0) >= Number(since || 0))
    .filter(([, entry]) => !active.size || active.has(String(entry.userId || '')))
    .map(([messageId, entry]) => toSupportEvent(entry, messageId))
    .filter((event) => event.userId && event.timestamp)
    .sort((left, right) => left.timestamp - right.timestamp);
};
