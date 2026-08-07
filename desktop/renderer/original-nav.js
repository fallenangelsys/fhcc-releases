(function () {
  var host = document.querySelector('.fh-public-nav');
  if (!host || !host.attachShadow || host.shadowRoot) return;

  var menus = [
    { label: 'Download', action: 'login' },
    { label: 'Nitro', action: 'login' },
    {
      label: 'Entdecken',
      size: 'compact',
      decor: 'assets/discord-nav-newspaper.webp',
      groups: [
        {
          title: 'Ressourcen',
          items: [
            { label: 'Serververzeichnis', sub: 'Server, Mitglieder und gemeinsame Räume' },
            { label: 'Angesagte Spiele', sub: 'Community-Trends und aktive Systeme' }
          ]
        }
      ]
    },
    {
      label: 'Cybersicherheit',
      size: 'wide',
      decor: 'assets/discord-nav-egg.webp',
      groups: [
        {
          title: 'Ressourcen',
          items: [
            { label: 'Family Center', sub: 'Sicherheit für Familien und Accounts' },
            { label: 'Safety Library', sub: 'Regeln, Schutz und Moderationswissen' },
            { label: 'Safety News', sub: 'Aktuelle Hinweise und Schutzupdates' },
            { label: 'Teen Charter', sub: 'Klare Regeln für junge Communities' },
            { label: 'Discord Player Guide', sub: 'Sicher spielen und kommunizieren' }
          ]
        },
        {
          title: 'Hubs',
          items: [
            { label: 'Parent Hub', sub: 'Infos für Eltern und Betreuung' },
            { label: 'Policy Hub', sub: 'Richtlinien und Durchsetzung' },
            { label: 'Privacy Hub', sub: 'Datenschutz und Kontrolle' },
            { label: 'Transparency Hub', sub: 'Berichte und Offenlegung' },
            { label: 'Wellbeing Hub', sub: 'Wohlbefinden in Communities' }
          ]
        }
      ]
    },
    {
      label: 'Quests',
      size: 'compact',
      decor: 'assets/discord-nav-quest.webp',
      groups: [
        {
          title: 'Ressourcen',
          items: [
            { label: 'Advertising', sub: 'Kampagnen und Community-Aktionen' },
            { label: 'Success Stories', sub: 'Beispiele erfolgreicher Server' },
            { label: 'Quests FAQ', sub: 'Antworten zu Quest-Systemen' }
          ]
        }
      ]
    },
    {
      label: 'Hilfe',
      size: 'compact',
      decor: 'assets/discord-nav-nelly.webp',
      groups: [
        {
          title: 'Ressourcen',
          items: [
            { label: 'Help Center', sub: 'Setup, Fehler und schnelle Hilfe' },
            { label: 'Feedback', sub: 'Wünsche und Verbesserungen sammeln' },
            { label: 'Submit a Request', sub: 'Support direkt anfordern' }
          ]
        }
      ]
    },
    {
      label: 'Blog',
      size: 'medium',
      decor: 'assets/discord-nav-cube.webp',
      groups: [
        {
          title: 'Collections',
          items: [
            { label: 'Featured', sub: 'Wichtige Neuigkeiten' },
            { label: 'Community', sub: 'Server, Events und Kultur' },
            { label: 'Discord HQ', sub: 'Ankündigungen und Einblicke' },
            { label: 'Engineering & Developers', sub: 'Technik und Entwicklung' },
            { label: 'How to Discord', sub: 'Guides und Einrichtung' },
            { label: 'Policy & Safety', sub: 'Sicherheit und Regeln' },
            { label: 'Product & Features', sub: 'Neue Funktionen' }
          ]
        }
      ]
    },
    {
      label: 'Entwickler',
      size: 'wide',
      decor: 'assets/discord-nav-clyde.webp',
      groups: [
        {
          title: 'Learn',
          items: [
            { label: 'Discord for Game Developers', sub: 'Game-Communities professionell bauen' },
            { label: 'Integration', sub: 'Bot, App und Server verbinden' },
            { label: 'Social Commerce', sub: 'Community-Erlebnisse monetarisieren' },
            { label: 'Apps & Activities', sub: 'Interaktive Discord-Erweiterungen' },
            { label: 'Developer Newsletter', sub: 'Updates für Entwickler' }
          ]
        },
        {
          title: 'Build',
          items: [
            { label: 'Developer Case Studies', sub: 'Praxisbeispiele und Lösungen' },
            { label: 'Official Game Communities', sub: 'Strukturen für große Server' },
            { label: 'Developer Portal', sub: 'Anwendungen und Bot-Verwaltung' },
            { label: 'Documentation', sub: 'APIs, Events und Permissions' },
            { label: 'Developer Help Center', sub: 'Technische Hilfe' }
          ]
        }
      ]
    },
    { label: 'Karriere', action: 'invite' }
  ];

  function arrow() {
    return '<span class="nav_dd_arrow" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M12 6L8 10L4 6" stroke="currentColor" stroke-opacity=".72" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
  }

  function actionFor(item) {
    return item.action || 'login';
  }

  function renderItem(item) {
    return [
      '<button class="dd_nav-link" type="button" data-action="' + actionFor(item) + '">',
      '<span class="dd_nav-title">' + item.label + '</span>',
      '<span class="dd_nav-sub">' + item.sub + '</span>',
      '</button>'
    ].join('');
  }

  function renderGroup(group) {
    return [
      '<section class="nav_dd_link-group">',
      '<div class="nav_dd_link_title">' + group.title + '</div>',
      '<div class="nav_dd_link_list">' + group.items.map(renderItem).join('') + '</div>',
      '</section>'
    ].join('');
  }

  function renderMenu(entry, index) {
    if (!entry.groups) {
      return '<li><button class="nav_link" type="button" data-action="' + entry.action + '">' + entry.label + '</button></li>';
    }

    return [
      '<li>',
      '<div class="nav_dd w-dropdown" data-menu-index="' + index + '" data-size="' + entry.size + '">',
      '<button class="nav_dd_trigger w-dropdown-toggle" type="button" aria-expanded="false">',
      '<span class="menu-title">' + entry.label + '</span>',
      arrow(),
      '</button>',
      '<nav class="nav_dd_list w-dropdown-list" aria-label="' + entry.label + '">',
      '<div class="nav_dd_content-wr isnew">',
      '<div class="nav_dd_content_layout">' + entry.groups.map(renderGroup).join('') + '</div>',
      '<img class="nav-dd-decor" src="' + entry.decor + '" alt="">',
      '</div>',
      '</nav>',
      '</div>',
      '</li>'
    ].join('');
  }

  host.innerHTML = '';
  function syncTheme() {
    host.dataset.theme = document.body.dataset.theme === 'light' ? 'light' : 'dark';
  }
  syncTheme();
  new MutationObserver(syncTheme).observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });
  var root = host.attachShadow({ mode: 'open' });
  root.innerHTML = [
    '<style>',
    ':host{display:block;position:relative;z-index:80;color:#fff;font-family:"ABC Ginto Nord","gg sans","Helvetica Neue",Arial,sans-serif;}',
    '*{box-sizing:border-box}',
    'button{font:inherit}',
    '.nav{position:relative;min-height:92px;overflow:visible;background:transparent;isolation:isolate;}',
    '.nav:before{content:"";position:absolute;z-index:0;inset:0;background:linear-gradient(180deg,rgba(5,4,18,.58),rgba(5,4,18,.18)),linear-gradient(90deg,rgba(255,255,255,.048) 1px,transparent 1px),linear-gradient(180deg,rgba(255,255,255,.048) 1px,transparent 1px);background-size:auto,96px 96px,96px 96px;opacity:1;pointer-events:none;}',
    '.nav_blur{display:none!important;position:absolute;z-index:1;left:0;right:0;top:0;height:420px;opacity:0;visibility:hidden;pointer-events:none;background:transparent;-webkit-backdrop-filter:none;backdrop-filter:none;transition:none;}',
    '.nav:has(.nav_dd_trigger.w--open) .nav_blur,.nav.has-open .nav_blur{opacity:0;visibility:hidden;}',
    '.nav.has-open:before{opacity:.12;}',
    '.nav.has-open .nav_brand,.nav.has-open .nav_action,.nav.has-open .nav_link{opacity:.62;}',
    '.nav.has-open .nav_dd.open .nav_dd_trigger,.nav.has-open .nav_dd_trigger:hover,.nav.has-open .nav_link:hover{opacity:1;}',
    '.nav_padding{height:92px;max-width:1660px;margin:0 auto;padding:0 54px;}',
    '.nav_wrapper{position:relative;z-index:2;display:grid;grid-template-columns:minmax(220px,1fr) auto minmax(220px,1fr);align-items:center;height:100%;gap:24px;}',
    '.nav_brand{display:inline-flex;align-items:center;gap:12px;width:max-content;color:#fff;text-decoration:none;font-weight:900;font-size:22px;line-height:1;text-transform:uppercase;letter-spacing:0;}',
    '.nav_brand img{width:44px;height:44px;border-radius:50%;object-fit:cover;box-shadow:0 0 0 1px rgba(255,255,255,.18),0 12px 28px rgba(0,0,0,.38)}',
    '.nav_menu{display:flex;align-items:center;justify-content:center;gap:10px;margin:0;padding:0;list-style:none;white-space:nowrap;}',
    '.nav_link,.nav_dd_trigger,.nav_action{height:46px;border:0;border-radius:18px;background:transparent;color:#fff;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:0 18px;font-weight:900;font-size:16px;line-height:1;cursor:pointer;transition:background .18s ease,color .18s ease,transform .18s ease,box-shadow .18s ease;}',
    '.nav_link:hover,.nav_dd.open .nav_dd_trigger,.nav_dd_trigger:hover{background:#5865f2;color:#fff;box-shadow:0 14px 30px rgba(88,101,242,.26);}',
    '.nav_link:active,.nav_dd_trigger:active,.nav_action:active{transform:translateY(1px)}',
    '.nav_dd{position:relative;}',
    '.nav_dd:after{content:"";position:absolute;left:-22px;right:-22px;top:42px;height:42px;}',
    '.nav_dd_arrow{display:inline-flex;transition:transform .18s ease;}',
    '.nav_dd.open .nav_dd_arrow{transform:rotate(180deg)}',
    '.nav_dd_list{position:absolute;z-index:6;top:58px;left:50%;display:block;padding-top:18px;opacity:0;visibility:hidden;pointer-events:none;transform:translateX(-50%) translateY(-10px) scale(.985);transition:opacity .18s ease,transform .18s ease,visibility .18s ease;}',
    '.nav_dd_list:before{content:"";position:absolute;z-index:-1;left:50%;top:45%;width:86%;height:78%;border-radius:48px;background:rgba(88,101,242,.45);filter:blur(34px);transform:translate(-50%,-50%);opacity:0;transition:opacity .18s ease;}',
    '.nav_dd.open .nav_dd_list:before{opacity:1;}',
    '.nav_dd[data-size="compact"] .nav_dd_list{width:424px;}',
    '.nav_dd[data-size="medium"] .nav_dd_list{width:560px;}',
    '.nav_dd[data-size="wide"] .nav_dd_list{width:730px;}',
    '.nav_dd.open .nav_dd_list{opacity:1;visibility:visible;pointer-events:auto;transform:translateX(-50%) translateY(0) scale(1);}',
    '.nav_dd_content-wr{position:relative;min-height:188px;overflow:visible;border-radius:42px;background:#5865f2;color:#fff;box-shadow:0 30px 70px rgba(0,0,0,.42);transition:box-shadow .18s ease,transform .18s ease;}',
    '.nav_dd.open .nav_dd_content-wr{transform:translateY(2px);box-shadow:0 44px 95px rgba(0,0,0,.56),0 0 0 1px rgba(255,255,255,.12) inset;}',
    '.nav_dd_content-wr:before{content:"";position:absolute;left:50%;top:-13px;width:30px;height:30px;background:#5865f2;border-radius:4px;transform:translateX(-50%) rotate(45deg);}',
    '.nav_dd_content_layout{position:relative;z-index:2;display:grid;grid-template-columns:1fr;gap:26px;padding:38px 180px 38px 44px;}',
    '.nav_dd[data-size="wide"] .nav_dd_content_layout{grid-template-columns:1fr 1fr;padding-right:206px;}',
    '.nav_dd[data-size="medium"] .nav_dd_content_layout{padding-right:190px;}',
    '.nav_dd_link-group{display:grid;gap:14px;min-width:0;}',
    '.nav_dd_link_title{color:rgba(255,255,255,.52);font-size:15px;font-weight:900;line-height:1;text-transform:none;}',
    '.nav_dd_link_list{display:grid;gap:10px;}',
    '.dd_nav-link{display:grid;gap:4px;width:100%;border:0;background:transparent;color:#fff;text-align:left;padding:2px 0;cursor:pointer;transition:transform .16s ease,color .16s ease;}',
    '.dd_nav-link:hover{transform:translateX(4px)}',
    '.dd_nav-title{font-size:17px;font-weight:950;line-height:1.12;}',
    '.dd_nav-sub{font-family:"gg sans","Helvetica Neue",Arial,sans-serif;font-size:13px;font-weight:800;line-height:1.22;color:rgba(255,255,255,.64);white-space:normal;}',
    '.nav-dd-decor{position:absolute;right:-18px;bottom:-34px;width:178px;height:178px;object-fit:contain;filter:drop-shadow(0 20px 22px rgba(0,0,0,.32));pointer-events:none;}',
    '.nav_dd[data-size="wide"] .nav-dd-decor{right:-26px;bottom:-42px;width:214px;height:214px;}',
    '.nav_dd[data-size="medium"] .nav-dd-decor{right:-22px;bottom:-38px;width:198px;height:198px;}',
    '.nav_actions{justify-self:end;display:flex;align-items:center;gap:12px;}',
    '.nav_action{background:#fff;color:#16151f;padding:0 20px;box-shadow:0 16px 38px rgba(0,0,0,.28)}',
    '.nav_action:hover{background:#f1f2ff;transform:translateY(-1px)}',
    ':host([data-theme="light"]) .nav{background:transparent;color:#1c1a2f;}',
    ':host([data-theme="light"]) .nav:before{background:linear-gradient(180deg,rgba(255,255,255,.78),rgba(255,255,255,.28)),linear-gradient(90deg,rgba(88,101,242,.09) 1px,transparent 1px),linear-gradient(180deg,rgba(88,101,242,.09) 1px,transparent 1px);background-size:auto,96px 96px,96px 96px;opacity:1;}',
    ':host([data-theme="light"]) .nav_blur{background:transparent;-webkit-backdrop-filter:none;backdrop-filter:none;}',
    ':host([data-theme="light"]) .nav_brand,:host([data-theme="light"]) .nav_link,:host([data-theme="light"]) .nav_dd_trigger{color:#1c1a2f;}',
    ':host([data-theme="light"]) .nav_link:hover,:host([data-theme="light"]) .nav_dd.open .nav_dd_trigger,:host([data-theme="light"]) .nav_dd_trigger:hover{color:#fff;background:#5865f2;}',
    ':host([data-theme="light"]) .nav_action{color:#fff;background:#5865f2;box-shadow:0 16px 34px rgba(88,101,242,.2)}',
    ':host([data-theme="light"]) .nav_dd_content-wr,:host([data-theme="light"]) .nav_dd_content-wr:before{background:#5865f2;}',
    '@media (max-width:1320px){.nav_padding{padding:0 24px}.nav_wrapper{grid-template-columns:auto 1fr auto}.nav_menu{gap:4px}.nav_link,.nav_dd_trigger{font-size:14px;padding:0 12px}.nav_brand span{display:none}.nav_dd[data-size="wide"] .nav_dd_list{width:650px}}',
    '@media (max-width:980px){.nav{min-height:auto}.nav_padding{height:auto;padding:16px}.nav_wrapper{display:flex;align-items:flex-start;flex-direction:column}.nav_menu{flex-wrap:wrap;justify-content:flex-start}.nav_actions{justify-self:start}.nav_dd_list{left:0!important;transform:translateY(-10px) scale(.985)!important}.nav_dd.open .nav_dd_list{transform:translateY(0) scale(1)!important}.nav_dd[data-size] .nav_dd_list{width:min(92vw,560px)}.nav_dd[data-size="wide"] .nav_dd_content_layout{grid-template-columns:1fr}.nav_dd_content_layout{padding-right:44px}.nav-dd-decor{display:none}}',
    '</style>',
    '<header class="nav">',
    '<div class="nav_blur" aria-hidden="true"></div>',
    '<div class="nav_padding">',
    '<div class="nav_wrapper">',
    '<a class="nav_brand" href="#home" aria-label="FALLEN HEAVEN Start"><img src="assets/fallen-heaven-icon.png" alt=""><span>FALLEN HEAVEN</span></a>',
    '<ul class="nav_menu" role="list">' + menus.map(renderMenu).join('') + '</ul>',
    '<div class="nav_actions"><button class="nav_action" type="button" data-action="login">Dashboard Login</button></div>',
    '</div>',
    '</div>',
    '</header>'
  ].join('');

  var closeTimer = 0;
  var dropdowns = Array.prototype.slice.call(root.querySelectorAll('.nav_dd'));
  var navRoot = root.querySelector('.nav');
  var focusBlur = document.querySelector('.fh-nav-focus-blur');
  if (!focusBlur) {
    focusBlur = document.createElement('div');
    focusBlur.className = 'fh-nav-focus-blur';
    document.body.appendChild(focusBlur);
  }

  function positionFocusBlur() {
    if (!focusBlur) return;
    focusBlur.removeAttribute('style');
  }

  function syncGlobalFocus() {
    var hasOpen = dropdowns.some(function (dropdown) { return dropdown.classList.contains('open'); });
    if (navRoot) navRoot.classList.toggle('has-open', hasOpen);
    document.body.classList.toggle('fh-nav-open', hasOpen);
    if (!hasOpen && focusBlur) {
      focusBlur.removeAttribute('style');
    }
  }

  function closeDropdown(dropdown) {
    if (!dropdown) return;
    dropdown.classList.remove('open');
    var trigger = dropdown.querySelector('.nav_dd_trigger');
    var list = dropdown.querySelector('.nav_dd_list');
    if (trigger) {
      trigger.classList.remove('w--open');
      trigger.setAttribute('aria-expanded', 'false');
    }
    if (list) list.classList.remove('w--open');
    syncGlobalFocus();
  }

  function closeAll(except) {
    dropdowns.forEach(function (dropdown) {
      if (dropdown !== except) closeDropdown(dropdown);
    });
  }

  function openDropdown(dropdown) {
    window.clearTimeout(closeTimer);
    closeAll(dropdown);
    dropdown.classList.add('open');
    var trigger = dropdown.querySelector('.nav_dd_trigger');
    var list = dropdown.querySelector('.nav_dd_list');
    if (trigger) {
      trigger.classList.add('w--open');
      trigger.setAttribute('aria-expanded', 'true');
    }
    if (list) list.classList.add('w--open');
    syncGlobalFocus();
    window.requestAnimationFrame(positionFocusBlur);
  }

  function scheduleClose(dropdown) {
    window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(function () {
      closeDropdown(dropdown);
    }, 170);
  }

  dropdowns.forEach(function (dropdown) {
    var trigger = dropdown.querySelector('.nav_dd_trigger');
    trigger.addEventListener('mouseenter', function () { openDropdown(dropdown); });
    trigger.addEventListener('focus', function () { openDropdown(dropdown); });
    trigger.addEventListener('click', function (event) {
      event.stopPropagation();
      if (dropdown.classList.contains('open')) closeDropdown(dropdown);
      else openDropdown(dropdown);
    });
    dropdown.addEventListener('mouseenter', function () { openDropdown(dropdown); });
    dropdown.addEventListener('mouseleave', function () { scheduleClose(dropdown); });
  });

  root.addEventListener('click', function (event) {
    var action = event.target && event.target.closest ? event.target.closest('[data-action]') : null;
    if (!action) return;
    closeAll();
    if (action.getAttribute('data-action') === 'invite') {
      window.location.href = 'https://discord.gg/fallen-heaven';
      return;
    }
    var login = document.getElementById('discord-login');
    if (login) login.click();
  });

  document.addEventListener('click', function (event) {
    if (event.composedPath && event.composedPath().indexOf(host) !== -1) return;
    closeAll();
  });
  window.addEventListener('resize', function () {
    var open = dropdowns.find(function (dropdown) { return dropdown.classList.contains('open'); });
    if (open) positionFocusBlur();
  });
}());
