(() => {
  'use strict';
  const REFRESH_MS = 5000;
  const history = [];
  let pollTimer = null;
  let clockTimer = null;
  let nextRefreshAt = 0;
  let busy = false;
  let scrolling = false;
  let scrollTimer = null;
  let pendingPayload = null;
  const api = window.fallenHeaven || window.fallenHeavenAPI || window.electronAPI || window.appAPI || {};
  const safe = (value = '') => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const num = (value = 0) => Number(value || 0).toLocaleString('de-DE');
  const displayNum = (value) => value === null || value === undefined ? '–' : num(value);
  const hasValue = (value) => value !== null && value !== undefined && Number.isFinite(Number(value));
  const pct = (value) => hasValue(value) ? `${Math.max(0, Math.min(100, Math.round(Number(value))))}%` : '—';
  const mb = (value) => hasValue(value) ? `${(Number(value) / 1048576).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB` : '—';
  const span = (milliseconds = 0) => {
    const seconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
    if (seconds < 60) return `${seconds} Sek.`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} Min. ${seconds % 60} Sek.`;
    return `${Math.floor(minutes / 60)} Std. ${minutes % 60} Min.`;
  };
  const stamp = (value) => {
    const parsed = Date.parse(value || '');
    return Number.isFinite(parsed) ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'medium' }).format(parsed) : 'Noch nicht erfasst';
  };
  const ago = (value) => {
    const parsed = Date.parse(value || '');
    if (!Number.isFinite(parsed)) return 'noch nicht erfasst';
    const difference = Math.max(0, Date.now() - parsed);
    if (difference < 5000) return 'gerade eben';
    if (difference < 60000) return `vor ${Math.floor(difference / 1000)} Sek.`;
    if (difference < 3600000) return `vor ${Math.floor(difference / 60000)} Min.`;
    if (difference < 86400000) return `vor ${Math.floor(difference / 3600000)} Std.`;
    return `vor ${Math.floor(difference / 86400000)} Tagen`;
  };

  function ensureStyle() {
    if (document.querySelector('link[data-live-diagnostics-v2]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'live-diagnostics-v2.css';
    link.dataset.liveDiagnosticsV2 = 'true';
    document.head.append(link);
  }

  function ensureView() {
    let view = document.querySelector('#live-diagnostics-view');
    if (!view) {
      view = document.createElement('section');
      view.id = 'live-diagnostics-view';
      view.className = 'view app-view fh-live-diagnostics-view';
      const sibling = document.querySelector('.view, .app-view');
      (sibling?.parentElement || document.querySelector('main') || document.body).append(view);
    }
    if (!view.querySelector('.diagnostics-shell')) {
      view.innerHTML = `<div class="diagnostics-shell"><header class="diagnostics-head"><div><span>FALLEN HEAVEN / OPERATIONS</span><h1>Live-Diagnose</h1><p>Bot, Discord, Indizes und Hintergrundjobs in einer belastbaren Echtzeitansicht.</p></div><div><b class="diagnostics-live"><i></i>LIVE · <em data-refresh-clock>2,0 s</em></b><button type="button" data-diagnostics-refresh>Jetzt aktualisieren</button></div></header><div id="live-diagnostics-content"><div class="diagnostics-loading"><i></i><strong>Diagnosedaten werden geladen</strong><span>Bot-Runtime und Indizes werden verbunden.</span></div></div></div>`;
      view.querySelector('[data-diagnostics-refresh]')?.addEventListener('click', () => refresh(true));
    }
    if (!view.dataset.diagnosticsScrollBound) {
      const handleScroll = () => {
        scrolling = true;
        if (scrollTimer) clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => {
          scrolling = false;
          if (pendingPayload) {
            const payload = pendingPayload;
            pendingPayload = null;
            render(payload);
          }
        }, 700);
      };
      view.addEventListener('scroll', handleScroll, { passive: true });
      window.addEventListener('scroll', handleScroll, { passive: true });
      view.dataset.diagnosticsScrollBound = '1';
    }
    return view;
  }

  function ensureNavigation() {
    const navigation = document.querySelector('.app-links');
    if (!navigation || navigation.querySelector('[data-view="live-diagnostics"]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'app-link';
    button.dataset.view = 'live-diagnostics';
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18V9m5 9V5m5 13v-7m5 7V3"></path><path d="M3 20h18"></path></svg>Live-Diagnose';
    const systemButton = navigation.querySelector('[data-view="system"]');
    navigation.insertBefore(button, systemButton || null);
  }

  function payloadData(payload) {
    const runtime = payload?.live || payload?.health?.liveDiagnostics || payload?.runtime?.liveDiagnostics || payload?.liveDiagnostics;
    if (runtime?.process) return {
      ...runtime,
      telemetryAvailable: true,
      diagnosticsFresh: payload?.diagnosticsFresh !== false,
      diagnosticsAgeMs: hasValue(payload?.diagnosticsAgeMs) ? Number(payload.diagnosticsAgeMs) : 0
    };
    const bot = payload?.bot || {};
    const runtimeHealth = payload?.runtime || payload?.health || {};
    const processMemory = runtimeHealth?.memory || {};
    const processMetrics = bot?.metrics || {};
    const discordReady = runtimeHealth?.discordReady === true || runtimeHealth?.ready === true || bot?.ready === true;
    const serviceOnline = runtimeHealth?.ok === true || runtimeHealth?.serviceReady === true || bot?.active === true;
    const fallbackHealth = discordReady
      ? {
          score: null,
          label: 'Bot online · Messwerte werden verbunden',
          tone: 'watch',
          components: { discord: 100, runtime: null, jobs: null, index: null },
          issues: ['Discord ist verbunden; die erweiterten Messwerte sind noch nicht eingetroffen.'],
          recommendations: ['Es werden keine fehlenden Werte als Null gewertet. Die App lädt im Hintergrund erneut.']
        }
      : serviceOnline
        ? {
            score: null,
            label: 'Discord-Verbindung wird geprüft',
            tone: 'watch',
            components: { discord: null, runtime: null, jobs: null, index: null },
            issues: [bot.message || 'Der Bot-Prozess läuft; Discord-Ready wurde noch nicht bestätigt.'],
            recommendations: ['Die App prüft die Verbindung automatisch erneut.']
          }
        : null;
    return {
      measuredAt: runtimeHealth?.measuredAt || payload?.measuredAt || new Date().toISOString(),
      telemetryAvailable: false,
      diagnosticsFresh: false,
      diagnosticsAgeMs: null,
      process: {
        pid: runtimeHealth?.processId || bot.pid || 0,
        uptimeSeconds: Number(runtimeHealth?.uptimeSeconds || processMetrics?.uptimeSeconds || 0),
        cpuPercent: hasValue(processMetrics?.cpuPercent) ? Number(processMetrics.cpuPercent) : null,
        logicalCpuCount: navigator.hardwareConcurrency || 0,
        rssBytes: hasValue(processMemory?.rss ?? processMetrics?.rssBytes) ? Number(processMemory?.rss ?? processMetrics?.rssBytes) : null,
        heapUsedBytes: hasValue(processMemory?.heapUsed ?? processMetrics?.heapUsedBytes) ? Number(processMemory?.heapUsed ?? processMetrics?.heapUsedBytes) : null,
        heapTotalBytes: hasValue(processMemory?.heapTotal ?? processMetrics?.heapTotalBytes) ? Number(processMemory?.heapTotal ?? processMetrics?.heapTotalBytes) : null,
        heapUtilizationPercent: hasValue(processMemory?.heapTotal ?? processMetrics?.heapTotalBytes) && Number(processMemory?.heapTotal ?? processMetrics?.heapTotalBytes) > 0
          ? (Number(processMemory?.heapUsed ?? processMetrics?.heapUsedBytes ?? 0) / Number(processMemory?.heapTotal ?? processMetrics?.heapTotalBytes)) * 100
          : null,
        arrayBuffersBytes: hasValue(processMemory?.arrayBuffers) ? Number(processMemory.arrayBuffers) : null,
        activeHandles: null
      },
      eventLoop: { available: false, meanDelayMs: null, p95DelayMs: null, maxDelayMs: null, healthy: null },
      discord: { ready: discordReady, pingMs: hasValue(runtimeHealth?.pingMs) ? Number(runtimeHealth.pingMs) : null, guildCount: hasValue(runtimeHealth?.guildCount) ? Number(runtimeHealth.guildCount) : null, user: runtimeHealth?.discordUserTag || null },
      jobs: { available: false, counters: { started: 0, completed: 0, failed: 0, overdue: 0 }, sessionCounters: { started: 0, completed: 0, failed: 0, overdue: 0 }, failureSummary: { totalOccurrences: 0, sessionOccurrences: 0, storedOccurrences: 0, storedGroups: 0, withoutStoredDetails: 0, lastFailureAt: null }, active: [], recent: [], failures: [], running: 0, timedOut: 0 },
      index: [],
      indexTelemetry: { available: false, refreshing: true, measuredAt: null, error: payload?.diagnosticsError || null },
      totals: { messages: null, channels: null, users: null, incompleteChannels: null, errorChannels: null },
      health: fallbackHealth || {
        score: null,
        label: 'Bot offline',
        tone: 'critical',
        components: { discord: 0, runtime: null, jobs: null, index: null },
        issues: [bot.message || 'Der Bot-Prozess ist nicht gestartet.'],
        recommendations: ['Starte den Bot, damit Discord-, Index- und Jobdiagnosen verfügbar werden.']
      }
    };
  }
  function record(live) {
    if (history.at(-1)?.at === live.measuredAt) return;
    history.push({
      at: live.measuredAt,
      cpu: hasValue(live.process?.cpuPercent) ? Number(live.process.cpuPercent) : null,
      ram: hasValue(live.process?.rssBytes) ? Number(live.process.rssBytes) / 1048576 : null,
      ping: hasValue(live.discord?.pingMs) ? Number(live.discord.pingMs) : null,
      loop: hasValue(live.eventLoop?.p95DelayMs) ? Number(live.eventLoop.p95DelayMs) : null
    });
    if (history.length > 60) history.splice(0, history.length - 60);
  }
  function points(key, maximum, width = 760, height = 170) {
    const values = history.map((entry) => Number(entry[key] || 0));
    const ceiling = Math.max(maximum, ...values, 1);
    return values.map((value, index) => `${(values.length < 2 ? 0 : index / (values.length - 1) * width).toFixed(1)},${(height - Math.min(value, ceiling) / ceiling * height).toFixed(1)}`).join(' ');
  }
  function signalStats(key) {
    const values = history.map((entry) => entry[key]).filter(hasValue).map(Number);
    if (!values.length) return { values: [], current: null, minimum: null, maximum: null, average: null };
    return {
      values,
      current: values.at(-1) || 0,
      minimum: Math.min(...values),
      maximum: Math.max(...values),
      average: values.reduce((sum, value) => sum + value, 0) / values.length
    };
  }
  function formatSignal(value, unit, decimals = 0) {
    return hasValue(value) ? `${Number(value).toLocaleString('de-DE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${unit}` : '—';
  }
  function sparkCard(key, label, unit, options = {}) {
    const stats = signalStats(key);
    if (!stats.values.length) return `<article class="diagnostics-spark ${safe(key)} unavailable"><header><div><i></i><span>${safe(label)}</span></div><strong>—</strong></header><div class="diagnostics-no-signal"><b>Noch keine Messung</b><span>Dieser Wert erscheint, sobald die Detailtelemetrie antwortet.</span></div><footer><span>Min. <b>—</b></span><span>Mittel <b>—</b></span><span>Max. <b>—</b></span></footer></article>`;
    const width = 320;
    const height = 92;
    const fixedFloor = Number.isFinite(options.floor) ? Number(options.floor) : null;
    const fixedCeiling = Number.isFinite(options.ceiling) ? Number(options.ceiling) : null;
    const naturalSpread = Math.max(1, stats.maximum - stats.minimum);
    const floor = fixedFloor ?? Math.max(0, stats.minimum - naturalSpread * 0.18);
    const ceiling = Math.max(floor + 1, fixedCeiling ?? (stats.maximum + naturalSpread * 0.18));
    const range = ceiling - floor;
    const coordinates = stats.values.map((value, index) => {
      const x = stats.values.length < 2 ? width : index / (stats.values.length - 1) * width;
      const normalized = Math.max(0, Math.min(1, (value - floor) / range));
      return `${x.toFixed(1)},${(height - normalized * height).toFixed(1)}`;
    }).join(' ');
    const decimals = Number(options.decimals || 0);
    return `<article class="diagnostics-spark ${safe(key)}"><header><div><i></i><span>${safe(label)}</span></div><strong>${safe(formatSignal(stats.current, unit, decimals))}</strong></header><svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="${safe(label)} Verlauf"><line x1="0" y1="${height / 2}" x2="${width}" y2="${height / 2}"></line><polyline points="${coordinates}"></polyline></svg><footer><span>Min. <b>${safe(formatSignal(stats.minimum, unit, decimals))}</b></span><span>Mittel <b>${safe(formatSignal(stats.average, unit, decimals))}</b></span><span>Max. <b>${safe(formatSignal(stats.maximum, unit, decimals))}</b></span></footer></article>`;
  }
  function renderPerformancePanel(target) {
    const panel = target.querySelector('.diagnostics-chart');
    if (!panel) return;
    panel.classList.add('diagnostics-chart-grid');
    panel.innerHTML = `<header><div><span>LIVE-VERLAUF</span><h2>Leistung nach Signal</h2></div><p>Eigene Skala und Einheit pro Messwert</p></header><div class="diagnostics-sparklines">${sparkCard('cpu', 'CPU-Last', ' %', { floor: 0, ceiling: 100 })}${sparkCard('ram', 'Arbeitsspeicher', ' MB', { decimals: 1 })}${sparkCard('ping', 'Discord-Ping', ' ms')}${sparkCard('loop', 'Event-Loop P95', ' ms', { decimals: 1 })}</div><footer class="diagnostics-chart-foot"><span>${history.length} Messpunkte</span><span>Aktualisierung alle ${REFRESH_MS / 1000} Sekunden</span></footer>`;
  }
  const scoreRow = (label, value) => `<div class="diagnostics-score ${hasValue(value) ? '' : 'unavailable'}"><div><span>${safe(label)}</span><b>${pct(value)}</b></div><i><span style="width:${hasValue(value) ? pct(value) : '0%'}"></span></i><small>${hasValue(value) ? 'Live bewertet' : 'Wird verbunden'}</small></div>`;
  const metric = (label, value, detail, tone = '') => `<article class="diagnostics-metric ${safe(tone)}"><span>${safe(label)}</span><strong>${safe(value)}</strong><small>${safe(detail)}</small></article>`;
  const scheduleRow = (label, state, detail, deadline = '', tone = '') => `<article class="diagnostics-schedule ${safe(tone)}"><i></i><div><strong>${safe(label)}</strong><span>${safe(detail)}</span></div><b${deadline ? ` data-deadline="${safe(deadline)}"` : ''}>${safe(state)}</b></article>`;

  function indexCard(index) {
    if (index.error) return `<article class="diagnostics-index critical"><header><div><span>SERVERINDEX</span><h3>${safe(index.guildName)}</h3></div><b>Fehler</b></header><p>${safe(index.error)}</p></article>`;
    const boost = index.boost || {};
    const schedule = boost.schedule || {};
    const pending = Array.isArray(index.pendingChannels) ? index.pendingChannels : [];
    return `<article class="diagnostics-index"><header><div><span>SERVERINDEX · ${safe(index.engine || 'SQLite')}</span><h3>${safe(index.guildName)}</h3></div><b class="${index.errorChannels ? 'critical' : 'good'}">${index.errorChannels ? `${num(index.errorChannels)} Fehler` : 'Live-Index betriebsbereit'}</b></header><div class="diagnostics-index-stats"><div><strong>${num(index.totalMessages)}</strong><span>Nachrichten</span></div><div><strong>${num(index.channelCount)}</strong><span>Checkpoints</span></div><div><strong>${displayNum(index.userCount)}</strong><span>Nutzer</span></div><div><strong>${displayNum(index.eventCount)}</strong><span>Systemevents</span></div></div><section class="diagnostics-meter"><div><span>Betriebsbereite Indexabdeckung</span><b>${pct(index.coveragePercent)}</b></div><i><span style="width:${pct(index.coveragePercent)}"></span></i><small>${num(index.operationalChannels)} Checkpoints mit Daten · ${num(index.activeBackfills)} aktive Nachladungen · Checkpoint ${safe(ago(index.lastCheckpointAt))}</small></section><section class="diagnostics-meter boost"><div><span>Boost-Systemindex</span><b>${pct(boost.progress)}</b></div><i><span style="width:${pct(boost.progress)}"></span></i><small>${safe(boost.detail || 'Noch kein Boost-Abgleich gestartet.')} ${boost.total ? `(${num(boost.completed)}/${num(boost.total)})` : ''}</small></section><div class="diagnostics-index-meta"><span><b>Live-Ingestion</b>${safe(index.ingestion?.nextTrigger || 'Nächste Discord-Nachricht')}</span><span><b>Index-Zeitraum</b>${safe(stamp(index.oldestMessageAt))}<br>bis ${safe(stamp(index.newestMessageAt))}</span><span><b>Nächster Boost-Abgleich</b><em${schedule.nextSyncAt ? ` data-deadline="${safe(schedule.nextSyncAt)}"` : ''}>${schedule.nextSyncAt ? 'wird berechnet' : 'nach Synchronisierung'}</em></span></div>${pending.length ? `<details><summary>Aktive oder fehlerhafte Indexjobs (${num(pending.length)})</summary><div>${pending.map((channel) => `<span><b># ${safe(channel.name)}</b><em>${num(channel.count)} Nachrichten · ${safe(channel.scanState)}</em>${channel.error ? `<small>${safe(channel.error)}</small>` : ''}</span>`).join('')}</div></details>` : ''}</article>`;
  }

  function jobsPanel(jobs = {}) {
    if (jobs.available === false) {
      return `<section class="diagnostics-panel diagnostics-jobs-unavailable"><header><div><span>JOB MANAGER</span><h2>Hintergrundarbeiten</h2></div><b>Wird verbunden</b></header><div class="diagnostics-loading inline"><i></i><strong>Noch keine Job-Detailmessung</strong><span>Historische Fehler werden nicht als aktuelle Nullwerte dargestellt. Die App lädt den echten Fehlerspeicher automatisch nach.</span></div></section>`;
    }
    const active = Array.isArray(jobs.active) ? jobs.active : [];
    const failures = (Array.isArray(jobs.failures) ? jobs.failures : (Array.isArray(jobs.recent) ? jobs.recent : []).filter((job) => job.status === 'failed' || job.error)).slice(0, 8);
    const summary = jobs.failureSummary || {};
    const storedOccurrences = Number(summary.storedOccurrences ?? failures.reduce((sum, job) => sum + Number(job.occurrences || 1), 0));
    const withoutStoredDetails = Number(summary.withoutStoredDetails || 0);
    const activeRows = active.length ? active.map((job) => `<tr><td><b>${safe(job.name)}</b><small>${safe(job.meta?.guildId || job.meta?.featureId || '')}</small></td><td>${safe(job.meta?.hook || 'Runtime')}</td><td>${span(job.durationMs)}</td><td><mark class="${job.overdue ? 'critical' : ''}">${job.overdue ? 'Zeitlimit' : 'Läuft'}</mark></td></tr>`).join('') : '<tr><td colspan="4" class="empty">Aktuell läuft kein längerer Hintergrundjob.</td></tr>';
    const failureRows = failures.map((job) => `<tr><td><b>${safe(job.name)}</b><small>${num(job.occurrences || 1)} Vorkommnis${Number(job.occurrences || 1) === 1 ? '' : 'se'}</small></td><td>${safe(job.error || 'Unbekannter Fehler')}<small>zuletzt ${safe(ago(job.lastOccurredAt || job.finishedAt || job.startedAt))}</small></td><td>${stamp(job.lastOccurredAt || job.finishedAt || job.startedAt)}</td></tr>`).join('');
    const legacyRow = withoutStoredDetails > 0 ? `<tr><td colspan="3" class="empty"><b>${num(withoutStoredDetails)} historische Fehler ohne Detaildaten</b><small>Die frühere Speicherversion führte dafür nur den Gesamtzähler. Neue Fehlerdetails bleiben ab jetzt separat erhalten.</small></td></tr>` : '';
    const failedRows = failureRows || legacyRow ? `${failureRows}${legacyRow}` : '<tr><td colspan="3" class="empty">Keine Fehlerdetails protokolliert.</td></tr>';
    return `<div class="diagnostics-jobs"><section class="diagnostics-panel"><header><div><span>JOB MANAGER</span><h2>Aktive Arbeiten</h2></div><b>${num(active.length)} aktiv</b></header><div class="diagnostics-table"><table><thead><tr><th>Aufgabe</th><th>Bereich</th><th>Laufzeit</th><th>Status</th></tr></thead><tbody>${activeRows}</tbody></table></div></section><section class="diagnostics-panel"><header><div><span>FEHLERSPEICHER</span><h2>Letzte Auffälligkeiten</h2></div><b>${num(storedOccurrences)} gespeichert</b></header><div class="diagnostics-table"><table><thead><tr><th>Aufgabe</th><th>Ursache</th><th>Zeit</th></tr></thead><tbody>${failedRows}</tbody></table></div></section></div>`;
  }

  function jobsMetricDetail(jobs = {}) {
    const sessionFailures = Number(jobs.sessionCounters?.failed ?? jobs.failureSummary?.sessionOccurrences ?? 0);
    const totalFailures = Number(jobs.failureSummary?.totalOccurrences ?? jobs.counters?.failed ?? 0);
    return `${num(jobs.timedOut)} aktive Timeouts · ${num(sessionFailures)} seit Start · ${num(totalFailures)} gesamt`;
  }

  function render(payload) {
    const live = payloadData(payload);
    const target = document.querySelector('#live-diagnostics-content');
    if (!target) return;
    const view = document.querySelector('#live-diagnostics-view');
    const previousScrollTop = view?.scrollTop || 0;
    if (!live?.process || !live?.discord) {
      target.innerHTML = '<div class="diagnostics-error"><strong>Bot-Runtime ist noch nicht verbunden.</strong><span>Die Diagnose versucht es automatisch erneut.</span></div>';
      return;
    }
    record(live);
    const health = live.health || { score: live.discord.ready ? 80 : 30, label: live.discord.ready ? 'Stabil' : 'Kritisch', tone: live.discord.ready ? 'good' : 'critical', components: {} };
    const notices = [...(health.issues || []), ...(health.recommendations || [])];
    if (live.telemetryAvailable && live.diagnosticsFresh === false) {
      notices.unshift(`Letzter vollständiger Messstand vor ${span(live.diagnosticsAgeMs || 0)}; die Verbindung wird erneuert.`);
    }
    const indexes = Array.isArray(live.index) ? live.index : [];
    const nextBoost = indexes.map((item) => item.boost?.schedule?.nextSyncAt).filter(Boolean).sort()[0] || '';
    const scored = hasValue(health.score);
    const discordPing = hasValue(live.discord?.pingMs) ? `${num(live.discord.pingMs)} ms` : '—';
    const guildDetail = live.discord.ready
      ? (hasValue(live.discord.guildCount) ? `${num(live.discord.guildCount)} Server verbunden` : 'Discord verbunden')
      : 'Nicht verbunden';
    const eventAvailable = live.eventLoop?.available !== false && hasValue(live.eventLoop?.p95DelayMs);
    const eventValue = eventAvailable ? `${Number(live.eventLoop.p95DelayMs).toFixed(1)} ms` : '—';
    const eventDetail = eventAvailable
      ? `Spitze ${Number(live.eventLoop.maxDelayMs || 0).toFixed(1)} ms · Mittel ${Number(live.eventLoop.meanDelayMs || 0).toFixed(1)} ms`
      : 'Noch keine Detailmessung';
    const jobsAvailable = live.jobs?.available !== false;
    const indexAvailable = live.indexTelemetry?.available !== false && hasValue(live.totals?.messages);
    const indexEmpty = live.indexTelemetry?.error
      ? `<article class="diagnostics-error"><strong>Serverindex nicht verfügbar</strong><span>${safe(live.indexTelemetry.error)}</span></article>`
      : '<article class="diagnostics-loading inline"><i></i><strong>Serverindex wird geladen</strong><span>Discord- und Prozesswerte bleiben währenddessen live.</span></article>';
    const serverIndexState = live.indexTelemetry?.refreshing ? 'wird aktualisiert' : indexAvailable ? 'bereit' : 'wird verbunden';
    const serverIndexTone = indexAvailable ? 'good' : 'watch';

    target.innerHTML = `<section class="diagnostics-health ${safe(health.tone)}">
      <div class="diagnostics-ring ${scored ? '' : 'unscored'}" style="--score:${scored ? Number(health.score) : 100}"><div><strong>${scored ? num(health.score) : 'LIVE'}</strong><span>${scored ? '/ 100' : 'VERBUNDEN'}</span></div></div>
      <div class="diagnostics-health-copy"><span>SYSTEMBEWERTUNG</span><h2>${safe(health.label)}</h2><p>${safe(notices[0] || 'Alle überwachten Kernsysteme arbeiten im Normalbereich.')}</p><div>${scoreRow('Discord', health.components?.discord)}${scoreRow('Runtime', health.components?.runtime)}${scoreRow('Jobs', health.components?.jobs)}${scoreRow('Index', health.components?.index)}</div></div>
      <aside><span>HINWEISE</span>${notices.length ? notices.slice(0, 5).map((notice) => `<p><i></i>${safe(notice)}</p>`).join('') : '<p><i></i>Keine unmittelbare Aktion notwendig.</p>'}<small>Messstand ${safe(ago(live.measuredAt))}</small></aside>
    </section>
    <div class="diagnostics-metrics">
      ${metric('Bot-Arbeitsspeicher', mb(live.process.rssBytes), hasValue(live.process.heapUsedBytes) ? `Heap ${mb(live.process.heapUsedBytes)} · ${pct(live.process.heapUtilizationPercent)}` : 'Speichermessung wird verbunden', hasValue(live.process.rssBytes) ? '' : 'unavailable')}
      ${metric('CPU-Last', pct(live.process.cpuPercent), hasValue(live.process.cpuPercent) ? `${num(live.process.logicalCpuCount)} logische Kerne` : 'Noch keine Detailmessung', hasValue(live.process.cpuPercent) ? '' : 'unavailable')}
      ${metric('Discord', discordPing, guildDetail, live.discord.ready ? 'good' : 'critical')}
      ${metric('Event-Loop P95', eventValue, eventDetail, eventAvailable ? (live.eventLoop.healthy ? 'good' : 'critical') : 'unavailable')}
      ${metric('Jobs', jobsAvailable ? num(live.jobs?.running) : '—', jobsAvailable ? jobsMetricDetail(live.jobs) : 'Job-Telemetrie wird verbunden', jobsAvailable ? '' : 'unavailable')}
      ${metric('Indexbestand', indexAvailable ? num(live.totals.messages) : '—', indexAvailable ? `${num(live.totals.channels)} Checkpoints · ${displayNum(live.totals.users)} Nutzer` : 'Serverindex wird im Hintergrund geladen', indexAvailable ? '' : 'unavailable')}
    </div>
    <div class="diagnostics-observe"><section class="diagnostics-panel diagnostics-chart"></section><section class="diagnostics-panel diagnostics-scheduler"><header><div><span>SCHEDULER</span><h2>Nächste Aktionen</h2></div></header>${scheduleRow('Diagnose aktualisieren', 'wird berechnet', 'Prozess, Discord und Jobs', new Date(nextRefreshAt).toISOString(), 'live')}${scheduleRow('Serverindex', serverIndexState, live.indexTelemetry?.refreshing ? 'Läuft unabhängig von der Oberfläche im Hintergrund' : 'Bei der nächsten Discord-Nachricht', '', serverIndexTone)}${scheduleRow('Boost-Abgleich', nextBoost ? 'wird berechnet' : 'wartet', 'Rollen- und Systemnachrichten-Abgleich', nextBoost, nextBoost ? 'live' : 'watch')}${scheduleRow('Index-Reparatur', !indexAvailable ? 'noch nicht bewertet' : live.totals?.errorChannels ? `${num(live.totals.errorChannels)} Fehler` : 'nicht erforderlich', !indexAvailable ? 'Wird nach dem Index-Ladevorgang bewertet' : live.totals?.incompleteChannels ? `${num(live.totals.incompleteChannels)} aktive Nachladungen` : 'Keine aktiven oder fehlerhaften Indexjobs', '', !indexAvailable ? 'watch' : live.totals?.errorChannels ? 'critical' : 'good')}</section></div>
    <section class="diagnostics-index-area"><header><div><span>DATENEBENE</span><h2>Server- und Boost-Indizes</h2></div><p>Fortschritt, Betriebsbereitschaft und Synchronisierung pro Server.</p></header><div>${indexes.length ? indexes.map(indexCard).join('') : indexEmpty}</div></section>
    ${jobsPanel(live.jobs)}
    <footer class="diagnostics-runtime"><span>PID ${displayNum(live.process.pid)}</span><span>Laufzeit ${span(Number(live.process.uptimeSeconds || 0) * 1000)}</span><span>${displayNum(live.process.activeHandles)} Handles</span><span>ArrayBuffers ${mb(live.process.arrayBuffersBytes)}</span><span>${stamp(live.measuredAt)}</span></footer>`;
    renderPerformancePanel(target);
    if (view && previousScrollTop > 0) requestAnimationFrame(() => { view.scrollTop = previousScrollTop; });
    updateClocks();
  }

  function queueRender(payload) {
    if (scrolling) {
      pendingPayload = payload;
      return;
    }
    render(payload);
  }

  function updateClocks() {
    const refreshClock = document.querySelector('[data-refresh-clock]');
    if (refreshClock) refreshClock.textContent = `${Math.max(0, (nextRefreshAt - Date.now()) / 1000).toFixed(1).replace('.', ',')} s`;
    document.querySelectorAll('[data-deadline]').forEach((element) => {
      const deadline = Date.parse(element.dataset.deadline || '');
      if (!Number.isFinite(deadline)) return;
      const remaining = deadline - Date.now();
      element.textContent = remaining > 1000 ? `in ${span(remaining)}` : remaining > -1000 ? 'aktualisiert …' : 'jetzt fällig';
    });
  }
  async function refresh(force = false) {
    const view = document.querySelector('#live-diagnostics-view');
    if (busy || document.hidden || (!force && !view?.classList.contains('active'))) return;
    busy = true;
    nextRefreshAt = Date.now() + REFRESH_MS;
    try {
      const getter = api.getLiveDiagnostics || api.getDiagnostics || api.diagnostics;
      if (typeof getter !== 'function') throw new Error('Diagnose-Schnittstelle ist nicht verfügbar.');
      const payload = await getter.call(api);
      nextRefreshAt = Date.now() + REFRESH_MS;
      queueRender(payload);
    } catch (error) {
      const target = document.querySelector('#live-diagnostics-content');
      if (target) target.innerHTML = `<div class="diagnostics-error"><strong>Live-Diagnose konnte nicht geladen werden.</strong><span>${safe(error?.message || error)}</span><button type="button" data-diagnostics-retry>Erneut versuchen</button></div>`;
      target?.querySelector('[data-diagnostics-retry]')?.addEventListener('click', () => refresh(true));
    } finally { busy = false; }
  }
  function start() {
    if (pollTimer) return;
    refresh(true);
    pollTimer = window.setInterval(refresh, REFRESH_MS);
    clockTimer = window.setInterval(updateClocks, 1000);
  }
  function stop() {
    if (pollTimer) clearInterval(pollTimer);
    if (clockTimer) clearInterval(clockTimer);
    pollTimer = null;
    clockTimer = null;
  }
  function activate() {
    const view = ensureView();
    document.querySelectorAll('.view, .app-view').forEach((candidate) => candidate.classList.toggle('active', candidate === view));
    document.querySelectorAll('.app-link[data-view], .app-brand[data-view]').forEach((button) => {
      button.classList.toggle('active', button.dataset.view === 'live-diagnostics');
    });
    view.hidden = false;
    start();
  }
  function init() {
    ensureStyle();
    ensureView();
    ensureNavigation();
    document.addEventListener('click', (event) => {
      if (event.target.closest('[data-view="live-diagnostics"], [data-app-view="live-diagnostics"], [data-live-diagnostics]')) {
        setTimeout(activate, 0);
      } else if (event.target.closest('[data-view], [data-app-view]')) setTimeout(stop, 80);
    }, true);
    const diagnosticsView = document.querySelector('#live-diagnostics-view');
    if (diagnosticsView) new MutationObserver(() => diagnosticsView.classList.contains('active') ? start() : stop()).observe(diagnosticsView, { attributes: true, attributeFilter: ['class'] });
    if (document.querySelector('#live-diagnostics-view')?.classList.contains('active')) start();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
