#!/usr/bin/env node
/**
 * FHCC Server-Watchdog
 * ---------------------
 * Läuft auf dem Bot-Server (DESKTOP-SERVER) und meldet:
 *   1. Server-Neustart  – Boot-Zeit ändert sich (erkannt über den Health-Endpoint
 *                         bzw. PowerShell-Fallback), Downtime wird berechnet.
 *   2. Bot offline      – Health-Endpoint nicht mehr erreichbar / Bot nicht ready.
 *   3. Bot wieder online– nach einem Ausfall.
 *
 * Benachrichtigung: Discord-Webhook (webhookUrl in der Config) + Log-Datei.
 * Der Watchdog startet über den Startup-Ordner automatisch nach Logon/Neustart.
 *
 * Modi:
 *   node server-watchdog.mjs            – lokaler Modus (Standard, auf DESKTOP-SERVER)
 *   node server-watchdog.mjs --once     – ein Check-Zyklus, dann Ende (für Tests/Diagnose)
 *   node server-watchdog.mjs --probe <host> – Remote-Probe-Modus: pingt einen Host
 *                                        (z. B. 192.168.0.4) und meldet offline/online
 *                                        inkl. Downtime. Kann auf einem anderen
 *                                        immer-an-Rechner laufen.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Config/State/Log liegen im Skript-Ordner – so funktioniert die installierte
// Kopie (z. B. C:\fhcc-watchdog\) genau wie der Repo-Stand.
const WORK_DIR = __dirname;
const CONFIG_PATH = process.env.FHCC_WATCHDOG_CONFIG || path.join(WORK_DIR, 'server-watchdog.json');
const STATE_PATH = process.env.FHCC_WATCHDOG_STATE || path.join(WORK_DIR, 'server-watchdog-state.json');
const LOG_PATH = process.env.FHCC_WATCHDOG_LOG || path.join(WORK_DIR, 'server-watchdog.log');

const DEFAULT_CONFIG = {
  webhookUrl: '',
  pollIntervalMs: 15000,
  downAfterMs: 45000,          // Bot gilt erst nach dieser Zeit als offline (verhindert False-Positives)
  healthUrl: 'http://127.0.0.1:3000/api/app/health',
  healthHeader: 'desktop-control-v2',
  serverName: 'DESKTOP-SERVER',
  pingTimeoutMs: 5000,
  pingAttempts: 2,             // so viele Fehl-Pings vor "offline"
};

const args = process.argv.slice(2);
const ONCE = args.includes('--once');
const SEND_TEST = args.includes('--test');
const probeIdx = args.indexOf('--probe');
const PROBE_HOST = probeIdx >= 0 ? args[probeIdx + 1] : null;

/* ---------- Kleine Helfer ---------- */

function nowIso() { return new Date().toISOString(); }

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function writeJson(file, obj) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    fs.renameSync(tmp, file);
  } catch (e) { log('warn', `State konnte nicht gespeichert werden: ${e.message}`); }
}

function log(level, msg) {
  const line = `[${nowIso()}] [${level}] ${msg}`;
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, line + '\n');
  } catch { /* Log-Ausfall darf den Watchdog nicht stoppen */ }
  if (level !== 'debug') console.log(line);
}

/* Boot-Zeit des Servers ermitteln (Fallback: PowerShell) */
async function getServerBootTime(health) {
  // Primär über den Health-Endpoint (measuredAt - uptimeMs) => kein PS nötig
  if (health?.ok && health.measuredAt && Number.isFinite(health.uptimeMs)) {
    return new Date(new Date(health.measuredAt).getTime() - health.uptimeMs);
  }
  // Fallback: PowerShell (funktioniert auch ohne laufenden Bot).
  // In Tests per FHCC_WATCHDOG_NO_PS=1 abschaltbar.
  if (process.env.FHCC_WATCHDOG_NO_PS === '1') return null;
  const boot = await new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-Command',
      "(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToString('o')"],
      { timeout: 8000, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(null);
        const d = new Date(String(stdout).trim());
        resolve(Number.isNaN(d.getTime()) ? null : d);
      });
  });
  return boot;
}

async function fetchHealth() {
  const cfg = config;
  const res = await fetch(cfg.healthUrl, {
    signal: AbortSignal.timeout(4000),
    headers: { 'x-fallen-heaven-app': cfg.healthHeader },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function pingHost(host) {
  const ok = await new Promise((resolve) => {
    execFile('ping.exe', ['-n', '2', '-w', '2000', host], { timeout: 10000, windowsHide: true },
      (err) => resolve(!err));
  });
  return ok;
}

/* Discord-Webhook-Benachrichtigung */
async function notify(title, message) {
  const cfg = config;
  log('info', `${title}: ${message}`);
  if (!cfg.webhookUrl) {
    log('warn', 'Keine webhookUrl in der Config – Benachrichtigung wird nur geloggt.');
    return { sent: false };
  }
  try {
    const payload = {
      username: 'FHCC-Server-Watchdog',
      content: `**${title}**\n${message}`,
    };
    const res = await fetch(cfg.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Webhook HTTP ${res.status}`);
    return { sent: true };
  } catch (e) {
    log('error', `Webhook fehlgeschlagen: ${e.message}`);
    return { sent: false };
  }
}

function fmtDuration(ms) {
  const s = Math.max(1, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const parts = [];
  if (h) parts.push(`${h} Std`);
  if (m) parts.push(`${m} Min`);
  parts.push(`${sec} Sek`);
  return parts.join(' ');
}

/* ---------- Zustandsmaschine ---------- */

let config = { ...DEFAULT_CONFIG };
let state = {};

async function checkOnce() {
  if (PROBE_HOST) return checkProbeOnce();
  return checkLocalOnce();
}

/* --- Lokaler Modus (auf dem Bot-Server) --- */
async function checkLocalOnce() {
  const cfg = config;
  const now = Date.now();
  let health = null;
  try { health = await fetchHealth(); } catch { health = null; }

  const botUp = Boolean(health?.ok && health?.serviceReady !== false);

  // 1) Neustart-Erkennung (Boot-Zeit)
  const boot = await getServerBootTime(health);
  if (boot) {
    const prevBoot = state.lastBootIso ? new Date(state.lastBootIso).getTime() : null;
    if (prevBoot && Math.abs(prevBoot - boot.getTime()) > 60_000) {
      const downtime = state.lastSeenAt ? now - new Date(state.lastSeenAt).getTime() : 0;
      await notify('🔄 Server neu gestartet',
        `${cfg.serverName} wurde am ${boot.toLocaleString('de-DE')} neu gestartet.` +
        (downtime > 0 ? ` Offline: ~${fmtDuration(downtime)}.` : ''));
    }
    state.lastBootIso = boot.toISOString();
  }

  // 2) Bot offline / wieder online
  if (botUp) {
    if (state.botDownSince) {
      const downMs = now - new Date(state.botDownSince).getTime();
      await notify('🟢 Bot wieder online', `Der Bot ist wieder erreichbar. Ausfall: ~${fmtDuration(downMs)}.`);
    }
    state.botDownSince = null;
  } else {
    if (!state.botDownSince) {
      state.botDownSince = nowIso();
      log('info', 'Bot nicht erreichbar – Ausfall-Zeitpunkt notiert, warte auf Bestätigung.');
    } else if (now - new Date(state.botDownSince).getTime() >= cfg.downAfterMs) {
      if (!state.botDownNotified) {
        await notify('🔴 Bot ist offline',
          `${cfg.serverName}: Der Bot antwortet nicht mehr auf ${cfg.healthUrl} seit ~${fmtDuration(now - new Date(state.botDownSince).getTime())}.`);
        state.botDownNotified = true;
      }
    }
  }
  if (botUp) state.botDownNotified = false;

  // 3) Health-Details loggen (debug)
  if (health?.ok) {
    log('debug', `Health OK: ready=${health.ready} ping=${health.pingMs}ms guilds=${health.guildCount}`);
  }

  state.lastSeenAt = nowIso();
  writeJson(STATE_PATH, state);
  return { botUp, bootIso: state.lastBootIso };
}

/* --- Remote-Probe-Modus (auf anderem Rechner, pingt den Server) --- */
async function checkProbeOnce() {
  const cfg = config;
  const now = Date.now();
  const reachable = await pingHost(PROBE_HOST);

  if (reachable) {
    if (state.hostDownSince) {
      const downMs = now - new Date(state.hostDownSince).getTime();
      await notify('🟢 Host wieder erreichbar', `${PROBE_HOST} antwortet wieder. Offline: ~${fmtDuration(downMs)}.`);
    }
    state.hostDownSince = null;
    state.hostDownAttempts = 0;
    state.hostDownNotified = false;
  } else {
    state.hostDownAttempts = (state.hostDownAttempts || 0) + 1;
    if (!state.hostDownSince) state.hostDownSince = nowIso();
    if (state.hostDownAttempts >= cfg.pingAttempts && !state.hostDownNotified) {
      await notify('🔴 Host ist offline', `${PROBE_HOST} ist nicht mehr erreichbar seit ~${fmtDuration(now - new Date(state.hostDownSince).getTime())}.`);
      state.hostDownNotified = true;
    }
  }

  state.lastSeenAt = nowIso();
  writeJson(STATE_PATH, state);
  return { reachable };
}

/* ---------- Main ---------- */

function reloadConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    config = { ...DEFAULT_CONFIG, ...readJson(CONFIG_PATH, {}) };
  }
}

async function main() {
  reloadConfig();
  state = readJson(STATE_PATH, {});

  if (ONCE) {
    await checkOnce();
    return;
  }

  if (SEND_TEST) {
    await notify('✅ Watchdog-Test',
      `${config.serverName}: Der Server-Watchdog funktioniert. Webhook-URL ist aktiv.`);
    return;
  }

  log('info', `Watchdog gestartet (${PROBE_HOST ? `Probe-Modus für ${PROBE_HOST}` : `lokaler Modus für ${config.serverName}`}), Poll alle ${config.pollIntervalMs} ms.`);
  log('info', `Webhook: ${config.webhookUrl ? 'konfiguriert' : 'NICHT konfiguriert (nur Log-Datei)'}`);

  // Erster Check sofort, dann im Intervall.
  // Kein unref() – der Watchdog soll dauerhaft laufen.
  await checkOnce();
  setInterval(() => {
    reloadConfig(); // Webhook-URL kann ohne Neustart eingetragen werden
    checkOnce().catch((e) => log('error', `Check fehlgeschlagen: ${e.message}`));
  }, config.pollIntervalMs);
}

main().catch((e) => {
  log('error', `Watchdog-Abbruch: ${e.stack || e.message}`);
  process.exit(1);
});
