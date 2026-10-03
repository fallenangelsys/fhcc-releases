'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createGzip, createGunzip, constants: zlibConstants } = require('node:zlib');
const { pipeline } = require('node:stream/promises');
const { Readable, Transform } = require('node:stream');
const { promisify } = require('node:util');

const MAGIC = Buffer.from('FHCC-PORTABLE-1\n', 'ascii');
const FORMAT = 1;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const SCRYPT = Object.freeze({ N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
const MAX_HEADER_BYTES = 4096;
const MAX_PATH_BYTES = 4096;
const MAX_ENTRIES = 100_000;
const MAX_ENTRY_BYTES = 50 * 1024 * 1024 * 1024;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024 * 1024;
const scrypt = promisify(crypto.scrypt);

function validatePassphrase(passphrase) {
  const value = String(passphrase || '');
  if (value.length < 12 || Buffer.byteLength(value, 'utf8') > 1024) {
    throw new Error('Das Backup-Passwort muss mindestens 12 Zeichen lang sein.');
  }
  return value;
}

function normalizeArchivePath(value) {
  const relative = String(value || '');
  if (!relative || relative.includes('\\') || relative.includes('\0') || relative.startsWith('/') || /^[A-Za-z]:/.test(relative)) {
    throw new Error(`Ungültiger Pfad im Backup: ${relative.slice(0, 120)}`);
  }
  const segments = relative.split('/');
  const reservedWindowsName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
  if (segments.some((segment) => (
    !segment
    || segment === '.'
    || segment === '..'
    || segment.length > 255
    || /[<>:"|?*\u0000-\u001f]/.test(segment)
    || /[. ]$/.test(segment)
    || reservedWindowsName.test(segment)
  ))) {
    throw new Error(`Ungültiger Pfad im Backup: ${relative.slice(0, 120)}`);
  }
  return relative;
}

function allowedArchivePath(relative, type) {
  const dataRoots = ['runtime/data', 'runtime/backups', 'runtime/logs'];
  if (type === 'directory' && [...dataRoots, 'credentials'].includes(relative)) return true;
  if (dataRoots.some((root) => relative.startsWith(`${root}/`))) return type === 'file' || type === 'directory';
  if (type !== 'file') return false;
  if (['secrets.bin', 'credentials/discord-bot-token.bin', 'credentials/dashboard-session-secret.bin'].includes(relative)) return true;
  return [
    'app/startup-settings.json',
    'app/update-settings.json',
    'portable/local-storage.json',
    'portable/secrets.json',
    'portable/update-token.json'
  ].includes(relative);
}

function frameHeader(kind, relative, size) {
  const name = Buffer.from(relative, 'utf8');
  if (name.length > MAX_PATH_BYTES) throw new Error('Ein Backup-Pfad ist zu lang.');
  const header = Buffer.alloc(13);
  header[0] = kind;
  header.writeUInt32BE(name.length, 1);
  header.writeBigUInt64BE(BigInt(size), 5);
  return { header, name };
}

async function* archivePayload(entries) {
  for (const entry of entries) {
    if (entry.type === 'directory') {
      const { header, name } = frameHeader(1, entry.path, 0);
      yield header;
      yield name;
      continue;
    }
    if (Buffer.isBuffer(entry.data)) {
      const { header, name } = frameHeader(2, entry.path, entry.data.length);
      yield header;
      yield name;
      if (entry.data.length) yield entry.data;
      continue;
    }

    const statBefore = await fsp.lstat(entry.filePath).catch(() => null);
    if (!statBefore?.isFile() || statBefore.isSymbolicLink()) {
      throw new Error(`Backup-Datei fehlt oder ist kein reguläres File: ${entry.path}`);
    }
    if (statBefore.size > MAX_ENTRY_BYTES) throw new Error(`Datei ist zu groß für das Backup: ${entry.path}`);
    const expectedSize = statBefore.size;
    const { header, name } = frameHeader(2, entry.path, expectedSize);
    yield header;
    yield name;
    if (expectedSize > 0) {
      const stream = fs.createReadStream(entry.filePath, { start: 0, end: expectedSize - 1 });
      for await (const chunk of stream) yield chunk;
    }
    const statAfter = await fsp.lstat(entry.filePath).catch(() => null);
    if (!statAfter?.isFile() || statAfter.size !== expectedSize || statAfter.mtimeMs !== statBefore.mtimeMs) {
      throw new Error(`Datei wurde während des Backups verändert: ${entry.path}`);
    }
  }
  yield Buffer.alloc(13);
}

function writeToStream(stream, buffer) {
  return new Promise((resolve, reject) => {
    const onError = (error) => { cleanup(); reject(error); };
    const onDrain = () => { cleanup(); resolve(); };
    const cleanup = () => {
      stream.removeListener('error', onError);
      stream.removeListener('drain', onDrain);
    };
    stream.once('error', onError);
    if (stream.write(buffer)) {
      cleanup();
      resolve();
    } else stream.once('drain', onDrain);
  });
}

function onceOpen(stream) {
  return new Promise((resolve, reject) => {
    stream.once('open', resolve);
    stream.once('error', reject);
  });
}

function validateEntries(entries) {
  if (!Array.isArray(entries) || entries.length > MAX_ENTRIES) throw new Error('Zu viele Backup-Einträge.');
  const seen = new Set();
  let totalBytes = 0;
  const normalized = entries.map((entry) => {
    const relative = normalizeArchivePath(entry?.path);
    const type = entry?.type;
    if (!['file', 'directory'].includes(type) || !allowedArchivePath(relative, type)) {
      throw new Error(`Dieser Pfad darf nicht in ein FHCC-Backup: ${relative}`);
    }
    const collisionKey = relative.toLocaleLowerCase('en-US');
    if (seen.has(collisionKey)) throw new Error(`Doppelter Backup-Pfad: ${relative}`);
    seen.add(collisionKey);
    if (type === 'file') {
      let size;
      if (Buffer.isBuffer(entry.data)) size = entry.data.length;
      else if (typeof entry.filePath === 'string' && entry.data === undefined) {
        const stat = fs.lstatSync(entry.filePath);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Backup-Quelle ist keine reguläre Datei: ${relative}`);
        size = stat.size;
      } else throw new Error(`Ungültige Quelldatei für ${relative}`);
      if (['portable/local-storage.json', 'portable/secrets.json'].includes(relative) && size > 4 * 1024 * 1024) throw new Error('Einstellungen im Backup überschreiten das 4-MB-Limit.');
      if (relative === 'portable/update-token.json' && size > 64 * 1024) throw new Error('Update-Zugangsdaten im Backup sind ungültig.');
      totalBytes += size;
      if (size > MAX_ENTRY_BYTES || totalBytes > MAX_TOTAL_BYTES) throw new Error('Backup überschreitet die zulässige Gesamtgröße.');
    } else if (entry.filePath || entry.data !== undefined) {
      throw new Error(`Ungültiger Verzeichniseintrag: ${relative}`);
    }
    return { path: relative, type, ...(type === 'file' ? (Buffer.isBuffer(entry.data) ? { data: entry.data } : { filePath: entry.filePath }) : {}) };
  });
  const pathKinds = new Map(normalized.map((entry) => [entry.path.toLocaleLowerCase('en-US'), entry.type]));
  for (const entry of normalized) {
    const segments = entry.path.toLocaleLowerCase('en-US').split('/');
    for (let index = 1; index < segments.length; index += 1) {
      const parent = segments.slice(0, index).join('/');
      if (pathKinds.get(parent) === 'file') throw new Error(`Backup-Pfad liegt innerhalb einer Datei: ${entry.path}`);
    }
  }
  return normalized.sort((left, right) => left.path.localeCompare(right.path, 'en'));
}

async function createEncryptedBackup({ outputPath, password, entries }) {
  const secret = validatePassphrase(String(password || '').normalize('NFC'));
  const archivePath = path.resolve(String(outputPath || ''));
  if (!outputPath || !path.isAbsolute(archivePath)) throw new Error('Ungültiger Speicherort für das Backup.');
  const sourceEntries = validateEntries(entries);
  if (sourceEntries.length === 0) throw new Error('Es gibt keine Daten zum Sichern.');
  const salt = crypto.randomBytes(SALT_BYTES);
  const iv = crypto.randomBytes(IV_BYTES);
  const kdf = { name: 'scrypt', N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p };
  const header = Buffer.from(JSON.stringify({ app: 'FHCC', format: FORMAT, createdAt: new Date().toISOString(), kdf, salt: salt.toString('base64'), iv: iv.toString('base64'), compression: 'gzip' }), 'utf8');
  if (header.length > MAX_HEADER_BYTES) throw new Error('Backup-Kopf ist ungültig.');
  const prefix = Buffer.alloc(MAGIC.length + 4 + header.length);
  MAGIC.copy(prefix, 0);
  prefix.writeUInt32BE(header.length, MAGIC.length);
  header.copy(prefix, MAGIC.length + 4);
  const key = await scrypt(secret, salt, KEY_BYTES, SCRYPT);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(prefix);
  const temporary = `${archivePath}.tmp-${crypto.randomBytes(8).toString('hex')}`;
  const previous = `${archivePath}.previous-${crypto.randomBytes(8).toString('hex')}`;
  let output;
  let preservedPrevious = false;
  try {
    await fsp.mkdir(path.dirname(archivePath), { recursive: true });
    output = fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 });
    await onceOpen(output);
    await writeToStream(output, prefix);
    const appendTag = new Transform({
      transform(chunk, _encoding, callback) { callback(null, chunk); },
      flush(callback) { this.push(cipher.getAuthTag()); callback(); }
    });
    await pipeline(
      Readable.from(archivePayload(sourceEntries), { objectMode: false }),
      createGzip({ level: zlibConstants.Z_BEST_SPEED }),
      cipher,
      appendTag,
      output
    );
    try {
      await fsp.rename(archivePath, previous);
      preservedPrevious = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    try {
      await fsp.rename(temporary, archivePath);
    } catch (error) {
      if (preservedPrevious) await fsp.rename(previous, archivePath).catch(() => {});
      throw error;
    }
    if (preservedPrevious) await fsp.rm(previous, { force: true });
    const stat = await fsp.stat(archivePath);
    return { path: archivePath, entries: sourceEntries.length, size: stat.size };
  } catch (error) {
    output?.destroy();
    await fsp.rm(temporary, { force: true }).catch(() => {});
    if (preservedPrevious && !fs.existsSync(archivePath)) await fsp.rename(previous, archivePath).catch(() => {});
    throw error;
  } finally {
    key.fill(0);
  }
}

class ChunkReader {
  constructor(readable) {
    this.iterator = readable[Symbol.asyncIterator]();
    this.chunk = Buffer.alloc(0);
    this.offset = 0;
  }

  async nextChunk() {
    const next = await this.iterator.next();
    if (next.done) return false;
    this.chunk = Buffer.from(next.value);
    this.offset = 0;
    return true;
  }

  async readExactly(length) {
    const result = Buffer.alloc(length);
    let written = 0;
    while (written < length) {
      if (this.offset >= this.chunk.length && !(await this.nextChunk())) throw new Error('Backup ist abgeschnitten.');
      const take = Math.min(length - written, this.chunk.length - this.offset);
      this.chunk.copy(result, written, this.offset, this.offset + take);
      this.offset += take;
      written += take;
    }
    return result;
  }

  async consume(length, onChunk) {
    let remaining = length;
    while (remaining > 0) {
      if (this.offset >= this.chunk.length && !(await this.nextChunk())) throw new Error('Backup-Dateiinhalt ist abgeschnitten.');
      const take = Math.min(remaining, this.chunk.length - this.offset);
      await onChunk(this.chunk.subarray(this.offset, this.offset + take));
      this.offset += take;
      remaining -= take;
    }
  }

  async assertEnd() {
    if (this.offset < this.chunk.length) throw new Error('Backup enthält unerwartete Daten nach dem Ende.');
    while (await this.nextChunk()) {
      if (this.chunk.length) throw new Error('Backup enthält unerwartete Daten nach dem Ende.');
    }
  }
}

function validHeader(header) {
  return header?.app === 'FHCC'
    && header.format === FORMAT
    && header.compression === 'gzip'
    && header.kdf?.name === 'scrypt'
    && header.kdf.N === SCRYPT.N
    && header.kdf.r === SCRYPT.r
    && header.kdf.p === SCRYPT.p;
}

async function readAt(handle, length, position) {
  const buffer = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const result = await handle.read(buffer, read, length - read, position + read);
    if (!result.bytesRead) throw new Error('Backup-Datei ist abgeschnitten.');
    read += result.bytesRead;
  }
  return buffer;
}

async function writeStageFile(filePath, reader, size) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const output = fs.createWriteStream(filePath, { flags: 'wx', mode: 0o600 });
  output.once('error', () => {});
  await onceOpen(output);
  try {
    await reader.consume(size, (chunk) => writeToStream(output, chunk));
    output.end();
    await new Promise((resolve, reject) => output.once('finish', resolve).once('error', reject));
  } catch (error) {
    output.destroy();
    throw error;
  }
}

async function readArchivePayload(readable, stageDirectory, memoryPaths = new Set()) {
  const reader = new ChunkReader(readable);
  const seen = new Set();
  const entryTypes = new Map();
  const records = [];
  let totalBytes = 0;
  while (true) {
    const frame = await reader.readExactly(13);
    const kind = frame[0];
    const nameLength = frame.readUInt32BE(1);
    const sizeBig = frame.readBigUInt64BE(5);
    if (kind === 0) {
      if (nameLength !== 0 || sizeBig !== 0n) throw new Error('Ungültiger Backup-Abschluss.');
      await reader.assertEnd();
      break;
    }
    if (![1, 2].includes(kind) || !nameLength || nameLength > MAX_PATH_BYTES || sizeBig > BigInt(MAX_ENTRY_BYTES)) {
      throw new Error('Ungültiger Backup-Eintrag.');
    }
    const type = kind === 1 ? 'directory' : 'file';
    const nameBytes = await reader.readExactly(nameLength);
    const decodedName = nameBytes.toString('utf8');
    if (!Buffer.from(decodedName, 'utf8').equals(nameBytes)) throw new Error('Backup enthält einen ungültigen UTF-8-Pfad.');
    const relative = normalizeArchivePath(decodedName);
    const size = Number(sizeBig);
    const collisionKey = relative.toLocaleLowerCase('en-US');
    if (!allowedArchivePath(relative, type) || seen.has(collisionKey) || (type === 'directory' && size !== 0)
      || (['portable/local-storage.json', 'portable/secrets.json'].includes(relative) && size > 4 * 1024 * 1024)
      || (relative === 'portable/update-token.json' && size > 64 * 1024)) {
      throw new Error(`Nicht erlaubter oder doppelter Backup-Eintrag: ${relative}`);
    }
    const parentSegments = collisionKey.split('/');
    for (let index = 1; index < parentSegments.length; index += 1) {
      if (entryTypes.get(parentSegments.slice(0, index).join('/')) === 'file') throw new Error(`Backup-Pfad liegt innerhalb einer Datei: ${relative}`);
    }
    if (type === 'file' && [...entryTypes.keys()].some((entryPath) => entryPath.startsWith(`${collisionKey}/`))) throw new Error(`Backup-Datei überschreibt einen Verzeichnispfad: ${relative}`);
    seen.add(collisionKey);
    entryTypes.set(collisionKey, type);
    totalBytes += size;
    if (records.length >= MAX_ENTRIES || totalBytes > MAX_TOTAL_BYTES) throw new Error('Backup enthält zu viele Daten.');
    const target = path.join(stageDirectory, ...relative.split('/'));
    assertNoSymlinkAncestors(stageDirectory, relative);
    if (type === 'directory') await fsp.mkdir(target, { recursive: true });
    else if (memoryPaths.has(relative)) {
      const chunks = [];
      await reader.consume(size, async (chunk) => { chunks.push(Buffer.from(chunk)); });
      records.push({ path: relative, type, size, data: Buffer.concat(chunks, size) });
      continue;
    } else await writeStageFile(target, reader, size);
    records.push({ path: relative, type, size });
  }
  return records;
}

async function extractEncryptedBackup({ inputPath, password, stageDirectory, memoryPaths = [] }) {
  const secret = validatePassphrase(String(password || '').normalize('NFC'));
  const archivePath = path.resolve(String(inputPath || ''));
  const stageRoot = path.resolve(String(stageDirectory || ''));
  if (!inputPath || !stageDirectory || !path.isAbsolute(archivePath) || !path.isAbsolute(stageRoot)) {
    throw new Error('Ungültiger Backup- oder Arbeitsordner.');
  }
  let handle;
  let stageCreated = false;
  let key;
  let source;
  let decipher;
  let gunzip;
  let pipelineTask;
  try {
    handle = await fsp.open(archivePath, 'r');
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < MAGIC.length + 4 + TAG_BYTES) throw new Error('Keine gültige FHCC-Portable-Sicherung.');
    const magic = await readAt(handle, MAGIC.length, 0);
    if (!magic.equals(MAGIC)) throw new Error('Keine gültige FHCC-Portable-Sicherung.');
    const headerLength = (await readAt(handle, 4, MAGIC.length)).readUInt32BE(0);
    if (!headerLength || headerLength > MAX_HEADER_BYTES || MAGIC.length + 4 + headerLength + TAG_BYTES >= stat.size) throw new Error('Backup-Kopf ist ungültig.');
    const headerBuffer = await readAt(handle, headerLength, MAGIC.length + 4);
    let header;
    try { header = JSON.parse(headerBuffer.toString('utf8')); } catch { throw new Error('Backup-Kopf ist beschädigt.'); }
    if (!Buffer.from(JSON.stringify(header), 'utf8').equals(headerBuffer)) throw new Error('Backup-Kopf ist nicht kanonisch kodiert.');
    if (!validHeader(header)) throw new Error('Backup-Format wird nicht unterstützt.');
    const salt = Buffer.from(header.salt, 'base64');
    const iv = Buffer.from(header.iv, 'base64');
    if (salt.toString('base64') !== header.salt || iv.toString('base64') !== header.iv) throw new Error('Backup-Schlüsselparameter sind ungültig.');
    if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES) throw new Error('Backup-Schlüsselparameter sind ungültig.');
    const tag = await readAt(handle, TAG_BYTES, stat.size - TAG_BYTES);
    const payloadStart = MAGIC.length + 4 + headerLength;
    const payloadEnd = stat.size - TAG_BYTES - 1;
    if (payloadEnd < payloadStart) throw new Error('Backup enthält keine Nutzdaten.');
    key = await scrypt(secret, salt, KEY_BYTES, SCRYPT);
    decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    // AAD includes the exact 32-bit header length used by the file.
    const prefix = Buffer.alloc(MAGIC.length + 4 + headerLength);
    MAGIC.copy(prefix, 0);
    prefix.writeUInt32BE(headerLength, MAGIC.length);
    headerBuffer.copy(prefix, MAGIC.length + 4);
    decipher.setAAD(prefix);
    decipher.setAuthTag(tag);
    const stageStat = await fsp.lstat(stageRoot).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (stageStat?.isSymbolicLink() || stageStat) throw new Error('Temporärer Restore-Ordner ist ungültig oder existiert bereits.');
    await fsp.mkdir(path.dirname(stageRoot), { recursive: true });
    await fsp.mkdir(stageRoot, { recursive: false, mode: 0o700 });
    stageCreated = true;
    source = fs.createReadStream(archivePath, { start: payloadStart, end: payloadEnd, fd: handle.fd, autoClose: false });
    gunzip = createGunzip();
    pipelineTask = pipeline(source, decipher, gunzip);
    const records = await readArchivePayload(gunzip, stageRoot, new Set(memoryPaths));
    await pipelineTask;
    return { stageDirectory: stageRoot, records, createdAt: String(header.createdAt || '') };
  } catch (error) {
    source?.destroy();
    decipher?.destroy();
    gunzip?.destroy();
    await pipelineTask?.catch(() => {});
    if (stageCreated) await fsp.rm(stageRoot, { recursive: true, force: true }).catch(() => {});
    if (/Unsupported state|authenticate|bad decrypt|unable to authenticate|GCM|incorrect header check|Z_DATA_ERROR/i.test(String(error?.message || error)) || error?.code === 'Z_DATA_ERROR') {
      throw new Error('Entschlüsselung fehlgeschlagen – Passwort falsch oder Backup beschädigt.');
    }
    throw error;
  } finally {
    await handle?.close().catch(() => {});
    key?.fill(0);
  }
}

function assertNoSymlinkAncestors(root, relative) {
  let current = path.resolve(root);
  for (const segment of relative.split(/[\\/]+/)) {
    current = path.join(current, segment);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) throw new Error(`Sicherheitsprüfung abgebrochen: symbolischer Zielpfad ${current}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

async function replaceTargetsTransaction({ stageDirectory, targetRoot, targets, removals = [], afterReplace }) {
  const stageRoot = path.resolve(stageDirectory);
  const destinationRoot = path.resolve(targetRoot);
  const rollbackRoot = path.join(stageRoot, '.rollback');
  const operations = [];
  if (!Array.isArray(targets) || !Array.isArray(removals) || targets.length + removals.length > 32) throw new Error('Ungültige Liste von Wiederherstellungszielen.');
  if (typeof afterReplace !== 'undefined' && typeof afterReplace !== 'function') throw new Error('Ungültiger Restore-Hook.');
  const allTargets = [
    ...targets.map((target) => ({ relative: target, staged: target })),
    ...removals.map((target) => ({ relative: target, staged: null }))
  ];
  const allowedTargets = new Set(['runtime/data', 'runtime/backups', 'runtime/logs', 'credentials', 'secrets.bin', 'startup-settings.json', 'update-settings.json', 'credentials/dashboard-session.bin']);
  const normalizedTargets = [...targets, ...removals].map((target) => normalizeArchivePath(String(target).split(path.sep).join('/')));
  if (normalizedTargets.some((target) => !allowedTargets.has(target)) || new Set(normalizedTargets).size !== normalizedTargets.length) {
    throw new Error('Wiederherstellungsziele sind ungültig oder doppelt.');
  }
  const seen = new Set();
  try {
    const rootStat = await fsp.lstat(destinationRoot).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (rootStat?.isSymbolicLink() || (rootStat && !rootStat.isDirectory())) throw new Error('FHCC-Datenordner ist ungültig oder ein symbolischer Pfad.');
    await fsp.mkdir(destinationRoot, { recursive: true });
    await fsp.mkdir(rollbackRoot, { recursive: true, mode: 0o700 });
    for (const [index, item] of allTargets.entries()) {
      const relative = path.relative(destinationRoot, path.resolve(destinationRoot, item.relative));
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || seen.has(relative)) {
        throw new Error(`Ungültiger Wiederherstellungspfad: ${item.relative}`);
      }
      seen.add(relative);
      assertNoSymlinkAncestors(destinationRoot, relative);
      const destination = path.join(destinationRoot, relative);
      const targetStat = await fsp.lstat(destination).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
      if (targetStat?.isSymbolicLink()) throw new Error(`Sicherheitsprüfung abgebrochen: symbolisches Ziel ${item.relative}`);
      if (path.resolve(destination) === stageRoot || path.resolve(destination).startsWith(`${stageRoot}${path.sep}`)) {
        throw new Error('Wiederherstellungsziel überlappt den temporären Arbeitsordner.');
      }
      const staged = item.staged ? path.join(stageRoot, ...item.staged.split('/')) : null;
      if (staged && (!fs.existsSync(staged) || !path.resolve(staged).startsWith(`${stageRoot}${path.sep}`))) throw new Error(`Backup-Eintrag fehlt oder liegt außerhalb des Staging-Ordners: ${item.staged}`);
      const backup = path.join(rollbackRoot, String(index));
      await fsp.mkdir(path.dirname(destination), { recursive: true });
      let movedOriginal = false;
      try {
        await fsp.rename(destination, backup);
        movedOriginal = true;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      const operation = { destination, backup, movedOriginal, installed: false, staged };
      operations.push(operation);
      if (staged) {
        await fsp.rename(staged, destination);
        operation.installed = true;
      }
    }
    if (typeof afterReplace === 'function') await afterReplace();
  } catch (error) {
    let rollbackFailed = false;
    for (const operation of operations.reverse()) {
      if (operation.installed) {
        try {
          if (operation.staged) {
            await fsp.mkdir(path.dirname(operation.staged), { recursive: true });
            await fsp.rename(operation.destination, operation.staged);
          } else await fsp.rm(operation.destination, { recursive: true, force: true });
        } catch {
          rollbackFailed = true;
        }
      }
      if (operation.movedOriginal) {
        try { await fsp.rename(operation.backup, operation.destination); } catch { rollbackFailed = true; }
      }
    }
    if (rollbackFailed) {
      error.message = `Rollback fehlgeschlagen. Gesicherte Wiederherstellungskopie liegt unter ${rollbackRoot}. Ursprünglicher Fehler: ${error.message}`;
    } else {
      await fsp.rm(rollbackRoot, { recursive: true, force: true }).catch(() => {});
    }
    throw error;
  }
  await fsp.rm(rollbackRoot, { recursive: true, force: true }).catch(() => {});
  return { replaced: targets.length, removed: removals.length };
}

module.exports = {
  createEncryptedBackup,
  extractEncryptedBackup,
  normalizeArchivePath,
  replaceTargetsTransaction,
  validatePassphrase
};
