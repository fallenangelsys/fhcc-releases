/*
 * Mobile Bridge - Ersatz fuer desktop/preload.cjs ausserhalb von Electron.
 *
 * Setzt window.fallenHeaven, sobald die Seite ohne Electron laeuft (Browser,
 * PWA, Android-WebView). Der Renderer ruft danach unveraendert api.controlBot(),
 * api.apiRequest() usw. - der Vertrag bleibt identisch, nur die Transport-
 * schicht unterscheidet sich: hier HTTP statt Electron-IPC.
 *
 * Laedt diese Datei nur dann, wenn window.fallenHeaven fehlt. In Electron
 * gewinnt weiterhin der Preload aus desktop/preload.cjs.
 */
(() => {
  if (window.fallenHeaven?.apiRequest) return;

  const STORAGE_TOKEN = 'fh.session.token';
  const STORAGE_USER = 'fh.session.user';
  const SESSION_RENEWAL_WINDOW_MS = 15 * 24 * 60 * 60 * 1000;

  const readStored = (key) => {
    try {
      return window.localStorage.getItem(key) || '';
    } catch {
      return '';
    }
  };

  const writeStored = (key, value) => {
    try {
      if (value) window.localStorage.setItem(key, value);
      else window.localStorage.removeItem(key);
    } catch {
      /* Privater Modus: Sitzung laeuft dann nur fuer diese Seite. */
    }
  };

  // Basis-URL: eigene Herkunft, damit derselbe Code hinter /app, /
  // oder einem anderen Prefix funktioniert. Kein eigener Host noetig.
  const resolveBaseUrl = () => {
    const configured = readStored('fh.api.base');
    if (configured) return configured.replace(/\/+$/, '');
    const path = window.location.pathname || '/';
    const appIndex = path.indexOf('/app');
    const base = appIndex >= 0 ? path.slice(0, appIndex) : path.replace(/\/[^/]*$/, '');
    return `${window.location.origin}${base}`.replace(/\/+$/, '');
  };

  const baseUrl = resolveBaseUrl();

  const readToken = () => readStored(STORAGE_TOKEN);
  const readUser = () => {
    const raw = readStored(STORAGE_USER);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const notify = (type, payload) => {
    window.dispatchEvent(new CustomEvent(type, { detail: payload }));
  };

  let lastBotState = null;
  let pollTimer = null;
  let oauthPollTimer = null;

  const clearPoll = () => {
    if (pollTimer !== null) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const startPolling = () => {
    if (pollTimer !== null) return;
    const tick = async () => {
      try {
        const response = await rawFetch('/api/system/status', { method: 'GET' });
        if (!response.ok) return;
        // /api/system/status liefert { ok, action, running, message, output }.
        // running === null bedeutet "nicht eindeutig", dann darf der Bridge
        // keinen aktiven Bot behaupten.
        const body = response.data || {};
        const active = body.ok === true && body.running === true;
        const state = {
          active,
          ready: active,
          phase: active ? 'running' : 'stopped',
          message: String(body.message || body.output || (active ? 'Bot ist aktiv.' : 'Bot ist gestoppt.'))
        };
        const changed = lastBotState?.phase !== state.phase || lastBotState?.active !== state.active;
        lastBotState = state;
        if (!changed) return;
        notify('fallen-heaven:bot-state', state);
        notify('fallen-heaven:notify', {
          message: state.message,
          tone: active ? 'success' : 'info',
          key: 'bot-lifecycle',
          replace: true
        });
      } catch {
        /* Server nicht erreichbar: beim naechsten Tick erneut versuchen. */
      }
    };
    void tick();
    pollTimer = window.setInterval(tick, 15000);
  };

  // Roher Zugriff auf die API. Liefert bewusst {ok,status,data}, weil
  // localApiRequest() in desktop/main.cjs genau diese Form zurueckgibt und der
  // Renderer sich darauf verlässt.
  const rawFetch = async (apiPath, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    const headers = { 'x-fallen-heaven-app': 'web-client-v1' };
    const token = readToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    let body;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    const controller = new AbortController();
    const timeoutMs = Math.min(120000, Math.max(5000, Number(options.timeoutMs || 30000)));
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${baseUrl}${apiPath}`, {
        method,
        headers,
        body,
        credentials: 'include',
        signal: controller.signal
      });

      let data = null;
      const text = await response.text();
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = { error: text };
        }
      }

      if (response.status === 401 && readToken()) {
        // Sitzung abgelaufen: Token loeschen, damit die UI zur Anmeldung
        // zurueckkehrt statt dauerhaft 401 zu pollen.
        writeStored(STORAGE_TOKEN, '');
        writeStored(STORAGE_USER, '');
        clearPoll();
        notify('fallen-heaven:session-expired', {});
      }

      return { ok: response.ok, status: response.status, data };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        data: { error: error?.name === 'AbortError' ? 'Zeitüberschreitung.' : 'Server nicht erreichbar.' }
      };
    } finally {
      window.clearTimeout(timeout);
    }
  };

  const desktopOnly = (message) => async () => ({ ok: false, message });

  const waitForNativeSession = async (transactionId, verifier, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = await rawFetch('/api/auth/native/status', {
        method: 'POST',
        body: { transactionId, verifier },
        timeoutMs: 10000
      });

      if (status.status === 403 || status.status === 410) {
        return { ok: false, message: status.data?.error || 'Die Anmeldung konnte nicht abgeschlossen werden.' };
      }

      if (status.ok && status.data?.status === 'complete') {
        return { ok: true, data: status.data };
      }

      await new Promise((resolve) => window.setTimeout(resolve, 1500));
    }

    return { ok: false, message: 'Die Anmeldung wurde nicht rechtzeitig abgeschlossen.' };
  };

  const storeSession = (data) => {
    const token = String(data?.sessionToken || '');
    if (!token) return false;
    writeStored(STORAGE_TOKEN, token);
    if (data?.user) writeStored(STORAGE_USER, JSON.stringify(data.user));
    const expiresAt = Number(data?.expiresAt || 0) * 1000;
    const renewIn = Number.isFinite(expiresAt)
      ? Math.max(60000, expiresAt - Date.now() - SESSION_RENEWAL_WINDOW_MS)
      : 24 * 60 * 60 * 1000;
    window.setTimeout(() => {
      void ensureSession().then((ok) => {
        if (ok) startPolling();
      });
    }, renewIn);
    startPolling();
    return true;
  };

  const ensureSession = async () => {
    const me = await rawFetch('/api/auth/me', { method: 'GET', timeoutMs: 12000 });
    if (me.status === 200) {
      const user = me.data?.user || me.data || null;
      if (user) writeStored(STORAGE_USER, JSON.stringify(user));
      startPolling();
      return true;
    }

    // Es gibt bewusst keine Refresh-Route: rawFetch hat einen 401 bereits
    // behandelt und den gespeicherten Token geloescht. Hier bleibt nur der
    // Rueckfall in die Anmeldung.
    clearPoll();
    return false;
  };

  const loginDiscord = async () => {
    if (oauthPollTimer !== null) {
      window.clearTimeout(oauthPollTimer);
      oauthPollTimer = null;
    }

    const started = await rawFetch('/api/auth/native/start', { method: 'POST', body: {}, timeoutMs: 12000 });
    if (!started.ok) {
      return { ok: false, message: started.data?.error || 'Discord-Anmeldung konnte nicht vorbereitet werden.' };
    }

    const { transactionId, verifier, authorizeUrl } = started.data || {};
    if (!transactionId || !verifier || !String(authorizeUrl || '').startsWith('https://')) {
      return { ok: false, message: 'Der Server hat eine ungültige Anmeldeanfrage geliefert.' };
    }

    // Discord verbietet OAuth in eingebetteten WebViews, deshalb wird der
    // Systembrowser bzw. ein Browser-Tab geoeffnet - genau wie am Desktop.
    const opened = window.open(String(authorizeUrl), '_blank', 'noopener');
    if (!opened) {
      return {
        ok: false,
        message: 'Der Anmelde-Tab wurde vom Browser blockiert. Popups erlauben und erneut versuchen.'
      };
    }

    notify('fallen-heaven:notify', {
      message: 'Anmeldung in Discord abschließen, danach hier fortfahren.',
      tone: 'info',
      key: 'oauth',
      replace: true
    });

    const result = await waitForNativeSession(transactionId, verifier, 180000);
    if (!result.ok) {
      notify('fallen-heaven:notify', { message: result.message, tone: 'error', key: 'oauth', replace: true });
      return result;
    }

    storeSession(result.data);
    await rawFetch('/api/auth/native/consume', { method: 'POST', body: { transactionId, verifier } }).catch(() => {});
    notify('fallen-heaven:session-established', { user: readUser() });
    return { ok: true, user: readUser() };
  };

  const logoutDiscord = async () => {
    await rawFetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
    writeStored(STORAGE_TOKEN, '');
    writeStored(STORAGE_USER, '');
    lastBotState = null;
    clearPoll();
    notify('fallen-heaven:session-cleared', {});
    return { ok: true };
  };

  window.fallenHeaven = {
    apiRequest: async (options = {}) => {
      const path = String(options.path || '/');
      if (!path.startsWith('/api/')) {
        return { ok: false, status: 400, data: { error: 'Ungültiger API-Pfad.' } };
      }
      return rawFetch(path, options);
    },

    controlBot: async (action) => {
      const verb = action === 'status' ? 'GET' : 'POST';
      const result = await rawFetch(`/api/system/${action}`, { method: verb, timeoutMs: 45000 });
      const body = result.data || {};
      if (!result.ok) {
        return {
          ok: false,
          active: false,
          ready: false,
          output: body.error || body.message || 'Systembefehl fehlgeschlagen.'
        };
      }
      // Nach 'stop' ist running bewusst null, weil der Befehl asynchron
      // nachläuft - deshalb gilt dann ausdrücklich 'gestoppt'.
      const active = action === 'stop' ? false : body.running === true;
      return {
        ok: true,
        active,
        ready: active,
        output: body.message || body.output || 'Systemsteuerung ausgeführt.'
      };
    },

    loginDiscord,
    logoutDiscord,

    onBotState: (callback) => {
      if (typeof callback !== 'function') return () => {};
      // Wichtig: runtime-state.js laesst sich selbst ueber genau dieses Event
      // benachrichtigen. Wuerde die Bridge das Event sofort wieder ausloesen,
      // entstuende eine Endlos-Rekursion. Deshalb wird der aktuelle Zustand
      // direkt uebergeben und nur bei echter Aenderung erneut gesendet.
      const listener = (event) => {
        const next = event.detail || {};
        const unchanged = lastBotState
          && lastBotState.phase === next.phase
          && lastBotState.active === next.active;
        lastBotState = next;
        if (unchanged) return;
        callback(next);
      };
      window.addEventListener('fallen-heaven:bot-state', listener);
      startPolling();
      return () => window.removeEventListener('fallen-heaven:bot-state', listener);
    },

    onBotEvent: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const listener = (event) => callback(event.detail || []);
      window.addEventListener('fallen-heaven:discord-events', listener);
      return () => window.removeEventListener('fallen-heaven:discord-events', listener);
    },

    getBotState: async () => lastBotState || { active: false, ready: false, phase: 'stopped', message: 'Bot ist gestoppt.' },
    getSecretStatus: async () => ({ ok: true, discordToken: true, discordClientId: true, discordClientSecret: true }),

    getInfo: async () => ({
      ok: true,
      version: document.documentElement.dataset.appVersion || '',
      platform: 'web',
      mobile: true,
      apiBase: baseUrl
    }),

    getLogs: async () => ({ ok: true, lines: ['Web-Client: Das vollständige Protokoll liegt am Desktop.'], logFile: '' }),
    getDiagnostics: async () => ({ ok: true, message: 'Diagnose wird vom Server geliefert.' }),
    getLiveDiagnostics: async () => {
      const result = await rawFetch('/api/app/diagnostics', { method: 'GET', timeoutMs: 20000 });
      return result.ok ? { ok: true, data: result.data } : { ok: false, error: result.data?.error };
    },
    exportDiagnostics: async () => ({ ok: false, error: 'Export ist nur am Desktop verfügbar.' }),

    checkUpdate: async () => ({ ok: false, message: 'App-Updates laufen am Desktop.' }),
    installUpdate: desktopOnly('Updates werden am Desktop ausgeführt.'),
    onUpdateProgress: () => () => {},
    onUpdateAvailable: () => () => {},
    getUpdateSettings: async () => ({ ok: false }),
    setUpdateSettings: desktopOnly('Update-Einstellungen gibt es nur am Desktop.'),
    getUpdateSource: async () => ({ ok: false }),
    setUpdateSource: desktopOnly('Update-Quelle wird am Desktop verwaltet.'),
    setUpdateToken: desktopOnly('Das Update-Token bleibt am Desktop.'),
    clearUpdateToken: desktopOnly('Das Update-Token bleibt am Desktop.'),
    testUpdateChannel: desktopOnly('Der Update-Kanal wird am Desktop geprüft.'),
    openUpdateFolder: desktopOnly('Der Update-Ordner liegt am Desktop.'),

    getStartupMode: async () => ({ ok: false }),
    setStartupMode: desktopOnly('Das Startverhalten wird am Desktop gesteuert.'),

    // Unter Android gibt es kein Electron-Fenster fuer die Einrichtung.
    // Die App stellt stattdessen FHNative bereit, das die Werte im
    // Android-Keystore ablegt.
    saveCredentials: async (payload = {}) => {
      const native = window.FHNative;
      if (typeof native?.fhNative !== 'function') {
        return { ok: false, message: 'Zugangsdaten werden nur in der Android-App gespeichert.' };
      }
      try {
        const response = JSON.parse(native.fhNative('setup.save', JSON.stringify({
          token: payload?.token ?? payload?.discordToken ?? '',
          clientId: payload?.clientId ?? payload?.discordClientId ?? '',
          clientSecret: payload?.clientSecret ?? payload?.discordClientSecret ?? ''
        })));
        notify('fallen-heaven:setup-saved', { ok: response?.ok === true });
        return response?.ok === true
          ? { ok: true }
          : { ok: false, message: response?.error || 'Zugangsdaten konnten nicht gespeichert werden.' };
      } catch (error) {
        return { ok: false, message: String(error?.message || error) };
      }
    },

    deleteBotToken: async () => {
      const native = window.FHNative;
      if (typeof native?.fhNative !== 'function') {
        return { ok: false, message: 'Das Bot-Token kann nur in der Android-App geloescht werden.' };
      }
      try {
        const response = JSON.parse(native.fhNative('setup.clear', '{}'));
        return response?.ok === true ? { ok: true } : { ok: false, message: response?.error };
      } catch (error) {
        return { ok: false, message: String(error?.message || error) };
      }
    },

    // Wird von der Oberflaeche abgefragt, um die native Einrichtung anzuzeigen.
    nativeSetupStatus: async () => {
      const native = window.FHNative;
      if (typeof native?.fhNative !== 'function') {
        return { ok: false, available: false };
      }
      try {
        const status = JSON.parse(native.fhNative('setup.status', '{}'));
        return {
          ok: true,
          available: true,
          configured: status?.configured === true,
          hasRuntime: native.fhHasRuntime?.() === true,
          termuxInstalled: native.fhTermuxInstalled?.() === true
        };
      } catch {
        return { ok: false, available: false };
      }
    },

    openDataFolder: desktopOnly('Datenordner öffnen ist nur am Desktop möglich.'),
    openLogFolder: desktopOnly('Logordner öffnen ist nur am Desktop möglich.'),
    openMain: async () => true,

    onThemeChanged: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const query = window.matchMedia('(prefers-color-scheme: light)');
      const listener = () => callback(query.matches ? 'light' : 'dark');
      query.addEventListener('change', listener);
      return () => query.removeEventListener('change', listener);
    },

    onCloseRequested: () => () => {},
    confirmClose: () => {},

    openExternal: async (url) => {
      const target = String(url || '');
      if (!/^https?:\/\//i.test(target)) return false;
      window.open(target, '_blank', 'noopener');
      return true;
    },

    // Fenstersteuerung gibt es auf dem Telefon nicht. Die Titelbar wird per
    // CSS ausgeblendet, die Aufrufe sind hier bewusst wirkungslos.
    minimize: () => {},
    maximize: () => {},
    close: () => {},

    status: async () => rawFetch('/api/system/status', { method: 'GET' }),
    diagnostics: async () => rawFetch('/api/app/diagnostics', { method: 'GET' }),
    importPortableBackup: desktopOnly('Backups werden am Desktop verwaltet.'),
    exportPortableBackup: desktopOnly('Backups werden am Desktop verwaltet.')
  };

  const bootstrap = async () => {
    const active = await ensureSession();
    notify('fallen-heaven:bridge-ready', { mobile: true, authenticated: active, baseUrl });
    if (active) notify('fallen-heaven:session-established', { user: readUser() });
  };

  void bootstrap();
})();
