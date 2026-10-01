import path from 'node:path';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { atomicWriteJson, readJsonWithRecovery } from '../runtime/atomicJsonStore.js';
import { applyManagedRolePolicy } from '../runtime/managedRoleService.js';
import { isAllowedEmbedImageUrl, resolveOutsideImageLite } from '../runtime/localImageStore.js';
import { preserveOutsideImage, savePersistentEmbedDesign, upsertDesignTemplate } from '../runtime/persistentEmbedService.js';
import { resolveEmbedImage } from '../runtime/embedAssetCache.js';
import { quietLog, QUIET_LOG_SCOPE } from '../runtime/quietLog.js';
import { resolveAvatarUrl } from '../runtime/utils.js';
import { DATA_DIR } from '../shared/paths.js';

const DATA_ROOT = DATA_DIR;
const LEVEL_FILE = path.join(DATA_ROOT, 'leveling-progress.json');
const PANEL_FILE = path.join(DATA_ROOT, 'leveling-panel.json');
const PANEL_PREFIX = 'fh-levels:';
const BALANCE_VERSION = 'progressive-v1';
const CURVE_SCALE = 60;
const DEFAULT_MAX_LEVEL = 110;
const DUPLICATE_WINDOW_MS = 10 * 60_000;
const RECENT_FINGERPRINT_LIMIT = 20;
const TICK_MS = 60_000; // Voice-XP wird einmal pro Minute abgerechnet.
const MINUTE_MS = 60_000;
const LEVEL_INFO_FILE = path.join(DATA_ROOT, 'leveling-info-panel.json');
const LEVEL_CLEANER_TICK_MS = 5 * 60_000; // Kanal-Aufräumer läuft alle 5 Minuten.
const LEVEL_PANEL_REPAIR_MS = 10 * 60_000; // Panel-Reparatur prüft alle 10 Minuten, ob das Embed noch existiert.

let store = null;
let loadPromise = null;
let saveTimer = null;
let saveQueue = Promise.resolve();
const levelRuntimes = new Map();

const emptyStore = () => ({ version: 3, guilds: {}, balanceMigrations: {} });
const normalizeProfile = (value = {}) => ({
  xp: Math.max(0, Math.floor(Number(value.xp || 0))),
  level: Math.max(0, Math.floor(Number(value.level || 0))),
  lastAt: Math.max(0, Number(value.lastAt || 0)),
  dailyKey: String(value.dailyKey || ''),
  dailyXp: Math.max(0, Math.floor(Number(value.dailyXp || 0))),
  lastFingerprint: String(value.lastFingerprint || ''),
  lastFingerprintAt: Math.max(0, Number(value.lastFingerprintAt || 0)),
  recentFingerprints: (Array.isArray(value.recentFingerprints) ? value.recentFingerprints : [])
    .map((entry) => ({ fingerprint: String(entry?.fingerprint || ''), at: Math.max(0, Number(entry?.at || 0)) }))
    .filter((entry) => entry.fingerprint && entry.at > 0)
    .sort((left, right) => left.at - right.at)
    .slice(-RECENT_FINGERPRINT_LIMIT),
  voiceXp: Math.max(0, Math.floor(Number(value.voiceXp || 0))),
  bonusKey: String(value.bonusKey || ''),
  bonusXp: Math.max(0, Math.floor(Number(value.bonusXp || 0))),
  bonusAwardedAt: String(value.bonusAwardedAt || ''),
  tagBonusKey: String(value.tagBonusKey || ''),
  tagBonusXp: Math.max(0, Math.floor(Number(value.tagBonusXp || 0))),
  tagBonusAwardedAt: String(value.tagBonusAwardedAt || ''),
  boostBonusKey: String(value.boostBonusKey || ''),
  boostBonusXp: Math.max(0, Math.floor(Number(value.boostBonusXp || 0))),
  boostBonusAwardedAt: String(value.boostBonusAwardedAt || ''),
  updatedAt: value.updatedAt || null
});
const normalizeStore = (value) => {
  if ((value?.version === 2 || value?.version === 3) && value.guilds) {
    const normalized = emptyStore();
    for (const [guildId, users] of Object.entries(value.guilds || {})) {
      normalized.guilds[guildId] = {};
      for (const [userId, profile] of Object.entries(users || {})) normalized.guilds[guildId][userId] = normalizeProfile(profile);
    }
    normalized.balanceMigrations = value?.balanceMigrations && typeof value.balanceMigrations === 'object'
      ? JSON.parse(JSON.stringify(value.balanceMigrations))
      : {};
    return normalized;
  }
  const migrated = emptyStore();
  for (const [guildId, users] of Object.entries(value || {})) {
    if (guildId === 'version' || guildId === 'guilds' || guildId === 'balanceMigrations' || !users || typeof users !== 'object') continue;
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
  saveQueue = saveQueue.catch((error) => {
    quietLog(QUIET_LOG_SCOPE.levels, error, `saveQueue FehlerLevel-Progress`);
  }).then(() => atomicWriteJson(LEVEL_FILE, snapshot, { backupLimit: 5 }));
  await saveQueue;
};
const scheduleSave = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flush().catch((error) => console.warn(`[levels] Fortschritt konnte nicht gespeichert werden: ${error?.message || error}`)), 2500);
  saveTimer.unref?.();
};

// Balance V1: frühe Level bleiben erreichbar, ab Level 20 steigt die Kurve
// zusätzlich an. Alle Aufrufer verwenden diese eine kanonische Berechnung.
const xpForLevel = (level) => {
  const l = Math.max(0, Math.floor(Number(level) || 0));
  return CURVE_SCALE * (l * (l + 4) + Math.max(0, l - 20) ** 2);
};
// Feingranulare Progress-Bar: nutzt Achtel-Blöcke (▏▎▍▌▋▊▉), damit auch kleine
// Fortschritte sichtbar sind – bei > 0 % ist die Bar NIE komplett leer.
const progressBar = (progress, segments = 12) => {
  const total = Math.max(1, Math.floor(Number(segments) || 12));
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  const full = Math.floor(p * total);
  const remainder = p * total - full;
  const partial = remainder > 0 ? ('▏▎▍▌▋▊▉'[Math.min(7, Math.floor(remainder * 8))] || '') : '';
  return '▰'.repeat(full) + partial + '▱'.repeat(Math.max(0, total - full - (partial ? 1 : 0)));
};
// Rang unter den aktuell auf dem Server anwesenden Mitgliedern (nach XP).
const rankOf = async (guild, userId, xp) => {
  const data = await ensureLoaded();
  const users = data.guilds?.[String(guild?.id || '')] || {};
  let better = 0;
  for (const [otherId, profile] of Object.entries(users)) {
    if (otherId === String(userId)) continue;
    if (!guild?.members?.cache?.has?.(otherId)) continue;
    if (Number(profile?.xp || 0) > Number(xp || 0)) better += 1;
  }
  return better + 1;
};
const configuredMaxLevel = (conf) => {
  const mappings = parseMappings(conf?.levelRoleMappings);
  return mappings.length ? mappings[mappings.length - 1].level : DEFAULT_MAX_LEVEL;
};
const levelFromXp = (xp, maxLevel = DEFAULT_MAX_LEVEL) => {
  const targetXp = Math.max(0, Math.floor(Number(xp) || 0));
  const max = Math.max(0, Math.floor(Number(maxLevel) || DEFAULT_MAX_LEVEL));
  let low = 0;
  let high = max;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (xpForLevel(middle) <= targetXp) low = middle;
    else high = middle - 1;
  }
  return low;
};
const dateKey = (timezone = 'Europe/Berlin') => {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  catch { return new Date().toISOString().slice(0, 10); }
};
const fingerprint = (content) => String(content || '')
  .toLocaleLowerCase('de-DE')
  .replace(/<@!?\d+>/g, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 180);
const parseMappings = (values) => (Array.isArray(values) ? values : [])
  .map((entry) => {
    if (entry && typeof entry === 'object') return { level: Number(entry.level || entry.count), roleId: String(entry.roleId || '') };
    const match = /^(\d+)\s*[=:|]\s*(\d+)$/.exec(String(entry || '').trim());
    return match ? { level: Number(match[1]), roleId: match[2] } : null;
  })
  .filter((entry) => entry && Number.isInteger(entry.level) && entry.level > 0 && entry.roleId)
  .sort((a, b) => a.level - b.level);

const levelsConf = (cfg) => cfg?.levels || {};
const levelForProfile = (profile, conf) => levelFromXp(profile?.xp, configuredMaxLevel(conf));
const levelProgressSnapshot = (profile, conf) => {
  const xp = Math.max(0, Math.floor(Number(profile?.xp || 0)));
  const maxLevel = configuredMaxLevel(conf);
  const level = levelFromXp(xp, maxLevel);
  const isMaxLevel = level >= maxLevel;
  const xpAtLevel = xpForLevel(level);
  const xpNext = xpForLevel(Math.min(maxLevel, level + 1));
  const rawSpan = Math.max(0, xpNext - xpAtLevel);
  const progress = isMaxLevel ? 1 : Math.min(1, Math.max(0, (xp - xpAtLevel) / Math.max(1, rawSpan)));
  return {
    xp,
    level,
    maxLevel,
    isMaxLevel,
    nextLevel: isMaxLevel ? 'MAX' : level + 1,
    xpAtLevel,
    xpNext,
    xpInLevel: isMaxLevel ? 0 : Math.max(0, xp - xpAtLevel),
    xpNeeded: isMaxLevel ? 0 : Math.max(0, xpNext - xp),
    levelSpan: isMaxLevel ? 0 : rawSpan,
    progress
  };
};
const migrateProfilesForBalance = (users, conf) => {
  const report = { profiles: 0, raised: 0, lowered: 0, unchanged: 0, xpRetained: 0 };
  for (const [userId, rawProfile] of Object.entries(users || {})) {
    const profile = normalizeProfile(rawProfile);
    const previousLevel = Math.max(0, Math.floor(Number(profile.level || 0)));
    const nextLevel = levelForProfile(profile, conf);
    profile.level = nextLevel;
    users[userId] = Object.assign(rawProfile && typeof rawProfile === 'object' ? rawProfile : {}, profile);
    report.profiles += 1;
    report.xpRetained += profile.xp;
    if (nextLevel > previousLevel) report.raised += 1;
    else if (nextLevel < previousLevel) report.lowered += 1;
    else report.unchanged += 1;
  }
  return report;
};

const roleConfigSignature = (conf) => JSON.stringify({
  maxLevel: configuredMaxLevel(conf),
  cumulative: conf?.cumulativeRoleRewards === true,
  mappings: parseMappings(conf?.levelRoleMappings).map((entry) => `${entry.level}=${entry.roleId}`),
  noXpRoleIds: [...new Set((conf?.noXpRoleIds || []).map(String))].sort(),
  excludedRoleIds: [...new Set((conf?.excludedRoleIds || []).map(String))].sort()
});
const timezoneOf = (cfg) => String(cfg?.general?.timezone || 'Europe/Berlin');
const ensureDailyWindow = (profile, timezone) => {
  const today = dateKey(timezone);
  if (profile.dailyKey !== today) { profile.dailyKey = today; profile.dailyXp = 0; }
  return today;
};
const ignoredChannel = (channel, conf) => {
  const ignored = new Set((conf?.ignoredChannelIds || []).map(String));
  return ignored.has(String(channel?.id || '')) || ignored.has(String(channel?.parentId || ''));
};
const memberHasNoXpRole = (member, conf) => {
  const excluded = new Set((conf?.excludedRoleIds || []).map(String));
  const noXp = new Set((conf?.noXpRoleIds || []).map(String));
  const roles = member?.roles?.cache;
  if (typeof roles?.some === 'function') {
    return roles.some((role) => excluded.has(String(role.id)) || noXp.has(String(role.id))) === true;
  }
  if (typeof roles?.values === 'function') {
    return [...roles.values()].some((role) => excluded.has(String(role?.id)) || noXp.has(String(role?.id)));
  }
  return false;
};

// NO-XP-Toggle über den Levelrollen-Panel-Button: Mitglieder ohne NO-XP-Rolle
// verlieren ihre aktuellen Level-Rollen und erhalten die NO-XP-Rolle (keine XP
// mehr). Klick nochmal → NO-XP-Rolle weg, Level-Rolle nach aktuellem Level zurück.
export const toggleNoXpRole = async ({ guild, member, conf }) => {
  const noXpIds = (conf?.noXpRoleIds || []).map(String).filter(Boolean);
  if (!noXpIds.length || !member) return { ok: false, reason: 'no-config' };
  // cache.has funktioniert für Discord-Collection UND einfache Maps (Tests).
  const active = noXpIds.some((roleId) => member?.roles?.cache?.has?.(String(roleId)) === true);
  const mappings = parseMappings(conf.levelRoleMappings);
  const managed = mappings.map((entry) => String(entry.roleId)).filter(Boolean);
  if (active) {
    // NO-XP deaktivieren: Rolle entfernen, Level-Rolle nach aktuellem Level wieder vergeben.
    await applyManagedRolePolicy({ member, addRoleIds: [], removeRoleIds: noXpIds, reason: 'NO-XP deaktiviert (Level-System)', verify: true, requireAll: false });
    const profile = await getLevelProfileSnapshot(guild?.id, member?.id);
    const level = levelForProfile(profile, conf);
    if (level > 0) await synchronizeLevelRoles(member, conf, level);
    return { ok: true, active: false };
  }
  // NO-XP aktivieren: Level-Rollen entnehmen, NO-XP-Rolle geben.
  await applyManagedRolePolicy({ member, addRoleIds: noXpIds.slice(0, 1), removeRoleIds: managed, reason: 'NO-XP aktiviert (Level-System)', verify: true, requireAll: false });
  return { ok: true, active: true };
};

const findEmbedTemplate = (cfg, id) => (Array.isArray(cfg?.embeds?.templates) ? cfg.embeds.templates : [])
  .find((template) => template.id === id && template.enabled !== false) || null;

const resolveLevelAvatar = (user, options = { size: 256 }) => {
  if (!user?.id) return '';
  const member = user.member || null;
  return resolveAvatarUrl(member || user, options);
};

const formatTemplate = (value, { guild, user, level, nextLevel = 0, rank = 0, xp = 0, xpInLevel = 0, xpNeeded = 0, levelSpan = 0, progressBar = '', progressPercent = 0, dailyXp = 0, voiceXp = 0, bonusXp = 0, role = '', newRole = '', roleText = '' }) => String(value || '')
  .replaceAll('{user}', user?.toString?.() || '').replaceAll('{username}', user?.username || '')
  .replaceAll('{userAvatar}', resolveLevelAvatar(user, { size: 256 }) || '').replaceAll('{guild}', guild?.name || 'Server')
  .replaceAll('{level}', String(level || 0)).replaceAll('{nextLevel}', String(nextLevel || 0))
  .replaceAll('{rank}', String(rank || 0)).replaceAll('{xp}', String(xp || 0))
  .replaceAll('{xpInLevel}', String(xpInLevel || 0)).replaceAll('{xpNeeded}', String(xpNeeded || 0)).replaceAll('{levelSpan}', String(levelSpan || 0))
  .replaceAll('{progressBar}', String(progressBar || '')).replaceAll('{progressPercent}', String(progressPercent || 0))
  .replaceAll('{dailyXp}', String(dailyXp || 0)).replaceAll('{voiceXp}', String(voiceXp || 0))
  .replaceAll('{bonusXp}', String(bonusXp || 0)).replaceAll('{memberCount}', String(guild?.memberCount || 0))
  .replaceAll('{role}', String(role || '')).replaceAll('{newRole}', String(newRole || ''))
  .replaceAll('{roleText}', String(roleText || ''));
const parseColor = (value) => {
  const parsed = Number.parseInt(String(value || '#27c4e8').replace('#', ''), 16);
  return Number.isFinite(parsed) ? parsed : 0x27c4e8;
};
const buildEmbedMessage = async (template, context) => {
  const data = template?.embed || {};
  const embed = new EmbedBuilder().setColor(parseColor(data.color));
  const title = formatTemplate(data.title, context).slice(0, 256);
  const description = formatTemplate(data.description, context).slice(0, 4096);
  if (title) embed.setTitle(title);
  if (description) embed.setDescription(description);
  // Thumbnail + Embed-Bild: erlaubte URLs (externe Hosts, Avatare) direkt
  // setzen, geblockte CDN-Anhang-URLs lokal laden und als attachment://-Anhang
  // anhängen. Platzhalter wie {userAvatar} ergeben erlaubte Avatar-URLs.
  const tUrl = formatTemplate(data.thumbnailUrl, context);
  const iUrl = formatTemplate(data.imageUrl, context);
  const thumbnail = await resolveEmbedImage(tUrl);
  const image = await resolveEmbedImage(iUrl);
  if (thumbnail.url) embed.setThumbnail(thumbnail.url);
  if (image.url) embed.setImage(image.url);
  // Author-Zeile (Name + Profilbild) – z. B. „{username}“ mit „{userAvatar}“ in
  // Level-Up-/Welcome-Embeds. Nur rendern, wenn ein Name gesetzt ist.
  const authorName = formatTemplate(data.authorName, context).slice(0, 256);
  const authorIcon = formatTemplate(data.authorIconUrl, context);
  if (authorName) {
    embed.setAuthor({
      name: authorName,
      ...(authorIcon && isAllowedEmbedImageUrl(authorIcon) ? { iconURL: authorIcon } : {})
    });
  }
  const footer = formatTemplate(data.footerText, context).slice(0, 2048);
  const footerIcon = formatTemplate(data.footerIconUrl, context);
  if (footer) embed.setFooter({
    text: footer,
    ...(footerIcon && isAllowedEmbedImageUrl(footerIcon) ? { iconURL: footerIcon } : {})
  });
  if (data.timestamp) embed.setTimestamp();
  const fields = (Array.isArray(data.fields) ? data.fields : []).slice(0, 25).map((field) => ({
    name: formatTemplate(field?.name, context).slice(0, 256) || '\u200b',
    value: formatTemplate(field?.value, context).slice(0, 1024) || '\u200b',
    inline: Boolean(field?.inline)
  }));
  if (fields.length) embed.addFields(fields);
  // Außenbild (Embed Studio) als normaler Anhang am Embed – nach dem
  // Aktivitäts-Liga-Muster: lokale Datei wird als Anhang hochgeladen, sonst
  // bleibt das Embed ohne Bild (kein CDN-Download, kein Link, kein Fehler).
  const outside = await resolveOutsideImageLite({
    savedAttachment: template?.outsideImageAttachment || null
  });
  const content = [
    formatTemplate(template?.content, context).slice(0, 2000)
  ].filter(Boolean).join('\n').slice(0, 2000);
  const assetFiles = [...(thumbnail.files || []), ...(image.files || [])];
  const files = [...(outside.files || []), ...assetFiles];
  const payload = { content: content || undefined, embeds: [embed], allowedMentions: { users: [context.user.id], roles: [] } };
  // attachments: [] ersetzt beim Edit alte Anhänge statt zu duplizieren.
  // Referenzierte Bestands-Anhänge (Außenbild per ID) bleiben erhalten.
  if (files.length) {
    payload.files = files;
    payload.attachments = outside.files ? [] : (outside.attachments || []);
  }
  if (outside.attachments && !files.length) payload.attachments = outside.attachments;
  return payload;
};

const synchronizeLevelRoles = async (member, conf, level) => {
  const mappings = parseMappings(conf.levelRoleMappings);
  if (!mappings.length || !member) return null;
  const eligible = memberHasNoXpRole(member, conf) ? [] : mappings.filter((entry) => entry.level <= level);
  const wanted = conf.cumulativeRoleRewards === true ? eligible.map((entry) => entry.roleId) : eligible.slice(-1).map((entry) => entry.roleId);
  const managed = mappings.map((entry) => entry.roleId);
  const remove = managed.filter((roleId) => member.roles.cache.has(roleId) && !wanted.includes(roleId));
  const result = await applyManagedRolePolicy({ member, addRoleIds: wanted, removeRoleIds: remove, reason: `Level-Rollenabgleich · Level ${level}`, verify: true, requireAll: false });
  const added = Array.isArray(result?.addedRoleIds) ? result.addedRoleIds : [];
  return added.slice(-1)[0] || null;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.floor(ms))));

const isRateLimitError = (error) => {
  const status = Number(error?.status || error?.httpStatus || 0);
  const message = String(error?.message || error || '').toLowerCase();
  return status === 429 || error?.rateLimited === true || /rate\s*limit|too many requests|retry.?after/i.test(message);
};

// Wipe: entfernt ALLE verwalteten Level-Rollen von ALLEN Mitgliedern des Servers
// (damit die Level-Rollen wieder „leer“ sind). Zählt nur wirklich entfernte
// Rollen, wartet Discord-Rate-Limits ab (Retry/Backoff) und meldet blockierte
// oder fehlgeschlagene Entfernungen ehrlich statt still zu schlucken.
export const wipeLevelRoles = async (guild, cfg) => {
  const conf = levelsConf(cfg);
  const mappings = parseMappings(conf.levelRoleMappings);
  const managed = mappings.map((entry) => String(entry.roleId)).filter(Boolean);
  if (!managed.length) return { ok: false, reason: 'no-mappings', removed: 0, members: 0 };
  const members = await guild?.members?.fetch?.().catch((error) => {
    quietLog(QUIET_LOG_SCOPE.levels, error, `members.fetch fehlgeschlagen`);
    return null;
  });
  if (!members) return { ok: false, reason: 'fetch-failed', removed: 0, members: 0 };
  const targets = [...members.values()].filter((member) => !member.user?.bot && managed.some((id) => member.roles.cache.has(id)));
  const blocked = new Map();
  const errors = [];
  let removed = 0;
  let cursor = 0;
  let rateLimitedUntil = 0;
  const workers = Array.from({ length: 3 }, async () => {
    while (cursor < targets.length) {
      const index = cursor;
      cursor += 1;
      const member = targets[index];
      const toRemove = managed.filter((id) => member.roles.cache.has(id));
      if (!toRemove.length) continue;
      const wait = rateLimitedUntil - Date.now();
      if (wait > 0) await sleep(wait);
      let attempt = 0;
      while (true) {
        try {
          const result = await applyManagedRolePolicy({
            member,
            addRoleIds: [],
            removeRoleIds: toRemove,
            reason: 'Level-Rollen-Wipe',
            verify: false,
            requireAll: false,
            skipFresh: true
          });
          removed += Array.isArray(result?.removedRoleIds) ? result.removedRoleIds.length : 0;
          (Array.isArray(result?.blocked) ? result.blocked : []).forEach((entry) => {
            if (entry?.roleId && !blocked.has(String(entry.roleId))) {
              blocked.set(String(entry.roleId), String(entry.reason || 'Rolle konnte nicht entfernt werden.'));
            }
          });
          break;
        } catch (error) {
          if (isRateLimitError(error) && attempt < 6) {
            const retryAfter = Math.max(1, Math.ceil(Number(error?.retryAfter || 1)));
            rateLimitedUntil = Date.now() + retryAfter * 1000 + 500;
            attempt += 1;
            await sleep(retryAfter * 1000 + 500);
            continue;
          }
          const message = String(error?.message || error || 'Rolle konnte nicht entfernt werden.').slice(0, 300);
          errors.push(message);
          toRemove.forEach((roleId) => {
            if (!blocked.has(String(roleId))) blocked.set(String(roleId), message);
          });
          break;
        }
      }
      // Sanftes Pacing gegen Discords Rollen-Rate-Limit.
      await sleep(200);
    }
  });
  await Promise.all(workers);
  const blockedEntries = [...blocked.entries()].map(([roleId, reason]) => ({ roleId, reason }));
  const result = {
    ok: true,
    removed,
    members: targets.length,
    blockedCount: blockedEntries.length,
    blocked: blockedEntries.slice(0, 25),
    failedCount: errors.length,
    errors: errors.slice(0, 10),
    hadErrors: Boolean(errors.length || blockedEntries.length)
  };
  // Ehrlich bleiben: Wenn nichts entfernt werden konnte, ist das kein Erfolg.
  if (targets.length && removed === 0 && (errors.length || blockedEntries.length)) {
    result.ok = false;
    result.reason = 'nothing-removed';
  }
  return result;
};

// Vergibt ALLEN Mitgliedern ihre aktuell passenden Level-Rollen (Massen-Sync).
// Liest jedes Profil aus der Level-Datei, berechnet das Level über die Kurve
// und gleicht die Rollen ab: fehlende werden vergeben, falsche verwaltete
// Rollen entfernt. Zählt nur bestätigte Änderungen, wartet Rate-Limits ab
// (Retry/Backoff) und meldet blockierte Rollen ehrlich – wie der Wipe.
export const grantLevelRolesToAll = async (guild, cfg) => {
  const conf = levelsConf(cfg);
  const mappings = parseMappings(conf.levelRoleMappings);
  const managed = mappings.map((entry) => String(entry.roleId)).filter(Boolean);
  if (!managed.length) return { ok: false, reason: 'no-mappings', added: 0, removed: 0, members: 0 };
  const members = await guild?.members?.fetch?.().catch((error) => {
    quietLog(QUIET_LOG_SCOPE.levels, error, `members.fetch fehlgeschlagen`);
    return null;
  });
  if (!members) return { ok: false, reason: 'fetch-failed', added: 0, removed: 0, members: 0 };
  const data = await ensureLoaded();
  const users = data.guilds?.[String(guild.id || '')] || {};
  let levelsCorrected = 0;
  const targets = [...members.values()]
    .filter((member) => !member.user?.bot)
    .map((member) => {
      const storedProfile = users[String(member.id)] || null;
      const profile = normalizeProfile(storedProfile || {});
      const level = levelForProfile(profile, conf);
      if (storedProfile && Number(storedProfile.level || 0) !== level) {
        storedProfile.level = level;
        storedProfile.updatedAt = new Date().toISOString();
        levelsCorrected += 1;
      }
      const eligible = memberHasNoXpRole(member, conf) ? [] : mappings.filter((entry) => entry.level <= level);
      const wanted = conf.cumulativeRoleRewards === true
        ? eligible.map((entry) => entry.roleId)
        : eligible.slice(-1).map((entry) => entry.roleId);
      const hasManaged = managed.some((id) => member.roles.cache.has(id));
      const remove = managed.filter((id) => member.roles.cache.has(id) && !wanted.includes(id));
      const missing = wanted.filter((id) => !member.roles.cache.has(id));
      return { member, level, wanted, remove, missing, hasManaged };
    })
    .filter((entry) => entry.level > 0 || entry.hasManaged || entry.missing.length || entry.remove.length);
  const blocked = new Map();
  const errors = [];
  let added = 0;
  let removed = 0;
  let processed = 0;
  let cursor = 0;
  let rateLimitedUntil = 0;
  const workers = Array.from({ length: 3 }, async () => {
    while (cursor < targets.length) {
      const index = cursor;
      cursor += 1;
      const entry = targets[index];
      if (!entry.wanted.length && !entry.remove.length) continue;
      const wait = rateLimitedUntil - Date.now();
      if (wait > 0) await sleep(wait);
      let attempt = 0;
      while (true) {
        try {
          const result = await applyManagedRolePolicy({
            member: entry.member,
            addRoleIds: entry.wanted,
            removeRoleIds: entry.remove,
            reason: `Level-Rollen-Synchronisierung · Level ${entry.level}`,
            verify: false,
            requireAll: false,
            skipFresh: true
          });
          added += Array.isArray(result?.addedRoleIds) ? result.addedRoleIds.length : 0;
          removed += Array.isArray(result?.removedRoleIds) ? result.removedRoleIds.length : 0;
          (Array.isArray(result?.blocked) ? result.blocked : []).forEach((block) => {
            if (block?.roleId && !blocked.has(String(block.roleId))) {
              blocked.set(String(block.roleId), String(block.reason || 'Rolle konnte nicht vergeben werden.'));
            }
          });
          processed += 1;
          break;
        } catch (error) {
          if (isRateLimitError(error) && attempt < 6) {
            const retryAfter = Math.max(1, Math.ceil(Number(error?.retryAfter || 1)));
            rateLimitedUntil = Date.now() + retryAfter * 1000 + 500;
            attempt += 1;
            await sleep(retryAfter * 1000 + 500);
            continue;
          }
          const message = String(error?.message || error || 'Rolle konnte nicht vergeben werden.').slice(0, 300);
          errors.push(message);
          entry.wanted.forEach((roleId) => {
            if (!blocked.has(String(roleId))) blocked.set(String(roleId), message);
          });
          break;
        }
      }
      // Sanftes Pacing gegen Discords Rollen-Rate-Limit.
      await sleep(200);
    }
  });
  await Promise.all(workers);
  const blockedEntries = [...blocked.entries()].map(([roleId, reason]) => ({ roleId, reason }));
  const result = {
    ok: true,
    added,
    removed,
    members: targets.length,
    processed,
    blockedCount: blockedEntries.length,
    blocked: blockedEntries.slice(0, 25),
    failedCount: errors.length,
    errors: errors.slice(0, 10),
    hadErrors: Boolean(errors.length || blockedEntries.length)
  };
  // Ehrlich bleiben: Wenn gar nichts vergeben werden konnte, ist das kein Erfolg.
  if (targets.length && added === 0 && removed === 0 && (errors.length || blockedEntries.length)) {
    result.ok = false;
    result.reason = 'nothing-granted';
  }
  result.levelsCorrected = levelsCorrected;
  if (levelsCorrected > 0) scheduleSave();
  return result;
};

const ensureBalanceMigration = async (guild, cfg, { forceRoleSync = false } = {}) => {
  const guildId = String(guild?.id || '');
  if (!guildId) return { ok: false, reason: 'no-guild', profileReport: null, roleSync: null };
  const conf = levelsConf(cfg);
  const data = await ensureLoaded();
  data.guilds[guildId] ||= {};
  data.balanceMigrations ||= {};
  const previous = data.balanceMigrations[guildId] && typeof data.balanceMigrations[guildId] === 'object'
    ? data.balanceMigrations[guildId]
    : {};
  const maxLevel = configuredMaxLevel(conf);
  const signature = roleConfigSignature(conf);
  const profileReport = migrateProfilesForBalance(data.guilds[guildId], conf);
  const profileChanged = profileReport.raised > 0 || profileReport.lowered > 0;
  const versionChanged = previous.balanceVersion !== BALANCE_VERSION || Number(previous.maxLevel || 0) !== maxLevel;
  const needsRoleSync = forceRoleSync
    || profileChanged
    || versionChanged
    || previous.roleConfigSignature !== signature
    || !previous.rolesSynchronizedAt;

  data.balanceMigrations[guildId] = {
    ...previous,
    balanceVersion: BALANCE_VERSION,
    maxLevel,
    migratedAt: versionChanged || !previous.migratedAt ? new Date().toISOString() : previous.migratedAt,
    lastCheckedAt: new Date().toISOString(),
    profileReport,
    roleConfigSignature: signature,
    rolesSynchronizedAt: needsRoleSync ? null : previous.rolesSynchronizedAt
  };

  // Der erste atomare Schreibvorgang erzeugt über atomicWriteJson eine
  // Sicherung des bisherigen Stores, bevor Discord-Rollen verändert werden.
  await flush();

  let roleSync = { ok: true, skipped: true, reason: 'already-synchronized', hadErrors: false };
  if (needsRoleSync) {
    if (parseMappings(conf?.levelRoleMappings).length) {
      roleSync = await grantLevelRolesToAll(guild, cfg);
    } else {
      roleSync = { ok: true, skipped: true, reason: 'no-mappings', hadErrors: false, added: 0, removed: 0, members: 0 };
    }
    const successful = roleSync?.ok === true && roleSync?.hadErrors !== true;
    data.balanceMigrations[guildId].rolesSynchronizedAt = successful ? new Date().toISOString() : null;
    data.balanceMigrations[guildId].lastRoleSync = {
      ok: successful,
      added: Math.max(0, Number(roleSync?.added || 0)),
      removed: Math.max(0, Number(roleSync?.removed || 0)),
      blockedCount: Math.max(0, Number(roleSync?.blockedCount || 0)),
      failedCount: Math.max(0, Number(roleSync?.failedCount || 0)),
      reason: String(roleSync?.reason || '')
    };
    await flush();
  }

  return { ok: true, profileReport, roleSync, migration: { ...data.balanceMigrations[guildId] } };
};

// Manuelles Level-Setzen: XP exakt auf die Kurve des Ziel-Levels stellen und
// die passenden Level-Rollen synchronisieren (Fortschritt bleibt dauerhaft).
export const setMemberLevel = async ({ guild, member, cfg, level }) => {
  if (!guild || !member) return { ok: false, reason: 'no-member' };
  const conf = levelsConf(cfg);
  const target = Math.min(configuredMaxLevel(conf), Math.max(0, Math.floor(Number(level) || 0)));
  const xp = xpForLevel(target);
  const data = await ensureLoaded();
  data.guilds[String(guild.id)] ||= {};
  const profile = data.guilds[String(guild.id)][String(member.id)] ||= normalizeProfile();
  profile.xp = xp;
  profile.level = target;
  profile.updatedAt = new Date().toISOString();
  await flush();
  const newRoleId = target > 0 ? await synchronizeLevelRoles(member, conf, target).catch((error) => {
    quietLog(QUIET_LOG_SCOPE.levels, error, `synchronizeLevelRoles fehlgeschlagen: ${member.user?.tag}`);
    return null;
  }) : null;
  if (target <= 0) {
    const mappings = parseMappings(conf.levelRoleMappings);
    await applyManagedRolePolicy({ member, addRoleIds: [], removeRoleIds: mappings.map((entry) => entry.roleId), reason: 'Level auf 0 gesetzt', verify: true, requireAll: false }).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.levels, error, `applyManagedRolePolicy (Level 0) fehlgeschlagen: ${member.user?.tag}`);
    });
  }
  return { ok: true, level: target, xp, roleId: newRoleId };
};

const shouldAward = (message, cfg, profile, now) => {
  const conf = cfg?.levels || {};
  if (!conf.enabled || !message?.guild || message.author?.bot || message?.webhookId || message?.system === true || !message.member) {
    return { ok: false, reason: 'disabled' };
  }
  if (ignoredChannel(message.channel, conf)) return { ok: false, reason: 'channel' };
  if (memberHasNoXpRole(message.member, conf)) return { ok: false, reason: 'no-xp' };
  const contentFingerprint = fingerprint(message.content);
  const meaningfulLength = contentFingerprint.replace(/[^\p{L}\p{N}]/gu, '').length;
  const hasMedia = Number(message?.attachments?.size || 0) > 0 || Number(message?.stickers?.size || 0) > 0;
  if (!hasMedia && meaningfulLength < Math.max(1, Number(conf.minMessageLength || 2))) return { ok: false, reason: 'short' };
  const recent = (Array.isArray(profile?.recentFingerprints) ? profile.recentFingerprints : [])
    .filter((entry) => now - Number(entry?.at || 0) < DUPLICATE_WINDOW_MS);
  const duplicate = contentFingerprint && (
    recent.some((entry) => entry.fingerprint === contentFingerprint)
    || (contentFingerprint === profile?.lastFingerprint && now - Number(profile?.lastFingerprintAt || 0) < DUPLICATE_WINDOW_MS)
  );
  if (duplicate) return { ok: false, reason: 'duplicate' };
  return { ok: true, fingerprint: contentFingerprint || `media:${String(message?.id || now)}` };
};

const recordAwardedFingerprint = (profile, contentFingerprint, now) => {
  if (!profile || !contentFingerprint) return;
  const at = Math.max(0, Number(now || Date.now()));
  const recent = (Array.isArray(profile.recentFingerprints) ? profile.recentFingerprints : [])
    .filter((entry) => entry?.fingerprint && at - Number(entry.at || 0) < DUPLICATE_WINDOW_MS);
  recent.push({ fingerprint: String(contentFingerprint), at });
  profile.recentFingerprints = recent.slice(-RECENT_FINGERPRINT_LIMIT);
  profile.lastFingerprint = String(contentFingerprint);
  profile.lastFingerprintAt = at;
};

// Zentrale XP-Vergabe für legitime Chat- und Voice-Aktivität. Legacy-Bonus-
// Quellen werden ausdrücklich abgewiesen; Aktivität selbst ist nie gedeckelt.
const awardXp = async ({ guild, member, cfg, conf, amount, source = 'message', silent = false, fallbackChannel = null }) => {
  const guildId = guild?.id || member?.guild?.id;
  const userId = member?.id;
  const value = Math.max(0, Math.floor(Number(amount) || 0));
  if (!guildId || !userId || value <= 0) return { amount: 0, profile: null, leveledUp: false };
  const data = await ensureLoaded();
  data.guilds[guildId] ||= {};
  const profile = data.guilds[guildId][userId] ||= normalizeProfile();
  const timezone = timezoneOf(cfg);
  ensureDailyWindow(profile, timezone);
  const now = Date.now();
  if (['bonus', 'tag-bonus', 'boost-bonus'].includes(String(source))) {
    return { amount: 0, profile, leveledUp: false };
  }
  const awarded = value;
  profile.xp += awarded;
  profile.dailyXp += awarded;
  if (source === 'voice') profile.voiceXp = Math.max(0, Math.floor(Number(profile.voiceXp || 0))) + awarded;
  profile.updatedAt = new Date(now).toISOString();
  const previousLevel = Math.max(0, Math.floor(Number(profile.level || 0)));
  const nextLevel = levelForProfile(profile, conf);
  let leveledUp = false;
  if (nextLevel !== previousLevel) {
    const jumped = nextLevel - previousLevel;
    profile.level = nextLevel;
    leveledUp = jumped > 0;
    let newRoleId = null;
    if (member) {
      newRoleId = await synchronizeLevelRoles(member, conf, nextLevel).catch((error) => {
        console.warn(`[levels] Rollenabgleich für ${member.id} fehlgeschlagen: ${error?.message || error}`);
        return null;
      });
    }
    if (leveledUp && conf?.announce !== false && !silent && jumped <= 1) {
      await announceLevelUp({ guild, member, cfg, conf, level: nextLevel, newRoleId, fallbackChannel });
    }
  }
  scheduleSave();
  return { amount: awarded, profile, leveledUp };
};

// Abwechslungsreiche Rollen-Freischalt-Texte – pro Levelaufstieg wird zufällig
// einer gewählt. Bewusst OHNE {user}: Die Hauptzeile des Embeds erwähnt den
// User bereits genau einmal, und der Ping kommt über den Content (außerhalb
// des Embeds) – so gibt es keine doppelte Markierung im Embed.
const ROLE_UNLOCK_TEXTS = [
  '🎉 {role} freigeschaltet – herzlichen Glückwunsch! ✨\n\n',
  '✨ Neue Rolle: {role}! Dein Aufstieg geht weiter!\n\n',
  '👏 {role} erreicht – starke Leistung auf Level {level}!\n\n',
  '⚡ Level {level} geschafft – {role} gehört ab jetzt dazu!\n\n',
  '🕊️ Aufgestiegen zu {role} – ein neues Kapitel beginnt!\n\n',
  '💜 {role} freigeschaltet! Der Weg nach oben geht weiter.\n\n'
];
const pickRoleUnlockText = ({ guild, user, level, role }) => {
  if (!role?.id) return '';
  const template = ROLE_UNLOCK_TEXTS[Math.floor(Math.random() * ROLE_UNLOCK_TEXTS.length)] || '';
  return formatTemplate(template, { guild, user, level, role: `<@&${role.id}>` });
};

const announceLevelUp = async ({ guild, member, cfg, conf, level, newRoleId = null, fallbackChannel = null }) => {
  if (!guild || !member) return;
  const channel = conf?.announceChannelId
    ? (guild.channels.cache.get(conf.announceChannelId) || null)
    : (fallbackChannel?.isTextBased?.() ? fallbackChannel : null);
  if (!channel?.isTextBased?.()) return;
  const user = member.user || member;
  const profile = await getLevelProfileSnapshot(guild?.id, member?.id).catch((error) => {
    quietLog(QUIET_LOG_SCOPE.levels, error, `getLevelProfileSnapshot fehlgeschlagen: ${member?.id}`);
    return null;
  });
  const progression = levelProgressSnapshot(profile, conf);
  const xp = progression.xp;
  const rank = profile ? await rankOf(guild, member?.id, xp).catch(() => 0) : 0;
  const role = newRoleId ? (guild?.roles?.cache?.get?.(String(newRoleId)) || null) : null;
  const context = {
    guild, user, level,
    nextLevel: progression.nextLevel,
    rank,
    xp,
    xpInLevel: progression.xpInLevel,
    xpNeeded: progression.xpNeeded,
    levelSpan: progression.levelSpan,
    progressBar: progressBar(progression.progress),
    progressPercent: Math.floor(progression.progress * 100),
    dailyXp: Math.max(0, Math.floor(Number(profile?.dailyXp || 0))),
    newRole: role ? `<@&${role.id}>` : '',
    roleText: role ? pickRoleUnlockText({ guild, user, level, role }) : ''
  };
  const template = findEmbedTemplate(cfg, 'level-up');
  if (template) {
    const payload = await buildEmbedMessage(template, context);
    // Ping-Garantie: Discord benachrichtigt NUR bei Erwähnungen im Content
    // (außerhalb des Embeds) – der User wird dort also immer erwähnt, auch
    // wenn das Template keinen eigenen Content-Text hat.
    const mention = `<@${member.id}>`;
    const content = String(payload.content || '');
    if (!content.includes(mention) && !content.includes(`<@!${member.id}>`)) {
      payload.content = [mention, content].filter(Boolean).join('\n');
    }
    payload.allowedMentions = { users: [member.id], roles: [] };
    await channel.send(payload).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.levels, error, `channel.send (Level-Up) fehlgeschlagen: Kanal ${channel.id}`);
    });
  } else {
    const announcement = formatTemplate(conf?.levelUpMessage || '{user} erreicht Level {level}!', context);
    await channel.send({ content: announcement, allowedMentions: { users: [member.id], roles: [] } }).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.levels, error, `channel.send (Announcement) fehlgeschlagen: Kanal ${channel.id}`);
    });
  }
};

/* --------------------------------------------------------------------------
   Sprachchat-XP
   -------------------------------------------------------------------------- */
const ensureLevelRuntime = (guild, cfg) => {
  const id = String(guild?.id || '');
  let runtime = levelRuntimes.get(id);
  if (!runtime) {
    runtime = {
      guild,
      voiceStates: new Map(),
      voiceQueue: Promise.resolve(),
      voiceTimer: null,
      panelTimer: null,
    };
    levelRuntimes.set(id, runtime);
  }
  runtime.guild = guild;
  runtime.cfg = cfg;
  return runtime;
};
const hydrateVoiceStates = (runtime) => {
  const previous = runtime.voiceStates;
  const hydrated = new Map();
  const now = Date.now();
  for (const state of runtime.guild.voiceStates.cache.values()) {
    if (state?.member?.user?.bot) continue;
    const existing = previous.get(String(state.id));
    hydrated.set(String(state.id), {
      channelId: String(state.channelId || ''),
      lastSettledAt: now,
      voiceXpRemainder: Math.max(0, Number(existing?.voiceXpRemainder || 0)),
      selfDeaf: state.selfDeaf === true,
      serverDeaf: state.serverDeaf === true
    });
  }
  runtime.voiceStates = hydrated;
};
const voiceEligible = (runtime, userId, state, conf) => {
  const member = runtime.guild.members.cache.get(String(userId));
  const channel = runtime.guild.channels.cache.get(String(state?.channelId || ''));
  if (!member || member.user?.bot || !channel) return false;
  if (String(runtime.guild.afkChannelId || '') === String(channel.id)) return false;
  if (ignoredChannel(channel, conf)) return false;
  if (memberHasNoXpRole(member, conf)) return false;
  if (conf?.excludeDeafenedVoice !== false && (state.selfDeaf || state.serverDeaf)) return false;
  return true;
};

const settleVoiceAccrual = (state, { now = Date.now(), eligible = false, xpPerMinute = 1 } = {}) => {
  const current = Math.max(0, Number(now || Date.now()));
  const previous = Math.max(0, Number(state?.lastSettledAt || current));
  const settledAt = Math.max(previous, current);
  const elapsed = Math.max(0, settledAt - previous);
  if (state) state.lastSettledAt = settledAt;
  const perMinute = Math.max(0, Number(xpPerMinute || 0));
  if (!state || !eligible || elapsed <= 0 || perMinute <= 0) return 0;
  const accrued = Math.max(0, Number(state.voiceXpRemainder || 0)) + (perMinute * elapsed) / MINUTE_MS;
  const wholeXp = Math.max(0, Math.floor(accrued + Number.EPSILON));
  state.voiceXpRemainder = Math.max(0, accrued - wholeXp);
  return wholeXp;
};

const voiceTick = async (runtime, cfg, now = Date.now()) => {
  const conf = levelsConf(cfg);
  const perMinute = Math.max(0, Math.floor(Number(conf?.voiceXpPerMinute) || 0));
  if (!conf?.enabled || perMinute <= 0) return 0;
  const byChannel = new Map();
  for (const [userId, state] of runtime.voiceStates.entries()) {
    if (!voiceEligible(runtime, userId, state, conf)) continue;
    if (!byChannel.has(state.channelId)) byChannel.set(state.channelId, []);
    byChannel.get(state.channelId).push(userId);
  }
  const minimum = Math.max(1, Math.floor(Number(conf?.voiceMinimumParticipants) || 2));
  const qualified = new Set();
  for (const userIds of byChannel.values()) {
    if (userIds.length < minimum) continue;
    userIds.forEach((userId) => qualified.add(String(userId)));
  }
  let awardedTotal = 0;
  for (const [userId, state] of runtime.voiceStates.entries()) {
    const pendingXp = settleVoiceAccrual(state, {
      now,
      eligible: qualified.has(String(userId)),
      xpPerMinute: perMinute
    });
    if (pendingXp <= 0) continue;
    const member = runtime.guild.members.cache.get(String(userId));
    if (!member) continue;
    const { amount } = await awardXp({
      guild: runtime.guild,
      member,
      cfg,
      conf,
      amount: pendingXp,
      source: 'voice',
      silent: false
    });
    awardedTotal += amount;
  }
  return awardedTotal;
};

const queueVoiceTick = (runtime, cfg, now = Date.now()) => {
  const operation = runtime.voiceQueue.catch(() => {}).then(() => voiceTick(runtime, cfg, now));
  runtime.voiceQueue = operation.catch(() => {});
  return operation;
};

/* --------------------------------------------------------------------------
   Levelrollen-Panel (automatisches „💯 Leveln“-Embed)
   -------------------------------------------------------------------------- */
let panelQueue = Promise.resolve();
const loadPanelStore = async () => {
  const result = await readJsonWithRecovery(PANEL_FILE, { fallback: { version: 1, guilds: {} }, backupLimit: 3 })
    .catch(() => ({ value: { version: 1, guilds: {} } }));
  const value = result?.value && typeof result.value === 'object' ? result.value : { version: 1, guilds: {} };
  value.version = 1;
  value.guilds ||= {};
  return value;
};
const mutatePanelStore = (worker) => {
  const operation = panelQueue.catch(() => {}).then(async () => {
    const panelStore = await loadPanelStore();
    const result = await worker(panelStore);
    await atomicWriteJson(PANEL_FILE, panelStore, { backupLimit: 3 }).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.levels, error, `atomicWriteJson (Panel) fehlgeschlagen`);
    });
    return result;
  });
  panelQueue = operation.catch(() => {});
  return operation;
};

export const buildLevelRoleLines = (guild, conf) => {
  const lines = [];
  for (const roleId of (conf?.noXpRoleIds || [])) {
    const role = guild?.roles?.cache?.get?.(String(roleId));
    lines.push(`| <@&${role?.id || roleId}> | Nur auf Anfrage`);
  }
  for (const mapping of parseMappings(conf?.levelRoleMappings)) {
    const role = guild?.roles?.cache?.get?.(String(mapping.roleId));
    lines.push(`| <@&${role?.id || mapping.roleId}> | Ab Level ${mapping.level}`);
  }
  return lines;
};

const buildLevelCard = async ({ guild, member, cfg, conf }) => {
  const profile = await getLevelProfileSnapshot(guild?.id, member?.id);
  const progression = levelProgressSnapshot(profile, conf);
  const { level, isMaxLevel } = progression;
  const rank = await rankOf(guild, member?.id, profile.xp);
  const context = {
    guild,
    user: member?.user || member,
    level: isMaxLevel ? `${level} · MAX` : level,
    numericLevel: level,
    nextLevel: progression.nextLevel,
    rank,
    xp: profile.xp,
    xpInLevel: progression.xpInLevel,
    xpNeeded: progression.xpNeeded,
    progressBar: progressBar(progression.progress),
    progressPercent: Math.floor(progression.progress * 100),
    dailyXp: profile.dailyXp,
    voiceXp: profile.voiceXp,
    bonusXp: profile.bonusXp,
    levelSpan: progression.levelSpan,
    isMaxLevel
  };
  const template = findEmbedTemplate(cfg, 'level-card');
  if (template) {
    const payload = await buildEmbedMessage(template, context);
    payload.allowedMentions = { parse: [] };
    return payload.embeds[0];
  }
  // Fallback: eingebaute Fallen-Heaven-Standard-Karte.
  const levelLabel = isMaxLevel ? `${level} · MAX` : String(level);
  const progressText = isMaxLevel
    ? `${context.progressBar} **MAX-LEVEL**`
    : `${context.progressBar} **${context.progressPercent} %** bis Level ${level + 1}`;
  return new EmbedBuilder()
    .setColor(0xf1b84b)
    .setAuthor({ name: `${member?.user?.username || 'Mitglied'} · Level ${levelLabel}`, iconURL: member?.user ? resolveLevelAvatar(member.user, { size: 128 }) || undefined : undefined })
    .setTitle(`Level ${levelLabel}`)
    .setDescription(
      `${progressText}\n\n`
      + `**XP gesamt:** ${profile.xp.toLocaleString('de-DE')} · **Rang:** #${rank} auf dem Server`
    )
    .addFields(
      { name: isMaxLevel ? 'Status' : 'Im Level', value: isMaxLevel ? 'Letzte Level-Rolle erreicht' : `${context.xpInLevel.toLocaleString('de-DE')} / ${context.levelSpan.toLocaleString('de-DE')} XP`, inline: true },
      { name: 'Heute (Chat + Voice)', value: `${profile.dailyXp} XP`, inline: true },
      { name: 'Lifetime-XP', value: `${profile.xp.toLocaleString('de-DE')} XP`, inline: true }
    )
    .setFooter({ text: 'FALLEN HEAVEN · Leveling' })
    .setTimestamp();
};

const handleLevelCommand = async ({ interaction, cfg }) => {
  const conf = levelsConf(cfg);
  if (conf?.enabled !== true) {
    await interaction.reply({ content: 'Das Leveling-Modul ist gerade deaktiviert.', flags: MessageFlags.Ephemeral }).catch(() => null);
    return true;
  }
  const commandChannelId = String(conf?.commandChannelId || '').trim() || String(conf?.announceChannelId || '').trim();
  if (commandChannelId && String(interaction.channelId) !== commandChannelId) {
    const channel = interaction.guild?.channels?.cache?.get?.(commandChannelId);
    await interaction.reply({
      content: channel
        ? `Nutze \`/level\` bitte im Level-Kanal ${channel}.`
        : 'Der Level-Befehl ist auf einen bestimmten Kanal beschränkt.',
      flags: MessageFlags.Ephemeral
    }).catch(() => null);
    return true;
  }
  const targetUser = interaction.options.getUser?.('user') || interaction.user;
  let member = targetUser.id === interaction.user.id ? interaction.member : null;
  if (!member) {
    member = await interaction.guild.members.fetch(targetUser.id).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.levels, error, `members.fetch (Profil) fehlgeschlagen: ${targetUser.id}`);
      return null;
    });
  }
  if (!member || member.user?.bot) {
    await interaction.reply({ content: 'Zu diesem Mitglied gibt es kein Level.', flags: MessageFlags.Ephemeral }).catch(() => null);
    return true;
  }
  const embed = await buildLevelCard({ guild: interaction.guild, member, cfg, conf });
  await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
  return true;
};

const LEVEL_ROLE_SLOT_COUNT = 20;
const levelRoleBlockTemplate = () => Array.from({ length: LEVEL_ROLE_SLOT_COUNT }, (_, index) => `{levelRoleBlock${index + 1}}`).join('\n');
const migrateLevelRoleTemplate = (value) => String(value ?? '').replaceAll('{levelRoles}', levelRoleBlockTemplate());

const buildLevelRoleEntries = (guild, conf) => {
  const entries = [];
  for (const roleId of (conf?.noXpRoleIds || [])) {
    const role = guild?.roles?.cache?.get?.(String(roleId));
    entries.push({ roleId: String(role?.id || roleId), roleName: String(role?.name || roleId), level: 'Nur auf Anfrage' });
  }
  for (const mapping of parseMappings(conf?.levelRoleMappings)) {
    const role = guild?.roles?.cache?.get?.(String(mapping.roleId));
    entries.push({ roleId: String(role?.id || mapping.roleId), roleName: String(role?.name || mapping.roleId), level: `Ab Level ${mapping.level}` });
  }
  return entries;
};
const buildLevelRoleContext = (guild, conf) => {
  const entries = buildLevelRoleEntries(guild, conf);
  const context = { levelRoles: entries.map((entry) => `| <@&${entry.roleId}> | ${entry.level}`).join('\n') };
  for (let index = 1; index <= LEVEL_ROLE_SLOT_COUNT; index += 1) {
    const entry = entries[index - 1];
    context[`levelRole${index}`] = entry ? `<@&${entry.roleId}>` : '';
    context[`levelRoleName${index}`] = entry?.roleName || '';
    context[`levelRoleLevel${index}`] = entry?.level || '';
    context[`levelRoleBlock${index}`] = entry ? `| <@&${entry.roleId}> | ${entry.level}` : '';
  }
  return context;
};
const formatLevelPanelText = (value, context, max = 4096) => {
  let result = String(value || '');
  for (const [key, replacement] of Object.entries(context || {})) {
    const token = `{${key}}`;
    if (typeof replacement === 'string' && result.includes(token)) result = result.split(token).join(replacement);
  }
  return result.slice(0, max);
};

const defaultLevelsPanelDesign = () => ({
  content: '',
  outsideImageUrl: '',
  outsideImageAttachment: null,
  embed: {
    title: '💯 Leveln',
    url: '',
    description: `Diese Rollen kannst du durch Aktivität im Chat und in den Sprachkanälen freischalten. Je höher dein Level, desto höher dein Rang.\n\n${levelRoleBlockTemplate()}`,
    color: '#8b82ff',
    authorName: '',
    authorIconUrl: '',
    thumbnailUrl: '',
    imageUrl: '',
    footerText: 'FALLEN HEAVEN wünscht dir einen schönen Aufenthalt.',
    footerIconUrl: '',
    timestamp: true,
    fields: []
  }
});
const safePanelText = (value, fallback = '', max = 4096) => String(value ?? fallback).slice(0, max);
const normalizeLevelsPanelDesign = (value = {}) => {
  const fallback = defaultLevelsPanelDesign();
  const embed = value?.embed && typeof value.embed === 'object' ? value.embed : {};
  return {
    content: safePanelText(value?.content, fallback.content, 2000),
    outsideImageUrl: /^https?:\/\//i.test(String(value?.outsideImageUrl || '')) ? String(value.outsideImageUrl) : '',
    // Migration: Anker-Anhänge (privater „fh-assets“-Kanal) sind abgeschafft.
    // Die CDN-URL bleibt als einfache Bild-URL erhalten – das Bild wird weiter
    // über die Content-Zeile eingebettet, ohne dass je ein Kanal angelegt wird.
    outsideImageAttachment: value?.outsideImageAttachment && typeof value.outsideImageAttachment === 'object'
      && value.outsideImageAttachment.anchored !== true
      ? {
        id: String(value.outsideImageAttachment.id || ''),
        url: String(value.outsideImageAttachment.url || ''),
        name: String(value.outsideImageAttachment.name || 'fallen-heaven-levels.png'),
        size: Math.max(0, Number(value.outsideImageAttachment.size || 0))
      }
      : null,
    embed: {
      title: safePanelText(embed.title, fallback.embed.title, 256),
      url: /^https?:\/\//i.test(String(embed.url || '')) ? String(embed.url) : '',
      description: safePanelText(migrateLevelRoleTemplate(embed.description ?? fallback.embed.description), fallback.embed.description, 4096),
      color: String(embed.color || fallback.embed.color).slice(0, 16),
      authorName: safePanelText(embed.authorName, fallback.embed.authorName, 256),
      authorIconUrl: /^https?:\/\//i.test(String(embed.authorIconUrl || '')) ? String(embed.authorIconUrl) : '',
      thumbnailUrl: /^https?:\/\//i.test(String(embed.thumbnailUrl || '')) ? String(embed.thumbnailUrl) : '',
      imageUrl: /^https?:\/\//i.test(String(embed.imageUrl || '')) ? String(embed.imageUrl) : '',
      footerText: safePanelText(embed.footerText, fallback.embed.footerText, 2048),
      footerIconUrl: /^https?:\/\//i.test(String(embed.footerIconUrl || '')) ? String(embed.footerIconUrl) : '',
      timestamp: embed.timestamp !== false,
      fields: (Array.isArray(embed.fields) ? embed.fields : []).slice(0, 21).map((field) => ({
        name: safePanelText(field?.name, '', 256),
        value: safePanelText(migrateLevelRoleTemplate(field?.value), '', 1024),
        inline: field?.inline === true
      })).filter((field) => field.name || field.value)
    }
  };
};

const buildLevelRolesEmbed = (guild, conf) => {
  const design = normalizeLevelsPanelDesign(conf?.panelDesign);
  const roleContext = buildLevelRoleContext(guild, conf);
  const embed = new EmbedBuilder().setColor(parseColor(design.embed.color || '#8b82ff'));
  const title = formatLevelPanelText(design.embed.title || '💯 Leveln', roleContext, 256).trim();
  if (title) embed.setTitle(title);
  // Einzelne Rollen-Platzhalter ({levelRole1}, {levelRoleName1},
  // {levelRoleLevel1}, {levelRoleBlock1} …) werden unabhängig ersetzt.
  const description = formatLevelPanelText(design.embed.description, roleContext, 4096).trim();
  if (description) embed.setDescription(description);
  if (design.embed.url) embed.setURL(formatLevelPanelText(design.embed.url, roleContext, 2000));
  if (design.embed.authorName) embed.setAuthor({
    name: formatLevelPanelText(design.embed.authorName, roleContext, 256),
    iconURL: design.embed.authorIconUrl || undefined
  });
  if (design.embed.thumbnailUrl && isAllowedEmbedImageUrl(String(design.embed.thumbnailUrl))) embed.setThumbnail(String(design.embed.thumbnailUrl));
  if (design.embed.imageUrl && isAllowedEmbedImageUrl(String(design.embed.imageUrl))) embed.setImage(String(design.embed.imageUrl));
  if (design.embed.footerText) embed.setFooter({
    text: formatLevelPanelText(design.embed.footerText, roleContext, 2048),
    iconURL: design.embed.footerIconUrl || undefined
  });
  if (design.embed.timestamp) embed.setTimestamp();
  const fields = (Array.isArray(design.embed.fields) ? design.embed.fields : []).slice(0, 21)
    .map((field) => ({
      name: formatLevelPanelText(String(field?.name || '\u200b'), roleContext, 256),
      value: formatLevelPanelText(String(field?.value || '\u200b'), roleContext, 1024),
      inline: Boolean(field?.inline)
    }))
    .filter((field) => field.name !== '\u200b' || field.value !== '\u200b');
  if (fields.length) embed.addFields(fields);
  return embed;
};
// Unter der Rollen-Ansicht stehen REGELN + (falls konfiguriert) der NO-XP-Toggle.
// Die Regeln-Ansicht ist privat und braucht keinen Button.
const buildLevelsPanelNavigation = (conf = {}) => {
  const safe = (value, fallback) => String(value ?? fallback).slice(0, 80) || fallback;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PANEL_PREFIX}rules`)
      .setLabel(safe(conf?.rulesButtonLabel, 'REGELN'))
      .setEmoji('📜')
      .setStyle(ButtonStyle.Primary)
  );
  if ((conf?.noXpRoleIds || []).length) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${PANEL_PREFIX}no-xp`)
        .setLabel(safe(conf?.noXpButtonLabel, 'NO-XP (an/aus)'))
        .setEmoji('🚫')
        .setStyle(ButtonStyle.Danger)
    );
  }
  return row;
};
const buildLevelsRolesPayload = async (guild, cfg, conf, options = {}) => {
  const design = normalizeLevelsPanelDesign(conf?.panelDesign);
  const savedAttachment = design.outsideImageAttachment;
  // Außenbild nach dem Aktivitäts-Liga-Muster: Bestätigter Anhang wird beim
  // Bearbeiten per ID referenziert (attachments) – kein CDN-Download, kein
  // Re-Upload, kein Fehler. Neue Bilder aus dem Studio kommen als outsideFile
  // und werden als echter Anhang (files) gesendet.
  const outside = await resolveOutsideImageLite({
    outsideFile: options.outsideFile || null,
    outsideImageName: String(options.outsideImageName || 'fallen-heaven-levels.png'),
    defaultImageName: 'fallen-heaven-levels.png',
    savedAttachment: savedAttachment && savedAttachment.anchored !== true ? savedAttachment : null,
    preserveAttachment: options.allowAttachmentReference === true,
    removeOutsideImage: options.removeOutsideImage === true
  });
  const content = [
    String(design.content || '').slice(0, 2000)
  ].filter(Boolean).join('\n').slice(0, 2000);
  const embed = buildLevelRolesEmbed(guild, conf);
  // Thumbnail + Embed-Bild: geblockte CDN-Anhang-URLs (z. B. cdn.discordapp.com)
  // werden lokal geladen und als echter Anhang (attachment://) angehängt – so
  // funktionieren auch Discord-Bild-URLs und laufen nie ab. Erlaubte URLs und
  // fehlgeschlagene Downloads lassen das Embed unverändert.
  const thumbnail = await resolveEmbedImage(design.embed.thumbnailUrl);
  const image = await resolveEmbedImage(design.embed.imageUrl);
  if (thumbnail.url) embed.setThumbnail(thumbnail.url);
  if (image.url) embed.setImage(image.url);
  const payload = {
    content: content || undefined,
    embeds: [embed],
    components: [buildLevelsPanelNavigation(conf)],
    // Rollen-Mentions (<@&id>) im Rollen-Embed rendern lassen – @everyone/@here bleiben blockiert.
    allowedMentions: { parse: ['roles'] }
  };
  const assetFiles = [...(thumbnail.files || []), ...(image.files || [])];
  const files = [...(outside.files || []), ...assetFiles];
  if (files.length) {
    // attachments: [] ersetzt beim Edit alte Anhänge statt zu duplizieren.
    // Referenzierte Bestands-Anhänge (Außenbild per ID) bleiben erhalten.
    payload.files = files;
    payload.attachments = outside.files ? [] : (outside.attachments || []);
  } else if (outside.attachments) {
    payload.attachments = outside.attachments;
  } else if (options.removeOutsideImage === true) {
    payload.attachments = [];
  }
  return payload;
};
// Editierbare Textbausteine der Level-Regeln-Ansicht (REGELN-Button am
// Levelrollen-Panel). Alle Werte sind Vorlagen mit Platzhaltern – feste
// Bausteine (Feldnamen, Erklärungen) kann der Server anpassen, die Zahlen
// bleiben dynamisch. Referenz: 3.9.222-Muster (DEFAULT_*_TEXTS + normalize).
const DEFAULT_LEVEL_RULES_TEXTS = () => ({
  rulesTitle: 'Regeln und Wertung',
  rulesDescription: 'Diese private Übersicht erklärt, wie XP und Level-Rollen funktionieren.',
  rulesFooter: 'Diese Ansicht ist nur für dich sichtbar.',
  rulesChatFieldName: 'CHAT',
  rulesVoiceFieldName: 'SPRACHCHAT',
  rulesActivityFieldName: 'AKTIVITÄTS-BONUS',
  rulesBonusFieldName: 'ROLLEN- & BOOSTER-BONUS',
  rulesCurveFieldName: 'LEVEL-KURVE',
  rulesNoXpFieldName: 'NO-XP-ROLLE',
  rulesExcludedFieldName: 'AUSGESCHLOSSEN',
  rulesActivityDisabledText: 'Deaktiviert.',
  rulesChatFieldText: '• Jede gültige Nachricht gibt fest **{xpPerMessage} XP**\n'
    + '• Kein Cooldown, kein Tageslimit und keine Abschwächung\n'
    + '• Mindestens **{minLength} Buchstaben oder Zahlen**; Anhänge und Sticker zählen ebenfalls\n'
    + '• Identische Nachrichten zählen innerhalb von **10 Minuten** nur einmal\n'
    + '• Bots, Webhooks sowie ausgeschlossene Kanäle und Rollen zählen nicht',
  rulesVoiceFieldText: '• **{voiceXp} XP pro gültiger Minute** im Sprachkanal\n'
    + '• Mindestens **{voiceMin} Personen** gemeinsam im Kanal\n'
    + '• Kein Tageslimit und keine Abschwächung\n'
    + '• AFK-Kanal zählt nicht\n'
    + '• Vollständig taube Zeit zählt {deafened}; normales Stummschalten ist erlaubt',
  rulesActivityFieldText: 'Aktivitäts-Liga, Server-Tag und Booster vergeben keine Level-XP.',
  rulesBonusFieldText: 'Keine passiven Level-XP.',
  rulesCurveFieldText: '• Level 1: **300 XP** · Level 10: **8.400 XP** · Level 20: **28.800 XP**\n'
    + '• Level 50: **216.000 XP** · Level 110: **1.238.400 XP**\n'
    + '• Die höchste konfigurierte Level-Rolle ist das Max-Level.',
  // 3.9.229: KEINE Paket-Platzhalter mehr – ausgeschriebener Text mit einzelnen
  // Platzhaltern. {noXpRoleNames} = Namen der No-XP-Rollen, {excludedChannels}/
  // {excludedRoles} = Namen der ausgeschlossenen Kanäle/Rollen.
  rulesNoXpFieldText: '• **{noXpRoleNames}** – Mitglieder mit diesen Rollen erhalten weder im Chat noch im Sprachchat XP.',
  rulesExcludedFieldText: '• Ausgeschlossene Kanäle: **{excludedChannels}**\n• Ausgeschlossene Rollen: **{excludedRoles}**'
});
const levelRulesTexts = (conf) => {
  const defaults = DEFAULT_LEVEL_RULES_TEXTS();
  const raw = conf || {};
  // Backfill: Alte Configs, die noch die Paket-Platzhalter {noXpLines}/
  // {excludedLines} gespeichert haben, werden auf die ausgeschriebenen Defaults
  // umgestellt, damit sie im Modul editierbar sind.
  const backfilled = Object.fromEntries(Object.keys(defaults).map((key) => [key, safePanelText(raw?.[key], defaults[key], 4096)]));
  if (String(raw.rulesNoXpFieldText ?? '').includes('{noXpLines}')) backfilled.rulesNoXpFieldText = defaults.rulesNoXpFieldText;
  if (String(raw.rulesExcludedFieldText ?? '').includes('{excludedLines}')) backfilled.rulesExcludedFieldText = defaults.rulesExcludedFieldText;
  if (/zufällig gewählt|höchstens eine Wertung alle/i.test(String(raw.rulesChatFieldText ?? ''))) backfilled.rulesChatFieldText = defaults.rulesChatFieldText;
  if (/bewusst weniger als Chat/i.test(String(raw.rulesVoiceFieldText ?? ''))) backfilled.rulesVoiceFieldText = defaults.rulesVoiceFieldText;
  if (/Level 1 ≈ \*\*100 XP|Level 110 ≈ \*\*251\.000 XP/i.test(String(raw.rulesCurveFieldText ?? ''))) backfilled.rulesCurveFieldText = defaults.rulesCurveFieldText;
  return backfilled;
};
const formatLevelRulesText = (value, context) => String(value || '')
  .replaceAll('{rulesTitle}', context.rulesTitle ?? '')
  .replaceAll('{rulesDescription}', context.rulesDescription ?? '')
  .replaceAll('{rulesFooter}', context.rulesFooter ?? '')
  .replaceAll('{rulesChatFieldName}', context.rulesChatFieldName ?? '')
  .replaceAll('{rulesVoiceFieldName}', context.rulesVoiceFieldName ?? '')
  .replaceAll('{rulesActivityFieldName}', context.rulesActivityFieldName ?? '')
  .replaceAll('{rulesBonusFieldName}', context.rulesBonusFieldName ?? '')
  .replaceAll('{rulesCurveFieldName}', context.rulesCurveFieldName ?? '')
  .replaceAll('{rulesNoXpFieldName}', context.rulesNoXpFieldName ?? '')
  .replaceAll('{rulesExcludedFieldName}', context.rulesExcludedFieldName ?? '')
  .replaceAll('{rulesChatFieldText}', context.rulesChatFieldText ?? '')
  .replaceAll('{rulesVoiceFieldText}', context.rulesVoiceFieldText ?? '')
  .replaceAll('{rulesActivityFieldText}', context.rulesActivityFieldText ?? '')
  .replaceAll('{rulesBonusFieldText}', context.rulesBonusFieldText ?? '')
  .replaceAll('{rulesCurveFieldText}', context.rulesCurveFieldText ?? '')
  .replaceAll('{rulesNoXpFieldText}', context.rulesNoXpFieldText ?? '')
  .replaceAll('{rulesExcludedFieldText}', context.rulesExcludedFieldText ?? '')
  .replaceAll('{xpMin}', context.xpMin)
  .replaceAll('{xpMax}', context.xpMax)
  .replaceAll('{xpPerMessage}', context.xpPerMessage)
  .replaceAll('{minLength}', context.minLength)
  .replaceAll('{cooldown}', context.cooldown)
  .replaceAll('{dailyLimitLine}', context.dailyLimitLine)
  .replaceAll('{voiceXp}', context.voiceXp)
  .replaceAll('{voiceMin}', context.voiceMin)
  .replaceAll('{deafened}', context.deafened)
  .replaceAll('{bonus1}', context.bonus1)
  .replaceAll('{bonus2}', context.bonus2)
  .replaceAll('{bonus3}', context.bonus3)
  .replaceAll('{bonusMax}', context.bonusMax)
  .replaceAll('{tagBonusLine}', context.tagBonusLine)
  .replaceAll('{boostBonusLine}', context.boostBonusLine)
  .replaceAll('{curveBase}', context.curveBase)
  .replaceAll('{noXpRoleNames}', context.noXpRoleNames ?? '')
  .replaceAll('{excludedChannels}', context.excludedChannels ?? '')
  .replaceAll('{excludedRoles}', context.excludedRoles ?? '')
  // Legacy-Paket-Platzhalter für bereits gespeicherte Configs weiterhin auflösen.
  .replaceAll('{noXpLines}', context.noXpLines ?? '')
  .replaceAll('{excludedLines}', context.excludedLines ?? '')
  .replaceAll('{server}', context.server);
const buildLevelsRulesPayload = (guild, conf) => {
  const ignoredChannels = (conf?.ignoredChannelIds || [])
    .map((id) => guild?.channels?.cache?.get?.(String(id))?.name).filter(Boolean);
  const excludedRoles = (conf?.excludedRoleIds || [])
    .map((id) => guild?.roles?.cache?.get?.(String(id))?.name).filter(Boolean);
  const noXpRoles = (conf?.noXpRoleIds || [])
    .map((id) => guild?.roles?.cache?.get?.(String(id))?.name).filter(Boolean);
  const texts = levelRulesTexts(conf);
  const context = {
    xpPerMessage: String(conf?.xpPerMessage || 5),
    xpMin: String(conf?.xpPerMessage || 5),
    xpMax: String(conf?.xpPerMessage || 5),
    minLength: String(conf?.minMessageLength || 2),
    cooldown: '0',
    dailyLimitLine: '• **Kein Aktivitätslimit** – jede gültige Nachricht bringt XP',
    voiceXp: String(conf?.voiceXpPerMinute || 1),
    voiceMin: String(conf?.voiceMinimumParticipants || 2),
    deafened: conf?.excludeDeafenedVoice !== false ? '**nicht**' : '**mit**',
    bonus1: String(conf?.activityBonusPlace1 || 100),
    bonus2: String(conf?.activityBonusPlace2 || 70),
    bonus3: String(conf?.activityBonusPlace3 || 40),
    bonusMax: String(conf?.activityBonusMaxPerDay || 150),
    tagBonusLine: conf?.tagBonusXpPerDay > 0
      ? `• **Server-Tag**: **${conf.tagBonusXpPerDay} XP** pro Tag für Tag-Träger\n`
      : '',
    boostBonusLine: conf?.boostBonusEnabled === false || !conf?.boostBonusXpPerBoost
      ? ''
      : `• **Booster**: **${conf.boostBonusXpPerBoost} XP** pro aktivem Boost pro Tag (max. **${conf?.boostBonusMaxPerDay || 40} XP**)\n`,
    curveBase: String(CURVE_SCALE),
    server: guild?.name || '',
    noXpRoleNames: noXpRoles.join(', ') || '–',
    excludedChannels: ignoredChannels.join(', ') || '–',
    excludedRoles: excludedRoles.join(', ') || '–',
    // Legacy: weiterhin für alte gespeicherte Configs mit Paket-Platzhaltern.
    noXpLines: noXpRoles.map((name) => `• **${name}** – wer diese Rolle nimmt, erhält weder im Chat noch im Sprachchat XP.`).join('\n'),
    excludedLines: [
      ignoredChannels.length ? `Kanäle: ${ignoredChannels.join(', ')}` : '',
      excludedRoles.length ? `Rollen: ${excludedRoles.join(', ')}` : ''
    ].filter(Boolean).join('\n')
  };
  const format = (value) => formatLevelRulesText(value, context);
  const design = normalizeLevelsPanelDesign(conf?.panelDesign);
  const embed = new EmbedBuilder()
    .setColor(parseColor(design.embed.color || '#8b82ff'))
    .setAuthor({ name: 'FALLEN HEAVEN · LEVELING', iconURL: guild.iconURL?.({ size: 128 }) || undefined })
    .setTitle(format(texts.rulesTitle))
    .setDescription(format(texts.rulesDescription))
    .addFields(
      { name: format(texts.rulesChatFieldName), value: format(texts.rulesChatFieldText), inline: false },
      { name: format(texts.rulesVoiceFieldName), value: format(texts.rulesVoiceFieldText), inline: false },
      { name: format(texts.rulesCurveFieldName), value: format(texts.rulesCurveFieldText), inline: false },
      ...(noXpRoles.length ? [{
        name: format(texts.rulesNoXpFieldName),
        value: format(texts.rulesNoXpFieldText),
        inline: false
      }] : []),
      ...(ignoredChannels.length || excludedRoles.length ? [{
        name: format(texts.rulesExcludedFieldName),
        value: format(texts.rulesExcludedFieldText),
        inline: false
      }] : [])
    )
    .setFooter({ text: format(texts.rulesFooter) });
  // Private Regeln-Ansicht: bewusst ohne Button.
  return { embeds: [embed], components: [], allowedMentions: { parse: [] } };
};

const syncLevelRolesPanel = async (runtime, cfg, options = {}) => {
  const conf = levelsConf(cfg);
  // Ein gewählter Kanal reicht zum Senden des Panels – das Modul muss dafür
  // nicht extra aktiviert sein (wie beim Bot-Updates-Panel: „Kanal gewählt →
  // Panel wird gesendet“). XP-Vergabe bleibt trotzdem an „Modul aktiv“ gebunden.
  if (!conf?.levelRolesPanelChannelId) return null;
  const guild = runtime.guild;
  const channel = guild.channels.cache.get(conf.levelRolesPanelChannelId)
    || await guild.channels.fetch(conf.levelRolesPanelChannelId).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.levels, error, `channels.fetch (LevelRolesPanel) fehlgeschlagen: ${conf.levelRolesPanelChannelId}`);
      return null;
    });
  if (!channel?.isTextBased?.() || channel.isThread?.()) return null;
  const record = await mutatePanelStore((panelStore) => {
    const entry = panelStore.guilds[guild.id] ||= { channelId: '', messageId: '' };
    return entry;
  });
  // Kanal gewechselt → alte Nachricht im alten Kanal entfernen (best effort).
  if (record.channelId && record.channelId !== String(channel.id)) {
    const previousChannel = guild.channels.cache.get(record.channelId);
    if (previousChannel?.isTextBased?.() && record.messageId) {
      await previousChannel.messages.fetch(record.messageId).then((message) => message.delete()).catch((error) => {
        quietLog(QUIET_LOG_SCOPE.levels, error, `Previous-Panel löschen fehlgeschlagen: ${record.messageId}`);
      });
    }
  }
  let message = record.messageId && record.channelId === String(channel.id)
    ? await channel.messages.fetch(record.messageId).catch((error) => {
        quietLog(QUIET_LOG_SCOPE.levels, error, `messages.fetch (Existing Panel) fehlgeschlagen: ${record.messageId}`);
        return null;
      })
    : null;
  // Repair-Modus (periodischer Timer/Bot-Start): Nachricht existiert noch →
  // nichts tun. Kein Edit, kein Payload-Bau, kein REST-Call – das Panel wird
  // nur neu gesendet, wenn es fehlt. Echte Updates laufen über Studio-Save.
  if (options.repair === true && message?.editable) return message;
  // Payload erst NACH dem Nachrichten-Fetch bauen – nur beim Bearbeiten darf
  // der gespeicherte Anhang referenziert werden (sonst Discord-400 bei Neu-Send).
  const savedAttachmentId = String(conf?.panelDesign?.outsideImageAttachment?.id || '');
  const canReferenceAttachment = Boolean(message?.editable && savedAttachmentId
    && typeof message.attachments?.some === 'function'
    && message.attachments.some((attachment) => String(attachment.id) === savedAttachmentId));
  const payload = await buildLevelsRolesPayload(guild, cfg, conf, { ...options, allowAttachmentReference: canReferenceAttachment });
  if (message?.editable) await message.edit(payload);
  else message = await channel.send(payload);
  await mutatePanelStore((panelStore) => {
    const entry = panelStore.guilds[guild.id] ||= { channelId: '', messageId: '' };
    entry.channelId = String(channel.id);
    entry.messageId = String(message.id);
  });
  return message;
};

const serializePanelOutsideImage = (message) => {
  const attachment = message?.attachments?.first?.();
  if (!attachment) return null;
  return {
    id: String(attachment.id || ''),
    url: String(attachment.url || ''),
    name: String(attachment.name || 'fallen-heaven-levels.png'),
    size: Number(attachment.size || 0)
  };
};

// Die Außenbild-Preservation lebt im gemeinsamen Helfer (persistentEmbedService) –
// identisches Verhalten für Levelrollen-Panel, Kanal-Info-Embed und Bot-Updates.
// Diese dünne Weiterleitung bleibt für Tests und Aufrufer.
const resolveLevelsPanelImagePreservation = (options = {}) => preserveOutsideImage(options);

// Speichert ein Studio-Design für das Levelrollen-Panel und aktualisiert das
// Live-Panel sofort – über den gemeinsamen „Speichern & Kanal aktualisieren“-Helfer.
// Die Rollen-Zeilen bleiben automatisch (Platzhalter {levelRoles}) – nur Layout,
// Texte, Farben, Bilder und Felder kommen aus dem Studio.
export const saveLevelsPanelDesign = async ({ guild, cfg = {}, template = {} } = {}) => {
  const conf = levelsConf(cfg);
  const channelId = String(template?.channelId || conf?.levelRolesPanelChannelId || '').trim();
  const result = await savePersistentEmbedDesign({
    guild,
    cfg,
    template,
    options: {
      designId: 'levels-panel',
      designName: 'Levelrollen-Panel',
      defaultColor: '#8b82ff',
      maxFields: 21,
      previousDesign: conf?.panelDesign,
      channelId,
      moduleActive: true, // „Kanal gewählt → Panel wird gesendet“ (auch bei Modul aus)
      autoEnable: false,
      defaultImageName: 'fallen-heaven-levels.png',
      buildDesign: ({ embed, preserved, content }) => normalizeLevelsPanelDesign({
        content,
        outsideImageUrl: preserved.outsideImageUrl,
        outsideImageAttachment: preserved.outsideImageAttachment,
        embed
      }),
      prepareSyncCfg: ({ cfg: c, design }) => ({
        ...c,
        levels: { ...levelsConf(c), levelRolesPanelChannelId: channelId, panelDesign: design }
      }),
      sync: async ({ guild: g, cfg: c, options: o }) => {
        const runtime = ensureLevelRuntime(g, c);
        const message = await syncLevelRolesPanel(runtime, c, o);
        if (!message) throw new Error('Das Levelrollen-Panel konnte nicht gesendet werden.');
        return { action: 'posted', messageId: String(message.id || ''), message };
      },
      serializeAttachment: serializePanelOutsideImage
    }
  });
  return {
    panelDesign: result.design,
    channelId,
    panel: result.status?.message || null,
    status: result.status
  };
};

const upsertEmbedTemplate = (templates, design) => upsertDesignTemplate(templates, design);

// Speichert ein Studio-Design für das Level-Up-Kanal-Info-Embed und aktualisiert
// die dauerhafte Nachricht im Level-Up-Kanal sofort – über den gemeinsamen Helfer.
// Ein gewählter Kanal aktiviert das Info-Embed dabei automatisch.
export const saveLevelUpInfoDesign = async ({ guild, cfg = {}, template = {} } = {}) => {
  const conf = levelsConf(cfg);
  const channelId = String(template?.channelId || conf?.levelUpInfoChannelId || conf?.announceChannelId || '').trim();
  return savePersistentEmbedDesign({
    guild,
    cfg,
    template,
    options: {
      designId: 'level-up-info',
      designName: 'Level Up Info',
      defaultColor: '#8b82ff',
      maxFields: 21,
      previousDesign: findLevelUpInfoTemplate(cfg),
      channelId,
      moduleActive: conf?.levelUpInfoEnabled === true,
      autoEnable: true, // Kanal gewählt → Info-Embed automatisch aktivieren
      defaultImageName: 'fallen-heaven-level-info.png',
      prepareSyncCfg: ({ cfg: c, design }) => ({
        ...c,
        levels: { ...levelsConf(c), levelUpInfoEnabled: true, ...(channelId ? { levelUpInfoChannelId: channelId } : {}) },
        embeds: { ...(c.embeds || {}), templates: upsertEmbedTemplate(c.embeds?.templates, design) }
      }),
      sync: async ({ guild: g, cfg: c, options: o }) => ensureLevelUpInfoEmbed({ guild: g, cfg: c, options: o }),
      serializeAttachment: serializePanelOutsideImage
    }
  });
};

/* --------------------------------------------------------------------------
   Runtime-Lebenszyklus
   -------------------------------------------------------------------------- */
const stopLevelRuntime = (runtime) => {
  if (runtime.voiceTimer) { clearInterval(runtime.voiceTimer); runtime.voiceTimer = null; }
  if (runtime.infoTimer) { clearInterval(runtime.infoTimer); runtime.infoTimer = null; }
  if (runtime.panelTimer) { clearInterval(runtime.panelTimer); runtime.panelTimer = null; }
  runtime.voiceStates.clear();
};
/* --------------------------------------------------------------------------
   Level-Up-Kanal: persistentes Info-Embed + Aufräumer
   -------------------------------------------------------------------------- */
let levelInfoQueue = Promise.resolve();
const loadLevelInfoStore = async () => {
  const result = await readJsonWithRecovery(LEVEL_INFO_FILE, { fallback: { version: 1, guilds: {} }, backupLimit: 3 })
    .catch(() => ({ value: { version: 1, guilds: {} } }));
  const value = result?.value && typeof result.value === 'object' ? result.value : { version: 1, guilds: {} };
  value.version = 1;
  value.guilds ||= {};
  return value;
};
const withLevelInfoQueue = (worker) => {
  const operation = levelInfoQueue.catch(() => {}).then(async () => {
    const store = await loadLevelInfoStore();
    const result = await worker(store);
    await atomicWriteJson(LEVEL_INFO_FILE, store, { backupLimit: 3 }).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.levels, error, `atomicWriteJson (LevelInfo) fehlgeschlagen`);
    });
    return result;
  });
  levelInfoQueue = operation.catch(() => {});
  return operation;
};
const findLevelUpInfoTemplate = (cfg) => (Array.isArray(cfg?.embeds?.templates) ? cfg.embeds.templates : [])
  .find((template) => template.id === 'level-up-info' && template.enabled !== false) || null;

const buildLevelUpInfoPayload = async (cfg, guild, conf, options = {}) => {
  const template = findLevelUpInfoTemplate(cfg);
  const rulePayload = buildLevelsRulesPayload(guild, conf);
  const ruleEmbed = rulePayload.embeds?.[0]?.data || rulePayload.embeds?.[0]?.toJSON?.() || {};
  const rulesByName = new Map((ruleEmbed.fields || []).map((field) => [String(field.name || ''), String(field.value || '')]));
  const context = { guild, user: null, level: 1 };
  const format = (value) => formatLevelRulesText(formatTemplate(value, context), {
    server: guild?.name || '',
    rulesTitle: String(ruleEmbed.title || ''),
    rulesDescription: String(ruleEmbed.description || ''),
    rulesFooter: String(ruleEmbed.footer?.text || ''),
    rulesChatFieldName: levelRulesTexts(conf).rulesChatFieldName,
    rulesVoiceFieldName: levelRulesTexts(conf).rulesVoiceFieldName,
    rulesActivityFieldName: levelRulesTexts(conf).rulesActivityFieldName,
    rulesBonusFieldName: levelRulesTexts(conf).rulesBonusFieldName,
    rulesCurveFieldName: levelRulesTexts(conf).rulesCurveFieldName,
    rulesNoXpFieldName: levelRulesTexts(conf).rulesNoXpFieldName,
    rulesExcludedFieldName: levelRulesTexts(conf).rulesExcludedFieldName,
    rulesChatFieldText: rulesByName.get(formatLevelRulesText(levelRulesTexts(conf).rulesChatFieldName, { server: guild?.name || '' })) || '',
    rulesVoiceFieldText: rulesByName.get(formatLevelRulesText(levelRulesTexts(conf).rulesVoiceFieldName, { server: guild?.name || '' })) || '',
    rulesActivityFieldText: rulesByName.get(formatLevelRulesText(levelRulesTexts(conf).rulesActivityFieldName, { server: guild?.name || '' })) || '',
    rulesBonusFieldText: rulesByName.get(formatLevelRulesText(levelRulesTexts(conf).rulesBonusFieldName, { server: guild?.name || '' })) || '',
    rulesCurveFieldText: rulesByName.get(formatLevelRulesText(levelRulesTexts(conf).rulesCurveFieldName, { server: guild?.name || '' })) || '',
    rulesNoXpFieldText: rulesByName.get(formatLevelRulesText(levelRulesTexts(conf).rulesNoXpFieldName, { server: guild?.name || '' })) || '',
    rulesExcludedFieldText: rulesByName.get(formatLevelRulesText(levelRulesTexts(conf).rulesExcludedFieldName, { server: guild?.name || '' })) || ''
  });
  const fallback = new EmbedBuilder()
    .setColor(0xf1b84b)
    .setTitle('🕊️ Leveling – so funktioniert es')
    .setDescription('• **Chat**: 5 XP pro legitimer Nachricht, ohne Cooldown oder Aktivitätslimit\n'
      + '• **Sprachchat**: 1 XP pro gültiger Minute (mind. 2 Personen)\n'
      + '• **/level** – zeige dein Level · **/level @user** – checke andere\n'
      + '• Die höchste konfigurierte Engel-Rolle ist das Max-Level')
    .setFooter({ text: 'FALLEN HEAVEN · Leveling' })
    .setTimestamp();
  // Auch der Fallback nutzt embeds (Array): den Einzel-„embed“-Schlüssel
  // ignoriert discord.js v14 vollständig – die Nachricht käme ohne Embed an.
  if (!template?.embed) return { content: '', embeds: [fallback] };
  const data = template.embed;
  const embed = new EmbedBuilder().setColor(parseColor(data.color || '#8b82ff'));
  const title = format(data.title);
  if (title) embed.setTitle(title.slice(0, 256));
  const description = format(data.description);
  if (description) embed.setDescription(description.slice(0, 4096));
  if (data.url) embed.setURL(String(data.url));
  if (data.authorName) embed.setAuthor({ name: format(data.authorName).slice(0, 256), iconURL: data.authorIconUrl || undefined });
  const tFormatted = format(data.thumbnailUrl);
  const iFormatted = format(data.imageUrl);
  if (data.thumbnailUrl && isAllowedEmbedImageUrl(tFormatted)) embed.setThumbnail(tFormatted);
  if (data.imageUrl && isAllowedEmbedImageUrl(iFormatted)) embed.setImage(iFormatted);
  const footer = format(data.footerText);
  if (footer) embed.setFooter({ text: footer.slice(0, 2048), iconURL: data.footerIconUrl || undefined });
  if (data.timestamp) embed.setTimestamp();
  const fields = (Array.isArray(data.fields) ? data.fields : []).slice(0, 25).map((field) => ({
    name: format(field?.name).slice(0, 256) || '\u200b',
    value: format(field?.value).slice(0, 1024) || '\u200b',
    inline: Boolean(field?.inline)
  }));
  if (fields.length) embed.addFields(fields);
  // Außenbild (Embed Studio) als normaler Anhang am Info-Embed. Frisch
  // ausgewählte Bilder kommen als Datei (options.outsideFile) – beim Bearbeiten
  // wird der alte Anhang ersetzt statt angehängt.
  let outside;
  if (options.outsideFile) {
    outside = {
      files: [{ attachment: options.outsideFile, name: String(options.outsideImageName || 'fallen-heaven-level-info.png').replace(/[^a-z0-9._-]/gi, '_').slice(-120) }],
      attachments: []
    };
  } else if (options.removeOutsideImage === true) {
    outside = { files: null, attachments: [] };
  } else {
    outside = await resolveOutsideImageLite({
      outsideFile: null,
      outsideImageName: String(options?.outsideImageName || 'fallen-heaven-level-info.png'),
      defaultImageName: 'fallen-heaven-level-info.png',
      savedAttachment: template?.outsideImageAttachment || null,
      preserveAttachment: options?.allowAttachmentReference === true,
      removeOutsideImage: options?.removeOutsideImage === true
    });
  }
  const content = [format(template.content).slice(0, 2000)].filter(Boolean).join('\n').slice(0, 2000);
  // WICHTIG: embeds (Array), nicht embed – mit Anhängen (files/attachments)
  // verwirft discord.js den Einzel-„embed“-Schlüssel, es käme nur das Bild an.
  const payload = { content: content || undefined, embeds: [embed] };
  // attachments: [] ersetzt beim Edit alte Anhänge statt zu duplizieren.
  if (outside.files) {
    payload.files = outside.files;
    payload.attachments = [];
  }
  if (outside.attachments) payload.attachments = outside.attachments;
  return payload;
};

const levelUpInfoChannel = (guild, conf) => {
  const channelId = String(conf?.levelUpInfoChannelId || conf?.announceChannelId || '').trim();
  if (!channelId) return null;
  return guild?.channels?.cache?.get?.(channelId) || null;
};

const ensureLevelUpInfoEmbed = async ({ guild, cfg, conf = null, options = {} } = {}) => {
  const normalizedConf = conf || levelsConf(cfg);
  if (!guild?.id || normalizedConf?.levelUpInfoEnabled !== true) return { action: 'disabled' };
  const channelId = String(normalizedConf?.levelUpInfoChannelId || normalizedConf?.announceChannelId || '').trim();
  // Nicht nur den Cache prüfen: Direkt nach dem Start kann der Kanal noch nicht
  // gecacht sein – dann einmal frisch von Discord holen statt aufzugeben.
  let channel = channelId ? guild?.channels?.cache?.get?.(channelId) || null : null;
  if (!channel && channelId && typeof guild?.channels?.fetch === 'function') {
    channel = await guild.channels.fetch(channelId).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.levels, error, `channels.fetch (Info) fehlgeschlagen: ${channelId}`);
      return null;
    });
  }
  if (!channel?.isTextBased?.() || !channel.messages?.fetch) return { action: 'channel-unavailable' };
  const permissions = channel.permissionsFor?.(guild.members.me);
  if (!permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.SendMessages)) {
    return { action: 'missing-permission' };
  }
  return withLevelInfoQueue(async (store) => {
    const key = String(guild.id);
    const stored = store.guilds[key] || {};
    const infoTemplate = findLevelUpInfoTemplate(cfg) || {};
    // Nachricht VOR dem Payload-Bau laden: Der Payload braucht die Info, ob ein
    // vorhandener Anhang referenziert werden darf (nur beim Bearbeiten möglich).
    let message = null;
    if (stored.messageId) message = await channel.messages.fetch(stored.messageId).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.levels, error, `messages.fetch (Info Panel) fehlgeschlagen: ${stored.messageId}`);
      return null;
    });
    const savedAttachmentId = String(infoTemplate?.outsideImageAttachment?.id || '');
    const canReferenceAttachment = Boolean(message?.editable && savedAttachmentId
      && typeof message.attachments?.some === 'function'
      && message.attachments.some((attachment) => String(attachment.id) === savedAttachmentId));
    const payload = await buildLevelUpInfoPayload(cfg, guild, normalizedConf, {
      ...options,
      allowAttachmentReference: canReferenceAttachment
    });
    if (message?.editable) {
      await message.edit(payload).catch((error) => {
        quietLog(QUIET_LOG_SCOPE.levels, error, `message.edit (Info Panel) fehlgeschlagen`);
      });
      stored.updatedAt = new Date().toISOString();
      store.guilds[key] = stored;
      return { action: 'updated', messageId: stored.messageId };
    }
    const sent = await channel.send(payload).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.levels, error, `channel.send (Info Panel) fehlgeschlagen: Kanal ${channelId}`);
      return null;
    });
    if (!sent) return { action: 'send-failed' };
    store.guilds[key] = {
      channelId: String(channel.id),
      messageId: String(sent.id),
      updatedAt: new Date().toISOString()
    };
    return { action: 'posted', messageId: String(sent.id) };
  });
};

const cleanLevelUpChannel = async ({ guild, cfg, conf = null } = {}) => {
  const normalizedConf = conf || levelsConf(cfg);
  if (!guild?.id || normalizedConf?.levelUpCleanupEnabled !== true) return { action: 'disabled' };
  const maxMessages = Math.max(2, Math.floor(Number(normalizedConf?.levelUpCleanupMaxMessages) || 20));
  const channel = levelUpInfoChannel(guild, normalizedConf);
  if (!channel?.isTextBased?.() || !channel.messages?.fetch || !channel.bulkDelete) return { action: 'channel-unavailable' };
  const permissions = channel.permissionsFor?.(guild.members.me);
  if (!permissions?.has(PermissionFlagsBits.ManageMessages)) return { action: 'missing-permission' };
  const store = await loadLevelInfoStore();
  const protectedIds = new Set([String(store.guilds?.[String(guild.id)]?.messageId || '')]);
  const page = await channel.messages.fetch({ limit: 100 }).catch((error) => {
    quietLog(QUIET_LOG_SCOPE.levels, error, `messages.fetch (Bulk-Delete) fehlgeschlagen: Kanal ${channel.id}`);
    return null;
  });
  if (!page) return { action: 'fetch-failed' };
  const deletable = [...page.values()]
    .filter((message) => !message.pinned && !protectedIds.has(String(message.id)))
    .sort((left, right) => Number(left.createdTimestamp || 0) - Number(right.createdTimestamp || 0));
  const excess = deletable.length - maxMessages;
  if (excess <= 0) return { action: 'ok', deleted: 0 };
  const toDelete = deletable.slice(0, excess);
  await channel.bulkDelete(toDelete.map((message) => message.id), true).catch((error) => {
    quietLog(QUIET_LOG_SCOPE.levels, error, `bulkDelete fehlgeschlagen: Kanal ${channel.id}`);
  });
  return { action: 'ok', deleted: toDelete.length };
};

const startLevelRuntime = (runtime, cfg) => {
  const conf = levelsConf(cfg);
  if (!conf?.enabled) { stopLevelRuntime(runtime); return; }
  if (!runtime.voiceTimer) {
    runtime.voiceTimer = setInterval(() => {
      void queueVoiceTick(runtime, runtime.cfg || cfg).catch((error) => console.warn(`[levels] Voice-XP-Tick fehlgeschlagen: ${error?.message || error}`));
    }, TICK_MS);
    runtime.voiceTimer.unref?.();
  }
  if (!runtime.infoTimer) {
    runtime.infoTimer = setInterval(() => {
      void cleanLevelUpChannel({ guild: runtime.guild, cfg: runtime.cfg || cfg }).catch((error) => console.warn(`[levels] Level-Up-Kanal-Aufräumer fehlgeschlagen: ${error?.message || error}`));
    }, LEVEL_CLEANER_TICK_MS);
    runtime.infoTimer.unref?.();
  }
  // Panel-Reparatur: fehlt die Nachricht im Kanal (gelöscht, Kanal geleert …),
  // wird sie automatisch neu gesendet – auch nach Bot-Ausfällen.
  if (!runtime.panelTimer) {
    runtime.panelTimer = setInterval(() => {
      void syncLevelRolesPanel(runtime, runtime.cfg || cfg, { repair: true }).catch((error) => console.warn(`[levels] Levelrollen-Panel-Reparatur fehlgeschlagen: ${error?.message || error}`));
    }, LEVEL_PANEL_REPAIR_MS);
    runtime.panelTimer.unref?.();
  }
  void syncLevelRolesPanel(runtime, runtime.cfg || cfg, { repair: true }).catch((error) => console.warn(`[levels] Levelrollen-Panel fehlgeschlagen: ${error?.message || error}`));
  void ensureLevelUpInfoEmbed({ guild: runtime.guild, cfg: runtime.cfg || cfg }).catch((error) => console.warn(`[levels] Level-Up-Info-Embed fehlgeschlagen: ${error?.message || error}`));
};

export const feature = {
  id: 'levels',
  name: 'Leveling',
  commands: [
    new SlashCommandBuilder()
      .setName('level')
      .setDescription('Zeigt dein Level – oder das eines anderen Mitglieds')
      .addUserOption((option) => option
        .setName('user')
        .setDescription('Mitglied, dessen Level du sehen willst')
        .setRequired(false)),
    new SlashCommandBuilder()
      .setName('levelset')
      .setDescription('Setzt das Level eines Mitglieds manuell (Team)')
      .addUserOption((option) => option
        .setName('user')
        .setDescription('Mitglied, dessen Level gesetzt wird')
        .setRequired(true))
      .addIntegerOption((option) => option
        .setName('level')
        .setDescription('Ziel-Level (0 entfernt alle Level-Rollen)')
        .setMinValue(0)
        .setMaxValue(200)
        .setRequired(true))
  ],
  async onClientReady({ guild, cfg }) {
    await ensureLoaded();
    await ensureBalanceMigration(guild, cfg).catch((error) => {
      console.warn(`[levels] Balance-/Rollen-Migration fehlgeschlagen: ${error?.message || error}`);
      return null;
    });
    const runtime = ensureLevelRuntime(guild, cfg);
    hydrateVoiceStates(runtime);
    startLevelRuntime(runtime, cfg);
  },
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
    const conf = levelsConf(cfg);
    const xpPerMessage = Math.max(1, Math.floor(Number(conf?.xpPerMessage) || 5));
    const { amount } = await awardXp({
      guild: message.guild,
      member: message.member,
      cfg,
      conf,
      amount: xpPerMessage,
      source: 'message',
      fallbackChannel: message.channel
    });
    if (amount > 0) {
      profile.lastAt = now;
      recordAwardedFingerprint(profile, decision.fingerprint, now);
    }
  },
  async onVoiceStateUpdate({ oldState, newState, cfg, guild }) {
    const runtime = levelRuntimes.get(String(guild?.id || ''));
    if (!runtime) return;
    const userId = String(newState?.member?.id || newState?.id || '');
    if (!userId) return;
    const now = Date.now();
    const operation = runtime.voiceQueue.catch(() => {}).then(async () => {
      // Zuerst das bisherige Intervall abrechnen. Erst danach wird der neue
      // Voice-State sichtbar, damit allein/taub verbrachte Zeit nie nachläuft.
      await voiceTick(runtime, cfg, now);
      const existing = runtime.voiceStates.get(userId);
      if (newState?.channelId) {
        runtime.voiceStates.set(userId, {
          channelId: String(newState.channelId),
          lastSettledAt: now,
          voiceXpRemainder: Math.max(0, Number(existing?.voiceXpRemainder || 0)),
          selfDeaf: newState.selfDeaf === true,
          serverDeaf: newState.serverDeaf === true
        });
      } else {
        runtime.voiceStates.delete(userId);
      }
    });
    runtime.voiceQueue = operation.catch(() => {});
    await operation;
  },
  async onGuildMemberRemove({ member }) {
    const runtime = levelRuntimes.get(String(member?.guild?.id || ''));
    if (runtime) runtime.voiceStates.delete(String(member?.id || ''));
  },
  async onGuildMemberAdd({ member, cfg }) {
    // Fortschritt bleibt per User-ID gespeichert: Beim Wiederkommen das Profil
    // laden und die passenden Level-Rollen erneut vergeben (kurz verzögert,
    // damit Discord die Rollenliste des neuen Mitglieds vollständig kennt).
    const guildId = member?.guild?.id;
    const userId = member?.id;
    if (!guildId || !userId || member.user?.bot) return;
    const conf = levelsConf(cfg);
    if (conf.enabled !== true) return;
    setTimeout(() => void (async () => {
      try {
        const profile = await getLevelProfileSnapshot(guildId, userId);
        const level = levelForProfile(profile, conf);
        if (level <= 0) return;
        await synchronizeLevelRoles(member, conf, level);
      } catch (error) {
        console.warn(`[levels] Level-Rollen-Restore für <@${userId}> fehlgeschlagen: ${error?.message || error}`);
      }
    })(), 2_500).unref?.();
  },
  async onConfigUpdate({ guild, cfg, patch }) {
    await flush();
    if (!patch || !Object.prototype.hasOwnProperty.call(patch, 'levels')) return;
    await ensureBalanceMigration(guild, cfg).catch((error) => {
      console.warn(`[levels] Rollenabgleich nach Config-Änderung fehlgeschlagen: ${error?.message || error}`);
      return null;
    });
    const runtime = ensureLevelRuntime(guild, cfg);
    hydrateVoiceStates(runtime);
    startLevelRuntime(runtime, cfg);
    void ensureLevelUpInfoEmbed({ guild, cfg }).catch((error) => console.warn(`[levels] Level-Up-Info-Embed fehlgeschlagen: ${error?.message || error}`));
  },
  async onInteractionCreate({ interaction, cfg }) {
    if (interaction?.commandName === 'levelset') {
      const canManage = interaction.member?.permissions?.has?.(PermissionFlagsBits.ManageRoles)
        || (interaction.guild?.ownerId && interaction.guild.ownerId === interaction.user?.id);
      if (!canManage) {
        await interaction.reply({ content: 'Dafür brauchst du die Berechtigung **Rollen verwalten**.', flags: MessageFlags.Ephemeral }).catch(() => null);
        return true;
      }
      const targetUser = interaction.options.getUser('user');
      const level = Math.max(0, Math.floor(Number(interaction.options.getInteger('level') || 0)));
      const member = targetUser?.id === interaction.user?.id
        ? interaction.member
        : await interaction.guild?.members?.fetch?.(String(targetUser?.id || '')).catch((error) => {
            quietLog(QUIET_LOG_SCOPE.levels, error, `members.fetch (Rang) fehlgeschlagen: ${targetUser?.id}`);
            return null;
          });
      if (!member || member.user?.bot) {
        await interaction.reply({ content: 'Dieses Mitglied wurde nicht gefunden.', flags: MessageFlags.Ephemeral }).catch(() => null);
        return true;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral }).then(() => {}).catch(() => {});
      const result = await setMemberLevel({ guild: interaction.guild, member, cfg, level });
      const text = result.ok
        ? `✅ Level von <@${member.id}> wurde auf **${result.level}** gesetzt (${result.xp.toLocaleString('de-DE')} XP).`
        : '❌ Das Level konnte nicht gesetzt werden.';
      await interaction.editReply({ content: text }).catch(() => null);
      return true;
    }
    if (interaction?.commandName !== 'level') return false;
    return await handleLevelCommand({ interaction, cfg });
  },
  async onAnyInteraction({ interaction, cfg, guild }) {
    if (!interaction.isButton?.() || !String(interaction.customId || '').startsWith(PANEL_PREFIX)) return false;
    const view = String(interaction.customId).slice(PANEL_PREFIX.length);
    if (!['roles', 'rules', 'no-xp'].includes(view)) return true;
    const conf = levelsConf(cfg);
    if (conf?.enabled !== true) {
      await interaction.reply({ content: 'Das Leveling-Modul ist gerade deaktiviert.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return true;
    }
    const privateView = interaction.message?.flags?.has?.(MessageFlags.Ephemeral) === true;
    if (!privateView) {
      // Öffentliches Panel: nur antworten, wenn es noch das aktuelle ist.
      const panelStore = await loadPanelStore();
      const stored = panelStore.guilds?.[String(guild?.id || '')];
      if (!stored || stored.messageId !== String(interaction.message?.id || '')) {
        await interaction.reply({ content: 'Dieses Levelrollen-Panel ist nicht mehr aktuell.', flags: MessageFlags.Ephemeral }).catch(() => null);
        return true;
      }
    }
    // NO-XP-Toggle: wirkt auf den Klickenden selbst (eigene Rollen).
    if (view === 'no-xp') {
      if (!interaction.member) {
        await interaction.reply({ content: 'Dazu musst du auf dem Server sein.', flags: MessageFlags.Ephemeral }).catch(() => null);
        return true;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral }).then(() => {}).catch(() => {});
      const result = await toggleNoXpRole({ guild, member: interaction.member, conf });
      if (!result.ok) {
        await interaction.editReply({ content: 'Für diesen Server ist keine NO-XP-Rolle konfiguriert.' }).catch(() => null);
        return true;
      }
      const message = result.active
        ? '🚫 **NO-XP aktiviert:** Deine Level-Rolle(n) wurden entfernt – du erhältst ab sofort keine XP mehr im Chat und Sprachchat. Klick den Button erneut, um es rückgängig zu machen.'
        : '✅ **NO-XP deaktiviert:** Du erhältst wieder XP – deine Level-Rolle wurde nach deinem aktuellen Level neu vergeben.';
      await interaction.editReply({ content: message }).catch(() => null);
      return true;
    }
    const acknowledged = privateView
      ? await interaction.deferUpdate().then(() => true).catch(() => false)
      : await interaction.deferReply({ flags: MessageFlags.Ephemeral }).then(() => true).catch(() => false);
    if (!acknowledged) return true;
    const payload = view === 'rules'
      ? buildLevelsRulesPayload(guild, conf)
      : await buildLevelsRolesPayload(guild, cfg, conf, { allowAttachmentReference: true });
    // update() bearbeitet die Panel-Nachricht zuverlässig – egal ob der Handler
    // selbst oder der Timeout-Watchdog bereits bestätigt hat.
    await interaction.update(payload);
    return true;
  }
};

export const _levelInternals = {
  normalizeStore,
  normalizeProfile,
  getLevelProfileSnapshot,
  levelFromXp,
  xpForLevel,
  configuredMaxLevel,
  levelProgressSnapshot,
  migrateProfilesForBalance,
  ensureBalanceMigration,
  ensureLevelRuntime,
  progressBar,
  rankOf,
  fingerprint,
  parseMappings,
  shouldAward,
  recordAwardedFingerprint,
  awardXp,
  buildLevelRoleLines,
  buildLevelRolesEmbed,
  buildLevelsRolesPayload,
  buildLevelsRulesPayload,
  buildLevelsPanelNavigation,
  normalizeLevelsPanelDesign,
  defaultLevelsPanelDesign,
  resolveLevelsPanelImagePreservation,
  saveLevelsPanelDesign,
  saveLevelUpInfoDesign,
  syncLevelRolesPanel,
  toggleNoXpRole,
  wipeLevelRoles,
  grantLevelRolesToAll,
  setMemberLevel,
  voiceEligible,
  settleVoiceAccrual,
  handleLevelCommand,
  announceLevelUp,
  ROLE_UNLOCK_TEXTS,
  pickRoleUnlockText,
  buildLevelUpInfoPayload,
  ensureLevelUpInfoEmbed,
  cleanLevelUpChannel
};
