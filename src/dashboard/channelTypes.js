import { ChannelType, ChannelFlagsBitField } from 'discord.js';

export const FORUM_LIKE_CHANNEL_TYPES = new Set([ChannelType.GuildForum, ChannelType.GuildMedia]);
export const THREAD_CHANNEL_TYPES = new Set([ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread]);

export const isForumLikeChannel = (channel) => FORUM_LIKE_CHANNEL_TYPES.has(Number(channel?.type));
export const isThreadChannel = (channel) => Boolean(channel?.isThread?.()) || THREAD_CHANNEL_TYPES.has(Number(channel?.type));

export const channelHasFlag = (channel, flagName, fallbackValue) => {
  const flags = channel?.flags;
  const flagValue = Number(ChannelFlagsBitField?.Flags?.[flagName] || fallbackValue || 0);
  if (!flags || !flagValue) return false;
  if (typeof flags.has === 'function') {
    try {
      if (flags.has(flagValue) || flags.has(flagName)) return true;
    } catch (_error) {}
  }
  const bitfield = Number(flags.bitfield ?? flags);
  return Number.isFinite(bitfield) && (bitfield & flagValue) === flagValue;
};

export const forumChannelRequiresTag = (channel) => Boolean(isForumLikeChannel(channel) && channelHasFlag(channel, 'RequireTag', 16));

export const isSelectableTextChannel = (channel) => Boolean(
  channel
  && channel.type !== ChannelType.GuildCategory
  && (channel.isTextBased?.() || isForumLikeChannel(channel) || isThreadChannel(channel))
);
