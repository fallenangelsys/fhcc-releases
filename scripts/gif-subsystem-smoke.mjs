import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { defaultGuildConfig, normalizeConfig } from '../src/defaultConfig.js';
import { _aiChatInternals } from '../src/features/aiChat.js';

const {
  getAiConfig,
  isExplicitGifRequest,
  buildGifSearchQuery,
  normalizeGifUsage,
  normalizeGifProvider,
  normalizeGifContentFilter,
  normalizeGifLocale,
  validateGifUrl,
  normalizeGifLibrary,
  getGifProviderHealth,
  canUseGifProvider,
  recordGifProviderSuccess,
  recordGifProviderError,
  resolveNekosBestCategory,
  searchSafeFreeGif,
  pickGifReply,
  getGifAttribution,
  buildGifMessageContent,
  parseGifControlId,
  createdAtFromGifSessionId,
  getFixedGifSessionWindow,
  sanitizePersistentAssistantAnswer
} = _aiChatInternals;

for (const [name, helper] of Object.entries({
  getAiConfig,
  isExplicitGifRequest,
  buildGifSearchQuery,
  normalizeGifUsage,
  normalizeGifProvider,
  normalizeGifContentFilter,
  normalizeGifLocale,
  validateGifUrl,
  normalizeGifLibrary,
  getGifProviderHealth,
  canUseGifProvider,
  recordGifProviderSuccess,
  recordGifProviderError,
  resolveNekosBestCategory,
  searchSafeFreeGif,
  pickGifReply,
  getGifAttribution,
  buildGifMessageContent,
  parseGifControlId,
  createdAtFromGifSessionId,
  getFixedGifSessionWindow,
  sanitizePersistentAssistantAnswer
})) {
  assert.equal(typeof helper, 'function', `GIF-Helper fehlt: ${name}`);
}

assert.equal(normalizeGifUsage('MOOD'), 'mood');
assert.equal(normalizeGifUsage('immer'), 'on-request');
assert.equal(normalizeGifProvider('library'), 'library');
assert.equal(normalizeGifProvider('tenor-web'), 'hybrid');
assert.equal(normalizeGifProvider('scraper'), 'hybrid');
assert.equal(normalizeGifContentFilter('medium'), 'medium');
assert.equal(normalizeGifContentFilter('off'), 'high');
assert.equal(normalizeGifLocale('en-US'), 'en_US');
assert.equal(normalizeGifLocale('fr_FR'), 'de_DE');
assert.equal(isExplicitGifRequest('Schick mir bitte ein Reaktionsbild dazu'), true);
assert.equal(isExplicitGifRequest('Wie ist deine Reaktion darauf?'), false, 'Normale Fragen dürfen nicht versehentlich ein GIF erzwingen');
assert.equal(buildGifSearchQuery('ein wütendes GIF', ''), 'angry annoyed reaction');
assert.equal(buildGifSearchQuery('ein Facepalm GIF', ''), 'facepalm reaction');

assert.equal(validateGifUrl('https://cdn.example.org/reactions/happy.gif'), 'https://cdn.example.org/reactions/happy.gif');
assert.equal(validateGifUrl('https://cdn.example.org/reactions/happy.gif#tracking'), 'https://cdn.example.org/reactions/happy.gif');
assert.equal(validateGifUrl('http://cdn.example.org/reactions/happy.gif'), '');
assert.equal(validateGifUrl('https://localhost/happy.gif'), '');
assert.equal(validateGifUrl('https://192.168.1.12/happy.gif'), '');
assert.equal(validateGifUrl('https://user:password@cdn.example.org/happy.gif'), '');
assert.equal(validateGifUrl('https://cdn.example.org:8443/happy.gif'), '');
assert.equal(validateGifUrl('https://cdn.example.org/not-a-direct-file'), '');
assert.equal(validateGifUrl('https://evil.example.org/happy.gif', { trustedHosts: ['media.tenor.com'] }), '');
assert.equal(validateGifUrl('https://media.tenor.com/abc/reaction.gif', { trustedHosts: ['media.tenor.com'] }), 'https://media.tenor.com/abc/reaction.gif');

assert.deepEqual(normalizeGifLibrary([
  'https://cdn.example.org/a.gif',
  'https://cdn.example.org/a.gif',
  'http://cdn.example.org/b.gif',
  'https://127.0.0.1/private.gif',
  'https://cdn.example.org/not-direct'
]), ['https://cdn.example.org/a.gif']);

const normalized = normalizeConfig({
  id: 'gif-smoke',
  aiChat: {
    gifUsage: 'invalid',
    gifProvider: 'tenor-web',
    tenorContentFilter: 'off',
    tenorLocale: 'fr_FR',
    tenorApiKey: 'must-never-survive',
    gifLibrary: ['https://cdn.example.org/safe.gif', 'https://localhost/private.gif', 'https://cdn.example.org/not-direct']
  }
});
assert.equal(normalized.aiChat.gifUsage, 'on-request');
assert.equal(normalized.aiChat.gifProvider, 'hybrid');
assert.equal(normalized.aiChat.tenorContentFilter, 'high');
assert.equal(normalized.aiChat.tenorLocale, 'de_DE');
assert.deepEqual(normalized.aiChat.gifLibrary, ['https://cdn.example.org/safe.gif']);
assert.equal(Object.hasOwn(normalized.aiChat, 'tenorApiKey'), false, 'Tenor-Key darf nicht in normalisierter Guild-Config vorkommen');
assert.equal(Object.hasOwn(defaultGuildConfig('gif-smoke').aiChat, 'tenorApiKey'), false, 'Tenor-Key darf nicht im Default gespeichert werden');

const runtimeConfig = getAiConfig({ aiChat: {
  useGifReplies: true,
  gifUsage: 'invalid',
  gifProvider: 'tenor-web',
  tenorContentFilter: 'off',
  tenorLocale: 'fr_FR',
  tenorApiKey: 'plaintext-secret',
  gifLibrary: ['https://cdn.example.org/good.gif', 'http://localhost/bad.gif']
} });
assert.equal(runtimeConfig.gifUsage, 'on-request');
assert.equal(runtimeConfig.gifProvider, 'hybrid');
assert.equal(runtimeConfig.tenorContentFilter, 'high');
assert.equal(runtimeConfig.tenorLocale, 'de_DE');
assert.deepEqual(runtimeConfig.gifLibrary, ['https://cdn.example.org/good.gif']);
assert.equal(Object.hasOwn(runtimeConfig, 'tenorApiKey'), false, 'Runtime darf den Guild-Key nicht übernehmen');

recordGifProviderError('smoke-provider', { code: 'timeout' });
assert.equal(canUseGifProvider('smoke-provider'), false);
assert.equal(getGifProviderHealth('smoke-provider').lastError.code, 'timeout');
recordGifProviderSuccess('smoke-provider');
assert.equal(canUseGifProvider('smoke-provider'), true);

assert.equal(resolveNekosBestCategory('bitte ein trauriges GIF', '', 'high'), 'hug');
assert.equal(resolveNekosBestCategory('gute Nacht', '', 'high'), 'sleep');
assert.equal(resolveNekosBestCategory('ein Katzen GIF', '', 'high'), 'nya');
assert.equal(resolveNekosBestCategory('ein Hunde GIF', '', 'high'), '', 'Der Reaktions-Fallback darf keine thematisch falschen Tier-GIFs liefern');
assert.equal(resolveNekosBestCategory('ein Kuss GIF', '', 'high'), 'blowkiss');
assert.equal(resolveNekosBestCategory('ein Kuss GIF', '', 'low'), 'kiss');

const originalFetch = globalThis.fetch;
const originalTenorKey = process.env.TENOR_API_KEY;
let calls = 0;
let lastRequest = null;
globalThis.fetch = async (url, options = {}) => {
  calls += 1;
  lastRequest = { url: String(url), options };
  const suffix = calls === 1 ? 'first' : 'second';
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: (name) => String(name).toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null },
    json: async () => ({
      results: [{ url: `https://nekos.best/api/v2/hug/${suffix}.gif` }]
    })
  };
};

try {
  delete process.env.TENOR_API_KEY;
  const safeAi = {
    useGifReplies: true,
    gifUsage: 'on-request',
    gifProvider: 'tenor',
    gifChancePercent: 100,
    tenorContentFilter: 'high',
    tenorLocale: 'de_DE',
    gifLibrary: []
  };
  const first = await searchSafeFreeGif(safeAi, 'bitte ein trauriges GIF', '', []);
  assert.equal(first, 'https://nekos.best/api/v2/hug/first.gif');
  assert.match(lastRequest.url, /^https:\/\/nekos\.best\/api\/v2\/hug\?amount=10$/);
  assert.match(String(lastRequest.options.headers['user-agent']), /FHCC-Fallen-Heaven/);

  const second = await searchSafeFreeGif(safeAi, 'bitte ein trauriges GIF', '', [first]);
  assert.equal(second, 'https://nekos.best/api/v2/hug/second.gif', 'Gesehene GIFs müssen durch eine frische Auswahl ersetzt werden');
  assert.equal(calls, 2);

  const providerFallback = await pickGifReply(safeAi, 'schick mir ein trauriges GIF', '', []);
  assert.match(providerFallback, /^https:\/\/nekos\.best\/api\/v2\/hug\//, 'Tenor-Modus muss ohne ENV-Key sicher zurückfallen');

  const libraryOnly = await pickGifReply({
    ...safeAi,
    gifProvider: 'library',
    gifLibrary: ['https://cdn.example.org/approved.gif', 'https://localhost/private.gif']
  }, 'schick ein GIF', '', []);
  assert.equal(libraryOnly, 'https://cdn.example.org/approved.gif');
} finally {
  globalThis.fetch = originalFetch;
  if (originalTenorKey === undefined) delete process.env.TENOR_API_KEY;
  else process.env.TENOR_API_KEY = originalTenorKey;
  recordGifProviderSuccess('nekos-best');
  recordGifProviderSuccess('tenor');
}

assert.equal(getGifAttribution('https://media.tenor.com/abc/reaction.gif'), 'via Tenor');
assert.equal(getGifAttribution('https://nekos.best/api/v2/hug/test.gif'), 'via nekos.best');
assert.equal(buildGifMessageContent('Hier', 'https://media.tenor.com/abc/reaction.gif'), 'Hier · via Tenor\nhttps://media.tenor.com/abc/reaction.gif');

const extensionlessGif = 'https://cdn.example.org/media/render?id=42&format=animated';
assert.equal(
  sanitizePersistentAssistantAnswer(`Hier\n${extensionlessGif}`, [extensionlessGif]),
  'Hier\n[GIF gesendet]',
  'Auch extensionlose Provider-URLs dürfen nicht im Memory landen'
);

const createdAt = Date.now() - 5_000;
const sessionId = `g${createdAt.toString(36)}-abc123`;
assert.equal(createdAtFromGifSessionId(sessionId), createdAt);
assert.deepEqual(parseGifControlId(`ai-gif-next:${sessionId}:7`), { sessionId, switches: 7 });
assert.equal(parseGifControlId(`ai-gif-next:${sessionId}:99`).switches, 12);
assert.equal(parseGifControlId('ai-gif-next:x:0'), null);
const liveWindow = getFixedGifSessionWindow(sessionId, 0, createdAt + 10_000);
assert.equal(liveWindow.createdAt, createdAt);
assert.equal(liveWindow.expiresAt, createdAt + 30 * 60_000);
assert.equal(liveWindow.expired, false);
assert.equal(getFixedGifSessionWindow(sessionId, 0, liveWindow.expiresAt + 1).expired, true, 'Neustart darf die 30-Minuten-Frist nicht verlängern');

const [aiChatSource, configSource, channelRendererSource, rendererStyles] = await Promise.all([
  fs.readFile(new URL('../src/features/aiChat.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../src/defaultConfig.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../desktop/renderer/server-management.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../desktop/renderer/styles.css', import.meta.url), 'utf8')
]);
assert.doesNotMatch(aiChatSource, /tenor\.com\/search\//i, 'Tenor-HTML-Scraping darf nicht mehr existieren');
assert.doesNotMatch(aiChatSource, /nekos\.life/i, 'Veralteter nekos.life-Fallback darf nicht mehr existieren');
assert.doesNotMatch(aiChatSource, /ai\.tenorApiKey|cfg\.aiChat\?\.tenorApiKey/, 'Runtime darf keinen Guild-Tenor-Key lesen');
assert.doesNotMatch(configSource, /key:\s*['"]aiChat\.tenorApiKey['"]/, 'Dashboard darf kein Klartext-Key-Feld mehr anbieten');
assert.match(channelRendererSource, /isDirectImageMediaUrl\(withMedia\)/, 'Kanal-Inhalt muss echte Mediendateien von GIF-Webseiten unterscheiden');
assert.doesNotMatch(channelRendererSource, /if \(isImageUrl\(withMedia\) \|\| isGifUrl\(withMedia\)\)/, 'Tenor- und Giphy-Seitenlinks dürfen nicht als direkte Bildquelle gerendert werden');
assert.match(rendererStyles, /\.message-row\s*\{[^}]*position:\s*relative;[^}]*grid-template-columns:\s*34px minmax\(0,1fr\) auto;/s, 'Nachrichtentext braucht eine belastbare, nicht kollabierende Grid-Spalte');
assert.match(rendererStyles, /\.message-actions\s*\{[^}]*position:\s*absolute;[^}]*pointer-events:\s*none;/s, 'Unsichtbare Nachrichtenaktionen dürfen keine Textbreite belegen');

console.log('GIF subsystem smoke passed.');
