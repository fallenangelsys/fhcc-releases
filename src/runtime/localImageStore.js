/* --------------------------------------------------------------------------
   Lokaler Bild-Speicher für Außenbilder im Embed Studio.

   Vom Benutzer im Studio gewählte Bilder werden einmalig als Datei auf dem
   PC gespeichert (data/studio-images/). Der Bot lädt die Datei danach als
   normalen Discord-Anhang auf die Panel-Nachricht – es wird KEIN Discord-
   Kanal angelegt und keine Bild-URL über Umwege gehostet. Alles bleibt lokal.
   -------------------------------------------------------------------------- */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { DATA_DIR } from '../shared/paths.js';

const DATA_ROOT = DATA_DIR;
const IMAGE_DIR = path.join(DATA_ROOT, 'studio-images');
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const IMAGE_FETCH_TIMEOUT_MS = 10_000;
const MAX_IMAGE_REDIRECTS = 3;

const DATA_URL_PATTERN = /^data:(image\/(?:png|jpe?g|webp|gif));base64,([a-z0-9+/=\r\n]+)$/i;

// Erkennt Discord-CDN-URLs (cdn.discordapp.com). Solche URLs dürfen NIE als
// image.url/thumbnail.url ins Embed geschrieben werden – Discord rendert sie
// sonst als hässlichen Link statt als Bild.
export const isDiscordCdnUrl = (value = '') => /^https?:\/\//i.test(String(value || '')) && /cdn\.discordapp\.com\//i.test(String(value || ''));

// Erkennt Discord-Avatar-URLs (Profilbilder von Usern). Avatare sind KEIN
// „hässlicher Link“ – Discord rendert sie als normales Bild im Embed. Sie dürfen
// daher als image.url/thumbnail.url gesetzt werden (z. B. {userAvatar} in
// Level-Up- oder Welcome-Embeds). WICHTIG: Auch Standard-Avatare
// (cdn.discordapp.com/embed/avatars/…) sind gültige Profilbilder – User ohne
// eigenes Avatar-Bild dürfen in Embeds trotzdem ihr Profilbild sehen.
export const isDiscordAvatarUrl = (value = '') => /^https?:\/\//i.test(String(value || '')) && /cdn\.discordapp\.com\/(?:avatars\/|guilds\/[^/]+\/users\/[^/]+\/avatars\/|embed\/avatars\/)/i.test(String(value || ''));

// Eine URL darf als Embed-Bild/Thumbnail gesetzt werden, wenn sie KEINE
// Discord-CDN-URL ist ODER ein User-Avatar ist. Andere CDN-URLs (alte Anhänge,
// hochgeladene Bilder) bleiben blockiert – die gehören als echter Anhang auf die
// Nachricht, nicht ins Embed.
export const isAllowedEmbedImageUrl = (value = '') => {
  const url = String(value || '');
  if (!/^https?:\/\//i.test(url)) return false;
  return !isDiscordCdnUrl(url) || isDiscordAvatarUrl(url);
};

const extensionForMime = (mime) => {
  const value = String(mime || '').toLowerCase();
  if (value === 'image/png') return 'png';
  if (value === 'image/jpeg' || value === 'image/jpg') return 'jpg';
  if (value === 'image/webp') return 'webp';
  if (value === 'image/gif') return 'gif';
  return '';
};

const ensureImageDir = async () => {
  await fs.mkdir(IMAGE_DIR, { recursive: true });
};

const safeId = (id) => /^[a-z0-9-]+$/i.test(String(id || '')) ? String(id) : '';

// Speichert eine hochgeladene Bild-Data-URL als Datei auf dem PC.
// Liefert die lokale Referenz { localAsset: true, id, name, size, mime }.
export const saveLocalImage = async ({ dataUrl = '', name = 'bild.png' } = {}) => {
  const source = String(dataUrl || '').trim();
  const match = DATA_URL_PATTERN.exec(source);
  if (!match) throw new Error('Das ausgewählte Außenbild ist keine gültige PNG-, JPG-, WEBP- oder GIF-Datei.');
  const mime = String(match[1] || '').toLowerCase();
  const extension = extensionForMime(mime);
  if (!extension) throw new Error('Das ausgewählte Außenbild ist keine gültige PNG-, JPG-, WEBP- oder GIF-Datei.');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) throw new Error('Das ausgewählte Außenbild ist leer.');
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error('Das Außenbild darf maximal 25 MB groß sein.');
  await ensureImageDir();
  const id = crypto.randomUUID();
  const fileName = `${id}.${extension}`;
  const target = path.join(IMAGE_DIR, fileName);
  const temporary = `${target}.tmp`;
  await fs.writeFile(temporary, buffer);
  await fs.rename(temporary, target);
  const cleanName = String(name || 'bild.png').replace(/[^a-z0-9._-]/gi, '_').slice(-120) || 'bild.png';
  return { localAsset: true, id, name: cleanName, size: buffer.length, mime };
};

// Liest eine lokal gespeicherte Bild-Referenz zurück (für den Discord-Upload).
// Liefert null, wenn keine lokale Referenz vorliegt oder die Datei fehlt.
export const readLocalImage = async (attachment = null) => {
  if (!attachment || attachment.localAsset !== true) return null;
  const id = safeId(attachment.id);
  if (!id) return null;
  await ensureImageDir();
  const extension = extensionForMime(attachment.mime) || (String(attachment.name || '').match(/\.(png|jpe?g|webp|gif)$/i)?.[1] || 'png').replace('jpeg', 'jpg');
  const target = path.join(IMAGE_DIR, `${id}.${extension}`);
  try {
    const buffer = await fs.readFile(target);
    if (!buffer.length) return null;
    return { buffer, name: String(attachment.name || 'bild.png') };
  } catch (error) {
    return null;
  }
};

const ipv4Number = (address) => {
  const parts = String(address || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0;
};

const inIpv4Range = (value, network, prefix) => {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (network & mask);
};

const isPublicIpv4 = (address) => {
  const value = ipv4Number(address);
  if (value === null) return false;
  const blocked = [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
    ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
    ['224.0.0.0', 4], ['240.0.0.0', 4]
  ];
  return !blocked.some(([network, prefix]) => inIpv4Range(value, ipv4Number(network), prefix));
};

const ipv6BlockList = new net.BlockList();
for (const [network, prefix] of [
  ['::', 128], ['::1', 128], ['64:ff9b:1::', 48], ['100::', 64],
  ['2001:2::', 48], ['2001:10::', 28], ['2001:db8::', 32],
  ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]
]) {
  ipv6BlockList.addSubnet(network, prefix, 'ipv6');
}

const mappedIpv4 = (address) => {
  const value = String(address || '').toLowerCase();
  if (!value.startsWith('::ffff:')) return '';
  const tail = value.slice(7);
  if (net.isIP(tail) === 4) return tail;
  const words = tail.split(':');
  if (words.length !== 2 || words.some((word) => !/^[0-9a-f]{1,4}$/i.test(word))) return '';
  const high = Number.parseInt(words[0], 16);
  const low = Number.parseInt(words[1], 16);
  return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
};

const isPublicIp = (address) => {
  const value = String(address || '').replace(/^\[|\]$/g, '');
  const family = net.isIP(value);
  if (family === 4) return isPublicIpv4(value);
  if (family !== 6) return false;
  const mapped = mappedIpv4(value);
  if (mapped) return isPublicIpv4(mapped);
  return !ipv6BlockList.check(value, 'ipv6');
};

const defaultLookup = (hostname) => dns.lookup(hostname, { all: true, verbatim: true });

// Validiert sowohl Literale als auch jede DNS-Antwort. Gemischte öffentliche
// und private Antworten werden vollständig verworfen, statt zufällig eine davon
// zu verwenden.
const assertPublicHttpUrl = async (value, { lookup = defaultLookup } = {}) => {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch (error) {
    throw new Error('Das Bild-Ziel ist keine gültige HTTP(S)-URL.', { cause: error });
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('Das Bild-Ziel muss eine öffentliche HTTP(S)-URL sein.');
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!hostname || hostname.toLowerCase() === 'localhost' || hostname.toLowerCase().endsWith('.localhost')) {
    throw new Error('Das Bild-Ziel muss öffentlich erreichbar sein.');
  }
  let addresses;
  if (net.isIP(hostname)) {
    addresses = [{ address: hostname, family: net.isIP(hostname) }];
  } else {
    try {
      addresses = await lookup(hostname);
    } catch (error) {
      throw new Error('Das Bild-Ziel konnte nicht sicher aufgelöst werden.', { cause: error });
    }
  }
  const normalized = (Array.isArray(addresses) ? addresses : [addresses])
    .map((entry) => typeof entry === 'string' ? { address: entry, family: net.isIP(entry) } : entry)
    .filter((entry) => entry?.address);
  if (!normalized.length || normalized.some((entry) => !isPublicIp(entry.address))) {
    throw new Error('Das Bild-Ziel muss auf eine öffentliche Adresse zeigen.');
  }
  return { url: parsed, addresses: normalized };
};

const requestWithPinnedDns = ({ url, addresses, signal }) => new Promise((resolve, reject) => {
  const transport = url.protocol === 'https:' ? https : http;
  const request = transport.get(url, {
    signal,
    headers: { 'accept-encoding': 'identity' },
    lookup: (_hostname, options, callback) => {
      const requestedFamily = Number(options?.family || 0);
      const candidates = requestedFamily
        ? addresses.filter((entry) => Number(entry.family || net.isIP(entry.address)) === requestedFamily)
        : addresses;
      const selected = candidates[0];
      if (!selected) {
        callback(new Error('Keine passende öffentliche Zieladresse gefunden.'));
        return;
      }
      if (options?.all === true) {
        callback(null, candidates.map((entry) => ({
          address: entry.address,
          family: Number(entry.family || net.isIP(entry.address))
        })));
        return;
      }
      callback(null, selected.address, Number(selected.family || net.isIP(selected.address)));
    }
  }, resolve);
  request.once('error', reject);
});

const headerValue = (response, name) => {
  if (typeof response?.headers?.get === 'function') return response.headers.get(name);
  const value = response?.headers?.[String(name).toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
};

const discardResponse = async (response) => {
  if (typeof response?.body?.cancel === 'function') await response.body.cancel().catch(() => null);
  else if (typeof response?.destroy === 'function') response.destroy();
  else if (typeof response?.resume === 'function') response.resume();
};

const readLimitedBody = async (body, maxBytes) => {
  if (!body) throw new Error('Das Bild enthält keine Daten.');
  const chunks = [];
  let size = 0;
  const append = (chunk) => {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error('Das Außenbild darf maximal 25 MB groß sein.');
    chunks.push(buffer);
  };
  if (typeof body[Symbol.asyncIterator] === 'function') {
    for await (const chunk of body) append(chunk);
  } else if (typeof body.getReader === 'function') {
    const reader = body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        append(value);
      }
    } finally {
      reader.releaseLock();
    }
  } else {
    throw new Error('Das Bild konnte nicht als Datenstrom gelesen werden.');
  }
  if (!size) throw new Error('Das Außenbild ist leer.');
  return Buffer.concat(chunks, size);
};

// Lädt Bilder mit validierten und für den echten Socket festgepinnten DNS-
// Adressen. Redirects werden manuell verfolgt und jedes neue Ziel wird erneut
// geprüft. Der Body wird nur bis zur erlaubten Maximalgröße gepuffert.
const fetchImageBuffer = async (value, {
  fetchImpl = null,
  lookup = defaultLookup,
  maxRedirects = MAX_IMAGE_REDIRECTS,
  timeoutMs = IMAGE_FETCH_TIMEOUT_MS
} = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs) || IMAGE_FETCH_TIMEOUT_MS));
  let current = String(value || '');
  try {
    for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
      const validated = await assertPublicHttpUrl(current, { lookup });
      const response = fetchImpl
        ? await fetchImpl(validated.url, { signal: controller.signal, redirect: 'manual' })
        : await requestWithPinnedDns({ ...validated, signal: controller.signal });
      const status = Number(response?.status ?? response?.statusCode ?? 0);
      const location = headerValue(response, 'location');
      if ([301, 302, 303, 307, 308].includes(status) && location) {
        await discardResponse(response);
        if (redirects >= maxRedirects) throw new Error('Das Außenbild überschreitet das Redirect-Limit.');
        current = new URL(location, validated.url).toString();
        continue;
      }
      if (status < 200 || status >= 300) {
        await discardResponse(response);
        throw new Error(`Das Bild-Ziel antwortete mit HTTP ${status || 'Fehler'}.`);
      }
      const contentType = String(headerValue(response, 'content-type') || '').split(';')[0].trim().toLowerCase();
      if (!contentType.startsWith('image/')) {
        await discardResponse(response);
        throw new Error('Das Bild-Ziel lieferte keinen gültigen Bild-Content-Type.');
      }
      const contentLengthValue = headerValue(response, 'content-length');
      if (contentLengthValue !== null && contentLengthValue !== undefined && contentLengthValue !== '') {
        const contentLength = Number(contentLengthValue);
        if (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > MAX_IMAGE_BYTES) {
          await discardResponse(response);
          throw new Error('Das Außenbild darf maximal 25 MB groß sein.');
        }
      }
      try {
        return await readLimitedBody(response.body || response, MAX_IMAGE_BYTES);
      } catch (error) {
        await discardResponse(response);
        throw error;
      }
    }
    throw new Error('Das Außenbild überschreitet das Redirect-Limit.');
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Der Außenbild-Download hat zu lange gedauert.', { cause: error });
    throw new Error(error?.message || 'Bildverarbeitung fehlgeschlagen.', { cause: error });
  } finally {
    clearTimeout(timeout);
  }
};

// Wandelt das Außenbild eines Embed-Templates in den Discord-Payload um –
// einheitlich für ALLE Studio-Embeds (Level-Up, Level-Up-Kanal-Info, Bot-Updates-…):
//  • lokale Datei (localAsset) → wird als normaler Discord-Anhang (files) gesendet
//  • bereits hochgeladener Anhang (id) → wird referenziert (attachments) – NUR
//    beim Bearbeiten einer bestehenden Nachricht (allowAttachmentReference). Bei
//    einem frischen Versand gibt es keine Nachricht, deren Anhang referenziert
//    werden kann (Discord antwortet sonst mit 400) → das Bild wird stattdessen
//    von der CDN-URL neu geladen und als Datei angehängt.
//  • CDN-URL → wird heruntergeladen und als normaler Anhang angehängt.
// Es wird NIE eine URL als sichtbare Content-Zeile zurückgegeben – ein Link im
// Nachrichtentext ist der „hässliche Link“. Schlägt der Download fehl, wird ein
// klarer Fehler geworfen statt die URL still in den Text zu schreiben.
// Rückgabe: { files, attachments }
export const resolveOutsideImagePayload = async ({ outsideImageUrl = '', outsideImageAttachment = null, allowAttachmentReference = false } = {}) => {
  const url = String(outsideImageUrl || '').trim();
  const attachment = outsideImageAttachment && typeof outsideImageAttachment === 'object' ? outsideImageAttachment : null;
  if (attachment?.localAsset === true) {
    const local = await readLocalImage(attachment);
    if (!local) {
      throw new Error('Das ausgewählte Außenbild wurde nicht gefunden. Bitte wähle es im Studio erneut aus.');
    }
    const safeName = String(local.name || attachment.name || 'bild.png').replace(/[^a-z0-9._-]/gi, '_').slice(-120);
    return { files: [{ attachment: local.buffer, name: safeName }], attachments: [] };
  }
  if (attachment?.id && attachment.localAsset !== true) {
    if (allowAttachmentReference === true) {
      return { files: null, attachments: [{ id: String(attachment.id) }] };
    }
    const cdnUrl = String(attachment.url || url || '').trim();
    if (/^https?:\/\//i.test(cdnUrl)) {
      const buffer = await fetchImageBuffer(cdnUrl).catch(() => null);
      if (buffer) {
        const safeName = String(attachment.name || 'bild.png').replace(/[^a-z0-9._-]/gi, '_').slice(-120);
        return { files: [{ attachment: buffer, name: safeName }], attachments: [] };
      }
      throw new Error('Das Außenbild konnte nicht vom Discord-Server geladen werden. Bitte wähle es im Studio erneut aus.');
    }
    return { files: null, attachments: [] };
  }
  if (/^https?:\/\//i.test(url)) {
    const buffer = await fetchImageBuffer(url).catch(() => null);
    if (buffer) {
      const safeName = String(attachment?.name || 'bild.png').replace(/[^a-z0-9._-]/gi, '_').slice(-120);
      return { files: [{ attachment: buffer, name: safeName }], attachments: [] };
    }
    throw new Error('Das Außenbild konnte nicht geladen werden. Bitte wähle es im Studio erneut aus.');
  }
  return { files: null, attachments: [] };
};

// Macht ein lokal gespeichertes Außenbild (localAsset, vom Studio-Upload) vor
// dem Payload-Bau wieder zu einer Data-URL – die Embed-Payload-Builder kennen
// nur Data-URLs und HTTP-Links. Ohne diesen Schritt würde ein gewähltes
// Außenbild beim „Mit Bot senden“ stillschweigend verworfen.
export const materializeOutsideImageTemplate = async (template = {}) => {
  const attachment = template?.outsideImageAttachment;
  if (!attachment || attachment.localAsset !== true) return template;
  const local = await readLocalImage(attachment);
  if (!local?.buffer?.length) {
    throw new Error('Das ausgewählte Außenbild wurde nicht gefunden. Bitte wähle es erneut aus.');
  }
  const mime = String(attachment.mime || '').match(/^image\/(?:png|jpe?g|webp|gif)$/i)?.[0] || 'image/png';
  return {
    ...template,
    outsideImageUrl: `data:${mime};base64,${local.buffer.toString('base64')}`,
    outsideImageName: String(local.name || attachment.name || 'bild.png'),
    removeOutsideImage: false
  };
};

// Entfernt eine lokal gespeicherte Bild-Datei (nach erfolgreichem Upload bzw.
// beim Ersetzen/Entfernen). Schlägt still fehl.
export const removeLocalImage = async (attachment = null) => {
  if (!attachment || attachment.localAsset !== true) return false;
  const id = safeId(attachment.id);
  if (!id) return false;
  const extension = extensionForMime(attachment.mime) || (String(attachment.name || '').match(/\.(png|jpe?g|webp|gif)$/i)?.[1] || 'png').replace('jpeg', 'jpg');
  const target = path.join(IMAGE_DIR, `${id}.${extension}`);
  try {
    await fs.rm(target, { force: true });
    return true;
  } catch (error) {
    return false;
  }
};

// Räumt ausschließlich klar temporäre oder ungültige Reste auf. Reguläre
// Assets können weiterhin in einer Guild-Config referenziert sein und dürfen
// ohne Kenntnis dieser Referenzen niemals allein wegen ihres Alters verschwinden.
export const purgeOrphanLocalImages = async ({ retentionDays = 7 } = {}) => {
  try {
    const entries = await fs.readdir(IMAGE_DIR).catch(() => []);
    if (!entries.length) return 0;
    const cutoff = Date.now() - Math.max(1, Number(retentionDays) || 7) * 24 * 60 * 60 * 1000;
    let removed = 0;
    for (const entry of entries) {
      const target = path.join(IMAGE_DIR, entry);
      const stat = await fs.stat(target).catch(() => null);
      if (!stat?.isFile()) continue;
      const isStaleTemporary = /\.tmp$/i.test(entry) && Number(stat.mtimeMs || 0) < cutoff;
      const isEmptyAsset = /^[a-z0-9-]+\.(png|jpg|jpeg|webp|gif)$/i.test(entry) && stat.size === 0;
      if (!isStaleTemporary && !isEmptyAsset) continue;
      const deleted = await fs.rm(target, { force: true }).then(() => true).catch(() => false);
      if (deleted) removed += 1;
    }
    return removed;
  } catch (error) {
    return 0;
  }
};

// Außenbild-Auflösung nach dem Aktivitäts-Liga-Muster: KEIN CDN-Download,
// KEIN Fehlerwurf. Das Liga-Panel (activityRace) referenziert beim Bearbeiten
// den gespeicherten Anhang per ID und lädt NIE von der CDN-URL neu – das ist
// schnell, zuverlässig und erzeugt keine „Außenbild konnte nicht geladen“-Fehler.
//  • outsideFile (neues Bild aus dem Studio) → wird als echter Anhang (files) gesendet
//  • localAsset (lokal gespeichertes Studio-Bild) → wird als Datei (files) hochgeladen
//  • preserveAttachment + gespeicherte Anhang-ID → Referenz (attachments), kein Download
//  • removeOutsideImage → attachments: [] (Bild entfernen)
//  • sonst → kein Bild (files/attachments null), still und ohne Fehler
// Rückgabe: { files, attachments }
export const resolveOutsideImageLite = async ({
  outsideFile = null,
  outsideImageName = '',
  defaultImageName = 'bild.png',
  savedAttachment = null,
  preserveAttachment = false,
  removeOutsideImage = false
} = {}) => {
  const safeName = (value) => String(value || defaultImageName).replace(/[^a-z0-9._-]/gi, '_').slice(-120) || defaultImageName;
  if (outsideFile) {
    return { files: [{ attachment: outsideFile, name: safeName(outsideImageName) }], attachments: [] };
  }
  const attachment = savedAttachment && typeof savedAttachment === 'object' ? savedAttachment : null;
  if (attachment?.localAsset === true) {
    const local = await readLocalImage(attachment);
    if (!local) {
      // Lokale Datei wurde aufgeräumt oder ist verschwunden: still ohne Bild
      // weiterarbeiten – ein Live-Panel darf daran NIE scheitern (kein
      // eingefrorenes Panel). Der Studio-Save weist den Nutzer stattdessen klar
      // auf ein fehlendes Bild hin (resolveOutsideImageFile).
      return { files: null, attachments: null };
    }
    return { files: [{ attachment: local.buffer, name: safeName(local.name) }], attachments: [] };
  }
  if (preserveAttachment === true && attachment?.id) {
    return { files: null, attachments: [{ id: String(attachment.id) }] };
  }
  if (removeOutsideImage === true) {
    return { files: null, attachments: [] };
  }
  return { files: null, attachments: null };
};

export const _localImageStoreInternals = {
  saveLocalImage,
  readLocalImage,
  removeLocalImage,
  purgeOrphanLocalImages,
  resolveOutsideImagePayload,
  resolveOutsideImageLite,
  materializeOutsideImageTemplate,
  isDiscordCdnUrl,
  isDiscordAvatarUrl,
  isAllowedEmbedImageUrl,
  assertPublicHttpUrl,
  fetchImageBuffer,
  MAX_IMAGE_BYTES,
  IMAGE_DIR
};
