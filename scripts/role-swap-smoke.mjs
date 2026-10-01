import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// State in ein eigenes Temp-Verzeichnis lenken, damit der Test niemals echte
// lokale Daten berührt – daher dynamischer Import.
process.env.FALLEN_HEAVEN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-roleswap-smoke-'));
const { _roleSwapInternals } = await import('../src/features/roleSwap.js');
const {
  settings,
  parsePairs,
  computeSwapActions,
  setRoleChangeImpl,
  processMemberUpdate,
  ensureLoaded,
  persist
} = _roleSwapInternals;

// --- Konfigurations-Parsing ---
assert.deepEqual(parsePairs('111>222\n\n333>444\r\n'), [
  { triggerRoleId: '111', swapRoleId: '222' },
  { triggerRoleId: '333', swapRoleId: '444' }
], 'Paare aus Zeilen im Format trigger>swap');
assert.deepEqual(parsePairs('kaputt\n111>222'), [{ triggerRoleId: '111', swapRoleId: '222' }], 'ungültige Zeilen werden gefiltert');
assert.deepEqual(parsePairs(''), [], 'leere Config = keine Paare');

const conf = settings({ roleSwap: { enabled: true, pairs: '111>222', logChannelId: 'chan1' } });
assert.equal(conf.enabled, true);
assert.deepEqual(conf.pairs, [{ triggerRoleId: '111', swapRoleId: '222' }]);
assert.equal(conf.logChannelId, 'chan1');
assert.equal(settings({ roleSwap: { enabled: false, pairs: '111>222' } }).enabled, false, 'deaktiviert');

// --- Reine Entscheidungslogik ---
const pairs = [{ triggerRoleId: 'MUTE', swapRoleId: 'VOICE' }];
const keyOf = (swapRoleId) => 'g1:u1:' + swapRoleId;

// Auslöser-Rolle kommt dazu → Tausch-Rolle entfernen
let actions = computeSwapActions({
  oldRoles: ['VOICE'],
  newRoles: ['VOICE', 'MUTE'],
  pairs,
  entries: {},
  keyOf
});
assert.deepEqual(actions, [{ type: 'remove', swapRoleId: 'VOICE' }], 'Trigger neu → remove');

// Auslöser-Rolle kommt dazu, aber Tausch-Rolle fehlt schon → nichts tun
actions = computeSwapActions({
  oldRoles: [],
  newRoles: ['MUTE'],
  pairs,
  entries: {},
  keyOf
});
assert.deepEqual(actions, [], 'Trigger neu, Swap fehlt → keine Aktion');

// Auslöser-Rolle weg + State-Eintrag (von uns entfernt) → wiederherstellen
actions = computeSwapActions({
  oldRoles: ['MUTE'],
  newRoles: [],
  pairs,
  entries: { [keyOf('VOICE')]: { hadSwapRole: true } },
  keyOf
});
assert.deepEqual(actions, [{ type: 'restore', swapRoleId: 'VOICE' }], 'Trigger weg + State → restore');

// Auslöser-Rolle weg, aber NIE von uns entfernt (kein State-Eintrag) → nur aufräumen
actions = computeSwapActions({
  oldRoles: ['MUTE'],
  newRoles: [],
  pairs,
  entries: {},
  keyOf
});
assert.deepEqual(actions, [{ type: 'forget', swapRoleId: 'VOICE' }], 'Trigger weg, kein State → forget');

// Auslöser-Rolle weg, aber Tausch-Rolle ist manuell zurückgegeben → nicht doppelt vergeben
actions = computeSwapActions({
  oldRoles: ['MUTE'],
  newRoles: ['VOICE'],
  pairs,
  entries: { [keyOf('VOICE')]: { hadSwapRole: true } },
  keyOf
});
assert.deepEqual(actions, [{ type: 'forget', swapRoleId: 'VOICE' }], 'Swap manuell wieder da → nur forget');

// --- Integrationspfad: processMemberUpdate mit injiziertem Rollen-Service ---
const calls = [];
setRoleChangeImpl(async ({ member, addRoleIds = [], removeRoleIds = [], reason }) => {
  calls.push({ userId: member.id, add: [...addRoleIds], remove: [...removeRoleIds], reason });
  for (const id of addRoleIds) member.roles.cache.set(id, { id });
  for (const id of removeRoleIds) member.roles.cache.delete(id);
});

const guild = { id: 'g1', channels: { cache: new Map() } };
const makeMember = (roles) => ({
  id: 'u1',
  guild,
  user: { bot: false },
  roles: { cache: new Map(roles.map((id) => [id, { id }])) }
});

const cfg = { roleSwap: { enabled: true, pairs: '111>222', logChannelId: '' } };

// 1) Auslöser-Rolle (111) kommt dazu → Tausch-Rolle (222) wird entfernt, State entsteht
let oldMember = makeMember(['222']);
let newMember = makeMember(['222', '111']);
await processMemberUpdate({ oldMember, newMember, cfg });
assert.deepEqual(calls.map((c) => ({ add: c.add, remove: c.remove })), [{ add: [], remove: ['222'] }], 'Tausch-Rolle wird bei Auslöser-Rolle entfernt');
assert.equal(newMember.roles.cache.has('222'), false, 'Tausch-Rolle weg nach Auslöser-Rolle');
let state = await ensureLoaded();
assert.ok(state.entries['g1:u1:222']?.hadSwapRole, 'State merkt sich die Entfernung');
await persist();

// 2) Neustart-Simulation: State neu laden (Datei) und Auslöser-Rolle weg → Tausch-Rolle zurück
const { _roleSwapInternals: freshInternals } = await import('../src/features/roleSwap.js?' + Date.now());
freshInternals.setRoleChangeImpl(async ({ member, addRoleIds = [], removeRoleIds = [] }) => {
  calls.push({ userId: member.id, add: [...addRoleIds], remove: [...removeRoleIds] });
  for (const id of addRoleIds) member.roles.cache.set(id, { id });
  for (const id of removeRoleIds) member.roles.cache.delete(id);
});
oldMember = makeMember(['111']);
newMember = makeMember([]);
await freshInternals.processMemberUpdate({ oldMember, newMember, cfg });
const last = calls[calls.length - 1];
assert.deepEqual({ add: last.add, remove: last.remove }, { add: ['222'], remove: [] }, 'Auslöser weg → Tausch-Rolle zurück');
assert.equal(newMember.roles.cache.has('222'), true, 'Tausch-Rolle wieder da');
state = await freshInternals.ensureLoaded();
assert.equal(state.entries['g1:u1:222'], undefined, 'State-Eintrag wird nach Restore gelöscht');

// 3) Bots werden ignoriert
calls.length = 0;
const botMember = makeMember(['222', '111']);
botMember.user.bot = true;
await processMemberUpdate({ oldMember: makeMember(['222']), newMember: botMember, cfg });
assert.equal(calls.length, 0, 'Bots werden nicht angefasst');

// 4) Deaktiviert → keine Aktion
calls.length = 0;
oldMember = makeMember(['222']);
newMember = makeMember(['222', '111']);
await processMemberUpdate({ oldMember, newMember, cfg: { roleSwap: { enabled: false, pairs: '111>222' } } });
assert.equal(calls.length, 0, 'deaktiviertes Modul ändert nichts');

// --- normalizeConfig hält die roleSwap-Sektion ---
const { normalizeConfig } = await import('../src/defaultConfig.js');
const normalized = normalizeConfig({ roleSwap: { enabled: true, pairs: '111>222', logChannelId: 'chan' } });
assert.equal(normalized.roleSwap.enabled, true);
assert.equal(normalized.roleSwap.pairs, '111>222');
assert.equal(normalized.roleSwap.logChannelId, 'chan');
const defaults = normalizeConfig({});
assert.equal(defaults.roleSwap.enabled, false, 'Standard: aus');
assert.equal(defaults.roleSwap.pairs, '', 'Standard: keine Paare');

console.log('✅ role-swap-smoke: alle Assertions grün');
