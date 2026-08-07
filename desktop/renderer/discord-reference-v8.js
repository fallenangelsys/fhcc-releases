(() => {
  'use strict';

  const discordMark = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 5.3A17 17 0 0 0 15.6 4l-.5 1.1a14 14 0 0 0-6.2 0L8.4 4a17 17 0 0 0-3.9 1.3C2 9 1.3 12.6 1.6 16.1A16 16 0 0 0 6.4 18l1.2-1.6a11 11 0 0 1-1.9-.9l.5-.4c3.7 1.7 7.9 1.7 11.6 0l.5.4a11 11 0 0 1-1.9.9l1.2 1.6a16 16 0 0 0 4.8-1.9c.4-4.1-.7-7.7-2.9-10.8ZM8.8 14.1c-1.1 0-2-1-2-2.2s.9-2.2 2-2.2 2 1 2 2.2-.9 2.2-2 2.2Zm6.4 0c-1.1 0-2-1-2-2.2s.9-2.2 2-2.2 2 1 2 2.2-.9 2.2-2 2.2Z"></path></svg>`;
  const logoutArrow = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 5H5v14h5m5-4 4-3-4-3m4 3H9"></path></svg>`;

  const account = document.querySelector('.app-account');
  if (account && !account.querySelector('.ref8-account-user')) {
    const service = account.querySelector('.service-pill');
    const avatar = account.querySelector('.account-avatar');
    const copy = account.querySelector('.account-copy');
    const login = account.querySelector('#discord-login');
    const logout = account.querySelector('#discord-logout');

    const userRow = document.createElement('div');
    userRow.className = 'ref8-account-user';
    const avatarWrap = document.createElement('span');
    avatarWrap.className = 'ref8-avatar-wrap';
    if (avatar) avatarWrap.append(avatar);
    avatarWrap.insertAdjacentHTML('beforeend', '<i aria-hidden="true"></i>');
    userRow.append(avatarWrap);
    if (copy) userRow.append(copy);
    if (logout) {
      logout.innerHTML = `<span>Abmelden</span>${logoutArrow}`;
      userRow.append(logout);
    }

    const healthRow = document.createElement('div');
    healthRow.className = 'ref8-account-health';
    if (service) healthRow.append(service);
    healthRow.insertAdjacentHTML('beforeend', `<span class="ref8-oauth">${discordMark}<b>OAuth geschützt</b></span>`);

    account.prepend(userRow);
    account.append(healthRow);
    if (login) account.append(login);
  }

  const artByView = {
    center: ['discord-home-clyde.webp', 'LIVE COMMAND'],
    community: ['discord-nav-nelly.webp', 'SERVER SPACE'],
    modules: ['discord-nav-cube.webp', 'BOT SYSTEMS'],
    studio: ['discord-nav-newspaper.webp', 'MESSAGE LAB'],
    skin: ['discord-nav-cube.webp', 'PIXEL CREATOR'],
    editor: ['discord-nav-quest.webp', 'CREATIVE MODE'],
    system: ['discord-home-wumpus.webp', 'SAFE & LOCAL']
  };

  document.querySelectorAll('.dashboard-view > .page-head').forEach((head) => {
    if (head.querySelector('.ref8-head-art')) return;
    const view = head.closest('.dashboard-view');
    const key = String(view?.id || '').replace('-view', '') || 'center';
    const art = artByView[key] || artByView.center;
    head.dataset.ref8View = key;
    const ornament = document.createElement('div');
    ornament.className = 'ref8-head-art';
    ornament.setAttribute('aria-hidden', 'true');
    ornament.innerHTML = `<span class="ref8-head-discord">${discordMark}</span><span class="ref8-head-orbit"><i></i><i></i><i></i></span><img src="assets/${art[0]}" alt=""><b>${art[1]}</b>`;
    head.append(ornament);
  });

  const serverContext = document.querySelector('.ref-server-context');
  if (serverContext && !serverContext.querySelector('.ref8-server-access')) {
    const info = document.createElement('em');
    info.className = 'ref8-server-access';
    info.textContent = 'VERWALTUNGSZUGRIFF';
    serverContext.querySelector('div')?.append(info);

    const updateServerContext = () => {
      const select = document.getElementById('guild-select');
      const option = select?.selectedOptions?.[0];
      const raw = String(option?.textContent || '').trim();
      if (!raw) return;
      const parts = raw.split(' - ');
      const access = parts.length > 1 ? parts.pop() : 'VERWALTUNGSZUGRIFF';
      const name = parts.join(' - ') || raw;
      const nameNode = document.getElementById('ref-active-guild');
      if (nameNode) nameNode.textContent = name;
      info.textContent = String(access).toUpperCase();
    };
    document.getElementById('guild-select')?.addEventListener('change', updateServerContext);
    document.addEventListener('fh:view-change', updateServerContext);
    window.setTimeout(updateServerContext, 800);
  }

  const stage = document.querySelector('.main-stage');
  if (stage && !stage.querySelector('.ref8-ambient')) {
    const ambient = document.createElement('div');
    ambient.className = 'ref8-ambient';
    ambient.setAttribute('aria-hidden', 'true');
    ambient.innerHTML = '<i></i><i></i><i></i><span></span><span></span><span></span>';
    stage.prepend(ambient);
  }

  document.documentElement.dataset.visualSystem = 'discord-reference-v8';
})();
