(function () {
  'use strict';

  var stateSubscribers = new Set();
  var stateVersion = 0;
  var statePublishQueued = false;
  var legacyState = null;
  var appState = Object.freeze({ version: 0, bot: null, secrets: null, discordEvents: [], jobs: {}, ui: null });

  function snapshotState() {
    return Object.freeze(Object.assign({}, appState, {
      version: stateVersion,
      ui: legacyState ? Object.assign({}, legacyState) : appState.ui
    }));
  }

  function publishState(reason) {
    stateVersion += 1;
    appState = snapshotState();
    stateSubscribers.forEach(function (subscriber) {
      try { subscriber(appState, reason || 'update'); } catch (error) { console.error('[FALLEN HEAVEN State]', error); }
    });
    window.dispatchEvent(new CustomEvent('fallen-heaven:state-changed', { detail: { state: appState, reason: reason || 'update' } }));
    return appState;
  }

  function queueStatePublish(reason) {
    if (statePublishQueued) return;
    statePublishQueued = true;
    queueMicrotask(function () {
      statePublishQueued = false;
      publishState(reason || 'ui');
    });
  }

  function updateState(patch, reason) {
    appState = Object.freeze(Object.assign({}, appState, patch || {}));
    return publishState(reason || 'patch');
  }

  function bindLegacyState(reference) {
    if (!reference || typeof reference !== 'object' || legacyState === reference) return reference;
    legacyState = reference;
    Object.keys(reference).forEach(function (key) {
      var value = reference[key];
      try {
        Object.defineProperty(reference, key, {
          enumerable: true,
          configurable: true,
          get: function () { return value; },
          set: function (nextValue) {
            if (Object.is(value, nextValue)) return;
            value = nextValue;
            queueStatePublish('ui:' + key);
          }
        });
      } catch (_) {}
    });
    updateState({ ui: reference }, 'ui:bound');
    return reference;
  }

  var jobRegistry = new Map();
  var oneShotJobs = new Map();

  function serializeJob(job) {
    return {
      name: job.name,
      kind: job.kind,
      enabled: job.enabled !== false,
      running: Boolean(job.running),
      paused: Boolean(job.paused),
      runs: Number(job.runs || 0),
      failures: Number(job.failures || 0),
      lastDuration: Number(job.lastDuration || 0),
      lastRunAt: job.lastRunAt || '',
      nextRunAt: job.nextRunAt || '',
      lastError: job.lastError || ''
    };
  }

  function publishJobs() {
    var jobs = {};
    jobRegistry.forEach(function (job, key) { jobs[key] = serializeJob(job); });
    oneShotJobs.forEach(function (job, key) { jobs[key] = serializeJob(job); });
    updateState({ jobs: jobs }, 'jobs');
  }

  function cancelJobTimer(job) {
    if (job.timer) clearTimeout(job.timer);
    job.timer = null;
    job.nextRunAt = '';
  }

  function nextDelay(job, requestedDelay) {
    if (Number.isFinite(Number(requestedDelay))) return Math.max(50, Number(requestedDelay));
    if (!job.lastError) return job.interval;
    return Math.min(job.maxBackoff, Math.max(job.interval, job.retryDelay * Math.pow(2, Math.min(5, job.consecutiveFailures || 0))));
  }

  function armJob(job, requestedDelay) {
    cancelJobTimer(job);
    if (!job.enabled) { publishJobs(); return; }
    if (document.hidden && !job.runWhenHidden) {
      job.paused = true;
      publishJobs();
      return;
    }
    job.paused = false;
    var delay = nextDelay(job, requestedDelay);
    job.nextRunAt = new Date(Date.now() + delay).toISOString();
    job.timer = setTimeout(function () { void executeRecurringJob(job); }, delay);
    publishJobs();
  }

  async function executeRecurringJob(job) {
    cancelJobTimer(job);
    if (!job.enabled) return;
    if (job.running) {
      job.dirty = true;
      publishJobs();
      return;
    }
    if (document.hidden && !job.runWhenHidden) {
      job.paused = true;
      publishJobs();
      return;
    }
    job.running = true;
    job.dirty = false;
    job.controller = new AbortController();
    var started = performance.now();
    try {
      await job.executor({ signal: job.controller.signal, job: serializeJob(job) });
      job.runs += 1;
      job.consecutiveFailures = 0;
      job.lastError = '';
    } catch (error) {
      if (error?.name !== 'AbortError') {
        job.failures += 1;
        job.consecutiveFailures += 1;
        job.lastError = String(error?.message || error);
      }
    } finally {
      job.lastDuration = Math.round(performance.now() - started);
      job.lastRunAt = new Date().toISOString();
      job.running = false;
      job.controller = null;
      armJob(job, job.dirty ? 50 : undefined);
    }
  }

  var jobsApi = {
    upsert: function (name, executor, interval, options) {
      var key = String(name || 'job');
      var settings = options || {};
      var job = jobRegistry.get(key) || {
        name: key, kind: 'recurring', timer: null, running: false, enabled: true, paused: false,
        dirty: false, runs: 0, failures: 0, consecutiveFailures: 0, lastDuration: 0,
        lastRunAt: '', nextRunAt: '', lastError: '', controller: null
      };
      job.executor = typeof executor === 'function' ? executor : function () {};
      job.interval = Math.max(250, Number(interval || 5000));
      job.retryDelay = Math.max(1000, Number(settings.retryDelay || 3000));
      job.maxBackoff = Math.max(job.retryDelay, Number(settings.maxBackoff || 60_000));
      job.runWhenHidden = settings.runWhenHidden === true;
      job.enabled = true;
      jobRegistry.set(key, job);
      armJob(job, settings.immediate === false ? job.interval : Number(settings.delay || 120));
      return key;
    },
    trigger: function (name) {
      var job = jobRegistry.get(String(name || ''));
      if (!job || !job.enabled) return false;
      if (job.running) { job.dirty = true; publishJobs(); return true; }
      armJob(job, 50);
      return true;
    },
    stop: function (name) {
      var job = jobRegistry.get(String(name || ''));
      if (!job) return false;
      job.enabled = false;
      job.controller?.abort();
      cancelJobTimer(job);
      publishJobs();
      return true;
    },
    remove: function (name) {
      var key = String(name || '');
      jobsApi.stop(key);
      jobRegistry.delete(key);
      publishJobs();
    },
    run: function (name, executor) {
      var key = String(name || 'default');
      var current = oneShotJobs.get(key);
      if (current) return current.promise;
      var job = {
        name: key, kind: 'single', enabled: true, running: true, paused: false, runs: 0, failures: 0,
        lastDuration: 0, lastRunAt: '', nextRunAt: '', lastError: '', controller: new AbortController(), promise: null
      };
      var started = performance.now();
      job.promise = Promise.resolve().then(function () {
        return executor({ signal: job.controller.signal, job: serializeJob(job) });
      }).then(function (result) {
        job.runs = 1;
        return result;
      }).catch(function (error) {
        job.failures = 1;
        job.lastError = String(error?.message || error);
        throw error;
      }).finally(function () {
        job.running = false;
        job.lastDuration = Math.round(performance.now() - started);
        job.lastRunAt = new Date().toISOString();
        if (oneShotJobs.get(key) === job) oneShotJobs.delete(key);
        publishJobs();
      });
      oneShotJobs.set(key, job);
      publishJobs();
      return job.promise;
    },
    debounce: function (name, executor, delay) {
      return jobsApi.upsert('debounce:' + String(name || 'default'), async function () {
        jobsApi.remove('debounce:' + String(name || 'default'));
        await executor();
      }, Math.max(50, Number(delay || 200)), { immediate: false });
    },
    isRunning: function (name) {
      return Boolean(jobRegistry.get(String(name || ''))?.running || oneShotJobs.has(String(name || '')));
    },
    snapshot: function () {
      return Array.from(jobRegistry.values()).concat(Array.from(oneShotJobs.values())).map(serializeJob);
    },
    stopAll: function () {
      jobRegistry.forEach(function (_, key) { jobsApi.stop(key); });
      oneShotJobs.forEach(function (job) { job.controller?.abort(); });
    }
  };

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      jobRegistry.forEach(function (job) {
        if (!job.runWhenHidden) {
          job.paused = true;
          cancelJobTimer(job);
        }
      });
      publishJobs();
      return;
    }
    jobRegistry.forEach(function (job) {
      if (job.enabled && job.paused) armJob(job, 120);
    });
  });
  window.addEventListener('beforeunload', function () { jobsApi.stopAll(); });

  var noticeQueue = [];
  var activeNotice = null;
  var noticeTimer = null;
  var noticeCloseTimer = null;
  var recentNotices = new Map();

  function noticeNode() { return document.getElementById('toast'); }

  function closeActiveNotice() {
    var node = noticeNode();
    if (node) node.classList.remove('show');
    clearTimeout(noticeTimer);
    clearTimeout(noticeCloseTimer);
    noticeCloseTimer = setTimeout(function () {
      activeNotice = null;
      showNextNotice();
    }, 180);
  }

  function renderActiveNotice() {
    var node = noticeNode();
    if (!node || !activeNotice) return;
    node.textContent = activeNotice.message;
    node.dataset.tone = activeNotice.tone;
    node.setAttribute('aria-live', activeNotice.tone === 'error' ? 'assertive' : 'polite');
    requestAnimationFrame(function () { node.classList.add('show'); });
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(closeActiveNotice, activeNotice.duration);
  }

  function showNextNotice() {
    if (activeNotice || !noticeQueue.length) return;
    activeNotice = noticeQueue.shift();
    renderActiveNotice();
  }

  function notify(message, tone, duration, options) {
    var clean = String(message || '').trim();
    if (!clean) return '';
    var settings = options || {};
    var key = String(settings.key || ((tone || 'info') + '|' + clean));
    var now = Date.now();
    var lastAt = Number(recentNotices.get(key) || 0);
    if (!settings.replace && now - lastAt < Number(settings.dedupeMs || 3500)) return key;
    recentNotices.set(key, now);
    var notice = { key: key, message: clean, tone: tone || 'info', duration: Number(duration || (tone === 'error' ? 5600 : 3600)) };
    if (settings.replace && activeNotice?.key === key) {
      activeNotice = notice;
      renderActiveNotice();
      return key;
    }
    if (settings.replace) noticeQueue = noticeQueue.filter(function (item) { return item.key !== key; });
    noticeQueue.push(notice);
    if (noticeQueue.length > 3) noticeQueue.splice(0, noticeQueue.length - 3);
    showNextNotice();
    return key;
  }

  var stateApi = {
    get: function () { return appState; },
    update: updateState,
    bind: bindLegacyState,
    commit: function (reason) { return publishState(reason || 'commit'); },
    subscribe: function (subscriber) {
      if (typeof subscriber !== 'function') return function () {};
      stateSubscribers.add(subscriber);
      return function () { stateSubscribers.delete(subscriber); };
    }
  };

  window.FallenHeavenRuntime = { state: stateApi, jobs: jobsApi, notify: notify, bindState: bindLegacyState, commit: stateApi.commit };
  window.fallenHeavenState = stateApi;
  window.fallenHeavenJobs = jobsApi;
  window.FallenHeavenJobs = jobsApi;
  window.fallenHeavenNotify = notify;

  window.addEventListener('fallen-heaven:notify', function (event) {
    var detail = event?.detail || {};
    notify(detail.message || '', detail.tone || detail.phase || 'info', detail.duration, {
      key: detail.key || detail.phase || '', replace: detail.replace === true, dedupeMs: detail.dedupeMs
    });
  });
  window.addEventListener('error', function (event) {
    var message = event?.message || 'Unbekannter App-Fehler.';
    console.error('[FALLEN HEAVEN UI]', message, event?.error || '');
    updateState({ lastUiError: { type: 'error', message: message, at: new Date().toISOString() } }, 'ui-error');
  });
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event?.reason;
    var message = reason?.message || String(reason || 'Unbekannter Promise-Fehler.');
    console.error('[FALLEN HEAVEN UI Promise]', reason || message);
    updateState({ lastUiError: { type: 'promise', message: message, at: new Date().toISOString() } }, 'ui-error');
  });
}());
