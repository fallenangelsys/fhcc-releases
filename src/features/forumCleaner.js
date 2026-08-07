import { ChannelType, EmbedBuilder, PermissionFlagsBits } from 'discord.js';

import { recordDiagnosticError, runTrackedOperation } from '../runtime/liveDiagnostics.js';

const FORUM_PARENT_TYPES = new Set([ChannelType.GuildForum, ChannelType.GuildMedia]);
const THREAD_TYPES = new Set([ChannelType.PublicThread, ChannelType.AnnouncementThread]);
const periodicTimers = new Map();
const pendingThreadTimers = new Map();
const pendingMemberLeaveTimers = new Map();
const guildConfigs = new Map();
const guildReferences = new Map();
const dryRunReports = new Map();
const scanPromises = new Map();
const scanStates = new Map();
const BULK_SCAN_SOURCES = new Set(['startupScan', 'periodicDeepScan', 'manualDashboard', 'memberLeftDeepScan']);

const clampNumber = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const uniqueIds = (value) => {
  const rows = Array.isArray(value) ? value : String(value || '').split(/[\r\n,]+/);
  return [...new Set(rows.map((entry) => String(entry || '').trim()).filter(Boolean))];
};

const normalizeForumCleanerConfig = (conf = {}) => ({
  enabled: conf?.enabled === true,
  channelIds: uniqueIds(conf?.channelIds),
  graceMinutes: clampNumber(conf?.graceMinutes, 10, 1, 1440),
  scanIntervalMinutes: clampNumber(conf?.scanIntervalMinutes, 1440, 60, 1440),
  scanOnStartup: conf?.scanOnStartup !== false,
  includeArchived: conf?.includeArchived !== false,
  ignorePinned: conf?.ignorePinned !== false,
  ignoreLocked: conf?.ignoreLocked !== false,
  requireNoReplies: conf?.requireNoReplies !== false,
  titleOnlyIsEmpty: conf?.titleOnlyIsEmpty !== false,
  deleteMissingStarter: conf?.deleteMissingStarter !== false,
  deleteLeftAuthorPosts: conf?.deleteLeftAuthorPosts === true,
  protectPinnedFromDepartedAuthors: conf?.protectPinnedFromDepartedAuthors === true,
  protectLockedFromDepartedAuthors: conf?.protectLockedFromDepartedAuthors === true,
  leftAuthorGraceDays: Math.trunc(clampNumber(conf?.leftAuthorGraceDays, 0, 0, 3650)),
  dryRun: conf?.dryRun === true,
  logChannelId: String(conf?.logChannelId || '').trim()
});

const makeScanState = (guildId, previous = {}) => ({
  guildId: String(guildId || ''),
  running: false,
  source: '',
  startedAt: null,
  completedAt: previous.completedAt || null,
  currentForumId: null,
  currentForumName: null,
  selectedForumCount: 0,
  processedForumCount: 0,
  discoveredThreads: 0,
  checkedThreads: 0,
  deletedThreads: 0,
  deletedDepartedAuthors: 0,
  deletedEmptyPosts: 0,
  unknownMembers: 0,
  protectedPosts: 0,
  errors: 0,
  lastError: '',
  history: Array.isArray(previous.history) ? previous.history.slice(0, 20) : []
});

const threadTimerKey = (thread) => `${String(thread?.guild?.id || '')}:${String(thread?.id || '')}`;
const isForumParent = (channel) => FORUM_PARENT_TYPES.has(Number(channel?.type));
const isForumThread = (thread) => {
  if (!thread?.guild || !THREAD_TYPES.has(Number(thread.type)) || !thread.isThread?.()) return false;
  return isForumParent(thread.parent);
};
const isSelectedForumThread = (thread, conf) => {
  if (!isForumThread(thread) || !conf?.enabled || !conf.channelIds.length) return false;
  return conf.channelIds.includes(String(thread.parentId || thread.parent?.id || ''));
};

const hasPermission = (channel, permission) => {
  const me = channel?.guild?.members?.me;
  const permissions = me && channel?.permissionsFor?.(me);
  return Boolean(permissions?.has?.(permission, false));
};

const canInspectThread = (thread) => hasPermission(thread, PermissionFlagsBits.ViewChannel)
  && hasPermission(thread, PermissionFlagsBits.ReadMessageHistory);

const canDeleteThread = (thread) => Boolean(thread?.manageable)
  || hasPermission(thread, PermissionFlagsBits.ManageThreads)
  || hasPermission(thread?.parent, PermissionFlagsBits.ManageThreads);

const messageHasMeaning = (message) => {
  if (!message) return false;
  const text = String(message.content || message.cleanContent || message.systemContent || '').replace(/\s+/g, '').trim();
  return Boolean(
    text
    || Number(message.attachments?.size || 0) > 0
    || Number(message.embeds?.length || 0) > 0
    || Number(message.stickers?.size || 0) > 0
    || Number(message.components?.length || 0) > 0
    || message.poll
  );
};

const threadIsPinned = (thread) => {
  try {
    return Boolean(thread?.flags?.has?.('Pinned') || (Number(thread?.flags?.bitfield || 0) & 2));
  } catch {
    return false;
  }
};

const realReplyCount = (messages, starterMessageId) => [...(messages?.values?.() || [])].filter((message) => {
  if (!message || String(message.id || '') === String(starterMessageId || '')) return false;
  if (message.system) return false;
  return messageHasMeaning(message);
}).length;

const discordErrorCode = (error) => Number(error?.rawError?.code ?? error?.code ?? error?.data?.code ?? 0);
const isUnknownMemberError = (error) => discordErrorCode(error) === 10007;
const isUnknownMessageError = (error) => discordErrorCode(error) === 10008;

const classifyMemberPresence = async (guild, userId, cache = new Map()) => {
  const id = String(userId || '').trim();
  if (!id) return { state: 'unknown', reason: 'missing-user-id' };
  if (cache.has(id)) return cache.get(id);
  if (guild.members.cache.has(id)) {
    const result = { state: 'present', source: 'cache' };
    cache.set(id, result);
    return result;
  }
  try {
    const member = await guild.members.fetch({ user: id, force: true, cache: true });
    const result = member ? { state: 'present', source: 'discord' } : { state: 'unknown', reason: 'empty-response' };
    cache.set(id, result);
    return result;
  } catch (error) {
    const result = isUnknownMemberError(error)
      ? { state: 'departed', source: 'discord-unknown-member' }
      : { state: 'unknown', reason: String(error?.message || error || 'Discord-Abfrage fehlgeschlagen.').slice(0, 240) };
    cache.set(id, result);
    return result;
  }
};

const fetchStarterSafely = async (thread) => {
  try {
    const starter = await thread.fetchStarterMessage({ cache: true, force: true });
    return { state: starter ? 'present' : 'missing', starter: starter || null };
  } catch (error) {
    if (isUnknownMessageError(error)) return { state: 'missing', starter: null };
    return { state: 'unknown', starter: null, error };
  }
};

const findMeaningfulReply = async (thread, starterMessageId) => {
  let before;
  let pages = 0;
  const seen = new Set();
  while (pages < 10_000) {
    const page = await thread.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    const rows = [...page.values()];
    const replies = realReplyCount(page, starterMessageId);
    if (replies > 0) return { replies, pages: pages + 1 };
    if (rows.length < 100) return { replies: 0, pages: pages + 1 };
    const oldest = rows[rows.length - 1];
    const cursor = String(oldest?.id || '');
    if (!cursor || seen.has(cursor)) throw new Error('Nachrichten-Pagination hat keinen Fortschritt gemacht.');
    seen.add(cursor);
    before = cursor;
    pages += 1;
  }
  throw new Error('Nachrichten-Pagination hat das Sicherheitslimit erreicht.');
};

const sendLog = async (guild, conf, embed) => {
  if (!conf?.logChannelId) return;
  const channel = guild.channels.cache.get(conf.logChannelId)
    || await guild.channels.fetch(conf.logChannelId).catch(() => null);
  if (!channel?.isTextBased?.() || typeof channel.send !== 'function') return;
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
};

const buildLogEmbed = ({ thread, conf, action, reason, starter, replies }) => {
  const parentName = thread.parent?.name || thread.parentId || 'Forum';
  const deleted = action === 'deleted';
  const embed = new EmbedBuilder()
    .setColor(deleted ? 0xff5f6d : 0xffbd59)
    .setTitle(deleted ? 'Forum-Post gelöscht' : 'Forum-Post zur Löschung erkannt')
    .setDescription(`**${thread.name || thread.id}** in #${parentName}`)
    .addFields(
      { name: 'Grund', value: String(reason || 'Post erfüllt die Cleaner-Regel.').slice(0, 1024), inline: false },
      { name: 'Antworten', value: String(replies || 0), inline: true },
      { name: 'Modus', value: conf.dryRun ? 'Prüfmodus' : 'Automatisch gelöscht', inline: true }
    )
    .setTimestamp(new Date());

  if (thread.url) embed.setURL(thread.url);
  if (starter?.author) embed.addFields({ name: 'Ersteller', value: `${starter.author.tag || starter.author.username || starter.author.id} (${starter.author.id})`, inline: false });
  return embed;
};

const deleteThreadWithAudit = async ({ thread, conf, reason, reasonCode, starter = null, replies = 0, source = 'scan' }) => {
  if (!conf.dryRun && !canDeleteThread(thread)) return { checked: true, deleted: false, reason: 'missing-delete-permission', replies };
  if (conf.dryRun) {
    const key = `${thread.guild.id}:${thread.id}:${reasonCode}`;
    const last = Number(dryRunReports.get(key) || 0);
    if (Date.now() - last > 6 * 60 * 60_000) {
      dryRunReports.set(key, Date.now());
      if (!BULK_SCAN_SOURCES.has(source)) await sendLog(thread.guild, conf, buildLogEmbed({ thread, conf, action: 'would-delete', reason, starter, replies }));
    }
    return { checked: true, deleted: false, reason: 'dry-run', candidateReason: reasonCode, replies };
  }

  if (!BULK_SCAN_SOURCES.has(source)) await sendLog(thread.guild, conf, buildLogEmbed({ thread, conf, action: 'deleted', reason, starter, replies }));
  await thread.delete(`FALLEN HEAVEN Forum-Cleaner: ${reason}`).catch((error) => {
    throw new Error(`Forum-Post konnte nicht gelöscht werden: ${error?.message || error}`);
  });
  return { checked: true, deleted: true, reason: reasonCode, replies, source };
};

const deleteIfEmpty = async (thread, conf, source = 'event', context = {}) => {
  if (!isSelectedForumThread(thread, conf)) return { checked: false, reason: 'not-selected' };

  const fresh = await thread.guild.channels.fetch(thread.id).catch(() => thread);
  if (!fresh || !isSelectedForumThread(fresh, conf)) return { checked: false, reason: 'missing' };
  if (fresh.archived && !conf.includeArchived) return { checked: true, deleted: false, reason: 'archived' };
  if (!canInspectThread(fresh)) return { checked: true, deleted: false, reason: 'missing-read-permission' };

  const starterResult = await fetchStarterSafely(fresh);
  const starter = starterResult.starter;
  const createdAt = Number(fresh.createdTimestamp || starter?.createdTimestamp || 0);
  const ageMs = createdAt > 0 ? Date.now() - createdAt : Number.POSITIVE_INFINITY;
  const memberCache = context.memberCache || new Map();
  const ownerId = String(starter?.author?.id || fresh.ownerId || '').trim();

  if (conf.deleteLeftAuthorPosts && ownerId) {
    const leftGraceMs = conf.leftAuthorGraceDays * 24 * 60 * 60_000;
    if (ageMs >= leftGraceMs) {
      const presence = await classifyMemberPresence(fresh.guild, ownerId, memberCache);
      if (presence.state === 'departed') {
        if (conf.protectPinnedFromDepartedAuthors && threadIsPinned(fresh)) return { checked: true, deleted: false, reason: 'departed-author-pinned' };
        if (conf.protectLockedFromDepartedAuthors && fresh.locked) return { checked: true, deleted: false, reason: 'departed-author-locked' };
        return deleteThreadWithAudit({
          thread: fresh,
          conf,
          reason: `Der Ersteller (${ownerId}) ist laut Discord nicht mehr auf dem Server.`,
          reasonCode: 'author-left',
          starter,
          source
        });
      }
      if (presence.state === 'unknown') {
        return { checked: true, deleted: false, reason: 'member-status-unknown', memberStatus: presence };
      }
    }
  }

  if (conf.ignoreLocked && fresh.locked) return { checked: true, deleted: false, reason: 'locked' };
  if (conf.ignorePinned && threadIsPinned(fresh)) return { checked: true, deleted: false, reason: 'pinned' };

  const graceMs = conf.graceMinutes * 60_000;
  if (ageMs < graceMs) {
    scheduleThreadCheck(fresh, conf, 'grace');
    return { checked: true, deleted: false, reason: 'grace' };
  }

  if (starterResult.state === 'unknown') {
    return { checked: true, deleted: false, reason: 'starter-status-unknown' };
  }
  if (starterResult.state === 'missing') {
    if (!conf.deleteMissingStarter) return { checked: true, deleted: false, reason: 'starter-unavailable' };
    return deleteThreadWithAudit({
      thread: fresh,
      conf,
      reason: 'Die ursprüngliche Startnachricht wurde gelöscht.',
      reasonCode: 'missing-starter',
      source
    });
  }

  const titleIsEnough = conf.titleOnlyIsEmpty === false && String(fresh.name || '').replace(/\s+/g, '').trim().length > 0;
  if (messageHasMeaning(starter) || titleIsEnough) return { checked: true, deleted: false, reason: 'has-content' };

  let replies = 0;
  if (conf.requireNoReplies) {
    try {
      const result = await findMeaningfulReply(fresh, starter.id || fresh.id);
      replies = result.replies;
    } catch (error) {
      return { checked: true, deleted: false, reason: 'reply-status-unknown', error };
    }
    if (replies > 0) return { checked: true, deleted: false, reason: 'has-replies', replies };
  }

  return deleteThreadWithAudit({
    thread: fresh,
    conf,
    reason: 'Startpost hat keinen Inhalt, keine Medien und keine Antworten.',
    reasonCode: 'empty-post',
    starter,
    replies,
    source
  });
};

function scheduleThreadCheck(thread, conf, reason = 'event') {
  if (!thread?.guild?.id || !thread?.id || !isSelectedForumThread(thread, conf)) return;
  const key = threadTimerKey(thread);
  const existing = pendingThreadTimers.get(key);
  if (existing) clearTimeout(existing);
  const createdAt = Number(thread.createdTimestamp || 0);
  const graceMs = conf.graceMinutes * 60_000;
  const remainingMs = createdAt > 0 ? Math.max(5_000, graceMs - (Date.now() - createdAt) + 1_500) : 10_000;
  const timer = setTimeout(() => {
    pendingThreadTimers.delete(key);
    const currentConf = guildConfigs.get(String(thread.guild.id)) || conf;
    void deleteIfEmpty(thread, currentConf, reason, { memberCache: new Map() }).catch((error) => {
      recordDiagnosticError('forumCleaner.threadCheck', error, { guildId: thread.guild.id, channelId: thread.id });
      console.warn(`[forumCleaner] Thread-Prüfung fehlgeschlagen: ${error?.message || error}`);
    });
  }, Math.min(remainingMs, 24 * 60 * 60_000));
  timer.unref?.();
  pendingThreadTimers.set(key, timer);
}

const clearPendingGuildChecks = (guildId) => {
  const prefix = `${String(guildId)}:`;
  for (const [key, timer] of pendingThreadTimers) {
    if (!key.startsWith(prefix)) continue;
    clearTimeout(timer);
    pendingThreadTimers.delete(key);
  }
};

const collectForumThreads = async (parent, conf, onProgress = () => {}) => {
  const threads = new Map();
  const add = (thread) => {
    if (thread?.id && String(thread.parentId || '') === String(parent.id)) threads.set(thread.id, thread);
  };

  for (const thread of parent.threads?.cache?.values?.() || []) add(thread);
  const active = await parent.threads.fetchActive(true);
  for (const thread of active?.threads?.values?.() || []) add(thread);
  onProgress({ phase: 'active', discovered: threads.size });

  if (conf.includeArchived) {
    let before;
    let page = 0;
    const seenCursors = new Set();
    while (page < 10_000) {
      const archived = await parent.threads.fetchArchived({ type: 'public', limit: 100, ...(before ? { before } : {}) }, true);
      const rows = [...(archived?.threads?.values?.() || [])];
      rows.forEach(add);
      page += 1;
      onProgress({ phase: 'archived', page, discovered: threads.size });
      if (!archived?.hasMore || !rows.length) break;
      const oldest = rows.reduce((candidate, thread) => {
        const stamp = Number(thread?.archiveTimestamp || thread?.archivedAt?.getTime?.() || 0);
        const current = Number(candidate?.archiveTimestamp || candidate?.archivedAt?.getTime?.() || Number.POSITIVE_INFINITY);
        return stamp > 0 && stamp < current ? thread : candidate;
      }, null) || rows[rows.length - 1];
      const stamp = Number(oldest?.archiveTimestamp || oldest?.archivedAt?.getTime?.() || 0);
      if (!stamp || seenCursors.has(stamp)) throw new Error('Archiv-Pagination hat keinen Fortschritt gemacht.');
      seenCursors.add(stamp);
      before = new Date(stamp);
    }
    if (page >= 10_000) throw new Error('Archiv-Pagination hat das Sicherheitslimit erreicht.');
  }

  return [...threads.values()].sort((left, right) => Number(right.createdTimestamp || 0) - Number(left.createdTimestamp || 0));
};

const classifyScanResult = (state, result) => {
  if (!result?.checked) return;
  state.checkedThreads += 1;
  if (result.deleted) {
    state.deletedThreads += 1;
    if (result.reason === 'author-left') state.deletedDepartedAuthors += 1;
    else state.deletedEmptyPosts += 1;
  }
  if (result.reason === 'member-status-unknown') state.unknownMembers += 1;
  if (['pinned', 'locked', 'departed-author-pinned', 'departed-author-locked'].includes(result.reason)) state.protectedPosts += 1;
  if (['error', 'starter-status-unknown', 'reply-status-unknown', 'missing-read-permission', 'missing-delete-permission'].includes(result.reason)) state.errors += 1;
};

const scanGuildForums = async (guild, conf, source = 'scan') => {
  if (!guild || !conf?.enabled || !conf.channelIds.length) return { checkedThreads: 0, deletedThreads: 0, skipped: 'disabled' };
  const guildId = String(guild.id);
  const previous = scanStates.get(guildId) || {};
  const state = makeScanState(guildId, previous);
  state.running = true;
  state.source = source;
  state.startedAt = new Date().toISOString();
  state.selectedForumCount = conf.channelIds.length;
  scanStates.set(guildId, state);
  const memberCache = new Map();

  try {
    for (const channelId of conf.channelIds) {
      const parent = guild.channels.cache.get(String(channelId))
        || await guild.channels.fetch(String(channelId)).catch(() => null);
      state.currentForumId = String(channelId);
      state.currentForumName = parent?.name || String(channelId);
      if (!isForumParent(parent)) {
        state.errors += 1;
        state.processedForumCount += 1;
        continue;
      }
      if (!hasPermission(parent, PermissionFlagsBits.ViewChannel) || !hasPermission(parent, PermissionFlagsBits.ReadMessageHistory)) {
        state.errors += 1;
        state.processedForumCount += 1;
        continue;
      }
      let threads;
      const discoveredBeforeForum = state.discoveredThreads;
      try {
        threads = await collectForumThreads(parent, conf, ({ discovered }) => {
          state.discoveredThreads = Math.max(state.discoveredThreads, discoveredBeforeForum + Number(discovered || 0));
        });
      } catch (error) {
        state.errors += 1;
        state.lastError = String(error?.message || error).slice(0, 300);
        recordDiagnosticError('forumCleaner.collectThreads', error, { guildId: guild.id, channelId: parent.id });
        state.processedForumCount += 1;
        continue;
      }
      state.discoveredThreads = discoveredBeforeForum + threads.length;
      for (const thread of threads) {
        const result = await deleteIfEmpty(thread, conf, source, { memberCache }).catch((error) => {
          recordDiagnosticError('forumCleaner.scanThread', error, { guildId: guild.id, channelId: thread.id });
          state.lastError = String(error?.message || error).slice(0, 300);
          return { checked: true, deleted: false, reason: 'error' };
        });
        classifyScanResult(state, result);
      }
      state.processedForumCount += 1;
    }
  } finally {
    state.running = false;
    state.currentForumId = null;
    state.currentForumName = null;
    state.completedAt = new Date().toISOString();
    state.history.unshift({
      at: state.completedAt,
      source,
      forums: state.processedForumCount,
      discovered: state.discoveredThreads,
      checked: state.checkedThreads,
      deleted: state.deletedThreads,
      departed: state.deletedDepartedAuthors,
      empty: state.deletedEmptyPosts,
      unknownMembers: state.unknownMembers,
      errors: state.errors
    });
    state.history = state.history.slice(0, 20);
    scanStates.set(guildId, state);
    if (state.deletedThreads > 0 || state.errors > 0) {
      const summary = new EmbedBuilder()
        .setColor(state.errors > 0 ? 0xffbd59 : 0x5eead4)
        .setTitle(conf.dryRun ? 'Forum-Tiefenscan · Prüfmodus' : 'Forum-Tiefenscan abgeschlossen')
        .setDescription('Der vollständige Lauf wurde zusammengefasst. Nachrichteninhalte werden nicht protokolliert.')
        .addFields(
          { name: 'Foren', value: String(state.processedForumCount), inline: true },
          { name: 'Geprüfte Posts', value: String(state.checkedThreads), inline: true },
          { name: conf.dryRun ? 'Kandidaten' : 'Gelöscht', value: String(state.deletedThreads), inline: true },
          { name: 'Ehemalige Mitglieder', value: String(state.deletedDepartedAuthors), inline: true },
          { name: 'Leere Posts', value: String(state.deletedEmptyPosts), inline: true },
          { name: 'Hinweise/Fehler', value: String(state.errors), inline: true }
        )
        .setTimestamp(new Date(state.completedAt));
      await sendLog(guild, conf, summary);
    }
  }
  return { ...state, history: state.history.slice() };
};

export const queueForumDeepScan = async ({ guild, conf, source = 'manual' } = {}) => {
  if (!guild?.id) throw new Error('Server wurde nicht gefunden.');
  const guildId = String(guild.id);
  const normalized = normalizeForumCleanerConfig(conf || guildConfigs.get(guildId));
  guildConfigs.set(guildId, normalized);
  guildReferences.set(guildId, guild);
  const running = scanPromises.get(guildId);
  if (running) return { queued: false, running: true, status: getForumCleanerSnapshot(guildId) };
  const promise = runTrackedOperation('Forum-Cleaner Tiefenscan', {
    featureId: 'forumCleaner',
    hook: source,
    guildId
  }, () => scanGuildForums(guild, normalized, source), { timeoutMs: 60 * 60_000 })
    .catch((error) => {
      recordDiagnosticError('forumCleaner.deepScan', error, { guildId });
      const state = scanStates.get(guildId) || makeScanState(guildId);
      state.running = false;
      state.errors += 1;
      state.lastError = String(error?.message || error).slice(0, 300);
      state.completedAt = new Date().toISOString();
      scanStates.set(guildId, state);
      throw error;
    })
    .finally(() => scanPromises.delete(guildId));
  scanPromises.set(guildId, promise);
  return { queued: true, running: true, status: getForumCleanerSnapshot(guildId) };
};

export const getForumCleanerSnapshot = (guildId) => {
  const id = String(guildId || '');
  const conf = normalizeForumCleanerConfig(guildConfigs.get(id));
  const state = scanStates.get(id) || makeScanState(id);
  return {
    ...state,
    enabled: conf.enabled,
    dryRun: conf.dryRun,
    includeArchived: conf.includeArchived,
    selectedForumCount: conf.channelIds.length,
    scanIntervalMinutes: conf.scanIntervalMinutes,
    running: Boolean(scanPromises.get(id) || state.running),
    history: Array.isArray(state.history) ? state.history.slice(0, 20) : []
  };
};

const startConfiguredScan = (guild, source) => queueForumDeepScan({
  guild,
  conf: guildConfigs.get(String(guild.id)),
  source
}).catch((error) => {
  recordDiagnosticError('forumCleaner.periodicScan', error, { guildId: guild.id });
  console.warn(`[forumCleaner] Tiefenscan für ${guild.name} fehlgeschlagen: ${error?.message || error}`);
});

const ensurePeriodicScan = (guild, cfg) => {
  const conf = normalizeForumCleanerConfig(cfg?.forumCleaner);
  const guildId = String(guild.id);
  guildConfigs.set(guildId, conf);
  guildReferences.set(guildId, guild);
  const previous = periodicTimers.get(guildId);
  if (previous) clearInterval(previous);
  periodicTimers.delete(guildId);
  if (!conf.enabled || !conf.channelIds.length) {
    clearPendingGuildChecks(guildId);
    return;
  }

  if (conf.scanOnStartup) setTimeout(() => void startConfiguredScan(guild, 'startupScan'), 12_000).unref?.();
  const timer = setInterval(() => void startConfiguredScan(guild, 'periodicDeepScan'), conf.scanIntervalMinutes * 60_000);
  timer.unref?.();
  periodicTimers.set(guildId, timer);
};

const scheduleForThreadMessage = (message, cfg) => {
  const conf = normalizeForumCleanerConfig(cfg?.forumCleaner);
  guildConfigs.set(String(message.guildId || message.guild?.id || ''), conf);
  const thread = message.channel;
  if (!message?.guild || !isSelectedForumThread(thread, conf)) return;
  scheduleThreadCheck(thread, conf, 'message');
};

const scheduleMemberLeaveDeepScan = (guild, cfg) => {
  const guildId = String(guild?.id || '');
  const conf = normalizeForumCleanerConfig(cfg?.forumCleaner);
  guildConfigs.set(guildId, conf);
  if (!guildId || !conf.enabled || !conf.deleteLeftAuthorPosts || !conf.channelIds.length) return;
  const previous = pendingMemberLeaveTimers.get(guildId);
  if (previous) clearTimeout(previous);
  const timer = setTimeout(() => {
    pendingMemberLeaveTimers.delete(guildId);
    void startConfiguredScan(guild, 'memberLeftDeepScan');
  }, 20_000);
  timer.unref?.();
  pendingMemberLeaveTimers.set(guildId, timer);
};

export const feature = {
  id: 'forumCleaner',
  name: 'Forum-Cleaner',

  async onClientReady({ guild, cfg }) {
    ensurePeriodicScan(guild, cfg);
  },

  async onConfigUpdate({ guild, cfg, patch }) {
    if (!patch || !Object.prototype.hasOwnProperty.call(patch, 'forumCleaner')) return;
    ensurePeriodicScan(guild, cfg);
  },

  async onThreadCreate({ thread, cfg }) {
    const conf = normalizeForumCleanerConfig(cfg?.forumCleaner);
    guildConfigs.set(String(thread?.guild?.id || ''), conf);
    scheduleThreadCheck(thread, conf, 'threadCreate');
  },

  async onThreadUpdate({ newThread, cfg }) {
    const conf = normalizeForumCleanerConfig(cfg?.forumCleaner);
    guildConfigs.set(String(newThread?.guild?.id || ''), conf);
    scheduleThreadCheck(newThread, conf, 'threadUpdate');
  },

  async onMessageCreate({ message, cfg }) {
    scheduleForThreadMessage(message, cfg);
  },

  async onMessageUpdate({ newMessage, cfg }) {
    scheduleForThreadMessage(newMessage, cfg);
  },

  async onMessageDelete({ message, cfg }) {
    scheduleForThreadMessage(message, cfg);
  },

  async onGuildMemberRemove({ guild, cfg }) {
    scheduleMemberLeaveDeepScan(guild, cfg);
  }
};

export const _forumCleanerInternals = {
  normalizeForumCleanerConfig,
  messageHasMeaning,
  realReplyCount,
  isForumThread,
  isSelectedForumThread,
  classifyMemberPresence,
  fetchStarterSafely,
  findMeaningfulReply,
  collectForumThreads,
  deleteIfEmpty
};
