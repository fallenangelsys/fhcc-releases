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
  studioComponentSet: 'none',
  studioSpecialTemplate: '',
  studioActivityUsesPeriodColor: false,
  studioWorkshopItemId: '',
  studioWorkshopItemTitle: '',
  studioWorkshopItemTokens: null,
  studioWorkshopAssetMode: 'global',
  activeStudioEmbedIndex: 0,
  activeStudioMessageId: '',
  messageEmojis: [],
  messageEmojiGuildId: '',
  messageEmojiFilter: 'all',
  messageEmojiTarget: null,
  messageEmojiLoading: false
};
window.FallenHeavenRuntime?.bindState(state);

const moduleIdAliases = {
  antiRaid: 'antiraid',
  leveling: 'levels',
  level: 'levels'
};

const fallbackModules = [
  ['moderation', 'Moderation', 'Filter, Warnungen und sichere Aktionen', 'MOD'],
  ['welcomeFarewell', 'Welcome', 'Begrüßt neue Mitglieder mit Stil', 'HEL'],
  ['levels', 'Leveling', 'Aktivität, Level und Belohnungen', 'XP'],
  ['tickets', 'Tickets', 'Strukturierter Support für deine Community', 'TKT'],
  ['aiChat', 'AI Chat', 'Lokale Ollama-AI mit Memory', 'AI'],
  ['logging', 'Logging', 'Audit-Trails für wichtige Ereignisse', 'LOG'],
  ['autoresponder', 'Auto Responder', 'Gezielte automatische Antworten', 'AUTO'],
  ['autoRole', 'AutoRole', 'Rollen beim Beitritt vergeben', 'ROLE'],
  ['serverTagTracker', 'Server-Tag-Tracker', 'Server-Tag erkennen und Rollen synchronisieren', 'TAG'],
  ['forumCleaner', 'Forum-Cleaner', 'Alle ausgewählten Foren sicher tiefenbereinigen', 'FORUM'],
  ['steamWorkshop', 'Steam Workshop', 'Workshop-Mods als detaillierten Forum-Katalog pflegen', 'STEAM'],
  ['emojiManager', 'Emoji-Verwaltung', 'Statische und animierte Server-Emojis kontrolliert umbenennen', 'EMOJI'],
  ['voiceChatCleaner', 'Voice-Chat-Cleaner', 'Voice-Chats nach dem Verlassen vollständig leeren', 'VC'],
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

function normalizeAppEditorSettings(raw) {
  const basePages = appEditorDefaults.pages;
  const incoming = raw && typeof raw === 'object' ? raw : {};
  const pages = { ...basePages, ...(incoming.pages || {}) };
  const pageIds = Object.keys(basePages);
  const uniqueTitles = new Set(pageIds.map(function (id) { return String(pages[id]?.title || '').trim(); }).filter(Boolean));
  if (uniqueTitles.size <= 1) {
    pageIds.forEach(function (id) {
      pages[id] = { ...basePages[id] };
    });
  }
  return {
    ...appEditorDefaults,
    ...incoming,
    pages,
    selectedPage: pageIds.includes(incoming.selectedPage) ? incoming.selectedPage : 'home'
  };
}

let appEditorSettings = normalizeAppEditorSettings(appEditorDefaults);
let appEditorActivePage = appEditorSettings.selectedPage || 'home';

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
  'ai-chat-welcome': {
    content: '',
    embed: {
      title: 'Willkommen im AI Chat',
      description: 'Frag mich einfach – hier ein paar Beispiele:\n\n• „Wie viele Mitglieder hat der Server gerade?“\n• „Wer führt die Aktivitäts-Liga diese Woche an?“\n• „Suche im Internet nach …“\n\nDer Kanal wird nach längerer Inaktivität automatisch aufgeräumt – diese Nachricht bleibt immer stehen.',
      color: '#9b59b6',
      footerText: 'Diese Nachricht bleibt beim automatischen Aufräumen erhalten.',
      timestamp: true,
      fields: []
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

async function setView(view) {
  if (state.activeView === 'modules' && view !== 'modules' && !(await confirmDiscardModuleChanges())) return false;
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
  if (!guildId || !state.authenticated) return;
  const targetGuildId = String(guildId);
  if (state.messageEmojiGuildId !== targetGuildId) state.messageEmojis = [];
  state.messageEmojiLoading = true;
  renderMessageEmojiPicker();
  const response = await api.apiRequest({ path: '/api/guild/' + encodeURIComponent(targetGuildId) + '/message-emojis' });
  state.messageEmojiLoading = false;
  const remoteEmojis = response.ok && Array.isArray(response.data && response.data.emojis) ? response.data.emojis : [];
  state.messageEmojis = nativeMessageEmojis.concat(remoteEmojis);
  state.messageEmojiGuildId = response.ok ? targetGuildId : '';
  renderMessageEmojiPicker();
}

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
  if (state.messageEmojiGuildId !== String(state.selectedGuildId)) {
    state.messageEmojis = [];
    void loadMessageEmojis(state.selectedGuildId);
  } else if (!state.messageEmojis.length && !state.messageEmojiLoading) void loadMessageEmojiCatalog();
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
  setText('module-page-enabled', enabledCount);
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

function settingLines(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[\r\n,]+/);
  return source.map(function (entry) { return String(entry || '').trim(); }).filter(Boolean);
}

const channelTypeAliases = {
  text: 0,
  voice: 2,
  category: 4,
  announcement: 5,
  stage: 13,
  forum: 15,
  media: 16
};

function channelTypeAllowed(field, channel) {
  const filters = Array.isArray(field.channelTypes) ? field.channelTypes : [];
  const type = Number(channel && channel.type);
  if (!filters.length) {
    if (type === 4) return String(field.type || '').toLowerCase() === 'multichannelselect';
    return [0, 2, 5, 13, 15, 16].includes(type);
  }
  return filters.some(function (filter) {
    if (typeof filter === 'number') return type === filter;
    const normalized = String(filter || '').toLowerCase();
    if (/^\d+$/.test(normalized)) return type === Number(normalized);
    return channelTypeAliases[normalized] === type;
  });
}

function channelsForField(field) {
  return state.moduleChannels.filter(function (channel) { return channelTypeAllowed(field, channel); });
}

function channelIcon(channel) {
  const type = Number(channel && channel.type);
  if (type === 4) return 'C';
  if (type === 2) return 'V';
  if (type === 13) return 'S';
  if (type === 15) return 'F';
  if (type === 16) return 'M';
  return '#';
}

function channelKindLabel(channel) {
  const type = Number(channel && channel.type);
  if (type === 4) return 'Kategorie';
  if (type === 2) return 'Voice';
  if (type === 13) return 'Stage';
  if (type === 15) return 'Forum';
  if (type === 16) return 'Media';
  if (type === 5) return 'Ankündigung';
  return 'Text';
}

function groupedDiscordChannels(channels) {
  const groups = [];
  const byKey = new Map();
  (channels || []).forEach(function (channel) {
    const isCategory = Number(channel?.type) === 4 || channel?.isCategory === true;
    const key = isCategory ? String(channel.id || 'category') : String(channel?.categoryId || 'root');
    const label = isCategory
      ? String(channel.name || 'KATEGORIE').toUpperCase()
      : channel?.categoryId
        ? String(channel.categoryName || 'KATEGORIE').toUpperCase()
        : 'OHNE KATEGORIE';
    if (!byKey.has(key)) {
      const group = { key, label, channels: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    byKey.get(key).channels.push(channel);
  });
  return groups;
}

function channelOptionMarkup(channel, selected) {
  const id = String(channel.id || '');
  return '<option value="' + escapeHtml(id) + '" ' + (id === selected ? 'selected' : '') + '>' + escapeHtml(channelKindLabel(channel)) + ' · ' + escapeHtml(channel.name || id) + '</option>';
}

function channelSelectInput(field, current) {
  const selected = String(current || '');
  const channels = channelsForField(field);
  const known = channels.some(function (channel) { return String(channel.id) === selected; });
  const retained = selected && !known ? '<option value="' + escapeHtml(selected) + '" selected>Gespeicherter Kanal · ' + escapeHtml(selected) + '</option>' : '';
  const channelGroups = channels.length && channels.every(function (channel) { return Number(channel?.type) === 4 || channel?.isCategory === true; })
    ? [{ key: 'categories', label: 'KATEGORIEN', channels }]
    : groupedDiscordChannels(channels);
  const options = channelGroups.map(function (group) {
    return '<optgroup label="' + escapeHtml(group.label) + '">' + group.channels.map(function (channel) {
      return channelOptionMarkup(channel, selected);
    }).join('') + '</optgroup>';
  }).join('');
  return '<select class="module-resource-select" data-setting-key="' + escapeHtml(field.key) + '" data-setting-type="channel-select"><option value="">Kanal auswählen ...</option>' + retained + options + '</select>';
}

function roleOptions(selectedRoleId) {
  const selected = String(selectedRoleId || '');
  const known = state.moduleRoles.some(function (role) { return String(role.id) === selected; });
  const retained = selected && !known ? '<option value="' + escapeHtml(selected) + '" selected>Gespeicherte Rolle · ' + escapeHtml(selected) + '</option>' : '';
  return '<option value="">Rolle auswählen ...</option>' + retained + state.moduleRoles.map(function (role) {
    const id = String(role.id || '');
    const blocked = role.assignable === false;
    return '<option value="' + escapeHtml(id) + '" ' + (id === selected ? 'selected' : '') + ' ' + (blocked ? 'disabled' : '') + '>@' + escapeHtml(role.name || id) + (blocked ? ' · nicht verwaltbar' : '') + '</option>';
  }).join('');
}

function singleRoleInput(field, current) {
  return '<select class="module-resource-select" data-setting-key="' + escapeHtml(field.key) + '" data-setting-type="role-select">' + roleOptions(current) + '</select>';
}

function multiChannelInput(field, current) {
  const selected = new Set(settingLines(current));
  const channels = channelsForField(field);
  const knownIds = new Set(channels.map(function (channel) { return String(channel.id || ''); }));
  const choices = groupedDiscordChannels(channels).map(function (group) {
    return '<section class="module-channel-choice-group" data-channel-choice-group><h5>' + escapeHtml(group.label) + '</h5>' + group.channels.map(function (channel) {
      const id = String(channel.id || '');
      const isSelected = selected.has(id);
      return '<label class="module-channel-choice" data-channel-search-text="' + escapeHtml((channel.name || '') + ' ' + group.label + ' ' + channelKindLabel(channel) + ' ' + id) + '"><input type="checkbox" data-channel-choice value="' + escapeHtml(id) + '" ' + (isSelected ? 'checked' : '') + '><i>' + escapeHtml(channelIcon(channel)) + '</i><span>' + escapeHtml(channel.name || id) + '</span><em>' + escapeHtml(channelKindLabel(channel).toUpperCase()) + '</em></label>';
    }).join('') + '</section>';
  }).join('') + [...selected].filter(function (id) { return !knownIds.has(id); }).map(function (id) {
    return '<label class="module-channel-choice retained" data-channel-search-text="' + escapeHtml(id) + ' gespeicherter kanal"><input type="checkbox" data-channel-choice value="' + escapeHtml(id) + '" checked><i>!</i><span>Gespeicherter Kanal · ' + escapeHtml(id) + '</span><em>PRÜFEN</em></label>';
  }).join('');
  return '<div class="module-channel-multi" data-setting-key="' + escapeHtml(field.key) + '" data-setting-type="channel-multi">' +
    '<div class="module-role-map-head"><strong>Kanäle auswählen</strong><span data-channel-selected-count>' + selected.size + ' ausgewählt</span></div>' +
    '<div class="module-role-tools"><input type="search" data-channel-search autocomplete="off" placeholder="Kanal suchen ..."><button type="button" data-clear-channel-selection>Auswahl leeren</button></div>' +
    '<div class="module-channel-choice-grid">' + (choices || '<p class="module-resource-empty">Keine auswählbaren Kanäle gefunden.</p>') + '</div></div>';
}

function emojiPreviewHtml(value) {
  const raw = value === undefined || value === null ? '' : String(value);
  if (!raw) return '🙂';
  const mention = /^<a?:([A-Za-z0-9_~]+):(\d+)>$/.exec(raw);
  if (mention) {
    const animated = raw.charAt(1) === 'a';
    const url = 'https://cdn.discordapp.com/emojis/' + mention[2] + '.' + (animated ? 'gif' : 'png') + '?size=64&quality=lossless';
    return '<img class="module-emoji-preview-img" src="' + url + '" alt="' + escapeHtml(raw) + '" title="' + escapeHtml(raw) + '" loading="lazy" decoding="async">';
  }
  return escapeHtml(raw);
}

function emojiInput(field, current) {
  const value = current === undefined || current === null ? '' : String(current);
  const preview = emojiPreviewHtml(value);
  return '<div class="module-emoji-control"><span class="module-emoji-preview" data-emoji-preview>' + preview + '</span>' +
    '<input type="text" data-setting-key="' + escapeHtml(field.key) + '" data-setting-type="emoji" data-emoji-input value="' + escapeHtml(value) + '" placeholder="' + escapeHtml(field.placeholder || 'Emoji auswählen ...') + '">' +
    '<button type="button" class="module-emoji-picker-button" data-open-emoji-picker aria-label="Emoji-Bibliothek öffnen">Emoji auswählen</button></div>';
}

function parseRoleMappings(value) {
  return settingLines(value).map(function (entry, index) {
    const match = /^(\d+)\s*=\s*(\d+)$/.exec(entry);
    if (match) return { count: Number(match[1]), roleId: match[2] };
    return /^\d+$/.test(entry) ? { count: index + 1, roleId: entry } : null;
  }).filter(Boolean);
}

function roleMappingRow(mapping, kind) {
  const entry = mapping || {};
  const count = Math.max(1, Number(entry.count || 1));
  const economy = kind === 'economy';
  const levels = kind === 'levels';
  return '<div class="module-role-map-row">' +
    '<label><span>' + (economy ? 'Coin-Preis' : levels ? 'Benötigtes Level' : 'Boost-Anzahl') + '</span><input type="number" min="1" max="' + (economy ? '10000000' : levels ? '999' : '99') + '" data-role-count value="' + count + '"></label>' +
    '<label><span>Discord-Rolle</span><select class="module-resource-select" data-role-id>' + roleOptions(entry.roleId) + '</select></label>' +
    '<button type="button" class="module-role-remove" data-remove-role-mapping>Entfernen</button></div>';
}

function roleMappingInput(field, current) {
  const mappings = parseRoleMappings(current);
  const economy = String(field.key || '').includes('heavenEconomy');
  const levels = String(field.key || '').includes('levelRoleMappings');
  const kind = economy ? 'economy' : levels ? 'levels' : 'boost';
  const defaults = economy ? [500, 1000, 2500, 4000, 5000].map(function (price) { return { count: price, roleId: '' }; }) : [{ count: 1, roleId: '' }];
  const rows = (mappings.length ? mappings : defaults).map(function (mapping) { return roleMappingRow(mapping, kind); }).join('');
  return '<div class="module-role-mapping" data-mapping-kind="' + kind + '" data-setting-key="' + escapeHtml(field.key) + '" data-setting-type="role-mapping">' +
    '<div class="module-role-map-head"><strong>' + (economy ? 'VIP-Preise' : levels ? 'Level-Belohnungen' : 'Boost-Staffeln') + '</strong><span>' + (economy ? 'Eine eindeutige VIP-Rolle je Coin-Preis' : levels ? 'Eine Discord-Rolle je erreichtem Level' : 'Eine eindeutige Rolle je Boost-Anzahl') + '</span></div>' +
    '<div class="module-role-map-rows">' + rows + '</div><button type="button" class="module-role-add" data-add-role-mapping>+ ' + (levels ? 'Level-Belohnung' : 'Staffel') + ' hinzufügen</button></div>';
}

function multiRoleInput(field, current) {
  const selected = new Set(settingLines(current));
  const knownIds = new Set(state.moduleRoles.map(function (role) { return String(role.id || ''); }));
  const choices = state.moduleRoles.map(function (role) {
    const id = String(role.id || '');
    const color = Number(role.color || 0) ? '#' + Number(role.color).toString(16).padStart(6, '0') : '#aeb4c5';
    const blocked = role.assignable === false;
    const isSelected = selected.has(id);
    return '<label class="module-role-choice ' + (blocked ? 'blocked' : '') + '" data-role-search-text="' + escapeHtml((role.name || '') + ' ' + id) + '" title="' + escapeHtml(blocked ? (role.blockedReason || 'Rolle kann vom Bot nicht verwaltet werden.') : '') + '"><input type="checkbox" data-role-choice value="' + escapeHtml(id) + '" ' + (isSelected ? 'checked' : '') + ' ' + (blocked && !isSelected ? 'disabled' : '') + '><i style="--role-color:' + escapeHtml(color) + '"></i><span>@' + escapeHtml(role.name || id) + '</span>' + (blocked ? '<em>BLOCKIERT</em>' : '') + '</label>';
  }).join('') + [...selected].filter(function (id) { return !knownIds.has(id); }).map(function (id) {
    return '<label class="module-role-choice blocked retained" data-role-search-text="' + escapeHtml(id) + ' gespeicherte rolle"><input type="checkbox" data-role-choice value="' + escapeHtml(id) + '" checked><i style="--role-color:#ffbd59"></i><span>Gespeicherte Rolle · ' + escapeHtml(id) + '</span><em>PRÜFEN</em></label>';
  }).join('');
  return '<div class="module-role-multi" data-setting-key="' + escapeHtml(field.key) + '" data-setting-type="role-multi">' +
    '<div class="module-role-map-head"><strong>Rollen auswählen</strong><span data-role-selected-count>' + selected.size + ' ausgewählt</span></div><div class="module-role-tools"><input type="search" data-role-search autocomplete="off" placeholder="Rolle suchen ..."><button type="button" data-clear-role-selection>Auswahl leeren</button></div><div class="module-role-choice-grid">' +
    (choices || '<p class="module-resource-empty">Keine auswählbaren Rollen gefunden.</p>') + '</div></div>';
}

function inputForField(field, current) {
  const type = String(field.type || 'text').toLowerCase();
  if (type === 'channelselect') return channelSelectInput(field, current);
  if (type === 'multichannelselect') return multiChannelInput(field, current);
  if (type === 'roleselect') return singleRoleInput(field, current);
  if (type === 'rolemappingselect') return roleMappingInput(field, current);
  if (type === 'multiroleselect') return multiRoleInput(field, current);
  if (type === 'emoji') return emojiInput(field, current);
  if (type === 'textarea' || type === 'arraylines' || type === 'json') {
    const textValue = type === 'json' && current && typeof current === 'object' ? JSON.stringify(current, null, 2) : (current || '');
    return '<textarea data-setting-key="' + escapeHtml(field.key) + '" rows="' + (type === 'arraylines' || type === 'json' ? '6' : '4') + '" placeholder="' + escapeHtml(field.placeholder || '') + '" ' + (type === 'json' ? 'spellcheck="false" data-setting-format="json"' : '') + '>' + escapeHtml(textValue) + '</textarea>';
  }
  if (type === 'checkbox') return '<input type="checkbox" data-setting-key="' + escapeHtml(field.key) + '" data-setting-type="checkbox" ' + (current ? 'checked' : '') + '>';
  if (type === 'select' && Array.isArray(field.options)) {
    return '<select data-setting-key="' + escapeHtml(field.key) + '">' + field.options.map(function (option) {
      const value = typeof option === 'object' ? option.value : option;
      const label = typeof option === 'object' ? option.label : option;
      return '<option value="' + escapeHtml(value) + '" ' + (String(value) === String(current) ? 'selected' : '') + '>' + escapeHtml(label) + '</option>';
    }).join('') + '</select>';
  }
  const inputType = type === 'number' || type === 'integer' ? 'number' : type === 'password' ? 'password' : 'text';
  const numeric = inputType === 'number';
  const constraints = (numeric && field.min !== undefined ? ' min="' + escapeHtml(field.min) + '"' : '') +
    (numeric && field.max !== undefined ? ' max="' + escapeHtml(field.max) + '"' : '') +
    (numeric && field.step !== undefined ? ' step="' + escapeHtml(field.step) + '"' : '');
  return '<input type="' + inputType + '" data-setting-key="' + escapeHtml(field.key) + '" value="' + escapeHtml(current === undefined || current === null ? '' : current) + '" placeholder="' + escapeHtml(field.placeholder || '') + '"' + (inputType === 'password' ? ' autocomplete="off" spellcheck="false"' : '') + constraints + '>';
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
      value = Array.from(field.querySelectorAll('.module-role-map-row')).map(function (row) {
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
    const roleIds = settingLines(moduleConfig.roleIds?.length ? moduleConfig.roleIds : moduleConfig.roleId);
    const excludedIds = settingLines(moduleConfig.excludedRoleIds);
    if (moduleConfig.enabled && !roleIds.length) return { ok: false, message: 'Wähle zuerst mindestens eine Server-Tag-Rolle aus.' };
    if (roleIds.some(function (roleId) { return excludedIds.includes(roleId); })) return { ok: false, message: 'Eine Server-Tag-Rolle darf nicht gleichzeitig als ausgeschlossene Rolle gewählt sein.' };
    const selectedRoles = roleIds.map(function (roleId) { return state.moduleRoles.find(function (role) { return String(role.id) === roleId; }); });
    if (selectedRoles.some(function (role) { return !role; })) return { ok: false, message: 'Mindestens eine gespeicherte Server-Tag-Rolle existiert nicht mehr. Prüfe deine Auswahl.' };
    if (selectedRoles.some(function (role) { return role?.assignable === false; })) return { ok: false, message: 'Der Bot kann mindestens eine Server-Tag-Rolle nicht verwalten. Verschiebe die Bot-Rolle in Discord darüber.' };
    return { ok: true };
  }
  if (feature.id === 'forumCleaner') {
    const channelIds = settingLines(moduleConfig.channelIds);
    if (moduleConfig.enabled && !channelIds.length) return { ok: false, message: 'Wähle mindestens einen Forum- oder Media-Kanal für den Tiefenscan aus.' };
    return { ok: true };
  }
  if (feature.id === 'steamWorkshop') {
    const ids = settingLines(moduleConfig.workshopIds).filter(function (id) { return /^\d{6,20}$/.test(id); });
    if (moduleConfig.enabled && !String(moduleConfig.forumChannelId || '').trim()) return { ok: false, message: 'Wähle das Forum für den Workshop-Katalog aus.' };
    if (moduleConfig.enabled && !ids.length) return { ok: false, message: 'Füge mindestens eine gültige Steam-Workshop-ID hinzu.' };
    if (moduleConfig.enabled && moduleConfig.notifyOnUpdate && !String(moduleConfig.updateChannelId || '').trim()) return { ok: false, message: 'Wähle für aktive Update-Meldungen einen Textkanal aus.' };
    if (settingLines(moduleConfig.appliedTagNames).length > 5) return { ok: false, message: 'Discord erlaubt pro Forum-Post höchstens fünf Tags.' };
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
  const mappings = parseRoleMappings(moduleConfig.tierRoleMappings);
  const counts = mappings.map(function (mapping) { return mapping.count; });
  if (new Set(counts).size !== counts.length) return { ok: false, message: 'Jede Boost-Anzahl darf nur einmal als Staffel vorkommen.' };
  const configuredIds = new Set([
    ...settingLines(moduleConfig.automaticRoleIds),
    ...settingLines(moduleConfig.removableColorRoleIds),
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
  const selectedRoleIds = settingLines(config?.roleIds?.length ? config.roleIds : config?.roleId);
  const selectedRoles = selectedRoleIds.map(function (roleId) { return state.moduleRoles.find(function (role) { return String(role.id) === roleId; }); }).filter(Boolean);
  const ready = active && selectedRoleIds.length > 0 && selectedRoles.length === selectedRoleIds.length;
  return '<section id="server-tag-tracker-panel" class="server-tag-tracker-panel ' + (ready ? 'ready' : 'attention') + '" data-state="idle">' +
    '<header><span><small>SERVER-TAG AUTOMATIK · ' + selectedRoleIds.length + ' ROLLE' + (selectedRoleIds.length === 1 ? '' : 'N') + '</small><strong data-server-tag-title>' + (active ? (monitorOnly ? 'Sicherer Prüfmodus' : 'Tracker wird geladen …') : 'Modul ist deaktiviert') + '</strong><p data-server-tag-detail>Discord Primary-Guild-Daten werden frisch und mehrfach ausgewertet.</p></span><div><em data-server-tag-badge>' + (ready ? (monitorOnly ? 'PRÜFMODUS' : 'BEREIT') : 'KONFIGURIEREN') + '</em><button type="button" data-sync-server-tags ' + (ready ? '' : 'disabled') + '>Jetzt vollständig prüfen</button></div></header>' +
    '<div class="server-tag-summary">' +
      '<article><small>BESTÄTIGTE TRÄGER</small><b data-server-tag-wearing>–</b><p>Frisch mehrfach geprüft</p></article>' +
      '<article><small>API-PRÜFUNG OFFEN</small><b data-server-tag-candidates>–</b><p>Keine Änderung ohne frische Antwort</p></article>' +
      '<article><small>UNKLAR</small><b data-server-tag-unknown>–</b><p>Keine Rollenänderung</p></article>' +
      '<article><small>LETZTER ABGLEICH</small><b data-server-tag-last>–</b><p data-server-tag-next>Wird geladen</p></article>' +
    '</div>' +
    '<div class="server-tag-live"><div class="server-tag-progress"><i data-server-tag-progress></i></div><span data-server-tag-progress-text>Tracker-Status wird geladen …</span></div>' +
    '<div class="server-tag-lists"><section><div class="server-tag-list-head"><span><small>MITGLIEDER</small><strong>Aktueller Prüfstand</strong></span><em data-server-tag-member-count>0</em></div><div data-server-tag-members class="server-tag-member-list"><p class="module-resource-empty">Mitglieder werden geladen …</p></div></section>' +
    '<section><div class="server-tag-list-head"><span><small>VERLAUF</small><strong>Rollenänderungen</strong></span></div><div data-server-tag-history class="server-tag-history"><p class="module-resource-empty">Noch keine Rollenänderung protokolliert.</p></div></section></div>' +
    '<p class="server-tag-safety-note"><b>Echtzeitlogik:</b> Ein Discord-Profilereignis löst sofort eine frische Benutzerabfrage aus. Meldet die API den Server-Tag als aktiv, wird der Rollensatz vergeben; andernfalls wird er entzogen. Bei API-Fehlern geschieht nichts. Der große Abgleich besitzt zusätzlich ein Massenlimit. Es werden keine DMs versendet.</p>' +
    '</section>';
}

function serverTagStateCopy(entry) {
  if (entry?.state === 'wearing' && entry.confirmed) return { label: 'TAG BESTÄTIGT', className: 'wearing' };
  if (entry?.state === 'wearing') return { label: 'PRÜFUNG OFFEN', className: 'unknown' };
  if (entry?.state === 'not-wearing') return { label: entry.confirmed ? 'NICHT AKTIV' : 'BESTÄTIGUNG OFFEN', className: 'missing' };
  return { label: 'UNKLAR', className: 'unknown' };
}

function renderServerTagTrackerStatus(status) {
  const panel = document.getElementById('server-tag-tracker-panel');
  if (!panel) return;
  const data = status || {};
  panel.dataset.state = data.phase || 'idle';
  const title = panel.querySelector('[data-server-tag-title]');
  const detail = panel.querySelector('[data-server-tag-detail]');
  const badge = panel.querySelector('[data-server-tag-badge]');
  if (title) title.textContent = data.running ? (data.monitorOnly ? 'Sichere Prüfung läuft' : 'Server-Tag-Abgleich läuft') : data.phase === 'failed' ? 'Abgleich benötigt Aufmerksamkeit' : data.phase === 'disabled' ? 'Modul ist deaktiviert' : data.monitorOnly ? 'Sicherer Prüfmodus' : 'Server-Tag-Tracker bereit';
  if (detail) detail.textContent = data.lastError || data.detail || 'Bereit für den nächsten Abgleich.';
  if (badge) badge.textContent = data.running ? 'LIVE' : data.errors ? data.errors + ' FEHLER' : data.monitorOnly ? 'PRÜFMODUS' : 'BEREIT';
  const set = function (selector, value) { const node = panel.querySelector(selector); if (node) node.textContent = value; };
  set('[data-server-tag-wearing]', Number(data.wearing || 0).toLocaleString('de-DE'));
  set('[data-server-tag-candidates]', Number(data.candidates || 0).toLocaleString('de-DE'));
  set('[data-server-tag-unknown]', Number(data.unknown || 0).toLocaleString('de-DE'));
  set('[data-server-tag-last]', data.lastCompletedAt ? formatBackupDate(data.lastCompletedAt) : 'Noch keiner');
  set('[data-server-tag-next]', data.nextScanAt ? 'Nächster Abgleich ' + formatBackupDate(data.nextScanAt) : 'Kein Termin geplant');
  set('[data-server-tag-progress-text]', data.running ? (data.detail || 'Abgleich läuft …') : data.monitorOnly ? ((data.previewAdds || 0) + ' Vergaben vorgemerkt · ' + (data.previewRemovals || 0) + ' Entzüge vorgemerkt · keine Rollen geändert') : ((data.roleAssigned || 0) + ' vergeben · ' + (data.roleRemoved || 0) + ' entfernt · ' + (data.deferredAssignments || 0) + ' zurückgestellt · ' + (data.errors || 0) + ' Fehler'));
  set('[data-server-tag-member-count]', Number(data.memberCount || 0).toLocaleString('de-DE'));
  const fill = panel.querySelector('[data-server-tag-progress]');
  if (fill) fill.style.width = Math.max(0, Math.min(100, Number(data.progress || 0))) + '%';

  const members = Array.isArray(data.members) ? data.members : [];
  const memberHost = panel.querySelector('[data-server-tag-members]');
  if (memberHost) {
    memberHost.innerHTML = members.length ? members.slice(0, 120).map(function (entry) {
      const stateCopy = serverTagStateCopy(entry);
      const misses = Number(entry.consecutiveMisses || 0);
      const positives = Number(entry.positiveConfirmations || 0);
      return '<article class="server-tag-member ' + stateCopy.className + '">' +
        (entry.avatarUrl ? '<img src="' + escapeHtml(entry.avatarUrl) + '" alt="">' : '<span class="server-tag-avatar">' + escapeHtml(String(entry.displayName || '?').slice(0, 1).toUpperCase()) + '</span>') +
        '<span><b>' + escapeHtml(entry.displayName || entry.username || entry.userId) + '</b><small>@' + escapeHtml(entry.username || entry.userId) + (entry.tag ? ' · Tag ' + escapeHtml(entry.tag) : '') + '</small></span>' +
        '<em>' + stateCopy.label + (entry.state === 'wearing' && !entry.confirmed ? ' · ' + positives : '') + (misses && entry.state === 'not-wearing' ? ' · ' + misses : '') + '</em>' +
        '</article>';
    }).join('') : '<p class="module-resource-empty">Nach dem ersten vollständigen Abgleich erscheinen hier die Mitglieder.</p>';
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
      button.textContent = 'Jetzt vollständig prüfen';
    }
  }
}

function voiceChatCleanerOverview(config) {
  const active = config?.enabled === true;
  const selected = settingLines(config?.channelIds).length;
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

function forumCleanerOverview(config) {
  const active = config?.enabled === true;
  const selected = settingLines(config?.channelIds).length;
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
  const ids = settingLines(config?.workshopIds);
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
  set('[data-steam-workshop-total]', Number(status?.total || settingLines(state.config?.steamWorkshop?.workshopIds).length).toLocaleString('de-DE'));
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
  state.activeStudioMessageId = '';
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
  const roleKeys = ['separatorRoleId'].concat(['daily', 'weekly', 'monthly'].flatMap(function (period) {
    return ['Chat', 'Voice'].flatMap(function (metric) {
      return [1, 2, 3].map(function (place) { return period + metric + (place === 1 ? '' : 'Top' + place) + 'RoleId'; });
    });
  }));
  const selected = roleKeys.filter(function (key) { return String(config?.[key] || '').trim(); }).length;
  const periods = [
    ['daily', 'TAGESWERTUNG'],
    ['weekly', 'WOCHENWERTUNG'],
    ['monthly', 'MONATSWERTUNG']
  ];
  const ready = config?.enabled === true && selected === roleKeys.length;
  const configuredChannel = String(config?.panelChannelId || '').trim();
  return '<section id="activity-race-panel" class="activity-race-panel ' + (ready ? 'ready' : 'attention') + '">' +
    '<header><div><small>FALLEN HEAVEN · AKTIVITÄTS-LIGA</small><h3>' + (ready ? 'Das Community-Rennen läuft.' : 'Top 1–3 professionell einrichten.') + '</h3><p>Tagesrollen folgen live der aktuellen Rangfolge. Wochen- und Monatsrollen entstehen erst nach einem vollständigen Abschluss.</p></div><span data-activity-race-badge>' + (ready ? 'LIVE' : selected + '/19 ROLLEN') + '</span></header>' +
    '<div class="activity-race-periods">' + periods.map(function (row) {
      const chatCount = [1, 2, 3].filter(function (place) { return String(config?.[row[0] + 'Chat' + (place === 1 ? '' : 'Top' + place) + 'RoleId'] || '').trim(); }).length;
      const voiceCount = [1, 2, 3].filter(function (place) { return String(config?.[row[0] + 'Voice' + (place === 1 ? '' : 'Top' + place) + 'RoleId'] || '').trim(); }).length;
      return '<article><em>' + escapeHtml(row[1]) + '</em><b>Chat · ' + chatCount + '/3 Plätze</b><b>Sprachchat · ' + voiceCount + '/3 Plätze</b><small data-activity-race-' + row[0] + '>Noch keine Live-Daten</small></article>';
    }).join('') + '</div>' +
    '<div class="activity-race-actions"><div><b>Eine Live-Nachricht im Kanal „aktivität-liga“</b><span>' + (configuredChannel ? 'Der ausgewählte Kanal hat Vorrang.' : 'Der Kanal wird automatisch über seinen Namen erkannt.') + ' Knöpfe öffnen persönliche Ansichten, ohne das öffentliche Embed für andere umzuschalten.</span></div><button type="button" data-activity-race-open-studio>Vorlage im Embed Studio bearbeiten</button><button type="button" data-activity-race-role-preview>Rollenset prüfen</button><button type="button" data-activity-race-refresh ' + (ready ? '' : 'disabled') + '>Embed jetzt aktualisieren</button></div>' +
    '<section class="activity-race-full"><header><div><small>VOLLSTÄNDIGE TAGESWERTUNG</small><h4>Jedes aktuelle Mitglied. Jeder Rang.</h4><p>Gleichstände erhalten denselben fairen Rang. Mitglieder ohne heutige Aktivität bleiben sichtbar und werden nicht zu Gewinnern erklärt.</p></div><div class="activity-race-ranking-tools"><label><span class="sr-only">Mitglied suchen</span><input type="search" data-activity-race-ranking-search value="' + escapeHtml(activityRaceRankingQuery) + '" placeholder="Mitglied oder Benutzername suchen …" autocomplete="off"></label><div><button type="button" class="active" data-activity-race-ranking-metric="chat">Chat</button><button type="button" data-activity-race-ranking-metric="voice">Sprachchat</button></div></div></header><div class="activity-race-ranking-summary" data-activity-race-ranking-summary>Rangliste wird geladen …</div><div class="activity-race-ranking-list" data-activity-race-ranking-list><p>Aktuelle Mitgliedsdaten werden geladen …</p></div></section>' +
    '<p class="activity-race-safety"><b>Dynamische Titel:</b> Tagesrollen wechseln automatisch zwischen Platz 1, 2 und 3. Die Trennerrolle begleitet jede aktive Liga-Auszeichnung und wird nach der letzten Auszeichnung entzogen. Wochen- und Monatsrollen werden nur aus vollständigen Zeiträumen gebildet. Bots, Webhooks, Spam, Duplikate und AFK zählen nicht.</p>' +
    '<p class="activity-race-role-health" data-activity-race-role-health><b>Rollenabgleich:</b> Bereit für die nächste Auswertung.</p>' +
    '</section>';
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

function serverKnowledgeOverview(config) {
  const hotDays = Math.max(1, Math.min(30, Number(config?.retentionDays || 30)));
  return '<section class="server-knowledge-overview">' +
    '<header><div><small>SERVERWISSEN · ARCHITEKTUR</small><h3>Der gesamte Index. Gezielt statt ungefiltert.</h3><p>Die AI sucht serverweit und über die vollständige Historie. Ollama erhält nur die relevantesten, für den jeweiligen Nutzer sichtbaren Belege.</p></div><span>VOLLINDEX</span></header>' +
    '<div class="server-knowledge-flow">' +
      '<article><i><svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5" rx="7" ry="3"></ellipse><path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"></path></svg></i><span><b>Persistenter Vollindex</b><small>Langfristige Discord-Historie aus allen indexierten Kanälen</small></span></article>' +
      '<em>→</em>' +
      '<article><i><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5.5 6v5.2c0 4.4 2.8 7.7 6.5 9.8 3.7-2.1 6.5-5.4 6.5-9.8V6L12 3Z"></path><path d="m9.2 12 1.8 1.8 3.8-4"></path></svg></i><span><b>Berechtigungsfilter</b><small>Private Kanäle bleiben für unberechtigte Nutzer unsichtbar</small></span></article>' +
      '<em>→</em>' +
      '<article><i><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.4 4.5L18 9l-4.6 1.5L12 15l-1.4-4.5L6 9l4.6-1.5L12 3Z"></path><path d="m18.5 14 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z"></path></svg></i><span><b>Relevante Belege</b><small>Kompaktes Kontextpaket für qwen2.5:7b statt 3 GB Rohdaten</small></span></article>' +
    '</div>' +
    '<footer><span><b>' + hotDays + ' Tage</b><small>Schneller Aktualitätskontext</small></span><span><b>Gesamte Historie</b><small>Durchsuchbares Langzeitwissen</small></span><span><b>Lokal</b><small>Keine Cloud-AI erforderlich</small></span></footer>' +
  '</section>';
}

function aiChatIntelligenceOverview(config) {
  const cleanup = config?.autoCleanChannel !== false;
  const idle = Math.max(15, Math.min(10080, Number(config?.channelIdleMinutes || 60)));
  const sources = [
    ['DISCORD LIVE', 'Vollständige Mitgliederliste, Owner, Team, Rollen und Boosts'],
    ['MITGLIEDSPROFILE', 'Nachrichtenanzahl, Kanalaktivität, Belege und Timeline'],
    ['VIP & COINS', 'Heaven Economy mit geschützter Kontosicht'],
    ['AKTIVITÄTS-LIGA', 'Tagesstand und abgeschlossene Wertungen'],
    ['VOLLINDEX', 'Vollständige Historie mit Berechtigungsfilter'],
    ['WEB', 'Nur für aktuelle externe Fakten und News']
  ];
  return '<section class="ai-intelligence-overview">' +
    '<header><div><small>HYBRID INTELLIGENCE</small><h3>Die Frage entscheidet über die Quelle.</h3><p>Server-, Mitglieder-, VIP-, Aktivitäts- und Webfragen laufen durch getrennte Datenpfade. Ollama formuliert die Antwort, darf die Faktenquelle aber nicht selbst erfinden.</p></div><span>' + escapeHtml(String(config?.model || 'qwen2.5:7b')) + '</span></header>' +
    '<div class="ai-intelligence-sources">' + sources.map(function (source) {
      return '<article><i></i><span><b>' + source[0] + '</b><small>' + source[1] + '</small></span></article>';
    }).join('') + '</div>' +
    '<div class="activity-race-actions"><div><b>Info-Embed im Kanal gestalten</b><span>Die erste Nachricht im AI-Chat-Kanal wird wie jede andere Vorlage im Embed Studio bearbeitet – mit Live-Vorschau, Bildern und Feldern. Sie bleibt beim automatischen Aufräumen immer erhalten.</span></div><button type="button" data-ai-chat-open-studio>Info-Embed im Embed Studio bearbeiten</button></div>' +
    '<footer><span><b>Normaler Chat</b><small>Lokales Ollama + persönliche Erinnerung</small></span><span><b>' + (cleanup ? 'Auto-Clean aktiv' : 'Auto-Clean aus') + '</b><small>' + (cleanup ? 'Sichtbarer Kanal nach ' + idle + ' Minuten Inaktivität leer' : 'Discord-Nachrichten bleiben sichtbar') + '</small></span><span><b>Privacy Gate</b><small>Fremde Coin-Guthaben bleiben geschützt</small></span></footer>' +
  '</section>';
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
  const baseCount = settingLines(config?.automaticRoleIds).length;
  const tierCount = parseRoleMappings(config?.tierRoleMappings).length;
  const active = config?.enabled === true;
  return '<section class="boost-automation-overview ' + (active && baseCount ? 'ready' : 'attention') + '"><header><span><small>BOOSTER-AUTOMATIK</small><strong>' + (active ? 'Automatischer Rollenabgleich aktiv' : 'Modul ist aktuell deaktiviert') + '</strong></span><div><em>' + (active && baseCount ? 'BEREIT' : 'KONFIGURIEREN') + '</em><button type="button" data-sync-boost-roles ' + (active ? '' : 'disabled') + '>Jetzt abgleichen</button></div></header><div><article><small>JEDER BOOSTER</small><b>' + baseCount + ' Basisrolle' + (baseCount === 1 ? '' : 'n') + '</b><p>Sofort bei aktivem Boost</p></article><article><small>STAFFELN</small><b>' + tierCount + ' Stufe' + (tierCount === 1 ? '' : 'n') + '</b><p>Bleiben nach Boost-Anzahl erhalten</p></article><article><small>BOOST-ENDE</small><b>Automatischer Entzug</b><p>Basis-, Staffel- und gewählte Farbrollen</p></article></div><p class="boost-automation-note">Speichern startet direkt einen vollständigen Abgleich. Zusätzlich korrigiert der Bot den Rollenstand regelmäßig und nach jedem Discord-Mitgliederupdate.</p></section>';
}

function welcomeFarewellOverview(config) {
  const deferred = config?.welcomeAfterVerification === true;
  const roleReady = Boolean(String(config?.verificationRoleId || '').trim());
  const template = config?.welcomeTemplate || {};
  const embedCount = Array.isArray(template.embeds) ? template.embeds.length : template.embed ? 1 : 0;
  return '<section class="activity-race-overview welcome-template-overview"><header><div><small>VERIFIZIERUNGS-WORKFLOW</small><strong>' + (deferred ? 'Begrüßung nach Rollenfreigabe' : 'Begrüßung direkt beim Beitritt') + '</strong><p>' + (deferred ? roleReady ? 'Die Nachricht erscheint erst, wenn die ausgewählte Unverified-Rolle entfernt wurde.' : 'Wähle noch die Unverified-Rolle aus.' : 'Optional kannst du unten auf die Begrüßung nach Verifizierung umstellen.') + '</p></div><em>' + embedCount + ' EMBED' + (embedCount === 1 ? '' : 'S') + '</em></header><div class="activity-race-actions"><div><b>Willkommensnachricht gestalten</b><span>Verwendet das bestehende Embed Studio mit Live-Vorschau, Bildern und bis zu zehn Embeds.</span></div><button type="button" data-welcome-open-studio>Willkommensnachricht bearbeiten</button></div></section>';
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
    (feature.id === 'forumCleaner' ? forumCleanerOverview(state.config[feature.id]) : '') +
    (feature.id === 'steamWorkshop' ? steamWorkshopOverview(state.config[feature.id]) : '') +
    (feature.id === 'emojiManager' ? emojiManagerOverview(state.config[feature.id]) : '') +
    (feature.id === 'serverContext' ? serverKnowledgeOverview(state.config[feature.id]) : '') +
    (feature.id === 'aiChat' ? aiChatIntelligenceOverview(state.config[feature.id]) : '') +
    (feature.id === 'welcomeFarewell' ? welcomeFarewellOverview(state.config[feature.id]) : '') +
    (feature.id === 'activityRace' ? activityRaceOverview(state.config[feature.id]) : '') +
    (feature.id === 'boostRoles' ? boostAutomationOverview(state.config[feature.id]) : '') +
    (fields.length ? '<div class="module-field-grid">' + fields.map(function (field) {
      const current = getByPath(state.config, field.key);
      const type = String(field.type || 'text').toLowerCase(); const rich = ['rolemappingselect', 'multiroleselect', 'multichannelselect'].includes(type); const isToggle = type === 'checkbox';
      const labelHtml = '<strong class="module-field-label">' + escapeHtml(field.label || field.key) + '</strong>'; const hintHtml = '<span>' + escapeHtml(field.hint || field.info || '') + '</span>'; const inner = isToggle ? '<span class="module-field-copy">' + labelHtml + hintHtml + '</span><span class="module-toggle">' + inputForField(field, current) + '<i></i></span>' : labelHtml + hintHtml + inputForField(field, current); return '<' + (rich ? 'div' : 'label') + ' class="module-field' + (rich ? ' module-field-rich' : '') + (isToggle ? ' module-field-toggle' : '') + '" data-field-type="' + escapeHtml(type) + '">' + inner + '</' + (rich ? 'div' : 'label') + '>';
    }).join('') + '</div>' : '<p class="empty-drafts">Dieses Modul hat keine weiteren Einstellungen.</p>');
  const save = document.getElementById('save-module-fields');
  if (feature.id === 'boostRoles') {
    host.querySelector('.boost-automation-overview')?.insertAdjacentHTML('afterend', '<section id="boost-rebuild-progress" class="boost-rebuild-progress" data-state="idle"><div class="boost-progress-orb"><i></i></div><div class="boost-progress-main"><div class="boost-progress-heading"><span><small data-boost-progress-state>STATUS</small><strong data-boost-progress-title>Bereit</strong></span><b data-boost-progress-value>0%</b></div><p data-boost-progress-detail>Warte auf den nächsten Abgleich.</p><div class="boost-progress-track"><i data-boost-progress-fill></i></div><small data-boost-progress-count>Noch keine offenen Prüfungen</small></div></section>');
    void refreshBoostProgress();
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
      if (preview) preview.innerHTML = emojiPreviewHtml(emojiInputField.value);
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
    const welcomeStudio = event.target.closest('[data-welcome-open-studio]');
    if (welcomeStudio) {
      void openWelcomeFarewellStudio();
      return;
    }
    const aiChatStudio = event.target.closest('[data-ai-chat-open-studio]');
    if (aiChatStudio) {
      void openAiChatWelcomeStudio();
      return;
    }
    const activityRankingMetric = event.target.closest('[data-activity-race-ranking-metric]');
    if (activityRankingMetric) {
      activityRaceRankingMetric = activityRankingMetric.dataset.activityRaceRankingMetric === 'voice' ? 'voice' : 'chat';
      renderActivityRaceFullRanking();
      return;
    }
    const activityStudio = event.target.closest('[data-activity-race-open-studio]');
    if (activityStudio) {
      void openActivityRaceStudio();
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
    const voiceCleanerRefresh = event.target.closest('[data-refresh-voice-cleaner]');
    if (voiceCleanerRefresh) {
      void refreshVoiceChatCleanerStatus();
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
      rows.insertAdjacentHTML('beforeend', roleMappingRow({ count: Math.max(0, ...counts) + 1 }, kind));
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
}

function persistStudioMessages() {
  localStorage.setItem(studioStorageKey(state.selectedGuildId), JSON.stringify(state.studioMessages.slice(0, 80).map(makeStudioTemplateStorageSafe)));
}

const studioChannelCache = new Map();
const studioChannelLoads = new Map();
let studioOutsideImageRemovalRequested = false;
let studioOutsideImageExistingAttachment = false;
let studioOutsideImageAttachment = null;

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
  if (!/^image\/(?:png|jpeg|webp|gif)$/i.test(String(file.type || ''))) { toast('Bitte wähle eine PNG-, JPG-, WEBP- oder GIF-Datei.', 'error'); return; }
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
  const fixedAutomationEmbed = Boolean(state.studioSpecialTemplate);
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
      link.textContent = embed.title;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      heading.append(link);
    } else {
      heading.textContent = embed.title;
    }
    content.append(heading);
  }

  if (embed.description) {
    const description = document.createElement('p');
    description.textContent = embed.description;
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
      name.textContent = field.name || '\u200b';
      const value = document.createElement('span');
      value.textContent = field.value || '\u200b';
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
      footerText.textContent = embed.footerText;
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
  return {
    specialTemplate: state.studioSpecialTemplate || '',
    activityRaceUsePeriodColor: state.studioSpecialTemplate === 'activityRace' && state.studioActivityUsesPeriodColor,
    workshopItemId: state.studioSpecialTemplate === 'steamWorkshop' ? state.studioWorkshopItemId : '',
    workshopItemTitle: state.studioSpecialTemplate === 'steamWorkshop' ? state.studioWorkshopItemTitle : '',
    workshopItemTokens: state.studioSpecialTemplate === 'steamWorkshop' && state.studioWorkshopItemTokens ? clone(state.studioWorkshopItemTokens) : null,
    workshopAssetMode: state.studioSpecialTemplate === 'steamWorkshop' ? state.studioWorkshopAssetMode : 'global',
    channelId: document.getElementById('studio-channel')?.value || state.selectedStudioChannelId || '',
    content: document.getElementById('studio-content')?.value || '',
    outsideImageUrl: document.getElementById('studio-outside-image')?.value || '',
    outsideImageName: document.getElementById('studio-outside-image-name')?.value || '',
    outsideImageSize: Number(document.getElementById('studio-outside-image-size')?.value || 0),
    outsideImageAttachment: studioOutsideImageAttachment ? clone(studioOutsideImageAttachment) : null,
    removeOutsideImage: studioOutsideImageRemovalRequested,
    messageId: state.activeStudioMessageId || '',
    embed: embeds[state.activeStudioEmbedIndex] || embeds[0],
    embeds,
    componentSet: document.getElementById('studio-component-set')?.value || state.studioComponentSet || 'none',
    reactionRoles: clone(state.studioReactionRoles),
    forumPost: {
      name: String(document.getElementById('thread-name')?.value || '').trim(),
      appliedTags: selectedForumPostTagIds()
    }
  };
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
  if (count) count.textContent = state.studioReactionRoles.length + ' Reaktionen';
  host.innerHTML = state.studioReactionRoles.length ? state.studioReactionRoles.map(function (entry, index) {
    const emojiPreview = entry.url
      ? '<img src="' + escapeHtml(entry.url) + '" alt="">'
      : '<strong>' + escapeHtml(entry.emoji || entry.emojiName || '?') + '</strong>';
    const emojiName = entry.emojiName || entry.name || entry.emoji || 'Emoji auswählen';
    return '<div class="studio-reaction-role-row" data-reaction-role-row="' + index + '"><button class="studio-reaction-emoji-picker-button" type="button" data-pick-reaction-emoji="' + index + '"><span class="studio-reaction-emoji">' + emojiPreview + '</span><span class="studio-reaction-emoji-copy"><b>' + escapeHtml(emojiName) + '</b><small>Server- oder Bot-Emoji auswählen</small></span><span class="studio-reaction-picker-chevron">⌄</span><input type="hidden" data-reaction-emoji value="' + escapeHtml(entry.emoji || entry.emojiName) + '"></button><label>Zielrolle<select data-reaction-role-id>' + studioRoleOptions(entry.roleId) + '</select></label><label class="studio-reaction-exclusive"><input type="checkbox" data-reaction-exclusive ' + (entry.exclusive ? 'checked' : '') + '><span>Nur eine Rolle</span></label><button type="button" data-remove-reaction-role="' + index + '" aria-label="Entfernen">&times;</button></div>';
  }).join('') : '<div class="studio-reaction-empty"><b>Noch keine Reaction Roles</b><span>Übernimm eine bestehende Nachricht oder füge eine Reaktion hinzu.</span></div>';
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
    return '<span>' + preview + '<b>1</b></span>';
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
    ? ['Mein Konto', 'VIP-Shop', 'VIP verschenken', 'Coins kaufen', 'Boost-Fortschritt', 'VIP-Vorteile', 'Coin-Verwaltung']
      .map(function (label, index) { return '<span class="function-button style-' + (index % 3) + '">' + escapeHtml(label) + '</span>'; }).join('')
    : '';
  host.hidden = !active;
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

function activityRaceStudioTemplate(config) {
  const design = config?.panelDesign || {};
  const embed = design.embed || {};
  return {
    specialTemplate: 'activityRace',
    activityRaceUsePeriodColor: !String(embed.color || '').trim(),
    channelId: String(config?.panelChannelId || ''),
    content: String(design.content || ''),
    outsideImageUrl: design.outsideImageAttachment ? '' : String(design.outsideImageUrl || ''),
    outsideImageName: String(design.outsideImageAttachment?.name || ''),
    outsideImageSize: Number(design.outsideImageAttachment?.size || 0),
    outsideImageAttachment: design.outsideImageAttachment || null,
    embed: {
      title: Object.prototype.hasOwnProperty.call(embed, 'title') ? embed.title : '{period}',
      url: embed.url || '',
      description: Object.prototype.hasOwnProperty.call(embed, 'description')
        ? embed.description
        : 'Die aktivsten Mitglieder im Chat und Sprachchat.\n*{completion}*',
      color: embed.color || '#6fd8ff',
      authorName: Object.prototype.hasOwnProperty.call(embed, 'authorName') ? embed.authorName : 'FALLEN HEAVEN · AKTIVITÄTS-LIGA',
      authorIconUrl: embed.authorIconUrl || '',
      thumbnailUrl: embed.thumbnailUrl || '',
      imageUrl: embed.imageUrl || '',
      footerText: Object.prototype.hasOwnProperty.call(embed, 'footerText') ? embed.footerText : '{period} · nachvollziehbar und automatisch ausgewertet',
      footerIconUrl: embed.footerIconUrl || '',
      timestamp: embed.timestamp !== false,
      fields: Array.isArray(embed.fields) ? clone(embed.fields).slice(0, 21) : []
    },
    componentSet: 'none',
    reactionRoles: []
  };
}

function activityRacePreviewValue(value) {
  return String(value || '')
    .replaceAll('{server}', state.guilds.find(function (guild) { return String(guild.id) === String(state.selectedGuildId); })?.name || 'FALLEN HEAVEN')
    .replaceAll('{period}', 'Heute')
    .replaceAll('{status}', 'Live-Zwischenstand')
    .replaceAll('{completion}', 'Tagesrollen wechseln live; Wochen- und Monatsrollen werden nach dem vollständigen Abschluss vergeben.')
    .replaceAll('{range}', new Date().toLocaleDateString('de-DE'))
    .replaceAll('{nextEvaluation}', '3 Std. 12 Min.');
}

function activityRacePreviewTemplate(template) {
  if (state.studioSpecialTemplate !== 'activityRace') return template;
  const preview = clone(template);
  const embed = preview.embed || preview.embeds?.[0] || {};
  const dynamicFields = [
    { name: 'CHAT', value: '🥇 @Mitglied\n> **128 Nachrichten**\n\n🥈 @Mitglied\n> **104 Nachrichten**\n\n🥉 @Mitglied\n> **91 Nachrichten**', inline: true },
    { name: 'SPRACHCHAT', value: '🥇 @Mitglied\n> **8 Std. 14 Min.**\n\n🥈 @Mitglied\n> **6 Std. 42 Min.**\n\n🥉 @Mitglied\n> **5 Std. 08 Min.**', inline: true },
    { name: 'NÄCHSTE AUSWERTUNG', value: '3 Std. 12 Min.', inline: true },
    { name: 'ZEITRAUM', value: new Date().toLocaleDateString('de-DE'), inline: true }
  ];
  const renderEmbed = function (source) {
    const result = clone(source || {});
    ['title', 'description', 'authorName', 'footerText'].forEach(function (key) { result[key] = activityRacePreviewValue(result[key]); });
    result.fields = dynamicFields.concat((Array.isArray(result.fields) ? result.fields : []).map(function (field) {
      return { ...field, name: activityRacePreviewValue(field.name), value: activityRacePreviewValue(field.value) };
    }));
    return result;
  };
  preview.content = activityRacePreviewValue(preview.content);
  preview.embed = renderEmbed(embed);
  preview.embeds = [preview.embed];
  return preview;
}

function aiChatWelcomeStudioTemplate(config) {
  const templates = Array.isArray(config?.embeds?.templates) ? config.embeds.templates : [];
  const stored = templates.find(function (template) { return template.id === 'ai-chat-welcome'; });
  const fallback = studioTemplates['ai-chat-welcome'] || {};
  const embed = (stored?.embed || fallback.embed || {});
  return {
    specialTemplate: 'aiChat',
    channelId: String(config?.aiChat?.channelId || ''),
    content: Object.prototype.hasOwnProperty.call(stored, 'content') ? String(stored.content || '') : String(fallback.content || ''),
    outsideImageUrl: '',
    embeds: [{
      title: embed.title || '', url: embed.url || '', description: embed.description || '', color: embed.color || '#9b59b6',
      authorName: embed.authorName || '', authorIconUrl: embed.authorIconUrl || '', thumbnailUrl: embed.thumbnailUrl || '',
      imageUrl: embed.imageUrl || '', footerText: embed.footerText || '', footerIconUrl: embed.footerIconUrl || '',
      timestamp: embed.timestamp !== false, fields: Array.isArray(embed.fields) ? clone(embed.fields).slice(0, 25) : []
    }],
    componentSet: 'none',
    reactionRoles: []
  };
}

function aiChatWelcomePreviewValue(value) {
  const guild = state.guilds.find(function (guild) { return String(guild.id) === String(state.selectedGuildId); });
  return String(value || '')
    .replaceAll('{guild}', guild?.name || 'FALLEN HEAVEN')
    .replaceAll('{memberCount}', String(guild?.memberCount || 42))
    .replaceAll('{date}', new Date().toLocaleDateString('de-DE'))
    .replaceAll('{time}', new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }));
}

function aiChatWelcomePreviewTemplate(template) {
  if (state.studioSpecialTemplate !== 'aiChat') return template;
  const preview = clone(template);
  preview.content = aiChatWelcomePreviewValue(preview.content);
  preview.embeds = (preview.embeds || [preview.embed || {}]).map(function (source) {
    const embed = clone(source);
    ['title', 'description', 'authorName', 'footerText'].forEach(function (key) { embed[key] = aiChatWelcomePreviewValue(embed[key]); });
    embed.fields = (embed.fields || []).map(function (field) {
      return { ...field, name: aiChatWelcomePreviewValue(field.name), value: aiChatWelcomePreviewValue(field.value) };
    });
    return embed;
  });
  preview.embed = preview.embeds[0] || {};
  return preview;
}

async function openAiChatWelcomeStudio() {
  if (!state.authenticated || !state.selectedGuildId) {
    toast('Wähle zuerst einen Server.', 'error');
    return;
  }
  if (!(await setView('studio'))) return;
  state.activeStudioMessageId = '';
  loadStudioTemplate(aiChatWelcomeStudioTemplate(state.config));
  renderDrafts();
  toast('AI-Chat-Info-Embed im bestehenden Embed Studio geöffnet.', 'success');
}

async function saveAiChatWelcomeStudioTemplate() {
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
    toast('Das AI-Chat-Info-Embed verwendet genau ein Embed. Entferne weitere Embeds, bevor du speicherst.', 'error');
    return false;
  }
  const embeds = (template.embeds || [template.embed || {}]).slice(0, 10).map(function (embed) {
    return {
      title: embed.title || '', url: embed.url || '', description: embed.description || '', color: embed.color || '#9b59b6',
      authorName: embed.authorName || '', authorIconUrl: embed.authorIconUrl || '', thumbnailUrl: embed.thumbnailUrl || '',
      imageUrl: embed.imageUrl || '', footerText: embed.footerText || '', footerIconUrl: embed.footerIconUrl || '',
      timestamp: embed.timestamp === true, fields: Array.isArray(embed.fields) ? clone(embed.fields).slice(0, 25) : []
    };
  });
  const current = clone(state.config?.embeds || {});
  const templates = Array.isArray(current.templates) ? current.templates : [];
  const stored = templates.find(function (entry) { return entry.id === 'ai-chat-welcome'; });
  const next = stored
    ? templates.map(function (entry) { return entry.id === 'ai-chat-welcome' ? { ...entry, content: String(template.content || ''), enabled: true, embed: embeds[0] || entry.embed } : entry; })
    : templates.concat([{ id: 'ai-chat-welcome', name: 'AI Chat Willkommen', category: 'Automation', channelId: '', content: String(template.content || ''), messageId: '', enabled: true, embed: embeds[0] || {} }]);
  const saved = await savePatch({ embeds: { ...current, templates: next } }, 'AI-Chat-Info-Embed gespeichert. Es wird beim nächsten Start oder Config-Update im Kanal aktualisiert.');
  if (saved) loadStudioTemplate(aiChatWelcomeStudioTemplate(state.config));
  return saved;
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
  if (state.studioSpecialTemplate === 'welcomeFarewell') return welcomeFarewellPreviewTemplate(template);
  if (state.studioSpecialTemplate === 'activityRace') return activityRacePreviewTemplate(template);
  if (state.studioSpecialTemplate === 'steamWorkshop') return steamWorkshopPreviewTemplate(template);
  if (state.studioSpecialTemplate === 'aiChat') return aiChatWelcomePreviewTemplate(template);
  return template;
}

function renderStudioSpecialTemplateUi() {
  const welcomeActive = state.studioSpecialTemplate === 'welcomeFarewell';
  const activityActive = state.studioSpecialTemplate === 'activityRace';
  const workshopActive = state.studioSpecialTemplate === 'steamWorkshop';
  const aiChatActive = state.studioSpecialTemplate === 'aiChat';
  const active = welcomeActive || activityActive || workshopActive || aiChatActive;
  const view = document.getElementById('studio-view');
  view?.classList.toggle('studio-activity-race-mode', activityActive);
  view?.classList.toggle('studio-steam-workshop-mode', workshopActive);
  const banner = document.getElementById('studio-special-template');
  if (banner) banner.hidden = !active;
  const bannerTitle = banner?.querySelector('[data-studio-special-title]');
  const bannerDetail = banner?.querySelector('[data-studio-special-detail]');
  const placeholders = banner?.querySelector('[data-studio-special-placeholders]');
  if (bannerTitle) bannerTitle.textContent = welcomeActive ? 'Welcome / Farewell' : workshopActive
    ? state.studioWorkshopItemId ? 'Steam Workshop · ' + state.studioWorkshopItemTitle : 'Steam Workshop'
    : aiChatActive ? 'AI Chat Info-Embed'
    : 'Aktivitäts-Liga';
  if (bannerDetail) bannerDetail.textContent = welcomeActive
    ? 'Diese Vorlage wird automatisch gesendet, sobald die Begrüßungsbedingung erfüllt ist. Discord-Mitglied und Server werden beim Versand dynamisch eingesetzt.'
    : workshopActive
    ? state.studioWorkshopItemId
      ? 'Du bearbeitest ausschließlich „' + state.studioWorkshopItemTitle + '“. Dieses Design bleibt bei späteren Steam-Abgleichen erhalten; die dynamischen Steam-Werte werden weiterhin aktualisiert.'
      : 'Du gestaltest die gemeinsame Standardvorlage. Ein eigenes großes Banner überschreibt das Steam-Vorschaubild; ohne Banner nutzt der Bot automatisch das beste Steam-Bild.'
    : aiChatActive
    ? 'Diese Nachricht steht immer im AI-Chat-Kanal, erklärt was man fragen kann und bleibt beim automatischen Aufräumen erhalten. Der Servername wird beim Versand dynamisch eingesetzt.'
    : 'Du bearbeitest hier direkt die Live-Vorlage des Moduls. Ranglisten, Zeitraum und Navigation setzt der Bot weiterhin automatisch ein.';
  if (placeholders) placeholders.innerHTML = (welcomeActive
    ? ['{user}', '{nickname}', '{username}', '{guild}']
    : workshopActive
    ? ['{title}', '{description}', '{previewUrl}', '{workshopUrl}', '{workshopId}', '{subscriptions}', '{favorites}', '{views}', '{ratingStars}', '{ratingValue}', '{ratingCount}', '{createdAt}', '{updatedAt}', '{fileSize}', '{appId}', '{game}', '{tags}', '{creator}', '{visibility}']
    : aiChatActive
    ? ['{guild}', '{memberCount}', '{date}', '{time}']
    : ['{server}', '{period}', '{status}', '{completion}', '{range}', '{nextEvaluation}'])
    .map(function (entry) { return '<code>' + escapeHtml(entry) + '</code>'; }).join('');
  const heading = view?.querySelector('.page-head h1');
  const detail = view?.querySelector('.page-head h1 + p');
  if (heading) heading.textContent = welcomeActive ? 'Willkommensnachricht im Embed Studio.' : workshopActive
    ? state.studioWorkshopItemId ? 'Workshop-Post individuell bearbeiten.' : 'Steam Workshop im Embed Studio.'
    : aiChatActive ? 'AI Chat Info-Embed im Embed Studio.'
    : activityActive ? 'Aktivitäts-Liga im Embed Studio.' : 'Embed Studio.';
  if (detail) detail.textContent = welcomeActive
    ? 'Gestalte die automatische Begrüßung mit Live-Vorschau, Bildern, Feldern und mehreren Embeds.'
    : workshopActive
    ? state.studioWorkshopItemId
      ? 'Titel, Text, Felder, Farben und Bilder gelten nur für diesen einen dauerhaften Forum-Post.'
      : 'Gestalte den vollständigen Mod-Katalog mit dem vorhandenen Editor und einer echten Steam-Datenvorschau.'
    : aiChatActive
    ? 'Gestalte die erste Nachricht im AI-Chat-Kanal mit denselben Werkzeugen wie jedes andere Embed.'
    : activityActive ? 'Gestalte die automatische Rangliste mit denselben Werkzeugen wie jedes andere Embed.' : 'Nachrichten mit Live-Vorschau erstellen, speichern, senden und später bearbeiten.';
  const save = document.getElementById('save-draft');
  const send = document.getElementById('send-studio-message');
  const sendSecondary = document.getElementById('send-studio-message-secondary');
  const edit = document.getElementById('edit-studio-message');
  const clear = document.getElementById('clear-content');
  if (save) save.textContent = welcomeActive ? 'Willkommensvorlage speichern' : workshopActive ? state.studioWorkshopItemId ? 'Einzelpost speichern' : 'Workshop-Vorlage speichern' : aiChatActive ? 'AI-Chat-Embed speichern' : activityActive ? 'Liga-Vorlage speichern' : 'Entwurf speichern';
  if (send) send.textContent = welcomeActive ? 'Willkommensvorlage übernehmen' : workshopActive ? state.studioWorkshopItemId ? 'Einzelpost aktualisieren' : 'Speichern & Katalog aktualisieren' : aiChatActive ? 'Embed speichern & aktualisieren' : activityActive ? 'Speichern & Panel aktualisieren' : 'Mit Bot senden';
  if (sendSecondary) sendSecondary.textContent = welcomeActive ? 'Willkommensvorlage übernehmen' : workshopActive ? state.studioWorkshopItemId ? 'Einzelpost aktualisieren' : 'Speichern & Katalog aktualisieren' : aiChatActive ? 'Embed speichern & aktualisieren' : activityActive ? 'Speichern & Panel aktualisieren' : 'Mit Bot senden';
  if (edit) edit.hidden = active;
  if (clear) clear.textContent = welcomeActive ? 'Welcome-Standard laden' : workshopActive ? state.studioWorkshopItemId ? 'Globale Vorlage laden' : 'Workshop-Standard laden' : aiChatActive ? 'AI-Chat-Standard laden' : activityActive ? 'Liga-Standard laden' : 'Leeren';
  document.querySelectorAll('#template-row [data-template]').forEach(function (button) {
    if (active) button.classList.toggle('active', button.dataset.template === state.studioSpecialTemplate);
  });
  renderStudioEmbedTabs();
}

async function openWelcomeFarewellStudio() {
  if (!state.authenticated || !state.selectedGuildId) {
    toast('Wähle zuerst einen Server.', 'error');
    return;
  }
  if (!(await setView('studio'))) return;
  state.activeStudioMessageId = '';
  loadStudioTemplate(welcomeFarewellStudioTemplate(state.config?.welcomeFarewell));
  renderDrafts();
  toast('Willkommensnachricht im bestehenden Embed Studio geöffnet.', 'success');
}

async function openActivityRaceStudio() {
  if (!state.authenticated || !state.selectedGuildId) {
    toast('Wähle zuerst einen Server.', 'error');
    return;
  }
  if (!(await setView('studio'))) return;
  state.activeStudioMessageId = '';
  loadStudioTemplate(activityRaceStudioTemplate(state.config?.activityRace));
  renderDrafts();
  toast('Aktivitäts-Liga im bestehenden Embed Studio geöffnet.', 'success');
}

async function openSteamWorkshopStudio() {
  if (!state.authenticated || !state.selectedGuildId) {
    toast('Wähle zuerst einen Server.', 'error');
    return;
  }
  if (!(await setView('studio'))) return;
  state.activeStudioMessageId = '';
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
  const welcomeTemplate = {
    content: String(template.content || '').slice(0, 2000),
    outsideImageUrl: String(template.outsideImageUrl || ''),
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
  const validation = renderStudioLimits(template);
  if (!validation.valid) {
    toast(validation.errors[0], 'error');
    return false;
  }
  if ((template.embed?.fields || []).length > 21) {
    toast('Die Liga reserviert vier Felder für Chat, Sprachchat, Auswertung und Zeitraum. Du kannst bis zu 21 eigene Felder ergänzen.', 'error');
    return false;
  }
  if (validation.totalEmbedCharacters > 5_000) {
    toast('Halte mindestens 1.000 Embed-Zeichen für die automatisch erzeugten Ranglisten frei.', 'error');
    return false;
  }
  if (!/^data:image\//i.test(String(template.outsideImageUrl || '')) && !template.outsideImageAttachment
    && template.outsideImageUrl && String(template.content || '').length + String(template.outsideImageUrl).length + 1 > 2_000) {
    toast('Nachricht und Außenbild-Link dürfen zusammen maximal 2.000 Zeichen enthalten.', 'error');
    return false;
  }
  const buttons = [
    document.getElementById('save-draft'),
    document.getElementById('send-studio-message'),
    document.getElementById('send-studio-message-secondary')
  ].filter(Boolean);
  buttons.forEach(function (button) { button.disabled = true; });
  try {
    const response = await api.apiRequest({
      path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/activity-race/design',
      method: 'PUT',
      body: { template },
      timeoutMs: template.outsideImageUrl ? 120000 : 45000
    });
    if (handleExpiredSession(response)) return false;
    if (!response.ok) throw new Error(response.data?.error || 'Die Liga-Vorlage konnte nicht gespeichert werden.');
    state.config.activityRace = response.data?.result?.config || state.config.activityRace;
    loadStudioTemplate(activityRaceStudioTemplate(state.config.activityRace));
    toast(response.data?.result?.panel
      ? 'Liga-Vorlage gespeichert und Live-Panel aktualisiert.'
      : 'Liga-Vorlage gespeichert. Das Panel wird nach der Aktivierung automatisch erstellt.', 'success');
    return true;
  } catch (error) {
    toast(String(error?.message || error), 'error');
    return false;
  } finally {
    buttons.forEach(function (button) { button.disabled = false; });
  }
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
  const buttons = [
    document.getElementById('save-draft'),
    document.getElementById('send-studio-message'),
    document.getElementById('send-studio-message-secondary')
  ].filter(Boolean);
  buttons.forEach(function (button) { button.disabled = true; });
  try {
    template.workshopItemId = state.studioWorkshopItemId;
    template.workshopAssetMode = state.studioWorkshopAssetMode;
    const individual = Boolean(state.studioWorkshopItemId);
    const response = await api.apiRequest({
      path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/steam-workshop/' + (individual ? 'items/' + encodeURIComponent(state.studioWorkshopItemId) + '/design' : 'design'),
      method: 'PUT',
      body: { template },
      timeoutMs: 180000
    });
    if (handleExpiredSession(response)) return false;
    if (!response.ok) throw new Error(response.data?.error || 'Die Workshop-Vorlage konnte nicht gespeichert werden.');
    if (individual) {
      const savedItem = response.data?.result?.item || {};
      steamWorkshopStatusSnapshot ||= { items: [] };
      const items = Array.isArray(steamWorkshopStatusSnapshot.items) ? steamWorkshopStatusSnapshot.items : [];
      const index = items.findIndex(function (entry) { return String(entry.workshopId || '') === state.studioWorkshopItemId; });
      if (index >= 0) items[index] = savedItem;
      else items.push(savedItem);
      loadStudioTemplate(steamWorkshopStudioTemplate(state.config.steamWorkshop, savedItem));
      toast('Individuelles Workshop-Design gespeichert und genau dieser Forum-Post aktualisiert.', 'success');
    } else {
      state.config.steamWorkshop = response.data?.result?.config || state.config.steamWorkshop;
      loadStudioTemplate(steamWorkshopStudioTemplate(state.config.steamWorkshop));
      toast(response.data?.result?.sync
        ? 'Workshop-Vorlage gespeichert und alle Katalogeinträge aktualisiert.'
        : 'Workshop-Vorlage gespeichert. Nach der Modulaktivierung wird sie automatisch verwendet.', 'success');
    }
    return true;
  } catch (error) {
    toast(String(error?.message || error), 'error');
    return false;
  } finally {
    buttons.forEach(function (button) { button.disabled = false; });
  }
}

function loadStudioTemplate(template) {
  const data = template || {};
  state.studioSpecialTemplate = ['welcomeFarewell', 'activityRace', 'steamWorkshop', 'aiChat'].includes(data.specialTemplate) ? data.specialTemplate : '';
  state.studioActivityUsesPeriodColor = state.studioSpecialTemplate === 'activityRace' && data.activityRaceUsePeriodColor === true;
  state.studioWorkshopItemId = state.studioSpecialTemplate === 'steamWorkshop' ? String(data.workshopItemId || '') : '';
  state.studioWorkshopItemTitle = state.studioWorkshopItemId ? String(data.workshopItemTitle || '') : '';
  state.studioWorkshopItemTokens = state.studioWorkshopItemId && data.workshopItemTokens ? clone(data.workshopItemTokens) : null;
  state.studioWorkshopAssetMode = state.studioWorkshopItemId && ['global', 'item', 'none'].includes(data.workshopAssetMode) ? data.workshopAssetMode : 'global';
  const sourceEmbeds = Array.isArray(data.embeds) && data.embeds.length ? data.embeds : [data.embed || {}];
  state.studioEmbeds = sourceEmbeds.slice(0, 10).map(normalizeStudioEmbed);
  state.studioReactionRoles = (Array.isArray(data.reactionRoles) ? data.reactionRoles : []).map(normalizeStudioReactionRole);
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
  studioOutsideImageAttachment = normalizeOutsideImageAttachment(data.outsideImageAttachment || sourceEmbeds[0]?.outsideImageAttachment);
  studioOutsideImageRemovalRequested = data.removeOutsideImage === true;
  studioOutsideImageExistingAttachment = !studioOutsideImageRemovalRequested && Boolean(studioOutsideImageAttachment || data.outsideImageNeedsReselect || sourceEmbeds[0]?.outsideImageNeedsReselect);
  const outside = document.getElementById('studio-outside-image');
  const outsideName = document.getElementById('studio-outside-image-name');
  const outsideSize = document.getElementById('studio-outside-image-size');
  if (outside) outside.value = legacyOutside;
  if (outsideName) outsideName.value = legacyOutsideName || studioOutsideImageAttachment?.name || '';
  if (outsideSize) outsideSize.value = String(data.outsideImageSize || sourceEmbeds[0]?.outsideImageSize || studioOutsideImageAttachment?.size || 0);
  updateOutsideImagePicker();
  writeStudioEmbedToForm(state.studioEmbeds[state.activeStudioEmbedIndex]);
  renderStudioEmbedTabs();
  renderStudioReactionRoles();
  renderStudioComponentSetPreview();
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
  if (title) title.textContent = embed.title || 'Ohne Titel';
  if (description) description.textContent = embed.description || 'Keine Beschreibung.';
  if (signature) signature.textContent = embed.footerText || 'FALLEN HEAVEN';
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
    const outsideSource = previewTemplate.outsideImageUrl || previewTemplate.outsideImageAttachment?.url || embed.outsideImageUrl || '';
    outsideImage.hidden = !validImageUrl(outsideSource);
    outsideImage.src = validImageUrl(outsideSource) ? outsideSource : '';
  }
  renderStudioReactionPreview();
  renderStudioComponentSetPreview();
  if (footerIcon) footerIcon.src = validImageUrl(embed.footerIconUrl) ? embed.footerIconUrl : 'assets/fallen-heaven-icon.png';
  if (timestamp) timestamp.hidden = !embed.timestamp;
  if (fields) {
    fields.innerHTML = (embed.fields || []).map(function (field) {
      return '<div class="embed-field' + (field.inline ? ' inline' : '') + '"><strong>' + escapeHtml(field.name || '\u200b') + '</strong><span>' + escapeHtml(field.value || '\u200b') + '</span></div>';
    }).join('');
  }
  if (extraEmbeds) {
    extraEmbeds.innerHTML = previewTemplate.embeds.map(function (item, index) {
      if (index === state.activeStudioEmbedIndex) return '';
      const itemFields = (item.fields || []).map(function (field) {
        return '<div class="embed-field' + (field.inline ? ' inline' : '') + '"><strong>' + escapeHtml(field.name || '\u200b') + '</strong><span>' + escapeHtml(field.value || '\u200b') + '</span></div>';
      }).join('');
      return '<div class="embed-preview studio-extra-embed" style="--studio-embed-color:' + escapeHtml(item.color || '#58b9ff') + '"><span class="embed-line" style="background:' + escapeHtml(item.color || '#58b9ff') + '"></span><div class="embed-content">' +
        (item.authorName ? '<div class="embed-author"><img src="' + escapeHtml(validImageUrl(item.authorIconUrl) ? item.authorIconUrl : 'assets/fallen-heaven-icon.png') + '" alt=""><span>' + escapeHtml(item.authorName) + '</span></div>' : '') +
        '<h3>' + escapeHtml(item.title || 'Ohne Titel') + '</h3><p>' + escapeHtml(item.description || 'Keine Beschreibung.') + '</p><div class="embed-fields">' + itemFields + '</div>' +
        (validImageUrl(item.imageUrl) ? '<img class="embed-image" src="' + escapeHtml(item.imageUrl) + '" alt="">' : '') +
        '<div class="embed-footer"><img src="' + escapeHtml(validImageUrl(item.footerIconUrl) ? item.footerIconUrl : 'assets/fallen-heaven-icon.png') + '" alt=""><span>' + escapeHtml(item.footerText || '') + '</span>' + (item.timestamp ? '<time>Heute</time>' : '') + '</div>' +
        (validImageUrl(item.thumbnailUrl) ? '<img class="embed-thumbnail" src="' + escapeHtml(item.thumbnailUrl) + '" alt="">' : '') + '</div></div>';
    }).join('');
  }
  const editButton = document.getElementById('edit-studio-message');
  if (editButton) editButton.disabled = !state.activeStudioMessageId;
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
    return '<button class="draft-row sent ' + (entry.id === state.activeStudioMessageId ? 'active' : '') + '" data-studio-message="' + escapeHtml(entry.id) + '">' +
      '<span style="background:' + escapeHtml(entry.template?.embed?.color || '#58b9ff') + '"></span><div><strong>' + escapeHtml(title) + '</strong><small>Gesendet in #' + escapeHtml(channel?.name || entry.channelId || 'Kanal') + ' · ' + escapeHtml(entry.updatedAt || entry.sentAt || '') + '</small></div><i>EDIT</i></button>';
  });
  const draftRows = state.drafts.map(function (draft) {
    return '<button class="draft-row" data-draft="' + escapeHtml(draft.id) + '"><span style="background:' + escapeHtml(draft.color || draft.template?.embed?.color || '#58b9ff') + '"></span><div><strong>' + escapeHtml(draft.title || 'Entwurf') + '</strong><small>Entwurf · ' + escapeHtml(draft.createdAt || '') + '</small></div><i>LOAD</i></button>';
  });
  container.innerHTML = sentRows.concat(draftRows).join('') || '<p class="empty-drafts">Noch keine Entwürfe oder gesendeten Bot-Nachrichten gespeichert.</p>';
}

function loadDraft(id) {
  const draft = state.drafts.find(function (item) { return item.id === id; });
  if (!draft) return;
  state.activeStudioMessageId = '';
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

function getStudioAssistantTarget() {
  const target = document.getElementById('studio-ai-target')?.value || 'description';
  if (target === 'title') return { id: 'studio-title', label: 'Embed-Titel', maximum: 256 };
  if (target === 'content') return { id: 'studio-content', label: 'Nachricht', maximum: 2000 };
  return { id: 'studio-description', label: 'Embed-Beschreibung', maximum: 4096 };
}

function updateStudioAssistantResultState() {
  const output = document.getElementById('studio-ai-output');
  const text = String(output?.value || '').trim();
  const count = document.getElementById('studio-ai-result-count');
  if (count) count.textContent = text.length.toLocaleString('de-DE') + ' Zeichen';
  ['studio-ai-apply', 'studio-ai-append'].forEach(function (id) {
    const button = document.getElementById(id);
    if (button) button.disabled = !text;
  });
}

function attachStudioTextCounter(input) {
  if (!input || input.dataset.studioCounterReady === 'true' || input.id === 'studio-ai-output') return;
  const maximum = Number(input.maxLength);
  const label = input.closest('label');
  if (!label || !Number.isFinite(maximum) || maximum <= 0) return;

  input.dataset.studioCounterReady = 'true';
  label.classList.add('has-studio-text-counter');
  const counter = document.createElement('span');
  counter.className = 'studio-text-counter';
  counter.setAttribute('aria-hidden', 'true');
  label.append(counter);

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

async function generateStudioAssistantText() {
  if (!state.authenticated) { void beginLogin(); return; }
  if (!state.selectedGuildId) { toast('Wähle zuerst einen Server.', 'error'); return; }
  const target = getStudioAssistantTarget();
  const targetInput = document.getElementById(target.id);
  const instruction = String(document.getElementById('studio-ai-instruction')?.value || '').trim();
  const mode = document.getElementById('studio-ai-mode')?.value || 'create';
  if (mode === 'create' && !instruction) { toast('Beschreibe kurz, welchen Text die AI schreiben soll.', 'info'); return; }

  const button = document.getElementById('studio-ai-generate');
  const status = document.getElementById('studio-ai-status');
  if (button) { button.disabled = true; button.dataset.previousText = button.textContent; button.textContent = 'AI schreibt ...'; }
  if (status) status.textContent = 'Ollama formuliert einen passenden Vorschlag ...';

  const template = currentStudioTemplate();
  const response = await api.apiRequest({
    path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/embed/assistant',
    method: 'POST',
    body: {
      mode,
      target: document.getElementById('studio-ai-target')?.value || 'description',
      tone: document.getElementById('studio-ai-tone')?.value || 'professional',
      instruction,
      currentText: String(targetInput?.value || ''),
      context: {
        content: template.content || '',
        title: template.embed?.title || '',
        description: template.embed?.description || ''
      }
    }
  });

  if (button) { button.disabled = false; button.textContent = button.dataset.previousText || 'Text erstellen'; }
  if (!response.ok) {
    if (status) status.textContent = response.data?.error || 'Der Text-Assistent konnte keinen Vorschlag erstellen.';
    toast(response.data?.error || 'AI-Vorschlag fehlgeschlagen.', 'error');
    return;
  }

  const output = document.getElementById('studio-ai-output');
  if (output) output.value = String(response.data?.result?.text || '').slice(0, 4096);
  if (status) status.textContent = 'Vorschlag bereit für ' + target.label + '. Prüfe ihn und übernimm ihn anschließend.';
  updateStudioAssistantResultState();
}

function applyStudioAssistantText(append = false) {
  const target = getStudioAssistantTarget();
  const input = document.getElementById(target.id);
  const proposal = String(document.getElementById('studio-ai-output')?.value || '').trim();
  if (!input || !proposal) return;
  const separator = append && String(input.value || '').trim() ? '\n\n' : '';
  const nextValue = (append ? String(input.value || '').trim() + separator + proposal : proposal).slice(0, target.maximum);
  input.value = nextValue;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  updatePreview();
  toast(target.label + (append ? ' wurde ergänzt.' : ' wurde ersetzt.'), 'success');
}

async function sendStudioMessage() {
  if (state.studioSpecialTemplate === 'welcomeFarewell') {
    await saveWelcomeFarewellStudioTemplate();
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
  const response = await api.apiRequest({
    path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + (sendAsForumPost ? '/thread/create' : '/embed/send'),
    method: 'POST',
    body: sendAsForumPost
      ? { parentChannelId: template.channelId, name: forumPostName, template: { ...template, channelId: template.channelId }, appliedTags: forumPostTags }
      : { template },
    timeoutMs: template.outsideImageUrl ? 120000 : 45000
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
  const record = state.studioMessages.find(function (item) { return item.id === state.activeStudioMessageId; });
  if (!record) return;
  const template = currentStudioTemplate();
  const validation = renderStudioLimits(template);
  if (!validation.valid) { toast(validation.errors[0], 'error'); return; }
  template.messageId = record.messageId;
  template.channelId = template.channelId || record.channelId;
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
    timeoutMs: template.outsideImageUrl ? 120000 : 45000
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
  record.template = makeStudioTemplateStorageSafe({
    ...template,
    outsideImageAttachment,
    outsideImageName: outsideImageAttachment?.name || '',
    outsideImageSize: outsideImageAttachment?.size || 0,
    outsideImageNeedsReselect: false,
    removeOutsideImage: false
  });
  record.channelId = template.channelId;
  record.updatedAt = new Date().toLocaleString('de-DE');
  persistStudioMessages();
  loadStudioTemplate(record.template);
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
}

function toggleTheme() {
  const next = document.body.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  document.body.dataset.theme = next;
  document.documentElement.style.colorScheme = next;
  document.body.classList.toggle('theme-light', next === 'light');
  document.body.classList.toggle('theme-dark', next === 'dark');
  localStorage.setItem('fh-app-theme', next);
  localStorage.setItem('fh-native-theme', next);
}

function appEditorValue(id) {
  return document.getElementById(id)?.value || '';
}

function setAppEditorStatus(message) {
  const node = document.getElementById('app-editor-status');
  if (node) node.textContent = message;
}

function mixAppColor(hex, target = '#f1f2f6', amount = 0.38) {
  const normalize = (value) => {
    const raw = String(value || '').replace('#', '').trim();
    const expanded = raw.length === 3 ? raw.split('').map((part) => part + part).join('') : raw;
    return /^[0-9a-f]{6}$/i.test(expanded) ? expanded : 'a796c8';
  };
  const source = normalize(hex);
  const destination = normalize(target);
  const channel = (offset) => Math.round(
    parseInt(source.slice(offset, offset + 2), 16) * (1 - amount) +
    parseInt(destination.slice(offset, offset + 2), 16) * amount
  ).toString(16).padStart(2, '0');
  return `#${channel(0)}${channel(2)}${channel(4)}`;
}

function applyAppEditorSettings(settings = appEditorSettings) {
  appEditorSettings = {
    ...appEditorDefaults,
    ...settings,
    pages: { ...appEditorDefaults.pages, ...(settings.pages || {}) }
  };
  appEditorActivePage = appEditorSettings.selectedPage || appEditorActivePage || 'home';
  document.documentElement.style.setProperty('--accent', appEditorSettings.accent);
  document.documentElement.style.setProperty('--accent-strong', appEditorSettings.accent);
  document.documentElement.style.setProperty('--v4-amethyst', appEditorSettings.accent);
  document.documentElement.style.setProperty('--v4-amethyst-bright', mixAppColor(appEditorSettings.accent));
  document.body.dataset.appBackground = appEditorSettings.background;
  document.body.dataset.appDensity = appEditorSettings.density;
  document.body.classList.toggle('motion-reduced', !appEditorSettings.motion);

  document.querySelectorAll('.landing-brand span, .native-dashboard-brand span').forEach(function (node) {
    node.innerHTML = escapeHtml(appEditorSettings.brand).replace(/\s+/g, '<br>');
  });
  const heroTitle = document.querySelector('.hero-copy h1');
  if (heroTitle) heroTitle.innerHTML = escapeHtml(appEditorSettings.hero).replace(/\n/g, '<br>');
  const publicHeroTitle = document.querySelector('.landing-copy h1');
  if (publicHeroTitle) publicHeroTitle.innerHTML = escapeHtml(appEditorSettings.hero).replace(/\n/g, '<br>');
  document.querySelectorAll('.hero-lead, .landing-copy h2').forEach(function (node) {
    node.textContent = appEditorSettings.lead;
  });

  const previewBrand = document.getElementById('app-editor-preview-brand');
  const previewKicker = document.getElementById('app-editor-preview-kicker');
  const previewTitle = document.getElementById('app-editor-preview-title');
  const previewLead = document.getElementById('app-editor-preview-lead');
  const selectedPreviewPage = appEditorSettings.pages?.[appEditorSettings.selectedPage || 'home'] || appEditorDefaults.pages.home;
  const previewShell = document.querySelector('.app-editor-preview');
  if (previewShell) {
    previewShell.dataset.previewPage = appEditorSettings.selectedPage || 'home';
    previewShell.dataset.previewTitle = selectedPreviewPage.title || appEditorSettings.hero || '';
  }
  if (previewBrand) previewBrand.textContent = appEditorSettings.brand;
  if (previewKicker) previewKicker.textContent = selectedPreviewPage.kicker || 'LIVE APP PREVIEW';
  if (previewTitle) previewTitle.innerHTML = escapeHtml(selectedPreviewPage.title || appEditorSettings.hero).replace(/\n/g, '<br>');
  if (previewLead) previewLead.textContent = selectedPreviewPage.lead || appEditorSettings.lead;
  const previewCardContent = {
    home: [['Dashboard', 'Discord Login'], ['AI Center', 'Lokal + Web'], ['Embed Studio', 'Bot-Versand']],
    center: [['Bot-Service', 'Live-Steuerung'], ['Server', 'Echtzeitdaten'], ['Aktivität', 'Übersicht']],
    modules: [['Moderation', 'Schutz aktiv'], ['AI Chat', 'Smart Search'], ['Logging', 'Audit bereit']],
    studio: [['Entwürfe', 'Gespeichert'], ['Live Preview', 'Discord-Look'], ['Nachrichten', 'Bearbeitbar']],
    skin: [['Pixel Canvas', '64 × 64'], ['3D Modell', 'Live Vorschau'], ['Export', 'Minecraft PNG']],
    editor: [['Seiten', 'Live bearbeitbar'], ['Theme', 'Hell + Dunkel'], ['Vorschau', 'Fokusmodus']],
    system: [['Bot-Prozess', 'Überwacht'], ['Ollama', 'Lokal'], ['Speicher', 'Gesichert']]
  };
  document.querySelectorAll('.app-editor-preview-cards article').forEach(function (card, index) {
    const content = (previewCardContent[appEditorSettings.selectedPage] || previewCardContent.home)[index];
    if (!content) return;
    const strong = card.querySelector('strong');
    const small = card.querySelector('small');
    if (strong) strong.textContent = content[0];
    if (small) small.textContent = content[1];
  });

  applyPageCopy('home', {
    kicker: ['.landing-copy .kicker', '.hero-copy .kicker'],
    title: ['.landing-copy h1', '.hero-copy h1'],
    lead: ['.landing-copy h2', '.hero-lead']
  });
  applyPageCopy('center', {
    kicker: ['#center-view .page-head .eyebrow'],
    title: ['#center-view .page-head h1'],
    lead: ['#center-view .page-head > div > p:last-child']
  });
  applyPageCopy('community', {
    kicker: ['#community-view .page-head .eyebrow'],
    title: ['#community-view .page-head h1'],
    lead: ['#community-view .page-head > div > p:last-child']
  });
  applyPageCopy('modules', {
    kicker: ['#modules-view .page-head .eyebrow'],
    title: ['#modules-view .page-head h1'],
    lead: ['#modules-view .page-head > div > p:last-child']
  });
  applyPageCopy('studio', {
    kicker: ['#studio-view .page-head .eyebrow'],
    title: ['#studio-view .page-head h1'],
    lead: ['#studio-view .page-head > div > p:last-child']
  });
  applyPageCopy('skin', {
    kicker: ['#skin-view .page-head .eyebrow'],
    title: ['#skin-view .page-head h1'],
    lead: ['#skin-view .page-head > div > p:last-child']
  });
  applyPageCopy('editor', {
    kicker: ['#editor-view .page-head .eyebrow'],
    title: ['#editor-view .page-head h1'],
    lead: ['#editor-view .page-head > div > p:last-child']
  });
  applyPageCopy('system', {
    kicker: ['#system-view .page-head .eyebrow'],
    title: ['#system-view .page-head h1'],
    lead: ['#system-view .page-head > div > p:last-child']
  });
  scheduleAppEditorPagePreview();
}

function applyPageCopy(pageId, selectors) {
  const page = appEditorSettings.pages?.[pageId] || appEditorDefaults.pages[pageId];
  if (!page) return;
  (selectors.kicker || []).forEach(function (selector) {
    document.querySelectorAll(selector).forEach(function (node) { node.textContent = page.kicker || ''; });
  });
  (selectors.title || []).forEach(function (selector) {
    document.querySelectorAll(selector).forEach(function (node) { node.innerHTML = escapeHtml(page.title || '').replace(/\n/g, '<br>'); });
  });
  (selectors.lead || []).forEach(function (selector) {
    document.querySelectorAll(selector).forEach(function (node) { node.textContent = page.lead || ''; });
  });
}

let appEditorPreviewTimer = null;
function scheduleAppEditorPagePreview() {
  clearTimeout(appEditorPreviewTimer);
  appEditorPreviewTimer = setTimeout(renderAppEditorPagePreview, 90);
}

function renderAppEditorPagePreview() {
  const pageId = appEditorSettings.selectedPage || appEditorActivePage || 'home';
  const source = document.getElementById(pageId + '-view');
  const frame = document.getElementById('app-editor-page-frame');
  const label = document.getElementById('app-editor-preview-page-label');
  if (!source || !frame) return;
  const pageName = document.querySelector(`#app-edit-page option[value="${pageId}"]`)?.textContent || pageId;
  if (label) label.textContent = `VOLLSTÄNDIGE SEITE · ${pageName.toUpperCase()}`;

  const clone = source.cloneNode(true);
  clone.classList.add('active', 'editor-native-page-clone');
  clone.removeAttribute('aria-hidden');
  clone.querySelectorAll('script, dialog').forEach(function (node) { node.remove(); });
  clone.querySelectorAll('button, input, select, textarea, a').forEach(function (node) {
    node.setAttribute('tabindex', '-1');
    node.style.pointerEvents = 'none';
  });
  if (pageId === 'editor') {
    const recursivePreview = clone.querySelector('.app-editor-preview');
    if (recursivePreview) recursivePreview.innerHTML = '<div class="editor-recursion-note"><b>Vollseiten-App-Editor</b><p>Dieser Bereich ist die Vorschau, in der du dich gerade befindest.</p></div>';
  }

  const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(function (link) {
    return `<link rel="stylesheet" href="${escapeHtml(link.href)}">`;
  }).join('');
  const theme = document.body.dataset.theme || 'dark';
  const background = document.body.dataset.appBackground || 'fallen';
  const density = document.body.dataset.appDensity || 'premium';
  frame.srcdoc = `<!doctype html><html><head><base href="${escapeHtml(document.baseURI)}">${styles}<style>html,body{min-height:100%;margin:0;overflow:auto}body{padding:0!important}.view.editor-native-page-clone{display:block!important;width:calc(100% - 28px)!important;max-width:none!important;min-height:100vh;margin:0 auto!important;padding:26px 0 70px!important}.view.editor-native-page-clone#home-view{width:100%!important;padding:0!important}.editor-recursion-note{min-height:520px;display:grid;place-content:center;text-align:center;color:var(--text)}.editor-recursion-note p{color:var(--muted)}button,input,select,textarea,a{cursor:default!important}</style></head><body data-theme="${escapeHtml(theme)}" data-app-background="${escapeHtml(background)}" data-app-density="${escapeHtml(density)}">${clone.outerHTML}</body></html>`;
}

function syncAppEditorForm() {
  const setValue = function (id, value) {
    const node = document.getElementById(id);
    if (node) node.value = value;
  };
  setValue('app-edit-brand', appEditorSettings.brand);
  setValue('app-edit-subtitle', appEditorSettings.subtitle);
  setValue('app-edit-hero', appEditorSettings.hero);
  setValue('app-edit-lead', appEditorSettings.lead);
  setValue('app-edit-accent', appEditorSettings.accent);
  setValue('app-edit-background', appEditorSettings.background);
  setValue('app-edit-density', appEditorSettings.density);
  setValue('app-edit-page', appEditorSettings.selectedPage || 'home');
  appEditorActivePage = appEditorSettings.selectedPage || 'home';
  syncAppEditorPageForm();
  const motion = document.getElementById('app-edit-motion');
  if (motion) motion.checked = appEditorSettings.motion !== false;
}

function syncAppEditorPageForm() {
  const pageId = appEditorValue('app-edit-page') || appEditorSettings.selectedPage || 'home';
  const page = appEditorSettings.pages?.[pageId] || appEditorDefaults.pages[pageId] || {};
  const setValue = function (id, value) {
    const node = document.getElementById(id);
    if (node) node.value = value || '';
  };
  setValue('app-edit-page-kicker', page.kicker);
  setValue('app-edit-page-title', page.title);
  setValue('app-edit-page-lead', page.lead);
}

function readAppEditorForm(pageOverride = null) {
  const selectedPage = appEditorValue('app-edit-page') || appEditorSettings.selectedPage || appEditorActivePage || 'home';
  const currentPage = pageOverride || appEditorActivePage || selectedPage || 'home';
  const pages = { ...(appEditorSettings.pages || {}) };
  pages[currentPage] = {
    kicker: appEditorValue('app-edit-page-kicker') || appEditorDefaults.pages[currentPage]?.kicker || '',
    title: appEditorValue('app-edit-page-title') || appEditorDefaults.pages[currentPage]?.title || '',
    lead: appEditorValue('app-edit-page-lead') || appEditorDefaults.pages[currentPage]?.lead || ''
  };
  return {
    brand: appEditorValue('app-edit-brand') || appEditorDefaults.brand,
    subtitle: appEditorValue('app-edit-subtitle') || appEditorDefaults.subtitle,
    hero: appEditorValue('app-edit-hero') || appEditorDefaults.hero,
    lead: appEditorValue('app-edit-lead') || appEditorDefaults.lead,
    accent: appEditorValue('app-edit-accent') || appEditorDefaults.accent,
    background: appEditorValue('app-edit-background') || appEditorDefaults.background,
    density: appEditorValue('app-edit-density') || appEditorDefaults.density,
    motion: document.getElementById('app-edit-motion')?.checked !== false,
    selectedPage,
    pages
  };
}

function saveAppEditorSettings() {
  appEditorSettings = readAppEditorForm();
  localStorage.setItem('fh-app-editor-settings', JSON.stringify(appEditorSettings));
  applyAppEditorSettings(appEditorSettings);
  setAppEditorStatus('App-Design gespeichert und live angewendet.');
  toast('App-Design gespeichert.', 'success');
}

function resetAppEditorSettings() {
  appEditorSettings = normalizeAppEditorSettings(clone(appEditorDefaults));
  localStorage.setItem('fh-app-editor-settings', JSON.stringify(appEditorSettings));
  syncAppEditorForm();
  applyAppEditorSettings(appEditorSettings);
  setAppEditorStatus('App-Design wurde zurückgesetzt.');
  toast('App Editor zurückgesetzt.', 'success');
}

document.querySelectorAll('[data-view]').forEach(function (button) {
  button.addEventListener('click', function () { void setView(button.dataset.view); });
});
document.querySelectorAll('[data-login]').forEach(function (button) {
  button.addEventListener('click', function () { void beginLogin(); });
});
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
bindId('template-row', 'click', function (event) {
  const button = event.target.closest('[data-template]');
  if (!button) return;
  if (['activityRace', 'steamWorkshop'].includes(button.dataset.template) && !state.selectedGuildId) {
    toast('Wähle zuerst einen Discord-Server für diese automatische Vorlage.', 'error');
    return;
  }
  document.querySelectorAll('#template-row [data-template]').forEach(function (item) { item.classList.toggle('active', item === button); });
  state.activeStudioMessageId = '';
  if (button.dataset.template === 'activityRace') {
    loadStudioTemplate(activityRaceStudioTemplate(state.config?.activityRace));
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
bindId('studio-special-back', 'click', function () {
  const button = document.querySelector('#template-row [data-template="welcome"]');
  document.querySelectorAll('#template-row [data-template]').forEach(function (item) { item.classList.toggle('active', item === button); });
  state.activeStudioMessageId = '';
  loadStudioTemplate(studioTemplates.welcome);
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
bindId('studio-ai-generate', 'click', function () { void generateStudioAssistantText(); });
bindId('studio-ai-apply', 'click', function () { applyStudioAssistantText(false); });
bindId('studio-ai-append', 'click', function () { applyStudioAssistantText(true); });
bindId('studio-ai-output', 'input', updateStudioAssistantResultState);
bindId('preview-embed-stack', 'click', function (event) {
  const target = event.target.closest('[data-preview-embed-index]');
  if (!target) return;
  selectStudioEmbed(Number(target.dataset.previewEmbedIndex));
});
bindId('save-draft', 'click', function () {
  if (!state.authenticated) { void beginLogin(); return; }
  if (state.studioSpecialTemplate === 'welcomeFarewell') {
    void saveWelcomeFarewellStudioTemplate();
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
  if (state.studioSpecialTemplate === 'aiChat') {
    void saveAiChatWelcomeStudioTemplate();
    return;
  }
  state.drafts.unshift(makeStudioTemplateStorageSafe(currentDraft()));
  state.drafts = state.drafts.slice(0, 12);
  localStorage.setItem('fh-native-drafts', JSON.stringify(state.drafts));
  renderDrafts();
  toast('Draft lokal gespeichert.', 'success');
});
initializeStudioTextCounters();
bindId('draft-list', 'click', function (event) {
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
  state.studioFields = [];
  if (state.studioSpecialTemplate === 'welcomeFarewell') {
    loadStudioTemplate(welcomeFarewellStudioTemplate({ welcomeChannelId: document.getElementById('studio-channel')?.value || '' }));
    renderDrafts();
    return;
  }
  if (state.studioSpecialTemplate === 'activityRace') {
    loadStudioTemplate(activityRaceStudioTemplate({ panelChannelId: document.getElementById('studio-channel')?.value || '' }));
    renderDrafts();
    return;
  }
  if (state.studioSpecialTemplate === 'aiChat') {
    loadStudioTemplate(aiChatWelcomeStudioTemplate({ aiChat: { channelId: document.getElementById('studio-channel')?.value || '' } }));
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
    appEditorSettings = readAppEditorForm();
    applyAppEditorSettings(appEditorSettings);
    setAppEditorStatus('Live-Vorschau aktualisiert. Speichern übernimmt die Einstellung dauerhaft.');
  });
  node.addEventListener('change', function () {
    appEditorSettings = readAppEditorForm();
    applyAppEditorSettings(appEditorSettings);
  });
});
bindId('app-edit-page', 'change', function () {
  const previousPage = appEditorActivePage || appEditorSettings.selectedPage || 'home';
  const nextPage = appEditorValue('app-edit-page') || 'home';
  appEditorSettings = readAppEditorForm(previousPage);
  appEditorSettings.selectedPage = nextPage;
  appEditorActivePage = nextPage;
  syncAppEditorPageForm();
  applyAppEditorSettings(appEditorSettings);
  const selectedLabel = document.getElementById('app-edit-page')?.selectedOptions?.[0]?.textContent || nextPage;
  setAppEditorStatus('Seite ausgewählt. Du bearbeitest jetzt: ' + selectedLabel + '.');
});
bindId('app-editor-save', 'click', saveAppEditorSettings);
bindId('app-editor-reset', 'click', resetAppEditorSettings);
bindId('app-editor-expand', 'click', function () {
  const editorView = document.getElementById('editor-view');
  if (!editorView) return;
  const expanded = editorView.classList.toggle('editor-focus');
  this.textContent = expanded ? 'Editor anzeigen' : 'Vorschau maximieren';
  setAppEditorStatus(expanded ? 'Große Seitenvorschau aktiv. Mit dem Button kommst du zu den Editor-Feldern zurück.' : 'Editor-Felder wieder eingeblendet.');
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
    applyAppEditorSettings(appEditorSettings);
    updateShellMode();
    const info = await api.getInfo();
    setText('app-version', 'v' + (info?.version || ''));
    setText('modern-login-version', 'v' + (info?.version || ''));
    loadStudioTemplate(studioTemplates.welcome);
    renderStudioFields();
    renderDrafts();
    updatePreview();
    renderTimeline();
    renderModules();
    await refreshStatus(true);
    const restoredSession = await refreshAuth({ startup: true });
    if (restoredSession === true) setView('center');
    else if (restoredSession === 'pending') setPrebootStatus('Discord-Daten werden nach dem Neustart geprüft …');
    else document.body.classList.add('access-open');
  } catch (error) {
    console.error('App-Initialisierung fehlgeschlagen:', error);
    document.body.classList.remove('auth-restoring', 'auth-busy');
    document.body.classList.add('auth-ready', 'access-open');
    document.getElementById('preboot-screen')?.setAttribute('aria-hidden', 'true');
    toast('Die App wurde mit eingeschränkten Funktionen gestartet. Details stehen im Systemprotokoll.', 'error');
  }
  window.FallenHeavenJobs.upsert('app-status-refresh', async function () {
    if (document.hidden) return;
    await refreshStatus(true);
  }, 15000, { immediate: false, retryDelay: 5000, maxBackoff: 60000 });
  window.FallenHeavenJobs.upsert('boost-progress-refresh', function () {
    if (!document.hidden && state.activeFeatureId === 'boostRoles') void refreshBoostProgress();
  }, 5000, { immediate: false, retryDelay: 5000, maxBackoff: 30000 });
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
    if (!force && emojiCatalog().length) return emojiCatalog();
    catalogPromise = (async () => {
      if (force) state.messageEmojis = [];
      await loadMessageEmojiCatalog();
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


