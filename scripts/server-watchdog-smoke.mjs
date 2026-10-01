#!/usr/bin/env node
/**
 * Smoke-Test für den Server-Watchdog (scripts/server-watchdog.mjs).
 *
 * Testet die Kernlogik ohne echten Server:
 *  - Fake-Health-Endpoint (lokaler HTTP-Server) mit steuerbarer uptimeMs
 *  - Fake-Webhook (lokaler HTTP-Server), der POSTs mitsammelt
 *  - Neustart-Erkennung (Boot-Zeit ändert sich) -> Webhook "Server neu gestartet"
 *  - Bot offline (Health down) -> nach downAfterMs Webhook "Bot ist offline"
 *  - Bot wieder online -> Webhook "Bot wieder online"
 *
 * Läuft über --once-Modus + State-Datei zwischen den Läufen.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, 'server-watchdog.mjs');

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watchdog-smoke-'));
const statePath = path.join(tmpDir, 'state.json');
const logPath = path.join(tmpDir, 'watchdog.log');

/* ---- Fake-Health-Server: uptimeMs steuerbar ---- */
let uptimeMs = 5 * 60 * 1000; // 5 min
let healthUp = true;
const healthServer = http.createServer((req, res) => {
  if (!healthUp) { res.writeHead(503); res.end('down'); return; }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    ok: true, serviceReady: true, ready: true,
    measuredAt: new Date().toISOString(),
    uptimeMs, pingMs: 20, guildCount: 1,
  }));
});
await new Promise((r) => healthServer.listen(0, '127.0.0.1', r));
const healthPort = healthServer.address().port;

/* ---- Fake-Webhook-Server: POSTs sammeln ---- */
const webhookPosts = [];
const webhookServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    webhookPosts.push({ url: req.url, body: JSON.parse(body || '{}') });
    res.writeHead(204); res.end();
  });
});
await new Promise((r) => webhookServer.listen(0, '127.0.0.1', r));
const webhookPort = webhookServer.address().port;

const configPath = path.join(tmpDir, 'config.json');
function writeConfig(overrides = {}) {
  fs.writeFileSync(configPath, JSON.stringify({
    webhookUrl: `http://127.0.0.1:${webhookPort}/hook`,
    healthUrl: `http://127.0.0.1:${healthPort}/api/app/health`,
    downAfterMs: 1000,
    pollIntervalMs: 60000,
    serverName: 'TEST-SERVER',
    ...overrides,
  }));
}

function runWatchdog() {
  const env = { ...process.env,
    FHCC_WATCHDOG_CONFIG: configPath,
    FHCC_WATCHDOG_STATE: statePath,
    FHCC_WATCHDOG_LOG: logPath,
    FHCC_WATCHDOG_NO_PS: '1',
  };
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, '--once'], { env });
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) reject(new Error(`Watchdog exit ${code}: ${out}`));
      else resolve(out);
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const recentPosts = (title) => webhookPosts.filter((p) => p.body?.content?.includes(title));

console.log('Watchdog-Smoke: Neustart-Erkennung');
writeConfig();
fs.rmSync(statePath, { force: true });

// 1) Erststart: keine Neustart-Meldung
await runWatchdog();
check('Erststart erzeugt KEINE Neustart-Meldung', recentPosts('neu gestartet').length === 0);
check('State enthält lastBootIso', Boolean(JSON.parse(fs.readFileSync(statePath, 'utf8')).lastBootIso));

// 2) Neustart: uptimeMs deutlich kleiner => Boot-Zeit wechselt => Meldung
const before = Date.now();
uptimeMs = 1000;
await runWatchdog();
const restartPosts = recentPosts('neu gestartet');
check('Neustart erzeugt genau 1 Meldung', restartPosts.length === 1);
check('Neustart-Meldung nennt Test-Server', restartPosts[0]?.body?.content?.includes('TEST-SERVER'));

console.log('Watchdog-Smoke: Bot offline / online');
// 3) Bot offline: Health down, warten > downAfterMs => Meldung
healthUp = false;
await runWatchdog(); // registriert botDownSince, noch keine Meldung (1. Versuch)
check('1. Down-Check meldet noch NICHT', recentPosts('Bot ist offline').length === 0);
await sleep(1100);
await runWatchdog();
check('Bot offline wird gemeldet', recentPosts('Bot ist offline').length === 1);
const downAt = Date.now() - before;

// 4) Bot wieder online => Meldung
healthUp = true;
await runWatchdog();
const upPosts = recentPosts('Bot wieder online');
check('Bot wieder online wird gemeldet', upPosts.length === 1);
check('Online-Meldung nennt Ausfall-Dauer', /Ausfall: ~/.test(upPosts[0]?.body?.content || ''));

// 5) Kein erneutes Offline-Spam (Notified-Flag bleibt bis Bot up)
healthUp = false;
await runWatchdog();
check('Kein Offline-Spam bei wiederholtem Down', recentPosts('Bot ist offline').length === 1);

console.log('Watchdog-Smoke: Log-Datei');
const log = fs.readFileSync(logPath, 'utf8');
check('Log enthält Einträge', log.includes('[info]') || log.includes('[warn]'));

// Cleanup
healthServer.close();
webhookServer.close();
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\nWatchdog-Smoke: ${passed} bestanden, ${failed} fehlgeschlagen.`);
process.exit(failed ? 1 : 0);
