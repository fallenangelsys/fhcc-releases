(function () {
  var editorMode = false;
  var editorPatches = {};
  var editorOriginals = {};
  var currentLanguage = 'en';

  function send(type, payload) {
    window.parent.postMessage(Object.assign({ type: type }, payload || {}), '*');
  }

  function absoluteUrl(value) {
    try {
      return new URL(value, 'https://discord.com/').href;
    } catch (error) {
      return '';
    }
  }

  function normalizeLanguage(value) {
    var language = String(value || '').toLowerCase();
    if (language.indexOf('de') === 0 || language.indexOf('deutsch') !== -1 || language.indexOf('german') !== -1) return 'de';
    if (language.indexOf('fr') === 0 || language.indexOf('fran') !== -1) return 'fr';
    if (language.indexOf('es') === 0 || language.indexOf('span') !== -1) return 'es';
    if (language.indexOf('it') === 0 || language.indexOf('ital') !== -1) return 'it';
    if (language.indexOf('pt') === 0 || language.indexOf('port') !== -1) return 'pt';
    return 'en';
  }

  function setTextNodeValue(node, value) {
    var before = node.nodeValue.match(/^\s*/)[0];
    var after = node.nodeValue.match(/\s*$/)[0];
    node.nodeValue = before + value + after;
  }

  function applyLanguage(language) {
    currentLanguage = normalizeLanguage(language);
    document.documentElement.lang = currentLanguage;
    document.documentElement.dataset.fallenHeavenLanguage = currentLanguage;
    if (currentLanguage === 'en') return;
    var dictionaries = {
      de: { 'Download':'Download', 'Discover':'Entdecken', 'Safety':'Sicherheit', 'Support':'Hilfe', 'Developers':'Entwickler', 'Careers':'Karriere', 'Open Discord':'Dashboard Login', 'Imagine a place...':'Stell dir einen Ort vor ...', 'Group chat that is all fun & games':'Gruppenchat voller Spiel und Spass', 'always have something to do together':'Immer etwas zusammen erleben', 'wherever you game, hang out here':'Wo du auch spielst, hier bist du zuhause' },
      fr: { 'Download':'Telecharger', 'Discover':'Decouvrir', 'Safety':'Securite', 'Support':'Aide', 'Developers':'Developpeurs', 'Careers':'Carrieres', 'Open Discord':'Dashboard Login' },
      es: { 'Download':'Descargar', 'Discover':'Descubrir', 'Safety':'Seguridad', 'Support':'Ayuda', 'Developers':'Desarrolladores', 'Careers':'Carreras', 'Open Discord':'Dashboard Login' },
      it: { 'Download':'Scarica', 'Discover':'Scopri', 'Safety':'Sicurezza', 'Support':'Supporto', 'Developers':'Sviluppatori', 'Careers':'Carriere', 'Open Discord':'Dashboard Login' },
      pt: { 'Download':'Baixar', 'Discover':'Descobrir', 'Safety':'Seguranca', 'Support':'Suporte', 'Developers':'Desenvolvedores', 'Careers':'Carreiras', 'Open Discord':'Dashboard Login' }
    };
    var dictionary = dictionaries[currentLanguage] || {};
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (node) {
      var key = node.nodeValue.trim();
      if (dictionary[key]) setTextNodeValue(node, dictionary[key]);
    });
  }

  function applyTheme(theme) {
    var normalized = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.fhTheme = normalized;
    document.body.classList.toggle('fh-source-light', normalized === 'light');
  }

  function buildRawSourceDashboard() {
    var data = { bot: {}, guilds: [], schema: {}, account: {} };
    var style = document.createElement('style');
    style.textContent = [
      '.fh-source-control{position:fixed;z-index:99999;top:92px;right:clamp(22px,5vw,82px);width:min(470px,calc(100vw - 44px));max-height:calc(100vh - 120px);overflow:auto;padding:28px;border:1px solid rgba(37,29,88,.14);border-radius:26px;color:#29243e;background:rgba(255,255,255,.96);box-shadow:0 30px 80px rgba(8,5,48,.34);backdrop-filter:blur(18px);transform:translateY(-12px) scale(.98);opacity:0;pointer-events:none;transition:.18s ease}.fh-source-control.open{transform:translateY(0) scale(1);opacity:1;pointer-events:auto}.fh-source-control-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.fh-source-control-head p{margin:0;color:#5a4ce0;font-size:10px;font-weight:900;letter-spacing:.16em}.fh-source-control-head h2{margin:7px 0 0;font-size:30px;letter-spacing:-.07em}.fh-source-close{width:31px;height:31px;border:1px solid #dfdbea;border-radius:50%;color:#514b67;background:#fff;cursor:pointer}.fh-source-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin:22px 0}.fh-source-stat{padding:12px;border-radius:12px;background:#f1efff}.fh-source-stat small{display:block;color:#716b83;font-size:8px;font-weight:900;letter-spacing:.1em}.fh-source-stat strong{display:block;margin-top:6px;font-size:16px;letter-spacing:-.05em}.fh-source-controls{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.fh-source-controls button,.fh-source-editor{border:0;border-radius:8px;padding:11px 13px;color:#fff;background:#5865f2;cursor:pointer;font-size:11px;font-weight:900}.fh-source-controls button.ghost{color:#4d46bd;background:#eeecff}.fh-source-module-list{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:19px}.fh-source-module{padding:10px;border:1px solid #e6e2f1;border-radius:10px;background:#fff}.fh-source-module b{display:block;color:#5a4ce0;font-size:10px}.fh-source-module span{display:block;margin-top:3px;color:#736d84;font-size:9px}.fh-source-dashboard-trigger{border:0!important;color:inherit!important;background:transparent!important;cursor:pointer!important;font:inherit!important}.fh-source-dashboard-trigger:after{content:"";display:block;height:2px;background:currentColor;transform:scaleX(0);transition:.16s}.fh-source-dashboard-trigger:hover:after{transform:scaleX(1)}'
    ].join('');
    document.head.appendChild(style);

    var brand = document.querySelector('.nav_brand');
    if (brand) {
      var brandImage = brand.querySelector('img');
      if (brandImage) { brandImage.src = 'assets/fallen-heaven-icon.png'; brandImage.alt = 'FALLEN HEAVEN'; }
    }
    document.querySelectorAll('#login, .login-button-js').forEach(function (button) {
      button.textContent = 'Dashboard Login';
      button.href = '#';
      button.addEventListener('click', function (event) { event.preventDefault(); window.parent.postMessage({ type: 'fallen-heaven-login' }, '*'); });
    });
    var menu = document.querySelector('.nav_menu');
    if (menu && !document.getElementById('fh-source-dashboard-trigger')) {
      var item = document.createElement('li');
      item.innerHTML = '<button id="fh-source-dashboard-trigger" class="nav_link fh-source-dashboard-trigger">Dashboard</button>';
      menu.insertBefore(item, menu.firstChild);
    }
    var panel = document.createElement('aside');
    panel.className = 'fh-source-control';
    panel.innerHTML = '<div class="fh-source-control-head"><div><p>FALLEN HEAVEN / CONTROL CENTER</p><h2>Dashboard</h2></div><button class="fh-source-close">x</button></div><div id="fh-source-content"></div>';
    document.body.appendChild(panel);

    function modules() { var items = data.schema && (data.schema.features || data.schema.modules); return Array.isArray(items) ? items : []; }
    function renderPanel() {
      var bot = data.bot || {};
      var online = !!(bot.running || bot.botRunning || bot.online);
      var guild = data.guilds[0] || {};
      var account = data.account || {};
      var list = modules();
      var host = panel.querySelector('#fh-source-content');
      if (!host) return;
      host.innerHTML = '<div class="fh-source-stats"><article class="fh-source-stat"><small>BOT</small><strong>' + (online ? 'ONLINE' : 'OFFLINE') + '</strong></article><article class="fh-source-stat"><small>SERVER</small><strong>' + (guild.name || 'KEIN SERVER') + '</strong></article><article class="fh-source-stat"><small>MODULE</small><strong>' + list.length + '</strong></article></div><div class="fh-source-controls"><button data-fh-command="start">Starten</button><button class="ghost" data-fh-command="restart">Neustart</button><button class="ghost" data-fh-command="stop">Stoppen</button><button class="ghost" data-fh-editor>Page Editor</button></div><div class="fh-source-module-list">' + (list.length ? list.slice(0, 8).map(function (item) { return '<article class="fh-source-module"><b>' + (item.title || item.name || 'Modul') + '</b><span>' + (item.description || 'Konfiguration verfügbar') + '</span></article>'; }).join('') : '<article class="fh-source-module"><b>Warte auf Botdaten</b><span>Verbinde den Bot, um Module zu laden.</span></article>') + '</div>';
      document.querySelectorAll('[data-fh-command]').forEach(function (button) { button.addEventListener('click', function () { button.disabled = true; button.textContent = 'Bitte warten ...'; window.parent.postMessage({ type: 'fallen-heaven-dashboard-command', action: button.dataset.fhCommand }, '*'); }); });
      var editor = document.querySelector('[data-fh-editor]'); if (editor) editor.addEventListener('click', function () { window.parent.postMessage({ type: 'fallen-heaven-dashboard-editor' }, '*'); });
    }
    const dashboardTrigger = document.getElementById('fh-source-dashboard-trigger');
    if (dashboardTrigger) dashboardTrigger.addEventListener('click', function () { panel.classList.add('open'); });
    const dashboardClose = panel.querySelector('.fh-source-close');
    if (dashboardClose) dashboardClose.addEventListener('click', function () { panel.classList.remove('open'); });
    window.addEventListener('message', function (event) {
      if (!event.data || !event.data.type) return;
      if (event.data.type === 'fallen-heaven-dashboard-data') { data = event.data; renderPanel(); }
      if (event.data.type === 'fallen-heaven-dashboard-command-result') { data.bot = data.bot || {}; data.bot.running = !!event.data.active; renderPanel(); }
      if (event.data.type === 'fallen-heaven-theme') applyTheme(event.data.theme);
      if (event.data.type === 'fallen-heaven-language') applyLanguage(event.data.language || 'en');
    });
    renderPanel();
    window.parent.postMessage({ type: 'fallen-heaven-dashboard-ready' }, '*');
  }

  function buildSourceDashboard() {
    var dashboardData = { bot: {}, guilds: [], schema: {}, account: {} };
    var activeView = 'overview';
    var dashboardStyle = document.createElement('style');
    dashboardStyle.textContent = [
      'html,body{min-height:100%;margin:0;background:#f7f6ff!important;color:#28243c!important;font-family:gg sans,Arial,sans-serif!important}',
      '.fh-dash-root{min-height:100vh;background:linear-gradient(#f7f6ff,#efedff);overflow-x:hidden}',
      '.fh-dash-nav{position:sticky;top:0;z-index:9;background:#17135c;border-bottom:1px solid rgba(255,255,255,.12)}.fh-dash-nav .nav_wrapper{min-height:84px;padding:0 5.5vw;display:flex;align-items:center;gap:34px}.fh-dash-brand{display:flex;align-items:center;gap:11px;color:#fff;text-decoration:none;font-weight:900;line-height:.86;font-size:17px}.fh-dash-brand img{width:43px;height:43px;border-radius:50%;object-fit:cover;box-shadow:0 0 0 3px rgba(255,255,255,.14)}',
      '.fh-dash-menu{display:flex;align-items:center;justify-content:center;gap:clamp(18px,2.5vw,43px);margin:0;padding:0;list-style:none;flex:1}.fh-dash-menu button{position:relative;border:0;padding:12px 0;background:transparent;color:rgba(255,255,255,.78);cursor:pointer;font-weight:800;font-size:13px}.fh-dash-menu button:after{content:"";position:absolute;right:0;bottom:3px;left:0;height:2px;background:#fff;transform:scaleX(0);transition:.16s}.fh-dash-menu button:hover,.fh-dash-menu button.active{color:#fff}.fh-dash-menu button:hover:after,.fh-dash-menu button.active:after{transform:scaleX(1)}.fh-dash-account{border:0;border-radius:22px;padding:11px 16px;background:#fff;color:#17135c;font-weight:900;font-size:11px}',
      '.fh-dash-main{position:relative}.fh-dash-main:before{content:"";position:absolute;inset:0;opacity:.65;pointer-events:none;background-image:linear-gradient(rgba(88,101,242,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(88,101,242,.07) 1px,transparent 1px);background-size:50px 50px}.fh-dash-container{position:relative;max-width:1420px;margin:0 auto;padding:64px 6vw 95px}.fh-dash-hero{display:grid;grid-template-columns:minmax(0,1fr) minmax(340px,.8fr);gap:52px;min-height:360px;padding:54px 58px;overflow:hidden;border-radius:44px;color:#fff;background:linear-gradient(120deg,#5b65ef,#4039ad);box-shadow:0 28px 70px rgba(52,43,135,.25)}.fh-dash-hero:after{content:"";position:absolute;right:-8%;bottom:-26%;width:520px;height:520px;border:1px solid rgba(255,255,255,.22);border-radius:50%}.fh-dash-kicker{margin:0 0 18px;color:#d9d5ff;font-size:10px;font-weight:900;letter-spacing:.2em}.fh-dash-title{margin:0;font-size:clamp(48px,6.3vw,92px);line-height:.8;letter-spacing:-.09em}.fh-dash-copy{max-width:510px;margin:24px 0;color:#eceaff;line-height:1.5;font-size:15px}.fh-dash-actions{display:flex;flex-wrap:wrap;gap:10px}.fh-dash-actions button{border:0;border-radius:8px;padding:13px 17px;background:#fff;color:#29247c;cursor:pointer;font-weight:900}.fh-dash-actions button.ghost{border:1px solid rgba(255,255,255,.42);color:#fff;background:rgba(13,10,65,.18)}.fh-dash-orb{position:relative;display:grid;place-items:center;min-height:240px}.fh-dash-orb img{position:relative;z-index:2;width:168px;height:168px;border:3px solid rgba(255,255,255,.7);border-radius:50%;object-fit:cover;box-shadow:0 0 0 28px rgba(255,255,255,.07),0 24px 60px rgba(11,8,58,.34)}.fh-dash-orb:before,.fh-dash-orb:after{position:absolute;border:1px solid rgba(255,255,255,.31);border-radius:50%;content:""}.fh-dash-orb:before{width:266px;height:266px}.fh-dash-orb:after{width:350px;height:350px}',
      '.fh-dash-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:20px 0}.fh-dash-stat,.fh-dash-card{border:1px solid rgba(53,44,107,.14);border-radius:20px;background:rgba(255,255,255,.9);box-shadow:0 16px 38px rgba(49,41,103,.09)}.fh-dash-stat{padding:22px}.fh-dash-stat small{display:block;color:#716b84;font-size:10px;font-weight:900;letter-spacing:.1em}.fh-dash-stat strong{display:block;margin-top:9px;font-size:29px;letter-spacing:-.06em}.fh-dash-stat span{display:block;margin-top:5px;color:#756f86;font-size:11px}.fh-dash-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:18px}.fh-dash-card{padding:28px}.fh-dash-card h2{margin:5px 0 18px;font-size:28px;letter-spacing:-.06em}.fh-dash-card p{color:#716b84;line-height:1.5;font-size:13px}.fh-dash-module-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.fh-dash-module{min-height:152px;padding:20px;border:1px solid rgba(53,44,107,.13);border-radius:18px;background:rgba(255,255,255,.88)}.fh-dash-module b{display:block;color:#5750c8;font-size:10px;letter-spacing:.12em}.fh-dash-module h3{margin:18px 0 7px;font-size:20px;letter-spacing:-.05em}.fh-dash-module p{margin:0;color:#716b84;font-size:11px;line-height:1.45}.fh-dash-editor{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:37px;border-radius:30px;color:#fff;background:#17135c}.fh-dash-editor h2{margin:0;font-size:35px;letter-spacing:-.07em}.fh-dash-editor p{max-width:600px;color:#cec9f0;line-height:1.5}.fh-dash-editor button{border:0;border-radius:9px;padding:14px 18px;color:#191560;background:#fff;font-weight:900;cursor:pointer}.fh-dash-status{display:inline-flex;align-items:center;gap:7px;margin-top:12px;color:#2eae6d;font-size:11px;font-weight:900}.fh-dash-status i{width:8px;height:8px;border-radius:50%;background:currentColor;box-shadow:0 0 12px currentColor}@media(max-width:900px){.fh-dash-menu{gap:16px;overflow:auto;justify-content:flex-start}.fh-dash-hero,.fh-dash-grid{grid-template-columns:1fr}.fh-dash-stats,.fh-dash-module-grid{grid-template-columns:repeat(2,1fr)}.fh-dash-orb{display:none}}'
    ].join('');
    document.head.appendChild(dashboardStyle);
    document.body.className = 'fh-dash-root';
    document.body.innerHTML = '<div class="fh-dash-root"><header class="fh-dash-nav nav_padding"><div class="nav_wrapper"><a class="fh-dash-brand nav_brand" href="#"><img src="assets/fallen-heaven-icon.png" alt="FALLEN HEAVEN"><span>FALLEN<br>HEAVEN</span></a><ul class="fh-dash-menu nav_menu"><li><button data-dash-view="overview" class="active">Übersicht</button></li><li><button data-dash-view="modules">Module</button></li><li><button data-dash-view="editor">Page Editor</button></li><li><button data-dash-view="system">System</button></li></ul><button class="fh-dash-account">Dashboard Login</button></div></header><main id="fh-dash-main" class="fh-dash-main"></main></div>';

    function botOnline() { return dashboardData.bot && (dashboardData.bot.running || dashboardData.bot.botRunning || dashboardData.bot.online); }
    function moduleList() { var features = dashboardData.schema && (dashboardData.schema.features || dashboardData.schema.modules); return Array.isArray(features) ? features : []; }
    function render() {
      document.querySelectorAll('[data-dash-view]').forEach(function (button) { button.classList.toggle('active', button.dataset.dashView === activeView); });
      var main = document.getElementById('fh-dash-main');
      var info = dashboardData.bot || {};
      var guild = dashboardData.guilds[0] || {};
      var modules = moduleList();
      var online = botOnline();
      if (activeView === 'modules') {
        main.innerHTML = '<div class="fh-dash-container"><p class="fh-dash-kicker" style="color:#5865f2">FALLEN HEAVEN / MODULE</p><h1 style="font-size:clamp(48px,6vw,88px);letter-spacing:-.09em;margin:0 0 38px">SYSTEME<br>MIT HALTUNG.</h1><div class="fh-dash-module-grid">' + (modules.length ? modules.map(function (module) { return '<article class="fh-dash-module"><b>MODULE</b><h3>' + (module.title || module.name || 'Modul') + '</h3><p>' + (module.description || 'Konfiguration wird über die App verwaltet.') + '</p></article>'; }).join('') : '<article class="fh-dash-card"><h2>Module werden geladen</h2><p>Verbinde den Bot, damit die echte Modulliste erscheint.</p></article>') + '</div></div>';
      } else if (activeView === 'editor') {
        main.innerHTML = '<div class="fh-dash-container"><section class="fh-dash-editor"><div><p class="fh-dash-kicker">FALLEN HEAVEN / PAGE EDITOR</p><h2>Bearbeite deine Seite<br>direkt in der App.</h2><p>Wähle Texte, Bilder, Buttons oder Videos visuell aus. Alle Änderungen werden lokal gespeichert und sind jederzeit rückgängig.</p></div><button data-dash-editor>Editor öffnen</button></section></div>';
      } else if (activeView === 'system') {
        main.innerHTML = '<div class="fh-dash-container"><p class="fh-dash-kicker" style="color:#5865f2">FALLEN HEAVEN / SYSTEM</p><h1 style="font-size:clamp(48px,6vw,88px);letter-spacing:-.09em;margin:0 0 38px">STABIL.<br>UNTER KONTROLLE.</h1><div class="fh-dash-grid"><article class="fh-dash-card"><p class="fh-dash-kicker" style="color:#5865f2">BOT SERVICE</p><h2>' + (online ? 'ONLINE' : 'OFFLINE') + '</h2><p>Der Bot-Prozess wird direkt von deiner nativen Control App überwacht.</p><div class="fh-dash-actions"><button data-dash-command="start">Starten</button><button class="ghost" data-dash-command="restart">Neustart</button><button class="ghost" data-dash-command="stop">Stoppen</button></div></article><article class="fh-dash-card"><p class="fh-dash-kicker" style="color:#5865f2">LOKALE DATEN</p><h2>GESCHÜTZT</h2><p>Konfiguration, Memory und Editoränderungen liegen in deiner lokalen App.</p></article></div></div>';
      } else {
        main.innerHTML = '<div class="fh-dash-container"><section class="fh-dash-hero"><div><p class="fh-dash-kicker">FALLEN HEAVEN CONTROL CENTER</p><h1 class="fh-dash-title">DEIN<br>COMMAND<br>CENTER.</h1><p class="fh-dash-copy">Steuere deinen Bot, deine Module und deinen Server über eine einzige native Oberfläche.</p><div class="fh-dash-actions"><button data-dash-command="start">Bot starten</button><button class="ghost" data-dash-view="modules">Module öffnen</button></div><span class="fh-dash-status"><i></i>' + (online ? ' BOT SERVICE ONLINE' : ' BOT SERVICE BEREIT') + '</span></div><div class="fh-dash-orb"><img src="assets/fallen-heaven-icon.png" alt="FALLEN HEAVEN"></div></section><section class="fh-dash-stats"><article class="fh-dash-stat"><small>SERVER</small><strong>' + (guild.name || 'FALLEN HEAVEN') + '</strong><span>' + (guild.memberCount || guild.approximate_member_count || 0) + ' Mitglieder</span></article><article class="fh-dash-stat"><small>BOT SERVICE</small><strong>' + (online ? 'ONLINE' : 'OFFLINE') + '</strong><span>' + (info.pid ? 'PID ' + info.pid : 'Bereit zur Steuerung') + '</span></article><article class="fh-dash-stat"><small>MODULE</small><strong>' + (modules.length || 0) + '</strong><span>Systeme verfügbar</span></article><article class="fh-dash-stat"><small>ACCOUNT</small><strong>' + ((dashboardData.account && (dashboardData.account.global_name || dashboardData.account.username)) || 'Discord') + '</strong><span>Verbundener Zugriff</span></article></section><section class="fh-dash-grid"><article class="fh-dash-card"><p class="fh-dash-kicker" style="color:#5865f2">LIVE CONTROL</p><h2>Bot-Service</h2><p>Starten, stoppen oder neu starten, ohne den Prozess doppelt auszuführen.</p><div class="fh-dash-actions"><button data-dash-command="start">Starten</button><button class="ghost" data-dash-command="restart">Neustart</button><button class="ghost" data-dash-command="stop">Stoppen</button></div></article><article class="fh-dash-card"><p class="fh-dash-kicker" style="color:#5865f2">AKTIVER SERVER</p><h2>' + (guild.name || 'Noch keinen Server gewählt') + '</h2><p>Deine berechtigten Server und Konfigurationen werden direkt aus Discord geladen.</p></article></section></div>';
      }
      main.querySelectorAll('[data-dash-view]').forEach(function (button) { button.addEventListener('click', function () { activeView = button.dataset.dashView; render(); }); });
      main.querySelectorAll('[data-dash-command]').forEach(function (button) { button.addEventListener('click', function () { button.disabled = true; button.textContent = 'Bitte warten ...'; window.parent.postMessage({ type: 'fallen-heaven-dashboard-command', action: button.dataset.dashCommand }, '*'); }); });
      var editorButton = main.querySelector('[data-dash-editor]'); if (editorButton) editorButton.addEventListener('click', function () { window.parent.postMessage({ type: 'fallen-heaven-dashboard-editor' }, '*'); });
    }

    document.querySelectorAll('[data-dash-view]').forEach(function (button) { button.addEventListener('click', function () { activeView = button.dataset.dashView; render(); }); });
    var dashAccount = document.querySelector('.fh-dash-account');
    if (dashAccount) {
      dashAccount.addEventListener('click', function () { window.parent.postMessage({ type: 'fallen-heaven-login' }, '*'); });
    }
    window.addEventListener('message', function (event) {
      if (!event.data || !event.data.type) return;
      if (event.data.type === 'fallen-heaven-dashboard-data') { dashboardData = event.data; render(); }
      if (event.data.type === 'fallen-heaven-dashboard-command-result') { dashboardData.bot = dashboardData.bot || {}; dashboardData.bot.running = !!event.data.active; render(); }
      if (event.data.type === 'fallen-heaven-theme') applyTheme(event.data.theme);
    });
    render();
    window.parent.postMessage({ type: 'fallen-heaven-dashboard-ready' }, '*');
  }

  function requestLogin(event) {
    if (event) event.preventDefault();
    send('fallen-heaven-login');
  }

  function closeDropdowns(except) {
    document.querySelectorAll('.w-dropdown, .nav_dd').forEach(function (dropdown) {
      if (dropdown !== except) dropdown.classList.remove('fh-dropdown-open');
    });
  }

  function installDropdowns() {
    document.querySelectorAll('.w-dropdown, .nav_dd').forEach(function (dropdown) {
      var trigger = dropdown.querySelector('.w-dropdown-toggle, .nav_dd_trigger');
      var list = dropdown.querySelector('.w-dropdown-list, .nav_dd_list');
      if (!trigger || !list) return;
      dropdown.addEventListener('mouseenter', function () {
        closeDropdowns(dropdown);
        dropdown.classList.add('fh-dropdown-open');
      });
      dropdown.addEventListener('mouseleave', function () {
        dropdown.classList.remove('fh-dropdown-open');
      });
      trigger.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        var open = !dropdown.classList.contains('fh-dropdown-open');
        closeDropdowns(dropdown);
        dropdown.classList.toggle('fh-dropdown-open', open);
      });
    });
    document.addEventListener('click', function () { closeDropdowns(); });
  }

  function installLinkBridge() {
    document.addEventListener('click', function (event) {
      if (editorMode) return;
      var anchor = event.target.closest('a');
      if (!anchor) return;
      var href = anchor.getAttribute('href') || '';
      if (!href || href === '#') return;
      if (anchor.matches('#login, .login-button-js') || href.indexOf('/channels/@me') !== -1) {
        requestLogin(event);
        return;
      }
      if (anchor.closest('.language, .lang-dropdown, .dropdown-language-list-wr') || /[?&](locale|lang)=/i.test(href)) {
        event.preventDefault();
        var language = normalizeLanguage((href.match(/[?&](?:locale|lang)=([^&#]+)/i) || [])[1] || anchor.getAttribute('lang') || anchor.textContent.trim());
        send('fallen-heaven-language', { language: language });
        if (language !== currentLanguage) {
          window.location.replace('discord-supplied.html?lang=' + encodeURIComponent(language));
          return;
        }
        applyLanguage(language);
        return;
      }
      if (href.charAt(0) === '#' || href.indexOf('#fallen-heaven-login') !== -1) {
        requestLogin(event);
        return;
      }
      event.preventDefault();
      send('fallen-heaven-external', { url: absoluteUrl(href) });
    }, true);
  }

  function getEditableKind(element) {
    var tag = element.tagName.toLowerCase();
    if (tag === 'img') return 'image';
    if (tag === 'video') return 'video';
    if (tag === 'a') return 'link';
    return 'text';
  }

  function directText(element) {
    return Array.from(element.childNodes).filter(function (node) { return node.nodeType === Node.TEXT_NODE; }).map(function (node) { return node.nodeValue; }).join('').trim();
  }

  function ensureEditorElements() {
    var counter = 0;
    document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,a,button,img,video').forEach(function (element) {
      if (element.closest('script,style') || element.classList.contains('fh-app-brand-label')) return;
      if (!element.dataset.fhEditorId) {
        element.dataset.fhEditorId = 'fh-element-' + counter;
      }
      if (!editorOriginals[element.dataset.fhEditorId]) editorOriginals[element.dataset.fhEditorId] = {
        text: directText(element),
        href: element.getAttribute('href'),
        src: element.getAttribute('src'),
        display: element.style.display || ''
      };
      counter += 1;
    });
  }

  function setDirectText(element, value) {
    var textNodes = Array.from(element.childNodes).filter(function (node) { return node.nodeType === Node.TEXT_NODE; });
    textNodes.forEach(function (node) { node.remove(); });
    if (value !== undefined && value !== null && String(value) !== '') element.insertBefore(document.createTextNode(String(value)), element.firstChild);
  }

  function editorRecord(element) {
    var kind = getEditableKind(element);
    var value = kind === 'image' || kind === 'video' ? (element.getAttribute('src') || '') : (element.textContent || '').trim();
    return {
      id: element.dataset.fhEditorId,
      kind: kind,
      label: element.tagName.toLowerCase() + (value ? ' - ' + value.slice(0, 46) : ''),
      value: value.slice(0, 100),
      text: element.tagName === 'IMG' || element.tagName === 'VIDEO' ? '' : directText(element),
      href: element.getAttribute('href') || '',
      src: element.getAttribute('src') || '',
      selector: element.tagName.toLowerCase() + '[data-fh-editor-id="' + element.dataset.fhEditorId + '"]'
    };
  }

  function applyEditorPatches() {
    document.querySelectorAll('[data-fh-editor-id]').forEach(function (element) {
      var original = editorOriginals[element.dataset.fhEditorId];
      if (!original) return;
      if (element.tagName !== 'IMG' && element.tagName !== 'VIDEO') setDirectText(element, original.text);
      if (original.href !== null) element.setAttribute('href', original.href);
      else element.removeAttribute('href');
      if (original.src !== null) element.setAttribute('src', original.src);
      element.style.display = original.display;
      var patch = editorPatches[element.dataset.fhEditorId];
      if (!patch) return;
      if (patch.text !== undefined && element.tagName !== 'IMG' && element.tagName !== 'VIDEO') setDirectText(element, patch.text);
      if (patch.href !== undefined && patch.href) element.setAttribute('href', patch.href);
      if (patch.src !== undefined && patch.src) element.setAttribute('src', patch.src);
      if (patch.hidden) element.style.display = 'none';
    });
  }

  function sendEditorIndex() {
    window.parent.postMessage({
      type: 'fallen-heaven-editor-index',
      elements: Array.from(document.querySelectorAll('[data-fh-editor-id]')).map(editorRecord)
    }, '*');
  }

  function installEditorBridge() {
    document.addEventListener('pointerover', function (event) {
      if (!editorMode) return;
      var element = event.target.closest('[data-fh-editor-id]');
      if (element) element.classList.add('fh-editor-hover');
    }, true);
    document.addEventListener('pointerout', function (event) {
      var element = event.target.closest('[data-fh-editor-id]');
      if (element) element.classList.remove('fh-editor-hover');
    }, true);
    document.addEventListener('click', function (event) {
      if (!editorMode) return;
      var element = event.target.closest('[data-fh-editor-id]');
      if (!element) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      document.querySelectorAll('.fh-editor-selected').forEach(function (item) { item.classList.remove('fh-editor-selected'); });
      element.classList.add('fh-editor-selected');
      window.parent.postMessage({ type: 'fallen-heaven-editor-select', element: editorRecord(element) }, '*');
    }, true);

    window.addEventListener('message', function (event) {
      if (!event.data || !event.data.type) return;
      if (event.data.type === 'fallen-heaven-editor-mode') {
        editorMode = !!event.data.enabled;
        editorPatches = event.data.patches || editorPatches;
        ensureEditorElements();
        applyEditorPatches();
        document.body.classList.toggle('fh-editor-mode', editorMode);
        if (editorMode) sendEditorIndex();
      }
      if (event.data.type === 'fallen-heaven-editor-patches') {
        editorPatches = event.data.patches || {};
        ensureEditorElements();
        applyEditorPatches();
        if (editorMode) sendEditorIndex();
      }
      if (event.data.type === 'fallen-heaven-editor-select') {
        var selected = document.querySelector('[data-fh-editor-id="' + event.data.id + '"]');
        if (selected) {
          document.querySelectorAll('.fh-editor-selected').forEach(function (item) { item.classList.remove('fh-editor-selected'); });
          selected.classList.add('fh-editor-selected');
          selected.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        }
      }
      if (event.data.type === 'fallen-heaven-language') applyLanguage(event.data.language || 'en');
      if (event.data.type === 'fallen-heaven-theme') applyTheme(event.data.theme);
    });
  }

  function applyFallenHeavenBridge() {
    if ((new URLSearchParams(window.location.search)).get('mode') === 'dashboard') { buildRawSourceDashboard(); return; }
    var style = document.createElement('style');
    style.textContent = [
      '.fh-app-brand-label{margin-left:10px;color:inherit;font:900 13px/1.05 Arial,sans-serif;letter-spacing:.04em}',
      '.fh-app-brand-label small{display:block;margin-top:3px;opacity:.68;font-size:8px;letter-spacing:.14em}',
      '.fh-app-open-button{white-space:nowrap!important}',
      '.w-dropdown.fh-dropdown-open>.w-dropdown-list,.nav_dd.fh-dropdown-open>.nav_dd_list{display:block!important;height:auto!important;opacity:1!important;visibility:visible!important;transform:none!important}',
      '.w-dropdown.fh-dropdown-open .nav_dd_arrow-wr-white{transform:rotate(180deg)!important}',
      'body.fh-editor-mode [data-fh-editor-id]{cursor:crosshair!important;outline:1px dashed transparent;outline-offset:3px;transition:outline-color .12s ease,box-shadow .12s ease}',
      'body.fh-editor-mode [data-fh-editor-id].fh-editor-hover{outline-color:#5b4be3!important;box-shadow:0 0 0 4px rgba(91,75,227,.16)!important}',
      'body.fh-editor-mode [data-fh-editor-id].fh-editor-selected{outline:2px solid #5b4be3!important;box-shadow:0 0 0 5px rgba(91,75,227,.2)!important}',
      'html[data-fh-theme="light"] body{filter:brightness(1.12) saturate(.82)}'
    ].join('');
    document.head.appendChild(style);

    var brand = document.querySelector('.nav_brand');
    if (brand) {
      var image = brand.querySelector('img');
      if (image) {
        image.src = 'assets/fallen-heaven-icon.png';
        image.alt = 'FALLEN HEAVEN';
      }
      if (!brand.querySelector('.fh-app-brand-label')) {
        var label = document.createElement('span');
        label.className = 'fh-app-brand-label';
        label.innerHTML = 'FALLEN HEAVEN<small>CONTROL APP</small>';
        brand.appendChild(label);
      }
    }

    document.querySelectorAll('#login, .login-button-js, a[href="https://discord.com/channels/@me"]').forEach(function (button) {
      button.textContent = 'Dashboard Login';
      button.classList.add('fh-app-open-button');
      button.setAttribute('href', '#fallen-heaven-login');
    });

    document.querySelectorAll('.is_careers').forEach(function (link) {
      link.href = 'https://discord.gg/fallen-heaven';
      link.target = '_blank';
      link.rel = 'noreferrer';
    });

    installDropdowns();
    installLinkBridge();
    installEditorBridge();
    applyLanguage((new URLSearchParams(window.location.search)).get('lang') || 'en');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyFallenHeavenBridge);
  else applyFallenHeavenBridge();
}());
