import assert from 'node:assert/strict';
import {
  patchInteractionForTimeoutSafety,
  __setRawAckFetcher,
  INTERACTION_DEFER_AFTER_MS,
  INTERACTION_COMPONENT_DEFER_AFTER_MS,
  INTERACTION_RAW_ACK_DEADLINE_MS,
  INTERACTION_SLASH_RAW_ACK_DEADLINE_MS
} from '../src/runtime/interactionTimeoutGuard.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Fall 1: Handler antwortet nicht → Auto-Defer nach 2,5 s ---
let deferredVia = null;
const slowInteraction = {
  replied: false,
  deferred: false,
  isButton: () => true,
  isAnySelectMenu: () => false,
  deferUpdate: async () => { deferredVia = 'deferUpdate'; slowInteraction.deferred = true; },
  deferReply: async () => { deferredVia = 'deferReply'; slowInteraction.deferred = true; }
};
patchInteractionForTimeoutSafety(slowInteraction);
await wait(INTERACTION_DEFER_AFTER_MS + 400);
assert.equal(deferredVia, 'deferUpdate', 'Komponente wird nach Frist automatisch per deferUpdate bestätigt');
assert.equal(slowInteraction.deferred, true, 'Interaktion gilt danach als deferred');

// --- Fall 2: reply nach Auto-Defer (Komponente) → followUp, Original bleibt ---
let followUpPayload = null;
let editReplyPayload = null;
const compInteraction = {
  replied: false,
  deferred: false,
  isButton: () => true,
  isAnySelectMenu: () => false,
  deferUpdate: async () => { compInteraction.deferred = true; },
  followUp: async (payload) => { followUpPayload = payload; },
  editReply: async (payload) => { editReplyPayload = payload; }
};
patchInteractionForTimeoutSafety(compInteraction);
await wait(INTERACTION_DEFER_AFTER_MS + 400);
await compInteraction.reply({ content: 'Hallo' });
assert.ok(followUpPayload, 'reply nach deferUpdate läuft über followUp (Original-Nachricht bleibt)');
assert.equal(followUpPayload.content, 'Hallo');
assert.equal(editReplyPayload, null, 'kein editReply für reply nach deferUpdate');

// --- Fall 3: Handler antwortet sofort selbst → kein Auto-Defer ---
let selfReplyPayload = null;
let selfDeferred = false;
const fastInteraction = {
  replied: false,
  deferred: false,
  isButton: () => true,
  isAnySelectMenu: () => false,
  reply: async (payload) => { selfReplyPayload = payload; },
  deferUpdate: async () => { selfDeferred = true; fastInteraction.deferred = true; }
};
patchInteractionForTimeoutSafety(fastInteraction);
await fastInteraction.reply({ content: 'Schnell' });
await wait(INTERACTION_DEFER_AFTER_MS + 300);
assert.equal(selfReplyPayload?.content, 'Schnell', 'schnelle Handler antworten unverändert per reply');
assert.equal(selfDeferred, false, 'kein Auto-Defer wenn der Handler selbst antwortet');

// --- Fall 4: update nach Auto-Defer → editReply (ersetzt Original) ---
let updateEditPayload = null;
const updInteraction = {
  replied: false,
  deferred: false,
  isButton: () => true,
  isAnySelectMenu: () => false,
  deferUpdate: async () => { updInteraction.deferred = true; },
  update: async () => { throw new Error('update darf nach defer nicht direkt laufen'); },
  editReply: async (payload) => { updateEditPayload = payload; }
};
patchInteractionForTimeoutSafety(updInteraction);
await wait(INTERACTION_DEFER_AFTER_MS + 400);
await updInteraction.update({ content: 'Neu' });
assert.equal(updateEditPayload?.content, 'Neu', 'update nach Auto-Defer läuft über editReply');

// --- Fall 5: Slash-Command (kein Button) → deferReply statt deferUpdate ---
let cmdDeferredVia = null;
const commandInteraction = {
  replied: false,
  deferred: false,
  isButton: () => false,
  isAnySelectMenu: () => false,
  deferReply: async (opts) => { cmdDeferredVia = opts?.ephemeral ?? 'none'; commandInteraction.deferred = true; },
  deferUpdate: async () => { cmdDeferredVia = 'deferUpdate'; commandInteraction.deferred = true; }
};
patchInteractionForTimeoutSafety(commandInteraction);
await wait(INTERACTION_DEFER_AFTER_MS + 400);
assert.equal(cmdDeferredVia, false, 'Slash-Command wird per deferReply bestätigt');

// --- Fall 6: idempotent – doppeltes Patchen ändert nichts ---
const idem = {
  replied: false,
  deferred: false,
  isButton: () => true,
  isAnySelectMenu: () => false,
  deferUpdate: async () => { idem.deferred = true; }
};
patchInteractionForTimeoutSafety(idem);
const firstReply = idem.reply;
patchInteractionForTimeoutSafety(idem);
assert.equal(idem.reply, firstReply, 'zweites Patchen ist ein No-Op (__fhTimeoutPatched)');

// --- Fall 7: Komponenten-Watchdog bestätigt nach der Schonfrist, VIEL vor der 3-Sekunden-Frist ---
assert.ok(INTERACTION_COMPONENT_DEFER_AFTER_MS > 0, 'Komponenten-Watchdog hat eine Schonfrist (>0 ms) für eigene Antworten/Modals');
assert.ok(INTERACTION_COMPONENT_DEFER_AFTER_MS < 3000, 'Komponenten-Watchdog bestätigt deutlich vor Discords 3-Sekunden-Frist');
assert.ok(INTERACTION_COMPONENT_DEFER_AFTER_MS < INTERACTION_DEFER_AFTER_MS, 'Komponenten schneller als Slash-Commands');
const startedAt = Date.now();
const fastWatchInteraction = {
  replied: false,
  deferred: false,
  isButton: () => true,
  isAnySelectMenu: () => false,
  deferUpdate: async () => { fastWatchInteraction.deferred = true; },
  deferReply: async () => {}
};
patchInteractionForTimeoutSafety(fastWatchInteraction);
await wait(INTERACTION_COMPONENT_DEFER_AFTER_MS + 400);
assert.equal(fastWatchInteraction.deferred, true, 'Langsame Komponente wird nach der Schonfrist automatisch bestätigt');
assert.ok(Date.now() - startedAt < 2000, 'Bestätigung passiert weit vor der 3-Sekunden-Frist');

// --- Fall 8: deferReply nach Watchdog-Defer ist ein No-Op (kein Abbruch) ---
let noOpReply = null;
const lateDeferInteraction = {
  replied: false,
  deferred: false,
  isButton: () => true,
  isAnySelectMenu: () => false,
  deferUpdate: async () => { lateDeferInteraction.deferred = true; },
  deferReply: async () => { noOpReply = 'deferReply-lief'; }
};
patchInteractionForTimeoutSafety(lateDeferInteraction);
await wait(INTERACTION_COMPONENT_DEFER_AFTER_MS + 300);
const lateAck = await lateDeferInteraction.deferReply({ flags: 64 });
assert.equal(lateAck, true, 'deferReply nach Watchdog-Defer resolved statt zu werfen');
assert.equal(noOpReply, null, 'originale deferReply wird nach Watchdog-Defer NICHT nochmal aufgerufen');

// --- Fall 9: direkter editReply nach Watchdog-Defer → followUp statt Panel-Zerstörung ---
let lateFollowUp = null;
let lateEditReply = null;
const lateEditInteraction = {
  replied: false,
  deferred: false,
  isButton: () => true,
  isAnySelectMenu: () => false,
  deferUpdate: async () => { lateEditInteraction.deferred = true; },
  followUp: async (payload) => { lateFollowUp = payload; },
  editReply: async (payload) => { lateEditReply = payload; }
};
patchInteractionForTimeoutSafety(lateEditInteraction);
await wait(INTERACTION_COMPONENT_DEFER_AFTER_MS + 300);
await lateEditInteraction.editReply({ content: 'Ergebnis' });
assert.ok(lateFollowUp, 'editReply nach Watchdog-Defer läuft über followUp');
assert.equal(lateFollowUp.content, 'Ergebnis');
assert.equal(lateEditReply, null, 'das Original-Panel wird nicht überschrieben');

// --- Fall 10: update nach Watchdog-Defer → Original-Panel wird bearbeitet ---
let lateUpdateEdit = null;
const lateUpdateInteraction = {
  replied: false,
  deferred: false,
  isButton: () => true,
  isAnySelectMenu: () => false,
  deferUpdate: async () => { lateUpdateInteraction.deferred = true; },
  update: async () => { throw new Error('update darf nach defer nicht direkt laufen'); },
  followUp: async () => { throw new Error('update darf nicht auf followUp landen'); },
  editReply: async (payload) => { lateUpdateEdit = payload; }
};
patchInteractionForTimeoutSafety(lateUpdateInteraction);
await wait(INTERACTION_COMPONENT_DEFER_AFTER_MS + 300);
await lateUpdateInteraction.update({ content: 'Panel neu' });
assert.equal(lateUpdateEdit?.content, 'Panel neu', 'update nach Watchdog-Defer bearbeitet weiterhin das Original-Panel');

// --- Fall 11: eigenes deferUpdate des Handlers → editReply bleibt Original-Edit ---
let ownEditPayload = null;
const ownDeferInteraction = {
  replied: false,
  deferred: false,
  isButton: () => true,
  isAnySelectMenu: () => false,
  deferUpdate: async () => { ownDeferInteraction.deferred = true; },
  followUp: async () => { throw new Error('eigenes deferUpdate darf nicht auf followUp landen'); },
  editReply: async (payload) => { ownEditPayload = payload; }
};
patchInteractionForTimeoutSafety(ownDeferInteraction);
await ownDeferInteraction.deferUpdate();
await ownDeferInteraction.editReply({ content: 'Panel-Ansicht' });
assert.equal(ownEditPayload?.content, 'Panel-Ansicht', 'nach eigenem deferUpdate bleibt editReply der Panel-Edit');

// --- Fall 12: eigenes deferReply des Handlers → editReply ersetzt die Bestätigung ---
let ownDeferEdit = null;
const ownDeferReplyInteraction = {
  replied: false,
  deferred: false,
  isButton: () => true,
  isAnySelectMenu: () => false,
  deferReply: async () => { ownDeferReplyInteraction.deferred = true; },
  editReply: async (payload) => { ownDeferEdit = payload; }
};
patchInteractionForTimeoutSafety(ownDeferReplyInteraction);
await ownDeferReplyInteraction.deferReply({ flags: 64 });
await ownDeferReplyInteraction.editReply({ content: 'Antwort' });
assert.equal(ownDeferEdit?.content, 'Antwort', 'nach eigenem deferReply ersetzt editReply die Antwort');

// --- Fall 13: Modal-Submits zählen wie Komponenten → sofortiges deferUpdate ---
let modalDeferredVia = null;
const modalInteraction = {
  replied: false,
  deferred: false,
  isButton: () => false,
  isAnySelectMenu: () => false,
  isModalSubmit: () => true,
  deferUpdate: async () => { modalDeferredVia = 'deferUpdate'; modalInteraction.deferred = true; },
  deferReply: async () => { modalDeferredVia = 'deferReply'; modalInteraction.deferred = true; }
};
patchInteractionForTimeoutSafety(modalInteraction);
await wait(INTERACTION_COMPONENT_DEFER_AFTER_MS + 300);
assert.equal(modalDeferredVia, 'deferUpdate', 'Modal-Submit wird nach der Schonfrist per deferUpdate bestätigt (nicht per langsamem deferReply)');
assert.equal(modalInteraction.deferred, true, 'Modal gilt danach als deferred');

// --- Fall 14: Soffrt-Update (update im selben Tick) verhindert den Watchdog-Defer ---
let syncUpdatePayload = null;
let syncDeferred = false;
const syncUpdateInteraction = {
  replied: false,
  deferred: false,
  isButton: () => true,
  isAnySelectMenu: () => false,
  update: async (payload) => { syncUpdatePayload = payload; syncUpdateInteraction.deferred = true; },
  deferUpdate: async () => { syncDeferred = true; }
};
patchInteractionForTimeoutSafety(syncUpdateInteraction);
await syncUpdateInteraction.update({ content: 'Sofort' });
await wait(150);
assert.equal(syncUpdatePayload?.content, 'Sofort', 'synchrones update() ersetzt direkt die Nachricht');
assert.equal(syncDeferred, false, 'kein extra Watchdog-Defer, wenn der Handler selbst im selben Tick antwortet');

// --- Fall 15: editReply VOR jeder Bestätigung (fehlerhafter Handler) löscht den Watchdog NICHT ---
let premEditDeferred = false;
const prematureEditInteraction = {
  replied: false,
  deferred: false,
  isButton: () => true,
  isAnySelectMenu: () => false,
  editReply: async () => {},
  deferUpdate: async () => { premEditDeferred = true; prematureEditInteraction.deferred = true; }
};
patchInteractionForTimeoutSafety(prematureEditInteraction);
await prematureEditInteraction.editReply({ content: 'zu früh' });
await wait(INTERACTION_COMPONENT_DEFER_AFTER_MS + 300);
assert.equal(premEditDeferred, true, 'editReply vor Bestätigung lässt den Watchdog bewaffnet – er bestätigt trotzdem');

// --- Fall 16: followUp VOR jeder Bestätigung löscht den Watchdog ebenfalls nicht ---
let premFollowDeferred = false;
const prematureFollowInteraction = {
  replied: false,
  deferred: false,
  isButton: () => true,
  isAnySelectMenu: () => false,
  followUp: async () => {},
  deferUpdate: async () => { premFollowDeferred = true; prematureFollowInteraction.deferred = true; }
};
patchInteractionForTimeoutSafety(prematureFollowInteraction);
await prematureFollowInteraction.followUp({ content: 'zu früh' });
await wait(INTERACTION_COMPONENT_DEFER_AFTER_MS + 300);
assert.equal(premFollowDeferred, true, 'followUp vor Bestätigung lässt den Watchdog bewaffnet – er bestätigt trotzdem');

// --- Fall 17: fehlschlagendes reply() (API-Fehler) lässt den Watchdog bewaffnet ---
let failReplyDeferred = false;
const failReplyInteraction = {
  replied: false,
  deferred: false,
  isButton: () => true,
  isAnySelectMenu: () => false,
  reply: async () => { throw new Error('API-Fehler'); },
  deferUpdate: async () => { failReplyDeferred = true; failReplyInteraction.deferred = true; }
};
patchInteractionForTimeoutSafety(failReplyInteraction);
await failReplyInteraction.reply({ content: 'schlägt fehl' }).catch(() => null);
await wait(INTERACTION_COMPONENT_DEFER_AFTER_MS + 300);
assert.equal(failReplyDeferred, true, 'fehlschlagendes reply() lässt den Watchdog bewaffnet – er bestätigt trotzdem');

// --- Fall 18: showModal innerhalb der Schonfrist hebt den Watchdog auf ---
let modalOpened = false;
let modalWatchdogDeferred = false;
const showModalInteraction = {
  replied: false,
  deferred: false,
  isButton: () => true,
  isAnySelectMenu: () => false,
  showModal: async () => { modalOpened = true; showModalInteraction.replied = true; },
  deferUpdate: async () => { modalWatchdogDeferred = true; showModalInteraction.deferred = true; }
};
patchInteractionForTimeoutSafety(showModalInteraction);
await showModalInteraction.showModal({ title: 'Grund', custom_id: 'x', components: [] });
await wait(INTERACTION_COMPONENT_DEFER_AFTER_MS + 400);
assert.equal(modalOpened, true, 'showModal öffnet das Modal (erste Antwort)');
assert.equal(modalWatchdogDeferred, false, 'showModal hebt den Watchdog auf – kein deferUpdate danach');
assert.ok(Number.isFinite(showModalInteraction.__fhAckedAt), 'showModal setzt __fhAckedAt (gültiger Ack für die Telemetrie)');

// --- Fall 19: showModal NACH Watchdog-Defer wirft nicht (kein unhandled Fehler) ---
let lateModalCalled = false;
let lateModalDeferred = false;
const lateModalInteraction = {
  replied: false,
  deferred: false,
  isButton: () => true,
  isAnySelectMenu: () => false,
  showModal: async () => { lateModalCalled = true; },
  deferUpdate: async () => { lateModalDeferred = true; lateModalInteraction.deferred = true; }
};
patchInteractionForTimeoutSafety(lateModalInteraction);
await wait(INTERACTION_COMPONENT_DEFER_AFTER_MS + 300);
const lateModalResult = await lateModalInteraction.showModal({ title: 'Grund', custom_id: 'x', components: [] });
assert.equal(lateModalDeferred, true, 'Watchdog hat vor dem showModal-Versuch bestätigt');
assert.equal(lateModalCalled, false, 'showModal nach bestätigter Interaktion wird NICHT an die API gesendet');
assert.equal(lateModalResult, undefined, 'showModal nach bestätigter Interaktion wirft nicht (Handler mit .catch crashen nicht)');

// --- Fall 20: HÄNGENDE REST-QUEUE → harte Deadline feuert den Roh-Ack direkt ---
// Szenario aus der Praxis: Die discord.js-REST-Queue ist durch Rate-Limit-
// Wartezeiten blockiert – weder Handler noch Watchdog-Defer kommen durch.
// Die harte Deadline muss den Bestätigungs-Callback DIREKT per HTTP senden.
let rawCallback = null;
__setRawAckFetcher(async (url, options) => {
  rawCallback = { url, body: JSON.parse(options.body) };
  return { ok: true };
});
let stuckDeferred = false;
let stuckFollowUp = null;
let stuckEdit = null;
const stuckQueueInteraction = {
  id: '123456789012345678',
  token: 'abc.def.ghi',
  replied: false,
  deferred: false,
  isButton: () => true,
  isAnySelectMenu: () => false,
  // Simuliert die hängende Queue: der deferUpdate-Aufruf resolved nie von selbst.
  deferUpdate: async () => new Promise(() => { stuckDeferred = true; }),
  followUp: async (payload) => { stuckFollowUp = payload; },
  editReply: async (payload) => { stuckEdit = payload; }
};
patchInteractionForTimeoutSafety(stuckQueueInteraction);
const stuckAckPromise = stuckQueueInteraction.deferUpdate();
// Die harte Deadline ist unref'd – ein ref'd wait() hält den Event-Loop am
// Leben, bis der Roh-Ack gefeuert hat, dann löst der Race den Aufruf auf.
await wait(INTERACTION_RAW_ACK_DEADLINE_MS + 500);
const stuckAck = await stuckAckPromise;
assert.equal(stuckDeferred, true, 'Handler versucht deferUpdate (Queue hängt)');
assert.ok(rawCallback, 'harte Deadline sendet den Roh-Ack direkt an Discord');
assert.equal(rawCallback.body.type, 6, 'Komponenten-Ack ist DEFERRED_UPDATE_MESSAGE (6)');
assert.ok(rawCallback.url.includes('/interactions/123456789012345678/abc.def.ghi/callback'), 'Roh-Ack nutzt den direkten Callback-Endpoint');
assert.deepEqual(stuckAck, { __fhRawAcked: true }, 'hängender deferUpdate-Aufruf wird durch den Roh-Ack sofort aufgelöst');
assert.ok(stuckQueueInteraction.__fhAckedAt, 'Roh-Ack setzt __fhAckedAt (Telemetrie)');
await stuckQueueInteraction.reply({ content: 'Antwort nach Roh-Ack' });
assert.ok(stuckFollowUp, 'Antworten nach Roh-Ack laufen über followUp');
assert.equal(stuckFollowUp.content, 'Antwort nach Roh-Ack');
assert.equal(stuckEdit, null, 'kein editReply für reply nach Roh-Ack');

// --- Fall 21: Slash-Command mit hängender Queue → Roh-Ack Typ 5 ---
let slashRawCallback = null;
__setRawAckFetcher(async (url, options) => {
  slashRawCallback = JSON.parse(options.body);
  return { ok: true };
});
let slashStuck = false;
const stuckSlashInteraction = {
  id: '111111111111111111',
  token: 'tok.slash.x',
  replied: false,
  deferred: false,
  isButton: () => false,
  isAnySelectMenu: () => false,
  deferReply: async () => new Promise(() => { slashStuck = true; })
};
patchInteractionForTimeoutSafety(stuckSlashInteraction);
const slashAckPromise = stuckSlashInteraction.deferReply();
await wait(INTERACTION_SLASH_RAW_ACK_DEADLINE_MS + 500);
const slashAck = await slashAckPromise;
assert.equal(slashStuck, true, 'Slash-Handler versucht deferReply (Queue hängt)');
assert.ok(slashRawCallback, 'Slash-Roh-Ack wird direkt gesendet');
assert.equal(slashRawCallback.type, 5, 'Slash-Ack ist DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE (5)');
assert.deepEqual(slashAck, { __fhRawAcked: true }, 'hängender deferReply wird durch den Roh-Ack aufgelöst');

// --- Fall 22: Roh-Ack wird versucht, wenn auch der Watchdog-Defer scheitert ---
// (REST-Queue komplett down: deferUpdate UND deferReply werfen. Nur die harte
// Deadline kann dann noch den direkten HTTP-Ack versuchen.)
let failedRaw = null;
__setRawAckFetcher(async () => { failedRaw = true; return { ok: false }; });
const failedRawInteraction = {
  id: '222222222222222222',
  token: 'tok.fail.x',
  replied: false,
  deferred: false,
  isButton: () => true,
  isAnySelectMenu: () => false,
  deferUpdate: async () => { throw new Error('Queue kaputt'); },
  deferReply: async () => { throw new Error('Queue kaputt'); }
};
patchInteractionForTimeoutSafety(failedRawInteraction);
await wait(INTERACTION_RAW_ACK_DEADLINE_MS + 400);
assert.equal(failedRaw, true, 'Roh-Ack wird versucht, wenn der Watchdog-Defer scheitert');
assert.equal(failedRawInteraction.deferred, false, 'kein discord.js-Ack möglich (Queue wirklich down)');
assert.equal(failedRawInteraction.replied, false, 'Interaktion bleibt unbestätigt, wenn das Netz wirklich weg ist');

// --- Fall 23: Handler antwortet sofort → weder Watchdog noch Roh-Ack feuern ---
let rawFired = false;
__setRawAckFetcher(async () => { rawFired = true; return { ok: true }; });
let fastRawReply = null;
const fastRawInteraction = {
  id: '333333333333333333',
  token: 'tok.fast.x',
  replied: false,
  deferred: false,
  isButton: () => true,
  isAnySelectMenu: () => false,
  reply: async (payload) => { fastRawReply = payload; fastRawInteraction.replied = true; },
  deferUpdate: async () => {}
};
patchInteractionForTimeoutSafety(fastRawInteraction);
await fastRawInteraction.reply({ content: 'Blitz' });
await wait(INTERACTION_RAW_ACK_DEADLINE_MS + 400);
assert.equal(fastRawReply?.content, 'Blitz', 'schnelle Handler antworten unverändert');
assert.equal(rawFired, false, 'kein Roh-Ack, wenn der Handler selbst antwortet');

// --- Fall 24: cleanup – Deadline/Watchdog-Timer werden entfernt, kein offener Handle ---
__setRawAckFetcher(null);
const cleanupInteraction = {
  id: '444444444444444444',
  token: 'tok.clean.x',
  replied: false,
  deferred: false,
  isButton: () => true,
  isAnySelectMenu: () => false,
  deferUpdate: async () => { cleanupInteraction.deferred = true; }
};
patchInteractionForTimeoutSafety(cleanupInteraction);
assert.equal(typeof cleanupInteraction.__fhClearTimeoutGuards, 'function', 'Cleanup-Funktion wird bereitgestellt');
cleanupInteraction.__fhClearTimeoutGuards();
await wait(INTERACTION_RAW_ACK_DEADLINE_MS + 300);
assert.equal(cleanupInteraction.deferred, false, 'nach Cleanup feuert weder Watchdog noch Roh-Ack');

console.log('✅ interaction-timeout-guard-smoke: alle Assertions grün');
