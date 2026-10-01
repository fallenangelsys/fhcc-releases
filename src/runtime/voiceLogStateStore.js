// ---------------------------------------------------------------------------
// Voice-Log-Import – Verarbeitungszustand (SQLite).
// Speichert, welche Carl-bot-Log-Nachrichten bereits verarbeitet wurden.
// Damit zählt der Backfill nach einem Neustart/Offline-Zeitraum keine
// Voice-Session doppelt und der Bot kann exakt dort weitermachen, wo er
// aufgehört hat.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const DATA_ROOT = process.env.FALLEN_HEAVEN_DATA_DIR
  || (process.platform === 'win32' && process.env.APPDATA
    ? path.join(process.env.APPDATA, 'FALLEN HEAVEN Control Center', 'runtime', 'data')
    : path.join(process.cwd(), 'data'));
const DATABASE_FILE = path.join(DATA_ROOT, 'voice-log-state.sqlite3');

let database = null;

const openDatabase = () => {
  if (database) return database;
  fs.mkdirSync(path.dirname(DATABASE_FILE), { recursive: true });
  database = new Database(DATABASE_FILE, { timeout: 15_000 });
  database.pragma('journal_mode = WAL');
  database.pragma('synchronous = NORMAL');
  database.pragma('busy_timeout = 15000');
  database.exec(`
    CREATE TABLE IF NOT EXISTS processed_voice_logs(
      message_id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      action TEXT NOT NULL,
      user_id TEXT,
      processed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS voice_logs_guild_processed_idx ON processed_voice_logs(guild_id, processed_at);
    CREATE TABLE IF NOT EXISTS voice_log_detection(
      guild_id TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    -- Index-abgeleitete Voice-Aktivität je Mitglied (Quelle: Carl-bot-Logs im
    -- Server-Index). Wird bei JEDEM verarbeiteten Log (Backfill + Live) per
    -- Upsert fortgeschrieben und übersteht Neustarts/Updates komplett – damit
    -- weiß die Inaktivitäts-Erinnerung zuverlässig, WER WANN zuletzt im Call
    -- war, auch wenn der Bot dazwischen offline war. Das ist die persistente
    -- Antwort auf „im Index“ statt „aktuell im Call“.
    CREATE TABLE IF NOT EXISTS user_last_voice(
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      last_voice_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS user_last_voice_guild_idx ON user_last_voice(guild_id, last_voice_at);
  `);
  return database;
};

export const markVoiceLogProcessed = ({ messageId, guildId, channelId, action = '', userId = '' } = {}) => {
  if (!messageId) return;
  const db = openDatabase();
  db.prepare(`
    INSERT OR IGNORE INTO processed_voice_logs(message_id, guild_id, channel_id, action, user_id, processed_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(String(messageId), String(guildId || ''), String(channelId || ''), String(action || ''), String(userId || ''), new Date().toISOString());
};

export const isVoiceLogProcessed = (messageId) => {
  if (!messageId) return false;
  const db = openDatabase();
  return Boolean(db.prepare('SELECT 1 FROM processed_voice_logs WHERE message_id = ?').get(String(messageId)));
};

// Älteste verarbeitete Message-ID je Kanal – Backfill startet ab diesem Punkt.
export const getOldestProcessedForChannel = (guildId, channelId) => {
  const db = openDatabase();
  const row = db.prepare(`
    SELECT message_id FROM processed_voice_logs
     WHERE guild_id = ? AND channel_id = ?
     ORDER BY processed_at ASC, message_id ASC LIMIT 1
  `).get(String(guildId || ''), String(channelId || ''));
  return row?.message_id || null;
};

// Anzahl verarbeiteter Logs (für die Modul-Übersicht).
export const countProcessedVoiceLogs = (guildId) => {
  const db = openDatabase();
  const row = db.prepare('SELECT COUNT(*) AS n FROM processed_voice_logs WHERE guild_id = ?').get(String(guildId || ''));
  return Number(row?.n || 0);
};

// Alle verarbeiteten Message-IDs eines Kanals als Set – für den Index-Backfill
// (eine Query statt einer Einzelabfrage pro Log-Zeile bei zehntausenden Zeilen).
export const getProcessedVoiceLogIds = (guildId, channelId) => {
  const db = openDatabase();
  const rows = db.prepare('SELECT message_id FROM processed_voice_logs WHERE guild_id = ? AND channel_id = ?').all(String(guildId || ''), String(channelId || ''));
  return new Set(rows.map((row) => String(row.message_id)));
};

// Auto-erkannter Carl-bot-Log-Kanal (persistiert). Nach dem ersten teuren
// Index-Scan liegt die Erkennung in SQLite – Neustarts und Status-Aufrufe
// lesen sie sofort statt den kompletten Index erneut zu scannen (Event-Loop
// bleibt frei – keine „hat nicht rechtzeitig reagiert“-Risiken beim Start).
export const getDetectedVoiceLogChannel = (guildId) => {
  const db = openDatabase();
  const row = db.prepare('SELECT value FROM voice_log_detection WHERE guild_id = ?').get(String(guildId || ''));
  if (!row) return null;
  try { return JSON.parse(String(row.value)); } catch { return null; }
};

export const setDetectedVoiceLogChannel = (guildId, detection) => {
  const db = openDatabase();
  db.prepare(`
    INSERT INTO voice_log_detection(guild_id, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(String(guildId || ''), JSON.stringify(detection || null), new Date().toISOString());
};

// Fortschreiben der index-abgeleiteten Voice-Aktivität. Bei jedem verarbeiteten
// Carl-bot-Log (join/leave/move) wird der Zeitpunkt des Events als „zuletzt im
// Call“ gespeichert – ein Upsert pro Log, kein Löschen, keine Sessions nötig.
export const setUserLastVoiceAt = ({ guildId, userId, eventAt } = {}) => {
  if (!guildId || !userId) return;
  const db = openDatabase();
  const iso = eventAt && !Number.isNaN(new Date(eventAt).getTime()) ? new Date(eventAt).toISOString() : new Date().toISOString();
  db.prepare(`
    INSERT INTO user_last_voice(guild_id, user_id, last_voice_at, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET
      last_voice_at = CASE WHEN excluded.last_voice_at > user_last_voice.last_voice_at THEN excluded.last_voice_at ELSE user_last_voice.last_voice_at END,
      updated_at = excluded.updated_at
  `).run(String(guildId), String(userId), iso, new Date().toISOString());
};

// Letzte Voice-Zeit je Mitglied aus der index-abgeleiteten Tabelle.
// Rückgabe: { [userId]: lastVoiceAtMs }. Chunking gegen die SQLite-
// Variablen-Grenze, wenn sehr viele Kandidaten angefragt werden.
export const getLastVoiceAtMap = (guildId, userIds = []) => {
  const ids = (Array.isArray(userIds) ? userIds : []).map((id) => String(id)).filter(Boolean);
  const map = {};
  if (!ids.length) return map;
  const db = openDatabase();
  const CHUNK = 400;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT user_id, last_voice_at FROM user_last_voice
       WHERE guild_id = ? AND user_id IN (${placeholders})
    `).all(String(guildId || ''), ...chunk);
    for (const row of rows) {
      const ms = row.last_voice_at ? Date.parse(String(row.last_voice_at)) : 0;
      if (Number.isFinite(ms) && ms > 0) map[String(row.user_id)] = ms;
    }
  }
  return map;
};

// Kompletter Stand der index-abgeleiteten Voice-Aktivität eines Servers.
export const getAllLastVoiceAt = (guildId) => {
  const db = openDatabase();
  const rows = db.prepare('SELECT user_id, last_voice_at FROM user_last_voice WHERE guild_id = ?').all(String(guildId || ''));
  const map = {};
  for (const row of rows) {
    const ms = row.last_voice_at ? Date.parse(String(row.last_voice_at)) : 0;
    if (Number.isFinite(ms) && ms > 0) map[String(row.user_id)] = ms;
  }
  return map;
};

export const closeVoiceLogStateStore = () => {
  if (database) { try { database.close(); } catch {} database = null; }
};

export const _voiceLogStateStoreInternals = { openDatabase, DATABASE_FILE, getAllLastVoiceAt };
