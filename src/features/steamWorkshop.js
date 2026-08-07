import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelFlagsBitField,
  ChannelType,
  EmbedBuilder
} from 'discord.js';

import { atomicWriteJson, readJsonWithRecovery } from '../runtime/atomicJsonStore.js';
import { recordDiagnosticError } from '../runtime/liveDiagnostics.js';

const DATA_ROOT = process.env.FALLEN_HEAVEN_DATA_DIR || path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_ROOT, 'steam-workshop.json');
const ASSET_ROOT = path.join(DATA_ROOT, 'steam-workshop-assets');
const DATA_VERSION = 1;
const STEAM_ENDPOINT = 'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/';
const STEAM_TIMEOUT_MS = 20_000;
const MINIMUM_INTERVAL_MINUTES = 15;
const MAXIMUM_INTERVAL_MINUTES = 1_440;
const DEFAULT_COLOR = '#1b2838';
const PINNED_FLAG = Number(ChannelFlagsBitField?.Flags?.Pinned || 2);

const emptyStore = () => ({ version: DATA_VERSION, guilds: {} });
let store = null;
let loadPromise = null;
let saveQueue = Promise.resolve();
const runtimes = new Map();
const schedules = new Map();
const syncLocks = new Map();

const safeInteger = (value, fallback, minimum, maximum) => {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
};
const safeText = (value, fallback = '', maximum = 4_096) => String(value ?? fallback).slice(0, maximum);
const safeUrl = (value) => {
  const normalized = String(value || '').trim();
  return /^https?:\/\/[^\s]+$/i.test(normalized) ? normalized.slice(0, 2_000) : '';
};
const safeColor = (value, fallback = DEFAULT_COLOR) => /^#[0-9a-f]{6}$/i.test(String(value || '').trim())
  ? String(value).trim().toLowerCase()
  : fallback;
const uniqueWorkshopIds = (value) => [...new Set((Array.isArray(value) ? value : String(value || '').split(/[\r\n,;\s]+/))
  .map((entry) => String(entry || '').trim())
  .filter((entry) => /^\d{6,20}$/.test(entry)))].slice(0, 250);
const uniqueNames = (value) => [...new Set((Array.isArray(value) ? value : String(value || '').split(/[\r\n,]+/))
  .map((entry) => String(entry || '').trim()).filter(Boolean))].slice(0, 5);

export const defaultSteamWorkshopDesign = () => ({
  content: '',
  outsideImageUrl: '',
  outsideImageAssetName: '',
  outsideImageAssetSize: 0,
  embed: {
    title: '{title}',
    url: '{workshopUrl}',
    description: '{description}',
    color: DEFAULT_COLOR,
    authorName: 'STEAM WORKSHOP · {game}',
    authorIconUrl: '',
    thumbnailUrl: '',
    imageUrl: '{previewUrl}',
    footerText: 'Workshop-ID: {workshopId}',
    footerIconUrl: '',
    timestamp: true,
    fields: [
      { name: 'REICHWEITE', value: '**{subscriptions}** Abonnenten\n**{favorites}** Favoriten\n**{views}** Aufrufe', inline: true },
      { name: 'VERÖFFENTLICHUNG', value: 'Erstellt: {createdAt}\nAktualisiert: {updatedAt}', inline: true },
      { name: 'DATEI', value: '{fileSize}\nApp-ID: `{appId}`', inline: true },
      { name: 'TAGS', value: '{tags}', inline: false }
    ]
  }
});

const normalizeDesign = (value = {}) => {
  const fallback = defaultSteamWorkshopDesign();
  const source = value && typeof value === 'object' ? value : {};
  const embed = source.embed && typeof source.embed === 'object' ? source.embed : {};
  return {
    content: safeText(source.content, fallback.content, 2_000),
    outsideImageUrl: safeUrl(source.outsideImageUrl),
    outsideImageAssetName: safeText(source.outsideImageAssetName, '', 120).replace(/[^a-z0-9._-]/gi, '_'),
    outsideImageAssetSize: Math.max(0, Number(source.outsideImageAssetSize || 0)),
    embed: {
      title: safeText(embed.title, fallback.embed.title, 256),
      url: safeText(embed.url, fallback.embed.url, 2_000),
      description: safeText(embed.description, fallback.embed.description, 4_096),
      color: safeColor(embed.color, DEFAULT_COLOR),
      authorName: safeText(embed.authorName, fallback.embed.authorName, 256),
      authorIconUrl: safeText(embed.authorIconUrl, fallback.embed.authorIconUrl, 2_000),
      thumbnailUrl: safeText(embed.thumbnailUrl, fallback.embed.thumbnailUrl, 2_000),
      imageUrl: safeText(embed.imageUrl, fallback.embed.imageUrl, 2_000),
      footerText: safeText(embed.footerText, fallback.embed.footerText, 2_048),
      footerIconUrl: safeText(embed.footerIconUrl, fallback.embed.footerIconUrl, 2_000),
      timestamp: embed.timestamp !== false,
      fields: (Array.isArray(embed.fields) ? embed.fields : fallback.embed.fields)
        .slice(0, 25)
        .map((field) => ({
          name: safeText(field?.name, '', 256),
          value: safeText(field?.value, '', 1_024),
          inline: field?.inline === true
        }))
        .filter((field) => field.name || field.value)
    }
  };
};

export const normalizeSteamWorkshopConfig = (conf = {}) => ({
  enabled: conf?.enabled === true,
  forumChannelId: String(conf?.forumChannelId || '').trim(),
  updateChannelId: String(conf?.updateChannelId || '').trim(),
  workshopIds: uniqueWorkshopIds(conf?.workshopIds),
  syncIntervalMinutes: safeInteger(conf?.syncIntervalMinutes, 30, MINIMUM_INTERVAL_MINUTES, MAXIMUM_INTERVAL_MINUTES),
  syncOnStartup: conf?.syncOnStartup !== false,
  notifyOnUpdate: conf?.notifyOnUpdate === true,
  mentionRoleId: String(conf?.mentionRoleId || '').trim(),
  appliedTagNames: uniqueNames(conf?.appliedTagNames),
  pinPosts: conf?.pinPosts === true,
  buttonLabel: safeText(conf?.buttonLabel, 'Im Steam Workshop öffnen', 80).trim() || 'Im Steam Workshop öffnen',
  maxDescriptionLength: safeInteger(conf?.maxDescriptionLength, 1_400, 300, 1_800),
  preferSteamPreviewImage: conf?.preferSteamPreviewImage !== false,
  showRating: conf?.showRating !== false,
  design: normalizeDesign(conf?.design)
});

const runtimeFor = (guildId) => {
  const key = String(guildId || '');
  if (!runtimes.has(key)) runtimes.set(key, {
    running: false,
    phase: 'idle',
    completed: 0,
    total: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    failed: 0,
    currentWorkshopId: '',
    lastStartedAt: null,
    lastCompletedAt: null,
    nextSyncAt: null,
    lastError: '',
    history: []
  });
  return runtimes.get(key);
};

const ensureStore = async () => {
  if (store) return store;
  if (!loadPromise) loadPromise = readJsonWithRecovery(DATA_FILE, {
    fallback: emptyStore(),
    validate: (value) => value && typeof value === 'object' && value.guilds && typeof value.guilds === 'object'
  }).then(({ value }) => {
    store = { version: DATA_VERSION, guilds: value.guilds || {} };
    return store;
  });
  return loadPromise;
};

const guildStore = async (guildId) => {
  const data = await ensureStore();
  const key = String(guildId || '');
  if (!data.guilds[key]) data.guilds[key] = { items: {}, lastSyncAt: null, history: [] };
  return data.guilds[key];
};

const saveStore = () => {
  saveQueue = saveQueue.catch(() => {}).then(() => atomicWriteJson(DATA_FILE, store || emptyStore(), { backupLimit: 5 }));
  return saveQueue;
};

const safeAssetPath = (diskName) => {
  const base = path.resolve(ASSET_ROOT);
  const target = path.resolve(base, path.basename(String(diskName || '')));
  return target.startsWith(`${base}${path.sep}`) ? target : '';
};

const extensionForImage = (contentType = '', fileName = '') => {
  const mime = String(contentType || '').toLowerCase();
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  const extension = String(fileName || '').toLowerCase().match(/\.(png|jpe?g|webp|gif)$/)?.[1] || '';
  return extension === 'jpeg' ? 'jpg' : extension;
};

export const saveSteamWorkshopBannerAsset = async ({ guildId, buffer, fileName = '', contentType = '' } = {}) => {
  const key = String(guildId || '').trim();
  if (!/^\d{15,25}$/.test(key)) throw new Error('Server-ID für das Workshop-Banner ist ungültig.');
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Das Workshop-Banner ist leer.');
  if (buffer.length > 25 * 1024 * 1024) throw new Error('Das Workshop-Banner darf maximal 25 MB groß sein.');
  const extension = extensionForImage(contentType, fileName);
  if (!extension) throw new Error('Das Workshop-Banner muss PNG, JPG, WEBP oder GIF sein.');
  const data = await guildStore(key);
  const previousPath = safeAssetPath(data.bannerAsset?.diskName);
  const diskName = `${key}-workshop-banner.${extension}`;
  const target = safeAssetPath(diskName);
  if (!target) throw new Error('Der lokale Bannerpfad konnte nicht sicher aufgelöst werden.');
  await fs.mkdir(ASSET_ROOT, { recursive: true });
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, buffer);
  await fs.rm(target, { force: true });
  await fs.rename(temporary, target);
  if (previousPath && previousPath !== target) await fs.rm(previousPath, { force: true });
  data.bannerAsset = {
    diskName,
    name: `fallen-heaven-workshop-banner.${extension}`,
    size: buffer.length,
    contentType: extension === 'jpg' ? 'image/jpeg' : `image/${extension}`,
    updatedAt: new Date().toISOString()
  };
  await saveStore();
  return { ...data.bannerAsset };
};

export const removeSteamWorkshopBannerAsset = async (guildId) => {
  const data = await guildStore(guildId);
  const target = safeAssetPath(data.bannerAsset?.diskName);
  if (target) await fs.rm(target, { force: true });
  const removed = Boolean(data.bannerAsset);
  data.bannerAsset = null;
  await saveStore();
  return removed;
};

const workshopItemRecord = async (guildId, workshopId) => {
  const id = String(workshopId || '').trim();
  if (!/^\d{6,20}$/.test(id)) throw new Error('Die Steam-Workshop-ID ist ungültig.');
  const data = await guildStore(guildId);
  data.items[id] ||= { workshopId: id };
  return { data, id, record: data.items[id] };
};

export const saveSteamWorkshopItemBannerAsset = async ({ guildId, workshopId, buffer, fileName = '', contentType = '' } = {}) => {
  const guildKey = String(guildId || '').trim();
  if (!/^\d{15,25}$/.test(guildKey)) throw new Error('Server-ID für das Workshop-Banner ist ungültig.');
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Das Workshop-Banner ist leer.');
  if (buffer.length > 25 * 1024 * 1024) throw new Error('Das Workshop-Banner darf maximal 25 MB groß sein.');
  const extension = extensionForImage(contentType, fileName);
  if (!extension) throw new Error('Das Workshop-Banner muss PNG, JPG, WEBP oder GIF sein.');
  const { id, record } = await workshopItemRecord(guildKey, workshopId);
  const previousPath = safeAssetPath(record.itemBannerAsset?.diskName);
  const diskName = `${guildKey}-${id}-workshop-banner.${extension}`;
  const target = safeAssetPath(diskName);
  if (!target) throw new Error('Der lokale Bannerpfad konnte nicht sicher aufgelöst werden.');
  await fs.mkdir(ASSET_ROOT, { recursive: true });
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, buffer);
  await fs.rm(target, { force: true });
  await fs.rename(temporary, target);
  if (previousPath && previousPath !== target) await fs.rm(previousPath, { force: true });
  record.itemBannerAsset = {
    diskName,
    name: `fallen-heaven-workshop-${id}.${extension}`,
    size: buffer.length,
    contentType: extension === 'jpg' ? 'image/jpeg' : `image/${extension}`,
    updatedAt: new Date().toISOString()
  };
  await saveStore();
  return { ...record.itemBannerAsset };
};

export const removeSteamWorkshopItemBannerAsset = async (guildId, workshopId) => {
  const { record } = await workshopItemRecord(guildId, workshopId);
  const target = safeAssetPath(record.itemBannerAsset?.diskName);
  if (target) await fs.rm(target, { force: true });
  const removed = Boolean(record.itemBannerAsset);
  record.itemBannerAsset = null;
  await saveStore();
  return removed;
};

const loadSteamWorkshopBannerAsset = async (guildId) => {
  const data = await guildStore(guildId);
  const metadata = data.bannerAsset;
  const target = safeAssetPath(metadata?.diskName);
  if (!target || !metadata?.name) return null;
  const buffer = await fs.readFile(target).catch(() => null);
  return buffer?.length ? { ...metadata, buffer } : null;
};

const loadSteamWorkshopItemBannerAsset = async (guildId, workshopId) => {
  const { record } = await workshopItemRecord(guildId, workshopId);
  const metadata = record.itemBannerAsset;
  const target = safeAssetPath(metadata?.diskName);
  if (!target || !metadata?.name) return null;
  const buffer = await fs.readFile(target).catch(() => null);
  return buffer?.length ? { ...metadata, buffer } : null;
};

const requestSteamDetails = async (ids) => {
  const body = new URLSearchParams({ itemcount: String(ids.length) });
  ids.forEach((id, index) => body.set(`publishedfileids[${index}]`, id));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STEAM_TIMEOUT_MS);
  timer.unref?.();
  try {
    const response = await fetch(STEAM_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body,
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Steam antwortete mit HTTP ${response.status}.`);
    const payload = await response.json();
    const rows = payload?.response?.publishedfiledetails;
    if (!Array.isArray(rows)) throw new Error('Steam hat keine gültige Workshop-Antwort geliefert.');
    return rows;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Steam hat nicht innerhalb von 20 Sekunden geantwortet.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

export const fetchSteamWorkshopItems = async (workshopIds) => {
  const ids = uniqueWorkshopIds(workshopIds);
  const details = [];
  for (let offset = 0; offset < ids.length; offset += 50) {
    details.push(...await requestSteamDetails(ids.slice(offset, offset + 50)));
  }
  const byId = new Map(details.map((item) => [String(item?.publishedfileid || ''), item]));
  return ids.map((id) => byId.get(id) || { publishedfileid: id, result: 9 });
};

const decodeEntities = (value) => String(value || '')
  .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&');

export const cleanSteamDescription = (description, maximum = 2_400) => {
  let text = decodeEntities(description)
    .replace(/\[img\][\s\S]*?\[\/img\]/gi, '')
    .replace(/\[hr\s*\/?\]/gi, '\n────────────\n')
    .replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, '[$2]($1)')
    .replace(/\[url\]([\s\S]*?)\[\/url\]/gi, '$1')
    .replace(/\[(?:h1|h2|h3)\]([\s\S]*?)\[\/(?:h1|h2|h3)\]/gi, '**$1**')
    .replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '**$1**')
    .replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '*$1*')
    .replace(/\[u\]([\s\S]*?)\[\/u\]/gi, '__$1__')
    .replace(/\[strike\]([\s\S]*?)\[\/strike\]/gi, '~~$1~~')
    .replace(/\[\*\]/g, '• ')
    .replace(/\[\/?(?:list|olist|quote|code|table|tr|td|th|spoiler|noparse|previewyoutube[^\]]*)\]/gi, '')
    .replace(/\[\/?[^\]]+\]/g, '')
    .replace(/@(everyone|here)/gi, '@\u200b$1')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length > maximum) text = `${text.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
  return text || 'Für dieses Workshop-Item ist keine Beschreibung hinterlegt.';
};

export const parseSteamCommunityRating = (html = '') => {
  const source = String(html || '');
  const ratingBlock = source.match(/<div[^>]+class=["'][^"']*ratingSection[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i)?.[1] || source;
  const starMatch = ratingBlock.match(/sharedfiles\/([0-5](?:[.,_-]\d+)?)\-star_large\.png/i)
    || ratingBlock.match(/([0-5](?:[.,]\d+)?)\s*(?:von|out of)\s*5/i);
  const ratingValue = starMatch ? Number(String(starMatch[1]).replace(/[_-]/g, '.').replace(',', '.')) : NaN;
  const countText = ratingBlock.match(/class=["'][^"']*numRatings[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || '';
  const ratingCount = Number(String(countText).replace(/<[^>]+>/g, '').replace(/[^0-9]/g, '')) || 0;
  if (!Number.isFinite(ratingValue) || ratingValue < 0 || ratingValue > 5) return null;
  return { ratingValue, ratingCount };
};

const fetchSteamCommunityRating = async (workshopId) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  timer.unref?.();
  try {
    const response = await fetch(`${workshopUrlFor(workshopId)}&l=german`, {
      headers: { 'User-Agent': 'FALLEN-HEAVEN-Control-Center/3.9 (+Steam-Workshop-Katalog)' },
      signal: controller.signal
    });
    if (!response.ok) return null;
    return parseSteamCommunityRating(await response.text());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const enrichSteamRatings = async (items) => {
  const rows = [...items];
  for (let offset = 0; offset < rows.length; offset += 5) {
    await Promise.all(rows.slice(offset, offset + 5).map(async (item) => {
      if (Number(item?.result) !== 1) return;
      const rating = await fetchSteamCommunityRating(item.publishedfileid);
      if (rating) Object.assign(item, rating);
    }));
  }
  return rows;
};

const formatNumber = (value) => Number.isFinite(Number(value)) ? Number(value).toLocaleString('de-DE') : '–';
const formatBytes = (value) => {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 1) return 'Dateigröße unbekannt';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const amount = bytes / (1024 ** index);
  return `${amount.toLocaleString('de-DE', { maximumFractionDigits: index ? 1 : 0 })} ${units[index]}`;
};
const formatSteamTime = (value) => {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Unbekannt';
  return `<t:${Math.floor(seconds)}:f> · <t:${Math.floor(seconds)}:R>`;
};
const visibilityLabel = (value) => ({ 0: 'Öffentlich', 1: 'Nur Freunde', 2: 'Privat', 3: 'Nicht gelistet' })[Number(value)] || 'Unbekannt';
const workshopUrlFor = (id) => `https://steamcommunity.com/sharedfiles/filedetails/?id=${encodeURIComponent(id)}`;

const starRating = (value) => {
  const numeric = Math.max(0, Math.min(5, Number(value) || 0));
  const rounded = Math.round(numeric);
  return `${'★'.repeat(rounded)}${'☆'.repeat(5 - rounded)}`;
};

const itemTokens = (item, conf) => {
  const id = String(item?.publishedfileid || '');
  const appId = String(item?.consumer_app_id || item?.creator_app_id || '');
  const tags = (Array.isArray(item?.tags) ? item.tags : []).map((tag) => String(tag?.tag || '').trim()).filter(Boolean);
  return {
    title: safeText(item?.title, `Workshop ${id}`, 256),
    workshopId: id,
    workshopUrl: workshopUrlFor(id),
    description: cleanSteamDescription(item?.description, conf.maxDescriptionLength),
    previewUrl: safeUrl(item?.preview_url),
    subscriptions: formatNumber(item?.subscriptions),
    lifetimeSubscriptions: formatNumber(item?.lifetime_subscriptions),
    favorites: formatNumber(item?.favorited),
    lifetimeFavorites: formatNumber(item?.lifetime_favorited),
    views: formatNumber(item?.views),
    fileSize: formatBytes(item?.file_size),
    fileName: safeText(item?.filename, 'Unbekannt', 256),
    createdAt: formatSteamTime(item?.time_created),
    updatedAt: formatSteamTime(item?.time_updated),
    appId: appId || 'Unbekannt',
    game: appId ? `APP ${appId}` : 'STEAM',
    gameUrl: appId ? `https://store.steampowered.com/app/${encodeURIComponent(appId)}/` : '',
    creator: String(item?.creator || 'Unbekannt'),
    creatorUrl: item?.creator ? `https://steamcommunity.com/profiles/${encodeURIComponent(item.creator)}` : '',
    tags: tags.length ? tags.map((tag) => `\`${tag}\``).join(' · ') : 'Keine Tags hinterlegt',
    visibility: visibilityLabel(item?.visibility),
    revision: formatNumber(item?.revision_change_number),
    ratingStars: starRating(item?.ratingValue),
    ratingValue: Number.isFinite(Number(item?.ratingValue)) ? Number(item.ratingValue).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '–',
    ratingCount: formatNumber(item?.ratingCount)
  };
};

const replaceTokens = (value, tokens, maximum) => {
  const result = String(value ?? '').replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (match, key) => Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key] : match);
  return result.slice(0, maximum);
};

export const buildSteamWorkshopMessage = (item, rawConf = {}, options = {}) => {
  const conf = normalizeSteamWorkshopConfig(rawConf);
  const tokens = itemTokens(item, conf);
  const design = conf.design;
  const embedSource = design.embed;
  const embed = new EmbedBuilder()
    .setColor(safeColor(embedSource.color, DEFAULT_COLOR))
    .setTitle(replaceTokens(embedSource.title, tokens, 256) || tokens.title)
    .setDescription(replaceTokens(embedSource.description, tokens, 4_096) || tokens.description);
  const embedUrl = safeUrl(replaceTokens(embedSource.url, tokens, 2_000));
  if (embedUrl) embed.setURL(embedUrl);
  const authorName = replaceTokens(embedSource.authorName, tokens, 256).trim();
  const authorIconUrl = safeUrl(replaceTokens(embedSource.authorIconUrl, tokens, 2_000));
  if (authorName) embed.setAuthor({ name: authorName, ...(authorIconUrl ? { iconURL: authorIconUrl } : {}) });
  const thumbnailUrl = safeUrl(replaceTokens(embedSource.thumbnailUrl, tokens, 2_000));
  const configuredImageUrl = safeUrl(replaceTokens(embedSource.imageUrl, tokens, 2_000));
  const imageUrl = options.heroAsset?.name
    ? `attachment://${options.heroAsset.name}`
    : safeUrl(design.outsideImageUrl) || configuredImageUrl || (conf.preferSteamPreviewImage ? tokens.previewUrl : '');
  if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);
  if (imageUrl) embed.setImage(imageUrl);
  const ratingField = conf.showRating ? [{
    name: 'STEAM-BEWERTUNG',
    value: Number.isFinite(Number(item?.ratingValue))
      ? `**${tokens.ratingStars}  ${tokens.ratingValue} / 5**\n${tokens.ratingCount} Bewertungen`
      : '**☆☆☆☆☆  Noch nicht verfügbar**\nSteam liefert für diesen Eintrag momentan keine öffentliche Bewertung.',
    inline: true
  }] : [];
  const fields = ratingField.concat(embedSource.fields.slice(0, conf.showRating ? 24 : 25).map((field) => ({
    name: replaceTokens(field.name, tokens, 256) || '\u200b',
    value: replaceTokens(field.value, tokens, 1_024) || '\u200b',
    inline: field.inline === true
  })));
  if (fields.length) embed.addFields(fields);
  const footerText = replaceTokens(embedSource.footerText, tokens, 2_048).trim();
  const footerIconUrl = safeUrl(replaceTokens(embedSource.footerIconUrl, tokens, 2_000));
  if (footerText) embed.setFooter({ text: footerText, ...(footerIconUrl ? { iconURL: footerIconUrl } : {}) });
  if (embedSource.timestamp !== false) embed.setTimestamp(Number(item?.time_updated || 0) > 0 ? Number(item.time_updated) * 1_000 : Date.now());
  const button = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(conf.buttonLabel).setURL(tokens.workshopUrl);
  const content = replaceTokens(design.content, tokens, 2_000);
  const payload = {
    content,
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(button)],
    allowedMentions: { parse: [] },
    tokens
  };
  if (options.heroAsset?.buffer && !options.existingHeroAttachment?.id) {
    payload.files = [{ attachment: options.heroAsset.buffer, name: options.heroAsset.name }];
    payload.attachments = [];
  } else if (options.existingHeroAttachment?.id) {
    payload.attachments = [{ id: String(options.existingHeroAttachment.id) }];
  } else if (options.manageAttachments === true) payload.attachments = [];
  return payload;
};

const itemFingerprint = (item, conf) => crypto.createHash('sha256').update(JSON.stringify({
  updated: item?.time_updated,
  title: item?.title,
  description: item?.description,
  preview: item?.preview_url,
  subscriptions: item?.subscriptions,
  favorites: item?.favorited,
  views: item?.views,
  ratingValue: item?.ratingValue,
  ratingCount: item?.ratingCount,
  tags: item?.tags,
  design: conf.design,
  buttonLabel: conf.buttonLabel,
  maxDescriptionLength: conf.maxDescriptionLength,
  preferSteamPreviewImage: conf.preferSteamPreviewImage,
  showRating: conf.showRating
})).digest('hex');

const resolveAppliedTags = (forum, names) => {
  const desired = uniqueNames(names).map((name) => name.toLocaleLowerCase('de-DE'));
  const available = [...(forum?.availableTags || [])];
  const matched = available.filter((tag) => desired.includes(String(tag?.name || '').toLocaleLowerCase('de-DE'))).slice(0, 5).map((tag) => tag.id);
  const requiresTag = Boolean(Number(forum?.flags?.bitfield || forum?.flags || 0) & 16);
  if (requiresTag && !matched.length) {
    throw new Error('Das Workshop-Forum verlangt einen Tag. Trage unter „Forum-Tags“ mindestens einen vorhandenen Tag-Namen exakt ein.');
  }
  return matched;
};

const ensureForum = (guild, conf) => {
  const channel = guild.channels.cache.get(conf.forumChannelId);
  if (!channel) throw new Error('Der ausgewählte Workshop-Kanal existiert nicht mehr.');
  if (![ChannelType.GuildForum, ChannelType.GuildMedia].includes(channel.type)) throw new Error('Für den Workshop-Katalog muss ein Forum- oder Media-Kanal ausgewählt sein.');
  return channel;
};

const fetchThreadAndMessage = async (guild, record) => {
  if (!record?.threadId) return { thread: null, message: null };
  const thread = guild.channels.cache.get(record.threadId) || await guild.channels.fetch(record.threadId).catch(() => null);
  if (!thread?.isThread?.()) return { thread: null, message: null };
  let message = null;
  if (record.messageId) message = await thread.messages.fetch(record.messageId).catch(() => null);
  if (!message) message = await thread.fetchStarterMessage?.({ cache: true, force: true }).catch(() => null);
  return { thread, message };
};

const pinThreadIfConfigured = async (thread, conf) => {
  if (!conf.pinPosts || !thread) return;
  const current = Number(thread.flags?.bitfield || thread.flags || 0);
  if ((current & PINNED_FLAG) === PINNED_FLAG) return;
  await thread.edit({ flags: current | PINNED_FLAG, reason: 'Steam-Workshop-Katalog: Post oben anpinnen' }).catch((error) => {
    console.warn(`[steamWorkshop] Post ${thread.id} konnte nicht angepinnt werden: ${error?.message || error}`);
  });
};

const upsertWorkshopPost = async ({ guild, forum, item, conf, record, heroAsset = null, forceDesign = false }) => {
  const id = String(item?.publishedfileid || '');
  if (Number(item?.result) !== 1) throw new Error(`Workshop-ID ${id} wurde von Steam nicht gefunden (Result ${item?.result ?? 'unbekannt'}).`);
  const fingerprint = itemFingerprint(item, conf);
  const previousUpdated = Number(record?.steamUpdatedAt || 0);
  const changedOnSteam = previousUpdated > 0 && previousUpdated !== Number(item?.time_updated || 0);
  let { thread, message } = await fetchThreadAndMessage(guild, record);
  const storedAttachment = record?.heroAttachment?.id
    && String(record?.heroAssetUpdatedAt || '') === String(heroAsset?.updatedAt || '')
    && String(record?.heroAttachment?.name || '') === String(heroAsset?.name || '')
    && message?.attachments?.get?.(String(record.heroAttachment.id))
    ? record.heroAttachment
    : null;
  const payload = buildSteamWorkshopMessage(item, conf, {
    heroAsset,
    existingHeroAttachment: heroAsset ? storedAttachment : null,
    manageAttachments: true
  });
  let action = 'unchanged';
  if (!thread) {
    const appliedTags = resolveAppliedTags(forum, conf.appliedTagNames);
    const threadName = safeText(record?.threadNameOverride, item?.title || `Workshop ${id}`, 100).replace(/[\r\n]+/g, ' ').trim() || `Workshop ${id}`;
    thread = await forum.threads.create({
      name: threadName,
      autoArchiveDuration: forum.defaultAutoArchiveDuration || 10_080,
      appliedTags,
      message: payload,
      reason: `Steam-Workshop-Katalog ${id}`
    });
    message = await thread.fetchStarterMessage?.({ cache: true, force: true }).catch(() => null);
    action = 'created';
  } else if (!message || forceDesign || record?.fingerprint !== fingerprint) {
    if (thread.archived && !thread.locked) await thread.setArchived(false, 'Steam-Workshop-Embed aktualisieren').catch(() => {});
    const desiredThreadName = safeText(record?.threadNameOverride, payload.tokens.title || `Workshop ${id}`, 100).replace(/[\r\n]+/g, ' ').trim();
    if (String(thread.name || '') !== desiredThreadName) {
      await thread.setName(desiredThreadName, 'Steam-Workshop-Titel aktualisieren').catch(() => {});
    }
    message = message
      ? await message.edit(payload)
      : await thread.send(payload);
    action = 'updated';
  }
  await pinThreadIfConfigured(thread, conf);
  const messageHeroAttachment = heroAsset
    ? message?.attachments?.find?.((attachment) => String(attachment?.name || '') === String(heroAsset.name || '')) || null
    : null;
  return {
    action,
    changedOnSteam,
    record: {
      workshopId: id,
      title: safeText(item?.title, `Workshop ${id}`, 256),
      threadId: String(thread.id),
      messageId: String(message?.id || thread.id),
      steamUpdatedAt: Number(item?.time_updated || 0),
      fingerprint,
      previewUrl: safeUrl(item?.preview_url),
      workshopUrl: workshopUrlFor(id),
      ratingValue: Number.isFinite(Number(item?.ratingValue)) ? Number(item.ratingValue) : null,
      ratingCount: Math.max(0, Number(item?.ratingCount || 0)),
      heroAttachment: messageHeroAttachment ? {
        id: String(messageHeroAttachment.id || ''),
        url: safeUrl(messageHeroAttachment.url),
        name: String(messageHeroAttachment.name || heroAsset?.name || ''),
        size: Math.max(0, Number(messageHeroAttachment.size || heroAsset?.size || 0))
      } : null,
      heroAssetUpdatedAt: heroAsset ? String(heroAsset.updatedAt || '') : '',
      designOverride: record?.designOverride || null,
      assetMode: ['global', 'item', 'none'].includes(record?.assetMode) ? record.assetMode : 'global',
      itemBannerAsset: record?.itemBannerAsset || null,
      threadNameOverride: safeText(record?.threadNameOverride, '', 100).replace(/[\r\n]+/g, ' ').trim(),
      tokens: payload.tokens,
      lastSyncedAt: new Date().toISOString(),
      lastError: ''
    }
  };
};

const notifyUpdate = async ({ guild, item, conf, record }) => {
  if (!conf.notifyOnUpdate || !conf.updateChannelId) return false;
  const channel = guild.channels.cache.get(conf.updateChannelId);
  if (!channel?.isTextBased?.() || channel.isThread?.()) return false;
  const id = String(item?.publishedfileid || '');
  const mention = conf.mentionRoleId ? `<@&${conf.mentionRoleId}>` : '';
  const embed = new EmbedBuilder()
    .setColor(DEFAULT_COLOR)
    .setAuthor({ name: 'STEAM WORKSHOP · UPDATE' })
    .setTitle(safeText(item?.title, `Workshop ${id}`, 256))
    .setURL(workshopUrlFor(id))
    .setDescription('Ein Workshop-Item wurde auf Steam aktualisiert. Der dauerhafte Katalogeintrag wurde automatisch auf den neuesten Stand gebracht.')
    .addFields(
      { name: 'Aktualisiert', value: formatSteamTime(item?.time_updated), inline: true },
      { name: 'Katalog', value: record?.threadId ? `<#${record.threadId}>` : 'Workshop-Forum', inline: true }
    )
    .setTimestamp();
  const previewUrl = safeUrl(item?.preview_url);
  if (previewUrl) embed.setThumbnail(previewUrl);
  await channel.send({
    content: mention,
    embeds: [embed],
    allowedMentions: conf.mentionRoleId ? { roles: [conf.mentionRoleId], parse: [] } : { parse: [] }
  });
  return true;
};

export const syncSteamWorkshop = async ({ guild, conf: rawConf, source = 'manual', forceDesign = false } = {}) => {
  if (!guild?.id) throw new Error('Server wurde nicht gefunden.');
  const conf = normalizeSteamWorkshopConfig(rawConf);
  if (!conf.enabled && source !== 'design') throw new Error('Das Steam-Workshop-Modul ist deaktiviert.');
  if (!conf.forumChannelId) throw new Error('Wähle zuerst das Workshop-Forum aus.');
  if (!conf.workshopIds.length) throw new Error('Füge mindestens eine gültige Steam-Workshop-ID hinzu.');
  if (syncLocks.has(guild.id)) return syncLocks.get(guild.id);
  const operation = (async () => {
    const runtime = runtimeFor(guild.id);
    Object.assign(runtime, {
      running: true,
      phase: 'fetching',
      completed: 0,
      total: conf.workshopIds.length,
      created: 0,
      updated: 0,
      unchanged: 0,
      failed: 0,
      currentWorkshopId: '',
      lastStartedAt: new Date().toISOString(),
      lastError: ''
    });
    const forum = ensureForum(guild, conf);
    const data = await guildStore(guild.id);
    try {
      let items = await fetchSteamWorkshopItems(conf.workshopIds);
      if (conf.showRating) items = await enrichSteamRatings(items);
      const globalHeroAsset = await loadSteamWorkshopBannerAsset(guild.id);
      runtime.phase = 'publishing';
      for (const item of items) {
        const id = String(item?.publishedfileid || '');
        runtime.currentWorkshopId = id;
        try {
          const previous = data.items[id] || null;
          const itemConf = previous?.designOverride
            ? normalizeSteamWorkshopConfig({ ...conf, design: previous.designOverride })
            : conf;
          const assetMode = previous?.designOverride
            ? (['global', 'item', 'none'].includes(previous?.assetMode) ? previous.assetMode : 'none')
            : 'global';
          const heroAsset = assetMode === 'item'
            ? await loadSteamWorkshopItemBannerAsset(guild.id, id)
            : assetMode === 'global'
              ? globalHeroAsset
              : null;
          const result = await upsertWorkshopPost({ guild, forum, item, conf: itemConf, record: previous, heroAsset, forceDesign });
          data.items[id] = result.record;
          runtime[result.action] = Number(runtime[result.action] || 0) + 1;
          if (result.changedOnSteam) await notifyUpdate({ guild, item, conf, record: result.record });
        } catch (error) {
          runtime.failed += 1;
          data.items[id] = {
            ...(data.items[id] || { workshopId: id }),
            lastSyncedAt: new Date().toISOString(),
            lastError: String(error?.message || error).slice(0, 500)
          };
          recordDiagnosticError('steamWorkshop.itemSync', error, { guildId: guild.id, workshopId: id });
        } finally {
          runtime.completed += 1;
        }
      }
      const configured = new Set(conf.workshopIds);
      Object.keys(data.items).forEach((id) => {
        data.items[id].configured = configured.has(id);
      });
      data.lastSyncAt = new Date().toISOString();
      const historyEntry = {
        at: data.lastSyncAt,
        source,
        total: runtime.total,
        created: runtime.created,
        updated: runtime.updated,
        unchanged: runtime.unchanged,
        failed: runtime.failed
      };
      data.history = [historyEntry, ...(data.history || [])].slice(0, 30);
      runtime.history = data.history.slice(0, 10);
      runtime.lastCompletedAt = data.lastSyncAt;
      runtime.phase = runtime.failed ? 'attention' : 'complete';
      await saveStore();
      return { ...historyEntry, items: conf.workshopIds.map((id) => data.items[id]).filter(Boolean) };
    } catch (error) {
      runtime.phase = 'error';
      runtime.lastError = String(error?.message || error).slice(0, 500);
      recordDiagnosticError('steamWorkshop.sync', error, { guildId: guild.id, source });
      throw error;
    } finally {
      runtime.running = false;
      runtime.currentWorkshopId = '';
    }
  })();
  syncLocks.set(guild.id, operation);
  operation.finally(() => {
    if (syncLocks.get(guild.id) === operation) syncLocks.delete(guild.id);
  }).catch(() => {});
  return operation;
};

const stopSchedule = (guildId) => {
  const timer = schedules.get(String(guildId || ''));
  if (timer) clearTimeout(timer);
  schedules.delete(String(guildId || ''));
};

const scheduleNext = (guild, rawConf, immediate = false) => {
  const conf = normalizeSteamWorkshopConfig(rawConf);
  stopSchedule(guild?.id);
  const runtime = runtimeFor(guild?.id);
  if (!guild?.id || !conf.enabled || !conf.forumChannelId || !conf.workshopIds.length) {
    runtime.nextSyncAt = null;
    return;
  }
  const delay = immediate ? 3_000 : conf.syncIntervalMinutes * 60_000;
  runtime.nextSyncAt = new Date(Date.now() + delay).toISOString();
  const timer = setTimeout(async () => {
    schedules.delete(String(guild.id));
    try {
      await syncSteamWorkshop({ guild, conf, source: immediate ? 'startup' : 'interval' });
    } catch (error) {
      console.warn(`[steamWorkshop] Abgleich für ${guild.name} fehlgeschlagen: ${error?.message || error}`);
    } finally {
      scheduleNext(guild, conf, false);
    }
  }, delay);
  timer.unref?.();
  schedules.set(String(guild.id), timer);
};

export const getSteamWorkshopSnapshot = async (guildId) => {
  const data = await guildStore(guildId);
  const runtime = runtimeFor(guildId);
  const bannerAsset = data.bannerAsset && safeAssetPath(data.bannerAsset.diskName)
    ? {
        name: String(data.bannerAsset.name || data.bannerAsset.fileName || ''),
        size: Math.max(0, Number(data.bannerAsset.size || 0)),
        contentType: String(data.bannerAsset.contentType || '')
      }
    : null;
  return {
    ...runtime,
    bannerAsset,
    items: Object.values(data.items || {})
      .map((item) => ({ ...item, customized: Boolean(item.designOverride) }))
      .sort((left, right) => String(left.title || left.workshopId).localeCompare(String(right.title || right.workshopId), 'de')),
    history: (data.history || []).slice(0, 10),
    lastCompletedAt: runtime.lastCompletedAt || data.lastSyncAt || null
  };
};

export const applySteamWorkshopDesign = async ({ guild, conf: rawConf, design } = {}) => {
  const conf = normalizeSteamWorkshopConfig({ ...rawConf, design });
  if (conf.enabled && conf.forumChannelId && conf.workshopIds.length) {
    const sync = await syncSteamWorkshop({ guild, conf, source: 'design', forceDesign: true });
    return { design: conf.design, sync };
  }
  return { design: conf.design, sync: null };
};

const fetchSingleWorkshopItem = async (workshopId, showRating) => {
  let [item] = await fetchSteamWorkshopItems([workshopId]);
  if (showRating && Number(item?.result) === 1) [item] = await enrichSteamRatings([item]);
  return item;
};

export const applySteamWorkshopItemDesign = async ({ guild, conf: rawConf, workshopId, design, assetMode = 'none', threadName = '' } = {}) => {
  if (!guild?.id) throw new Error('Server wurde nicht gefunden.');
  const conf = normalizeSteamWorkshopConfig(rawConf);
  const id = String(workshopId || '').trim();
  if (!conf.workshopIds.includes(id)) throw new Error('Diese Workshop-ID gehört nicht mehr zum konfigurierten Katalog.');
  const forum = ensureForum(guild, conf);
  const data = await guildStore(guild.id);
  const previous = data.items[id] || { workshopId: id };
  const nextMode = ['global', 'item', 'none'].includes(assetMode) ? assetMode : 'none';
  const record = {
    ...previous,
    designOverride: normalizeDesign(design),
    assetMode: nextMode,
    threadNameOverride: safeText(threadName, '', 100).replace(/[\r\n]+/g, ' ').trim()
  };
  const item = await fetchSingleWorkshopItem(id, conf.showRating);
  const heroAsset = nextMode === 'item'
    ? await loadSteamWorkshopItemBannerAsset(guild.id, id)
    : nextMode === 'global'
      ? await loadSteamWorkshopBannerAsset(guild.id)
      : null;
  const itemConf = normalizeSteamWorkshopConfig({ ...conf, design: record.designOverride });
  const result = await upsertWorkshopPost({ guild, forum, item, conf: itemConf, record, heroAsset, forceDesign: true });
  data.items[id] = result.record;
  await saveStore();
  return { item: { ...result.record, customized: true }, action: result.action };
};

export const resetSteamWorkshopItemDesign = async ({ guild, conf: rawConf, workshopId } = {}) => {
  if (!guild?.id) throw new Error('Server wurde nicht gefunden.');
  const conf = normalizeSteamWorkshopConfig(rawConf);
  const id = String(workshopId || '').trim();
  if (!conf.workshopIds.includes(id)) throw new Error('Diese Workshop-ID gehört nicht mehr zum konfigurierten Katalog.');
  const forum = ensureForum(guild, conf);
  const data = await guildStore(guild.id);
  const previous = data.items[id] || { workshopId: id };
  await removeSteamWorkshopItemBannerAsset(guild.id, id);
  const record = {
    ...previous,
    designOverride: null,
    assetMode: 'global',
    itemBannerAsset: null,
    threadNameOverride: ''
  };
  const item = await fetchSingleWorkshopItem(id, conf.showRating);
  const heroAsset = await loadSteamWorkshopBannerAsset(guild.id);
  const result = await upsertWorkshopPost({ guild, forum, item, conf, record, heroAsset, forceDesign: true });
  data.items[id] = result.record;
  await saveStore();
  return { item: { ...result.record, customized: false }, action: result.action };
};

export const feature = {
  id: 'steamWorkshop',
  name: 'Steam Workshop',

  async onClientReady({ guild, cfg }) {
    const conf = normalizeSteamWorkshopConfig(cfg?.steamWorkshop);
    scheduleNext(guild, conf, conf.syncOnStartup);
  },

  async onConfigUpdate({ guild, cfg, patch }) {
    if (!patch || !Object.prototype.hasOwnProperty.call(patch, 'steamWorkshop')) return;
    scheduleNext(guild, cfg?.steamWorkshop, true);
  },

  async onChannelDelete({ channel, cfg, guild }) {
    const conf = normalizeSteamWorkshopConfig(cfg?.steamWorkshop);
    if (String(channel?.id || '') === conf.forumChannelId || String(channel?.id || '') === conf.updateChannelId) {
      scheduleNext(guild, { ...conf, enabled: false }, false);
    }
  }
};

export const _steamWorkshopInternals = {
  cleanSteamDescription,
  parseSteamCommunityRating,
  starRating,
  normalizeDesign,
  replaceTokens,
  itemTokens,
  resolveAppliedTags,
  itemFingerprint,
  formatBytes,
  visibilityLabel
};
