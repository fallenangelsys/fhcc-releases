import path from 'node:path';
import process from 'node:process';

import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';

import { atomicWriteJson, readJsonWithRecovery } from '../runtime/atomicJsonStore.js';
import { applyManagedRolePolicy } from '../runtime/managedRoleService.js';

const DATA_DIR = path.resolve(
  String(process.env.FALLEN_HEAVEN_DATA_DIR || '').trim() || path.join(process.cwd(), 'data')
);
const STORE_FILE = path.join(DATA_DIR, 'role-saver.json');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const boundedInteger = (value, fallback, minimum, maximum) => {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
};

const settings = (cfg) => ({
  enabled: cfg?.roleSaver?.enabled === true,
  blacklistedRoleIds: [...new Set((cfg?.roleSaver?.blacklistedRoleIds || []).map(String).filter(Boolean))],
  excludeBots: cfg?.roleSaver?.excludeBots !== false,
  restoreDelaySeconds: boundedInteger(cfg?.roleSaver?.restoreDelaySeconds, 8, 1, 120),
  retryCount: boundedInteger(cfg?.roleSaver?.retryCount, 3, 1, 5),
  maxStoredRoles: boundedInteger(cfg?.roleSaver?.maxStoredRoles, 40, 5, 100),
  logChannelId: String(cfg?.roleSaver?.logChannelId || '').trim(),
  // Manuell verwaltete Rollen (Level, Booster, AutoRole …) nie wiederherstellen:
  // diese Module vergeben ihre Rollen selbstständig neu.
  skipManagedRoles: cfg?.roleSaver?.skipManagedRoles !== false
});

const emptyStore = () => ({ version: 1, guilds: {} });
let store = null;
let loadPromise = null;

const ensureLoaded = async () => {
  if (store) return store;
  if (!loadPromise) {
    loadPromise = readJsonWithRecovery(STORE_FILE, { fallback: emptyStore(), backupLimit: 5 })
      .then((result) => {
        const value = result?.value && typeof result.value === 'object' ? result.value : emptyStore();
        value.version = 1;
        value.guilds ||= {};
        store = value;
        return store;
      })
      .finally(() => { loadPromise = null; });
  }
  return loadPromise;
};

const queue = Promise.resolve();
const withQueue = (worker) => {
  const operation = queue.catch(() => {}).then(async () => {
    const data = await ensureLoaded();
    const result = await worker(data);
    await atomicWriteJson(STORE_FILE, data, { backupLimit: 5 }).catch(() => null);
    return result;
  });
  return operation;
};

const sendLog = async (guild, conf, title, description, color = 0x8b82ff) => {
  if (!conf.logChannelId || !guild) return;
  const channel = guild.channels.cache.get(conf.logChannelId) || await guild.channels.fetch(conf.logChannelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  await channel.send({
    embeds: [new EmbedBuilder().setColor(color).setAuthor({ name: 'FALLEN HEAVEN · ROLLEN-SAVER' }).setTitle(title).setDescription(description).setTimestamp()],
    allowedMentions: { parse: [] }
  }).catch(() => null);
};

// Rollen, die niemals gespeichert oder wiederhergestellt werden dürfen:
// @everyone, managed (Bot-/Integrationen-Rollen) und konfigurierte Blacklist.
const isForbiddenRole = (role, conf) => {
  if (!role || role.id === role.guild?.id) return true;
  if (role.managed === true) return true;
  if (conf.blacklistedRoleIds.includes(String(role.id))) return true;
  return false;
};

const collectStorableRoles = (member, conf) => {
  if (!member?.roles?.cache) return [];
  const candidates = [];
  for (const role of member.roles.cache.values()) {
    if (isForbiddenRole(role, conf)) continue;
    if (conf.skipManagedRoles && isManagedByBotModule(role.id)) continue;
    candidates.push(String(role.id));
  }
  return [...new Set(candidates)].slice(0, conf.maxStoredRoles);
};

// Rollen, die von anderen Modulen verwaltet werden (Level, Booster, AutoRole,
// Server-Tag, Verify, Ticket, Economy …) – diese kommen aus dem Live-Abgleich
// der jeweiligen Module zurück und gehören nicht in den Rollen-Saver.
const MANAGED_ROLE_SOURCES = [
  ['levels', 'levelRoleMappings'],
  ['boostRoles', 'tierRoleMappings'],
  ['boostRoles', 'automaticRoleIds'],
  ['autoRole', 'roleIds'],
  ['serverTagTracker', 'roleIds'],
  ['memberVerify', 'verifiedRoleIds'],
  ['memberVerify', 'pendingRoleIds'],
  ['tickets', 'supportRoleIds'],
  ['heavenEconomy', 'vipRoleIds']
];

const managedRoleIds = new Set();
let managedRoleIdsLoaded = false;

const loadManagedRoleIds = (cfg) => {
  const ids = new Set();
  for (const [moduleId, field] of MANAGED_ROLE_SOURCES) {
    const value = cfg?.[moduleId]?.[field];
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'string' || typeof entry === 'number') ids.add(String(entry));
        else if (entry && typeof entry === 'object' && entry.roleId) ids.add(String(entry.roleId));
      }
    }
  }
  return ids;
};

const isManagedByBotModule = (roleId) => {
  if (!managedRoleIdsLoaded) return false;
  return managedRoleIds.has(String(roleId));
};

const refreshManagedRoleIds = (cfg) => {
  managedRoleIds.clear();
  for (const id of loadManagedRoleIds(cfg)) managedRoleIds.add(String(id));
  managedRoleIdsLoaded = true;
};

export const saveRolesOnLeave = async ({ guild, member, cfg } = {}) => {
  const conf = settings(cfg);
  if (!guild?.id || !member?.id) return { action: 'skipped' };
  if (!conf.enabled) return { action: 'disabled' };
  if (conf.excludeBots && member.user?.bot) return { action: 'bot' };
  refreshManagedRoleIds(cfg);
  const roleIds = collectStorableRoles(member, conf);
  if (!roleIds.length) return { action: 'no-roles' };
  const stored = await withQueue(async (data) => {
    data.guilds[guild.id] ||= {};
    data.guilds[guild.id][String(member.id)] = {
      roleIds,
      savedAt: new Date().toISOString(),
      username: String(member.user?.username || '')
    };
    return data.guilds[guild.id][String(member.id)];
  });
  await sendLog(guild, conf, 'Rollen gespeichert', `<@${member.id}> · ${roleIds.length} Rollen für die Rückkehr gesichert.`, 0x8b82ff);
  return { action: 'saved', roleIds };
};

export const restoreRolesOnJoin = async ({ guild, member, cfg } = {}) => {
  const conf = settings(cfg);
  if (!guild?.id || !member?.id) return { action: 'skipped' };
  if (!conf.enabled) return { action: 'disabled' };
  if (conf.excludeBots && member.user?.bot) return { action: 'bot' };
  refreshManagedRoleIds(cfg);
  const saved = await withQueue(async (data) => {
    const entry = data.guilds?.[guild.id]?.[String(member.id)];
    if (entry && Array.isArray(entry.roleIds)) {
      delete data.guilds[guild.id][String(member.id)];
      if (!Object.keys(data.guilds[guild.id]).length) delete data.guilds[guild.id];
    }
    return entry || null;
  });
  if (!saved || !Array.isArray(saved.roleIds) || !saved.roleIds.length) return { action: 'none' };
  const existing = new Set((member.roles?.cache?.keys?.() ? [...member.roles.cache.keys()] : []).map(String));
  const target = saved.roleIds.filter((roleId) => !existing.has(String(roleId)));
  if (!target.length) return { action: 'already' };
  const roles = target.map((roleId) => guild.roles.cache.get(String(roleId)) || null).filter(Boolean);
  if (!roles.length) return { action: 'roles-gone' };
  // Nur Rollen wiederherstellen, die der Bot noch vergeben darf.
  const me = guild.members.me;
  const botHighest = me?.roles?.highest?.position ?? 0;
  const allowed = roles.filter((role) => role.position < botHighest);
  const blocked = roles.length - allowed.length;
  let lastError = null;
  for (let attempt = 1; attempt <= conf.retryCount; attempt += 1) {
    try {
      const result = await applyManagedRolePolicy({
        member,
        addRoleIds: allowed.map((role) => role.id),
        reason: `Rollen-Saver · Rückkehr · Versuch ${attempt}`,
        verify: true,
        requireAll: false
      });
      const added = Array.isArray(result?.addedRoleIds) ? result.addedRoleIds.length : 0;
      if (blocked > 0) {
        await sendLog(guild, conf, 'Rollen-Saver · teilweise wiederhergestellt', `<@${member.id}> · ${added} von ${allowed.length} Rollen vergeben · ${blocked} Rollen liegen über der Bot-Rolle und wurden übersprungen.`, 0xffc36a);
      }
      return { action: 'restored', added, total: allowed.length, blocked };
    } catch (error) {
      lastError = error;
      if (attempt < conf.retryCount) await delay(800 * attempt);
    }
  }
  await sendLog(guild, conf, 'Rollen-Saver · Wiederherstellung fehlgeschlagen', `<@${member.id}> · ${String(lastError?.message || lastError || 'Unbekannter Fehler').slice(0, 800)}`, 0xff6584);
  return { action: 'failed', error: String(lastError?.message || lastError || '').slice(0, 300) };
};

export const getRoleSaverStatus = async (guild, cfg) => {
  const conf = settings(cfg);
  const data = await ensureLoaded();
  const entries = data.guilds?.[String(guild?.id || '')] || {};
  const userIds = Object.keys(entries);
  const totalSavedRoles = userIds.reduce((sum, id) => sum + (Array.isArray(entries[id]?.roleIds) ? entries[id].roleIds.length : 0), 0);
  return {
    enabled: conf.enabled,
    blacklistedRoleIds: conf.blacklistedRoleIds,
    blacklistedRoleNames: conf.blacklistedRoleIds
      .map((id) => guild?.roles?.cache?.get?.(String(id))?.name)
      .filter(Boolean),
    savedMembers: userIds.length,
    savedRoles: totalSavedRoles,
    logChannelId: conf.logChannelId,
    restoreDelaySeconds: conf.restoreDelaySeconds
  };
};

// Test-Endpoint: gespeicherte Rollen eines Users anzeigen (ohne sie zu löschen).
export const getSavedRolesForMember = async (guildId, userId) => {
  const data = await ensureLoaded();
  const entry = data.guilds?.[String(guildId || '')]?.[String(userId || '')];
  return entry && Array.isArray(entry.roleIds) ? { ...entry } : null;
};

export const clearSavedRolesForMember = async (guildId, userId) => {
  return withQueue(async (data) => {
    const guildEntry = data.guilds?.[String(guildId || '')];
    if (!guildEntry || !guildEntry[String(userId || '')]) return { removed: false };
    delete guildEntry[String(userId || '')];
    if (!Object.keys(guildEntry).length) delete data.guilds[String(guildId || '')];
    return { removed: true };
  });
};

export const feature = {
  id: 'roleSaver',
  name: 'Rollen-Saver',

  async onGuildMemberRemove({ guild, member, cfg }) {
    await saveRolesOnLeave({ guild, member, cfg }).catch((error) => console.warn(`[roleSaver] Speichern fehlgeschlagen: ${error?.message || error}`));
  },

  async onGuildMemberAdd({ guild, member, cfg }) {
    const conf = settings(cfg);
    if (!conf.enabled) return;
    // Kurz warten, bis Discord das neue Mitglied vollständig registriert hat.
    setTimeout(() => void restoreRolesOnJoin({ guild, member, cfg }).catch((error) => console.warn(`[roleSaver] Wiederherstellung fehlgeschlagen: ${error?.message || error}`)), conf.restoreDelaySeconds * 1000).unref?.();
  },

  async onConfigUpdate({ guild, cfg }) {
    refreshManagedRoleIds(cfg);
  }
};

export const _roleSaverInternals = {
  settings,
  saveRolesOnLeave,
  restoreRolesOnJoin,
  getRoleSaverStatus,
  getSavedRolesForMember,
  clearSavedRolesForMember,
  isForbiddenRole,
  collectStorableRoles,
  refreshManagedRoleIds
};
