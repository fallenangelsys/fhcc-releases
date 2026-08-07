(() => {
  const bridge = window.fallenHeaven;
  if (!bridge?.getBotState || !bridge?.onBotState) return;

  const style = document.createElement('style');
  style.textContent = `
    #fh-runtime-feedback{position:fixed;right:24px;bottom:24px;z-index:100000;display:flex;align-items:center;gap:12px;max-width:420px;padding:14px 18px;border:1px solid rgba(255,255,255,.15);border-radius:16px;background:rgba(15,16,28,.94);color:#fff;box-shadow:0 18px 60px rgba(0,0,0,.38);backdrop-filter:blur(18px);font:600 14px/1.35 "gg sans",sans-serif;opacity:0;transform:translateY(12px);pointer-events:none;transition:opacity .2s ease,transform .2s ease}
    #fh-runtime-feedback[data-visible="true"]{opacity:1;transform:translateY(0)}
    #fh-runtime-feedback .fh-runtime-dot{width:10px;height:10px;border-radius:50%;background:#8b90a7;box-shadow:0 0 0 5px rgba(139,144,167,.12);flex:none}
    #fh-runtime-feedback[data-phase="running"] .fh-runtime-dot{background:#3ee6a3;box-shadow:0 0 0 5px rgba(62,230,163,.13)}
    #fh-runtime-feedback[data-phase="starting"] .fh-runtime-dot,#fh-runtime-feedback[data-phase="stopping"] .fh-runtime-dot{background:#ffd166;animation:fh-runtime-pulse .8s ease-in-out infinite alternate}
    #fh-runtime-feedback[data-phase="error"] .fh-runtime-dot{background:#ff647c;box-shadow:0 0 0 5px rgba(255,100,124,.13)}
    [data-bot-action][aria-busy="true"]{pointer-events:none;opacity:.62}
    @keyframes fh-runtime-pulse{to{transform:scale(1.35);opacity:.55}}
  `;
  document.head.appendChild(style);

  let hideTimer = null;
  let lastAnnouncementKey = '';

  function announce(phase, message, duration) {
    clearTimeout(hideTimer);
    window.dispatchEvent(new CustomEvent('fallen-heaven:notify', {
      detail: {
        message,
        phase,
        tone: phase === 'error' ? 'error' : (phase === 'running' ? 'success' : 'info'),
        duration: duration || (phase === 'error' ? 6000 : 3200),
        key: 'bot-lifecycle',
        replace: true
      }
    }));
  }

  function render(state = {}, shouldAnnounce = true) {
    const phase = state.phase || (state.active ? 'running' : 'stopped');
    const message = state.message || (state.active ? 'Bot ist aktiv.' : 'Bot ist gestoppt.');
    document.querySelectorAll('[data-bot-state],[data-runtime-state]').forEach((element) => {
      element.dataset.phase = phase;
      element.dataset.active = String(Boolean(state.active));
      if (element.hasAttribute('data-bot-state-text')) element.textContent = message;
    });

    if (state.metrics) {
      const megabytes = Math.round(Number(state.metrics.rssBytes || 0) / 1024 / 1024);
      document.querySelectorAll('[data-bot-memory]').forEach((element) => { element.textContent = `${megabytes} MB`; });
      document.querySelectorAll('[data-bot-cpu]').forEach((element) => { element.textContent = `${Number(state.metrics.cpuPercent || 0).toFixed(1)} %`; });
      document.querySelectorAll('[data-bot-uptime]').forEach((element) => { element.textContent = `${Math.floor(Number(state.metrics.uptimeSeconds || 0) / 60)} min`; });
    }

    const busy = phase === 'starting' || phase === 'stopping';
    document.querySelectorAll('[data-bot-action]').forEach((button) => button.setAttribute('aria-busy', String(busy)));
    window.fallenHeavenState?.update({ bot: state });
    window.dispatchEvent(new CustomEvent('fallen-heaven:bot-state', { detail: state }));

    const announcementKey = `${phase}|${message}`;
    const changed = announcementKey !== lastAnnouncementKey;
    lastAnnouncementKey = announcementKey;
    if (shouldAnnounce && changed) announce(phase, message);
  }

  bridge.getBotState().then((state) => render(state, false)).catch(() => {});
  bridge.getSecretStatus?.().then((status) => {
    window.fallenHeavenState?.update({ secrets: status });
    window.dispatchEvent(new CustomEvent('fallen-heaven:secret-status', { detail: status }));
    if (!status?.discordToken || !status?.discordClientId || !status?.discordClientSecret) {
      announce('error', 'Discord-Konfiguration unvollständig. Token und OAuth-Daten prüfen.');
    }
  }).catch(() => {});
  bridge.onBotState((state) => render(state, true));
  if (bridge.onBotEvent) {
    bridge.onBotEvent((events) => {
      window.dispatchEvent(new CustomEvent('fallen-heaven:discord-events', { detail: Array.isArray(events) ? events : [] }));
    });
  }
})();
