const { app, BrowserWindow, dialog, ipcMain, nativeTheme, safeStorage, session, shell } = require('electron');

// Mini-PC-freundlich: weniger CPU-Wakeups bei verdeckten/verkleinerten Fenstern
// (CalculateNativeWinOcclusion ist ein bekannter Windows-CPU-Hotspot).
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
// Hinweis: Hardware-Beschleunigung bleibt bewusst AKTIV – auf schwachen CPUs
// (Mini-PC) ist SwiftShader-Software-Rendering langsamer als die iGPU. Die
// teuren Blur-/Filter-Effekte werden stattdessen über performance.css
// (data-motion="off" / low-power) abgeschaltet, die einfache Kompositierung
// übernimmt weiterhin die GPU.
const { BotProcessSupervisor } = require('./process-supervisor.cjs');
const { buildUpdateRunnerScript, checkForUpdate, findUpdateArtifact, isVersionNewer, verifyArtifactSha512 } = require('./update-check.cjs');
const {
  buildAuthHeaders,
  buildReleasesApiUrl,
  describeManifestExpectation,
  describeUpdateSource,
  normalizeRepoTarget,
  resolveReleaseUpdate,
  tokenHint
} = require('./update-source.cjs');
const { execFile, execFileSync, spawn } = require('node:child_process');
const crypto = require('node:crypto');
const { appendFileSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } = require('node:fs');
const fsPromises = require('node:fs/promises');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const APP_NAME = 'FALLEN HEAVEN Control Center';
app.setAppUserModelId('de.fallenheaven.discordbot');
app.setPath('userData', path.join(app.getPath('appData'), APP_NAME));
const CANONICAL_DASHBOARD_PORT = 3000;
const CANONICAL_DASHBOARD_HOST = '127.0.0.1';
const CANONICAL_DASHBOARD_ORIGIN = `http://${CANONICAL_DASHBOARD_HOST}:${CANONICAL_DASHBOARD_PORT}`;
const CANONICAL_DISCORD_REDIRECT_URI = `${CANONICAL_DASHBOARD_ORIGIN}/api/auth/discord/callback`;
let mainWindow = null;
let setupWindow = null;
let discordLoginWindow = null;
let forceClosing = false;
let rendererCloseApprovalPending = false;
let shutdownPromise = null;
let controlQueue = Promise.resolve();
let botSupervisor = null;
let ownsApplicationLock = false;
let activeDashboardPort = CANONICAL_DASHBOARD_PORT;
let dashboardResolutionCheckedAt = 0;
let dashboardSessionGeneration = 0;

const isDev = !app.isPackaged;
// In packaged Electron builds __dirname points into resources/app.asar/desktop.
// The application code, src, public and node_modules live in that archive, not
// directly in process.resourcesPath. Using resourcesPath prevented the local
// dashboard from starting and therefore blocked OAuth before any login window.
const projectRoot = path.resolve(__dirname, '..');
const iconPath = path.join(projectRoot, 'public', 'assets', process.platform === 'win32' ? 'fallen-heaven-app.ico' : 'fallen-heaven-app-icon.png');
const controllerExe = path.join(projectRoot, 'dist', 'botctl.exe');
const controllerScript = path.join(projectRoot, 'botctl.cjs');
const runtimeLog = path.join(projectRoot, 'runtime', 'botctl.log');
const credentialFile = () => path.join(app.getPath('userData'), 'credentials', 'discord-bot-token.bin');
const dashboardSecretFile = () => path.join(app.getPath('userData'), 'credentials', 'dashboard-session-secret.bin');
const dashboardSessionFile = () => path.join(app.getPath('userData'), 'credentials', 'dashboard-session.bin');
const DASHBOARD_COOKIE_NAME = 'discord_bot_dashboard_session';
const DASHBOARD_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const LOCAL_SESSION_URLS = [`${CANONICAL_DASHBOARD_ORIGIN}/`, 'http://localhost:3000/'];

function readProtectedText(file) {
  try {
    if (!safeStorage.isEncryptionAvailable() || !existsSync(file)) return '';
    return safeStorage.decryptString(readFileSync(file));
  } catch {
    return '';
  }
}

function writeProtectedText(file, value) {
  if (!safeStorage.isEncryptionAvailable()) return false;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, safeStorage.encryptString(String(value || '')), { mode: 0o600 });
  return true;
}

function readProtectedBotToken() {
  return readProtectedText(credentialFile());
}

function readOrCreateProtectedDashboardSecret() {
  const configured = String(process.env.DASHBOARD_SESSION_SECRET || '').trim();
  if (configured && configured !== 'change-this-token') return configured;
  const stored = readProtectedText(dashboardSecretFile());
  if (stored.length >= 64) return stored;
  const generated = crypto.randomBytes(48).toString('hex');
  return writeProtectedText(dashboardSecretFile(), generated) ? generated : crypto.randomBytes(48).toString('hex');
}

function runtimeCredentialSecrets() {
  const token = readProtectedBotToken();
  return {
    ...(token ? { DISCORD_TOKEN: token } : {}),
    // Never reuse a stale localhost redirect from an older encrypted setup.
    // Discord requires the authorize and token-exchange redirect to be byte-for-byte identical.
    DASHBOARD_DISCORD_REDIRECT_URI: CANONICAL_DISCORD_REDIRECT_URI,
    DASHBOARD_SESSION_SECRET: readOrCreateProtectedDashboardSecret(),
    DASHBOARD_JWT_TTL: '30d'
  };
}

function protectedCredentialStatus() {
  const oauth = getBotSupervisor().getSecretStatus();
  return {
    configured: Boolean(readProtectedBotToken()),
    oauthConfigured: Boolean(oauth.discordClientId && oauth.discordClientSecret),
    hasDiscordClientId: Boolean(oauth.discordClientId),
    hasDiscordClientSecret: Boolean(oauth.discordClientSecret),
    redirectUri: CANONICAL_DISCORD_REDIRECT_URI,
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    provider: process.platform === 'win32' ? 'Windows DPAPI' : 'Electron safeStorage'
  };
}

async function verifyDiscordBotToken(token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { authorization: `Bot ${token}` },
      signal: controller.signal
    });
    if (!response.ok) return { ok: false, error: response.status === 401 ? 'Discord hat den Bot-Token abgelehnt.' : `Discord-Verbindung fehlgeschlagen (HTTP ${response.status}).` };
    const user = await response.json();
    if (!user?.bot || !user?.id) return { ok: false, error: 'Der eingegebene Wert gehört nicht zu einem offiziellen Discord-Bot.' };
    return {
      ok: true,
      bot: {
        id: String(user.id),
        username: String(user.username || 'Discord Bot'),
        avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128` : null
      }
    };
  } catch (error) {
    return { ok: false, error: error?.name === 'AbortError' ? 'Discord antwortet momentan zu langsam.' : 'Discord konnte nicht erreicht werden.' };
  } finally {
    clearTimeout(timer);
  }
}

async function saveProtectedBotToken(rawToken) {
  const token = String(rawToken || '').trim();
  if (token.length < 40 || token.length > 220 || /\s/.test(token)) return { ok: false, error: 'Der Bot-Token hat kein gültiges Format.' };
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'Windows-Verschlüsselung ist für dieses Benutzerkonto nicht verfügbar.' };
  const verification = await verifyDiscordBotToken(token);
  if (!verification.ok) return verification;
  const file = credentialFile();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, safeStorage.encryptString(token), { mode: 0o600 });
  const supervisor = getBotSupervisor();
  const action = supervisor.state?.active || supervisor.state?.phase === 'running' ? 'restart' : 'start';
  const runtime = await supervisor.control(action);
  return { ok: true, bot: verification.bot, runtime: { ok: Boolean(runtime?.ok), message: sanitizeDiagnosticText(runtime?.output || runtime?.message || '') } };
}


function validateDiscordOAuthCredentials(rawClientId, rawClientSecret) {
  const clientId = String(rawClientId || '').trim();
  const clientSecret = String(rawClientSecret || '').trim();
  if (!/^\d{15,22}$/.test(clientId)) {
    return { ok: false, error: 'Die Discord Application-ID ist ungültig.' };
  }
  if (clientSecret.length < 20 || clientSecret.length > 220 || /\s/.test(clientSecret)) {
    return { ok: false, error: 'Das Discord Client-Secret ist ungültig.' };
  }
  return { ok: true, clientId, clientSecret };
}

async function saveProtectedSetupCredentials(payload = {}) {
  if (!safeStorage.isEncryptionAvailable()) {
    return { ok: false, error: 'Windows-Verschlüsselung ist für dieses Benutzerkonto nicht verfügbar.' };
  }
  const status = protectedCredentialStatus();
  const rawToken = String(payload?.botToken || '').trim();
  const rawClientId = String(payload?.clientId || '').trim();
  const rawClientSecret = String(payload?.clientSecret || '').trim();
  let bot = null;

  if (!status.configured && !rawToken) {
    return { ok: false, error: 'Bitte den Discord Bot-Token eingeben.' };
  }
  if (!status.oauthConfigured && (!rawClientId || !rawClientSecret)) {
    return { ok: false, error: 'Bitte Discord Application-ID und Client-Secret eingeben.' };
  }
  if ((rawClientId && !rawClientSecret) || (!rawClientId && rawClientSecret)) {
    return { ok: false, error: 'Application-ID und Client-Secret müssen gemeinsam gespeichert werden.' };
  }

  if (rawToken) {
    if (rawToken.length < 40 || rawToken.length > 220 || /\s/.test(rawToken)) {
      return { ok: false, error: 'Der Bot-Token hat kein gültiges Format.' };
    }
    const verification = await verifyDiscordBotToken(rawToken);
    if (!verification.ok) return verification;
    mkdirSync(path.dirname(credentialFile()), { recursive: true });
    writeFileSync(credentialFile(), safeStorage.encryptString(rawToken), { mode: 0o600 });
    bot = verification.bot;
  }

  const supervisor = getBotSupervisor();
  if (rawClientId || rawClientSecret) {
    const oauth = validateDiscordOAuthCredentials(rawClientId, rawClientSecret);
    if (!oauth.ok) return oauth;
    const saved = supervisor.saveSecrets({
      DISCORD_CLIENT_ID: oauth.clientId,
      DISCORD_CLIENT_SECRET: oauth.clientSecret,
      DASHBOARD_DISCORD_REDIRECT_URI: CANONICAL_DISCORD_REDIRECT_URI,
      DASHBOARD_JWT_TTL: '30d'
    });
    if (!saved.ok) return saved;
  }

  const action = supervisor.state?.active || supervisor.state?.phase === 'running' ? 'restart' : 'start';
  const runtime = await supervisor.control(action);
  return {
    ok: true,
    bot,
    status: protectedCredentialStatus(),
    runtime: { ok: Boolean(runtime?.ok), message: sanitizeDiagnosticText(runtime?.output || runtime?.message || '') }
  };
}

async function deleteProtectedBotToken() {
  const supervisor = getBotSupervisor();
  await supervisor.control('stop').catch(() => {});
  rmSync(credentialFile(), { force: true });
  supervisor.deleteSecrets(['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DASHBOARD_DISCORD_REDIRECT_URI']);
  await clearProtectedDashboardSession().catch(() => {});
  return { ok: true, status: protectedCredentialStatus() };
}

function resolveNodeExecutable() {
  const candidates = [
    process.env.FALLEN_HEAVEN_NODE_EXECUTABLE,
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\Program Files (x86)\\nodejs\\node.exe'
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  try {
    const raw = execFileSync('where.exe', ['node'], { encoding: 'utf8', windowsHide: true });
    return String(raw || '').split(/\r?\n/).map((item) => item.trim()).find(Boolean) || process.execPath;
  } catch {
    return process.execPath;
  }
}

function runLegacyController(action) {
  return new Promise((resolve) => {
    const useExe = app.isPackaged || !existsSync(controllerScript);
    const command = useExe ? controllerExe : process.execPath;
    const args = useExe ? [action] : [controllerScript, action];
    const nodeExecutable = resolveNodeExecutable();

    if (!existsSync(useExe ? controllerExe : controllerScript)) {
      resolve({ ok: false, output: 'Bot-Controller wurde nicht gefunden.', active: false });
      return;
    }

    execFile(command, args, {
      cwd: projectRoot,
      windowsHide: true,
      timeout: action === 'status' ? 10000 : 45000,
      encoding: 'utf8',
      env: {
        ...process.env,
        FALLEN_HEAVEN_NODE_EXECUTABLE: nodeExecutable,
        // The installed app ships src and its production dependencies in
        // resources, giving the bot one stable external process entry point.
        FALLEN_HEAVEN_BOT_SCRIPT: app.isPackaged
          ? path.join(process.resourcesPath, 'src', 'index.js')
          : path.join(projectRoot, 'src', 'index.js'),
        FALLEN_HEAVEN_APP_ROOT: projectRoot
      }
    }, (error, stdout, stderr) => {
      const output = String(stdout || stderr || error?.message || '').trim();
      const reportedFailure = /(?:^|\b)(?:fehler|konnte nicht|nicht gefunden|nicht vollst(?:ae|ä)ndig|startete nicht)(?:\b|:)/i.test(output);
      const active = /Bot ist aktiv|Bot l(?:ae|ä)uft bereits|Bot gestartet/i.test(output);
      resolve({ ok: !error && !reportedFailure, output: output || 'Aktion abgeschlossen.', active });
    });
  });
}

function getBotSupervisor() {
  if (!botSupervisor) {
    botSupervisor = new BotProcessSupervisor({
      app,
      safeStorage,
      projectRoot,
      isPackaged: app.isPackaged,
      onState: (state) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('bot:state', state);
      },
      onEvent: (events) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('bot:event', events);
      },
      getRuntimeSecrets: runtimeCredentialSecrets
    });
  }
  return botSupervisor;
}

function runController(action) {
  return getBotSupervisor().control(action);
}

function startBotFromCommandLine() {
  const operation = controlQueue.then(() => runController('start'));
  controlQueue = operation.catch(() => {});
  void operation
    .then((result) => recordMainFailure('Bot command-line start', result?.output || 'Start abgeschlossen.'))
    .catch((error) => recordMainFailure('Bot command-line start failed', error));
  return operation;
}

function stopBackgroundProcesses() {
  if (!shutdownPromise) {
    shutdownPromise = runController('stop').catch((error) => {
      recordMainFailure('App shutdown', error);
      return { ok: false };
    });
  }
  return shutdownPromise;
}

function requestApplicationQuit() {
  if (forceClosing) return;
  if (!ownsApplicationLock) {
    forceClosing = true;
    app.quit();
    return;
  }

  void stopBackgroundProcesses().finally(() => {
    botSupervisor?.forceStopSync();
    forceClosing = true;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
    if (setupWindow && !setupWindow.isDestroyed()) setupWindow.destroy();
    app.quit();
  });
}

function requestAppControl(action, method = 'GET') {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port: Number(getBotSupervisor().state.port || 0),
      path: `/api/app/system/${action}`,
      method,
      headers: {
        ...getBotSupervisor().getControlHeaders(),
        'content-length': '0'
      },
      timeout: 12000
    }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { raw += chunk; });
      response.on('end', () => {
        try {
          const data = raw ? JSON.parse(raw) : {};
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300 && data.ok !== false,
            active: Boolean(data.running),
            ready: true,
            serviceOnline: true,
            output: data.message || (data.running ? 'Bot ist mit Discord verbunden.' : 'Bot ist von Discord getrennt.'),
            ...data
          });
        } catch {
          reject(new Error('Ungültige Antwort des lokalen App-Dienstes.'));
        }
      });
    });
    request.once('timeout', () => request.destroy(new Error('Lokaler App-Dienst antwortet nicht.')));
    request.once('error', reject);
    request.end();
  });
}

async function getLocalCookies() {
  const cookieSets = await Promise.all([
    session.defaultSession.cookies.get({ url: 'http://localhost:3000/' }),
    session.defaultSession.cookies.get({ url: 'http://127.0.0.1:3000/' })
  ]);
  const unique = new Map();
  cookieSets.flat().forEach((cookie) => unique.set(cookie.name, cookie.value));
  return [...unique.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

async function clearProtectedDashboardSession() {
  dashboardSessionGeneration += 1;
  await Promise.all(LOCAL_SESSION_URLS.map((url) => session.defaultSession.cookies.remove(url, DASHBOARD_COOKIE_NAME).catch(() => {})));
  rmSync(dashboardSessionFile(), { force: true });
}

async function persistProtectedDashboardSession() {
  const cookieSets = await Promise.all(LOCAL_SESSION_URLS.map((url) => session.defaultSession.cookies.get({ url, name: DASHBOARD_COOKIE_NAME })));
  const cookie = cookieSets.flat().find((entry) => entry?.value);
  if (!cookie?.value) return false;
  const expiresAt = Number(cookie.expirationDate || (Date.now() / 1000 + DASHBOARD_SESSION_MAX_AGE_SECONDS));
  return writeProtectedText(dashboardSessionFile(), JSON.stringify({
    token: cookie.value,
    expiresAt,
    savedAt: new Date().toISOString()
  }));
}

async function restoreProtectedDashboardSession() {
  try {
    const raw = readProtectedText(dashboardSessionFile());
    if (!raw) return false;
    const saved = JSON.parse(raw);
    const expiresAt = Number(saved?.expiresAt || 0);
    if (!saved?.token || expiresAt <= Date.now() / 1000 + 60) {
      await clearProtectedDashboardSession();
      return false;
    }
    await Promise.all(LOCAL_SESSION_URLS.map((url) => session.defaultSession.cookies.set({
      url,
      name: DASHBOARD_COOKIE_NAME,
      value: String(saved.token),
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      expirationDate: expiresAt
    })));
    dashboardSessionGeneration += 1;
    return true;
  } catch {
    await clearProtectedDashboardSession();
    return false;
  }
}

async function synchronizeDashboardCookie(setCookieHeaders = []) {
  const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders].filter(Boolean);
  const header = headers.find((value) => String(value || '').startsWith(`${DASHBOARD_COOKIE_NAME}=`));
  if (!header) return;
  const match = new RegExp(`^${DASHBOARD_COOKIE_NAME}=([^;]*)`, 'i').exec(String(header));
  const token = match ? decodeURIComponent(match[1] || '') : '';
  const maxAgeMatch = /(?:^|;)\s*Max-Age=(\d+)/i.exec(String(header));
  const expiresMatch = /(?:^|;)\s*Expires=([^;]+)/i.exec(String(header));
  const explicitExpiry = expiresMatch ? Date.parse(expiresMatch[1]) / 1000 : 0;
  if (!token || maxAgeMatch?.[1] === '0' || (explicitExpiry && explicitExpiry <= Date.now() / 1000)) {
    await clearProtectedDashboardSession();
    return;
  }
  const expirationDate = maxAgeMatch
    ? Date.now() / 1000 + Number(maxAgeMatch[1])
    : (explicitExpiry || Date.now() / 1000 + DASHBOARD_SESSION_MAX_AGE_SECONDS);
  await Promise.all(LOCAL_SESSION_URLS.map((url) => session.defaultSession.cookies.set({
    url,
    name: DASHBOARD_COOKIE_NAME,
    value: token,
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    expirationDate
  })));
  dashboardSessionGeneration += 1;
  await persistProtectedDashboardSession();
}

function probeDashboard(port, timeoutMs = 2200) {
  const resolvedPort = Number(port || 0);
  if (!Number.isInteger(resolvedPort) || resolvedPort < 1 || resolvedPort > 65535) return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port: resolvedPort,
      path: '/api/auth/status',
      method: 'GET',
      timeout: timeoutMs,
      headers: { accept: 'application/json' }
    }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { raw += chunk; });
      response.on('end', () => {
        try {
          const data = raw ? JSON.parse(raw) : {};
          resolve(response.statusCode === 200 && data?.ok === true && typeof data?.oauthEnabled === 'boolean' ? data : null);
        } catch {
          resolve(null);
        }
      });
    });
    request.once('timeout', () => request.destroy());
    request.once('error', () => resolve(null));
    request.end();
  });
}

async function resolveDashboardPort({ force = false } = {}) {
  if (!force && activeDashboardPort && Date.now() - dashboardResolutionCheckedAt < 10_000) {
    return activeDashboardPort;
  }
  const supervisorPort = Number(getBotSupervisor().state.port || 0);
  const candidates = [...new Set([CANONICAL_DASHBOARD_PORT, supervisorPort].filter(Boolean))];
  for (const port of candidates) {
    if (await probeDashboard(port)) {
      activeDashboardPort = port;
      dashboardResolutionCheckedAt = Date.now();
      return port;
    }
  }
  dashboardResolutionCheckedAt = Date.now();
  return 0;
}

function requestDashboardApi({ port, method, apiPath, body, timeoutMs, cookie }) {
  return new Promise((resolve) => {
    const request = http.request({
      hostname: CANONICAL_DASHBOARD_HOST,
      port,
      path: apiPath,
      method,
      timeout: timeoutMs,
      headers: {
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}),
        ...(cookie ? { cookie } : {})
      }
    }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { raw += chunk; });
      response.on('end', async () => {
        let data;
        try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
        await synchronizeDashboardCookie(response.headers['set-cookie']).catch(() => {});
        resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode || 0, data });
      });
    });
    request.once('timeout', () => request.destroy(new Error('Zeitüberschreitung')));
    request.once('error', (error) => resolve({ ok: false, status: 0, data: { error: error?.message || 'App-Dienst nicht erreichbar.' } }));
    if (body) request.write(body);
    request.end();
  });
}

async function localApiRequest(requestOptions = {}) {
  const method = String(requestOptions.method || 'GET').toUpperCase();
  const apiPath = String(requestOptions.path || '/');
  if (!apiPath.startsWith('/api/')) return { ok: false, status: 400, data: { error: 'Ungültiger API-Pfad.' } };
  const body = requestOptions.body === undefined ? '' : JSON.stringify(requestOptions.body);
  const timeoutMs = Math.min(120000, Math.max(5000, Number(requestOptions.timeoutMs || 30000)));
  const requestGeneration = dashboardSessionGeneration;
  let cookie = await getLocalCookies();
  let port = await resolveDashboardPort();
  if (!port) port = Number(getBotSupervisor().state.port || CANONICAL_DASHBOARD_PORT);
  let result = await requestDashboardApi({ port, method, apiPath, body, timeoutMs, cookie });
  if (result.status === 0) {
    dashboardResolutionCheckedAt = 0;
    const rediscoveredPort = await resolveDashboardPort({ force: true });
    if (rediscoveredPort && rediscoveredPort !== port) {
      if (requestGeneration !== dashboardSessionGeneration) cookie = await getLocalCookies();
      result = await requestDashboardApi({ port: rediscoveredPort, method, apiPath, body, timeoutMs, cookie });
    }
  }
  if (result.status === 401 && requestGeneration !== dashboardSessionGeneration) {
    cookie = await getLocalCookies();
    result = await requestDashboardApi({ port: activeDashboardPort || port, method, apiPath, body, timeoutMs, cookie });
  }
  if (apiPath === '/api/auth/me' && result.status === 401 && requestGeneration === dashboardSessionGeneration) {
    await clearProtectedDashboardSession().catch(() => {});
  }
  return result;
}

async function setDashboardSessionToken(token, expiresAt) {
  const value = String(token || '').trim();
  const expirationDate = Number(expiresAt || 0);
  if (!value || !Number.isFinite(expirationDate) || expirationDate <= Date.now() / 1000 + 60) return false;
  await Promise.all(LOCAL_SESSION_URLS.map((url) => session.defaultSession.cookies.set({
    url,
    name: DASHBOARD_COOKIE_NAME,
    value,
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    expirationDate
  })));
  dashboardSessionGeneration += 1;
  return persistProtectedDashboardSession();
}

const waitBriefly = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function escapeDiscordLoginHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function discordLoginStatusHtml(title, message, options = {}) {
  const externalUrl = String(options.externalUrl || '');
  const action = externalUrl.startsWith('https://discord.com/')
    ? `<a class="primary" href="${escapeDiscordLoginHtml(externalUrl)}" target="_blank" rel="noreferrer">Im Standardbrowser öffnen</a>`
    : '';
  const setupLink = options.showSetup ? '<a class="secondary" href="fhcc://open-setup">Zur Einrichtung</a>' : '';
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeDiscordLoginHtml(title)}</title>
<style>
  :root { color-scheme: dark; font-family: "Segoe UI", Arial, sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 28px; color: #f7f8ff; background: radial-gradient(circle at 50% 10%, #20265f 0, #0b0e25 42%, #070817 100%); }
  main { width: min(100%, 460px); padding: 34px; border: 1px solid rgba(160,170,255,.2); border-radius: 24px; background: rgba(13,16,42,.88); box-shadow: 0 26px 80px rgba(0,0,0,.45); text-align: center; }
  .mark { display: grid; place-items: center; width: 64px; height: 64px; margin: 0 auto 22px; border-radius: 20px; color: #fff; background: #5865f2; box-shadow: 0 15px 38px rgba(88,101,242,.35); }
  .mark svg { width: 36px; height: 36px; display: block; }
  h1 { margin: 0; font-size: 26px; line-height: 1.15; }
  p { margin: 15px 0 0; color: #b8bfdc; font-size: 14px; line-height: 1.65; white-space: pre-wrap; }
  .spinner { width: 34px; height: 34px; margin: 25px auto 0; border: 3px solid rgba(255,255,255,.15); border-top-color: #9ba5ff; border-radius: 50%; animation: spin .8s linear infinite; }
  a { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; margin-top: 24px; padding: 0 18px; border-radius: 11px; color: #fff; background: #5865f2; font-size: 13px; font-weight: 750; text-decoration: none; }
  a.secondary { background: transparent; border: 1px solid rgba(160,170,255,.35); color: #b8bfdc; font-weight: 650; }
  a.secondary:hover { background: rgba(88,101,242,.18); border-color: #9ba5ff; color: #fff; }
  small { display: block; margin-top: 22px; color: #737c9e; line-height: 1.5; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body><main><div class="mark"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg></div><h1>${escapeDiscordLoginHtml(title)}</h1><p>${escapeDiscordLoginHtml(message)}</p>${options.loading === false ? '' : '<div class="spinner"></div>'}${action}${setupLink}<small>Dieses Fenster gehört zum FALLEN HEAVEN Control Center.</small></main></body>
</html>`;
}

function createDiscordLoginWindow() {
  if (discordLoginWindow && !discordLoginWindow.isDestroyed()) {
    discordLoginWindow.show();
    discordLoginWindow.focus();
    return discordLoginWindow;
  }

  discordLoginWindow = new BrowserWindow({
    width: 560,
    height: 760,
    minWidth: 440,
    minHeight: 620,
    show: false,
    title: 'Mit Discord anmelden',
    autoHideMenuBar: true,
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    modal: false,
    backgroundColor: '#08091b',
    // The executable already contains the app icon. Loading an external ICO here
    // caused a native Electron startup abort on some Windows systems.
    icon: undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false
    }
  });

  const isAllowedAuthUrl = (rawUrl) => {
    try {
      const url = new URL(rawUrl);
      if (url.protocol === 'data:' || url.protocol === 'about:') return true;
      if (url.protocol === 'https:' && ['discord.com', 'www.discord.com', 'support.discord.com'].includes(url.hostname)) return true;
      return url.protocol === 'http:' && url.hostname === CANONICAL_DASHBOARD_HOST && Number(url.port || 80) === CANONICAL_DASHBOARD_PORT && url.pathname.startsWith('/api/auth/discord/callback');
    } catch {
      return false;
    }
  };

  discordLoginWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedAuthUrl(url)) {
      void discordLoginWindow?.loadURL(url).catch(() => {});
    } else if (/^https?:\/\//i.test(String(url || ''))) {
      void shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });

  discordLoginWindow.webContents.on('will-navigate', (event, url) => {
    if (isAllowedAuthUrl(url)) return;
    event.preventDefault();
    if (/^fhcc:\/\/open-setup$/i.test(String(url || ''))) {
      discordLoginWindow?.close();
      createSetupWindow();
      return;
    }
    if (/^https?:\/\//i.test(String(url || ''))) void shell.openExternal(url).catch(() => {});
  });

  discordLoginWindow.once('ready-to-show', () => {
    discordLoginWindow?.show();
    discordLoginWindow?.focus();
  });
  discordLoginWindow.on('closed', () => {
    discordLoginWindow = null;
  });
  return discordLoginWindow;
}

async function showDiscordLoginStatus(title, message, options = {}) {
  const window = createDiscordLoginWindow();
  if (!window || window.isDestroyed()) return null;
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(discordLoginStatusHtml(title, message, options))}`).catch(() => {});
  if (!window.isDestroyed()) {
    window.show();
    window.focus();
  }
  return window;
}

async function openDiscordLogin() {
  const authWindow = await showDiscordLoginStatus(
    'Discord-Anmeldung wird vorbereitet',
    'FHCC startet den lokalen Anmeldedienst. Das kann beim ersten Start einige Sekunden dauern.'
  );

  const ready = await ensureDashboard();
  if (!ready.ok) {
    await showDiscordLoginStatus('Anmeldedienst konnte nicht starten', ready.message || 'Der lokale FHCC-Dienst ist nicht erreichbar.', { loading: false, showSetup: true });
    return { ok: false, message: ready.message };
  }

  const started = await localApiRequest({ path: '/api/auth/native/start', method: 'POST', body: {}, timeoutMs: 12000 });
  if (!started.ok) {
    const message = started.data?.error || 'Discord-Anmeldung konnte nicht vorbereitet werden.';
    await showDiscordLoginStatus('Discord-Anmeldung nicht verfügbar', message, { loading: false, showSetup: true });
    return { ok: false, message };
  }

  const transactionId = String(started.data?.transactionId || '');
  const verifier = String(started.data?.verifier || '');
  const authorizeUrl = String(started.data?.authorizeUrl || '');
  if (!transactionId || !verifier || !authorizeUrl.startsWith('https://discord.com/')) {
    const message = 'Der App-Dienst hat eine ungültige Anmeldeanfrage geliefert.';
    await showDiscordLoginStatus('Ungültige Discord-Anfrage', message, { loading: false, showSetup: true });
    return { ok: false, message };
  }

  let openedInsideApp = false;
  try {
    if (authWindow && !authWindow.isDestroyed()) {
      await authWindow.loadURL(authorizeUrl);
      authWindow.show();
      authWindow.focus();
      openedInsideApp = true;
    }
  } catch {}

  if (!openedInsideApp) {
    try {
      await shell.openExternal(authorizeUrl, { activate: true });
    } catch {
      const message = 'Discord konnte weder im FHCC-Fenster noch im Standardbrowser geöffnet werden.';
      await showDiscordLoginStatus('Browser konnte nicht geöffnet werden', message, { loading: false, externalUrl: authorizeUrl, showSetup: true });
      return { ok: false, message };
    }
  }

  const deadline = Math.min(Number(started.data?.expiresAt || 0), Date.now() + 3 * 60 * 1000) || (Date.now() + 3 * 60 * 1000);
  while (Date.now() < deadline) {
    await waitBriefly(900);
    const status = await localApiRequest({
      path: '/api/auth/native/status',
      method: 'POST',
      body: { transactionId, verifier },
      timeoutMs: 10000
    });
    if (status.ok && status.data?.status === 'pending') continue;
    if (!status.ok) {
      if (status.status === 0) continue;
      const message = status.data?.error || 'Discord-Anmeldung wurde nicht abgeschlossen.';
      await showDiscordLoginStatus('Anmeldung fehlgeschlagen', message, { loading: false, externalUrl: authorizeUrl, showSetup: true });
      return { ok: false, message };
    }
    if (status.data?.status === 'complete') {
      const stored = await setDashboardSessionToken(status.data?.sessionToken, status.data?.expiresAt).catch(() => false);
      if (!stored) {
        const message = 'Die Anmeldung war erfolgreich, konnte aber nicht sicher gespeichert werden.';
        await showDiscordLoginStatus('Sitzung konnte nicht gespeichert werden', message, { loading: false, showSetup: true });
        return { ok: false, message };
      }
      const auth = await localApiRequest({ path: '/api/auth/me', timeoutMs: 12000 });
      if (auth.ok) {
        await localApiRequest({
          path: '/api/auth/native/consume',
          method: 'POST',
          body: { transactionId, verifier },
          timeoutMs: 8000
        }).catch(() => {});
        if (discordLoginWindow && !discordLoginWindow.isDestroyed()) {
          await showDiscordLoginStatus('Anmeldung erfolgreich', 'Dein Discord-Konto wurde verbunden. Dieses Fenster schließt sich automatisch.', { loading: false });
          setTimeout(() => {
            if (discordLoginWindow && !discordLoginWindow.isDestroyed()) discordLoginWindow.close();
          }, 900);
        }
        return { ok: true, user: auth.data?.user || status.data?.user || null };
      }
      await clearProtectedDashboardSession().catch(() => {});
      const message = 'Die neue Sitzung konnte nicht bestätigt werden. Bitte erneut versuchen.';
      await showDiscordLoginStatus('Sitzung nicht bestätigt', message, { loading: false, showSetup: true });
      return { ok: false, message };
    }
  }
  const message = 'Die Discord-Anmeldung hat zu lange gedauert. Bitte erneut versuchen.';
  await showDiscordLoginStatus('Anmeldung abgelaufen', message, { loading: false, externalUrl: authorizeUrl, showSetup: true });
  return { ok: false, message };
}

function requestRuntimeHealth() {
  return new Promise((resolve) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port: Number(getBotSupervisor().state.port || 0),
      path: '/api/app/health',
      method: 'GET',
      headers: { ...getBotSupervisor().getControlHeaders() },
      timeout: 2500
    }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { raw += chunk; });
      response.on('end', () => {
        try {
          resolve(response.statusCode === 200 ? JSON.parse(raw) : null);
        } catch {
          resolve(null);
        }
      });
    });
    request.once('timeout', () => request.destroy());
    request.once('error', () => resolve(null));
    request.end();
  });
}

let lastRuntimeDiagnostics = null;
let lastRuntimeDiagnosticsAt = 0;

function requestRuntimeDiagnostics(timeout = 12_000) {
  return new Promise((resolve) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port: Number(getBotSupervisor().state.port || 0),
      path: '/api/app/diagnostics',
      method: 'GET',
      headers: { ...getBotSupervisor().getControlHeaders() },
      timeout
    }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { raw += chunk; });
      response.on('end', () => {
        try {
          resolve(response.statusCode === 200 ? JSON.parse(raw) : null);
        } catch {
          resolve(null);
        }
      });
    });
    request.once('timeout', () => request.destroy());
    request.once('error', () => resolve(null));
    request.end();
  });
}

function waitForDashboard(timeoutMs = 18000, expectedReady = true) {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const attempt = async () => {
      const health = await requestRuntimeHealth();
      const ready = Boolean(health?.ok);
      if (ready === expectedReady) {
        resolve(true);
      } else if (Date.now() - startedAt >= timeoutMs) {
        resolve(false);
      } else {
        setTimeout(attempt, 300);
      }
    };
    void attempt();
  });
}

function waitForPublicDashboard(port = CANONICAL_DASHBOARD_PORT, timeoutMs = 18000) {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const attempt = async () => {
      const status = await probeDashboard(port, 1600);
      if (status) {
        activeDashboardPort = Number(port);
        dashboardResolutionCheckedAt = Date.now();
        resolve(status);
      } else if (Date.now() - startedAt >= timeoutMs) {
        resolve(null);
      } else {
        setTimeout(attempt, 350);
      }
    };
    void attempt();
  });
}

async function ensureDashboard() {
  let port = await resolveDashboardPort({ force: true });
  if (port === CANONICAL_DASHBOARD_PORT) {
    return { ok: true, port, message: 'Interner App-Bereich ist bereit.' };
  }

  const canonicalStarting = await waitForPublicDashboard(CANONICAL_DASHBOARD_PORT, 4000);
  if (canonicalStarting) {
    return { ok: true, port: CANONICAL_DASHBOARD_PORT, message: 'Interner App-Bereich ist bereit.' };
  }

  const status = await runController('status');
  let startResult = status;
  if (!status.active) startResult = await runController('start');
  const supervisorPort = Number(getBotSupervisor().state.port || CANONICAL_DASHBOARD_PORT);
  const publicStatus = await waitForPublicDashboard(supervisorPort, 25000);
  if (!publicStatus) {
    return { ok: false, message: startResult.output || startResult.message || 'Der lokale App-Dienst konnte nicht gestartet werden.' };
  }
  if (supervisorPort !== CANONICAL_DASHBOARD_PORT) {
    return { ok: false, message: 'Port 3000 wird von einem anderen Programm blockiert. Die Discord-Anmeldung benötigt diesen festen lokalen Port.' };
  }
  port = supervisorPort;
  return { ok: true, port, message: 'Interner App-Bereich ist bereit.' };
}

function isAllowedLocalUrl(rawUrl) {
  if (!rawUrl || rawUrl === 'about:blank') return true;
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', 'fallen-heaven-discord-server.de', 'www.fallen-heaven-discord-server.de'].includes(url.hostname);
  } catch {
    return false;
  }
}

function createWindow({ headless = false } = {}) {
  mainWindow = new BrowserWindow({
    width: 1540,
    height: 940,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    frame: false,
    backgroundColor: '#07080d',
    icon: existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false
    }
  });

  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    if (!isAllowedLocalUrl(params.src)) {
      event.preventDefault();
      return;
    }
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    recordMainFailure('Renderer process gone', JSON.stringify(details || {}));
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    recordMainFailure('Renderer load failed', `${errorCode}: ${errorDescription} (${validatedURL || 'unbekannte URL'})`);
  });
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (Number(level) < 2) return;
    recordMainFailure('Renderer console', `${sourceId || 'renderer'}:${line || 0} ${message || 'Unbekannter Fehler'}`);
  });
  mainWindow.webContents.on('unresponsive', () => {
    recordMainFailure('Renderer unresponsive', 'Das Hauptfenster reagiert nicht.');
  });
  mainWindow.webContents.on('responsive', () => {
    recordMainFailure('Renderer responsive', 'Das Hauptfenster reagiert wieder.');
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  nativeTheme.themeSource = 'system';
  nativeTheme.on('updated', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('os:theme-changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
    }
  });
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'content-security-policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://cdn.discordapp.com https://media.discordapp.com data:; connect-src 'self' http://127.0.0.1:* http://localhost:*; font-src 'self'; frame-src 'none'"]
      }
    });
  });
  if (!headless) mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('close', (event) => {
    if (forceClosing) return;
    event.preventDefault();
    if (rendererCloseApprovalPending) return;
    if (mainWindow.webContents.isDestroyed()) {
      requestApplicationQuit();
      return;
    }
    rendererCloseApprovalPending = true;
    mainWindow.webContents.send('app:close-requested');
  });
  const loadPromise = mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  loadPromise.catch((error) => recordMainFailure('Renderer load failed', error));
  return { window: mainWindow, loadPromise };
}

function createSetupWindow() {
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.show();
    setupWindow.focus();
    return setupWindow;
  }
  setupWindow = new BrowserWindow({
    width: 1080,
    height: 820,
    minWidth: 900,
    minHeight: 720,
    show: false,
    frame: false,
    resizable: true,
    backgroundColor: '#08091b',
    icon: existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'setup-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  setupWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  setupWindow.once('ready-to-show', () => setupWindow?.show());
  setupWindow.on('close', (event) => {
    if (forceClosing || (mainWindow && !mainWindow.isDestroyed())) return;
    event.preventDefault();
    requestApplicationQuit();
  });
  setupWindow.on('closed', () => {
    setupWindow = null;
  });
  void setupWindow.loadFile(path.join(__dirname, 'renderer', 'setup.html'));
  return setupWindow;
}

recordMainFailure('Main boot', `Version ${app.getVersion()} wird geladen.`);
ownsApplicationLock = app.requestSingleInstanceLock();
if (!ownsApplicationLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (argv.some((value) => value === '--setup')) {
      createSetupWindow();
      return;
    }
    if (argv.some((value) => value === '--start-bot')) void startBotFromCommandLine();
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.whenReady().then(async () => {
    app.setName(APP_NAME);
    recordMainFailure('Main ready', 'Electron-Hauptprozess ist bereit.');
    const restoredDashboardSession = await restoreProtectedDashboardSession();
    if (!restoredDashboardSession) await clearProtectedDashboardSession();
    if (process.argv.includes('--headless-startup-check')) {
      recordMainFailure('Session ready', restoredDashboardSession ? 'Gespeicherte Sitzung wurde geladen.' : 'Keine gespeicherte Sitzung; Anmeldung ist bereit.');
      forceClosing = true;
      app.exit(0);
      return;
    }
    if (process.argv.includes('--headless-renderer-check')) {
      try {
        const diagnosticWindow = createWindow({ headless: true });
        await diagnosticWindow.loadPromise;
        recordMainFailure('Renderer ready', 'Hauptoberfläche wurde erfolgreich geladen.');
        forceClosing = true;
        diagnosticWindow.window.destroy();
        app.exit(0);
      } catch (error) {
        recordMainFailure('Renderer startup failed', error);
        forceClosing = true;
        app.exit(1);
      }
      return;
    }
    if (process.argv.includes('--headless-browser-check')) {
      try {
        const probeWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
        await probeWindow.loadURL('data:text/html;charset=utf-8,%3Ch1%3EFHCC%3C%2Fh1%3E');
        recordMainFailure('Browser ready', 'Verstecktes Electron-Testfenster wurde erfolgreich geladen.');
        forceClosing = true;
        probeWindow.destroy();
        app.exit(0);
      } catch (error) {
        recordMainFailure('Browser startup failed', error);
        forceClosing = true;
        app.exit(1);
      }
      return;
    }
    if (process.argv.includes('--headless-preload-check') || process.argv.includes('--headless-document-check')) {
      try {
        const checkDocument = process.argv.includes('--headless-document-check');
        const probeWindow = new BrowserWindow({
          show: false,
          webPreferences: checkDocument ? {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
          } : {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
          }
        });
        if (checkDocument) await probeWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
        else await probeWindow.loadURL('data:text/html;charset=utf-8,%3Ch1%3EFHCC%3C%2Fh1%3E');
        recordMainFailure(checkDocument ? 'Document ready' : 'Preload ready', 'Versteckter Starttest wurde erfolgreich geladen.');
        forceClosing = true;
        probeWindow.destroy();
        app.exit(0);
      } catch (error) {
        recordMainFailure(checkDocument ? 'Document startup failed' : 'Preload startup failed', error);
        forceClosing = true;
        app.exit(1);
      }
      return;
    }
    const setupRequested = process.argv.includes('--setup');
    const status = getBotSupervisor().getSecretStatus();
    const botTokenConfigured = Boolean(status.discordToken);
    const oauthConfigured = Boolean(status.oauthConfigured);
    // Bot starten wenn Token vorhanden – OAuth-Fenster nur bei Ersteinrichtung
    if (setupRequested || (!botTokenConfigured && !oauthConfigured)) {
      if (!setupRequested && !botTokenConfigured) {
        recordMainFailure('OAuth-Einrichtung', 'Discord-Bot-Token fehlt – Einrichtungsfenster wird geöffnet.');
      }
      createSetupWindow();
    } else {
      createWindow();
      if (process.argv.includes('--start-bot') || botTokenConfigured) void startBotFromCommandLine();
    }
    // Auto-Update: Alle 30 Minuten automatisch prüfen und installieren
    startAutoUpdate();
  });
}

app.on('before-quit', (event) => {
  if (forceClosing || !ownsApplicationLock) return;
  event.preventDefault();
  requestApplicationQuit();
});

app.on('will-quit', () => {
  botSupervisor?.forceStopSync();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') requestApplicationQuit();
});

function sanitizeDiagnosticText(value) {
  return String(value || '')
    .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}\b/g, '[DISCORD_TOKEN]')
    .replace(/\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{16,}\b/g, '[API_KEY]')
    .replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, '$1[PROTECTED]')
    .replace(/\b(DISCORD_TOKEN|DISCORD_CLIENT_SECRET|GOOGLE_API_KEY|TENOR_API_KEY|SESSION_SECRET)\s*[=:]\s*[^\s,;]+/gi, '$1=[PROTECTED]')
    .replace(/([?&](?:token|key|secret|api_key)=)[^&#\s]+/gi, '$1[PROTECTED]')
    .replace(/[A-Z]:\\Users\\[^\\\r\n]+/gi, '%USERPROFILE%');
}

function readSanitizedLogTail(filePath, maxLines = 260) {
  if (!existsSync(filePath)) return '';
  try {
    return sanitizeDiagnosticText(readFileSync(filePath, 'utf8'))
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-maxLines)
      .join('\n');
  } catch {
    return 'Protokoll konnte nicht gelesen werden.';
  }
}

function summarizeDirectory(rootPath, maxFiles = 25000) {
  const result = { bytes: 0, files: 0, directories: 0, truncated: false };
  if (!existsSync(rootPath)) return result;
  const pending = [rootPath];
  while (pending.length && result.files < maxFiles) {
    const current = pending.pop();
    let entries = [];
    try { entries = readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      try {
        const stat = lstatSync(entryPath);
        if (stat.isSymbolicLink()) continue;
        if (stat.isDirectory()) {
          result.directories += 1;
          pending.push(entryPath);
        } else if (stat.isFile()) {
          result.files += 1;
          result.bytes += stat.size;
          if (result.files >= maxFiles) break;
        }
      } catch {}
    }
  }
  result.truncated = pending.length > 0;
  return result;
}

function storageInventory() {
  const runtimeRoot = path.join(app.getPath('userData'), 'runtime');
  const dataRoot = path.join(runtimeRoot, 'data');
  const entries = [
    ['runtime', 'Gesamte lokale Laufzeitdaten', runtimeRoot],
    ['index', 'Serverindex (Vollindex)', path.join(dataRoot, 'server-index')],
    ['backups', 'Lokale Sicherungen', path.join(runtimeRoot, 'backups')],
    ['logs', 'Diagnoseprotokolle', path.join(runtimeRoot, 'logs')]
  ];
  return entries.map(([key, label, folder]) => ({ key, label, ...summarizeDirectory(folder) }));
}

async function diagnosticsSnapshot() {
  const supervisor = getBotSupervisor();
  const state = supervisor.state || {};
  // Resolve the cheap health signal first. Starting the database-heavy
  // diagnostics request in parallel can block the bot event loop before the
  // liveness response is written and recreate a false offline result.
  const health = await requestRuntimeHealth().catch(() => null);
  const diagnostics = health?.ok ? await requestRuntimeDiagnostics().catch(() => null) : null;
  const runtimeRoot = path.join(app.getPath('userData'), 'runtime');
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    privacy: {
      includesMessageContent: false,
      includesSecrets: false,
      includesConfigurationValues: false
    },
    app: {
      name: APP_NAME,
      version: app.getVersion(),
      packaged: app.isPackaged,
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
      node: process.versions.node
    },
    bot: {
      phase: state.phase || 'unknown',
      active: Boolean(state.active),
      ready: Boolean(state.ready),
      pid: Number(state.pid || 0) || null,
      port: Number(state.port || 0) || null,
      message: sanitizeDiagnosticText(state.message || ''),
      updatedAt: state.updatedAt || null
    },
    runtime: health ? {
      ok: Boolean(health.ok),
      ready: Boolean(health.ready || health.discordReady),
      uptimeMs: Number(health.uptimeMs || 0),
      rssBytes: Number(health.rss || health.memory?.rss || 0),
      heapUsedBytes: Number(health.heapUsed || health.memory?.heapUsed || 0),
      pingMs: Number(health.ping || health.wsPing || 0),
      guilds: Number(health.guilds || health.guildCount || 0),
      liveDiagnostics: diagnostics?.liveDiagnostics || null
    } : null,
    protectedSecrets: supervisor.getSecretStatus(),
    storage: storageInventory(),
    logs: {
      supervisor: readSanitizedLogTail(supervisor.getLogPath()),
      launcher: readSanitizedLogTail(path.join(runtimeRoot, 'logs', 'bot-crash.log')),
      desktop: readSanitizedLogTail(path.join(runtimeRoot, 'logs', 'main-process.log'))
    }
  };
}

// Log-Rotation: main-process.log wächst sonst unbegrenzt. Ab 10 MB wird die
// älteste Datei verschoben (main-process.1.log, .2.log, .3.log) und danach
// aufgeräumt – 3 Backups bleiben übrig, der Speicher des Mini-PCs bleibt frei.
const MAIN_LOG_MAX_BYTES = 10 * 1024 * 1024;
const MAIN_LOG_BACKUPS = 3;
function rotateMainLogIfNeeded(logFolder) {
  try {
    const target = path.join(logFolder, 'main-process.log');
    if (!existsSync(target)) return;
    const size = lstatSync(target)?.size || 0;
    if (size < MAIN_LOG_MAX_BYTES) return;
    const oldest = path.join(logFolder, `main-process.${MAIN_LOG_BACKUPS}.log`);
    if (existsSync(oldest)) rmSync(oldest, { force: true });
    for (let index = MAIN_LOG_BACKUPS - 1; index >= 1; index -= 1) {
      const current = path.join(logFolder, `main-process.${index}.log`);
      const next = path.join(logFolder, `main-process.${index + 1}.log`);
      if (existsSync(current)) renameSync(current, next);
    }
    renameSync(target, path.join(logFolder, 'main-process.1.log'));
  } catch {}
}

function recordMainFailure(kind, error) {
  try {
    const logFolder = path.join(app.getPath('userData'), 'runtime', 'logs');
    mkdirSync(logFolder, { recursive: true });
    rotateMainLogIfNeeded(logFolder);
    appendFileSync(path.join(logFolder, 'main-process.log'), `[${new Date().toISOString()}] ${kind}: ${sanitizeDiagnosticText(error?.stack || error)}\n`, 'utf8');
  } catch {}
}

process.on('uncaughtExceptionMonitor', (error) => recordMainFailure('Uncaught exception', error));
process.on('unhandledRejection', (error) => recordMainFailure('Unhandled rejection', error));

// ---------------------------------------------------------------------------
// Lokales Auto-Update: prüft einen konfigurierbaren Ordner (oder Netzwerkfreigabe)
// auf latest.yml + FHCC-Setup-<version>-x64.exe und installiert neuere Versionen
// still. Kein externer Update-Dienst nötig – ideal für den privaten PC-2-Betrieb.
// ---------------------------------------------------------------------------
const updateSettingsFile = () => path.join(app.getPath('userData'), 'update-settings.json');

const readUpdateSettings = () => {
  try {
    return JSON.parse(readFileSync(updateSettingsFile(), 'utf8')) || {};
  } catch {
    return {};
  }
};

const writeUpdateSettings = (settings) => {
  try {
    mkdirSync(path.dirname(updateSettingsFile()), { recursive: true });
    writeFileSync(updateSettingsFile(), JSON.stringify(settings, null, 2), 'utf8');
  } catch (error) {
    console.error('Update-Settings konnten nicht gespeichert werden:', error?.message || error);
  }
};

// ---------------------------------------------------------------------------
// Update-Kanal über ein privates GitHub-Release-Repository.
//
// Das Token wird NICHT im Klartext in update-settings.json abgelegt, sondern
// über Electron safeStorage verschlüsselt – unter Windows ist das DPAPI, also
// an das Benutzerkonto gebunden. Eine Kopie von %APPDATA% auf einen anderen
// Rechner liefert damit nur unlesbaren Datenmüll. Ohne verfügbares
// safeStorage (Linux ohne Keyring) wird gar nicht erst gespeichert, statt das
// Token im Klartext zu riskieren.
// ---------------------------------------------------------------------------
const isTokenEncryptionAvailable = () => {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
};

const readUpdateToken = () => {
  try {
    const blob = String(readUpdateSettings().tokenEnc || '');
    if (!blob || !isTokenEncryptionAvailable()) return '';
    return safeStorage.decryptString(Buffer.from(blob, 'base64'));
  } catch (error) {
    console.error('Update-Token konnte nicht entschlüsselt werden:', error?.message || error);
    return '';
  }
};

const writeUpdateToken = (token) => {
  const value = String(token || '').trim();
  const settings = readUpdateSettings();
  if (!value) {
    delete settings.tokenEnc;
    delete settings.tokenHint;
    writeUpdateSettings(settings);
    return { ok: true, cleared: true };
  }
  if (!isTokenEncryptionAvailable()) {
    return { ok: false, error: 'Dieses System kann den Token nicht verschlüsselt speichern. Bitte den Ordner-Kanal verwenden.' };
  }
  settings.tokenEnc = safeStorage.encryptString(value).toString('base64');
  settings.tokenHint = tokenHint(value);
  writeUpdateSettings(settings);
  return { ok: true, cleared: false, hint: settings.tokenHint };
};

// GitHub nennt private Repositories ohne Token "Not Found" (404), nicht
// "Unauthorized" – sonst wäre nicht unterscheidbar, ob der Kanal fehlerhaft
// oder das Token abgelaufen ist.
const githubRequest = async (url, { token, accept, timeoutMs = 30_000 } = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { ...buildAuthHeaders(token), ...(accept ? { Accept: accept } : {}) },
      signal: controller.signal,
      redirect: 'follow'
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
};

const fetchLatestRelease = async () => {
  const settings = readUpdateSettings();
  const target = normalizeRepoTarget({ owner: settings.repoOwner, repo: settings.repoRepo });
  if (!target) return { ok: false, reason: 'no-repo', error: 'Kein Release-Repository konfiguriert.' };
  const url = buildReleasesApiUrl(target, 'latest');
  const token = readUpdateToken();
  let response;
  try {
    response = await githubRequest(url, { token });
  } catch (error) {
    return { ok: false, reason: 'network', error: `GitHub nicht erreichbar: ${String(error?.message || error).slice(0, 160)}` };
  }
  if (response.status === 404) {
    return {
      ok: false,
      reason: token ? 'unauthorized' : 'not-found',
      error: token
        ? 'Repository oder Token ungültig. Ein privates Repository braucht ein Token mit Leserecht darauf.'
        : 'Kein Release gefunden – im privaten Repository ist noch kein Release veröffentlicht.'
    };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, reason: 'unauthorized', error: `GitHub lehnte den Token ab (HTTP ${response.status}).` };
  }
  if (!response.ok) {
    return { ok: false, reason: 'http', error: `GitHub antwortete mit HTTP ${response.status}.` };
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, reason: 'parse', error: 'Release-Antwort war kein gültiges JSON.' };
  }
  return { ok: true, target, release: payload, tokenHint: tokenHint(token) };
};

const checkGitHubRelease = async () => {
  const fetched = await fetchLatestRelease();
  if (!fetched.ok) return fetched;
  const resolved = resolveReleaseUpdate({
    release: fetched.release,
    currentVersion: app.getVersion(),
    target: fetched.target
  });
  return { ...resolved, ok: true, reason: resolved.reason };
};

const installUpdate = (folder) => {
  const artifact = findUpdateArtifact(folder || readUpdateSettings().updateFolder || '');
  if (!artifact) return { ok: false, error: 'Kein Update-Paket im Ordner gefunden.' };
  if (!isVersionNewer(artifact.manifest.version, app.getVersion())) {
    return { ok: false, error: 'Installierte Version ist bereits aktuell.' };
  }
  if (!verifyArtifactSha512(artifact.artifactPath, artifact.manifest.sha512)) {
    return { ok: false, error: 'Update-Datei ist beschädigt (SHA-512-Prüfung fehlgeschlagen).' };
  }
  try {
    const targetFolder = path.join(app.getPath('temp'), 'FHCC-Updates');
    mkdirSync(targetFolder, { recursive: true });
    const target = path.join(targetFolder, artifact.artifactName);
    copyFileSync(artifact.artifactPath, target);
    runUpdateInstaller(target);
    return { ok: true, version: artifact.manifest.version, installer: target };
  } catch (error) {
    return { ok: false, error: String(error?.message || error).slice(0, 300) };
  }
};

// Automatisches Update: Sofort beim Start prüfen, dann alle 5 Minuten.
// Bei Verfügbarkeit sofort installieren und App neu starten.
const AUTO_UPDATE_INTERVAL_MS = 5 * 60 * 1000;
let autoUpdateTimer = null;
let lastAutoUpdateVersion = '';
let autoUpdateRunning = false;
const checkAndInstallUpdate = async () => {
  if (autoUpdateRunning) return;
  autoUpdateRunning = true;
  try {
    // Reihenfolge: der konfigurierte GitHub-Kanal zuerst, der lokale Ordner
    // bleibt Rueckfall. So laesst sich ein fehlendes Token oder ein leeres
    // Release-Repository jederzeit umschalten, ohne den Ordner zu verlieren.
    const release = await checkGitHubRelease().catch((error) => ({
      ok: false,
      reason: 'error',
      error: String(error?.message || error).slice(0, 160)
    }));
    if (release.ok && release.available) {
      if (release.version === lastAutoUpdateVersion) { autoUpdateRunning = false; return; }
      lastAutoUpdateVersion = release.version;
      console.log(`[auto-update] GitHub-Release gefunden: ${release.version} (aktuell: ${app.getVersion()}).`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-available', { version: release.version, auto: true, source: 'github-release' });
      }
      const result = await installUpdateFromRelease(release);
      if (result.ok) {
        console.log(`[auto-update] Installation gestartet: ${result.installer}`);
      } else {
        console.error(`[auto-update] Installation fehlgeschlagen: ${result.error}`);
        lastAutoUpdateVersion = '';
      }
      return;
    }
    if (!release.ok) {
      console.warn(`[auto-update] GitHub-Kanal: ${release.error || release.reason}`);
    }
    const folders = [];
    const configuredFolder = readUpdateSettings().updateFolder || '';
    if (configuredFolder) folders.push(configuredFolder);
    const localProjectDir = path.join(__dirname, '..');
    if (localProjectDir && !folders.includes(localProjectDir)) folders.push(localProjectDir);
    let best = null;
    for (const folder of folders) {
      const result = checkForUpdate(folder, app.getVersion());
      if (result.available && (!best || (result.version && (!best.version || isVersionNewer(result.version, best.version))))) {
        best = { ...result, folder };
      }
    }
    if (!best) { autoUpdateRunning = false; return; }
    if (best.version === lastAutoUpdateVersion) { autoUpdateRunning = false; return; }
    lastAutoUpdateVersion = best.version;
    console.log(`[auto-update] Update gefunden: ${best.version} (aktuell: ${app.getVersion()}) – Installation wird gestartet.`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-available', { version: best.version, auto: true, source: 'folder' });
    }
    const result = installUpdate(best.folder);
    if (result.ok) {
      console.log(`[auto-update] Installation gestartet: ${result.installer}`);
    } else {
      console.error(`[auto-update] Installation fehlgeschlagen: ${result.error}`);
      lastAutoUpdateVersion = '';
    }
  } catch (error) {
    console.error('[auto-update] Fehler:', error?.message || error);
  } finally {
    autoUpdateRunning = false;
  }
};
// Lädt eine Datei in Klappen auf die Platte, damit ein 566-MB-Installer den
// Speicher des Mini-PCs nicht blockiert. Rückgabe: geschriebene Bytes.
const downloadToFile = async (url, target, { token, onProgress, timeoutMs = 30 * 60_000 } = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await githubRequest(url, { token, timeoutMs });
    if (!response.ok) throw new Error(`Download fehlgeschlagen (HTTP ${response.status}).`);
    const total = Number(response.headers.get('content-length')) || 0;
    mkdirSync(path.dirname(target), { recursive: true });
    const handle = await fsPromises.open(target, 'w');
    let written = 0;
    try {
      for await (const chunk of response.body) {
        await handle.write(chunk);
        written += chunk.length;
        if (typeof onProgress === 'function') onProgress({ written, total });
      }
    } finally {
      await handle.close();
    }
    return written;
  } finally {
    clearTimeout(timer);
  }
};

const runUpdateInstaller = (installerPath) => {
  const targetFolder = path.join(app.getPath('temp'), 'FHCC-Updates');
  mkdirSync(targetFolder, { recursive: true });
  // NSIS darf erst starten, nachdem Electron wirklich beendet ist. Ein
  // direkt parallel gestarteter Installer trifft sonst noch gesperrte
  // Renderer-/Bot-Dateien und endet unter Windows mit 1603 bzw. -1073740940.
  //
  // Zusaetzlich prueft das Skript das Ergebnis und installiert bei einem
  // gescheiterten stillen Lauf selbststaendig erneut mit Oberflaeche: der
  // Deinstallierer der Vorversion stuerzt hier mit 0xC0000374 (Heap-
  // Korruption in old-uninstaller.exe), nachdem er die Dateien geloescht
  // hat - ohne diese Pruefung bleibt die App dann ohne Installation zurueck.
  const updater = path.join(targetFolder, `fhcc-update-${process.pid}.cmd`);
  const script = buildUpdateRunnerScript({
    installer: installerPath,
    installDir: path.dirname(app.getPath('exe')),
    logFile: path.join(targetFolder, 'last-update.log'),
    appPid: process.pid
  });
  writeFileSync(updater, script, 'utf8');
  const child = spawn('cmd.exe', ['/d', '/c', updater], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  setTimeout(() => { try { app.quit(); } catch {} }, 250);
  return updater;
};

// Vollständiger GitHub-Weg: Manifest (winzig) -> Integritätsprüfung ->
// Download -> SHA-512-Prüfung -> gehärtetes Runner-Skript.
const installUpdateFromRelease = async (releaseUpdate) => {
  if (!releaseUpdate?.available) {
    return { ok: false, error: releaseUpdate?.reason === 'up-to-date' ? 'Installierte Version ist bereits aktuell.' : 'Kein Update verfügbar.' };
  }
  if (!releaseUpdate.manifestUrl) {
    return { ok: false, error: 'Das Release enthält keine latest.yml – ohne sie gibt es keine Integritätsprüfung.' };
  }
  const token = readUpdateToken();
  let manifestText = '';
  try {
    const response = await githubRequest(releaseUpdate.manifestUrl, { token, accept: 'text/plain' });
    if (!response.ok) return { ok: false, error: `latest.yml nicht abrufbar (HTTP ${response.status}).` };
    manifestText = await response.text();
  } catch (error) {
    return { ok: false, error: `latest.yml nicht abrufbar: ${String(error?.message || error).slice(0, 160)}` };
  }
  const expectation = describeManifestExpectation(manifestText, {
    version: releaseUpdate.version,
    size: releaseUpdate.size
  });
  if (!expectation.ok) {
    return { ok: false, error: `latest.yml unbrauchbar (${expectation.reason}) – Update abgebrochen.` };
  }
  if (!isVersionNewer(expectation.version, app.getVersion())) {
    return { ok: false, error: 'Installierte Version ist bereits aktuell.' };
  }
  const targetFolder = path.join(app.getPath('temp'), 'FHCC-Updates');
  const installer = path.join(targetFolder, releaseUpdate.artifactName);
  try {
    await downloadToFile(releaseUpdate.artifactUrl, installer, {
      token,
      onProgress: ({ written, total }) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('update-progress', {
            version: expectation.version,
            written,
            total: total || expectation.size || 0
          });
        }
      }
    });
  } catch (error) {
    return { ok: false, error: `Installer-Download fehlgeschlagen: ${String(error?.message || error).slice(0, 160)}` };
  }
  // Entscheidend: die heruntergeladene Datei muss byteweise zum Manifest
  // passen, sonst wird gar nichts gestartet.
  if (!verifyArtifactSha512(installer, expectation.sha512)) {
    try { rmSync(installer, { force: true }); } catch {}
    return { ok: false, error: 'Installer ist beschädigt (SHA-512-Prüfung fehlgeschlagen) – Update abgebrochen.' };
  }
  try {
    runUpdateInstaller(installer);
    return { ok: true, version: expectation.version, installer };
  } catch (error) {
    return { ok: false, error: String(error?.message || error).slice(0, 300) };
  }
};
const startAutoUpdate = () => {
  if (autoUpdateTimer) return;
  // Sofort beim Start prüfen (nach 30 Sekunden damit Bot erstmal hochfährt)
  setTimeout(checkAndInstallUpdate, 30_000);
  // Dann alle 5 Minuten
  autoUpdateTimer = setInterval(checkAndInstallUpdate, AUTO_UPDATE_INTERVAL_MS);
};
ipcMain.handle('app:update-settings', () => readUpdateSettings());
ipcMain.handle('app:update-settings-set', (_event, payload) => {
  const settings = readUpdateSettings();
  if (payload && typeof payload === 'object') {
    const folder = String(payload.updateFolder || '').trim();
    if (folder) settings.updateFolder = folder;
    else delete settings.updateFolder;
    writeUpdateSettings(settings);
  }
  return settings;
});
ipcMain.handle('app:check-update', () => {
    const folders = [];
    const configuredFolder = readUpdateSettings().updateFolder || '';
    if (configuredFolder) folders.push(configuredFolder);
    // Zusätzlich den lokalen Projektordner prüfen (neben der Freigabe)
    const localProjectDir = path.join(__dirname, '..');
    if (localProjectDir && !folders.includes(localProjectDir)) folders.push(localProjectDir);
    let best = null;
    for (const folder of folders) {
      const result = checkForUpdate(folder, app.getVersion());
      if (result.available && (!best || (result.version && (!best.version || isVersionNewer(result.version, best.version))))) {
        best = { ...result, folder };
      }
    }
    return best || checkForUpdate(folders[0] || '', app.getVersion());
  });
ipcMain.handle('app:install-update', async (_event, payload) => {
  // Ohne Argument wird der GitHub-Kanal bevorzugt, weil er der einzige ist,
  // der auch ohne den Rechner im Bauordner funktioniert.
  const release = await checkGitHubRelease().catch(() => null);
  if (release?.ok) return installUpdateFromRelease(release);
  return installUpdate();
});

// Einstellungen des Update-Kanals. Der Token verlässt den Renderer nur
// verschluesselt (safeStorage/DPAPI) und wird nie zurueckgesendet.
ipcMain.handle('app:update-source', () => ({
  ...describeUpdateSource({ ...readUpdateSettings(), __token: readUpdateToken() }),
  version: app.getVersion(),
  encryptionAvailable: isTokenEncryptionAvailable(),
  owner: String(readUpdateSettings().repoOwner || ''),
  repo: String(readUpdateSettings().repoRepo || '')
}));
ipcMain.handle('app:update-source-set', (_event, payload) => {
  const settings = readUpdateSettings();
  const raw = String(payload?.repo || payload?.slug || '').trim();
  const parsed = normalizeRepoTarget({ slug: raw, owner: payload?.owner, repo: payload?.repo });
  if (!parsed) return { ok: false, error: 'Repository bitte als owner/name angeben, z. B. fallenangel/fhcc-releases.' };
  settings.repoOwner = parsed.owner;
  settings.repoRepo = parsed.repo;
  writeUpdateSettings(settings);
  return { ok: true, repo: parsed.slug };
});
ipcMain.handle('app:update-token-set', (_event, payload) => writeUpdateToken(payload?.token));
ipcMain.handle('app:update-token-clear', () => writeUpdateToken(''));
ipcMain.handle('app:update-channel-test', async () => {
  const result = await checkGitHubRelease().catch((error) => ({
    ok: false,
    reason: 'error',
    error: String(error?.message || error).slice(0, 160)
  }));
  if (result.ok) {
    return {
      ok: true,
      available: result.available === true,
      version: result.version || '',
      current: app.getVersion(),
      reason: result.reason,
      size: Number(result.size) || 0,
      releaseUrl: result.releaseUrl || '',
      message: result.available
        ? `Release ${result.version} ist verfügbar.`
        : 'Verbindung zum Release-Repository funktioniert, keine neuere Version vorhanden.'
    };
  }
  return { ok: false, error: result.error || 'Kanal konnte nicht geprüft werden.', reason: result.reason || 'unknown' };
});

ipcMain.handle('bot:control', async (_event, action) => {
  if (!['start', 'stop', 'restart', 'status'].includes(action)) return { ok: false, output: 'Ungültige Bot-Aktion.', active: false };
  const operation = controlQueue.then(async () => {
    const result = await runController(action);
    if (action === 'stop') {
      const stopped = await waitForDashboard(12000, false);
      const ok = result.ok && stopped;
      return { ...result, ok, active: false, ready: false, output: ok ? 'Bot wurde vollständig gestoppt.' : (result.output || 'Bot konnte nicht vollständig gestoppt werden.') };
    }
    if (['start', 'restart'].includes(action)) {
      const ready = await waitForDashboard(30000, true);
      const ok = result.ok && ready;
      return {
        ...result,
        ok,
        active: ready,
        ready,
        output: ok
          ? (action === 'restart' ? 'Bot wurde neu gestartet und ist erreichbar.' : 'Bot wurde gestartet und ist erreichbar.')
          : (result.output || 'Bot wurde nicht erreichbar.')
      };
    }
    const health = await requestRuntimeHealth().catch(() => null);
    const supervisorActive = Boolean(result?.active);
    const supervisorReady = Boolean(result?.ready ?? result?.active);
    const ready = Boolean(health?.ok || supervisorReady);
    return {
      ...result,
      active: Boolean(supervisorActive || ready),
      ready,
      health,
      degraded: !health?.ok && supervisorActive
    };
  });
  controlQueue = operation.catch(() => {});
  return operation;
});
ipcMain.handle('bot:ensure-dashboard', () => ensureDashboard());
ipcMain.handle('bot:state', () => getBotSupervisor().state);
ipcMain.handle('security:secret-status', () => getBotSupervisor().getSecretStatus());

ipcMain.handle('setup:status', () => protectedCredentialStatus());
ipcMain.handle('setup:save-bot-token', (_event, token) => saveProtectedBotToken(token));
ipcMain.handle('setup:save-credentials', (_event, payload) => saveProtectedSetupCredentials(payload));
ipcMain.handle('setup:delete-bot-token', () => deleteProtectedBotToken());
ipcMain.handle('setup:open-main', () => {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  else {
    mainWindow.show();
    mainWindow.focus();
  }
  setupWindow?.close();
  return true;
});
ipcMain.handle('app:open-setup', () => {
  createSetupWindow();
  return true;
});
ipcMain.on('setup:minimize', () => setupWindow?.minimize());
ipcMain.on('setup:close', () => setupWindow?.close());
ipcMain.handle('app:info', () => ({ name: APP_NAME, version: app.getVersion(), packaged: app.isPackaged }));
ipcMain.handle('app:logs', () => {
  const currentLog = getBotSupervisor().getLogPath();
  if (!existsSync(currentLog)) return 'Noch keine Protokolle vorhanden.';
  return readSanitizedLogTail(currentLog, 220);
});
ipcMain.handle('app:diagnostics', () => diagnosticsSnapshot());
ipcMain.handle('app:get-live-diagnostics', async () => {
  const supervisor = getBotSupervisor();
  const health = await requestRuntimeHealth().catch(() => null);
  const diagnostics = health?.ok ? await requestRuntimeDiagnostics().catch(() => null) : null;
  if (diagnostics?.liveDiagnostics) {
    lastRuntimeDiagnostics = diagnostics.liveDiagnostics;
    lastRuntimeDiagnosticsAt = Date.now();
  }
  const cachedAgeMs = lastRuntimeDiagnosticsAt ? Date.now() - lastRuntimeDiagnosticsAt : null;
  const cachedUsable = Boolean(lastRuntimeDiagnostics && cachedAgeMs !== null && cachedAgeMs < 120_000);
  const live = diagnostics?.liveDiagnostics || (cachedUsable ? lastRuntimeDiagnostics : null);
  return {
    ok: Boolean(health?.ok),
    measuredAt: new Date().toISOString(),
    bot: supervisor.state || {},
    runtime: health,
    live,
    diagnosticsAvailable: Boolean(live),
    diagnosticsFresh: Boolean(diagnostics?.liveDiagnostics),
    diagnosticsAgeMs: diagnostics?.liveDiagnostics ? 0 : cachedUsable ? cachedAgeMs : null,
    diagnosticsError: diagnostics?.error ? sanitizeDiagnosticText(diagnostics.error) : null
  };
});
ipcMain.handle('app:export-diagnostics', async () => {
  const options = {
    title: 'FALLEN HEAVEN Diagnose speichern',
    defaultPath: `fallen-heaven-diagnose-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON-Diagnose', extensions: ['json'] }]
  };
  const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  writeFileSync(result.filePath, JSON.stringify(await diagnosticsSnapshot(), null, 2), 'utf8');
  return { ok: true, canceled: false };
});
ipcMain.handle('app:open-data-folder', async () => {
  const folder = path.join(app.getPath('userData'), 'runtime', 'data');
  mkdirSync(folder, { recursive: true });
  const error = await shell.openPath(folder);
  return { ok: !error, error: sanitizeDiagnosticText(error) };
});
ipcMain.handle('app:open-log-folder', async () => {
  const folder = path.join(app.getPath('userData'), 'runtime', 'logs');
  mkdirSync(folder, { recursive: true });
  const error = await shell.openPath(folder);
  return { ok: !error, error: sanitizeDiagnosticText(error) };
});
ipcMain.handle('app:open-update-folder', async () => {
  const folder = readUpdateSettings().updateFolder || '';
  if (!folder) return { ok: false, error: 'Kein Update-Ordner gesetzt.' };
  const error = await shell.openPath(folder);
  return { ok: !error, error: sanitizeDiagnosticText(error) };
});
ipcMain.handle('app:open-external', (_event, url) => {
  if (!/^https?:\/\//i.test(String(url || ''))) return false;
  void shell.openExternal(url);
  return true;
});
ipcMain.handle('api:request', (_event, options) => localApiRequest(options));
ipcMain.handle('auth:discord-login', () => openDiscordLogin());
ipcMain.handle('auth:logout', async () => {
  const response = await localApiRequest({ path: '/api/auth/logout', method: 'POST' }).catch(() => ({ ok: false }));
  await clearProtectedDashboardSession();
  return { ok: true, server: Boolean(response?.ok) };
});
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());
ipcMain.on('window:close-response', (_event, accepted) => {
  if (!rendererCloseApprovalPending) return;
  rendererCloseApprovalPending = false;
  if (accepted === true) requestApplicationQuit();
  else if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
});
