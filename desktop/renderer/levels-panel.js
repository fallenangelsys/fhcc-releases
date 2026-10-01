(function () {
  'use strict';

  function state() { return globalThis.state || {}; }

  function levelsOverview(config) {
    const active = config?.enabled === true;
    const panelReady = Boolean(String(config?.levelRolesPanelChannelId || '').trim());
    const mappingCount = Array.isArray(config?.levelRoleMappings) ? config.levelRoleMappings.length : 0;
    const status = active ? (panelReady ? 'LIVE' : mappingCount + ' ROLLEN') : 'AUS';
    const heading = active ? (panelReady ? 'Das Levelrollen-Panel läuft.' : 'Kanal wählen, dann live.') : 'Leveling ist deaktiviert.';
    return '<section id="levels-panel" class="activity-race-panel ' + (active && panelReady ? 'ready' : 'attention') + '">' +
      '<header><div><small>FALLEN HEAVEN · LEVELING</small><h3>' + heading + '</h3><p>' + (panelReady
        ? 'Das Panel-Embed steht im gewählten Kanal und wird beim Speichern automatisch aktualisiert – die Rollenliste aus deinen ' + mappingCount + ' Level-Belohnungen wird automatisch ergänzt.'
        : 'Wähle unten den Levelrollen-Panel-Kanal. Danach kannst du das Panel-Embed im Studio gestalten – Titel, Beschreibung, Farben, Bilder, Felder und Nachricht sind frei editierbar, die Rollenliste bleibt automatisch.') + '</p></div><span data-levels-panel-badge>' + status + '</span></header>' +
      '<div class="activity-race-actions"><div><b>Levelrollen-Embed gestalten</b><span>Embed Studio mit Live-Vorschau · Einzelne Platzhalter wie {levelRole1}, {levelRoleName1} und {levelRoleLevel1} bis Platz 20 werden durch echte Rollenwerte ersetzt.</span></div><button type="button" data-levels-open-studio>Levelrollen-Embed bearbeiten</button></div>' +
      '<div class="activity-race-actions"><div><b>Level-Up-Embed gestalten</b><span>Wird bei jedem Levelaufstieg im gewählten Kanal gesendet · Platzhalter {user}, {level}, {rank} und {guild} werden automatisch ersetzt.</span></div><button type="button" data-levels-open-up-studio>Level-Up-Embed bearbeiten</button></div>' +
      '<div class="activity-race-actions"><div><b>Level-Up-Kanal-Info gestalten</b><span>Persistentes Info-Embed (Befehle, Regeln) im Level-Up-Kanal – bleibt dauerhaft stehen. Aktiviere „Info-Embed im Level-Up-Kanal" und das automatische Aufräumen unten in den Einstellungen.</span></div><button type="button" data-levels-open-info-studio>Kanal-Info-Embed bearbeiten</button></div>' +
      '<div class="activity-race-actions"><div><b>Level manuell setzen</b><span>Setzt das Level eines Mitglieds dauerhaft – XP wird exakt auf die Kurve gestellt und die passenden Level-Rollen werden vergeben (0 entfernt alle Level-Rollen).</span></div><span class="level-manual-row"><input type="text" data-levels-set-user placeholder="Mitglieds-ID …" spellcheck="false"><input type="number" data-levels-set-level-value placeholder="Level" min="0" max="200" style="width:96px"><button type="button" class="button primary" data-levels-set-level disabled>Level setzen</button></span></div>' +
      '<div class="activity-race-actions"><div><b>Level-Rollen zurücksetzen (Wipe)</b><span>Entfernt alle verwalteten Level-Rollen von ALLEN Mitgliedern – die Level-Rollen sind danach wieder leer. XP und Level bleiben erhalten.</span></div><button type="button" class="button danger" data-levels-wipe-roles ' + (mappingCount ? '' : 'disabled') + '>Alle Level-Rollen entfernen</button></div>' +
      '<div class="activity-race-actions"><div><b>Level-Rollen an alle vergeben</b><span>Liest den XP-Stand jedes Mitglieds und vergibt automatisch die aktuell passenden Level-Rollen – falsche oder fehlende Rollen werden korrigiert. Ideal nach einem Wipe oder manuellen Änderungen.</span></div><button type="button" class="button primary" data-levels-grant-all ' + (mappingCount ? '' : 'disabled') + '>Passende Rollen an alle vergeben</button></div>' +
      '</section>';
  }

  function levelsStudioTemplate(config) {
    const design = config?.panelDesign || {};
    const embed = design.embed || {};
    return {
      specialTemplate: 'levelsPanel',
      channelId: String(config?.levelRolesPanelChannelId || ''),
      content: String(design.content || ''),
      outsideImageUrl: design.outsideImageAttachment && design.outsideImageAttachment.anchored !== true ? '' : String(design.outsideImageUrl || ''),
      outsideImageName: String(design.outsideImageAttachment?.name || ''),
      outsideImageSize: Number(design.outsideImageAttachment?.size || 0),
      outsideImageAttachment: design.outsideImageAttachment || null,
      embeds: [{
        title: embed.title || '💯 Leveln',
        url: embed.url || '',
        description: Object.prototype.hasOwnProperty.call(embed, 'description') ? String(embed.description).replaceAll('{levelRoles}', Array.from({ length: 20 }, function (_, index) { return '{levelRoleBlock' + (index + 1) + '}'; }).join('\n')) : 'Diese Rollen kannst du durch Aktivität im Chat und in den Sprachkanälen freischalten. Je höher dein Level, desto höher dein Rang.\n\n' + Array.from({ length: 20 }, function (_, index) { return '{levelRoleBlock' + (index + 1) + '}'; }).join('\n'),
        color: embed.color || '#8b82ff',
        authorName: embed.authorName || '',
        authorIconUrl: embed.authorIconUrl || '',
        thumbnailUrl: embed.thumbnailUrl || '',
        imageUrl: embed.imageUrl || '',
        footerText: Object.prototype.hasOwnProperty.call(embed, 'footerText') ? embed.footerText : 'FALLEN HEAVEN wünscht dir einen schönen Aufenthalt.',
        footerIconUrl: embed.footerIconUrl || '',
        timestamp: embed.timestamp !== false,
        fields: Array.isArray(embed.fields) ? clone(embed.fields).slice(0, 21) : []
      }],
      componentSet: 'none',
      reactionRoles: []
    };
  }

  function levelsPreviewValue(value) {
    const s = state();
    const guild = s.guilds.find(function (entry) { return String(entry.id) === String(s.selectedGuildId); });
    const mappings = Array.isArray(s.config?.levels?.levelRoleMappings) ? s.config.levels.levelRoleMappings : [];
    const rolesById = {};
    (s.moduleRoles || []).forEach(function (role) { rolesById[String(role.id)] = role; });
    const lines = mappings.map(function (entry) {
      const match = /^(\d+)\s*[=:|]\s*(\d+)$/.exec(String(entry || '').trim());
      if (!match) return '';
      const role = rolesById[match[2]];
      return '| <@&' + (role?.id || match[2]) + '> | Ab Level ' + match[1];
    }).filter(Boolean);
    const noXpLines = (Array.isArray(s.config?.levels?.noXpRoleIds) ? s.config.levels.noXpRoleIds : [])
      .map(function (roleId) {
        const role = rolesById[String(roleId)];
        return role ? '| <@&' + role.id + '> | Nur auf Anfrage' : '';
      }).filter(Boolean);
    const roleBlock = noXpLines.concat(lines).join('\n') || '| <@&123456789012345678> | Ab Level 10\n| <@&123456789012345679> | Ab Level 50\n| <@&123456789012345680> | Ab Level 110';
    let result = String(value || '').replaceAll('{levelRoles}', roleBlock);
    const entries = noXpLines.concat(lines);
    for (let index = 1; index <= 20; index += 1) {
      const entry = entries[index - 1] || '';
      const match = /\| <@&([^>]+)> \| (.+)$/.exec(entry);
      result = result
        .replaceAll('{levelRole' + index + '}', match ? '<@&' + match[1] + '>' : '')
        .replaceAll('{levelRoleName' + index + '}', match ? 'Rolle' : '')
        .replaceAll('{levelRoleLevel' + index + '}', match ? match[2] : '')
        .replaceAll('{levelRoleBlock' + index + '}', entry);
    }
    return result.replaceAll('{guild}', guild?.name || 'FALLEN HEAVEN');
  }

  function levelsPreviewTemplate(template) {
    const s = state();
    if (s.studioSpecialTemplate !== 'levelsPanel') return template;
    const preview = clone(template);
    const embed = preview.embed || preview.embeds?.[0] || {};
    ['title', 'description', 'authorName', 'footerText'].forEach(function (key) { embed[key] = levelsPreviewValue(embed[key]); });
    if (Array.isArray(embed.fields)) {
      embed.fields = embed.fields.map(function (field) {
        return { ...field, name: levelsPreviewValue(field.name), value: levelsPreviewValue(field.value) };
      });
    }
    preview.content = levelsPreviewValue(preview.content);
    preview.embed = embed;
    preview.embeds = [embed];
    return preview;
  }

  async function openLevelsStudio() {
    const s = state();
    if (!s.authenticated || !s.selectedGuildId) {
      toast('Wähle zuerst einen Server.', 'error');
      return;
    }
    if (!(await setView('studio'))) return;
    await refreshConfig(s.selectedGuildId);
    s.activeStudioMessageId = '';
    s.studioSourceMessage = null;
    loadStudioTemplate(levelsStudioTemplate(s.config?.levels));
    renderDrafts();
    toast('Levelrollen-Embed im bestehenden Embed Studio geöffnet.', 'success');
  }

  async function saveLevelsStudioTemplate() {
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
      toast('Das Levelrollen-Panel verwendet genau ein automatisch gepflegtes Embed.', 'error');
      return false;
    }
    return saveStudioDesign({
      path: '/api/guild/' + encodeURIComponent(s.selectedGuildId) + '/levels/design',
      body: {
        template: {
          ...template,
          embeds: (template.embeds || [template.embed || {}]).slice(0, 1),
          channelId: template.channelId || s.config?.levels?.levelRolesPanelChannelId || ''
        }
      },
      errorMessage: 'Das Levelrollen-Panel konnte nicht gespeichert werden.',
      onSaved: function (result) {
        s.config.levels = result.config?.levels || s.config.levels;
        loadStudioTemplate(levelsStudioTemplate(s.config.levels));
      },
      okMessage: function (result) {
        const panelStatus = result.status || {};
        const panelAction = String(panelStatus.action || '');
        if (panelAction === 'posted' || panelAction === 'updated') {
          const moduleOff = s.config.levels?.enabled !== true;
          return 'Levelrollen-Panel gesendet und Live-Panel aktualisiert. Fehlt das Embed im Kanal, wird es automatisch neu gesendet.'
            + (moduleOff ? ' (Das Leveling-Modul ist noch deaktiviert – XP werden erst nach Aktivierung vergeben.)' : '');
        }
        if (panelAction === 'failed' && panelStatus.lastError) return 'Levelrollen-Panel gespeichert, aber das Senden ist fehlgeschlagen: ' + panelStatus.lastError;
        if (panelAction === 'no-channel') return 'Levelrollen-Panel gespeichert. Wähle zuerst einen Kanal – dann wird es automatisch gesendet.';
        return 'Levelrollen-Panel gespeichert. Es wird automatisch gesendet, sobald ein Kanal gewählt wurde.';
      },
      okType: function (result) {
        return String(result.status?.action || '') === 'failed' ? 'error' : 'success';
      }
    });
  }

  function levelUpStudioTemplate(config) {
    const templates = Array.isArray(config?.embeds?.templates) ? config.embeds.templates : [];
    const stored = templates.find(function (entry) { return entry.id === 'level-up'; }) || {};
    const embed = stored.embed || {};
    return {
      specialTemplate: 'levelUp',
      channelId: String(stored.channelId || config?.levels?.announceChannelId || ''),
      content: String(stored.content || ''),
      outsideImageUrl: String(stored.outsideImageUrl || ''),
      outsideImageName: String(stored.outsideImageName || stored.outsideImageAttachment?.name || ''),
      outsideImageSize: Number(stored.outsideImageAttachment?.size || stored.outsideImageSize || 0),
      outsideImageAttachment: stored.outsideImageAttachment && typeof stored.outsideImageAttachment === 'object' ? clone(stored.outsideImageAttachment) : null,
      embeds: [{
        title: embed.title || '💜 Level Up!',
        url: embed.url || '',
        description: Object.prototype.hasOwnProperty.call(embed, 'description') ? embed.description : '{roleText}{user} hat Level **{level}** erreicht und steigt in der Rangliste auf! 🚀\n\n{progressBar} **{progressPercent} %** · **{xpInLevel}** XP im Level · noch **{xpNeeded}** XP bis Level **{nextLevel}**',
        color: embed.color || '#8b82ff',
        authorName: embed.authorName || '',
        authorIconUrl: embed.authorIconUrl || '',
        thumbnailUrl: embed.thumbnailUrl || '{userAvatar}',
        imageUrl: embed.imageUrl || '',
        footerText: Object.prototype.hasOwnProperty.call(embed, 'footerText') ? embed.footerText : 'FALLEN HEAVEN · Leveling',
        footerIconUrl: embed.footerIconUrl || '',
        timestamp: embed.timestamp !== false,
        fields: Array.isArray(embed.fields) ? clone(embed.fields).slice(0, 21) : []
      }],
      componentSet: 'none',
      reactionRoles: []
    };
  }

  function levelUpPreviewValue(value) {
    const s = state();
    const guild = s.guilds.find(function (entry) { return String(entry.id) === String(s.selectedGuildId); });
    return String(value || '')
      .replaceAll('{user}', '@Mitglied')
      .replaceAll('{username}', 'Mitglied')
      .replaceAll('{userAvatar}', 'https://cdn.discordapp.com/embed/avatars/0.png')
      .replaceAll('{guild}', guild?.name || 'FALLEN HEAVEN')
      .replaceAll('{level}', '12')
      .replaceAll('{nextLevel}', '13')
      .replaceAll('{rank}', '3')
      .replaceAll('{progressBar}', '█████████░░░')
      .replaceAll('{progressPercent}', '75')
      .replaceAll('{xp}', '1.250')
      .replaceAll('{xpInLevel}', '350')
      .replaceAll('{xpNeeded}', '120')
      .replaceAll('{role}', '@Asche-Engel')
      .replaceAll('{roleText}', '🎉 @Mitglied hat die Rolle @Asche-Engel freigeschaltet – herzlichen Glückwunsch! ✨\n\n');
  }

  function levelUpPreviewTemplate(template) {
    const s = state();
    if (s.studioSpecialTemplate !== 'levelUp') return template;
    const preview = clone(template);
    const embed = preview.embed || preview.embeds?.[0] || {};
    ['title', 'description', 'authorName', 'footerText'].forEach(function (key) { embed[key] = levelUpPreviewValue(embed[key]); });
    if (Array.isArray(embed.fields)) {
      embed.fields = embed.fields.map(function (field) {
        return { ...field, name: levelUpPreviewValue(field.name), value: levelUpPreviewValue(field.value) };
      });
    }
    preview.content = levelUpPreviewValue(preview.content);
    preview.embed = embed;
    preview.embeds = [embed];
    return preview;
  }

  async function openLevelUpStudio() {
    const s = state();
    if (!s.authenticated || !s.selectedGuildId) {
      toast('Wähle zuerst einen Server.', 'error');
      return;
    }
    if (!(await setView('studio'))) return;
    await refreshConfig(s.selectedGuildId);
    s.activeStudioMessageId = '';
    s.studioSourceMessage = null;
    loadStudioTemplate(levelUpStudioTemplate(s.config));
    renderDrafts();
    toast('Level-Up-Embed im bestehenden Embed Studio geöffnet.', 'success');
  }

  async function saveLevelUpStudioTemplate() {
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
    if (s.studioEmbeds.length !== 1) {
      toast('Das Level-Up-Embed verwendet genau ein Embed. Entferne weitere Embeds, bevor du speicherst.', 'error');
      return false;
    }
    const embeds = (template.embeds || [template.embed || {}]).slice(0, 1).map(function (embed) {
      return {
        title: embed.title || '', url: embed.url || '', description: embed.description || '', color: embed.color || '#8b82ff',
        authorName: embed.authorName || '', authorIconUrl: embed.authorIconUrl || '', thumbnailUrl: embed.thumbnailUrl || '',
        imageUrl: embed.imageUrl || '', footerText: embed.footerText || '', footerIconUrl: embed.footerIconUrl || '',
        timestamp: embed.timestamp === true, fields: Array.isArray(embed.fields) ? clone(embed.fields).slice(0, 21) : []
      };
    });
    const current = clone(s.config?.embeds || {});
    const templates = Array.isArray(current.templates) ? current.templates : [];
    const stored = templates.find(function (entry) { return entry.id === 'level-up'; });
    const outside = {
      outsideImageUrl: String(template.outsideImageUrl || ''),
      outsideImageAttachment: normalizeOutsideImageAttachment(template.outsideImageAttachment)
    };
    const next = stored
      ? templates.map(function (entry) { return entry.id === 'level-up' ? { ...entry, ...outside, content: String(template.content || ''), enabled: true, embed: embeds[0] || entry.embed } : entry; })
      : templates.concat([{ id: 'level-up', name: 'Level Up', category: 'Automation', channelId: '', content: String(template.content || ''), messageId: '', enabled: true, ...outside, embed: embeds[0] || {} }]);
    const levelPatch = String(template.channelId || '').trim()
      ? { levels: { ...(s.config?.levels || {}), announceChannelId: String(template.channelId || '').trim() } }
      : {};
    const saved = await savePatch({ ...levelPatch, embeds: { ...current, templates: next } }, 'Level-Up-Embed gespeichert. Es wird beim nächsten Levelaufstieg im Kanal verwendet.');
    if (saved) loadStudioTemplate(levelUpStudioTemplate(s.config));
    return saved;
  }

  function levelUpInfoStudioTemplate(config) {
    const templates = Array.isArray(config?.embeds?.templates) ? config.embeds.templates : [];
    const stored = templates.find(function (entry) { return entry.id === 'level-up-info'; }) || {};
    const embed = stored.embed || {};
    return {
      specialTemplate: 'levelUpInfo',
      channelId: String(stored.channelId || config?.levels?.levelUpInfoChannelId || config?.levels?.announceChannelId || ''),
      content: String(stored.content || ''),
      outsideImageUrl: String(stored.outsideImageUrl || ''),
      outsideImageName: String(stored.outsideImageName || stored.outsideImageAttachment?.name || ''),
      outsideImageSize: Number(stored.outsideImageAttachment?.size || stored.outsideImageSize || 0),
      outsideImageAttachment: stored.outsideImageAttachment && typeof stored.outsideImageAttachment === 'object' ? clone(stored.outsideImageAttachment) : null,
      embeds: [{
        title: embed.title || '💜 Leveling – so funktioniert es',
        url: embed.url || '',
        description: Object.prototype.hasOwnProperty.call(embed, 'description') ? embed.description : 'Mit Aktivität im Chat und im Sprachchat sammelst du XP und steigst Level für Level auf.\n\n**{rulesChatFieldName}**\n{rulesChatFieldText}\n\n**{rulesVoiceFieldName}**\n{rulesVoiceFieldText}\n\n**{rulesBonusFieldName}**\n{rulesBonusFieldText}',
        color: embed.color || '#8b82ff',
        authorName: embed.authorName || '',
        authorIconUrl: embed.authorIconUrl || '',
        thumbnailUrl: embed.thumbnailUrl || '',
        imageUrl: embed.imageUrl || '',
        footerText: Object.prototype.hasOwnProperty.call(embed, 'footerText') ? embed.footerText : 'FALLEN HEAVEN · Leveling',
        footerIconUrl: embed.footerIconUrl || '',
        timestamp: embed.timestamp !== false,
        fields: Array.isArray(embed.fields) ? clone(embed.fields).slice(0, 21) : []
      }],
      componentSet: 'none',
      reactionRoles: []
    };
  }

  function levelUpInfoPreviewValue(value) {
    const s = state();
    const guild = s.guilds.find(function (entry) { return String(entry.id) === String(s.selectedGuildId); });
    return String(value || '')
      .replaceAll('{guild}', guild?.name || 'FALLEN HEAVEN')
      .replaceAll('{rulesChatFieldName}', 'CHAT')
      .replaceAll('{rulesVoiceFieldName}', 'SPRACHCHAT')
      .replaceAll('{rulesActivityFieldName}', 'AKTIVITÄTS-BONUS')
      .replaceAll('{rulesBonusFieldName}', 'ROLLEN- & BOOSTER-BONUS')
      .replaceAll('{rulesCurveFieldName}', 'LEVEL-KURVE')
      .replaceAll('{rulesNoXpFieldName}', 'NO-XP-ROLLE')
      .replaceAll('{rulesExcludedFieldName}', 'AUSGESCHLOSSEN')
      .replaceAll('{rulesChatFieldText}', '• Jede gültige Nachricht gibt fest 5 XP\n• Kein Cooldown und kein Aktivitätslimit\n• Anhänge und Sticker zählen ebenfalls')
      .replaceAll('{rulesVoiceFieldText}', '• 1 XP pro gültiger Minute\n• Mindestens 2 Personen gemeinsam\n• Taube und ungültige Zeit zählt nicht')
      .replaceAll('{rulesActivityFieldText}', '• Aktivitäts-Liga vergibt keine Level-XP')
      .replaceAll('{rulesBonusFieldText}', '• Tag und Booster vergeben keine Level-XP')
      .replaceAll('{rulesCurveFieldText}', '• Level 1: 300 XP · Level 10: 8.400 XP\n• Level 110: 1.238.400 XP und MAX')
      .replaceAll('{rulesNoXpFieldText}', '• NO-XP-Rollen sammeln keine XP')
      .replaceAll('{rulesExcludedFieldText}', '• Ausgeschlossene Kanäle/Rollen werden automatisch eingesetzt')
      .replaceAll('{noXpRoleNames}', 'no-xp')
      .replaceAll('{excludedChannels}', 'bots, logs')
      .replaceAll('{excludedRoles}', 'Team');
  }

  function levelUpInfoPreviewTemplate(template) {
    const s = state();
    if (s.studioSpecialTemplate !== 'levelUpInfo') return template;
    const preview = clone(template);
    const embed = preview.embed || preview.embeds?.[0] || {};
    ['title', 'description', 'authorName', 'footerText'].forEach(function (key) { embed[key] = levelUpInfoPreviewValue(embed[key]); });
    if (Array.isArray(embed.fields)) {
      embed.fields = embed.fields.map(function (field) {
        return { ...field, name: levelUpInfoPreviewValue(field.name), value: levelUpInfoPreviewValue(field.value) };
      });
    }
    preview.content = levelUpInfoPreviewValue(preview.content);
    preview.embed = embed;
    preview.embeds = [embed];
    return preview;
  }

  async function openLevelUpInfoStudio() {
    const s = state();
    if (!s.authenticated || !s.selectedGuildId) {
      toast('Wähle zuerst einen Server.', 'error');
      return;
    }
    if (!(await setView('studio'))) return;
    await refreshConfig(s.selectedGuildId);
    s.activeStudioMessageId = '';
    s.studioSourceMessage = null;
    loadStudioTemplate(levelUpInfoStudioTemplate(s.config));
    renderDrafts();
    toast('Level-Up-Kanal-Info im bestehenden Embed Studio geöffnet.', 'success');
  }

  async function saveLevelUpInfoStudioTemplate(syncNow) {
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
    if (s.studioEmbeds.length !== 1) {
      toast('Das Kanal-Info-Embed verwendet genau ein Embed. Entferne weitere Embeds, bevor du speicherst.', 'error');
      return false;
    }
    return saveStudioDesign({
      path: '/api/guild/' + encodeURIComponent(s.selectedGuildId) + '/levels/info-design',
      body: {
        template: {
          ...template,
          embeds: (template.embeds || [template.embed || {}]).slice(0, 1)
        }
      },
      errorMessage: 'Das Kanal-Info-Embed konnte nicht gespeichert werden.',
      onSaved: function (result) {
        if (result.config?.embeds || result.config?.levels) s.config = normalizeModuleConfigIds(result.config);
        else s.config.embeds = result.config || s.config.embeds;
        if (result.levels) s.config.levels = result.levels;
        loadStudioTemplate(levelUpInfoStudioTemplate(s.config));
      },
      okMessage: function (result) {
        const status = result.status || {};
        const action = String(status.action || '');
        const autoHint = status.autoEnabled ? ' Das Info-Embed wurde dabei automatisch aktiviert.' : '';
        if (action === 'updated') return 'Kanal-Info-Embed gespeichert und die Live-Nachricht im Level-Up-Kanal aktualisiert.' + autoHint;
        if (action === 'posted') return 'Kanal-Info-Embed gespeichert und im Level-Up-Kanal gesendet.' + autoHint;
        if (action === 'failed') return 'Kanal-Info-Embed gespeichert, aber die Kanal-Aktualisierung ist fehlgeschlagen: ' + (status.lastError || 'unbekannter Fehler') + ' – das Design bleibt gespeichert.';
        if (action === 'no-channel') return 'Kanal-Info-Embed gespeichert. Wähle im Leveling-Modul einen Kanal – dann wird es automatisch gesendet.';
        if (action === 'missing-permission') return 'Kanal-Info-Embed gespeichert, aber der Bot hat im Level-Up-Kanal nicht die nötigen Berechtigungen.';
        if (action === 'send-failed' || action === 'channel-unavailable' || action === 'fetch-failed') return 'Kanal-Info-Embed gespeichert, aber der Kanal ist gerade nicht erreichbar. Der Bot versucht es automatisch erneut.';
        return 'Kanal-Info-Embed gespeichert. Es wird im Level-Up-Kanal aktualisiert, sobald das Info-Embed aktiv ist.';
      },
      okType: function (result) {
        return String(result.status?.action || '') === 'failed' ? 'error' : 'success';
      }
    });
  }

  async function setMemberLevelAction() {
    const s = state();
    if (!s.authenticated || !s.selectedGuildId) return;
    const panel = document.getElementById('levels-panel');
    const userInput = panel?.querySelector('[data-levels-set-user]');
    const levelInput = panel?.querySelector('[data-levels-set-level-value]');
    const userId = String(userInput?.value || '').trim();
    const level = Math.max(0, Math.floor(Number(levelInput?.value) || 0));
    if (!userId) {
      toast('Gib die Mitglieds-ID ein (Discord: Entwicklermodus an → Rechtsklick aufs Mitglied → ID kopieren).', 'error');
      return;
    }
    if (s.moduleDirty) { toast('Speichere zuerst deine Einstellungen.', 'info'); return; }
    const button = panel?.querySelector('[data-levels-set-level]');
    if (button) button.disabled = true;
    try {
      const response = await api.apiRequest({
        path: '/api/guild/' + encodeURIComponent(s.selectedGuildId) + '/levels/set-level',
        method: 'POST',
        body: { userId, level }
      });
      if (handleExpiredSession(response)) return;
      if (!response.ok) throw new Error(response.data?.error || 'Level konnte nicht gesetzt werden.');
      const result = response.data?.result || {};
      toast('Level gesetzt: <@' + userId + '> ist jetzt Level ' + result.level + ' (' + Number(result.xp || 0).toLocaleString('de-DE') + ' XP).', 'success');
      if (userInput) userInput.value = '';
      if (levelInput) levelInput.value = '';
    } catch (error) {
      toast(String(error?.message || error), 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function wipeLevelRolesAction(button) {
    const s = state();
    if (!s.authenticated || !s.selectedGuildId) return;
    if (s.moduleDirty) { toast('Speichere zuerst deine Einstellungen.', 'info'); return; }
    const confirmed = await showAppConfirm({
      tone: 'danger',
      eyebrow: 'LEVEL-ROLLEN-ZURÜCKSETZEN',
      title: 'Alle Level-Rollen wirklich entfernen?',
      message: 'Allen Mitgliedern werden alle verwalteten Level-Rollen entnommen. XP und Level bleiben unverändert – die Rollen kommen erst wieder, wenn jemand weiter levelt.',
      cancelLabel: 'Abbrechen',
      confirmLabel: 'Ja, alle entfernen'
    });
    if (!confirmed) return;
    if (button) button.disabled = true;
    try {
      const response = await api.apiRequest({
        path: '/api/guild/' + encodeURIComponent(s.selectedGuildId) + '/levels/wipe-roles',
        method: 'POST',
        body: {},
        timeoutMs: 120000
      });
      if (handleExpiredSession(response)) return;
      if (!response.ok || response.data?.result?.ok === false) {
        const result = response.data?.result || {};
        const reason = String(result.reason || '');
        let message;
        if (reason === 'no-mappings') message = 'Es sind keine Level-Rollen konfiguriert.';
        else if (reason === 'fetch-failed') message = 'Mitglieder konnten nicht geladen werden (Berechtigung „Mitglieder auflisten" nötig).';
        else if (reason === 'nothing-removed') {
          const sample = (result.errors || result.blocked || []).slice(0, 2).map(function (entry) { return String(entry?.reason || entry || ''); }).filter(Boolean).join(' · ');
          message = 'Keine Level-Rolle konnte entfernt werden.' + (sample ? ' ' + sample : ' Prüfe, ob die Level-Rollen unter der höchsten Bot-Rolle liegen.');
        } else {
          message = response.data?.error || 'Der Wipe konnte nicht ausgeführt werden.';
        }
        throw new Error(message);
      }
      const result = response.data?.result || {};
      let message = 'Wipe abgeschlossen: ' + result.removed + ' Rollen von ' + result.members + ' Mitgliedern entfernt.';
      const warnings = [];
      if (Number(result.failedCount || 0) > 0) warnings.push(Number(result.failedCount) + ' Entfernungen fehlgeschlagen');
      if (Number(result.blockedCount || 0) > 0) warnings.push(Number(result.blockedCount) + ' Rollen konnten nicht entfernt werden (z. B. über der höchsten Bot-Rolle)');
      if (warnings.length) message += ' ⚠ ' + warnings.join(' · ');
      toast(message, result.hadErrors ? 'error' : 'success');
    } catch (error) {
      toast(String(error?.message || error), 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function grantLevelRolesToAllAction(button) {
    const s = state();
    if (!s.authenticated || !s.selectedGuildId) return;
    if (s.moduleDirty) { toast('Speichere zuerst deine Einstellungen.', 'info'); return; }
    const confirmed = await showAppConfirm({
      tone: 'primary',
      eyebrow: 'LEVEL-ROLLEN AN ALLE VERGEBEN',
      title: 'Allen die passenden Level-Rollen geben?',
      message: 'Jedes Mitglied bekommt die Level-Rolle(n), die zu seinem aktuellen XP-Stand passen – fehlende werden vergeben, falsche verwaltete Rollen entfernt. XP und Level bleiben unverändert.',
      cancelLabel: 'Abbrechen',
      confirmLabel: 'Ja, Rollen vergeben'
    });
    if (!confirmed) return;
    if (button) button.disabled = true;
    try {
      const response = await api.apiRequest({
        path: '/api/guild/' + encodeURIComponent(s.selectedGuildId) + '/levels/grant-all',
        method: 'POST',
        body: {},
        timeoutMs: 120000
      });
      if (handleExpiredSession(response)) return;
      if (!response.ok || response.data?.result?.ok === false) {
        const result = response.data?.result || {};
        const reason = String(result.reason || '');
        let message;
        if (reason === 'no-mappings') message = 'Es sind keine Level-Rollen konfiguriert.';
        else if (reason === 'fetch-failed') message = 'Mitglieder konnten nicht geladen werden (Berechtigung „Mitglieder auflisten" nötig).';
        else if (reason === 'nothing-granted') {
          const sample = (result.errors || result.blocked || []).slice(0, 2).map(function (entry) { return String(entry?.reason || entry || ''); }).filter(Boolean).join(' · ');
          message = 'Keine Level-Rolle konnte vergeben werden.' + (sample ? ' ' + sample : ' Prüfe, ob die Level-Rollen unter der höchsten Bot-Rolle liegen.');
        } else {
          message = response.data?.error || 'Die Rollenvergabe konnte nicht ausgeführt werden.';
        }
        throw new Error(message);
      }
      const result = response.data?.result || {};
      let message;
      if (!Number(result.members || 0)) {
        message = 'Keine Mitglieder mit gespeichertem XP-Stand oder Level-Rollen gefunden – alle Rollen sind aktuell.';
      } else {
        message = 'Rollenvergabe abgeschlossen: ' + result.added + ' Rollen vergeben, ' + result.removed + ' korrigiert (' + result.processed + ' Mitglieder).';
      }
      const warnings = [];
      if (Number(result.failedCount || 0) > 0) warnings.push(Number(result.failedCount) + ' Änderungen fehlgeschlagen');
      if (Number(result.blockedCount || 0) > 0) warnings.push(Number(result.blockedCount) + ' Rollen konnten nicht vergeben werden (z. B. über der höchsten Bot-Rolle)');
      if (warnings.length) message += ' ⚠ ' + warnings.join(' · ');
      toast(message, result.hadErrors ? 'error' : 'success');
    } catch (error) {
      toast(String(error?.message || error), 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  window.FHCCLevelsPanel = {
    overview: levelsOverview,
    studioTemplate: levelsStudioTemplate,
    previewValue: levelsPreviewValue,
    previewTemplate: levelsPreviewTemplate,
    openStudio: openLevelsStudio,
    saveStudioTemplate: saveLevelsStudioTemplate,
    levelUpStudioTemplate: levelUpStudioTemplate,
    levelUpPreviewValue: levelUpPreviewValue,
    levelUpPreviewTemplate: levelUpPreviewTemplate,
    openLevelUpStudio: openLevelUpStudio,
    saveLevelUpStudioTemplate: saveLevelUpStudioTemplate,
    levelUpInfoStudioTemplate: levelUpInfoStudioTemplate,
    levelUpInfoPreviewValue: levelUpInfoPreviewValue,
    levelUpInfoPreviewTemplate: levelUpInfoPreviewTemplate,
    openLevelUpInfoStudio: openLevelUpInfoStudio,
    saveLevelUpInfoStudioTemplate: saveLevelUpInfoStudioTemplate,
    setMemberLevelAction: setMemberLevelAction,
    wipeLevelRolesAction: wipeLevelRolesAction,
    grantLevelRolesToAllAction: grantLevelRolesToAllAction
  };
})();
