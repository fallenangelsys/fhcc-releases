import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder
} from 'discord.js';
import {
  getBoostStatusSnapshot,
  parseBoostInfoMessage,
  waitForBoostLedgerEvent,
  waitForBoostRoleReconcile
} from './boostRoles.js';

const DATA_ROOT = process.env.FALLEN_HEAVEN_DATA_DIR || path.join(process.cwd(), 'data');
const ECONOMY_FILE = path.join(DATA_ROOT, 'heaven-economy.json');
const PANEL_FILE = path.join(DATA_ROOT, 'heaven-economy-panels.json');
const ECONOMY_VERSION = 2;
let mutationQueue = Promise.resolve();
const ECONOMY_RECONCILE_INTERVAL_MS = 5 * 60 * 1000;
const BOOST_SETTLEMENT_DELAYS_MS = [0, 1200, 4000, 10_000, 30_000, 120_000];
const boostSettlementJobs = new Map();
const economyReconcileTimers = new Map();
const economyReconcileStatus = new Map();
const resolveEconomyAvatarUrl = (entity, options = { size: 128 }) => {
  const user = entity?.user || entity || null;
  if (!user?.id) return '';
  const avatar = user?.displayAvatarURL?.(options);
  if (avatar) return String(avatar);
  if (entity?.avatar && entity?.guild?.id) {
    const extension = String(entity.avatar.startsWith('a_') ? 'gif' : (options.extension || 'png')).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png';
    const size = Number(options.size || 128);
    const normalizedSize = Number.isFinite(size) && size > 0 ? Math.min(4096, Math.max(16, Math.round(size))) : 128;
    return `https://cdn.discordapp.com/guilds/${String(entity.guild.id)}/users/${String(user.id)}/avatars/${String(entity.avatar)}.${extension}?size=${normalizedSize}`;
  }
  if (user.avatar) {
    const extension = String(user.avatar.startsWith('a_') ? 'gif' : (options.extension || 'png')).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png';
    const size = Number(options.size || 128);
    const normalizedSize = Number.isFinite(size) && size > 0 ? Math.min(4096, Math.max(16, Math.round(size))) : 128;
    return `https://cdn.discordapp.com/avatars/${String(user.id)}/${String(user.avatar)}.${extension}?size=${normalizedSize}`;
  }
  return user?.defaultAvatarURL || '';
};

const emptyData = () => ({ version: ECONOMY_VERSION, guilds: {} });
const finiteInteger = (value, fallback = 0, minimum = 0, maximum = 10_000_000) => {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
};
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
    guild.revision = finiteInteger(guild.revision, 0, 0, Number.MAX_SAFE_INTEGER);
    for (const [userId, rawAccount] of Object.entries(guild.accounts)) {
      const account = rawAccount && typeof rawAccount === 'object' ? rawAccount : {};
      guild.accounts[userId] = account;
      account.balance = finiteInteger(account.balance);
      account.earned = finiteInteger(account.earned);
      account.spent = finiteInteger(account.spent);
      account.boostRecord = finiteInteger(account.boostRecord, 0, 0, 99);
      account.rewardedBoostLevels = normalizeBoostLevels(account.rewardedBoostLevels);
      account.revision = finiteInteger(account.revision, 0, 0, Number.MAX_SAFE_INTEGER);
      account.createdAt = String(account.createdAt || new Date().toISOString());
      account.updatedAt = String(account.updatedAt || account.createdAt);
    }
  }
  return data;
};
const loadJson = async (file, fallback) => {
  const economyFile = path.resolve(file) === path.resolve(ECONOMY_FILE);
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    return economyFile ? normalizeEconomyData(parsed) : parsed;
  } catch {
    return economyFile ? normalizeEconomyData(fallback) : fallback;
  }
};
const saveJson = async (file, value) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  const serializedValue = path.resolve(file) === path.resolve(ECONOMY_FILE) ? normalizeEconomyData(value) : value;
  await fs.writeFile(temporary, JSON.stringify(serializedValue, null, 2), 'utf8');
  await fs.copyFile(file, `${file}.bak`).catch(() => {});
  await fs.rename(temporary, file);
};
const mutate = (worker) => {
  const operation = mutationQueue.then(async () => {
    const data = await loadJson(ECONOMY_FILE, emptyData());
    const result = await worker(data);
    await saveJson(ECONOMY_FILE, data);
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
    target.guilds[guildId] ||= { accounts: {}, transactions: [], processedInteractions: [], revision: 0 };
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
          if (error?.code !== 'ENOENT') throw new Error(`Legacy-Economy konnte nicht gelesen werden (${path.basename(sourceFile)}): ${error?.message || error}`);
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
  data.guilds[guildId] ||= { accounts: {}, transactions: [], processedInteractions: [], revision: 0 };
  data.guilds[guildId].processedInteractions ||= [];
  return data.guilds[guildId];
};
const accountState = (guild, userId) => {
  guild.accounts[userId] ||= {
    balance: 0,
    earned: 0,
    spent: 0,
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

const conf = (cfg) => cfg?.heavenEconomy || {};
const coin = (cfg) => String(conf(cfg).coinEmoji || '🪙');
const money = (value) => `${Number(value || 0).toLocaleString('de-DE')} Coins`;
const safeUrl = (value) => /^https:\/\/[^\s]+$/i.test(String(value || '')) ? String(value) : '';
const sendEconomyLog = async (guild, cfg, title, description) => {
  const channelId = String(conf(cfg).logChannelId || '');
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  await channel.send({
    embeds: [new EmbedBuilder().setColor(0x7772ff).setTitle(title).setDescription(String(description || '').slice(0, 4000)).setTimestamp()],
    allowedMentions: { parse: [] }
  }).catch(() => {});
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
  const data = await loadJson(ECONOMY_FILE, emptyData());
  return accountState(guildState(data, guildId), userId);
};

const accountSnapshot = (account) => ({
  balance: finiteInteger(account?.balance),
  earned: finiteInteger(account?.earned),
  spent: finiteInteger(account?.spent),
  boostRecord: finiteInteger(account?.boostRecord, 0, 0, 99),
  rewardedBoostLevels: normalizeBoostLevels(account?.rewardedBoostLevels),
  revision: finiteInteger(account?.revision, 0, 0, Number.MAX_SAFE_INTEGER),
  createdAt: String(account?.createdAt || ''),
  updatedAt: String(account?.updatedAt || '')
});

const economyIdentity = (guild, userId) => {
  const member = guild.members.cache.get(String(userId || ''));
  const user = member?.user || guild.client.users.cache.get(String(userId || ''));
  return {
    id: String(userId || ''),
    displayName: String(member?.displayName || user?.globalName || user?.username || `Mitglied ${userId}`),
    username: String(user?.username || ''),
    avatarUrl: resolveEconomyAvatarUrl(user, { extension: 'webp', size: 128 }),
    avatar: resolveEconomyAvatarUrl(user, { extension: 'webp', size: 128 }),
    onServer: Boolean(member),
    member,
    user
  };
};

const activeBoostState = async (guild) => {
  const snapshot = await getBoostStatusSnapshot(guild).catch(() => null);
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
  const data = await loadJson(ECONOMY_FILE, emptyData());
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
  if (syncMembers) await guild.members.fetch().catch(() => null);
  await mutationQueue.catch(() => {});
  const data = await loadJson(ECONOMY_FILE, emptyData());
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
        avatar: resolveEconomyAvatarUrl(member.user, { extension: 'webp', size: 64 }),
        avatarUrl: resolveEconomyAvatarUrl(member.user, { extension: 'webp', size: 64 })
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
  const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
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
        throw new Error(`Die VIP-Rolle konnte nicht sicher geändert werden: ${error?.message || error}`);
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
      { name: 'Aktuell aktiv', value: activeBoostCount > 0 ? `${activeBoostCount}× Boost` : 'Kein aktiver Boost', inline: true },
      { name: 'Boost-Rekord', value: `${account.boostRecord || 0}×`, inline: true },
      { name: 'Coin-Abgleich', value: boostCreditPaused ? 'Sicher pausiert – Team prüft die Discord-Gesamtsumme' : 'Aktuell und automatisch geprüft', inline: true },
      { name: 'Nächstes Upgrade', value: next ? `${next.name} · ${money(Math.max(0, next.price - Number(active?.price || 0)))}` : 'Höchste Stufe erreicht' }
    )
    .setFooter({ text: 'Heaven Coins sind nicht auszahlbar und gelten ausschließlich innerhalb von FALLEN HEAVEN.' });
};

export const buildHeavenEconomyComponents = () => {
  const rowOne = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('fh_coin:account').setLabel('Mein Konto').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('fh_coin:shop').setLabel('VIP-Shop').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('fh_coin:gift').setLabel('VIP verschenken').setStyle(ButtonStyle.Secondary)
  );
  const rowTwo = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('fh_coin:buy').setLabel('Coins kaufen').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('fh_coin:progress').setLabel('Boost-Fortschritt').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('fh_coin:perks').setLabel('VIP-Vorteile').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('fh_coin:admin').setLabel('Coin-Verwaltung').setStyle(ButtonStyle.Secondary)
  );
  return [rowOne, rowTwo];
};

const panelPayload = (cfg) => {
  const emoji = coin(cfg);
  const embed = new EmbedBuilder()
    .setColor(0x6f65ff)
    .setAuthor({ name: 'FALLEN HEAVEN · VIP LOUNGE' })
    .setTitle(`${emoji} Heaven Coins & VIP-Engel`)
    .setDescription('Sammle Heaven Coins durch Boost-Meilensteine und besondere Unterstützung. Schalte exklusive VIP-Stufen frei oder verschenke ein Upgrade an ein anderes Mitglied.')
    .addFields(
      { name: 'VIP-STUFEN', value: '**VIP** · 500 Coins\n**BRONZE** · 1.000 Coins\n**SILBER** · 2.500 Coins\n**GOLD** · 4.000 Coins\n**DIAMANT** · 5.000 Coins', inline: true },
      { name: 'BOOST-MEILENSTEINE', value: `Dein aktueller Stand wird beim Start einmal vollständig mit Discord abgeglichen. Danach verarbeitet der Bot jeden neuen Boost automatisch, aktualisiert die Staffelrolle und vergütet jede erstmals erreichte Stufe mit **${money(conf(cfg).boostMilestoneReward || 100)}**.`, inline: true },
      { name: 'DEINE ENTSCHEIDUNG', value: 'Öffne dein privates Konto, kaufe oder upgrade VIP, verschenke eine Stufe oder prüfe deinen persönlichen Boost-Fortschritt.' }
    )
    .setFooter({ text: 'Private Server-Ansichten · keine DMs · keine Commands' });
  return { embeds: [embed], components: buildHeavenEconomyComponents(), allowedMentions: { parse: [] } };
};

const ensurePanel = async (guild, cfg) => {
  const settings = conf(cfg);
  if (!settings.enabled || !settings.panelChannelId) return null;
  const channel = guild.channels.cache.get(String(settings.panelChannelId)) || await guild.channels.fetch(String(settings.panelChannelId)).catch(() => null);
  if (!channel?.isTextBased?.() || !channel.messages) throw new Error('Der konfigurierte Heaven-Coin-Kanal ist nicht beschreibbar.');
  const panels = await loadJson(PANEL_FILE, {});
  let message = panels[guild.id] ? await channel.messages.fetch(String(panels[guild.id])).catch(() => null) : null;
  if (message?.author?.id === guild.client.user.id) await message.edit(panelPayload(cfg));
  else {
    message = await channel.send(panelPayload(cfg));
    panels[guild.id] = message.id;
    await saveJson(PANEL_FILE, panels);
  }
  return message;
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
      await interaction.reply({ content: `Kontostand erfolgreich aktualisiert: **${money(result.before)} → ${money(result.after)}**\nGrund: ${reason}\nTransaktion: \`${result.transaction.id}\``, flags: MessageFlags.Ephemeral });
      return true;
    }
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
  } else if (id === 'fh_coin:perks') {
    const embed = new EmbedBuilder()
      .setColor(0x7772ff)
      .setAuthor({ name: 'FALLEN HEAVEN · VIP-ENGEL' })
      .setTitle('Deine VIP-Privilegien')
      .setDescription('🌟 **Hervorgehobene Präsenz**\n📸 **Exklusiver VIP-Media-Bereich**\n🎤 **Private Lounges und Voice-Channels**\n💬 **Eigene Bereiche je VIP-Stufe**\n⏳ **Frühzeitiger Zugang zu Aktionen und Events**\n⚡ **Bevorzugter Support**')
      .setFooter({ text: 'Die verfügbaren Bereiche richten sich nach deiner aktiven VIP-Stufe.' });
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
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
    const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
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
    await ensurePanel(guild, cfg).catch((error) => console.error(`[heavenEconomy] Panel ${guild.name}:`, error.message));
    if (conf(cfg).enabled) {
      void (async () => {
        await waitForBoostRoleReconcile(guild.id);
        await reconcileHeavenEconomyBoostMilestones({ guild, cfg, source: 'startup' });
      })().catch((error) => console.error(`[heavenEconomy] Startabgleich ${guild.name}:`, error.message));
    }
  },
  async onConfigUpdate({ guild, cfg, patch }) {
    if (!patch) return;
    if (Object.prototype.hasOwnProperty.call(patch, 'heavenEconomy')) {
      ensurePeriodicEconomyReconcile(guild, cfg);
      await ensurePanel(guild, cfg);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'heavenEconomy') || Object.prototype.hasOwnProperty.call(patch, 'boostRoles')) {
      if (conf(cfg).enabled) void reconcileHeavenEconomyBoostMilestones({ guild, cfg, source: 'config-update' }).catch(() => {});
    }
  },
  async onMessageDelete({ message, cfg }) {
    if (!conf(cfg).enabled || !message?.guild) return;
    const panels = await loadJson(PANEL_FILE, {});
    if (String(panels[message.guild.id] || '') === String(message.id || '')) await ensurePanel(message.guild, cfg);
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
    const boostChanged = Boolean(oldMember.premiumSince) !== Boolean(newMember.premiumSince)
      || Number(oldMember.premiumSinceTimestamp || 0) !== Number(newMember.premiumSinceTimestamp || 0);
    if (!boostChanged || !newMember.premiumSince) return;
    scheduleBoostMilestoneSettlement({ member: newMember, cfg, source: 'guild-member-update' });
  }
};
