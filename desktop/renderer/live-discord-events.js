(() => {
  function selectedChannelElement() {
    const candidates = Array.from(document.querySelectorAll('[data-channel-id]'));
    return candidates.find((element) =>
      element.classList.contains('active') ||
      element.classList.contains('is-active') ||
      element.classList.contains('selected') ||
      element.getAttribute('aria-selected') === 'true'
    ) || null;
  }

  window.addEventListener('fallen-heaven:discord-events', (event) => {
    const events = Array.isArray(event.detail) ? event.detail : [];
    if (!events.length) return;
    window.fallenHeavenState?.update({ discordEvents: events });
    document.dispatchEvent(new CustomEvent('fallen-heaven:data-invalidated', { detail: events }));

    const channelEvents = events.filter((item) => /^(?:channel|thread):(?:create|update|delete)$/.test(String(item?.kind || '')));
    if (channelEvents.length) {
      window.dispatchEvent(new CustomEvent('fallen-heaven:channel-structure-update', { detail: channelEvents }));
    }

    const selected = selectedChannelElement();
    const selectedId = selected?.dataset?.channelId;
    if (!selectedId) return;
    const channelChanged = events.some((item) =>
      String(item?.channelId || '') === String(selectedId) &&
      /^message:(?:create|update|delete)$/.test(String(item?.kind || ''))
    );
    if (!channelChanged) return;

    window.FallenHeavenJobs.debounce('selected-channel-live-update', () => {
      if (!selected.isConnected) return;
      window.dispatchEvent(new CustomEvent('fallen-heaven:channel-live-update', {
        detail: {
          channelId: String(selectedId),
          events: events.filter((item) => String(item?.channelId || '') === String(selectedId))
        }
      }));
    }, 280);
  });
})();
