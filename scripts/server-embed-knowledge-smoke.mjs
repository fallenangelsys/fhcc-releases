import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.env.FH_SERVER_EMBED_SMOKE_CHILD !== '1') {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fhcc-server-embed-'));
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      FH_SERVER_EMBED_SMOKE_CHILD: '1',
      FALLEN_HEAVEN_DATA_DIR: dataRoot
    }
  });
  if (child.stdout) process.stdout.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);
  fs.rmSync(dataRoot, { recursive: true, force: true });
  process.exit(child.status ?? 1);
}

const {
  getServerEmbedKnowledgeResult,
  getServerIndexChannelPage,
  getServerIndexAuthorSummary,
  persistServerIndexMessages
} = await import(`../src/serverIndexStore.js?server-embed-smoke=${Date.now()}`);

const guildId = '1300000000000000001';
const botId = '1300000000000000002';
const memberId = '1300000000000000003';
const visibleGuideChannel = '1306724753805021194';
const visibleGeneralChannel = '1300000000000000005';
const hiddenStaffChannel = '1300000000000000006';
const createdAt = (minute) => `2026-08-05T07:${String(minute).padStart(2, '0')}:00.000Z`;

await persistServerIndexMessages([
  {
    id: '1400000000000000001', guildId, channelId: visibleGuideChannel, channelName: 'vip-vorteile',
    channelType: 0, authorId: botId, authorName: 'FALLEN HEAVEN', authorBot: true, createdAt: createdAt(1), content: '',
    embeds: [{
      author: { name: 'FALLEN HEAVEN · VIP' }, title: 'Heaven Coins verwenden',
      description: 'VIP-Rollen können für dich selbst freigeschaltet oder verschenkt werden.',
      fields: [{ name: 'VIP', value: '500 Heaven Coins' }, { name: 'VIP GOLD', value: '4.000 Heaven Coins' }],
      footer: { text: 'Öffne dafür ein Support-Ticket.' }
    }]
  },
  {
    id: '1400000000000000002', guildId, channelId: visibleGeneralChannel, channelName: 'hauptchat',
    channelType: 0, authorId: memberId, authorName: 'Mitglied', authorBot: false, createdAt: createdAt(2), content: '',
    embeds: [{ title: 'Nicht offizielle Behauptung', description: 'VIP kostet angeblich nichts.' }]
  },
  {
    id: '1400000000000000003', guildId, channelId: hiddenStaffChannel, channelName: 'staff',
    channelType: 0, authorId: botId, authorName: 'FALLEN HEAVEN', authorBot: true, createdAt: createdAt(3), content: '',
    embeds: [{ title: 'Vertraulicher Staff-Hinweis', description: 'Dieser Text darf nicht sichtbar sein.' }]
  },
  {
    id: '1400000000000000004', guildId, channelId: visibleGeneralChannel, channelName: 'hauptchat',
    channelType: 0, authorId: memberId, authorName: 'Mitglied', authorBot: false, createdAt: createdAt(4), content: 'Erste Nachricht.'
  },
  {
    id: '1400000000000000005', guildId, channelId: visibleGuideChannel, channelName: 'vip-vorteile',
    channelType: 0, authorId: memberId, authorName: 'Mitglied', authorBot: false, createdAt: createdAt(5), content: 'Zweite Nachricht.'
  }
], { source: 'server-embed-smoke' });

const knowledge = await getServerEmbedKnowledgeResult({
  guildId,
  query: 'Was kann ich mit Heaven Coins machen und welche VIP Rolle kostet 500?',
  allowedChannelIds: [visibleGuideChannel, visibleGeneralChannel],
  maxEntries: 40
});

assert.match(knowledge.context, /Heaven Coins verwenden/);
assert.match(knowledge.context, /500 Heaven Coins/);
assert.match(knowledge.context, /Support-Ticket/);
assert.doesNotMatch(knowledge.context, /Nicht offizielle Behauptung/);
assert.doesNotMatch(knowledge.context, /Vertraulicher Staff-Hinweis/);
assert.ok(knowledge.evidence.some((entry) => entry.channelId === visibleGuideChannel));

const summary = await getServerIndexAuthorSummary({
  guildId,
  authorId: memberId,
  allowedChannelIds: [visibleGuideChannel, visibleGeneralChannel]
});
assert.equal(summary.count, 3);
assert.equal(summary.channelCount, 2);

const pageChannel = '1300000000000000007';
await persistServerIndexMessages(Array.from({ length: 25 }, (_, index) => ({
  id: String(1500000000000000000n + BigInt(index + 1)),
  guildId,
  channelId: pageChannel,
  channelName: 'seiten-test',
  channelType: 0,
  authorId: botId,
  authorName: 'FALLEN HEAVEN',
  authorBot: true,
  createdAt: `2026-08-05T08:${String(index).padStart(2, '0')}:00.000Z`,
  content: `Indexnachricht ${index + 1}`
})), { source: 'channel-page-smoke' });
const firstPage = await getServerIndexChannelPage({ guildId, channelId: pageChannel, page: 1, pageSize: 10 });
const lastPage = await getServerIndexChannelPage({ guildId, channelId: pageChannel, page: 3, pageSize: 10 });
assert.equal(firstPage.totalMessages, 25);
assert.equal(firstPage.totalPages, 3);
assert.deepEqual(firstPage.rows.map((row) => row.content), Array.from({ length: 10 }, (_, index) => `Indexnachricht ${index + 16}`));
assert.deepEqual(lastPage.rows.map((row) => row.content), Array.from({ length: 5 }, (_, index) => `Indexnachricht ${index + 1}`));

console.log('Server-Embed-Wissen, Index-Kanalzählung und direkter Seitensprung bestanden.');
