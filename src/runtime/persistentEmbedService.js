// Gemeinsamer „Speichern & Kanal aktualisieren“-Helfer für alle persistenten
// Studio-Embeds (Levelrollen-Panel, Level-Up-Kanal-Info, Bot-Updates-Panel).
// Einheitliches, testbares Verhalten:
//   • Das Design (inkl. Außenbild) geht beim Speichern NIE verloren – auch wenn
//     der Kanal gerade nicht erreichbar ist (Status statt Fehler).
//   • Neu gewählte Bilder (Data-URL oder lokal gespeicherte Referenz) werden als
//     normaler Discord-Anhang gesendet; nach Bestätigung wird die CDN-URL
//     gespeichert und die lokale Datei aufgeräumt – sonst bleibt die Referenz im
//     Design erhalten (attachmentPending) und der nächste Sync hängt sie an.
//   • Ein gewählter Kanal aktiviert das Modul bei Bedarf automatisch (autoEnable),
//     damit die Nachricht wirklich erscheint.
import { readLocalImage, removeLocalImage } from './localImageStore.js';

const DATA_URL_PATTERN = /^data:(image\/(?:png|jpe?g|webp|gif));base64,([a-z0-9+/=\r\n]+)$/i;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export const serializeMessageAttachment = (message) => {
  const attachment = message?.attachments?.first?.();
  if (!attachment) return null;
  return {
    id: String(attachment.id || ''),
    url: String(attachment.url || ''),
    name: String(attachment.name || 'bild.png'),
    size: Number(attachment.size || 0)
  };
};

// Wandelt das Außenbild eines Studio-Templates in eine versandfertige Datei um:
// Data-URL → Buffer, lokal gespeicherte Referenz (localAsset) → Datei vom PC.
// Wirft nur bei wirklich ungültigem Bild – der Save scheitert nie am Kanal.
export const resolveOutsideImageFile = async ({ template = {}, defaultImageName = 'bild.png' } = {}) => {
  const source = String(template?.outsideImageUrl || '').trim();
  const match = DATA_URL_PATTERN.exec(source);
  let outsideFile = match ? Buffer.from(match[2], 'base64') : null;
  if (source.startsWith('data:') && !outsideFile) {
    throw new Error('Das ausgewählte Außenbild ist keine gültige PNG-, JPG-, WEBP- oder GIF-Datei.');
  }
  if (outsideFile && outsideFile.length > MAX_IMAGE_BYTES) {
    throw new Error('Das Außenbild darf maximal 25 MB groß sein.');
  }
  let outsideImageName = String(template?.outsideImageName || defaultImageName)
    .replace(/[^a-z0-9._-]/gi, '_').slice(-120) || defaultImageName;
  if (!outsideFile && template?.outsideImageAttachment?.localAsset === true) {
    const local = await readLocalImage(template.outsideImageAttachment);
    if (!local) {
      // Lokale Datei ist weg (z. B. nach einem früheren Upload aufgeräumt), aber
      // eine CDN-URL ist vorhanden: Das Bild bleibt über die Anhang-Referenz am
      // bestehenden Panel erhalten – der Save darf nicht blockieren. Nur ohne
      // CDN-URL muss der Nutzer das Bild neu wählen.
      const cdnUrl = String(template?.outsideImageAttachment?.url || '').trim();
      if (!/^https?:\/\//i.test(cdnUrl)) {
        throw new Error('Das lokale Außenbild wurde nicht gefunden. Bitte wähle es erneut aus.');
      }
    } else {
      outsideFile = local.buffer;
      outsideImageName = String(local.name || outsideImageName)
        .replace(/[^a-z0-9._-]/gi, '_').slice(-120) || defaultImageName;
    }
  }
  return { outsideFile, outsideImageName };
};

// Bewahrt den Außenbild-Zustand beim Speichern: Entfernen gewinnt, sonst URL +
// passender Anhang (gleiche CDN-URL → bleibt echter Anhang statt sichtbarem
// Link), frische Referenz, zuletzt der bisherige Stand. Nie geht das Bild verloren.
export const preserveOutsideImage = ({ sourceOutsideImage = '', removeOutsideImage = false, incomingAttachment = null, previousDesign = null } = {}) => {
  const normalizeAttachment = (attachment) => attachment && typeof attachment === 'object'
    ? {
        id: String(attachment.id || ''),
        url: String(attachment.url || ''),
        name: String(attachment.name || 'bild.png'),
        size: Math.max(0, Number(attachment.size || 0)),
        ...(attachment.anchored === true
          ? { anchored: true, channelId: String(attachment.channelId || ''), messageId: String(attachment.messageId || '') }
          : {}),
        ...(attachment.localAsset === true ? { localAsset: true, mime: String(attachment.mime || '') } : {})
      }
    : null;
  const previousUrl = String(previousDesign?.outsideImageUrl || '').trim();
  const previousAttachment = normalizeAttachment(previousDesign?.outsideImageAttachment);
  const normalizedIncoming = normalizeAttachment(incomingAttachment);
  if (removeOutsideImage) return { outsideImageUrl: '', outsideImageAttachment: null };
  if (sourceOutsideImage) {
    const matchesUrl = normalizedIncoming && String(normalizedIncoming.url || '') === sourceOutsideImage;
    return { outsideImageUrl: sourceOutsideImage, outsideImageAttachment: matchesUrl ? normalizedIncoming : null };
  }
  if (normalizedIncoming) return { outsideImageUrl: '', outsideImageAttachment: normalizedIncoming };
  if (previousAttachment) return { outsideImageUrl: previousUrl, outsideImageAttachment: previousAttachment };
  return { outsideImageUrl: previousUrl || '', outsideImageAttachment: null };
};

// Ersetzt oder ergänzt einen Template-Eintrag (z. B. level-up-info) in der
// embeds.templates-Liste – das gleiche Verhalten wie der Renderer beim Speichern.
export const upsertDesignTemplate = (templates, design) => {
  const list = Array.isArray(templates) ? templates : [];
  const id = String(design?.id || '');
  const exists = list.some((entry) => String(entry?.id || '') === id);
  return exists
    ? list.map((entry) => String(entry?.id || '') === id ? { ...entry, ...design } : entry)
    : list.concat([design]);
};

// Gültige Bildfelder: leer, vollständige HTTP(S)-URL oder Platzhalter-Token
// (z. B. {userAvatar}). Alles andere wird abgelehnt – mit klarer Meldung statt
// stillem Verlust, damit nie ein kaputtes/leeres Embed gespeichert wird.
export const validateEmbedImageUrls = (embed = {}, designName = 'Embed') => {
  const entries = [
    ['Autor-Icon', embed?.authorIconUrl],
    ['Thumbnail', embed?.thumbnailUrl],
    ['Embed-Bild', embed?.imageUrl],
    ['Footer-Icon', embed?.footerIconUrl]
  ];
  for (const [label, value] of entries) {
    const normalized = String(value || '').trim();
    if (!normalized) continue;
    if (/^https?:\/\/[^\s]+$/i.test(normalized)) continue;
    if (/^\{[a-z0-9_.-]+\}$/i.test(normalized)) continue;
    throw new Error(`${designName}: ${label} muss eine vollständige HTTP(S)-Bildadresse oder ein Platzhalter-Token sein.`);
  }
};

const cleanEmbedFields = (embed = {}, { defaultColor = '#8b82ff', maxFields = 21 } = {}) => ({
  title: String(embed.title || ''),
  url: String(embed.url || ''),
  description: String(embed.description || ''),
  color: String(embed.color || defaultColor),
  authorName: String(embed.authorName || ''),
  authorIconUrl: String(embed.authorIconUrl || ''),
  thumbnailUrl: String(embed.thumbnailUrl || ''),
  imageUrl: String(embed.imageUrl || ''),
  footerText: String(embed.footerText || ''),
  footerIconUrl: String(embed.footerIconUrl || ''),
  timestamp: embed.timestamp !== false,
  fields: (Array.isArray(embed.fields) ? embed.fields : []).slice(0, Math.max(1, maxFields))
});

const confirmAttachment = async ({ guild, channelId, messageId, message, serialize = serializeMessageAttachment } = {}) => {
  let attachment = serialize(message);
  if (!attachment && messageId && channelId) {
    const channel = guild?.channels?.cache?.get?.(String(channelId))
      || await guild?.channels?.fetch?.(String(channelId)).catch(() => null);
    const fresh = channel?.messages ? await channel.messages.fetch({ message: String(messageId), force: true }).catch(() => null) : null;
    attachment = serialize(fresh);
  }
  return attachment;
};

// Der gemeinsame Kern: validieren → Außenbild auflösen → Zustand bewahren →
// Design bauen → Kanal-Sync (nie am Kanal scheitern) → Anhang bestätigen.
// Rückgabe: { design, status } – design ist der feature-spezifische Eintrag,
// status trägt action (posted/updated/no-channel/module-off/failed/…),
// messageId, autoEnabled und attachmentPending.
export const savePersistentEmbedDesign = async ({ guild, cfg = {}, template = {}, options = {} } = {}) => {
  const {
    designId = '',
    designName = 'Persistentes Embed',
    defaultColor = '#8b82ff',
    maxFields = 21,
    previousDesign = null,
    channelId = '',
    moduleActive = true,
    autoEnable = false,
    buildDesign = null,
    prepareSyncCfg = null,
    sync = null,
    serializeAttachment = serializeMessageAttachment,
    defaultImageName = 'bild.png'
  } = options;
  if (!guild) throw new Error('Server wurde nicht gefunden.');
  const embeds = Array.isArray(template?.embeds) && template.embeds.length ? template.embeds : [template?.embed || {}];
  if (embeds.length !== 1) throw new Error(`${designName} verwendet genau ein automatisch gepflegtes Embed.`);
  const resolved = await resolveOutsideImageFile({ template, defaultImageName });
  const preserved = preserveOutsideImage({
    sourceOutsideImage: resolved.outsideFile ? '' : String(template?.outsideImageUrl || '').trim(),
    removeOutsideImage: template?.removeOutsideImage === true,
    incomingAttachment: resolved.outsideFile ? null : template?.outsideImageAttachment,
    previousDesign
  });
  const sourceEmbed = embeds[0] || {};
  const cleanEmbed = cleanEmbedFields(sourceEmbed, { defaultColor, maxFields });
  // Gemeinsame Bild-Validierung: ungültige Bildfelder werden NIE gespeichert.
  if (options.validateImages !== false) {
    validateEmbedImageUrls(cleanEmbed, designName);
  }
  // Nachricht + Außenbild-URL dürfen zusammen nicht die Discord-Grenze sprengen
  // (nur im URL-Modus – bei einem echten Bild-Upload zählt nur die URL nicht mit).
  if (!resolved.outsideFile && !template?.outsideImageAttachment
    && String(template?.content || '').length + String(template?.outsideImageUrl || '').trim().length + 1 > 2_000) {
    throw new Error(`${designName}: Nachricht und Außenbild-Link dürfen zusammen maximal 2.000 Zeichen enthalten.`);
  }
  const content = String(template?.content || '');
  const design = buildDesign
    ? buildDesign({ source: template, embed: cleanEmbed, preserved, content })
    : { id: designId, name: designName, category: 'Automation', content, enabled: true, ...preserved, embed: cleanEmbed };
  const status = {
    channelId,
    action: 'pending',
    channelName: String(guild.channels.cache.get(String(channelId))?.name || ''),
    lastError: ''
  };
  if (!channelId) {
    // Ohne Kanal nur speichern – Design und Außenbild gehen nie verloren.
    status.action = 'no-channel';
  } else if (moduleActive !== true && autoEnable !== true) {
    status.action = 'module-off';
  } else {
    if (moduleActive !== true && autoEnable === true) status.autoEnabled = true;
    const syncOptions = {};
    if (resolved.outsideFile) {
      syncOptions.outsideFile = resolved.outsideFile;
      syncOptions.outsideImageName = resolved.outsideImageName;
    } else if (template?.removeOutsideImage === true) {
      syncOptions.removeOutsideImage = true;
    }
    const syncCfg = prepareSyncCfg ? prepareSyncCfg({ cfg, design, enabled: true }) : cfg;
    try {
      const result = await sync({ guild, cfg: syncCfg, options: syncOptions });
      status.action = String(result?.action || 'ok');
      status.messageId = String(result?.messageId || '');
      if (result?.message) status.message = result.message;
      if ((status.action === 'channel-unavailable' || status.action === 'missing-permission') && !status.channelName) {
        status.channelName = await guild.channels.fetch(String(channelId)).then((c) => String(c?.name || '')).catch(() => '');
      }
    } catch (error) {
      status.action = 'failed';
      status.lastError = String(error?.message || error).slice(0, 300);
      console.warn(`[persistent-embed] „${designName}“-Sync fehlgeschlagen: ${error?.message || error}`);
    }
    if (resolved.outsideFile && status.action !== 'failed') {
      // Anhang direkt am Info-Embed/Panel bestätigen und URL speichern – die
      // lokale Datei ist dann verbraucht und wird aufgeräumt.
      const attachment = await confirmAttachment({
        guild,
        channelId,
        messageId: status.messageId,
        message: status.message,
        serialize: serializeAttachment
      });
      if (attachment) {
        design.outsideImageUrl = attachment.url;
        design.outsideImageAttachment = attachment;
        await removeLocalImage(template?.outsideImageAttachment).catch(() => null);
      } else {
        status.attachmentPending = true;
      }
    }
  }
  // Bild konnte nicht als Discord-Anhang bestätigt werden (kein Kanal, Modul
  // aus, Kanal nicht erreichbar oder Fehler): lokale Referenz im Design behalten
  // statt sie zu verwerfen – so geht das Außenbild beim Speichern nie verloren.
  if (resolved.outsideFile && (status.action === 'no-channel' || status.action === 'module-off' || status.action === 'failed' || status.attachmentPending)) {
    design.outsideImageUrl = '';
    design.outsideImageAttachment = template?.outsideImageAttachment && typeof template?.outsideImageAttachment === 'object'
      ? { ...template.outsideImageAttachment }
      : preserved.outsideImageAttachment;
  }
  return { design, status };
};

export const _persistentEmbedInternals = {
  resolveOutsideImageFile,
  preserveOutsideImage,
  upsertDesignTemplate,
  serializeMessageAttachment,
  cleanEmbedFields,
  validateEmbedImageUrls,
  confirmAttachment,
  savePersistentEmbedDesign
};
