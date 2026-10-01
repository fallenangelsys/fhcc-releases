export const messageUrl = (guildId, channelId, messageId) =>
  `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;

export const serializeDashboardEmbed = (embed) => ({
  title: embed.title || '',
  description: embed.description || '',
  url: embed.url || '',
  type: embed.type || '',
  color: embed.hexColor || '',
  image: embed.image?.url || '',
  thumbnail: embed.thumbnail?.url || '',
  author: embed.author?.name || '',
  authorIcon: embed.author?.iconURL || '',
  footer: embed.footer?.text || '',
  footerIcon: embed.footer?.iconURL || '',
  timestamp: embed.timestamp?.toISOString?.() || null,
  fields: embed.fields?.map((field) => ({ name: field.name, value: field.value, inline: field.inline })) || []
});

export const serializeDashboardAttachment = (attachment) => ({
  id: attachment.id,
  name: attachment.name || 'Datei',
  url: attachment.url,
  contentType: attachment.contentType || attachment.content_type || '',
  size: attachment.size || 0
});

export const serializeDashboardSticker = (sticker) => ({
  id: sticker.id,
  name: sticker.name,
  url: sticker.url || `https://media.discordapp.net/stickers/${sticker.id}.png?size=160`,
  previewUrl: `https://media.discordapp.net/stickers/${sticker.id}.png?size=160`,
  format: sticker.format
});

export const serializeDashboardReaction = (reaction) => ({
  emoji: reaction.emoji.toString(),
  id: reaction.emoji.id || '',
  name: reaction.emoji.name || '',
  animated: Boolean(reaction.emoji.animated),
  identifier: reaction.emoji.identifier || reaction.emoji.toString(),
  url: reaction.emoji.imageURL?.({ size: 64, extension: reaction.emoji.animated ? 'gif' : 'png' }) || '',
  count: reaction.count || 0
});

export const serializeDashboardComponent = (component) => {
  const data = typeof component?.toJSON === 'function' ? component.toJSON() : component;
  if (!data || typeof data !== 'object') return null;
  const result = {
    type: data.type,
    customId: String(data.custom_id || data.customId || ''),
    label: String(data.label || ''),
    style: data.style,
    emoji: data.emoji ? {
      id: String(data.emoji.id || ''),
      name: String(data.emoji.name || ''),
      animated: Boolean(data.emoji.animated)
    } : null,
    disabled: Boolean(data.disabled),
    url: String(data.url || '')
  };
  if (Array.isArray(data.options)) {
    result.options = data.options.map((option) => ({
      label: String(option?.label || ''),
      value: String(option?.value || ''),
      description: String(option?.description || ''),
      emoji: option?.emoji ? {
        id: String(option.emoji.id || ''),
        name: String(option.emoji.name || ''),
        animated: Boolean(option.emoji.animated)
      } : null,
      default: Boolean(option?.default)
    })).filter((option) => option.label && option.value);
  }
  if (data.placeholder) result.placeholder = String(data.placeholder || '');
  if (data.min_values !== undefined || data.minValues !== undefined) result.minValues = Number(data.min_values ?? data.minValues) || 0;
  if (data.max_values !== undefined || data.maxValues !== undefined) result.maxValues = Number(data.max_values ?? data.maxValues) || 1;
  return result;
};

export const serializeDashboardComponents = (message) => (message?.components || [])
  .map((row) => {
    const data = typeof row?.toJSON === 'function' ? row.toJSON() : row;
    const components = (data?.components || []).map(serializeDashboardComponent).filter(Boolean);
    return components.length ? { type: data?.type || 1, components } : null;
  })
  .filter(Boolean);

export const serializeOutsideImageAttachment = (message) => {
  const values = message?.attachments instanceof Map || typeof message?.attachments?.values === 'function'
    ? [...message.attachments.values()]
    : Array.isArray(message?.attachments)
      ? message.attachments
      : [];
  const realImages = values.filter((item) => !/^fh-asset-\d+\./i.test(String(item?.name || item?.filename || '')));
  const attachment = realImages.find((item) => /^image\/(?:png|jpeg|webp|gif)$/i.test(String(item?.contentType || item?.content_type || '')))
    || realImages[0]
    || values[0];
  if (!attachment?.url) return null;
  return {
    id: String(attachment.id || ''),
    url: String(attachment.url),
    name: String(attachment.name || attachment.filename || 'fallen-heaven-image.png'),
    size: Math.max(0, Number(attachment.size || 0)),
    contentType: String(attachment.contentType || attachment.content_type || '')
  };
};
