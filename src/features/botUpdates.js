import path from 'node:path';
import process from 'node:process';
import { readFileSync } from 'node:fs';

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';

import { atomicWriteJson, readJsonWithRecovery } from '../runtime/atomicJsonStore.js';
import { resolveOutsideImageLite } from '../runtime/localImageStore.js';
import { savePersistentEmbedDesign } from '../runtime/persistentEmbedService.js';
import { quietLog, QUIET_LOG_SCOPE } from '../runtime/quietLog.js';

const DATA_DIR = path.resolve(
  String(process.env.FALLEN_HEAVEN_DATA_DIR || '').trim() || path.join(process.cwd(), 'data')
);
const PANEL_FILE = path.join(DATA_DIR, 'bot-updates-panel.json');
const PANEL_PREFIX = 'fh-updates:';
const REPAIR_TICK_MS = 10 * 60_000; // Reparatur prüft alle 10 Minuten, ob das Embed noch existiert.
const botUpdatesRuntimes = new Map();

// App-Version direkt aus der gebündelten package.json (Quellcode + ASAR).
const APP_VERSION = (() => {
  try {
    const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    return String(packageJson?.version || '3.9.0');
  } catch (_error) {
    return '3.9.0';
  }
})();

// Versionierter Changelog: Die echten Neuerungen jeder Version, die das
// Update-Embed über den Platzhalter {changelog} automatisch rendert.
const CHANGELOG_ENTRIES = (() => {
  try {
    const raw = JSON.parse(readFileSync(new URL('../../bot-changelog.json', import.meta.url), 'utf8'));
    const entries = Array.isArray(raw?.entries) ? raw.entries : [];
    return entries
      .map((entry) => ({
        version: String(entry?.version || ''),
        date: String(entry?.date || ''),
        changes: (Array.isArray(entry?.changes) ? entry.changes : [])
          .map((change) => String(change || '').trim())
          .filter(Boolean)
      }))
      .filter((entry) => entry.version);
  } catch (_error) {
    return [];
  }
})();

const changelogForVersion = (version) => {
  const target = String(version || APP_VERSION);
  const exact = CHANGELOG_ENTRIES.find((entry) => entry.version === target);
  return exact || CHANGELOG_ENTRIES[0] || null;
};

const formatChangelog = (version) => {
  const entry = changelogForVersion(version);
  if (!entry?.changes?.length) return 'Noch keine Einträge für diese Version.';
  return entry.changes.map((change) => `• ${change}`).join('\n');
};

export const getLatestChangelogEntry = () => changelogForVersion(APP_VERSION);

const panelQueue = Promise.resolve();
const safeText = (value, fallback = '', max = 4096) => String(value ?? fallback).slice(0, max);

// Blätter-Knöpfe unter dem Update-Embed: ‹ / › wechseln durch die ECHTEN
// Changelog-Einträge (bot-changelog.json). An den Rändern deaktiviert.
// Labels sind editierbare Vorlagen (3.9.222-Prinzip), Platzhalter: {guild}.
const botUpdatesNavigation = (index, total, labels = {}, guildName = '') => {
  const row = new ActionRowBuilder();
  const label = (value, fallback) => String(value ?? fallback)
    .replaceAll('{guild}', guildName || 'Server')
    .replaceAll('{server}', guildName || 'Server')
    .slice(0, 80) || fallback;
  if (total > 1) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${PANEL_PREFIX}prev`)
        .setEmoji('◀')
        .setLabel(label(labels.prevButtonLabel, 'Älter'))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(index >= total - 1),
      new ButtonBuilder()
        .setCustomId(`${PANEL_PREFIX}next`)
        .setEmoji('▶')
        .setLabel(label(labels.nextButtonLabel, 'Neuer'))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(index <= 0)
    );
  }
  return row;
};

const BOT_CHANGE_SLOT_COUNT = 10;
const botChangeLineTemplate = () => Array.from({ length: BOT_CHANGE_SLOT_COUNT }, (_, index) => `• {change${index + 1}}`).join('\n');
const migrateBotUpdatesTemplate = (value) => {
  let result = String(value ?? '').replaceAll('{changelog}', botChangeLineTemplate());
  for (let index = 1; index <= BOT_CHANGE_SLOT_COUNT; index += 1) {
    result = result.replaceAll(`{changeBlock${index}}`, `• {change${index}}`);
  }
  return result;
};
const defaultBotUpdatesFields = () => [
  {
    name: 'Was ist neu',
    value: `📢 **Bot v{version}** – die wichtigsten Neuerungen:\n${botChangeLineTemplate()}`,
    inline: false
  },
  {
    name: 'Bekannte Probleme',
    value: '⚠️ Sollte etwas nicht rund laufen, wird es hier im nächsten Update kommuniziert. Bei Fragen wende dich ans Team.',
    inline: false
  }
];

export const defaultBotUpdatesDesign = () => ({
  content: '',
  outsideImageUrl: '',
  outsideImageAttachment: null,
  embed: {
    title: '🔔 Bot-Update v{version} · Update #{updateCount}',
    url: '',
    description: 'Hier erfährst du, was am Bot gerade neu ist – und was gerade nicht rund läuft.',
    color: '#8b82ff',
    authorName: 'FALLEN HEAVEN',
    authorIconUrl: '',
    thumbnailUrl: '',
    imageUrl: '',
    footerText: 'FALLEN HEAVEN · Updates',
    footerIconUrl: '',
    timestamp: true,
    fields: defaultBotUpdatesFields()
  }
});

export const normalizeBotUpdatesDesign = (value = {}) => {
  const fallback = defaultBotUpdatesDesign();
  // Frisches/leeres Design → kompletter Standard-Inhalt (inkl. Felder).
  if (!value || typeof value !== 'object' || !value.embed || typeof value.embed !== 'object') {
    return fallback;
  }
  const embed = value.embed;
  return {
    content: safeText(migrateBotUpdatesTemplate(value?.content), fallback.content, 2000),
    outsideImageUrl: /^https?:\/\//i.test(String(value?.outsideImageUrl || '')) ? String(value.outsideImageUrl) : '',
    // Migration: Anker-Anhänge (privater „fh-assets“-Kanal) sind abgeschafft.
    // Die CDN-URL bleibt als einfache Bild-URL erhalten – ohne Kanal-Erstellung.
    outsideImageAttachment: value?.outsideImageAttachment && typeof value.outsideImageAttachment === 'object'
      && value.outsideImageAttachment.anchored !== true
      ? {
        id: String(value.outsideImageAttachment.id || ''),
        url: String(value.outsideImageAttachment.url || ''),
        name: String(value.outsideImageAttachment.name || 'fallen-heaven-update.png'),
        size: Math.max(0, Number(value.outsideImageAttachment.size || 0))
      }
      : null,
    embed: {
      title: safeText(migrateBotUpdatesTemplate(embed.title), fallback.embed.title, 256),
      url: /^https?:\/\//i.test(String(embed.url || '')) ? String(embed.url) : '',
      description: safeText(migrateBotUpdatesTemplate(embed.description), fallback.embed.description, 4096),
      color: String(embed.color || fallback.embed.color).slice(0, 16),
      authorName: safeText(migrateBotUpdatesTemplate(embed.authorName), fallback.embed.authorName, 256),
      authorIconUrl: /^https?:\/\//i.test(String(embed.authorIconUrl || '')) ? String(embed.authorIconUrl) : '',
      thumbnailUrl: /^https?:\/\//i.test(String(embed.thumbnailUrl || '')) ? String(embed.thumbnailUrl) : '',
      imageUrl: /^https?:\/\//i.test(String(embed.imageUrl || '')) ? String(embed.imageUrl) : '',
      footerText: safeText(migrateBotUpdatesTemplate(embed.footerText), fallback.embed.footerText, 2048),
      footerIconUrl: /^https?:\/\//i.test(String(embed.footerIconUrl || '')) ? String(embed.footerIconUrl) : '',
      timestamp: embed.timestamp !== false,
      fields: normalizeBotUpdatesFields(embed.fields)
    }
  };
};

// Leere Felder, alte Platzhalter-Texte oder der alte statische Standard-Inhalt
// werden durch echte Standard-Updates ersetzt – damit ein gespeichertes
// Update-Embed nie leer oder „immer gleich“ im Kanal hängt.
const normalizeBotUpdatesFields = (rawFields) => {
  const fields = (Array.isArray(rawFields) ? rawFields : []).slice(0, 21).map((field) => ({
    name: safeText(field?.name, '', 256),
    value: safeText(migrateBotUpdatesTemplate(field?.value), '', 1024),
    inline: field?.inline === true
  })).filter((field) => field.name || field.value);
  if (!fields.length) return defaultBotUpdatesFields();
  const defaults = defaultBotUpdatesFields();
  const isLegacy = (value) => /fülle dieses feld|fuelle dieses feld|trage hier|bitte ausfüllen|bitte ausfuellen|verbesserte websuche/.test(String(value || '').toLowerCase());
  const replaced = fields.map((field) => {
    if (!isLegacy(field.value)) return field;
    // Passenden Standard per Feldname übernehmen (z. B. „Was ist neu“),
    // damit auch gemischte Designs sauber aktualisiert werden.
    const match = defaults.find((candidate) => candidate.name === field.name) || defaults[0];
    return { ...field, name: match.name, value: match.value };
  });
  return replaced;
};

export const normalizeBotUpdatesConfig = (conf = {}) => ({
  enabled: conf?.enabled === true,
  channelId: String(conf?.channelId || '').trim(),
  prevButtonLabel: String(conf?.prevButtonLabel ?? 'Älter').slice(0, 80),
  nextButtonLabel: String(conf?.nextButtonLabel ?? 'Neuer').slice(0, 80),
  design: normalizeBotUpdatesDesign(conf?.design)
});

const parseColor = (value) => {
  const parsed = Number.parseInt(String(value || '#8b82ff').replace('#', ''), 16);
  return Number.isFinite(parsed) ? parsed : 0x8b82ff;
};

const formatPanel = (value, context = {}) => {
  let result = String(value || '');
  for (const [key, replacement] of Object.entries(context)) {
    const token = `{${key}}`;
    if (typeof replacement === 'string' && result.includes(token)) result = result.split(token).join(replacement);
  }
  return result;
};
const buildBotChangeContext = (version) => {
  const entry = changelogForVersion(version);
  const changes = entry?.changes || [];
  const context = {
    version: String(version || APP_VERSION),
    changeCount: String(changes.length),
    changelog: formatChangelog(version)
  };
  for (let index = 1; index <= BOT_CHANGE_SLOT_COUNT; index += 1) {
    const change = changes[index - 1] || '';
    context[`change${index}`] = change;
    context[`changeBlock${index}`] = change ? `• ${change}` : '';
    context[`changeVersion${index}`] = entry?.version || '';
    context[`changeDate${index}`] = entry?.date || '';
  }
  return context;
};

const loadPanelStore = async () => {
  const result = await readJsonWithRecovery(PANEL_FILE, { fallback: { version: 1, guilds: {} }, backupLimit: 3 })
    .catch(() => ({ value: { version: 1, guilds: {} } }));
  const value = result?.value && typeof result.value === 'object' ? result.value : { version: 1, guilds: {} };
  value.version = 1;
  value.guilds ||= {};
  return value;
};

const withPanelQueue = (worker) => {
  const operation = panelQueue.catch(() => {}).then(async () => {
    const store = await loadPanelStore();
    const result = await worker(store);
    await atomicWriteJson(PANEL_FILE, store, { backupLimit: 3 }).catch((error) => {
      quietLog(QUIET_LOG_SCOPE.botUpdates, error, `atomicWriteJson (Panel) fehlgeschlagen`);
    });
    return result;
  });
  return operation;
};

export const buildBotUpdatesPayload = async (guild, cfg, options = {}) => {
  const conf = normalizeBotUpdatesConfig(cfg?.botUpdates);
  const design = conf.design;
  const version = String(options.version || APP_VERSION);
  const updateCount = Math.max(0, Number(options.updateCount || 0));
  const templateContext = { guild: guild?.name || 'Server', updateCount: String(updateCount), ...buildBotChangeContext(version) };
  const pageIndex = Math.max(0, Math.min(CHANGELOG_ENTRIES.length - 1, Math.floor(Number(options.pageIndex || 0))));
  const savedAttachment = design.outsideImageAttachment;
  // Außenbild nach dem Aktivitäts-Liga-Muster: Beim Bearbeiten wird der
  // gespeicherte Anhang per ID referenziert (attachments) – kein CDN-Download,
  // kein Re-Upload, kein Fehler. Neue Bilder aus dem Studio kommen als
  // outsideFile und werden als echter Anhang (files) gesendet.
  const outside = await resolveOutsideImageLite({
    outsideFile: options.outsideFile || null,
    outsideImageName: String(options.outsideImageName || 'fallen-heaven-update.png'),
    defaultImageName: 'fallen-heaven-update.png',
    savedAttachment: savedAttachment && savedAttachment.anchored !== true ? savedAttachment : null,
    preserveAttachment: options.allowAttachmentReference === true,
    removeOutsideImage: options.removeOutsideImage === true
  });
  const content = [
    formatPanel(design.content, templateContext)
  ].filter(Boolean).join('\n').slice(0, 2000);
  const embed = new EmbedBuilder().setColor(parseColor(design.embed.color));
  const title = formatPanel(design.embed.title, templateContext).trim();
  if (title) embed.setTitle(title.slice(0, 256));
  const description = formatPanel(design.embed.description, templateContext).slice(0, 4096);
  if (description) embed.setDescription(description);
  if (design.embed.url) embed.setURL(String(design.embed.url));
  if (design.embed.authorName) embed.setAuthor({
    name: formatPanel(design.embed.authorName, templateContext).slice(0, 256),
    iconURL: design.embed.authorIconUrl || undefined
  });
  if (design.embed.thumbnailUrl) embed.setThumbnail(formatPanel(design.embed.thumbnailUrl, templateContext));
  if (design.embed.imageUrl) embed.setImage(formatPanel(design.embed.imageUrl, templateContext));
  if (design.embed.footerText) embed.setFooter({
    text: formatPanel(design.embed.footerText, templateContext).slice(0, 2048),
    iconURL: design.embed.footerIconUrl || undefined
  });
  if (design.embed.timestamp) embed.setTimestamp();
  const fields = (design.embed.fields || []).map((field) => ({
    name: formatPanel(field?.name, templateContext).slice(0, 256) || '\u200b',
    value: formatPanel(field?.value, templateContext).slice(0, 1024) || '\u200b',
    inline: Boolean(field?.inline)
  }));
  if (fields.length) embed.addFields(fields);
  const payload = {
    content: content || undefined,
    embeds: [embed],
    components: [botUpdatesNavigation(pageIndex, CHANGELOG_ENTRIES.length, { prevButtonLabel: conf.prevButtonLabel, nextButtonLabel: conf.nextButtonLabel }, guild?.name || '')],
    allowedMentions: { parse: [] }
  };
  if (outside.files) {
    // attachments: [] ersetzt beim Edit alte Anhänge statt zu duplizieren.
    payload.files = outside.files;
    payload.attachments = [];
  } else if (outside.attachments) {
    payload.attachments = outside.attachments;
  } else if (options.removeOutsideImage === true) {
    payload.attachments = [];
  }
  return payload;
};

// Sendet das Panel einmal pro Kanal und bearbeitet es danach immer wieder
// (genau ein Embed, wie bei Aktivitäts-Liga und Levelrollen-Panel).
export const ensureBotUpdatesPanel = async ({ guild, cfg, options = {} } = {}) => {
  const conf = normalizeBotUpdatesConfig(cfg?.botUpdates);
  if (!guild?.id || !conf.enabled || !conf.channelId) return { action: 'disabled' };
  const channel = guild.channels.cache.get(conf.channelId) || await guild.channels.fetch(conf.channelId).catch((error) => {
    quietLog(QUIET_LOG_SCOPE.botUpdates, error, `channels.fetch fehlgeschlagen: ${conf.channelId}`);
    return null;
  });
  if (!channel?.isTextBased?.() || !channel.messages?.fetch) return { action: 'channel-unavailable' };
  const permissions = channel.permissionsFor?.(guild.members.me);
  if (!permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.SendMessages)) {
    return { action: 'missing-permission' };
  }
  return withPanelQueue(async (store) => {
    const key = String(guild.id);
    const stored = store.guilds[key] || {};
    // Reparatur-Lauf (Timer): Nachricht existiert noch → nichts tun, kein Edit,
    // kein Zähler-Bump. Nur wenn sie fehlt, wird neu gepostet. Der Existenz-Check
    // geht zuerst über den Gateway-Cache (kein REST-Call), erst wenn die Nachricht
    // dort fehlt, wird einmal von Discord geholt.
    if (options.repair === true && stored.messageId && channel.messages.fetch) {
      const cached = channel.messages.cache?.get?.(stored.messageId);
      const existing = cached || await channel.messages.fetch(stored.messageId).catch((error) => {
        quietLog(QUIET_LOG_SCOPE.botUpdates, error, `messages.fetch (Existing) fehlgeschlagen: ${stored.messageId}`);
        return null;
      });
      if (existing?.editable) return { action: 'ok', messageId: stored.messageId, updateCount: Math.max(0, Number(stored.updateCount || 0)) };
    }
    // Update-Zähler: steigt bei jeder echten Aktualisierung des Update-Embeds,
    // damit der Server sofort sieht, dass es ein neues Update gibt ({updateCount}).
    // Ein Reparatur-Neupost stellt nur den letzten Stand wieder her (kein Bump).
    const nextUpdateCount = options.repair === true
      ? Math.max(0, Number(stored.updateCount || 0))
      : Math.max(0, Number(stored.updateCount || 0)) + 1;
    let message = null;
    if (stored.messageId && channel.messages.fetch) {
      message = await channel.messages.fetch(stored.messageId).catch((error) => {
        quietLog(QUIET_LOG_SCOPE.botUpdates, error, `messages.fetch (Panel) fehlgeschlagen: ${stored.messageId}`);
        return null;
      });
    }
    // Payload erst NACH dem Nachrichten-Fetch bauen – nur beim Bearbeiten darf
    // der gespeicherte Anhang referenziert werden (sonst Discord-400 bei Neu-Send).
    // Das gespeicherte Außenbild liegt unter `botUpdates.design` (normalisiert).
    // „panelDesign“ war ein Legacy-Pfad – mit ihm wurde der Anhang nie gefunden
    // und bei JEDEM Edit neu von der CDN geladen (Bild „sendet und löscht“).
    const savedAttachmentId = String(
      cfg?.botUpdates?.design?.outsideImageAttachment?.id
      || cfg?.botUpdates?.panelDesign?.outsideImageAttachment?.id
      || ''
    );
    const canReferenceAttachment = Boolean(message?.editable && savedAttachmentId
      && typeof message.attachments?.some === 'function'
      && message.attachments.some((attachment) => String(attachment.id) === savedAttachmentId));
    const payload = await buildBotUpdatesPayload(guild, cfg, {
      ...options,
      updateCount: nextUpdateCount,
      pageIndex: Math.max(0, Math.floor(Number(stored.pageIndex || 0))),
      allowAttachmentReference: canReferenceAttachment
    });
    if (message?.editable) {
      const edited = await message.edit(payload)
        .catch((error) => quietLog(QUIET_LOG_SCOPE.botUpdates, error, `Update-Embed-Edit fehlgeschlagen (Guild ${guild.id})`));
      stored.updatedAt = new Date().toISOString();
      stored.updateCount = nextUpdateCount;
      store.guilds[key] = stored;
      return { action: 'updated', messageId: stored.messageId, message: edited || message, updateCount: nextUpdateCount };
    }
    const sent = await channel.send(payload)
      .catch((error) => quietLog(QUIET_LOG_SCOPE.botUpdates, error, `Update-Embed-Send fehlgeschlagen (Guild ${guild.id})`));
    if (!sent) return { action: 'send-failed' };
    store.guilds[key] = {
      channelId: String(channel.id),
      messageId: String(sent.id),
      updatedAt: new Date().toISOString(),
      updateCount: nextUpdateCount,
      pageIndex: Math.max(0, Math.floor(Number(stored.pageIndex || 0)))
    };
    return { action: 'posted', messageId: String(sent.id), message: sent, updateCount: nextUpdateCount };
  });
};

const serializeOutsideImage = (message) => {
  const attachment = message?.attachments?.first?.();
  if (!attachment) return null;
  return {
    id: String(attachment.id || ''),
    url: String(attachment.url || ''),
    name: String(attachment.name || 'fallen-heaven-update.png'),
    size: Number(attachment.size || 0)
  };
};

/* --------------------------------------------------------------------------
   Runtime-Lebenszyklus: Reparatur-Timer, damit das Update-Embed zuverlässig
   im Kanal bleibt – fehlt es (gelöscht, Kanal geleert, Bot-Ausfall), wird es
   automatisch neu gepostet.
   -------------------------------------------------------------------------- */
const ensureBotUpdatesRuntime = (guild) => {
  const id = String(guild?.id || '');
  let runtime = botUpdatesRuntimes.get(id);
  if (!runtime) {
    runtime = { guild, repairTimer: null };
    botUpdatesRuntimes.set(id, runtime);
  }
  runtime.guild = guild;
  return runtime;
};

const stopBotUpdatesRuntime = (runtime) => {
  if (runtime?.repairTimer) { clearInterval(runtime.repairTimer); runtime.repairTimer = null; }
};

const startBotUpdatesRuntime = (runtime, cfg) => {
  const conf = normalizeBotUpdatesConfig(cfg?.botUpdates);
  if (!conf.enabled) { stopBotUpdatesRuntime(runtime); return; }
  if (!runtime.repairTimer) {
    runtime.repairTimer = setInterval(() => {
      void ensureBotUpdatesPanel({ guild: runtime.guild, cfg, options: { repair: true } })
        .catch((error) => console.warn(`[botUpdates] Panel-Reparatur fehlgeschlagen: ${error?.message || error}`));
    }, REPAIR_TICK_MS);
    runtime.repairTimer.unref?.();
  }
};

// Speichert ein Studio-Design für das Bot-Updates-Panel und aktualisiert das
// Live-Panel sofort – über den gemeinsamen „Speichern & Kanal aktualisieren“-Helfer.
// Ein gewählter Kanal aktiviert das Modul dabei automatisch.
export const saveBotUpdatesDesign = async ({ guild, cfg, template = {}, channelId = '' } = {}) => {
  const conf = normalizeBotUpdatesConfig(cfg?.botUpdates);
  const source = template?.design && typeof template.design === 'object' ? template.design : template;
  const nextChannel = String(channelId || source?.channelId || conf.channelId || '').trim();
  const result = await savePersistentEmbedDesign({
    guild,
    cfg,
    template: source,
    options: {
      designId: 'bot-updates',
      designName: 'Bot-Updates',
      defaultColor: '#27c4e8',
      maxFields: 21,
      previousDesign: conf?.design,
      channelId: nextChannel,
      moduleActive: true, // „Kanal gewählt → Panel wird gesendet“ (Modul wird im Wrapper aktiviert)
      autoEnable: false,
      defaultImageName: 'fallen-heaven-update.png',
      buildDesign: ({ source: s, preserved }) => normalizeBotUpdatesDesign({
        ...s,
        outsideImageUrl: preserved.outsideImageUrl,
        outsideImageAttachment: preserved.outsideImageAttachment
      }),
      prepareSyncCfg: ({ cfg: c, design }) => ({
        ...c,
        botUpdates: { ...conf, enabled: conf.enabled || Boolean(nextChannel), design, channelId: nextChannel }
      }),
      sync: async ({ guild: g, cfg: c, options: o }) => ensureBotUpdatesPanel({ guild: g, cfg: c, options: o }),
      serializeAttachment: serializeOutsideImage
    }
  });
  return {
    channelId: nextChannel,
    design: result.design,
    panel: result.status?.message || null,
    status: result.status
  };
};

export const getBotUpdatesStatus = async (guild, cfg) => {
  const conf = normalizeBotUpdatesConfig(cfg?.botUpdates);
  const store = await loadPanelStore();
  const stored = store.guilds?.[String(guild?.id || '')] || {};
  return {
    enabled: conf.enabled,
    channelId: conf.channelId,
    messageId: String(stored.messageId || ''),
    updatedAt: String(stored.updatedAt || ''),
    updateCount: Math.max(0, Number(stored.updateCount || 0)),
    version: APP_VERSION,
    running: false,
    lastError: ''
  };
};

export const feature = {
  id: 'botUpdates',
  name: 'Bot-Updates',

  async onClientReady({ guild, cfg }) {
    const runtime = ensureBotUpdatesRuntime(guild);
    startBotUpdatesRuntime(runtime, cfg);
    await ensureBotUpdatesPanel({ guild, cfg }).catch((error) => console.warn(`[botUpdates] Panel fehlgeschlagen: ${error?.message || error}`));
  },

  async onConfigUpdate({ guild, cfg, patch }) {
    if (!patch || !Object.prototype.hasOwnProperty.call(patch, 'botUpdates')) return;
    const runtime = ensureBotUpdatesRuntime(guild);
    startBotUpdatesRuntime(runtime, cfg);
    await ensureBotUpdatesPanel({ guild, cfg }).catch((error) => console.warn(`[botUpdates] Panel-Update fehlgeschlagen: ${error?.message || error}`));
  },

  // Blätter-Knöpfe: ‹ / › wechseln durch die echten Changelog-Einträge.
  async onAnyInteraction({ interaction, cfg, guild }) {
    if (!interaction.isButton?.() || !String(interaction.customId || '').startsWith(PANEL_PREFIX)) return false;
    const action = String(interaction.customId).slice(PANEL_PREFIX.length);
    if (!['prev', 'next'].includes(action)) return true;
    // SOFORT bestätigen, bevor irgendein Datei-/Payload-Zugriff startet – der
    // Store liegt auf der Daten-Freigabe, deren I/O langsam sein kann. Nach der
    // Bestätigung hat der Handler das 15-Minuten-Fenster für den Panel-Edit;
    // Fehlertexte unten laufen danach automatisch über followUp (ephemer).
    await interaction.deferUpdate().then(() => {}).catch(() => {});
    const conf = normalizeBotUpdatesConfig(cfg?.botUpdates);
    if (!conf.enabled) {
      await interaction.reply({ content: 'Das Bot-Updates-Modul ist gerade deaktiviert.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return true;
    }
    const store = await loadPanelStore();
    const stored = store.guilds?.[String(guild?.id || '')] || {};
    if (!stored.messageId || stored.messageId !== String(interaction.message?.id || '')) {
      await interaction.reply({ content: 'Dieses Update-Embed ist nicht mehr aktuell.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return true;
    }
    let pageIndex = Math.max(0, Math.floor(Number(stored.pageIndex || 0)));
    pageIndex = action === 'prev' ? pageIndex + 1 : pageIndex - 1;
    pageIndex = Math.max(0, Math.min(CHANGELOG_ENTRIES.length - 1, pageIndex));
    const entry = CHANGELOG_ENTRIES[pageIndex];
    if (!entry) {
      await interaction.reply({ content: 'Es gibt keine weiteren Update-Einträge.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return true;
    }
    // Blättern bearbeitet die bestehende Nachricht → der gespeicherte Anhang
    // darf referenziert werden (sonst würde er bei jedem Blättern ersetzt).
    const payload = await buildBotUpdatesPayload(guild, cfg, {
      version: entry.version,
      updateCount: Math.max(0, Number(stored.updateCount || 0)),
      pageIndex,
      allowAttachmentReference: true
    });
    await interaction.message.edit(payload)
      .catch((error) => quietLog(QUIET_LOG_SCOPE.botUpdates, error, 'Update-Embed blättern fehlgeschlagen'));
    await withPanelQueue((panelStore) => {
      const record = panelStore.guilds[String(guild?.id || '')] ||= {};
      record.pageIndex = pageIndex;
    });
    return true;
  }
};

export const _botUpdatesInternals = {
  normalizeBotUpdatesConfig,
  normalizeBotUpdatesDesign,
  defaultBotUpdatesDesign,
  buildBotUpdatesPayload,
  ensureBotUpdatesPanel,
  saveBotUpdatesDesign,
  getBotUpdatesStatus,
  getLatestChangelogEntry,
  formatChangelog,
  botUpdatesNavigation,
  CHANGELOG_ENTRIES,
  ensureBotUpdatesRuntime,
  startBotUpdatesRuntime,
  stopBotUpdatesRuntime,
  APP_VERSION
};
