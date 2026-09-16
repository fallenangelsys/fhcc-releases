import RPC from 'discord-rpc';

const RPC_CALL_TIMEOUT_MS = 8_000;
const RPC_RETRY_MS = 2 * 60_000;
const MIN_UPDATE_GAP_MS = 12_000;

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
  applicationId: String(cfg.customRichPresence?.applicationId || process.env.DISCORD_CLIENT_ID || '').trim(),
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

const withTimeout = (promise, timeoutMs, message) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  timer.unref?.();
  promise.then(
    (value) => { clearTimeout(timer); resolve(value); },
    (error) => { clearTimeout(timer); reject(error); }
  );
});

export const createCustomRichPresenceController = (deps = {}) => {
  const now = deps.now || (() => Date.now());
  const Rpc = deps.RPC || RPC;
  const setIntervalFn = deps.setIntervalFn || setInterval;
  const clearIntervalFn = deps.clearIntervalFn || clearInterval;
  const callTimeoutMs = deps.callTimeoutMs || RPC_CALL_TIMEOUT_MS;

  let rpcClient = null;
  let updateTimer = null;
  let lastSignature = '';
  let activeGuildId = '';
  let updateInFlight = null;
  let connecting = false;
  let nextConnectAttemptAt = 0;
  let presenceStartAt = now();

  const status = {
    enabled: false,
    state: 'disabled',
    connected: false,
    activeGuildId: '',
    lastAttemptAt: null,
    lastSuccessAt: null,
    retryAt: null,
    lastError: null,
    lastUpdateDurationMs: 0
  };

  const runRpcCall = async (label, operation) => {
    const startedAt = now();
    try {
      return await withTimeout(Promise.resolve().then(operation), callTimeoutMs, `Discord RPC ${label} reagiert nicht.`);
    } finally {
      status.lastUpdateDurationMs = Math.max(0, now() - startedAt);
    }
  };

  const destroyRpcClient = async (client = rpcClient) => {
    if (!client) return;
    if (rpcClient === client) rpcClient = null;
    await Promise.allSettled([
      runRpcCall('clearActivity', () => client.clearActivity()),
      runRpcCall('destroy', () => client.destroy())
    ]).catch(() => {});
  };

  const ensureRpc = async (applicationId) => {
    if (rpcClient?.applicationId === applicationId) return rpcClient;
    if (connecting || now() < nextConnectAttemptAt) return null;

    connecting = true;
    status.state = 'connecting';
    status.lastAttemptAt = new Date(now()).toISOString();
    let client = null;
    try {
      await destroyRpcClient();
      Rpc.register(applicationId);
      client = new Rpc.Client({ transport: 'ipc' });
      await runRpcCall('login', () => client.login({ clientId: applicationId }));
      presenceStartAt = now();
      client.applicationId = applicationId;
      client.on('disconnected', () => {
        if (rpcClient === client) {
          rpcClient = null;
          lastSignature = '';
          if (status.enabled) {
            status.state = 'degraded';
            status.connected = false;
            status.retryAt = new Date(now() + RPC_RETRY_MS).toISOString();
            status.lastError = 'RPC-Verbindung getrennt';
          }
        }
      });
      rpcClient = client;
      nextConnectAttemptAt = 0;
      return client;
    } catch (error) {
      nextConnectAttemptAt = now() + RPC_RETRY_MS;
      status.state = status.connected ? 'degraded' : 'failed';
      status.connected = false;
      status.retryAt = new Date(now() + RPC_RETRY_MS).toISOString();
      status.lastError = String(error?.message || error).slice(0, 240);
      await destroyRpcClient(client);
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
    status.state = 'disabled';
    status.connected = false;
    status.activeGuildId = '';
    status.retryAt = null;
    status.lastError = null;
  };

  const performRichPresenceUpdate = async ({ cfg, guild }) => {
    const rp = getConfig(cfg);
    status.enabled = rp.enabled;
    if (!rp.enabled || !rp.applicationId || !guild) {
      if (!activeGuildId || activeGuildId === guild?.id) await clearRpc();
      return;
    }

    const currentNow = now();
    if (currentNow - (status.lastAttemptAt ? new Date(status.lastAttemptAt).getTime() : 0) < MIN_UPDATE_GAP_MS && updateInFlight) return;

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

    status.lastAttemptAt = new Date(currentNow).toISOString();
    try {
      await runRpcCall('setActivity', () => client.setActivity(payload));
      lastSignature = signature;
      activeGuildId = guild.id;
      status.state = 'connected';
      status.connected = true;
      status.activeGuildId = guild.id;
      status.lastSuccessAt = new Date(currentNow).toISOString();
      status.lastError = null;
      status.retryAt = null;
    } catch (error) {
      lastSignature = '';
      nextConnectAttemptAt = now() + RPC_RETRY_MS;
      status.state = 'degraded';
      status.connected = false;
      status.retryAt = new Date(now() + RPC_RETRY_MS).toISOString();
      status.lastError = String(error?.message || error).slice(0, 240);
      await destroyRpcClient(client);
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
    status.enabled = rp.enabled;
    if (updateTimer) {
      clearIntervalFn(updateTimer);
      updateTimer = null;
    }

    if (!rp.enabled) {
      if (!activeGuildId || activeGuildId === guild?.id) void clearRpc();
      return;
    }

    updateTimer = setIntervalFn(() => {
      void updateRichPresence({ cfg, guild }).catch(() => {});
    }, rp.updateIntervalSeconds * 1000);
    if (updateTimer?.unref) updateTimer.unref();
    void updateRichPresence({ cfg, guild });
  };

  const reconnect = async ({ cfg, guild }) => {
    nextConnectAttemptAt = 0;
    lastSignature = '';
    await destroyRpcClient();
    status.state = 'connecting';
    status.lastError = null;
    status.retryAt = null;
    await updateRichPresence({ cfg, guild });
    return getStatus();
  };

  const getStatus = () => ({ ...status });

  return { schedule, update: updateRichPresence, getStatus, clear: clearRpc, reconnect };
};

const controller = createCustomRichPresenceController();
export const getCustomRichPresenceStatus = () => controller.getStatus();
export const reconnectCustomRichPresence = (context) => controller.reconnect(context);

export const feature = {
  id: 'customRichPresence',
  commands: [],
  async onClientReady({ cfg, guild }) {
    controller.schedule({ cfg, guild });
  },
  async onConfigUpdate({ cfg, guild }) {
    controller.schedule({ cfg, guild });
  },
  async onGuildMemberAdd(context) {
    await controller.update(context);
  },
  async onGuildMemberRemove(context) {
    await controller.update(context);
  },
  async onPresenceUpdate(context) {
    await controller.update(context);
  }
};

export const _controllerInternals = controller;
