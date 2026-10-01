import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { ensureEmojiLibraryLoaded, getEmojiLibraryMapping } from '../runtime/emojiLibrary.js';

export const reactionRoleEmojiKey = (value = {}) => {
  const raw = String(value.emoji || '').trim();
  const mention = raw.match(/^<a?:([^:>]+):(\d+)>$/);
  const id = String(value.emojiId || value.id || mention?.[2] || '').trim();
  return id || String(value.emojiName || value.name || value.emoji || '').trim();
};

export const reactionRoleEmojiInput = (value = {}) => {
  const raw = String(value.emoji || '').trim();
  const mention = raw.match(/^<a?:([^:>]+):(\d+)>$/);
  const id = String(value.emojiId || value.id || mention?.[2] || '').trim();
  const name = String(value.emojiName || value.name || mention?.[1] || '').trim();
  if (id) return id;
  return raw || name;
};

export const normalizeReactionRoleEmojiName = (value) => String(value || '')
  .trim()
  .toLocaleLowerCase('de')
  .replace(/[^a-z0-9äöüß_]+/g, '');

export const reactionRoleEmojiCatalog = async (guild, client) => {
  const guildCollection = await guild.emojis.fetch().catch(() => guild.emojis.cache);
  const applicationCollection = await client.application?.emojis?.fetch?.().catch(() => null);
  return [
    ...Array.from(guildCollection?.values?.() || []),
    ...Array.from(applicationCollection?.values?.() || [])
  ].filter((emoji, index, values) => emoji?.id && values.findIndex((entry) => entry.id === emoji.id) === index);
};

export const resolveReactionRoleEmoji = async (guild, entry, catalog) => {
  const requestedId = reactionRoleEmojiKey(entry);
  const requestedName = normalizeReactionRoleEmojiName(entry.emojiName || entry.name || String(entry.emoji || '').match(/^<a?:([^:>]+):\d+>$/)?.[1]);
  let resolved = catalog.find((emoji) => String(emoji.id) === String(requestedId));

  if (!resolved && requestedId) {
    await ensureEmojiLibraryLoaded();
    const mapped = getEmojiLibraryMapping(`${guild.id}:${requestedId}`);
    if (mapped?.targetId) resolved = catalog.find((emoji) => String(emoji.id) === String(mapped.targetId));
  }

  if (!resolved && requestedName) {
    resolved = catalog.find((emoji) => normalizeReactionRoleEmojiName(emoji.name) === requestedName);
  }

  if (!resolved && requestedName) {
    resolved = catalog.find((emoji) => {
      const candidate = normalizeReactionRoleEmojiName(emoji.name);
      return candidate && (candidate.includes(requestedName) || requestedName.includes(candidate));
    });
  }

  if (!resolved) return {
    input: reactionRoleEmojiInput(entry),
    emojiId: String(entry.emojiId || ''),
    emojiName: String(entry.emojiName || entry.emoji || ''),
    replaced: false
  };

  return {
    input: resolved.id,
    emojiId: resolved.id,
    emojiName: resolved.name,
    animated: Boolean(resolved.animated),
    replaced: String(resolved.id) !== String(requestedId)
  };
};

export const normalizeReactionRoleTemplate = (entries = []) => (Array.isArray(entries) ? entries : [])
  .map((entry = {}) => ({
    emoji: String(entry.emoji || '').trim(),
    emojiId: String(entry.emojiId || entry.id || '').trim(),
    emojiName: String(entry.emojiName || entry.name || '').trim(),
    animated: Boolean(entry.animated),
    roleId: String(entry.roleId || '').trim(),
    exclusive: entry.exclusive !== false,
    group: String(entry.group || 'reaction-colors').trim().slice(0, 80)
  }))
  .filter((entry) => reactionRoleEmojiKey(entry) && entry.roleId);

export const reactionRoleButtonEmoji = (rule = {}) => {
  if (rule.emojiId) {
    return { id: rule.emojiId, name: rule.emojiName || rule.emojiKey || 'role', animated: Boolean(rule.animated) };
  }
  return rule.emojiName || rule.emojiKey || undefined;
};

export const buildReactionRoleButtonRows = (rules = []) => {
  const buttons = (Array.isArray(rules) ? rules : []).slice(0, 20).map((rule) => {
    const button = new ButtonBuilder()
      .setCustomId(rule.componentId)
      .setLabel(String(rule.roleName || 'Rolle').slice(0, 80))
      .setStyle(ButtonStyle.Secondary);
    const emoji = reactionRoleButtonEmoji(rule);
    if (emoji) button.setEmoji(emoji);
    return button;
  });
  const rows = [];
  for (let index = 0; index < buttons.length; index += 5) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(index, index + 5)));
  }
  return rows;
};
