import fs from 'node:fs/promises';
import path from 'node:path';
import { clone } from './utils.js';

const fileQueues = new Map();
// Zeitliche Drosselung der teuren Nebenarbeiten (Backup-Rotation + Directory-
// Sync). Sie laufen nur noch einmal pro Datei und Intervall – der atomare
// Schreibpfad (tmp + rename) selbst bleibt bei jedem Write erhalten, sodass
// die Datenintegrität unverändert gewährleistet ist.
const lastHeavyWriteAt = new Map();
const HEAVY_WRITE_INTERVAL_MS = 60_000;

// true, wenn für diese Datei die teuren Nebenarbeiten (Backup-Rotation,
// Directory-Sync) anstehen: beim allerersten Write immer, danach höchstens
// einmal pro Intervall.
const heavyWriteDue = (filePath) => {
  const key = path.resolve(filePath);
  const last = lastHeavyWriteAt.get(key) || 0;
  if (Date.now() - last >= HEAVY_WRITE_INTERVAL_MS) {
    lastHeavyWriteAt.set(key, Date.now());
    return true;
  }
  return false;
};

const queued = (filePath, task) => {
  const key = path.resolve(filePath);
  const previous = fileQueues.get(key) || Promise.resolve();
  const operation = previous.catch(() => {}).then(task);
  fileQueues.set(key, operation);
  return operation.finally(() => {
    if (fileQueues.get(key) === operation) fileQueues.delete(key);
  });
};

const exists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const syncDirectory = async (directory) => {
  let handle = null;
  try {
    handle = await fs.open(directory, 'r');
    await handle.sync();
  } catch {
    // Directory fsync is not supported on every Windows filesystem.
  } finally {
    await handle?.close().catch(() => {});
  }
};

const rotateBackups = async (filePath, backupLimit) => {
  if (!(await exists(filePath)) || backupLimit < 1) return;
  for (let index = backupLimit; index >= 2; index -= 1) {
    const older = `${filePath}.bak.${index - 1}`;
    const newer = `${filePath}.bak.${index}`;
    await fs.rm(newer, { force: true }).catch(() => {});
    if (await exists(older)) await fs.rename(older, newer);
  }
  await fs.copyFile(filePath, `${filePath}.bak.1`);
};

const replaceFile = async (temporaryFile, filePath) => {
  try {
    await fs.rename(temporaryFile, filePath);
    return;
  } catch (error) {
    if (!['EEXIST', 'EPERM', 'EACCES'].includes(error?.code) || !(await exists(filePath))) throw error;
  }
  const displaced = `${filePath}.replace-${process.pid}-${Date.now()}`;
  await fs.rename(filePath, displaced);
  try {
    await fs.rename(temporaryFile, filePath);
    await fs.rm(displaced, { force: true });
  } catch (error) {
    if (!(await exists(filePath)) && await exists(displaced)) await fs.rename(displaced, filePath).catch(() => {});
    throw error;
  }
};

export async function atomicWriteJson(filePath, value, options = {}) {
  const backupLimit = Math.max(0, Math.min(20, Number(options.backupLimit ?? 5)));
  const spacing = Number.isInteger(options.spacing) ? options.spacing : 2;
  const heavy = heavyWriteDue(filePath);
  return queued(filePath, async () => {
    const directory = path.dirname(filePath);
    await fs.mkdir(directory, { recursive: true });
    const temporaryFile = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    const payload = `${JSON.stringify(value, null, spacing)}\n`;
    let handle = null;
    try {
      handle = await fs.open(temporaryFile, 'wx', 0o600);
      await handle.writeFile(payload, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      // Backup-Rotation und Directory-Sync sind teuer (komplette Datei-Kopien)
      // und werden zeitlich gedrosselt ausgeführt. Der atomare Ersatz der
      // Hauptdatei (tmp + rename) passiert bei jedem Write.
      if (heavy) {
        await rotateBackups(filePath, backupLimit);
        await syncDirectory(directory);
      }
      await replaceFile(temporaryFile, filePath);
      return { ok: true, bytes: Buffer.byteLength(payload), writtenAt: new Date().toISOString() };
    } catch (error) {
      await handle?.close().catch(() => {});
      await fs.rm(temporaryFile, { force: true }).catch(() => {});
      throw error;
    }
  });
}

export async function readJsonWithRecovery(filePath, options = {}) {
  const backupLimit = Math.max(1, Math.min(20, Number(options.backupLimit ?? 5)));
  const validate = typeof options.validate === 'function' ? options.validate : () => true;
  const candidates = [
    filePath,
    `${filePath}.bak`,
    ...Array.from({ length: backupLimit }, (_, index) => `${filePath}.bak.${index + 1}`)
  ];
  const failures = [];
  for (const candidate of candidates) {
    try {
      const raw = await fs.readFile(candidate, 'utf8');
      const value = JSON.parse(raw.replace(/^\uFEFF/, ''));
      if (!validate(value)) throw new Error('JSON structure is invalid');
      return {
        value,
        source: candidate === filePath ? 'primary' : path.basename(candidate),
        recovered: candidate !== filePath,
        failures
      };
    } catch (error) {
      if (error?.code !== 'ENOENT') failures.push({ file: path.basename(candidate), error: String(error?.message || error) });
    }
  }
  return { value: clone(options.fallback ?? {}), source: 'fallback', recovered: false, failures };
}

export async function createMigrationSnapshot(filePath, value, label = 'pre-migration') {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const folder = path.join(path.dirname(filePath), 'migrations');
  const snapshot = path.join(folder, `${path.basename(filePath, path.extname(filePath))}.${label}.${stamp}.json`);
  await atomicWriteJson(snapshot, value, { backupLimit: 0 });
  return snapshot;
}
