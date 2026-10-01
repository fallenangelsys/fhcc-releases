(function () {
  'use strict';

  function g() { return globalThis; }
  function state() { return g().state || {}; }

  function countingOverview(config) {
    const active = config?.enabled === true;
    const channelReady = Boolean(String(config?.statusChannelId || '').trim());
    const panelReady = active && config?.statusPanelEnabled !== false && channelReady;
    const status = panelReady ? 'LIVE' : (active ? 'KANAL FEHLT' : 'AUS');
    const heading = panelReady ? 'Das Zähl-Panel läuft live.' : (active ? 'Kanal wählen, dann live.' : 'Zähl-Kanal ist deaktiviert.');
    return '<section id="counting-panel" class="activity-race-panel ' + (panelReady ? 'ready' : 'attention') + '">' +
      '<header><div><small>FALLEN HEAVEN · ZÄHL-KANAL</small><h3>' + heading + '</h3><p>' + (panelReady
        ? 'Das Panel-Embed steht im gewählten Kanal und wird bei jedem Zug automatisch aktualisiert – genau eine gepinnte Nachricht, die live mitgeht. Ist die gespeicherte Referenz veraltet, wird das vorhandene Panel übernommen statt eine neue Nachricht zu stapeln.'
        : 'Wähle unten den Status-Panel-Kanal. Danach kannst du das Panel-Embed im Studio gestalten – Titel, Beschreibung, Farben, Bilder, Felder und Nachricht sind frei editierbar, der Stand bleibt automatisch.') + '</p></div><span data-counting-panel-badge>' + status + '</span></header>' +
      '<div class="activity-race-actions"><div><b>Zähl-Panel-Embed gestalten</b><span>Embed Studio mit Live-Vorschau · Neben {count}, {next}, {lastCounter}, {lastCounterName}, {fails} und {lastFail} sind die Top-Plätze einzeln über {top1}/{topValue1}/{topMarker1} bis Platz 3 editierbar. Das alte {top}-Paket wird automatisch migriert.</span></div><button type="button" data-counting-open-studio>Zähl-Panel-Embed bearbeiten</button></div>' +
      '<div class="pcv-design-actions"><b>DM-Nachrichten gestalten</b>' +
        '<div class="pcv-design-group"><div class="pcv-design-grid">' +
          '<button type="button" data-counting-open-dm-studio="strikeLock"><span>🚫</span>Sperr-DM (Chat-Sperre)</button>' +
          '<button type="button" data-counting-open-dm-studio="strikeRelease"><span>✅</span>Freigabe-DM (Sperre vorbei)</button>' +
        '</div></div>' +
      '</div>' +
      '<div id="counting-locks-host"></div>' +
      '</section>';
  }

  function formatLockRemaining(ms) {
    const totalMinutes = Math.max(0, Math.floor(Number(ms || 0) / 60000));
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return days + ' Tag' + (days === 1 ? '' : 'e') + ' ' + hours + ' Std. ' + minutes + ' Min.';
    if (hours > 0) return hours + ' Std. ' + minutes + ' Min.';
    return Math.max(1, minutes) + ' Min.';
  }

  function lockAvatarHtml(lock) {
    const url = String(lock?.avatarUrl || '').trim();
    if (url) {
      return '<img class="module-lock-avatar" src="' + escapeHtml(url) + '" alt="" loading="lazy" referrerpolicy="no-referrer">';
    }
    return '<span class="module-lock-avatar module-lock-avatar-fallback" aria-hidden="true">🔒</span>';
  }

  function renderCountingLocks(host, locks) {
    if (!host) return;
    const items = Array.isArray(locks) ? locks : [];
    host.innerHTML = '<section class="activity-race-panel ' + (items.length ? '' : 'ready') + '" id="counting-locks-panel">' +
      '<header><div><small>FALLEN HEAVEN · ZÄHL-KANAL</small><h3>Gesperrte Spieler</h3><p>' + (items.length
        ? 'Diese Spieler haben aktuell eine Chat-Sperre im Zähl-Kanal – der Zugriff wird automatisch freigegeben, sobald die Sperrzeit abgelaufen ist. Du kannst eine Sperre hier jederzeit manuell aufheben.'
        : 'Aktuell ist niemand vom Zähl-Kanal gesperrt. Sperren entstehen automatisch nach wiederholten Verwarnungen und laufen nach der eingestellten Zeit ab.') + '</p></div><span data-counting-locks-badge>' + (items.length ? items.length + ' AKTIV' : 'FREI') + '</span></header>' +
      (items.length
        ? '<div class="module-lock-list">' + items.map(function (lock) {
          const name = String(lock.name || 'Unbekannt');
          return '<div class="module-lock-row">' +
            lockAvatarHtml(lock) +
            '<span class="module-lock-name">' + escapeHtml(name) + '</span>' +
            '<span class="module-lock-time">noch <b>' + formatLockRemaining(lock.remainingMs) + '</b></span>' +
            '<button type="button" data-counting-unlock="' + encodeURIComponent(String(lock.userId || '')) + '">Sperre aufheben</button>' +
            '</div>';
        }).join('') + '</div>'
        : '<p class="boost-top-empty">Keine aktiven Sperren – alles frei.</p>') +
      '</section>';
  }

  async function refreshCountingLocks() {
    const s = state();
    const host = document.getElementById('counting-locks-host');
    if (!host) return;
    if (!s.authenticated || !s.selectedGuildId) {
      host.innerHTML = '';
      return;
    }
    host.innerHTML = '<div class="module-stats-loading">Lade Sperren …</div>';
    const response = await apiRequestWithRetry({ path: '/api/guild/' + encodeURIComponent(s.selectedGuildId) + '/counting/locks', timeoutMs: 10000 }, 2);
    if (handleExpiredSession(response)) return;
    if (!response.ok) {
      host.innerHTML = '';
      return;
    }
    renderCountingLocks(host, response.data?.locks || []);
  }

  async function unlockCountingPlayer(userId) {
    const s = state();
    if (!userId || !s.selectedGuildId) return;
    const accepted = await showAppConfirm({
      title: 'Sperre aufheben?',
      message: 'Der Spieler kann danach sofort wieder im Zähl-Kanal zählen. Die Sperrzeit wird nicht weitergezählt.',
      confirmLabel: 'Sperre aufheben',
      cancelLabel: 'Abbrechen',
      tone: 'danger'
    });
    if (!accepted) return;
    const response = await api.apiRequest({
      path: '/api/guild/' + encodeURIComponent(s.selectedGuildId) + '/counting/locks/' + encodeURIComponent(userId),
      method: 'DELETE',
      timeoutMs: 20000
    });
    if (handleExpiredSession(response)) return;
    if (!response.ok) {
      toast(response.data?.error || 'Die Sperre konnte nicht aufgehoben werden.', 'error');
      return;
    }
    toast('Sperre aufgehoben – der Spieler kann wieder zählen.', 'success');
    void refreshCountingLocks();
  }

  function countingStudioTemplate(config) {
    const design = config?.panelDesign || {};
    const embed = design.embed || {};
    function expandedCountingTopLine(position) {
      return '{topMarker' + position + '} {top' + position + '} – **{topValue' + position + '}**';
    }
    function editableCountingTopValue(value) {
      let result = String(value || '').replaceAll('{top}', [1, 2, 3].map(expandedCountingTopLine).join('\n'));
      [1, 2, 3].forEach(function (position) {
        result = result.replaceAll('{topBlock' + position + '}', expandedCountingTopLine(position));
      });
      return result.replace(/\n{2,}/g, '\n');
    }
    const storedFields = Array.isArray(embed.fields) && embed.fields.length ? embed.fields : [
      { name: 'Zählerstand', value: '**{count}**\nNächste Zahl: **{next}**', inline: true },
      { name: 'Letzter Zähler', value: '{lastCounter}', inline: true },
      { name: 'Fehlversuche', value: '**{fails}**', inline: true },
      { name: '🏅 Beste Serien', value: '{topMarker1} {top1} – **{topValue1}**\n{topMarker2} {top2} – **{topValue2}**\n{topMarker3} {top3} – **{topValue3}**', inline: false }
    ];
    return {
      specialTemplate: 'countingPanel',
      channelId: String(config?.statusChannelId || ''),
      content: String(design.content || ''),
      outsideImageUrl: design.outsideImageAttachment && design.outsideImageAttachment.anchored !== true ? '' : String(design.outsideImageUrl || ''),
      outsideImageName: String(design.outsideImageAttachment?.name || 'fallen-heaven-counting.png'),
      outsideImageSize: Number(design.outsideImageAttachment?.size || 0),
      outsideImageAttachment: design.outsideImageAttachment || null,
      embeds: [{
        title: embed.title || '🔢 Aktueller Stand',
        url: embed.url || '',
        description: embed.description || '',
        color: embed.color || '#6ee7ff',
        authorName: embed.authorName || 'FALLEN HEAVEN · ZÄHL-KANAL',
        authorIconUrl: embed.authorIconUrl || '',
        thumbnailUrl: embed.thumbnailUrl || '',
        imageUrl: embed.imageUrl || '',
        footerText: embed.footerText || 'Nur die nächste Zahl zählt – viel Erfolg!',
        footerIconUrl: embed.footerIconUrl || '',
        timestamp: embed.timestamp !== false,
        fields: storedFields.slice(0, 21).map(function (field) {
          return { ...field, value: editableCountingTopValue(field.value) };
        })
      }],
      componentSet: 'none',
      reactionRoles: []
    };
  }

  function countingPreviewValue(value) {
    const s = state();
    return String(value || '')
      .replaceAll('{server}', (s.guilds.find(function (g) { return String(g.id) === String(s.selectedGuildId); }) || {}).name || 'FALLEN HEAVEN')
      .replaceAll('{count}', '1.234')
      .replaceAll('{next}', '1.235')
      .replaceAll('{lastCounter}', '@Beispiel')
      .replaceAll('{lastCounterName}', 'Beispiel')
      .replaceAll('{fails}', '3')
      .replaceAll('{lastFail}', '@Beispiel')
      .replaceAll('{top}', '🥇 @Beispiel – Best-Serie **5** (12 richtig)\n🥈 @Zweitbester – Best-Serie **4** (9 richtig)')
      .replaceAll('{top1}', '@Beispiel')
      .replaceAll('{top2}', '@Zweitbester')
      .replaceAll('{top3}', '')
      .replaceAll('{topValue1}', 'Best-Serie 5 (12 richtig)')
      .replaceAll('{topValue2}', 'Best-Serie 4 (9 richtig)')
      .replaceAll('{topValue3}', '')
      .replaceAll('{topMarker1}', '🥇')
      .replaceAll('{topMarker2}', '🥈')
      .replaceAll('{topMarker3}', '')
      .replaceAll('{topBlock1}', '🥇 @Beispiel – **Best-Serie 5 (12 richtig)**')
      .replaceAll('{topBlock2}', '🥈 @Zweitbester – **Best-Serie 4 (9 richtig)**')
      .replaceAll('{topBlock3}', '');
  }

  function countingPreviewTemplate(template) {
    const s = state();
    if (s.studioSpecialTemplate !== 'countingPanel') return template;
    const preview = clone(template);
    const embed = preview.embed || preview.embeds?.[0] || {};
    ['title', 'description', 'authorName', 'footerText'].forEach(function (key) { embed[key] = countingPreviewValue(embed[key]); });
    if (Array.isArray(embed.fields)) {
      embed.fields = embed.fields.map(function (field) {
        return { ...field, name: countingPreviewValue(field.name), value: countingPreviewValue(field.value) };
      });
    }
    preview.content = countingPreviewValue(preview.content);
    preview.embed = embed;
    preview.embeds = [embed];
    return preview;
  }

  async function openCountingStudio() {
    const s = state();
    if (!s.authenticated || !s.selectedGuildId) {
      toast('Wähle zuerst einen Server.', 'error');
      return;
    }
    if (!(await setView('studio'))) return;
    await refreshConfig(s.selectedGuildId);
    s.activeStudioMessageId = '';
    s.studioSourceMessage = null;
    loadStudioTemplate(countingStudioTemplate(s.config?.counting));
    renderDrafts();
    toast('Zähl-Panel-Embed im bestehenden Embed Studio geöffnet.', 'success');
  }

  async function saveCountingStudioTemplate() {
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
      toast('Das Zähl-Panel verwendet genau ein automatisch gepflegtes Embed.', 'error');
      return false;
    }
    return saveStudioDesign({
      path: '/api/guild/' + encodeURIComponent(s.selectedGuildId) + '/counting/design',
      body: {
        template: {
          ...template,
          embeds: (template.embeds || [template.embed || {}]).slice(0, 1),
          channelId: template.channelId || s.config?.counting?.statusChannelId || ''
        }
      },
      errorMessage: 'Das Zähl-Panel konnte nicht gespeichert werden.',
      onSaved: function (result) {
        s.config.counting = result.config?.counting || s.config.counting;
        loadStudioTemplate(countingStudioTemplate(s.config.counting));
      },
      okMessage: function (result) {
        const panelStatus = result.status || {};
        const panelAction = String(panelStatus.action || '');
        if (panelAction === 'posted' || panelAction === 'updated') {
          return 'Zähl-Panel gesendet und Live-Panel aktualisiert. Fehlt das Embed im Kanal, wird es automatisch neu gesendet.'
            + (s.config.counting?.enabled !== true ? ' (Das Zähl-Kanal-Modul ist noch deaktiviert – das Panel erscheint erst nach Aktivierung.)' : '');
        }
        if (panelAction === 'failed' && panelStatus.lastError) return 'Zähl-Panel gespeichert, aber das Senden ist fehlgeschlagen: ' + panelStatus.lastError;
        if (panelAction === 'no-channel') return 'Zähl-Panel gespeichert. Wähle zuerst einen Kanal – dann wird es automatisch gesendet.';
        return 'Zähl-Panel gespeichert. Es wird automatisch gesendet, sobald ein Kanal gewählt wurde.';
      },
      okType: function (result) {
        return String(result.status?.action || '') === 'failed' ? 'error' : 'success';
      }
    });
  }

  function countingDmStudioTemplate(config, sectionId) {
    const design = config?.dmDesigns?.[sectionId] || {};
    return {
      specialTemplate: 'countingDm',
      countingDmSection: sectionId,
      channelId: '',
      content: '',
      outsideImageUrl: '',
      outsideImageName: '',
      outsideImageSize: 0,
      outsideImageAttachment: null,
      embeds: [{
        title: design.title || '', url: design.url || '', description: design.description || '', color: design.color || '#2b2d31',
        authorName: design.authorName || '', authorIconUrl: design.authorIconUrl || '', thumbnailUrl: design.thumbnailUrl || '',
        imageUrl: design.imageUrl || '', footerText: design.footerText || '', footerIconUrl: design.footerIconUrl || '',
        timestamp: design.timestamp === true, fields: Array.isArray(design.fields) ? clone(design.fields).slice(0, 25) : []
      }],
      componentSet: 'none',
      reactionRoles: []
    };
  }

  function countingDmPreviewValue(value) {
    const s = state();
    const guildName = s.guilds.find(function (guild) { return String(guild.id) === String(s.selectedGuildId); })?.name || 'FALLEN HEAVEN';
    return String(value || '')
      .replaceAll('{server}', guildName)
      .replaceAll('{guild}', guildName)
      .replaceAll('{target}', 'Max Muster')
      .replaceAll('{targetMention}', '@MaxMuster')
      .replaceAll('{limit}', '3')
      .replaceAll('{hours}', '24');
  }

  function countingDmPreviewTemplate(template) {
    const s = state();
    if (s.studioSpecialTemplate !== 'countingDm') return template;
    const preview = clone(template);
    preview.embeds = (preview.embeds || [preview.embed || {}]).map(function (source) {
      const embed = clone(source);
      ['title', 'description', 'authorName', 'footerText'].forEach(function (key) { embed[key] = countingDmPreviewValue(embed[key]); });
      return embed;
    });
    preview.embed = preview.embeds[0] || {};
    return preview;
  }

  async function openCountingDmStudio(sectionId) {
    const s = state();
    if (!s.authenticated || !s.selectedGuildId) {
      toast('Wähle zuerst einen Server.', 'error');
      return;
    }
    if (!(await setView('studio'))) return;
    await refreshConfig(s.selectedGuildId);
    s.activeStudioMessageId = '';
    s.studioSourceMessage = null;
    s.studioCountingDmSection = String(sectionId || 'strikeLock');
    loadStudioTemplate(countingDmStudioTemplate(s.config?.counting, s.studioCountingDmSection));
    renderDrafts();
    toast('DM-Embed im bestehenden Embed Studio geöffnet.', 'success');
  }

  async function saveCountingDmStudioTemplate() {
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
      toast('Die DM-Nachricht verwendet genau ein Embed.', 'error');
      return false;
    }
    return saveStudioDesign({
      path: '/api/guild/' + encodeURIComponent(s.selectedGuildId) + '/counting/design',
      body: {
        section: s.studioCountingDmSection || 'strikeLock',
        template: {
          ...template,
          embeds: (template.embeds || [template.embed || {}]).slice(0, 1)
        }
      },
      errorMessage: 'Die DM-Nachricht konnte nicht gespeichert werden.',
      onSaved: function (result) {
        s.config.counting = result.config?.counting || s.config.counting;
        loadStudioTemplate(countingDmStudioTemplate(s.config.counting, s.studioCountingDmSection));
      },
      okMessage: 'DM-Embed gespeichert. Neue Sperren/Freigaben nutzen es ab sofort.'
    });
  }

  window.FHCCCountingPanel = {
    overview: countingOverview,
    studioTemplate: countingStudioTemplate,
    previewValue: countingPreviewValue,
    previewTemplate: countingPreviewTemplate,
    openStudio: openCountingStudio,
    saveStudioTemplate: saveCountingStudioTemplate,
    dmStudioTemplate: countingDmStudioTemplate,
    dmPreviewValue: countingDmPreviewValue,
    dmPreviewTemplate: countingDmPreviewTemplate,
    openDmStudio: openCountingDmStudio,
    saveDmStudioTemplate: saveCountingDmStudioTemplate,
    refreshLocks: refreshCountingLocks,
    unlockPlayer: unlockCountingPlayer
  };
})();
