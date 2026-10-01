import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';

const settings = (cfg) => cfg?.instantBanWords || {};

// ── Dedup-Speicher: Verhindert parallele Ban-Aufrufe für denselben User ──
const pendingBans = new Map();     // userId -> timestamp
const completedBans = new Map();   // userId -> timestamp
const BAN_DEDUP_MS = 60_000;       // 60 Sekunden nach Ban kein erneuter Versuch

// ── Standalone helpers ──

function flattenWords(words) {
  if (!Array.isArray(words) || !words.length) return [];
  const result = [];
  for (const entry of words) {
    if (entry && typeof entry === 'object') { result.push(entry); continue; }
    const str = String(entry || '').trim();
    if (!str) continue;
    const parts = str.split(/[,;]+|\r?\n|\r/);
    for (const p of parts) {
      const trimmed = p.trim();
      if (trimmed) result.push(trimmed);
    }
  }
  return result;
}

function findMatch(text, cfg) {
  const s = settings(cfg);
  if (!s.enabled) return '';
  const rawWords = Array.isArray(s.words) ? s.words : [];
  const words = flattenWords(rawWords);
  if (!words.length) return '';

  const caseInsensitive = s.caseInsensitive !== false;
  const normalized = caseInsensitive
    ? String(text || '').toLocaleLowerCase('de')
    : String(text || '');

  for (const raw of words) {
    const w = String(raw || '').trim();
    if (!w) continue;
    const search = caseInsensitive ? w.toLocaleLowerCase('de') : w;
    if (normalized.includes(search)) {
      return w;
    }
  }
  return '';
}

/**
 * Ban mit dedup + hard timeout (10s).
 * Gibt true zurück wenn Ban erfolgreich (oder bereits vorhanden).
 */
async function executeBan({ guild, userId, matchedWord, originalContent, cfg, source }) {
  const s = settings(cfg);
  if (!s.enabled) return false;

  // ── Dedup: Bereits pending oder kürzlich gebannt? ──
  const now = Date.now();
  const pending = pendingBans.get(userId);
  const completed = completedBans.get(userId);

  if (pending && (now - pending) < BAN_DEDUP_MS) return false;
  if (completed && (now - completed) < BAN_DEDUP_MS) return false;

  // ── Pending markieren ──
  pendingBans.set(userId, now);

  try {
    const member = guild.members.cache.get(userId)
      || await guild.members.fetch(userId).catch(() => null);
    if (!member) {
      console.warn(`[instantBanWords] User ${userId} nicht gefunden`);
      return false;
    }

    // Eigentümer/Staff nicht bannen
    const general = cfg?.general || {};
    const ownerIds = new Set((general.ownerUserIds || []).map(String));
    const staffIds = new Set((general.staffRoleIds || []).map(String));
    if (ownerIds.has(member.id)) return false;
    if (member.roles?.cache?.some((r) => staffIds.has(r.id))) return false;

    // Bot hat Ban-Rechte?
    const botMember = guild.members.me;
    if (!botMember?.permissions?.has(PermissionFlagsBits.BanMembers)) return false;
    if (!member.bannable) return false;

    const serverName = guild.name || 'Server';
    const reason = String(s.banReason || 'Verbotener Begriff verwendet: {word}')
      .replaceAll('{user}', member.user.tag || member.user.username || member.id)
      .replaceAll('{word}', matchedWord)
      .replaceAll('{server}', serverName)
      .slice(0, 500);

    // ── Ban mit 10-Sekunden-Timeout ──
    const banPromise = member.ban({
      reason,
      deleteMessageSeconds: 7 * 24 * 60 * 60
    });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Ban-Timeout 10s')), 10_000)
    );

    await Promise.race([banPromise, timeoutPromise]);

    completedBans.set(userId, Date.now());

    // ── Log-Embed asynchron (blockiert nicht) ──
    const logChannelId = String(s.logChannelId || '').trim();
    if (logChannelId) {
      const content = String(originalContent || '');
      const logEmbed = s.logEmbed;
      const logChannel = guild.channels.cache.get(logChannelId);

      if (logChannel?.isTextBased()) {
        const embed = new EmbedBuilder();
        if (logEmbed && typeof logEmbed === 'object' && logEmbed.title) {
          if (logEmbed.title) embed.setTitle(String(logEmbed.title).slice(0, 256));
          let desc = String(logEmbed.description || '');
          desc = desc.replaceAll('{user}', `<@${member.id}>`)
            .replaceAll('{word}', matchedWord)
            .replaceAll('{server}', serverName)
            .replaceAll('{reason}', reason);
          embed.setDescription(desc.slice(0, 4096));
          if (logEmbed.color) {
            const c = String(logEmbed.color).replace('#', '');
            const n = Number.parseInt(c, 16);
            if (Number.isFinite(n)) embed.setColor(n);
          }
          if (logEmbed.thumbnail) embed.setThumbnail(String(logEmbed.thumbnail).slice(0, 2000));
          if (logEmbed.footer) embed.setFooter({ text: String(logEmbed.footer).slice(0, 2048) });
          if (logEmbed.author) embed.setAuthor({ name: String(logEmbed.author).slice(0, 256) });
        } else {
          embed.setColor(0xff4444)
            .setTitle('Instant Bann')
            .setDescription(
              `<@${member.id}> (${member.user.tag || member.id}) wurde sofort gebannt.\n` +
              `**Grund:** Verbotener Begriff \`${matchedWord}\`\n` +
              `**Nachricht:** ${content.slice(0, 200)}`
            );
        }
        // Fire-and-forget
        logChannel.send({ embeds: [embed] }).catch(() => {});
      }
    }

    return true;
  } catch (error) {
    console.warn(`[instantBanWords] Bann fehlgeschlagen für ${userId}:`, error?.message || error);
    return false;
  } finally {
    // Pending nach 5s entfernen (nicht sofort, damit Dedup greift)
    setTimeout(() => pendingBans.delete(userId), 5_000);
  }
}

async function handleAutoModLogMessage({ message, cfg, s }) {
  try {
    const embed = message.embeds?.[0];
    if (!embed) return;

    let targetUserId = '';
    let matchedWord = '';

    // === User-ID extrahieren (6 Wege) ===
    const desc = String(embed.description || '');

    // Weg 1: Mention in Description
    const mentionMatch = desc.match(/<@!?(\d+)>/);
    if (mentionMatch) targetUserId = mentionMatch[1];

    // Weg 2: Mention im Title
    if (!targetUserId) {
      const titleMatch = String(embed.title || '').match(/<@!?(\d+)>/);
      if (titleMatch) targetUserId = titleMatch[1];
    }

    // Weg 3: Avatar-URL im Author
    if (!targetUserId && embed.author?.icon_url) {
      const iconMatch = String(embed.author.icon_url).match(/\/avatars\/(\d+)\//);
      if (iconMatch) targetUserId = iconMatch[1];
    }

    // Weg 4: Avatar-URL in Fields
    if (!targetUserId) {
      const allText = desc + ' ' + (embed.fields || []).map(f => f.value).join(' ');
      const avatarMatch = allText.match(/\/avatars\/(\d+)\//);
      if (avatarMatch) targetUserId = avatarMatch[1];
    }

    // Weg 5: message.mentions
    if (!targetUserId && message.mentions?.users?.size) {
      targetUserId = message.mentions.users.first().id;
    }

    // Weg 6: Guild-Membersuche nach Name
    if (!targetUserId && message.guild) {
      const possibleName = desc.replace(/<@!?>?\d+>?/g, '').trim().split('\n')[0]?.trim();
      if (possibleName && possibleName.length >= 2 && possibleName.length <= 32) {
        const members = await message.guild.members.fetch({ query: possibleName, limit: 1 }).catch(() => null);
        if (members?.size) targetUserId = members.first().id;
      }
    }

    // === Keyword extrahieren ===
    const fields = embed.fields || [];
    for (const field of fields) {
      const name = String(field.name || '').toLowerCase();
      if (name.includes('stichwort') || name.includes('keyword')) {
        matchedWord = String(field.value || '').trim();
        break;
      }
    }
    if (!matchedWord) {
      const kwMatch = desc.match(/Stichwort[:\s]+([^\n·\u00B7]+)/i);
      if (kwMatch) matchedWord = kwMatch[1].trim();
    }

    if (!targetUserId || !matchedWord) return;

    const banWord = findMatch(matchedWord, cfg);
    if (!banWord) return;

    await executeBan({
      guild: message.guild,
      userId: targetUserId,
      matchedWord: banWord,
      originalContent: desc,
      cfg,
      source: 'autoModLog'
    });
  } catch (error) {
    console.warn('[instantBanWords] AutoMod-Log fehlgeschlagen:', error?.message);
  }
}

/**
 * Instant Wort-Ban
 *
 * Drei Auslöser:
 * 1. onMessageCreate – normale Nachrichten mit verbotenem Inhalt
 * 2. onAutoModerationActionExecution – Discord Gateway-Event
 * 3. onBotMessageCreate – AutoMod-Log-Nachrichten parsen
 *
 * Deduplizierung verhindert parallele Ban-Versuche für denselben User.
 * Ban-Timeout 10 Sekunden.
 */
export const feature = {
  id: 'instantBanWords',
  name: 'Instant Wort-Ban',
  commands: [],

  async onMessageCreate({ message, cfg }) {
    const s = settings(cfg);
    if (!s.enabled || !message?.guild || !message?.author || message.author.bot) return;

    const matchedWord = findMatch(message.content, cfg);
    if (!matchedWord) return;

    await executeBan({
      guild: message.guild,
      userId: message.author.id,
      matchedWord,
      originalContent: message.content,
      cfg,
      source: 'messageCreate'
    });
  },

  async onBotMessageCreate({ message, cfg }) {
    const s = settings(cfg);
    if (!s.enabled || !message?.guild) return;

    const autoModLogId = String(s.autoModLogChannelId || '').trim();
    if (!autoModLogId || String(message.channelId) !== autoModLogId) return;
    if (!message.embeds?.length) return;

    await handleAutoModLogMessage({ message, cfg, s });
  },

  async onAutoModerationActionExecution({ execution, cfg }) {
    const s = settings(cfg);
    if (!s.enabled || !execution?.guild || !execution.userId) return;

    const fullContent = String(execution?.content || '');
    const keyword = String(execution?.matchedKeyword || '');
    const matchedSub = String(execution?.matchedContent || '');
    const userId = execution.userId;
    const actionType = execution?.action?.type ?? 'UNKNOWN';

    // Dedup prüfen VOR dem Matching
    const now = Date.now();
    if (completedBans.has(userId) && (now - completedBans.get(userId)) < BAN_DEDUP_MS) return;
    if (pendingBans.has(userId) && (now - pendingBans.get(userId)) < BAN_DEDUP_MS) return;

    let matchedWord = findMatch(keyword, cfg);
    if (!matchedWord) matchedWord = findMatch(fullContent, cfg);
    if (!matchedWord) matchedWord = findMatch(matchedSub, cfg);

    if (!matchedWord) return;

    await executeBan({
      guild: execution.guild,
      userId,
      matchedWord,
      originalContent: fullContent || matchedSub || keyword,
      cfg,
      source: 'autoModEvent'
    });
  }
};
