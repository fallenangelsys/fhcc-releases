import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import dns from 'node:dns';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const COOKIE_NAME = 'discord_bot_dashboard_session';
const DISCORD_AUTHORIZE_URL = 'https://discord.com/api/oauth2/authorize';
const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';
const DISCORD_USER_URL = 'https://discord.com/api/users/@me';
const DISCORD_GUILDS_URL = 'https://discord.com/api/users/@me/guilds';

const oauthStates = new Map();
const nativeOauthTransactions = new Map();
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const NATIVE_OAUTH_RESULT_TTL_MS = 5 * 60 * 1000;
const NATIVE_OAUTH_DIRECTORY = path.join(os.tmpdir(), 'fallen-heaven-control-center', 'oauth');
const OAUTH_STATE_ISSUER = 'fallen-heaven-control-center';
const OAUTH_STATE_AUDIENCE = 'discord-oauth';
const DASHBOARD_ACCESS_VERSION = 2;
const SESSION_RENEWAL_WINDOW_SECONDS = 7 * 24 * 60 * 60;
const DISCORD_FETCH_TIMEOUT_MS = 12000;
const DISCORD_FETCH_RETRY_DELAYS_MS = [600, 1400, 2600];
const LOCAL_OAUTH_CALLBACK_PATH = '/api/auth/discord/callback';
const LOCAL_OAUTH_HOST = '127.0.0.1';

dns.setDefaultResultOrder?.('ipv4first');

const DASHBOARD_PERMISSIONS = {
  ADMINISTRATOR: 8n,
  MANAGE_GUILD: 32n
};

const getToken = (req) => {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    return header.slice(7);
  }

  if (req.cookies && req.cookies[COOKIE_NAME]) {
    return req.cookies[COOKIE_NAME];
  }

  return null;
};

const parseCookieMaxAge = (ttl) => {
  const weekMatch = /^(\d+)\s*w$/i.exec(ttl);
  const dayMatch = /^(\d+)\s*d$/i.exec(ttl);
  const hourMatch = /^(\d+)\s*h$/i.exec(ttl);
  const minuteMatch = /^(\d+)\s*m$/i.exec(ttl);
  const secondMatch = /^(\d+)\s*s$/i.exec(ttl);

  if (weekMatch) {
    return Number(weekMatch[1]) * 7 * 24 * 60 * 60 * 1000;
  }

  if (dayMatch) {
    return Number(dayMatch[1]) * 24 * 60 * 60 * 1000;
  }

  if (hourMatch) {
    return Number(hourMatch[1]) * 60 * 60 * 1000;
  }

  if (minuteMatch) {
    return Number(minuteMatch[1]) * 60 * 1000;
  }

  if (secondMatch) {
    return Number(secondMatch[1]) * 1000;
  }

  const numeric = Number(ttl);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric * 1000;
  }

  return 30 * 24 * 60 * 60 * 1000;
};

const getPermissionBitfield = (permissions) => {
  let bitfield = 0n;
  try {
    bitfield = BigInt(String(permissions || '0'));
  } catch {
    bitfield = 0n;
  }

  return bitfield;
};

const getGuildAccess = (guild = {}) => {
  if (guild?.owner === true) {
    return {
      allowed: true,
      role: 'Owner',
      reason: 'Server Owner'
    };
  }

  const bitfield = getPermissionBitfield(guild?.permissions);
  if ((bitfield & DASHBOARD_PERMISSIONS.ADMINISTRATOR) !== 0n) {
    return {
      allowed: true,
      role: 'Administrator',
      reason: 'Administrator'
    };
  }

  if ((bitfield & DASHBOARD_PERMISSIONS.MANAGE_GUILD) !== 0n) {
    return {
      allowed: true,
      role: 'Manage Server',
      reason: 'Server verwalten'
    };
  }

  return (
    {
      allowed: false,
      role: 'Kein Zugriff',
      reason: 'Nur Owner, Administrator oder Server verwalten'
    }
  );
};

const authPayload = (token, secret) => {
  try {
    return jwt.verify(token, secret);
  } catch {
    return null;
  }
};

// Exportiert, damit src/index.js Routen, die nicht im Dashboard-Mount liegen
// (Diagnose, Forum-Cleaner, Emoji-Umbenennung) für den mobilen Client über
// dieselbe Sitzungsprüfung freigeben kann, statt die Logik zu duplizieren.
export const createDashboardSessionValidator = (secret) => (req) => {
  const token = getToken(req);
  if (!token) return { ok: false, status: 401, error: 'Discord-Anmeldung erforderlich.' };
  const payload = authPayload(token, String(secret || ''));
  if (!payload) return { ok: false, status: 401, error: 'Discord-Sitzung ist abgelaufen. Bitte erneut anmelden.' };
  if (payload.accessVersion !== DASHBOARD_ACCESS_VERSION) {
    return { ok: false, status: 401, error: 'Dashboard-Login ist veraltet. Bitte neu mit Discord anmelden.' };
  }
  return { ok: true, payload };
};

const cleanupOauthState = () => {
  const now = Date.now();
  for (const [state, meta] of oauthStates.entries()) {
    if (now - meta.createdAt > OAUTH_STATE_TTL_MS) {
      oauthStates.delete(state);
    }
  }
  for (const [transactionId, transaction] of nativeOauthTransactions.entries()) {
    if (Number(transaction?.expiresAt || 0) <= now) {
      nativeOauthTransactions.delete(transactionId);
    }
  }
};

const sha256 = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex');

const safeHashMatch = (left, right) => {
  const leftBuffer = Buffer.from(String(left || ''), 'hex');
  const rightBuffer = Buffer.from(String(right || ''), 'hex');
  return leftBuffer.length === 32 && rightBuffer.length === 32 && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const isNativeTransactionId = (value) => /^[a-f0-9]{48}$/i.test(String(value || ''));

const nativeTransactionFile = (transactionId) => path.join(NATIVE_OAUTH_DIRECTORY, `${transactionId}.json`);

const readNativeTransaction = async (transactionId) => {
  if (!isNativeTransactionId(transactionId)) return null;
  const memoryRecord = nativeOauthTransactions.get(transactionId);
  if (memoryRecord) return memoryRecord;
  try {
    const record = JSON.parse(await readFile(nativeTransactionFile(transactionId), 'utf8'));
    if (Number(record?.expiresAt || 0) <= Date.now()) {
      await rm(nativeTransactionFile(transactionId), { force: true }).catch(() => {});
      return null;
    }
    nativeOauthTransactions.set(transactionId, record);
    return record;
  } catch {
    return null;
  }
};

const writeNativeTransaction = async (record) => {
  const transactionId = String(record?.transactionId || '');
  if (!isNativeTransactionId(transactionId)) throw new Error('Invalid native OAuth transaction');
  nativeOauthTransactions.set(transactionId, record);
  await mkdir(NATIVE_OAUTH_DIRECTORY, { recursive: true });
  const temporaryFile = `${nativeTransactionFile(transactionId)}.${process.pid}.tmp`;
  await writeFile(temporaryFile, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 });
  await rm(nativeTransactionFile(transactionId), { force: true }).catch(() => {});
  await rename(temporaryFile, nativeTransactionFile(transactionId));
};

const createOAuthState = (jwtSecret, payload = {}) => jwt.sign(
  {
    ...payload,
    nonce: crypto.randomBytes(18).toString('hex')
  },
  jwtSecret,
  {
    expiresIn: Math.floor(OAUTH_STATE_TTL_MS / 1000),
    issuer: OAUTH_STATE_ISSUER,
    audience: OAUTH_STATE_AUDIENCE
  }
);

const verifyOAuthState = (state, jwtSecret) => {
  try {
    return jwt.verify(state, jwtSecret, {
      issuer: OAUTH_STATE_ISSUER,
      audience: OAUTH_STATE_AUDIENCE
    });
  } catch {
    return null;
  }
};

const createDiscordAuthorizeUrl = ({ clientId, redirectUri, state }) => {
  const url = new URL(DISCORD_AUTHORIZE_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', 'identify guilds');
  url.searchParams.set('state', state);
  return url.toString();
};

const createSessionPayload = (profile) => ({
  role: 'admin',
  discordId: profile.id,
  username: profile.username,
  discriminator: profile.discriminator,
  avatar: profile.avatar,
  accessVersion: DASHBOARD_ACCESS_VERSION,
  manageableGuildIds: profile.manageableGuildIds,
  manageableGuilds: profile.manageableGuilds,
  createdAt: new Date().toISOString()
});

const escapeHtml = (value) => String(value || '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const renderNativeOauthResult = (res, { ok, title, message }) => res.status(ok ? 200 : 400).type('html').send(`<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;color:#f7f8ff;background:radial-gradient(circle at 50% 0%,#5865f255,transparent 42%),linear-gradient(145deg,#090b20,#15184a)}
main{width:min(520px,100%);padding:42px;border:1px solid #ffffff1f;border-radius:28px;background:#11142be8;box-shadow:0 28px 90px #0008;text-align:center;backdrop-filter:blur(18px)}
.mark{width:72px;height:72px;margin:0 auto 24px;display:grid;place-items:center;border-radius:24px;font-size:32px;background:${ok ? '#34d39922' : '#fb718522'};border:1px solid ${ok ? '#34d39966' : '#fb718566'}}
h1{margin:0 0 12px;font-size:clamp(28px,6vw,40px);letter-spacing:-.04em}p{margin:0;color:#b8bed8;font-size:16px;line-height:1.65}.hint{margin-top:24px;color:#858dad;font-size:13px}
</style></head><body><main><div class="mark">${ok ? '&#10003;' : '!'}</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p class="hint">Dieses Fenster kann jetzt geschlossen werden.</p></main></body></html>`);

const createDashboardCookie = (res, token, cookieMaxAge) => {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/',
    maxAge: cookieMaxAge
  });
};

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const isTransientDiscordFetchError = (error) => {
  const code = String(error?.code || error?.cause?.code || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();
  return ['ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET'].includes(code)
    || /network|fetch failed|timeout|timed out|socket|dns|getaddrinfo|temporarily/i.test(message);
};

const discordFetch = async (url, options = {}, label = 'Discord API') => {
  let lastError = null;
  for (let attempt = 0; attempt <= DISCORD_FETCH_RETRY_DELAYS_MS.length; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error(`${label} hat zu lange nicht geantwortet.`)), DISCORD_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);
      if (![429, 500, 502, 503, 504].includes(Number(response.status)) || attempt === DISCORD_FETCH_RETRY_DELAYS_MS.length) {
        return response;
      }
      lastError = new Error(`${label} antwortet momentan mit HTTP ${response.status}.`);
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (!isTransientDiscordFetchError(error) || attempt === DISCORD_FETCH_RETRY_DELAYS_MS.length) {
        throw error;
      }
    }
    await wait(DISCORD_FETCH_RETRY_DELAYS_MS[attempt]);
  }
  throw lastError || new Error(`${label} ist momentan nicht erreichbar.`);
};

const parseDiscordJson = async (response, fallback = {}) => {
  try {
    return await response.json();
  } catch {
    return fallback;
  }
};

const exchangeDiscordCode = async (code, redirectUri, clientId, clientSecret) => {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri
  });

  const tokenResponse = await discordFetch(DISCORD_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  }, 'Discord OAuth');

  const tokenData = await parseDiscordJson(tokenResponse);
  if (!tokenResponse.ok) {
    throw new Error(tokenData.error_description || tokenData.error || 'OAuth token exchange failed');
  }

  const accessToken = tokenData.access_token;
  if (!accessToken) {
    throw new Error('No access token received from Discord');
  }

  const apiHeaders = {
    Authorization: `Bearer ${accessToken}`
  };

  const [userResponse, guildsResponse] = await Promise.all([
    discordFetch(DISCORD_USER_URL, { headers: apiHeaders }, 'Discord Profil'),
    discordFetch(`${DISCORD_GUILDS_URL}?with_counts=false`, { headers: apiHeaders }, 'Discord Serverliste')
  ]);

  const userData = await parseDiscordJson(userResponse);
  if (!userResponse.ok) {
    throw new Error(userData.message || 'Failed to fetch Discord user');
  }

  const guildData = await parseDiscordJson(guildsResponse);
  if (!guildsResponse.ok) {
    throw new Error(guildData.message || 'Failed to fetch Discord guild list');
  }

  const manageableGuilds = Array.isArray(guildData)
    ? guildData
        .map((item) => {
          const access = getGuildAccess(item);
          return {
            id: String(item?.id || ''),
            name: String(item?.name || ''),
            icon: item?.icon || null,
            owner: item?.owner === true,
            permissions: String(item?.permissions || '0'),
            accessRole: access.role,
            accessReason: access.reason,
            allowed: access.allowed
          };
        })
        .filter((item) => item.id && item.allowed)
    : [];

  return {
    id: String(userData.id || ''),
    username: String(userData.username || ''),
    avatar: userData.avatar || null,
    discriminator: userData.discriminator || '',
    manageableGuildIds: manageableGuilds.map((item) => item.id),
    manageableGuilds
  };
};

const buildRedirectUri = (req, configuredUri) => {
  const localPort = Number(req.socket?.localPort || 3000);
  const fallback = `http://${LOCAL_OAUTH_HOST}:${localPort}${LOCAL_OAUTH_CALLBACK_PATH}`;
  const candidate = String(configuredUri || fallback).trim();
  try {
    const url = new URL(candidate);
    const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
    if (!loopback) return url.toString();
    url.protocol = 'http:';
    url.hostname = LOCAL_OAUTH_HOST;
    if (!url.port) url.port = String(localPort);
    url.pathname = LOCAL_OAUTH_CALLBACK_PATH;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return fallback;
  }
};

const getMissingOAuthConfiguration = (clientId, clientSecret) => [
  ...(!isConfiguredSecret(clientId) ? ['DISCORD_CLIENT_ID'] : []),
  ...(!isConfiguredSecret(clientSecret) ? ['DISCORD_CLIENT_SECRET'] : [])
];

const describeOAuthFailure = (error) => {
  const message = String(error?.message || error || '').trim();
  if (/invalid[_ ]client|client authentication failed/i.test(message)) {
    return 'Discord hat Application-ID oder Client-Secret abgelehnt. Bitte die OAuth2-Daten in der sicheren Einrichtung neu speichern.';
  }
  if (/redirect|invalid[_ ]grant|authorization code/i.test(message)) {
    return 'Discord hat den Login-Code oder die Redirect-URI abgelehnt. Im Developer Portal muss exakt http://127.0.0.1:3000/api/auth/discord/callback eingetragen sein.';
  }
  if (/fetch failed|network|timeout|timed out|dns|socket|temporarily/i.test(message)) {
    return 'Discord ist momentan nicht erreichbar. Bitte Internetverbindung prüfen und erneut versuchen.';
  }
  return 'Discord konnte die Anmeldung nicht abschließen. Bitte OAuth2-Daten und Redirect-URI prüfen.';
};

const isConfiguredSecret = (value) => {
  const text = String(value || '').trim();
  return Boolean(text) && !/^paste_your_/i.test(text) && !/^replace-with-/i.test(text);
};

const getOAuthEnabled = (clientId, clientSecret) => isConfiguredSecret(clientId) && isConfiguredSecret(clientSecret);

const getManagedGuildIdsFromToken = (user) => {
  const ids = Array.isArray(user?.manageableGuildIds) ? user.manageableGuildIds : [];
  const richIds = Array.isArray(user?.manageableGuilds) ? user.manageableGuilds.map((guild) => guild?.id) : [];
  return Array.from(new Set([...ids, ...richIds].map((id) => String(id)).filter(Boolean)));
};

const getManagedGuildMetaFromToken = (user) => {
  const guilds = Array.isArray(user?.manageableGuilds) ? user.manageableGuilds : [];
  const map = new Map();
  for (const guild of guilds) {
    if (guild?.id) {
      map.set(String(guild.id), guild);
    }
  }
  const ids = Array.isArray(user?.manageableGuildIds) ? user.manageableGuildIds : [];
  for (const id of ids) {
    const guildId = String(id || '');
    if (guildId && !map.has(guildId)) {
      map.set(guildId, {
        id: guildId,
        accessRole: 'Manage Server',
        accessReason: 'Server verwalten'
      });
    }
  }
  return map;
};

const intersects = (candidate, list) => {
  if (!candidate || !Array.isArray(list)) {
    return false;
  }

  return list.includes(String(candidate));
};

export const mountDashboard = (app, options = {}) => {
  const {
    listGuilds = async () => [],
    getConfig,
    setConfig,
    getAllConfigs = async () => [],
    featureCards = [],
    appVersion = '5.1.0',
    getDefaultConfig,
    getGuildName = () => 'Server',
    getGuildOwnerId,
    getGuildStats,
    getModuleReadiness,
    getGuildManagement,
    listDashboardSystemEvents,
    listGuildMessages,
    updateDashboardChannel,
    updateDashboardMessage,
    deleteDashboardMessage,
    listServerBackups,
    createServerBackup,
    previewServerRestore,
    restoreServerBackup,
    listTextChannels,
    listConfigRoles,
    listDashboardMembers,
    getServerTagTrackerStatus,
    getVoiceChatCleanerStatus,
    getTempVoiceStatus,
    removeTempVoiceProfile,
    removeAllTempVoiceProfiles,
    saveTempVoiceInterfaceDesign,
    getPublicCallVoteLocks,
    getPublicCallVoteStatus,
    removePublicCallVoteLock,
    savePublicCallVoteDesign,
    getForumCleanerStatus,
    scanForumCleaner,
    wipeLevelRoles,
    grantLevelRolesToAll,
    setMemberLevel,
    getSteamWorkshopStatus,
    syncSteamWorkshop,
    saveSteamWorkshopDesign,
    saveSteamWorkshopItemDesign,
    resetSteamWorkshopItemDesign,
    getEmojiManagerStatus,
    previewEmojiRename,
    applyEmojiRename,
    getActivityRaceStatus,
    getCountingLocks,
    getCountingStats,
    removeCountingLock,
    resetCounting,
    previewActivityRaceRoles,
    createActivityRaceRoles,
    refreshActivityRace,
    saveActivityRaceDesign,
    syncServerTagTracker,
    getBoostSystemIndexStatus,
    syncBoostRoles,
    previewBoostActivityImport,
    importBoostActivityList,
    updateBoostBaselineMember,
    verifyBoostCount,
    getBoostTopStatus,
    refreshBoostTopPanel,
    saveBoostTopDesign,
    getHeavenEconomyAdmin,
    updateHeavenEconomyAdmin,
    reconcileHeavenEconomyAdmin,
    getVipPanelStatus,
    refreshVipPanels,
    saveVipPanelDesign,
    saveHeavenEconomyPanelDesign,
    saveEconomyDmDesign,
    syncVipSeparatorRole,
    saveVerifyPanelDesign,
    saveLevelsPanelDesign,
    saveLevelUpInfoDesign,
    saveBotUpdatesDesign,
    saveCountingPanelDesign,
    saveCountingDesign,
    uploadStudioImage,
    getRoleSaverStatus,
    getInactiveReminderStatus,
    runInactiveReminderScan,
    runInactiveReminderPreview,
    runInactiveReminderSend,
    saveInactiveReminderDesign,
    deleteReminderDm,
    deleteAllReminderDms,
    cleanupInactiveReminderDms,
    sendManualInactiveReminder,
    getVoiceLogImportStatus,
    runVoiceLogBackfill,
    getVoiceLogEvents,
    getSavedRolesForMember,
    clearSavedRolesForMember,
    getDashboardMember,
    getMemberIntelligenceStatus,
    moderateDashboardMember,
    getDashboardRole,
    updateDashboardRole,
    sendGuildEmbed,
    editGuildEmbed,
    createGuildThread,
    getLiveStatus,
    getCustomRichPresenceStatus,
    reconnectCustomRichPresence,
    isDiscordReady = () => true,
    systemActions = {}
  } = options;

  const jwtSecret = process.env.DASHBOARD_SESSION_SECRET || crypto.randomBytes(32).toString('hex');
  const jwtTtl = process.env.DASHBOARD_JWT_TTL || '30d';
  const cookieMaxAge = parseCookieMaxAge(jwtTtl);
  const discordClientId = process.env.DISCORD_CLIENT_ID || '';
  const discordClientSecret = process.env.DISCORD_CLIENT_SECRET || '';
  const configuredRedirect = process.env.DASHBOARD_DISCORD_REDIRECT_URI || '';
  const oauthEnabled = getOAuthEnabled(discordClientId, discordClientSecret);
  const missingOAuthConfiguration = getMissingOAuthConfiguration(discordClientId, discordClientSecret);

  app.get('/api/auth/status', (req, res) => {
    return res.json({
      ok: true,
      oauthEnabled,
      hasDiscordClientId: isConfiguredSecret(discordClientId),
      hasDiscordClientSecret: isConfiguredSecret(discordClientSecret),
      missing: missingOAuthConfiguration,
      redirectUri: buildRedirectUri(req, configuredRedirect)
    });
  });

  const requireAuth = async (req, res, next) => {
    const token = getToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Discord-Anmeldung erforderlich.' });
    }

    const payload = authPayload(token, jwtSecret);
    if (!payload) {
      return res.status(401).json({ error: 'Discord-Sitzung ist abgelaufen. Bitte erneut anmelden.' });
    }

    if (payload.accessVersion !== DASHBOARD_ACCESS_VERSION) {
      res.clearCookie(COOKIE_NAME, { path: '/' });
      return res.status(401).json({ error: 'Dashboard-Login ist veraltet. Bitte neu mit Discord anmelden.' });
    }

    const expiresIn = Number(payload.exp || 0) - Math.floor(Date.now() / 1000);
    if (expiresIn > 0 && expiresIn <= SESSION_RENEWAL_WINDOW_SECONDS) {
      const renewedPayload = { ...payload };
      delete renewedPayload.iat;
      delete renewedPayload.exp;
      delete renewedPayload.nbf;
      delete renewedPayload.jti;
      const renewedToken = jwt.sign(renewedPayload, jwtSecret, { expiresIn: jwtTtl });
      createDashboardCookie(res, renewedToken, cookieMaxAge);
    }

    req.dashboardUser = payload;
    return next();
  };

  const botOwnsGuild = async (guildId) => {
    if (typeof getGuildOwnerId !== 'function') {
      return false;
    }

    try {
      const ownerId = await getGuildOwnerId(guildId);
      return Boolean(ownerId);
    } catch {
      return false;
    }
  };

  const canAccessGuild = async (user, guildId) => {
    if (!guildId || !user?.discordId) {
      return false;
    }

    const manageable = getManagedGuildIdsFromToken(user);
    if (!intersects(guildId, manageable)) {
      return false;
    }

    return botOwnsGuild(String(guildId));
  };

  const requireGuildAccess = async (req, res, next) => {
    const guildId = String(req.params.guildId || req.body?.guildId || '').trim();
    if (!guildId) {
      return res.status(400).json({ error: 'guildId fehlt' });
    }

    const manageable = getManagedGuildIdsFromToken(req.dashboardUser);
    if (!intersects(guildId, manageable)) {
      return res.status(403).json({ error: 'Keine Berechtigung für diesen Server.' });
    }
    if (!await Promise.resolve(isDiscordReady())) {
      res.setHeader('Retry-After', '1');
      return res.status(503).json({ error: 'Discord-Daten werden gerade verbunden. Die App versucht es automatisch erneut.', retryAfterMs: 1000 });
    }
    if (!await botOwnsGuild(guildId)) {
      return res.status(403).json({ error: 'Der Bot ist auf diesem Server nicht verfügbar.' });
    }

    req.dashboardGuildId = guildId;
    return next();
  };

  const createDashboardToken = (profile) => jwt.sign(createSessionPayload(profile), jwtSecret, { expiresIn: jwtTtl });

  app.post('/api/auth/native/start', (req, res) => {
    if (!oauthEnabled) {
      return res.status(501).json({ error: `Discord OAuth ist nicht vollständig konfiguriert. Es fehlt: ${missingOAuthConfiguration.join(', ') || 'OAuth2-Konfiguration'}.`, missing: missingOAuthConfiguration, redirectUri: buildRedirectUri(req, configuredRedirect) });
    }

    cleanupOauthState();
    const transactionId = crypto.randomBytes(24).toString('hex');
    const verifier = crypto.randomBytes(32).toString('hex');
    const verifierHash = sha256(verifier);
    const expiresAt = Date.now() + OAUTH_STATE_TTL_MS;
    nativeOauthTransactions.set(transactionId, {
      transactionId,
      verifierHash,
      status: 'pending',
      createdAt: Date.now(),
      expiresAt
    });
    const state = createOAuthState(jwtSecret, {
      purpose: 'native-discord-login',
      transactionId,
      verifierHash
    });
    const redirectUri = buildRedirectUri(req, configuredRedirect);
    return res.json({
      ok: true,
      transactionId,
      verifier,
      authorizeUrl: createDiscordAuthorizeUrl({ clientId: discordClientId, redirectUri, state }),
      redirectUri,
      expiresAt
    });
  });

  app.post('/api/auth/native/status', async (req, res) => {
    cleanupOauthState();
    const transactionId = String(req.body?.transactionId || '').trim();
    const verifier = String(req.body?.verifier || '').trim();
    if (!isNativeTransactionId(transactionId) || !/^[a-f0-9]{64}$/i.test(verifier)) {
      return res.status(400).json({ error: 'Ungültige Anmeldeanfrage.' });
    }

    const transaction = await readNativeTransaction(transactionId);
    if (!transaction) {
      return res.json({ ok: true, status: 'pending' });
    }
    if (!safeHashMatch(transaction.verifierHash, sha256(verifier))) {
      return res.status(403).json({ error: 'Anmeldeanfrage konnte nicht bestätigt werden.' });
    }
    if (Number(transaction.expiresAt || 0) <= Date.now()) {
      nativeOauthTransactions.delete(transactionId);
      await rm(nativeTransactionFile(transactionId), { force: true }).catch(() => {});
      return res.status(410).json({ error: 'Die Anmeldung ist abgelaufen. Bitte erneut versuchen.' });
    }
    if (transaction.status === 'failed') {
      return res.status(400).json({ error: transaction.message || 'Discord-Anmeldung wurde nicht abgeschlossen.' });
    }
    if (transaction.status !== 'complete' || !transaction.sessionToken) {
      return res.json({ ok: true, status: 'pending' });
    }
    return res.json({
      ok: true,
      status: 'complete',
      sessionToken: transaction.sessionToken,
      expiresAt: transaction.sessionExpiresAt,
      user: transaction.user || null
    });
  });

  app.post('/api/auth/native/consume', async (req, res) => {
    const transactionId = String(req.body?.transactionId || '').trim();
    const verifier = String(req.body?.verifier || '').trim();
    const transaction = await readNativeTransaction(transactionId);
    if (!transaction || !safeHashMatch(transaction.verifierHash, sha256(verifier))) {
      return res.status(403).json({ error: 'Anmeldeanfrage konnte nicht bestätigt werden.' });
    }
    nativeOauthTransactions.delete(transactionId);
    await rm(nativeTransactionFile(transactionId), { force: true }).catch(() => {});
    return res.json({ ok: true });
  });

  app.get('/api/auth/discord/login', (req, res) => {
    if (!oauthEnabled) {
      return res.status(501).json({ error: `Discord OAuth ist nicht vollständig konfiguriert. Es fehlt: ${missingOAuthConfiguration.join(', ') || 'OAuth2-Konfiguration'}.`, missing: missingOAuthConfiguration, redirectUri: buildRedirectUri(req, configuredRedirect) });
    }

    cleanupOauthState();
    const state = createOAuthState(jwtSecret, { purpose: 'browser-discord-login' });
    const redirectUri = buildRedirectUri(req, configuredRedirect);
    return res.redirect(createDiscordAuthorizeUrl({ clientId: discordClientId, redirectUri, state }));
  });

  app.get('/api/auth/discord/callback', async (req, res) => {
    const state = String(req.query.state || '').trim();
    const statePayload = verifyOAuthState(state, jwtSecret);
    const legacyState = oauthStates.get(state);
    const nativeFlow = statePayload?.purpose === 'native-discord-login' && isNativeTransactionId(statePayload?.transactionId);
    const fail = async (message, code = 'callback_error') => {
      if (nativeFlow) {
        const record = {
          transactionId: String(statePayload.transactionId),
          verifierHash: String(statePayload.verifierHash || ''),
          status: 'failed',
          message,
          createdAt: Date.now(),
          expiresAt: Date.now() + NATIVE_OAUTH_RESULT_TTL_MS
        };
        await writeNativeTransaction(record).catch(() => {});
        return renderNativeOauthResult(res, { ok: false, title: 'Anmeldung nicht abgeschlossen', message });
      }
      return res.redirect(`/?error=${encodeURIComponent(code)}`);
    };

    try {
      if (!oauthEnabled) return fail('Discord OAuth ist momentan nicht konfiguriert.', 'oauth_not_configured');
      if (!statePayload && !legacyState) return fail('Die Anmeldeanfrage ist ungültig oder abgelaufen.', 'invalid_oauth_state');
      if (statePayload && !['native-discord-login', 'browser-discord-login'].includes(statePayload.purpose)) {
        return fail('Die Anmeldeanfrage ist ungültig.', 'invalid_oauth_state');
      }
      if (legacyState && Date.now() - legacyState.createdAt > OAUTH_STATE_TTL_MS) {
        oauthStates.delete(state);
        return fail('Die Anmeldung ist abgelaufen. Bitte erneut versuchen.', 'oauth_state_expired');
      }
      if (legacyState) oauthStates.delete(state);

      const discordError = String(req.query.error || '').trim();
      const code = String(req.query.code || '').trim();
      if (discordError || !code) {
        return fail(discordError === 'access_denied' ? 'Die Discord-Anmeldung wurde abgebrochen.' : 'Discord hat keine gültige Anmeldung zurückgegeben.', discordError || 'missing_oauth_code');
      }

      const redirectUri = buildRedirectUri(req, configuredRedirect);
      const profile = await exchangeDiscordCode(code, redirectUri, discordClientId, discordClientSecret);
      if (!profile.id) return fail('Das Discord-Profil konnte nicht geladen werden.', 'discord_profile_failed');

      const token = createDashboardToken(profile);
      if (nativeFlow) {
        const sessionPayload = authPayload(token, jwtSecret);
        const record = {
          transactionId: String(statePayload.transactionId),
          verifierHash: String(statePayload.verifierHash || ''),
          status: 'complete',
          sessionToken: token,
          sessionExpiresAt: Number(sessionPayload?.exp || 0),
          user: createSessionPayload(profile),
          createdAt: Date.now(),
          expiresAt: Date.now() + NATIVE_OAUTH_RESULT_TTL_MS
        };
        await writeNativeTransaction(record);
        return renderNativeOauthResult(res, {
          ok: true,
          title: 'Erfolgreich angemeldet',
          message: `Willkommen ${profile.username}. Die Control-Center-App übernimmt die Sitzung automatisch.`
        });
      }

      createDashboardCookie(res, token, cookieMaxAge);
      return res.redirect('/');
    } catch (error) {
      console.error('Discord OAuth Callback fehlgeschlagen:', String(error?.message || error));
      return fail(describeOAuthFailure(error), 'discord_oauth_failed');
    }
  });

  app.post('/api/auth/logout', requireAuth, (req, res) => {
    res.clearCookie(COOKIE_NAME, { path: '/' });
    return res.json({ ok: true });
  });

  app.get('/api/auth/me', requireAuth, (req, res) => {
    const user = req.dashboardUser;
    const avatarUrl = user.discordId && user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.png?size=128`
      : null;

    return res.json({
      ok: true,
      user: {
        ...user,
        avatarUrl,
        displayName: user.username || 'Discord User'
      },
      loggedIn: true,
      auth: {
        discordLinked: Boolean(user.discordId),
        adminRole: user.role === 'admin'
      }
    });
  });

  app.get('/api/dashboard/schema', requireAuth, async (req, res) => {
    const userId = req.dashboardUser.discordId || req.dashboardUser.sub;
    let guildCount = 0;

    if (typeof listGuilds === 'function' && typeof getGuildOwnerId === 'function' && userId) {
      const all = await listGuilds();
      const manageableGuildIds = getManagedGuildIdsFromToken(req.dashboardUser);
      for (const guild of all) {
        const guildId = String(guild.id);
        if (manageableGuildIds.includes(guildId) && (await canAccessGuild(req.dashboardUser, guildId))) {
          guildCount += 1;
        }
      }
    }

    return res.json({
      featureCards,
      serverTime: new Date().toISOString(),
      appVersion,
      ownerGuildCount: guildCount
    });
  });

  app.get('/api/guilds', requireAuth, async (req, res) => {
    if (!await Promise.resolve(isDiscordReady())) {
      res.setHeader('Retry-After', '1');
      return res.status(503).json({ error: 'Discord-Daten werden gerade verbunden. Die App versucht es automatisch erneut.', retryAfterMs: 1000 });
    }
    const guilds = await listGuilds();
    const manageableGuildIds = getManagedGuildIdsFromToken(req.dashboardUser);
    const manageableMeta = getManagedGuildMetaFromToken(req.dashboardUser);
    const ownerGuilds = [];

    for (const guild of guilds) {
      if (manageableGuildIds.includes(String(guild.id)) && (await canAccessGuild(req.dashboardUser, guild.id))) {
        const meta = manageableMeta.get(String(guild.id)) || {};
        ownerGuilds.push({
          ...guild,
          accessRole: meta.accessRole || 'Manage Server',
          accessReason: meta.accessReason || 'Server verwalten',
          canManage: true,
          botPresent: true
        });
      }
    }

    return res.json({
      ok: true,
      guilds: ownerGuilds
    });
  });

  app.get('/api/configs', requireAuth, async (req, res) => {
    const manageable = getManagedGuildIdsFromToken(req.dashboardUser);
    const raw = await getAllConfigs();
    const configs = [];

    for (const cfg of raw) {
      if (manageable.includes(String(cfg.guildId)) && (await canAccessGuild(req.dashboardUser, cfg.guildId))) {
        configs.push(cfg);
      }
    }

    return res.json({
      ok: true,
      exportedAt: new Date().toISOString(),
      configs
    });
  });

  app.get('/api/config/:guildId', requireAuth, requireGuildAccess, async (req, res) => {
    const guildId = String(req.params.guildId || '').trim();
    const cfg = await getConfig(guildId);
    if (!cfg) {
      return res.status(404).json({ error: 'Keine Konfiguration für diese Guild' });
    }

    return res.json({ ok: true, config: cfg });
  });

  app.put('/api/config/:guildId', requireAuth, requireGuildAccess, async (req, res) => {
    const guildId = String(req.params.guildId || '').trim();
    const body = req.body;
    const patch = body && body.patch && typeof body.patch === 'object' ? body.patch : body;

    if (!patch || typeof patch !== 'object') {
      return res.status(400).json({ error: 'Payload muss ein Objekt sein' });
    }

    const updated = await setConfig(guildId, patch);
    return res.json({ ok: true, config: updated });
  });

  app.post('/api/config/:guildId/reset', requireAuth, requireGuildAccess, async (req, res) => {
    const guildId = String(req.params.guildId || '').trim();
    const guildName = getGuildName(guildId) || 'Server';
    const baseline = typeof getDefaultConfig === 'function' ? getDefaultConfig(guildId, guildName) : {};
    const featureId = String(req.query.feature || '').trim();

    const patch = featureId ? { [featureId]: baseline?.[featureId] } : baseline;
    const options = featureId ? { reset: false } : { reset: true };

    const updated = await setConfig(guildId, patch, options);
    return res.json({ ok: true, config: updated });
  });

  app.post('/api/configs/import', requireAuth, async (req, res) => {
    const manageable = getManagedGuildIdsFromToken(req.dashboardUser);
    const payload = req.body;
    const configs = Array.isArray(payload?.configs) ? payload.configs : [];
    if (!configs.length) {
      return res.status(400).json({ error: 'Payload muss ein Array als configs enthalten' });
    }

    const imported = [];
    for (const entry of configs) {
      if (!entry || typeof entry !== 'object' || !entry.guildId) {
        continue;
      }

      const guildId = String(entry.guildId);
      if (!manageable.includes(guildId) || !(await canAccessGuild(req.dashboardUser, guildId))) {
        continue;
      }

      const updated = await setConfig(guildId, entry, { reset: false });
      imported.push(updated);
    }

    return res.json({
      ok: true,
      count: imported.length,
      configs: imported
    });
  });

  app.get('/api/ping', (_req, res) => {
    return res.json({ ok: true, now: new Date().toISOString() });
  });

  app.get('/api/live/status', requireAuth, async (_req, res) => {
    if (typeof getLiveStatus !== 'function') {
      return res.status(501).json({ error: 'Live-Status ist nicht konfiguriert.' });
    }

    const status = await getLiveStatus();
    return res.json({ ok: true, status });
  });

  app.get('/api/guild/:guildId/custom-rich-presence/status', requireAuth, requireGuildAccess, (_req, res) => {
    const status = typeof getCustomRichPresenceStatus === 'function'
      ? getCustomRichPresenceStatus()
      : { state: 'disabled', enabled: false };
    return res.json({ ok: true, status });
  });

  app.post('/api/guild/:guildId/custom-rich-presence/reconnect', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof reconnectCustomRichPresence !== 'function') {
      return res.status(501).json({ error: 'Neuverbindung ist nicht konfiguriert.' });
    }
    try {
      const guild = req.dashboardGuild;
      const cfg = await (typeof getConfig === 'function' ? getConfig(req.dashboardGuildId) : Promise.resolve({}));
      const status = await reconnectCustomRichPresence({ cfg, guild });
      return res.json({ ok: true, status });
    } catch (error) {
      return res.status(500).json({ error: String(error?.message || error) });
    }
  });

  app.get('/api/guild/:guildId/stats', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof getGuildStats !== 'function') {
      return res.status(501).json({ error: 'Server-Statistiken sind nicht konfiguriert.' });
    }

    const stats = await getGuildStats(req.dashboardGuildId);
    if (!stats) {
      return res.status(404).json({ error: 'Server wurde nicht gefunden.' });
    }

    return res.json({ ok: true, stats });
  });

  app.get('/api/guild/:guildId/module-readiness', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof getModuleReadiness !== 'function') {
      return res.status(501).json({ error: 'Die Modulbereitschaft ist nicht konfiguriert.' });
    }
    try {
      const readiness = await getModuleReadiness(req.dashboardGuildId);
      if (!readiness) return res.status(404).json({ error: 'Server wurde nicht gefunden.' });
      return res.json({ ok: true, readiness });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Die Modulbereitschaft konnte nicht geprüft werden.' });
    }
  });

  app.get('/api/guild/:guildId/management', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof getGuildManagement !== 'function') {
      return res.status(501).json({ error: 'Serververwaltung ist nicht konfiguriert.' });
    }

    try {
      const management = await getGuildManagement(req.dashboardGuildId, {
        fresh: String(req.query.refresh || '') === '1'
      });
      if (!management) {
        return res.status(404).json({ error: 'Server wurde nicht gefunden.' });
      }
      return res.json({ ok: true, management });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Serverdaten konnten nicht geladen werden.' });
    }
  });

  app.get('/api/guild/:guildId/system-events', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof listDashboardSystemEvents !== 'function') {
      return res.status(501).json({ error: 'Systemereignis-Liste ist nicht konfiguriert.' });
    }

    try {
      const systemEvents = await listDashboardSystemEvents(req.dashboardGuildId, {
        page: req.query.page,
        pageSize: req.query.pageSize,
        filter: req.query.filter,
        refresh: req.query.refresh === '1',
        beforeCreatedAt: req.query.beforeCreatedAt,
        beforeMessageId: req.query.beforeMessageId
      });
      if (!systemEvents) return res.status(404).json({ error: 'Server wurde nicht gefunden.' });
      return res.json({ ok: true, systemEvents });
    } catch (error) {
      console.error('[system-events-dashboard] Systemereignisse konnten nicht geladen werden', error);
      return res.status(500).json({ error: 'Die Systemereignisse konnten nicht geladen werden. Der Bot läuft weiter.' });
    }
  });

  app.get('/api/guild/:guildId/channel/:channelId/messages', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof listGuildMessages !== 'function') {
      return res.status(501).json({ error: 'Kanal-Explorer ist nicht konfiguriert.' });
    }

    try {
      const result = await listGuildMessages(req.dashboardGuildId, req.params.channelId, {
        limit: req.query.limit,
        page: req.query.page,
        before: req.query.before,
        after: req.query.after,
        messageId: req.query.messageId,
        actorUserId: req.dashboardUser.discordId
      });
      if (!result) {
        return res.status(404).json({ error: 'Kanal wurde nicht gefunden.' });
      }
      return res.json({ ok: true, ...result });
    } catch (error) {
      console.error(`[channel-dashboard] Kanalinhalt ${req.dashboardGuildId}/${req.params.channelId} konnte nicht geladen werden`, error);
      return res.status(400).json({ error: error?.message || 'Kanalinhalt konnte nicht geladen werden.' });
    }
  });

  app.patch('/api/guild/:guildId/channel/:channelId', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof updateDashboardChannel !== 'function') return res.status(501).json({ error: 'Kanalverwaltung ist nicht konfiguriert.' });
    try {
      const channel = await updateDashboardChannel(req.dashboardGuildId, req.params.channelId, req.body || {}, req.dashboardUser.discordId);
      return res.json({ ok: true, channel });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Kanal konnte nicht gespeichert werden.' });
    }
  });

  app.patch('/api/guild/:guildId/channel/:channelId/message/:messageId', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof updateDashboardMessage !== 'function') return res.status(501).json({ error: 'Nachrichtenverwaltung ist nicht konfiguriert.' });
    try {
      const message = await updateDashboardMessage(req.dashboardGuildId, req.params.channelId, req.params.messageId, req.body || {}, req.dashboardUser.discordId);
      return res.json({ ok: true, message });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Nachricht konnte nicht bearbeitet werden.' });
    }
  });

  app.delete('/api/guild/:guildId/channel/:channelId/message/:messageId', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof deleteDashboardMessage !== 'function') return res.status(501).json({ error: 'Nachrichtenverwaltung ist nicht konfiguriert.' });
    try {
      await deleteDashboardMessage(req.dashboardGuildId, req.params.channelId, req.params.messageId, req.dashboardUser.discordId);
      return res.json({ ok: true });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Nachricht konnte nicht gelöscht werden.' });
    }
  });

  app.get('/api/guild/:guildId/server-backups', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof listServerBackups !== 'function') {
      return res.status(501).json({ error: 'Server-Backup ist nicht konfiguriert.' });
    }

    try {
      const backups = await listServerBackups(req.dashboardGuildId);
      return res.json({ ok: true, backups });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Backups konnten nicht geladen werden.' });
    }
  });

  app.post('/api/guild/:guildId/server-backups', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof createServerBackup !== 'function') {
      return res.status(501).json({ error: 'Server-Backup ist nicht konfiguriert.' });
    }

    try {
      const result = await createServerBackup(req.dashboardGuildId, req.dashboardUser.discordId);
      return res.status(201).json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Backup konnte nicht erstellt werden.' });
    }
  });

  app.post('/api/guild/:guildId/server-backups/:backupId/preview-restore', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof previewServerRestore !== 'function') {
      return res.status(501).json({ error: 'Server-Backup-Restore ist nicht konfiguriert.' });
    }

    try {
      const result = await previewServerRestore(req.dashboardGuildId, req.params.backupId);
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Restore-Vorschau konnte nicht erstellt werden.' });
    }
  });

  app.post('/api/guild/:guildId/server-backups/:backupId/restore', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof restoreServerBackup !== 'function') {
      return res.status(501).json({ error: 'Server-Backup-Restore ist nicht konfiguriert.' });
    }
    if (req.body?.confirm !== true) {
      return res.status(400).json({ error: 'Restore braucht eine bewusste Bestätigung.' });
    }

    try {
      const result = await restoreServerBackup(req.dashboardGuildId, req.params.backupId, req.body?.options || {}, req.dashboardUser.discordId);
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Backup konnte nicht wiederhergestellt werden.' });
    }
  });

  app.get('/api/guild/:guildId/message-emojis', requireAuth, requireGuildAccess, async (req, res) => {
    try {
      const emojis = typeof options.listMessageEmojis === 'function'
        ? await options.listMessageEmojis(req.params.guildId)
        : [];
      return res.json({ emojis: Array.isArray(emojis) ? emojis : [] });
    } catch (error) {
      return res.status(500).json({ error: error?.message || 'Emojis konnten nicht geladen werden.' });
    }
  });

  app.get('/api/guild/:guildId/channels', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof listTextChannels !== 'function') {
      return res.status(501).json({ error: 'Kanalliste ist nicht konfiguriert.' });
    }

    try {
      const channels = await listTextChannels(req.dashboardGuildId, {
        fresh: String(req.query.fresh || '') === '1'
      });
      return res.json({ ok: true, channels });
    } catch (error) {
      return res.status(500).json({ error: error?.message || 'Kanäle konnten nicht geladen werden.' });
    }
  });

  app.get('/api/guild/:guildId/config-roles', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof listConfigRoles !== 'function') {
      return res.status(501).json({ error: 'Rollenliste ist nicht konfiguriert.' });
    }

    try {
      const roles = await listConfigRoles(req.dashboardGuildId);
      return res.json({ ok: true, roles });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Rollenliste konnte nicht geladen werden.' });
    }
  });

  app.get('/api/guild/:guildId/server-tag-tracker', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof getServerTagTrackerStatus !== 'function') {
      return res.status(501).json({ error: 'Der Server-Tag-Tracker ist nicht konfiguriert.' });
    }
    try {
      const status = await getServerTagTrackerStatus(req.dashboardGuildId);
      return res.json({ ok: true, status });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Der Server-Tag-Status konnte nicht geladen werden.' });
    }
  });

  app.get('/api/guild/:guildId/voice-chat-cleaner', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof getVoiceChatCleanerStatus !== 'function') {
      return res.status(501).json({ error: 'Der Voice-Chat-Cleaner ist nicht konfiguriert.' });
    }
    try {
      const status = await getVoiceChatCleanerStatus(req.dashboardGuildId);
      return res.json({ ok: true, status });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Der Voice-Chat-Cleaner-Status konnte nicht geladen werden.' });
    }
  });

  app.get('/api/guild/:guildId/temp-voice', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof getTempVoiceStatus !== 'function') {
      return res.status(501).json({ error: 'TempVoice ist nicht konfiguriert.' });
    }
    try {
      const status = await getTempVoiceStatus(req.dashboardGuildId);
      return res.json({ ok: true, status });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Der TempVoice-Status konnte nicht geladen werden.' });
    }
  });

  app.delete('/api/guild/:guildId/temp-voice/profiles/:userId', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof removeTempVoiceProfile !== 'function') {
      return res.status(501).json({ error: 'TempVoice-Profile sind nicht konfiguriert.' });
    }
    try {
      const result = await removeTempVoiceProfile(req.dashboardGuildId, String(req.params.userId || ''));
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'TempVoice-Profil konnte nicht zurueckgesetzt werden.' });
    }
  });

  app.delete('/api/guild/:guildId/temp-voice/profiles', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof removeAllTempVoiceProfiles !== 'function') {
      return res.status(501).json({ error: 'TempVoice-Profile sind nicht konfiguriert.' });
    }
    try {
      const result = await removeAllTempVoiceProfiles(req.dashboardGuildId);
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'TempVoice-Profile konnten nicht zurueckgesetzt werden.' });
    }
  });

  app.put('/api/guild/:guildId/temp-voice/design', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof saveTempVoiceInterfaceDesign !== 'function') {
      return res.status(501).json({ error: 'Der TempVoice-Embed-Editor ist nicht konfiguriert.' });
    }
    try {
      const result = await saveTempVoiceInterfaceDesign(req.dashboardGuildId, req.body || {});
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Das TempVoice-Embed konnte nicht gespeichert werden.' });
    }
  });

  app.get('/api/guild/:guildId/public-call-vote', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof getPublicCallVoteStatus !== 'function') {
      return res.status(501).json({ error: 'Public-Call-Moderation ist nicht konfiguriert.' });
    }
    try {
      const status = await getPublicCallVoteStatus(req.dashboardGuildId);
      return res.json({ ok: true, status });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Der Public-Call-Vote-Status konnte nicht geladen werden.' });
    }
  });

  app.get('/api/guild/:guildId/public-call-vote/locks', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof getPublicCallVoteLocks !== 'function') {
      return res.status(501).json({ error: 'Public-Call-Moderation ist nicht konfiguriert.' });
    }
    try {
      const result = await getPublicCallVoteLocks(req.dashboardGuildId);
      return res.json({ ok: true, locks: result?.locks || [] });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Die Call-Sperren konnten nicht geladen werden.' });
    }
  });

  app.delete('/api/guild/:guildId/public-call-vote/locks/:userId', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof removePublicCallVoteLock !== 'function') {
      return res.status(501).json({ error: 'Public-Call-Moderation ist nicht konfiguriert.' });
    }
    try {
      const result = await removePublicCallVoteLock(req.dashboardGuildId, String(req.params.userId || ''));
      if (!result?.ok) return res.status(404).json({ error: 'Keine aktive Call-Sperre für diesen Spieler gefunden.' });
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Die Call-Sperre konnte nicht aufgehoben werden.' });
    }
  });

  app.put('/api/guild/:guildId/public-call-vote/design', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof savePublicCallVoteDesign !== 'function') {
      return res.status(501).json({ error: 'Der Design-Editor der Call-Moderation ist nicht konfiguriert.' });
    }
    try {
      const result = await savePublicCallVoteDesign(req.dashboardGuildId, req.body || {}, req.dashboardUser.discordId);
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Das Design der Call-Moderation konnte nicht gespeichert werden.' });
    }
  });

  app.get('/api/guild/:guildId/forum-cleaner', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof getForumCleanerStatus !== 'function') {
      return res.status(501).json({ error: 'Der Forum-Cleaner ist nicht konfiguriert.' });
    }
    try {
      const status = await getForumCleanerStatus(req.dashboardGuildId);
      return res.json({ ok: true, status });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Der Forum-Cleaner-Status konnte nicht geladen werden.' });
    }
  });

  app.post('/api/guild/:guildId/forum-cleaner/scan', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof scanForumCleaner !== 'function') {
      return res.status(501).json({ error: 'Der Forum-Tiefenscan ist nicht konfiguriert.' });
    }
    try {
      const result = await scanForumCleaner(req.dashboardGuildId, req.dashboardUser.discordId);
      return res.status(202).json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Der Forum-Tiefenscan konnte nicht gestartet werden.' });
    }
  });

  app.post('/api/guild/:guildId/levels/wipe-roles', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof wipeLevelRoles !== 'function') {
      return res.status(501).json({ error: 'Der Level-Rollen-Wipe ist nicht konfiguriert.' });
    }
    try {
      const result = await wipeLevelRoles(req.dashboardGuildId);
      return res.status(result?.ok === false ? 400 : 200).json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Der Level-Rollen-Wipe konnte nicht ausgeführt werden.' });
    }
  });

  app.post('/api/guild/:guildId/levels/grant-all', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof grantLevelRolesToAll !== 'function') {
      return res.status(501).json({ error: 'Die Level-Rollen-Massenvergabe ist nicht konfiguriert.' });
    }
    try {
      const result = await grantLevelRolesToAll(req.dashboardGuildId);
      return res.status(result?.ok === false ? 400 : 200).json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Die Level-Rollen konnten nicht vergeben werden.' });
    }
  });

  app.post('/api/guild/:guildId/levels/set-level', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof setMemberLevel !== 'function') {
      return res.status(501).json({ error: 'Das manuelle Level-Setzen ist nicht konfiguriert.' });
    }
    const userId = String(req.body?.userId || '').trim();
    const level = Math.max(0, Math.floor(Number(req.body?.level) || 0));
    if (!userId) return res.status(400).json({ error: 'Es fehlt die Mitglieds-ID.' });
    try {
      const result = await setMemberLevel(req.dashboardGuildId, userId, level);
      return res.status(result?.ok === false ? 400 : 200).json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Das Level konnte nicht gesetzt werden.' });
    }
  });

  app.get('/api/guild/:guildId/steam-workshop', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof getSteamWorkshopStatus !== 'function') return res.status(501).json({ error: 'Steam Workshop ist nicht konfiguriert.' });
    try {
      const status = await getSteamWorkshopStatus(req.dashboardGuildId);
      return res.json({ ok: true, status });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Der Workshop-Status konnte nicht geladen werden.' });
    }
  });

  app.post('/api/guild/:guildId/steam-workshop/sync', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof syncSteamWorkshop !== 'function') return res.status(501).json({ error: 'Der Steam-Abgleich ist nicht konfiguriert.' });
    try {
      const result = await syncSteamWorkshop(req.dashboardGuildId, req.dashboardUser.discordId);
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Der Workshop-Katalog konnte nicht synchronisiert werden.' });
    }
  });

  app.put('/api/guild/:guildId/steam-workshop/design', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof saveSteamWorkshopDesign !== 'function') return res.status(501).json({ error: 'Der Workshop-Editor ist nicht konfiguriert.' });
    try {
      const result = await saveSteamWorkshopDesign(req.dashboardGuildId, req.body || {}, req.dashboardUser.discordId);
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Die Workshop-Vorlage konnte nicht gespeichert werden.' });
    }
  });

  app.put('/api/guild/:guildId/steam-workshop/items/:workshopId/design', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof saveSteamWorkshopItemDesign !== 'function') return res.status(501).json({ error: 'Der individuelle Workshop-Editor ist nicht konfiguriert.' });
    try {
      const result = await saveSteamWorkshopItemDesign(req.dashboardGuildId, req.params.workshopId, req.body || {}, req.dashboardUser.discordId);
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Der Workshop-Post konnte nicht gespeichert werden.' });
    }
  });

  app.delete('/api/guild/:guildId/steam-workshop/items/:workshopId/design', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof resetSteamWorkshopItemDesign !== 'function') return res.status(501).json({ error: 'Das Zurücksetzen einzelner Workshop-Posts ist nicht konfiguriert.' });
    try {
      const result = await resetSteamWorkshopItemDesign(req.dashboardGuildId, req.params.workshopId, req.dashboardUser.discordId);
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Der Workshop-Post konnte nicht auf die Standardvorlage zurückgesetzt werden.' });
    }
  });

  app.get('/api/guild/:guildId/emoji-manager', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof getEmojiManagerStatus !== 'function') {
      return res.status(501).json({ error: 'Die Emoji-Verwaltung ist nicht konfiguriert.' });
    }
    try {
      const status = await getEmojiManagerStatus(req.dashboardGuildId);
      return res.json({ ok: true, status });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Der Emoji-Status konnte nicht geladen werden.' });
    }
  });

  app.get('/api/guild/:guildId/activity-race', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof getActivityRaceStatus !== 'function') return res.status(501).json({ error: 'Die Aktivitäts-Liga ist nicht konfiguriert.' });
    try {
      const status = await getActivityRaceStatus(req.dashboardGuildId);
      return res.json({ ok: true, status });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Die Aktivitäts-Liga konnte nicht geladen werden.' });
    }
  });

  app.get('/api/guild/:guildId/counting', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof getCountingStats !== 'function') return res.status(501).json({ error: 'Der Zähl-Kanal ist nicht konfiguriert.' });
    try {
      const stats = await getCountingStats(req.dashboardGuildId);
      return res.json({ ok: true, stats });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Der Zähl-Kanal konnte nicht geladen werden.' });
    }
  });

  app.get('/api/guild/:guildId/counting/locks', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof getCountingLocks !== 'function') return res.status(501).json({ error: 'Der Zähl-Kanal ist nicht konfiguriert.' });
    try {
      const result = await getCountingLocks(req.dashboardGuildId);
      return res.json({ ok: true, locks: result?.locks || [] });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Die Sperren konnten nicht geladen werden.' });
    }
  });

  app.delete('/api/guild/:guildId/counting/locks/:userId', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof removeCountingLock !== 'function') return res.status(501).json({ error: 'Der Zähl-Kanal ist nicht konfiguriert.' });
    try {
      const result = await removeCountingLock(req.dashboardGuildId, String(req.params.userId || ''));
      if (!result?.ok) return res.status(404).json({ error: 'Keine aktive Sperre für diesen Spieler gefunden.' });
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Die Sperre konnte nicht aufgehoben werden.' });
    }
  });

  app.post('/api/guild/:guildId/counting/reset', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof resetCounting !== 'function') return res.status(501).json({ error: 'Der Zähl-Kanal ist nicht konfiguriert.' });
    try {
      const result = await resetCounting(req.dashboardGuildId, String(req.dashboardUser?.discordId || req.dashboardUser?.sub || ''));
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Der Zähl-Kanal konnte nicht zurückgesetzt werden.' });
    }
  });

  app.post('/api/guild/:guildId/activity-race/roles/preview', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof previewActivityRaceRoles !== 'function') return res.status(501).json({ error: 'Die Rollenvorschau ist nicht konfiguriert.' });
    try {
      const preview = await previewActivityRaceRoles(req.dashboardGuildId, req.body || {});
      return res.json({ ok: true, preview });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Das Rollenset konnte nicht geprüft werden.' });
    }
  });

  app.post('/api/guild/:guildId/activity-race/roles/create', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof createActivityRaceRoles !== 'function') return res.status(501).json({ error: 'Die Rollenerstellung ist nicht konfiguriert.' });
    try {
      const result = await createActivityRaceRoles(req.dashboardGuildId, req.body || {}, req.dashboardUser.discordId);
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Das Rollenset konnte nicht erstellt werden.' });
    }
  });

  app.post('/api/guild/:guildId/activity-race/refresh', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof refreshActivityRace !== 'function') return res.status(501).json({ error: 'Der Abgleich der Aktivitäts-Liga ist nicht konfiguriert.' });
    try {
      const result = await refreshActivityRace(req.dashboardGuildId, req.dashboardUser.discordId);
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Die Aktivitäts-Liga konnte nicht aktualisiert werden.' });
    }
  });

  app.put('/api/guild/:guildId/activity-race/design', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof saveActivityRaceDesign !== 'function') return res.status(501).json({ error: 'Der Aktivitäts-Liga-Editor ist nicht konfiguriert.' });
    try {
      const result = await saveActivityRaceDesign(req.dashboardGuildId, req.body || {}, req.dashboardUser.discordId);
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Die Aktivitäts-Liga-Vorlage konnte nicht gespeichert werden.' });
    }
  });

  app.post('/api/guild/:guildId/emoji-manager/preview', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof previewEmojiRename !== 'function') {
      return res.status(501).json({ error: 'Die Emoji-Vorschau ist nicht konfiguriert.' });
    }
    try {
      const preview = await previewEmojiRename(req.dashboardGuildId, req.body || {});
      return res.json({ ok: true, preview });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Die Emoji-Vorschau konnte nicht erstellt werden.' });
    }
  });

  app.post('/api/guild/:guildId/emoji-manager/apply', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof applyEmojiRename !== 'function') {
      return res.status(501).json({ error: 'Die Emoji-Umbenennung ist nicht konfiguriert.' });
    }
    try {
      const result = await applyEmojiRename(req.dashboardGuildId, req.body || {}, req.dashboardUser.discordId);
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Die Emoji-Umbenennung konnte nicht durchgeführt werden.' });
    }
  });

  app.post('/api/guild/:guildId/server-tag-tracker/sync', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof syncServerTagTracker !== 'function') {
      return res.status(501).json({ error: 'Der Server-Tag-Abgleich ist nicht konfiguriert.' });
    }
    try {
      const result = await syncServerTagTracker(req.dashboardGuildId, req.dashboardUser.discordId);
      return res.status(202).json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Der Server-Tag-Abgleich konnte nicht gestartet werden.' });
    }
  });

  app.get('/api/guild/:guildId/role/:roleId', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof getDashboardRole !== 'function') return res.status(501).json({ error: 'Rollenverwaltung ist nicht konfiguriert.' });
    try {
      const role = await getDashboardRole(req.dashboardGuildId, req.params.roleId, req.dashboardUser.discordId);
      if (!role) return res.status(404).json({ error: 'Rolle wurde nicht gefunden.' });
      return res.json({ ok: true, role });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Rolle konnte nicht geladen werden.' });
    }
  });

  app.patch('/api/guild/:guildId/role/:roleId', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof updateDashboardRole !== 'function') return res.status(501).json({ error: 'Rollenverwaltung ist nicht konfiguriert.' });
    try {
      const role = await updateDashboardRole(req.dashboardGuildId, req.params.roleId, req.body || {}, req.dashboardUser.discordId);
      return res.json({ ok: true, role });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Rolle konnte nicht gespeichert werden.' });
    }
  });

  app.get('/api/guild/:guildId/boost-role-progress', requireAuth, requireGuildAccess, async (req, res) => {
    const status = typeof getBoostSystemIndexStatus === 'function'
      ? await Promise.resolve(getBoostSystemIndexStatus(req.dashboardGuildId))
      : { running: false, phase: 'idle', progress: 0, detail: 'Status nicht verfügbar.' };
    return res.json({ ok: true, status });
  });

  app.post('/api/guild/:guildId/boost-role-sync', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof syncBoostRoles !== 'function') return res.status(501).json({ error: 'Der Booster-Rollenabgleich ist nicht konfiguriert.' });
    try {
      const result = await syncBoostRoles(req.dashboardGuildId, req.dashboardUser.discordId);
      return res.status(202).json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Der Booster-Rollenabgleich konnte nicht gestartet werden.' });
    }
  });

  app.post('/api/guild/:guildId/boost-role-verify', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof verifyBoostCount !== 'function') return res.status(501).json({ error: 'Die automatische Discord-Boost-Prüfung ist nicht konfiguriert.' });
    try {
      const result = await verifyBoostCount(req.dashboardGuildId, req.body || {}, req.dashboardUser.discordId);
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Die Boost-Anzahl konnte nicht automatisch geprüft werden.' });
    }
  });

  app.post('/api/guild/:guildId/boost-activity-preview', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof previewBoostActivityImport !== 'function') return res.status(501).json({ error: 'Der Boost-Aktivitätsimport ist nicht konfiguriert.' });
    try {
      const result = await previewBoostActivityImport(req.dashboardGuildId, req.body || {});
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Die Boost-Aktivitätsliste konnte nicht geprüft werden.' });
    }
  });

  app.post('/api/guild/:guildId/boost-activity-import', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof importBoostActivityList !== 'function') return res.status(501).json({ error: 'Der Boost-Aktivitätsimport ist nicht konfiguriert.' });
    try {
      const result = await importBoostActivityList(req.dashboardGuildId, req.body || {}, req.dashboardUser.discordId);
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Die Boost-Aktivitätsliste konnte nicht importiert werden.' });
    }
  });

  app.post('/api/guild/:guildId/boost-baseline-member', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof updateBoostBaselineMember !== 'function') return res.status(501).json({ error: 'Die Boost-Basisverwaltung ist nicht konfiguriert.' });
    try {
      const result = await updateBoostBaselineMember(req.dashboardGuildId, req.body || {}, req.dashboardUser.discordId);
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Der Basisstand des Mitglieds konnte nicht gespeichert werden.' });
    }
  });

  app.get('/api/guild/:guildId/boost-top', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof getBoostTopStatus !== 'function') return res.status(501).json({ error: 'Die Top-Booster-Liga ist nicht konfiguriert.' });
    try {
      const status = await getBoostTopStatus(req.dashboardGuildId);
      return res.json({ ok: true, status });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Die Top-Booster-Liga konnte nicht geladen werden.' });
    }
  });

  app.post('/api/guild/:guildId/boost-top/refresh', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof refreshBoostTopPanel !== 'function') return res.status(501).json({ error: 'Die Top-Booster-Liga ist nicht konfiguriert.' });
    try {
      const result = await refreshBoostTopPanel(req.dashboardGuildId);
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Das Top-Booster-Panel konnte nicht aktualisiert werden.' });
    }
  });

  app.put('/api/guild/:guildId/boost-top/design', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof saveBoostTopDesign !== 'function') return res.status(501).json({ error: 'Der Top-Booster-Editor ist nicht konfiguriert.' });
    try {
      const result = await saveBoostTopDesign(req.dashboardGuildId, req.body || {}, req.dashboardUser.discordId);
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Die Top-Booster-Vorlage konnte nicht gespeichert werden.' });
    }
  });

  app.get('/api/guild/:guildId/heaven-economy', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof getHeavenEconomyAdmin !== 'function') {
      return res.status(501).json({ error: 'Die VIP- und Coin-Verwaltung ist nicht konfiguriert.' });
    }
    try {
      const economy = await getHeavenEconomyAdmin(req.dashboardGuildId, {
        query: req.query.query,
        filter: req.query.filter,
        page: req.query.page,
        pageSize: req.query.pageSize,
        syncMembers: req.query.sync === '1'
      });
      return res.json({ ok: true, economy });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Die VIP- und Coin-Daten konnten nicht geladen werden.' });
    }
  });

  app.patch('/api/guild/:guildId/heaven-economy/account', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof updateHeavenEconomyAdmin !== 'function') {
      return res.status(501).json({ error: 'Die VIP- und Coin-Verwaltung ist nicht konfiguriert.' });
    }
    try {
      const result = await updateHeavenEconomyAdmin(req.dashboardGuildId, req.body || {}, req.dashboardUser.discordId);
      return res.json({ ok: true, result });
    } catch (error) {
      const conflict = error?.code === 'ECONOMY_REVISION_CONFLICT';
      return res.status(conflict ? 409 : 400).json({ error: error?.message || 'Die VIP- und Coin-Daten konnten nicht gespeichert werden.' });
    }
  });

  app.post('/api/guild/:guildId/heaven-economy/reconcile', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof reconcileHeavenEconomyAdmin !== 'function') {
      return res.status(501).json({ error: 'Der VIP- und Coin-Abgleich ist nicht konfiguriert.' });
    }
    try {
      const result = await reconcileHeavenEconomyAdmin(req.dashboardGuildId, req.dashboardUser.discordId);
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Der VIP- und Coin-Abgleich konnte nicht ausgeführt werden.' });
    }
  });

  app.get('/api/guild/:guildId/vip-panels', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof getVipPanelStatus !== 'function') return res.status(501).json({ error: 'Die VIP-Panels sind nicht konfiguriert.' });
    try {
      const status = await getVipPanelStatus(req.dashboardGuildId);
      return res.json({ ok: true, status });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Die VIP-Panels konnten nicht geladen werden.' });
    }
  });

  app.post('/api/guild/:guildId/vip-panels/refresh', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof refreshVipPanels !== 'function') return res.status(501).json({ error: 'Die VIP-Panels sind nicht konfiguriert.' });
    try {
      const result = await refreshVipPanels(req.dashboardGuildId);
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Die VIP-Panels konnten nicht aktualisiert werden.' });
    }
  });

  app.put('/api/guild/:guildId/vip-panels/design', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof saveVipPanelDesign !== 'function') return res.status(501).json({ error: 'Der VIP-Panel-Editor ist nicht konfiguriert.' });
    try {
      const result = await saveVipPanelDesign(req.dashboardGuildId, req.body || {}, req.dashboardUser.discordId);
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Die VIP-Panel-Vorlage konnte nicht gespeichert werden.' });
    }
  });

  app.put('/api/guild/:guildId/heaven-economy/dm-design', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof saveEconomyDmDesign !== 'function') return res.status(501).json({ error: 'Der DM-Editor von Heaven Economy ist nicht konfiguriert.' });
    try {
      const result = await saveEconomyDmDesign(req.dashboardGuildId, req.body || {});
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Die VIP-DM-Vorlage konnte nicht gespeichert werden.' });
    }
  });

  app.put('/api/guild/:guildId/heaven-economy/panel-design', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof saveHeavenEconomyPanelDesign !== 'function') return res.status(501).json({ error: 'Der VIP-Vorteile-Panel-Editor ist nicht konfiguriert.' });
    try {
      const result = await saveHeavenEconomyPanelDesign(req.dashboardGuildId, req.body || {});
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Das VIP-Vorteile-Panel konnte nicht gespeichert werden.' });
    }
  });

  app.post('/api/guild/:guildId/heaven-economy/separator-sync', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof syncVipSeparatorRole !== 'function') return res.status(501).json({ error: 'Die VIP-Trennerrolle ist nicht konfiguriert.' });
    try {
      const result = await syncVipSeparatorRole(req.dashboardGuildId);
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Die VIP-Trennerrolle konnte nicht abgeglichen werden.' });
    }
  });

  app.get('/api/guild/:guildId/members', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof listDashboardMembers !== 'function') {
      return res.status(501).json({ error: 'Memberliste ist nicht konfiguriert.' });
    }

    try {
      const result = await listDashboardMembers(req.dashboardGuildId, {
        query: req.query.query,
        page: req.query.page,
        pageSize: req.query.pageSize,
        filter: req.query.filter,
        sort: req.query.sort,
        sync: req.query.sync === '1'
      });

      if (!result) {
        return res.status(404).json({ error: 'Server wurde nicht gefunden.' });
      }

      return res.json({ ok: true, ...result });
    } catch (error) {
      console.error('[member-dashboard] Mitgliederliste konnte nicht geladen werden', error);
      if (res.headersSent) return undefined;
      const transient = ['ECONNRESET', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(String(error?.code || ''));
      return res.status(transient ? 503 : 500).json({
        error: transient
          ? 'Discord ist kurzzeitig nicht erreichbar. Die Mitgliederliste kann erneut geladen werden.'
          : 'Die Mitgliederliste konnte nicht geladen werden. Der Bot läuft weiter.'
      });
    }
  });

  app.get('/api/guild/:guildId/member/:userId', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof getDashboardMember !== 'function') {
      return res.status(501).json({ error: 'Memberdetails sind nicht konfiguriert.' });
    }

    try {
      const member = await getDashboardMember(req.dashboardGuildId, req.params.userId, req.dashboardUser.discordId, {
        refresh: String(req.query.refresh || '') === '1'
      });
      if (!member) return res.status(404).json({ error: 'Member wurde nicht gefunden.' });
      return res.json({ ok: true, member });
    } catch (error) {
      console.error('[member-dashboard] Mitgliedsprofil konnte nicht geladen werden', error);
      if (res.headersSent) return undefined;
      return res.status(500).json({
        error: 'Das Mitgliedsprofil konnte nicht geladen werden. Der Bot läuft weiter; die Profilanalyse wird beim nächsten Aufruf sicher fortgesetzt.'
      });
    }
  });

  app.get('/api/guild/:guildId/member/:userId/intelligence-status', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof getMemberIntelligenceStatus !== 'function') {
      return res.status(501).json({ error: 'Analysestatus ist nicht konfiguriert.' });
    }
    try {
      const intelligence = await getMemberIntelligenceStatus(req.dashboardGuildId, req.params.userId, req.dashboardUser.discordId);
      return res.json({ ok: true, intelligence });
    } catch (error) {
      return res.status(500).json({ error: error?.message || 'Analysestatus konnte nicht geladen werden.' });
    }
  });

  app.post('/api/guild/:guildId/member/:userId/action', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof moderateDashboardMember !== 'function') {
      return res.status(501).json({ error: 'Moderationsaktionen sind nicht konfiguriert.' });
    }

    try {
      const result = await moderateDashboardMember(
        req.dashboardGuildId,
        req.params.userId,
        req.body || {},
        req.dashboardUser.discordId
      );
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Moderationsaktion konnte nicht ausgeführt werden.' });
    }
  });

  app.post('/api/guild/:guildId/embed/send', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof sendGuildEmbed !== 'function') {
      return res.status(501).json({ error: 'Embed-Versand ist nicht konfiguriert.' });
    }

    try {
      const result = await sendGuildEmbed(req.dashboardGuildId, req.body?.template || req.body || {});
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Embed konnte nicht gesendet werden.' });
    }
  });

  app.post('/api/guild/:guildId/embed/edit', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof editGuildEmbed !== 'function') {
      return res.status(501).json({ error: 'Embed-Bearbeitung ist nicht konfiguriert.' });
    }

    try {
      const result = await editGuildEmbed(req.dashboardGuildId, req.body?.template || req.body || {});
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Embed konnte nicht bearbeitet werden.' });
    }
  });

  app.put('/api/guild/:guildId/member-verify/design', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof saveVerifyPanelDesign !== 'function') {
      return res.status(501).json({ error: 'Der Verify-Embed-Editor ist nicht konfiguriert.' });
    }

    try {
      const result = await saveVerifyPanelDesign(req.dashboardGuildId, req.body || {});
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Das Verify-Embed konnte nicht gespeichert werden.' });
    }
  });

  app.post('/api/guild/:guildId/studio-image', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof uploadStudioImage !== 'function') {
      return res.status(501).json({ error: 'Der lokale Bild-Upload ist nicht konfiguriert.' });
    }

    try {
      const result = await uploadStudioImage(req.dashboardGuildId, req.body || {});
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Das Bild konnte nicht gespeichert werden.' });
    }
  });

  app.put('/api/guild/:guildId/levels/design', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof saveLevelsPanelDesign !== 'function') {
      return res.status(501).json({ error: 'Der Levelrollen-Panel-Editor ist nicht konfiguriert.' });
    }

    try {
      const result = await saveLevelsPanelDesign(req.dashboardGuildId, req.body || {});
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Das Levelrollen-Panel konnte nicht gespeichert werden.' });
    }
  });

  app.put('/api/guild/:guildId/levels/info-design', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof saveLevelUpInfoDesign !== 'function') {
      return res.status(501).json({ error: 'Der Kanal-Info-Editor ist nicht konfiguriert.' });
    }

    try {
      const result = await saveLevelUpInfoDesign(req.dashboardGuildId, req.body || {});
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Das Kanal-Info-Embed konnte nicht gespeichert werden.' });
    }
  });

  app.put('/api/guild/:guildId/counting/design', requireAuth, requireGuildAccess, async (req, res) => {
    const section = String(req.body?.section || '');
    const isDmSection = section === 'strikeLock' || section === 'strikeRelease';
    if (isDmSection && typeof saveCountingDesign !== 'function') {
      return res.status(501).json({ error: 'Der DM-Editor des Zähl-Kanals ist nicht konfiguriert.' });
    }
    if (!isDmSection && typeof saveCountingPanelDesign !== 'function') {
      return res.status(501).json({ error: 'Der Zähl-Kanal-Panel-Editor ist nicht konfiguriert.' });
    }

    try {
      const result = isDmSection
        ? await saveCountingDesign(req.dashboardGuildId, req.body || {})
        : await saveCountingPanelDesign(req.dashboardGuildId, req.body || {});
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Das Zähl-Kanal-Design konnte nicht gespeichert werden.' });
    }
  });

  app.put('/api/guild/:guildId/bot-updates/design', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof saveBotUpdatesDesign !== 'function') {
      return res.status(501).json({ error: 'Der Bot-Updates-Editor ist nicht konfiguriert.' });
    }

    try {
      const result = await saveBotUpdatesDesign(req.dashboardGuildId, req.body || {});
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Das Bot-Updates-Panel konnte nicht gespeichert werden.' });
    }
  });

  app.get('/api/guild/:guildId/inactive-reminder', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof getInactiveReminderStatus !== 'function') {
      return res.status(501).json({ error: 'Die Inaktivitäts-Erinnerung ist nicht konfiguriert.' });
    }
    try {
      const result = await getInactiveReminderStatus(req.dashboardGuildId, {
        page: Number(req.query.page || 0),
        pageSize: Number(req.query.pageSize || 25)
      });
      return res.json({ ok: true, status: result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Status konnte nicht geladen werden.' });
    }
  });

  app.post('/api/guild/:guildId/inactive-reminder/send-manual', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof sendManualInactiveReminder !== 'function') {
      return res.status(501).json({ error: 'Die Inaktivitäts-Erinnerung ist nicht konfiguriert.' });
    }
    try {
      const userId = String(req.body?.userId || '').trim();
      if (!userId) return res.status(400).json({ error: 'Mitglied-ID fehlt.' });
      const result = await sendManualInactiveReminder(req.dashboardGuildId, userId);
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'DM konnte nicht gesendet werden.' });
    }
  });

  app.post('/api/guild/:guildId/inactive-reminder/scan', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof runInactiveReminderScan !== 'function') {
      return res.status(501).json({ error: 'Die Inaktivitäts-Erinnerung ist nicht konfiguriert.' });
    }
    try {
      const result = await runInactiveReminderScan(req.dashboardGuildId, req.dashboardUser?.discordId || '');
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Scan fehlgeschlagen.' });
    }
  });

  app.post('/api/guild/:guildId/inactive-reminder/preview', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof runInactiveReminderPreview !== 'function') {
      return res.status(501).json({ error: 'Die Inaktivitäts-Erinnerung ist nicht konfiguriert.' });
    }
    try {
      const result = await runInactiveReminderPreview(req.dashboardGuildId, req.dashboardUser?.discordId || '');
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Vorschau fehlgeschlagen.' });
    }
  });

  app.post('/api/guild/:guildId/inactive-reminder/send', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof runInactiveReminderSend !== 'function') {
      return res.status(501).json({ error: 'Die Inaktivitäts-Erinnerung ist nicht konfiguriert.' });
    }
    try {
      const userIds = Array.isArray(req.body?.userIds) ? req.body.userIds : [];
      if (!userIds.length) return res.status(400).json({ error: 'Keine Mitglieder ausgewählt.' });
      const result = await runInactiveReminderSend(req.dashboardGuildId, req.dashboardUser?.discordId || '', userIds);
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Senden fehlgeschlagen.' });
    }
  });

  app.post('/api/guild/:guildId/inactive-reminder/delete-dm', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof deleteReminderDm !== 'function') {
      return res.status(501).json({ error: 'Die Inaktivitäts-Erinnerung ist nicht konfiguriert.' });
    }
    try {
      const userId = String(req.body?.userId || '').trim();
      if (!userId) return res.status(400).json({ error: 'Mitglied fehlt.' });
      const result = await deleteReminderDm(req.dashboardGuildId, userId);
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'DM konnte nicht gelöscht werden.' });
    }
  });

  app.post('/api/guild/:guildId/inactive-reminder/delete-all-dms', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof deleteAllReminderDms !== 'function') {
      return res.status(501).json({ error: 'Die Inaktivitäts-Erinnerung ist nicht konfiguriert.' });
    }
    try {
      const result = await deleteAllReminderDms(req.dashboardGuildId);
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'DMs konnten nicht gelöscht werden.' });
    }
  });

  app.post('/api/guild/:guildId/inactive-reminder/cleanup-responded', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof cleanupInactiveReminderDms !== 'function') {
      return res.status(501).json({ error: 'Die Inaktivitäts-Erinnerung ist nicht konfiguriert.' });
    }
    try {
      const result = await cleanupInactiveReminderDms(req.dashboardGuildId);
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Bereinigung fehlgeschlagen.' });
    }
  });

  app.get('/api/guild/:guildId/voice-log-import', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof getVoiceLogImportStatus !== 'function') {
      return res.status(501).json({ error: 'Der Carl-bot Voice-Log-Import ist nicht konfiguriert.' });
    }
    try {
      const result = await getVoiceLogImportStatus(req.dashboardGuildId);
      return res.json({ ok: true, status: result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Status konnte nicht geladen werden.' });
    }
  });

  app.post('/api/guild/:guildId/voice-log-import/backfill', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof runVoiceLogBackfill !== 'function') {
      return res.status(501).json({ error: 'Der Carl-bot Voice-Log-Import ist nicht konfiguriert.' });
    }
    try {
      const result = await runVoiceLogBackfill(req.dashboardGuildId);
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Backfill fehlgeschlagen.' });
    }
  });

  app.get('/api/guild/:guildId/voice-log-events', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof getVoiceLogEvents !== 'function') {
      return res.status(501).json({ error: 'Der Carl-bot Voice-Log-Import ist nicht konfiguriert.' });
    }
    try {
      const limit = Math.min(Math.max(1, Number(req.query.limit) || 50), 100);
      let cursor = null;
      if (req.query.cursor) {
        try {
          cursor = JSON.parse(req.query.cursor);
        } catch { cursor = null; }
      }
      const result = await getVoiceLogEvents(req.dashboardGuildId, { limit, cursor });
      return res.json({ ok: true, ...result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Voice-Events konnten nicht geladen werden.' });
    }
  });

  app.put('/api/guild/:guildId/inactive-reminder/design', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof saveInactiveReminderDesign !== 'function') {
      return res.status(501).json({ error: 'Der Inaktivitäts-Erinnerung-Editor ist nicht konfiguriert.' });
    }
    try {
      const result = await saveInactiveReminderDesign(req.dashboardGuildId, req.body || {});
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Das Erinnerungs-Embed konnte nicht gespeichert werden.' });
    }
  });

  app.get('/api/guild/:guildId/role-saver', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof getRoleSaverStatus !== 'function') {
      return res.status(501).json({ error: 'Der Rollen-Saver ist nicht konfiguriert.' });
    }

    try {
      const result = await getRoleSaverStatus(req.dashboardGuildId);
      return res.json({ ok: true, status: result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Rollen-Saver-Status konnte nicht geladen werden.' });
    }
  });

  app.get('/api/guild/:guildId/role-saver/member/:userId', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof getSavedRolesForMember !== 'function') {
      return res.status(501).json({ error: 'Der Rollen-Saver ist nicht konfiguriert.' });
    }

    try {
      const result = await getSavedRolesForMember(req.dashboardGuildId, req.params.userId);
      return res.json({ ok: true, saved: result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Gespeicherte Rollen konnten nicht geladen werden.' });
    }
  });

  app.delete('/api/guild/:guildId/role-saver/member/:userId', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof clearSavedRolesForMember !== 'function') {
      return res.status(501).json({ error: 'Der Rollen-Saver ist nicht konfiguriert.' });
    }

    try {
      const result = await clearSavedRolesForMember(req.dashboardGuildId, req.params.userId);
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Gespeicherte Rollen konnten nicht entfernt werden.' });
    }
  });

  app.post('/api/guild/:guildId/thread/create', requireAuth, requireGuildAccess, async (req, res) => {
    if (typeof createGuildThread !== 'function') {
      return res.status(501).json({ error: 'Thread-Erstellung ist nicht konfiguriert.' });
    }

    try {
      const result = await createGuildThread(req.dashboardGuildId, req.body || {});
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Thread konnte nicht erstellt werden.' });
    }
  });

  const runSystemAction = async (action, req, res) => {
    if (!systemActions || typeof systemActions[action] !== 'function') {
      return res.status(501).json({ error: 'Systemsteuerung nicht konfiguriert' });
    }

    if (action === 'restart') {
      res.json({
        ok: true,
        action,
        running: null,
        message: 'Neustart wurde ausgelöst. Das Dashboard ist gleich wieder erreichbar.'
      });

      setTimeout(() => {
        systemActions.restart().catch((error) => {
          console.error('Systemneustart fehlgeschlagen', error);
        });
      }, 750);
      return;
    }

    try {
      const result = await systemActions[action]();
      return res.json({
        ok: true,
        action,
        ...(result || {})
      });
    } catch (error) {
      return res.status(500).json({ error: error?.message || 'Systembefehl fehlgeschlagen' });
    }
  };

  app.get('/api/system/status', requireAuth, (req, res) => runSystemAction('status', req, res));
  app.post('/api/system/start', requireAuth, (req, res) => runSystemAction('start', req, res));
  app.post('/api/system/stop', requireAuth, (req, res) => runSystemAction('stop', req, res));
  app.post('/api/system/restart', requireAuth, (req, res) => runSystemAction('restart', req, res));
};
