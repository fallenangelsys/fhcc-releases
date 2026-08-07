#!/usr/bin/env node
const {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  appendFileSync,
  openSync,
  closeSync,
  statSync
} = require('node:fs');
const { dirname, join, resolve } = require('node:path');
const { spawn, execSync, execFileSync } = require('node:child_process');
const http = require('node:http');
const process = require('node:process');

const launchedAsControllerExe = Boolean(process.versions?.pkg) || /\\botctl\.exe$/i.test(process.execPath || '');
const root = launchedAsControllerExe ? resolve(dirname(process.execPath), '..') : resolve(process.cwd());
const runtime = join(root, 'runtime');
const pidFile = join(runtime, 'bot.pid');
const lockFile = join(runtime, 'bot.lock');
const operationLockFile = join(runtime, 'bot.operation.lock');
const botExe = join(root, 'dist', 'discord-bot.exe');
const configuredBotScript = String(process.env.FALLEN_HEAVEN_BOT_SCRIPT || '').trim();
const configuredNodeExecutable = String(process.env.FALLEN_HEAVEN_NODE_EXECUTABLE || '').trim();
const botScript = configuredBotScript || join(root, 'src', 'index.js');
const botCtlLog = join(runtime, 'botctl.log');
const isPkgExe = launchedAsControllerExe;
const resolveNodeExecutable = () => {
  try {
    const raw = execSync('where.exe node', { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const first = String(raw).split(/\r?\n/).map((item) => item.trim()).find(Boolean);
    return first || null;
  } catch {
    return null;
  }
};

const nodeExecutable = resolveNodeExecutable();
const fallbackNodeCommand = isPkgExe ? (nodeExecutable || 'node') : process.execPath;
const hasNodeBinary = Boolean(nodeExecutable);

mkdirSync(runtime, { recursive: true });

const cliArgs = process.argv.slice(2);
const action = String(cliArgs[0] || '').toLowerCase();
const options = new Set(cliArgs.slice(1).map((item) => String(item || '').toLowerCase()));
const interactive = options.has('--window') || options.has('--console') || options.has('--verbose') || Boolean(process.stdout?.isTTY);
const dashboardOnly = options.has('--dashboard-only');

const timestamp = () => new Date().toISOString().replace('T', ' ').replace('Z', '');
const logToFile = (message) => {
  appendFileSync(botCtlLog, `[${timestamp()}] ${String(message || '')}\n`, 'utf8');
};

const readPid = () => {
  if (!existsSync(pidFile)) {
    return null;
  }

  const text = readFileSync(pidFile, 'utf8').trim();
  const pid = Number.parseInt(text, 10);
  return Number.isFinite(pid) ? pid : null;
};

const readLockPid = () => {
  if (!existsSync(lockFile)) {
    return null;
  }

  const raw = readFileSync(lockFile, 'utf8').trim();
  try {
    const data = JSON.parse(raw);
    const pid = Number.parseInt(String(data?.pid || ''), 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) ? pid : null;
  }
};

const writePid = (pid) => writeFileSync(pidFile, String(pid), 'utf8');
const writeLock = (pid) =>
  writeFileSync(
    lockFile,
    JSON.stringify(
      {
        pid,
        root,
        startedAt: new Date().toISOString()
      },
      null,
      2
    ),
    'utf8'
  );
const clearPid = () => {
  if (existsSync(pidFile)) {
    rmSync(pidFile);
  }
};
const clearLock = () => {
  if (existsSync(lockFile)) {
    rmSync(lockFile);
  }
};

const isRunning = (pid) => {
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

const getProcessCommandLine = (pid) => {
  if (process.platform !== 'win32') {
    return '';
  }

  try {
    return String(execFileSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}" -ErrorAction SilentlyContinue).CommandLine`
    ], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }) || '').trim();
  } catch {
    return '';
  }
};

const getProcessName = (pid) => {
  if (process.platform !== 'win32') {
    return '';
  }
  try {
    return String(execFileSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}" -ErrorAction SilentlyContinue).Name`
    ], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }) || '').trim().toLowerCase();
  } catch {
    return '';
  }
};

const normalizedPath = (value) => String(value || '').replace(/\//g, '\\').toLowerCase();
const isManagedBotProcess = (pid) => {
  if (!isRunning(pid)) {
    return false;
  }
  const processName = getProcessName(pid);
  if (!['node.exe', 'electron.exe', 'discord-bot.exe'].includes(processName)) {
    return false;
  }
  const commandLine = normalizedPath(getProcessCommandLine(pid));
  return Boolean(commandLine && (
    commandLine.includes(normalizedPath(botScript))
    || commandLine.includes(normalizedPath(botExe))
  ));
};

const findManagedBotPids = () => {
  const known = new Set([readPid(), readLockPid()].filter(Boolean));
  if (process.platform === 'win32') {
    try {
      const raw = execFileSync('powershell.exe', [
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress'
      ], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      const parsed = JSON.parse(String(raw || '[]'));
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      for (const row of rows) {
        if (!['node.exe', 'electron.exe', 'discord-bot.exe'].includes(String(row?.Name || '').toLowerCase())) {
          continue;
        }
        const commandLine = normalizedPath(row?.CommandLine);
        if (commandLine.includes(normalizedPath(botScript)) || commandLine.includes(normalizedPath(botExe))) {
          known.add(Number(row.ProcessId));
        }
      }
    } catch {}
  }
  return [...known].filter((pid) => Number.isFinite(pid) && isManagedBotProcess(pid));
};

const getKnownRunningPid = () => {
  const pid = readPid();
  if (isManagedBotProcess(pid)) {
    return pid;
  }

  const locked = readLockPid();
  if (isManagedBotProcess(locked)) {
    writePid(locked);
    return locked;
  }

  const recovered = findManagedBotPids()[0];
  if (recovered) {
    writePid(recovered);
    writeLock(recovered);
    return recovered;
  }

  if (existsSync(pidFile)) {
    clearPid();
  }
  if (existsSync(lockFile)) {
    clearLock();
  }

  return null;
};

const killProcessTree = (pid) => {
  if (!pid || !isRunning(pid)) {
    return false;
  }

  if (process.platform === 'win32') {
    try {
      const raw = execSync('pm2.cmd jlist', { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'ignore'] });
      const apps = JSON.parse(String(raw || '[]'));
      const managed = Array.isArray(apps) ? apps.find((entry) => Number(entry?.pid) === Number(pid)) : null;
      if (managed && Number.isFinite(Number(managed.pm_id))) {
        execSync(`pm2.cmd stop ${Number(managed.pm_id)}`, { shell: true, stdio: 'ignore' });
      }
    } catch {}
    try {
      execSync(`taskkill /PID ${pid} /T /F`, { shell: true, stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  try {
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
};

const spawnBotProcess = (command, args = [], label = 'bot') => {
  const commandName = String(command || '').split(/[\\/]/).pop();
  const configuredCommandName = String(configuredNodeExecutable || '').split(/[\\/]/).pop();
  const needsElectronNodeMode =
    Boolean(configuredNodeExecutable) &&
    !/^node(?:\.exe)?$/i.test(commandName || configuredCommandName || '');

  const outputDescriptor = interactive ? null : openSync(botCtlLog, 'a');
  const child = spawn(command, args, {
    cwd: root,
    detached: true,
    stdio: interactive ? ['ignore', 'pipe', 'pipe'] : ['ignore', outputDescriptor, outputDescriptor],
    windowsHide: !interactive,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: needsElectronNodeMode ? '1' : String(process.env.ELECTRON_RUN_AS_NODE || ''),
      FALLEN_HEAVEN_APP_ROOT: root,
      FALLEN_HEAVEN_START_OFFLINE: dashboardOnly ? '1' : String(process.env.FALLEN_HEAVEN_START_OFFLINE || '')
    }
  });

  if (outputDescriptor !== null) {
    closeSync(outputDescriptor);
  }

  if (interactive) {
    child.stdout?.on('data', (chunk) => {
      process.stdout.write(`[${label}] ${String(chunk)}`);
    });
    child.stderr?.on('data', (chunk) => {
      process.stderr.write(`[${label}] ${String(chunk)}`);
    });
  }

  child.on('error', (error) => {
    const message = `${label} konnte nicht gestartet werden: ${error?.message || error}`;
    if (interactive) {
      console.error(message);
    }
    logToFile(message);
  });

  return child;
};

const releaseChildOutput = (child) => {
  child.stdout?.removeAllListeners('data');
  child.stderr?.removeAllListeners('data');
  child.stdout?.unref?.();
  child.stderr?.unref?.();
};

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const readHealth = () => new Promise((resolveHealth) => {
  const request = http.request({
    hostname: '127.0.0.1',
    port: Number(process.env.DASHBOARD_PORT || 3000),
    path: '/api/app/health',
    method: 'GET',
    headers: { 'x-fallen-heaven-app': 'desktop-control-v1' },
    timeout: 1200
  }, (response) => {
    let raw = '';
    response.setEncoding('utf8');
    response.on('data', (chunk) => { raw += chunk; });
    response.on('end', () => {
      try {
        resolveHealth(response.statusCode === 200 ? JSON.parse(raw) : null);
      } catch {
        resolveHealth(null);
      }
    });
  });
  request.once('timeout', () => request.destroy());
  request.once('error', () => resolveHealth(null));
  request.end();
});

const waitForHealthy = async (pid, timeoutMs = 30000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isManagedBotProcess(pid)) {
      return null;
    }
    const health = await readHealth();
    if (health?.ok && Number(health.processId) === Number(pid)) {
      return health;
    }
    await delay(300);
  }
  return null;
};

const waitForStopped = async (pids, timeoutMs = 12000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!pids.some((pid) => isManagedBotProcess(pid))) {
      return true;
    }
    await delay(200);
  }
  return !pids.some((pid) => isManagedBotProcess(pid));
};

const withOperationLock = async (operation) => {
  let descriptor = null;
  try {
    try {
      descriptor = openSync(operationLockFile, 'wx');
    } catch (error) {
      if (error?.code === 'EEXIST') {
        try {
          if (Date.now() - statSync(operationLockFile).mtimeMs > 60000) {
            rmSync(operationLockFile, { force: true });
            descriptor = openSync(operationLockFile, 'wx');
          }
        } catch {}
      }
      if (descriptor === null) {
        throw new Error('Eine andere Bot-Aktion läuft bereits. Bitte kurz warten.');
      }
    }
    writeFileSync(descriptor, `${process.pid}\n`, 'utf8');
    return await operation();
  } finally {
    if (descriptor !== null) {
      try { closeSync(descriptor); } catch {}
      try { rmSync(operationLockFile, { force: true }); } catch {}
    }
  }
};

const start = async () => {
  const existing = getKnownRunningPid();
  if (existing) {
    console.log(`Bot laeuft bereits (PID ${existing}).`);
    return;
  }

  // The desktop app provides an explicit script path together with its
  // production dependency tree. Prefer it; use the legacy EXE only as a
  // fallback for standalone controller launches.
  const allowLegacyExe = options.has('--direct-exe') && options.has('--allow-broken-legacy-exe');
  const useExe = allowLegacyExe && !configuredBotScript && !existsSync(botScript) && existsSync(botExe);
  if (!useExe && !configuredBotScript && !existsSync(botScript)) {
    throw new Error(`Weder ${botExe} noch ${botScript} gefunden.`);
  }

  const command = useExe ? botExe : (configuredNodeExecutable || fallbackNodeCommand);
  const args = useExe ? [] : [botScript];
  const label = useExe ? 'discord-bot.exe' : 'node src/index.js';

  logToFile(`Starte ${label}`);
  const child = spawnBotProcess(command, args, label);
  child.unref();
  writePid(child.pid);
  writeLock(child.pid);

  const health = await waitForHealthy(child.pid);
  if (health) {
    releaseChildOutput(child);
    console.log(`Bot gestartet (PID ${child.pid}, Discord: ${health.discordReady ? 'verbunden' : 'wird verbunden'}).`);
    return;
  }

  killProcessTree(child.pid);
  clearPid();
  clearLock();
  if (!useExe) {
    logToFile(`Startversuch (${label}) fehlgeschlagen.`);
    throw new Error(`Bot node-Script startete nicht. Details in ${botCtlLog}.`);
  }

  console.log(`Fehler: Bot exe startete nicht; fallback auf Node-Script.`);
  if (!hasNodeBinary) {
    clearPid();
    clearLock();
    logToFile(`Fallback startete nicht.`);
    console.log('Fehler: Kein Node.js Binary verfügbar. Entweder Discord-Bot EXE reparieren oder Node installieren.');
    return;
  }

  const fallback = spawnBotProcess(fallbackNodeCommand, [botScript], 'node-fallback');
  fallback.unref();
  writePid(fallback.pid);
  writeLock(fallback.pid);
  logToFile(`Fallback gestartet mit PID ${fallback.pid}`);

  const fallbackHealth = await waitForHealthy(fallback.pid);
  if (fallbackHealth) {
    releaseChildOutput(fallback);
    console.log(`Fallback gestartet (PID ${fallback.pid}, modus: node).`);
    return;
  }

  killProcessTree(fallback.pid);
  clearPid();
  clearLock();
  logToFile(`Fallback startete nicht.`);
  console.log('Fehler: Bot konnte nicht gestartet werden. Bitte .env prüfen (DISCORD_TOKEN gesetzt?).');
};

const stop = async () => {
  const pids = findManagedBotPids();
  if (!pids.length) {
    clearPid();
    clearLock();
    console.log('Bot ist nicht aktiv.');
    return;
  }

  pids.forEach(killProcessTree);
  const stopped = await waitForStopped(pids);
  if (!stopped) {
    throw new Error(`Bot-Prozess konnte nicht vollständig beendet werden (PID ${pids.join(', ')}).`);
  }
  clearPid();
  clearLock();
  console.log(`Bot vollständig gestoppt (PID ${pids.join(', ')}).`);
};

const status = async () => {
  const pid = getKnownRunningPid();
  if (pid) {
    const health = await readHealth();
    console.log(health?.ok && Number(health.processId) === Number(pid)
      ? `Bot ist aktiv (PID ${pid}, Discord: ${health.discordReady ? 'verbunden' : 'wird verbunden'}).`
      : `Bot-Prozess startet noch (PID ${pid}).`);
    return;
  }

  console.log('Bot ist nicht aktiv.');
};

const restart = async () => {
  await stop();
  await delay(600);
  await start();
};

const buildBotExe = () => {
  execSync('npm run package:bot', { stdio: 'inherit', shell: true });
};

const buildControllerExe = () => {
  execSync('npm run package:ctl', { stdio: 'inherit', shell: true });
};

const buildAll = () => {
  execSync('npm run package:all', { stdio: 'inherit', shell: true });
};

const onError = (error) => {
  console.error(String(error?.message || error));
  process.exitCode = 1;
};

if (action === 'start') {
  void withOperationLock(start).catch(onError);
} else if (action === 'stop') {
  void withOperationLock(stop).catch(onError);
} else if (action === 'restart') {
  void withOperationLock(restart).catch(onError);
} else if (action === 'status') {
  void status().catch(onError);
} else if (action === 'build:bot') {
  buildBotExe();
} else if (action === 'build:ctl') {
  buildControllerExe();
} else if (action === 'build:all') {
  buildAll();
} else {
  console.log('Verwendung: node botctl.cjs <start|stop|restart|status|build:bot|build:ctl|build:all> [--window|--console|--verbose]');
}
