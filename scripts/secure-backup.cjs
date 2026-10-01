#!/usr/bin/env node
'use strict';

/**
 * FHCC Secure Backup – verschlüsselte, rein lokale Sicherung sensibler Dateien.
 *
 * Nutzt ausschließlich Node-Bordmittel (node:crypto): AES-256-GCM + scrypt.
 * Kein Cloud-Zugriff, keine Installationen, keine Dependencies.
 *
 * Verwendung:
 *   node scripts/secure-backup.cjs backup [--out <datei>] [dateien...]
 *   node scripts/secure-backup.cjs verify <backup-datei>
 *   node scripts/secure-backup.cjs restore <backup-datei> [--out-dir <ordner>]
 *
 * Passwort-Quellen (in dieser Reihenfolge):
 *   1. --password <passwort>
 *   2. Umgebungsvariable BACKUP_PASSWORD
 *   3. Interaktive Eingabe (nur in einem echten Terminal)
 *
 * Beispiele:
 *   BACKUP_PASSWORD='mein-sicheres-passwort' node scripts/secure-backup.cjs backup .env
 *   BACKUP_PASSWORD='mein-sicheres-passwort' node scripts/secure-backup.cjs backup .env data/guild-configs.json
 *   BACKUP_PASSWORD='mein-sicheres-passwort' node scripts/secure-backup.cjs restore "C:\Users\5gtag\Desktop\fhcc-secrets-2026-08-07.enc"
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const root = path.resolve(__dirname, '..');
const APP_TAG = 'fhcc-secure-backup';
const FORMAT = 1;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BYTES = 32;
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function fail(message) {
  console.error(`Fehler: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { command: null, files: [], out: null, password: null, outDir: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out') {
      opts.out = argv[++i];
      if (!opts.out) fail('--out braucht einen Dateipfad.');
    } else if (arg === '--out-dir') {
      opts.outDir = argv[++i];
      if (!opts.outDir) fail('--out-dir braucht einen Ordnerpfad.');
    } else if (arg === '--password') {
      opts.password = argv[++i];
      if (!opts.password) fail('--password braucht einen Wert.');
    } else if (arg.startsWith('--')) {
      fail(`Unbekannte Option: ${arg}`);
    } else if (!opts.command) {
      opts.command = arg;
    } else {
      opts.files.push(arg);
    }
  }
  return opts;
}

function promptHidden(question) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      fail('Kein interaktives Terminal. Passwort per Umgebungsvariable BACKUP_PASSWORD oder --password übergeben.');
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    process.stdin.on('data', (char) => {
      char = String(char);
      if (char === '\u0003') process.exit(130); // Strg+C
      if (char === '\n' || char === '\r') return;
      readline.moveCursor(process.stdout, -char.length, 0);
      readline.clearLine(process.stdout, 1);
    });
    rl.question(question, (value) => {
      process.stdout.write('\n');
      process.stdin.removeAllListeners('data');
      rl.close();
      resolve(value);
    });
  });
}

async function getPassword(opts) {
  if (opts.password) return opts.password;
  if (process.env.BACKUP_PASSWORD) return process.env.BACKUP_PASSWORD;
  return promptHidden('Passwort (Eingabe wird nicht angezeigt): ');
}

function readEnvelope(file) {
  const absolute = path.resolve(file);
  if (!fs.existsSync(absolute)) fail(`Datei nicht gefunden: ${file}`);
  let envelope;
  try {
    envelope = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  } catch {
    fail(`Kein gültiges Backup-Format: ${file}`);
  }
  if (!envelope || envelope.app !== APP_TAG || !envelope.payload) fail(`Keine FHCC-Backup-Datei: ${file}`);
  return envelope;
}

function deriveKey(password, salt, kdf) {
  return crypto.scryptSync(password, salt, KEY_BYTES, {
    N: kdf.N || SCRYPT.N,
    r: kdf.r || SCRYPT.r,
    p: kdf.p || SCRYPT.p,
    maxmem: SCRYPT.maxmem,
  });
}

function decryptEnvelope(envelope, password) {
  try {
    const key = deriveKey(password, Buffer.from(envelope.kdf.salt, 'base64'), envelope.kdf);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.payload, 'base64')),
      decipher.final(),
    ]);
    const data = JSON.parse(plaintext.toString('utf8'));
    if (!Array.isArray(data.files)) return null;
    return data;
  } catch {
    return null;
  }
}

function kilobytes(buffer) {
  return Math.max(1, Math.round(buffer.length / 1024));
}

async function backup(files, out, password) {
  const targets = files.length ? files : ['.env'];
  const entries = [];
  for (const file of targets) {
    const absolute = path.resolve(root, file);
    if (!absolute.startsWith(root + path.sep)) fail(`Datei liegt außerhalb des Projektordners: ${file}`);
    if (!fs.existsSync(absolute)) fail(`Datei nicht gefunden: ${file}`);
    if (!fs.statSync(absolute).isFile()) fail(`Keine Datei: ${file}`);
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    entries.push({ path: relative, b64: fs.readFileSync(absolute).toString('base64') });
  }

  const salt = crypto.randomBytes(SALT_BYTES);
  const iv = crypto.randomBytes(IV_BYTES);
  const key = deriveKey(password, salt, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify({ files: entries }), 'utf8')),
    cipher.final(),
  ]);

  const envelope = {
    app: APP_TAG,
    format: FORMAT,
    created: new Date().toISOString(),
    kdf: { name: 'scrypt', N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, salt: salt.toString('base64') },
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    payload: ciphertext.toString('base64'),
  };

  // Round-Trip-Prüfung direkt nach dem Verschlüsseln.
  const roundTrip = decryptEnvelope(envelope, password);
  if (!roundTrip) fail('Interner Fehler: Verschlüsselung konnte nicht verifiziert werden.');

  const target = out || path.join(os.homedir(), 'Desktop', `fhcc-secrets-${new Date().toISOString().slice(0, 10)}.enc`);
  fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(envelope, null, 2) + '\n');

  console.log(`✔ Backup erstellt: ${target}`);
  console.log(`  Enthält (${roundTrip.files.length}): ${roundTrip.files.map((f) => f.path).join(', ')}`);
  console.log(`  Größe: ${kilobytes(ciphertext)} KB verschlüsselt`);
  console.log('  Dieses Passwort wird benötigt, um die Datei je wieder zu öffnen.');
}

async function verify(file, password) {
  if (!file) fail('verify braucht eine Backup-Datei.');
  const envelope = readEnvelope(file);
  const data = decryptEnvelope(envelope, password);
  if (!data) fail('Entschlüsselung fehlgeschlagen – falsches Passwort oder beschädigte Datei.');
  console.log(`✔ Backup gültig (erstellt: ${envelope.created})`);
  for (const entry of data.files) {
    console.log(`  • ${entry.path} (${kilobytes(Buffer.from(entry.b64, 'base64'))} KB)`);
  }
}

async function restore(file, outDir, password) {
  if (!file) fail('restore braucht eine Backup-Datei.');
  const envelope = readEnvelope(file);
  const data = decryptEnvelope(envelope, password);
  if (!data) fail('Entschlüsselung fehlgeschlagen – falsches Passwort oder beschädigte Datei.');
  const base = outDir ? path.resolve(outDir) : root;
  for (const entry of data.files) {
    const target = path.resolve(base, entry.path);
    if (!target.startsWith(base + path.sep)) fail(`Ungültiger Pfad im Backup: ${entry.path}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(entry.b64, 'base64'));
    console.log(`✔ Wiederhergestellt: ${target}`);
  }
  console.log('Fertig.');
}

(async () => {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.command) {
    fail([
      'Kein Befehl angegeben. Verwendung:',
      '  backup [--out <datei>] [dateien...]   (Standard: .env)',
      '  verify <backup-datei>',
      '  restore <backup-datei> [--out-dir <ordner>]',
    ].join('\n'));
  }
  const password = await getPassword(opts);
  if (!password || password.length < 8) {
    fail('Passwort muss mindestens 8 Zeichen lang sein (empfohlen: 12+).');
  }
  if (opts.command === 'backup') await backup(opts.files, opts.out, password);
  else if (opts.command === 'verify') await verify(opts.files[0], password);
  else if (opts.command === 'restore') await restore(opts.files[0], opts.outDir, password);
  else fail(`Unbekannter Befehl: ${opts.command}`);
})().catch((err) => fail(err.message));
