const electronRuntime = require('electron');
const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const http = require('node:http');
const path = require('node:path');

if (!electronRuntime?.app || !electronRuntime?.safeStorage) {
  if (process.env.FHCC_SESSION_HEALTH_ELECTRON === '1') {
    process.stdout.write(JSON.stringify({ encrypted: false, error: 'Electron-App-Kontext konnte nicht gestartet werden.' }));
    process.exit(1);
  }

  const electronBinary = typeof electronRuntime === 'string' ? electronRuntime : null;
  if (!electronBinary) {
    process.stdout.write(JSON.stringify({ encrypted: false, error: 'Lokaler Electron-Runtime wurde nicht gefunden.' }));
    process.exit(1);
  }

  const child = spawnSync(electronBinary, [__filename], {
    cwd: process.cwd(),
    env: { ...process.env, FHCC_SESSION_HEALTH_ELECTRON: '1' },
    stdio: 'inherit',
    windowsHide: true
  });
  process.exit(child.status ?? 1);
}

const { app, safeStorage } = electronRuntime;

const appName = 'FALLEN HEAVEN Control Center';
app.setAppUserModelId('de.fallenheaven.discordbot');
app.setPath('userData', path.join(app.getPath('appData'), appName));
const sessionFile = path.join(process.env.APPDATA || '', 'FALLEN HEAVEN Control Center', 'credentials', 'dashboard-session.bin');

function checkSession(token, apiPath = '/api/auth/me') {
  return new Promise((resolve) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port: 3000,
      path: apiPath,
      method: 'GET',
      timeout: 8000,
      headers: { cookie: `discord_bot_dashboard_session=${token}`, accept: 'application/json' }
    }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { raw += chunk; });
      response.on('end', () => {
        let data = {};
        try { data = JSON.parse(raw); } catch {}
        resolve({ status: response.statusCode || 0, ok: data?.ok === true, error: data?.error || '', data });
      });
    });
    request.once('timeout', () => request.destroy(new Error('timeout')));
    request.once('error', (error) => resolve({ status: 0, ok: false, error: error.message }));
    request.end();
  });
}

app.whenReady().then(async () => {
  try {
    const saved = JSON.parse(safeStorage.decryptString(readFileSync(sessionFile)));
    const payload = JSON.parse(Buffer.from(String(saved.token || '').split('.')[1] || '', 'base64url').toString('utf8'));
    const result = await checkSession(saved.token);
    const guildId = String(payload.manageableGuildIds?.[0] || '');
    const measure = async (apiPath, countKey) => {
      const startedAt = Date.now();
      const response = guildId ? await checkSession(saved.token, apiPath) : { status: 0, ok: false, data: {} };
      const payload = response.data?.management || response.data?.data || response.data || {};
      return {
        status: response.status,
        ok: response.ok,
        milliseconds: Date.now() - startedAt,
        count: Array.isArray(payload?.[countKey]) ? payload[countKey].length : 0,
        syncing: Boolean(payload?.syncingMembers || response.data?.syncingMembers)
      };
    };
    const channels = await measure(`/api/guild/${encodeURIComponent(guildId)}/channels`, 'channels');
    const roles = await measure(`/api/guild/${encodeURIComponent(guildId)}/config-roles`, 'roles');
    const members = await measure(`/api/guild/${encodeURIComponent(guildId)}/members?page=0&pageSize=25`, 'members');
    const management = await measure(`/api/guild/${encodeURIComponent(guildId)}/management`, 'channels');
    const boostProgressResponse = await checkSession(saved.token, `/api/guild/${encodeURIComponent(guildId)}/boost-role-progress`);
    const channelResponse = await checkSession(saved.token, `/api/guild/${encodeURIComponent(guildId)}/channels`);
    const roleResponse = await checkSession(saved.token, `/api/guild/${encodeURIComponent(guildId)}/config-roles`);
    const relevantChannels = (channelResponse.data?.channels || []).filter((entry) => /vip|coin|support|ticket|shop/i.test(String(entry.name || ''))).map((entry) => ({ id: entry.id, name: entry.name })).slice(0, 30);
    const relevantRoles = (roleResponse.data?.roles || []).filter((entry) => /vip|bronze|silber|gold|diamant|boost/i.test(String(entry.name || ''))).map((entry) => ({ id: entry.id, name: entry.name })).slice(0, 60);
    process.stdout.write(JSON.stringify({
      encrypted: true,
      savedAt: saved.savedAt,
      storedExpiresAt: saved.expiresAt,
      tokenIssuedAt: payload.iat,
      tokenExpiresAt: payload.exp,
      accessVersion: payload.accessVersion,
      server: { status: result.status, ok: result.ok, error: result.error || '', userId: result.data?.user?.discordId || '' },
      channels,
      roles,
      members,
      management,
      boostProgress: boostProgressResponse.data?.status || { ok: false, error: boostProgressResponse.error },
      relevantChannels,
      relevantRoles
    }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ encrypted: false, error: error.message }));
  } finally {
    app.quit();
  }
});
