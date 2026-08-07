import assert from 'node:assert/strict';
import http from 'node:http';
import {
  _webSearchInternals,
  buildWebSearchCacheKey,
  isCurrentNewsSearchQuery,
  isGenericNewsSearchQuery,
  isPublicIpAddress,
  normalizeWebResult,
  parsePublicWebUrl,
  prepareWebSearchQuery,
  rankWebResults,
  validateResolvedPublicUrl
} from '../src/features/webSearch.js';

const fixedNow = new Date('2026-08-03T12:00:00.000Z');

assert.equal(parsePublicWebUrl('https://www.reuters.com/world/?utm_source=test&id=7#top')?.href, 'https://www.reuters.com/world/?id=7');
assert.equal(parsePublicWebUrl('https://user:secret@example.com/'), null);
assert.equal(parsePublicWebUrl('https://example.com:8443/private'), null);
assert.equal(parsePublicWebUrl('http://localhost/'), null);
assert.equal(parsePublicWebUrl('http://localhost./'), null);
assert.equal(parsePublicWebUrl('http://api.localhost/'), null);
assert.equal(parsePublicWebUrl('http://service.internal/'), null);
assert.equal(parsePublicWebUrl('http://127.1/'), null);
assert.equal(parsePublicWebUrl('http://2130706433/'), null);
assert.equal(parsePublicWebUrl('http://0x7f000001/'), null);
assert.equal(parsePublicWebUrl('http://10.0.0.1/'), null);
assert.equal(parsePublicWebUrl('http://172.16.0.1/'), null);
assert.equal(parsePublicWebUrl('http://192.168.0.1/'), null);
assert.equal(parsePublicWebUrl('http://169.254.169.254/latest/meta-data/'), null);
assert.equal(parsePublicWebUrl('http://[::1]/'), null);
assert.equal(parsePublicWebUrl('http://[::ffff:127.0.0.1]/'), null);
assert.equal(parsePublicWebUrl('http://[::ffff:7f00:1]/'), null);
assert.equal(parsePublicWebUrl('http://[fc00::1]/'), null);
assert.equal(parsePublicWebUrl('http://[fe80::1]/'), null);
assert.ok(parsePublicWebUrl('https://8.8.8.8/dns-query'));
assert.ok(parsePublicWebUrl('https://[2606:4700:4700::1111]/dns-query'));
assert.equal(isPublicIpAddress('192.0.2.1'), false);
assert.equal(isPublicIpAddress('8.8.8.8'), true);
assert.equal(isPublicIpAddress('2606:4700:4700::1111'), true);

const privateDns = await validateResolvedPublicUrl('https://safe.example.org/article', async () => [
  { address: '93.184.216.34', family: 4 },
  { address: '127.0.0.1', family: 4 }
]);
assert.equal(privateDns, null, 'a single private DNS answer must fail closed');
const publicDns = await validateResolvedPublicUrl('https://safe.example.org/article', async () => [
  { address: '93.184.216.34', family: 4 },
  { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 }
]);
assert.ok(publicDns);

assert.equal(isGenericNewsSearchQuery('News von heute bitte'), true);
assert.equal(isGenericNewsSearchQuery('Was gibt es heute Neues?'), true);
assert.equal(isGenericNewsSearchQuery('Top News des Tages'), true);
assert.equal(isGenericNewsSearchQuery('Aktuelle News zu NVIDIA'), false);
assert.equal(isCurrentNewsSearchQuery('News zur Technikmesse 2019', { now: fixedNow }), false);
const genericNews = prepareWebSearchQuery('News von heute bitte', { now: fixedNow, region: 'Deutschland' });
assert.match(genericNews, /2026-08-03/);
assert.match(genericNews, /Deutschland/);
assert.match(prepareWebSearchQuery('Aktuelle News zu NVIDIA', { now: fixedNow }), /NVIDIA/);
assert.equal(prepareWebSearchQuery('News zur Technikmesse 2019', { now: fixedNow }), 'News zur Technikmesse 2019');
assert.notEqual(buildWebSearchCacheKey('C++ Tutorial', {}), buildWebSearchCacheKey('C# Tutorial', {}));
assert.notEqual(
  buildWebSearchCacheKey('gleiche Frage', { webFetchPages: 0 }),
  buildWebSearchCacheKey('gleiche Frage', { webFetchPages: 2 })
);

const fresh = normalizeWebResult({
  title: 'Aktuelle politische Nachrichten aus Deutschland',
  url: 'https://www.reuters.com/world/europe/2026/08/03/example',
  snippet: 'Die wichtigsten Meldungen des Tages.',
  publishedAt: '2026-08-03T09:00:00Z'
}, 'Test');
const stale = normalizeWebResult({
  title: 'Alte Nachrichten aus Deutschland',
  url: 'https://www.bbc.com/news/2025/01/01/example',
  snippet: 'Eine alte Meldung.',
  publishedAt: '2025-01-01T09:00:00Z'
}, 'Test');
const freshSecondary = normalizeWebResult({
  title: 'Nachrichten des Tages',
  url: 'https://example.org/2026/08/03/tagesmeldung',
  snippet: 'Aktuelle Meldungen aus Politik und Wirtschaft.',
  publishedAt: '2026-08-03T08:00:00Z'
}, 'Test');
const ranked = rankWebResults([stale, freshSecondary, fresh], 'News von heute', 5, { now: fixedNow });
assert.equal(ranked.length, 2);
assert.equal(ranked.some((entry) => entry.url.includes('/2025/')), false, 'stale current-news evidence must be rejected');
assert.equal(ranked[0].url.includes('reuters.com'), true, 'fresh authoritative evidence should rank first');

const server = http.createServer((request, response) => {
  if (request.url === '/slow-body') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.write('{"ok":');
    return;
  }
  if (request.url === '/large-body') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ payload: 'x'.repeat(500) }));
    return;
  }
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end('{"ok":true}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
try {
  const startedAt = Date.now();
  await assert.rejects(
    _webSearchInternals.requestJson(`http://127.0.0.1:${address.port}/slow-body`, {}, 300),
    /abort|timed out|web request/i
  );
  assert.ok(Date.now() - startedAt < 1500, 'timeout must include a body that never completes');
  await assert.rejects(
    _webSearchInternals.requestJson(`http://127.0.0.1:${address.port}/large-body`, {}, 1000, 64),
    /size limit/i
  );
} finally {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

_webSearchInternals.clearCaches();
let providerCalls = 0;
const unique = `cpp-module-${Date.now()}`;
const provider = async () => {
  providerCalls += 1;
  await new Promise((resolve) => setTimeout(resolve, 40));
  return [{
    provider: 'Test Provider',
    title: `${unique} C++ Modul Referenz`,
    url: `https://8.8.8.8/${unique}`,
    content: `Dokumentation für ${unique} und C++`,
    publishedAt: fixedNow.toISOString()
  }];
};
const requestOptions = { now: fixedNow, maxResults: 3 };
const [firstContext, secondContext] = await Promise.all([
  _webSearchInternals.searchWithProviders(`${unique} C++`, requestOptions, [provider]),
  _webSearchInternals.searchWithProviders(`${unique} C++`, requestOptions, [provider])
]);
assert.equal(providerCalls, 1, 'identical concurrent searches must share one in-flight request');
assert.equal(firstContext, secondContext);
assert.match(firstContext, /BEGIN_UNTRUSTED_WEB_DATA/);
assert.match(firstContext, /Qualität/);
assert.match(firstContext, /Veröffentlicht/);

_webSearchInternals.clearCaches();
let emptyCalls = 0;
const emptyProvider = async () => { emptyCalls += 1; return []; };
const emptyQuery = `keine-treffer-${Date.now()}`;
assert.equal(await _webSearchInternals.searchWithProviders(emptyQuery, {}, [emptyProvider]), '');
assert.equal(await _webSearchInternals.searchWithProviders(emptyQuery, {}, [emptyProvider]), '');
assert.equal(emptyCalls, 1, 'empty results need a short negative cache');

console.log('Web search hardening smoke passed.');
