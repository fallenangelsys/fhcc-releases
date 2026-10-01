import { EmbedBuilder } from 'discord.js';
import { fetchEmbedAsset } from './embedAssetCache.js';

const defaultFormatValue = (value, context = {}) => String(value || '')
  .replaceAll('{user}', context.userMention || '@User')
  .replaceAll('{username}', context.username || 'Username')
  .replaceAll('{userAvatar}', context.userAvatar || '')
  .replaceAll('{guild}', context.guildName || 'Server')
  .replaceAll('{level}', String(context.level || 1))
  .replaceAll('{memberCount}', String(context.memberCount || 0));

const parseEmbedColor = (value) => {
  const normalized = String(value || '#27c4e8').replace('#', '').trim();
  const parsed = Number.parseInt(normalized, 16);
  return Number.isFinite(parsed) ? parsed : 0x27c4e8;
};

const validateDiscordEmbedSources = (sources = []) => {
  if (sources.length > 10) throw new Error('Discord erlaubt maximal 10 Embeds pro Nachricht.');
  let totalCharacters = 0;
  sources.forEach((embedData = {}, index) => {
    const label = `Embed ${index + 1}`;
    const fields = Array.isArray(embedData.fields) ? embedData.fields : [];
    for (const [name, value, maximum] of [
      ['Titel', embedData.title, 256],
      ['Beschreibung', embedData.description, 4096],
      ['Autor', embedData.authorName, 256],
      ['Footer', embedData.footerText, 2048]
    ]) {
      const length = String(value || '').length;
      totalCharacters += length;
      if (length > maximum) throw new Error(`${label}: ${name} darf maximal ${maximum.toLocaleString('de-DE')} Zeichen enthalten.`);
    }
    if (fields.length > 25) throw new Error(`${label}: Discord erlaubt maximal 25 Felder.`);
    fields.forEach((field = {}, fieldIndex) => {
      const nameLength = String(field.name || '').length;
      const valueLength = String(field.value || '').length;
      totalCharacters += nameLength + valueLength;
      if (nameLength > 256) throw new Error(`${label}, Feld ${fieldIndex + 1}: Der Name darf maximal 256 Zeichen enthalten.`);
      if (valueLength > 1024) throw new Error(`${label}, Feld ${fieldIndex + 1}: Der Wert darf maximal 1.024 Zeichen enthalten.`);
    });
  });
  if (totalCharacters > 6000) throw new Error('Alle Embeds zusammen dürfen maximal 6.000 Zeichen enthalten.');
};

const buildSingleEmbedPayload = async (template, guild, assetState, options) => {
  const formatValue = options.formatValue || defaultFormatValue;
  const fetchAsset = options.fetchAsset || fetchEmbedAsset;
  const context = {
    guildName: guild?.name || 'Server',
    memberCount: guild?.memberCount || 0,
    userMention: '@User',
    username: 'Username',
    userAvatar: guild?.iconURL?.({ size: 256 }) || ''
  };
  const embedData = template.embed || {};
  const outsideImage = formatValue(template.outsideImageUrl || embedData.outsideImageUrl, context);
  const outsideImageName = String(template.outsideImageName || embedData.outsideImageName || 'fallen-heaven-image.png');
  const dataImageMatch = String(outsideImage).match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([a-z0-9+/=\r\n]+)$/i);
  let outsideFile = dataImageMatch ? Buffer.from(dataImageMatch[2], 'base64') : null;
  if (outsideFile && outsideFile.length > 25 * 1024 * 1024) throw new Error('Das Außenbild darf maximal 25 MB groß sein.');
  if (!outsideFile && outsideImage && /^https?:\/\//i.test(outsideImage)) {
    const asset = await fetchAsset(outsideImage, { maxBytes: 25 * 1024 * 1024 });
    if (!asset?.buffer?.length) throw new Error('Das Außenbild konnte nicht geladen werden. Bitte wähle es im Studio erneut aus.');
    if (asset.buffer.length > 25 * 1024 * 1024) throw new Error('Das Außenbild darf maximal 25 MB groß sein.');
    outsideFile = asset.buffer;
  }
  const embedAssetBudget = 10 - (outsideFile ? 1 : 0);
  const embed = new EmbedBuilder().setColor(parseEmbedColor(embedData.color));
  const title = formatValue(embedData.title, context).slice(0, 256);
  const description = formatValue(embedData.description, context).slice(0, 4096);
  if (title) embed.setTitle(title);
  const titleUrl = formatValue(embedData.url, context);
  if (title && /^https?:\/\//i.test(titleUrl)) embed.setURL(titleUrl);
  if (description) embed.setDescription(description);

  const embedAssetFiles = [];
  const attachEmbedImage = async (value) => {
    if (!value || !/^https?:\/\//i.test(String(value))) return null;
    if (assetState.counter >= Math.max(1, embedAssetBudget)) return null;
    const asset = await fetchAsset(value);
    if (!asset?.buffer?.length) return null;
    assetState.counter += 1;
    const extension = String(asset.ext || 'png').toLowerCase().replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '') || 'png';
    const name = `fh-asset-${assetState.counter}.${extension}`;
    embedAssetFiles.push({ attachment: asset.buffer, name });
    return `attachment://${name}`;
  };

  const authorName = formatValue(embedData.authorName, context).slice(0, 256);
  const authorIcon = formatValue(embedData.authorIconUrl, context);
  if (authorName) {
    const reference = await attachEmbedImage(authorIcon);
    embed.setAuthor({ name: authorName, iconURL: reference || authorIcon || undefined });
  }
  const thumbnail = formatValue(embedData.thumbnailUrl, context);
  const image = formatValue(embedData.imageUrl, context);
  const thumbnailReference = await attachEmbedImage(thumbnail);
  if (thumbnailReference) embed.setThumbnail(thumbnailReference);
  else if (thumbnail && /^https?:\/\//i.test(thumbnail) && !/cdn\.discordapp\.com\//i.test(thumbnail)) embed.setThumbnail(thumbnail);
  const imageReference = await attachEmbedImage(image);
  if (imageReference) embed.setImage(imageReference);
  else if (image && /^https?:\/\//i.test(image) && !/cdn\.discordapp\.com\//i.test(image)) embed.setImage(image);

  const footerText = formatValue(embedData.footerText, context).slice(0, 2048);
  const footerIcon = formatValue(embedData.footerIconUrl, context);
  if (footerText) {
    const reference = await attachEmbedImage(footerIcon);
    embed.setFooter({ text: footerText, iconURL: reference || footerIcon || undefined });
  }
  if (embedData.timestamp) embed.setTimestamp(new Date());
  const fields = (Array.isArray(embedData.fields) ? embedData.fields : []).map((field) => ({
    name: formatValue(field?.name, context).slice(0, 256) || '\u200b',
    value: formatValue(field?.value, context).slice(0, 1024) || '\u200b',
    inline: Boolean(field?.inline)
  })).slice(0, 25);
  if (fields.length) embed.addFields(fields);

  const safeFileName = outsideImageName.replace(/[^a-z0-9._-]/gi, '_').slice(-120) || 'fallen-heaven-image.png';
  return {
    content: formatValue(template.content, context),
    embeds: [embed],
    files: embedAssetFiles.concat(outsideFile ? [{ attachment: outsideFile, name: safeFileName }] : []),
    attachments: template.removeOutsideImage === true || outsideFile || embedAssetFiles.length ? [] : undefined
  };
};

export const buildStudioEmbedPayload = async (template = {}, guild, options = {}) => {
  const sources = Array.isArray(template.embeds) && template.embeds.length ? template.embeds : [template.embed || {}];
  validateDiscordEmbedSources(sources);
  const assetState = { counter: 0 };
  const builtList = [];
  for (const embed of sources) builtList.push(await buildSingleEmbedPayload({ ...template, embed }, guild, assetState, options));
  const primary = builtList[0];
  if (primary.content.length > 2000) throw new Error('Die Nachricht über dem Embed darf einschließlich Bild-Link maximal 2.000 Zeichen enthalten.');
  const extraEmbedAssets = builtList.slice(1)
    .flatMap((built) => (built.files || []).filter((file) => /^fh-asset-\d+\./i.test(String(file.name))));
  return {
    content: primary.content,
    embeds: builtList.map((built) => built.embeds[0]),
    files: (primary.files || []).concat(extraEmbedAssets),
    attachments: primary.attachments
  };
};

export const _studioEmbedPayloadInternals = { defaultFormatValue, parseEmbedColor, validateDiscordEmbedSources, buildSingleEmbedPayload };
