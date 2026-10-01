(function () {
  'use strict';

  function state() { return globalThis.state || {}; }

  let inactiveReminderPreviewState = { list: [], selected: new Set() };
  let inactiveReminderRefreshTimer = null;
  let inactiveReminderPage = 0;
  let inactiveReminderPageSize = 25;

  const INACTIVE_REMINDER_STATUS_LABEL = {
    'pending-send': 'Versand läuft',
    sent: 'gesendet · wartet auf Antwort',
    'dm-failed': 'DM fehlgeschlagen',
    stayed: 'geblieben',
    'leave-requested': 'Entfernung offen',
    left: 'freiwillig entfernt',
    kicked: 'gekickt',
    'dm-deleted': 'DM gelöscht'
  };

  function inactiveReminderOverview(config) {
    const active = config?.enabled === true;
    const days = Math.max(1, Number(config?.thresholdDays || 180));
    const excluded = Array.isArray(config?.excludedRoleIds) ? config.excludedRoleIds.length : 0;
    const status = active ? 'AKTIV' : 'AUS';
    const heading = active ? 'Inaktive Mitglieder werden freundlich gefragt.' : 'Inaktivitäts-Erinnerung ist deaktiviert.';
    return '<section id="inactive-reminder-panel" class="activity-race-panel ' + (active ? 'ready' : 'attention') + '">' +
      '<header><div><small>FALLEN HEAVEN · INAKTIVITÄTS-ERINNERUNG</small><h3>' + heading + '</h3><p>' + (active
        ? 'Der Bot prüft beim Start und danach täglich Nachricht, Voice und Beitrittsalter. Nur Mitglieder, die alle Kriterien erfüllen, erhalten automatisch eine DM. Fehlende Daten stoppen den Lauf. Es gibt keinen Auto-Kick.'
        : 'Aktiviere das Modul unten für den sicheren automatischen Start- und Tageslauf. Unvollständige Daten blockieren den Versand; entfernt wird weiterhin niemand ohne eigenen Klick.') + '</p></div><span data-inactive-reminder-badge>' + status + '</span></header>' +
      '<div class="role-saver-stats"><span><b data-inactive-reminder-total>–</b><small>gefragt</small></span><span><b data-inactive-reminder-waiting>–</b><small>warten auf Antwort</small></span><span><b data-inactive-reminder-stayed>–</b><small>bleiben</small></span><span><b data-inactive-reminder-left>–</b><small>gehen</small></span><span><b>' + days + ' d</b><small>Inaktiv-Schwelle</small></span><span><b>' + excluded + '</b><small>ausgenommene Rollen</small></span></div>' +
      '<div class="activity-race-actions"><div><b>Erinnerungs-DM gestalten</b><span>Embed Studio mit Live-Vorschau · Platzhalter: {user} (echter Ping), {username}, {displayName}, {guild}/{server} und {thresholdDays}. Das Embed wird bei jedem Versand verwendet und ist einzeln editierbar.</span></div><button type="button" data-inactive-reminder-open-studio>Erinnerungs-DM bearbeiten</button><button type="button" data-inactive-reminder-preview>Kandidaten anzeigen</button></div>' +
      '<div class="activity-race-actions"><div><b>Automatik & Vorschau</b><span>Der automatische Lauf sendet nur nach vollständiger Prüfung aller Kriterien. „Kandidaten anzeigen" bleibt eine reine Vorschau; über die Auswahl kannst du einen geprüften Lauf zusätzlich sofort auslösen.</span></div></div>' +
      '<div id="inactive-reminder-preview-list" class="inactive-reminder-dm-list" data-inactive-reminder-preview-list></div>' +
      '<div class="activity-race-actions"><div><b>Aktivitätsquellen</b><span>Aktuelle Voice-Ereignisse werden direkt und dauerhaft von Discord erfasst. Historische Carl-bot-Logs ergänzen die Voice-Historie; der Nachrichtenindex schützt aktive Schreiber. Fehlt eine notwendige Quelle, stoppt die Prüfung ohne Kandidaten.</span></div></div>' +
      '<div class="activity-race-actions"><div><b>Manuelle DM</b><span>Sendet jetzt eine Erinnerungs-DM an ein bestimmtes Mitglied – unabhängig vom Scan. Existiert bereits eine DM, wird diese aktualisiert statt doppelt gesendet. Mitglied-ID findest du in der Serververwaltung.</span></div><input id="inactive-reminder-manual-user" class="inactive-reminder-manual-input" placeholder="Mitglied-ID" inputmode="numeric" autocomplete="off"><button type="button" data-inactive-reminder-send-manual>DM senden</button></div>' +
      '<div class="activity-race-actions"><div><b>Gesendete DMs verwalten</b><span>Beantwortete DMs bereinigen entfernt Embed + Buttons aus DMs, in denen bereits eine Entscheidung getroffen wurde (nur Bestätigungstext bleibt). Einzelne DMs lassen sich gezielt oder alle auf einmal löschen – Empfänger werden danach nie erneut angeschrieben.</span></div><button type="button" data-inactive-reminder-cleanup>Beantwortete DMs bereinigen</button><button type="button" class="danger" data-inactive-reminder-delete-all>Alle DMs löschen</button></div>' +
      '<div class="inactive-reminder-list-tools"><label>Pro Seite<select id="inactive-reminder-page-size" aria-label="Einträge pro Seite"><option value="25">25</option><option value="50">50</option><option value="100">100</option></select></label><span data-inactive-reminder-list-count></span></div>' +
      '<div id="inactive-reminder-dm-list" class="inactive-reminder-dm-list" data-inactive-reminder-dm-list></div>' +
      '<div id="inactive-reminder-pagination" class="inactive-reminder-pagination"></div>' +
      '</section>';
  }

  function refreshInactiveReminderStatus() {
    const s = state();
    if (!inactiveReminderRefreshTimer) {
      inactiveReminderRefreshTimer = setInterval(function () { void refreshInactiveReminderStatus(); }, 60000);
    }
    const panel = document.getElementById('inactive-reminder-panel');
    if (!panel || !s.authenticated || !s.selectedGuildId || s.activeFeatureId !== 'inactiveReminder') return;
    apiRequestWithRetry({ path: '/api/guild/' + encodeURIComponent(s.selectedGuildId) + '/inactive-reminder?page=' + inactiveReminderPage + '&pageSize=' + inactiveReminderPageSize, timeoutMs: 8000 }, 2)
      .then(function (response) {
        if (!response?.ok) return;
        const status = response.data?.status || {};
        const stats = status.stats || {};
        const badgeNode = panel.querySelector('[data-inactive-reminder-badge]');
        const totalNode = panel.querySelector('[data-inactive-reminder-total]');
        const waitingNode = panel.querySelector('[data-inactive-reminder-waiting]');
        const stayedNode = panel.querySelector('[data-inactive-reminder-stayed]');
        const leftNode = panel.querySelector('[data-inactive-reminder-left]');
        if (totalNode) totalNode.textContent = String(Number(stats.total || 0));
        if (waitingNode) waitingNode.textContent = String(Number(stats.sent || 0));
        if (stayedNode) stayedNode.textContent = String(Number(stats.stayed || 0));
        if (leftNode) leftNode.textContent = String(Number(stats.left || 0) + Number(stats.kicked || 0) + Number(stats['leave-requested'] || 0));
        if (badgeNode && status.enabled) {
          badgeNode.textContent = status.automaticState?.ready === false ? 'AUTOMATIK BLOCKIERT' : 'AUTOMATIK AKTIV';
        }
        renderInactiveReminderDmList(status.entries || []);
        renderInactiveReminderPagination(status);
      })
      .catch(function () {});
  }

  function renderInactiveReminderDmList(entries) {
    const host = document.querySelector('[data-inactive-reminder-dm-list]');
    if (!host) return;
    const all = (entries || []);
    if (!all.length) {
      host.innerHTML = '<p class="inactive-reminder-dm-empty">Noch keine Erinnerung gesendet. Sobald der Bot jemanden anschreibt, wird hier gespeichert: wer, wann und mit welchem Status – übersteht Neustarts und Updates.</p>';
      return;
    }
    const deletable = all.filter(function (entry) { return entry.dmChannelId && entry.dmMessageId; });
    host.innerHTML = '<div class="inactive-reminder-dm-head"><b>' + all.length + ' Erinnerung(en) gespeichert</b><small>' + (deletable.length ? deletable.length + ' DM(s) löschbar · ' : '') + 'wer, wann, Status – lokal in der Datenbank.</small></div>' +
      '<div class="inactive-reminder-table">' +
      all.slice(0, 200).map(function (entry) {
        const sentAt = entry.dmSentAt ? new Date(entry.dmSentAt).toLocaleString('de-DE') : '';
        const respondedAt = entry.respondedAt ? new Date(entry.respondedAt).toLocaleString('de-DE') : '';
        const statusKey = String(entry.status || '');
        const status = INACTIVE_REMINDER_STATUS_LABEL[statusKey] || statusKey;
        const statusClass = statusKey === 'stayed' ? ' member-badge-ok'
          : statusKey === 'left' || statusKey === 'kicked' ? ' member-badge-danger'
          : statusKey === 'dm-deleted' ? ' member-badge-muted'
          : statusKey === 'dm-failed' || statusKey === 'leave-requested' ? ' member-badge-danger'
          : ' member-badge-wait';
        const avatar = entry.avatarUrl
          ? '<img src="' + escapeAttr(entry.avatarUrl) + '" alt="" loading="lazy">'
          : '<span class="inactive-reminder-avatar-fallback">' + escapeHtml(String(entry.displayName || entry.username || '?').slice(0, 1).toUpperCase()) + '</span>';
        const deleteButton = (entry.dmChannelId && entry.dmMessageId)
          ? '<button type="button" class="danger" data-inactive-reminder-delete-one="' + escapeAttr(entry.userId) + '">DM löschen</button>'
          : '';
        return '<div class="inactive-reminder-member-row" data-inactive-reminder-dm-row="' + escapeAttr(entry.userId) + '">' +
          '<span class="inactive-reminder-identity">' + avatar + '<span><b>' + escapeHtml(entry.displayName || entry.username || 'Mitglied') + '</b><small>@' + escapeHtml(entry.username || 'unbekannt') + ' · ' + escapeHtml(entry.userId) + '</small></span></span>' +
          '<span class="inactive-reminder-status"><small class="member-badge' + statusClass + '">' + escapeHtml(status) + '</small></span>' +
          '<span class="inactive-reminder-dates">' +
          (sentAt ? '<small>Gesendet: <b>' + escapeHtml(sentAt) + '</b></small>' : '<small>Kein Sendedatum</small>') +
          (respondedAt ? '<small>Antwort: <b>' + escapeHtml(respondedAt) + '</b></small>' : '') +
          '</span>' +
          '<span class="inactive-reminder-actions">' + deleteButton + '</span>' +
          '</div>';
      }).join('') +
      '</div>';
  }

  async function cleanupInactiveReminderDms() {
    const s = state();
    if (!s.authenticated || !s.selectedGuildId) return;
    const confirmed = await showAppConfirm({
      tone: 'primary',
      eyebrow: 'BEANTWORTETE DMS BEREINIGEN',
      title: 'Beantwortete DMs bereinigen?',
      message: 'Aus allen DMs, in denen bereits eine Entscheidung getroffen wurde („Ja, zum Server" / „Nein, bitte entfernen"), werden Embed und Buttons entfernt – es bleibt nur der Bestätigungstext. Läuft außerdem automatisch bei jedem Bot-Start.',
      cancelLabel: 'Abbrechen',
      confirmLabel: 'Bereinigen'
    });
    if (!confirmed) return;
    const button = document.querySelector('[data-inactive-reminder-cleanup]');
    const original = button ? button.textContent : '';
    if (button) { button.disabled = true; button.textContent = 'Bereinige …'; }
    try {
      const response = await apiRequestWithRetry({ path: '/api/guild/' + encodeURIComponent(s.selectedGuildId) + '/inactive-reminder/cleanup-responded', method: 'POST', timeoutMs: 60000 }, 1);
      if (!response?.ok) { toast('Bereinigung fehlgeschlagen: ' + (response?.data?.error || 'Unbekannter Fehler'), 'error'); return; }
      const result = response.data?.result || {};
      toast(Number(result.cleaned || 0) + ' beantwortete DM(s) bereinigt' + (Number(result.failed || 0) ? ' · ' + result.failed + ' fehlgeschlagen' : '') + '.', 'success');
      void refreshInactiveReminderStatus();
    } catch (error) {
      toast('Bereinigung fehlgeschlagen: ' + String(error?.message || error), 'error');
    } finally {
      if (button) { button.disabled = false; button.textContent = original; }
    }
  }

  function renderInactiveReminderPagination(status) {
    const pageSizeSelect = document.getElementById('inactive-reminder-page-size');
    if (pageSizeSelect) pageSizeSelect.value = String(Number(status.pageSize || inactiveReminderPageSize) || 25);
    const countNode = document.querySelector('[data-inactive-reminder-list-count]');
    if (countNode) countNode.textContent = String(Number(status.total || 0)) + ' Einträge gesamt';
    const target = document.getElementById('inactive-reminder-pagination');
    if (!target) return;
    const page = Math.max(0, Number(status.page || 0));
    const pages = Math.max(1, Number(status.pageCount || 1));
    const total = Number(status.total || 0);
    if (!total) { target.innerHTML = ''; return; }
    target.innerHTML = '<span>Seite <b>' + (page + 1) + '</b> von <b>' + pages + '</b></span>' +
      '<div><button type="button" data-inactive-reminder-page="0"' + (page <= 0 ? ' disabled' : '') + '>«</button>' +
      '<button type="button" data-inactive-reminder-page="' + (page - 1) + '"' + (page <= 0 ? ' disabled' : '') + '>‹</button>' +
      '<button type="button" data-inactive-reminder-page="' + (page + 1) + '"' + (page >= pages - 1 ? ' disabled' : '') + '>›</button>' +
      '<button type="button" data-inactive-reminder-page="' + (pages - 1) + '"' + (page >= pages - 1 ? ' disabled' : '') + '>»</button></div>';
  }

  async function sendManualInactiveReminderDm() {
    const s = state();
    if (!s.authenticated || !s.selectedGuildId) return;
    const input = document.getElementById('inactive-reminder-manual-user');
    const userId = String(input?.value || '').trim();
    if (!userId) { toast('Bitte eine Mitglied-ID eingeben.', 'error'); input?.focus(); return; }
    const confirmed = await showAppConfirm({
      tone: 'primary',
      eyebrow: 'ERINNERUNGS-DM MANUELL SENDEN',
      title: 'DM an dieses Mitglied senden?',
      message: 'Das Erinnerungs-Embed wird jetzt an das Mitglied ' + userId + ' gesendet (bzw. eine bereits vorhandene DM wird aktualisiert). Die Aktion wird im Protokoll gespeichert.',
      cancelLabel: 'Abbrechen',
      confirmLabel: 'DM senden'
    });
    if (!confirmed) return;
    const button = document.querySelector('[data-inactive-reminder-send-manual]');
    const original = button ? button.textContent : '';
    if (button) { button.disabled = true; button.textContent = 'Sende …'; }
    try {
      const response = await apiRequestWithRetry({ path: '/api/guild/' + encodeURIComponent(s.selectedGuildId) + '/inactive-reminder/send-manual', method: 'POST', timeoutMs: 20000, body: { userId: String(userId) } }, 1);
      if (!response?.ok) { toast('DM konnte nicht gesendet werden: ' + (response?.data?.error || 'Unbekannter Fehler'), 'error'); return; }
      const result = response.data?.result || {};
      toast('DM gesendet an ' + String(result.username || userId) + (result.edited ? ' (vorhandene DM aktualisiert)' : '') + '.', 'success');
      inactiveReminderPage = 0;
      void refreshInactiveReminderStatus();
    } catch (error) {
      toast('DM konnte nicht gesendet werden: ' + String(error?.message || error), 'error');
    } finally {
      if (button) { button.disabled = false; button.textContent = original; }
    }
  }

  async function deleteInactiveReminderDm(userId) {
    const s = state();
    if (!s.authenticated || !s.selectedGuildId) return;
    const confirmed = await showAppConfirm({
      tone: 'danger',
      eyebrow: 'ERINNERUNGS-DM LÖSCHEN',
      title: 'Diese Erinnerungs-DM wirklich löschen?',
      message: 'Die Nachricht wird aus dem Direktchat des Mitglieds entfernt. Der Empfänger wird danach nicht erneut angeschrieben (Status wird auf „DM gelöscht" gesetzt).',
      cancelLabel: 'Abbrechen',
      confirmLabel: 'DM löschen'
    });
    if (!confirmed) return;
    try {
      const response = await apiRequestWithRetry({ path: '/api/guild/' + encodeURIComponent(s.selectedGuildId) + '/inactive-reminder/delete-dm', method: 'POST', timeoutMs: 20000, body: { userId: String(userId || '') } }, 1);
      if (!response?.ok) { toast('DM konnte nicht gelöscht werden: ' + (response?.data?.error || 'Unbekannter Fehler'), 'error'); return; }
      toast('Erinnerungs-DM gelöscht.', 'success');
      void refreshInactiveReminderStatus();
    } catch (error) {
      toast('DM konnte nicht gelöscht werden: ' + String(error?.message || error), 'error');
    }
  }

  async function deleteAllInactiveReminderDms() {
    const s = state();
    if (!s.authenticated || !s.selectedGuildId) return;
    const confirmed = await showAppConfirm({
      tone: 'danger',
      eyebrow: 'ALLE ERINNERUNGS-DMS LÖSCHEN',
      title: 'Wirklich ALLE gesendeten Erinnerungs-DMs löschen?',
      message: 'Alle bereits versendeten Erinnerungs-DMs werden entfernt. Dies kann nicht rückgängig gemacht werden – betroffene Mitglieder werden danach nicht erneut angeschrieben.',
      cancelLabel: 'Abbrechen',
      confirmLabel: 'Ja, alle löschen'
    });
    if (!confirmed) return;
    const button = document.querySelector('[data-inactive-reminder-delete-all]');
    const original = button ? button.textContent : '';
    if (button) { button.disabled = true; button.textContent = 'Lösche …'; }
    try {
      const response = await apiRequestWithRetry({ path: '/api/guild/' + encodeURIComponent(s.selectedGuildId) + '/inactive-reminder/delete-all-dms', method: 'POST', timeoutMs: 60000 }, 1);
      if (!response?.ok) { toast('DMs konnten nicht gelöscht werden: ' + (response?.data?.error || 'Unbekannter Fehler'), 'error'); return; }
      const result = response.data?.result || {};
      toast(Number(result.deleted || 0) + ' Erinnerungs-DM(s) gelöscht.', 'success');
      void refreshInactiveReminderStatus();
    } catch (error) {
      toast('DMs konnten nicht gelöscht werden: ' + String(error?.message || error), 'error');
    } finally {
      if (button) { button.disabled = false; button.textContent = original; }
    }
  }

  async function runInactiveReminderPreviewAction() {
    const s = state();
    if (!s.authenticated || !s.selectedGuildId) {
      toast('Wähle zuerst einen Server.', 'error');
      return;
    }
    const host = document.querySelector('[data-inactive-reminder-preview-list]');
    const buttons = document.querySelectorAll('[data-inactive-reminder-preview]');
    if (host) host.innerHTML = '<p class="inactive-reminder-dm-empty">Scan läuft – Kandidaten werden ermittelt …</p>';
    buttons.forEach(function (button) { button.disabled = true; });
    try {
      const response = await apiRequestWithRetry({ path: '/api/guild/' + encodeURIComponent(s.selectedGuildId) + '/inactive-reminder/preview', method: 'POST', timeoutMs: 60000 }, 1);
      if (!response?.ok) {
        toast('Vorschau fehlgeschlagen: ' + (response?.data?.error || 'Unbekannter Fehler'), 'error');
        return;
      }
      const result = response.data?.result || {};
      const list = Array.isArray(result.candidatesList) ? result.candidatesList : [];
      if (result.blocked || result.status === 'data-incomplete') {
        inactiveReminderPreviewState = { list: [], selected: new Set() };
        if (host) host.innerHTML = '<p class="inactive-reminder-dm-empty">Prüfung gestoppt: ' + escapeHtml(result.reason || 'Aktivitätsdaten sind unvollständig.') + '</p>';
        toast('Niemand wurde ausgewählt: ' + (result.reason || 'Aktivitätsdaten sind unvollständig.'), 'error');
        return;
      }
      inactiveReminderPreviewState = {
        list: list.slice(0, 500),
        selected: new Set()
      };
      renderInactiveReminderPreviewList();
      const excluded = Number(result.voiceChatExcluded || 0);
      const quality = result.sourceQuality?.complete ? 'Datenquellen vollständig' : 'Datenquellen unvollständig';
      toast(list.length
        ? 'Scan: ' + list.length + ' Kandidaten gefunden · ' + quality + ' · nichts wurde gesendet.'
        : (excluded > 0 ? 'Scan: 0 neue Kandidaten · ' + quality + ' · ' + excluded + ' kürzlich aktiv.' : 'Scan: 0 Kandidaten · ' + quality + ' · niemand würde angeschrieben.'), list.length ? 'success' : 'info');
    } catch (error) {
      toast('Vorschau fehlgeschlagen: ' + String(error?.message || error), 'error');
    } finally {
      buttons.forEach(function (button) { button.disabled = false; });
    }
  }

  function renderInactiveReminderPreviewList() {
    const host = document.querySelector('[data-inactive-reminder-preview-list]');
    if (!host) return;
    const list = inactiveReminderPreviewState.list || [];
    const selected = inactiveReminderPreviewState.selected || new Set();
    if (!list.length) {
      inactiveReminderPreviewState = { list: [], selected: new Set() };
      host.innerHTML = '<p class="inactive-reminder-dm-empty">Keine Kandidaten – aktuell würde niemand angeschrieben. Alle Mitglieder sind aktiv (Nachricht oder Voice innerhalb der Schwelle) oder haben bereits eine Erinnerung.</p>';
      return;
    }
    const selectedCount = selected.size;
    host.innerHTML = '<div class="inactive-reminder-dm-head"><b>' + list.length + ' Mitglieder würden angeschrieben</b><small>Haken setzen oder entfernen – gesendet wird erst nach deiner Bestätigung.</small></div>' +
      '<div class="inactive-reminder-preview-tools"><button type="button" data-inactive-reminder-select-all>Alle auswählen</button><button type="button" data-inactive-reminder-select-none>Alle abwählen</button><span>Ausgewählt: <b data-inactive-reminder-selected-count>' + selectedCount + '</b> / ' + list.length + '</span></div>' +
      list.map(function (entry) {
        const userId = String(entry.userId || '');
        const checked = selected.has(userId) ? ' checked' : '';
        const joined = entry.joinedAt ? 'beitritt ' + new Date(entry.joinedAt).toLocaleDateString('de-DE') : '';
        const lastMessage = entry.lastMessageMs ? new Date(entry.lastMessageMs).toLocaleDateString('de-DE') : 'nie geschrieben';
        const lastVoice = entry.lastVoiceMs ? new Date(entry.lastVoiceMs).toLocaleDateString('de-DE') : 'nie im Call';
        const reason = entry.reason || 'Chat und Voice liegen außerhalb der Schwelle';
        return '<label class="inactive-reminder-dm-row inactive-reminder-candidate"><input type="checkbox" data-inactive-reminder-candidate="' + escapeAttr(userId) + '"' + checked + '><span><b>' + escapeHtml(entry.username || 'Mitglied') + '</b><small>' + escapeHtml(joined) + ' · letzte Nachricht: ' + escapeHtml(lastMessage) + ' · letzter Call: ' + escapeHtml(lastVoice) + '</small><small>Grund: ' + escapeHtml(reason) + '</small></span></label>';
      }).join('') +
      '<div class="inactive-reminder-send-bar"><button type="button" class="button primary" data-inactive-reminder-send-selected' + (selectedCount ? '' : ' disabled') + '>Senden an ' + selectedCount + ' ausgewählte</button><small>Manueller Sofortlauf für die markierte Auswahl; dieselben Sicherheitskriterien werden erneut geprüft.</small></div>';
  }

  function refreshInactiveReminderSelection() {
    const host = document.querySelector('[data-inactive-reminder-preview-list]');
    if (!host) return;
    const selected = inactiveReminderPreviewState.selected || new Set();
    host.querySelectorAll('[data-inactive-reminder-candidate]').forEach(function (checkbox) {
      const userId = String(checkbox.getAttribute('data-inactive-reminder-candidate') || '');
      if (checkbox.checked) selected.add(userId);
      else selected.delete(userId);
    });
    inactiveReminderPreviewState.selected = selected;
    const countNode = host.querySelector('[data-inactive-reminder-selected-count]');
    if (countNode) countNode.textContent = String(selected.size);
    const sendButton = host.querySelector('[data-inactive-reminder-send-selected]');
    if (sendButton) {
      sendButton.disabled = selected.size === 0;
      sendButton.textContent = 'Senden an ' + selected.size + ' ausgewählte';
    }
  }

  async function runInactiveReminderSendAction() {
    const s = state();
    if (!s.authenticated || !s.selectedGuildId) {
      toast('Wähle zuerst einen Server.', 'error');
      return;
    }
    const host = document.querySelector('[data-inactive-reminder-preview-list]');
    const selected = inactiveReminderPreviewState.selected || new Set();
    if (!selected.size) {
      toast('Wähle mindestens ein Mitglied aus.', 'info');
      return;
    }
    const confirmed = await showAppConfirm({
      tone: 'danger',
      eyebrow: 'ERINNERUNGS-DMS SENDEN',
      title: selected.size + ' Erinnerungs-DM(s) jetzt senden?',
      message: 'Nur die markierten Mitglieder erhalten jetzt das Erinnerungs-Embed. Wer in der Zwischenzeit aktiv geworden ist oder bereits eine Erinnerung hat, wird automatisch übersprungen. Danach kannst du gesendete DMs im Modul löschen.',
      cancelLabel: 'Abbrechen',
      confirmLabel: 'Ja, senden'
    });
    if (!confirmed) return;
    const sendButton = host ? host.querySelector('[data-inactive-reminder-send-selected]') : null;
    if (sendButton) { sendButton.disabled = true; sendButton.textContent = 'Sende …'; }
    try {
      const response = await apiRequestWithRetry({ path: '/api/guild/' + encodeURIComponent(s.selectedGuildId) + '/inactive-reminder/send', method: 'POST', timeoutMs: 60000, body: { userIds: Array.from(selected) } }, 1);
      if (!response?.ok) {
        toast('Senden fehlgeschlagen: ' + (response?.data?.error || 'Unbekannter Fehler'), 'error');
        return;
      }
      const result = response.data?.result || {};
      const parts = ['Abgeschlossen'];
      if (Number(result.sent || 0) > 0) parts.push(Number(result.sent) + ' DM gesendet');
      if (Number(result.dmFailed || 0) > 0) parts.push(Number(result.dmFailed) + ' DM nicht möglich');
      if (Number(result.skipped || 0) > 0) parts.push(Number(result.skipped) + ' übersprungen (inzwischen aktiv/bereits erinnert)');
      toast(parts.join(' · '), Number(result.sent || 0) > 0 ? 'success' : 'info');
      inactiveReminderPreviewState = { list: [], selected: new Set() };
      if (host) host.innerHTML = '<p class="inactive-reminder-dm-empty">Fertig – die Auswahl wurde verarbeitet. Klicke erneut auf „Kandidaten anzeigen", um den aktuellen Stand zu sehen.</p>';
      void refreshInactiveReminderStatus();
    } catch (error) {
      toast('Senden fehlgeschlagen: ' + String(error?.message || error), 'error');
    } finally {
      if (sendButton) { sendButton.disabled = false; sendButton.textContent = 'Senden an ausgewählte'; }
    }
  }

  function inactiveReminderStudioTemplate(config) {
    const design = config?.dmDesign || {};
    const embed = design.embed || {};
    return {
      specialTemplate: 'inactiveReminder',
      channelId: '',
      content: String(design.content || ''),
      outsideImageUrl: design.outsideImageAttachment && design.outsideImageAttachment.anchored !== true && String(design.outsideImageAttachment.url || '').trim() ? '' : String(design.outsideImageUrl || ''),
      outsideImageName: String(design.outsideImageAttachment?.name || ''),
      outsideImageSize: Number(design.outsideImageAttachment?.size || 0),
      outsideImageAttachment: design.outsideImageAttachment || null,
      embeds: [{
        title: embed.title || '', url: embed.url || '', description: embed.description || '', color: embed.color || '#9a8cff',
        authorName: embed.authorName || '', authorIconUrl: embed.authorIconUrl || '', thumbnailUrl: embed.thumbnailUrl || '',
        imageUrl: embed.imageUrl || '', footerText: embed.footerText || '', footerIconUrl: embed.footerIconUrl || '',
        timestamp: embed.timestamp === true, fields: Array.isArray(embed.fields) ? clone(embed.fields).slice(0, 25) : []
      }],
      componentSet: 'none',
      reactionRoles: []
    };
  }

  function inactiveReminderPreviewValue(value) {
    const s = state();
    const guildName = s.guilds.find(function (guild) { return String(guild.id) === String(s.selectedGuildId); })?.name || 'FALLEN HEAVEN';
    return String(value || '')
      .replaceAll('{user}', '@MaxMuster')
      .replaceAll('{username}', 'MaxMuster')
      .replaceAll('{displayName}', 'Max Muster')
      .replaceAll('{guild}', guildName)
      .replaceAll('{server}', guildName)
      .replaceAll('{thresholdDays}', String(s.config?.inactiveReminder?.thresholdDays || 180))
      .replaceAll('{lastMessageAt}', '02.06.2026 um 18:42 Uhr')
      .replaceAll('{lastVoiceAt}', '15.05.2026 um 21:10 Uhr')
      .replaceAll('{lastActiveAt}', '02.06.2026 um 18:42 Uhr');
  }

  function inactiveReminderPreviewTemplate(template) {
    const s = state();
    if (s.studioSpecialTemplate !== 'inactiveReminder') return template;
    const preview = clone(template);
    preview.embeds = (preview.embeds || [preview.embed || {}]).map(function (source) {
      const embed = clone(source);
      ['title', 'description', 'authorName', 'footerText'].forEach(function (key) { embed[key] = inactiveReminderPreviewValue(embed[key]); });
      return embed;
    });
    preview.embed = preview.embeds[0] || {};
    return preview;
  }

  async function openInactiveReminderStudio() {
    const s = state();
    if (!s.authenticated || !s.selectedGuildId) {
      toast('Wähle zuerst einen Server.', 'error');
      return;
    }
    if (!(await setView('studio'))) return;
    await refreshConfig(s.selectedGuildId);
    s.activeStudioMessageId = '';
    s.studioSourceMessage = null;
    loadStudioTemplate(inactiveReminderStudioTemplate(s.config?.inactiveReminder));
    renderDrafts();
  }

  async function saveInactiveReminderStudioTemplate() {
    const s = state();
    if (!s.authenticated || !s.selectedGuildId) {
      toast('Wähle zuerst einen Server.', 'error');
      return false;
    }
    const template = currentStudioTemplate();
    const validation = renderStudioLimits(template);
    if (!validation.valid) {
      toast(validation.errors[0], 'error');
      return false;
    }
    if ((template.embeds?.length || (template.embed ? 1 : 0)) > 1) {
      toast('Die Erinnerungs-DM verwendet genau ein Embed.', 'error');
      return false;
    }
    return saveStudioDesign({
      path: '/api/guild/' + encodeURIComponent(s.selectedGuildId) + '/inactive-reminder/design',
      body: {
        template: {
          ...template,
          embeds: (template.embeds || [template.embed || {}]).slice(0, 1)
        }
      },
      errorMessage: 'Die Erinnerungs-DM konnte nicht gespeichert werden.',
      onSaved: function (result) {
        s.config.inactiveReminder = result.config?.inactiveReminder || s.config.inactiveReminder;
        loadStudioTemplate(inactiveReminderStudioTemplate(s.config.inactiveReminder));
      },
      okMessage: 'Erinnerungs-Embed gespeichert. Neue Erinnerungen nutzen es ab sofort.'
    });
  }

  window.FHCCInactiveReminderPanel = {
    overview: inactiveReminderOverview,
    refreshStatus: refreshInactiveReminderStatus,
    renderDmList: renderInactiveReminderDmList,
    cleanupDms: cleanupInactiveReminderDms,
    renderPagination: renderInactiveReminderPagination,
    sendManualDm: sendManualInactiveReminderDm,
    deleteDm: deleteInactiveReminderDm,
    deleteAllDms: deleteAllInactiveReminderDms,
    runPreviewAction: runInactiveReminderPreviewAction,
    renderPreviewList: renderInactiveReminderPreviewList,
    refreshSelection: refreshInactiveReminderSelection,
    runSendAction: runInactiveReminderSendAction,
    studioTemplate: inactiveReminderStudioTemplate,
    previewValue: inactiveReminderPreviewValue,
    previewTemplate: inactiveReminderPreviewTemplate,
    openStudio: openInactiveReminderStudio,
    saveStudioTemplate: saveInactiveReminderStudioTemplate,
    getPreviewState: function () { return inactiveReminderPreviewState; },
    setPreviewState: function (value) { inactiveReminderPreviewState = value; },
    getPage: function () { return inactiveReminderPage; },
    setPage: function (value) { inactiveReminderPage = value; },
    getPageSize: function () { return inactiveReminderPageSize; },
    setPageSize: function (value) { inactiveReminderPageSize = value; }
  };
})();
