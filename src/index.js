import './runtime/canonicalDataRoot.js';
import 'dotenv/config';
import fs from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  Client,
  ChannelType,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  Partials,
  ActivityType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelFlagsBitField,
  Routes,
  PermissionFlagsBits
} from 'discord.js';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';

import { feature as moderationFeature } from './features/moderation.js';
import { feature as welcomeFarewellFeature } from './features/welcomeFarewell.js';
import { feature as autoresponderFeature } from './features/autoResponder.js';
import { feature as aiChatFeature } from './features/aiChat.js';
import { feature as customRichPresenceFeature } from './features/customRichPresence.js';
import { feature as levelsFeature } from './features/levels.js';
import {
  applyActivityRacePanelDesign,
  createActivityRaceRoleSet,
  feature as activityRaceFeature,
  getActivityRaceSnapshot,
  previewActivityRaceRoleSet,
  refreshActivityRace
} from './features/activityRace.js';
import { feature as ticketsFeature } from './features/tickets.js';
import { feature as loggingFeature } from './features/logging.js';
import { feature as autoRoleFeature } from './features/autoRole.js';
import {
  feature as serverTagTrackerFeature,
  getServerTagTrackerSnapshot,
  queueServerTagReconcile
} from './features/serverTagTracker.js';
import {
  feature as forumCleanerFeature,
  getForumCleanerSnapshot,
  queueForumDeepScan
} from './features/forumCleaner.js';
import {
  applySteamWorkshopItemDesign,
  applySteamWorkshopDesign,
  feature as steamWorkshopFeature,
  getSteamWorkshopSnapshot,
  removeSteamWorkshopBannerAsset,
  removeSteamWorkshopItemBannerAsset,
  resetSteamWorkshopItemDesign,
  saveSteamWorkshopBannerAsset,
  saveSteamWorkshopItemBannerAsset,
  syncSteamWorkshop
} from './features/steamWorkshop.js';
import {
  applyEmojiRenamePlan,
  createEmojiRenamePreview,
  feature as emojiManagerFeature,
  getEmojiManagerSnapshot
} from './features/emojiManager.js';
import { feature as voiceChatCleanerFeature, getVoiceChatCleanerSnapshot } from './features/voiceChatCleaner.js';
import {
  createServerStructureBackup,
  feature as serverBackupFeature,
  listServerStructureBackups,
  previewServerStructureRestore,
  restoreServerStructureBackup
} from './features/serverBackup.js';
import {
  feature as boostRolesFeature,
  getBoostStatusSnapshot,
  importBoostActivityList,
  previewBoostActivityImport,
  startBoostRoleReconcile,
  updateBoostBaselineMember,
  verifyBoostCount as verifyBoostCountFromDiscord
} from './features/boostRoles.js';
import {
  buildHeavenEconomyComponents,
  feature as heavenEconomyFeature,
  getHeavenEconomyAdminSnapshot,
  reconcileHeavenEconomyBoostMilestones,
  updateHeavenEconomyAccount
} from './features/heavenEconomy.js';
import { getBoostSystemIndexStatus } from './features/boostSystemIndex.js';
import { feature as serverContextFeature, getServerSystemEvents, startServerSystemEventBackfill } from './features/serverContext.js';
import { getServerIndexChannelPage } from './serverIndexStore.js';
import { feature as antiraidFeature } from './features/antiraid.js';
import { feature as memberManagementFeature, ensureMemberActivityIndex, getIndexedChannelMessageCount, getIndexedMemberIntelligence, getIndexedMemberIntelligenceStatus } from './features/memberManagement.js';
import {
  defaultGuildConfig,
  featureCards as configuredFeatureCards,
  normalizeConfig
} from './defaultConfig.js';
import {
  initializeStorage,
  getGuildConfig,
  setGuildConfig,
  getAllGuildConfigs
} from './storage.js';
import { migrateDataGenerationV4 } from './runtime/dataGenerationV4.js';
import { atomicWriteJson } from './runtime/atomicJsonStore.js';
import { mountDashboard } from './dashboard.js';
import { getLiveDiagnosticsSnapshot, recordDiagnosticError, runTrackedOperation } from './runtime/liveDiagnostics.js';
import { createFeatureDispatcher } from './runtime/featureDispatcher.js';
import { createModuleReadinessSnapshot } from './runtime/moduleReadiness.js';

const resolveProjectRoot = () => {
  const configuredRoot = String(process.env.FALLEN_HEAVEN_APP_ROOT || '').trim();
  if (configuredRoot) {
    return path.resolve(configuredRoot);
  }

  const cwd = path.resolve(process.cwd());
  if (existsSync(path.join(cwd, 'package.json'))) {
    return cwd;
  }

  const execDir = path.dirname(path.resolve(process.execPath || ''));
  const parent = path.dirname(execDir);
  if (existsSync(path.join(parent, 'package.json'))) {
    return parent;
  }

  return cwd;
};

const APP_ROOT = resolveProjectRoot();
const APP_VERSION = (() => {
  try {
    const packageJson = JSON.parse(readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8'));
    return String(packageJson?.version || '5.1.0');
  } catch (_error) {
    return '5.1.0';
  }
})();

const featureCards = configuredFeatureCards;
const FORUM_LIKE_CHANNEL_TYPES = new Set([ChannelType.GuildForum, ChannelType.GuildMedia]);
const THREAD_CHANNEL_TYPES = new Set([ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread]);
const isForumLikeChannel = (channel) => FORUM_LIKE_CHANNEL_TYPES.has(Number(channel?.type));
const isThreadChannel = (channel) => Boolean(channel?.isThread?.()) || THREAD_CHANNEL_TYPES.has(Number(channel?.type));
const channelHasFlag = (channel, flagName, fallbackValue) => {
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
const forumChannelRequiresTag = (channel) => Boolean(isForumLikeChannel(channel) && channelHasFlag(channel, 'RequireTag', 16));
const isSelectableTextChannel = (channel) => Boolean(
  channel
  && channel.type !== ChannelType.GuildCategory
  && (channel.isTextBased?.() || isForumLikeChannel(channel) || isThreadChannel(channel))
);

const features = [
  moderationFeature,
  welcomeFarewellFeature,
  autoresponderFeature,
  aiChatFeature,
  customRichPresenceFeature,
  levelsFeature,
  activityRaceFeature,
  ticketsFeature,
  loggingFeature,
  autoRoleFeature,
  serverTagTrackerFeature,
  forumCleanerFeature,
  steamWorkshopFeature,
  emojiManagerFeature,
  voiceChatCleanerFeature,
  serverBackupFeature,
  boostRolesFeature,
  heavenEconomyFeature,
  serverContextFeature,
  antiraidFeature,
  memberManagementFeature
];

const commands = features.flatMap((feature) => feature.commands || []);

const app = express();
const PORT = Number(process.env.DASHBOARD_PORT || process.env.PORT || 3000);
const PUBLIC_DIR = path.join(APP_ROOT, 'public');
const FALLEN_HEAVEN_LOCAL_DOMAINS = new Set([
  'fallen-heaven-discord-server.de',
  'www.fallen-heaven-discord-server.de'
]);
const FALLEN_HEAVEN_CANONICAL_PATH = '/fallen-heaven/';
const FALLEN_HEAVEN_LEGACY_HTML_PATHS = new Set([
  '/fallen-heaven.html',
  '/discord-supplied.html',
  '/discord-original.html',
  '/discord-supplied',
  '/discord-original'
]);
const DATA_DIR = process.env.FALLEN_HEAVEN_DATA_DIR || path.join(APP_ROOT, 'data');
const REACTION_ROLE_RULES_FILE = path.join(DATA_DIR, 'reaction-role-rules.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
// Installed applications live in a read-only package. All mutable runtime
// state therefore belongs in the per-user runtime directory supplied by the
// desktop supervisor.
const RUNTIME_DIR = path.resolve(
  String(process.env.FALLEN_HEAVEN_RUNTIME_DIR || '').trim() || path.join(APP_ROOT, 'runtime')
);
const BOT_LOCK_FILE = path.join(RUNTIME_DIR, 'bot.lock');
const LOCAL_CERT_DIR = path.join(RUNTIME_DIR, 'certs');
const LOCAL_HTTPS_PFX = path.join(LOCAL_CERT_DIR, 'fallen-heaven-local.pfx');
const LOCAL_HTTPS_PFX_PASSWORD = process.env.LOCAL_HTTPS_PFX_PASSWORD || 'fallen-heaven-local';
const AI_MEMORY_DIR = path.join(DATA_DIR, 'ai-memory');
const AI_MEMORY_TOMBSTONES_FILE = path.join(AI_MEMORY_DIR, 'tombstones.json');
const MEMBER_INTELLIGENCE_DIRS = [
  path.join(DATA_DIR, 'member-intelligence-v4'),
  path.join(DATA_DIR, 'member-intelligence-v5')
];
const execFileAsync = promisify(execFile);
const BOTCTL_FALLBACK_SCRIPT = path.join(process.cwd(), 'botctl.cjs');
const botctlExecutableName = process.platform === 'win32' ? 'botctl.exe' : 'botctl';
let processCpuSnapshot = { usage: process.cpuUsage(), at: process.hrtime.bigint() };

const isProcessRunning = (pid) => {
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const readBotLockPid = () => {
  if (!existsSync(BOT_LOCK_FILE)) {
    return null;
  }

  const raw = readFileSync(BOT_LOCK_FILE, 'utf8').trim();
  try {
    const data = JSON.parse(raw);
    const pid = Number.parseInt(String(data?.pid || ''), 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) ? pid : null;
  }
};

const releaseSingleInstanceLock = () => {
  const lockedPid = readBotLockPid();
  if (lockedPid === process.pid && existsSync(BOT_LOCK_FILE)) {
    rmSync(BOT_LOCK_FILE);
  }
};

const acquireSingleInstanceLock = () => {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const lockedPid = readBotLockPid();
  if (lockedPid && lockedPid !== process.pid && isProcessRunning(lockedPid)) {
    console.error(`Bot läuft bereits (PID ${lockedPid}). Zweite Instanz wird beendet.`);
    process.exit(0);
  }

  writeFileSync(
    BOT_LOCK_FILE,
    JSON.stringify(
      {
        pid: process.pid,
        root: APP_ROOT,
        startedAt: new Date().toISOString()
      },
      null,
      2
    ),
    'utf8'
  );
};

acquireSingleInstanceLock();

process.once('exit', releaseSingleInstanceLock);
process.once('SIGINT', () => {
  releaseSingleInstanceLock();
  process.exit(0);
});
process.once('SIGTERM', () => {
  releaseSingleInstanceLock();
  process.exit(0);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.AutoModerationConfiguration,
    GatewayIntentBits.AutoModerationExecution,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember, Partials.Reaction, Partials.User]
});

let reactionRoleRulesLoaded = false;
let reactionRoleRules = [];

const loadReactionRoleRules = async () => {
  if (reactionRoleRulesLoaded) return reactionRoleRules;
  reactionRoleRulesLoaded = true;
  try {
    const parsed = JSON.parse(await fs.readFile(REACTION_ROLE_RULES_FILE, 'utf8'));
    reactionRoleRules = Array.isArray(parsed?.rules) ? parsed.rules : [];
  } catch {
    reactionRoleRules = [];
  }
  return reactionRoleRules;
};

const persistReactionRoleRules = async () => {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const temporary = `${REACTION_ROLE_RULES_FILE}.tmp`;
  await fs.writeFile(temporary, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), rules: reactionRoleRules }, null, 2), 'utf8');
  await fs.rename(temporary, REACTION_ROLE_RULES_FILE);
};

const configCache = new Map();
const backupAt = new Map();
const memberActivityAt = new Map();
const memberMessageActivity = new Map();
const memberActivityDataDir = path.join(process.env.FALLEN_HEAVEN_DATA_DIR || path.join(process.cwd(), 'data'), 'member-activity');
const memberActivityDataFile = path.join(memberActivityDataDir, 'last-messages.json');
let memberActivityLoaded = false;
let memberActivityTrackingSince = new Date().toISOString();
let memberActivitySaveTimer = null;
const channelMessageCounterFile = path.join(DATA_DIR, 'channel-message-counters.json');
const channelMessageCounters = new Map();
const channelMessageCounterTimers = new Map();
const channelTopicWriteGuards = new Map();
// Channel topics are metadata and use a much stricter Discord REST bucket than
// normal messages. The counter stays live internally; only the newest desired
// topic is written in a safe interval so no outdated requests can queue up.
// Count every message immediately, but write the visible Discord channel topic
// much less often. Discord's channel metadata bucket is stricter than normal
// messages; 5 minutes is the fastest selectable mode, 10 minutes is the safer
// default. If Discord returns retry_after, that value wins.
const CHANNEL_TOPIC_SYNC_MIN_MS = 5 * 60_000;
const CHANNEL_TOPIC_SYNC_DEFAULT_MS = 10 * 60_000;
const CHANNEL_TOPIC_SYNC_MAX_MS = 60 * 60_000;
const CHANNEL_TOPIC_RETRY_MS = 5 * 60_000;
const normalizeChannelTopicSyncIntervalMs = (value) => {
  const parsed = Math.trunc(Number(value || 0));
  if (!Number.isFinite(parsed) || parsed <= 0) return CHANNEL_TOPIC_SYNC_DEFAULT_MS;
  return Math.min(CHANNEL_TOPIC_SYNC_MAX_MS, Math.max(CHANNEL_TOPIC_SYNC_MIN_MS, parsed));
};
const getChannelTopicSyncIntervalMs = (state) => normalizeChannelTopicSyncIntervalMs(state?.syncIntervalMs);
const extractDiscordRetryAfterMs = (error) => {
  const rawCandidates = [
    error?.retryAfter,
    error?.rawError?.retry_after,
    error?.data?.retry_after,
    error?.response?.data?.retry_after,
    error?.response?.headers?.get?.('retry-after'),
    error?.response?.headers?.get?.('x-ratelimit-reset-after'),
    error?.headers?.['retry-after'],
    error?.headers?.['x-ratelimit-reset-after']
  ];
  for (const raw of rawCandidates) {
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) return Math.ceil(value > 1000 ? value : value * 1000);
  }
  return 0;
};
let channelMessageCounterReconcileTimer = null;
let channelMessageCountersLoaded = false;
let channelMessageCountersLoadPromise = null;
let channelMessageCounterSaveTimer = null;
let channelMessageCounterSaveChain = Promise.resolve();
const emojiLibraryFile = path.join(DATA_DIR, 'emoji-library.json');
const emojiLibraryDir = path.join(DATA_DIR, 'emoji-library');
const emojiLibraryMappings = new Map();
let emojiLibraryLoaded = false;
let emojiLibrarySaveChain = Promise.resolve();
let activePresenceConfig = null;
const loopState = {
  presenceTimer: null,
  backupTimer: null
};

const memberActivityKey = (guildId, userId) => `${String(guildId || '')}:${String(userId || '')}`;
const recordMemberActivity = (guildId, userId, timestamp = Date.now()) => {
  if (!guildId || !userId) return;
  memberActivityAt.set(memberActivityKey(guildId, userId), Number(timestamp || Date.now()));
};

const ensureMemberActivityLoaded = async () => {
  if (memberActivityLoaded) return;
  memberActivityLoaded = true;
  try {
    const stored = JSON.parse(await fs.readFile(memberActivityDataFile, 'utf8'));
    memberActivityTrackingSince = String(stored.trackingSince || memberActivityTrackingSince);
    for (const [key, value] of Object.entries(stored.members || {})) {
      if (value && typeof value === 'object') memberMessageActivity.set(key, value);
    }
  } catch {
    await fs.mkdir(memberActivityDataDir, { recursive: true }).catch(() => {});
  }
};

const saveMemberActivitySoon = () => {
  clearTimeout(memberActivitySaveTimer);
  memberActivitySaveTimer = setTimeout(async () => {
    const temporary = `${memberActivityDataFile}.tmp`;
    const payload = JSON.stringify({
      version: 1,
      trackingSince: memberActivityTrackingSince,
      updatedAt: new Date().toISOString(),
      members: Object.fromEntries(memberMessageActivity)
    });
    await fs.mkdir(memberActivityDataDir, { recursive: true }).catch(() => {});
    await fs.writeFile(temporary, payload, 'utf8').then(() => fs.rename(temporary, memberActivityDataFile)).catch(() => {});
  }, 1200);
};

const CHANNEL_MESSAGE_COUNT_PATTERN = /(?:\d{1,3}(?:[.\u00a0 ]\d{3})+|\d+)(?=\s+versendete Nachrichten\b)/iu;
const CHANNEL_MESSAGE_TOKEN_PATTERN = /\{chat\.count(?:\.([^}]+))?\}/giu;
const CUSTOM_EMOJI_PATTERN = /<(a?):([a-zA-Z0-9_]{2,32}):(\d+)>/g;
const channelMessageCounterKey = (guildId, channelId) => `${String(guildId || '')}:${String(channelId || '')}`;
const markChannelTopicWrite = (guildId, channelId, topic) => {
  const key = channelMessageCounterKey(guildId, channelId);
  const now = Date.now();
  const guard = channelTopicWriteGuards.get(key) || { topics: new Map() };
  if (!(guard.topics instanceof Map)) guard.topics = new Map();
  for (const [storedTopic, expiresAt] of guard.topics) {
    if (expiresAt < now) guard.topics.delete(storedTopic);
  }
  guard.topics.set(String(topic || ''), now + 120_000);
  channelTopicWriteGuards.set(key, guard);
};
const consumeChannelTopicWrite = (guildId, channelId, topic) => {
  const key = channelMessageCounterKey(guildId, channelId);
  const guard = channelTopicWriteGuards.get(key);
  if (!guard) return false;
  const now = Date.now();
  if (!(guard.topics instanceof Map)) {
    channelTopicWriteGuards.delete(key);
    return false;
  }
  for (const [storedTopic, expiresAt] of guard.topics) {
    if (expiresAt < now) guard.topics.delete(storedTopic);
  }
  if (!guard.topics.size) channelTopicWriteGuards.delete(key);
  return Number(guard.topics.get(String(topic || '')) || 0) >= now;
};
const escapeCounterTemplatePart = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const matchesRenderedCounterTemplate = (template = '', topic = '') => {
  const tokenPattern = /\{chat\.count(?:\.[^}]+)?\}/giu;
  let cursor = 0;
  let expression = '^';
  let found = false;
  for (const match of String(template || '').matchAll(tokenPattern)) {
    found = true;
    expression += escapeCounterTemplatePart(String(template).slice(cursor, match.index));
    expression += '(?:\\d{1,3}(?:[.\\u00a0 ]\\d{3})*|\\d+)';
    cursor = Number(match.index || 0) + match[0].length;
  }
  if (!found) return false;
  expression += escapeCounterTemplatePart(String(template).slice(cursor)) + '$';
  try { return new RegExp(expression, 'u').test(String(topic || '')); } catch { return false; }
};
const ensureEmojiLibraryLoaded = async () => {
  if (emojiLibraryLoaded) return;
  try {
    const stored = JSON.parse(await fs.readFile(emojiLibraryFile, 'utf8'));
    for (const [key, value] of Object.entries(stored?.mappings || {})) if (value && typeof value === 'object') emojiLibraryMappings.set(key, value);
  } catch {
    await fs.mkdir(emojiLibraryDir, { recursive: true }).catch(() => {});
  }
  emojiLibraryLoaded = true;
};
const persistEmojiLibrary = () => {
  const payload = JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), mappings: Object.fromEntries(emojiLibraryMappings) }, null, 2);
  emojiLibrarySaveChain = emojiLibrarySaveChain.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const temporary = `${emojiLibraryFile}.${process.pid}.tmp`;
    await fs.writeFile(temporary, payload, 'utf8');
    await fs.rm(emojiLibraryFile, { force: true }).catch(() => {});
    await fs.rename(temporary, emojiLibraryFile);
  }).catch((error) => console.warn(`[emoji-library] Bibliothek konnte nicht gespeichert werden: ${error?.message || error}`));
  return emojiLibrarySaveChain;
};
const normalizeEmojiLibraryName = (name, sourceId) => {
  const normalized = String(name || '').replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 28);
  return `${normalized || 'fh_emoji'}_${String(sourceId).slice(-3)}`.slice(0, 32);
};
const localizeChannelTopicEmojis = async (guild, topic) => {
  const sourceTopic = String(topic || '');
  const references = [...sourceTopic.matchAll(CUSTOM_EMOJI_PATTERN)];
  if (!references.length) return sourceTopic;
  await ensureEmojiLibraryLoaded();
  const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
  if (!botMember?.permissions.has(PermissionFlagsBits.ManageGuildExpressions)) {
    throw new Error('Dem Bot fehlt „Ausdrücke erstellen/verwalten“, um fremde Emojis für dieses Kanalthema zu übernehmen.');
  }
  let localized = sourceTopic;
  for (const match of references) {
    const [raw, animatedFlag, originalName, sourceId] = match;
    if (guild.emojis.cache.has(sourceId)) continue;
    const mappingKey = `${guild.id}:${sourceId}`;
    const mapped = emojiLibraryMappings.get(mappingKey);
    let targetEmoji = mapped?.targetId ? guild.emojis.cache.get(String(mapped.targetId)) : null;
    if (!targetEmoji) {
      const animated = animatedFlag === 'a';
      const extension = animated ? 'gif' : 'png';
      const libraryPath = path.join(emojiLibraryDir, `${sourceId}.${extension}`);
      let attachment;
      try {
        attachment = await fs.readFile(libraryPath);
      } catch {
        const response = await fetch(`https://cdn.discordapp.com/emojis/${sourceId}.${extension}?size=128&quality=lossless`);
        if (!response.ok) throw new Error(`Emoji „${originalName}“ konnte nicht von Discord geladen werden (${response.status}).`);
        attachment = Buffer.from(await response.arrayBuffer());
        await fs.mkdir(emojiLibraryDir, { recursive: true });
        await fs.writeFile(libraryPath, attachment);
      }
      targetEmoji = await guild.emojis.create({ attachment, name: normalizeEmojiLibraryName(originalName, sourceId), reason: 'Kanalthema-Emoji für FALLEN HEAVEN lokalisiert' });
      emojiLibraryMappings.set(mappingKey, { sourceId, targetId: targetEmoji.id, name: targetEmoji.name, animated: Boolean(targetEmoji.animated), updatedAt: new Date().toISOString() });
      await persistEmojiLibrary();
    }
    localized = localized.split(raw).join(`<${targetEmoji.animated ? 'a' : ''}:${targetEmoji.name}:${targetEmoji.id}>`);
  }
  return localized;
};
const formatChannelMessageCount = (value) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(Math.max(0, Math.trunc(Number(value || 0))));
const detectChannelMessageCount = (topic = '') => {
  const match = String(topic || '').match(CHANNEL_MESSAGE_COUNT_PATTERN);
  return match ? Math.max(0, Number(String(match[0]).replace(/[^0-9]/g, '')) || 0) : 0;
};
const replaceChannelMessageCount = (topic = '', count = 0) => {
  const source = String(topic || '');
  const matched = CHANNEL_MESSAGE_COUNT_PATTERN.test(source);
  return { matched, topic: matched ? source.replace(CHANNEL_MESSAGE_COUNT_PATTERN, formatChannelMessageCount(count)) : source };
};
const resolveCounterSourceChannel = (guild, targetChannelId, reference = '') => {
  const token = String(reference || '').trim();
  if (!token) return guild.channels.cache.get(String(targetChannelId)) || null;
  const mention = token.match(/^<#(\d+)>$/);
  const id = mention?.[1] || (/^\d+$/.test(token) ? token : '');
  if (id) return guild.channels.cache.get(id) || null;
  const name = token.replace(/^#/, '').trim().toLocaleLowerCase('de-DE');
  return guild.channels.cache.find((channel) => !channel.isThread?.() && String(channel.name || '').toLocaleLowerCase('de-DE') === name) || null;
};
const buildCounterPlaceholders = (guild, targetChannelId, template = '') => {
  const placeholders = [];
  for (const match of String(template || '').matchAll(CHANNEL_MESSAGE_TOKEN_PATTERN)) {
    const source = resolveCounterSourceChannel(guild, targetChannelId, match[1] || '');
    if (!source || !source.isTextBased?.() || source.isThread?.() || isForumLikeChannel(source)) throw new Error(`Zählerkanal „${match[1] || targetChannelId}“ wurde nicht gefunden oder ist kein Server-Textkanal.`);
    placeholders.push({ raw: match[0], sourceChannelId: source.id, sourceChannelName: source.name || source.id });
  }
  return placeholders;
};
const ensureCounterSourceState = (guild, sourceChannelId) => {
  const key = channelMessageCounterKey(guild.id, sourceChannelId);
  let state = channelMessageCounters.get(key);
  if (!state) {
    const source = guild.channels.cache.get(String(sourceChannelId));
    state = {
      guildId: guild.id, channelId: String(sourceChannelId), enabled: false, count: detectChannelMessageCount(source?.topic || ''),
      template: '', placeholders: [], lastMessageId: '', lastAppliedAt: '', lastAttemptAt: '', lastError: '',
      revision: 0, appliedRevision: 0, pendingSince: '', nextSyncAt: '',
      syncIntervalMs: CHANNEL_TOPIC_SYNC_DEFAULT_MS,
      updatedAt: new Date().toISOString()
    };
    channelMessageCounters.set(key, state);
  }
  return state;
};
const renderCounterTopicTemplate = (template = '', placeholders = []) => {
  let rendered = String(template || '');
  for (const placeholder of placeholders) {
    const source = channelMessageCounters.get(channelMessageCounterKey(placeholder.guildId, placeholder.sourceChannelId));
    rendered = rendered.split(placeholder.raw).join(formatChannelMessageCount(source?.count || 0));
  }
  return rendered;
};

const ensureChannelMessageCountersLoaded = async () => {
  if (channelMessageCountersLoaded) return;
  if (channelMessageCountersLoadPromise) return channelMessageCountersLoadPromise;
  channelMessageCountersLoadPromise = (async () => {
    try {
      const stored = JSON.parse(await fs.readFile(channelMessageCounterFile, 'utf8'));
      for (const [key, value] of Object.entries(stored?.counters || {})) {
        if (!value || typeof value !== 'object') continue;
        channelMessageCounters.set(key, {
          guildId: String(value.guildId || ''), channelId: String(value.channelId || ''), enabled: value.enabled === true,
          count: Math.max(0, Math.trunc(Number(value.count || 0))), lastMessageId: String(value.lastMessageId || ''),
          template: String(value.template || ''), placeholders: Array.isArray(value.placeholders) ? value.placeholders : [],
          lastAppliedAt: String(value.lastAppliedAt || ''), lastAttemptAt: String(value.lastAttemptAt || ''),
          lastError: String(value.lastError || ''), revision: Math.max(0, Math.trunc(Number(value.revision || 0))),
          appliedRevision: Math.max(0, Math.trunc(Number(value.appliedRevision || 0))),
          pendingSince: String(value.pendingSince || ''), nextSyncAt: String(value.nextSyncAt || ''),
          syncIntervalMs: normalizeChannelTopicSyncIntervalMs(value.syncIntervalMs),
          updatedAt: String(value.updatedAt || '')
        });
      }
    } catch {
      await fs.mkdir(DATA_DIR, { recursive: true }).catch(() => {});
    } finally {
      channelMessageCountersLoaded = true;
      channelMessageCountersLoadPromise = null;
    }
  })();
  return channelMessageCountersLoadPromise;
};

const persistChannelMessageCounters = () => {
  const payload = JSON.stringify({ version: 2, updatedAt: new Date().toISOString(), counters: Object.fromEntries(channelMessageCounters) }, null, 2);
  channelMessageCounterSaveChain = channelMessageCounterSaveChain.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const temporary = `${channelMessageCounterFile}.${process.pid}.tmp`;
    await fs.writeFile(temporary, payload, 'utf8');
    await fs.rm(channelMessageCounterFile, { force: true }).catch(() => {});
    await fs.rename(temporary, channelMessageCounterFile);
  }).catch((error) => console.warn(`[channel-counter] Zählerstand konnte nicht gespeichert werden: ${error?.message || error}`));
  return channelMessageCounterSaveChain;
};

const saveChannelMessageCountersSoon = () => {
  clearTimeout(channelMessageCounterSaveTimer);
  channelMessageCounterSaveTimer = setTimeout(() => void persistChannelMessageCounters(), 900);
};

const getChannelMessageCounterState = async (guild, channel) => {
  await ensureChannelMessageCountersLoaded();
  const key = channelMessageCounterKey(guild.id, channel.id);
  const stored = channelMessageCounters.get(key);
  const count = stored ? stored.count : detectChannelMessageCount(channel.topic || '');
  const template = stored?.template || '';
  const placeholders = template ? buildCounterPlaceholders(guild, channel.id, template).map((item) => ({ ...item, guildId: guild.id })) : [];
  const preview = template ? renderCounterTopicTemplate(template, placeholders) : String(channel.topic || '');
  const syncIntervalMs = getChannelTopicSyncIntervalMs(stored);
  return {
    enabled: stored?.enabled === true, count, formattedCount: formatChannelMessageCount(count),
    template, preview, hasPlaceholder: placeholders.length > 0, placeholders,
    lastAppliedAt: stored?.lastAppliedAt || '', lastAttemptAt: stored?.lastAttemptAt || '',
    lastError: stored?.lastError || '', updatedAt: stored?.updatedAt || '',
    syncIntervalMs, syncIntervalMinutes: Math.round(syncIntervalMs / 60_000),
    minSyncIntervalMinutes: Math.round(CHANNEL_TOPIC_SYNC_MIN_MS / 60_000),
    maxSyncIntervalMinutes: Math.round(CHANNEL_TOPIC_SYNC_MAX_MS / 60_000),
    revision: Number(stored?.revision || 0), appliedRevision: Number(stored?.appliedRevision || 0),
    syncPending: Number(stored?.revision || 0) > Number(stored?.appliedRevision || 0) || Boolean(stored?.nextSyncAt),
    pendingSince: stored?.pendingSince || '', nextSyncAt: stored?.nextSyncAt || ''
  };
};

const applyChannelMessageCounter = async (guildId, channelId) => {
  await ensureChannelMessageCountersLoaded();
  const key = channelMessageCounterKey(guildId, channelId);
  const state = channelMessageCounters.get(key);
  if (!state?.enabled || !state.template || !state.placeholders?.length) return true;
  const guild = client.guilds.cache.get(String(guildId));
  const channel = guild?.channels.cache.get(String(channelId)) || await guild?.channels.fetch(String(channelId)).catch(() => null);
  if (!channel || channel.isThread?.() || typeof channel.setTopic !== 'function') {
    state.lastError = 'Der Kanal unterstützt kein bearbeitbares Thema.';
    state.updatedAt = new Date().toISOString();
    saveChannelMessageCountersSoon();
    return true;
  }
  const attemptRevision = Math.max(0, Math.trunc(Number(state.revision || 0)));
  const renderedTopic = renderCounterTopicTemplate(state.template, state.placeholders).slice(0, 1024);
  let succeeded = true;
  try {
    state.lastAttemptAt = new Date().toISOString();
    state.nextSyncAt = '';
    if (renderedTopic !== String(channel.topic || '')) {
      markChannelTopicWrite(guildId, channelId, renderedTopic);
      await channel.setTopic(renderedTopic, 'Dynamische Kanalthema-Vorlage');
    }
    state.lastAppliedAt = new Date().toISOString();
    state.appliedRevision = Math.max(Number(state.appliedRevision || 0), attemptRevision);
    state.lastError = '';
    state.updatedAt = state.lastAppliedAt;
  } catch (error) {
    succeeded = false;
    const retryAfterMs = extractDiscordRetryAfterMs(error);
    state.lastError = retryAfterMs
      ? `Discord limitiert Kanalthemen gerade. Nächster Versuch in ca. ${Math.ceil(retryAfterMs / 60_000)} Min.`
      : `Discord-Aktualisierung fehlgeschlagen: ${error?.message || error}`;
    state.updatedAt = new Date().toISOString();
    saveChannelMessageCountersSoon();
    return { succeeded: false, stale: false, retryAfterMs };
  }
  saveChannelMessageCountersSoon();
  const latestRenderedTopic = renderCounterTopicTemplate(state.template, state.placeholders).slice(0, 1024);
  return {
    succeeded,
    stale: succeeded && (latestRenderedTopic !== renderedTopic || Number(state.revision || 0) > attemptRevision)
  };
};

const scheduleChannelMessageCounterApply = (guildId, channelId) => {
  const key = channelMessageCounterKey(guildId, channelId);
  const state = channelMessageCounters.get(key);
  if (!state?.enabled) return;
  const existing = channelMessageCounterTimers.get(key);
  if (existing) {
    existing.dirty = true;
    state.pendingSince ||= new Date().toISOString();
    saveChannelMessageCountersSoon();
    return;
  }
  const job = { dirty: true, running: false, timer: null };
  channelMessageCounterTimers.set(key, job);
  const arm = (delay) => {
    const safeDelay = Math.max(1200, Number(delay || 0));
    state.pendingSince ||= new Date().toISOString();
    state.nextSyncAt = new Date(Date.now() + safeDelay).toISOString();
    state.updatedAt = new Date().toISOString();
    saveChannelMessageCountersSoon();
    job.timer = setTimeout(run, safeDelay);
  };
  const run = async () => {
    job.timer = null;
    job.running = true;
    job.dirty = false;
    const result = await applyChannelMessageCounter(guildId, channelId).catch(() => ({ succeeded: false, stale: false }));
    const succeeded = result === true || result?.succeeded === true;
    const stale = result?.stale === true;
    job.running = false;
    if (!succeeded || stale) job.dirty = true;
    if (job.dirty) {
      const retryAfterMs = Math.ceil(Number(result?.retryAfterMs || 0));
      const retryDelay = retryAfterMs > 0 ? Math.max(CHANNEL_TOPIC_RETRY_MS, retryAfterMs + 1000) : CHANNEL_TOPIC_RETRY_MS;
      arm(succeeded ? getChannelTopicSyncIntervalMs(state) : retryDelay);
      return;
    }
    state.pendingSince = '';
    state.nextSyncAt = '';
    state.updatedAt = new Date().toISOString();
    saveChannelMessageCountersSoon();
    if (channelMessageCounterTimers.get(key) === job) channelMessageCounterTimers.delete(key);
  };
  arm(getChannelTopicSyncIntervalMs(state));
};

const trackChannelMessageCount = async (message) => {
  if (!message?.guildId || !message?.channelId) return;
  await ensureChannelMessageCountersLoaded();
  const key = channelMessageCounterKey(message.guildId, message.channelId);
  const sourceState = channelMessageCounters.get(key);
  if (!sourceState || sourceState.lastMessageId === String(message.id || '')) return;
  sourceState.count = Math.max(0, Math.trunc(Number(sourceState.count || 0))) + 1;
  sourceState.lastMessageId = String(message.id || '');
  sourceState.revision = Math.max(0, Math.trunc(Number(sourceState.revision || 0))) + 1;
  sourceState.pendingSince ||= new Date().toISOString();
  sourceState.updatedAt = new Date().toISOString();
  saveChannelMessageCountersSoon();
  for (const target of channelMessageCounters.values()) {
    if (target.guildId !== message.guildId || !target.enabled) continue;
    if (target.placeholders?.some((item) => String(item.sourceChannelId) === String(message.channelId))) {
      if (target !== sourceState) target.revision = Math.max(0, Math.trunc(Number(target.revision || 0))) + 1;
      target.pendingSince ||= new Date().toISOString();
      target.updatedAt = new Date().toISOString();
      scheduleChannelMessageCounterApply(message.guildId, target.channelId);
    }
  }
};

const reconcileChannelMessageCounters = async () => {
  await ensureChannelMessageCountersLoaded();
  let changed = false;
  for (const target of channelMessageCounters.values()) {
    if (!target?.enabled || !target.guildId || !target.channelId || !target.template || !target.placeholders?.length) continue;
    const guild = client.guilds.cache.get(String(target.guildId));
    if (!guild) continue;
    let targetCountChanged = false;
    for (const placeholder of target.placeholders) {
      const sourceState = ensureCounterSourceState(guild, placeholder.sourceChannelId);
      const indexedCount = await getIndexedChannelMessageCount(guild.id, placeholder.sourceChannelId).catch(() => null);
      if (Number.isFinite(Number(indexedCount)) && Number(indexedCount) > Number(sourceState.count || 0)) {
        sourceState.count = Math.max(0, Math.trunc(Number(indexedCount)));
        sourceState.revision = Math.max(0, Math.trunc(Number(sourceState.revision || 0))) + 1;
        sourceState.updatedAt = new Date().toISOString();
        targetCountChanged = true;
        changed = true;
      }
    }
    if (targetCountChanged) {
      target.revision = Math.max(0, Math.trunc(Number(target.revision || 0))) + 1;
      target.pendingSince ||= new Date().toISOString();
      target.updatedAt = new Date().toISOString();
    }
    const channel = guild.channels.cache.get(String(target.channelId)) || await guild.channels.fetch(String(target.channelId)).catch(() => null);
    if (!channel || channel.isThread?.() || typeof channel.setTopic !== 'function') continue;
    const expectedTopic = renderCounterTopicTemplate(target.template, target.placeholders).slice(0, 1024);
    if (expectedTopic !== String(channel.topic || '') || target.lastError) {
      scheduleChannelMessageCounterApply(target.guildId, target.channelId);
    }
  }
  if (changed) saveChannelMessageCountersSoon();
};

client.once(Events.ClientReady, () => {
  clearInterval(channelMessageCounterReconcileTimer);
  channelMessageCounterReconcileTimer = setInterval(() => {
    void reconcileChannelMessageCounters().catch((error) => {
      console.warn(`[channel-counter] Live-Abgleich fehlgeschlagen: ${error?.message || error}`);
    });
  }, 30_000);
  setTimeout(() => void reconcileChannelMessageCounters().catch(() => {}), 4_000);
});

const recordMemberMessage = async (message) => {
  if (!message.guildId || !message.author?.id || message.author.bot) return;
  await ensureMemberActivityLoaded();
  const key = memberActivityKey(message.guildId, message.author.id);
  const previous = memberMessageActivity.get(key) || {};
  memberMessageActivity.set(key, {
    lastMessageAt: new Date(message.createdTimestamp || Date.now()).toISOString(),
    lastMessageChannelId: String(message.channelId || ''),
    observedMessages: Number(previous.observedMessages || 0) + 1
  });
  saveMemberActivitySoon();
};

const dashboardMemberSyncs = new Map();
const DASHBOARD_MEMBER_SYNC_COOLDOWN = 5 * 60 * 1000;

const syncDashboardMembers = async (guild, force = false) => {
  const existing = dashboardMemberSyncs.get(guild.id) || { lastAttemptAt: 0, promise: null };
  if (existing.promise) {
    if (force) await existing.promise;
    return {
      syncing: true,
      cacheComplete: guild.members.cache.size >= Math.max(1, Number(guild.memberCount || 0) - 5)
    };
  }

  const cacheIsComplete = guild.members.cache.size >= Math.max(1, Number(guild.memberCount || 0) - 5);
  const coolingDown = Date.now() - existing.lastAttemptAt < DASHBOARD_MEMBER_SYNC_COOLDOWN;
  if (cacheIsComplete) return { syncing: false, cacheComplete: true };
  if (!force && coolingDown) return { syncing: false, cacheComplete: false };

  existing.lastAttemptAt = Date.now();
  existing.promise = guild.members.fetch()
    .catch((error) => {
      const code = String(error?.code || error?.name || 'MEMBER_FETCH_FAILED');
      console.warn(`[member-dashboard] Mitglieder-Synchronisation übersprungen (${code}): ${error?.message || error}`);
      return null;
    })
    .finally(() => {
      existing.promise = null;
      dashboardMemberSyncs.set(guild.id, existing);
    });
  dashboardMemberSyncs.set(guild.id, existing);
  if (force) await existing.promise;
  return {
    syncing: !force,
    cacheComplete: guild.members.cache.size >= Math.max(1, Number(guild.memberCount || 0) - 5)
  };
};

client.on('messageCreate', (message) => {
  if (message.guildId && message.author?.id && !message.author.bot) {
    recordMemberActivity(message.guildId, message.author.id, message.createdTimestamp);
    void recordMemberMessage(message).catch((error) => {
      console.warn(`[member-activity] Nachricht konnte nicht erfasst werden: ${error?.message || error}`);
    });
  }
});

const getCachedGuildConfig = async (guildId, guildName = 'Server') => {
  const id = String(guildId || '').trim();
  if (!id) {
    return null;
  }

  const cached = configCache.get(id);
  if (cached) {
    return cached;
  }

  const cfg = await getGuildConfig(id, guildName);
  const normalized = normalizeConfig(cfg);
  configCache.set(id, normalized);
  return normalized;
};

const saveGuildConfig = async (guildId, patch = {}, options = {}) => {
  const updated = await setGuildConfig(guildId, patch, options);
  const normalized = normalizeConfig(updated);
  configCache.set(String(guildId), normalized);
  activePresenceConfig = normalized;
  void applyPresence(normalized).catch((error) => {
    console.error('[config] Presence-Aktualisierung fehlgeschlagen', error);
  });
  const guild = client.guilds.cache.get(String(guildId));
  if (guild) {
    void dispatchHook('onConfigUpdate', { cfg: normalized, client, guild, patch }).catch((error) => {
      console.error(`[config] Live-Abgleich für ${guild.name} fehlgeschlagen`, error);
    });
  }
  return normalized;
};

const getGuildSummaries = () => {
  return client.guilds.cache
    .map((guild) => ({
      id: guild.id,
      name: guild.name,
      memberCount: guild.memberCount,
      ownerId: guild.ownerId,
      icon: guild.icon
        ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`
        : null
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

const getGuildName = (guildId) => {
  const guild = client.guilds.cache.get(String(guildId));
  return guild?.name || 'Server';
};

const getGuildOwnerId = (guildId) => {
  const guild = client.guilds.cache.get(String(guildId));
  return guild?.ownerId || null;
};

const getByPath = (obj, keyPath) => {
  return String(keyPath || '')
    .split('.')
    .reduce((current, key) => (current ? current[key] : undefined), obj);
};

const formatTemplateValue = (value, context = {}) => {
  return String(value || '')
    .replaceAll('{user}', context.userMention || '@User')
    .replaceAll('{username}', context.username || 'Username')
    .replaceAll('{userAvatar}', context.userAvatar || '')
    .replaceAll('{guild}', context.guildName || 'Server')
    .replaceAll('{level}', String(context.level || 1))
    .replaceAll('{memberCount}', String(context.memberCount || 0));
};

const parseEmbedColor = (value) => {
  const normalized = String(value || '#27c4e8').replace('#', '').trim();
  const parsed = Number.parseInt(normalized, 16);
  return Number.isFinite(parsed) ? parsed : 0x27c4e8;
};

const discordEmbedTextLength = (value) => String(value || '').length;

const validateDiscordEmbedSources = (sources = []) => {
  if (sources.length > 10) {
    throw new Error('Discord erlaubt maximal 10 Embeds pro Nachricht.');
  }

  let totalCharacters = 0;
  sources.forEach((embedData = {}, index) => {
    const label = `Embed ${index + 1}`;
    const fields = Array.isArray(embedData.fields) ? embedData.fields : [];
    const values = [
      ['Titel', embedData.title, 256],
      ['Beschreibung', embedData.description, 4096],
      ['Autor', embedData.authorName, 256],
      ['Footer', embedData.footerText, 2048]
    ];
    values.forEach(([name, value, maximum]) => {
      const length = discordEmbedTextLength(value);
      totalCharacters += length;
      if (length > maximum) throw new Error(`${label}: ${name} darf maximal ${maximum.toLocaleString('de-DE')} Zeichen enthalten.`);
    });
    if (fields.length > 25) throw new Error(`${label}: Discord erlaubt maximal 25 Felder.`);
    fields.forEach((field = {}, fieldIndex) => {
      const nameLength = discordEmbedTextLength(field.name);
      const valueLength = discordEmbedTextLength(field.value);
      totalCharacters += nameLength + valueLength;
      if (nameLength > 256) throw new Error(`${label}, Feld ${fieldIndex + 1}: Der Name darf maximal 256 Zeichen enthalten.`);
      if (valueLength > 1024) throw new Error(`${label}, Feld ${fieldIndex + 1}: Der Wert darf maximal 1.024 Zeichen enthalten.`);
    });
  });

  if (totalCharacters > 6000) {
    throw new Error('Alle Embeds zusammen dürfen maximal 6.000 Zeichen enthalten.');
  }
};

const buildSingleEmbedPayload = (template = {}, guild) => {
  const context = {
    guildName: guild?.name || 'Server',
    memberCount: guild?.memberCount || 0,
    userMention: '@User',
    username: 'Username',
    userAvatar: guild?.iconURL?.({ size: 256 }) || ''
  };
  const embedData = template.embed || {};
  const outsideImage = formatTemplateValue(template.outsideImageUrl || embedData.outsideImageUrl, context);
  const outsideImageName = String(template.outsideImageName || embedData.outsideImageName || 'fallen-heaven-image.png');
  const embed = new EmbedBuilder().setColor(parseEmbedColor(embedData.color));
  const title = formatTemplateValue(embedData.title, context).slice(0, 256);
  const description = formatTemplateValue(embedData.description, context).slice(0, 4096);
  if (title) {
    embed.setTitle(title);
  }
  const titleUrl = formatTemplateValue(embedData.url, context);
  if (title && /^https?:\/\//i.test(titleUrl)) {
    embed.setURL(titleUrl);
  }
  if (description) {
    embed.setDescription(description);
  }

  const authorName = formatTemplateValue(embedData.authorName, context).slice(0, 256);
  const authorIcon = formatTemplateValue(embedData.authorIconUrl, context);
  if (authorName) {
    embed.setAuthor({ name: authorName, iconURL: authorIcon || undefined });
  }

  const thumbnail = formatTemplateValue(embedData.thumbnailUrl, context);
  const image = formatTemplateValue(embedData.imageUrl, context);
  if (thumbnail && /^https?:\/\//i.test(thumbnail)) {
    embed.setThumbnail(thumbnail);
  }
  if (image && /^https?:\/\//i.test(image)) {
    embed.setImage(image);
  }

  const footerText = formatTemplateValue(embedData.footerText, context).slice(0, 2048);
  const footerIcon = formatTemplateValue(embedData.footerIconUrl, context);
  if (footerText) {
    embed.setFooter({ text: footerText, iconURL: footerIcon || undefined });
  }

  if (embedData.timestamp) {
    embed.setTimestamp(new Date());
  }

  const fields = Array.isArray(embedData.fields) ? embedData.fields : [];
  const normalizedFields = fields
    .map((field) => ({
      name: formatTemplateValue(field?.name, context).slice(0, 256) || '\u200b',
      value: formatTemplateValue(field?.value, context).slice(0, 1024) || '\u200b',
      inline: Boolean(field?.inline)
    }))
    .slice(0, 25);

  if (normalizedFields.length) {
    embed.addFields(normalizedFields);
  }

  const contentParts = [formatTemplateValue(template.content, context)];
  if (outsideImage && /^https?:\/\//i.test(outsideImage)) {
    contentParts.push(outsideImage);
  }

  const dataImageMatch = outsideImage.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([a-z0-9+/=\r\n]+)$/i);
  const outsideFile = dataImageMatch ? Buffer.from(dataImageMatch[2], 'base64') : null;
  if (outsideFile && outsideFile.length > 25 * 1024 * 1024) {
    throw new Error('Das Außenbild darf maximal 25 MB groß sein.');
  }
  const safeFileName = outsideImageName.replace(/[^a-z0-9._-]/gi, '_').slice(-120) || 'fallen-heaven-image.png';

  return {
    content: contentParts.filter(Boolean).join('\n'),
    embeds: [embed],
    files: outsideFile ? [{ attachment: outsideFile, name: safeFileName }] : [],
    attachments: template.removeOutsideImage === true || outsideFile ? [] : undefined
  };
};

const buildEmbedPayload = (template = {}, guild) => {
  const sources = Array.isArray(template.embeds) && template.embeds.length
    ? template.embeds
    : [template.embed || {}];
  validateDiscordEmbedSources(sources);
  const primary = buildSingleEmbedPayload({ ...template, embed: sources[0] }, guild);
  if (primary.content.length > 2000) {
    throw new Error('Die Nachricht über dem Embed darf einschließlich Bild-Link maximal 2.000 Zeichen enthalten.');
  }
  return {
    content: primary.content,
    embeds: sources.map((embed) => buildSingleEmbedPayload({ ...template, embed }, guild).embeds[0]),
    files: primary.files || [],
    attachments: primary.attachments
  };
};

const getTextChannel = async (guild, channelId) => {
  if (!guild || !channelId) {
    return null;
  }

  const id = String(channelId);
  let channel = guild.channels.cache.get(id) || (await guild.channels.fetch(id).catch(() => null));
  if (!channel) {
    channel = await client.channels.fetch(id).catch(() => null);
  }
  if (!channel?.isTextBased?.() || typeof channel.send !== 'function') {
    return null;
  }

  if (channel.isThread?.()) {
    if (channel.archived) {
      if (channel.locked && !channel.manageable) {
        throw new Error('Thread ist archiviert und gesperrt. Der Bot braucht "Threads verwalten", um ihn wieder zu öffnen.');
      }
      await channel.setArchived(false, 'FALLEN HEAVEN Embed Studio Versand').catch((error) => {
        throw new Error(`Thread konnte nicht geöffnet werden: ${error?.message || 'fehlende Berechtigung'}`);
      });
    }

    if (!channel.joined && channel.joinable && typeof channel.join === 'function') {
      await channel.join().catch((error) => {
        throw new Error(`Bot konnte dem Thread nicht beitreten: ${error?.message || 'fehlende Berechtigung'}`);
      });
    }

    if (channel.sendable === false) {
      throw new Error('Bot darf in diesem Thread nicht schreiben. Prüfe "Thread anzeigen", "Nachrichten in Threads senden" und bei privaten Threads die Thread-Mitgliedschaft.');
    }
  }

  return channel;
};

const dashboardOrderCollator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

const discordPosition = (entry, fallback = 0) => {
  const value = Number(entry?.rawPosition ?? entry?.position ?? fallback);
  return Number.isFinite(value) ? value : fallback;
};

const compareDiscordNames = (left, right) =>
  dashboardOrderCollator.compare(String(left?.name || left?.id || ''), String(right?.name || right?.id || ''));

const compareDiscordIds = (left, right) => {
  const leftId = String(left?.id || '');
  const rightId = String(right?.id || '');
  if (/^\d+$/.test(leftId) && /^\d+$/.test(rightId)) {
    const delta = BigInt(leftId) - BigInt(rightId);
    return delta < 0n ? -1 : delta > 0n ? 1 : 0;
  }
  return leftId.localeCompare(rightId, 'en', { numeric: true });
};

const dashboardChannelSortBucket = (channel) => {
  const type = Number(channel?.type);
  if (channel?.isCategory || type === ChannelType.GuildCategory) return 0;
  if (channel?.isThread || THREAD_CHANNEL_TYPES.has(type)) return 2;
  if (channel?.isVoice || type === ChannelType.GuildVoice || type === ChannelType.GuildStageVoice) return 10;
  if (channel?.isForumLike || channel?.isText || type === ChannelType.GuildText || type === ChannelType.GuildAnnouncement || type === ChannelType.GuildForum || type === ChannelType.GuildMedia) return 1;
  return 5;
};

const compareDiscordRoleHierarchy = (left, right) => {
  if (typeof left?.comparePositionTo === 'function') {
    const delta = right.comparePositionTo(left);
    if (delta) return delta;
  }
  const delta = discordPosition(right) - discordPosition(left);
  if (delta) return delta;
  return compareDiscordIds(left, right) || compareDiscordNames(left, right);
};

const compareTopLevelDashboardChannels = (left, right) => {
  const leftPosition = discordPosition(left);
  const rightPosition = discordPosition(right);
  if (leftPosition !== rightPosition) return leftPosition - rightPosition;
  return compareDiscordIds(left, right) || compareDiscordNames(left, right);
};

const compareDashboardCategoryChildren = (left, right) => {
  const leftPosition = discordPosition(left);
  const rightPosition = discordPosition(right);
  if (leftPosition !== rightPosition) return leftPosition - rightPosition;
  return compareDiscordIds(left, right) || compareDiscordNames(left, right);
};

const compareDashboardChannelRows = (left, right) => {
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

const withDashboardDisplayOrder = (rows) => {
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

const DASHBOARD_CONFIG_CHANNEL_TYPES = new Set([
  ChannelType.GuildText,
  ChannelType.GuildVoice,
  ChannelType.GuildCategory,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildStageVoice,
  ChannelType.GuildForum,
  ChannelType.GuildMedia
]);

const refreshGuildChannels = async (guild, fresh = false) => {
  if (!fresh || !guild?.channels?.fetch) return guild?.channels?.cache;
  try {
    return await guild.channels.fetch();
  } catch (error) {
    console.warn(`[dashboard] Kanalliste für ${guild.id} konnte nicht frisch von Discord geladen werden:`, error?.message || error);
    return guild.channels.cache;
  }
};

const listTextChannels = async (guildId, options = {}) => {
  const guild = client.guilds.cache.get(String(guildId));
  if (!guild) {
    return [];
  }

  const channelCollection = await refreshGuildChannels(guild, options.fresh === true);

  const serializeChannel = (channel) => {
    const isThread = Boolean(channel?.isThread?.());
    const isForumLike = isForumLikeChannel(channel);
    const isCategory = Number(channel?.type) === ChannelType.GuildCategory;
    const isVoice = Number(channel?.type) === ChannelType.GuildVoice || Number(channel?.type) === ChannelType.GuildStageVoice;
    const parentChannel = isThread ? channelCollection.get(String(channel.parentId || '')) : null;
    const category = isThread ? parentChannel?.parent : channel.parent;
    return {
      id: channel.id,
      name: channel.name || channel.id,
      type: channel.type,
      parentId: channel.parentId || null,
      parentName: parentChannel?.name || '',
      position: discordPosition(channel),
      rawPosition: discordPosition(channel),
      parentPosition: discordPosition(parentChannel, discordPosition(channel)),
      categoryId: category?.id || null,
      categoryName: category?.name || 'Ohne Kategorie',
      categoryPosition: discordPosition(category, channel.parentId ? 0 : -1),
      isCategory,
      isThread,
      isForumLike,
      isVoice,
      isText: !isCategory && !isVoice && !isForumLike,
      isMedia: Number(channel.type) === ChannelType.GuildMedia,
      requiresTag: forumChannelRequiresTag(channel),
      availableTags: isForumLike ? Array.from(channel.availableTags?.values?.() || channel.availableTags || []).map((tag) => ({
        id: String(tag.id || ''),
        name: String(tag.name || tag.id || ''),
        moderated: Boolean(tag.moderated),
        emojiId: tag.emojiId ? String(tag.emojiId) : '',
        emojiName: tag.emojiName ? String(tag.emojiName) : ''
      })).filter((tag) => tag.id && tag.name) : [],
      archived: Boolean(channel.archived),
      locked: Boolean(channel.locked),
      createdTimestamp: Number(channel.createdTimestamp || 0),
      sortBucket: dashboardChannelSortBucket(channel)
    };
  };
  const channelRows = channelCollection
    .filter((channel) => DASHBOARD_CONFIG_CHANNEL_TYPES.has(Number(channel?.type)))
    .map(serializeChannel);

  return withDashboardDisplayOrder(channelRows);
};

const messageUrl = (guildId, channelId, messageId) =>
  `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;

const serializeDashboardEmbed = (embed) => ({
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

const serializeDashboardAttachment = (attachment) => ({
  id: attachment.id,
  name: attachment.name || 'Datei',
  url: attachment.url,
  contentType: attachment.contentType || attachment.content_type || '',
  size: attachment.size || 0
});

const serializeDashboardSticker = (sticker) => ({
  id: sticker.id,
  name: sticker.name,
  url: sticker.url || `https://media.discordapp.net/stickers/${sticker.id}.png?size=160`,
  previewUrl: `https://media.discordapp.net/stickers/${sticker.id}.png?size=160`,
  format: sticker.format
});

const serializeDashboardReaction = (reaction) => ({
  emoji: reaction.emoji.toString(),
  id: reaction.emoji.id || '',
  name: reaction.emoji.name || '',
  animated: Boolean(reaction.emoji.animated),
  identifier: reaction.emoji.identifier || reaction.emoji.toString(),
  url: reaction.emoji.imageURL?.({ size: 64, extension: reaction.emoji.animated ? 'gif' : 'png' }) || '',
  count: reaction.count || 0
});

const resolveAvatarFromHash = (userId, avatarHash, options = {}) => {
  const hash = String(avatarHash || '').trim();
  if (!userId || !hash) return null;
  const extension = String(hash.startsWith('a_') ? 'gif' : (options.extension || 'png')).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png';
  const size = Number(options.size || 128);
  const normalizedSize = Number.isFinite(size) && size > 0 ? Math.min(4096, Math.max(16, Math.round(size))) : 128;
  return `https://cdn.discordapp.com/avatars/${String(userId)}/${hash}.${extension}?size=${normalizedSize}`;
};

const isDiscordDefaultAvatarUrl = (value) => {
  const url = String(value || '').toLowerCase();
  if (!url) return false;
  return /https?:\/\/(?:cdn|media)\.discord(app)?\.com\/embed\/avatars\/\d+\.png/.test(url);
};

const normalizeDiscordId = (value) => {
  const candidate = String(value || '').trim();
  return /^\d{15,22}$/.test(candidate) ? candidate : '';
};

const extractMentionIdsFromText = (text = '') => {
  const value = String(text || '');
  return [...new Set([...value.matchAll(/<@!?(\d{15,22})>/g)].map((match) => match[1]).filter(Boolean))];
};

const resolveIndexedUserProfile = async (guild, userId, { allowGuildFetch = true } = {}) => {
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

const resolveIndexedMessageAuthor = async (guild, channel, record, identityCache = new Map()) => {
  const authorId = normalizeDiscordId(record?.authorId);
  const cacheKey = `author:${authorId || String(record?.authorName || '').trim() || record?.id || ''}`;
  const cached = identityCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  let identity = await resolveIndexedUserProfile(guild, authorId, { allowGuildFetch: true });
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

const resolveIndexedMentionProfile = async (guild, mentionId, identityCache = new Map()) => {
  const cacheKey = `mention:${normalizeDiscordId(mentionId)}`;
  const cached = identityCache.get(cacheKey);
  if (cached) return cached;

  const identity = await resolveIndexedUserProfile(guild, mentionId, { allowGuildFetch: true });
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

const resolveDashboardAvatarUrlWithFallback = async (guild, memberOrUser, options = {}) => {
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

const resolveDashboardAvatarUrl = (entity, options = { size: 128 }) => {
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

const serializeDashboardAuthor = async (guild, thread, starter) => {
  if (starter?.author) {
    const avatarUrl = await resolveDashboardAvatarUrlWithFallback(guild, starter.author, { size: 128 });
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
  const avatarUrl = await resolveDashboardAvatarUrlWithFallback(guild, user, { size: 128 });
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

const FORUM_THREAD_PINNED_FLAG = Number(ChannelFlagsBitField?.Flags?.Pinned || 2);

const forumThreadHasPinnedFlag = (thread) => {
  const flags = thread?.flags;
  if (!flags) return false;
  if (typeof flags.has === 'function') {
    try {
      if (flags.has(ChannelFlagsBitField.Flags.Pinned)) return true;
    } catch (_error) {
      // Einige discord.js-Versionen akzeptieren nur Namen, andere nur Bitwerte.
    }
    try {
      if (flags.has('Pinned')) return true;
    } catch (_error) {
      // Fallback auf bitfield-Prüfung darunter.
    }
  }
  const bitfield = Number(flags.bitfield ?? flags);
  return Number.isFinite(bitfield) && (bitfield & FORUM_THREAD_PINNED_FLAG) === FORUM_THREAD_PINNED_FLAG;
};

const isPinnedForumPost = (thread, starter = null) => Boolean(starter?.pinned || thread?.pinned || forumThreadHasPinnedFlag(thread));

const forumPostTimestamp = (post) => Date.parse(post?.createdAt || post?.thread?.createdAt || '') || 0;

const compareDashboardForumPosts = (left, right) => {
  const pinDelta = Number(Boolean(right?.pinned || right?.thread?.pinned)) - Number(Boolean(left?.pinned || left?.thread?.pinned));
  if (pinDelta) return pinDelta;
  const timeDelta = forumPostTimestamp(right) - forumPostTimestamp(left);
  if (timeDelta) return timeDelta;
  return String(left?.name || left?.id || '').localeCompare(String(right?.name || right?.id || ''), 'de', { sensitivity: 'base' });
};

const forumThreadArchiveTimestamp = (thread) =>
  Number(thread?.archivedTimestamp || thread?.archiveTimestamp || thread?.createdTimestamp || Date.parse(thread?.archivedAt || thread?.createdAt || '') || 0);

const forumThreadArchiveCursor = (thread) => {
  const timestamp = forumThreadArchiveTimestamp(thread);
  if (!timestamp) return '';
  return new Date(timestamp).toISOString();
};

const collectDashboardForumThreads = async (channel, limit, before = '') => {
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

const listForumChannelPosts = async ({ guild, channel, options = {}, actorUserId = '' }) => {
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
    const author = await serializeDashboardAuthor(guild, thread, starter);
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

const serializeOutsideImageAttachment = (message) => {
  const values = message?.attachments instanceof Map || typeof message?.attachments?.values === 'function'
    ? [...message.attachments.values()]
    : Array.isArray(message?.attachments)
      ? message.attachments
      : [];
  const attachment = values.find((item) => /^image\/(?:png|jpeg|webp|gif)$/i.test(String(item?.contentType || item?.content_type || '')))
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

const reactionRoleEmojiKey = (value = {}) => {
  const raw = String(value.emoji || '').trim();
  const mention = raw.match(/^<a?:([^:>]+):(\d+)>$/);
  const id = String(value.emojiId || value.id || mention?.[2] || '').trim();
  return id || String(value.emojiName || value.name || value.emoji || '').trim();
};

const reactionRoleEmojiInput = (value = {}) => {
  const raw = String(value.emoji || '').trim();
  const mention = raw.match(/^<a?:([^:>]+):(\d+)>$/);
  const id = String(value.emojiId || value.id || mention?.[2] || '').trim();
  const name = String(value.emojiName || value.name || mention?.[1] || '').trim();
  if (id) return id;
  return raw || name;
};

const normalizeReactionRoleEmojiName = (value) => String(value || '')
  .trim()
  .toLocaleLowerCase('de')
  .replace(/[^a-z0-9äöüß_]+/g, '');

const reactionRoleEmojiCatalog = async (guild) => {
  const guildCollection = await guild.emojis.fetch().catch(() => guild.emojis.cache);
  const applicationCollection = await client.application?.emojis?.fetch?.().catch(() => null);
  return [
    ...Array.from(guildCollection?.values?.() || []),
    ...Array.from(applicationCollection?.values?.() || [])
  ].filter((emoji, index, values) => emoji?.id && values.findIndex((entry) => entry.id === emoji.id) === index);
};

const resolveReactionRoleEmoji = async (guild, entry, catalog) => {
  const requestedId = reactionRoleEmojiKey(entry);
  const requestedName = normalizeReactionRoleEmojiName(entry.emojiName || entry.name || String(entry.emoji || '').match(/^<a?:([^:>]+):\d+>$/)?.[1]);
  let resolved = catalog.find((emoji) => String(emoji.id) === String(requestedId));

  if (!resolved && requestedId) {
    await ensureEmojiLibraryLoaded();
    const mapped = emojiLibraryMappings.get(`${guild.id}:${requestedId}`);
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

const normalizeReactionRoleTemplate = (entries = []) => (Array.isArray(entries) ? entries : [])
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

const configureMessageReactionRoles = async (guild, messageOrChannel, messageOrEntries, maybeEntries = []) => {
  await loadReactionRoleRules();
  const suppliedMessage = messageOrChannel?.id && messageOrChannel?.channelId && messageOrChannel?.react
    ? messageOrChannel
    : null;
  const channel = suppliedMessage ? suppliedMessage.channel : messageOrChannel;
  const entries = suppliedMessage ? messageOrEntries : maybeEntries;
  const messageId = suppliedMessage ? suppliedMessage.id : messageOrEntries;
  const requested = Array.isArray(entries) ? entries : [];
  const normalized = normalizeReactionRoleTemplate(requested);
  const incomplete = requested
    .map((entry, index) => ({
      index: index + 1,
      emoji: reactionRoleEmojiKey(entry),
      roleId: String(entry?.roleId || '').trim()
    }))
    .filter((entry) => !entry.emoji || !entry.roleId);
  if (incomplete.length) {
    throw new Error(`Reaction Role ${incomplete.map((entry) => entry.index).join(', ')} ist unvollständig. Bitte Emoji und Zielrolle auswählen.`);
  }
  const duplicateEmojiKeys = normalized
    .map(reactionRoleEmojiKey)
    .filter((key, index, keys) => keys.indexOf(key) !== index);
  if (duplicateEmojiKeys.length) {
    throw new Error('Jedes Reaction-Role-Emoji darf pro Nachricht nur einmal verwendet werden.');
  }
  const previous = reactionRoleRules.filter((rule) => rule.guildId === guild.id && rule.messageId === String(messageId));
  const message = suppliedMessage || await channel?.messages?.fetch?.(String(messageId)).catch(() => null);
  if (!message) throw new Error('Die gesendete Nachricht konnte für Reaction Roles nicht erneut geladen werden.');
  const targetChannel = message.channel || channel;
  const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
  const permissions = botMember && targetChannel?.permissionsFor?.(botMember);
  const requiredPermissions = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AddReactions,
    PermissionFlagsBits.ManageMessages
  ];
  if (permissions && !permissions.has(requiredPermissions)) {
    throw new Error('Dem Bot fehlen in diesem Kanal „Kanal ansehen“, „Nachrichtenverlauf anzeigen“ oder „Reaktionen hinzufügen“.');
  }
  const emojiCatalog = await reactionRoleEmojiCatalog(guild);

  const configured = [];
  for (const [index, entry] of normalized.entries()) {
    const role = guild.roles.cache.get(entry.roleId) || await guild.roles.fetch(entry.roleId).catch(() => null);
    if (!role || role.managed || !role.editable) {
      throw new Error(`Die Rolle ${entry.roleId} fehlt, wird von Discord verwaltet oder liegt über der Bot-Rolle.`);
    }
    const resolvedEmoji = await resolveReactionRoleEmoji(guild, entry, emojiCatalog);
    if (!resolvedEmoji.emojiId && /^\d+$/.test(String(resolvedEmoji.input || ''))) {
      throw new Error(`Emoji ${entry.emojiName || entry.emoji || entry.emojiId} ist nicht mehr gültig und es wurde kein gleichnamiger Ersatz gefunden.`);
    }
    configured.push({
      guildId: guild.id,
      channelId: targetChannel.id,
      messageId: String(messageId),
      componentId: `fh_rr:${role.id}:${index}`,
      emojiKey: resolvedEmoji.emojiId || resolvedEmoji.emojiName,
      emojiId: resolvedEmoji.emojiId || '',
      emojiName: resolvedEmoji.emojiName || entry.emojiName || entry.emoji,
      animated: Boolean(resolvedEmoji.animated),
      roleId: role.id,
      roleName: role.name,
      exclusive: entry.exclusive,
      group: `${String(messageId)}:${entry.group}`,
      updatedAt: new Date().toISOString()
    });
  }

  for (const oldRule of previous) {
    const oldReaction = message.reactions.cache.find((reaction) => (reaction.emoji.id || reaction.emoji.name) === oldRule.emojiKey);
    if (oldReaction?.me) await oldReaction.users.remove(client.user.id).catch(() => {});
  }
  if (configured.length > 20) throw new Error('Discord erlaubt maximal 20 Reaktionen pro Nachricht.');
  const previousRulesSnapshot = reactionRoleRules;
  reactionRoleRules = reactionRoleRules
    .filter((rule) => !(rule.guildId === guild.id && rule.messageId === String(messageId)))
    .concat(configured);
  try {
    await persistReactionRoleRules();
    // Reaction Roles use native reactions. Preserve unrelated button rows such
    // as a Heaven VIP function set that was attached by the Embed Studio.
    const existingRows = (message.components || []).map((row) => row.toJSON?.() || row);
    const preservedRows = existingRows.map((row) => ({
      ...row,
      components: (row.components || []).filter((component) => !String(component.custom_id || component.customId || '').startsWith('fh_rr:'))
    })).filter((row) => row.components.length);
    if (preservedRows.length !== existingRows.length || existingRows.some((row, index) => (row.components || []).length !== (preservedRows[index]?.components || []).length)) {
      await message.edit({ components: preservedRows });
    }
    for (const rule of configured) {
      await message.react(rule.emojiId || rule.emojiName);
    }
  } catch (error) {
    reactionRoleRules = previousRulesSnapshot;
    await persistReactionRoleRules().catch(() => {});
    for (const rule of configured) {
      const addedReaction = message.reactions.cache.find((reaction) => (reaction.emoji.id || reaction.emoji.name) === rule.emojiKey);
      if (addedReaction?.me) await addedReaction.users.remove(client.user.id).catch(() => {});
    }
    for (const rule of previous) {
      await message.react(rule.emojiId || rule.emojiName).catch(() => {});
    }
    throw new Error(`Reaction Roles konnten nicht dauerhaft angelegt werden: ${error?.message || error}`);
  }
  return configured;
};

const handleReactionRoleChangeUnlocked = async (reaction, user, added) => {
  if (!user || user.bot) return;
  if (reaction.partial) await reaction.fetch().catch(() => null);
  let message = reaction.message;
  if (message?.partial) message = await message.fetch().catch(() => message);
  const guild = message?.guild;
  if (!guild) return;
  await loadReactionRoleRules();
  const emojiKey = reaction.emoji.id || reaction.emoji.name;
  const rule = reactionRoleRules.find((entry) => entry.guildId === guild.id && entry.messageId === message.id && entry.emojiKey === emojiKey);
  if (!rule || rule.inferred === true) return;
  const member = await guild.members.fetch({ user: user.id, force: true })
    .catch(() => guild.members.cache.get(user.id) || null);
  const role = guild.roles.cache.get(rule.roleId) || await guild.roles.fetch(rule.roleId).catch(() => null);
  if (!member || !role || role.managed || !role.editable) {
    await user.send('Die ausgewählte Rolle kann vom Bot momentan nicht verwaltet werden. Bitte informiere das Serverteam.').catch(() => {});
    return;
  }

  if (!added) {
    await member.roles.remove(role, 'Reaction Role entfernt').catch((error) => recordDiagnosticError?.('reaction-role-remove', error));
    return;
  }

  if (rule.exclusive) {
    const related = reactionRoleRules.filter((entry) => entry.guildId === guild.id && entry.group === rule.group && entry.roleId !== rule.roleId);
    const conflictingRoleId = [...new Set(related.map((entry) => entry.roleId))]
      .filter((roleId) => roleId !== rule.roleId)
      .find((roleId) => member.roles.cache.has(roleId));
    if (conflictingRoleId) {
      await reaction.users.remove(user.id).catch(() => {});
      const conflictingRole = guild.roles.cache.get(conflictingRoleId);
      await user.send(`Du kannst nur eine dieser Rollen gleichzeitig besitzen. Wähle zuerst **${conflictingRole?.name || 'deine aktuelle Rolle'}** ab.`).catch(() => {});
      return;
    }
  }
  await member.roles.add(role, 'Reaction Role ausgewählt').catch(async (error) => {
    recordDiagnosticError?.('reaction-role-add', error);
    await user.send(`Die Rolle **${role.name}** konnte nicht vergeben werden. Bitte informiere das Serverteam.`).catch(() => {});
  });
};

const classicReactionRoleQueues = new Map();

const handleReactionRoleChange = async (reaction, user, added) => {
  if (!reaction?.message?.guildId || !user?.id || user.bot) return;
  const lockKey = `${reaction.message.guildId}:${user.id}`;
  const previous = classicReactionRoleQueues.get(lockKey) || Promise.resolve();
  const current = previous
    .catch(() => {})
    .then(() => handleReactionRoleChangeUnlocked(reaction, user, added));
  classicReactionRoleQueues.set(lockKey, current);
  try {
    await current;
  } finally {
    if (classicReactionRoleQueues.get(lockKey) === current) {
      classicReactionRoleQueues.delete(lockKey);
    }
  }
};

const handleReactionRoleButtonUnlocked = async (interaction) => {
  if (!interaction?.isButton?.() || !String(interaction.customId || '').startsWith('fh_rr:')) return false;
  const guild = interaction.guild;
  if (!guild) return false;
  await loadReactionRoleRules();
  const componentMatch = String(interaction.customId || '').match(/^fh_rr:(\d{17,20}):(\d+)$/);
  const storedRule = reactionRoleRules.find((entry) => entry.guildId === guild.id
    && entry.messageId === interaction.message?.id
    && entry.componentId === interaction.customId);
  const rule = storedRule || (componentMatch ? {
    guildId: guild.id,
    messageId: interaction.message?.id,
    componentId: interaction.customId,
    roleId: componentMatch[1],
    roleName: '',
    exclusive: true,
    group: `message:${interaction.message?.id}`
  } : null);
  if (!rule) {
    await interaction.reply({ content: 'Diese Reaction Role ist nicht mehr aktiv. Bitte informiere das Serverteam.', ephemeral: true }).catch(() => {});
    return true;
  }
  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  const role = guild.roles.cache.get(rule.roleId) || await guild.roles.fetch(rule.roleId).catch(() => null);
  if (!member || !role || role.managed || !role.editable) {
    await interaction.reply({ content: 'Diese Rolle kann momentan nicht verwaltet werden.', ephemeral: true }).catch(() => {});
    return true;
  }

  if (member.roles.cache.has(role.id)) {
    await member.roles.remove(role, 'Reaction Role über Button abgewählt');
    await interaction.reply({ content: `Die Rolle **${role.name}** wurde entfernt.`, ephemeral: true });
    return true;
  }

  if (rule.exclusive) {
    const storedRelatedRoleIds = reactionRoleRules.filter((entry) => entry.guildId === guild.id
      && entry.group === rule.group
      && entry.roleId !== rule.roleId)
      .map((entry) => entry.roleId);
    const messageComponentRoleIds = (interaction.message?.components || [])
      .flatMap((row) => row.components || [])
      .map((component) => String(component.customId || '').match(/^fh_rr:(\d{17,20}):(\d+)$/)?.[1])
      .filter((roleId) => roleId && roleId !== rule.roleId);
    const conflictRoleId = [...new Set([...storedRelatedRoleIds, ...messageComponentRoleIds])]
      .find((roleId) => member.roles.cache.has(roleId));
    if (conflictRoleId) {
      const conflictRole = guild.roles.cache.get(conflictRoleId) || await guild.roles.fetch(conflictRoleId).catch(() => null);
      await interaction.reply({
        content: `Du kannst nur eine dieser Rollen gleichzeitig besitzen. Wähle zuerst **${conflictRole?.name || 'deine aktuelle Rolle'}** ab.`,
        ephemeral: true
      });
      return true;
    }
  }

  await member.roles.add(role, 'Reaction Role über Button ausgewählt');
  await interaction.reply({ content: `Du hast jetzt die Rolle **${role.name}**.`, ephemeral: true });
  return true;
};

const reactionRoleInteractionLocks = new Set();
const handleReactionRoleButton = async (interaction) => {
  if (!interaction?.isButton?.() || !String(interaction.customId || '').startsWith('fh_rr:')) return false;
  const lockKey = `${interaction.guildId || 'dm'}:${interaction.user?.id || 'unknown'}`;
  if (reactionRoleInteractionLocks.has(lockKey)) {
    await interaction.reply({
      content: 'Deine vorherige Rollenauswahl wird noch verarbeitet. Bitte warte einen kurzen Moment.',
      ephemeral: true
    }).catch(() => {});
    return true;
  }
  reactionRoleInteractionLocks.add(lockKey);
  try {
    return await handleReactionRoleButtonUnlocked(interaction);
  } finally {
    reactionRoleInteractionLocks.delete(lockKey);
  }
};

const serializeMessagePayload = (payload = {}) => ({
  content: payload.content || undefined,
  embeds: Array.isArray(payload.embeds)
    ? payload.embeds.map((embed) => (typeof embed?.toJSON === 'function' ? embed.toJSON() : embed)).filter(Boolean)
    : [],
  components: Array.isArray(payload.components)
    ? payload.components.map((row) => (typeof row?.toJSON === 'function' ? row.toJSON() : row)).filter(Boolean)
    : [],
  ...(payload.attachments !== undefined ? { attachments: payload.attachments } : {})
});

const serializeMessageFiles = (payload = {}) => (Array.isArray(payload.files) ? payload.files : [])
  .map((file) => {
    const data = Buffer.isBuffer(file?.attachment) ? file.attachment : Buffer.isBuffer(file?.data) ? file.data : null;
    if (!data) return null;
    return {
      data,
      name: String(file.name || 'fallen-heaven-image.png'),
      contentType: file.contentType || undefined
    };
  })
  .filter(Boolean);

const prepareRestMessagePayload = (payload = {}) => {
  const body = serializeMessagePayload(payload);
  const files = serializeMessageFiles(payload);
  if (files.length) {
    body.attachments = files.map((file, index) => ({ id: index, filename: file.name }));
  }
  return { body, files };
};

const sendMessageToChannel = async (guild, channel, payload) => {
  try {
    return await channel.send(payload);
  } catch (error) {
    if (!channel?.isThread?.()) {
      throw error;
    }

    const { body, files } = prepareRestMessagePayload(payload);
    const raw = await client.rest.post(Routes.channelMessages(channel.id), { body, files }).catch((restError) => {
      throw new Error(`Thread-Versand fehlgeschlagen: ${restError?.message || error?.message || 'Discord REST Fehler'}`);
    });
    return {
      id: raw.id,
      channelId: raw.channel_id || channel.id,
      url: messageUrl(guild.id, raw.channel_id || channel.id, raw.id),
      attachments: Array.isArray(raw.attachments) ? raw.attachments : []
    };
  }
};

const editMessageInChannel = async (guild, channel, messageId, payload) => {
  const message = await channel.messages?.fetch?.(String(messageId)).catch(() => null);
  if (message) {
    return message.edit(payload);
  }

  if (!channel?.isThread?.()) {
    throw new Error('Nachricht konnte nicht geladen werden.');
  }

  const { body, files } = prepareRestMessagePayload(payload);
  const raw = await client.rest.patch(Routes.channelMessage(channel.id, String(messageId)), { body, files }).catch((error) => {
    throw new Error(`Thread-Nachricht konnte nicht bearbeitet werden: ${error?.message || 'Discord REST Fehler'}`);
  });
  return {
    id: raw.id,
    channelId: raw.channel_id || channel.id,
    url: messageUrl(guild.id, raw.channel_id || channel.id, raw.id),
    attachments: Array.isArray(raw.attachments) ? raw.attachments : []
  };
};

const getMemberPrimaryRole = (member) => {
  const role = member.roles.cache
    .filter((entry) => entry.id !== member.guild.id)
    .sort((a, b) => b.position - a.position)
    .first();

  return role
    ? {
        id: role.id,
        name: role.name,
        color: role.hexColor && role.hexColor !== '#000000' ? role.hexColor : '#6f75ff'
      }
    : {
        id: '',
        name: 'Member',
        color: '#6f75ff'
      };
};

const listDashboardMembers = async (guildId, options = {}) => {
  const guild = client.guilds.cache.get(String(guildId));
  if (!guild) {
    return null;
  }

  await ensureMemberActivityLoaded();

  const query = String(options.query || '').trim().toLowerCase();
  const pageSize = Math.min(100, Math.max(10, Number(options.pageSize || 40)));
  const page = Math.max(0, Number(options.page || 0));
  const sync = Boolean(options.sync);
  const filter = String(options.filter || 'all').trim().toLowerCase();
  const sort = String(options.sort || 'joined_desc').trim().toLowerCase();

  const memberSync = await syncDashboardMembers(guild, sync);

  const guildConfig = await getCachedGuildConfig(guild.id, guild.name);
  const indexed = await ensureMemberActivityIndex(guild, guildConfig).catch((error) => {
    console.warn(`[member-dashboard] Aktivitätsindex ist vorübergehend nicht verfügbar: ${error?.message || error}`);
    return { activity: {}, status: null };
  });

  const candidateMembers = [...guild.members.cache.values()].filter((member) => {
      const status = member.presence?.status || 'offline';
      const timedOut = Number(member.communicationDisabledUntilTimestamp || 0) > Date.now();
      const isStaff = member.permissions.has(PermissionFlagsBits.Administrator)
        || member.permissions.has(PermissionFlagsBits.ManageGuild)
        || member.permissions.has(PermissionFlagsBits.KickMembers)
        || member.permissions.has(PermissionFlagsBits.BanMembers)
        || member.permissions.has(PermissionFlagsBits.ModerateMembers);
      const filterMatches = filter === 'all'
        || (filter === 'humans' && !member.user.bot)
        || (filter === 'bots' && member.user.bot)
        || (filter === 'online' && status !== 'offline')
        || (filter === 'boosters' && Boolean(member.premiumSince))
        || (filter === 'timedout' && timedOut)
        || (filter === 'staff' && isStaff);
      if (!filterMatches) {
        return false;
      }

      if (!query) {
        return true;
      }

      const haystack = [
        member.id,
        member.user.username,
        member.user.globalName,
        member.displayName,
        member.nickname
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(query);
    });

  // Keep the first paint fast even on large guilds. Building an avatar fallback can
  // involve Discord/API work, so resolve it only for the members on the visible page
  // after filtering and sorting instead of for every cached guild member.
  const rows = candidateMembers.map((member) => {
    const primaryRole = getMemberPrimaryRole(member);
    const status = member.presence?.status || 'offline';
    const observedActivity = memberActivityAt.get(memberActivityKey(guild.id, member.id)) || 0;
    const lastActiveTimestamp = status !== 'offline' ? Date.now() : observedActivity;
    const indexedActivity = indexed.activity?.[member.id] || null;
    const legacyActivity = memberMessageActivity.get(memberActivityKey(guild.id, member.id)) || null;
    const messageActivity = indexedActivity?.lastMessageAt ? indexedActivity : legacyActivity;
    return {
      id: member.id,
      mention: `<@${member.id}>`,
      username: member.user.username,
      displayName: member.displayName || member.user.globalName || member.user.username,
      handle: member.user.tag || member.user.username,
      avatarUrl: '',
      avatar: '',
      joinedAt: member.joinedAt?.toISOString?.() || null,
      createdAt: member.user.createdAt?.toISOString?.() || null,
      isBot: member.user.bot,
      status,
      lastActiveAt: lastActiveTimestamp ? new Date(lastActiveTimestamp).toISOString() : null,
      activityKnown: status !== 'offline' || Boolean(observedActivity),
      lastMessageAt: messageActivity?.lastMessageAt || null,
      lastMessageChannelId: messageActivity?.lastMessageChannelId || null,
      observedMessages: Number(messageActivity?.totalMessages || messageActivity?.observedMessages || 0),
      isBooster: Boolean(member.premiumSince),
      premiumSince: member.premiumSince?.toISOString?.() || null,
      timedOutUntil: member.communicationDisabledUntil?.toISOString?.() || null,
      role: primaryRole,
      roleCount: member.roles.cache.filter((role) => role.id !== guild.id).size
    };
  })
    .sort((a, b) => {
      if (sort === 'name') return a.displayName.localeCompare(b.displayName, 'de', { sensitivity: 'base' });
      if (sort === 'roles') return b.roleCount - a.roleCount || a.displayName.localeCompare(b.displayName, 'de');
      if (sort === 'roles_asc') return a.roleCount - b.roleCount || a.displayName.localeCompare(b.displayName, 'de');
      if (sort === 'account_new') return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      if (sort === 'account_old') return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
      if (sort === 'boosters') return Number(b.isBooster) - Number(a.isBooster) || new Date(a.premiumSince || 0) - new Date(b.premiumSince || 0);
      if (sort === 'activity_desc') return new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0) || a.displayName.localeCompare(b.displayName, 'de');
      if (sort === 'inactivity') {
        const aActivity = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
        const bActivity = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
        return aActivity - bActivity || new Date(a.joinedAt || 0) - new Date(b.joinedAt || 0);
      }
      if (sort === 'joined_asc') return new Date(a.joinedAt || 0) - new Date(b.joinedAt || 0);
      const aDate = a.joinedAt ? new Date(a.joinedAt).getTime() : 0;
      const bDate = b.joinedAt ? new Date(b.joinedAt).getTime() : 0;
      return bDate - aDate;
    });

  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleRows = rows.slice(currentPage * pageSize, currentPage * pageSize + pageSize);
  const visibleMembers = await Promise.all(visibleRows.map(async (row) => {
    const member = guild.members.cache.get(row.id);
    if (!member) return row;
    const avatarUrl = await resolveDashboardAvatarUrlWithFallback(guild, member, { size: 128 });
    return { ...row, avatarUrl, avatar: avatarUrl };
  }));

  return {
    total,
    page: currentPage,
    pageSize,
    pageCount,
    filter,
    sort,
    activityTrackingSince: memberActivityTrackingSince,
    syncedMembers: guild.members.cache.size,
    guildMemberCount: guild.memberCount || 0,
    syncingMembers: Boolean(memberSync?.syncing),
    cacheComplete: Boolean(memberSync?.cacheComplete),
    counts: {
      online: guild.members.cache.filter((member) => (member.presence?.status || 'offline') !== 'offline').size,
      bots: guild.members.cache.filter((member) => member.user.bot).size,
      boosters: guild.members.cache.filter((member) => Boolean(member.premiumSince)).size,
      timedOut: guild.members.cache.filter((member) => Number(member.communicationDisabledUntilTimestamp || 0) > Date.now()).size
    },
    members: visibleMembers,
    indexStatus: indexed.status
  };
};

const getMemberModerationContext = async (guild, member, actorUserId) => {
  const botMember = guild.members.me || (await guild.members.fetchMe().catch(() => null));
  const actor = actorUserId
    ? guild.members.cache.get(String(actorUserId)) || (await guild.members.fetch(String(actorUserId)).catch(() => null))
    : null;
  const actorIsOwner = Boolean(actor && actor.id === guild.ownerId);
  const targetProtected = member.id === guild.ownerId || member.id === actor?.id || member.id === botMember?.id;
  const actorAboveTarget = actorIsOwner || Boolean(actor && actor.roles.highest.comparePositionTo(member.roles.highest) > 0);
  const botAboveTarget = Boolean(botMember && botMember.roles.highest.comparePositionTo(member.roles.highest) > 0);
  const actorHas = (permission) => actorIsOwner || Boolean(actor?.permissions.has(permission));
  const botHas = (permission) => Boolean(botMember?.permissions.has(permission));
  const baseAllowed = Boolean(actor && botMember && !targetProtected && actorAboveTarget && botAboveTarget);

  const roleAllowed = (role) => role
    && role.id !== guild.id
    && !role.managed
    && !role.permissions.has(PermissionFlagsBits.Administrator)
    && botMember.roles.highest.comparePositionTo(role) > 0
    && (actorIsOwner || actor.roles.highest.comparePositionTo(role) > 0);

  return {
    actor,
    botMember,
    actorIsOwner,
    roleAllowed,
    capabilities: {
      timeout: baseAllowed && actorHas(PermissionFlagsBits.ModerateMembers) && botHas(PermissionFlagsBits.ModerateMembers) && member.moderatable,
      kick: baseAllowed && actorHas(PermissionFlagsBits.KickMembers) && botHas(PermissionFlagsBits.KickMembers) && member.kickable,
      ban: baseAllowed && actorHas(PermissionFlagsBits.BanMembers) && botHas(PermissionFlagsBits.BanMembers) && member.bannable,
      roles: baseAllowed && actorHas(PermissionFlagsBits.ManageRoles) && botHas(PermissionFlagsBits.ManageRoles) && member.manageable
    }
  };
};

const enrichMemberIntelligenceWithBoostTimeline = async (guild, member, intelligence = {}) => {
  if (!guild?.id || !member?.id) return intelligence;
  const snapshot = await getBoostStatusSnapshot(guild).catch(() => null);
  const boostEvents = Array.isArray(snapshot?.events) ? snapshot.events : [];
  if (!boostEvents.length) return intelligence;

  const displayName = member.displayName || member.user?.globalName || member.user?.username || 'Das Mitglied';
  const memberEvents = boostEvents
    .filter((event) => String(event.userId || '') === String(member.id))
    .map((event) => {
      const rawType = String(event.type || '');
      const type = rawType === 'boost'
        ? 'boost_started'
        : rawType === 'expired'
          ? 'boost_expired'
          : rawType === 'ended'
            ? 'boost_ended'
            : `boost_${rawType || 'event'}`;
      const createdAt = event.timestamp ? new Date(Number(event.timestamp)).toISOString() : new Date().toISOString();
      const sourceLabel = event.sourceLabel || event.source || 'Boost-Ledger';
      const delta = Number(event.delta || 0);
      const text = type === 'boost_started'
        ? delta > 1
          ? `${displayName} hat ${delta} neue Server-Boosts ausgelöst.`
          : `${displayName} hat einen Server-Boost ausgelöst.`
        : type === 'boost_expired'
          ? `${displayName} boostet laut Boost-Log aktuell nicht mehr.`
          : `${displayName} hat den Server-Boost beendet.`;
      return {
        id: `boost-ledger:${event.messageId || event.channelId || member.id}:${type}:${event.timestamp || ''}`,
        type,
        title: type === 'boost_started'
          ? 'Server-Boost gestartet'
          : type === 'boost_expired'
            ? 'Server-Boost ausgelaufen'
            : 'Server-Boost beendet',
        text,
        createdAt,
        channelId: event.channelId || '',
        source: event.source || 'boost-ledger',
        metadata: {
          source: event.source || 'boost-ledger',
          sourceLabel,
          reason: sourceLabel,
          category: 'boosts',
          label: type === 'boost_started' ? 'Boost aktiv' : 'Boost nicht mehr aktiv',
          boostDelta: delta,
          currentStatus: event.currentStatus || 'unclear',
          boostLedgerMessageId: event.messageId || ''
        }
      };
    });
  if (!memberEvents.length) return intelligence;

  const seen = new Set();
  const systemTimeline = [
    ...(Array.isArray(intelligence.systemTimeline) ? intelligence.systemTimeline : []),
    ...memberEvents
  ]
    .filter((event) => {
      const key = [
        event.metadata?.boostLedgerMessageId || event.id || '',
        event.type || '',
        event.createdAt || '',
        event.channelId || ''
      ].join(':');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
    .slice(0, 240);
  return { ...intelligence, systemTimeline };
};

const getDashboardMember = async (guildId, userId, actorUserId = '', options = {}) => {
  const guild = client.guilds.cache.get(String(guildId));
  if (!guild) {
    return null;
  }

  const member = guild.members.cache.get(String(userId)) || (await guild.members.fetch(String(userId)).catch(() => null));
  if (!member) {
    return null;
  }

  const primaryRole = getMemberPrimaryRole(member);
  const moderation = await getMemberModerationContext(guild, member, actorUserId);
  const roles = member.roles.cache
    .filter((role) => role.id !== guild.id)
    .sort((a, b) => b.position - a.position)
    .map((role) => ({
      id: role.id,
      name: role.name,
      color: role.hexColor && role.hexColor !== '#000000' ? role.hexColor : '#6f75ff',
      removable: moderation.capabilities.roles && moderation.roleAllowed(role)
    }));

  const assignableRoles = guild.roles.cache
    .filter((role) => !member.roles.cache.has(role.id) && moderation.roleAllowed(role))
    .sort((a, b) => b.position - a.position)
    .map((role) => ({
      id: role.id,
      name: role.name,
      color: role.hexColor && role.hexColor !== '#000000' ? role.hexColor : '#6f75ff'
    }));

  const intelligence = await getIndexedMemberIntelligence({
    guild,
    requester: moderation.actor || member,
    userId: member.id,
    retentionDays: 0,
    refresh: options?.refresh === true
  }).catch((error) => ({
    source: 'public-server-index',
    error: error?.message || 'Profilanalyse ist vorübergehend nicht verfügbar.',
    analyzedMessages: 0,
    activeChannels: 0,
    overallConfidence: 0,
    insights: [],
    channels: [],
    links: [],
    media: [],
    evidence: []
  }));
  const enrichedIntelligence = await enrichMemberIntelligenceWithBoostTimeline(guild, member, intelligence);
  const memberAvatarUrl = await resolveDashboardAvatarUrlWithFallback(guild, member, { size: 256 });

  return {
    id: member.id,
    mention: `<@${member.id}>`,
    username: member.user.username,
    displayName: member.displayName || member.user.globalName || member.user.username,
    handle: member.user.tag || member.user.username,
    avatarUrl: memberAvatarUrl,
    avatar: memberAvatarUrl,
    banner: member.user.bannerURL?.({ size: 1024 }) || null,
    joinedAt: member.joinedAt?.toISOString?.() || null,
    createdAt: member.user.createdAt?.toISOString?.() || null,
    isBot: member.user.bot,
    status: member.presence?.status || 'offline',
    premiumSince: member.premiumSince?.toISOString?.() || null,
    timedOutUntil: member.communicationDisabledUntil?.toISOString?.() || null,
    role: primaryRole,
    roles,
    assignableRoles,
    intelligence: enrichedIntelligence,
    capabilities: moderation.capabilities,
    protected: member.id === guild.ownerId || member.id === moderation.actor?.id || member.id === moderation.botMember?.id
  };
};

const getMemberIntelligenceStatus = async (guildId, userId, actorUserId = '') => {
  const guild = client.guilds.cache.get(String(guildId || ''));
  if (!guild) throw new Error('Server wurde nicht gefunden.');
  const requester = guild.members.cache.get(String(actorUserId || ''))
    || await guild.members.fetch(String(actorUserId || '')).catch(() => null);
  if (!requester) throw new Error('Dein Discord-Konto ist auf diesem Server nicht verfügbar.');
  return getIndexedMemberIntelligenceStatus({ guild, requester, userId: String(userId || '') });
};

const moderateDashboardMember = async (guildId, userId, request = {}, actorUserId = '') => {
  const guild = client.guilds.cache.get(String(guildId));
  if (!guild) throw new Error('Server wurde nicht gefunden.');
  const member = guild.members.cache.get(String(userId)) || (await guild.members.fetch(String(userId)).catch(() => null));
  if (!member) throw new Error('Mitglied wurde nicht gefunden.');

  const action = String(request.action || '').trim();
  const reasonText = String(request.reason || '').trim().slice(0, 400);
  const context = await getMemberModerationContext(guild, member, actorUserId);
  if (!context.actor) throw new Error('Dein Discord-Konto ist auf diesem Server nicht mehr verfügbar.');
  const reason = `${reasonText || 'Kein zusätzlicher Grund angegeben'} | Dashboard: ${context.actor.user.tag}`;

  if (action === 'timeout') {
    if (!context.capabilities.timeout) throw new Error('Timeout ist wegen Berechtigungen oder Rollenhierarchie nicht möglich.');
    const allowedMinutes = [10, 60, 1440, 10080, 40320];
    const minutes = allowedMinutes.includes(Number(request.minutes)) ? Number(request.minutes) : 10;
    await member.timeout(minutes * 60_000, reason);
  } else if (action === 'removeTimeout') {
    if (!context.capabilities.timeout) throw new Error('Der Timeout kann wegen Berechtigungen oder Rollenhierarchie nicht entfernt werden.');
    await member.timeout(null, reason);
  } else if (action === 'kick') {
    if (!context.capabilities.kick) throw new Error('Kick ist wegen Berechtigungen oder Rollenhierarchie nicht möglich.');
    await member.kick(reason);
  } else if (action === 'ban') {
    if (!context.capabilities.ban) throw new Error('Ban ist wegen Berechtigungen oder Rollenhierarchie nicht möglich.');
    await guild.members.ban(member.id, { reason, deleteMessageSeconds: 0 });
  } else if (action === 'addRole' || action === 'removeRole') {
    if (!context.capabilities.roles) throw new Error('Rollen dürfen für dieses Mitglied nicht geändert werden.');
    const role = guild.roles.cache.get(String(request.roleId || ''));
    if (!context.roleAllowed(role)) throw new Error('Diese Rolle ist verwaltet, zu hoch oder besitzt Administratorrechte.');
    if (action === 'addRole') await member.roles.add(role, reason);
    else await member.roles.remove(role, reason);
  } else {
    throw new Error('Unbekannte Moderationsaktion.');
  }

  console.log(`[member-dashboard] ${context.actor.user.tag} -> ${action} -> ${member.user.tag} (${guild.name})`);
  const removed = action === 'kick' || action === 'ban';
  return {
    action,
    removed,
    member: removed ? null : await getDashboardMember(guild.id, member.id, context.actor.id)
  };
};

const safeStorageId = (value) => String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_');

const aiMemoryUserDir = (guildId) => path.join(AI_MEMORY_DIR, safeStorageId(guildId), 'users');
const aiMemoryUserFile = (guildId, userId) => path.join(aiMemoryUserDir(guildId), `${safeStorageId(userId)}.json`);
const aiMemoryTombstoneKey = (guildId, userId) => `${safeStorageId(guildId)}:${safeStorageId(userId)}`;
const aiMemoryGuildDir = (guildId) => path.join(AI_MEMORY_DIR, safeStorageId(guildId));

const rewriteJsonLinesWithoutUser = async (fileName, userId) => {
  const raw = await fs.readFile(fileName, 'utf8').catch(() => '');
  if (!raw) return 0;
  let removed = 0;
  const kept = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let value;
    try { value = JSON.parse(line); } catch { kept.push(line); continue; }
    if (String(value?.userId || value?.conversationUserId || '') === String(userId)) {
      removed += 1;
      continue;
    }
    kept.push(JSON.stringify(value));
  }
  if (!removed) return 0;
  const temporary = `${fileName}.purge-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporary, kept.length ? `${kept.join('\n')}\n` : '', 'utf8');
  await fs.rename(temporary, fileName).catch(async () => {
    await fs.rm(fileName, { force: true });
    await fs.rename(temporary, fileName);
  });
  return removed;
};

const readJsonFile = async (fileName, fallback = null) => {
  try {
    const raw = await fs.readFile(fileName, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const aiMemoryIsDeleted = (tombstones, guildId, userId, memory) => {
  const deletedAt = tombstones?.entries?.[aiMemoryTombstoneKey(guildId, userId)]?.deletedAt;
  if (!deletedAt) return false;
  return new Date(deletedAt).getTime() >= new Date(memory?.updatedAt || memory?.createdAt || 0).getTime();
};

const listAiMemories = async (guildId) => {
  const dirName = aiMemoryUserDir(guildId);
  const tombstones = await readJsonFile(AI_MEMORY_TOMBSTONES_FILE, { version: 1, entries: {} });
  let entries = [];
  try {
    entries = await fs.readdir(dirName, { withFileTypes: true });
  } catch {
    return [];
  }

  const memories = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }

    const fileName = path.join(dirName, entry.name);
    const [memory, stat] = await Promise.all([
      readJsonFile(fileName, null),
      fs.stat(fileName).catch(() => null)
    ]);
    if (!memory) {
      continue;
    }
    const userId = String(memory.userId || entry.name.replace(/\.json$/i, ''));
    if (aiMemoryIsDeleted(tombstones, guildId, userId, memory)) continue;

    memories.push({
      userId,
      username: String(memory.username || 'Unbekannt'),
      displayName: String(memory.displayName || memory.username || 'Unbekannt'),
      facts: Array.isArray(memory.facts) ? memory.facts : [],
      messageCount: Number(memory.messageCount || 0),
      updatedAt: memory.updatedAt || stat?.mtime?.toISOString?.() || null,
      size: stat?.size || 0
    });
  }

  return memories.sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
};

const getAiMemory = async (guildId, userId) => {
  const [memory, tombstones] = await Promise.all([
    readJsonFile(aiMemoryUserFile(guildId, userId), null),
    readJsonFile(AI_MEMORY_TOMBSTONES_FILE, { version: 1, entries: {} })
  ]);
  if (!memory || aiMemoryIsDeleted(tombstones, guildId, userId, memory)) {
    return null;
  }

  return {
    ...memory,
    facts: Array.isArray(memory.facts) ? memory.facts : [],
    messages: Array.isArray(memory.messages) ? memory.messages.slice(-80) : []
  };
};

const deleteAiMemory = async (guildId, userId) => {
  const tombstones = await readJsonFile(AI_MEMORY_TOMBSTONES_FILE, { version: 1, entries: {} });
  tombstones.version = Math.max(1, Number(tombstones.version || 0));
  tombstones.entries ||= {};
  tombstones.entries[aiMemoryTombstoneKey(guildId, userId)] = {
    guildId: String(guildId),
    userId: String(userId),
    deletedAt: new Date().toISOString()
  };
  await atomicWriteJson(AI_MEMORY_TOMBSTONES_FILE, tombstones, { backupLimit: 5 });
  await fs.unlink(aiMemoryUserFile(guildId, userId)).catch(() => {});
  const guildDir = aiMemoryGuildDir(guildId);
  let channelEntries = 0;
  let archiveEntries = 0;
  const channelFiles = await fs.readdir(path.join(guildDir, 'channels'), { withFileTypes: true }).catch(() => []);
  for (const entry of channelFiles) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const fileName = path.join(guildDir, 'channels', entry.name);
    const memory = await readJsonFile(fileName, null);
    if (!memory || !Array.isArray(memory.messages)) continue;
    const before = memory.messages.length;
    memory.messages = memory.messages.filter((item) => (
      String(item?.authorId || '') !== String(userId)
      && String(item?.conversationUserId || '') !== String(userId)
    ));
    channelEntries += before - memory.messages.length;
    if (memory.messages.length !== before) {
      memory.updatedAt = new Date().toISOString();
      await atomicWriteJson(fileName, memory, { backupLimit: 2 });
    }
  }
  const archiveFiles = await fs.readdir(path.join(guildDir, 'archive'), { withFileTypes: true }).catch(() => []);
  for (const entry of archiveFiles) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
    archiveEntries += await rewriteJsonLinesWithoutUser(path.join(guildDir, 'archive', entry.name), userId);
  }
  await Promise.all(MEMBER_INTELLIGENCE_DIRS.map((directory) => fs.rm(
    path.join(directory, safeStorageId(guildId), `${safeStorageId(userId)}.json`),
    { force: true }
  ).catch(() => {})));
  return {
    deleted: true,
    userId: String(userId),
    purgedChannelEntries: channelEntries,
    purgedArchiveEntries: archiveEntries,
    purgedDerivedProfile: true
  };
};

const generateEmbedAssistantText = async (guildId, payload = {}) => {
  const guild = client.guilds.cache.get(String(guildId));
  if (!guild) throw new Error('Server wurde vom Bot nicht gefunden.');

  const cfg = configCache.get(String(guildId)) || await getGuildConfig(String(guildId));
  const ai = cfg?.aiChat || {};
  const baseUrl = String(ai.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '').replace(/\/api$/i, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 75000);
  const target = ['title', 'description', 'content'].includes(payload.target) ? payload.target : 'description';
  const limits = { title: 256, description: 4096, content: 2000 };
  const modes = {
    create: 'Schreibe den Text neu anhand der Aufgabe.',
    improve: 'Verbessere den vorhandenen Text sprachlich, ohne seine Aussage zu verändern.',
    shorten: 'Kürze den vorhandenen Text deutlich und erhalte alle wichtigen Informationen.',
    rewrite: 'Formuliere den vorhandenen Text vollständig neu und hochwertiger.'
  };
  const tones = {
    professional: 'professionell, klar und souverän',
    warm: 'warm, einladend und freundlich',
    premium: 'hochwertig, selbstbewusst und modern',
    concise: 'kurz, direkt und leicht verständlich',
    community: 'locker, menschlich und passend für eine Discord-Community',
    moderation: 'verbindlich, ruhig und respektvoll'
  };

  try {
    const tagsResponse = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    const tagsData = await tagsResponse.json().catch(() => ({}));
    const models = Array.isArray(tagsData.models) ? tagsData.models.map((entry) => String(entry.name || entry.model || '')).filter(Boolean) : [];
    if (!tagsResponse.ok || !models.length) throw new Error('Ollama läuft, aber es wurde kein verfügbares Modell gefunden.');
    const configuredModel = String(ai.model || '').trim();
    const model = models.includes(configuredModel) ? configuredModel : models[0];
    const currentText = String(payload.currentText || '').slice(0, 6000);
    const instruction = String(payload.instruction || '').slice(0, 800);
    const context = payload.context && typeof payload.context === 'object' ? payload.context : {};
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        keep_alive: '15m',
        messages: [
          {
            role: 'system',
            content: `Du bist der professionelle deutsche Text-Assistent für den Discord-Server ${guild.name}. Antworte ausschließlich mit dem fertigen Text, ohne Einleitung, Erklärung, Anführungszeichen oder Markdown-Codeblock. Schreibe grammatikalisch einwandfreies Deutsch und mische keine Sprachen. Erfinde keine Serverdaten. Bewahre Discord-Platzhalter wie {user}, {guild}, {level} und Channel-Mentions unverändert. Das Ergebnis darf maximal ${limits[target]} Zeichen lang sein.`
          },
          {
            role: 'user',
            content: [
              modes[payload.mode] || modes.create,
              `Ziel: ${target}.`,
              `Stil: ${tones[payload.tone] || tones.professional}.`,
              instruction ? `Aufgabe: ${instruction}` : '',
              currentText ? `Vorhandener Text:\n${currentText}` : '',
              context.title ? `Kontext-Titel: ${String(context.title).slice(0, 256)}` : '',
              context.description && target !== 'description' ? `Kontext-Beschreibung: ${String(context.description).slice(0, 1200)}` : '',
              context.content && target !== 'content' ? `Kontext-Nachricht: ${String(context.content).slice(0, 600)}` : ''
            ].filter(Boolean).join('\n\n')
          }
        ],
        options: {
          temperature: payload.mode === 'shorten' ? 0.35 : 0.65,
          top_p: 0.9,
          num_predict: target === 'title' ? 100 : 750
        }
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(data?.error || 'Ollama hat den Text nicht erstellt.'));
    let text = String(data?.message?.content || data?.response || '')
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/^```(?:markdown|text)?\s*/i, '')
      .replace(/```$/i, '')
      .trim();
    if (!text) throw new Error('Ollama hat einen leeren Vorschlag zurückgegeben.');
    if (text.length > limits[target]) {
      const clipped = text.slice(0, limits[target]);
      const boundary = Math.max(clipped.lastIndexOf('. '), clipped.lastIndexOf('! '), clipped.lastIndexOf('? '), clipped.lastIndexOf('\n'));
      text = (boundary > Math.floor(limits[target] * 0.55) ? clipped.slice(0, boundary + 1) : clipped).trim();
    }
    return { text, model, target, characters: text.length };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Ollama hat zu lange gebraucht. Prüfe das Modell und versuche es erneut.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const normalizeSkinRecipeColor = (value, fallback) => {
  const color = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : fallback;
};

const normalizeSkinAssistantRecipe = (value = {}, payload = {}) => {
  const source = value && typeof value === 'object' ? value : {};
  const styles = ['modern', 'fantasy', 'cyber', 'streetwear', 'minimal'];
  const archetypes = ['hoodie', 'armor', 'jacket', 'robe', 'suit', 'adventurer'];
  const patterns = ['clean', 'stripes', 'panels', 'runes', 'gradient', 'asymmetric'];
  const requestedStyle = styles.includes(payload.style) ? payload.style : 'modern';
  return {
    name: String(source.name || 'AI Entwurf').replace(/[<>]/g, '').trim().slice(0, 38) || 'AI Entwurf',
    style: styles.includes(source.style) ? source.style : requestedStyle,
    archetype: archetypes.includes(source.archetype) ? source.archetype : 'jacket',
    pattern: patterns.includes(source.pattern) ? source.pattern : 'panels',
    detail: payload.detail === 'rich' || payload.detail === 'clean' ? payload.detail : 'balanced',
    palette: {
      primary: normalizeSkinRecipeColor(source.palette?.primary, '#20243D'),
      secondary: normalizeSkinRecipeColor(source.palette?.secondary, '#5865F2'),
      accent: normalizeSkinRecipeColor(source.palette?.accent, '#8FE8FF'),
      skin: normalizeSkinRecipeColor(source.palette?.skin, '#B97A56'),
      hair: normalizeSkinRecipeColor(source.palette?.hair, '#261A19'),
      eyes: normalizeSkinRecipeColor(source.palette?.eyes, '#75D9FF')
    },
    hood: Boolean(source.hood),
    mask: Boolean(source.mask),
    gloves: source.gloves !== false,
    boots: source.boots !== false,
    glowing: Boolean(source.glowing),
    summary: String(source.summary || 'AI-gestützter Minecraft-Skin-Entwurf').replace(/[<>]/g, '').trim().slice(0, 160)
  };
};

const generateSkinAssistantRecipe = async (guildId, payload = {}) => {
  const guild = client.guilds.cache.get(String(guildId));
  if (!guild) throw new Error('Server wurde vom Bot nicht gefunden.');
  const prompt = String(payload.prompt || '').trim().slice(0, 500);
  if (prompt.length < 3) throw new Error('Beschreibe den gewünschten Skin etwas genauer.');

  const cfg = configCache.get(String(guildId)) || await getGuildConfig(String(guildId));
  const ai = cfg?.aiChat || {};
  const baseUrl = String(ai.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '').replace(/\/api$/i, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 75000);

  try {
    const tagsResponse = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    const tagsData = await tagsResponse.json().catch(() => ({}));
    const models = Array.isArray(tagsData.models) ? tagsData.models.map((entry) => String(entry.name || entry.model || '')).filter(Boolean) : [];
    if (!tagsResponse.ok || !models.length) throw new Error('Ollama läuft, aber es wurde kein verfügbares Modell gefunden.');
    const configuredModel = String(ai.model || '').trim();
    const model = models.includes(configuredModel) ? configuredModel : models[0];
    const style = ['modern', 'fantasy', 'cyber', 'streetwear', 'minimal'].includes(payload.style) ? payload.style : 'automatisch';
    const detail = ['rich', 'balanced', 'clean'].includes(payload.detail) ? payload.detail : 'balanced';
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        keep_alive: '15m',
        messages: [
          {
            role: 'system',
            content: 'Du bist ein professioneller Minecraft-Skin-Art-Director. Übersetze die Idee in genau ein JSON-Objekt, ohne Markdown und ohne weiteren Text. Erlaubte Felder: name, style (modern|fantasy|cyber|streetwear|minimal), archetype (hoodie|armor|jacket|robe|suit|adventurer), pattern (clean|stripes|panels|runes|gradient|asymmetric), palette mit primary/secondary/accent/skin/hair/eyes als sechsstellige HEX-Farben, hood, mask, gloves, boots, glowing als Boolean sowie summary. Denke wie ein Skin-Studio: 64x64-UV-Layout, Classic/Slim-lesbare Silhouette, Base-Layer plus echte Outer-Layer-Details für Haare, Kapuze, Jacke, Schulterpads oder Highlights. Erzeuge keine flachen Rechteckflächen, sondern starke Kontraste, Pixel-Schattierung, kleine Highlights und eine harmonische Palette, die im Minecraft-Launcher lesbar bleibt.'
          },
          {
            role: 'user',
            content: `Skin-Idee: ${prompt}\nGewünschter Stil: ${style}\nDetailgrad: ${detail}\nServer-Kontext: ${guild.name}`
          }
        ],
        options: {
          temperature: 0.68,
          top_p: 0.9,
          num_predict: 360
        }
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(data?.error || 'Ollama hat keinen Skin-Entwurf erstellt.'));
    const text = String(data?.message?.content || data?.response || '')
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```$/i, '')
      .trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Ollama hat keinen gültigen Skin-Entwurf geliefert.');
    const recipe = normalizeSkinAssistantRecipe(JSON.parse(jsonMatch[0]), payload);
    return { recipe, model, provider: 'ollama' };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Ollama hat zu lange gebraucht. Der lokale Smart-Generator kann trotzdem verwendet werden.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const buildStudioMessagePayload = async (guild, template = {}) => {
  const payload = buildEmbedPayload(template, guild);
  const componentSet = String(template.componentSet || 'none').trim();
  if (componentSet === 'heavenEconomy') {
    const guildConfig = await getCachedGuildConfig(guild.id, guild.name);
    if (!guildConfig?.heavenEconomy?.enabled) {
      throw new Error('Das Funktionsset „Heaven VIP & Coins“ kann erst angehängt werden, wenn das Modul aktiviert ist.');
    }
    payload.components = buildHeavenEconomyComponents();
  } else if (componentSet !== 'none' && componentSet !== '') {
    throw new Error('Das ausgewählte Embed-Funktionsset ist nicht verfügbar.');
  } else {
    payload.components = [];
  }
  return { payload, componentSet: componentSet || 'none' };
};

const sendGuildEmbed = async (guildId, template = {}) => {
  const guild = client.guilds.cache.get(String(guildId));
  if (!guild) {
    throw new Error('Server wurde vom Bot nicht gefunden.');
  }

  const channel = await getTextChannel(guild, template.channelId);
  if (!channel) {
    throw new Error('Textkanal wurde nicht gefunden oder ist nicht beschreibbar.');
  }

  const payload = buildEmbedPayload(template, guild);
  const componentSet = String(template.componentSet || 'none').trim();
  if (componentSet === 'heavenEconomy') {
    const guildConfig = await getCachedGuildConfig(guild.id, guild.name);
    if (!guildConfig?.heavenEconomy?.enabled) {
      throw new Error('Das Funktionsset „Heaven VIP & Coins“ kann erst angehängt werden, wenn das Modul aktiviert ist.');
    }
    payload.components = buildHeavenEconomyComponents();
  } else if (componentSet !== 'none' && componentSet !== '') {
    throw new Error('Das ausgewählte Embed-Funktionsset ist nicht verfügbar.');
  } else {
    payload.components = [];
  }
  const message = await sendMessageToChannel(guild, channel, payload);
  const reactionRoles = await configureMessageReactionRoles(guild, message, template.reactionRoles || []);
  return {
    messageId: message.id,
    channelId: message.channelId || channel.id,
    url: message.url || messageUrl(guild.id, message.channelId || channel.id, message.id),
    outsideImageAttachment: serializeOutsideImageAttachment(message),
    reactionRoles: reactionRoles.length,
    componentSet: componentSet || 'none'
  };
};

const editGuildEmbed = async (guildId, template = {}) => {
  const guild = client.guilds.cache.get(String(guildId));
  if (!guild) {
    throw new Error('Server wurde vom Bot nicht gefunden.');
  }

  const channel = await getTextChannel(guild, template.channelId);
  if (!channel || !template.messageId) {
    throw new Error('Textkanal oder Message-ID fehlt.');
  }

  const payload = buildEmbedPayload(template, guild);
  const componentSet = String(template.componentSet || 'none').trim();
  if (componentSet === 'heavenEconomy') {
    const guildConfig = await getCachedGuildConfig(guild.id, guild.name);
    if (!guildConfig?.heavenEconomy?.enabled) {
      throw new Error('Das Funktionsset „Heaven VIP & Coins“ kann erst angehängt werden, wenn das Modul aktiviert ist.');
    }
    payload.components = buildHeavenEconomyComponents();
  } else if (componentSet !== 'none' && componentSet !== '') {
    throw new Error('Das ausgewählte Embed-Funktionsset ist nicht verfügbar.');
  } else {
    payload.components = [];
  }
  const updated = await editMessageInChannel(guild, channel, template.messageId, payload);
  const reactionRoles = await configureMessageReactionRoles(guild, updated, template.reactionRoles || []);
  return {
    messageId: updated.id,
    channelId: updated.channelId || channel.id,
    url: updated.url || messageUrl(guild.id, updated.channelId || channel.id, updated.id),
    outsideImageAttachment: serializeOutsideImageAttachment(updated),
    reactionRoles: reactionRoles.length,
    componentSet: componentSet || 'none'
  };
};

const normalizeForumAppliedTags = (forumChannel, tags = []) => {
  const available = new Set(Array.from(forumChannel?.availableTags?.values?.() || forumChannel?.availableTags || []).map((tag) => String(tag.id)));
  const selected = [...new Set((Array.isArray(tags) ? tags : [tags])
    .map((tag) => String(tag || '').trim())
    .filter((tag) => tag && (!available.size || available.has(tag))))].slice(0, 5);
  if (forumChannelRequiresTag(forumChannel) && !selected.length) {
    throw new Error('Dieses Forum verlangt mindestens einen gültigen Tag. Wähle im Embed Studio einen Forum-Tag aus.');
  }
  return selected;
};

const ensureThreadStartPayload = (payload = {}, fallbackContent = '') => {
  const next = {
    ...payload,
    content: String(payload.content || '').slice(0, 2000) || undefined,
    embeds: Array.isArray(payload.embeds) ? payload.embeds : [],
    components: Array.isArray(payload.components) ? payload.components : [],
    allowedMentions: payload.allowedMentions || { parse: [] }
  };
  if (!next.content && !next.embeds.length && !next.components.length && !(Array.isArray(next.files) && next.files.length)) {
    next.content = String(fallbackContent || 'Thread erstellt.').slice(0, 2000);
  }
  return next;
};

const fetchThreadStarterMessage = async (thread) => {
  const starter = await thread.fetchStarterMessage?.().catch(() => null);
  if (starter) return starter;
  if (thread?.messages?.fetch && thread.id) {
    const byId = await thread.messages.fetch(String(thread.id)).catch(() => null);
    if (byId) return byId;
    const firstPage = await thread.messages.fetch({ limit: 1 }).catch(() => null);
    return firstPage?.first?.() || null;
  }
  return null;
};

const createGuildThread = async (guildId, options = {}) => {
  const guild = client.guilds.cache.get(String(guildId));
  if (!guild) {
    throw new Error('Server wurde vom Bot nicht gefunden.');
  }

  const parentId = String(options.parentChannelId || options.channelId || '').trim();
  const name = String(options.name || '').trim().slice(0, 100);
  const message = String(options.message || '').trim().slice(0, 2000);
  const template = options.template && typeof options.template === 'object' ? options.template : null;
  if (!parentId) {
    throw new Error('Parent-Kanal fehlt.');
  }
  if (!name) {
    throw new Error('Thread-Name fehlt.');
  }

  const parent = guild.channels.cache.get(parentId) || (await guild.channels.fetch(parentId).catch(() => null));
  if (!parent || parent.isThread?.() || !parent.threads?.create) {
    throw new Error('Ausgewählter Kanal kann keine neuen Threads erstellen.');
  }

  const isForumLike = [ChannelType.GuildForum, ChannelType.GuildMedia].includes(parent.type);
  const builtTemplatePayload = template ? await buildStudioMessagePayload(guild, { ...template, channelId: parent.id }) : null;
  const startPayload = ensureThreadStartPayload(
    builtTemplatePayload?.payload || { content: message || `Thread erstellt: ${name}` },
    message || `Thread erstellt: ${name}`
  );
  const appliedTags = isForumLike ? normalizeForumAppliedTags(parent, options.appliedTags || options.tags || template?.forumPost?.appliedTags || []) : [];
  const thread = await parent.threads.create({
    name,
    autoArchiveDuration: Number(options.autoArchiveDuration || 1440),
    reason: 'FALLEN HEAVEN Embed Studio Thread',
    ...(isForumLike
      ? { message: startPayload, appliedTags }
      : {})
  }).catch((error) => {
    throw new Error(`Thread konnte nicht erstellt werden: ${error?.message || 'Discord Fehler'}`);
  });

  let sentMessage = null;
  if (!isForumLike && (template || message)) {
    sentMessage = await thread.send(startPayload).catch((error) => {
      throw new Error(`Thread wurde erstellt, aber Startnachricht konnte nicht gesendet werden: ${error?.message || 'Discord Fehler'}`);
    });
  }
  const starterMessage = isForumLike ? await fetchThreadStarterMessage(thread) : sentMessage;
  const reactionRoles = template && starterMessage
    ? await configureMessageReactionRoles(guild, starterMessage, template.reactionRoles || [])
    : [];

  return {
    id: thread.id,
    channelId: thread.id,
    messageId: starterMessage?.id || (isForumLike ? thread.id : sentMessage?.id || ''),
    name: thread.name || name,
    parentId: parent.id,
    parentName: parent.name || '',
    isThread: true,
    url: starterMessage?.url || `https://discord.com/channels/${guild.id}/${thread.id}`,
    outsideImageAttachment: starterMessage ? serializeOutsideImageAttachment(starterMessage) : null,
    reactionRoles: reactionRoles.length,
    componentSet: builtTemplatePayload?.componentSet || 'none',
    appliedTags
  };
};

const getGuildStats = async (guildId) => {
  const guild = client.guilds.cache.get(String(guildId));
  if (!guild) {
    return null;
  }

  await Promise.all([
    guild.fetch().catch(() => null),
    guild.channels.fetch().catch(() => null),
    guild.roles.fetch().catch(() => null)
  ]);

  const cfg = await getCachedGuildConfig(guild.id, guild.name);
  const channels = guild.channels.cache;
  const roles = guild.roles.cache;
  const textChannels = channels.filter((channel) => channel?.isTextBased?.() && channel.type !== ChannelType.GuildCategory).size;
  const voiceChannels = channels.filter((channel) => [ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type)).size;
  const categoryChannels = channels.filter((channel) => channel.type === ChannelType.GuildCategory).size;
  const threadChannels = channels.filter((channel) =>
    [ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread].includes(channel.type)
  ).size;
  const moduleStats = featureCards.map((feature) => ({
    id: feature.id,
    name: feature.title,
    enabled: getByPath(cfg, `${feature.id}.enabled`) !== false
  }));
  const enabledModules = moduleStats.filter((module) => module.enabled).length;
  const templates = Array.isArray(cfg?.embeds?.templates) ? cfg.embeds.templates : [];

  return {
    summary: {
      id: guild.id,
      name: guild.name,
      icon: guild.iconURL?.({ size: 128 }) || null,
      ownerId: guild.ownerId,
      memberCount: guild.memberCount || 0,
      cachedMembers: guild.members.cache.size,
      cachedBots: guild.members.cache.filter((member) => member.user?.bot).size,
      boostCount: guild.premiumSubscriptionCount || 0,
      premiumTier: guild.premiumTier || 0,
      roleCount: roles.size,
      channelCount: channels.size,
      featureCount: guild.features?.length || 0,
      createdAt: guild.createdAt?.toISOString?.() || null,
      joinedAt: guild.members.me?.joinedAt?.toISOString?.() || null
    },
    charts: {
      channels: [
        { label: 'Text', value: textChannels },
        { label: 'Voice', value: voiceChannels },
        { label: 'Kategorien', value: categoryChannels },
        { label: 'Threads', value: threadChannels }
      ],
      modules: [
        { label: 'Aktiv', value: enabledModules },
        { label: 'Aus', value: Math.max(0, moduleStats.length - enabledModules) }
      ],
      assets: [
        { label: 'Rollen', value: roles.size },
        { label: 'Channels', value: channels.size },
        { label: 'Embeds', value: templates.length },
        { label: 'Boosts', value: guild.premiumSubscriptionCount || 0 }
      ]
    },
    modules: moduleStats
  };
};

const MANAGEMENT_SYSTEM_EVENT_INDEX_LIMIT = 100_000;
const MANAGEMENT_SYSTEM_EVENT_CACHE_MS = 30_000;
const managementSystemEventCache = new Map();

const managementSystemEventCategory = (event) => {
  const eventType = String(event?.type || '');
  return String(event?.metadata?.category
    || (eventType.startsWith('boost_') ? 'boosts' : '')
    || (eventType.startsWith('member_') ? 'membership' : '')
    || 'other');
};

const getDashboardSystemEventPage = async (guild, options = {}, managementConfig = null) => {
  if (!guild?.id) return null;
  startServerSystemEventBackfill(guild, managementConfig || {});
  const cacheKey = String(guild.id);
  const cached = managementSystemEventCache.get(cacheKey);
  let fullFeed;
  if (options.refresh !== true && cached && Date.now() - cached.loadedAt < MANAGEMENT_SYSTEM_EVENT_CACHE_MS) {
    fullFeed = cached.feed;
  } else {
    fullFeed = await getServerSystemEvents({
      guildId: guild.id,
      maxEntries: MANAGEMENT_SYSTEM_EVENT_INDEX_LIMIT,
      retentionDays: 0
    }).catch(() => ({
      events: [],
      scan: {},
      summary: { total: 0, boosts: 0, joins: 0, ended: 0 }
    }));
    fullFeed.events = Array.isArray(fullFeed.events) ? fullFeed.events : [];
    fullFeed.events.sort((left, right) => Number(right.ts || Date.parse(right.createdAt || '') || 0) - Number(left.ts || Date.parse(left.createdAt || '') || 0));
    managementSystemEventCache.set(cacheKey, { loadedAt: Date.now(), feed: fullFeed });
  }

  const allowedFilters = new Set(['all', 'membership', 'boosts', 'channel', 'stage', 'safety', 'subscriptions', 'other']);
  const requestedFilter = String(options.filter || 'all');
  const filter = allowedFilters.has(requestedFilter) ? requestedFilter : 'all';
  const pageSize = Math.min(100, Math.max(10, Number(options.pageSize || 25)));
  const allEvents = fullFeed.events;
  const categories = allEvents.reduce((result, event) => {
    const category = managementSystemEventCategory(event);
    result[category] = Number(result[category] || 0) + 1;
    return result;
  }, {});
  const filteredEvents = filter === 'all'
    ? allEvents
    : allEvents.filter((event) => managementSystemEventCategory(event) === filter);
  const pageCount = Math.max(1, Math.ceil(filteredEvents.length / pageSize));
  const page = Math.min(pageCount - 1, Math.max(0, Number(options.page || 0)));
  const events = filteredEvents
    .slice(page * pageSize, page * pageSize + pageSize)
    .map((source) => ({ ...source, metadata: { ...(source.metadata || {}) } }));

  for (const event of events) {
    const member = event.userId ? guild.members.cache.get(String(event.userId)) : null;
    const profileName = member?.user?.globalName || member?.user?.username || member?.displayName || event.userName || '';
    if (member) {
      const avatarUrl = await resolveDashboardAvatarUrlWithFallback(guild, member, { size: 128 });
      event.member = {
        id: member.id,
        mention: `<@${member.id}>`,
        displayName: member.displayName || profileName,
        globalName: member.user?.globalName || '',
        username: member.user?.username || '',
        avatarUrl: avatarUrl || '',
        avatar: avatarUrl || '',
        premiumSince: member.premiumSince?.toISOString?.() || null,
        bot: Boolean(member.user?.bot)
      };
      event.userName = profileName;
    }
    if (event.type === 'member_joined' && (!event.text || /^Ein Mitglied\b/.test(event.text))) {
      event.text = `${profileName || `Mitglied ${event.userId || ''}`.trim()} ist dem Server beigetreten.`;
    }
    if (event.type === 'boost_started' && Number(event.metadata?.discordMessageType || 8) === 8) {
      const rawText = String(event.text || '').trim();
      const parsedCount = rawText.match(/(?:zum\s+)?(\d+)\.?(?:\s*mal)?\s+geboostet/i)?.[1];
      const count = Math.max(1, Number(event.metadata?.boostCount || parsedCount || (/^\d+$/.test(rawText) ? rawText : 1)));
      const who = profileName || `Mitglied ${event.userId || ''}`.trim();
      event.metadata.boostCount = count;
      event.text = count > 1 ? `${who} hat den Server gerade ${count}-mal geboostet!` : `${who} hat den Server gerade geboostet!`;
    }
  }

  return {
    events,
    scan: fullFeed.scan || {},
    summary: {
      total: allEvents.length,
      filteredTotal: filteredEvents.length,
      boosts: Number(categories.boosts || 0),
      joins: allEvents.filter((event) => event.type === 'member_joined').length,
      ended: allEvents.filter((event) => event.type === 'boost_ended' || event.type === 'member_left').length,
      categories
    },
    pagination: {
      page,
      pageSize,
      pageCount,
      total: filteredEvents.length,
      overallTotal: allEvents.length,
      filter
    },
    window: {
      limit: MANAGEMENT_SYSTEM_EVENT_INDEX_LIMIT,
      returned: events.length,
      indexed: allEvents.length,
      truncated: allEvents.length >= MANAGEMENT_SYSTEM_EVENT_INDEX_LIMIT
    }
  };
};

const listDashboardSystemEvents = async (guildId, options = {}) => {
  const guild = client.guilds.cache.get(String(guildId || ''));
  if (!guild) return null;
  const managementConfig = await getCachedGuildConfig(guild.id, guild.name);
  return getDashboardSystemEventPage(guild, options, managementConfig);
};

const getGuildManagement = async (guildId, options = {}) => {
  const guild = client.guilds.cache.get(String(guildId));
  if (!guild) {
    return null;
  }

  await refreshGuildChannels(guild, options.fresh === true);

  const resolveWithin = (promise, timeoutMs = 1200) => new Promise((resolve) => {
    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      resolve(null);
    }, timeoutMs);
    Promise.resolve(promise).then(
      (value) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve(null);
      }
    );
  });

  const channelMap = new Map(guild.channels.cache.map((channel) => [channel.id, channel]));

  const channels = withDashboardDisplayOrder(Array.from(channelMap.values())
    .filter(Boolean)
    .map((channel) => {
      const isCategory = channel.type === ChannelType.GuildCategory;
      const isThread = Boolean(channel.isThread?.());
      const isForumLike = isForumLikeChannel(channel);
      const isVoice = Boolean(channel.isVoiceBased?.());
      const isText = Boolean(channel.isTextBased?.()) && !isCategory && !isForumLike;
      const canRead = channel.viewable !== false;
      const supportsMessageCounter = Boolean(isText && !isThread && !isForumLike && channel.messages?.fetch);
      const parentChannel = isThread ? channelMap.get(String(channel.parentId || '')) : null;
      const category = isThread ? parentChannel?.parent : channel.parent;
      return {
        id: channel.id,
        name: channel.name || channel.id,
        type: channel.type,
        parentId: channel.parentId || null,
        position: discordPosition(channel),
        rawPosition: discordPosition(channel),
        parentPosition: discordPosition(parentChannel, discordPosition(channel)),
        categoryId: category?.id || null,
        categoryName: category?.name || 'Ohne Kategorie',
        categoryPosition: discordPosition(category, channel.parentId ? 0 : -1),
        topic: typeof channel.topic === 'string' ? channel.topic : '',
        nsfw: Boolean(channel.nsfw),
        isCategory,
        isThread,
        isForumLike,
        isMedia: Number(channel.type) === ChannelType.GuildMedia,
        isText,
        isVoice,
        sortBucket: dashboardChannelSortBucket({ type: channel.type, isCategory, isThread, isForumLike, isText, isVoice }),
        canRead,
        canOpen: Boolean(canRead && !isCategory && !isVoice && (isText || isThread || isForumLike)),
        canSend: channel.sendable !== false,
        supportsMessageCounter,
        lastMessageId: channel.lastMessageId || null,
        url: `https://discord.com/channels/${guild.id}/${channel.id}`
      };
    }));

  const roleMemberCounts = new Map();
  for (const member of guild.members.cache.values()) {
    for (const roleId of member.roles.cache.keys()) {
      if (roleId !== guild.id) roleMemberCounts.set(roleId, Number(roleMemberCounts.get(roleId) || 0) + 1);
    }
  }

  const roles = guild.roles.cache
    .filter((role) => role.id !== guild.id)
    .sort(compareDiscordRoleHierarchy)
    .map((role) => ({
      id: role.id,
      name: role.name,
      color: role.hexColor && role.hexColor !== '#000000' ? role.hexColor : '#8b82ff',
      position: role.position,
      rawPosition: discordPosition(role),
      memberCount: Number(roleMemberCounts.get(role.id) || 0),
      managed: Boolean(role.managed),
      mentionable: Boolean(role.mentionable),
      hoist: Boolean(role.hoist)
    }));

  const events = guild.scheduledEvents.cache
    .map((event) => ({
        id: event.id,
        name: event.name,
        description: event.description || '',
        status: event.status,
        entityType: event.entityType,
        channelId: event.channelId || null,
        location: event.entityMetadata?.location || '',
        scheduledStartAt: event.scheduledStartAt?.toISOString?.() || null,
        scheduledEndAt: event.scheduledEndAt?.toISOString?.() || null,
        userCount: event.userCount || 0,
        image: event.coverImageURL?.({ size: 512 }) || null,
        url: `https://discord.com/events/${guild.id}/${event.id}`
      }));

  const boosters = await Promise.all(guild.members.cache
    .filter((member) => Boolean(member.premiumSince))
    .map(async (member) => {
      const avatarUrl = await resolveDashboardAvatarUrlWithFallback(guild, member, { size: 128 });
      return {
        id: member.id,
        mention: `<@${member.id}>`,
        displayName: member.displayName || member.user.globalName || member.user.username,
        username: member.user.username,
        avatarUrl: avatarUrl || '',
        avatar: avatarUrl || '',
        premiumSince: member.premiumSince?.toISOString?.() || null
      };
    }))
    .then((values) => values
      .filter(Boolean)
      .sort((a, b) => new Date(a.premiumSince || 0) - new Date(b.premiumSince || 0)));
  const boostStatus = await resolveWithin(getBoostStatusSnapshot(guild));
  const systemEvents = { events: [], summary: { total: 0 }, deferred: true };

  return {
    guild: {
      id: guild.id,
      name: guild.name,
      description: guild.description || '',
      icon: guild.iconURL?.({ size: 256 }) || null,
      banner: guild.bannerURL?.({ size: 1024 }) || null,
      ownerId: guild.ownerId,
      memberCount: guild.memberCount || 0,
      cachedMemberCount: guild.members.cache.size,
      onlineCount: guild.members.cache.filter((member) => member.presence?.status && member.presence.status !== 'offline').size,
      channelCount: channels.length,
      roleCount: roles.length,
      eventCount: events.length,
      boostCount: guild.premiumSubscriptionCount || boosters.length,
      premiumTier: guild.premiumTier || 0,
      preferredLocale: guild.preferredLocale || 'de',
      createdAt: guild.createdAt?.toISOString?.() || null
    },
    channels,
    roles,
    events,
    boosts: {
      count: guild.premiumSubscriptionCount || boosters.length,
      tier: guild.premiumTier || 0,
      progressBarEnabled: Boolean(guild.premiumProgressBarEnabled),
      boosters,
      status: boostStatus
    },
    systemEvents,
    fetchedAt: new Date().toISOString()
  };
};

const listGuildMessages = async (guildId, channelId, options = {}) => {
  const guild = client.guilds.cache.get(String(guildId));
  if (!guild) {
    return null;
  }

  const id = String(channelId || '').trim();
  const channel = guild.channels.cache.get(id) || (await guild.channels.fetch(id).catch(() => null));
  if (!channel || channel.guildId !== guild.id) {
    return null;
  }
  if (channel.viewable === false) {
    throw new Error('Der Bot darf diesen Kanal nicht sehen.');
  }
  if (isForumLikeChannel(channel)) {
    return listForumChannelPosts({ guild, channel, options, actorUserId: options.actorUserId || '' });
  }
  if (!channel.isTextBased?.() || !channel.messages?.fetch) {
    throw new Error('Dieser Kanal besitzt keinen direkt lesbaren Nachrichtenverlauf. Wähle einen Textkanal, ein Forum oder einen aktiven Thread.');
  }

  const actor = options.actorUserId
    ? guild.members.cache.get(String(options.actorUserId)) || await guild.members.fetch(String(options.actorUserId)).catch(() => null)
    : null;
  const actorChannelPermissions = actor ? channel.permissionsFor(actor) : null;
  if (actor && (!actorChannelPermissions?.has(PermissionFlagsBits.ViewChannel) || !actorChannelPermissions.has(PermissionFlagsBits.ReadMessageHistory))) {
    throw new Error('Du darfst den Verlauf dieses Kanals nicht lesen.');
  }
  const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
  const actorIsOwner = actor?.id === guild.ownerId;
  const actorCanManageChannels = actorIsOwner || Boolean(actor?.permissions.has(PermissionFlagsBits.Administrator) || actor?.permissions.has(PermissionFlagsBits.ManageChannels));
  const actorCanManageMessages = actorIsOwner || Boolean(actor?.permissions.has(PermissionFlagsBits.Administrator) || actor?.permissionsIn(channel).has(PermissionFlagsBits.ManageMessages));
  const botChannelPermissions = botMember ? channel.permissionsFor(botMember) : null;
  const botCanManageChannel = Boolean(botChannelPermissions?.has(PermissionFlagsBits.ManageChannels));
  const botCanManageMessages = Boolean(botChannelPermissions?.has(PermissionFlagsBits.ManageMessages));
  const messageCounter = await getChannelMessageCounterState(guild, channel);
  const limit = Math.min(100, Math.max(10, Number(options.limit || 50)));
  const requestedPage = Math.max(0, Math.trunc(Number(options.page) || 0));
  if (requestedPage) {
    const indexed = await getServerIndexChannelPage({ guildId: guild.id, channelId: channel.id, page: requestedPage, pageSize: limit });
    if (indexed.totalMessages > 0) {
      const authorCache = new Map();
      const messages = await Promise.all(indexed.rows.map(async (record) => {
        const content = String(record.content || '');
        const mentionIds = extractMentionIdsFromText(content);
        const author = await resolveIndexedMessageAuthor(guild, channel, record, authorCache);
        const canEdit = Boolean(record.id && author?.id && client.user?.id && author.id === client.user.id);
        const canDelete = Boolean(actorCanManageMessages && (author?.id === client.user?.id || botCanManageMessages));
        return {
          id: String(record.id || ''),
          content,
          type: Number(record.type || 0),
          createdAt: record.createdAt || null,
          editedAt: record.editedAt || null,
          pinned: Boolean(record.pinned),
          url: messageUrl(guild.id, channel.id, record.id),
          canEdit: canEdit,
          canDelete: canDelete,
          author,
          mentions: await Promise.all(mentionIds.map(async (mentionId) => {
            const mention = await resolveIndexedMentionProfile(guild, mentionId, authorCache);
            return {
              id: mention.id,
              username: mention.username || '',
              displayName: mention.displayName || ''
            };
          })),
          attachments: Array.isArray(record.attachments)
            ? record.attachments.map((attachment) => ({
              id: String(attachment.id || ''),
              name: attachment.name || 'Datei',
              url: attachment.url || '',
              contentType: attachment.contentType || attachment.content_type || attachment.type || '',
              size: Number(attachment.size || 0)
            }))
            : [],
          embeds: (Array.isArray(record.embeds) ? record.embeds : []).map((embed) => ({
            title: embed.title || '', description: embed.description || '', url: embed.url || '', type: embed.type || '',
            color: embed.color || '', image: embed.image || '', thumbnail: embed.thumbnail || '',
            author: typeof embed.author === 'string' ? embed.author : embed.author?.name || '',
            authorIcon: embed.author?.iconURL || embed.authorIcon || '',
            footer: typeof embed.footer === 'string' ? embed.footer : embed.footer?.text || '',
            footerIcon: embed.footer?.iconURL || embed.footerIcon || '', timestamp: embed.timestamp || null,
            fields: Array.isArray(embed.fields) ? embed.fields : []
          })),
          stickers: (Array.isArray(record.stickers) ? record.stickers : []).map((sticker) => ({
            ...sticker,
            url: sticker.url || `https://media.discordapp.net/stickers/${sticker.id}.png?size=160`,
            previewUrl: sticker.previewUrl || `https://media.discordapp.net/stickers/${sticker.id}.png?size=160`
          })),
          reactions: Array.isArray(record.reactions) ? record.reactions : []
        };
      }));
      return {
        channel: {
          id: channel.id,
          name: channel.name || channel.id,
          topic: channel.topic || '',
          type: channel.type,
          isThread: Boolean(channel.isThread?.()),
          isForumLike: false,
          isMedia: false,
          parentId: channel.parentId || null,
          nsfw: Boolean(channel.nsfw),
          rateLimitPerUser: Number(channel.rateLimitPerUser || 0),
          editable: Boolean(!channel.isThread?.() && actorCanManageChannels && botCanManageChannel),
          supportsMessageCounter: true,
          messageCounter,
          url: `https://discord.com/channels/${guild.id}/${channel.id}`
        },
        messages,
        nextBefore: null,
        hasMore: false,
        storage: 'server-index-pages',
        pagination: {
          page: indexed.page,
          pageSize: indexed.pageSize,
          totalMessages: indexed.totalMessages,
          totalPages: indexed.totalPages,
          complete: indexed.complete,
          updatedAt: indexed.updatedAt
        },
        fetchedAt: new Date().toISOString()
      };
    }
  }
  const before = String(options.before || '').trim();
  const after = String(options.after || '').trim();
  const fetched = await channel.messages.fetch({ limit, ...(before ? { before } : after ? { after } : {}) }).catch((error) => {
    throw new Error(`Nachrichten konnten nicht gelesen werden: ${error?.message || 'Discord verweigert den Zugriff.'}`);
  });

  const messages = await Promise.all(fetched
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .map(async (message) => {
      const avatarUrl = await resolveDashboardAvatarUrlWithFallback(guild, message.author, { size: 128 });
      const authorId = normalizeDiscordId(message.author?.id);
      const authorFallbackName = authorId ? `@${authorId}` : 'Unbekannt';
      return {
      id: message.id,
      content: message.content || '',
      type: message.type,
      createdAt: message.createdAt?.toISOString?.() || null,
      editedAt: message.editedAt?.toISOString?.() || null,
      pinned: Boolean(message.pinned),
      url: message.url || messageUrl(guild.id, channel.id, message.id),
      canEdit: Boolean(client.user?.id && message.author?.id === client.user.id),
      canDelete: Boolean(actorCanManageMessages && (message.author?.id === client.user?.id || botCanManageMessages)),
      author: {
        id: authorId || '',
        username: String(message.author?.username || '').trim() || authorFallbackName,
        displayName: String(message.member?.displayName || message.author?.globalName || message.author?.username || authorFallbackName || '').trim() || 'Unbekannt',
        avatarUrl,
        avatar: avatarUrl,
        fallbackAvatar: message.author?.defaultAvatarURL || null,
        bot: Boolean(message.author?.bot)
      },
      mentions: message.mentions?.users?.map((user) => ({
        id: user.id,
        username: String(user.username || '').trim() || (user.id ? `@${user.id}` : ''),
        displayName: message.mentions?.members?.get?.(user.id)?.displayName || user.globalName || user.username || (user.id ? `@${user.id}` : '')
      })) || [],
      attachments: message.attachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name || 'Datei',
        url: attachment.url,
        contentType: attachment.contentType || '',
        size: attachment.size || 0
      })),
      embeds: message.embeds.map((embed) => ({
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
      })),
      stickers: message.stickers.map((sticker) => ({
        id: sticker.id,
        name: sticker.name,
        url: sticker.url || `https://media.discordapp.net/stickers/${sticker.id}.png?size=160`,
        previewUrl: `https://media.discordapp.net/stickers/${sticker.id}.png?size=160`,
        format: sticker.format
      })),
      reactions: message.reactions.cache.map((reaction) => ({
        emoji: reaction.emoji.toString(),
        id: reaction.emoji.id || '',
        name: reaction.emoji.name || '',
        animated: Boolean(reaction.emoji.animated),
        identifier: reaction.emoji.identifier || reaction.emoji.toString(),
        url: reaction.emoji.imageURL?.({ size: 64, extension: reaction.emoji.animated ? 'gif' : 'png' }) || '',
        count: reaction.count || 0
      }))
      };
    }));

  const oldest = fetched.reduce((current, message) => !current || message.createdTimestamp < current.createdTimestamp ? message : current, null);

  return {
    channel: {
      id: channel.id,
      name: channel.name || channel.id,
      topic: channel.topic || '',
      type: channel.type,
      isThread: Boolean(channel.isThread?.()),
      isForumLike: false,
      isMedia: false,
      parentId: channel.parentId || null,
      nsfw: Boolean(channel.nsfw),
      rateLimitPerUser: Number(channel.rateLimitPerUser || 0),
      editable: Boolean(!channel.isThread?.() && actorCanManageChannels && botCanManageChannel),
      supportsMessageCounter: true,
      messageCounter,
      url: `https://discord.com/channels/${guild.id}/${channel.id}`
    },
    messages,
    nextBefore: oldest?.id || null,
    hasMore: !after && fetched.size === limit,
    storage: 'indexed-and-live',
    pagination: {
      page: 1,
      pageSize: limit,
      totalMessages: messages.length,
      totalPages: 1,
      complete: false,
      updatedAt: null
    },
    fetchedAt: new Date().toISOString()
  };
};

const getDashboardChannelContext = async (guildId, channelId, actorUserId = '') => {
  const guild = client.guilds.cache.get(String(guildId));
  if (!guild) throw new Error('Server wurde nicht gefunden.');
  const channel = guild.channels.cache.get(String(channelId)) || await guild.channels.fetch(String(channelId)).catch(() => null);
  if (!channel || channel.guildId !== guild.id) throw new Error('Kanal wurde nicht gefunden.');
  const actor = actorUserId
    ? guild.members.cache.get(String(actorUserId)) || await guild.members.fetch(String(actorUserId)).catch(() => null)
    : null;
  const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
  return { guild, channel, actor, botMember, actorIsOwner: actor?.id === guild.ownerId };
};

const updateDashboardChannel = async (guildId, channelId, request = {}, actorUserId = '') => {
  const { guild, channel, actor, botMember, actorIsOwner } = await getDashboardChannelContext(guildId, channelId, actorUserId);
  if (channel.isThread?.()) throw new Error('Threads werden an dieser Stelle nicht als Serverkanal bearbeitet.');
  const actorAllowed = actorIsOwner || Boolean(actor?.permissions.has(PermissionFlagsBits.Administrator) || actor?.permissions.has(PermissionFlagsBits.ManageChannels));
  const botAllowed = Boolean(botMember && channel.permissionsFor(botMember)?.has(PermissionFlagsBits.ManageChannels));
  if (!actorAllowed || !botAllowed || channel.manageable === false) throw new Error('Discord verweigert die Kanalbearbeitung aufgrund der Berechtigungen oder Hierarchie.');
  const name = String(request.name ?? channel.name ?? '').trim().slice(0, 100);
  if (!name) throw new Error('Der Kanalname darf nicht leer sein.');
  const patch = { name };
  const isForumLike = isForumLikeChannel(channel);
  const supportsMessageCounter = Boolean(!isForumLike && !channel.isThread?.() && channel.isTextBased?.());
  const requestedTopic = String(request.topic ?? channel.topic ?? '').slice(0, 1024);
  const counterRequest = supportsMessageCounter && request.messageCounter && typeof request.messageCounter === 'object' ? request.messageCounter : null;
  const counterTemplate = String(counterRequest?.template ?? requestedTopic).slice(0, 1024);
  const containsCounterVariable = /\{chat\.count(?:\.[^}]+)?\}/i.test(counterTemplate);
  const counterEnabled = supportsMessageCounter && (counterRequest?.enabled === true || containsCounterVariable);
  const requestedSyncIntervalMs = counterRequest
    ? normalizeChannelTopicSyncIntervalMs(
      counterRequest.syncIntervalMs ?? (Number(counterRequest.syncIntervalMinutes || 0) * 60_000)
    )
    : CHANNEL_TOPIC_SYNC_DEFAULT_MS;
  const placeholders = counterEnabled ? buildCounterPlaceholders(guild, channel.id, counterTemplate).map((item) => ({ ...item, guildId: guild.id })) : [];
  if (counterEnabled && !placeholders.length) throw new Error('Füge mindestens eine Variable wie {chat.count} oder {chat.count.#hauptchat} in das Kanalthema ein.');
  for (const placeholder of placeholders) {
    const sourceState = ensureCounterSourceState(guild, placeholder.sourceChannelId);
    const indexedCount = await getIndexedChannelMessageCount(guild.id, placeholder.sourceChannelId).catch(() => null);
    if (Number.isFinite(Number(indexedCount)) && Number(indexedCount) > Number(sourceState.count || 0)) {
      sourceState.count = Math.max(0, Math.trunc(Number(indexedCount)));
      sourceState.updatedAt = new Date().toISOString();
    }
  }
  let nextTopic = requestedTopic;
  if (counterEnabled) {
    nextTopic = renderCounterTopicTemplate(counterTemplate, placeholders).slice(0, 1024);
  }
  if ('topic' in channel) patch.topic = nextTopic || null;
  if ('nsfw' in channel) patch.nsfw = Boolean(request.nsfw);
  if ('rateLimitPerUser' in channel) patch.rateLimitPerUser = Math.min(21600, Math.max(0, Number(request.rateLimitPerUser || 0)));
  if (counterRequest) {
    await ensureChannelMessageCountersLoaded();
    const key = channelMessageCounterKey(guildId, channelId);
    const previous = channelMessageCounters.get(key) || {};
    channelMessageCounters.set(key, {
      ...previous, guildId: String(guildId), channelId: String(channelId), enabled: counterEnabled,
      count: Math.max(0, Math.trunc(Number(previous.count || detectChannelMessageCount(channel.topic || '')))), template: counterTemplate, placeholders,
      lastAppliedAt: String(previous.lastAppliedAt || ''), lastAttemptAt: String(previous.lastAttemptAt || ''),
      lastError: '', revision: Math.max(0, Math.trunc(Number(previous.revision || 0))) + 1,
      appliedRevision: Math.max(0, Math.trunc(Number(previous.appliedRevision || 0))),
      syncIntervalMs: requestedSyncIntervalMs,
      pendingSince: String(previous.pendingSince || new Date().toISOString()), nextSyncAt: '', updatedAt: new Date().toISOString()
    });
    await persistChannelMessageCounters();
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'topic')) markChannelTopicWrite(guildId, channelId, patch.topic || '');
  const counterEditRevision = Number(channelMessageCounters.get(channelMessageCounterKey(guildId, channelId))?.revision || 0);
  void channel.edit(patch, `Dashboard-Kanaländerung durch ${actorUserId || 'Owner'}`).then((updated) => {
    const state = channelMessageCounters.get(channelMessageCounterKey(guildId, channelId));
    if (state) {
      state.lastAppliedAt = new Date().toISOString();
      state.lastAttemptAt = state.lastAppliedAt;
      state.appliedRevision = Math.max(Number(state.appliedRevision || 0), counterEditRevision);
      state.lastError = '';
      state.pendingSince = Number(state.revision || 0) > Number(state.appliedRevision || 0) ? (state.pendingSince || state.lastAppliedAt) : '';
      state.nextSyncAt = '';
      state.updatedAt = state.lastAppliedAt;
      saveChannelMessageCountersSoon();
      if (Number(state.revision || 0) > Number(state.appliedRevision || 0)) scheduleChannelMessageCounterApply(guildId, channelId);
    }
    return updated;
  }).catch((error) => {
    const state = channelMessageCounters.get(channelMessageCounterKey(guildId, channelId));
    if (state) {
      state.lastError = `Discord-Synchronisierung fehlgeschlagen: ${error?.message || error}`;
      state.updatedAt = new Date().toISOString();
      saveChannelMessageCountersSoon();
      scheduleChannelMessageCounterApply(guildId, channelId);
    }
  });
  const messageCounter = supportsMessageCounter
    ? await getChannelMessageCounterState(guild, channel)
    : { enabled: false, template: '', preview: nextTopic || '', hasPlaceholder: false, placeholders: [] };
  return {
    id: channel.id,
    name,
    topic: nextTopic,
    type: channel.type,
    isThread: Boolean(channel.isThread?.()),
    isForumLike,
    isMedia: Number(channel.type) === ChannelType.GuildMedia,
    nsfw: Boolean(request.nsfw),
    rateLimitPerUser: Number(request.rateLimitPerUser || 0),
    editable: true,
    supportsMessageCounter,
    syncPending: true,
    messageCounter
  };
};

const updateDashboardMessage = async (guildId, channelId, messageId, request = {}, actorUserId = '') => {
  const { channel, actor, actorIsOwner } = await getDashboardChannelContext(guildId, channelId, actorUserId);
  if (!channel.isTextBased?.() || !channel.messages?.fetch) throw new Error('Dieser Kanal besitzt keinen bearbeitbaren Nachrichtenverlauf.');
  const actorAllowed = actorIsOwner || Boolean(actor?.permissions.has(PermissionFlagsBits.Administrator) || actor?.permissionsIn(channel).has(PermissionFlagsBits.ManageMessages));
  if (!actorAllowed) throw new Error('Dein Discord-Konto darf Nachrichten in diesem Kanal nicht verwalten.');
  const message = await channel.messages.fetch(String(messageId)).catch(() => null);
  if (!message) throw new Error('Nachricht wurde nicht gefunden.');
  if (message.author?.id !== client.user?.id) throw new Error('Discord erlaubt Bots nur das Bearbeiten ihrer eigenen Nachrichten. Du kannst diese Nachricht kopieren oder löschen.');
  const content = String(request.content ?? '').slice(0, 2000);
  if (!content.trim() && !message.embeds.length && !message.attachments.size) throw new Error('Eine vollständig leere Nachricht kann nicht gespeichert werden.');
  const updated = await message.edit({ content });
  return { id: updated.id, content: updated.content || '', editedAt: updated.editedAt?.toISOString?.() || new Date().toISOString() };
};

const deleteDashboardMessage = async (guildId, channelId, messageId, actorUserId = '') => {
  const { channel, actor, botMember, actorIsOwner } = await getDashboardChannelContext(guildId, channelId, actorUserId);
  if (!channel.isTextBased?.() || !channel.messages?.fetch) throw new Error('Dieser Kanal besitzt keinen verwaltbaren Nachrichtenverlauf.');
  const actorAllowed = actorIsOwner || Boolean(actor?.permissions.has(PermissionFlagsBits.Administrator) || actor?.permissionsIn(channel).has(PermissionFlagsBits.ManageMessages));
  const message = await channel.messages.fetch(String(messageId)).catch(() => null);
  if (!message) throw new Error('Nachricht wurde nicht gefunden.');
  const ownMessage = message.author?.id === client.user?.id;
  const botAllowed = ownMessage || Boolean(botMember && channel.permissionsFor(botMember)?.has(PermissionFlagsBits.ManageMessages));
  if (!actorAllowed || !botAllowed) throw new Error('Discord verweigert das Löschen dieser Nachricht.');
  await message.delete();
  return true;
};

const getRoleControlContext = async (guild, role, actorUserId = '') => {
  const actor = actorUserId
    ? guild.members.cache.get(String(actorUserId)) || await guild.members.fetch(String(actorUserId)).catch(() => null)
    : null;
  const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
  const actorIsOwner = actor?.id === guild.ownerId;
  const actorAllowed = actorIsOwner || Boolean(actor?.permissions.has(PermissionFlagsBits.Administrator) || actor?.permissions.has(PermissionFlagsBits.ManageRoles));
  const botAllowed = Boolean(botMember?.permissions.has(PermissionFlagsBits.ManageRoles));
  const hierarchyAllowed = Boolean(role && role.id !== guild.id && !role.managed
    && botMember?.roles.highest.comparePositionTo(role) > 0
    && (actorIsOwner || actor?.roles.highest.comparePositionTo(role) > 0));
  return { actor, botMember, editable: actorAllowed && botAllowed && hierarchyAllowed };
};

const getDashboardRole = async (guildId, roleId, actorUserId = '') => {
  const guild = client.guilds.cache.get(String(guildId));
  if (!guild) return null;
  await syncDashboardMembers(guild, false);
  const role = guild.roles.cache.get(String(roleId)) || await guild.roles.fetch(String(roleId)).catch(() => null);
  if (!role || role.id === guild.id) return null;
  const control = await getRoleControlContext(guild, role, actorUserId);
  const members = await Promise.all(role.members.first(30).map(async (member) => {
    const avatarUrl = await resolveDashboardAvatarUrlWithFallback(guild, member, { size: 64 });
    return {
      id: member.id,
      displayName: member.displayName || member.user.username,
      username: member.user.username,
      avatarUrl: avatarUrl || null,
      avatar: avatarUrl || null
    };
  }));
  return {
    id: role.id,
    name: role.name,
    color: role.hexColor && role.hexColor !== '#000000' ? role.hexColor : '#8b82ff',
    position: role.position,
    memberCount: role.members.size,
    managed: role.managed,
    mentionable: role.mentionable,
    hoist: role.hoist,
    editable: control.editable,
    permissions: role.permissions.toArray(),
    members
  };
};

const updateDashboardRole = async (guildId, roleId, request = {}, actorUserId = '') => {
  const guild = client.guilds.cache.get(String(guildId));
  if (!guild) throw new Error('Server wurde nicht gefunden.');
  const role = guild.roles.cache.get(String(roleId)) || await guild.roles.fetch(String(roleId)).catch(() => null);
  if (!role || role.id === guild.id) throw new Error('Rolle wurde nicht gefunden.');
  const control = await getRoleControlContext(guild, role, actorUserId);
  if (!control.editable) throw new Error('Diese Rolle ist verwaltet, zu hoch oder darf von deinem Konto nicht bearbeitet werden.');
  const name = String(request.name || '').trim().slice(0, 100);
  const color = /^#[0-9a-f]{6}$/i.test(String(request.color || '')) ? request.color : role.hexColor;
  if (!name) throw new Error('Der Rollenname darf nicht leer sein.');
  await role.edit({
    name,
    color,
    hoist: Boolean(request.hoist),
    mentionable: Boolean(request.mentionable),
    reason: `Dashboard-Bearbeitung durch ${control.actor?.user?.tag || actorUserId}`
  });
  return getDashboardRole(guild.id, role.id, actorUserId);
};

const buildBotctlCandidatePaths = () => {
  const exePaths = [
    path.join(APP_ROOT, 'dist', botctlExecutableName),
    path.join(process.cwd(), 'dist', botctlExecutableName),
    path.join(path.dirname(path.resolve(process.execPath || '')), 'dist', botctlExecutableName),
    path.join(APP_ROOT, 'dist', botctlExecutableName)
  ];

  const scriptPaths = [
    BOTCTL_FALLBACK_SCRIPT,
    path.join(process.cwd(), 'botctl.js'),
    path.join(process.execPath && path.extname(process.execPath) === '.exe' ? path.dirname(process.execPath) : process.cwd(), 'botctl.cjs'),
    path.join(APP_ROOT, 'botctl.cjs'),
    path.join(APP_ROOT, 'botctl.js')
  ];

  for (const candidate of exePaths) {
    if (existsSync(candidate)) {
      return { command: candidate };
    }
  }

  for (const candidate of scriptPaths) {
    if (existsSync(candidate)) {
      return { command: process.execPath, args: [candidate] };
    }
  }

  return null;
};

const parseSystemStatus = (message) => {
  const text = String(message || '').toLowerCase();
  if (!text) {
    return { running: null, message: '' };
  }

  if (text.includes('bot ist aktiv')) {
    return { running: true, message };
  }

  if (text.includes('bot ist nicht aktiv') || text.includes('bot ist nicht online')) {
    return { running: false, message };
  }

  if (text.includes('gestartet')) {
    return { running: true, message };
  }

  if (text.includes('gestoppt') || text.includes('nicht aktiv')) {
    return { running: false, message };
  }

  return { running: null, message };
};

const runBotctl = async (action) => {
  const actionName = String(action || '').trim();
  if (!['start', 'stop', 'restart', 'status'].includes(actionName)) {
    return { action: actionName, ok: false, running: null, message: 'Unbekannte Aktion' };
  }

  const resolved = buildBotctlCandidatePaths();
  if (!resolved) {
    return {
      action: actionName,
      ok: false,
      running: null,
      message: 'botctl konnte nicht gefunden werden.'
    };
  }

  const command = resolved.command;
  const args = [...(resolved.args || []), actionName];

  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      windowsHide: true,
      encoding: 'utf8'
    });

    const combined = `${String(stdout || '')}\n${String(stderr || '')}`.trim();
    const parsed = parseSystemStatus(combined);
    return {
      action: actionName,
      ok: true,
      output: combined,
      running: parsed.running,
      message: parsed.message || combined || null
    };
  } catch (error) {
    return {
      action: actionName,
      ok: false,
      running: null,
      message: String(error?.message || 'Systembefehl fehlgeschlagen')
    };
  }
};

const getSystemStatus = async () => runBotctl('status');
const startSystem = async () => runBotctl('start');
const stopSystem = async () => runBotctl('stop');
const restartSystem = async () => runBotctl('restart');

const getBotProcessUsage = () => {
  const nowUsage = process.cpuUsage();
  const nowAt = process.hrtime.bigint();
  const prev = processCpuSnapshot;
  processCpuSnapshot = { usage: nowUsage, at: nowAt };

  const elapsedMicros = Math.max(1, Number(nowAt - prev.at) / 1000);
  const usedMicros = Math.max(0, (nowUsage.user - prev.usage.user) + (nowUsage.system - prev.usage.system));
  const cpuPercent = Math.min(100, Math.max(0, Math.round((usedMicros / elapsedMicros) * 100)));
  const memory = process.memoryUsage();

  return {
    cpuPercent,
    memoryBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    heapTotalBytes: memory.heapTotal
  };
};

const checkOllamaStatus = async () => {
  const cfg = Array.from(configCache.values()).find((entry) => entry?.aiChat?.enabled !== false);
  const ai = cfg?.aiChat || {};
  const baseUrl = String(ai.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '').replace(/\/api$/i, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1600);

  try {
    const response = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    const models = Array.isArray(data.models) ? data.models : [];
    return {
      online: response.ok,
      url: baseUrl,
      model: String(ai.model || models[0]?.name || models[0]?.model || 'Nicht gewählt'),
      installedModels: models.length
    };
  } catch {
    return {
      online: false,
      url: baseUrl,
      model: String(ai.model || 'Nicht gewählt'),
      installedModels: 0
    };
  } finally {
    clearTimeout(timer);
  }
};

const getLiveStatus = async () => {
  const botProcess = getBotProcessUsage();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = Math.max(0, totalMemory - freeMemory);
  const configs = Array.from(configCache.values());
  const activeAiConfig = configs.find((entry) => entry?.aiChat?.enabled !== false)?.aiChat || {};
  const enabledModules = configs.reduce((sum, cfg) => {
    return sum + featureCards.filter((feature) => getByPath(cfg, `${feature.id}.enabled`) !== false).length;
  }, 0);
  const totalModules = Math.max(1, configs.length * featureCards.length);

  return {
    dashboard: {
      online: true,
      port: PORT,
      uptimeSeconds: Math.round(process.uptime())
    },
    bot: {
      online: client.isReady(),
      tag: client.user?.tag || null,
      id: client.user?.id || null,
      guildCount: client.guilds.cache.size,
      pingMs: Number.isFinite(client.ws?.ping) ? Math.round(client.ws.ping) : null,
      uptimeSeconds: client.uptime ? Math.round(client.uptime / 1000) : 0
    },
    system: {
      platform: process.platform,
      cpuModel: os.cpus()?.[0]?.model || 'CPU',
      cpuCores: os.cpus()?.length || 0,
      loadAverage: os.loadavg?.()[0] || 0,
      memoryUsedBytes: usedMemory,
      memoryTotalBytes: totalMemory,
      memoryPercent: totalMemory ? Math.round((usedMemory / totalMemory) * 100) : 0,
      processMemoryBytes: botProcess.memoryBytes
    },
    botProcess,
    ai: await checkOllamaStatus(),
    webSearch: {
      enabled: activeAiConfig.webSearchEnabled === true,
      mode: activeAiConfig.webSearchEnabled === true ? 'Web zuerst' : 'Aus'
    },
    modules: {
      enabled: enabledModules,
      total: totalModules
    },
    serverTime: new Date().toISOString()
  };
};

const featureDispatcher = createFeatureDispatcher({
  features,
  runOperation: runTrackedOperation,
  recordError: (name, error, meta) => {
    console.error(`[${meta?.featureId || 'feature'}] ${meta?.hook || name} failed`, error);
  }
});
const dispatchHook = (hook, context) => featureDispatcher.dispatch(hook, context);

const getGuildModuleReadiness = async (guildId) => {
  const guild = client.guilds.cache.get(String(guildId || ''));
  if (!guild) return null;
  await Promise.all([
    guild.channels.fetch().catch(() => null),
    guild.roles.fetch().catch(() => null),
    guild.members.fetchMe().catch(() => null)
  ]);
  const cfg = await getCachedGuildConfig(guild.id, guild.name);
  const botMember = guild.members.me;
  const permissions = botMember?.permissions;
  const hasPermission = (flag) => Boolean(flag && permissions?.has?.(flag));
  const highestBotRolePosition = Number(botMember?.roles?.highest?.position || 0);
  const canManageRoles = hasPermission(PermissionFlagsBits.ManageRoles);
  const roles = guild.roles.cache
    .filter((role) => role.id !== guild.id && !role.managed)
    .map((role) => ({
      id: role.id,
      name: role.name,
      position: Number(role.position || 0),
      assignable: canManageRoles && Number(role.position || 0) < highestBotRolePosition
    }));
  const channels = guild.channels.cache.map((channel) => ({
    id: channel.id,
    name: channel.name || channel.id,
    type: Number(channel.type)
  }));
  return createModuleReadinessSnapshot({
    guildId: guild.id,
    guildName: guild.name,
    config: cfg,
    featureCards,
    channels,
    roles,
    capabilities: {
      manageRoles: canManageRoles,
      manageChannels: hasPermission(PermissionFlagsBits.ManageChannels),
      manageThreads: hasPermission(PermissionFlagsBits.ManageThreads),
      manageMessages: hasPermission(PermissionFlagsBits.ManageMessages),
      manageExpressions: hasPermission(PermissionFlagsBits.ManageGuildExpressions || PermissionFlagsBits.ManageEmojisAndStickers),
      createPrivateThreads: hasPermission(PermissionFlagsBits.CreatePrivateThreads),
      sendMessages: hasPermission(PermissionFlagsBits.SendMessages),
      embedLinks: hasPermission(PermissionFlagsBits.EmbedLinks)
    },
    runtimeSnapshot: featureDispatcher.getSnapshot()
  });
};

const aiOperationalStatusCache = new Map();
const getAiOperationalStatus = async (guildId) => {
  const key = String(guildId || '');
  const cached = aiOperationalStatusCache.get(key);
  if (cached && Date.now() - cached.at < 5_000) return cached.value;
  if (cached?.promise) return cached.promise;
  const promise = Promise.all([
    getLiveDiagnosticsSnapshot({ client, featureDispatch: featureDispatcher.getSnapshot() }).catch(() => null),
    getLiveStatus().catch(() => null),
    getGuildModuleReadiness(key).catch(() => null)
  ]).then(([diagnostics, liveStatus, readiness]) => ({ diagnostics, liveStatus, readiness }));
  aiOperationalStatusCache.set(key, { at: cached?.at || 0, value: cached?.value || null, promise });
  try {
    const value = await promise;
    aiOperationalStatusCache.set(key, { at: Date.now(), value, promise: null });
    return value;
  } catch (error) {
    aiOperationalStatusCache.delete(key);
    throw error;
  }
};

const getPresenceActivityType = (value) => {
  const key = String(value || 'Playing').trim();
  return ActivityType[key] || ActivityType.Playing;
};

const getPresenceStatus = (value) => {
  const status = String(value || 'online').trim();
  return ['online', 'idle', 'dnd', 'invisible'].includes(status) ? status : 'online';
};

const applyPresence = async (cfg = null) => {
  const first = cfg || activePresenceConfig || configCache.values().next().value || {};
  const statusMessage = first?.general?.statusMessage || 'Discord Bot aktiv';
  const statusType = getPresenceActivityType(first?.general?.statusType);
  const onlineStatus = getPresenceStatus(first?.general?.onlineStatus);

  if (!client.user) {
    return;
  }

  try {
    client.user.setPresence({
      activities: [{ name: statusMessage, type: statusType }],
      status: onlineStatus
    });
  } catch (error) {
    console.error('Discord Presence konnte nicht gesetzt werden', error);
  }
};

const runAutoBackups = async () => {
  const snapshot = Array.from(configCache.entries());
  if (!snapshot.length) {
    return;
  }

  await fs.mkdir(BACKUP_DIR, { recursive: true });

  for (const [guildId, cfg] of snapshot) {
    const minutes = Number(cfg.general?.autoBackupMinutes || 0);
    if (!(minutes > 0)) {
      continue;
    }

    const now = Date.now();
    const last = backupAt.get(guildId) || 0;
    const interval = minutes * 60 * 1000;
    if (now - last < interval) {
      continue;
    }

    const fileName = path.join(BACKUP_DIR, `${guildId}.json`);
    await fs.writeFile(fileName, JSON.stringify(cfg, null, 2), 'utf8');
    backupAt.set(guildId, now);
  }
};

const registerSlashCommands = async () => {
  if (!client.application?.commands) {
    return;
  }

  if (!commands.length) {
    return;
  }

  const definitions = commands.map((entry) => (entry.toJSON ? entry.toJSON() : entry));
  await client.application.commands.set([]).catch(() => {});

  await Promise.all(
    client.guilds.cache.map((guild) =>
      guild.commands.set(definitions).catch((error) => {
        console.error(`Slash-Befehle konnten für ${guild.name} nicht registriert werden`, error);
      })
    )
  );
};

client.once(Events.ClientReady, async () => {
  console.log(`Bot aktiv als ${client.user.tag}`);

  await Promise.all(Array.from(client.guilds.cache.values()).map((guild) => getCachedGuildConfig(guild.id, guild.name)));
  activePresenceConfig = configCache.values().next().value || null;
  await registerSlashCommands();
  await applyPresence();
  for (const guild of client.guilds.cache.values()) {
    const cfg = await getCachedGuildConfig(guild.id, guild.name);
    await dispatchHook('onClientReady', { cfg, client, guild });
  }

  loopState.presenceTimer = setInterval(() => {
    applyPresence().catch(() => {});
  }, 60_000);

  loopState.backupTimer = setInterval(() => {
    runAutoBackups().catch(() => {});
  }, 30_000);
});

client.on(Events.GuildCreate, async (guild) => {
  const cfg = await getCachedGuildConfig(guild.id, guild.name);
  console.log(`Guild beigetreten: ${guild.name}`, cfg?.guildName || guild.name);
});

client.on(Events.GuildDelete, (guild) => {
  configCache.delete(guild.id);
  backupAt.delete(guild.id);
});

client.on(Events.ThreadCreate, async (thread, newlyCreated) => {
  const guild = thread?.guild;
  if (!guild?.id) {
    return;
  }

  const cfg = await getCachedGuildConfig(guild.id, guild.name);
  if (!cfg) {
    return;
  }

  await dispatchHook('onThreadCreate', {
    thread,
    newlyCreated,
    cfg,
    client,
    guild
  });
});

client.on(Events.ThreadUpdate, async (oldThread, newThread) => {
  const guild = newThread?.guild || oldThread?.guild;
  if (!guild?.id) {
    return;
  }

  const cfg = await getCachedGuildConfig(guild.id, guild.name);
  if (!cfg) {
    return;
  }

  await dispatchHook('onThreadUpdate', {
    oldThread,
    newThread,
    cfg,
    client,
    guild
  });
});

client.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
  if (!newChannel?.guild?.id || newChannel.isThread?.() || !Object.prototype.hasOwnProperty.call(newChannel, 'topic')) return;
  const previousTopic = String(oldChannel?.topic || '');
  const incomingTopic = String(newChannel.topic || '');
  if (previousTopic === incomingTopic) return;
  if (consumeChannelTopicWrite(newChannel.guild.id, newChannel.id, incomingTopic)) return;
  await ensureChannelMessageCountersLoaded();
  const targetKey = channelMessageCounterKey(newChannel.guild.id, newChannel.id);
  if (!CHANNEL_MESSAGE_TOKEN_PATTERN.test(incomingTopic)) {
    CHANNEL_MESSAGE_TOKEN_PATTERN.lastIndex = 0;
    const existing = channelMessageCounters.get(targetKey);
    // Discord can emit the same bot-authored topic update more than once and
    // also after a reconnect. Never mistake the rendered counter value for a
    // manual removal of the stored template.
    if (existing?.enabled && existing.template && existing.placeholders?.length) {
      const expectedRenderedTopic = renderCounterTopicTemplate(existing.template, existing.placeholders);
      if (incomingTopic === expectedRenderedTopic || matchesRenderedCounterTemplate(existing.template, incomingTopic)) return;
    }
    if (existing?.enabled) {
      existing.enabled = false;
      existing.template = '';
      existing.placeholders = [];
      existing.lastError = '';
      existing.pendingSince = '';
      existing.nextSyncAt = '';
      existing.updatedAt = new Date().toISOString();
      saveChannelMessageCountersSoon();
    }
    return;
  }
  CHANNEL_MESSAGE_TOKEN_PATTERN.lastIndex = 0;
  try {
    const template = await localizeChannelTopicEmojis(newChannel.guild, incomingTopic);
    const placeholders = buildCounterPlaceholders(newChannel.guild, newChannel.id, template).map((item) => ({ ...item, guildId: newChannel.guild.id }));
    for (const placeholder of placeholders) {
      const sourceState = ensureCounterSourceState(newChannel.guild, placeholder.sourceChannelId);
      const indexedCount = await getIndexedChannelMessageCount(newChannel.guild.id, placeholder.sourceChannelId).catch(() => null);
      if (Number.isFinite(Number(indexedCount)) && Number(indexedCount) > Number(sourceState.count || 0)) sourceState.count = Math.max(0, Math.trunc(Number(indexedCount)));
      sourceState.updatedAt = new Date().toISOString();
    }
    const previous = channelMessageCounters.get(targetKey) || {};
    channelMessageCounters.set(targetKey, {
      ...previous,
      guildId: String(newChannel.guild.id),
      channelId: String(newChannel.id),
      enabled: true,
      template,
      placeholders,
      syncIntervalMs: normalizeChannelTopicSyncIntervalMs(previous.syncIntervalMs),
      revision: Math.max(0, Math.trunc(Number(previous.revision || 0))) + 1,
      appliedRevision: Math.max(0, Math.trunc(Number(previous.appliedRevision || 0))),
      pendingSince: String(previous.pendingSince || new Date().toISOString()),
      nextSyncAt: '',
      lastError: '',
      updatedAt: new Date().toISOString()
    });
    await persistChannelMessageCounters();
    scheduleChannelMessageCounterApply(newChannel.guild.id, newChannel.id);
  } catch (error) {
    const previous = channelMessageCounters.get(targetKey) || {};
    channelMessageCounters.set(targetKey, {
      ...previous,
      guildId: String(newChannel.guild.id), channelId: String(newChannel.id), enabled: false,
      template: incomingTopic, placeholders: [], lastError: `Manuelle Kanalthema-Vorlage konnte nicht aktiviert werden: ${error?.message || error}`,
      updatedAt: new Date().toISOString()
    });
    saveChannelMessageCountersSoon();
    console.warn(`[channel-counter] Manuelle Vorlage in #${newChannel.name || newChannel.id} fehlgeschlagen: ${error?.message || error}`);
  }
});

client.on(Events.ChannelCreate, async (channel) => {
  if (!channel?.guild?.id || channel.isThread?.()) return;
  const cfg = await getCachedGuildConfig(channel.guild.id, channel.guild.name);
  if (cfg) await dispatchHook('onChannelCreate', { channel, cfg, client, guild: channel.guild });
});

client.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
  const guild = newChannel?.guild || oldChannel?.guild;
  if (!guild?.id || newChannel?.isThread?.()) return;
  const cfg = await getCachedGuildConfig(guild.id, guild.name);
  if (cfg) await dispatchHook('onChannelUpdate', { oldChannel, newChannel, cfg, client, guild });
});

client.on(Events.ChannelDelete, async (channel) => {
  if (!channel?.guild?.id || channel.isThread?.()) return;
  const cfg = await getCachedGuildConfig(channel.guild.id, channel.guild.name);
  if (cfg) await dispatchHook('onChannelDelete', { channel, cfg, client, guild: channel.guild });
});

client.on(Events.GuildRoleCreate, async (role) => {
  const cfg = await getCachedGuildConfig(role.guild.id, role.guild.name);
  if (cfg) await dispatchHook('onRoleCreate', { role, cfg, client, guild: role.guild });
});

client.on(Events.GuildRoleUpdate, async (oldRole, newRole) => {
  const cfg = await getCachedGuildConfig(newRole.guild.id, newRole.guild.name);
  if (cfg) await dispatchHook('onRoleUpdate', { oldRole, newRole, cfg, client, guild: newRole.guild });
});

client.on(Events.GuildRoleDelete, async (role) => {
  const cfg = await getCachedGuildConfig(role.guild.id, role.guild.name);
  if (cfg) await dispatchHook('onRoleDelete', { role, cfg, client, guild: role.guild });
});

client.on(Events.MessageCreate, async (message) => {
  if (!message.guildId || !message.guild) {
    return;
  }

  await trackChannelMessageCount(message).catch((error) => {
    console.warn(`[channel-counter] Nachricht konnte nicht gezählt werden: ${error?.message || error}`);
  });

  const cfg = await getCachedGuildConfig(message.guildId, message.guild.name);
  if (!cfg) {
    return;
  }

  const context = {
    message,
    cfg,
    client,
    guild: message.guild,
    getAiOperationalStatus: () => getAiOperationalStatus(message.guildId)
  };
  if (message.author?.bot) {
    await dispatchHook('onBotMessageCreate', context);
    return;
  }
  await dispatchHook('onMessageCreate', context);
});

client.on(Events.MessageDelete, async (message) => {
  const guildId = message.guildId;
  if (!guildId || !message.guild) {
    return;
  }

  const cfg = await getCachedGuildConfig(guildId, message.guild.name);
  if (!cfg) {
    return;
  }

  await dispatchHook('onMessageDelete', {
    message,
    cfg,
    client,
    guild: message.guild
  });
});

client.on(Events.MessageBulkDelete, async (messages, channel) => {
  const guild = channel?.guild;
  if (!guild?.id) return;
  const cfg = await getCachedGuildConfig(guild.id, guild.name);
  if (cfg) await dispatchHook('onMessageBulkDelete', { messages, channel, cfg, client, guild });
});

client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
  if (!newMessage?.guildId || !newMessage.guild) {
    return;
  }

  const cfg = await getCachedGuildConfig(newMessage.guildId, newMessage.guild.name);
  if (!cfg) {
    return;
  }

  await dispatchHook('onMessageUpdate', {
    oldMessage,
    newMessage,
    cfg,
    client,
    guild: newMessage.guild
  });
});

client.on(Events.AutoModerationActionExecution, async (execution) => {
  const guild = execution?.guild;
  if (!guild) return;
  const cfg = await getCachedGuildConfig(guild.id, guild.name);
  if (!cfg) return;
  await dispatchHook('onAutoModerationActionExecution', {
    execution,
    cfg,
    client,
    guild
  });
});

client.on(Events.GuildMemberAdd, async (member) => {
  const cfg = await getCachedGuildConfig(member.guild.id, member.guild.name);
  if (!cfg) {
    return;
  }

  await dispatchHook('onGuildMemberAdd', {
    member,
    cfg,
    client,
    guild: member.guild
  });
});

client.on(Events.GuildMemberRemove, async (member) => {
  const cfg = await getCachedGuildConfig(member.guild.id, member.guild.name);
  if (!cfg) {
    return;
  }

  await dispatchHook('onGuildMemberRemove', {
    member,
    cfg,
    client,
    guild: member.guild
  });
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  const cfg = await getCachedGuildConfig(newMember.guild.id, newMember.guild.name);
  if (!cfg) {
    return;
  }

  await dispatchHook('onGuildMemberUpdate', {
    oldMember,
    newMember,
    cfg,
    client,
    guild: newMember.guild
  });
});

client.on(Events.UserUpdate, async (oldUser, newUser) => {
  for (const guild of client.guilds.cache.values()) {
    const member = guild.members.cache.get(String(newUser?.id || ''));
    if (!member) continue;
    const cfg = await getCachedGuildConfig(guild.id, guild.name);
    if (!cfg) continue;
    await dispatchHook('onUserUpdate', {
      oldUser,
      newUser,
      member,
      cfg,
      client,
      guild
    });
  }
});

client.on(Events.PresenceUpdate, async (oldPresence, newPresence) => {
  const guild = newPresence?.guild || oldPresence?.guild;
  if (!guild) return;
  const cfg = await getCachedGuildConfig(guild.id, guild.name);
  if (!cfg) return;

  await dispatchHook('onPresenceUpdate', {
    oldPresence,
    newPresence,
    cfg,
    client,
    guild
  });
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const guild = newState?.guild || oldState?.guild;
  if (!guild) return;
  const cfg = await getCachedGuildConfig(guild.id, guild.name);
  if (!cfg) return;

  await dispatchHook('onVoiceStateUpdate', {
    oldState,
    newState,
    cfg,
    client,
    guild
  });
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  await handleReactionRoleChange(reaction, user, true).catch((error) => recordDiagnosticError?.('reaction-role-add-event', error));
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  await handleReactionRoleChange(reaction, user, false).catch((error) => recordDiagnosticError?.('reaction-role-remove-event', error));
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (await handleReactionRoleButton(interaction).catch(async (error) => {
    recordDiagnosticError?.('reaction-role-button', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'Die Rolle konnte gerade nicht aktualisiert werden. Bitte versuche es erneut.', ephemeral: true }).catch(() => {});
    }
    return true;
  })) return;
  if (!interaction.guildId) {
    return;
  }

  const cfg = await getCachedGuildConfig(interaction.guildId, interaction.guild?.name || 'Server');
  if (!cfg) {
    return;
  }

  const context = {
    interaction,
    cfg,
    client,
    guild: interaction.guild
  };

  if (interaction.isChatInputCommand()) {
    await dispatchHook('onInteractionCreate', context);
    return;
  }

  await dispatchHook('onAnyInteraction', context);
});

client.on(Events.Error, (error) => {
  recordDiagnosticError('discord.client', error);
  console.error('Discord client error', error);
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cookieParser());
app.use(express.json({ limit: '40mb' }));

const isFallenHeavenLocalDomain = (req) => {
  const hostHeader = String(req.headers.host || req.get?.('host') || req.hostname || '').toLowerCase();
  const hostname = hostHeader.split(',')[0].trim().replace(/:\d+$/, '');
  return FALLEN_HEAVEN_LOCAL_DOMAINS.has(hostname);
};

app.get('/', (req, res, next) => {
  if (!isFallenHeavenLocalDomain(req)) {
    return next();
  }

  return res.sendFile(path.join(PUBLIC_DIR, 'fallen-heaven', 'index.html'));
});

app.get('/fallen-heaven/', (_req, res) => {
  return res.sendFile(path.join(PUBLIC_DIR, 'fallen-heaven', 'index.html'));
});

app.get(['/fallen-heaven', ...FALLEN_HEAVEN_LEGACY_HTML_PATHS], (_req, res) => {
  return res.redirect(302, FALLEN_HEAVEN_CANONICAL_PATH);
});

app.use('/public', express.static(PUBLIC_DIR));
app.use(express.static(PUBLIC_DIR));

const requireDesktopApp = (req, res, next) => {
  const expectedToken = String(process.env.FALLEN_HEAVEN_CONTROL_TOKEN || '');
  const suppliedToken = String(req.get('x-fallen-heaven-control') || '');
  if (req.get('x-fallen-heaven-app') !== 'desktop-control-v2' || !expectedToken || suppliedToken !== expectedToken) {
    return res.status(403).json({ ok: false, message: 'Nur die lokale FALLEN-HEAVEN-App darf diese Aktion ausführen.' });
  }
  res.set('x-fallen-heaven-instance', String(process.env.FALLEN_HEAVEN_INSTANCE_ID || 'unknown'));
  return next();
};

const requireDesktopProbe = (req, res, next) => {
  const expectedToken = String(process.env.FALLEN_HEAVEN_CONTROL_TOKEN || '');
  const suppliedToken = String(req.get('x-fallen-heaven-control') || '');
  const remoteAddress = String(req.socket?.remoteAddress || '');
  const isLoopback = remoteAddress === '::1' || remoteAddress === '127.0.0.1' || remoteAddress === '::ffff:127.0.0.1';
  const appMarkerValid = req.get('x-fallen-heaven-app') === 'desktop-control-v2';
  const tokenValid = Boolean(expectedToken && suppliedToken === expectedToken);
  if (!appMarkerValid || (!tokenValid && !isLoopback)) {
    return res.status(403).json({ ok: false, message: 'Nur die lokale FALLEN-HEAVEN-App darf Diagnosedaten lesen.' });
  }
  res.set('x-fallen-heaven-instance', String(process.env.FALLEN_HEAVEN_INSTANCE_ID || 'external-local-runtime'));
  return next();
};

app.get('/api/app/health', requireDesktopProbe, (_req, res) => {
  const memory = process.memoryUsage();
  const discordReady = client.isReady();
  res.json({
    ok: true,
    serviceReady: true,
    ready: discordReady,
    measuredAt: new Date().toISOString(),
    processId: process.pid,
    uptimeSeconds: Math.round(process.uptime()),
    dashboardReady: true,
    discordReady,
    discordUserId: client.user?.id || null,
    discordUserTag: client.user?.tag || null,
    guildCount: client.guilds.cache.size,
    pingMs: Number.isFinite(client.ws?.ping) ? Math.round(client.ws.ping) : null,
    uptimeMs: Math.round(process.uptime() * 1000),
    runtimeVersion: process.versions.node,
    moduleAbi: process.versions.modules,
    electronVersion: process.versions.electron || null,
    memory
  });
});

app.get('/api/app/diagnostics', requireDesktopProbe, async (_req, res) => {
  try {
    const liveDiagnostics = await getLiveDiagnosticsSnapshot({ client, featureDispatch: featureDispatcher.getSnapshot() });
    return res.json({ ok: true, liveDiagnostics });
  } catch (error) {
    recordDiagnosticError('Live-Diagnose', error, { source: 'desktop-api' });
    return res.json({
      ok: false,
      error: String(error?.message || error || 'Live-Diagnose fehlgeschlagen.').slice(0, 500)
    });
  }
});

app.get('/api/app/guild/:guildId/forum-cleaner', requireDesktopProbe, (req, res) => {
  const guild = client.guilds.cache.get(String(req.params.guildId || ''));
  if (!guild) return res.status(404).json({ ok: false, error: 'Server wurde nicht gefunden.' });
  return res.json({ ok: true, status: getForumCleanerSnapshot(guild.id) });
});

app.get('/api/app/guild/:guildId/emoji-rename-preview', requireDesktopProbe, async (req, res) => {
  try {
    const guild = client.guilds.cache.get(String(req.params.guildId || ''));
    if (!guild) return res.status(404).json({ ok: false, error: 'Server wurde nicht gefunden.' });
    const cfg = await Promise.resolve(getCachedGuildConfig(guild.id, guild.name));
    const preview = await createEmojiRenamePreview({
      guild,
      conf: cfg?.emojiManager,
      overrides: {
        oldPrefix: String(req.query.oldPrefix || cfg?.emojiManager?.oldPrefix || 'vl_'),
        newPrefix: String(req.query.newPrefix || cfg?.emojiManager?.newPrefix || 'fh_'),
        includeStatic: String(req.query.includeStatic || 'true') !== 'false',
        includeAnimated: String(req.query.includeAnimated || 'true') !== 'false'
      }
    });
    return res.json({ ok: true, preview });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error?.message || 'Emoji-Vorschau fehlgeschlagen.' });
  }
});

app.use('/api/app', requireDesktopApp);

app.get('/api/app/system/status', requireDesktopApp, async (_req, res) => res.json(await getSystemStatus()));
app.post('/api/app/system/:action', requireDesktopApp, async (req, res) => {
  const actions = { start: startSystem, stop: stopSystem, restart: restartSystem };
  const action = actions[String(req.params.action || '').toLowerCase()];
  if (!action) return res.status(404).json({ ok: false, running: client.isReady(), message: 'Unbekannte Bot-Aktion.' });
  const result = await action();
  return res.status(result.ok === false ? 500 : 200).json(result);
});

mountDashboard(app, {
  appVersion: APP_VERSION,
  listGuilds: async () => getGuildSummaries(),
  getConfig: (guildId) => getCachedGuildConfig(guildId),
  setConfig: (guildId, patch, options = {}) => saveGuildConfig(guildId, patch, options),
  getAllConfigs: async () => getAllGuildConfigs(),
  featureCards,
  getDefaultConfig: defaultGuildConfig,
  getGuildName,
  getGuildOwnerId,
  getGuildStats,
  getModuleReadiness: getGuildModuleReadiness,
  getGuildManagement,
  listDashboardSystemEvents,
  listGuildMessages,
  updateDashboardChannel,
  updateDashboardMessage,
  deleteDashboardMessage,
  listServerBackups: async (guildId) => listServerStructureBackups(guildId),
  createServerBackup: async (guildId, actorId = '') => {
    const guild = client.guilds.cache.get(String(guildId || ''));
    if (!guild) throw new Error('Server wurde nicht gefunden.');
    const cfg = await Promise.resolve(getCachedGuildConfig(guild.id, guild.name));
    return createServerStructureBackup({ guild, conf: cfg?.serverBackup, actorId, source: 'manual' });
  },
  previewServerRestore: async (guildId, backupId) => {
    const guild = client.guilds.cache.get(String(guildId || ''));
    if (!guild) throw new Error('Server wurde nicht gefunden.');
    return previewServerStructureRestore({ guild, backupId });
  },
  restoreServerBackup: async (guildId, backupId, restoreOptions = {}, actorId = '') => {
    const guild = client.guilds.cache.get(String(guildId || ''));
    if (!guild) throw new Error('Server wurde nicht gefunden.');
    const cfg = await Promise.resolve(getCachedGuildConfig(guild.id, guild.name));
    return restoreServerStructureBackup({ guild, conf: cfg?.serverBackup, backupId, options: restoreOptions, actorId });
  },
  listMessageEmojis: async (guildId) => {
    const guild = client.guilds.cache.get(String(guildId || ''));
    if (!guild) throw new Error('Server wurde nicht gefunden.');

    await guild.emojis.fetch().catch(() => null);
    const applicationId = client.application?.id || client.user?.id;
    let applicationEmojis = [];
    if (applicationId) {
      try {
        const route = typeof Routes.applicationEmojis === 'function'
          ? Routes.applicationEmojis(applicationId)
          : `/applications/${applicationId}/emojis`;
        const response = await client.rest.get(route);
        applicationEmojis = Array.isArray(response) ? response : (Array.isArray(response?.items) ? response.items : []);
      } catch (error) {
        console.warn('Application Emojis konnten nicht geladen werden:', error?.message || error);
      }
    }

    const serializeEmoji = (emoji, source) => {
      const id = String(emoji?.id || '');
      const name = String(emoji?.name || 'emoji');
      const animated = emoji?.animated === true;
      return {
        id,
        name,
        animated,
        available: emoji?.available !== false,
        source,
        mention: `<${animated ? 'a' : ''}:${name}:${id}>`,
        url: `https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}?size=128&quality=lossless`
      };
    };

    return [
      ...applicationEmojis.map((emoji) => serializeEmoji(emoji, 'application')),
      ...guild.emojis.cache.map((emoji) => serializeEmoji(emoji, 'guild'))
    ]
      .filter((emoji) => emoji.id && emoji.name)
      .sort((left, right) => {
        if (left.source !== right.source) return left.source === 'application' ? -1 : 1;
        return left.name.localeCompare(right.name, 'de', { sensitivity: 'base' });
      });
  },
  listTextChannels,
  listConfigRoles: async (guildId) => {
    const guild = client.guilds.cache.get(String(guildId || ''));
    if (!guild) return [];

    // Discord.js keeps this cache current through role create/update/delete
    // events. Returning it directly avoids a full Discord API round-trip every
    // time a module is opened, which previously made channel/boost forms stall.
    const botMember = guild.members.me;
    const canManageRoles = Boolean(botMember?.permissions?.has?.(PermissionFlagsBits.ManageRoles));
    const highestBotRolePosition = Number(botMember?.roles?.highest?.position || 0);
    return guild.roles.cache
      .filter((role) => role.id !== guild.id && !role.managed)
      .sort(compareDiscordRoleHierarchy)
      .map((role) => {
        const assignable = canManageRoles && Number(role.position || 0) < highestBotRolePosition;
        return {
          id: role.id,
          name: role.name,
          color: role.color,
          position: role.position,
          rawPosition: discordPosition(role),
          assignable,
          blockedReason: assignable
            ? ''
            : !canManageRoles
              ? 'Dem Bot fehlt die Berechtigung „Rollen verwalten“.'
              : 'Diese Rolle liegt über oder auf gleicher Höhe wie die höchste Bot-Rolle.'
        };
      });
  },
  listDashboardMembers,
  getServerTagTrackerStatus: async (guildId) => getServerTagTrackerSnapshot(guildId),
  getVoiceChatCleanerStatus: async (guildId) => getVoiceChatCleanerSnapshot(guildId),
  getForumCleanerStatus: async (guildId) => getForumCleanerSnapshot(guildId),
  scanForumCleaner: async (guildId) => {
    const guild = client.guilds.cache.get(String(guildId || ''));
    if (!guild) throw new Error('Server wurde nicht gefunden.');
    const cfg = await Promise.resolve(getCachedGuildConfig(guild.id, guild.name));
    return queueForumDeepScan({ guild, conf: cfg?.forumCleaner, source: 'manualDashboard' });
  },
  getSteamWorkshopStatus: async (guildId) => getSteamWorkshopSnapshot(guildId),
  syncSteamWorkshop: async (guildId) => {
    const guild = client.guilds.cache.get(String(guildId || ''));
    if (!guild) throw new Error('Server wurde nicht gefunden.');
    const cfg = await Promise.resolve(getCachedGuildConfig(guild.id, guild.name));
    return syncSteamWorkshop({ guild, conf: cfg?.steamWorkshop, source: 'manualDashboard' });
  },
  saveSteamWorkshopDesign: async (guildId, payload = {}) => {
    const guild = client.guilds.cache.get(String(guildId || ''));
    if (!guild) throw new Error('Server wurde nicht gefunden.');
    const cfg = await Promise.resolve(getCachedGuildConfig(guild.id, guild.name));
    const template = payload?.template && typeof payload.template === 'object' ? payload.template : payload;
    const embeds = Array.isArray(template?.embeds) && template.embeds.length ? template.embeds : [template?.embed || {}];
    if (embeds.length !== 1) throw new Error('Der Workshop-Katalog verwendet genau ein Embed pro Mod.');
    const sourceEmbed = embeds[0] || {};
    const sourceOutsideImage = String(template?.outsideImageUrl || '').trim();
    const dataImageMatch = sourceOutsideImage.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([a-z0-9+/=\r\n]+)$/i);
    const outsideFile = dataImageMatch ? Buffer.from(dataImageMatch[2], 'base64') : null;
    if (sourceOutsideImage.startsWith('data:') && !outsideFile) {
      throw new Error('Das ausgewählte Workshop-Banner ist keine gültige PNG-, JPG-, WEBP- oder GIF-Datei.');
    }
    if (!outsideFile && sourceOutsideImage && !/^https?:\/\/[^\s]+$/i.test(sourceOutsideImage)) {
      throw new Error('Workshop-Banner: Bitte eine vollständige HTTP(S)-Bildadresse oder eine Bilddatei verwenden.');
    }
    const fields = Array.isArray(sourceEmbed.fields) ? sourceEmbed.fields : [];
    const reservedFields = cfg.steamWorkshop?.showRating !== false ? 1 : 0;
    if (fields.length > 25 - reservedFields) {
      throw new Error(`Die Steam-Bewertung reserviert ein Discord-Feld. Es sind höchstens ${25 - reservedFields} eigene Felder möglich.`);
    }
    const characterCount = [sourceEmbed.title, sourceEmbed.description, sourceEmbed.authorName, sourceEmbed.footerText]
      .concat(fields.flatMap((field) => [field?.name, field?.value]))
      .reduce((total, value) => total + String(value || '').length, 0);
    if (characterCount > 5_700) throw new Error('Die Vorlage ist zu lang. Reserviere mindestens 300 Zeichen für ersetzte Steam-Daten.');
    let bannerAsset = {
      name: String(cfg.steamWorkshop?.design?.outsideImageAssetName || ''),
      size: Math.max(0, Number(cfg.steamWorkshop?.design?.outsideImageAssetSize || 0))
    };
    if (outsideFile) {
      bannerAsset = await saveSteamWorkshopBannerAsset({
        guildId: guild.id,
        buffer: outsideFile,
        fileName: String(template?.outsideImageName || ''),
        contentType: String(dataImageMatch?.[1] || '')
      });
    } else if (template?.removeOutsideImage === true || sourceOutsideImage) {
      await removeSteamWorkshopBannerAsset(guild.id);
      bannerAsset = { name: '', size: 0 };
    }
    const design = {
      content: String(template?.content || '').slice(0, 2_000),
      outsideImageUrl: outsideFile ? '' : sourceOutsideImage,
      outsideImageAssetName: String(bannerAsset?.name || ''),
      outsideImageAssetSize: Math.max(0, Number(bannerAsset?.size || 0)),
      embed: {
        title: sourceEmbed.title,
        url: sourceEmbed.url,
        description: sourceEmbed.description,
        color: sourceEmbed.color,
        authorName: sourceEmbed.authorName,
        authorIconUrl: sourceEmbed.authorIconUrl,
        thumbnailUrl: sourceEmbed.thumbnailUrl,
        imageUrl: sourceEmbed.imageUrl,
        footerText: sourceEmbed.footerText,
        footerIconUrl: sourceEmbed.footerIconUrl,
        timestamp: sourceEmbed.timestamp !== false,
        fields
      }
    };
    const saved = await saveGuildConfig(guild.id, {
      steamWorkshop: { ...cfg.steamWorkshop, design }
    });
    const result = await applySteamWorkshopDesign({ guild, conf: saved.steamWorkshop, design });
    return { config: saved.steamWorkshop, sync: result.sync };
  },
  saveSteamWorkshopItemDesign: async (guildId, workshopId, payload = {}) => {
    const guild = client.guilds.cache.get(String(guildId || ''));
    if (!guild) throw new Error('Server wurde nicht gefunden.');
    const cfg = await Promise.resolve(getCachedGuildConfig(guild.id, guild.name));
    const id = String(workshopId || '').trim();
    if (!/^\d{6,20}$/.test(id)) throw new Error('Die Steam-Workshop-ID ist ungültig.');
    const template = payload?.template && typeof payload.template === 'object' ? payload.template : payload;
    const embeds = Array.isArray(template?.embeds) && template.embeds.length ? template.embeds : [template?.embed || {}];
    if (embeds.length !== 1) throw new Error('Ein Workshop-Post verwendet genau ein Embed.');
    const sourceEmbed = embeds[0] || {};
    const sourceOutsideImage = String(template?.outsideImageUrl || '').trim();
    const dataImageMatch = sourceOutsideImage.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([a-z0-9+/=\r\n]+)$/i);
    const outsideFile = dataImageMatch ? Buffer.from(dataImageMatch[2], 'base64') : null;
    if (sourceOutsideImage.startsWith('data:') && !outsideFile) throw new Error('Das individuelle Workshop-Banner ist keine gültige PNG-, JPG-, WEBP- oder GIF-Datei.');
    if (!outsideFile && sourceOutsideImage && !/^https?:\/\/[^\s]+$/i.test(sourceOutsideImage)) {
      throw new Error('Individuelles Workshop-Banner: Bitte eine vollständige HTTP(S)-Bildadresse oder eine Bilddatei verwenden.');
    }
    const fields = Array.isArray(sourceEmbed.fields) ? sourceEmbed.fields : [];
    const reservedFields = cfg.steamWorkshop?.showRating !== false ? 1 : 0;
    if (fields.length > 25 - reservedFields) throw new Error(`Die Steam-Bewertung reserviert ein Discord-Feld. Es sind höchstens ${25 - reservedFields} eigene Felder möglich.`);
    const characterCount = [sourceEmbed.title, sourceEmbed.description, sourceEmbed.authorName, sourceEmbed.footerText]
      .concat(fields.flatMap((field) => [field?.name, field?.value]))
      .reduce((total, value) => total + String(value || '').length, 0);
    if (characterCount > 5_700) throw new Error('Das individuelle Embed ist zu lang. Reserviere mindestens 300 Zeichen für ersetzte Steam-Daten.');
    const snapshot = await getSteamWorkshopSnapshot(guild.id);
    const current = snapshot.items.find((item) => String(item.workshopId) === id) || {};
    let bannerAsset = {
      name: String(current?.itemBannerAsset?.name || ''),
      size: Math.max(0, Number(current?.itemBannerAsset?.size || 0))
    };
    let assetMode = ['global', 'item', 'none'].includes(String(template?.workshopAssetMode || ''))
      ? String(template.workshopAssetMode)
      : current?.assetMode || (current?.customized ? 'none' : 'global');
    if (outsideFile) {
      bannerAsset = await saveSteamWorkshopItemBannerAsset({
        guildId: guild.id,
        workshopId: id,
        buffer: outsideFile,
        fileName: String(template?.outsideImageName || ''),
        contentType: String(dataImageMatch?.[1] || '')
      });
      assetMode = 'item';
    } else if (template?.removeOutsideImage === true || sourceOutsideImage) {
      await removeSteamWorkshopItemBannerAsset(guild.id, id);
      bannerAsset = { name: '', size: 0 };
      assetMode = 'none';
    } else if (assetMode !== 'item' && current?.itemBannerAsset) {
      await removeSteamWorkshopItemBannerAsset(guild.id, id);
      bannerAsset = { name: '', size: 0 };
    }
    const design = {
      content: String(template?.content || '').slice(0, 2_000),
      outsideImageUrl: outsideFile ? '' : sourceOutsideImage,
      outsideImageAssetName: assetMode === 'item' ? String(bannerAsset?.name || '') : '',
      outsideImageAssetSize: assetMode === 'item' ? Math.max(0, Number(bannerAsset?.size || 0)) : 0,
      embed: {
        title: sourceEmbed.title,
        url: sourceEmbed.url,
        description: sourceEmbed.description,
        color: sourceEmbed.color,
        authorName: sourceEmbed.authorName,
        authorIconUrl: sourceEmbed.authorIconUrl,
        thumbnailUrl: sourceEmbed.thumbnailUrl,
        imageUrl: sourceEmbed.imageUrl,
        footerText: sourceEmbed.footerText,
        footerIconUrl: sourceEmbed.footerIconUrl,
        timestamp: sourceEmbed.timestamp !== false,
        fields
      }
    };
    return applySteamWorkshopItemDesign({
      guild,
      conf: cfg.steamWorkshop,
      workshopId: id,
      design,
      assetMode,
      threadName: String(template?.forumPost?.name || '')
    });
  },
  resetSteamWorkshopItemDesign: async (guildId, workshopId) => {
    const guild = client.guilds.cache.get(String(guildId || ''));
    if (!guild) throw new Error('Server wurde nicht gefunden.');
    const cfg = await Promise.resolve(getCachedGuildConfig(guild.id, guild.name));
    return resetSteamWorkshopItemDesign({ guild, conf: cfg.steamWorkshop, workshopId });
  },
  getEmojiManagerStatus: async (guildId) => getEmojiManagerSnapshot(guildId),
  getActivityRaceStatus: async (guildId) => {
    const guild = client.guilds.cache.get(String(guildId || ''));
    if (!guild) throw new Error('Server wurde nicht gefunden.');
    return getActivityRaceSnapshot(guild);
  },
  previewActivityRaceRoles: async (guildId, payload = {}) => {
    const guild = client.guilds.cache.get(String(guildId || ''));
    if (!guild) throw new Error('Server wurde nicht gefunden.');
    const cfg = await Promise.resolve(getCachedGuildConfig(guild.id, guild.name));
    return previewActivityRaceRoleSet({ guild, conf: { ...cfg?.activityRace, ...(payload?.config || {}) } });
  },
  createActivityRaceRoles: async (guildId, payload = {}, actorId = '') => {
    const guild = client.guilds.cache.get(String(guildId || ''));
    if (!guild) throw new Error('Server wurde nicht gefunden.');
    const cfg = await Promise.resolve(getCachedGuildConfig(guild.id, guild.name));
    const result = await createActivityRaceRoleSet({ guild, token: payload?.token, actorId });
    const activityRace = { ...cfg.activityRace, ...(payload?.config || {}), ...result.patch };
    const saved = await saveGuildConfig(guild.id, { activityRace });
    return { ...result, config: saved.activityRace };
  },
  refreshActivityRace: async (guildId) => {
    const guild = client.guilds.cache.get(String(guildId || ''));
    if (!guild) throw new Error('Server wurde nicht gefunden.');
    const cfg = await Promise.resolve(getCachedGuildConfig(guild.id, guild.name));
    return refreshActivityRace({ guild, conf: { ...cfg.activityRace, generalTimezone: cfg.general?.timezone } });
  },
  saveActivityRaceDesign: async (guildId, payload = {}) => {
    const guild = client.guilds.cache.get(String(guildId || ''));
    if (!guild) throw new Error('Server wurde nicht gefunden.');
    const cfg = await Promise.resolve(getCachedGuildConfig(guild.id, guild.name));
    const template = payload?.template && typeof payload.template === 'object' ? payload.template : payload;
    const embeds = Array.isArray(template?.embeds) && template.embeds.length ? template.embeds : [template?.embed || {}];
    if (embeds.length !== 1) throw new Error('Die Aktivitäts-Liga verwendet genau ein automatisch aktualisiertes Embed.');
    const sourceEmbed = embeds[0] || {};
    const sourceOutsideImage = String(template?.outsideImageUrl || '').trim();
    const dataImageMatch = sourceOutsideImage.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([a-z0-9+/=\r\n]+)$/i);
    const outsideFile = dataImageMatch ? Buffer.from(dataImageMatch[2], 'base64') : null;
    if (sourceOutsideImage.startsWith('data:') && !outsideFile) throw new Error('Das ausgewählte Außenbild ist keine gültige PNG-, JPG-, WEBP- oder GIF-Datei.');
    if (!outsideFile && !template?.outsideImageAttachment && sourceOutsideImage
      && String(template?.content || '').length + sourceOutsideImage.length + 1 > 2_000) {
      throw new Error('Nachricht und Außenbild-Link dürfen zusammen maximal 2.000 Zeichen enthalten.');
    }
    const customFields = Array.isArray(sourceEmbed.fields) ? sourceEmbed.fields : [];
    if (customFields.length > 21) throw new Error('Die Aktivitäts-Liga reserviert vier Discord-Felder. Es sind höchstens 21 eigene Felder möglich.');
    const customCharacterCount = [sourceEmbed.title, sourceEmbed.description, sourceEmbed.authorName, sourceEmbed.footerText]
      .concat(customFields.flatMap((field) => [field?.name, field?.value]))
      .reduce((total, value) => total + String(value || '').length, 0);
    if (customCharacterCount > 5_000) throw new Error('Die Liga-Vorlage ist zu lang. Für die automatisch erzeugten Ranglisten müssen mindestens 1.000 Embed-Zeichen frei bleiben.');
    const imageEntries = [
      ['Außenbild', sourceOutsideImage],
      ['Autor-Icon', sourceEmbed.authorIconUrl],
      ['Thumbnail', sourceEmbed.thumbnailUrl],
      ['Embed-Bild', sourceEmbed.imageUrl],
      ['Footer-Icon', sourceEmbed.footerIconUrl]
    ];
    const invalidImage = imageEntries.find(([label, value]) => {
      const normalized = String(value || '').trim();
      if (!normalized) return false;
      if (label === 'Außenbild' && dataImageMatch) return false;
      return !/^https?:\/\/[^\s]+$/i.test(normalized);
    });
    if (invalidImage) throw new Error(`${invalidImage[0]}: Bitte eine vollständige HTTP(S)-Bildadresse oder eine Bilddatei verwenden.`);
    const panelDesign = {
      content: String(template?.content || ''),
      outsideImageUrl: outsideFile ? '' : sourceOutsideImage,
      outsideImageAttachment: outsideFile || template?.removeOutsideImage === true
        ? null
        : template?.outsideImageAttachment || null,
      embed: {
        title: sourceEmbed.title,
        url: sourceEmbed.url,
        description: sourceEmbed.description,
        color: template?.activityRaceUsePeriodColor === true ? '' : sourceEmbed.color,
        authorName: sourceEmbed.authorName,
        authorIconUrl: sourceEmbed.authorIconUrl,
        thumbnailUrl: sourceEmbed.thumbnailUrl,
        imageUrl: sourceEmbed.imageUrl,
        footerText: sourceEmbed.footerText,
        footerIconUrl: sourceEmbed.footerIconUrl,
        timestamp: sourceEmbed.timestamp !== false,
        fields: Array.isArray(sourceEmbed.fields) ? sourceEmbed.fields : []
      }
    };
    const result = await applyActivityRacePanelDesign({
      guild,
      conf: { ...cfg.activityRace, generalTimezone: cfg.general?.timezone },
      panelDesign,
      panelChannelId: template?.channelId || cfg.activityRace?.panelChannelId,
      outsideFile,
      outsideFileName: template?.outsideImageName,
      removeOutsideImage: template?.removeOutsideImage === true
    });
    const activityRace = {
      ...cfg.activityRace,
      panelChannelId: result.panelChannelId,
      panelDesign: result.panelDesign
    };
    const saved = await saveGuildConfig(guild.id, { activityRace });
    return { config: saved.activityRace, panel: result.panel };
  },
  previewEmojiRename: async (guildId, payload = {}) => {
    const guild = client.guilds.cache.get(String(guildId || ''));
    if (!guild) throw new Error('Server wurde nicht gefunden.');
    const cfg = await Promise.resolve(getCachedGuildConfig(guild.id, guild.name));
    return createEmojiRenamePreview({ guild, conf: cfg?.emojiManager, overrides: payload });
  },
  applyEmojiRename: async (guildId, payload = {}, actorId = '') => {
    const guild = client.guilds.cache.get(String(guildId || ''));
    if (!guild) throw new Error('Server wurde nicht gefunden.');
    const cfg = await Promise.resolve(getCachedGuildConfig(guild.id, guild.name));
    return applyEmojiRenamePlan({ guild, conf: cfg?.emojiManager, payload, actorId });
  },
  syncServerTagTracker: async (guildId, actorId = '') => {
    const guild = client.guilds.cache.get(String(guildId || ''));
    if (!guild) throw new Error('Server wurde nicht gefunden.');
    const cfg = await Promise.resolve(getCachedGuildConfig(guild.id));
    return queueServerTagReconcile({ guild, conf: cfg?.serverTagTracker, source: 'manual', actorId });
  },
  getBoostSystemIndexStatus,
  syncBoostRoles: async (guildId, actorId = '') => {
    const guild = client.guilds.cache.get(String(guildId || ''));
    if (!guild) throw new Error('Server wurde nicht gefunden.');
    const cfg = await Promise.resolve(getCachedGuildConfig(guild.id));
    return startBoostRoleReconcile({ guild, conf: cfg?.boostRoles, actorId });
  },
  previewBoostActivityImport: async (guildId, payload = {}) => {
    const guild = client.guilds.cache.get(String(guildId || ''));
    if (!guild) throw new Error('Server wurde nicht gefunden.');
    return previewBoostActivityImport({ guild, text: payload.text });
  },
  importBoostActivityList: async (guildId, payload = {}, actorId = '') => {
    const guild = client.guilds.cache.get(String(guildId || ''));
    if (!guild) throw new Error('Server wurde nicht gefunden.');
    const cfg = await Promise.resolve(getCachedGuildConfig(guild.id));
    return importBoostActivityList({ guild, conf: cfg?.boostRoles, text: payload.text, actorId });
  },
  updateBoostBaselineMember: async (guildId, payload = {}, actorId = '') => {
    const guild = client.guilds.cache.get(String(guildId || ''));
    if (!guild) throw new Error('Server wurde nicht gefunden.');
    const cfg = await Promise.resolve(getCachedGuildConfig(guild.id));
    return updateBoostBaselineMember({
      guild,
      conf: cfg?.boostRoles,
      userId: payload.userId,
      count: payload.count,
      actorId
    });
  },
  getHeavenEconomyAdmin: async (guildId, options = {}) => {
    const guild = client.guilds.cache.get(String(guildId || ''));
    if (!guild) throw new Error('Server wurde nicht gefunden.');
    const cfg = await Promise.resolve(getCachedGuildConfig(guild.id, guild.name));
    return getHeavenEconomyAdminSnapshot({ guild, cfg, ...options });
  },
  updateHeavenEconomyAdmin: async (guildId, payload = {}, actorId = '') => {
    const guild = client.guilds.cache.get(String(guildId || ''));
    if (!guild) throw new Error('Server wurde nicht gefunden.');
    const cfg = await Promise.resolve(getCachedGuildConfig(guild.id, guild.name));
    return updateHeavenEconomyAccount({ guild, cfg, payload, actorId });
  },
  reconcileHeavenEconomyAdmin: async (guildId, actorId = '') => {
    const guild = client.guilds.cache.get(String(guildId || ''));
    if (!guild) throw new Error('Server wurde nicht gefunden.');
    const cfg = await Promise.resolve(getCachedGuildConfig(guild.id, guild.name));
    return reconcileHeavenEconomyBoostMilestones({ guild, cfg, actorId, refreshMembers: true, source: 'manual' });
  },
  verifyBoostCount: async (guildId, payload = {}, actorId = '') => {
    const guild = client.guilds.cache.get(String(guildId || ''));
    if (!guild) throw new Error('Server wurde nicht gefunden.');
    const cfg = await Promise.resolve(getCachedGuildConfig(guild.id));
    return verifyBoostCountFromDiscord({ guild, conf: cfg?.boostRoles, userId: payload.userId, actorId });
  },
  getDashboardMember,
  getMemberIntelligenceStatus,
  moderateDashboardMember,
  getDashboardRole,
  updateDashboardRole,
  generateEmbedAssistantText,
  generateSkinAssistantRecipe,
  sendGuildEmbed,
  editGuildEmbed,
  createGuildThread,
  listAiMemories,
  getAiMemory,
  deleteAiMemory,
  getLiveStatus,
  isDiscordReady: () => client.isReady(),
  systemActions: {
    status: getSystemStatus,
    start: startSystem,
    stop: stopSystem,
    restart: restartSystem
  }
});

app.get('/', (_req, res) => {
  return res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Express 5 uses path-to-regexp v8, where a bare '*' is no longer valid.
// A regular expression keeps the previous catch-all semantics on v4 and v5.
app.get(/.*/, (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }

  return res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

const startHttpListener = (port, label) => {
  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`${label} erreichbar: http://127.0.0.1${Number(port) === 80 ? '' : `:${port}`}`);
  });

  server.on('error', (error) => {
    console.error(`${label} Port ${port} konnte nicht gestartet werden:`, error?.message || error);
  });

  return server;
};

const startHttpsListener = (port, label) => {
  if (!existsSync(LOCAL_HTTPS_PFX)) {
    console.log(`HTTPS nicht aktiv: Zertifikat fehlt (${LOCAL_HTTPS_PFX}).`);
    console.log('Fuehre setup-fallen-heaven-https.ps1 aus, um https://www.fallen-heaven-discord-server.de/ zu aktivieren.');
    return null;
  }

  const server = https.createServer(
    {
      pfx: readFileSync(LOCAL_HTTPS_PFX),
      passphrase: LOCAL_HTTPS_PFX_PASSWORD
    },
    app
  );

  server.listen(port, () => {
    console.log(`${label} erreichbar: https://localhost${Number(port) === 443 ? '' : `:${port}`}`);
  });

  server.on('error', (error) => {
    console.error(`${label} HTTPS Port ${port} konnte nicht gestartet werden:`, error?.message || error);
  });

  return server;
};

startHttpListener(PORT, 'Dashboard');

const PUBLIC_WEB_PORT = Number(process.env.PUBLIC_WEB_PORT || 0);
if (PUBLIC_WEB_PORT && PUBLIC_WEB_PORT !== PORT) {
  startHttpListener(PUBLIC_WEB_PORT, 'FALLEN HEAVEN Webseite');
}

const PUBLIC_HTTPS_PORT = Number(process.env.PUBLIC_HTTPS_PORT || 0);
if (PUBLIC_HTTPS_PORT) {
  startHttpsListener(PUBLIC_HTTPS_PORT, 'FALLEN HEAVEN sichere Webseite');
}

const bootstrap = async () => {
  const dataMigration = await migrateDataGenerationV4();
  if (dataMigration.migrated) {
    console.log(`App-Daten auf Generation ${dataMigration.appGeneration} vorbereitet. Sicherung: ${dataMigration.snapshot}`);
  }
  if (dataMigration.validation?.ok === false) {
    console.warn(`Datenmigration hat ungültige JSON-Dateien erkannt: ${dataMigration.validation.invalidFiles.join(', ')}`);
  }
  await initializeStorage();

  const token = process.env.DISCORD_TOKEN;
  if (!token || token === 'PASTE_YOUR_TOKEN_HERE') {
    console.error('DISCORD_TOKEN fehlt in .env. Dashboard bleibt im Setup-Modus online.');
    return;
  }

  await client.login(token).catch((error) => {
    console.error('Login fehlgeschlagen', error);
    console.error('Dashboard bleibt online, damit die Konfiguration korrigiert werden kann.');
  });
};

bootstrap().catch((error) => {
  console.error('Startup failed', error);
  process.exit(1);
});
