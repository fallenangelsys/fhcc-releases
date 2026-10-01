import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fhcc-boost-evidence-'));
process.env.FALLEN_HEAVEN_DATA_DIR = root;

const guildId = '1276125977805721640';
const mainChannelId = '1305633786842710087';
const infoChannelId = '1370069606559125534';
const lossChannelId = '1404532593575067690';
const userId = '555555555555555555';

const writeRows = async (channelId, rows) => {
  const folder = path.join(root, 'server-index', guildId, channelId);
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, '2026-08.jsonl'), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
};

await writeRows(mainChannelId, [{
  id: 'native-message',
  authorId: userId,
  authorBot: false,
  channelId: mainChannelId,
  channelName: 'hauptchat',
  createdAt: '2026-08-03T12:00:00.000Z',
  type: 8,
  content: ''
}]);
await writeRows(infoChannelId, [{
  id: 'info-message',
  authorId: '678344927997853742',
  authorBot: true,
  channelId: infoChannelId,
  channelName: '╰🚀〢boost-info',
  createdAt: '2026-08-03T12:00:02.000Z',
  content: `<@${userId}>`,
  embeds: [{ title: 'Danke für den Boost!', description: 'Du gibst FALLEN HEAVEN gerade extra Power!' }]
}]);
await writeRows(lossChannelId, [{
  id: 'scheduled-expiry',
  authorId: '1067880912538304583',
  authorBot: true,
  channelId: lossChannelId,
  channelName: 'boost-log',
  createdAt: '2026-08-03T12:01:00.000Z',
  content: `<@${userId}> Boost läuft ab am 05.08.`,
  embeds: []
}, {
  id: 'real-loss',
  authorId: '1067880912538304583',
  authorBot: true,
  channelId: lossChannelId,
  channelName: 'boost-log',
  createdAt: '2026-08-03T12:02:00.000Z',
  content: '',
  embeds: [{
    title: 'Wir haben einen Booster verloren!',
    description: `<@${userId}> hat aufgehört den Server zu boosten!`
  }]
}]);

const { getIndexedBoostEvidenceEvents, getIndexedNativeBoostEvents } = await import('../src/features/boostSystemIndex.js');
// getIndexedNativeBoostEvents öffnet seit dem SQLite-Backfill auch die
// Index-Datenbank – vor dem Aufräumen schließen, sonst bleibt die WAL-Datei gesperrt.
const { closeServerIndex } = await import('../src/serverIndexStore.js');
const channels = new Map([
  [mainChannelId, { id: mainChannelId, name: 'hauptchat' }],
  [infoChannelId, { id: infoChannelId, name: '╰🚀〢boost-info' }],
  [lossChannelId, { id: lossChannelId, name: 'boost-log' }]
]);
const guild = { id: guildId, channels: { cache: channels, fetch: async () => null } };
const channelIds = [...channels.keys()];
const since = Date.parse('2026-08-03T00:00:00.000Z');

const native = await getIndexedNativeBoostEvents({ guild, channelIds, activeUserIds: [userId], since });
const evidence = await getIndexedBoostEvidenceEvents({ guildId, channelIds, activeUserIds: [userId], since });

assert.equal(native.length, 1);
assert.equal(native[0].type, 'boost');
assert.deepEqual(evidence.map((entry) => entry.type).sort(), ['boost-info', 'expired']);
assert.equal(evidence.some((entry) => entry.messageId === 'scheduled-expiry'), false);

await closeServerIndex().catch(() => {});
await fs.rm(root, { recursive: true, force: true });
console.log('Boost-Evidence-Index-Smoke-Test bestanden.');
