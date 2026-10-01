import path from 'node:path';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';

import { atomicWriteJson, readJsonWithRecovery } from '../runtime/atomicJsonStore.js';
import { quietLog, QUIET_LOG_SCOPE } from '../runtime/quietLog.js';
import { DATA_DIR } from '../shared/paths.js';

const DATA_ROOT = DATA_DIR;
const STATE_FILE = path.join(DATA_ROOT, 'public-call-vote.json');

const PREFIX = 'fh_pcv:';
const DEFAULT_VOTE_REASONS = [
  { id: 'spam', label: 'Spam / Flood', kickMinutes: 10, timeoutAfter: 3, timeoutMinutes: 60 },
  { id: 'insult', label: 'Beleidigung', kickMinutes: 30, timeoutAfter: 3, timeoutMinutes: 120 },
  { id: 'noise', label: 'Lärm / Musik', kickMinutes: 15, timeoutAfter: 4, timeoutMinutes: 60 },
  { id: 'nsfw', label: 'Unangemessen', kickMinutes: 60, timeoutAfter: 2, timeoutMinutes: 240 },
  // „Sonstiges“ fragt den Grund als Freitext ab (Modal), damit der Rauswurf
  // nachvollziehbar bleibt – needsText: true schaltet das Eingabefeld ein.
  { id: 'other', label: 'Sonstiges', kickMinutes: 10, timeoutAfter: 5, timeoutMinutes: 60, needsText: true }
];

// Alle Nachrichten des Moduls sind über das Dashboard-Embed-Studio editierbar:
// panel (Infopanel im Call), vote (laufende Abstimmung), result (Ergebnis),
// team (Team-Kanal) und dm (DM an das rausgeworfene Mitglied). Platzhalter
// siehe formatVoteText.
const BASE_VOTE_DESIGNS = {
  panel: {
    title: '🎙️ Öffentlicher Call · Moderation',
    description: 'In öffentlichen Calls kannst du per Abstimmung entscheiden, ob ein Mitglied den Call verlassen muss. Wähle **„Rauswurf beantragen“**, nenne das Mitglied und wähle einen Grund – die Community stimmt ab. Bei wiederholten Verstößen greift automatisch ein Server-Timeout.',
    color: '#2b2d31',
    authorName: '',
    authorIconUrl: '',
    footerText: '{server}',
    timestamp: false
  },
  vote: {
    title: '🚫 Rauswurf-Abstimmung',
    description: 'Soll **{targetMention}** aus {channel} entfernt werden?\n\n**Grund:** {reason}\n{progress}',
    color: '#ed4245',
    authorName: '{targetName}',
    authorIconUrl: '',
    footerText: '{server}',
    timestamp: false,
    fields: [
      { name: '🗳️ LÄUFT NOCH', value: '{remaining}', inline: true },
      { name: '🗣️ ANWESEND', value: '{attending}', inline: true },
      { name: '✅ ERFORDERLICH', value: '**{required}**', inline: true },
      { name: '👤 BEANTRAGT VON', value: '{requesterMention}', inline: true }
    ]
  },
  result: {
    title: '{outcome}',
    description: '**{targetMention}** {outcomeText}.',
    color: '#57f287',
    authorName: '{targetName}',
    authorIconUrl: '',
    footerText: '{server}',
    timestamp: false,
    fields: [
      { name: 'Abstimmung', value: '✅ {yes} : ❌ {no}', inline: true },
      { name: 'Grund', value: '{reason}', inline: true },
      { name: 'Beantragt von', value: '{requesterMention}', inline: true }
    ]
  },
  team: {
    title: '🚫 Rauswurf aus öffentlichem Call',
    description: '**{targetMention}** wurde per Community-Abstimmung aus {channel} entfernt.',
    color: '#ed4245',
    authorName: '{targetName}',
    authorIconUrl: '',
    footerText: '{server}',
    timestamp: true,
    fields: [
      { name: 'Grund', value: '{reason}', inline: true },
      { name: 'Call-Sperre', value: '{kickMinutes} Min.', inline: true },
      { name: 'Abstimmung', value: '✅ {yes} : ❌ {no}', inline: true },
      { name: 'Beantragt von', value: '{requesterMention}', inline: true },
      { name: 'Wiederholte Verstöße', value: '{strikes}', inline: true }
    ]
  },
  dm: {
    title: '🚫 Du wurdest aus dem Call entfernt',
    description: 'Du wurdest per Community-Abstimmung aus {channel} entfernt.\n\n**Grund:** {reason}\n**Call-Sperre:** {kickMinutes} Min.\n\nFalls du dich ungerecht behandelt fühlst, wende dich an das Team.',
    color: '#ed4245',
    authorName: '{targetName}',
    authorIconUrl: '',
    footerText: '{server}',
    timestamp: true
  },
  release: {
    title: '✅ Deine Call-Sperre ist vorbei',
    description: '**{targetMention}**, deine Call-Sperre in {channel} ist abgelaufen.\n\n**Grund:** {reason}\n**Sperrdauer:** {kickMinutes} Min.\n\nDu kannst dem Call wieder beitreten.',
    color: '#57f287',
    authorName: '{targetName}',
    authorIconUrl: '',
    footerText: '{server}',
    timestamp: true
  }
};

// 2er-/3er-/4er-Varianten: Jede Call-Art hat eigene, im Embed-Studio einzeln
// editierbare Sektionen. panel2/vote2/result2 gelten für Kanäle aus der
// 2er-Liste, panel3/vote3/result3 für die 3er-Liste, panel4/vote4/result4 für
// die 4er-Liste. Die Basis-Sektionen bleiben für alle übrigen Calls;
// Team-Meldung und DM sind ebenfalls je Call-Art getrennt editierbar.
const DEFAULT_VOTE_DESIGNS = {
  ...BASE_VOTE_DESIGNS,
  panel2: { ...BASE_VOTE_DESIGNS.panel, description: `**2er-Call – eine „Dafür“-Stimme genügt.**\n\n${BASE_VOTE_DESIGNS.panel.description}` },
  vote2: { ...BASE_VOTE_DESIGNS.vote },
  result2: { ...BASE_VOTE_DESIGNS.result },
  team2: { ...BASE_VOTE_DESIGNS.team },
  dm2: { ...BASE_VOTE_DESIGNS.dm },
  panel3: { ...BASE_VOTE_DESIGNS.panel, description: `**3er-Call – zwei „Dafür“-Stimmen genügen.**\n\n${BASE_VOTE_DESIGNS.panel.description}` },
  vote3: { ...BASE_VOTE_DESIGNS.vote },
  result3: { ...BASE_VOTE_DESIGNS.result },
  team3: { ...BASE_VOTE_DESIGNS.team },
  dm3: { ...BASE_VOTE_DESIGNS.dm },
  panel4: { ...BASE_VOTE_DESIGNS.panel, description: `**4er-Call – drei „Dafür“-Stimmen genügen.**\n\n${BASE_VOTE_DESIGNS.panel.description}` },
  vote4: { ...BASE_VOTE_DESIGNS.vote },
  result4: { ...BASE_VOTE_DESIGNS.result },
  team4: { ...BASE_VOTE_DESIGNS.team },
  dm4: { ...BASE_VOTE_DESIGNS.dm },
  release2: { ...BASE_VOTE_DESIGNS.release },
  release3: { ...BASE_VOTE_DESIGNS.release },
  release4: { ...BASE_VOTE_DESIGNS.release }
};

const VOTE_DESIGN_SECTIONS = Object.keys(DEFAULT_VOTE_DESIGNS);

const normalizeDesignSection = (section, value) => {
  const fallback = DEFAULT_VOTE_DESIGNS[section] || {};
  const embed = value && typeof value === 'object' ? value : {};
  return {
    title: String(embed.title !== undefined ? embed.title : fallback.title).slice(0, 256),
    url: String(embed.url || '').slice(0, 2048),
    description: String(embed.description !== undefined ? embed.description : fallback.description).slice(0, 4096),
    color: String(embed.color || fallback.color || '').slice(0, 16),
    authorName: String(embed.authorName !== undefined ? embed.authorName : fallback.authorName).slice(0, 256),
    authorIconUrl: String(embed.authorIconUrl || '').slice(0, 2048),
    thumbnailUrl: String(embed.thumbnailUrl || '').slice(0, 2048),
    imageUrl: String(embed.imageUrl || '').slice(0, 2048),
    footerText: String(embed.footerText !== undefined ? embed.footerText : fallback.footerText).slice(0, 2048),
    footerIconUrl: String(embed.footerIconUrl || '').slice(0, 2048),
    timestamp: embed.timestamp === undefined ? fallback.timestamp === true : embed.timestamp === true,
    fields: (Array.isArray(embed.fields) && embed.fields.length
      ? embed.fields
      : Array.isArray(fallback.fields) ? fallback.fields : [])
      .slice(0, 25)
      .map((field) => ({
        name: String(field?.name || '\u200b').slice(0, 256),
        value: String(field?.value || '\u200b').slice(0, 1024),
        inline: field?.inline === true
      }))
      .filter((field) => field.name !== '\u200b' || field.value !== '\u200b')
  };
};

// Rendert die editierbaren Felder einer Call-Moderations-Sektion (vote/result/team).
// Die Feldnamen und -werte kommen aus dem Embed-Studio (Standard = Defaults mit
// Platzhaltern) und werden über formatVoteText mit Live-Daten gefüllt.
const designSectionFields = (section, context) => (Array.isArray(section.fields) ? section.fields : [])
  .slice(0, 25)
  .map((field) => ({
    name: formatVoteText(field.name, context, 256) || '\u200b',
    value: formatVoteText(field.value, context, 1024) || '\u200b',
    inline: field.inline === true
  }));

const normalizeVoteDesigns = (design) => {
  const source = design && typeof design === 'object' && !Array.isArray(design) ? design : {};
  return Object.fromEntries(VOTE_DESIGN_SECTIONS.map((section) => [section, normalizeDesignSection(section, source[section])]));
};

const clampNumber = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const uniqueIds = (value) => {
  const rows = Array.isArray(value) ? value : String(value || '').split(/[\r\n,]+/);
  return [...new Set(rows.map((entry) => String(entry || '').trim()).filter(Boolean))];
};

const normalizeVoteReasons = (rows) => {
  const reasons = Array.isArray(rows) && rows.length ? rows : DEFAULT_VOTE_REASONS;
  return reasons
    .map((reason, index) => ({
      id: String(reason?.id || '').trim().slice(0, 40),
      label: String(reason?.label || `Grund ${index + 1}`).slice(0, 80),
      kickMinutes: Math.max(1, Math.trunc(clampNumber(reason?.kickMinutes, 10, 1, 1440))),
      timeoutAfter: Math.max(1, Math.trunc(clampNumber(reason?.timeoutAfter, 3, 1, 20))),
      timeoutMinutes: Math.max(1, Math.trunc(clampNumber(reason?.timeoutMinutes, 60, 1, 10080))),
      needsText: reason?.needsText === true
    }))
    .filter((reason) => reason.id);
};

const normalizePublicCallVoteConfig = (conf = {}) => ({
  enabled: conf?.enabled === true,
  callChannelIds: uniqueIds(conf?.callChannelIds),
  // 2er-, 3er- und 4er-Calls werden getrennt ausgewählt: Die
  // Abstimmungs-Schwelle hängt von der Gruppe ab (2er → 1 Stimme, 3er → 2,
  // 4er → 3 Stimmen). callChannelIds bleibt als „übrige / gemischte“ Liste
  // für bestehende Konfigurationen.
  callChannelIds2: uniqueIds(conf?.callChannelIds2),
  callChannelIds3: uniqueIds(conf?.callChannelIds3),
  callChannelIds4: uniqueIds(conf?.callChannelIds4),
  passPercent: Math.trunc(clampNumber(conf?.passPercent, 51, 10, 100)),
  minVotes: Math.trunc(clampNumber(conf?.minVotes, 3, 1, 50)),
  timeoutSeconds: Math.trunc(clampNumber(conf?.timeoutSeconds, 60, 15, 600)),
  voteReasons: normalizeVoteReasons(conf?.voteReasons),
  teamChannelId: String(conf?.teamChannelId || '').trim(),
  teamRoleIds: uniqueIds(conf?.teamRoleIds),
  resultAutoDeleteSeconds: Math.trunc(clampNumber(conf?.resultAutoDeleteSeconds, 30, 5, 600)),
  requestButtonLabel: String(conf?.requestButtonLabel ?? 'Rauswurf beantragen').slice(0, 80),
  yesButtonLabel: String(conf?.yesButtonLabel ?? 'Dafür').slice(0, 80),
  noButtonLabel: String(conf?.noButtonLabel ?? 'Dagegen').slice(0, 80),
  passedOutcomeText: String(conf?.passedOutcomeText ?? 'wird entfernt').slice(0, 160),
  failedOutcomeText: String(conf?.failedOutcomeText ?? 'bleibt im Call').slice(0, 160),
  design: normalizeVoteDesigns(conf?.design)
});

// Version 2: führt persistente Call-Sperren ein. Locks werden mit Start- und
// Endzeit in die State-Datei geschrieben und überleben damit Neustarts und
// Offline-Zeiten – die Discord-Permission-Overwrite bleibt sonst ewig bestehen.
const emptyState = () => ({ version: 2, panels: {}, votes: {}, strikes: {}, locks: {} });

// Eine Abstimmung ohne eine einzige Stimme ist nutzlos – statt sie still als
// „abgelehnt“ ablaufen zu lassen, wird sie verlängert, bis mindestens ein
// Mitglied abgestimmt hat (max. MAX_VOTE_EXTENSIONS Verlängerungen).
const MAX_VOTE_EXTENSIONS = 5;

let state = null;
let loadPromise = null;
let saveQueue = Promise.resolve();
const guildConfigs = new Map();
const voteLockTimers = new Map();
const voteTimers = new Map();
// Sekunden-Ticker für laufende Abstimmungen: Die Restzeit im Embed wird jede
// Sekunde aktualisiert, damit es ein echter Countdown ist und nicht nur ein
// beim Senden eingefrorener Wert.
const voteTickers = new Map();

// Geschützte Nachrichten: Panel-Embeds und aktive Abstimmungen dürfen vom
// Voice-Chat-Cleaner nicht gelöscht werden. Der Cleaner fragt hier ab.
const protectedMessages = new Map();

const registerProtectedMessage = (guildId, channelId, messageId) => {
  const key = `${String(guildId || '')}:${String(channelId || '')}`;
  const ids = protectedMessages.get(key) || new Set();
  if (messageId) ids.add(String(messageId));
  protectedMessages.set(key, ids);
};

const unregisterProtectedMessage = (guildId, channelId, messageId) => {
  const key = `${String(guildId || '')}:${String(channelId || '')}`;
  const ids = protectedMessages.get(key);
  if (!ids) return;
  ids.delete(String(messageId));
  if (!ids.size) protectedMessages.delete(key);
};

export const isProtectedPublicCallVoteMessage = (guildId, channelId, messageId) => {
  const key = `${String(guildId || '')}:${String(channelId || '')}`;
  const ids = protectedMessages.get(key);
  return Boolean(ids && ids.has(String(messageId)));
};

// --- Persistente Call-Sperren -------------------------------------------------
// Jede Sperre wird mit { at, until, channelId, reasonId } in die State-Datei
// geschrieben. Der In-Memory-Timer dient nur dem Live-Ablauf – nach einem
// Neustart rechnet restoreCallLocks die Restzeit neu, und abgelaufene Sperren
// werden beim Start bzw. beim nächsten Join-Versuch sofort freigegeben.

const lockKey = (guildId, userId, channelId) => `${voteStateKey(guildId)}:${String(userId)}:${String(channelId)}`;

// Gibt true zurück, wenn die übergebene Sperre noch nicht abgelaufen ist.
const isLockActive = (lock, now = Date.now()) => Boolean(lock) && Number(lock?.until || 0) > now;

// Setzt die Discord-Permission-Overwrite des Users für den Channel auf
// Connect:false (gesperrt) bzw. Connect:null (entsperrt).
const setCallLockOverwrite = async (guild, userId, channelId, locked) => {
  const channel = guild?.channels?.cache?.get(String(channelId))
    || (guild?.channels?.fetch ? await guild.channels.fetch(String(channelId)).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.publicCallVote, error, `channels.fetch fehlgeschlagen: ${channelId}`);
      return null;
    }) : null);
  if (!channel || typeof channel.permissionOverwrites?.edit !== 'function') return false;
  await channel.permissionOverwrites.edit(String(userId), { Connect: locked ? false : null })
    .catch((error) => quietLog(QUIET_LOG_SCOPE.publicCallVote, error, `Call-Sperre setzen fehlgeschlagen: Kanal ${channelId}, User ${userId}, locked=${locked}`));
  return true;
};

// Entfernt eine Sperre aus State + Timern und gibt den Channel wieder frei.
// Event-basiert: wird bei Ablauf, beim Start-Scan und bei Join-Versuchen
// aufgerufen – es gibt kein periodisches Polling.
const releaseCallLock = async ({ guild, guildId, userId, channelId }) => {
  const data = await ensureLoaded();
  const guildLocks = data.locks[voteStateKey(guildId)] || {};
  const existing = guildLocks[String(userId)];
  if (!existing) return false;
  const expired = Number(existing.until || 0) <= Date.now();
  const key = lockKey(guildId, userId, channelId || existing.channelId);
  const timer = voteLockTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    voteLockTimers.delete(key);
  }
  delete guildLocks[String(userId)];
  data.locks[voteStateKey(guildId)] = guildLocks;
  await persist();
  if (guild) {
    await setCallLockOverwrite(guild, userId, channelId || existing.channelId, false);
  }
  // Nur bei echter Ablauf-Freigabe (nicht bei manueller Aufhebung, z.B. beim
  // Wechsel in einen anderen Call) bekommt das Mitglied eine DM, dass es
  // wieder beitreten kann. Läuft im Hintergrund, blockiert nichts.
  if (expired && guild) {
    void sendLockReleaseDm({ guild, userId, lock: existing }).catch((error) => {
    quietLog(QUIET_LOG_SCOPE.publicCallVote, error, `sendLockReleaseDm fehlgeschlagen: User ${userId}`);
  });
  }
  return true;
};

// Aktiviert eine Sperre: persistiert mit Endzeit und armiert den Live-Timer.
// Ein bereits bestehender Lock für denselben User wird überschrieben.
const activateCallLock = async ({ guild, guildId, userId, channelId, lockMs, reasonId }) => {
  const now = Date.now();
  const until = now + Math.max(60_000, Number(lockMs || 0));
  const data = await ensureLoaded();
  const guildLocks = data.locks[voteStateKey(guildId)] || {};
  const previous = guildLocks[String(userId)];
  if (previous && String(previous.channelId) !== String(channelId)) {
    // Wechselt der User in einen anderen Call, wird die alte Sperre dort
    // ebenfalls freigegeben, damit sie nicht ewig hängen bleibt.
    const oldKey = lockKey(guildId, userId, previous.channelId);
    const oldTimer = voteLockTimers.get(oldKey);
    if (oldTimer) {
      clearTimeout(oldTimer);
      voteLockTimers.delete(oldKey);
    }
    if (guild) {
      await setCallLockOverwrite(guild, userId, previous.channelId, false);
    }
  }
  guildLocks[String(userId)] = {
    at: now,
    until,
    channelId: String(channelId),
    reasonId: String(reasonId || '')
  };
  data.locks[voteStateKey(guildId)] = guildLocks;
  await persist();

  if (guild) {
    await setCallLockOverwrite(guild, userId, channelId, true);
  }
  const key = lockKey(guildId, userId, channelId);
  const existingTimer = voteLockTimers.get(key);
  if (existingTimer) clearTimeout(existingTimer);
  const remainingMs = Math.max(0, until - Date.now());
  const timer = setTimeout(() => {
    voteLockTimers.delete(key);
    void releaseCallLock({ guild, guildId, userId, channelId }).catch((error) => {
    quietLog(QUIET_LOG_SCOPE.publicCallVote, error, `releaseCallLock fehlgeschlagen: User ${userId}, Kanal ${channelId}`);
  });
  }, remainingMs);
  timer.unref?.();
  voteLockTimers.set(key, timer);
  return { at: now, until, channelId: String(channelId), reasonId: String(reasonId || '') };
};

// Start-Scan: lädt alle gespeicherten Sperren eines Servers, gibt abgelaufene
// sofort frei und rechnet für laufende die Restzeit neu (weiterzählen über
// Neustart/Offline-Zeit hinweg).
const restoreCallLocks = async (guild) => {
  const data = await ensureLoaded();
  const guildLocks = data.locks[voteStateKey(guild.id)] || {};
  const now = Date.now();
  for (const [userId, lock] of Object.entries(guildLocks)) {
    if (!lock || typeof lock !== 'object') continue;
    if (!isLockActive(lock, now)) {
      // Abgelaufen, während der Bot offline war → sofort entsperren.
      await releaseCallLock({ guild, guildId: guild.id, userId, channelId: lock.channelId }).catch((error) => {
        quietLog(QUIET_LOG_SCOPE.publicCallVote, error, `releaseCallLock (Startup) fehlgeschlagen: User ${userId}`);
      });
      continue;
    }
    // Läuft noch → Permission erneut setzen (sicher gegen Rate-Limit-Fehler
    // vor dem Neustart) und Live-Timer mit Restzeit neu armen.
    if (guild) {
      await setCallLockOverwrite(guild, userId, lock.channelId, true).catch((error) => {
        quietLog(QUIET_LOG_SCOPE.publicCallVote, error, `setCallLockOverwrite fehlgeschlagen: User ${userId}, Kanal ${lock.channelId}`);
      });
    }
    const key = lockKey(guild.id, userId, lock.channelId);
    const remainingMs = Math.max(0, Number(lock.until || 0) - now);
    const existingTimer = voteLockTimers.get(key);
    if (existingTimer) clearTimeout(existingTimer);
    const timer = setTimeout(() => {
      voteLockTimers.delete(key);
      void releaseCallLock({ guild, guildId: guild.id, userId, channelId: lock.channelId }).catch((error) => {
        quietLog(QUIET_LOG_SCOPE.publicCallVote, error, `releaseCallLock (VoiceState) fehlgeschlagen: User ${userId}`);
      });
    }, remainingMs);
    timer.unref?.();
    voteLockTimers.set(key, timer);
  }
};

// Event-basierte Freigabe: Wenn ein User versucht, einem gesperrten Channel
// beizutreten, wird geprüft, ob die Sperre bereits abgelaufen ist – dann wird
// sie sofort entfernt und der Join ist möglich. Es gibt kein Polling.
const handleVoiceStateForLocks = async (newState, guild) => {
  const joinedChannel = newState?.channelId;
  const userId = String(newState?.member?.id || newState?.id || '');
  if (!joinedChannel || !userId) return;
  const data = await ensureLoaded();
  const lock = (data.locks[voteStateKey(guild.id)] || {})[userId];
  if (!lock || String(lock.channelId) !== String(joinedChannel)) return;
  if (!isLockActive(lock)) {
    await releaseCallLock({ guild, guildId: guild.id, userId, channelId: joinedChannel }).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.publicCallVote, error, `releaseCallLock (Join) fehlgeschlagen: User ${userId}`);
    });
  }
};

export const getPublicCallVoteLocks = async (guildId, userId) => {
  const data = await ensureLoaded();
  const lock = (data.locks[voteStateKey(guildId)] || {})[String(userId || '')];
  if (!lock) return null;
  return {
    channelId: String(lock.channelId || ''),
    at: Number(lock.at || 0),
    until: Number(lock.until || 0),
    reasonId: String(lock.reasonId || '')
  };
};

// Liefert ALLE aktiven Call-Sperren eines Servers für das Dashboard
// („Gesperrte Spieler“ im Modul): Anzeigename, Restzeit, Call-Art (2er/3er/
// 4er/übrige öffentliche) und Grund-Label. Abgelaufene Sperren erscheinen
// nicht – sie werden ohnehin event-basiert freigegeben.
const callTypeForChannel = (channelId, conf) => {
  const id = String(channelId || '');
  if (uniqueIds(conf?.callChannelIds2).includes(id)) return '2er';
  if (uniqueIds(conf?.callChannelIds3).includes(id)) return '3er';
  if (uniqueIds(conf?.callChannelIds4).includes(id)) return '4er';
  return 'alle';
};

const reasonLabelForId = (conf, reasonId) => {
  const row = (Array.isArray(conf?.voteReasons) ? conf.voteReasons : [])
    .find((reason) => String(reason?.id || '') === String(reasonId || ''));
  return row ? String(row.label || '').slice(0, 80) : '';
};

// Echter Discord-Avatar (Member/Guild-Avatar bevorzugt, sonst User-Avatar,
// leere Zeichenkette = kein Bild). Gleiches Muster wie activityRace.
const resolveCallVoteAvatar = (member, options = { size: 64, extension: 'png' }) => {
  const user = member?.user || null;
  if (!user?.id) return '';
  const resolved = member?.displayAvatarURL?.(options) || user?.displayAvatarURL?.(options);
  if (resolved) return String(resolved);
  const guildAvatar = String(member?.avatar || '').trim();
  if (guildAvatar && member?.guild?.id) {
    const extension = String(guildAvatar.startsWith('a_') ? 'gif' : (options.extension || 'png')).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png';
    const size = Number(options.size || 64);
    const normalizedSize = Number.isFinite(size) && size > 0 ? Math.min(4096, Math.max(16, Math.round(size))) : 64;
    return `https://cdn.discordapp.com/guilds/${String(member.guild.id)}/users/${String(user.id)}/avatars/${guildAvatar}.${extension}?size=${normalizedSize}`;
  }
  if (user.avatar) {
    const extension = String(user.avatar.startsWith('a_') ? 'gif' : (options.extension || 'png')).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png';
    const size = Number(options.size || 64);
    const normalizedSize = Number.isFinite(size) && size > 0 ? Math.min(4096, Math.max(16, Math.round(size))) : 64;
    return `https://cdn.discordapp.com/avatars/${String(user.id)}/${String(user.avatar)}.${extension}?size=${normalizedSize}`;
  }
  return '';
};

export const getPublicCallVoteLocksList = async (guild, conf = {}) => {
  const resolvedGuild = guild instanceof Object && guild?.id ? guild : null;
  if (!resolvedGuild) return { locks: [] };
  const data = await ensureLoaded();
  const guildLocks = data.locks[voteStateKey(resolvedGuild.id)] || {};
  const now = Date.now();
  const locks = Object.entries(guildLocks)
    .filter(([, lock]) => lock && typeof lock === 'object' && isLockActive(lock, now))
    .map(([userId, lock]) => {
      const member = resolvedGuild.members?.cache?.get?.(String(userId));
      const channel = resolvedGuild.channels?.cache?.get?.(String(lock.channelId || ''));
      return {
        userId,
        name: member?.displayName || member?.user?.username || 'Unbekannt',
        avatarUrl: resolveCallVoteAvatar(member),
        at: Math.max(0, Number(lock.at || 0)),
        until: Math.max(0, Number(lock.until || 0)),
        remainingMs: Math.max(0, Number(lock.until || 0) - now),
        channelId: String(lock.channelId || ''),
        channelName: channel?.name || '',
        callType: callTypeForChannel(lock.channelId, conf),
        reasonLabel: reasonLabelForId(conf, lock.reasonId)
      };
    })
    .sort((left, right) => left.remainingMs - right.remainingMs);
  return { locks };
};

// Hebt eine laufende Call-Sperre manuell auf (Dashboard): gibt den
// Kanal-Zugriff sofort zurück und entfernt den Lock-Eintrag. Keine DM,
// weil ein Admin aktiv eingegriffen hat.
export const removePublicCallVoteLock = async ({ guild, guildId, userId } = {}) => {
  const resolvedGuild = guild instanceof Object && guild?.id ? guild : null;
  const resolvedUserId = String(userId || '');
  if (!resolvedGuild || !resolvedUserId) return { ok: false, userId: resolvedUserId };
  const data = await ensureLoaded();
  const lock = (data.locks[voteStateKey(resolvedGuild.id)] || {})[resolvedUserId];
  if (!lock) return { ok: false, userId: resolvedUserId };
  const released = await releaseCallLock({ guild: resolvedGuild, guildId: resolvedGuild.id, userId: resolvedUserId, channelId: lock.channelId });
  return { ok: released, userId: resolvedUserId };
};

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const ensureLoaded = async () => {
  if (state) return state;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const loaded = await readJsonWithRecovery(STATE_FILE, { fallback: emptyState() });
    // readJsonWithRecovery liefert { value, source, recovered, failures } – die
    // eigentlichen Daten stecken in .value. (Vor dem Fix wurden die Wrapper-
    // Felder direkt gespreadet: Votes/Strikes/Panels überlebten keinen Neustart
    // und aktive Abstimmungen meldeten danach „existiert nicht mehr“.)
    const parsed = loaded && typeof loaded === 'object' && loaded.value && typeof loaded.value === 'object'
      ? loaded.value
      : (loaded && typeof loaded === 'object' ? loaded : {});
    // Wrapper-/Leak-Felder aus alten Dateien nicht in den State (und damit
    // nicht zurück in die Datei) übernehmen.
    const { value: _leakValue, source: _leakSource, recovered: _leakRecovered, failures: _leakFailures, ...clean } = parsed;
    state = {
      ...emptyState(),
      ...clean,
      panels: (clean?.panels && typeof clean.panels === 'object' && !Array.isArray(clean.panels)) ? clean.panels : {},
      votes: (clean?.votes && typeof clean.votes === 'object' && !Array.isArray(clean.votes)) ? clean.votes : {},
      strikes: (clean?.strikes && typeof clean.strikes === 'object' && !Array.isArray(clean.strikes)) ? clean.strikes : {},
      locks: (clean?.locks && typeof clean.locks === 'object' && !Array.isArray(clean.locks)) ? clean.locks : {}
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
      await atomicWriteJson(STATE_FILE, snapshot, { pretty: true });
    } catch (error) {
      console.error('[publicCallVote] State konnte nicht gespeichert werden:', error?.message || error);
    }
  });
  return saveQueue;
};

const configFor = (guildId) => guildConfigs.get(String(guildId || '')) || normalizePublicCallVoteConfig({});

// Alle öffentlichen Calls eines Servers: die Summe aus 2er-, 3er-, 4er- und
// der übrigen Liste. Wird überall dort benutzt, wo „ausgewählter öffentlicher
// Call“ geprüft wird (Panels, Target-Picker, Abstimmungs-Start).
const allCallChannelIds = (conf) => [...new Set([
  ...uniqueIds(conf?.callChannelIds),
  ...uniqueIds(conf?.callChannelIds2),
  ...uniqueIds(conf?.callChannelIds3),
  ...uniqueIds(conf?.callChannelIds4)
])];

// Nur für Smoke-Tests: ersetzt den internen State (Panels/Votes/Strikes), damit
// Tests den Live-Refresh gegen einen bekannten Zustand prüfen können. Produktiv
// wird der State ausschließlich über die normalen Pfade geschrieben.
export const seedPublicCallVoteState = async (patch = {}) => {
  const current = await ensureLoaded();
  state = {
    ...current,
    panels: (patch.panels && typeof patch.panels === 'object') ? patch.panels : current.panels,
    votes: (patch.votes && typeof patch.votes === 'object') ? patch.votes : current.votes,
    strikes: (patch.strikes && typeof patch.strikes === 'object') ? patch.strikes : current.strikes,
    locks: (patch.locks && typeof patch.locks === 'object') ? patch.locks : current.locks
  };
  return state;
};

const isBot = (member) => Boolean(member?.user?.bot || member?.user?.system);

const voteStateKey = (guildId) => String(guildId || '');
const strikeWindowMs = 24 * 60 * 60_000;

// Platzhalter, die in allen editierbaren Nachrichten des Moduls ersetzt werden:
// {server} {targetName} {target} {targetMention} {channel} {reason} {yes} {no} {progress}
// {remaining} {attending} {requester} {requesterMention} {outcome} {outcomeText}
// {kickMinutes} {strikes}
// {target} ist ein ECHTER Ping (<@id>) und wird in Beschreibung/Feldern als
// Mention angezeigt – {targetName} ist der Klarname als Text (z. B. für die
// Autor-Zeile, die Discord ohne Mentions rendert). {reason} zeigt bei
// „Sonstiges“ den freieingegebenen Grund aus dem Modal.
const formatVoteText = (value, context, maximum) => String(value || '')
  .replaceAll('{server}', context.server || '')
  .replaceAll('{targetName}', context.target || '')
  .replaceAll('{target}', context.targetMention || context.target || '')
  .replaceAll('{targetMention}', context.targetMention || '')
  .replaceAll('{channel}', context.channel || '')
  .replaceAll('{reason}', context.reason || '')
  .replaceAll('{yes}', context.yes || '0')
  .replaceAll('{no}', context.no || '0')
  .replaceAll('{progress}', context.progress || '')
  .replaceAll('{remaining}', context.remaining || '0 Sek.')
  .replaceAll('{attending}', context.attending || '0')
  .replaceAll('{requester}', context.requester || '–')
  .replaceAll('{requesterMention}', context.requesterMention || '–')
  .replaceAll('{outcome}', context.outcome || '')
  .replaceAll('{outcomeText}', context.outcomeText || '')
  .replaceAll('{kickMinutes}', context.kickMinutes || '10')
  .replaceAll('{strikes}', context.strikes || '0')
  .slice(0, maximum);

const embedDesignColor = (color) => {
  const normalized = String(color || '').trim().replace(/^#/, '');
  const parsed = /^[0-9a-f]{6}$/i.test(normalized) ? parseInt(normalized, 16) : null;
  return parsed !== null ? parsed : 0x2b2d31;
};

// Autor-Icon: konfiguriertes Bild, sonst das Avatar-Bild des betroffenen
// Mitglieds – damit im Embed echte Leute (mit Avatar) stehen, nicht nur Namen.
// Wichtig: Discord rendert in der Autor-Zeile KEINE Mentions – ein {target}
// dort würde als roher Text (<@id>) erscheinen. Deshalb wird {target} in der
// Autor-Zeile immer wie {targetName} (Klarname) behandelt; echte Mentions
// gehören in Beschreibung/Felder.
const designAuthor = (design, targetAvatarUrl, context = {}) => {
  const name = formatVoteText(String(design.authorName || '').replaceAll('{target}', '{targetName}'), context, 256).trim();
  if (!name) return null;
  return {
    name: `🎙️ ${name}`.slice(0, 256),
    iconURL: design.authorIconUrl || targetAvatarUrl || undefined
  };
};

const designFooter = (embed, design, context, timestamp) => {
  const footerText = formatVoteText(design.footerText, context, 2048);
  // Nur setzen, wenn wirklich Text oder ein Icon existiert – ein leerer Footer
  // (z. B. ohne Servername) würde den Embed-Builder mit undefined crashen.
  if (footerText || design.footerIconUrl) {
    embed.setFooter({
      text: footerText || undefined,
      iconURL: design.footerIconUrl || undefined
    });
  }
  if (design.timestamp) {
    if (timestamp) embed.setTimestamp(timestamp);
    else embed.setTimestamp();
  }
};

// Wählt die Design-Sektion je nach Call-Typ: Kanäle aus der 2er-Liste nutzen
// die „2“-Varianten (panel2/vote2/result2), aus der 3er-Liste die
// „3“-Varianten, aus der 4er-Liste die „4“-Varianten – alle übrigen die
// Basis-Sektionen.
const designSectionFor = (channelId, base, conf) => {
  const channelKey = String(channelId || '');
  if (uniqueIds(conf?.callChannelIds2).includes(channelKey)) return `${base}2`;
  if (uniqueIds(conf?.callChannelIds3).includes(channelKey)) return `${base}3`;
  if (uniqueIds(conf?.callChannelIds4).includes(channelKey)) return `${base}4`;
  return base;
};

const panelEmbed = (guild, conf, channelId) => {
  const design = conf.design[designSectionFor(channelId, 'panel', conf)];
  const context = { server: guild?.name || '' };
  const embed = new EmbedBuilder()
    .setColor(embedDesignColor(design.color))
    .setTitle(formatVoteText(design.title, context, 256))
    .setDescription(formatVoteText(design.description, context, 4096));
  const author = designAuthor(design, undefined, context);
  if (author) embed.setAuthor(author);
  if (design.thumbnailUrl) embed.setThumbnail(design.thumbnailUrl);
  if (design.imageUrl) embed.setImage(design.imageUrl);
  designFooter(embed, design, context);
  return embed;
};

const panelComponents = (conf = {}) => {
  const rawLabel = conf?.requestButtonLabel;
  const label = typeof rawLabel === 'string' ? rawLabel.slice(0, 80) : 'Rauswurf beantragen';
  try {
    return [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}vote:start`).setLabel(label).setEmoji('🚫').setStyle(ButtonStyle.Danger)
    )];
  } catch (error) {
    console.error(`[publicCallVote] panelComponents error: ${error.message}`, { label, confKeys: conf ? Object.keys(conf) : null });
    // Fallback: minimale gültige Komponente
    return [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}vote:start`).setLabel('Rauswurf beantragen').setStyle(ButtonStyle.Danger)
    )];
  }
};

// Erforderliche Ja-Stimmen je Call: Ein als 2er-Call ausgewählter Kanal braucht
// nur eine Stimme, ein 3er-Call zwei, ein 4er-Call drei – unabhängig davon,
// wie viele gerade anwesend sind. Nicht zugeordnete (übrige) Calls rechnen
// dynamisch nach Anwesenden: 2er-Call → 1, 3er-Call → 2, größer →
// konfigurierte Mindeststimmen-Zahl, aber nie mehr als Anwesende.
const requiredYesFor = (attending, conf, channelId) => {
  const channelKey = String(channelId || '');
  if (uniqueIds(conf?.callChannelIds2).includes(channelKey)) return 1;
  if (uniqueIds(conf?.callChannelIds3).includes(channelKey)) return 2;
  if (uniqueIds(conf?.callChannelIds4).includes(channelKey)) return 3;
  const count = Math.max(1, Number(attending || 1));
  if (count <= 2) return 1;
  if (count === 3) return 2;
  return Math.min(count, Math.max(1, Number(conf?.minVotes || 3)));
};

const voteContext = (vote, guild, conf) => {
  const reason = conf.voteReasons.find((entry) => entry.id === vote.reasonId) || conf.voteReasons[0];
  const yesCount = (vote.yes || []).length;
  const noCount = (vote.no || []).length;
  return {
    server: guild?.name || '',
    target: vote.targetName || 'Unbekannt',
    targetMention: `<@${vote.targetUserId}>`,
    channel: `<#${vote.channelId}>`,
    // Bei „Sonstiges" steht im Modal ein Freitext – der ersetzt die
    // Standard-Bezeichnung überall ({reason} in Vote, Ergebnis, Team, DM).
    reason: vote.reasonText || reason?.label || vote.reasonId || 'Sonstiges',
    yes: String(yesCount),
    no: String(noCount),
    progress: `✅ ${yesCount} dafür · ❌ ${noCount} dagegen`,
    // Discord rendert <t:...:R> client-seitig als dynamisches Relativzeit-
    // Stempel (z. B. „in 45 Sekunden"), das automatisch runterzählt –
    // kein manueller 1-Sekunden-Ticker mehr nötig für die Restzeit-Anzeige.
    remaining: `<t:${Math.floor(Number(vote.endsAt || 0) / 1000)}:R>`,
    attending: String(vote.attendingCount || 0),
    required: String(requiredYesFor(vote.attendingCount, conf, vote.channelId)),
    requester: vote.startedByName || '–',
    requesterMention: vote.startedBy ? `<@${vote.startedBy}>` : '–'
  };
};

const targetAvatarUrl = (guild, userId) => guild?.members?.cache?.get(String(userId))?.displayAvatarURL?.() || undefined;

const voteEmbed = (vote, guild, conf) => {
  const design = conf.design[designSectionFor(vote.channelId, 'vote', conf)];
  const context = voteContext(vote, guild, conf);
  const embed = new EmbedBuilder()
    .setColor(embedDesignColor(design.color))
    .setTitle(formatVoteText(design.title, context, 256))
    .setDescription(formatVoteText(design.description, context, 4096));
  const author = designAuthor(design, targetAvatarUrl(guild, vote.targetUserId), context);
  if (author) embed.setAuthor(author);
  if (design.thumbnailUrl) embed.setThumbnail(design.thumbnailUrl);
  if (design.imageUrl) embed.setImage(design.imageUrl);
  const fields = designSectionFields(design, context);
  if (fields.length) embed.addFields(fields);
  designFooter(embed, design, context);
  return embed;
};

const resultEmbed = (vote, guild, conf, passed) => {
  const design = conf.design[designSectionFor(vote.channelId, 'result', conf)];
  const context = {
    ...voteContext(vote, guild, conf),
    outcome: passed ? '✅ Rauswurf beschlossen' : '❌ Rauswurf abgelehnt',
    outcomeText: passed ? (conf.passedOutcomeText || 'wird entfernt') : (conf.failedOutcomeText || 'bleibt im Call')
  };
  const embed = new EmbedBuilder()
    .setColor(embedDesignColor(design.color))
    .setTitle(formatVoteText(design.title, context, 256))
    .setDescription(formatVoteText(design.description, context, 4096));
  const author = designAuthor(design, targetAvatarUrl(guild, vote.targetUserId), context);
  if (author) embed.setAuthor(author);
  if (design.thumbnailUrl) embed.setThumbnail(design.thumbnailUrl);
  if (design.imageUrl) embed.setImage(design.imageUrl);
  const fields = designSectionFields(design, context);
  if (fields.length) embed.addFields(fields);
  designFooter(embed, design, context);
  return embed;
};

const voteComponents = (voteId, conf = {}) => [new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(`${PREFIX}vote:yes:${voteId}`).setLabel(String(conf?.yesButtonLabel ?? 'Dafür').slice(0, 80)).setEmoji('✅').setStyle(ButtonStyle.Success),
  new ButtonBuilder().setCustomId(`${PREFIX}vote:no:${voteId}`).setLabel(String(conf?.noButtonLabel ?? 'Dagegen').slice(0, 80)).setEmoji('❌').setStyle(ButtonStyle.Danger)
)];

const isCallChannel = (channel) => Boolean(
  channel?.guild
  && Number(channel?.type) === ChannelType.GuildVoice
  && channel.isVoiceBased?.()
);

const selectedCallChannels = (guild, conf) => {
  const channelIds = allCallChannelIds(conf);
  if (!conf.enabled || !channelIds.length) return [];
  return channelIds
    .map((channelId) => guild.channels.cache.get(String(channelId)))
    .filter((channel) => channel && isCallChannel(channel));
};

const ensurePublicVotePanels = async ({ guild, conf }) => {
  if (!conf.enabled || !allCallChannelIds(conf).length) return;
  const channelIds = allCallChannelIds(conf);
  const data = await ensureLoaded();
  const guildPanels = data.panels[voteStateKey(guild.id)] || {};
  const wanted = new Set(allCallChannelIds(conf).map((channelId) => String(channelId)));

  // Nicht mehr ausgewählte Panels aufräumen.
  for (const [channelId, messageId] of Object.entries(guildPanels)) {
    if (!wanted.has(String(channelId))) {
      const channel = guild.channels.cache.get(String(channelId));
      const message = channel?.messages?.cache?.get(String(messageId));
      if (message) await message.delete().catch((error) => {
        quietLog(QUIET_LOG_SCOPE.publicCallVote, error, `Panel-Delete fehlgeschlagen`);
      });
      unregisterProtectedMessage(guild.id, channelId, messageId);
      delete guildPanels[String(channelId)];
    }
  }

  for (const channel of selectedCallChannels(guild, conf)) {
    const channelId = String(channel.id);
    const existingId = guildPanels[channelId];
    if (existingId) {
      // Nach Neustart liegt die Panel-Nachricht oft nicht im lokalen Cache –
      // dann direkt von Discord holen, statt ein Duplikat zu senden.
      let existing = channel.messages?.cache?.get(existingId);
      if (!existing && channel.messages?.fetch) {
        existing = await channel.messages.fetch(existingId).catch((error) => {
          quietLog(QUIET_LOG_SCOPE.publicCallVote, error, `messages.fetch (Existing) fehlgeschlagen: ${existingId}`);
          return null;
        });
      }
      if (existing) {
        let embed;
        try { embed = panelEmbed(guild, conf, channel.id); } catch (e) { console.error(`[publicCallVote] panelEmbed(EDIT) crash Kanal ${channelId}:`, e.message, e.stack); throw e; }
        let components;
        try { components = panelComponents(conf); } catch (e) { console.error(`[publicCallVote] panelComponents(EDIT) crash Kanal ${channelId}:`, e.message, e.stack); throw e; }
        const embedJson = JSON.stringify(embed.toJSON());
        await existing.edit({ embeds: [embed], components })
          .catch((error) => quietLog(QUIET_LOG_SCOPE.publicCallVote, error, `Panel-Edit fehlgeschlagen: Kanal ${channelId}`));
        registerProtectedMessage(guild.id, channelId, existingId);
        continue;
      }
      // Nachricht wurde gelöscht → alten Eintrag verwerfen und neu senden.
      delete guildPanels[String(channelId)];
    }
    let embed2;
    try { embed2 = panelEmbed(guild, conf, channel.id); } catch (e) { console.error(`[publicCallVote] panelEmbed(SEND) crash Kanal ${channelId}:`, e.message, e.stack); throw e; }
    const message = await channel.send({ embeds: [embed2], components: panelComponents(conf) })
      .catch((error) => quietLog(QUIET_LOG_SCOPE.publicCallVote, error, `Panel-Send fehlgeschlagen: Kanal ${channelId}`));
    if (message) {
      guildPanels[channelId] = String(message.id);
      registerProtectedMessage(guild.id, channelId, message.id);
    }
  }
  data.panels[voteStateKey(guild.id)] = guildPanels;
  await persist();
};

// Aktualisiert ALLE Live-Nachrichten sofort mit dem aktuellen Design:
// – die Moderations-Panels in den ausgewählten Calls
// – jede noch laufende Abstimmung (damit das neue Vote-Design sofort sichtbar
//   ist und nicht erst beim nächsten 1-Sekunden-Ticker-Tick greift)
// Die Nachrichten werden editiert (nicht neu gesendet) – nur Nachrichten, die
// nicht mehr existieren, werden neu erzeugt. Läuft parallel, blockiert nichts.
export const refreshPublicCallVoteLive = async ({ guild, conf }) => {
  if (!guild || !conf) return;
  const normalized = normalizePublicCallVoteConfig(conf);
  try {
    // Der Live-Refresh muss den vollständigen Soll-Zustand herstellen. Ein
    // reines Editieren vorhandener IDs ließ gelöschte oder noch nie erzeugte
    // Panels dauerhaft verschwunden, obwohl das Embed-Studio Erfolg meldete.
    await ensurePublicVotePanels({ guild, conf: normalized });

    const data = await ensureLoaded();
    const guildKey = voteStateKey(guild.id);

      // Laufende Abstimmungen mit dem neuen Vote-Design aktualisieren.
      //    Die Vote-ID steckt im Map-Key, nicht im Objekt – daher entries.
      //    Auch hier parallel, damit nichts sequenziell wartet.
      const guildVotes = data.votes[guildKey] || {};
      const voteTasks = Object.entries(guildVotes).map(async ([voteId, vote]) => {
        if (!vote || vote.settled) return;
        const panelChannel = guild.channels.cache.get(String(vote.panelChannelId));
        let message = panelChannel?.messages?.cache?.get(String(vote.messageId));
        if (!message && panelChannel?.messages?.fetch) {
          message = await panelChannel.messages.fetch(String(vote.messageId)).catch((error) => {
            quietLog(QUIET_LOG_SCOPE.publicCallVote, error, `panelChannel.messages.fetch fehlgeschlagen: ${vote.messageId}`);
            return null;
          });
        }
        if (message) {
          await message.edit({ embeds: [voteEmbed(vote, guild, normalized)], components: voteComponents(voteId, normalized) }).catch((error) => {
            quietLog(QUIET_LOG_SCOPE.publicCallVote, error, `Vote-Embed-Edit fehlgeschlagen: ${vote.messageId}`);
          });
        }
      });
      await Promise.allSettled(voteTasks);
    } catch (error) {
      console.warn(`[publicCallVote] Live-Refresh fehlgeschlagen: ${error?.message || error}`);
    }
  };

// Zeigt nur Mitglieder, die tatsächlich im selben öffentlichen Call sitzen wie der
// Beantrager – kein Server-weiter User-Picker, damit die Abstimmung zum Call passt.
const showVoteTargetPicker = (interaction, guild, conf) => {
  const caller = interaction.member;
  const call = caller?.voice?.channel;
  if (!call || !isCallChannel(call) || !allCallChannelIds(conf).includes(String(call.id))) {
    void respondTo(interaction, {
      content: 'Du musst dafür selbst in einem der ausgewählten öffentlichen Calls sein.',
      flags: MessageFlags.Ephemeral
    }).catch(() => null);
    return;
  }
  const attendees = [...(call.members?.values() || [])]
    .filter((member) => !isBot(member) && String(member.id) !== String(caller.id));
  if (!attendees.length) {
    void respondTo(interaction, {
      content: 'In diesem Call sind gerade keine anderen Mitglieder, die man zur Abstimmung stellen könnte.',
      flags: MessageFlags.Ephemeral
    }).catch(() => null);
    return;
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${PREFIX}vote:pick`)
    .setPlaceholder('Wen möchtest du zur Abstimmung stellen?')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(attendees.slice(0, 25).map((member) => ({
      label: String(member.displayName || member.user?.username || 'Unbekannt').slice(0, 100),
      value: String(member.id)
    })));
  void respondTo(interaction, {
    content: `Wähle das Mitglied, das aus **${call.name}** entfernt werden soll:`,
    components: [new ActionRowBuilder().addComponents(select)],
    flags: MessageFlags.Ephemeral
  }).catch(() => null);
};

const showVoteReasonPicker = (interaction, targetUserId, conf) => {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${PREFIX}vote:reason:${targetUserId}`)
    .setPlaceholder('Grund für den Rauswurf wählen')
    .addOptions(conf.voteReasons.map((reason) => ({
      label: reason.label,
      description: `${reason.kickMinutes} Min. Call-Sperre${reason.timeoutAfter ? ` · Timeout nach ${reason.timeoutAfter}x` : ''}${reason.needsText ? ' · Freitext-Grund' : ''}`.slice(0, 100),
      value: reason.id
    })));
  void respondTo(interaction, {
    content: 'Wähle den Grund für den Rauswurf:',
    components: [new ActionRowBuilder().addComponents(select)],
    flags: MessageFlags.Ephemeral
  }).catch(() => null);
};

const findVoteChannel = async (guild, targetMember, conf) => {
  if (!targetMember?.voice?.channel) return null;
  const channel = targetMember.voice.channel;
  if (!isCallChannel(channel)) return null;
  if (!allCallChannelIds(conf).includes(String(channel.id))) return null;
  return channel;
};

const countStrikes = async (guildId, userId, reasonId) => {
  const data = await ensureLoaded();
  const guildStrikes = data.strikes[voteStateKey(guildId)] || {};
  const now = Date.now();
  return (guildStrikes[String(userId)] || [])
    .filter((strike) => !strike.reasonId || strike.reasonId === reasonId)
    .filter((strike) => now - Number(strike.at || 0) < strikeWindowMs).length;
};

const sendTeamNotice = async ({ guild, vote, reason, targetMember, recentStrikes, timedOut, conf: confOverride }) => {
  const conf = confOverride || configFor(guild.id);
  if (!conf.teamChannelId) return;
  const teamChannel = guild.channels.cache.get(String(conf.teamChannelId))
    || await guild.channels.fetch(String(conf.teamChannelId)).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.publicCallVote, error, `teamChannel fetch fehlgeschlagen: ${conf.teamChannelId}`);
      return null;
    });
  if (!teamChannel?.isTextBased?.() || typeof teamChannel.send !== 'function') return;

  const rolePing = conf.teamRoleIds
    .map((roleId) => `<@&${roleId}>`)
    .filter(Boolean)
    .join(' ');

  const design = conf.design[designSectionFor(vote.channelId, 'team', conf)];
  const context = {
    ...voteContext(vote, guild, conf),
    outcome: '✅ Rauswurf beschlossen',
    outcomeText: conf.passedOutcomeText || 'wird entfernt',
    kickMinutes: String(reason?.kickMinutes || 10),
    strikes: String(recentStrikes)
  };
  const embed = new EmbedBuilder()
    .setColor(embedDesignColor(design.color))
    .setTitle(formatVoteText(design.title, context, 256))
    .setDescription(formatVoteText(design.description, context, 4096));
  const author = designAuthor(design, targetAvatarUrl(guild, vote.targetUserId), context);
  if (author) embed.setAuthor(author);
  if (design.thumbnailUrl) embed.setThumbnail(design.thumbnailUrl);
  if (design.imageUrl) embed.setImage(design.imageUrl);
  const fields = designSectionFields(design, context);
  if (fields.length) embed.addFields(fields);
  if (timedOut) {
    embed.addFields({ name: '⏱️ Server-Timeout', value: `**${reason?.timeoutMinutes || 60} Min.** (wiederholter Verstoß)`, inline: false });
  }
  designFooter(embed, design, context);

  await teamChannel.send({
    content: rolePing ? `${rolePing} – Rauswurf im öffentlichen Call` : undefined,
    embeds: [embed],
    // User-Mentions (Betroffener + Beantrager) und Team-Rollen dürfen pingen.
    allowedMentions: { parse: ['users'], roles: conf.teamRoleIds }
  }).catch((error) => {
    console.warn(`[publicCallVote] Team-Benachrichtigung fehlgeschlagen: ${error?.message || error}`);
  });
};

// DM an das rausgeworfene Mitglied – Embed kommt aus der editierbaren
// Design-Sektion „dm“, damit die Warnung mit Avatar und eigenem Text erscheint.
const sendKickDm = async ({ guild, vote, reason, targetMember, conf: confOverride }) => {
  if (!targetMember || typeof targetMember.send !== 'function') return;
  const conf = confOverride || configFor(guild.id);
  const design = conf.design[designSectionFor(vote.channelId, 'dm', conf)];
  const context = {
    ...voteContext(vote, guild, conf),
    outcome: '🚫 Rauswurf beschlossen',
    outcomeText: conf.passedOutcomeText || 'wird entfernt',
    kickMinutes: String(reason?.kickMinutes || 10),
    strikes: '0'
  };
  const embed = new EmbedBuilder()
    .setColor(embedDesignColor(design.color))
    .setTitle(formatVoteText(design.title, context, 256))
    .setDescription(formatVoteText(design.description, context, 4096));
  const author = designAuthor(design, targetAvatarUrl(guild, vote.targetUserId), context);
  if (author) embed.setAuthor(author);
  if (design.thumbnailUrl) embed.setThumbnail(design.thumbnailUrl);
  if (design.imageUrl) embed.setImage(design.imageUrl);
  designFooter(embed, design, context);
  await targetMember.send({ embeds: [embed] })
    .catch((error) => quietLog(QUIET_LOG_SCOPE.publicCallVote, error, `Kick-DM fehlgeschlagen an User ${vote.targetUserId}`));
};

// DM an das Mitglied, sobald seine Call-Sperre abgelaufen ist – „wieder frei“.
// Das Embed kommt aus der editierbaren Sektion „release“ (bzw. release2/3/4 je
// Call-Typ). Wird von releaseCallLock nur bei echter Ablauf-Freigabe ausgelöst.
const sendLockReleaseDm = async ({ guild, userId, lock, conf: confOverride }) => {
  if (!guild || !userId || !lock) return;
  const conf = confOverride || configFor(guild.id);
  const member = guild.members?.cache?.get(String(userId))
    || await guild.members?.fetch?.(String(userId)).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.publicCallVote, error, `members.fetch (Lock) fehlgeschlagen: ${userId}`);
      return null;
    })
    || null;
  if (!member || typeof member.send !== 'function') return;
  const reason = conf.voteReasons.find((entry) => entry.id === lock.reasonId) || conf.voteReasons[0];
  const lockMinutes = Math.max(1, Math.round((Number(lock.until || 0) - Number(lock.at || 0)) / 60_000));
  const design = conf.design[designSectionFor(lock.channelId, 'release', conf)];
  const context = {
    server: guild.name || '',
    target: String(member.displayName || member.user?.username || 'Unbekannt'),
    targetMention: `<@${userId}>`,
    channel: `<#${lock.channelId}>`,
    reason: reason?.label || 'Sonstiges',
    kickMinutes: String(lockMinutes)
  };
  const embed = new EmbedBuilder()
    .setColor(embedDesignColor(design.color))
    .setTitle(formatVoteText(design.title, context, 256))
    .setDescription(formatVoteText(design.description, context, 4096));
  const author = designAuthor(design, member.displayAvatarURL?.(), context);
  if (author) embed.setAuthor(author);
  if (design.thumbnailUrl) embed.setThumbnail(design.thumbnailUrl);
  if (design.imageUrl) embed.setImage(design.imageUrl);
  designFooter(embed, design, context);
  await member.send({ embeds: [embed] })
    .catch((error) => quietLog(QUIET_LOG_SCOPE.publicCallVote, error, `Freigabe-DM fehlgeschlagen an User ${userId}`));
};

const applyVoteOutcome = async ({ guild, vote, conf, interaction }) => {
  const reason = conf.voteReasons.find((entry) => entry.id === vote.reasonId) || conf.voteReasons[0];

  // Mitglied kommt aus dem Cache – wer im Call sitzt, ist dort praktisch immer
  // vorhanden. Nur bei Bedarf wird nachgeladen.
  let targetMember = guild.members?.cache?.get(String(vote.targetUserId));
  if (!targetMember) {
    targetMember = await guild.members.fetch(String(vote.targetUserId)).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.publicCallVote, error, `members.fetch (Target) fehlgeschlagen: ${vote.targetUserId}`);
      return null;
    });
  }

  // 1. SOFORT aus dem Call entfernen – der Kick wird ausgelöst und läuft
  //    parallel weiter. Er wartet NICHT auf Datei-Persistenz oder die Antwort,
  //    damit der Rauswurf sofort sichtbar ist.
  const kickPromise = (targetMember && targetMember.voice?.channelId === String(vote.channelId))
    ? targetMember.voice.disconnect('Rauswurf per Community-Abstimmung')
      .catch((error) => quietLog(QUIET_LOG_SCOPE.publicCallVote, error, `Kick (Disconnect) fehlgeschlagen für User ${vote.targetUserId}`))
    : Promise.resolve();

  // 2. Strike-Zähler (in-memory, schnell) – entscheidet über den Server-Timeout.
  const recentStrikes = await countStrikes(guild.id, vote.targetUserId, vote.reasonId);
  const totalStrikes = recentStrikes + 1;
  const timedOut = Boolean(targetMember) && totalStrikes >= Number(reason?.timeoutAfter || 3);

  // 3. Antwort SOFORT – der Kick läuft bereits. Persistenz und die restlichen
  //    Schritte dürfen die sichtbare Bestätigung nicht aufhalten.
  const replyText = `🚫 **${vote.targetName}** wurde aus <#${vote.channelId}> entfernt (${vote.reasonText || reason?.label || 'Verstoß'}).`
    + `\nCall-Sperre: **${reason?.kickMinutes || 10} Min.**`
    + (timedOut ? `\n⏱️ Server-Timeout: **${reason?.timeoutMinutes || 60} Min.** (wiederholter Verstoß)` : '');
  if (interaction) {
    await respondTo(interaction, { content: replyText, flags: MessageFlags.Ephemeral })
      .catch((error) => quietLog(QUIET_LOG_SCOPE.publicCallVote, error, 'Abstimmungsergebnis konnte nicht gesendet werden'));
  }

  // 4. Strike persistieren und Kick-Abschluss parallel abwarten – erst danach
  //    ist der Rauswurf vollständig verarbeitet (State-Datei + Disconnect).
  const strikePersistPromise = (async () => {
    const data = await ensureLoaded();
    const guildStrikes = data.strikes[voteStateKey(guild.id)] || {};
    const userStrikes = guildStrikes[String(vote.targetUserId)] || [];
    userStrikes.push({ at: Date.now(), reasonId: vote.reasonId, channelId: String(vote.channelId) });
    guildStrikes[String(vote.targetUserId)] = userStrikes;
    data.strikes[voteStateKey(guild.id)] = guildStrikes;
    await persist().catch((error) => {
      quietLog(QUIET_LOG_SCOPE.publicCallVote, error, `persist fehlgeschlagen nach Vote-Evaluation`);
    });
  })();
  await Promise.allSettled([kickPromise, strikePersistPromise]);

  // 5. Kanal-Sperre, Server-Timeout und Benachrichtigungen parallel im
  //    Hintergrund – sie sind für den sichtbaren Kick nicht mehr nötig. Die
  //    Sperre ist persistent (Endzeit in der State-Datei), übersteht Neustarts
  //    und Offline-Zeiten; der Live-Timer gibt die Permission pünktlich frei.
  void (async () => {
    if (targetMember) {
      const lockMs = Math.max(60_000, Number(reason?.kickMinutes || 10) * 60_000);
      await activateCallLock({
        guild,
        guildId: guild.id,
        userId: String(vote.targetUserId),
        channelId: String(vote.channelId),
        lockMs,
        reasonId: String(reason?.id || '')
      }).catch(() => null);
      if (timedOut) {
        const timeoutMinutes = Math.max(1, Number(reason?.timeoutMinutes || 60));
        await targetMember.timeout(timeoutMinutes * 60_000, `Wiederholte Verstöße in öffentlichem Call (${reason.label})`).catch((error) => {
          quietLog(QUIET_LOG_SCOPE.publicCallVote, error, `timeout fehlgeschlagen: ${targetMember.user?.tag}`);
        });
      }
    }
    await sendTeamNotice({ guild, vote, reason, targetMember, recentStrikes: totalStrikes, timedOut }).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.publicCallVote, error, `sendTeamNotice fehlgeschlagen: Vote ${vote.targetUserId}`);
    });
    await sendKickDm({ guild, vote, reason, targetMember }).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.publicCallVote, error, `sendKickDm fehlgeschlagen: ${targetMember.user?.tag}`);
    });
  })();

  return replyText;
};

const settleVote = async ({ guild, voteId, conf, interaction, passed }) => {
  const data = await ensureLoaded();
  const guildVotes = data.votes[voteStateKey(guild.id)] || {};
  const vote = guildVotes[voteId];
  if (!vote || vote.settled) return null;
  vote.settled = true;
  guildVotes[voteId] = vote;
  data.votes[voteStateKey(guild.id)] = guildVotes;
  await persist();
  const pendingTimer = voteTimers.get(voteId);
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    voteTimers.delete(voteId);
  }

  // Vote-Nachricht abschließen + Schutz aufheben. Falls die Nachricht nicht
  // mehr im Cache liegt (Neustart), wird sie direkt geholt, damit die Buttons
  // zuverlässig verschwinden und kein „abgelaufen“-Klick mehr möglich ist.
  stopVoteTicker(voteId);
  unregisterProtectedMessage(guild.id, vote.panelChannelId, vote.messageId);

  // Bei bestandenem Rauswurf startet der Kick SOFORT (eigener Promise) – die
  // Ergebnis-Nachricht wird parallel fertiggestellt, damit nichts den
  // sichtbaren Kick aufhält.
  const outcomePromise = passed
    ? applyVoteOutcome({ guild, vote, conf, interaction })
    : Promise.resolve(null);

  // Ergebnis-Nachricht im Hintergrund editieren (nicht blockierend): Der
  // Ergebnis-Embed kommt aus der editierbaren Design-Sektion „result“ und wird
  // nach resultAutoDeleteSeconds automatisch gelöscht. Die Nachricht wird nur
  // bei Bedarf von Discord geholt (z.B. nach Neustart), damit die Buttons
  // zuverlässig verschwinden.
  void (async () => {
    const panelChannel = guild.channels.cache.get(String(vote.panelChannelId));
    let message = panelChannel?.messages?.cache?.get(String(vote.messageId));
    if (!message && panelChannel?.messages?.fetch) {
      message = await panelChannel.messages.fetch(String(vote.messageId)).catch((error) => {
        quietLog(QUIET_LOG_SCOPE.publicCallVote, error, `Final-Embed fetch fehlgeschlagen: ${vote.messageId}`);
        return null;
      });
    }
    if (message) {
      const finalEmbed = resultEmbed(vote, guild, conf, passed);
      await message.edit({ embeds: [finalEmbed], components: [] }).catch((error) => {
        quietLog(QUIET_LOG_SCOPE.publicCallVote, error, `Final-Embed edit fehlgeschlagen: ${vote.messageId}`);
      });
      scheduleResultAutoDelete({ message, conf });
    }
  })();

  return outcomePromise;
};

const voteTimeoutMs = (conf) => Math.max(15_000, Number(conf.timeoutSeconds || 60) * 1000);

// Verbleibende Zeit bis zum Abstimmungsende – für Timer, die exakt bei 0
// feuern sollen (Countdown-Anzeige und Entscheidung bleiben synchron).
const remainingVoteMs = (vote) => Math.max(0, Number(vote?.endsAt || 0) - Date.now());

// Wartet bis zur nächsten Sekunden-Grenze relativ zu endsAt: Bei 59,75 s
// Restzeit (Anzeige 60) feuert der nächste Tick in 750 ms, danach exakt jede
// Sekunde – die Anzeige zählt 60, 59, 58, … ohne Lücken. Reine Mathematik,
// damit der Countdown im Test sekundengenau prüfbar ist.
export const voteCountdownDelay = (endsAt, now) => {
  const remainingMs = Math.max(0, Number(endsAt || 0) - now);
  if (remainingMs <= 0) return 0;
  const displayed = Math.ceil(remainingMs / 1000);
  return Math.max(50, remainingMs - (displayed - 1) * 1000);
};

// Startet den sekundengenauen Countdown-Ticker einer laufenden Abstimmung. Der
// Ticker plant sich selbst als setTimeout-Kette exakt auf die Sekunden-Grenzen
// relativ zu endsAt – dadurch zählt die Restzeit-Anzeige jede Sekunde um genau
// 1 herunter (kein setInterval-Drift, keine übersprungenen Zahlen). Die
// Nachricht wird nur bearbeitet, wenn sich die Restzeit geändert hat –
// Rate-Limits bleiben unkritisch und die Buttons bleiben erhalten.
const startVoteTicker = ({ guild, voteId, conf }) => {
  stopVoteTicker(voteId);
  let timer = null;
  let lastVoteSignature = '';
  const tick = async () => {
    try {
      const data = await ensureLoaded();
      const vote = (data.votes[voteStateKey(guild.id)] || {})[voteId];
      if (!vote || vote.settled) {
        stopVoteTicker(voteId);
        return;
      }
      const remainingMs = Number(vote.endsAt || 0) - Date.now();
      if (remainingMs <= 0) {
        // Countdown ist bei 0 angekommen – der Vote-Timer entscheidet jetzt.
        stopVoteTicker(voteId);
        return;
      }
      // <t:...:R> wird von Discord automatisch client-seitig aktualisiert –
      // das Embed muss nur aktualisiert werden, wenn sich Abstimmungsdaten
      // (Ja/Nein/Zähler/Progress) geändert haben.
      const voteSignature = `${(vote.yes || []).length}:${(vote.no || []).length}:${vote.attendingCount || 0}`;
      if (voteSignature !== lastVoteSignature) {
        lastVoteSignature = voteSignature;
        const panelChannel = guild.channels.cache.get(String(vote.panelChannelId));
        const message = panelChannel?.messages?.cache?.get(String(vote.messageId));
        if (message) {
          const fresh = voteEmbed(vote, guild, conf);
          await message.edit({ embeds: [fresh], components: voteComponents(voteId, conf) }).catch((error) => {
            quietLog(QUIET_LOG_SCOPE.publicCallVote, error, `Refresh-Embed edit fehlgeschlagen: ${voteId}`);
          });
        }
      }
      timer = setTimeout(tick, voteCountdownDelay(vote.endsAt, Date.now()));
      timer.unref?.();
      voteTickers.set(voteId, timer);
    } catch {
      // Ein fehlgeschlagener Tick darf die Abstimmung nie kaputt machen.
      timer = setTimeout(tick, 1000);
      timer.unref?.();
      voteTickers.set(voteId, timer);
    }
  };
  timer = setTimeout(tick, 0);
  timer.unref?.();
  voteTickers.set(voteId, timer);
};

const stopVoteTicker = (voteId) => {
  const existing = voteTickers.get(voteId);
  if (existing) clearTimeout(existing);
  voteTickers.delete(voteId);
};

// Ergebnis-Nachricht („Rauswurf beschlossen / abgelehnt“) automatisch nach
// resultAutoDeleteSeconds löschen – die Abstimmungs-Nachricht wird zum Ergebnis
// bearbeitet und verschwindet danach von selbst.
const scheduleResultAutoDelete = ({ message, conf }) => {
  if (!message || typeof message.delete !== 'function') return;
  const deleteMs = Math.max(5_000, Number(conf?.resultAutoDeleteSeconds || 30) * 1000);
  const timer = setTimeout(() => {
    void message.delete().catch((error) => {
      quietLog(QUIET_LOG_SCOPE.publicCallVote, error, `DM-Delete fehlgeschlagen: ${message.id}`);
    });
  }, deleteMs);
  timer.unref?.();
};

const armVoteTimer = ({ guild, voteId, conf, delayMs }) => {
  const existing = voteTimers.get(voteId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    voteTimers.delete(voteId);
    void evaluateVote({ guild, voteId, conf }).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.publicCallVote, error, `evaluateVote fehlgeschlagen: ${voteId}`);
    });
  }, delayMs);
  timer.unref?.();
  voteTimers.set(voteId, timer);
};

// Noch niemand hat abgestimmt → Abstimmung verlängern (inkl. Restzeit-Anzeige
// in der Nachricht). Gibt true zurück, wenn verlängert wurde.
const extendVote = async ({ guild, voteId, conf }) => {
  const data = await ensureLoaded();
  const guildVotes = data.votes[voteStateKey(guild.id)] || {};
  const vote = guildVotes[voteId];
  if (!vote || vote.settled) return false;
  const extensions = Math.max(0, Number(vote.extensions || 0));
  if (extensions >= MAX_VOTE_EXTENSIONS) return false;
  vote.extensions = extensions + 1;
  vote.endsAt = Date.now() + voteTimeoutMs(conf);
  guildVotes[voteId] = vote;
  data.votes[voteStateKey(guild.id)] = guildVotes;
  await persist();
  const panelChannel = guild.channels.cache.get(String(vote.panelChannelId));
  const message = panelChannel?.messages?.cache?.get(String(vote.messageId));
  if (message) {
    await message.edit({ embeds: [voteEmbed(vote, guild, conf)], components: voteComponents(voteId, conf) }).catch(() => null);
  }
  return true;
};

const evaluateVote = async ({ guild, voteId, conf, interaction }) => {
  const data = await ensureLoaded();
  const vote = (data.votes[voteStateKey(guild.id)] || {})[voteId];
  if (!vote || vote.settled) return null;
  const yes = Number(vote.yes?.length || 0);
  const no = Number(vote.no?.length || 0);
  const attending = Math.max(1, Number(vote.attendingCount || 0));
  const requiredYes = requiredYesFor(vote.attendingCount, conf, vote.channelId);
  const percent = Math.max(1, Number(conf.passPercent || 51));
  // Echte Mehrheit: mehr „dafür“ als „dagegen“. In 2er-/3er-Calls reicht die
  // Schwelle (1 bzw. 2 Stimmen) plus Mehrheit – ein 1:1 darf nicht kicken.
  // In 4er-Calls (Schwelle 3) und größeren Calls greift zusätzlich die
  // konfigurierte Prozent-Hürde.
  const majority = yes > no;
  const passed = yes >= requiredYes && majority
    && (attending <= 3 || (yes / attending) * 100 >= percent);
  const timeUp = Date.now() >= Number(vote.endsAt || 0);
  if (passed) {
    return settleVote({ guild, voteId, conf, interaction, passed: true });
  }
  if (timeUp && yes + no === 0) {
    // Keine einzige Stimme abgegeben: verlängern statt still ablaufen zu lassen.
    // Erst wenn sich die Verlängerungen erschöpfen, endet die Abstimmung ohne
    // Beteiligung – und ein weiterer Klick auf die Buttons erklärt den Zustand.
    const extended = await extendVote({ guild, voteId, conf });
    if (extended) {
      // Timer exakt auf die neue Endzeit legen – die Abstimmung endet, sobald
      // der Countdown 0 erreicht, nicht erst eine Sekunde später.
      armVoteTimer({ guild, voteId, conf, delayMs: remainingVoteMs(vote) });
      return null;
    }
  }
  if (timeUp) {
    return settleVote({ guild, voteId, conf, interaction, passed: false });
  }
  return null;
};

// Antwortet auf eine Interaktion – nach deferReply per editReply, sonst per
// reply. So bleibt der Ablauf stabil, auch wenn die Verarbeitung (Fetches,
// Datei-Persistenz, Nachrichten-Send) länger als 3 Sekunden dauert.
const respondTo = (interaction, payload) => interaction?.deferred
  ? interaction.editReply(payload)
  : interaction.reply(payload);

// Startet eine Rauswurf-Abstimmung – gemeinsamer Pfad für normale Gründe und
// das „Sonstiges“-Modal mit Freitext. Legt den Vote im State an, sendet die
// Abstimmungs-Nachricht, armiert Timer + Countdown und entscheidet sofort,
// falls die Mehrheit schon erreicht ist (2er-Call mit Auto-Ja).
const startPublicVote = async ({ guild, interaction, conf, targetMember, call, reasonId, reasonText }) => {
  const attendingCount = Math.max(1, [...(call.members?.values() || [])].filter((member) => !isBot(member)).length);
  const voteId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const data = await ensureLoaded();
  const guildVotes = data.votes[voteStateKey(guild.id)] || {};
  // Der Beantrager stimmt automatisch dafür – er hat den Rauswurf ja
  // ausdrücklich angestoßen und muss nicht zusätzlich klicken.
  const requesterId = String(interaction.user.id);
  guildVotes[voteId] = {
    targetUserId: String(targetMember.id),
    targetName: String(targetMember.displayName || targetMember.user?.username || 'Unbekannt'),
    reasonId: String(reasonId || 'other'),
    reasonText: String(reasonText || '').trim().slice(0, 200),
    channelId: String(call.id),
    attendingCount,
    yes: [requesterId],
    no: [],
    startedBy: requesterId,
    startedByName: String(interaction.member?.displayName || interaction.user.username || 'Unbekannt'),
    startedAt: Date.now(),
    endsAt: Date.now() + Math.max(15_000, Number(conf.timeoutSeconds || 60) * 1000),
    messageId: '',
    panelChannelId: String(interaction.channelId || ''),
    settled: false
  };
  data.votes[voteStateKey(guild.id)] = guildVotes;
  await persist();

  const embed = voteEmbed(guildVotes[voteId], guild, conf);
  const message = await interaction.channel.send({
    embeds: [embed],
    components: voteComponents(voteId, conf),
    // {targetMention} im Embed soll den Betroffenen wirklich pingen.
    allowedMentions: { parse: ['users'] }
  }).catch(() => null);
  if (message) {
    guildVotes[voteId].messageId = String(message.id);
    data.votes[voteStateKey(guild.id)] = guildVotes;
    await persist();
    registerProtectedMessage(guild.id, interaction.channelId, message.id);
  }
  await respondTo(interaction, {
    content: `🗳️ Abstimmung über **${guildVotes[voteId].targetName}** gestartet. Mitglieder können jetzt abstimmen.`,
    flags: MessageFlags.Ephemeral
  }).catch(() => null);

  armVoteTimer({ guild, voteId, conf, delayMs: remainingVoteMs(guildVotes[voteId]) });
  startVoteTicker({ guild, voteId, conf });
  // Im 2er-Call ist die Auto-Ja-Stimme des Beantragers bereits die Mehrheit –
  // dann sofort entscheiden, damit der Kick nicht auf den Timer wartet.
  // (3er-/4er-Calls brauchen weitere Stimmen und warten auf den Timer bzw.
  // den nächsten Stimm-Klick.)
  await evaluateVote({ guild, voteId, conf, interaction }).catch(() => null);
  return voteId;
};

const handleVoteInteraction = async ({ interaction, guild, conf }) => {
  const customId = String(interaction.customId || '');
  if (!customId.startsWith(`${PREFIX}vote:`)) return false;

  if (!conf.enabled || !allCallChannelIds(conf).length) {
    await respondTo(interaction, { content: 'Die Call-Moderation ist auf diesem Server nicht aktiviert.', flags: MessageFlags.Ephemeral }).catch(() => null);
    return true;
  }

  // „Sonstiges“ (oder ein anderer Grund mit needsText) fragt den Grund als
  // Freitext ab: Das Modal muss SOFORT geöffnet werden – nach einer
  // Bestätigung (deferReply/deferUpdate) kann Discord kein Modal mehr zeigen.
  // Die Prüfung (Mitglied im Call) passiert deshalb erst beim Modal-Submit.
  if (interaction.isStringSelectMenu?.() && customId.startsWith(`${PREFIX}vote:reason:`)) {
    const targetUserId = customId.slice(`${PREFIX}vote:reason:`.length);
    const reasonId = String(interaction.values?.[0] || '');
    const reason = conf.voteReasons.find((entry) => entry.id === reasonId) || conf.voteReasons[0];
    if (reason?.needsText) {
      const modal = new ModalBuilder()
        .setCustomId(`${PREFIX}vote:reasonText:${targetUserId}:${reasonId}`)
        .setTitle('Rauswurf-Grund angeben')
        .addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('reasonText')
            .setLabel('Grund für den Rauswurf')
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(200)
            .setRequired(true)
            .setPlaceholder('z. B. Musik im Hintergrund, Beleidigung im Call, …')
        ));
      await interaction.showModal(modal)
        .catch((error) => quietLog(QUIET_LOG_SCOPE.publicCallVote, error, 'Grund-Modal konnte nicht geöffnet werden'));
      return true;
    }
  }

  // Sofort bestätigen (15-Minuten-Fenster), damit Discord kein Timeout wirft,
  // während wir Mitglieder laden, State speichern oder Nachrichten senden.
  if ((interaction.isButton?.() || interaction.isStringSelectMenu?.()) && typeof interaction.deferReply === 'function') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
  }

  if (interaction.isButton?.() && customId === `${PREFIX}vote:start`) {
    showVoteTargetPicker(interaction, guild, conf);
    return true;
  }

  if (interaction.isStringSelectMenu?.() && customId === `${PREFIX}vote:pick`) {
    const targetUserId = String(interaction.values?.[0] || '');
    const targetMember = await guild.members.fetch(targetUserId).catch(() => null);
    if (!targetMember || targetMember.user?.bot) {
      await respondTo(interaction, { content: 'Dieses Mitglied wurde nicht gefunden.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return true;
    }
    const call = await findVoteChannel(guild, targetMember, conf);
    if (!call) {
      await respondTo(interaction, { content: 'Das Mitglied ist gerade in keinem der ausgewählten öffentlichen Calls.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return true;
    }
    showVoteReasonPicker(interaction, targetUserId, conf);
    return true;
  }

  if (interaction.isStringSelectMenu?.() && customId.startsWith(`${PREFIX}vote:reason:`)) {
    const targetUserId = customId.slice(`${PREFIX}vote:reason:`.length);
    const reasonId = String(interaction.values?.[0] || '');
    const targetMember = await guild.members.fetch(String(targetUserId)).catch(() => null);
    if (!targetMember) {
      await respondTo(interaction, { content: 'Dieses Mitglied wurde nicht gefunden.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return true;
    }
    const call = await findVoteChannel(guild, targetMember, conf);
    if (!call) {
      await respondTo(interaction, { content: 'Das Mitglied ist gerade in keinem der ausgewählten öffentlichen Calls.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return true;
    }
    await startPublicVote({ guild, interaction, conf, targetMember, call, reasonId });
    return true;
  }

  // „Sonstiges“-Modal: Freitext-Grund ist eingetroffen → Abstimmung starten.
  if (interaction.isModalSubmit?.() && customId.startsWith(`${PREFIX}vote:reasonText:`)) {
    const parts = customId.slice(`${PREFIX}vote:reasonText:`.length).split(':');
    const targetUserId = String(parts[0] || '');
    const reasonId = String(parts.slice(1).join(':') || 'other');
    const reasonText = String(interaction.fields?.getTextInputValue?.('reasonText') || '').trim().slice(0, 200);
    if (!reasonText) {
      await respondTo(interaction, { content: 'Bitte gib einen Grund für den Rauswurf an.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return true;
    }
    const targetMember = await guild.members.fetch(String(targetUserId)).catch(() => null);
    if (!targetMember || targetMember.user?.bot) {
      await respondTo(interaction, { content: 'Dieses Mitglied wurde nicht gefunden.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return true;
    }
    const call = await findVoteChannel(guild, targetMember, conf);
    if (!call) {
      await respondTo(interaction, { content: 'Das Mitglied ist gerade in keinem der ausgewählten öffentlichen Calls.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return true;
    }
    await startPublicVote({ guild, interaction, conf, targetMember, call, reasonId, reasonText });
    return true;
  }

  if (interaction.isButton?.() && (customId.startsWith(`${PREFIX}vote:yes:`) || customId.startsWith(`${PREFIX}vote:no:`))) {
    // Custom-ID-Format: fh_pcv:vote:yes:<voteId> – das erste Segment ist die
    // Aktion, alles danach die Vote-ID. (Vorher wurde falsch destructured:
    // jeder Stimm-Klick fand den Vote nie und meldete „existiert nicht mehr“.)
    const parts = customId.slice(PREFIX.length).split(':');
    const action = String(parts[1] || '');
    const voteId = parts.slice(2).join(':');
    const data = await ensureLoaded();
    const guildVotes = data.votes[voteStateKey(guild.id)] || {};
    const vote = guildVotes[voteId];
    if (!vote) {
      await respondTo(interaction, { content: 'Diese Abstimmung existiert nicht mehr.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return true;
    }
    if (vote.settled) {
      await respondTo(interaction, { content: 'Diese Abstimmung ist bereits abgeschlossen.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return true;
    }
    const userId = String(interaction.user.id);
    // Die betroffene Person darf bei ihrer eigenen Abstimmung nicht mitstimmen.
    if (String(vote.targetUserId) === userId) {
      await respondTo(interaction, { content: 'Du kannst bei deiner eigenen Abstimmung nicht abstimmen.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return true;
    }
    // Nur Mitglieder, die tatsächlich im Call stecken, dürfen abstimmen – so
    // können Außenstehende das Ergebnis nicht mitbestimmen.
    const callChannel = guild.channels.cache.get(String(vote.channelId));
    const voterInCall = callChannel?.isVoiceBased?.()
      && [...(callChannel.members?.values() || [])].some((member) => String(member?.id) === userId);
    if (!voterInCall) {
      await respondTo(interaction, { content: 'Nur Mitglieder, die gerade im Call sind, können abstimmen.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return true;
    }
    const isYes = action === 'yes';
    vote.yes = (vote.yes || []).filter((id) => id !== userId);
    vote.no = (vote.no || []).filter((id) => id !== userId);
    (isYes ? vote.yes : vote.no).push(userId);
    guildVotes[voteId] = vote;
    data.votes[voteStateKey(guild.id)] = guildVotes;
    await persist();

    // Erst entscheiden, ob diese Stimme die Abstimmung schon kippt – der Kick
    // darf nicht hinter dem Panel-Update oder der Bestätigung warten. Wenn die
    // Abstimmung entschieden ist, antwortet applyVoteOutcome mit dem Ergebnis.
    const settled = await evaluateVote({ guild, voteId, conf, interaction }).catch(() => null);
    if (!settled) {
      await respondTo(interaction, { content: isYes ? '✅ Stimme gezählt.' : '❌ Stimme gezählt.', flags: MessageFlags.Ephemeral }).catch(() => null);
      const panelChannel = guild.channels.cache.get(String(vote.panelChannelId));
      const message = panelChannel?.messages?.cache?.get(String(vote.messageId));
      if (message) {
        await message.edit({ embeds: [voteEmbed(vote, guild, conf)], components: voteComponents(voteId, conf) }).catch(() => null);
      }
    }
    return true;
  }

  return true;
};

const handleAnyInteraction = async ({ interaction, cfg }) => {
  const conf = normalizePublicCallVoteConfig(cfg?.publicCallVote);
  const customId = String(interaction?.customId || '');
  if (!customId.startsWith(PREFIX)) return;
  if (!interaction.inGuild?.() && !interaction.guildId) {
    await interaction.reply({ content: 'Dieses Interface funktioniert nur auf einem Server.', flags: MessageFlags.Ephemeral }).catch(() => null);
    return;
  }
  const guild = interaction.guild;
  guildConfigs.set(String(guild.id), conf);
  await handleVoteInteraction({ interaction, guild, conf }).catch((error) => {
    console.warn(`[publicCallVote] Vote-Interaktion fehlgeschlagen: ${error?.message || error}`);
  });
};

const cleanupMissingChannels = async (guild) => {
  const data = await ensureLoaded();
  const guildPanels = data.panels[voteStateKey(guild.id)] || {};
  for (const [channelId, messageId] of Object.entries(guildPanels)) {
    const channel = guild.channels.cache.get(String(channelId));
    if (!channel) {
      unregisterProtectedMessage(guild.id, channelId, messageId);
      delete guildPanels[String(channelId)];
    }
  }
  data.panels[voteStateKey(guild.id)] = guildPanels;
  await persist();
};

export const feature = {
  id: 'publicCallVote',
  name: 'Public-Call-Moderation',
  commands: [],
  async onClientReady({ guild, cfg }) {
    await ensureLoaded();
    const conf = normalizePublicCallVoteConfig(cfg?.publicCallVote);
    guildConfigs.set(String(guild.id), conf);
    await cleanupMissingChannels(guild).catch(() => null);
    // Persistente Call-Sperren nach Neustart/Offline-Zeit wiederherstellen:
    // abgelaufene sofort freigeben, laufende mit Restzeit neu timen.
    await restoreCallLocks(guild).catch((error) => {
      console.warn(`[publicCallVote] Call-Sperren für ${guild.name} konnten nicht wiederhergestellt werden: ${error?.message || error}`);
    });
    void ensurePublicVotePanels({ guild, conf }).catch((error) => {
      console.error(`[publicCallVote] Vote-Panel für ${guild.name} fehlgeschlagen: ${error?.message || error}`);
      console.error(`[publicCallVote] Stack: ${error?.stack || 'kein Stack-Trace'}`);
    });
  },
  async onVoiceStateUpdate({ newState, guild }) {
    // Event-basierte Entsperrung: tritt ein User einem gesperrten Call bei und
    // die Sperre ist bereits abgelaufen, wird sie sofort entfernt – kein
    // periodisches Abfragen nötig.
    await handleVoiceStateForLocks(newState, guild).catch((error) => {
      console.warn(`[publicCallVote] Sperren-Check beim Voice-Join fehlgeschlagen: ${error?.message || error}`);
    });
  },
  async onConfigUpdate({ guild, cfg, patch }) {
    if (!patch || !Object.prototype.hasOwnProperty.call(patch, 'publicCallVote')) return;
    const conf = normalizePublicCallVoteConfig(cfg?.publicCallVote);
    guildConfigs.set(String(guild.id), conf);
    // Sofortiger Live-Abgleich: Panels editieren UND laufende Abstimmungen mit
    // dem neuen Design aktualisieren – ohne auf den nächsten Sync zu warten.
    void ensurePublicVotePanels({ guild, conf }).catch((error) => {
      console.error(`[publicCallVote] Vote-Panel-Update für ${guild.name} fehlgeschlagen: ${error?.message || error}`);
      console.error(`[publicCallVote] Stack: ${error?.stack || 'kein Stack-Trace'}`);
    });
    void refreshPublicCallVoteLive({ guild, conf }).catch((error) => {
      console.warn(`[publicCallVote] Live-Refresh für ${guild.name} fehlgeschlagen: ${error?.message || error}`);
    });
  },
  async onAnyInteraction(context) {
    await handleAnyInteraction(context).catch((error) => {
      console.warn(`[publicCallVote] Interface-Interaktion fehlgeschlagen: ${error?.message || error}`);
      if (!context?.interaction?.replied && !context?.interaction?.deferred) {
        void context.interaction.reply({ content: 'Das Interface konnte gerade nicht verarbeitet werden.', flags: MessageFlags.Ephemeral }).catch(() => null);
      }
    });
  }
};

export const getPublicCallVoteStrikes = async (guildId, userId) => {
  const data = await ensureLoaded();
  const guildStrikes = data.strikes[voteStateKey(guildId)] || {};
  return (guildStrikes[String(userId || '')] || [])
    .slice(-10)
    .map((strike) => ({
      reasonId: String(strike?.reasonId || ''),
      channelId: String(strike?.channelId || ''),
      at: Number(strike?.at || 0)
    }));
};

// Speichert die Design-Sektion eines Embed-Studios (panel/vote/result/team/dm)
// in die normalisierte Modul-Config. Wird vom Dashboard-Endpoint aufgerufen.
export const savePublicCallVoteDesign = async ({ guild, conf = {}, section = 'panel', template = {} } = {}) => {
  if (!guild) throw new Error('Server wurde nicht gefunden.');
  const sectionId = VOTE_DESIGN_SECTIONS.includes(String(section)) ? String(section) : 'panel';
  const sources = Array.isArray(template?.embeds) && template.embeds.length ? template.embeds : [template?.embed || template];
  const embed = sources.find((entry) => entry && typeof entry === 'object') || {};
  const normalized = normalizePublicCallVoteConfig(conf);
  const normalizedDesign = {
    ...normalized.design,
    [sectionId]: normalizeDesignSection(sectionId, embed)
  };
  return {
    section: sectionId,
    design: { [sectionId]: normalizedDesign[sectionId] },
    normalizedDesign
  };
};

export const getPublicCallVoteSnapshot = async (guildId) => {
  const data = await ensureLoaded();
  const conf = configFor(guildId);
  const guildPanels = data.panels[voteStateKey(guildId)] || {};
  const openVotes = Object.values(data.votes[voteStateKey(guildId)] || {})
    .filter((vote) => vote && !vote.settled)
    .length;
  const strikeCount = Object.values(data.strikes[voteStateKey(guildId)] || {})
    .reduce((sum, strikes) => sum + (Array.isArray(strikes) ? strikes.length : 0), 0);
  return {
    enabled: conf.enabled,
    callChannelCount: allCallChannelIds(conf).length,
    call2Count: conf.callChannelIds2.length,
    call3Count: conf.callChannelIds3.length,
    call4Count: conf.callChannelIds4.length,
    panelCount: Object.keys(guildPanels).length,
    openVoteCount: openVotes,
    strikeCount,
    teamChannelId: conf.teamChannelId,
    teamRoleCount: conf.teamRoleIds.length
  };
};

export const _publicCallVoteInternals = {
  normalizePublicCallVoteConfig,
  normalizeVoteReasons,
  allCallChannelIds,
  requiredYesFor,
  DEFAULT_VOTE_REASONS,
  countStrikes,
  evaluateVote,
  extendVote,
  settleVote,
  applyVoteOutcome,
  handleVoteInteraction,
  registerProtectedMessage,
  unregisterProtectedMessage,
  isProtectedPublicCallVoteMessage,
  selectedCallChannels,
  showVoteTargetPicker,
  startVoteTicker,
  stopVoteTicker,
  scheduleResultAutoDelete,
  panelComponents,
  voteComponents,
  sendKickDm,
  sendTeamNotice,
  sendLockReleaseDm,
  startPublicVote,
  savePublicCallVoteDesign,
  refreshPublicCallVoteLive,
  seedPublicCallVoteState,
  designSectionFor,
  activateCallLock,
  releaseCallLock,
  restoreCallLocks,
  handleVoiceStateForLocks,
  isLockActive,
  getPublicCallVoteLocks,
  getPublicCallVoteLocksList,
  removePublicCallVoteLock,
  voteCountdownDelay,
  respondTo,
  voteContext,
  formatVoteText,
  resultEmbed,
  PREFIX
};
