(function () {
  'use strict';

  const cloneValue = (value) => JSON.parse(JSON.stringify(value || null));

  function defaultTemplate() {
    return {
      content: '',
      embeds: [{
        title: '👑 VIP-VORTEILE',
        description: 'Mit einem VIP-Rang unterstützt du **{server}** und erhältst Zugang zu zusätzlichen Bereichen und Community-Vorteilen.',
        color: '#7772ff',
        authorName: '{server}',
        authorIconUrl: '',
        thumbnailUrl: '',
        imageUrl: '',
        footerText: '{server} · Heaven Coins',
        footerIconUrl: '',
        timestamp: false,
        fields: [
          { name: '🌟 Hervorgehobene Präsenz', value: 'Dein VIP-Rang hebt dich sichtbar innerhalb der Community hervor.', inline: false },
          { name: '📸 VIP-Media', value: 'Zugang zu einem eigenen Bereich für Bilder, Clips und besondere Community-Momente.', inline: false },
          { name: '🎤 VIP-Lounges', value: 'Nutze zusätzliche Voice-Bereiche, die VIP-Mitgliedern vorbehalten sind.', inline: false },
          { name: '💬 VIP-Bereiche', value: 'Je nach VIP-Stufe erhältst du Zugang zu den vorgesehenen Chats und Lounges.', inline: false },
          { name: '🎁 Aktionen & Early Access', value: 'Nimm an exklusiven Aktionen teil und erhalte ausgewählte Informationen früher.', inline: false },
          { name: '⚡ Priority Support', value: 'VIP-Anliegen werden im Support bevorzugt bearbeitet.', inline: false }
        ]
      }]
    };
  }

  function studioTemplate(config) {
    const source = config?.panelTemplate && typeof config.panelTemplate === 'object'
      ? cloneValue(config.panelTemplate)
      : defaultTemplate();
    const embeds = Array.isArray(source.embeds) && source.embeds.length
      ? source.embeds.slice(0, 10)
      : [source.embed || defaultTemplate().embeds[0]];
    return {
      specialTemplate: 'economyPanel',
      channelId: String(config?.panelChannelId || ''),
      content: String(source.content || ''),
      outsideImageUrl: String(source.outsideImageUrl || ''),
      outsideImageName: String(source.outsideImageName || source.outsideImageAttachment?.name || ''),
      outsideImageSize: Number(source.outsideImageSize || source.outsideImageAttachment?.size || 0),
      outsideImageAttachment: source.outsideImageAttachment ? cloneValue(source.outsideImageAttachment) : null,
      embed: embeds[0],
      embeds,
      componentSet: 'heavenEconomy',
      reactionRoles: []
    };
  }

  function previewValue(value, state) {
    const guildName = (state.guilds || []).find(function (guild) {
      return String(guild.id) === String(state.selectedGuildId);
    })?.name || 'FALLEN HEAVEN';
    const config = state.config?.heavenEconomy || {};
    return String(value || '')
      .replaceAll('{server}', guildName)
      .replaceAll('{coinEmoji}', '🪙')
      .replaceAll('{boostMilestoneReward}', String(config.boostMilestoneReward || 100) + ' Coins');
  }

  function previewTemplate(template, state) {
    if (state.studioSpecialTemplate !== 'economyPanel') return template;
    const preview = cloneValue(template);
    const sources = Array.isArray(preview.embeds) && preview.embeds.length ? preview.embeds.slice(0, 10) : [preview.embed || {}];
    const embeds = sources.map(function (source) {
      const embed = cloneValue(source);
      ['title', 'description', 'authorName', 'footerText'].forEach(function (key) { embed[key] = previewValue(embed[key], state); });
      embed.fields = (Array.isArray(embed.fields) ? embed.fields : []).map(function (field) {
        return { ...field, name: previewValue(field.name, state), value: previewValue(field.value, state) };
      });
      return embed;
    });
    preview.content = previewValue(preview.content, state);
    preview.embed = embeds[0];
    preview.embeds = embeds;
    return preview;
  }

  function overview(config, state, escapeHtml) {
    const active = config?.enabled === true;
    const channelId = String(config?.panelChannelId || '');
    const channelName = channelId
      ? String(state.moduleChannels?.find(function (entry) { return String(entry.id) === channelId; })?.name || channelId)
      : '';
    const status = active && channelId ? 'LIVE' : active ? 'KANAL FEHLT' : 'AUS';
    const detail = active && channelId
      ? 'Ein dauerhaftes VIP-Vorteile-Embed in <code>#' + escapeHtml(channelName) + '</code>. Speichern aktualisiert genau diese Nachricht.'
      : 'Wähle den Economy-Panel-Kanal und aktiviere das Modul. Der Bot erstellt danach genau ein dauerhaftes Panel.';
    return '<section class="activity-race-overview welcome-template-overview boost-announce-overview economy-benefits-overview"><header><div><small>VIP-VORTEILE-PANEL</small><strong>Bis zu 10 Embeds in einer Nachricht</strong><p>' + detail + '</p></div><em>' + status + '</em></header><div class="activity-race-actions"><div><b>Öffentliches Economy-Panel gestalten</b><span>Bis zu zehn Embeds mit frei editierbaren Texten, Bildern und Feldern. Die echten Economy-Buttons verwaltet der Bot automatisch.</span></div><button type="button" data-economy-panel-open-studio>VIP-Vorteile-Panel bearbeiten</button></div></section>';
  }

  async function open(context) {
    const { state, setView, refreshConfig, loadStudioTemplate, renderDrafts, toast } = context;
    if (!state.authenticated || !state.selectedGuildId) {
      toast('Wähle zuerst einen Server.', 'error');
      return false;
    }
    if (!(await setView('studio'))) return false;
    await refreshConfig(state.selectedGuildId);
    state.activeStudioMessageId = '';
    state.studioSourceMessage = null;
    loadStudioTemplate(studioTemplate(state.config?.heavenEconomy));
    renderDrafts();
    toast('VIP-Vorteile-Panel im Embed Studio geöffnet.', 'success');
    return true;
  }

  async function save(context) {
    const { state, currentStudioTemplate, renderStudioLimits, saveStudioDesign, loadStudioTemplate, toast } = context;
    if (!state.authenticated || !state.selectedGuildId) {
      toast('Wähle zuerst einen Server.', 'error');
      return false;
    }
    const template = currentStudioTemplate();
    const validation = renderStudioLimits(template);
    if (!validation.valid) {
      toast(validation.errors[0], 'error');
      return false;
    }
    return saveStudioDesign({
      path: '/api/guild/' + encodeURIComponent(state.selectedGuildId) + '/heaven-economy/panel-design',
      body: {
        template: { ...template, embeds: (template.embeds || [template.embed || {}]).slice(0, 10) },
        channelId: template.channelId || ''
      },
      errorMessage: 'Das VIP-Vorteile-Panel konnte nicht gespeichert werden.',
      onSaved: function (result) {
        state.config.heavenEconomy = result.config?.heavenEconomy || state.config.heavenEconomy;
        loadStudioTemplate(studioTemplate(state.config.heavenEconomy));
      },
      okMessage: function (result) {
        if (result.refreshError) return 'Design gespeichert. Discord-Panel konnte gerade nicht aktualisiert werden: ' + result.refreshError;
        return result.liveUpdated
          ? 'VIP-Vorteile-Panel gespeichert und live aktualisiert.'
          : 'VIP-Vorteile-Panel gespeichert. Es wird nach Aktivierung und Kanalauswahl erstellt.';
      },
      okType: function (result) { return result.refreshError ? 'info' : 'success'; }
    });
  }

  function applyChrome() {
    const banner = document.getElementById('studio-special-template');
    const view = document.getElementById('studio-view');
    const placeholders = banner?.querySelector('[data-studio-special-placeholders]');
    const setText = function (selector, value) { const node = document.querySelector(selector); if (node) node.textContent = value; };
    setText('[data-studio-special-title]', 'Heaven Economy');
    setText('[data-studio-special-detail]', 'Diese eine öffentliche Nachricht darf bis zu zehn frei editierbare Embeds enthalten. Die funktionalen Economy-Buttons setzt der Bot einmal unter die gesamte Nachricht.');
    if (placeholders) placeholders.innerHTML = ['{server}', '{coinEmoji}', '{boostMilestoneReward}'].map(function (entry) { return '<code>' + entry + '</code>'; }).join('');
    const heading = view?.querySelector('.page-head h1');
    const detail = view?.querySelector('.page-head h1 + p');
    if (heading) heading.textContent = 'VIP-Vorteile-Panel im Embed Studio.';
    if (detail) detail.textContent = 'Gestalte bis zu zehn Embeds in einer öffentlichen Economy-Nachricht. Die Vorschau zeigt die echten Funktionen, Discord erhält beim Speichern die aktiven Buttons.';
    setText('#save-draft', 'Speichern & Panel aktualisieren');
    setText('#send-studio-message', 'Speichern & Panel aktualisieren');
    setText('#send-studio-message-secondary', 'Speichern & Panel aktualisieren');
    setText('#clear-content', 'VIP-Vorteile-Standard laden');
  }

  window.FHCCEconomyPanelStudio = { defaultTemplate, studioTemplate, previewValue, previewTemplate, overview, open, save, applyChrome };
})();
