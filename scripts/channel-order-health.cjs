const electronRuntime = require('electron');
const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const http = require('node:http');
const path = require('node:path');

if (!electronRuntime?.app || !electronRuntime?.safeStorage) {
  const electronBinary = typeof electronRuntime === 'string' ? electronRuntime : null;
  if (!electronBinary) {
    process.stdout.write(JSON.stringify({ ok: false, error: 'Lokaler Electron-Runtime wurde nicht gefunden.' }));
    process.exit(1);
  }
  const child = spawnSync(electronBinary, [__filename, ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env: { ...process.env, FHCC_CHANNEL_ORDER_ELECTRON: '1' },
    stdio: 'inherit',
    windowsHide: true
  });
  process.exit(child.status ?? 1);
}

const { app, safeStorage } = electronRuntime;
const appName = 'FALLEN HEAVEN Control Center';
app.setAppUserModelId('de.fallenheaven.discordbot');
app.setPath('userData', path.join(app.getPath('appData'), appName));
const sessionFile = path.join(process.env.APPDATA || '', appName, 'credentials', 'dashboard-session.bin');

function requestJson(token, apiPath) {
  return new Promise((resolve) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port: 3000,
      path: apiPath,
      method: 'GET',
      timeout: 10_000,
      headers: { cookie: `discord_bot_dashboard_session=${token}`, accept: 'application/json' }
    }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { raw += chunk; });
      response.on('end', () => {
        let data = {};
        try { data = JSON.parse(raw); } catch {}
        resolve({ status: response.statusCode || 0, ok: data?.ok === true, data, error: data?.error || '' });
      });
    });
    request.once('timeout', () => request.destroy(new Error('timeout')));
    request.once('error', (error) => resolve({ status: 0, ok: false, error: error.message, data: {} }));
    request.end();
  });
}

function compactName(value) {
  return String(value || '').toLocaleLowerCase('de-DE').replace(/[^a-z0-9äöüß]+/g, '');
}

app.whenReady().then(async () => {
  try {
    const saved = JSON.parse(safeStorage.decryptString(readFileSync(sessionFile)));
    const payload = JSON.parse(Buffer.from(String(saved.token || '').split('.')[1] || '', 'base64url').toString('utf8'));
    const guildId = String(payload.manageableGuildIds?.[0] || '');
    if (!guildId) throw new Error('Keine verwaltbare Guild in der gespeicherten Sitzung.');
    const response = await requestJson(saved.token, `/api/guild/${encodeURIComponent(guildId)}/management`);
    if (!response.ok) throw new Error(response.error || `Management API HTTP ${response.status}`);
    const channels = response.data?.management?.channels || [];
    const categories = channels.filter((channel) => channel.isCategory);
    const rootChannels = channels.filter((channel) => !channel.isCategory && !channel.parentId);
    const problems = [];
    const samples = [];
    const wanted = compactName(process.argv[2] || 'team');
    for (const category of categories) {
      const children = channels.filter((channel) => String(channel.parentId || '') === String(category.id));
      for (let index = 1; index < children.length; index += 1) {
        const previous = children[index - 1];
        const current = children[index];
        const previousPosition = Number(previous.rawPosition ?? previous.position ?? 0);
        const currentPosition = Number(current.rawPosition ?? current.position ?? 0);
        const previousId = BigInt(String(previous.id || '0'));
        const currentId = BigInt(String(current.id || '0'));
        if (currentPosition < previousPosition || (currentPosition === previousPosition && currentId < previousId)) {
          problems.push(`${category.name}: "${current.name}" verletzt die Discord-Reihenfolge aus Position und ID.`);
        }
      }
      if (compactName(category.name).includes(wanted)) {
        samples.push({
          category: category.name,
          children: children.map((child) => ({
            name: child.name,
            kind: child.isVoice ? 'voice' : child.isForumLike ? 'forum' : child.isText ? 'text' : 'other',
            position: child.position,
            rawPosition: child.rawPosition,
            sortBucket: child.sortBucket
          }))
        });
      }
    }
    const childIds = new Set();
    for (const category of categories) {
      for (const child of channels.filter((channel) => String(channel.parentId || '') === String(category.id))) childIds.add(String(child.id));
    }
    for (const root of rootChannels) {
      if (childIds.has(String(root.id))) problems.push(`Root-Kanal "${root.name}" wird gleichzeitig als Kategorie-Kind geführt.`);
    }
    const firstCategoryOrder = Math.min(...categories.map((category) => Number(category.displayOrder)).filter(Number.isFinite));
    if (Number.isFinite(firstCategoryOrder)) {
      for (const root of rootChannels) {
        const order = Number(root.displayOrder);
        if (Number.isFinite(order) && order > firstCategoryOrder) {
          problems.push(`Root-Kanal "${root.name}" steht nach der ersten Kategorie statt im Ohne-Kategorie-Block oben.`);
        }
      }
    }
    process.stdout.write(JSON.stringify({
      ok: problems.length === 0,
      categoryCount: categories.length,
      rootCount: rootChannels.length,
      roots: rootChannels.map((channel) => ({
        name: channel.name,
        kind: channel.isVoice ? 'voice' : channel.isForumLike ? 'forum' : channel.isText ? 'text' : 'other',
        position: channel.position,
        rawPosition: channel.rawPosition,
        displayOrder: channel.displayOrder
      })),
      problems,
      samples
    }, null, 2));
    process.exitCode = problems.length ? 1 : 0;
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
