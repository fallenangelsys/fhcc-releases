(function () {
  function create(dependencies) {
    const deps = dependencies || {};
    const getState = deps.getState;
    let refreshTimer = null;
    let refreshInFlight = null;
    let refreshGeneration = 0;
    let studioBaseline = '';

    function appState() {
      return getState();
    }

    function overview(config) {
      const active = config?.enabled === true;
      const creators = deps.settingLines(config?.creatorChannelIds).length;
      const ready = active && creators > 0;
      const grace = Math.max(5, Number(config?.emptyGraceSeconds || 30));
      return '<section id="temp-voice-panel" class="server-tag-tracker-panel temp-voice-panel ' + (ready ? 'ready' : 'attention') + '" data-state="idle">' +
        '<header><span><small>TEMPVOICE · ' + creators + ' SETUP-KANAL' + (creators === 1 ? '' : 'ÄLE') + '</small><strong data-temp-voice-title>' + (ready ? 'TempVoice wird geladen …' : active ? 'Setup-Kanäle auswählen' : 'Modul ist deaktiviert') + '</strong><p data-temp-voice-detail>Wer einen Setup-Kanal joint, bekommt automatisch einen eigenen temporären Sprachkanal. Der Besitzer verwaltet ihn über das Interface.</p></span><div><em data-temp-voice-badge>' + (ready ? 'BEREIT' : 'KONFIGURIEREN') + '</em><button type="button" data-temp-voice-open-studio>TempVoice-Embed bearbeiten</button><button type="button" data-refresh-temp-voice>Live-Status laden</button></div></header>' +
        '<div class="server-tag-summary">' +
          '<article><small>SETUP-KANÄLE</small><b data-temp-voice-creators>' + creators.toLocaleString('de-DE') + '</b><p>Wer diesen Kanal joint, bekommt seinen eigenen Kanal.</p></article>' +
          '<article><small>AKTIVE KANÄLE</small><b data-temp-voice-active>0</b><p>Temporäre Kanäle, die gerade bestehen.</p></article>' +
          '<article><small>PROFILE</small><b data-temp-voice-profile-count>0</b><p>Gespeicherte Namen, Limits und Regionen.</p></article>' +
          '<article><small>LÖSCHFRIST</small><b>' + grace.toLocaleString('de-DE') + ' Sek.</b><p>Leere Kanäle werden nach dieser Frist entfernt.</p></article>' +
          '<article><small>AKTIVER STATUS</small><b data-temp-voice-status>Bereit</b><p data-temp-voice-mode>' + (active ? 'Modul aktiv' : 'Modul ausgeschaltet') + '</p></article>' +
        '</div>' +
        '<div class="server-tag-live" data-temp-voice-live role="status" aria-live="polite"><div class="server-tag-progress"><i data-temp-voice-progress></i></div><span data-temp-voice-progress-text>Status wird geladen …</span></div>' +
        '<div class="temp-voice-lists">' +
          '<section><header><span><small>AKTIVE KANÄLE</small><strong>Live-Zustand</strong></span></header><div class="temp-voice-list" data-temp-voice-channels aria-live="polite"><p class="temp-voice-empty">Status wird geladen …</p></div></section>' +
          '<section><header><span><small>PROFILE</small><strong>Gemerktes Setup</strong></span><button type="button" class="temp-voice-reset-all" data-temp-voice-reset-all title="Alle TempVoice-Profile zurücksetzen">Alle zurücksetzen</button></header><div class="temp-voice-list" data-temp-voice-profiles aria-live="polite"><p class="temp-voice-empty">Status wird geladen …</p></div></section>' +
        '</div>' +
        '<p class="activity-race-safety"><b>Interface:</b> Der Besitzer kann umbenennen, Limit setzen, sperren/öffnen, blockieren, Besitz übernehmen/übertragen, Region und Thread ändern sowie den Kanal löschen. Leere Kanäle verschwinden automatisch. Neue Kanäle erben die Berechtigungen ihrer Kategorie und nutzen automatisch die beste erlaubte Bitrate (bis 384 kbps).</p>' +
        '</section>';
    }

    async function refreshStatus(options) {
      const settings = options || {};
      const state = appState();
      if (!state.authenticated || !state.selectedGuildId || state.activeFeatureId !== 'tempVoice') return;
      const guildId = String(state.selectedGuildId);
      if (refreshInFlight?.guildId === guildId) return refreshInFlight.promise;
      const generation = ++refreshGeneration;
      const panel = document.getElementById('temp-voice-panel');
      const promise = (async function () {
        if (panel) {
          panel.dataset.state = 'loading';
          const progress = panel.querySelector('[data-temp-voice-progress]');
          const progressText = panel.querySelector('[data-temp-voice-progress-text]');
          if (progress) progress.style.width = '100%';
          if (progressText) progressText.textContent = 'Status wird geladen …';
        }
        const response = await deps.apiRequestWithRetry({ path: '/api/guild/' + encodeURIComponent(guildId) + '/temp-voice', timeoutMs: 12000 }, 2);
        const current = appState();
        if (generation !== refreshGeneration || String(current.selectedGuildId) !== guildId || current.activeFeatureId !== 'tempVoice') return;
        if (deps.handleExpiredSession(response)) {
          if (panel) panel.dataset.state = 'idle';
          const progress = panel?.querySelector('[data-temp-voice-progress]');
          if (progress) progress.style.width = '0%';
          return;
        }
        if (!response.ok) {
          if (!settings.silent) deps.toast(response.data?.error || 'TempVoice-Status konnte nicht geladen werden.', 'error');
          if (panel) panel.dataset.state = 'error';
          const progress = panel?.querySelector('[data-temp-voice-progress]');
          const progressText = panel?.querySelector('[data-temp-voice-progress-text]');
          if (progress) progress.style.width = '0%';
          if (progressText) progressText.textContent = 'Status konnte nicht geladen werden · erneut versuchen';
          return;
        }
        renderStatus(response.data?.status || {});
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(function () {
          void refreshStatus({ silent: true });
        }, 30000);
      })();
      refreshInFlight = { guildId, promise };
      try {
        return await promise;
      } finally {
        if (refreshInFlight?.promise === promise) refreshInFlight = null;
      }
    }

    function renderStatus(status) {
      const panel = document.getElementById('temp-voice-panel');
      if (!panel) return;
      panel.dataset.state = 'idle';
      const active = Number(status?.activeChannelCount || 0);
      const channels = Array.isArray(status?.channels) ? status.channels : [];
      const profiles = Array.isArray(status?.profiles) ? status.profiles : [];
      const profileCount = Number(status?.profileCount ?? profiles.length);
      const setText = function (selector, value) {
        const node = panel.querySelector(selector);
        if (node) node.textContent = value;
      };
      setText('[data-temp-voice-active]', active.toLocaleString('de-DE'));
      setText('[data-temp-voice-profile-count]', profileCount.toLocaleString('de-DE'));
      setText('[data-temp-voice-status]', status?.enabled ? 'Aktiv' : 'Aus');
      const title = panel.querySelector('[data-temp-voice-title]');
      if (title) title.textContent = status?.enabled ? 'TempVoice läuft.' : 'Modul ist deaktiviert';
      const progress = panel.querySelector('[data-temp-voice-progress]');
      const progressText = panel.querySelector('[data-temp-voice-progress-text]');
      if (progress) progress.style.width = '0%';
      if (progressText) progressText.textContent = 'Live' + (active ? ' · ' + active + ' aktive Kanäle' : '');

      const channelList = panel.querySelector('[data-temp-voice-channels]');
      if (channelList) {
        channelList.innerHTML = channels.length ? channels.map(function (channel) {
          const members = Math.max(0, Number(channel.memberCount || 0));
          const limit = Math.max(0, Number(channel.userLimit || 0));
          const createdAt = channel.createdAt ? deps.formatDate(channel.createdAt) : 'Unbekannt';
          return '<article class="temp-voice-row temp-voice-channel-row">' +
            '<span class="temp-voice-row-copy"><b>' + deps.escapeHtml(channel.name || channel.channelName || 'Unbekannter Kanal') + '</b><small>Besitzer: ' + deps.escapeHtml(channel.ownerName || channel.owner || channel.ownerId || 'Unbekannt') + '</small></span>' +
            '<span class="temp-voice-row-meta"><em>' + members.toLocaleString('de-DE') + ' Mitglieder</em><em>' + (limit ? 'Limit ' + limit.toLocaleString('de-DE') : 'Kein Limit') + '</em><em>' + deps.escapeHtml(channel.rtcRegion || channel.region || 'Automatisch') + '</em><em class="' + (channel.locked ? 'locked' : 'open') + '">' + (channel.locked ? 'Gesperrt' : 'Offen') + '</em><em>' + deps.escapeHtml(createdAt) + '</em></span>' +
          '</article>';
        }).join('') : '<p class="temp-voice-empty">Gerade ist kein temporärer Sprachkanal aktiv.</p>';
      }

      const profileList = panel.querySelector('[data-temp-voice-profiles]');
      if (profileList) {
        profileList.innerHTML = profiles.length ? profiles.map(function (profile) {
          const limit = Math.max(0, Number(profile.userLimit || 0));
          const updatedAt = profile.updatedAt ? deps.formatDate(profile.updatedAt) : 'Unbekannt';
          return '<article class="temp-voice-row temp-voice-profile-row">' +
            '<span class="temp-voice-row-copy"><b>' + deps.escapeHtml(profile.memberName || profile.displayName || profile.username || profile.userId || 'Unbekanntes Mitglied') + '</b><small>' + deps.escapeHtml(profile.customName || 'Standardname') + '</small></span>' +
            '<span class="temp-voice-row-meta"><em>' + (limit ? 'Limit ' + limit.toLocaleString('de-DE') : 'Kein Limit') + '</em><em>' + deps.escapeHtml(profile.rtcRegion || profile.region || 'Automatisch') + '</em><em>' + deps.escapeHtml(updatedAt) + '</em></span>' +
            '<button type="button" class="temp-voice-reset-profile" title="Persönliches TempVoice-Setup zurücksetzen" aria-label="Persönliches TempVoice-Setup zurücksetzen" data-temp-voice-reset-profile="' + deps.escapeAttr(profile.userId || '') + '"><span aria-hidden="true">↺</span></button>' +
          '</article>';
        }).join('') : '<p class="temp-voice-empty">Noch kein persönliches Setup gespeichert.</p>';
      }

      const resetAllButton = panel.querySelector('[data-temp-voice-reset-all]');
      if (resetAllButton) resetAllButton.disabled = profiles.length === 0;
    }

    async function resetProfile(userId, button) {
      const accepted = await deps.showConfirm({
        tone: 'warning',
        eyebrow: 'TEMPVOICE · PROFIL',
        title: 'Persönliches Setup zurücksetzen?',
        message: 'Beim nächsten Kanal gelten wieder Name, Limit und Region aus den Modul-Standards.',
        confirmLabel: 'Profil zurücksetzen'
      });
      if (!accepted) return;
      if (button) button.disabled = true;
      try {
        const response = await deps.apiRequest({
          path: '/api/guild/' + encodeURIComponent(appState().selectedGuildId) + '/temp-voice/profiles/' + encodeURIComponent(userId),
          method: 'DELETE',
          timeoutMs: 20000
        });
        if (deps.handleExpiredSession(response)) return;
        if (!response.ok || response.data?.result?.ok === false) {
          deps.toast(response.data?.error || 'Das TempVoice-Profil konnte nicht zurückgesetzt werden.', 'error');
          return;
        }
        deps.toast(response.data?.result?.removed === false ? 'Für dieses Mitglied war kein TempVoice-Profil gespeichert.' : 'TempVoice-Profil zurückgesetzt.', 'success');
        await refreshStatus({ silent: true });
      } finally {
        if (button?.isConnected) button.disabled = false;
      }
    }

    async function resetAllProfiles(button) {
      const accepted = await deps.showConfirm({
        tone: 'danger',
        eyebrow: 'TEMPVOICE · ALLE PROFILE',
        title: 'Alle persönlichen Setups zurücksetzen?',
        message: 'Alle gemerkten Kanalnamen, Limits und Regionen dieses Servers werden gelöscht. Diese Aktion betrifft jeden TempVoice-Besitzer.',
        confirmLabel: 'Alle Profile zurücksetzen'
      });
      if (!accepted) return;
      if (button) button.disabled = true;
      try {
        const response = await deps.apiRequest({
          path: '/api/guild/' + encodeURIComponent(appState().selectedGuildId) + '/temp-voice/profiles',
          method: 'DELETE',
          timeoutMs: 20000
        });
        if (deps.handleExpiredSession(response)) return;
        if (!response.ok || response.data?.result?.ok === false) {
          deps.toast(response.data?.error || 'Die TempVoice-Profile konnten nicht zurückgesetzt werden.', 'error');
          return;
        }
        const removedCount = Math.max(0, Number(response.data?.result?.removedCount || 0));
        deps.toast(removedCount.toLocaleString('de-DE') + (removedCount === 1 ? ' Profil zurückgesetzt.' : ' Profile zurückgesetzt.'), 'success');
        await refreshStatus({ silent: true });
      } finally {
        if (button?.isConnected) button.disabled = false;
      }
    }

    function defaultStudioEmbed() {
      return {
        title: 'TempVoice · {channelName}',
        url: '',
        description: 'Willkommen {owner}. Du verwaltest diesen temporären Sprachkanal mit den Buttons unter dem Embed.',
        color: '#2b2d31',
        authorName: '{server}',
        authorIconUrl: '',
        thumbnailUrl: '',
        imageUrl: '',
        footerText: '{server}',
        footerIconUrl: '',
        timestamp: false,
        fields: [
          { name: 'Besitzer', value: '{owner}', inline: true },
          { name: 'Zugang', value: '{accessState}', inline: true },
          { name: 'Mitglieder', value: '{memberCount} / {userLimit}', inline: true },
          { name: 'Region', value: '{region}', inline: true },
          { name: 'Erstellt', value: '{createdAt}', inline: true }
        ]
      };
    }

    function studioTemplate(config) {
      const design = config?.interfaceDesign || {};
      return {
        specialTemplate: 'tempVoiceInterface',
        channelId: '',
        content: String(design.content || ''),
        outsideImageUrl: String(design.outsideImageUrl || ''),
        outsideImageName: String(design.outsideImageAttachment?.name || ''),
        outsideImageSize: Number(design.outsideImageAttachment?.size || 0),
        outsideImageAttachment: design.outsideImageAttachment ? deps.clone(design.outsideImageAttachment) : null,
        embeds: [deps.clone(design.embed || defaultStudioEmbed())],
        componentSet: 'none',
        studioComponents: [],
        reactionRoles: []
      };
    }

    function previewValue(value, mode) {
      const state = appState();
      const guildName = state.guilds.find(function (guild) { return String(guild.id) === String(state.selectedGuildId); })?.name || 'FALLEN HEAVEN';
      const plain = mode === 'plain';
      return String(value || '')
        .replaceAll('{owner}', plain ? 'Owner' : '@Owner')
        .replaceAll('{ownerName}', 'Owner')
        .replaceAll('{channelName}', 'Night Lounge')
        .replaceAll('{createdAt}', plain ? '24.08.2026, 12:00' : 'vor 5 Minuten')
        .replaceAll('{userLimit}', '6')
        .replaceAll('{region}', 'Europa')
        .replaceAll('{accessState}', 'Gesperrt')
        .replaceAll('{memberCount}', '3')
        .replaceAll('{server}', guildName);
    }

    function previewTemplate(template) {
      if (appState().studioSpecialTemplate !== 'tempVoiceInterface') return template;
      const preview = deps.clone(template);
      preview.content = previewValue(preview.content, 'rich');
      preview.embeds = (preview.embeds || [preview.embed || {}]).slice(0, 1).map(function (source) {
        const embed = deps.clone(source);
        embed.title = previewValue(embed.title, 'plain');
        embed.description = previewValue(embed.description, 'rich');
        embed.authorName = previewValue(embed.authorName, 'plain');
        embed.footerText = previewValue(embed.footerText, 'plain');
        embed.fields = (embed.fields || []).map(function (field) {
          return { ...field, name: previewValue(field.name, 'plain'), value: previewValue(field.value, 'rich') };
        });
        return embed;
      });
      preview.embed = preview.embeds[0] || {};
      preview.componentSet = 'none';
      preview.studioComponents = [];
      preview.reactionRoles = [];
      return preview;
    }

    function plainPreview(value) {
      return String(value || '');
    }

    function studioFingerprint(template) {
      const source = template || deps.currentStudioTemplate();
      const embeds = (source.embeds || [source.embed || {}]).slice(0, 1);
      return JSON.stringify({
        content: String(source.content || ''),
        outsideImageUrl: String(source.outsideImageUrl || ''),
        outsideImageName: String(source.outsideImageName || ''),
        outsideImageSize: Number(source.outsideImageSize || 0),
        outsideImageAttachment: source.outsideImageAttachment || null,
        removeOutsideImage: source.removeOutsideImage === true,
        embeds
      });
    }

    function rememberStudioBaseline() {
      studioBaseline = studioFingerprint();
    }

    function hasUnsavedStudioChanges() {
      return appState().studioSpecialTemplate === 'tempVoiceInterface' &&
        Boolean(studioBaseline) &&
        studioFingerprint() !== studioBaseline;
    }

    async function confirmLeaveStudio() {
      if (!hasUnsavedStudioChanges()) return true;
      const discard = await deps.showConfirm({
        tone: 'danger',
        eyebrow: 'UNGESPEICHERTES TEMPVOICE-EMBED',
        title: 'TempVoice Studio wirklich verlassen?',
        message: 'Deine Änderungen am TempVoice-Interface wurden noch nicht gespeichert und würden verloren gehen.',
        cancelLabel: 'Weiter bearbeiten',
        confirmLabel: 'Änderungen verwerfen'
      });
      if (discard) studioBaseline = '';
      return discard;
    }

    async function openStudio() {
      const state = appState();
      if (!state.authenticated || !state.selectedGuildId) {
        deps.toast('Wähle zuerst einen Server.', 'error');
        return;
      }
      if (!(await deps.setView('studio'))) return;
      await deps.refreshConfig(state.selectedGuildId);
      state.activeStudioMessageId = '';
      state.studioSourceMessage = null;
      deps.loadStudioTemplate(studioTemplate(state.config?.tempVoice));
      rememberStudioBaseline();
      deps.renderDrafts();
    }

    async function saveStudioTemplate() {
      const state = appState();
      if (!state.authenticated || !state.selectedGuildId) {
        deps.toast('Wähle zuerst einen Server.', 'error');
        return false;
      }
      const template = deps.currentStudioTemplate();
      const validation = deps.renderStudioLimits(template);
      if (!validation.valid) {
        deps.toast(validation.errors[0], 'error');
        return false;
      }
      if ((template.embeds?.length || (template.embed ? 1 : 0)) !== 1) {
        deps.toast('Das TempVoice-Interface verwendet genau ein Embed.', 'error');
        return false;
      }
      return deps.saveStudioDesign({
        path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/temp-voice/design',
        body: {
          template: {
            ...template,
            channelId: '',
            componentSet: 'none',
            studioComponents: [],
            components: [],
            reactionRoles: [],
            embeds: (template.embeds || [template.embed || {}]).slice(0, 1)
          }
        },
        errorMessage: 'Das TempVoice-Embed konnte nicht gespeichert werden.',
        onSaved: function (result) {
          state.config.tempVoice = result.config?.tempVoice || {
            ...state.config.tempVoice,
            interfaceDesign: result.design
          };
          deps.loadStudioTemplate(studioTemplate(state.config.tempVoice));
          rememberStudioBaseline();
        },
        okMessage: function (result) {
          const refresh = result.refresh || {};
          return 'TempVoice-Embed gespeichert · ' + Number(refresh.updated || 0) + ' aktiv aktualisiert' + (Number(refresh.failed || 0) ? ' · ' + Number(refresh.failed) + ' fehlgeschlagen' : '');
        },
        okType: function (result) { return Number(result.refresh?.failed || 0) ? 'info' : 'success'; }
      });
    }

    return {
      overview,
      refreshStatus,
      renderStatus,
      resetProfile,
      resetAllProfiles,
      defaultStudioEmbed,
      studioTemplate,
      previewTemplate,
      plainPreview,
      hasUnsavedStudioChanges,
      confirmLeaveStudio,
      openStudio,
      saveStudioTemplate
    };
  }

  window.FHCCTempVoiceUI = { create };
})();
