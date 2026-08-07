import crypto from 'node:crypto';
import path from 'node:path';

import { PermissionFlagsBits } from 'discord.js';

import { atomicWriteJson, readJsonWithRecovery } from '../runtime/atomicJsonStore.js';
import { runTrackedOperation } from '../runtime/liveDiagnostics.js';

const DATA_DIR = path.resolve(String(process.env.FALLEN_HEAVEN_DATA_DIR || '').trim() || path.join(process.cwd(), 'data'));
const HISTORY_FILE = path.join(DATA_DIR, 'emoji-rename-history.json');
const activeOperations = new Map();
const lastPreviews = new Map();
let historyLoaded = false;
let historyStore = { version: 1, guilds: {} };

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const cleanPrefix = (value, fallback) => String(value ?? fallback ?? '').trim();
const isValidEmojiName = (name) => /^[A-Za-z0-9_]{2,32}$/.test(String(name || ''));

const normalizeEmojiManagerConfig = (conf = {}, overrides = {}) => ({
  enabled: conf?.enabled !== false,
  oldPrefix: cleanPrefix(overrides.oldPrefix, conf?.oldPrefix || 'vl_'),
  newPrefix: cleanPrefix(overrides.newPrefix, conf?.newPrefix || 'fh_'),
  includeStatic: overrides.includeStatic === undefined ? conf?.includeStatic !== false : overrides.includeStatic === true,
  includeAnimated: overrides.includeAnimated === undefined ? conf?.includeAnimated !== false : overrides.includeAnimated === true
});

const ensureHistoryLoaded = async () => {
  if (historyLoaded) return;
  historyLoaded = true;
  const result = await readJsonWithRecovery(HISTORY_FILE, { fallback: { version: 1, guilds: {} }, backupLimit: 5 });
  const value = result?.value || result;
  if (value && typeof value === 'object') historyStore = { version: 1, guilds: value.guilds && typeof value.guilds === 'object' ? value.guilds : {} };
};

const saveHistory = async () => {
  await atomicWriteJson(HISTORY_FILE, historyStore, { backupLimit: 5 });
};

const historyForGuild = async (guildId) => {
  await ensureHistoryLoaded();
  return Array.isArray(historyStore.guilds[String(guildId)]) ? historyStore.guilds[String(guildId)] : [];
};

const persistHistoryRecord = async (guildId, record) => {
  await ensureHistoryLoaded();
  const id = String(guildId);
  const rows = Array.isArray(historyStore.guilds[id]) ? historyStore.guilds[id] : [];
  historyStore.guilds[id] = [record, ...rows.filter((entry) => String(entry?.id || '') !== String(record?.id || ''))].slice(0, 50);
  await saveHistory();
};

const hasManagePermission = (guild) => Boolean(
  guild?.members?.me?.permissions?.has?.(PermissionFlagsBits.ManageGuildExpressions)
  || guild?.members?.me?.permissions?.has?.(PermissionFlagsBits.ManageEmojisAndStickers)
);

const serializeEmoji = (emoji) => ({
  id: String(emoji?.id || ''),
  name: String(emoji?.name || ''),
  animated: emoji?.animated === true,
  managed: emoji?.managed === true,
  available: emoji?.available !== false,
  url: emoji?.imageURL?.({ extension: emoji?.animated ? 'gif' : 'png', size: 128 })
    || `https://cdn.discordapp.com/emojis/${emoji?.id}.${emoji?.animated ? 'gif' : 'png'}?size=128&quality=lossless`
});

const previewTokenFor = (preview) => crypto.createHash('sha256').update(JSON.stringify({
  guildId: preview.guildId,
  oldPrefix: preview.oldPrefix,
  newPrefix: preview.newPrefix,
  includeStatic: preview.includeStatic,
  includeAnimated: preview.includeAnimated,
  changes: preview.changes.map((row) => [row.id, row.currentName, row.targetName, row.animated])
})).digest('hex');

export const createEmojiRenamePreview = async ({ guild, conf, overrides = {} } = {}) => {
  if (!guild?.id) throw new Error('Server wurde nicht gefunden.');
  const settings = normalizeEmojiManagerConfig(conf, overrides);
  if (!settings.enabled) throw new Error('Die Emoji-Verwaltung ist deaktiviert.');
  if (!settings.oldPrefix) throw new Error('Das bisherige Präfix darf nicht leer sein.');
  if (!settings.newPrefix) throw new Error('Das neue Präfix darf nicht leer sein.');
  if (settings.oldPrefix === settings.newPrefix) throw new Error('Bisheriges und neues Präfix sind identisch.');
  if (!settings.includeStatic && !settings.includeAnimated) throw new Error('Wähle mindestens statische oder animierte Emojis aus.');

  const fetched = await guild.emojis.fetch();
  const all = [...fetched.values()].map(serializeEmoji).sort((left, right) => left.name.localeCompare(right.name, 'de'));
  const selected = all.filter((emoji) => emoji.name.startsWith(settings.oldPrefix)
    && (emoji.animated ? settings.includeAnimated : settings.includeStatic));
  const selectedIds = new Set(selected.map((emoji) => emoji.id));
  const occupiedByName = new Map();
  for (const emoji of all) {
    const key = emoji.name.toLocaleLowerCase('en-US');
    if (!occupiedByName.has(key)) occupiedByName.set(key, []);
    occupiedByName.get(key).push(emoji);
  }

  const targetOwners = new Map();
  const changes = selected.map((emoji) => {
    const targetName = settings.newPrefix + emoji.name.slice(settings.oldPrefix.length);
    const targetKey = targetName.toLocaleLowerCase('en-US');
    const row = {
      ...emoji,
      currentName: emoji.name,
      targetName,
      valid: true,
      blockingReasons: [],
      warnings: []
    };
    if (emoji.managed) row.blockingReasons.push('Dieses Emoji wird von einer Integration verwaltet.');
    if (!isValidEmojiName(targetName)) row.blockingReasons.push('Der Zielname verletzt Discord-Namensregeln (2–32 Zeichen, nur Buchstaben, Zahlen und Unterstriche).');
    const occupied = (occupiedByName.get(targetKey) || []).filter((candidate) => candidate.id !== emoji.id && !selectedIds.has(candidate.id));
    if (occupied.length) row.blockingReasons.push(`Der Zielname wird bereits von ${occupied.map((candidate) => candidate.name).join(', ')} verwendet.`);
    if (!targetOwners.has(targetKey)) targetOwners.set(targetKey, []);
    targetOwners.get(targetKey).push(row);
    return row;
  });

  for (const rows of targetOwners.values()) {
    if (rows.length < 2) continue;
    for (const row of rows) row.warnings.push('Mehrere bereits gleich benannte vl_-Emojis behalten denselben gemeinsamen Namen. Discord unterstützt diese vorhandene Doppelung.');
  }
  for (const row of changes) row.valid = row.blockingReasons.length === 0;

  const permission = hasManagePermission(guild);
  const preview = {
    guildId: String(guild.id),
    guildName: guild.name,
    generatedAt: new Date().toISOString(),
    oldPrefix: settings.oldPrefix,
    newPrefix: settings.newPrefix,
    includeStatic: settings.includeStatic,
    includeAnimated: settings.includeAnimated,
    canManageExpressions: permission,
    totalGuildEmojis: all.length,
    matchedCount: changes.length,
    staticCount: changes.filter((row) => !row.animated).length,
    animatedCount: changes.filter((row) => row.animated).length,
    blockedCount: changes.filter((row) => !row.valid).length,
    warningCount: changes.filter((row) => row.warnings.length > 0).length,
    changes,
    safeToApply: permission && changes.length > 0 && changes.every((row) => row.valid)
  };
  preview.previewToken = previewTokenFor(preview);
  lastPreviews.set(String(guild.id), preview);
  return preview;
};

export const applyEmojiRenamePlan = async ({ guild, conf, payload = {}, actorId = '' } = {}) => {
  if (!guild?.id) throw new Error('Server wurde nicht gefunden.');
  if (payload?.confirm !== true) throw new Error('Die Umbenennung benötigt eine ausdrückliche Bestätigung.');
  const suppliedToken = String(payload?.previewToken || '').trim();
  if (!suppliedToken) throw new Error('Die sichere Vorschau fehlt oder ist abgelaufen.');
  const guildId = String(guild.id);
  if (activeOperations.has(guildId)) throw new Error('Für diesen Server läuft bereits eine Emoji-Änderung.');

  const overrides = {
    oldPrefix: payload.oldPrefix,
    newPrefix: payload.newPrefix,
    includeStatic: payload.includeStatic,
    includeAnimated: payload.includeAnimated
  };
  const preview = await createEmojiRenamePreview({ guild, conf, overrides });
  if (preview.previewToken !== suppliedToken) throw new Error('Die Emoji-Liste hat sich seit der Vorschau geändert. Lade die Vorschau neu.');
  if (!preview.safeToApply) throw new Error(preview.blockedCount ? 'Die Vorschau enthält blockierte Zielnamen.' : 'Der Bot darf die Server-Emojis nicht verwalten.');

  const operation = runTrackedOperation('Emoji-Präfix umbenennen', {
    featureId: 'emojiManager',
    hook: 'confirmedRename',
    guildId
  }, async () => {
    const startedAt = new Date().toISOString();
    const record = {
      id: crypto.randomUUID(),
      guildId,
      actorId: String(actorId || ''),
      status: 'running',
      startedAt,
      completedAt: null,
      oldPrefix: preview.oldPrefix,
      newPrefix: preview.newPrefix,
      requested: preview.changes.length,
      renamed: 0,
      failed: 0,
      results: []
    };
    await persistHistoryRecord(guildId, record);
    for (const planned of preview.changes) {
      try {
        const emoji = await guild.emojis.fetch(planned.id);
        if (!emoji) throw new Error('Emoji wurde nicht mehr gefunden.');
        if (String(emoji.name || '') !== planned.currentName) throw new Error('Emoji-Name wurde seit der Vorschau geändert.');
        const updated = await emoji.edit({
          name: planned.targetName,
          reason: `FALLEN HEAVEN Emoji-Verwaltung · bestätigt von ${String(actorId || 'Dashboard')}`
        });
        record.results.push({ id: planned.id, oldName: planned.currentName, newName: String(updated?.name || planned.targetName), animated: planned.animated, ok: true });
      } catch (error) {
        record.results.push({ id: planned.id, oldName: planned.currentName, newName: planned.targetName, animated: planned.animated, ok: false, error: String(error?.message || error).slice(0, 300) });
      }
      record.renamed = record.results.filter((row) => row.ok).length;
      record.failed = record.results.filter((row) => !row.ok).length;
      if (record.results.length % 10 === 0 || record.results.at(-1)?.ok === false) await persistHistoryRecord(guildId, record);
      await delay(180);
    }
    record.status = record.failed > 0 ? 'completed-with-errors' : 'completed';
    record.completedAt = new Date().toISOString();
    await persistHistoryRecord(guildId, record);
    return record;
  }, { timeoutMs: 30 * 60_000 }).finally(() => activeOperations.delete(guildId));
  activeOperations.set(guildId, operation);
  return operation;
};

export const getEmojiManagerSnapshot = async (guildId) => {
  const id = String(guildId || '');
  const history = await historyForGuild(id);
  const preview = lastPreviews.get(id);
  return {
    running: activeOperations.has(id),
    lastPreview: preview ? {
      generatedAt: preview.generatedAt,
      oldPrefix: preview.oldPrefix,
      newPrefix: preview.newPrefix,
      matchedCount: preview.matchedCount,
      blockedCount: preview.blockedCount,
      safeToApply: preview.safeToApply
    } : null,
    history: history.slice(0, 20)
  };
};

export const feature = {
  id: 'emojiManager',
  name: 'Emoji-Verwaltung'
};

export const _emojiManagerInternals = {
  normalizeEmojiManagerConfig,
  isValidEmojiName,
  previewTokenFor,
  serializeEmoji
};
