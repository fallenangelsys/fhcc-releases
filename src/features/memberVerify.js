import path from 'node:path';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { atomicWriteJson, readJsonWithRecovery } from '../runtime/atomicJsonStore.js';
import { applyManagedRolePolicy } from '../runtime/managedRoleService.js';
import { finiteInteger } from '../runtime/utils.js';
import { isAllowedEmbedImageUrl, readLocalImage } from '../runtime/localImageStore.js';
import { generateChallenge as generateVerifyChallenge, taskMeta, verifyAnswer } from '../runtime/verifyChallenges.js';
import { quietLog, QUIET_LOG_SCOPE } from '../runtime/quietLog.js';
import { DATA_DIR } from '../shared/paths.js';

const DATA_ROOT = DATA_DIR;
const VERIFY_FILE = path.join(DATA_ROOT, 'member-verify.json');
const STORE_VERSION = 1;
const MAX_PENDING_PER_GUILD = 120;
const REMINDER_TICK_MS = 60 * 1000;
const MINUTE_MS = 60 * 1000;
const builtinReminderPhrases = [
  '{user} – du hast dich noch nicht verifiziert! Klicke unten im Panel auf „Verifizieren“, um deine Rolle zu bekommen. 🙌',
  '{user} – deine Verifizierung fehlt noch. Ein kurzer Klick auf den Button und du bist dabei! 🚀',
 '{user} – wir warten noch auf deine Verifizierung. Danach kannst du alle Kanäle sehen und mitreden. 💜',
  '{user} – nur noch kurz verifizieren: Button drücken, Frage beantworten, fertig! ⚡',
  '{user} – ohne Verify bleibt dir der Zugang verwehrt. Schau kurz beim Panel vorbei! 🔐'
];

const settings = (cfg) => cfg?.memberVerify || {};

// Editierbare Textbausteine des Verify-Moduls (3.9.222-Prinzip): Alle festen
// Texte (Button-Labels, Titel, Beschreibungen, Feldnamen, Footer) sind
// Vorlagen mit Platzhaltern – der Server kann sie im Modul anpassen, die
// dynamischen Werte bleiben Platzhalter.
const DEFAULT_VERIFY_TEXTS = () => ({
  panelStartButton: 'Verifizieren',
  panelStatsButton: 'Statistik',
  challengeTitle: 'Bist du ein Mensch?',
  challengeDescription: 'Beantworte die Aufgabe, um zu beweisen, dass du ein echtes Mitglied bist.',
  challengeFooterButtons: 'Nur für dich sichtbar · Klicke die richtige Antwort',
  challengeFooterText: 'Nur für dich sichtbar · {validMinutes} Minuten gültig',
  modalTitle: 'FALLEN HEAVEN · Verifizierung',
  modalLabel: 'Deine Antwort',
  modalPlaceholder: '',
  answerButtonLabel: 'Antwort eingeben',
  statsTitle: 'Verifizierungs-Statistik',
  statsAuthor: 'FALLEN HEAVEN · VERIFY-STATISTIK',
  statsFooter: 'Nur für dich sichtbar',
  statsVerifiedTotalField: '✅ Verifiziert gesamt',
  statsVerifiedTodayField: 'Heute verifiziert',
  statsApprovedField: 'Team-Freigaben',
  statsFlaggedField: '🚩 Geprüfte Konten',
  statsBannedField: '⛔ Gebannt',
  statsKickedField: '👢 Gekickt',
  statsPendingField: '⏳ Offene Verify',
  statsAwaitingField: 'Freigabe ausstehend',
  decisionApprovePending: 'Freigeben',
  decisionApproveDone: 'Durchlassen',
  decisionApproveResolved: 'Freigegeben',
  decisionBan: 'Bannen',
  decisionBanResolved: 'Gebannt',
  approvalAuthor: 'VERIFY-FREIGABE ERFORDERLICH',
  approvalDescription: 'Die Aufgabe wurde richtig gelöst – Team-Freigabe steht aus.',
  approvalMemberField: 'Mitglied',
  approvalTaskField: 'Gelöste Aufgabe',
  approvalAnswersField: 'Antworten'
});
const verifyTexts = (cfg) => {
  const defaults = DEFAULT_VERIFY_TEXTS();
  return Object.fromEntries(Object.keys(defaults).map((key) => [key, safePanelText(cfg?.[key], defaults[key], 1024)]));
};
const safePanelText = (value, fallback = '', max = 1024) => String(value ?? fallback).slice(0, max);
const formatVerifyText = (value, context = {}) => String(value || '')
  .replaceAll('{user}', context.user)
  .replaceAll('{username}', context.username)
  .replaceAll('{guild}', context.guild)
  .replaceAll('{server}', context.server)
  .replaceAll('{validMinutes}', context.validMinutes)
  .replaceAll('{task}', context.task)
  .replaceAll('{attempts}', context.attempts)
  .replaceAll('{maxAttempts}', context.maxAttempts)
  .replaceAll('{lockMinutes}', context.lockMinutes)
  .replaceAll('{member}', context.member)
  .replaceAll('{answers}', context.answers)
  .replaceAll('{verifiedTotal}', context.verifiedTotal)
  .replaceAll('{verifiedToday}', context.verifiedToday)
  .replaceAll('{approvedTotal}', context.approvedTotal)
  .replaceAll('{flaggedTotal}', context.flaggedTotal)
  .replaceAll('{bannedTotal}', context.bannedTotal)
  .replaceAll('{kickedTotal}', context.kickedTotal)
  .replaceAll('{pending}', context.pending)
  .replaceAll('{awaiting}', context.awaiting);
const builtinFlaggedTerms = [
  'hitler', 'nsdap', 'heil hitler', '1488', 'nazi', 'hakenkreuz', 'swastika',
  'cp-', 'kinderporno', 'underage', 'pedo', 'grooming',
  'scam', 'free nitro', 'nitro gratis', 'giftcard scam', 'crypto give'
];
const linkPattern = /(?:https?:\/\/|www\.|discord\.(?:gg|com\/invite)|dsc\.gg|\.gg\/|bit\.ly|tinyurl|discord\.me|invite\.gg|top\.gg\/invite)[^\s]*/i;

const emptyStore = () => ({ version: STORE_VERSION, guilds: {} });
const dateKey = (timezone = 'Europe/Berlin') => {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  catch { return new Date().toISOString().slice(0, 10); }
};
const normalizeStats = (value = {}) => ({
  verifiedTotal: finiteInteger(value.verifiedTotal, 0, 0, Number.MAX_SAFE_INTEGER),
  verifiedTodayKey: String(value.verifiedTodayKey || ''),
  verifiedToday: finiteInteger(value.verifiedToday, 0, 0, Number.MAX_SAFE_INTEGER),
  approvedTotal: finiteInteger(value.approvedTotal, 0, 0, Number.MAX_SAFE_INTEGER),
  flaggedTotal: finiteInteger(value.flaggedTotal, 0, 0, Number.MAX_SAFE_INTEGER),
  bannedTotal: finiteInteger(value.bannedTotal, 0, 0, Number.MAX_SAFE_INTEGER),
  kickedTotal: finiteInteger(value.kickedTotal, 0, 0, Number.MAX_SAFE_INTEGER)
});
const normalizeStore = (input) => {
  const store = input && typeof input === 'object' ? input : emptyStore();
  store.version = STORE_VERSION;
  store.guilds = store.guilds && typeof store.guilds === 'object' ? store.guilds : {};
  for (const guild of Object.values(store.guilds)) {
    guild.panelMessageId = String(guild?.panelMessageId || '');
    guild.pending = guild?.pending && typeof guild.pending === 'object' ? guild.pending : {};
    guild.stats = normalizeStats(guild?.stats);
  }
  return store;
};
const bumpStats = (store, guildId, field) => {
  const entry = guildState(store, guildId);
  entry.stats = normalizeStats(entry?.stats);
  const stats = entry.stats;
  stats[field] = Math.max(0, Math.floor(Number(stats[field] || 0))) + 1;
  if (field === 'verifiedTotal') {
    const today = dateKey();
    if (stats.verifiedTodayKey !== today) { stats.verifiedTodayKey = today; stats.verifiedToday = 0; }
    stats.verifiedToday += 1;
  }
  return stats;
};

const reminderPhrases = (cfg) => {
  const custom = String(cfg?.reminderPhrases || '')
    .split('\n').map((line) => line.trim()).filter((line) => line.length >= 5 && line.length <= 300).slice(0, 20);
  return custom.length ? custom : builtinReminderPhrases;
};

const reminderSettings = (cfg, conf = settings(cfg)) => ({
  enabled: conf?.reminderEnabled === true && Number(conf?.maxReminders || 0) > 0,
  delayMs: Math.max(1, Math.min(1440, Math.floor(Number(conf?.reminderDelayMinutes) || 5))) * MINUTE_MS,
  maxReminders: Math.max(1, Math.min(10, Math.floor(Number(conf?.maxReminders) || 3)))
});

// Wie viele Erinnerungen dieses Mitglied bereits „verdient“ hat (basierend auf
// der Wartezeit seit dem Beitritt). Läuft der Timer häufiger als nötig, wird
// pro Fälligkeit nur einmal gesendet und der Zähler im Store festgehalten.
const earnedReminderCount = ({ joinedAt, now = Date.now(), delayMs = 5 * MINUTE_MS }) => {
  const start = Number(joinedAt);
  if (!Number.isFinite(start) || start <= 0) return 0;
  const elapsed = Math.max(0, now - start - delayMs);
  // Erste Erinnerung direkt nach Ablauf der Wartezeit, danach pro Intervall.
  return elapsed > 0 ? Math.ceil(elapsed / delayMs) : 0;
};
let mutationQueue = Promise.resolve();
const loadStore = async () => normalizeStore((await readJsonWithRecovery(VERIFY_FILE, {
  fallback: emptyStore(),
  backupLimit: 5,
  validate: (value) => Boolean(value && typeof value === 'object')
})).value);
const mutateStore = (worker) => {
  const operation = mutationQueue.catch(() => {}).then(async () => {
    const store = await loadStore();
    const result = await worker(store);
    await atomicWriteJson(VERIFY_FILE, store, { backupLimit: 5 });
    return result;
  });
  mutationQueue = operation.catch(() => {});
  return operation;
};
const guildState = (store, guildId) => {
  store.guilds[guildId] ||= { panelMessageId: '', pending: {} };
  return store.guilds[guildId];
};

const clearReminderState = (store, guildId, userId) => {
  const entry = store?.guilds?.[guildId]?.pending?.[userId];
  if (entry) {
    delete entry.reminderSent;
    delete entry.joinedAtForReminders;
  }
  return store;
};

// Markiert ein Mitglied als „für Reminder getrackt“. Nutzt den Beitrittszeitpunkt
// als Basis, damit auch bereits vorhandene Mitglieder nach Aktivierung des
// Moduls (oder nach einem Bot-Neustart) fair behandelt werden.
const trackReminderMember = (store, guildId, member) => {
  const entry = guildState(store, guildId).pending[String(member?.id || '')] ||= {};
  if (!Number.isFinite(Number(entry.joinedAtForReminders))) {
    const joined = member?.joinedAt ? Number(new Date(member.joinedAt)) : Date.now();
    entry.joinedAtForReminders = joined;
  }
  return entry;
};

const normalizeFlaggedTerms = (cfg) => {
  const extra = String(cfg?.flaggedTerms || '').split('\n').map((line) => line.trim().toLowerCase()).filter(Boolean);
  return [...new Set([...builtinFlaggedTerms, ...extra])];
};

const countDigits = (name) => String(name || '').replace(/[^0-9]/g, '').length;
const longestDigitRun = (name) => {
  let longest = 0;
  let current = 0;
  for (const char of String(name || '')) {
    if (/\d/.test(char)) { current += 1; longest = Math.max(longest, current); } else current = 0;
  }
  return longest;
};
const containsLink = (name) => linkPattern.test(String(name || ''));
const containsFlaggedTerm = (name, terms) => {
  const normalized = String(name || '').normalize('NFKC').toLowerCase();
  return terms.find((term) => normalized.includes(term)) || null;
};

const accountAgeDays = (member) => {
  const created = member?.user?.createdAt ? new Date(member.user.createdAt).getTime() : 0;
  if (!created) return null;
  return Math.max(0, (Date.now() - created) / 86_400_000);
};

const screenProfile = (member, cfg) => {
  const username = String(member?.user?.username || '');
  const flags = [];
  if (containsLink(username)) flags.push({ key: 'link', label: 'Link im Namen', hard: true });
  const term = containsFlaggedTerm(username, normalizeFlaggedTerms(cfg));
  if (term) flags.push({ key: 'term', label: `Verbotener Begriff: „${term}“`, hard: true });
  const minAgeDays = finiteInteger(cfg?.minAccountAgeDays, 0, 0, 3650);
  if (minAgeDays > 0) {
    const age = accountAgeDays(member);
    if (age !== null && age < minAgeDays) {
      flags.push({ key: 'young-account', label: `Konto nur ${Math.max(0, Math.floor(age))} Tag(e) alt (mind. ${minAgeDays})`, hard: cfg?.autoBanYoungAccounts === true });
    }
  }
  const digitRatioPercent = finiteInteger(cfg?.digitRatioPercent, 40, 0, 100);
  if (digitRatioPercent > 0 && username.length >= 6) {
    const ratio = Math.round((countDigits(username) / username.length) * 100);
    if (ratio >= digitRatioPercent) flags.push({ key: 'digits', label: `Ziffern-Anteil ${ratio}% (≥ ${digitRatioPercent}%)`, hard: false });
  }
  const maxDigitRun = finiteInteger(cfg?.maxDigitRun, 6, 0, 32);
  if (maxDigitRun > 0) {
    const run = longestDigitRun(username);
    if (run >= maxDigitRun) flags.push({ key: 'digit-run', label: `Ziffernblock von ${run} Zeichen`, hard: false });
  }
  if (!member?.user?.avatar) flags.push({ key: 'no-avatar', label: 'Kein eigener Avatar', hard: false });
  return flags;
};

const resolvedVerifiedRole = (guild, cfg) => cfg?.verifiedRoleId ? guild?.roles?.cache?.get?.(cfg.verifiedRoleId) || null : null;
const resolvedUnverifiedRole = (guild, cfg) => cfg?.unverifiedRoleId ? guild?.roles?.cache?.get?.(cfg.unverifiedRoleId) || null : null;
const isVerified = (member, cfg) => {
  const roleId = String(cfg?.verifiedRoleId || '').trim();
  return Boolean(roleId && member?.roles?.cache?.has?.(roleId));
};

const defaultPanelDesign = () => ({
  content: '',
  outsideImageUrl: '',
  outsideImageAttachment: null,
  embeds: [{
    title: 'Willkommen! Verifiziere dich, um loszulegen.',
    description: 'Klicke unten auf „Verifizieren“, um ein kurzes Formular zu öffnen. Nach erfolgreicher Prüfung bekommst du deine Rolle und kannst alle Kanäle sehen.',
    color: '#8b82ff',
    authorName: 'FALLEN HEAVEN · VERIFIZIERUNG',
    footerText: 'FALLEN HEAVEN · Sicherheitsprüfung',
    timestamp: true,
    fields: [
      { name: 'Nur für dich sichtbar', value: 'Das Formular erscheint nur in deinem Chat – niemand anderes sieht deine Antworten.', inline: true },
      { name: 'Kein Passwort', value: 'Gib niemals Passwort, E-Mail oder Token weiter. Der Bot fragt danach nie.', inline: true }
    ]
  }]
});

const normalizePanelAttachment = (value) => {
  if (!value || typeof value !== 'object') return null;
  const url = String(value.url || '').trim();
  if (!url) return null;
  return {
    id: String(value.id || ''),
    url,
    name: String(value.name || 'fallen-heaven-verify.png'),
    size: Math.max(0, Number(value.size || 0))
  };
};

const verifyPanelDesign = (cfg) => {
  const design = cfg?.panelTemplate;
  return design && typeof design === 'object' && Array.isArray(design.embeds) && design.embeds.length
    ? design
    : defaultPanelDesign();
};

const panelEmbed = (cfg) => {
  const design = verifyPanelDesign(cfg);
  const source = Array.isArray(design.embeds) && design.embeds.length ? design.embeds[0] : {};
  const builder = new EmbedBuilder()
    .setColor(String(source.color || '#8b82ff').replace(/^#/, '').match(/^[0-9a-f]{6}$/i) ? Number.parseInt(String(source.color).replace(/^#/, ''), 16) : 0x8b82ff)
    .setAuthor({ name: String(source.authorName || 'FALLEN HEAVEN · VERIFIZIERUNG').slice(0, 256) });
  if (source.title) builder.setTitle(String(source.title).slice(0, 256));
  if (source.url) builder.setURL(String(source.url));
  if (source.description) builder.setDescription(String(source.description).slice(0, 4096));
  if (source.thumbnailUrl && isAllowedEmbedImageUrl(source.thumbnailUrl)) builder.setThumbnail(String(source.thumbnailUrl));
  if (source.imageUrl && isAllowedEmbedImageUrl(source.imageUrl)) builder.setImage(String(source.imageUrl));
  if (source.footerText) builder.setFooter({ text: String(source.footerText).slice(0, 2048), iconURL: source.footerIconUrl ? String(source.footerIconUrl) : undefined });
  if (source.timestamp !== false) builder.setTimestamp();
  if (Array.isArray(source.fields)) builder.addFields(source.fields.slice(0, 25).map((field) => ({
    name: String(field.name || '\u200b').slice(0, 256),
    value: String(field.value || '\u200b').slice(0, 1024),
    inline: Boolean(field.inline)
  })));
  return builder;
};

const panelComponents = (cfg) => {
  const texts = verifyTexts(settings(cfg));
  const context = verifyContext(cfg);
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('fh_verify:start').setLabel(formatVerifyText(texts.panelStartButton, context)).setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('fh_verify:stats').setLabel(formatVerifyText(texts.panelStatsButton, context)).setEmoji('📊').setStyle(ButtonStyle.Secondary)
  )];
};
const verifyContext = (cfg, extra = {}) => ({
  guild: '',
  server: '',
  user: '',
  username: '',
  validMinutes: '5',
  task: '',
  attempts: '',
  maxAttempts: String(MAX_ATTEMPTS),
  lockMinutes: String(LOCK_MS / 60000),
  member: '',
  answers: '',
  verifiedTotal: '0',
  verifiedToday: '0',
  approvedTotal: '0',
  flaggedTotal: '0',
  bannedTotal: '0',
  kickedTotal: '0',
  pending: '0',
  awaiting: '0',
  ...extra
});

const panelLocks = new Map();
const ensurePanel = async (guild, cfg, options = {}) => {
  const conf = settings(cfg);
  if (!conf.enabled || !conf.panelChannelId) return null;
  if (panelLocks.has(guild.id)) return panelLocks.get(guild.id);
  const operation = (async () => {
    const channel = guild.channels.cache.get(conf.panelChannelId) || await guild.channels.fetch(conf.panelChannelId).catch(() => null);
    if (!channel?.isTextBased?.() || channel.isThread?.()) return null;
    const store = await loadStore();
    const entry = guildState(store, guild.id);
    let message = entry.panelMessageId ? await channel.messages.fetch(entry.panelMessageId).catch(() => null) : null;
    const design = verifyPanelDesign(conf);
    const payload = {
      content: String(options.content !== undefined ? options.content : design.content || '').slice(0, 2000) || undefined,
      embeds: [panelEmbed(conf)],
      components: panelComponents(conf),
      allowedMentions: { parse: [] }
    };
    if (options.outsideFile) {
      payload.files = [{ attachment: options.outsideFile, name: String(options.outsideImageName || 'fallen-heaven-verify.png').replace(/[^a-z0-9._-]/gi, '_').slice(-120) }];
      payload.attachments = [];
    } else if (options.preserveAttachment) {
      // Kein neues Bild, aber ein persistierter Anhang: Anhang der bestehenden
      // Panel-Nachricht erhalten, statt ihn durch „attachments: []“ zu löschen.
      payload.attachments = [{ id: String(options.preserveAttachment.id || '') }];
    } else if (options.removeOutsideImage === true) {
      payload.attachments = [];
    }
    if (message?.editable) await message.edit(payload);
    else message = await channel.send(payload);
    await mutateStore((latest) => {
      guildState(latest, guild.id).panelMessageId = message.id;
    });
    return message;
  })().finally(() => panelLocks.delete(guild.id));
  panelLocks.set(guild.id, operation);
  return operation;
};

const serializePanelOutsideImage = (message) => {
  const attachment = message?.attachments?.first?.();
  if (!attachment) return null;
  return {
    id: String(attachment.id || ''),
    url: String(attachment.url || ''),
    name: String(attachment.name || 'fallen-heaven-verify.png'),
    size: Number(attachment.size || 0)
  };
};

const resolveVerifyPanelImagePreservation = ({ sourceOutsideImage = '', removeOutsideImage = false, incomingAttachment = null, previousDesign = null } = {}) => {
  const previousUrl = String(previousDesign?.outsideImageUrl || '').trim();
  const previousAttachment = normalizePanelAttachment(previousDesign?.outsideImageAttachment);
  const normalizedIncoming = normalizePanelAttachment(incomingAttachment);
  if (removeOutsideImage) return { outsideImageUrl: '', outsideImageAttachment: null };
  if (sourceOutsideImage) return { outsideImageUrl: sourceOutsideImage, outsideImageAttachment: null };
  if (normalizedIncoming) return { outsideImageUrl: '', outsideImageAttachment: normalizedIncoming };
  if (previousAttachment) return { outsideImageUrl: previousUrl, outsideImageAttachment: previousAttachment };
  return { outsideImageUrl: previousUrl || '', outsideImageAttachment: null };
};

export const saveVerifyPanelDesign = async ({ guild, cfg = {}, template = {} } = {}) => {
  if (!guild) throw new Error('Server wurde nicht gefunden.');
  const conf = settings(cfg);
  const embeds = Array.isArray(template?.embeds) && template.embeds.length ? template.embeds : [template?.embed || {}];
  if (embeds.length !== 1) throw new Error('Das Verify-Embed verwendet genau ein automatisch gepflegtes Embed.');
  const sourceOutsideImage = String(template?.outsideImageUrl || '').trim();
  const dataImageMatch = sourceOutsideImage.match(/^data:(image\/(?:png|jpe?g|webp|gif));base64,([a-z0-9+/=\r\n]+)$/i);
  let outsideFile = dataImageMatch ? Buffer.from(dataImageMatch[2], 'base64') : null;
  if (sourceOutsideImage.startsWith('data:') && !outsideFile) throw new Error('Das ausgewählte Außenbild ist keine gültige PNG-, JPG-, WEBP- oder GIF-Datei.');
  if (outsideFile && outsideFile.length > 25 * 1024 * 1024) throw new Error('Das Außenbild darf maximal 25 MB groß sein.');
  // Lokal gespeichertes Bild (Studio lädt es beim Auswählen einmal auf den PC):
  // Datei lesen und als normalen Discord-Anhang senden – ohne Kanal.
  if (!outsideFile && template?.outsideImageAttachment?.localAsset === true) {
    const local = await readLocalImage(template.outsideImageAttachment);
    if (!local) throw new Error('Das lokale Außenbild wurde nicht gefunden. Bitte wähle es erneut aus.');
    outsideFile = local.buffer;
    template.outsideImageName = local.name;
  }
  const preserved = resolveVerifyPanelImagePreservation({
    sourceOutsideImage: outsideFile ? '' : sourceOutsideImage,
    removeOutsideImage: template?.removeOutsideImage === true,
    incomingAttachment: outsideFile ? null : template?.outsideImageAttachment,
    previousDesign: conf?.panelTemplate
  });
  const normalizedTemplate = {
    content: String(template?.content || ''),
    outsideImageUrl: preserved.outsideImageUrl,
    outsideImageAttachment: preserved.outsideImageAttachment,
    embeds: embeds.slice(0, 1).map((embed) => ({
      title: embed.title || '', url: embed.url || '', description: embed.description || '', color: embed.color || '#8b82ff',
      authorName: embed.authorName || '', authorIconUrl: embed.authorIconUrl || '', thumbnailUrl: embed.thumbnailUrl || '',
      imageUrl: embed.imageUrl || '', footerText: embed.footerText || '', footerIconUrl: embed.footerIconUrl || '',
      timestamp: embed.timestamp !== false, fields: Array.isArray(embed.fields) ? embed.fields.slice(0, 25) : []
    }))
  };
  const message = await ensurePanel(guild, cfg, {
    content: normalizedTemplate.content,
    outsideFile,
    outsideImageName: String(template?.outsideImageName || 'fallen-heaven-verify.png'),
    preserveAttachment: outsideFile || template?.removeOutsideImage === true ? null : normalizePanelAttachment(conf?.panelTemplate?.outsideImageAttachment),
    removeOutsideImage: template?.removeOutsideImage === true
  }).catch((error) => {
    if (outsideFile) throw error;
    console.warn(`[memberVerify] Panel-Update beim Design-Save fehlgeschlagen: ${error?.message || error}`);
    return null;
  });
  if (outsideFile) {
    let attachment = serializePanelOutsideImage(message);
    if (!attachment && message?.channelId) {
      // Falls Discord den Anhang beim ersten Zugriff noch nicht auflistet,
      // einmal frisch nachladen (force), damit die CDN-URL des hochgeladenen
      // Bildes zuverlässig in der Konfiguration landet (wie beim Top-Booster).
      const channel = guild.channels.cache.get(message.channelId) || await guild.channels.fetch(message.channelId).catch(() => null);
      const fresh = channel?.messages ? await channel.messages.fetch({ message: message.id, force: true }).catch(() => null) : null;
      attachment = serializePanelOutsideImage(fresh);
    }
    if (!attachment) throw new Error('Das Außenbild wurde nicht als Discord-Anhang bestätigt. Bitte erneut speichern.');
    normalizedTemplate.outsideImageUrl = attachment.url;
    normalizedTemplate.outsideImageAttachment = attachment;
  }
  return {
    template: normalizedTemplate,
    channelId: conf.panelChannelId || '',
    panel: message ? { messageId: message.id, channelId: String(message.channelId || conf.panelChannelId || '') } : null
  };
};

const logChannel = async (guild, cfg) => {
  const channelId = String(cfg?.logChannelId || '').trim();
  if (!channelId) return null;
  return guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
};
const ownerPingRole = (guild, cfg) => cfg?.ownerPingRoleId ? guild.roles.cache.get(cfg.ownerPingRoleId) || null : null;

const decisionRow = (userId, pending = false, cfg = {}) => {
  const texts = verifyTexts(settings(cfg));
  const context = verifyContext(cfg);
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`fh_verify:approve:${userId}`).setLabel(formatVerifyText(pending ? texts.decisionApprovePending : texts.decisionApproveDone, context)).setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`fh_verify:ban:${userId}`).setLabel(formatVerifyText(texts.decisionBan, context)).setEmoji('⛔').setStyle(ButtonStyle.Danger)
  )];
};
const disabledRow = (userId, resolved, cfg = {}) => {
  const texts = verifyTexts(settings(cfg));
  const context = verifyContext(cfg);
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`fh_verify:approve:${userId}`).setLabel(formatVerifyText(resolved === 'approved' ? texts.decisionApproveResolved : texts.decisionApprovePending, context)).setEmoji('✅').setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId(`fh_verify:ban:${userId}`).setLabel(formatVerifyText(resolved === 'banned' ? texts.decisionBanResolved : texts.decisionBan, context)).setEmoji('⛔').setStyle(ButtonStyle.Secondary).setDisabled(true)
  )];
};

const memberInfoFields = (member) => [
  { name: 'Mitglied', value: member?.user ? `<@${member.id}> · ${member.user.username}` : member?.id ? `<@${member.id}>` : 'Unbekannt', inline: false },
  { name: 'Konto erstellt', value: member?.user?.createdAt ? `<t:${Math.round(member.user.createdAt.getTime() / 1000)}:R>` : 'Unbekannt', inline: true },
  { name: 'Beigetreten', value: member?.joinedAt ? `<t:${Math.round(member.joinedAt.getTime() / 1000)}:R>` : 'Unbekannt', inline: true }
];

const logSuspicious = async ({ guild, member, cfg, flags, autoBan, reason }) => {
  const channel = await logChannel(guild, cfg);
  if (!channel) return;
  const flagsText = flags.map((flag) => `• ${flag.label}`).join('\n');
  const embed = new EmbedBuilder()
    .setColor(autoBan ? 0xff6b86 : 0xffbd59)
    .setAuthor({ name: autoBan ? 'AUTOMATISCH GEBANNT' : 'VERDÄCHTIGES KONTO', iconURL: member?.user?.displayAvatarURL?.() })
    .setTitle(member?.user?.username || member?.id || 'Unbekannt')
    .setDescription(reason)
    .addFields(...memberInfoFields(member), { name: 'Erkannte Merkmale', value: flagsText || 'Keine', inline: false })
    .setThumbnail(member?.user?.displayAvatarURL?.() || null)
    .setTimestamp();
  if (member?.user?.avatar) embed.setDescription(`${reason}\nAvatar: ${member.user.displayAvatarURL({ size: 128 })}`);
  const content = autoBan ? '' : `${ownerPingRole(guild, cfg) ? `${ownerPingRole(guild, cfg)} ` : ''}Neues Konto geprüft – Team-Entscheidung nötig.`;
  await channel.send({ content: content || undefined, embeds: [embed], components: autoBan ? disabledRow(member?.id, 'banned', cfg) : decisionRow(member?.id, false, cfg), allowedMentions: { parse: ['roles', 'users'] } })
    .catch((error) => quietLog(QUIET_LOG_SCOPE.memberVerify, error, `Team-Entscheidungs-Embed fehlgeschlagen: User ${member?.id}`));
};

const logAction = async ({ guild, cfg, color, title, description, fields = [] }) => {
  const channel = await logChannel(guild, cfg);
  if (!channel) return;
  const embed = new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).addFields(...fields).setTimestamp();
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
};

const resolveReminderChannel = async (guild, cfg) => {
  const channelId = String(cfg?.reminderChannelId || '').trim() || String(cfg?.panelChannelId || '').trim();
  if (!channelId) return null;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  return channel?.isTextBased?.() && !channel.isThread?.() ? channel : null;
};

// Voll-Mitglieder-Fetch nur gedrosselt (alle 10 Minuten) – der Gateway-Cache
// ist nach dem Start vollständig und wird durch Joins/Leaves live gepflegt.
// Ein `guild.members.fetch()` pro Minute (bei offenen Erinnerungen) war ein
// unnötiger REST-Vollabruf und kollidierte mit anderen Hintergrund-Scans.
const REMINDER_MEMBER_FETCH_THROTTLE_MS = 10 * 60_000;
const reminderMemberFetchAt = new Map();

const reminderTick = async ({ guild, cfg }) => {
  const conf = settings(cfg);
  const rs = reminderSettings(cfg, conf);
  if (!conf.enabled || !rs.enabled) return;
  const channel = await resolveReminderChannel(guild, conf);
  if (!channel) return;

  const store = await loadStore();
  const entry = guildState(store, guild.id);
  const candidates = Object.keys(entry.pending || {});
  if (!candidates.length) return;

  const phrases = reminderPhrases(conf);
  // Cache zuerst – nur wenn er unvollständig ist (z. B. direkt nach dem Start)
  // und der Throttle abgelaufen ist, wird einmal komplett nachgeladen.
  const guildKey = String(guild.id);
  const lastFetchAt = reminderMemberFetchAt.get(guildKey) || 0;
  const cacheLikelyComplete = guild.members.cache.size >= Math.max(1, Number(guild.memberCount || 0) - 5);
  let members = guild.members.cache;
  if (!cacheLikelyComplete && Date.now() - lastFetchAt >= REMINDER_MEMBER_FETCH_THROTTLE_MS) {
    reminderMemberFetchAt.set(guildKey, Date.now());
    members = await guild.members.fetch().catch(() => guild.members.cache);
  }
  let changed = false;

  for (const userId of candidates) {
    const record = entry.pending[userId];
    if (!record || record.awaitingApproval || record.verified) continue;
    const member = members?.get?.(userId) || await guild.members.fetch(userId).catch(() => null);
    if (!member || member.user?.bot) continue;
    if (isVerified(member, conf)) {
      record.verified = true;
      clearReminderState(store, guild.id, userId);
      changed = true;
      continue;
    }

    const base = Number(record.joinedAtForReminders) || (member.joinedAt ? Number(new Date(member.joinedAt)) : Date.now());
    const earned = earnedReminderCount({ joinedAt: base, now: Date.now(), delayMs: rs.delayMs });
    if (earned <= Number(record.reminderSent || 0)) continue;

    const total = earned;
    if (total > rs.maxReminders) {
      const reason = `Nicht verifiziert nach ${rs.maxReminders} Erinnerungen`;
      if (member?.kick) {
        await member.kick(reason)
          .catch((error) => quietLog(QUIET_LOG_SCOPE.memberVerify, error, `Kick nach Verifizierung fehlgeschlagen: User ${userId}`));
        await mutateStore((store) => { bumpStats(store, guild.id, 'kickedTotal'); });
      }
      delete entry.pending[userId];
      await logAction({
        guild, cfg: conf, color: 0xff6b86, title: 'Nicht verifiziert – gekickt',
        description: `<@${userId}> hat sich nach ${rs.maxReminders} Erinnerungen nicht verifiziert und wurde gekickt.`
      });
      changed = true;
      continue;
    }

    const phrase = phrases[Math.floor(Math.random() * phrases.length)] || builtinReminderPhrases[0];
    const content = String(phrase).replaceAll('{user}', `<@${userId}>`).slice(0, 2000);
    await channel.send({
      content,
      allowedMentions: { parse: ['users'], roles: [], repliedUser: false }
    }).then(() => {
      record.reminderSent = total;
      changed = true;
    }).catch(() => null);
  }

  if (changed) await mutateStore((latest) => {
    const latestEntry = guildState(latest, guild.id);
    // Nur die Reminder-Felder zurückschreiben – die übrigen Felder der
    // Pending-Records (Challenge, Antworten) dürfen nicht überschrieben werden.
    for (const [userId, record] of Object.entries(entry.pending)) {
      const target = latestEntry.pending[userId];
      if (!target) continue;
      if (record.verified) target.verified = true;
      if (record.reminderSent !== undefined) target.reminderSent = record.reminderSent;
      if (record.joinedAtForReminders !== undefined) target.joinedAtForReminders = record.joinedAtForReminders;
      if (record.awaitingApproval === true) target.awaitingApproval = true;
    }
    for (const userId of Object.keys(latestEntry.pending)) {
      if (!entry.pending[userId]) delete latestEntry.pending[userId];
    }
  });
};

const reminderTimers = new Map();
const ensureReminderTimer = (guild, cfg) => {
  const existing = reminderTimers.get(guild.id);
  if (existing) return existing;
  const timer = setInterval(() => {
    void Promise.resolve(reminderTick({ guild, cfg })).catch((error) =>
      console.warn(`[memberVerify] Reminder-Tick für ${guild.name} fehlgeschlagen: ${error?.message || error}`));
  }, REMINDER_TICK_MS);
  timer.unref?.();
  reminderTimers.set(guild.id, timer);
  return timer;
};

const sendWelcome = async (guild, member, cfg) => {
  const channelId = String(cfg?.welcomeChannelId || '').trim();
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  const template = String(cfg?.welcomeMessage || 'Willkommen {user} – du wurdest erfolgreich verifiziert!');
  const content = template
    .replaceAll('{user}', `<@${member.id}>`)
    .replaceAll('{guild}', guild.name)
    .replaceAll('{username}', member?.user?.username || '')
    .slice(0, 2000);
  await channel.send({ content, allowedMentions: { parse: ['users'], roles: [], repliedUser: false } }).catch(() => null);
};

const grantVerified = async ({ guild, member, cfg }) => {
  const roleId = String(cfg?.verifiedRoleId || '').trim();
  const unverifiedId = String(cfg?.unverifiedRoleId || '').trim();
  if (roleId || unverifiedId) {
    await applyManagedRolePolicy({
      member,
      addRoleIds: roleId ? [roleId] : [],
      removeRoleIds: unverifiedId ? [unverifiedId] : [],
      reason: 'Mitglieder-Verifizierung · erfolgreich geprüft',
      verify: true,
      requireAll: false
    }).catch((error) => console.warn(`[memberVerify] Rollen für ${member.id} nicht vergeben: ${error?.message || error}`));
  }
  await mutateStore((store) => {
    const record = store?.guilds?.[guild.id]?.pending?.[String(member.id)];
    if (record) {
      record.verified = true;
      clearReminderState(store, guild.id, String(member.id));
    }
    bumpStats(store, guild.id, 'verifiedTotal');
  });
  await sendWelcome(guild, member, cfg);
};

const isTeamMember = (member) => Boolean(
  member?.permissions?.has?.(PermissionFlagsBits.ModerateMembers)
  || member?.permissions?.has?.(PermissionFlagsBits.BanMembers)
  || member?.id === member?.guild?.ownerId
);

const generateChallenge = () => generateVerifyChallenge();

const customQuestions = (cfg) => String(cfg?.customQuestions || '')
  .split('\n').map((line) => line.trim()).filter((line) => line.length >= 3 && line.length <= 300).slice(0, 3);

const MAX_ATTEMPTS = 3;
const LOCK_MS = 15 * 60 * 1000;
const MIN_ANSWER_MS = 1500;

const buildQuizModal = (challenge, questions, cfg = {}) => {
  const meta = taskMeta(challenge.taskId);
  const texts = verifyTexts(settings(cfg));
  const context = verifyContext(cfg, { task: meta?.label || '', validMinutes: '5' });
  const modal = new ModalBuilder().setCustomId(`fh_verify:submit:${challenge.nonce}`).setTitle(formatVerifyText(texts.modalTitle, context).slice(0, 45));
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder()
      .setCustomId('answer')
      .setLabel(String(meta?.modalLabel || formatVerifyText(texts.modalLabel, context)).slice(0, 45))
      .setStyle(TextInputStyle.Short)
      .setMaxLength(16)
      .setRequired(true)
      .setPlaceholder(String(meta?.placeholder || formatVerifyText(texts.modalPlaceholder, context)).slice(0, 100))
  ));
  questions.forEach((question, index) => {
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId(`question_${index}`).setLabel(String(question).slice(0, 45)).setStyle(TextInputStyle.Paragraph).setMaxLength(500).setRequired(false)
    ));
  });
  return modal;
};

const loadPendingRecord = async (guildId, userId) => {
  const store = await loadStore();
  return store?.guilds?.[guildId]?.pending?.[String(userId)] || null;
};

const challengeEmbed = (challenge, cfg = {}) => {
  const texts = verifyTexts(settings(cfg));
  const validMinutes = challenge.issuedAt && challenge.expiresAt
    ? String(Math.max(1, Math.round((Number(challenge.expiresAt) - Number(challenge.issuedAt)) / 60000)))
    : '5';
  const context = verifyContext(cfg, { validMinutes, task: taskMeta(challenge.taskId)?.label || '' });
  const embed = new EmbedBuilder()
    .setColor(0x8b82ff)
    .setAuthor({ name: 'FALLEN HEAVEN · VERIFIZIERUNG' })
    .setTitle(String(challenge.promptTitle || formatVerifyText(texts.challengeTitle, context)).slice(0, 256))
    .setDescription(String(challenge.promptDescription || formatVerifyText(texts.challengeDescription, context)).slice(0, 4096));
  if (challenge.image) embed.setImage('attachment://captcha.png');
  embed.setFooter({ text: formatVerifyText(challenge.kind === 'buttons' ? texts.challengeFooterButtons : texts.challengeFooterText, context).slice(0, 2048) });
  return embed;
};

const buildOptionButton = (option, index, nonce) => {
  const button = new ButtonBuilder().setCustomId(`fh_verify:pick:${nonce}:${index}`).setStyle(ButtonStyle.Secondary);
  if (option.emoji) button.setEmoji(String(option.emoji)).setLabel('\u200b');
  else button.setLabel(String(option.label || `Option ${index + 1}`));
  return button;
};

const runScreening = async ({ member, cfg }) => {
  // Wichtig: Screenings lesen die memberVerify-Sektion, nicht die Gesamt-Config.
  const conf = settings(cfg);
  const flags = screenProfile(member, conf);
  if (!flags.length) return;
  await mutateStore((store) => { bumpStats(store, member.guild.id, 'flaggedTotal'); });
  const hardFlags = flags.filter((flag) => flag.hard);
  const autoBan = conf.autoBanFlaggedNames === true;
  if (hardFlags.length || (autoBan && flags.length)) {
    const reason = hardFlags.length
      ? `Automatischer Bann · ${hardFlags.map((flag) => flag.label).join('; ')}`
      : `Automatischer Bann · ${flags.map((flag) => flag.label).join('; ')}`;
    try {
      if (member?.ban) await member.ban({ reason: reason.slice(0, 500), deleteMessageSeconds: 0 });
      await mutateStore((store) => { bumpStats(store, member.guild.id, 'bannedTotal'); });
      await logSuspicious({ guild: member.guild, member, cfg, flags, autoBan: true, reason: `${reason} · Bann gesetzt` });
    } catch (error) {
      console.warn(`[memberVerify] Bann für ${member.id} fehlgeschlagen:`, error?.message || error);
      await logAction({ guild: member.guild, cfg, color: 0xff6b86, title: 'Bann fehlgeschlagen', description: `${reason}\n${error?.message || 'Unbekannter Fehler'}` });
    }
    return;
  }
  await logSuspicious({ guild: member.guild, member, cfg, flags, autoBan: false, reason: 'Profil weist bot-typische Merkmale auf – Team-Entscheidung nötig.' });
};

const handleApprove = async (interaction, cfg) => {
  const userId = String(interaction.customId.split(':')[2] || '');
  if (!userId) return true;
  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  const pending = await mutateStore((store) => {
    const entry = guildState(store, interaction.guildId);
    const record = entry.pending[userId];
    if (record) delete entry.pending[userId];
    return record || null;
  });
  if (member) {
    if (!isVerified(member, cfg)) {
      await grantVerified({ guild: interaction.guild, member, cfg });
      await logAction({
        guild: interaction.guild, cfg, color: 0x23d5ab, title: 'Mitglied freigegeben',
        description: `<@${member.id}> wurde von <@${interaction.user.id}> verifiziert.${pending?.answers?.length ? `\nAntworten: ${pending.answers.map((answer) => `„${answer || '—'}“`).join(', ')}` : ''}`
      });
    } else {
      await logAction({ guild: interaction.guild, cfg, color: 0x23d5ab, title: 'Mitglied bereits verifiziert', description: `<@${member.id}> wurde von <@${interaction.user.id}> geprüft – Rolle war bereits gesetzt.` });
    }
  }
  await mutateStore((store) => { bumpStats(store, interaction.guildId, 'approvedTotal'); });
  const message = interaction.message;
  if (message?.editable) {
    await message.edit({ components: disabledRow(userId, 'approved', cfg) })
      .catch((error) => quietLog(QUIET_LOG_SCOPE.memberVerify, error, `Verifizierungs-Panel-Edit fehlgeschlagen: User ${userId}`));
  }
  await interaction.reply({ content: member ? `Mitglied ${member.user?.username || userId} wurde verifiziert.` : 'Mitglied ist nicht mehr auf dem Server.', flags: MessageFlags.Ephemeral });
  return true;
};

const handleBan = async (interaction, cfg) => {
  const userId = String(interaction.customId.split(':')[2] || '');
  if (!userId) return true;
  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  if (member?.ban) {
    try {
      await member.ban({ reason: `Manueller Bann durch ${interaction.user.tag} · Verify-Protokoll`, deleteMessageSeconds: 0 });
      await mutateStore((store) => { bumpStats(store, interaction.guildId, 'bannedTotal'); });
      await logAction({ guild: interaction.guild, cfg, color: 0xff6b86, title: 'Mitglied gebannt', description: `<@${userId}> wurde von <@${interaction.user.id}> gebannt.` });
    } catch (error) {
      console.warn(`[memberVerify] Bann für ${userId} fehlgeschlagen:`, error?.message || error);
    }
  }
  const message = interaction.message;
  if (message?.editable) await message.edit({ components: disabledRow(userId, 'banned', cfg) }).catch(() => null);
  await interaction.reply({ content: member ? `Mitglied ${member.user?.username || userId} wurde gebannt.` : 'Mitglied ist nicht mehr auf dem Server.', flags: MessageFlags.Ephemeral });
  return true;
};

const handleStats = async (interaction, cfg) => {
  const store = await loadStore();
  const entry = guildState(store, interaction.guildId);
  const stats = entry.stats || {};
  const pendingCount = Object.values(entry.pending || {}).filter((record) => record && !record.verified).length;
  const awaitingApproval = Object.values(entry.pending || {}).filter((record) => record?.awaitingApproval).length;
  const texts = verifyTexts(settings(cfg));
  const context = verifyContext(cfg, {
    verifiedTotal: String(stats.verifiedTotal || 0),
    verifiedToday: String(stats.verifiedToday || 0),
    approvedTotal: String(stats.approvedTotal || 0),
    flaggedTotal: String(stats.flaggedTotal || 0),
    bannedTotal: String(stats.bannedTotal || 0),
    kickedTotal: String(stats.kickedTotal || 0),
    pending: String(pendingCount),
    awaiting: String(awaitingApproval)
  });
  const embed = new EmbedBuilder()
    .setColor(0x8b82ff)
    .setAuthor({ name: formatVerifyText(texts.statsAuthor, context).slice(0, 256) })
    .setTitle(formatVerifyText(texts.statsTitle, context).slice(0, 256))
    .addFields(
      { name: formatVerifyText(texts.statsVerifiedTotalField, context).slice(0, 256), value: String(stats.verifiedTotal || 0), inline: true },
      { name: formatVerifyText(texts.statsVerifiedTodayField, context).slice(0, 256), value: String(stats.verifiedToday || 0), inline: true },
      { name: formatVerifyText(texts.statsApprovedField, context).slice(0, 256), value: String(stats.approvedTotal || 0), inline: true },
      { name: formatVerifyText(texts.statsFlaggedField, context).slice(0, 256), value: String(stats.flaggedTotal || 0), inline: true },
      { name: formatVerifyText(texts.statsBannedField, context).slice(0, 256), value: String(stats.bannedTotal || 0), inline: true },
      { name: formatVerifyText(texts.statsKickedField, context).slice(0, 256), value: String(stats.kickedTotal || 0), inline: true },
      { name: formatVerifyText(texts.statsPendingField, context).slice(0, 256), value: String(pendingCount), inline: true },
      { name: formatVerifyText(texts.statsAwaitingField, context).slice(0, 256), value: String(awaitingApproval), inline: true }
    )
    .setFooter({ text: formatVerifyText(texts.statsFooter, context).slice(0, 2048) })
    .setTimestamp();
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  return true;
};

const handleStart = async (interaction, cfg) => {
  if (!interaction.inGuild?.()) return true;
  if (isVerified(interaction.member, cfg)) {
    await interaction.reply({ content: 'Du bist bereits verifiziert und hast deine Rolle. 🎉', flags: MessageFlags.Ephemeral });
    return true;
  }
  const challenge = generateChallenge();
  const questions = customQuestions(cfg);
  await mutateStore((store) => {
    const entry = guildState(store, interaction.guildId);
    entry.pending[interaction.user.id] = {
      at: Date.now(),
      taskId: challenge.taskId,
      expected: challenge.expected,
      nonce: challenge.nonce,
      issuedAt: challenge.issuedAt,
      expiresAt: challenge.expiresAt,
      openedAt: challenge.issuedAt,
      attempts: 0,
      questions: challenge.kind === 'text' ? questions : [],
      answers: []
    };
    const ids = Object.keys(entry.pending);
    if (ids.length > MAX_PENDING_PER_GUILD) {
      ids.slice(0, ids.length - MAX_PENDING_PER_GUILD).forEach((id) => delete entry.pending[id]);
    }
  });
  const payload = { embeds: [challengeEmbed(challenge, cfg)], flags: MessageFlags.Ephemeral };
  if (challenge.image) payload.files = [{ attachment: challenge.image, name: 'captcha.png' }];
  if (challenge.kind === 'buttons') {
    payload.components = [new ActionRowBuilder().addComponents(
      ...challenge.options.map((option, index) => buildOptionButton(option, index, challenge.nonce))
    )];
  } else {
    const texts = verifyTexts(settings(cfg));
    const context = verifyContext(cfg, { task: taskMeta(challenge.taskId)?.label || '' });
    payload.components = [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`fh_verify:answer:${challenge.nonce}`).setLabel(formatVerifyText(texts.answerButtonLabel, context).slice(0, 80)).setEmoji('⌨️').setStyle(ButtonStyle.Primary)
    )];
  }
  await interaction.reply(payload);
  return true;
};

const failAttempt = async (interaction, cfg, record, reason) => {
  const userId = interaction.user.id;
  const attempts = Math.floor(Number(record.attempts || 0)) + 1;
  const exhausted = attempts >= MAX_ATTEMPTS;
  await mutateStore((store) => {
    const entry = guildState(store, interaction.guildId);
    const target = entry.pending[userId];
    if (!target) return;
    target.attempts = attempts;
    if (exhausted) {
      target.lockedUntil = Date.now() + LOCK_MS;
      delete target.nonce;
      target.openedAt = 0;
    }
  });
  if (exhausted) {
    const member = interaction.member;
    if (settings(cfg).kickOnFailedVerify !== false && member?.kick) {
      try {
        await member.kick('Zu viele falsche Antworten im Verify-Fragebogen');
        await mutateStore((store) => { bumpStats(store, interaction.guildId, 'kickedTotal'); });
        await logAction({
          guild: interaction.guild, cfg, color: 0xff6b86, title: 'Verify fehlgeschlagen – gekickt',
          description: `<@${userId}> hat ${MAX_ATTEMPTS}× falsch geantwortet und wurde gekickt.`
        });
      } catch (error) {
        console.warn(`[memberVerify] Kick für ${userId} fehlgeschlagen:`, error?.message || error);
      }
    } else {
      await logAction({
        guild: interaction.guild, cfg, color: 0xffbd59, title: 'Verify vorübergehend gesperrt',
        description: `<@${userId}> hat ${MAX_ATTEMPTS}× falsch geantwortet und ist für ${LOCK_MS / 60000} Minuten gesperrt.`
      });
    }
    await interaction.reply({ content: 'Zu viele falsche Versuche. Du kannst es in ca. 15 Minuten erneut versuchen.', flags: MessageFlags.Ephemeral });
  } else {
    const hint = reason === 'too-fast'
      ? 'Du warst zu schnell – lies dir die Aufgabe in Ruhe durch.'
      : `Das war leider nicht richtig (${attempts}/${MAX_ATTEMPTS} Versuche).`;
    await interaction.reply({ content: `${hint} Versuche es noch einmal.`, flags: MessageFlags.Ephemeral });
  }
  return true;
};

const succeedVerify = async (interaction, cfg, record, answers = []) => {
  const userId = interaction.user.id;
  await mutateStore((store) => {
    delete store?.guilds?.[interaction.guildId]?.pending?.[String(userId)];
  });
  const channel = await logChannel(interaction.guild, cfg);
  const needsApproval = settings(cfg).requireTeamApproval !== false && channel;
  const answerText = answers.length
    ? answers.map((entry) => `• **${entry.question}**\n${entry.answer || '—'}`).join('\n')
    : 'Keine zusätzlichen Antworten.';

  if (needsApproval) {
    await mutateStore((store) => {
      const entry = guildState(store, interaction.guildId);
      entry.pending[userId] = { at: Date.now(), answers: answers.map((entry) => entry.answer), awaitingApproval: true };
    });
    const texts = verifyTexts(settings(cfg));
    const context = verifyContext(cfg, {
      member: `<@${userId}>`,
      username: interaction.user.username || String(userId),
      task: taskMeta(record.taskId)?.label || 'Aufgabe',
      answers: answerText,
      guild: interaction.guild?.name || ''
    });
    const embed = new EmbedBuilder()
      .setColor(0xffd061)
      .setAuthor({ name: formatVerifyText(texts.approvalAuthor, context).slice(0, 256), iconURL: interaction.user.displayAvatarURL?.() })
      .setTitle(interaction.user.username)
      .setDescription(formatVerifyText(texts.approvalDescription, context).slice(0, 4096))
      .addFields(
        { name: formatVerifyText(texts.approvalMemberField, context).slice(0, 256), value: `<@${userId}>`, inline: false },
        { name: formatVerifyText(texts.approvalTaskField, context).slice(0, 256), value: `${taskMeta(record.taskId)?.label || 'Aufgabe'} ✓`, inline: false },
        { name: formatVerifyText(texts.approvalAnswersField, context).slice(0, 256), value: answerText, inline: false }
      )
      .setThumbnail(interaction.user.displayAvatarURL?.() || null)
      .setTimestamp();
    const content = `${ownerPingRole(interaction.guild, cfg) ? `${ownerPingRole(interaction.guild, cfg)} ` : ''}Neue Verify-Freigabe von <@${userId}>.`;
    await channel.send({ content, embeds: [embed], components: decisionRow(userId, true, cfg), allowedMentions: { parse: ['roles', 'users'] } }).catch(() => null);
    await interaction.reply({ content: 'Du hast die Aufgabe richtig gelöst. Ein Teammitglied schaltet dich jetzt frei – das dauert meist nur einen Moment.', flags: MessageFlags.Ephemeral });
    return true;
  }

  await grantVerified({ guild: interaction.guild, member: interaction.member, cfg });
  await logAction({
    guild: interaction.guild, cfg, color: 0x23d5ab, title: 'Mitglied automatisch verifiziert',
    description: `<@${userId}> hat die Aufgabe richtig gelöst.\n${answerText}`
  });
  await interaction.reply({ content: '✅ Verifizierung erfolgreich! Du hast deine Rolle bekommen und kannst loslegen. Willkommen!', flags: MessageFlags.Ephemeral });
  return true;
};

const handleAnswer = async (interaction, cfg) => {
  const nonce = String(interaction.customId.split(':')[2] || '');
  const record = await loadPendingRecord(interaction.guildId, interaction.user.id);
  if (!record || String(record.nonce || '') !== nonce || taskMeta(record.taskId)?.kind !== 'text') {
    await interaction.reply({ content: 'Diese Verify-Sitzung ist abgelaufen. Klicke erneut auf „Verifizieren“.', flags: MessageFlags.Ephemeral });
    return true;
  }
  if (Number(record.lockedUntil || 0) > Date.now()) {
    const waitMin = Math.max(1, Math.ceil((Number(record.lockedUntil) - Date.now()) / 60000));
    await interaction.reply({ content: `Zu viele falsche Versuche. Du kannst es in ca. ${waitMin} Min. erneut versuchen.`, flags: MessageFlags.Ephemeral });
    return true;
  }
  if (Number(record.expiresAt || 0) < Date.now()) {
    await interaction.reply({ content: 'Diese Aufgabe ist abgelaufen. Klicke erneut auf „Verifizieren“.', flags: MessageFlags.Ephemeral });
    return true;
  }
  await mutateStore((store) => {
    const entry = guildState(store, interaction.guildId);
    if (entry.pending[interaction.user.id]) entry.pending[interaction.user.id].openedAt = Date.now();
  });
  await interaction.showModal(buildQuizModal(record, record.questions || [], cfg));
  return true;
};

const handlePick = async (interaction, cfg) => {
  const parts = String(interaction.customId).split(':');
  const nonce = String(parts[2] || '');
  const picked = String(parts[3] || '');
  const record = await loadPendingRecord(interaction.guildId, interaction.user.id);
  if (!record || String(record.nonce || '') !== nonce) {
    await interaction.reply({ content: 'Diese Verify-Sitzung ist abgelaufen. Klicke erneut auf „Verifizieren“.', flags: MessageFlags.Ephemeral });
    return true;
  }
  if (Number(record.lockedUntil || 0) > Date.now()) {
    const waitMin = Math.max(1, Math.ceil((Number(record.lockedUntil) - Date.now()) / 60000));
    await interaction.reply({ content: `Zu viele falsche Versuche. Du kannst es in ca. ${waitMin} Min. erneut versuchen.`, flags: MessageFlags.Ephemeral });
    return true;
  }
  if (Number(record.expiresAt || 0) < Date.now()) {
    await interaction.reply({ content: 'Diese Aufgabe ist abgelaufen. Klicke erneut auf „Verifizieren“.', flags: MessageFlags.Ephemeral });
    return true;
  }
  const tooFast = Number(record.openedAt || 0) > 0 && Date.now() - Number(record.openedAt) < MIN_ANSWER_MS;
  const correct = !tooFast && verifyAnswer(record.taskId, record.expected, picked);
  if (correct) return await succeedVerify(interaction, cfg, record, []);
  return await failAttempt(interaction, cfg, record, tooFast ? 'too-fast' : 'wrong');
};

const handleSubmit = async (interaction, cfg) => {
  const userId = interaction.user.id;
  const nonce = String(interaction.customId.split(':')[2] || '');
  const record = await loadPendingRecord(interaction.guildId, userId);
  if (!record || String(record.nonce || '') !== nonce || taskMeta(record.taskId)?.kind !== 'text') {
    await interaction.reply({ content: 'Deine Verify-Sitzung ist abgelaufen. Klicke erneut auf „Verifizieren“.', flags: MessageFlags.Ephemeral });
    return true;
  }
  if (Number(record.lockedUntil || 0) > Date.now()) {
    const waitMin = Math.max(1, Math.ceil((Number(record.lockedUntil) - Date.now()) / 60000));
    await interaction.reply({ content: `Zu viele falsche Versuche. Du kannst es in ca. ${waitMin} Min. erneut versuchen.`, flags: MessageFlags.Ephemeral });
    return true;
  }
  if (Number(record.expiresAt || 0) < Date.now()) {
    await interaction.reply({ content: 'Deine Verify-Sitzung ist abgelaufen. Klicke erneut auf „Verifizieren“.', flags: MessageFlags.Ephemeral });
    return true;
  }
  const submitted = interaction.fields.getTextInputValue('answer') || '';
  const answers = (record.questions || []).map((question, index) => ({
    question,
    answer: interaction.fields.getTextInputValue(`question_${index}`) || ''
  }));
  const tooFast = Number(record.openedAt || 0) > 0 && Date.now() - Number(record.openedAt) < MIN_ANSWER_MS;
  const correct = !tooFast && verifyAnswer(record.taskId, record.expected, submitted);
  if (correct) return await succeedVerify(interaction, cfg, record, answers);
  return await failAttempt(interaction, cfg, record, tooFast ? 'too-fast' : 'wrong');
};

const handleInteraction = async (interaction, cfg) => {
  const id = String(interaction.customId || '');
  if (!id.startsWith('fh_verify:')) return false;
  const conf = settings(cfg);
  if (!conf.enabled) {
    if (interaction.isButton?.()) await interaction.reply({ content: 'Das Verify-Modul ist gerade deaktiviert.', flags: MessageFlags.Ephemeral });
    return true;
  }
  if (interaction.isButton?.() && id === 'fh_verify:start') return await handleStart(interaction, cfg);
  if (interaction.isButton?.() && id === 'fh_verify:stats') return await handleStats(interaction, cfg);
  if (interaction.isButton?.() && id.startsWith('fh_verify:answer:')) return await handleAnswer(interaction, cfg);
  if (interaction.isButton?.() && id.startsWith('fh_verify:pick:')) return await handlePick(interaction, cfg);
  if (interaction.isModalSubmit?.() && id.startsWith('fh_verify:submit:')) return await handleSubmit(interaction, cfg);
  if (interaction.isButton?.() && id.startsWith('fh_verify:approve:')) {
    if (!isTeamMember(interaction.member)) {
      await interaction.reply({ content: 'Für diese Entscheidung brauchst du „Mitglieder moderieren“ oder „Mitglieder bannen“.', flags: MessageFlags.Ephemeral });
      return true;
    }
    return await handleApprove(interaction, cfg);
  }
  if (interaction.isButton?.() && id.startsWith('fh_verify:ban:')) {
    if (!isTeamMember(interaction.member)) {
      await interaction.reply({ content: 'Für diese Entscheidung brauchst du „Mitglieder moderieren“ oder „Mitglieder bannen“.', flags: MessageFlags.Ephemeral });
      return true;
    }
    return await handleBan(interaction, cfg);
  }
  return true;
};

export const feature = {
  id: 'memberVerify',
  name: 'Mitglieder-Verifizierung',
  commands: [],

  async onClientReady({ guild, cfg }) {
    const conf = settings(cfg);
    if (!conf.enabled) return;
    await ensurePanel(guild, cfg).catch((error) => console.warn(`[memberVerify] Panel für ${guild.name} nicht bereit: ${error?.message || error}`));
    const rs = reminderSettings(cfg, conf);
    if (rs.enabled && (conf.reminderChannelId || conf.panelChannelId)) {
      ensureReminderTimer(guild, cfg);
    }
  },

  async onConfigUpdate({ guild, cfg, patch }) {
    if (!patch || !Object.prototype.hasOwnProperty.call(patch, 'memberVerify')) return;
    await ensurePanel(guild, cfg).catch((error) => console.warn(`[memberVerify] Panel-Update fehlgeschlagen: ${error?.message || error}`));
  },

  async onGuildMemberAdd({ member, cfg }) {
    if (!settings(cfg).enabled || !member?.guild || member.user?.bot) return;
    await ensurePanel(member.guild, cfg).catch(() => null);
    if (isVerified(member, cfg)) return;
    const conf = settings(cfg);
    const unverified = resolvedUnverifiedRole(member.guild, cfg);
    if (unverified && !member.roles.cache.has(unverified.id)) {
      await member.roles.add(unverified, 'Mitglieder-Verifizierung · wartet auf Prüfung')
        .catch((error) => quietLog(QUIET_LOG_SCOPE.memberVerify, error, `Unverified-Rolle fehlgeschlagen: User ${member.id}`));
    }
    await mutateStore((store) => {
      trackReminderMember(store, member.guild.id, member);
    });
    if (reminderSettings(cfg, conf).enabled) {
      ensureReminderTimer(member.guild, cfg);
    }
    await runScreening({ member, cfg });
  },

  async onAnyInteraction({ interaction, cfg }) {
    await handleInteraction(interaction, cfg);
  }
};

export const _memberVerifyInternals = {
  settings,
  screenProfile,
  normalizeFlaggedTerms,
  generateChallenge,
  customQuestions,
  buildQuizModal,
  verifyAnswer,
  taskMeta,
  MAX_ATTEMPTS,
  LOCK_MS,
  MIN_ANSWER_MS,
  loadPendingRecord,
  containsLink,
  containsFlaggedTerm,
  longestDigitRun,
  countDigits,
  accountAgeDays,
  bumpStats,
  resolvedVerifiedRole,
  isVerified,
  isTeamMember,
  reminderSettings,
  reminderPhrases,
  earnedReminderCount,
  trackReminderMember,
  clearReminderState,
  verifyPanelDesign,
  defaultPanelDesign,
  saveVerifyPanelDesign,
  verifyTexts,
  formatVerifyText,
  DEFAULT_VERIFY_TEXTS
};
