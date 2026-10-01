import { resolveAvatarFromHash } from '../runtime/utils.js';

export const isDiscordDefaultAvatarUrl = (value) => {
  const url = String(value || '').toLowerCase();
  if (!url) return false;
  return /https?:\/\/(?:cdn|media)\.discord(app)?\.com\/embed\/avatars\/\d+\.png/.test(url);
};

export const normalizeDiscordId = (value) => {
  const candidate = String(value || '').trim();
  return /^\d{15,22}$/.test(candidate) ? candidate : '';
};

export const extractMentionIdsFromText = (text = '') => {
  const value = String(text || '');
  return [...new Set([...value.matchAll(/<@!?(\d{15,22})>/g)].map((match) => match[1]).filter(Boolean))];
};

export const resolveDashboardAvatarUrl = (entity, options = { size: 128 }) => {
  const user = entity?.user || entity || null;
  if (!user?.id) return null;
  const resolved = user.displayAvatarURL?.(options);
  if (resolved) return String(resolved);
  if (entity?.avatar && entity?.guild?.id) {
    const extension = String(entity.avatar.startsWith('a_') ? 'gif' : (options.extension || 'png')).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png';
    const guildSize = Number(options.size || 128);
    const normalizedGuildSize = Number.isFinite(guildSize) && guildSize > 0 ? Math.min(4096, Math.max(16, Math.round(guildSize))) : 128;
    return `https://cdn.discordapp.com/guilds/${String(entity.guild.id)}/users/${String(user.id)}/avatars/${String(entity.avatar)}.${extension}?size=${normalizedGuildSize}`;
  }
  if (user.avatar) return resolveAvatarFromHash(user.id, user.avatar, options);
  return user.defaultAvatarURL || null;
};

export const resolveDashboardAvatarUrlWithFallback = async (guild, memberOrUser, options = {}) => {
  const base = resolveDashboardAvatarUrl(memberOrUser, options);
  if (!guild || !isDiscordDefaultAvatarUrl(base) || !memberOrUser?.id) {
    return base;
  }

  try {
    const refreshed = await guild.members.fetch({ user: String(memberOrUser.id), force: true }).catch(() => null);
    if (!refreshed) return base;
    const candidate = resolveDashboardAvatarUrl(refreshed, options);
    return candidate || base;
  } catch {
    return base;
  }
};

export const resolveIndexedUserProfile = async (guild, userId, client, { allowGuildFetch = true } = {}) => {
  const normalizedUserId = normalizeDiscordId(userId);
  if (!normalizedUserId) {
    return { id: '', user: null, member: null };
  }
  let member = guild.members.cache.get(normalizedUserId) || null;
  let user = member?.user || client.users.cache.get(normalizedUserId) || null;

  if (!member && !user && allowGuildFetch && guild && userId) {
    member = await guild.members.fetch(normalizedUserId).catch(() => null);
    user = member?.user || user;
  }

  if (!user) {
    user = await client.users.fetch(normalizedUserId).catch(() => null);
    if (!member && user?.id && guild?.id) {
      member = await guild.members.fetch(normalizedUserId).catch(() => member);
    }
  }

  return {
    id: normalizedUserId,
    user,
    member
  };
};

export const resolveIndexedMessageAuthor = async (guild, channel, record, client, identityCache = new Map()) => {
  const authorId = normalizeDiscordId(record?.authorId);
  const cacheKey = `author:${authorId || String(record?.authorName || '').trim() || record?.id || ''}`;
  const cached = identityCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  let identity = await resolveIndexedUserProfile(guild, authorId, client, { allowGuildFetch: true });
  let liveMessage = null;
  if (!identity.user && record?.id && channel?.messages?.fetch) {
    liveMessage = await channel.messages.fetch(String(record.id)).catch(() => null);
  }
  if (!identity.user && liveMessage?.author?.id) {
    identity = {
      ...identity,
      id: normalizeDiscordId(liveMessage.author.id),
      user: liveMessage.author,
      member: liveMessage.member || identity.member
    };
  }
  const finalMember = identity.member || liveMessage?.member || null;
  const finalUser = finalMember?.user || liveMessage?.author || identity.user || null;
  const botUser = identity.id === normalizeDiscordId(client.user?.id);
  const fallbackId = authorId || normalizeDiscordId(record?.userId) || normalizeDiscordId(finalUser?.id) || '';
  let avatarUrl = null;
  if (finalUser?.id) {
    avatarUrl = await resolveDashboardAvatarUrlWithFallback(guild, finalMember || finalUser, { size: 128 });
  }
  const fallbackUsername = String(record?.authorName || finalUser?.username || '').trim() || (fallbackId ? `@${fallbackId}` : 'Unbekannt');
  const fallbackDisplayName = String(
    finalMember?.displayName
    || finalUser?.globalName
    || finalUser?.username
    || record?.authorName
    || ''
  ).trim() || fallbackUsername;

  const profile = {
    id: identity.id || fallbackId,
    username: fallbackUsername || 'Unbekannt',
    displayName: fallbackDisplayName || 'Unbekannt',
    avatarUrl,
    avatar: avatarUrl,
    fallbackAvatar: finalUser?.defaultAvatarURL || null,
    bot: Boolean(record?.authorBot || botUser || finalUser?.bot)
  };
  identityCache.set(cacheKey, profile);
  return profile;
};

export const resolveIndexedMentionProfile = async (guild, mentionId, client, identityCache = new Map()) => {
  const cacheKey = `mention:${normalizeDiscordId(mentionId)}`;
  const cached = identityCache.get(cacheKey);
  if (cached) return cached;

  const identity = await resolveIndexedUserProfile(guild, mentionId, client, { allowGuildFetch: true });
  const resolvedUser = identity.member?.user || identity.user || null;
  const fallbackId = normalizeDiscordId(mentionId);
  const profile = {
    id: normalizeDiscordId(mentionId) || identity.id,
    username: String(resolvedUser?.username || '').trim() || (fallbackId ? `@${fallbackId}` : ''),
    displayName: String(identity.member?.displayName || resolvedUser?.globalName || resolvedUser?.username || '').trim() || (fallbackId ? `@${fallbackId}` : '')
  };
  identityCache.set(cacheKey, profile);
  return profile;
};
