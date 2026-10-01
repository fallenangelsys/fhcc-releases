import { ChannelType } from 'discord.js';
import { THREAD_CHANNEL_TYPES, isForumLikeChannel } from './channelTypes.js';

const dashboardOrderCollator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

export const discordPosition = (entry, fallback = 0) => {
  const value = Number(entry?.rawPosition ?? entry?.position ?? fallback);
  return Number.isFinite(value) ? value : fallback;
};

export const compareDiscordNames = (left, right) =>
  dashboardOrderCollator.compare(String(left?.name || left?.id || ''), String(right?.name || right?.id || ''));

export const compareDiscordIds = (left, right) => {
  const leftId = String(left?.id || '');
  const rightId = String(right?.id || '');
  if (/^\d+$/.test(leftId) && /^\d+$/.test(rightId)) {
    const delta = BigInt(leftId) - BigInt(rightId);
    return delta < 0n ? -1 : delta > 0n ? 1 : 0;
  }
  return leftId.localeCompare(rightId, 'en', { numeric: true });
};

export const dashboardChannelSortBucket = (channel) => {
  const type = Number(channel?.type);
  if (channel?.isCategory || type === ChannelType.GuildCategory) return 0;
  if (channel?.isThread || THREAD_CHANNEL_TYPES.has(type)) return 2;
  if (channel?.isVoice || type === ChannelType.GuildVoice || type === ChannelType.GuildStageVoice) return 10;
  if (channel?.isForumLike || channel?.isText || type === ChannelType.GuildText || type === ChannelType.GuildAnnouncement || type === ChannelType.GuildForum || type === ChannelType.GuildMedia) return 1;
  return 5;
};

export const compareDiscordRoleHierarchy = (left, right) => {
  if (typeof left?.comparePositionTo === 'function') {
    const delta = right.comparePositionTo(left);
    if (delta) return delta;
  }
  const delta = discordPosition(right) - discordPosition(left);
  if (delta) return delta;
  return compareDiscordIds(left, right) || compareDiscordNames(left, right);
};

export const compareTopLevelDashboardChannels = (left, right) => {
  const leftPosition = discordPosition(left);
  const rightPosition = discordPosition(right);
  if (leftPosition !== rightPosition) return leftPosition - rightPosition;
  return compareDiscordIds(left, right) || compareDiscordNames(left, right);
};

export const compareDashboardCategoryChildren = (left, right) => {
  const leftPosition = discordPosition(left);
  const rightPosition = discordPosition(right);
  if (leftPosition !== rightPosition) return leftPosition - rightPosition;
  return compareDiscordIds(left, right) || compareDiscordNames(left, right);
};

export const compareDashboardChannelRows = (left, right) => {
  const leftTop = left.isCategory || !left.parentId ? discordPosition(left) : Number(left.categoryPosition ?? left.parentPosition ?? left.position ?? 0);
  const rightTop = right.isCategory || !right.parentId ? discordPosition(right) : Number(right.categoryPosition ?? right.parentPosition ?? right.position ?? 0);
  if (leftTop !== rightTop) return leftTop - rightTop;
  if (left.isCategory && String(right.parentId || '') === String(left.id)) return -1;
  if (right.isCategory && String(left.parentId || '') === String(right.id)) return 1;
  const leftParent = String(left.parentId || '');
  const rightParent = String(right.parentId || '');
  if (leftParent !== rightParent) return leftParent.localeCompare(rightParent, 'de', { numeric: true, sensitivity: 'base' });
  const childDelta = compareDashboardCategoryChildren(left, right);
  if (childDelta) return childDelta;
  if (left.isCategory !== right.isCategory) return left.isCategory ? -1 : 1;
  if (left.isThread !== right.isThread) return left.isThread ? 1 : -1;
  return compareDiscordIds(left, right) || compareDiscordNames(left, right);
};

export const withDashboardDisplayOrder = (rows) => {
  const uniqueRows = rows.filter((channel, index, list) => list.findIndex((entry) => entry.id === channel.id) === index);
  const rowById = new Map(uniqueRows.map((row) => [String(row.id), row]));
  const childrenByParent = new Map();
  const rootRows = [];
  const categoryRows = [];
  const orphanRows = [];
  for (const row of uniqueRows) {
    if (!row.isCategory && row.parentId && rowById.has(String(row.parentId))) {
      const key = String(row.parentId);
      if (!childrenByParent.has(key)) childrenByParent.set(key, []);
      childrenByParent.get(key).push(row);
    } else if (row.isCategory) {
      categoryRows.push(row);
    } else if (!row.parentId) {
      rootRows.push(row);
    } else {
      orphanRows.push(row);
    }
  }
  for (const children of childrenByParent.values()) children.sort(compareDashboardCategoryChildren);
  rootRows.sort(compareTopLevelDashboardChannels);
  categoryRows.sort(compareTopLevelDashboardChannels);
  orphanRows.sort(compareDashboardCategoryChildren);
  const ordered = [];
  const pushRow = (row) => {
    if (ordered.includes(row)) return;
    row.displayOrder = ordered.length;
    ordered.push(row);
  };
  for (const row of rootRows) pushRow(row);
  for (const row of categoryRows) {
    pushRow(row);
    for (const child of childrenByParent.get(String(row.id)) || []) pushRow(child);
  }
  for (const row of orphanRows) pushRow(row);
  for (const row of uniqueRows.sort(compareDashboardChannelRows)) pushRow(row);
  return ordered;
};

export const DASHBOARD_CONFIG_CHANNEL_TYPES = new Set([
  ChannelType.GuildText,
  ChannelType.GuildVoice,
  ChannelType.GuildCategory,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildStageVoice,
  ChannelType.GuildForum,
  ChannelType.GuildMedia
]);
