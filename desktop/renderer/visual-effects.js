(() => {
  'use strict';

  const body = document.body;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // Keep the operating-system cursor untouched. Motion is limited to short,
  // functional view transitions and never follows the pointer.
  body.classList.remove('cursor-active', 'cursor-hover', 'cursor-down');
  document.querySelectorAll('.fh-cursor-dot, .fh-cursor-aura').forEach((node) => node.remove());

  const glowTargets = [
    '.command-card', '.metric-card', '.quick-card', '.timeline-card',
    '.history-card', '.form-section', '.system-health-card',
    '.system-data-panel', '.log-panel', '.editor-panel',
    '.app-editor-preview', '.community-shell', '.module-list',
    '.module-detail', '.studio-compose-panel', '.studio-preview-panel'
  ].join(',');

  function enhanceSurfaces(root = document) {
    const nodes = [];
    if (root.nodeType === 1 && root.matches?.(glowTargets)) nodes.push(root);
    root.querySelectorAll?.(glowTargets).forEach((node) => nodes.push(node));
    nodes.forEach((node) => node.classList.add('fh-glow-card'));
  }

  function revealActiveView() {
    if (reduceMotion.matches) return;
    const view = document.querySelector('.view.active');
    if (!view) return;
    const targets = Array.from(view.querySelectorAll('.page-head, .dashboard-grid > *, .community-shell > *, .module-layout > *, .studio-shell > *, .system-workspace > *, .editor-workspace > *')).slice(0, 18);
    targets.forEach((node, index) => {
      node.classList.remove('fh-reveal-visible');
      node.classList.add('fh-reveal');
      node.style.setProperty('--reveal-delay', `${Math.min(index * 32, 190)}ms`);
    });
    requestAnimationFrame(() => requestAnimationFrame(() => targets.forEach((node) => node.classList.add('fh-reveal-visible'))));
  }

  enhanceSurfaces();

  // A soft light reacts directly under the native pointer. There is no custom
  // cursor and no delayed trail.
  document.addEventListener('pointermove', (event) => {
    if (reduceMotion.matches) return;
    const access = event.target.closest?.('#access-scene');
    if (access) {
      const rect = access.getBoundingClientRect();
      access.style.setProperty('--login-x', `${event.clientX - rect.left}px`);
      access.style.setProperty('--login-y', `${event.clientY - rect.top}px`);
      access.style.setProperty('--ref-mouse-x', `${event.clientX - rect.left}px`);
      access.style.setProperty('--ref-mouse-y', `${event.clientY - rect.top}px`);
    }
    const card = event.target.closest?.('.fh-glow-card');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--card-x', `${event.clientX - rect.left}px`);
    card.style.setProperty('--card-y', `${event.clientY - rect.top}px`);
  }, { passive: true });

  document.addEventListener('fh:view-change', () => {
    if (reduceMotion.matches) return;
    enhanceSurfaces();
    revealActiveView();
    body.classList.remove('view-transitioning');
    requestAnimationFrame(() => {
      body.classList.add('view-transitioning');
      window.setTimeout(() => body.classList.remove('view-transitioning'), 240);
    });
  });

  // Make keyboard navigation visible without changing mouse behavior.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') body.classList.add('using-keyboard');
  });
  document.addEventListener('pointerdown', () => body.classList.remove('using-keyboard'), { passive: true });

  const observer = new MutationObserver((records) => {
    records.forEach((record) => record.addedNodes.forEach((node) => {
      if (node.nodeType === 1) enhanceSurfaces(node);
    }));
  });
  observer.observe(document.body, { childList: true, subtree: true });

  window.setTimeout(() => {
    enhanceSurfaces();
    revealActiveView();
  }, 120);
})();
