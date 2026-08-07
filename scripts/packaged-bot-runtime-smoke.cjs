const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const executable = path.join(root, 'dist', 'win-unpacked', 'FHCC.exe');
const appAsar = path.join(root, 'dist', 'win-unpacked', 'resources', 'app.asar');
const launcher = path.join(appAsar, 'src', 'runtime', 'launcher.cjs');
const entry = path.join(appAsar, 'src', 'index.js');
const controlToken = 'packaged-smoke-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
const instanceId = 'packaged-smoke-instance';

assert.ok(fs.existsSync(executable), 'Gepackte FHCC-EXE fehlt.');
assert.ok(fs.existsSync(appAsar), 'Gepacktes app.asar fehlt.');

const runtimeProbe = path.join(appAsar, 'scripts', 'packaged-runtime-probe.cjs');
const probe = spawnSync(executable, [runtimeProbe], {
  cwd: path.dirname(executable),
  windowsHide: true,
  encoding: 'utf8',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
});
assert.equal(probe.status, 0, `Gepackte Laufzeitprobe fehlgeschlagen.\n${probe.stderr || probe.stdout}`);
const probeResult = JSON.parse(String(probe.stdout || '{}'));
assert.equal(probeResult.packagedAsar, true, 'Laufzeitprobe wurde nicht aus app.asar ausgeführt.');
assert.equal(Number(probeResult.modules), 148, 'Gepackte Electron-ABI stimmt nicht.');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function health(port) {
  return new Promise((resolve) => {
    const request = http.get({
      hostname: '127.0.0.1',
      port,
      path: '/api/app/health',
      headers: {
        'x-fallen-heaven-app': 'desktop-control-v2',
        'x-fallen-heaven-control': controlToken
      },
      timeout: 1200
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try { resolve({ status: response.statusCode, body: JSON.parse(body) }); }
        catch { resolve(null); }
      });
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(null));
  });
}

async function waitForHealth(port, child, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return null;
    const result = await health(port);
    if (result?.status === 200 && result.body?.serviceReady) return result.body;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return null;
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 4000))
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

(async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fhcc-packaged-smoke-'));
  const port = await freePort();
  const output = [];
  const child = spawn(executable, [launcher], {
    cwd: runtimeRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      DISCORD_TOKEN: '',
      DISCORD_CLIENT_ID: '',
      DISCORD_CLIENT_SECRET: '',
      DASHBOARD_SESSION_SECRET: 'packaged-smoke-session-secret-0123456789abcdefghijklmnopqrstuvwxyz',
      FALLEN_HEAVEN_APP_ROOT: appAsar,
      FALLEN_HEAVEN_RUNTIME_DIR: runtimeRoot,
      FALLEN_HEAVEN_DATA_DIR: path.join(runtimeRoot, 'data'),
      FALLEN_HEAVEN_BOT_ENTRY: entry,
      FALLEN_HEAVEN_CONTROL_TOKEN: controlToken,
      FALLEN_HEAVEN_INSTANCE_ID: instanceId,
      FALLEN_HEAVEN_PARENT_PID: String(process.pid),
      HOST: '127.0.0.1',
      PORT: String(port),
      DASHBOARD_PORT: String(port),
      PUBLIC_WEB_PORT: '0',
      PUBLIC_HTTPS_PORT: '0'
    }
  });
  child.stdout.on('data', (chunk) => output.push(String(chunk)));
  child.stderr.on('data', (chunk) => output.push(String(chunk)));
  try {
    const status = await waitForHealth(port, child);
    assert.ok(status, `Gepackter Bot-Dienst wurde nicht bereit.\n${output.join('').slice(-4000)}`);
    assert.equal(status.serviceReady, true);
    assert.equal(status.discordReady, false, 'Probe darf keine echte Discord-Sitzung öffnen.');
    assert.ok(status.runtimeVersion, 'Gepackte Node-Laufzeit wurde nicht gemeldet.');
    assert.ok(status.electronVersion, 'Gepackte Electron-Laufzeit wurde nicht gemeldet.');
    assert.ok(fs.existsSync(path.join(runtimeRoot, 'data')), 'Externer Datenordner wurde nicht erzeugt.');
    assert.doesNotMatch(output.join(''), /NODE_MODULE_VERSION|better_sqlite3\.node.*compiled against/i);
    console.log(`Packaged-Bot-Smoke bestanden: Electron ${status.electronVersion}, Node ${status.runtimeVersion}, ABI ${status.moduleAbi}, keine Discord-Verbindung und kein Native-Modul-Fehler.`);
  } finally {
    await stopChild(child);
    const resolvedTemp = path.resolve(runtimeRoot);
    if (resolvedTemp.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
      fs.rmSync(resolvedTemp, { recursive: true, force: true });
    }
  }
})().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
