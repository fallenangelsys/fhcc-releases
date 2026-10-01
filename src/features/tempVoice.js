import path from 'node:path';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  OverwriteType,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder
} from 'discord.js';

import { atomicWriteJson, readJsonWithRecovery } from '../runtime/atomicJsonStore.js';
import { resolveOutsideImageFile } from '../runtime/persistentEmbedService.js';
import { resolveOutsideImagePayload } from '../runtime/localImageStore.js';
import { quietLog, QUIET_LOG_SCOPE } from '../runtime/quietLog.js';
import { DATA_DIR } from '../shared/paths.js';

const DATA_ROOT = DATA_DIR;
const STATE_FILE = path.join(DATA_ROOT, 'temp-voice.json');

const PREFIX = 'fh_tv:';
const REGIONS = [
  ['automatic', 'Automatisch'],
  ['europe', 'Europa'],
  ['us-west', 'US West'],
  ['us-east', 'US East'],
  ['us-central', 'US Central'],
  ['us-south', 'US South'],
  ['singapore', 'Singapur'],
  ['southafrica', 'Südafrika'],
  ['sydney', 'Sydney'],
  ['india', 'Indien'],
  ['japan', 'Japan'],
  ['brazil', 'Brasilien'],
  ['hongkong', 'Hongkong'],
  ['russia', 'Russland']
];

const clampNumber = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const uniqueIds = (value) => {
  const rows = Array.isArray(value) ? value : String(value || '').split(/[\r\n,]+/);
  return [...new Set(rows.map((entry) => String(entry || '').trim()).filter(Boolean))];
};

const TEMP_VOICE_PLACEHOLDERS = Object.freeze([
  'owner', 'ownerName', 'channelName', 'createdAt', 'userLimit',
  'region', 'accessState', 'memberCount', 'server'
]);

const defaultTempVoiceInterfaceDesign = () => ({
  content: '',
  outsideImageUrl: '',
  outsideImageAttachment: null,
  embed: {
    title: 'TempVoice · {channelName}',
    url: '',
    description: 'Willkommen {owner}. Du verwaltest diesen temporären Sprachkanal mit den Buttons unter dem Embed.',
    color: '#2b2d31',
    authorName: '{server}',
    authorIconUrl: '',
    thumbnailUrl: '',
    imageUrl: '',
    footerText: '{server}',
    footerIconUrl: '',
    timestamp: false,
    fields: [
      { name: 'Besitzer', value: '{owner}', inline: true },
      { name: 'Zugang', value: '{accessState}', inline: true },
      { name: 'Mitglieder', value: '{memberCount} / {userLimit}', inline: true },
      { name: 'Region', value: '{region}', inline: true },
      { name: 'Erstellt', value: '{createdAt}', inline: true }
    ]
  }
});

const trimText = (value, maxLength) => String(value ?? '').slice(0, maxLength);
const normalizeHttpUrl = (value, maxLength = 2048) => {
  const source = trimText(value, maxLength).trim();
  return !source || /^https?:\/\/[^\s]+$/i.test(source) ? source : '';
};
const normalizeInterfaceAttachment = (value) => value && typeof value === 'object' && !Array.isArray(value)
  ? {
      id: trimText(value.id, 128),
      url: normalizeHttpUrl(value.url),
      name: trimText(value.name || 'tempvoice.png', 120),
      size: Math.max(0, Number(value.size || 0)),
      ...(value.localAsset === true ? { localAsset: true, mime: trimText(value.mime, 80) } : {}),
      ...(value.anchored === true ? {
        anchored: true,
        channelId: trimText(value.channelId, 128),
        messageId: trimText(value.messageId, 128)
      } : {})
    }
  : null;

const normalizeTempVoiceInterfaceDesign = (value) => {
  const fallback = defaultTempVoiceInterfaceDesign();
  if (value === undefined) return structuredClone(fallback);
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const embedSource = source.embed && typeof source.embed === 'object' && !Array.isArray(source.embed)
    ? source.embed
    : (Array.isArray(source.embeds) && source.embeds.length === 1 ? source.embeds[0] : {});
  const colorSource = String(embedSource.color || fallback.embed.color).trim();
  const color = /^#[0-9a-f]{6}$/i.test(colorSource) ? colorSource.toLowerCase() : fallback.embed.color;
  const fields = (Array.isArray(embedSource.fields) ? embedSource.fields : fallback.embed.fields)
    .slice(0, 25)
    .map((field) => ({
      name: trimText(field?.name, 256),
      value: trimText(field?.value, 1024),
      inline: field?.inline === true
    }))
    .filter((field) => field.name && field.value);
  return {
    content: trimText(source.content, 2000),
    outsideImageUrl: String(source.outsideImageUrl || '').trim(),
    outsideImageAttachment: normalizeInterfaceAttachment(source.outsideImageAttachment),
    embed: {
      title: trimText(embedSource.title, 256),
      url: normalizeHttpUrl(embedSource.url),
      description: trimText(embedSource.description, 4096),
      color,
      authorName: trimText(embedSource.authorName, 256),
      authorIconUrl: normalizeHttpUrl(embedSource.authorIconUrl),
      thumbnailUrl: normalizeHttpUrl(embedSource.thumbnailUrl),
      imageUrl: normalizeHttpUrl(embedSource.imageUrl),
      footerText: trimText(embedSource.footerText, 2048),
      footerIconUrl: normalizeHttpUrl(embedSource.footerIconUrl),
      timestamp: embedSource.timestamp === true,
      fields
    }
  };
};

const interfaceEmbedCharacters = (embed = {}) => [
  embed.title,
  embed.description,
  embed.authorName,
  embed.footerText,
  ...(Array.isArray(embed.fields) ? embed.fields.flatMap((field) => [field?.name, field?.value]) : [])
].reduce((total, part) => total + String(part || '').length, 0);

const assertTempVoiceInterfaceTemplate = (template = {}) => {
  const embeds = Array.isArray(template?.embeds) ? template.embeds : [template?.embed || {}];
  if (embeds.length !== 1) throw new Error('Das TempVoice-Design muss genau ein Embed enthalten.');
  const source = embeds[0] || {};
  const urlFields = [source.url, source.authorIconUrl, source.thumbnailUrl, source.imageUrl, source.footerIconUrl];
  if (urlFields.some((url) => String(url || '').trim() && !/^https?:\/\/[^\s]+$/i.test(String(url).trim()))) {
    throw new Error('Embed-Links und Bildadressen müssen vollständige HTTP(S)-URLs sein.');
  }
  if ((Array.isArray(source.fields) ? source.fields : []).length > 25) throw new Error('Ein Discord-Embed erlaubt höchstens 25 Felder.');
  if (interfaceEmbedCharacters(source) > 6000) throw new Error('Das TempVoice-Embed darf insgesamt höchstens 6.000 Zeichen enthalten.');
  if (!String(template?.content || '').trim() && !String(source.title || '').trim() && !String(source.description || '').trim()
    && !String(source.authorName || '').trim() && !String(source.footerText || '').trim() && !(source.fields || []).length
    && !String(source.imageUrl || '').trim() && !String(source.thumbnailUrl || '').trim()) {
    throw new Error('Das TempVoice-Design benötigt mindestens einen sichtbaren Inhalt.');
  }
};



const normalizeTempVoiceConfig = (conf = {}) => ({
  enabled: conf?.enabled === true,
  creatorChannelIds: uniqueIds(conf?.creatorChannelIds),
  categoryId: String(conf?.categoryId || '').trim(),
  channelNameTemplate: String(conf?.channelNameTemplate || '🎧 {user}').slice(0, 100),
  rememberUserProfiles: conf?.rememberUserProfiles !== false,
  defaultUserLimit: Math.trunc(clampNumber(conf?.defaultUserLimit, 0, 0, 99)),
  // Einheit: kbps (max 384). Migration: ältere Configs speicherten bps (>= 8000,
  // Discords Minimal-Bitrate) und werden automatisch auf kbps umgerechnet.
  defaultBitrate: (() => {
    const raw = Number(conf?.defaultBitrate);
    const bps = Number.isFinite(raw) && raw >= 8000 ? Math.round(raw / 1000) : raw;
    return Math.trunc(clampNumber(bps, 0, 0, 384));
  })(),
  defaultRegion: String(conf?.defaultRegion || '').trim(),
  emptyGraceSeconds: Math.trunc(clampNumber(conf?.emptyGraceSeconds, 0, 0, 3600)),
  blacklistRoleIds: uniqueIds(conf?.blacklistRoleIds),
  requiredRoleIds: uniqueIds(conf?.requiredRoleIds),
  // Berechtigungen aus dem importierten Quell-Kanal (id, type, allow/deny als Bitfield-Strings).
  permissionOverwrites: (Array.isArray(conf?.permissionOverwrites) ? conf.permissionOverwrites : [])
    .filter((entry) => entry && entry.id)
    .map((entry) => ({
      id: String(entry.id),
      type: Number(entry.type) === 1 ? 1 : 0,
      allow: String(entry.allow ?? '0'),
      deny: String(entry.deny ?? '0')
    })),
  allowRename: conf?.allowRename !== false,
  allowLimit: conf?.allowLimit !== false,
  allowLock: conf?.allowLock !== false,
  allowRegion: conf?.allowRegion !== false,
  allowTransfer: conf?.allowTransfer !== false,
  interfaceDesign: normalizeTempVoiceInterfaceDesign(conf?.interfaceDesign || defaultTempVoiceInterfaceDesign())
});

const STATE_VERSION = 4;
const emptyState = () => ({ version: STATE_VERSION, channels: {}, profiles: {} });
const unsafeStateKeys = new Set(['__proto__', 'prototype', 'constructor']);
const isSafeStateKey = (value) => Boolean(String(value || '')) && !unsafeStateKeys.has(String(value));

const validRegions = new Set(REGIONS.map(([value]) => value));

const normalizeStoredProfile = (candidate) => {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const profile = {};
  if (Object.prototype.hasOwnProperty.call(candidate, 'customName')) {
    profile.customName = safeName(candidate.customName);
  }
  if (Object.prototype.hasOwnProperty.call(candidate, 'userLimit')) {
    profile.userLimit = Math.trunc(clampNumber(candidate.userLimit, 0, 0, 99));
  }
  if (Object.prototype.hasOwnProperty.call(candidate, 'rtcRegion')) {
    const region = String(candidate.rtcRegion || 'automatic').trim().toLowerCase();
    profile.rtcRegion = validRegions.has(region) ? region : 'automatic';
  }
  if (!Object.keys(profile).length) return null;
  const timestamp = new Date(candidate.updatedAt || Date.now());
  profile.updatedAt = Number.isNaN(timestamp.getTime()) ? new Date().toISOString() : timestamp.toISOString();
  return profile;
};

const normalizeTempVoiceState = (raw = {}) => {
  const channels = {};
  if (raw?.channels && typeof raw.channels === 'object' && !Array.isArray(raw.channels)) {
    for (const [channelId, entry] of Object.entries(raw.channels)) {
      if (isSafeStateKey(channelId) && entry && typeof entry === 'object' && !Array.isArray(entry)) {
        channels[channelId] = structuredClone(entry);
      }
    }
  }
  const profiles = {};
  for (const [guildId, guildProfiles] of Object.entries(raw?.profiles || {})) {
    if (!isSafeStateKey(guildId) || !guildProfiles || typeof guildProfiles !== 'object' || Array.isArray(guildProfiles)) continue;
    for (const [userId, candidate] of Object.entries(guildProfiles)) {
      if (!isSafeStateKey(userId)) continue;
      const profile = normalizeStoredProfile(candidate);
      if (profile) (profiles[String(guildId)] ||= {})[String(userId)] = profile;
    }
  }
  return { version: STATE_VERSION, channels, profiles };
};

let state = null;
let loadPromise = null;
let mutationQueue = Promise.resolve();
const guildConfigs = new Map();
const cleanupTimers = new Map();
const creationFlights = new Map();
const channelOperations = new Map();
const interfaceOperations = new Map();

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const ensureLoaded = async () => {
  if (state) return state;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const loaded = await readJsonWithRecovery(STATE_FILE, { fallback: emptyState() });
    // readJsonWithRecovery liefert { value, source, recovered, failures } – die
    // eigentlichen Daten stecken in .value. (Vor dem Fix wurden die Wrapper-
    // Felder direkt gespreadet: Nach jedem Neustart war die Kanal-Liste leer und
    // TempVoice-Kanäle wurden nicht mehr als solche erkannt.)
    const parsed = loaded && typeof loaded === 'object' && loaded.value && typeof loaded.value === 'object'
      ? loaded.value
      : (loaded && typeof loaded === 'object' ? loaded : {});
    // Wrapper-/Leak-Felder aus alten Dateien nicht in den State (und damit
    // nicht zurück in die Datei) übernehmen.
    const { value: _leakValue, source: _leakSource, recovered: _leakRecovered, failures: _leakFailures, ...clean } = parsed;
    state = normalizeTempVoiceState(clean);
    return state;
  })();
  return loadPromise;
};

const mutateState = (mutator) => {
  const operation = mutationQueue.catch(() => null).then(async () => {
    const current = await ensureLoaded();
    const next = structuredClone(current);
    const result = await mutator(next);
    await atomicWriteJson(STATE_FILE, next, { spacing: 2 });
    state = next;
    return result;
  });
  mutationQueue = operation;
  return operation;
};

const setChannelEntry = (channelId, entry) => mutateState((data) => {
  if (!isSafeStateKey(channelId)) throw new TypeError('Ungültige TempVoice-Kanal-ID.');
  if (entry) {
    data.channels[String(channelId)] = structuredClone(entry);
  } else {
    delete data.channels[String(channelId)];
  }
  return entry || null;
});

const mergeChannelEntry = (guildId, channelId, patch = {}) => mutateState((data) => {
  if (!isSafeStateKey(channelId)) throw new TypeError('Ungültige TempVoice-Kanal-ID.');
  const current = data.channels[String(channelId)] || null;
  if (!current || String(current.guildId || '') !== String(guildId || '')) return null;
  const updated = { ...structuredClone(current), ...structuredClone(patch) };
  data.channels[String(channelId)] = updated;
  return structuredClone(updated);
});

const getUserProfile = async (guildId, userId) => {
  if (!isSafeStateKey(guildId) || !isSafeStateKey(userId)) return null;
  const data = await ensureLoaded();
  const profile = data.profiles?.[String(guildId)]?.[String(userId)];
  return profile ? structuredClone(profile) : null;
};

const setUserProfile = (guildId, userId, patch = {}) => mutateState((data) => {
  if (!isSafeStateKey(guildId) || !isSafeStateKey(userId)) throw new TypeError('Ungültige TempVoice-Profil-ID.');
  const guildKey = String(guildId);
  const userKey = String(userId);
  const current = data.profiles?.[guildKey]?.[userKey] || {};
  const profile = normalizeStoredProfile({ ...current, ...patch, updatedAt: new Date().toISOString() });
  if (!profile) throw new TypeError('TempVoice-Profil enthält keine gültigen Einstellungen.');
  (data.profiles[guildKey] ||= {})[userKey] = profile;
  return structuredClone(profile);
});

const deleteUserProfile = (guildId, userId) => mutateState((data) => {
  if (!isSafeStateKey(guildId) || !isSafeStateKey(userId)) return false;
  const guildKey = String(guildId);
  const userKey = String(userId);
  const guildProfiles = data.profiles?.[guildKey];
  if (!guildProfiles || !Object.prototype.hasOwnProperty.call(guildProfiles, userKey)) return false;
  delete guildProfiles[userKey];
  if (!Object.keys(guildProfiles).length) delete data.profiles[guildKey];
  return true;
});

const clearGuildProfiles = (guildId) => mutateState((data) => {
  if (!isSafeStateKey(guildId)) return 0;
  const guildKey = String(guildId);
  const count = Object.keys(data.profiles?.[guildKey] || {}).length;
  delete data.profiles[guildKey];
  return count;
});

const channelKey = (guildId, channelId) => `${String(guildId || '')}:${String(channelId || '')}`;

const runChannelOperation = (guildId, channelId, task) => {
  const key = channelKey(guildId, channelId);
  const previous = channelOperations.get(key) || Promise.resolve();
  const operation = previous.catch(() => null).then(task);
  const tracked = operation.finally(() => {
    if (channelOperations.get(key) === tracked) channelOperations.delete(key);
  });
  channelOperations.set(key, tracked);
  return tracked;
};

const runOwnedChannelOperation = (channel, expectedOwnerId, task) => {
  const guildId = String(channel?.guild?.id || '');
  const channelId = String(channel?.id || '');
  const expected = String(expectedOwnerId || '');
  if (!guildId || !channelId || !expected) throw new TypeError('TempVoice-Kanal oder Besitzer fehlt.');
  return runChannelOperation(guildId, channelId, async () => {
    const current = await findOwnedChannel(guildId, channelId);
    if (!current) throw new Error('Der Kanal ist nicht mehr als TempVoice registriert.');
    if (String(current.ownerId || '') !== expected) throw new Error('Der Besitzer des Kanals hat sich geändert.');
    return task(current);
  });
};

const runCreationSingleFlight = (guildId, userId, task) => {
  const key = `${String(guildId)}:${String(userId)}`;
  if (creationFlights.has(key)) return creationFlights.get(key);
  const operation = Promise.resolve().then(task).finally(() => creationFlights.delete(key));
  creationFlights.set(key, operation);
  return operation;
};

const runInterfaceOperation = (guildId, channelId, task) => {
  const key = channelKey(guildId, channelId);
  const previous = interfaceOperations.get(key) || Promise.resolve();
  const operation = previous.catch(() => null).then(task);
  const tracked = operation.finally(() => {
    if (interfaceOperations.get(key) === tracked) interfaceOperations.delete(key);
  });
  interfaceOperations.set(key, tracked);
  return tracked;
};

const configFor = (guildId) => guildConfigs.get(String(guildId || '')) || normalizeTempVoiceConfig({});

const isBot = (member) => Boolean(member?.user?.bot || member?.user?.system);

// Zugangskontrolle: Blacklist-Rollen sperren den Beitritt komplett,
// Required-Rollen müssen mindestens einmal vorhanden sein.
const accessDeniedReason = (member, conf) => {
  if (!member || isBot(member)) return null;
  const roleIds = new Set(member.roles?.cache?.keys?.() || []);
  if (conf.blacklistRoleIds.some((roleId) => roleIds.has(String(roleId)))) {
    return 'Deine Rollen erlauben dir die Nutzung von TempVoice nicht.';
  }
  if (conf.requiredRoleIds.length && !conf.requiredRoleIds.some((roleId) => roleIds.has(String(roleId)))) {
    return 'Du benötigst eine der erforderlichen Rollen, um TempVoice zu nutzen.';
  }
  return null;
};

const channelNameFor = (conf, member) => {
  const template = conf.channelNameTemplate || '🎧 {user}';
  const displayName = String(member?.displayName || member?.user?.username || 'Kanal').slice(0, 32);
  const username = String(member?.user?.username || 'Kanal').slice(0, 32);
  return template
    .replaceAll('{user}', displayName)
    .replaceAll('{username}', username)
    .slice(0, 100);
};

const safeName = (value) => String(value || '')
  // Nur entfernen, was Discord in Kanalnamen wirklich verbietet (@, #, :) sowie
  // Steuerzeichen (Zeilenumbrüche etc.). Alles andere (&, %, !, ?, Klammern …)
  // ist in Discord-Kanalnamen erlaubt und bleibt erhalten.
  .replace(/[\u0000-\u001F\u007F]/g, '') // eslint-disable-line no-control-regex
  .replace(/[@#:]/g, '')
  .trim()
  .slice(0, 100) || 'Kanal';

const resolveChannelSettings = (conf, member, profile = null) => ({
  name: safeName(profile?.customName || channelNameFor(conf, member)),
  userLimit: Number.isInteger(profile?.userLimit) ? profile.userLimit : conf.defaultUserLimit,
  rtcRegion: String(profile?.rtcRegion || conf.defaultRegion || 'automatic')
});

// Beste von Discord erlaubte Sprachkanal-Bitrate (kbps). Discord-Maximum:
// 384 kbps (Boost-Level 3). Kleinere Server: 64 kbps Standard.
const bestVoiceBitrate = (guild) => {
  const premium = Number(guild?.premiumTier || 0);
  if (premium >= 3) return 384_000;
  if (premium === 2) return 256_000;
  if (premium === 1) return 128_000;
  return 96_000;
};

const interfaceRowCount = () => 4;

// Icon-Buttons: nur das passende Emoji als Label (ohne Text), damit mehrere
// Buttons pro Reihe kompakt und aufgeräumt wirken. Die Funktionen stehen als
// Text im Embed darunter – wie Discord-Interfaces es professionell machen.
const iconButton = (customId, emoji, style = ButtonStyle.Secondary) => (
  new ButtonBuilder().setCustomId(customId).setEmoji(emoji).setLabel(' ').setStyle(style)
);

const interfaceRows = (conf, entry = {}) => {
  // Flache Liste aller aktiven Buttons in fester Reihenfolge, dann in 5er-
  // Reihen aufteilen (Discord erlaubt maximal 5 Komponenten pro Action Row).
  // Bei vollem Feature-Set ergeben sich genau 2 Reihen à 5 Buttons.
  const buttons = [];
  if (conf.allowRename) buttons.push(iconButton(`${PREFIX}rename`, '✏️'));
  if (conf.allowLimit) buttons.push(iconButton(`${PREFIX}limit`, '🔢'));
  if (conf.allowRegion) buttons.push(iconButton(`${PREFIX}region`, '🌍'));
  if (conf.allowLock) buttons.push(iconButton(`${PREFIX}lock`, '🔒', ButtonStyle.Secondary));
  buttons.push(iconButton(`${PREFIX}access`, '🚪', ButtonStyle.Secondary));
  buttons.push(iconButton(`${PREFIX}claim`, '👑', ButtonStyle.Primary));
  if (conf.allowTransfer) buttons.push(iconButton(`${PREFIX}transfer`, '🔁', ButtonStyle.Primary));
  buttons.push(iconButton(`${PREFIX}delete`, '🗑️', ButtonStyle.Danger));
  if (conf.rememberUserProfiles) buttons.push(iconButton(`${PREFIX}profile-reset`, '↩️'));

  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  }
  return rows;
};

// Alle Funktionen als Text unten im Embed – die Buttons darüber tragen nur Icons.
const interfaceFeaturesText = (conf) => {
  const lines = [];
  if (conf.allowRename) lines.push('✏️ **Name** – Kanalnamen ändern');
  if (conf.allowLimit) lines.push('🔢 **Limit** – Mitgliederzahl begrenzen');
  if (conf.allowLock) lines.push('🔒 **Sperren / Öffnen** – Kanal für andere schließen oder wieder freigeben');
  lines.push('🚪 **Zugang** – Personen erlauben, sperren oder Rechte zurücksetzen');
  lines.push('👑 **Übernehmen** – Besitz des Kanals übernehmen');
  if (conf.allowTransfer) lines.push('🔁 **Übertragen** – Besitz an jemand anderen abgeben');
  if (conf.allowRegion) lines.push('🌍 **Region** – Server-Region des Kanals wählen');
  lines.push('🗑️ **Löschen** – Kanal schließen und entfernen');
  if (conf.rememberUserProfiles) lines.push('↩️ **Profil zurücksetzen** – Name, Limit und Region auf die Modulwerte setzen');
  return lines.join('\n');
};

const regionLabel = (value) => REGIONS.find(([region]) => region === String(value || 'automatic'))?.[1] || String(value || 'automatic');

const isChannelLocked = (channel) => Boolean(
  channel?.permissionOverwrites?.cache?.get?.(String(channel?.guild?.id))?.deny?.has?.(PermissionFlagsBits.Connect)
);

const formatTempVoiceInterfaceText = (value, context = {}, maxLength = 4096, mode = 'rich') => {
  const values = context?.[mode] && typeof context[mode] === 'object' ? context[mode] : context;
  let result = String(value ?? '');
  for (const key of TEMP_VOICE_PLACEHOLDERS) {
    if (Object.prototype.hasOwnProperty.call(values || {}, key)) {
      result = result.replaceAll(`{${key}}`, String(values[key] ?? ''));
    }
  }
  return result.slice(0, Math.max(0, Number(maxLength) || 0));
};

const tempVoicePlaceholderContext = (voiceChannel, entry) => {
  const guild = voiceChannel?.guild;
  const member = guild?.members?.cache?.get?.(String(entry?.ownerId || ''));
  const ownerName = String(member?.displayName || member?.user?.username || entry?.ownerName || 'Unbekannt');
  const createdDate = new Date(entry?.createdAt || Date.now());
  const validCreatedDate = Number.isNaN(createdDate.getTime()) ? new Date() : createdDate;
  const createdEpoch = Math.floor(validCreatedDate.getTime() / 1000);
  const shared = {
    ownerName,
    channelName: String(voiceChannel?.name || 'Kanal'),
    userLimit: voiceChannel?.userLimit ? String(voiceChannel.userLimit) : 'Unbegrenzt',
    region: regionLabel(voiceChannel?.rtcRegion || 'automatic'),
    accessState: isChannelLocked(voiceChannel) ? 'Gesperrt' : 'Offen',
    memberCount: String(Number(voiceChannel?.members?.size || 0)),
    server: String(guild?.name || 'Server')
  };
  return {
    rich: {
      ...shared,
      owner: member && entry?.ownerId ? `<@${entry.ownerId}>` : ownerName,
      createdAt: `<t:${createdEpoch}:R>`
    },
    plain: {
      ...shared,
      owner: ownerName,
      createdAt: validCreatedDate.toLocaleString('de-DE')
    }
  };
};

const interfaceEmbed = (entry, guild, conf = {}, channel = null) => {
  const voiceChannel = channel || { guild, name: 'Kanal', members: { size: 0 }, userLimit: 0, rtcRegion: null };
  const design = normalizeTempVoiceConfig(conf).interfaceDesign;
  const source = design.embed;
  const context = tempVoicePlaceholderContext(voiceChannel, entry);
  const rich = (value, maxLength) => formatTempVoiceInterfaceText(value, context, maxLength, 'rich');
  const plain = (value, maxLength) => formatTempVoiceInterfaceText(value, context, maxLength, 'plain');
  const embed = new EmbedBuilder().setColor(Number.parseInt(source.color.slice(1), 16));
  const title = plain(source.title, 256);
  const description = rich(source.description, 4096);
  const authorName = plain(source.authorName, 256);
  const footerText = plain(source.footerText, 2048);
  if (title) embed.setTitle(title);
  if (source.url) embed.setURL(source.url);
  if (description) embed.setDescription(description);
  if (authorName) embed.setAuthor({ name: authorName, ...(source.authorIconUrl ? { iconURL: source.authorIconUrl } : {}) });
  if (source.thumbnailUrl) embed.setThumbnail(source.thumbnailUrl);
  if (source.imageUrl) embed.setImage(source.imageUrl);
  if (footerText) embed.setFooter({ text: footerText, ...(source.footerIconUrl ? { iconURL: source.footerIconUrl } : {}) });
  if (source.timestamp) embed.setTimestamp();
  const fields = source.fields.map((field) => ({
    name: plain(field.name, 256),
    value: rich(field.value, 1024),
    inline: field.inline === true
  })).filter((field) => field.name && field.value);
  if (fields.length) embed.addFields(fields);
  if (interfaceEmbedCharacters(embed.data) > 6000) {
    throw new Error('Das gerenderte TempVoice-Embed darf insgesamt höchstens 6.000 Zeichen enthalten.');
  }
  return embed;
};

const resolveTempVoiceOutsideImage = async (design) => {
  try {
    const resolved = await resolveOutsideImageFile({ template: design, defaultImageName: 'tempvoice.png' });
    if (resolved.outsideFile) {
      return { files: [{ attachment: resolved.outsideFile, name: resolved.outsideImageName }], attachments: [] };
    }
    const materialized = await resolveOutsideImagePayload({
      outsideImageUrl: design.outsideImageUrl,
      outsideImageAttachment: design.outsideImageAttachment,
      allowAttachmentReference: false
    });
    return { files: materialized.files || null, attachments: materialized.attachments || [] };
  } catch (error) {
    quietLog(QUIET_LOG_SCOPE.tempVoice, error, 'TempVoice-Außenbild konnte nicht materialisiert werden');
    return { files: null, attachments: [] };
  }
};

const buildTempVoiceInterfacePayload = async (voiceChannel, entry, conf = {}) => {
  const normalizedConf = normalizeTempVoiceConfig(conf);
  const design = normalizedConf.interfaceDesign;
  const context = tempVoicePlaceholderContext(voiceChannel, entry);
  const outside = await resolveTempVoiceOutsideImage(design);
  const payload = {
    embeds: [interfaceEmbed(entry, voiceChannel?.guild, normalizedConf, voiceChannel)],
    components: interfaceRows(normalizedConf, entry),
    allowedMentions: {
      parse: [],
      users: entry?.ownerId ? [String(entry.ownerId)] : []
    },
    attachments: outside.attachments || []
  };
  const content = formatTempVoiceInterfaceText(design.content, context, 2000, 'rich');
  if (content) payload.content = content;
  if (outside.files?.length) payload.files = outside.files;
  return payload;
};

const findOwnedChannel = async (guildId, channelId) => {
  const data = await ensureLoaded();
  const entry = data.channels[String(channelId || '')];
  return entry && String(entry.guildId || '') === String(guildId || '') ? structuredClone(entry) : null;
};

const permissionTriState = (overwrite, permission) => {
  if (overwrite?.deny?.has?.(permission)) return false;
  if (overwrite?.allow?.has?.(permission)) return true;
  return null;
};

const memberPermissionBaseline = (channel, userId) => {
  const overwrite = channel?.permissionOverwrites?.cache?.get?.(String(userId || '')) || null;
  return {
    viewChannel: permissionTriState(overwrite, PermissionFlagsBits.ViewChannel),
    connect: permissionTriState(overwrite, PermissionFlagsBits.Connect)
  };
};

const isUnknownChannelError = (error) => Number(error?.code ?? error?.rawError?.code) === 10003;

const deleteTrackedChannel = async (channel, reason, { requireEmpty = false, expectedOwnerId = '' } = {}) => {
  const guildId = String(channel?.guild?.id || '');
  const channelId = String(channel?.id || '');
  if (!guildId || !channelId || typeof channel?.delete !== 'function') {
    return { deleted: false, error: 'Ungültiger TempVoice-Kanal.' };
  }
  return runChannelOperation(guildId, channelId, async () => {
    const current = await findOwnedChannel(guildId, channelId);
    if (expectedOwnerId && String(current?.ownerId || '') !== String(expectedOwnerId)) {
      return { deleted: false, error: 'Der Besitzer des Kanals hat sich geändert.' };
    }
    // Diese Prüfung liegt absichtlich direkt vor Discords delete()-Aufruf.
    if (requireEmpty && Number(channel?.members?.size || 0) > 0) {
      return { deleted: false, cancelled: true };
    }
    try {
      await channel.delete(reason);
    } catch (error) {
      if (!isUnknownChannelError(error)) {
        return { deleted: false, error: String(error?.message || error) };
      }
    }
    try {
      await setChannelEntry(channelId, null);
    } catch (error) {
      return { deleted: true, error: `Kanal gelöscht, State konnte nicht bereinigt werden: ${String(error?.message || error)}` };
    }
    cancelCleanup(guildId, channelId);
    return { deleted: true };
  });
};

const transferOwnership = async ({ channel, entry, nextOwner, expectedOwnerId, validateCurrent } = {}) => {
  const guildId = String(channel?.guild?.id || '');
  const channelId = String(channel?.id || '');
  const nextOwnerId = String(nextOwner?.id || '');
  const expected = String(expectedOwnerId || entry?.ownerId || '');
  if (!guildId || !channelId || !nextOwnerId || !expected) throw new TypeError('Besitzübertragung ist unvollständig.');
  return runChannelOperation(guildId, channelId, async () => {
    const current = await findOwnedChannel(guildId, channelId);
    if (!current) throw new Error('Der Kanal ist nicht mehr als TempVoice registriert.');
    if (String(current.ownerId || '') !== expected) throw new Error('Der Besitzer des Kanals hat sich geändert.');
    if (typeof validateCurrent === 'function') await validateCurrent(current);
    if (nextOwnerId === expected) return current;

    const oldOwnerId = String(current.ownerId);
    const oldBaseline = current.ownerBaseline && typeof current.ownerBaseline === 'object'
      ? structuredClone(current.ownerBaseline)
      : { viewChannel: null, connect: null };
    const nextBaseline = current.accessBaselines?.[nextOwnerId]
      ? structuredClone(current.accessBaselines[nextOwnerId])
      : memberPermissionBaseline(channel, nextOwnerId);
    let nextAuthorized = false;
    let oldRestored = false;
    try {
      await channel.permissionOverwrites.edit(nextOwnerId, {
        ViewChannel: true,
        Connect: true
      }, { type: OverwriteType.Member });
      nextAuthorized = true;
      await channel.permissionOverwrites.edit(oldOwnerId, {
        ViewChannel: oldBaseline.viewChannel ?? null,
        Connect: oldBaseline.connect ?? null
      }, { type: OverwriteType.Member });
      oldRestored = true;
      const updated = {
        ...current,
        ownerId: nextOwnerId,
        ownerName: String(nextOwner.displayName || nextOwner.user?.username || 'Unbekannt'),
        ownerBaseline: {
          viewChannel: nextBaseline.viewChannel ?? null,
          connect: nextBaseline.connect ?? null
        }
      };
      await setChannelEntry(channelId, updated);
      await refreshInterface(channel, configFor(guildId)).catch((error) => {
        quietLog(QUIET_LOG_SCOPE.tempVoice, error, `Ownership: Interface-Refresh fehlgeschlagen: Kanal ${channelId}`);
      });
      return updated;
    } catch (error) {
      // Solange der State noch auf den alten Owner zeigt, stellen wir die
      // Discord-Rechte bestmöglich auf den Zustand vor dem Versuch zurück.
      if (oldRestored) {
        await channel.permissionOverwrites.edit(oldOwnerId, {
          ViewChannel: true,
          Connect: true
        }, { type: OverwriteType.Member }).catch(() => null);
      }
      if (nextAuthorized) {
        await channel.permissionOverwrites.edit(nextOwnerId, {
          ViewChannel: nextBaseline.viewChannel ?? null,
          Connect: nextBaseline.connect ?? null
        }, { type: OverwriteType.Member }).catch(() => null);
      }
      throw error;
    }
  });
};

const captureAccessBaselineUnlocked = async (channel, entry, userId) => {
  const targetId = String(userId || '');
  if (!targetId) throw new TypeError('Mitglied fehlt.');
  if (Object.prototype.hasOwnProperty.call(entry?.accessBaselines || {}, targetId)) return structuredClone(entry);
  const overwrite = channel?.permissionOverwrites?.cache?.get?.(targetId) || null;
  const updated = {
    ...structuredClone(entry || {}),
    accessBaselines: {
      ...(structuredClone(entry?.accessBaselines || {})),
      [targetId]: {
        viewChannel: permissionTriState(overwrite, PermissionFlagsBits.ViewChannel),
        connect: permissionTriState(overwrite, PermissionFlagsBits.Connect)
      }
    }
  };
  await setChannelEntry(channel.id, updated);
  return updated;
};

const captureAccessBaseline = async (channel, entry, userId) => runOwnedChannelOperation(
  channel,
  entry?.ownerId,
  (current) => captureAccessBaselineUnlocked(channel, current, userId)
);

const accessMessages = {
  allow: (userId) => `<@${userId}> darf den Kanal jetzt sehen und betreten.`,
  revoke: (userId) => `Die ausdrueckliche Freigabe fuer <@${userId}> wurde auf die vorherigen Rechte zurueckgesetzt.`,
  block: (userId) => `<@${userId}> wurde aus deinem Kanal ausgeschlossen.`,
  unblock: (userId, locked) => locked
    ? `Die Sperre fuer <@${userId}> wurde zurueckgesetzt. Der Kanal bleibt allgemein gesperrt.`
    : `Die Sperre fuer <@${userId}> wurde auf die vorherigen Rechte zurueckgesetzt.`
};

const applyAccessMode = async ({ channel, entry, userId, mode }) => {
  if (!['allow', 'revoke', 'block', 'unblock'].includes(mode)) throw new TypeError('Unbekannter Zugriffsmodus.');
  return runOwnedChannelOperation(channel, entry?.ownerId, async (current) => {
    const captured = await captureAccessBaselineUnlocked(channel, current, userId);
    const baseline = captured.accessBaselines[String(userId)];
    const data = mode === 'allow'
      ? { ViewChannel: true, Connect: true }
      : mode === 'block'
        ? { Connect: false }
        : { ViewChannel: baseline.viewChannel, Connect: baseline.connect };
    await channel.permissionOverwrites.edit(String(userId), data, { type: OverwriteType.Member });
    if (mode === 'block') {
      await channel.members?.get?.(String(userId))?.voice?.disconnect?.().catch((error) => {
        quietLog(QUIET_LOG_SCOPE.tempVoice, error, `Block: Disconnect fehlgeschlagen: User ${userId}`);
      });
    }
    return {
      entry: captured,
      message: accessMessages[mode](String(userId), isChannelLocked(channel))
    };
  });
};

const captureLockBaselineUnlocked = async (channel, entry) => {
  if (Object.prototype.hasOwnProperty.call(entry?.lockBaseline || {}, 'connect')) return structuredClone(entry);
  const overwrite = channel?.permissionOverwrites?.cache?.get?.(String(channel?.guild?.id || '')) || null;
  const updated = {
    ...structuredClone(entry || {}),
    lockBaseline: { connect: permissionTriState(overwrite, PermissionFlagsBits.Connect) }
  };
  await setChannelEntry(channel.id, updated);
  return updated;
};

const captureLockBaseline = async (channel, entry) => runOwnedChannelOperation(
  channel,
  entry?.ownerId,
  (current) => captureLockBaselineUnlocked(channel, current)
);

const applyLockMode = async ({ channel, entry, locked }) => {
  return runOwnedChannelOperation(channel, entry?.ownerId, async (current) => {
    const captured = await captureLockBaselineUnlocked(channel, current);
    const nextLocked = locked === undefined ? captured.locked !== true : Boolean(locked);
    if (nextLocked && captured.ownerId) {
      await channel.permissionOverwrites.edit(String(captured.ownerId), {
        ViewChannel: true,
        Connect: true
      }, { type: OverwriteType.Member });
    }
    await channel.permissionOverwrites.edit(String(channel.guild.id), {
      Connect: nextLocked ? false : captured.lockBaseline.connect
    }, { type: OverwriteType.Role });
    const updated = { ...captured, locked: nextLocked };
    await setChannelEntry(channel.id, updated);
    return { entry: updated, locked: nextLocked };
  });
};

const missingPermissions = (channel) => {
  const me = channel?.guild?.members?.me;
  const permissions = me && channel?.permissionsFor?.(me);
  const required = [
    [PermissionFlagsBits.ViewChannel, 'Kanal ansehen'],
    [PermissionFlagsBits.Connect, 'Verbinden'],
    [PermissionFlagsBits.ManageChannels, 'Kanäle verwalten'],
    [PermissionFlagsBits.MoveMembers, 'Mitglieder verschieben']
  ];
  if (!permissions) return required.map((entry) => entry[1]);
  return required.filter(([permission]) => !permissions.has(permission, false)).map((entry) => entry[1]);
};

// Baut die Permission-Overwrites für neue TempVoice-Kanäle:
// Basis sind die Berechtigungen der Ziel-Kategorie – der neue Kanal erbt damit die
// Einstellungen der Kategorie (z. B. bleibt eine private Kategorie privat). Ohne
// Kategorie gilt der Standard (alle dürfen sehen und joinen). Zusätzlich wird immer
// sichergestellt, dass der Bot verwalten darf und der Besitzer joinen kann.
const buildChannelOverwrites = ({ guild, me, member, category }) => {
  const entries = new Map();
  const categoryOverwrites = category?.permissionOverwrites?.cache?.values
    ? [...category.permissionOverwrites.cache.values()]
    : [];
  if (categoryOverwrites.length) {
    for (const overwrite of categoryOverwrites) {
      const id = String(overwrite.id || '');
      if (!id) continue;
      entries.set(id, {
        id,
        type: Number(overwrite.type) === 1 ? 1 : 0,
        allow: BigInt(String(overwrite.allow?.bitfield?.toString?.() ?? overwrite.allow ?? '0')),
        deny: BigInt(String(overwrite.deny?.bitfield?.toString?.() ?? overwrite.deny ?? '0'))
      });
    }
  } else {
    // Keine Kategorie: Standard – alle dürfen sehen und joinen.
    entries.set(String(guild.id), {
      id: String(guild.id),
      type: 0,
      allow: BigInt(PermissionFlagsBits.ViewChannel) | BigInt(PermissionFlagsBits.Connect),
      deny: 0n
    });
  }
  // Bot darf immer sehen, joinen und verwalten.
  if (me?.id) {
    const existing = entries.get(String(me.id));
    entries.set(String(me.id), {
      id: String(me.id),
      type: 1,
      allow: (existing ? BigInt(existing.allow) : 0n) | BigInt(PermissionFlagsBits.ViewChannel) | BigInt(PermissionFlagsBits.Connect) | BigInt(PermissionFlagsBits.ManageChannels),
      deny: existing ? BigInt(existing.deny) & ~(BigInt(PermissionFlagsBits.ViewChannel) | BigInt(PermissionFlagsBits.Connect)) : 0n
    });
  }
  // Besitzer darf immer in seinen eigenen Kanal.
  if (member?.id) {
    const existing = entries.get(String(member.id));
    entries.set(String(member.id), {
      id: String(member.id),
      type: 1,
      allow: (existing ? BigInt(existing.allow) : 0n) | BigInt(PermissionFlagsBits.ViewChannel) | BigInt(PermissionFlagsBits.Connect),
      deny: existing ? BigInt(existing.deny) & ~(BigInt(PermissionFlagsBits.ViewChannel) | BigInt(PermissionFlagsBits.Connect)) : 0n
    });
  }
  return [...entries.values()];
};

const baselineFromOverwritePayload = (overwrites, userId) => {
  const overwrite = (overwrites || []).find((candidate) => String(candidate?.id || '') === String(userId || ''));
  const triState = (permission) => {
    if (!overwrite) return null;
    const deny = BigInt(overwrite.deny || 0n);
    const allow = BigInt(overwrite.allow || 0n);
    if ((deny & BigInt(permission)) === BigInt(permission)) return false;
    if ((allow & BigInt(permission)) === BigInt(permission)) return true;
    return null;
  };
  return {
    viewChannel: triState(PermissionFlagsBits.ViewChannel),
    connect: triState(PermissionFlagsBits.Connect)
  };
};

const createTempChannel = async ({ guild, member, conf }) => {
  const profile = conf.rememberUserProfiles ? await getUserProfile(guild.id, member.id) : null;
  const settings = resolveChannelSettings(conf, member, profile);
  const me = guild?.members?.me;
  const categoryChannel = conf.categoryId
    ? guild?.channels?.cache?.get(String(conf.categoryId)) || null
    : null;
  const category = categoryChannel && Number(categoryChannel.type) === ChannelType.GuildCategory
    ? categoryChannel
    : null;
  const inheritedOverwrites = buildChannelOverwrites({ guild, me, member: null, category });
  const overwrites = buildChannelOverwrites({ guild, me, member, category });

  const channel = await guild.channels.create({
    name: settings.name,
    type: ChannelType.GuildVoice,
    parent: conf.categoryId || undefined,
    // defaultBitrate wird in kbps gespeichert; Discord erwartet bps.
    bitrate: conf.defaultBitrate > 0 ? conf.defaultBitrate * 1000 : bestVoiceBitrate(guild),
    rtcRegion: settings.rtcRegion === 'automatic' ? null : settings.rtcRegion,
    userLimit: settings.userLimit,
    permissionOverwrites: overwrites,
    reason: `TempVoice-Kanal für ${member.user?.tag || member.displayName}`
  });

  const entry = {
    guildId: String(guild.id),
    ownerId: String(member.id),
    ownerName: String(member.displayName || member.user?.username || 'Unbekannt'),
    ownerBaseline: baselineFromOverwritePayload(inheritedOverwrites, member.id),
    createdAt: new Date().toISOString(),
    interfaceMessageId: '',
    interfaceChannelId: ''
  };

  try {
    await setChannelEntry(channel.id, entry);
  } catch (error) {
    const cleanup = await deleteTrackedChannel(channel, 'TempVoice-State konnte nicht gespeichert werden');
    if (!cleanup.deleted) {
      // Falls Discord die Löschung verweigert, versuchen wir wenigstens, den
      // real existierenden Kanal nachträglich wieder unter Verwaltung zu nehmen.
      await setChannelEntry(channel.id, { ...entry, creationFailed: true }).catch((trackingError) => {
        quietLog(QUIET_LOG_SCOPE.tempVoice, trackingError, `Create: ungetrackten Kanal ${channel.id} nicht wiederherstellbar`);
      });
    }
    throw new Error(error?.message || 'TempVoice-Anfrage fehlgeschlagen.', { cause: error });
  }

  try {
    await member.voice.setChannel(channel.id);
  } catch (error) {
    const cleanup = await deleteTrackedChannel(channel, 'TempVoice-Erstellung abgebrochen: Verschieben fehlgeschlagen');
    if (!cleanup.deleted) quietLog(QUIET_LOG_SCOPE.tempVoice, new Error(cleanup.error || 'unbekannt'), `Create: Kanal ${channel.id} nach Move-Fehler nicht löschbar`);
    await member.send('Dein TempVoice-Kanal konnte nicht vollständig erstellt werden, weil du nicht verschoben werden konntest. Bitte versuche es erneut.').catch(() => null);
    throw error;
  }

  // Interface im Hintergrund senden – nicht auf dem kritischen Pfad.
  void sendInterface(channel, conf).catch((error) => {
    console.warn(`[tempVoice] Interface für ${channel.name} fehlgeschlagen: ${error?.message || error}`);
  });

  return channel;
};

// Das Interface wird IMMER in den Textchat des eigenen Voice-Kanals gesendet.
const interfaceTargetChannel = async (voiceChannel) => voiceChannel;

const isOwnedTempVoiceInterface = (message, botUserId) => {
  if (!message || String(message.author?.id || '') !== String(botUserId || '')) return false;
  return (Array.isArray(message.components) ? message.components : []).some((row) =>
    (Array.isArray(row?.components) ? row.components : []).some((component) =>
      String(component?.customId || component?.data?.custom_id || '').startsWith(PREFIX)
    )
  );
};

const reconcileDuplicateInterfacesUnlocked = async (voiceChannel, target, entry) => {
  if (entry?.interfaceReconciledAt || !entry?.interfaceMessageId || !target?.messages?.fetch) return 0;
  const botUserId = String(target?.guild?.members?.me?.id || target?.client?.user?.id || '');
  if (!botUserId) return 0;
  const recent = await target.messages.fetch({ limit: 50 }).catch((error) => {
    quietLog(QUIET_LOG_SCOPE.tempVoice, error, `Interface-Deduplizierung: Verlauf nicht ladbar: Kanal ${voiceChannel?.id}`);
    return null;
  });
  const messages = Array.isArray(recent)
    ? recent
    : (recent && typeof recent.values === 'function' ? [...recent.values()] : []);
  if (!recent || !messages.length) return 0;
  const duplicates = messages.filter((message) =>
    String(message?.id || '') !== String(entry.interfaceMessageId)
    && isOwnedTempVoiceInterface(message, botUserId)
  );
  let removed = 0;
  let failed = 0;
  for (const duplicate of duplicates) {
    try {
      await duplicate.delete();
      removed += 1;
    } catch (error) {
      failed += 1;
      quietLog(QUIET_LOG_SCOPE.tempVoice, error, `Interface-Deduplizierung: Nachricht ${duplicate?.id || 'unbekannt'} nicht loeschbar`);
    }
  }
  if (!failed) {
    await mergeChannelEntry(voiceChannel.guild.id, voiceChannel.id, {
      interfaceReconciledAt: new Date().toISOString()
    });
  }
  return removed;
};

const sendInterfaceUnlocked = async (voiceChannel, conf) => {
  const entry = await findOwnedChannel(voiceChannel?.guild?.id, voiceChannel?.id);
  if (!entry) return null;
  const target = await interfaceTargetChannel(voiceChannel);
  if (!target?.isTextBased?.()) return null;
  const payload = await buildTempVoiceInterfacePayload(voiceChannel, entry, conf);
  let messageId = '';
  let channelId = String(target.id);
  if (entry.interfaceMessageId && entry.interfaceChannelId === String(target.id)) {
    // Nach Neustart liegt die Interface-Nachricht oft nicht im Cache – erst
    // versuchen, sie von Discord zu holen, statt ein Duplikat zu senden.
    let existing = target.messages?.cache?.get(entry.interfaceMessageId);
    if (!existing && target.messages?.fetch) {        existing = await target.messages.fetch(entry.interfaceMessageId).catch((error) => {
        quietLog(QUIET_LOG_SCOPE.tempVoice, error, `sendInterface: messages.fetch fehlgeschlagen: Kanal ${channelId}`);
        return null;
      });
    }
    if (existing) {
      await existing.edit(payload);
      await reconcileDuplicateInterfacesUnlocked(voiceChannel, target, entry);
      return entry;
    }
  }
  const message = await target.send(payload);
  messageId = String(message.id);
  return mergeChannelEntry(voiceChannel.guild.id, voiceChannel.id, {
    interfaceMessageId: messageId,
    interfaceChannelId: channelId,
    interfaceReconciledAt: new Date().toISOString()
  });
};

// createTempChannel sendet das Interface im Hintergrund. Das dadurch
// ausgeloeste voiceStateUpdate kann gleichzeitig refreshInterface starten.
// Beide Pfade muessen denselben Upsert pro Kanal teilen, sonst lesen beide die
// noch leere Message-ID und senden jeweils eine eigene Nachricht.
const sendInterface = (voiceChannel, conf) => runInterfaceOperation(
  voiceChannel?.guild?.id,
  voiceChannel?.id,
  () => sendInterfaceUnlocked(voiceChannel, conf)
);

const refreshInterface = async (voiceChannel, conf) => {
  const entry = await findOwnedChannel(voiceChannel?.guild?.id, voiceChannel?.id);
  if (!entry) return null;
  const target = await interfaceTargetChannel(voiceChannel);
  if (!target?.isTextBased?.()) return null;
  if (entry.interfaceMessageId && entry.interfaceChannelId === String(target.id)) {
    let existing = target.messages?.cache?.get(entry.interfaceMessageId);
    if (!existing && target.messages?.fetch) {
      existing = await target.messages.fetch(entry.interfaceMessageId).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.tempVoice, error, `refreshInterface: messages.fetch fehlgeschlagen: Kanal ${voiceChannel.id}`);
      return null;
    });
    }
    if (existing) {
      await existing.edit(await buildTempVoiceInterfacePayload(voiceChannel, entry, conf));
      await runInterfaceOperation(voiceChannel.guild.id, voiceChannel.id, async () => {
        const current = await findOwnedChannel(voiceChannel.guild.id, voiceChannel.id);
        if (current) await reconcileDuplicateInterfacesUnlocked(voiceChannel, target, current);
      });
      return true;
    }
  }
  await sendInterface(voiceChannel, conf);
  return true;
};

const saveTempVoiceInterfaceDesign = async ({ guild, conf = {}, template = {} } = {}) => {
  if (!guild) throw new Error('Server wurde nicht gefunden.');
  assertTempVoiceInterfaceTemplate(template);
  const previous = normalizeTempVoiceInterfaceDesign(conf?.interfaceDesign);
  const sourceEmbed = Array.isArray(template.embeds) ? template.embeds[0] : template.embed;
  const hasOutsideUrl = Object.prototype.hasOwnProperty.call(template, 'outsideImageUrl');
  const hasOutsideAttachment = Object.prototype.hasOwnProperty.call(template, 'outsideImageAttachment');
  const removeOutsideImage = template.removeOutsideImage === true;
  const sourceOutsideImage = removeOutsideImage
    ? ''
    : String(hasOutsideUrl ? template.outsideImageUrl || '' : previous.outsideImageUrl || '').trim();
  if (sourceOutsideImage && !sourceOutsideImage.startsWith('data:') && !/^https?:\/\/[^\s]+$/i.test(sourceOutsideImage)) {
    throw new Error('Das Außenbild muss eine gültige Bilddatei oder HTTP(S)-Adresse sein.');
  }
  const sourceAttachment = removeOutsideImage
    ? null
    : (hasOutsideAttachment ? template.outsideImageAttachment : previous.outsideImageAttachment);
  await resolveOutsideImageFile({
    template: { outsideImageUrl: sourceOutsideImage, outsideImageAttachment: sourceAttachment },
    defaultImageName: 'tempvoice.png'
  });
  const design = normalizeTempVoiceInterfaceDesign({
    content: template.content,
    outsideImageUrl: sourceOutsideImage,
    outsideImageAttachment: sourceAttachment,
    embed: sourceEmbed
  });
  return { design };
};

const refreshTempVoiceInterfaces = async (guild, conf = {}) => {
  const data = await ensureLoaded();
  const entries = Object.entries(data.channels || {})
    .filter(([, entry]) => String(entry?.guildId || '') === String(guild?.id || ''));
  let updated = 0;
  let failed = 0;
  const errors = [];
  for (let index = 0; index < entries.length; index += 3) {
    const batch = entries.slice(index, index + 3);
    const settled = await Promise.allSettled(batch.map(async ([channelId]) => {
      const channel = guild?.channels?.cache?.get?.(String(channelId));
      if (!channel) throw new Error(`Kanal ${channelId} ist nicht im Discord-Cache verfügbar.`);
      const refreshed = await refreshInterface(channel, conf);
      if (!refreshed) throw new Error(`Interface in Kanal ${channelId} konnte nicht aktualisiert werden.`);
      return channelId;
    }));
    settled.forEach((result, offset) => {
      if (result.status === 'fulfilled') {
        updated += 1;
        return;
      }
      failed += 1;
      if (errors.length < 10) {
        const channelId = batch[offset]?.[0] || 'unbekannt';
        errors.push(`Kanal ${channelId}: ${String(result.reason?.message || result.reason).slice(0, 240)}`);
      }
    });
  }
  return { updated, failed, errors };
};

const scheduleCleanup = (channel, conf, options = {}) => {
  const key = channelKey(channel?.guild?.id, channel?.id);
  const attempt = Math.max(0, Number(options.attempt || 0));
  const maxRetries = Math.max(0, Number(options.maxRetries ?? 3));
  const retryBaseMs = Math.max(1, Number(options.retryBaseMs ?? 1000));
  const existing = cleanupTimers.get(key);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(async () => {
    const fresh = channel?.guild?.channels?.cache?.get(channel.id) || channel;
    if (!fresh || Number(fresh?.members?.size || 0) > 0) {
      cleanupTimers.delete(key);
      return;
    }
    const entry = await findOwnedChannel(fresh.guild?.id, fresh.id).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.tempVoice, error, `Cleanup: findOwnedChannel fehlgeschlagen: Kanal ${fresh.id}`);
      return null;
    });
    if (!entry) {
      cleanupTimers.delete(key);
      return;
    }
    const result = await deleteTrackedChannel(fresh, `TempVoice-Kanal leer seit ${conf.emptyGraceSeconds}s`, { requireEmpty: true });
    if (result.deleted || result.cancelled) {
      cleanupTimers.delete(key);
      return;
    }
    cleanupTimers.delete(key);
    quietLog(QUIET_LOG_SCOPE.tempVoice, new Error(result.error || 'unbekannt'), `Cleanup-Löschung fehlgeschlagen: Kanal ${fresh.id}`);
    if (attempt < maxRetries && Number(fresh?.members?.size || 0) === 0) {
      scheduleCleanup(fresh, conf, { attempt: attempt + 1, maxRetries, retryBaseMs });
    }
  }, attempt === 0
    ? Math.max(0, Number(conf.emptyGraceSeconds || 0)) * 1000
    : retryBaseMs * (2 ** (attempt - 1)));
  cleanupTimers.set(key, timer);
};

const cancelCleanup = (guildId, channelId) => {
  const key = channelKey(guildId, channelId);
  const timer = cleanupTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    cleanupTimers.delete(key);
  }
};

const requireOwner = (interaction, entry) => {
  if (String(entry?.ownerId || '') !== String(interaction.user?.id || '')) {
    void interaction.reply({ content: 'Nur der Besitzer dieses Kanals kann das tun.', flags: MessageFlags.Ephemeral }).catch(() => null);
    return false;
  }
  return true;
};

const showUserPicker = (interaction, action, title, placeholder, channelId = '') => {
  const select = new UserSelectMenuBuilder()
    .setCustomId(`${PREFIX}${action}:${String(channelId || '')}:pick`)
    .setPlaceholder(placeholder || 'Mitglied auswählen')
    .setMinValues(1)
    .setMaxValues(1);
  void interaction.reply({
    content: title,
    components: [new ActionRowBuilder().addComponents(select)],
    flags: MessageFlags.Ephemeral
  }).catch(() => null);
};

const showRegionPicker = async (interaction, channel) => {
  const current = String(channel?.rtcRegion || 'automatic');
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${PREFIX}region:${String(channel?.id || '')}:pick`)
    .setPlaceholder('Region auswählen')
    .addOptions(REGIONS.map(([value, label]) => ({ label, value, default: value === current })));
  await interaction.reply({
    content: 'Neue Region für deinen Kanal:',
    components: [new ActionRowBuilder().addComponents(select)],
    flags: MessageFlags.Ephemeral
  });
};

const handleRename = async (interaction, channel, conf) => {
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}rename:modal`)
    .setTitle('Kanal umbenennen')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('name')
        .setLabel('Neuer Kanalname')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(100)
        .setRequired(true)
        .setValue(safeName(channel.name))
    ));
  await interaction.showModal(modal).catch(() => null);
};

const handleLimit = async (interaction, channel) => {
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}limit:modal`)
    .setTitle('Benutzerlimit')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('limit')
        .setLabel('Limit (0 = unbegrenzt)')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(2)
        .setRequired(true)
        .setValue(String(channel?.userLimit || 0))
    ));
  await interaction.showModal(modal).catch(() => null);
};

const parseUserLimit = (raw) => {
  const value = String(raw ?? '').trim();
  if (!/^\d{1,2}$/.test(value)) return { ok: false, error: 'Das Limit muss eine ganze Zahl von 0 bis 99 sein.' };
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 99) return { ok: false, error: 'Das Limit muss zwischen 0 und 99 liegen.' };
  return { ok: true, value: parsed };
};

const resetOwnerProfile = async ({ interaction, channel, entry, conf, deleteProfile = deleteUserProfile }) => {
  const failures = await runOwnedChannelOperation(channel, entry?.ownerId, async (current) => {
    const defaults = resolveChannelSettings(conf, interaction.member, null);
    const operationFailures = [];
    const apply = async (label, task) => {
      try {
        await task();
      } catch (error) {
        operationFailures.push(`${label}: ${String(error?.message || error).slice(0, 160)}`);
      }
    };
    await apply('Name', () => channel.setName(defaults.name));
    await apply('Limit', () => channel.setUserLimit(defaults.userLimit));
    await apply('Region', () => channel.setRTCRegion(defaults.rtcRegion === 'automatic' ? null : defaults.rtcRegion));
    await apply('Profil', async () => {
      const profileDeleted = await deleteProfile(channel.guild.id, current.ownerId);
      if (!profileDeleted) throw new Error('Gespeichertes Profil konnte nicht geloescht werden.');
    });
    await refreshInterface(channel, conf).catch((error) => operationFailures.push(`Interface: ${String(error?.message || error).slice(0, 160)}`));
    return operationFailures;
  });
  const content = failures.length
    ? `Dein TempVoice-Profil konnte nicht vollständig zurückgesetzt werden:\n${failures.map((failure) => `- ${failure}`).join('\n')}`
    : 'Dein TempVoice-Profil wurde zurückgesetzt. Name, Limit und Region verwenden wieder die Modulwerte.';
  await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => null);
  return { ok: failures.length === 0, failures };
};

const showProfileResetConfirmation = async (interaction) => {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}profile-reset:confirm`).setLabel('Zurücksetzen').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`${PREFIX}profile-reset:cancel`).setLabel('Abbrechen').setStyle(ButtonStyle.Secondary)
  );
  await interaction.reply({
    content: 'Gespeicherten Kanalnamen, Benutzerlimit und Region wirklich auf die Modulwerte zurücksetzen?',
    components: [row],
    flags: MessageFlags.Ephemeral
  }).catch(() => null);
};

// Wer ist gerade im Call? (realistische Ziele für „Ausschließen“)
const channelMemberOptions = (channel, { excludeId = '' } = {}) => [...(channel?.members?.values?.() || [])]
  .filter((member) => !member.user?.bot && String(member.id) !== String(excludeId || ''))
  .map((member) => ({
    id: String(member.id),
    label: `🔊 ${member.displayName || member.user?.username || 'Unbekannt'}`.slice(0, 100)
  }));

// Wer ist wirklich gesperrt? (Member-Overwrites mit Connect: deny)
const blockedMemberOptions = (channel) => [...(channel?.permissionOverwrites?.cache?.values?.() || [])]
  .filter((overwrite) => overwrite.type === 1 && overwrite.deny?.has?.(PermissionFlagsBits.Connect))
  .map((overwrite) => {
    const member = channel.guild?.members?.cache?.get(overwrite.id)
      || channel.client?.users?.cache?.get(overwrite.id);
    return {
      id: String(overwrite.id),
      label: `⛔ ${member?.displayName || member?.username || 'Unbekanntes Mitglied'}`.slice(0, 100)
    };
  });

const showBlockPicker = (interaction, channel) => {
  const rows = [];
  // Bereits gesperrte rausfiltern – die gehören in den Freigeben-Picker.
  const blockedIds = new Set(blockedMemberOptions(channel).map((entry) => entry.id));
  const inCallOptions = channelMemberOptions(channel, { excludeId: interaction.user.id })
    .filter((entry) => !blockedIds.has(entry.id))
    .slice(0, 25);
  // Reihe 1: Leute, die gerade im Call sind, direkt auswählbar.
  if (inCallOptions.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${PREFIX}access:block:${String(channel.id)}:pick`)
        .setPlaceholder(`Im Call (${inCallOptions.length}): Mitglied auswählen`)
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(inCallOptions.map((entry) => ({ label: entry.label, value: entry.id })))
    ));
  }
  // Reihe 2: Suche über alle Servermitglieder (Discord-eigenes Suchfeld).
  rows.push(new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(`${PREFIX}access:block:${String(channel.id)}:pick`)
      .setPlaceholder('Oder anderes Mitglied suchen …')
      .setMinValues(1)
      .setMaxValues(1)
  ));
  void interaction.reply({
    content: 'Wen möchtest du aus deinem Kanal **ausschließen**?',
    components: rows,
    flags: MessageFlags.Ephemeral
  }).catch(() => null);
};

const showUnblockPicker = async (interaction, channel) => {
  const blocked = blockedMemberOptions(channel).slice(0, 25);
  if (!blocked.length) {
    await interaction.reply({ content: '✅ Es sind aktuell keine Mitglieder aus deinem Kanal gesperrt.', flags: MessageFlags.Ephemeral }).catch(() => null);
    return;
  }
  void interaction.reply({
    content: 'Wen möchtest du wieder **hereinlassen**?',
    components: [new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${PREFIX}access:unblock:${String(channel.id)}:pick`)
        .setPlaceholder(`Gesperrt (${blocked.length}): Mitglied auswählen`)
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(blocked.map((entry) => ({ label: entry.label, value: entry.id })))
    )],
    flags: MessageFlags.Ephemeral
  }).catch(() => null);
};

const handleBlockUnblock = async (interaction, action, channel) => {
  if (action === 'block') return showBlockPicker(interaction, channel);
  return showUnblockPicker(interaction, channel);
};

const accessModeLabels = {
  allow: ['Erlauben', 'Person darf einen gesperrten Kanal sehen und betreten'],
  revoke: ['Freigabe entfernen', 'Vorherige Rechte exakt wiederherstellen'],
  block: ['Sperren', 'Person ausschliessen und erneuten Beitritt verhindern'],
  unblock: ['Sperre entfernen', 'Vorherige Rechte exakt wiederherstellen']
};

const showAccessModePicker = async (interaction, channel) => {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${PREFIX}access:${String(channel.id)}:mode`)
    .setPlaceholder('Zugriffsaktion auswählen')
    .addOptions(Object.entries(accessModeLabels).map(([value, [label, description]]) => ({ value, label, description })));
  await interaction.reply({
    content: 'Wie möchtest du den Zugang verwalten?',
    components: [new ActionRowBuilder().addComponents(select)],
    flags: MessageFlags.Ephemeral
  }).catch(() => null);
};

const showAccessUserPicker = async (interaction, channelId, mode) => {
  const [label] = accessModeLabels[mode] || [];
  const select = new UserSelectMenuBuilder()
    .setCustomId(`${PREFIX}access:${mode}:${String(channelId)}:pick`)
    .setPlaceholder('Mitglied auswählen')
    .setMinValues(1)
    .setMaxValues(1);
  await interaction.editReply({
    content: `${label || 'Zugang'}: Welches Mitglied?`,
    components: [new ActionRowBuilder().addComponents(select)]
  }).catch(() => null);
};

const handleTransfer = async (interaction, channel) => {
  showUserPicker(interaction, 'transfer', 'Wem möchtest du die **Besitzerschaft** übertragen?', 'Neuen Besitzer wählen', channel?.id);
};

const handleDelete = async (interaction, channel, conf) => {
  const result = await deleteTrackedChannel(channel, 'TempVoice-Kanal gelöscht', { expectedOwnerId: interaction.user?.id });
  const content = result.deleted
    ? '🗑️ Dein TempVoice-Kanal wurde gelöscht.'
    : `Der TempVoice-Kanal konnte nicht gelöscht werden: ${result.error || 'unbekannter Fehler'}`;
  await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => null);
  return result;
};

const handleVoiceStateChange = async ({ oldState, newState, cfg }) => {
  const guild = newState?.guild || oldState?.guild;
  if (!guild) return;
  const conf = normalizeTempVoiceConfig(cfg?.tempVoice);
  guildConfigs.set(String(guild.id), conf);

  const member = newState?.member || oldState?.member;
  const oldChannelId = String(oldState?.channelId || '');
  const newChannelId = String(newState?.channelId || '');
  if (oldChannelId === newChannelId) return;

  const oldEntry = oldChannelId ? await findOwnedChannel(guild.id, oldChannelId).catch(() => null) : null;
  const newEntry = newChannelId ? await findOwnedChannel(guild.id, newChannelId).catch(() => null) : null;

  if (oldEntry) {
    const left = oldState.channel || guild.channels.cache.get(oldChannelId);
    if (left && Number(left?.members?.size || 0) === 0) {
      scheduleCleanup(left, conf);
    } else if (left) {
      cancelCleanup(guild.id, oldChannelId);
    }
    if (left) await refreshInterface(left, conf).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.tempVoice, error, `MemberCount-Refresh nach Leave fehlgeschlagen: Kanal ${oldChannelId}`);
    });
  }

  if (newEntry) {
    const joined = newState.channel || guild.channels.cache.get(newChannelId);
    if (joined) {
      cancelCleanup(guild.id, newChannelId);
      await refreshInterface(joined, conf).catch((error) => {
        quietLog(QUIET_LOG_SCOPE.tempVoice, error, `MemberCount-Refresh nach Join fehlgeschlagen: Kanal ${newChannelId}`);
      });
    }
  }

  if (!conf.enabled || !conf.creatorChannelIds.length) return;

  if (newChannelId && conf.creatorChannelIds.includes(newChannelId) && !isBot(member)) {
    const deniedReason = accessDeniedReason(member, conf);
    if (deniedReason) {
      // Beitritt verweigern: zurück in den vorherigen Kanal verschieben und informieren.
      if (oldChannelId) {
        await member.voice.setChannel(oldChannelId).catch((error) => {
          quietLog(QUIET_LOG_SCOPE.tempVoice, error, `Access: Verschieben fehlgeschlagen: ${member.displayName}`);
        });
      } else {
        await member.voice.disconnect().catch((error) => {
          quietLog(QUIET_LOG_SCOPE.tempVoice, error, `Access: Disconnect fehlgeschlagen: ${member.displayName}`);
        });
      }
      await member.send(`🚫 **TempVoice-Zugang verweigert**\n${deniedReason}`).catch((error) => {
        quietLog(QUIET_LOG_SCOPE.tempVoice, error, `Access: DM-Zugang verweigert fehlgeschlagen: ${member.displayName}`);
      });
      return;
    }
    await runCreationSingleFlight(guild.id, member.id, async () => {
      // Innerhalb des Flights erneut prüfen: Zwei parallele Voice-Events dürfen
      // nicht beide den Zustand vor der ersten Erstellung beobachten.
      const ownedChannelId = Object.entries((await ensureLoaded()).channels)
        .find(([, entry]) => String(entry.guildId) === String(guild.id) && String(entry.ownerId) === String(member.id))?.[0];
      if (ownedChannelId) {
        const ownChannel = guild.channels.cache.get(String(ownedChannelId));
        if (ownChannel) {
          await member.voice.setChannel(ownChannel.id).catch((error) => {
            quietLog(QUIET_LOG_SCOPE.tempVoice, error, `AlreadyOwned: Verschieben fehlgeschlagen: ${member.displayName}`);
          });
        }
        await member.send('🗣️ Du hast bereits einen TempVoice-Kanal – du wurdest dorthin zurückverschoben. Löschen kannst du ihn über das Interface.').catch((error) => {
          quietLog(QUIET_LOG_SCOPE.tempVoice, error, `AlreadyOwned: DM fehlgeschlagen: ${member.displayName}`);
        });
        return;
      }
      const missing = missingPermissions(newState.channel || guild.channels.cache.get(newChannelId));
      if (missing.length) {
        console.warn(`[tempVoice] Fehlende Bot-Rechte in ${guild.name}: ${missing.join(', ')}`);
        return;
      }
      try {
        await createTempChannel({ guild, member, conf });
      } catch (error) {
        console.warn(`[tempVoice] Kanal-Erstellung für ${member.displayName} fehlgeschlagen: ${error?.message || error}`);
      }
    });
    return;
  }

};

const responseErrorText = (error) => String(error?.message || error || 'unbekannter Fehler').slice(0, 300);

const finishDeferredSetting = async ({ interaction, channel, entry, conf, applyDiscord, profilePatch, successText }) => {
  try {
    const result = await runOwnedChannelOperation(channel, entry?.ownerId, async (current) => {
      await applyDiscord(current);
      const warnings = [];
      if (conf.rememberUserProfiles && profilePatch) {
        try {
          await setUserProfile(channel.guild.id, current.ownerId, profilePatch);
        } catch (error) {
          warnings.push('Die Änderung wurde für diesen Kanal übernommen, aber nicht für den nächsten Kanal gespeichert.');
          quietLog(QUIET_LOG_SCOPE.tempVoice, error, `Profil-Speicherung fehlgeschlagen: Kanal ${channel.id}`);
        }
      }
      try {
        await refreshInterface(channel, conf);
      } catch (error) {
        warnings.push('Das Interface konnte nicht aktualisiert werden.');
        quietLog(QUIET_LOG_SCOPE.tempVoice, error, `Interface-Refresh fehlgeschlagen: Kanal ${channel.id}`);
      }
      return { warnings };
    });
    const content = [successText, ...result.warnings].join('\n');
    await interaction.editReply({ content }).catch(() => null);
    return { ok: result.warnings.length === 0, phase: result.warnings.length ? 'partial' : 'complete', warnings: result.warnings };
  } catch (error) {
    quietLog(QUIET_LOG_SCOPE.tempVoice, error, `Einstellung fehlgeschlagen: Kanal ${channel.id}`);
    await interaction.editReply({ content: `Änderung fehlgeschlagen: ${responseErrorText(error)}` }).catch(() => null);
    return { ok: false, phase: 'discord' };
  }
};

const selectTarget = (customId, currentChannel) => {
  let match = customId.match(/^fh_tv:access:(allow|revoke|block|unblock):([^:]+):pick$/);
  if (match) return { action: 'access', mode: match[1], channelId: match[2] };
  match = customId.match(/^fh_tv:access:([^:]+):mode$/);
  if (match) return { action: 'access-mode', channelId: match[1] };
  match = customId.match(/^fh_tv:(region|transfer):([^:]+):pick$/);
  if (match) return { action: match[1], channelId: match[2] };
  if (customId === `${PREFIX}block:pick` || customId === `${PREFIX}block:search`) {
    return { action: 'access', mode: 'block', channelId: String(currentChannel?.id || '') };
  }
  if (customId === `${PREFIX}unblock:pick`) {
    return { action: 'access', mode: 'unblock', channelId: String(currentChannel?.id || '') };
  }
  if (customId === `${PREFIX}region:pick`) return { action: 'region', channelId: String(currentChannel?.id || '') };
  if (customId === `${PREFIX}transfer:pick`) return { action: 'transfer', channelId: String(currentChannel?.id || '') };
  return null;
};

const resolveTrackedPickerTarget = async ({ guild, target, interaction }) => {
  const channel = guild?.channels?.cache?.get?.(String(target?.channelId || '')) || null;
  if (!channel || String(channel.guild?.id || '') !== String(guild?.id || '')) return { error: 'Der ursprüngliche TempVoice-Kanal wurde nicht gefunden.' };
  const entry = await findOwnedChannel(guild.id, channel.id).catch(() => null);
  if (!entry) return { error: 'Der ursprüngliche Kanal ist nicht mehr als TempVoice registriert.' };
  if (String(entry.ownerId) !== String(interaction.user?.id || '')) return { error: 'Nur der Besitzer dieses Kanals kann das tun.' };
  return { channel, entry };
};

const handleAnyInteraction = async ({ interaction, cfg }) => {
  const conf = normalizeTempVoiceConfig(cfg?.tempVoice);
  const customId = String(interaction?.customId || '');
  if (!customId.startsWith(PREFIX)) return;
  if (!interaction.inGuild?.() && !interaction.guildId) {
    await interaction.reply({ content: 'Dieses Interface funktioniert nur auf einem Server.', flags: MessageFlags.Ephemeral }).catch(() => null);
    return;
  }
  const guild = interaction.guild;
  const channel = interaction.member?.voice?.channel || null;

  // Jeder Picker ist an den Kanal gebunden, in dem er geöffnet wurde. Ein
  // zwischenzeitlicher Call-Wechsel kann dadurch keinen anderen Kanal treffen.
  if (interaction.isUserSelectMenu?.() || interaction.isStringSelectMenu?.()) {
    const target = selectTarget(customId, channel);
    if (!target) return;
    try {
      await interaction.deferUpdate();
    } catch (error) {
      quietLog(QUIET_LOG_SCOPE.tempVoice, error, `Picker konnte nicht bestätigt werden: ${customId}`);
      return;
    }
    const respond = (content) => interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => null);
    if (!conf.enabled) {
      await respond('Das TempVoice-Modul ist auf diesem Server deaktiviert.');
      return;
    }
    if (target.action === 'region' && !conf.allowRegion) {
      await respond('Die Regionswahl ist in diesem TempVoice-Modul deaktiviert.');
      return;
    }
    if (target.action === 'transfer' && !conf.allowTransfer) {
      await respond('Die Übertragung ist in diesem TempVoice-Modul deaktiviert.');
      return;
    }
    const resolved = await resolveTrackedPickerTarget({ guild, target, interaction });
    if (resolved.error) {
      await respond(resolved.error);
      return;
    }
    const { channel: targetChannel, entry } = resolved;
    const userId = String(interaction.values?.[0] || '');
    if (target.action === 'access-mode') {
      const mode = String(interaction.values?.[0] || '');
      if (!accessModeLabels[mode]) {
        await respond('Unbekannte Zugriffsaktion.');
        return;
      }
      await showAccessUserPicker(interaction, targetChannel.id, mode);
      return;
    }
    if (target.action === 'access') {
      try {
        const result = await applyAccessMode({ channel: targetChannel, entry, userId, mode: target.mode });
        let refreshWarning = '';
        await refreshInterface(targetChannel, conf).catch((error) => {
          refreshWarning = '\nDas Interface konnte nicht aktualisiert werden.';
          quietLog(QUIET_LOG_SCOPE.tempVoice, error, `Access: Interface-Refresh fehlgeschlagen: Kanal ${targetChannel.id}`);
        });
        await respond(`${result.message}${refreshWarning}`);
      } catch (error) {
        await respond(`Zugriff konnte nicht geändert werden: ${responseErrorText(error)}`);
      }
      return;
    }
    if (target.action === 'transfer' && interaction.isUserSelectMenu?.()) {
      const targetMember = await guild.members.fetch(userId).catch((error) => {
        quietLog(QUIET_LOG_SCOPE.tempVoice, error, `Transfer: members.fetch fehlgeschlagen: User ${userId}`);
        return null;
      });
      if (!targetMember) {
        await respond('Dieses Mitglied wurde nicht gefunden.');
        return;
      }
      try {
        await transferOwnership({
          channel: targetChannel,
          entry,
          expectedOwnerId: interaction.user?.id,
          nextOwner: targetMember
        });
        await respond(`🔁 <@${userId}> ist jetzt der Besitzer des Kanals.`);
      } catch (error) {
        await respond(`Besitz konnte nicht übertragen werden: ${responseErrorText(error)}`);
      }
      return;
    }
    if (target.action === 'region' && interaction.isStringSelectMenu?.()) {
        const region = String(interaction.values?.[0] || 'automatic');
        try {
          const warnings = await runOwnedChannelOperation(targetChannel, interaction.user?.id, async (current) => {
            await targetChannel.setRTCRegion(region === 'automatic' ? null : region);
            const operationWarnings = [];
            if (conf.rememberUserProfiles) await setUserProfile(guild.id, current.ownerId, { rtcRegion: region }).catch((error) => {
              operationWarnings.push('Die Region wurde nicht für den nächsten Kanal gespeichert.');
              quietLog(QUIET_LOG_SCOPE.tempVoice, error, `Region: Profil-Speicherung fehlgeschlagen: Kanal ${targetChannel.id}`);
            });
            await refreshInterface(targetChannel, conf).catch((error) => {
              operationWarnings.push('Das Interface konnte nicht aktualisiert werden.');
              quietLog(QUIET_LOG_SCOPE.tempVoice, error, `Region: Interface-Refresh fehlgeschlagen: Kanal ${targetChannel.id}`);
            });
            return operationWarnings;
          });
          await respond([`🌍 Region auf **${regionLabel(region)}** gesetzt.`, ...warnings].join('\n'));
        } catch (error) {
          await respond(`Region konnte nicht geändert werden: ${responseErrorText(error)}`);
        }
        return;
    }
    return;
  }

  if (interaction.isModalSubmit?.()) {
    if (customId === `${PREFIX}rename:modal`) {
      try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      } catch (error) {
        quietLog(QUIET_LOG_SCOPE.tempVoice, error, 'Rename-Modal konnte nicht bestätigt werden');
        return;
      }
      if (!conf.enabled || !conf.allowRename) {
        await interaction.editReply({ content: 'Das Umbenennen ist in diesem TempVoice-Modul deaktiviert.' }).catch(() => null);
        return;
      }
      if (!channel) {
        await interaction.editReply({ content: 'Du bist in keinem TempVoice-Kanal.' }).catch(() => null);
        return;
      }
      const entry = await findOwnedChannel(guild.id, channel.id).catch(() => null);
      if (!entry) {
        await interaction.editReply({ content: 'Dieser Kanal ist nicht als TempVoice erkannt.' }).catch(() => null);
        return;
      }
      if (String(entry.ownerId) !== String(interaction.user?.id || '')) {
        await interaction.editReply({ content: 'Nur der Besitzer dieses Kanals kann das tun.' }).catch(() => null);
        return;
      }
      const newName = safeName(interaction.fields?.getTextInputValue?.('name') || '');
      await finishDeferredSetting({
        interaction, channel, entry, conf,
        applyDiscord: () => channel.setName(newName),
        profilePatch: { customName: newName },
        successText: `✏️ Kanal umbenannt in **${newName}**.`
      });
      return;
    }
    if (customId === `${PREFIX}limit:modal`) {
      try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      } catch (error) {
        quietLog(QUIET_LOG_SCOPE.tempVoice, error, 'Limit-Modal konnte nicht bestätigt werden');
        return;
      }
      if (!conf.enabled || !conf.allowLimit) {
        await interaction.editReply({ content: 'Das Benutzerlimit ist in diesem TempVoice-Modul deaktiviert.' }).catch(() => null);
        return;
      }
      if (!channel) {
        await interaction.editReply({ content: 'Du bist in keinem TempVoice-Kanal.' }).catch(() => null);
        return;
      }
      const entry = await findOwnedChannel(guild.id, channel.id).catch(() => null);
      if (!entry) {
        await interaction.editReply({ content: 'Dieser Kanal ist nicht als TempVoice erkannt.' }).catch(() => null);
        return;
      }
      if (String(entry.ownerId) !== String(interaction.user?.id || '')) {
        await interaction.editReply({ content: 'Nur der Besitzer dieses Kanals kann das tun.' }).catch(() => null);
        return;
      }
      const raw = interaction.fields?.getTextInputValue?.('limit') || '0';
      const parsed = parseUserLimit(raw);
      if (!parsed.ok) {
        await interaction.editReply({ content: parsed.error }).catch(() => null);
        return;
      }
      const limit = parsed.value;
      await finishDeferredSetting({
        interaction, channel, entry, conf,
        applyDiscord: () => channel.setUserLimit(limit),
        profilePatch: { userLimit: limit },
        successText: limit > 0 ? `🔢 Limit auf **${limit}** gesetzt.` : '🔢 Limit entfernt (unbegrenzt).'
      });
      return;
    }
    return;
  }

  if (!interaction.isButton?.()) return;

  if (!channel) {
    await interaction.reply({ content: 'Verbinde dich zuerst mit deinem TempVoice-Kanal, um das Interface zu nutzen.', flags: MessageFlags.Ephemeral }).catch(() => null);
    return;
  }
  const entry = await findOwnedChannel(guild.id, channel.id).catch(() => null);
  if (!entry) {
    await interaction.reply({ content: 'Dies ist kein TempVoice-Kanal.', flags: MessageFlags.Ephemeral }).catch(() => null);
    return;
  }

  const action = customId.slice(PREFIX.length);
  if (!conf.enabled) {
    await interaction.reply({ content: 'Das TempVoice-Modul ist auf diesem Server deaktiviert.', flags: MessageFlags.Ephemeral }).catch(() => null);
    return;
  }

  switch (action) {
    case 'rename':
      if (!requireOwner(interaction, entry)) return;
      if (!conf.allowRename) {
        await interaction.reply({ content: 'Das Umbenennen ist in diesem TempVoice-Modul deaktiviert.', flags: MessageFlags.Ephemeral }).catch(() => null);
        return;
      }
      await handleRename(interaction, channel, conf);
      return;
    case 'limit':
      if (!requireOwner(interaction, entry)) return;
      if (!conf.allowLimit) {
        await interaction.reply({ content: 'Das Benutzerlimit ist in diesem TempVoice-Modul deaktiviert.', flags: MessageFlags.Ephemeral }).catch(() => null);
        return;
      }
      await handleLimit(interaction, channel);
      return;
    case 'lock': {
      if (!requireOwner(interaction, entry)) return;
      if (!conf.allowLock) {
        await interaction.reply({ content: 'Sperren und Öffnen ist in diesem TempVoice-Modul deaktiviert.', flags: MessageFlags.Ephemeral }).catch(() => null);
        return;
      }
      try {
        await interaction.deferUpdate();
      } catch (error) {
        quietLog(QUIET_LOG_SCOPE.tempVoice, error, `Lock konnte nicht bestätigt werden: Kanal ${channel.id}`);
        return;
      }
      let lockResult;
      try {
        lockResult = await applyLockMode({ channel, entry, locked: undefined });
      } catch (error) {
        await interaction.followUp({ content: `Sperren oder Öffnen fehlgeschlagen: ${responseErrorText(error)}`, flags: MessageFlags.Ephemeral }).catch(() => null);
        return;
      }
      let refreshWarning = '';
      await refreshInterface(channel, conf).catch((error) => {
        refreshWarning = '\nDas Interface konnte nicht aktualisiert werden.';
        quietLog(QUIET_LOG_SCOPE.tempVoice, error, `Lock: Interface-Refresh fehlgeschlagen: Kanal ${channel.id}`);
      });
      const content = lockResult.locked
        ? '🔒 Dein Kanal ist jetzt **gesperrt**. Nur du und ausdrücklich freigegebene Mitglieder können beitreten.'
        : '🔓 Die TempVoice-Sperre wurde aufgehoben; die ursprünglichen Kategorie-Rechte gelten wieder.';
      await interaction.followUp({ content: `${content}${refreshWarning}`, flags: MessageFlags.Ephemeral }).catch(() => null);
      return;
    }
    case 'access':
      if (!requireOwner(interaction, entry)) return;
      await showAccessModePicker(interaction, channel);
      return;
    case 'block':
      if (!requireOwner(interaction, entry)) return;
      await handleBlockUnblock(interaction, 'block', channel);
      return;
    case 'unblock':
      if (!requireOwner(interaction, entry)) return;
      await handleBlockUnblock(interaction, 'unblock', channel);
      return;
    case 'claim': {
      // Interface-Refresh kann Nachrichten laden – erst bestätigen, dann arbeiten.
      try {
        await interaction.deferUpdate();
      } catch (error) {
        quietLog(QUIET_LOG_SCOPE.tempVoice, error, `Claim konnte nicht bestätigt werden: Kanal ${channel.id}`);
        return;
      }
      try {
        await transferOwnership({
          channel,
          entry,
          expectedOwnerId: entry.ownerId,
          nextOwner: interaction.member,
          validateCurrent: (current) => {
            if (channel.members?.get?.(String(current.ownerId))) {
              throw new Error('Der Besitzer ist gerade im Kanal – du kannst ihn nicht übernehmen.');
            }
          }
        });
        await interaction.followUp({ content: '👑 Du bist jetzt der Besitzer dieses Kanals.', flags: MessageFlags.Ephemeral }).catch(() => null);
      } catch (error) {
        await interaction.followUp({ content: `Übernahme fehlgeschlagen: ${responseErrorText(error)}`, flags: MessageFlags.Ephemeral }).catch(() => null);
      }
      return;
    }
    case 'transfer':
      if (!requireOwner(interaction, entry)) return;
      if (!conf.allowTransfer) {
        await interaction.reply({ content: 'Die Besitzübertragung ist in diesem TempVoice-Modul deaktiviert.', flags: MessageFlags.Ephemeral }).catch(() => null);
        return;
      }
      await handleTransfer(interaction, channel);
      return;
    case 'region':
      if (!requireOwner(interaction, entry)) return;
      if (!conf.allowRegion) {
        await interaction.reply({ content: 'Die Regionswahl ist in diesem TempVoice-Modul deaktiviert.', flags: MessageFlags.Ephemeral }).catch(() => null);
        return;
      }
      await showRegionPicker(interaction, channel);
      return;
    case 'profile-reset':
      if (!requireOwner(interaction, entry)) return;
      if (!conf.rememberUserProfiles) {
        await interaction.reply({ content: 'Gespeicherte TempVoice-Profile sind in diesem Modul deaktiviert.', flags: MessageFlags.Ephemeral }).catch(() => null);
        return;
      }
      await showProfileResetConfirmation(interaction);
      return;
    case 'profile-reset:cancel':
      if (!requireOwner(interaction, entry)) return;
      if (interaction.update) await interaction.update({ content: 'Zurücksetzen abgebrochen.', components: [] }).catch(() => null);
      return;
    case 'profile-reset:confirm':
      if (!requireOwner(interaction, entry)) return;
      if (!conf.rememberUserProfiles) {
        await interaction.reply({ content: 'Gespeicherte TempVoice-Profile sind in diesem Modul deaktiviert.', flags: MessageFlags.Ephemeral }).catch(() => null);
        return;
      }
      try {
        await interaction.deferUpdate();
      } catch (error) {
        quietLog(QUIET_LOG_SCOPE.tempVoice, error, `Profil-Reset konnte nicht bestätigt werden: Kanal ${channel.id}`);
        return;
      }
      await resetOwnerProfile({ interaction, channel, entry, conf });
      return;
    case 'thread': {
      await interaction.reply({
        content: 'Die frühere Thread-Aktion wird für Sprachkanäle nicht mehr angeboten.',
        flags: MessageFlags.Ephemeral
      }).catch(() => null);
      return;
    }
    case 'delete':
      if (!requireOwner(interaction, entry)) return;
      // Erst bestätigen, dann Kanal löschen.
      try {
        await interaction.deferUpdate();
      } catch (error) {
        quietLog(QUIET_LOG_SCOPE.tempVoice, error, `Delete konnte nicht bestätigt werden: Kanal ${channel.id}`);
        return;
      }
      await handleDelete(interaction, channel, conf);
      return;
    default:
      return;
  }
};

export { saveTempVoiceInterfaceDesign, refreshTempVoiceInterfaces };

export const feature = {
  id: 'tempVoice',
  name: 'TempVoice',
  commands: [],
  async onClientReady({ guild, cfg }) {
    await ensureLoaded();
    const conf = normalizeTempVoiceConfig(cfg?.tempVoice);
    guildConfigs.set(String(guild.id), conf);
    // Cache-Miss ist kein Löschbeweis. Erst Discord Unknown Channel darf einen
    // verwaisten Eintrag entfernen; Rechte- und Netzfehler behalten den State.
    const data = await ensureLoaded();
    const entries = Object.entries(data.channels || {}).filter(([, entry]) => String(entry.guildId) === String(guild.id));
    for (const [channelId, entry] of entries) {
      let channel = guild.channels.cache.get(String(channelId));
      if (!channel) {
        try {
          channel = await guild.channels.fetch?.(String(channelId));
        } catch (error) {
          if (isUnknownChannelError(error)) {
            await runChannelOperation(guild.id, channelId, () => setChannelEntry(channelId, null)).catch((stateError) => {
              quietLog(QUIET_LOG_SCOPE.tempVoice, stateError, `Startup: bestätigten ChannelDelete nicht speicherbar: Kanal ${channelId}`);
            });
          } else {
            quietLog(QUIET_LOG_SCOPE.tempVoice, error, `Startup: Kanalstatus unklar, State bleibt erhalten: Kanal ${channelId}`);
          }
          continue;
        }
        if (!channel) continue;
      }
      if (Number(channel.members?.size || 0) === 0) {
        scheduleCleanup(channel, configFor(guild.id));
      }
    }
    // Interfaces mit dem aktuellen Code neu rendern (z. B. nach einem Update),
    // damit alte Nachrichten nicht mit veralteten Buttons/Layouts stehen bleiben.
    // PARALLEL: Bei vielen TempVoice-Kanälen spart das Startzeit.
    const refreshPromises = entries.map(([channelId]) => {
      const channel = guild.channels.cache.get(String(channelId));
      if (!channel) return Promise.resolve();
      return refreshInterface(channel, conf).catch((error) => {
        quietLog(QUIET_LOG_SCOPE.tempVoice, error, `Interface-Refresh nach Start fehlgeschlagen: Kanal ${channelId}`);
      });
    });
    await Promise.allSettled(refreshPromises);
  },
  async onConfigUpdate({ guild, cfg, patch }) {
    if (!patch || !Object.prototype.hasOwnProperty.call(patch, 'tempVoice')) return;
    const conf = normalizeTempVoiceConfig(cfg?.tempVoice);
    guildConfigs.set(String(guild.id), conf);
    await refreshTempVoiceInterfaces(guild, conf).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.tempVoice, error, `Interface-Refresh nach Config-Update fehlgeschlagen: Guild ${guild.id}`);
    });
  },
  async onVoiceStateUpdate(context) {
    await handleVoiceStateChange(context).catch((error) => {
      console.warn(`[tempVoice] Voice-Update fehlgeschlagen: ${error?.message || error}`);
    });
  },
  async onChannelDelete({ channel }) {
    const guildId = String(channel?.guild?.id || '');
    const channelId = String(channel?.id || '');
    if (!guildId || !channelId) return;
    await runChannelOperation(guildId, channelId, async () => {
      const entry = await findOwnedChannel(guildId, channelId);
      if (!entry) return;
      await setChannelEntry(channelId, null);
      cancelCleanup(guildId, channelId);
    });
  },
  async onAnyInteraction(context) {
    await handleAnyInteraction(context).catch((error) => {
      console.warn(`[tempVoice] Interface-Interaktion fehlgeschlagen: ${error?.message || error}`);
      if (!context?.interaction?.replied && !context?.interaction?.deferred) {
        void context.interaction.reply({ content: 'Das Interface konnte gerade nicht verarbeitet werden.', flags: MessageFlags.Ephemeral }).catch(() => null);
      }
    });
  },
};

const cachedMemberProfile = (guild, userId) => {
  const member = guild?.members?.cache?.get?.(String(userId || '')) || null;
  const user = member?.user || null;
  let avatarUrl = '';
  try {
    avatarUrl = String(member?.displayAvatarURL?.({ size: 64 }) || user?.displayAvatarURL?.({ size: 64 }) || '');
  } catch {
    avatarUrl = '';
  }
  return {
    memberName: String(member?.displayName || user?.globalName || user?.username || ''),
    avatarUrl
  };
};

export const getTempVoiceSnapshot = async (guildId, guild = null) => {
  const data = await ensureLoaded();
  const conf = configFor(guildId);
  const guildChannels = Object.entries(data.channels || {})
    .filter(([, entry]) => String(entry.guildId) === String(guildId))
    .map(([channelId, entry]) => {
      const channel = guild?.channels?.cache?.get?.(String(channelId)) || null;
      const owner = cachedMemberProfile(guild, entry.ownerId);
      return {
        channelId,
        ownerId: entry.ownerId,
        ownerName: owner.memberName || entry.ownerName || entry.ownerId,
        name: String(channel?.name || entry.channelName || 'Unbekannter Kanal'),
        memberCount: Math.max(0, Number(channel?.members?.size || 0)),
        userLimit: Math.max(0, Number(channel?.userLimit || 0)),
        rtcRegion: String(channel?.rtcRegion || 'automatic'),
        locked: isChannelLocked(channel),
        createdAt: entry.createdAt
      };
    });
  const guildProfiles = data.profiles?.[String(guildId)] || {};
  const profileEntries = Object.entries(guildProfiles);
  const profiles = profileEntries
    .map(([userId, profile]) => {
      const memberProfile = cachedMemberProfile(guild, userId);
      return {
        userId,
        ...memberProfile,
        memberName: memberProfile.memberName || userId,
        ...structuredClone(profile)
      };
    })
    .sort((left, right) => {
      const byUpdatedAt = String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''));
      return byUpdatedAt || String(left.userId).localeCompare(String(right.userId));
    })
    .slice(0, 100);
  return {
    enabled: conf.enabled,
    creatorChannelCount: conf.creatorChannelIds.length,
    activeChannelCount: guildChannels.length,
    profileCount: profileEntries.length,
    channels: guildChannels,
    profiles
  };
};

export const removeTempVoiceProfile = async (guildId, userId) => {
  if (!isSafeStateKey(guildId) || !isSafeStateKey(userId)) {
    throw new TypeError('Ungültige TempVoice-Profil-ID.');
  }
  const removed = await deleteUserProfile(guildId, userId);
  return { ok: true, removed };
};

export const removeAllTempVoiceProfiles = async (guildId) => {
  if (!isSafeStateKey(guildId)) throw new TypeError('Ungültige TempVoice-Server-ID.');
  const removedCount = await clearGuildProfiles(guildId);
  return { ok: true, removedCount };
};

export const _tempVoiceInternals = {
  defaultTempVoiceInterfaceDesign,
  normalizeTempVoiceInterfaceDesign,
  formatTempVoiceInterfaceText,
  tempVoicePlaceholderContext,
  buildTempVoiceInterfacePayload,
  saveTempVoiceInterfaceDesign,
  refreshTempVoiceInterfaces,
  normalizeTempVoiceConfig,
  normalizeTempVoiceState,
  getUserProfile,
  setUserProfile,
  deleteUserProfile,
  clearGuildProfiles,
  resolveChannelSettings,
  accessDeniedReason,
  channelNameFor,
  safeName,
  interfaceRows,
  interfaceEmbed,
  interfaceRowCount,
  buildChannelOverwrites,
  createTempChannel,
  runCreationSingleFlight,
  parseUserLimit,
  handleLimit,
  showRegionPicker,
  resetOwnerProfile,
  permissionTriState,
  captureAccessBaseline,
  applyAccessMode,
  captureLockBaseline,
  applyLockMode,
  deleteTrackedChannel,
  transferOwnership,
  runChannelOperation,
  findOwnedChannel,
  setChannelEntry,
  scheduleCleanup,
  cancelCleanup,
  missingPermissions,
  handleAnyInteraction,
  handleVoiceStateChange,
  requireOwner,
  channelMemberOptions,
  blockedMemberOptions,
  REGIONS,
  PREFIX
};
