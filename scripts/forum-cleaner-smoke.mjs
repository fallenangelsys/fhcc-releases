import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ChannelType } from 'discord.js';
import { featureCards, normalizeConfig } from '../src/defaultConfig.js';
import { _forumCleanerInternals } from '../src/features/forumCleaner.js';

const problems = [];
const assert = (condition, message) => { if (!condition) problems.push(message); };
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { messageHasMeaning, realReplyCount, normalizeForumCleanerConfig, isSelectedForumThread, classifyMemberPresence, collectForumThreads } = _forumCleanerInternals;

const normalized = normalizeConfig({
  guildId: 'guild',
  guildName: 'FALLEN HEAVEN',
  forumCleaner: {
    enabled: true,
    channelIds: 'forum-a\nforum-a\nforum-b',
    graceMinutes: -5,
    scanIntervalMinutes: 99999,
    ignorePinned: false,
    titleOnlyIsEmpty: false,
    dryRun: true,
    logChannelId: 'log'
  }
});

assert(normalized.forumCleaner.enabled === true, 'Forum-Cleaner wird nicht aktiviert normalisiert.');
assert(normalized.forumCleaner.channelIds.length === 2, 'Forum-Cleaner entfernt doppelte Kanäle nicht.');
assert(normalized.forumCleaner.graceMinutes === 1, 'Schonfrist wird nicht nach unten begrenzt.');
assert(normalized.forumCleaner.scanIntervalMinutes === 1440, 'Intervall wird nicht nach oben begrenzt.');
assert(normalized.forumCleaner.includeArchived === true, 'Das vollständige Archiv muss standardmäßig einbezogen werden.');
assert(normalized.forumCleaner.ignorePinned === false, 'Pinned-Schutz kann nicht bewusst deaktiviert werden.');
assert(normalized.forumCleaner.titleOnlyIsEmpty === false, 'Titel-als-Inhalt-Schalter wird nicht normalisiert.');

const runtimeConf = normalizeForumCleanerConfig({
  enabled: true,
  channelIds: ['forum-a'],
  graceMinutes: 10
});
const forumThread = {
  type: ChannelType.PublicThread,
  parentId: 'forum-a',
  guild: { id: 'guild' },
  parent: { type: ChannelType.GuildForum },
  isThread: () => true
};
const normalThread = {
  type: ChannelType.PublicThread,
  parentId: 'text-a',
  guild: { id: 'guild' },
  parent: { type: ChannelType.GuildText },
  isThread: () => true
};
assert(isSelectedForumThread(forumThread, runtimeConf) === true, 'Ausgewählter Forum-Thread wird nicht erkannt.');
assert(isSelectedForumThread(normalThread, runtimeConf) === false, 'Normaler Text-Thread darf nicht als Forum-Post gelten.');
assert(messageHasMeaning({ content: '   ', attachments: { size: 0 }, embeds: [], stickers: { size: 0 }, components: [] }) === false, 'Whitespace darf nicht als Inhalt gelten.');
assert(messageHasMeaning({ content: 'Text' }) === true, 'Text wird nicht als Inhalt erkannt.');
assert(messageHasMeaning({ attachments: { size: 1 }, embeds: [], stickers: { size: 0 }, components: [] }) === true, 'Anhänge schützen den Post nicht.');
assert(messageHasMeaning({ embeds: [{}], attachments: { size: 0 }, stickers: { size: 0 }, components: [] }) === true, 'Embeds schützen den Post nicht.');

const fakeMessages = new Map([
  ['starter', { id: 'starter', content: '' }],
  ['system', { id: 'system', content: 'Thread erstellt', system: true }],
  ['reply', { id: 'reply', content: 'Antwort' }]
]);
assert(realReplyCount(fakeMessages, 'starter') === 1, 'Echte Antworten werden nicht sauber gezählt.');

const card = featureCards.find((entry) => entry.id === 'forumCleaner');
assert(card, 'Forum-Cleaner fehlt in der Modulkarte.');
const channelsField = card?.fields?.find((field) => field.key === 'forumCleaner.channelIds');
assert(channelsField?.type === 'multiChannelSelect', 'Forum-Cleaner braucht Mehrfach-Kanalauswahl.');
assert(JSON.stringify(channelsField?.channelTypes || []) === JSON.stringify([15, 16]), 'Forum-Cleaner muss auf Forum/Media-Kanäle gefiltert sein.');
assert(card.detail.includes('sämtliche archivierten') && channelsField?.label === 'Forum- und Media-Kanäle', 'Forum-Cleaner-Texte müssen korrekte Umlaute nutzen.');
assert(!card.fields.some((field) => field.key === 'forumCleaner.scanLimitPerChannel'), 'Der Tiefenscan darf kein künstliches Post-Limit mehr anzeigen.');

const presentGuild = {
  members: {
    cache: new Map(),
    fetch: async () => ({ id: 'member' })
  }
};
const departedGuild = {
  members: {
    cache: new Map(),
    fetch: async () => { const error = new Error('Unknown Member'); error.code = 10007; throw error; }
  }
};
const uncertainGuild = {
  members: {
    cache: new Map(),
    fetch: async () => { const error = new Error('Gateway timeout'); error.code = 504; throw error; }
  }
};
assert((await classifyMemberPresence(presentGuild, 'member')).state === 'present', 'Discord-Mitglied wird nicht als vorhanden erkannt.');
assert((await classifyMemberPresence(departedGuild, 'member')).state === 'departed', 'Nur Discord Unknown Member muss als verlassen gelten.');
assert((await classifyMemberPresence(uncertainGuild, 'member')).state === 'unknown', 'Timeout darf niemals als Server-Austritt gelten.');

const archivedRows = Array.from({ length: 230 }, (_, index) => ({
  id: 'thread-' + index,
  parentId: 'forum-a',
  archiveTimestamp: Date.now() - index * 1000,
  archivedAt: new Date(Date.now() - index * 1000)
}));
let archivedOffset = 0;
const paginationParent = {
  id: 'forum-a',
  threads: {
    cache: new Map(),
    fetchActive: async () => ({ threads: new Map() }),
    fetchArchived: async ({ limit }) => {
      const rows = archivedRows.slice(archivedOffset, archivedOffset + limit);
      archivedOffset += rows.length;
      return { threads: new Map(rows.map((row) => [row.id, row])), hasMore: archivedOffset < archivedRows.length };
    }
  }
};
const allArchived = await collectForumThreads(paginationParent, { includeArchived: true });
assert(allArchived.length === 230, 'Der Tiefenscan lädt nicht alle Archivseiten vollständig.');

const rendererSource = fs.readFileSync(path.join(rootDir, 'desktop', 'renderer', 'app.js'), 'utf8');
const managementSource = fs.readFileSync(path.join(rootDir, 'desktop', 'renderer', 'server-management.js'), 'utf8');
const botSource = fs.readFileSync(path.join(rootDir, 'src', 'index.js'), 'utf8');
assert(rendererSource.includes('channelsForField'), 'Modul-Ressourcen müssen feldspezifisch gefiltert werden.');
assert(botSource.includes('isForumLikeChannel') && botSource.includes('listForumChannelPosts'), 'Backend muss Forum-/Media-Kanäle als auswählbare Post-Quelle behandeln.');
assert(managementSource.includes('isForumLike') && managementSource.includes('canOpen') && managementSource.includes('Posts statt Textverlauf'), 'Serververwaltung muss Forum-/Media-Kanäle öffnen und verständlich erklären.');

if (problems.length) {
  console.error(`Forum-Cleaner-Smoke fehlgeschlagen (${problems.length}):`);
  problems.forEach((problem) => console.error(`- ${problem}`));
  process.exit(1);
}

console.log('Forum-Cleaner-Smoke: Config, Schema und Leerer-Post-Erkennung bestanden.');
