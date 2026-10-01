(() => {
  'use strict';

  const ASSET_ICON = '/assets/fallen-heaven-icon.png';
  const ASSET_BG = '/assets/fallen-heaven-bg.png';

  const state = {
    mode: localStorage.getItem('fh.ui.mode') || 'home',
    guildId: localStorage.getItem('fh.ui.guild') || '',
    section: localStorage.getItem('fh.ui.section') || 'overview',
    collapsed: localStorage.getItem('fh.ui.collapsed') === '1',
    serverMenu: localStorage.getItem('fh.ui.serverMenu') === '1',
    theme: localStorage.getItem('fh:theme') || 'fallen',
    language: localStorage.getItem('fh:language') || 'de',
    authenticated: false,
    authChecked: false,
    authBusy: false,
    authError: '',
    authStatus: null,
    guilds: [],
    live: {},
    me: null,
    loaded: false,
    accessLoaded: false
  };

  const icons = {
    home: '<svg viewBox="0 0 24 24"><path d="M12 3 3 10v11h7v-6h4v6h7V10l-9-7Z"/></svg>',
    dashboard: '<svg viewBox="0 0 24 24"><path d="M4 5h7v7H4V5Zm9 0h7v4h-7V5ZM4 14h7v5H4v-5Zm9-3h7v8h-7v-8Z"/></svg>',
    globe: '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm7.7 9h-3.9a17.8 17.8 0 0 0-.9-4.9A8 8 0 0 1 19.7 11ZM12 4.1c.7 1 1.4 2.6 1.7 4.9h-3.4c.3-2.3 1-3.9 1.7-4.9ZM4.3 13h3.9c.1 1.8.4 3.5.9 4.9A8 8 0 0 1 4.3 13Zm3.9-2H4.3a8 8 0 0 1 4.8-4.9A17.8 17.8 0 0 0 8.2 11Zm3.8 8.9c-.7-1-1.4-2.6-1.7-4.9h3.4c-.3 2.3-1 3.9-1.7 4.9Zm2-6.9h-4v-2h4v2Zm.9 4.9c.5-1.4.8-3.1.9-4.9h3.9a8 8 0 0 1-4.8 4.9Z"/></svg>',
    modules: '<svg viewBox="0 0 24 24"><path d="M12 2 9.4 8.8 2 12l7.4 3.2L12 22l2.6-6.8L22 12l-7.4-3.2L12 2Z"/></svg>',
    embed: '<svg viewBox="0 0 24 24"><path d="M4 4h16v3H4V4Zm0 5h10v11H4V9Zm12 0h4v5h-4V9Zm0 7h4v4h-4v-4Z"/></svg>',
    users: '<svg viewBox="0 0 24 24"><path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-3.3 0-6 1.8-6 4v2h12v-2c0-2.2-2.7-4-6-4Zm8.5-1a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm0 2c-.6 0-1.2.1-1.7.2 1.3 1 2.2 2.2 2.2 3.8v1h4v-1.7c0-1.9-2-3.3-4.5-3.3Z"/></svg>',
    settings: '<svg viewBox="0 0 24 24"><path d="M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.5-2.4 1a8.3 8.3 0 0 0-2.6-1.5L14 2h-4l-.4 2.5A8.3 8.3 0 0 0 7 6L4.6 5l-2 3.5 2 1.5c-.1.5-.1 1-.1 1.5s0 1 .1 1.5l-2 1.5 2 3.5 2.4-1a8.3 8.3 0 0 0 2.6 1.5L10 22h4l.4-2.5A8.3 8.3 0 0 0 17 18l2.4 1 2-3.5-2-1.5ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z"/></svg>',
    system: '<svg viewBox="0 0 24 24"><path d="M4 19h16v2H4V3h2v16Zm4-2V9h3v8H8Zm5 0V5h3v12h-3Zm5 0v-6h3v6h-3Z"/></svg>',
    legal: '<svg viewBox="0 0 24 24"><path d="M6 3h9l3 3v15H6V3Zm8 2v3h3l-3-3ZM8 11h8v2H8v-2Zm0 4h8v2H8v-2Z"/></svg>',
    support: '<svg viewBox="0 0 24 24"><path d="M12 3a8 8 0 0 0-8 8v4a3 3 0 0 0 3 3h2v-7H6a6 6 0 0 1 12 0h-3v7h1.2A5.2 5.2 0 0 1 12 20v2a7.2 7.2 0 0 0 7.2-5H17v-2h1a2 2 0 0 0 2-2v-2a8 8 0 0 0-8-8Z"/></svg>'
  };

  const sections = [
    ['overview', 'Übersicht', 'dashboard'],
    ['modules', 'Module', 'modules'],
    ['embed', 'Embed Studio', 'embed'],
    ['users', 'Nutzerliste', 'users'],
    ['settings', 'Bot Settings', 'settings'],
    ['system', 'System', 'system']
  ];

  const esc = (value) => String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
  const cssEscape = (value) => window.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/"/g, '\\"');
  const fmt = (value) => Number(value || 0).toLocaleString('de-DE');
  const bytes = (value) => {
    const n = Number(value || 0);
    if (!n) return 'Live';
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    if (n < 1024 * 1024 * 1024) return `${Math.round(n / 1024 / 1024)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(1).replace('.', ',')} GB`;
  };

  const listFrom = (payload) => {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.guilds)) return payload.guilds;
    if (Array.isArray(payload?.allowedGuilds)) return payload.allowedGuilds;
    if (Array.isArray(payload?.data)) return payload.data;
    return [];
  };

  const guildId = (guild) => String(guild?.id || guild?.guildId || guild?.serverId || '');
  const guildName = (guild) => String(guild?.name || guild?.guildName || guild?.serverName || 'Unbekannter Server');
  const guildMembers = (guild) => Number(guild?.memberCount || guild?.members || guild?.approximateMemberCount || 0);
  const guildRole = (guild) => String(guild?.accessLabel || guild?.permissionLabel || guild?.role || (guild?.owner ? 'Owner' : 'Server verwalten'));

  const discordAvatarUrl = (user) => {
    const id = user?.id || user?.userId || user?.discordId;
    const avatar = user?.avatar || user?.avatarHash || user?.avatar_hash;
    if (user?.avatarUrl || user?.avatarURL) return user.avatarUrl || user.avatarURL;
    if (id && avatar) return `https://cdn.discordapp.com/avatars/${id}/${avatar}.${String(avatar).startsWith('a_') ? 'gif' : 'png'}?size=128`;
    return ASSET_ICON;
  };

  const guildIcon = (guild) => {
    const direct = guild?.iconUrl || guild?.iconURL || guild?.icon_url || guild?.avatarUrl || guild?.imageUrl || guild?.serverIcon || guild?.guildIcon;
    if (direct) return String(direct);
    const id = guildId(guild);
    const hash = guild?.icon || guild?.iconHash || guild?.icon_hash;
    if (id && hash && !String(hash).startsWith('http')) {
      return `https://cdn.discordapp.com/icons/${id}/${hash}.${String(hash).startsWith('a_') ? 'gif' : 'png'}?size=128`;
    }
    const existing = document.querySelector(`#guild-list [data-guild="${cssEscape(id)}"] img, [data-guild="${cssEscape(id)}"] img`);
    return existing?.src || ASSET_ICON;
  };

  const guildBanner = (guild) => String(guild?.bannerUrl || guild?.bannerURL || guild?.banner_url || guild?.splashUrl || guild?.imageUrl || ASSET_BG);

  const api = async (url) => {
    const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
    if (!response.ok) return null;
    return response.json().catch(() => null);
  };

  const selectedGuild = () => state.guilds.find((guild) => guildId(guild) === state.guildId) || null;

  const ensureShell = () => {
    let shell = document.getElementById('fh-reborn');
    if (shell) return shell;

    shell = document.createElement('div');
    shell.id = 'fh-reborn';
    shell.innerHTML = `
      <aside id="fh-side"></aside>
      <main id="fh-main"></main>
      <button id="fh-float" type="button" aria-label="Menü öffnen">${icons.dashboard}</button>
      <div id="fh-parking" hidden></div>
    `;
    document.body.appendChild(shell);

    Array.from(document.body.children).forEach((child) => {
      if (child.id === 'fh-reborn' || ['SCRIPT', 'STYLE', 'LINK'].includes(child.tagName)) return;
      child.classList.add('fh-legacy-root');
    });

    document.body.classList.add('fh-reborn-ready');
    document.body.dataset.theme = state.theme;
    document.body.dataset.language = state.language;
    return shell;
  };

  const originalGuildClick = (id) => {
    const node = document.querySelector(`#guild-list [data-guild="${cssEscape(id)}"]`);
    if (node) node.click();
  };

  const setMode = (mode) => {
    state.mode = mode;
    localStorage.setItem('fh.ui.mode', mode);
    render();
  };

  const selectGuild = (id) => {
    state.guildId = String(id);
    state.mode = 'dashboard';
    state.serverMenu = false;
    localStorage.setItem('fh.ui.guild', state.guildId);
    localStorage.setItem('fh.ui.mode', 'dashboard');
    localStorage.setItem('fh.ui.serverMenu', '0');
    originalGuildClick(state.guildId);
    render();
    setTimeout(() => {
      originalGuildClick(state.guildId);
      mountSection();
    }, 250);
  };

  const navButton = (key, label, icon, active, attrs = '') => `
    <button class="fh-nav ${active ? 'is-active' : ''}" type="button" ${attrs || `data-section="${esc(key)}"`}>
      <span>${icons[icon] || icons.modules}</span>
      <b>${esc(label)}</b>
    </button>
  `;

  const renderSide = () => {
    const side = document.getElementById('fh-side');
    const guild = selectedGuild();
    const serverList = state.guilds.map((item) => {
      const id = guildId(item);
      return `
        <button class="fh-server-mini ${id === state.guildId ? 'is-active' : ''}" type="button" data-guild="${esc(id)}">
          <img src="${esc(guildIcon(item))}" alt="">
          <span><strong>${esc(guildName(item))}</strong><small>${guildMembers(item) ? `${fmt(guildMembers(item))} Mitglieder` : esc(guildRole(item))}</small></span>
        </button>
      `;
    }).join('') || '<div class="fh-empty-mini">Keine Server gefunden</div>';

    const dashboardNav = guild ? `
      <button class="fh-current-server" type="button" data-home>
        <img src="${esc(guildIcon(guild))}" alt="">
        <span><strong>${esc(guildName(guild))}</strong><small>${esc(guildRole(guild))}</small></span>
      </button>
      ${navButton('home', 'Serverauswahl', 'home', false, 'data-home')}
      <div class="fh-nav-label">Dashboard</div>
      ${sections.map(([key, label, icon]) => navButton(key, label, icon, state.section === key)).join('')}
    ` : '';

    const homeNav = `
      ${navButton('home', 'Dashboard', 'dashboard', true, 'data-home')}
      ${navButton('servers', 'Server wählen', 'globe', state.serverMenu, 'data-toggle-servers')}
      <div class="fh-server-menu ${state.serverMenu ? 'is-open' : ''}">${serverList}</div>
    `;

    side.innerHTML = `
      <div class="fh-brand">
        <img src="${ASSET_ICON}" alt="">
        <span><strong>FALLEN HEAVEN</strong><small>Bot Control Center</small></span>
      </div>
      <nav class="fh-primary">${state.mode === 'dashboard' && guild ? dashboardNav : homeNav}</nav>
      <div class="fh-side-fill"></div>
      <nav class="fh-meta">
        ${navButton('impressum', 'Impressum', 'legal', false, 'data-info="impressum"')}
        ${navButton('privacy', 'Datenschutz', 'legal', false, 'data-info="privacy"')}
        ${navButton('support', 'Support Discord', 'support', false, 'data-info="support"')}
      </nav>
      <div class="fh-account">
        <img src="${esc(discordAvatarUrl(state.me))}" alt="">
        <span><strong>${esc(state.me?.username || 'Nicht angemeldet')}</strong><small>${esc(state.me?.id || 'Discord Login')}</small></span>
        <button class="fh-account-action" type="button" ${state.authenticated ? 'data-logout' : 'data-login'}>${state.authenticated ? 'Abmelden' : 'Anmelden'}</button>
      </div>
    `;
  };

  const statusCards = () => {
    const botOnline = state.live?.bot?.online !== false;
    const ping = state.live?.bot?.pingMs ?? state.live?.bot?.ping;
    return [
      ['Dashboard', 'Online', 'dashboard', 'ok'],
      ['Bot-Service', botOnline ? `Online${ping != null ? ` · ${ping} ms` : ''}` : 'Offline', 'support', botOnline ? 'ok' : 'bad'],
      ['Bot-Auslastung', `${bytes(state.live?.botProcess?.memoryBytes)} RAM${state.live?.botProcess?.cpuPercent != null ? ` · ${state.live.botProcess.cpuPercent}% CPU` : ''}`, 'system', 'info']
    ];
  };

  const updateLiveOnly = () => {
    for (const [title, value, icon, tone] of statusCards()) {
      document.querySelectorAll(`#fh-reborn .fh-status[data-status="${cssEscape(title)}"]`).forEach((card) => {
        card.className = `fh-status ${tone}`;
        const iconSlot = card.querySelector('span');
        const valueSlot = card.querySelector('small');
        if (iconSlot) iconSlot.innerHTML = icons[icon] || icons.system;
        if (valueSlot) valueSlot.textContent = value;
      });
    }
  };

  const renderTop = (title = '') => `
    <header class="fh-top">
      <button type="button" data-collapse>${icons.dashboard}</button>
      <div class="fh-breadcrumb">${title ? `<small>Dashboard</small><strong>${esc(title)}</strong>` : ''}</div>
      <div class="fh-user"><img src="${esc(discordAvatarUrl(state.me))}" alt=""><span><strong>${esc(state.me?.username || 'Nicht angemeldet')}</strong><small>${esc(state.me?.id || 'FALLEN HEAVEN')}</small></span></div>
    </header>
  `;

  const renderLogin = () => {
    parkMounted();
    const main = document.getElementById('fh-main');
    const oauthMissing = state.authStatus?.oauthEnabled === false;
    main.innerHTML = `
      <section class="fh-discord-login">
        <header class="fh-discord-nav">
          <a class="fh-discord-brand" href="#" aria-label="FALLEN HEAVEN Home">
            <img src="${ASSET_ICON}" alt="FALLEN HEAVEN">
            <strong>FALLEN HEAVEN</strong>
          </a>
          <nav class="fh-discord-links" aria-label="Login Navigation">
            <a class="fh-nav-link" href="#">Download</a>
            <a class="fh-nav-link" href="#">Nitro</a>
            <div class="fh-discord-menu" data-menu="discover">
              <button type="button" aria-haspopup="true">Entdecken</button>
              <div class="fh-nav-dropdown" role="menu">
                <section class="fh-nav-dd-col">
                  <strong class="fh-dd-title">Ressourcen</strong>
                  <a href="#" role="menuitem"><i>⌕</i><span><b>Server entdecken</b><small>Finde Communities, Events und neue Bereiche</small></span></a>
                  <a href="#" role="menuitem"><i>◇</i><span><b>Funktionen</b><small>Module, Embeds, Leveling und Automationen</small></span></a>
                  <a href="#" role="menuitem"><i>#</i><span><b>Community</b><small>Alles für aktive Server und Mitglieder</small></span></a>
                </section>
                <section class="fh-nav-dd-col">
                  <strong class="fh-dd-title">FALLEN HEAVEN</strong>
                  <a href="#" role="menuitem"><i>EM</i><span><b>Embed Studio</b><small>Nachrichten visuell bauen und speichern</small></span></a>
                  <a href="#" role="menuitem"><i>↗</i><span><b>Dashboard</b><small>Server professionell konfigurieren</small></span></a>
                </section>
                <img class="fh-dd-decor" src="https://cdn.prod.website-files.com/6257adef93867e50d84d30e2/6a1fdab6dacb93b00f5ec24d_Discord_Objects_Newspaper.webp" alt="">
              </div>
            </div>
            <div class="fh-discord-menu" data-menu="safety">
              <button type="button" aria-haspopup="true">Cybersicherheit</button>
              <div class="fh-nav-dropdown is-compact" role="menu">
                <section class="fh-nav-dd-col">
                  <strong class="fh-dd-title">Sicherheit</strong>
                  <a href="#" role="menuitem"><i>⌑</i><span><b>Anti-Raid</b><small>Schutz gegen Massenbeitritte und Spam</small></span></a>
                  <a href="#" role="menuitem"><i>⚑</i><span><b>Moderation</b><small>Filter, Warnungen und sichere Aktionen</small></span></a>
                </section>
                <section class="fh-nav-dd-col">
                  <strong class="fh-dd-title">Kontrolle</strong>
                  <a href="#" role="menuitem"><i>LOG</i><span><b>Audit-Logs</b><small>Nachrichten, Rollen und Serveränderungen</small></span></a>
                  <a href="#" role="menuitem"><i>🔒</i><span><b>Rechteprüfung</b><small>Nur Owner/Admin/Server-verwalten Zugriff</small></span></a>
                </section>
                <img class="fh-dd-decor" src="https://cdn.prod.website-files.com/6257adef93867e50d84d30e2/678a4c12dbf6be5d792aa920_Clyde%20Cube.webp" alt="">
              </div>
            </div>
            <div class="fh-discord-menu" data-menu="quests">
              <button type="button" aria-haspopup="true">Quests</button>
              <div class="fh-nav-dropdown" role="menu">
                <section class="fh-nav-dd-col">
                  <strong class="fh-dd-title">Aktivität</strong>
                  <a href="#" role="menuitem"><i>XP</i><span><b>Level Quests</b><small>Aktivität, Level und Belohnungen</small></span></a>
                  <a href="#" role="menuitem"><i>★</i><span><b>Community Ziele</b><small>Serverweite Aufgaben und Fortschritt</small></span></a>
                </section>
                <section class="fh-nav-dd-col">
                  <strong class="fh-dd-title">Belohnungen</strong>
                  <a href="#" role="menuitem"><i>🏆</i><span><b>Rewards</b><small>Rollen, Badges und Member-Anreize</small></span></a>
                  <a href="#" role="menuitem"><i>📊</i><span><b>Statistiken</b><small>Aktivität und Erfolg live verfolgen</small></span></a>
                </section>
                <img class="fh-dd-decor" src="https://cdn.prod.website-files.com/6257adef93867e50d84d30e2/678a4dee303240abdd278abf_Egg.webp" alt="">
              </div>
            </div>
            <div class="fh-discord-menu" data-menu="help">
              <button type="button" aria-haspopup="true">Hilfe</button>
              <div class="fh-nav-dropdown is-compact" role="menu">
                <section class="fh-nav-dd-col">
                  <strong class="fh-dd-title">Support</strong>
                  <a href="#" role="menuitem"><i>?</i><span><b>Support Center</b><small>Setup, Fehler und schnelle Hilfe</small></span></a>
                  <a href="#" role="menuitem"><i>BOT</i><span><b>Bot-Service</b><small>Starten, stoppen und neu starten</small></span></a>
                </section>
                <section class="fh-nav-dd-col">
                  <strong class="fh-dd-title">Hilfe</strong>
                  <a href="#" role="menuitem"><i>☰</i><span><b>Support Discord</b><small>Community und direkte Hilfe</small></span></a>
                </section>
                <img class="fh-dd-decor" src="https://cdn.prod.website-files.com/6257adef93867e50d84d30e2/678a4e92695af76b1f7487a3_Set%201%2015.webp" alt="">
              </div>
            </div>
            <div class="fh-discord-menu" data-menu="blog">
              <button type="button" aria-haspopup="true">Blog</button>
              <div class="fh-nav-dropdown is-blog" role="menu">
                <section class="fh-nav-dd-col">
                  <a href="#" role="menuitem"><i>#</i><span><b>Updates</b><small>Neue Funktionen und Changelog</small></span></a>
                  <a href="#" role="menuitem"><i>✦</i><span><b>Design Notes</b><small>Dashboard, UI und UX Verbesserungen</small></span></a>
                </section>
                <section class="fh-nav-dd-col">
                  <a href="#" role="menuitem"><i>⚙</i><span><b>Technik</b><small>Selfhosting und Performance</small></span></a>
                </section>
              </div>
            </div>
            <div class="fh-discord-menu" data-menu="dev">
              <button type="button" aria-haspopup="true">Entwickler</button>
              <div class="fh-nav-dropdown is-compact" role="menu">
                <section class="fh-nav-dd-col">
                  <a href="#" role="menuitem"><i>{}</i><span><b>API</b><small>Lokale Dashboard- und Bot-Endpunkte</small></span></a>
                  <a href="#" role="menuitem"><i>WS</i><span><b>Live Status</b><small>Ping, Dienste und Bot-Auslastung</small></span></a>
                </section>
                <section class="fh-nav-dd-col">
                  <a href="#" role="menuitem"><i>DB</i><span><b>Daten</b><small>Backups, Export und lokale Speicherung</small></span></a>
                  <a href="#" role="menuitem"><i>⚙</i><span><b>System</b><small>Selfhosting, EXE und Service Control</small></span></a>
                </section>
              </div>
            </div>
            <a class="fh-nav-link" href="#">Karriere</a>
          </nav>
          <div class="fh-discord-actions">
            <button class="fh-theme-toggle" type="button" data-theme-toggle aria-label="Hell-Dunkel-Modus wechseln">${state.theme === 'light' ? '☾' : '☀'}</button>
            <button class="fh-login-open" type="button" data-login ${oauthMissing || state.authBusy ? 'disabled' : ''}>${state.authBusy ? 'Verbinde...' : 'Einloggen'}</button>
          </div>
        </header>

        <main class="fh-discord-hero">
          <div class="fh-discord-copy">
            <span class="fh-eyebrow">FALLEN HEAVEN CONTROL CENTER</span>
            <h1>Dein Discord Bot. Dein Server. Alles an einem Ort.</h1>
            <p>Logge dich mit Discord ein und verwalte nur die Server, auf denen der Bot aktiv ist und du wirklich Berechtigungen hast.</p>
            <div class="fh-discord-cta-row">
              <button class="fh-discord-primary" type="button" data-login ${oauthMissing || state.authBusy ? 'disabled' : ''}>${state.authBusy ? 'Discord wird geöffnet...' : 'Mit Discord einloggen'}</button>
              <button class="fh-discord-secondary" type="button" data-theme-toggle>${state.theme === 'light' ? 'Dunkelmodus' : 'Hellmodus'}</button>
            </div>
            ${oauthMissing ? '<div class="fh-auth-warning">Discord OAuth fehlt. Bitte Client-ID und Secret in der .env eintragen.</div>' : ''}
            ${state.authError ? `<div class="fh-auth-warning">${esc(state.authError)}</div>` : ''}
          </div>

          <aside class="fh-discord-preview" aria-label="FALLEN HEAVEN Vorschau">
            <div class="fh-preview-top">
              <img src="${ASSET_ICON}" alt="">
              <div><strong>FALLEN HEAVEN</strong><small>Premium Dashboard</small></div>
              <span>Online</span>
            </div>
            <div class="fh-preview-chat">
              <div><b>Serverauswahl</b><small>Nur erlaubte Server</small></div>
              <div><b>Module</b><small>Moderation, Embeds, Leveling</small></div>
              <div><b>Live Status</b><small>Bot, Ping und Dienste</small></div>
            </div>
            <div class="fh-preview-console">
              <span></span><span></span><span></span>
              <p>OAuth bereit · Dashboard geschützt · Live-Konfiguration</p>
            </div>
          </aside>
        </main>

        <section class="fh-discord-scroll" aria-label="FALLEN HEAVEN Landing Bereiche">
          <article class="fh-landing-band is-wide">
            <div>
              <span>SERVER CONTROL</span>
              <h2>Ein Dashboard, das sich wie eine echte App anfühlt.</h2>
              <p>Server auswählen, Module öffnen, Embeds bauen und Bot-Service steuern, ohne zwischen Tools zu springen.</p>
            </div>
            <div class="fh-landing-mock">
              <b>FALLEN HEAVEN</b>
              <i></i><i></i><i></i>
            </div>
          </article>

          <article class="fh-landing-band split">
            <div>
              <span>MODULE</span>
              <h2>Moderation, Leveling, Tickets und Logging sauber getrennt.</h2>
              <p>Jedes Modul bekommt eine eigene Fläche, klare Erklärungen und Info-Hover statt zusammengequetschter Einstellungen.</p>
            </div>
            <div>
              <span>LEVELING</span>
              <h2>XP, Levelrollen und Belohnungen automatisiert.</h2>
              <p>Level-System, Rollen-Stufen und Belohnungen bleiben zentral einstellbar.</p>
            </div>
          </article>

          <article class="fh-landing-band is-dark">
            <div>
              <span>EMBED STUDIO</span>
              <h2>Nachrichten visuell bauen, speichern und später bearbeiten.</h2>
              <p>Templates, Vorschau, Farben, Felder, Bilder und Bot-Senden direkt aus dem Dashboard.</p>
            </div>
            <button type="button" data-login ${oauthMissing || state.authBusy ? 'disabled' : ''}>Dashboard öffnen</button>
          </article>

          <article class="fh-landing-showcase">
            <div class="fh-showcase-copy">
              <span>COMMUNITY SUITE</span>
              <h2>Alles bleibt an einem Ort.</h2>
              <p>FALLEN HEAVEN verbindet Serverauswahl, Bot-Service, Module und Speicherverwaltung in einer Oberfläche.</p>
            </div>
            <div class="fh-showcase-art">
              <img src="https://cdn.prod.website-files.com/6257adef93867e50d84d30e2/6841ca4c5468891aedebb224_homepage-hero-mobile-858x803.webp" alt="">
              <img src="https://cdn.prod.website-files.com/6257adef93867e50d84d30e2/683dd52d4c9254eada79dd11_Discord%20Boy.webp" alt="">
            </div>
          </article>

          <section class="fh-feature-cloud">
            <article><b>Moderation</b><span>Anti-Spam, Warnungen, Filter und Logs.</span></article>
            <article><b>Leveling</b><span>XP, Rollen und Belohnungen automatisiert.</span></article>
            <article><b>Embeds</b><span>Templates, Vorschau, Speichern und Senden.</span></article>
            <article><b>Selfhosting</b><span>Start, Stop, Neustart und Live-Status.</span></article>
          </section>

          <footer class="fh-landing-footer">
            <div><img src="${ASSET_ICON}" alt=""><strong>FALLEN HEAVEN</strong></div>
            <nav>
              <a href="#">Download</a>
              <a href="#">Hilfe</a>
              <a href="#">Entwickler</a>
              <a href="#">Datenschutz</a>
              <a href="#">Impressum</a>
            </nav>
          </footer>
        </section>

        <div class="fh-discord-orbit one"><img src="${ASSET_ICON}" alt=""></div>
        <div class="fh-discord-orbit two"></div>
        <div class="fh-discord-orbit three"></div>
        <div class="fh-discord-floaters" aria-hidden="true">
          <img class="fh-float-asset paper" src="https://cdn.prod.website-files.com/6257adef93867e50d84d30e2/6a1fdab6dacb93b00f5ec24d_Discord_Objects_Newspaper.webp" alt="">
          <img class="fh-float-asset egg" src="https://cdn.prod.website-files.com/6257adef93867e50d84d30e2/678a4dee303240abdd278abf_Egg.webp" alt="">
          <img class="fh-float-asset set" src="https://cdn.prod.website-files.com/6257adef93867e50d84d30e2/678a4e92695af76b1f7487a3_Set%201%2015.webp" alt="">
          <img class="fh-float-asset cube" src="https://cdn.prod.website-files.com/6257adef93867e50d84d30e2/678a4c12dbf6be5d792aa920_Clyde%20Cube.webp" alt="">
          <img class="fh-float-asset fly" src="https://cdn.prod.website-files.com/6257adef93867e50d84d30e2/678a4b31695af76b1f713594_Discord_Nelly_Pose2_Flying%201.webp" alt="">
        </div>
      </section>
    `;
  };
  const renderHome = () => {
    parkMounted();
    const main = document.getElementById('fh-main');
    const guildCards = state.guilds.map((guild) => {
      const id = guildId(guild);
      return `
        <button class="fh-guild-card" type="button" data-guild="${esc(id)}">
          <i style="background-image: linear-gradient(90deg, rgba(5,6,12,.82), rgba(5,6,12,.32)), url('${esc(guildBanner(guild))}')"></i>
          <em>+</em>
          <span><img src="${esc(guildIcon(guild))}" alt=""><b>${esc(guildName(guild))}</b><small>${guildMembers(guild) ? `${fmt(guildMembers(guild))} Mitglieder` : esc(guildRole(guild))}</small></span>
        </button>
      `;
    }).join('');

    main.innerHTML = `
      ${renderTop('')}
      <section class="fh-home-hero">
        <div><p>FALLEN HEAVEN CONTROL</p><h1>Server auswählen</h1><span>Nur Server, auf denen der Bot aktiv ist und dein Account Owner-, Admin- oder Server-verwalten-Rechte hat.</span></div>
      </section>
      <section class="fh-guild-grid">${guildCards || '<article class="fh-empty"><h2>Keine verwaltbaren Server</h2><p>Füge den Bot hinzu oder prüfe deine Discord-Rechte.</p></article>'}</section>
      <section class="fh-status-grid">${statusCards().map(([title, value, icon, tone]) => `<article class="fh-status ${tone}" data-status="${esc(title)}"><span>${icons[icon]}</span><div><strong>${esc(title)}</strong><small>${esc(value)}</small></div></article>`).join('')}</section>
    `;
  };

  const nativeTargets = {
    overview: ['#dashboard-view'],
    modules: ['#feature-grid', '#dashboard-view'],
    embed: ['#embed-form', '#embed-studio', '[data-view="embed"]'],
    users: ['#member-list', '#user-list', '#users-view'],
    settings: ['[data-feature="botProfile"]', '[data-feature="general"]', '#settings-view'],
    system: ['#system-view', '#bot-controls']
  };

  const activateNativeView = (section) => {
    const viewMap = {
      overview: 'overview',
      modules: 'modules',
      embed: 'embed',
      users: 'users',
      settings: 'modules',
      system: 'system'
    };
    const view = viewMap[section] || section;
    const selectors = [
      `#view-tabs [data-view="${view}"]`,
      `#view-tabs button[data-tab="${view}"]`,
      `#view-tabs button[data-target="${view}"]`,
      `[data-view-tab="${view}"]`,
      `[data-open-view="${view}"]`
    ];
    for (const selector of selectors) {
      const button = document.querySelector(selector);
      if (button && !button.closest('#fh-reborn')) {
        button.click();
        break;
      }
    }
  };

  const findNative = (section) => {
    for (const selector of nativeTargets[section] || []) {
      const node = document.querySelector(selector);
      if (node && !node.closest('#fh-reborn')) return node;
      if (node && node.closest('#fh-parking')) return node;
    }
    return null;
  };

  const parkMounted = () => {
    const parking = document.getElementById('fh-parking');
    document.querySelectorAll('#fh-mount > .fh-mounted').forEach((node) => parking.appendChild(node));
  };

  const mountSection = () => {
    const mount = document.getElementById('fh-mount');
    if (!mount) return;
    activateNativeView(state.section);
    parkMounted();

    const label = sections.find(([key]) => key === state.section)?.[1] || 'Übersicht';
    mount.innerHTML = `<div class="fh-section-title"><p>FALLEN HEAVEN</p><h2>${esc(label)}</h2></div>`;

    let node = findNative(state.section);
    if (state.section === 'modules') {
      node = document.querySelector('#feature-grid') || node;
    }
    if (node) {
      node.classList.add('fh-mounted');
      node.style.display = '';
      node.style.visibility = 'visible';
      node.style.opacity = '1';
      mount.appendChild(node);
    } else {
      mount.insertAdjacentHTML('beforeend', `<article class="fh-placeholder"><span>${icons[sections.find(([key]) => key === state.section)?.[2] || 'modules']}</span><h3>${esc(label)}</h3><p>Dieser Bereich ist vorbereitet. Sobald das Modul geladen ist, wird es hier automatisch eingebunden.</p></article>`);
    }
  };

  const renderDashboard = () => {
    parkMounted();
    const guild = selectedGuild();
    if (!guild) {
      state.mode = 'home';
      renderHome();
      return;
    }

    const main = document.getElementById('fh-main');
    main.innerHTML = `
      ${renderTop(guildName(guild))}
      <section class="fh-server-head">
        <img src="${esc(guildIcon(guild))}" alt="">
        <div><h1>${esc(guildName(guild))}</h1><p>${guildMembers(guild) ? `${fmt(guildMembers(guild))} Mitglieder` : 'Live-Konfiguration'} · ${esc(guildRole(guild))}</p></div>
      </section>
      <section class="fh-status-grid compact">${statusCards().map(([title, value, icon, tone]) => `<article class="fh-status ${tone}" data-status="${esc(title)}"><span>${icons[icon]}</span><div><strong>${esc(title)}</strong><small>${esc(value)}</small></div></article>`).join('')}</section>
      <section id="fh-mount" class="fh-mount"></section>
    `;
    setTimeout(mountSection, 50);
  };

  const render = () => {
    ensureShell();
    document.body.classList.toggle('fh-collapsed', state.collapsed);
    document.body.classList.toggle('fh-login-mode', !state.authChecked || !state.authenticated);
    if (!state.authChecked || !state.authenticated) renderLogin();
    else {
      renderSide();
      if (state.mode === 'dashboard') renderDashboard();
      else renderHome();
    }
  };

  const loadLive = async () => {
    const livePayload = await api('/api/live-status').catch(() => null);
    state.live = livePayload || state.live || {};
    if (state.authenticated) updateLiveOnly();
  };

  const load = async (forceAccess = false) => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('error')) {
      state.authError = `Login-Fehler: ${params.get('error')}`;
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    state.authBusy = !state.authChecked;
    render();

    const needsAccess = forceAccess || !state.authChecked || !state.accessLoaded;
    const [authStatus, mePayload, livePayload] = needsAccess
      ? await Promise.all([
          api('/api/auth/status').catch(() => null),
          api('/api/auth/me').catch(() => null),
          api('/api/live-status').catch(() => null)
        ])
      : [state.authStatus, state.me, await api('/api/live-status').catch(() => null)];

    if (needsAccess) {
      state.authStatus = authStatus;
      state.authenticated = Boolean(mePayload);
      state.authChecked = true;
      state.me = mePayload?.user || mePayload || null;
    }
    state.authBusy = false;
    state.live = livePayload || state.live || {};

    if (needsAccess) {
      const guildPayload = state.authenticated ? await api('/api/guilds').catch(() => null) : null;
      state.guilds = state.authenticated ? listFrom(guildPayload).filter((guild) => guildId(guild)) : [];
      state.accessLoaded = true;
    }
    state.loaded = true;

    if (state.guildId && !state.guilds.some((guild) => guildId(guild) === state.guildId)) {
      state.guildId = '';
      state.mode = 'home';
      localStorage.removeItem('fh.ui.guild');
      localStorage.setItem('fh.ui.mode', 'home');
    }

    render();
  };

  const infoPages = {
    impressum: ['Impressum', 'Offizielle Angaben zum Betreiber des FALLEN HEAVEN Bot Control Centers.', [['Projekt', 'FALLEN HEAVEN Discord Bot'], ['Betreiber', 'Noch nicht hinterlegt'], ['Adresse', 'Noch nicht hinterlegt'], ['Kontakt', 'Noch nicht hinterlegt']]],
    privacy: ['Datenschutzerklärung', 'Übersicht, welche Daten Dashboard und Bot lokal verarbeiten.', [['Discord Login', 'Discord-ID, Name, Avatar und Serverliste'], ['Serverdaten', 'Name, ID, Icon, Rollen, Kanäle und Statistiken'], ['Speicherort', 'Self-hosted auf diesem PC']]],
    support: ['Support Discord', 'Support- und Diagnosebereich für Bot, Dashboard und Rechte.', [['Support-Link', 'Noch nicht hinterlegt'], ['Dashboard lädt nicht', 'Bot-Service starten und Strg + F5 drücken']]]
  };

  const openInfo = (key) => {
    const page = infoPages[key];
    if (!page) return;
    let modal = document.getElementById('fh-info-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'fh-info-modal';
      document.body.appendChild(modal);
    }
    modal.innerHTML = `
      <button class="fh-info-backdrop" type="button" data-close-info></button>
      <section class="fh-info-panel">
        <button class="fh-info-close" type="button" data-close-info>Schließen</button>
        <header><p>FALLEN HEAVEN</p><h1>${esc(page[0])}</h1><span>${esc(page[1])}</span></header>
        <div>${page[2].map(([label, value]) => `<article><small>${esc(label)}</small><strong>${esc(value)}</strong></article>`).join('')}</div>
      </section>
    `;
    modal.classList.add('is-open');
  };

  document.addEventListener('click', (event) => {
    if (event.target.closest?.('[data-theme-toggle]')) {
      event.preventDefault();
      event.stopPropagation();
      state.theme = state.theme === 'light' ? 'fallen' : 'light';
      localStorage.setItem('fh:theme', state.theme);
      document.body.dataset.theme = state.theme;
      render();
      return;
    }

    if (event.target.closest?.('#fh-mount .fh-mounted')) {
      return;
    }

    const guildButton = event.target.closest?.('[data-guild]');
    if (guildButton) {
      event.preventDefault();
      event.stopPropagation();
      selectGuild(guildButton.getAttribute('data-guild'));
      return;
    }

    if (event.target.closest?.('[data-home]')) {
      event.preventDefault();
      event.stopPropagation();
      state.mode = 'home';
      state.guildId = '';
      localStorage.setItem('fh.ui.mode', 'home');
      localStorage.removeItem('fh.ui.guild');
      render();
      return;
    }

    if (event.target.closest?.('[data-toggle-servers]')) {
      event.preventDefault();
      event.stopPropagation();
      state.serverMenu = !state.serverMenu;
      localStorage.setItem('fh.ui.serverMenu', state.serverMenu ? '1' : '0');
      renderSide();
      return;
    }

    const sectionButton = event.target.closest?.('[data-section]');
    if (sectionButton) {
      event.preventDefault();
      event.stopPropagation();
      state.section = sectionButton.getAttribute('data-section');
      localStorage.setItem('fh.ui.section', state.section);
      renderSide();
      mountSection();
      return;
    }

    if (event.target.closest?.('[data-collapse], #fh-float')) {
      event.preventDefault();
      state.collapsed = !state.collapsed;
      localStorage.setItem('fh.ui.collapsed', state.collapsed ? '1' : '0');
      render();
      return;
    }

    if (event.target.closest?.('[data-login]')) {
      event.preventDefault();
      state.authBusy = true;
      state.authError = '';
      render();
      window.location.assign('/api/auth/discord/login');
      return;
    }

    if (event.target.closest?.('[data-logout]')) {
      event.preventDefault();
      state.authBusy = true;
      render();
      fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).finally(async () => {
        state.authenticated = false;
        state.authChecked = false;
        state.authBusy = false;
        state.me = null;
        state.guilds = [];
        state.guildId = '';
        state.mode = 'home';
        localStorage.removeItem('fh.ui.guild');
        localStorage.setItem('fh.ui.mode', 'home');
        render();
        state.accessLoaded = false;
        await load(true);
      });
      return;
    }

    if (event.target.closest?.('[data-theme-toggle]')) {
      event.preventDefault();
      state.theme = state.theme === 'light' ? 'fallen' : 'light';
      localStorage.setItem('fh:theme', state.theme);
      document.body.dataset.theme = state.theme;
      render();
      return;
    }

    const info = event.target.closest?.('[data-info]');
    if (info) {
      event.preventDefault();
      event.stopPropagation();
      openInfo(info.getAttribute('data-info'));
      return;
    }

    if (event.target.closest?.('[data-close-info]')) {
      document.getElementById('fh-info-modal')?.classList.remove('is-open');
    }
  }, true);

  let liveLoadPending = false;
  const refreshLiveSafely = async () => {
    if (document.hidden || liveLoadPending) return;
    liveLoadPending = true;
    try {
      await loadLive();
    } finally {
      liveLoadPending = false;
    }
  };

  const boot = () => {
    render();
    load(true);
    setInterval(refreshLiveSafely, 15000);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();

