import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (process.env.FH_MEMBER_PRIVACY_SMOKE_CHILD !== '1') {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fhcc-member-privacy-'));
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      FH_MEMBER_PRIVACY_SMOKE_CHILD: '1',
      FALLEN_HEAVEN_DATA_DIR: dataRoot
    }
  });
  if (child.stdout) process.stdout.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);
  fs.rmSync(dataRoot, { recursive: true, force: true });
  process.exit(child.status ?? 1);
}

const {
  deleteServerIndexByAuthor,
  getServerIndexAuthorChannelBreakdown,
  persistServerIndexMessages,
  searchServerIndex
} = await import(`../src/serverIndexStore.js?member-privacy=${Date.now()}`);

const guildId = '1500000000000000001';
const channelId = '1500000000000000002';
const leavingMember = '1500000000000000003';
const otherMember = '1500000000000000004';

const base = {
  id: '1500000000000000010', guildId, channelId, channelName: 'chat',
  authorId: leavingMember, authorName: 'Verlassendes Mitglied', createdAt: new Date().toISOString(),
  content: 'Private Nachricht vom Verlassenden', embeds: [], attachments: []
};

await persistServerIndexMessages([
  base,
  { ...base, id: '1500000000000000011', content: 'Zweite Nachricht vom Verlassenden' },
  { ...base, id: '1500000000000000012', authorId: otherMember, authorName: 'Bleibendes Mitglied', content: 'Nachricht vom Bleibenden' }
]);

// Vor dem Verlassen sind beide sichtbar.
assert.equal((await searchServerIndex({ guildId, query: 'Verlassenden', allowedChannelIds: [channelId] })).rows.length, 2);
assert.equal((await searchServerIndex({ guildId, query: 'Bleibenden', allowedChannelIds: [channelId] })).rows.length, 1);

// Channel-Breakdown zählt pro Kanal und erkennt Links & Medien ohne Nachrichtenscan.
const breakdown = await getServerIndexAuthorChannelBreakdown({ guildId, authorId: leavingMember, allowedChannelIds: [channelId] });
assert.equal(breakdown.channels.length, 1, 'eine Kanalzeile für den Autor');
assert.equal(breakdown.channels[0].count, 2, 'beide Nachrichten gezählt');
assert.equal(breakdown.channels[0].channelId, channelId);
assert.equal(breakdown.channels[0].channelName, 'chat');
assert.equal(breakdown.linkCount, 0, 'keine Links im Testinhalt');
assert.equal(breakdown.mediaCount, 0, 'keine Medien im Testinhalt');
assert.ok(Number.isFinite(Date.parse(breakdown.channels[0].lastMessageAt || '')), 'letzte Nachricht als Zeitstempel erkannt');

// Beim Verlassen werden ALLE Nachrichten des Mitglieds gelöscht.
const result = await deleteServerIndexByAuthor({ guildId, authorId: leavingMember });
assert.equal(result.deleted, 2, 'beide Nachrichten des Verlassenden gelöscht');

// Der Bleibende bleibt unberührt.
assert.equal((await searchServerIndex({ guildId, query: 'Verlassenden', allowedChannelIds: [channelId] })).rows.length, 0);
assert.equal((await searchServerIndex({ guildId, query: 'Bleibenden', allowedChannelIds: [channelId] })).rows.length, 1);

// Nach dem Löschen liefert die Breakdown keine Kanalzeile mehr (kein Ghost-State).
const afterDelete = await getServerIndexAuthorChannelBreakdown({ guildId, authorId: leavingMember, allowedChannelIds: [channelId] });
assert.equal(afterDelete.channels.length, 0, 'gelöschter Autor hat keine Kanäle mehr');
assert.equal(afterDelete.linkCount, 0);
assert.equal(afterDelete.mediaCount, 0);

// Fremde Guild / leerer Author ist ein No-Op.
assert.equal((await deleteServerIndexByAuthor({ guildId: '999', authorId: leavingMember })).deleted, 0);
assert.equal((await deleteServerIndexByAuthor({ guildId, authorId: '' })).deleted, 0);

console.log('✅ member-privacy-smoke: Löschung beim Serververlassen grün');
