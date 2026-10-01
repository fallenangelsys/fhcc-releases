#!/usr/bin/env node
/**
 * Smoke-Test: Server-Index-Discovery (memberManagement).
 * Verifiziert, dass periodische Nachzüge mit `cacheOnly: true` KEINE
 * Discord-REST-Calls machen (kein channels.fetch, kein fetchActiveThreads,
 * keine archivierten Threads pro Parent) – nur der Gateway-Cache wird benutzt.
 * Die volle Discovery ohne cacheOnly läuft weiterhin komplett.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fhcc-index-discovery-'));
process.env.FALLEN_HEAVEN_DATA_DIR = root;

const { _memberManagementInternals } = await import('../src/features/memberManagement.js');

let passed = 0;
const ok = (name) => { passed += 1; console.log(`  ✅ ${name}`); };

const makeChannel = (id, { isThread = false, parentId = null } = {}) => ({
  id,
  name: id,
  parentId,
  isTextBased: () => true,
  isThread: () => isThread,
  messages: { fetch: async () => new Map() },
  permissionsFor: () => ({ has: () => true }),
  threads: {
    fetchArchived: async () => { throw new Error('archived fetch darf im cacheOnly-Modus nicht laufen'); }
  }
});

const makeGuild = ({ cacheChannels = [], restFetch = null, restActiveThreads = null }) => {
  const cache = new Map(cacheChannels.map((channel) => [channel.id, channel]));
  return {
    id: 'guild-1',
    members: { me: { permissions: { has: () => true } } },
    channels: {
      cache,
      fetch: restFetch || (async () => new Map(cache)),
      fetchActiveThreads: restActiveThreads || (async () => null)
    }
  };
};

console.log('Cache-Discovery (cacheOnly: true):');
{
  const channel = makeChannel('c1');
  const guild = makeGuild({ cacheChannels: [channel] });
  const result = await _memberManagementInternals.discoverIndexChannels(guild, { cacheOnly: true });
  assert.equal(result.channels.length, 1, 'cacheOnly findet Kanal aus dem Cache');
  assert.equal(result.channels[0].channel.id, 'c1');
  assert.equal(result.discoveryErrors.length, 0, 'cacheOnly erzeugt keine Fehler');
  ok('nutzt nur den Cache und findet Kanäle');
}
{
  // REST-Methoden werfen, wenn sie im cacheOnly-Modus aufgerufen würden.
  const channel = makeChannel('c2');
  const guild = makeGuild({
    cacheChannels: [channel],
    restFetch: async () => { throw new Error('channels.fetch darf im cacheOnly-Modus nicht laufen'); },
    restActiveThreads: async () => { throw new Error('fetchActiveThreads darf im cacheOnly-Modus nicht laufen'); }
  });
  const result = await _memberManagementInternals.discoverIndexChannels(guild, { cacheOnly: true });
  assert.equal(result.channels.length, 1, 'cacheOnly ohne REST-Calls');
  assert.equal(result.discoveryErrors.length, 0);
  ok('ruft keine Discord-REST-Endpoints auf');
}
{
  // Cached Threads werden ebenfalls gefunden (Gateway hält sie aktuell).
  const thread = makeChannel('t1', { isThread: true });
  const guild = makeGuild({ cacheChannels: [thread] });
  const result = await _memberManagementInternals.discoverIndexChannels(guild, { cacheOnly: true });
  assert.equal(result.channels.length, 1);
  assert.equal(result.channels[0].source, 'cached_thread');
  ok('findet gecachte Threads als cached_thread');
}

console.log('Volle Discovery (ohne cacheOnly):');
{
  let fetchCalls = 0;
  const channel = makeChannel('c3');
  const guild = makeGuild({
    cacheChannels: [channel],
    restFetch: async () => { fetchCalls += 1; return new Map([[channel.id, channel]]); }
  });
  const result = await _memberManagementInternals.discoverIndexChannels(guild);
  assert.equal(fetchCalls, 1, 'volle Discovery ruft channels.fetch auf');
  assert.ok(result.channels.length >= 1);
  ok('volle Discovery nutzt weiterhin die REST-Discovery');
}

console.log('6-Stunden-Sicherheitsnetz (Intervall-Konstante):');
{
  const interval = _memberManagementInternals.FULL_DISCOVERY_INTERVAL_MS;
  assert.equal(interval, 6 * 60 * 60 * 1000, 'volles Discovery-Intervall = 6h');
  ok('FULL_DISCOVERY_INTERVAL_MS = 6h');
}

console.log(`\nServer-Index-Discovery: ${passed} Tests grün.`);
process.exit(0);
