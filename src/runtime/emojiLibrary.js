import fs from 'node:fs/promises';
import path from 'node:path';
import { PermissionFlagsBits } from 'discord.js';
import { DATA_DIR } from '../shared/paths.js';
const emojiLibraryFile = path.join(DATA_DIR, 'emoji-library.json');
const emojiLibraryDir = path.join(DATA_DIR, 'emoji-library');

const CUSTOM_EMOJI_PATTERN = /<(a?):([a-zA-Z0-9_]{2,32}):(\d+)>/g;

const emojiLibraryMappings = new Map();
let emojiLibraryLoaded = false;
let emojiLibrarySaveChain = Promise.resolve();

export { CUSTOM_EMOJI_PATTERN };

export const ensureEmojiLibraryLoaded = async () => {
  if (emojiLibraryLoaded) return;
  try {
    const stored = JSON.parse(await fs.readFile(emojiLibraryFile, 'utf8'));
    for (const [key, value] of Object.entries(stored?.mappings || {})) if (value && typeof value === 'object') emojiLibraryMappings.set(key, value);
  } catch {
    await fs.mkdir(emojiLibraryDir, { recursive: true }).catch(() => {});
  }
  emojiLibraryLoaded = true;
};

export const persistEmojiLibrary = () => {
  const payload = JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), mappings: Object.fromEntries(emojiLibraryMappings) }, null, 2);
  emojiLibrarySaveChain = emojiLibrarySaveChain.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const temporary = `${emojiLibraryFile}.${process.pid}.tmp`;
    await fs.writeFile(temporary, payload, 'utf8');
    await fs.rm(emojiLibraryFile, { force: true }).catch(() => {});
    await fs.rename(temporary, emojiLibraryFile);
  }).catch((error) => console.warn(`[emoji-library] Bibliothek konnte nicht gespeichert werden: ${error?.message || error}`));
  return emojiLibrarySaveChain;
};

export const normalizeEmojiLibraryName = (name, sourceId) => {
  const normalized = String(name || '').replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 28);
  return `${normalized || 'fh_emoji'}_${String(sourceId).slice(-3)}`.slice(0, 32);
};

export const getEmojiLibraryMapping = (key) => emojiLibraryMappings.get(key);
export const setEmojiLibraryMapping = (key, value) => emojiLibraryMappings.set(key, value);

export const localizeChannelTopicEmojis = async (guild, topic) => {
  const sourceTopic = String(topic || '');
  const references = [...sourceTopic.matchAll(CUSTOM_EMOJI_PATTERN)];
  if (!references.length) return sourceTopic;
  await ensureEmojiLibraryLoaded();
  const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
  if (!botMember?.permissions.has(PermissionFlagsBits.ManageGuildExpressions)) {
    throw new Error('Dem Bot fehlt „Ausdrücke erstellen/verwalten", um fremde Emojis für dieses Kanalthema zu übernehmen.');
  }
  let localized = sourceTopic;
  for (const match of references) {
    const [raw, animatedFlag, originalName, sourceId] = match;
    if (guild.emojis.cache.has(sourceId)) continue;
    const mappingKey = `${guild.id}:${sourceId}`;
    const mapped = emojiLibraryMappings.get(mappingKey);
    let targetEmoji = mapped?.targetId ? guild.emojis.cache.get(String(mapped.targetId)) : null;
    if (!targetEmoji) {
      const animated = animatedFlag === 'a';
      const extension = animated ? 'gif' : 'png';
      const libraryPath = path.join(emojiLibraryDir, `${sourceId}.${extension}`);
      let attachment;
      try {
        attachment = await fs.readFile(libraryPath);
      } catch {
        const response = await fetch(`https://cdn.discordapp.com/emojis/${sourceId}.${extension}?size=128&quality=lossless`);
        if (!response.ok) throw new Error(`Emoji „${originalName}" konnte nicht von Discord geladen werden (${response.status}).`);
        attachment = Buffer.from(await response.arrayBuffer());
        await fs.mkdir(emojiLibraryDir, { recursive: true });
        await fs.writeFile(libraryPath, attachment);
      }
      targetEmoji = await guild.emojis.create({ attachment, name: normalizeEmojiLibraryName(originalName, sourceId), reason: 'Kanalthema-Emoji für FALLEN HEAVEN lokalisiert' });
      emojiLibraryMappings.set(mappingKey, { sourceId, targetId: targetEmoji.id, name: targetEmoji.name, animated: Boolean(targetEmoji.animated), updatedAt: new Date().toISOString() });
      await persistEmojiLibrary();
    }
    localized = localized.split(raw).join(`<${targetEmoji.animated ? 'a' : ''}:${targetEmoji.name}:${targetEmoji.id}>`);
  }
  return localized;
};
