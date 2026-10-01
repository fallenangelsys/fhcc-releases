// =============================================================================
// Inaktivitäts-Erinnerung (inactiveReminder)
// -----------------------------------------------------------------------------
// Hält den Server sauber, ohne Mitglieder stillschweigend zu verlieren:
//   - Mitglieder, die länger als thresholdDays (Standard 180 = ein halbes Jahr)
//     weder eine Nachricht gesendet noch in einem Sprachkanal waren, erhalten
//     ein professionelles DM-Embed mit zwei Buttons:
//       ✅ „Ja, zum Server"     → öffnet die Server-Einladung (Link-Button)
//       ❌ „Nein, bitte entfernen" → wird freundlich vom Server gekickt
//   - KEIN Auto-Kick: Wer nicht antwortet, bleibt einfach auf dem Server und
//     bekommt keine weitere Nachricht. Nur wer selbst „Nein, bitte entfernen“
//     wählt, wird freundlich entfernt.
//   - Alles wird in einer SQLite-Datenbank gespeichert (wer, wann, Status),
//     übersteht Neustarts und Offline-Phasen.
//   - Das DM-Embed ist im Embed Studio editierbar (Platzhalter {user},
//     {username}, {guild}, {thresholdDays}).
//
// Inaktivitäts-Quellen (dieselben Daten wie „Serververwaltung → Mitglieder"):
//   - getMemberActivitySnapshot: max(Nachricht, Voice) je Mitglied (live +
//     365-Tage-Backfill aus dem Server-Index)
//   - Der Server-Index (SQLite) als Tiefen-Fallback für ältere Nachrichten.
//   - Zusätzlich: erst Beitritt selbst muss älter als die Schwelle sein, damit
//     neue Mitglieder nie angeschrieben/gekickt werden.
// =============================================================================
import path from 'node:path';
import process from 'node:process';

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from 'discord.js';
import Database from 'better-sqlite3';

import { getMemberActivitySnapshot, getMemberActivityDetail } from './memberManagement.js';
import { runVoiceLogBackfill } from './voiceLogImport.js';
import { getLastVoiceAtMap, setUserLastVoiceAt } from '../runtime/voiceLogStateStore.js';
import { materializeOutsideImageTemplate, resolveOutsideImageLite } from '../runtime/localImageStore.js';
import { resolveOutsideImageFile } from '../runtime/persistentEmbedService.js';
import { quietLog, QUIET_LOG_SCOPE } from '../runtime/quietLog.js';
import {
  upsertInactiveReminder,
  getInactiveReminder,
  listInactiveReminders,
  listDueInactiveReminders,
  listPendingInactiveReminders,
  updateInactiveReminderStatus,
  markInactiveReminderDmDeleted,
  countInactiveReminderStats,
  countInactiveReminders
} from '../runtime/inactiveReminderStore.js';

const PREFIX = 'fh-inactive:';
const SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000; // einmal am Tag

// Standard-Server-Einladung für den „Ja, zum Server“-Button. Kann pro Server
// über inactiveReminder.inviteUrl überschrieben werden.
const DEFAULT_INVITE_URL = 'https://discord.gg/fallen-heaven';

// -----------------------------------------------------------------------------
// Datenzugriff: Server-Index (tiefe Nachrichten-Historie)
// -----------------------------------------------------------------------------
const INDEX_DATABASE_FILE = (() => {
  const root = process.env.FALLEN_HEAVEN_DATA_DIR
    || (process.platform === 'win32' && process.env.APPDATA
      ? path.join(process.env.APPDATA, 'FALLEN HEAVEN Control Center', 'runtime', 'data')
      : path.join(process.cwd(), 'data'));
  return path.join(root, 'server-index', 'fallen-heaven-index.sqlite3');
})();

let indexDb = null;
const openIndexDatabase = () => {
  if (indexDb) return indexDb;
  try {
    indexDb = new Database(INDEX_DATABASE_FILE, { timeout: 15_000, readonly: true });
    indexDb.pragma('busy_timeout = 15000');
  } catch {
    indexDb = null;
  }
  return indexDb;
};

// Autoren mit Nachricht seit cutoff (nicht inaktiv). Eine einzige Query pro Scan.
const getIndexActivitySource = (guildId, cutoffIso) => {
  const db = openIndexDatabase();
  if (!db) {
    if (process.env.FALLEN_HEAVEN_SMOKE_TEST === '1') {
      return { available: true, activeAuthorIds: new Set(), error: '', synthetic: true };
    }
    return { available: false, activeAuthorIds: new Set(), error: 'Nachrichtenindex ist nicht erreichbar.' };
  }
  try {
    const rows = db.prepare(`
      SELECT DISTINCT author_id FROM messages
       WHERE guild_id = ? AND is_system = 0 AND author_bot = 0
         AND author_id <> '' AND created_at >= ?
    `).all(String(guildId), String(cutoffIso));
    return { available: true, activeAuthorIds: new Set(rows.map((row) => String(row.author_id))), error: '' };
  } catch (error) {
    return { available: false, activeAuthorIds: new Set(), error: String(error?.message || error) };
  }
};

const getIndexActiveAuthorIds = (guildId, cutoffIso) => getIndexActivitySource(guildId, cutoffIso).activeAuthorIds;

// -----------------------------------------------------------------------------
// Konfiguration & Design
// -----------------------------------------------------------------------------
const clamp = (value, min, max, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

// Sicherheitsnetz: Das Erinnerungs-Embed darf NIE leer sein. Die Normalisierung
// füllt das Standard-Design bereits in die Config – falls ein Aufrufer dennoch
// eine Config ohne dmDesign durchreicht, greift dieser eingebaute Fallback.
const FALLBACK_REMINDER_DESIGN = {
  content: '',
  outsideImageUrl: '',
  outsideImageAttachment: null,
  embed: {
    title: '🏠 {guild} · Wir vermissen dich!',
    description: '**{user}**, deine letzte Aktivität auf **{guild}** liegt mehr als **{thresholdDays} Tage** zurück.\n\n📩 Letzte Nachricht: **{lastMessageAt}**\n🎙️ Letzter Sprachchat: **{lastVoiceAt}**\n\nMöchtest du weiterhin auf dem Server bleiben?\n\n✅ **Ja, zum Server** – wir freuen uns, wenn du zurückkommst!\n❌ **Nein, bitte entfernen** – wir verabschieden dich freundlich vom Server.',
    color: '#9a8cff',
    authorName: '{server}',
    footerText: 'FALLEN HEAVEN',
    timestamp: true
  }
};

// Editierbare Textbausteine der Inaktivitäts-Erinnerung (3.9.222-Prinzip):
// DM-Buttons, Entscheidungs-Embeds und Antwort-Texte sind Vorlagen mit
// Platzhaltern – der Server kann sie im Modul anpassen.
const DEFAULT_REMINDER_TEXTS = () => ({
  joinButtonLabel: 'Ja, zum Server',
  leaveButtonLabel: 'Nein, bitte entfernen',
  joinInviteButtonLabel: '🔗 Zum Server beitreten',
  stayConfirmTitle: '✅ Du bleibst bei uns!',
  stayConfirmDescription: 'Danke! Du bist als aktiv markiert, bleibst auf dem Server und wirst von dieser Inaktivitäts-Erinnerung nicht erneut angeschrieben.',
  leaveConfirmTitle: '❌ Du verlässt den Server',
  leaveConfirmDescription: 'Du wirst freundlich vom Server entfernt. Falls du zurückkehren willst, bist du jederzeit willkommen. 👋',
  joinReplyText: '✅ Danke! Du bist als **aktiv** markiert und wirst nicht erneut angeschrieben. Hier ist deine Einladung – ein Klick und du bist zurück auf **{guild}**:',
  stayReplyText: '✅ Danke! Du bleibst auf dem Server und wirst von dieser Inaktivitäts-Erinnerung nicht erneut angeschrieben.',
  leaveReplyText: 'Verstanden. Vielen Dank für deine Ehrlichkeit – du wirst gleich vom Server entfernt. Falls du zurückkehren willst, bist du jederzeit willkommen. 👋'
});
const reminderTexts = (cfg = {}) => {
  const defaults = DEFAULT_REMINDER_TEXTS();
  const section = cfg.inactiveReminder || {};
  return Object.fromEntries(Object.keys(defaults).map((key) => [key, String(section[key] ?? defaults[key]).slice(0, 2000)]));
};
const formatReminderText = (value, context = {}) => String(value || '')
  .replaceAll('{user}', context.user || '')
  .replaceAll('{username}', context.username || '')
  .replaceAll('{guild}', context.guild || 'Server')
  .replaceAll('{server}', context.server || context.guild || 'Server')
  .replaceAll('{thresholdDays}', String(context.thresholdDays ?? 180))
  .replaceAll('{days}', String(context.thresholdDays ?? 180));

export const settings = (cfg = {}) => ({
  enabled: cfg.inactiveReminder?.enabled === true,
  deliveryMode: 'automatic-qualified',
  thresholdDays: clamp(cfg.inactiveReminder?.thresholdDays, 7, 3650, 180),
  excludedRoleIds: Array.isArray(cfg.inactiveReminder?.excludedRoleIds) ? cfg.inactiveReminder.excludedRoleIds : [],
  inviteUrl: String(cfg.inactiveReminder?.inviteUrl || DEFAULT_INVITE_URL).trim() || DEFAULT_INVITE_URL,
  dmDesign: cfg.inactiveReminder?.dmDesign && typeof cfg.inactiveReminder.dmDesign === 'object'
    ? cfg.inactiveReminder.dmDesign
    : FALLBACK_REMINDER_DESIGN,
  texts: reminderTexts(cfg)
});

const parseHexColor = (value, fallback = '#9a8cff') => {
  const parsed = Number.parseInt(String(value || fallback).replace('#', ''), 16);
  return Number.isFinite(parsed) ? parsed : Number.parseInt(fallback.replace('#', ''), 16);
};

const normalizeReminderDesign = (embed = {}) => ({
  title: String(embed.title || ''),
  url: String(embed.url || ''),
  description: String(embed.description || ''),
  color: String(embed.color || '#9a8cff'),
  authorName: String(embed.authorName || ''),
  authorIconUrl: String(embed.authorIconUrl || ''),
  thumbnailUrl: String(embed.thumbnailUrl || ''),
  imageUrl: String(embed.imageUrl || ''),
  footerText: String(embed.footerText || ''),
  footerIconUrl: String(embed.footerIconUrl || ''),
  timestamp: embed.timestamp === true,
  fields: (Array.isArray(embed.fields) ? embed.fields : []).slice(0, 25)
});

export const saveInactiveReminderDesign = async ({ guild, conf = {}, template = {} } = {}) => {
  if (!guild) throw new Error('Server wurde nicht gefunden.');
  // Lokal gespeichertes Außenbild („Bild vom PC auswählen“) exakt wie bei allen
  // anderen Modulen behandeln: Der bestehende materialize-Helfer wandelt die
  // lokale Referenz in eine anzeigbare Bild-URL (Data-URL) um – so ist das Bild
  // nach erneutem Öffnen des Studios sichtbar und geht beim Speichern nie verloren.
  let sourceTemplate = template && typeof template === 'object' ? template : {};
  if (sourceTemplate?.outsideImageAttachment?.localAsset === true) {
    sourceTemplate = await materializeOutsideImageTemplate(sourceTemplate);
  }
  const sources = Array.isArray(sourceTemplate?.embeds) && sourceTemplate.embeds.length ? sourceTemplate.embeds : [sourceTemplate?.embed || sourceTemplate];
  const embed = sources.find((entry) => entry && typeof entry === 'object') || {};
  const normalized = settings(conf);
  const outsideImageUrl = String(sourceTemplate?.outsideImageUrl || '').trim();
  const design = {
    content: String(sourceTemplate?.content || '').slice(0, 2000),
    // Außenbild exakt nach dem Aktivitäts-Liga-/Counting-/Levels-Muster:
    // anzeigbare URL (http ODER Data-URL) bleibt erhalten, bestätigte Discord-
    // Anhänge werden per ID referenziert.
    outsideImageUrl: /^https?:\/\/[^\s]+$/i.test(outsideImageUrl) || /^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(outsideImageUrl)
      ? outsideImageUrl
      : '',
    outsideImageAttachment: sourceTemplate?.outsideImageAttachment && typeof sourceTemplate.outsideImageAttachment === 'object'
      ? {
        id: String(sourceTemplate.outsideImageAttachment.id || ''),
        url: String(sourceTemplate.outsideImageAttachment.url || ''),
        name: String(sourceTemplate.outsideImageAttachment.name || 'fallen-heaven-reminder.png'),
        size: Math.max(0, Number(sourceTemplate.outsideImageAttachment.size || 0)),
        ...(sourceTemplate.outsideImageAttachment.anchored === true
          ? { anchored: true, channelId: String(sourceTemplate.outsideImageAttachment.channelId || ''), messageId: String(sourceTemplate.outsideImageAttachment.messageId || '') }
          : {}),
        ...(sourceTemplate.outsideImageAttachment.localAsset === true ? { localAsset: true, mime: String(sourceTemplate.outsideImageAttachment.mime || '') } : {})
      }
      : null,
    embed: normalizeReminderDesign(embed)
  };
  return {
    design,
    normalizedDesign: design,
    section: 'dm'
  };
};

// -----------------------------------------------------------------------------
// Platzhalter füllen
// -----------------------------------------------------------------------------
// Deutsche Datums-Anzeige für den Aktivitäts-Beweis im DM (z. B.
// „12.03.2026 um 14:30 Uhr“). „unbekannt“ für Werte ohne Aufzeichnung.
const formatActivityDate = (value) => {
  const ms = value instanceof Date ? value.getTime() : Number(value || 0);
  if (!Number.isFinite(ms) || ms <= 0) return 'unbekannt';
  const date = new Date(ms);
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' um ' + date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr';
};

// Letzte Nachricht je Autor direkt aus dem Server-Index – EINE Query für alle
// Kandidaten (kein N-Queries-Problem). Nur echte Nutzernachrichten
// (is_system=0, kein Bot). Rückgabe: { [userId]: lastMessageMs }.
const getLastMessageMap = (guildId, userIds) => {
  const ids = (Array.isArray(userIds) ? userIds : []).map((id) => String(id)).filter(Boolean);
  const map = {};
  if (!ids.length) return map;
  const db = openIndexDatabase();
  if (!db) return map;
  try {
    // In Chunks, damit die SQLite-Variablen-Grenze nie überschritten wird.
    const CHUNK = 400;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = db.prepare(`
        SELECT author_id, MAX(created_at) AS last_at FROM messages
         WHERE guild_id = ? AND is_system = 0 AND author_bot = 0
           AND author_id IN (${placeholders})
         GROUP BY author_id
      `).all(String(guildId), ...chunk);
      for (const row of rows) {
        const ms = row.last_at ? Date.parse(String(row.last_at)) : 0;
        if (Number.isFinite(ms) && ms > 0) map[String(row.author_id)] = ms;
      }
    }
  } catch {
    // Index nicht verfügbar – Beweis fällt auf „unbekannt“ zurück.
  }
  return map;
};

// Baut den Aktivitäts-Beweis eines Kandidaten zusammen: letzte Nachricht
// (Index) und letzte Voice (index-abgeleitete Carl-bot-Tabelle, persistent)
// als Millisekunden. Die Voice-Quelle ist damit der Server-Index – nicht der
// Live-Zustand „aktuell im Call“. Fallback: Member-Management-Speicher.
const buildActivityProof = ({ activityDetail, lastMessageMap, lastVoiceMap, userId }) => {
  const id = String(userId || '');
  const lastMessageMs = Number(lastMessageMap?.[id] || 0) || 0;
  let lastVoiceMs = Number(lastVoiceMap?.[id] || 0) || 0;
  if (!lastVoiceMs) {
    const lastVoiceAt = activityDetail?.[id]?.lastVoiceAt;
    lastVoiceMs = lastVoiceAt ? Date.parse(String(lastVoiceAt)) : 0;
  }
  const lastActiveMs = Math.max(
    Number.isFinite(lastMessageMs) ? lastMessageMs : 0,
    Number.isFinite(lastVoiceMs) ? lastVoiceMs : 0
  );
  return {
    lastMessageMs: Number.isFinite(lastMessageMs) ? lastMessageMs : 0,
    lastVoiceMs: Number.isFinite(lastVoiceMs) ? lastVoiceMs : 0,
    lastActiveMs
  };
};

const fillPlaceholders = (text, { guild, member, conf, activity }) => {
  const name = member?.displayName || member?.user?.username || member?.user?.tag || 'Mitglied';
  const proof = activity || {};
  return String(text || '')
    .replaceAll('{user}', member?.user ? `<@${member.id}>` : '@Mitglied')
    .replaceAll('{username}', String(member?.user?.username || name))
    .replaceAll('{displayName}', String(name))
    .replaceAll('{guild}', String(guild?.name || 'dem Server'))
    .replaceAll('{server}', String(guild?.name || 'dem Server'))
    .replaceAll('{thresholdDays}', String(conf.thresholdDays))
    .replaceAll('{lastMessageAt}', formatActivityDate(proof.lastMessageMs))
    .replaceAll('{lastVoiceAt}', formatActivityDate(proof.lastVoiceMs))
    .replaceAll('{lastActiveAt}', formatActivityDate(proof.lastActiveMs));
};

const buildReminderEmbed = ({ guild, member, conf, activity }) => {
  const design = conf.dmDesign?.embed || {};
  const embed = new EmbedBuilder()
    .setColor(parseHexColor(design.color))
    .setTitle(fillPlaceholders(design.title, { guild, member, conf, activity }))
    .setDescription(fillPlaceholders(design.description, { guild, member, conf, activity }));
  if (design.url) embed.setURL(String(design.url));
  if (design.authorName) {
    embed.setAuthor({
      name: fillPlaceholders(design.authorName, { guild, member, conf, activity }),
      ...(design.authorIconUrl ? { iconURL: String(design.authorIconUrl) } : {})
    });
  }
  if (design.thumbnailUrl) embed.setThumbnail(String(design.thumbnailUrl));
  if (design.imageUrl) embed.setImage(String(design.imageUrl));
  if (design.footerText) {
    embed.setFooter({
      text: fillPlaceholders(design.footerText, { guild, member, conf, activity }),
      ...(design.footerIconUrl ? { iconURL: String(design.footerIconUrl) } : {})
    });
  }
  if (design.timestamp) embed.setTimestamp();
  for (const field of Array.isArray(design.fields) ? design.fields : []) {
    if (!field || !field.name || !field.value) continue;
    embed.addFields({
      name: fillPlaceholders(String(field.name), { guild, member, conf, activity }),
      value: fillPlaceholders(String(field.value), { guild, member, conf, activity }),
      inline: field.inline === true
    });
  }
  return embed;
};

// „Ja, zum Server“ ist ein Interaktions-Button (customId `join`), damit der
// Bot sofort Feedback geben und den Empfänger als aktiv markieren kann –
// Discord meldet KEINEN Klick auf reine Link-Buttons. Die Einladung selbst
// wird als Link-Button in der sofortigen Antwort übergeben (ein Klick, offen).
const buildReminderActionRow = (guildId, userId, inviteUrl = DEFAULT_INVITE_URL, texts = {}, context = {}) => new ActionRowBuilder().addComponents(
  new ButtonBuilder()
    .setCustomId(`${PREFIX}join:${String(guildId)}:${String(userId)}`)
    .setLabel(formatReminderText(texts.joinButtonLabel || 'Ja, zum Server', context).slice(0, 80))
    .setStyle(ButtonStyle.Success)
    .setEmoji('✅'),
  new ButtonBuilder()
    .setCustomId(`${PREFIX}leave:${String(guildId)}:${String(userId)}`)
    .setLabel(formatReminderText(texts.leaveButtonLabel || 'Nein, bitte entfernen', context).slice(0, 80))
    .setStyle(ButtonStyle.Danger)
    .setEmoji('❌')
);

// Baut die komplette DM-Payload (Embed + Buttons + Content + Außenbild) – wird
// sowohl beim SENDEN als auch beim EDITIEREN einer bereits gesendeten DM
// verwendet, damit beide Pfade exakt dasselbe Format liefern.
const buildReminderPayload = async ({ guild, member, conf, activity }) => {
  const design = conf.dmDesign && typeof conf.dmDesign === 'object' ? conf.dmDesign : {};
  const savedAttachment = design.outsideImageAttachment;
  // Außenbild NIE kritisch: schlägt die Auflösung fehl (z. B. lokale Datei
  // gelöscht), wird die DM trotzdem mit Embed + Buttons gesendet. Aufgelöst wird
  // mit den bestehenden Helfern der anderen Module: Data-URL / lokale Datei →
  // echter Anhang (resolveOutsideImageFile), bestätigter Discord-Anhang → per ID
  // referenziert (resolveOutsideImageLite).
  let outside = { files: null, attachments: null };
  try {
    const resolved = await resolveOutsideImageFile({
      template: {
        outsideImageUrl: String(design.outsideImageUrl || ''),
        outsideImageName: String(savedAttachment?.name || 'fallen-heaven-reminder.png'),
        outsideImageAttachment: savedAttachment
      },
      defaultImageName: 'fallen-heaven-reminder.png'
    });
    if (resolved.outsideFile) {
      outside = { files: [{ attachment: resolved.outsideFile, name: resolved.outsideImageName }], attachments: [] };
    } else {
      outside = await resolveOutsideImageLite({
        outsideFile: null,
        outsideImageName: String(savedAttachment?.name || 'fallen-heaven-reminder.png'),
        defaultImageName: 'fallen-heaven-reminder.png',
        savedAttachment: savedAttachment && savedAttachment.anchored !== true ? savedAttachment : null,
        preserveAttachment: Boolean(savedAttachment?.id),
        removeOutsideImage: false
      });
    }
  } catch (error) {
    outside = { files: null, attachments: null };
    console.warn(`[inactiveReminder] Außenbild-Auflösung fehlgeschlagen – DM ohne Bild: ${error?.message || error}`);
  }
  const payload = {
    embeds: [buildReminderEmbed({ guild, member, conf, activity })],
    components: [buildReminderActionRow(guild.id, member.id, conf.inviteUrl, conf.texts, {
      user: member?.user ? `<@${member.user.id}>` : '',
      username: member?.user?.username || '',
      guild: guild?.name || 'Server',
      server: guild?.name || 'Server',
      thresholdDays: conf.thresholdDays
    })]
  };
  const content = fillPlaceholders(design.content || '', { guild, member, conf, activity });
  if (content) payload.content = content;
  if (outside.files) payload.files = outside.files;
  if (outside.attachments) payload.attachments = outside.attachments;
  return payload;
};

// Sendet die Erinnerungs-DM. Gibt es bereits eine gesendete DM (gespeicherte
// Kanal-/Nachrichten-ID, z. B. fällige Folge-Erinnerung), wird diese EDITIERT
// statt eine neue DM zu senden – kein DM-Spam, keine doppelten Nachrichten.
const sendReminderDm = async ({ guild, member, conf, activity, existing = null }) => {
  const payload = await buildReminderPayload({ guild, member, conf, activity });
  // Bereits gesendete DM aktualisieren (Folge-Erinnerung): bestehende Nachricht
  // inkl. Anhängen behalten, nur Embed + Buttons + Content aktualisieren.
  if (existing?.dmChannelId && existing?.dmMessageId) {
    try {
      const channel = resolveDmChannel(guild, existing.dmChannelId);
      const message = channel && channel.messages
        ? channel.messages.cache.get(String(existing.dmMessageId)) || await channel.messages.fetch(String(existing.dmMessageId)).catch(() => null)
        : null;
      if (message && typeof message.edit === 'function') {
        const keepAttachments = message.attachments && typeof message.attachments.map === 'function'
          ? [...message.attachments.values()].map((attachment) => String(attachment.id))
          : [];
        const editPayload = {
          embeds: payload.embeds,
          components: payload.components,
          content: payload.content || ''
        };
        // Bestehende Bilder behalten, wenn das neue Design keine eigenen mitbringt.
        if (keepAttachments.length && !payload.files && !payload.attachments) editPayload.attachments = keepAttachments;
        if (payload.files) editPayload.files = payload.files;
        if (payload.attachments && !editPayload.attachments) editPayload.attachments = payload.attachments;
        await message.edit(editPayload);
        return {
          ok: true,
          edited: true,
          dmChannelId: String(existing.dmChannelId),
          dmMessageId: String(existing.dmMessageId)
        };
      }
    } catch (error) {
      // Editieren nicht möglich (DM zu, Nachricht weg) → neue DM senden.
      console.warn(`[inactiveReminder] Edit bestehender DM fehlgeschlagen – sende neu: ${error?.message || error}`);
    }
  }
  try {
    const sent = await member.send(payload);
    return {
      ok: true,
      // DM-Referenz für die „DM löschen“-Aktionen (alle/gezielt): Ohne diese
      // IDs kann der Bot eine gesendete DM später nicht entfernen.
      dmChannelId: String(sent?.channelId || sent?.channel?.id || ''),
      dmMessageId: String(sent?.id || '')
    };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
};

// -----------------------------------------------------------------------------
// DM löschen (alle oder gezielt)
// -----------------------------------------------------------------------------
// Discord erlaubt Bots, eigene Nachrichten in DMs zu löschen. Die gesendeten
// Erinnerungs-DMs werden über die gespeicherte Kanal-/Nachrichten-ID entfernt.
// Nie kritisch: Schlägt das Löschen fehl (DM-Kanal geschlossen, Nachricht
// bereits gelöscht), wird der Eintrag trotzdem aufgeräumt, damit die Aktion
// nicht endlos hängen bleibt und der Empfänger nie doppelt angeschrieben wird.
const resolveDmChannel = (guild, channelId) => {
  if (!guild?.client || !channelId) return null;
  return guild.client.channels.cache.get(String(channelId)) || null;
};

const memberOperations = new Map();
const withMemberOperation = (guildId, userId, operation) => {
  const key = `${String(guildId || '')}:${String(userId || '')}`;
  const previous = memberOperations.get(key) || Promise.resolve();
  const current = previous.catch(() => null).then(operation);
  memberOperations.set(key, current);
  return current.finally(() => {
    if (memberOperations.get(key) === current) memberOperations.delete(key);
  });
};

const isUnknownDiscordObject = (error) => [10003, 10008].includes(Number(error?.code || error?.rawError?.code || 0));

const deleteSingleReminderDm = async ({ guild, record, client }) => {
  const channelId = record?.dmChannelId;
  const messageId = record?.dmMessageId;
  if (!channelId || !messageId) return { ok: false, userId: record?.userId, error: 'Keine vollständige DM-Referenz gespeichert.' };
  let channel = resolveDmChannel(guild, channelId) || (client?.channels?.cache?.get?.(String(channelId)) || null);
  try {
    if (!channel && typeof (client || guild?.client)?.channels?.fetch === 'function') {
      channel = await (client || guild.client).channels.fetch(String(channelId));
    }
    if (!channel?.messages) return { ok: false, userId: record.userId, error: 'DM-Kanal ist derzeit nicht erreichbar.' };
    const message = channel.messages.cache.get(String(messageId)) || await channel.messages.fetch(String(messageId));
    if (!message) return { ok: false, userId: record.userId, error: 'Discord lieferte keinen Löschbeweis für die DM.' };
    await message.delete();
  } catch (error) {
    if (!isUnknownDiscordObject(error)) {
      return { ok: false, userId: record.userId, error: String(error?.message || error) };
    }
  }
  markInactiveReminderDmDeleted({ guildId: record.guildId, userId: record.userId });
  return { ok: true, userId: record.userId, username: record.username };
};

// Manuelle DM: sendet JETZT eine Erinnerungs-DM an ein bestimmtes Mitglied
// (unabhängig vom Scan). Existiert bereits eine DM zu diesem Mitglied, wird
// diese editiert (Embed + Buttons aktualisiert) statt doppelt gesendet.
// Alles wird gespeichert – wer, wann, DM-Referenz, Status.
const sendManualReminderDmUnlocked = async ({ guild, userId, conf = {} } = {}) => {
  if (!guild || !userId) return { ok: false, sent: 0, error: 'Server oder Mitglied fehlt.' };
  const c = settings(conf);
  let member = guild.members?.cache?.get?.(String(userId)) || null;
  if (!member && typeof guild.members?.fetch === 'function') {
    member = await guild.members.fetch(String(userId)).catch(() => null);
  }
  if (!member) return { ok: false, sent: 0, error: 'Mitglied nicht gefunden.' };
  if (member.user?.bot) return { ok: false, sent: 0, error: 'Bots werden nicht angeschrieben.' };

  // Aktivitäts-Beweis (letzte Nachricht aus dem Index, letzter Call aus den
  // Carl-bot-Logs) – derselbe Pfad wie beim automatischen Scan.
  const activityDetail = getMemberActivityDetail(guild.id);
  const lastMessageMap = getLastMessageMap(guild.id, [String(userId)]);
  const lastVoiceMap = getLastVoiceAtMap(guild.id, [String(userId)]);
  const activity = buildActivityProof({ activityDetail, lastMessageMap, lastVoiceMap, userId: String(userId) });

  const existing = getInactiveReminder(guild.id, String(userId));
  const dmSentAt = new Date().toISOString();
  upsertInactiveReminder({
    guildId: guild.id,
    userId: String(userId),
    username: member.user?.username || member.displayName || '',
    status: 'pending-send',
    dmSentAt,
    nextReminderAt: null,
    dmChannelId: existing?.dmChannelId || null,
    dmMessageId: existing?.dmMessageId || null
  });
  const dm = await sendReminderDm({ guild, member, conf: c, activity, existing });
  if (dm.ok) {
    updateInactiveReminderStatus({
      guildId: guild.id,
      userId: String(userId),
      status: 'sent',
      dmChannelId: dm.dmChannelId || existing?.dmChannelId || '',
      dmMessageId: dm.dmMessageId || existing?.dmMessageId || ''
    });
    return {
      ok: true,
      sent: 1,
      edited: dm.edited === true,
      userId: String(userId),
      username: member.displayName || member.user?.username || String(userId)
    };
  }
  updateInactiveReminderStatus({
    guildId: guild.id,
    userId: String(userId),
    status: 'dm-failed',
    respondedAt: new Date().toISOString(),
    response: dm.error || 'dm-failed',
    nextReminderAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  });
  return { ok: false, sent: 0, error: dm.error || 'DM konnte nicht gesendet werden.' };
};

export const sendManualReminderDm = ({ guild, userId, conf = {} } = {}) => withMemberOperation(
  guild?.id,
  userId,
  () => sendManualReminderDmUnlocked({ guild, userId, conf })
);

// Löscht EINE gesendete Erinnerungs-DM.
export const deleteReminderDm = async ({ guild, userId, client = null } = {}) => {
  if (!guild || !userId) return { ok: false, deleted: 0, error: 'Server oder Mitglied fehlt.' };
  const record = getInactiveReminder(guild.id, String(userId));
  if (!record || (!record.dmChannelId && !record.dmMessageId)) {
    return { ok: false, deleted: 0, error: 'Zu diesem Mitglied wurde keine DM gespeichert (bereits gelöscht oder nie gesendet).' };
  }
  const deleted = await deleteSingleReminderDm({ guild, record, client });
  return deleted.ok ? { ok: true, deleted: 1 } : { ok: false, deleted: 0, error: deleted.error };
};

// Löscht ALLE gesendeten Erinnerungs-DMs des Servers.
export const deleteAllReminderDms = async ({ guild, client = null } = {}) => {
  if (!guild) return { ok: false, deleted: 0, error: 'Server fehlt.' };
  const records = listInactiveReminders(guild.id, { limit: 2000 }).filter((entry) => entry.dmChannelId && entry.dmMessageId);
  let deleted = 0;
  let failed = 0;
  for (const record of records) {
    const outcome = await deleteSingleReminderDm({ guild, record, client });
    if (outcome.ok) deleted += 1;
    else failed += 1;
  }
  return { ok: failed === 0, deleted, failed, ...(failed ? { error: `${failed} DM(s) konnten nicht sicher gelöscht werden.` } : {}) };
};

// Baut aus einer bestehenden Erinnerungs-DM das „Entscheidungs-Embed“: Das
// HAUPT-Embed bleibt stehen (Banner, Autor, Footer, Farbe), nur der Inhalt
// wird auf die getroffene Entscheidung umgestellt – Buttons und Beweis-Felder
// verschwinden. Wird beim frischen Button-Klick UND bei der Bereinigung alter
// DMs verwendet, damit beide Pfade exakt dasselbe Ergebnis liefern.
const buildRespondedReminderEdit = (message, decision, thresholdDays = 180, texts = {}, context = {}) => {
  const stay = decision !== 'left';
  const format = (value, fallback) => formatReminderText(value || fallback, context).slice(0, 4096);
  const confirm = stay
    ? {
        title: format(texts.stayConfirmTitle, '✅ Du bleibst bei uns!').slice(0, 256),
        description: format(texts.stayConfirmDescription, 'Danke! Du bist als aktiv markiert, bleibst auf dem Server und wirst von dieser Inaktivitäts-Erinnerung nicht erneut angeschrieben.')
      }
    : {
        title: format(texts.leaveConfirmTitle, '❌ Du verlässt den Server').slice(0, 256),
        description: format(texts.leaveConfirmDescription, 'Du wirst freundlich vom Server entfernt. Falls du zurückkehren willst, bist du jederzeit willkommen. 👋')
      };
  const embeds = Array.isArray(message?.embeds) ? message.embeds : [];
  const updated = embeds.map((embed) => {
    try {
      return EmbedBuilder.from(embed)
        .setTitle(confirm.title)
        .setDescription(confirm.description)
        .setFields([])
        .toJSON();
    } catch {
      return embed;
    }
  });
  const editPayload = { components: [] };
  if (updated.length) editPayload.embeds = updated;
  return editPayload;
};

// Bereinigt BEREITS BEANTWORTETE DMs (status stayed/left): Das Haupt-Embed
// bleibt, der Inhalt wird auf die Entscheidung umgestellt, Buttons raus – genau
// wie beim frischen Button-Klick (finalizeReminderMessage). Läuft beim Start
// und manuell über das Modul, damit alte DMs mit Entscheidung nicht ewig das
// Embed mit Optionstexten zeigen („keine Knöpfe“-Effekt).
export const cleanupRespondedReminderDms = async ({ guild, cfg } = {}) => {
  if (!guild) return { ok: false, cleaned: 0, failed: 0, total: 0 };
  const conf = settings(cfg || {});
  const records = listInactiveReminders(guild.id, { limit: 2000 })
    .filter((entry) => ['stayed', 'left'].includes(entry.status) && entry.dmChannelId && entry.dmMessageId);
  let cleaned = 0;
  let failed = 0;
  for (const record of records) {
    try {
      const channel = resolveDmChannel(guild, record.dmChannelId);
      const message = channel?.messages
        ? (channel.messages.cache.get(String(record.dmMessageId)) || await channel.messages.fetch(String(record.dmMessageId)).catch(() => null))
        : null;
      if (!message || typeof message.edit !== 'function') { failed += 1; continue; }
      await message.edit(buildRespondedReminderEdit(message, record.status, 180, conf.texts, {
        user: '', username: '', guild: guild?.name || 'Server', server: guild?.name || 'Server', thresholdDays: 180
      })).catch(() => null);
      cleaned += 1;
    } catch {
      failed += 1;
    }
  }
  return { ok: true, cleaned, failed, total: records.length };
};

// -----------------------------------------------------------------------------
// Kandidaten-Findung
// -----------------------------------------------------------------------------
const isExcluded = (member, conf) => {
  const excluded = conf.excludedRoleIds || [];
  if (!excluded.length) return false;
  return member.roles.cache.some((role) => excluded.includes(String(role.id)));
};

// Findet Mitglieder, die seit der Schwelle keine Aktivität haben.
const findInactiveCandidates = async ({ guild, conf, activitySnapshot, indexActive }) => {
  const now = Date.now();
  const cutoffMs = now - conf.thresholdDays * 24 * 60 * 60 * 1000;
  const members = [...guild.members.cache.values()];
  const candidates = [];
  for (const member of members) {
    if (!member || member.user?.bot) continue;
    if (isExcluded(member, conf)) continue;
    const joinedAt = member.joinedAt?.getTime?.() || 0;
    // Erst Beitritt älter als die Schwelle – neue Mitglieder nie anfassen.
    if (!joinedAt || joinedAt > cutoffMs) continue;
    const lastActive = Number(activitySnapshot?.[member.id] || 0);
    if (lastActive >= cutoffMs) continue;
    if (indexActive.has(member.id)) continue;
    candidates.push(member);
  }
  return candidates;
};

// -----------------------------------------------------------------------------
// Scan
// -----------------------------------------------------------------------------
// EIN Scan zur Zeit pro Server (Single-Flight, koaleszierend). Überlappende
// Scans (startup + config + manual + timer) haben bisher ALLE dieselben
// Kandidaten gelesen und jeder hat DMs an alle gesendet – deshalb kamen
// doppelte Erinnerungs-DMs. Läuft ein Scan, wird ein Folge-Scan mit dem
// NEUESTEN Config-Stand vorgemerkt (kein paralleler zweiter Send).
const scanStates = new Map(); // guildId -> { current: Promise|null, rerun: { guild, conf, source }|null }

export const runInactiveReminderScanSafe = ({ guild, conf, source = 'timer', dryRun = false, userIds = [] } = {}) => {
  if (!guild) return Promise.resolve({ status: 'no-guild', sent: 0, kicked: 0, candidates: 0 });
  const key = String(guild.id || '');
  const state = scanStates.get(key) || { current: null, rerun: null };
  scanStates.set(key, state);

  const execute = async (cfgSnapshot, src, extra = {}) => {
    let scanResult;
    try {
      scanResult = await runInactiveReminderScan({
        guild,
        conf: cfgSnapshot,
        source: src,
        dryRun: !!extra.dryRun,
        userIds: Array.isArray(extra.userIds) ? extra.userIds : []
      });
    } finally {
      // Während des Laufs angeforderte Scans: genau EINEN Folge-Scan mit dem
      // neuesten Config-Stand ausführen (Bursts koaleszieren).
      const rerun = state.rerun;
      state.rerun = null;
      if (rerun) await execute(rerun.conf, rerun.source, { dryRun: rerun.dryRun, userIds: rerun.userIds });
    }
    return scanResult;
  };

  if (state.current) {
    state.rerun = { guild, conf, source, dryRun, userIds };
    return state.current;
  }
  state.current = execute(conf, source, { dryRun, userIds }).finally(() => {
    if (scanStates.get(key)?.current === state.current) scanStates.get(key).current = null;
  });
  state.current.catch(() => null);
  return state.current;
};

export const runInactiveReminderScan = async ({ guild, conf, source = 'timer', dryRun = false, userIds = [] } = {}) => {
  const c = settings(conf);
  if (!guild) return { status: 'no-guild', sent: 0, kicked: 0, candidates: 0 };
  if (!c.enabled) return { status: 'disabled', sent: 0, kicked: 0, candidates: 0 };
  const now = Date.now();
  const cutoffMs = now - c.thresholdDays * 24 * 60 * 60 * 1000;
  const result = { status: 'ok', source, sent: 0, dmFailed: 0, kicked: 0, candidates: 0, pending: 0 };

  // 1) Aktive Mitglieder bestimmen (Member-Management + Index-Tiefe).
  if (typeof guild.members?.fetch === 'function') {
    try {
      await guild.members.fetch();
    } catch (error) {
      return {
        ...result,
        status: 'data-incomplete',
        blocked: true,
        reason: 'Die vollständige Mitgliederliste konnte nicht von Discord geladen werden. Niemand wird als inaktiv eingestuft oder angeschrieben.',
        sourceError: String(error?.message || error),
        sourceQuality: { members: 'unavailable', messages: 'unknown', voice: 'ready', complete: false },
        candidatesList: []
      };
    }
  }
  const activitySnapshot = getMemberActivitySnapshot(guild.id, { includeOpenVoice: false });
  const indexSource = getIndexActivitySource(guild.id, new Date(cutoffMs).toISOString());
  result.sourceQuality = {
    members: 'ready',
    messages: indexSource.available ? 'ready' : 'unavailable',
    voice: 'ready',
    complete: indexSource.available
  };
  if (!indexSource.available) {
    return {
      ...result,
      status: 'data-incomplete',
      blocked: true,
      reason: 'Der Nachrichtenindex ist nicht erreichbar. Aus Sicherheitsgründen wird niemand als inaktiv eingestuft oder angeschrieben.',
      sourceError: indexSource.error,
      candidatesList: []
    };
  }
  const indexActive = indexSource.activeAuthorIds;

  // 2) Kandidaten ohne jemals erfolgreich versendete Erinnerung.
  const candidates = (await findInactiveCandidates({ guild, conf: c, activitySnapshot, indexActive }))
    .filter((member) => {
      const record = getInactiveReminder(guild.id, member.id);
      if (!record) return true;
      if (record.status === 'sent') return false;
      if (record.status === 'dm-failed' || record.status === 'pending-send') {
        const dueAt = record.nextReminderAt ? Date.parse(record.nextReminderAt) : Date.parse(record.updatedAt || '');
        return record.status === 'dm-failed' && Number.isFinite(dueAt) && dueAt <= now;
      }
      return false; // stayed/left/kicked/dm-deleted: niemals erneut senden
    });
  result.candidates = candidates.length;

  // Aktivitäts-Beweis je Kandidat (letzte Nachricht aus dem Index, letzte
  // Voice aus der index-abgeleiteten Carl-bot-Tabelle) – eine Query für alle.
  const activityDetail = getMemberActivityDetail(guild.id);
  const lastMessageMap = getLastMessageMap(guild.id, candidates.map((member) => member.id));
  const lastVoiceMap = getLastVoiceAtMap(guild.id, candidates.map((member) => member.id));
  const proofById = new Map();
  for (const member of candidates) {
    proofById.set(String(member.id), buildActivityProof({ activityDetail, lastMessageMap, lastVoiceMap, userId: member.id }));
  }

  // HÄRTUNG vor dem Senden: Jeder Kandidat wird nochmal explizit auf BEIDE
  // Bedingungen geprüft – letzte Nachricht UND letzter Call müssen BEIDE über
  // der Grenze liegen (älter als die Schwelle). Wer auch nur in EINER der
  // beiden Dimensionen unter der Grenze liegt (also kürzlich aktiv war), fliegt
  // aus der Liste und bekommt KEIN Embed. Das ist die zweite, unabhängige
  // Prüfung zusätzlich zum Aktivitäts-Snapshot und Index-Schutz.
  const verifiedCandidates = candidates.filter((member) => {
    const currentlyInVoice = Boolean(
      member?.voice?.channelId
      || guild.voiceStates?.cache?.get?.(String(member.id))?.channelId
    );
    if (currentlyInVoice) return false;
    const proof = proofById.get(String(member.id));
    if (!proof) return true; // keine Detail-Daten → Index-/Snapshot-Prüfung zählt
    const chatOld = proof.lastMessageMs === 0 || proof.lastMessageMs < cutoffMs;
    const voiceOld = proof.lastVoiceMs === 0 || proof.lastVoiceMs < cutoffMs;
    return chatOld && voiceOld;
  });
  // Zählung im Ergebnis: wie viele durch die Einzel-Prüfung (Chat UND Call
  // über der Grenze) rausfielen – 0 ist ein gültiger Wert.
  result.voiceChatExcluded = candidates.length - verifiedCandidates.length;
  // Ab hier gilt: NUR wer in BEIDEN Dimensionen über der Grenze liegt.
  const finalCandidates = verifiedCandidates;
  result.candidates = finalCandidates.length;

  // Vorschau-Modus (dryRun): Nur ermitteln, WER angeschrieben würde – OHNE
  // DMs zu senden und OHNE die Datenbank zu verändern. Damit kann man sich
  // zuerst einen Überblick verschaffen, bevor echte Erinnerungen rausgehen.
  if (dryRun) {
    result.preview = true;
    result.sent = 0;
    result.candidatesList = finalCandidates.map((member) => {
      const proof = proofById.get(String(member.id)) || {};
      return {
        userId: String(member.id || ''),
        username: String(member.user?.username || member.displayName || 'Mitglied'),
        joinedAt: member.joinedAt && !Number.isNaN(new Date(member.joinedAt).getTime()) ? new Date(member.joinedAt).toISOString() : null,
        // Letzte Aktivität (max Nachricht/Voice) aus dem Aktivitäts-Snapshot.
        lastActiveMs: Number(activitySnapshot?.[member.id] || 0) || null,
        lastMessageMs: proof.lastMessageMs || null,
        lastVoiceMs: proof.lastVoiceMs || null,
        reason: 'Keine bekannte Chat- oder Voice-Aktivität innerhalb der eingestellten Schwelle.'
      };
    });
    return result;
  }

  // 3) Auswahl-Modus („Senden an ausgewählte“ aus der Vorschau): nur die
  //    manuell ausgewählten Kandidaten senden. Wer zwischen Vorschau und
  //    Senden aktiv geworden ist oder bereits eine Erinnerung hat, fällt
  //    aus der Kandidatenliste und wird automatisch übersprungen – es wird
  //    nie blind an jemanden gesendet.
  let sendList = finalCandidates;
  if (Array.isArray(userIds) && userIds.length) {
    const selected = new Set(userIds.map((id) => String(id)));
    sendList = finalCandidates.filter((member) => selected.has(String(member.id)));
    result.skipped = finalCandidates.length - sendList.length;
    result.candidates = sendList.length;
  }

  await sendReminderDms({ guild, conf: c, candidates: sendList, result, proofById });
  return result;
};

// Sendet Erinnerungs-DMs an die übergebenen Kandidaten. Jeder Kandidat wird
// VOR dem Senden in der DB als 'sent' reserviert (Primary Key guild_id+user_id).
// Damit kann kein zweiter Scan (auch nach Crash zwischen Senden und Upsert)
// denselben Kandidaten erneut anschreiben – keine doppelten DMs mehr. Alles
// (wer, wann, DM-Referenz, Antwort) wird in der SQLite-Datenbank gespeichert
// und übersteht Neustarts/Updates – es wird NIE aus dem Gedächtnis gesendet.
const sendReminderDms = async ({ guild, conf, candidates, result, proofById = null }) => {
  const now = Date.now();
  for (const member of candidates) {
    await withMemberOperation(guild.id, member.id, async () => {
      const username = member.user?.username || member.displayName || '';
      const dmSentAt = new Date().toISOString();
      const existing = getInactiveReminder(guild.id, member.id);
      if (existing?.status === 'sent' || existing?.status === 'pending-send') {
        result.skipped = Number(result.skipped || 0) + 1;
        return;
      }
      const activity = proofById?.get(String(member.id)) || {};
      upsertInactiveReminder({
        guildId: guild.id,
        userId: member.id,
        username,
        status: 'pending-send',
        dmSentAt,
        nextReminderAt: null,
        dmChannelId: existing?.dmChannelId || null,
        dmMessageId: existing?.dmMessageId || null
      });
      const dm = await sendReminderDm({ guild, member, conf, activity, existing });
      if (dm.ok) {
      // DM-Referenz nachtragen (oder bei Edit beibehalten), damit die DM
      // später löschbar ist (alle/gezielt) und Folge-Erinnerungen dieselbe
      // Nachricht EDITIEREN statt neu zu senden.
      updateInactiveReminderStatus({
        guildId: guild.id,
        userId: member.id,
        status: 'sent',
        dmChannelId: dm.dmChannelId || existing?.dmChannelId || '',
        dmMessageId: dm.dmMessageId || existing?.dmMessageId || ''
      });
      result.sent += 1;
      } else {
      // DM nicht möglich: Fehler wahrheitsgetreu speichern und erst nach einer
      // Wartezeit wieder zur bewussten Vorschau zulassen.
      updateInactiveReminderStatus({
        guildId: guild.id,
        userId: member.id,
        status: 'dm-failed',
        respondedAt: new Date().toISOString(),
        response: 'dm-blocked',
        nextReminderAt: new Date(now + 24 * 60 * 60 * 1000).toISOString()
      });
      result.dmFailed += 1;
      }
    });
  }

  // 4) Offene Erinnerungen nur zählen (KEIN Auto-Kick – wer nicht antwortet,
  //    bleibt auf dem Server und wird nicht erneut belästigt).
  result.pending = listPendingInactiveReminders(guild.id, now).length;
  return result;
};

// -----------------------------------------------------------------------------
// Buttons: join (Ja, zum Server) / stay (Legacy) / leave
// -----------------------------------------------------------------------------
// Nach einer Antwort: Das HAUPT-Embed bleibt stehen, nur der Inhalt wird auf
// die Entscheidung umgestellt („Du bleibst“ / „Du verlässt“), Buttons + Felder
// werden entfernt. Keine „toten“ Optionstexte mehr in der Nachricht.
const finalizeReminderMessage = async (interaction, decision, thresholdDays = 180, texts = {}, guildName = 'Server') => {
  const msg = interaction?.message;
  if (!msg || typeof msg.edit !== 'function') return;
  try {
    await msg.edit(buildRespondedReminderEdit(msg, decision, thresholdDays, texts, {
      user: '', username: '', guild: guildName, server: guildName, thresholdDays
    })).catch(() => null);
  } catch {
    await msg.edit({ components: [] }).catch(() => null);
  }
};

export const handleInactiveReminderInteraction = async ({ interaction, cfg } = {}) => {
  const customId = String(interaction?.customId || '');
  if (!customId.startsWith(PREFIX)) return false;
  const parts = customId.split(':');
  const action = parts[1];
  const guildId = parts[2];
  const userId = parts[3];
  if (!['join', 'stay', 'leave'].includes(action) || !guildId || !userId) {
    await interaction.reply({ content: 'Diese Aktion ist ungültig.', flags: MessageFlags.Ephemeral }).catch(() => null);
    return true;
  }
  if (interaction?.user?.id && String(interaction.user.id) !== String(userId)) {
    await interaction.reply({ content: 'Diese Erinnerung gehört nicht zu deinem Konto.', flags: MessageFlags.Ephemeral }).catch(() => null);
    return true;
  }
  const conf = settings(cfg);
  // DM-Klicks haben kein interaction.guild – der Server wird dann über den
  // Bot-Client aufgelöst (interaction.client ist immer verfügbar), damit auch
  // das „Nein, bitte entfernen“ in der DM den Kick ausführen kann.
  const guild = interaction.guild
    || interaction.client?.guilds?.cache?.get?.(String(guildId))
    || null;
  const member = guild?.members?.cache?.get?.(String(userId)) || null;

  // Immer sofort bestätigen (Watchdog-sicher), die Arbeit danach ausführen.
  // „Ja, zum Server“ (join) + Legacy „Ja, ich bleibe“ (stay, alte DMs) →
  // sofortiges Feedback, als aktiv markieren, nie wieder anschreiben.
  if (action === 'join' || action === 'stay') {
    updateInactiveReminderStatus({
      guildId, userId,
      status: 'stayed',
      respondedAt: new Date().toISOString(),
      response: 'stay'
    });
    if (action === 'join') {
      // Feedback + Einladung: Link-Button öffnet die Einladung direkt.
      const replyContext = {
        user: '',
        username: '',
        guild: guild?.name || 'Server',
        server: guild?.name || 'Server',
        thresholdDays: conf.thresholdDays
      };
      const inviteRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel(formatReminderText(conf.texts.joinInviteButtonLabel || '🔗 Zum Server beitreten', replyContext).slice(0, 80))
          .setStyle(ButtonStyle.Link)
          .setURL(String(conf.inviteUrl || DEFAULT_INVITE_URL))
      );
      await interaction.reply({
        content: formatReminderText(conf.texts.joinReplyText || `✅ Danke! Du bist als **aktiv** markiert und wirst nicht erneut angeschrieben. Hier ist deine Einladung – ein Klick und du bist zurück auf **${guild?.name || 'dem Server'}**:`, replyContext).slice(0, 2000),
        components: [inviteRow],
        flags: MessageFlags.Ephemeral
      }).catch(() => null);
    } else {
      const stayContext = {
        user: '', username: '', guild: guild?.name || 'Server', server: guild?.name || 'Server', thresholdDays: conf.thresholdDays
      };
      await interaction.reply({
        content: formatReminderText(conf.texts.stayReplyText || '✅ Danke! Du bleibst auf dem Server und wirst von dieser Inaktivitäts-Erinnerung nicht erneut angeschrieben.', stayContext).slice(0, 2000),
        flags: MessageFlags.Ephemeral
      }).catch(() => null);
    }
    await finalizeReminderMessage(interaction, 'stay', conf.thresholdDays, conf.texts, guild?.name || 'Server');
    return true;
  }

  // leave: erst neutral bestätigen, dann Discord ausführen und genau dieses
  // Ergebnis speichern. Fehlende Rechte dürfen nie als erfolgreicher Kick
  // erscheinen.
  const leaveContext = {
    user: '', username: '', guild: guild?.name || 'Server', server: guild?.name || 'Server', thresholdDays: conf.thresholdDays
  };
  let acknowledged = false;
  if (typeof interaction.deferReply === 'function') {
    acknowledged = await interaction.deferReply({ flags: MessageFlags.Ephemeral }).then(() => true).catch(() => false);
  }
  if (!acknowledged) {
    acknowledged = await interaction.reply({ content: 'Deine Anfrage wird geprüft.', flags: MessageFlags.Ephemeral }).then(() => true).catch(() => false);
  }
  let currentMember = member;
  if (!currentMember && guild && typeof guild.members?.fetch === 'function') {
    currentMember = await guild.members.fetch(String(userId)).catch(() => null);
  }
  let finalText = '';
  if (!guild) {
    updateInactiveReminderStatus({ guildId, userId, status: 'leave-requested', respondedAt: new Date().toISOString(), response: 'guild-unavailable' });
    finalText = 'Dein Wunsch wurde gespeichert. Der Server ist gerade nicht erreichbar; das Team muss die Entfernung abschließen.';
  } else if (!currentMember) {
    updateInactiveReminderStatus({ guildId, userId, status: 'left', respondedAt: new Date().toISOString(), response: 'already-left' });
    finalText = 'Du bist bereits nicht mehr auf dem Server.';
    await finalizeReminderMessage(interaction, 'left', conf.thresholdDays, conf.texts, guild?.name || 'Server');
  } else if (!currentMember.kickable || typeof currentMember.kick !== 'function') {
    updateInactiveReminderStatus({ guildId, userId, status: 'leave-requested', respondedAt: new Date().toISOString(), response: 'not-kickable' });
    finalText = 'Dein Wunsch wurde gespeichert, aber der Bot darf dich aktuell nicht entfernen. Das Team muss die Entfernung abschließen.';
  } else {
    try {
      await currentMember.kick('Inaktivitäts-Erinnerung: Mitglied hat selbst gewählt, den Server zu verlassen.');
      updateInactiveReminderStatus({
        guildId, userId, status: 'kicked', respondedAt: new Date().toISOString(), response: 'leave', kickedAt: new Date().toISOString()
      });
      finalText = formatReminderText(conf.texts.leaveReplyText || 'Verstanden. Du wurdest wie gewünscht vom Server entfernt.', leaveContext).slice(0, 2000);
      await finalizeReminderMessage(interaction, 'left', conf.thresholdDays, conf.texts, guild?.name || 'Server');
    } catch (error) {
      updateInactiveReminderStatus({ guildId, userId, status: 'leave-requested', respondedAt: new Date().toISOString(), response: `kick-failed:${String(error?.message || error).slice(0, 500)}` });
      finalText = 'Dein Wunsch wurde gespeichert, aber Discord hat die Entfernung abgelehnt. Das Team muss sie abschließen.';
    }
  }
  if (typeof interaction.editReply === 'function') await interaction.editReply({ content: finalText }).catch(() => null);
  else if (acknowledged && typeof interaction.followUp === 'function') await interaction.followUp({ content: finalText, flags: MessageFlags.Ephemeral }).catch(() => null);
  else if (!acknowledged) await interaction.reply({ content: finalText, flags: MessageFlags.Ephemeral }).catch(() => null);
  return true;
};

// -----------------------------------------------------------------------------
// Timer & Feature
// -----------------------------------------------------------------------------
const scanTimers = new Map(); // guildId -> Interval
const latestScanConfigs = new Map(); // guildId -> latest full config
const voiceHistoryQuality = new Map(); // guildId -> { ready, status, checkedAt }

const ensureScanTimer = (guild, cfg) => {
  const guildId = String(guild.id);
  latestScanConfigs.set(guildId, cfg);
  const existing = scanTimers.get(guildId);
  if (existing) return existing;
  const timer = setInterval(() => {
    const currentCfg = latestScanConfigs.get(guildId);
    if (!settings(currentCfg).enabled) return;
    void runAutomaticInactiveReminderScan({ guild, cfg: currentCfg, source: 'timer' })
      .catch((error) => console.warn(`[inactiveReminder] Automatischer Scan fehlgeschlagen: ${error?.message || error}`));
  }, SCAN_INTERVAL_MS);
  timer.unref?.();
  scanTimers.set(guildId, timer);
  return timer;
};

const runAutomaticInactiveReminderScan = async ({ guild, cfg, source }) => {
  let backfill;
  try {
    backfill = await runVoiceLogBackfill({ guild, conf: cfg, source: `pre-reminder-${source}` });
  } catch (error) {
    backfill = { status: 'error', error: String(error?.message || error) };
  }
  const ready = backfill?.status === 'ok';
  voiceHistoryQuality.set(String(guild.id), { ready, status: String(backfill?.status || 'error'), checkedAt: new Date().toISOString() });
  if (!ready) {
    return {
      status: 'data-incomplete', blocked: true, sent: 0, candidates: 0,
      reason: `Die historische Voice-Prüfung ist nicht vollständig (${String(backfill?.status || 'Fehler')}). Es wurden keine DMs gesendet.`
    };
  }
  return runInactiveReminderScanSafe({ guild, conf: cfg, source });
};

export const stopInactiveReminderScan = (guildId) => {
  const key = String(guildId || '');
  const timer = scanTimers.get(key);
  if (timer) clearInterval(timer);
  scanTimers.delete(key);
  latestScanConfigs.delete(key);
  voiceHistoryQuality.delete(key);
};

// Status für das Dashboard (Übersicht + Liste).
export const getInactiveReminderSnapshot = (guildId, cfg = {}, { page = 0, pageSize = 25 } = {}) => {
  const conf = settings(cfg);
  const safePage = Math.max(0, Number(page) || 0);
  const safePageSize = [25, 50, 100].includes(Number(pageSize)) ? Number(pageSize) : 25;
  const total = countInactiveReminders(String(guildId || ''));
  const pageCount = Math.max(1, Math.ceil(total / safePageSize));
  return {
    enabled: conf.enabled,
    deliveryMode: conf.deliveryMode,
    automaticState: voiceHistoryQuality.get(String(guildId || '')) || null,
    thresholdDays: conf.thresholdDays,
    excludedRoleCount: conf.excludedRoleIds.length,
    stats: countInactiveReminderStats(String(guildId || '')),
    total,
    page: Math.min(safePage, pageCount - 1),
    pageSize: safePageSize,
    pageCount,
    entries: listInactiveReminders(String(guildId || ''), { limit: safePageSize, offset: Math.min(safePage, pageCount - 1) * safePageSize })
  };
};

export const feature = {
  id: 'inactiveReminder',
  name: 'Inaktivitäts-Erinnerung',
  commands: [],

  async onClientReady({ guild, cfg }) {
    const conf = settings(cfg);
    if (!conf.enabled) return;
    ensureScanTimer(guild, cfg);
    await runAutomaticInactiveReminderScan({ guild, cfg, source: 'startup' })
      .then((result) => {
        if (result?.blocked) console.warn(`[inactiveReminder] Startlauf blockiert: ${result.reason}`);
      })
      .catch((error) => console.warn(`[inactiveReminder] Startlauf fehlgeschlagen: ${error?.message || error}`));
    // Alte, bereits beantwortete DMs bereinigen: Embed + Buttons raus, nur
    // Bestätigungstext bleibt. Läuft im Hintergrund (nie blockierend).
    cleanupRespondedReminderDms({ guild, cfg })
      .then((result) => {
        if (result?.cleaned) quietLog(QUIET_LOG_SCOPE.inactiveReminder, null, `${result.cleaned} beantwortete DM(s) bereinigt (${result.failed} fehlgeschlagen)`);
      })
      .catch((error) => console.warn(`[inactiveReminder] DM-Bereinigung fehlgeschlagen: ${error?.message || error}`));
  },

  // Safety net: Wer nach einer Erinnerung über die Einladung (oder anderweitig)
  // wieder beitritt, wird SOFORT als aktiv markiert und nie erneut angeschrieben.
  async onGuildMemberAdd({ member, cfg }) {
    const conf = settings(cfg);
    if (!conf.enabled || !member?.id) return;
    try {
      const existing = getInactiveReminder(String(member.guild?.id || ''), String(member.id));
      if (existing && existing.status === 'sent') {
        updateInactiveReminderStatus({
          guildId: String(member.guild.id),
          userId: String(member.id),
          status: 'stayed',
          respondedAt: new Date().toISOString(),
          response: 'stay'
        });
      }
    } catch (error) {
      console.warn(`[inactiveReminder] Join-Markierung fehlgeschlagen: ${error?.message || error}`);
    }
  },

  async onConfigUpdate({ guild, cfg, patch }) {
    if (!patch || !Object.prototype.hasOwnProperty.call(patch, 'inactiveReminder')) return;
    const conf = settings(cfg);
    if (conf.enabled) {
      ensureScanTimer(guild, cfg);
      void runAutomaticInactiveReminderScan({ guild, cfg, source: 'config' })
        .then((result) => {
          if (result?.blocked) console.warn(`[inactiveReminder] Config-Lauf blockiert: ${result.reason}`);
        })
        .catch((error) => console.warn(`[inactiveReminder] Config-Lauf fehlgeschlagen: ${error?.message || error}`));
    } else {
      stopInactiveReminderScan(guild.id);
    }
  },

  async onVoiceStateUpdate({ oldState, newState, guild }) {
    const userId = String(newState?.id || oldState?.id || newState?.member?.id || oldState?.member?.id || '');
    if (!guild?.id || !userId) return;
    const oldChannelId = String(oldState?.channelId || '');
    const newChannelId = String(newState?.channelId || '');
    if (!oldChannelId && !newChannelId) return;
    setUserLastVoiceAt({ guildId: guild.id, userId, eventAt: new Date() });
  },

  async onAnyInteraction({ interaction, cfg }) {
    await handleInactiveReminderInteraction({ interaction, cfg });
  }
};

export const _inactiveReminderInternals = {
  settings,
  normalizeReminderDesign,
  saveInactiveReminderDesign,
  fillPlaceholders,
  findInactiveCandidates,
  runInactiveReminderScan,
  runInactiveReminderScanSafe,
  handleInactiveReminderInteraction,
  getInactiveReminderSnapshot,
  buildReminderEmbed,
  buildReminderActionRow,
  deleteReminderDm,
  deleteAllReminderDms,
  cleanupRespondedReminderDms,
  buildRespondedReminderEdit,
  reminderTexts,
  formatReminderText,
  DEFAULT_REMINDER_TEXTS,
  sendManualReminderDm,
  formatActivityDate,
  buildActivityProof,
  getLastMessageMap,
  getIndexActivitySource,
  runAutomaticInactiveReminderScan,
  latestScanConfigs,
  voiceHistoryQuality,
  sendReminderDm,
  PREFIX,
  SCAN_INTERVAL_MS
};
