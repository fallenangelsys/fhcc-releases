import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Reproduziert den bekannten Fehler „nur 1× statt 2×“: Die Boost-Meldungen
// treffen ein, während der Bot offline ist (Neustart/Update). Der Backfill
// muss sie aus der SQLite-Instanz des persistenten Serverindex finden –
// die eingefrorenen JSONL-Kanaldateien enthalten sie nicht.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fhcc-boost-db-'));
process.env.FALLEN_HEAVEN_DATA_DIR = root;

const guildId = '1276125977805721640';
const channelId = '1305633786842710087';
const userId = '1069870857612177478';

const { persistServerIndexMessages, flushServerIndex, closeServerIndex } = await import('../src/serverIndexStore.js');
await persistServerIndexMessages([
  {
    id: 'boost-1',
    guildId,
    channelId,
    channelName: 'hauptchat',
    authorId: userId,
    authorName: 'Vampy',
    type: 8,
    system: true,
    createdAt: '2026-08-12T20:44:55.889Z',
    content: 'Vampy hat den Server gerade geboostet!'
  },
  {
    id: 'boost-2',
    guildId,
    channelId,
    channelName: 'hauptchat',
    authorId: userId,
    authorName: 'Vampy',
    type: 8,
    system: true,
    createdAt: '2026-08-12T20:45:04.850Z',
    content: 'Vampy hat den Server gerade geboostet!'
  }
], { source: 'live' });
await flushServerIndex();

const { getIndexedNativeBoostEvents } = await import('../src/features/boostSystemIndex.js');
const channels = new Map([[channelId, { id: channelId, name: 'hauptchat' }]]);
const guild = { id: guildId, channels: { cache: channels } };
const since = Date.parse('2026-08-12T00:00:00.000Z');

const native = await getIndexedNativeBoostEvents({
  guild,
  channelIds: [channelId],
  activeUserIds: [userId],
  since
});

assert.equal(native.length, 2, `Erwartet 2 Boost-Events, erhalten: ${native.length}`);
assert.deepEqual(native.map((entry) => entry.messageId).sort(), ['boost-1', 'boost-2']);
assert.equal(native.every((entry) => entry.type === 'boost' && entry.userId === userId), true);
assert.equal(native.every((entry) => entry.source === 'native-system-index'), true);
// Sortierung chronologisch: boost-1 vor boost-2
assert.ok(native[0].timestamp <= native[1].timestamp);

// Ohne Nutzer-Filter (alle aktiven Booster) ebenfalls vollständig.
const all = await getIndexedNativeBoostEvents({ guild, channelIds: [channelId], since });
assert.equal(all.length, 2);

// Nutzer-Filter greift: fremder Nutzer liefert keine Events.
const none = await getIndexedNativeBoostEvents({
  guild,
  channelIds: [channelId],
  activeUserIds: ['999999999999999999'],
  since
});
assert.equal(none.length, 0);

await closeServerIndex().catch(() => {});
await fs.rm(root, { recursive: true, force: true });
console.log('Boost-SQLite-Backfill-Smoke-Test bestanden (2 Boost-Meldungen nach Neustart gefunden).');
