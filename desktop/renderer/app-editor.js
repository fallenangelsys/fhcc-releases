(function () {
  'use strict';

  function getDefaults() { return globalThis.appEditorDefaults || {}; }
  function getSettings() { return globalThis.appEditorSettings || {}; }
  function setSettings(value) { globalThis.appEditorSettings = value; }
  function getActivePage() { return globalThis.appEditorActivePage || 'home'; }
  function setActivePage(value) { globalThis.appEditorActivePage = value; }

  function detectWeakDevice() {
    try {
      const threads = Number(navigator?.hardwareConcurrency || 0);
      const memory = Number(navigator?.deviceMemory || 0);
      return (threads > 0 && threads <= 4) || (memory > 0 && memory <= 8);
    } catch {
      return false;
    }
  }

  function normalizeMotionSetting(value) {
    if (value === true || value === 'on') return 'on';
    if (value === false || value === 'off') return 'off';
    return 'auto';
  }

  function motionIsActive() {
    const setting = normalizeMotionSetting(getSettings().motion);
    return setting === 'on' || (setting === 'auto' && !detectWeakDevice());
  }

  function normalizeAppEditorSettings(raw) {
    const defaults = getDefaults();
    // Härtung: Falls app.js die Defaults noch nicht exportiert hat (Lade-
    // reihenfolge), darf das hier nicht mit Object.keys(undefined) crashen –
    // ein Top-Level-Fehler hier lässt den Preboot-Screen permanent stehen.
    const basePages = defaults && typeof defaults === 'object' && defaults.pages && typeof defaults.pages === 'object' ? defaults.pages : {};
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
      ...defaults,
      ...incoming,
      motion: normalizeMotionSetting(incoming.motion),
      pages,
      selectedPage: pageIds.includes(incoming.selectedPage) ? incoming.selectedPage : 'home'
    };
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

  function applyPageCopy(pageId, selectors) {
    const s = getSettings();
    const defaults = getDefaults();
    const page = s.pages?.[pageId] || defaults.pages[pageId];
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
    const s = getSettings();
    const pageId = s.selectedPage || getActivePage() || 'home';
    const source = document.getElementById(pageId + '-view');
    const frame = document.getElementById('app-editor-page-frame');
    const label = document.getElementById('app-editor-preview-page-label');
    if (!source || !frame) return;
    const pageName = document.querySelector(`#app-edit-page option[value="${pageId}"]`)?.textContent || pageId;
    if (label) label.textContent = `VOLLSTÄNDIGE SEITE · ${pageName.toUpperCase()}`;

    const cloneNode = source.cloneNode(true);
    cloneNode.classList.add('active', 'editor-native-page-clone');
    cloneNode.removeAttribute('aria-hidden');
    cloneNode.querySelectorAll('script, dialog').forEach(function (node) { node.remove(); });
    cloneNode.querySelectorAll('button, input, select, textarea, a').forEach(function (node) {
      node.setAttribute('tabindex', '-1');
      node.style.pointerEvents = 'none';
    });
    if (pageId === 'editor') {
      const recursivePreview = cloneNode.querySelector('.app-editor-preview');
      if (recursivePreview) recursivePreview.innerHTML = '<div class="editor-recursion-note"><b>Vollseiten-App-Editor</b><p>Dieser Bereich ist die Vorschau, in der du gerade befindest.</p></div>';
    }

    const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(function (link) {
      return `<link rel="stylesheet" href="${escapeHtml(link.href)}">`;
    }).join('');
    const theme = document.body.dataset.theme || 'dark';
    const background = document.body.dataset.appBackground || 'fallen';
    const density = document.body.dataset.appDensity || 'premium';
    frame.srcdoc = `<!doctype html><html><head><base href="${escapeHtml(document.baseURI)}">${styles}<style>html,body{min-height:100%;margin:0;overflow:auto}body{padding:0!important}.view.editor-native-page-clone{display:block!important;width:calc(100% - 28px)!important;max-width:none!important;min-height:100vh;margin:0 auto!important;padding:26px 0 70px!important}.view.editor-native-page-clone#home-view{width:100%!important;padding:0!important}.editor-recursion-note{min-height:520px;display:grid;place-content:center;text-align:center;color:var(--text)}.editor-recursion-note p{color:var(--muted)}button,input,select,textarea,a{cursor:default!important}</style></head><body data-theme="${escapeHtml(theme)}" data-app-background="${escapeHtml(background)}" data-app-density="${escapeHtml(density)}">${cloneNode.outerHTML}</body></html>`;
  }

  function applyAppEditorSettings(settings) {
    const defaults = getDefaults();
    settings = settings || getSettings();
    const merged = {
      ...defaults,
      ...settings,
      pages: { ...defaults.pages, ...(settings.pages || {}) }
    };
    setSettings(merged);
    setActivePage(merged.selectedPage || getActivePage() || 'home');
    const s = getSettings();
    document.documentElement.style.setProperty('--accent', s.accent);
    document.documentElement.style.setProperty('--accent-strong', s.accent);
    document.documentElement.style.setProperty('--v4-amethyst', s.accent);
    document.documentElement.style.setProperty('--v4-amethyst-bright', mixAppColor(s.accent));
    document.body.dataset.appBackground = s.background;
    document.body.dataset.appDensity = s.density;
    const weakDevice = detectWeakDevice();
    document.body.classList.toggle('low-power', weakDevice);
    const motionActive = motionIsActive();
    document.body.dataset.motion = motionActive ? 'on' : 'off';
    document.body.classList.toggle('motion-reduced', !motionActive);

    document.querySelectorAll('.landing-brand span, .native-dashboard-brand span').forEach(function (node) {
      node.innerHTML = escapeHtml(s.brand).replace(/\s+/g, '<br>');
    });
    const heroTitle = document.querySelector('.hero-copy h1');
    if (heroTitle) heroTitle.innerHTML = escapeHtml(s.hero).replace(/\n/g, '<br>');
    const publicHeroTitle = document.querySelector('.landing-copy h1');
    if (publicHeroTitle) publicHeroTitle.innerHTML = escapeHtml(s.hero).replace(/\n/g, '<br>');
    document.querySelectorAll('.hero-lead, .landing-copy h2').forEach(function (node) {
      node.textContent = s.lead;
    });

    const previewBrand = document.getElementById('app-editor-preview-brand');
    const previewKicker = document.getElementById('app-editor-preview-kicker');
    const previewTitle = document.getElementById('app-editor-preview-title');
    const previewLead = document.getElementById('app-editor-preview-lead');
    const selectedPreviewPage = s.pages?.[s.selectedPage || 'home'] || defaults.pages.home;
    const previewShell = document.querySelector('.app-editor-preview');
    if (previewShell) {
      previewShell.dataset.previewPage = s.selectedPage || 'home';
      previewShell.dataset.previewTitle = selectedPreviewPage.title || s.hero || '';
    }
    if (previewBrand) previewBrand.textContent = s.brand;
    if (previewKicker) previewKicker.textContent = selectedPreviewPage.kicker || 'LIVE APP PREVIEW';
    if (previewTitle) previewTitle.innerHTML = escapeHtml(selectedPreviewPage.title || s.hero).replace(/\n/g, '<br>');
    if (previewLead) previewLead.textContent = selectedPreviewPage.lead || s.lead;
    const previewCardContent = {
      home: [['Dashboard', 'Discord Login'], ['Embed Studio', 'Bot-Versand'], ['Module', 'Bot-Systeme']],
      center: [['Bot-Service', 'Live-Steuerung'], ['Server', 'Echtzeitdaten'], ['Aktivität', 'Übersicht']],
      modules: [['Moderation', 'Schutz aktiv'], ['Leveling', 'XP + Rollen'], ['Logging', 'Audit bereit']],
      studio: [['Entwürfe', 'Gespeichert'], ['Live Preview', 'Discord-Look'], ['Nachrichten', 'Bearbeitbar']],
      skin: [['Pixel Canvas', '64 × 64'], ['3D Modell', 'Live Vorschau'], ['Export', 'Minecraft PNG']],
      editor: [['Seiten', 'Live bearbeitbar'], ['Theme', 'Hell + Dunkel'], ['Vorschau', 'Fokusmodus']],
      system: [['Bot-Prozess', 'Überwacht'], ['Updates', 'Automatisch'], ['Speicher', 'Gesichert']]
    };
    document.querySelectorAll('.app-editor-preview-cards article').forEach(function (card, index) {
      const content = (previewCardContent[s.selectedPage] || previewCardContent.home)[index];
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

  function syncAppEditorForm() {
    const s = getSettings();
    const setValue = function (id, value) {
      const node = document.getElementById(id);
      if (node) node.value = value;
    };
    setValue('app-edit-brand', s.brand);
    setValue('app-edit-subtitle', s.subtitle);
    setValue('app-edit-hero', s.hero);
    setValue('app-edit-lead', s.lead);
    setValue('app-edit-accent', s.accent);
    setValue('app-edit-background', s.background);
    setValue('app-edit-density', s.density);
    setValue('app-edit-page', s.selectedPage || 'home');
    setActivePage(s.selectedPage || 'home');
    syncAppEditorPageForm();
    const motion = document.getElementById('app-edit-motion');
    if (motion) motion.checked = motionIsActive();
  }

  function syncAppEditorPageForm() {
    const s = getSettings();
    const pageId = appEditorValue('app-edit-page') || s.selectedPage || 'home';
    const page = s.pages?.[pageId] || getDefaults().pages[pageId] || {};
    const setValue = function (id, value) {
      const node = document.getElementById(id);
      if (node) node.value = value || '';
    };
    setValue('app-edit-page-kicker', page.kicker);
    setValue('app-edit-page-title', page.title);
    setValue('app-edit-page-lead', page.lead);
  }

  function readAppEditorForm(pageOverride) {
    const s = getSettings();
    const defaults = getDefaults();
    const selectedPage = appEditorValue('app-edit-page') || s.selectedPage || getActivePage() || 'home';
    const currentPage = pageOverride || getActivePage() || selectedPage || 'home';
    const pages = { ...(s.pages || {}) };
    pages[currentPage] = {
      kicker: appEditorValue('app-edit-page-kicker') || defaults.pages[currentPage]?.kicker || '',
      title: appEditorValue('app-edit-page-title') || defaults.pages[currentPage]?.title || '',
      lead: appEditorValue('app-edit-page-lead') || defaults.pages[currentPage]?.lead || ''
    };
    return {
      brand: appEditorValue('app-edit-brand') || defaults.brand,
      subtitle: appEditorValue('app-edit-subtitle') || defaults.subtitle,
      hero: appEditorValue('app-edit-hero') || defaults.hero,
      lead: appEditorValue('app-edit-lead') || defaults.lead,
      accent: appEditorValue('app-edit-accent') || defaults.accent,
      background: appEditorValue('app-edit-background') || defaults.background,
      density: appEditorValue('app-edit-density') || defaults.density,
      motion: (() => {
        const motionNode = document.getElementById('app-edit-motion');
        return motionNode ? (motionNode.checked ? 'on' : 'off') : s.motion;
      })(),
      selectedPage,
      pages
    };
  }

  function saveAppEditorSettings() {
    setSettings(readAppEditorForm());
    localStorage.setItem('fh-app-editor-settings', JSON.stringify(getSettings()));
    applyAppEditorSettings(getSettings());
    setAppEditorStatus('App-Design gespeichert und live angewendet.');
    toast('App-Design gespeichert.', 'success');
  }

  function resetAppEditorSettings() {
    setSettings(normalizeAppEditorSettings(clone(globalThis.appEditorDefaults)));
    localStorage.setItem('fh-app-editor-settings', JSON.stringify(getSettings()));
    syncAppEditorForm();
    applyAppEditorSettings(getSettings());
    setAppEditorStatus('App-Design wurde zurückgesetzt.');
    toast('App Editor zurückgesetzt.', 'success');
  }

  window.FHCCAppEditor = {
    normalizeAppEditorSettings,
    detectWeakDevice,
    normalizeMotionSetting,
    motionIsActive,
    appEditorValue,
    setAppEditorStatus,
    mixAppColor,
    applyAppEditorSettings,
    applyPageCopy,
    scheduleAppEditorPagePreview,
    renderAppEditorPagePreview,
    syncAppEditorForm,
    syncAppEditorPageForm,
    readAppEditorForm,
    saveAppEditorSettings,
    resetAppEditorSettings,
    getSettings,
    setSettings,
    getActivePage,
    setActivePage
  };
})();
