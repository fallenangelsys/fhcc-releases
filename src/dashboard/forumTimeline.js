import { ChannelFlagsBitField, ChannelType, PermissionFlagsBits } from 'discord.js';
import { messageUrl, serializeDashboardEmbed, serializeDashboardAttachment, serializeDashboardSticker, serializeDashboardReaction, serializeDashboardComponents } from './serialization.js';

const FORUM_THREAD_PINNED_FLAG = Number(ChannelFlagsBitField?.Flags?.Pinned || 2);

export const forumThreadHasPinnedFlag = (thread) => {
  const flags = thread?.flags;
  if (!flags) return false;
  if (typeof flags.has === 'function') {
    try {
      if (flags.has(ChannelFlagsBitField.Flags.Pinned)) return true;
    } catch (_error) {}
    try {
      if (flags.has('Pinned')) return true;
    } catch (_error) {}
  }
  const bitfield = Number(flags.bitfield ?? flags);
  return Number.isFinite(bitfield) && (bitfield & FORUM_THREAD_PINNED_FLAG) === FORUM_THREAD_PINNED_FLAG;
};

export const isPinnedForumPost = (thread, starter = null) => Boolean(starter?.pinned || thread?.pinned || forumThreadHasPinnedFlag(thread));

export const forumPostTimestamp = (post) => Date.parse(post?.createdAt || post?.thread?.createdAt || '') || 0;

export const compareDashboardForumPosts = (left, right) => {
  const pinDelta = Number(Boolean(right?.pinned || right?.thread?.pinned)) - Number(Boolean(left?.pinned || left?.thread?.pinned));
  if (pinDelta) return pinDelta;
  const timeDelta = forumPostTimestamp(right) - forumPostTimestamp(left);
  if (timeDelta) return timeDelta;
  return String(left?.name || left?.id || '').localeCompare(String(right?.name || right?.id || ''), 'de', { sensitivity: 'base' });
};

export const forumThreadArchiveTimestamp = (thread) =>
  Number(thread?.archivedTimestamp || thread?.archiveTimestamp || thread?.createdTimestamp || Date.parse(thread?.archivedAt || thread?.createdAt || '') || 0);

export const forumThreadArchiveCursor = (thread) => {
  const timestamp = forumThreadArchiveTimestamp(thread);
  if (!timestamp) return '';
  return new Date(timestamp).toISOString();
};

export const collectDashboardForumThreads = async (channel, limit, before = '') => {
  const rows = new Map();
  const archivedRows = [];
  const add = (thread) => {
    if (thread?.id && String(thread.parentId || '') === String(channel.id)) rows.set(thread.id, thread);
  };
  const addArchived = (thread) => {
    add(thread);
    if (thread?.id && String(thread.parentId || '') === String(channel.id)) archivedRows.push(thread);
  };
  if (!before) {
    for (const thread of channel.threads?.cache?.values?.() || []) add(thread);
    const active = await channel.threads.fetchActive(true).catch(() => null);
    for (const thread of active?.threads?.values?.() || []) add(thread);
  }
  const archived = await channel.threads.fetchArchived({
    type: 'public',
    limit: Math.min(100, Math.max(1, limit)),
    ...(before ? { before } : {})
  }, true).catch(() => null);
  for (const thread of archived?.threads?.values?.() || []) addArchived(thread);
  const oldestArchived = archivedRows
    .filter((thread) => forumThreadArchiveTimestamp(thread))
    .sort((left, right) => forumThreadArchiveTimestamp(left) - forumThreadArchiveTimestamp(right))[0] || null;
  const threads = [...rows.values()];
  return { threads, hasMore: Boolean(archived?.hasMore), nextBefore: archived?.hasMore ? forumThreadArchiveCursor(oldestArchived) : null };
};

export const serializeDashboardAuthor = async (guild, thread, starter, resolveAvatar) => {
  if (starter?.author) {
    const avatarUrl = await resolveAvatar(guild, starter.author, { size: 128 });
    return {
      id: starter.author.id || '',
      username: starter.author.username || 'Unbekannt',
      displayName: starter.member?.displayName || starter.author.globalName || starter.author.username || 'Unbekannt',
      avatarUrl,
      avatar: avatarUrl,
      fallbackAvatar: starter.author.defaultAvatarURL || null,
      bot: Boolean(starter.author.bot)
    };
  }

  const ownerId = String(thread?.ownerId || '');
  const member = ownerId ? guild.members.cache.get(ownerId) || await guild.members.fetch(ownerId).catch(() => null) : null;
  const user = member?.user || null;
  const avatarUrl = await resolveAvatar(guild, user, { size: 128 });
  return {
    id: ownerId,
    username: user?.username || 'Forum',
    displayName: member?.displayName || user?.globalName || user?.username || 'Forum-Post',
    avatarUrl,
    avatar: avatarUrl,
    fallbackAvatar: user?.defaultAvatarURL || null,
    bot: Boolean(user?.bot)
  };
};

export const listForumChannelPosts = async ({ guild, channel, options = {}, actorUserId = '', resolveAvatar }) => {
  if (channel.viewable === false) {
    throw new Error('Der Bot darf diesen Forum-Kanal nicht sehen.');
  }

  const limit = Math.min(100, Math.max(10, Number(options.limit || 50)));
  const before = String(options.before || '').trim();
  const actor = actorUserId
    ? guild.members.cache.get(String(actorUserId)) || await guild.members.fetch(String(actorUserId)).catch(() => null)
    : null;
  const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
  const actorIsOwner = actor?.id === guild.ownerId;
  const actorCanManageChannels = actorIsOwner || Boolean(actor?.permissions.has(PermissionFlagsBits.Administrator) || actor?.permissions.has(PermissionFlagsBits.ManageChannels));
  const botChannelPermissions = botMember ? channel.permissionsFor(botMember) : null;
  const botCanManageChannel = Boolean(botChannelPermissions?.has(PermissionFlagsBits.ManageChannels));
  const { threads, hasMore, nextBefore } = await collectDashboardForumThreads(channel, limit, before);
  const availableTags = new Map(Array.from(channel.availableTags?.values?.() || channel.availableTags || []).map((tag) => [String(tag.id), tag.name || tag.id]));
  const messages = await Promise.all(threads.map(async (thread) => {
    const starter = await thread.fetchStarterMessage({ cache: true, force: true }).catch(() => null);
    const author = await serializeDashboardAuthor(guild, thread, starter, resolveAvatar);
    const pinned = isPinnedForumPost(thread, starter);
    const tags = Array.from(thread.appliedTags || []).map((tagId) => ({
      id: String(tagId),
      name: availableTags.get(String(tagId)) || String(tagId)
    }));
    return {
      id: thread.id,
      name: thread.name || thread.id,
      content: starter?.content || `Forum-Post: ${thread.name || thread.id}`,
      type: 'forum-post',
      createdAt: (starter?.createdAt || thread.createdAt)?.toISOString?.() || null,
      editedAt: starter?.editedAt?.toISOString?.() || null,
      pinned,
      url: thread.url || messageUrl(guild.id, thread.id, thread.id),
      canEdit: false,
      canDelete: false,
      author,
      attachments: starter?.attachments?.map?.(serializeDashboardAttachment) || [],
      embeds: starter?.embeds?.map?.(serializeDashboardEmbed) || [],
      stickers: starter?.stickers?.map?.(serializeDashboardSticker) || [],
      components: serializeDashboardComponents(starter),
      reactions: starter?.reactions?.cache?.map?.(serializeDashboardReaction) || [],
      tags,
      thread: {
        id: thread.id,
        name: thread.name || thread.id,
        parentId: thread.parentId || channel.id,
        archived: Boolean(thread.archived),
        locked: Boolean(thread.locked),
        pinned,
        messageCount: Math.max(0, Number(thread.messageCount || 0)),
        totalMessageSent: Math.max(0, Number(thread.totalMessageSent || 0)),
        createdAt: thread.createdAt?.toISOString?.() || null,
        autoArchiveDuration: Number(thread.autoArchiveDuration || 0),
        tags
      }
    };
  })).then((rows) => rows.sort(compareDashboardForumPosts));
  return {
    channel: {
      id: channel.id,
      name: channel.name || channel.id,
      topic: channel.topic || '',
      type: channel.type,
      isThread: false,
      isForumLike: true,
      isMedia: Number(channel.type) === ChannelType.GuildMedia,
      parentId: channel.parentId || null,
      nsfw: Boolean(channel.nsfw),
      rateLimitPerUser: Number(channel.rateLimitPerUser || 0),
      editable: Boolean(actorCanManageChannels && botCanManageChannel && channel.manageable !== false),
      supportsMessageCounter: false,
      messageCounter: { enabled: false, template: '', preview: channel.topic || '', hasPlaceholder: false, placeholders: [] },
      url: `https://discord.com/channels/${guild.id}/${channel.id}`
    },
    messages,
    nextBefore: nextBefore || null,
    hasMore: Boolean(hasMore),
    storage: 'forum-posts-live',
    fetchedAt: new Date().toISOString()
  };
};
