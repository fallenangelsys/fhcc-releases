import crypto from 'node:crypto';
import path from 'node:path';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder
} from 'discord.js';

import { atomicWriteJson, readJsonWithRecovery } from '../runtime/atomicJsonStore.js';
import { applyManagedRolePolicy } from '../runtime/managedRoleService.js';
import { materializeOutsideImageTemplate } from '../runtime/localImageStore.js';
import { quietLog, QUIET_LOG_SCOPE } from '../runtime/quietLog.js';
import { finiteInteger, resolveAvatarUrl } from '../runtime/utils.js';
import { buildStudioEmbedPayload } from '../runtime/studioEmbedPayload.js';
import { getServerIndexActivityMessages, getServerIndexSnapshot } from '../serverIndexStore.js';
import { getIndexedVoiceLogSessions, runVoiceLogBackfill } from './voiceLogImport.js';
import { DATA_DIR } from '../shared/paths.js';

const DATA_ROOT = DATA_DIR;
const DATA_FILE = path.join(DATA_ROOT, 'activity-race.json');
const DATA_VERSION = 7;
const PANEL_PREFIX = 'fh-activity-race:';
const PING_AUTO_DELETE_MS = 5 * 60_000; // Platzierungs-Pings löschen sich nach 5 Minuten selbst.
const PING_COOLDOWN_MS = 60 * 60_000; // Pro User + Scope: max. 1 Ping pro 60 Minuten.
const TICK_MS = 30_000;
const SAVE_DELAY_MS = 2_000;
const ROLE_RECONCILE_DEBOUNCE_MS = 2_000;
const PANEL_REFRESH_DEBOUNCE_MS = 2_000;
const RETENTION_DAYS = 400;
const INDEX_RECONCILE_MIN_INTERVAL_MS = 60_000;
const INDEX_PAGE_SIZE = 10_000;
// Offline-/Online-Tracking: Der Bot schreibt regelmäßig einen Heartbeat
// (winzige separate Datei – nicht das große activity-race.json). Ist der
// Heartbeat beim Start älter als OFFLINE_GRACE_MS, war der Bot offline. Dann
// wird NUR Chat aus dem Index über das exakte Offline-Fenster nachgezogen.
// Voice-Zeit wird niemals aus der Besetzung beim Neustart abgeleitet: Discord
// liefert keine historischen Voice-States, daher wäre diese Zeit unbeweisbar.
const HEARTBEAT_FILE = path.join(DATA_ROOT, 'activity-race-heartbeat.json');
const OFFLINE_GRACE_MS = 90_000;
const HEARTBEAT_PERSIST_MS = 60_000;
const RECENT_RECONCILE_DAYS = 3;
const TROPHY_EMOJIS = {
  1: { name: 'trophy1', id: '1533907289604493502', fallback: '🥇' },
  2: { name: 'trophy2', id: '1533907288379625673', fallback: '🥈' },
  3: { name: 'trophy3', id: '1533907290753732608', fallback: '🥉' }
};

const ACTIVITY_PERIOD_DEFINITIONS = [
  { key: 'daily', prefix: 'daily', label: 'Tageswertung', colors: { chat: [0xf3c85b, 0xaeb8c8, 0xc78557], voice: [0xffdc74, 0xb9c7df, 0xd19162] } },
  { key: 'weekly', prefix: 'weekly', label: 'Wochenwertung', colors: { chat: [0xb697ff, 0x8f7bc5, 0x9f6d59], voice: [0x956cff, 0x7660bd, 0x956249] } },
  { key: 'monthly', prefix: 'monthly', label: 'Monatswertung', colors: { chat: [0x6fd8ff, 0x72a7bd, 0xa6755c], voice: [0x57b7ff, 0x668fb3, 0x96664f] } }
];
const ACTIVITY_METRIC_DEFINITIONS = [
  { key: 'chat', suffix: 'Chat', label: 'Chat' },
  { key: 'voice', suffix: 'Voice', label: 'Sprachchat' }
];
const placementRoleKey = (period, metric, place, suffix = 'RoleId') => `${period}${metric}${place === 1 ? '' : `Top${place}`}${suffix}`;

export const ACTIVITY_RACE_ROLE_DEFINITIONS = [
  { key: 'separatorRoleId', nameKey: 'separatorRoleName', defaultName: '━━ AKTIVITÄTS-LIGA ━━', color: 0x151729, label: 'Trenner' },
  ...ACTIVITY_PERIOD_DEFINITIONS.flatMap((period) => ACTIVITY_METRIC_DEFINITIONS.flatMap((metric) => [1, 2, 3].map((place) => ({
    key: placementRoleKey(period.prefix, metric.suffix, place),
    nameKey: placementRoleKey(period.prefix, metric.suffix, place, 'RoleName'),
    defaultName: `${place === 1 ? '🥇' : place === 2 ? '🥈' : '🥉'} ${period.label} · ${metric.label} · Platz ${place}`,
    color: period.colors[metric.key][place - 1],
    label: `${period.label} · ${metric.label} · Platz ${place}`,
    period: period.key,
    metric: metric.key,
    place
  }))))
];

const LEGACY_DEFAULT_ROLE_NAMES = new Set([
  '━━ FALLEN ACTIVITY ━━',
  '✦ Daily · Chat', '✦ Daily · Voice',
  '✦ Weekly · Chat', '✦ Weekly · Voice',
  '♛ Monthly · Chat', '♛ Monthly · Voice'
]);

const PERIODS = {
  daily: { label: 'HEUTE', title: 'Heute', color: 0x6fd8ff },
  weekly: { label: 'WOCHENWERTUNG', title: 'Vergangene Woche', color: 0xa98aff },
  monthly: { label: 'MONATSWERTUNG', title: 'Vergangener Monat', color: 0xf2c66d }
};
const PERIOD_COMPLETION_COPY = {
  daily: 'Die Tagesrollen zeigen den aktuellen Stand und wechseln automatisch, sobald sich Platz 1 bis 3 verändern.',
  weekly: 'Die Rollen werden erst am Wochenabschluss für die vollständige Kalenderwoche vergeben.',
  monthly: 'Die Rollen werden erst am Monatsabschluss für den vollständigen Kalendermonat vergeben.'
};
// Editierbare Textbausteine des Liga-Embeds (im Modul konfigurierbar).
// Alle Werte unterstützen Platzhalter ({server}, {period}, {status}, {range},
// {nextEvaluation}, {completion}). Die Ranglisten-Zeile kann zusätzlich
// {marker}, {mention}, {value} und {rank} verwenden.
const DEFAULT_PANEL_TEXTS = () => ({
  completionDaily: PERIOD_COMPLETION_COPY.daily,
  completionWeekly: PERIOD_COMPLETION_COPY.weekly,
  completionMonthly: PERIOD_COMPLETION_COPY.monthly,
  chatFieldName: 'CHAT',
  voiceFieldName: 'SPRACHCHAT',
  nextEvaluationFieldName: 'NÄCHSTE AUSWERTUNG',
  rangeFieldName: 'ZEITRAUM',
  rankingLineTemplate: '{marker} {mention}\n> **{value}**',
  rankingEmptyText: 'Noch keine Aktivität erfasst.',
  rulesButtonLabel: 'REGELN',
  personalButtonLabel: 'MEIN RANG',
  // Beschreibung des Liga-Embeds: Leer lassen = der ausgeschriebene
  // Vollständigkeits-Text der Periode ({completion} → completionDaily/Weekly/
  // Monthly). Eigener Text kann einzelne Platzhalter nutzen.
  panelDescription: ''
});
const panelTexts = (conf) => {
  const defaults = DEFAULT_PANEL_TEXTS();
  return {
    completionDaily: safeText(conf?.completionDaily, defaults.completionDaily, 4_096),
    completionWeekly: safeText(conf?.completionWeekly, defaults.completionWeekly, 4_096),
    completionMonthly: safeText(conf?.completionMonthly, defaults.completionMonthly, 4_096),
    chatFieldName: safeText(conf?.chatFieldName, defaults.chatFieldName, 256),
    voiceFieldName: safeText(conf?.voiceFieldName, defaults.voiceFieldName, 256),
    nextEvaluationFieldName: safeText(conf?.nextEvaluationFieldName, defaults.nextEvaluationFieldName, 256),
    rangeFieldName: safeText(conf?.rangeFieldName, defaults.rangeFieldName, 256),
    rankingLineTemplate: safeText(conf?.rankingLineTemplate, defaults.rankingLineTemplate, 1_024),
    rankingEmptyText: safeText(conf?.rankingEmptyText, defaults.rankingEmptyText, 1_024),
    rulesButtonLabel: safeText(conf?.rulesButtonLabel, defaults.rulesButtonLabel, 80),
    personalButtonLabel: safeText(conf?.personalButtonLabel, defaults.personalButtonLabel, 80),
    panelDescription: safeText(conf?.panelDescription ?? defaults.panelDescription, defaults.panelDescription, 4_096)
  };
};
// Snapshot-Texte mit Fallback auf Defaults – für Tests ohne panelTexts.
const snapshotTexts = (snapshot) => ({
  ...DEFAULT_PANEL_TEXTS(),
  ...(snapshot?.panelTexts || {})
});

const emptyStore = () => ({ version: DATA_VERSION, guilds: {} });
let store = null;
let loadPromise = null;
let saveTimer = null;
let saveQueue = Promise.resolve();
const runtimes = new Map();
const rolePlans = new Map();
const messageGuards = new Map();
// In-Memory-Timer für persistierte Ping-Löschungen (Ledger in der Guild-Data).
// Der Ledger sorgt dafür, dass Platzierungs-Pings auch dann entfernt werden,
// wenn der Bot zum Ablaufzeitpunkt offline war (Catch-up beim nächsten Start/Tick).
const pendingPingDeleteTimers = new Map();

const uniqueIds = (value) => [...new Set((Array.isArray(value) ? value : String(value || '').split(/[\r\n,]+/))
  .map((entry) => String(entry || '').trim()).filter(Boolean))];
const safeRoleName = (value, fallback) => String(value || fallback || '').replace(/\s+/g, ' ').trim().slice(0, 100) || fallback;
const safeText = (value, fallback = '', maximum = 4096) => String(value ?? fallback).slice(0, maximum);
const safeHttpUrl = (value) => {
  const url = String(value || '').trim();
  return /^https?:\/\/[^\s]+$/i.test(url) ? url.slice(0, 2_000) : '';
};
const safeColor = (value, fallback = '#6fd8ff') => {
  const normalized = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized.toLowerCase() : fallback;
};
// Status-Felder des Liga-Embeds: CHAT, SPRACHCHAT, NÄCHSTE AUSWERTUNG, ZEITRAUM.
// Seit 3.9.231 sind sie Teil der editierbaren Studio-Vorlage (Embed-Felder)
// statt hartkodiert im Renderer – man kann Überschriften und Text um die
// Platzhalter herum frei bearbeiten. Der Bot setzt die Ranglisten
// ({chatRanking}, {voiceRanking}), die nächste Auswertung ({nextEvaluation})
// und den Zeitraum ({range}) automatisch ein. Die Namen können über
// {chatFieldName}/{voiceFieldName}/{nextEvaluationFieldName}/{rangeFieldName}
// an die Modul-Felder gekoppelt werden (Default: ausgeschrieben).
const defaultStatusFields = (names = {}) => [
  { name: names.chat ?? 'CHAT', value: '{chatMarker1} {chat1} > **{chatValue1}**\n{chatMarker2} {chat2} > **{chatValue2}**\n{chatMarker3} {chat3} > **{chatValue3}**', inline: true },
  { name: names.voice ?? 'SPRACHCHAT', value: '{voiceMarker1} {voice1} > **{voiceValue1}**\n{voiceMarker2} {voice2} > **{voiceValue2}**\n{voiceMarker3} {voice3} > **{voiceValue3}**', inline: true },
  { name: names.next ?? 'NÄCHSTE AUSWERTUNG', value: '{nextEvaluation}', inline: true },
  { name: names.range ?? 'ZEITRAUM', value: '{range}', inline: true }
];
const defaultPanelDesign = () => ({
  content: '',
  outsideImageUrl: '',
  outsideImageAttachment: null,
  embed: {
    title: '{period}',
    url: '',
    description: '{completion}',
    color: '',
    authorName: 'FALLEN HEAVEN · AKTIVITÄTS-LIGA',
    authorIconUrl: '',
    thumbnailUrl: '',
    imageUrl: '',
    footerText: '{period} · nachvollziehbar und automatisch ausgewertet',
    footerIconUrl: '',
    timestamp: true,
    fields: defaultStatusFields()
  }
});
const normalizePanelAttachment = (value) => {
  if (!value || typeof value !== 'object') return null;
  const id = String(value.id || '').trim();
  const url = safeHttpUrl(value.url);
  if (!id || !url) return null;
  return {
    id,
    url,
    name: String(value.name || 'fallen-heaven-activity.png').replace(/[^a-z0-9._-]/gi, '_').slice(-120),
    size: finiteInteger(value.size, 0, 0, 25 * 1024 * 1024)
  };
};
const normalizePanelDesign = (value = {}) => {
  const fallback = defaultPanelDesign();
  const embed = value?.embed && typeof value.embed === 'object' ? value.embed : {};
  return {
    content: safeText(value?.content, fallback.content, 2_000),
    outsideImageUrl: safeHttpUrl(value?.outsideImageUrl),
    outsideImageAttachment: normalizePanelAttachment(value?.outsideImageAttachment),
    embed: {
      title: safeText(embed.title, fallback.embed.title, 256),
      url: safeHttpUrl(embed.url),
      description: safeText(embed.description, fallback.embed.description, 4_096),
      color: embed.color ? safeColor(embed.color, '') : '',
      authorName: safeText(embed.authorName, fallback.embed.authorName, 256),
      authorIconUrl: safeHttpUrl(embed.authorIconUrl),
      thumbnailUrl: safeHttpUrl(embed.thumbnailUrl),
      imageUrl: safeHttpUrl(embed.imageUrl),
      footerText: safeText(embed.footerText, fallback.embed.footerText, 2_048),
      footerIconUrl: safeHttpUrl(embed.footerIconUrl),
      timestamp: embed.timestamp !== false,
      // Die vier Status-Felder (CHAT, SPRACHCHAT, NÄCHSTE AUSWERTUNG, ZEITRAUM)
      // bleiben immer Teil des Designs – fehlt eines (z. B. in alten Configs),
      // wird es automatisch ergänzt. So ist das komplette Embed im Studio
      // sichtbar und bearbeitbar; der Bot ersetzt nur die Platzhalter.
      fields: (() => {
        const normalizedFields = (Array.isArray(embed.fields) ? embed.fields : [])
          .slice(0, 21)
          .map((field) => ({
            name: safeText(field?.name, '', 256),
            value: safeText(migratePanelFieldValue(field?.value), '', 1_024),
            inline: field?.inline === true
          }))
          .filter((field) => field.name || field.value);
        // Sobald mindestens vier Felder gespeichert sind, besitzt das Studio
        // bereits eine vollständige Nutzer-Vorlage. Dann dürfen umbenannte oder
        // komplett neu gestaltete Status-Felder nicht wieder durch die alten
        // CHAT/SPRACHCHAT-Defaults ergänzt werden (sonst entstehen Duplikate).
        const missing = normalizedFields.length >= defaultStatusFields().length
          ? []
          : defaultStatusFields()
            .filter((field) => !normalizedFields.some((entry) =>
              entry.name === field.name || String(entry.value) === field.value));
        return [...missing, ...normalizedFields].slice(0, 25);
      })()
    }
  };
};
// Entfernt die Nachrichten-Ebene (Content + Außenbild) aus einem Design:
// Wochen- und Monats-Embeds liegen in derselben Nachricht wie das Heute-Embed
// und können deshalb kein eigenes Außenbild oder eigenen Content haben.
const stripPanelMessageParts = (design) => ({
  ...(design || {}),
  content: '',
  outsideImageUrl: '',
  outsideImageAttachment: null
});
const panelDesignKeyForPeriod = (period) => (
  period === 'weekly' ? 'panelDesignWeekly' : period === 'monthly' ? 'panelDesignMonthly' : 'panelDesign'
);
const normalizedRoleName = (conf, definition) => {
  const current = safeRoleName(conf?.[definition.nameKey], definition.defaultName);
  return LEGACY_DEFAULT_ROLE_NAMES.has(current) ? definition.defaultName : current;
};
// Koppelt die Feld-Überschriften an die Modul-Felder (chatFieldName usw.), solange
// das Design noch exakt die Standard-Status-Felder trägt. Sobald der Nutzer ein
// Feld im Embed Studio anpasst (Name/Text geändert oder gelöscht), übernimmt das
// Design die volle Kontrolle – die Modul-Felder wirken dann nur noch über die
// Platzhalter {chatFieldName} usw.
const applyStatusFieldNames = (design, texts) => {
  const defaults = defaultStatusFields();
  const fields = design?.embed?.fields || [];
  const isDefaultSet = fields.length === defaults.length
    && fields.every((field, index) => field?.name === defaults[index].name
      && field?.value === defaults[index].value
      && field?.inline === defaults[index].inline);
  if (!isDefaultSet) return design;
  return {
    ...design,
    embed: {
      ...design.embed,
      fields: defaultStatusFields({
        chat: texts.chatFieldName,
        voice: texts.voiceFieldName,
        next: texts.nextEvaluationFieldName,
        range: texts.rangeFieldName
      })
    }
  };
};
const normalizeConfig = (conf = {}) => {
  const texts = panelTexts(conf);
  return {
    enabled: conf?.enabled === true,
    panelChannelId: String(conf?.panelChannelId || '').trim(),
    ignoredChannelIds: uniqueIds(conf?.ignoredChannelIds),
    excludedRoleIds: uniqueIds(conf?.excludedRoleIds),
    messageCooldownSeconds: finiteInteger(conf?.messageCooldownSeconds, 10, 0, 300),
    duplicateWindowMinutes: finiteInteger(conf?.duplicateWindowMinutes, 10, 0, 1440),
    minimumMessageLength: finiteInteger(conf?.minimumMessageLength, 3, 1, 500),
    voiceMinimumParticipants: finiteInteger(conf?.voiceMinimumParticipants, 1, 1, 20),
    excludeDeafened: conf?.excludeDeafened !== false,
    placementPings: conf?.placementPings !== false,
    placementPingChannelId: String(conf?.placementPingChannelId || '').trim(),
    placementPingLifetimeMinutes: finiteInteger(conf?.placementPingLifetimeMinutes, 5, 1, 60),
    announceCompletedPeriods: conf?.announceCompletedPeriods !== false,
    announcementChannelId: String(conf?.announcementChannelId || '').trim(),
    rankingDisplayCount: finiteInteger(conf?.rankingDisplayCount, 3, 3, 20),
    ...texts,
    panelDesign: applyStatusFieldNames(normalizePanelDesign(conf?.panelDesign), texts),
    // Wochen- und Monats-Embeds erben bis zur ersten eigenen Bearbeitung das
    // Tages-Embed-Design (Backfill). Content und Außenbild bleiben dem Tages-Embed
    // vorbehalten – die Nachricht kann nur EIN Außenbild haben.
    panelDesignWeekly: applyStatusFieldNames(normalizePanelDesign(conf?.panelDesignWeekly ?? stripPanelMessageParts(conf?.panelDesign)), texts),
    panelDesignMonthly: applyStatusFieldNames(normalizePanelDesign(conf?.panelDesignMonthly ?? stripPanelMessageParts(conf?.panelDesign)), texts),
    pingToggleButtonLabel: String(conf?.pingToggleButtonLabel || 'LIGA-PINGS EIN/AUS').slice(0, 80),
    pingInfoDesign: conf?.pingInfoDesign && typeof conf.pingInfoDesign === 'object'
      ? structuredClone(conf.pingInfoDesign)
      : {
          content: '',
          embeds: [{
            title: 'Aktivitäts-Liga · Benachrichtigungen',
            description: 'Du entscheidest selbst, ob du bei Änderungen deiner Liga-Platzierung erwähnt wirst. Mit dem Button kannst du deine persönlichen Liga-Pings jederzeit ein- oder ausschalten.',
            color: '#6fd8ff',
            authorName: '{server}',
            fields: [],
            timestamp: false
          }]
        },
    ...Object.fromEntries(ACTIVITY_RACE_ROLE_DEFINITIONS.flatMap((definition) => [
      [definition.key, String(conf?.[definition.key] || '').trim()],
      [definition.nameKey, normalizedRoleName(conf, definition)]
    ]))
  };
};

const normalizeUserDay = (value = {}) => ({
  messages: finiteInteger(value.messages, 0, 0, Number.MAX_SAFE_INTEGER),
  voiceMilliseconds: finiteInteger(value.voiceMilliseconds, 0, 0, Number.MAX_SAFE_INTEGER)
});
const normalizeHolderIds = (value) => uniqueIds(value).slice(0, 3);
const normalizePendingPingDeletes = (value) => (Array.isArray(value) ? value : [])
  .map((entry) => ({
    channelId: String(entry?.channelId || ''),
    messageId: String(entry?.messageId || ''),
    deleteAt: finiteInteger(entry?.deleteAt, 0, 0, Number.MAX_SAFE_INTEGER)
  }))
  .filter((entry) => entry.channelId && entry.messageId && entry.deleteAt > 0);
const normalizeHolderRange = (value = {}) => ({
  start: /^\d{4}-\d{2}-\d{2}$/.test(String(value?.start || '')) ? String(value.start) : '',
  end: /^\d{4}-\d{2}-\d{2}$/.test(String(value?.end || '')) ? String(value.end) : ''
});
const nextUtcDateKey = (key) => {
  const date = new Date(`${key}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};
const normalizeGuildData = (value = {}) => {
  const days = Object.fromEntries(Object.entries(value?.days || {}).filter(([key]) => /^\d{4}-\d{2}-\d{2}$/.test(key)).map(([key, day]) => [
    key,
    { users: Object.fromEntries(Object.entries(day?.users || {}).map(([userId, user]) => [String(userId), normalizeUserDay(user)])) }
  ]));
  const earliestDay = Object.keys(days).sort()[0] || '';
  const storedCompleteFrom = String(value?.trackingCompleteFrom || '');
  const trackingCompleteFrom = /^\d{4}-\d{2}-\d{2}$/.test(storedCompleteFrom)
    ? storedCompleteFrom
    : earliestDay ? nextUtcDateKey(earliestDay) : '';
  const metricCompleteFrom = value?.trackingCompleteFromByMetric || {};
  return {
    days,
    trackingCompleteFrom,
    trackingCompleteFromByMetric: {
      chat: /^\d{4}-\d{2}-\d{2}$/.test(String(metricCompleteFrom?.chat || ''))
        ? String(metricCompleteFrom.chat)
        : trackingCompleteFrom,
      voice: /^\d{4}-\d{2}-\d{2}$/.test(String(metricCompleteFrom?.voice || ''))
        ? String(metricCompleteFrom.voice)
        : trackingCompleteFrom
    },
    holders: {
      daily: { chat: normalizeHolderIds(value?.holders?.daily?.chat), voice: normalizeHolderIds(value?.holders?.daily?.voice) },
      weekly: { chat: normalizeHolderIds(value?.holders?.weekly?.chat), voice: normalizeHolderIds(value?.holders?.weekly?.voice) },
      monthly: { chat: normalizeHolderIds(value?.holders?.monthly?.chat), voice: normalizeHolderIds(value?.holders?.monthly?.voice) }
    },
    holderRanges: {
      daily: normalizeHolderRange(value?.holderRanges?.daily),
      weekly: normalizeHolderRange(value?.holderRanges?.weekly),
      monthly: normalizeHolderRange(value?.holderRanges?.monthly)
    },
    // Welche abgeschlossenen Wochen/Monate bereits angekündigt wurden – damit
    // jede Abschluss-Ankündigung genau einmal pro Zeitraum erscheint.
    announcedPeriods: {
      weekly: /^\d{4}-\d{2}-\d{2}$/.test(String(value?.announcedPeriods?.weekly || '')) ? String(value.announcedPeriods.weekly) : '',
      monthly: /^\d{4}-\d{2}-\d{2}$/.test(String(value?.announcedPeriods?.monthly || '')) ? String(value.announcedPeriods.monthly) : ''
    },
    panel: {
      channelId: String(value?.panel?.channelId || ''),
      messageId: String(value?.panel?.messageId || ''),
      messages: Object.fromEntries(Object.keys(PERIODS).map((period) => {
        const entry = value?.panel?.messages?.[period] || {};
        return [period, {
          channelId: String(entry?.channelId || value?.panel?.channelId || ''),
          messageId: String(entry?.messageId || (period === 'daily' ? value?.panel?.messageId || '' : ''))
        }];
      })),
      pingInfo: {
        channelId: String(value?.panel?.pingInfo?.channelId || ''),
        messageId: String(value?.panel?.pingInfo?.messageId || ''),
        fingerprint: String(value?.panel?.pingInfo?.fingerprint || '')
      }
    },
    pingOptOuts: Object.fromEntries(
      Object.entries(value?.pingOptOuts || {})
        .map(([userId, disabledAt]) => [String(userId).trim(), String(disabledAt || '')])
        .filter(([userId]) => userId.length > 0 && userId.length <= 100)
    ),
    // Ledger der noch zu löschenden Platzierungs-Pings: übersteht Bot-Ausfälle,
    // damit Pings nicht für immer stehen bleiben, wenn der Bot offline war.
    pendingPingDeletes: normalizePendingPingDeletes(value?.pendingPingDeletes),
    // Letztes Offline-Fenster (Diagnose): der Heartbeat selbst liegt in einer
    // eigenen winzigen Datei, damit activity-race.json nicht minütlich neu
    // geschrieben werden muss.
    runtime: {
      lastOffline: {
        since: String(value?.runtime?.lastOffline?.since || ''),
        until: String(value?.runtime?.lastOffline?.until || '')
      }
    },
    // Persistenter Ping-Cooldown: überlebt Bot-Neustarts damit dieselbe
    // Person nach einem Neustart nicht sofort erneut gepingt wird.
    pingCooldowns: Object.fromEntries(
      Object.entries(value?.pingCooldowns || {})
        .filter(([key, ts]) => typeof ts === 'number' && ts > 0 && (Date.now() - ts) < PING_COOLDOWN_MS * 2)
        .slice(0, 10_000)
    ),
    // Persistenter Ranking-Fingerprint: verhindert Spam nach Neustarts.
    rankingFingerprint: value?.rankingFingerprint && typeof value.rankingFingerprint === 'object'
      ? Object.fromEntries(Object.entries(value.rankingFingerprint).filter(([, v]) => typeof v === 'string'))
      : {},
    indexBackfill: {
      rangeStart: /^\d{4}-\d{2}-\d{2}$/.test(String(value?.indexBackfill?.rangeStart || '')) ? String(value.indexBackfill.rangeStart) : '',
      rangeEnd: /^\d{4}-\d{2}-\d{2}$/.test(String(value?.indexBackfill?.rangeEnd || '')) ? String(value.indexBackfill.rangeEnd) : '',
      indexUpdatedAt: String(value?.indexBackfill?.indexUpdatedAt || ''),
      completedAt: String(value?.indexBackfill?.completedAt || ''),
      analyzedMessages: finiteInteger(value?.indexBackfill?.analyzedMessages, 0, 0, Number.MAX_SAFE_INTEGER),
      creditedMessages: finiteInteger(value?.indexBackfill?.creditedMessages, 0, 0, Number.MAX_SAFE_INTEGER),
      recoveredMessages: finiteInteger(value?.indexBackfill?.recoveredMessages, 0, 0, Number.MAX_SAFE_INTEGER),
      totalRecoveredMessages: finiteInteger(value?.indexBackfill?.totalRecoveredMessages, 0, 0, Number.MAX_SAFE_INTEGER),
      lastError: String(value?.indexBackfill?.lastError || '').slice(0, 500)
    },
    voiceIndexBackfill: {
      channelId: String(value?.voiceIndexBackfill?.channelId || ''),
      channelSource: String(value?.voiceIndexBackfill?.channelSource || ''),
      revision: String(value?.voiceIndexBackfill?.revision || ''),
      rangeStart: /^\d{4}-\d{2}-\d{2}$/.test(String(value?.voiceIndexBackfill?.rangeStart || '')) ? String(value.voiceIndexBackfill.rangeStart) : '',
      rangeEnd: /^\d{4}-\d{2}-\d{2}$/.test(String(value?.voiceIndexBackfill?.rangeEnd || '')) ? String(value.voiceIndexBackfill.rangeEnd) : '',
      sessions: finiteInteger(value?.voiceIndexBackfill?.sessions, 0, 0, Number.MAX_SAFE_INTEGER),
      skippedIncompleteDays: finiteInteger(value?.voiceIndexBackfill?.skippedIncompleteDays, 0, 0, Number.MAX_SAFE_INTEGER),
      completedAt: String(value?.voiceIndexBackfill?.completedAt || '')
    },
    updatedAt: String(value?.updatedAt || '')
  };
};
const normalizeStore = (value) => ({
  version: DATA_VERSION,
  guilds: Object.fromEntries(Object.entries(value?.guilds || {}).map(([guildId, guild]) => [String(guildId), normalizeGuildData(guild)]))
});
const ensureLoaded = async () => {
  if (store) return store;
  if (!loadPromise) loadPromise = readJsonWithRecovery(DATA_FILE, { fallback: emptyStore(), backupLimit: 5 })
    .then((result) => { store = normalizeStore(result.value); return store; })
    .finally(() => { loadPromise = null; });
  return loadPromise;
};
const guildData = async (guildId) => {
  const data = await ensureLoaded();
  data.guilds[String(guildId)] ||= normalizeGuildData();
  return data.guilds[String(guildId)];
};
const flush = async () => {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!store) return;
  const snapshot = JSON.parse(JSON.stringify(store));
  saveQueue = saveQueue.catch(() => null).then(() => atomicWriteJson(DATA_FILE, snapshot, { backupLimit: 5 }));
  await saveQueue;
};
const scheduleSave = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flush().catch((error) => console.warn(`[activityRace] Speichern fehlgeschlagen: ${error?.message || error}`)), SAVE_DELAY_MS);
  saveTimer.unref?.();
};

// ---- Platzierungs-Ping-Löschungen: persistiert + Catch-up ----
// Die Pings löschen sich zwar per Timer selbst, aber ein Timer überlebt keinen
// Bot-Neustart. Deshalb wird jeder Lösch-Termin im Guild-Ledger festgehalten und
// beim Start bzw. Tick nachgeholt – so bleiben keine Pings stehen, wenn der Bot
// zum Ablaufzeitpunkt kurz offline war.
const registerPendingPingDelete = async (guildId, channelId, messageId, deleteAt) => {
  const data = await guildData(guildId);
  const entry = {
    channelId: String(channelId || ''),
    messageId: String(messageId || ''),
    deleteAt: Math.max(0, Math.floor(Number(deleteAt) || 0))
  };
  if (!entry.channelId || !entry.messageId || !entry.deleteAt) return;
  data.pendingPingDeletes ||= [];
  const existing = data.pendingPingDeletes.find((item) => item.channelId === entry.channelId && item.messageId === entry.messageId);
  if (existing) existing.deleteAt = entry.deleteAt;
  else data.pendingPingDeletes.push(entry);
  data.updatedAt = new Date().toISOString();
  scheduleSave();
};
const removePendingPingDelete = async (guildId, channelId, messageId) => {
  const data = await guildData(guildId);
  const before = data.pendingPingDeletes?.length || 0;
  data.pendingPingDeletes = (data.pendingPingDeletes || []).filter((item) => item.channelId !== String(channelId) || item.messageId !== String(messageId));
  if (data.pendingPingDeletes.length !== before) {
    data.updatedAt = new Date().toISOString();
    scheduleSave();
  }
};
const armPendingPingDelete = (runtime, channel, message, messageId, deleteAt) => {
  const id = String(messageId || message?.id || '');
  if (!id) return;
  const key = `${String(channel.id)}:${id}`;
  const previous = pendingPingDeleteTimers.get(key);
  if (previous?.timer) clearTimeout(previous.timer);
  const delay = Math.max(0, Number(deleteAt) - Date.now());
  const timer = setTimeout(() => {
    pendingPingDeleteTimers.delete(key);
    void removePendingPingDelete(runtime.guild.id, channel.id, id);
    const deletion = message?.delete
      ? message.delete()
      : channel.messages?.fetch(id).then((fetched) => fetched.delete());
    void Promise.resolve(deletion).catch(() => null);
  }, delay);
  timer.unref?.();
  pendingPingDeleteTimers.set(key, { timer, guildId: String(runtime.guild.id) });
};
const catchUpPendingPingDeletes = async (runtime) => {
  const data = await guildData(runtime.guild.id);
  const pending = data.pendingPingDeletes || [];
  if (!pending.length) return;
  const now = Date.now();
  const remaining = [];
  let changed = false;
  for (const entry of pending) {
    const channel = runtime.guild.channels.cache.get(entry.channelId);
    if (!channel?.isTextBased?.()) {
      // Kanal existiert nicht mehr – die Nachricht ist damit ebenfalls weg.
      changed = true;
      continue;
    }
    if (entry.deleteAt <= now) {
      // Ablaufzeitpunkt liegt in der Vergangenheit (Bot war offline) – jetzt löschen.
      changed = true;
      try {
        const message = await channel.messages.fetch(entry.messageId).catch(() => null);
        if (message) await message.delete().catch(() => null);
      } catch {
        // Best effort – der Ledger-Eintrag wird trotzdem entfernt.
      }
      continue;
    }
    remaining.push(entry);
    armPendingPingDelete(runtime, channel, null, entry.messageId, entry.deleteAt);
  }
  if (changed) {
    data.pendingPingDeletes = remaining;
    data.updatedAt = new Date().toISOString();
    scheduleSave();
  }
};

const localDateKey = (timestamp = Date.now(), timezone = 'Europe/Berlin') => {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date(timestamp));
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${byType.year}-${byType.month}-${byType.day}`;
  } catch {
    return new Date(timestamp).toISOString().slice(0, 10);
  }
};
const shiftDateKey = (key, days) => {
  const date = new Date(`${key}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const periodStartKey = (period, today) => {
  if (period === 'monthly') return `${today.slice(0, 7)}-01`;
  if (period === 'weekly') {
    const date = new Date(`${today}T00:00:00.000Z`);
    const mondayOffset = (date.getUTCDay() + 6) % 7;
    return shiftDateKey(today, -mondayOffset);
  }
  return today;
};
const nextPeriodLabel = (period, timezone) => {
  const today = localDateKey(Date.now(), timezone);
  const nextKey = period === 'daily'
    ? shiftDateKey(today, 1)
    : period === 'weekly'
      ? shiftDateKey(periodStartKey('weekly', today), 7)
      : shiftDateKey(`${today.slice(0, 7)}-01`, 32).slice(0, 7) + '-01';
  try {
    const localNow = new Date(new Date().toLocaleString('en-US', { timeZone: timezone }));
    const localTarget = new Date(`${nextKey}T00:00:00`);
    const milliseconds = Math.max(0, localTarget.getTime() - localNow.getTime());
    const hours = Math.floor(milliseconds / 3_600_000);
    const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
    return `${hours} Std. ${minutes} Min.`;
  } catch {
    return nextKey;
  }
};

const aggregateRange = (data, start, end) => {
  const users = {};
  for (const [date, day] of Object.entries(data.days || {})) {
    if (date < start || date > end) continue;
    for (const [userId, row] of Object.entries(day?.users || {})) {
      users[userId] ||= { messages: 0, voiceMilliseconds: 0 };
      users[userId].messages += finiteInteger(row.messages, 0, 0, Number.MAX_SAFE_INTEGER);
      users[userId].voiceMilliseconds += finiteInteger(row.voiceMilliseconds, 0, 0, Number.MAX_SAFE_INTEGER);
    }
  }
  return { start, end, users };
};
const aggregatePeriod = (data, period, timezone, today = localDateKey(Date.now(), timezone)) => {
  return aggregateRange(data, periodStartKey(period, today), today);
};
const completedPeriodRange = (period, today) => {
  if (period === 'daily') {
    const previousDay = shiftDateKey(today, -1);
    return { start: previousDay, end: previousDay };
  }
  if (period === 'weekly') {
    const currentWeekStart = periodStartKey('weekly', today);
    const end = shiftDateKey(currentWeekStart, -1);
    return { start: shiftDateKey(end, -6), end };
  }
  const currentMonthStart = `${today.slice(0, 7)}-01`;
  const end = shiftDateKey(currentMonthStart, -1);
  return { start: `${end.slice(0, 7)}-01`, end };
};
const memberIsRankable = (guild, userId) => {
  const member = guild?.members?.cache?.get?.(String(userId));
  return Boolean(member && !member.user?.bot);
};
// Discord-Snowflake → Erstellungs-Zeitstempel in Millisekunden (Discord-Epoch
// 1420070400000). Wird genutzt, um KANÄLE OHNE FETCH auszusortieren: Wenn die
// letzte Nachricht eines Kanals vor dem Zählzeitraum liegt, hat er dort sicher
// 0 Nachrichten – der teure messages.fetch entfällt komplett.
const snowflakeTimestampMs = (snowflake) => {
  const id = String(snowflake || '');
  if (!/^\d{17,20}$/.test(id)) return null;
  try {
    return Number(BigInt(id) >> 22n) + 1420070400000;
  } catch {
    return null;
  }
};
const lastMessageTimestampMs = (channel) => {
  if (channel?.lastMessageId) {
    const timestamp = snowflakeTimestampMs(channel.lastMessageId);
    if (timestamp !== null) return timestamp;
  }
  if (channel?.lastMessage?.createdTimestamp) return Number(channel.lastMessage.createdTimestamp);
  return null;
};
// Voll-Scans aller Mitglieder (guild.members.fetch → Gateway-Opcode 8) sind
// teuer und werden von Discords Gateway rate-limited. Wiederholte 10-Minuten-
// Nachzüge haben dadurch den „Request with opcode 8 was rate limited“-Sturm
// ausgelöst. Nach einem Versuch (erfolgreich ODER rate-limited) gilt eine
// Abkühlzeit: kein erneuter Voll-Scan innerhalb von 15 Minuten.
const MEMBER_CACHE_FETCH_COOLDOWN_MS = 15 * 60_000;
const memberCacheFetchCooldownUntil = new Map();
const ensureCompleteMemberCache = async (guild, { force = false } = {}) => {
  const cached = Number(guild?.members?.cache?.size || 0);
  const expected = Number(guild?.memberCount || 0);
  if (cached > 0 && (!expected || cached >= expected)) return;
  const guildId = String(guild?.id || '');
  if (!force && Date.now() < Number(memberCacheFetchCooldownUntil.get(guildId) || 0)) return;
  await guild?.members?.fetch?.().catch(() => null);
  memberCacheFetchCooldownUntil.set(guildId, Date.now() + MEMBER_CACHE_FETCH_COOLDOWN_MS);
};
const periodIncumbents = (data, period, metric, start, end) => {
  const range = data?.holderRanges?.[period];
  if (!range || range.start !== start || range.end !== end) return [];
  return data?.holders?.[period]?.[metric] || [];
};
// Wettbewerbs-Platzgruppen: gleicher Wert = gleicher Platz (Dense-Ranking).
// Liefert pro Platz (absteigend) die User-IDs – bei Gleichstand gehören mehrere
// User zum selben Platz. Beispiel [100, 100, 90] → [[u1, u2], [u3]]
// (Platz 1: u1+u2, Platz 2: u3). Nur Werte > 0 werden berücksichtigt, damit
// Mitglieder ohne Aktivität nie als Gewinner eingeplant werden.
const placementGroups = (rows, limit = 3) => {
  const groups = [];
  let lastValue = null;
  for (const entry of rows || []) {
    const value = Number(entry?.value || 0);
    if (value <= 0) continue;
    if (lastValue === null || value !== lastValue) {
      if (groups.length >= Math.max(1, Math.floor(Number(limit) || 3))) break;
      groups.push([]);
    }
    groups[groups.length - 1].push(String(entry?.userId || ''));
    lastValue = value;
  }
  return groups;
};
const rankMetric = (guild, aggregate, metric, incumbentIds = []) => {
  const incumbents = normalizeHolderIds(incumbentIds);
  // Voice-Werte auf Minuten runden, damit Users mit gleicher angezeigter Zeit
  // auch denselben Rang/Platz bei Rollenvergabe bekommen.
  const rounding = metric === 'voiceMilliseconds' ? 60000 : 1;
  return Object.entries(aggregate.users || {})
  .filter(([userId]) => memberIsRankable(guild, userId))
  .map(([userId, row]) => ({ userId, value: Math.round(finiteInteger(row?.[metric], 0, 0, Number.MAX_SAFE_INTEGER) / rounding) * rounding }))
  .filter((entry) => entry.value > 0)
  .sort((left, right) => right.value - left.value
    || ((incumbents.indexOf(left.userId) === -1 ? Number.MAX_SAFE_INTEGER : incumbents.indexOf(left.userId))
      - (incumbents.indexOf(right.userId) === -1 ? Number.MAX_SAFE_INTEGER : incumbents.indexOf(right.userId)))
    || left.userId.localeCompare(right.userId));
};
const fullRankMetric = (guild, aggregate, metric) => {
  const rounding = metric === 'voiceMilliseconds' ? 60000 : 1;
  const members = [...(guild?.members?.cache?.values?.() || [])]
    .filter((member) => !member.user?.bot)
    .map((member) => ({
      userId: String(member.id),
      displayName: String(member.displayName || member.user?.globalName || member.user?.username || 'Mitglied'),
      username: String(member.user?.username || ''),
      avatarUrl: resolveAvatarUrl(member, { size: 64, extension: 'png' }),
      value: Math.round(finiteInteger(aggregate?.users?.[member.id]?.[metric], 0, 0, Number.MAX_SAFE_INTEGER) / rounding) * rounding
    }))
    .sort((left, right) => right.value - left.value
      || left.displayName.localeCompare(right.displayName, 'de-DE', { sensitivity: 'base' })
      || left.userId.localeCompare(right.userId));
  let lastValue = null;
  let rank = 0;
  return members.map((entry, index) => {
    if (lastValue === null || entry.value !== lastValue) rank = index + 1;
    lastValue = entry.value;
    return { ...entry, rank, active: entry.value > 0 };
  });
};
const attachFullRankings = (guild, data, snapshot, timezone, today = localDateKey(Date.now(), timezone)) => {
  for (const [period, value] of Object.entries(snapshot?.periods || {})) {
    if (period !== 'daily' && (value?.visible === false || !value?.start || !value?.end)) {
      value.fullChat = [];
      value.fullVoice = [];
      value.memberCount = [...(guild?.members?.cache?.values?.() || [])].filter((member) => !member.user?.bot).length;
      continue;
    }
    const aggregate = period === 'daily'
      ? aggregatePeriod(data, 'daily', timezone, today)
      : aggregateRange(data, value.start, value.end);
    value.fullChat = fullRankMetric(guild, aggregate, 'messages');
    value.fullVoice = fullRankMetric(guild, aggregate, 'voiceMilliseconds');
    value.memberCount = value.fullChat.length;
    value.activeChatMembers = value.fullChat.filter((entry) => entry.active).length;
    value.activeVoiceMembers = value.fullVoice.filter((entry) => entry.active).length;
  }
  return snapshot;
};
const periodSnapshot = (guild, data, conf, period, timezone, today = localDateKey(Date.now(), timezone)) => {
  const aggregate = aggregatePeriod(data, period, timezone, today);
  const chat = rankMetric(guild, aggregate, 'messages', periodIncumbents(data, period, 'chat', aggregate.start, aggregate.end));
  const voice = rankMetric(guild, aggregate, 'voiceMilliseconds', periodIncumbents(data, period, 'voice', aggregate.start, aggregate.end));
  const chatWinnerIds = chat.slice(0, 3).map((entry) => entry.userId);
  const voiceWinnerIds = voice.slice(0, 3).map((entry) => entry.userId);
  return {
    period,
    start: aggregate.start,
    end: aggregate.end,
    chat,
    voice,
    chatWinnerIds,
    voiceWinnerIds,
    chatWinnerId: chatWinnerIds[0] || '',
    voiceWinnerId: voiceWinnerIds[0] || ''
  };
};
const buildSnapshot = (guild, data, conf, timezone) => ({
  measuredAt: new Date().toISOString(),
  timezone,
  periods: Object.fromEntries(Object.keys(PERIODS).map((period) => [period, periodSnapshot(guild, data, conf, period, timezone)]))
});
const completedPeriodSnapshot = (guild, data, period, timezone, today = localDateKey(Date.now(), timezone)) => {
  const range = completedPeriodRange(period, today);
  const chatCompleteFrom = data.trackingCompleteFromByMetric?.chat || data.trackingCompleteFrom;
  const voiceCompleteFrom = data.trackingCompleteFromByMetric?.voice || data.trackingCompleteFrom;
  const fullyTrackedByMetric = {
    chat: Boolean(chatCompleteFrom && range.start >= chatCompleteFrom),
    voice: Boolean(voiceCompleteFrom && range.start >= voiceCompleteFrom)
  };
  const fullyTracked = fullyTrackedByMetric.chat && fullyTrackedByMetric.voice;
  const aggregate = aggregateRange(data, range.start, range.end);
  const rankedChat = rankMetric(guild, aggregate, 'messages', periodIncumbents(data, period, 'chat', range.start, range.end));
  const rankedVoice = rankMetric(guild, aggregate, 'voiceMilliseconds', periodIncumbents(data, period, 'voice', range.start, range.end));
  const chat = fullyTrackedByMetric.chat ? rankedChat : [];
  const voice = fullyTrackedByMetric.voice ? rankedVoice : [];
  return {
    period,
    ...range,
    fullyTracked,
    fullyTrackedByMetric,
    chat,
    voice,
    chatWinnerIds: chat.slice(0, 3).map((entry) => entry.userId),
    voiceWinnerIds: voice.slice(0, 3).map((entry) => entry.userId)
  };
};
const historicalPanelPeriodSnapshot = (guild, data, period, timezone, today = localDateKey(Date.now(), timezone)) => {
  const range = completedPeriodRange(period, today);
  const aggregate = aggregateRange(data, range.start, range.end);
  const chat = rankMetric(guild, aggregate, 'messages', periodIncumbents(data, period, 'chat', range.start, range.end));
  const voice = rankMetric(guild, aggregate, 'voiceMilliseconds', periodIncumbents(data, period, 'voice', range.start, range.end));
  const chatCompleteFrom = data.trackingCompleteFromByMetric?.chat || data.trackingCompleteFrom;
  const voiceCompleteFrom = data.trackingCompleteFromByMetric?.voice || data.trackingCompleteFrom;
  const fullyTrackedByMetric = {
    chat: Boolean(chatCompleteFrom && range.start >= chatCompleteFrom),
    voice: Boolean(voiceCompleteFrom && range.start >= voiceCompleteFrom)
  };
  const fullyTracked = fullyTrackedByMetric.chat && fullyTrackedByMetric.voice;
  const visible = chat.length > 0 || voice.length > 0;
  const chatWinnerIds = chat.slice(0, 3).map((entry) => entry.userId);
  const voiceWinnerIds = voice.slice(0, 3).map((entry) => entry.userId);
  return {
    period,
    ...range,
    historical: true,
    fullyTracked,
    fullyTrackedByMetric,
    partial: visible && !fullyTracked,
    visible,
    chat,
    voice,
    chatWinnerIds,
    voiceWinnerIds,
    chatWinnerId: chatWinnerIds[0] || '',
    voiceWinnerId: voiceWinnerIds[0] || ''
  };
};
const buildAwardSnapshot = (guild, data, conf, timezone, today = localDateKey(Date.now(), timezone)) => ({
  measuredAt: new Date().toISOString(),
  timezone,
  trackingCompleteFrom: data.trackingCompleteFrom,
  periods: {
    // Die Tagesrollen sind echte Live-Titel. Wochen- und Monatsrollen werden
    // dagegen ausschließlich aus vollständig abgeschlossenen Zeiträumen gebildet.
    daily: periodSnapshot(guild, data, conf, 'daily', timezone, today),
    weekly: completedPeriodSnapshot(guild, data, 'weekly', timezone, today),
    monthly: completedPeriodSnapshot(guild, data, 'monthly', timezone, today)
  }
});
const buildPanelSnapshot = (guild, data, conf, timezone, today = localDateKey(Date.now(), timezone)) => {
  // Heute bleibt live. Woche und Monat zeigen dagegen immer den unmittelbar
  // vorherigen abgeschlossenen Kalenderzeitraum, sofern dort Daten existieren.
  // Teilhistorien dürfen angezeigt werden, bleiben für die Rollenvergabe aber
  // gesperrt; buildAwardSnapshot nutzt dafür weiterhin completedPeriodSnapshot.
  const weekly = historicalPanelPeriodSnapshot(guild, data, 'weekly', timezone, today);
  const monthly = historicalPanelPeriodSnapshot(guild, data, 'monthly', timezone, today);
  return {
    measuredAt: new Date().toISOString(),
    timezone,
    rankingDisplayCount: finiteInteger(conf?.rankingDisplayCount, 3, 3, 20),
    panelTexts: panelTexts(conf),
    panelDesign: normalizePanelDesign(conf?.panelDesign),
    panelDesigns: {
      daily: normalizePanelDesign(conf?.panelDesign),
      weekly: normalizePanelDesign(conf?.panelDesignWeekly ?? conf?.panelDesign),
      monthly: normalizePanelDesign(conf?.panelDesignMonthly ?? conf?.panelDesign)
    },
    periods: {
      daily: periodSnapshot(guild, data, conf, 'daily', timezone, today),
      weekly,
      monthly
    }
  };
};

const ensureTrackingWindow = (data, timezone) => {
  if (data.trackingCompleteFrom) return false;
  data.trackingCompleteFrom = shiftDateKey(localDateKey(Date.now(), timezone), 1);
  data.trackingCompleteFromByMetric = {
    chat: data.trackingCompleteFrom,
    voice: data.trackingCompleteFrom
  };
  data.updatedAt = new Date().toISOString();
  scheduleSave();
  return true;
};

const ensureDayUser = (data, timezone, userId, timestamp = Date.now()) => {
  const key = localDateKey(timestamp, timezone);
  data.days[key] ||= { users: {} };
  data.days[key].users[userId] ||= { messages: 0, voiceMilliseconds: 0 };
  return data.days[key].users[userId];
};
const pruneOldDays = (data, timezone) => {
  const cutoff = shiftDateKey(localDateKey(Date.now(), timezone), -RETENTION_DAYS);
  let changed = false;
  for (const key of Object.keys(data.days || {})) {
    if (key < cutoff) { delete data.days[key]; changed = true; }
  }
  return changed;
};

const ignoredChannel = (channel, conf) => {
  const ignored = new Set(conf.ignoredChannelIds);
  return ignored.has(String(channel?.id || ''))
    || ignored.has(String(channel?.parentId || ''))
    || ignored.has(String(channel?.parent?.parentId || ''));
};
const excludedMember = (member, conf) => Boolean(member?.roles?.cache?.some?.((role) => conf.excludedRoleIds.includes(String(role.id))));
const meaningfulMessage = (message, conf) => {
  if (message?.attachments?.size || message?.stickers?.size) return true;
  const normalized = String(message?.content || '')
    .replace(/<@!?\d+>|<@&\d+>|<#\d+>|<a?:\w+:\d+>/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' link ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.replace(/[^\p{L}\p{N}]/gu, '').length >= conf.minimumMessageLength;
};
const messageFingerprint = (message) => String(message?.content || '')
  .toLocaleLowerCase('de-DE')
  .replace(/<@!?\d+>/g, '@user')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 300);
const shouldCountMessage = (message, conf) => {
  if (!conf.enabled || !message?.guild || !message.member || message.author?.bot || message.webhookId) return false;
  if (ignoredChannel(message.channel, conf) || excludedMember(message.member, conf) || !meaningfulMessage(message, conf)) return false;
  const key = `${message.guildId}:${message.author.id}`;
  const now = Number(message.createdTimestamp || Date.now());
  const previous = messageGuards.get(key) || { at: 0, fingerprint: '', fingerprintAt: 0 };
  if (conf.messageCooldownSeconds > 0 && now - previous.at < conf.messageCooldownSeconds * 1000) return false;
  const fingerprint = messageFingerprint(message);
  if (conf.duplicateWindowMinutes > 0 && fingerprint && fingerprint === previous.fingerprint
    && now - previous.fingerprintAt < conf.duplicateWindowMinutes * 60_000) return false;
  messageGuards.set(key, { at: now, fingerprint, fingerprintAt: now });
  return true;
};

const indexedBackfillRange = (timezone, now = Date.now()) => {
  const today = localDateKey(now, timezone);
  const starts = [
    completedPeriodRange('monthly', today).start,
    completedPeriodRange('weekly', today).start,
    periodStartKey('monthly', today),
    today
  ];
  const retentionStart = shiftDateKey(today, -RETENTION_DAYS);
  const start = starts.sort()[0] < retentionStart ? retentionStart : starts.sort()[0];
  return { start, end: today, endExclusive: shiftDateKey(today, 1) };
};
const broadUtcRange = ({ start, endExclusive }) => ({
  startAt: new Date(Date.parse(`${start}T00:00:00.000Z`) - 14 * 60 * 60_000).toISOString(),
  endAt: new Date(Date.parse(`${endExclusive}T00:00:00.000Z`) + 14 * 60 * 60_000).toISOString()
});
const indexedChannelShape = (guild, row) => {
  const current = guild?.channels?.cache?.get?.(String(row?.channelId || ''));
  if (current) return current;
  return {
    id: String(row?.channelId || ''),
    parentId: String(row?.parentChannelId || ''),
    parent: null
  };
};
const createIndexedChatAccumulator = () => ({ days: {}, guards: new Map(), analyzedMessages: 0, creditedMessages: 0 });
const accumulateIndexedChatRecords = ({ guild, conf, timezone, records = [], range, accumulator }) => {
  const state = accumulator || createIndexedChatAccumulator();
  const ordered = [...records].sort((left, right) => String(left.createdAt || '').localeCompare(String(right.createdAt || ''))
    || String(left.id || '').localeCompare(String(right.id || '')));
  for (const row of ordered) {
    state.analyzedMessages += 1;
    const userId = String(row?.authorId || '');
    const member = guild?.members?.cache?.get?.(userId);
    const timestamp = Date.parse(row?.createdAt || '');
    if (!userId || !member || member.user?.bot || row?.authorBot || row?.webhookId || !Number.isFinite(timestamp)) continue;
    const dayKey = localDateKey(timestamp, timezone);
    if (dayKey < range.start || dayKey > range.end) continue;
    if (excludedMember(member, conf) || ignoredChannel(indexedChannelShape(guild, row), conf)) continue;
    const message = {
      content: String(row?.content || ''),
      attachments: { size: Array.isArray(row?.attachments) ? row.attachments.length : 0 },
      stickers: { size: Array.isArray(row?.stickers) ? row.stickers.length : 0 }
    };
    if (!meaningfulMessage(message, conf)) continue;
    const previous = state.guards.get(userId) || { at: 0, fingerprint: '', fingerprintAt: 0 };
    if (conf.messageCooldownSeconds > 0 && timestamp - previous.at < conf.messageCooldownSeconds * 1_000) continue;
    const fingerprint = messageFingerprint(message);
    if (conf.duplicateWindowMinutes > 0 && fingerprint && fingerprint === previous.fingerprint
      && timestamp - previous.fingerprintAt < conf.duplicateWindowMinutes * 60_000) continue;
    state.guards.set(userId, { at: timestamp, fingerprint, fingerprintAt: timestamp });
    state.days[dayKey] ||= {};
    state.days[dayKey][userId] = finiteInteger(state.days[dayKey][userId], 0, 0, Number.MAX_SAFE_INTEGER) + 1;
    state.creditedMessages += 1;
  }
  return state;
};
const reconstructIndexedChatDays = (options) => {
  const state = accumulateIndexedChatRecords({ ...options, accumulator: createIndexedChatAccumulator() });
  return { days: state.days, analyzedMessages: state.analyzedMessages, creditedMessages: state.creditedMessages };
};
const markMetricTrackingCoverage = (data, metric, rangeStart) => {
  const start = String(rangeStart || '');
  if (!['chat', 'voice'].includes(metric) || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return false;
  data.trackingCompleteFromByMetric ||= {
    chat: String(data.trackingCompleteFrom || ''),
    voice: String(data.trackingCompleteFrom || '')
  };
  const previous = String(data.trackingCompleteFromByMetric[metric] || '');
  if (previous && previous <= start) return false;
  data.trackingCompleteFromByMetric[metric] = start;
  return true;
};
const mergeIndexedChatDays = (data, reconstructed, { rangeStart = '' } = {}) => {
  let recoveredMessages = 0;
  let changed = markMetricTrackingCoverage(data, 'chat', rangeStart);
  for (const [dayKey, users] of Object.entries(reconstructed?.days || {})) {
    data.days[dayKey] ||= { users: {} };
    for (const [userId, indexedCount] of Object.entries(users || {})) {
      data.days[dayKey].users[userId] ||= { messages: 0, voiceMilliseconds: 0 };
      const row = data.days[dayKey].users[userId];
      const previous = finiteInteger(row.messages, 0, 0, Number.MAX_SAFE_INTEGER);
      const next = Math.max(previous, finiteInteger(indexedCount, 0, 0, Number.MAX_SAFE_INTEGER));
      if (next > previous) {
        row.messages = next;
        recoveredMessages += next - previous;
        changed = true;
      }
    }
  }
  return { changed, recoveredMessages };
};

const ensureRuntime = (guild, conf = {}) => {
  const id = String(guild.id);
  if (!runtimes.has(id)) runtimes.set(id, {
    guild,
    conf: normalizeConfig(conf),
    timezone: 'Europe/Berlin',
    voiceStates: new Map(),
    voiceLogConfig: {},
    lastVoiceLogRevision: '',
    lastVoiceTickAt: Date.now(),
    lastHeartbeatPersistAt: 0,
    tickTimer: null,
    roleTimer: null,
    panelTimer: null,
    lastPanelAt: 0,
    lastRoleAt: 0,
    lastIndexAttemptAt: 0,
    lastIndexSignature: '',
    indexSyncPromise: null,
    lastDiscordRecoverAt: 0,
    discordRecoverPromise: null,
    panelRunning: false,
    rolesRunning: false,
    lastError: '',
    lastPanelError: '',
    lastRoleError: ''
  });
  const runtime = runtimes.get(id);
  runtime.guild = guild;
  runtime.conf = normalizeConfig(conf);
  return runtime;
};
const voiceStateRow = (state) => ({
  channelId: String(state?.channelId || ''),
  selfDeaf: state?.selfDeaf === true,
  serverDeaf: state?.serverDeaf === true
});
const reconcileVoiceStates = (runtime) => {
  runtime.voiceStates.clear();
  for (const state of runtime.guild?.voiceStates?.cache?.values?.() || []) {
    if (!state?.channelId || state?.member?.user?.bot) continue;
    runtime.voiceStates.set(String(state.id), voiceStateRow(state));
  }
  return runtime.voiceStates;
};
const hydrateVoiceStates = (runtime) => {
  reconcileVoiceStates(runtime);
  runtime.lastVoiceTickAt = Date.now();
};
const voiceEligibility = (runtime, userId, state) => {
  if (!state?.channelId) return false;
  const channel = runtime.guild.channels.cache.get(state.channelId);
  const member = runtime.guild.members.cache.get(userId);
  if (!channel || !member || member.user?.bot || excludedMember(member, runtime.conf) || ignoredChannel(channel, runtime.conf)) return false;
  if (String(runtime.guild.afkChannelId || '') === String(state.channelId)) return false;
  if (runtime.conf.excludeDeafened && (state.selfDeaf || state.serverDeaf)) return false;
  return true;
};

const addVoiceIntervalToDays = (totals, userId, startMs, endMs, timezone) => {
  let cursor = Math.max(0, Number(startMs || 0));
  const end = Math.max(cursor, Number(endMs || 0));
  while (cursor < end) {
    const dayKey = localDateKey(cursor, timezone);
    let boundary = end;
    if (localDateKey(end - 1, timezone) !== dayKey) {
      let low = cursor + 1;
      let high = end;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (localDateKey(middle, timezone) === dayKey) low = middle + 1;
        else high = middle;
      }
      boundary = low;
    }
    totals[dayKey] ||= {};
    totals[dayKey][userId] = finiteInteger(totals[dayKey][userId], 0, 0, Number.MAX_SAFE_INTEGER) + (boundary - cursor);
    cursor = boundary;
  }
};

const buildVoiceLogDailyTotals = ({ sessions = [], timezone = 'Europe/Berlin', minimumParticipants = 1 } = {}) => {
  const totals = {};
  const byChannel = new Map();
  for (const session of sessions) {
    const userId = String(session?.userId || '');
    const channelId = String(session?.channelId || session?.channelName || '');
    const startMs = Number(session?.startMs || 0);
    const endMs = Number(session?.endMs || 0);
    if (!userId || !channelId || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
    if (!byChannel.has(channelId)) byChannel.set(channelId, []);
    byChannel.get(channelId).push({ userId, startMs, endMs });
  }
  const required = finiteInteger(minimumParticipants, 1, 1, 99);
  for (const channelSessions of byChannel.values()) {
    const events = new Map();
    for (const session of channelSessions) {
      if (!events.has(session.startMs)) events.set(session.startMs, { starts: [], ends: [] });
      if (!events.has(session.endMs)) events.set(session.endMs, { starts: [], ends: [] });
      events.get(session.startMs).starts.push(session.userId);
      events.get(session.endMs).ends.push(session.userId);
    }
    const active = new Set();
    let previousAt = null;
    for (const at of [...events.keys()].sort((left, right) => left - right)) {
      if (previousAt !== null && at > previousAt && active.size >= required) {
        for (const userId of active) addVoiceIntervalToDays(totals, userId, previousAt, at, timezone);
      }
      const event = events.get(at);
      for (const userId of event.ends) active.delete(userId);
      for (const userId of event.starts) active.add(userId);
      previousAt = at;
    }
  }
  return totals;
};

const replaceVoiceDaysFromLogs = (data, totals, startDay, endDay, { skipDays = new Set() } = {}) => {
  let changed = false;
  for (let dayKey = startDay; dayKey <= endDay; dayKey = shiftDateKey(dayKey, 1)) {
    if (skipDays.has(dayKey)) continue;
    const indexedUsers = totals?.[dayKey] || {};
    const day = data.days?.[dayKey];
    if (day) {
      for (const row of Object.values(day.users || {})) {
        if (finiteInteger(row?.voiceMilliseconds, 0, 0, Number.MAX_SAFE_INTEGER) !== 0) changed = true;
        row.voiceMilliseconds = 0;
      }
    }
    for (const [userId, milliseconds] of Object.entries(indexedUsers)) {
      data.days[dayKey] ||= { users: {} };
      data.days[dayKey].users[userId] ||= { messages: 0, voiceMilliseconds: 0 };
      const next = finiteInteger(milliseconds, 0, 0, Number.MAX_SAFE_INTEGER);
      if (data.days[dayKey].users[userId].voiceMilliseconds !== next) changed = true;
      data.days[dayKey].users[userId].voiceMilliseconds = next;
    }
  }
  return changed;
};

const resolveLoggedVoiceChannel = (guild, channelName) => {
  const value = String(channelName || '');
  const direct = guild?.channels?.cache?.get?.(value);
  if (direct) return direct;
  const normalized = value.toLowerCase();
  return [...(guild?.channels?.cache?.values?.() || [])].find((channel) => String(channel?.name || '').toLowerCase() === normalized)
    || { id: value, name: value, parentId: '', parent: null };
};

const reliableVoiceLogStartDay = (indexed, timezone) => {
  let startDay = localDateKey(indexed?.firstVoiceRecordMs || indexed?.firstEventMs || Date.now(), timezone);
  let latestUnparsedMs = 0;
  for (const timestamp of indexed?.unparsedVoiceEventMs || []) {
    if (Number.isFinite(timestamp) && timestamp > latestUnparsedMs) latestUnparsedMs = timestamp;
  }
  if (latestUnparsedMs > 0) {
    const afterUnparsedDay = shiftDateKey(localDateKey(latestUnparsedMs, timezone), 1);
    if (afterUnparsedDay > startDay) startDay = afterUnparsedDay;
  }
  return startDay;
};

const reconcileVoiceFromLogs = async (runtime, { force = false, now = Date.now() } = {}) => {
  if (!runtime?.conf?.enabled) return { skipped: true, reason: 'disabled' };
  const indexed = await getIndexedVoiceLogSessions({
    guild: runtime.guild,
    cfg: { voiceLogImport: runtime.voiceLogConfig || {} },
    force
  });
  if (!indexed?.firstEventMs || !indexed?.firstVoiceRecordMs || !['ok', 'unchanged'].includes(indexed.status)) return { skipped: true, reason: indexed?.status || 'unavailable' };
  if (!force && indexed.revisionKey === runtime.lastVoiceLogRevision) return { skipped: true, reason: 'unchanged' };

  const sessions = [];
  const addSession = (session, currentState = null) => {
    const userId = String(session?.userId || '');
    const member = runtime.guild.members.cache.get(userId);
    const channel = currentState?.channelId
      ? runtime.guild.channels.cache.get(String(currentState.channelId))
      : resolveLoggedVoiceChannel(runtime.guild, session?.channelName || session?.channelId);
    if (!member || member.user?.bot || !channel || excludedMember(member, runtime.conf) || ignoredChannel(channel, runtime.conf)) return;
    if (String(runtime.guild.afkChannelId || '') === String(channel.id || '')) return;
    sessions.push({ userId, channelId: String(channel.id || session?.channelName || ''), startMs: session.startMs, endMs: session.endMs });
  };
  for (const session of indexed.sessions || []) addSession(session);
  for (const [userId, open] of indexed.openSessions || []) {
    const current = runtime.guild.voiceStates.cache.get(String(userId));
    if (!current?.channelId || now <= Number(open?.startMs || 0)) continue;
    addSession({ ...open, endMs: now }, current);
  }

  const totals = buildVoiceLogDailyTotals({
    sessions,
    timezone: runtime.timezone,
    minimumParticipants: runtime.conf.voiceMinimumParticipants
  });
  const data = await guildData(runtime.guild.id);
  const startDay = reliableVoiceLogStartDay(indexed, runtime.timezone);
  const endDay = localDateKey(now, runtime.timezone);
  const incompleteDays = new Set((indexed.unparsedVoiceEventMs || []).map((timestamp) => localDateKey(timestamp, runtime.timezone)));
  const changed = replaceVoiceDaysFromLogs(data, totals, startDay, endDay, { skipDays: incompleteDays });
  const coverageChanged = markMetricTrackingCoverage(data, 'voice', startDay);
  data.voiceIndexBackfill = {
    channelId: indexed.channelId,
    channelSource: indexed.channelSource,
    revision: indexed.revisionKey,
    rangeStart: startDay,
    rangeEnd: endDay,
    sessions: sessions.length,
    skippedIncompleteDays: incompleteDays.size,
    completedAt: new Date(now).toISOString()
  };
  runtime.lastVoiceLogRevision = indexed.revisionKey;
  runtime.lastVoiceTickAt = now;
  if (changed || coverageChanged) {
    data.updatedAt = new Date(now).toISOString();
    scheduleSave();
  }
  return { changed: changed || coverageChanged, ...data.voiceIndexBackfill };
};
const settleVoice = async (runtime, now = Date.now(), { reconcile = true } = {}) => {
  const elapsed = Math.max(0, Math.min(5 * 60_000, now - Number(runtime.lastVoiceTickAt || now)));
  runtime.lastVoiceTickAt = now;
  if (!runtime.conf.enabled || elapsed < 250) return 0;
  // Gateway-Events können bei Reconnects ausfallen. Vor regulären Ticks und
  // UI-Snapshots deshalb immer Discord als Quelle der Wahrheit verwenden.
  // Der Voice-Event-Handler setzt reconcile=false, damit er den Zeitraum bis
  // zum Event noch mit oldState abrechnen kann.
  if (reconcile) reconcileVoiceStates(runtime);
  const byChannel = new Map();
  for (const [userId, state] of runtime.voiceStates.entries()) {
    if (!voiceEligibility(runtime, userId, state)) continue;
    if (!byChannel.has(state.channelId)) byChannel.set(state.channelId, []);
    byChannel.get(state.channelId).push(userId);
  }
  const data = await guildData(runtime.guild.id);
  let credited = 0;
  for (const userIds of byChannel.values()) {
    if (userIds.length < runtime.conf.voiceMinimumParticipants) continue;
    for (const userId of userIds) {
      ensureDayUser(data, runtime.timezone, userId, now).voiceMilliseconds += elapsed;
      credited += 1;
    }
  }
  if (credited) {
    data.updatedAt = new Date().toISOString();
    scheduleSave();
  }
  return credited;
};

/* ---------------------- Offline-/Online-Tracking (Heartbeat) -------------- */
// Der Heartbeat liegt in einer winzigen separaten Datei, damit das große
// activity-race.json nicht bei jedem Tick neu geschrieben wird. Aktualisiert
// wird er minütlich (Tick) und beim sauberen Herunterfahren (SIGINT/SIGTERM).
let heartbeat = null;
let heartbeatLoadPromise = null;
let heartbeatSaveTimer = null;
let heartbeatSaveQueue = Promise.resolve();

const ensureHeartbeatLoaded = async () => {
  if (heartbeat) return heartbeat;
  if (!heartbeatLoadPromise) {
    heartbeatLoadPromise = readJsonWithRecovery(HEARTBEAT_FILE, { fallback: { version: 1, guilds: {} }, backupLimit: 3 })
      .then((result) => {
        heartbeat = (result?.value?.guilds && typeof result.value.guilds === 'object')
          ? result.value
          : { version: 1, guilds: {} };
        return heartbeat;
      })
      .finally(() => { heartbeatLoadPromise = null; });
  }
  return heartbeatLoadPromise;
};
const flushHeartbeat = async () => {
  clearTimeout(heartbeatSaveTimer);
  heartbeatSaveTimer = null;
  if (!heartbeat) return;
  const snapshot = JSON.parse(JSON.stringify(heartbeat));
  heartbeatSaveQueue = heartbeatSaveQueue.catch(() => null)
    .then(() => atomicWriteJson(HEARTBEAT_FILE, snapshot, { backupLimit: 3 }));
  await heartbeatSaveQueue;
};
const scheduleHeartbeatSave = () => {
  clearTimeout(heartbeatSaveTimer);
  heartbeatSaveTimer = setTimeout(() => void flushHeartbeat().catch((error) => console.warn(`[activityRace] Heartbeat-Speichern fehlgeschlagen: ${error?.message || error}`)), 500);
  heartbeatSaveTimer.unref?.();
};
const touchHeartbeat = async (guildId, now = Date.now()) => {
  const store = await ensureHeartbeatLoaded();
  store.guilds[String(guildId)] = new Date(now).toISOString();
};
const heartbeatPersistDue = (runtime, now = Date.now()) => {
  if (now - Number(runtime.lastHeartbeatPersistAt || 0) < HEARTBEAT_PERSIST_MS) return false;
  runtime.lastHeartbeatPersistAt = now;
  return true;
};

// Ermittelt das Offline-Fenster beim Start. Rückgaben:
//   { kind: 'first-boot' }  – nie ein Heartbeat geschrieben (Erststart)
//   null                    – Heartbeat frisch, Bot lief durch
//   { kind: 'offline', sinceMs, untilMs, ms } – Bot war offline
const computeOfflineWindow = async (guildId, now = Date.now()) => {
  const store = await ensureHeartbeatLoaded();
  const lastSeenMs = Date.parse(store?.guilds?.[String(guildId)] || '');
  if (!Number.isFinite(lastSeenMs) || lastSeenMs <= 0) return { kind: 'first-boot' };
  const ms = now - lastSeenMs;
  if (ms < OFFLINE_GRACE_MS) return null;
  return { kind: 'offline', sinceMs: lastSeenMs, untilMs: now, ms };
};

// Das Offline-Fenster für die Diagnose im Store festhalten (nur Info).
const recordOfflineWindow = async (guildId, offline) => {
  const data = await guildData(guildId);
  data.runtime.lastOffline = {
    since: new Date(offline.sinceMs).toISOString(),
    until: new Date(offline.untilMs).toISOString()
  };
  data.updatedAt = new Date().toISOString();
  scheduleSave();
};

// Enges Index-Fenster für den regulären Tick/Snapshot: nur die letzten
// RECENT_RECONCILE_DAYS Tage statt der 400-Tage-Retention. Die Live-Zählung
// deckt alles ab, was während der Laufzeit passiert – der Nachzug prüft nur
// das jüngste Fenster als Sicherheitsnetz gegen verpasste Events.
const recentBackfillRange = (timezone, now = Date.now()) => {
  const today = localDateKey(now, timezone);
  return { start: shiftDateKey(today, -RECENT_RECONCILE_DAYS), end: today, endExclusive: shiftDateKey(today, 1) };
};

const reconcileActivityFromServerIndex = async (runtime, { force = false, rangeOverride = null } = {}) => {
  if (!runtime?.conf?.enabled) return null;
  if (runtime.indexSyncPromise) return runtime.indexSyncPromise;
  if (!force && Date.now() - Number(runtime.lastIndexAttemptAt || 0) < INDEX_RECONCILE_MIN_INTERVAL_MS) return null;
  runtime.lastIndexAttemptAt = Date.now();
  runtime.indexSyncPromise = (async () => {
    const data = await guildData(runtime.guild.id);
    const range = rangeOverride || indexedBackfillRange(runtime.timezone);
    try {
      await ensureCompleteMemberCache(runtime.guild);
      const indexSnapshot = await getServerIndexSnapshot(runtime.guild.id);
      const signature = `${range.start}:${range.end}:${indexSnapshot?.updatedAt || ''}:${Number(indexSnapshot?.totalMessages || 0)}`;
      if (signature === runtime.lastIndexSignature) return { skipped: true, reason: 'unchanged', ...data.indexBackfill };
      const queryRange = broadUtcRange(range);
      const accumulator = createIndexedChatAccumulator();
      let afterCreatedAt = null;
      let afterMessageId = null;
      while (true) {
        const page = await getServerIndexActivityMessages({
          guildId: runtime.guild.id,
          ...queryRange,
          afterCreatedAt,
          afterMessageId,
          limit: INDEX_PAGE_SIZE
        });
        if (!page.length) break;
        accumulateIndexedChatRecords({
          guild: runtime.guild,
          conf: runtime.conf,
          timezone: runtime.timezone,
          records: page,
          range,
          accumulator
        });
        const last = page[page.length - 1];
        afterCreatedAt = last.createdAt;
        afterMessageId = last.id;
        if (page.length < INDEX_PAGE_SIZE) break;
      }
      const merged = mergeIndexedChatDays(data, accumulator, { rangeStart: range.start });
      const totalRecoveredMessages = finiteInteger(data.indexBackfill?.totalRecoveredMessages, 0, 0, Number.MAX_SAFE_INTEGER)
        + merged.recoveredMessages;
      data.indexBackfill = {
        rangeStart: range.start,
        rangeEnd: range.end,
        indexUpdatedAt: String(indexSnapshot?.updatedAt || ''),
        completedAt: new Date().toISOString(),
        analyzedMessages: accumulator.analyzedMessages,
        creditedMessages: accumulator.creditedMessages,
        recoveredMessages: merged.recoveredMessages,
        totalRecoveredMessages,
        lastError: ''
      };
      data.updatedAt = new Date().toISOString();
      runtime.lastIndexSignature = signature;
      scheduleSave();
      return { changed: merged.changed, ...data.indexBackfill };
    } catch (error) {
      data.indexBackfill = {
        ...(data.indexBackfill || {}),
        rangeStart: range.start,
        rangeEnd: range.end,
        lastError: String(error?.message || error).slice(0, 500)
      };
      scheduleSave();
      // The live league must remain available even if the historical index is
      // temporarily locked or Discord is still scanning old channels.
      return { changed: false, ...data.indexBackfill };
    }
  })().finally(() => { runtime.indexSyncPromise = null; });
  return runtime.indexSyncPromise;
};

const messageToIndexedRecord = (message) => ({
  id: String(message?.id || ''),
  channelId: String(message?.channel?.id || ''),
  parentChannelId: String(message?.channel?.parentId || ''),
  createdAt: new Date(message?.createdTimestamp || Date.now()).toISOString(),
  authorId: String(message?.author?.id || ''),
  authorBot: Boolean(message?.author?.bot),
  webhookId: String(message?.webhookId || ''),
  content: String(message?.content || ''),
  attachments: message?.attachments ? [...message.attachments.values()] : [],
  stickers: message?.stickers ? [...message.stickers.values()] : []
});

// Discord-Nachzug der Tagesaktivität: zählt alle Nachrichten seit 0 Uhr (lokale
// Zeitzone) direkt aus dem Kanalverlauf nach – auch solche, die geschrieben
// wurden, während der Bot offline war. Nutzt dieselben Filter wie die Live-
// Wertung (ausgeschlossene Kanäle/Rollen, Mindestlänge, Cooldown, Duplikate)
// und merged per Math.max, damit bereits gezählte Nachrichten nie doppelt zählen.
const DISCORD_RECOVER_MIN_INTERVAL_MS = 10 * 60_000;
const DISCORD_RECOVER_MAX_PAGES = 25;
const recoverDailyMessagesFromDiscord = async (runtime, { force = false, sinceMs = null } = {}) => {
  if (!runtime?.conf?.enabled) return { skipped: true, reason: 'disabled' };
  if (runtime.discordRecoverPromise) return runtime.discordRecoverPromise;
  if (!force && Date.now() - Number(runtime.lastDiscordRecoverAt || 0) < DISCORD_RECOVER_MIN_INTERVAL_MS) {
    return { skipped: true, reason: 'throttled' };
  }
  runtime.lastDiscordRecoverAt = Date.now();
  runtime.discordRecoverPromise = (async () => {
    const timezone = runtime.timezone;
    const today = localDateKey(Date.now(), timezone);
    // Untere Grenze: 0 Uhr heute ODER der Offline-Beginn, wenn der Bot
    // zwischenzeitlich offline war (dann wird NUR der Ausfall-Zeitraum
    // nachgezogen statt immer ab 0 Uhr). Der Host läuft in derselben Zeitzone
    // wie die Konfiguration.
    const midnightMs = Date.parse(`${today}T00:00:00`);
    const boundaryMs = Math.max(midnightMs, Number.isFinite(Number(sinceMs)) ? Math.floor(Number(sinceMs)) : midnightMs);
    const data = await guildData(runtime.guild.id);
    await ensureCompleteMemberCache(runtime.guild);
    const accumulator = createIndexedChatAccumulator();
    // Pre-Filter über den Snowflake-Zeitstempel der letzten Nachricht: Kanäle,
    // deren letzte Nachricht VOR der Grenze liegt, können keine Nachrichten im
    // Fenster haben – sie werden OHNE messages.fetch übersprungen. Das reduziert
    // den 924-Kanal-Scan auf die wenigen Kanäle mit Aktivität und beendet den
    // Rate-Limit-Sturm (GET /channels/:id/messages mit 4-5 s Wartezeit).
    const hasActivitySinceBoundary = (channel) => {
      const lastAt = lastMessageTimestampMs(channel);
      return lastAt === null || lastAt >= boundaryMs;
    };
    const candidates = [...(runtime.guild.channels?.cache?.values?.() || [])]
      .filter((channel) => channel?.isTextBased?.()
        && typeof channel?.messages?.fetch === 'function'
        && !ignoredChannel(channel, runtime.conf)
        && hasActivitySinceBoundary(channel));
    let scanned = 0;
    let scannedChannels = 0;
    for (const channel of candidates) {
      const permissions = channel.permissionsFor?.(runtime.guild.members.me);
      if (!permissions?.has?.(PermissionFlagsBits.ReadMessageHistory) || !permissions.has(PermissionFlagsBits.ViewChannel)) continue;
      scannedChannels += 1;
      let before = null;
      let pages = 0;
      try {
        while (pages < DISCORD_RECOVER_MAX_PAGES) {
          const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
          if (!page?.size) break;
          const messages = [...page.values()];
          const inWindow = messages.filter((message) => Number(message?.createdTimestamp || 0) >= boundaryMs);
          if (inWindow.length) {
            accumulateIndexedChatRecords({
              guild: runtime.guild,
              conf: runtime.conf,
              timezone,
              records: inWindow.map(messageToIndexedRecord),
              range: { start: today, end: today },
              accumulator
            });
            scanned += inWindow.length;
          }
          const oldest = messages[messages.length - 1];
          if (page.size < 100 || Number(oldest?.createdTimestamp || 0) < boundaryMs) break;
          before = oldest.id;
          pages += 1;
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
      } catch {
        // Best effort – ein einzelner Kanal darf den Nachzug nie abbrechen.
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    const merged = mergeIndexedChatDays(data, accumulator);
    if (merged.changed) {
      data.updatedAt = new Date().toISOString();
      scheduleSave();
    }
    return { scanned, credited: merged.recoveredMessages, channels: scannedChannels, changed: merged.changed };
  })().finally(() => { runtime.discordRecoverPromise = null; });
  return runtime.discordRecoverPromise;
};

const formatVoice = (milliseconds) => {
  // Math.round statt Math.floor: Anzeige muss exakt dem Rundungswert
  // entsprechen der auch fuer Ranking verwendet wird (line 698).
  // Sonst zeigen zwei Users '5 Std. 38 Min.' haben aber unterschiedliche Raenge.
  const totalMinutes = Math.round(Math.max(0, Number(milliseconds || 0)) / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours} Std. ${minutes} Min.` : `${minutes} Min.`;
};
const trophyEmoji = (guild, place) => {
  const definition = TROPHY_EMOJIS[place];
  if (!definition) return '';
  const emoji = guild?.emojis?.cache?.get?.(definition.id)
    || guild?.emojis?.cache?.find?.((entry) => entry?.name === definition.name);
  if (emoji?.id) return `<${emoji.animated ? 'a' : ''}:${emoji.name || definition.name}:${emoji.id}>`;
  return definition.id ? `<:${definition.name}:${definition.id}>` : definition.fallback;
};

/* --------------------------------------------------------------------------
   Platzierungs-Pings · Kanal bei Live-Platzwechseln (Top 1–3)
   --------------------------------------------------------------------------
   Wertet die Rollen-Änderungen eines Reconcile-Laufs aus und pingt die
   betroffenen Mitglieder im konfigurierten Ping-Kanal (Fallback: Ranglisten-
   Kanal): neu in die Top 3 gekommen, auf Platz 1 vorgestoßen oder aus den
   Top 3 verdrängt (mit @Mention des Überholers). Nach den Pings folgt eine
   kurze Erklärung der heutigen Top 3 (Chat + Sprachchat). Alle Nachrichten
   löschen sich nach konfigurierter Zeit selbst. Nutzt die im Bot hochgeladenen
   Trophy-Emojis (trophy1/2/3) mit Fallback-Medals.
   -------------------------------------------------------------------------- */
const periodPingLabel = (period) => ACTIVITY_PERIOD_DEFINITIONS.find((entry) => entry.key === period)?.label || period;
const metricPingLabel = (metric) => ACTIVITY_METRIC_DEFINITIONS.find((entry) => entry.key === metric)?.label || metric;

const buildPlacementRoleMap = (conf) => {
  const map = new Map();
  const roles = configuredAwardRoles(conf);
  for (const period of Object.keys(roles)) {
    for (const metric of Object.keys(roles[period])) {
      roles[period][metric].forEach((roleId, index) => {
        if (roleId) map.set(String(roleId), { roleId: String(roleId), period, metric, place: index + 1 });
      });
    }
  }
  return map;
};

// Verschiedene Satz-Varianten für die Platzierungs-Pings. Pro Ereignis wird per
// Zufall eine Variante gewählt, damit die Nachrichten nicht monoton klingen.
// Jede Pool-Funktion bekommt die Argumente ihrer Kategorie übergeben.
const PING_PHRASES = {
  downrankWithOvertaker: [
    (overtaker, place, scope) => `Du wurdest von ${overtaker} überholt und belegst jetzt **Platz ${place}** in der ${scope}.`,
    (overtaker, place, scope) => `${overtaker} hat dich überholt – du belegst jetzt **Platz ${place}** in der ${scope}.`,
    (overtaker, place, scope) => `Du bist in der ${scope} auf **Platz ${place}** zurückgefallen – überholt von ${overtaker}.`
  ],
  downrank: [
    (place, scope) => `Du wurdest überholt und belegst jetzt **Platz ${place}** in der ${scope}.`,
    (place, scope) => `Du bist in der ${scope} auf **Platz ${place}** zurückgefallen.`
  ],
  uprankFirst: [
    (trophy, scope) => `${trophy} **Platz 1** in der ${scope} – du führst jetzt die Wertung an!`,
    (trophy, scope) => `${trophy} **Platz 1** in der ${scope} – die Spitze gehört jetzt dir!`,
    (trophy, scope) => `${trophy} **Platz 1** in der ${scope} – du bist ganz oben angekommen!`
  ],
  uprank: [
    (trophy, place, scope) => `${trophy} **Platz ${place}** in der ${scope} – du hast dich verbessert. Weiter so!`,
    (trophy, place, scope) => `${trophy} **Platz ${place}** in der ${scope} – stark, du hast dich verbessert!`,
    (trophy, place, scope) => `${trophy} **Platz ${place}** in der ${scope} – ein Platz nach oben, du hast dich verbessert!`
  ],
  newTop3: [
    (trophy, place, scope) => `${trophy} **Platz ${place}** in der ${scope} – willkommen in den Top 3!`,
    (trophy, place, scope) => `${trophy} **Platz ${place}** in der ${scope} – du hast es in die Top 3 geschafft!`,
    (trophy, place, scope) => `${trophy} **Platz ${place}** in der ${scope} – neu dabei in den Top 3!`
  ],
  displaced: [
    (scope, overtaker) => `Du wurdest in der ${scope} aus den Top 3 verdrängt${overtaker ? ` – ${overtaker} hat deinen Platz übernommen` : ''}.`,
    (scope, overtaker) => `Du bist aus den Top 3 der ${scope} gefallen${overtaker ? ` – deinen Platz hat ${overtaker} übernommen` : ''}.`,
    (scope, overtaker) => `In der ${scope} hast du deinen Platz in den Top 3 verloren${overtaker ? ` – ${overtaker} belegt ihn jetzt` : ''}.`
  ],
  // Mehrere Verdrängungen derselben Person in einem Lauf (z. B. Chat und
  // Sprachchat gleichzeitig) werden zu einem einzigen Satz gebündelt statt
  // zwei fast gleiche Sätze aneinanderzureihen. Erwartet die gebündelte
  // Bereichs-Bezeichnung („Tageswertung (Chat und Sprachchat)“) und die
  // Überholer-Klausel.
  displacedBundle: [
    (scopeText, overtakerClause) => `Du wurdest in der ${scopeText} aus den Top 3 verdrängt${overtakerClause}.`,
    (scopeText, overtakerClause) => `Du bist aus den Top 3 der ${scopeText} gefallen${overtakerClause}.`,
    (scopeText, overtakerClause) => `Aus den Top 3 der ${scopeText} verdrängt${overtakerClause}.`
  ]
};

const pickPhrase = (pool, random = Math.random) => {
  const variants = Array.isArray(pool) ? pool : [];
  return variants[Math.floor(random() * variants.length)] ?? variants[0];
};

const placementPingLines = (runtime, changes, conf) => {
  if (!conf?.placementPings) return [];
  const roleMap = buildPlacementRoleMap(conf);
  // Wer hat in diesem Lauf welche Platz-Rolle gewonnen? Daraus lässt sich beim
  // Abstieg der Überholer ableiten (die Person, die den alten Platz übernimmt).
  const roleWonBy = new Map();
  for (const change of changes || []) {
    for (const roleId of change?.addedRoleIds || []) {
      if (roleMap.has(String(roleId))) roleWonBy.set(String(roleId), change.userId);
    }
  }
  const lines = [];
  for (const change of changes || []) {
    if (!change?.userId || change.userId === runtime.guild.id) continue;
    const gained = (change.addedRoleIds || [])
      .map((roleId) => roleMap.get(String(roleId)))
      .filter(Boolean)
      .sort((left, right) => left.place - right.place);
    const lost = (change.removedRoleIds || [])
      .map((roleId) => roleMap.get(String(roleId)))
      .filter(Boolean);
    const lostByScope = new Map();
    for (const entry of lost) lostByScope.set(`${entry.period}.${entry.metric}`, entry);
    const lostScopes = new Set(lost.map((entry) => `${entry.period}.${entry.metric}`));
    const gainedScopes = new Set(gained.map((entry) => `${entry.period}.${entry.metric}`));
    for (const placement of gained) {
      const scopeKey = `${placement.period}.${placement.metric}`;
      const scope = `${periodPingLabel(placement.period)} · ${metricPingLabel(placement.metric)}`;
      const trophy = trophyEmoji(runtime.guild, placement.place) || TROPHY_EMOJIS[placement.place]?.fallback || '';
      const previous = lostByScope.get(scopeKey);
      let headline;
      if (previous && previous.place < placement.place) {
        // Abstieg: Der alte Platz war besser, der neue schlechter. Der Überholer
        // wird direkt in den Satz eingebaut (@Mention) statt als Anhang.
        const overtakerId = roleWonBy.get(String(previous.roleId));
        const overtaker = overtakerId && String(overtakerId) !== String(change.userId)
          ? `<@${overtakerId}>`
          : '';
        headline = `⚠️ ${overtaker
          ? pickPhrase(PING_PHRASES.downrankWithOvertaker)(overtaker, placement.place, scope)
          : pickPhrase(PING_PHRASES.downrank)(placement.place, scope)}`;
      // Hinweis: Das Warn-Emoji ⚠️ steht bewusst außerhalb der Abstiegs-Pools,
      // weil es ein fester Hinweis ist – nur der Satz selbst variiert. Die
      // Trophys dagegen stecken in den Aufstiegs-Pools, weil sie je Platz wechseln.
      } else if (previous && previous.place > placement.place) {
        // Aufstieg innerhalb der Top 3 – auch Platz 1 wird hier gekrönt.
        headline = placement.place === 1
          ? pickPhrase(PING_PHRASES.uprankFirst)(trophy, scope)
          : pickPhrase(PING_PHRASES.uprank)(trophy, placement.place, scope);
      } else {
        // Neu in den Top 3 oder gleicher Platz.
        headline = placement.place === 1
          ? pickPhrase(PING_PHRASES.uprankFirst)(trophy, scope)
          : pickPhrase(PING_PHRASES.newTop3)(trophy, placement.place, scope);
      }
      lines.push({ userId: change.userId, headline, scope, place: placement.place });
    }
    // Verdrängungen ohne neuen Platz in derselben Wertung.
    for (const scopeKey of lostScopes) {
      if (gainedScopes.has(scopeKey)) continue;
      const placement = lostByScope.get(scopeKey);
      const scope = `${periodPingLabel(placement.period)} · ${metricPingLabel(placement.metric)}`;
      const overtakerId = roleWonBy.get(String(placement.roleId));
      const overtaker = overtakerId && String(overtakerId) !== String(change.userId)
        ? `<@${overtakerId}>`
        : '';
      lines.push({
        userId: change.userId,
        headline: pickPhrase(PING_PHRASES.displaced)(scope, overtaker),
        scope,
        place: 0,
        displaced: true,
        overtaker
      });
    }
  }
  return lines;
};

const rankValueText = (metric, value) => metric === 'messages'
  ? `${Number(value || 0).toLocaleString('de-DE')} Nachrichten`
  : formatVoice(value);
const rankingBlock = (runtime, rows, metric, label) => {
  if (!rows?.length) return [];
  const lines = [`${label}:`];
  let lastValue = null;
  let place = 0;
  for (const entry of rows || []) {
    const value = Number(entry?.value || 0);
    if (value <= 0) continue;
    if (lastValue === null || value !== lastValue) {
      place += 1;
      if (place > 3) break;
    }
    lines.push(`${trophyEmoji(runtime.guild, place) || `${place}.`} <@${entry.userId}> – ${rankValueText(metric, entry.value)}`);
    lastValue = value;
  }
  return lines;
};
const formatDateKey = (key) => {
  const parts = String(key || '').split('-');
  return parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : String(key || '');
};

/* Abschluss-Ankündigung: Wenn eine Kalenderwoche oder ein Kalendermonat
   vollständig abgeschlossen ist, werden die Sieger der Wertung verkündet.
   Erwartet das Awards-Snapshot (weekly/monthly = completedPeriodSnapshot). */
const buildCompletionAnnouncement = (runtime, awards, period) => {
  if (period === 'daily') return null;
  const rank = awards?.periods?.[period];
  if (!rank || rank.fullyTracked !== true) return null;
  const chat = (rank.chat || []).slice(0, 3);
  const voice = (rank.voice || []).slice(0, 3);
  if (!chat.length && !voice.length) return null;
  const header = period === 'weekly'
    ? '🏆 **Kalenderwoche abgeschlossen – die Sieger stehen fest!**'
    : '🏆 **Kalendermonat abgeschlossen – die Sieger stehen fest!**';
  const range = `*(${formatDateKey(rank.start)} – ${formatDateKey(rank.end)})*`;
  const parts = [
    ...rankingBlock(runtime, chat, 'messages', '💬 **Chat**'),
    ...rankingBlock(runtime, voice, 'voiceMilliseconds', '🔊 **Sprachchat**')
  ];
  return `${header}\n${range}\n\n${parts.join('\n')}`;
};

const announcementChannel = (guild, conf) => {
  const configured = String(conf?.announcementChannelId || '').trim();
  const channel = configured ? guild?.channels?.cache?.get?.(configured) : null;
  if (channel?.isTextBased?.()) return channel;
  // Kein eigener Ankündigungs-Kanal konfiguriert oder ungültig: Fallback auf den Ranglisten-Kanal.
  return panelChannel(guild, conf);
};

/* Sendet die Abschluss-Ankündigung für jede soeben abgeschlossene Woche bzw.
   jeden abgeschlossenen Monat – genau einmal pro Zeitraum (persistiert in
   data.announcedPeriods). Ankündigungen sind Meilensteine und bleiben stehen. */
const announceCompletedPeriods = async (runtime, data, awards, conf) => {
  if (conf?.announceCompletedPeriods === false) return 0;
  const channel = announcementChannel(runtime.guild, conf);
  if (!channel) return 0;
  let sent = 0;
  for (const period of ['weekly', 'monthly']) {
    const rank = awards?.periods?.[period];
    const endKey = rank?.fullyTracked ? String(rank.end || '') : '';
    if (!endKey || data.announcedPeriods?.[period] === endKey) continue;
    const announcement = buildCompletionAnnouncement(runtime, awards, period);
      if (!announcement) continue;
      try {
        // Auch die Abschluss-Ankündigung ist eine Platzierungsänderung und
        // muss den Opt-out beachten - sonst werden alle Gewinner gepingt.
        const safeAnnouncement = neutralizeOptedOutMentions(announcement, data, (id) => {
          const winner = runtime.guild.members.cache.get(id);
          return winner?.displayName || winner?.user?.username || '';
        });
        await channel.send({ content: safeAnnouncement });
      data.announcedPeriods ||= {};
      data.announcedPeriods[period] = endKey;
      sent += 1;
    } catch {
      // Kanal nicht erreichbar – der Zeitraum wird beim nächsten Lauf erneut versucht.
    }
  }
  if (sent > 0) scheduleSave();
  return sent;
};

const placementPingChannel = (guild, conf) => {
  const configured = String(conf?.placementPingChannelId || '').trim();
  const channel = configured ? guild?.channels?.cache?.get?.(configured) : null;
  if (channel?.isTextBased?.()) return channel;
  // Kein eigener Ping-Kanal konfiguriert oder ungültig: Fallback auf den Ranglisten-Kanal.
  return panelChannel(guild, conf);
};

/* Bündelt mehrere Verdrängungen derselben Person (z. B. Chat + Sprachchat in
   einem Lauf) zu einer gemeinsamen Bereichs-Bezeichnung wie
   „Tageswertung (Chat und Sprachchat)“ plus einer Überholer-Klausel. */
const buildDisplacedBundleParts = (lines) => {
  const scopes = lines.map((line) => line.scope).filter(Boolean);
  const overtakers = [...new Set(lines.map((line) => line.overtaker).filter(Boolean))];
  if (!scopes.length) return { scopeText: '', overtakerClause: '' };
  const first = scopes[0];
  const sep = first.indexOf(' · ');
  const prefix = sep > 0 ? first.slice(0, sep) : '';
  const sharedPrefix = prefix && scopes.every((scope) => scope.startsWith(`${prefix} · `)) ? prefix : '';
  const names = scopes.map((scope) => (sharedPrefix ? scope.slice(sharedPrefix.length + 3) : scope));
  const scopeText = sharedPrefix ? `${sharedPrefix} (${names.join(' und ')})` : names.join(' und ');
  const overtakerClause = overtakers.length === 1
    ? ` – ${overtakers[0]} hat ${scopes.length > 1 ? 'einen deiner Plätze' : 'deinen Platz'} übernommen`
    : overtakers.length > 1
      ? ` – deine Plätze haben ${overtakers.join(' und ')} übernommen`
      : '';
  return { scopeText, overtakerClause };
};

/* Baut den Nachrichten-Inhalt für einen Nutzer: Mehrere Verdrängungen werden
   zu einem Satz zusammengefasst (statt per Leerzeichen aneinandergereiht).
   Die Reihenfolge der Meldungen bleibt dabei wie vorher (erst Auf-/Abstiege,
   dann Verdrängungen) – nur der Text wird verdichtet. */
// Ersetzt @Mentions von Personen, die ihre Liga-Pings abgestellt haben, durch
// ihren Namen. Ohne das prueft der Empfaengerfilter nur line.userId - eine im
// Satz eingebettete "Überholer"-Mention wuerde stumm durchgehen und genau die
// Leute benachrichtigen, die sich ausdruecklich abgemeldet haben.
const neutralizeOptedOutMentions = (text, data, resolveName) => {
  const source = String(text || '');
  if (!source.includes('<@')) return source;
  return source.replace(/<@!?(\d{15,25})>/g, (match, id) => {
    if (isPlacementPingEnabled(data, id)) return match;
    const name = typeof resolveName === 'function' ? resolveName(id) : '';
    return String(name || '').trim() || 'jemand';
  });
};

const composePingContent = (userId, lines, data, resolveName) => {
  const displaced = lines.filter((line) => line.displaced === true);
  const parts = [];
  let bundleEmitted = false;
  for (const line of lines) {
    if (line.displaced === true) {
      if (!bundleEmitted) {
        bundleEmitted = true;
        if (displaced.length > 1) {
          const { scopeText, overtakerClause } = buildDisplacedBundleParts(displaced);
          parts.push(pickPhrase(PING_PHRASES.displacedBundle)(scopeText, overtakerClause));
        } else {
          parts.push(line.headline);
        }
      }
    } else {
      parts.push(line.headline);
    }
  }
  return neutralizeOptedOutMentions(`<@${userId}> ${parts.join(' ')}`, data, resolveName);
};

export const resetPingCooldowns = () => pingCooldownMap.clear();
const pingCooldownMap = new Map(); // key: `${guildId}:${userId}:${scope}` → lastPingAt
// Lädt persistente Cooldowns aus dem Guild-Store in den In-Memory-Map
// (einmalig pro Guild beim ersten Zugriff).
const pingCooldownsLoaded = new Set();
const ensurePingCooldownsLoaded = async (guildId) => {
  if (pingCooldownsLoaded.has(guildId)) return;
  try {
    const data = await guildData(guildId);
    for (const [key, ts] of Object.entries(data.pingCooldowns || {})) {
      if (typeof ts === 'number' && ts > 0 && (Date.now() - ts) < PING_COOLDOWN_MS) {
        pingCooldownMap.set(key, ts);
      }
    }
  } catch { /* leer */ }
  pingCooldownsLoaded.add(guildId);
};
const isPingCooledDown = (guildId, userId, scope) => {
  const key = `${guildId}:${userId}:${scope}`;
  const lastAt = pingCooldownMap.get(key);
  return lastAt && (Date.now() - lastAt) < PING_COOLDOWN_MS;
};
const markPingSent = (guildId, userId, scope) => {
  const key = `${guildId}:${userId}:${scope}`;
  const now = Date.now();
  pingCooldownMap.set(key, now);
  // Persistent speichern (fire-and-forget)
  void guildData(guildId).then((data) => {
    data.pingCooldowns[key] = now;
    scheduleSave();
  }).catch(() => {});
  // Alte Einträge aufräumen (max. 10k)
  if (pingCooldownMap.size > 10_000) {
    const cutoff = now - PING_COOLDOWN_MS * 2;
    for (const [k, v] of pingCooldownMap) { if (v < cutoff) pingCooldownMap.delete(k); }
  }
};
const isPlacementPingEnabled = (data, userId) => !Object.hasOwn(data?.pingOptOuts || {}, String(userId || ''));
const setPlacementPingPreference = (data, userId, enabled) => {
  const id = String(userId || '').trim();
  if (!id) return true;
  data.pingOptOuts ||= {};
  if (enabled) delete data.pingOptOuts[id];
  else data.pingOptOuts[id] = new Date().toISOString();
  data.updatedAt = new Date().toISOString();
  return isPlacementPingEnabled(data, id);
};
const filterPlacementPingLinesByPreference = (lines, data) => (Array.isArray(lines) ? lines : [])
  .filter((line) => isPlacementPingEnabled(data, line?.userId));
const isCurrentPingInfoMessage = (data, messageId) => Boolean(messageId)
  && String(data?.panel?.pingInfo?.messageId || '') === String(messageId);
const sendPlacementPings = async (runtime, changes, conf, options = {}) => {
  const lines = placementPingLines(runtime, changes, conf);
  if (!lines.length) return 0;
  const lifetimeSeconds = Number.isFinite(options.lifetimeSeconds)
    ? Math.max(0, Number(options.lifetimeSeconds))
    : Number.isFinite(conf?.placementPingLifetimeMinutes)
      ? conf.placementPingLifetimeMinutes * 60
      : PING_AUTO_DELETE_MS / 1000;
  const autoDeleteMs = lifetimeSeconds * 1000;
  // Die Pings erscheinen im konfigurierten Ping-Kanal (oder im Ranglisten-Kanal)
  // und erwähnen die betroffenen Mitglieder. Mehrere Änderungen derselben Person
  // in einem Lauf werden zu einer Nachricht gebündelt, damit der Kanal lesbar bleibt.
  const channel = placementPingChannel(runtime.guild, conf);
  if (!channel) return 0;
  const guildId = runtime.guild.id;
  const preferences = await guildData(guildId);
  // Cooldown: Pro User + Scope max. 1 Ping pro 60 Minuten.
  const cooledLines = filterPlacementPingLinesByPreference(lines, preferences).filter((line) => {
    if (!line.scope) return true;
    return !isPingCooledDown(guildId, line.userId, line.scope);
  });
  if (!cooledLines.length) return 0;
  const byUser = new Map();
  for (const line of cooledLines) {
    if (!byUser.has(line.userId)) byUser.set(line.userId, []);
    byUser.get(line.userId).push(line);
  }
  let sent = 0;
  for (const [userId, userLines] of byUser.entries()) {
    // Direkter zweiter Check direkt vor dem Versand: Ein Opt-out, der während
    // eines größeren Ping-Laufs geklickt wurde, wirkt ohne Verzögerung.
    if (!isPlacementPingEnabled(preferences, userId)) continue;
    const member = runtime.guild.members.cache.get(userId);
    if (!member || member.user?.bot) continue;
    try {
      const message = await channel.send({
        content: composePingContent(userId, userLines, preferences, (id) => {
          const mentioned = runtime.guild.members.cache.get(id);
          return mentioned?.displayName || mentioned?.user?.username || '';
        })
      });
      // Nachrichten löschen sich selbst, damit der Kanal nicht mit Pings vollläuft.
      // Der Lösch-Termin wird zusätzlich persistiert, damit Pings auch nach einem
      // Bot-Ausfall entfernt werden (Catch-up beim nächsten Start bzw. Tick).
      const deleteAt = Date.now() + autoDeleteMs;
      armPendingPingDelete(runtime, channel, message, null, deleteAt);
      try {
        await registerPendingPingDelete(runtime.guild.id, channel.id, message.id, deleteAt);
      } catch {
        // Ledger nicht verfügbar – der In-Memory-Timer löscht die Nachricht trotzdem.
      }
      sent += 1;
      // Cooldown für alle Scopes dieses Users in dieser Nachricht setzen.
      for (const ul of userLines) {
        if (ul.scope) markPingSent(guildId, userId, ul.scope);
      }
    } catch {
      // Kanal nicht erreichbar – still ignorieren.
    }
    // Ping-Burst entzerren: Discord erlaubt nur 5 Nachrichten pro 5 s pro Kanal.
    // Nach einem Bot-Neustart mit Tages-Catch-up ändern sich oft mehrere
    // Platzierungen gleichzeitig – ohne Abstand warten alle aufs Rate-Limit.
    if (sent < byUser.size) {
      await new Promise((resolve) => setTimeout(resolve, 1150));
    }
  }
  return sent;
};
// Rang-Berechnung mit Gleichständen (gleicher Wert = gleiche Platzierung) und
// Sichtbarkeits-Grenze inklusive aller Gleichstände am Rand.
const computeRankings = (rows, limit = 3) => {
  if (!rows?.length) return { ranked: [], visible: [] };
  const boundedLimit = finiteInteger(limit, 3, 3, 20);
  const ranked = [];
  let lastValue = null;
  for (const entry of rows) {
    const value = Number(entry?.value || 0);
    const rank = lastValue === null || value !== lastValue ? ranked.length + 1 : ranked[ranked.length - 1].rank;
    ranked.push({ ...entry, rank });
    lastValue = value;
  }
  // Zähle DISTINCT RANG-GRUPPEN (nicht Einträge) für das Limit.
  // Bei Gleichstand (z.B. 2 Leute Rang 1 + 2 Leute Rang3) sollen 3 Display-
  // Plätze = 3 Rang-Gruppen sein, nicht 3 Einträge (= nur 2 Gruppen).
  const visible = [];
  let distinctRanks = 0;
  let lastVisibleRank = null;
  for (const entry of ranked) {
    if (entry.rank !== lastVisibleRank) {
      if (distinctRanks >= boundedLimit) break;
      distinctRanks += 1;
      lastVisibleRank = entry.rank;
    }
    visible.push(entry);
  }
  return { ranked, visible };
};
// Gruppiert sichtbare Einträge nach Rang – EIN Rank = EIN Platz im Embed.
// Bei Gleichstand (z.B. 2 Leute mit 5 Std. 38 Min.) teilen sich ALLE den
// selben Platz, anstatt als separate Zeilen angezeigt zu werden.
const computeRankGroups = (visible) => {
  const groups = [];
  let currentRank = null;
  for (const entry of visible) {
    if (entry.rank !== currentRank) {
      groups.push({ rank: entry.rank, members: [], value: entry.value });
      currentRank = entry.rank;
    }
    groups[groups.length - 1].members.push(entry);
  }
  return groups;
};
// Baut ein StringSelectMenu das die "weiteren" Mitglieder bei Gleichstand anzeigt.
// Nur hinzugefügt wenn es tatsächlich Ties gibt (sonst null).
const TIE_DROPDOWN_PREFIX = 'fh-activity-race:tie:';
const buildTieDropdown = (guild, snapshot, onlyPeriod = '') => {
  const options = [];
  const periods = onlyPeriod && PERIODS[onlyPeriod] ? [onlyPeriod] : ['daily', 'weekly', 'monthly'];
  for (const period of periods) {
    const rank = snapshot.periods?.[period];
    if (!rank?.chat && !rank?.voice) continue;
    const periodLabel = PERIODS[period]?.title || period;
    for (const [metric, label] of [['chat', 'Chat'], ['voice', 'Sprachchat']]) {
      const rows = rank[metric];
      if (!rows?.length) continue;
      const rankedRows = metric === 'voice'
        ? rows.map((r) => ({ ...r, value: Math.round(Number(r?.value || 0) / 60000) * 60000 }))
        : rows;
      const { visible } = computeRankings(rankedRows, snapshot.rankingDisplayCount);
      const groups = computeRankGroups(visible);
      for (const group of groups) {
        if (group.members.length <= 1) continue;
        const names = group.members.map((m) => {
          const member = guild?.members?.cache?.get?.(String(m.userId));
          return member?.displayName || member?.user?.username || `User ${m.userId}`;
        });
        const value = formatPositionValue(group.value, metric === 'voice' ? 'voiceMilliseconds' : 'messages');
        const optionLabel = `${periodLabel} ${label} – Platz ${group.rank} (${names.length} geteilt)`;
        options.push({
          label: String(optionLabel).slice(0, 100),
          value: `${TIE_DROPDOWN_PREFIX}${period}:${metric}:${group.rank}`,
          description: String(`${names.join(', ')} – ${value}`).slice(0, 100)
        });
      }
    }
  }
  if (!options.length) return null;
  // Discord erlaubt max25 Optionen pro Select Menu
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${PANEL_PREFIX}tie-details`)
      .setPlaceholder('Gleichstand-Details anzeigen…')
      .addOptions(options.slice(0, 25))
  );
};
const formatPositionValue = (value, metric) => metric === 'messages'
  ? `${Number(value || 0).toLocaleString('de-DE')} ${Number(value || 0) === 1 ? 'Nachricht' : 'Nachrichten'}`
  : formatVoice(value);
const rankingLines = (guild, rows, metric, emptyText = 'Noch keine Aktivität erfasst.', limit = 3, lineTemplate = '{marker} {mention}\n> **{value}**') => {
  // Voice-Werte auf Minuten runden für konsistente Rangvergabe
  const rankedRows = metric === 'voiceMilliseconds'
    ? (rows || []).map((r) => ({ ...r, value: Math.round(Number(r?.value || 0) / 60000) * 60000 }))
    : rows;
  const { visible } = computeRankings(rankedRows, limit);
  if (!visible.length) return `*${emptyText}*`;
  // Gruppiere nach Rang: EIN Rang = EINE Zeile im Embed.
  const groups = computeRankGroups(visible);
  return groups.map((group, displayIndex) => {
    const displayPosition = displayIndex + 1;
    const marker = displayPosition <= 3 ? trophyEmoji(guild, displayPosition) : `**Platz ${displayPosition}**`;
    const value = formatPositionValue(group.value, metric);
    if (group.members.length === 1) {
      // Kein Tie – eine Person
      return String(lineTemplate || '{marker} {mention}\n> **{value}**')
        .replaceAll('{marker}', marker)
        .replaceAll('{mention}', `<@${group.members[0].userId}>`)
        .replaceAll('{value}', value)
        .replaceAll('{rank}', String(group.rank));
    }
    // Tie – mehrere Personen auf demselben Platz: nur ERSTER Name + "(+X weitere)"
    const tieHint = ` *(+${group.members.length - 1} weitere)*`;
    return String(lineTemplate || '{marker} {mention}\n> **{value}**')
      .replaceAll('{marker}', marker)
      .replaceAll('{mention}', `<@${group.members[0].userId}>${tieHint}`)
      .replaceAll('{value}', value)
      .replaceAll('{rank}', String(group.rank));
  }).join('\n\n');
};
// Einzelne Platzhalter pro Platz (3.9.232): {chat1}…{chat3}, {chatValue1}…,
// {chatMarker1}… und {chatBlock1}… (komplette Zeile gemäß rankingLineTemplate) –
// für Sprachchat entsprechend mit {voice…}. Der Bot füllt nur die Werte; der
// Text um die Platzhalter herum ist im Embed Studio frei editierbar. Leere
// Plätze (z. B. nur 2 Wertungen oder Gleichstand) ergeben leere Platzhalter,
// damit die Zeile sauber zusammenfällt.
const buildPositionContext = (guild, rows, metric, options = {}) => {
  const prefix = metric === 'messages' ? 'chat' : 'voice';
  const lineTemplate = String(options.rankingLineTemplate || '{marker} {mention}\n> **{value}**');
  const displayCount = Math.min(3, finiteInteger(options.rankingDisplayCount, 3, 3, 20));
  // Voice-Werte auf Minuten runden, damit Users mit gleicher angezeigter Zeit
  // (z.B. beide 18 Std. 46 Min.) auch denselben Rang und dieselbe Trophäe bekommen.
  const rankedRows = metric === 'voiceMilliseconds'
    ? (rows || []).map((r) => ({ ...r, value: Math.round(Number(r?.value || 0) / 60000) * 60000 }))
    : rows;
  const { visible } = computeRankings(rankedRows, options.rankingDisplayCount);
  // Gruppiere nach Rang: EIN Rank = EINE Position im Embed.
  // Bei Gleichstand (z.B. 2 Leute mit 5 Std. 38 Min.) teilen sich ALLE
  // den selben Platz, anstatt als separate Platz 1/Platz 2 angezeigt zu werden.
  const groups = computeRankGroups(visible);
  const context = {};
  for (let position = 1; position <= 3; position += 1) {
    const group = groups[position - 1] || null;
    const entry = group ? group.members[0] : null;
    const marker = entry ? trophyEmoji(guild, position) : '';
    if (group && group.members.length === 1) {
      // Kein Tie – eine Person auf diesem Platz
      context[`${prefix}${position}`] = `<@${entry.userId}>`;
      context[`${prefix}Value${position}`] = formatPositionValue(entry.value, metric);
      context[`${prefix}Marker${position}`] = marker;
      context[`${prefix}Block${position}`] = lineTemplate
        .replaceAll('{marker}', marker)
        .replaceAll('{mention}', `<@${entry.userId}>`)
        .replaceAll('{value}', formatPositionValue(entry.value, metric))
        .replaceAll('{rank}', String(position));
      context[`${prefix}Tie${position}`] = '';
    } else if (group && group.members.length > 1) {
      // Tie – nur ERSTER Name + "(+X weitere)". Die restlichen Namen
      // stecken in {voiceTieN}/{chatTieN} für optionale Details.
      const tieHint = ` *(+${group.members.length - 1} weitere)*`;
      context[`${prefix}${position}`] = `<@${group.members[0].userId}>${tieHint}`;
      context[`${prefix}Value${position}`] = formatPositionValue(group.value, metric);
      context[`${prefix}Marker${position}`] = marker;
      context[`${prefix}Block${position}`] = lineTemplate
        .replaceAll('{marker}', marker)
        .replaceAll('{mention}', `<@${group.members[0].userId}>${tieHint}`)
        .replaceAll('{value}', formatPositionValue(group.value, metric))
        .replaceAll('{rank}', String(position));
      context[`${prefix}Tie${position}`] = group.members.map((e) => `<@${e.userId}>`).join(', ');
    } else {
      // Kein Eintrag auf diesem Platz
      context[`${prefix}${position}`] = '';
      context[`${prefix}Value${position}`] = '';
      context[`${prefix}Marker${position}`] = '';
      context[`${prefix}Block${position}`] = '';
      context[`${prefix}Tie${position}`] = '';
    }
  }
  return context;
};
// Migration 3.9.232/237: Das Platzhalter-Paket {chatRanking}/{voiceRanking}
// → einzelne Platz-Blöcke; 3.9.237: Alte {chatBlock}-Defaults → individuelle
// Platzhalter (Marker, Mention, Value) mit editierbarem Rahmen-Text.
const migratePanelFieldValue = (value) => {
  let v = String(value ?? '')
    .replaceAll('{chatRanking}', '{chatBlock1}\n\n{chatBlock2}\n\n{chatBlock3}')
    .replaceAll('{voiceRanking}', '{voiceBlock1}\n\n{voiceBlock2}\n\n{voiceBlock3}');
  if (v === '{chatBlock1}\n\n{chatBlock2}\n\n{chatBlock3}' || v === '{chatBlock1}\n{chatBlock2}\n{chatBlock3}') {
    v = '{chatMarker1} {chat1} > **{chatValue1}**\n{chatMarker2} {chat2} > **{chatValue2}**\n{chatMarker3} {chat3} > **{chatValue3}**';
  }
  if (v === '{voiceBlock1}\n\n{voiceBlock2}\n\n{voiceBlock3}' || v === '{voiceBlock1}\n{voiceBlock2}\n{voiceBlock3}') {
    v = '{voiceMarker1} {voice1} > **{voiceValue1}**\n{voiceMarker2} {voice2} > **{voiceValue2}**\n{voiceMarker3} {voice3} > **{voiceValue3}**';
  }
  return v;
};
const panelColorNumber = (value, fallback) => {
  const normalized = safeColor(value, '').replace('#', '');
  const parsed = Number.parseInt(normalized, 16);
  return Number.isFinite(parsed) ? parsed : fallback;
};
// Generische Platzhalter-Auflösung: Jeder String-Wert im Kontext ersetzt sein
// {key}-Gegenstück. So funktionieren neben den Basis-Platzhaltern ({server},
// {period}, …) auch die Einzel-Platzhalter pro Platz ({chat1}, {chatValue1},
// {chatBlock1}, {voice…}) automatisch, ohne jede Erweiterung hartzucodieren.
const formatPanelText = (value, context, maximum) => {
  let result = String(value || '');
  for (const [key, replacement] of Object.entries(context || {})) {
    const token = `{${key}}`;
    if (typeof replacement === 'string' && result.includes(token)) {
      // Leere Plätze müssen den Token ebenfalls entfernen. Sonst erscheinen
      // bei weniger als drei aktiven Mitgliedern rohe `{chatBlock3}`/
      // `{voiceBlock3}`-Tokens im Discord-Embed.
      result = result.split(token).join(replacement);
    }
  }
  // Nach dem Ersetzen: Zeilen die NUR aus orphaned Formatierung bestehen
  // (z.B. ‚╰ **‘ oder ‚> **‘ ohne Inhalt) entfernen.
  result = result.split('\n').filter((line) => {
    const trimmed = line.trim();
    // Leere Zeilen oder Zeilen mit nur Sperr-Connector/Blockquote + leerem Bold
    if (!trimmed) return true; // Leerzeilen beibehalten (Layout-Trennung)
    if (/^[╰╰]\s*\*+\s*$/.test(trimmed)) return false; // ‚╰ **‘ / ‚╰ ****‘ Artefakte
    if (/^>\s*\*+\s*$/.test(trimmed)) return false; // ‚> **‘ / ‚> ****‘ Artefakte
    return true;
  }).join('\n');
  return result.slice(0, maximum);
};
// Legt die Beschreibung des Liga-Embeds fest (3.9.228): Standardmäßig wird der
// AUSGESCHRIEBENE Vollständigkeits-Text der Periode angezeigt ({completion} →
// completionDaily/Weekly/Monthly) – KEINE feste Zeile wie „Die aktivsten
// Mitglieder …“ und kein Platzhalter-Paket. Das Modul-Feld panelDescription
// dient als optionaler eigener Text mit einzelnen Platzhaltern.
// Backfill: Alte Designs, die noch den festen Standardtext („Die aktivsten
// Mitglieder …“) oder {panelDescription} tragen, werden automatisch auf den
// ausgeschriebenen Completion-Text umgestellt – auch wenn der alte Text bereits
// als panelDescription in der Config gespeichert wurde.
const LEGACY_PANEL_DESCRIPTION_MARKER = 'Die aktivsten Mitglieder im Chat und Sprachchat';
const resolvePanelDescription = (designDescription, texts, context) => {
  const raw = String(designDescription || '');
  const savedDescription = String(texts.panelDescription || '').trim();
  const legacySaved = savedDescription.includes(LEGACY_PANEL_DESCRIPTION_MARKER);
  const template = legacySaved || raw.includes(LEGACY_PANEL_DESCRIPTION_MARKER) || raw.includes('{panelDescription}')
    ? (legacySaved ? '{completion}' : savedDescription || '{completion}')
    : raw;
  return formatPanelText(template, context, 4_096);
};
const buildPanelNavigation = (selected, conf = {}, period = 'daily') => {
  const texts = panelTexts(conf);
  const safePeriod = PERIODS[period] ? period : 'daily';
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PANEL_PREFIX}rules`)
      .setLabel(String(texts.rulesButtonLabel).slice(0, 80))
      .setStyle(selected === 'rules' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${PANEL_PREFIX}personal:${safePeriod}`)
      .setLabel(String(texts.personalButtonLabel).slice(0, 80))
      .setStyle(selected === 'personal' ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );
};

const pingInfoFingerprint = (conf = {}) => crypto.createHash('sha256')
  .update(JSON.stringify({ design: conf.pingInfoDesign || {}, label: conf.pingToggleButtonLabel || '' }))
  .digest('hex');
const buildPingInfoPanelPayload = async (guild, conf = {}) => {
  const label = String(conf.pingToggleButtonLabel || 'LIGA-PINGS EIN/AUS').slice(0, 80);
  const template = await materializeOutsideImageTemplate(conf.pingInfoDesign || {});
  const payload = await buildStudioEmbedPayload(template, guild, {
    formatValue: (value) => String(value || '')
      .replaceAll('{server}', guild?.name || 'FALLEN HEAVEN')
      .replaceAll('{buttonLabel}', label)
  });
  return {
    ...payload,
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PANEL_PREFIX}ping-toggle`)
        .setLabel(label)
        .setStyle(ButtonStyle.Secondary)
    )],
    allowedMentions: { parse: [] }
  };
};

const panelPeriodStatus = (period, rank) => {
  if (period === 'daily') return 'Live-Zwischenstand';
  return rank?.fullyTracked === true ? 'Abgeschlossen' : 'Teilweise erfasst';
};

/* Einzelnes Perioden-Embed für das 3-Embeds-Layout.
   Heute wird live gerendert. Woche und Monat stammen aus dem vorherigen
   abgeschlossenen Kalenderzeitraum und erscheinen nur mit vorhandenen Daten. */
const buildPeriodEmbed = (guild, snapshot, period) => {
  const meta = PERIODS[period];
  const rank = snapshot.periods[period];
  const visible = period === 'daily' ? true : rank?.visible !== false && Boolean(rank?.start && rank?.end);
  if (!visible) return null;
  const texts = snapshotTexts(snapshot);
  const completionRaw = period === 'daily'
    ? texts.completionDaily
    : period === 'weekly'
      ? texts.completionWeekly
      : texts.completionMonthly;
  const chatRanking = rankingLines(guild, rank.chat, 'messages', texts.rankingEmptyText, snapshot.rankingDisplayCount, texts.rankingLineTemplate);
  const voiceRanking = rankingLines(guild, rank.voice, 'voiceMilliseconds', texts.rankingEmptyText, snapshot.rankingDisplayCount, texts.rankingLineTemplate);
  // Einzel-Platzhalter pro Platz (3.9.232): Der Bot füllt {chat1}…{chat3},
  // {chatValue1}…, {chatMarker1}… und {chatBlock1}… – Text um die Platzhalter
  // herum ist im Embed Studio frei bearbeitbar.
  const chatPositions = buildPositionContext(guild, rank.chat, 'messages', {
    rankingLineTemplate: texts.rankingLineTemplate,
    rankingDisplayCount: snapshot.rankingDisplayCount
  });
  const voicePositions = buildPositionContext(guild, rank.voice, 'voiceMilliseconds', {
    rankingLineTemplate: texts.rankingLineTemplate,
    rankingDisplayCount: snapshot.rankingDisplayCount
  });
  const periodLabel = meta.title;
  const baseContext = {
    server: guild?.name || 'FALLEN HEAVEN',
    period: periodLabel,
    status: panelPeriodStatus(period, rank),
    completion: '',
    range: `${rank.start} – ${rank.end}`,
    nextEvaluation: nextPeriodLabel(period, snapshot.timezone),
    chatRanking,
    voiceRanking,
    ...chatPositions,
    ...voicePositions
  };
  // Die Completion selbst ist ein editierbarer Text mit inneren Platzhaltern
  // ({period}, {server}, {range}, {chatRanking} …) – erst auflösen, dann als
  // {completion} im Embed einsetzen.
  const completion = formatPanelText(completionRaw, baseContext, 4_096);
  // Die Status-Feld-Überschriften können über die Modul-Felder gesteuert werden
  // ({chatFieldName} usw. als Platzhalter in der Studio-Vorlage).
  const context = {
    ...baseContext,
    completion,
    chatFieldName: texts.chatFieldName,
    voiceFieldName: texts.voiceFieldName,
    nextEvaluationFieldName: texts.nextEvaluationFieldName,
    rangeFieldName: texts.rangeFieldName
  };
  // Status-Feld-Namen: Solange das Design exakt die Standard-Felder trägt, gelten
  // die Modul-Felder (chatFieldName usw.). Eigene Studio-Anpassungen gewinnen.
  const design = applyStatusFieldNames(normalizePanelDesign(snapshot.panelDesigns?.[period] || snapshot.panelDesign), texts);
  const embed = new EmbedBuilder()
    .setColor(panelColorNumber(design.embed.color, meta.color));
  // Die Embed-Studio-Vorlage gilt für jedes Perioden-Embed; {period}, {status},
  // {range} usw. werden pro Zeitraum ersetzt. Abgeschlossene Woche/Monat erhalten
  // zusätzlich einen klaren Hinweis auf die Rollenvergabe.
  const title = formatPanelText(design.embed.title, context, 256);
  // Panel-Beschreibung als editierbare Vorlage (3.9.222-Prinzip): Das Standard-
  // Design trägt {panelDescription}; bestehende Configs mit dem alten festen
  // Standardtext („Die aktivsten Mitglieder …“) werden beim Rendern automatisch
  // auf die Vorlage umgestellt (Backfill), damit die Zeile überall editierbar ist.
  const description = resolvePanelDescription(design.embed.description, texts, context);
  const authorName = formatPanelText(design.embed.authorName, context, 256);
  const footerText = formatPanelText(design.embed.footerText, context, 2_048);
  if (title) embed.setTitle(title);
  if (title && design.embed.url) embed.setURL(design.embed.url);
  if (description) embed.setDescription(description);
  if (authorName) embed.setAuthor({
    name: authorName,
    iconURL: design.embed.authorIconUrl || guild.iconURL?.({ size: 128 }) || undefined
  });
  if (design.embed.thumbnailUrl) embed.setThumbnail(design.embed.thumbnailUrl);
  if (design.embed.imageUrl) embed.setImage(design.embed.imageUrl);
  if (footerText) embed.setFooter({ text: footerText, iconURL: design.embed.footerIconUrl || undefined });
  if (design.embed.timestamp) embed.setTimestamp(new Date(snapshot.measuredAt));
  // Seit 3.9.231 sind die Status-Felder (CHAT, SPRACHCHAT, NÄCHSTE AUSWERTUNG,
  // ZEITRAUM) Teil der editierbaren Studio-Vorlage – der Bot ersetzt nur die
  // Platzhalter ({chatRanking}, {voiceRanking}, {nextEvaluation}, {range}).
  embed.addFields(design.embed.fields.map((field) => ({
    name: formatPanelText(field.name, context, 256) || '\u200b',
    value: formatPanelText(field.value, context, 1_024) || '\u200b',
    inline: field.inline === true
  })));
  // 3.9.229: KEINE hartkodierten Overrides mehr für Woche/Monat. Die
  // Rollenvergabe-Info ist Teil des editierbaren panelDescription-Texts
  // (Vollständigkeits-Text der Periode) und der Footer kommt aus dem Studio.
  return embed;
};
const buildPanelPayload = (guild, snapshot, options = {}) => {
  // Heute wird immer angezeigt. Vergangene Woche und vergangener Monat werden
  // nur gerendert, wenn der jeweilige historische Zeitraum Daten enthält.
  const embeds = ['daily', 'weekly', 'monthly']
    .map((key) => buildPeriodEmbed(guild, snapshot, key))
    .filter(Boolean);
  const design = normalizePanelDesign(snapshot.panelDesign);
  const texts = snapshotTexts(snapshot);
  const baseContext = {
    server: guild?.name || 'FALLEN HEAVEN',
    period: PERIODS.daily.title,
    status: 'Live-Zwischenstand',
    completion: '',
    range: `${snapshot.periods.daily?.start || '?'} – ${snapshot.periods.daily?.end || '?'}`,
    nextEvaluation: nextPeriodLabel('daily', snapshot.timezone)
  };
  const context = { ...baseContext, completion: formatPanelText(texts.completionDaily, baseContext, 4_096) };
  const savedAttachment = normalizePanelAttachment(design.outsideImageAttachment);
  const preserveAttachment = options.preserveAttachment === true && savedAttachment;
  const content = [
    formatPanelText(design.content, context, 2_000),
    options.outsideFile || preserveAttachment ? '' : design.outsideImageUrl
  ].filter(Boolean).join('\n').slice(0, 2_000);
  // Bei Gleichstand ein Dropdown hinzufügen das die "weiteren" Mitglieder anzeigt.
  const tieDropdown = buildTieDropdown(guild, snapshot);
  const components = [buildPanelNavigation('daily', snapshot.panelTexts || {})];
  if (tieDropdown) components.push(tieDropdown);
  const payload = {
    content: content || undefined,
    embeds,
    components,
    allowedMentions: { parse: [] }
  };
  if (options.outsideFile) {
    payload.files = [{ attachment: options.outsideFile, name: options.outsideFileName || 'fallen-heaven-activity.png' }];
    payload.attachments = [];
  } else if (preserveAttachment) {
    payload.attachments = [{ id: savedAttachment.id }];
  } else if (options.removeOutsideImage === true) {
    payload.attachments = [];
  }
  return payload;
};

const buildPeriodPanelPayload = (guild, snapshot, period, options = {}) => {
  if (!PERIODS[period]) return null;
  const embed = buildPeriodEmbed(guild, snapshot, period);
  if (!embed) return null;
  const design = normalizePanelDesign(snapshot.panelDesigns?.[period] || snapshot.panelDesign);
  const texts = snapshotTexts(snapshot);
  const rank = snapshot.periods?.[period] || {};
  const completionRaw = period === 'daily'
    ? texts.completionDaily
    : period === 'weekly'
      ? texts.completionWeekly
      : texts.completionMonthly;
  const baseContext = {
    server: guild?.name || 'FALLEN HEAVEN',
    period: PERIODS[period]?.title || period,
    status: panelPeriodStatus(period, rank),
    completion: '',
    range: `${rank.start || '?'} – ${rank.end || '?'}`,
    nextEvaluation: nextPeriodLabel(period, snapshot.timezone)
  };
  const context = { ...baseContext, completion: formatPanelText(completionRaw, baseContext, 4_096) };
  const savedAttachment = normalizePanelAttachment(design.outsideImageAttachment);
  const preserveAttachment = options.preserveAttachment === true && savedAttachment;
  const content = [
    formatPanelText(design.content, context, 2_000),
    options.outsideFile || preserveAttachment ? '' : design.outsideImageUrl
  ].filter(Boolean).join('\n').slice(0, 2_000);
  const components = [buildPanelNavigation(period, snapshot.panelTexts || {}, period)];
  const tieDropdown = buildTieDropdown(guild, snapshot, period);
  if (tieDropdown) components.push(tieDropdown);
  const payload = {
    content: content || undefined,
    embeds: [embed],
    components,
    allowedMentions: { parse: [] }
  };
  if (options.outsideFile) {
    payload.files = [{ attachment: options.outsideFile, name: options.outsideFileName || 'fallen-heaven-activity.png' }];
    payload.attachments = [];
  } else if (preserveAttachment) {
    payload.attachments = [{ id: savedAttachment.id }];
  } else if (options.removeOutsideImage === true) {
    payload.attachments = [];
  }
  return payload;
};

const personalRankingField = (rows, userId, metric, period = 'daily') => {
  const entry = rows?.find?.((row) => String(row.userId) === String(userId));
  if (!entry) return 'Noch keine belastbare Platzierung verfügbar.';
  const value = metric === 'messages'
    ? `${Number(entry.value || 0).toLocaleString('de-DE')} ${Number(entry.value || 0) === 1 ? 'Nachricht' : 'Nachrichten'}`
    : formatVoice(entry.value);
  const tied = rows.filter((row) => Number(row.value || 0) === Number(entry.value || 0)).length;
  const tie = tied > 1 ? `\nGleichstand mit ${tied - 1} ${tied === 2 ? 'weiteren Person' : 'weiteren Personen'}.` : '';
  const inactive = Number(entry.value || 0) > 0 ? '' : '\nIn diesem Zeitraum wurde in dieser Kategorie noch keine Aktivität gewertet.';
  return `Platz **${Number(entry.rank || 0)} von ${rows.length}**\n> **${value}**${tie}${inactive}`;
};

const buildPersonalRankPayload = (guild, snapshot, userId, period = 'daily') => {
  const selectedPeriod = PERIODS[period] ? period : 'daily';
  const rank = snapshot?.periods?.[selectedPeriod] || {};
  const member = guild?.members?.cache?.get?.(String(userId));
  const titlePrefix = selectedPeriod === 'daily' ? 'heutiger'
    : selectedPeriod === 'weekly' ? 'wöchentlicher'
      : 'monatlicher';
  const embed = new EmbedBuilder()
    .setColor(PERIODS[selectedPeriod].color)
    .setTitle(`Dein ${titlePrefix} Liga-Stand`)
    .setDescription('Deine persönliche Platzierung unter allen aktuellen Mitgliedern für genau diesen Zeitraum. Gleichstände erhalten denselben Rang.')
    .addFields(
      { name: 'CHAT-RANG', value: personalRankingField(rank.fullChat || [], userId, 'messages', selectedPeriod), inline: true },
      { name: 'SPRACHCHAT-RANG', value: personalRankingField(rank.fullVoice || [], userId, 'voiceMilliseconds', selectedPeriod), inline: true },
      { name: 'ZEITRAUM', value: `${rank.start || '?'} – ${rank.end || '?'}`, inline: false }
    )
    .setFooter({ text: 'Nur du siehst diese Ansicht · Gleichstände erhalten denselben Rang' })
    .setTimestamp(new Date(snapshot.measuredAt || Date.now()));
  const avatarUrl = resolveAvatarUrl(member, { size: 128, extension: 'png' });
  if (avatarUrl) embed.setThumbnail(avatarUrl);
  return {
    embeds: [embed],
    components: [buildPanelNavigation('personal', snapshot.panelTexts || {}, selectedPeriod)],
    allowedMentions: { parse: [] }
  };
};
const buildRulesPayload = (guild, conf, timezone) => {
  const embed = new EmbedBuilder()
    .setColor(0x6f7cff)
    .setAuthor({ name: 'FALLEN HEAVEN · AKTIVITÄTS-LIGA', iconURL: guild.iconURL?.({ size: 128 }) || undefined })
    .setTitle('Regeln und Wertung')
    .setDescription('Diese private Übersicht erklärt, welche Aktivität zählt und wann Rollen vergeben werden.')
    .addFields(
      {
        name: 'CHAT',
        value: `• Mindestens **${conf.minimumMessageLength} Buchstaben oder Zahlen**\n• Anhänge und Sticker zählen als Inhalt\n• Pro Person höchstens eine Wertung alle **${conf.messageCooldownSeconds} Sekunden**\n• Identische Nachrichten zählen innerhalb von **${conf.duplicateWindowMinutes} Minuten** nur einmal\n• Bots, Webhooks sowie ausgeschlossene Kanäle und Rollen zählen nicht`
      },
      {
        name: 'SPRACHCHAT',
        value: `• Mindestens **${conf.voiceMinimumParticipants} wertbare Personen** gemeinsam im Kanal\n• AFK-Kanal zählt nicht\n• Bots und ausgeschlossene Kanäle oder Rollen zählen nicht\n• Vollständig taube Zeit zählt ${conf.excludeDeafened ? '**nicht**' : '**mit**'}; normales Stummschalten ist erlaubt`
      },
      {
        name: 'ZEITRÄUME',
        value: `• **Tag:** 00:00 bis 23:59 Uhr\n• **Woche:** Montag bis Sonntag\n• **Monat:** vollständiger Kalendermonat\n• Zeitzone: **${timezone}**`
      },
      {
        name: 'ROLLENVERGABE',
        value: '• **Tageswertung:** Platz 1, 2 und 3 erhalten ihre Rollen live; beim Überholen wechseln die Rollen automatisch\n• **Wochenwertung:** Chat und Sprachchat werden nach einer vollständig erfassten Kalenderwoche getrennt vergeben\n• **Monatswertung:** Chat und Sprachchat werden nach einem vollständig erfassten Kalendermonat getrennt vergeben\n• Die **Trennerrolle** wird mit jeder Liga-Auszeichnung automatisch vergeben und nach der letzten Auszeichnung wieder entzogen\n• Nur die unvollständig erfasste Messart wird sicher übersprungen; vollständige Daten bleiben auszeichnungsfähig\n• Abgeschlossene Wochen- und Monatssieger behalten ihre Rolle bis zur nächsten gültigen Endwertung'
      }
    )
    .setFooter({ text: 'Diese Ansicht ist nur für dich sichtbar.' });
  return { embeds: [embed], components: [buildPanelNavigation('rules', conf)], allowedMentions: { parse: [] } };
};

const normalizedChannelName = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('de-DE').replace(/[^a-z0-9]/g, '');
const panelChannel = (guild, conf) => {
  const allowed = (channel) => channel && [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(Number(channel.type)) && channel.isTextBased?.();
  const configured = guild.channels.cache.get(String(conf.panelChannelId || ''));
  if (allowed(configured)) return configured;
  const channels = [...guild.channels.cache.values()].filter(allowed);
  return channels.find((channel) => normalizedChannelName(channel.name) === 'aktivitatliga')
    || channels.find((channel) => normalizedChannelName(channel.name).includes('aktivitatliga'))
    || null;
};
const hasCompleteRoleSet = (conf) => ACTIVITY_RACE_ROLE_DEFINITIONS.every((definition) => String(conf?.[definition.key] || '').trim());
const validatePanelPermissions = (channel) => {
  const permissions = channel.permissionsFor?.(channel.guild.members.me);
  const required = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory];
  if (!permissions || required.some((permission) => !permissions.has(permission, false))) throw new Error('Dem Bot fehlen im Ranglisten-Kanal Anzeigen, Schreiben, Einbetten oder Nachrichtenverlauf.');
};
const ensurePanel = async (runtime, {
  force = false,
  outsideFile = null,
  outsideFileName = '',
  removeOutsideImage = false,
  outsideImagePeriod = 'daily'
} = {}) => {
  if (!runtime.conf.enabled || !hasCompleteRoleSet(runtime.conf) || runtime.panelRunning) return null;
  if (!force && Date.now() - runtime.lastPanelAt < 55_000) return null;
  runtime.panelRunning = true;
  try {
    await reconcileActivityFromServerIndex(runtime);
    await settleVoice(runtime);
    await reconcileVoiceFromLogs(runtime);
    const data = await guildData(runtime.guild.id);
    // Cache zuerst: Der Gateway-Cache kennt normalerweise alle Kanäle. Nur
    // wenn der Auto-Detect im Cache nichts findet, wird einmal komplett von
    // Discord geladen – nicht bei jedem Panel-Refresh ein Vollabruf.
    let channel = panelChannel(runtime.guild, runtime.conf);
    if (!channel && !runtime.conf.panelChannelId) {
      await runtime.guild.channels.fetch().catch(() => null);
      channel = panelChannel(runtime.guild, runtime.conf);
    }
    if (!channel) throw new Error('Der Textkanal „aktivität-liga“ wurde nicht gefunden. Du kannst alternativ einen Kanal auswählen.');
    validatePanelPermissions(channel);
    const snapshot = buildPanelSnapshot(runtime.guild, data, runtime.conf, runtime.timezone);
    data.panel.messages ||= {};
    const legacyMessageId = String(data.panel.messageId || '');
    const results = {};
    let firstMessage = null;
    let outsideImageMessage = null;
    let periodMessageCreated = false;
    const targetOutsidePeriod = ['weekly', 'monthly'].includes(outsideImagePeriod) ? outsideImagePeriod : 'daily';
    for (const period of ['daily', 'weekly', 'monthly']) {
      const entry = data.panel.messages[period] || {};
      let message = null;
      if (entry.messageId && entry.channelId === channel.id) message = await channel.messages.fetch(entry.messageId).catch(() => null);
      if (!message && period === 'daily' && legacyMessageId && data.panel.channelId === channel.id) {
        message = await channel.messages.fetch(legacyMessageId).catch(() => null);
      }
      const designKey = panelDesignKeyForPeriod(period);
      const periodDesign = runtime.conf[designKey] || runtime.conf.panelDesign;
      const periodHasAttachment = Boolean(normalizePanelDesign(periodDesign).outsideImageAttachment);
      const isOutsideTarget = period === targetOutsidePeriod;
      const payload = buildPeriodPanelPayload(runtime.guild, snapshot, period, {
        outsideFile: isOutsideTarget ? outsideFile : null,
        outsideFileName,
        removeOutsideImage: isOutsideTarget && (removeOutsideImage || Boolean(message && !periodHasAttachment)),
        preserveAttachment: isOutsideTarget && Boolean(message && !outsideFile && !removeOutsideImage)
      });
      if (!payload) {
        if (message?.author?.id === runtime.guild.members.me?.id) await message.delete().catch(() => null);
        data.panel.messages[period] = { channelId: '', messageId: '' };
        continue;
      }
      if (!message) {
        message = await channel.send(payload);
        periodMessageCreated = true;
      } else await message.edit(payload);
      data.panel.messages[period] = { channelId: channel.id, messageId: message.id };
      results[period] = { channelId: channel.id, messageId: message.id };
      if (!firstMessage) firstMessage = message;
      if (isOutsideTarget) outsideImageMessage = message;
    }
    const previousPingInfo = data.panel.pingInfo || {};
    let pingInfoMessage = null;
    if (previousPingInfo.messageId && previousPingInfo.channelId === channel.id) {
      pingInfoMessage = await channel.messages.fetch(previousPingInfo.messageId).catch(() => null);
    }
    // Sobald ein Perioden-Embed neu unterhalb des Info-Panels entstanden ist,
    // wird nur das Info-Panel neu gesendet. So bleibt es garantiert die letzte
    // Liga-Nachricht, ohne die drei Ranking-Nachrichten anzufassen.
    if (pingInfoMessage && periodMessageCreated) {
      if (pingInfoMessage.author?.id === runtime.guild.members.me?.id) await pingInfoMessage.delete().catch(() => null);
      pingInfoMessage = null;
    }
    if (!pingInfoMessage && previousPingInfo.messageId && previousPingInfo.channelId && previousPingInfo.channelId !== channel.id) {
      const oldChannel = runtime.guild.channels.cache.get(previousPingInfo.channelId);
      await oldChannel?.messages?.fetch?.(previousPingInfo.messageId)
        .then((oldMessage) => oldMessage.author?.id === runtime.guild.members.me?.id ? oldMessage.delete() : null)
        .catch(() => null);
    }
    const infoFingerprint = pingInfoFingerprint(runtime.conf);
    if (!pingInfoMessage || previousPingInfo.fingerprint !== infoFingerprint) {
      const pingInfoPayload = await buildPingInfoPanelPayload(runtime.guild, runtime.conf);
      if (!pingInfoMessage) pingInfoMessage = await channel.send(pingInfoPayload);
      else await pingInfoMessage.edit(pingInfoPayload);
    }
    data.panel.pingInfo = {
      channelId: channel.id,
      messageId: String(pingInfoMessage?.id || ''),
      fingerprint: infoFingerprint
    };
    if (legacyMessageId && data.panel.channelId && data.panel.channelId !== channel.id) {
      const oldChannel = runtime.guild.channels.cache.get(data.panel.channelId);
      await oldChannel?.messages?.fetch?.(legacyMessageId).then((oldMessage) => oldMessage.delete()).catch(() => null);
    }
    data.panel = {
      channelId: channel.id,
      messageId: data.panel.messages.daily?.messageId || firstMessage?.id || '',
      messages: data.panel.messages,
      pingInfo: data.panel.pingInfo
    };
    scheduleSave();
    runtime.lastPanelAt = Date.now();
    runtime.lastPanelError = '';
    const attachment = outsideImageMessage?.attachments?.first?.();
    return {
      channelId: channel.id,
      messageId: data.panel.messageId,
      messages: results,
      pingInfo: { channelId: channel.id, messageId: data.panel.pingInfo.messageId },
      snapshot,
      outsideImageAttachment: attachment ? {
        id: String(attachment.id || ''),
        url: String(attachment.url || ''),
        name: String(attachment.name || outsideFileName || 'fallen-heaven-activity.png'),
        size: Number(attachment.size || 0)
      } : null
    };
  } catch (error) {
    runtime.lastPanelError = String(error?.message || error).slice(0, 500);
    throw error;
  } finally {
    runtime.panelRunning = false;
  }
};

const configuredAwardRoles = (conf) => Object.fromEntries(Object.keys(PERIODS).map((period) => [period, {
  chat: [1, 2, 3].map((place) => conf[placementRoleKey(period, 'Chat', place)]),
  voice: [1, 2, 3].map((place) => conf[placementRoleKey(period, 'Voice', place)])
}]));
const buildRoleAssignmentPlan = (conf, awards) => {
  const roles = configuredAwardRoles(conf);
  const separatorRoleId = String(conf?.separatorRoleId || '').trim();
  // Rolle → gewünschte Mitglieder (Array: bei Gleichstand mehrere User pro Platz).
  const desiredByRole = new Map();
  for (const period of Object.keys(PERIODS)) {
    for (const metric of ['chat', 'voice']) {
      // Tie-bewusst: exakt gleiche Werte erhalten denselben Platz – alle teilen
      // sich dann die Platz-Rolle, statt künstlich 1/2/3 verteilt zu werden.
      const groups = placementGroups(awards?.periods?.[period]?.[metric] || [], 3);
      roles[period][metric].forEach((roleId, index) => {
        if (roleId) desiredByRole.set(String(roleId), groups[index] || []);
      });
    }
  }
  const desiredRolesByUser = new Map();
  for (const [roleId, userIds] of desiredByRole.entries()) {
    for (const userId of userIds) {
      if (!userId) continue;
      if (!desiredRolesByUser.has(userId)) desiredRolesByUser.set(userId, []);
      desiredRolesByUser.get(userId).push(roleId);
    }
  }
  if (separatorRoleId) {
    for (const wanted of desiredRolesByUser.values()) {
      if (!wanted.includes(separatorRoleId)) wanted.push(separatorRoleId);
    }
  }
  return {
    roles,
    separatorRoleId,
    desiredByRole,
    desiredRolesByUser,
    managedRoleIds: [...new Set([...desiredByRole.keys(), separatorRoleId].filter(Boolean))]
  };
};
const configuredRoleSetIds = (conf) => ACTIVITY_RACE_ROLE_DEFINITIONS
  .map((definition) => String(conf?.[definition.key] || '').trim())
  .filter(Boolean);
const validateConfiguredRoleSet = async (runtime) => {
  const ids = configuredRoleSetIds(runtime.conf);
  if (ids.length !== ACTIVITY_RACE_ROLE_DEFINITIONS.length) {
    throw new Error('Das Aktivitäts-Liga-Rollenset ist unvollständig. Prüfe alle 19 Rollen im Modul.');
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error('Im Aktivitäts-Liga-Rollenset ist dieselbe Discord-Rolle mehrfach ausgewählt.');
  }
  if (ids.some((roleId) => !runtime.guild.roles.cache.has(roleId))) await runtime.guild.roles.fetch();
  const missing = ids.filter((roleId) => !runtime.guild.roles.cache.has(roleId));
  if (missing.length) throw new Error(`Aktivitäts-Liga-Rollen wurden auf Discord nicht gefunden: ${missing.join(', ')}`);
  const botMember = runtime.guild.members.me || await runtime.guild.members.fetchMe();
  if (!botMember?.permissions?.has?.(PermissionFlagsBits.ManageRoles)) throw new Error('Dem Bot fehlt „Rollen verwalten“.');
  const blocked = ids
    .map((roleId) => runtime.guild.roles.cache.get(roleId))
    .filter((role) => role?.managed || !role?.editable || Number(role?.position || 0) >= Number(botMember.roles?.highest?.position || 0));
  if (blocked.length) {
    throw new Error(`Diese Aktivitäts-Liga-Rollen liegen über der Bot-Rolle oder sind nicht verwaltbar: ${blocked.map((role) => `„${role.name}“`).join(', ')}`);
  }
  return ids;
};
const clearAwardRoles = async (runtime, sourceConf = runtime.conf) => {
  const roleIds = [...new Set([
    String(sourceConf?.separatorRoleId || '').trim(),
    ...Object.values(configuredAwardRoles(sourceConf)).flatMap((entry) => [...entry.chat, ...entry.voice])
  ].filter(Boolean))];
  if (!roleIds.length) return { removed: 0, errors: [] };
  let removed = 0;
  const errors = [];
  for (const member of runtime.guild.members.cache.values()) {
    const active = roleIds.filter((roleId) => member.roles.cache.has(roleId));
    if (!active.length || member.user?.bot) continue;
    try {
      const result = await applyManagedRolePolicy({
        member,
        removeRoleIds: active,
        reason: 'FALLEN HEAVEN Aktivitäts-Liga deaktiviert',
        verify: true,
        requireAll: false
      });
      removed += result.removedRoleIds.length;
    } catch (error) {
      errors.push({ userId: member.id, error: String(error?.message || error).slice(0, 300) });
    }
  }
  return { removed, errors };
};
const removePanel = async (runtime) => {
  const data = await guildData(runtime.guild.id);
  const entries = Object.values(data.panel.messages || {});
  if (data.panel.pingInfo?.messageId) entries.push(data.panel.pingInfo);
  if (data.panel.messageId) entries.push({ channelId: data.panel.channelId, messageId: data.panel.messageId });
  let removed = false;
  const seen = new Set();
  for (const entry of entries) {
    const key = `${entry.channelId}:${entry.messageId}`;
    if (!entry.channelId || !entry.messageId || seen.has(key)) continue;
    seen.add(key);
    const channel = runtime.guild.channels.cache.get(entry.channelId);
    const message = await channel?.messages?.fetch?.(entry.messageId).catch(() => null);
    if (message?.author?.id === runtime.guild.members.me?.id) {
      removed = true;
      await message.delete()
        .catch((error) => quietLog(QUIET_LOG_SCOPE.activityRace, error, `Ranglisten-Panel löschen fehlgeschlagen: Kanal ${entry.channelId}`));
    }
  }
  data.panel = {
    channelId: '',
    messageId: '',
    messages: Object.fromEntries(Object.keys(PERIODS).map((period) => [period, { channelId: '', messageId: '' }])),
    pingInfo: { channelId: '', messageId: '', fingerprint: '' }
  };
  scheduleSave();
  return removed;
};
const reconcileRoles = async (runtime, { force = false } = {}) => {
  if (!runtime.conf.enabled || !hasCompleteRoleSet(runtime.conf) || runtime.rolesRunning) return null;
  if (!force && Date.now() - runtime.lastRoleAt < 25_000) return null;
  runtime.rolesRunning = true;
  try {
    await reconcileActivityFromServerIndex(runtime);
    await settleVoice(runtime);
    await reconcileVoiceFromLogs(runtime);
    const data = await guildData(runtime.guild.id);
    ensureTrackingWindow(data, runtime.timezone);
    // Nach Updates/Offline-Starts wurde zunächst nur das enge jüngste Fenster
    // nachgezogen. Für Langzeitrollen einmalig den vollständigen relevanten
    // Bereich bestätigen; der persistierte Chat-Coverage-Marker verhindert
    // weitere Vollscans bei späteren 30-Sekunden-Abgleichen.
    const today = localDateKey(Date.now(), runtime.timezone);
    const requiredChatStart = completedPeriodRange('monthly', today).start;
    const chatCompleteFrom = String(data.trackingCompleteFromByMetric?.chat || data.trackingCompleteFrom || '');
    if (!chatCompleteFrom || chatCompleteFrom > requiredChatStart) {
      await reconcileActivityFromServerIndex(runtime, {
        force: true,
        rangeOverride: indexedBackfillRange(runtime.timezone)
      });
    }
    const snapshot = buildSnapshot(runtime.guild, data, runtime.conf, runtime.timezone);
    const awards = buildAwardSnapshot(runtime.guild, data, runtime.conf, runtime.timezone);
    await validateConfiguredRoleSet(runtime);
    const { desiredRolesByUser, managedRoleIds } = buildRoleAssignmentPlan(runtime.conf, awards);
    const affected = new Set([...desiredRolesByUser.keys()]);
    for (const member of runtime.guild.members.cache.values()) {
      if (managedRoleIds.some((roleId) => member.roles.cache.has(roleId))) affected.add(member.id);
    }
    // Platzierungs-Pings VOR den Rollen-API-Calls senden: Die Ping-Nachricht
    // soll genauso schnell erscheinen wie das Embed-Update und nicht erst,
    // nachdem alle Rollen-Änderungen über die Discord-API durch sind.
    // Nur wenn sich die REIHENFOLGE der Top-3 geändert hat, wird gepingt.
    // => Kein Spam mehr bei jedem Tick weil Voice-Time um 1 Sek. steigt.
    // Persistenter Fingerprint überlebt Neustarts – beim ersten Durchlauf
    // wird der gespeicherte Stand geladen, damit nach einem Neustart nicht
    // sofort alle Pings feuern.
    await ensurePingCooldownsLoaded(runtime.guild.id);
    const currentFingerprint = {};
    for (const period of Object.keys(PERIODS)) {
      for (const metric of ['chat', 'voice']) {
        const scopeKey = `${period}.${metric}`;
        const groups = placementGroups(awards?.periods?.[period]?.[metric] || [], 3);
        currentFingerprint[scopeKey] = groups.flat().slice(0, 3).join(',');
      }
    }
    const prevFingerprint = runtime.previousRankingFingerprint || data.rankingFingerprint || {};
    const rankingChanged = Object.keys(currentFingerprint).some(
      (key) => currentFingerprint[key] !== prevFingerprint[key]
    );
    runtime.previousRankingFingerprint = currentFingerprint;
    // Persistent speichern (fire-and-forget)
    data.rankingFingerprint = { ...currentFingerprint };
    scheduleSave();
    const plannedChanges = [];
    for (const userId of affected) {
      const member = runtime.guild.members.cache.get(userId);
      if (!member || member.user?.bot) continue;
      const wanted = desiredRolesByUser.get(userId) || [];
      const remove = managedRoleIds.filter((roleId) => member.roles.cache.has(roleId) && !wanted.includes(roleId));
      const add = wanted.filter((roleId) => !member.roles.cache.has(roleId));
      if (add.length || remove.length) plannedChanges.push({ userId, addedRoleIds: add, removedRoleIds: remove });
    }
    // Ping NUR wenn sich die Rangfolge geändert hat (jemand hat überholt/abgestiegen)
    // UND der Bot mindestens einmal die Rollen synchronisiert hat (Baseline).
    // Erst nach dem ersten成功的 Rollen-Sync wird ge pingt, damit
    // nach einem Neustart erstmal die Basislinie steht.
    if (plannedChanges.length && runtime.placementPingReady && rankingChanged) {
      await sendPlacementPings(runtime, plannedChanges, runtime.conf);
    }
    const changes = [];
    const errors = [];
    for (const userId of affected) {
      const member = runtime.guild.members.cache.get(userId);
      if (!member || member.user?.bot) continue;
      const wanted = desiredRolesByUser.get(userId) || [];
      const remove = managedRoleIds.filter((roleId) => member.roles.cache.has(roleId) && !wanted.includes(roleId));
      try {
        const result = await applyManagedRolePolicy({
          member,
          addRoleIds: wanted,
          removeRoleIds: remove,
          reason: 'FALLEN HEAVEN Aktivitäts-Liga · Live-Tag und abgeschlossene Langzeitwertung',
          verify: true,
          requireAll: false
        });
        if (result.changed) changes.push({ userId, addedRoleIds: result.addedRoleIds, removedRoleIds: result.removedRoleIds });
        for (const blocked of result.blocked || []) {
          errors.push({ userId, roleId: blocked.roleId, error: String(blocked.reason || 'Rolle konnte nicht verwaltet werden.').slice(0, 300) });
        }
      } catch (error) {
        errors.push({ userId, error: String(error?.message || error).slice(0, 300) });
      }
    }
    // Der erste Lauf nach Start/Aktivierung ist die Baseline: Die Rollen werden
    // erstmals synchronisiert und lösen bewusst keine Platzierungs-Pings aus.
    // (Die Pings wurden oben bereits vor den Rollen-API-Calls gesendet –
    // dieser Block bleibt für die Baseline-Flag und Fehler-Härtung erhalten.)
    runtime.placementPingReady = true;
    // Soeben abgeschlossene Woche/Monat einmalig ankündigen (Sieger + Trophys).
    // Erst nach dem Rollen-Abgleich, damit ein Fehler oben nicht den Zeitraum
    // als 'angekündigt' verbrennt – beim nächsten Lauf wird erneut versucht.
    await announceCompletedPeriods(runtime, data, awards, runtime.conf);
    let holdersChanged = false;
    for (const period of Object.keys(PERIODS)) {
      const nextHolders = {
        chat: awards.periods[period].chatWinnerIds,
        voice: awards.periods[period].voiceWinnerIds
      };
      const nextRange = { start: awards.periods[period].start, end: awards.periods[period].end };
      if (JSON.stringify(data.holders[period]) !== JSON.stringify(nextHolders)
        || JSON.stringify(data.holderRanges?.[period]) !== JSON.stringify(nextRange)) holdersChanged = true;
      data.holders[period] = nextHolders;
      data.holderRanges ||= {};
      data.holderRanges[period] = nextRange;
    }
    if (holdersChanged) {
      data.updatedAt = new Date().toISOString();
      scheduleSave();
    }
    runtime.lastRoleAt = Date.now();
    runtime.lastRoleError = errors[0]?.error || '';
    return { changes, errors, snapshot, awards };
  } catch (error) {
    runtime.lastRoleError = String(error?.message || error).slice(0, 500);
    throw error;
  } finally {
    runtime.rolesRunning = false;
  }
};

const scheduleRoleReconcile = (runtime) => {
  if (runtime.roleTimer) return;
  runtime.roleTimer = setTimeout(() => void reconcileRoles(runtime, { force: true }).catch((error) => {
    runtime.lastRoleError = String(error?.message || error).slice(0, 500);
  }).finally(() => { runtime.roleTimer = null; }), ROLE_RECONCILE_DEBOUNCE_MS);
  runtime.roleTimer.unref?.();
};
const schedulePanelRefresh = (runtime) => {
  if (runtime.panelTimer) return;
  runtime.panelTimer = setTimeout(() => {
    runtime.panelTimer = null;
    void ensurePanel(runtime, { force: true }).catch(() => null);
  }, PANEL_REFRESH_DEBOUNCE_MS);
  runtime.panelTimer.unref?.();
};
const startRuntime = (runtime) => {
  clearInterval(runtime.tickTimer);
  runtime.tickTimer = setInterval(() => {
    // Index-Nachzug nur über das enge Fenster (letzte 3 Tage) statt der
    // 400-Tage-Retention – die Live-Zählung deckt alles laufend ab.
    void reconcileActivityFromServerIndex(runtime, { rangeOverride: recentBackfillRange(runtime.timezone) })
      .then(() => settleVoice(runtime))
      .then(() => reconcileVoiceFromLogs(runtime))
      .then(() => {
        scheduleRoleReconcile(runtime);
        schedulePanelRefresh(runtime);
        void guildData(runtime.guild.id).then((data) => { if (pruneOldDays(data, runtime.timezone)) scheduleSave(); });
        // Heartbeat: minütlich in die winzige separate Datei persistieren.
        void touchHeartbeat(runtime.guild.id).then(() => { if (heartbeatPersistDue(runtime)) scheduleHeartbeatSave(); });
        // Sicherheitsnetz: überfällige Ping-Löschungen auch zwischendurch nachholen.
        void catchUpPendingPingDeletes(runtime).catch(() => null);
        // Drosselter Discord-Nachzug (max. alle 10 Minuten) als Sicherheitsnetz.
        void recoverDailyMessagesFromDiscord(runtime).catch(() => null);
      })
      .catch((error) => { runtime.lastError = String(error?.message || error).slice(0, 500); });
  }, TICK_MS);
  runtime.tickTimer.unref?.();
};

const rolePlanSignature = (guildId, conf, entries) => JSON.stringify({ guildId, names: entries.map((entry) => [entry.key, entry.name, entry.action, entry.roleId]), ids: ACTIVITY_RACE_ROLE_DEFINITIONS.map((definition) => conf[definition.key]) });
const cleanExpiredRolePlans = () => {
  const now = Date.now();
  for (const [token, plan] of rolePlans.entries()) if (plan.expiresAt <= now) rolePlans.delete(token);
};
export const previewActivityRaceRoleSet = async ({ guild, conf = {} } = {}) => {
  if (!guild) throw new Error('Server wurde nicht gefunden.');
  cleanExpiredRolePlans();
  await guild.roles.fetch().catch(() => null);
  const normalized = normalizeConfig(conf);
  const botMember = guild.members.me || await guild.members.fetchMe();
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) throw new Error('Dem Bot fehlt „Rollen verwalten“.');
  const entries = ACTIVITY_RACE_ROLE_DEFINITIONS.map((definition) => {
    const configured = normalized[definition.key] ? guild.roles.cache.get(normalized[definition.key]) : null;
    const exact = !configured ? guild.roles.cache.find((role) => !role.managed && role.name === normalized[definition.nameKey] && role.editable) : null;
    const role = configured || exact || null;
    return {
      key: definition.key,
      nameKey: definition.nameKey,
      label: definition.label,
      name: normalized[definition.nameKey],
      color: definition.color,
      roleId: role?.id || '',
      action: configured && configured.name !== normalized[definition.nameKey] ? 'rename' : configured ? 'configured' : exact ? 'reuse' : 'create',
      assignable: role ? role.editable === true : true
    };
  });
  const invalid = entries.filter((entry) => entry.roleId && !entry.assignable);
  if (invalid.length) throw new Error(`Nicht verwaltbare Rollen: ${invalid.map((entry) => entry.name).join(', ')}`);
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = Date.now() + 5 * 60_000;
  rolePlans.set(token, { guildId: guild.id, conf: normalized, entries, signature: rolePlanSignature(guild.id, normalized, entries), expiresAt });
  return {
    token,
    expiresAt: new Date(expiresAt).toISOString(),
    entries,
    createCount: entries.filter((entry) => entry.action === 'create').length,
    renameCount: entries.filter((entry) => entry.action === 'rename').length,
    reuseCount: entries.filter((entry) => entry.action === 'reuse').length,
    configuredCount: entries.filter((entry) => entry.action === 'configured').length
  };
};
export const createActivityRaceRoleSet = async ({ guild, token, actorId = '' } = {}) => {
  cleanExpiredRolePlans();
  const plan = rolePlans.get(String(token || ''));
  if (!plan || plan.guildId !== guild?.id) throw new Error('Die Rollenvorschau ist abgelaufen. Bitte prüfe das Set erneut.');
  rolePlans.delete(String(token));
  await guild.roles.fetch();
  const patch = {};
  const created = [];
  const renamed = [];
  const reused = [];
  for (const entry of plan.entries) {
    let role = entry.roleId ? guild.roles.cache.get(entry.roleId) : null;
    if (!role && entry.action === 'reuse') role = guild.roles.cache.find((candidate) => !candidate.managed && candidate.name === entry.name && candidate.editable);
    if (!role) {
      role = await guild.roles.create({
        name: entry.name,
        color: entry.color,
        hoist: false,
        mentionable: false,
        permissions: [],
        reason: `Aktivitäts-Liga-Rollenset bestätigt${actorId ? ` von ${actorId}` : ''}`
      });
      created.push({ id: role.id, name: role.name, key: entry.key });
    } else if (entry.action === 'rename') {
      role = await role.edit({
        name: entry.name,
        color: entry.color,
        reason: `Aktivitäts-Liga-Rollenname bestätigt${actorId ? ` von ${actorId}` : ''}`
      });
      renamed.push({ id: role.id, name: role.name, key: entry.key });
    } else reused.push({ id: role.id, name: role.name, key: entry.key });
    patch[entry.key] = role.id;
  }
  return { patch, created, renamed, reused, entries: plan.entries.map((entry) => ({ ...entry, roleId: patch[entry.key] })) };
};

export const getActivityRaceSnapshot = async (guild) => {
  if (!guild) throw new Error('Server wurde nicht gefunden.');
  // Manuelle Snapshot-Abfrage (Nutzer öffnet die Seite): Cooldown umgehen,
  // damit die Mitgliederliste nach einem Neustart sofort vollständig ist.
  await ensureCompleteMemberCache(guild, { force: true });
  const runtime = runtimes.get(String(guild.id));
  const conf = runtime?.conf || normalizeConfig();
  if (runtime) {
    await reconcileActivityFromServerIndex(runtime, { rangeOverride: recentBackfillRange(runtime.timezone) });
    await settleVoice(runtime);
    await reconcileVoiceFromLogs(runtime);
  }
  const data = await guildData(guild.id);
  const timezone = runtime?.timezone || 'Europe/Berlin';
  if (conf.enabled) ensureTrackingWindow(data, timezone);
  const snapshot = attachFullRankings(guild, data, buildPanelSnapshot(guild, data, conf, timezone), timezone);
  return {
    ...snapshot,
    awards: buildAwardSnapshot(guild, data, conf, timezone),
    enabled: conf.enabled,
    panel: { ...data.panel, selectedPeriod: 'daily', lastError: runtime?.lastPanelError || '' },
    indexBackfill: { ...data.indexBackfill },
    voiceIndexBackfill: { ...data.voiceIndexBackfill },
    roles: ACTIVITY_RACE_ROLE_DEFINITIONS.map((definition) => ({
      key: definition.key,
      label: definition.label,
      name: conf[definition.nameKey],
      roleId: conf[definition.key],
      exists: Boolean(conf[definition.key] && guild.roles.cache.has(conf[definition.key]))
    })),
    lastRoleError: runtime?.lastRoleError || '',
    storedDays: Object.keys(data.days || {}).length
  };
};
// Liefert die aktuellen Top-3-User-IDs der Tageswertung (Chat + Sprachchat) –
// genutzt vom Leveling für den täglichen Aktivitäts-Bonus.
export const getDailyTopMemberIds = async (guild, timezone = 'Europe/Berlin') => {
  if (!guild?.id) return { chat: [], voice: [] };
  const data = await guildData(guild.id);
  const snapshot = periodSnapshot(guild, data, {}, 'daily', timezone);
  return { chat: snapshot.chatWinnerIds, voice: snapshot.voiceWinnerIds };
};

export const refreshActivityRace = async ({ guild, conf } = {}) => {
  const runtime = ensureRuntime(guild, conf);
  runtime.timezone = String(conf?.generalTimezone || runtime.timezone || 'Europe/Berlin');
  const backfill = await reconcileActivityFromServerIndex(runtime, { force: true });
  const recovered = await recoverDailyMessagesFromDiscord(runtime, { force: true }).catch(() => null);
  const roles = await reconcileRoles(runtime, { force: true });
  const panel = await ensurePanel(runtime, { force: true });
  return { backfill, recovered, roles, panel };
};

export const applyActivityRacePanelDesign = async ({
  guild,
  conf = {},
  panelDesign = {},
  section = 'daily',
  panelChannelId = '',
  outsideFile = null,
  outsideFileName = '',
  removeOutsideImage = false
} = {}) => {
  if (!guild) throw new Error('Server wurde nicht gefunden.');
  if (outsideFile && outsideFile.length > 25 * 1024 * 1024) throw new Error('Das Außenbild darf maximal 25 MB groß sein.');
  const designKey = panelDesignKeyForPeriod(section);
  let nextDesign = normalizePanelDesign(panelDesign);
  if (outsideFile) {
    nextDesign.outsideImageUrl = '';
    nextDesign.outsideImageAttachment = null;
  }
  if (removeOutsideImage) {
    nextDesign.outsideImageUrl = '';
    nextDesign.outsideImageAttachment = null;
  }
  const runtime = ensureRuntime(guild, {
    ...conf,
    panelChannelId: String(panelChannelId || conf?.panelChannelId || '').trim(),
    [designKey]: nextDesign
  });
  runtime.timezone = String(conf?.generalTimezone || runtime.timezone || 'Europe/Berlin');

  let panel = null;
  if (outsideFile && (!runtime.conf.enabled || !hasCompleteRoleSet(runtime.conf))) {
    throw new Error('Aktiviere und bestätige zuerst das Aktivitäts-Liga-Rollenset, bevor du ein Bild vom PC dauerhaft in das Live-Panel lädst. Bild-URLs kannst du bereits vorher speichern.');
  }
  if (runtime.conf.enabled && hasCompleteRoleSet(runtime.conf)) {
    panel = await ensurePanel(runtime, {
      force: true,
      outsideFile,
      outsideFileName: String(outsideFileName || 'fallen-heaven-activity.png').replace(/[^a-z0-9._-]/gi, '_').slice(-120),
      removeOutsideImage,
      outsideImagePeriod: section
    });
    if (outsideFile && panel?.outsideImageAttachment) {
      nextDesign.outsideImageUrl = panel.outsideImageAttachment.url;
      nextDesign.outsideImageAttachment = normalizePanelAttachment(panel.outsideImageAttachment);
      runtime.conf[designKey] = normalizePanelDesign(nextDesign);
    }
  }
  return {
    panelDesign: normalizePanelDesign(nextDesign),
    panelDesignKey: designKey,
    panelChannelId: runtime.conf.panelChannelId,
    panel
  };
};

// Beim Entfernen eines Servers alle Ressourcen freigeben: Timer stoppen,
// Voice-States und Maps der Guild löschen – sonst bleibt der Runtime-Eintrag
// samt Intervallen für immer im Speicher (Leak bei vielen Serverwechseln).
const releaseRuntime = (guildId) => {
  const id = String(guildId || '');
  const runtime = runtimes.get(id);
  if (runtime) {
    clearInterval(runtime.tickTimer);
    clearTimeout(runtime.roleTimer);
    clearTimeout(runtime.panelTimer);
    runtime.voiceStates.clear();
    runtimes.delete(id);
  }
  const prefix = `${id}:`;
  for (const key of messageGuards.keys()) if (String(key).startsWith(prefix)) messageGuards.delete(key);
  for (const [key, entry] of pendingPingDeleteTimers) {
    if (String(entry?.guildId || '') === id) {
      const timer = entry?.timer;
      if (timer) clearTimeout(timer);
      pendingPingDeleteTimers.delete(key);
    }
  }
  return Boolean(runtime);
};

// Sauberes Herunterfahren: Heartbeat für alle bekannten Server sofort
// persistieren, damit das Offline-Fenster beim nächsten Start exakt ist
// (statt erst beim nächsten minütlichen Heartbeat). Wird von index.js bei
// SIGINT/SIGTERM aufgerufen – ein Absturz/Power-Loss deckt der minütliche
// Heartbeat ab (Fenster startet dann max. ~90 s vor dem echten Ausfall).
export const recordActivityRaceShutdown = async () => {
  try {
    const store = await ensureHeartbeatLoaded();
    const now = new Date().toISOString();
    const guildIds = Object.keys(store?.guilds || {});
    if (!guildIds.length) return;
    for (const guildId of guildIds) store.guilds[guildId] = now;
    await flushHeartbeat();
  } catch (error) {
    console.warn(`[activityRace] Shutdown-Marker fehlgeschlagen: ${error?.message || error}`);
  }
};

export const feature = {
  id: 'activityRace',
  name: 'Aktivitäts-Liga',
  commands: [],
  async onGuildDelete({ guild }) {
    await ensureLoaded();
    releaseRuntime(guild?.id);
  },
  async onClientReady({ guild, cfg }) {
    await ensureLoaded();
    await guild.members.fetch().catch(() => null);
    const runtime = ensureRuntime(guild, cfg?.activityRace);
    runtime.timezone = String(cfg?.general?.timezone || 'Europe/Berlin');
    runtime.voiceLogConfig = { ...(cfg?.voiceLogImport || {}) };
    hydrateVoiceStates(runtime);
    if (runtime.conf.enabled) startRuntime(runtime);
    // Pings nachholen, deren Lösch-Zeitpunkt während eines Bot-Ausfalls ablief.
    await catchUpPendingPingDeletes(runtime).catch(() => null);
    const data = await guildData(guild.id);
    if (pruneOldDays(data, runtime.timezone)) scheduleSave();
    if (runtime.conf.enabled) {
      const offline = await computeOfflineWindow(guild.id);
      if (offline?.kind === 'offline') {
        // Chat lässt sich aus Nachrichten und Index exakt nachziehen. Voice
        // bleibt unangetastet, weil Discord keine historische Call-Belegung
        // liefert und die aktuelle Besetzung keinen Rückschluss erlaubt.
        const today = localDateKey(offline.untilMs, runtime.timezone);
        const startDay = localDateKey(offline.sinceMs, runtime.timezone);
        await reconcileActivityFromServerIndex(runtime, {
          force: true,
          rangeOverride: { start: startDay, end: today, endExclusive: shiftDateKey(today, 1) }
        }).catch(() => null);
        await recoverDailyMessagesFromDiscord(runtime, { force: true, sinceMs: offline.sinceMs }).catch(() => null);
        await recordOfflineWindow(guild.id, offline);
      } else if (offline?.kind === 'first-boot') {
        // Erststart (nie ein Heartbeat): einmaliger Voll-Nachzug der Historie.
        await reconcileActivityFromServerIndex(runtime, { force: true }).catch(() => null);
        await recoverDailyMessagesFromDiscord(runtime, { force: true }).catch(() => null);
      }
      await runVoiceLogBackfill({
        guild,
        cfg: { voiceLogImport: runtime.voiceLogConfig || {} },
        source: 'activity-race'
      }).catch((error) => {
        runtime.lastError = `Voice-Backfill: ${String(error?.message || error).slice(0, 450)}`;
      });
      await reconcileVoiceFromLogs(runtime).catch((error) => {
        runtime.lastError = `Voice-Index: ${String(error?.message || error).slice(0, 450)}`;
      });
      // Sauberer Lauf (kein Ausfall, kein Erststart): keine Voll-Scans nötig –
      // die Live-Zählung und der enge Tick-Nachzug decken alles ab.
      await reconcileRoles(runtime, { force: true }).catch((error) => { runtime.lastRoleError = String(error?.message || error); });
      await ensurePanel(runtime, { force: true }).catch((error) => { runtime.lastPanelError = String(error?.message || error); });
    }
  },
  async onConfigUpdate({ guild, cfg }) {
    const existing = runtimes.get(String(guild.id));
    const previousConf = existing?.conf || normalizeConfig(cfg?.activityRace);
    if (existing) await settleVoice(existing);
    const runtime = ensureRuntime(guild, cfg?.activityRace);
    runtime.timezone = String(cfg?.general?.timezone || 'Europe/Berlin');
    runtime.voiceLogConfig = { ...(cfg?.voiceLogImport || {}) };
    if (!runtime.tickTimer && runtime.conf.enabled) { hydrateVoiceStates(runtime); startRuntime(runtime); }
    if (runtime.conf.enabled) {
      scheduleRoleReconcile(runtime);
      schedulePanelRefresh(runtime);
    } else if (previousConf.enabled) {
      clearInterval(runtime.tickTimer);
      runtime.tickTimer = null;
      clearTimeout(runtime.roleTimer);
      clearTimeout(runtime.panelTimer);
      runtime.roleTimer = null;
      runtime.panelTimer = null;
      await clearAwardRoles(runtime, previousConf);
      await removePanel(runtime);
    }
  },
  async onMessageCreate({ message, cfg }) {
    const runtime = ensureRuntime(message.guild, cfg?.activityRace);
    runtime.timezone = String(cfg?.general?.timezone || 'Europe/Berlin');
    if (!shouldCountMessage(message, runtime.conf)) return;
    const data = await guildData(message.guildId);
    ensureDayUser(data, runtime.timezone, message.author.id, message.createdTimestamp).messages += 1;
    data.updatedAt = new Date().toISOString();
    scheduleSave();
    scheduleRoleReconcile(runtime);
    schedulePanelRefresh(runtime);
  },
  async onVoiceStateUpdate({ oldState, newState, cfg, guild }) {
    const runtime = ensureRuntime(guild, cfg?.activityRace);
    runtime.timezone = String(cfg?.general?.timezone || 'Europe/Berlin');
    await settleVoice(runtime, Date.now(), { reconcile: false });
    const userId = String(newState?.id || oldState?.id || '');
    if (!userId || newState?.member?.user?.bot || oldState?.member?.user?.bot) runtime.voiceStates.delete(userId);
    else if (newState?.channelId) runtime.voiceStates.set(userId, voiceStateRow(newState));
    else runtime.voiceStates.delete(userId);
    scheduleRoleReconcile(runtime);
    schedulePanelRefresh(runtime);
  },
  async onGuildMemberUpdate({ newMember, cfg, guild }) {
    const runtime = ensureRuntime(guild, cfg?.activityRace);
    if (!runtime.voiceStates.has(newMember.id)) return;
    await settleVoice(runtime);
    const state = newMember.voice;
    if (state?.channelId) runtime.voiceStates.set(newMember.id, voiceStateRow(state));
  },
  async onGuildMemberRemove({ member, cfg, guild }) {
    const runtime = ensureRuntime(guild, cfg?.activityRace);
    await settleVoice(runtime);
    runtime.voiceStates.delete(String(member.id));
    scheduleRoleReconcile(runtime);
    schedulePanelRefresh(runtime);
  },
  async onAnyInteraction({ interaction, cfg, guild }) {
    // Button-Interaktionen: Rules, Personal, etc.
    if (interaction.isButton?.() && String(interaction.customId || '').startsWith(PANEL_PREFIX)) {
      const view = String(interaction.customId).slice(PANEL_PREFIX.length);
      const [kind, period] = view.split(':');
      if (kind === 'ping-toggle') return await handlePingToggleButton(interaction, guild);
      if (!['rules', 'personal'].includes(kind)) return;
      return await handlePanelButton(interaction, cfg, guild, kind, period);
    }
    // Select Menu: Gleichstand-Details
    if (interaction.isStringSelectMenu?.() && String(interaction.customId || '').startsWith(PANEL_PREFIX)) {
      const view = String(interaction.customId).slice(PANEL_PREFIX.length);
      if (view !== 'tie-details') return;
      return await handleTieDetails(interaction, cfg, guild);
    }
  }
};

const handlePingToggleButton = async (interaction, guild) => {
  if (interaction.user?.bot) return;
  const acknowledged = await interaction.deferReply({ flags: MessageFlags.Ephemeral }).then(() => true).catch(() => false);
  if (!acknowledged) return;
  const data = await guildData(guild.id);
  if (!isCurrentPingInfoMessage(data, interaction.message?.id)) {
    await interaction.editReply('Dieses Liga-Ping-Panel ist nicht mehr aktuell. Nutze bitte den neuesten Button im Liga-Kanal.').catch(() => null);
    return;
  }
  const enabled = setPlacementPingPreference(data, interaction.user.id, !isPlacementPingEnabled(data, interaction.user.id));
  await flush();
  const embed = new EmbedBuilder()
    .setColor(enabled ? 0x57d9a3 : 0x747f8d)
    .setTitle(enabled ? 'Liga-Pings aktiviert' : 'Liga-Pings deaktiviert')
    .setDescription(enabled
      ? 'Du wirst wieder erwähnt, wenn sich deine Platzierung in der Aktivitäts-Liga relevant verändert.'
      : 'Du erhältst keine persönlichen Platzierungs-Pings mehr. Deine Aktivität und Platzierung werden weiterhin normal gewertet.')
    .setFooter({ text: 'Diese Einstellung gilt nur für dich und kann jederzeit geändert werden.' });
  await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
};

// Handler für Button-Klicks (Rules, Personal)
const handlePanelButton = async (interaction, cfg, guild, view, period = 'daily') => {
  const runtime = ensureRuntime(guild, cfg?.activityRace);
  const data = await guildData(guild.id);
  const privateView = interaction.message?.flags?.has?.(MessageFlags.Ephemeral) === true;
  const panelMessageIds = new Set([
    String(data.panel.messageId || ''),
    ...Object.values(data.panel.messages || {}).map((entry) => String(entry?.messageId || ''))
  ].filter(Boolean));
  const publicPanel = panelMessageIds.has(String(interaction.message?.id || ''));
  if (!privateView && !publicPanel) {
    await interaction.reply({ content: 'Dieses Ranglisten-Panel ist nicht mehr aktuell.', flags: MessageFlags.Ephemeral }).catch(() => null);
    return;
  }
  const acknowledged = await interaction.deferReply({ flags: MessageFlags.Ephemeral }).then(() => true).catch(() => false);
  if (!acknowledged) return;
  await reconcileActivityFromServerIndex(runtime);
  await settleVoice(runtime);
  await reconcileVoiceFromLogs(runtime);
  ensureTrackingWindow(data, runtime.timezone);
  const snapshot = attachFullRankings(
    guild,
    data,
    buildPanelSnapshot(guild, data, runtime.conf, runtime.timezone),
    runtime.timezone
  );
  const payload = view === 'rules'
    ? buildRulesPayload(guild, runtime.conf, runtime.timezone)
    : buildPersonalRankPayload(guild, snapshot, interaction.user.id, period);
  await interaction.editReply(payload);
};

// Handler für Gleichstand-Dropdown: Zeigt die geteilten Mitglieder als ephemeral Reply.
const handleTieDetails = async (interaction, cfg, guild) => {
  const acknowledged = await interaction.deferReply({ flags: MessageFlags.Ephemeral }).then(() => true).catch(() => false);
  if (!acknowledged) return;
  const runtime = ensureRuntime(guild, cfg?.activityRace);
  const data = await guildData(guild.id);
  await reconcileActivityFromServerIndex(runtime);
  await settleVoice(runtime);
  await reconcileVoiceFromLogs(runtime);
  ensureTrackingWindow(data, runtime.timezone);
  const snapshot = attachFullRankings(
    guild,
    data,
    buildPanelSnapshot(guild, data, runtime.conf, runtime.timezone),
    runtime.timezone
  );
  // Parse die Selection: fh-activity-race:tie:daily:chat:1
  const selected = interaction.values?.[0] || '';
  const parts = selected.replace(TIE_DROPDOWN_PREFIX, '').split(':');
  const [period, metric, rankStr] = parts;
  const rank = Number(rankStr);
  const rankData = snapshot.periods?.[period];
  if (!rankData) return interaction.editReply('Keine Daten für diesen Zeitraum vorhanden.').catch(() => null);
  const rows = rankData[metric];
  if (!rows?.length) return interaction.editReply('Keine Rankings vorhanden.').catch(() => null);
  const rankedRows = metric === 'voice'
    ? rows.map((r) => ({ ...r, value: Math.round(Number(r?.value || 0) / 60000) * 60000 }))
    : rows;
  const { visible } = computeRankings(rankedRows, snapshot.rankingDisplayCount);
  const groups = computeRankGroups(visible);
  const group = groups.find((g) => g.rank === rank);
  if (!group || group.members.length <= 1) return interaction.editReply('Kein Gleichstand auf diesem Platz.').catch(() => null);
  const periodTitle = PERIODS[period]?.title || period;
  const metricLabel = metric === 'voice' ? 'Sprachchat' : 'Chat';
  // Auch Gleichstands-Angaben duerfen keine stillgelegten Mitglieder anpingen.
  const lines = group.members.map((m) => {
    const member = guild?.members?.cache?.get?.(String(m.userId));
    const name = member?.displayName || member?.user?.username || `User ${m.userId}`;
    const value = formatPositionValue(m.value, metric === 'voice' ? 'voiceMilliseconds' : 'messages');
    const mention = isPlacementPingEnabled(data, m.userId) ? `<@${m.userId}>` : name;
    return `• ${mention} — **${value}**`;
  });
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`Gleichstand: ${periodTitle} ${metricLabel} – Platz ${rank}`)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `${group.members.length} Mitglieder teilen sich diesen Platz` });
  await interaction.editReply({ embeds: [embed] }).catch(() => null);
};

export const _activityRaceInternals = {
  normalizeConfig,
  normalizeStore,
  localDateKey,
  periodStartKey,
  completedPeriodRange,
  aggregatePeriod,
  aggregateRange,
  periodSnapshot,
  completedPeriodSnapshot,
  buildPanelSnapshot,
  buildAwardSnapshot,
  buildRoleAssignmentPlan,
  placementGroups,
  rankMetric,
  meaningfulMessage,
  buildPanelPayload,
  buildPeriodPanelPayload,
  buildRulesPayload,
  PING_PHRASES,
  pickPhrase,
  sendPlacementPings,
  isPlacementPingEnabled,
  setPlacementPingPreference,
  filterPlacementPingLinesByPreference,
  placementPingLines,
  composePingContent,
  neutralizeOptedOutMentions,
  isCurrentPingInfoMessage,
  buildPingInfoPanelPayload,
  resetPingCooldowns,
  normalizePendingPingDeletes,
  registerPendingPingDelete,
  catchUpPendingPingDeletes,
  computeOfflineWindow,
  reconcileVoiceStates,
  recentBackfillRange,
  touchHeartbeat,
  flushHeartbeat,
  flush,
  buildCompletionAnnouncement,
  announceCompletedPeriods,
  normalizePanelDesign,
  panelChannel,
  formatVoice,
  ensureCompleteMemberCache,
  fullRankMetric,
  attachFullRankings,
  buildPersonalRankPayload,
  indexedBackfillRange,
  reconstructIndexedChatDays,
  mergeIndexedChatDays,
  buildVoiceLogDailyTotals,
  replaceVoiceDaysFromLogs,
  reliableVoiceLogStartDay,
  reconcileVoiceFromLogs,
  recoverDailyMessagesFromDiscord,
  messageToIndexedRecord,
  rankingLines,
  getDailyTopMemberIds,
  releaseRuntime,
  recordActivityRaceShutdown
};
