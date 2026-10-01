(function () {
  const ACTIVITY_RACE_LEGACY_DESCRIPTION = 'Die aktivsten Mitglieder im Chat und Sprachchat';

  function sectionKey(section) {
    if (section === 'ping-info') return 'ping-info';
    return section === 'weekly' ? 'weekly' : section === 'monthly' ? 'monthly' : 'daily';
  }

  function currentState(explicitState) {
    return explicitState || globalThis.state || {};
  }

  function cloneValue(value) {
    if (typeof globalThis.clone === 'function') return globalThis.clone(value);
    return JSON.parse(JSON.stringify(value || null));
  }

  function completionText(config, section) {
    const key = sectionKey(section);
    const fallback = {
      daily: 'Die Tagesrollen zeigen den aktuellen Stand und wechseln automatisch, sobald sich Platz 1 bis 3 verändern.',
      weekly: 'Die Rollen werden erst am Wochenabschluss für die vollständige Kalenderwoche vergeben.',
      monthly: 'Die Rollen werden erst am Monatsabschluss für den vollständigen Kalendermonat vergeben.'
    }[key];
    const configKey = key === 'weekly' ? 'completionWeekly' : key === 'monthly' ? 'completionMonthly' : 'completionDaily';
    return String(config?.[configKey] || fallback);
  }

  function resolvePreview(text, explicitState) {
    const appState = currentState(explicitState);
    const activeSection = sectionKey(appState.studioActivityRaceSection);
    const sectionLabel = activeSection === 'weekly' ? 'Vergangene Woche' : activeSection === 'monthly' ? 'Vergangener Monat' : activeSection === 'ping-info' ? 'Liga-Pings' : 'Heute';
    const sectionStatus = activeSection === 'daily' ? 'Live-Zwischenstand' : 'Abgeschlossen';
    const config = appState.config?.activityRace || {};
    const completion = activeSection === 'weekly'
      ? String(config.completionWeekly || 'Die Rollen werden erst am Wochenabschluss für die vollständige Kalenderwoche vergeben.')
      : activeSection === 'monthly'
        ? String(config.completionMonthly || 'Die Rollen werden erst am Monatsabschluss für den vollständigen Kalendermonat vergeben.')
        : String(config.completionDaily || 'Tagesrollen wechseln live; Wochen- und Monatsrollen werden nach dem vollständigen Abschluss vergeben.');
    let result = String(text || '')
      .replaceAll('{server}', (appState.guilds || []).find(function (guild) { return String(guild.id) === String(appState.selectedGuildId); })?.name || 'FALLEN HEAVEN')
      .replaceAll('{period}', sectionLabel)
      .replaceAll('{status}', sectionStatus)
      .replaceAll('{completion}', completion)
      .replaceAll('{range}', new Date().toLocaleDateString('de-DE'))
      .replaceAll('{nextEvaluation}', '3 Std. 12 Min.')
      .replaceAll('{chatRanking}', '{chatBlock1}\n\n{chatBlock2}\n\n{chatBlock3}')
      .replaceAll('{voiceRanking}', '{voiceBlock1}\n\n{voiceBlock2}\n\n{voiceBlock3}')
      .replaceAll('{chatFieldName}', String(config.chatFieldName || 'CHAT'))
      .replaceAll('{voiceFieldName}', String(config.voiceFieldName || 'SPRACHCHAT'))
      .replaceAll('{nextEvaluationFieldName}', String(config.nextEvaluationFieldName || 'NÄCHSTE AUSWERTUNG'))
      .replaceAll('{rangeFieldName}', String(config.rangeFieldName || 'ZEITRAUM'));
    result = result.replaceAll('{buttonLabel}', String(config.pingToggleButtonLabel || 'LIGA-PINGS EIN/AUS'));
    const rankSamples = {
      chat: [
        { marker: '🥇', mention: '@Mitglied', value: '128 Nachrichten' },
        { marker: '🥈', mention: '@Mitglied', value: '104 Nachrichten' },
        { marker: '🥉', mention: '@Mitglied', value: '91 Nachrichten' }
      ],
      voice: [
        { marker: '🥇', mention: '@Mitglied', value: '8 Std. 14 Min.' },
        { marker: '🥈', mention: '@Mitglied', value: '6 Std. 42 Min.' },
        { marker: '🥉', mention: '@Mitglied', value: '5 Std. 08 Min.' }
      ]
    };
    Object.keys(rankSamples).forEach(function (prefix) {
      rankSamples[prefix].forEach(function (row, index) {
        const n = index + 1;
        const block = row.marker + ' ' + row.mention + '\n> **' + row.value + '**';
        result = result.split('{' + prefix + n + '}').join(row.mention)
          .split('{' + prefix + 'Value' + n + '}').join(row.value)
          .split('{' + prefix + 'Marker' + n + '}').join(row.marker)
          .split('{' + prefix + 'Block' + n + '}').join(block);
      });
    });
    return result;
  }

  function studioDescription(raw, config, section, explicitState) {
    const savedDescription = String(config?.panelDescription || '').trim();
    const rawDescription = String(raw || '');
    const legacySaved = savedDescription.includes(ACTIVITY_RACE_LEGACY_DESCRIPTION);
    const template = legacySaved
      || rawDescription.includes(ACTIVITY_RACE_LEGACY_DESCRIPTION)
      || rawDescription.includes('{panelDescription}')
      ? (legacySaved ? '{completion}' : (savedDescription || '{completion}'))
      : rawDescription;
    return resolvePreview(String(template), { ...currentState(explicitState), studioActivityRaceSection: sectionKey(section) })
      .replaceAll('{panelDescription}', savedDescription);
  }

  function rawFields(embed, config) {
    const migrateFieldValue = function (value) {
      let v = String(value || '')
        .replaceAll('{chatRanking}', '{chatBlock1}\n\n{chatBlock2}\n\n{chatBlock3}')
        .replaceAll('{voiceRanking}', '{voiceBlock1}\n\n{voiceBlock2}\n\n{voiceBlock3}');
      if (v === '{chatBlock1}\n\n{chatBlock2}\n\n{chatBlock3}' || v === '{chatBlock1}\n{chatBlock2}\n{chatBlock3}') {
        v = '{chatMarker1} {chat1} > **{chatValue1}**\n{chatMarker2} {chat2} > **{chatValue2}**\n{chatMarker3} {chat3} > **{chatValue3}**';
      }
      if (v === '{voiceBlock1}\n\n{voiceBlock2}\n\n{voiceBlock3}' || v === '{voiceBlock1}\n{voiceBlock2}\n{voiceBlock3}') {
        v = '{voiceMarker1} {voice1} > **{voiceValue1}**\n{voiceMarker2} {voice2} > **{voiceValue2}**\n{voiceMarker3} {voice3} > **{voiceValue3}**';
      }
      return v;
    };
    const saved = Array.isArray(embed?.fields)
      ? cloneValue(embed.fields).slice(0, 21).map(function (field) {
        return { ...field, value: migrateFieldValue(field.value) };
      })
      : [];
    if (saved.length) return saved;
    return [
      { name: String(config?.chatFieldName || 'CHAT'), value: '{chatMarker1} {chat1} > **{chatValue1}**\n{chatMarker2} {chat2} > **{chatValue2}**\n{chatMarker3} {chat3} > **{chatValue3}**', inline: true },
      { name: String(config?.voiceFieldName || 'SPRACHCHAT'), value: '{voiceMarker1} {voice1} > **{voiceValue1}**\n{voiceMarker2} {voice2} > **{voiceValue2}**\n{voiceMarker3} {voice3} > **{voiceValue3}**', inline: true },
      { name: String(config?.nextEvaluationFieldName || 'NÄCHSTE AUSWERTUNG'), value: '{nextEvaluation}', inline: true },
      { name: String(config?.rangeFieldName || 'ZEITRAUM'), value: '{range}', inline: true }
    ];
  }

  function studioTemplate(config, section, explicitState) {
    const key = sectionKey(section);
    if (key === 'ping-info') {
      const source = cloneValue(config?.pingInfoDesign || {});
      const embeds = Array.isArray(source.embeds) && source.embeds.length
        ? source.embeds.slice(0, 10)
        : [source.embed || {
            title: 'Aktivitäts-Liga · Benachrichtigungen',
            description: 'Du entscheidest selbst, ob du bei Änderungen deiner Liga-Platzierung erwähnt wirst.',
            color: '#6fd8ff',
            authorName: '{server}',
            fields: [],
            timestamp: false
          }];
      return {
        specialTemplate: 'activityRace',
        activityRaceSection: key,
        channelId: String(config?.panelChannelId || ''),
        content: String(source.content || ''),
        outsideImageUrl: source.outsideImageAttachment ? '' : String(source.outsideImageUrl || ''),
        outsideImageName: String(source.outsideImageName || source.outsideImageAttachment?.name || ''),
        outsideImageSize: Number(source.outsideImageSize || source.outsideImageAttachment?.size || 0),
        outsideImageAttachment: source.outsideImageAttachment || null,
        embed: embeds[0],
        embeds,
        componentSet: 'none',
        reactionRoles: []
      };
    }
    const designKey = key === 'weekly' ? 'panelDesignWeekly' : key === 'monthly' ? 'panelDesignMonthly' : 'panelDesign';
    const design = config?.[designKey] || config?.panelDesign || {};
    const embed = design.embed || {};
    const scopedState = { ...currentState(explicitState), studioActivityRaceSection: key };
    return {
      specialTemplate: 'activityRace',
      activityRaceSection: key,
      activityRaceUsePeriodColor: !String(embed.color || '').trim(),
      channelId: String(config?.panelChannelId || ''),
      content: String(design.content || ''),
      outsideImageUrl: design.outsideImageAttachment ? '' : String(design.outsideImageUrl || ''),
      outsideImageName: String(design.outsideImageAttachment?.name || ''),
      outsideImageSize: Number(design.outsideImageAttachment?.size || 0),
      outsideImageAttachment: design.outsideImageAttachment || null,
      embed: {
        title: resolvePreview(Object.prototype.hasOwnProperty.call(embed, 'title') ? embed.title : '{period}', scopedState),
        url: embed.url || '',
        description: Object.prototype.hasOwnProperty.call(embed, 'description')
          ? studioDescription(embed.description, config, key, scopedState)
          : completionText(config, key),
        color: embed.color || '#6fd8ff',
        authorName: Object.prototype.hasOwnProperty.call(embed, 'authorName') ? embed.authorName : 'FALLEN HEAVEN · AKTIVITÄTS-LIGA',
        authorIconUrl: embed.authorIconUrl || '',
        thumbnailUrl: embed.thumbnailUrl || '',
        imageUrl: embed.imageUrl || '',
        footerText: resolvePreview(Object.prototype.hasOwnProperty.call(embed, 'footerText') ? embed.footerText : '{period} · nachvollziehbar und automatisch ausgewertet', scopedState),
        footerIconUrl: embed.footerIconUrl || '',
        timestamp: embed.timestamp !== false,
        fields: rawFields(embed, config)
      },
      componentSet: 'none',
      reactionRoles: []
    };
  }

  function previewValue(value, explicitState) {
    const appState = currentState(explicitState);
    const config = appState.config?.activityRace || {};
    const base = resolvePreview(value, appState);
    const resolvedDescription = resolvePreview(String(config.panelDescription || '{completion}'), appState);
    return base.replaceAll('{panelDescription}', resolvedDescription);
  }

  function previewTemplate(template, explicitState) {
    const appState = currentState(explicitState);
    if (appState.studioSpecialTemplate !== 'activityRace') return template;
    const preview = cloneValue(template);
    const pingInfo = sectionKey(appState.studioActivityRaceSection) === 'ping-info';
    const sources = Array.isArray(preview.embeds) && preview.embeds.length ? preview.embeds.slice(0, 10) : [preview.embed || {}];
    const config = appState.config?.activityRace || {};
    const fallbackFields = [
      { name: String(config.chatFieldName || 'CHAT'), value: '{chatMarker1} {chat1} > **{chatValue1}**\n{chatMarker2} {chat2} > **{chatValue2}**\n{chatMarker3} {chat3} > **{chatValue3}**', inline: true },
      { name: String(config.voiceFieldName || 'SPRACHCHAT'), value: '{voiceMarker1} {voice1} > **{voiceValue1}**\n{voiceMarker2} {voice2} > **{voiceValue2}**\n{voiceMarker3} {voice3} > **{voiceValue3}**', inline: true },
      { name: String(config.nextEvaluationFieldName || 'NÄCHSTE AUSWERTUNG'), value: '{nextEvaluation}', inline: true },
      { name: String(config.rangeFieldName || 'ZEITRAUM'), value: '{range}', inline: true }
    ];
    const renderEmbed = function (source) {
      const result = cloneValue(source || {});
      ['title', 'description', 'authorName', 'footerText'].forEach(function (key) { result[key] = previewValue(result[key], appState); });
      const designFields = Array.isArray(result.fields) ? result.fields : [];
      result.fields = (designFields.length || pingInfo ? designFields : fallbackFields).map(function (field) {
        return { ...field, name: previewValue(field.name, appState), value: previewValue(field.value, appState) };
      });
      return result;
    };
    preview.content = previewValue(preview.content, appState);
    preview.embeds = sources.map(renderEmbed);
    preview.embed = preview.embeds[0];
    return preview;
  }

  function overview(config, context) {
    const escapeHtml = context?.escapeHtml || function (value) { return String(value || ''); };
    const rankingQuery = String(context?.rankingQuery || '');
    const roleKeys = ['separatorRoleId'].concat(['daily', 'weekly', 'monthly'].flatMap(function (period) {
      return ['Chat', 'Voice'].flatMap(function (metric) {
        return [1, 2, 3].map(function (place) { return period + metric + (place === 1 ? '' : 'Top' + place) + 'RoleId'; });
      });
    }));
    const selected = roleKeys.filter(function (key) { return String(config?.[key] || '').trim(); }).length;
    const periods = [['daily', 'TAGESWERTUNG'], ['weekly', 'WOCHENWERTUNG'], ['monthly', 'MONATSWERTUNG']];
    const ready = config?.enabled === true && selected === roleKeys.length;
    const configuredChannel = String(config?.panelChannelId || '').trim();
    return '<section id="activity-race-panel" class="activity-race-panel ' + (ready ? 'ready' : 'attention') + '">' +
      '<header><div><small>FALLEN HEAVEN · AKTIVITÄTS-LIGA</small><h3>' + (ready ? 'Das Community-Rennen läuft.' : 'Top 1–3 professionell einrichten.') + '</h3><p>Tagesrollen folgen live der aktuellen Rangfolge. Wochen- und Monatsrollen entstehen erst nach einem vollständigen Abschluss.</p></div><span data-activity-race-badge>' + (ready ? 'LIVE' : selected + '/19 ROLLEN') + '</span></header>' +
      '<div class="activity-race-periods">' + periods.map(function (row) {
        const chatCount = [1, 2, 3].filter(function (place) { return String(config?.[row[0] + 'Chat' + (place === 1 ? '' : 'Top' + place) + 'RoleId'] || '').trim(); }).length;
        const voiceCount = [1, 2, 3].filter(function (place) { return String(config?.[row[0] + 'Voice' + (place === 1 ? '' : 'Top' + place) + 'RoleId'] || '').trim(); }).length;
        return '<article><em>' + escapeHtml(row[1]) + '</em><b>Chat · ' + chatCount + '/3 Plätze</b><b>Sprachchat · ' + voiceCount + '/3 Plätze</b><small data-activity-race-' + row[0] + '>Noch keine Live-Daten</small></article>';
      }).join('') + '</div>' +
      '<div class="activity-race-actions"><div><b>Drei Rankings plus persönliches Ping-Info-Panel</b><span>' + (configuredChannel ? 'Der ausgewählte Kanal hat Vorrang.' : 'Der Kanal wird automatisch über seinen Namen erkannt.') + ' Heute zeigt den Live-Stand; Woche und Monat zeigen vorhandene historische Daten. Darunter steht ein vollständig editierbares Info-Panel mit echtem Ping-Schalter.</span></div><div class="activity-race-studio-buttons"><button type="button" data-activity-race-open-studio="daily">Heute-Embed bearbeiten</button><button type="button" data-activity-race-open-studio="weekly">Wochen-Embed bearbeiten</button><button type="button" data-activity-race-open-studio="monthly">Monat-Embed bearbeiten</button><button type="button" data-activity-race-open-studio="ping-info">Ping-Info-Panel bearbeiten</button></div><div class="activity-race-actions-row"><button type="button" data-activity-race-role-preview>Rollenset prüfen</button><button type="button" data-activity-race-refresh ' + (ready ? '' : 'disabled') + '>Embeds jetzt aktualisieren</button></div></div>' +
      '<section class="activity-race-full"><header><div><small>VOLLSTÄNDIGE TAGESWERTUNG</small><h4>Jedes aktuelle Mitglied. Jeder Rang.</h4><p>Gleichstände erhalten denselben fairen Rang. Mitglieder ohne heutige Aktivität bleiben sichtbar und werden nicht zu Gewinnern erklärt.</p></div><div class="activity-race-ranking-tools"><label><span class="sr-only">Mitglied suchen</span><input type="search" data-activity-race-ranking-search value="' + escapeHtml(rankingQuery) + '" placeholder="Mitglied oder Benutzername suchen …" autocomplete="off"></label><div><button type="button" class="active" data-activity-race-ranking-metric="chat">Chat</button><button type="button" data-activity-race-ranking-metric="voice">Sprachchat</button></div></div></header><div class="activity-race-ranking-summary" data-activity-race-ranking-summary>Rangliste wird geladen …</div><div class="activity-race-ranking-list" data-activity-race-ranking-list><p>Aktuelle Mitgliedsdaten werden geladen …</p></div></section>' +
      '<p class="activity-race-safety"><b>Dynamische Titel:</b> Tagesrollen wechseln automatisch zwischen Platz 1, 2 und 3. Die Trennerrolle begleitet jede aktive Liga-Auszeichnung und wird nach der letzten Auszeichnung entzogen. Wochen- und Monatsrollen werden nur aus vollständigen Zeiträumen gebildet. Bots, Webhooks, Spam, Duplikate und AFK zählen nicht.</p>' +
      '<p class="activity-race-role-health" data-activity-race-role-health><b>Rollenabgleich:</b> Bereit für die nächste Auswertung.</p></section>';
  }

  window.FHCCActivityRaceStudio = {
    completionText,
    studioDescription,
    studioTemplate,
    rawFields,
    resolvePreview,
    previewValue,
    previewTemplate,
    overview
  };
})();
