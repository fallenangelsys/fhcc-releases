import path from 'node:path';

import { EmbedBuilder } from 'discord.js';

import { atomicWriteJson, readJsonWithRecovery } from '../runtime/atomicJsonStore.js';
import { applyManagedRolePolicy } from '../runtime/managedRoleService.js';

// =============================================================================
// Rollen-Tausch (roleSwap)
// -----------------------------------------------------------------------------
// Wenn ein Mitglied eine Auslöser-Rolle bekommt (z. B. eine Mute-Rolle), wird
// eine konfigurierte andere Rolle entfernt. Verschwindet die Auslöser-Rolle
// wieder, bekommt das Mitglied die andere Rolle automatisch zurück – aber nur,
// wenn sie vorher wirklich von diesem Modul entfernt wurde (State-Tracking).
//
// Konfiguration (je Guild, über das Dashboard):
//   roleSwap.enabled        – Modul an/aus
//   roleSwap.pairs          – Zeilen im Format  <AuslöserRolleId>>TauschRolleId>
//   roleSwap.logChannelId   – optionaler Protokoll-Kanal
// =============================================================================

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const parsePairs = (raw) => String(raw || '')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const match = /^(\d+)>(\d+)$/.exec(line);
    if (!match) return null;
    return { triggerRoleId: match[1], swapRoleId: match[2] };
  })
  .filter(Boolean);

const settings = (cfg) => ({
  enabled: cfg?.roleSwap?.enabled === true,
  pairs: parsePairs(cfg?.roleSwap?.pairs),
  logChannelId: String(cfg?.roleSwap?.logChannelId || '').trim()
});

const stateFile = () => path.join(
  process.env.FALLEN_HEAVEN_DATA_DIR || path.join(process.cwd(), 'data'),
  'role-swap-state.json'
);

const emptyState = () => ({ version: 1, entries: {} });

let state = null;
let loadPromise = null;
let saveQueue = Promise.resolve();

const ensureLoaded = async () => {
  if (state) return state;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const loaded = await readJsonWithRecovery(stateFile(), { fallback: emptyState() });
    // readJsonWithRecovery liefert { value, source, recovered, failures } – die
    // eigentlichen Daten stecken in .value. Wrapper-Felder alter Dateien werden
    // nicht in den State (und damit nicht zurück in die Datei) übernommen.
    const parsed = loaded && typeof loaded === 'object' && loaded.value && typeof loaded.value === 'object'
      ? loaded.value
      : (loaded && typeof loaded === 'object' ? loaded : {});
    const { value: _leakValue, source: _leakSource, recovered: _leakRecovered, failures: _leakFailures, ...clean } = parsed;
    state = {
      ...emptyState(),
      ...clean,
      entries: (clean?.entries && typeof clean.entries === 'object' && !Array.isArray(clean.entries))
        ? clean.entries
        : {}
    };
    return state;
  })();
  return loadPromise;
};

const persist = async () => {
  if (!state) return;
  const snapshot = state;
  saveQueue = saveQueue.then(async () => {
    try {
      await atomicWriteJson(stateFile(), snapshot, { pretty: true });
    } catch (error) {
      console.error('[roleSwap] State konnte nicht gespeichert werden:', error?.message || error);
    }
  });
  return saveQueue;
};

const entryKey = (guildId, userId, swapRoleId) => `${String(guildId)}:${String(userId)}:${String(swapRoleId)}`;

// Rollenänderung über den Managed-Role-Service (Hierarchie-/Berechtigungsprüfung,
// gemeinsame Queue, Wiederholungsversuche). Austauschbar für Smoke-Tests.
let roleChangeImpl = async ({ member, addRoleIds = [], removeRoleIds = [], reason = '' }) => {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await applyManagedRolePolicy({
        member,
        addRoleIds,
        removeRoleIds,
        reason,
        verify: true,
        requireAll: false
      });
    } catch (error) {
      lastError = error;
      if (attempt < 3) await delay(500 * attempt);
    }
  }
  throw lastError;
};

const setRoleChangeImpl = (impl) => { roleChangeImpl = impl; };

const sendLog = async (guild, conf, title, description, color = 0x6ee7ff) => {
  if (!conf.logChannelId) return;
  const channel = guild?.channels?.cache?.get(conf.logChannelId) || await guild?.channels?.fetch(conf.logChannelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  await channel.send({
    embeds: [new EmbedBuilder().setColor(color).setAuthor({ name: 'FALLEN HEAVEN · ROLLEN-TAUSCH' }).setTitle(title).setDescription(description).setTimestamp()],
    allowedMentions: { parse: [] }
  }).catch(() => null);
};

// Reine Entscheidungslogik (testbar ohne Discord): vergleicht alte/neue Rollen
// mit den Tausch-Paaren und dem State (Schlüssel: guildId:userId:swapRoleId)
// und liefert die nötigen Aktionen.
const computeSwapActions = ({ oldRoles, newRoles, pairs, entries = {}, keyOf = (id) => id }) => {
  const actions = [];
  const oldSet = new Set(oldRoles || []);
  const newSet = new Set(newRoles || []);
  for (const pair of pairs || []) {
    const hadTrigger = oldSet.has(pair.triggerRoleId);
    const hasTrigger = newSet.has(pair.triggerRoleId);
    if (hasTrigger && !hadTrigger) {
      // Auslöser-Rolle kam dazu → Tausch-Rolle entfernen (falls vorhanden).
      if (newSet.has(pair.swapRoleId)) {
        actions.push({ type: 'remove', swapRoleId: pair.swapRoleId });
      }
    } else if (!hasTrigger && hadTrigger) {
      // Auslöser-Rolle weg → Tausch-Rolle nur wiederherstellen, wenn sie von
      // diesem Modul entfernt wurde (State-Eintrag vorhanden).
      const entry = entries[keyOf(pair.swapRoleId)];
      if (entry?.hadSwapRole && !newSet.has(pair.swapRoleId)) {
        actions.push({ type: 'restore', swapRoleId: pair.swapRoleId });
      } else {
        actions.push({ type: 'forget', swapRoleId: pair.swapRoleId });
      }
    }
  }
  return actions;
};

const processMemberUpdate = async ({ oldMember, newMember, cfg }) => {
  const conf = settings(cfg);
  if (!conf.enabled || !conf.pairs.length) return;
  const member = newMember || oldMember;
  if (!member?.guild || member?.user?.bot) return;
  const guildId = member.guild.id;
  const userId = member.id;
  const oldRoles = oldMember?.roles?.cache?.keys ? [...oldMember.roles.cache.keys()] : [];
  const newRoles = newMember?.roles?.cache?.keys ? [...newMember.roles.cache.keys()] : [];
  const data = await ensureLoaded();
  // State-Einträge nach dem Composite-Schlüssel indizieren (guildId:userId:swapRoleId),
  // damit computeSwapActions dieselbe Logik wie der Smoke-Test nutzt.
  const entries = Object.fromEntries(
    Object.entries(data.entries || {}).map(([key, entry]) => [
      entryKey(entry.guildId, entry.userId, entry.swapRoleId),
      entry
    ])
  );
  const actions = computeSwapActions({
    oldRoles,
    newRoles,
    pairs: conf.pairs,
    entries,
    keyOf: (swapRoleId) => entryKey(guildId, userId, swapRoleId)
  });
  let changed = false;

  for (const action of actions) {
    const key = entryKey(guildId, userId, action.swapRoleId);
    const reason = `Rollen-Tausch · ${action.type === 'remove' ? 'Auslöser-Rolle erhalten' : 'Auslöser-Rolle entfernt'}`;
    if (action.type === 'remove') {
      await roleChangeImpl({ member, removeRoleIds: [action.swapRoleId], reason });
      data.entries[key] = {
        guildId,
        userId,
        swapRoleId: action.swapRoleId,
        hadSwapRole: true,
        createdAt: new Date().toISOString()
      };
      changed = true;
      await sendLog(member.guild, conf, 'Rolle entfernt', `<@${userId}> hat **${action.swapRoleId}** erhalten → <@&${action.swapRoleId}> wurde entfernt.`);
    } else if (action.type === 'restore') {
      await roleChangeImpl({ member, addRoleIds: [action.swapRoleId], reason });
      delete data.entries[key];
      changed = true;
      await sendLog(member.guild, conf, 'Rolle wiederhergestellt', `<@${userId}> hat die Auslöser-Rolle verloren → <@&${action.swapRoleId}> wurde zurückgegeben.`);
    } else if (action.type === 'forget') {
      delete data.entries[key];
      changed = true;
    }
  }
  if (changed) await persist();
};

// Startabgleich: holt verpasste Ereignisse nach (Bot war z. B. beim Vergeben
// der Auslöser-Rolle offline) und räumt verwaiste State-Einträge auf.
const runReconcile = async (guild, cfg) => {
  const conf = settings(cfg);
  if (!conf.enabled || !conf.pairs.length || !guild) return;
  await guild.members.fetch().catch(() => null);
  const data = await ensureLoaded();
  let changed = false;
  for (const pair of conf.pairs) {
    for (const member of guild.members.cache.values()) {
      if (member.user?.bot) continue;
      const hasTrigger = member.roles.cache.has(pair.triggerRoleId);
      const hasSwap = member.roles.cache.has(pair.swapRoleId);
      const key = entryKey(guild.id, member.id, pair.swapRoleId);
      const entry = data.entries[key];
      if (hasTrigger) {
        if (hasSwap) {
          await roleChangeImpl({ member, removeRoleIds: [pair.swapRoleId], reason: 'Rollen-Tausch · Startabgleich' });
          data.entries[key] = { guildId: guild.id, userId: member.id, swapRoleId: pair.swapRoleId, hadSwapRole: true, createdAt: new Date().toISOString() };
          changed = true;
          await sendLog(guild, conf, 'Rolle entfernt (Startabgleich)', `<@${member.id}> hat **${pair.triggerRoleId}** → <@&${pair.swapRoleId}> wurde nachgeholt entfernt.`);
        }
      } else if (entry?.hadSwapRole && !hasSwap) {
        await roleChangeImpl({ member, addRoleIds: [pair.swapRoleId], reason: 'Rollen-Tausch · Startabgleich' });
        delete data.entries[key];
        changed = true;
        await sendLog(guild, conf, 'Rolle wiederhergestellt (Startabgleich)', `<@${member.id}> hat **${pair.triggerRoleId}** nicht mehr → <@&${pair.swapRoleId}> wurde zurückgegeben.`);
      } else if (!hasTrigger && entry) {
        delete data.entries[key];
        changed = true;
      }
      if (changed) await delay(120);
    }
  }
  if (changed) await persist();
};

export const feature = {
  id: 'roleSwap',
  name: 'Rollen-Tausch',
  commands: [],
  async onClientReady({ guild, cfg }) {
    void runReconcile(guild, cfg).catch((error) => {
      console.warn(`[roleSwap] Startabgleich fehlgeschlagen: ${error?.message || error}`);
    });
  },
  async onGuildMemberUpdate(context) {
    await processMemberUpdate(context).catch((error) => {
      console.warn(`[roleSwap] Rollen-Update fehlgeschlagen: ${error?.message || error}`);
    });
  },
  async onConfigUpdate({ guild, cfg, patch }) {
    if (!patch || !Object.prototype.hasOwnProperty.call(patch, 'roleSwap')) return;
    void runReconcile(guild, cfg).catch(() => null);
  }
};

export const getRoleSwapSnapshot = async (guildId) => {
  const data = await ensureLoaded();
  const entries = Object.entries(data.entries || {})
    .filter(([, entry]) => String(entry.guildId) === String(guildId || ''))
    .map(([key, entry]) => ({ key, userId: entry.userId, swapRoleId: entry.swapRoleId, createdAt: entry.createdAt }));
  return { trackedRemovals: entries };
};

export const _roleSwapInternals = { settings, parsePairs, computeSwapActions, setRoleChangeImpl, processMemberUpdate, runReconcile, ensureLoaded, persist };
