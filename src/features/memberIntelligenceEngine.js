import { PermissionFlagsBits } from 'discord.js';
import {
  getServerIndexAuthorSummary,
  getServerIndexAuthorChannelBreakdown,
  getServerIndexUserSystemEvents
} from '../serverIndexStore.js';

const ANALYSIS_VERSION = 7;

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const nowIso = () => new Date().toISOString();

const resolveAllowedChannels = (guild, requester) => {
  if (!guild?.channels?.cache || !requester) return [];
  // ManageGuild erlaubt nicht automatisch den Zugriff auf private Kanäle.
  // Nur der Serverinhaber und Administratoren dürfen Discords
  // Kanalberechtigungen vollständig umgehen.
  const canViewAll = requester.id === guild.ownerId
    || Boolean(requester.permissions?.has?.(PermissionFlagsBits.Administrator));
  return guild.channels.cache
    .filter((channel) => channel?.isTextBased?.() && !channel?.isThread?.())
    .filter((channel) => {
      if (canViewAll) return true;
      const permissions = channel.permissionsFor?.(requester);
      return Boolean(
        permissions?.has?.(PermissionFlagsBits.ViewChannel)
        && permissions?.has?.(PermissionFlagsBits.ReadMessageHistory)
      );
    })
    .map((channel) => String(channel.id));
};

const channelIdOf = (entry) => String(entry?.channelId || '').trim();

const filterChannelRecords = (records, allowedChannelIds) => (records || [])
  .filter((entry) => {
    const channelId = channelIdOf(entry);
    return channelId && allowedChannelIds.has(channelId);
  });

const filterAssertionForReadScope = (assertion, allowedChannelIds) => {
  const evidence = filterChannelRecords(assertion?.evidence, allowedChannelIds);
  if (!evidence.length) return null;
  const history = (assertion?.history || []).flatMap((entry) => {
    if (!entry?.evidence) return [];
    const channelId = channelIdOf(entry.evidence);
    return channelId && allowedChannelIds.has(channelId)
      ? [{ ...entry, evidence: { ...entry.evidence } }]
      : [];
  });
  return { ...assertion, evidence, history };
};

const filterStateForReadScope = (state, summary, allowedChannelIds = []) => {
  const allowed = new Set((allowedChannelIds || []).map(String).filter(Boolean));
  const channels = filterChannelRecords(state?.channels, allowed);
  const analyzedMessages = channels.reduce((sum, channel) => sum + Math.max(0, Number(channel.count || 0)), 0);
  // `summary` wurde bereits mit denselben erlaubten Kanal-IDs erstellt und ist
  // daher der einzige sichere Nenner für Fortschritt und Gesamtzahl.
  const totalMessages = Math.max(analyzedMessages, Math.max(0, Number(summary?.count || 0)));
  const assertions = (state?.assertions || [])
    .map((assertion) => filterAssertionForReadScope(assertion, allowed))
    .filter(Boolean);
  const unclear = (state?.unclear || []).flatMap((entry) => {
    const channelId = channelIdOf(entry?.evidence);
    return channelId && allowed.has(channelId)
      ? [{ ...entry, evidence: { ...entry.evidence } }]
      : [];
  });
  const introductionFields = filterChannelRecords(state?.introduction?.fields, allowed);
  const visibleEvidence = filterChannelRecords(state?.evidence, allowed);
  const visibleTimestamps = [
    ...visibleEvidence,
    ...channels,
    ...assertions.flatMap((assertion) => assertion.evidence || []),
    ...introductionFields
  ]
    .map((entry) => Date.parse(entry?.createdAt || entry?.lastMessageAt || ''))
    .filter(Number.isFinite);
  const lastMessageAt = visibleTimestamps.length ? new Date(Math.max(...visibleTimestamps)).toISOString() : null;

  return {
    ...state,
    phase: state?.status === 'complete'
      ? 'Analyse des sichtbaren Nutzerindex vollständig'
      : `${analyzedMessages.toLocaleString('de-DE')} von ${totalMessages.toLocaleString('de-DE')} sichtbaren Nachrichten verarbeitet`,
    progress: totalMessages > 0 ? clamp((analyzedMessages / totalMessages) * 100, 0, state?.status === 'complete' ? 100 : 99.9) : 100,
    assertions,
    unclear,
    introduction: { fields: introductionFields },
    channels,
    links: filterChannelRecords(state?.links, allowed),
    media: filterChannelRecords(state?.media, allowed),
    evidence: visibleEvidence,
    analyzedMessageCount: analyzedMessages,
    processedMessages: analyzedMessages,
    totalMessages,
    lastMessageAt
  };
};

const canInspectModerationTimeline = ({ guild, requester, targetUserId }) => (
  Boolean(requester)
  && (
    String(requester.id || '') === String(targetUserId || '')
    || String(requester.id || '') === String(guild?.ownerId || '')
    || Boolean(requester.permissions?.has?.(PermissionFlagsBits.Administrator))
    || Boolean(requester.permissions?.has?.(PermissionFlagsBits.ManageGuild))
  )
);

const filterSystemTimelineForReadScope = ({
  events = [],
  allowedChannelIds = [],
  guild,
  requester,
  targetUserId
} = {}) => {
  const allowed = new Set((allowedChannelIds || []).map(String).filter(Boolean));
  const systemChannelId = String(guild?.systemChannelId || '');
  const messageBackedTypes = new Set(['member_joined', 'boost_started', 'boost_ended']);
  const moderationTypes = new Set(['member_left', 'member_kicked', 'member_banned', 'member_unbanned', 'timeout_started', 'timeout_ended']);
  const mayInspectModeration = canInspectModerationTimeline({ guild, requester, targetUserId });

  return [...events]
    .filter((event) => {
      const type = String(event?.type || '');
      const channelId = channelIdOf(event);
      if (channelId && !allowed.has(channelId)) return false;
      if (moderationTypes.has(type)) return mayInspectModeration;
      if (!messageBackedTypes.has(type)) return false;
      if (!channelId) return false;
      if (systemChannelId) return channelId === systemChannelId;
      return /hauptchat/i.test(String(event?.channelName || ''));
    })
    .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
};

const toPublicView = ({ summary, channels, linkCount, mediaCount, systemTimeline }) => ({
  generatedAt: nowIso(),
  source: 'server-index',
  partial: false,
  analyzedMessages: Number(summary?.count || 0),
  activeChannels: Number(summary?.channelCount || 0),
  lastMessageAt: summary?.lastMessageAt || null,
  overallConfidence: 0,
  analysis: {
    version: ANALYSIS_VERSION,
    scope: 'single-user',
    status: 'complete',
    label: 'Aktivität im Serverindex',
    phase: 'Index vollständig ausgewertet',
    progress: 100,
    processedMessages: Number(summary?.count || 0),
    totalMessages: Number(summary?.count || 0),
    verifiedStatements: 0,
    historicalStatements: 0,
    unclearSignals: 0,
    introductionFields: 0,
    contextualizedStatements: 0,
    unreadableFiles: 0,
    sourceCoverage: 1,
    lastAnalyzedAt: nowIso(),
    model: null,
    error: null
  },
  introduction: { fields: [] },
  unclear: [],
  insights: [],
  channels,
  links: [],
  media: [],
  linkCount,
  mediaCount,
  evidence: [],
  systemTimeline
});

export const getPersistentMemberIntelligence = async ({ guild, requester, userId }) => {
  const targetUserId = String(userId || '').trim();
  if (!guild?.id || !targetUserId) throw new Error('Nutzerprofil konnte nicht zugeordnet werden.');
  const allowedChannelIds = resolveAllowedChannels(guild, requester);
  const [summary, breakdown, indexedEvents] = await Promise.all([
    getServerIndexAuthorSummary({ guildId: guild.id, authorId: targetUserId, allowedChannelIds }),
    getServerIndexAuthorChannelBreakdown({ guildId: guild.id, authorId: targetUserId, allowedChannelIds }),
    getServerIndexUserSystemEvents({ guildId: guild.id, userId: targetUserId, limit: 5_000 }).catch(() => [])
  ]);
  const systemTimeline = filterSystemTimelineForReadScope({
    events: indexedEvents,
    allowedChannelIds,
    guild,
    requester,
    targetUserId
  });
  return toPublicView({
    summary,
    channels: breakdown.channels,
    linkCount: breakdown.linkCount,
    mediaCount: breakdown.mediaCount,
    systemTimeline
  });
};

export const getPersistentMemberIntelligenceStatus = async ({ guild, requester, userId }) => {
  const targetUserId = String(userId || '').trim();
  if (!guild?.id || !targetUserId) throw new Error('Nutzerprofil konnte nicht zugeordnet werden.');
  const allowedChannelIds = resolveAllowedChannels(guild, requester);
  const summary = await getServerIndexAuthorSummary({ guildId: guild.id, authorId: targetUserId, allowedChannelIds });
  const view = toPublicView({ summary, channels: [], linkCount: 0, mediaCount: 0, systemTimeline: [] });
  return {
    partial: view.partial,
    analyzedMessages: view.analyzedMessages,
    activeChannels: view.activeChannels,
    analysis: view.analysis
  };
};

export const _memberIntelligenceInternals = {
  resolveAllowedChannels,
  filterStateForReadScope,
  canInspectModerationTimeline,
  filterSystemTimelineForReadScope
};
