'use strict';

// Reine Startlogik fuer den Desktop-Hauptprozess, bewusst ohne Electron, damit
// sie direkt getestet werden kann (gleiches Muster wie update-source.cjs).
//
// Hintergrund: Bei einer frischen Installation soll der Bot NICHT von allein
// loslaufen. Einstellungen, Embeds und Discord-Verbindung duerfen erst entstehen,
// wenn der Nutzer den Bot bewusst einrichtet und startet.

const START_MODES = ['auto', 'manual'];
const DEFAULT_START_MODE = 'auto';

// Dateien, deren Vorhandensein belegt, dass die App bereits benutzt wurde.
// guild-configs.json wird beim ersten Bot-Login geschrieben.
const CONFIGURATION_MARKERS = [
  'guild-configs.json',
  'heaven-economy.json',
  'activity-race.json',
  'temp-voice.json'
];

function normalizeStartMode(value) {
  const candidate = String(value || '').trim().toLowerCase();
  if (candidate === 'manual') return 'manual';
  if (candidate === 'auto') return 'auto';
  // Unbekannte Werte sind harmlos und werden auf 'manual' gezogen: Im Zweifel
  // startet nichts, statt ungefragt einen Bot online zu schalten.
  return candidate ? DEFAULT_START_MODE : DEFAULT_START_MODE;
}

function isValidStartMode(value) {
  return START_MODES.includes(String(value || '').trim().toLowerCase());
}

/**
 * Erkennt eine frische Installation. Wenn keine der Konfigurations-Markern
 * existiert, wurde die App noch nie benutzt - egal wie viele Cache-Dateien
 * (Heartbeats, Sitzungsgeheimnis) schon angelegt wurden.
 */
function detectFreshInstall(dataEntries = []) {
  const entries = Array.isArray(dataEntries) ? dataEntries : [];
  const present = new Set(entries.map((entry) => String(entry)));
  return !CONFIGURATION_MARKERS.some((marker) => present.has(marker));
}

/**
 * Zentrale Entscheidung, ob der Bot beim App-Start von allein laufen darf.
 *
 * @returns {{ shouldStart: boolean, reason: string, freshInstall: boolean }}
 */
function resolveAutoStart({
  explicitStart = false,
  freshInstall = false,
  startMode = DEFAULT_START_MODE,
  botTokenConfigured = false,
  oauthConfigured = false
} = {}) {
  const mode = normalizeStartMode(startMode);

  // Ausdruecklicher CLI-Aufruf gewinnt immer, das ist der bewusste Weg des
  // Nutzers und nicht der automatische Start.
  if (explicitStart) {
    return { shouldStart: true, reason: 'explicit-start', freshInstall: Boolean(freshInstall) };
  }

  if (mode === 'manual') {
    return { shouldStart: false, reason: 'manual-mode', freshInstall: Boolean(freshInstall) };
  }

  if (freshInstall) {
    return { shouldStart: false, reason: 'fresh-install', freshInstall: true };
  }

  if (!botTokenConfigured && !oauthConfigured) {
    return { shouldStart: false, reason: 'not-configured', freshInstall: Boolean(freshInstall) };
  }

  return { shouldStart: true, reason: 'auto', freshInstall: Boolean(freshInstall) };
}

function describeStartupMode({ startMode = DEFAULT_START_MODE, freshInstall = false } = {}) {
  const mode = normalizeStartMode(startMode);
  if (mode === 'manual') {
    return 'Der Bot startet nicht automatisch. Starten erfolgt bewusst über „Bot starten“ in der Oberfläche.';
  }
  if (freshInstall) {
    return 'Frische Installation: Der Bot bleibt gestoppt, bis die Einrichtung abgeschlossen ist.';
  }
  return 'Der Bot startet automatisch, sobald Bot-Token und Anmeldung eingerichtet sind.';
}

module.exports = {
  START_MODES,
  DEFAULT_START_MODE,
  CONFIGURATION_MARKERS,
  normalizeStartMode,
  isValidStartMode,
  detectFreshInstall,
  resolveAutoStart,
  describeStartupMode
};