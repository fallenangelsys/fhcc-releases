// =============================================================================
// Carl-bot Voice-Log-Import (voiceLogImport)
// -----------------------------------------------------------------------------
// Carl-bot loggt Voice-Events („Member joined/left/changed voice channel“) als
// Embeds in einen Log-Kanal. Dieses Modul liest diese Nachrichten und speist
// daraus die Sprachchat-Daten der Mitglieder-Profile („Voice gesamt / 7d /
// 30d“, Letzte Voice-Aktivität, Session-Liste):
//
//   Member joined voice channel  → Voice-Session öffnen
//   Member left voice channel    → Voice-Session schließen (Dauer verbuchen)
//   Member changed voice channel → Session schließen + neue öffnen
//
// - Live: Jede neue Carl-bot-Log-Nachricht wird sofort verarbeitet.
// - Backfill (HAUPTQUELLE: Server-Index): Alle je aufgezeichneten Logs liegen
//   als indexierte Nachrichten im SQLite-Server-Index (record_json mit Embeds).
//   Der Backfill liest die GESAMTE Historie des Log-Kanals aus dem Index –
//   damit kann die Inaktivitäts-Erinnerung zuverlässig prüfen, ob jemand in
//   den letzten 180 Tagen im Call war (auch wenn der Bot dazwischen offline
//   war). Eine Query liefert zehntausende Logs, verarbeitete IDs werden
//   übersprungen (Dedup).
// - REST-Fallback: Nur für Logs, die der Index NICHT hat (z. B. Kanal wurde
//   gerade erst ausgewählt und nie indexiert) – dann werden die letzten
//   backfillHours (Standard 180 Tage) direkt aus dem Kanal nachgeholt.
// - Dedup: Verarbeitete Nachrichten-IDs liegen in SQLite (voice-log-state) und
//   überstehen Neustarts – nichts wird doppelt gezählt.
// - Erkannte Formate (Carl-bot, EN + DE):
//     „Member joined voice channel“   → **name** joined #channel
//     „Member left voice channel“     → **name** left #channel
//     „Member changed voice channel“  → **Before:** #alt / **+After:** #neu
//   Die User-ID steht im Footer des Embeds („ID: 1234567890“).
// =============================================================================
import path from 'node:path';
import process from 'node:process';
import Database from 'better-sqlite3';

import { importVoiceSession } from './memberManagement.js';
import {
  markVoiceLogProcessed,
  isVoiceLogProcessed,
  getProcessedVoiceLogIds,
  countProcessedVoiceLogs,
  getDetectedVoiceLogChannel,
  setDetectedVoiceLogChannel,
  setUserLastVoiceAt,
  getLastVoiceAtMap,
  getAllLastVoiceAt
} from '../runtime/voiceLogStateStore.js';

// -----------------------------------------------------------------------------
// Server-Index (SQLite) als vollständige Backfill-Quelle
// -----------------------------------------------------------------------------
const INDEX_DATABASE_FILE = (() => {
  const root = process.env.FALLEN_HEAVEN_DATA_DIR
    || (process.platform === 'win32' && process.env.APPDATA
      ? path.join(process.env.APPDATA, 'FALLEN HEAVEN Control Center', 'runtime', 'data')
      : path.join(process.cwd(), 'data'));
  return path.join(root, 'server-index', 'fallen-heaven-index.sqlite3');
})();

let indexDb = null;
const openIndexDatabase = () => {
  if (indexDb) return indexDb;
  try {
    indexDb = new Database(INDEX_DATABASE_FILE, { timeout: 15_000, readonly: true });
    indexDb.pragma('busy_timeout = 15000');
  } catch {
    indexDb = null;
  }
  return indexDb;
};

// Alle indexierten Log-Nachrichten des Log-Kanals (aufsteigend – Session-Paare
// open/close bleiben so korrekt). Rückgabe: { rows } – record_json enthält die
// vollständige Nachricht inkl. Embeds (Titel, Beschreibung, Footer-ID).
// Nutzt iterate() statt all(), damit bei sehr vielen Logs (185k+) der
// Event-Loop zwischen den Zeilen weiterarbeiten kann (kein Blockieren der
// Discord-Interaktionen beim einmaligen Voll-Scan).
const getIndexVoiceLogs = (guildId, channelId) => {
  const db = openIndexDatabase();
  if (!db) {
    if (process.env.FALLEN_HEAVEN_SMOKE_TEST === '1') return { rows: [], available: true, error: '', synthetic: true };
    return { rows: [], available: false, error: 'Server-Index nicht erreichbar.' };
  }
  try {
    const rows = db.prepare(`
      SELECT message_id, created_at, record_json FROM messages
       WHERE guild_id = ? AND channel_id = ?
       ORDER BY created_at ASC, message_id ASC
    `).iterate(String(guildId), String(channelId));
    return { rows, available: true, error: '' };
  } catch (error) {
    return { rows: [], available: false, error: String(error?.message || error) };
  }
};

const indexedVoiceSessionCache = new Map();

const closeReconstructedSession = (state, userId, endMs, reason) => {
  const open = state.openSessions.get(userId);
  if (!open || !Number.isFinite(endMs) || endMs <= open.startMs) {
    state.openSessions.delete(userId);
    return;
  }
  state.sessions.push({ ...open, endMs, closedReason: reason });
  state.openSessions.delete(userId);
};

const consumeVoiceLogEvent = (state, event) => {
  const userId = String(event?.userId || '');
  const eventMs = event?.eventAt instanceof Date ? event.eventAt.getTime() : new Date(event?.eventAt || 0).getTime();
  if (!userId || !Number.isFinite(eventMs)) return;
  state.firstEventMs = Math.min(state.firstEventMs, eventMs);
  state.lastEventMs = Math.max(state.lastEventMs, eventMs);
  if (event.type === 'join') {
    closeReconstructedSession(state, userId, eventMs, 'replaced');
    state.openSessions.set(userId, { userId, channelName: String(event.channelName || ''), startMs: eventMs });
    return;
  }
  if (event.type === 'leave') {
    closeReconstructedSession(state, userId, eventMs, 'left');
    return;
  }
  if (event.type === 'move') {
    closeReconstructedSession(state, userId, eventMs, 'moved');
    state.openSessions.set(userId, { userId, channelName: String(event.afterChannel || event.beforeChannel || ''), startMs: eventMs });
  }
};

const isVoiceLogRecord = (record) => /(?:joined|left|changed) voice channel|sprachkanal/i.test(String(record?.embeds?.[0]?.title || ''));

export const reconstructVoiceLogSessions = (events = []) => {
  const state = {
    sessions: [],
    openSessions: new Map(),
    firstEventMs: Number.POSITIVE_INFINITY,
    lastEventMs: 0,
    firstVoiceRecordMs: Number.POSITIVE_INFINITY,
    unparsedVoiceEventMs: []
  };
  const ordered = [...events].sort((left, right) => new Date(left?.eventAt || 0).getTime() - new Date(right?.eventAt || 0).getTime());
  for (const event of ordered) consumeVoiceLogEvent(state, event);
  return state;
};

const getVoiceLogIndexRevision = (guildId, channelId) => {
  const db = openIndexDatabase();
  if (!db) return null;
  try {
    const summary = db.prepare(`
      SELECT COUNT(*) AS row_count, MIN(created_at) AS oldest_at, MAX(created_at) AS newest_at
        FROM messages WHERE guild_id = ? AND channel_id = ?
    `).get(String(guildId), String(channelId));
    const newest = summary?.newest_at
      ? db.prepare(`
          SELECT message_id, created_at FROM messages
           WHERE guild_id = ? AND channel_id = ? AND created_at = ?
           ORDER BY message_id DESC LIMIT 1
        `).get(String(guildId), String(channelId), String(summary.newest_at))
      : null;
    return {
      rowCount: Number(summary?.row_count || 0),
      oldestAt: String(summary?.oldest_at || ''),
      newestAt: String(newest?.created_at || summary?.newest_at || ''),
      newestMessageId: String(newest?.message_id || '')
    };
  } catch {
    return null;
  }
};

const getIndexVoiceLogsSince = (guildId, channelId, createdAt, messageId) => {
  const db = openIndexDatabase();
  if (!db) return [];
  return db.prepare(`
    SELECT message_id, created_at, record_json FROM messages
     WHERE guild_id = ? AND channel_id = ?
       AND (created_at > ? OR (created_at = ? AND message_id > ?))
     ORDER BY created_at ASC, message_id ASC
  `).all(String(guildId), String(channelId), String(createdAt), String(createdAt), String(messageId));
};

// Cursor-basierte Abfrage für paginierte Voice-Log-Events. Liefert eine Seite
// von rohen Carl-bot-Embeds, die als Voice-Events parsbar sind, zusammen mit
// einem Cursor für die nächste Seite. Die Abfrage ist abwärts gerichtet
// (neueste zuerst), da das die typische Dashboard-Nutzung ist.
const getVoiceLogEventsPage = (guildId, channelId, { limit = 50, cursor } = {}) => {
  const db = openIndexDatabase();
  if (!db) return { events: [], cursor: null, hasMore: false };
  const safeLimit = Math.min(Math.max(1, Number(limit) || 50), 100);
  let rows;
  if (cursor) {
    const cursorCreatedAt = String(cursor.createdAt || '');
    const cursorMessageId = String(cursor.messageId || '');
    rows = db.prepare(`
      SELECT message_id, created_at, record_json FROM messages
       WHERE guild_id = ? AND channel_id = ?
         AND (created_at < ? OR (created_at = ? AND message_id < ?))
       ORDER BY created_at DESC, message_id DESC
       LIMIT ?
    `).all(String(guildId), String(channelId), cursorCreatedAt, cursorCreatedAt, cursorMessageId, safeLimit + 1);
  } else {
    rows = db.prepare(`
      SELECT message_id, created_at, record_json FROM messages
       WHERE guild_id = ? AND channel_id = ?
       ORDER BY created_at DESC, message_id DESC
       LIMIT ?
    `).all(String(guildId), String(channelId), safeLimit + 1);
  }
  const hasMore = rows.length > safeLimit;
  const page = hasMore ? rows.slice(0, safeLimit) : rows;
  const events = [];
  for (const row of page) {
    try {
      const record = JSON.parse(row.record_json);
      const parsed = parseVoiceLogRecord(record);
      if (parsed) {
        events.push({
          messageId: row.message_id,
          createdAt: row.created_at,
          type: parsed.type,
          userId: parsed.userId || '',
          channelName: parsed.channelName || parsed.afterChannel || '',
          beforeChannel: parsed.beforeChannel || '',
          userName: parsed.userName || ''
        });
      }
    } catch { /* skip unparseable records */ }
  }
  const nextCursor = page.length > 0 ? { createdAt: page[page.length - 1].created_at, messageId: page[page.length - 1].message_id } : null;
  return { events, cursor: hasMore ? nextCursor : null, hasMore };
};

const sameVoiceLogRevision = (left, right) => Boolean(left && right
  && left.rowCount === right.rowCount
  && left.oldestAt === right.oldestAt
  && left.newestAt === right.newestAt
  && left.newestMessageId === right.newestMessageId);

const storeIndexedVoiceSessionState = ({ cacheKey, channelId, channelSource, revision, state, processedRows, parsedRows, incremental }) => {
  const result = {
    status: 'ok',
    changed: true,
    incremental: Boolean(incremental),
    channelId,
    channelSource,
    revision,
    revisionKey: `${revision.rowCount}:${revision.oldestAt}:${revision.newestAt}:${revision.newestMessageId}`,
    sessions: state.sessions,
    openSessions: state.openSessions,
    firstEventMs: Number.isFinite(state.firstEventMs) ? state.firstEventMs : 0,
    lastEventMs: state.lastEventMs,
    firstVoiceRecordMs: Number.isFinite(state.firstVoiceRecordMs) ? state.firstVoiceRecordMs : 0,
    unparsedVoiceEventMs: state.unparsedVoiceEventMs,
    processedRows,
    parsedRows
  };
  indexedVoiceSessionCache.set(cacheKey, result);
  return result;
};

export const getIndexedVoiceLogSessions = async ({ guild, cfg = {}, force = false } = {}) => {
  const guildId = String(guild?.id || '');
  const effective = resolveVoiceLogChannel(settings(cfg), guildId);
  if (!guildId || !effective.id) return { status: 'no-channel', sessions: [], openSessions: new Map() };
  const channelId = String(effective.id);
  const cacheKey = `${guildId}:${channelId}`;
  const revision = getVoiceLogIndexRevision(guildId, channelId);
  if (!revision) return { status: 'index-error', channelId, sessions: [], openSessions: new Map() };
  const cached = indexedVoiceSessionCache.get(cacheKey);
  if (!force && cached && sameVoiceLogRevision(cached.revision, revision)) return { ...cached, status: 'unchanged', changed: false };

  let state = null;
  let rows = null;
  let incremental = false;
  if (!force && cached && revision.rowCount >= cached.revision.rowCount && revision.oldestAt === cached.revision.oldestAt) {
    const delta = getIndexVoiceLogsSince(guildId, channelId, cached.revision.newestAt, cached.revision.newestMessageId);
    if (delta.length === revision.rowCount - cached.revision.rowCount) {
      state = {
        sessions: cached.sessions,
        openSessions: new Map(cached.openSessions),
        firstEventMs: cached.firstEventMs,
        lastEventMs: cached.lastEventMs,
        firstVoiceRecordMs: cached.firstVoiceRecordMs || Number.POSITIVE_INFINITY,
        unparsedVoiceEventMs: [...(cached.unparsedVoiceEventMs || [])]
      };
      rows = delta;
      incremental = true;
    }
  }
  if (!state) {
    const indexResult = getIndexVoiceLogs(guildId, channelId);
    if (!indexResult.available) return { status: 'index-error', channelId, error: indexResult.error, sessions: [], openSessions: new Map() };
    state = {
      sessions: [],
      openSessions: new Map(),
      firstEventMs: Number.POSITIVE_INFINITY,
      lastEventMs: 0,
      firstVoiceRecordMs: Number.POSITIVE_INFINITY,
      unparsedVoiceEventMs: []
    };
    rows = indexResult.rows;
  }

  let processedRows = 0;
  let parsedRows = 0;
  for (const row of rows || []) {
    processedRows += 1;
    if (processedRows % 500 === 0) await yieldToEventLoop();
    let record = null;
    try { record = JSON.parse(row.record_json); } catch { continue; }
    const rowMs = Date.parse(String(row.created_at || record?.createdAt || ''));
    const voiceRecord = isVoiceLogRecord(record);
    if (voiceRecord && Number.isFinite(rowMs)) state.firstVoiceRecordMs = Math.min(state.firstVoiceRecordMs, rowMs);
    const parsed = parseVoiceLogRecord(record);
    if (!parsed) {
      if (voiceRecord && Number.isFinite(rowMs)) state.unparsedVoiceEventMs.push(rowMs);
      continue;
    }
    parsedRows += 1;
    consumeVoiceLogEvent(state, parsed);
  }
  return storeIndexedVoiceSessionState({
    cacheKey,
    channelId,
    channelSource: effective.source,
    revision,
    state,
    processedRows,
    parsedRows,
    incremental
  });
};

// Lässt den Event-Loop regelmäßig atmen, wenn sehr viele Logs verarbeitet
// werden (einmaliger Voll-Scan) – sonst wartet Discord unnötig.
const yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve));

const clamp = (value, min, max, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

// -----------------------------------------------------------------------------
// AUTO-ERKENNUNG des Carl-bot-Log-Kanals im Server-Index
// -----------------------------------------------------------------------------
// Der Index enthält die KOMPLETTE Log-Historie – damit ist KEINE manuelle
// Kanal-Einstellung mehr nötig: Der Bot findet den Kanal selbst (der Kanal mit
// den meisten Carl-bot-Voice-Log-Embeds) und verarbeitet ihn automatisch.
// Nur wer einen anderen Kanal erzwingen will, setzt weiterhin channelId.
const detectedChannelCache = new Map(); // guildId -> { detection, at }

// Findet den Kanal mit den meisten echten Carl-bot-Voice-Log-Embeds.
// Rückgabe: { id, channelName, count } | null.
// Reihenfolge: 1) In-Memory-Cache (1 h) → 2) persistierte Erkennung (SQLite,
// sofort nach Neustart) → 3) voller Index-Scan (einmalig, wird persistiert).
// Der teure Scan blockiert den Event-Loop also nur EINMAL pro Server und
// danach nie wieder – kein „hat nicht rechtzeitig reagiert“-Risiko.
export const detectVoiceLogChannel = (guildId) => {
  const key = String(guildId || '');
  const cached = detectedChannelCache.get(key);
  if (cached && Date.now() - cached.at < 60 * 60 * 1000) return cached.detection;
  const persisted = getDetectedVoiceLogChannel(key);
  if (persisted) {
    detectedChannelCache.set(key, { detection: persisted, at: Date.now() });
    return persisted;
  }
  const db = openIndexDatabase();
  if (!db) return null;
  try {
    // Kandidaten: Kanäle mit vielen „…voice channel…“-Embeds (größter zuerst).
    const candidates = db.prepare(`
      SELECT channel_id, COUNT(*) AS cnt
        FROM messages
       WHERE guild_id = ? AND record_json LIKE '%voice channel%'
       GROUP BY channel_id
       ORDER BY cnt DESC
       LIMIT 5
    `).all(key);
    let detection = null;
    for (const candidate of candidates) {
      const rows = db.prepare(`
        SELECT message_id, record_json FROM messages
         WHERE guild_id = ? AND channel_id = ?
           AND record_json LIKE '%voice channel%'
         LIMIT 300
      `).all(key, String(candidate.channel_id));
      let parsedCount = 0;
      let channelName = '';
      for (const row of rows) {
        try {
          const record = JSON.parse(row.record_json);
          const parsed = parseVoiceLogRecord(record);
          if (parsed) {
            parsedCount += 1;
            if (!channelName) channelName = parsed.channelName || parsed.afterChannel || '';
          }
        } catch { /* Zeile nicht auswertbar – ignorieren */ }
      }
      const ratio = rows.length ? parsedCount / rows.length : 0;
      if (parsedCount >= 5 && ratio >= 0.5) {
        detection = {
          id: String(candidate.channel_id),
          channelName,
          count: Number(candidate.cnt),
          verified: parsedCount
        };
        break;
      }
    }
    detectedChannelCache.set(key, { detection, at: Date.now() });
    if (detection) setDetectedVoiceLogChannel(key, detection);
    return detection;
  } catch {
    return null;
  }
};

// Effektiver Log-Kanal: konfigurierter Kanal gewinnt, sonst Auto-Erkennung.
// Rückgabe: { id, source: 'config'|'auto'|'none', detected }.
export const resolveVoiceLogChannel = (conf, guildId) => {
  if (conf?.channelId) return { id: conf.channelId, source: 'config', detected: null };
  const detected = detectVoiceLogChannel(guildId);
  if (detected) return { id: detected.id, source: 'auto', detected };
  return { id: null, source: 'none', detected: null };
};

export const settings = (cfg = {}) => ({
  // Das Modul ist seit 3.9.204 immer aktiv (kein Schalter mehr): Die Daten
  // liegen komplett im Server-Index, werden automatisch erkannt und verbucht.
  // Der enabled-Wert aus alten Configs wird ignoriert.
  enabled: true,
  channelId: String(cfg.voiceLogImport?.channelId || '').trim(),
  // Standard 180 Tage (deckt die Inaktivitäts-Schwelle) – der Index-Pass liest
  // ohnehin die KOMPLETTE Index-Historie; backfillHours gilt nur für den
  // REST-Fallback (Kanal nie indexiert) und Offline-Zeiten vor dem Index.
  backfillHours: clamp(cfg.voiceLogImport?.backfillHours, 1, 24 * 730, 24 * 180),
  batchSize: clamp(cfg.voiceLogImport?.batchSize, 20, 200, 100),
  maxPages: clamp(cfg.voiceLogImport?.maxPages, 1, 1000, 100),
  indexMaxRows: clamp(cfg.voiceLogImport?.indexMaxRows, 1_000, 500_000, 250_000)
});

// -----------------------------------------------------------------------------
// Parser: Carl-bot-Voice-Log-Embed → { type, userId, channelName(s), at }
// -----------------------------------------------------------------------------
const USER_ID_RE = /ID:\s*(\d{15,20})/i;
const AVATAR_USER_ID_RE = /(?:users|avatars)\/(\d{15,20})\//i;

const parseUserId = (embed) => {
  const fromFooter = String(embed.footer?.text || '').match(USER_ID_RE);
  if (fromFooter) return fromFooter[1];
  const fromIcon = String(embed.author?.iconURL || '').match(AVATAR_USER_ID_RE);
  if (fromIcon) return fromIcon[1];
  return null;
};

// Entfernt Markdown-Fettung und „#“-Prefix vom Kanalnamen.
const cleanChannelName = (value) => String(value || '')
  .replace(/\*\*/g, '')
  .replace(/^#+/, '')
  .replace(/[`*_]/g, '')
  .trim();

// Kern-Logik: parst ein Carl-bot-Voice-Embed (als Plain-Objekt, wie es in
// record_json des Server-Index liegt) zu { type, userId, eventAt, channel… }.
// Wird sowohl von parseVoiceLogMessage (Live, Discord.js-Objekt) als auch vom
// Index-Backfill (record_json) genutzt.
export const parseVoiceLogRecord = (record) => {
  const embed = record?.embeds?.[0];
  if (!embed || typeof embed !== 'object') return null;
  const title = String(embed.title || '');
  const desc = String(embed.description || '');
  if (!title || !desc) return null;

  const isJoin = /joined voice/i.test(title) || /voice channel/i.test(title) && /beigetreten|betreten/i.test(title) || /sprachkanal.*beigetreten/i.test(title);
  const isLeave = /left voice/i.test(title) || /voice channel/i.test(title) && /verlassen/i.test(title) || /sprachkanal.*verlassen/i.test(title);
  const isMove = /changed voice/i.test(title) || /voice channel/i.test(title) && /gewechselt|gewechselt|wechselte/i.test(title) || /sprachkanal.*gewechselt/i.test(title);

  let type = null;
  if (isJoin) type = 'join';
  else if (isLeave) type = 'leave';
  else if (isMove) type = 'move';
  if (!type) return null;

  const userId = parseUserId(embed);
  if (!userId) return null;

  const eventAt = embed.timestamp && !Number.isNaN(new Date(embed.timestamp).getTime())
    ? new Date(embed.timestamp)
    : new Date(record?.createdAt || record?.createdTimestamp || Date.now());

  // Beschreibungs-Formate:
  //   join/leave: „**name** joined #channel“ / „**name** left #channel“
  //   move:       „**Before:** #alt\n**+After:** #neu“
  // Markdown-Fettung (**) vorab entfernen, damit die Kanal-Namen sauber
  // extrahiert werden (echte Carl-bot-Embeds nutzen ** um Namen zu fetten).
  const cleanDesc = desc.replace(/\*\*/g, '');
  if (type === 'move') {
    const before = String(cleanDesc.match(/(?:Before|Vorher)\s*:\s*#?\s*([^\n]+)/i)?.[1] || '').trim();
    const after = String(cleanDesc.match(/(?:\+?\s*After|Nachher)\s*:\s*#?\s*([^\n]+)/i)?.[1] || '').trim();
    if (!before && !after) return null;
    return { type, userId, eventAt, beforeChannel: cleanChannelName(before), afterChannel: cleanChannelName(after) };
  }

  const match = String(cleanDesc).match(/^\*\*(.+?)\*\*\s+(?:joined|left|beigetreten|betreten|verlassen)\s+#(.+)$/is) || String(cleanDesc).match(/^(.+?)\s+(?:joined|left|beigetreten|betreten|verlassen)\s+#(.+)$/is);
  if (!match) return null;
  const namePart = String(match[1] || '').trim();
  const channelPart = String(match[2] || '').trim();
  if (!channelPart) return null;
  return { type, userId, eventAt, channelName: cleanChannelName(channelPart), userName: namePart };
};

// Live: Discord.js-Message-Objekt → Record-Format delegieren.
export const parseVoiceLogMessage = (message) => {
  if (!message?.embeds?.[0]) return null;
  return parseVoiceLogRecord({
    embeds: message.embeds,
    createdAt: new Date(message.createdTimestamp || message.createdAt || Date.now()).toISOString()
  });
};

// Kanal-ID aus Namen auflösen (Cache zuerst – kein REST).
const resolveChannelId = (guild, channelName) => {
  if (!guild || !channelName) return channelName || '';
  const normalized = String(channelName).toLowerCase();
  const cache = guild.channels?.cache;
  if (cache) {
    for (const channel of (typeof cache.values === 'function' ? cache.values() : [])) {
      if (String(channel?.name || '').toLowerCase() === normalized) return String(channel.id || '');
    }
  }
  return channelName;
};

// -----------------------------------------------------------------------------
// Verarbeitung einer einzelnen Log-Nachricht (Live + Backfill)
// -----------------------------------------------------------------------------
const processedThisRun = new Set(); // In-Memory-Dedup zusätzlich zum Store

const applyVoiceLog = async ({ guild, message, parsed, processedIds = null }) => {
  const key = String(message?.id || `${parsed.userId}:${parsed.eventAt.getTime()}`);
  if (processedThisRun.has(key)) return 'duplicate';
  if (processedIds) {
    // Index-Backfill: ein vorab geladenes Set statt einer Einzel-Query je Zeile.
    if (message?.id && processedIds.has(String(message.id))) return 'duplicate';
  } else if (message?.id && isVoiceLogProcessed(message.id)) {
    return 'duplicate';
  }

  if (parsed.type === 'join') {
    await importVoiceSession.open(guild.id, parsed.userId, resolveChannelId(guild, parsed.channelName), parsed.eventAt);
  } else if (parsed.type === 'leave') {
    await importVoiceSession.close(guild.id, parsed.userId, 'left', parsed.eventAt);
  } else if (parsed.type === 'move') {
    const beforeId = resolveChannelId(guild, parsed.beforeChannel);
    const afterId = resolveChannelId(guild, parsed.afterChannel);
    await importVoiceSession.close(guild.id, parsed.userId, 'moved', parsed.eventAt);
    await importVoiceSession.open(guild.id, parsed.userId, afterId || beforeId, parsed.eventAt);
  }

  // Index-abgeleitete Voice-Aktivität fortschreiben: WANN war der Nutzer
  // zuletzt im Call? Quelle ist der Server-Index (Carl-bot-Logs) – nicht der
  // Live-Zustand. Die Inaktivitäts-Erinnerung liest daraus den Beweis, auch
  // nach Neustarts/Offline-Zeiten.
  setUserLastVoiceAt({ guildId: guild.id, userId: parsed.userId, eventAt: parsed.eventAt });

  processedThisRun.add(key);
  if (message?.id) {
    processedIds?.add(String(message.id));
    markVoiceLogProcessed({
      messageId: message.id,
      guildId: guild.id,
      channelId: String(message.channelId || ''),
      action: parsed.type,
      userId: parsed.userId
    });
  }
  return parsed.type;
};

// -----------------------------------------------------------------------------
// Backfill: vergangene Logs nachholen (Offline-Zeiten exakt verbuchen)
//
// 1. INDEX-PASS (Hauptquelle): Der Server-Index enthält ALLE je aufgezeichneten
//    Logs des Kanals (bei euch: seit Nov 2024, ~185.000 Zeilen). Eine einzige
//    SQL-Query liefert die komplette Historie mit Embeds – damit weiß die
//    Inaktivitäts-Erinnerung zuverlässig, wer in den letzten 180 Tagen im Call
//    war, auch wenn der Bot dazwischen offline war.
// 2. REST-FALLBACK: Nur für Logs, die der Index nicht hat (z. B. Kanal wurde
//    nie indexiert) – holt die letzten backfillHours direkt aus dem Kanal.
// -----------------------------------------------------------------------------
const backfillRunning = new Map(); // guildId -> Promise (Single-Flight)

export const runVoiceLogBackfill = async ({ guild, cfg, source = 'startup' } = {}) => {
  const conf = settings(cfg);
  const effective = resolveVoiceLogChannel(conf, guild?.id);
  if (!guild || !effective.id) {
    return { status: 'skipped', source, channelSource: effective.source, indexRows: 0, fetched: 0, applied: 0, duplicates: 0, unparsed: 0 };
  }
  const channelId = effective.id;
  if (backfillRunning.has(guild.id)) {
    // Single-Flight, aber blockierend: Warte auf den LAUFENDEN Backfill statt
    // sofort „already-running“ zu liefern. So kann z. B. die Inaktivitäts-
    // Erinnerung ihren Scan erst starten, wenn die Carl-bot-Voice-Daten
    // wirklich verbucht sind – sonst gewinnt der Scan-Race und schreibt DMs
    // an Mitglieder, die in Wahrheit aktiv im Call sind.
    return backfillRunning.get(guild.id);
  }

  const run = (async () => {
    const result = { status: 'ok', source, channelSource: effective.source, indexRows: 0, fetched: 0, applied: 0, duplicates: 0, unparsed: 0 };
    let reconstructedState = null;
    let reconstructedParsedRows = 0;

    // ---- 1) INDEX-PASS: komplette Historie aus dem Server-Index -------------
    try {
      const indexResult = getIndexVoiceLogs(guild.id, channelId);
      if (!indexResult.available) {
        processedThisRun.clear();
        return { ...result, status: 'index-error', error: indexResult.error };
      }
      const { rows } = indexResult;
      if (rows) {
        reconstructedState = {
          sessions: [],
          openSessions: new Map(),
          firstEventMs: Number.POSITIVE_INFINITY,
          lastEventMs: 0,
          firstVoiceRecordMs: Number.POSITIVE_INFINITY,
          unparsedVoiceEventMs: []
        };
        const processedIds = getProcessedVoiceLogIds(guild.id, channelId);
        let cursor = 0;
        for (const row of rows) {
          cursor += 1;
          // Bei sehr vielen Logs: Event-Loop atmen lassen (kein Blockieren).
          if (cursor % 100 === 0) await yieldToEventLoop();
          let record = null;
          try { record = JSON.parse(row.record_json); } catch { result.unparsed += 1; continue; }
          const rowMs = Date.parse(String(row.created_at || record?.createdAt || ''));
          const voiceRecord = isVoiceLogRecord(record);
          if (voiceRecord && Number.isFinite(rowMs)) reconstructedState.firstVoiceRecordMs = Math.min(reconstructedState.firstVoiceRecordMs, rowMs);
          const parsed = parseVoiceLogRecord(record);
          if (!parsed) {
            if (voiceRecord && Number.isFinite(rowMs)) reconstructedState.unparsedVoiceEventMs.push(rowMs);
            result.unparsed += 1;
            continue;
          }
          consumeVoiceLogEvent(reconstructedState, parsed);
          reconstructedParsedRows += 1;
          const outcome = await applyVoiceLog({
            guild,
            message: { id: String(record.id || row.message_id), channelId: String(record.channelId || channelId) },
            parsed,
            processedIds
          });
          if (outcome === 'duplicate') result.duplicates += 1;
          else result.applied += 1;
        }
        result.indexRows = cursor;
        const revision = getVoiceLogIndexRevision(guild.id, channelId);
        if (revision) {
          storeIndexedVoiceSessionState({
            cacheKey: `${guild.id}:${channelId}`,
            channelId,
            channelSource: effective.source,
            revision,
            state: reconstructedState,
            processedRows: cursor,
            parsedRows: reconstructedParsedRows,
            incremental: false
          });
        }
      }
    } catch (error) {
      console.warn(`[voiceLogImport] Index-Pass fehlgeschlagen: ${error?.message || error}`);
    }

    // ---- 2) REST-FALLBACK: Logs, die der Index nicht abdeckt ---------------
    // Nur nötig, wenn der Kanal gar nicht im Index liegt (Kanal neu gewählt).
    if (!result.indexRows) {
      const channel = guild.channels.cache.get(channelId) || guild.client?.channels?.cache?.get(channelId) || null;
      if (!channel || !channel.isTextBased?.()) {
        processedThisRun.clear();
        return { ...result, status: 'no-channel' };
      }
      const cutoffMs = Date.now() - conf.backfillHours * 60 * 60 * 1000;
      let cursor = undefined;
      const collected = [];
      try {
        for (let page = 0; page < conf.maxPages; page += 1) {
          const fetched = await channel.messages.fetch({ limit: conf.batchSize, before: cursor });
          if (!fetched.size) break;
          for (const msg of fetched.values()) {
            const at = new Date(msg.createdTimestamp || Date.now()).getTime();
            if (at < cutoffMs) continue;
            collected.push(msg);
          }
          result.fetched += fetched.size;
          cursor = fetched.last()?.id;
          if (fetched.size < conf.batchSize) break;
        }
      } catch (error) {
        console.warn(`[voiceLogImport] Backfill-Fetch fehlgeschlagen: ${error?.message || error}`);
        processedThisRun.clear();
        return { ...result, status: 'fetch-error' };
      }
      // Chronologisch (älteste zuerst) verarbeiten – Session-Paare stimmen.
      collected.sort((a, b) => (a.createdTimestamp || 0) - (b.createdTimestamp || 0));
      for (const msg of collected) {
        const parsed = parseVoiceLogMessage(msg);
        if (!parsed) { result.unparsed += 1; continue; }
        const outcome = await applyVoiceLog({ guild, message: msg, parsed });
        if (outcome === 'duplicate') result.duplicates += 1;
        else result.applied += 1;
      }
    }

    processedThisRun.clear();
    return result;
  })();

  backfillRunning.set(guild.id, run);
  try {
    return await run;
  } finally {
    if (backfillRunning.get(guild.id) === run) backfillRunning.delete(guild.id);
  }
};

// -----------------------------------------------------------------------------
// Feature
// -----------------------------------------------------------------------------
export const getVoiceLogSnapshot = (guildId, cfg = {}) => {
  const conf = settings(cfg);
  const detected = detectVoiceLogChannel(guildId);
  const effective = resolveVoiceLogChannel(conf, guildId);
  return {
    enabled: true,
    channelId: conf.channelId,
    effectiveChannelId: effective.id || '',
    channelSource: effective.source,
    detectedChannel: detected
      ? { id: detected.id, channelName: detected.channelName || '', count: detected.count }
      : null,
    backfillHours: conf.backfillHours,
    processedCount: countProcessedVoiceLogs(String(guildId || ''))
  };
};

export const feature = {
  id: 'voiceLogImport',
  name: 'Carl-bot Voice-Log-Import',
  commands: [],

  async onClientReady({ guild, cfg }) {
    // Immer aktiv (kein Schalter): Kanal wird im Index erkannt, die komplette
    // Historie wird beim Start verbucht – auch Offline-Zeiten exakt.
    if (!resolveVoiceLogChannel(settings(cfg), guild.id).id) return;
    await runVoiceLogBackfill({ guild, conf: cfg, source: 'startup' })
      .catch((error) => console.warn(`[voiceLogImport] Start-Backfill fehlgeschlagen: ${error?.message || error}`));
  },

  async onConfigUpdate({ guild, cfg, patch }) {
    if (!patch || !Object.prototype.hasOwnProperty.call(patch, 'voiceLogImport')) return;
    if (resolveVoiceLogChannel(settings(cfg), guild.id).id) {
      void runVoiceLogBackfill({ guild, conf: cfg, source: 'config' })
        .catch((error) => console.warn(`[voiceLogImport] Config-Backfill fehlgeschlagen: ${error?.message || error}`));
    }
  },

  async onMessageCreate(context) {
    await handleLiveVoiceLogMessage(context);
  },

  // Carl-bot-Logging postet als Bot → auch diesen Hook bedienen. WICHTIG: Kein
  // this.onMessageCreate – der Dispatcher ruft Handler als plain functions auf
  // (this = undefined) und die Live-Verarbeitung wäre still kaputt gewesen.
  async onBotMessageCreate(context) {
    await handleLiveVoiceLogMessage(context);
  }
};

// Gemeinsamer Live-Pfad für normale UND Bot-Nachrichten (Carl-bot postet als
// Bot). Beide Hooks laufen über dieselbe Funktion.
const handleLiveVoiceLogMessage = async (context = {}) => {
  const { message, cfg } = context;
  const conf = settings(cfg);
  if (conf.channelId) {
    // Konfigurierter Kanal: nur dessen Nachrichten verarbeiten.
    if (String(message?.channelId || '') !== conf.channelId) return;
    const parsed = parseVoiceLogMessage(message);
    if (!parsed) return;
    await applyVoiceLog({ guild: message.guild, message, parsed }).catch((error) => {
      console.warn(`[voiceLogImport] Live-Verarbeitung fehlgeschlagen: ${error?.message || error}`);
    });
    return;
  }
  // Auto-Modus (kein Kanal gesetzt): echte Carl-bot-Logs erkennen und
  // verarbeiten – fremde Nachrichten werden über den billigen Embed-Check
  // aussortiert. Liegt der erkannte Kanal bereits fest, nur dort verarbeiten.
  if (!message?.embeds?.[0]) return;
  const parsed = parseVoiceLogMessage(message);
  if (!parsed) return;
  const detected = detectVoiceLogChannel(message.guild?.id);
  if (detected && String(message?.channelId || '') !== detected.id) return;
  await applyVoiceLog({ guild: message.guild, message, parsed }).catch((error) => {
    console.warn(`[voiceLogImport] Live-Verarbeitung fehlgeschlagen: ${error?.message || error}`);
  });
};

export { getVoiceLogEventsPage };

export const _voiceLogImportInternals = {
  settings,
  parseVoiceLogMessage,
  parseVoiceLogRecord,
  runVoiceLogBackfill,
  getVoiceLogSnapshot,
  applyVoiceLog,
  getIndexVoiceLogs,
  detectVoiceLogChannel,
  resolveVoiceLogChannel,
  feature,
  handleLiveVoiceLogMessage,
  getLastVoiceAtMap,
  getAllLastVoiceAt,
  setUserLastVoiceAt,
  reconstructVoiceLogSessions,
  getIndexedVoiceLogSessions,
  getVoiceLogIndexRevision,
  getVoiceLogEventsPage
};
