import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteJson } from './atomicJsonStore.js';

const DATA_SCHEMA_VERSION = 4;
const APP_GENERATION = '4.0';
const DATA_ROOT = path.resolve(
  String(process.env.FALLEN_HEAVEN_DATA_DIR || '').trim() || path.join(process.cwd(), 'data')
);
const MANIFEST_FILE = path.join(DATA_ROOT, 'app-data-manifest.json');

const PERSISTED_JSON_FILES = [
  'guild-configs.json',
  'guild-configs.json.meta.json',
  'reaction-role-rules.json',
  'boost-role-ledger.json',
  'heaven-economy.json',
  'heaven-economy-panels.json',
  'channel-message-counters.json',
  'member-management.json',
  'leveling-progress.json',
  'diagnostic-history.json'
];

const exists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

async function readManifest() {
  try {
    const raw = await fs.readFile(MANIFEST_FILE, 'utf8');
    const value = JSON.parse(raw.replace(/^\uFEFF/, ''));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

async function inspectPersistedFile(fileName) {
  const source = path.join(DATA_ROOT, fileName);
  if (!(await exists(source))) {
    return { file: fileName, present: false, valid: true, bytes: 0, sha256: null };
  }

  const buffer = await fs.readFile(source);
  let valid = true;
  let rootType = 'unknown';
  let error = null;
  try {
    const parsed = JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/, ''));
    rootType = Array.isArray(parsed) ? 'array' : parsed === null ? 'null' : typeof parsed;
  } catch (parseError) {
    valid = false;
    error = String(parseError?.message || parseError).slice(0, 240);
  }

  return {
    file: fileName,
    present: true,
    valid,
    rootType,
    bytes: buffer.byteLength,
    sha256: sha256(buffer),
    ...(error ? { error } : {})
  };
}

async function snapshotPersistedFiles(items) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const folder = path.join(DATA_ROOT, 'migrations', `generation-v4-${stamp}`);
  await fs.mkdir(folder, { recursive: true });

  for (const item of items) {
    if (!item.present) continue;
    await fs.copyFile(path.join(DATA_ROOT, item.file), path.join(folder, item.file));
  }

  await atomicWriteJson(path.join(folder, 'snapshot-manifest.json'), {
    schemaVersion: DATA_SCHEMA_VERSION,
    appGeneration: APP_GENERATION,
    createdAt: new Date().toISOString(),
    files: items
  }, { backupLimit: 0 });
  return path.relative(DATA_ROOT, folder).replaceAll('\\', '/');
}

/**
 * Generation 4 keeps every established feature format compatible. The migration
 * therefore validates and snapshots all primary stores before the normal feature
 * loaders normalize them. No user data is discarded or silently rewritten.
 */
export async function migrateDataGenerationV4() {
  await fs.mkdir(DATA_ROOT, { recursive: true });
  const previous = await readManifest();
  if (Number(previous?.schemaVersion || 0) >= DATA_SCHEMA_VERSION) {
    return { ...previous, migrated: false };
  }

  const files = await Promise.all(PERSISTED_JSON_FILES.map(inspectPersistedFile));
  const invalidFiles = files.filter((item) => item.present && !item.valid);
  const snapshot = await snapshotPersistedFiles(files);
  if (invalidFiles.length) {
    const names = invalidFiles.map((item) => item.file).join(', ');
    throw new Error(
      `Generation-4-Datenmigration abgebrochen: Ungültige JSON-Datei(en): ${names}. ` +
      `Die unveränderten Dateien wurden vorher unter ${snapshot} gesichert.`
    );
  }
  const manifest = {
    schemaVersion: DATA_SCHEMA_VERSION,
    appGeneration: APP_GENERATION,
    migratedAt: new Date().toISOString(),
    sourceSchemaVersion: Number(previous?.schemaVersion || 0),
    compatibilityMode: 'preserve-and-normalize',
    snapshot,
    files,
    validation: {
      ok: true,
      invalidFiles: []
    }
  };
  await atomicWriteJson(MANIFEST_FILE, manifest, { backupLimit: 3 });
  return { ...manifest, migrated: true };
}

export function getDataGenerationV4Paths() {
  return { dataRoot: DATA_ROOT, manifestFile: MANIFEST_FILE };
}
