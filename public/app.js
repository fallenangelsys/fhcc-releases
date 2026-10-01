const state = {
  guilds: [],
  featureCards: [],
  config: null,
  selectedGuildId: null,
  activeFeatureId: null,
  activeView: 'overview',
  stats: null,
  memberRows: [],
  memberPage: 0,
  memberPageCount: 1,
  memberQuery: '',
  channels: [],
  selectedEmbedId: null,
  initialized: false,
  pollingActive: false
};

const authOverlay = document.getElementById('auth-overlay');
const appShell = document.getElementById('app-shell');
const discordLoginButton = document.getElementById('discord-login');
const loginError = document.getElementById('login-error');
const guildList = document.getElementById('guild-list');
const guildTitle = document.getElementById('guild-title');
const guildFilter = document.getElementById('guild-filter');
const featureGrid = document.getElementById('feature-grid');
const featureNav = document.getElementById('feature-nav');
const featureSearch = document.getElementById('feature-search');
const connectionStatus = document.getElementById('connection-status');
const saveAllButton = document.getElementById('save-all');
const exportButton = document.getElementById('export-json');
const refreshAllButton = document.getElementById('refresh-all');
const logoutButton = document.getElementById('logout');
const toast = document.getElementById('toast');
const botStatusBadge = document.getElementById('bot-status');
const botStartButton = document.getElementById('bot-start');
const botStopButton = document.getElementById('bot-stop');
const botRestartButton = document.getElementById('bot-restart');
const viewTabs = document.querySelectorAll('.view-tab');
const dashboardViews = document.querySelectorAll('.dashboard-view');
const statGrid = document.getElementById('stat-grid');
const channelChart = document.getElementById('channel-chart');
const moduleChart = document.getElementById('module-chart');
const assetChart = document.getElementById('asset-chart');
const embedList = document.getElementById('embed-list');
const embedForm = document.getElementById('embed-form');
const embedTitle = document.getElementById('embed-title');
const embedNewButton = document.getElementById('embed-new');
const embedDuplicateButton = document.getElementById('embed-duplicate');
const embedSaveButton = document.getElementById('embed-save');
const embedChannel = document.getElementById('embed-channel');
const embedMessageId = document.getElementById('embed-message-id');
const embedSendButton = document.getElementById('embed-send');
const embedEditButton = document.getElementById('embed-edit');
const discordPreview = document.getElementById('discord-preview');
const memberSearchInput = document.getElementById('member-search');
const memberSyncButton = document.getElementById('member-sync');
const membersTable = document.getElementById('members-table');
const membersPrevButton = document.getElementById('members-prev');
const membersNextButton = document.getElementById('members-next');
const membersPageInfo = document.getElementById('members-page-info');
const memberDrawer = document.getElementById('member-drawer');

let botStatusTimer = null;

const showToast = (text, type = 'info') => {
  toast.textContent = text;
  toast.className = `toast ${type}`;
  toast.classList.remove('hidden');
  window.clearTimeout(window.__toastTimer);
  window.__toastTimer = window.setTimeout(() => toast.classList.add('hidden'), 2600);
};

const api = async (path, options = {}) => {
  const init = {
    method: options.method || 'GET',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    }
  };

  if (options.body) {
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(`/api${path}`, init);
  if (response.status === 401) {
    throw new Error('Nicht angemeldet');
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data;
};

const pathToRef = (obj, keyPath) => {
  const parts = String(keyPath || '').split('.');
  return parts.reduce((cur, key) => (cur ? cur[key] : undefined), obj);
};

const setByPath = (obj, keyPath, value) => {
  const parts = String(keyPath || '').split('.');
  let current = obj;

  for (let i = 0; i < parts.length; i += 1) {
    const key = parts[i];
    if (i === parts.length - 1) {
      current[key] = value;
    } else {
      current[key] = current[key] && typeof current[key] === 'object' ? current[key] : {};
      current = current[key];
    }
  }
};

const escapeHtml = (value) => {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
};

const createId = (prefix = 'item') => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

const getEmbedTemplates = () => {
  state.config ||= {};
  state.config.embeds ||= { selectedTemplateId: '', templates: [] };
  state.config.embeds.templates ||= [];
  return state.config.embeds.templates;
};

const getSelectedEmbedTemplate = () => {
  const templates = getEmbedTemplates();
  if (!state.selectedEmbedId) {
    state.selectedEmbedId = state.config?.embeds?.selectedTemplateId || templates[0]?.id || null;
  }

  return templates.find((template) => template.id === state.selectedEmbedId) || templates[0] || null;
};

const ensureEmbedShape = (template) => {
  template.embed ||= {};
  template.embed.fields ||= [];
  template.channelId ||= '';
  template.messageId ||= '';
  template.content ||= '';
  template.name ||= 'Custom Embed';
  template.category ||= 'Custom';
  template.embed.color ||= '#27c4e8';
  return template;
};

const parseInputValue = (input, type) => {
  if (type === 'checkbox') {
    return Boolean(input.checked);
  }

  if (type === 'number') {
    return Number(input.value || 0);
  }

  if (type === 'arrayLines') {
    return String(input.value || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  if (type === 'json') {
    try {
      return JSON.parse(input.value || '[]');
    } catch {
      return [];
    }
  }

  return String(input.value || '');
};

const buildInputMarkup = (field, current) => {
  const placeholder = field.placeholder ? `placeholder="${escapeHtml(field.placeholder)}"` : '';
  const key = escapeHtml(field.key);
  const type = escapeHtml(field.type);

  if (field.type === 'checkbox') {
    return `<input class="toggle-input" type="checkbox" data-key="${key}" data-type="${type}" ${current ? 'checked' : ''} />`;
  }

  if (field.type === 'select') {
    const options = (field.options || [])
      .map((option) => `<option value="${escapeHtml(option.value)}" ${current === option.value ? 'selected' : ''}>${escapeHtml(option.label)}</option>`)
      .join('');
    return `<select data-key="${key}" data-type="${type}">${options}</select>`;
  }

  if (field.type === 'channelSelect') {
    const options = [
      `<option value="">${escapeHtml(field.placeholder || 'Kanal auswählen...')}</option>`,
      ...state.channels.map((channel) => `<option value="${escapeHtml(channel.id)}" ${current === channel.id ? 'selected' : ''}>${escapeHtml(`#${channel.name}`)}</option>`)
    ].join('');
    return `<select data-key="${key}" data-type="${type}">${options}</select>`;
  }

  if (field.type === 'json') {
    return `<textarea rows="7" data-key="${key}" data-type="${type}" spellcheck="false">${escapeHtml(JSON.stringify(current || [], null, 2))}</textarea>`;
  }

  if (field.type === 'arrayLines') {
    return `<textarea rows="6" data-key="${key}" data-type="${type}" ${placeholder} spellcheck="false">${escapeHtml(Array.isArray(current) ? current.join('\n') : '')}</textarea>`;
  }

  if (field.type === 'textarea') {
    const rows = Number.isFinite(Number(field.rows)) ? Number(field.rows) : 6;
    return `<textarea rows="${rows}" data-key="${key}" data-type="${type}" ${placeholder} spellcheck="false">${escapeHtml(current ?? '')}</textarea>`;
  }

  const min = Number.isFinite(Number(field.min)) ? `min="${field.min}"` : '';
  const step = Number.isFinite(Number(field.step)) ? `step="${field.step}"` : '';
  const inputType = field.type === 'number' ? 'number' : 'text';
  return `<input type="${inputType}" ${min} ${step} ${placeholder} data-key="${key}" data-type="${type}" value="${escapeHtml(current ?? '')}" />`;
};

const renderInfoIcon = (text) => {
  if (!text) {
    return '';
  }

  return `<span class="info-icon" tabindex="0" aria-label="${escapeHtml(text)}" data-tooltip="${escapeHtml(text)}">i</span>`;
};

const renderFieldLabel = (field) => {
  return `<span class="field-label-text">${escapeHtml(field.label)}${renderInfoIcon(field.info || field.hint)}</span>`;
};

const showAuthOverlay = (message) => {
  authOverlay.classList.remove('hidden');
  appShell.classList.add('hidden');
  loginError.classList.add('hidden');
  discordLoginButton.disabled = false;
  discordLoginButton.textContent = 'Mit Discord verbinden';
  if (message) {
    loginError.textContent = message;
    loginError.classList.remove('hidden');
  }
};

const showSetupOverlay = (message) => {
  showAuthOverlay(message);
  discordLoginButton.disabled = true;
  discordLoginButton.textContent = 'Discord OAuth fehlt';
};

const setSystemButtonsDisabled = (disabled) => {
  [botStartButton, botStopButton, botRestartButton].forEach((button) => {
    if (button) {
      button.disabled = Boolean(disabled);
    }
  });
};

const renderBotStatus = (payload = {}) => {
  if (!botStatusBadge) {
    return;
  }

  const hasRunningFlag = Object.prototype.hasOwnProperty.call(payload, 'running');
  const running = hasRunningFlag ? payload.running : null;
  const message = String(payload.message || '').trim();

  if (running === true) {
    botStatusBadge.textContent = 'Bot ist aktiv';
    botStatusBadge.className = 'status-tag online';
  } else if (running === false) {
    botStatusBadge.textContent = 'Bot ist inaktiv';
    botStatusBadge.className = 'status-tag offline';
  } else {
    botStatusBadge.textContent = 'Status unbekannt';
    botStatusBadge.className = 'status-tag warning';
  }

  botStatusBadge.title = message || botStatusBadge.textContent;
};

const stopBotStatusPolling = () => {
  if (botStatusTimer) {
    clearInterval(botStatusTimer);
    botStatusTimer = null;
  }
  state.pollingActive = false;
};

let botStatusRefreshPending = false;
const refreshBotStatus = async () => {
  if (botStatusRefreshPending) return null;
  botStatusRefreshPending = true;
  try {
    const response = await api('/system/status');
    renderBotStatus(response);
    return response;
  } finally {
    botStatusRefreshPending = false;
  }
};

const startBotStatusPolling = () => {
  if (state.pollingActive) {
    return;
  }

  state.pollingActive = true;
  botStatusTimer = window.setInterval(() => {
    if (document.hidden) return;
    void refreshBotStatus().catch(() => renderBotStatus({}));
  }, 10000);
};

const runBotAction = async (action, label) => {
  setSystemButtonsDisabled(true);
  try {
    const response = await api(`/system/${action}`, { method: 'POST' });
    renderBotStatus(response);
    showToast(response.message || label || 'Aktion ausgeführt', response.ok ? 'success' : 'error');

    if (action === 'restart') {
      botStatusBadge.textContent = 'Neustart läuft...';
      botStatusBadge.className = 'status-tag warning';
      window.setTimeout(() => {
        void refreshBotStatus().catch(() => renderBotStatus({ message: 'Dashboard startet noch neu.' }));
      }, 6500);
      return;
    }

    await refreshBotStatus();
  } catch (error) {
    const message = action === 'restart'
      ? 'Neustart läuft. Falls das Dashboard kurz weg ist, bitte 5 Sekunden warten.'
      : error.message || 'Aktion fehlgeschlagen';
    showToast(message, action === 'restart' ? 'success' : 'error');
  } finally {
    setSystemButtonsDisabled(false);
  }
};

const renderGuildList = () => {
  const filter = (guildFilter.value || '').trim().toLowerCase();
  const values = state.guilds.filter((guild) => String(guild.name).toLowerCase().includes(filter));

  guildList.innerHTML = '';
  values.forEach((guild) => {
    const isActive = guild.id === state.selectedGuildId;
    const item = document.createElement('li');
    item.className = `guild-item ${isActive ? 'active' : ''}`;
    item.innerHTML = `
      <button data-guild="${guild.id}" type="button">
        <span>${guild.name}</span>
        <small>${guild.memberCount || 0} Mitglieder</small>
      </button>
      <div class="meta">${guild.id}</div>
    `;

    item.querySelector('button').addEventListener('click', () => {
      void selectGuild(guild.id);
    });

    guildList.appendChild(item);
  });
};

const setActiveView = (view) => {
  state.activeView = view;
  viewTabs.forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.view === view);
  });
  dashboardViews.forEach((panel) => {
    panel.classList.toggle('active', panel.id === `${view}-view`);
  });
};

const renderStatGrid = (summary = {}) => {
  const cards = [
    { label: 'Mitglieder', value: summary.memberCount || 0, detail: `${summary.cachedBots || 0} Bots im Cache` },
    { label: 'Kanäle', value: summary.channelCount || 0, detail: `${summary.roleCount || 0} Rollen` },
    { label: 'Boosts', value: summary.boostCount || 0, detail: `Tier ${summary.premiumTier || 0}` },
    { label: 'Module', value: state.stats?.modules?.filter((entry) => entry.enabled).length || 0, detail: 'aktive Systeme' }
  ];

  statGrid.innerHTML = cards
    .map(
      (card) => `
        <article class="stat-card">
          <span>${escapeHtml(card.label)}</span>
          <strong>${escapeHtml(card.value)}</strong>
          <small>${escapeHtml(card.detail)}</small>
        </article>
      `
    )
    .join('');
};

const renderBarChart = (target, items = []) => {
  const max = Math.max(1, ...items.map((item) => Number(item.value || 0)));
  target.innerHTML = items
    .map((item) => {
      const percent = Math.max(4, Math.round((Number(item.value || 0) / max) * 100));
      return `
        <div class="bar-row">
          <span>${escapeHtml(item.label)}</span>
          <div class="bar-track"><i style="width: ${percent}%"></i></div>
          <strong>${escapeHtml(item.value || 0)}</strong>
        </div>
      `;
    })
    .join('');
};

const renderRingChart = (target, items = []) => {
  const active = Number(items.find((item) => item.label === 'Aktiv')?.value || 0);
  const total = Math.max(1, items.reduce((sum, item) => sum + Number(item.value || 0), 0));
  const degrees = Math.round((active / total) * 360);
  target.innerHTML = `
    <div class="ring" style="background: conic-gradient(var(--ok) ${degrees}deg, #263445 ${degrees}deg)">
      <span>${active}/${total}</span>
    </div>
    <div class="ring-legend">
      ${items.map((item) => `<span><i></i>${escapeHtml(item.label)}: ${escapeHtml(item.value || 0)}</span>`).join('')}
    </div>
  `;
};

const renderOverview = () => {
  const stats = state.stats || {};
  renderStatGrid(stats.summary || {});
  renderBarChart(channelChart, stats.charts?.channels || []);
  renderRingChart(moduleChart, stats.charts?.modules || []);
  renderBarChart(assetChart, stats.charts?.assets || []);
};

const loadStats = async (guildId) => {
  const response = await api(`/guild/${guildId}/stats`);
  state.stats = response.stats;
  renderOverview();
};

const loadChannels = async (guildId) => {
  const response = await api(`/guild/${guildId}/channels`);
  state.channels = response.channels || [];
};
const formatMemberDate = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
};

const loadDashboardMembers = async (options = {}) => {
  if (!state.selectedGuildId || !membersTable) return;
  const params = new URLSearchParams({
    page: String(state.memberPage || 0),
    pageSize: '40',
    query: state.memberQuery || ''
  });
  if (options.sync) params.set('sync', '1');
  membersTable.innerHTML = '<div class="members-loading">Nutzer werden geladen...</div>';
  const response = await api(`/guild/${state.selectedGuildId}/members?${params.toString()}`);
  state.memberRows = response.members || [];
  state.memberPage = response.page || 0;
  state.memberPageCount = response.pageCount || 1;
  renderMembersTable();
};

const renderMembersTable = () => {
  if (!membersTable) return;
  if (!state.memberRows.length) {
    membersTable.innerHTML = '<div class="members-empty">Keine Nutzer gefunden.</div>';
  } else {
    membersTable.innerHTML = state.memberRows.map((member) => `
      <article class="member-row">
        <div class="member-user-cell">
          <img src="${escapeHtml(member.avatar || '')}" alt="" />
          <div>
            <strong>${escapeHtml(member.displayName || member.username || member.id)}</strong>
            <small>${escapeHtml(member.username || member.handle || member.id)}</small>
          </div>
        </div>
        <div class="member-joined"><span>${escapeHtml(formatMemberDate(member.joinedAt))}</span></div>
        <div class="member-role"><span style="--role-color:${escapeHtml(member.role?.color || '#6f75ff')}">${escapeHtml(member.role?.name || 'Member')}</span></div>
        <button class="member-eye" type="button" data-member-id="${escapeHtml(member.id)}" aria-label="Details anzeigen">◎</button>
      </article>
    `).join('');
  }
  if (membersPageInfo) membersPageInfo.textContent = `Seite ${state.memberPage + 1}/${state.memberPageCount}`;
  if (membersPrevButton) membersPrevButton.disabled = state.memberPage <= 0;
  if (membersNextButton) membersNextButton.disabled = state.memberPage >= state.memberPageCount - 1;
  membersTable.querySelectorAll('[data-member-id]').forEach((button) => {
    button.addEventListener('click', () => void openMemberDrawer(button.dataset.memberId));
  });
};

const openMemberDrawer = async (userId) => {
  if (!memberDrawer || !state.selectedGuildId || !userId) return;
  memberDrawer.classList.remove('hidden');
  memberDrawer.innerHTML = '<div class="members-loading">Details werden geladen...</div>';
  const response = await api(`/guild/${state.selectedGuildId}/member/${encodeURIComponent(userId)}`);
  const member = response.member;
  memberDrawer.innerHTML = `
    <button class="member-drawer-close" type="button">x</button>
    <div class="member-drawer-head">
      <img src="${escapeHtml(member.avatar || '')}" alt="" />
      <div>
        <p class="eyebrow">Nutzerprofil</p>
        <h3>${escapeHtml(member.displayName || member.username || member.id)}</h3>
        <span>${escapeHtml(member.username || member.handle || member.id)}</span>
      </div>
    </div>
    <div class="member-detail-grid">
      <div><span>User-ID</span><strong>${escapeHtml(member.id)}</strong></div>
      <div><span>Mention</span><strong>${escapeHtml(member.mention || '')}</strong></div>
      <div><span>Beigetreten</span><strong>${escapeHtml(formatMemberDate(member.joinedAt))}</strong></div>
      <div><span>Account erstellt</span><strong>${escapeHtml(formatMemberDate(member.createdAt))}</strong></div>
      <div><span>Bot</span><strong>${member.isBot ? 'Ja' : 'Nein'}</strong></div>
      <div><span>H?chste Rolle</span><strong>${escapeHtml(member.role?.name || 'Member')}</strong></div>
    </div>
    <section class="member-roles-box">
      <h4>Rollen</h4>
      <div>${(member.roles || []).map((role) => `<span style="--role-color:${escapeHtml(role.color || '#6f75ff')}">${escapeHtml(role.name)}</span>`).join('') || '<small>Keine Rollen</small>'}</div>
    </section>
  `;
  memberDrawer.querySelector('.member-drawer-close')?.addEventListener('click', () => memberDrawer.classList.add('hidden'));
};
const collectFeaturePatch = (featureId) => {
  const panel = document.querySelector(`.feature-card[data-feature="${featureId}"]`);
  const fields = panel ? panel.querySelectorAll('[data-key]') : [];
  const patch = {};

  fields.forEach((field) => {
    const key = field.dataset.key;
    const type = field.dataset.type;
    const value = parseInputValue(field, type);
    setByPath(patch, key, value);
  });

  return patch;
};

const collectAllChanges = () => {
  return state.config ? JSON.parse(JSON.stringify(state.config)) : {};
};

const getVisibleFeatures = (featureCards, query = '') => {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  return featureCards.filter((feature) => {
    const fieldText = (feature.fields || []).map((field) => `${field.label || ''} ${field.info || ''}`).join(' ');
    const haystack = `${feature.title} ${feature.description} ${feature.detail || ''} ${feature.id} ${fieldText}`.toLowerCase();
    return !normalizedQuery || haystack.includes(normalizedQuery);
  });
};

const renderFeatureNav = (features, config) => {
  featureNav.innerHTML = '';

  features.forEach((feature) => {
    const enabledValue = pathToRef(config, `${feature.id}.enabled`);
    const isActive = feature.id === state.activeFeatureId;
    const button = document.createElement('button');
    button.className = `feature-nav-item ${isActive ? 'active' : ''}`;
    button.type = 'button';
    button.dataset.feature = feature.id;
    button.innerHTML = `
      <span class="feature-nav-icon">${escapeHtml(feature.icon || '*')}</span>
      <span class="feature-nav-copy">
        <strong>${escapeHtml(feature.title)}</strong>
        <small>${escapeHtml(feature.description)} ${renderInfoIcon(feature.detail || feature.description)}</small>
      </span>
      <span class="module-state ${enabledValue === false ? 'off' : 'on'}">${enabledValue === false ? 'Aus' : 'Aktiv'}</span>
    `;

    button.addEventListener('click', () => {
      state.activeFeatureId = feature.id;
      renderFeatureCards(state.featureCards, state.config, featureSearch.value);
    });

    featureNav.appendChild(button);
  });
};

const bindFieldState = () => {
  featureGrid.querySelectorAll('[data-key]').forEach((field) => {
    const updateLocalState = () => {
      if (!state.config) {
        return;
      }

      setByPath(state.config, field.dataset.key, parseInputValue(field, field.dataset.type));
    };

    field.addEventListener('input', updateLocalState);
    field.addEventListener('change', updateLocalState);
  });
};

const renderFeatureCards = (featureCards, config, query = '') => {
  const visibleFeatures = getVisibleFeatures(featureCards, query);
  if (!visibleFeatures.length) {
    state.activeFeatureId = null;
    renderFeatureNav([], config);
    featureGrid.innerHTML = '<div class="empty-state">Kein Modul gefunden.</div>';
    return;
  }

  const activeStillVisible = visibleFeatures.some((feature) => feature.id === state.activeFeatureId);

  if (!state.activeFeatureId || !activeStillVisible) {
    state.activeFeatureId = visibleFeatures[0].id;
  }

  renderFeatureNav(visibleFeatures, config);
  featureGrid.innerHTML = '';

  const feature = visibleFeatures.find((entry) => entry.id === state.activeFeatureId);
  if (!feature) {
    featureGrid.innerHTML = '<div class="empty-state">Kein Modul gefunden.</div>';
    return;
  }

  const fields = feature.fields || [];
  const hasEnable = pathToRef(config, `${feature.id}.enabled`) !== undefined;
  const enabled = pathToRef(config, `${feature.id}.enabled`) !== false;
  const card = document.createElement('article');
  card.className = 'feature-card';
  card.dataset.feature = feature.id;

  card.innerHTML = `
    <header class="feature-card-header">
      <div class="feature-heading">
        <span class="feature-icon">${escapeHtml(feature.icon || '*')}</span>
        <div>
          <h3>${escapeHtml(feature.title)}</h3>
          <p>${escapeHtml(feature.description)}</p>
        </div>
      </div>
      <div class="feature-actions">
        <span class="module-state ${enabled ? 'on' : 'off'}">${enabled ? 'Aktiv' : 'Aus'}</span>
        <button class="secondary-button" data-action="reset-feature" data-feature="${escapeHtml(feature.id)}" type="button">Zurücksetzen</button>
      </div>
    </header>
    <section class="module-explainer">
      <strong>Was macht dieses Modul?</strong>
      <p>${escapeHtml(feature.detail || feature.description)}</p>
    </section>
    ${
      hasEnable
        ? `<label class="field field-toggle">
            <span>
              <strong>Modul aktivieren</strong>
              <small>Steuert, ob dieses Modul auf dem Server arbeitet.</small>
            </span>
            <input class="toggle-input" type="checkbox" ${enabled ? 'checked' : ''} data-key="${escapeHtml(feature.id)}.enabled" data-type="checkbox" />
          </label>`
        : ''
    }
    <div class="fields"></div>
    <footer>
      <button type="button" data-action="save-feature" data-feature="${escapeHtml(feature.id)}">Speichern</button>
    </footer>
  `;

  const fieldContainer = card.querySelector('.fields');
  fields
    .filter((field) => field.key !== `${feature.id}.enabled`)
    .forEach((field) => {
      const fieldWrap = document.createElement('label');
      const current = pathToRef(config, field.key);
      const input = buildInputMarkup(field, current);

      fieldWrap.className = `field ${field.type === 'checkbox' ? 'field-toggle' : ''}`;
      fieldWrap.innerHTML = `${renderFieldLabel(field)}${input}`;

      if (field.hint) {
        const small = document.createElement('small');
        small.textContent = field.hint;
        fieldWrap.appendChild(small);
      }

      fieldContainer.appendChild(fieldWrap);
    });

  featureGrid.appendChild(card);
  bindFieldState();

  featureGrid.querySelectorAll('[data-action="save-feature"]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      const featureId = event.target.dataset.feature;
      const patch = collectFeaturePatch(featureId);
      await saveConfig(patch);
    });
  });

  featureGrid.querySelectorAll('[data-action="reset-feature"]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      const featureId = event.target.dataset.feature;
      if (!state.selectedGuildId) {
        return;
      }

      const response = await api(`/config/${state.selectedGuildId}/reset?feature=${encodeURIComponent(featureId)}`, {
        method: 'POST'
      });
      state.config = response.config;
      renderFeatureCards(state.featureCards, state.config, featureSearch.value);
      showToast('Modul auf Standardwerte gesetzt', 'success');
    });
  });
};

const formatPreviewText = (value) => {
  const guild = state.guilds.find((entry) => entry.id === state.selectedGuildId);
  return String(value || '')
    .replaceAll('{user}', '@User')
    .replaceAll('{username}', 'Username')
    .replaceAll('{guild}', guild?.name || 'Server')
    .replaceAll('{level}', '7')
    .replaceAll('{memberCount}', String(guild?.memberCount || 0))
    .replaceAll('{userAvatar}', '');
};

const renderEmbedList = () => {
  const templates = getEmbedTemplates();
  embedList.innerHTML = templates
    .map(
      (template) => `
        <button class="embed-list-item ${template.id === state.selectedEmbedId ? 'active' : ''}" data-embed-id="${escapeHtml(template.id)}" type="button">
          <span>
            <strong>${escapeHtml(template.name)}</strong>
            <small>${escapeHtml(template.category || 'Custom')}</small>
          </span>
          <i style="background:${escapeHtml(template.embed?.color || '#27c4e8')}"></i>
        </button>
      `
    )
    .join('');

  embedList.querySelectorAll('[data-embed-id]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedEmbedId = button.dataset.embedId;
      state.config.embeds.selectedTemplateId = state.selectedEmbedId;
      renderEmbedStudio();
    });
  });
};

const renderChannelOptions = (template) => {
  embedChannel.innerHTML = [
    '<option value="">Kanal auswählen...</option>',
    ...state.channels.map((channel) => `<option value="${escapeHtml(channel.id)}">${escapeHtml(`#${channel.name}`)}</option>`)
  ].join('');
  embedChannel.value = template?.channelId || '';
  embedMessageId.value = template?.messageId || '';
};

const renderEmbedForm = (template) => {
  const embed = template.embed || {};
  const fields = Array.isArray(embed.fields) ? embed.fields : [];
  embedTitle.textContent = template.name || 'Embed bearbeiten';
  embedForm.innerHTML = `
    <section class="embed-form-section">
      <h3>Template</h3>
      <label><span>Name</span><input data-template-key="name" value="${escapeHtml(template.name)}" /></label>
      <label><span>Kategorie</span><input data-template-key="category" value="${escapeHtml(template.category || 'Custom')}" /></label>
      <label class="wide"><span>Nachricht über dem Embed</span><textarea rows="3" data-template-key="content">${escapeHtml(template.content || '')}</textarea></label>
    </section>
    <section class="embed-form-section">
      <h3>Embed</h3>
      <label><span>Farbe</span><input type="color" data-template-key="embed.color" value="${escapeHtml(embed.color || '#27c4e8')}" /></label>
      <label><span>Titel</span><input data-template-key="embed.title" value="${escapeHtml(embed.title || '')}" /></label>
      <label class="wide"><span>Beschreibung</span><textarea rows="6" data-template-key="embed.description">${escapeHtml(embed.description || '')}</textarea></label>
      <label><span>Autor</span><input data-template-key="embed.authorName" value="${escapeHtml(embed.authorName || '')}" /></label>
      <label><span>Autor Icon URL</span><input data-template-key="embed.authorIconUrl" value="${escapeHtml(embed.authorIconUrl || '')}" /></label>
      <label><span>Thumbnail URL</span><input data-template-key="embed.thumbnailUrl" value="${escapeHtml(embed.thumbnailUrl || '')}" /></label>
      <label><span>Bild URL</span><input data-template-key="embed.imageUrl" value="${escapeHtml(embed.imageUrl || '')}" /></label>
      <label><span>Footer</span><input data-template-key="embed.footerText" value="${escapeHtml(embed.footerText || '')}" /></label>
      <label><span>Footer Icon URL</span><input data-template-key="embed.footerIconUrl" value="${escapeHtml(embed.footerIconUrl || '')}" /></label>
      <label class="field-toggle wide">
        <span><strong>Timestamp</strong><small>Zeitstempel im Embed anzeigen</small></span>
        <input class="toggle-input" type="checkbox" data-template-key="embed.timestamp" data-template-type="checkbox" ${embed.timestamp !== false ? 'checked' : ''} />
      </label>
    </section>
    <section class="embed-form-section wide">
      <div class="section-heading">
        <h3>Felder</h3>
        <button id="embed-add-field" class="secondary-button" type="button">Feld hinzufügen</button>
      </div>
      <div class="embed-fields">
        ${fields
          .map(
            (field, index) => `
              <article class="embed-field-row" data-field-index="${index}">
                <label><span>Name</span><input data-field-key="name" value="${escapeHtml(field.name || '')}" /></label>
                <label><span>Wert</span><textarea rows="3" data-field-key="value">${escapeHtml(field.value || '')}</textarea></label>
                <label class="mini-toggle"><input type="checkbox" data-field-key="inline" ${field.inline ? 'checked' : ''} /> Inline</label>
                <button class="secondary-button" data-remove-field="${index}" type="button">Entfernen</button>
              </article>
            `
          )
          .join('')}
      </div>
    </section>
  `;
};

const renderDiscordPreview = (template) => {
  const embed = template.embed || {};
  const fields = Array.isArray(embed.fields) ? embed.fields : [];
  discordPreview.innerHTML = `
    ${template.content ? `<div class="preview-content">${escapeHtml(formatPreviewText(template.content))}</div>` : ''}
    <div class="preview-message">
      <div class="preview-avatar">FH</div>
      <div class="preview-body">
        <div><strong>Fallen Heaven Bot</strong> <span>Heute um 21:37</span></div>
        <article class="preview-embed" style="border-left-color:${escapeHtml(embed.color || '#27c4e8')}">
          ${embed.authorName ? `<div class="preview-author">${escapeHtml(formatPreviewText(embed.authorName))}</div>` : ''}
          ${embed.title ? `<h3>${escapeHtml(formatPreviewText(embed.title))}</h3>` : ''}
          ${embed.description ? `<p>${escapeHtml(formatPreviewText(embed.description))}</p>` : ''}
          ${
            fields.length
              ? `<div class="preview-fields">${fields
                  .map((field) => `<div class="${field.inline ? 'inline' : ''}"><strong>${escapeHtml(formatPreviewText(field.name))}</strong><span>${escapeHtml(formatPreviewText(field.value))}</span></div>`)
                  .join('')}</div>`
              : ''
          }
          ${embed.imageUrl ? `<div class="preview-image">${escapeHtml(formatPreviewText(embed.imageUrl))}</div>` : ''}
          ${embed.footerText ? `<footer>${escapeHtml(formatPreviewText(embed.footerText))}</footer>` : ''}
        </article>
      </div>
    </div>
  `;
};

const syncEmbedFormToState = () => {
  const template = getSelectedEmbedTemplate();
  if (!template) {
    return null;
  }

  ensureEmbedShape(template);
  embedForm.querySelectorAll('[data-template-key]').forEach((input) => {
    const value = input.dataset.templateType === 'checkbox' ? input.checked : input.value;
    setByPath(template, input.dataset.templateKey, value);
  });

  template.channelId = embedChannel.value;
  template.messageId = embedMessageId.value.trim();
  state.config.embeds.selectedTemplateId = template.id;
  return template;
};

const bindEmbedForm = () => {
  embedForm.querySelectorAll('[data-template-key]').forEach((input) => {
    input.addEventListener('input', () => {
      const template = syncEmbedFormToState();
      renderDiscordPreview(template);
      renderEmbedList();
    });
    input.addEventListener('change', () => {
      const template = syncEmbedFormToState();
      renderDiscordPreview(template);
      renderEmbedList();
    });
  });

  embedForm.querySelectorAll('[data-field-key]').forEach((input) => {
    input.addEventListener('input', () => {
      const template = getSelectedEmbedTemplate();
      const row = input.closest('[data-field-index]');
      const index = Number(row?.dataset.fieldIndex || 0);
      const key = input.dataset.fieldKey;
      template.embed.fields[index][key] = key === 'inline' ? input.checked : input.value;
      renderDiscordPreview(template);
    });
    input.addEventListener('change', () => {
      const template = getSelectedEmbedTemplate();
      const row = input.closest('[data-field-index]');
      const index = Number(row?.dataset.fieldIndex || 0);
      const key = input.dataset.fieldKey;
      template.embed.fields[index][key] = key === 'inline' ? input.checked : input.value;
      renderDiscordPreview(template);
    });
  });

  embedForm.querySelector('#embed-add-field')?.addEventListener('click', () => {
    const template = getSelectedEmbedTemplate();
    ensureEmbedShape(template);
    template.embed.fields.push({ name: 'Neues Feld', value: 'Wert', inline: false });
    renderEmbedStudio();
  });

  embedForm.querySelectorAll('[data-remove-field]').forEach((button) => {
    button.addEventListener('click', () => {
      const template = getSelectedEmbedTemplate();
      template.embed.fields.splice(Number(button.dataset.removeField || 0), 1);
      renderEmbedStudio();
    });
  });

  embedChannel.addEventListener('change', () => {
    syncEmbedFormToState();
  });
  embedMessageId.addEventListener('input', () => {
    syncEmbedFormToState();
  });
};

const renderEmbedStudio = () => {
  const template = getSelectedEmbedTemplate();
  if (!template) {
    embedList.innerHTML = '<div class="empty-state">Noch keine Embeds gespeichert.</div>';
    embedForm.innerHTML = '';
    discordPreview.innerHTML = '';
    return;
  }

  ensureEmbedShape(template);
  renderEmbedList();
  renderChannelOptions(template);
  renderEmbedForm(template);
  renderDiscordPreview(template);
  bindEmbedForm();
};

const createEmbedTemplate = (base = null) => {
  const template = base
    ? JSON.parse(JSON.stringify(base))
    : {
        name: 'Neues Embed',
        category: 'Custom',
        channelId: '',
        messageId: '',
        content: '',
        enabled: true,
        embed: {
          title: 'Neues Embed',
          description: 'Beschreibung eintragen...',
          color: '#27c4e8',
          timestamp: true,
          fields: []
        }
      };

  template.id = createId('embed');
  template.name = base ? `${base.name} Kopie` : template.name;
  getEmbedTemplates().push(template);
  state.selectedEmbedId = template.id;
  state.config.embeds.selectedTemplateId = template.id;
  renderEmbedStudio();
};

const loadConfig = async (guildId) => {
  const [response] = await Promise.all([
    api(`/config/${guildId}`),
    loadStats(guildId).catch(() => {
      state.stats = null;
      renderOverview();
    }),
    loadChannels(guildId).catch(() => {
      state.channels = [];
    }),
    loadDashboardMembers().catch(() => {
      state.memberRows = [];
      renderMembersTable();
    })
  ]);
  state.config = response.config;
  state.selectedEmbedId = state.config?.embeds?.selectedTemplateId || state.config?.embeds?.templates?.[0]?.id || null;
  const guild = state.guilds.find((entry) => entry.id === guildId);
  guildTitle.textContent = `${guild?.name || guildId} - Konfiguration`;
  renderGuildList();
  renderFeatureCards(state.featureCards, state.config, featureSearch.value);
  renderEmbedStudio();
  connectionStatus.textContent = 'Verbunden';
  connectionStatus.className = 'status-tag online';
};

const loadSchema = async () => {
  const [guildData, schemaData] = await Promise.all([api('/guilds'), api('/dashboard/schema')]);

  state.guilds = guildData.guilds || [];
  state.featureCards = schemaData.featureCards || [];
};

const saveConfig = async (patch) => {
  if (!state.selectedGuildId) {
    return;
  }

  const response = await api(`/config/${state.selectedGuildId}`, {
    method: 'PUT',
    body: patch
  });

  state.config = response.config;
  renderFeatureCards(state.featureCards, state.config, featureSearch.value);
  await loadStats(state.selectedGuildId).catch(() => {});
  showToast('Konfiguration gespeichert', 'success');
};

const selectGuild = async (guildId) => {
  state.selectedGuildId = guildId;
  if (!guildId) {
    return;
  }

  await loadConfig(guildId);
};

const init = async () => {
  if (state.initialized) {
    return;
  }

  await loadSchema();
  renderGuildList();

  if (state.guilds.length === 0) {
    showAuthOverlay('Du bist in keinem Server mit Bot + ausreichenden Rechten unterwegs.');
    return;
  }

  await selectGuild(state.guilds[0].id);
  await refreshBotStatus().catch(() => renderBotStatus({}));
  startBotStatusPolling();

  authOverlay.classList.add('hidden');
  appShell.classList.remove('hidden');
  connectionStatus.textContent = 'Bereit';
  connectionStatus.className = 'status-tag online';
  state.initialized = true;
};

const bootstrap = async () => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('error')) {
    showAuthOverlay(`Login-Fehler: ${params.get('error')}`);
    window.history.replaceState({}, '', window.location.pathname);
    return;
  }

  try {
    await api('/auth/me');
    await init();
  } catch {
    const authStatus = await api('/auth/status').catch(() => null);
    if (authStatus && authStatus.oauthEnabled === false) {
      const missing = [];
      if (!authStatus.hasDiscordClientId) {
        missing.push('DISCORD_CLIENT_ID');
      }
      if (!authStatus.hasDiscordClientSecret) {
        missing.push('DISCORD_CLIENT_SECRET');
      }

      showSetupOverlay(`Discord OAuth ist noch nicht vollständig konfiguriert. Es fehlt: ${missing.join(', ') || 'OAuth-Konfiguration'}.`);
      return;
    }

    showAuthOverlay();
  }
};

bootstrap();

discordLoginButton.addEventListener('click', () => {
  window.location.href = '/api/auth/discord/login';
});

guildFilter.addEventListener('input', () => renderGuildList());

featureSearch.addEventListener('input', () => {
  renderFeatureCards(state.featureCards, state.config || {}, featureSearch.value);
});

saveAllButton.addEventListener('click', async () => {
  const patch = collectAllChanges();
  await saveConfig(patch);
});

exportButton.addEventListener('click', () => {
  if (!state.selectedGuildId || !state.config) {
    showToast('Kein Server ausgewählt', 'error');
    return;
  }

  const blob = new Blob([JSON.stringify(state.config, null, 2)], { type: 'application/json' });
  const anchor = document.createElement('a');
  const safeName = String(state.guilds.find((guild) => guild.id === state.selectedGuildId)?.name || 'server')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .toLowerCase();

  anchor.download = `discord-bot-${safeName}.json`;
  anchor.href = URL.createObjectURL(blob);
  anchor.click();
  showToast('Konfiguration exportiert', 'success');
});

refreshAllButton.addEventListener('click', async () => {
  if (!state.selectedGuildId) {
    return;
  }

  state.initialized = false;
  stopBotStatusPolling();
  await bootstrap();
  showToast('Daten neu geladen', 'success');
});

viewTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    setActiveView(tab.dataset.view || 'overview');
  });
});

embedForm.addEventListener('submit', (event) => {
  event.preventDefault();
});

const saveEmbeds = async (message = 'Embed-Templates gespeichert') => {
  syncEmbedFormToState();
  const response = await api(`/config/${state.selectedGuildId}`, {
    method: 'PUT',
    body: { embeds: state.config.embeds }
  });
  state.config = response.config;
  state.selectedEmbedId = state.config?.embeds?.selectedTemplateId || state.selectedEmbedId;
  renderEmbedStudio();
  showToast(message, 'success');
};

embedNewButton.addEventListener('click', () => {
  createEmbedTemplate();
});

embedDuplicateButton.addEventListener('click', () => {
  const template = getSelectedEmbedTemplate();
  if (template) {
    createEmbedTemplate(template);
  }
});

embedSaveButton.addEventListener('click', async () => {
  await saveEmbeds();
});

embedSendButton.addEventListener('click', async () => {
  const template = syncEmbedFormToState();
  if (!template?.channelId) {
    showToast('Bitte zuerst einen Kanal auswählen.', 'error');
    return;
  }

  const response = await api(`/guild/${state.selectedGuildId}/embed/send`, {
    method: 'POST',
    body: { template }
  });

  template.messageId = response.result?.messageId || template.messageId;
  await saveEmbeds('Embed gesendet und Message-ID gespeichert');
});

embedEditButton.addEventListener('click', async () => {
  const template = syncEmbedFormToState();
  if (!template?.channelId || !template?.messageId) {
    showToast('Zum Bearbeiten brauchst du Kanal und Message-ID.', 'error');
    return;
  }

  await api(`/guild/${state.selectedGuildId}/embed/edit`, {
    method: 'POST',
    body: { template }
  });
  await saveEmbeds('Discord-Nachricht wurde bearbeitet');
});

logoutButton.addEventListener('click', async () => {
  try {
    await api('/auth/logout', { method: 'POST' });
  } catch {
    // ignore
  }

  state.guilds = [];
  state.config = null;
  state.selectedGuildId = null;
  state.initialized = false;
  stopBotStatusPolling();
  renderBotStatus({});
  showAuthOverlay();
});

botStartButton.addEventListener('click', async () => {
  await runBotAction('start', 'Bot starten');
});

botStopButton.addEventListener('click', async () => {
  await runBotAction('stop', 'Bot stoppen');
});

botRestartButton.addEventListener('click', async () => {
  await runBotAction('restart', 'Bot neustarten');
});


memberSearchInput?.addEventListener('input', () => {
  state.memberQuery = memberSearchInput.value || '';
  state.memberPage = 0;
  window.clearTimeout(window.__memberSearchTimer);
  window.__memberSearchTimer = window.setTimeout(() => {
    void loadDashboardMembers().catch((error) => showToast(error.message || 'Nutzerliste konnte nicht geladen werden', 'error'));
  }, 250);
});

memberSyncButton?.addEventListener('click', async () => {
  await loadDashboardMembers({ sync: true });
  showToast('Nutzerliste synchronisiert', 'success');
});

membersPrevButton?.addEventListener('click', async () => {
  state.memberPage = Math.max(0, state.memberPage - 1);
  await loadDashboardMembers();
});

membersNextButton?.addEventListener('click', async () => {
  state.memberPage = Math.min(state.memberPageCount - 1, state.memberPage + 1);
  await loadDashboardMembers();
});

