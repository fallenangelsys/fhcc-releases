(function () {
  'use strict';

  function settingLines(value) {
    const source = Array.isArray(value) ? value : String(value || '').split(/[\r\n,]+/);
    return source.map(function (entry) { return String(entry || '').trim(); }).filter(Boolean);
  }

  const channelTypeAliases = {
    text: 0,
    voice: 2,
    category: 4,
    announcement: 5,
    stage: 13,
    forum: 15,
    media: 16
  };

  function appState() {
    return globalThis.state || { moduleChannels: [], moduleRoles: [] };
  }

  function channelTypeAllowed(field, channel) {
    const filters = Array.isArray(field.channelTypes) ? field.channelTypes : [];
    const type = Number(channel && channel.type);
    if (!filters.length) {
      if (type === 4) return String(field.type || '').toLowerCase() === 'multichannelselect';
      return [0, 2, 5, 13, 15, 16].includes(type);
    }
    return filters.some(function (filter) {
      if (typeof filter === 'number') return type === filter;
      const normalized = String(filter || '').toLowerCase();
      if (/^\d+$/.test(normalized)) return type === Number(normalized);
      return channelTypeAliases[normalized] === type;
    });
  }

  function channelsForField(field) {
    return appState().moduleChannels.filter(function (channel) { return channelTypeAllowed(field, channel); });
  }

  function channelIcon(channel) {
    const type = Number(channel && channel.type);
    if (type === 4) return 'C';
    if (type === 2) return 'V';
    if (type === 13) return 'S';
    if (type === 15) return 'F';
    if (type === 16) return 'M';
    return '#';
  }

  function channelKindLabel(channel) {
    const type = Number(channel && channel.type);
    if (type === 4) return 'Kategorie';
    if (type === 2) return 'Voice';
    if (type === 13) return 'Stage';
    if (type === 15) return 'Forum';
    if (type === 16) return 'Media';
    if (type === 5) return 'Ankündigung';
    return 'Text';
  }

  function groupedDiscordChannels(channels) {
    const groups = [];
    const byKey = new Map();
    (channels || []).forEach(function (channel) {
      const isCategory = Number(channel?.type) === 4 || channel?.isCategory === true;
      const key = isCategory ? String(channel.id || 'category') : String(channel?.categoryId || 'root');
      const label = isCategory
        ? String(channel.name || 'KATEGORIE').toUpperCase()
        : channel?.categoryId
          ? String(channel.categoryName || 'KATEGORIE').toUpperCase()
          : 'OHNE KATEGORIE';
      if (!byKey.has(key)) {
        const group = { key, label, channels: [] };
        byKey.set(key, group);
        groups.push(group);
      }
      byKey.get(key).channels.push(channel);
    });
    return groups;
  }

  function channelOptionMarkup(channel, selected) {
    const id = String(channel.id || '');
    return '<option value="' + escapeHtml(id) + '" ' + (id === selected ? 'selected' : '') + '>' + escapeHtml(channelKindLabel(channel)) + ' · ' + escapeHtml(channel.name || id) + '</option>';
  }

  function channelSelectInput(field, current) {
    const selected = String(current || '');
    const channels = channelsForField(field);
    const known = channels.some(function (channel) { return String(channel.id) === selected; });
    const retained = selected && !known ? '<option value="' + escapeHtml(selected) + '" selected>Gespeicherter Kanal · ' + escapeHtml(selected) + '</option>' : '';
    const channelGroups = channels.length && channels.every(function (channel) { return Number(channel?.type) === 4 || channel?.isCategory === true; })
      ? [{ key: 'categories', label: 'KATEGORIEN', channels }]
      : groupedDiscordChannels(channels);
    const options = channelGroups.map(function (group) {
      return '<optgroup label="' + escapeHtml(group.label) + '">' + group.channels.map(function (channel) {
        return channelOptionMarkup(channel, selected);
      }).join('') + '</optgroup>';
    }).join('');
    return '<select class="module-resource-select" data-setting-key="' + escapeHtml(field.key) + '" data-setting-type="channel-select"><option value="">Kanal auswählen ...</option>' + retained + options + '</select>';
  }

  function roleOptions(selectedRoleId) {
    const state = appState();
    const selected = String(selectedRoleId || '');
    const known = state.moduleRoles.some(function (role) { return String(role.id) === selected; });
    const retained = selected && !known ? '<option value="' + escapeHtml(selected) + '" selected>Gespeicherte Rolle · ' + escapeHtml(selected) + '</option>' : '';
    return '<option value="">Rolle auswählen ...</option>' + retained + state.moduleRoles.map(function (role) {
      const id = String(role.id || '');
      const blocked = role.assignable === false;
      return '<option value="' + escapeHtml(id) + '" ' + (id === selected ? 'selected' : '') + ' ' + (blocked ? 'disabled' : '') + '>@' + escapeHtml(role.name || id) + (blocked ? ' · nicht verwaltbar' : '') + '</option>';
    }).join('');
  }

  function singleRoleInput(field, current) {
    return '<select class="module-resource-select" data-setting-key="' + escapeHtml(field.key) + '" data-setting-type="role-select">' + roleOptions(current) + '</select>';
  }

  function multiChannelInput(field, current) {
    const selected = new Set(settingLines(current));
    const channels = channelsForField(field);
    const knownIds = new Set(channels.map(function (channel) { return String(channel.id || ''); }));
    const choices = groupedDiscordChannels(channels).map(function (group) {
      return '<section class="module-channel-choice-group" data-channel-choice-group><h5>' + escapeHtml(group.label) + '</h5>' + group.channels.map(function (channel) {
        const id = String(channel.id || '');
        const isSelected = selected.has(id);
        return '<label class="module-channel-choice" data-channel-search-text="' + escapeHtml((channel.name || '') + ' ' + group.label + ' ' + channelKindLabel(channel) + ' ' + id) + '"><input type="checkbox" data-channel-choice value="' + escapeHtml(id) + '" ' + (isSelected ? 'checked' : '') + '><i>' + escapeHtml(channelIcon(channel)) + '</i><span>' + escapeHtml(channel.name || id) + '</span><em>' + escapeHtml(channelKindLabel(channel).toUpperCase()) + '</em></label>';
      }).join('') + '</section>';
    }).join('') + [...selected].filter(function (id) { return !knownIds.has(id); }).map(function (id) {
      return '<label class="module-channel-choice retained" data-channel-search-text="' + escapeHtml(id) + ' gespeicherter kanal"><input type="checkbox" data-channel-choice value="' + escapeHtml(id) + '" checked><i>!</i><span>Gespeicherter Kanal · ' + escapeHtml(id) + '</span><em>PRÜFEN</em></label>';
    }).join('');
    return '<div class="module-channel-multi" data-setting-key="' + escapeHtml(field.key) + '" data-setting-type="channel-multi">' +
      '<div class="module-role-map-head"><strong>Kanäle auswählen</strong><span data-channel-selected-count>' + selected.size + ' ausgewählt</span></div>' +
      '<div class="module-role-tools"><input type="search" data-channel-search autocomplete="off" placeholder="Kanal suchen ..."><button type="button" data-clear-channel-selection>Auswahl leeren</button></div>' +
      '<div class="module-channel-choice-grid">' + (choices || '<p class="module-resource-empty">Keine auswählbaren Kanäle gefunden.</p>') + '</div></div>';
  }

  function emojiPreviewHtml(value) {
    const raw = value === undefined || value === null ? '' : String(value);
    if (!raw) return '🙂';
    const mention = /^<a?:([A-Za-z0-9_~]+):(\d+)>$/.exec(raw);
    if (mention) {
      const animated = raw.charAt(1) === 'a';
      const url = 'https://cdn.discordapp.com/emojis/' + mention[2] + '.' + (animated ? 'gif' : 'png') + '?size=64&quality=lossless';
      return '<img class="module-emoji-preview-img" src="' + url + '" alt="' + escapeHtml(raw) + '" title="' + escapeHtml(raw) + '" loading="lazy" decoding="async">';
    }
    return escapeHtml(raw);
  }

  function emojiInput(field, current) {
    const value = current === undefined || current === null ? '' : String(current);
    const preview = emojiPreviewHtml(value);
    return '<div class="module-emoji-control"><span class="module-emoji-preview" data-emoji-preview>' + preview + '</span>' +
      '<input type="text" data-setting-key="' + escapeHtml(field.key) + '" data-setting-type="emoji" data-emoji-input value="' + escapeHtml(value) + '" placeholder="' + escapeHtml(field.placeholder || 'Emoji auswählen ...') + '">' +
      '<button type="button" class="module-emoji-picker-button" data-open-emoji-picker aria-label="Emoji-Bibliothek öffnen">Emoji auswählen</button></div>';
  }

  function parseRoleMappings(value) {
    return settingLines(value).map(function (entry, index) {
      const match = /^(\d+)\s*=\s*(\d+)$/.exec(entry);
      if (match) return { count: Number(match[1]), roleId: match[2] };
      return /^\d+$/.test(entry) ? { count: index + 1, roleId: entry } : null;
    }).filter(Boolean);
  }

  function parseRoleSwapPairs(value) {
    return settingLines(value).map(function (line) {
      const match = /^(\d+)>(\d+)$/.exec(String(line || '').trim());
      return match ? { triggerRoleId: match[1], swapRoleId: match[2] } : null;
    }).filter(Boolean);
  }

  function roleMappingRow(mapping, kind) {
    const entry = mapping || {};
    const economy = kind === 'economy';
    const levels = kind === 'levels';
    const swap = kind === 'swap';
    if (swap) {
      return '<div class="module-role-map-row">' +
        '<label><span>Auslöser-Rolle (wird vergeben)</span><select class="module-resource-select" data-role-trigger>' + roleOptions(entry.triggerRoleId) + '</select></label>' +
        '<label><span>Wird entfernt & zurückgegeben</span><select class="module-resource-select" data-role-swap>' + roleOptions(entry.swapRoleId) + '</select></label>' +
        '<button type="button" class="module-role-remove" data-remove-role-mapping>Entfernen</button></div>';
    }
    const count = Math.max(1, Number(entry.count || 1));
    return '<div class="module-role-map-row">' +
      '<label><span>' + (economy ? 'Coin-Preis' : levels ? 'Benötigtes Level' : 'Boost-Anzahl') + '</span><input type="number" min="1" max="' + (economy ? '10000000' : levels ? '999' : '99') + '" data-role-count value="' + count + '"></label>' +
      '<label><span>Discord-Rolle</span><select class="module-resource-select" data-role-id>' + roleOptions(entry.roleId) + '</select></label>' +
      '<button type="button" class="module-role-remove" data-remove-role-mapping>Entfernen</button></div>';
  }

  function roleMappingInput(field, current) {
    const economy = String(field.key || '').includes('heavenEconomy');
    const levels = String(field.key || '').includes('levelRoleMappings');
    const swap = String(field.key || '').includes('roleSwap');
    const kind = economy ? 'economy' : levels ? 'levels' : swap ? 'swap' : 'boost';
    const mappings = swap ? parseRoleSwapPairs(current) : parseRoleMappings(current);
    const defaults = economy ? [500, 1000, 2500, 4000, 5000].map(function (price) { return { count: price, roleId: '' }; }) : swap ? [{ triggerRoleId: '', swapRoleId: '' }] : [{ count: 1, roleId: '' }];
    const rows = (mappings.length ? mappings : defaults).map(function (mapping) { return roleMappingRow(mapping, kind); }).join('');
    return '<div class="module-role-mapping" data-mapping-kind="' + kind + '" data-setting-key="' + escapeHtml(field.key) + '" data-setting-type="role-mapping">' +
      '<div class="module-role-map-head"><strong>' + (economy ? 'VIP-Preise' : levels ? 'Level-Belohnungen' : swap ? 'Tausch-Paare' : 'Boost-Staffeln') + '</strong><span>' + (economy ? 'Eine eindeutige VIP-Rolle je Coin-Preis' : levels ? 'Eine Discord-Rolle je erreichtem Level' : swap ? 'Auslöser-Rolle → Rolle, die entfernt und später zurückgegeben wird' : 'Eine eindeutige Rolle je Boost-Anzahl') + '</span></div>' +
      '<div class="module-role-map-rows">' + rows + '</div><button type="button" class="module-role-add" data-add-role-mapping>+ ' + (levels ? 'Level-Belohnung' : swap ? 'Tausch-Paar' : 'Staffel') + ' hinzufügen</button></div>';
  }

  function multiRoleInput(field, current) {
    const state = appState();
    const selected = new Set(settingLines(current));
    const knownIds = new Set(state.moduleRoles.map(function (role) { return String(role.id || ''); }));
    const choices = state.moduleRoles.map(function (role) {
      const id = String(role.id || '');
      const color = Number(role.color || 0) ? '#' + Number(role.color).toString(16).padStart(6, '0') : '#aeb4c5';
      const blocked = role.assignable === false;
      const isSelected = selected.has(id);
      return '<label class="module-role-choice ' + (blocked ? 'blocked' : '') + '" data-role-search-text="' + escapeHtml((role.name || '') + ' ' + id) + '" title="' + escapeHtml(blocked ? (role.blockedReason || 'Rolle kann vom Bot nicht verwaltet werden.') : '') + '"><input type="checkbox" data-role-choice value="' + escapeHtml(id) + '" ' + (isSelected ? 'checked' : '') + ' ' + (blocked && !isSelected ? 'disabled' : '') + '><i style="--role-color:' + escapeHtml(color) + '"></i><span>@' + escapeHtml(role.name || id) + '</span>' + (blocked ? '<em>BLOCKIERT</em>' : '') + '</label>';
    }).join('') + [...selected].filter(function (id) { return !knownIds.has(id); }).map(function (id) {
      return '<label class="module-role-choice blocked retained" data-role-search-text="' + escapeHtml(id) + ' gespeicherte rolle"><input type="checkbox" data-role-choice value="' + escapeHtml(id) + '" checked><i style="--role-color:#ffbd59"></i><span>Gespeicherte Rolle · ' + escapeHtml(id) + '</span><em>PRÜFEN</em></label>';
    }).join('');
    return '<div class="module-role-multi" data-setting-key="' + escapeHtml(field.key) + '" data-setting-type="role-multi">' +
      '<div class="module-role-map-head"><strong>Rollen auswählen</strong><span data-role-selected-count>' + selected.size + ' ausgewählt</span></div><div class="module-role-tools"><input type="search" data-role-search autocomplete="off" placeholder="Rolle suchen ..."><button type="button" data-clear-role-selection>Auswahl leeren</button></div><div class="module-role-choice-grid">' +
      (choices || '<p class="module-resource-empty">Keine auswählbaren Rollen gefunden.</p>') + '</div></div>';
  }

  function inputForField(field, current) {
    const type = String(field.type || 'text').toLowerCase();
    if (type === 'channelselect') return channelSelectInput(field, current);
    if (type === 'multichannelselect') return multiChannelInput(field, current);
    if (type === 'roleselect') return singleRoleInput(field, current);
    if (type === 'rolemappingselect' || type === 'roleswapselect') return roleMappingInput(field, current);
    if (type === 'multiroleselect') return multiRoleInput(field, current);
    if (type === 'emoji') return emojiInput(field, current);
    if (type === 'textarea' || type === 'arraylines' || type === 'json') {
      const textValue = type === 'json' && current && typeof current === 'object' ? JSON.stringify(current, null, 2) : (current || '');
      return '<textarea data-setting-key="' + escapeHtml(field.key) + '" rows="' + (type === 'arraylines' || type === 'json' ? '6' : '4') + '" placeholder="' + escapeHtml(field.placeholder || '') + '" ' + (type === 'json' ? 'spellcheck="false" data-setting-format="json"' : '') + '>' + escapeHtml(textValue) + '</textarea>';
    }
    if (type === 'checkbox') return '<input type="checkbox" role="switch" data-setting-key="' + escapeHtml(field.key) + '" data-setting-type="checkbox" ' + (current ? 'checked' : '') + '>';
    if (type === 'select' && Array.isArray(field.options)) {
      return '<select data-setting-key="' + escapeHtml(field.key) + '">' + field.options.map(function (option) {
        const value = typeof option === 'object' ? option.value : option;
        const label = typeof option === 'object' ? option.label : option;
        return '<option value="' + escapeHtml(value) + '" ' + (String(value) === String(current) ? 'selected' : '') + '>' + escapeHtml(label) + '</option>';
      }).join('') + '</select>';
    }
    const inputType = type === 'number' || type === 'integer' ? 'number' : type === 'password' ? 'password' : 'text';
    const numeric = inputType === 'number';
    const constraints = (numeric && field.min !== undefined ? ' min="' + escapeHtml(field.min) + '"' : '') +
      (numeric && field.max !== undefined ? ' max="' + escapeHtml(field.max) + '"' : '') +
      (numeric && field.step !== undefined ? ' step="' + escapeHtml(field.step) + '"' : '');
    return '<input type="' + inputType + '" data-setting-key="' + escapeHtml(field.key) + '" value="' + escapeHtml(current === undefined || current === null ? '' : current) + '" placeholder="' + escapeHtml(field.placeholder || '') + '"' + (inputType === 'password' ? ' autocomplete="off" spellcheck="false"' : '') + constraints + '>';
  }

  window.FHCCModuleConfigInputs = {
    settingLines,
    channelTypeAliases,
    channelTypeAllowed,
    channelsForField,
    channelIcon,
    channelKindLabel,
    groupedDiscordChannels,
    channelOptionMarkup,
    channelSelectInput,
    roleOptions,
    singleRoleInput,
    multiChannelInput,
    emojiPreviewHtml,
    emojiInput,
    parseRoleMappings,
    parseRoleSwapPairs,
    roleMappingRow,
    roleMappingInput,
    multiRoleInput,
    inputForField
  };
})();
