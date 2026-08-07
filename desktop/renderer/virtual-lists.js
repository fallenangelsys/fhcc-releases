(function initializeFallenHeavenVirtualLists() {
  'use strict';

  const MIN_VIRTUAL_ROWS = 80;
  const OVERSCAN_ROWS = 10;
  const MAX_SCAN_DEPTH = 5;
  const controllers = new Map();
  const deferredLists = new WeakSet();
  const pendingCandidates = new Set();
  let scanScheduled = false;
  let fallbackTimer = null;

  const style = document.createElement('style');
  style.id = 'fallen-heaven-virtual-list-styles';
  style.textContent = `
    [data-fh-deferred-list="true"] > * {
      content-visibility: auto;
      contain-intrinsic-size: auto var(--fh-row-estimate, 64px);
    }
    [data-fh-virtual-list="true"] {
      overflow-anchor: none;
      contain: layout style;
    }
    .fh-virtual-spacer {
      display: block !important;
      width: 100% !important;
      min-width: 100% !important;
      max-width: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      pointer-events: none !important;
      visibility: hidden !important;
      flex: 0 0 auto !important;
    }
  `;
  document.head.appendChild(style);

  const isElement = (value) => value instanceof Element;
  const isScrollable = (element) => {
    if (!isElement(element) || element.clientHeight < 120) return false;
    const styles = getComputedStyle(element);
    return /(auto|scroll|overlay)/.test(styles.overflowY)
      && element.scrollHeight > element.clientHeight + 24;
  };

  const findScrollHost = (list) => {
    let current = list;
    for (let depth = 0; current && depth <= MAX_SCAN_DEPTH; depth += 1) {
      if (isScrollable(current)) return current;
      current = current.parentElement;
    }
    return null;
  };

  const listChildren = (list) => Array.from(list.children).filter((child) => !child.classList.contains('fh-virtual-spacer'));
  const measureList = (list, host) => {
    const children = listChildren(list);
    if (children.length < MIN_VIRTUAL_ROWS) return null;
    const samples = children.slice(0, Math.min(12, children.length));
    const rects = samples.map((child) => child.getBoundingClientRect()).filter((rect) => rect.height >= 18 && rect.width >= 20);
    if (rects.length < 4) return null;
    const heights = rects.map((rect) => rect.height);
    const minimum = Math.min(...heights);
    const maximum = Math.max(...heights);
    const average = heights.reduce((sum, value) => sum + value, 0) / heights.length;
    const listWidth = Math.max(1, list.getBoundingClientRect().width);
    const fullWidthRows = rects.filter((rect) => rect.width >= listWidth * 0.68).length >= Math.ceil(rects.length * 0.8);
    const offsets = samples.slice(0, 4).map((child) => child.offsetTop);
    const vertical = offsets.slice(1).every((offset, index) => offset > offsets[index]);
    const rowGap = Math.max(0, Number.parseFloat(getComputedStyle(list).rowGap || '0') || 0);
    return {
      uniform: maximum / Math.max(1, minimum) <= 1.45,
      fullWidthRows,
      vertical,
      rowHeight: Math.max(18, average + rowGap),
      hostHeight: host.clientHeight
    };
  };

  const createSpacer = (list, position) => {
    const tagName = /^(UL|OL)$/.test(list.tagName) ? 'li' : 'div';
    const spacer = document.createElement(tagName);
    spacer.className = `fh-virtual-spacer fh-virtual-spacer-${position}`;
    spacer.setAttribute('aria-hidden', 'true');
    spacer.dataset.fhVirtualSpacer = position;
    return spacer;
  };

  class VirtualListController {
    constructor(list, host, measurement, options = {}) {
      this.list = list;
      this.host = host;
      this.rowHeight = Number(options.rowHeight || measurement.rowHeight || 56);
      this.overscan = Number(options.overscan || OVERSCAN_ROWS);
      this.items = listChildren(list);
      this.topSpacer = createSpacer(list, 'top');
      this.bottomSpacer = createSpacer(list, 'bottom');
      this.start = -1;
      this.end = -1;
      this.frame = 0;
      this.destroyed = false;
      this.handleScroll = () => this.scheduleRender();
      this.handleResize = () => {
        this.start = -1;
        this.scheduleRender();
      };
      this.resizeObserver = new ResizeObserver(this.handleResize);
      list.dataset.fhVirtualList = 'true';
      list.setAttribute('aria-rowcount', String(this.items.length));
      host.addEventListener('scroll', this.handleScroll, { passive: true });
      this.resizeObserver.observe(host);
      this.render(true);
    }

    get listTop() {
      if (this.host === this.list) return 0;
      const listRect = this.list.getBoundingClientRect();
      const hostRect = this.host.getBoundingClientRect();
      return listRect.top - hostRect.top + this.host.scrollTop;
    }

    calculateWindow() {
      const localScroll = Math.max(0, this.host.scrollTop - this.listTop);
      let start = Math.max(0, Math.floor(localScroll / this.rowHeight) - this.overscan);
      let end = Math.min(this.items.length, start + Math.ceil(this.host.clientHeight / this.rowHeight) + this.overscan * 2);
      const focused = document.activeElement;
      const focusedIndex = focused ? this.items.findIndex((item) => item === focused || item.contains(focused)) : -1;
      if (focusedIndex >= 0 && (focusedIndex < start || focusedIndex >= end)) {
        start = Math.min(start, focusedIndex);
        end = Math.max(end, focusedIndex + 1);
      }
      return { start, end };
    }

    scheduleRender() {
      if (this.destroyed || this.frame) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.render();
      });
    }

    render(force = false) {
      if (this.destroyed || !this.list.isConnected || !this.host.isConnected) return;
      const { start, end } = this.calculateWindow();
      if (!force && start === this.start && end === this.end) return;
      this.start = start;
      this.end = end;
      this.topSpacer.style.height = `${Math.max(0, start * this.rowHeight)}px`;
      this.bottomSpacer.style.height = `${Math.max(0, (this.items.length - end) * this.rowHeight)}px`;
      const fragment = document.createDocumentFragment();
      fragment.append(this.topSpacer);
      for (let index = start; index < end; index += 1) fragment.append(this.items[index]);
      fragment.append(this.bottomSpacer);
      this.list.replaceChildren(fragment);
      this.list.setAttribute('aria-rowcount', String(this.items.length));
      this.publish();
    }

    isInternalStructure() {
      const children = Array.from(this.list.children);
      if (children[0] !== this.topSpacer || children.at(-1) !== this.bottomSpacer) return false;
      const visible = children.slice(1, -1);
      if (visible.length !== Math.max(0, this.end - this.start)) return false;
      return visible.every((child, index) => child === this.items[this.start + index]);
    }

    acceptExternalRender() {
      if (this.destroyed || this.isInternalStructure()) return;
      const freshItems = listChildren(this.list);
      if (freshItems.length < MIN_VIRTUAL_ROWS) {
        this.destroy(false);
        return;
      }
      this.items = freshItems;
      this.start = -1;
      this.end = -1;
      this.render(true);
    }

    append(nodes) {
      const fresh = Array.from(nodes || []).filter(isElement);
      if (!fresh.length) return;
      this.items.push(...fresh);
      this.start = -1;
      this.render(true);
    }

    setItems(nodes, { preserveScroll = true } = {}) {
      const anchor = preserveScroll ? this.items[this.start]?.dataset?.id || this.items[this.start]?.id || null : null;
      const previousTop = this.host.scrollTop;
      this.items = Array.from(nodes || []).filter(isElement);
      this.start = -1;
      this.render(true);
      if (preserveScroll) {
        const anchorIndex = anchor ? this.items.findIndex((item) => item.dataset?.id === anchor || item.id === anchor) : -1;
        this.host.scrollTop = anchorIndex >= 0 ? Math.max(0, this.listTop + anchorIndex * this.rowHeight) : previousTop;
      }
    }

    publish() {
      document.dispatchEvent(new CustomEvent('fallen-heaven:virtual-list-update', {
        detail: { total: this.items.length, rendered: Math.max(0, this.end - this.start), start: this.start, end: this.end }
      }));
    }

    destroy(restore = true) {
      if (this.destroyed) return;
      this.destroyed = true;
      if (this.frame) cancelAnimationFrame(this.frame);
      this.host.removeEventListener('scroll', this.handleScroll);
      this.resizeObserver.disconnect();
      controllers.delete(this.list);
      delete this.list.dataset.fhVirtualList;
      this.list.removeAttribute('aria-rowcount');
      if (restore && this.list.isConnected) this.list.replaceChildren(...this.items);
    }
  }

  const applyDeferredRendering = (list, rowHeight = 72) => {
    if (deferredLists.has(list)) return;
    deferredLists.add(list);
    list.dataset.fhDeferredList = 'true';
    list.style.setProperty('--fh-row-estimate', `${Math.max(24, Math.round(rowHeight))}px`);
  };

  const considerList = (list) => {
    if (!isElement(list) || controllers.has(list) || deferredLists.has(list)) return;
    if (!/^(DIV|UL|OL|TBODY)$/.test(list.tagName)) return;
    if (list.closest('[contenteditable="true"], select, datalist, head')) return;
    if (list.children.length < MIN_VIRTUAL_ROWS) return;
    const host = findScrollHost(list);
    if (!host) return;
    const measurement = measureList(list, host);
    if (!measurement) return;
    if (list.tagName !== 'TBODY' && measurement.uniform && measurement.fullWidthRows && measurement.vertical) {
      controllers.set(list, new VirtualListController(list, host, measurement));
    } else {
      applyDeferredRendering(list, measurement.rowHeight);
    }
  };

  const collectCandidates = (root) => {
    if (!isElement(root) && root !== document) return;
    if (isElement(root)) {
      pendingCandidates.add(root);
      let ancestor = root.parentElement;
      for (let depth = 0; ancestor && depth < MAX_SCAN_DEPTH; depth += 1) {
        pendingCandidates.add(ancestor);
        ancestor = ancestor.parentElement;
      }
    }
    const scope = root === document ? document.body : root;
    scope?.querySelectorAll?.('div, ul, ol, tbody').forEach((element) => {
      if (element.children.length >= MIN_VIRTUAL_ROWS) pendingCandidates.add(element);
    });
    scheduleCandidateScan();
  };

  const runCandidateScan = () => {
    scanScheduled = false;
    const started = performance.now();
    for (const candidate of [...pendingCandidates]) {
      pendingCandidates.delete(candidate);
      if (candidate.isConnected) considerList(candidate);
      if (performance.now() - started > 8) {
        scheduleCandidateScan();
        break;
      }
    }
  };

  function scheduleCandidateScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    if ('requestIdleCallback' in window) requestIdleCallback(runCandidateScan, { timeout: 220 });
    else setTimeout(runCandidateScan, 32);
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      const controller = controllers.get(mutation.target);
      if (controller) {
        controller.acceptExternalRender();
        continue;
      }
      for (const node of mutation.addedNodes) if (isElement(node)) collectCandidates(node);
      if (isElement(mutation.target) && mutation.target.children.length >= MIN_VIRTUAL_ROWS) pendingCandidates.add(mutation.target);
    }
    scheduleCandidateScan();
  });

  const refresh = () => {
    for (const [list, controller] of controllers) {
      if (!list.isConnected) controller.destroy(false);
      else controller.scheduleRender();
    }
    collectCandidates(document);
  };

  const stats = () => ({
    virtualLists: controllers.size,
    deferredLists: document.querySelectorAll('[data-fh-deferred-list="true"]').length,
    totalRows: [...controllers.values()].reduce((sum, controller) => sum + controller.items.length, 0),
    renderedRows: [...controllers.values()].reduce((sum, controller) => sum + Math.max(0, controller.end - controller.start), 0)
  });

  const start = () => {
    observer.observe(document.body, { childList: true, subtree: true });
    collectCandidates(document);
    const jobs = window.fallenHeavenJobs || window.FallenHeavenJobs;
    if (jobs?.upsert) {
      jobs.upsert({ id: 'ui-virtual-list-maintenance', intervalMs: 5000, pauseWhenHidden: true, run: refresh });
    } else {
      fallbackTimer = setInterval(refresh, 5000);
    }
  };

  window.FallenHeavenVirtualLists = Object.freeze({
    observe: collectCandidates,
    refresh,
    stats,
    virtualize(list, options = {}) {
      const host = options.host || findScrollHost(list);
      const measurement = host && measureList(list, host);
      if (!host || !measurement) return null;
      const controller = new VirtualListController(list, host, measurement, options);
      controllers.set(list, controller);
      return controller;
    },
    destroyAll() {
      observer.disconnect();
      if (fallbackTimer) clearInterval(fallbackTimer);
      for (const controller of [...controllers.values()]) controller.destroy(true);
    }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
