/* --------------------------------------------------------------------------
   Lokaler Asset-Cache für Embed-Bilder.

   Embed-Bilder (Thumbnail, großes Bild, Autor-/Footer-Icon, Außenbild, aber
   auch Emoji-CDN-URLs) werden einmalig von ihrer Quell-URL heruntergeladen und
   als Datei unter data/embed-assets/ gespeichert. Beim nächsten Versand wird
   die lokale Kopie wiederverwendet – auch wenn die ursprüngliche URL inzwischen
   abgelaufen ist oder der Host offline geht. Das ist der Kern der
   „Links laufen ab“-Lösung: Der Bot lädt das Bild selbstständig nach.

   Das Embed referenziert die Datei über attachment://<name> (als Anhang der
   eigenen Nachricht) – Discord hostet sie danach dauerhaft, es bleibt kein
   sterbender Fremd-Link im Embed zurück.

   Kein Fehlerwurf bei Download-Problemen: Schlägt der Download fehl, liefert
   der Cache null und der Aufrufer entscheidet selbst (URL beibehalten oder
   Bild weglassen). Ein einzelnes totes Bild darf nie den ganzen Embed-Versand
   blockieren.
   -------------------------------------------------------------------------- */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import { isAllowedEmbedImageUrl } from './localImageStore.js';
import { DATA_DIR } from '../shared/paths.js';

const DATA_ROOT = DATA_DIR;
export const ASSET_DIR = path.join(DATA_ROOT, 'embed-assets');
const DOWNLOAD_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const KNOWN_EXTENSIONS = ['png', 'jpg', 'webp', 'gif'];
const URL_PATTERN = /^https?:\/\//i;
const EXT_PATTERN = /\.(png|jpe?g|webp|gif)(?:[?#].*)?$/i;

const mimeForExtension = (ext) => {
  const value = String(ext || '').toLowerCase().replace('jpeg', 'jpg');
  if (value === 'png') return 'image/png';
  if (value === 'jpg') return 'image/jpeg';
  if (value === 'webp') return 'image/webp';
  if (value === 'gif') return 'image/gif';
  return '';
};

const extensionForMime = (mime) => {
  const value = String(mime || '').toLowerCase().split(';')[0].trim();
  if (value === 'image/png') return 'png';
  if (value === 'image/jpeg' || value === 'image/jpg') return 'jpg';
  if (value === 'image/webp') return 'webp';
  if (value === 'image/gif') return 'gif';
  return '';
};

const extensionFromUrl = (url) => {
  const match = String(url || '').match(EXT_PATTERN);
  if (!match) return '';
  return String(match[1]).toLowerCase().replace('jpeg', 'jpg');
};

const hashForUrl = (url) => crypto.createHash('sha256').update(String(url || '')).digest('hex').slice(0, 32);

const ensureAssetDir = async () => {
  await fs.mkdir(ASSET_DIR, { recursive: true });
};

const safeExtension = (ext) => KNOWN_EXTENSIONS.includes(String(ext || '').toLowerCase().replace('jpeg', 'jpg'))
  ? String(ext).toLowerCase().replace('jpeg', 'jpg')
  : '';

// Lädt eine Bild-URL mit Timeout herunter. Liefert { buffer, mime, ext } oder
// null – wirft nie, ein kaputter Download ist kein Bot-Fehler.
const downloadAsset = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(String(url), { signal: controller.signal, redirect: 'follow' });
    if (!response.ok) return null;
    const contentType = String(response.headers?.get?.('content-type') || '');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) return null;
    const ext = extensionForMime(contentType) || extensionFromUrl(url) || 'png';
    return { buffer, mime: mimeForExtension(ext), ext };
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

// Liest eine bereits gecachte Bild-Datei zurück (nur vom Cache, kein Download).
// Liefert null, wenn keine Kopie im Cache liegt.
export const readEmbedAsset = async (url) => {
  if (!URL_PATTERN.test(String(url || ''))) return null;
  const hash = hashForUrl(url);
  for (const ext of KNOWN_EXTENSIONS) {
    try {
      const buffer = await fs.readFile(path.join(ASSET_DIR, `${hash}.${ext}`));
      if (!buffer.length) continue;
      return { buffer, ext, mime: mimeForExtension(ext), cached: true };
    } catch {
      // Datei (noch) nicht vorhanden – nächste Extension prüfen.
    }
  }
  return null;
};

// Holt ein Embed-Bild: zuerst aus dem lokalen Cache, sonst frisch von der URL
// (und legt die Kopie für später ab). Liefert { buffer, ext, mime, cached }
// oder null. maxBytes begrenzt die Dateigröße (Standard 8 MB, Außenbild 25 MB).
export const fetchEmbedAsset = async (url, { maxBytes = DEFAULT_MAX_BYTES } = {}) => {
  if (!URL_PATTERN.test(String(url || ''))) return null;
  const cached = await readEmbedAsset(url);
  if (cached) return cached;
  const downloaded = await downloadAsset(url);
  if (!downloaded) return null;
  if (downloaded.buffer.length > Math.max(1, Number(maxBytes) || DEFAULT_MAX_BYTES)) return null;
  const ext = safeExtension(downloaded.ext) || 'png';
  await ensureAssetDir();
  const target = path.join(ASSET_DIR, `${hashForUrl(url)}.${ext}`);
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporary, downloaded.buffer);
    await fs.rename(temporary, target);
  } catch {
    await fs.rm(temporary, { force: true }).catch(() => null);
  }
  return { buffer: downloaded.buffer, ext, mime: mimeForExtension(ext), cached: false };
};

// Räumt veraltete Cache-Dateien auf (Standard: 30 Tage). Liefert die Anzahl
// der entfernten Dateien. Schlägt still fehl – der Cache ist nur ein Puffer.
export const purgeEmbedAssetCache = async ({ retentionDays = 30 } = {}) => {
  try {
    const entries = await fs.readdir(ASSET_DIR).catch(() => []);
    if (!entries.length) return 0;
    const cutoff = Date.now() - Math.max(1, Number(retentionDays) || 30) * 24 * 60 * 60 * 1000;
    let removed = 0;
    for (const entry of entries) {
      if (!/^[a-f0-9]{32}\.(?:png|jpg|webp|gif)$/i.test(entry)) continue;
      const target = path.join(ASSET_DIR, entry);
      const stat = await fs.stat(target).catch(() => null);
      if (stat && Number(stat.mtimeMs || 0) < cutoff) {
        await fs.rm(target, { force: true }).catch(() => null);
        removed += 1;
      }
    }
    return removed;
  } catch (error) {
    return 0;
  }
};

// Löst eine Embed-Bild-URL in eine versandfertige Referenz auf:
//   • Leer / nicht-HTTP → { url: '', files: [] } (Bild weglassen)
//   • Erlaubte URL (externe Hosts, Avatare) → { url, files: [] }
//   • Geblockte CDN-Anhang-URL (z. B. cdn.discordapp.com/attachments) → Bild
//     lokal herunterladen (Cache) und als echten Anhang mit attachment://<name>
//     referenzieren. Schlägt der Download fehl → { url: '', files: [] }.
// Nie wirft diese Funktion – ein totes Bild darf keinen Embed-Versand blockieren.
export const resolveEmbedImage = async (url, { maxBytes = DEFAULT_MAX_BYTES } = {}) => {
  const raw = String(url || '').trim();
  if (!raw || !URL_PATTERN.test(raw)) return { url: '', files: [] };
  if (isAllowedEmbedImageUrl(raw)) return { url: raw, files: [] };
  const asset = await fetchEmbedAsset(raw, { maxBytes });
  if (!asset) return { url: '', files: [] };
  const name = `embed-${hashForUrl(raw)}.${String(asset.ext || 'png').replace(/[^a-z0-9]/gi, '')}`;
  return { url: `attachment://${name}`, files: [{ attachment: asset.buffer, name }] };
};

export const _embedAssetCacheInternals = {
  readEmbedAsset,
  fetchEmbedAsset,
  resolveEmbedImage,
  purgeEmbedAssetCache,
  ASSET_DIR,
  hashForUrl,
  extensionFromUrl,
  mimeForExtension
};
