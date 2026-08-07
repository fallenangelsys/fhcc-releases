import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Collection } from 'discord.js';

import { _aiChatInternals } from '../src/features/aiChat.js';
import { normalizeConfig } from '../src/defaultConfig.js';

const {
  getAiConfig,
  shouldCleanAiChannel,
  cleanupEligibleMessages,
  cleanAiChannelIfIdle,
  buildWelcomeEmbed,
  ensureWelcomeEmbed,
  getWelcomeEmbedMessageId
} = _aiChatInternals;

assert.equal(shouldCleanAiChannel({ lastActivityAt: 1_000, now: 1_000 + 59 * 60_000, idleMinutes: 60 }), false);
assert.equal(shouldCleanAiChannel({ lastActivityAt: 1_000, now: 1_000 + 60 * 60_000, idleMinutes: 60 }), true);
assert.equal(shouldCleanAiChannel({ lastActivityAt: 0, now: Date.now(), idleMinutes: 60 }), false);

const fullNormalized = normalizeConfig({ guildId: 'guild-cleaner', aiChat: { channelIdleMinutes: 5 } });
const normalized = fullNormalized.aiChat;
assert.equal(normalized.autoCleanChannel, true);
assert.equal(normalized.channelIdleMinutes, 15);
assert.equal(normalized.keepPinnedMessages, true);
assert.equal(normalized.welcomeEmbedEnabled, true);
const welcomeTemplates = Array.isArray(fullNormalized.embeds?.templates) ? fullNormalized.embeds.templates : [];
const aiWelcomeTemplate = welcomeTemplates.find((template) => template.id === 'ai-chat-welcome');
assert.ok(aiWelcomeTemplate, 'AI-Chat-Willkommensvorlage muss im Embed Studio vorhanden sein');
assert.ok(String(aiWelcomeTemplate?.embed?.description || '').length > 20, 'Standard-Info-Text muss die Frage-Möglichkeiten erklären');
assert.equal(getAiConfig({ aiChat: { channelIdleMinutes: 20000 } }).channelIdleMinutes, 10080);
assert.equal(getAiConfig({ aiChat: { welcomeEmbedEnabled: false } }).welcomeEmbedEnabled, false);

const candidates = cleanupEligibleMessages([
  { id: '1', pinned: false, deletable: true },
  { id: '2', pinned: true, deletable: true },
  { id: '3', pinned: false, deletable: false }
], true);
assert.deepEqual(candidates.map((message) => message.id), ['1']);

// Das Info-Embed wird geschützt, auch wenn es nicht angepinnt ist.
const withProtectedEmbed = cleanupEligibleMessages([
  { id: '1', pinned: false, deletable: true },
  { id: '2', pinned: false, deletable: true },
  { id: '3', pinned: true, deletable: true }
], true, ['2']);
assert.deepEqual(withProtectedEmbed.map((message) => message.id), ['1']);

const oldTimestamp = Date.now() - 20 * 60_000;
const recentMessages = new Collection([
  ['1002', { id: '1002', pinned: false, deletable: true, createdTimestamp: oldTimestamp, delete: async () => {} }],
  ['1001', { id: '1001', pinned: false, deletable: true, createdTimestamp: oldTimestamp - 1_000, delete: async () => {} }],
  ['1000', { id: '1000', pinned: true, deletable: true, createdTimestamp: oldTimestamp - 2_000, delete: async () => { throw new Error('Angepinnte Nachricht darf nicht gelöscht werden.'); } }]
]);
let fetchCount = 0;
let bulkIds = [];
const channel = {
  id: 'channel-cleaner',
  isTextBased: () => true,
  permissionsFor: () => ({ has: () => true }),
  messages: {
    fetch: async () => {
      fetchCount += 1;
      if (fetchCount <= 2) return recentMessages;
      return new Collection();
    }
  },
  bulkDelete: async (ids) => {
    bulkIds = [...ids];
    return new Collection(bulkIds.map((id) => [id, recentMessages.get(id)]));
  }
};
const guild = {
  id: 'guild-cleaner',
  name: 'Testserver',
  channels: {
    cache: new Collection([[channel.id, channel]]),
    fetch: async () => channel
  },
  members: { me: { id: 'bot' } }
};
const result = await cleanAiChannelIfIdle({
  guild,
  cfg: {
    aiChat: {
      enabled: true,
      channelId: channel.id,
      autoCleanChannel: true,
      channelIdleMinutes: 15,
      keepPinnedMessages: true,
      welcomeEmbedEnabled: false
    }
  }
});
assert.equal(result.reason, 'cleaned');
assert.equal(result.deleted, 2);
assert.deepEqual(bulkIds.sort(), ['1001', '1002']);

// --- Info-Embed: Anlegen, Aktualisieren und Cleaner-Schutz ---
const statePath = path.join(process.cwd(), 'data', 'ai-memory', 'welcome-embeds.json');
const hadState = await fs.access(statePath).then(() => true).catch(() => false);
const originalState = hadState ? await fs.readFile(statePath, 'utf8') : '';
await fs.rm(statePath, { force: true });

try {
let sentEmbeds = [];
let editedEmbeds = [];
const welcomeChannel = {
  id: 'chan-welcome',
  isTextBased: () => true,
  permissionsFor: () => ({ has: () => true }),
  messages: {
    fetch: async (id) => (id === 'embed-1' ? {
      id: 'embed-1',
      content: '',
      embeds: [{
        title: 'Willkommen im AI Chat',
        description: 'Frag mich einfach etwas.',
        color: 0x9b59b6,
        timestamp: undefined,
        footer: { text: '' },
        thumbnail: null,
        image: null,
        fields: []
      }],
      edit: async (payload) => { editedEmbeds.push(payload); }
    } : null)
  },
  send: async (payload) => {
    sentEmbeds.push(payload);
    return { id: 'embed-1', embeds: payload.embeds };
  }
};
const welcomeGuild = {
  id: 'guild-welcome',
  name: 'Welcome-Test',
  channels: {
    cache: new Collection([[welcomeChannel.id, welcomeChannel]]),
    fetch: async () => welcomeChannel
  },
  members: { me: { id: 'bot' } }
};

const embedCfg = {
  aiChat: {
    enabled: true,
    channelId: 'chan-welcome',
    welcomeEmbedEnabled: true
  },
  embeds: {
    templates: [{
      id: 'ai-chat-welcome',
      enabled: true,
      embed: {
        title: 'Willkommen im AI Chat',
        description: 'Frag mich einfach etwas.',
        color: '#9b59b6',
        timestamp: false
      }
    }]
  }
};

const built = buildWelcomeEmbed(embedCfg, welcomeGuild);
assert.equal(built.embed.data.title, 'Willkommen im AI Chat');
assert.equal(built.embed.data.description, 'Frag mich einfach etwas.');
assert.equal(built.content, '');

const builtFallback = buildWelcomeEmbed({ aiChat: embedCfg.aiChat }, welcomeGuild);
assert.equal(builtFallback.embed.data.title, 'Willkommen im AI Chat');
assert.ok(String(builtFallback.embed.data.description || '').length > 20, 'Ohne Vorlage greift der Standard-Fallback.');

const created = await ensureWelcomeEmbed({ guild: welcomeGuild, cfg: embedCfg });
assert.equal(created.action, 'created');
assert.equal(created.messageId, 'embed-1');
assert.equal(sentEmbeds.length, 1);

const unchanged = await ensureWelcomeEmbed({ guild: welcomeGuild, cfg: embedCfg });
assert.equal(unchanged.action, 'unchanged');
assert.equal(sentEmbeds.length, 1, 'Bestehendes Embed darf nicht dupliziert werden.');
assert.equal(editedEmbeds.length, 0);

const updated = await ensureWelcomeEmbed({
  guild: welcomeGuild,
  cfg: {
    aiChat: embedCfg.aiChat,
    embeds: {
      templates: [{
        ...embedCfg.embeds.templates[0],
        embed: { ...embedCfg.embeds.templates[0].embed, description: 'Neuer Inhalt nach Dashboard-Änderung.' }
      }]
    }
  }
});
assert.equal(updated.action, 'updated');
assert.equal(editedEmbeds.length, 1);

// Nur-Farbe-Änderung muss ebenfalls als Update erkannt werden (vollständiger Design-Vergleich).
const colorOnlyChanged = await ensureWelcomeEmbed({
  guild: welcomeGuild,
  cfg: {
    aiChat: embedCfg.aiChat,
    embeds: {
      templates: [{
        ...embedCfg.embeds.templates[0],
        embed: { ...embedCfg.embeds.templates[0].embed, color: '#35d07f' }
      }]
    }
  }
});
assert.equal(colorOnlyChanged.action, 'updated');
assert.equal(editedEmbeds.length, 2, 'Eine reine Farb-Änderung muss das Embed im Kanal aktualisieren.');

const disabled = await ensureWelcomeEmbed({
  guild: welcomeGuild,
  cfg: { aiChat: { ...embedCfg.aiChat, welcomeEmbedEnabled: false } }
});
assert.equal(disabled.action, 'disabled');

assert.equal(await getWelcomeEmbedMessageId('guild-welcome', 'chan-welcome'), 'embed-1');
assert.equal(await getWelcomeEmbedMessageId('guild-other', 'chan-welcome'), '');

// Cleaner: gespeicherte Embed-ID wird aus dem Lösch-Lauf ausgenommen, wenn aktiviert.
const deletedIds = [];
const embedProtectedId = '500000000000000001';
const normalProtectedId = '500000000000000002';
const protectedChannel = {
  id: 'chan-protected',
  isTextBased: () => true,
  permissionsFor: () => ({ has: () => true }),
  messages: {
    fetch: async (options) => {
      const embedMsg = {
        id: embedProtectedId,
        pinned: false,
        deletable: true,
        createdTimestamp: oldTimestamp - 3_000,
        embeds: [{ title: 'Willkommen im AI Chat', description: '' }],
        edit: async () => {},
        delete: async () => { throw new Error('Info-Embed darf nicht gelöscht werden.'); }
      };
      const normalMsg = {
        id: normalProtectedId,
        pinned: false,
        deletable: true,
        createdTimestamp: oldTimestamp - 4_000,
        delete: async () => { deletedIds.push(normalProtectedId); }
      };
      if (typeof options === 'string') return options === embedProtectedId ? embedMsg : null;
      const page = new Collection([[embedMsg.id, embedMsg], [normalMsg.id, normalMsg]]);
      return options?.limit === 100 && options.before ? new Collection() : page;
    }
  },
  bulkDelete: async (ids) => {
    deletedIds.push(...ids);
    return new Collection();
  },
  send: async () => ({ id: embedProtectedId })
};
const protectedGuild = {
  id: 'guild-protected',
  name: 'Protected-Test',
  channels: {
    cache: new Collection([[protectedChannel.id, protectedChannel]]),
    fetch: async () => protectedChannel
  },
  members: { me: { id: 'bot' } }
};
const protectedCfg = {
  aiChat: {
    enabled: true,
    channelId: protectedChannel.id,
    autoCleanChannel: true,
    channelIdleMinutes: 15,
    keepPinnedMessages: true,
    welcomeEmbedEnabled: true
  }
};
const ensuredProtected = await ensureWelcomeEmbed({ guild: protectedGuild, cfg: protectedCfg });
assert.equal(ensuredProtected.action, 'created');
assert.equal(ensuredProtected.messageId, embedProtectedId);

const protectedResult = await cleanAiChannelIfIdle({ guild: protectedGuild, cfg: protectedCfg });
assert.equal(protectedResult.reason, 'cleaned');
assert.deepEqual(deletedIds, [normalProtectedId], 'Das Info-Embed darf beim Aufräumen nicht gelöscht werden.');
} finally {
  // State-Datei wiederherstellen, damit der Test keine Spuren hinterlässt – auch bei Fehlschlag.
  if (hadState) {
    await fs.writeFile(statePath, originalState, 'utf8');
  } else {
    await fs.rm(statePath, { force: true });
  }
}

console.log('AI-Chat-Cleaner-Smoke bestanden: Inaktivität, Rechte, angepinnte Nachrichten, Info-Embed-Schutz und getrenntes Memory sind abgesichert.');
