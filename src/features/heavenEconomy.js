import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder
} from 'discord.js';
import { isAllowedEmbedImageUrl, materializeOutsideImageTemplate, readLocalImage } from '../runtime/localImageStore.js';
import { buildStudioEmbedPayload } from '../runtime/studioEmbedPayload.js';
import { applyManagedRolePolicy } from '../runtime/managedRoleService.js';
import {
  getBoostStatusSnapshot,
  parseBoostInfoMessage,
  waitForBoostLedgerEvent,
  waitForBoostRoleReconcile
} from './boostRoles.js';
import { quietLog, QUIET_LOG_SCOPE } from '../runtime/quietLog.js';
import { finiteInteger, resolveAvatarUrl } from '../runtime/utils.js';
import { atomicWriteJson, readJsonWithRecovery } from '../runtime/atomicJsonStore.js';
import { DATA_DIR } from '../shared/paths.js';

const DATA_ROOT = DATA_DIR;
const ECONOMY_FILE = path.join(DATA_ROOT, 'heaven-economy.json');
const PANEL_FILE = path.join(DATA_ROOT, 'heaven-economy-panels.json');
const ECONOMY_VERSION = 3;
const COIN_GIFT_INTENT_TTL_MS = 10 * 60 * 1000;
let mutationQueue = Promise.resolve();
// Sicherheitsnetz-Intervall: Meilenstein-Vergütungen werden event-basiert
// (Boost-Nachrichten) sofort abgewickelt. Der periodische Lauf korrigiert nur
// verpasste Fälle und refresht VIP-Panels – alle 30 Minuten reicht dafür
// (vorher alle 5 Minuten, das verursachte unnötige API-Last).
const ECONOMY_RECONCILE_INTERVAL_MS = 30 * 60 * 1000;
const BOOST_SETTLEMENT_DELAYS_MS = [0, 1200, 4000, 10_000, 30_000, 120_000];
const boostSettlementJobs = new Map();
const economyReconcileTimers = new Map();
const economyReconcileStatus = new Map();
const economyPanelRefreshJobs = new Map();

const emptyData = () => ({ version: ECONOMY_VERSION, guilds: {} });
const normalizeBoostLevels = (value, maximum = 99) => [...new Set((Array.isArray(value) ? value : [])
  .map((level) => finiteInteger(level, 0, 0, maximum))
  .filter((level) => level > 0))]
  .sort((left, right) => left - right);
const normalizeEconomyData = (input) => {
  const data = input && typeof input === 'object' ? input : emptyData();
  data.version = ECONOMY_VERSION;
  data.guilds = data.guilds && typeof data.guilds === 'object' ? data.guilds : {};
  for (const guild of Object.values(data.guilds)) {
    guild.accounts = guild?.accounts && typeof guild.accounts === 'object' ? guild.accounts : {};
    guild.transactions = Array.isArray(guild?.transactions) ? guild.transactions.slice(-5000) : [];
    guild.processedInteractions = Array.isArray(guild?.processedInteractions) ? guild.processedInteractions.filter(Boolean).slice(-5000) : [];
    guild.pendingCoinGifts = guild?.pendingCoinGifts && typeof guild.pendingCoinGifts === 'object' && !Array.isArray(guild.pendingCoinGifts)
      ? guild.pendingCoinGifts
      : {};
    const now = Date.now();
    for (const [token, rawIntent] of Object.entries(guild.pendingCoinGifts)) {
      const intent = rawIntent && typeof rawIntent === 'object' ? rawIntent : {};
      const expiresAt = Date.parse(intent.expiresAt || '') || 0;
      if (!/^[a-f0-9]{24}$/.test(token) || expiresAt <= now) {
        delete guild.pendingCoinGifts[token];
        continue;
      }
      guild.pendingCoinGifts[token] = {
        senderId: String(intent.senderId || ''),
        recipientId: String(intent.recipientId || ''),
        amount: finiteInteger(intent.amount),
        message: String(intent.message || '').trim().slice(0, 200),
        senderRevision: finiteInteger(intent.senderRevision, 0, 0, Number.MAX_SAFE_INTEGER),
        createdAt: String(intent.createdAt || ''),
        expiresAt: new Date(expiresAt).toISOString()
      };
    }
    // DM-Referenzen je User/Sektion: Nur bekannte Sektionen behalten, damit
    // keine veralteten Einträge die Datei aufblähen.
    guild.dmMessages = guild?.dmMessages && typeof guild.dmMessages === 'object' ? guild.dmMessages : {};
    for (const [userId, sections] of Object.entries(guild.dmMessages)) {
      if (!sections || typeof sections !== 'object') { delete guild.dmMessages[userId]; continue; }
      const kept = {};
      for (const section of Object.keys(sections)) {
        if (!ECONOMY_DM_SECTIONS.includes(section)) continue;
        const stored = sections[section];
        if (stored && typeof stored === 'object' && stored.messageId) {
          kept[section] = { channelId: String(stored.channelId || ''), messageId: String(stored.messageId), at: String(stored.at || '') };
        }
      }
      if (Object.keys(kept).length) guild.dmMessages[userId] = kept;
      else delete guild.dmMessages[userId];
    }
    guild.revision = finiteInteger(guild.revision, 0, 0, Number.MAX_SAFE_INTEGER);
    for (const [userId, rawAccount] of Object.entries(guild.accounts)) {
      const account = rawAccount && typeof rawAccount === 'object' ? rawAccount : {};
      guild.accounts[userId] = account;
      account.balance = finiteInteger(account.balance);
      account.earned = finiteInteger(account.earned);
      account.spent = finiteInteger(account.spent);
      account.giftedCoins = finiteInteger(account.giftedCoins);
      account.receivedGiftCoins = finiteInteger(account.receivedGiftCoins);
      account.boostRecord = finiteInteger(account.boostRecord, 0, 0, 99);
      account.rewardedBoostLevels = normalizeBoostLevels(account.rewardedBoostLevels);
      account.revision = finiteInteger(account.revision, 0, 0, Number.MAX_SAFE_INTEGER);
      account.createdAt = String(account.createdAt || new Date().toISOString());
      account.updatedAt = String(account.updatedAt || account.createdAt);
    }
  }
  return data;
};
const loadEconomyStore = async () => {
  const result = await readJsonWithRecovery(ECONOMY_FILE, {
    fallback: emptyData(),
    backupLimit: 5,
    validate: (v) => Boolean(v && typeof v === 'object')
  });
  return normalizeEconomyData(result.value);
};

const loadPanelStore = async () => {
  const result = await readJsonWithRecovery(PANEL_FILE, {
    fallback: {},
    backupLimit: 5,
    validate: (v) => Boolean(v && typeof v === 'object')
  });
  return result.value;
};

const mutate = (worker) => {
  const operation = mutationQueue.then(async () => {
    const data = await loadEconomyStore();
    const result = await worker(data);
    await atomicWriteJson(ECONOMY_FILE, normalizeEconomyData(data), { backupLimit: 5 });
    return result;
  });
  mutationQueue = operation.catch(() => {});
  return operation;
};
let migrationPromise = null;
const accountTimestamp = (account) => Date.parse(account?.updatedAt || account?.createdAt || '') || 0;
const mergeEconomyAccount = (current, candidate) => {
  const currentAccount = accountSnapshot(current || {});
  const candidateAccount = accountSnapshot(candidate || {});
  const latest = accountTimestamp(candidateAccount) > accountTimestamp(currentAccount) ? candidateAccount : currentAccount;
  const createdTimes = [currentAccount.createdAt, candidateAccount.createdAt]
    .filter(Boolean)
    .sort((left, right) => (Date.parse(left) || 0) - (Date.parse(right) || 0));
  return {
    ...latest,
    boostRecord: Math.max(currentAccount.boostRecord, candidateAccount.boostRecord),
    rewardedBoostLevels: normalizeBoostLevels([...currentAccount.rewardedBoostLevels, ...candidateAccount.rewardedBoostLevels]),
    revision: Math.max(currentAccount.revision, candidateAccount.revision),
    createdAt: createdTimes[0] || latest.createdAt || new Date().toISOString(),
    updatedAt: latest.updatedAt || latest.createdAt || new Date().toISOString()
  };
};
const mergeEconomyData = (target, source) => {
  const normalizedSource = normalizeEconomyData(source);
  let accountsAdded = 0;
  let accountsUpdated = 0;
  let transactionsAdded = 0;
  for (const [guildId, sourceGuild] of Object.entries(normalizedSource.guilds || {})) {
    target.guilds[guildId] ||= { accounts: {}, transactions: [], processedInteractions: [], pendingCoinGifts: {}, revision: 0 };
    const targetGuild = target.guilds[guildId];
    targetGuild.accounts ||= {};
    for (const [userId, candidate] of Object.entries(sourceGuild.accounts || {})) {
      if (!targetGuild.accounts[userId]) {
        targetGuild.accounts[userId] = accountSnapshot(candidate);
        accountsAdded += 1;
        continue;
      }
      const before = JSON.stringify(accountSnapshot(targetGuild.accounts[userId]));
      const merged = mergeEconomyAccount(targetGuild.accounts[userId], candidate);
      targetGuild.accounts[userId] = merged;
      if (JSON.stringify(merged) !== before) accountsUpdated += 1;
    }
    const transactions = new Map((targetGuild.transactions || []).map((transaction) => [
      String(transaction.id || `${transaction.type}:${transaction.userId}:${transaction.createdAt}:${transaction.amount}`),
      transaction
    ]));
    for (const transaction of sourceGuild.transactions || []) {
      const key = String(transaction.id || `${transaction.type}:${transaction.userId}:${transaction.createdAt}:${transaction.amount}`);
      if (transactions.has(key)) continue;
      transactions.set(key, transaction);
      transactionsAdded += 1;
    }
    targetGuild.transactions = [...transactions.values()]
      .sort((left, right) => (Date.parse(left.createdAt || '') || 0) - (Date.parse(right.createdAt || '') || 0))
      .slice(-5000);
    targetGuild.revision = Math.max(finiteInteger(targetGuild.revision), finiteInteger(sourceGuild.revision));
  }
  return { accountsAdded, accountsUpdated, transactionsAdded };
};
const defaultLegacyEconomyFiles = () => {
  const candidates = [
    process.env.FALLEN_HEAVEN_LEGACY_ECONOMY_FILE,
    process.env.FALLEN_HEAVEN_APP_ROOT ? path.join(process.env.FALLEN_HEAVEN_APP_ROOT, 'data', 'heaven-economy.json') : '',
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Documents', 'Discord Bot', 'data', 'heaven-economy.json') : ''
  ].filter(Boolean).map((file) => path.resolve(file));
  return [...new Set(candidates)].filter((file) => file !== path.resolve(ECONOMY_FILE));
};
const ensureEconomyStore = (sourceFiles = defaultLegacyEconomyFiles()) => {
  if (!migrationPromise) {
    migrationPromise = mutate(async (data) => {
      const merged = { accountsAdded: 0, accountsUpdated: 0, transactionsAdded: 0, sources: [] };
      for (const sourceFile of sourceFiles) {
        try {
          const source = JSON.parse(await fs.readFile(sourceFile, 'utf8'));
          const result = mergeEconomyData(data, source);
          merged.accountsAdded += result.accountsAdded;
          merged.accountsUpdated += result.accountsUpdated;
          merged.transactionsAdded += result.transactionsAdded;
          merged.sources.push(sourceFile);
        } catch (error) {
          if (error?.code !== 'ENOENT') throw new Error(`Legacy-Economy konnte nicht gelesen werden (${path.basename(sourceFile)}): ${error?.message || error}`, { cause: error });
        }
      }
      return {
        version: data.version,
        guilds: Object.keys(data.guilds || {}).length,
        accounts: Object.values(data.guilds || {}).reduce((sum, guild) => sum + Object.keys(guild.accounts || {}).length, 0),
        ...merged
      };
    }).catch((error) => {
      migrationPromise = null;
      throw error;
    });
  }
  return migrationPromise;
};
export const migrateHeavenEconomyStore = (options = {}) => ensureEconomyStore(Array.isArray(options.sourceFiles) ? options.sourceFiles : defaultLegacyEconomyFiles());
const guildState = (data, guildId) => {
  data.guilds ||= {};
  data.guilds[guildId] ||= { accounts: {}, transactions: [], processedInteractions: [], pendingCoinGifts: {}, revision: 0 };
  data.guilds[guildId].processedInteractions ||= [];
  data.guilds[guildId].pendingCoinGifts ||= {};
  return data.guilds[guildId];
};
const accountState = (guild, userId) => {
  guild.accounts[userId] ||= {
    balance: 0,
    earned: 0,
    spent: 0,
    giftedCoins: 0,
    receivedGiftCoins: 0,
    boostRecord: 0,
    rewardedBoostLevels: [],
    revision: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  return guild.accounts[userId];
};
const transactionId = () => `FH-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const recordTransaction = (guild, entry) => {
  const transaction = { id: transactionId(), version: 2, createdAt: new Date().toISOString(), ...entry };
  guild.transactions ||= [];
  guild.transactions.push(transaction);
  if (guild.transactions.length > 5000) guild.transactions.splice(0, guild.transactions.length - 5000);
  guild.revision = finiteInteger(guild.revision, 0, 0, Number.MAX_SAFE_INTEGER) + 1;
  return transaction;
};

const coinGiftLimits = (cfg) => {
  const settings = conf(cfg);
  const minimum = finiteInteger(settings.coinGiftMinAmount, 1, 1, 10_000_000);
  return {
    enabled: settings.coinGiftsEnabled !== false,
    minimum,
    maximum: finiteInteger(settings.coinGiftMaxAmount, 100_000, minimum, 10_000_000)
  };
};

const conf = (cfg) => cfg?.heavenEconomy || {};
const coin = (cfg) => String(conf(cfg).coinEmoji || '🪙');
const money = (value) => `${Number(value || 0).toLocaleString('de-DE')} Coins`;
const safeUrl = (value) => /^https?:\/\/[^\s]+$/i.test(String(value || '')) ? String(value) : '';
const sendEconomyLog = async (guild, cfg, title, description) => {
  const channelId = String(conf(cfg).logChannelId || '');
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch((error) => {
    quietLog(QUIET_LOG_SCOPE.heavenEconomy, error, `channels.fetch fehlgeschlagen: ${channelId}`);
    return null;
  });
  if (!channel?.isTextBased?.()) return;
  await channel.send({
    embeds: [new EmbedBuilder().setColor(0x7772ff).setTitle(title).setDescription(String(description || '').slice(0, 4000)).setTimestamp()],
    allowedMentions: { parse: [] }
  }).catch(() => {});
};
/* ----------------- Editierbare DM-Embeds (Studio) ----------------------- */
// VIP-Geschenk, VIP-Kauf, manuelle Coin-Gutschrift und Boost-Meilenstein-
// Vergütung senden eine DM – als editierbares Embed über das Dashboard-
// Embed-Studio (Sektionen giftReceived / vipPurchased / coinsReceived /
// boostMilestone). Identisches Muster wie die DM-Embeds des Zähl-Kanals und
// der Call-Moderation – NIE roher Text, alles läuft als Embed mit Platzhaltern.
const ECONOMY_DM_SECTIONS = ['giftReceived', 'vipPurchased', 'coinsReceived', 'boostMilestone', 'coinGiftReceived', 'coinGiftSent'];

const DEFAULT_ECONOMY_DM_DESIGNS = {
  giftReceived: {
    title: '🎁 Dir wurde VIP geschenkt',
    description: '**{targetMention}**, du hast von **{giver}** die VIP-Stufe **{tier}** geschenkt bekommen!\n\nDein neuer VIP-Status ist ab sofort aktiv – viel Spaß mit deinen exklusiven Vorteilen!',
    color: '#57f287',
    authorName: '{server}',
    authorIconUrl: '',
    footerText: 'FALLEN HEAVEN · VIP',
    timestamp: true
  },
  vipPurchased: {
    title: '👑 Willkommen in der VIP-Welt',
    description: '**{targetMention}**, du hast dir die VIP-Stufe **{tier}** für **{price}** gekauft.\n\nDein neuer VIP-Status ist ab sofort aktiv – vielen Dank für deine Unterstützung!',
    color: '#ffbd59',
    authorName: '{server}',
    authorIconUrl: '',
    footerText: 'FALLEN HEAVEN · VIP',
    timestamp: true
  },
  coinsReceived: {
    title: '🪙 Du hast Coins erhalten',
    description: '**{targetMention}**, deinem Konto wurden **{coins}** gutgeschrieben.\n\nDein neuer Kontostand: **{balance}**',
    color: '#57f287',
    authorName: '{server}',
    authorIconUrl: '',
    footerText: 'FALLEN HEAVEN · HEAVEN COINS',
    timestamp: true
  },
  boostMilestone: {
    title: '⚡ Boost-Meilenstein belohnt',
    description: '**{targetMention}**, deine neue Boost-Stufe {levels} wurde mit **{coins}** belohnt!\n\nDein neuer Kontostand: **{balance}**',
    color: '#7772ff',
    authorName: '{server}',
    authorIconUrl: '',
    footerText: 'FALLEN HEAVEN · HEAVEN COINS',
    timestamp: true
  },
  coinGiftReceived: {
    title: '🪙 Du hast Coins geschenkt bekommen',
    description: '**{giverMention}** hat dir **{coins}** geschenkt.{messageBlock}\n\nDein neuer Kontostand: **{targetBalance}**\nTransaktion: `{transactionId}`',
    color: '#57f287',
    authorName: '{server}',
    footerText: 'FALLEN HEAVEN · COIN-GESCHENK',
    timestamp: true
  },
  coinGiftSent: {
    title: '🎁 Coin-Geschenk versendet',
    description: 'Du hast **{targetMention}** erfolgreich **{coins}** geschenkt.{messageBlock}\n\nDein neuer Kontostand: **{giverBalance}**\nTransaktion: `{transactionId}`',
    color: '#7772ff',
    authorName: '{server}',
    footerText: 'FALLEN HEAVEN · COIN-GESCHENK',
    timestamp: true
  }
};

const normalizeEconomyDmSection = (section, value) => {
  const fallback = DEFAULT_ECONOMY_DM_DESIGNS[section] || {};
  const embed = value && typeof value === 'object' ? value : {};
  return {
    title: String(embed.title !== undefined ? embed.title : fallback.title).slice(0, 256),
    url: String(embed.url || '').slice(0, 2048),
    description: String(embed.description !== undefined ? embed.description : fallback.description).slice(0, 4096),
    color: String(embed.color || fallback.color || '').slice(0, 16),
    authorName: String(embed.authorName !== undefined ? embed.authorName : fallback.authorName).slice(0, 256),
    authorIconUrl: String(embed.authorIconUrl || '').slice(0, 2048),
    thumbnailUrl: String(embed.thumbnailUrl || '').slice(0, 2048),
    imageUrl: String(embed.imageUrl || '').slice(0, 2048),
    footerText: String(embed.footerText !== undefined ? embed.footerText : fallback.footerText).slice(0, 2048),
    footerIconUrl: String(embed.footerIconUrl || '').slice(0, 2048),
    fields: (Array.isArray(embed.fields) ? embed.fields : Array.isArray(fallback.fields) ? fallback.fields : []).slice(0, 25).map((field) => ({
      name: String(field?.name || '').slice(0, 256),
      value: String(field?.value || '').slice(0, 1024),
      inline: field?.inline === true
    })).filter((field) => field.name && field.value),
    timestamp: embed.timestamp !== false
  };
};

const normalizeEconomyDmDesigns = (design) => {
  const source = design && typeof design === 'object' && !Array.isArray(design) ? design : {};
  return Object.fromEntries(ECONOMY_DM_SECTIONS.map((section) => [section, normalizeEconomyDmSection(section, source[section])]));
};

const parseEconomyHexColor = (value) => {
  const parsed = Number.parseInt(String(value || '').replace('#', ''), 16);
  return Number.isFinite(parsed) ? parsed : 0x7772ff;
};

const renderEconomyDmText = (template, context, max = 4096) => String(template || '')
  .replaceAll('{server}', context.server)
  .replaceAll('{target}', context.target)
  .replaceAll('{targetMention}', context.targetMention)
  .replaceAll('{tier}', context.tier)
  .replaceAll('{price}', context.price)
  .replaceAll('{giver}', context.giver)
  .replaceAll('{giverMention}', context.giverMention)
  .replaceAll('{coins}', context.coins)
  .replaceAll('{balance}', context.balance)
  .replaceAll('{levels}', context.levels)
  .replaceAll('{reason}', context.reason)
  .replaceAll('{giverBalance}', context.giverBalance)
  .replaceAll('{targetBalance}', context.targetBalance)
  .replaceAll('{message}', context.message)
  .replaceAll('{messageBlock}', context.messageBlock)
  .replaceAll('{transactionId}', context.transactionId)
  .slice(0, Math.max(1, max));

const economyDmContext = ({ guild, userId, tier = null, giverId = '', price = '', coins = '', balance = '', levels = '', reason = '', giverBalance = '', targetBalance = '', message = '', transactionId = '' } = {}) => {
  const member = guild?.members?.cache?.get?.(String(userId || ''));
  const user = member?.user || guild?.client?.users?.cache?.get?.(String(userId || ''));
  const giver = giverId
    ? guild?.members?.cache?.get?.(String(giverId)) || guild?.client?.users?.cache?.get?.(String(giverId))
    : null;
  return {
    server: guild?.name || 'FALLEN HEAVEN',
    target: String(member?.displayName || user?.globalName || user?.username || 'Du'),
    targetMention: `<@${userId}>`,
    tier: String(tier?.name || tier || 'VIP'),
    price: String(tier?.price ? money(tier.price) : price || ''),
    giver: String(giver?.displayName || giver?.globalName || giver?.username || 'ein Mitglied'),
    giverMention: giverId ? `<@${giverId}>` : '',
    coins: String(coins || ''),
    balance: String(balance || ''),
    levels: String(levels || ''),
    reason: String(reason || ''),
    giverBalance: String(giverBalance || ''),
    targetBalance: String(targetBalance || ''),
    message: String(message || ''),
    messageBlock: message ? `\n\n> ${String(message).replace(/[\r\n]+/g, ' ').slice(0, 200)}` : '',
    transactionId: String(transactionId || '')
  };
};

// Baut ein DM-Embed aus der editierbaren Sektion.
const buildEconomyDmEmbed = (guild, section, context, cfg) => {
  const design = normalizeEconomyDmSection(section, conf(cfg)?.dmDesigns?.[section]);
  const embed = new EmbedBuilder().setColor(parseEconomyHexColor(design.color || '#7772ff'));
  const title = renderEconomyDmText(design.title, context, 256);
  if (title) embed.setTitle(title);
  if (design.url) embed.setURL(renderEconomyDmText(design.url, context, 512));
  const description = renderEconomyDmText(design.description, context, 4096);
  if (description) embed.setDescription(description);
  if (design.authorName) embed.setAuthor({ name: renderEconomyDmText(design.authorName, context, 256), iconURL: design.authorIconUrl || undefined });
  if (design.thumbnailUrl && isAllowedEmbedImageUrl(design.thumbnailUrl)) embed.setThumbnail(design.thumbnailUrl);
  if (design.imageUrl && isAllowedEmbedImageUrl(design.imageUrl)) embed.setImage(design.imageUrl);
  if (design.fields.length) embed.addFields(design.fields.map((field) => ({
    name: renderEconomyDmText(field.name, context, 256),
    value: renderEconomyDmText(field.value, context, 1024),
    inline: field.inline === true
  })).filter((field) => field.name && field.value));
  if (design.footerText) embed.setFooter({ text: renderEconomyDmText(design.footerText, context, 2048), iconURL: design.footerIconUrl || undefined });
  if (design.timestamp) embed.setTimestamp();
  return embed;
};

const getEconomyDmReference = async (guildId, userId, sectionId) => {
  await mutationQueue.catch(() => {});
  const data = await loadEconomyStore();
  const stored = data.guilds?.[String(guildId)]?.dmMessages?.[String(userId)]?.[String(sectionId)];
  return stored && typeof stored === 'object' ? { ...stored } : null;
};

const rememberEconomyDmReference = ({ guildId, userId, sectionId, channelId, messageId }) => mutate((data) => {
  const economy = guildState(data, String(guildId));
  economy.dmMessages ||= {};
  economy.dmMessages[String(userId)] ||= {};
  economy.dmMessages[String(userId)][String(sectionId)] = {
    channelId: String(channelId || ''),
    messageId: String(messageId || ''),
    at: new Date().toISOString()
  };
});

// Sendet die DM und bearbeitet eine bereits gesendete DM derselben Sektion
// (gleicher User) statt eine zweite Nachricht zu stapeln – kein DM-Spam.
export const sendEconomyDm = async ({ guild, cfg, userId, section, context = {}, forceNew = false } = {}) => {
  try {
    if (!guild?.id || !userId) return null;
    const sectionId = ECONOMY_DM_SECTIONS.includes(String(section)) ? String(section) : ECONOMY_DM_SECTIONS[0];
    const user = guild.client?.users?.cache?.get?.(String(userId)) || await guild.client?.users?.fetch?.(String(userId)).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.heavenEconomy, error, `users.fetch fehlgeschlagen: ${userId}`);
      return null;
    });
    if (!user || user.bot) return null;
    const dm = await user.createDM().catch((error) => {
      quietLog(QUIET_LOG_SCOPE.heavenEconomy, error, `createDM fehlgeschlagen: User ${userId}`);
      return null;
    });
    if (!dm) return null;
    const embed = buildEconomyDmEmbed(guild, sectionId, { ...economyDmContext({ guild, userId }), ...context }, cfg);
    const payload = { embeds: [embed], allowedMentions: { parse: [] } };
    const stored = await getEconomyDmReference(guild.id, userId, sectionId);
    if (!forceNew && stored?.messageId && stored?.channelId) {
      const channel = guild.client?.channels?.cache?.get?.(stored.channelId) || await guild.client?.channels?.fetch?.(stored.channelId).catch((error) => {
        quietLog(QUIET_LOG_SCOPE.heavenEconomy, error, `channels.fetch (DM-Edit) fehlgeschlagen: ${stored.channelId}`);
        return null;
      });
      const existing = await channel?.messages?.fetch?.(stored.messageId).catch((error) => {
        quietLog(QUIET_LOG_SCOPE.heavenEconomy, error, `messages.fetch (DM-Edit) fehlgeschlagen: ${stored.messageId}`);
        return null;
      });
      if (existing && String(existing.author?.id || '') === String(guild.client?.user?.id || '')) {
        await existing.edit(payload).catch((error) => {
          quietLog(QUIET_LOG_SCOPE.heavenEconomy, error, `message.edit (DM) fehlgeschlagen: ${stored.messageId}`);
        });
        await rememberEconomyDmReference({ guildId: guild.id, userId, sectionId, channelId: stored.channelId, messageId: stored.messageId });
        return { edited: true, messageId: String(stored.messageId) };
      }
    }
    const sent = await dm.send(payload).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.heavenEconomy, error, `dm.send fehlgeschlagen: User ${userId}`);
      return null;
    });
    if (sent) {
      await rememberEconomyDmReference({ guildId: guild.id, userId, sectionId, channelId: dm.id, messageId: sent.id });
      return { sent: true, messageId: String(sent.id) };
    }
    return null;
  } catch {
    return null;
  }
};

/* ---------------- VIP-Trennerrolle (automatisch vergeben) ----------------- */
// Wie die Trennerrolle der Aktivitäts-Liga: Jedes Mitglied mit mindestens
// einer aktiven VIP-Stufe erhält die Begleitrolle automatisch; sobald keine
// VIP-Stufe mehr aktiv ist, wird sie wieder entzogen.
const separatorSyncRuns = new Set();
const separatorSyncTimers = new Map();

export const syncVipSeparatorRole = async ({ guild, cfg, reason = 'FALLEN HEAVEN VIP-Trennerrolle' } = {}) => {
  const settings = conf(cfg);
  const separatorRoleId = String(settings.separatorRoleId || '').trim();
  if (!guild?.id || settings.enabled !== true || !separatorRoleId) return { ok: false, reason: 'not-configured' };
  const guildId = String(guild.id);
  if (separatorSyncRuns.has(guildId)) return { ok: false, reason: 'running' };
  separatorSyncRuns.add(guildId);
  try {
    const tiers = vipTiers(guild, cfg);
    const tierRoleIds = new Set(tiers.map((tier) => String(tier.roleId)));
    const role = guild.roles.cache.get(separatorRoleId);
    if (!role || role.managed) return { ok: false, reason: 'role-missing' };
    let granted = 0;
    let removed = 0;
    const errors = [];
    for (const member of guild.members.cache.values()) {
      if (member.user?.bot) continue;
      const hasVip = [...member.roles.cache.keys()].some((roleId) => tierRoleIds.has(String(roleId)));
      if (hasVip && !member.roles.cache.has(separatorRoleId)) {
        try {
          const result = await applyManagedRolePolicy({ member, addRoleIds: [separatorRoleId], reason });
          if (result.addedRoleIds.length) granted += 1;
        } catch (error) {
          errors.push({ userId: member.id, error: String(error?.message || error).slice(0, 300) });
        }
      } else if (!hasVip && member.roles.cache.has(separatorRoleId)) {
        try {
          const result = await applyManagedRolePolicy({ member, removeRoleIds: [separatorRoleId], reason });
          if (result.removedRoleIds.length) removed += 1;
        } catch (error) {
          errors.push({ userId: member.id, error: String(error?.message || error).slice(0, 300) });
        }
      }
    }
    return { ok: true, granted, removed, errors };
  } finally {
    separatorSyncRuns.delete(guildId);
  }
};

const scheduleVipSeparatorSync = (guild, cfg) => {
  const guildId = String(guild?.id || '');
  if (!guildId || conf(cfg).enabled !== true || !String(conf(cfg).separatorRoleId || '').trim()) return;
  const previous = separatorSyncTimers.get(guildId);
  if (previous) clearTimeout(previous);
  const timer = setTimeout(() => {
    separatorSyncTimers.delete(guildId);
    void syncVipSeparatorRole({ guild, cfg }).catch((error) => {
      console.error(`[heavenEconomy] VIP-Trennerrolle ${guild.name}:`, error.message);
    });
  }, 2000);
  timer.unref?.();
  separatorSyncTimers.set(guildId, timer);
};

const isEconomyStaff = (interaction, cfg) => {
  const member = interaction.member;
  if (!member) return false;
  if (member.permissions?.has?.(PermissionFlagsBits.ManageGuild)) return true;
  const owners = new Set((cfg.general?.ownerUserIds || []).map(String));
  const roles = new Set((cfg.general?.staffRoleIds || []).map(String));
  return owners.has(String(interaction.user.id)) || member.roles?.cache?.some?.((role) => roles.has(String(role.id)));
};
const vipTiers = (guild, cfg) => {
  const fallbackNames = new Map([[500, 'VIP'], [1000, 'VIP: BRONZE'], [2500, 'VIP: SILBER'], [4000, 'VIP: GOLD'], [5000, 'VIP: DIAMANT']]);
  return (Array.isArray(conf(cfg).vipRoleMappings) ? conf(cfg).vipRoleMappings : [])
    .map((entry) => {
      const textMatch = typeof entry === 'string' ? /^(\d+)\s*=\s*(\d+)$/.exec(entry.trim()) : null;
      if (!entry || (typeof entry !== 'object' && !textMatch)) return null;
      const price = Math.max(1, Number(textMatch?.[1] ?? entry.threshold ?? entry.price ?? entry.count ?? 0));
      const roleId = String(textMatch?.[2] ?? entry.roleId ?? entry.id ?? '');
      const role = guild.roles.cache.get(roleId);
      if (!role || role.managed) return null;
      return { price, roleId, name: role.name || fallbackNames.get(price) || `VIP ${price}` };
    })
    .filter(Boolean)
    .sort((left, right) => left.price - right.price)
    .slice(0, 25);
};
const currentVip = (member, tiers) => tiers.filter((tier) => member.roles.cache.has(tier.roleId)).sort((a, b) => b.price - a.price)[0] || null;

const getAccount = async (guildId, userId) => {
  await mutationQueue.catch(() => {});
  const data = await loadEconomyStore();
  return accountState(guildState(data, guildId), userId);
};

const accountSnapshot = (account) => ({
  balance: finiteInteger(account?.balance),
  earned: finiteInteger(account?.earned),
  spent: finiteInteger(account?.spent),
  giftedCoins: finiteInteger(account?.giftedCoins),
  receivedGiftCoins: finiteInteger(account?.receivedGiftCoins),
  boostRecord: finiteInteger(account?.boostRecord, 0, 0, 99),
  rewardedBoostLevels: normalizeBoostLevels(account?.rewardedBoostLevels),
  revision: finiteInteger(account?.revision, 0, 0, Number.MAX_SAFE_INTEGER),
  createdAt: String(account?.createdAt || ''),
  updatedAt: String(account?.updatedAt || '')
});

const fetchGiftMember = async (guild, userId) => guild?.members?.cache?.get?.(String(userId || ''))
  || await guild?.members?.fetch?.(String(userId || '')).catch(() => null);

const validateCoinGiftMembers = async ({ guild, senderId, recipientId }) => {
  if (!guild) throw new Error('Server wurde nicht gefunden.');
  if (!senderId || !recipientId) throw new Error('Absender und Empfänger werden benötigt.');
  if (String(senderId) === String(recipientId)) throw new Error('Du kannst dir nicht selbst Coins schenken.');
  const [sender, recipient] = await Promise.all([
    fetchGiftMember(guild, senderId),
    fetchGiftMember(guild, recipientId)
  ]);
  if (!sender || sender.user?.bot) throw new Error('Der Absender ist kein gültiges Servermitglied.');
  if (!recipient) throw new Error('Der Empfänger ist nicht mehr auf diesem Server.');
  if (recipient.user?.bot) throw new Error('Bots können keine Coin-Geschenke erhalten.');
  return { sender, recipient };
};

export const createCoinGiftIntent = async ({ guild, cfg, senderId = '', recipientId = '', amount, message = '' } = {}) => {
  const limits = coinGiftLimits(cfg);
  if (!conf(cfg).enabled || !limits.enabled) throw new Error('Coin-Geschenke sind derzeit deaktiviert.');
  const parsedAmount = Number(amount);
  if (!Number.isSafeInteger(parsedAmount) || parsedAmount < limits.minimum) {
    throw new Error(`Du musst mindestens ${money(limits.minimum)} verschenken.`);
  }
  if (parsedAmount > limits.maximum) throw new Error(`Pro Geschenk sind höchstens ${money(limits.maximum)} möglich.`);
  await validateCoinGiftMembers({ guild, senderId, recipientId });
  const cleanMessage = String(message || '').trim().slice(0, 200);
  return mutate((data) => {
    const economy = guildState(data, guild.id);
    const sender = accountState(economy, String(senderId));
    const recipient = accountState(economy, String(recipientId));
    if (sender.balance < parsedAmount) throw new Error(`Dein Kontostand reicht nicht aus. Verfügbar: ${money(sender.balance)}.`);
    if (recipient.balance + parsedAmount > 10_000_000) throw new Error('Das Empfängerkonto würde das Kontolimit von 10.000.000 Coins überschreiten.');
    for (const [existingToken, existing] of Object.entries(economy.pendingCoinGifts)) {
      if (String(existing?.senderId || '') === String(senderId)) delete economy.pendingCoinGifts[existingToken];
    }
    const token = randomBytes(12).toString('hex');
    const createdAt = new Date();
    economy.pendingCoinGifts[token] = {
      senderId: String(senderId),
      recipientId: String(recipientId),
      amount: parsedAmount,
      message: cleanMessage,
      senderRevision: finiteInteger(sender.revision, 0, 0, Number.MAX_SAFE_INTEGER),
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + COIN_GIFT_INTENT_TTL_MS).toISOString()
    };
    return {
      token,
      senderId: String(senderId),
      recipientId: String(recipientId),
      amount: parsedAmount,
      message: cleanMessage,
      senderBalanceBefore: sender.balance,
      senderBalanceAfter: sender.balance - parsedAmount,
      expiresAt: economy.pendingCoinGifts[token].expiresAt
    };
  });
};

export const completeCoinGiftTransfer = async ({ guild, cfg, token = '', interactionId = '' } = {}) => {
  const limits = coinGiftLimits(cfg);
  if (!conf(cfg).enabled || !limits.enabled) throw new Error('Coin-Geschenke sind derzeit deaktiviert.');
  const normalizedToken = String(token || '').trim();
  const normalizedInteractionId = String(interactionId || '').trim();
  if (!/^[a-f0-9]{24}$/.test(normalizedToken)) throw new Error('Dieses Coin-Geschenk ist ungültig.');

  await mutationQueue.catch(() => {});
  const currentData = await loadEconomyStore();
  const currentIntent = guildState(currentData, guild.id).pendingCoinGifts?.[normalizedToken];
  if (currentIntent) await validateCoinGiftMembers({ guild, senderId: currentIntent.senderId, recipientId: currentIntent.recipientId });

  return mutate((data) => {
    const economy = guildState(data, guild.id);
    economy.processedInteractions ||= [];
    if (normalizedInteractionId && economy.processedInteractions.includes(normalizedInteractionId)) return { ok: false, duplicate: true };
    const intent = economy.pendingCoinGifts?.[normalizedToken];
    if (!intent) throw new Error('Dieses Coin-Geschenk ist abgelaufen oder wurde bereits verwendet.');
    if ((Date.parse(intent.expiresAt || '') || 0) <= Date.now()) {
      delete economy.pendingCoinGifts[normalizedToken];
      throw new Error('Dieses Coin-Geschenk ist abgelaufen. Bitte beginne erneut.');
    }
    const amountValue = finiteInteger(intent.amount);
    if (amountValue < limits.minimum || amountValue > limits.maximum) throw new Error('Der Geschenk-Betrag liegt außerhalb der aktuellen Grenzen.');
    const sender = accountState(economy, intent.senderId);
    const recipient = accountState(economy, intent.recipientId);
    if (sender.balance < amountValue) throw new Error(`Dein Kontostand reicht nicht mehr aus. Verfügbar: ${money(sender.balance)}.`);
    if (recipient.balance + amountValue > 10_000_000) throw new Error('Das Empfängerkonto würde das Kontolimit von 10.000.000 Coins überschreiten.');
    const senderBalanceBefore = sender.balance;
    const recipientBalanceBefore = recipient.balance;
    sender.balance -= amountValue;
    sender.spent += amountValue;
    sender.giftedCoins += amountValue;
    recipient.balance += amountValue;
    recipient.earned += amountValue;
    recipient.receivedGiftCoins += amountValue;
    const updatedAt = new Date().toISOString();
    for (const account of [sender, recipient]) {
      account.revision = finiteInteger(account.revision, 0, 0, Number.MAX_SAFE_INTEGER) + 1;
      account.updatedAt = updatedAt;
    }
    const transaction = recordTransaction(economy, {
      type: 'coin-gift',
      userId: intent.recipientId,
      targetUserId: intent.recipientId,
      actorId: intent.senderId,
      senderId: intent.senderId,
      recipientId: intent.recipientId,
      amount: amountValue,
      senderBalanceBefore,
      senderBalanceAfter: sender.balance,
      recipientBalanceBefore,
      recipientBalanceAfter: recipient.balance
    });
    delete economy.pendingCoinGifts[normalizedToken];
    if (normalizedInteractionId) economy.processedInteractions.push(normalizedInteractionId);
    economy.processedInteractions = economy.processedInteractions.filter(Boolean).slice(-5000);
    return {
      ok: true,
      amount: amountValue,
      message: String(intent.message || ''),
      senderId: intent.senderId,
      recipientId: intent.recipientId,
      sender: accountSnapshot(sender),
      recipient: accountSnapshot(recipient),
      transaction
    };
  });
};

const cancelCoinGiftIntent = async ({ guildId, token, senderId }) => mutate((data) => {
  const economy = guildState(data, guildId);
  const intent = economy.pendingCoinGifts?.[String(token || '')];
  if (intent && String(intent.senderId) === String(senderId)) delete economy.pendingCoinGifts[String(token)];
  return Boolean(intent && String(intent.senderId) === String(senderId));
});

const coinGiftDmContext = ({ guild, result }) => economyDmContext({
  guild,
  userId: result.recipientId,
  giverId: result.senderId,
  coins: money(result.amount),
  balance: money(result.recipient.balance),
  giverBalance: money(result.sender.balance),
  targetBalance: money(result.recipient.balance),
  message: result.message,
  transactionId: result.transaction.id
});

const economyIdentity = (guild, userId) => {
  const member = guild.members.cache.get(String(userId || ''));
  const user = member?.user || guild.client.users.cache.get(String(userId || ''));
  return {
    id: String(userId || ''),
    displayName: String(member?.displayName || user?.globalName || user?.username || `Mitglied ${userId}`),
    username: String(user?.username || ''),
    avatarUrl: resolveAvatarUrl(user, { extension: 'webp', size: 128 }),
    avatar: resolveAvatarUrl(user, { extension: 'webp', size: 128 }),
    onServer: Boolean(member),
    member,
    user
  };
};

const activeBoostState = async (guild) => {
  const snapshot = await getBoostStatusSnapshot(guild).catch((error) => {
    quietLog(QUIET_LOG_SCOPE.heavenEconomy, error, `getBoostStatusSnapshot fehlgeschlagen`);
    return null;
  });
  const counts = new Map((snapshot?.active || []).map((entry) => [
    String(entry.id || entry.userId || ''),
    entry.nativeActive ? finiteInteger(entry.boostCount ?? entry.count, 1, 1, 99) : 0
  ]));
  return { counts, snapshot };
};

export const getHeavenEconomyBoostRankingSnapshot = async ({ guild } = {}) => {
  if (!guild) throw new Error('Server wurde nicht gefunden.');
  const boostState = await activeBoostState(guild);
  const discordBoostCount = Math.max(0, Number(boostState.snapshot?.summary?.discordBoostCount ?? guild.premiumSubscriptionCount ?? 0));
  const assignedBoostCount = Math.max(0, Number(boostState.snapshot?.summary?.assignedBoostCount ?? 0));
  const consistencyState = String(
    boostState.snapshot?.summary?.consistencyState
    || (discordBoostCount === assignedBoostCount ? 'synchronized' : 'mismatch')
  );
  const rows = [...boostState.counts.entries()]
    .filter(([userId, count]) => guild.members.cache.has(String(userId)) && Number(count) > 0)
    .map(([userId, activeBoostCount]) => ({ id: String(userId), activeBoostCount: Number(activeBoostCount) }))
    .sort((left, right) => right.activeBoostCount - left.activeBoostCount || left.id.localeCompare(right.id));
  return {
    observedAt: boostState.snapshot?.measuredAt || new Date().toISOString(),
    summary: { discordBoostCount, assignedBoostCount, boostConsistencyState: consistencyState },
    rows
  };
};

export const getHeavenEconomyPublicSnapshot = async ({
  guild,
  cfg,
  targetUserId = '',
  includeOwnAccount = false
} = {}) => {
  if (!guild) throw new Error('Server wurde nicht gefunden.');
  await mutationQueue.catch(() => {});
  const data = await loadEconomyStore();
  const economy = guildState(data, guild.id);
  const tiers = vipTiers(guild, cfg);
  const boostState = await activeBoostState(guild);
  const members = guild.members.cache.filter((member) => !member.user?.bot);
  const vipRows = members.map((member) => {
    const vip = currentVip(member, tiers);
    return vip ? { id: member.id, vip: { roleId: vip.roleId, name: vip.name, price: vip.price } } : null;
  }).filter(Boolean);
  const targetId = String(targetUserId || '');
  const targetMember = targetId ? guild.members.cache.get(targetId) : null;
  const targetVip = targetMember ? currentVip(targetMember, tiers) : null;
  const target = targetMember ? {
    id: targetMember.id,
    vip: targetVip ? { roleId: targetVip.roleId, name: targetVip.name, price: targetVip.price } : null,
    activeBoostCount: Number(boostState.counts.get(targetMember.id) || 0),
    ...(includeOwnAccount ? { account: accountSnapshot(economy.accounts?.[targetMember.id] || {}) } : {})
  } : null;
  return {
    configured: Boolean(tiers.length),
    observedAt: boostState.snapshot?.measuredAt || new Date().toISOString(),
    tiers: tiers.map((tier) => ({ roleId: tier.roleId, name: tier.name, price: tier.price })),
    summary: {
      vipMembers: vipRows.length,
      activeBoosters: [...boostState.counts.values()].filter((count) => Number(count) > 0).length,
      boostConsistencyState: String(boostState.snapshot?.summary?.consistencyState || 'unknown')
    },
    vipRows,
    target
  };
};

export const getHeavenEconomyAdminSnapshot = async ({
  guild,
  cfg,
  query = '',
  filter = 'all',
  page = 0,
  pageSize = 50,
  syncMembers = false
} = {}) => {
  if (!guild) throw new Error('Server wurde nicht gefunden.');
  if (syncMembers) await guild.members.fetch().catch((error) => {
    quietLog(QUIET_LOG_SCOPE.heavenEconomy, error, `members.fetch (Sync) fehlgeschlagen`);
  });
  await mutationQueue.catch(() => {});
  const data = await loadEconomyStore();
  const economy = guildState(data, guild.id);
  const tiers = vipTiers(guild, cfg);
  const boostState = await activeBoostState(guild);
  const boostCounts = boostState.counts;
  const discordBoostCount = Math.max(0, Number(boostState.snapshot?.summary?.discordBoostCount || guild.premiumSubscriptionCount || 0));
  const assignedBoostCount = Math.max(0, Number(boostState.snapshot?.summary?.assignedBoostCount || 0));
  const boostConsistencyState = String(boostState.snapshot?.summary?.consistencyState || (discordBoostCount === assignedBoostCount ? 'synchronized' : 'mismatch'));
  const milestoneReward = Math.max(0, Number(conf(cfg).boostMilestoneReward || 100));
  const memberIds = guild.members.cache
    .filter((member) => !member.user?.bot)
    .map((member) => member.id);
  // Ehemalige Mitglieder bleiben für Audit und einen möglichen Wiedereintritt
  // gespeichert, werden aber niemals als verwaltbare VIP-Konten angezeigt.
  const ids = [...new Set(memberIds)];
  const normalizedQuery = String(query || '').trim().toLocaleLowerCase('de-DE');
  const allowedFilter = new Set(['all', 'vip', 'balance', 'boosts']);
  const selectedFilter = allowedFilter.has(String(filter || '')) ? String(filter) : 'all';

  const allRows = ids.map((userId) => {
    const identity = economyIdentity(guild, userId);
    const account = accountSnapshot(economy.accounts?.[userId] || {});
    const activeVip = identity.member ? currentVip(identity.member, tiers) : null;
    const activeBoostCount = boostCounts.get(String(userId)) || 0;
    const milestoneCredit = calculateBoostMilestoneCredit({
      rewardedBoostLevels: account.rewardedBoostLevels,
      count: activeBoostCount,
      reward: milestoneReward
    });
    return {
      id: identity.id,
      displayName: identity.displayName,
      username: identity.username,
      avatar: identity.avatar,
      onServer: identity.onServer,
      activeBoostCount,
      boostMilestones: {
        pendingLevels: milestoneCredit.levels,
        pendingCoins: milestoneCredit.amount,
        nextOpenLevel: Array.from({ length: 99 }, (_, index) => index + 1).find((level) => !account.rewardedBoostLevels.includes(level)) || null,
        automaticCreditPaused: boostConsistencyState === 'mismatch'
      },
      vip: activeVip ? { roleId: activeVip.roleId, name: activeVip.name, price: activeVip.price } : null,
      account
    };
  });
  const rows = allRows.filter((row) => {
    const matchesQuery = !normalizedQuery || `${row.displayName} ${row.username} ${row.id}`.toLocaleLowerCase('de-DE').includes(normalizedQuery);
    if (!matchesQuery) return false;
    if (selectedFilter === 'vip') return Boolean(row.vip);
    if (selectedFilter === 'balance') return row.account.balance > 0;
    if (selectedFilter === 'boosts') return row.account.boostRecord > 0 || row.activeBoostCount > 0;
    return true;
  }).sort((left, right) => {
    if (Boolean(left.vip) !== Boolean(right.vip)) return Number(Boolean(right.vip)) - Number(Boolean(left.vip));
    if (left.account.balance !== right.account.balance) return right.account.balance - left.account.balance;
    return left.displayName.localeCompare(right.displayName, 'de', { sensitivity: 'base' });
  });

  const total = rows.length;
  const normalizedPageSize = finiteInteger(pageSize, 50, 10, 100);
  const pageCount = Math.max(1, Math.ceil(total / normalizedPageSize));
  const normalizedPage = finiteInteger(page, 0, 0, pageCount - 1);
  const offset = normalizedPage * normalizedPageSize;
  const allAccounts = Object.values(economy.accounts || {}).map(accountSnapshot);
  const allCurrentMembers = guild.members.cache.filter((member) => !member.user?.bot);
  const currentAccounts = memberIds.map((userId) => economy.accounts?.[userId]).filter(Boolean).map(accountSnapshot);
  const allVipMembers = allCurrentMembers.filter((member) => Boolean(currentVip(member, tiers)));
  const transactions = [...(economy.transactions || [])]
    .filter((transaction) => guild.members.cache.has(String(transaction.targetUserId || transaction.userId || '')))
    .slice(-80).reverse().map((transaction) => {
    const subject = economyIdentity(guild, transaction.targetUserId || transaction.userId);
    const actor = transaction.actorId ? economyIdentity(guild, transaction.actorId) : null;
    return {
      ...transaction,
      subject: {
        id: subject.id,
        displayName: subject.displayName,
        username: subject.username,
        avatarUrl: subject.avatarUrl,
        avatar: subject.avatar,
        onServer: subject.onServer
      },
      actor: actor ? {
        id: actor.id,
        displayName: actor.displayName,
        username: actor.username,
        avatarUrl: actor.avatarUrl,
        avatar: actor.avatar,
        onServer: actor.onServer
      } : null
    };
  });

  return {
    schemaVersion: ECONOMY_VERSION,
    revision: finiteInteger(economy.revision, 0, 0, Number.MAX_SAFE_INTEGER),
    configured: conf(cfg).enabled === true,
    coinEmoji: coin(cfg),
    summary: {
      members: allCurrentMembers.size,
      accounts: currentAccounts.length,
      storedAccounts: allAccounts.length,
      totalBalance: currentAccounts.reduce((sum, account) => sum + account.balance, 0),
      totalEarned: currentAccounts.reduce((sum, account) => sum + account.earned, 0),
      totalSpent: currentAccounts.reduce((sum, account) => sum + account.spent, 0),
      vipMembers: allVipMembers.size,
      activeBoosters: [...boostCounts.values()].filter((count) => count > 0).length,
      discordBoostCount,
      assignedBoostCount,
      boostConsistencyState,
      boostConsistencyVerified: boostConsistencyState !== 'mismatch',
      pendingBoostMilestones: allRows.reduce((sum, row) => sum + row.boostMilestones.pendingLevels.length, 0),
      pendingBoostCoins: allRows.reduce((sum, row) => sum + row.boostMilestones.pendingCoins, 0),
      transactions: transactions.length,
      storedTransactions: (economy.transactions || []).length,
      departedAccounts: Object.keys(economy.accounts || {}).filter((userId) => !guild.members.cache.has(userId)).length
    },
    tiers,
    rows: rows.slice(offset, offset + normalizedPageSize),
    memberOptions: allCurrentMembers
      .sort((left, right) => left.displayName.localeCompare(right.displayName, 'de', { sensitivity: 'base' }))
      .map((member) => ({
        id: member.id,
        displayName: member.displayName,
        username: member.user.username,
        avatar: resolveAvatarUrl(member.user, { extension: 'webp', size: 64 }),
        avatarUrl: resolveAvatarUrl(member.user, { extension: 'webp', size: 64 })
      })),
    transactions,
    pagination: { page: normalizedPage, pageSize: normalizedPageSize, pageCount, total },
    reconciliation: economyReconcileStatus.get(String(guild.id)) || null,
    measuredAt: new Date().toISOString(),
    memberCacheComplete: guild.members.cache.size >= Number(guild.memberCount || 0)
  };
};

export const updateHeavenEconomyAccount = async ({ guild, cfg, payload = {}, actorId = '' } = {}) => {
  if (!guild) throw new Error('Server wurde nicht gefunden.');
  const userId = String(payload.userId || '').trim();
  if (!/^\d{16,22}$/.test(userId)) throw new Error('Bitte wähle ein gültiges Discord-Mitglied aus.');
  const reason = String(payload.reason || '').trim();
  if (reason.length < 3 || reason.length > 300) throw new Error('Bitte gib einen nachvollziehbaren Grund mit 3 bis 300 Zeichen an.');
  const balance = finiteInteger(payload.balance, -1, 0, 10_000_000);
  const boostRecord = finiteInteger(payload.boostRecord, -1, 0, 99);
  if (balance < 0) throw new Error('Der Kontostand muss zwischen 0 und 10.000.000 Coins liegen.');
  if (boostRecord < 0) throw new Error('Der Boost-Rekord muss zwischen 0 und 99 liegen.');
  const rewardedBoostLevels = normalizeBoostLevels(payload.rewardedBoostLevels);
  if (rewardedBoostLevels.some((level) => level > boostRecord)) {
    throw new Error('Ein vergüteter Boost-Meilenstein darf nicht über dem persönlichen Boost-Rekord liegen.');
  }
  const expectedRevision = finiteInteger(payload.expectedRevision, 0, 0, Number.MAX_SAFE_INTEGER);
  const tiers = vipTiers(guild, cfg);
  const requestedVipRoleId = String(payload.vipRoleId || '');
  if (requestedVipRoleId && !tiers.some((tier) => tier.roleId === requestedVipRoleId)) {
    throw new Error('Die ausgewählte VIP-Rolle ist nicht mehr konfiguriert. Bitte lade die Ansicht neu.');
  }
  const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch((error) => {
    quietLog(QUIET_LOG_SCOPE.heavenEconomy, error, `members.fetch fehlgeschlagen: ${userId}`);
    return null;
  });
  if (requestedVipRoleId && !member) throw new Error('Eine VIP-Rolle kann nur an ein Mitglied vergeben werden, das noch auf dem Server ist.');

  const result = await mutate(async (data) => {
    const economy = guildState(data, guild.id);
    const account = accountState(economy, userId);
    const before = accountSnapshot(account);
    if (before.revision !== expectedRevision) {
      const error = new Error('Dieses Konto wurde inzwischen geändert. Die aktuellen Werte werden neu geladen.');
      error.code = 'ECONOMY_REVISION_CONFLICT';
      throw error;
    }

    const currentVipRoles = member ? tiers.filter((tier) => member.roles.cache.has(tier.roleId)) : [];
    const previousVipRoleId = currentVipRoles.sort((left, right) => right.price - left.price)[0]?.roleId || '';
    const roleChanged = previousVipRoleId !== requestedVipRoleId;
    if (roleChanged && member) {
      const affectedRoles = tiers
        .filter((tier) => member.roles.cache.has(tier.roleId) || tier.roleId === requestedVipRoleId)
        .map((tier) => guild.roles.cache.get(tier.roleId))
        .filter(Boolean);
      if (affectedRoles.some((role) => !role.editable)) {
        throw new Error('Mindestens eine VIP-Rolle liegt über der Bot-Rolle und kann nicht sicher geändert werden.');
      }
      const previousRoleIds = currentVipRoles.map((tier) => tier.roleId);
      try {
        const removeIds = previousRoleIds.filter((roleId) => roleId !== requestedVipRoleId);
        if (removeIds.length) await member.roles.remove(removeIds, `Heaven Economy Korrektur durch ${actorId}: ${reason}`);
        if (requestedVipRoleId && !member.roles.cache.has(requestedVipRoleId)) {
          await member.roles.add(requestedVipRoleId, `Heaven Economy Korrektur durch ${actorId}: ${reason}`);
        }
      } catch (error) {
        const restoreIds = previousRoleIds.filter((roleId) => guild.roles.cache.get(roleId)?.editable);
        if (requestedVipRoleId && !previousRoleIds.includes(requestedVipRoleId)) {
          await member.roles.remove(requestedVipRoleId, 'Heaven Economy Rollback').catch(() => {});
        }
        if (restoreIds.length) await member.roles.add(restoreIds, 'Heaven Economy Rollback').catch(() => {});
        throw new Error(`Die VIP-Rolle konnte nicht sicher geändert werden: ${error?.message || error}`, { cause: error });
      }
    }

    const balanceDelta = balance - before.balance;
    account.balance = balance;
    if (balanceDelta > 0) account.earned = before.earned + balanceDelta;
    if (balanceDelta < 0) account.spent = before.spent + Math.abs(balanceDelta);
    account.boostRecord = boostRecord;
    account.rewardedBoostLevels = rewardedBoostLevels;
    account.revision = before.revision + 1;
    account.updatedAt = new Date().toISOString();
    const after = accountSnapshot(account);
    const changes = {
      balance: before.balance === after.balance ? null : { before: before.balance, after: after.balance },
      boostRecord: before.boostRecord === after.boostRecord ? null : { before: before.boostRecord, after: after.boostRecord },
      rewardedBoostLevels: JSON.stringify(before.rewardedBoostLevels) === JSON.stringify(after.rewardedBoostLevels)
        ? null
        : { before: before.rewardedBoostLevels, after: after.rewardedBoostLevels },
      vipRole: roleChanged ? { before: previousVipRoleId, after: requestedVipRoleId } : null
    };
    const transaction = recordTransaction(economy, {
      type: 'admin-account-correction',
      userId,
      actorId: String(actorId || ''),
      amount: balanceDelta,
      balanceBefore: before.balance,
      balanceAfter: after.balance,
      reason,
      changes
    });
    return { before, after, previousVipRoleId, vipRoleId: requestedVipRoleId, transaction, changes };
  });

  const identity = economyIdentity(guild, userId);
  await sendEconomyLog(
    guild,
    cfg,
    'VIP- und Coin-Daten korrigiert',
    `Mitglied: <@${userId}>\nBearbeitet von: <@${actorId}>\nKontostand: **${money(result.before.balance)} → ${money(result.after.balance)}**\nBoost-Rekord: **${result.before.boostRecord}× → ${result.after.boostRecord}×**\nGrund: ${reason}\nTransaktion: ${result.transaction.id}`
  );
  // DM-Benachrichtigungen (editierbare Embeds): Gutschrift → coinsReceived,
  // Rollenvergabe → giftReceived (vom Team). Fehler brechen die Korrektur nie.
  if (result.after.balance > result.before.balance) {
    void sendEconomyDm({
      guild,
      cfg,
      userId,
      section: 'coinsReceived',
      context: economyDmContext({
        guild,
        userId,
        coins: money(result.after.balance - result.before.balance),
        balance: money(result.after.balance),
        reason
      })
    });
  }
  const grantedTier = result.vipRoleId ? tiers.find((tier) => tier.roleId === result.vipRoleId) : null;
  if (grantedTier && result.changes?.vipRole?.before !== result.changes?.vipRole?.after) {
    void sendEconomyDm({
      guild,
      cfg,
      userId,
      section: 'giftReceived',
      context: economyDmContext({
        guild,
        userId,
        tier: grantedTier,
        giverId: '',
        reason
      })
    });
  }
  scheduleVipSeparatorSync(guild, cfg);
  return {
    ...result,
    member: {
      id: identity.id,
      displayName: identity.displayName,
      username: identity.username,
      avatarUrl: identity.avatarUrl,
      avatar: identity.avatar,
      onServer: identity.onServer
    },
    vip: tiers.find((tier) => tier.roleId === result.vipRoleId) || null
  };
};

const accountEmbed = async (interaction, cfg) => {
  const freshMember = await interaction.guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => interaction.member);
  let activeBoostCount = 0;
  let boostCreditPaused = false;
  if (freshMember?.premiumSince) {
    try {
      activeBoostCount = await resolveMemberBoostCount(freshMember, cfg);
      if (activeBoostCount > 0) await awardBoostMilestones({ member: freshMember, cfg, count: activeBoostCount });
    } catch (error) {
      if (error?.code !== 'BOOST_CONSISTENCY_MISMATCH') throw error;
      activeBoostCount = Math.max(0, Number(error.activeBoostCount || 0));
      boostCreditPaused = true;
    }
  }
  const account = await getAccount(interaction.guildId, interaction.user.id);
  const tiers = vipTiers(interaction.guild, cfg);
  const member = interaction.member;
  const active = currentVip(member, tiers);
  const next = tiers.find((tier) => tier.price > Number(active?.price || 0));
  return new EmbedBuilder()
    .setColor(0x7772ff)
    .setAuthor({ name: 'FALLEN HEAVEN · DEIN KONTO', iconURL: interaction.user.displayAvatarURL() })
    .setTitle(`${coin(cfg)} ${money(account.balance)}`)
    .setDescription(active ? `Aktive Stufe: **${active.name}**` : 'Du besitzt aktuell noch keine VIP-Stufe.')
    .addFields(
      { name: 'Verdient', value: money(account.earned), inline: true },
      { name: 'Ausgegeben', value: money(account.spent), inline: true },
      { name: 'Verschenkt', value: money(account.giftedCoins), inline: true },
      { name: 'Geschenkt erhalten', value: money(account.receivedGiftCoins), inline: true },
      { name: 'Aktuell aktiv', value: activeBoostCount > 0 ? `${activeBoostCount}× Boost` : 'Kein aktiver Boost', inline: true },
      { name: 'Boost-Rekord', value: `${account.boostRecord || 0}×`, inline: true },
      { name: 'Coin-Abgleich', value: boostCreditPaused ? 'Sicher pausiert – Team prüft die Discord-Gesamtsumme' : 'Aktuell und automatisch geprüft', inline: true },
      { name: 'Nächstes Upgrade', value: next ? `${next.name} · ${money(Math.max(0, next.price - Number(active?.price || 0)))}` : 'Höchste Stufe erreicht' }
    )
    .setFooter({ text: 'Heaven Coins sind nicht auszahlbar und gelten ausschließlich innerhalb von FALLEN HEAVEN.' });
};

const ECONOMY_BUTTON_DEFAULTS = {
  accountButtonLabel: 'Mein Konto',
  shopButtonLabel: 'VIP-Shop',
  giftButtonLabel: 'VIP verschenken',
  coinGiftButtonLabel: 'Coins verschenken',
  buyButtonLabel: 'Coins kaufen',
  progressButtonLabel: 'Boost-Fortschritt',
  adminButtonLabel: 'Coin-Verwaltung'
};
const economyButtonTexts = (cfg) => {
  const section = conf(cfg);
  return Object.fromEntries(Object.entries(ECONOMY_BUTTON_DEFAULTS).map(([key, fallback]) => [key, String(section[key] ?? fallback).slice(0, 80) || fallback]));
};
export const buildHeavenEconomyComponents = (cfg = {}) => {
  const texts = economyButtonTexts(cfg);
  const rowOneButtons = [
    new ButtonBuilder().setCustomId('fh_coin:account').setLabel(texts.accountButtonLabel).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('fh_coin:shop').setLabel(texts.shopButtonLabel).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('fh_coin:gift').setLabel(texts.giftButtonLabel).setStyle(ButtonStyle.Secondary)
  ];
  if (conf(cfg).coinGiftsEnabled !== false) rowOneButtons.push(new ButtonBuilder().setCustomId('fh_coin:coin-gift').setLabel(texts.coinGiftButtonLabel).setStyle(ButtonStyle.Secondary));
  const rowOne = new ActionRowBuilder().addComponents(rowOneButtons);
  const rowTwo = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('fh_coin:buy').setLabel(texts.buyButtonLabel).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('fh_coin:progress').setLabel(texts.progressButtonLabel).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('fh_coin:admin').setLabel(texts.adminButtonLabel).setStyle(ButtonStyle.Secondary)
  );
  return [rowOne, rowTwo];
};

const defaultEconomyPanelTemplate = () => ({
  content: '',
  outsideImageUrl: '',
  outsideImageName: '',
  outsideImageSize: 0,
  outsideImageAttachment: null,
  embeds: [{
    title: '👑 VIP-VORTEILE',
    description: 'Mit einem VIP-Rang unterstützt du **{server}** und erhältst Zugang zu zusätzlichen Bereichen und Community-Vorteilen.',
    color: '#7772ff',
    authorName: '{server}',
    authorIconUrl: '',
    thumbnailUrl: '',
    imageUrl: '',
    footerText: '{server} · Heaven Coins',
    footerIconUrl: '',
    timestamp: false,
    fields: [
      { name: '🌟 Hervorgehobene Präsenz', value: 'Dein VIP-Rang hebt dich sichtbar innerhalb der Community hervor.', inline: false },
      { name: '📸 VIP-Media', value: 'Zugang zu einem eigenen Bereich für Bilder, Clips und besondere Community-Momente.', inline: false },
      { name: '🎤 VIP-Lounges', value: 'Nutze zusätzliche Voice-Bereiche, die VIP-Mitgliedern vorbehalten sind.', inline: false },
      { name: '💬 VIP-Bereiche', value: 'Je nach VIP-Stufe erhältst du Zugang zu den vorgesehenen Chats und Lounges.', inline: false },
      { name: '🎁 Aktionen & Early Access', value: 'Nimm an exklusiven Aktionen teil und erhalte ausgewählte Informationen früher.', inline: false },
      { name: '⚡ Priority Support', value: 'VIP-Anliegen werden im Support bevorzugt bearbeitet.', inline: false }
    ]
  }]
});

export const normalizeEconomyPanelTemplate = (value) => {
  const fallback = defaultEconomyPanelTemplate();
  const source = value && typeof value === 'object' ? value : {};
  const base = fallback.embeds[0];
  const inputs = (Array.isArray(source.embeds) ? source.embeds : [source.embed]).filter((entry) => entry && typeof entry === 'object').slice(0, 10);
  const outsideImageAttachment = source.removeOutsideImage === true
    ? null
    : source.outsideImageAttachment && typeof source.outsideImageAttachment === 'object'
      ? {
          localAsset: source.outsideImageAttachment.localAsset === true,
          id: String(source.outsideImageAttachment.id || ''),
          url: String(source.outsideImageAttachment.url || '').slice(0, 2048),
          name: String(source.outsideImageAttachment.name || source.outsideImageName || 'bild.png').slice(0, 120),
          size: Math.max(0, Number(source.outsideImageAttachment.size || source.outsideImageSize || 0)),
          mime: String(source.outsideImageAttachment.mime || '').slice(0, 100)
        }
      : null;
  return {
    content: String(source.content || '').slice(0, 2000),
    outsideImageUrl: source.removeOutsideImage === true ? '' : String(source.outsideImageUrl || '').slice(0, 2048),
    outsideImageName: String(source.outsideImageName || outsideImageAttachment?.name || '').slice(0, 120),
    outsideImageSize: Math.max(0, Number(source.outsideImageSize || outsideImageAttachment?.size || 0)),
    outsideImageAttachment,
    embeds: (inputs.length ? inputs : [base]).map((input) => ({
      title: String(input.title !== undefined ? input.title : base.title).slice(0, 256),
      url: String(input.url || '').slice(0, 2048),
      description: String(input.description !== undefined ? input.description : base.description).slice(0, 4096),
      color: String(input.color || base.color).slice(0, 16),
      authorName: String(input.authorName !== undefined ? input.authorName : base.authorName).slice(0, 256),
      authorIconUrl: String(input.authorIconUrl || '').slice(0, 2048),
      thumbnailUrl: String(input.thumbnailUrl || '').slice(0, 2048),
      imageUrl: String(input.imageUrl || '').slice(0, 2048),
      footerText: String(input.footerText !== undefined ? input.footerText : base.footerText).slice(0, 2048),
      footerIconUrl: String(input.footerIconUrl || '').slice(0, 2048),
      timestamp: input.timestamp === true,
      fields: (Array.isArray(input.fields) ? input.fields : base.fields).slice(0, 25).map((field) => ({
        name: String(field?.name || '').slice(0, 256),
        value: String(field?.value || '').slice(0, 1024),
        inline: field?.inline === true
      })).filter((field) => field.name && field.value)
    }))
  };
};

const renderEconomyPanelText = (value, guild, cfg) => String(value || '')
  .replaceAll('{server}', guild?.name || 'FALLEN HEAVEN')
  .replaceAll('{coinEmoji}', coin(cfg))
  .replaceAll('{boostMilestoneReward}', money(conf(cfg).boostMilestoneReward || 100));

export const buildHeavenEconomyPanelPayload = async (guild, cfg, dependencies = {}) => {
  const normalizeOutside = dependencies.materializeTemplate || materializeOutsideImageTemplate;
  const template = await normalizeOutside(normalizeEconomyPanelTemplate(conf(cfg).panelTemplate));
  const payload = await buildStudioEmbedPayload(template, guild, {
    formatValue: (value) => renderEconomyPanelText(value, guild, cfg),
    ...(typeof dependencies.fetchAsset === 'function' ? { fetchAsset: dependencies.fetchAsset } : {})
  });
  payload.components = buildHeavenEconomyComponents(cfg);
  payload.allowedMentions = { parse: [] };
  return payload;
};

const ensurePanelOnce = async (guild, cfg) => {
  const settings = conf(cfg);
  if (!settings.enabled || !settings.panelChannelId) return null;
  const channel = guild.channels.cache.get(String(settings.panelChannelId)) || await guild.channels.fetch(String(settings.panelChannelId)).catch((error) => {
    quietLog(QUIET_LOG_SCOPE.heavenEconomy, error, `channels.fetch (Panel) fehlgeschlagen: ${settings.panelChannelId}`);
    return null;
  });
  if (!channel?.isTextBased?.() || !channel.messages) throw new Error('Der konfigurierte Heaven-Coin-Kanal ist nicht beschreibbar.');
  const panels = await loadPanelStore();
  let message = panels[guild.id] ? await channel.messages.fetch(String(panels[guild.id])).catch((error) => {
    quietLog(QUIET_LOG_SCOPE.heavenEconomy, error, `messages.fetch (Panel) fehlgeschlagen: ${panels[guild.id]}`);
    return null;
  }) : null;
  if (message?.author?.id === guild.client.user.id) await message.edit(await buildHeavenEconomyPanelPayload(guild, cfg));
  else {
    message = await channel.send(await buildHeavenEconomyPanelPayload(guild, cfg));
    panels[guild.id] = message.id;
    await atomicWriteJson(PANEL_FILE, panels, { backupLimit: 5 });
  }
  return message;
};

export const refreshHeavenEconomyPanel = async ({ guild, cfg } = {}) => {
  if (!guild) throw new Error('Server wurde nicht gefunden.');
  const guildId = String(guild.id);
  const previous = economyPanelRefreshJobs.get(guildId) || Promise.resolve();
  const job = previous.catch(() => {}).then(() => ensurePanelOnce(guild, cfg));
  economyPanelRefreshJobs.set(guildId, job);
  try {
    const message = await job;
    return { liveUpdated: Boolean(message), messageId: String(message?.id || ''), skipped: !message };
  } finally {
    if (economyPanelRefreshJobs.get(guildId) === job) economyPanelRefreshJobs.delete(guildId);
  }
};

export const saveHeavenEconomyPanelDesign = async ({ guild, cfg = {}, template = {}, channelId = '' } = {}) => {
  if (!guild) throw new Error('Server wurde nicht gefunden.');
  const normalizedTemplate = normalizeEconomyPanelTemplate(template);
  const nextChannelId = String(channelId || conf(cfg).panelChannelId || '').trim();
  const nextCfg = { ...cfg, heavenEconomy: { ...conf(cfg), panelChannelId: nextChannelId, panelTemplate: normalizedTemplate } };
  try {
    const refreshed = await refreshHeavenEconomyPanel({ guild, cfg: nextCfg });
    return { template: normalizedTemplate, channelId: nextChannelId, ...refreshed, refreshError: '' };
  } catch (error) {
    return { template: normalizedTemplate, channelId: nextChannelId, liveUpdated: false, messageId: '', refreshError: error?.message || String(error) };
  }
};

/* VIP-Panels: Für jede konfigurierte VIP-Stufe wird genau eine Live-Nachricht
   in ihrem eigenen Kanal geführt, die alle Mitglieder dieser Stufe auflistet.
   Die Nachricht wird einmal gesendet und anschließend bei jeder Änderung
   bearbeitet (wie das Aktivitäts-Liga-Panel). Stufen ohne Kanal werden
   übersprungen – jede Stufe erscheint also in einem eigenen Kanal. */
const vipPanelDefaultTemplate = () => ({
  content: '',
  outsideImageUrl: '',
  vipTierFieldTemplate: '{tierEmoji} {tierName} · {tierMemberCount}',
  vipTierMemberFormat: '<@{memberId}>',
  vipTierEmptyText: '*Noch keine Mitglieder.*',
  vipTierOverflowText: '… und {overflowCount} weitere',
  embeds: [{
    title: '👑 VIP-Übersicht',
    description: 'Alle VIP-Stufen und ihre Mitglieder auf einen Blick – live aktualisiert.',
    color: '#ffbd59',
    authorName: '{server} · VIP-Übersicht',
    authorIconUrl: '',
    thumbnailUrl: '',
    imageUrl: '',
    footerText: '{memberCount} VIP-Mitglieder in {tierCount} Stufen',
    footerIconUrl: '',
    timestamp: true,
    fields: []
  }]
});

// Die auf dem Server hochgeladenen Rang-Emojis (z. B. „VIP_Bronze“) werden je
// VIP-Stufe automatisch ins Panel gesetzt. Der Rang wird über den Coin-Preis
// (Standard-Schwellen) oder den Stufennamen erkannt; {tierEmoji} greift auf
// den passenden Server-Emoji zurück (oder 👑, wenn keiner gefunden wird).
const VIP_RANK_EMOJI_KEYWORDS = [
  { keyword: 'bronze', price: 1000, aliases: ['bronze'] },
  { keyword: 'silber', price: 2500, aliases: ['silber', 'silver'] },
  { keyword: 'gold', price: 4000, aliases: ['gold'] },
  { keyword: 'diamant', price: 5000, aliases: ['diamant', 'diamond'] }
];
const tierRankKeyword = (tier) => {
  const price = Math.max(1, Number(tier?.price || 0));
  const fromPrice = VIP_RANK_EMOJI_KEYWORDS.find((entry) => entry.price === price)?.keyword || '';
  const fromName = String(tier?.name || '').toLocaleLowerCase('de-DE')
    .split(/[^a-z0-9äöüß]+/i)
    .map((token) => token.trim())
    .filter(Boolean)
    .find((token) => VIP_RANK_EMOJI_KEYWORDS.some((entry) => entry.aliases.includes(token)));
  return fromName || fromPrice || '';
};
// Auflösung mit Priorität: Nur Emojis, deren Name eindeutig auf den Rang
// hinweist („vip<rang>“ exakt, dann „vip“ oder „wing“ + Rang), gelten als
// Rang-Emoji. So gewinnt z. B. „VIP_Gold“/„FH_FALLENANGELWINGVIPGOLD“ immer
// gegen ein generisches „…HEARTGOLD“. Gesucht wird zuerst auf dem aktuellen
// Server, dann auf allen anderen Servern, die der Bot teilt (dort liegen oft
// die hochgeladenen Rang-Emojis).
const resolveTierEmojiObject = (guild, tier) => {
  const keyword = tierRankKeyword(tier);
  if (!keyword) return null;
  const definition = VIP_RANK_EMOJI_KEYWORDS.find((entry) => entry.keyword === keyword);
  const aliases = definition?.aliases || [keyword];
  const normalized = (name) => String(name || '').toLocaleLowerCase('de-DE').replace(/[^a-z0-9]/g, '');
  const current = guild?.emojis?.cache?.values ? [...guild.emojis.cache.values()] : [];
  const others = guild?.client?.guilds?.cache?.values
    ? [...guild.client.guilds.cache.values()]
      .flatMap((entry) => (entry.emojis?.cache?.values ? [...entry.emojis.cache.values()] : []))
      .filter((entry) => !current.includes(entry))
    : [];
  const score = (entry) => {
    const name = normalized(entry?.name);
    if (!name) return 0;
    if (aliases.some((alias) => name === `vip${alias}`)) return 4;
    if (name.includes('vip') && aliases.some((alias) => name.includes(alias))) return 3;
    if (name.includes('wing') && aliases.some((alias) => name.includes(alias))) return 2;
    return 0;
  };
  return [...current, ...others].reduce((best, entry) => {
    const entryScore = score(entry);
    if (entryScore <= 0) return best;
    if (!best || entryScore > best.score) return { entry, score: entryScore };
    return best;
  }, null)?.entry || null;
};
const resolveTierEmoji = (guild, tier) => {
  const emoji = resolveTierEmojiObject(guild, tier);
  if (emoji?.id) return `<${emoji.animated ? 'a' : ''}:${emoji.name || 'vip'}:${emoji.id}>`;
  return '';
};
// Stufen ohne eigenes Rang-Emoji (z. B. die Basis-VIP-Rolle) übernehmen die
// goldenen Flügel von VIP GOLD, damit sie nicht mit dem generischen 👑-Symbol
// abweichen. Nur wenn gar kein passender Emoji existiert, bleibt 👑.
const resolveTierDisplayEmoji = (guild, tier) => {
  const specific = resolveTierEmoji(guild, tier);
  if (specific) return specific;
  const gold = resolveTierEmojiObject(guild, { price: 4000, name: 'VIP: GOLD' });
  if (gold?.id) return `<${gold.animated ? 'a' : ''}:${gold.name || 'vip'}:${gold.id}>`;
  return '👑';
};
// Discord-Rollennamen enthalten oft bereits ein Emoji (z. B. „💛 VIP: GOLD“).
// Fürs Panel wird nur der saubere Name verwendet – das Rang-Emoji kommt aus
// den hochgeladenen Server-Emojis, nicht aus dem Rollennamen.
const stripLeadingEmojis = (value) => String(value || '')
  .replace(/^\p{Extended_Pictographic}+/u, '')
  .replace(/^[\u200d\ufe0f\s:–—-]+/, '') // eslint-disable-line no-misleading-character-class
  .trim();

const vipPanelChannel = (guild, cfg) => {
  const allowed = (channel) => channel && channel.isTextBased?.()
    && [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(Number(channel.type));
  const configured = String(conf(cfg).vipPanelChannelId || '');
  if (configured) {
    const channel = guild?.channels?.cache?.get?.(configured);
    if (allowed(channel)) return channel;
  }
  if (!guild) return null;
  const channels = [...guild.channels.cache.values()].filter(allowed);
  const name = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('de-DE').replace(/[^a-z0-9]/g, '');
  return channels.find((channel) => name(channel.name) === 'vip')
    || channels.find((channel) => name(channel.name).includes('vip'))
    || null;
};

const vipPanelTemplate = (cfg) => {
  const template = conf(cfg).vipPanelTemplate;
  return template && typeof template === 'object' ? template : vipPanelDefaultTemplate();
};

const formatVipPanelText = (value, context) => String(value || '')
  .replaceAll('{server}', context.server)
  .replaceAll('{guild}', context.server)
  .replaceAll('{guildname}', context.server)
  .replaceAll('{memberCount}', String(context.memberCount))
  .replaceAll('{tierCount}', String(context.tierCount))
  .replaceAll('{date}', context.date)
  .replaceAll('{time}', context.time);

const cleanPanelName = (value) => String(value || '').replace(/[*_`~|<>]/g, '').slice(0, 80);

/* Ein kombiniertes VIP-Embed: Alle Stufen zusammen in einer Nachricht. Jede
   Stufe wird als eigenes Feld mit Rang-Emoji, Stufenname und Mitgliederliste
   geführt – die Reihenfolge folgt dem Coin-Preis aufsteigend. */
export const buildVipPanelPayload = (guild, cfg, entries, measuredAt, options = {}) => {
  const template = vipPanelTemplate(cfg);
  const source = Array.isArray(template.embeds) && template.embeds.length ? template.embeds[0] : template.embed || {};
  const date = new Date(measuredAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = new Date(measuredAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const allRows = Array.isArray(entries) ? entries : [];
  const memberCount = allRows.reduce((sum, entry) => sum + (Array.isArray(entry.rows) ? entry.rows.length : 0), 0);
  const context = {
    server: guild?.name || 'FALLEN HEAVEN',
    memberCount,
    tierCount: allRows.length,
    date,
    time
  };
  const embed = new EmbedBuilder();
  const parsed = Number.parseInt(String(source.color || '').replace('#', ''), 16);
  if (Number.isFinite(parsed)) embed.setColor(parsed);
  const title = formatVipPanelText(source.title, context).slice(0, 256);
  const description = formatVipPanelText(source.description, context).slice(0, 4096);
  const authorName = formatVipPanelText(source.authorName || source.author?.name, context).slice(0, 256);
  const footerText = formatVipPanelText(source.footerText || source.footer?.text, context).slice(0, 2048);
  if (title) embed.setTitle(title);
  if (description) embed.setDescription(description);
  if (authorName) embed.setAuthor({ name: authorName, iconURL: source.authorIconUrl || guild?.iconURL?.({ size: 128 }) || undefined });
  if (source.thumbnailUrl && isAllowedEmbedImageUrl(source.thumbnailUrl)) embed.setThumbnail(source.thumbnailUrl);
  if (source.imageUrl && isAllowedEmbedImageUrl(source.imageUrl)) embed.setImage(source.imageUrl);
  if (footerText) embed.setFooter({ text: footerText, iconURL: source.footerIconUrl || undefined });
  if (source.timestamp !== false) embed.setTimestamp(new Date(measuredAt));
  const customFields = Array.isArray(source.fields) ? source.fields : [];
  const tierFieldTemplate = String(template.vipTierFieldTemplate || '{tierEmoji} {tierName} · {tierMemberCount}');
  const tierMemberFormat = String(template.vipTierMemberFormat || '<@{memberId}>');
  const tierEmptyText = String(template.vipTierEmptyText || '*Noch keine Mitglieder.*');
  const tierOverflowText = String(template.vipTierOverflowText || '… und {overflowCount} weitere');
  const rankFields = allRows.map((entry) => {
    const tier = entry.tier || {};
    const members = Array.isArray(entry.rows) ? entry.rows : [];
    const emoji = resolveTierDisplayEmoji(guild, tier);
    const cleanName = cleanPanelName(stripLeadingEmojis(tier.name) || 'VIP');
    const maxDisplay = 15;
    const displayMembers = members.slice(0, maxDisplay);
    const overflow = Math.max(0, members.length - maxDisplay);
    const memberLines = displayMembers.map((row) => tierMemberFormat.replaceAll('{memberId}', String(row.id)).replaceAll('{memberName}', String(row.displayName || row.username || 'Unbekannt')));
    if (overflow > 0) memberLines.push(tierOverflowText.replaceAll('{overflowCount}', String(overflow)));
    const value = members.length
      ? memberLines.join('\n')
      : tierEmptyText;
    const name = tierFieldTemplate
      .replaceAll('{tierEmoji}', emoji)
      .replaceAll('{tierName}', cleanName)
      .replaceAll('{tierMemberCount}', String(members.length))
      .replaceAll('{server}', guild?.name || 'FALLEN HEAVEN')
      .replaceAll('{date}', context.date)
      .replaceAll('{time}', context.time)
      .slice(0, 256);
    return { name, value: value.slice(0, 1024), inline: false };
  });
  const remainingFieldSlots = Math.max(0, 25 - rankFields.length);
  if (customFields.length) {
    embed.addFields(customFields.slice(0, remainingFieldSlots).map((field) => ({
      name: formatVipPanelText(field?.name, context).slice(0, 256) || '\u200b',
      value: formatVipPanelText(field?.value, context).slice(0, 1024) || '\u200b',
      inline: field?.inline === true
    })));
  }
  if (rankFields.length) embed.addFields(rankFields.slice(0, 25));
  // Außenbild: Ein neu hochgeladenes Bild wird als Datei mitgesendet, ein
  // bereits persistierter Anhang bleibt bei Bearbeitungen erhalten, ansonsten
  // erscheint eine Bild-URL als eigenständige Zeile unter dem Embed.
  const outsideImageUrl = String(template.outsideImageUrl || '').trim();
  const savedAttachment = normalizeVipPanelAttachment(template.outsideImageAttachment);
  const preserveAttachment = options.preserveAttachment === true && savedAttachment;
  const content = [
    formatVipPanelText(template.content, context).slice(0, 2000),
    options.outsideFile || preserveAttachment ? '' : outsideImageUrl
  ].filter(Boolean).join('\n').slice(0, 2000);
  const payload = {
    content: content || undefined,
    embeds: [embed],
    allowedMentions: { parse: [] }
  };
  if (options.outsideFile) {
    payload.files = [{ attachment: options.outsideFile, name: options.outsideFileName || 'fallen-heaven-vip.png' }];
    payload.attachments = [];
  } else if (preserveAttachment) {
    payload.attachments = [{ id: savedAttachment.id }];
  } else if (options.removeOutsideImage === true) {
    payload.attachments = [];
  }
  return payload;
};

const normalizeVipPanelAttachment = (value) => {
  if (!value || typeof value !== 'object') return null;
  const id = String(value?.id || '');
  const url = String(value?.url || '');
  if (!id && !/^https?:\/\//i.test(url)) return null;
  return {
    id,
    url,
    name: String(value?.name || value?.filename || 'fallen-heaven-vip.png'),
    size: Math.max(0, Number(value?.size || 0))
  };
};

const vipPanelRows = (guild, tiers, tier) => guild.members.cache
  .filter((member) => !member.user?.bot && currentVip(member, tiers)?.roleId === tier.roleId)
  .map((member) => ({
    id: String(member.id),
    displayName: String(member.displayName || member.user?.globalName || member.user?.username || member.id)
  }))
  .sort((left, right) => left.displayName.localeCompare(right.displayName, 'de', { sensitivity: 'base' }));

const vipPanelRuntime = new Map();
const ensureVipPanels = async (guild, cfg, {
  force = false,
  outsideFile = null,
  outsideFileName = '',
  removeOutsideImage = false
} = {}) => {
  const settings = conf(cfg);
  if (!settings.enabled || !settings.vipPanelEnabled) return null;
  const guildId = String(guild?.id || '');
  if (!guildId) return null;
  const runtime = vipPanelRuntime.get(guildId) || { running: false, lastAt: 0, lastError: '' };
  vipPanelRuntime.set(guildId, runtime);
  if (runtime.running) {
    // Ein laufendes Panel-Update (VIP-Änderung, Rollenabgleich oder
    // Konfig-Refresh) blockiert gerade. Statt stillschweigend abzubrechen –
    // wodurch ein gerade hochgeladenes Außenbild verloren ginge – kurz warten.
    for (let attempt = 0; attempt < 100 && runtime.running; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (runtime.running) {
      throw new Error('Ein laufendes VIP-Embed-Update blockiert den Vorgang. Bitte kurz warten und erneut speichern.');
    }
  }
  if (!force && Date.now() - runtime.lastAt < 30_000) return null;
  runtime.running = true;
  try {
    // Server-Emojis (VIP_Bronze, VIP_Gold, …) müssen im Cache liegen, sonst
    // fällt jede Stufe auf den 👑-Platzhalter zurück.
    await guild.emojis.fetch().catch((error) => {
      quietLog(QUIET_LOG_SCOPE.heavenEconomy, error, `emojis.fetch fehlgeschlagen`);
    });
    const tiers = vipTiers(guild, cfg);
    if (!tiers.length) return { panel: null, reason: 'no-tiers' };
    const channel = vipPanelChannel(guild, cfg);
    if (!channel) throw new Error('Der Textkanal für das VIP-Embed wurde nicht gefunden. Wähle einen Kanal aus oder benenne einen Kanal „vip“.');
    await mutationQueue.catch(() => {});
    const data = await loadEconomyStore();
    const economy = guildState(data, guildId);
    const stored = economy.panels && typeof economy.panels === 'object' ? economy.panels : { channelId: '', messageId: '' };
    const entries = tiers.map((tier) => ({ tier, rows: vipPanelRows(guild, tiers, tier) }));
    let message = null;
    if (stored.messageId && stored.channelId === channel.id) {
      message = await channel.messages.fetch(String(stored.messageId)).catch((error) => {
        quietLog(QUIET_LOG_SCOPE.heavenEconomy, error, `messages.fetch (VIP-Panel) fehlgeschlagen: ${stored.messageId}`);
        return null;
      });
    }
    const savedAttachment = normalizeVipPanelAttachment(vipPanelTemplate(cfg)?.outsideImageAttachment);
    const payload = buildVipPanelPayload(guild, cfg, entries, new Date().toISOString(), {
      outsideFile,
      outsideFileName,
      removeOutsideImage,
      preserveAttachment: Boolean(message && !outsideFile && !removeOutsideImage && savedAttachment)
    });
    if (!message) {
      if (stored.messageId && stored.channelId && stored.channelId !== channel.id) {
        const oldChannel = guild.channels.cache.get(String(stored.channelId));
        await oldChannel?.messages?.fetch?.(String(stored.messageId)).then((old) => old.delete()).catch((error) => {
          quietLog(QUIET_LOG_SCOPE.heavenEconomy, error, `Old-Panel löschen fehlgeschlagen: ${stored.messageId}`);
        });
      }
      message = await channel.send(payload);
    } else {
      // Wichtig: Den Rückgabewert von edit() übernehmen – nur die aktualisierte
      // Nachricht enthält die neu hochgeladenen Attachments. Die alte Referenz
      // (vom Fetch vor dem Edit) hat sie nicht.
      message = await message.edit(payload);
    }
    economy.panels = { channelId: String(channel.id), messageId: String(message.id), updatedAt: new Date().toISOString() };
    await atomicWriteJson(ECONOMY_FILE, normalizeEconomyData(data), { backupLimit: 5 });
    runtime.lastAt = Date.now();
    runtime.lastError = '';
    const memberCount = entries.reduce((sum, entry) => sum + entry.rows.length, 0);
    let attachment = message.attachments?.first?.();
    if (!attachment && outsideFile) {
      // Falls Discord den Anhang beim ersten Zugriff noch nicht auflistet,
      // einmal frisch nachladen (force), damit die CDN-URL des hochgeladenen
      // Bildes zuverlässig in der Konfiguration landet.
      const fresh = await channel.messages.fetch({ message: message.id, force: true }).catch((error) => {
        quietLog(QUIET_LOG_SCOPE.heavenEconomy, error, `messages.fetch (Fresh) fehlgeschlagen: ${message.id}`);
        return null;
      });
      attachment = fresh?.attachments?.first?.();
    }
    return {
      channelId: String(channel.id),
      messageId: String(message.id),
      memberCount,
      tierCount: tiers.length,
      outsideImageAttachment: attachment ? {
        id: String(attachment.id || ''),
        url: String(attachment.url || ''),
        name: String(attachment.name || outsideFileName || 'fallen-heaven-vip.png'),
        size: Number(attachment.size || 0)
      } : null
    };
  } catch (error) {
    runtime.lastError = String(error?.message || error).slice(0, 500);
    console.error(`[heavenEconomy] VIP-Embed ${guild?.name}:`, error.message);
    throw error;
  } finally {
    runtime.running = false;
  }
};

const vipPanelRefreshTimers = new Map();
const scheduleVipPanelRefresh = (guild, cfg) => {
  const guildId = String(guild?.id || '');
  if (!guildId || !conf(cfg).enabled || !conf(cfg).vipPanelEnabled) return;
  if (vipPanelRefreshTimers.has(guildId)) return;
  const timer = setTimeout(() => {
    vipPanelRefreshTimers.delete(guildId);
    void ensureVipPanels(guild, cfg, { force: true }).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.heavenEconomy, error, `ensureVipPanels fehlgeschlagen`);
    });
  }, 1500);
  timer.unref?.();
  vipPanelRefreshTimers.set(guildId, timer);
};

export const getVipPanelStatus = async (guild, cfg) => {
  const settings = conf(cfg);
  const tiers = vipTiers(guild, cfg);
  const guildId = String(guild?.id || '');
  const data = await loadEconomyStore();
  const economy = guildState(data, guildId);
  const stored = economy.panels && typeof economy.panels === 'object' ? economy.panels : {};
  const channelId = String(stored.channelId || conf(cfg).vipPanelChannelId || '');
  const channelName = channelId ? String(guild?.channels?.cache?.get?.(channelId)?.name || '') : '';
  const runtime = vipPanelRuntime.get(guildId) || { running: false, lastAt: 0, lastError: '' };
  await guild?.emojis?.fetch?.().catch((error) => {
    quietLog(QUIET_LOG_SCOPE.heavenEconomy, error, `emojis.fetch (VIP) fehlgeschlagen`);
  });
  const entries = tiers.map((tier) => ({ tier, rows: vipPanelRows(guild, tiers, tier) }));
  return {
    enabled: settings.enabled === true && settings.vipPanelEnabled === true,
    template: vipPanelTemplate(cfg),
    channelId,
    channelName,
    messageId: String(stored.messageId || ''),
    updatedAt: String(stored.updatedAt || ''),
    tiers: entries.map(({ tier, rows }) => {
      const specific = resolveTierEmojiObject(guild, tier);
      const emoji = specific || resolveTierEmojiObject(guild, { price: 4000, name: 'VIP: GOLD' });
      return {
        price: tier.price,
        name: String(tier.name),
        roleId: String(tier.roleId),
        emoji: emoji?.id ? `<${emoji.animated ? 'a' : ''}:${emoji.name || 'vip'}:${emoji.id}>` : '👑',
        emojiId: String(emoji?.id || ''),
        emojiName: String(emoji?.name || ''),
        emojiAnimated: emoji?.animated === true,
        memberCount: rows.length
      };
    }),
    memberCount: entries.reduce((sum, entry) => sum + entry.rows.length, 0),
    tierCount: tiers.length,
    running: runtime.running === true,
    lastError: runtime.lastError || ''
  };
};

export const refreshVipPanels = async ({ guild, cfg } = {}) => {
  const settings = conf(cfg);
  if (!settings.enabled || !settings.vipPanelEnabled) throw new Error('Das VIP-Embed ist nicht aktiviert.');
  return ensureVipPanels(guild, cfg, { force: true });
};

// Reine Entscheidungslogik für das Außenbild eines VIP-Design-Saves: Ein neu
// hochgeladenes Bild (Daten-URI → outsideFile) ersetzt das alte, eine
// explizite Entfernung (removeOutsideImage) löscht es, ein mitgeschickter
// Anhang bleibt erhalten. Kommt GAR kein Bild an und wurde nichts entfernt,
// wird das zuletzt gespeicherte Außenbild unverändert weitergeführt – ein
// versehentlicher zweiter, bildloser Save kann es also nie überschreiben.
export const resolveVipPanelImagePreservation = ({ outsideFile = null, sourceOutsideImage = '', removeOutsideImage = false, incomingAttachment = null, previousTemplate = {} } = {}) => {
  const previousAttachment = normalizeVipPanelAttachment(previousTemplate?.outsideImageAttachment);
  const normalizedIncoming = normalizeVipPanelAttachment(incomingAttachment);
  const preservePrevious = !outsideFile && !removeOutsideImage
    && !String(sourceOutsideImage || '').trim() && !normalizedIncoming
    && Boolean(String(previousTemplate?.outsideImageUrl || '').trim() || previousAttachment);
  return {
    outsideImageUrl: outsideFile ? '' : (String(sourceOutsideImage || '').trim() || (preservePrevious ? String(previousTemplate?.outsideImageUrl || '').trim() : '')),
    outsideImageAttachment: outsideFile || removeOutsideImage
      ? null
      : (normalizedIncoming || (preservePrevious ? previousAttachment : null)),
    preservePrevious
  };
};

export const saveVipPanelDesign = async ({ guild, cfg = {}, template = {}, channelId = '' } = {}) => {
  if (!guild) throw new Error('Server wurde nicht gefunden.');
  const embeds = Array.isArray(template?.embeds) && template.embeds.length ? template.embeds : [template?.embed || {}];
  if (embeds.length !== 1) throw new Error('Das VIP-Embed verwendet genau ein automatisch aktualisiertes Embed.');
  // Außenbild: Ein vom Studio hochgeladenes Bild (Daten-URI) wird als Datei an
  // Discord gesendet und dort dauerhaft gehalten. Ein bereits persistierter
  // Anhang bleibt erhalten, ein HTTP(S)-Link wird als URL gespeichert.
  const sourceOutsideImage = String(template?.outsideImageUrl || '').trim();
  const dataImageMatch = sourceOutsideImage.match(/^data:(image\/(?:png|jpe?g|webp|gif));base64,([a-z0-9+/=\r\n]+)$/i);
  let outsideFile = dataImageMatch ? Buffer.from(dataImageMatch[2], 'base64') : null;
  if (sourceOutsideImage.startsWith('data:') && !outsideFile) throw new Error('Das ausgewählte Außenbild ist keine gültige PNG-, JPG-, WEBP- oder GIF-Datei.');
  if (outsideFile && outsideFile.length > 25 * 1024 * 1024) throw new Error('Das Außenbild darf maximal 25 MB groß sein.');
  // Lokal gespeichertes Bild (Studio lädt es beim Auswählen einmal auf den PC):
  // Datei lesen und als normalen Discord-Anhang senden – ohne Kanal.
  if (!outsideFile && template?.outsideImageAttachment?.localAsset === true) {
    const local = await readLocalImage(template.outsideImageAttachment);
    if (!local) throw new Error('Das lokale Außenbild wurde nicht gefunden. Bitte wähle es erneut aus.');
    outsideFile = local.buffer;
    template.outsideImageName = local.name;
  }
  // Schutz gegen versehentliches Bild-Verwerfen: Kommt in einem Save KEIN Bild
  // an (kein Upload, keine URL, kein Anhang) und wurde keine Entfernung
  // angefordert, wird das zuletzt gespeicherte Außenbild unverändert weiter
  // geführt. So kann ein zweiter, bildloser Save das hochgeladene Bild nie
  // überschreiben – es muss explizit ersetzt oder entfernt werden.
  const removeOutsideImage = template?.removeOutsideImage === true;
  const preservedImage = resolveVipPanelImagePreservation({
    outsideFile,
    sourceOutsideImage,
    removeOutsideImage,
    incomingAttachment: outsideFile ? null : template?.outsideImageAttachment,
    previousTemplate: cfg?.vipPanelTemplate
  });
  const effectiveOutsideUrl = preservedImage.outsideImageUrl;
  const effectiveOutsideAttachment = preservedImage.outsideImageAttachment;
  if (!outsideFile && !template?.outsideImageAttachment && sourceOutsideImage
    && String(template?.content || '').length + sourceOutsideImage.length + 1 > 2_000) {
    throw new Error('Nachricht und Außenbild-Link dürfen zusammen maximal 2.000 Zeichen enthalten.');
  }  // Virtuelle Tier-Felder aus den Embed-Feldern extrahieren und als
  // Top-Level-Config-Properties speichern (vipTierFieldTemplate etc.).
  const rawFields = Array.isArray(embeds[0]?.fields) ? embeds[0].fields : [];
  let extractedTierFieldTemplate = '';
  let extractedTierMemberFormat = '';
  let extractedTierEmptyText = '';
  let extractedTierOverflowText = '';
  const cleanedFields = rawFields.filter((f) => {
    if (f?.__vipTier === 'fieldTemplate') { extractedTierFieldTemplate = String(f.value || ''); return false; }
    if (f?.__vipTier === 'memberFormat') { extractedTierMemberFormat = String(f.value || ''); return false; }
    if (f?.__vipTier === 'emptyText') { extractedTierEmptyText = String(f.value || ''); return false; }
    if (f?.__vipTier === 'overflowText') { extractedTierOverflowText = String(f.value || ''); return false; }
    return true;
  });
  const normalizedTemplate = {
    content: String(template?.content || ''),
    outsideImageUrl: effectiveOutsideUrl,
    outsideImageAttachment: effectiveOutsideAttachment,
    embeds: embeds.slice(0, 1).map((embed) => ({
      title: embed.title || '', url: embed.url || '', description: embed.description || '', color: embed.color || '#ffbd59',
      authorName: embed.authorName || '', authorIconUrl: embed.authorIconUrl || '', thumbnailUrl: embed.thumbnailUrl || '', imageUrl: embed.imageUrl || '', footerText: embed.footerText || '', footerIconUrl: embed.footerIconUrl || '', timestamp: embed.timestamp === true, fields: cleanedFields.slice(0, 25)
    }))
  };
  const nextCfg = {
    ...cfg,
    vipPanelChannelId: String(channelId || cfg?.vipPanelChannelId || ''),
    vipPanelTemplate: {
      ...normalizedTemplate,
      vipTierFieldTemplate: extractedTierFieldTemplate || cfg?.vipPanelTemplate?.vipTierFieldTemplate || '{tierEmoji} {tierName} \u00b7 {tierMemberCount}',
      vipTierMemberFormat: extractedTierMemberFormat || cfg?.vipPanelTemplate?.vipTierMemberFormat || '<@{memberId}>',
      vipTierEmptyText: extractedTierEmptyText || cfg?.vipPanelTemplate?.vipTierEmptyText || '*Noch keine Mitglieder.*',
      vipTierOverflowText: extractedTierOverflowText || cfg?.vipPanelTemplate?.vipTierOverflowText || '… und {overflowCount} weitere'
    }
  };
  const result = await ensureVipPanels(guild, nextCfg, {
    force: true,
    outsideFile,
    outsideFileName: String(template?.outsideImageName || 'fallen-heaven-vip.png').replace(/[^a-z0-9._-]/gi, '_').slice(-120),
    removeOutsideImage
  }).catch((error) => {
    // Ohne Außenbild darf das Design auch gespeichert werden, wenn das Embed
    // (z. B. wegen fehlendem Kanal) noch nicht erstellt werden kann. Bei einem
    // Bild-Upload darf NIE stillschweigend ein bildloses Design gespeichert
    // werden – sonst geht das hochgeladene Bild verloren.
    if (outsideFile) throw error;
    console.error(`[heavenEconomy] VIP-Embed-Design ${guild?.name}:`, error.message);
    return null;
  });
  // Nach dem Hochladen wird die Discord-CDN-URL + Anhang-Metadaten gespeichert,
  // damit das Bild beim nächsten Öffnen des Studios nicht erneut ausgewählt
  // werden muss und bei jeder Panel-Aktualisierung erhalten bleibt.
  if (outsideFile && !result?.outsideImageAttachment && result?.messageId) {
    // Ultimativer Fallback: Den hochgeladenen Anhang direkt von der frisch
    // erstellten/bearbeiteten Panel-Nachricht holen, falls die Panel-Antwort
    // ihn nicht mitgeliefert hat.
    const panelChannel = guild?.channels?.cache?.get?.(result.channelId || channelId);
    const freshMessage = panelChannel
      ? await panelChannel.messages.fetch({ message: result.messageId, force: true }).catch((error) => {
          quietLog(QUIET_LOG_SCOPE.heavenEconomy, error, `messages.fetch (Boost-Panel) fehlgeschlagen: ${result.messageId}`);
          return null;
        })
      : null;
    const freshAttachment = freshMessage?.attachments?.first?.();
    if (freshAttachment) {
      result.outsideImageAttachment = {
        id: String(freshAttachment.id || ''),
        url: String(freshAttachment.url || ''),
        name: String(freshAttachment.name || 'fallen-heaven-vip.png'),
        size: Number(freshAttachment.size || 0)
      };
    }
  }
  if (outsideFile && !result?.outsideImageAttachment) {
    throw new Error('Das Außenbild wurde nicht als Discord-Anhang bestätigt. Bitte erneut speichern.');
  }
  if (outsideFile && result?.outsideImageAttachment) {
    const attachment = result.outsideImageAttachment;
    normalizedTemplate.outsideImageUrl = String(attachment.url || '');
    normalizedTemplate.outsideImageAttachment = {
      id: String(attachment.id || ''),
      url: String(attachment.url || ''),
      name: String(attachment.name || 'fallen-heaven-vip.png'),
      size: Number(attachment.size || 0)
    };
  }
  return { template: normalizedTemplate, channelId: nextCfg.vipPanelChannelId, panel: result };
};

const shopResponse = async (interaction, cfg, giftTargetId = '') => {
  const tiers = vipTiers(interaction.guild, cfg);
  if (!tiers.length) return interaction.reply({ content: 'Der VIP-Shop wird gerade eingerichtet. Es sind noch keine VIP-Rollen verbunden.', flags: MessageFlags.Ephemeral });
  const target = giftTargetId
    ? interaction.guild.members.cache.get(giftTargetId) || await interaction.guild.members.fetch(giftTargetId).catch(() => null)
    : interaction.member;
  if (!target || target.user.bot) return interaction.reply({ content: 'Dieses Mitglied kann keine VIP-Stufe erhalten.', flags: MessageFlags.Ephemeral });
  const active = currentVip(target, tiers);
  const availableTiers = tiers.filter((tier) => tier.price > Number(active?.price || 0));
  if (!availableTiers.length) {
    return interaction.reply({
      content: giftTargetId
        ? `**${target.displayName}** besitzt bereits die höchste konfigurierte VIP-Stufe.`
        : 'Du besitzt bereits die höchste konfigurierte VIP-Stufe.',
      flags: MessageFlags.Ephemeral
    });
  }
  const menu = new StringSelectMenuBuilder()
    .setCustomId(giftTargetId ? `fh_coin:gift-tier:${giftTargetId}` : 'fh_coin:buy-tier')
    .setPlaceholder(giftTargetId ? `VIP für ${target.displayName} auswählen` : 'VIP-Stufe auswählen')
    .addOptions(availableTiers.map((tier) => ({
      label: tier.name.slice(0, 100),
      description: `${money(Math.max(0, tier.price - Number(active?.price || 0)))}${active ? ' nach Anrechnung' : ''}`.slice(0, 100),
      value: tier.roleId
    })));
  const copy = giftTargetId
    ? `Empfänger: **${target.displayName}**\nBestehende VIP-Stufe: **${active?.name || 'keine'}**`
    : `Dein Guthaben: **${money((await getAccount(interaction.guildId, interaction.user.id)).balance)}**\nBestehende VIP-Stufe: **${active?.name || 'keine'}**`;
  return interaction.reply({ content: copy, components: [new ActionRowBuilder().addComponents(menu)], flags: MessageFlags.Ephemeral });
};

const completePurchase = async ({ interaction, cfg, target, tier, gift = false }) => {
  const tiers = vipTiers(interaction.guild, cfg);
  const freshTarget = await interaction.guild.members.fetch({ user: target.id, force: true }).catch(() => target);
  const active = currentVip(freshTarget, tiers);
  if (active?.roleId === tier.roleId) return interaction.update({ content: `${target.id === interaction.user.id ? 'Du besitzt' : 'Dieses Mitglied besitzt'} diese VIP-Stufe bereits.`, components: [] });
  if (Number(active?.price || 0) >= tier.price) {
    return interaction.update({ content: 'Eine niedrigere oder bereits erreichte VIP-Stufe wird nicht erneut gekauft. Wähle ein echtes Upgrade.', components: [] });
  }
  const targetRole = interaction.guild.roles.cache.get(tier.roleId);
  if (!targetRole?.editable) {
    return interaction.update({ content: 'Diese VIP-Rolle liegt über der Bot-Rolle und kann derzeit nicht sicher vergeben werden.', components: [] });
  }
  const cost = Math.max(0, tier.price - Number(active?.price || 0));
  const reservation = await mutate((data) => {
    const guild = guildState(data, interaction.guildId);
    guild.processedInteractions = Array.isArray(guild.processedInteractions) ? guild.processedInteractions : [];
    if (guild.processedInteractions.includes(String(interaction.id || ''))) return { ok: false, duplicate: true };
    guild.processedInteractions.push(String(interaction.id || ''));
    guild.processedInteractions = guild.processedInteractions.filter(Boolean).slice(-5000);
    const buyer = accountState(guild, interaction.user.id);
    if (buyer.balance < cost) return { ok: false, balance: buyer.balance };
    buyer.balance -= cost;
    buyer.spent += cost;
    buyer.revision = finiteInteger(buyer.revision, 0, 0, Number.MAX_SAFE_INTEGER) + 1;
    buyer.updatedAt = new Date().toISOString();
    const transaction = recordTransaction(guild, { type: gift ? 'vip-gift' : 'vip-purchase', userId: interaction.user.id, targetUserId: target.id, amount: -cost, roleId: tier.roleId, tier: tier.name });
    return { ok: true, transaction };
  });
  if (reservation.duplicate) return interaction.update({ content: 'Dieser Kauf wurde bereits verarbeitet. Dein Konto wurde nicht erneut belastet.', components: [] });
  if (!reservation.ok) return interaction.update({ content: `Dein Guthaben reicht nicht aus. Benötigt: **${money(cost)}** · vorhanden: **${money(reservation.balance)}**.`, components: [] });

  const previousRoleIds = tiers.map((entry) => entry.roleId).filter((id) => freshTarget.roles.cache.has(id));
  try {
    const roleIds = previousRoleIds.filter((id) => id !== tier.roleId);
    if (roleIds.length) await freshTarget.roles.remove(roleIds, `Heaven VIP Wechsel ${reservation.transaction.id}`);
    await freshTarget.roles.add(tier.roleId, `Heaven VIP ${gift ? 'Geschenk' : 'Kauf'} ${reservation.transaction.id}`);
  } catch (error) {
    await freshTarget.roles.remove(tier.roleId, `Heaven VIP Rollback ${reservation.transaction.id}`).catch(() => {});
    const restorableRoleIds = previousRoleIds.filter((roleId) => interaction.guild.roles.cache.get(roleId)?.editable);
    if (restorableRoleIds.length) await freshTarget.roles.add(restorableRoleIds, `Heaven VIP Rollback ${reservation.transaction.id}`).catch(() => {});
    await mutate((data) => {
      const guild = guildState(data, interaction.guildId);
      const buyer = accountState(guild, interaction.user.id);
      buyer.balance += cost;
      buyer.spent = Math.max(0, buyer.spent - cost);
      buyer.revision = finiteInteger(buyer.revision, 0, 0, Number.MAX_SAFE_INTEGER) + 1;
      buyer.updatedAt = new Date().toISOString();
      recordTransaction(guild, { type: 'vip-refund', userId: interaction.user.id, targetUserId: target.id, amount: cost, referenceId: reservation.transaction.id, reason: 'Discord-Rollenfehler' });
    });
    return interaction.update({ content: 'Die VIP-Rolle konnte nicht sicher vergeben werden. Die Coins wurden vollständig zurückgebucht.', components: [] });
  }
  await sendEconomyLog(interaction.guild, cfg, gift ? 'VIP verschenkt' : 'VIP gekauft', `Käufer: <@${interaction.user.id}>\nEmpfänger: <@${target.id}>\nStufe: **${tier.name}**\nKosten: **${money(cost)}**\nTransaktion: ${reservation.transaction.id}`);
  // DM-Benachrichtigungen (editierbare Embeds): Der Beschenkte bekommt die
  // Geschenk-DM, der Käufer die Kauf-DM. Fehler dürfen den Kauf nie brechen.
  if (gift && String(target.id) !== String(interaction.user.id)) {
    void sendEconomyDm({
      guild: interaction.guild,
      cfg,
      userId: target.id,
      section: 'giftReceived',
      context: economyDmContext({ guild: interaction.guild, userId: target.id, tier, giverId: interaction.user.id })
    });
  } else {
    void sendEconomyDm({
      guild: interaction.guild,
      cfg,
      userId: interaction.user.id,
      section: 'vipPurchased',
      context: economyDmContext({ guild: interaction.guild, userId: interaction.user.id, tier })
    });
  }
  scheduleVipSeparatorSync(interaction.guild, cfg);
  return interaction.update({ content: gift ? `**${tier.name}** wurde erfolgreich an **${target.displayName}** verschenkt. Transaktion: ${reservation.transaction.id}` : `Du besitzt jetzt **${tier.name}**. Transaktion: ${reservation.transaction.id}`, components: [] });
};

const handleInteraction = async (interaction, cfg) => {
  const id = String(interaction.customId || '');
  if (!id.startsWith('fh_coin:')) return false;
  if (!conf(cfg).enabled) {
    await interaction.reply({ content: 'Heaven Economy ist momentan nicht aktiv.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }
  if (id.startsWith('fh_coin:admin')) {
    if (!isEconomyStaff(interaction, cfg)) {
      await interaction.reply({ content: 'Diese Verwaltung ist ausschließlich für berechtigte Teammitglieder verfügbar.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }
    if (id === 'fh_coin:admin') {
      const menu = new UserSelectMenuBuilder().setCustomId('fh_coin:admin-user').setPlaceholder('Mitglied auswählen').setMinValues(1).setMaxValues(1);
      await interaction.reply({ content: '**Coin-Verwaltung**\nWähle das Mitglied aus, dessen Guthaben du bearbeiten möchtest.', components: [new ActionRowBuilder().addComponents(menu)], flags: MessageFlags.Ephemeral });
      return true;
    }
    if (id === 'fh_coin:admin-user') {
      const targetId = String(interaction.values?.[0] || '');
      const target = interaction.guild.members.cache.get(targetId) || await interaction.guild.members.fetch(targetId).catch(() => null);
      if (!target || target.user.bot) await interaction.update({ content: 'Dieses Mitglied kann nicht verwaltet werden.', components: [] });
      else {
        const account = await getAccount(interaction.guildId, targetId);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`fh_coin:admin-edit:set:${targetId}`).setLabel('Stand festlegen').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`fh_coin:admin-edit:add:${targetId}`).setLabel('Coins vergeben').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`fh_coin:admin-edit:remove:${targetId}`).setLabel('Coins abziehen').setStyle(ButtonStyle.Danger)
        );
        await interaction.update({ content: `**${target.displayName}**\nAktueller Kontostand: **${money(account.balance)}**\nVerdient: ${money(account.earned)} · Ausgegeben: ${money(account.spent)}`, components: [row] });
      }
      return true;
    }
    if (id.startsWith('fh_coin:admin-edit:')) {
      const [, , mode, targetId] = id.split(':');
      const labels = { set: 'Kontostand festlegen', add: 'Coins vergeben', remove: 'Coins abziehen' };
      if (!labels[mode] || !targetId) return true;
      const modal = new ModalBuilder().setCustomId(`fh_coin:admin-modal:${mode}:${targetId}`).setTitle(labels[mode]);
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('amount').setLabel(mode === 'set' ? 'Neuer Kontostand' : 'Coin-Anzahl').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('z. B. 500')),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Grund der Änderung').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(300).setPlaceholder('Nachvollziehbarer Grund für das Protokoll'))
      );
      await interaction.showModal(modal);
      return true;
    }
    if (id.startsWith('fh_coin:admin-modal:') && interaction.isModalSubmit?.()) {
      const [, , mode, targetId] = id.split(':');
      const amount = Math.floor(Number(String(interaction.fields.getTextInputValue('amount') || '').replace(',', '.')));
      const reason = String(interaction.fields.getTextInputValue('reason') || '').trim();
      if (!Number.isFinite(amount) || amount < 0 || amount > 10_000_000) {
        await interaction.reply({ content: 'Bitte gib eine gültige Coin-Anzahl zwischen 0 und 10.000.000 ein.', flags: MessageFlags.Ephemeral });
        return true;
      }
      const result = await mutate((data) => {
        const guild = guildState(data, interaction.guildId);
        const account = accountState(guild, targetId);
        const before = Number(account.balance || 0);
        const after = mode === 'set' ? amount : mode === 'add' ? before + amount : Math.max(0, before - amount);
        const delta = after - before;
        account.balance = after;
        if (delta > 0) account.earned += delta;
        if (delta < 0) account.spent += Math.abs(delta);
        account.revision = finiteInteger(account.revision, 0, 0, Number.MAX_SAFE_INTEGER) + 1;
        account.updatedAt = new Date().toISOString();
        const transaction = recordTransaction(guild, { type: `manual-${mode}`, userId: targetId, actorId: interaction.user.id, amount: delta, balanceBefore: before, balanceAfter: after, reason });
        return { before, after, transaction };
      });
      await sendEconomyLog(interaction.guild, cfg, 'Coin-Kontostand manuell geändert', `Mitglied: <@${targetId}>\nTeammitglied: <@${interaction.user.id}>\nÄnderung: **${money(result.before)} → ${money(result.after)}**\nGrund: ${reason}\nTransaktion: ${result.transaction.id}`);
      // Gutschrift > 0 → DM-Benachrichtigung (editierbares Embed). Abzüge und
      // gleichbleibende Stände lösen keine DM aus.
      if (result.after > result.before) {
        void sendEconomyDm({
          guild: interaction.guild,
          cfg,
          userId: targetId,
          section: 'coinsReceived',
          context: economyDmContext({
            guild: interaction.guild,
            userId: targetId,
            coins: money(result.after - result.before),
            balance: money(result.after),
            reason
          })
        });
      }
      await interaction.reply({ content: `Kontostand erfolgreich aktualisiert: **${money(result.before)} → ${money(result.after)}**\nGrund: ${reason}\nTransaktion: \`${result.transaction.id}\``, flags: MessageFlags.Ephemeral });
      return true;
    }
  }
  if (id === 'fh_coin:coin-gift') {
    if (!coinGiftLimits(cfg).enabled) {
      await interaction.reply({ content: 'Coin-Geschenke sind derzeit deaktiviert.', flags: MessageFlags.Ephemeral });
      return true;
    }
    const menu = new UserSelectMenuBuilder()
      .setCustomId('fh_coin:coin-gift-user')
      .setPlaceholder('Empfänger auswählen')
      .setMinValues(1)
      .setMaxValues(1);
    await interaction.reply({ content: 'Wem möchtest du Heaven Coins schenken?', components: [new ActionRowBuilder().addComponents(menu)], flags: MessageFlags.Ephemeral });
    return true;
  }
  if (id === 'fh_coin:coin-gift-user') {
    const recipientId = String(interaction.values?.[0] || '');
    try {
      await validateCoinGiftMembers({ guild: interaction.guild, senderId: interaction.user.id, recipientId });
    } catch (error) {
      await interaction.reply({ content: error.message, flags: MessageFlags.Ephemeral });
      return true;
    }
    const limits = coinGiftLimits(cfg);
    const modal = new ModalBuilder().setCustomId(`fh_coin:coin-gift-modal:${recipientId}`).setTitle('Heaven Coins verschenken');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder()
        .setCustomId('amount')
        .setLabel(`Betrag (${limits.minimum}–${limits.maximum})`)
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(10)
        .setPlaceholder('z. B. 250')),
      new ActionRowBuilder().addComponents(new TextInputBuilder()
        .setCustomId('message')
        .setLabel('Persönliche Nachricht (optional)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(200)
        .setPlaceholder('Viel Freude damit!'))
    );
    await interaction.showModal(modal);
    return true;
  }
  if (id.startsWith('fh_coin:coin-gift-modal:') && interaction.isModalSubmit?.()) {
    const recipientId = id.slice('fh_coin:coin-gift-modal:'.length);
    try {
      const amountText = String(interaction.fields.getTextInputValue('amount') || '').trim();
      if (!/^\d+$/.test(amountText)) throw new Error('Bitte gib eine ganze positive Coin-Anzahl ein.');
      const intent = await createCoinGiftIntent({
        guild: interaction.guild,
        cfg,
        senderId: interaction.user.id,
        recipientId,
        amount: Number(amountText),
        message: interaction.fields.getTextInputValue('message')
      });
      const recipient = await fetchGiftMember(interaction.guild, recipientId);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`fh_coin:coin-gift-confirm:${intent.token}`).setLabel('Verschenken').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`fh_coin:coin-gift-cancel:${intent.token}`).setLabel('Abbrechen').setStyle(ButtonStyle.Secondary)
      );
      const note = intent.message ? `\nNachricht: „${intent.message}“` : '';
      await interaction.reply({
        content: `**Coin-Geschenk bestätigen**\nEmpfänger: **${recipient.displayName}**\nBetrag: **${money(intent.amount)}**\nDein Kontostand: **${money(intent.senderBalanceBefore)} → ${money(intent.senderBalanceAfter)}**${note}\n\nDie Bestätigung ist 10 Minuten gültig.`,
        components: [row],
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] }
      });
    } catch (error) {
      await interaction.reply({ content: error.message || 'Das Coin-Geschenk konnte nicht vorbereitet werden.', flags: MessageFlags.Ephemeral });
    }
    return true;
  }
  if (id.startsWith('fh_coin:coin-gift-cancel:')) {
    const token = id.slice('fh_coin:coin-gift-cancel:'.length);
    await cancelCoinGiftIntent({ guildId: interaction.guildId, token, senderId: interaction.user.id });
    await interaction.update({ content: 'Coin-Geschenk abgebrochen. Es wurden keine Coins übertragen.', components: [] });
    return true;
  }
  if (id.startsWith('fh_coin:coin-gift-confirm:')) {
    const token = id.slice('fh_coin:coin-gift-confirm:'.length);
    await interaction.deferUpdate();
    try {
      const result = await completeCoinGiftTransfer({ guild: interaction.guild, cfg, token, interactionId: interaction.id });
      if (result.duplicate) {
        await interaction.editReply({ content: 'Dieses Coin-Geschenk wurde bereits verarbeitet.', components: [] });
        return true;
      }
      const context = coinGiftDmContext({ guild: interaction.guild, result });
      const [recipientDm, senderDm] = await Promise.all([
        sendEconomyDm({ guild: interaction.guild, cfg, userId: result.recipientId, section: 'coinGiftReceived', context, forceNew: true }),
        sendEconomyDm({ guild: interaction.guild, cfg, userId: result.senderId, section: 'coinGiftSent', context, forceNew: true })
      ]);
      await sendEconomyLog(
        interaction.guild,
        cfg,
        'Coin-Geschenk übertragen',
        `Absender: <@${result.senderId}>\nEmpfänger: <@${result.recipientId}>\nBetrag: **${money(result.amount)}**\nAbsender: **${money(result.transaction.senderBalanceBefore)} → ${money(result.transaction.senderBalanceAfter)}**\nEmpfänger: **${money(result.transaction.recipientBalanceBefore)} → ${money(result.transaction.recipientBalanceAfter)}**\nTransaktion: \`${result.transaction.id}\``
      );
      const dmNotice = recipientDm ? '' : '\nHinweis: Die Empfänger-DM konnte nicht zugestellt werden.';
      await interaction.editReply({
        content: `**${money(result.amount)}** wurden erfolgreich an <@${result.recipientId}> übertragen.\nDein neuer Kontostand: **${money(result.sender.balance)}**\nTransaktion: \`${result.transaction.id}\`${dmNotice}`,
        components: [],
        allowedMentions: { parse: [] }
      });
      void senderDm;
    } catch (error) {
      await interaction.editReply({ content: error.message || 'Das Coin-Geschenk konnte nicht übertragen werden.', components: [] });
    }
    return true;
  }
  if (id === 'fh_coin:account') await interaction.reply({ embeds: [await accountEmbed(interaction, cfg)], flags: MessageFlags.Ephemeral });
  else if (id === 'fh_coin:shop') await shopResponse(interaction, cfg);
  else if (id === 'fh_coin:gift') {
    const menu = new UserSelectMenuBuilder().setCustomId('fh_coin:gift-user').setPlaceholder('Empfänger auswählen').setMinValues(1).setMaxValues(1);
    await interaction.reply({ content: 'Wem möchtest du eine VIP-Stufe schenken?', components: [new ActionRowBuilder().addComponents(menu)], flags: MessageFlags.Ephemeral });
  } else if (id === 'fh_coin:gift-user') await shopResponse(interaction, cfg, interaction.values?.[0]);
  else if (id === 'fh_coin:buy-tier' || id.startsWith('fh_coin:gift-tier:')) {
    const targetId = id.startsWith('fh_coin:gift-tier:') ? id.slice('fh_coin:gift-tier:'.length) : interaction.user.id;
    const target = interaction.guild.members.cache.get(targetId) || await interaction.guild.members.fetch(targetId).catch(() => null);
    const tier = vipTiers(interaction.guild, cfg).find((entry) => entry.roleId === interaction.values?.[0]);
    if (!target || !tier) await interaction.update({ content: 'Die Auswahl ist nicht mehr verfügbar. Bitte öffne den Shop erneut.', components: [] });
    else await completePurchase({ interaction, cfg, target, tier, gift: targetId !== interaction.user.id });
  } else if (id === 'fh_coin:progress') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await interaction.editReply({ embeds: [await progressEmbed(interaction, cfg)] });
  } else if (id === 'fh_coin:buy') {
    const buttons = [];
    const paypal = safeUrl(conf(cfg).paypalUrl);
    const paysafe = safeUrl(conf(cfg).paysafecardUrl);
    if (paypal) buttons.push(new ButtonBuilder().setLabel('PayPal öffnen').setURL(paypal).setStyle(ButtonStyle.Link));
    if (paysafe) buttons.push(new ButtonBuilder().setLabel('Paysafecard öffnen').setURL(paysafe).setStyle(ButtonStyle.Link));
    if (conf(cfg).supportChannelId) buttons.push(new ButtonBuilder().setLabel('Support öffnen').setURL(`https://discord.com/channels/${interaction.guildId}/${conf(cfg).supportChannelId}`).setStyle(ButtonStyle.Link));
    const embed = new EmbedBuilder()
      .setColor(0x7772ff)
      .setAuthor({ name: 'FALLEN HEAVEN · COIN-SERVICE' })
      .setTitle(`${coin(cfg)} Heaven Coins kaufen`)
      .setDescription(`**1 Coin = 0,01 €**\n\nCoins sind nicht auszahlbar und besitzen außerhalb von FALLEN HEAVEN keinen Wert.${buttons.length ? '\n\nWähle unten deine sichere Zahlungsart.' : '\n\nDer automatische Checkout wird gerade eingerichtet.'}`);
    await interaction.reply({ embeds: [embed], components: buttons.length ? [new ActionRowBuilder().addComponents(buttons)] : [], flags: MessageFlags.Ephemeral });
  }
  return true;
};

// Speichert eine editierbare DM-Design-Sektion (giftReceived / vipPurchased /
// coinsReceived / boostMilestone) für Heaven Economy – Muster wie
// saveCountingDesign / savePublicCallVoteDesign.
export const saveEconomyDmDesign = async ({ guild, cfg = {}, section = 'giftReceived', template = {} } = {}) => {
  if (!guild) throw new Error('Server wurde nicht gefunden.');
  const sectionId = ECONOMY_DM_SECTIONS.includes(String(section)) ? String(section) : ECONOMY_DM_SECTIONS[0];
  const sources = Array.isArray(template?.embeds) && template.embeds.length ? template.embeds : [template?.embed || template];
  const embed = sources.find((entry) => entry && typeof entry === 'object') || {};
  const normalized = cfg?.heavenEconomy || {};
  const normalizedDesigns = {
    ...normalizeEconomyDmDesigns(normalized.dmDesigns),
    [sectionId]: normalizeEconomyDmSection(sectionId, embed)
  };
  return {
    section: sectionId,
    design: { [sectionId]: normalizedDesigns[sectionId] },
    normalizedDesign: normalizedDesigns
  };
};

export const calculateBoostMilestoneCredit = ({ rewardedBoostLevels = [], count = 0, reward = 100 }) => {
  const normalizedCount = Math.max(0, Math.floor(Number(count) || 0));
  const rewarded = new Set((rewardedBoostLevels || []).map(Number).filter((level) => Number.isInteger(level) && level > 0));
  const levels = Array.from({ length: normalizedCount }, (_, index) => index + 1).filter((level) => !rewarded.has(level));
  return {
    levels,
    amount: levels.length * Math.max(0, Number(reward) || 0),
    resultingLevels: [...new Set([...rewarded, ...levels])].sort((a, b) => a - b)
  };
};

const awardBoostMilestones = async ({ member, cfg, count }) => {
  if (!conf(cfg).enabled || !member || member.user?.bot || count < 1) {
    return { awarded: false, amount: 0, levels: [], count: Math.max(0, Number(count) || 0) };
  }
  const reward = Number(conf(cfg).boostMilestoneReward || 100);
  const result = await mutate((data) => {
    const guild = guildState(data, member.guild.id);
    const account = accountState(guild, member.id);
    const credit = calculateBoostMilestoneCredit({ rewardedBoostLevels: account.rewardedBoostLevels, count, reward });
    const { levels, amount } = credit;
    if (!levels.length) {
      const previousRecord = Number(account.boostRecord || 0);
      account.boostRecord = Math.max(previousRecord, count);
      if (account.boostRecord !== previousRecord) {
        account.revision = finiteInteger(account.revision, 0, 0, Number.MAX_SAFE_INTEGER) + 1;
        account.updatedAt = new Date().toISOString();
      }
      return { amount: 0, levels: [], transaction: null };
    }
    account.rewardedBoostLevels = credit.resultingLevels;
    account.boostRecord = Math.max(Number(account.boostRecord || 0), count);
    account.balance += amount;
    account.earned += amount;
    account.revision = finiteInteger(account.revision, 0, 0, Number.MAX_SAFE_INTEGER) + 1;
    account.updatedAt = new Date().toISOString();
    const transaction = recordTransaction(guild, { type: 'boost-milestone', userId: member.id, amount, levels, boostCount: count });
    return { amount, levels, transaction };
  });
  if (result.amount > 0) {
    await sendEconomyLog(member.guild, cfg, 'Boost-Meilenstein vergütet', `Mitglied: <@${member.id}>\nStufen: **${result.levels.map((level) => `${level}×`).join(', ')}**\nGutschrift: **${money(result.amount)}**\nTransaktion: ${result.transaction.id}`);
    // DM-Benachrichtigung (editierbares Embed) – nur bei echter neuer Vergütung.
    void sendEconomyDm({
      guild: member.guild,
      cfg,
      userId: member.id,
      section: 'boostMilestone',
      context: economyDmContext({
        guild: member.guild,
        userId: member.id,
        coins: money(result.amount),
        balance: money(Number((await getAccount(member.guild.id, member.id)).balance || 0)),
        levels: result.levels.map((level) => `**${level}×**`).join(', ')
      })
    });
  }
  return { awarded: result.amount > 0, count, ...result };
};

const resolveMemberBoostCount = async (member, cfg) => {
  const snapshot = await getBoostStatusSnapshot(member.guild).catch(() => null);
  const discordCount = Number(snapshot?.summary?.discordBoostCount || 0);
  const calculatedCount = Number(snapshot?.summary?.assignedBoostCount || 0);
  const consistencyState = String(snapshot?.summary?.consistencyState || (discordCount === calculatedCount ? 'synchronized' : 'mismatch'));
  const active = (snapshot?.active || []).find((entry) => String(entry.id || entry.userId || '') === String(member.id));
  const activeBoostCount = active?.nativeActive ? Math.max(1, Number(active?.boostCount || active?.count || 1)) : 0;
  if (snapshot && consistencyState === 'mismatch') {
    const error = new Error(`Coin-Vergütung pausiert: Discord meldet ${discordCount} Boosts, der Basisstand ${calculatedCount}.`);
    error.code = 'BOOST_CONSISTENCY_MISMATCH';
    error.activeBoostCount = activeBoostCount;
    error.discordBoostCount = discordCount;
    error.assignedBoostCount = calculatedCount;
    throw error;
  }
  return activeBoostCount;
};

const progressEmbed = async (interaction, cfg) => {
  const member = await interaction.guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => interaction.member);
  let currentCount = 0;
  let boostCreditPaused = false;
  if (member?.premiumSince) {
    try {
      currentCount = await resolveMemberBoostCount(member, cfg);
      if (currentCount > 0) await awardBoostMilestones({ member, cfg, count: currentCount });
    } catch (error) {
      if (error?.code !== 'BOOST_CONSISTENCY_MISMATCH') throw error;
      currentCount = Math.max(0, Number(error.activeBoostCount || 0));
      boostCreditPaused = true;
    }
  }
  const account = await getAccount(interaction.guildId, interaction.user.id);
  const completed = new Set((account.rewardedBoostLevels || []).map(Number));
  const record = Math.max(Number(account.boostRecord || 0), currentCount);
  const displayTop = Math.min(15, Math.max(5, record + 1));
  const reward = Number(conf(cfg).boostMilestoneReward || 100);
  const rows = Array.from({ length: displayTop }, (_, index) => {
    const level = index + 1;
    const marker = completed.has(level) ? '✅' : level === currentCount + 1 && currentCount > 0 ? '🔜' : '▫️';
    return `${marker} **${level}× Boost**  ·  ${money(reward)}`;
  });
  const nextLevel = Array.from({ length: 100 }, (_, index) => index + 1).find((level) => !completed.has(level));
  return new EmbedBuilder()
    .setColor(boostCreditPaused ? 0xf0b232 : currentCount > 0 ? 0x57f287 : 0x7772ff)
    .setAuthor({ name: 'FALLEN HEAVEN · BOOST-FORTSCHRITT', iconURL: interaction.user.displayAvatarURL() })
    .setTitle(boostCreditPaused ? `${currentCount}× Boost aktiv · Abgleich pausiert` : currentCount > 0 ? `${currentCount}× Boost aktuell aktiv` : 'Aktuell kein Server-Boost aktiv')
    .setDescription(boostCreditPaused
      ? 'Dein persönlicher Stand ist sichtbar, aber neue Coin-Gutschriften sind sicher pausiert, bis Discord-Gesamtsumme und persönliche Belege wieder zusammenpassen. Es werden keine Boosts geraten oder auf andere Mitglieder verteilt.'
      : currentCount > 0
      ? 'Dein Live-Stand wurde direkt mit Discord abgeglichen. Neue Boosts werden automatisch erkannt und deiner Staffelrolle sowie deinem Coin-Konto zugeordnet.'
      : 'Dein bisheriger Fortschritt bleibt gespeichert. Sobald du erneut boostest, erkennt der Bot den neuen Stand automatisch.')
    .addFields(
      { name: 'AKTUELL', value: currentCount > 0 ? `**${currentCount}×**` : '**0×**', inline: true },
      { name: 'PERSÖNLICHER REKORD', value: `**${record}×**`, inline: true },
      { name: 'NÄCHSTE OFFENE STUFE', value: nextLevel ? `**${nextLevel}×** · ${money(reward)}` : 'Alle sichtbaren Stufen abgeschlossen', inline: true },
      { name: 'MEILENSTEINE', value: rows.join('\n') }
    )
    .setFooter({ text: boostCreditPaused ? 'Sicherheitsstopp aktiv · keine Doppelvergütung · keine DMs' : 'Einmalige Vergütung je erstmals erreichter Boost-Stufe · keine DMs' })
    .setTimestamp();
};

export const reconcileHeavenEconomyBoostMilestones = async ({
  guild,
  cfg,
  actorId = '',
  refreshMembers = false,
  source = 'automatic'
} = {}) => {
  if (!guild?.id) throw new Error('Server wurde nicht gefunden.');
  if (!conf(cfg).enabled) throw new Error('Heaven Economy ist nicht aktiviert.');
  const startedAt = new Date().toISOString();
  if (!cfg?.boostRoles?.enabled) {
    const result = {
      status: 'paused',
      reason: 'boost-module-disabled',
      message: 'Die automatische Coin-Vergütung benötigt das aktivierte Booster-Rollen-Modul.',
      startedAt,
      finishedAt: new Date().toISOString(),
      checkedAccounts: 0,
      creditedAccounts: 0,
      creditedCoins: 0,
      creditedLevels: 0
    };
    economyReconcileStatus.set(String(guild.id), result);
    return result;
  }
  if (refreshMembers) await guild.members.fetch().catch(() => guild.members.cache);
  await waitForBoostRoleReconcile(guild.id);
  const snapshot = await getBoostStatusSnapshot(guild);
  const consistencyState = String(snapshot?.summary?.consistencyState || 'unknown');
  const discordBoostCount = Math.max(0, Number(snapshot?.summary?.discordBoostCount || guild.premiumSubscriptionCount || 0));
  const assignedBoostCount = Math.max(0, Number(snapshot?.summary?.assignedBoostCount || 0));
  if (consistencyState === 'mismatch') {
    const result = {
      status: 'paused',
      reason: 'boost-count-mismatch',
      message: `Coin-Vergütung pausiert: Discord meldet ${discordBoostCount} Boosts, die persönlichen Belege ergeben ${assignedBoostCount}.`,
      consistencyState,
      discordBoostCount,
      assignedBoostCount,
      startedAt,
      finishedAt: new Date().toISOString(),
      checkedAccounts: 0,
      creditedAccounts: 0,
      creditedCoins: 0,
      creditedLevels: 0
    };
    economyReconcileStatus.set(String(guild.id), result);
    return result;
  }

  let checkedAccounts = 0;
  let creditedAccounts = 0;
  let creditedCoins = 0;
  let creditedLevels = 0;
  const failures = [];
  for (const entry of snapshot?.active || []) {
    const userId = String(entry.id || entry.userId || '');
    const count = entry.nativeActive ? Math.max(1, Number(entry.boostCount || entry.count || 1)) : 0;
    if (!userId || count < 1) continue;
    const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch((error) => {
    quietLog(QUIET_LOG_SCOPE.heavenEconomy, error, `members.fetch fehlgeschlagen: ${userId}`);
    return null;
  });
    if (!member || member.user?.bot || !member.premiumSince) continue;
    checkedAccounts += 1;
    try {
      const awarded = await awardBoostMilestones({ member, cfg, count });
      if (awarded.awarded) {
        creditedAccounts += 1;
        creditedCoins += Number(awarded.amount || 0);
        creditedLevels += awarded.levels.length;
      }
    } catch (error) {
      failures.push({ userId, error: String(error?.message || error).slice(0, 300) });
    }
  }
  const result = {
    status: failures.length ? 'partial' : 'completed',
    source,
    actorId: String(actorId || ''),
    consistencyState,
    discordBoostCount,
    assignedBoostCount,
    startedAt,
    finishedAt: new Date().toISOString(),
    checkedAccounts,
    creditedAccounts,
    creditedCoins,
    creditedLevels,
    failures
  };
  economyReconcileStatus.set(String(guild.id), result);
  return result;
};

const scheduleBoostMilestoneSettlement = ({ member, cfg, messageId = '', source = 'gateway' }) => {
  if (!member?.guild?.id || !member.id || member.user?.bot || !conf(cfg).enabled) return;
  const key = `${member.guild.id}:${member.id}:${String(messageId || source)}`;
  if (boostSettlementJobs.has(key)) return;
  const state = { timer: null, lastError: '' };
  boostSettlementJobs.set(key, state);
  const finish = () => {
    if (state.timer) clearTimeout(state.timer);
    boostSettlementJobs.delete(key);
  };
  const run = async (attempt) => {
    try {
      if (messageId && attempt === 0) await waitForBoostLedgerEvent(member.guild.id, messageId, 6000);
      const fresh = await member.guild.members.fetch({ user: member.id, force: true }).catch(() => member.guild.members.cache.get(member.id) || member);
      if (!fresh?.premiumSince) throw new Error('Discord hat den aktiven Booststatus noch nicht bestätigt.');
      const count = await resolveMemberBoostCount(fresh, cfg);
      if (count < 1) throw new Error('Der persönliche Boost-Stand ist noch nicht verifiziert.');
      await awardBoostMilestones({ member: fresh, cfg, count });
      finish();
      return;
    } catch (error) {
      state.lastError = String(error?.message || error);
    }
    const nextAttempt = attempt + 1;
    if (nextAttempt >= BOOST_SETTLEMENT_DELAYS_MS.length) {
      finish();
      console.warn(`[heavenEconomy] Meilenstein-Abgleich für ${member.user?.tag || member.id} bleibt im periodischen Wiederholungsabgleich: ${state.lastError}`);
      return;
    }
    state.timer = setTimeout(() => void run(nextAttempt), BOOST_SETTLEMENT_DELAYS_MS[nextAttempt]);
    state.timer.unref?.();
  };
  void run(0);
};

const ensurePeriodicEconomyReconcile = (guild, cfg) => {
  const guildId = String(guild?.id || '');
  if (!guildId) return;
  const previous = economyReconcileTimers.get(guildId);
  if (previous) clearInterval(previous);
  economyReconcileTimers.delete(guildId);
  if (!conf(cfg).enabled) return;
  const timer = setInterval(() => {
    void reconcileHeavenEconomyBoostMilestones({ guild, cfg, source: 'periodic' }).catch((error) => {
      console.error(`[heavenEconomy] Periodischer VIP-Abgleich für ${guild.name} fehlgeschlagen:`, error);
    });
    if (conf(cfg).vipPanelEnabled === true) {
      // Ohne force – der interne 30-Sekunden-Throttle verhindert unnötige
      // Embed-Edits, wenn kurz zuvor schon ein Update lief.
      void ensureVipPanels(guild, cfg).catch((error) => {
        console.error(`[heavenEconomy] Periodische VIP-Panels für ${guild.name}:`, error.message);
      });
    }
  }, ECONOMY_RECONCILE_INTERVAL_MS);
  timer.unref?.();
  economyReconcileTimers.set(guildId, timer);
};

const handleEconomyBoostMessage = ({ message, cfg }) => {
  if (!conf(cfg).enabled || !message?.guild) return;
  const nativeBoost = Number(message.type) === 8 && !message.author?.bot;
  const boostInfo = nativeBoost ? null : parseBoostInfoMessage(message, cfg?.boostRoles);
  const userId = String(nativeBoost ? message.author?.id : boostInfo?.userId || '');
  if (!userId) return;
  const member = message.guild.members.cache.get(userId) || message.member;
  if (member) scheduleBoostMilestoneSettlement({ member, cfg, messageId: message.id, source: nativeBoost ? 'native-system' : 'boost-info' });
  else {
    void message.guild.members.fetch(userId).then((fresh) => {
      scheduleBoostMilestoneSettlement({ member: fresh, cfg, messageId: message.id, source: nativeBoost ? 'native-system' : 'boost-info' });
    }).catch(() => {});
  }
};

export const feature = {
  id: 'heavenEconomy',
  commands: [],
  async onClientReady({ guild, cfg }) {
    if (!guild) return;
    await ensureEconomyStore();
    ensurePeriodicEconomyReconcile(guild, cfg);
    await refreshHeavenEconomyPanel({ guild, cfg }).catch((error) => console.error(`[heavenEconomy] Panel ${guild.name}:`, error.message));
    if (conf(cfg).enabled) {
      void (async () => {
        await waitForBoostRoleReconcile(guild.id);
        await reconcileHeavenEconomyBoostMilestones({ guild, cfg, source: 'startup' });
      })().catch((error) => console.error(`[heavenEconomy] Startabgleich ${guild.name}:`, error.message));
      void ensureVipPanels(guild, cfg).catch((error) => console.error(`[heavenEconomy] VIP-Panels ${guild.name}:`, error.message));
      scheduleVipSeparatorSync(guild, cfg);
    }
  },
  async onConfigUpdate({ guild, cfg, patch }) {
    if (!patch) return;
    if (Object.prototype.hasOwnProperty.call(patch, 'heavenEconomy')) {
      ensurePeriodicEconomyReconcile(guild, cfg);
      await refreshHeavenEconomyPanel({ guild, cfg });
      scheduleVipPanelRefresh(guild, cfg);
      scheduleVipSeparatorSync(guild, cfg);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'heavenEconomy') || Object.prototype.hasOwnProperty.call(patch, 'boostRoles')) {
      if (conf(cfg).enabled) void reconcileHeavenEconomyBoostMilestones({ guild, cfg, source: 'config-update' }).catch(() => {});
    }
  },
  async onGuildMemberAdd({ member, cfg }) {
    if (!conf(cfg).enabled || member.user?.bot) return;
    scheduleVipPanelRefresh(member.guild, cfg);
  },
  async onGuildMemberRemove({ member, cfg }) {
    if (!conf(cfg).enabled) return;
    scheduleVipPanelRefresh(member.guild, cfg);
  },
  async onMessageDelete({ message, cfg }) {
    if (!conf(cfg).enabled || !message?.guild) return;
    const panels = await loadPanelStore();
    if (String(panels[message.guild.id] || '') === String(message.id || '')) await refreshHeavenEconomyPanel({ guild: message.guild, cfg });
  },
  async onAnyInteraction({ interaction, cfg }) {
    if (interaction.isButton?.() || interaction.isStringSelectMenu?.() || interaction.isUserSelectMenu?.() || interaction.isModalSubmit?.()) await handleInteraction(interaction, cfg);
  },
  async onMessageCreate({ message, cfg }) {
    handleEconomyBoostMessage({ message, cfg });
  },
  async onBotMessageCreate({ message, cfg }) {
    handleEconomyBoostMessage({ message, cfg });
  },
  async onGuildMemberUpdate({ oldMember, newMember, cfg }) {
    if (!conf(cfg).enabled || newMember.user?.bot) return;
    // VIP-Rollenwechsel (Kauf, Geschenk, Ablauf, manuelle Änderung) aktualisiert
    // sofort die betroffenen VIP-Panels.
    const tiers = vipTiers(newMember.guild, cfg);
    const tierRoleIds = new Set(tiers.map((tier) => String(tier.roleId)));
    const oldVipRole = currentVip(oldMember, tiers)?.roleId || '';
    const newVipRole = currentVip(newMember, tiers)?.roleId || '';
    if (oldVipRole !== newVipRole && (oldVipRole || newVipRole)) {
      scheduleVipPanelRefresh(newMember.guild, cfg);
    } else if (tierRoleIds.size) {
      // Auch wenn die sichtbare Stufe gleich bleibt, können sich Rollen geändert
      // haben (z. B. Entzug einer niedrigeren Stufe) – ein billiger Abgleich
      // über den Perioden-Timer fängt das ab.
      const oldTierRoles = [...(oldMember.roles?.cache?.keys?.() || [])].filter((id) => tierRoleIds.has(String(id)));
      const newTierRoles = [...(newMember.roles?.cache?.keys?.() || [])].filter((id) => tierRoleIds.has(String(id)));
      if (oldTierRoles.length !== newTierRoles.length) scheduleVipPanelRefresh(newMember.guild, cfg);
    }
    // VIP-Rollenwechsel → Trennerrolle automatisch nachziehen (grant/revoke).
    if (oldVipRole !== newVipRole && (oldVipRole || newVipRole)) {
      scheduleVipSeparatorSync(newMember.guild, cfg);
    }
    const boostChanged = Boolean(oldMember.premiumSince) !== Boolean(newMember.premiumSince)
      || Number(oldMember.premiumSinceTimestamp || 0) !== Number(newMember.premiumSinceTimestamp || 0);
    if (!boostChanged || !newMember.premiumSince) return;
    scheduleBoostMilestoneSettlement({ member: newMember, cfg, source: 'guild-member-update' });
  }
};
