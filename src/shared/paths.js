import '../runtime/canonicalDataRoot.js';
import path from 'node:path';
import process from 'node:process';

export const APP_NAME = 'FALLEN HEAVEN Control Center';

function resolved(value) {
  const trimmed = String(value || '').trim();
  return trimmed || null;
}

function platformDataRoot() {
  if (process.platform === 'win32') {
    const appData = String(process.env.APPDATA || '').trim();
    if (appData) return path.join(appData, APP_NAME, 'runtime', 'data');
  }
  return path.join(process.cwd(), 'data');
}

function platformRuntimeRoot() {
  if (process.platform === 'win32') {
    const appData = String(process.env.APPDATA || '').trim();
    if (appData) return path.join(appData, APP_NAME, 'runtime');
  }
  return process.cwd();
}

export const DATA_DIR = resolved(process.env.FALLEN_HEAVEN_DATA_DIR)
  || (resolved(process.env.FALLEN_HEAVEN_RUNTIME_DIR)
    ? path.join(process.env.FALLEN_HEAVEN_RUNTIME_DIR, 'data')
    : platformDataRoot());

export const RUNTIME_DIR = resolved(process.env.FALLEN_HEAVEN_RUNTIME_DIR)
  || path.dirname(DATA_DIR);

export const APP_ROOT = resolved(process.env.FALLEN_HEAVEN_APP_ROOT)
  || process.cwd();

export const GUILD_CONFIGS_FILE   = path.join(DATA_DIR, 'guild-configs.json');
export const REACTION_ROLE_FILE   = path.join(DATA_DIR, 'reaction-role-rules.json');
export const BACKUP_DIR           = path.join(DATA_DIR, 'backups');
export const LOG_DIR              = path.join(RUNTIME_DIR, 'logs');
export const BOT_LOCK_FILE        = path.join(RUNTIME_DIR, 'bot.lock');
export const SERVER_INDEX_DIR     = path.join(DATA_DIR, 'server-index');
export const SQLITE_INDEX_FILE    = path.join(SERVER_INDEX_DIR, 'fallen-heaven-index.sqlite3');
export const SERVER_CONTEXT_DIR   = path.join(DATA_DIR, 'server-context');
