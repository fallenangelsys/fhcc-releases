const { appendFileSync, existsSync, mkdirSync } = require('node:fs');
const { promises: fsp } = require('node:fs');
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

// Start-Hausarbeit LÄUFT ASYNCHRON: Ein synchroner Baum-Scan (z.B. über die
// tausende JSONL-Dateien des Server-Index) würde den Event-Loop direkt nach
// dem Start blockieren – genau dann, wenn die ersten Interaktionen eintreffen
// und die 3-Sekunden-Bestätigung zählt („Fallen-Heaven hat nicht rechtzeitig
// reagiert“). Alle drei Aufgaben laufen nacheinander und nie blockierend.
const CONCURRENT_WALK_LIMIT = 16;

const pathExists = async (target) => {
  try { await fsp.access(target); return true; } catch { return false; }
};

// Sammelt Dateien eines Baums asynchron (mit begrenzter Nebenläufigkeit). Nur
// Dateien, deren Name dem Filter entspricht, bekommen einen stat – so bleibt
// der Scan über den großen Server-Index günstig.
const collectFilesAsync = async (root, filter = null, output = []) => {
  let entries;
  try { entries = await fsp.readdir(root, { withFileTypes: true }); } catch { return output; }
  for (let index = 0; index < entries.length; index += CONCURRENT_WALK_LIMIT) {
    const batch = entries.slice(index, index + CONCURRENT_WALK_LIMIT);
    const results = await Promise.all(batch.map(async (entry) => {
      const target = path.join(root, entry.name);
      if (entry.isDirectory()) {
        return { dirs: [target], files: [] };
      }
      if (filter && !filter.test(entry.name)) return { dirs: [], files: [] };
      try {
        const stat = await fsp.stat(target);
        return { dirs: [], files: [{ target, size: stat.size, modified: stat.mtimeMs }] };
      } catch {
        return { dirs: [], files: [] };
      }
    }));
    for (const result of results) {
      output.push(...result.files);
      for (const dir of result.dirs) await collectFilesAsync(dir, filter, output);
    }
  }
  return output;
};

// Integritätsprüfung aus dem Serverindex (gleicher Prozess, gleiche
// Modulinstanz wie der Bot): JSONL-Dateien werden nur gelöscht, wenn jede
// Zeile nachweislich im SQLite-Index liegt und keine Zeile unlesbar ist.
let indexIntegrityCheckPromise = null;
const ensureIndexIntegrityCheck = () => {
  if (!indexIntegrityCheckPromise) {
    indexIntegrityCheckPromise = import(pathToFileURL(path.join(__dirname, '../serverIndexStore.js')).href)
      .then((mod) => mod.verifyServerIndexJsonlMigrated)
      .catch((error) => {
        indexIntegrityCheckPromise = null;
        logCrash('Integritätsprüfung', error);
        return null;
      });
  }
  return indexIntegrityCheckPromise;
};

const canDeleteFile = async (file) => {
  if (!/\.jsonl$/i.test(file.target)) return true; // log/tmp sind regenerierbar
  const verify = await ensureIndexIntegrityCheck();
  if (typeof verify !== 'function') return false; // Prüfung nicht verfügbar -> NICHT löschen
  const outcome = await verify(file.target).catch(() => null);
  if (!outcome) return false;
  return Number(outcome.missing || 0) === 0 && Number(outcome.unparsed || 0) === 0;
};

// Alte Kontext-Dateien (älter als 30 Tage) entfernen.
const pruneContext = async () => {
  const retentionMs = 30 * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - retentionMs;
  const contextRoot = path.join(dataRoot, 'server-context');
  const files = await collectFilesAsync(contextRoot, /\.(?:jsonl|log|tmp)$/i);
  for (const file of files) {
    if (file.modified >= cutoff) continue;
    if (!(await canDeleteFile(file))) continue;
    try { await fsp.rm(file.target, { force: true }); } catch {}
  }
};

// Index-Speicherlimit durchsetzen (älteste JSONL/Log-Dateien zuerst löschen).
const enforceIndexBudget = async () => {
  const maximumBytes = 50 * 1024 * 1024 * 1024;
  const indexRoot = path.join(dataRoot, 'server-index');
  const files = (await collectFilesAsync(indexRoot, /\.(?:jsonl|log)$/i))
    .sort((left, right) => left.modified - right.modified);
  let total = files.reduce((sum, file) => sum + file.size, 0);
  for (const file of files) {
    if (total <= maximumBytes) break;
    if (!(await canDeleteFile(file))) continue;
    try {
      await fsp.rm(file.target, { force: true });
      total -= file.size;
    } catch {}
  }
};

// Tägliches Backup der kritischen JSON-Dateien (ohne Index/Kontext/AI-Speicher).
const backupCriticalData = async () => {
  const backupRoot = path.join(runtimeRoot, 'backups');
  const day = new Date().toISOString().slice(0, 10);
  const targetRoot = path.join(backupRoot, day);
  if (await pathExists(targetRoot)) return;
  await fsp.mkdir(targetRoot, { recursive: true });
  const excluded = /[\\/](?:server-index|server-context|ai-memory|backups)[\\/]/i;
  const files = await collectFilesAsync(dataRoot, /\.json$/i);
  for (const file of files) {
    if (excluded.test(file.target) || file.size > 20 * 1024 * 1024) continue;
    const relative = path.relative(dataRoot, file.target);
    const destination = path.join(targetRoot, relative);
    try {
      await fsp.mkdir(path.dirname(destination), { recursive: true });
      await fsp.copyFile(file.target, destination);
    } catch {}
  }
  const backups = (await fsp.readdir(backupRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  while (backups.length > 14) {
    const oldest = backups.shift();
    try { await fsp.rm(path.join(backupRoot, oldest), { recursive: true, force: true }); } catch {}
  }
};

setTimeout(() => {
  void (async () => {
    try { await pruneContext(); } catch (error) { logCrash('Context-Bereinigung', error); }
    try { await enforceIndexBudget(); } catch (error) { logCrash('Index-Speicherlimit', error); }
    try { await backupCriticalData(); } catch (error) { logCrash('Datensicherung', error); }
  })();
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
