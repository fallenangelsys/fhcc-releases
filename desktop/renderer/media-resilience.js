(() => {
  const fallbackAvatar = 'assets/fallen-heaven-icon.png';

  function alternateDiscordUrl(raw) {
    try {
      const url = new URL(raw, location.href);
      if (url.hostname === 'media.discordapp.net') url.hostname = 'cdn.discordapp.com';
      else if (url.hostname === 'cdn.discordapp.com') url.hostname = 'media.discordapp.net';
      else return '';
      return url.href;
    } catch { return ''; }
  }

  function prepare(element) {
    if (element.dataset.mediaPrepared === 'true') return;
    element.dataset.mediaPrepared = 'true';
    if (element instanceof HTMLImageElement) {
      element.decoding = 'async';
      if (!element.loading) element.loading = 'lazy';
      element.referrerPolicy = 'no-referrer';
    } else if (element instanceof HTMLVideoElement || element instanceof HTMLAudioElement) {
      element.preload = 'metadata';
    }
  }

  function showMediaFallback(element, source) {
    if (element.parentElement?.querySelector(':scope > .fh-media-fallback')) return;
    const fallback = document.createElement('div');
    fallback.className = 'fh-media-fallback';
    fallback.innerHTML = '<strong>Medium nicht direkt abspielbar</strong><span>Discord-Link extern öffnen oder neu laden.</span>';
    if (source) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Extern öffnen';
      button.addEventListener('click', () => window.fallenHeaven?.openExternal?.(source));
      fallback.appendChild(button);
    }
    element.insertAdjacentElement('afterend', fallback);
  }

  document.addEventListener('error', (event) => {
    const element = event.target;
    if (element instanceof HTMLImageElement) {
      if (element.dataset.mediaRetry !== 'true') {
        const alternate = alternateDiscordUrl(element.currentSrc || element.src);
        if (alternate) {
          element.dataset.mediaRetry = 'true';
          element.src = alternate;
          return;
        }
      }
      if (element.dataset.mediaFallback !== 'true') {
        element.dataset.mediaFallback = 'true';
        element.classList.add('fh-media-broken');
        element.src = element.dataset.fallbackSrc || fallbackAvatar;
      }
    } else if (element instanceof HTMLVideoElement || element instanceof HTMLAudioElement) {
      element.classList.add('fh-media-broken');
      showMediaFallback(element, element.currentSrc || element.src);
    }
  }, true);

  const observer = new MutationObserver((records) => {
    records.forEach((record) => record.addedNodes.forEach((node) => {
      if (!(node instanceof Element)) return;
      if (node.matches('img,video,audio')) prepare(node);
      node.querySelectorAll?.('img,video,audio').forEach(prepare);
    }));
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.querySelectorAll('img,video,audio').forEach(prepare);

  const style = document.createElement('style');
  style.textContent = `
    img.fh-media-broken{object-fit:cover;background:#10111d;filter:saturate(.72)}
    .fh-media-fallback{display:grid;gap:5px;margin-top:8px;padding:12px 14px;border:1px solid rgba(255,255,255,.12);border-radius:13px;background:rgba(9,10,18,.72);color:#eef0ff;font-size:12px}.fh-media-fallback span{color:#9ca2ba}.fh-media-fallback button{justify-self:start;margin-top:5px;border:0;border-radius:9px;padding:7px 10px;background:#5865f2;color:#fff;font-weight:800;cursor:pointer}
  `;
  document.head.appendChild(style);
})();
