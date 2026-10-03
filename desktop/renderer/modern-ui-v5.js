(() => {
  'use strict';

  const icon = (content) => `<svg viewBox="0 0 24 24" aria-hidden="true">${content}</svg>`;
  const icons = {
    arrow: icon('<path d="M5 12h14M14 7l5 5-5 5"></path>'),
    bot: icon('<rect x="4" y="6" width="16" height="13" rx="4"></rect><path d="M12 3v3M8.5 11h.01M15.5 11h.01M8 15h8"></path>'),
    people: icon('<path d="M16 20v-1.5a4.5 4.5 0 0 0-4.5-4.5h-3A4.5 4.5 0 0 0 4 18.5V20"></path><circle cx="10" cy="8" r="4"></circle><path d="M17 9a3 3 0 0 1 0 6M18 15.5a4 4 0 0 1 2 3.5v1"></path>'),
    shield: icon('<path d="M12 3 5 6v5c0 4.6 2.8 8 7 10 4.2-2 7-5.4 7-10V6l-7-3Z"></path><path d="m9 12 2 2 4-5"></path>'),
    compose: icon('<rect x="4" y="4" width="16" height="16" rx="3"></rect><path d="M8 9h8M8 13h5M16 16l4-4"></path>'),
    pulse: icon('<path d="M3 12h4l2.2-5 4.1 10 2.3-5H21"></path>'),
    search: icon('<circle cx="11" cy="11" r="6"></circle><path d="m16 16 4 4"></path>'),
    lock: icon('<rect x="5" y="10" width="14" height="10" rx="3"></rect><path d="M8 10V8a4 4 0 0 1 8 0v2"></path>'),
    spark: icon('<path d="m12 3 1.4 4.6L18 9l-4.6 1.4L12 15l-1.4-4.6L6 9l4.6-1.4L12 3Z"></path><path d="m18.5 14 .8 2.7 2.7.8-2.7.8-.8 2.7-.8-2.7-2.7-.8 2.7-.8.8-2.7Z"></path>'),
  };

  const discordMark = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 5.3A17 17 0 0 0 15.6 4l-.5 1.1a14 14 0 0 0-6.2 0L8.4 4a17 17 0 0 0-3.9 1.3C2 9 1.3 12.6 1.6 16.1A16 16 0 0 0 6.4 18l1.2-1.6a11 11 0 0 1-1.9-.9l.5-.4c3.7 1.7 7.9 1.7 11.6 0l.5.4a11 11 0 0 1-1.9.9l1.2 1.6a16 16 0 0 0 4.8-1.9c.4-4.1-.7-7.7-2.9-10.8ZM8.8 14.1c-1.1 0-2-1-2-2.2s.9-2.2 2-2.2 2 1 2 2.2-.9 2.2-2 2.2Zm6.4 0c-1.1 0-2-1-2-2.2s.9-2.2 2-2.2 2 1 2 2.2-.9 2.2-2 2.2Z"></path></svg>`;

  const access = document.getElementById('access-scene');
  if (access) {
    access.innerHTML = `
      <div class="discord-login-ambient" aria-hidden="true"><i></i><i></i><i></i><span></span></div>
      <section class="discord-login-world">
        <header class="discord-login-brand">
          <div><img src="assets/fallen-heaven-icon.png" alt=""><span><b>FALLEN HEAVEN</b><small>CONTROL CENTER</small></span></div>
          <p><i></i> Discord Operations Suite</p>
        </header>

        <div class="discord-login-intro">
          <span class="discord-login-kicker">Deine Community. Ein Control Center.</span>
          <h1>Discord verwalten.<br><em>Ohne Grenzen.</em></h1>
          <p>Bot, Mitglieder, Rollen, Sicherheit und Content – live verbunden in einer einzigen leistungsstarken Desktop-App.</p>
          <div class="discord-feature-pills"><span>${icons.bot} Bot Control</span><span>${icons.people} Community</span><span>${icons.shield} Security</span><span>${icons.compose} Content Studio</span></div>
        </div>

        <div class="discord-workspace" aria-hidden="true">
          <nav class="discord-guild-rail">
            <span class="discord-rail-home">${discordMark}</span><i></i>
            <span class="discord-guild active"><img src="assets/fallen-heaven-icon.png" alt=""></span>
            <span class="discord-guild purple">FH</span><span class="discord-guild blue">XP</span><span class="discord-guild mint">+</span>
          </nav>
          <aside class="discord-channel-panel">
            <header><div><b>FALLEN HEAVEN</b><small>COMMUNITY SERVER</small></div><span>⌄</span></header>
            <section><small>CONTROL CENTER <b>＋</b></small><p class="active"><b>#</b> overview <i>3</i></p><p><b>#</b> bot-status</p><p><b>#</b> server-events</p></section>
            <section><small>COMMUNITY <b>＋</b></small><p><b>#</b> welcome</p><p><b>#</b> general <i>12</i></p><p><b>#</b> creations</p></section>
            <section class="discord-voice"><small>VOICE CHANNELS <b>＋</b></small><p><b>◖</b> Community Lounge</p><div><span class="mini-avatar violet">N</span><span class="mini-avatar coral">M</span><span class="mini-avatar cyan">A</span><i>+8</i></div></section>
            <footer><span class="mini-avatar bot">FH</span><div><b>Fallen Heaven</b><small><i></i> System online</small></div><span>•••</span></footer>
          </aside>
          <main class="discord-chat-panel">
            <header><div><strong>#</strong><b>overview</b><span>Server operations & live activity</span></div><p><i></i> LIVE</p></header>
            <div class="discord-chat-feed">
              <div class="discord-date"><span>HEUTE</span></div>
              <article class="discord-system-message"><span class="discord-message-avatar">${discordMark}</span><div><header><b>FALLEN HEAVEN</b><em>APP</em><small>Heute um 23:42</small></header><p>Dein Server ist vollständig synchronisiert. Alle Systeme reagieren normal.</p></div></article>
              <section class="discord-operation-card">
                <header><span><i></i> LIVE OPERATIONS</span><small>GERADE EBEN</small></header>
                <div class="discord-operation-head"><span class="operation-icon">${icons.bot}</span><div><small>BOT SERVICE</small><b>Verbunden & einsatzbereit</b></div><strong>99.9%</strong></div>
                <div class="discord-stat-row"><span><small>COMMUNITY</small><b>2.841</b><em>Mitglieder</em></span><span><small>MODULE</small><b>12</b><em>aktiv</em></span><span><small>JOBS</small><b>28</b><em>heute</em></span></div>
                <footer><span><i></i> Discord Gateway verbunden</span><button type="button">Details ${icons.arrow}</button></footer>
              </section>
              <article class="discord-system-message user"><span class="mini-avatar violet">N</span><div><header><b>Nexora</b><small>Heute um 23:44</small></header><p>Die neue Boost-Rolle wurde automatisch vergeben.</p><div class="discord-reaction">✨ <b>8</b></div></div></article>
            </div>
            <div class="discord-composer"><span>＋</span><p>Nachricht an #overview</p><div>GIF</div><b>☺</b></div>
          </main>
        </div>

        <div class="discord-floating-voice" aria-hidden="true"><span>${icons.pulse}</span><div><small>VOICE ACTIVITY</small><b>Community Lounge</b><em><i></i> 11 verbunden</em></div><div class="voice-bars"><i></i><i></i><i></i><i></i></div></div>
        <div class="discord-floating-shield" aria-hidden="true">${icons.shield}<span><small>SECURITY</small><b>Alles geschützt</b></span></div>
      </section>

      <aside class="access-panel modern-access-panel">
        <div class="modern-login-window">
          <div class="modern-login-logo"><span>${discordMark}</span><i></i></div>
          <div class="modern-login-copy">
            <span class="discord-login-kicker">Willkommen zurück</span>
            <h2 id="access-title">Bereit für deinen Server?</h2>
            <p id="access-copy">Verbinde deinen Discord-Account und öffne direkt dein persönliches Control Center.</p>
          </div>
          <button id="login-portal-action" class="modern-discord-login" type="button" data-login="true">
            <span class="discord-mark" aria-hidden="true">${discordMark}</span>
            <span><b>Mit Discord anmelden</b><small>Sicher über Discord OAuth2</small></span>${icons.arrow}
          </button>
          <div class="modern-session"><span><i></i><b id="login-session-status">Gespeicherte Sitzung wird geprüft</b></span><small>Beim Start wird die Sitzung erst mit Discord-Daten bestätigt.</small></div>
          <div class="modern-login-divider"><span>Sicher & privat</span></div>
          <div class="modern-login-assurance"><span>${icons.shield}<b>Nur berechtigte Server</b></span><span>${icons.lock}<b>Systemgeschützte Sitzung</b></span></div>
          <p class="modern-privacy">FALLEN HEAVEN sieht niemals dein Discord-Passwort.</p>
        </div>
        <footer class="discord-login-footer"><span><i></i> Systeme erreichbar</span><span>Native Desktop-App</span><span id="modern-login-version">Version wird geprüft</span></footer>
      </aside>`;
  }

  document.querySelector('.public-nav')?.remove();
  const home = document.getElementById('home-view');
  if (home) {
    const nextView = document.getElementById('center-view');
    nextView?.classList.add('active');
    home.remove();
  }

  const appNav = document.querySelector('.app-nav');
  const appLinks = appNav?.querySelector('.app-links');
  if (appNav && appLinks) {
    const label = document.createElement('span');
    label.className = 'modern-nav-label';
    label.textContent = 'Arbeitsbereich';
    appLinks.prepend(label);

    const recent = document.createElement('section');
    recent.className = 'modern-recent';
    recent.innerHTML = `<header><span>Zuletzt geöffnet</span><small>Automatisch</small></header><div></div>`;
    appNav.insertBefore(recent, appNav.querySelector('.app-account'));

    const names = { center: 'Übersicht', community: 'Serververwaltung', modules: 'Module', studio: 'Embed Studio', skin: 'Skin Studio', system: 'System' };
    const recentHost = recent.querySelector('div');
    const readRecent = () => {
      try { return JSON.parse(localStorage.getItem('fh-recent-views') || '[]').filter((key) => names[key]).slice(0, 3); } catch { return []; }
    };
    const renderRecent = (items) => {
      recentHost.innerHTML = items.length ? items.map((key) => `<button type="button" data-recent-view="${key}"><span>${names[key]}</span>${icons.arrow}</button>`).join('') : '<p>Noch keine Bereiche geöffnet.</p>';
    };
    renderRecent(readRecent());
    recent.addEventListener('click', (event) => {
      const button = event.target.closest('[data-recent-view]');
      if (!button) return;
      appLinks.querySelector(`[data-view="${button.dataset.recentView}"]`)?.click();
    });
    document.addEventListener('fh:view-change', (event) => {
      const view = event.detail?.view;
      if (!names[view] || view === 'center') return;
      const items = [view, ...readRecent().filter((entry) => entry !== view)].slice(0, 3);
      localStorage.setItem('fh-recent-views', JSON.stringify(items));
      renderRecent(items);
    });

    const shortcutViews = ['center', 'community', 'modules', 'studio', 'skin', 'system'];
    appLinks.querySelectorAll('[data-view]').forEach((button) => {
      const position = shortcutViews.indexOf(button.dataset.view);
      if (position >= 0) button.title = `${button.textContent.trim()} · Alt+${position + 1}`;
    });
    document.addEventListener('keydown', (event) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const index = Number(event.key) - 1;
      if (!Number.isInteger(index) || index < 0 || index >= shortcutViews.length) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) return;
      event.preventDefault();
      appLinks.querySelector(`[data-view="${shortcutViews[index]}"]`)?.click();
    });
  }

  // Read-only visual QA route used by the local screenshot checks. It has no
  // effect in the packaged application because the app starts without a query.
  const previewView = new URLSearchParams(location.search).get('preview');
  if (previewView) {
    const applyPreviewView = () => {
      const isLogin = previewView === 'login';
      document.body.classList.remove('auth-restoring', 'auth-busy', 'authenticated', 'public-home');
      document.body.classList.add('auth-ready');
      document.body.classList.toggle('authenticated', !isLogin);
      document.body.classList.toggle('access-open', isLogin);
      document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active', view.id === `${isLogin ? 'center' : previewView}-view`));
      document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === previewView));
    };
    window.setTimeout(applyPreviewView, 0);
    window.setTimeout(applyPreviewView, 180);
  }

  document.documentElement.dataset.visualSystem = 'discord-v6';
})();
