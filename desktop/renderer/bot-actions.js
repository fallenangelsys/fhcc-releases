(function () {
  var api = window.fallenHeaven;
  if (!api) return;
  var key = 'fh-bot-event-log';
  var labels = { start: 'Bot gestartet', stop: 'Bot gestoppt', restart: 'Bot neu gestartet' };
  var events = JSON.parse(localStorage.getItem(key) || '[]');
  function escape(value) { return String(value || '').replace(/[&<>"']/g, function (character) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]; }); }
  function render() { var timeline = document.getElementById('timeline'); if (!timeline) return; timeline.innerHTML = events.slice(0, 8).map(function (entry) { return '<div class="timeline-row"><span></span><div><strong>' + escape(entry.title) + '</strong><small>' + escape(entry.detail) + ' - ' + escape(entry.time) + '</small></div></div>'; }).join('') || '<p class="empty-drafts">Noch keine Bot-Ereignisse.</p>'; }
  function record(title, detail) { events.unshift({ title: title, detail: detail, time: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }); events = events.slice(0, 30); localStorage.setItem(key, JSON.stringify(events)); render(); }
  function setMessage(value, tone) { window.dispatchEvent(new CustomEvent('fallen-heaven:notify', { detail: { message: value, tone: tone || 'info', duration: tone === 'error' ? 6000 : 3600 } })); }
  function paintStatus(online, detail) { ['bot-state', 'home-service', 'engine-label'].forEach(function (id) { var element = document.getElementById(id); if (element) element.textContent = online ? 'Bot ist aktiv' : 'Bot ist offline'; }); ['control-dot', 'home-service-dot', 'mini-dot'].forEach(function (id) { var element = document.getElementById(id); if (element) element.classList.toggle('offline', !online); }); var description = document.getElementById('bot-detail'); if (description && detail) description.textContent = detail; }
  function actionButtons() { return Array.from(document.querySelectorAll('[data-action]')).filter(function (button) { return ['start', 'stop', 'restart'].includes(button.dataset.action); }); }
  function markBusy(busy) { actionButtons().forEach(function (button) { button.dataset.botAction = button.dataset.action; button.disabled = busy; button.classList.toggle('is-busy', busy); button.setAttribute('aria-busy', String(busy)); }); }
  function updateStatus() {
    var request = api.getBotState ? api.getBotState() : api.controlBot('status');
    return request.then(function (result) { paintStatus(!!(result && result.active), result && (result.message || result.output)); return result; }).catch(function () { paintStatus(false, 'Bot-Status konnte nicht abgefragt werden.'); });
  }
  async function executeAction(action) { markBusy(true); record('Bot-Befehl gesendet', labels[action] || action); try { var result = await api.controlBot(action); var detail = result && (result.output || result.message || result.detail) || 'Befehl erfolgreich ausgeführt.'; var ok = !!(result && result.ok !== false); if (!ok) setMessage(detail, 'error'); record(ok ? (labels[action] || action) : 'Bot-Befehl fehlgeschlagen', detail); paintStatus(action === 'stop' ? false : !!(result && (result.active || result.ready)), detail); return result; } catch (error) { var problem = error && error.message ? error.message : 'Der Befehl konnte nicht ausgeführt werden.'; setMessage(problem, 'error'); record('Bot-Befehl fehlgeschlagen', problem); updateStatus(); return { ok: false, output: problem }; } finally { markBusy(false); } }
  function run(action) { return window.fallenHeavenJobs ? window.fallenHeavenJobs.run('bot-control', function () { return executeAction(action); }) : executeAction(action); }
  window.addEventListener('click', function (event) { var button = event.target.closest('[data-action]'); if (!button || !['start', 'stop', 'restart'].includes(button.dataset.action)) return; event.preventDefault(); event.stopImmediatePropagation(); void run(button.dataset.action); }, true);
  if (api.onBotState) {
    var previousPhase = '';
    api.onBotState(function (state) {
      var phase = state && state.phase || 'stopped';
      var detail = state && state.message || (state && state.active ? 'Bot ist aktiv.' : 'Bot ist offline.');
      paintStatus(!!(state && state.active), detail);
      markBusy(phase === 'starting' || phase === 'stopping');
      if (phase === 'starting' || phase === 'stopping' || phase === 'error') setMessage(detail, phase === 'error' ? 'error' : 'info');
      if (previousPhase && previousPhase !== phase && ['running', 'stopped', 'error'].includes(phase)) {
        record(phase === 'running' ? 'Bot ist bereit' : phase === 'stopped' ? 'Bot wurde gestoppt' : 'Bot-Prozessfehler', detail);
      }
      previousPhase = phase;
    });
  }
  markBusy(false); render(); void updateStatus();
}());
