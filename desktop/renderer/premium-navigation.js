(function premiumNavigation() {
  'use strict';

  const menus = [];
  let outsideBound = false;

  function findPanel(target) {
    let node = target.parentElement;
    while (node && node !== document.body && !node.matches('header, nav')) {
      const count = node.querySelectorAll('[data-public-target]').length;
      if (count >= 2) return node;
      node = node.parentElement;
    }
    return target.closest('[class*="dropdown"], [class*="menu"], [class*="popover"], [class*="mega"]');
  }

  function setOpen(menu, open) {
    if (!menu) return;
    menus.forEach((entry) => {
      const active = entry === menu && open;
      entry.wrapper.classList.toggle('fh-menu-open', active);
      entry.panel.classList.toggle('fh-menu-open', active);
      entry.trigger.classList.toggle('fh-menu-open', active);
      entry.trigger.setAttribute('aria-expanded', String(active));
    });
    document.body.classList.toggle('fh-nav-expanded', Boolean(open));
  }

  function closeAll(lockSelection = false) {
    menus.forEach((entry) => {
      clearTimeout(entry.timer);
      entry.wrapper.classList.remove('fh-menu-open');
      entry.panel.classList.remove('fh-menu-open');
      entry.trigger.classList.remove('fh-menu-open');
      entry.trigger.setAttribute('aria-expanded', 'false');
      if (lockSelection) {
        entry.panel.classList.add('fh-force-closed');
        entry.wrapper.addEventListener('pointerleave', () => entry.panel.classList.remove('fh-force-closed'), { once: true });
      }
    });
    document.body.classList.remove('fh-nav-expanded');
  }

  function setup() {
    // Navigation upgrades belong exclusively to the public header. Feature cards,
    // hero actions and the sign-in scene also use data-public-target and must
    // never be converted into hidden dropdown panels.
    const publicNavigation = document.querySelector('.public-nav');
    if (!publicNavigation) return;
    const panels = [...publicNavigation.querySelectorAll('.nav_dd_list')];
    panels.forEach((panel, index) => {
      if (panel.dataset.fhPremiumMenu) return;
      const wrapper = panel.parentElement;
      if (!wrapper) return;
      const siblings = [...wrapper.children];
      let trigger = siblings.find((child) => child !== panel && child.matches('button, a'));
      if (!trigger) trigger = wrapper.querySelector('button:not([data-public-target]), a:not([data-public-target])');
      if (!trigger) return;
      const firstKey = panel.querySelector('[data-public-target]')?.dataset.publicTarget || ('menu-' + index);
      const menu = { panel, wrapper, trigger, timer: null };
      panel.dataset.fhPremiumMenu = firstKey;
      panel.classList.add('fh-premium-nav-panel');
      wrapper.classList.add('fh-premium-nav-item');
      wrapper.dataset.fhMenu = firstKey;
      trigger.classList.add('fh-premium-nav-trigger');
      trigger.setAttribute('aria-haspopup', 'menu');
      trigger.setAttribute('aria-expanded', 'false');
      panel.setAttribute('role', 'menu');
      panel.querySelectorAll('[data-public-target]').forEach((item) => item.setAttribute('role', 'menuitem'));
      trigger.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        setOpen(menu, !wrapper.classList.contains('fh-menu-open'));
      });
      wrapper.addEventListener('pointerenter', () => {
        clearTimeout(menu.timer);
        panel.classList.remove('fh-force-closed');
        setOpen(menu, true);
      });
      wrapper.addEventListener('pointerleave', () => {
        menu.timer = setTimeout(() => setOpen(menu, false), 180);
      });
      panel.addEventListener('pointerenter', () => clearTimeout(menu.timer));
      menus.push(menu);
    });

    if (!outsideBound) {
      document.addEventListener('click', (event) => {
        if (!event.target.closest('.fh-premium-nav-item')) closeAll();
      });
      document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeAll(); });
      outsideBound = true;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();

  window.FHNavigation = { setup, closeAll };
})();
