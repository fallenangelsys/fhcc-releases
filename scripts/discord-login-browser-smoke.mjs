import assert from 'node:assert/strict';
import fs from 'node:fs';

const main = fs.readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
const windowStart = main.indexOf('function createDiscordLoginWindow() {');
const statusStart = main.indexOf('async function showDiscordLoginStatus(', windowStart);
const loginStart = main.indexOf('async function openDiscordLogin() {', statusStart);
const nextFunction = main.indexOf('\nfunction requestRuntimeHealth()', loginStart);

assert.ok(windowStart >= 0 && statusStart > windowStart, 'Discord-Login-Fenster konnte im Hauptprozess nicht gefunden werden.');
assert.ok(loginStart > statusStart && nextFunction > loginStart, 'Discord-OAuth-Start konnte im Hauptprozess nicht gefunden werden.');

const windowCode = main.slice(windowStart, statusStart);
const loginCode = main.slice(loginStart, nextFunction);

assert.match(windowCode, /discordLoginWindow\.webContents\.setWindowOpenHandler/,
  'Neue Fenster des Login-Fensters muessen explizit behandelt werden.');
assert.match(windowCode, /shell\.openExternal\(url, \{ activate: true \}\)/,
  'HTTP(S)-Seiten aus dem Login-Fenster muessen im Standardbrowser landen.');
assert.doesNotMatch(windowCode, /\['discord\.com',\s*'www\.discord\.com'/,
  'Discord darf nicht als erlaubtes Ziel im Electron-WebView landen.');
assert.match(windowCode, /url\.pathname\.startsWith\('\/api\/auth\/discord\/callback'\)/,
  'Das eingebettete Statusfenster darf nur den lokalen OAuth-Callback zulassen.');
assert.match(windowCode, /discordLoginWindow\.webContents\.on\('will-navigate'/,
  'Navigationen im Loginfenster muessen abgefangen werden.');
assert.match(windowCode, /if \(isAllowedAuthUrl\(url\)\) return;/,
  'Nur der lokale Callback darf im Statusfenster bleiben.');
assert.match(windowCode, /shell\.openExternal\(url, \{ activate: true \}\)/,
  'Discord-Navigationen muessen im Standardbrowser geoeffnet werden.');
assert.doesNotMatch(windowCode, /discordLoginWindow\?\.loadURL\(url\)/,
  'Discord darf von Event-Handlern nicht ins FHCC-WebView geladen werden.');

assert.match(loginCode, /authorize\?\.protocol\s*!==\s*'https:'\s*\|\|\s*authorize\?\.hostname\s*!==\s*'discord\.com'/,
  'Authorize-URL muss vor dem Oeffnen auf HTTPS und exakt discord.com validiert werden.');
assert.match(loginCode, /shell\.openExternal\(authorize\.href, \{ activate: true \}\)/,
  'Discord OAuth muss im normalen Standardbrowser geoeffnet werden.');
assert.doesNotMatch(loginCode, /authWindow\.loadURL\(authorize(?:\.href)?\)/,
  'Discord OAuth darf nicht in Electron eingebettet werden.');
assert.match(loginCode, /Global environment variables not set!/,
  'Der Grund fuer die externe Oeffnung soll als Regression dokumentiert sein.');

console.log('discord-login-browser-smoke: Discord OAuth wird nur extern im Standardbrowser geoeffnet.');