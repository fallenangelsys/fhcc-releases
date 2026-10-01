import { ChannelType, EmbedBuilder, PermissionFlagsBits } from 'discord.js';

import { isProtectedPublicCallVoteMessage } from './publicCallVote.js';
import { recordDiagnosticError, runTrackedOperation } from '../runtime/liveDiagnostics.js';

const VOICE_CHANNEL_TYPES = new Set([ChannelType.GuildVoice]);
const BULK_DELETE_MAX_AGE_MS = 14 * 24 * 60 * 60_000;
const BULK_DELETE_SAFETY_MARGIN_MS = 30_000;
const MAX_PAGES_PER_SWEEP = 500;
const MAX_SWEEPS_PER_RUN = 3;
const RETRY_DELAYS_MS = [1_000, 3_000, 8_000];
const INCOMPLETE_RETRY_MS = 5 * 60_000;

const guildConfigs = new Map();
const pendingTimers = new Map();
const activeCleanups = new Map();
const abortVersions = new Map();
const runtimeChannels = new Map();
const guildHistory = new Map();

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const clampNumber = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const uniqueIds = (value) => {
  const rows = Array.isArray(value) ? value : String(value || '').split(/[\r\n,]+/);
  return [...new Set(rows.map((entry) => String(entry || '').trim()).filter(Boolean))];
};

const normalizeVoiceChatCleanerConfig = (conf = {}) => ({
  enabled: conf?.enabled === true,
  channelIds: uniqueIds(conf?.channelIds),
  emptyGraceSeconds: Math.trunc(clampNumber(conf?.emptyGraceSeconds, 60, 10, 3600)),
  cleanupOnStartup: conf?.cleanupOnStartup !== false,
  deletePinned: conf?.deletePinned !== false,
  dryRun: conf?.dryRun === true,
  logChannelId: String(conf?.logChannelId || '').trim()
});

const channelKey = (guildId, channelId) => `${String(guildId || '')}:${String(channelId || '')}`;
const isVoiceChatChannel = (channel) => Boolean(
  channel?.guild
  && VOICE_CHANNEL_TYPES.has(Number(channel.type))
  && channel.isVoiceBased?.()
  && channel.isTextBased?.()
  && channel.messages
);

const isSelectedVoiceChannel = (channel, conf) => Boolean(
  isVoiceChatChannel(channel)
  && conf?.enabled
  && conf.channelIds.includes(String(channel.id || ''))
);

const channelIsEmpty = (channel) => Number(channel?.members?.size || 0) === 0;

const permissionsForBot = (channel) => {
  const me = channel?.guild?.members?.me;
  return me && channel?.permissionsFor?.(me);
};

const missingCleanerPermissions = (channel) => {
  const permissions = permissionsForBot(channel);
  const required = [
    [PermissionFlagsBits.ViewChannel, 'Kanal ansehen'],
    [PermissionFlagsBits.Connect, 'Verbinden'],
    [PermissionFlagsBits.ReadMessageHistory, 'Nachrichtenverlauf anzeigen'],
    [PermissionFlagsBits.ManageMessages, 'Nachrichten verwalten']
  ];
  if (!permissions) return required.map((entry) => entry[1]);
  return required.filter(([permission]) => !permissions.has(permission, false)).map((entry) => entry[1]);
};

const ensureRuntimeChannel = (channel) => {
  const key = channelKey(channel?.guild?.id, channel?.id);
  if (!runtimeChannels.has(key)) {
    runtimeChannels.set(key, {
      guildId: String(channel?.guild?.id || ''),
      channelId: String(channel?.id || ''),
      channelName: String(channel?.name || channel?.id || 'Voice-Channel'),
      state: 'idle',
      detail: 'Wartet darauf, dass der Voice-Channel leer wird.',
      pendingUntil: null,
      lastStartedAt: null,
      lastCompletedAt: null,
      lastDeleted: 0,
      lastBulkDeleted: 0,
      lastIndividuallyDeleted: 0,
      lastSkippedPinned: 0,
      lastFailed: 0,
      totalDeleted: 0,
      lastError: ''
    });
  }
  const status = runtimeChannels.get(key);
  status.channelName = String(channel?.name || status.channelName || channel?.id || 'Voice-Channel');
  return status;
};

const addHistory = (guildId, entry) => {
  const id = String(guildId || '');
  const history = guildHistory.get(id) || [];
  history.unshift({ id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, at: new Date().toISOString(), ...entry });
  guildHistory.set(id, history.slice(0, 50));
};

const currentAbortVersion = (channel) => Number(abortVersions.get(channelKey(channel?.guild?.id, channel?.id)) || 0);

const signalChannelOccupied = (channel) => {
  const key = channelKey(channel?.guild?.id, channel?.id);
  abortVersions.set(key, currentAbortVersion(channel) + 1);
};

const assertStillSafeToDelete = (channel, expectedAbortVersion) => {
  if (!isVoiceChatChannel(channel)) throw Object.assign(new Error('Der ausgewählte Voice-Channel ist nicht mehr verfügbar.'), { code: 'CHANNEL_UNAVAILABLE' });
  if (!channelIsEmpty(channel) || currentAbortVersion(channel) !== expectedAbortVersion) {
    throw Object.assign(new Error('Die Bereinigung wurde abgebrochen, weil wieder jemand im Voice-Channel ist.'), { code: 'VOICE_CHANNEL_OCCUPIED' });
  }
};

const isUnknownMessageError = (error) => Number(error?.code || error?.rawError?.code || 0) === 10008 || Number(error?.status || 0) === 404;

const runWithRetry = async (operation, label) => {
  let lastError = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (isUnknownMessageError(error)) return null;
      lastError = error;
      if (attempt >= RETRY_DELAYS_MS.length) break;
      await wait(RETRY_DELAYS_MS[attempt]);
    }
  }
  throw new Error(`${label}: ${lastError?.message || lastError || 'Unbekannter Discord-Fehler'}`);
};

const partitionMessagesForDeletion = (messages, now = Date.now(), deletePinned = true, guildId = '', channelId = '') => {
  const bulk = [];
  const individual = [];
  const skippedPinned = [];
  const skippedProtected = [];
  const cutoff = now - BULK_DELETE_MAX_AGE_MS + BULK_DELETE_SAFETY_MARGIN_MS;
  for (const message of messages || []) {
    if (!deletePinned && message?.pinned) {
      skippedPinned.push(message);
      continue;
    }
    // Feste Moderations-Panels und laufende Abstimmungen (Public-Call-Moderation)
    // werden nie gelöscht – sie sollen im öffentlichen Call dauerhaft bestehen.
    if (isProtectedPublicCallVoteMessage(guildId, channelId, message?.id)) {
      skippedProtected.push(message);
      continue;
    }
    if (Number(message?.createdTimestamp || 0) > cutoff) bulk.push(message);
    else individual.push(message);
  }
  return { bulk, individual, skippedPinned, skippedProtected };
};

const deleteMessageIndividually = async (channel, message, expectedAbortVersion) => {
  assertStillSafeToDelete(channel, expectedAbortVersion);
  const result = await runWithRetry(
    () => channel.messages.delete(String(message?.id || message)),
    `Nachricht ${String(message?.id || message || '')} konnte nicht gelöscht werden`
  );
  return result === null ? 0 : 1;
};

const deletePage = async ({ channel, messages, conf, expectedAbortVersion }) => {
  const partition = partitionMessagesForDeletion(messages, Date.now(), conf.deletePinned, channel?.guild?.id, channel?.id);
  let bulkDeleted = 0;
  let individuallyDeleted = 0;
  const failures = [];

  if (conf.dryRun) {
    return {
      bulkDeleted: partition.bulk.length,
      individuallyDeleted: partition.individual.length,
      skippedPinned: partition.skippedPinned.length,
      skippedProtected: partition.skippedProtected.length,
      failures
    };
  }

  if (partition.bulk.length >= 2) {
    assertStillSafeToDelete(channel, expectedAbortVersion);
    try {
      const deleted = await runWithRetry(
        () => channel.bulkDelete(partition.bulk.map((message) => message.id), true),
        'Junge Nachrichten konnten nicht gesammelt gelöscht werden'
      );
      bulkDeleted += Number(deleted?.size || partition.bulk.length);
    } catch (error) {
      // Fällt die Sammellöschung aus, werden die Nachrichten einzeln versucht.
      for (const message of partition.bulk) {
        try {
          individuallyDeleted += await deleteMessageIndividually(channel, message, expectedAbortVersion);
        } catch (individualError) {
          failures.push({ messageId: String(message.id || ''), error: individualError?.message || String(individualError) });
        }
      }
    }
  } else if (partition.bulk.length === 1) {
    try {
      individuallyDeleted += await deleteMessageIndividually(channel, partition.bulk[0], expectedAbortVersion);
    } catch (error) {
      failures.push({ messageId: String(partition.bulk[0]?.id || ''), error: error?.message || String(error) });
    }
  }

  for (const message of partition.individual) {
    try {
      individuallyDeleted += await deleteMessageIndividually(channel, message, expectedAbortVersion);
    } catch (error) {
      if (error?.code === 'VOICE_CHANNEL_OCCUPIED') throw error;
      failures.push({ messageId: String(message?.id || ''), error: error?.message || String(error) });
    }
  }

  return {
    bulkDeleted,
    individuallyDeleted,
    skippedPinned: partition.skippedPinned.length,
    skippedProtected: partition.skippedProtected.length,
    failures
  };
};

const fetchMessagePage = async (channel, before) => {
  const options = { limit: 100, cache: false };
  if (before) options.before = before;
  return runWithRetry(() => channel.messages.fetch(options), 'Nachrichtenverlauf konnte nicht geladen werden');
};

const purgeVoiceChat = async ({ channel, conf, status, expectedAbortVersion }) => {
  const result = {
    scanned: 0,
    deleted: 0,
    bulkDeleted: 0,
    individuallyDeleted: 0,
    skippedPinned: 0,
    skippedProtected: 0,
    failed: 0,
    failures: [],
    complete: true
  };

  for (let sweep = 0; sweep < MAX_SWEEPS_PER_RUN; sweep += 1) {
    let before = null;
    let pages = 0;
    let foundDeletable = false;

    while (pages < MAX_PAGES_PER_SWEEP) {
      assertStillSafeToDelete(channel, expectedAbortVersion);
      const fetched = await fetchMessagePage(channel, before);
      const rows = [...(fetched?.values?.() || [])]
        .sort((left, right) => Number(right.createdTimestamp || 0) - Number(left.createdTimestamp || 0));
      if (!rows.length) break;

      pages += 1;
      result.scanned += rows.length;
      const oldest = rows[rows.length - 1];
      before = String(oldest?.id || '');
      const page = await deletePage({ channel, messages: rows, conf, expectedAbortVersion });
      const deleted = page.bulkDeleted + page.individuallyDeleted;
      result.bulkDeleted += page.bulkDeleted;
      result.individuallyDeleted += page.individuallyDeleted;
      result.deleted += deleted;
      result.skippedPinned += page.skippedPinned;
      result.skippedProtected += page.skippedProtected || 0;
      result.failed += page.failures.length;
      result.failures.push(...page.failures.slice(0, Math.max(0, 25 - result.failures.length)));
      foundDeletable ||= deleted > 0 || (conf.dryRun && (page.bulkDeleted + page.individuallyDeleted) > 0);

      Object.assign(status, {
        detail: conf.dryRun
          ? `${result.scanned.toLocaleString('de-DE')} Nachrichten geprüft – es wird nichts gelöscht.`
          : `${result.deleted.toLocaleString('de-DE')} Nachrichten entfernt – ältere Historie wird weiter geprüft.`,
        lastDeleted: result.deleted,
        lastBulkDeleted: result.bulkDeleted,
        lastIndividuallyDeleted: result.individuallyDeleted,
        lastSkippedPinned: result.skippedPinned,
        lastFailed: result.failed
      });

      if (rows.length < 100) break;
    }

    if (pages >= MAX_PAGES_PER_SWEEP) {
      result.complete = false;
      break;
    }
    if (conf.dryRun || !conf.deletePinned || !foundDeletable) break;

    assertStillSafeToDelete(channel, expectedAbortVersion);
    const remaining = await fetchMessagePage(channel, null);
    if (!remaining?.size) break;
    if (sweep === MAX_SWEEPS_PER_RUN - 1) result.complete = false;
  }

  if (result.failed > 0) result.complete = false;
  return result;
};

const sendCleanerLog = async (channel, conf, result, durationMs) => {
  if (!conf.logChannelId) return;
  const logChannel = channel.guild.channels.cache.get(conf.logChannelId)
    || await channel.guild.channels.fetch(conf.logChannelId).catch(() => null);
  if (!logChannel?.isTextBased?.() || typeof logChannel.send !== 'function') return;

  const embed = new EmbedBuilder()
    .setColor(result.failed ? 0xff667c : conf.dryRun ? 0xf5c869 : 0x3ddc97)
    .setTitle(conf.dryRun ? 'Voice-Chat-Prüfung abgeschlossen' : 'Voice-Chat vollständig bereinigt')
    .setDescription(`Der Textchat von **${channel.name || channel.id}** wurde verarbeitet.`)
    .addFields(
      { name: conf.dryRun ? 'Löschbar' : 'Gelöscht', value: String(result.deleted), inline: true },
      { name: 'Davon einzeln', value: String(result.individuallyDeleted), inline: true },
      { name: 'Fehler', value: String(result.failed), inline: true },
      { name: 'Dauer', value: `${Math.max(1, Math.round(durationMs / 1000))} Sek.`, inline: true },
      { name: 'Vollständig', value: result.complete ? 'Ja' : 'Fortsetzung vorgemerkt', inline: true },
      { name: 'Angepinnte geschützt', value: String(result.skippedPinned), inline: true }
    )
    .setFooter({ text: 'Keine Nachrichteninhalte wurden im Protokoll gespeichert.' })
    .setTimestamp(new Date());
  await logChannel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
};

const scheduleIncompleteRetry = (channel, conf) => {
  const timer = setTimeout(() => {
    const latest = guildConfigs.get(String(channel.guild.id)) || conf;
    if (!isSelectedVoiceChannel(channel, latest) || !channelIsEmpty(channel)) return;
    scheduleCleanup(channel, latest, 'retry', { delayMs: 1_000, replace: true });
  }, INCOMPLETE_RETRY_MS);
  timer.unref?.();
};

const runCleanup = async (channel, conf, source = 'voiceEmpty') => {
  const key = channelKey(channel?.guild?.id, channel?.id);
  if (activeCleanups.has(key)) return activeCleanups.get(key);
  if (!isSelectedVoiceChannel(channel, conf) || !channelIsEmpty(channel)) return { skipped: true, reason: 'not-empty-or-disabled' };

  const status = ensureRuntimeChannel(channel);
  const expectedAbortVersion = currentAbortVersion(channel);
  const startedAt = Date.now();
  Object.assign(status, {
    state: 'cleaning',
    detail: conf.dryRun ? 'Sicherer Prüfmodus läuft …' : 'Nachrichten werden vollständig und seitenweise entfernt …',
    pendingUntil: null,
    lastStartedAt: new Date(startedAt).toISOString(),
    lastError: '',
    lastDeleted: 0,
    lastBulkDeleted: 0,
    lastIndividuallyDeleted: 0,
    lastSkippedPinned: 0,
    lastFailed: 0
  });

  const operation = runTrackedOperation('Voice-Chat-Cleaner', {
    featureId: 'voiceChatCleaner',
    hook: source,
    guildId: channel.guild.id,
    channelId: channel.id
  }, async () => {
    const missing = missingCleanerPermissions(channel);
    if (missing.length) throw new Error(`Dem Bot fehlen im Voice-Channel: ${missing.join(', ')}.`);
    assertStillSafeToDelete(channel, expectedAbortVersion);
    const result = await purgeVoiceChat({ channel, conf, status, expectedAbortVersion });
    const durationMs = Date.now() - startedAt;
    Object.assign(status, {
      state: conf.dryRun ? 'preview' : result.complete ? 'completed' : 'incomplete',
      detail: conf.dryRun
        ? `${result.deleted.toLocaleString('de-DE')} Nachrichten wären löschbar.`
        : result.complete
          ? `${result.deleted.toLocaleString('de-DE')} Nachrichten wurden entfernt. Der Voice-Chat ist leer.`
          : `${result.deleted.toLocaleString('de-DE')} Nachrichten entfernt; die Fortsetzung ist vorgemerkt.`,
      lastCompletedAt: new Date().toISOString(),
      lastDeleted: result.deleted,
      lastBulkDeleted: result.bulkDeleted,
      lastIndividuallyDeleted: result.individuallyDeleted,
      lastSkippedPinned: result.skippedPinned,
      lastFailed: result.failed,
      totalDeleted: Number(status.totalDeleted || 0) + (conf.dryRun ? 0 : result.deleted),
      lastError: result.failures[0]?.error || ''
    });
    addHistory(channel.guild.id, {
      channelId: channel.id,
      channelName: channel.name || channel.id,
      action: conf.dryRun ? 'preview' : result.complete ? 'cleared' : 'incomplete',
      deleted: result.deleted,
      failed: result.failed,
      durationMs,
      source
    });
    await sendCleanerLog(channel, conf, result, durationMs);
    if (!result.complete && channelIsEmpty(channel)) scheduleIncompleteRetry(channel, conf);
    return result;
  }, { timeoutMs: 60 * 60_000 })
    .catch((error) => {
      const occupied = error?.code === 'VOICE_CHANNEL_OCCUPIED';
      Object.assign(status, {
        state: occupied ? 'cancelled' : 'error',
        detail: occupied ? 'Abgebrochen: Der Voice-Channel wird wieder benutzt.' : 'Bereinigung fehlgeschlagen.',
        pendingUntil: null,
        lastCompletedAt: new Date().toISOString(),
        lastError: occupied ? '' : String(error?.message || error).slice(0, 500)
      });
      if (!occupied) {
        addHistory(channel.guild.id, {
          channelId: channel.id,
          channelName: channel.name || channel.id,
          action: 'error',
          deleted: Number(status.lastDeleted || 0),
          failed: Math.max(1, Number(status.lastFailed || 0)),
          source,
          error: status.lastError
        });
        recordDiagnosticError('voiceChatCleaner.cleanup', error, { guildId: channel.guild.id, channelId: channel.id, source });
      }
      return { skipped: occupied, error: occupied ? '' : status.lastError };
    })
    .finally(() => activeCleanups.delete(key));

  activeCleanups.set(key, operation);
  return operation;
};

function cancelPendingCleanup(channel, detail = 'Voice-Channel wird wieder benutzt.') {
  const key = channelKey(channel?.guild?.id, channel?.id);
  const entry = pendingTimers.get(key);
  if (entry?.timer) clearTimeout(entry.timer);
  pendingTimers.delete(key);
  signalChannelOccupied(channel);
  const status = ensureRuntimeChannel(channel);
  if (status.state === 'waiting' || status.state === 'cleaning') {
    Object.assign(status, { state: 'cancelled', detail, pendingUntil: null });
  }
}

function scheduleCleanup(channel, conf, source = 'voiceEmpty', options = {}) {
  if (!isSelectedVoiceChannel(channel, conf) || !channelIsEmpty(channel)) return false;
  const key = channelKey(channel.guild.id, channel.id);
  if (pendingTimers.has(key) && !options.replace) return true;
  if (pendingTimers.has(key)) clearTimeout(pendingTimers.get(key)?.timer);
  const delayMs = Math.max(1_000, Number(options.delayMs || conf.emptyGraceSeconds * 1000));
  const pendingUntil = new Date(Date.now() + delayMs).toISOString();
  const status = ensureRuntimeChannel(channel);
  Object.assign(status, {
    state: 'waiting',
    detail: `Voice-Channel ist leer. Sicherheitsfrist: ${Math.ceil(delayMs / 1000)} Sekunden.`,
    pendingUntil,
    lastError: ''
  });
  const timer = setTimeout(() => {
    pendingTimers.delete(key);
    const latest = guildConfigs.get(String(channel.guild.id)) || conf;
    if (!isSelectedVoiceChannel(channel, latest) || !channelIsEmpty(channel)) {
      cancelPendingCleanup(channel);
      return;
    }
    void runCleanup(channel, latest, source);
  }, delayMs);
  timer.unref?.();
  pendingTimers.set(key, { timer, pendingUntil, source });
  return true;
}

const clearGuildTimers = (guildId) => {
  const prefix = `${String(guildId)}:`;
  for (const [key, entry] of pendingTimers) {
    if (!key.startsWith(prefix)) continue;
    if (entry?.timer) clearTimeout(entry.timer);
    pendingTimers.delete(key);
  }
};

const configureGuild = (guild, cfg, { startup = false } = {}) => {
  const conf = normalizeVoiceChatCleanerConfig(cfg?.voiceChatCleaner);
  guildConfigs.set(String(guild.id), conf);
  clearGuildTimers(guild.id);
  const prefix = `${String(guild.id)}:`;
  for (const [key, status] of runtimeChannels) {
    if (!key.startsWith(prefix)) continue;
    if (conf.enabled && conf.channelIds.includes(status.channelId)) continue;
    abortVersions.set(key, Number(abortVersions.get(key) || 0) + 1);
    Object.assign(status, {
      state: conf.enabled ? 'idle' : 'disabled',
      detail: conf.enabled ? 'Dieser Voice-Channel ist nicht mehr ausgewählt.' : 'Voice-Chat-Cleaner ist deaktiviert.',
      pendingUntil: null
    });
  }
  if (!conf.enabled || !conf.channelIds.length) return;
  if (startup && !conf.cleanupOnStartup) return;

  const initialDelayMs = startup ? 8_000 : 1_500;
  const timer = setTimeout(async () => {
    const latest = guildConfigs.get(String(guild.id)) || conf;
    if (!latest.enabled || !latest.channelIds.length) return;
    for (const channelId of latest.channelIds) {
      const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
      if (!isSelectedVoiceChannel(channel, latest)) continue;
      ensureRuntimeChannel(channel);
      if (channelIsEmpty(channel)) scheduleCleanup(channel, latest, startup ? 'startup' : 'configUpdate');
    }
  }, initialDelayMs);
  timer.unref?.();
};

export const getVoiceChatCleanerSnapshot = (guildId) => {
  const id = String(guildId || '');
  const conf = guildConfigs.get(id) || normalizeVoiceChatCleanerConfig();
  const channels = [...runtimeChannels.values()]
    .filter((entry) => entry.guildId === id && conf.channelIds.includes(entry.channelId))
    .sort((left, right) => left.channelName.localeCompare(right.channelName, 'de', { sensitivity: 'base' }));
  return {
    enabled: conf.enabled,
    dryRun: conf.dryRun,
    deletePinned: conf.deletePinned,
    emptyGraceSeconds: conf.emptyGraceSeconds,
    selectedChannelCount: conf.channelIds.length,
    pendingCount: channels.filter((entry) => entry.state === 'waiting').length,
    cleaningCount: channels.filter((entry) => entry.state === 'cleaning').length,
    totalDeleted: channels.reduce((sum, entry) => sum + Number(entry.totalDeleted || 0), 0),
    channels,
    history: guildHistory.get(id) || []
  };
};

export const feature = {
  id: 'voiceChatCleaner',
  name: 'Voice-Chat-Cleaner',

  async onClientReady({ guild, cfg }) {
    configureGuild(guild, cfg, { startup: true });
  },

  async onConfigUpdate({ guild, cfg, patch }) {
    if (!patch || !Object.prototype.hasOwnProperty.call(patch, 'voiceChatCleaner')) return;
    configureGuild(guild, cfg, { startup: false });
  },

  async onVoiceStateUpdate({ oldState, newState, cfg }) {
    const guild = newState?.guild || oldState?.guild;
    if (!guild) return;
    const conf = normalizeVoiceChatCleanerConfig(cfg?.voiceChatCleaner);
    guildConfigs.set(String(guild.id), conf);
    const oldChannelId = String(oldState?.channelId || '');
    const newChannelId = String(newState?.channelId || '');
    if (oldChannelId === newChannelId) return;

    if (newChannelId && conf.channelIds.includes(newChannelId)) {
      const joined = newState.channel || guild.channels.cache.get(newChannelId);
      if (joined && !channelIsEmpty(joined)) cancelPendingCleanup(joined);
    }

    if (oldChannelId && conf.channelIds.includes(oldChannelId)) {
      const left = oldState.channel || guild.channels.cache.get(oldChannelId);
      if (left && channelIsEmpty(left)) scheduleCleanup(left, conf, 'voiceEmpty');
    }
  }
};

export const _voiceChatCleanerInternals = {
  normalizeVoiceChatCleanerConfig,
  isVoiceChatChannel,
  isSelectedVoiceChannel,
  channelIsEmpty,
  missingCleanerPermissions,
  partitionMessagesForDeletion,
  deletePage,
  purgeVoiceChat,
  BULK_DELETE_MAX_AGE_MS,
  BULK_DELETE_SAFETY_MARGIN_MS
};
