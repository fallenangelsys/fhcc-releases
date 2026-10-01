import { PermissionFlagsBits } from 'discord.js';

const memberQueues = new Map();
const runtime = {
  queued: 0,
  running: 0,
  completed: 0,
  failed: 0,
  added: 0,
  removed: 0,
  blocked: 0,
  lastMutationAt: null,
  lastError: ''
};

const uniqueIds = (values) => [...new Set((values || []).map((value) => String(value?.id || value || '').trim()).filter(Boolean))];

export const applyRoleChangesSequentially = async ({ member, toRemove = [], toAdd = [], reason = '' } = {}) => {
  if (!member?.roles) throw new Error('Discord-Mitglied für die Rollenänderung fehlt.');
  let updatedMember = member;
  if (toRemove.length) updatedMember = await updatedMember.roles.remove(toRemove, reason);
  if (toAdd.length) updatedMember = await updatedMember.roles.add(toAdd, reason);
  return updatedMember;
};

const validateRole = (member, roleId) => {
  const guild = member?.guild;
  const role = guild?.roles?.cache?.get?.(roleId);
  if (!role) return { ok: false, roleId, reason: `Rolle ${roleId} wurde auf dem Server nicht gefunden.` };
  if (role.id === guild.id) return { ok: false, roleId, reason: 'Die @everyone-Rolle kann nicht automatisch vergeben oder entfernt werden.' };
  if (role.managed) return { ok: false, roleId, reason: `Rolle „${role.name}“ wird von Discord verwaltet.` };
  const botMember = guild.members?.me;
  if (!botMember?.permissions?.has?.(PermissionFlagsBits.ManageRoles)) return { ok: false, roleId, reason: 'Dem Bot fehlt „Rollen verwalten“.' };
  if (!role.editable || Number(role.position || 0) >= Number(botMember.roles?.highest?.position || 0)) {
    return { ok: false, roleId, reason: `Rolle „${role.name}“ liegt über oder auf gleicher Höhe wie die höchste Bot-Rolle.` };
  }
  return { ok: true, roleId, role };
};

const freshMember = async (member) => member?.guild?.members?.fetch
  ? await member.guild.members.fetch({ user: member.id, force: true }).catch(() => member)
  : member;

const runRolePolicy = async ({ member, addRoleIds = [], removeRoleIds = [], reason = '', verify = true, requireAll = true, skipFresh = false } = {}) => {
  // skipFresh: Der Aufrufer hat die Mitglieder gerade frisch von Discord geladen
  // (z. B. Level-Rollen-Wipe) – dann sparen wir die zweite Fetch-Runde ein.
  if (!skipFresh) member = await freshMember(member);
  if (!member?.guild || !member.roles) throw new Error('Discord-Mitglied für den Rollenabgleich fehlt.');
  if (!member.manageable) throw new Error('Dieses Mitglied liegt über der Bot-Rolle und kann nicht verwaltet werden.');

  const addIds = uniqueIds(addRoleIds);
  const removeIds = uniqueIds(removeRoleIds).filter((roleId) => !addIds.includes(roleId));
  const validations = [...new Set([...removeIds, ...addIds])].map((roleId) => validateRole(member, roleId));
  const blocked = validations.filter((entry) => !entry.ok);
  runtime.blocked += blocked.length;
  if (blocked.length && requireAll) throw new Error(blocked.map((entry) => entry.reason).join(' '));
  const allowed = new Set(validations.filter((entry) => entry.ok).map((entry) => entry.roleId));
  const toRemove = removeIds.filter((roleId) => allowed.has(roleId) && member.roles.cache.has(roleId));
  const toAdd = addIds.filter((roleId) => allowed.has(roleId) && !member.roles.cache.has(roleId));
  const updatedMember = await applyRoleChangesSequentially({ member, toRemove, toAdd, reason: String(reason || 'FALLEN HEAVEN Rollenabgleich').slice(0, 500) });
  const confirmed = verify && (toAdd.length || toRemove.length) ? await freshMember(updatedMember) : updatedMember;
  const missing = toAdd.filter((roleId) => !confirmed.roles.cache.has(roleId));
  const stale = toRemove.filter((roleId) => confirmed.roles.cache.has(roleId));
  if (missing.length || stale.length) throw new Error([
    missing.length ? `Rollen fehlen nach Discord-Bestätigung: ${missing.join(', ')}` : '',
    stale.length ? `Rollen wurden nicht entfernt: ${stale.join(', ')}` : ''
  ].filter(Boolean).join(' · '));
  runtime.added += toAdd.length;
  runtime.removed += toRemove.length;
  runtime.lastMutationAt = new Date().toISOString();
  return { member: confirmed, addedRoleIds: toAdd, removedRoleIds: toRemove, blocked, changed: Boolean(toAdd.length || toRemove.length) };
};

export const applyManagedRolePolicy = (options = {}) => {
  const member = options.member;
  const key = `${member?.guild?.id || 'unknown'}:${member?.id || 'unknown'}`;
  const previous = memberQueues.get(key) || Promise.resolve();
  runtime.queued += 1;
  const operation = previous.catch(() => {}).then(async () => {
    runtime.queued = Math.max(0, runtime.queued - 1);
    runtime.running += 1;
    try {
      const result = await runRolePolicy(options);
      runtime.completed += 1;
      runtime.lastError = '';
      return result;
    } catch (error) {
      runtime.failed += 1;
      runtime.lastError = String(error?.message || error).slice(0, 500);
      throw error;
    } finally {
      runtime.running = Math.max(0, runtime.running - 1);
    }
  });
  memberQueues.set(key, operation);
  return operation.finally(() => {
    if (memberQueues.get(key) === operation) memberQueues.delete(key);
  });
};

export const getManagedRoleServiceSnapshot = () => ({ ...runtime, activeMemberQueues: memberQueues.size });

export const _managedRoleInternals = { uniqueIds, validateRole, runRolePolicy };
