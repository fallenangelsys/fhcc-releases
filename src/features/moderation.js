import path from 'node:path';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits
} from 'discord.js';
import { atomicWriteJson, readJsonWithRecovery } from '../runtime/atomicJsonStore.js';
import { quietLog, QUIET_LOG_SCOPE } from '../runtime/quietLog.js';
import { finiteInteger } from '../runtime/utils.js';
import { DATA_DIR } from '../shared/paths.js';

const DATA_ROOT = DATA_DIR;
const INCIDENT_FILE = path.join(DATA_ROOT, 'moderation-incidents.json');
const STORE_VERSION = 2;
const MAX_INCIDENTS_PER_MEMBER = 250;
const antiSpamWindows = new Map();
const muteTimers = new Map();
let mutationQueue = Promise.resolve();

const emptyStore = () => ({ version: STORE_VERSION, guilds: {} });
const settings = (cfg) => cfg?.moderation || {};
const severityRank = { light: 1, medium: 2, high: 3, critical: 4 };
const highestSeverity = (left, right) => severityRank[right] > severityRank[left] ? right : left;
const normalizeText = (value) => String(value || '')
  .normalize('NFKC')
  .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
  .toLocaleLowerCase('de-DE')
  .replace(/[4@]/g, 'a')
  .replace(/[3]/g, 'e')
  .replace(/[1|]/g, 'i')
  .replace(/[0]/g, 'o')
  .replace(/[5$]/g, 's');
const normalizeTerms = (value) => (Array.isArray(value) ? value : [])
  .map((entry) => normalizeText(entry).trim())
  .filter(Boolean)
  .slice(0, 500);
const containsTerm = (text, term) => {
  if (!term) return false;
  const letterOrNumber = /[\p{L}\p{N}]/u;
  const termStartsWord = letterOrNumber.test(term[0] || '');
  const termEndsWord = letterOrNumber.test(term[term.length - 1] || '');
  let offset = 0;
  while (offset <= text.length - term.length) {
    const index = text.indexOf(term, offset);
    if (index < 0) return false;
    const before = index > 0 ? text[index - 1] : '';
    const after = index + term.length < text.length ? text[index + term.length] : '';
    if ((!termStartsWord || !letterOrNumber.test(before)) && (!termEndsWord || !letterOrNumber.test(after))) return true;
    offset = index + 1;
  }
  return false;
};
const findTerm = (text, terms) => terms.find((term) => containsTerm(text, term)) || '';
const incidentId = () => `MOD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

const normalizeStore = (input) => {
  const store = input && typeof input === 'object' ? input : emptyStore();
  store.version = STORE_VERSION;
  store.guilds = store.guilds && typeof store.guilds === 'object' ? store.guilds : {};
  for (const guild of Object.values(store.guilds)) {
    guild.members = guild?.members && typeof guild.members === 'object' ? guild.members : {};
    guild.revision = finiteInteger(guild.revision, 0, 0, Number.MAX_SAFE_INTEGER);
    for (const [userId, raw] of Object.entries(guild.members)) {
      const member = raw && typeof raw === 'object' ? raw : {};
      member.incidents = Array.isArray(member.incidents) ? member.incidents.slice(-MAX_INCIDENTS_PER_MEMBER) : [];
      guild.members[userId] = member;
    }
  }
  return store;
};
const loadStore = async () => normalizeStore((await readJsonWithRecovery(INCIDENT_FILE, {
  fallback: emptyStore(),
  backupLimit: 5,
  validate: (value) => Boolean(value && typeof value === 'object')
})).value);
const mutateStore = (worker) => {
  const operation = mutationQueue.catch(() => {}).then(async () => {
    const store = await loadStore();
    const result = await worker(store);
    await atomicWriteJson(INCIDENT_FILE, store, { backupLimit: 5 });
    return result;
  });
  mutationQueue = operation.catch(() => {});
  return operation;
};
const guildState = (store, guildId) => {
  store.guilds[guildId] ||= { members: {}, revision: 0 };
  return store.guilds[guildId];
};
const memberState = (guild, userId) => {
  guild.members[userId] ||= { incidents: [] };
  return guild.members[userId];
};
const activeIncidents = (member, windowDays, now = Date.now()) => (member?.incidents || []).filter((incident) => {
  if (['false_positive', 'pardoned'].includes(String(incident.status || ''))) return false;
  return now - (Date.parse(incident.openedAt || incident.createdAt || '') || 0) <= windowDays * 86_400_000;
});

export const getModerationMemberSummary = async ({ guildId, userId, cfg } = {}) => {
  const resolvedGuildId = String(guildId || '');
  const resolvedUserId = String(userId || '');
  if (!resolvedGuildId || !resolvedUserId) return null;
  await mutationQueue.catch(() => {});
  const store = await loadStore();
  const member = store.guilds?.[resolvedGuildId]?.members?.[resolvedUserId] || { incidents: [] };
  const moderation = settings(cfg);
  const warningWindowDays = finiteInteger(moderation.warningWindowDays, 30, 1, 365);
  const incidents = Array.isArray(member.incidents) ? member.incidents : [];
  const active = activeIncidents(member, warningWindowDays);
  const openTimeout = [...active].reverse().find((incident) => incident?.action?.type === 'timeout'
    && Date.parse(incident.action.until || '') > Date.now());
  return {
    warningWindowDays,
    activeCount: active.length,
    totalCount: incidents.length,
    timeoutUntil: openTimeout?.action?.until || '',
    latest: [...incidents].reverse().slice(0, 5).map((incident) => ({
      id: String(incident.id || ''),
      status: String(incident.status || 'open'),
      severity: String(incident.severity || 'light'),
      reason: String(incident.reason || '').slice(0, 180),
      openedAt: String(incident.openedAt || incident.createdAt || ''),
      timeoutUntil: String(incident.action?.until || '')
    }))
  };
};
const pruneIncidents = (member, retentionDays, now = Date.now()) => {
  const cutoff = now - retentionDays * 86_400_000;
  member.incidents = (member.incidents || [])
    .filter((incident) => (Date.parse(incident.lastEventAt || incident.openedAt || '') || now) >= cutoff)
    .slice(-MAX_INCIDENTS_PER_MEMBER);
};

const recordIncident = async ({ guildId, userId, channelId, messageId, type, severity, reason, excerpt, cfg, source }) => mutateStore((store) => {
  const moderation = settings(cfg);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const guild = guildState(store, guildId);
  const member = memberState(guild, userId);
  const retentionDays = finiteInteger(moderation.retentionDays, 90, 7, 365);
  const warningWindowDays = finiteInteger(moderation.warningWindowDays, 30, 1, 365);
  const incidentWindowMs = finiteInteger(moderation.incidentWindowSeconds, 90, 15, 900) * 1000;
  pruneIncidents(member, retentionDays, now);
  const duplicate = (member.incidents || []).find((incident) => messageId && (incident.messageIds || []).includes(String(messageId)));
  if (duplicate) return { incident: duplicate, isNew: false, duplicate: true, strikeCount: activeIncidents(member, warningWindowDays, now).length };
  const recent = [...(member.incidents || [])].reverse().find((incident) =>
    !['false_positive', 'pardoned', 'closed'].includes(String(incident.status || ''))
    && now - (Date.parse(incident.lastEventAt || incident.openedAt || '') || 0) <= incidentWindowMs
  );
  if (recent) {
    recent.lastEventAt = nowIso;
    recent.severity = highestSeverity(recent.severity || 'light', severity);
    recent.types = [...new Set([...(recent.types || []), type])];
    recent.messageIds = [...new Set([...(recent.messageIds || []), ...(messageId ? [String(messageId)] : [])])].slice(-20);
    recent.eventCount = finiteInteger(recent.eventCount, 1, 1, 999) + 1;
    recent.reason = recent.reason || reason;
    recent.excerpt = recent.excerpt || String(excerpt || '').slice(0, 500);
    recent.sources = [...new Set([...(recent.sources || []), source])];
    guild.revision += 1;
    return { incident: recent, isNew: false, duplicate: false, strikeCount: activeIncidents(member, warningWindowDays, now).length };
  }
  const incident = {
    id: incidentId(),
    status: 'open',
    openedAt: nowIso,
    lastEventAt: nowIso,
    userId,
    channelId,
    messageIds: messageId ? [String(messageId)] : [],
    types: [type],
    severity,
    reason: String(reason || '').slice(0, 300),
    excerpt: String(excerpt || '').slice(0, 500),
    sources: [source],
    eventCount: 1,
    action: null
  };
  member.incidents.push(incident);
  guild.revision += 1;
  return { incident, isNew: true, duplicate: false, strikeCount: activeIncidents(member, warningWindowDays, now).length };
});

const patchIncident = async (guildId, userId, id, patch) => mutateStore((store) => {
  const guild = guildState(store, guildId);
  const member = memberState(guild, userId);
  const incident = member.incidents.find((entry) => String(entry.id) === String(id));
  if (!incident) throw new Error('Der Moderationsvorfall wurde nicht gefunden.');
  Object.assign(incident, patch, { updatedAt: new Date().toISOString() });
  guild.revision += 1;
  return incident;
});

const findIncident = async (guildId, id) => {
  await mutationQueue.catch(() => {});
  const store = await loadStore();
  const guild = store.guilds?.[guildId];
  for (const [userId, member] of Object.entries(guild?.members || {})) {
    const incident = (member.incidents || []).find((entry) => String(entry.id) === String(id));
    if (incident) return { incident, userId };
  }
  return null;
};

const isProtectedMember = (member, cfg) => {
  if (!member || member.user?.bot || member.id === member.guild.ownerId) return true;
  if (member.permissions?.has?.(PermissionFlagsBits.Administrator) || member.permissions?.has?.(PermissionFlagsBits.ManageGuild)) return true;
  const general = cfg?.general || {};
  if ((general.ownerUserIds || []).map(String).includes(String(member.id))) return true;
  const protectedRoles = new Set([...(general.staffRoleIds || []), ...(settings(cfg).exemptRoleIds || [])].map(String));
  return member.roles?.cache?.some?.((role) => protectedRoles.has(String(role.id))) || false;
};

const ignoredChannel = (message, cfg) => {
  const ignored = new Set((settings(cfg).ignoredChannelIds || []).map(String));
  return ignored.has(String(message.channelId)) || ignored.has(String(message.channel?.parentId || ''));
};

const detectContentViolation = (message, cfg) => {
  const moderation = settings(cfg);
  const text = normalizeText(message.content);
  if (!text) return null;
  const critical = findTerm(text, normalizeTerms(moderation.criticalTerms));
  if (critical) return { type: 'critical-content', severity: 'critical', reason: `Kritischer Ausdruck: ${critical}` };
  const high = findTerm(text, normalizeTerms(moderation.highRiskTerms));
  if (high) return { type: 'high-risk-content', severity: 'high', reason: `Schwerer Ausdruck: ${high}` };
  const blocked = findTerm(text, normalizeTerms(moderation.badWords));
  if (blocked) return { type: 'blocked-term', severity: 'medium', reason: `Gesperrter Ausdruck: ${blocked}` };
  const mentions = Number(message.mentions?.users?.size || 0) + Number(message.mentions?.roles?.size || 0);
  if (mentions >= finiteInteger(moderation.mentionSpamThreshold, 6, 3, 50)) {
    return { type: 'mention-spam', severity: 'medium', reason: `${mentions} Erwähnungen in einer Nachricht` };
  }
  return null;
};

const detectSpamViolation = (message, cfg) => {
  const moderation = settings(cfg);
  if (moderation.antiSpamEnabled === false) return null;
  const now = Date.now();
  const key = `${message.guildId}:${message.author.id}`;
  const windowMs = finiteInteger(moderation.antiSpamWindowSeconds, 12, 3, 120) * 1000;
  const threshold = finiteInteger(moderation.antiSpamThreshold, 8, 3, 50);
  const fingerprint = normalizeText(message.content).replace(/\s+/g, ' ').slice(0, 180);
  const entries = [...(antiSpamWindows.get(key) || []), { at: now, fingerprint }]
    .filter((entry) => now - entry.at <= windowMs)
    .slice(-threshold * 2);
  antiSpamWindows.set(key, entries);
  const duplicateCount = fingerprint ? entries.filter((entry) => entry.fingerprint === fingerprint).length : 0;
  if (entries.length >= threshold || duplicateCount >= Math.min(4, threshold)) {
    antiSpamWindows.set(key, []);
    return {
      type: duplicateCount >= Math.min(4, threshold) ? 'duplicate-spam' : 'rate-spam',
      severity: 'light',
      reason: duplicateCount >= Math.min(4, threshold)
        ? `${duplicateCount} nahezu identische Nachrichten im Zeitfenster`
        : `${entries.length} Nachrichten in ${Math.round(windowMs / 1000)} Sekunden`
    };
  }
  return null;
};

const timeoutMinutesFor = (moderation, severity) => ({
  light: finiteInteger(moderation.lightTimeoutMinutes, moderation.timeoutMinutes || 10, 1, 40_320),
  medium: finiteInteger(moderation.mediumTimeoutMinutes, 60, 1, 40_320),
  high: finiteInteger(moderation.highTimeoutMinutes, 360, 1, 40_320),
  critical: finiteInteger(moderation.criticalTimeoutMinutes, 1440, 1, 40_320)
})[severity] || 10;

const muteRole = (guild, cfg) => {
  const roleId = String(settings(cfg).muteRoleId || '');
  return roleId ? guild.roles.cache.get(roleId) || null : null;
};
const syncMuteRole = async (member, cfg) => {
  const role = muteRole(member?.guild, cfg);
  if (!member || !role || !role.editable) return;
  const timedOut = Number(member.communicationDisabledUntilTimestamp || 0) > Date.now();
  if (timedOut && !member.roles.cache.has(role.id)) await member.roles.add(role, 'Moderations-Timeout gespiegelt');
  if (!timedOut && member.roles.cache.has(role.id)) await member.roles.remove(role, 'Moderations-Timeout beendet');
};
const scheduleMuteReconcile = (member, cfg) => {
  const key = `${member.guild.id}:${member.id}`;
  clearTimeout(muteTimers.get(key));
  const delay = Math.max(1000, Math.min(2_147_000_000, Number(member.communicationDisabledUntilTimestamp || 0) - Date.now() + 1500));
  const timer = setTimeout(async () => {
    muteTimers.delete(key);
    const fresh = await member.guild.members.fetch(member.id).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.moderation, error, `members.fetch (Fresh) fehlgeschlagen: ${member.id}`);
      return null;
    });
    if (fresh) await syncMuteRole(fresh, cfg).catch(() => {});
  }, delay);
  timer.unref?.();
  muteTimers.set(key, timer);
};

const applyTimeout = async ({ member, cfg, incident, strikeCount }) => {
  const moderation = settings(cfg);
  if (!member?.moderatable || typeof member.timeout !== 'function') return { applied: false, reason: 'Mitglied kann durch den Bot nicht moderiert werden.' };
  const minutes = timeoutMinutesFor(moderation, incident.severity);
  await member.timeout(minutes * 60_000, `Automatische Moderation · ${incident.id} · ${incident.reason}`);
  await syncMuteRole(member, cfg).catch(() => {});
  scheduleMuteReconcile(member, cfg);
  const until = new Date(Date.now() + minutes * 60_000).toISOString();
  await patchIncident(member.guild.id, member.id, incident.id, {
    action: { type: 'timeout', minutes, until, strikeCount, appliedAt: new Date().toISOString() }
  });
  return { applied: true, minutes, until };
};

const sendChannelNotice = async ({ message, strikeCount, timeoutResult, cfg }) => {
  if (!message.channel?.isTextBased?.()) return;
  const text = timeoutResult?.applied
    ? `${message.author}, der Moderationsassistent hat einen Timeout von ${timeoutResult.minutes} Minuten gesetzt. Aktive Verwarnungen: ${strikeCount}.`
    : `${message.author}, bitte beachte die Serverregeln. Aktive Verwarnungen: ${strikeCount}.`;
  const notice = await message.channel.send({ content: text, allowedMentions: { users: [message.author.id], roles: [], repliedUser: false } }).catch((error) => {
    quietLog(QUIET_LOG_SCOPE.moderation, error, `channel.send (Notice) fehlgeschlagen: Kanal ${message.channel?.id}`);
    return null;
  });
  const deleteSeconds = finiteInteger(settings(cfg).warningDeleteSeconds, 15, 3, 300);
  if (notice?.deletable) {
    const timer = setTimeout(() => notice.delete().catch(() => {}), deleteSeconds * 1000);
    timer.unref?.();
  }
};

const sendModerationLog = async ({ guild, cfg, member, incident, strikeCount, mode, timeoutResult }) => {
  const channelId = String(settings(cfg).logChannelId || '');
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch((error) => {
    quietLog(QUIET_LOG_SCOPE.moderation, error, `channels.fetch (Log) fehlgeschlagen: ${channelId}`);
    return null;
  });
  if (!channel?.isTextBased?.()) return;
  const color = ({ light: 0xf0b84b, medium: 0xff8a52, high: 0xff5d78, critical: 0xd83cff })[incident.severity] || 0x7772ff;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: 'FALLEN HEAVEN · MODERATION' })
    .setTitle(timeoutResult?.applied ? 'Automatische Schutzmaßnahme' : mode === 'observe' ? 'Beobachtung ohne Eingriff' : 'Verwarnung erfasst')
    .setDescription(`**Mitglied:** <@${member.id}>\n**Grund:** ${incident.reason}\n**Schwere:** ${incident.severity.toUpperCase()}\n**Aktive Verwarnungen:** ${strikeCount}`)
    .addFields(
      { name: 'Vorfall', value: `\`${incident.id}\``, inline: true },
      { name: 'Modus', value: String(mode || 'observe').toUpperCase(), inline: true },
      { name: 'Aktion', value: timeoutResult?.applied ? `${timeoutResult.minutes} Minuten Timeout` : 'Keine automatische Strafe', inline: true },
      { name: 'Beleg', value: incident.excerpt ? `\`${String(incident.excerpt).replace(/`/g, '´').slice(0, 500)}\`` : 'Kein Nachrichteninhalt verfügbar' }
    )
    .setFooter({ text: 'Keine DMs · kein automatischer Kick oder Bann' })
    .setTimestamp();
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`fh_mod:false-positive:${incident.id}`).setLabel('Fehlalarm').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`fh_mod:forgive:${incident.id}`).setLabel('Verwarnung erlassen').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`fh_mod:release:${incident.id}`).setLabel('Timeout aufheben').setStyle(ButtonStyle.Primary).setDisabled(!timeoutResult?.applied)
  );
  await channel.send({ embeds: [embed], components: [buttons], allowedMentions: { parse: [] } }).catch(() => {});
};

const handleViolation = async ({ message, member, violation, cfg, source = 'message' }) => {
  const moderation = settings(cfg);
  const mode = ['observe', 'warn', 'enforce'].includes(String(moderation.mode)) ? String(moderation.mode) : 'observe';
  const result = await recordIncident({
    guildId: message.guildId,
    userId: member.id,
    channelId: message.channelId,
    messageId: message.id,
    type: violation.type,
    severity: violation.severity,
    reason: violation.reason,
    excerpt: message.content,
    cfg,
    source
  });
  if (result.duplicate) return result;
  if (mode !== 'observe' && moderation.autoDelete !== false && message.deletable) await message.delete().catch(() => {});
  if (!result.isNew) return result;
  const threshold = finiteInteger(moderation.maxWarnings, 3, 1, 20);
  const criticalImmediate = violation.severity === 'critical' && moderation.criticalImmediateTimeout === true;
  const shouldTimeout = mode === 'enforce' && (result.strikeCount >= threshold || criticalImmediate);
  const timeoutResult = shouldTimeout
    ? await applyTimeout({ member, cfg, incident: result.incident, strikeCount: result.strikeCount }).catch((error) => ({ applied: false, reason: error?.message || error }))
    : { applied: false };
  if (mode !== 'observe') await sendChannelNotice({ message, strikeCount: result.strikeCount, timeoutResult, cfg });
  await sendModerationLog({ guild: message.guild, cfg, member, incident: result.incident, strikeCount: result.strikeCount, mode, timeoutResult });
  return { ...result, timeoutResult };
};

const moderateMessage = async (message, cfg, source = 'message') => {
  if (!settings(cfg).enabled || !message?.guild || message.author?.bot || !message.member) return;
  if (ignoredChannel(message, cfg) || isProtectedMember(message.member, cfg)) return;
  const contentViolation = detectContentViolation(message, cfg);
  const spamViolation = detectSpamViolation(message, cfg);
  const violation = contentViolation && spamViolation
    ? { ...contentViolation, severity: highestSeverity(contentViolation.severity, spamViolation.severity), reason: `${contentViolation.reason}; ${spamViolation.reason}` }
    : contentViolation || spamViolation;
  if (violation) await handleViolation({ message, member: message.member, violation, cfg, source });
};

const handleReviewButton = async (interaction, cfg) => {
  const id = String(interaction.customId || '');
  if (!id.startsWith('fh_mod:')) return false;
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
    await interaction.reply({ content: 'Für diese Moderationsprüfung fehlt dir die Berechtigung „Mitglieder moderieren“.', flags: MessageFlags.Ephemeral });
    return true;
  }
  const [, action, incidentIdValue] = id.split(':');
  const found = await findIncident(interaction.guildId, incidentIdValue);
  if (!found) {
    await interaction.reply({ content: 'Dieser Vorfall ist nicht mehr im aktiven Moderationsspeicher vorhanden.', flags: MessageFlags.Ephemeral });
    return true;
  }
  const member = await interaction.guild.members.fetch(found.userId).catch((error) => {
    quietLog(QUIET_LOG_SCOPE.moderation, error, `members.fetch (Audit) fehlgeschlagen: ${found.userId}`);
    return null;
  });
  if (action === 'false-positive' || action === 'forgive') {
    const status = action === 'false-positive' ? 'false_positive' : 'pardoned';
    await patchIncident(interaction.guildId, found.userId, incidentIdValue, {
      status,
      resolvedAt: new Date().toISOString(),
      resolvedBy: interaction.user.id
    });
    await interaction.reply({ content: action === 'false-positive' ? 'Der Vorfall wurde als Fehlalarm markiert und zählt nicht mehr als Verwarnung.' : 'Die Verwarnung wurde erlassen und zählt nicht mehr zur Eskalation.', flags: MessageFlags.Ephemeral });
    return true;
  }
  if (action === 'release') {
    if (!member?.moderatable) {
      await interaction.reply({ content: 'Der Timeout kann durch den Bot nicht aufgehoben werden. Prüfe die Rollenhierarchie.', flags: MessageFlags.Ephemeral });
      return true;
    }
    await member.timeout(null, `Moderationsprüfung ${incidentIdValue} durch ${interaction.user.tag}`);
    await syncMuteRole(member, cfg).catch(() => {});
    await patchIncident(interaction.guildId, found.userId, incidentIdValue, {
      status: 'released',
      releasedAt: new Date().toISOString(),
      releasedBy: interaction.user.id
    });
    await interaction.reply({ content: 'Timeout und zugehörige Mute-Rolle wurden aufgehoben.', flags: MessageFlags.Ephemeral });
    return true;
  }
  return true;
};

export const feature = {
  id: 'moderation',
  name: 'Moderationsassistent',
  commands: [],
  async onClientReady({ guild, cfg }) {
    if (!settings(cfg).enabled || !guild) return;
    const role = muteRole(guild, cfg);
    if (!role) return;
    for (const member of role.members.values()) await syncMuteRole(member, cfg).catch(() => {});
    for (const member of guild.members.cache.values()) {
      if (Number(member.communicationDisabledUntilTimestamp || 0) > Date.now()) {
        await syncMuteRole(member, cfg).catch(() => {});
        scheduleMuteReconcile(member, cfg);
      }
    }
  },
  async onMessageCreate({ message, cfg }) {
    await moderateMessage(message, cfg, 'message-create');
  },
  async onMessageUpdate({ oldMessage, newMessage, cfg }) {
    if (String(oldMessage?.content || '') === String(newMessage?.content || '')) return;
    if (newMessage?.partial) await newMessage.fetch().catch(() => null);
    await moderateMessage(newMessage, cfg, 'message-update');
  },
  async onAutoModerationActionExecution({ execution, cfg }) {
    if (!settings(cfg).enabled || !execution?.guild || !execution.userId) return;
    const member = execution.guild.members.cache.get(execution.userId) || await execution.guild.members.fetch(execution.userId).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.moderation, error, `members.fetch (AutoMod) fehlgeschlagen: ${execution.userId}`);
      return null;
    });
    if (!member || isProtectedMember(member, cfg)) return;
    const syntheticMessage = {
      id: execution.messageId || `automod:${execution.ruleId}:${execution.userId}:${Date.now()}`,
      guild: execution.guild,
      guildId: execution.guild.id,
      channelId: execution.channelId,
      channel: execution.guild.channels.cache.get(execution.channelId),
      author: member.user,
      member,
      content: execution.matchedContent || execution.matchedKeyword || '',
      mentions: { users: new Map(), roles: new Map() },
      deletable: false
    };
    const highMatch = findTerm(normalizeText(syntheticMessage.content), normalizeTerms(settings(cfg).highRiskTerms));
    await handleViolation({
      message: syntheticMessage,
      member,
      violation: { type: 'discord-automod', severity: highMatch ? 'high' : 'medium', reason: `Discord AutoMod-Regel ${execution.ruleId}` },
      cfg,
      source: 'discord-automod'
    });
  },
  async onGuildMemberUpdate({ newMember, cfg }) {
    if (!settings(cfg).enabled || !newMember || newMember.user?.bot) return;
    await syncMuteRole(newMember, cfg).catch(() => {});
    if (Number(newMember.communicationDisabledUntilTimestamp || 0) > Date.now()) scheduleMuteReconcile(newMember, cfg);
  },
  async onAnyInteraction({ interaction, cfg }) {
    if (interaction.isButton?.()) await handleReviewButton(interaction, cfg);
  }
};

export const _moderationInternals = {
  normalizeText,
  containsTerm,
  detectContentViolation,
  highestSeverity,
  activeIncidents,
  normalizeStore
};
