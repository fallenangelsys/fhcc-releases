import RPC from 'discord-rpc';

let rpcClient = null;
let updateTimer = null;
let lastSignature = '';
let lastUpdateAt = 0;
let connecting = false;
let activeGuildId = '';
let presenceStartAt = Date.now();
let nextConnectAttemptAt = 0;
let updateInFlight = null;

const MIN_UPDATE_GAP_MS = 12_000;
const RPC_RETRY_MS = 2 * 60_000;
const RPC_LOGIN_TIMEOUT_MS = 8_000;

const clampNumber = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const formatTemplate = (value = '', stats = {}) =>
  String(value || '')
    .replaceAll('{guild}', stats.guildName || 'FALLEN HEAVEN')
    .replaceAll('{online}', String(stats.onlineCount || 0))
    .replaceAll('{members}', String(stats.memberCount || 0))
    .replaceAll('{channels}', String(stats.channelCount || 0));

export const getRpcPartyCounts = (onlineCount, memberCount) => {
  const partySize = Math.max(0, Math.trunc(Number(onlineCount) || 0));
  return {
    partySize,
    partyMax: Math.max(1, partySize, Math.trunc(Number(memberCount) || 0))
  };
};

const getConfig = (cfg = {}) => ({
  enabled: cfg.customRichPresence?.enabled === true,
  applicationId: String(cfg.customRichPresence?.applicationId || process.env.DISCORD_CLIENT_ID || '1486457987072528575').trim(),
  details: String(cfg.customRichPresence?.details || '{guild} - {online} online').replaceAll('{voice}', '{online}').trim(),
  state: String(cfg.customRichPresence?.state || 'Aktive Gefallene').replaceAll('{voice}', '{online}').trim(),
  largeImageKey: String(cfg.customRichPresence?.largeImageKey || 'pfp').trim(),
  largeImageText: String(cfg.customRichPresence?.largeImageText || 'Fallen-Heaven').replaceAll('{voice}', '{online}').trim(),
  smallImageKey: String(cfg.customRichPresence?.smallImageKey || 'verified').trim(),
  smallImageText: String(cfg.customRichPresence?.smallImageText || 'Aktiver Server').replaceAll('{voice}', '{online}').trim(),
  button1Label: String(cfg.customRichPresence?.button1Label || 'Mein Server').trim(),
  button1Url: String(cfg.customRichPresence?.button1Url || 'https://discord.gg/fallen-heaven').trim(),
  button2Label: String(cfg.customRichPresence?.button2Label || 'guns.lol').trim(),
  button2Url: String(cfg.customRichPresence?.button2Url || 'https://guns.lol/0xvoidsoul').trim(),
  updateIntervalSeconds: clampNumber(cfg.customRichPresence?.updateIntervalSeconds, 30, 15, 300)
});

const getStats = async (guild) => {
  const expectedMembers = Math.max(0, Number(guild.memberCount || 0));
  const memberCount = expectedMembers || guild.members.cache.size || 0;
  const presenceCount = guild.presences.cache.filter((presence) => {
    const member = guild.members.cache.get(presence.userId);
    return presence.status && presence.status !== 'offline' && member?.user?.bot !== true;
  }).size;
  const memberPresenceCount = guild.members.cache.filter((member) => (
    !member.user.bot && member.presence?.status && member.presence.status !== 'offline'
  )).size;

  return {
    guildName: guild.name,
    memberCount,
    onlineCount: Math.max(presenceCount, memberPresenceCount),
    channelCount: guild.channels.cache.size || 0
  };
};

const destroyRpcClient = async (client = rpcClient) => {
  if (!client) return;
  if (rpcClient === client) rpcClient = null;
  await client.clearActivity().catch(() => {});
  await client.destroy().catch(() => {});
};

const withTimeout = (promise, timeoutMs, message) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  timer.unref?.();
  promise.then(
    (value) => { clearTimeout(timer); resolve(value); },
    (error) => { clearTimeout(timer); reject(error); }
  );
});

const ensureRpc = async (applicationId) => {
  if (rpcClient?.applicationId === applicationId) return rpcClient;
  if (connecting || Date.now() < nextConnectAttemptAt) return null;

  connecting = true;
  let client = null;
  try {
    await destroyRpcClient();
    RPC.register(applicationId);
    client = new RPC.Client({ transport: 'ipc' });
    await withTimeout(
      client.login({ clientId: applicationId }),
      RPC_LOGIN_TIMEOUT_MS,
      'Discord Desktop antwortet nicht auf RPC.'
    );
    presenceStartAt = Date.now();
    client.applicationId = applicationId;
    client.on('disconnected', () => {
      if (rpcClient === client) rpcClient = null;
      lastSignature = '';
    });
    rpcClient = client;
    nextConnectAttemptAt = 0;
    return client;
  } catch (error) {
    nextConnectAttemptAt = Date.now() + RPC_RETRY_MS;
    await destroyRpcClient(client);
    console.warn(`[customRichPresence] RPC ist momentan nicht verfügbar; neuer Versuch in 2 Minuten: ${error?.message || error}`);
    return null;
  } finally {
    connecting = false;
  }
};

const clearRpc = async () => {
  lastSignature = '';
  activeGuildId = '';
  nextConnectAttemptAt = 0;
  await destroyRpcClient();
};

const performRichPresenceUpdate = async ({ cfg, guild }) => {
  const rp = getConfig(cfg);
  if (!rp.enabled || !rp.applicationId || !guild) {
    if (!activeGuildId || activeGuildId === guild?.id) await clearRpc();
    return;
  }

  const now = Date.now();
  if (now - lastUpdateAt < MIN_UPDATE_GAP_MS) return;

  const stats = await getStats(guild);
  const party = getRpcPartyCounts(stats.onlineCount, stats.memberCount);
  const payload = {
    details: formatTemplate(rp.details, stats).slice(0, 128),
    state: formatTemplate(rp.state, stats).slice(0, 128),
    largeImageKey: rp.largeImageKey || undefined,
    largeImageText: formatTemplate(rp.largeImageText, stats).slice(0, 128) || undefined,
    smallImageKey: rp.smallImageKey || undefined,
    smallImageText: formatTemplate(rp.smallImageText, stats).slice(0, 128) || undefined,
    instance: false,
    startTimestamp: presenceStartAt,
    ...party,
    buttons: [
      rp.button1Label && /^https?:\/\//i.test(rp.button1Url) ? { label: rp.button1Label.slice(0, 32), url: rp.button1Url } : null,
      rp.button2Label && /^https?:\/\//i.test(rp.button2Url) ? { label: rp.button2Label.slice(0, 32), url: rp.button2Url } : null
    ].filter(Boolean)
  };

  const signature = JSON.stringify(payload);
  if (signature === lastSignature) return;

  const client = await ensureRpc(rp.applicationId);
  if (!client) return;

  try {
    await client.setActivity(payload);
    lastSignature = signature;
    lastUpdateAt = now;
    activeGuildId = guild.id;
  } catch (error) {
    lastSignature = '';
    nextConnectAttemptAt = Date.now() + RPC_RETRY_MS;
    await destroyRpcClient(client);
    console.warn(`[customRichPresence] RPC-Update fehlgeschlagen; neuer Versuch in 2 Minuten: ${error?.message || error}`);
  }
};

const updateRichPresence = ({ cfg, guild }) => {
  if (updateInFlight) return updateInFlight;
  updateInFlight = performRichPresenceUpdate({ cfg, guild })
    .finally(() => { updateInFlight = null; });
  return updateInFlight;
};

const schedule = ({ cfg, guild }) => {
  const rp = getConfig(cfg);
  if (updateTimer) {
    clearInterval(updateTimer);
    updateTimer = null;
  }

  if (!rp.enabled) {
    if (!activeGuildId || activeGuildId === guild?.id) void clearRpc();
    return;
  }

  updateTimer = setInterval(() => {
    void updateRichPresence({ cfg, guild }).catch(() => {});
  }, rp.updateIntervalSeconds * 1000);
  updateTimer.unref?.();
  void updateRichPresence({ cfg, guild });
};

export const feature = {
  id: 'customRichPresence',
  commands: [],
  async onClientReady({ cfg, guild }) {
    schedule({ cfg, guild });
  },
  async onConfigUpdate({ cfg, guild }) {
    schedule({ cfg, guild });
  },
  async onGuildMemberAdd(context) {
    await updateRichPresence(context);
  },
  async onGuildMemberRemove(context) {
    await updateRichPresence(context);
  },
  async onPresenceUpdate(context) {
    await updateRichPresence(context);
  }
};
