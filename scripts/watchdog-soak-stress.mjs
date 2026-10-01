// Langzeit-Soak-Test für den Interaction-Timeout-Watchdog.
//
// Ziel: dauerhaft absichern, dass NIEMALS „Fallen-Heaven hat nicht rechtzeitig
// reagiert“ auftritt, selbst wenn die Netzwerk-Freigabe extrem langsam ist
// UND parallel viel Hintergrundlast anliegt. Der Test feuert über die
// konfigurierte Dauer kontinuierlich simulierte Klicks (Buttons, Auswahl-Menüs,
// Modal-Submits, Slash-Commands) und lässt deren Handler „schwere“ Arbeit
// machen:
//   - künstlich langsames Freigabe-I/O: jedes slowIo() wartet 50–6000 ms und
//     liest parallel eine echte Datei über fs.promises (async – blockiert den
//     Event-Loop NICHT, genau wie das umgestellte boostSystemIndex)
//   - vereinzelte synchrone Mikro-Stalls (20–450 ms Busy-Wait): simulieren
//     verbleibende Worst-Case-Blocker (GC, native Calls), die den Event-Loop
//     kurz anhalten – der Watchdog muss trotzdem pünktlich feuern
//   - fehlerhafte Handler (editReply ohne Bestätigung, nie antworten): der
//     Watchdog muss trotzdem jede Interaktion rechtzeitig bestätigen
//
// Zusätzlich laufen während der Klicks drei echte Hintergrund-Lastquellen,
// wie sie im Produktivbetrieb anliegen:
//   - Rollen-API-Calls: lokaler HTTP-Server mit künstlicher Latenz, echte
//     fetch()-Aufrufe (simuliert discord.js-REST-Rollenvergabe)
//   - SQLite-Schreibzugriffe: echte better-sqlite3-Writes in eine Temp-DB
//     (dieselbe Engine wie der Bot, synchrone Batches – kurze echte Blocker)
//   - Nachrichten-Flut: schnelle JSONL-Appends in eine Temp-Datei (wie der
//     Serverindex) mit leichter Parse-CPU-Last
//
// Assertion: JEDE Interaktion muss innerhalb von 3000 ms (Discords Frist)
// bestätigt sein – egal ob durch den Handler selbst oder durch den Watchdog.
// Bei einer einzigen Überschreitung endet der Test mit Exit-Code 1 und einem
// Report; der Seed wird ausgegeben, damit der Fehler reproduzierbar ist.
//
// Benutzung:
//   node scripts/watchdog-soak-stress.mjs                 # 5 Minuten Langzeit
//   node scripts/watchdog-soak-stress.mjs --duration 30   # kürzerer Lauf
//   node scripts/watchdog-soak-stress.mjs --seed 123 --rate 20
//
// Flags:
//   --duration <sec>    Laufzeit (Standard 300)
//   --rate <n>          durchschnittliche Klicks pro Sekunde (Standard 12)
//   --min-io <ms>       minimale simulierte I/O-Latenz pro Op (Standard 50)
//   --max-io <ms>       maximale simulierte I/O-Latenz pro Op (Standard 5000)
//   --stall-chance <0..1>  Anteil der Klicks mit Sync-Stall (Standard 0.2)
//   --stall-max <ms>    maximale Sync-Stall-Dauer (Standard 400)
//   --role-rate <n/s>   Rollen-API-Calls pro Sekunde (Standard 30, 0 = aus)
//   --db-rate <n/s>     SQLite-Schreib-Batches pro Sekunde (Standard 15, 0 = aus)
//   --msg-rate <n/s>    Nachrichten pro Sekunde (Standard 100, 0 = aus)
//   --seed <n>          Zufalls-Seed für reproduzierbare Läufe
//   --verbose           detaillierte Einzel-Ausgabe jeder Überschreitung

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {
  patchInteractionForTimeoutSafety,
  __setRawAckFetcher,
  INTERACTION_DEFER_AFTER_MS,
  INTERACTION_COMPONENT_DEFER_AFTER_MS,
  INTERACTION_RAW_ACK_DEADLINE_MS
} from '../src/runtime/interactionTimeoutGuard.js';

// Roh-Ack-Injektion: Die harte Deadline sendet sonst an den echten Discord-
// Endpoint – im Soak wird der Fetch durch eine Erfolgs-Antwort ersetzt und die
// Anzahl der Roh-Acks gezählt (nur die „stuck“-Klicks brauchen sie).
let rawAckCount = 0;
__setRawAckFetcher(async () => {
  rawAckCount += 1;
  return { ok: true };
});

// ---------------------------------------------------------------------------
// Konfiguration (CLI-Flags)
// ---------------------------------------------------------------------------
const ARGS = process.argv.slice(2);
const flag = (name, fallback) => {
  const idx = ARGS.indexOf(`--${name}`);
  return idx === -1 ? fallback : ARGS[idx + 1];
};
const numFlag = (name, fallback) => {
  const v = Number(flag(name, fallback));
  return Number.isFinite(v) ? v : fallback;
};

const CFG = {
  durationMs: Math.max(5000, numFlag('duration', 300) * 1000),
  rate: Math.max(1, numFlag('rate', 12)),
  minIoMs: Math.max(1, numFlag('min-io', 50)),
  maxIoMs: Math.max(10, numFlag('max-io', 5000)),
  stallChance: Math.min(1, Math.max(0, numFlag('stall-chance', 0.2))),
  stallMaxMs: Math.min(2000, Math.max(1, numFlag('stall-max', 400))),
  roleRate: Math.max(0, numFlag('role-rate', 30)),
  dbRate: Math.max(0, numFlag('db-rate', 15)),
  msgRate: Math.max(0, numFlag('msg-rate', 100)),
  seed: numFlag('seed', Math.floor(Math.random() * 2 ** 31)) || 1,
  verbose: ARGS.includes('--verbose')
};

// Deterministischer RNG (mulberry32) – gleicher Seed => gleicher Lauf.
let rngState = CFG.seed >>> 0;
const rng = () => {
  rngState = (rngState + 0x6D2B79F5) >>> 0;
  let t = rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const randInt = (min, max) => min + Math.floor(rng() * (max - min + 1));
const pick = (arr) => arr[Math.floor(rng() * arr.length)];

// ---------------------------------------------------------------------------
// Simuliertes Freigabe-I/O: echte async-Datei-Lesevorgänge + künstliche Latenz.
// Async: blockiert den Event-Loop nicht – genau wie das umgestellte
// boostSystemIndex (fs.promises statt readFileSync).
// ---------------------------------------------------------------------------
const probeFile = path.join(os.tmpdir(), `fhcc-soak-${process.pid}.bin`);
let totalIoOps = 0;
let totalIoMs = 0;
let maxSingleIoMs = 0;

async function slowIo() {
  const delay = randInt(CFG.minIoMs, CFG.maxIoMs);
  const started = performance.now();
  await Promise.all([
    fs.readFile(probeFile).catch(() => null), // echter async-I/O (Freigabe-Sim)
    new Promise((resolve) => setTimeout(resolve, delay)) // Netzwerk-Latenz
  ]);
  const took = performance.now() - started;
  totalIoOps += 1;
  totalIoMs += took;
  if (took > maxSingleIoMs) maxSingleIoMs = took;
  return took;
}

// Synchroner Busy-Wait-Stall: blockiert den Event-Loop kurz (Worst-Case).
let totalStallMs = 0;

function syncStall() {
  if (rng() > CFG.stallChance) return;
  const ms = randInt(20, CFG.stallMaxMs);
  const end = performance.now() + ms;
  while (performance.now() < end) { /* busy */ }
  totalStallMs += ms;
}

// ---------------------------------------------------------------------------
// Zusatzlast 1: Rollen-API-Calls – lokaler HTTP-Server mit künstlicher Latenz,
// echte fetch()-Aufrufe (simuliert discord.js-REST-Rollenvergabe).
// ---------------------------------------------------------------------------
const roleStats = { calls: 0, errors: 0, totalMs: 0, maxMs: 0 };
let roleServer = null;

const closeRoleServer = async () => {
  if (!roleServer) return;
  const srv = roleServer;
  roleServer = null;
  await new Promise((resolve) => {
    srv.close(() => resolve());
    srv.closeAllConnections?.();
    setTimeout(resolve, 1500).unref?.();
  });
};

const roleApiLoad = async () => {
  if (!CFG.roleRate) return;
  roleServer = http.createServer((req, res) => {
    const delay = randInt(20, 800);
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    }, delay);
  });
  await new Promise((resolve) => roleServer.listen(0, '127.0.0.1', resolve));
  const port = roleServer.address().port;
  const inflight = new Set();
  while (performance.now() - RUN_START < CFG.durationMs) {
    const n = Math.max(1, Math.round(CFG.roleRate / 10)); // alle 100 ms
    for (let i = 0; i < n; i++) {
      if (inflight.size >= 80) break; // Concurrency-Kappe
      const started = performance.now();
      const call = fetch(`http://127.0.0.1:${port}/roles`, { method: 'POST' })
        .then(async (res) => {
          await res.text();
          const took = performance.now() - started;
          roleStats.calls += 1;
          roleStats.totalMs += took;
          if (took > roleStats.maxMs) roleStats.maxMs = took;
        })
        .catch(() => { roleStats.errors += 1; });
      inflight.add(call);
      call.finally(() => inflight.delete(call));
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await Promise.allSettled([...inflight]);
  await closeRoleServer();
};

// ---------------------------------------------------------------------------
// Zusatzlast 2: SQLite-Schreibzugriffe – echte better-sqlite3-Writes (dieselbe
// Engine wie der Bot). Fallback: node:sqlite. Synchrone Batches sind kurze,
// echte Event-Loop-Blocker – genau wie im Produktivbetrieb.
// ---------------------------------------------------------------------------
let Database = null;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch { Database = null; }
let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch { DatabaseSync = null; }

const dbStats = { batches: 0, writes: 0, totalMs: 0, maxMs: 0 };
const dbFile = path.join(os.tmpdir(), `fhcc-soak-db-${process.pid}.sqlite`);
let sqliteDb = null;
let dbWarned = false;

const dbWriteLoad = async () => {
  if (!CFG.dbRate) return;
  if (!Database && !DatabaseSync) {
    if (!dbWarned) { dbWarned = true; console.warn('⚠ SQLite-Last übersprungen (weder better-sqlite3 noch node:sqlite ladbar)'); }
    return;
  }
  sqliteDb = Database ? new Database(dbFile) : new DatabaseSync(dbFile);
  sqliteDb.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT, ts INTEGER)');
  const insert = sqliteDb.prepare('INSERT INTO kv(k,v,ts) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, ts=excluded.ts');
  while (performance.now() - RUN_START < CFG.durationMs) {
    const started = performance.now();
    const batch = () => {
      for (let i = 0; i < 25; i++) {
        insert.run(`key-${Math.floor(rng() * 1e6)}`, String(rng()), Date.now());
      }
    };
    if (Database) {
      sqliteDb.transaction(batch)();
    } else {
      sqliteDb.exec('BEGIN');
      batch();
      sqliteDb.exec('COMMIT');
    }
    const took = performance.now() - started;
    dbStats.batches += 1;
    dbStats.writes += 25;
    dbStats.totalMs += took;
    if (took > dbStats.maxMs) dbStats.maxMs = took;
    await new Promise((resolve) => setTimeout(resolve, Math.max(10, 1000 / CFG.dbRate)));
  }
  sqliteDb.close();
  sqliteDb = null;
};

// ---------------------------------------------------------------------------
// Zusatzlast 3: Nachrichten-Flut – JSONL-Appends (wie der Serverindex) mit
// leichter Parse-/Bau-CPU-Last pro Nachricht.
// ---------------------------------------------------------------------------
const msgStats = { lines: 0, bytes: 0, errors: 0 };
const msgFile = path.join(os.tmpdir(), `fhcc-soak-msgs-${process.pid}.jsonl`);

const messageFloodLoad = async () => {
  if (!CFG.msgRate) return;
  let pending = 0;
  let seq = 0;
  while (performance.now() - RUN_START < CFG.durationMs) {
    const n = Math.max(1, Math.round(CFG.msgRate / 20)); // alle 50 ms
    for (let i = 0; i < n; i++) {
      if (pending >= 400) break; // Kappe für offene Appends
      pending += 1;
      seq += 1;
      // Bauen/Parsen wie im Serverindex – leichte CPU-Last pro Nachricht
      const author = `u${Math.floor(rng() * 200)}`;
      const content = 'x'.repeat(randInt(10, 200));
      const line = JSON.stringify({ id: `m${seq}`, author, content, ts: Date.now() }) + '\n';
      msgStats.bytes += Buffer.byteLength(line);
      fs.appendFile(msgFile, line)
        .then(() => { msgStats.lines += 1; })
        .catch(() => { msgStats.errors += 1; })
        .finally(() => { pending -= 1; });
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  while (pending > 0) await new Promise((resolve) => setTimeout(resolve, 20));
};

// ---------------------------------------------------------------------------
// Interaktions-Fabrik: simuliert eine discord.js-Interaktion mit Stubs, die
// den Bestätigungs-Zeitpunkt messen.
// ---------------------------------------------------------------------------
let interactionId = 0;

const createInteraction = (kind) => {
  const id = ++interactionId;
  // „stuck“ = REST-Queue hängt: deferUpdate/deferReply resolved NIE. Nur die
  // harte Deadline (Roh-Ack direkt an Discord) kann diese Interaktion retten.
  const stuckQueue = kind === 'stuck';
  const interaction = {
    id: String(id),
    token: `soak.token.${id}`,
    kind,
    replied: false,
    deferred: false,
    __handlerSelfAck: false,
    __ackAt: null,
    isButton: () => kind === 'button',
    isAnySelectMenu: () => kind === 'select',
    isModalSubmit: () => kind === 'modal',
    deferUpdate: async () => {
      if (stuckQueue) return new Promise(() => {});
      interaction.deferred = true;
      if (interaction.__ackAt === null) interaction.__ackAt = performance.now();
    },
    deferReply: async () => {
      if (stuckQueue) return new Promise(() => {});
      interaction.deferred = true;
      if (interaction.__ackAt === null) interaction.__ackAt = performance.now();
    },
    update: async () => {
      interaction.replied = true;
      interaction.__handlerSelfAck = true;
      if (interaction.__ackAt === null) interaction.__ackAt = performance.now();
    },
    reply: async () => {
      interaction.replied = true;
      interaction.__handlerSelfAck = true;
      if (interaction.__ackAt === null) interaction.__ackAt = performance.now();
    },
    editReply: async () => {},
    followUp: async () => {}
  };
  return interaction;
};

// ---------------------------------------------------------------------------
// Handler-Typen – bilden die realen Muster aus den Features ab:
//  A: langsamer Panel-Handler (TempVoice, Call-Moderation, Boost …) – mehrere
//     Freigabe-I/O-Ops, ggf. Sync-Stall, antwortet NACH dem Watchdog per
//     update() (übt den update→editReply-Pfad aus).
//  B: Modal-Submit – etwas I/O, antwortet dann per editReply (→ followUp).
//  C: schneller Handler – antwortet im selben Tick (kein Watchdog nötig).
//  D: sehr langsamer Handler – viel I/O, antwortet nie (voller Watchdog-Pfad).
//  E: Slash-Command – async I/O > 2 s, Watchdog bestätigt per deferReply.
//  F: fehlerhafter Handler – ruft editReply sofort (bestätigt aber NICHT) und
//     antwortet nie. Der Watchdog muss ihn trotzdem rechtzeitig bestätigen.
// ---------------------------------------------------------------------------
const runHandler = async (interaction) => {
  const kind = interaction.kind;
  if (kind === 'stuck') {
    // REST-Queue hängt: deferUpdate bleibt ewig offen (siehe createInteraction).
    // Der Handler wartet darauf und macht nebenbei I/O – nur der Roh-Ack der
    // harten Deadline kann die 3-Sekunden-Frist noch retten.
    void interaction.deferUpdate().catch(() => null);
    const ops = randInt(2, 5);
    for (let i = 0; i < ops; i++) await slowIo();
    return;
  }
  if (kind === 'buggy') {
    await interaction.editReply({ content: 'früh (fehlerhafter Handler)' });
    await slowIo();
    await slowIo();
    return; // antwortet nie
  }
  if (kind === 'button' || kind === 'select') {
    syncStall();
    const ops = randInt(1, 3);
    for (let i = 0; i < ops; i++) await slowIo();
    syncStall();
    await interaction.update({ content: `Panel aktualisiert (${interaction.id})` });
    return;
  }
  if (kind === 'modal') {
    await slowIo();
    await slowIo();
    await interaction.editReply({ content: `Ergebnis gespeichert (${interaction.id})` });
    return;
  }
  if (kind === 'slash') {
    // Async-I/O über die Watchdog-Frist hinaus – der Watchdog bestätigt bei
    // 2 s per deferReply. Kein Sync-Stall (siehe Head-Kommentar).
    const ops = randInt(2, 3);
    for (let i = 0; i < ops; i++) await slowIo();
    await interaction.editReply({ content: `Command ausgeführt (${interaction.id})` });
    return;
  }
  // Kind 'slow': sehr langsam, antwortet nie
  const ops = randInt(3, 6);
  for (let i = 0; i < ops; i++) await slowIo();
};

const KIND_POOL = ['button', 'button', 'button', 'button', 'button', 'select', 'select', 'modal', 'modal', 'slow', 'slash', 'buggy', 'stuck', 'stuck'];
const pickKind = () => pick(KIND_POOL);

// ---------------------------------------------------------------------------
// Statistik
// ---------------------------------------------------------------------------
const acks = []; // { lat, kind, source }
let failures = 0;
let peakInFlight = 0;
let inFlight = 0;
let fired = 0;
let RUN_START = 0;

const recordAck = (interaction, latency) => {
  acks.push({
    lat: latency,
    kind: interaction.kind,
    source: interaction.__handlerSelfAck
      ? 'self'
      : (interaction.__ackAt !== null ? 'watchdog' : 'raw')
  });
};

const percentile = (sorted, p) => {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
};

const progressLine = () => {
  const lats = acks.map((a) => a.lat).sort((a, b) => a - b);
  const p50 = percentile(lats, 50);
  const p95 = percentile(lats, 95);
  const p99 = percentile(lats, 99);
  const max = lats.length ? lats[lats.length - 1] : 0;
  return `Klicks=${fired} bestätigt=${acks.length} Fehler=${failures} aktiv=${inFlight} ` +
    `Ack-Latenz ms: p50=${p50} p95=${p95} p99=${p99} max=${max} | ` +
    `I/O=${totalIoOps} Ops (${Math.round(totalIoMs)} ms), Stalls=${Math.round(totalStallMs)} ms | ` +
    `API=${roleStats.calls} DB=${dbStats.writes} MSG=${msgStats.lines}`;
};

// ---------------------------------------------------------------------------
// Hauptschleife
// ---------------------------------------------------------------------------
const ACK_HARD_DEADLINE_MS = 3000; // Discords 3-Sekunden-Frist
const ACK_WAIT_CAP_MS = 3500;      // Warte-Obergrenze auf die Bestätigung

const fireClick = async () => {
  const interaction = createInteraction(pickKind());
  patchInteractionForTimeoutSafety(interaction);
  const start = performance.now();
  inFlight += 1;
  if (inFlight > peakInFlight) peakInFlight = inFlight;
  fired += 1;

  const handlerPromise = runHandler(interaction).catch((err) => {
    failures += 1;
    console.error(`\n⚠ Handler-Fehler (${interaction.kind}#${interaction.id}):`, err?.stack || err);
  });

  // Auf die Bestätigung warten (Handler selbst, Watchdog ODER Roh-Ack).
  const startWall = Date.now();
  let ackAt = null;
  const ackDeadline = start + ACK_WAIT_CAP_MS;
  while (interaction.__ackAt === null && interaction.__fhAckedAt === undefined && performance.now() < ackDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  ackAt = interaction.__ackAt;
  if (ackAt === null && interaction.__fhAckedAt !== undefined) {
    // Roh-Ack nutzt die Date.now()-Zeitbasis → auf die performance.now()-Basis
    // des Soaks normieren, damit die Latenzvergleiche stimmen.
    ackAt = start + (interaction.__fhAckedAt - startWall);
  }

  const latency = ackAt === null ? Infinity : ackAt - start;
  if (ackAt === null || latency > ACK_HARD_DEADLINE_MS) {
    failures += 1;
    const kind = interaction.kind;
    console.error(`\n🚨 KEINE RECHTZEITIGE BESTÄTIGUNG (${kind}#${interaction.id}) ` +
      `nach ${latency === Infinity ? '>' + ACK_WAIT_CAP_MS : Math.round(latency)} ms ` +
      `(Frist: ${ACK_HARD_DEADLINE_MS} ms, Watchdog: ` +
      `${kind === 'slash' ? INTERACTION_DEFER_AFTER_MS : INTERACTION_COMPONENT_DEFER_AFTER_MS} ms)`);
  } else {
    recordAck(interaction, latency);
  }

  // Handler zu Ende laufen lassen (fängt späte Fehler, z. B. defekte
  // update/editReply-Umleitung nach Watchdog-Defer).
  await handlerPromise;
  inFlight -= 1;
};

const cleanup = async () => {
  await closeRoleServer();
  if (sqliteDb) { try { sqliteDb.close(); } catch { /* bereits geschlossen */ } sqliteDb = null; }
  await Promise.all([
    fs.unlink(probeFile).catch(() => null),
    fs.unlink(dbFile).catch(() => null),
    fs.unlink(`${dbFile}-wal`).catch(() => null),
    fs.unlink(`${dbFile}-shm`).catch(() => null),
    fs.unlink(msgFile).catch(() => null)
  ]);
};

const run = async () => {
  // Probe-Datei für echte async-I/O vorbereiten.
  const buf = Buffer.alloc(64 * 1024, 0x5a);
  await fs.writeFile(probeFile, buf);
  RUN_START = performance.now();

  console.log(`🧪 Watchdog-Soak-Test gestartet`);
  console.log(`   Dauer: ${(CFG.durationMs / 1000).toFixed(0)} s | Klicks/s: ~${CFG.rate} | ` +
    `I/O: ${CFG.minIoMs}–${CFG.maxIoMs} ms | Sync-Stalls: ${Math.round(CFG.stallChance * 100)} % (bis ${CFG.stallMaxMs} ms)`);
  console.log(`   Zusatzlast: API=${CFG.roleRate}/s, SQLite=${CFG.dbRate}/s, Nachrichten=${CFG.msgRate}/s`);
  console.log(`   Watchdog-Konstanten: Komponenten=${INTERACTION_COMPONENT_DEFER_AFTER_MS} ms, ` +
    `Slash=${INTERACTION_DEFER_AFTER_MS} ms, Roh-Ack-Deadline=${INTERACTION_RAW_ACK_DEADLINE_MS} ms | Seed: ${CFG.seed}`);
  console.log(`   Frist: ${ACK_HARD_DEADLINE_MS} ms (Discord) – Überschreitung = Testfehler\n`);

  // Hintergrund-Lastquellen parallel zu den Klicks starten.
  const loadRunners = [roleApiLoad(), dbWriteLoad(), messageFloodLoad()];

  const fires = [];
  const intervalMs = 1000 / CFG.rate;
  let nextProgress = RUN_START + 10000;

  // Feuer-Schleife: Klicks mit zufälligem Abstand verteilt, bis die Zeit um ist.
  while (performance.now() - RUN_START < CFG.durationMs) {
    fires.push(fireClick());
    await new Promise((resolve) => setTimeout(resolve, randInt(Math.max(5, intervalMs * 0.4), intervalMs * 2.2)));

    if (performance.now() >= nextProgress) {
      const elapsed = (performance.now() - RUN_START) / 1000;
      process.stdout.write(`\r[${elapsed.toFixed(0).padStart(5)} s] ${progressLine()}   `);
      nextProgress = performance.now() + 10000;
    }
  }

  // Nachlauf: alle laufenden Klicks zu Ende abwarten (max. ~20 s), dann die
  // Lastquellen (inkl. deren offener Requests) drainen.
  process.stdout.write(`\r\n⏳ Nachlauf: ${inFlight} laufende Klicks abwarten …\n`);
  await Promise.allSettled(fires);
  await Promise.allSettled(loadRunners);

  // Abschluss-Report.
  const lats = acks.map((a) => a.lat).sort((a, b) => a - b);
  const p50 = percentile(lats, 50);
  const p95 = percentile(lats, 95);
  const p99 = percentile(lats, 99);
  const max = lats.length ? lats[lats.length - 1] : 0;
  const watchdogAcks = acks.filter((a) => a.source === 'watchdog').length;
  const selfAcks = acks.filter((a) => a.source === 'self').length;
  const rawAcks = acks.filter((a) => a.source === 'raw').length;
  const byKind = {};
  for (const a of acks) byKind[a.kind] = (byKind[a.kind] || 0) + 1;

  console.log('\n─── Soak-Ergebnis ───────────────────────────────────────');
  console.log(`Klicks gefeuert:      ${fired}`);
  console.log(`Bestätigt (Ack):      ${acks.length} (Watchdog: ${watchdogAcks}, Handler: ${selfAcks}, Roh-Ack: ${rawAcks})`);
  console.log(`Max. gleichzeitig:    ${peakInFlight}`);
  console.log(`Ack-Latenz p50/p95/p99/max: ${p50} / ${p95} / ${p99} / ${max} ms`);
  console.log(`Freigabe-I/O simuliert: ${totalIoOps} Ops, ${Math.round(totalIoMs)} ms gesamt, max. Einzel-I/O ${Math.round(maxSingleIoMs)} ms`);
  console.log(`Sync-Stalls:          ${Math.round(totalStallMs)} ms gesamt`);
  console.log(`Nach Typ:             ${Object.entries(byKind).map(([k, n]) => `${k}=${n}`).join(', ')}`);
  console.log('─── Zusatzlast ────────────────────────────────────────────');
  console.log(`Rollen-API-Calls:     ${roleStats.calls} (Ø ${roleStats.calls ? Math.round(roleStats.totalMs / roleStats.calls) : 0} ms, max ${Math.round(roleStats.maxMs)} ms, Fehler ${roleStats.errors})`);
  console.log(`SQLite-Schreibzugriffe: ${dbStats.writes} in ${dbStats.batches} Batches (Ø ${dbStats.batches ? (dbStats.totalMs / dbStats.batches).toFixed(1) : 0} ms/Batch, max ${Math.round(dbStats.maxMs)} ms)`);
  console.log(`Nachrichten-Flut:     ${msgStats.lines} Zeilen, ${(msgStats.bytes / 1024 / 1024).toFixed(1)} MB (Fehler ${msgStats.errors})`);
  console.log('───────────────────────────────────────────────────────────');
  const stuckSaved = acks.filter((a) => a.kind === 'stuck' && a.source === 'raw').length;
  if (failures === 0 && rawAckCount > 0 && stuckSaved > 0) {
    console.log(`✅ SOAK BESTANDEN – alle ${acks.length} Klicks rechtzeitig bestätigt, keine „hat nicht rechtzeitig reagiert“-Lücke.`);
    console.log(`   Roh-Ack-Deadline hat ${stuckSaved} „hängende-Queue“-Klicks direkt bei Discord bestätigt.`);
  } else {
    console.error(`❌ SOAK FEHLGESCHLAGEN – ${failures} Problem(e)${rawAckCount === 0 ? ' UND Roh-Ack-Pfad wurde nie ausgelöst' : ''}. Seed: ${CFG.seed} (zum Reproduzieren: --seed ${CFG.seed})`);
  }
  await cleanup();
  process.exit(failures === 0 && rawAckCount > 0 && stuckSaved > 0 ? 0 : 1);
};

// Strg+C: vorzeitig beenden, aber mit Report + korrektem Exit-Code.
process.on('SIGINT', () => {
  process.stdout.write('\n\n⏹ Abbruch durch Benutzer – Zwischenstand:\n');
  console.log(progressLine());
  const lats = acks.map((a) => a.lat).sort((a, b) => a - b);
  console.log(`p99=${percentile(lats, 99)} ms, max=${lats.length ? lats[lats.length - 1] : 0} ms, Fehler=${failures} (Seed ${CFG.seed})`);
  cleanup().finally(() => process.exit(failures === 0 ? 0 : 1));
});

run().catch(async (err) => {
  console.error('Soak-Test abgebrochen:', err?.stack || err);
  await cleanup();
  process.exit(1);
});
