const api = window.fallenHeaven;
function readLocalJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw);
    if (Array.isArray(fallback) && !Array.isArray(parsed)) return fallback;
    return parsed;
  } catch {
    // Preserve the original value for recovery; a broken optional UI cache must
    // never prevent the Control Center from starting.
    return fallback;
  }
}
const state = {
  activeView: 'center',
  botOnline: false,
  busy: false,
  authenticated: false,
  authRestoring: false,
  user: null,
  guilds: [],
  selectedGuildId: localStorage.getItem('fh-selected-guild') || '',
  workspaceMode: localStorage.getItem('fh-workspace-mode') || 'discord',
  config: null,
  featureCards: [],
  activeFeatureId: null,
  moduleQuery: '',
  moduleFilter: 'all',
  moduleDirty: false,
  moduleSaving: false,
  moduleChannels: [],
  moduleRoles: [],
  drafts: readLocalJson('fh-native-drafts', []),
  studioChannels: [],
  selectedStudioChannelId: '',
  studioMessages: [],
  studioFields: [],
  studioEmbeds: [],
  studioReactionRoles: [],
  studioComponents: [],
  studioComponentSet: 'none',
  studioSpecialTemplate: '',
  studioPcvSection: 'panel',
  studioCountingDmSection: 'strikeLock',
  studioVipDmSection: 'giftReceived',
  studioActivityUsesPeriodColor: false,
  studioActivityRaceSection: 'daily',
  studioWorkshopItemId: '',
  studioWorkshopItemTitle: '',
  studioWorkshopItemTokens: null,
  studioWorkshopAssetMode: 'global',
  activeStudioEmbedIndex: 0,
  activeStudioMessageId: '',
  studioSourceMessage: null,
  messageEmojis: [],
  messageEmojiGuildId: '',
  messageEmojiFilter: 'all',
  messageEmojiTarget: null,
  messageEmojiLoading: false,
  messageEmojiFetchedAt: 0
};
window.FallenHeavenRuntime?.bindState(state);

const moduleIdAliases = {
  antiRaid: 'antiraid',
  leveling: 'levels',
  level: 'levels'
};

const fallbackModules = [
  ['moderation', 'Moderation', 'Filter, Warnungen und sichere Aktionen', 'MOD'],
  ['instantBanWords', 'Instant Wort-Ban', 'Sofort-Bann bei verbotenen Begriffen', 'BAN'],
  ['welcomeFarewell', 'Welcome', 'Begrüßt neue Mitglieder mit Stil', 'HEL'],
  ['levels', 'Leveling', 'Aktivität, Level und Belohnungen', 'XP'],
  ['tickets', 'Tickets', 'Strukturierter Support für deine Community', 'TKT'],
  ['logging', 'Logging', 'Audit-Trails für wichtige Ereignisse', 'LOG'],
  ['autoresponder', 'Auto Responder', 'Gezielte automatische Antworten', 'AUTO'],
  ['autoRole', 'AutoRole', 'Rollen beim Beitritt vergeben', 'ROLE'],
  ['serverTagTracker', 'Server-Tag-Tracker', 'Server-Tag erkennen und Rollen synchronisieren', 'TAG'],
  ['forumCleaner', 'Forum-Cleaner', 'Alle ausgewählten Foren sicher tiefenbereinigen', 'FORUM'],
  ['steamWorkshop', 'Steam Workshop', 'Workshop-Mods als detaillierten Forum-Katalog pflegen', 'STEAM'],
  ['emojiManager', 'Emoji-Verwaltung', 'Statische und animierte Server-Emojis kontrolliert umbenennen', 'EMOJI'],
  ['voiceChatCleaner', 'Voice-Chat-Cleaner', 'Voice-Chats nach dem Verlassen vollständig leeren', 'VC'],
  ['tempVoice', 'TempVoice', 'Eigener temporärer Sprachkanal beim Joinen', 'TV'],
  ['activityRace', 'Aktivitäts-Liga', 'Top 1–3 für Chat und Sprachchat', 'RACE'],
  ['serverBackup', 'Server-Backup', 'Tägliche Struktur-Sicherung und Restore', 'BAK'],
  ['antiraid', 'Anti-Raid', 'Schutz bei auffälligen Beitritten', 'SAFE'],
  ['memberManagement', 'Member Management', 'Mitglieder und Struktur im Blick', 'MEM']
];

function normalizeModuleId(rawId) {
  const value = String(rawId || '').trim();
  if (!value) return '';
  const lowered = value.toLowerCase();
  return moduleIdAliases[lowered] || value;
}

function normalizeModuleConfigIds(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return {};
  }
  const normalized = {};
  const entries = Object.keys(config || {});
  for (let i = 0; i < entries.length; i += 1) {
    const key = entries[i];
    const value = config[key];
    const normalizedKey = normalizeModuleId(key);
    if (!normalizedKey) continue;
    if (!Object.prototype.hasOwnProperty.call(config, key)) continue;
    if (Object.prototype.hasOwnProperty.call(normalized, normalizedKey)) {
      if (!normalized[normalizedKey] || typeof normalized[normalizedKey] !== 'object' || Array.isArray(normalized[normalizedKey]) || typeof value !== 'object' || Array.isArray(value)) {
        if (normalized[normalizedKey] == null || value == null) {
          normalized[normalizedKey] = value;
        }
        continue;
      }
      normalized[normalizedKey] = { ...normalized[normalizedKey], ...value };
      continue;
    }
    normalized[normalizedKey] = value;
  }
  Object.keys(config).forEach(function (key) {
    if (key !== normalizeModuleId(key) && normalized[normalizeModuleId(key)] === undefined) {
      normalized[key] = config[key];
    }
  });
  return normalized;
}

function normalizeFeatureCard(feature, index) {
  if (Array.isArray(feature)) {
    const [rawId, rawTitle, rawDescription, rawIcon] = feature;
    const id = normalizeModuleId(rawId);
    if (!id) return null;
    return {
      id,
      title: String(rawTitle || id || '').trim() || id,
      description: String(rawDescription || '').trim() || 'Bot-Modul',
      detail: String(rawDescription || '').trim(),
      icon: String(rawIcon || 'FH').trim() || 'FH',
      fields: [],
      _normalizedSource: index
    };
  }
  if (!feature || typeof feature !== 'object') return null;
  const id = normalizeModuleId(feature.id);
  if (!id) return null;
  const fields = Array.isArray(feature.fields) ? feature.fields.filter(function (field) {
    if (!field || typeof field !== 'object') return false;
    return String(field.key || '').trim();
  }).map(function (field) {
    return { ...field, key: String(field.key || '').trim() };
  }) : [];
  return {
    ...feature,
    id,
    title: String(feature.title || '').trim() || id,
    description: String(feature.description || feature.detail || '').trim() || 'Bot-Modul',
    detail: String(feature.detail || '').trim(),
    icon: String(feature.icon || 'FH').trim() || 'FH',
    fields,
    _normalizedSource: index
  };
}

function normalizeFeatureCatalog(rawFeatureCards) {
  if (!Array.isArray(rawFeatureCards)) return [];
  const normalized = [];
  const seen = new Set();
  for (let index = 0; index < rawFeatureCards.length; index += 1) {
    const feature = normalizeFeatureCard(rawFeatureCards[index], index);
    if (!feature || !feature.id || seen.has(feature.id)) continue;
    seen.add(feature.id);
    normalized.push(feature);
  }
  return normalized;
}

function getNormalizedFeatureById(featureId) {
  const id = normalizeModuleId(featureId);
  if (!id) return null;
  return activeCatalog().find(function (item) { return item[0] === id; })?.[4] || null;
}

const timeline = [
  { type: 'ready', title: 'Control Center bereit', detail: 'Native Oberfläche und lokale Dienste geladen', time: 'Systemstart' },
  { type: 'shield', title: 'Prozessschutz aktiv', detail: 'Doppelstarts werden automatisch verhindert', time: 'Systemstart' },
  { type: 'studio', title: 'Content Studio bereit', detail: 'Entwürfe und Bot-Nachrichten sind verfügbar', time: 'Systemstart' }
];
let lastTimelineBotState = null;
let statusPollInFlight = false;
let timelineRenderSignature = '';
const WORKSPACE_RECOVERABLE_STATUSES = [0, 429, 502, 503, 504];
const WORKSPACE_RESTORE_TIMEOUT_MS = 18000;
const WORKSPACE_NORMAL_TIMEOUT_MS = 30000;
let workspaceRetryTimer = null;
let workspaceRetryStartedAt = 0;
let workspaceRetryCount = 0;
let serverTagRefreshTimer = null;
let voiceCleanerRefreshTimer = null;
let voiceLogEventsCursor = null;
let voiceLogEventsLoading = false;
let forumCleanerRefreshTimer = null;
let steamWorkshopRefreshTimer = null;
let steamWorkshopStatusSnapshot = null;
let emojiManagerRefreshTimer = null;
let emojiManagerPreview = null;
let activityRaceRefreshTimer = null;
let activityRaceRankingSnapshot = null;
let activityRaceRankingMetric = 'chat';
let activityRaceRankingQuery = '';

function isRecoverableWorkspaceStatus(status) {
  return WORKSPACE_RECOVERABLE_STATUSES.includes(Number(status || 0));
}

function setPrebootStatus(message) {
  const node = document.querySelector('.fh-preboot-state span');
  if (node) node.textContent = message;
}

function resetWorkspaceRetryState() {
  clearTimeout(workspaceRetryTimer);
  workspaceRetryTimer = null;
  workspaceRetryStartedAt = 0;
  workspaceRetryCount = 0;
}
const appEditorDefaults = {
  brand: 'FALLEN HEAVEN',
  subtitle: 'Native Discord Control App',
  hero: 'DEIN DISCORD.\nDEINE WELT.',
  lead: 'Eine native Schaltzentrale für deine Community, deine Systeme und deine Inhalte.',
  accent: '#a596ff',
  background: 'fallen',
  density: 'premium',
  motion: true,
  selectedPage: 'home',
  pages: {
    home: {
      kicker: 'FALLEN HEAVEN DESKTOP APP',
      title: 'DEIN ORT\nFÜR DEINE\nCOMMUNITY.',
      lead: 'Verwalte deinen Server, ohne den Blick für das Wichtigste zu verlieren.'
    },
    center: {
      kicker: 'FALLEN HEAVEN / CONTROL CENTER',
      title: 'Command\nDeck.',
      lead: 'Starte den Bot, kontrolliere Module, erstelle Content und behalte dein System im Blick.'
    },
    community: {
      kicker: 'FALLEN HEAVEN / SERVERVERWALTUNG',
      title: 'Dein Server.\nVollständig im Blick.',
      lead: 'Events, Kanäle, Rollen, Mitglieder und aktive Booster in einer sicheren Verwaltungsoberfläche.'
    },
    modules: {
      kicker: 'FALLEN HEAVEN / MODULE',
      title: 'Systeme\nmit Haltung.',
      lead: 'Jedes System hat seinen Platz. Konfiguriere echte Bot-Module für den ausgewählten Server.'
    },
    studio: {
      kicker: 'FALLEN HEAVEN / EMBED STUDIO',
      title: 'Discord\nMessage Lab.',
      lead: 'Discohook-artiger Editor direkt in der App. Der Bot sendet mit seinen Rechten und speichert Nachrichten zum späteren Bearbeiten.'
    },
    skin: {
      kicker: 'FALLEN HEAVEN / MINECRAFT CREATOR',
      title: 'Skin\nStudio.',
      lead: 'Minecraft-Skins pixelgenau zeichnen, direkt am 3D-Modell prüfen und als 64 × 64 PNG exportieren.'
    },
    editor: {
      kicker: 'FALLEN HEAVEN / APP EDITOR',
      title: 'App Look.\nLive gebaut.',
      lead: 'Bearbeite die native App selbst: Branding, Startseite, Farben, Hintergrund und jede App-Seite.'
    },
    system: {
      kicker: 'FALLEN HEAVEN / SYSTEM',
      title: 'Stabil.\nUnter Kontrolle.',
      lead: 'Prozess-Schutz, lokale Daten und Systemprotokolle an einem Ort.'
    }
  }
};

// Gespeicherte App-Editor-Einstellungen beim Start laden (wurde vorher nie
// geladen – die Effekte-Einstellung ging damit bei jedem Neustart verloren).
let appEditorSettings = FHCCAppEditor.normalizeAppEditorSettings(readLocalJson('fh-app-editor-settings', null));
let appEditorActivePage = appEditorSettings.selectedPage || 'home';
globalThis.appEditorDefaults = appEditorDefaults;
globalThis.appEditorSettings = appEditorSettings;
globalThis.appEditorActivePage = appEditorActivePage;

const studioTemplates = {
  welcome: {
    content: 'Willkommen bei FALLEN HEAVEN.',
    embed: {
      title: 'Willkommen in FALLEN HEAVEN',
      description: 'Schön, dass du da bist. Lies die Regeln und mach es dir bequem.',
      color: '#58b9ff',
      footerText: 'FALLEN HEAVEN',
      timestamp: true,
      fields: [
        { name: 'Start', value: 'Regeln lesen und Rollen auswählen.', inline: true },
        { name: 'Support', value: 'Bei Fragen einfach im Team melden.', inline: true }
      ]
    }
  },
  level: {
    content: '{user} ist aufgestiegen.',
    embed: {
      title: 'Level Up!',
      description: '{user} hat Level **{level}** erreicht.',
      color: '#35d07f',
      thumbnailUrl: '{userAvatar}',
      footerText: '{guild} Level-System',
      timestamp: true,
      fields: [
        { name: 'Neues Level', value: '{level}', inline: true },
        { name: 'Server', value: '{guild}', inline: true }
      ]
    }
  },
  notice: {
    content: '@everyone',
    embed: {
      title: 'Ankündigung',
      description: 'Schreibe hier deine Nachricht für die Community.',
      color: '#f1b84b',
      footerText: 'FALLEN HEAVEN News',
      timestamp: true,
      fields: []
    }
  },
  rules: {
    content: '',
    embed: {
      title: 'Server-Regeln',
      description: 'Respekt, kein Spam, keine Beleidigungen und keine Werbung ohne Erlaubnis.',
      color: '#8d7aff',
      footerText: 'FALLEN HEAVEN Sicherheit',
      timestamp: true,
      fields: [
        { name: 'Miteinander', value: 'Bleib fair, ruhig und respektvoll.', inline: false },
        { name: 'Moderation', value: 'Team-Entscheidungen werden beachtet.', inline: false }
      ]
    }
  }
};

window.addEventListener('message', function (event) {
  if (!event.data || !event.data.type) return;
  if (event.data.type === 'fallen-heaven-login') {
    beginLogin().then(function () {
      if (state.authenticated) setView('center');
    }).catch(function () {
      toast('Die Anmeldung konnte nicht gestartet werden.', 'error');
    });
    return;
  }
  if (event.data.type === 'fallen-heaven-external' && event.data.url) {
    api.openExternal(event.data.url);
    return;
  }
  if (event.data.type === 'fallen-heaven-language') {
    localStorage.setItem('fh-landing-language', event.data.language || 'en');
    toast('Sprache wurde für das Hauptmenü gespeichert.', 'success');
    return;
  }
  if (event.data.type === 'fallen-heaven-dashboard-command') {
    const action = String(event.data.action || '');
    if (!['start', 'stop', 'restart'].includes(action)) return;
    void controlBot(action).then(function (result) {
      event.source?.postMessage({
        type: 'fallen-heaven-dashboard-command-result',
        action: action,
        ok: Boolean(result?.ok),
        active: state.botOnline,
        message: result?.message || document.getElementById('action-message')?.textContent || ''
      }, '*');
    });
  }
});

function getByPath(source, path) {
  return String(path || '').split('.').filter(Boolean).reduce(function (value, key) {
    return value && typeof value === 'object' ? value[key] : undefined;
  }, source);
}

function setByPath(target, path, value) {
  const keys = String(path || '').split('.').filter(Boolean);
  if (!keys.length) return;
  let cursor = target;
  keys.slice(0, -1).forEach(function (key) {
    if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {};
    cursor = cursor[key];
  });
  cursor[keys[keys.length - 1]] = value;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, function (character) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
  });
}

// escapeHtml escaped bereits Anführungszeichen – daher ist es auch für
// Attribute sicher. Als eigener Name, damit Attribut-Kontexte klar sind.
function escapeAttr(value) {
  return escapeHtml(value);
}

// Konvertiert bekannte Discord-Emoji-Mentions (<:name:id> / <a:name:id>) in Vorschau-
// Bilder; alles andere wird sicher escaped. So zeigt die Studio-Vorschau Emojis
// genauso an, wie Discord sie später im Embed rendert (statt roher Mentions).
function studioEmojiHtml(value) {
  const byId = new Map(state.messageEmojis.map(function (emoji) { return [String(emoji.id), emoji]; }));
  return String(value || '').split(/(<a?:[A-Za-z0-9_~]+:\d+>)/g).map(function (part) {
    const match = /^<a?:([A-Za-z0-9_~]+):(\d+)>$/.exec(part);
    if (match && byId.has(match[2])) {
      const emoji = byId.get(match[2]);
      return '<img class="message-inline-emoji" src="' + escapeHtml(emoji.url) + '" alt=":' + escapeHtml(emoji.name) + ':" title=":' + escapeHtml(emoji.name) + ':">';
    }
    return escapeHtml(part);
  }).join('');
}

// Wie studioEmojiHtml, aber zusätzlich werden http(s)-URLs als klickbare Links
// gerendert - exakt so, wie Discord URLs im Embed-Text (auch im Footer) anzeigt.
// Nur http/https-Schemata werden verlinkt, alles andere bleibt sicher escaped.
function studioRichText(value) {
  const byId = new Map(state.messageEmojis.map(function (emoji) { return [String(emoji.id), emoji]; }));
  return String(value || '').split(/(<a?:[A-Za-z0-9_~]+:\d+>)/g).map(function (part) {
    const match = /^<a?:([A-Za-z0-9_~]+):(\d+)>$/.exec(part);
    if (match && byId.has(match[2])) {
      const emoji = byId.get(match[2]);
      return '<img class="message-inline-emoji" src="' + escapeHtml(emoji.url) + '" alt=":' + escapeHtml(emoji.name) + ':" title=":' + escapeHtml(emoji.name) + ':">';
    }
    return escapeHtml(part).replace(/(https?:\/\/[^\s<>"']+)/g, function (url) {
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>';
    });
  }).join('');
}

let appConfirmQueue = Promise.resolve();
function showAppConfirm(options) {
  const settings = options || {};
  const operation = function () { return new Promise(function (resolve) {
    if (typeof HTMLDialogElement === 'undefined') { resolve(false); return; }
    const dialog = document.createElement('dialog');
    const tone = ['danger', 'warning', 'primary'].includes(settings.tone) ? settings.tone : 'primary';
    const metrics = Array.isArray(settings.metrics) ? settings.metrics.slice(0, 6) : [];
    dialog.className = 'app-confirm-dialog tone-' + tone;
    dialog.setAttribute('aria-labelledby', 'app-confirm-title');
    dialog.innerHTML = '<div class="app-confirm-glow"></div>' +
      '<header><span class="app-confirm-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3 3.8 7.2v5.6c0 4.3 3.3 7.3 8.2 8.7 4.9-1.4 8.2-4.4 8.2-8.7V7.2L12 3Z"></path><path d="M12 8v5M12 17h.01"></path></svg></span><div><small>' + escapeHtml(settings.eyebrow || 'FALLEN HEAVEN · SICHERHEIT') + '</small><h2 id="app-confirm-title">' + escapeHtml(settings.title || 'Aktion bestätigen') + '</h2></div><button type="button" data-app-confirm-cancel class="app-confirm-close" aria-label="Schließen">×</button></header>' +
      '<section><p>' + escapeHtml(settings.message || 'Möchtest du fortfahren?') + '</p>' +
      (metrics.length ? '<div class="app-confirm-metrics">' + metrics.map(function (metric) { return '<article><small>' + escapeHtml(metric.label || '') + '</small><strong>' + escapeHtml(metric.value ?? '0') + '</strong></article>'; }).join('') + '</div>' : '') +
      (settings.note ? '<div class="app-confirm-note"><i aria-hidden="true">i</i><span>' + escapeHtml(settings.note) + '</span></div>' : '') + '</section>' +
      '<footer><button type="button" data-app-confirm-cancel class="app-confirm-secondary" autofocus>' + escapeHtml(settings.cancelLabel || 'Abbrechen') + '</button><button type="button" data-app-confirm-accept class="app-confirm-primary">' + escapeHtml(settings.confirmLabel || 'Bestätigen') + '<span aria-hidden="true">→</span></button></footer>';
    document.body.appendChild(dialog);
    let completed = false;
    const finish = function (accepted) {
      if (completed) return;
      completed = true;
      if (dialog.open) dialog.close(accepted ? 'confirm' : 'cancel');
      dialog.remove();
      resolve(Boolean(accepted));
    };
    dialog.querySelectorAll('[data-app-confirm-cancel]').forEach(function (button) { button.addEventListener('click', function () { finish(false); }); });
    dialog.querySelector('[data-app-confirm-accept]')?.addEventListener('click', function () { finish(true); });
    dialog.addEventListener('cancel', function (event) { event.preventDefault(); finish(false); });
    dialog.addEventListener('click', function (event) { if (event.target === dialog) finish(false); });
    dialog.showModal();
  }); };
  const result = appConfirmQueue.then(operation, operation);
  appConfirmQueue = result.catch(function () { return false; });
  return result;
}
window.fallenHeavenConfirm = showAppConfirm;
window.fallenHeavenApplyConfig = function (config) {
  if (!config || typeof config !== 'object') return;
  state.config = config;
  state.moduleDirty = false;
  renderModules();
  if (state.activeView === 'modules') renderModuleConfig({ force: true });
};

function setText(id, value) {
  const node = document.getElementById(id);
  const next = String(value ?? '');
  if (node && node.textContent !== next) node.textContent = next;
}

function bindId(id, eventName, handler, options) {
  const node = document.getElementById(id);
  if (!node) return null;
  node.addEventListener(eventName, handler, options);
  return node;
}

// Aktuelle Config vom Server holen und state.config aktualisieren.
// Wird vor jedem Studio-Open aufgerufen, damit das Studio immer das
// aktuelle Embed zeigt und nicht eine veraltete gecachte Version.
async function refreshConfig(guildId) {
  if (!guildId) return;
  try {
    const response = await apiRequestWithRetry({ path: '/api/config/' + encodeURIComponent(guildId), timeoutMs: 8000 }, 3);
    if (response.ok && response.data?.config) {
      state.config = normalizeModuleConfigIds(response.data.config);
    }
  } catch { /* Stille Fehlerbehandlung – alten Cache beibehalten */ }
}

async function setView(view) {
  if (state.activeView === 'modules' && view !== 'modules' && !(await confirmDiscardModuleChanges())) return false;
  if (state.activeView === 'studio' && view !== 'studio' && !(await tempVoiceUi.confirmLeaveStudio())) return false;
  const restricted = ['center', 'community', 'modules', 'studio', 'skin', 'system'].includes(view);
  if (restricted && !state.authenticated) {
    document.body.classList.add('access-open');
    const access = document.querySelector('.access-panel');
    if (access) access.classList.add('attention');
    toast('Bitte melde dich zuerst mit Discord an.', 'info');
    return false;
  }
  const targetView = document.getElementById(view + '-view');
  if (state.activeView === view && targetView?.classList.contains('active')) return true;
  document.querySelectorAll('dialog[open]').forEach(function (dialog) { dialog.close(); });
  document.querySelectorAll('.landing-menu.open, .nav_dd.w--open').forEach(function (menu) { menu.classList.remove('open', 'w--open'); });
  document.querySelectorAll('[aria-expanded="true"]').forEach(function (trigger) { trigger.setAttribute('aria-expanded', 'false'); });
  state.activeView = view;
  document.querySelectorAll('.view').forEach(function (item) {
    item.classList.toggle('active', item.id === view + '-view');
  });
  document.querySelectorAll('[data-view]').forEach(function (button) {
    button.classList.toggle('active', button.dataset.view === view);
  });
  if (view === 'skin') window.FallenHeavenSkinStudio?.loadViewerLibraries?.();
  if (view === 'system') void loadSystemCenter();
  if (view === 'modules' && !state.moduleDirty) {
    renderModules();
    if (state.authenticated && state.selectedGuildId) void refreshModuleChannelResources(state.selectedGuildId);
  }
  if (view === 'studio') {
    if (state.authenticated && state.selectedGuildId) void loadStudioChannels(state.selectedGuildId, { fresh: true });
    renderDrafts();
    updatePreview();
  }
  updateShellMode();
  renderWorkspacePortal();
  document.dispatchEvent(new CustomEvent('fh:view-change', { detail: { view: view } }));
  requestAnimationFrame(function () {
    document.querySelector('.main-stage')?.scrollTo({ top: 0, behavior: 'auto' });
  });
  return true;
}

function updateShellMode() {
  document.body.classList.remove('public-home');
}

const navigationCommands = [
  { id: 'center', label: 'Übersicht', detail: 'Botstatus und wichtigste Aktionen', icon: 'OV' },
  { id: 'community', label: 'Serververwaltung', detail: 'Mitglieder, Kanäle, Rollen und Boosts', icon: 'SV' },
  { id: 'modules', label: 'Module', detail: 'Alle Bot-Funktionen konfigurieren', icon: 'MO' },
  { id: 'studio', label: 'Embed Studio', detail: 'Discord-Nachrichten gestalten und senden', icon: 'ES' },
  { id: 'skin', label: 'Skin Studio', detail: 'Minecraft-Skins zeichnen und als PNG exportieren', icon: 'MC' },
  { id: 'system', label: 'System', detail: 'Diagnose, Protokolle und lokale Daten', icon: 'SY' }
];

function commandPaletteEntries() {
  if (!state.authenticated) return [{ kind: 'login', id: 'login', label: 'Mit Discord anmelden', detail: 'Dashboard und Serverfunktionen öffnen', icon: 'DC' }];
  return [
    { kind: 'action', id: 'bot-start', label: 'Bot starten', detail: 'Bot-Service kontrolliert starten', icon: 'BS' },
    { kind: 'action', id: 'bot-restart', label: 'Bot neu starten', detail: 'Bot-Service sauber neu verbinden', icon: 'BR' },
    { kind: 'action', id: 'community-refresh', label: 'Discord-Daten aktualisieren', detail: 'Serververwaltung mit Discord synchronisieren', icon: 'DS' },
    { kind: 'action', id: 'system-refresh', label: 'Diagnose aktualisieren', detail: 'Systemzustand und Protokolle neu laden', icon: 'DI' },
    ...navigationCommands.map(function (entry) { return { ...entry, kind: 'view' }; }),
    ...activeCatalog().map(function (item) {
      return { kind: 'module', id: item[0], label: item[1], detail: 'Modul · ' + item[2], icon: item[3] };
    })
  ];
}

function commandIconMark(icon) {
  if (icon === 'DC') {
    return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>';
  }
  if (icon === 'MC') {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 20.5 7.5 12 12.5 3.5 7.5Z" fill="#6abf4c"/><path d="M3.5 7.5 12 12.5 12 21.5 3.5 16.5Z" fill="#7e5230"/><path d="M20.5 7.5 12 12.5 12 21.5 20.5 16.5Z" fill="#96613a"/><path d="M12 4.6 17.9 8 12 11.4 6.1 8Z" fill="rgba(255,255,255,.16)"/><path d="M12 2.5 20.5 7.5 12 12.5 3.5 7.5 12 2.5M20.5 7.5v9l-8.5 5v-9M3.5 7.5v9l8.5 5v-9" fill="none" stroke="rgba(255,255,255,.4)" stroke-width=".9" stroke-linejoin="round"/></svg>';
  }
  return escapeHtml(icon);
}

function renderCommandPalette() {
  const host = document.getElementById('command-palette-results');
  const input = document.getElementById('command-palette-search');
  if (!host || !input) return;
  const query = input.value.trim().toLocaleLowerCase('de');
  const entries = commandPaletteEntries().filter(function (entry) {
    return !query || [entry.label, entry.detail, entry.id].join(' ').toLocaleLowerCase('de').includes(query);
  }).slice(0, 20);
  host.innerHTML = entries.length ? entries.map(function (entry, index) {
    return '<button class="command-result ' + (index === 0 ? 'active' : '') + '" type="button" data-command-kind="' + escapeHtml(entry.kind) + '" data-command-id="' + escapeHtml(entry.id) + '"><i>' + commandIconMark(entry.icon) + '</i><span><b>' + escapeHtml(entry.label) + '</b><small>' + escapeHtml(entry.detail) + '</small></span><em>' + (entry.kind === 'action' ? 'AUSFÜHREN' : 'ÖFFNEN') + '</em></button>';
  }).join('') : '<p class="command-empty">Kein passender Bereich oder Modul gefunden.</p>';
}

function openCommandPalette() {
  const dialog = document.getElementById('command-palette');
  const input = document.getElementById('command-palette-search');
  if (!dialog || dialog.open) return;
  input.value = '';
  renderCommandPalette();
  dialog.showModal();
  requestAnimationFrame(function () { input.focus(); });
}

async function activateCommand(kind, id) {
  const dialog = document.getElementById('command-palette');
  if (kind === 'login') {
    dialog?.close();
    void beginLogin();
    return;
  }
  if (kind === 'module') {
    if (id !== state.activeFeatureId && !(await confirmDiscardModuleChanges())) return;
    dialog?.close();
    selectModule(id);
    await setView('modules');
    requestAnimationFrame(function () {
      document.getElementById('module-config')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return;
  }
  if (kind === 'action') {
    dialog?.close();
    if (id === 'bot-start' || id === 'bot-restart') {
      if (!(await setView('center'))) return;
      void controlBot(id === 'bot-start' ? 'start' : 'restart');
      return;
    }
    if (id === 'community-refresh') {
      if (!(await setView('community'))) return;
      document.getElementById('community-refresh')?.click();
      return;
    }
    if (id === 'system-refresh') {
      if (!(await setView('system'))) return;
      document.getElementById('refresh-system')?.click();
      return;
    }
  }
  dialog?.close();
  await setView(id);
}

function toast(message, tone, options) {
  if (typeof window.fallenHeavenNotify === 'function') {
    window.fallenHeavenNotify(message, tone || 'info', undefined, options || {});
    return;
  }
  const node = document.getElementById('toast');
  if (!node || !String(message || '').trim()) return;
  clearTimeout(toast.timer);
  node.classList.remove('show');
  node.textContent = String(message).trim();
  node.dataset.tone = tone || 'info';
  node.setAttribute('aria-live', tone === 'error' ? 'assertive' : 'polite');
  requestAnimationFrame(function () {
    node.classList.add('show');
    toast.timer = setTimeout(function () { node.classList.remove('show'); }, tone === 'error' ? 5200 : 3200);
  });
}

function serviceButtons() {
  return Array.from(document.querySelectorAll('[data-action="start"], [data-action="stop"], [data-action="restart"]'));
}

function setBusy(value, action) {
  state.busy = value;
  document.body.classList.toggle('is-busy', Boolean(value));
  const progress = { start: 'Wird gestartet ...', stop: 'Wird gestoppt ...', restart: 'Wird neu gestartet ...' };
  serviceButtons().forEach(function (button) {
    if (!button.dataset.idleLabel) button.dataset.idleLabel = button.textContent.trim();
    button.disabled = Boolean(value);
    button.setAttribute('aria-busy', value ? 'true' : 'false');
    button.classList.toggle('is-busy', Boolean(value) && button.dataset.action === action);
    button.textContent = value && button.dataset.action === action ? progress[action] : button.dataset.idleLabel;
  });
}

function setStatus(active, detail) {
  const message = detail || (active ? 'Discord Service ist erreichbar.' : 'Starte den Bot ueber das Command Deck.');
  state.botOnline = active;
  document.body.dataset.botState = active ? 'online' : 'offline';
  setText('bot-state', active ? 'Bot ist aktiv' : 'Bot ist offline');
  setText('home-service', active ? 'Discord Bot online' : 'Bot wartet auf Start');
  setText('mini-status', active ? 'Bot verbunden' : 'Bot offline');
  setText('bot-detail', message);
  setText('engine-label', active ? 'ONLINE' : 'OFFLINE');
  setText('engine-copy', active ? 'Bot-Prozess ist aktiv' : 'Kein aktiver Bot-Prozess');
  setText('status-label', active ? 'ONLINE' : 'IDLE');
  setText('service-headline', active ? 'Dein Bot ist im Einsatz.' : 'Bereit für deinen Befehl.');
  document.querySelectorAll('.status-dot, .signal-dot, .service-pill i').forEach(function (node) {
    node.classList.toggle('online', active);
  });
  document.querySelectorAll('.service-command').forEach(function (node) {
    node.classList.toggle('online', active);
  });
  if (lastTimelineBotState !== active) {
    lastTimelineBotState = active;
    addTimelineEvent({
      type: active ? 'online' : 'offline',
      title: active ? 'Bot-Service verbunden' : 'Bot-Service offline',
      detail: active ? 'Discord-Verbindung und Prozess sind erreichbar' : 'Der Bot-Prozess ist aktuell nicht aktiv'
    });
  } else {
    renderTimeline();
  }
}

function applyAuth(user, options = {}) {
  state.authenticated = Boolean(user);
  state.authRestoring = Boolean(user && options.restoring);
  state.user = user || null;
  if (!state.authenticated) resetWorkspaceRetryState();
  if (state.authRestoring) {
    document.body.classList.add('auth-restoring', 'auth-busy');
    document.body.classList.remove('auth-ready', 'access-open', 'authenticated');
    document.getElementById('preboot-screen')?.removeAttribute('aria-hidden');
    setPrebootStatus(options.status || 'Gespeicherte Discord-Sitzung wird geprüft');
  } else {
    document.body.classList.remove('auth-restoring', 'auth-busy');
    document.body.classList.add('auth-ready');
    document.getElementById('preboot-screen')?.setAttribute('aria-hidden', 'true');
    document.body.classList.toggle('authenticated', state.authenticated);
    document.body.classList.toggle('access-open', !state.authenticated);
  }
  setText('login-session-status', state.authRestoring
    ? 'Gespeicherte Sitzung wird geprüft'
    : state.authenticated
      ? 'Discord-Sitzung bestätigt'
      : 'Bereit für die sichere Anmeldung');
  const guildPicker = document.getElementById('guild-picker');
  const loginBridge = document.getElementById('login-bridge');
  if (guildPicker) guildPicker.hidden = !state.authenticated;
  if (loginBridge) loginBridge.hidden = state.authenticated;
  document.querySelectorAll('[data-login="true"], #bridge-login').forEach(function (node) { node.hidden = false; });
  const publicLogin = document.getElementById('public-discord-login');
  const heroLogin = document.getElementById('hero-login');
  if (publicLogin) publicLogin.textContent = state.authenticated ? 'Control Center öffnen' : 'Dashboard Login';
  if (heroLogin) heroLogin.textContent = state.authenticated ? 'Control Center öffnen' : 'Mit Discord anmelden';
  const accountName = document.getElementById('account-name');
  const accountAction = document.getElementById('discord-login');
  const logoutAction = document.getElementById('discord-logout');
  const accountAvatar = document.querySelector('.account-avatar');
  if (state.authenticated) {
    if (accountName) accountName.textContent = state.authRestoring ? 'Sitzung wird geprüft' : (user.displayName || user.username || 'Discord verbunden');
    if (accountAction) accountAction.textContent = state.authRestoring ? 'Wird geprüft' : 'Verbunden';
    if (logoutAction) logoutAction.hidden = state.authRestoring;
    if (accountAvatar && user.avatarUrl) accountAvatar.src = user.avatarUrl;
  } else {
    if (accountName) accountName.textContent = 'Nicht verbunden';
    if (accountAction) accountAction.textContent = 'Mit Discord anmelden';
    if (logoutAction) logoutAction.hidden = true;
    if (accountAvatar) accountAvatar.src = 'assets/fallen-heaven-avatar.png';
    state.guilds = [];
    state.config = null;
    state.featureCards = [];
  }
  document.querySelectorAll('[data-restricted]').forEach(function (button) {
    button.classList.toggle('locked', !state.authenticated);
  });
  updateShellMode();
  renderWorkspacePortal();
}

async function refreshStatus(silent) {
  if (state.busy || statusPollInFlight) return;
  statusPollInFlight = true;
  try {
    const result = await api.controlBot('status');
    const active = Boolean(result.active || (result.degraded && state.botOnline));
    setStatus(active, result.output);
    if (!silent) toast(result.output || 'Status aktualisiert.');
  } catch (error) {
    if (!state.botOnline) setStatus(false, 'Botstatus wird erneut geprüft.');
    if (!silent) toast('Status konnte nicht geladen werden.', 'error');
  } finally {
    statusPollInFlight = false;
  }
}

async function controlBot(action) {
  if (state.busy) return null;
  const labels = { start: 'Bot wird gestartet ...', stop: 'Bot wird vollständig beendet ...', restart: 'Bot wird neu gestartet ...' };
  const success = { start: 'Bot wurde gestartet und ist erreichbar.', stop: 'Bot wurde vollständig gestoppt.', restart: 'Bot wurde neu gestartet und ist erreichbar.' };
  const message = document.getElementById('action-message');
  setBusy(true, action);
  if (message) { message.textContent = labels[action]; message.dataset.tone = 'info'; }
  toast(labels[action], 'info', { key: 'bot-control', replace: true, dedupeMs: 0 });
  try {
    const result = await api.controlBot(action);
    const verified = await api.controlBot('status').catch(function () { return null; });
    const active = Boolean(verified?.active && verified?.ready);
    const expectedStateReached = action === 'stop' ? !active : active;
    const ok = result?.ok !== false && expectedStateReached;
    const detail = ok ? success[action] : (result?.output || verified?.output || 'Der angeforderte Bot-Zustand wurde nicht erreicht.');
    setStatus(active, detail);
    if (ok) {
      const activityCopy = {
        start: ['Bot manuell gestartet', 'Service wurde geprüft und ist erreichbar'],
        stop: ['Bot vollständig gestoppt', 'Alle verwalteten Bot-Prozesse wurden beendet'],
        restart: ['Bot sauber neu gestartet', 'Service und Discord-Verbindung wurden erneut geprüft']
      };
      addTimelineEvent({ type: action === 'stop' ? 'offline' : 'action', title: activityCopy[action][0], detail: activityCopy[action][1] });
    }
    if (message) { message.textContent = detail; message.dataset.tone = ok ? 'success' : 'error'; }
    toast(detail, ok ? 'success' : 'error', { key: 'bot-control', replace: true, dedupeMs: 0 });
    return { ...(result || {}), ok: ok, active: active, ready: active, message: detail };
  } catch (error) {
    const detail = 'Fehler: ' + String(error.message || error);
    if (message) { message.textContent = detail; message.dataset.tone = 'error'; }
    toast(detail, 'error', { key: 'bot-control', replace: true, dedupeMs: 0 });
    await refreshStatus(true).catch(function () {});
    return { ok: false, active: state.botOnline, message: detail };
  } finally {
    setBusy(false, action);
  }
}

async function refreshAuth(options = {}) {
  const startupRestore = options.startup === true;
  try {
    const response = await api.apiRequest({ path: '/api/auth/me' });
    if (response.ok && response.data && response.data.user) {
      applyAuth(response.data.user, {
        restoring: startupRestore,
        status: 'Gespeicherte Sitzung gefunden · Discord-Daten werden geprüft'
      });
      const workspaceState = await loadWorkspaceData({ restoreMode: startupRestore, user: response.data.user });
      if (workspaceState === true) {
        applyAuth(response.data.user);
        return true;
      }
      if (workspaceState === 'pending') return 'pending';
      if (startupRestore && state.authRestoring) {
        await resetStaleDashboardSession('Gespeicherte Discord-Sitzung konnte nicht vollständig bestätigt werden. Bitte melde dich neu an.');
      }
      return false;
    }
  } catch (error) {
    console.warn('Discord-Sitzung konnte nicht gelesen werden:', error);
  }
  applyAuth(null);
  return false;
}

function handleExpiredSession(response) {
  if (Number(response?.status || 0) !== 401) return false;
  const wasAuthenticated = state.authenticated;
  applyAuth(null);
  document.body.classList.add('access-open');
  if (wasAuthenticated) {
    toast('Deine Discord-Sitzung ist abgelaufen. Bitte einmal neu anmelden.', 'error', {
      key: 'auth-expired',
      replace: true,
      dedupeMs: 5000
    });
  }
  return true;
}

// ---------------------------------------------------------------------------
// Zentraler Save-Pfad für ALLE Studio-Embeds, die über die Design-Routen
// gespeichert werden. Jede Modul-Save-Funktion ruft nur noch diesen einen
// Pfad: einheitliche Button-Sperre, Session-Handling, Timeout (mit Bild
// länger), state.config-Refresh über onSaved und Toast. „Gespeichert, aber
// nicht aktualisiert“ hat damit keinen Platz mehr: Nach erfolgreichem PUT wird
// über onSaved immer der gespeicherte Stand in die App zurückgeschrieben und
// das Studio neu geladen.
// ---------------------------------------------------------------------------
async function saveStudioDesign(settings) {
  const options = settings || {};
  const buttons = [
    document.getElementById('save-draft'),
    document.getElementById('send-studio-message'),
    document.getElementById('send-studio-message-secondary')
  ].filter(Boolean);
  buttons.forEach(function (button) { button.disabled = true; });
  try {
    const response = await api.apiRequest({
      path: options.path,
      method: 'PUT',
      body: options.body || {},
      timeoutMs: options.timeoutMs || ((options.body?.template?.outsideImageUrl || options.body?.template?.outsideImageAttachment) ? 120000 : 45000)
    });
    if (handleExpiredSession(response)) return false;
    if (!response.ok) throw new Error(response.data?.error || options.errorMessage || 'Das Embed konnte nicht gespeichert werden.');
    const result = response.data?.result || {};
    if (typeof options.onSaved === 'function') options.onSaved(result);
    const message = typeof options.okMessage === 'function' ? options.okMessage(result) : options.okMessage;
    const tone = typeof options.okType === 'function' ? options.okType(result) : (options.okType || 'success');
    toast(message || 'Design gespeichert. Live-Nachrichten werden automatisch aktualisiert.', tone);
    return true;
  } catch (error) {
    toast(String(error?.message || error), 'error');
    return false;
  } finally {
    buttons.forEach(function (button) { button.disabled = false; });
  }
}

const waitForApiRetry = (milliseconds) => new Promise(function (resolve) { setTimeout(resolve, milliseconds); });

async function apiRequestWithRetry(options, attempts) {
  const maximumAttempts = Math.max(1, Number(attempts || 4));
  let response = null;
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    response = await api.apiRequest(options);
    if (![0, 429, 502, 503, 504].includes(Number(response?.status || 0))) return response;
    if (attempt + 1 < maximumAttempts) {
      const serverDelay = Number(response?.data?.retryAfterMs || 0);
      await waitForApiRetry(Math.max(300, Math.min(1600, serverDelay || (350 * (attempt + 1)))));
    }
  }
  return response || { ok: false, status: 0, data: { error: 'App-Dienst nicht erreichbar.' } };
}

async function resetStaleDashboardSession(message) {
  resetWorkspaceRetryState();
  try {
    if (typeof api.logoutDiscord === 'function') await api.logoutDiscord();
    else await api.apiRequest({ path: '/api/auth/logout', method: 'POST' });
  } catch (error) {
    console.warn('Lokale Discord-Sitzung konnte nicht vollständig abgemeldet werden:', error);
  }
  applyAuth(null);
  state.activeView = 'center';
  document.querySelectorAll('.view').forEach(function (item) { item.classList.toggle('active', item.id === 'center-view'); });
  document.body.classList.add('access-open');
  setText('login-session-status', 'Bitte erneut mit Discord anmelden');
  toast(message || 'Die gespeicherte Discord-Sitzung wurde zurückgesetzt. Bitte melde dich erneut an.', 'error', {
    key: 'auth-reset',
    replace: true,
    dedupeMs: 0
  });
}

async function beginLogin() {
  if (state.authBusy) return;
  if (state.authenticated) {
    setView('center');
    return;
  }
  state.authBusy = true;
  document.body.classList.add('access-open');
  document.body.classList.add('auth-busy');
  setText('login-session-status', 'Discord-Anmeldung wird geöffnet');
  document.querySelectorAll('[data-login], #discord-login').forEach(function (button) {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  });
  try {
    const existingSession = await refreshAuth({ startup: false });
    if (existingSession === true) {
      setView('center');
      return;
    }
    if (existingSession === 'pending') {
      setView('center');
      toast('Du bist angemeldet. Discord-Serverdaten laden noch im Hintergrund.', 'info', {
        key: 'discord-login-pending',
        replace: true,
        dedupeMs: 0
      });
      return;
    }
    const result = await api.loginDiscord();
    if (!result || !result.ok) {
      setText('login-session-status', 'Anmeldung nicht abgeschlossen');
      toast(result && result.message ? result.message : 'Discord Anmeldung wurde nicht abgeschlossen.', 'error');
      return;
    }
    applyAuth(result.user || null);
    const workspaceState = await loadWorkspaceData();
    if (workspaceState === 'pending') {
      setView('center');
      toast('Login erfolgreich. Discord liefert die Serverdaten noch nach.', 'info', {
        key: 'discord-login-pending',
        replace: true,
        dedupeMs: 0
      });
      return;
    }
    setView('center');
    toast('Discord Account verbunden.', 'success');
  } catch (error) {
    setText('login-session-status', 'Discord ist momentan nicht erreichbar');
    toast('Discord Anmeldung fehlgeschlagen: ' + String(error?.message || error), 'error');
  } finally {
    state.authBusy = false;
    document.body.classList.remove('auth-busy');
    document.querySelectorAll('[data-login], #discord-login').forEach(function (button) {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    });
  }
}

async function logoutDiscord() {
  try {
    if (typeof api.logoutDiscord === 'function') await api.logoutDiscord();
    else await api.apiRequest({ path: '/api/auth/logout', method: 'POST' });
  } finally {
    applyAuth(null);
    state.activeView = 'center';
    document.querySelectorAll('.view').forEach(function (item) { item.classList.toggle('active', item.id === 'center-view'); });
    document.body.classList.add('access-open');
    toast('Du wurdest sicher abgemeldet.', 'success');
  }
}

async function loadWorkspaceData(options = {}) {
  if (!state.authenticated) return false;
  const restoreMode = options.restoreMode === true;
  const restoreUser = options.user || state.user;
  if (!workspaceRetryStartedAt) workspaceRetryStartedAt = Date.now();
  const results = await Promise.all([
    apiRequestWithRetry({ path: '/api/guilds', timeoutMs: 10000 }, 6),
    api.apiRequest({ path: '/api/dashboard/schema' })
  ]);
  const guildResult = results[0];
  const schemaResult = results[1];
  if (handleExpiredSession(schemaResult)) return false;
  if (!guildResult.ok) {
    if (handleExpiredSession(guildResult)) return false;
    if (isRecoverableWorkspaceStatus(guildResult.status)) {
      workspaceRetryCount += 1;
      const elapsed = Date.now() - workspaceRetryStartedAt;
      const timeoutMs = restoreMode ? WORKSPACE_RESTORE_TIMEOUT_MS : WORKSPACE_NORMAL_TIMEOUT_MS;
      if (elapsed >= timeoutMs) {
        if (restoreMode) {
          await resetStaleDashboardSession('Gespeicherte Sitzung konnte nach dem PC-Neustart nicht bestätigt werden. Bitte melde dich neu an.');
          return false;
        }
        resetWorkspaceRetryState();
        applyAuth(restoreUser || state.user);
        renderGuildPicker();
        renderWorkspacePortal();
        renderModules();
        toast('Discord-Login ist bestätigt, aber Serverdaten laden noch. Der Bot verbindet weiter im Hintergrund.', 'info', {
          key: 'discord-data-delayed',
          replace: true,
          dedupeMs: 0
        });
        return false;
      }
      const retryAfterMs = Math.max(1200, Math.min(3000, Number(guildResult.data?.retryAfterMs || 1500)));
      const message = restoreMode
        ? 'Discord-Daten werden nach dem Neustart geprüft …'
        : 'Discord-Daten verbinden sich noch. Die App versucht es automatisch erneut.';
      setText('login-session-status', message);
      setPrebootStatus(`${message} (${workspaceRetryCount})`);
      toast(message, 'info', {
        key: 'discord-data-ready',
        replace: true,
        dedupeMs: restoreMode ? 5000 : 2500
      });
      clearTimeout(workspaceRetryTimer);
      workspaceRetryTimer = setTimeout(async function () {
        workspaceRetryTimer = null;
        if (!state.authenticated) return;
        const retryState = await loadWorkspaceData({ restoreMode, user: restoreUser });
        if (retryState === true && restoreUser) {
          applyAuth(restoreUser);
          setView('center');
          toast('Discord-Sitzung und Serverdaten sind wieder verbunden.', 'success', {
            key: 'auth-restored',
            replace: true,
            dedupeMs: 5000
          });
        }
      }, retryAfterMs);
      return 'pending';
    }
    toast(guildResult.data && guildResult.data.error ? guildResult.data.error : 'Server konnten nicht geladen werden.', 'error');
    return false;
  }
  resetWorkspaceRetryState();
  state.guilds = Array.isArray(guildResult.data.guilds) ? guildResult.data.guilds : [];
  const remoteFeatureCards = schemaResult.ok ? normalizeFeatureCatalog(schemaResult.data?.featureCards) : [];
  state.featureCards = remoteFeatureCards.length ? remoteFeatureCards : [];
  renderGuildPicker();
  renderWorkspacePortal();
  if (!state.guilds.length) {
    toast('Keine verwaltbaren Server gefunden.', 'info');
    renderModules();
    return true;
  }
  const preferred = state.guilds.some(function (guild) { return guild.id === state.selectedGuildId; }) ? state.selectedGuildId : state.guilds[0].id;
  await selectGuild(preferred);
  return true;
}

function renderGuildPicker() {
  const select = document.getElementById('guild-select');
  if (!select) return;
  select.innerHTML = state.guilds.length ? state.guilds.map(function (guild) {
    const access = guild.accessRole || 'Manage Server';
    return '<option value="' + escapeHtml(guild.id) + '">' + escapeHtml(guild.name) + ' - ' + escapeHtml(access) + '</option>';
  }).join('') : '<option value="">Kein Server verfügbar</option>';
  select.value = state.selectedGuildId;
}

function guildAvatarMarkup(guild) {
  const icon = guild?.icon || guild?.iconUrl || guild?.avatar || '';
  const initial = String(guild?.name || '?').trim().slice(0, 1).toUpperCase() || '?';
  return icon
    ? '<img src="' + escapeHtml(icon) + '" alt="" loading="lazy">'
    : '<span>' + escapeHtml(initial) + '</span>';
}

function renderWorkspacePortal() {
  const portal = document.getElementById('workspace-portal');
  if (!portal) return;
  const visible = Boolean(state.authenticated && state.activeView === 'center');
  portal.hidden = !visible;
  document.body.classList.toggle('workspace-portal-visible', visible);
  if (!visible) return;

  portal.dataset.mode = state.workspaceMode || 'discord';
  setText('workspace-server-count', String(state.guilds.length || 0));
  const selectedGuild = state.guilds.find(function (guild) { return String(guild.id) === String(state.selectedGuildId); });
  setText('workspace-current-server', selectedGuild?.name || 'Kein Server');

  const guildsPanel = document.getElementById('workspace-guilds');
  const grid = document.getElementById('workspace-server-grid');
  if (guildsPanel) guildsPanel.hidden = state.workspaceMode !== 'discord';
  if (!grid) return;
  if (!state.guilds.length) {
    grid.innerHTML = '<p class="workspace-empty">Noch keine verwaltbaren Discord-Server geladen. Die App synchronisiert automatisch weiter.</p>';
    return;
  }
  grid.innerHTML = state.guilds.map(function (guild) {
    const active = String(guild.id) === String(state.selectedGuildId);
    const access = guild.accessRole || 'Verwaltbar';
    const members = Number(guild.memberCount || guild.approximateMemberCount || 0);
    return '<button type="button" class="workspace-server-card ' + (active ? 'active' : '') + '" data-workspace-guild="' + escapeHtml(guild.id) + '">' +
      '<span class="workspace-server-avatar">' + guildAvatarMarkup(guild) + '</span>' +
      '<span class="workspace-server-copy"><b>' + escapeHtml(guild.name || 'Discord Server') + '</b><small>' + escapeHtml(access) + (members ? ' · ' + members.toLocaleString('de-DE') + ' Mitglieder' : '') + '</small></span>' +
      '<em>' + (active ? 'Aktiv' : 'Öffnen') + '</em>' +
    '</button>';
  }).join('');
}

let guildSelectionLoadId = 0;

async function selectGuild(guildId) {
  if (!guildId) return;
  const selectionLoadId = ++guildSelectionLoadId;
  const guildSelect = document.getElementById('guild-select');
  const guildChanged = String(state.selectedGuildId || '') !== String(guildId);
  if (guildChanged && !(await confirmDiscardModuleChanges())) {
    if (guildSelect) guildSelect.value = state.selectedGuildId;
    return;
  }
  const response = await apiRequestWithRetry({ path: '/api/config/' + encodeURIComponent(guildId), timeoutMs: 10000 }, 5);
  if (selectionLoadId !== guildSelectionLoadId) return;
  if (!response.ok) {
    if (handleExpiredSession(response)) return;
    toast(response.data && response.data.error ? response.data.error : 'Server-Konfiguration konnte nicht geladen werden.', 'error');
    return;
  }
  state.selectedGuildId = guildId;
  state.config = normalizeModuleConfigIds(response.data.config || {});
  if (guildChanged) {
    state.selectedStudioChannelId = '';
    const studioChannelSelect = document.getElementById('studio-channel');
    if (studioChannelSelect) studioChannelSelect.value = '';
  }
  localStorage.setItem('fh-selected-guild', guildId);
  if (guildSelect) guildSelect.value = guildId;
  await loadModuleResources(guildId);
  if (selectionLoadId !== guildSelectionLoadId) return;
  renderModules();
  loadStudioMessages(guildId);
  void loadMessageEmojis(guildId).catch(function () {});
  renderDrafts();
  updatePreview();
  const guild = state.guilds.find(function (item) { return item.id === guildId; });
  if (guild) {
    // The public home view is intentionally removed by the current visual
    // system. Keep legacy status updates optional and update the persistent
    // workspace label that is present in the authenticated app shell.
    setText('home-service', state.botOnline ? guild.name + ' verbunden' : guild.name + ' bereit');
    setText('ref-active-guild', guild.name);
  }
  renderWorkspacePortal();
}

function messageEmojiRecents() {
  try {
    const value = readLocalJson('fh-message-emoji-recents', []);
    return Array.isArray(value) ? value.map(String).slice(0, 24) : [];
  } catch (_error) {
    return [];
  }
}

function rememberMessageEmoji(id) {
  const next = [String(id)].concat(messageEmojiRecents().filter(function (entry) { return entry !== String(id); })).slice(0, 24);
  localStorage.setItem('fh-message-emoji-recents', JSON.stringify(next));
}

const nativeMessageEmojis = [
  ['🪙', 'Münze'], ['✨', 'Funkeln'], ['💜', 'Lila Herz'], ['🤍', 'Weißes Herz'],
  ['🪽', 'Flügel'], ['👑', 'Krone'], ['💎', 'Diamant'], ['⭐', 'Stern'],
  ['🎉', 'Konfetti'], ['🎁', 'Geschenk'], ['🚀', 'Rakete'], ['🔥', 'Feuer'],
  ['✅', 'Bestätigt'], ['❌', 'Abgelehnt'], ['⚠️', 'Warnung'], ['ℹ️', 'Information'],
  ['📌', 'Pin'], ['📣', 'Ankündigung'], ['💬', 'Chat'], ['🎫', 'Ticket'],
  ['🛡️', 'Schild'], ['🔒', 'Schloss'], ['🔔', 'Glocke'], ['🤖', 'Bot'],
  ['❤️', 'Rotes Herz'], ['💙', 'Blaues Herz'], ['💚', 'Grünes Herz'], ['💛', 'Gelbes Herz']
].map(function (entry, index) {
  return { id: 'unicode-' + index, name: entry[1], mention: entry[0], glyph: entry[0], source: 'unicode', animated: false, available: true };
});

async function loadMessageEmojis(guildId) {
  return messageEmojiLoader.load(guildId);
}

const messageEmojiLoader = window.FHCCMessageEmojiLoader.create({
  state, apiRequest: (options) => api.apiRequest(options), nativeEmojis: nativeMessageEmojis,
  render: renderMessageEmojiPicker, selectedGuildId: () => state.selectedGuildId
});

// Emoji-Cache pro Server kurzlebig: Beim Öffnen wird nach Ablauf neu gefetcht.
const MESSAGE_EMOJI_REFRESH_TTL_MS = 30000;
const messageEmojiCacheFresh = (targetGuildId) => state.messageEmojiGuildId === targetGuildId
  && Array.isArray(state.messageEmojis) && state.messageEmojis.length > 0
  && Number(state.messageEmojiFetchedAt || 0) > 0
  && Date.now() - Number(state.messageEmojiFetchedAt) < MESSAGE_EMOJI_REFRESH_TTL_MS;

function filteredMessageEmojis() {
  const search = String(document.getElementById('studio-emoji-search')?.value || '').trim().toLocaleLowerCase('de');
  const recentIds = messageEmojiRecents();
  let emojis = state.messageEmojis.filter(function (emoji) {
    if (emoji.available === false) return false;
    if (state.messageEmojiFilter === 'application' && emoji.source !== 'application') return false;
    if (state.messageEmojiFilter === 'guild' && emoji.source !== 'guild') return false;
    if (state.messageEmojiFilter === 'unicode' && emoji.source !== 'unicode') return false;
    if (state.messageEmojiFilter === 'animated' && emoji.animated !== true) return false;
    if (state.messageEmojiFilter === 'recent' && !recentIds.includes(String(emoji.id))) return false;
    return !search || String(emoji.name || '').toLocaleLowerCase('de').includes(search);
  });
  if (state.messageEmojiFilter === 'recent') {
    emojis = emojis.sort(function (left, right) { return recentIds.indexOf(String(left.id)) - recentIds.indexOf(String(right.id)); });
  }
  return emojis;
}

function renderMessageEmojiPicker() {
  const grid = document.getElementById('studio-emoji-grid');
  const count = document.getElementById('studio-emoji-count');
  if (!grid || !count) return;
  if (state.messageEmojiLoading) {
    count.textContent = 'Wird geladen';
    grid.innerHTML = Array.from({ length: 24 }, function () { return '<span class="message-emoji-skeleton"></span>'; }).join('');
    return;
  }
  const emojis = filteredMessageEmojis();
  count.textContent = emojis.length.toLocaleString('de-DE') + ' ' + (emojis.length === 1 ? 'Emoji' : 'Emojis');
  grid.innerHTML = emojis.length ? emojis.map(function (emoji) {
    const source = emoji.source === 'application' ? 'BOT' : emoji.source === 'unicode' ? 'STANDARD' : 'SERVER';
    const preview = emoji.source === 'unicode'
      ? '<span class="message-emoji-glyph" aria-hidden="true">' + escapeHtml(emoji.glyph || emoji.mention) + '</span>'
      : '<img src="' + escapeHtml(emoji.url) + '" alt=":' + escapeHtml(emoji.name) + ':" loading="lazy">';
    return '<button class="message-emoji-item" type="button" data-message-emoji="' + escapeHtml(emoji.id) + '" title="' + escapeHtml(emoji.name) + '"><span>' + preview + '</span><b>' + (emoji.source === 'unicode' ? escapeHtml(emoji.glyph || emoji.mention) + ' ' : ':') + escapeHtml(emoji.name) + (emoji.source === 'unicode' ? '' : ':') + '</b><small>' + source + (emoji.animated ? ' · GIF' : '') + '</small></button>';
  }).join('') : '<div class="message-emoji-empty"><strong>Keine Emojis gefunden</strong><span>Prüfe den Filter oder verwende einen anderen Suchbegriff.</span></div>';
}

function openMessageEmojiPicker(target) {
  if (!state.authenticated || !state.selectedGuildId) {
    toast('Melde dich zuerst mit Discord an und wähle einen Server.', 'error');
    return;
  }
  const picker = document.getElementById('studio-emoji-picker');
  if (!picker) return;
  if (target && 'value' in target) state.messageEmojiTarget = target;
  if (!state.messageEmojiTarget || !state.messageEmojiTarget.isConnected) state.messageEmojiTarget = document.getElementById('studio-content');
  if (picker.parentElement !== document.body) document.body.appendChild(picker);
  const channelTopic = state.messageEmojiTarget?.closest?.('[data-channel-form]')?.elements?.topic === state.messageEmojiTarget;
  const reactionRoleTarget = state.messageEmojiTarget?.matches?.('[data-reaction-emoji]');
  const description = picker.querySelector('header p');
  if (description) description.textContent = reactionRoleTarget
    ? 'Wähle das Server- oder Bot-Emoji für diese Reaction Role. Die Discord-ID wird exakt übernommen.'
    : channelTopic
      ? 'Die Auswahl schreibt automatisch <:name:id> oder <a:name:id> in das Kanalthema.'
      : 'Bot- und Server-Emojis direkt in deinen Text einfügen.';
  const footerNote = picker.querySelector('footer span');
  if (footerNote) footerNote.innerHTML = reactionRoleTarget
    ? '<i></i> Ein Klick übernimmt das Emoji für die ausgewählte Rolle.'
    : '<i></i> Ein Klick fügt das Emoji an der Cursorposition ein.';  picker.hidden = false;
  document.body.classList.add('message-emoji-open');
  renderMessageEmojiPicker();
  if (!messageEmojiCacheFresh(String(state.selectedGuildId)) && !state.messageEmojiLoading) {
    state.messageEmojis = [];
    void loadMessageEmojis(state.selectedGuildId);
  }
  window.setTimeout(function () { document.getElementById('studio-emoji-search')?.focus(); }, 40);
}

window.fallenHeavenOpenEmojiPicker = function (target) {
  openMessageEmojiPicker(target);
};

function closeMessageEmojiPicker() {
  const picker = document.getElementById('studio-emoji-picker');
  if (picker) picker.hidden = true;
  document.body.classList.remove('message-emoji-open');
  if (state.messageEmojiTarget && state.messageEmojiTarget.isConnected) state.messageEmojiTarget.focus();
}

function insertMessageEmoji(id) {
  const emoji = state.messageEmojis.find(function (entry) { return String(entry.id) === String(id); });
  if (!emoji) return;
  const target = state.messageEmojiTarget && state.messageEmojiTarget.isConnected ? state.messageEmojiTarget : document.getElementById('studio-content');
  if (!target || !('value' in target)) return;
  if (target.matches('[data-reaction-emoji]')) {
    const row = target.closest('[data-reaction-role-row]');
    const rowIndex = Number(row?.dataset.reactionRoleRow);
    if (Number.isInteger(rowIndex) && state.studioReactionRoles[rowIndex]) {
      state.studioReactionRoles[rowIndex] = normalizeStudioReactionRole(Object.assign({}, state.studioReactionRoles[rowIndex], {
        emoji: emoji.mention || ('<' + (emoji.animated ? 'a' : '') + ':' + emoji.name + ':' + emoji.id + '>'),
        emojiId: String(emoji.id),
        emojiName: String(emoji.name || ''),
        animated: Boolean(emoji.animated),
        url: String(emoji.url || '')
      }));
      rememberMessageEmoji(emoji.id);
      closeMessageEmojiPicker();
      renderStudioReactionRoles();
      window.setTimeout(function () { document.querySelector('[data-pick-reaction-emoji="' + rowIndex + '"]')?.focus(); }, 0);
    }
    return;
  }
  const start = Number.isFinite(target.selectionStart) ? target.selectionStart : target.value.length;
  const end = Number.isFinite(target.selectionEnd) ? target.selectionEnd : start;
  const before = start > 0 && !/\s/.test(target.value.charAt(start - 1)) ? ' ' : '';
  const after = end < target.value.length && !/\s/.test(target.value.charAt(end)) ? ' ' : '';
  const token = before + (emoji.mention || ('<' + (emoji.animated ? 'a' : '') + ':' + emoji.name + ':' + emoji.id + '>')) + after;
  if (typeof target.setRangeText === 'function') target.setRangeText(token, start, end, 'end');
  else target.value += token;
  rememberMessageEmoji(emoji.id);
  target.dispatchEvent(new Event('input', { bubbles: true }));
  closeMessageEmojiPicker();
  renderStudioMessageEmojiPreview();
}

function renderStudioMessageEmojiPreview() {
  const host = document.getElementById('preview-content');
  const source = document.getElementById('studio-content');
  if (!host || !source) return;
  const emojiById = new Map(state.messageEmojis.map(function (emoji) { return [String(emoji.id), emoji]; }));
  const parts = String(source.value || '').split(/(<a?:[A-Za-z0-9_~]+:\d+>)/g);
  host.replaceChildren();
  parts.forEach(function (part) {
    const match = /^<a?:([A-Za-z0-9_~]+):(\d+)>$/.exec(part);
    if (match && emojiById.has(match[2])) {
      const emoji = emojiById.get(match[2]);
      const image = document.createElement('img');
      image.src = emoji.url;
      image.alt = ':' + emoji.name + ':';
      image.title = ':' + emoji.name + ':';
      image.className = 'message-inline-emoji';
      host.appendChild(image);
      return;
    }
    String(part).split('\n').forEach(function (line, index) {
      if (index) host.appendChild(document.createElement('br'));
      if (line) host.appendChild(document.createTextNode(line));
    });
  });
}

function activeCatalog() {
  const catalog = normalizeFeatureCatalog(state.featureCards);
  if (catalog.length) {
    return catalog.map(function (feature) {
      return [feature.id, feature.title, feature.description || feature.detail || 'Bot-Modul', feature.icon || 'FH', feature];
    });
  }
  return fallbackModules.map(function (entry, index) {
    const feature = normalizeFeatureCard(entry, index);
    return [feature.id, feature.title, feature.description, feature.icon || 'FH', feature];
  });
}

function moduleEnabled(id) {
  const normalized = normalizeModuleId(id);
  if (!normalized) return false;
  if (!state.config) return false;
  return getByPath(state.config, normalized + '.enabled') !== false;
}

function moduleMatchesFilters(item) {
  const query = String(state.moduleQuery || '').trim().toLocaleLowerCase('de');
  const enabled = moduleEnabled(item[0]);
  if (state.moduleFilter === 'active' && !enabled) return false;
  if (state.moduleFilter === 'inactive' && enabled) return false;
  if (!query) return true;
  return [item[0], item[1], item[2]].join(' ').toLocaleLowerCase('de').includes(query);
}

function renderModules(options) {
  const settings = options || {};
  const grid = document.getElementById('module-grid');
  if (!grid) return;
  const catalog = activeCatalog();
  const visibleCatalog = catalog.filter(moduleMatchesFilters);
  const enabledCount = state.authenticated ? catalog.filter(function (item) { return moduleEnabled(item[0]); }).length : 0;
  const allEnabled = state.authenticated && catalog.length > 0 && enabledCount === catalog.length;
  setText('module-page-enabled', enabledCount);
  setText('module-page-total', catalog.length);
  const modulePageStat = document.querySelector('.module-page-stat');
  if (modulePageStat) modulePageStat.classList.toggle('is-complete', allEnabled);
  const enableAll = document.getElementById('enable-all');
  if (enableAll) {
    enableAll.disabled = allEnabled || !state.authenticated || catalog.length === 0;
    enableAll.textContent = allEnabled ? 'Alle aktiv' : 'Alle aktivieren';
    enableAll.classList.toggle('is-complete', allEnabled);
    enableAll.setAttribute('aria-label', allEnabled ? 'Alle Module sind aktiv' : 'Alle Module aktivieren');
  }
  setText('module-result-count', visibleCatalog.length + (visibleCatalog.length === 1 ? ' Modul' : ' Module'));
  document.querySelectorAll('[data-module-filter]').forEach(function (button) {
    button.classList.toggle('active', button.dataset.moduleFilter === state.moduleFilter);
  });
  const structureSignature = JSON.stringify({
    authenticated: state.authenticated,
    filter: state.moduleFilter,
    query: String(state.moduleQuery || '').trim().toLocaleLowerCase('de'),
    modules: visibleCatalog.map(function (item) { return item.slice(0, 5); })
  });
  if (!state.authenticated) {
    if (grid.dataset.renderSignature !== structureSignature) {
      grid.innerHTML = visibleCatalog.map(function (item) {
        return '<article class="module-card locked-card"><div class="module-top"><span></span><b>' + escapeHtml(item[3]) + '</b></div><h3>' + escapeHtml(item[1]) + '</h3><p>' + escapeHtml(item[2]) + '</p><button class="module-toggle" data-login-only="true"><i></i>Discord Login erforderlich</button></article>';
      }).join('') || '<p class="module-empty">Kein passendes Modul gefunden.</p>';
      grid.dataset.renderSignature = structureSignature;
      grid.dataset.rebuildCount = String(Number(grid.dataset.rebuildCount || 0) + 1);
      window.FallenHeavenRenderMetrics = window.FallenHeavenRenderMetrics || {};
      window.FallenHeavenRenderMetrics.moduleGridRebuilds = (window.FallenHeavenRenderMetrics.moduleGridRebuilds || 0) + 1;
    }
    setText('module-count', String(catalog.length));
    setText('module-stat', '--');
    if (settings.renderConfig !== false) renderModuleConfig();
    return;
  }
  if (!catalog.length) {
    if (grid.dataset.renderSignature !== structureSignature) {
      grid.innerHTML = '<p class="empty-drafts">Keine Module vom Bot geladen.</p>';
      grid.dataset.renderSignature = structureSignature;
      grid.dataset.rebuildCount = String(Number(grid.dataset.rebuildCount || 0) + 1);
    }
    return;
  }
  if (!state.activeFeatureId || !catalog.some(function (item) { return item[0] === state.activeFeatureId; })) state.activeFeatureId = catalog[0][0];
  if (grid.dataset.renderSignature !== structureSignature) {
    grid.innerHTML = visibleCatalog.map(function (item) {
      const id = item[0];
      return '<article class="module-card" data-module="' + escapeHtml(id) + '" tabindex="0" role="button" aria-pressed="false">' +
        '<div class="module-top"><span></span><b>' + escapeHtml(item[3]) + '</b></div><h3>' + escapeHtml(item[1]) + '</h3><p>' + escapeHtml(item[2]) + '</p>' +
        '<button type="button" class="module-toggle" data-module-toggle="' + escapeHtml(id) + '"><i></i><span data-module-state></span></button></article>';
    }).join('') || '<p class="module-empty">Kein passendes Modul gefunden. Passe Suche oder Filter an.</p>';
    grid.dataset.renderSignature = structureSignature;
    grid.dataset.rebuildCount = String(Number(grid.dataset.rebuildCount || 0) + 1);
    window.FallenHeavenRenderMetrics = window.FallenHeavenRenderMetrics || {};
    window.FallenHeavenRenderMetrics.moduleGridRebuilds = (window.FallenHeavenRenderMetrics.moduleGridRebuilds || 0) + 1;
  }
  patchModuleCardStates(catalog);
  setText('module-count', String(enabledCount));
  setText('module-stat', String(enabledCount));
  if (settings.renderConfig !== false) renderModuleConfig();
}

function patchModuleCardStates(catalog) {
  const byId = new Map((catalog || activeCatalog()).map(function (item) { return [item[0], item]; }));
  document.querySelectorAll('#module-grid [data-module]').forEach(function (card) {
    const id = card.dataset.module;
    const item = byId.get(id);
    const enabled = moduleEnabled(id);
    const selected = id === state.activeFeatureId;
    card.classList.toggle('enabled', enabled);
    card.classList.toggle('selected', selected);
    card.setAttribute('aria-pressed', String(selected));
    const toggle = card.querySelector('[data-module-toggle]');
    if (!toggle) return;
    const label = enabled ? 'Aktiv' : 'Inaktiv';
    const stateLabel = toggle.querySelector('[data-module-state]');
    if (stateLabel && stateLabel.textContent !== label) stateLabel.textContent = label;
    toggle.classList.toggle('is-active', enabled);
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.dataset.state = enabled ? 'active' : 'inactive';
    toggle.setAttribute('aria-label', (item?.[1] || id) + ' ' + (enabled ? 'deaktivieren' : 'aktivieren'));
  });
}

function selectModule(id) {
  const normalizedId = normalizeModuleId(id);
  if (!normalizedId || normalizedId === state.activeFeatureId) {
    patchModuleCardStates();
    return;
  }
  const catalog = activeCatalog();
  if (!catalog.some(function (item) { return item[0] === normalizedId; })) return;
  state.activeFeatureId = normalizedId;
  patchModuleCardStates();
  renderModuleConfig({ force: true });
}

async function savePatch(patch, successMessage) {
  if (!state.authenticated || !state.selectedGuildId) {
    toast('Wähle nach dem Discord-Login zuerst einen Server.', 'error');
    return false;
  }
  let response;
  try {
    response = await api.apiRequest({
      path: '/api/config/' + encodeURIComponent(state.selectedGuildId),
      method: 'PUT',
      body: patch
    });
  } catch (error) {
    toast('Verbindung beim Speichern unterbrochen: ' + String(error?.message || error), 'error');
    return false;
  }
  if (!response.ok) {
    toast(response.data && response.data.error ? response.data.error : 'Konfiguration konnte nicht gespeichert werden.', 'error');
    return false;
  }
  state.config = response.data.config || state.config;
  state.moduleDirty = false;
  renderModules();
  toast(successMessage || 'Konfiguration gespeichert.', 'success');
  return true;
}

async function toggleModule(id) {
  if (!state.authenticated) {
    void beginLogin();
    return;
  }
  const normalizedId = normalizeModuleId(id);
  if (normalizedId === state.activeFeatureId && !(await confirmDiscardModuleChanges())) return;
  if (!normalizedId) return;
  if (!activeCatalog().some(function (item) { return item[0] === normalizedId; })) return;
  const moduleConfig = clone(state.config && state.config[normalizedId]);
  moduleConfig.enabled = !moduleEnabled(normalizedId);
  const patch = {};
  patch[normalizedId] = moduleConfig;
  await savePatch(patch, (moduleConfig.enabled ? 'Modul aktiviert.' : 'Modul deaktiviert.'));
}

let moduleResourceLoadId = 0;

async function loadModuleResources(guildId) {
  const resourceLoadId = ++moduleResourceLoadId;
  const responses = await Promise.all([
    loadStudioChannels(guildId, { fresh: true }),
    apiRequestWithRetry({ path: '/api/guild/' + encodeURIComponent(guildId) + '/config-roles', timeoutMs: 10000 }, 5)
  ]);
  const channelResponse = responses[0];
  const roleResponse = responses[1];
  if (resourceLoadId !== moduleResourceLoadId || String(state.selectedGuildId || '') !== String(guildId)) return false;
  if (handleExpiredSession(channelResponse) || handleExpiredSession(roleResponse)) return false;
  const channels = channelResponse?.ok
    ? (Array.isArray(channelResponse.channels) ? channelResponse.channels : (Array.isArray(channelResponse.data?.channels) ? channelResponse.data.channels : []))
    : [];
  state.moduleChannels = moduleChannelsFrom(channels);
  state.moduleRoles = roleResponse.ok && Array.isArray(roleResponse.data && roleResponse.data.roles) ? roleResponse.data.roles : [];
  return true;
}

const boostProgressLabels = {
  idle: 'Bereit',
  prepare: 'Abgleich wird vorbereitet',
  scan: 'Serverindex wird gelesen',
  verify: 'Systemmeldungen werden geprüft',
  complete: 'Abgleich abgeschlossen',
  error: 'Abgleich fehlgeschlagen'
};

function renderBoostProgress(status) {
  const panel = document.getElementById('boost-rebuild-progress');
  if (!panel) return;
  const value = Math.max(0, Math.min(100, Number(status?.progress || 0)));
  const phase = String(status?.phase || 'idle');
  const running = status?.running === true;
  panel.dataset.state = phase;
  panel.querySelector('[data-boost-progress-title]').textContent = boostProgressLabels[phase] || 'Boost-Abgleich';
  panel.querySelector('[data-boost-progress-value]').textContent = value + '%';
  panel.querySelector('[data-boost-progress-detail]').textContent = status?.detail || 'Warte auf den nächsten Abgleich.';
  panel.querySelector('[data-boost-progress-fill]').style.width = value + '%';
  panel.querySelector('[data-boost-progress-state]').textContent = running ? 'LIVE' : (phase === 'complete' ? 'BEREIT' : 'STATUS');
  const count = panel.querySelector('[data-boost-progress-count]');
  const total = Number(status?.total || 0);
  const completed = Number(status?.completed || 0);
  count.textContent = total > 0
    ? completed.toLocaleString('de-DE') + ' von ' + total.toLocaleString('de-DE') + ' relevanten Meldungen geprüft'
    : (completed > 0 ? completed.toLocaleString('de-DE') + ' Meldungen geprüft' : 'Keine offenen Prüfungen');
}

async function refreshBoostProgress() {
  if (!state.authenticated || !state.selectedGuildId || state.activeFeatureId !== 'boostRoles') return;
  const response = await apiRequestWithRetry({ path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/boost-role-progress', timeoutMs: 8000 }, 2);
  if (handleExpiredSession(response)) return;
  if (response.ok) renderBoostProgress(response.data?.status || {});
}

const RP_STATE_LABELS = {
  disabled: 'deaktiviert',
  connecting: 'Verbindung wird aufgebaut …',
  connected: 'verbunden',
  degraded: 'gestört – Bot online, RPC fehlgeschlagen',
  failed: 'fehlgeschlagen'
};

async function refreshRichPresenceHealth() {
  if (!state.authenticated || !state.selectedGuildId || state.activeFeatureId !== 'customRichPresence') return;
  const response = await api.apiRequest({ path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/custom-rich-presence/status', timeoutMs: 8000 });
  if (handleExpiredSession(response)) return;
  const status = response.data?.status || { state: 'disabled', enabled: false };
  const card = document.getElementById('rp-health-card');
  if (!card) return;
  card.dataset.rpState = status.state || 'disabled';
  const botEl = card.querySelector('[data-rp-bot-status]');
  const rpEl = card.querySelector('[data-rp-status]');
  const retryRow = card.querySelector('[data-rp-retry-row]');
  const retryEl = card.querySelector('[data-rp-retry]');
  const reconnectBtn = card.querySelector('#rp-reconnect-btn');
  if (botEl) botEl.textContent = state.statusOnline ? 'online' : 'offline';
  if (rpEl) rpEl.textContent = RP_STATE_LABELS[status.state] || status.state;
  if (retryRow && status.retryAt) {
    retryRow.hidden = false;
    if (retryEl) retryEl.textContent = new Date(status.retryAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  } else if (retryRow) {
    retryRow.hidden = true;
  }
  if (reconnectBtn) {
    reconnectBtn.hidden = status.state === 'disabled' || status.state === 'connected';
    reconnectBtn.onclick = async () => {
      reconnectBtn.disabled = true;
      reconnectBtn.textContent = 'Verbinde …';
      await api.apiRequest({ path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/custom-rich-presence/reconnect', method: 'POST', timeoutMs: 10000 });
      reconnectBtn.disabled = false;
      reconnectBtn.textContent = 'Neu verbinden';
      void refreshRichPresenceHealth();
    };
  }
}

async function refreshBoostTopStatus() {
  if (!state.authenticated || !state.selectedGuildId || state.activeFeatureId !== 'boostRoles') return;
  const response = await apiRequestWithRetry({ path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/boost-top', timeoutMs: 8000 }, 2);
  if (handleExpiredSession(response)) return;
  if (!response.ok) return;
  const status = response.data?.status || {};
  const container = document.querySelector('[data-boost-top-status]');
  if (!container) return;
  const top = Array.isArray(status.snapshot?.top) ? status.snapshot.top : [];
  const totalBoosts = Number(status.snapshot?.boostCount || 0);
  const holders = Array.isArray(status.panel?.holders) ? status.panel.holders : [];
  const live = Boolean(status.panel?.messageId);
  container.innerHTML = '<div class="boost-top-status-line"><span>' + (live ? 'Live-Nachricht aktiv · aktualisiert ' + escapeHtml(status.panel?.updatedAt ? new Date(status.panel.updatedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '') : 'Noch kein Embed gesendet – der Abgleich erstellt es automatisch.') + '</span><span>' + totalBoosts + ' Boosts gesamt · ' + (status.snapshot?.activeBoosterCount || 0) + ' Booster</span></div>' +

    (status.lastError ? '<p class="boost-top-status-error">' + escapeHtml(status.lastError) + '</p>' : '') +
    '<ol class="boost-top-status-list">' + (top.length
      ? top.map(function (entry, index) {
        const holder = holders.find(function (candidate) { return String(candidate.userId) === String(entry.userId); });
        const current = Number(holder?.count ?? (entry.boostCount || 0));
        return '<li><b>' + (index + 1) + '</b><span>' + escapeHtml(entry.displayName || entry.userId) + '</span><em>' + current + '×</em></li>';
      }).join('')
      : '<li class="boost-top-empty">Noch keine aktiven Booster erfasst.</li>') + '</ol>';
}

async function refreshBoostTopPanel() {
  if (!state.authenticated || !state.selectedGuildId) {
    toast('Wähle zuerst einen Server.', 'error');
    return;
  }
  const button = document.querySelector('[data-boost-top-refresh]');
  if (button) { button.disabled = true; button.textContent = 'Wird aktualisiert …'; }
  try {
    const response = await api.apiRequest({
      path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/boost-top/refresh',
      method: 'POST',
      timeoutMs: 45000
    });
    if (handleExpiredSession(response)) return;
    if (!response.ok) throw new Error(response.data?.error || 'Das Top-Booster-Panel konnte nicht aktualisiert werden.');
    toast('Top-Booster-Panel wurde aktualisiert.', 'success');
    void refreshBoostTopStatus();
  } catch (error) {
    toast(String(error?.message || error), 'error');
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Embed jetzt aktualisieren'; }
  }
}

async function refreshVipPanelsStatus() {
  if (!state.authenticated || !state.selectedGuildId || state.activeFeatureId !== 'heavenEconomy') return;
  const response = await apiRequestWithRetry({ path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/vip-panels', timeoutMs: 8000 }, 2);
  if (handleExpiredSession(response)) return;
  if (!response.ok) return;
  const status = response.data?.status || {};
  const container = document.querySelector('[data-vip-panels-status]');
  if (!container) return;
  const tiers = Array.isArray(status.tiers) ? status.tiers : [];
  const live = Boolean(status.messageId);
  container.innerHTML = '<div class="boost-top-status-line"><span>' + (live
    ? 'Live-Nachricht aktiv' + (status.channelName ? ' · #' + escapeHtml(status.channelName) : '')
    : 'Noch kein Embed gesendet – der Abgleich erstellt es automatisch.') + '</span><span>' + Number(status.memberCount || 0) + ' VIP-Mitglieder · ' + Number(status.tierCount || 0) + ' Stufen</span></div>' +
    (status.lastError ? '<p class="boost-top-status-error">' + escapeHtml(status.lastError) + '</p>' : '') +
    '<div class="vip-panels-grid">' + (tiers.length
      ? tiers.map(function (tier) {
        const count = Number(tier.memberCount || 0);
        const emojiPreview = tier.emojiId
          ? '<img class="vip-panel-tier-emoji" src="https://cdn.discordapp.com/emojis/' + encodeURIComponent(String(tier.emojiId)) + '.' + (tier.emojiAnimated ? 'gif' : 'webp') + '?size=48" alt="' + escapeHtml(String(tier.emojiName || '')) + '">'
          : escapeHtml(tier.emoji || '👑');
        return '<article><span>' + emojiPreview + ' ' + escapeHtml(tier.name || 'VIP') + '</span><b>' + count + ' Mitglieder</b><em class="' + (count > 0 ? 'live' : 'muted') + '">' + (count > 0 ? 'AKTIV' : 'LEER') + '</em></article>';
      }).join('')
      : '<p class="boost-top-empty">Noch keine VIP-Stufen konfiguriert – verbinde zuerst VIP-Rollen.</p>') + '</div>';
}

async function refreshVipPanels() {
  if (!state.authenticated || !state.selectedGuildId) {
    toast('Wähle zuerst einen Server.', 'error');
    return;
  }
  const button = document.querySelector('[data-vip-panels-refresh]');
  if (button) { button.disabled = true; button.textContent = 'Wird aktualisiert …'; }
  try {
    const response = await api.apiRequest({
      path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/vip-panels/refresh',
      method: 'POST',
      timeoutMs: 45000
    });
    if (handleExpiredSession(response)) return;
    if (!response.ok) throw new Error(response.data?.error || 'Die VIP-Panels konnten nicht aktualisiert werden.');
    toast('VIP-Panels wurden aktualisiert.', 'success');
    void refreshVipPanelsStatus();
  } catch (error) {
    toast(String(error?.message || error), 'error');
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Panels jetzt aktualisieren'; }
  }
}

async function runVipSeparatorSync(button) {
  if (!state.authenticated || !state.selectedGuildId) {
    toast('Wähle zuerst einen Server.', 'error');
    return;
  }
  const status = document.getElementById('vip-separator-status');
  const previous = button?.textContent || '';
  if (button) { button.disabled = true; button.textContent = 'Läuft …'; }
  if (status) status.textContent = '';
  try {
    const response = await api.apiRequest({
      path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/heaven-economy/separator-sync',
      method: 'POST',
      timeoutMs: 45000
    });
    if (handleExpiredSession(response)) return;
    if (!response.ok) throw new Error(response.data?.error || 'Die VIP-Trennerrolle konnte nicht abgeglichen werden.');
    const result = response.data?.result || {};
    if (result.ok === false && result.reason === 'not-configured') {
      if (status) status.textContent = 'Trennerrolle ist nicht konfiguriert – wähle unten die VIP-Trennerrolle aus.';
      toast('VIP-Trennerrolle ist nicht konfiguriert.', 'error');
      return;
    }
    const granted = Number(result.granted || 0);
    const removed = Number(result.removed || 0);
    if (status) status.textContent = '✅ ' + granted + ' vergeben · ' + removed + ' entzogen' + ((result.errors || []).length ? ' · ' + result.errors.length + ' Fehler' : '');
    toast('VIP-Trennerrolle abgeglichen: ' + granted + ' vergeben, ' + removed + ' entzogen.', 'success');
  } catch (error) {
    toast(String(error?.message || error), 'error');
  } finally {
    if (button) { button.disabled = false; button.textContent = previous || 'Jetzt abgleichen'; }
  }
}

async function confirmDiscardModuleChanges() {
  if (!state.moduleDirty) return true;
  const discard = await showAppConfirm({
    tone: 'danger',
    eyebrow: 'UNGESPEICHERTE ÄNDERUNGEN',
    title: 'Bearbeitung wirklich verlassen?',
    message: 'Für dieses Modul sind noch Änderungen offen. Wenn du fortfährst, werden ausschließlich diese ungespeicherten Eingaben verworfen.',
    note: 'Die bereits gespeicherte Modulkonfiguration und Discord-Daten bleiben unverändert.',
    cancelLabel: 'Weiter bearbeiten',
    confirmLabel: 'Änderungen verwerfen'
  });
  if (discard) state.moduleDirty = false;
  return discard;
}

function setModuleDirty(value) {
  state.moduleDirty = Boolean(value);
  const host = document.getElementById('module-config');
  const save = document.getElementById('save-module-fields');
  const discard = document.getElementById('discard-module-fields');
  const status = document.getElementById('module-save-state');
  host?.classList.toggle('has-unsaved-changes', state.moduleDirty);
  if (save) save.disabled = !state.moduleDirty || state.moduleSaving;
  if (discard) discard.hidden = !state.moduleDirty || state.moduleSaving;
  if (status) {
    status.textContent = state.moduleSaving ? 'Wird gespeichert …' : state.moduleDirty ? 'Ungespeicherte Änderungen' : 'Alle Änderungen gespeichert';
    status.dataset.state = state.moduleSaving ? 'saving' : state.moduleDirty ? 'dirty' : 'saved';
  }
}

function collectModuleConfig(host, feature) {
  if (!feature || !feature.id || !host) return clone(state.config?.[feature?.id] || {});
  const moduleConfig = clone(state.config && state.config[feature.id]);
  host.querySelectorAll('[data-setting-key]').forEach(function (field) {
    const key = String(field?.dataset?.settingKey || '').trim();
    if (!key) return;
    let value;
    if (field.dataset.settingType === 'checkbox') {
      value = field.checked;
    } else if (field.dataset.settingType === 'role-mapping') {
      const swap = String(field.dataset.mappingKind || '') === 'swap';
      value = Array.from(field.querySelectorAll('.module-role-map-row')).map(function (row) {
        if (swap) {
          const triggerId = String(row.querySelector('[data-role-trigger]').value || '').trim();
          const swapId = String(row.querySelector('[data-role-swap]').value || '').trim();
          return triggerId && swapId ? triggerId + '>' + swapId : '';
        }
        const count = Math.max(1, Number(row.querySelector('[data-role-count]').value || 1));
        const roleId = String(row.querySelector('[data-role-id]').value || '').trim();
        return roleId ? count + '=' + roleId : '';
      }).filter(Boolean).join('\n');
    } else if (field.dataset.settingType === 'role-multi') {
      value = Array.from(field.querySelectorAll('[data-role-choice]:checked')).map(function (choice) { return choice.value; }).join('\n');
    } else if (field.dataset.settingType === 'channel-multi') {
      value = Array.from(field.querySelectorAll('[data-channel-choice]:checked')).map(function (choice) { return choice.value; }).join('\n');
    } else {
      const raw = field.value;
      if (field.dataset.settingFormat === 'json') {
        try {
          value = raw.trim() ? JSON.parse(raw) : [];
          field.setCustomValidity('');
        } catch {
          value = raw;
          field.setCustomValidity('Bitte gültiges JSON eingeben.');
        }
      } else value = field.type === 'number' ? Number(raw || 0) : raw;
    }
    const shortKey = key.startsWith(feature.id + '.') ? key.slice(feature.id.length + 1) : key;
    setByPath(moduleConfig, shortKey, value);
  });
  return moduleConfig;
}

function validateModuleConfig(host, feature, moduleConfig) {
  const invalid = host.querySelector('input:invalid, textarea:invalid, select:invalid');
  if (invalid) {
    invalid.focus();
    return { ok: false, message: 'Bitte prüfe das markierte Feld.' };
  }
  if (feature.id === 'serverTagTracker') {
    const roleIds = FHCCModuleConfigInputs.settingLines(moduleConfig.roleIds?.length ? moduleConfig.roleIds : moduleConfig.roleId);
    const excludedIds = FHCCModuleConfigInputs.settingLines(moduleConfig.excludedRoleIds);
    if (moduleConfig.enabled && !roleIds.length) return { ok: false, message: 'Wähle zuerst mindestens eine Server-Tag-Rolle aus.' };
    if (roleIds.some(function (roleId) { return excludedIds.includes(roleId); })) return { ok: false, message: 'Eine Server-Tag-Rolle darf nicht gleichzeitig als ausgeschlossene Rolle gewählt sein.' };
    const selectedRoles = roleIds.map(function (roleId) { return state.moduleRoles.find(function (role) { return String(role.id) === roleId; }); });
    if (selectedRoles.some(function (role) { return !role; })) return { ok: false, message: 'Mindestens eine gespeicherte Server-Tag-Rolle existiert nicht mehr. Prüfe deine Auswahl.' };
    if (selectedRoles.some(function (role) { return role?.assignable === false; })) return { ok: false, message: 'Der Bot kann mindestens eine Server-Tag-Rolle nicht verwalten. Verschiebe die Bot-Rolle in Discord darüber.' };
    return { ok: true };
  }
  if (feature.id === 'forumCleaner') {
    const channelIds = FHCCModuleConfigInputs.settingLines(moduleConfig.channelIds);
    if (moduleConfig.enabled && !channelIds.length) return { ok: false, message: 'Wähle mindestens einen Forum- oder Media-Kanal für den Tiefenscan aus.' };
    return { ok: true };
  }
  if (feature.id === 'steamWorkshop') {
    const ids = FHCCModuleConfigInputs.settingLines(moduleConfig.workshopIds).filter(function (id) { return /^\d{6,20}$/.test(id); });
    if (moduleConfig.enabled && !String(moduleConfig.forumChannelId || '').trim()) return { ok: false, message: 'Wähle das Forum für den Workshop-Katalog aus.' };
    if (moduleConfig.enabled && !ids.length) return { ok: false, message: 'Füge mindestens eine gültige Steam-Workshop-ID hinzu.' };
    if (moduleConfig.enabled && moduleConfig.notifyOnUpdate && !String(moduleConfig.updateChannelId || '').trim()) return { ok: false, message: 'Wähle für aktive Update-Meldungen einen Textkanal aus.' };
    if (FHCCModuleConfigInputs.settingLines(moduleConfig.appliedTagNames).length > 5) return { ok: false, message: 'Discord erlaubt pro Forum-Post höchstens fünf Tags.' };
    return { ok: true };
  }
  if (feature.id === 'emojiManager') {
    const oldPrefix = String(moduleConfig.oldPrefix || '').trim();
    const newPrefix = String(moduleConfig.newPrefix || '').trim();
    if (!oldPrefix || !newPrefix) return { ok: false, message: 'Beide Emoji-Präfixe müssen ausgefüllt sein.' };
    if (oldPrefix === newPrefix) return { ok: false, message: 'Bisheriges und neues Emoji-Präfix sind identisch.' };
    if (!/^[A-Za-z0-9_]+$/.test(oldPrefix) || !/^[A-Za-z0-9_]+$/.test(newPrefix)) return { ok: false, message: 'Emoji-Präfixe dürfen nur Buchstaben, Zahlen und Unterstriche enthalten.' };
    if (!moduleConfig.includeStatic && !moduleConfig.includeAnimated) return { ok: false, message: 'Aktiviere statische oder animierte Emojis.' };
    return { ok: true };
  }
  if (feature.id === 'activityRace') {
    const placementKeys = ['daily', 'weekly', 'monthly'].flatMap(function (period) {
      return ['Chat', 'Voice'].flatMap(function (metric) {
        return [1, 2, 3].map(function (place) { return period + metric + (place === 1 ? '' : 'Top' + place); });
      });
    });
    const names = ['separatorRoleName'].concat(placementKeys.map(function (key) { return key + 'RoleName'; }));
    if (names.some(function (key) { return !String(moduleConfig[key] || '').trim(); })) return { ok: false, message: 'Alle Namen des Aktivitäts-Liga-Rollensets müssen ausgefüllt sein.' };
    const roleIds = ['separatorRoleId'].concat(placementKeys.map(function (key) { return key + 'RoleId'; }))
      .map(function (key) { return String(moduleConfig[key] || '').trim(); }).filter(Boolean);
    if (new Set(roleIds).size !== roleIds.length) return { ok: false, message: 'Jede Platzierung der Aktivitäts-Liga benötigt eine eigene Discord-Rolle.' };
    if (moduleConfig.enabled && roleIds.length !== 19) return { ok: false, message: 'Prüfe und bestätige zuerst das vollständige Rollenset für Platz 1 bis 3 inklusive Trennerrolle.' };
    const panelEmbed = moduleConfig.panelDesign?.embed || {};
    const imageEntries = [
      ['Außenbild', moduleConfig.panelDesign?.outsideImageUrl],
      ['Autor-Icon', panelEmbed.authorIconUrl],
      ['Thumbnail', panelEmbed.thumbnailUrl],
      ['Embed-Bild', panelEmbed.imageUrl],
      ['Footer-Icon', panelEmbed.footerIconUrl]
    ];
    const invalidImage = imageEntries.find(function (entry) { return String(entry[1] || '').trim() && !/^https?:\/\/[^\s]+$/i.test(String(entry[1]).trim()); });
    if (invalidImage) return { ok: false, message: invalidImage[0] + ': Bitte eine vollständige HTTP(S)-Bildadresse eintragen.' };
    if (String(panelEmbed.title || '').length > 256) return { ok: false, message: 'Der Ranglisten-Titel darf maximal 256 Zeichen enthalten.' };
    if (String(panelEmbed.description || '').length > 4096) return { ok: false, message: 'Die Ranglisten-Beschreibung darf maximal 4.096 Zeichen enthalten.' };
    return { ok: true };
  }
  if (feature.id !== 'boostRoles') return { ok: true };
  const mappings = FHCCModuleConfigInputs.parseRoleMappings(moduleConfig.tierRoleMappings);
  const counts = mappings.map(function (mapping) { return mapping.count; });
  if (new Set(counts).size !== counts.length) return { ok: false, message: 'Jede Boost-Anzahl darf nur einmal als Staffel vorkommen.' };
  const configuredIds = new Set([
    ...FHCCModuleConfigInputs.settingLines(moduleConfig.automaticRoleIds),
    ...FHCCModuleConfigInputs.settingLines(moduleConfig.removableColorRoleIds),
    ...mappings.map(function (mapping) { return mapping.roleId; })
  ]);
  const knownIds = new Set(state.moduleRoles.map(function (role) { return String(role.id); }));
  const missingIds = [...configuredIds].filter(function (id) { return !knownIds.has(id); });
  if (missingIds.length) return { ok: false, message: 'Mindestens eine gespeicherte Rolle existiert nicht mehr. Entferne den Eintrag „PRÜFEN“ oder wähle die Rolle neu.' };
  const blocked = state.moduleRoles.filter(function (role) { return role.assignable === false && configuredIds.has(String(role.id)); });
  if (blocked.length) return { ok: false, message: 'Der Bot kann folgende Rolle nicht verwalten: @' + blocked.map(function (role) { return role.name; }).join(', @') + '. Verschiebe die Bot-Rolle in Discord darüber.' };
  return { ok: true };
}

function updateRoleMultiState(container) {
  if (!container) return;
  const selected = container.querySelectorAll('[data-role-choice]:checked').length;
  const counter = container.querySelector('[data-role-selected-count]');
  if (counter) counter.textContent = selected + ' ausgewählt';
}

function updateChannelMultiState(container) {
  if (!container) return;
  const selected = container.querySelectorAll('[data-channel-choice]:checked').length;
  const counter = container.querySelector('[data-channel-selected-count]');
  if (counter) counter.textContent = selected + ' ausgewählt';
}

function formatBackupDate(value) {
  if (!value) return 'Unbekannt';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('de-DE');
}

function serverBackupOverview(config) {
  const active = config?.enabled !== false;
  const keep = Number(config?.keepBackups || 30);
  const hour = Number(config?.dailyHour || 5);
  return '<section class="server-backup-panel ' + (active ? 'ready' : 'attention') + '">' +
    '<header><span><small>SERVER-SICHERHEIT</small><strong>' + (active ? 'Tägliches Struktur-Backup aktiv' : 'Backup ist deaktiviert') + '</strong></span><div><em>OHNE CHAT-INHALTE</em><button type="button" data-server-backup-action="create">Jetzt sichern</button><button type="button" data-server-backup-action="refresh">Liste laden</button></div></header>' +
    '<div class="server-backup-summary"><article><small>ZEITPLAN</small><b>ab ' + String(hour).padStart(2, '0') + ':00 Uhr</b><p>Einmal täglich oder beim nächsten Bot-Lauf danach.</p></article><article><small>AUFBEWAHRUNG</small><b>' + keep.toLocaleString('de-DE') + ' Backups</b><p>Ältere Snapshots werden automatisch entfernt.</p></article><article><small>RESTORE</small><b>Kontrolliert</b><p>Erstellt/aktualisiert Struktur, löscht aber keine Extras blind.</p></article></div>' +
    '<div id="server-backup-list" class="server-backup-list"><p class="module-resource-empty">Backup-Liste wird geladen …</p></div>' +
    '</section>';
}

function renderServerBackupList(backups) {
  const target = document.getElementById('server-backup-list');
  if (!target) return;
  const rows = Array.isArray(backups) ? backups : [];
  if (!rows.length) {
    target.innerHTML = '<p class="module-resource-empty">Noch kein Struktur-Backup vorhanden. Erstelle eins mit „Jetzt sichern“.</p>';
    return;
  }
  target.innerHTML = rows.slice(0, 12).map(function (backup) {
    const stats = backup.stats || {};
    return '<article class="server-backup-row">' +
      '<span><small>' + escapeHtml(formatBackupDate(backup.createdAt || backup.updatedAt)) + '</small><b>' + escapeHtml(backup.guildName || 'Server-Backup') + '</b><em>' +
      escapeHtml(String(stats.channelCount || 0)) + ' Kanäle · ' + escapeHtml(String(stats.roleCount || 0)) + ' Rollen · ' +
      escapeHtml(String(stats.emojiCount || 0)) + '/' + escapeHtml(String(stats.stickerCount || 0)) + ' Emojis/Sticker</em></span>' +
      '<button type="button" data-server-backup-restore="' + escapeHtml(backup.id) + '">Vorschau & Restore</button>' +
      '</article>';
  }).join('');
}

async function refreshServerBackups() {
  if (!state.authenticated || !state.selectedGuildId || state.activeFeatureId !== 'serverBackup') return;
  const target = document.getElementById('server-backup-list');
  if (target) target.innerHTML = '<p class="module-resource-empty">Backup-Liste wird geladen …</p>';
  const response = await apiRequestWithRetry({ path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/server-backups', timeoutMs: 12000 }, 2);
  if (handleExpiredSession(response)) return;
  if (!response.ok) {
    if (target) target.innerHTML = '<p class="module-resource-empty">Backups konnten nicht geladen werden.</p>';
    toast(response.data?.error || 'Backups konnten nicht geladen werden.', 'error');
    return;
  }
  renderServerBackupList(response.data?.backups || []);
}

async function createServerBackupNow(button) {
  if (!state.selectedGuildId) return;
  if (button) button.disabled = true;
  try {
    const response = await api.apiRequest({ path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/server-backups', method: 'POST', body: {} });
    if (handleExpiredSession(response)) return;
    if (!response.ok) throw new Error(response.data?.error || 'Backup konnte nicht erstellt werden.');
    const stats = response.data?.result?.stats || {};
    toast('Server-Backup gespeichert: ' + (stats.channelCount || 0) + ' Kanäle, ' + (stats.roleCount || 0) + ' Rollen.', 'success');
    await refreshServerBackups();
  } catch (error) {
    toast(String(error?.message || error), 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

async function restoreServerBackupFromButton(button) {
  const backupId = String(button?.dataset?.serverBackupRestore || '');
  if (!backupId || !state.selectedGuildId) return;
  button.disabled = true;
  try {
    const previewResponse = await api.apiRequest({
      path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/server-backups/' + encodeURIComponent(backupId) + '/preview-restore',
      method: 'POST',
      body: {}
    });
    if (handleExpiredSession(previewResponse)) return;
    if (!previewResponse.ok) throw new Error(previewResponse.data?.error || 'Restore-Vorschau fehlgeschlagen.');
    const preview = previewResponse.data?.result || {};
    const missing = preview.missing || {};
    const accepted = await showAppConfirm({
      tone: 'warning',
      eyebrow: 'SERVER-BACKUP · RESTORE-VORSCHAU',
      title: 'Serverstruktur wiederherstellen?',
      message: 'Der Bot ergänzt die laut Backup fehlenden Serverelemente und stellt die aktivierten Einstellungen kontrolliert wieder her.',
      metrics: [
        { label: 'FEHLENDE ROLLEN', value: missing.roles || 0 },
        { label: 'FEHLENDE KANÄLE', value: missing.channels || 0 },
        { label: 'FEHLENDE EMOJIS', value: missing.emojis || 0 },
        { label: 'FEHLENDE STICKER', value: missing.stickers || 0 }
      ],
      note: 'Zusätzliche aktuelle Rollen und Kanäle werden durch diesen Restore nicht gelöscht.',
      cancelLabel: 'Restore abbrechen',
      confirmLabel: 'Backup wiederherstellen'
    });
    if (!accepted) return;
    const restoreResponse = await api.apiRequest({
      path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/server-backups/' + encodeURIComponent(backupId) + '/restore',
      method: 'POST',
      body: { confirm: true }
    });
    if (handleExpiredSession(restoreResponse)) return;
    if (!restoreResponse.ok) throw new Error(restoreResponse.data?.error || 'Restore fehlgeschlagen.');
    const result = restoreResponse.data?.result || {};
    toast('Restore abgeschlossen: ' + (result.errors?.length || 0) + ' Fehler, ' + (result.warnings?.length || 0) + ' Hinweise.', result.errors?.length ? 'error' : 'success');
    await refreshServerBackups();
  } catch (error) {
    toast(String(error?.message || error), 'error');
  } finally {
    button.disabled = false;
  }
}

function serverTagTrackerOverview(config) {
  const active = config?.enabled === true;
  const monitorOnly = config?.monitorOnly !== false;
  const selectedRoleIds = FHCCModuleConfigInputs.settingLines(config?.roleIds?.length ? config.roleIds : config?.roleId);
  const selectedRoles = selectedRoleIds.map(function (roleId) { return state.moduleRoles.find(function (role) { return String(role.id) === roleId; }); }).filter(Boolean);
  const ready = active && selectedRoleIds.length > 0 && selectedRoles.length === selectedRoleIds.length;
  return '<section id="server-tag-tracker-panel" class="server-tag-tracker-panel ' + (ready ? 'ready' : 'attention') + '" data-state="idle">' +
    '<header><span><small>SERVER-TAG AUTOMATIK · ' + selectedRoleIds.length + ' ROLLE' + (selectedRoleIds.length === 1 ? '' : 'N') + '</small><strong data-server-tag-title>' + (active ? (monitorOnly ? 'Vorschau aktiv' : 'Tracker wird geladen …') : 'Modul ist deaktiviert') + '</strong><p data-server-tag-detail>Tag an: Rolle dran. Tag aus: Rolle weg. Nur fehlende Discord-Daten bleiben unklar.</p></span><div><em data-server-tag-badge>' + (ready ? (monitorOnly ? 'VORSCHAU' : 'BEREIT') : 'KONFIGURIEREN') + '</em><button type="button" data-sync-server-tags ' + (ready ? '' : 'disabled') + '>Jetzt vollständig abgleichen</button></div></header>' +
    '<div class="server-tag-summary">' +
      '<article><small>TRÄGT UNSEREN TAG</small><b data-server-tag-wearing>–</b><p>Rolle wird synchron gehalten</p></article>' +
      '<article><small>TRÄGT IHN NICHT</small><b data-server-tag-candidates>–</b><p>Verwaltete Rolle wird entfernt</p></article>' +
      '<article><small>DISCORD-DATEN FEHLEN</small><b data-server-tag-unknown>–</b><p>Keine Rollenänderung</p></article>' +
      '<article><small>LETZTER ABGLEICH</small><b data-server-tag-last>–</b><p data-server-tag-next>Wird geladen</p></article>' +
    '</div>' +
    '<div class="server-tag-live"><div class="server-tag-progress"><i data-server-tag-progress></i></div><span data-server-tag-progress-text>Tracker-Status wird geladen …</span></div>' +
    '<div class="server-tag-lists"><section><div class="server-tag-list-head"><span><small>MITGLIEDER</small><strong>Aktueller Tag-Stand</strong></span><em data-server-tag-member-count>0</em></div><div data-server-tag-members class="server-tag-member-list"><p class="module-resource-empty">Mitglieder werden geladen …</p></div></section>' +
    '<section><div class="server-tag-list-head"><span><small>VERLAUF</small><strong>Rollenänderungen</strong></span></div><div data-server-tag-history class="server-tag-history"><p class="module-resource-empty">Noch keine Rollenänderung protokolliert.</p></div></section></div>' +
    '<p class="server-tag-safety-note"><b>Echtzeitlogik:</b> Discord-Profilereignisse werden direkt frisch gelesen. Meldet Discord deinen Server als aktiven Primary-Guild, bekommt das Mitglied die Rolle. Meldet Discord keinen passenden Primary-Guild, wird sie entfernt. Bei fehlenden API-Daten bleibt alles unverändert.</p>' +
    '</section>';
}

function serverTagChip(entry) {
  const tag = String(entry.tag || '').trim();
  if (!tag) return '';
  const image = entry.badgeUrl ? '<img src="' + escapeHtml(entry.badgeUrl) + '" alt="Server-Tag-Badge" loading="lazy">' : '';
  return '<span class="server-tag-chip" title="Echter Discord-Server-Tag: ' + escapeHtml(tag) + '">' + image + '<b>' + escapeHtml(tag) + '</b></span>';
}

function serverTagStateCopy(entry) {
  if (entry?.state === 'wearing') return { label: 'TRÄGT TAG', className: 'wearing' };
  if (entry?.state === 'not-wearing') return { label: 'TRÄGT TAG NICHT', className: 'missing' };
  return { label: 'DISCORD-DATEN FEHLEN', className: 'unknown' };
}

function renderServerTagTrackerStatus(status) {
  const panel = document.getElementById('server-tag-tracker-panel');
  if (!panel) return;
  const data = status || {};
  panel.dataset.state = data.phase || 'idle';
  const title = panel.querySelector('[data-server-tag-title]');
  const detail = panel.querySelector('[data-server-tag-detail]');
  const badge = panel.querySelector('[data-server-tag-badge]');
  if (title) title.textContent = data.running ? (data.monitorOnly ? 'Vorschau läuft' : 'Server-Tag-Abgleich läuft') : data.phase === 'failed' ? 'Abgleich benötigt Aufmerksamkeit' : data.phase === 'disabled' ? 'Modul ist deaktiviert' : data.monitorOnly ? 'Vorschau aktiv' : 'Server-Tag-Tracker bereit';
  if (detail) detail.textContent = data.lastError || data.detail || 'Bereit für den nächsten Abgleich.';
  if (badge) badge.textContent = data.running ? 'LIVE' : data.errors ? data.errors + ' FEHLER' : data.monitorOnly ? 'VORSCHAU' : 'BEREIT';
  const set = function (selector, value) { const node = panel.querySelector(selector); if (node) node.textContent = value; };
  set('[data-server-tag-wearing]', Number(data.wearing || 0).toLocaleString('de-DE'));
  set('[data-server-tag-candidates]', Number(data.notWearing || 0).toLocaleString('de-DE'));
  set('[data-server-tag-unknown]', Number(data.unknown || 0).toLocaleString('de-DE'));
  set('[data-server-tag-last]', data.lastCompletedAt ? formatBackupDate(data.lastCompletedAt) : 'Noch keiner');
  set('[data-server-tag-next]', data.nextScanAt ? 'Nächster Abgleich ' + formatBackupDate(data.nextScanAt) : 'Kein Termin geplant');
  set('[data-server-tag-progress-text]', data.running ? (data.detail || 'Abgleich läuft …') : data.monitorOnly ? ((data.previewAdds || 0) + ' würden Rollen bekommen · ' + (data.previewRemovals || 0) + ' würden Rollen verlieren · keine Rollen geändert') : ((data.roleAssigned || 0) + ' vergeben · ' + (data.roleRemoved || 0) + ' entfernt · ' + (data.deferredAssignments || 0) + ' durch Massenlimit zurückgestellt · ' + (data.errors || 0) + ' Fehler'));
  set('[data-server-tag-member-count]', Number(data.memberCount || 0).toLocaleString('de-DE'));
  const fill = panel.querySelector('[data-server-tag-progress]');
  if (fill) fill.style.width = Math.max(0, Math.min(100, Number(data.progress || 0))) + '%';

  const members = Array.isArray(data.members) ? data.members : [];
  const memberHost = panel.querySelector('[data-server-tag-members]');
  if (memberHost) {
    memberHost.innerHTML = members.length ? members.slice(0, 120).map(function (entry) {
      const stateCopy = serverTagStateCopy(entry);
      return '<article class="server-tag-member ' + stateCopy.className + '">' +
        (entry.avatarUrl ? '<img src="' + escapeHtml(entry.avatarUrl) + '" alt="">' : '<span class="server-tag-avatar">' + escapeHtml(String(entry.displayName || '?').slice(0, 1).toUpperCase()) + '</span>') +
        '<span><b>' + escapeHtml(entry.displayName || entry.username || entry.userId) + '</b><small>@' + escapeHtml(entry.username || entry.userId) + (entry.tag && entry.state !== 'wearing' ? ' · Tag ' + escapeHtml(entry.tag) : '') + '</small></span>' +
        (entry.tag && entry.state === 'wearing' ? serverTagChip(entry) : '') +
        '<em>' + stateCopy.label + '</em>' +
        '</article>';
    }).join('') : '<p class="module-resource-empty">Nach dem ersten vollständigen Abgleich erscheinen hier die Mitglieder.</p>';
  }

  const missingBadgeCount = members.filter(function (entry) { return entry.tag && !entry.badgeUrl; }).length;
  const memberSection = memberHost?.closest('section');
  if (memberSection && missingBadgeCount > 0) {
    let hint = memberSection.querySelector('[data-server-tag-badge-hint]');
    if (!hint) {
      hint = document.createElement('p');
      hint.className = 'server-tag-badge-hint';
      hint.setAttribute('data-server-tag-badge-hint', '');
      memberSection.insertBefore(hint, memberHost);
    }
    hint.textContent = missingBadgeCount === 1
      ? '1 Server-Tag-Badge wird beim nächsten vollständigen Abgleich nachgeladen. „Jetzt vollständig abgleichen“ startet ihn sofort.'
      : missingBadgeCount + ' Server-Tag-Badges werden beim nächsten vollständigen Abgleich nachgeladen. „Jetzt vollständig abgleichen“ startet ihn sofort.';
  } else if (memberSection) {
    memberSection.querySelector('[data-server-tag-badge-hint]')?.remove();
  }

  const history = Array.isArray(data.history) ? data.history : [];
  const historyHost = panel.querySelector('[data-server-tag-history]');
  if (historyHost) {
    historyHost.innerHTML = history.length ? history.slice(0, 40).map(function (entry) {
      const label = entry.action === 'role-added' ? 'Rollen vergeben' : entry.action === 'roles-updated' ? 'Rollensatz aktualisiert' : entry.action === 'role-removed' ? 'Rollen entfernt' : 'Rollenfehler';
      return '<article class="server-tag-history-row ' + escapeHtml(entry.action || '') + '"><i></i><span><b>' + escapeHtml(entry.displayName || entry.userId || 'Mitglied') + '</b><small>' + escapeHtml(label) + ' · ' + escapeHtml(formatBackupDate(entry.at)) + '</small></span></article>';
    }).join('') : '<p class="module-resource-empty">Noch keine Rollenänderung protokolliert.</p>';
  }
}

async function refreshServerTagTrackerStatus(options) {
  const settings = options || {};
  if (!state.authenticated || !state.selectedGuildId || state.activeFeatureId !== 'serverTagTracker') return;
  const response = await apiRequestWithRetry({ path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/server-tag-tracker', timeoutMs: 15000 }, 2);
  if (handleExpiredSession(response)) return;
  if (!response.ok) {
    if (!settings.silent) toast(response.data?.error || 'Server-Tag-Status konnte nicht geladen werden.', 'error');
    return;
  }
  const status = response.data?.status || {};
  renderServerTagTrackerStatus(status);
  if (serverTagRefreshTimer) clearTimeout(serverTagRefreshTimer);
  serverTagRefreshTimer = setTimeout(function () {
    void refreshServerTagTrackerStatus({ silent: true });
  }, status.running ? 1500 : 30000);
}

async function startServerTagTrackerSync(button) {
  if (!state.selectedGuildId) return;
  if (state.moduleDirty) {
    toast('Speichere zuerst deine Änderungen, bevor du den Abgleich startest.', 'info');
    return;
  }
  if (button) {
    button.disabled = true;
    button.textContent = 'Abgleich startet …';
  }
  try {
    const response = await api.apiRequest({ path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/server-tag-tracker/sync', method: 'POST', body: {} });
    if (handleExpiredSession(response)) return;
    if (!response.ok) throw new Error(response.data?.error || 'Server-Tag-Abgleich konnte nicht gestartet werden.');
    toast(response.data?.result?.queued ? 'Ein Folgeabgleich wurde vorgemerkt.' : 'Server-Tag-Abgleich wurde gestartet.', 'success');
    await refreshServerTagTrackerStatus({ silent: true });
  } catch (error) {
    toast(String(error?.message || error), 'error');
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = 'Jetzt vollständig abgleichen';
    }
  }
}

function voiceLogImportOverview(config) {
  const active = config?.enabled === true;
  const channelId = config?.channelId || '';
  return '<section class="module-overview-card voice-log-events-card">' +
    '<header><span><small>VOICE-LOG EVENTS</small><strong>' + (active ? 'Live-Events aus dem Carl-bot-Kanal' : 'Modul ist deaktiviert') + '</strong></span>' +
    '<div>' + (channelId ? '<button type="button" class="button secondary" data-voice-log-events-load>Events laden</button>' : '') + '</div></header>' +
    '<div class="voice-log-events-list" data-voice-log-events-list>' +
    (channelId ? '<p class="module-resource-empty">Klicke „Events laden", um die letzten Voice-Events anzuzeigen.</p>' : '<p class="module-resource-empty">Kein Voice-Log-Kanal konfiguriert.</p>') +
    '</div></section>';
}

async function loadVoiceLogEvents(append) {
  if (voiceLogEventsLoading || !state.selectedGuildId) return;
  const host = document.querySelector('[data-voice-log-events-list]');
  if (!host) return;
  voiceLogEventsLoading = true;
  if (!append) {
    voiceLogEventsCursor = null;
    host.innerHTML = '<p class="module-resource-empty">Events werden geladen …</p>';
  }
  try {
    let url = '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/voice-log-events?limit=30';
    if (voiceLogEventsCursor) url += '&cursor=' + encodeURIComponent(JSON.stringify(voiceLogEventsCursor));
    const response = await api.apiRequest({ path: url, timeoutMs: 12000 });
    const events = response?.events || [];
    const nextCursor = response?.cursor || null;
    const hasMore = response?.hasMore || false;
    voiceLogEventsCursor = nextCursor;
    if (!events.length && !append) {
      host.innerHTML = '<p class="module-resource-empty">Keine Voice-Events gefunden. Der Carl-bot-Kanal enthält keine erkennbaren Voice-Log-Embeds.</p>';
      voiceLogEventsLoading = false;
      return;
    }
    const typeIcons = { join: '🟢', leave: '🔴', move: '🔄' };
    const typeLabels = { join: 'Beigetreten', leave: 'Verlassen', move: 'Gewechselt' };
    const rows = events.map(function (ev) {
      const icon = typeIcons[ev.type] || '❓';
      const label = typeLabels[ev.type] || ev.type;
      const time = ev.createdAt ? new Date(ev.createdAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–';
      const detail = ev.type === 'move'
        ? escapeHtml(ev.beforeChannel || '?') + ' → ' + escapeHtml(ev.channelName || '?')
        : escapeHtml(ev.channelName || '?');
      const user = escapeHtml(ev.userName || ev.userId || 'Unbekannt');
      return '<article class="voice-log-event-row"><span class="voice-log-event-icon">' + icon + '</span><span class="voice-log-event-copy"><b>' + user + '</b><small>' + label + ' · ' + detail + '</small></span><span class="voice-log-event-time"><em>' + time + '</em></span></article>';
    }).join('');
    if (append) {
      host.insertAdjacentHTML('beforeend', rows);
    } else {
      host.innerHTML = rows;
    }
    if (hasMore) {
      host.insertAdjacentHTML('beforeend', '<div class="voice-log-events-more"><button type="button" class="button secondary" data-voice-log-events-load>Mehr Events laden</button></div>');
    }
  } catch (error) {
    if (!append) host.innerHTML = '<p class="module-resource-empty">Fehler beim Laden: ' + escapeHtml(error?.message || 'Unbekannter Fehler') + '</p>';
  }
  voiceLogEventsLoading = false;
}

function voiceChatCleanerOverview(config) {
  const active = config?.enabled === true;
  const selected = FHCCModuleConfigInputs.settingLines(config?.channelIds).length;
  const grace = Math.max(10, Number(config?.emptyGraceSeconds || 60));
  const ready = active && selected > 0;
  return '<section id="voice-chat-cleaner-panel" class="server-tag-tracker-panel voice-chat-cleaner-panel ' + (ready ? 'ready' : 'attention') + '" data-state="idle">' +
    '<header><span><small>VOICE-CHAT AUTOMATIK · ' + selected + ' CHANNEL' + (selected === 1 ? '' : 'S') + '</small><strong data-voice-cleaner-title>' + (active ? (ready ? 'Cleaner wird geladen …' : 'Voice-Channels auswählen') : 'Modul ist deaktiviert') + '</strong><p data-voice-cleaner-detail>Eine erneute Leerstandsprüfung schützt laufende Calls vor versehentlichem Löschen.</p></span><div><em data-voice-cleaner-badge>' + (ready ? (config?.dryRun ? 'PRÜFMODUS' : 'BEREIT') : 'KONFIGURIEREN') + '</em><button type="button" data-refresh-voice-cleaner>Live-Status laden</button></div></header>' +
    '<div class="server-tag-summary">' +
      '<article><small>AUSGEWÄHLT</small><b data-voice-cleaner-selected>' + selected.toLocaleString('de-DE') + '</b><p>Nur diese Voice-Chats werden berücksichtigt.</p></article>' +
      '<article><small>SICHERHEITSFRIST</small><b>' + grace.toLocaleString('de-DE') + ' Sek.</b><p>Ein erneuter Beitritt bricht sofort ab.</p></article>' +
      '<article><small>GELÖSCHT SEIT START</small><b data-voice-cleaner-total>0</b><p>Keine Inhalte werden protokolliert.</p></article>' +
      '<article><small>AKTIVER STATUS</small><b data-voice-cleaner-active>Bereit</b><p data-voice-cleaner-mode>' + (config?.dryRun ? 'Prüfmodus – keine Änderung' : 'Vollständige Bereinigung') + '</p></article>' +
    '</div>' +
    '<div class="server-tag-live"><div class="server-tag-progress"><i data-voice-cleaner-progress></i></div><span data-voice-cleaner-progress-text>Status wird geladen …</span></div>' +
    '<div class="server-tag-lists"><section><div class="server-tag-list-head"><span><small>VOICE-CHANNELS</small><strong>Bereinigungszustand</strong></span><em data-voice-cleaner-channel-count>0</em></div><div data-voice-cleaner-channels class="server-tag-member-list"><p class="module-resource-empty">Channel-Status wird geladen …</p></div></section>' +
    '<section><div class="server-tag-list-head"><span><small>VERLAUF</small><strong>Letzte Durchläufe</strong></span></div><div data-voice-cleaner-history class="server-tag-history"><p class="module-resource-empty">Noch keine Bereinigung protokolliert.</p></div></section></div>' +
    '<p class="server-tag-safety-note"><b>Vollständige Löschung:</b> Nachrichten bis 14 Tage werden gebündelt entfernt, ältere Nachrichten Discord-konform einzeln. Vor jeder Seite und jedem Löschschritt wird geprüft, ob der Call weiterhin leer ist. Pins, Dateien, Embeds und Bot-Nachrichten werden bei aktivierter Pin-Löschung mit entfernt.</p>' +
    '</section>';
}

function voiceCleanerStateCopy(entry) {
  if (entry?.state === 'cleaning') return { label: 'BEREINIGT', className: 'wearing' };
  if (entry?.state === 'waiting') return { label: 'SICHERHEITSFRIST', className: 'unknown' };
  if (entry?.state === 'error' || entry?.state === 'incomplete') return { label: 'PRÜFEN', className: 'missing' };
  if (entry?.state === 'cancelled') return { label: 'ABGEBROCHEN', className: 'unknown' };
  if (entry?.state === 'preview') return { label: 'PRÜFMODUS', className: 'unknown' };
  if (entry?.state === 'completed') return { label: 'CHAT LEER', className: 'wearing' };
  return { label: 'BEREIT', className: '' };
}

function renderVoiceChatCleanerStatus(status) {
  const panel = document.getElementById('voice-chat-cleaner-panel');
  if (!panel) return;
  const data = status || {};
  const channels = Array.isArray(data.channels) ? data.channels : [];
  const history = Array.isArray(data.history) ? data.history : [];
  panel.dataset.state = data.cleaningCount ? 'cleaning' : data.pendingCount ? 'waiting' : data.enabled ? 'ready' : 'disabled';
  const set = function (selector, value) { const node = panel.querySelector(selector); if (node) node.textContent = value; };
  set('[data-voice-cleaner-title]', !data.enabled ? 'Modul ist deaktiviert' : data.cleaningCount ? 'Voice-Chat wird bereinigt' : data.pendingCount ? 'Sicherheitsfrist läuft' : data.dryRun ? 'Sicherer Prüfmodus aktiv' : 'Voice-Chat-Cleaner bereit');
  set('[data-voice-cleaner-detail]', data.cleaningCount ? 'Discord-Nachrichten werden kontrolliert und vollständig abgearbeitet.' : data.pendingCount ? 'Ein erneuter Beitritt beendet die anstehende Löschung automatisch.' : 'Der Bot wartet auf das nächste Verlassen eines ausgewählten Calls.');
  set('[data-voice-cleaner-badge]', data.cleaningCount ? 'LIVE' : data.pendingCount ? 'WARTET' : data.dryRun ? 'PRÜFMODUS' : data.enabled ? 'BEREIT' : 'INAKTIV');
  set('[data-voice-cleaner-selected]', Number(data.selectedChannelCount || 0).toLocaleString('de-DE'));
  set('[data-voice-cleaner-total]', Number(data.totalDeleted || 0).toLocaleString('de-DE'));
  set('[data-voice-cleaner-active]', data.cleaningCount ? data.cleaningCount + ' aktiv' : data.pendingCount ? data.pendingCount + ' wartet' : 'Bereit');
  set('[data-voice-cleaner-mode]', data.dryRun ? 'Prüfmodus – keine Änderung' : data.deletePinned ? 'Alles einschließlich Pins' : 'Pins bleiben erhalten');
  set('[data-voice-cleaner-channel-count]', channels.length.toLocaleString('de-DE'));
  set('[data-voice-cleaner-progress-text]', data.cleaningCount ? 'Vollständige Historie wird verarbeitet …' : data.pendingCount ? 'Sicherheitsfrist läuft in ' + data.pendingCount + ' Channel' + (data.pendingCount === 1 ? '' : 's') + ' …' : 'Wartet auf einen vollständig verlassenen Voice-Channel.');
  const fill = panel.querySelector('[data-voice-cleaner-progress]');
  if (fill) fill.style.width = data.cleaningCount ? '72%' : data.pendingCount ? '36%' : data.enabled ? '100%' : '0%';

  const channelHost = panel.querySelector('[data-voice-cleaner-channels]');
  if (channelHost) {
    channelHost.innerHTML = channels.length ? channels.map(function (entry) {
      const stateCopy = voiceCleanerStateCopy(entry);
      const timing = entry.state === 'waiting' && entry.pendingUntil ? ' bis ' + formatBackupDate(entry.pendingUntil) : entry.lastCompletedAt ? ' · zuletzt ' + formatBackupDate(entry.lastCompletedAt) : '';
      return '<article class="server-tag-member ' + stateCopy.className + '"><span class="server-tag-avatar">VC</span><span><b>' + escapeHtml(entry.channelName || entry.channelId) + '</b><small>' + escapeHtml(entry.detail || 'Bereit') + escapeHtml(timing) + '</small></span><em>' + stateCopy.label + '</em></article>';
    }).join('') : '<p class="module-resource-empty">Noch keine ausgewählten Voice-Channels aktiv oder das Modul ist deaktiviert.</p>';
  }

  const historyHost = panel.querySelector('[data-voice-cleaner-history]');
  if (historyHost) {
    historyHost.innerHTML = history.length ? history.slice(0, 30).map(function (entry) {
      const label = entry.action === 'cleared' ? entry.deleted + ' Nachrichten gelöscht' : entry.action === 'preview' ? entry.deleted + ' Nachrichten löschbar' : entry.action === 'incomplete' ? 'Fortsetzung vorgemerkt' : 'Bereinigung fehlgeschlagen';
      return '<article class="server-tag-history-row ' + escapeHtml(entry.action || '') + '"><i></i><span><b>' + escapeHtml(entry.channelName || entry.channelId || 'Voice-Channel') + '</b><small>' + escapeHtml(label) + ' · ' + escapeHtml(formatBackupDate(entry.at)) + '</small></span></article>';
    }).join('') : '<p class="module-resource-empty">Noch keine Bereinigung protokolliert.</p>';
  }
}

async function refreshVoiceChatCleanerStatus(options) {
  const settings = options || {};
  if (!state.authenticated || !state.selectedGuildId || state.activeFeatureId !== 'voiceChatCleaner') return;
  const response = await apiRequestWithRetry({ path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/voice-chat-cleaner', timeoutMs: 12000 }, 2);
  if (handleExpiredSession(response)) return;
  if (!response.ok) {
    if (!settings.silent) toast(response.data?.error || 'Voice-Chat-Cleaner-Status konnte nicht geladen werden.', 'error');
    return;
  }
  const status = response.data?.status || {};
  renderVoiceChatCleanerStatus(status);
  if (voiceCleanerRefreshTimer) clearTimeout(voiceCleanerRefreshTimer);
  voiceCleanerRefreshTimer = setTimeout(function () {
    void refreshVoiceChatCleanerStatus({ silent: true });
  }, status.cleaningCount || status.pendingCount ? 2500 : 30000);
}

let publicCallVoteRefreshTimer = null;

async function refreshPublicCallVoteStatus(options) {
  const settings = options || {};
  if (!state.authenticated || !state.selectedGuildId || state.activeFeatureId !== 'publicCallVote') return;
  const panel = document.getElementById('public-call-vote-panel');
  const response = await apiRequestWithRetry({ path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/public-call-vote', timeoutMs: 12000 }, 2);
  if (handleExpiredSession(response)) return;
  if (!response.ok) {
    if (!settings.silent) toast(response.data?.error || 'Public-Call-Status konnte nicht geladen werden.', 'error');
    return;
  }
  const status = response.data?.status || {};
  if (panel) {
    const setText = function (selector, value) {
      const node = panel.querySelector(selector);
      if (node) node.textContent = value;
    };
    const setTitle = function (selector, value) {
      const node = panel.querySelector(selector);
      if (node) node.textContent = value;
    };
    setText('[data-pcv-panels]', String(Number(status?.panelCount || 0)));
    setText('[data-pcv-open-votes]', String(Number(status?.openVoteCount || 0)));
    setText('[data-pcv-strikes]', String(Number(status?.strikeCount || 0)));
    const badge = panel.querySelector('[data-pcv-badge]');
    if (badge) badge.textContent = Number(status?.panelCount || 0) > 0 ? 'BEREIT' : 'KONFIGURIEREN';
    const title = panel.querySelector('[data-pcv-title]');
    if (title) title.textContent = Number(status?.panelCount || 0) > 0 ? 'Moderations-Panels aktiv' : 'Öffentliche Calls auswählen';
  }
  if (publicCallVoteRefreshTimer) clearTimeout(publicCallVoteRefreshTimer);
  publicCallVoteRefreshTimer = setTimeout(function () {
    void refreshPublicCallVoteStatus({ silent: true });
  }, 30000);
}

function publicCallVoteOverview(config) {
  const active = config?.enabled === true;
  const calls2 = FHCCModuleConfigInputs.settingLines(config?.callChannelIds2).length;
  const calls3 = FHCCModuleConfigInputs.settingLines(config?.callChannelIds3).length;
  const calls4 = FHCCModuleConfigInputs.settingLines(config?.callChannelIds4).length;
  const calls = calls2 + calls3 + calls4 + FHCCModuleConfigInputs.settingLines(config?.callChannelIds).length;
  const team = Boolean(String(config?.teamChannelId || '').trim());
  const ready = active && calls > 0;
  const reasons = (Array.isArray(config?.voteReasons) ? config.voteReasons : []).length;
  return '<section id="public-call-vote-panel" class="server-tag-tracker-panel ' + (ready ? 'ready' : 'attention') + '" data-state="idle">' +
    '<header><span><small>PUBLIC-CALL-MODERATION · ' + calls + ' ÖFFENTLICHE' + (calls === 1 ? 'R CALL' : ' CALLS') + '</small><strong data-pcv-title>' + (ready ? 'Rauswurf-Abstimmungen aktiv' : active ? 'Öffentliche Calls auswählen' : 'Modul ist deaktiviert') + '</strong><p>In den ausgewählten öffentlichen Calls hängt ein dauerhaftes Moderations-Panel. Mitglieder können per Abstimmung einen Rauswurf beantragen – bei Erfolg wird das Mitglied entfernt und für die konfigurierte Dauer aus dem Call ausgeschlossen. Bei wiederholten Verstößen greift automatisch ein Server-Timeout.</p></span><div><em data-pcv-badge>' + (ready ? 'BEREIT' : 'KONFIGURIEREN') + '</em><button type="button" data-refresh-public-call-vote>Live-Status laden</button></div></header>' +
    '<div class="server-tag-summary">' +
      '<article><small>ÖFFENTLICHE CALLS</small><b>' + calls.toLocaleString('de-DE') + '</b><p>Voice-Kanäle mit dauerhaftem Moderations-Panel.</p></article>' +
      '<article><small>2ER CALLS</small><b>' + calls2.toLocaleString('de-DE') + '</b><p>Eine „Dafür“-Stimme genügt zum Rauswurf.</p></article>' +
      '<article><small>3ER CALLS</small><b>' + calls3.toLocaleString('de-DE') + '</b><p>Zwei „Dafür“-Stimmen genügen zum Rauswurf.</p></article>' +
      '<article><small>4ER CALLS</small><b>' + calls4.toLocaleString('de-DE') + '</b><p>Drei „Dafür“-Stimmen genügen zum Rauswurf.</p></article>' +
      '<article><small>VOTE-GRÜNDE</small><b>' + reasons.toLocaleString('de-DE') + '</b><p>Vorgefertigte Gründe mit Call-Sperre und Timeout-Eskalation.</p></article>' +
      '<article><small>TEAM-MELDUNG</small><b>' + (team ? 'AKTIV' : 'FEHLT') + '</b><p>' + (team ? 'Rauswürfe werden an den Team-Kanal gemeldet.' : 'Ohne Team-Kanal werden Rauswürfe nicht gemeldet.') + '</p></article>' +
      '<article><small>ZUSTIMMUNG (5+ CALLS)</small><b>' + Math.max(1, Number(config?.passPercent || 51)) + '%</b><p>Für Calls ab 5 Personen: mindestens ' + Math.max(1, Number(config?.minVotes || 3)) + ' „Dafür“-Stimme(n) und diese Zustimmung.</p></article>' +
    '</div>' +
    '<div class="server-tag-live"><div class="server-tag-progress"><i></i></div><span>Panels: <b data-pcv-panels>0</b> · Offene Abstimmungen: <b data-pcv-open-votes>0</b> · Verstöße: <b data-pcv-strikes>0</b></span></div>' +
    '<div class="pcv-design-actions"><b>Nachrichten gestalten</b>' +
      '<div class="pcv-design-group"><h5>Alle öffentlichen Calls</h5><div class="pcv-design-grid">' +
        '<button type="button" data-pcv-open-studio="panel"><span>🎙️</span>Moderations-Panel</button>' +
        '<button type="button" data-pcv-open-studio="vote"><span>🗳️</span>Laufende Abstimmung</button>' +
        '<button type="button" data-pcv-open-studio="result"><span>✅</span>Ergebnis</button>' +
        '<button type="button" data-pcv-open-studio="team"><span>🛡️</span>Team-Meldung</button>' +
        '<button type="button" data-pcv-open-studio="dm"><span>📩</span>DM an Betroffenen</button>' +
        '<button type="button" data-pcv-open-studio="release"><span>🔓</span>Freigabe-DM</button>' +
      '</div></div>' +
      '<div class="pcv-design-group"><h5>2er Calls</h5><div class="pcv-design-grid">' +
        '<button type="button" data-pcv-open-studio="panel2"><span>🎙️</span>Moderations-Panel</button>' +
        '<button type="button" data-pcv-open-studio="vote2"><span>🗳️</span>Laufende Abstimmung</button>' +
        '<button type="button" data-pcv-open-studio="result2"><span>✅</span>Ergebnis</button>' +
        '<button type="button" data-pcv-open-studio="team2"><span>🛡️</span>Team-Meldung</button>' +
        '<button type="button" data-pcv-open-studio="dm2"><span>📩</span>DM an Betroffenen</button>' +
        '<button type="button" data-pcv-open-studio="release2"><span>🔓</span>Freigabe-DM</button>' +
      '</div></div>' +
      '<div class="pcv-design-group"><h5>3er Calls</h5><div class="pcv-design-grid">' +
        '<button type="button" data-pcv-open-studio="panel3"><span>🎙️</span>Moderations-Panel</button>' +
        '<button type="button" data-pcv-open-studio="vote3"><span>🗳️</span>Laufende Abstimmung</button>' +
        '<button type="button" data-pcv-open-studio="result3"><span>✅</span>Ergebnis</button>' +
        '<button type="button" data-pcv-open-studio="team3"><span>🛡️</span>Team-Meldung</button>' +
        '<button type="button" data-pcv-open-studio="dm3"><span>📩</span>DM an Betroffenen</button>' +
        '<button type="button" data-pcv-open-studio="release3"><span>🔓</span>Freigabe-DM</button>' +
      '</div></div>' +
      '<div class="pcv-design-group"><h5>4er Calls</h5><div class="pcv-design-grid">' +
        '<button type="button" data-pcv-open-studio="panel4"><span>🎙️</span>Moderations-Panel</button>' +
        '<button type="button" data-pcv-open-studio="vote4"><span>🗳️</span>Laufende Abstimmung</button>' +
        '<button type="button" data-pcv-open-studio="result4"><span>✅</span>Ergebnis</button>' +
        '<button type="button" data-pcv-open-studio="team4"><span>🛡️</span>Team-Meldung</button>' +
        '<button type="button" data-pcv-open-studio="dm4"><span>📩</span>DM an Betroffenen</button>' +
        '<button type="button" data-pcv-open-studio="release4"><span>🔓</span>Freigabe-DM</button>' +
      '</div></div>' +
    '</div>' +
    '<p class="activity-race-safety"><b>Hinweis:</b> Das Panel ist eine feste Embed im Textchat des Calls und wird vom Voice-Chat-Cleaner nicht gelöscht. Ergebnis-Nachrichten verschwinden nach der eingestellten Zeit automatisch, Team-Meldungen pingen die Team-Rollen.</p>' +
    '<div id="public-call-vote-locks-host"></div>' +
    '</section>';
}

// Zeigt alle aktiven Call-Sperren (2er/3er/4er + übrige öffentliche Calls)
// mit Restzeit, Call-Art und Grund – und erlaubt, sie direkt aufzuheben.
function renderPublicCallVoteLocks(host, locks) {
  if (!host) return;
  const items = Array.isArray(locks) ? locks : [];
  const typeLabel = function (type) {
    if (type === '2er') return '2er';
    if (type === '3er') return '3er';
    if (type === '4er') return '4er';
    return 'öff.';
  };
  host.innerHTML = '<section class="activity-race-panel ' + (items.length ? '' : 'ready') + '" id="public-call-vote-locks-panel">' +
    '<header><div><small>FALLEN HEAVEN · PUBLIC-CALL-MODERATION</small><h3>Gesperrte Spieler (Calls)</h3><p>' + (items.length
      ? 'Diese Spieler sind aktuell aus öffentlichen Calls ausgeschlossen – der Zugriff wird automatisch freigegeben, sobald die Sperrzeit abgelaufen ist. Du kannst jede Sperre hier manuell aufheben.'
      : 'Aktuell ist niemand aus öffentlichen Calls gesperrt. Sperren entstehen automatisch nach Rauswurf-Abstimmungen und laufen nach der eingestellten Dauer ab.') + '</p></div><span data-pcv-locks-badge>' + (items.length ? items.length + ' AKTIV' : 'FREI') + '</span></header>' +
    (items.length
      ? '<div class="module-lock-list">' + items.map(function (lock) {
        const name = String(lock.name || 'Unbekannt');
        const channelPart = lock.channelName ? ' · #' + escapeHtml(String(lock.channelName)) : '';
        const reasonPart = lock.reasonLabel ? ' · ' + escapeHtml(String(lock.reasonLabel)) : '';
        return '<div class="module-lock-row">' +
          lockAvatarHtml(lock) +
          '<span class="module-lock-name">' + escapeHtml(name) + '</span>' +
          '<span class="module-lock-time"><em class="pcv-lock-type">' + typeLabel(lock.callType) + '</em>' + channelPart + reasonPart + ' · noch <b>' + formatLockRemaining(lock.remainingMs) + '</b></span>' +
          '<button type="button" data-pcv-unlock="' + encodeURIComponent(String(lock.userId || '')) + '">Sperre aufheben</button>' +
          '</div>';
      }).join('') + '</div>'
      : '<p class="boost-top-empty">Keine aktiven Call-Sperren – alles frei.</p>') +
    '</section>';
}

async function refreshPublicCallVoteLocks() {
  const host = document.getElementById('public-call-vote-locks-host');
  if (!host) return;
  if (!state.authenticated || !state.selectedGuildId) {
    host.innerHTML = '';
    return;
  }
  host.innerHTML = '<div class="module-stats-loading">Lade Sperren …</div>';
  const response = await apiRequestWithRetry({ path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/public-call-vote/locks', timeoutMs: 10000 }, 2);
  if (handleExpiredSession(response)) return;
  if (!response.ok) {
    host.innerHTML = '';
    return;
  }
  renderPublicCallVoteLocks(host, response.data?.locks || []);
}

async function unlockPublicCallVotePlayer(userId) {
  if (!userId || !state.selectedGuildId) return;
  const accepted = await showAppConfirm({
    title: 'Call-Sperre aufheben?',
    message: 'Der Spieler kann danach sofort wieder allen öffentlichen Calls beitreten. Die Sperrzeit wird nicht weitergezählt.',
    confirmLabel: 'Sperre aufheben',
    cancelLabel: 'Abbrechen',
    tone: 'danger'
  });
  if (!accepted) return;
  const response = await api.apiRequest({
    path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/public-call-vote/locks/' + encodeURIComponent(userId),
    method: 'DELETE',
    timeoutMs: 20000
  });
  if (handleExpiredSession(response)) return;
  if (!response.ok) {
    toast(response.data?.error || 'Die Call-Sperre konnte nicht aufgehoben werden.', 'error');
    return;
  }
  toast('Call-Sperre aufgehoben – der Spieler kann wieder beitreten.', 'success');
  void refreshPublicCallVoteLocks();
}

const tempVoiceUi = window.FHCCTempVoiceUI.create({
  getState: function () { return state; },
  settingLines: FHCCModuleConfigInputs.settingLines,
  apiRequestWithRetry,
  apiRequest: function (options) { return api.apiRequest(options); },
  handleExpiredSession,
  toast,
  formatDate: formatBackupDate,
  escapeHtml,
  escapeAttr,
  showConfirm: showAppConfirm,
  setView,
  refreshConfig,
  loadStudioTemplate,
  renderDrafts,
  clone,
  currentStudioTemplate,
  renderStudioLimits,
  saveStudioDesign
});
window.FHCCStudioJsonImport.create({ currentStudioTemplate, loadStudioTemplate, renderStudioLimits, renderDrafts, toast });

// Compatibility adapters for existing renderer integrations and smoke checks.
// TempVoice behavior remains implemented exclusively in temp-voice-ui.js.
function tempVoiceStudioTemplate(config) { return tempVoiceUi.studioTemplate(config); }
function openTempVoiceStudio() { return tempVoiceUi.openStudio(); }
function saveTempVoiceStudioTemplate() { return tempVoiceUi.saveStudioTemplate(); }
function confirmLeaveTempVoiceStudio() { return tempVoiceUi.confirmLeaveStudio(); }
function hasUnsavedTempVoiceStudioChanges() { return tempVoiceUi.hasUnsavedStudioChanges(); }

function forumCleanerOverview(config) {
  const active = config?.enabled === true;
  const selected = FHCCModuleConfigInputs.settingLines(config?.channelIds).length;
  const ready = active && selected > 0;
  return '<section id="forum-cleaner-panel" class="server-tag-tracker-panel forum-cleaner-panel ' + (ready ? 'ready' : 'attention') + '" data-state="idle">' +
    '<header><span><small>FOREN-TIEFENSCAN · ' + selected + ' KANAL' + (selected === 1 ? '' : 'ÄLE') + '</small><strong data-forum-cleaner-title>' + (ready ? 'Cleaner-Status wird geladen …' : active ? 'Forum-Kanäle auswählen' : 'Modul ist deaktiviert') + '</strong><p data-forum-cleaner-detail>Aktive und archivierte Posts werden vollständig paginiert. Discord-Fehler gelten niemals als Server-Austritt.</p></span><div><em data-forum-cleaner-badge>' + (config?.dryRun ? 'PRÜFMODUS' : ready ? 'BEREIT' : 'KONFIGURIEREN') + '</em><button type="button" data-forum-cleaner-scan ' + (ready ? '' : 'disabled') + '>Jetzt tief prüfen</button></div></header>' +
    '<div class="server-tag-summary">' +
      '<article><small>AUSGEWÄHLTE FOREN</small><b data-forum-cleaner-forums>' + selected.toLocaleString('de-DE') + '</b><p>Nur diese Forum- und Media-Kanäle.</p></article>' +
      '<article><small>GEFUNDENE POSTS</small><b data-forum-cleaner-discovered>0</b><p>Aktiv plus vollständiges öffentliches Archiv.</p></article>' +
      '<article><small>GEPRÜFT</small><b data-forum-cleaner-checked>0</b><p>In diesem Tiefenscan sicher bewertet.</p></article>' +
      '<article><small>GELÖSCHT</small><b data-forum-cleaner-deleted>0</b><p>Leer, Startpost gelöscht oder Ersteller verlassen.</p></article>' +
    '</div>' +
    '<div class="server-tag-live"><div class="server-tag-progress"><i data-forum-cleaner-progress></i></div><span data-forum-cleaner-progress-text>Noch kein Tiefenscan in dieser Bot-Sitzung.</span></div>' +
    '<div class="server-tag-lists"><section><div class="server-tag-list-head"><span><small>SICHERHEITSLOGIK</small><strong>Was eine Löschung auslösen darf</strong></span></div><div class="forum-cleaner-rules"><article><b>Discord bestätigt Austritt</b><p>Nur Fehlercode „Unknown Member“ gilt als verlassen.</p></article><article><b>Vollständiges Archiv</b><p>Keine feste 200-/500-Post-Grenze und keine abgeschnittenen Archivseiten.</p></article><article><b>Unbekannt bleibt geschützt</b><p>Timeouts, Rate-Limits, fehlende Rechte und Netzwerkfehler löschen nichts.</p></article></div></section>' +
    '<section><div class="server-tag-list-head"><span><small>VERLAUF</small><strong>Letzte Tiefenscans</strong></span></div><div data-forum-cleaner-history class="server-tag-history"><p class="module-resource-empty">Noch kein Tiefenscan protokolliert.</p></div></section></div>' +
    '<p class="server-tag-safety-note"><b>Automatik:</b> Neue oder geänderte Posts werden ereignisgesteuert geprüft. Nach einem Server-Austritt folgt ein zusammengefasster Tiefenscan. Der vollständige Archivscan läuft zusätzlich im eingestellten Intervall.</p>' +
    '</section>';
}

function renderForumCleanerStatus(status) {
  const panel = document.getElementById('forum-cleaner-panel');
  if (!panel) return;
  const data = status || {};
  const running = data.running === true;
  panel.dataset.state = running ? 'cleaning' : data.enabled ? 'ready' : 'disabled';
  const set = function (selector, value) { const node = panel.querySelector(selector); if (node) node.textContent = value; };
  set('[data-forum-cleaner-title]', !data.enabled ? 'Modul ist deaktiviert' : running ? 'Tiefenscan läuft' : data.completedAt ? 'Letzter Tiefenscan abgeschlossen' : 'Forum-Cleaner bereit');
  set('[data-forum-cleaner-detail]', running && data.currentForumName ? 'Aktuell: #' + data.currentForumName : data.lastError ? 'Letzter Hinweis: ' + data.lastError : 'Alle ausgewählten Foren werden ohne künstliches Post-Limit verarbeitet.');
  set('[data-forum-cleaner-badge]', running ? 'LIVE' : data.dryRun ? 'PRÜFMODUS' : data.enabled ? 'BEREIT' : 'INAKTIV');
  set('[data-forum-cleaner-forums]', Number(data.selectedForumCount || 0).toLocaleString('de-DE'));
  set('[data-forum-cleaner-discovered]', Number(data.discoveredThreads || 0).toLocaleString('de-DE'));
  set('[data-forum-cleaner-checked]', Number(data.checkedThreads || 0).toLocaleString('de-DE'));
  set('[data-forum-cleaner-deleted]', Number(data.deletedThreads || 0).toLocaleString('de-DE'));
  const progress = Number(data.selectedForumCount || 0) > 0 ? Math.min(100, Math.round((Number(data.processedForumCount || 0) / Number(data.selectedForumCount || 1)) * 100)) : 0;
  const fill = panel.querySelector('[data-forum-cleaner-progress]');
  if (fill) fill.style.width = (running ? Math.max(4, progress) : data.completedAt ? 100 : 0) + '%';
  set('[data-forum-cleaner-progress-text]', running
    ? Number(data.checkedThreads || 0).toLocaleString('de-DE') + ' Posts geprüft · ' + Number(data.deletedThreads || 0).toLocaleString('de-DE') + ' gelöscht · ' + Number(data.unknownMembers || 0).toLocaleString('de-DE') + ' unsichere Mitgliedsabfragen geschützt'
    : data.completedAt
      ? 'Abgeschlossen ' + formatBackupDate(data.completedAt) + ' · ' + Number(data.deletedDepartedAuthors || 0).toLocaleString('de-DE') + ' Beiträge ehemaliger Mitglieder entfernt'
      : 'Noch kein Tiefenscan in dieser Bot-Sitzung.');
  const historyHost = panel.querySelector('[data-forum-cleaner-history]');
  const history = Array.isArray(data.history) ? data.history : [];
  if (historyHost) {
    historyHost.innerHTML = history.length ? history.slice(0, 20).map(function (entry) {
      return '<article class="server-tag-history-row ' + (Number(entry.errors || 0) ? 'error' : 'cleared') + '"><i></i><span><b>' + Number(entry.checked || 0).toLocaleString('de-DE') + ' Posts geprüft</b><small>' + Number(entry.deleted || 0).toLocaleString('de-DE') + ' gelöscht · ' + Number(entry.departed || 0).toLocaleString('de-DE') + ' ehemalige Mitglieder · ' + Number(entry.errors || 0).toLocaleString('de-DE') + ' Hinweise · ' + escapeHtml(formatBackupDate(entry.at)) + '</small></span></article>';
    }).join('') : '<p class="module-resource-empty">Noch kein Tiefenscan protokolliert.</p>';
  }
}

async function refreshForumCleanerStatus(options) {
  const settings = options || {};
  if (!state.authenticated || !state.selectedGuildId || state.activeFeatureId !== 'forumCleaner') return;
  const response = await apiRequestWithRetry({ path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/forum-cleaner', timeoutMs: 12000 }, 2);
  if (handleExpiredSession(response)) return;
  if (!response.ok) {
    if (!settings.silent) toast(response.data?.error || 'Forum-Cleaner-Status konnte nicht geladen werden.', 'error');
    return;
  }
  const status = response.data?.status || {};
  renderForumCleanerStatus(status);
  if (forumCleanerRefreshTimer) clearTimeout(forumCleanerRefreshTimer);
  forumCleanerRefreshTimer = setTimeout(function () { void refreshForumCleanerStatus({ silent: true }); }, status.running ? 1800 : 30000);
}

async function startForumCleanerScan(button) {
  if (!state.selectedGuildId) return;
  if (state.moduleDirty) {
    toast('Speichere zuerst deine Einstellungen, bevor du den Tiefenscan startest.', 'info');
    return;
  }
  if (button) { button.disabled = true; button.textContent = 'Tiefenscan startet …'; }
  try {
    const response = await api.apiRequest({ path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/forum-cleaner/scan', method: 'POST', body: {} });
    if (handleExpiredSession(response)) return;
    if (!response.ok) throw new Error(response.data?.error || 'Forum-Tiefenscan konnte nicht gestartet werden.');
    toast(response.data?.result?.running && !response.data?.result?.queued ? 'Der Tiefenscan läuft bereits.' : 'Vollständiger Forum-Tiefenscan wurde gestartet.', 'success');
    await refreshForumCleanerStatus({ silent: true });
  } catch (error) {
    toast(String(error?.message || error), 'error');
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Jetzt tief prüfen'; }
  }
}

function steamWorkshopOverview(config) {
  const ids = FHCCModuleConfigInputs.settingLines(config?.workshopIds);
  const ready = config?.enabled === true && Boolean(config?.forumChannelId) && ids.length > 0;
  return '<section id="steam-workshop-panel" class="server-tag-tracker-panel steam-workshop-panel ' + (ready ? 'ready' : 'attention') + '" data-state="idle">' +
    '<header><span><small>STEAM WORKSHOP · FORUM-KATALOG</small><strong data-steam-workshop-title>' + (ready ? 'Katalogstatus wird geladen …' : 'Workshop-Katalog konfigurieren') + '</strong><p data-steam-workshop-detail>Eine Mod pro Forum-Post. Steam-Daten werden aktualisiert, ohne neue Beiträge zu erzeugen.</p></span><div><em data-steam-workshop-badge>' + (ready ? 'BEREIT' : 'KONFIGURIEREN') + '</em><button type="button" data-steam-workshop-studio>Embed gestalten</button><button type="button" data-steam-workshop-sync ' + (ready ? '' : 'disabled') + '>Jetzt synchronisieren</button></div></header>' +
    '<div class="server-tag-stats steam-workshop-stats">' +
      '<article><small>KONFIGURIERTE MODS</small><b data-steam-workshop-total>' + ids.length.toLocaleString('de-DE') + '</b><p>Öffentliche Workshop-IDs</p></article>' +
      '<article><small>FORUM-POSTS</small><b data-steam-workshop-posts>0</b><p>Dauerhaft verwaltete Einträge</p></article>' +
      '<article><small>LETZTER ABGLEICH</small><b data-steam-workshop-last>–</b><p>Automatisch oder manuell</p></article>' +
      '<article><small>STATUS</small><b data-steam-workshop-errors>0 Fehler</b><p>Fehler ändern keine bestehenden Posts</p></article>' +
    '</div>' +
    '<div class="server-tag-live"><div class="server-tag-progress"><i data-steam-workshop-progress></i></div><span data-steam-workshop-progress-text>Noch kein Workshop-Abgleich in dieser Sitzung.</span></div>' +
    '<div class="steam-workshop-catalog" data-steam-workshop-items><p class="module-resource-empty">Nach dem ersten Abgleich erscheinen hier alle verwalteten Workshop-Mods.</p></div>' +
    '<div class="steam-workshop-editor-note"><b>Global oder individuell.</b><span>„Embed gestalten“ bearbeitet die Standardvorlage für alle Mods. „Bearbeiten“ an einem Eintrag öffnet denselben vollständigen Editor nur für diesen Forum-Post – geschützt vor späterem Überschreiben.</span></div>' +
  '</section>';
}

function renderSteamWorkshopStatus(status) {
  const panel = document.getElementById('steam-workshop-panel');
  if (!panel) return;
  const running = status?.running === true;
  steamWorkshopStatusSnapshot = status || {};
  const items = Array.isArray(status?.items) ? status.items.filter(function (item) { return item?.configured !== false; }) : [];
  const failures = items.filter(function (item) { return Boolean(item?.lastError); }).length;
  const set = function (selector, value) { const node = panel.querySelector(selector); if (node) node.textContent = value; };
  panel.dataset.state = running ? 'syncing' : failures ? 'attention' : 'ready';
  set('[data-steam-workshop-title]', running ? 'Steam-Daten werden synchronisiert' : items.length ? 'Workshop-Katalog ist bereit' : 'Bereit für den ersten Abgleich');
  set('[data-steam-workshop-detail]', running && status.currentWorkshopId ? 'Aktuell wird Workshop-ID ' + status.currentWorkshopId + ' verarbeitet.' : failures ? failures + ' Einträge brauchen Aufmerksamkeit; bestehende Discord-Posts blieben erhalten.' : 'Forum-Posts werden an Ort und Stelle aktualisiert. Optionale Update-Meldungen erscheinen getrennt.');
  set('[data-steam-workshop-badge]', running ? 'LIVE' : failures ? 'PRÜFEN' : 'SYNCHRON');
  set('[data-steam-workshop-total]', Number(status?.total || FHCCModuleConfigInputs.settingLines(state.config?.steamWorkshop?.workshopIds).length).toLocaleString('de-DE'));
  set('[data-steam-workshop-posts]', items.filter(function (item) { return item.threadId; }).length.toLocaleString('de-DE'));
  set('[data-steam-workshop-last]', status?.lastCompletedAt ? new Date(status.lastCompletedAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–');
  set('[data-steam-workshop-errors]', failures.toLocaleString('de-DE') + ' Fehler');
  const progress = Number(status?.total || 0) > 0 ? Math.round((Number(status?.completed || 0) / Number(status.total)) * 100) : 0;
  const fill = panel.querySelector('[data-steam-workshop-progress]');
  if (fill) fill.style.width = (running ? progress : items.length ? 100 : 0) + '%';
  set('[data-steam-workshop-progress-text]', running
    ? Number(status?.completed || 0).toLocaleString('de-DE') + ' von ' + Number(status?.total || 0).toLocaleString('de-DE') + ' Mods verarbeitet'
    : items.length ? items.length.toLocaleString('de-DE') + ' Katalogeinträge · nächster Abgleich ' + (status?.nextSyncAt ? new Date(status.nextSyncAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : 'nach Zeitplan') : 'Noch kein Workshop-Abgleich durchgeführt.');
  const host = panel.querySelector('[data-steam-workshop-items]');
  if (host) host.innerHTML = items.length ? items.map(function (item) {
    const stateLabel = item.lastError ? 'FEHLER' : item.threadId ? 'SYNCHRON' : 'OFFEN';
    return '<article class="steam-workshop-item ' + (item.lastError ? 'error' : '') + ' ' + (item.customized ? 'customized' : '') + '">' +
      (item.previewUrl ? '<img src="' + escapeHtml(item.previewUrl) + '" alt="">' : '<i>STEAM</i>') +
      '<span><b>' + escapeHtml(item.title || 'Workshop ' + item.workshopId) + '</b><small>ID ' + escapeHtml(item.workshopId || '') + (item.lastSyncedAt ? ' · ' + escapeHtml(new Date(item.lastSyncedAt).toLocaleString('de-DE')) : '') + '</small>' + (item.customized ? '<mark>INDIVIDUELLES DESIGN</mark>' : '') + (item.lastError ? '<p>' + escapeHtml(item.lastError) + '</p>' : '') + '</span>' +
      '<div class="steam-workshop-item-actions"><button type="button" data-steam-workshop-edit-item="' + escapeHtml(item.workshopId || '') + '">Bearbeiten</button>' +
      (item.customized ? '<button type="button" class="reset" data-steam-workshop-reset-item="' + escapeHtml(item.workshopId || '') + '">Standard</button>' : '') +
      (item.threadId ? '<a href="https://discord.com/channels/' + escapeHtml(state.selectedGuildId) + '/' + escapeHtml(item.threadId) + '" target="_blank" rel="noreferrer">Forum öffnen</a>' : '<em>' + stateLabel + '</em>') + '</div>' +
    '</article>';
  }).join('') : '<p class="module-resource-empty">Nach dem ersten Abgleich erscheinen hier alle verwalteten Workshop-Mods.</p>';
}

async function openSteamWorkshopItemStudio(workshopId) {
  const id = String(workshopId || '').trim();
  const item = (steamWorkshopStatusSnapshot?.items || []).find(function (entry) { return String(entry.workshopId || '') === id; });
  if (!item) {
    toast('Der Workshop-Eintrag ist nicht mehr im aktuellen Katalog vorhanden.', 'error');
    await refreshSteamWorkshopStatus({ silent: true });
    return;
  }
  if (!(await setView('studio'))) return;
  await refreshConfig(state.selectedGuildId);
  state.activeStudioMessageId = '';
  state.studioSourceMessage = null;
  loadStudioTemplate(steamWorkshopStudioTemplate(state.config?.steamWorkshop, item));
  renderDrafts();
  toast('Du bearbeitest nur „' + String(item.title || 'Workshop ' + id) + '“. Die globale Vorlage bleibt unverändert.', 'success');
}

async function resetSteamWorkshopItemFromPanel(workshopId, button) {
  const id = String(workshopId || '').trim();
  const item = (steamWorkshopStatusSnapshot?.items || []).find(function (entry) { return String(entry.workshopId || '') === id; });
  if (!item) return;
  const accepted = await showAppConfirm({
    tone: 'warning',
    eyebrow: 'STEAM WORKSHOP · EINZELPOST',
    title: 'Standardvorlage wiederherstellen?',
    message: 'Nur das individuelle Design dieses Workshop-Posts wird entfernt. Steam-Daten, Forum-Post und globale Vorlage bleiben erhalten.',
    note: 'Ein individuell hochgeladenes Bild dieses Posts wird ebenfalls entfernt.',
    confirmLabel: 'Standard verwenden',
    cancelLabel: 'Behalten',
    metrics: [{ label: 'WORKSHOP', value: item.title || id }, { label: 'ID', value: id }]
  });
  if (!accepted) return;
  if (button) { button.disabled = true; button.textContent = 'Setze zurück …'; }
  try {
    const response = await api.apiRequest({
      path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/steam-workshop/items/' + encodeURIComponent(id) + '/design',
      method: 'DELETE',
      body: {},
      timeoutMs: 60000
    });
    if (handleExpiredSession(response)) return;
    if (!response.ok) throw new Error(response.data?.error || 'Der Einzelpost konnte nicht zurückgesetzt werden.');
    toast('Der Workshop-Post verwendet wieder die globale Standardvorlage.', 'success');
    await refreshSteamWorkshopStatus({ silent: true });
  } catch (error) {
    toast(String(error?.message || error), 'error');
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Standard'; }
  }
}

async function refreshSteamWorkshopStatus(options) {
  const settings = options || {};
  if (!state.authenticated || !state.selectedGuildId || state.activeFeatureId !== 'steamWorkshop') return;
  const response = await apiRequestWithRetry({ path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/steam-workshop', timeoutMs: 12000 }, 2);
  if (handleExpiredSession(response)) return;
  if (response.ok) renderSteamWorkshopStatus(response.data?.status || {});
  else if (!settings.silent) toast(response.data?.error || 'Workshop-Status konnte nicht geladen werden.', 'error');
  clearTimeout(steamWorkshopRefreshTimer);
  steamWorkshopRefreshTimer = setTimeout(function () { void refreshSteamWorkshopStatus({ silent: true }); }, response.data?.status?.running ? 1800 : 30000);
}

async function syncSteamWorkshopFromPanel(button) {
  if (state.moduleDirty) {
    toast('Speichere zuerst deine Workshop-Einstellungen.', 'info');
    return;
  }
  if (button) { button.disabled = true; button.textContent = 'Synchronisiere …'; }
  try {
    const response = await api.apiRequest({ path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/steam-workshop/sync', method: 'POST', body: {}, timeoutMs: 180000 });
    if (handleExpiredSession(response)) return;
    if (!response.ok) throw new Error(response.data?.error || 'Workshop-Abgleich fehlgeschlagen.');
    const result = response.data?.result || {};
    toast('Workshop-Katalog aktualisiert: ' + Number(result.created || 0) + ' neu, ' + Number(result.updated || 0) + ' aktualisiert, ' + Number(result.failed || 0) + ' Fehler.', result.failed ? 'info' : 'success');
    await refreshSteamWorkshopStatus({ silent: true });
  } catch (error) {
    toast(String(error?.message || error), 'error');
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Jetzt synchronisieren'; }
  }
}

function emojiManagerOverview(config) {
  const active = config?.enabled !== false;
  const oldPrefix = String(config?.oldPrefix || 'vl_');
  const newPrefix = String(config?.newPrefix || 'fh_');
  return '<section id="emoji-manager-panel" class="server-tag-tracker-panel emoji-manager-panel ' + (active ? 'ready' : 'attention') + '">' +
    '<header><span><small>SERVER-EMOJI OPERATIONS</small><strong>Kontrollierte Präfix-Umbenennung</strong><p>Emoji-ID, Bilddatei, Animation und Verfügbarkeit bleiben erhalten. Keine Änderung läuft ohne frische Vorschau und Bestätigung.</p></span><div><em data-emoji-manager-badge>VORSCHAU NÖTIG</em><button type="button" data-emoji-preview-action>Änderungen prüfen</button><button type="button" data-emoji-apply-action disabled>Bestätigt umbenennen</button></div></header>' +
    '<div class="server-tag-summary">' +
      '<article><small>REGEL</small><b data-emoji-prefix-rule>' + escapeHtml(oldPrefix) + ' → ' + escapeHtml(newPrefix) + '</b><p>Nur der Namensanfang wird ersetzt.</p></article>' +
      '<article><small>GEFUNDEN</small><b data-emoji-matched>–</b><p>Statisch und animiert getrennt geprüft.</p></article>' +
      '<article><small>BLOCKIERT</small><b data-emoji-blocked>–</b><p>Kollisionen und ungültige Zielnamen.</p></article>' +
      '<article><small>BOT-RECHT</small><b data-emoji-permission>Wird geprüft</b><p>Server-Ausdrücke verwalten.</p></article>' +
    '</div>' +
    '<div class="emoji-manager-preview" data-emoji-preview-list><p class="module-resource-empty">Klicke auf „Änderungen prüfen“. Bis dahin wird kein Emoji verändert.</p></div>' +
    '<div class="server-tag-lists emoji-manager-history-wrap"><section><div class="server-tag-list-head"><span><small>ÄNDERUNGSVERLAUF</small><strong>Bestätigte Vorgänge</strong></span></div><div data-emoji-manager-history class="server-tag-history"><p class="module-resource-empty">Noch keine bestätigte Umbenennung protokolliert.</p></div></section></div>' +
    '<p class="server-tag-safety-note"><b>Sicherheitsstufe:</b> Vor dem Anwenden wird die Serverliste erneut von Discord geladen. Wenn sich nur ein Name geändert hat, verfällt die Vorschau automatisch. Jeder bestätigte Lauf erhält ein lokales Rollback-Protokoll.</p>' +
    '</section>';
}

function renderEmojiManagerPreview(preview) {
  const panel = document.getElementById('emoji-manager-panel');
  if (!panel) return;
  emojiManagerPreview = preview || null;
  const data = preview || {};
  const set = function (selector, value) { const node = panel.querySelector(selector); if (node) node.textContent = value; };
  set('[data-emoji-prefix-rule]', String(data.oldPrefix || '–') + ' → ' + String(data.newPrefix || '–'));
  set('[data-emoji-matched]', Number(data.matchedCount || 0).toLocaleString('de-DE'));
  set('[data-emoji-blocked]', Number(data.blockedCount || 0).toLocaleString('de-DE'));
  set('[data-emoji-permission]', data.canManageExpressions ? 'Vorhanden' : 'Fehlt');
  set('[data-emoji-manager-badge]', data.safeToApply ? 'BEREIT ZUR BESTÄTIGUNG' : Number(data.blockedCount || 0) ? 'KONFLIKTE PRÜFEN' : 'NICHTS ZU ÄNDERN');
  const apply = panel.querySelector('[data-emoji-apply-action]');
  if (apply) apply.disabled = !data.safeToApply;
  const target = panel.querySelector('[data-emoji-preview-list]');
  const rows = Array.isArray(data.changes) ? data.changes : [];
  if (!target) return;
  target.innerHTML = rows.length ? rows.map(function (row) {
    const problems = Array.isArray(row.blockingReasons) ? row.blockingReasons : [];
    const warnings = Array.isArray(row.warnings) ? row.warnings : [];
    return '<article class="emoji-rename-row ' + (row.valid ? 'valid' : 'blocked') + '">' +
      '<img src="' + escapeHtml(row.url || '') + '" alt="">' +
      '<span><small>' + (row.animated ? 'ANIMIERT' : 'STATISCH') + '</small><b><code>:' + escapeHtml(row.currentName) + ':</code><i>→</i><code>:' + escapeHtml(row.targetName) + ':</code></b>' +
      (problems.length ? '<p>' + escapeHtml(problems.join(' · ')) + '</p>' : warnings.length ? '<p>' + escapeHtml(warnings.join(' · ')) + '</p>' : '<p>ID und Bild bleiben unverändert.</p>') + '</span><em>' + (row.valid ? warnings.length ? 'HINWEIS' : 'BEREIT' : 'BLOCKIERT') + '</em></article>';
  }).join('') : '<p class="module-resource-empty">Keine Emojis mit dem Präfix <code>' + escapeHtml(data.oldPrefix || '') + '</code> gefunden.</p>';
}

function renderEmojiManagerHistory(status) {
  const panel = document.getElementById('emoji-manager-panel');
  const target = panel?.querySelector('[data-emoji-manager-history]');
  if (!target) return;
  const history = Array.isArray(status?.history) ? status.history : [];
  target.innerHTML = history.length ? history.slice(0, 20).map(function (entry) {
    return '<article class="server-tag-history-row ' + (Number(entry.failed || 0) ? 'error' : 'cleared') + '"><i></i><span><b>' + escapeHtml(entry.oldPrefix || '') + ' → ' + escapeHtml(entry.newPrefix || '') + '</b><small>' + Number(entry.renamed || 0).toLocaleString('de-DE') + ' umbenannt · ' + Number(entry.failed || 0).toLocaleString('de-DE') + ' fehlgeschlagen · ' + escapeHtml(formatBackupDate(entry.completedAt)) + '</small></span></article>';
  }).join('') : '<p class="module-resource-empty">Noch keine bestätigte Umbenennung protokolliert.</p>';
}

async function refreshEmojiManagerStatus(options) {
  const settings = options || {};
  if (!state.authenticated || !state.selectedGuildId || state.activeFeatureId !== 'emojiManager') return;
  const response = await apiRequestWithRetry({ path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/emoji-manager', timeoutMs: 12000 }, 2);
  if (handleExpiredSession(response)) return;
  if (!response.ok) {
    if (!settings.silent) toast(response.data?.error || 'Emoji-Status konnte nicht geladen werden.', 'error');
    return;
  }
  renderEmojiManagerHistory(response.data?.status || {});
  if (emojiManagerRefreshTimer) clearTimeout(emojiManagerRefreshTimer);
  emojiManagerRefreshTimer = setTimeout(function () { void refreshEmojiManagerStatus({ silent: true }); }, response.data?.status?.running ? 1800 : 30000);
}

function collectEmojiPreviewSettings() {
  const host = document.getElementById('module-config');
  const feature = getNormalizedFeatureById('emojiManager');
  if (!host || !feature) return clone(state.config?.emojiManager || {});
  return collectModuleConfig(host, feature);
}

async function previewEmojiRenameFromPanel(button) {
  if (!state.selectedGuildId) return;
  if (button) { button.disabled = true; button.textContent = 'Discord wird geprüft …'; }
  try {
    const settings = collectEmojiPreviewSettings();
    const response = await api.apiRequest({ path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/emoji-manager/preview', method: 'POST', body: settings });
    if (handleExpiredSession(response)) return;
    if (!response.ok) throw new Error(response.data?.error || 'Emoji-Vorschau konnte nicht erstellt werden.');
    renderEmojiManagerPreview(response.data?.preview || {});
    toast('Emoji-Vorschau geladen. Es wurde noch nichts verändert.', 'success');
  } catch (error) {
    emojiManagerPreview = null;
    toast(String(error?.message || error), 'error');
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Änderungen prüfen'; }
  }
}

function showEmojiRenameConfirmation(preview) {
  const dialog = document.getElementById('emoji-rename-confirm-dialog');
  if (!dialog || typeof dialog.showModal !== 'function') {
    toast('Das Bestätigungsfenster konnte nicht geöffnet werden. Es wurde nichts verändert.', 'error');
    return Promise.resolve(false);
  }

  const setText = function (selector, value) {
    const node = dialog.querySelector(selector);
    if (node) node.textContent = String(value ?? '');
  };
  const count = Number(preview.matchedCount || 0);
  const changes = Array.isArray(preview.changes) ? preview.changes.filter(function (entry) { return entry?.valid !== false; }) : [];
  const visibleChanges = changes.slice(0, 12);
  setText('[data-emoji-confirm-count]', count.toLocaleString('de-DE'));
  setText('[data-emoji-confirm-title]', count === 1 ? 'Einen Emoji-Namen ändern?' : count.toLocaleString('de-DE') + ' Emoji-Namen ändern?');
  setText('[data-emoji-confirm-prefix]', String(preview.oldPrefix || '') + '  →  ' + String(preview.newPrefix || ''));
  setText('[data-emoji-confirm-static]', Number(preview.staticCount || 0).toLocaleString('de-DE'));
  setText('[data-emoji-confirm-animated]', Number(preview.animatedCount || 0).toLocaleString('de-DE'));
  setText('[data-emoji-confirm-submit-label]', count === 1 ? 'Emoji umbenennen' : count.toLocaleString('de-DE') + ' Emojis umbenennen');

  const list = dialog.querySelector('[data-emoji-confirm-list]');
  if (list) {
    list.innerHTML = visibleChanges.map(function (entry) {
      return '<article class="emoji-confirm-row">' +
        '<img src="' + escapeHtml(entry.url || '') + '" alt="">' +
        '<span><small>' + (entry.animated ? 'ANIMIERT' : 'STATISCH') + '</small><b><code>:' + escapeHtml(entry.currentName || '') + ':</code><i>→</i><code>:' + escapeHtml(entry.targetName || '') + ':</code></b></span>' +
        '<em>ID BLEIBT</em></article>';
    }).join('') + (changes.length > visibleChanges.length ? '<p class="emoji-confirm-more">+' + (changes.length - visibleChanges.length).toLocaleString('de-DE') + ' weitere geprüfte Emojis</p>' : '');
  }

  if (dialog.open) dialog.close('cancel');
  dialog.returnValue = 'cancel';
  return new Promise(function (resolve) {
    const handleClose = function () {
      dialog.removeEventListener('cancel', handleCancel);
      dialog.removeEventListener('click', handleBackdropClick);
      resolve(dialog.returnValue === 'confirm');
    };
    const handleCancel = function (event) {
      event.preventDefault();
      dialog.close('cancel');
    };
    const handleBackdropClick = function (event) {
      if (event.target === dialog) dialog.close('cancel');
    };
    dialog.addEventListener('close', handleClose, { once: true });
    dialog.addEventListener('cancel', handleCancel);
    dialog.addEventListener('click', handleBackdropClick);
    dialog.showModal();
  });
}

async function applyEmojiRenameFromPanel(button) {
  const preview = emojiManagerPreview;
  if (!preview?.safeToApply || !preview.previewToken) {
    toast('Erstelle zuerst eine fehlerfreie, aktuelle Vorschau.', 'info');
    return;
  }
  const accepted = await showEmojiRenameConfirmation(preview);
  if (!accepted) return;
  if (button) { button.disabled = true; button.textContent = 'Wird umbenannt …'; }
  try {
    const response = await api.apiRequest({
      path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/emoji-manager/apply',
      method: 'POST',
      body: {
        confirm: true,
        previewToken: preview.previewToken,
        oldPrefix: preview.oldPrefix,
        newPrefix: preview.newPrefix,
        includeStatic: preview.includeStatic,
        includeAnimated: preview.includeAnimated
      }
    });
    if (handleExpiredSession(response)) return;
    if (!response.ok) throw new Error(response.data?.error || 'Emoji-Umbenennung fehlgeschlagen.');
    const result = response.data?.result || {};
    toast(Number(result.renamed || 0) + ' Emojis wurden umbenannt' + (Number(result.failed || 0) ? ', ' + result.failed + ' fehlgeschlagen.' : '.'), Number(result.failed || 0) ? 'info' : 'success');
    emojiManagerPreview = null;
    await refreshEmojiManagerStatus({ silent: true });
    await previewEmojiRenameFromPanel(null);
  } catch (error) {
    toast(String(error?.message || error), 'error');
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Bestätigt umbenennen'; }
  }
}

function activityRaceOverview(config) {
  return window.FHCCActivityRaceStudio.overview(config, { escapeHtml, rankingQuery: activityRaceRankingQuery });
}

function formatActivityRaceRankingValue(value, metric) {
  const numeric = Math.max(0, Number(value || 0));
  if (metric === 'voice') {
    const minutes = Math.floor(numeric / 60000);
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return hours ? hours + ' Std. ' + rest + ' Min.' : minutes + ' Min.';
  }
  return numeric.toLocaleString('de-DE') + (numeric === 1 ? ' Nachricht' : ' Nachrichten');
}

function renderActivityRaceFullRanking() {
  const panel = document.getElementById('activity-race-panel');
  if (!panel) return;
  panel.querySelectorAll('[data-activity-race-ranking-metric]').forEach(function (button) {
    button.classList.toggle('active', button.dataset.activityRaceRankingMetric === activityRaceRankingMetric);
  });
  const list = panel.querySelector('[data-activity-race-ranking-list]');
  const summary = panel.querySelector('[data-activity-race-ranking-summary]');
  if (!list || !summary) return;
  const daily = activityRaceRankingSnapshot?.periods?.daily || {};
  const source = activityRaceRankingMetric === 'voice' ? daily.fullVoice || [] : daily.fullChat || [];
  const query = activityRaceRankingQuery.trim().toLocaleLowerCase('de-DE');
  const rows = source.filter(function (entry) {
    return !query || (String(entry.displayName || '') + ' ' + String(entry.username || '')).toLocaleLowerCase('de-DE').includes(query);
  });
  const active = source.filter(function (entry) { return Number(entry.value || 0) > 0; }).length;
  summary.innerHTML = '<span><b>' + source.length.toLocaleString('de-DE') + '</b><small>aktuelle Mitglieder</small></span><span><b>' + active.toLocaleString('de-DE') + '</b><small>heute gewertet</small></span><span><b>' + (source.length - active).toLocaleString('de-DE') + '</b><small>noch ohne Aktivität</small></span><em>' + (query ? rows.length.toLocaleString('de-DE') + ' Treffer' : 'Live-Stand') + '</em>';
  if (!source.length) {
    list.innerHTML = '<p>Die vollständige Tagesrangliste ist noch nicht geladen.</p>';
    return;
  }
  if (!rows.length) {
    list.innerHTML = '<p>Kein aktuelles Mitglied passt zu dieser Suche.</p>';
    return;
  }
  const maximum = Math.max(1, ...source.map(function (entry) { return Number(entry.value || 0); }));
  list.innerHTML = rows.map(function (entry) {
    const rank = Number(entry.rank || 0);
    const badge = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '#' + rank;
    const share = Math.max(0, Math.min(100, Math.round((Number(entry.value || 0) / maximum) * 1000) / 10));
    const avatar = validImageUrl(entry.avatarUrl)
      ? '<img src="' + escapeHtml(entry.avatarUrl) + '" alt="" loading="lazy">'
      : '<i>' + escapeHtml(String(entry.displayName || '?').slice(0, 1).toUpperCase()) + '</i>';
    return '<article class="' + (Number(entry.value || 0) > 0 ? 'active' : 'inactive') + ' rank-' + Math.min(rank, 4) + '" style="--activity-share:' + share + '%"><strong>' + escapeHtml(badge) + '</strong>' + avatar + '<span><b>' + escapeHtml(entry.displayName || 'Mitglied') + '</b><small>@' + escapeHtml(entry.username || 'unbekannt') + '</small></span><em>' + escapeHtml(formatActivityRaceRankingValue(entry.value, activityRaceRankingMetric)) + '</em></article>';
  }).join('');
}

function renderActivityRaceStatus(status) {
  const panel = document.getElementById('activity-race-panel');
  if (!panel) return;
  const data = status || {};
  activityRaceRankingSnapshot = data;
  ['daily', 'weekly', 'monthly'].forEach(function (period) {
    const node = panel.querySelector('[data-activity-race-' + period + ']');
    const snapshot = data.periods?.[period] || {};
    if (period !== 'daily' && snapshot.fullyTracked !== true) {
      if (node) node.textContent = 'Noch keine vollständige Wertung verfügbar';
      return;
    }
    const chat = snapshot.chat?.[0]?.value || 0;
    const voiceMinutes = Math.floor(Number(snapshot.voice?.[0]?.value || 0) / 60000);
    if (node) node.textContent = snapshot.chat?.length || snapshot.voice?.length
      ? 'Platz 1: ' + Number(chat).toLocaleString('de-DE') + ' Nachrichten · ' + Number(voiceMinutes).toLocaleString('de-DE') + ' Sprachchat-Min.'
      : period === 'daily' ? 'Heute wurde noch keine Aktivität erfasst' : 'Abgeschlossene Wertung ist leer';
  });
  const badge = panel.querySelector('[data-activity-race-badge]');
  const roleHealth = panel.querySelector('[data-activity-race-role-health]');
  const roleError = String(data.lastRoleError || '').trim();
  const panelError = String(data.panel?.lastError || '').trim();
  const indexError = String(data.indexBackfill?.lastError || '').trim();
  const recoveredMessages = Number(data.indexBackfill?.totalRecoveredMessages || data.indexBackfill?.recoveredMessages || 0);
  const indexedAt = data.indexBackfill?.completedAt ? formatBackupDate(data.indexBackfill.completedAt) : '';
  if (roleHealth) {
    roleHealth.classList.toggle('error', Boolean(roleError || indexError));
    roleHealth.innerHTML = roleError
      ? '<b>Rollenabgleich blockiert:</b> ' + escapeHtml(roleError)
      : indexError
        ? '<b>Index-Nachholung wartet:</b> ' + escapeHtml(indexError) + ' Die Live-Zählung läuft weiter.'
        : '<b>Rollenabgleich:</b> Tagesrollen laufen dynamisch; Wochen- und Monatsrollen warten auf einen gültigen Abschluss.'
          + (indexedAt ? ' <span>Serverindex zuletzt ' + escapeHtml(indexedAt) + ' abgeglichen' + (recoveredMessages > 0 ? ' · insgesamt ' + recoveredMessages.toLocaleString('de-DE') + ' Nachrichten nachgeholt' : '') + '.</span>' : '');
  }
  if (badge) badge.textContent = roleError ? 'ROLLEN PRÜFEN' : indexError ? 'INDEX PRÜFEN' : panelError ? 'PANEL PRÜFEN' : 'LIVE';
  renderActivityRaceFullRanking();
}

async function refreshActivityRaceStatus(options) {
  const settings = options || {};
  if (!state.authenticated || !state.selectedGuildId || state.activeFeatureId !== 'activityRace') return;
  const response = await apiRequestWithRetry({ path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/activity-race', timeoutMs: 12000 }, 2);
  if (handleExpiredSession(response)) return;
  if (response.ok) renderActivityRaceStatus(response.data?.status || {});
  else if (!settings.silent) toast(response.data?.error || 'Aktivitäts-Liga konnte nicht geladen werden.', 'error');
  clearTimeout(activityRaceRefreshTimer);
  activityRaceRefreshTimer = setTimeout(function () { void refreshActivityRaceStatus({ silent: true }); }, 60000);
}

function confirmActivityRaceRolePlan(preview) {
  let dialog = document.getElementById('activity-race-role-dialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'activity-race-role-dialog';
    dialog.className = 'activity-race-role-dialog';
    document.body.appendChild(dialog);
  }
  const actionCopy = { create: 'WIRD ERSTELLT', rename: 'WIRD UMBENANNT', reuse: 'WIRD VERWENDET', configured: 'BEREITS VERKNÜPFT' };
  dialog.innerHTML = '<div class="activity-role-dialog-glow"></div><header><span>AKTIVITÄTS-LIGA · SICHERHEITSVORSCHAU</span><h2>Discord-Rollenset bestätigen</h2><p>Keine Rolle wird erstellt oder umbenannt, bevor du dieses geprüfte Set verbindlich freigibst.</p></header>' +
    '<div class="activity-role-plan">' + (preview.entries || []).map(function (entry) {
      return '<article><i style="--role-color:#' + Number(entry.color || 0).toString(16).padStart(6, '0') + '"></i><span><b>' + escapeHtml(entry.name) + '</b><small>' + escapeHtml(entry.label) + '</small></span><em>' + escapeHtml(actionCopy[entry.action] || entry.action) + '</em></article>';
    }).join('') + '</div>' +
    '<div class="activity-role-summary"><span><b>' + Number(preview.createCount || 0) + '</b> neu</span><span><b>' + Number(preview.renameCount || 0) + '</b> umbenannt</span><span><b>' + Number(preview.reuseCount || 0) + '</b> wiederverwendet</span><span><b>' + Number(preview.configuredCount || 0) + '</b> verbunden</span></div>' +
    '<footer><button type="button" data-activity-role-cancel>Zurück</button><button type="button" data-activity-role-confirm>Rollenset verbindlich erstellen</button></footer>';
  if (dialog.open) dialog.close('cancel');
  return new Promise(function (resolve) {
    let completed = false;
    const finish = function (accepted) {
      if (completed) return;
      completed = true;
      dialog.oncancel = null;
      if (dialog.open) dialog.close(accepted ? 'confirm' : 'cancel');
      resolve(accepted);
    };
    dialog.querySelector('[data-activity-role-cancel]').onclick = function () { finish(false); };
    dialog.querySelector('[data-activity-role-confirm]').onclick = function () { finish(true); };
    dialog.oncancel = function (event) { event.preventDefault(); finish(false); };
    dialog.showModal();
  });
}

async function prepareActivityRaceRoles(button) {
  const host = document.getElementById('module-config');
  const feature = getNormalizedFeatureById('activityRace');
  if (!host || !feature || !state.selectedGuildId) return;
  const moduleConfig = collectModuleConfig(host, feature);
  button.disabled = true;
  button.textContent = 'Set wird geprüft …';
  try {
    const previewResponse = await api.apiRequest({
      path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/activity-race/roles/preview',
      method: 'POST',
      body: { config: moduleConfig }
    });
    if (handleExpiredSession(previewResponse)) return;
    if (!previewResponse.ok) throw new Error(previewResponse.data?.error || 'Rollenset konnte nicht geprüft werden.');
    const preview = previewResponse.data?.preview || {};
    if (!(await confirmActivityRaceRolePlan(preview))) return;
    button.textContent = 'Rollen werden erstellt …';
    const createResponse = await api.apiRequest({
      path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/activity-race/roles/create',
      method: 'POST',
      body: { token: preview.token, config: moduleConfig }
    });
    if (handleExpiredSession(createResponse)) return;
    if (!createResponse.ok) throw new Error(createResponse.data?.error || 'Rollenset konnte nicht erstellt werden.');
    state.config.activityRace = createResponse.data?.result?.config || state.config.activityRace;
    state.moduleDirty = false;
    await loadModuleResources(state.selectedGuildId);
    renderModuleConfig({ force: true });
    toast('Rollenset der Aktivitäts-Liga wurde sicher verbunden.', 'success');
  } catch (error) {
    toast(String(error?.message || error), 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Rollenset prüfen';
  }
}

async function refreshActivityRacePanel(button) {
  if (button) { button.disabled = true; button.textContent = 'Wird aktualisiert …'; }
  try {
    const response = await api.apiRequest({ path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/activity-race/refresh', method: 'POST', body: {} });
    if (handleExpiredSession(response)) return;
    if (!response.ok) throw new Error(response.data?.error || 'Panel konnte nicht aktualisiert werden.');
    toast('Rangliste und Auszeichnungsrollen wurden aktualisiert.', 'success');
    await refreshActivityRaceStatus();
  } catch (error) {
    toast(String(error?.message || error), 'error');
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Panel aktualisieren'; }
  }
}

function boostAutomationOverview(config) {
  const baseCount = FHCCModuleConfigInputs.settingLines(config?.automaticRoleIds).length;
  const tierCount = FHCCModuleConfigInputs.parseRoleMappings(config?.tierRoleMappings).length;
  const active = config?.enabled === true;
  const announceActive = config?.boostAnnounceEnabled === true;
  const announceChannel = config?.boostAnnounceChannelId ? String(config.boostAnnounceChannelId) : '';
  const announceChannelName = announceChannel ? String(state.moduleChannels?.find(function (entry) { return String(entry.id) === announceChannel; })?.name || announceChannel) : '';
  const announceTemplate = config?.boostAnnounceTemplate || {};
  const announceEmbedCount = Array.isArray(announceTemplate.embeds) ? announceTemplate.embeds.length : announceTemplate.embed ? 1 : 0;
  const topActive = config?.boostTopEnabled === true;
  const topChannel = config?.boostTopChannelId ? String(config.boostTopChannelId) : '';
  const topChannelName = topChannel ? String(state.moduleChannels?.find(function (entry) { return String(entry.id) === topChannel; })?.name || topChannel) : '';
  const topPings = config?.boostTopPingsEnabled !== false;
  return '<section class="boost-automation-overview ' + (active && baseCount ? 'ready' : 'attention') + '"><header><span><small>BOOSTER-AUTOMATIK</small><strong>' + (active ? 'Automatischer Rollenabgleich aktiv' : 'Modul ist aktuell deaktiviert') + '</strong></span><div><em>' + (active && baseCount ? 'BEREIT' : 'KONFIGURIEREN') + '</em><button type="button" data-sync-boost-roles ' + (active ? '' : 'disabled') + '>Jetzt abgleichen</button></div></header><div><article><small>JEDER BOOSTER</small><b>' + baseCount + ' Basisrolle' + (baseCount === 1 ? '' : 'n') + '</b><p>Sofort bei aktivem Boost</p></article><article><small>STAFFELN</small><b>' + tierCount + ' Stufe' + (tierCount === 1 ? '' : 'n') + '</b><p>Bleiben nach Boost-Anzahl erhalten</p></article><article><small>BOOST-ENDE</small><b>Automatischer Entzug</b><p>Basis-, Staffel- und gewählte Farbrollen</p></article></div><p class="boost-automation-note">Speichern startet direkt einen vollständigen Abgleich. Zusätzlich korrigiert der Bot den Rollenstand regelmäßig und nach jedem Discord-Mitgliederupdate.</p></section>' +
    '<section class="activity-race-overview welcome-template-overview boost-announce-overview"><header><div><small>BOOST-BENACHRICHTIGUNG</small><strong>' + (announceActive && announceChannel ? 'Jeder Boost wird angekündigt' : 'Automatisches Boost-Embed ist aus') + '</strong><p>' + (announceActive && announceChannel ? 'Das gestaltete Embed erscheint bei jedem Boost in <code>#' + escapeHtml(announceChannelName) + '</code> und zeigt die aktuelle Boost-Zahl (1×, 2×, …) des Mitglieds.' : 'Aktiviere die Boost-Benachrichtigung und wähle einen Kanal – dann sendet der Bot bei jedem Boost das gestaltete Embed.') + '</p></div><em>' + (announceActive ? announceEmbedCount + ' EMBED' + (announceEmbedCount === 1 ? '' : 'S') : 'AUS') + '</em></header><div class="activity-race-actions"><div><b>Boost-Embed gestalten</b><span>Embed Studio mit Live-Vorschau · {boostcount} wird durch die echte Boost-Zahl ersetzt.</span></div><button type="button" data-boost-open-studio>Boost-Embed bearbeiten</button></div></section>' +
    '<section class="activity-race-overview welcome-template-overview boost-announce-overview boost-top-overview"><header><div><small>TOP-BOOSTER-LIGA</small><strong>' + (topActive && topChannel ? 'Top 1–3 werden live angezeigt' : 'Live-Rangliste ist aus') + '</strong><p>' + (topActive && topChannel ? 'Genau ein Embed in <code>#' + escapeHtml(topChannelName) + '</code> – es wird bei jeder Änderung der Top 3 bearbeitet. Platzierungs-Pings ' + (topPings ? 'sind aktiv.' : 'sind aus.') : 'Aktiviere die Top-Booster-Liga und wähle einen Kanal (oder „top-booster“) – der Bot sendet genau ein Embed und aktualisiert es live.') + '</p></div><em>' + (topActive ? 'LIVE' : 'AUS') + '</em></header><div class="activity-race-actions"><div><b>Top-3-Embed gestalten</b><span>Embed Studio mit Live-Vorschau · {boostcount}, {server} und {range} werden automatisch ersetzt.</span></div><button type="button" data-boost-top-open-studio>Top-3-Embed bearbeiten</button><button type="button" data-boost-top-refresh ' + (topActive ? '' : 'disabled') + '>Embed jetzt aktualisieren</button></div><div class="boost-top-status" data-boost-top-status></div></section>';
}
function vipPanelsOverview(config) {
  const panelsActive = config?.enabled === true && config?.vipPanelEnabled === true;
  const channelId = config?.vipPanelChannelId ? String(config.vipPanelChannelId) : '';
  const channelName = channelId ? String(state.moduleChannels?.find(function (entry) { return String(entry.id) === channelId; })?.name || channelId) : '';
  return window.FHCCEconomyPanelStudio.overview(config, state, escapeHtml) + '<section class="activity-race-overview welcome-template-overview boost-announce-overview vip-panels-overview"><header><div><small>VIP-PANEL</small><strong>' + (panelsActive ? 'Alle VIP-Stufen in einem Embed' : 'VIP-Panel ist aus') + '</strong><p>' + (panelsActive
    ? channelName
      ? 'Genau ein Embed in <code>#' + escapeHtml(channelName) + '</code> – alle Stufen zusammen, bearbeitet bei jeder Änderung.'
      : 'Wähle unten einen Kanal (oder „vip“) – der Bot sendet genau ein Embed mit allen Stufen zusammen.'
    : 'Aktiviere das VIP-Panel und wähle einen Kanal. Alle VIP-Stufen erscheinen zusammen in genau einem Embed, jede mit ihrem Rang-Emoji.') + '</p></div><em>' + (panelsActive ? 'LIVE' : 'AUS') + '</em></header><div class="activity-race-actions"><div><b>VIP-Embed gestalten</b><span>Embed Studio mit Live-Vorschau · {memberCount}, {tierCount} und {server} werden automatisch ersetzt.</span></div><button type="button" data-vip-panels-open-studio>VIP-Embed bearbeiten</button><button type="button" data-vip-panels-refresh ' + (panelsActive ? '' : 'disabled') + '>Embed jetzt aktualisieren</button></div><div class="activity-race-actions"><div><b>VIP-Trennerrolle</b><span>Jedes Mitglied mit einer aktiven VIP-Stufe erhält die Trennerrolle automatisch – sie wird nach Entzug der letzten VIP-Stufe wieder entfernt. Nach einer Konfig-Änderung läuft der Abgleich automatisch, hier kannst du ihn zusätzlich manuell auslösen.</span></div><button type="button" data-vip-separator-sync>Jetzt abgleichen</button><em id="vip-separator-status" class="vip-separator-status"></em></div><div class="vip-panels-status" data-vip-panels-status></div>' +
    '<div class="pcv-design-actions economy-message-designs"><b>Automatische Nachrichten &amp; Embeds</b><p>Diese Vorlagen werden automatisch als private Nachricht gesendet. Öffne jede Nachricht direkt im vollständigen Embed Studio.</p>' +
      '<div class="pcv-design-group"><div class="pcv-design-grid">' +
        '<button type="button" data-vip-dm-studio="giftReceived"><span>🎁</span>Geschenk-DM (Rolle erhalten)</button>' +
        '<button type="button" data-vip-dm-studio="vipPurchased"><span>👑</span>Kauf-DM (VIP gekauft)</button>' +
        '<button type="button" data-vip-dm-studio="coinsReceived"><span>🪙</span>Coin-Gutschrift-DM</button>' +
        '<button type="button" data-vip-dm-studio="coinGiftReceived"><span>🎁</span>Coin-Geschenk empfangen</button>' +
        '<button type="button" data-vip-dm-studio="coinGiftSent"><span>↗</span>Coin-Geschenk gesendet</button>' +
        '<button type="button" class="economy-message-primary" data-vip-dm-studio="boostMilestone"><span>⚡</span>Boost-Meilenstein-Embed bearbeiten</button>' +
      '</div></div>' +
    '</div>' +
    '</section>';
}
function welcomeFarewellOverview(config) {
  const deferred = config?.welcomeAfterVerification === true;
  const roleReady = Boolean(String(config?.verificationRoleId || '').trim());
  const template = config?.welcomeTemplate || {};
  const embedCount = Array.isArray(template.embeds) ? template.embeds.length : template.embed ? 1 : 0;
  return '<section class="activity-race-overview welcome-template-overview"><header><div><small>VERIFIZIERUNGS-WORKFLOW</small><strong>' + (deferred ? 'Begrüßung nach Rollenfreigabe' : 'Begrüßung direkt beim Beitritt') + '</strong><p>' + (deferred ? roleReady ? 'Die Nachricht erscheint erst, wenn die ausgewählte Unverified-Rolle entfernt wurde.' : 'Wähle noch die Unverified-Rolle aus.' : 'Optional kannst du unten auf die Begrüßung nach Verifizierung umstellen.') + '</p></div><em>' + embedCount + ' EMBED' + (embedCount === 1 ? '' : 'S') + '</em></header><div class="activity-race-actions"><div><b>Willkommensnachricht gestalten</b><span>Verwendet das bestehende Embed Studio mit Live-Vorschau, Bildern und bis zu zehn Embeds.</span></div><button type="button" data-welcome-open-studio>Willkommensnachricht bearbeiten</button></div></section>';
}

function memberVerifyOverview(config) {
  const active = config?.enabled === true;
  const panelReady = Boolean(String(config?.panelChannelId || '').trim());
  const design = config?.panelTemplate || {};
  const embedCount = Array.isArray(design.embeds) ? design.embeds.length : design.embed ? 1 : 1;
  return '<section class="activity-race-overview welcome-template-overview"><header><div><small>VERIFY-PANEL</small><strong>' + (active ? (panelReady ? 'Verify-Panel wird gepflegt' : 'Kanal auswählen, dann aktiv') : 'Modul ist deaktiviert') + '</strong><p>' + (panelReady ? 'Das Panel-Embed steht im gewählten Kanal und wird beim Speichern automatisch aktualisiert – der Verifizieren-Button bleibt immer erhalten.' : 'Wähle unten den Verify-Panel-Kanal. Danach kannst du das Panel-Embed im Studio gestalten.') + '</p></div><em>' + embedCount + ' EMBED' + (embedCount === 1 ? '' : 'S') + '</em></header><div class="activity-race-actions"><div><b>Verify-Embed gestalten</b><span>Embed Studio mit Live-Vorschau · Titel, Beschreibung, Farben, Bilder, Felder und Nachricht sind frei editierbar.</span></div><button type="button" data-member-verify-open-studio>Verify-Embed bearbeiten</button></div></section>';
}

function memberVerifyStudioTemplate(config) {
  const design = config?.panelTemplate || {};
  const sources = Array.isArray(design.embeds) && design.embeds.length
    ? design.embeds
    : [{
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
    }];
  return {
    specialTemplate: 'memberVerify',
    channelId: String(config?.panelChannelId || ''),
    content: Object.prototype.hasOwnProperty.call(design, 'content') ? String(design.content || '') : '',
    outsideImageUrl: design.outsideImageAttachment && design.outsideImageAttachment.anchored !== true ? '' : String(design.outsideImageUrl || ''),
    outsideImageName: String(design.outsideImageAttachment?.name || ''),
    outsideImageSize: Number(design.outsideImageAttachment?.size || 0),
    outsideImageAttachment: design.outsideImageAttachment || null,
    embeds: sources.slice(0, 1).map(function (embed) {
      return {
        title: embed.title || '', url: embed.url || '', description: embed.description || '', color: embed.color || '#8b82ff',
        authorName: embed.authorName || '', authorIconUrl: embed.authorIconUrl || '', thumbnailUrl: embed.thumbnailUrl || '',
        imageUrl: embed.imageUrl || '', footerText: embed.footerText || '', footerIconUrl: embed.footerIconUrl || '',
        timestamp: embed.timestamp !== false, fields: Array.isArray(embed.fields) ? clone(embed.fields).slice(0, 25) : []
      };
    }),
    componentSet: 'none',
    reactionRoles: []
  };
}

async function openMemberVerifyStudio() {
  if (!state.authenticated || !state.selectedGuildId) {
    toast('Wähle zuerst einen Server.', 'error');
    return;
  }
  if (!(await setView('studio'))) return;
  await refreshConfig(state.selectedGuildId);
  state.activeStudioMessageId = '';
  state.studioSourceMessage = null;
  loadStudioTemplate(memberVerifyStudioTemplate(state.config?.memberVerify));
  renderDrafts();
  toast('Verify-Embed im bestehenden Embed Studio geöffnet.', 'success');
}

async function saveMemberVerifyStudioTemplate() {
  if (!state.authenticated || !state.selectedGuildId) {
    toast('Wähle zuerst einen Server.', 'error');
    return false;
  }
  const template = currentStudioTemplate();
  const validation = renderStudioLimits(template);
  if (!validation.valid) {
    toast(validation.errors[0], 'error');
    return false;
  }
  return saveStudioDesign({
    path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/member-verify/design',
    body: {
      template: {
        ...template,
        embeds: (template.embeds || [template.embed || {}]).slice(0, 1),
        channelId: template.channelId || state.config?.memberVerify?.panelChannelId || ''
      }
    },
    errorMessage: 'Das Verify-Embed konnte nicht gespeichert werden.',
    onSaved: function (result) {
      state.config.memberVerify = result.config?.memberVerify || state.config.memberVerify;
      loadStudioTemplate(memberVerifyStudioTemplate(state.config.memberVerify));
    },
    okMessage: function (result) {
      return result.panel
        ? 'Verify-Embed gespeichert und Live-Panel aktualisiert.'
        : 'Verify-Embed gespeichert. Es wird nach der Aktivierung automatisch erstellt.';
    }
  });
}

// levels-panel.js provides all levels/levelUp/levelUpInfo functions

// Aktionsformular: „Level setzen“ erst bei gefüllten Feldern aktiv.
document.addEventListener('input', function (event) {
  const target = event.target;
  if (!target || typeof target.closest !== 'function') return;
  if (!target.closest('[data-levels-set-user], [data-levels-set-level-value]')) return;
  const panel = document.getElementById('levels-panel');
  const button = panel?.querySelector('[data-levels-set-level]');
  if (!button) return;
  const user = panel?.querySelector('[data-levels-set-user]');
  const level = panel?.querySelector('[data-levels-set-level-value]');
  button.disabled = !String(user?.value || '').trim() || !String(level?.value || '').trim();
});

async function openBotUpdatesStudio() {
  if (!state.authenticated || !state.selectedGuildId) {
    toast('Wähle zuerst einen Server.', 'error');
    return;
  }
  if (!(await setView('studio'))) return;
  await refreshConfig(state.selectedGuildId);
  state.activeStudioMessageId = '';
  state.studioSourceMessage = null;
  loadStudioTemplate(botUpdatesStudioTemplate(state.config?.botUpdates));
  renderDrafts();
  toast('Update-Embed im bestehenden Embed Studio geöffnet.', 'success');
}

async function saveBotUpdatesStudioTemplate() {
  if (!state.authenticated || !state.selectedGuildId) {
    toast('Wähle zuerst einen Server.', 'error');
    return false;
  }
  const template = currentStudioTemplate();
  const validation = renderStudioLimits(template);
  if (!validation.valid) {
    toast(validation.errors[0], 'error');
    return false;
  }
  if ((template.embeds?.length || (template.embed ? 1 : 0)) > 1) {
    toast('Das Update-Embed verwendet genau ein automatisch gepflegtes Embed.', 'error');
    return false;
  }
  return saveStudioDesign({
    path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/bot-updates/design',
    body: {
      template: {
        ...template,
        design: template,
        embeds: (template.embeds || [template.embed || {}]).slice(0, 1),
        channelId: template.channelId || state.config?.botUpdates?.channelId || ''
      }
    },
    errorMessage: 'Das Update-Embed konnte nicht gespeichert werden.',
    onSaved: function (result) {
      state.config.botUpdates = result.config?.botUpdates || state.config.botUpdates;
      if (Array.isArray(result.changelog)) state.botUpdatesChangelog = result.changelog;
      loadStudioTemplate(botUpdatesStudioTemplate(state.config.botUpdates));
    },
    okMessage: function (result) {
      const panelStatus = result.status || {};
      const panelAction = String(panelStatus.action || '');
      if (panelAction === 'posted' || panelAction === 'updated') return 'Update-Embed gesendet und Live-Panel aktualisiert.';
      if (panelAction === 'no-channel') return 'Update-Embed gespeichert. Wähle zuerst einen Kanal – dann wird es automatisch gesendet.';
      if (panelAction === 'channel-unavailable' || panelAction === 'missing-permission') return 'Update-Embed gespeichert, aber der Kanal #' + (panelStatus.channelName || '?') + ' ist nicht erreichbar – der Bot hat dort keine Schreibrechte oder der Kanal existiert nicht.';
      if (panelAction === 'send-failed') return 'Update-Embed gespeichert, aber das Senden in den Kanal ist fehlgeschlagen.';
      if (panelStatus.lastError) return 'Update-Embed gespeichert, aber das Senden ist fehlgeschlagen: ' + panelStatus.lastError;
      return 'Update-Embed gespeichert. Es wird automatisch gesendet, sobald ein Kanal gewählt ist.';
    },
    okType: function (result) {
      const panelStatus = result.status || {};
      return String(panelStatus.action || '') === 'send-failed' || panelStatus.lastError ? 'error' : 'success';
    }
  });
}

function renderModuleConfig(options) {
  const settings = options || {};
  const host = document.getElementById('module-config');
  if (!host) return;
  if (state.moduleDirty && !settings.force) return;
  const activeCatalogList = activeCatalog();
  if (!state.activeFeatureId && activeCatalogList.length) {
    state.activeFeatureId = activeCatalogList[0][0];
  }
  let feature = getNormalizedFeatureById(state.activeFeatureId);
  if (!feature && activeCatalogList.length) {
    state.activeFeatureId = activeCatalogList[0][0];
    feature = getNormalizedFeatureById(state.activeFeatureId);
  }
  const featureId = feature?.id || '';
  const renderSignature = JSON.stringify({
    authenticated: state.authenticated,
    guild: state.selectedGuildId,
    active: state.activeFeatureId,
    feature: feature || null,
    config: state.config?.[state.activeFeatureId] || null,
    roles: state.moduleRoles,
    channels: state.moduleChannels
  });
  if (!settings.force && host.dataset.renderSignature === renderSignature && host.childElementCount) return;
  state.moduleDirty = false;
  state.moduleSaving = false;
  host.dataset.renderSignature = renderSignature;
  host.dataset.rebuildCount = String(Number(host.dataset.rebuildCount || 0) + 1);
  window.FallenHeavenRenderMetrics = window.FallenHeavenRenderMetrics || {};
  window.FallenHeavenRenderMetrics.moduleConfigRebuilds = (window.FallenHeavenRenderMetrics.moduleConfigRebuilds || 0) + 1;
  if (!state.authenticated || !state.selectedGuildId) {
    host.innerHTML = '<p class="empty-drafts">Melde dich mit Discord an und wähle einen Server, um ein Modul zu konfigurieren.</p>';
    return;
  }
  if (!feature) {
    host.innerHTML = '<p class="empty-drafts">Für dieses Modul stehen keine erweiterten Felder bereit.</p>';
    return;
  }
  const fields = (feature.fields || []).filter(function (field) { return field.key !== feature.id + '.enabled'; });
  const enabled = moduleEnabled(feature.id);
  host.innerHTML = '<div class="module-config-head"><div><div class="module-config-meta"><span class="module-state ' + (enabled ? 'enabled' : '') + '"><i></i>' + (enabled ? 'AKTIV' : 'INAKTIV') + '</span><span>' + fields.length + ' Einstellungen</span></div><div class="module-config-title-row"><i class="module-config-icon">' + escapeHtml(feature.icon || 'FH') + '</i><h3>' + escapeHtml(feature.title || feature.id) + '</h3></div><p>' + escapeHtml(feature.detail || feature.description || '') + '</p></div><div class="module-config-actions"><span id="module-save-state" data-state="saved">Alle Änderungen gespeichert</span><div><button id="discard-module-fields" class="button secondary" type="button" hidden>Verwerfen</button><button id="save-module-fields" class="button primary" type="button" disabled>Änderungen speichern</button></div></div></div>' +
    (feature.id === 'serverBackup' ? serverBackupOverview(state.config[feature.id]) : '') +
    (feature.id === 'serverTagTracker' ? serverTagTrackerOverview(state.config[feature.id]) : '') +
    (feature.id === 'voiceChatCleaner' ? voiceChatCleanerOverview(state.config[feature.id]) : '') +
    (feature.id === 'voiceLogImport' ? voiceLogImportOverview(state.config[feature.id]) : '') +
    (feature.id === 'publicCallVote' ? publicCallVoteOverview(state.config[feature.id]) : '') +
    (feature.id === 'tempVoice' ? tempVoiceUi.overview(state.config[feature.id]) : '') +
    (feature.id === 'forumCleaner' ? forumCleanerOverview(state.config[feature.id]) : '') +
    (feature.id === 'steamWorkshop' ? steamWorkshopOverview(state.config[feature.id]) : '') +
    (feature.id === 'emojiManager' ? emojiManagerOverview(state.config[feature.id]) : '') +
    (feature.id === 'welcomeFarewell' ? welcomeFarewellOverview(state.config[feature.id]) : '') +
    (feature.id === 'activityRace' ? activityRaceOverview(state.config[feature.id]) : '') +
    (feature.id === 'boostRoles' ? boostAutomationOverview(state.config[feature.id]) : '') +
    (feature.id === 'heavenEconomy' ? vipPanelsOverview(state.config[feature.id]) : '') +
    (feature.id === 'memberVerify' ? memberVerifyOverview(state.config[feature.id]) : '') +
    (feature.id === 'levels' ? FHCCLevelsPanel.overview(state.config[feature.id]) : '') +
    (feature.id === 'counting' ? FHCCCountingPanel.overview(state.config[feature.id]) : '') +
    (feature.id === 'botUpdates' ? botUpdatesOverview(state.config[feature.id]) : '') +
    (feature.id === 'roleSaver' ? roleSaverOverview(state.config[feature.id]) : '') +
    (feature.id === 'inactiveReminder' ? FHCCInactiveReminderPanel.overview(state.config[feature.id]) : '') +
    (feature.id === 'customRichPresence' ? '<div id="rp-health-card" class="module-overview-card" data-rp-state="disabled"><div class="rp-health-row"><span class="rp-health-label">Bot</span><span class="rp-health-value" data-rp-bot-status>offline</span></div><div class="rp-health-row"><span class="rp-health-label">Rich Presence</span><span class="rp-health-value" data-rp-status>deaktiviert</span></div><div class="rp-health-row" data-rp-retry-row hidden><span class="rp-health-label">Nächster Versuch</span><span class="rp-health-value" data-rp-retry>–</span></div><div class="rp-health-actions"><button id="rp-reconnect-btn" class="button secondary" type="button" hidden>Neu verbinden</button></div></div>' : '') +
    (fields.length ? '<div class="module-field-grid">' + fields.map(function (field) {
      const current = getByPath(state.config, field.key);
      const type = String(field.type || 'text').toLowerCase(); const rich = ['rolemappingselect', 'roleswapselect', 'multiroleselect', 'multichannelselect'].includes(type); const isToggle = type === 'checkbox';
      const labelHtml = '<strong class="module-field-label">' + escapeHtml(field.label || field.key) + '</strong>'; const hintHtml = '<span>' + escapeHtml(field.hint || field.info || '') + '</span>'; const inner = isToggle ? '<span class="module-field-copy">' + labelHtml + hintHtml + '</span><span class="module-toggle">' + FHCCModuleConfigInputs.inputForField(field, current) + '<i></i></span>' : labelHtml + hintHtml + FHCCModuleConfigInputs.inputForField(field, current); return '<' + (rich ? 'div' : 'label') + ' class="module-field' + (rich ? ' module-field-rich' : '') + (isToggle ? ' module-field-toggle' : '') + '" data-field-type="' + escapeHtml(type) + '">' + inner + '</' + (rich ? 'div' : 'label') + '>';
    }).join('') + '</div>' : '<p class="empty-drafts">Dieses Modul hat keine weiteren Einstellungen.</p>');
  const save = document.getElementById('save-module-fields');
  if (feature.id === 'boostRoles') {
    host.querySelector('.boost-automation-overview')?.insertAdjacentHTML('afterend', '<section id="boost-rebuild-progress" class="boost-rebuild-progress" data-state="idle"><div class="boost-progress-orb"><i></i></div><div class="boost-progress-main"><div class="boost-progress-heading"><span><small data-boost-progress-state>STATUS</small><strong data-boost-progress-title>Bereit</strong></span><b data-boost-progress-value>0%</b></div><p data-boost-progress-detail>Warte auf den nächsten Abgleich.</p><div class="boost-progress-track"><i data-boost-progress-fill></i></div><small data-boost-progress-count>Noch keine offenen Prüfungen</small></div></section>');
    void refreshBoostProgress();
    void refreshBoostTopStatus();
  }
  if (feature.id === 'heavenEconomy') {
    void refreshVipPanelsStatus();
  }
  if (feature.id === 'serverBackup') {
    void refreshServerBackups();
  }
  if (feature.id === 'serverTagTracker') {
    void refreshServerTagTrackerStatus();
  }
  if (feature.id === 'voiceChatCleaner') {
    void refreshVoiceChatCleanerStatus();
  }
  if (feature.id === 'publicCallVote') {
    void refreshPublicCallVoteStatus();
    void refreshPublicCallVoteLocks();
  }
  if (feature.id === 'tempVoice') {
    void tempVoiceUi.refreshStatus();
  }
  if (feature.id === 'forumCleaner') {
    void refreshForumCleanerStatus();
  }
  if (feature.id === 'steamWorkshop') {
    void refreshSteamWorkshopStatus();
  }
  if (feature.id === 'emojiManager') {
    emojiManagerPreview = null;
    void refreshEmojiManagerStatus();
  }
  if (feature.id === 'activityRace') {
    void refreshActivityRaceStatus();
  }
  if (feature.id === 'roleSaver') {
    void refreshRoleSaverStatus();
  }
  if (feature.id === 'inactiveReminder') {
    void FHCCInactiveReminderPanel.refreshStatus();
  }
  if (feature.id === 'counting') {
    void FHCCCountingPanel.refreshLocks();
  }
  if (feature.id === 'customRichPresence') {
    void refreshRichPresenceHealth();
  }
  save?.addEventListener('click', async function () {
    const moduleConfig = collectModuleConfig(host, feature);
    const validation = validateModuleConfig(host, feature, moduleConfig);
    if (!validation.ok) {
      toast(validation.message, 'error');
      return;
    }
    state.moduleSaving = true;
    setModuleDirty(true);
    const patch = {};
    patch[feature.id] = moduleConfig;
    const saved = await savePatch(patch, 'Modul-Einstellungen gespeichert und Abgleich gestartet.');
    if (!saved) {
      state.moduleSaving = false;
      setModuleDirty(true);
    }
  });
  host.oninput = function (event) {
    const activityRankingSearch = event.target.closest('[data-activity-race-ranking-search]');
    if (activityRankingSearch) {
      activityRaceRankingQuery = activityRankingSearch.value;
      renderActivityRaceFullRanking();
      return;
    }
    if (event.target.matches('[data-setting-format="json"]')) event.target.setCustomValidity('');
    const roleSearch = event.target.closest('[data-role-search]');
    if (roleSearch) {
      const query = roleSearch.value.trim().toLocaleLowerCase('de');
      roleSearch.closest('.module-role-multi').querySelectorAll('[data-role-search-text]').forEach(function (choice) {
        choice.hidden = Boolean(query) && !choice.dataset.roleSearchText.toLocaleLowerCase('de').includes(query);
      });
      return;
    }
    const channelSearch = event.target.closest('[data-channel-search]');
    if (channelSearch) {
      const query = channelSearch.value.trim().toLocaleLowerCase('de');
      const channelMulti = channelSearch.closest('.module-channel-multi');
      channelMulti.querySelectorAll('[data-channel-search-text]').forEach(function (choice) {
        choice.hidden = Boolean(query) && !choice.dataset.channelSearchText.toLocaleLowerCase('de').includes(query);
      });
      channelMulti.querySelectorAll('[data-channel-choice-group]').forEach(function (group) {
        group.hidden = !Array.from(group.querySelectorAll('[data-channel-search-text]')).some(function (choice) { return !choice.hidden; });
      });
      return;
    }
    const emojiInputField = event.target.closest('[data-emoji-input]');
    if (emojiInputField) {
      const preview = emojiInputField.closest('.module-emoji-control')?.querySelector('[data-emoji-preview]');
      if (preview) preview.innerHTML = FHCCModuleConfigInputs.emojiPreviewHtml(emojiInputField.value);
    }
    if (feature.id === 'emojiManager') {
      emojiManagerPreview = null;
      const apply = host.querySelector('[data-emoji-apply-action]');
      if (apply) apply.disabled = true;
      const badge = host.querySelector('[data-emoji-manager-badge]');
      if (badge) badge.textContent = 'VORSCHAU VERALTET';
    }
    setModuleDirty(true);
  };
  host.onchange = function (event) {
    if (event.target.closest('[data-activity-race-ranking-search]')) return;
    const reminderCandidate = event.target.closest('[data-inactive-reminder-candidate]');
    if (reminderCandidate) {
      FHCCInactiveReminderPanel.refreshSelection();
      setModuleDirty(false);
      return;
    }
    const multi = event.target.closest('.module-role-multi');
    if (multi) updateRoleMultiState(multi);
    const channelMulti = event.target.closest('.module-channel-multi');
    if (channelMulti) updateChannelMultiState(channelMulti);
    if (feature.id === 'emojiManager') {
      emojiManagerPreview = null;
      const apply = host.querySelector('[data-emoji-apply-action]');
      if (apply) apply.disabled = true;
      const badge = host.querySelector('[data-emoji-manager-badge]');
      if (badge) badge.textContent = 'VORSCHAU VERALTET';
    }
    setModuleDirty(true);
  };
  host.onclick = function (event) {
    const tempVoiceProfileReset = event.target.closest('[data-temp-voice-reset-profile]');
    if (tempVoiceProfileReset) {
      void tempVoiceUi.resetProfile(tempVoiceProfileReset.dataset.tempVoiceResetProfile || '', tempVoiceProfileReset);
      return;
    }
    const tempVoiceResetAll = event.target.closest('[data-temp-voice-reset-all]');
    if (tempVoiceResetAll) {
      void tempVoiceUi.resetAllProfiles(tempVoiceResetAll);
      return;
    }
    const tempVoiceStudio = event.target.closest('[data-temp-voice-open-studio]');
    if (tempVoiceStudio) {
      void tempVoiceUi.openStudio();
      return;
    }
    const memberVerifyStudio = event.target.closest('[data-member-verify-open-studio]');
    if (memberVerifyStudio) {
      void openMemberVerifyStudio();
      return;
    }
    const levelsStudio = event.target.closest('[data-levels-open-studio]');
    if (levelsStudio) {
      void FHCCLevelsPanel.openStudio();
      return;
    }
    const inactiveReminderStudio = event.target.closest('[data-inactive-reminder-open-studio]');
    if (inactiveReminderStudio) {
      void FHCCInactiveReminderPanel.openStudio();
      return;
    }
    const inactiveReminderPreview = event.target.closest('[data-inactive-reminder-preview]');
    if (inactiveReminderPreview) {
      void FHCCInactiveReminderPanel.runPreviewAction();
      return;
    }
    const inactiveReminderSelectAll = event.target.closest('[data-inactive-reminder-select-all]');
    if (inactiveReminderSelectAll) {
      const host = document.querySelector('[data-inactive-reminder-preview-list]');
      if (host) {
        host.querySelectorAll('[data-inactive-reminder-candidate]').forEach(function (checkbox) { checkbox.checked = true; });
        FHCCInactiveReminderPanel.refreshSelection();
      }
      return;
    }
    const inactiveReminderSelectNone = event.target.closest('[data-inactive-reminder-select-none]');
    if (inactiveReminderSelectNone) {
      const host = document.querySelector('[data-inactive-reminder-preview-list]');
      if (host) {
        host.querySelectorAll('[data-inactive-reminder-candidate]').forEach(function (checkbox) { checkbox.checked = false; });
        FHCCInactiveReminderPanel.refreshSelection();
      }
      return;
    }
    const inactiveReminderSendSelected = event.target.closest('[data-inactive-reminder-send-selected]');
    if (inactiveReminderSendSelected) {
      void FHCCInactiveReminderPanel.runSendAction();
      return;
    }
    const inactiveReminderDeleteAll = event.target.closest('[data-inactive-reminder-delete-all]');
    if (inactiveReminderDeleteAll) {
      void FHCCInactiveReminderPanel.deleteAllDms();
      return;
    }
    const inactiveReminderCleanup = event.target.closest('[data-inactive-reminder-cleanup]');
    if (inactiveReminderCleanup) {
      void FHCCInactiveReminderPanel.cleanupDms();
      return;
    }
    const inactiveReminderSendManual = event.target.closest('[data-inactive-reminder-send-manual]');
    if (inactiveReminderSendManual) {
      void FHCCInactiveReminderPanel.sendManualDm();
      return;
    }
    const inactiveReminderPageBtn = event.target.closest('[data-inactive-reminder-page]');
    if (inactiveReminderPageBtn && !inactiveReminderPageBtn.disabled) {
      FHCCInactiveReminderPanel.setPage(Math.max(0, Number(inactiveReminderPageBtn.getAttribute('data-inactive-reminder-page') || 0)));
      void FHCCInactiveReminderPanel.refreshStatus();
      return;
    }
    const inactiveReminderDeleteOne = event.target.closest('[data-inactive-reminder-delete-one]');
    if (inactiveReminderDeleteOne) {
      void FHCCInactiveReminderPanel.deleteDm(inactiveReminderDeleteOne.getAttribute('data-inactive-reminder-delete-one') || '');
      return;
    }
    const countingStudio = event.target.closest('[data-counting-open-studio]');
    if (countingStudio) {
      void FHCCCountingPanel.openStudio();
      return;
    }
    const levelUpStudio = event.target.closest('[data-levels-open-up-studio]');
    if (levelUpStudio) {
      void FHCCLevelsPanel.openLevelUpStudio();
      return;
    }
    const botUpdatesStudio = event.target.closest('[data-bot-updates-open-studio]');
    if (botUpdatesStudio) {
      void openBotUpdatesStudio();
      return;
    }
    const levelUpInfoStudio = event.target.closest('[data-levels-open-info-studio]');
    if (levelUpInfoStudio) {
      void FHCCLevelsPanel.openLevelUpInfoStudio();
      return;
    }
    const levelsSetLevel = event.target.closest('[data-levels-set-level]');
    if (levelsSetLevel) {
      void FHCCLevelsPanel.setMemberLevelAction();
      return;
    }
    const levelsWipe = event.target.closest('[data-levels-wipe-roles]');
    if (levelsWipe) {
      void FHCCLevelsPanel.wipeLevelRolesAction(levelsWipe);
      return;
    }
    const levelsGrantAll = event.target.closest('[data-levels-grant-all]');
    if (levelsGrantAll) {
      void FHCCLevelsPanel.grantLevelRolesToAllAction(levelsGrantAll);
      return;
    }
    const welcomeStudio = event.target.closest('[data-welcome-open-studio]');
    if (welcomeStudio) {
      void openWelcomeFarewellStudio();
      return;
    }
    const boostStudio = event.target.closest('[data-boost-open-studio]');
    if (boostStudio) {
      void openBoostAnnounceStudio();
      return;
    }
    const boostTopStudio = event.target.closest('[data-boost-top-open-studio]');
    if (boostTopStudio) {
      void openBoostTopStudio();
      return;
    }
    const boostTopRefresh = event.target.closest('[data-boost-top-refresh]');
    if (boostTopRefresh) {
      void refreshBoostTopPanel();
      return;
    }
    const vipPanelsStudio = event.target.closest('[data-vip-panels-open-studio]');
    if (vipPanelsStudio) {
      void openVipPanelStudio();
      return;
    }
    if (event.target.closest('[data-economy-panel-open-studio]')) { void window.FHCCEconomyPanelStudio.open({ state, setView, refreshConfig, loadStudioTemplate, renderDrafts, toast }); return; }
    const vipPanelsRefresh = event.target.closest('[data-vip-panels-refresh]');
    if (vipPanelsRefresh) {
      void refreshVipPanels();
      return;
    }
    const vipDmStudio = event.target.closest('[data-vip-dm-studio]');
    if (vipDmStudio) {
      void openVipDmStudio(String(vipDmStudio.dataset.vipDmStudio || 'giftReceived'));
      return;
    }
    const vipSeparatorSync = event.target.closest('[data-vip-separator-sync]');
    if (vipSeparatorSync) {
      void runVipSeparatorSync(vipSeparatorSync);
      return;
    }
    const activityRankingMetric = event.target.closest('[data-activity-race-ranking-metric]');
    if (activityRankingMetric) {
      activityRaceRankingMetric = activityRankingMetric.dataset.activityRaceRankingMetric === 'voice' ? 'voice' : 'chat';
      renderActivityRaceFullRanking();
      return;
    }
    const pcvStudio = event.target.closest('[data-pcv-open-studio]');
    if (pcvStudio) {
      void openPublicCallVoteStudio(String(pcvStudio.dataset.pcvOpenStudio || 'panel'));
      return;
    }
    const countingDmStudio = event.target.closest('[data-counting-open-dm-studio]');
    if (countingDmStudio) {
      void FHCCCountingPanel.openDmStudio(String(countingDmStudio.dataset.countingOpenDmStudio || 'strikeLock'));
      return;
    }
    const countingUnlock = event.target.closest('[data-counting-unlock]');
    if (countingUnlock) {
      void FHCCCountingPanel.unlockPlayer(String(countingUnlock.dataset.countingUnlock || ''));
      return;
    }
    const pcvUnlock = event.target.closest('[data-pcv-unlock]');
    if (pcvUnlock) {
      void unlockPublicCallVotePlayer(String(pcvUnlock.dataset.pcvUnlock || ''));
      return;
    }
    const activityStudio = event.target.closest('[data-activity-race-open-studio]');
    if (activityStudio) {
      void openActivityRaceStudio(String(activityStudio.dataset.activityRaceOpenStudio || 'daily'));
      return;
    }
    const activityRolePreview = event.target.closest('[data-activity-race-role-preview]');
    if (activityRolePreview) {
      void prepareActivityRaceRoles(activityRolePreview);
      return;
    }
    const activityRefresh = event.target.closest('[data-activity-race-refresh]');
    if (activityRefresh) {
      void refreshActivityRacePanel(activityRefresh);
      return;
    }
    const forumCleanerScan = event.target.closest('[data-forum-cleaner-scan]');
    if (forumCleanerScan) {
      void startForumCleanerScan(forumCleanerScan);
      return;
    }
    const steamWorkshopStudio = event.target.closest('[data-steam-workshop-studio]');
    if (steamWorkshopStudio) {
      void openSteamWorkshopStudio();
      return;
    }
    const steamWorkshopEditItem = event.target.closest('[data-steam-workshop-edit-item]');
    if (steamWorkshopEditItem) {
      void openSteamWorkshopItemStudio(steamWorkshopEditItem.dataset.steamWorkshopEditItem);
      return;
    }
    const steamWorkshopResetItem = event.target.closest('[data-steam-workshop-reset-item]');
    if (steamWorkshopResetItem) {
      void resetSteamWorkshopItemFromPanel(steamWorkshopResetItem.dataset.steamWorkshopResetItem, steamWorkshopResetItem);
      return;
    }
    const steamWorkshopSync = event.target.closest('[data-steam-workshop-sync]');
    if (steamWorkshopSync) {
      void syncSteamWorkshopFromPanel(steamWorkshopSync);
      return;
    }
    const emojiPreviewAction = event.target.closest('[data-emoji-preview-action]');
    if (emojiPreviewAction) {
      void previewEmojiRenameFromPanel(emojiPreviewAction);
      return;
    }
    const emojiApplyAction = event.target.closest('[data-emoji-apply-action]');
    if (emojiApplyAction) {
      void applyEmojiRenameFromPanel(emojiApplyAction);
      return;
    }
    const publicCallVoteRefresh = event.target.closest('[data-refresh-public-call-vote]');
    if (publicCallVoteRefresh) {
      void refreshPublicCallVoteStatus();
      return;
    }
    const voiceCleanerRefresh = event.target.closest('[data-refresh-voice-cleaner]');
    if (voiceCleanerRefresh) {
      void refreshVoiceChatCleanerStatus();
      return;
    }
    const voiceLogEventsLoad = event.target.closest('[data-voice-log-events-load]');
    if (voiceLogEventsLoad) {
      void loadVoiceLogEvents(true);
      return;
    }
    const tempVoiceRefresh = event.target.closest('[data-refresh-temp-voice]');
    if (tempVoiceRefresh) {
      void tempVoiceUi.refreshStatus();
      return;
    }
    const serverTagSync = event.target.closest('[data-sync-server-tags]');
    if (serverTagSync) {
      void startServerTagTrackerSync(serverTagSync);
      return;
    }
    const backupAction = event.target.closest('[data-server-backup-action]');
    if (backupAction) {
      const action = backupAction.dataset.serverBackupAction;
      if (action === 'create') void createServerBackupNow(backupAction);
      else if (action === 'refresh') void refreshServerBackups();
      return;
    }
    const backupRestore = event.target.closest('[data-server-backup-restore]');
    if (backupRestore) {
      void restoreServerBackupFromButton(backupRestore);
      return;
    }
    const syncButton = event.target.closest('[data-sync-boost-roles]');
    if (syncButton) {
      if (state.moduleDirty) {
        toast('Speichere zuerst deine Änderungen, bevor du den Abgleich startest.', 'info');
        return;
      }
      syncButton.disabled = true;
      syncButton.textContent = 'Wird gestartet …';
      void api.apiRequest({ path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/boost-role-sync', method: 'POST' }).then(function (response) {
        if (!response.ok) throw new Error(response.data?.error || 'Abgleich konnte nicht gestartet werden.');
        toast(response.data?.result?.queued ? 'Booster-Abgleich wurde in die laufende Prüfung eingereiht.' : 'Booster-Abgleich wurde gestartet.', 'success');
        setTimeout(function () { void refreshBoostProgress(); }, 500);
      }).catch(function (error) {
        toast(String(error?.message || error), 'error');
      }).finally(function () {
        syncButton.disabled = false;
        syncButton.textContent = 'Jetzt abgleichen';
      });
      return;
    }
    if (event.target.closest('#discard-module-fields')) {
      renderModuleConfig({ force: true });
      return;
    }
    const clearSelection = event.target.closest('[data-clear-role-selection]');
    if (clearSelection) {
      const multi = clearSelection.closest('.module-role-multi');
      multi.querySelectorAll('[data-role-choice]:checked').forEach(function (choice) { choice.checked = false; });
      updateRoleMultiState(multi);
      setModuleDirty(true);
      return;
    }
    const clearChannels = event.target.closest('[data-clear-channel-selection]');
    if (clearChannels) {
      const multi = clearChannels.closest('.module-channel-multi');
      multi.querySelectorAll('[data-channel-choice]:checked').forEach(function (choice) { choice.checked = false; });
      updateChannelMultiState(multi);
      setModuleDirty(true);
      return;
    }
    const emojiButton = event.target.closest('[data-open-emoji-picker]');
    if (emojiButton) {
      const target = emojiButton.closest('.module-emoji-control')?.querySelector('[data-emoji-input]');
      if (target) openMessageEmojiPicker(target);
      return;
    }
    const addButton = event.target.closest('[data-add-role-mapping]');
    if (addButton) {
      const rows = addButton.closest('.module-role-mapping').querySelector('.module-role-map-rows');
      const counts = Array.from(rows.querySelectorAll('[data-role-count]')).map(function (input) { return Number(input.value || 0); });
      const kind = addButton.closest('.module-role-mapping')?.dataset.mappingKind || 'boost';
      rows.insertAdjacentHTML('beforeend', FHCCModuleConfigInputs.roleMappingRow({ count: Math.max(0, ...counts) + 1 }, kind));
      setModuleDirty(true);
      return;
    }
    const removeButton = event.target.closest('[data-remove-role-mapping]');
    if (removeButton) {
      const row = removeButton.closest('.module-role-map-row');
      const rows = row.parentElement;
      if (rows.querySelectorAll('.module-role-map-row').length > 1) row.remove();
      else row.querySelector('[data-role-id]').value = '';
      setModuleDirty(true);
    }
  };
}

function makeId(prefix) {
  return (prefix || 'id') + '-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
}

function studioStorageKey(guildId) {
  return 'fh-studio-sent:' + String(guildId || 'global');
}

function loadStudioMessages(guildId) {
  try {
    state.studioMessages = readLocalJson(studioStorageKey(guildId), []);
  } catch {
    state.studioMessages = [];
  }
  state.activeStudioMessageId = '';
  state.studioSourceMessage = null;
}

function persistStudioMessages() {
  localStorage.setItem(studioStorageKey(state.selectedGuildId), JSON.stringify(state.studioMessages.slice(0, 80).map(makeStudioTemplateStorageSafe)));
}

const studioChannelCache = new Map();
const studioChannelLoads = new Map();
let studioOutsideImageRemovalRequested = false;
let studioOutsideImageExistingAttachment = false;
let studioOutsideImageAttachment = null;
let studioOutsideImagePickedDataUrl = '';

function studioChannelStorageKey(guildId) {
  return 'fh-studio-channels:v2:' + String(guildId || 'global');
}

function readStoredStudioChannels(guildId) {
  try {
    const parsed = readLocalJson(studioChannelStorageKey(guildId), null);
    if (!parsed || !Array.isArray(parsed.channels)) return null;
    return {
      channels: parsed.channels.filter(function (channel) { return channel && channel.id && channel.name; }),
      loadedAt: Number(parsed.loadedAt || 0)
    };
  } catch (_error) {
    return null;
  }
}

function storeStudioChannels(guildId, channels) {
  try {
    localStorage.setItem(studioChannelStorageKey(guildId), JSON.stringify({
      loadedAt: Date.now(),
      channels: Array.isArray(channels) ? channels : []
    }));
  } catch (_error) {}
}

function moduleChannelsFrom(channels) {
  return (Array.isArray(channels) ? channels : []).filter(function (channel) {
    return channel && channel.isThread !== true && ![10, 11, 12].includes(Number(channel.type));
  });
}

async function refreshModuleChannelResources(guildId) {
  guildId = String(guildId || '').trim();
  if (!guildId || !state.authenticated) return false;
  const response = await loadStudioChannels(guildId, { fresh: true });
  if (!response?.ok || String(state.selectedGuildId || '') !== guildId) return false;
  const nextChannels = moduleChannelsFrom(response.channels);
  const previousSignature = state.moduleChannels.map(function (channel) {
    return [channel.id, channel.displayOrder, channel.parentId, channel.name, channel.type].join(':');
  }).join('|');
  const nextSignature = nextChannels.map(function (channel) {
    return [channel.id, channel.displayOrder, channel.parentId, channel.name, channel.type].join(':');
  }).join('|');
  state.moduleChannels = nextChannels;
  if (previousSignature !== nextSignature && !state.moduleDirty && state.activeView === 'modules') {
    renderModuleConfig({ force: true });
  }
  return true;
}

async function loadStudioChannels(guildId, options) {
  guildId = String(guildId || '').trim();
  const fresh = options?.fresh === true;
  const select = document.getElementById('studio-channel');
  if (select?.value) state.selectedStudioChannelId = select.value;
  if (!state.authenticated || !guildId) {
    state.studioChannels = [];
    renderStudioChannels();
    return;
  }

  let cached = studioChannelCache.get(guildId);
  if (!cached) {
    cached = readStoredStudioChannels(guildId);
    if (cached?.channels?.length) studioChannelCache.set(guildId, cached);
  }
  if (!fresh && cached && Date.now() - cached.loadedAt < 30 * 1000) {
    state.studioChannels = cached.channels;
    renderStudioChannels();
    return { ok: true, channels: cached.channels, cached: true };
  }
  if (cached?.channels?.length) {
    state.studioChannels = cached.channels;
    renderStudioChannels();
  }
  if (studioChannelLoads.has(guildId)) return studioChannelLoads.get(guildId);
  if (!cached && select) select.innerHTML = '<option value="">Kanäle werden geladen ...</option>';

  const load = (async function () {
    const response = await apiRequestWithRetry({
      path: '/api/guild/' + encodeURIComponent(guildId) + '/channels' + (fresh ? '?fresh=1' : ''),
      timeoutMs: 10000
    }, 5);
    if (!response.ok) {
      if (handleExpiredSession(response)) {
        if (select) select.innerHTML = '<option value="">Bitte erneut anmelden</option>';
        return { ok: false, status: 401 };
      }
      if (cached) {
        state.studioChannels = cached.channels;
        renderStudioChannels();
        return { ok: true, channels: cached.channels, cached: true, stale: true };
      } else if (select) {
        select.innerHTML = '<option value="">' + escapeHtml(response.data?.error || 'Kanäle konnten nicht geladen werden.') + '</option>';
      }
      return { ok: false };
    }
    const channels = Array.isArray(response.data.channels) ? response.data.channels : [];
    studioChannelCache.set(guildId, { channels, loadedAt: Date.now() });
    storeStudioChannels(guildId, channels);
    if (String(state.selectedGuildId || '') === guildId) {
      state.studioChannels = channels;
      renderStudioChannels();
    }
    return { ok: true, channels };
  })().finally(function () {
    studioChannelLoads.delete(guildId);
  });

  studioChannelLoads.set(guildId, load);
  return load;
}

function renderStudioChannels() {
  const select = document.getElementById('studio-channel');
  const parentSelect = document.getElementById('thread-parent-channel');
  if (!select) return;
  const current = select.value || state.selectedStudioChannelId;
  const studioTargets = state.studioChannels.filter(function (channel) {
    return channel?.isCategory !== true && Number(channel?.type) !== 4 && [0, 2, 5, 13, 15, 16].includes(Number(channel?.type));
  });
  if (!studioTargets.length) {
    select.innerHTML = '<option value="">Keine Textkanäle gefunden</option>';
    if (parentSelect) parentSelect.innerHTML = '<option value="">Keine Parent-Kanäle gefunden</option>';
    return;
  }
  const fillDiscordOrderedSelect = function (target, channels, placeholder) {
    const fragment = document.createDocumentFragment();
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = placeholder;
    fragment.append(empty);
    const groups = new Map();
    channels.forEach(function (channel) {
      const key = String(channel.categoryId || 'uncategorized');
      if (!groups.has(key)) {
        const group = document.createElement('optgroup');
        group.label = String(channel.categoryName || 'OHNE KATEGORIE').toUpperCase();
        groups.set(key, group);
        fragment.append(group);
      }
      const option = document.createElement('option');
      option.value = channel.id;
      const flags = [
        channel.isForumLike && !channel.isThread ? (channel.isMedia ? 'Media-Forum' : 'Forum') : '',
        channel.requiresTag ? 'Tag erforderlich' : '',
        channel.archived ? 'archiviert' : '',
        channel.locked ? 'gesperrt' : ''
      ].filter(Boolean).join(', ');
      option.textContent = (channel.isThread ? '    ↳ ' : channel.isForumLike ? '▣ ' : Number(channel.type) === 2 || Number(channel.type) === 13 ? '◉ ' : '# ') + channel.name + (flags ? ' (' + flags + ')' : '');
      groups.get(key).append(option);
    });
    target.replaceChildren(fragment);
  };
  fillDiscordOrderedSelect(select, studioTargets, 'Kanal auswählen');
  if (parentSelect) {
    const parentCurrent = parentSelect.value;
    const parents = studioTargets.filter(function (channel) { return !channel.isThread && [0, 5, 15, 16].includes(Number(channel.type)); });
    fillDiscordOrderedSelect(parentSelect, parents, 'Parent-Channel auswählen');
    if (parents.some(function (channel) { return channel.id === parentCurrent; })) parentSelect.value = parentCurrent;
  }
  if (studioTargets.some(function (channel) { return channel.id === current; })) {
    select.value = current;
    state.selectedStudioChannelId = current;
  }
  renderForumPostControls();
  updatePreview();
}

let channelStructureRefreshTimer = null;
window.addEventListener('fallen-heaven:channel-structure-update', function (event) {
  const events = Array.isArray(event.detail) ? event.detail : [];
  const guildId = String(state.selectedGuildId || '');
  const affectedGuildIds = new Set(events.map(function (item) { return String(item?.guildId || ''); }).filter(Boolean));
  affectedGuildIds.forEach(function (id) {
    studioChannelCache.delete(id);
    try { localStorage.removeItem(studioChannelStorageKey(id)); } catch (_error) {}
  });
  if (!guildId || !affectedGuildIds.has(guildId)) return;
  clearTimeout(channelStructureRefreshTimer);
  channelStructureRefreshTimer = setTimeout(async function () {
    await refreshModuleChannelResources(guildId);
  }, 320);
});


function studioChannelMeta(channelId) {
  const id = String(channelId || '').trim();
  return state.studioChannels.find(function (channel) { return String(channel.id) === id; }) || null;
}

function isForumPostTarget(channel) {
  return Boolean(channel?.isForumLike && !channel?.isThread);
}

function selectedForumPostChannel() {
  const selected = studioChannelMeta(document.getElementById('studio-channel')?.value || state.selectedStudioChannelId);
  if (isForumPostTarget(selected)) return selected;
  const parent = studioChannelMeta(document.getElementById('thread-parent-channel')?.value || '');
  return isForumPostTarget(parent) ? parent : null;
}

function selectedForumPostTagIds() {
  return Array.from(document.querySelectorAll('#forum-post-options [data-forum-tag]:checked'))
    .map(function (input) { return String(input.value || '').trim(); })
    .filter(Boolean)
    .slice(0, 5);
}

function forumPostTitleFromTemplate(template = {}, channel = null) {
  const typed = String(document.getElementById('thread-name')?.value || '').trim();
  if (typed) return typed.slice(0, 100);
  const embedTitle = String(template.embed?.title || template.embeds?.[0]?.title || '').trim();
  if (embedTitle) return embedTitle.slice(0, 100);
  const firstLine = String(template.content || '').split(/\r?\n/).find(function (line) { return line.trim(); }) || '';
  if (firstLine.trim()) return firstLine.trim().slice(0, 100);
  return (channel?.isMedia ? 'Neuer Media-Post' : 'Neuer Forum-Post');
}

function renderForumPostControls() {
  const grid = document.querySelector('.thread-section .form-grid');
  if (!grid) return;
  let panel = document.getElementById('forum-post-options');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'forum-post-options';
    panel.className = 'forum-post-options full';
    grid.append(panel);
  }

  const selectedChannel = studioChannelMeta(document.getElementById('studio-channel')?.value || state.selectedStudioChannelId);
  const forumChannel = selectedForumPostChannel();
  const directForumSend = isForumPostTarget(selectedChannel);
  const sendLabels = directForumSend
    ? ['Forum-Post erstellen', 'Forum-Post erstellen']
    : ['Mit Bot senden', 'Mit Bot senden'];
  [document.getElementById('send-studio-message'), document.getElementById('send-studio-message-secondary')].forEach(function (button, index) {
    if (button && !button.disabled) button.textContent = sendLabels[index] || sendLabels[0];
  });

  if (!forumChannel) {
    panel.hidden = true;
    panel.innerHTML = '';
    return;
  }

  const previous = new Set(selectedForumPostTagIds());
  const tags = Array.isArray(forumChannel.availableTags) ? forumChannel.availableTags : [];
  panel.hidden = false;
  panel.innerHTML = '<div class="forum-post-options-head"><span><b>' + (directForumSend ? 'Forum-Post Versand aktiv' : 'Forum-Thread Startpost') + '</b><small>' + escapeHtml(forumChannel.name || 'Forum') + (forumChannel.requiresTag ? ' · Tag erforderlich' : ' · Tags optional') + '</small></span><em>STARTPOST MIT EMBED</em></div>'
    + (tags.length
      ? '<div class="forum-tag-grid">' + tags.map(function (tag) {
        const checked = previous.has(String(tag.id)) ? ' checked' : '';
        const icon = tag.emojiName || 'Tag';
        return '<label class="forum-tag-choice"><input type="checkbox" data-forum-tag value="' + escapeHtml(tag.id) + '"' + checked + '><span><i>' + escapeHtml(icon) + '</i><b>' + escapeHtml(tag.name) + '</b>' + (tag.moderated ? '<small>moderiert</small>' : '') + '</span></label>';
      }).join('') + '</div>'
      : '<p class="forum-post-note">Dieses Forum hat keine auswählbaren Tags hinterlegt.</p>')
    + '<p class="forum-post-note">Wenn oben als Ziel ein Forum ausgewählt ist, erstellt „Forum-Post erstellen“ direkt einen neuen Post. Der Post-Titel kommt aus „Thread-Name“, sonst aus dem Embed-Titel.</p>';
}

function validImageUrl(value) {
  return /^(?:https?:\/\/|data:image\/(?:png|jpe?g|webp|gif);base64,)/i.test(String(value || '').trim());
}

function normalizeOutsideImageAttachment(value) {
  if (!value || typeof value !== 'object') return null;
  const localAsset = value.localAsset === true;
  if (!localAsset && !validImageUrl(value.url)) return null;
  return {
    id: String(value.id || ''),
    url: String(value.url || ''),
    name: String(value.name || value.filename || 'Bild-Anhang'),
    size: Math.max(0, Number(value.size || 0)),
    contentType: String(value.contentType || value.content_type || ''),
    mime: String(value.mime || ''),
    localAsset
  };
}

function makeStudioTemplateStorageSafe(value) {
  const safe = clone(value);
  const cleanTemplate = function (template) {
    if (!template || typeof template !== 'object') return;
    if (/^data:image\//i.test(String(template.outsideImageUrl || ''))) {
      template.outsideImageUrl = '';
      template.outsideImageNeedsReselect = !normalizeOutsideImageAttachment(template.outsideImageAttachment);
    }
    const embeds = Array.isArray(template.embeds) ? template.embeds : template.embed ? [template.embed] : [];
    embeds.forEach(function (embed) {
      if (/^data:image\//i.test(String(embed?.outsideImageUrl || ''))) {
        embed.outsideImageUrl = '';
        embed.outsideImageNeedsReselect = true;
      }
    });
  };
  cleanTemplate(safe?.template || safe);
  return safe;
}

function updateOutsideImagePicker() {
  const data = document.getElementById('studio-outside-image')?.value || '';
  const name = document.getElementById('studio-outside-image-name')?.value || '';
  const size = Number(document.getElementById('studio-outside-image-size')?.value || 0);
  const label = document.getElementById('studio-outside-image-label');
  const meta = document.getElementById('studio-outside-image-meta');
  const remove = document.getElementById('studio-outside-image-remove');
  const attachmentName = String(studioOutsideImageAttachment?.name || '');
  const attachmentSize = Number(studioOutsideImageAttachment?.size || 0);
  if (label) label.textContent = name || (data ? 'Ausgewähltes Bild' : studioOutsideImageExistingAttachment ? (attachmentName || 'Bereits gesendeter Bild-Anhang') : 'Kein Bild ausgewählt');
  if (meta) meta.textContent = data
    ? ((size / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 2 }) + ' MB · wird als Discord-Anhang gesendet')
    : studioOutsideImageExistingAttachment
      ? ((attachmentSize ? (attachmentSize / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 2 }) + ' MB · ' : '') + 'gespeicherter Discord-Anhang kann entfernt oder ersetzt werden')
      : 'PNG, JPG, WEBP oder GIF · maximal 25 MB';
  if (remove) remove.disabled = !data && !studioOutsideImageExistingAttachment;
}

function clearOutsideImage() {
  studioOutsideImageRemovalRequested = true;
  studioOutsideImageExistingAttachment = false;
  studioOutsideImageAttachment = null;
  studioOutsideImagePickedDataUrl = '';
  ['studio-outside-image', 'studio-outside-image-name', 'studio-outside-image-size'].forEach(function (id) {
    const node = document.getElementById(id);
    if (node) node.value = '';
  });
  const file = document.getElementById('studio-outside-image-file');
  if (file) file.value = '';
  updateOutsideImagePicker();
  updatePreview();
}

async function selectOutsideImageFile(file) {
  if (!file) return;
  if (!/^image\/(?:png|jpe?g|webp|gif)$/i.test(String(file.type || ''))) { toast('Bitte wähle eine PNG-, JPG-, WEBP- oder GIF-Datei.', 'error'); return; }
  if (file.size > 25 * 1024 * 1024) { toast('Das Außenbild darf maximal 25 MB groß sein.', 'error'); return; }
  const dataUrl = await new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () { resolve(String(reader.result || '')); };
    reader.onerror = function () { reject(new Error('Bild konnte nicht gelesen werden.')); };
    reader.readAsDataURL(file);
  }).catch(function (error) {
    toast(error.message, 'error');
    return '';
  });
  if (!dataUrl) return;
  studioOutsideImageRemovalRequested = false;
  studioOutsideImagePickedDataUrl = dataUrl;
  // Das Bild wird einmal auf den PC geladen (lokal gespeichert). Der Save
  // schickt danach nur noch die kleine lokale Referenz statt des Riesen-
  // Data-URLs – so gibt es keinen „ungültiges Embed-Bild“-Fehler mehr und
  // nichts landet in einem Discord-Kanal.
  if (state.authenticated && state.selectedGuildId) {
    try {
      const upload = await api.apiRequest({
        path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/studio-image',
        method: 'POST',
        body: { dataUrl, name: file.name },
        timeoutMs: 120000
      });
      if (!upload?.ok || !upload.data?.result?.attachment?.localAsset) {
        throw new Error(upload?.data?.error || 'Das Bild konnte nicht gespeichert werden.');
      }
      studioOutsideImageAttachment = {
        localAsset: true,
        id: String(upload.data.result.attachment.id || ''),
        name: String(upload.data.result.attachment.name || file.name),
        size: Number(upload.data.result.attachment.size || 0),
        mime: String(upload.data.result.attachment.mime || file.type || '')
      };
    } catch (error) {
      toast(String(error?.message || error), 'error');
      return;
    }
  }
  const outsideImage = document.getElementById('studio-outside-image');
  const outsideImageName = document.getElementById('studio-outside-image-name');
  const outsideImageSize = document.getElementById('studio-outside-image-size');
  if (outsideImage) outsideImage.value = dataUrl;
  if (outsideImageName) outsideImageName.value = file.name;
  if (outsideImageSize) outsideImageSize.value = String(file.size);
  updateOutsideImagePicker();
  updatePreview();
}

function fieldRow(field, index) {
  return '<article class="studio-field-row" data-field-index="' + index + '">' +
    '<label>Name<input data-field-name value="' + escapeHtml(field.name || '') + '" maxlength="256" placeholder="Feldname"></label>' +
    '<label>Wert<textarea data-field-value maxlength="1024" rows="3" placeholder="Feldinhalt">' + escapeHtml(field.value || '') + '</textarea></label>' +
    '<label class="studio-check compact"><input data-field-inline type="checkbox" ' + (field.inline ? 'checked' : '') + '><span>Inline</span></label>' +
    '<button class="studio-field-remove" type="button" data-remove-field="' + index + '">Entfernen</button>' +
  '</article>';
}

function renderStudioFields() {
  const host = document.getElementById('studio-fields');
  if (!host) return;
  host.innerHTML = state.studioFields.length
    ? state.studioFields.map(fieldRow).join('')
    : '<p class="empty-drafts">Noch keine Felder. Füge Felder hinzu, wenn du strukturierte Infos brauchst.</p>';
}

function syncStudioFieldsFromDom() {
  const rows = Array.from(document.querySelectorAll('.studio-field-row'));
  state.studioFields = rows.map(function (row) {
    return {
      name: row.querySelector('[data-field-name]')?.value || '',
      value: row.querySelector('[data-field-value]')?.value || '',
      inline: Boolean(row.querySelector('[data-field-inline]')?.checked)
    };
  }).filter(function (field) { return field.name.trim() || field.value.trim(); }).slice(0, 25);
}

function readStudioEmbedFromForm() {
  syncStudioFieldsFromDom();
  const previous = state.studioEmbeds[state.activeStudioEmbedIndex] || {};
  return {
    title: document.getElementById('studio-title')?.value || '',
    url: document.getElementById('studio-url')?.value || '',
    description: document.getElementById('studio-description')?.value || '',
    color: document.getElementById('studio-color')?.value || '#58b9ff',
    authorName: document.getElementById('studio-author-name')?.value || '',
    authorIconUrl: document.getElementById('studio-author-icon')?.value || '',
    thumbnailUrl: document.getElementById('studio-thumbnail')?.value || '',
    imageUrl: document.getElementById('studio-image')?.value || '',
    footerText: document.getElementById('studio-signature')?.value || '',
    footerIconUrl: document.getElementById('studio-footer-icon')?.value || '',
    timestamp: document.getElementById('studio-timestamp')?.checked !== false,
    timestampValue: previous.timestampValue || '',
    fields: clone(state.studioFields)
  };
}

function normalizeStudioEmbed(embed = {}) {
  return {
    title: embed.title || '',
    url: embed.url || '',
    description: embed.description || '',
    color: embed.color || '#58b9ff',
    authorName: embed.authorName || '',
    authorIconUrl: embed.authorIconUrl || '',
    thumbnailUrl: embed.thumbnailUrl || '',
    imageUrl: embed.imageUrl || '',
    footerText: Object.prototype.hasOwnProperty.call(embed, 'footerText') ? embed.footerText : 'FALLEN HEAVEN',
    footerIconUrl: embed.footerIconUrl || '',
    timestamp: embed.timestamp !== false,
    timestampValue: embed.timestampValue || '',
    fields: Array.isArray(embed.fields) ? clone(embed.fields).slice(0, 25) : []
  };
}

function syncActiveStudioEmbed() {
  if (!state.studioEmbeds.length) state.studioEmbeds = [normalizeStudioEmbed()];
  state.studioEmbeds[state.activeStudioEmbedIndex] = readStudioEmbedFromForm();
}

function renderStudioEmbedTabs() {
  const host = document.getElementById('studio-embed-tabs');
  if (!host) return;
  host.innerHTML = state.studioEmbeds.map(function (embed, index) {
    const fieldCount = Array.isArray(embed.fields) ? embed.fields.length : 0;
    return '<button type="button" class="' + (index === state.activeStudioEmbedIndex ? 'active' : '') + '" data-studio-embed-tab="' + index + '">Embed ' + (index + 1) + '<small>' + fieldCount + ' Felder</small></button>';
  }).join('');
  const add = document.getElementById('add-studio-embed');
  const remove = document.getElementById('remove-studio-embed');
  const flexibleActivityInfo = state.studioSpecialTemplate === 'activityRace' && state.studioActivityRaceSection === 'ping-info';
  const fixedAutomationEmbed = Boolean(state.studioSpecialTemplate && state.studioSpecialTemplate !== 'economyPanel' && !flexibleActivityInfo);
  if (add) add.disabled = fixedAutomationEmbed || state.studioEmbeds.length >= 10;
  if (remove) remove.disabled = fixedAutomationEmbed || state.studioEmbeds.length <= 1;
  const count = document.getElementById('studio-embed-count');
  if (count) count.textContent = state.studioEmbeds.length + '/10 Embeds';
}

function writeStudioEmbedToForm(embed) {
  const data = normalizeStudioEmbed(embed);
  const setValue = function (id, value) {
    const node = document.getElementById(id);
    if (node) node.value = value || '';
  };
  setValue('studio-title', data.title);
  setValue('studio-url', data.url);
  setValue('studio-description', data.description);
  setValue('studio-color', data.color);
  setValue('studio-signature', data.footerText);
  setValue('studio-author-name', data.authorName);
  setValue('studio-author-icon', data.authorIconUrl);
  setValue('studio-thumbnail', data.thumbnailUrl);
  setValue('studio-image', data.imageUrl);
  setValue('studio-footer-icon', data.footerIconUrl);
  const timestamp = document.getElementById('studio-timestamp');
  if (timestamp) timestamp.checked = data.timestamp !== false;
  state.studioFields = clone(data.fields);
  renderStudioFields();
}

const DISCORD_STUDIO_LIMITS = Object.freeze({
  content: 2000,
  embeds: 10,
  totalEmbedCharacters: 6000,
  title: 256,
  description: 4096,
  fields: 25,
  fieldName: 256,
  fieldValue: 1024,
  footer: 2048,
  author: 256
});

function studioTextLength(value) {
  return String(value || '').length;
}

function countStudioEmbedCharacters(embed = {}) {
  return studioTextLength(embed.title)
    + studioTextLength(embed.description)
    + studioTextLength(embed.authorName)
    + studioTextLength(embed.footerText)
    + (Array.isArray(embed.fields) ? embed.fields : []).reduce(function (total, field) {
      return total + studioTextLength(field?.name) + studioTextLength(field?.value);
    }, 0);
}

function validateStudioTemplate(template = {}) {
  const embeds = Array.isArray(template.embeds) && template.embeds.length ? template.embeds : [template.embed || {}];
  const contentLength = studioTextLength(template.content);
  const totalEmbedCharacters = embeds.reduce(function (total, embed) { return total + countStudioEmbedCharacters(embed); }, 0);
  const activeEmbed = embeds[state.activeStudioEmbedIndex] || embeds[0] || {};
  const activeFieldCount = Array.isArray(activeEmbed.fields) ? activeEmbed.fields.length : 0;
  const errors = [];

  if (contentLength > DISCORD_STUDIO_LIMITS.content) errors.push('Die Nachricht über dem Embed darf maximal 2.000 Zeichen enthalten.');
  if (embeds.length > DISCORD_STUDIO_LIMITS.embeds) errors.push('Discord erlaubt maximal 10 Embeds pro Nachricht.');
  if (totalEmbedCharacters > DISCORD_STUDIO_LIMITS.totalEmbedCharacters) errors.push('Alle Embeds zusammen dürfen maximal 6.000 Zeichen enthalten.');

  embeds.forEach(function (embed, index) {
    const label = 'Embed ' + (index + 1);
    const fields = Array.isArray(embed.fields) ? embed.fields : [];
    if (studioTextLength(embed.title) > DISCORD_STUDIO_LIMITS.title) errors.push(label + ': Der Titel darf maximal 256 Zeichen enthalten.');
    if (studioTextLength(embed.description) > DISCORD_STUDIO_LIMITS.description) errors.push(label + ': Die Beschreibung darf maximal 4.096 Zeichen enthalten.');
    if (studioTextLength(embed.authorName) > DISCORD_STUDIO_LIMITS.author) errors.push(label + ': Der Autor darf maximal 256 Zeichen enthalten.');
    if (studioTextLength(embed.footerText) > DISCORD_STUDIO_LIMITS.footer) errors.push(label + ': Der Footer darf maximal 2.048 Zeichen enthalten.');
    if (fields.length > DISCORD_STUDIO_LIMITS.fields) errors.push(label + ': Es sind maximal 25 Felder erlaubt.');
    fields.forEach(function (field, fieldIndex) {
      if (studioTextLength(field?.name) > DISCORD_STUDIO_LIMITS.fieldName) errors.push(label + ', Feld ' + (fieldIndex + 1) + ': Der Name darf maximal 256 Zeichen enthalten.');
      if (studioTextLength(field?.value) > DISCORD_STUDIO_LIMITS.fieldValue) errors.push(label + ', Feld ' + (fieldIndex + 1) + ': Der Wert darf maximal 1.024 Zeichen enthalten.');
    });
  });

  return {
    valid: errors.length === 0,
    errors,
    contentLength,
    totalEmbedCharacters,
    embedCount: embeds.length,
    activeFieldCount
  };
}

function renderStudioLimits(template) {
  const result = validateStudioTemplate(template);
  const status = document.getElementById('studio-limit-status');
  if (status) {
    const counters = [
      ['Nachricht', result.contentLength, DISCORD_STUDIO_LIMITS.content],
      ['Embed-Zeichen', result.totalEmbedCharacters, DISCORD_STUDIO_LIMITS.totalEmbedCharacters],
      ['Embeds', result.embedCount, DISCORD_STUDIO_LIMITS.embeds],
      ['Felder aktiv', result.activeFieldCount, DISCORD_STUDIO_LIMITS.fields]
    ];
    status.classList.toggle('invalid', !result.valid);
    status.title = result.errors.join('\n');
    status.innerHTML = counters.map(function (counter) {
      const over = counter[1] > counter[2] ? ' class="over"' : '';
      return '<span' + over + '><small>' + counter[0] + '</small><b>' + counter[1].toLocaleString('de-DE') + ' / ' + counter[2].toLocaleString('de-DE') + '</b></span>';
    }).join('');
  }
  const addFieldButton = document.getElementById('add-embed-field');
  if (addFieldButton) {
    addFieldButton.disabled = result.activeFieldCount >= DISCORD_STUDIO_LIMITS.fields;
    addFieldButton.title = addFieldButton.disabled ? 'Discord erlaubt maximal 25 Felder pro Embed.' : '';
  }
  return result;
}

function renderStudioEmbedStack(template = {}) {
  const stack = document.getElementById('studio-embed-stack');
  if (!stack) return;
  const embeds = Array.isArray(template.embeds) && template.embeds.length ? template.embeds : [template.embed || {}];
  stack.replaceChildren();

  embeds.forEach(function (embed, index) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'studio-embed-stack-card' + (index === state.activeStudioEmbedIndex ? ' active' : '');
    card.dataset.stackEmbedIndex = String(index);
    card.setAttribute('aria-current', index === state.activeStudioEmbedIndex ? 'true' : 'false');

    const accent = document.createElement('i');
    accent.style.backgroundColor = embed.color || '#58b9ff';
    const number = document.createElement('span');
    number.textContent = 'EMBED';
    const copy = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = String(embed.title || 'Embed ' + (index + 1));
    const details = document.createElement('small');
    const fieldCount = Array.isArray(embed.fields) ? embed.fields.length : 0;
    details.textContent = countStudioEmbedCharacters(embed).toLocaleString('de-DE') + ' Zeichen · ' + fieldCount + ' Felder';
    copy.append(title, details);
    const action = document.createElement('b');
    action.textContent = index === state.activeStudioEmbedIndex ? 'Wird bearbeitet' : 'Bearbeiten';
    card.append(accent, number, copy, action);
    stack.append(card);
  });
}

function createStableEmbedPreview(embed = {}, index = 0) {
  const card = document.createElement('div');
  card.className = 'embed-preview stable-embed-preview' + (index === state.activeStudioEmbedIndex ? ' active' : '');
  card.dataset.previewEmbedIndex = String(index);
  card.title = 'Embed ' + (index + 1) + ' bearbeiten';

  const line = document.createElement('span');
  line.className = 'embed-line';
  line.style.backgroundColor = embed.color || '#58b9ff';
  const content = document.createElement('div');
  content.className = 'embed-content';

  if (embed.authorName || embed.authorIconUrl) {
    const author = document.createElement('div');
    author.className = 'embed-author';
    if (embed.authorIconUrl) {
      const icon = document.createElement('img');
      icon.src = embed.authorIconUrl;
      icon.alt = '';
      author.append(icon);
    }
    const name = document.createElement('span');
    name.textContent = embed.authorName || '';
    author.append(name);
    content.append(author);
  }

  if (embed.title) {
    const heading = document.createElement('h3');
    if (/^https?:\/\//i.test(String(embed.url || ''))) {
      const link = document.createElement('a');
      link.href = embed.url;
      link.innerHTML = studioEmojiHtml(embed.title);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      heading.append(link);
    } else {
      heading.innerHTML = studioEmojiHtml(embed.title);
    }
    content.append(heading);
  }

  if (embed.description) {
    const description = document.createElement('p');
    description.innerHTML = studioRichText(embed.description);
    content.append(description);
  }

  const fields = Array.isArray(embed.fields) ? embed.fields : [];
  if (fields.length) {
    const fieldGrid = document.createElement('div');
    fieldGrid.className = 'embed-fields';
    fields.forEach(function (field) {
      const item = document.createElement('div');
      item.className = 'embed-field' + (field.inline ? ' inline' : '');
      const name = document.createElement('strong');
      if (state.studioSpecialTemplate === 'tempVoiceInterface') name.textContent = tempVoiceUi.plainPreview(field.name || '\u200b');
      else name.innerHTML = studioRichText(field.name || '\u200b');
      const value = document.createElement('span');
      value.innerHTML = studioRichText(field.value || '\u200b');
      item.append(name, value);
      fieldGrid.append(item);
    });
    content.append(fieldGrid);
  }

  if (embed.imageUrl) {
    const image = document.createElement('img');
    image.className = 'embed-image';
    image.src = embed.imageUrl;
    image.alt = '';
    content.append(image);
  }

  if (embed.footerText || embed.footerIconUrl || embed.timestamp !== false) {
    const footer = document.createElement('div');
    footer.className = 'embed-footer';
    if (embed.footerIconUrl) {
      const footerIcon = document.createElement('img');
      footerIcon.src = embed.footerIconUrl;
      footerIcon.alt = '';
      footer.append(footerIcon);
    }
    if (embed.footerText) {
      const footerText = document.createElement('span');
      if (state.studioSpecialTemplate === 'tempVoiceInterface') footerText.textContent = tempVoiceUi.plainPreview(embed.footerText);
      else footerText.innerHTML = studioRichText(embed.footerText);
      footer.append(footerText);
    }
    if (embed.timestamp !== false) {
      const time = document.createElement('time');
      time.textContent = 'Heute';
      footer.append(time);
    }
    content.append(footer);
  }

  if (embed.thumbnailUrl) {
    const thumbnail = document.createElement('img');
    thumbnail.className = 'embed-thumbnail';
    thumbnail.src = embed.thumbnailUrl;
    thumbnail.alt = '';
    content.append(thumbnail);
  }

  if (!content.childNodes.length) {
    const empty = document.createElement('p');
    empty.className = 'stable-embed-empty';
    empty.textContent = 'Leeres Embed';
    content.append(empty);
  }
  card.append(line, content);
  return card;
}


function renderStableStudioPreview(template = {}) {
  const stack = document.getElementById('preview-embed-stack');
  if (!stack) return;
  const embeds = Array.isArray(template.embeds) && template.embeds.length ? template.embeds : [template.embed || {}];
  stack.replaceChildren();
  embeds.forEach(function (embed, index) { stack.append(createStableEmbedPreview(embed, index)); });
}

function currentStudioTemplate() {
  syncActiveStudioEmbed();
  syncStudioReactionRolesFromDom();
  const embeds = clone(state.studioEmbeds).slice(0, 10);
  const result = {
    specialTemplate: state.studioSpecialTemplate || '',
    activityRaceUsePeriodColor: state.studioSpecialTemplate === 'activityRace' && state.studioActivityUsesPeriodColor,
    section: state.studioSpecialTemplate === 'activityRace' ? state.studioActivityRaceSection : '',
    workshopItemId: state.studioSpecialTemplate === 'steamWorkshop' ? state.studioWorkshopItemId : '',
    workshopItemTitle: state.studioSpecialTemplate === 'steamWorkshop' ? state.studioWorkshopItemTitle : '',
    workshopItemTokens: state.studioSpecialTemplate === 'steamWorkshop' && state.studioWorkshopItemTokens ? clone(state.studioWorkshopItemTokens) : null,
    workshopAssetMode: state.studioSpecialTemplate === 'steamWorkshop' ? state.studioWorkshopAssetMode : 'global',
    channelId: document.getElementById('studio-channel')?.value || state.selectedStudioChannelId || '',
    content: document.getElementById('studio-content')?.value || '',
    outsideImageUrl: studioOutsideImageAttachment?.localAsset
      ? ''
      : (studioOutsideImagePickedDataUrl || document.getElementById('studio-outside-image')?.value || ''),
    outsideImageName: document.getElementById('studio-outside-image-name')?.value || '',
    outsideImageSize: Number(document.getElementById('studio-outside-image-size')?.value || 0),
    outsideImageAttachment: studioOutsideImageAttachment ? clone(studioOutsideImageAttachment) : null,
    removeOutsideImage: studioOutsideImageRemovalRequested,
    messageId: state.activeStudioMessageId || '',
    embed: embeds[state.activeStudioEmbedIndex] || embeds[0],
    embeds,
    studioComponents: clone(state.studioComponents),
    componentSet: document.getElementById('studio-component-set')?.value || state.studioComponentSet || 'none',
    reactionRoles: clone(state.studioReactionRoles),
    forumPost: {
      name: String(document.getElementById('thread-name')?.value || '').trim(),
      appliedTags: selectedForumPostTagIds()
    }
  };
  if (state.studioSpecialTemplate === 'tempVoiceInterface') {
    result.channelId = '';
    result.embeds = embeds.slice(0, 1);
    result.embed = result.embeds[0] || normalizeStudioEmbed(tempVoiceUi.defaultStudioEmbed());
    result.studioComponents = [];
    result.componentSet = 'none';
    result.reactionRoles = [];
  }
  return result;
}

function normalizeStudioReactionRole(entry) {
  const data = entry || {};
  return {
    emoji: String(data.emoji || ''),
    emojiId: String(data.emojiId || data.id || ''),
    emojiName: String(data.emojiName || data.name || ''),
    animated: Boolean(data.animated),
    url: String(data.url || ''),
    count: Number(data.count || 0),
    roleId: String(data.roleId || ''),
    exclusive: data.exclusive !== false,
    group: String(data.group || 'reaction-colors')
  };
}


function studioRoleOptions(selected) {
  return ['<option value="">Rolle auswählen ...</option>'].concat(state.moduleRoles.map(function (role) {
    return '<option value="' + escapeHtml(role.id) + '" ' + (String(role.id) === String(selected) ? 'selected' : '') + '>' + escapeHtml(role.name) + '</option>';
  })).join('');
}

function renderStudioReactionRoles() {
  const host = document.getElementById('studio-reaction-role-list');
  const count = document.getElementById('studio-reaction-role-count');
  if (!host) return;
  if (count) count.textContent = state.studioReactionRoles.length + ' Button' + (state.studioReactionRoles.length === 1 ? '' : 's');
  host.innerHTML = state.studioReactionRoles.length ? state.studioReactionRoles.map(function (entry, index) {
    const emojiPreview = entry.url
      ? '<img src="' + escapeHtml(entry.url) + '" alt="">'
      : '<strong>' + escapeHtml(entry.emoji || entry.emojiName || '?') + '</strong>';
    const emojiName = entry.emojiName || entry.name || entry.emoji || 'Emoji auswählen';
    return '<div class="studio-reaction-role-row" data-reaction-role-row="' + index + '"><button class="studio-reaction-emoji-picker-button" type="button" data-pick-reaction-emoji="' + index + '"><span class="studio-reaction-emoji">' + emojiPreview + '</span><span class="studio-reaction-emoji-copy"><b>' + escapeHtml(emojiName) + '</b><small>Server- oder Bot-Emoji auswählen</small></span><span class="studio-reaction-picker-chevron">⌄</span><input type="hidden" data-reaction-emoji value="' + escapeHtml(entry.emoji || entry.emojiName) + '"></button><label>Zielrolle<select data-reaction-role-id>' + studioRoleOptions(entry.roleId) + '</select></label><label class="studio-reaction-exclusive"><input type="checkbox" data-reaction-exclusive ' + (entry.exclusive ? 'checked' : '') + '><span>Nur eine Rolle</span></label><button type="button" data-remove-reaction-role="' + index + '" aria-label="Entfernen">&times;</button></div>';
  }).join('') : '<div class="studio-reaction-empty"><b>Noch keine Rollen-Buttons</b><span>Übernimm eine bestehende Nachricht oder füge einen Button hinzu.</span></div>';
  renderStudioReactionPreview();
}

function syncStudioReactionRolesFromDom() {
  const rows = document.querySelectorAll('[data-reaction-role-row]');
  if (!rows.length) return;
  state.studioReactionRoles = Array.from(rows).map(function (row) {
    const previous = state.studioReactionRoles[Number(row.dataset.reactionRoleRow)] || {};
    return normalizeStudioReactionRole({
      ...previous,
      emoji: row.querySelector('[data-reaction-emoji]')?.value || '',
      roleId: row.querySelector('[data-reaction-role-id]')?.value || '',
      exclusive: Boolean(row.querySelector('[data-reaction-exclusive]')?.checked)
    });
  });
}

function renderStudioReactionPreview() {
  const host = document.getElementById('preview-reaction-roles');
  if (!host) return;
  host.innerHTML = state.studioReactionRoles.map(function (entry) {
    const preview = entry.url ? '<img src="' + escapeHtml(entry.url) + '" alt="">' : escapeHtml(entry.emoji || entry.emojiName || '?');
    const role = state.moduleRoles.find(function (item) { return String(item.id) === String(entry.roleId); });
    const label = role?.name || entry.emojiName || 'Rolle';
    return '<span class="function-button style-1">' + preview + '<b>' + escapeHtml(label) + '</b></span>';
  }).join('');
  host.hidden = !state.studioReactionRoles.length;
}

function renderStudioComponentSetPreview() {
  const select = document.getElementById('studio-component-set');
  const host = document.getElementById('preview-function-set');
  const status = document.getElementById('studio-function-set-status');
  const card = document.getElementById('studio-function-set-card');
  const selected = String(select?.value || state.studioComponentSet || 'none');
  state.studioComponentSet = selected;
  const active = selected === 'heavenEconomy';
  if (status) status.textContent = active ? 'VIP-SET AKTIV' : 'KEIN SET';
  card?.classList.toggle('active', active);
  if (!host) return;
  host.innerHTML = active
    ? ['Mein Konto', 'VIP-Shop', 'VIP verschenken'].concat(state.config?.heavenEconomy?.coinGiftsEnabled === false ? [] : ['Coins verschenken'], ['Coins kaufen', 'Boost-Fortschritt', 'Coin-Verwaltung'])
      .map(function (label, index) { return '<span class="function-button style-' + (index % 3) + '">' + escapeHtml(label) + '</span>'; }).join('')
    : '';
  host.hidden = !active;
}
function renderStudioComponentsPreview() {
  const host = document.getElementById('preview-imported-components') || document.getElementById('preview-function-set');
  if (state.studioSpecialTemplate === 'tempVoiceInterface') {
    if (!host) return;
    const config = state.config?.tempVoice || {};
    const labels = [];
    if (config?.allowRename !== false) labels.push('✏️');
    if (config?.allowLimit !== false) labels.push('🔢');
    if (config?.allowThreads !== false) labels.push('🧵');
    if (config?.allowRegion !== false) labels.push('🌍');
    if (config?.allowLock !== false) labels.push('🔒');
    labels.push('🚪', '👑');
    if (config?.allowTransfer !== false) labels.push('🔁');
    labels.push('🗑️');
    if (config?.rememberUserProfiles !== false) labels.push('↩️');
    host.innerHTML = labels
      .map(function (label, index) { return '<span class="function-button style-' + (index % 3) + '">' + label + '</span>'; }).join('');
    host.hidden = false;
    return;
  }
  window.FHCCStudioComponents.renderPreview(state.studioComponents, host);
}

function welcomeFarewellStudioTemplate(config) {
  const design = config?.welcomeTemplate || {};
  const sources = Array.isArray(design.embeds) && design.embeds.length
    ? design.embeds
    : [design.embed || studioTemplates.welcome.embed];
  return {
    specialTemplate: 'welcomeFarewell',
    channelId: String(config?.welcomeChannelId || ''),
    content: Object.prototype.hasOwnProperty.call(design, 'content') ? String(design.content || '') : '{user}',
    outsideImageUrl: String(design.outsideImageUrl || ''),
    outsideImageName: String(design.outsideImageAttachment?.name || design.outsideImageName || ''),
    outsideImageSize: Number(design.outsideImageAttachment?.size || design.outsideImageSize || 0),
    outsideImageAttachment: design.outsideImageAttachment && typeof design.outsideImageAttachment === 'object' ? clone(design.outsideImageAttachment) : null,
    embeds: sources.map(function (embed) {
      return {
        title: embed.title || '', url: embed.url || '', description: embed.description || '', color: embed.color || '#58b9ff',
        authorName: embed.authorName || '', authorIconUrl: embed.authorIconUrl || '', thumbnailUrl: embed.thumbnailUrl || '',
        imageUrl: embed.imageUrl || '', footerText: embed.footerText || '', footerIconUrl: embed.footerIconUrl || '',
        timestamp: embed.timestamp === true, fields: Array.isArray(embed.fields) ? clone(embed.fields).slice(0, 25) : []
      };
    }),
    componentSet: 'none',
    reactionRoles: []
  };
}

function welcomeFarewellPreviewValue(value) {
  return String(value || '')
    .replaceAll('${usermention}', '@NeuesMitglied')
    .replaceAll('${usernickname}', 'Neues Mitglied')
    .replaceAll('{usermention}', '@NeuesMitglied')
    .replaceAll('{user}', '@NeuesMitglied')
    .replaceAll('{username}', 'neuesmitglied')
    .replaceAll('{nickname}', 'Neues Mitglied')
    .replaceAll('{guild}', state.guilds.find(function (guild) { return String(guild.id) === String(state.selectedGuildId); })?.name || 'FALLEN HEAVEN');
}

function welcomeFarewellPreviewTemplate(template) {
  if (state.studioSpecialTemplate !== 'welcomeFarewell') return template;
  const preview = clone(template);
  preview.content = welcomeFarewellPreviewValue(preview.content);
  preview.embeds = (preview.embeds || [preview.embed || {}]).map(function (source) {
    const embed = clone(source);
    ['title', 'description', 'authorName', 'footerText'].forEach(function (key) { embed[key] = welcomeFarewellPreviewValue(embed[key]); });
    embed.fields = (embed.fields || []).map(function (field) {
      return { ...field, name: welcomeFarewellPreviewValue(field.name), value: welcomeFarewellPreviewValue(field.value) };
    });
    return embed;
  });
  preview.embed = preview.embeds[0] || {};
  return preview;
}

function boostAnnounceStudioTemplate(config) {
  const design = config?.boostAnnounceTemplate || {};
  const sources = Array.isArray(design.embeds) && design.embeds.length
    ? design.embeds
    : [design.embed || studioTemplates.welcome.embed];
  return {
    specialTemplate: 'boostAnnounce',
    channelId: String(config?.boostAnnounceChannelId || ''),
    content: Object.prototype.hasOwnProperty.call(design, 'content') ? String(design.content || '') : '{usermention}',
    outsideImageUrl: design.outsideImageAttachment ? '' : String(design.outsideImageUrl || ''),
    outsideImageName: String(design.outsideImageAttachment?.name || design.outsideImageName || ''),
    outsideImageSize: Number(design.outsideImageAttachment?.size || design.outsideImageSize || 0),
    outsideImageAttachment: design.outsideImageAttachment && typeof design.outsideImageAttachment === 'object' ? clone(design.outsideImageAttachment) : null,
    embeds: sources.map(function (embed) {
      return {
        title: embed.title || '', url: embed.url || '', description: embed.description || '', color: embed.color || '#a596ff',
        authorName: embed.authorName || '', authorIconUrl: embed.authorIconUrl || '', thumbnailUrl: embed.thumbnailUrl || '',
        imageUrl: embed.imageUrl || '', footerText: embed.footerText || '', footerIconUrl: embed.footerIconUrl || '',
        timestamp: embed.timestamp === true, fields: Array.isArray(embed.fields) ? clone(embed.fields).slice(0, 25) : []
      };
    }),
    componentSet: 'none',
    reactionRoles: []
  };
}

function boostAnnouncePreviewValue(value) {
  const guildName = state.guilds.find(function (guild) { return String(guild.id) === String(state.selectedGuildId); })?.name || 'FALLEN HEAVEN';
  return String(value || '')
    .replaceAll('${usermention}', '@NeuesMitglied')
    .replaceAll('${usernickname}', 'Max Muster')
    .replaceAll('${boostcount}', '2')
    .replaceAll('${guildname}', guildName)
    .replaceAll('{usermention}', '@NeuesMitglied')
    .replaceAll('{user}', '@NeuesMitglied')
    .replaceAll('{username}', 'maxmuster')
    .replaceAll('{nickname}', 'Max Muster')
    .replaceAll('{boostcount}', '2')
    .replaceAll('{guildname}', guildName)
    .replaceAll('{guild}', guildName);
}

function boostAnnouncePreviewTemplate(template) {
  if (state.studioSpecialTemplate !== 'boostAnnounce') return template;
  const preview = clone(template);
  preview.content = boostAnnouncePreviewValue(preview.content);
  preview.embeds = (preview.embeds || [preview.embed || {}]).map(function (source) {
    const embed = clone(source);
    ['title', 'description', 'authorName', 'footerText'].forEach(function (key) { embed[key] = boostAnnouncePreviewValue(embed[key]); });
    embed.fields = (embed.fields || []).map(function (field) {
      return { ...field, name: boostAnnouncePreviewValue(field.name), value: boostAnnouncePreviewValue(field.value) };
    });
    return embed;
  });
  preview.embed = preview.embeds[0] || {};
  return preview;
}

async function openBoostAnnounceStudio() {
  if (!state.authenticated || !state.selectedGuildId) {
    toast('Wähle zuerst einen Server.', 'error');
    return;
  }
  if (!(await setView('studio'))) return;
  await refreshConfig(state.selectedGuildId);
  state.activeStudioMessageId = '';
  state.studioSourceMessage = null;
  loadStudioTemplate(boostAnnounceStudioTemplate(state.config?.boostRoles));
  renderDrafts();
  toast('Boost-Benachrichtigung im bestehenden Embed Studio geöffnet.', 'success');
}

async function saveBoostAnnounceStudioTemplate() {
  if (!state.authenticated || !state.selectedGuildId) {
    toast('Wähle zuerst einen Server.', 'error');
    return false;
  }
  const template = currentStudioTemplate();
  const validation = renderStudioLimits(template);
  if (!validation.valid) {
    toast(validation.errors[0], 'error');
    return false;
  }
  // Außenbild wie bei Welcome/Farewell und der Aktivitäts-Liga speichern:
  // lokal gewählte Datei (localAsset), bereits gesendeter Discord-Anhang oder
  // URL wird mitgespeichert, damit das Bild beim nächsten Boost-Versand als
  // echter Anhang erscheint statt stillschweigend verworfen zu werden.
  const boostAnnounceTemplate = {
    content: String(template.content || '').slice(0, 2000),
    outsideImageUrl: String(template.outsideImageUrl || ''),
    outsideImageName: String(template.outsideImageName || ''),
    outsideImageSize: Number(template.outsideImageSize || 0),
    outsideImageAttachment: normalizeOutsideImageAttachment(template.outsideImageAttachment),
    removeOutsideImage: template.removeOutsideImage === true,
    embeds: (template.embeds || [template.embed || {}]).slice(0, 10).map(function (embed) {
      return {
        title: embed.title || '', url: embed.url || '', description: embed.description || '', color: embed.color || '#a596ff',
        authorName: embed.authorName || '', authorIconUrl: embed.authorIconUrl || '', thumbnailUrl: embed.thumbnailUrl || '',
        imageUrl: embed.imageUrl || '', footerText: embed.footerText || '', footerIconUrl: embed.footerIconUrl || '',
        timestamp: embed.timestamp === true, fields: Array.isArray(embed.fields) ? clone(embed.fields).slice(0, 25) : []
      };
    })
  };
  const current = clone(state.config?.boostRoles || {});
  const saved = await savePatch({ boostRoles: { ...current, boostAnnounceChannelId: template.channelId || current.boostAnnounceChannelId || '', boostAnnounceTemplate } }, 'Boost-Benachrichtigung gespeichert. Nach Aktivierung wird sie bei jedem neuen Boost mit der passenden Boost-Zahl gesendet.');
  if (saved) loadStudioTemplate(boostAnnounceStudioTemplate(state.config?.boostRoles));
  return saved;
}

function boostTopStudioTemplate(config) {
  const design = config?.boostTopTemplate || {};
  const sources = Array.isArray(design.embeds) && design.embeds.length
    ? design.embeds
    : [design.embed || studioTemplates.welcome.embed];
  function expandedBoostTopField(position) {
    return '{boostMarker' + position + '} {boost' + position + '}\n> **{boostCount' + position + '}×** geboostet';
  }
  function editableBoostTopValue(value) {
    let result = String(value || '').replaceAll('{boostRanking}', [1, 2, 3].map(expandedBoostTopField).join('\n\n'));
    [1, 2, 3].forEach(function (position) {
      result = result
        .replaceAll('{boostBlock' + position + '}', expandedBoostTopField(position))
        .replaceAll('{placeLine' + position + '}', expandedBoostTopField(position));
    });
    return result;
  }
  const fallbackFields = [
    { name: String(config?.boostTopPlaceName1 || config?.boostTopPlaceFieldName || 'PLATZ 1'), value: '{boostMarker1} {boost1}\n> **{boostCount1}×** geboostet', inline: true },
    { name: String(config?.boostTopPlaceName2 || 'PLATZ 2'), value: '{boostMarker2} {boost2}\n> **{boostCount2}×** geboostet', inline: true },
    { name: String(config?.boostTopPlaceName3 || 'PLATZ 3'), value: '{boostMarker3} {boost3}\n> **{boostCount3}×** geboostet', inline: true },
    { name: String(config?.boostTopStatusFieldName || '{statusFieldName}'), value: '{status}', inline: true },
    { name: String(config?.boostTopNextEvaluationFieldName || '{nextEvalFieldName}'), value: '{nextEvaluation}', inline: true }
  ];
  return {
    specialTemplate: 'boostTop',
    channelId: String(config?.boostTopChannelId || ''),
    boostTopPlaceName1: String(config?.boostTopPlaceName1 || 'PLATZ 1'),
    boostTopPlaceName2: String(config?.boostTopPlaceName2 || 'PLATZ 2'),
    boostTopPlaceName3: String(config?.boostTopPlaceName3 || 'PLATZ 3'),
    content: Object.prototype.hasOwnProperty.call(design, 'content') ? String(design.content || '') : '',
    outsideImageUrl: design.outsideImageAttachment ? '' : String(design.outsideImageUrl || ''),
    outsideImageName: String(design.outsideImageAttachment?.name || ''),
    outsideImageSize: Number(design.outsideImageAttachment?.size || 0),
    outsideImageAttachment: design.outsideImageAttachment || null,
    embeds: sources.slice(0, 1).map(function (embed) {
      return {
        title: embed.title || '', url: embed.url || '', description: embed.description || '', color: embed.color || '#a596ff',
        authorName: embed.authorName || '', authorIconUrl: embed.authorIconUrl || '', thumbnailUrl: embed.thumbnailUrl || '',
        imageUrl: embed.imageUrl || '', footerText: embed.footerText || '', footerIconUrl: embed.footerIconUrl || '',
        timestamp: embed.timestamp === true,
        fields: Array.isArray(embed.fields) && embed.fields.length
          ? clone(embed.fields).slice(0, 25).map(function (field) {
            return { ...field, value: editableBoostTopValue(field.value) };
          })
          : clone(fallbackFields)
      };
    }),
    componentSet: 'none',
    reactionRoles: []
  };
}

function boostTopPreviewValue(value) {
  const guildName = state.guilds.find(function (guild) { return String(guild.id) === String(state.selectedGuildId); })?.name || 'FALLEN HEAVEN';
  let result = String(value || '')
    .replaceAll('{server}', guildName)
    .replaceAll('{guildname}', guildName)
    .replaceAll('{guild}', guildName)
    .replaceAll('{period}', 'Live')
    .replaceAll('{status}', 'Live-Zwischenstand')
    .replaceAll('{boostcount}', '12')
    .replaceAll('{range}', 'Stand: 14:32 Uhr')
    .replaceAll('{nextEvaluation}', 'beim nächsten Boost oder Abgleich');
  const samples = [
    { marker: '🥇', mention: '@Beispiel', value: '3', block: '🥇 @Beispiel – **3×** geboostet' },
    { marker: '🥈', mention: '@Zweitbester', value: '2', block: '🥈 @Zweitbester – **2×** geboostet' },
    { marker: '🥉', mention: '@Dritter', value: '1', block: '🥉 @Dritter – **1×** geboostet' }
  ];
  samples.forEach(function (sample, index) {
    const position = index + 1;
    result = result
      .replaceAll('{boost' + position + '}', sample.mention)
      .replaceAll('{boostMention' + position + '}', sample.mention)
      .replaceAll('{boostValue' + position + '}', sample.value)
      .replaceAll('{boostCount' + position + '}', sample.value)
      .replaceAll('{boostMarker' + position + '}', sample.marker)
      .replaceAll('{boostBlock' + position + '}', sample.block)
      .replaceAll('{placeLine' + position + '}', sample.block)
      .replaceAll('{placeName' + position + '}', 'PLATZ ' + position);
  });
  result = result
    .replaceAll('{statusFieldName}', 'STATUS')
    .replaceAll('{nextEvalFieldName}', 'NÄCHSTE AUSWERTUNG');
  return result;
}

function boostTopPreviewTemplate(template) {
  if (state.studioSpecialTemplate !== 'boostTop') return template;
  const preview = clone(template);
  preview.content = boostTopPreviewValue(preview.content);
  preview.embeds = (preview.embeds || [preview.embed || {}]).map(function (source) {
    const embed = clone(source);
    ['title', 'description', 'authorName', 'footerText'].forEach(function (key) { embed[key] = boostTopPreviewValue(embed[key]); });
    embed.fields = (embed.fields || []).map(function (field) {
      return { ...field, name: boostTopPreviewValue(field.name), value: boostTopPreviewValue(field.value) };
    });
    return embed;
  });
  preview.embed = preview.embeds[0] || {};
  return preview;
}

async function openBoostTopStudio() {
  if (!state.authenticated || !state.selectedGuildId) {
    toast('Wähle zuerst einen Server.', 'error');
    return;
  }
  if (!(await setView('studio'))) return;
  await refreshConfig(state.selectedGuildId);
  state.activeStudioMessageId = '';
  state.studioSourceMessage = null;
  loadStudioTemplate(boostTopStudioTemplate(state.config?.boostRoles));
  renderDrafts();
  toast('Top-Booster-Liga im bestehenden Embed Studio geöffnet.', 'success');
}

async function saveBoostTopStudioTemplate() {
  if (!state.authenticated || !state.selectedGuildId) {
    toast('Wähle zuerst einen Server.', 'error');
    return false;
  }
  const template = currentStudioTemplate();
  const validation = renderStudioLimits(template);
  if (!validation.valid) {
    toast(validation.errors[0], 'error');
    return false;
  }
  return saveStudioDesign({
    path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/boost-top/design',
    body: { template: { ...template, embeds: (template.embeds || [template.embed || {}]).slice(0, 1) }, boostTopPlaceName1: template.boostTopPlaceName1 || '', boostTopPlaceName2: template.boostTopPlaceName2 || '', boostTopPlaceName3: template.boostTopPlaceName3 || '' },
    errorMessage: 'Die Top-Booster-Vorlage konnte nicht gespeichert werden.',
    onSaved: function (result) {
      state.config.boostRoles = result.config?.boostRoles || state.config.boostRoles;
      loadStudioTemplate(boostTopStudioTemplate(state.config.boostRoles));
      void refreshBoostTopStatus();
    },
    okMessage: function (result) {
      return result.panel
        ? 'Top-3-Vorlage gespeichert und Live-Panel aktualisiert.'
        : 'Top-3-Vorlage gespeichert. Das Panel wird nach der Aktivierung automatisch erstellt.';
    }
  });
}function vipPanelStudioTemplate(config) {
  const design = config?.vipPanelTemplate || {};
  const sources = Array.isArray(design.embeds) && design.embeds.length
    ? design.embeds
    : [design.embed || studioTemplates.welcome.embed];
  // Tier-Template-Config: Individual editierbare Platzhalter
  const tierFieldTemplate = design.vipTierFieldTemplate || '{tierEmoji} {tierName} \u00b7 {tierMemberCount}';
  const tierMemberFormat = design.vipTierMemberFormat || '<@{memberId}>';
  const tierEmptyText = design.vipTierEmptyText || '*Noch keine Mitglieder.*';
  const tierOverflowText = design.vipTierOverflowText || '… und {overflowCount} weitere';
  // Virtuelle Embed-Felder für die Tier-Formate: Diese erscheinen als
  // editierbare Felder im Studio, sodass der Nutzer die Platzhalter-Rahmen
  // frei gestalten kann. Beim Speichern werden sie wieder extrahiert.
  // Platzhalter-Beschreibungen: {tierEmoji} = Rang-Emoji (👑/💎/⭐),
  // {tierName} = Stufenname (VIP: GOLD), {tierMemberCount} = Anzahl,
  // {memberId} = Discord-ID, {memberName} = Anzeigename,
  // {overflowCount} = verbleibende Members über 15
  const resolvedExamples = [
    '👑 VIP: GOLD · 5',
    '💎 VIP: DIAMANT · 3',
    '⭐ VIP: SILBER · 2'
  ];
  const virtualTierFields = [
    { name: '📝 STUFEN NAME — \u200b\u200b{Name + Emoji + Anzahl pro Stufe}\u200b\u200b  →  ' + resolvedExamples[0], value: tierFieldTemplate, inline: false, __vipTier: 'fieldTemplate' },
    { name: '👤 MITGLIED FORMAT — \u200b\u200bWie jedes Mitglied in der Stufe angezeigt wird}\u200b  →  <@1234567890>', value: tierMemberFormat, inline: false, __vipTier: 'memberFormat' },
    { name: '📭 LEERER STUFEN-TEXT — \u200b\u200bWenn Stufe keine Members hat}\u200b  →  Noch keine Mitglieder.', value: tierEmptyText, inline: false, __vipTier: 'emptyText' },
    { name: '➕ MEHR-ANZEIGE — \u200b\u200b\u200bAb 15+ Members}\u200b  →  … und 3 weitere', value: tierOverflowText, inline: false, __vipTier: 'overflowText' }
  ];
  // Benutzerdefinierte Felder (aus gespeichertem Design) + virtuelle Tier-Felder
  const userFields = Array.isArray(sources[0]?.fields) ? clone(sources[0].fields).slice(0, 21) : [];
  // Alte virtuelle Felder beim erneuten Laden filtern
  const cleanUserFields = userFields.filter(function (f) { return !f.__vipTier; });
  const allFields = cleanUserFields.concat(virtualTierFields);
  return {
    specialTemplate: 'vipPanel',
    channelId: String(config?.vipPanelChannelId || ''),
    content: Object.prototype.hasOwnProperty.call(design, 'content') ? String(design.content || '') : '',
    outsideImageUrl: design.outsideImageAttachment ? '' : String(design.outsideImageUrl || ''),
    outsideImageName: String(design.outsideImageAttachment?.name || ''),
    outsideImageSize: Number(design.outsideImageAttachment?.size || 0),
    outsideImageAttachment: design.outsideImageAttachment || null,
    embeds: sources.slice(0, 1).map(function (embed) {
      return {
        title: embed.title || '', url: embed.url || '', description: embed.description || '', color: embed.color || '#ffbd59',
        authorName: embed.authorName || '', authorIconUrl: embed.authorIconUrl || '', thumbnailUrl: embed.thumbnailUrl || '', imageUrl: embed.imageUrl || '', footerText: embed.footerText || '', footerIconUrl: embed.footerIconUrl || '', timestamp: embed.timestamp === true, fields: allFields.slice(0, 25)
      };
    }),
    componentSet: 'none',
    reactionRoles: []
  };
}

function vipPanelPreviewValue(value) {
  const guildName = state.guilds.find(function (guild) { return String(guild.id) === String(state.selectedGuildId); })?.name || 'FALLEN HEAVEN';
  return String(value || '')
    .replaceAll('{server}', guildName)
    .replaceAll('{guildname}', guildName)
    .replaceAll('{guild}', guildName)
    .replaceAll('{memberCount}', '12')
    .replaceAll('{tierCount}', '4')
    .replaceAll('{date}', '08.08.2026')
    .replaceAll('{time}', '14:32')
    .replaceAll('{tierEmoji}', '👑')
    .replaceAll('{tierName}', 'VIP: GOLD')
    .replaceAll('{tierMemberCount}', '5')
    .replaceAll('{memberId}', '1234567890')
    .replaceAll('{memberName}', 'Max Muster')
    .replaceAll('{overflowCount}', '3');
}

function vipPanelPreviewTemplate(template) {
  if (state.studioSpecialTemplate !== 'vipPanel') return template;
  const preview = clone(template);
  preview.content = vipPanelPreviewValue(preview.content);
  preview.embeds = (preview.embeds || [preview.embed || {}]).map(function (source) {
    const embed = clone(source);
    ['title', 'description', 'authorName', 'footerText'].forEach(function (key) { embed[key] = vipPanelPreviewValue(embed[key]); });
    // Virtuelle Tier-Felder extrahieren und aus Preview entfernen
    const allFields = Array.isArray(embed.fields) ? embed.fields : [];
    const tierFieldConfig = { fieldTemplate: '{tierEmoji} {tierName} \u00b7 {tierMemberCount}', memberFormat: '<@{memberId}>', emptyText: '*Noch keine Mitglieder.*', overflowText: '… und {overflowCount} weitere' };
    allFields.forEach(function (f) {
      if (f.__vipTier === 'fieldTemplate') tierFieldConfig.fieldTemplate = String(f.value || tierFieldConfig.fieldTemplate);
      else if (f.__vipTier === 'memberFormat') tierFieldConfig.memberFormat = String(f.value || tierFieldConfig.memberFormat);
      else if (f.__vipTier === 'emptyText') tierFieldConfig.emptyText = String(f.value || tierFieldConfig.emptyText);
      else if (f.__vipTier === 'overflowText') tierFieldConfig.overflowText = String(f.value || tierFieldConfig.overflowText);
    });
    // Benutzerdefinierte Felder (ohne virtuelle) + Mock-Tier-Felder
    const userFields = allFields.filter(function (f) { return !f.__vipTier; }).map(function (field) {
      return { ...field, name: vipPanelPreviewValue(field.name), value: vipPanelPreviewValue(field.value) };
    });
    const mockTiers = [
      { emoji: '👑', name: 'VIP: GOLD', count: 5, members: ['Max Muster', 'Lena Schmidt', 'Tom Becker'] },
      { emoji: '💎', name: 'VIP: DIAMANT', count: 3, members: ['Anna Weber', 'Lisa Braun'] },
      { emoji: '⭐', name: 'VIP: SILBER', count: 2, members: ['Peter Kun'] }
    ];
    const tierFields = mockTiers.map(function (tier) {
      const memberLines = tier.members.map(function (name) {
        return tierFieldConfig.memberFormat.replaceAll('{memberId}', '1234567890').replaceAll('{memberName}', name);
      });
      if (tier.count > tier.members.length) {
        memberLines.push(tierFieldConfig.overflowText.replaceAll('{overflowCount}', String(tier.count - tier.members.length)));
      }
      return {
        name: tierFieldConfig.fieldTemplate
          .replaceAll('{tierEmoji}', tier.emoji)
          .replaceAll('{tierName}', tier.name)
          .replaceAll('{tierMemberCount}', String(tier.count))
          .replaceAll('{server}', preview.embed.title || 'FALLEN HEAVEN')
          .replaceAll('{date}', '08.08.2026')
          .replaceAll('{time}', '14:32')
          .slice(0, 256),
        value: memberLines.join('\n').slice(0, 1024),
        inline: false
      };
    });
    embed.fields = userFields.concat(tierFields);
    return embed;
  });
  preview.embed = preview.embeds[0] || {};
  return preview;
}

async function openVipPanelStudio() {
  if (!state.authenticated || !state.selectedGuildId) {
    toast('Wähle zuerst einen Server.', 'error');
    return;
  }
  if (!(await setView('studio'))) return;
  await refreshConfig(state.selectedGuildId);
  state.activeStudioMessageId = '';
  state.studioSourceMessage = null;
  loadStudioTemplate(vipPanelStudioTemplate(state.config?.heavenEconomy));
  renderDrafts();
  toast('VIP-Panels im bestehenden Embed Studio geöffnet.', 'success');
}

async function saveVipPanelStudioTemplate() {
  if (!state.authenticated || !state.selectedGuildId) {
    toast('Wähle zuerst einen Server.', 'error');
    return false;
  }
  const template = currentStudioTemplate();
  const validation = renderStudioLimits(template);
  if (!validation.valid) {
    toast(validation.errors[0], 'error');
    return false;
  }
  return saveStudioDesign({
    path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/vip-panels/design',
    body: {
      template: { ...template, embeds: (template.embeds || [template.embed || {}]).slice(0, 1) },
      channelId: template.channelId || ''
    },
    errorMessage: 'Die VIP-Panel-Vorlage konnte nicht gespeichert werden.',
    onSaved: function (result) {
      state.config.heavenEconomy = result.config?.heavenEconomy || state.config.heavenEconomy;
      loadStudioTemplate(vipPanelStudioTemplate(state.config.heavenEconomy));
      void refreshVipPanelsStatus();
    },
    okMessage: function (result) {
      return (result.panels && result.panels.length)
        ? 'VIP-Embed gespeichert und Live-Panel aktualisiert.'
        : 'VIP-Embed gespeichert. Es wird nach der Aktivierung automatisch erstellt.';
    }
  });
}

// ---- Editierbare VIP-DM-Embeds (Sektionen giftReceived / vipPurchased /
// coinsReceived / boostMilestone) – Muster wie die Zähl-Kanal-DM-Embeds ----
function vipDmStudioTemplate(config, sectionId) {
  const design = config?.dmDesigns?.[sectionId] || {};
  return {
    specialTemplate: 'vipDm',
    vipDmSection: sectionId,
    channelId: '',
    content: '',
    outsideImageUrl: '',
    outsideImageName: '',
    outsideImageSize: 0,
    outsideImageAttachment: null,
    embeds: [{
      title: design.title || '', url: design.url || '', description: design.description || '', color: design.color || '#7772ff',
      authorName: design.authorName || '', authorIconUrl: design.authorIconUrl || '', thumbnailUrl: design.thumbnailUrl || '',
      imageUrl: design.imageUrl || '', footerText: design.footerText || '', footerIconUrl: design.footerIconUrl || '',
      timestamp: design.timestamp === true, fields: Array.isArray(design.fields) ? clone(design.fields).slice(0, 25) : []
    }],
    componentSet: 'none',
    reactionRoles: []
  };
}

function vipDmPreviewValue(value) {
  const guildName = state.guilds.find(function (guild) { return String(guild.id) === String(state.selectedGuildId); })?.name || 'FALLEN HEAVEN';
  return String(value || '')
    .replaceAll('{server}', guildName)
    .replaceAll('{guild}', guildName)
    .replaceAll('{target}', 'Max Muster')
    .replaceAll('{targetMention}', '@MaxMuster')
    .replaceAll('{tier}', 'VIP: GOLD')
    .replaceAll('{price}', '1.500 Coins')
    .replaceAll('{giver}', 'Lena')
    .replaceAll('{giverMention}', '@Lena')
    .replaceAll('{coins}', '100 Coins')
    .replaceAll('{balance}', '2.400 Coins')
    .replaceAll('{giverBalance}', '1.725 Coins').replaceAll('{targetBalance}', '675 Coins').replaceAll('{messageBlock}', '\n\n> Viel Freude damit!').replaceAll('{message}', 'Viel Freude damit!').replaceAll('{transactionId}', 'FH-GIFT-8X4K2')
    .replaceAll('{levels}', '**3×**, **4×**')
    .replaceAll('{reason}', 'Danke für deine Unterstützung');
}

function vipDmPreviewTemplate(template) {
  if (state.studioSpecialTemplate !== 'vipDm') return template;
  const preview = clone(template);
  preview.content = vipDmPreviewValue(preview.content);
  preview.embeds = (preview.embeds || [preview.embed || {}]).map(function (source) {
    const embed = clone(source);
    ['title', 'description', 'authorName', 'footerText'].forEach(function (key) { embed[key] = vipDmPreviewValue(embed[key]); });
    embed.fields = (embed.fields || []).map(function (field) {
      return { ...field, name: vipDmPreviewValue(field.name), value: vipDmPreviewValue(field.value) };
    });
    return embed;
  });
  preview.embed = preview.embeds[0] || {};
  return preview;
}

async function openVipDmStudio(sectionId) {
  if (!state.authenticated || !state.selectedGuildId) {
    toast('Wähle zuerst einen Server.', 'error');
    return;
  }
  if (!(await setView('studio'))) return;
  await refreshConfig(state.selectedGuildId);
  state.activeStudioMessageId = '';
  state.studioSourceMessage = null;
  state.studioVipDmSection = String(sectionId || 'giftReceived');
  loadStudioTemplate(vipDmStudioTemplate(state.config?.heavenEconomy, state.studioVipDmSection));
  renderDrafts();
  toast('VIP-DM-Embed im bestehenden Embed Studio geöffnet.', 'success');
}

async function saveVipDmStudioTemplate() {
  if (!state.authenticated || !state.selectedGuildId) {
    toast('Wähle zuerst einen Server.', 'error');
    return false;
  }
  const template = currentStudioTemplate();
  const validation = renderStudioLimits(template);
  if (!validation.valid) {
    toast(validation.errors[0], 'error');
    return false;
  }
  if ((template.embeds?.length || (template.embed ? 1 : 0)) > 1) {
    toast('Die DM-Nachricht verwendet genau ein Embed.', 'error');
    return false;
  }
  return saveStudioDesign({
    path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/heaven-economy/dm-design',
    body: {
      section: state.studioVipDmSection || 'giftReceived',
      template: {
        ...template,
        embeds: (template.embeds || [template.embed || {}]).slice(0, 1)
      }
    },
    errorMessage: 'Die VIP-DM-Nachricht konnte nicht gespeichert werden.',
    onSaved: function (result) {
      state.config.heavenEconomy = result.config?.heavenEconomy || state.config.heavenEconomy;
      loadStudioTemplate(vipDmStudioTemplate(state.config.heavenEconomy, state.studioVipDmSection));
    },
    okMessage: 'VIP-DM-Embed gespeichert. Neue Geschenke, Käufe und Gutschriften nutzen es ab sofort.'
  });
}
function steamWorkshopStudioTemplate(config, item) {
  const customized = Boolean(item?.designOverride);
  const design = customized ? item.designOverride : config?.design || {};
  const embed = design.embed || {};
  const assetMode = customized && ['global', 'item', 'none'].includes(item?.assetMode) ? item.assetMode : 'global';
  const itemAsset = assetMode === 'item' ? item?.itemBannerAsset : null;
  const globalAsset = assetMode === 'global' ? {
    name: String(config?.design?.outsideImageAssetName || ''),
    size: Math.max(0, Number(config?.design?.outsideImageAssetSize || 0))
  } : null;
  const assetName = String(itemAsset?.name || globalAsset?.name || '');
  const assetSize = Math.max(0, Number(itemAsset?.size || globalAsset?.size || 0));
  return {
    specialTemplate: 'steamWorkshop',
    workshopItemId: String(item?.workshopId || ''),
    workshopItemTitle: String(item?.title || ''),
    workshopItemTokens: item?.tokens || null,
    workshopAssetMode: assetMode,
    channelId: String(config?.forumChannelId || ''),
    content: String(design.content || ''),
    outsideImageUrl: String(design.outsideImageUrl || ''),
    outsideImageName: assetName,
    outsideImageSize: assetSize,
    outsideImageAttachment: assetName ? { id: assetMode === 'item' ? 'local-workshop-item-banner' : 'local-workshop-banner', url: '', name: assetName, size: assetSize, localAsset: true, assetScope: assetMode } : null,
    embed: {
      title: Object.prototype.hasOwnProperty.call(embed, 'title') ? embed.title : '{title}',
      url: Object.prototype.hasOwnProperty.call(embed, 'url') ? embed.url : '{workshopUrl}',
      description: Object.prototype.hasOwnProperty.call(embed, 'description') ? embed.description : '{description}',
      color: embed.color || '#1b2838',
      authorName: Object.prototype.hasOwnProperty.call(embed, 'authorName') ? embed.authorName : 'STEAM WORKSHOP · {game}',
      authorIconUrl: embed.authorIconUrl || '',
      thumbnailUrl: embed.thumbnailUrl || '',
      imageUrl: Object.prototype.hasOwnProperty.call(embed, 'imageUrl') ? embed.imageUrl : '{previewUrl}',
      footerText: Object.prototype.hasOwnProperty.call(embed, 'footerText') ? embed.footerText : 'Workshop-ID: {workshopId}',
      footerIconUrl: embed.footerIconUrl || '',
      timestamp: embed.timestamp !== false,
      fields: Array.isArray(embed.fields) ? clone(embed.fields).slice(0, 25) : [
        { name: 'REICHWEITE', value: '**{subscriptions}** Abonnenten\n**{favorites}** Favoriten\n**{views}** Aufrufe', inline: true },
        { name: 'VERÖFFENTLICHUNG', value: 'Erstellt: {createdAt}\nAktualisiert: {updatedAt}', inline: true },
        { name: 'DATEI', value: '{fileSize}\nApp-ID: `{appId}`', inline: true },
        { name: 'TAGS', value: '{tags}', inline: false }
      ]
    },
    componentSet: 'none',
    reactionRoles: [],
    forumPost: { name: String(item?.threadNameOverride || ''), appliedTags: [] }
  };
}

function steamWorkshopPreviewValue(value) {
  const samples = {
    title: 'FALLEN HEAVEN · Beispiel-Mod',
    workshopId: '3731417846',
    workshopUrl: 'https://steamcommunity.com/sharedfiles/filedetails/?id=3731417846',
    description: 'Eine detaillierte Beschreibung des Workshop-Inhalts. Beim echten Katalog übernimmt der Bot Titel, Beschreibung, Vorschaubild, Statistiken, Zeitpunkte und Tags direkt von Steam.',
    previewUrl: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/108600/header.jpg',
    subscriptions: '42.318',
    lifetimeSubscriptions: '47.902',
    favorites: '3.842',
    lifetimeFavorites: '4.016',
    views: '188.204',
    fileSize: '128,4 MB',
    fileName: 'fallen-heaven-mod.zip',
    createdAt: '4. August 2026 · vor 2 Stunden',
    updatedAt: '4. August 2026 · vor wenigen Minuten',
    appId: '108600',
    game: 'APP 108600',
    gameUrl: 'https://store.steampowered.com/app/108600/',
    creator: 'FALLEN HEAVEN',
    creatorUrl: 'https://steamcommunity.com/',
    tags: '`Mod` · `Multiplayer` · `FALLEN HEAVEN`',
    visibility: 'Öffentlich',
    revision: '12',
    ratingStars: '★★★★★',
    ratingValue: '4,9',
    ratingCount: '21.899'
  };
  Object.assign(samples, state.studioWorkshopItemTokens || {});
  return String(value || '').replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, function (match, key) {
    return Object.prototype.hasOwnProperty.call(samples, key) ? samples[key] : match;
  });
}

function steamWorkshopPreviewTemplate(template) {
  if (state.studioSpecialTemplate !== 'steamWorkshop') return template;
  const preview = clone(template);
  const source = preview.embed || preview.embeds?.[0] || {};
  const embed = clone(source);
  ['title', 'url', 'description', 'authorName', 'authorIconUrl', 'thumbnailUrl', 'imageUrl', 'footerText', 'footerIconUrl']
    .forEach(function (key) { embed[key] = steamWorkshopPreviewValue(embed[key]); });
  const ratingField = state.config?.steamWorkshop?.showRating === false ? [] : [{
    name: 'STEAM-BEWERTUNG',
    value: '**★★★★★  4,9 / 5**\n21.899 Bewertungen',
    inline: true
  }];
  embed.fields = ratingField.concat((Array.isArray(embed.fields) ? embed.fields : []).map(function (field) {
    return { ...field, name: steamWorkshopPreviewValue(field.name), value: steamWorkshopPreviewValue(field.value) };
  }));
  const customHero = String(preview.outsideImageUrl || preview.outsideImageAttachment?.url || '');
  if (validImageUrl(customHero)) embed.imageUrl = customHero;
  if (!validImageUrl(embed.imageUrl) && state.config?.steamWorkshop?.preferSteamPreviewImage !== false) {
    embed.imageUrl = steamWorkshopPreviewValue('{previewUrl}');
  }
  preview.outsideImageUrl = '';
  preview.outsideImageAttachment = null;
  preview.content = steamWorkshopPreviewValue(preview.content);
  preview.embed = embed;
  preview.embeds = [embed];
  return preview;
}
function specialStudioPreviewTemplate(template) {
  if (state.studioSpecialTemplate === 'economyPanel') return window.FHCCEconomyPanelStudio.previewTemplate(template, state);
  if (state.studioSpecialTemplate === 'tempVoiceInterface') return tempVoiceUi.previewTemplate(template);
  if (state.studioSpecialTemplate === 'publicCallVote') return publicCallVotePreviewTemplate(template);
  if (state.studioSpecialTemplate === 'welcomeFarewell') return welcomeFarewellPreviewTemplate(template);
  if (state.studioSpecialTemplate === 'boostAnnounce') return boostAnnouncePreviewTemplate(template);
  if (state.studioSpecialTemplate === 'boostTop') return boostTopPreviewTemplate(template);
  if (state.studioSpecialTemplate === 'vipPanel') return vipPanelPreviewTemplate(template);
  if (state.studioSpecialTemplate === 'vipDm') return vipDmPreviewTemplate(template);
  if (state.studioSpecialTemplate === 'activityRace') return window.FHCCActivityRaceStudio.previewTemplate(template, state);
  if (state.studioSpecialTemplate === 'steamWorkshop') return steamWorkshopPreviewTemplate(template);
  if (state.studioSpecialTemplate === 'levelsPanel') return levelsPreviewTemplate(template);
  if (state.studioSpecialTemplate === 'levelUp') return levelUpPreviewTemplate(template);
  if (state.studioSpecialTemplate === 'levelUpInfo') return levelUpInfoPreviewTemplate(template);
  if (state.studioSpecialTemplate === 'botUpdates') return botUpdatesPreviewTemplate(template);
  if (state.studioSpecialTemplate === 'countingPanel') return countingPreviewTemplate(template);
  if (state.studioSpecialTemplate === 'countingDm') return countingDmPreviewTemplate(template);
  if (state.studioSpecialTemplate === 'inactiveReminder') return inactiveReminderPreviewTemplate(template);
  return template;
}
function renderStudioSpecialTemplateUi() {
  const economyPanelActive = state.studioSpecialTemplate === 'economyPanel';
  const tempVoiceActive = state.studioSpecialTemplate === 'tempVoiceInterface';
  const welcomeActive = state.studioSpecialTemplate === 'welcomeFarewell';
  const boostActive = state.studioSpecialTemplate === 'boostAnnounce';
  const boostTopActive = state.studioSpecialTemplate === 'boostTop';
  const vipPanelActive = state.studioSpecialTemplate === 'vipPanel';
  const vipDmActive = state.studioSpecialTemplate === 'vipDm';
  const activityActive = state.studioSpecialTemplate === 'activityRace';
  const activityPingInfoActive = activityActive && state.studioActivityRaceSection === 'ping-info';
  const workshopActive = state.studioSpecialTemplate === 'steamWorkshop';
  const verifyActive = state.studioSpecialTemplate === 'memberVerify';
  const levelsActive = state.studioSpecialTemplate === 'levelsPanel';
  const levelUpActive = state.studioSpecialTemplate === 'levelUp';
  const levelUpInfoActive = state.studioSpecialTemplate === 'levelUpInfo';
  const botUpdatesActive = state.studioSpecialTemplate === 'botUpdates';
  const countingPanelActive = state.studioSpecialTemplate === 'countingPanel';
  const countingDmActive = state.studioSpecialTemplate === 'countingDm';
  const pcvActive = state.studioSpecialTemplate === 'publicCallVote';
  const inactiveReminderActive = state.studioSpecialTemplate === 'inactiveReminder';
  const active = economyPanelActive || tempVoiceActive || welcomeActive || boostActive || boostTopActive || vipPanelActive || vipDmActive || activityActive || workshopActive || verifyActive || levelsActive || levelUpActive || levelUpInfoActive || botUpdatesActive || countingPanelActive || countingDmActive || pcvActive || inactiveReminderActive;
  const view = document.getElementById('studio-view');
  view?.classList.toggle('studio-activity-race-mode', activityActive);
  view?.classList.toggle('studio-steam-workshop-mode', workshopActive);
  const banner = document.getElementById('studio-special-template');
  if (banner) banner.hidden = !active;
  const bannerTitle = banner?.querySelector('[data-studio-special-title]');
  const bannerDetail = banner?.querySelector('[data-studio-special-detail]');
  const placeholders = banner?.querySelector('[data-studio-special-placeholders]');
  if (bannerTitle) bannerTitle.textContent = tempVoiceActive ? 'TempVoice-Interface' : welcomeActive ? 'Welcome / Farewell' : boostActive ? 'Boost-Benachrichtigung' : boostTopActive ? 'Top-Booster-Liga' : vipPanelActive ? 'VIP-Panels' : vipDmActive ? 'VIP-DM-Benachrichtigung' : workshopActive
    ? state.studioWorkshopItemId ? 'Steam Workshop · ' + state.studioWorkshopItemTitle : 'Steam Workshop'

    : verifyActive ? 'Verify-Panel'
    : levelsActive ? 'Levelrollen-Panel'
    : levelUpActive ? 'Level-Up-Embed'
    : levelUpInfoActive ? 'Level-Up-Kanal-Info'
    : botUpdatesActive ? 'Bot-Updates'
    : countingPanelActive ? 'Zähl-Panel'
    : countingDmActive ? (state.studioCountingDmSection === 'strikeRelease' ? 'Zähl-Kanal · Freigabe-DM' : 'Zähl-Kanal · Sperr-DM')
    : pcvActive ? 'Call-Moderation'
    : inactiveReminderActive ? 'Inaktivitäts-Erinnerung'
    : 'Aktivitäts-Liga';
  if (bannerDetail) bannerDetail.textContent = tempVoiceActive
    ? 'Dieses Embed erscheint in jedem temporären Sprachkanal. Texte, Bilder und Felder sind frei editierbar; die funktionalen TempVoice-Buttons verwaltet der Bot.'
    : welcomeActive
    ? 'Diese Vorlage wird automatisch gesendet, sobald die Begrüßungsbedingung erfüllt ist. Discord-Mitglied und Server werden beim Versand dynamisch eingesetzt.'
    : boostActive
    ? 'Dieses Embed wird bei jedem neuen Server-Boost in den gewählten Kanal gesendet. {boostcount} zeigt automatisch, ob das Mitglied 1×, 2× oder öfter boostet.'
    : boostTopActive
    ? 'Genau ein Embed mit den Top 1–3 Boostern. Der Bot sendet es einmal und bearbeitet es bei jeder Änderung der Rangfolge; {boostcount}, {server} und {range} werden automatisch ersetzt.'
    : vipPanelActive
    ? 'Ein gemeinsames Embed mit allen VIP-Stufen in einem Kanal. Jede Stufe wird mit Rang-Emoji und Mitgliederliste als eigenes Feld geführt – {memberCount}, {tierCount} und {server} ersetzt der Bot automatisch. Die vier Felder unten (STUFEN NAME, MITGLIED FORMAT etc.) gelten für ALLE Stufen – die Platzhalter werden pro Stufe dynamisch aufgelöst (z.B. 👑 VIP: GOLD · 5, 💎 VIP: DIAMANT · 3, ⭐ VIP: SILBER · 2).'
    : vipDmActive
    ? (state.studioVipDmSection === 'vipPurchased'
      ? 'Dieses Embed wird als DM gesendet, sobald ein Mitglied eine VIP-Stufe kauft. {targetMention}, {tier}, {price} und {server} ersetzt der Bot automatisch.'
      : state.studioVipDmSection === 'coinsReceived'
      ? 'Dieses Embed wird als DM gesendet, sobald ein Konto eine Coin-Gutschrift erhält. {targetMention}, {coins}, {balance} und {reason} ersetzt der Bot automatisch.'
      : state.studioVipDmSection === 'boostMilestone'
      ? 'Dieses Embed wird als DM gesendet, sobald eine neue Boost-Stufe vergütet wird. {targetMention}, {levels}, {coins} und {balance} ersetzt der Bot automatisch.'
      : state.studioVipDmSection === 'coinGiftReceived'
      ? 'Dieses Embed erhält der Empfänger bei jedem Coin-Geschenk neu. {giverMention}, {coins}, {targetBalance}, {messageBlock} und {transactionId} ersetzt der Bot automatisch.'
      : state.studioVipDmSection === 'coinGiftSent'
      ? 'Dieses Embed erhält der Absender als neue Quittung. {targetMention}, {coins}, {giverBalance}, {messageBlock} und {transactionId} ersetzt der Bot automatisch.'
      : 'Dieses Embed wird als DM gesendet, sobald einem Mitglied eine VIP-Stufe geschenkt wird. {targetMention}, {tier}, {giver} und {server} ersetzt der Bot automatisch.')
    : workshopActive
    ? state.studioWorkshopItemId
      ? 'Du bearbeitest ausschließlich „' + state.studioWorkshopItemTitle + '“. Dieses Design bleibt bei späteren Steam-Abgleichen erhalten; die dynamischen Steam-Werte werden weiterhin aktualisiert.'
      : 'Du gestaltest die gemeinsame Standardvorlage. Ein eigenes großes Banner überschreibt das Steam-Vorschaubild; ohne Banner nutzt der Bot automatisch das beste Steam-Bild.'
    : verifyActive
    ? 'Dieses Embed ist das Verify-Panel im gewählten Kanal. Der „Verifizieren“-Button bleibt beim Speichern automatisch erhalten – du gestaltest Titel, Beschreibung, Farben, Bilder und Felder frei.'
    : levelsActive
    ? 'Dieses Embed ist das Levelrollen-Panel im gewählten Kanal. Einzelne Rollen-Slots wie {levelRole1}, {levelRoleName1} und {levelRoleLevel1} bis Platz 20 werden beim Versand dynamisch ersetzt – dein Text darum herum bleibt frei editierbar.'
    : levelUpActive
    ? 'Dieses Embed wird bei jedem Levelaufstieg im gewählten Kanal gesendet. {user}, {level}, {rank} und {guild} ersetzt der Bot automatisch – du gestaltest Titel, Beschreibung, Farben, Bilder und Felder frei.'
    : botUpdatesActive
    ? 'Dieses Embed informiert den Server über Bot-Updates und bekannte Probleme. {version}, {updateCount}, {change1}, {changeVersion1} und {changeDate1} ersetzt der Bot automatisch.'
    : levelUpInfoActive
    ? 'Dieses Embed bleibt dauerhaft im Level-Up-Kanal stehen. Regel-Blöcke wie {rulesChatFieldText}, {rulesVoiceFieldText} und {rulesBonusFieldText} werden beim Senden aus deinen aktuellen Level-Regeln gefüllt.'
    : countingPanelActive
    ? 'Dieses Embed ist das Live-Panel im Status-Panel-Kanal und wird bei jedem Zug automatisch aktualisiert – genau eine gepinnte Nachricht. {count}, {next}, {lastCounter}, {lastCounterName}, {fails} sowie {top1}, {topValue1} und {topMarker1} bis Platz 3 ersetzt der Bot automatisch.'
    : countingDmActive
    ? (state.studioCountingDmSection === 'strikeRelease'
      ? 'Dieses Embed wird als DM gesendet, sobald eine Chat-Sperre abgelaufen ist. {targetMention}, {server} und {hours} ersetzt der Bot automatisch.'
      : 'Dieses Embed wird als DM gesendet, sobald ein Mitglied gesperrt wird. {targetMention}, {server}, {limit} und {hours} ersetzt der Bot automatisch.')
    : pcvActive
    ? publicCallVoteStudioSectionDetail(state.studioPcvSection)
    : inactiveReminderActive
    ? 'Dieses Embed wird als DM gesendet, sobald ein Mitglied inaktiv ist. {user} wird durch einen echten Ping, {username}/{displayName} durch den Namen und {thresholdDays} durch deine Einstellung ersetzt. Die Buttons „Ja, ich bleibe“ und „Nein, bitte entfernen“ bleiben beim Speichern automatisch erhalten. Es gibt keinen Auto-Kick.'
    : activityPingInfoActive
    ? 'Diese separate Nachricht steht unter den drei Rankings. Bis zu zehn Embeds, Texte, Links, Felder und Bilder sind frei editierbar; den einen funktionalen Ping-Schalter setzt der Bot sicher darunter.'
    : 'Du bearbeitest hier direkt die Live-Vorlage des Moduls. Ranglisten, Zeitraum und Navigation setzt der Bot weiterhin automatisch ein.';
  if (placeholders) placeholders.innerHTML = (tempVoiceActive
    ? ['{owner}', '{ownerName}', '{channelName}', '{createdAt}', '{userLimit}', '{region}', '{accessState}', '{memberCount}', '{server}']
    : welcomeActive
    ? ['{user}', '{nickname}', '{username}', '{guild}']
    : boostActive
    ? ['{usermention}', '{usernickname}', '{boostcount}', '{guildname}']
    : boostTopActive
    ? ['{server}', '{boostcount}', '{range}', '{status}', '{nextEvaluation}', '{boost1}', '{boostMention1}', '{boostValue1}', '{boostCount1}', '{boostMarker1}', '{boost2}', '{boostMention2}', '{boostValue2}', '{boostCount2}', '{boostMarker2}', '{boost3}', '{boostMention3}', '{boostValue3}', '{boostCount3}', '{boostMarker3}']
    : vipPanelActive
    ? ['{server}', '{memberCount}', '{tierCount}', '{date}', '{time}', '{tierEmoji}', '{tierName}', '{tierMemberCount}', '{memberId}', '{memberName}', '{overflowCount}']
    : workshopActive
    ? ['{title}', '{description}', '{previewUrl}', '{workshopUrl}', '{workshopId}', '{subscriptions}', '{favorites}', '{views}', '{ratingStars}', '{ratingValue}', '{ratingCount}', '{createdAt}', '{updatedAt}', '{fileSize}', '{appId}', '{game}', '{tags}', '{creator}', '{visibility}']
    : levelsActive
    ? ['{guild}', '{levelRole1}', '{levelRoleName1}', '{levelRoleLevel1}', '{levelRole2}', '{levelRoleName2}', '{levelRoleLevel2}', '{levelRole3}', '{levelRoleName3}', '{levelRoleLevel3}', '{levelRole4}', '{levelRoleName4}', '{levelRoleLevel4}', '{levelRole5}', '{levelRoleName5}', '{levelRoleLevel5}', '{levelRole6}', '{levelRoleName6}', '{levelRoleLevel6}', '{levelRole7}', '{levelRoleName7}', '{levelRoleLevel7}', '{levelRole8}', '{levelRoleName8}', '{levelRoleLevel8}', '{levelRole9}', '{levelRoleName9}', '{levelRoleLevel9}', '{levelRole10}', '{levelRoleName10}', '{levelRoleLevel10}', '{levelRole11}', '{levelRoleName11}', '{levelRoleLevel11}', '{levelRole12}', '{levelRoleName12}', '{levelRoleLevel12}', '{levelRole13}', '{levelRoleName13}', '{levelRoleLevel13}', '{levelRole14}', '{levelRoleName14}', '{levelRoleLevel14}', '{levelRole15}', '{levelRoleName15}', '{levelRoleLevel15}', '{levelRole16}', '{levelRoleName16}', '{levelRoleLevel16}', '{levelRole17}', '{levelRoleName17}', '{levelRoleLevel17}', '{levelRole18}', '{levelRoleName18}', '{levelRoleLevel18}', '{levelRole19}', '{levelRoleName19}', '{levelRoleLevel19}', '{levelRole20}', '{levelRoleName20}', '{levelRoleLevel20}']
    : levelUpActive
    ? ['{user}', '{username}', '{userAvatar}', '{level}', '{nextLevel}', '{rank}', '{guild}', '{progressBar}', '{progressPercent}', '{xp}', '{xpInLevel}', '{xpNeeded}', '{role}', '{roleText}']
    : botUpdatesActive
    ? ['{version}', '{updateCount}', '{changeCount}', '{change1}', '{changeVersion1}', '{changeDate1}', '{change2}', '{changeVersion2}', '{changeDate2}', '{change3}', '{changeVersion3}', '{changeDate3}', '{guild}']
    : levelUpInfoActive
    ? ['{guild}', '{rulesTitle}', '{rulesDescription}', '{rulesFooter}', '{rulesChatFieldName}', '{rulesChatFieldText}', '{rulesVoiceFieldName}', '{rulesVoiceFieldText}', '{rulesActivityFieldName}', '{rulesActivityFieldText}', '{rulesBonusFieldName}', '{rulesBonusFieldText}', '{rulesCurveFieldName}', '{rulesCurveFieldText}', '{rulesNoXpFieldName}', '{rulesNoXpFieldText}', '{rulesExcludedFieldName}', '{rulesExcludedFieldText}', '{noXpRoleNames}', '{excludedChannels}', '{excludedRoles}']
    : countingPanelActive
    ? ['{server}', '{count}', '{next}', '{lastCounter}', '{lastCounterName}', '{fails}', '{lastFail}', '{top1}', '{top2}', '{top3}', '{topValue1}', '{topValue2}', '{topValue3}', '{topMarker1}', '{topMarker2}', '{topMarker3}']
    : countingDmActive
    ? ['{server}', '{target}', '{targetMention}', '{limit}', '{hours}']
    : vipDmActive
    ? ['{server}', '{target}', '{targetMention}', '{tier}', '{price}', '{giver}', '{giverMention}', '{coins}', '{balance}', '{giverBalance}', '{targetBalance}', '{message}', '{messageBlock}', '{transactionId}', '{levels}', '{reason}']
    : pcvActive
    ? ['{server}', '{targetName}', '{target}', '{targetMention}', '{channel}', '{reason}', '{yes}', '{no}', '{progress}', '{remaining}', '{attending}', '{requester}', '{outcome}', '{outcomeText}', '{kickMinutes}', '{strikes}']
    : inactiveReminderActive
    ? ['{user}', '{username}', '{displayName}', '{guild}', '{server}', '{thresholdDays}']
    : activityPingInfoActive
    ? ['{server}', '{buttonLabel}']
    : ['{server}', '{period}', '{status}', '{completion}', '{range}', '{nextEvaluation}', '{chatFieldName}', '{voiceFieldName}', '{nextEvaluationFieldName}', '{rangeFieldName}', '{panelDescription}', '{chat1}', '{chat2}', '{chat3}', '{chatValue1}', '{chatValue2}', '{chatValue3}', '{chatMarker1}', '{chatMarker2}', '{chatMarker3}', '{voice1}', '{voice2}', '{voice3}', '{voiceValue1}', '{voiceValue2}', '{voiceValue3}', '{voiceMarker1}', '{voiceMarker2}', '{voiceMarker3}'])
    .map(function (entry) { return '<code>' + escapeHtml(entry) + '</code>'; }).join('');
  const heading = view?.querySelector('.page-head h1');
  const detail = view?.querySelector('.page-head h1 + p');
  if (heading) heading.textContent = tempVoiceActive ? 'TempVoice-Interface im Embed Studio.' : welcomeActive ? 'Willkommensnachricht im Embed Studio.' : boostActive ? 'Boost-Benachrichtigung im Embed Studio.' : boostTopActive ? 'Top-Booster-Liga im Embed Studio.' : vipPanelActive ? 'VIP-Panels im Embed Studio.' : vipDmActive ? 'VIP-DM im Embed Studio.' : workshopActive
    ? state.studioWorkshopItemId ? 'Workshop-Post individuell bearbeiten.' : 'Steam Workshop im Embed Studio.'
    : levelsActive ? 'Levelrollen-Panel im Embed Studio.'
    : levelUpActive ? 'Level-Up-Embed im Embed Studio.'
    : levelUpInfoActive ? 'Level-Up-Kanal-Info im Embed Studio.'
    : botUpdatesActive ? 'Bot-Updates-Embed im Embed Studio.'
    : countingPanelActive ? 'Zähl-Panel im Embed Studio.'
    : countingDmActive ? 'Zähl-Kanal-DM im Embed Studio.'
    : pcvActive ? 'Call-Moderation im Embed Studio.'
    : activityPingInfoActive ? 'Liga-Ping-Info im Embed Studio.' : activityActive ? 'Aktivitäts-Liga im Embed Studio.' : 'Embed Studio.';
  if (detail) detail.textContent = tempVoiceActive
    ? 'Gestalte das vollständige Interface. Die Vorschau zeigt Beispieldaten; echte Buttons und Live-Werte setzt der Bot beim Versand ein.'
    : welcomeActive
    ? 'Gestalte die automatische Begrüßung mit Live-Vorschau, Bildern, Feldern und mehreren Embeds.'
    : boostActive
    ? 'Gestalte das automatische Boost-Embed mit denselben Werkzeugen wie jedes andere Embed – inklusive {boostcount} für die aktuelle Boost-Zahl.'
    : boostTopActive
    ? 'Gestalte die automatische Top-Booster-Rangliste mit denselben Werkzeugen wie jedes andere Embed. Die Top-3-Zeilen setzt der Bot automatisch ein.'
    : vipPanelActive
    ? 'Gestalte das kombinierte VIP-Embed mit denselben Werkzeugen wie jedes andere Embed. Die Stufen-Felder mit Rang-Emojis und Mitgliederlisten setzt der Bot automatisch ein.'
    : vipDmActive
    ? 'Gestalte die VIP-DM-Benachrichtigung mit denselben Werkzeugen wie jedes andere Embed – Titel, Beschreibung, Farben, Bilder und Felder sind frei editierbar.'
    : workshopActive
    ? state.studioWorkshopItemId
      ? 'Titel, Text, Felder, Farben und Bilder gelten nur für diesen einen dauerhaften Forum-Post.'
      : 'Gestalte den vollständigen Mod-Katalog mit dem vorhandenen Editor und einer echten Steam-Datenvorschau.'
    : levelsActive ? 'Gestalte das Levelrollen-Panel mit denselben Werkzeugen wie jedes andere Embed. Die Rollenliste setzt der Bot automatisch ein.'
    : levelUpActive ? 'Gestalte die Levelaufstiegs-Nachricht mit denselben Werkzeugen wie jedes andere Embed. {user}, {level}, {rank} und {guild} werden automatisch ersetzt.'
    : botUpdatesActive ? 'Gestalte das Update-Embed mit denselben Werkzeugen wie jedes andere Embed. {version} und {guild} werden automatisch ersetzt.'
    : levelUpInfoActive ? 'Gestalte das dauerhafte Info-Embed des Level-Up-Kanals mit denselben Werkzeugen wie jedes andere Embed. {guild} und die {rules...}-Platzhalter werden automatisch ersetzt.'
    : countingPanelActive ? 'Gestalte das Zähl-Panel mit denselben Werkzeugen wie jedes andere Embed. Der aktuelle Stand bleibt über die Platzhalter automatisch live.'
    : countingDmActive ? 'Gestalte die Zähl-Kanal-DM mit denselben Werkzeugen wie jedes andere Embed – Titel, Beschreibung, Farben, Bilder und Felder sind frei editierbar.'
    : pcvActive ? 'Gestalte das Call-Moderations-Embed mit denselben Werkzeugen wie jedes andere Embed. Autor-Icon und Avatar setzt der Bot automatisch ein.'
    : activityPingInfoActive ? 'Gestalte bis zu zehn Info-Embeds. Der echte persönliche Ein/Aus-Button bleibt bei jeder Bearbeitung funktional erhalten.' : activityActive ? 'Gestalte die automatische Rangliste mit denselben Werkzeugen wie jedes andere Embed.' : 'Nachrichten mit Live-Vorschau erstellen, speichern, senden und später bearbeiten.';
  const save = document.getElementById('save-draft');
  const send = document.getElementById('send-studio-message');
  const sendSecondary = document.getElementById('send-studio-message-secondary');
  const edit = document.getElementById('edit-studio-message');
  const clear = document.getElementById('clear-content');
  if (save) save.textContent = tempVoiceActive ? 'Speichern & aktive Interfaces aktualisieren' : welcomeActive ? 'Willkommensvorlage speichern' : boostActive ? 'Boost-Vorlage speichern' : boostTopActive ? 'Top-3-Vorlage speichern' : vipPanelActive ? 'VIP-Panel-Vorlage speichern' : vipDmActive ? 'VIP-DM-Embed speichern' : workshopActive ? state.studioWorkshopItemId ? 'Einzelpost speichern' : 'Workshop-Vorlage speichern' : verifyActive ? 'Verify-Embed speichern' : levelsActive ? 'Levelrollen-Embed speichern' : levelUpActive ? 'Level-Up-Embed speichern' : levelUpInfoActive ? 'Kanal-Info-Embed speichern' : botUpdatesActive ? 'Update-Embed speichern' : countingPanelActive ? 'Zähl-Panel-Embed speichern' : countingDmActive ? 'DM-Embed speichern' : pcvActive ? 'Sektion speichern' : activityActive ? 'Liga-Vorlage speichern' : 'Entwurf speichern';
  if (send) send.textContent = tempVoiceActive ? 'Speichern & aktive Interfaces aktualisieren' : welcomeActive ? 'Willkommensvorlage übernehmen' : boostActive ? 'Boost-Vorlage übernehmen' : boostTopActive ? 'Speichern & Panel aktualisieren' : vipPanelActive ? 'Speichern & Panels aktualisieren' : vipDmActive ? 'VIP-DM-Embed speichern' : workshopActive ? state.studioWorkshopItemId ? 'Einzelpost aktualisieren' : 'Speichern & Katalog aktualisieren' : verifyActive ? 'Speichern & Panel aktualisieren' : levelsActive ? 'Speichern & Panel aktualisieren' : levelUpActive ? 'Level-Up-Embed übernehmen' : levelUpInfoActive ? 'Speichern & Kanal aktualisieren' : botUpdatesActive ? 'Speichern & Panel aktualisieren' : countingPanelActive ? 'Speichern & Panel aktualisieren' : countingDmActive ? 'DM-Embed speichern' : pcvActive ? 'Sektion speichern' : activityActive ? 'Speichern & Panel aktualisieren' : 'Mit Bot senden';
  if (sendSecondary) sendSecondary.textContent = tempVoiceActive ? 'Speichern & aktive Interfaces aktualisieren' : welcomeActive ? 'Willkommensvorlage übernehmen' : boostActive ? 'Boost-Vorlage übernehmen' : boostTopActive ? 'Speichern & Panel aktualisieren' : vipPanelActive ? 'Speichern & Panels aktualisieren' : vipDmActive ? 'VIP-DM-Embed speichern' : workshopActive ? state.studioWorkshopItemId ? 'Einzelpost aktualisieren' : 'Speichern & Katalog aktualisieren' : verifyActive ? 'Speichern & Panel aktualisieren' : levelsActive ? 'Speichern & Panel aktualisieren' : levelUpActive ? 'Level-Up-Embed übernehmen' : levelUpInfoActive ? 'Speichern & Kanal aktualisieren' : botUpdatesActive ? 'Speichern & Panel aktualisieren' : countingPanelActive ? 'Speichern & Panel aktualisieren' : countingDmActive ? 'DM-Embed speichern' : pcvActive ? 'Sektion speichern' : activityActive ? 'Speichern & Panel aktualisieren' : 'Mit Bot senden';
  if (edit) edit.hidden = active;
  if (clear) clear.textContent = tempVoiceActive ? 'TempVoice-Standard laden' : welcomeActive ? 'Welcome-Standard laden' : boostActive ? 'Boost-Standard laden' : boostTopActive ? 'Top-3-Standard laden' : vipPanelActive ? 'VIP-Panel-Standard laden' : vipDmActive ? 'VIP-DM-Standard laden' : workshopActive ? state.studioWorkshopItemId ? 'Globale Vorlage laden' : 'Workshop-Standard laden' : verifyActive ? 'Verify-Standard laden' : levelsActive ? 'Levelrollen-Standard laden' : levelUpActive ? 'Level-Up-Standard laden' : levelUpInfoActive ? 'Kanal-Info-Standard laden' : botUpdatesActive ? 'Update-Standard laden' : countingPanelActive ? 'Zähl-Panel-Standard laden' : countingDmActive ? 'DM-Standard laden' : pcvActive ? 'Standard der Sektion laden' : activityActive ? 'Liga-Standard laden' : 'Leeren';
  const channelLabel = document.getElementById('studio-channel')?.closest('label');
  if (channelLabel) channelLabel.hidden = tempVoiceActive;
  document.querySelectorAll('.studio-function-set, .reaction-role-studio').forEach(function (section) { section.hidden = tempVoiceActive || economyPanelActive; });
  const threadSection = document.querySelector('.thread-section');
  if (threadSection) threadSection.hidden = tempVoiceActive;
  const addEmbed = document.getElementById('add-studio-embed');
  const removeEmbed = document.getElementById('remove-studio-embed');
  if (addEmbed) addEmbed.hidden = tempVoiceActive;
  if (removeEmbed) removeEmbed.hidden = tempVoiceActive;
  const pcvSectionWrap = document.getElementById('studio-pcv-section-wrap');
  const pcvSectionSelect = document.getElementById('studio-pcv-section');
  if (pcvSectionWrap) pcvSectionWrap.hidden = !pcvActive;
  if (pcvActive && pcvSectionSelect) {
    const sections = [
      ['Alle öffentlichen Calls', [
        ['panel', 'Moderations-Panel'],
        ['vote', 'Laufende Abstimmung'],
        ['result', 'Ergebnis (beschlossen / abgelehnt)'],
        ['team', 'Team-Kanal-Meldung'],
        ['dm', 'DM an rausgeworfenes Mitglied'],
        ['release', 'Freigabe-DM (Sperre vorbei)']
      ]],
      ['2er Calls', [
        ['panel2', 'Moderations-Panel (2er)'],
        ['vote2', 'Laufende Abstimmung (2er)'],
        ['result2', 'Ergebnis (2er)'],
        ['team2', 'Team-Kanal-Meldung (2er)'],
        ['dm2', 'DM an rausgeworfenes Mitglied (2er)'],
        ['release2', 'Freigabe-DM (2er)']
      ]],
      ['3er Calls', [
        ['panel3', 'Moderations-Panel (3er)'],
        ['vote3', 'Laufende Abstimmung (3er)'],
        ['result3', 'Ergebnis (3er)'],
        ['team3', 'Team-Kanal-Meldung (3er)'],
        ['dm3', 'DM an rausgeworfenes Mitglied (3er)'],
        ['release3', 'Freigabe-DM (3er)']
      ]],
      ['4er Calls', [
        ['panel4', 'Moderations-Panel (4er)'],
        ['vote4', 'Laufende Abstimmung (4er)'],
        ['result4', 'Ergebnis (4er)'],
        ['team4', 'Team-Kanal-Meldung (4er)'],
        ['dm4', 'DM an rausgeworfenes Mitglied (4er)'],
        ['release4', 'Freigabe-DM (4er)']
      ]]
    ];
    const current = state.studioPcvSection || 'panel';
    pcvSectionSelect.innerHTML = sections.map(function (group) {
      return '<optgroup label="' + escapeHtml(group[0]) + '">' + group[1].map(function (entry) {
        return '<option value="' + entry[0] + '"' + (entry[0] === current ? ' selected' : '') + '>' + escapeHtml(entry[1]) + '</option>';
      }).join('') + '</optgroup>';
    }).join('');
    pcvSectionSelect.value = current;
  }
  document.querySelectorAll('#template-row [data-template]').forEach(function (button) {
    if (active) button.classList.toggle('active', button.dataset.template === state.studioSpecialTemplate);
  });
  if (economyPanelActive) window.FHCCEconomyPanelStudio.applyChrome();
  renderStudioEmbedTabs();
}
async function openWelcomeFarewellStudio() {
  if (!state.authenticated || !state.selectedGuildId) {
    toast('Wähle zuerst einen Server.', 'error');
    return;
  }
  if (!(await setView('studio'))) return;
  await refreshConfig(state.selectedGuildId);
  state.activeStudioMessageId = '';
  state.studioSourceMessage = null;
  loadStudioTemplate(welcomeFarewellStudioTemplate(state.config?.welcomeFarewell));
  renderDrafts();
  toast('Willkommensnachricht im bestehenden Embed Studio geöffnet.', 'success');
}

function publicCallVoteStudioSectionDetail(section) {
  const descriptions = {
    panel: 'Dieses Embed ist das dauerhafte Moderations-Panel in den ausgewählten öffentlichen Calls – inklusive „Rauswurf beantragen“-Button.',
    vote: 'Dieses Embed ist die laufende Rauswurf-Abstimmung. {remaining} wird jede Sekunde als echter Countdown aktualisiert, {progress} zeigt die aktuellen Stimmen.',
    result: 'Dieses Embed ist das Ergebnis nach dem Ende der Abstimmung („Rauswurf beschlossen / abgelehnt“). Die Nachricht wird nach der eingestellten Sekundenzahl automatisch gelöscht.',
    team: 'Dieses Embed wird bei jedem erfolgreichen Rauswurf mit Team-Rollen-Ping in den Team-Kanal gesendet.',
    dm: 'Dieses Embed wird dem rausgeworfenen Mitglied als DM geschickt – mit {targetName} als Autor (Avatar + Name) und allen Infos zum Rauswurf. {target} in der Beschreibung ist ein echter Ping.',
    release: 'Dieses Embed wird dem Mitglied als DM geschickt, sobald seine Call-Sperre abgelaufen ist – „Du kannst dem Call wieder beitreten“. {reason} zeigt den Grund, {kickMinutes} die Sperrdauer.',
    panel2: 'Dieses Embed ist das dauerhafte Moderations-Panel in den 2er-Calls. Eine „Dafür“-Stimme genügt für den Rauswurf.',
    vote2: 'Dieses Embed ist die laufende Rauswurf-Abstimmung in einem 2er-Call – eine „Dafür“-Stimme entscheidet.',
    result2: 'Dieses Embed ist das Ergebnis einer Abstimmung in einem 2er-Call („Rauswurf beschlossen / abgelehnt“).',
    team2: 'Dieses Embed wird bei einem erfolgreichen Rauswurf aus einem 2er-Call mit Team-Rollen-Ping in den Team-Kanal gesendet.',
    dm2: 'Dieses Embed wird dem Mitglied als DM geschickt, das aus einem 2er-Call entfernt wurde – mit {targetName} als Autor (Avatar + Name).',
    release2: 'Dieses Embed wird dem Mitglied als DM geschickt, sobald seine Call-Sperre aus einem 2er-Call abgelaufen ist – „Du kannst wieder beitreten“.',
    panel3: 'Dieses Embed ist das dauerhafte Moderations-Panel in den 3er-Calls. Zwei „Dafür“-Stimmen genügen für den Rauswurf.',
    vote3: 'Dieses Embed ist die laufende Rauswurf-Abstimmung in einem 3er-Call – zwei „Dafür“-Stimmen entscheiden.',
    result3: 'Dieses Embed ist das Ergebnis einer Abstimmung in einem 3er-Call („Rauswurf beschlossen / abgelehnt“).',
    team3: 'Dieses Embed wird bei einem erfolgreichen Rauswurf aus einem 3er-Call mit Team-Rollen-Ping in den Team-Kanal gesendet.',
    dm3: 'Dieses Embed wird dem Mitglied als DM geschickt, das aus einem 3er-Call entfernt wurde – mit {targetName} als Autor (Avatar + Name).',
    release3: 'Dieses Embed wird dem Mitglied als DM geschickt, sobald seine Call-Sperre aus einem 3er-Call abgelaufen ist – „Du kannst wieder beitreten“.',
    panel4: 'Dieses Embed ist das dauerhafte Moderations-Panel in den 4er-Calls. Drei „Dafür“-Stimmen genügen für den Rauswurf.',
    vote4: 'Dieses Embed ist die laufende Rauswurf-Abstimmung in einem 4er-Call – drei „Dafür“-Stimmen entscheiden.',
    result4: 'Dieses Embed ist das Ergebnis einer Abstimmung in einem 4er-Call („Rauswurf beschlossen / abgelehnt“).',
    team4: 'Dieses Embed wird bei einem erfolgreichen Rauswurf aus einem 4er-Call mit Team-Rollen-Ping in den Team-Kanal gesendet.',
    dm4: 'Dieses Embed wird dem Mitglied als DM geschickt, das aus einem 4er-Call entfernt wurde – mit {targetName} als Autor (Avatar + Name).',
    release4: 'Dieses Embed wird dem Mitglied als DM geschickt, sobald seine Call-Sperre aus einem 4er-Call abgelaufen ist – „Du kannst wieder beitreten“.'
  };
  return descriptions[String(section || 'panel')] || descriptions.panel;
}

// Löst eine publicCallVote-Design-Sektion auf. 2er-/3er-/4er-Sektionen
// (panel2/vote2/.../dm4) existieren in gespeicherten Configs aus älteren
// Versionen noch nicht – der Editor fällt dann auf die Basis-Sektion zurück
// (vote2 → vote), statt ein leeres Embed zu zeigen. Der Backend-Get liefert
// die Sektionen normalisiert mit; dieser Fallback ist das Sicherheitsnetz,
// damit der Studio-Editor NIE leer öffnet.
function resolvePublicCallVoteSection(design, sectionId) {
  const direct = design && typeof design === 'object' ? design[sectionId] : null;
  if (direct && typeof direct === 'object') return direct;
  const base = String(sectionId || 'panel').replace(/[234]$/, '');
  const fallback = design && typeof design === 'object' ? design[base] : null;
  return fallback && typeof fallback === 'object' ? fallback : {};
}

function publicCallVoteStudioTemplate(config) {
  const design = config?.design || {};
  const sectionId = state.studioPcvSection || 'panel';
  const section = resolvePublicCallVoteSection(design, sectionId);
  return {
    specialTemplate: 'publicCallVote',
    channelId: '',
    content: '',
    outsideImageUrl: '',
    outsideImageName: '',
    outsideImageSize: 0,
    outsideImageAttachment: null,
    embeds: [{
      title: section.title || '', url: section.url || '', description: section.description || '', color: section.color || '#2b2d31',
      authorName: section.authorName || '', authorIconUrl: section.authorIconUrl || '', thumbnailUrl: section.thumbnailUrl || '',
      imageUrl: section.imageUrl || '', footerText: section.footerText || '', footerIconUrl: section.footerIconUrl || '',
      timestamp: section.timestamp === true, fields: Array.isArray(section.fields) ? clone(section.fields).slice(0, 25) : []
    }],
    componentSet: 'none',
    reactionRoles: []
  };
}

function publicCallVotePreviewValue(value) {
  const guildName = state.guilds.find(function (guild) { return String(guild.id) === String(state.selectedGuildId); })?.name || 'FALLEN HEAVEN';
  return String(value || '')
    .replaceAll('{server}', guildName)
    .replaceAll('{guild}', guildName)
    .replaceAll('{targetName}', 'Max Muster')
    .replaceAll('{target}', '@MaxMuster')
    .replaceAll('{targetMention}', '@MaxMuster')
    .replaceAll('{channel}', '#Öffentlicher Call')
    .replaceAll('{reason}', 'Spam / Flood')
    .replaceAll('{yes}', '3')
    .replaceAll('{no}', '1')
    .replaceAll('{progress}', '✅ 3 dafür · ❌ 1 dagegen')
    .replaceAll('{remaining}', '42 Sek.')
    .replaceAll('{attending}', '6')
    .replaceAll('{requester}', 'Alice')
    .replaceAll('{outcome}', '✅ Rauswurf beschlossen')
    .replaceAll('{outcomeText}', String(state.config?.publicCallVote?.passedOutcomeText || 'wird entfernt'))
    .replaceAll('{kickMinutes}', '10')
    .replaceAll('{strikes}', '0');
}

function publicCallVotePreviewTemplate(template) {
  if (state.studioSpecialTemplate !== 'publicCallVote') return template;
  const preview = clone(template);
  preview.content = publicCallVotePreviewValue(preview.content);
  preview.embeds = (preview.embeds || [preview.embed || {}]).map(function (source) {
    const embed = clone(source);
    ['title', 'description', 'authorName', 'footerText'].forEach(function (key) { embed[key] = publicCallVotePreviewValue(embed[key]); });
    if (Array.isArray(embed.fields)) {
      embed.fields = embed.fields.map(function (field) {
        return { ...field, name: publicCallVotePreviewValue(field.name), value: publicCallVotePreviewValue(field.value) };
      });
    }
    return embed;
  });
  preview.embed = preview.embeds[0] || {};
  return preview;
}

async function openPublicCallVoteStudio(section) {
  if (!state.authenticated || !state.selectedGuildId) {
    toast('Wähle zuerst einen Server.', 'error');
    return;
  }
  if (!(await setView('studio'))) return;
  await refreshConfig(state.selectedGuildId);
  state.activeStudioMessageId = '';
  state.studioSourceMessage = null;
  state.studioPcvSection = ['panel', 'vote', 'result', 'team', 'dm', 'release', 'panel2', 'vote2', 'result2', 'team2', 'dm2', 'release2', 'panel3', 'vote3', 'result3', 'team3', 'dm3', 'release3', 'panel4', 'vote4', 'result4', 'team4', 'dm4', 'release4'].includes(String(section)) ? String(section) : 'panel';
  loadStudioTemplate(publicCallVoteStudioTemplate(state.config?.publicCallVote));
  renderDrafts();
  toast('Call-Moderation im bestehenden Embed Studio geöffnet.', 'success');
}

async function savePublicCallVoteStudioTemplate() {
  if (!state.authenticated || !state.selectedGuildId) {
    toast('Wähle zuerst einen Server.', 'error');
    return false;
  }
  const template = currentStudioTemplate();
  const validation = renderStudioLimits(template);
  if (!validation.valid) {
    toast(validation.errors[0], 'error');
    return false;
  }
  const section = state.studioPcvSection || 'panel';
  return saveStudioDesign({
    path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/public-call-vote/design',
    body: { section: section, template: { ...template, embeds: (template.embeds || [template.embed || {}]).slice(0, 1) } },
    errorMessage: 'Das Design der Call-Moderation konnte nicht gespeichert werden.',
    onSaved: function (result) {
      // result.config ist die volle Guild-Config – wir brauchen nur den
      // publicCallVote-Anteil mit dem aktualisierten Design.
      const savedCfg = result.config || {};
      state.config.publicCallVote = savedCfg.publicCallVote || state.config.publicCallVote;
      // Falls das Design im Patch direkt enthalten ist (result.design),
      // in die Config übernehmen damit die Vorschau sofort aktualisiert wird.
      if (result.design && state.config.publicCallVote) {
        state.config.publicCallVote.design = { ...state.config.publicCallVote.design, ...result.design };
      }
      loadStudioTemplate(publicCallVoteStudioTemplate(state.config.publicCallVote));
    },
    okMessage: 'Design-Sektion gespeichert. Live-Nachrichten werden automatisch aktualisiert.'
  });
}

async function openActivityRaceStudio(section) {
  if (!state.authenticated || !state.selectedGuildId) {
    toast('Wähle zuerst einen Server.', 'error');
    return;
  }
  if (!(await setView('studio'))) return;
  await refreshConfig(state.selectedGuildId);
  state.activeStudioMessageId = '';
  state.studioSourceMessage = null;
  const targetSection = ['weekly', 'monthly', 'ping-info'].includes(section) ? section : 'daily';
  loadStudioTemplate(window.FHCCActivityRaceStudio.studioTemplate(state.config?.activityRace, targetSection, state));
  renderDrafts();
  toast(targetSection === 'daily'
    ? 'Heute-Embed im Embed Studio geöffnet.'
    : targetSection === 'ping-info'
      ? 'Ping-Info-Panel im Embed Studio geöffnet.'
      : (targetSection === 'weekly' ? 'Wochen-Embed' : 'Monat-Embed') + ' im Embed Studio geöffnet.', 'success');
}

async function openSteamWorkshopStudio() {
  if (!state.authenticated || !state.selectedGuildId) {
    toast('Wähle zuerst einen Server.', 'error');
    return;
  }
  if (!(await setView('studio'))) return;
  await refreshConfig(state.selectedGuildId);
  state.activeStudioMessageId = '';
  state.studioSourceMessage = null;
  state.studioWorkshopItemId = '';
  state.studioWorkshopItemTitle = '';
  state.studioWorkshopItemTokens = null;
  state.studioWorkshopAssetMode = 'global';
  loadStudioTemplate(steamWorkshopStudioTemplate(state.config?.steamWorkshop));
  renderDrafts();
  toast('Steam Workshop im vorhandenen Embed Studio geöffnet.', 'success');
}

async function saveWelcomeFarewellStudioTemplate() {
  if (!state.authenticated || !state.selectedGuildId) {
    toast('Wähle zuerst einen Server.', 'error');
    return false;
  }
  const template = currentStudioTemplate();
  const validation = renderStudioLimits(template);
  if (!validation.valid) {
    toast(validation.errors[0], 'error');
    return false;
  }
  // Außenbild wie bei der Aktivitäts-Liga: lokal gespeicherte Datei (localAsset),
  // ein bereits gesendeter Discord-Anhang oder eine URL wird mitgespeichert,
  // damit das Bild beim nächsten Versand als echter Anhang erscheint.
  const welcomeTemplate = {
    content: String(template.content || '').slice(0, 2000),
    outsideImageUrl: String(template.outsideImageUrl || ''),
    outsideImageName: String(template.outsideImageName || ''),
    outsideImageSize: Number(template.outsideImageSize || 0),
    outsideImageAttachment: normalizeOutsideImageAttachment(template.outsideImageAttachment),
    removeOutsideImage: template.removeOutsideImage === true,
    embeds: (template.embeds || [template.embed || {}]).slice(0, 10).map(function (embed) {
      return {
        title: embed.title || '', url: embed.url || '', description: embed.description || '', color: embed.color || '#58b9ff',
        authorName: embed.authorName || '', authorIconUrl: embed.authorIconUrl || '', thumbnailUrl: embed.thumbnailUrl || '',
        imageUrl: embed.imageUrl || '', footerText: embed.footerText || '', footerIconUrl: embed.footerIconUrl || '',
        timestamp: embed.timestamp === true, fields: Array.isArray(embed.fields) ? clone(embed.fields).slice(0, 25) : []
      };
    }),
    sourceChannelId: String(state.config?.welcomeFarewell?.welcomeTemplate?.sourceChannelId || ''),
    sourceMessageId: String(state.config?.welcomeFarewell?.welcomeTemplate?.sourceMessageId || '')
  };
  const current = clone(state.config?.welcomeFarewell || {});
  const saved = await savePatch({ welcomeFarewell: { ...current, welcomeChannelId: template.channelId || current.welcomeChannelId || '', welcomeTemplate } }, 'Willkommensvorlage gespeichert. Sie wird beim nächsten passenden Rollenentzug verwendet.');
  if (saved) loadStudioTemplate(welcomeFarewellStudioTemplate(state.config?.welcomeFarewell));
  return saved;
}

async function saveActivityRaceStudioTemplate() {
  if (!state.authenticated || !state.selectedGuildId) {
    toast('Wähle zuerst einen Server.', 'error');
    return false;
  }
  const template = currentStudioTemplate();
  // Round-Trip: Titel, Beschreibung und Footer stehen im Editor als lesbarer
  // Text (z. B. „Heute“, Completion-Satz). Wurden sie nicht geändert (sie
  // entsprechen noch exakt der Auflösung), werden sie zurück auf ihre
  // Platzhalter gesetzt ({period}, {completion}, {panelDescription}) und
  // bleiben dynamisch. Die Felder zeigen bereits Platzhalter und werden
  // unverändert gespeichert.
  const raceSection = ['weekly', 'monthly', 'ping-info'].includes(state.studioActivityRaceSection) ? state.studioActivityRaceSection : 'daily';
  const raceConfig = state.config?.activityRace || {};
  const raceDesignKey = raceSection === 'weekly' ? 'panelDesignWeekly' : raceSection === 'monthly' ? 'panelDesignMonthly' : 'panelDesign';
  const raceRawEmbed = raceSection === 'ping-info' ? {} : raceConfig[raceDesignKey]?.embed || {};
  const roundTrip = function (editedValue, rawValue) {
    if (rawValue === undefined || rawValue === null) return false;
    return String(editedValue || '') === window.FHCCActivityRaceStudio.resolvePreview(String(rawValue), state);
  };
  if (template.embed && raceSection !== 'ping-info') {
    if (roundTrip(template.embed.title, Object.prototype.hasOwnProperty.call(raceRawEmbed, 'title') ? raceRawEmbed.title : '{period}')) {
      template.embed.title = Object.prototype.hasOwnProperty.call(raceRawEmbed, 'title') ? raceRawEmbed.title : '{period}';
    }
    if (Object.prototype.hasOwnProperty.call(raceRawEmbed, 'description')) {
      if (String(template.embed.description || '') === window.FHCCActivityRaceStudio.studioDescription(raceRawEmbed.description, raceConfig, raceSection, state)) {
        template.embed.description = raceRawEmbed.description;
      }
    } else if (String(template.embed.description || '') === window.FHCCActivityRaceStudio.resolvePreview('{completion}', state)) {
      template.embed.description = '{completion}';
    }
    if (roundTrip(template.embed.footerText, Object.prototype.hasOwnProperty.call(raceRawEmbed, 'footerText') ? raceRawEmbed.footerText : '{period} · nachvollziehbar und automatisch ausgewertet')) {
      template.embed.footerText = Object.prototype.hasOwnProperty.call(raceRawEmbed, 'footerText') ? raceRawEmbed.footerText : '{period} · nachvollziehbar und automatisch ausgewertet';
    }
  }
  const validation = renderStudioLimits(template);
  if (!validation.valid) {
    toast(validation.errors[0], 'error');
    return false;
  }
  if (raceSection !== 'ping-info' && (template.embed?.fields || []).length > 21) {
    toast('Die Liga reserviert vier Felder für Chat, Sprachchat, Auswertung und Zeitraum. Du kannst bis zu 21 eigene Felder ergänzen.', 'error');
    return false;
  }
  if (raceSection !== 'ping-info' && validation.totalEmbedCharacters > 5_000) {
    toast('Halte mindestens 1.000 Embed-Zeichen für die automatisch erzeugten Ranglisten frei.', 'error');
    return false;
  }
  if (!/^data:image\//i.test(String(template.outsideImageUrl || '')) && !template.outsideImageAttachment
    && template.outsideImageUrl && String(template.content || '').length + String(template.outsideImageUrl).length + 1 > 2_000) {
    toast('Nachricht und Außenbild-Link dürfen zusammen maximal 2.000 Zeichen enthalten.', 'error');
    return false;
  }
  return saveStudioDesign({
    path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/activity-race/design',
    body: { section: raceSection, template },
    errorMessage: 'Die Liga-Vorlage konnte nicht gespeichert werden.',
    onSaved: function (result) {
      state.config.activityRace = result.config?.activityRace || state.config.activityRace;
      loadStudioTemplate(window.FHCCActivityRaceStudio.studioTemplate(state.config.activityRace, state.studioActivityRaceSection, state));
    },
    okMessage: function (result) {
      return result.panel
        ? 'Liga-Vorlage gespeichert und Live-Panel aktualisiert.'
        : 'Liga-Vorlage gespeichert. Das Panel wird nach der Aktivierung automatisch erstellt.';
    }
  });
}

async function saveSteamWorkshopStudioTemplate() {
  if (!state.authenticated || !state.selectedGuildId) {
    toast('Wähle zuerst einen Server.', 'error');
    return false;
  }
  const template = currentStudioTemplate();
  const validation = renderStudioLimits(template);
  if (!validation.valid) {
    toast(validation.errors[0], 'error');
    return false;
  }
  if (state.studioEmbeds.length !== 1) {
    toast('Der Workshop-Katalog verwendet genau ein detailliertes Embed pro Mod.', 'error');
    return false;
  }
  if ((template.embed?.fields || []).length > 24 && state.config?.steamWorkshop?.showRating !== false) {
    toast('Die Steam-Bewertung reserviert ein Feld. Du kannst bis zu 24 eigene Felder ergänzen.', 'error');
    return false;
  }
  if (validation.totalEmbedCharacters > 5_700) {
    toast('Halte mindestens 300 Embed-Zeichen für die von Steam eingesetzten Daten frei.', 'error');
    return false;
  }
  template.workshopItemId = state.studioWorkshopItemId;
  template.workshopAssetMode = state.studioWorkshopAssetMode;
  const individual = Boolean(state.studioWorkshopItemId);
  return saveStudioDesign({
    path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/steam-workshop/' + (individual ? 'items/' + encodeURIComponent(state.studioWorkshopItemId) + '/design' : 'design'),
    body: { template },
    timeoutMs: 180000,
    errorMessage: 'Die Workshop-Vorlage konnte nicht gespeichert werden.',
    onSaved: function (result) {
      if (individual) {
        const savedItem = result.item || {};
        steamWorkshopStatusSnapshot ||= { items: [] };
        const items = Array.isArray(steamWorkshopStatusSnapshot.items) ? steamWorkshopStatusSnapshot.items : [];
        const index = items.findIndex(function (entry) { return String(entry.workshopId || '') === state.studioWorkshopItemId; });
        if (index >= 0) items[index] = savedItem;
        else items.push(savedItem);
        loadStudioTemplate(steamWorkshopStudioTemplate(state.config.steamWorkshop, savedItem));
      } else {
        state.config.steamWorkshop = result.config?.steamWorkshop || state.config.steamWorkshop;
        loadStudioTemplate(steamWorkshopStudioTemplate(state.config.steamWorkshop));
      }
    },
    okMessage: function (result) {
      if (individual) return 'Individuelles Workshop-Design gespeichert und genau dieser Forum-Post aktualisiert.';
      return result.sync
        ? 'Workshop-Vorlage gespeichert und alle Katalogeinträge aktualisiert.'
        : 'Workshop-Vorlage gespeichert. Nach der Modulaktivierung wird sie automatisch verwendet.';
    }
  });
}
function loadStudioTemplate(template) {
  const data = template || {};
  state.studioSpecialTemplate = ['economyPanel', 'welcomeFarewell', 'boostAnnounce', 'boostTop', 'vipPanel', 'vipDm', 'activityRace', 'steamWorkshop', 'memberVerify', 'levelsPanel', 'levelUp', 'levelUpInfo', 'botUpdates', 'publicCallVote', 'countingPanel', 'countingDm', 'inactiveReminder', 'tempVoiceInterface'].includes(data.specialTemplate) ? data.specialTemplate : '';
  state.studioActivityUsesPeriodColor = state.studioSpecialTemplate === 'activityRace' && data.activityRaceUsePeriodColor === true;
  state.studioActivityRaceSection = state.studioSpecialTemplate === 'activityRace' && ['weekly', 'monthly', 'ping-info'].includes(data.activityRaceSection) ? data.activityRaceSection : 'daily';
  state.studioWorkshopItemId = state.studioSpecialTemplate === 'steamWorkshop' ? String(data.workshopItemId || '') : '';
  state.studioWorkshopItemTitle = state.studioWorkshopItemId ? String(data.workshopItemTitle || '') : '';
  state.studioWorkshopItemTokens = state.studioWorkshopItemId && data.workshopItemTokens ? clone(data.workshopItemTokens) : null;
  state.studioWorkshopAssetMode = state.studioWorkshopItemId && ['global', 'item', 'none'].includes(data.workshopAssetMode) ? data.workshopAssetMode : 'global';
  const sourceEmbeds = Array.isArray(data.embeds) && data.embeds.length ? data.embeds : [data.embed || {}];
  state.studioEmbeds = sourceEmbeds.slice(0, 10).map(normalizeStudioEmbed);
  state.studioReactionRoles = (Array.isArray(data.reactionRoles) ? data.reactionRoles : []).map(normalizeStudioReactionRole);
  state.studioComponents = window.FHCCStudioComponents.normalizeRows(data.studioComponents || data.components);
  state.studioComponentSet = data.componentSet === 'heavenEconomy' ? 'heavenEconomy' : 'none';
  state.activeStudioEmbedIndex = Math.min(Math.max(0, Number(data.activeEmbedIndex || 0)), state.studioEmbeds.length - 1);
  const channel = document.getElementById('studio-channel');
  const content = document.getElementById('studio-content');
  state.selectedStudioChannelId = String(data.channelId || '');
  if (channel) channel.value = data.channelId || '';
  if (content) content.value = data.content || '';
  const threadName = document.getElementById('thread-name');
  if (threadName) threadName.value = String(data.forumPost?.name || '');
  const componentSet = document.getElementById('studio-component-set');
  if (componentSet) componentSet.value = state.studioComponentSet;
  const legacyOutside = data.outsideImageUrl || sourceEmbeds[0]?.outsideImageUrl || '';
  const legacyOutsideName = data.outsideImageName || sourceEmbeds[0]?.outsideImageName || '';
  // Außenbild-Vorschau erhalten: Wird beim erneuten Laden DIESELBE lokale
  // Bild-Referenz zurückgeliefert (z. B. nach „Speichern & Kanal aktualisieren“
  // ohne gewählten Kanal – der Server behält die lokale Datei bei), bleibt die
  // frisch gewählte Datei sichtbar statt aus der Vorschau zu verschwinden.
  // Erst wenn ein anderes Bild (oder gar keins) geladen wird, wird zurückgesetzt.
  const previousOutsideAttachment = studioOutsideImageAttachment;
  const previousPickedDataUrl = studioOutsideImagePickedDataUrl;
  studioOutsideImageAttachment = normalizeOutsideImageAttachment(data.outsideImageAttachment || sourceEmbeds[0]?.outsideImageAttachment);
  studioOutsideImageRemovalRequested = data.removeOutsideImage === true;
  studioOutsideImageExistingAttachment = !studioOutsideImageRemovalRequested && Boolean(studioOutsideImageAttachment || data.outsideImageNeedsReselect || sourceEmbeds[0]?.outsideImageNeedsReselect);
  const sameLocalAsset = Boolean(
    previousOutsideAttachment?.localAsset && studioOutsideImageAttachment?.localAsset &&
    previousOutsideAttachment.id && studioOutsideImageAttachment.id === previousOutsideAttachment.id
  );
  const keepPickedPreview = Boolean(previousPickedDataUrl && sameLocalAsset);
  const outside = document.getElementById('studio-outside-image');
  const outsideName = document.getElementById('studio-outside-image-name');
  const outsideSize = document.getElementById('studio-outside-image-size');
  if (outside) outside.value = legacyOutside || (keepPickedPreview ? previousPickedDataUrl : '');
  if (outsideName) outsideName.value = legacyOutsideName || studioOutsideImageAttachment?.name || '';
  if (outsideSize) outsideSize.value = String(data.outsideImageSize || sourceEmbeds[0]?.outsideImageSize || studioOutsideImageAttachment?.size || 0);
  studioOutsideImagePickedDataUrl = keepPickedPreview ? previousPickedDataUrl : '';
  updateOutsideImagePicker();
  writeStudioEmbedToForm(state.studioEmbeds[state.activeStudioEmbedIndex]);
  renderStudioEmbedTabs();
  renderStudioReactionRoles();
  renderStudioComponentSetPreview();
  renderStudioComponentsPreview();
  renderStudioSpecialTemplateUi();
  updatePreview();
}

function selectStudioEmbed(index) {
  const nextIndex = Number(index);
  if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= state.studioEmbeds.length || nextIndex === state.activeStudioEmbedIndex) return;
  syncActiveStudioEmbed();
  state.activeStudioEmbedIndex = nextIndex;
  writeStudioEmbedToForm(state.studioEmbeds[nextIndex]);
  renderStudioEmbedTabs();
  updatePreview();
}

function updatePreview() {
  const template = currentStudioTemplate();
  const previewTemplate = specialStudioPreviewTemplate(template);
  renderStudioLimits(template);
  renderStudioEmbedStack(template);
  renderStableStudioPreview(previewTemplate);
  const embed = previewTemplate.embed || {};
  const channel = state.studioChannels.find(function (entry) { return entry.id === template.channelId; });
  const channelName = document.getElementById('preview-channel-name');
  const content = document.getElementById('preview-content');
  const title = document.getElementById('preview-title');
  const description = document.getElementById('preview-description');
  const signature = document.getElementById('preview-signature');
  const author = document.getElementById('preview-author');
  const authorName = document.getElementById('preview-author-name');
  const authorIcon = document.getElementById('preview-author-icon');
  const thumbnail = document.getElementById('preview-thumbnail');
  const image = document.getElementById('preview-image');
  const outsideImage = document.getElementById('preview-outside-image');
  const footerIcon = document.getElementById('preview-footer-icon');
  const timestamp = document.getElementById('preview-timestamp');
  const fields = document.getElementById('preview-fields');
  const extraEmbeds = document.getElementById('preview-extra-embeds');
  if (channelName) channelName.textContent = channel ? channel.name : 'preview';
  if (content) content.textContent = previewTemplate.content || '';
  if (title) title.innerHTML = studioRichText(embed.title || 'Ohne Titel');
  if (description) description.innerHTML = studioRichText(embed.description || 'Keine Beschreibung.');
  if (signature) signature.innerHTML = studioRichText(embed.footerText || 'FALLEN HEAVEN');
  var embedLine = document.querySelector('.embed-line');
  if (embedLine) embedLine.style.background = embed.color || '#58b9ff';
  if (author && authorName && authorIcon) {
    author.hidden = !embed.authorName;
    authorName.textContent = embed.authorName || '';
    authorIcon.src = validImageUrl(embed.authorIconUrl) ? embed.authorIconUrl : 'assets/fallen-heaven-icon.png';
  }
  if (thumbnail) {
    thumbnail.hidden = !validImageUrl(embed.thumbnailUrl);
    thumbnail.src = validImageUrl(embed.thumbnailUrl) ? embed.thumbnailUrl : '';
  }
  if (image) {
    image.hidden = !validImageUrl(embed.imageUrl);
    image.src = validImageUrl(embed.imageUrl) ? embed.imageUrl : '';
  }
  if (outsideImage) {
    const outsideSource = previewTemplate.outsideImageUrl || studioOutsideImagePickedDataUrl || document.getElementById('studio-outside-image')?.value || previewTemplate.outsideImageAttachment?.url || embed.outsideImageUrl || '';
    outsideImage.hidden = !validImageUrl(outsideSource);
    outsideImage.src = validImageUrl(outsideSource) ? outsideSource : '';
  }
  renderStudioReactionPreview();
  renderStudioComponentSetPreview();
  renderStudioComponentsPreview();
  if (footerIcon) footerIcon.src = validImageUrl(embed.footerIconUrl) ? embed.footerIconUrl : 'assets/fallen-heaven-icon.png';
  if (timestamp) timestamp.hidden = !embed.timestamp;
  if (fields) {
    fields.innerHTML = (embed.fields || []).map(function (field) {
      return '<div class="embed-field' + (field.inline ? ' inline' : '') + '"><strong>' + studioRichText(field.name || '\u200b') + '</strong><span>' + studioRichText(field.value || '\u200b') + '</span></div>';
    }).join('');
  }
  if (extraEmbeds) {
    extraEmbeds.innerHTML = previewTemplate.embeds.map(function (item, index) {
      if (index === state.activeStudioEmbedIndex) return '';
      const itemFields = (item.fields || []).map(function (field) {
        return '<div class="embed-field' + (field.inline ? ' inline' : '') + '"><strong>' + studioRichText(field.name || '\u200b') + '</strong><span>' + studioRichText(field.value || '\u200b') + '</span></div>';
      }).join('');
      return '<div class="embed-preview studio-extra-embed" style="--studio-embed-color:' + escapeHtml(item.color || '#58b9ff') + '"><span class="embed-line" style="background:' + escapeHtml(item.color || '#58b9ff') + '"></span><div class="embed-content">' +
        (item.authorName ? '<div class="embed-author"><img src="' + escapeHtml(validImageUrl(item.authorIconUrl) ? item.authorIconUrl : 'assets/fallen-heaven-icon.png') + '" alt=""><span>' + studioRichText(item.authorName) + '</span></div>' : '') +
        '<h3>' + studioRichText(item.title || 'Ohne Titel') + '</h3><p>' + studioRichText(item.description || 'Keine Beschreibung.') + '</p><div class="embed-fields">' + itemFields + '</div>' +
        (validImageUrl(item.imageUrl) ? '<img class="embed-image" src="' + escapeHtml(item.imageUrl) + '" alt="">' : '') +
        '<div class="embed-footer"><img src="' + escapeHtml(validImageUrl(item.footerIconUrl) ? item.footerIconUrl : 'assets/fallen-heaven-icon.png') + '" alt=""><span>' + studioRichText(item.footerText || '') + '</span>' + (item.timestamp ? '<time>Heute</time>' : '') + '</div>' +
        (validImageUrl(item.thumbnailUrl) ? '<img class="embed-thumbnail" src="' + escapeHtml(item.thumbnailUrl) + '" alt="">' : '') + '</div></div>';
    }).join('');
  }
  const editButton = document.getElementById('edit-studio-message');
  if (editButton) editButton.disabled = !state.activeStudioMessageId;
  renderStudioMessageEmojiPreview();
}

function currentDraft() {
  const template = currentStudioTemplate();
  return {
    id: makeId('draft'),
    type: 'draft',
    title: template.embed.title || 'Unbenannter Entwurf',
    color: template.embed.color || '#58b9ff',
    template,
    createdAt: new Date().toLocaleString('de-DE')
  };
}

function renderDrafts() {
  const container = document.getElementById('draft-list');
  if (!container) return;
  const countNode = document.getElementById('draft-stat');
  if (countNode) countNode.textContent = String(state.drafts.length + state.studioMessages.length);
  const sentRows = state.studioMessages.map(function (entry) {
    const title = entry.template?.embed?.title || entry.title || 'Gesendete Nachricht';
    const channel = state.studioChannels.find(function (item) { return item.id === entry.channelId; });
    return '<div class="draft-row-wrap">' +
      '<button class="draft-row sent ' + (entry.id === state.activeStudioMessageId ? 'active' : '') + '" data-studio-message="' + escapeHtml(entry.id) + '">' +
      '<span style="background:' + escapeHtml(entry.template?.embed?.color || '#58b9ff') + '"></span><div><strong>' + escapeHtml(title) + '</strong><small>Gesendet in #' + escapeHtml(channel?.name || entry.channelId || 'Kanal') + ' · ' + escapeHtml(entry.updatedAt || entry.sentAt || '') + '</small></div><i>EDIT</i></button>' +
      '<button class="draft-row-delete" type="button" data-delete-message="' + escapeHtml(entry.id) + '" title="Aus der Liste entfernen – die Nachricht bleibt in Discord" aria-label="Referenz entfernen">×</button></div>';
  });
  const draftRows = state.drafts.map(function (draft) {
    return '<div class="draft-row-wrap">' +
      '<button class="draft-row" data-draft="' + escapeHtml(draft.id) + '"><span style="background:' + escapeHtml(draft.color || draft.template?.embed?.color || '#58b9ff') + '"></span><div><strong>' + escapeHtml(draft.title || 'Entwurf') + (draft.id === 'autosave' ? ' <em class="draft-autosave-badge">AUTO</em>' : '') + '</strong><small>' + (draft.id === 'autosave' ? 'Automatisch gespeichert · ' : 'Entwurf · ') + escapeHtml(draft.createdAt || '') + '</small></div><i>LOAD</i></button>' +
      '<button class="draft-row-delete" type="button" data-delete-draft="' + escapeHtml(draft.id) + '" title="Entwurf löschen" aria-label="Entwurf löschen">×</button></div>';
  });
  container.innerHTML = sentRows.concat(draftRows).join('') || '<p class="empty-drafts">Noch keine Entwürfe oder gesendeten Bot-Nachrichten gespeichert.</p>';
}

function loadDraft(id) {
  const draft = state.drafts.find(function (item) { return item.id === id; });
  if (!draft) return;
  state.activeStudioMessageId = '';
  state.studioSourceMessage = null;
  if (draft.template) {
    loadStudioTemplate(draft.template);
  } else {
    loadStudioTemplate({
      content: '',
      embed: {
        title: draft.title,
        description: draft.description,
        color: draft.color,
        footerText: draft.signature
      }
    });
  }
  renderDrafts();
  toast('Entwurf geladen.', 'success');
}

function loadSentMessage(id) {
  const entry = state.studioMessages.find(function (item) { return item.id === id; });
  if (!entry) return;
  state.activeStudioMessageId = entry.id;
  loadStudioTemplate({ ...entry.template, messageId: entry.messageId, channelId: entry.channelId });
  renderDrafts();
  toast('Gesendete Nachricht geladen. Du kannst sie jetzt bearbeiten.', 'success');
}

function attachStudioTextCounter(input) {
  if (!input || input.dataset.studioCounterReady === 'true') return;
  const maximum = Number(input.maxLength);
  const label = input.closest('label');
  if (!label || !Number.isFinite(maximum) || maximum <= 0) return;

  input.dataset.studioCounterReady = 'true';
  label.classList.add('has-studio-text-counter');
  const counter = document.createElement('span');
  counter.className = 'studio-text-counter';
  counter.setAttribute('aria-hidden', 'true');
  // Bei Feldern mit Kopfzeile (z. B. „Nachricht über dem Embed“ mit Emoji-Button)
  // wandert der Zähler in die Kopfzeile vor den Button, statt absolut darüber zu
  // liegen (position: static via .studio-message-field .studio-text-counter).
  const heading = label.querySelector('.studio-field-heading');
  if (heading) {
    const headingButton = heading.querySelector('button');
    if (headingButton) heading.insertBefore(counter, headingButton);
    else heading.append(counter);
  } else {
    label.append(counter);
  }

  const update = function () {
    const length = String(input.value || '').length;
    counter.textContent = length.toLocaleString('de-DE') + ' / ' + maximum.toLocaleString('de-DE');
    counter.classList.toggle('near-limit', length >= Math.ceil(maximum * 0.9) && length < maximum);
    counter.classList.toggle('at-limit', length >= maximum);
  };
  input.addEventListener('input', update);
  update();
}

function initializeStudioTextCounters() {
  const studio = document.getElementById('studio-view');
  if (!studio) return;
  studio.querySelectorAll('input[maxlength],textarea[maxlength]').forEach(attachStudioTextCounter);
  const observer = new MutationObserver(function (mutations) {
    mutations.forEach(function (mutation) {
      mutation.addedNodes.forEach(function (node) {
        if (!(node instanceof Element)) return;
        if (node.matches('input[maxlength],textarea[maxlength]')) attachStudioTextCounter(node);
        node.querySelectorAll?.('input[maxlength],textarea[maxlength]').forEach(attachStudioTextCounter);
      });
    });
  });
  observer.observe(studio, { childList: true, subtree: true });
}
async function sendStudioMessage() {
  if (state.studioSpecialTemplate === 'economyPanel') { await window.FHCCEconomyPanelStudio.save({ state, currentStudioTemplate, renderStudioLimits, saveStudioDesign, loadStudioTemplate, toast }); return; }
  if (state.studioSpecialTemplate === 'tempVoiceInterface') {
    await tempVoiceUi.saveStudioTemplate();
    return;
  }
  if (state.studioSpecialTemplate === 'publicCallVote') {
    await savePublicCallVoteStudioTemplate();
    return;
  }
  if (state.studioSpecialTemplate === 'welcomeFarewell') {
    await saveWelcomeFarewellStudioTemplate();
    return;
  }
  if (state.studioSpecialTemplate === 'boostAnnounce') {
    await saveBoostAnnounceStudioTemplate();
    return;
  }
  if (state.studioSpecialTemplate === 'boostTop') {
    await saveBoostTopStudioTemplate();
    return;
  }
  if (state.studioSpecialTemplate === 'vipPanel') {
    await saveVipPanelStudioTemplate();
    return;
  }
  if (state.studioSpecialTemplate === 'vipDm') {
    await saveVipDmStudioTemplate();
    return;
  }
  if (state.studioSpecialTemplate === 'activityRace') {
    await saveActivityRaceStudioTemplate();
    return;
  }
  if (state.studioSpecialTemplate === 'steamWorkshop') {
    await saveSteamWorkshopStudioTemplate();
    return;
  }
  if (state.studioSpecialTemplate === 'memberVerify') {
    await saveMemberVerifyStudioTemplate();
    return;
  }
  if (state.studioSpecialTemplate === 'levelsPanel') {
    await saveLevelsStudioTemplate();
    return;
  }
  if (state.studioSpecialTemplate === 'levelUp') {
    await saveLevelUpStudioTemplate();
    return;
  }
  if (state.studioSpecialTemplate === 'levelUpInfo') {
    await saveLevelUpInfoStudioTemplate(true);
    return;
  }
  if (state.studioSpecialTemplate === 'botUpdates') {
    await saveBotUpdatesStudioTemplate();
    return;
  }
  if (state.studioSpecialTemplate === 'countingPanel') {
    await saveCountingStudioTemplate();
    return;
  }
  if (state.studioSpecialTemplate === 'countingDm') {
    await saveCountingDmStudioTemplate();
    return;
  }
  if (state.studioSpecialTemplate === 'inactiveReminder') {
    await saveInactiveReminderStudioTemplate();
    return;
  }
  if (!state.authenticated) { void beginLogin(); return; }
  if (!state.selectedGuildId) { toast('Wähle zuerst einen Server.', 'error'); return; }
  const template = currentStudioTemplate();
  if (!template.channelId) { toast('Wähle zuerst einen Textkanal.', 'error'); return; }
  const validation = renderStudioLimits(template);
  if (!validation.valid) { toast(validation.errors[0], 'error'); return; }
  const targetChannel = studioChannelMeta(template.channelId);
  const sendAsForumPost = isForumPostTarget(targetChannel);
  const forumPostName = forumPostTitleFromTemplate(template, targetChannel);
  const forumPostTags = sendAsForumPost ? selectedForumPostTagIds() : [];
  if (sendAsForumPost && targetChannel.requiresTag && !forumPostTags.length) {
    toast('Dieses Forum verlangt mindestens einen Tag. Wähle unten einen Forum-Tag aus.', 'error');
    return;
  }
  const sendButtons = [
    document.getElementById('send-studio-message'),
    document.getElementById('send-studio-message-secondary')
  ].filter(Boolean);
  sendButtons.forEach(function (button) {
    button.disabled = true;
    button.dataset.previousText = button.textContent;
    button.textContent = 'Sende ...';
  });
  const hasOutsideImage = Boolean(template.outsideImageUrl || template.outsideImageAttachment);
  const response = await api.apiRequest({
    path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + (sendAsForumPost ? '/thread/create' : '/embed/send'),
    method: 'POST',
    body: sendAsForumPost
      ? { parentChannelId: template.channelId, name: forumPostName, template: { ...template, channelId: template.channelId }, appliedTags: forumPostTags }
      : { template },
    timeoutMs: hasOutsideImage ? 120000 : 45000
  });
  if (!response.ok) {
    toast(response.data?.error || (sendAsForumPost ? 'Forum-Post konnte nicht erstellt werden.' : 'Nachricht konnte nicht gesendet werden.'), 'error');
    sendButtons.forEach(function (button) {
      button.disabled = false;
      button.textContent = button.dataset.previousText || (sendAsForumPost ? 'Forum-Post erstellen' : 'Mit Bot senden');
    });
    return;
  }
  const result = response.data.result || {};
  if (!result.messageId) {
    toast('Discord hat keine Message-ID zurückgegeben. Nachricht wurde nicht gespeichert.', 'error');
    sendButtons.forEach(function (button) {
      button.disabled = false;
      button.textContent = button.dataset.previousText || (sendAsForumPost ? 'Forum-Post erstellen' : 'Mit Bot senden');
    });
    return;
  }
  if (sendAsForumPost && result.id && !state.studioChannels.some(function (channel) { return channel.id === result.id; })) {
    state.studioChannels.push({
      id: result.id,
      name: result.name || forumPostName,
      parentId: result.parentId || template.channelId,
      parentName: result.parentName || targetChannel?.name || '',
      isThread: true
    });
    renderStudioChannels();
  }
  const outsideImageAttachment = normalizeOutsideImageAttachment(result.outsideImageAttachment);
  const storedTemplate = makeStudioTemplateStorageSafe({
    ...template,
    channelId: result.channelId || result.id || template.channelId,
    outsideImageAttachment,
    outsideImageName: outsideImageAttachment?.name || template.outsideImageName || '',
    outsideImageSize: outsideImageAttachment?.size || template.outsideImageSize || 0,
    outsideImageNeedsReselect: Boolean(/^data:image\//i.test(template.outsideImageUrl) && !outsideImageAttachment),
    removeOutsideImage: false
  });
  const record = {
    id: makeId('sent'),
    messageId: result.messageId,
    channelId: result.channelId || result.id || template.channelId,
    url: result.url || '',
    template: { ...storedTemplate, messageId: result.messageId, channelId: result.channelId || result.id || template.channelId },
    sentAt: new Date().toLocaleString('de-DE'),
    updatedAt: ''
  };
  state.studioMessages.unshift(record);
  state.activeStudioMessageId = record.id;
  persistStudioMessages();
  loadStudioTemplate(record.template);
  renderDrafts();
  toast(sendAsForumPost
    ? (result.url ? 'Forum-Post mit Embed wurde erstellt und gespeichert.' : 'Forum-Post mit Embed wurde erstellt.')
    : (result.url ? 'Nachricht wurde gesendet und gespeichert. Discord-Link ist in der Historie.' : 'Nachricht wurde gesendet und gespeichert.'), 'success');
  sendButtons.forEach(function (button) {
    button.disabled = false;
    button.textContent = button.dataset.previousText || (sendAsForumPost ? 'Forum-Post erstellen' : 'Mit Bot senden');
  });
}

async function editStudioMessage() {
  if (!state.activeStudioMessageId) { toast('Lade zuerst eine gesendete Nachricht aus der Liste.', 'info'); return; }
  // Die Nachricht kann aus der eigenen Historie stammen oder direkt aus der
  // Kanal-Ansicht geöffnet worden sein (studioSourceMessage). Beides editierbar.
  const source = state.studioSourceMessage || null;
  const record = state.studioMessages.find(function (item) { return item.id === state.activeStudioMessageId; }) || null;
  if (!source && !record) return;
  const template = currentStudioTemplate();
  const validation = renderStudioLimits(template);
  if (!validation.valid) { toast(validation.errors[0], 'error'); return; }
  template.messageId = source?.id || record.messageId;
  template.channelId = template.channelId || source?.channelId || record.channelId;
  const editButton = document.getElementById('edit-studio-message');
  if (editButton) {
    editButton.disabled = true;
    editButton.dataset.previousText = editButton.textContent;
    editButton.textContent = 'Speichert ...';
  }
  const response = await api.apiRequest({
    path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/embed/edit',
    method: 'POST',
    body: { template },
    timeoutMs: (template.outsideImageUrl || template.outsideImageAttachment) ? 120000 : 45000
  });
  if (!response.ok) {
    toast(response.data?.error || 'Nachricht konnte nicht bearbeitet werden.', 'error');
    if (editButton) {
      editButton.disabled = false;
      editButton.textContent = editButton.dataset.previousText || 'Gesendete Nachricht bearbeiten';
    }
    return;
  }
  const outsideImageAttachment = normalizeOutsideImageAttachment(response.data?.result?.outsideImageAttachment);
  const storedTemplate = makeStudioTemplateStorageSafe({
    ...template,
    outsideImageAttachment,
    outsideImageName: outsideImageAttachment?.name || '',
    outsideImageSize: outsideImageAttachment?.size || 0,
    outsideImageNeedsReselect: false,
    removeOutsideImage: false
  });
  if (record) {
    record.template = storedTemplate;
    record.channelId = template.channelId;
    record.updatedAt = new Date().toLocaleString('de-DE');
    persistStudioMessages();
  } else if (source) {
    // Aus der Kanal-Ansicht geöffnete Nachricht: nach erfolgreicher Bearbeitung
    // als Historie-Eintrag übernehmen, damit sie später erneut ladbar ist.
    state.studioMessages.unshift({
      id: makeId('msg'),
      type: 'sent',
      title: template.embed.title || 'Bearbeitete Nachricht',
      color: template.embed.color || '#58b9ff',
      messageId: source.id,
      channelId: template.channelId || source.channelId,
      template: storedTemplate,
      createdAt: new Date().toLocaleString('de-DE'),
      sentAt: new Date().toLocaleString('de-DE'),
      updatedAt: new Date().toLocaleString('de-DE')
    });
    persistStudioMessages();
  }
  loadStudioTemplate({ ...template, messageId: template.messageId, channelId: template.channelId });
  renderDrafts();
  toast('Gesendete Nachricht wurde bearbeitet.', 'success');
  if (editButton) {
    editButton.disabled = false;
    editButton.textContent = editButton.dataset.previousText || 'Gesendete Nachricht bearbeiten';
  }
}

async function createStudioThread() {
  if (!state.authenticated) { void beginLogin(); return; }
  if (!state.selectedGuildId) { toast('Wähle zuerst einen Server.', 'error'); return; }
  const parentChannelId = document.getElementById('thread-parent-channel')?.value || '';
  const name = document.getElementById('thread-name')?.value || '';
  const message = document.getElementById('thread-message')?.value || '';
  const status = document.getElementById('thread-status');
  const button = document.getElementById('create-thread');
  if (!parentChannelId) { toast('Wähle zuerst den Parent-Channel.', 'error'); return; }
  if (!name.trim()) { toast('Gib einen Thread-Namen ein.', 'error'); return; }
  const parentChannel = studioChannelMeta(parentChannelId);
  const createAsForumPost = isForumPostTarget(parentChannel);
  const appliedTags = createAsForumPost ? selectedForumPostTagIds() : [];
  if (createAsForumPost && parentChannel.requiresTag && !appliedTags.length) {
    toast('Dieses Forum verlangt mindestens einen Tag. Wähle unten einen Forum-Tag aus.', 'error');
    return;
  }
  const currentTemplate = createAsForumPost ? currentStudioTemplate() : null;
  const threadTemplate = createAsForumPost ? { ...currentTemplate, channelId: parentChannelId, content: message || currentTemplate.content, forumPost: { name, appliedTags } } : null;
  if (threadTemplate) {
    const validation = renderStudioLimits(threadTemplate);
    if (!validation.valid) { toast(validation.errors[0], 'error'); return; }
  }
  if (button) {
    button.disabled = true;
    button.dataset.previousText = button.textContent;
    button.textContent = 'Erstelle ...';
  }
  if (status) status.textContent = 'Thread wird über den Bot erstellt ...';
  const response = await api.apiRequest({
    path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/thread/create',
    method: 'POST',
    body: { parentChannelId, name, message, appliedTags, template: threadTemplate },
    timeoutMs: threadTemplate?.outsideImageUrl ? 120000 : 45000
  });
  if (button) {
    button.disabled = false;
    button.textContent = button.dataset.previousText || 'Thread erstellen';
  }
  if (!response.ok) {
    const problem = response.data?.error || 'Thread konnte nicht erstellt werden.';
    if (status) status.textContent = problem;
    toast(problem, 'error');
    return;
  }
  const thread = response.data.result || {};
  state.studioChannels.push({
    id: thread.id,
    name: thread.name,
    parentId: thread.parentId,
    parentName: thread.parentName,
    isThread: true
  });
  renderStudioChannels();
  const channelInput = document.getElementById('studio-channel');
  if (channelInput) channelInput.value = thread.id;
  updatePreview();
  if (status) status.textContent = 'Thread erstellt und als Ziel ausgewählt: ' + (thread.name || thread.id);
  toast('Thread erstellt und als Ziel ausgewählt.', 'success');
}

function timelineIcon(type) {
  const icons = {
    online: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 12 3 3 7-7"></path><circle cx="12" cy="12" r="9"></circle></svg>',
    offline: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 8.5 15.5 15.5M15.5 8.5l-7 7"></path><circle cx="12" cy="12" r="9"></circle></svg>',
    shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.6 2.9 7.8 7 10 4.1-2.2 7-5.4 7-10V6l-7-3Z"></path><path d="m9 12 2 2 4-4"></path></svg>',
    studio: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4zM8 9h8M8 13h5"></path></svg>',
    action: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v4m0 10v4M3 12h4m10 0h4"></path><circle cx="12" cy="12" r="4"></circle></svg>',
    ready: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16v10H4zM8 17v3m8-3v3M8 11h.01M12 11h4"></path></svg>'
  };
  return icons[type] || icons.ready;
}

function addTimelineEvent(event) {
  const now = new Date();
  const next = {
    type: event.type || 'ready',
    title: event.title || 'Aktivität aktualisiert',
    detail: event.detail || 'Control Center wurde aktualisiert',
    time: event.time || now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  };
  const previous = timeline[timeline.length - 1];
  if (previous && previous.type === next.type && previous.title === next.title && previous.detail === next.detail) {
    previous.time = next.time;
  } else {
    timeline.push(next);
    if (timeline.length > 24) timeline.splice(0, timeline.length - 24);
  }
  renderTimeline();
}

function renderTimeline() {
  const container = document.getElementById('timeline');
  if (!container) return;
  const entries = timeline.slice(-4).reverse();
  const signature = JSON.stringify(entries);
  if (signature === timelineRenderSignature && container.childElementCount) return;
  timelineRenderSignature = signature;
  container.innerHTML = entries.map(function (entry, index) {
    return '<div class="timeline-row timeline-' + escapeHtml(entry.type) + '" style="--timeline-index:' + index + '">' +
      '<span class="timeline-rail" aria-hidden="true"><i></i></span>' +
      '<span class="timeline-icon">' + timelineIcon(entry.type) + '</span>' +
      '<div class="timeline-copy"><span><strong>' + escapeHtml(entry.title) + '</strong><time>' + escapeHtml(entry.time) + '</time></span><small>' + escapeHtml(entry.detail) + '</small></div>' +
    '</div>';
  }).join('');
}

async function loadLogs() {
  const logsOutput = document.getElementById('logs-output');
  if (!logsOutput) return;
  logsOutput.textContent = await api.getLogs();
}

function formatSystemBytes(value) {
  const bytes = Math.max(0, Number(value || 0));
  if (bytes < 1024) return bytes + ' B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && size >= 1024; index += 1) {
    size /= 1024;
    unit = units[index];
  }
  return size.toLocaleString('de-DE', { maximumFractionDigits: size >= 100 ? 0 : 1 }) + ' ' + unit;
}

async function loadSystemCenter() {
  const status = document.getElementById('system-diagnostics-status');
  if (status) status.textContent = 'Systemzustand wird geprüft …';
  try {
    const [diagnostics, logs] = await Promise.all([api.getDiagnostics(), api.getLogs()]);
    const appVersion = document.getElementById('system-app-version');
    const botState = document.getElementById('system-bot-state');
    const securityState = document.getElementById('system-security-state');
    const storageTotal = document.getElementById('system-storage-total');
    const inventory = document.getElementById('system-data-inventory');
    const logsOutput = document.getElementById('logs-output');
    if (appVersion) appVersion.textContent = 'v' + (diagnostics?.app?.version || '–');
    if (botState) {
      botState.textContent = diagnostics?.bot?.ready ? 'Verbunden' : diagnostics?.bot?.active ? 'Wird verbunden' : 'Gestoppt';
      botState.dataset.state = diagnostics?.bot?.ready ? 'good' : diagnostics?.bot?.active ? 'pending' : 'neutral';
    }
    const protectedCount = Object.values(diagnostics?.protectedSecrets || {}).filter((value) => value === true).length;
    if (securityState) securityState.textContent = protectedCount ? protectedCount + ' geschützte Secret-Felder' : 'Keine Secrets im Export';
    const runtimeStorage = (diagnostics?.storage || []).find((entry) => entry.key === 'runtime');
    if (storageTotal) storageTotal.textContent = formatSystemBytes(runtimeStorage?.bytes || 0);
    if (inventory) {
      inventory.replaceChildren(...(diagnostics?.storage || []).filter((entry) => entry.key !== 'runtime').map((entry) => {
        const row = document.createElement('div');
        row.className = 'system-data-row';
        const meta = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = entry.label;
        const files = document.createElement('span');
        files.textContent = entry.files.toLocaleString('de-DE') + ' Dateien' + (entry.truncated ? ' · Erfassung begrenzt' : '');
        meta.append(name, files);
        const size = document.createElement('b');
        size.textContent = formatSystemBytes(entry.bytes);
        row.append(meta, size);
        return row;
      }));
    }
    if (logsOutput) logsOutput.textContent = logs || 'Noch keine Protokolle vorhanden.';
    if (status) status.textContent = 'Diagnose bereit · ' + new Date(diagnostics.createdAt).toLocaleString('de-DE');
  } catch (error) {
    if (status) status.textContent = 'Systemdaten konnten nicht vollständig geladen werden.';
    console.error('System Center konnte nicht geladen werden:', error);
  }
  await loadUpdateCenter();
}

let updateFolderState = '';
function formatUpdateSize(bytes) {
  if (!bytes) return '';
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

async function loadUpdateCenter() {
  const state = document.getElementById('system-update-state');
  const status = document.getElementById('update-status');
  const installButton = document.getElementById('update-install');
  try {
    const settings = await api.getUpdateSettings();
    updateFolderState = String(settings?.updateFolder || '');
    const folderInput = document.getElementById('update-folder');
    if (folderInput && folderInput.value !== updateFolderState) folderInput.value = updateFolderState;
    if (!updateFolderState) {
      if (state) { state.textContent = 'Nicht konfiguriert'; state.dataset.state = 'neutral'; }
      if (status) status.textContent = 'Kein Update-Ordner gesetzt. Trage den Ordner ein (z. B. C:\FHCC-Updates oder eine Netzwerkfreigabe) und speichere ihn – dort muss FHCC-Setup-<version>-x64.exe + latest.yml liegen.';
      if (installButton) installButton.disabled = true;
      return;
    }
    const result = await api.checkUpdate();
    if (state) {
      state.textContent = result.available ? 'Update verfügbar' : 'Aktuell';
      state.dataset.state = result.available ? 'good' : 'neutral';
    }
    if (status) {
      if (result.available) {
        status.textContent = 'Version ' + result.version + ' ist verfügbar (' + formatUpdateSize(result.size) + (result.releaseDate ? ' · ' + new Date(result.releaseDate).toLocaleDateString('de-DE') : '') + '). Installiert ist v' + result.current + '.';
      } else {
        status.textContent = result.reason === 'no-artifact' ? 'Im Update-Ordner wurde kein FHCC-Setup-Paket gefunden. Lege das neue Paket dort ab und suche erneut.' : 'Du bist auf dem neuesten Stand (v' + result.current + ').';
      }
    }
    if (installButton) installButton.disabled = !result.available;
  } catch (error) {
    if (state) { state.textContent = 'Fehler'; state.dataset.state = 'neutral'; }
    if (status) status.textContent = 'Update-Prüfung fehlgeschlagen: ' + String(error?.message || error);
    if (installButton) installButton.disabled = true;
  }
}

function toggleTheme() {
  const cycleOrder = ['dark', 'light', 'system'];
  const current = localStorage.getItem('fh-app-theme') || 'dark';
  const next = cycleOrder[(cycleOrder.indexOf(current) + 1) % cycleOrder.length];
  window.dispatchEvent(new CustomEvent('fallen-heaven:set-theme', { detail: { theme: next } }));
}

document.querySelectorAll('[data-view]').forEach(function (button) {
  button.addEventListener('click', function () { void setView(button.dataset.view); });
});
document.querySelectorAll('[data-login]').forEach(function (button) {
  button.addEventListener('click', function () { void beginLogin(); });
});
const openSetupTrigger = document.getElementById('open-secure-setup');
if (openSetupTrigger) {
  openSetupTrigger.addEventListener('click', function () {
    if (api && typeof api.openSetup === 'function') void api.openSetup();
  });
}
document.querySelectorAll('[data-public-target]').forEach(function (button) {
  button.addEventListener('click', function (event) {
    event.preventDefault();
    event.stopPropagation();
    const key = String(button.dataset.publicTarget || 'home');
    document.querySelectorAll('.nav_dd.w--open').forEach(function (menu) { menu.classList.remove('w--open'); });
    document.querySelectorAll('.nav_dd_trigger[aria-expanded="true"]').forEach(function (trigger) { trigger.setAttribute('aria-expanded', 'false'); });
    document.querySelectorAll('[data-public-feature-card]').forEach(function (card) { card.classList.toggle('spotlight', card.dataset.publicFeatureCard === key); });
    const target = key === 'home' ? document.getElementById('home-view') : document.getElementById('public-' + key);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: key === 'home' ? 'start' : 'center' });
  });
});
document.querySelectorAll('.landing-menu-button').forEach(function (button) {
  button.addEventListener('click', function (event) {
    event.stopPropagation();
    const menu = button.closest('.landing-menu');
    document.querySelectorAll('.landing-menu').forEach(function (item) {
      item.classList.toggle('open', item === menu && !item.classList.contains('open'));
      const trigger = item.querySelector('.nav_dd_trigger');
      if (trigger) trigger.setAttribute('aria-expanded', String(item.classList.contains('open')));
    });
  });
});
document.addEventListener('click', function (event) {
  if (!event.target.closest('.landing-menu')) {
    document.querySelectorAll('.landing-menu.open').forEach(function (item) { item.classList.remove('open'); });
  }
  const access = event.target.closest('.landing-access.attention');
  if (access) access.classList.remove('attention');
});
bindId('module-grid', 'click', async function (event) {
  const toggle = event.target.closest('[data-module-toggle]');
  if (toggle) { void toggleModule(toggle.dataset.moduleToggle); return; }
  const loginOnly = event.target.closest('[data-login-only]');
  if (loginOnly) { void beginLogin(); return; }
  const card = event.target.closest('[data-module]');
  if (card && state.authenticated) {
    if (card.dataset.module === state.activeFeatureId) return;
    if (!(await confirmDiscardModuleChanges())) return;
    selectModule(card.dataset.module);
  }
});
bindId('module-grid', 'keydown', function (event) {
  const card = event.target.closest('[data-module]');
  if (!card || !['Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  card.click();
});
bindId('module-search', 'input', function (event) {
  state.moduleQuery = event.target.value || '';
  renderModules({ renderConfig: false });
});
bindId('module-filter', 'click', function (event) {
  const button = event.target.closest('[data-module-filter]');
  if (!button) return;
  state.moduleFilter = button.dataset.moduleFilter || 'all';
  renderModules({ renderConfig: false });
});
bindId('enable-all', 'click', async function () {
  if (!state.authenticated) { void beginLogin(); return; }
  if (!(await confirmDiscardModuleChanges())) return;
  const patch = {};
  activeCatalog().forEach(function (item) {
    const id = normalizeModuleId(item && item[0]);
    if (!id) return;
    patch[id] = clone(state.config && state.config[id]) || {};
    patch[id].enabled = true;
  });
  await savePatch(patch, 'Alle Module aktiviert.');
});
bindId('guild-select', 'change', function (event) { void selectGuild(event.target.value); });
document.addEventListener('click', function (event) {
  const workspaceButton = event.target.closest('[data-workspace-open]');
  if (workspaceButton) {
    const mode = workspaceButton.dataset.workspaceOpen || 'discord';
    state.workspaceMode = mode;
    localStorage.setItem('fh-workspace-mode', mode);
    renderWorkspacePortal();
    if (mode === 'minecraft') {
      setView('skin');
      toast('Minecraft Skin Studio geöffnet.', 'success');
    } else {
      document.getElementById('workspace-guilds')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    return;
  }
  const workspaceGuild = event.target.closest('[data-workspace-guild]');
  if (workspaceGuild) {
    const nextGuildId = workspaceGuild.dataset.workspaceGuild || '';
    if (!nextGuildId) return;
    void selectGuild(nextGuildId).then(function () {
      setView('community');
      toast('Discord Server geöffnet.', 'success');
    });
  }
});
document.addEventListener('focusin', function (event) {
  const target = event.target;
  if (!target || target.closest('#studio-emoji-picker') || !target.closest('#studio-view')) return;
  if (target.matches('textarea, input[type="text"], input[type="url"]')) state.messageEmojiTarget = target;
});
bindId('studio-emoji-open', 'click', openMessageEmojiPicker);
document.querySelectorAll('[data-emoji-close]').forEach(function (button) { button.addEventListener('click', closeMessageEmojiPicker); });
bindId('studio-emoji-search', 'input', renderMessageEmojiPicker);
bindId('studio-emoji-filters', 'click', function (event) {
  const button = event.target.closest('[data-emoji-filter]');
  if (!button) return;
  state.messageEmojiFilter = button.dataset.emojiFilter || 'all';
  document.querySelectorAll('[data-emoji-filter]').forEach(function (item) { item.classList.toggle('active', item === button); });
  renderMessageEmojiPicker();
});
bindId('studio-emoji-grid', 'click', function (event) {
  const button = event.target.closest('[data-message-emoji]');
  if (button) insertMessageEmoji(button.dataset.messageEmoji);
});
document.addEventListener('keydown', function (event) {
  if (event.key === 'Escape' && !document.getElementById('studio-emoji-picker')?.hidden) closeMessageEmojiPicker();
});
document.addEventListener('input', function (event) {
  if (event.target && event.target.id === 'studio-content') window.setTimeout(renderStudioMessageEmojiPreview, 0);
});
document.addEventListener('change', function (event) {
  if (event.target?.matches?.('#forum-post-options [data-forum-tag]')) updatePreview();
  if (event.target?.id === 'inactive-reminder-page-size') {
    FHCCInactiveReminderPanel.setPageSize([25, 50, 100].includes(Number(event.target.value)) ? Number(event.target.value) : 25);
    FHCCInactiveReminderPanel.setPage(0);
    void FHCCInactiveReminderPanel.refreshStatus();
  }
});

document.querySelectorAll('#studio-channel, #studio-content, #studio-title, #studio-url, #studio-description, #studio-signature, #studio-color, #studio-author-name, #studio-author-icon, #studio-thumbnail, #studio-image, #studio-footer-icon, #studio-timestamp').forEach(function (node) {
  const refresh = function () {
    if (node.id === 'studio-color' && state.studioSpecialTemplate === 'activityRace') state.studioActivityUsesPeriodColor = false;
    updatePreview();
  };
  node.addEventListener('input', refresh);
  node.addEventListener('change', refresh);
});
bindId('studio-outside-image-file', 'change', function (event) { void selectOutsideImageFile(event.target.files?.[0]); });
bindId('studio-outside-image-remove', 'click', clearOutsideImage);
bindId('studio-channel', 'change', function (event) {
  state.selectedStudioChannelId = String(event.target.value || '');
  renderForumPostControls();
  updatePreview();
});
bindId('thread-parent-channel', 'change', renderForumPostControls);
bindId('thread-name', 'input', renderForumPostControls);
bindId('studio-channel', 'pointerdown', function () {
  if (state.authenticated && state.selectedGuildId && !state.studioChannels.length) void loadStudioChannels(state.selectedGuildId);
});
bindId('studio-channel', 'focus', function () {
  if (state.authenticated && state.selectedGuildId && !state.studioChannels.length) void loadStudioChannels(state.selectedGuildId);
});

// ---------------------------------------------------------------------------
// Auto-Save des Embed Studios (nur freier Modus): Änderungen werden entprellt
// nach 2,5 s als „Automatisch gespeichert“-Entwurf lokal abgelegt – bei einem
// App-Absturz oder versehentlichem Schließen ist die Arbeit nicht mehr weg.
// ---------------------------------------------------------------------------
let studioAutosaveTimer = null;
function scheduleStudioAutosave() {
  if (state.studioSpecialTemplate) return; // Modul-Embeds speichert man bewusst
  if (!document.getElementById('studio-view')?.classList.contains('active')) return;
  if (studioAutosaveTimer) return;
  studioAutosaveTimer = setTimeout(function () {
    studioAutosaveTimer = null;
    try {
      const draft = currentDraft();
      draft.id = 'autosave';
      draft.title = (draft.title || 'Entwurf').slice(0, 40) + (String(draft.title || '').length > 40 ? '…' : '');
      state.drafts = state.drafts.filter(function (entry) { return entry.id !== 'autosave'; });
      state.drafts.unshift(makeStudioTemplateStorageSafe(draft));
      state.drafts = state.drafts.slice(0, 12);
      localStorage.setItem('fh-native-drafts', JSON.stringify(state.drafts));
    } catch (error) { /* Auto-Save darf nie crashen */ }
  }, 2500);
}
bindId('studio-view', 'input', scheduleStudioAutosave);
bindId('studio-view', 'change', scheduleStudioAutosave);

// Tastatur-Shortcuts: Strg+S = Speichern (Modul-Vorlage bzw. Entwurf),
// Strg+Shift+S = Entwurf speichern, Strg+Enter = Senden/Speichern & Panel.
document.addEventListener('keydown', function (event) {
  if (!(event.ctrlKey || event.metaKey)) return;
  if (!document.getElementById('studio-view')?.classList.contains('active')) return;
  const key = event.key.toLowerCase();
  if (key === 's') {
    event.preventDefault();
    const primary = document.getElementById('send-studio-message');
    if (event.shiftKey) {
      const saveDraftButton = document.getElementById('save-draft');
      if (saveDraftButton) saveDraftButton.click();
    } else if (state.studioSpecialTemplate && primary) {
      primary.click();
    } else {
      const saveDraftButton = document.getElementById('save-draft');
      if (saveDraftButton) saveDraftButton.click();
    }
    return;
  }
  if (key === 'enter') {
    const target = event.target;
    const inTextarea = Boolean(target && target.tagName === 'TEXTAREA');
    if (!inTextarea) return;
    event.preventDefault();
    const sendButton = document.getElementById('send-studio-message-secondary') || document.getElementById('send-studio-message');
    if (sendButton) sendButton.click();
  }
});

bindId('template-row', 'click', async function (event) {
  const button = event.target.closest('[data-template]');
  if (!button) return;
  if (!(await tempVoiceUi.confirmLeaveStudio())) return;
  if (['activityRace', 'steamWorkshop'].includes(button.dataset.template) && !state.selectedGuildId) {
    toast('Wähle zuerst einen Discord-Server für diese automatische Vorlage.', 'error');
    return;
  }
  document.querySelectorAll('#template-row [data-template]').forEach(function (item) { item.classList.toggle('active', item === button); });
  state.activeStudioMessageId = '';
  state.studioSourceMessage = null;
  if (button.dataset.template === 'activityRace') {
    loadStudioTemplate(window.FHCCActivityRaceStudio.studioTemplate(state.config?.activityRace, state.studioActivityRaceSection, state));
    renderDrafts();
    return;
  }
  if (button.dataset.template === 'steamWorkshop') {
    loadStudioTemplate(steamWorkshopStudioTemplate(state.config?.steamWorkshop));
    renderDrafts();
    return;
  }
  loadStudioTemplate(studioTemplates[button.dataset.template] || studioTemplates.welcome);
  renderDrafts();
});
bindId('studio-special-back', 'click', async function () {
  if (!(await tempVoiceUi.confirmLeaveStudio())) return;
  const button = document.querySelector('#template-row [data-template="welcome"]');
  document.querySelectorAll('#template-row [data-template]').forEach(function (item) { item.classList.toggle('active', item === button); });
  state.activeStudioMessageId = '';
  state.studioSourceMessage = null;
  loadStudioTemplate(studioTemplates.welcome);
  renderDrafts();
});
bindId('studio-pcv-section', 'change', function () {
  if (state.studioSpecialTemplate !== 'publicCallVote') return;
  state.studioPcvSection = document.getElementById('studio-pcv-section')?.value || 'panel';
  loadStudioTemplate(publicCallVoteStudioTemplate(state.config?.publicCallVote));
  renderDrafts();
});
bindId('studio-fields', 'input', function () {
  syncStudioFieldsFromDom();
  updatePreview();
});
bindId('studio-fields', 'change', function () {
  syncStudioFieldsFromDom();
  updatePreview();
});
bindId('studio-fields', 'click', function (event) {
  const button = event.target.closest('[data-remove-field]');
  if (!button) return;
  syncStudioFieldsFromDom();
  state.studioFields.splice(Number(button.dataset.removeField), 1);
  renderStudioFields();
  updatePreview();
});
bindId('studio-embed-tabs', 'click', function (event) {
  const button = event.target.closest('[data-studio-embed-tab]');
  if (button) selectStudioEmbed(Number(button.dataset.studioEmbedTab));
});
bindId('studio-reaction-role-list', 'input', function () { syncStudioReactionRolesFromDom(); renderStudioReactionPreview(); });
bindId('studio-reaction-role-list', 'change', function () { syncStudioReactionRolesFromDom(); renderStudioReactionPreview(); });
bindId('studio-reaction-role-list', 'click', function (event) {
  const pickerButton = event.target.closest('[data-pick-reaction-emoji]');
  if (pickerButton) {
    const target = pickerButton.closest('[data-reaction-role-row]')?.querySelector('[data-reaction-emoji]');
    openMessageEmojiPicker(target);
    return;
  }
  const button = event.target.closest('[data-remove-reaction-role]');
  if (!button) return;
  syncStudioReactionRolesFromDom();
  state.studioReactionRoles.splice(Number(button.dataset.removeReactionRole), 1);
  renderStudioReactionRoles();
});
bindId('add-studio-reaction-role', 'click', function () {
  syncStudioReactionRolesFromDom();
  state.studioReactionRoles.push(normalizeStudioReactionRole({ exclusive: true }));
  renderStudioReactionRoles();
});
bindId('studio-component-set', 'change', function () {
  state.studioComponentSet = document.getElementById('studio-component-set')?.value || 'none';
  renderStudioComponentSetPreview();
  updatePreview();
});
bindId('add-studio-embed', 'click', function () {
  syncActiveStudioEmbed();
  if (state.studioEmbeds.length >= 10) { toast('Discord erlaubt maximal 10 Embeds pro Nachricht.', 'error'); return; }
  state.studioEmbeds.push(normalizeStudioEmbed({ color: state.studioEmbeds[state.activeStudioEmbedIndex]?.color || '#58b9ff', footerText: 'FALLEN HEAVEN', timestamp: true }));
  selectStudioEmbed(state.studioEmbeds.length - 1);
});
bindId('remove-studio-embed', 'click', function () {
  syncActiveStudioEmbed();
  if (state.studioEmbeds.length <= 1) return;
  state.studioEmbeds.splice(state.activeStudioEmbedIndex, 1);
  state.activeStudioEmbedIndex = Math.min(state.activeStudioEmbedIndex, state.studioEmbeds.length - 1);
  writeStudioEmbedToForm(state.studioEmbeds[state.activeStudioEmbedIndex]);
  renderStudioEmbedTabs();
  updatePreview();
});
bindId('add-embed-field', 'click', function () {
  syncStudioFieldsFromDom();
  if (state.studioFields.length >= DISCORD_STUDIO_LIMITS.fields) { toast('Discord erlaubt maximal 25 Felder pro Embed.', 'error'); return; }
  state.studioFields.push({ name: 'Neues Feld', value: 'Wert eingeben', inline: false });
  renderStudioFields();
  updatePreview();
});
bindId('studio-embed-stack', 'click', function (event) {
  const target = event.target.closest('[data-stack-embed-index]');
  if (!target) return;
  selectStudioEmbed(Number(target.dataset.stackEmbedIndex));
});
bindId('preview-embed-stack', 'click', function (event) {
  const target = event.target.closest('[data-preview-embed-index]');
  if (!target) return;
  selectStudioEmbed(Number(target.dataset.previewEmbedIndex));
});
bindId('save-draft', 'click', function () {
  if (!state.authenticated) { void beginLogin(); return; }
  if (state.studioSpecialTemplate === 'economyPanel') { void window.FHCCEconomyPanelStudio.save({ state, currentStudioTemplate, renderStudioLimits, saveStudioDesign, loadStudioTemplate, toast }); return; }
  if (state.studioSpecialTemplate === 'tempVoiceInterface') {
    void tempVoiceUi.saveStudioTemplate();
    return;
  }
  if (state.studioSpecialTemplate === 'publicCallVote') {
    void savePublicCallVoteStudioTemplate();
    return;
  }
  if (state.studioSpecialTemplate === 'welcomeFarewell') {
    void saveWelcomeFarewellStudioTemplate();
    return;
  }
  if (state.studioSpecialTemplate === 'boostAnnounce') {
    void saveBoostAnnounceStudioTemplate();
    return;
  }
  if (state.studioSpecialTemplate === 'boostTop') {
    void saveBoostTopStudioTemplate();
    return;
  }
  if (state.studioSpecialTemplate === 'vipPanel') {
    void saveVipPanelStudioTemplate();
    return;
  }
  if (state.studioSpecialTemplate === 'vipDm') {
    void saveVipDmStudioTemplate();
    return;
  }
  if (state.studioSpecialTemplate === 'activityRace') {
    void saveActivityRaceStudioTemplate();
    return;
  }
  if (state.studioSpecialTemplate === 'steamWorkshop') {
    void saveSteamWorkshopStudioTemplate();
    return;
  }
  if (state.studioSpecialTemplate === 'memberVerify') {
    void saveMemberVerifyStudioTemplate();
    return;
  }
  if (state.studioSpecialTemplate === 'levelsPanel') {
    void saveLevelsStudioTemplate();
    return;
  }
  if (state.studioSpecialTemplate === 'levelUp') {
    void saveLevelUpStudioTemplate();
    return;
  }
  if (state.studioSpecialTemplate === 'levelUpInfo') {
    void saveLevelUpInfoStudioTemplate(false);
    return;
  }
  if (state.studioSpecialTemplate === 'botUpdates') {
    void saveBotUpdatesStudioTemplate();
    return;
  }
  if (state.studioSpecialTemplate === 'countingPanel') {
    void saveCountingStudioTemplate();
    return;
  }
  if (state.studioSpecialTemplate === 'countingDm') {
    void saveCountingDmStudioTemplate();
    return;
  }
  if (state.studioSpecialTemplate === 'inactiveReminder') {
    void saveInactiveReminderStudioTemplate();
    return;
  }
  state.drafts = state.drafts.filter(function (entry) { return entry.id !== 'autosave'; });
  state.drafts.unshift(makeStudioTemplateStorageSafe(currentDraft()));
  state.drafts = state.drafts.slice(0, 12);
  localStorage.setItem('fh-native-drafts', JSON.stringify(state.drafts));
  renderDrafts();
  toast('Draft lokal gespeichert.', 'success');
});
initializeStudioTextCounters();
bindId('draft-list', 'click', function (event) {
  const messageDelete = event.target.closest('[data-delete-message]');
  if (messageDelete) {
    const id = String(messageDelete.dataset.deleteMessage || '');
    state.studioMessages = state.studioMessages.filter(function (entry) { return entry.id !== id; });
    if (state.activeStudioMessageId === id) { state.activeStudioMessageId = ''; state.studioSourceMessage = null; }
    persistStudioMessages();
    renderDrafts();
    toast('Aus der Liste entfernt – die Nachricht bleibt in Discord.', 'success');
    return;
  }
  const draftDelete = event.target.closest('[data-delete-draft]');
  if (draftDelete) {
    const id = String(draftDelete.dataset.deleteDraft || '');
    state.drafts = state.drafts.filter(function (draft) { return draft.id !== id; });
    localStorage.setItem('fh-native-drafts', JSON.stringify(state.drafts));
    renderDrafts();
    toast('Entwurf gelöscht.', 'success');
    return;
  }
  const message = event.target.closest('[data-studio-message]');
  if (message) { loadSentMessage(message.dataset.studioMessage); return; }
  const target = event.target.closest('[data-draft]');
  if (target) loadDraft(target.dataset.draft);
});
bindId('copy-content', 'click', async function () {
  try {
    await navigator.clipboard.writeText(JSON.stringify(currentStudioTemplate(), null, 2));
    toast('JSON in die Zwischenablage kopiert.', 'success');
  } catch (error) {
    toast('Zwischenablage ist momentan nicht verfügbar.', 'error');
  }
});
bindId('clear-content', 'click', function () {
  state.activeStudioMessageId = '';
  state.studioSourceMessage = null;
  state.studioFields = [];
  if (state.studioSpecialTemplate === 'economyPanel') { loadStudioTemplate(window.FHCCEconomyPanelStudio.studioTemplate({ ...state.config?.heavenEconomy, panelTemplate: window.FHCCEconomyPanelStudio.defaultTemplate(), panelChannelId: document.getElementById('studio-channel')?.value || '' })); renderDrafts(); return; }
  if (state.studioSpecialTemplate === 'tempVoiceInterface') {
    loadStudioTemplate(tempVoiceUi.studioTemplate({ interfaceDesign: { embed: tempVoiceUi.defaultStudioEmbed() } }));
    renderDrafts();
    return;
  }
  if (state.studioSpecialTemplate === 'publicCallVote') {
    loadStudioTemplate(publicCallVoteStudioTemplate({ design: { [state.studioPcvSection || 'panel']: {} } }));
    renderDrafts();
    return;
  }
  if (state.studioSpecialTemplate === 'welcomeFarewell') {
    loadStudioTemplate(welcomeFarewellStudioTemplate({ welcomeChannelId: document.getElementById('studio-channel')?.value || '' }));
    renderDrafts();
    return;
  }
  if (state.studioSpecialTemplate === 'boostAnnounce') {
    loadStudioTemplate(boostAnnounceStudioTemplate({ boostAnnounceChannelId: document.getElementById('studio-channel')?.value || '' }));
    renderDrafts();
    return;
  }
  if (state.studioSpecialTemplate === 'boostTop') {
    loadStudioTemplate(boostTopStudioTemplate({ boostTopChannelId: document.getElementById('studio-channel')?.value || '' }));
    renderDrafts();
    return;
  }
  if (state.studioSpecialTemplate === 'vipPanel') {
    loadStudioTemplate(vipPanelStudioTemplate(state.config?.heavenEconomy));
    renderDrafts();
    return;
  }
  if (state.studioSpecialTemplate === 'activityRace') {
    loadStudioTemplate(window.FHCCActivityRaceStudio.studioTemplate({
      panelChannelId: document.getElementById('studio-channel')?.value || '',
      panelDesign: state.config?.activityRace?.panelDesign,
      panelDesignWeekly: state.config?.activityRace?.panelDesignWeekly,
      panelDesignMonthly: state.config?.activityRace?.panelDesignMonthly,
      pingInfoDesign: state.config?.activityRace?.pingInfoDesign,
      pingToggleButtonLabel: state.config?.activityRace?.pingToggleButtonLabel
    }, state.studioActivityRaceSection, state));
    renderDrafts();
    return;
  }
  if (state.studioSpecialTemplate === 'steamWorkshop') {
    if (state.studioWorkshopItemId) {
      loadStudioTemplate(steamWorkshopStudioTemplate(state.config?.steamWorkshop, {
        workshopId: state.studioWorkshopItemId,
        title: state.studioWorkshopItemTitle,
        tokens: state.studioWorkshopItemTokens,
        designOverride: null,
        assetMode: 'global',
        threadNameOverride: ''
      }));
    } else {
      loadStudioTemplate(steamWorkshopStudioTemplate({ forumChannelId: document.getElementById('studio-channel')?.value || '' }));
    }
    renderDrafts();
    return;
  }
  if (state.studioSpecialTemplate === 'levelsPanel') {
    loadStudioTemplate(levelsStudioTemplate({
      levelRolesPanelChannelId: document.getElementById('studio-channel')?.value || ''
    }));
    renderDrafts();
    return;
  }
  if (state.studioSpecialTemplate === 'levelUp') {
    loadStudioTemplate(levelUpStudioTemplate(state.config || {}));
    renderDrafts();
    return;
  }
  if (state.studioSpecialTemplate === 'botUpdates') {
    loadStudioTemplate(botUpdatesStudioTemplate({ channelId: document.getElementById('studio-channel')?.value || '' }));
    renderDrafts();
    return;
  }
  if (state.studioSpecialTemplate === 'levelUpInfo') {
    loadStudioTemplate(levelUpInfoStudioTemplate(state.config || {}));
    renderDrafts();
    return;
  }
  if (state.studioSpecialTemplate === 'countingDm') {
    loadStudioTemplate(countingDmStudioTemplate(state.config?.counting, state.studioCountingDmSection || 'strikeLock'));
    renderDrafts();
    return;
  }
  if (state.studioSpecialTemplate === 'vipDm') {
    loadStudioTemplate(vipDmStudioTemplate(state.config?.heavenEconomy, state.studioVipDmSection || 'giftReceived'));
    renderDrafts();
    return;
  }
  loadStudioTemplate({ content: '', embed: { title: '', description: '', color: '#58b9ff', footerText: 'FALLEN HEAVEN', timestamp: true, fields: [] } });
  renderDrafts();
  updatePreview();
});
bindId('send-studio-message', 'click', function () { void sendStudioMessage(); });
bindId('send-studio-message-secondary', 'click', function () { void sendStudioMessage(); });
bindId('edit-studio-message', 'click', function () { void editStudioMessage(); });
bindId('create-thread', 'click', function () { void createStudioThread(); });
bindId('refresh-logs', 'click', function () { void loadLogs(); });
bindId('refresh-system', 'click', function () { void loadSystemCenter(); });
bindId('update-check', 'click', function () { void loadUpdateCenter(); });
bindId('update-folder-save', 'click', async function () {
  const folderInput = document.getElementById('update-folder');
  const folder = String(folderInput?.value || '').trim();
  if (!folder) {
    toast('Bitte einen Update-Ordner eintragen.', 'error');
    return;
  }
  const settings = await api.setUpdateSettings({ updateFolder: folder });
  if (String(settings?.updateFolder || '') === folder) {
    toast('Update-Ordner gespeichert.', 'success');
    void loadUpdateCenter();
  } else {
    toast('Update-Ordner konnte nicht gespeichert werden.', 'error');
  }
});
bindId('update-install', 'click', async function () {
  if (!window.fallenHeavenConfirm) {
    toast('Bestätigung nicht verfügbar.', 'error');
    return;
  }
  const confirmed = await window.fallenHeavenConfirm('Update wirklich installieren?', 'Die App wird still aktualisiert und danach neu gestartet. Gespeicherte Einstellungen und Daten bleiben erhalten.', 'Ja, installieren');
  if (!confirmed) return;
  const status = document.getElementById('update-status');
  if (status) status.textContent = 'Update wird installiert … die App startet gleich neu.';
  const result = await api.installUpdate();
  if (!result?.ok) {
    toast(result?.error || 'Update konnte nicht installiert werden.', 'error');
    if (status) status.textContent = result?.error || 'Update konnte nicht installiert werden.';
    void loadUpdateCenter();
  }
});
bindId('update-open-folder', 'click', async function () {
  if (!updateFolderState) {
    toast('Kein Update-Ordner gesetzt.', 'error');
    return;
  }
  const result = await api.openUpdateFolder();
  if (!result?.ok) toast(result?.error || 'Update-Ordner konnte nicht geöffnet werden.', 'error');
});
bindId('export-diagnostics', 'click', async function () {
  const result = await api.exportDiagnostics();
  if (result?.canceled) return;
  toast(result?.ok ? 'Sichere Diagnose wurde gespeichert.' : 'Diagnose konnte nicht gespeichert werden.', result?.ok ? 'success' : 'error');
});
bindId('open-data-folder', 'click', async function () {
  const result = await api.openDataFolder();
  if (!result?.ok) toast(result?.error || 'Datenordner konnte nicht geöffnet werden.', 'error');
});
bindId('open-log-folder', 'click', async function () {
  const result = await api.openLogFolder();
  if (!result?.ok) toast(result?.error || 'Logordner konnte nicht geöffnet werden.', 'error');
});
bindId('system-theme', 'click', function (event) {
  event.currentTarget?.blur?.();
  document.getElementById('theme-toggle')?.click();
});
document.querySelectorAll('#app-edit-brand, #app-edit-subtitle, #app-edit-hero, #app-edit-lead, #app-edit-accent, #app-edit-background, #app-edit-density, #app-edit-motion, #app-edit-page-kicker, #app-edit-page-title, #app-edit-page-lead').forEach(function (node) {
  node.addEventListener('input', function () {
    appEditorSettings = FHCCAppEditor.readAppEditorForm();
    FHCCAppEditor.applyAppEditorSettings(appEditorSettings);
    FHCCAppEditor.setAppEditorStatus('Live-Vorschau aktualisiert. Speichern übernimmt die Einstellung dauerhaft.');
  });
  node.addEventListener('change', function () {
    appEditorSettings = FHCCAppEditor.readAppEditorForm();
    FHCCAppEditor.applyAppEditorSettings(appEditorSettings);
  });
});
bindId('app-edit-page', 'change', function () {
  const previousPage = FHCCAppEditor.getActivePage() || appEditorSettings.selectedPage || 'home';
  const nextPage = FHCCAppEditor.appEditorValue('app-edit-page') || 'home';
  appEditorSettings = FHCCAppEditor.readAppEditorForm(previousPage);
  appEditorSettings.selectedPage = nextPage;
  FHCCAppEditor.setActivePage(nextPage);
  FHCCAppEditor.syncAppEditorPageForm();
  FHCCAppEditor.applyAppEditorSettings(appEditorSettings);
  const selectedLabel = document.getElementById('app-edit-page')?.selectedOptions?.[0]?.textContent || nextPage;
  FHCCAppEditor.setAppEditorStatus('Seite ausgewählt. Du bearbeitest jetzt: ' + selectedLabel + '.');
});
bindId('app-editor-save', 'click', FHCCAppEditor.saveAppEditorSettings);
bindId('app-editor-reset', 'click', FHCCAppEditor.resetAppEditorSettings);
bindId('app-editor-expand', 'click', function () {
  const editorView = document.getElementById('editor-view');
  if (!editorView) return;
  const expanded = editorView.classList.toggle('editor-focus');
  this.textContent = expanded ? 'Editor anzeigen' : 'Vorschau maximieren';
  FHCCAppEditor.setAppEditorStatus(expanded ? 'Große Seitenvorschau aktiv. Mit dem Button kommst du zu den Editor-Feldern zurück.' : 'Editor-Felder wieder eingeblendet.');
});
bindId('command-palette-open', 'click', openCommandPalette);
bindId('command-palette-search', 'input', renderCommandPalette);
bindId('command-palette-results', 'click', function (event) {
  const button = event.target.closest('[data-command-kind]');
  if (button) void activateCommand(button.dataset.commandKind, button.dataset.commandId);
});
bindId('command-palette-search', 'keydown', function (event) {
  const buttons = Array.from(document.querySelectorAll('#command-palette-results .command-result'));
  if (!buttons.length) return;
  const current = Math.max(0, buttons.findIndex(function (button) { return button.classList.contains('active'); }));
  if (event.key === 'Enter') {
    event.preventDefault();
    buttons[current].click();
    return;
  }
  if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === 'ArrowDown' ? (current + 1) % buttons.length : (current - 1 + buttons.length) % buttons.length;
  buttons.forEach(function (button, index) { button.classList.toggle('active', index === next); });
  buttons[next].scrollIntoView({ block: 'nearest' });
});
document.addEventListener('keydown', function (event) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase('de') === 'k') {
    event.preventDefault();
    openCommandPalette();
  }
});
api?.onCloseRequested?.(function () {
  void (async function () {
    const accepted = await confirmDiscardModuleChanges();
    api?.confirmClose?.(accepted);
  })();
});

var logoutButton = document.getElementById('discord-logout');
if (logoutButton) logoutButton.addEventListener('click', function () { void logoutDiscord(); });
bindId('hero-login', 'click', function () { void beginLogin(); });
bindId('bridge-login', 'click', function () { void beginLogin(); });
document.querySelector('.service-controls')?.addEventListener('click', function (event) {
  const button = event.target.closest('[data-action]');
  if (!button || !['start', 'stop', 'restart'].includes(button.dataset.action)) return;
  event.preventDefault();
  void controlBot(button.dataset.action);
});
bindId('minimize', 'click', function () { api?.minimize?.(); });
bindId('maximize', 'click', function () { api?.maximize?.(); });
bindId('close', 'click', function () { api?.close?.(); });

(async function () {
  try {
    if (!api && new URLSearchParams(location.search).has('preview')) {
      document.body.classList.remove('auth-restoring');
      document.getElementById('preboot-screen')?.setAttribute('aria-hidden', 'true');
      return;
    }
    document.body.dataset.theme = localStorage.getItem('fh-native-theme') || 'dark';
    FHCCAppEditor.applyAppEditorSettings(appEditorSettings);
    updateShellMode();
    const info = await api.getInfo();
    setText('app-version', 'v' + (info?.version || ''));
    setText('modern-login-version', 'v' + (info?.version || ''));
    loadStudioTemplate(studioTemplates.welcome);
    renderModules();
    await refreshStatus(true);
    const restoredSession = await refreshAuth({ startup: true });
    if (restoredSession === true) setView('center');
    else if (restoredSession === 'pending') setPrebootStatus('Discord-Daten werden nach dem Neustart geprüft …');
    else document.body.classList.add('access-open');
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => { renderStudioFields(); renderDrafts(); updatePreview(); renderTimeline(); }, { timeout: 2000 });
    } else {
      setTimeout(() => { renderStudioFields(); renderDrafts(); updatePreview(); renderTimeline(); }, 0);
    }
  } catch (error) {
    console.error('App-Initialisierung fehlgeschlagen:', error);
    document.body.classList.remove('auth-restoring', 'auth-busy');
    document.body.classList.add('auth-ready', 'access-open');
    document.getElementById('preboot-screen')?.setAttribute('aria-hidden', 'true');
    toast('Die App wurde mit eingeschränkten Funktionen gestartet. Details stehen im Systemprotokoll.', 'error');
  }
  // Auf schwacher Hardware seltener pollen (30 s statt 15 s) – der Status ändert
  // sich ohnehin selten, und jede Aktualisierung kostet Rendering-Zeit.
  const statusPollMs = FHCCAppEditor.detectWeakDevice() ? 30000 : 15000;
  window.FallenHeavenJobs.upsert('app-status-refresh', async function () {
    if (document.hidden) return;
    await refreshStatus(true);
  }, statusPollMs, { immediate: false, retryDelay: 5000, maxBackoff: 60000 });
  window.FallenHeavenJobs.upsert('boost-progress-refresh', function () {
    if (!document.hidden && state.activeFeatureId === 'boostRoles') {
      void refreshBoostProgress();
      void refreshBoostTopStatus();
    }
  }, 5000, { immediate: false, retryDelay: 5000, maxBackoff: 30000 });
  window.FallenHeavenJobs.upsert('vip-panels-refresh', function () {
    if (!document.hidden && state.activeFeatureId === 'heavenEconomy') void refreshVipPanelsStatus();
  }, 10000, { immediate: false, retryDelay: 5000, maxBackoff: 30000 });
  window.FallenHeavenJobs.upsert('rp-health-refresh', function () {
    if (!document.hidden && state.activeFeatureId === 'customRichPresence') void refreshRichPresenceHealth();
  }, 15000, { immediate: false, retryDelay: 5000, maxBackoff: 30000 });
})();

function fhWebflowDropdownInit() {
  document.querySelectorAll('.w-dropdown').forEach(function (dropdown) {
    if (dropdown.dataset.fhDropdownBound === '1') return;
    dropdown.dataset.fhDropdownBound = '1';
    const trigger = dropdown.querySelector('.w-dropdown-toggle, .nav_dd_trigger');
    const list = dropdown.querySelector('.w-dropdown-list, .nav_dd_list');
    const open = function () {
      dropdown.classList.add('w--open');
      if (trigger) { trigger.classList.add('w--open'); trigger.setAttribute('aria-expanded', 'true'); }
      if (list) list.classList.add('w--open');
    };
    const close = function () {
      dropdown.classList.remove('w--open');
      if (trigger) { trigger.classList.remove('w--open'); trigger.setAttribute('aria-expanded', 'false'); }
      if (list) list.classList.remove('w--open');
    };
    dropdown.addEventListener('mouseenter', open);
    dropdown.addEventListener('mouseleave', close);
    if (trigger) trigger.addEventListener('click', function (event) {
      event.preventDefault();
      if (trigger.classList.contains('w--open')) close(); else open();
    });
  });
}

document.addEventListener('DOMContentLoaded', fhWebflowDropdownInit);
/* Central Emoji Library - premium interaction layer */
(() => {
  const picker = document.getElementById('studio-emoji-picker');
  const grid = document.getElementById('studio-emoji-grid');
  const search = document.getElementById('studio-emoji-search');
  if (!picker || !grid || !search) return;

  const storageKey = () => `fallen-heaven:emoji-favorites:${state?.selectedGuildId || state?.selectedGuild?.id || 'global'}`;
  const readFavorites = () => {
    try { return new Set(JSON.parse(localStorage.getItem(storageKey()) || '[]')); }
    catch { return new Set(); }
  };
  const saveFavorites = (values) => localStorage.setItem(storageKey(), JSON.stringify([...values].slice(0, 250)));
  let favoritesOnly = false;
  let activeEmojiKey = '';
  let refreshQueued = false;
  let catalogPromise = null;
  let catalogRetries = 0;

  const toolbar = document.createElement('section');
  toolbar.className = 'emoji-library-pro-toolbar';
  toolbar.innerHTML = `
    <div class="emoji-library-context">
      <span class="emoji-library-context-icon" aria-hidden="true">✦</span>
      <div><strong id="emoji-library-target">Emoji auswählen</strong><small id="emoji-library-hint">Ein Klick fügt das Emoji direkt ein.</small></div>
    </div>
    <div class="emoji-library-actions">
      <span id="emoji-library-counts" class="emoji-library-counts"></span>
      <button type="button" id="emoji-library-favorites" class="emoji-library-favorite-filter" aria-pressed="false" title="Favoriten anzeigen">☆ Favoriten</button>
      <button type="button" id="emoji-library-reload" class="emoji-library-reload" title="Emoji-Bibliothek neu laden">↻</button>
    </div>`;
  const filters = document.getElementById('studio-emoji-filters');
  if (!filters) {
    return;
  }
  const filterShell = document.createElement('div');
  filterShell.className = 'emoji-library-filter-shell';
  filters.parentElement.insertBefore(filterShell, filters);
  filterShell.appendChild(filters);
  filterShell.appendChild(toolbar);

  const details = document.createElement('div');
  details.className = 'emoji-library-details';
  details.innerHTML = '<span>Mit den Pfeiltasten navigieren · Enter auswählen · F favorisieren</span>';
  const pickerFooter = picker.querySelector('.message-emoji-dialog > footer');
  if (pickerFooter) {
    pickerFooter.insertBefore(details, pickerFooter.firstChild);
  }

  const targetTitle = toolbar.querySelector('#emoji-library-target');
  const targetHint = toolbar.querySelector('#emoji-library-hint');
  const counts = toolbar.querySelector('#emoji-library-counts');
  const favoriteFilter = toolbar.querySelector('#emoji-library-favorites');
  const reload = toolbar.querySelector('#emoji-library-reload');

  const emojiCatalog = () => Array.isArray(state?.messageEmojis) ? state.messageEmojis : [];
  const keyForEmoji = (emoji) => String(emoji?.id || emoji?.key || emoji?.name || emoji?.mention || '');
  const keyForNode = (node) => {
    const button = node.closest?.('button, [data-message-emoji], [data-emoji-id], [data-emoji]') || node;
    const direct = button?.dataset?.messageEmoji || button?.dataset?.emojiId || button?.dataset?.emoji || button?.dataset?.id;
    if (direct) return String(direct);
    const image = button?.querySelector?.('img');
    const match = String(image?.src || '').match(/emojis\/(\d+)/i);
    return match?.[1] || String(image?.alt || button?.title || button?.textContent || '').trim();
  };
  const emojiForKey = (key) => emojiCatalog().find((emoji) => {
    const variants = [emoji?.id, emoji?.key, emoji?.name, emoji?.mention].filter(Boolean).map(String);
    return variants.includes(String(key));
  });

  function describeTarget() {
    const target = state?.messageEmojiTarget;
    if (target?.matches?.('[data-reaction-emoji]')) {
      targetTitle.textContent = 'Emoji für Reaktionsrolle';
      targetHint.textContent = 'Das gewählte Server- oder Bot-Emoji wird exakt mit seiner Discord-ID gespeichert.';
      return;
    }
    const label = target?.closest?.('label, .form-field, .studio-field')?.querySelector?.('label, strong')?.textContent?.trim();
    targetTitle.textContent = label ? `Emoji einfügen: ${label}` : 'Emoji in Nachricht einfügen';
    targetHint.textContent = 'Server-, Bot- und animierte Emojis werden als gültige Discord-Mention eingefügt.';
  }

  function updateCounts() {
    const catalog = emojiCatalog();
    const bot = catalog.filter((emoji) => ['application', 'bot'].includes(String(emoji.source || emoji.type || '').toLowerCase())).length;
    const animated = catalog.filter((emoji) => Boolean(emoji.animated)).length;
    const guild = Math.max(0, catalog.length - bot);
    counts.textContent = `${catalog.length} Emojis · ${guild} Server · ${bot} Bot · ${animated} animiert`;
  }

  function updateDetails(key) {
    const emoji = emojiForKey(key);
    const favorites = readFavorites();
    if (!emoji && !key) {
      details.innerHTML = '<span>Mit den Pfeiltasten navigieren · Enter auswählen · F favorisieren</span>';
      return;
    }
    const name = emoji?.name || key || 'Emoji';
    const source = ['application', 'bot'].includes(String(emoji?.source || emoji?.type || '').toLowerCase()) ? 'Bot' : 'Server';
    details.innerHTML = `<strong>:${escapeHtml(name)}:</strong><span>${source}${emoji?.animated ? ' · animiert' : ''}</span><span>${favorites.has(keyForEmoji(emoji) || key) ? '★ Favorit' : '☆ Mit F oder Rechtsklick favorisieren'}</span>`;
  }

  function toggleFavorite(key) {
    if (!key) return;
    const emoji = emojiForKey(key);
    const normalized = keyForEmoji(emoji) || key;
    const favorites = readFavorites();
    favorites.has(normalized) ? favorites.delete(normalized) : favorites.add(normalized);
    saveFavorites(favorites);
    activeEmojiKey = normalized;
    scheduleRefresh();
  }

  function itemNodes() { return [...grid.querySelectorAll('[data-message-emoji]')]; }

  async function ensureCatalog(force = false) {
    if (!state?.authenticated || !state?.selectedGuildId || catalogPromise) return catalogPromise;
    if (!force && (emojiCatalog().length || state.messageEmojiLoading)) return emojiCatalog();
    catalogPromise = (async () => {
      if (force) state.messageEmojis = [];
      await loadMessageEmojis(state.selectedGuildId);
      if (!emojiCatalog().length && !picker.hidden && catalogRetries < 2) {
        catalogRetries += 1;
        window.setTimeout(() => { catalogPromise = null; void ensureCatalog(true); }, 700 * catalogRetries);
      } else if (emojiCatalog().length) {
        catalogRetries = 0;
      }
      return emojiCatalog();
    })().finally(() => { catalogPromise = null; scheduleRefresh(); });
    return catalogPromise;
  }

  function refresh() {
    refreshQueued = false;
    describeTarget();
    updateCounts();
    const favorites = readFavorites();
    const targetValue = String(state?.messageEmojiTarget?.value || '');
    const items = itemNodes();
    let visibleIndex = 0;

    items.forEach((item) => {
      const key = keyForNode(item);
      const emoji = emojiForKey(key);
      const normalized = keyForEmoji(emoji) || key;
      item.dataset.emojiLibraryKey = normalized;
      item.classList.toggle('is-favorite', favorites.has(normalized));
      item.classList.toggle('is-selected', Boolean(normalized && (targetValue.includes(normalized) || targetValue.includes(emoji?.name || '__never__'))));
      item.hidden = Boolean(favoritesOnly && !favorites.has(normalized));
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', item.classList.contains('is-selected') ? 'true' : 'false');
      item.tabIndex = !item.hidden && visibleIndex++ === 0 ? 0 : -1;
      const image = item.querySelector('img');
      if (image) {
        image.loading = 'lazy';
        image.decoding = 'async';
        image.addEventListener('error', function retryEmojiImage() {
          if (image.dataset.fallbackApplied === '1') {
            image.closest('span')?.classList.add('emoji-image-unavailable');
            image.hidden = true;
            return;
          }
          image.dataset.fallbackApplied = '1';
          const extension = emoji?.animated ? 'gif' : 'png';
          image.src = `https://cdn.discordapp.com/emojis/${encodeURIComponent(emoji?.id || normalized)}.${extension}?size=128&quality=lossless`;
        }, { once: true });
      }
    });

    favoriteFilter.classList.toggle('is-active', favoritesOnly);
    favoriteFilter.setAttribute('aria-pressed', String(favoritesOnly));
    favoriteFilter.textContent = `${favoritesOnly ? '★' : '☆'} Favoriten (${favorites.size})`;

    const nativeEmpty = grid.querySelector('.message-emoji-empty');
    if (nativeEmpty && favoritesOnly) nativeEmpty.innerHTML = '<strong>Noch keine Favoriten</strong><span>Fokussiere ein Emoji und drücke F oder nutze die rechte Maustaste.</span>';
    if (!items.length && !state?.messageEmojiLoading && !picker.hidden) void ensureCatalog();
    if (!activeEmojiKey || !emojiForKey(activeEmojiKey)) activeEmojiKey = '';
    updateDetails(activeEmojiKey);
  }

  function scheduleRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(refresh);
  }

  favoriteFilter.addEventListener('click', () => { favoritesOnly = !favoritesOnly; scheduleRefresh(); });
  reload.addEventListener('click', async () => {
    reload.disabled = true;
    reload.classList.add('is-loading');
    try {
      state.messageEmojiLoading = false;
      catalogRetries = 0;
      await ensureCatalog(true);
      renderMessageEmojiPicker();
    } catch (error) {
      details.innerHTML = `<strong>Bibliothek konnte nicht geladen werden.</strong><span>${escapeHtml(error?.message || 'Unbekannter Fehler')}</span>`;
    } finally {
      reload.disabled = false;
      reload.classList.remove('is-loading');
      scheduleRefresh();
    }
  });

  grid.addEventListener('pointerover', (event) => {
    const item = event.target.closest('[data-emoji-library-key], button, [data-message-emoji]');
    if (!item || !grid.contains(item)) return;
    activeEmojiKey = item.dataset.emojiLibraryKey || keyForNode(item);
    updateDetails(activeEmojiKey);
  });
  grid.addEventListener('focusin', (event) => {
    const item = event.target.closest('[data-emoji-library-key], button, [data-message-emoji]');
    if (!item) return;
    activeEmojiKey = item.dataset.emojiLibraryKey || keyForNode(item);
    updateDetails(activeEmojiKey);
  });
  grid.addEventListener('contextmenu', (event) => {
    const item = event.target.closest('[data-emoji-library-key], button, [data-message-emoji]');
    if (!item || !grid.contains(item)) return;
    event.preventDefault();
    event.stopPropagation();
    toggleFavorite(item.dataset.emojiLibraryKey || keyForNode(item));
  }, true);
  grid.addEventListener('keydown', (event) => {
    const visible = itemNodes().filter((item) => !item.hidden);
    if (!visible.length) return;
    const current = event.target.closest('[data-emoji-library-key], button, [data-message-emoji]');
    const index = Math.max(0, visible.indexOf(current));
    const columns = Math.max(1, Math.floor(grid.clientWidth / 64));
    const movement = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns }[event.key];
    if (movement) {
      event.preventDefault();
      const next = visible[Math.max(0, Math.min(visible.length - 1, index + movement))];
      visible.forEach((item) => { item.tabIndex = item === next ? 0 : -1; });
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); current?.click(); }
    if (event.key.toLowerCase() === 'f') { event.preventDefault(); toggleFavorite(current?.dataset?.emojiLibraryKey || keyForNode(current)); }
  });

  search.placeholder = 'Emojis nach Name, Quelle oder ID durchsuchen ...';
  const observer = new MutationObserver((records) => {
    scheduleRefresh();
    if (records.some((record) => record.target === picker && record.attributeName === 'hidden') && !picker.hidden) void ensureCatalog();
  });
  observer.observe(grid, { childList: true, subtree: true });
  observer.observe(picker, { attributes: true, attributeFilter: ['class', 'hidden', 'open', 'style'] });
  scheduleRefresh();
})();
