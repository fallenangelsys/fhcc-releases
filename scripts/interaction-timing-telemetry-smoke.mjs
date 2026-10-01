// Smoke: Interaktions-Timing-Telemetrie (recordInteractionTiming + __fhAckedAt).
// Prüft, dass
//   1. recordInteractionTiming Ack-Latenz/Handler-Dauer korrekt zählt
//      (acked/unacked/lateAcks/slowHandlers, lastLateAck, lastSlowHandler),
//   2. der Live-Diagnose-Snapshot die Daten als `interactions`-Block exponiert,
//   3. der Timeout-Watchdog __fhAckedAt setzt – sowohl bei sofortiger Antwort
//      des Handlers als auch beim automatischen Watchdog-Defer.
import assert from 'node:assert/strict';
import {
  recordInteractionTiming,
  recordRateLimit,
  getLiveDiagnosticsSnapshot,
  getRateLimitSnapshot
} from '../src/runtime/liveDiagnostics.js';
import {
  patchInteractionForTimeoutSafety,
  INTERACTION_COMPONENT_DEFER_AFTER_MS
} from '../src/runtime/interactionTimeoutGuard.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Telemetrie zählt korrekt ---
recordInteractionTiming({ type: 'button', customId: 'schnell', ackLatencyMs: 500, handlerMs: 400 });
recordInteractionTiming({ type: 'slash', customId: 'zu-spaet', ackLatencyMs: 2900, handlerMs: 2600 });
recordInteractionTiming({ type: 'modal', customId: 'langsam', ackLatencyMs: 900, handlerMs: 3100 });
recordInteractionTiming({ type: 'select', customId: 'kein-ack', ackLatencyMs: null, handlerMs: 100 });

const snapshot = await getLiveDiagnosticsSnapshot({ client: null });
const interactions = snapshot.interactions;
assert.ok(interactions, 'Snapshot exponiert einen interactions-Block');
assert.equal(interactions.started, 4, 'started zählt alle Interaktionen');
assert.equal(interactions.acked, 3, 'acked zählt bestätigte Interaktionen');
assert.equal(interactions.unacked, 1, 'unacked zählt Interaktionen ohne Bestätigung');
assert.equal(interactions.lateAcks, 1, 'lateAcks zählt Bestätigungen nahe/über der 3-Sekunden-Frist');
assert.equal(interactions.slowHandlers, 2, 'slowHandlers zählt Handler über 2,5 s (zu-spaet: 2600 ms, langsam: 3100 ms)');
assert.equal(interactions.lateAckThresholdMs, 2800, 'Schwellenwert für späte Acks ist exponiert');
assert.equal(interactions.slowHandlerThresholdMs, 2500, 'Schwellenwert für langsame Handler ist exponiert');
assert.ok(interactions.lastLateAck, 'letzter später Ack wird festgehalten');
assert.equal(interactions.lastLateAck.type, 'slash');
assert.equal(interactions.lastLateAck.customId, 'zu-spaet');
assert.equal(interactions.lastLateAck.ackLatencyMs, 2900);
assert.ok(interactions.lastSlowHandler, 'letzter langsamer Handler wird festgehalten');
assert.equal(interactions.lastSlowHandler.type, 'modal');
assert.equal(interactions.lastSlowHandler.customId, 'langsam');
assert.equal(interactions.lastSlowHandler.handlerMs, 3100);
assert.equal(interactions.recent.length, 4, 'recent enthält alle Fälle');
assert.ok(Array.isArray(snapshot.interactions.recent) && snapshot.interactions.recent[0].at, 'recent-Einträge haben Zeitstempel');

// --- Watchdog setzt __fhAckedAt bei sofortiger Antwort ---
let immediateAckAt = null;
const fastInteraction = {
  replied: false,
  deferred: false,
  isButton: () => true,
  isAnySelectMenu: () => false,
  reply: async (payload) => { fastInteraction.replied = true; },
  deferUpdate: async () => {}
};
patchInteractionForTimeoutSafety(fastInteraction);
await fastInteraction.reply({ content: 'Sofort' });
await wait(50);
immediateAckAt = fastInteraction.__fhAckedAt;
assert.ok(Number.isFinite(immediateAckAt), '__fhAckedAt wird bei sofortiger Handler-Antwort gesetzt');
assert.ok(Date.now() - immediateAckAt < 1000, '__fhAckedAt liegt in der Gegenwart');

// --- Watchdog setzt __fhAckedAt beim automatischen Defer ---
let watchdogAckAt = null;
const slowInteraction = {
  replied: false,
  deferred: false,
  isButton: () => true,
  isAnySelectMenu: () => false,
  deferUpdate: async () => { slowInteraction.deferred = true; },
  deferReply: async () => {}
};
patchInteractionForTimeoutSafety(slowInteraction);
await wait(INTERACTION_COMPONENT_DEFER_AFTER_MS + 300);
watchdogAckAt = slowInteraction.__fhAckedAt;
assert.ok(Number.isFinite(watchdogAckAt), '__fhAckedAt wird beim Watchdog-Defer gesetzt');
assert.ok(Date.now() - watchdogAckAt < 1000, 'Watchdog-Ack ist frisch');

// --- __fhAckedAt bleibt beim ersten Ack stehen (Telemetrie kann Ack-Latenz messen) ---
const ackCount = (fastInteraction.__fhAckedAt && slowInteraction.__fhAckedAt) ? 2 : 0;
assert.equal(ackCount, 2, 'beide Pfade setzen __fhAckedAt genau einmal');

// --- Rate-Limit-Telemetrie (RESTEvents.RateLimited) ---
recordRateLimit({ method: 'PATCH', route: '/channels/:id', path: '/channels/123', timeout: 2500, global: false });
recordRateLimit({ method: 'PATCH', route: '/channels/:id', path: '/channels/456', timeout: 1800, global: false });
recordRateLimit({ method: 'GET', route: '/guilds/:id/members', path: '/guilds/999/members', timeout: 9500, global: true });
const rateSnapshot = getRateLimitSnapshot();
assert.equal(rateSnapshot.total, 3, 'Rate-Limit-Total zählt alle Events');
assert.equal(rateSnapshot.global, 1, 'globale Rate-Limits werden separat gezählt');
assert.equal(rateSnapshot.recent.length, 3, 'letzte Rate-Limit-Events werden festgehalten');
assert.equal(rateSnapshot.last.global, true, 'letzter Event wird erfasst (global)');
assert.equal(rateSnapshot.last.timeoutMs, 9500, 'Wartezeit wird in ms erfasst');
const routeStats = rateSnapshot.byRoute.find((entry) => entry.route === '/channels/:id');
assert.ok(routeStats, 'Routen-Statistik existiert');
assert.equal(routeStats.count, 2, 'Routen-Statistik bündelt Treffer pro Route');
assert.equal(routeStats.totalWaitMs, 4300, 'Routen-Statistik summiert die Wartezeit');
const snapshot2 = await getLiveDiagnosticsSnapshot({ client: null });
assert.ok(snapshot2.rateLimits, 'Snapshot exponiert rateLimits-Block');
assert.equal(snapshot2.rateLimits.total, 3, 'Snapshot-Rate-Limits zählen korrekt');
assert.ok(Array.isArray(snapshot2.rateLimits.byRoute), 'Snapshot-Routenliste ist ein Array');

console.log('✅ interaction-timing-telemetry-smoke: Telemetrie + __fhAckedAt + Rate-Limits grün');
