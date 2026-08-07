import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createKnowledgeProviderRegistry } from '../src/ai/knowledge/providerRegistry.js';
import { composeKnowledgeContext } from '../src/ai/knowledge/consistencyResolver.js';
import { renderDiscordContent } from '../src/ai/knowledge/discordRenderer.js';

const registry = createKnowledgeProviderRegistry([
  { id: 'good', domain: 'test', authority: 'authoritative', load: async () => 'Verifizierter Wert: 2' },
  { id: 'empty', domain: 'test', load: async () => '' },
  { id: 'broken', domain: 'test', load: async () => { throw new Error('Testausfall'); } },
  { id: 'slow', domain: 'test', timeoutMs: 250, load: async () => new Promise((resolve) => setTimeout(() => resolve('zu spät'), 400)) }
]);
const execution = await registry.execute({ requestId: 'test-1' });
assert.equal(execution.results.find((item) => item.provider === 'good')?.status, 'ok');
assert.equal(execution.results.find((item) => item.provider === 'empty')?.status, 'empty');
assert.equal(execution.results.find((item) => item.provider === 'broken')?.status, 'unavailable');
assert.equal(execution.results.find((item) => item.provider === 'slow')?.status, 'unavailable');
const context = composeKnowledgeContext(execution.results, 1000);
assert.match(context, /Verifizierter Wert: 2/);
assert.match(context, /NICHT VERFÜGBARE DATENQUELLEN: broken, slow/);

const longReply = `${'Vollständiger Satz. '.repeat(150)}2.`;
const rendered = renderDiscordContent(longReply);
assert.ok(rendered.length <= 2000);
assert.doesNotMatch(rendered, /\b(?:aber|und|oder|weil|dass|mit|für|von|zu|als)$/i);
assert.doesNotMatch(rendered, /(?:^|\n)\s*(?:[-*•]|\d+[.)])\s*$/);

const temporaryData = await fs.mkdtemp(path.join(os.tmpdir(), 'fhcc-ai-index-'));
process.env.FALLEN_HEAVEN_DATA_DIR = temporaryData;
const {
  closeServerIndex,
  deleteServerIndexMessages,
  getServerIndexAuthorSummary,
  persistServerIndexMessages,
  searchServerIndex
} = await import(`../src/serverIndexStore.js?test=${Date.now()}`);
const guildId = '123456789012345678';
const channelId = '223456789012345678';
const messageId = '323456789012345678';
const base = {
  id: messageId,
  guildId,
  channelId,
  channelName: 'test',
  authorId: '423456789012345678',
  authorName: 'Testmitglied',
  createdAt: new Date().toISOString(),
  content: 'Alpha Originalinhalt',
  embeds: [],
  attachments: []
};
await persistServerIndexMessages([base]);
assert.equal((await searchServerIndex({ guildId, query: 'Alpha', allowedChannelIds: [channelId] })).rows.length, 1);
await persistServerIndexMessages([{ ...base, editedAt: new Date().toISOString(), content: 'Beta bearbeitet' }]);
assert.equal((await searchServerIndex({ guildId, query: 'Alpha', allowedChannelIds: [channelId] })).rows.length, 0);
assert.equal((await searchServerIndex({ guildId, query: 'Beta', allowedChannelIds: [channelId] })).rows.length, 1);
assert.equal((await searchServerIndex({ guildId, query: 'Beta', allowedChannelIds: [] })).rows.length, 0);
assert.equal((await getServerIndexAuthorSummary({ guildId, authorId: base.authorId, allowedChannelIds: [] })).count, 0);
await deleteServerIndexMessages({ guildId, messageIds: [messageId] });
assert.equal((await searchServerIndex({ guildId, query: 'Beta', allowedChannelIds: [channelId] })).rows.length, 0);
await closeServerIndex();
await fs.rm(temporaryData, { recursive: true, force: true });

console.log('AI-Knowledge-Core-Smoke bestanden: Providerstatus, Timeout, Renderer, Index-Edit/Delete und Fail-Closed-Rechte sind geprüft.');
