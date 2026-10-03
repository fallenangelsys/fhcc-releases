(() => {
  'use strict';

  const icon = (content) => `<svg viewBox="0 0 24 24" aria-hidden="true">${content}</svg>`;
  const discordMark = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 5.3A17 17 0 0 0 15.6 4l-.5 1.1a14 14 0 0 0-6.2 0L8.4 4a17 17 0 0 0-3.9 1.3C2 9 1.3 12.6 1.6 16.1A16 16 0 0 0 6.4 18l1.2-1.6a11 11 0 0 1-1.9-.9l.5-.4c3.7 1.7 7.9 1.7 11.6 0l.5.4a11 11 0 0 1-1.9.9l1.2 1.6a16 16 0 0 0 4.8-1.9c.4-4.1-.7-7.7-2.9-10.8ZM8.8 14.1c-1.1 0-2-1-2-2.2s.9-2.2 2-2.2 2 1 2 2.2-.9 2.2-2 2.2Zm6.4 0c-1.1 0-2-1-2-2.2s.9-2.2 2-2.2 2 1 2 2.2-.9 2.2-2 2.2Z"></path></svg>`;
  const arrow = icon('<path d="M5 12h14M14 7l5 5-5 5"></path>');
  const shield = icon('<path d="M12 3 5 6v5c0 4.6 2.8 8 7 10 4.2-2 7-5.4 7-10V6l-7-3Z"></path><path d="m9 12 2 2 4-5"></path>');
  const pulse = icon('<path d="M3 12h4l2-5 4 10 2-5h6"></path>');
  const command = icon('<rect x="4" y="5" width="16" height="14" rx="4"></rect><path d="M8 10h8M8 14h5"></path>');
  const role = icon('<path d="M8 19v-1a4 4 0 0 1 8 0v1"></path><circle cx="12" cy="9" r="4"></circle><path d="M18 8h3M19.5 6.5v3"></path>');
  const lock = icon('<rect x="5" y="10" width="14" height="10" rx="3"></rect><path d="M8 10V8a4 4 0 0 1 8 0v2"></path>');

  const access = document.getElementById('access-scene');
  if (access) {
    access.innerHTML = `
      <div class="pro-login-bg" aria-hidden="true"><i></i><i></i><i></i><span></span></div>
      <header class="pro-login-top">
        <div class="pro-login-brand"><div class="pro-brand-mark"><strong>FH</strong><img src="assets/fallen-heaven-icon.png" alt=""></div><span><b>FALLEN HEAVEN</b><small>CONTROL CENTER</small></span></div>
        <div class="pro-login-state"><i></i><span>Discord Operations Suite</span></div>
      </header>

      <main class="pro-login-layout">
        <section class="pro-login-card">
          <div class="pro-card-kicker"><span>${discordMark}</span> Sicherer Discord-Zugang</div>
          <h1 id="access-title">Verbinde Discord.<br><em>Server steuern.</em></h1>
          <p id="access-copy">Sicherer Einstieg für Bot, Rollen, Module, Backups und Content. Keine leere Startfläche, kein Passwortzugriff — direkt ins Control Center.</p>

          <button id="login-portal-action" class="pro-discord-button" type="button" data-login="true">
            <span class="pro-button-icon">${discordMark}</span>
            <span><b>Mit Discord anmelden</b><small>Offizielles OAuth2-Fenster öffnen</small></span>
            <span class="pro-button-arrow">${arrow}</span>
          </button>

          <div class="pro-session-row">
            <span><i></i><b id="login-session-status">Sitzung wird geprüft</b></span>
            <span>${shield}<b>OAuth2 · kein Passwortzugriff</b></span>
          </div>

          <div class="pro-login-benefits">
            <article>${shield}<span><b>Nur erlaubte Server</b><small>Du siehst nur Server, die du verwalten darfst.</small></span></article>
            <article>${lock}<span><b>Lokale Sitzung</b><small>Durch das Betriebssystem geschützt und automatisch geprüft.</small></span></article>
            <article>${pulse}<span><b>Live verbunden</b><small>Bot, Discord und Module laden ohne Seitenflackern.</small></span></article>
          </div>
        </section>

        <section class="pro-preview-panel" aria-label="Control Center Vorschau">
          <div class="pro-preview-toolbar">
            <span><i></i><i></i><i></i></span>
            <b>FALLEN HEAVEN · LIVE CONTROL</b>
            <em><i></i> Online</em>
          </div>
          <div class="pro-preview-grid">
            <aside class="pro-preview-sidebar">
              <div class="pro-preview-server"><div class="pro-preview-mark"><strong>FH</strong><img src="assets/fallen-heaven-icon.png" alt=""></div><span><b>FALLEN HEAVEN</b><small>2.245 Mitglieder</small></span></div>
              <p class="active">${command}<span>Übersicht</span></p>
              <p>${role}<span>Rollen & Booster</span></p>
              <p>${shield}<span>Sicherheit</span></p>
              <p>${pulse}<span>Live-Diagnose</span></p>
            </aside>
            <div class="pro-preview-content">
              <header><small>COMMAND DECK</small><strong>Alles unter Kontrolle.</strong></header>
              <div class="pro-status-strip">
                <span><small>Bot Service</small><b>Online</b></span>
                <span><small>Module</small><b>17 aktiv</b></span>
                <span><small>Backups</small><b>Täglich</b></span>
              </div>
              <div class="pro-operation-card">
                <div><span>${discordMark}</span><b>Discord Gateway verbunden</b><small>Serverdaten werden live synchronisiert</small></div>
                <i></i>
              </div>
              <div class="pro-message-card">
                <img src="assets/discord-home-wumpus.webp" alt="">
                <div><b>Boost-Rolle vergeben</b><small>Automatische Rolle, Coin-Ledger und Timeline aktualisiert.</small></div>
              </div>
            </div>
          </div>
          <div class="pro-floating-card"><span>${pulse}</span><div><small>LIVE DIAGNOSE</small><b>System stabil</b></div></div>
        </section>
      </main>

      <footer class="pro-login-footer"><span>Native Desktop-App</span><span><i></i> Bot erreichbar</span><span id="modern-login-version">Version wird geprüft</span></footer>`;
  }

  const appNav = document.querySelector('.app-nav');
  if (appNav && !appNav.querySelector('.ref-server-context')) {
    const context = document.createElement('section');
    context.className = 'ref-server-context';
    context.innerHTML = `<span>${discordMark}</span><div><small>DISCORD WORKSPACE</small><b id="ref-active-guild">Server auswählen</b></div><i></i>`;
    const links = appNav.querySelector('.app-links');
    appNav.insertBefore(context, links);

    const updateGuild = () => {
      const picker = document.getElementById('guild-select');
      const label = picker?.selectedOptions?.[0]?.textContent?.trim();
      const target = document.getElementById('ref-active-guild');
      if (target && label && !/auswählen|laden/i.test(label)) target.textContent = label;
    };
    document.getElementById('guild-select')?.addEventListener('change', updateGuild);
    document.addEventListener('fh:view-change', updateGuild);
    window.setTimeout(updateGuild, 900);
  }

  const stage = document.querySelector('.main-stage');
  if (stage && !stage.querySelector('.ref-app-sky')) {
    const sky = document.createElement('div');
    sky.className = 'ref-app-sky';
    sky.setAttribute('aria-hidden', 'true');
    sky.innerHTML = `<img src="assets/discord-star-lg.svg" alt=""><img src="assets/discord-star-md.svg" alt=""><img src="assets/discord-star-sm.svg" alt=""><i></i><i></i>`;
    stage.prepend(sky);
  }

  document.documentElement.dataset.visualSystem = 'discord-reference-v7';
})();
