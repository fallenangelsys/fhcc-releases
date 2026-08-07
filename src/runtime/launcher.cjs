const { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { installDiscordEventBridge } = require('./discord-event-bridge.cjs');

const runtimeRoot = process.env.FALLEN_HEAVEN_RUNTIME_DIR || process.cwd();
const dataRoot = process.env.FALLEN_HEAVEN_DATA_DIR || path.join(runtimeRoot, 'data');
const logDir = path.join(runtimeRoot, 'logs');
const crashLog = path.join(logDir, 'bot-crash.log');
mkdirSync(logDir, { recursive: true });
mkdirSync(dataRoot, { recursive: true });

const desktopParentPid = Number.parseInt(String(process.env.FALLEN_HEAVEN_PARENT_PID || ''), 10);
let parentExitStarted = false;
const exitWhenDesktopCloses = () => {
  if (parentExitStarted) return;
  parentExitStarted = true;
  process.exit(0);
};

if (typeof process.send === 'function') {
  process.once('disconnect', exitWhenDesktopCloses);
}

if (Number.isFinite(desktopParentPid) && desktopParentPid > 0) {
  const parentWatchTimer = setInterval(() => {
    try {
      process.kill(desktopParentPid, 0);
    } catch {
      exitWhenDesktopCloses();
    }
  }, 1500);
  parentWatchTimer.unref();
}

function logCrash(kind, error) {
  const stack = String(error?.stack || error?.message || error || 'Unbekannter Fehler')
    .replace(/\b(?:mfa\.)?[A-Za-z0-9_-]{15,30}\.[A-Za-z0-9_-]{5,8}\.[A-Za-z0-9_-]{20,50}\b/g, '[DISCORD-TOKEN GESCHÜTZT]')
    .replace(/\b(?:sk|key|token|secret)[-_]?[A-Za-z0-9_-]{20,}\b/gi, '[SECRET GESCHÜTZT]');
  try { appendFileSync(crashLog, `[${new Date().toISOString()}] ${kind}\n${stack}\n\n`, 'utf8'); } catch {}
}

process.on('uncaughtException', (error) => {
  logCrash('Unbehandelter Ausnahmefehler', error);
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 50).unref();
});
process.on('unhandledRejection', (error) => {
  logCrash('Nicht behandelte Promise-Ablehnung', error);
  try {
    if (typeof process.send === 'function') {
      process.send({
        type: 'runtime:warning',
        payload: {
          code: String(error?.code || error?.name || 'UNHANDLED_REJECTION'),
          message: String(error?.message || error || 'Unbekannter Promise-Fehler').slice(0, 500)
        }
      });
    }
  } catch {}
});

let previousCpu = process.cpuUsage();
let previousCpuAt = process.hrtime.bigint();
const metricsTimer = setInterval(() => {
  if (typeof process.send !== 'function') return;
  const now = process.hrtime.bigint();
  const usage = process.cpuUsage(previousCpu);
  const elapsedMicros = Number(now - previousCpuAt) / 1000;
  previousCpu = process.cpuUsage();
  previousCpuAt = now;
  const memory = process.memoryUsage();
  process.send({
    type: 'runtime:metrics',
    payload: {
      cpuPercent: elapsedMicros > 0 ? Math.min(100, Math.round(((usage.user + usage.system) / elapsedMicros) * 1000) / 10) : 0,
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      uptimeSeconds: Math.floor(process.uptime()),
      measuredAt: new Date().toISOString()
    }
  });
}, 2500);
metricsTimer.unref();

function collectFiles(root, output = []) {
  if (!existsSync(root)) return output;
  for (const name of readdirSync(root)) {
    const target = path.join(root, name);
    let stat;
    try { stat = statSync(target); } catch { continue; }
    if (stat.isDirectory()) collectFiles(target, output);
    else output.push({ target, size: stat.size, modified: stat.mtimeMs });
  }
  return output;
}

function pruneContext() {
  const retentionMs = 30 * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - retentionMs;
  const contextRoot = path.join(dataRoot, 'server-context');
  for (const file of collectFiles(contextRoot)) {
    if (file.modified >= cutoff || !/\.(?:jsonl|log|tmp)$/i.test(file.target)) continue;
    try { rmSync(file.target, { force: true }); } catch {}
  }
}

function enforceIndexBudget() {
  const maximumBytes = 50 * 1024 * 1024 * 1024;
  const indexRoot = path.join(dataRoot, 'server-index');
  const files = collectFiles(indexRoot)
    .filter((file) => /\.(?:jsonl|log)$/i.test(file.target))
    .sort((left, right) => left.modified - right.modified);
  let total = files.reduce((sum, file) => sum + file.size, 0);
  for (const file of files) {
    if (total <= maximumBytes) break;
    try {
      rmSync(file.target, { force: true });
      total -= file.size;
    } catch {}
  }
}

function backupCriticalData() {
  const backupRoot = path.join(runtimeRoot, 'backups');
  const day = new Date().toISOString().slice(0, 10);
  const targetRoot = path.join(backupRoot, day);
  if (existsSync(targetRoot)) return;
  mkdirSync(targetRoot, { recursive: true });
  const excluded = /[\\/](?:server-index|server-context|ai-memory|backups)[\\/]/i;
  for (const file of collectFiles(dataRoot)) {
    if (excluded.test(file.target) || !/\.json$/i.test(file.target) || file.size > 20 * 1024 * 1024) continue;
    const relative = path.relative(dataRoot, file.target);
    const destination = path.join(targetRoot, relative);
    try {
      mkdirSync(path.dirname(destination), { recursive: true });
      copyFileSync(file.target, destination);
    } catch {}
  }
  const backups = readdirSync(backupRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  while (backups.length > 14) {
    const oldest = backups.shift();
    try { rmSync(path.join(backupRoot, oldest), { recursive: true, force: true }); } catch {}
  }
}

setTimeout(() => {
  try { pruneContext(); } catch (error) { logCrash('Context-Bereinigung', error); }
  try { enforceIndexBudget(); } catch (error) { logCrash('Index-Speicherlimit', error); }
  try { backupCriticalData(); } catch (error) { logCrash('Datensicherung', error); }
}, 1500).unref();

const entry = process.env.FALLEN_HEAVEN_BOT_ENTRY;
if (!entry || !existsSync(entry)) {
  logCrash('Startfehler', new Error('Bot-Einstiegspunkt wurde nicht gefunden.'));
  process.exit(1);
}

installDiscordEventBridge();

import(pathToFileURL(entry).href).catch((error) => {
  logCrash('Importfehler', error);
  process.exit(1);
});
