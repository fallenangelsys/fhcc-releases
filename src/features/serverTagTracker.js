import path from 'node:path';
import process from 'node:process';

import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';

import { atomicWriteJson, readJsonWithRecovery } from '../runtime/atomicJsonStore.js';
import { recordDiagnosticError, runTrackedOperation } from '../runtime/liveDiagnostics.js';
import { applyRoleChangesSequentially } from '../runtime/managedRoleService.js';

const DATA_DIR = path.resolve(
  String(process.env.FALLEN_HEAVEN_DATA_DIR || '').trim() || path.join(process.cwd(), 'data')
);
const LEDGER_FILE = path.join(DATA_DIR, 'server-tag-tracker.json');
const MAX_HISTORY = 300;
const MIN_POSITIVE_CONFIRMATION_GAP_MS = 60_000;
const MIN_NEGATIVE_CONFIRMATION_GAP_MS = 60_000;
const FOLLOW_UP_CONFIRMATION_DELAY_MS = 70_000;
const ASSIGNMENT_SAFETY_WINDOW_MS = 10 * 60_000;

const periodicTimers = new Map();
const startupTimers = new Map();
const guildConfigs = new Map();
const activeScans = new Map();
const requestedReruns = new Set();
const runtimeStatus = new Map();
const verificationTimers = new Map();
const eventRetryTimers = new Map();
const assignmentWindows = new Map();

let ledger = { version: 1, updatedAt: null, guilds: {} };
let ledgerLoadPromise = null;

const nowIso = () => new Date().toISOString();
const clampNumber = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};
const uniqueIds = (value) => {
  const rows = Array.isArray(value) ? value : String(value || '').split(/[\r\n,]+/);
  return [...new Set(rows.map((entry) => String(entry || '').trim()).filter(Boolean))];
};

export const normalizeServerTagTrackerConfig = (conf = {}) => {
  const roleIds = uniqueIds([
    ...(Array.isArray(conf?.roleIds) ? conf.roleIds : String(conf?.roleIds || '').split(/[\r\n,]+/)),
    conf?.roleId
  ]);
  return {
    enabled: conf?.enabled === true,
    monitorOnly: conf?.monitorOnly !== false,
    roleIds,
    roleId: roleIds[0] || '',
    scanIntervalMinutes: Math.trunc(clampNumber(conf?.scanIntervalMinutes, 30, 5, 1440)),
    assignmentConfirmations: Math.trunc(clampNumber(conf?.assignmentConfirmations, 2, 2, 5)),
    removalConfirmations: Math.trunc(clampNumber(conf?.removalConfirmations, 2, 2, 5)),
    maxAssignmentsPerScan: Math.trunc(clampNumber(conf?.maxAssignmentsPerScan, 10, 1, 100)),
    startupScan: conf?.startupScan !== false,
    excludeBots: conf?.excludeBots !== false,
    excludedRoleIds: uniqueIds(conf?.excludedRoleIds),
    logChannelId: String(conf?.logChannelId || '').trim()
  };
};

export const evaluateServerTagState = (user, guildId) => {
  if (!user || !Object.prototype.hasOwnProperty.call(user, 'primaryGuild')) {
    return { state: 'unknown', reason: 'primary-guild-unavailable', tag: '', identityGuildId: '' };
  }

  const primaryGuild = user.primaryGuild;
  if (!primaryGuild) {
    return { state: 'not-wearing', reason: 'no-primary-guild', tag: '', identityGuildId: '' };
  }

  const identityGuildId = String(primaryGuild.identityGuildId || '').trim();
  const tag = String(primaryGuild.tag || '').trim();
  if (primaryGuild.identityEnabled === true && identityGuildId === String(guildId || '') && tag) {
    return { state: 'wearing', reason: 'matching-primary-guild', tag, identityGuildId };
  }
  if (primaryGuild.identityEnabled === true && identityGuildId === String(guildId || '') && !tag) {
    return { state: 'unknown', reason: 'matching-primary-guild-incomplete', tag: '', identityGuildId };
  }
  if (primaryGuild.identityEnabled === false || primaryGuild.identityEnabled === null || identityGuildId) {
    return { state: 'not-wearing', reason: identityGuildId ? 'different-or-disabled-primary-guild' : 'primary-guild-disabled', tag, identityGuildId };
  }
  return { state: 'unknown', reason: 'primary-guild-incomplete', tag, identityGuildId };
};

const selectInitialObservation = ({ authoritativeUser = null, memberUser = null, guildId = '' } = {}) => {
  const eventObservation = authoritativeUser ? evaluateServerTagState(authoritativeUser, guildId) : null;
  return eventObservation && eventObservation.state !== 'unknown'
    ? eventObservation
    : evaluateServerTagState(memberUser, guildId);
};

export const calculateServerTagDecision = ({
  state,
  previousPositiveConfirmations = 0,
  previousMisses = 0,
  hasRole = false,
  assignmentConfirmations = 2,
  removalConfirmations = 2,
  authoritativeEvent = false,
  allowPositiveIncrement = true,
  allowMissIncrement = true
}) => {
  const requiredPositives = authoritativeEvent ? 1 : Math.trunc(clampNumber(assignmentConfirmations, 2, 2, 5));
  const requiredMisses = authoritativeEvent ? 1 : Math.trunc(clampNumber(removalConfirmations, 2, 2, 5));
  if (state === 'wearing') {
    const currentPositives = Math.max(0, Number(previousPositiveConfirmations || 0));
    const nextPositiveConfirmations = Math.min(requiredPositives, currentPositives + (allowPositiveIncrement ? 1 : 0));
    return {
      action: !hasRole && nextPositiveConfirmations >= requiredPositives ? 'add' : 'none',
      nextPositiveConfirmations,
      nextMisses: 0,
      confirmed: nextPositiveConfirmations >= requiredPositives
    };
  }
  if (state === 'not-wearing') {
    const currentMisses = Math.max(0, Number(previousMisses || 0));
    const nextMisses = Math.min(requiredMisses, currentMisses + (allowMissIncrement ? 1 : 0));
    return {
      action: hasRole && nextMisses >= requiredMisses ? 'remove' : 'none',
      nextPositiveConfirmations: 0,
      nextMisses,
      confirmed: nextMisses >= requiredMisses
    };
  }
  return {
    action: 'none',
    nextPositiveConfirmations: Math.max(0, Number(previousPositiveConfirmations || 0)),
    nextMisses: Math.max(0, Number(previousMisses || 0)),
    confirmed: false
  };
};

const defaultRuntimeStatus = (guildId) => ({
  guildId: String(guildId || ''),
  monitorOnly: true,
  running: false,
  phase: 'idle',
  progress: 0,
  detail: 'Bereit für den nächsten Abgleich.',
  source: '',
  checked: 0,
  total: 0,
  wearing: 0,
  candidates: 0,
  notWearing: 0,
  unknown: 0,
  roleAssigned: 0,
  roleRemoved: 0,
  deferredAssignments: 0,
  previewAdds: 0,
  previewRemovals: 0,
  errors: 0,
  skipped: 0,
  lastScanAt: null,
  lastCompletedAt: null,
  nextScanAt: null,
  lastError: ''
});

const ensureLedgerLoaded = async () => {
  if (!ledgerLoadPromise) {
    ledgerLoadPromise = readJsonWithRecovery(LEDGER_FILE, {
      backupLimit: 5,
      fallback: { version: 1, updatedAt: null, guilds: {} },
      validate: (value) => Boolean(value && typeof value === 'object' && value.guilds && typeof value.guilds === 'object')
    }).then((result) => {
      ledger = {
        version: 1,
        updatedAt: result.value?.updatedAt || null,
        guilds: result.value?.guilds && typeof result.value.guilds === 'object' ? result.value.guilds : {}
      };
      return ledger;
    }).catch((error) => {
      recordDiagnosticError('serverTagTracker.ledgerLoad', error, { file: path.basename(LEDGER_FILE) });
      return ledger;
    });
  }
  return ledgerLoadPromise;
};

const ensureGuildLedger = (guildId) => {
  const id = String(guildId || '');
  const existing = ledger.guilds[id];
  if (!existing || typeof existing !== 'object') {
    ledger.guilds[id] = {
      guildId: id,
      managedRoleIds: [],
      members: {},
      history: [],
      lastScanAt: null,
      lastCompletedAt: null
    };
  }
  const entry = ledger.guilds[id];
  entry.managedRoleIds = uniqueIds(entry.managedRoleIds);
  entry.members = entry.members && typeof entry.members === 'object' ? entry.members : {};
  entry.history = Array.isArray(entry.history) ? entry.history.slice(0, MAX_HISTORY) : [];
  return entry;
};

const persistLedger = async () => {
  ledger.updatedAt = nowIso();
  await atomicWriteJson(LEDGER_FILE, ledger, { backupLimit: 5 });
};

const rememberHistory = (guildEntry, event) => {
  guildEntry.history.unshift({ id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, at: nowIso(), ...event });
  guildEntry.history.splice(MAX_HISTORY);
};

const roleIsManageable = (guild, role) => {
  const botMember = guild?.members?.me;
  return Boolean(
    role
    && !role.managed
    && role.id !== guild.id
    && botMember?.permissions?.has?.(PermissionFlagsBits.ManageRoles)
    && botMember.roles?.highest?.comparePositionTo?.(role) > 0
  );
};

const memberIsExcluded = (member, conf) => Boolean(
  (conf.excludeBots && member?.user?.bot)
  || conf.excludedRoleIds.some((roleId) => member?.roles?.cache?.has?.(roleId))
);

const fetchFreshUser = async (member) => {
  const userId = String(member?.id || member?.user?.id || '');
  if (!userId || !member?.client?.users?.fetch) throw new Error('Discord-Benutzerprofil kann nicht frisch geladen werden.');
  return member.client.users.fetch(userId, { cache: true, force: true });
};

const resolveServerTagAvatar = (member, options = { size: 64 }) => {
  const user = member?.user || member || null;
  if (!user?.id) return '';
  const resolved = member?.displayAvatarURL?.(options) || user?.displayAvatarURL?.(options);
  if (resolved) return String(resolved);
  const guildAvatar = String(member?.avatar || '').trim();
  if (guildAvatar && member?.guild?.id) {
    const extension = String(guildAvatar.startsWith('a_') ? 'gif' : (options.extension || 'png')).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png';
    const size = Number(options.size || 128);
    const normalizedSize = Number.isFinite(size) && size > 0 ? Math.min(4096, Math.max(16, Math.round(size))) : 128;
    return `https://cdn.discordapp.com/guilds/${String(member.guild.id)}/users/${String(user.id)}/avatars/${guildAvatar}.${extension}?size=${normalizedSize}`;
  }
  if (user.avatar) {
    const extension = String(user.avatar.startsWith('a_') ? 'gif' : (options.extension || 'png')).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png';
    const size = Number(options.size || 128);
    const normalizedSize = Number.isFinite(size) && size > 0 ? Math.min(4096, Math.max(16, Math.round(size))) : 128;
    return `https://cdn.discordapp.com/avatars/${String(user.id)}/${String(user.avatar)}.${extension}?size=${normalizedSize}`;
  }
  return user.defaultAvatarURL || '';
};

const describeMember = (member, observation) => ({
  userId: String(member?.id || member?.user?.id || ''),
  username: String(member?.user?.username || ''),
  displayName: String(member?.displayName || member?.user?.globalName || member?.user?.username || member?.id || 'Mitglied'),
  avatarUrl: resolveServerTagAvatar(member, { size: 64 }),
  tag: String(observation?.tag || ''),
  identityGuildId: String(observation?.identityGuildId || '')
});

const sendTrackerLog = async (guild, conf, event) => {
  if (!conf.logChannelId) return;
  const channel = guild.channels.cache.get(conf.logChannelId)
    || await guild.channels.fetch(conf.logChannelId).catch(() => null);
  if (!channel?.isTextBased?.() || typeof channel.send !== 'function') return;
  const added = event.action === 'role-added';
  const updated = event.action === 'roles-updated';
  const embed = new EmbedBuilder()
    .setColor(added || updated ? 0x57f287 : event.action === 'role-removed' ? 0xed4245 : 0xffbd59)
    .setTitle(added ? 'Server-Tag-Rollen vergeben' : updated ? 'Server-Tag-Rollen aktualisiert' : event.action === 'role-removed' ? 'Server-Tag-Rollen entfernt' : 'Server-Tag-Prüfung benötigt Aufmerksamkeit')
    .setDescription(`**${event.displayName || event.userId}** (${event.userId})`)
    .addFields(
      { name: 'Ergebnis', value: event.detail || event.action, inline: false },
      { name: 'Quelle', value: event.source || 'Automatik', inline: true }
    )
    .setTimestamp(new Date());
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
};

const verificationKey = (guildId, userId) => `${String(guildId || '')}:${String(userId || '')}`;

const clearGuildVerificationTimers = (guildId) => {
  const prefix = `${String(guildId || '')}:`;
  for (const [key, timer] of verificationTimers) {
    if (!key.startsWith(prefix)) continue;
    clearTimeout(timer);
    verificationTimers.delete(key);
  }
  for (const [key, timer] of eventRetryTimers) {
    if (!key.startsWith(prefix)) continue;
    clearTimeout(timer);
    eventRetryTimers.delete(key);
  }
};

const reserveAssignmentSlot = (guildId, limit) => {
  const id = String(guildId || '');
  const cutoff = Date.now() - ASSIGNMENT_SAFETY_WINDOW_MS;
  const recent = (assignmentWindows.get(id) || []).filter((timestamp) => timestamp >= cutoff);
  if (recent.length >= Math.max(1, Number(limit || 1))) {
    assignmentWindows.set(id, recent);
    return false;
  }
  recent.push(Date.now());
  assignmentWindows.set(id, recent);
  return true;
};

function schedulePositiveVerification({ guild, userId, conf, delayMs = FOLLOW_UP_CONFIRMATION_DELAY_MS }) {
  const key = verificationKey(guild?.id, userId);
  if (!guild || !userId || verificationTimers.has(key)) return;
  const timer = setTimeout(async () => {
    verificationTimers.delete(key);
    const latestConf = guildConfigs.get(String(guild.id)) || normalizeServerTagTrackerConfig(conf);
    if (!latestConf.enabled || !latestConf.roleIds.length) return;
    if (activeScans.has(guild.id)) {
      schedulePositiveVerification({ guild, userId, conf: latestConf, delayMs });
      return;
    }
    const member = await guild.members.fetch({ user: userId, force: true }).catch(() => null);
    if (!member) return;
    await runTrackedOperation('Server-Tag Bestätigungsprüfung', {
      featureId: 'serverTagTracker', hook: 'positiveConfirmation', guildId: guild.id, userId
    }, () => reconcileMember({ guild, member, conf: latestConf, source: 'positiveConfirmation', persist: true }), {
      timeoutMs: 45_000
    }).catch(() => {});
  }, Math.max(FOLLOW_UP_CONFIRMATION_DELAY_MS, Number(delayMs || 0)));
  timer.unref?.();
  verificationTimers.set(key, timer);
}

const reconcileMember = async ({
  guild,
  member,
  conf,
  source = 'event',
  persist = true,
  mutationBudget = null,
  authoritativeEvent = false,
  authoritativeUser = null
}) => {
  await ensureLedgerLoaded();
  const guildEntry = ensureGuildLedger(guild.id);
  const userId = String(member?.id || member?.user?.id || '');
  if (!userId || !member?.user) return { checked: false, skipped: true, reason: 'missing-member' };

  if (memberIsExcluded(member, conf)) {
    delete guildEntry.members[userId];
    if (persist) await persistLedger();
    return { checked: false, skipped: true, reason: member.user.bot ? 'bot' : 'excluded-role' };
  }

  const previous = guildEntry.members[userId] || {};
  const checkedAt = nowIso();
  const managedRoleIds = uniqueIds([...guildEntry.managedRoleIds, ...conf.roleIds]);
  guildEntry.managedRoleIds = managedRoleIds;
  const hasAnyManagedRole = managedRoleIds.some((roleId) => member.roles.cache.has(roleId));
  let observation = selectInitialObservation({ authoritativeUser, memberUser: member.user, guildId: guild.id });
  let profileFresh = false;
  let profileFetchError = '';
  const needsFreshProfile = observation.state === 'wearing'
    || hasAnyManagedRole
    || previous.state === 'wearing'
    || Number(previous.positiveConfirmations || 0) > 0
    || authoritativeEvent
    || source === 'userUpdate'
    || source === 'positiveConfirmation';
  if (needsFreshProfile && !profileFresh) {
    try {
      const freshUser = await fetchFreshUser(member);
      observation = evaluateServerTagState(freshUser, guild.id);
      profileFresh = true;
    } catch (caught) {
      profileFetchError = String(caught?.message || caught || 'Discord-Profil konnte nicht geladen werden.').slice(0, 300);
      observation = { state: 'unknown', reason: 'fresh-profile-fetch-failed', tag: '', identityGuildId: '' };
    }
  }

  const previousPositiveAt = Date.parse(String(previous.lastPositiveEvidenceAt || ''));
  const positiveEvidenceIsNew = observation.state === 'wearing'
    && profileFresh
    && (authoritativeEvent
      || previous.state !== 'wearing'
      || !Number.isFinite(previousPositiveAt)
      || Date.now() - previousPositiveAt >= MIN_POSITIVE_CONFIRMATION_GAP_MS);
  const previousNegativeAt = Date.parse(String(previous.lastNegativeEvidenceAt || ''));
  const negativeEvidenceIsNew = observation.state === 'not-wearing'
    && profileFresh
    && (
      authoritativeEvent
      ||
      previous.state !== 'not-wearing'
      || !Number.isFinite(previousNegativeAt)
      || Date.now() - previousNegativeAt >= MIN_NEGATIVE_CONFIRMATION_GAP_MS
    );
  const configuredRoles = (await Promise.all(conf.roleIds.map(async (roleId) => (
    guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null)
  )))).filter(Boolean);
  const hasAllConfiguredRoles = configuredRoles.length === conf.roleIds.length
    && configuredRoles.every((role) => member.roles.cache.has(role.id));
  const decision = calculateServerTagDecision({
    state: observation.state,
    previousPositiveConfirmations: previous.positiveConfirmations,
    previousMisses: previous.consecutiveMisses,
    hasRole: observation.state === 'wearing' ? hasAllConfiguredRoles : hasAnyManagedRole,
    assignmentConfirmations: conf.assignmentConfirmations,
    removalConfirmations: conf.removalConfirmations,
    authoritativeEvent: profileFresh,
    allowPositiveIncrement: profileFresh || positiveEvidenceIsNew,
    allowMissIncrement: profileFresh || negativeEvidenceIsNew
  });
  const person = describeMember(member, observation);
  const missingConfiguredRoles = configuredRoles.filter((role) => !member.roles.cache.has(role.id));
  let action = 'none';
  let error = '';
  let deferred = false;
  let previewAction = '';

  try {
    if (configuredRoles.length !== conf.roleIds.length) throw new Error('Mindestens eine ausgewählte Server-Tag-Rolle existiert nicht mehr.');
    if (configuredRoles.some((role) => !roleIsManageable(guild, role))) {
      throw new Error('Mindestens eine Server-Tag-Rolle liegt über der Bot-Rolle oder „Rollen verwalten“ fehlt.');
    }

    const obsoleteRoles = managedRoleIds
      .filter((roleId) => !conf.roleIds.includes(roleId) && member.roles.cache.has(roleId))
      .map((roleId) => guild.roles.cache.get(roleId))
      .filter((role) => roleIsManageable(guild, role));
    const needsMutation = !conf.monitorOnly && (decision.action !== 'none' || (observation.state === 'wearing' && obsoleteRoles.length > 0));
    if (needsMutation && !member.manageable) throw new Error('Dieses Mitglied liegt über der Bot-Rolle und kann nicht verwaltet werden.');
    if (!conf.monitorOnly && observation.state === 'wearing' && obsoleteRoles.length) {
      member = await applyRoleChangesSequentially({ member, toRemove: obsoleteRoles, reason: 'Server-Tag-Tracker: alte Tracker-Rolle ersetzt' });
    }

    if (decision.action === 'add') {
      if (conf.monitorOnly) {
        previewAction = 'add';
      } else {
        const scanLimitReached = Boolean(mutationBudget && mutationBudget.remainingAssignments <= 0);
        const rollingLimitReached = !authoritativeEvent && !scanLimitReached && !reserveAssignmentSlot(guild.id, conf.maxAssignmentsPerScan);
        if (scanLimitReached || rollingLimitReached) {
          deferred = true;
          if (mutationBudget) mutationBudget.deferredAssignments += 1;
        } else {
          if (missingConfiguredRoles.length) member = await applyRoleChangesSequentially({ member, toAdd: missingConfiguredRoles, reason: 'Server-Tag-Tracker: mehrfach bestätigter Server-Tag aktiv' });
          if (mutationBudget) mutationBudget.remainingAssignments -= 1;
          action = 'role-added';
        }
      }
    } else if (!conf.monitorOnly && observation.state === 'wearing' && obsoleteRoles.length) {
      action = 'roles-updated';
    } else if (decision.action === 'remove') {
      if (conf.monitorOnly) {
        previewAction = 'remove';
      } else {
        const removable = managedRoleIds
          .filter((roleId) => member.roles.cache.has(roleId))
          .map((roleId) => guild.roles.cache.get(roleId))
          .filter((role) => roleIsManageable(guild, role));
        if (removable.length) member = await applyRoleChangesSequentially({ member, toRemove: removable, reason: 'Server-Tag-Tracker: Server-Tag nicht mehr aktiv' });
        action = 'role-removed';
      }
    }
  } catch (caught) {
    error = String(caught?.message || caught || 'Rollenänderung fehlgeschlagen.').slice(0, 300);
    action = 'error';
  }

  const record = {
    ...previous,
    ...person,
    state: observation.state,
    reason: observation.reason,
    wearing: observation.state === 'wearing' ? true : observation.state === 'not-wearing' ? false : null,
    consecutiveMisses: decision.nextMisses,
    positiveConfirmations: decision.nextPositiveConfirmations,
    confirmed: decision.confirmed,
    hasRole: action === 'role-added' || action === 'roles-updated'
      ? true
      : action === 'role-removed'
        ? false
        : observation.state === 'wearing' ? hasAllConfiguredRoles : hasAnyManagedRole,
    lastCheckedAt: checkedAt,
    lastSource: source,
    authoritativeEvent: Boolean(authoritativeEvent && profileFresh),
    profileFresh,
    lastPositiveEvidenceAt: observation.state === 'wearing' && positiveEvidenceIsNew
      ? checkedAt
      : observation.state === 'not-wearing'
        ? null
        : (previous.lastPositiveEvidenceAt || null),
    lastConfirmedAt: observation.state === 'unknown' ? (previous.lastConfirmedAt || null) : checkedAt,
    lastNegativeEvidenceAt: observation.state === 'wearing'
      ? null
      : observation.state === 'not-wearing' && negativeEvidenceIsNew
        ? checkedAt
        : (previous.lastNegativeEvidenceAt || null),
    lastChangedAt: action === 'none' ? (previous.lastChangedAt || null) : checkedAt,
    lastAction: action,
    lastError: error || profileFetchError,
    assignmentDeferred: deferred,
    pendingAction: previewAction,
    departed: false
  };
  guildEntry.members[userId] = record;

  if (observation.state === 'wearing' && profileFresh && !decision.confirmed) {
    schedulePositiveVerification({ guild, userId, conf });
  }
  if (deferred) {
    schedulePositiveVerification({ guild, userId, conf, delayMs: ASSIGNMENT_SAFETY_WINDOW_MS + 15_000 });
  }

  if (action !== 'none') {
    const historyEvent = {
      userId,
      displayName: person.displayName,
      action,
      state: observation.state,
      source,
      detail: error || (action === 'role-added'
        ? `${missingConfiguredRoles.length} Server-Tag-Rolle${missingConfiguredRoles.length === 1 ? '' : 'n'} wurde${missingConfiguredRoles.length === 1 ? '' : 'n'} vergeben.`
        : action === 'roles-updated'
          ? 'Der verwaltete Server-Tag-Rollensatz wurde aktualisiert.'
        : action === 'role-removed'
          ? `Server-Tag war in ${conf.removalConfirmations} Prüfungen nicht aktiv; verwaltete Rollen wurden entfernt.`
          : 'Keine Rollenänderung.')
    };
    rememberHistory(guildEntry, historyEvent);
    if (action === 'error') recordDiagnosticError('serverTagTracker.memberRole', new Error(error), { guildId: guild.id, userId, source });
    void sendTrackerLog(guild, conf, historyEvent);
  }

  if (persist) await persistLedger();
  return { checked: true, state: observation.state, action, previewAction, error: error || profileFetchError, deferred, record };
};

const performGuildReconcile = async ({ guild, conf, source = 'manual', actorId = '' }) => {
  await ensureLedgerLoaded();
  const previousStatus = runtimeStatus.get(guild.id) || defaultRuntimeStatus(guild.id);
  const status = {
    ...defaultRuntimeStatus(guild.id),
    monitorOnly: conf.monitorOnly,
    lastCompletedAt: previousStatus.lastCompletedAt || null,
    nextScanAt: previousStatus.nextScanAt || null,
    running: true,
    phase: 'fetching',
    source,
    detail: 'Discord-Mitglieder und Server-Tags werden aktualisiert.'
  };
  runtimeStatus.set(guild.id, status);
  const guildEntry = ensureGuildLedger(guild.id);
  const startedAt = nowIso();
  guildEntry.lastScanAt = startedAt;
  status.lastScanAt = startedAt;

  await guild.roles.fetch().catch(() => null);
  const trackerRoles = conf.roleIds.map((roleId) => guild.roles.cache.get(roleId)).filter(Boolean);
  if (trackerRoles.length !== conf.roleIds.length) throw new Error('Mindestens eine ausgewählte Server-Tag-Rolle existiert nicht mehr.');
  if (trackerRoles.some((role) => !roleIsManageable(guild, role))) {
    throw new Error('Mindestens eine Server-Tag-Rolle liegt über der Bot-Rolle oder dem Bot fehlt „Rollen verwalten“.');
  }
  const fetchedMembers = await guild.members.fetch().catch((error) => {
    throw new Error(`Mitglieder konnten nicht vollständig geladen werden: ${error?.message || error}`);
  });
  const members = [...fetchedMembers.values()].filter((member) => !memberIsExcluded(member, conf));
  const mutationBudget = {
    remainingAssignments: conf.maxAssignmentsPerScan,
    deferredAssignments: 0
  };
  status.total = members.length;
  status.phase = 'checking';
  status.detail = `${members.length.toLocaleString('de-DE')} Mitglieder werden geprüft.`;

  const currentIds = new Set(members.map((member) => String(member.id)));
  for (const [userId, memberEntry] of Object.entries(guildEntry.members)) {
    if (currentIds.has(userId)) continue;
    memberEntry.departed = true;
  }

  for (let index = 0; index < members.length; index += 1) {
    const result = await reconcileMember({
      guild,
      member: members[index],
      conf,
      source,
      persist: false,
      mutationBudget
    });
    status.checked += result.checked ? 1 : 0;
    status.skipped += result.skipped ? 1 : 0;
    if (result.state === 'wearing' && result.record?.confirmed) status.wearing += 1;
    else if (result.state === 'wearing') status.candidates += 1;
    else if (result.state === 'not-wearing') status.notWearing += 1;
    else if (result.checked) status.unknown += 1;
    if (result.action === 'role-added' || result.action === 'roles-updated') status.roleAssigned += 1;
    if (result.action === 'role-removed') status.roleRemoved += 1;
    if (result.previewAction === 'add') status.previewAdds += 1;
    if (result.previewAction === 'remove') status.previewRemovals += 1;
    if (result.deferred) status.deferredAssignments += 1;
    if (result.error) status.errors += 1;
    status.progress = status.total ? Math.round(((index + 1) / status.total) * 100) : 100;
    status.detail = `${index + 1} von ${status.total} Mitgliedern geprüft.`;
    if ((index + 1) % 25 === 0) await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const completedAt = nowIso();
  guildEntry.lastCompletedAt = completedAt;
  guildEntry.lastSummary = {
    checked: status.checked,
    wearing: status.wearing,
    candidates: status.candidates,
    notWearing: status.notWearing,
    unknown: status.unknown,
    roleAssigned: status.roleAssigned,
    roleRemoved: status.roleRemoved,
    deferredAssignments: status.deferredAssignments,
    previewAdds: status.previewAdds,
    previewRemovals: status.previewRemovals,
    errors: status.errors,
    skipped: status.skipped,
    source,
    actorId: String(actorId || '')
  };
  status.running = false;
  status.phase = status.errors ? 'completed-with-warnings' : 'completed';
  status.progress = 100;
  status.lastCompletedAt = completedAt;
  status.detail = status.errors
    ? `Abgleich beendet: ${status.errors} Rollenfehler benötigen Aufmerksamkeit.`
    : conf.monitorOnly
      ? `Prüfmodus beendet: ${status.wearing} bestätigt, ${status.candidates} offen, ${status.previewAdds} Vergaben und ${status.previewRemovals} Entzüge vorgemerkt.`
    : status.deferredAssignments
      ? `Abgleich beendet: ${status.wearing} bestätigte Träger, ${status.deferredAssignments} Vergaben durch das Sicherheitslimit zurückgestellt.`
      : `Abgleich beendet: ${status.wearing} bestätigt, ${status.candidates} warten auf eine zweite frische Prüfung.`;
  await persistLedger();
  return { ...status, queued: false };
};

export const startServerTagReconcile = ({ guild, conf, source = 'manual', actorId = '' }) => {
  const normalized = normalizeServerTagTrackerConfig(conf);
  guildConfigs.set(String(guild?.id || ''), normalized);
  if (!guild) throw new Error('Server wurde nicht gefunden.');
  if (!normalized.enabled) throw new Error('Der Server-Tag-Tracker ist deaktiviert.');
  if (!normalized.roleIds.length) throw new Error('Wähle zuerst mindestens eine Server-Tag-Rolle aus.');
  if (activeScans.has(guild.id)) {
    requestedReruns.add(guild.id);
    return { ...runtimeStatus.get(guild.id), queued: true };
  }

  const operation = performGuildReconcile({ guild, conf: normalized, source, actorId })
    .catch((error) => {
      const status = runtimeStatus.get(guild.id) || defaultRuntimeStatus(guild.id);
      Object.assign(status, {
        running: false,
        phase: 'failed',
        detail: 'Server-Tag-Abgleich fehlgeschlagen.',
        lastError: String(error?.message || error).slice(0, 300)
      });
      recordDiagnosticError('serverTagTracker.reconcile', error, { guildId: guild.id, source });
      throw error;
    })
    .finally(() => {
      activeScans.delete(guild.id);
      if (!requestedReruns.delete(guild.id)) return;
      setTimeout(() => {
        const latestConf = guildConfigs.get(guild.id) || normalized;
        void runTrackedOperation('Server-Tag Folgeabgleich', {
          featureId: 'serverTagTracker', hook: 'queuedReconcile', guildId: guild.id
        }, () => startServerTagReconcile({ guild, conf: latestConf, source: 'queued' }), { timeoutMs: 15 * 60_000 }).catch(() => {});
      }, 1_500).unref?.();
    });
  activeScans.set(guild.id, operation);
  return operation;
};

export const queueServerTagReconcile = (options) => {
  const result = startServerTagReconcile(options);
  if (!result || typeof result.then !== 'function') return result;
  void result.catch(() => {});
  return { started: true, queued: false };
};

const scheduleTracker = (guild, cfg, { immediate = false } = {}) => {
  const conf = normalizeServerTagTrackerConfig(cfg?.serverTagTracker);
  guildConfigs.set(String(guild.id), conf);
  if (periodicTimers.has(guild.id)) clearInterval(periodicTimers.get(guild.id));
  if (startupTimers.has(guild.id)) clearTimeout(startupTimers.get(guild.id));
  periodicTimers.delete(guild.id);
  startupTimers.delete(guild.id);
  clearGuildVerificationTimers(guild.id);

  const status = runtimeStatus.get(guild.id) || defaultRuntimeStatus(guild.id);
  status.monitorOnly = conf.monitorOnly;
  runtimeStatus.set(guild.id, status);
  if (!conf.enabled || !conf.roleIds.length) {
    Object.assign(status, {
      running: false,
      phase: conf.enabled ? 'configuration-required' : 'disabled',
      detail: conf.enabled ? 'Wähle mindestens eine verwaltbare Discord-Rolle aus.' : 'Server-Tag-Tracker ist deaktiviert.',
      nextScanAt: null
    });
    return;
  }

  const run = (source) => runTrackedOperation('Server-Tag Rollenabgleich', {
    featureId: 'serverTagTracker', hook: source, guildId: guild.id
  }, () => startServerTagReconcile({ guild, conf: guildConfigs.get(guild.id) || conf, source }), {
    timeoutMs: 15 * 60_000
  }).catch((error) => console.warn(`[serverTagTracker] Abgleich für ${guild.name} fehlgeschlagen: ${error?.message || error}`));

  const intervalMs = conf.scanIntervalMinutes * 60_000;
  status.nextScanAt = new Date(Date.now() + intervalMs).toISOString();
  if (immediate || conf.startupScan) {
    const timer = setTimeout(() => void run(immediate ? 'configUpdate' : 'startupScan'), immediate ? 1_500 : 20_000);
    timer.unref?.();
    startupTimers.set(guild.id, timer);
  }
  const periodic = setInterval(() => {
    status.nextScanAt = new Date(Date.now() + intervalMs).toISOString();
    void run('periodicScan');
  }, intervalMs);
  periodic.unref?.();
  periodicTimers.set(guild.id, periodic);
};

const updateSingleMember = async ({ guild, member, cfg, source, authoritativeEvent = false, authoritativeUser = null }) => {
  const conf = normalizeServerTagTrackerConfig(cfg?.serverTagTracker);
  guildConfigs.set(String(guild.id), conf);
  if (!conf.enabled || !conf.roleIds.length) return;
  const retryKey = verificationKey(guild.id, member?.id || authoritativeUser?.id);
  if (activeScans.has(guild.id)) {
    if (eventRetryTimers.has(retryKey)) clearTimeout(eventRetryTimers.get(retryKey));
    const timer = setTimeout(() => {
      eventRetryTimers.delete(retryKey);
      void updateSingleMember({ guild, member, cfg, source, authoritativeEvent, authoritativeUser }).catch(() => {});
    }, 2_000);
    timer.unref?.();
    eventRetryTimers.set(retryKey, timer);
    return;
  }
  if (eventRetryTimers.has(retryKey)) clearTimeout(eventRetryTimers.get(retryKey));
  eventRetryTimers.delete(retryKey);
  await runTrackedOperation('Server-Tag Mitglied prüfen', {
    featureId: 'serverTagTracker', hook: source, guildId: guild.id, userId: member?.id
  }, () => reconcileMember({
    guild,
    member,
    conf,
    source,
    persist: true,
    authoritativeEvent,
    authoritativeUser
  }), { timeoutMs: 45_000 });
};

export const getServerTagTrackerSnapshot = async (guildId) => {
  await ensureLedgerLoaded();
  const id = String(guildId || '');
  const guildEntry = ensureGuildLedger(id);
  const status = runtimeStatus.get(id) || defaultRuntimeStatus(id);
  const members = Object.values(guildEntry.members)
    .filter((entry) => !entry.departed)
    .map((entry) => ({
      ...entry,
      confirmed: entry.state === 'wearing'
        ? Boolean(entry.profileFresh === true && Number(entry.positiveConfirmations || 0) >= 2 && entry.confirmed)
        : Boolean(entry.confirmed)
    }))
    .sort((left, right) => {
      const order = { wearing: 0, unknown: 1, 'not-wearing': 2 };
      return (order[left.state] ?? 3) - (order[right.state] ?? 3)
        || String(left.displayName || '').localeCompare(String(right.displayName || ''), 'de', { sensitivity: 'base' });
    });
  const persisted = guildEntry.lastSummary || {};
  const derivedCounts = members.reduce((counts, entry) => {
    if (entry.state === 'wearing' && entry.confirmed) counts.wearing += 1;
    else if (entry.state === 'wearing') counts.candidates += 1;
    else if (entry.state === 'not-wearing') counts.notWearing += 1;
    else counts.unknown += 1;
    return counts;
  }, { wearing: 0, candidates: 0, notWearing: 0, unknown: 0 });
  return {
    ...defaultRuntimeStatus(id),
    ...persisted,
    ...status,
    wearing: status.running ? status.wearing : derivedCounts.wearing,
    candidates: status.running ? status.candidates : derivedCounts.candidates,
    notWearing: status.running ? status.notWearing : derivedCounts.notWearing,
    unknown: status.running ? status.unknown : derivedCounts.unknown,
    lastScanAt: status.lastScanAt || guildEntry.lastScanAt || null,
    lastCompletedAt: status.lastCompletedAt || guildEntry.lastCompletedAt || null,
    members: members.slice(0, 500),
    memberCount: members.length,
    history: guildEntry.history.slice(0, 100),
    managedRoleIds: guildEntry.managedRoleIds
  };
};

export const feature = {
  id: 'serverTagTracker',
  name: 'Server-Tag-Tracker',

  async onClientReady({ guild, cfg }) {
    await ensureLedgerLoaded();
    scheduleTracker(guild, cfg);
  },

  async onConfigUpdate({ guild, cfg, patch }) {
    if (!patch || !Object.prototype.hasOwnProperty.call(patch, 'serverTagTracker')) return;
    scheduleTracker(guild, cfg, { immediate: true });
  },

  async onGuildMemberAdd({ guild, member, cfg }) {
    setTimeout(() => void updateSingleMember({
      guild,
      member,
      cfg,
      source: 'guildMemberAdd',
      authoritativeEvent: true,
      authoritativeUser: member?.user
    }).catch(() => {}), 1_500).unref?.();
  },

  async onGuildMemberUpdate({ guild, newMember, cfg }) {
    await updateSingleMember({
      guild,
      member: newMember,
      cfg,
      source: 'guildMemberUpdate',
      authoritativeEvent: true,
      authoritativeUser: newMember?.user
    });
  },

  async onUserUpdate({ guild, newUser, member, cfg }) {
    const currentMember = member || guild.members.cache.get(String(newUser?.id || ''));
    if (!currentMember) return;
    await updateSingleMember({
      guild,
      member: currentMember,
      cfg,
      source: 'userUpdate',
      authoritativeEvent: true,
      authoritativeUser: newUser
    });
  },

  async onGuildMemberRemove({ guild, member }) {
    await ensureLedgerLoaded();
    const guildEntry = ensureGuildLedger(guild.id);
    const userId = String(member?.id || member?.user?.id || '');
    const timerKey = verificationKey(guild.id, userId);
    if (verificationTimers.has(timerKey)) clearTimeout(verificationTimers.get(timerKey));
    verificationTimers.delete(timerKey);
    if (eventRetryTimers.has(timerKey)) clearTimeout(eventRetryTimers.get(timerKey));
    eventRetryTimers.delete(timerKey);
    delete guildEntry.members[userId];
    await persistLedger();
  }
};

export const _serverTagTrackerInternals = {
  calculateServerTagDecision,
  evaluateServerTagState,
  normalizeServerTagTrackerConfig,
  selectInitialObservation,
  MIN_POSITIVE_CONFIRMATION_GAP_MS,
  MIN_NEGATIVE_CONFIRMATION_GAP_MS,
  ASSIGNMENT_SAFETY_WINDOW_MS,
  roleIsManageable,
  memberIsExcluded
};
