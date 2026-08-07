import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ChannelType } from 'discord.js';
import { defaultGuildConfig, featureCards, normalizeConfig } from '../src/defaultConfig.js';
import { _voiceChatCleanerInternals } from '../src/features/voiceChatCleaner.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  normalizeVoiceChatCleanerConfig,
  isVoiceChatChannel,
  isSelectedVoiceChannel,
  channelIsEmpty,
  partitionMessagesForDeletion,
  deletePage,
  purgeVoiceChat,
  BULK_DELETE_MAX_AGE_MS
} = _voiceChatCleanerInternals;

const defaults = normalizeVoiceChatCleanerConfig();
assert.equal(defaults.enabled, false);
assert.deepEqual(defaults.channelIds, []);
assert.equal(defaults.emptyGraceSeconds, 60);
assert.equal(defaults.cleanupOnStartup, true);
assert.equal(defaults.deletePinned, true);
assert.equal(defaults.dryRun, false);

const normalized = normalizeVoiceChatCleanerConfig({
  enabled: true,
  channelIds: ['123', '123', ' 456 '],
  emptyGraceSeconds: 1,
  cleanupOnStartup: false,
  deletePinned: false,
  dryRun: true,
  logChannelId: ' 789 '
});
assert.deepEqual(normalized.channelIds, ['123', '456']);
assert.equal(normalized.emptyGraceSeconds, 10);
assert.equal(normalized.cleanupOnStartup, false);
assert.equal(normalized.deletePinned, false);
assert.equal(normalized.dryRun, true);
assert.equal(normalized.logChannelId, '789');

const voiceChannel = {
  id: '123',
  type: ChannelType.GuildVoice,
  guild: { id: 'guild' },
  members: new Map(),
  messages: {},
  isVoiceBased: () => true,
  isTextBased: () => true
};
assert.equal(isVoiceChatChannel(voiceChannel), true);
assert.equal(isSelectedVoiceChannel(voiceChannel, normalized), true);
assert.equal(channelIsEmpty(voiceChannel), true);
assert.equal(isVoiceChatChannel({ ...voiceChannel, type: ChannelType.GuildText }), false);
assert.equal(channelIsEmpty({ ...voiceChannel, members: new Map([['member', {}]]) }), false);

const now = Date.now();
const young = { id: 'young', createdTimestamp: now - 60_000, pinned: false };
const old = { id: 'old', createdTimestamp: now - BULK_DELETE_MAX_AGE_MS - 60_000, pinned: false };
const pinned = { id: 'pinned', createdTimestamp: now - 60_000, pinned: true };
const complete = partitionMessagesForDeletion([young, old, pinned], now, true);
assert.deepEqual(complete.bulk.map((message) => message.id), ['young', 'pinned']);
assert.deepEqual(complete.individual.map((message) => message.id), ['old']);
assert.equal(complete.skippedPinned.length, 0);
const protectedPins = partitionMessagesForDeletion([young, old, pinned], now, false);
assert.deepEqual(protectedPins.bulk.map((message) => message.id), ['young']);
assert.deepEqual(protectedPins.individual.map((message) => message.id), ['old']);
assert.deepEqual(protectedPins.skippedPinned.map((message) => message.id), ['pinned']);

const calls = { bulk: [], individual: [] };
const deletionChannel = {
  ...voiceChannel,
  bulkDelete: async (ids) => {
    calls.bulk.push([...ids]);
    return new Map(ids.map((id) => [id, { id }]));
  },
  messages: {
    delete: async (id) => {
      calls.individual.push(id);
      return { id };
    }
  }
};
const deletedPage = await deletePage({
  channel: deletionChannel,
  messages: [young, { ...pinned, id: 'young-2', pinned: false }, old],
  conf: { deletePinned: true, dryRun: false },
  expectedAbortVersion: 0
});
assert.deepEqual(calls.bulk, [['young', 'young-2']]);
assert.deepEqual(calls.individual, ['old']);
assert.equal(deletedPage.bulkDeleted, 2);
assert.equal(deletedPage.individuallyDeleted, 1);
assert.equal(deletedPage.failures.length, 0);

calls.bulk.length = 0;
calls.individual.length = 0;
const previewPage = await deletePage({
  channel: deletionChannel,
  messages: [young, old],
  conf: { deletePinned: true, dryRun: true },
  expectedAbortVersion: 0
});
assert.equal(previewPage.bulkDeleted + previewPage.individuallyDeleted, 2);
assert.equal(calls.bulk.length, 0);
assert.equal(calls.individual.length, 0);

const historyMessages = Array.from({ length: 205 }, function (_, index) {
  return {
    id: String(10_000 - index),
    createdTimestamp: now - index * 3 * 60 * 60_000,
    pinned: index === 17
  };
});
const historyIndex = new Map(historyMessages.map(function (message, index) { return [message.id, index]; }));
const removed = new Set();
const pagedChannel = {
  ...voiceChannel,
  messages: {
    fetch: async function (options) {
      const start = options.before ? Number(historyIndex.get(String(options.before)) ?? -1) + 1 : 0;
      const page = historyMessages.slice(start).filter(function (message) { return !removed.has(message.id); }).slice(0, options.limit || 100);
      return new Map(page.map(function (message) { return [message.id, message]; }));
    },
    delete: async function (id) {
      removed.add(String(id));
      return { id };
    }
  },
  bulkDelete: async function (ids) {
    ids.forEach(function (id) { removed.add(String(id)); });
    return new Map(ids.map(function (id) { return [id, { id }]; }));
  }
};
const pagedResult = await purgeVoiceChat({
  channel: pagedChannel,
  conf: { deletePinned: true, dryRun: false },
  status: {},
  expectedAbortVersion: 0
});
assert.equal(pagedResult.complete, true);
assert.equal(pagedResult.deleted, 205);
assert.equal(removed.size, 205);
assert.ok(pagedResult.bulkDeleted > 0);
assert.ok(pagedResult.individuallyDeleted > 0);

const card = featureCards.find((entry) => entry.id === 'voiceChatCleaner');
assert.ok(card, 'Modulkarte fehlt');
assert.deepEqual(card.fields.find((field) => field.key === 'voiceChatCleaner.channelIds')?.channelTypes, [2]);
assert.equal(defaultGuildConfig('guild', 'Test').voiceChatCleaner.enabled, false);
const normalizedGuild = normalizeConfig({ guildId: 'guild', voiceChatCleaner: { enabled: true, channelIds: ['123'], emptyGraceSeconds: 75 } });
assert.equal(normalizedGuild.voiceChatCleaner.enabled, true);
assert.deepEqual(normalizedGuild.voiceChatCleaner.channelIds, ['123']);
assert.equal(normalizedGuild.voiceChatCleaner.emptyGraceSeconds, 75);

const indexSource = fs.readFileSync(path.join(root, 'src', 'index.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(root, 'src', 'dashboard.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(root, 'desktop', 'renderer', 'app.js'), 'utf8');
assert.match(indexSource, /GatewayIntentBits\.GuildVoiceStates/);
assert.match(indexSource, /Events\.VoiceStateUpdate/);
assert.match(indexSource, /voiceChatCleanerFeature/);
assert.match(dashboardSource, /\/api\/guild\/:guildId\/voice-chat-cleaner/);
assert.match(rendererSource, /voiceChatCleanerOverview/);
assert.match(rendererSource, /voice:\s*2/);

console.log('Voice-Chat-Cleaner-Smoke: Löschlogik, Sicherheitsfrist, Konfiguration, Voice-Event, API und UI geprüft.');
