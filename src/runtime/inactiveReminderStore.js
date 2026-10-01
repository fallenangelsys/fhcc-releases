// ---------------------------------------------------------------------------
// SQLite-Store für die Inaktivitäts-Erinnerung.
// Speichert professionell, WEM wann eine Erinnerung geschrieben wurde und wie
// die Antwort ausfiel (stay/leave/timeout) – übersteht Neustarts und
// Offline-Phasen. Eigene Datenbank (inactive-reminders.sqlite3) im selben
// Datenordner wie der Server-Index.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const DATA_ROOT = process.env.FALLEN_HEAVEN_DATA_DIR
  || (process.platform === 'win32' && process.env.APPDATA
    ? path.join(process.env.APPDATA, 'FALLEN HEAVEN Control Center', 'runtime', 'data')
    : path.join(process.cwd(), 'data'));
const DATABASE_FILE = path.join(DATA_ROOT, 'inactive-reminders.sqlite3');

let database = null;

const openDatabase = () => {
  if (database) return database;
  fs.mkdirSync(path.dirname(DATABASE_FILE), { recursive: true });
  database = new Database(DATABASE_FILE, { timeout: 15_000 });
  database.pragma('journal_mode = WAL');
  database.pragma('synchronous = NORMAL');
  database.pragma('busy_timeout = 15000');
  database.exec(`
    CREATE TABLE IF NOT EXISTS inactive_reminders(
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'sent',
      dm_sent_at TEXT,
      responded_at TEXT,
      response TEXT,
      next_reminder_at TEXT,
      kicked_at TEXT,
      dm_channel_id TEXT,
      dm_message_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS inactive_reminders_guild_status_idx ON inactive_reminders(guild_id, status, dm_sent_at);
    CREATE INDEX IF NOT EXISTS inactive_reminders_due_idx ON inactive_reminders(guild_id, next_reminder_at);
  `);
  // Migration für Bestandsdatenbanken: dm_channel_id/dm_message_id nachrüsten.
  const cols = database.prepare('PRAGMA table_info(inactive_reminders)').all().map((c) => c.name);
  if (!cols.includes('dm_channel_id')) database.exec('ALTER TABLE inactive_reminders ADD COLUMN dm_channel_id TEXT');
  if (!cols.includes('dm_message_id')) database.exec('ALTER TABLE inactive_reminders ADD COLUMN dm_message_id TEXT');
  return database;
};

const nowIso = () => new Date().toISOString();

const rowToReminder = (row) => (row ? {
  guildId: row.guild_id,
  userId: row.user_id,
  username: row.username || '',
  status: row.status || 'sent',
  dmSentAt: row.dm_sent_at || null,
  respondedAt: row.responded_at || null,
  response: row.response || null,
  nextReminderAt: row.next_reminder_at || null,
  kickedAt: row.kicked_at || null,
  dmChannelId: row.dm_channel_id || null,
  dmMessageId: row.dm_message_id || null,
  createdAt: row.created_at,
  updatedAt: row.updated_at
} : null);

// Legt einen Eintrag an oder aktualisiert ihn (upsert auf (guild_id, user_id)).
export const upsertInactiveReminder = ({ guildId, userId, username = '', status = 'sent', dmSentAt = null, respondedAt = null, response = null, nextReminderAt = null, kickedAt = null, dmChannelId = null, dmMessageId = null } = {}) => {
  if (!guildId || !userId) return null;
  const db = openDatabase();
  const existing = db.prepare('SELECT created_at FROM inactive_reminders WHERE guild_id = ? AND user_id = ?').get(String(guildId), String(userId));
  const createdAt = existing?.created_at || nowIso();
  db.prepare(`
    INSERT INTO inactive_reminders(guild_id, user_id, username, status, dm_sent_at, responded_at, response, next_reminder_at, kicked_at, dm_channel_id, dm_message_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET
      username = excluded.username,
      status = excluded.status,
      dm_sent_at = excluded.dm_sent_at,
      responded_at = excluded.responded_at,
      response = excluded.response,
      next_reminder_at = excluded.next_reminder_at,
      kicked_at = excluded.kicked_at,
      dm_channel_id = excluded.dm_channel_id,
      dm_message_id = excluded.dm_message_id,
      updated_at = excluded.updated_at
  `).run(
    String(guildId), String(userId), String(username || '').slice(0, 80), String(status || 'sent'),
    dmSentAt || null, respondedAt || null, response || null, nextReminderAt || null, kickedAt || null,
    dmChannelId || null, dmMessageId || null,
    createdAt, nowIso()
  );
  return getInactiveReminder(guildId, userId);
};

export const getInactiveReminder = (guildId, userId) => {
  const db = openDatabase();
  return rowToReminder(db.prepare('SELECT * FROM inactive_reminders WHERE guild_id = ? AND user_id = ?').get(String(guildId), String(userId)));
};

// Alle Einträge eines Servers – optional nach Status gefiltert.
export const listInactiveReminders = (guildId, { status = null, limit = 500, offset = 0 } = {}) => {
  const db = openDatabase();
  const params = [String(guildId)];
  let sql = 'SELECT * FROM inactive_reminders WHERE guild_id = ?';
  if (status) { sql += ' AND status = ?'; params.push(String(status)); }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(Math.max(1, Math.min(2000, Number(limit) || 500)), Math.max(0, Number(offset) || 0));
  return db.prepare(sql).all(...params).map(rowToReminder);
};

// Gesamtzahl der gespeicherten Erinnerungen eines Servers (für Pagination).
export const countInactiveReminders = (guildId) => {
  const db = openDatabase();
  const row = db.prepare('SELECT COUNT(*) AS c FROM inactive_reminders WHERE guild_id = ?').get(String(guildId));
  return Number(row?.c || 0);
};

// Fällige Folge-Erinnerungen (stayed und next_reminder_at <= now).
export const listDueInactiveReminders = (guildId, nowMs = Date.now()) => {
  const db = openDatabase();
  return db.prepare(`
    SELECT * FROM inactive_reminders
     WHERE guild_id = ? AND status = 'stayed' AND next_reminder_at IS NOT NULL AND next_reminder_at <= ?
     ORDER BY next_reminder_at ASC LIMIT 500
  `).all(String(guildId), new Date(nowMs).toISOString()).map(rowToReminder);
};

// Offene Erinnerungen ohne Antwort (für den 24h-Timeout).
export const listPendingInactiveReminders = (guildId, beforeMs = Date.now()) => {
  const db = openDatabase();
  return db.prepare(`
    SELECT * FROM inactive_reminders
     WHERE guild_id = ? AND status = 'sent' AND dm_sent_at IS NOT NULL AND dm_sent_at <= ?
     ORDER BY dm_sent_at ASC LIMIT 500
  `).all(String(guildId), new Date(beforeMs).toISOString()).map(rowToReminder);
};

export const updateInactiveReminderStatus = ({ guildId, userId, status, respondedAt = null, response = null, nextReminderAt = null, kickedAt = null, dmChannelId = null, dmMessageId = null } = {}) => {
  const db = openDatabase();
  db.prepare(`
    UPDATE inactive_reminders
       SET status = ?, responded_at = COALESCE(?, responded_at), response = COALESCE(?, response),
           next_reminder_at = COALESCE(?, next_reminder_at), kicked_at = COALESCE(?, kicked_at),
           dm_channel_id = COALESCE(?, dm_channel_id), dm_message_id = COALESCE(?, dm_message_id),
           updated_at = ?
     WHERE guild_id = ? AND user_id = ?
  `).run(String(status || 'sent'), respondedAt || null, response || null, nextReminderAt || null, kickedAt || null, dmChannelId || null, dmMessageId || null, nowIso(), String(guildId), String(userId));
  return getInactiveReminder(guildId, userId);
};

export const countInactiveReminderStats = (guildId) => {
  const db = openDatabase();
  const rows = db.prepare('SELECT status, COUNT(*) AS count FROM inactive_reminders WHERE guild_id = ? GROUP BY status').all(String(guildId));
  const stats = { 'pending-send': 0, sent: 0, 'dm-failed': 0, stayed: 0, 'leave-requested': 0, left: 0, kicked: 0, timeout: 0, total: 0 };
  for (const row of rows) {
    stats[row.status] = Number(row.count || 0);
    stats.total += Number(row.count || 0);
  }
  return stats;
};

// Setzt die DM-Referenz zurück (Nachricht gelöscht) und markiert den Eintrag
// als „dm-deleted“ – der Empfänger wird nie erneut angeschrieben.
export const markInactiveReminderDmDeleted = ({ guildId, userId }) => {
  const db = openDatabase();
  db.prepare(`
    UPDATE inactive_reminders
       SET dm_channel_id = NULL, dm_message_id = NULL, status = 'dm-deleted', updated_at = ?
     WHERE guild_id = ? AND user_id = ?
  `).run(nowIso(), String(guildId), String(userId));
  return getInactiveReminder(guildId, userId);
};

export const closeInactiveReminderStore = () => {
  if (database) { try { database.close(); } catch {} database = null; }
};

export const _inactiveReminderStoreInternals = {
  openDatabase,
  DATABASE_FILE
};
