(() => {
  const storageKey = 'fh-app-theme';
  const cycleOrder = ['dark', 'light', 'system'];

  function normalize(theme) {
    if (theme === 'system') return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    return theme === 'light' ? 'light' : 'dark';
  }

  function cycleLabel(stored) {
    if (stored === 'system') return 'Dunkelmodus aktivieren';
    if (stored === 'dark') return 'Hellmodus aktivieren';
    return 'System-Theme aktivieren';
  }

  function controls() {
    return Array.from(document.querySelectorAll('#theme-toggle,[data-theme-toggle]'));
  }

  function apply(requestedTheme, persist = true) {
    const theme = normalize(requestedTheme);
    document.documentElement.dataset.theme = theme;
    document.body.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.body.classList.toggle('theme-light', theme === 'light');
    document.body.classList.toggle('theme-dark', theme === 'dark');
    if (persist) {
      localStorage.setItem(storageKey, requestedTheme === 'system' ? 'system' : theme);
      localStorage.setItem('fh-native-theme', theme);
    }
    const stored = persist ? requestedTheme : (localStorage.getItem(storageKey) || 'dark');
    controls().forEach((toggle) => {
      toggle.setAttribute('aria-pressed', theme === 'light' ? 'true' : 'false');
      toggle.setAttribute('aria-label', cycleLabel(stored));
      toggle.setAttribute('title', cycleLabel(stored));
      toggle.dataset.theme = theme;
      toggle.dataset.themeStored = stored;
    });
    document.querySelectorAll('[data-theme-select],#theme-select').forEach((select) => {
      const mapped = stored === 'system' ? 'system' : theme;
      if (select.value !== mapped) select.value = mapped;
    });
    document.querySelectorAll('iframe').forEach((frame) => {
      if (frame.contentWindow) frame.contentWindow.postMessage({ type: 'fallen-heaven-theme', theme }, '*');
    });
    window.dispatchEvent(new CustomEvent('fallen-heaven:theme-changed', { detail: { theme, stored } }));
  }

  const stored = localStorage.getItem(storageKey) || localStorage.getItem('fh-native-theme') || 'dark';
  apply(stored, false);
  window.addEventListener('click', (event) => {
    const toggle = event.target.closest('#theme-toggle,[data-theme-toggle]');
    if (!toggle) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const current = toggle.dataset.themeStored || localStorage.getItem(storageKey) || 'dark';
    const nextIndex = (cycleOrder.indexOf(current) + 1) % cycleOrder.length;
    apply(cycleOrder[nextIndex]);
  }, true);
  window.addEventListener('change', (event) => {
    if (event.target.matches('[data-theme-select],#theme-select')) apply(event.target.value);
  }, true);
  window.addEventListener('storage', (event) => {
    if (event.key === storageKey && event.newValue) apply(event.newValue, false);
  });
  window.addEventListener('fallen-heaven:set-theme', (event) => apply(event.detail?.theme || 'dark'));
  window.addEventListener('os:theme-changed', (event) => {
    if (localStorage.getItem(storageKey) === 'system') apply('system', false);
  });
  if (window.fallenHeaven?.onThemeChanged) {
    window.fallenHeaven.onThemeChanged((theme) => {
      if (localStorage.getItem(storageKey) === 'system') apply('system', false);
    });
  }
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (localStorage.getItem(storageKey) === 'system') apply('system', false);
  });
  document.addEventListener('load', (event) => {
    if (event.target instanceof HTMLIFrameElement) apply(localStorage.getItem(storageKey) || 'dark', false);
  }, true);
})();
