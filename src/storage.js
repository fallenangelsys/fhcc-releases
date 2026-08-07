import path from 'node:path';
import { defaultGuildConfig, normalizeConfig } from './defaultConfig.js';
import { atomicWriteJson, createMigrationSnapshot, readJsonWithRecovery } from './runtime/atomicJsonStore.js';

const STORAGE_FILE = path.join(process.env.FALLEN_HEAVEN_DATA_DIR || path.join(process.cwd(), 'data'), 'guild-configs.json');
const STORAGE_META_FILE = `${STORAGE_FILE}.meta.json`;
const STORAGE_SCHEMA_VERSION = 2;
const runtime = {
  initialized: false,
  data: {},
  revision: 0,
  persistedRevision: 0,
  lastWriteAt: null,
  lastError: null,
  recoveredFrom: null,
  schemaVersion: 0
};
let initializationPromise = null;
let writeQueue = Promise.resolve();

const clone = (value) => JSON.parse(JSON.stringify(value));

const mergeDeep = (base, patch) => {
  if (!patch || typeof patch !== 'object') return clone(base);
  if (Array.isArray(patch)) return clone(patch);
  const output = base && typeof base === 'object' && !Array.isArray(base) ? clone(base) : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) output[key] = clone(value);
    else if (value && typeof value === 'object') output[key] = mergeDeep(output[key], value);
    else output[key] = value;
  }
  return output;
};

const persist = async () => {
  const snapshot = clone(runtime.data);
  const revision = ++runtime.revision;
  const operation = writeQueue.catch(() => {}).then(async () => {
    try {
      const result = await atomicWriteJson(STORAGE_FILE, snapshot, { backupLimit: 5 });
      runtime.persistedRevision = revision;
      runtime.lastWriteAt = result.writtenAt;
      runtime.lastError = null;
      return result;
    } catch (error) {
      runtime.lastError = String(error?.message || error);
      console.error('Failed to persist guild configs atomically', error);
      throw error;
    }
  });
  writeQueue = operation;
  return operation;
};

const normalizeStoredGuilds = (source) => {
  const output = {};
  if (!source || typeof source !== 'object' || Array.isArray(source)) return output;
  for (const [guildId, config] of Object.entries(source)) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) continue;
    const guildName = typeof config.guildName === 'string' && config.guildName.trim() ? config.guildName : 'Server';
    output[guildId] = normalizeConfig({ ...config, guildId, guildName });
  }
  return output;
};

const migrateStorage = async (data, fromVersion) => {
  let migrated = data;
  let version = Math.max(0, Number(fromVersion || 0));
  if (version >= STORAGE_SCHEMA_VERSION) return { data: migrated, version, changed: false };
  await createMigrationSnapshot(STORAGE_FILE, migrated, `pre-v${version}-to-v${STORAGE_SCHEMA_VERSION}`);
  if (version < 1) {
    migrated = migrated && typeof migrated === 'object' && !Array.isArray(migrated) ? migrated : {};
    version = 1;
  }
  if (version < 2) {
    migrated = normalizeStoredGuilds(migrated);
    version = 2;
  }
  return { data: migrated, version, changed: true };
};

const initializeStorageInternal = async () => {
  const loaded = await readJsonWithRecovery(STORAGE_FILE, {
    fallback: {},
    backupLimit: 5,
    validate: (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value))
  });
  const metadata = await readJsonWithRecovery(STORAGE_META_FILE, {
    fallback: { schemaVersion: 0 },
    backupLimit: 3,
    validate: (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value))
  });
  const migration = await migrateStorage(loaded.value, metadata.value.schemaVersion);
  runtime.data = migration.data;
  runtime.schemaVersion = migration.version;
  runtime.recoveredFrom = loaded.recovered ? loaded.source : null;
  runtime.initialized = true;
  if (loaded.recovered || migration.changed || loaded.source === 'fallback') await persist();
  await atomicWriteJson(STORAGE_META_FILE, {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    migratedAt: migration.changed ? new Date().toISOString() : metadata.value.migratedAt || null,
    lastRecoveredFrom: runtime.recoveredFrom,
    updatedAt: new Date().toISOString()
  }, { backupLimit: 3 });
};

export async function initializeStorage() {
  if (runtime.initialized) return;
  if (!initializationPromise) {
    initializationPromise = initializeStorageInternal().catch((error) => {
      initializationPromise = null;
      runtime.lastError = String(error?.message || error);
      throw error;
    });
  }
  await initializationPromise;
}

const ensureGuild = (guildId, guildName = 'Server') => {
  if (!guildId) return { config: null, changed: false };
  let changed = false;
  if (!runtime.data[guildId]) {
    runtime.data[guildId] = normalizeConfig(defaultGuildConfig(guildId, guildName));
    changed = true;
  }
  const normalized = normalizeConfig({
    ...runtime.data[guildId],
    guildId,
    guildName: guildName || runtime.data[guildId].guildName
  });
  if (JSON.stringify(normalized) !== JSON.stringify(runtime.data[guildId])) {
    runtime.data[guildId] = normalized;
    changed = true;
  }
  return { config: runtime.data[guildId], changed };
};

export async function getGuildConfig(guildId, guildName = 'Server') {
  await initializeStorage();
  const ensured = ensureGuild(guildId, guildName);
  if (ensured.changed) await persist();
  return clone(ensured.config);
}

export async function setGuildConfig(guildId, patch = {}, options = {}) {
  await initializeStorage();
  const reset = Boolean(options.reset);
  const existingName = runtime.data[guildId]?.guildName || 'Server';
  const guildName = typeof patch.guildName === 'string' ? patch.guildName : existingName;
  const current = ensureGuild(guildId, guildName).config || defaultGuildConfig(guildId, guildName);
  const base = reset ? defaultGuildConfig(guildId, guildName) : current;
  runtime.data[guildId] = normalizeConfig(mergeDeep(base, { ...patch, guildId, guildName }));
  await persist();
  return clone(runtime.data[guildId]);
}

export async function getAllGuildConfigs() {
  await initializeStorage();
  return clone(Object.values(runtime.data));
}

export async function flushStorage() {
  await initializeStorage();
  await writeQueue;
  if (runtime.persistedRevision < runtime.revision) await persist();
}

export function getStorageStatus() {
  return {
    initialized: runtime.initialized,
    schemaVersion: runtime.schemaVersion,
    revision: runtime.revision,
    persistedRevision: runtime.persistedRevision,
    pending: runtime.persistedRevision < runtime.revision,
    lastWriteAt: runtime.lastWriteAt,
    lastError: runtime.lastError,
    recoveredFrom: runtime.recoveredFrom
  };
}
