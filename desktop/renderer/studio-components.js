(function () {
  'use strict';

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);

  function normalizeComponent(component) {
    const data = component || {};
    const emoji = data.emoji && typeof data.emoji === 'object'
      ? {
        id: String(data.emoji.id || ''),
        name: String(data.emoji.name || ''),
        animated: Boolean(data.emoji.animated)
      }
      : null;
    const result = {
      type: Number(data.type || 2),
      customId: String(data.customId || data.custom_id || ''),
      label: String(data.label || ''),
      style: Number(data.style || 2),
      emoji,
      disabled: Boolean(data.disabled),
      url: String(data.url || '')
    };
    if (Array.isArray(data.options)) {
      result.options = data.options.slice(0, 25).map(function (option) {
        return {
          label: String(option.label || '').slice(0, 100),
          value: String(option.value || '').slice(0, 100),
          description: String(option.description || '').slice(0, 100),
          emoji: option.emoji && typeof option.emoji === 'object'
            ? { id: String(option.emoji.id || ''), name: String(option.emoji.name || ''), animated: Boolean(option.emoji.animated) }
            : null,
          default: Boolean(option.default)
        };
      }).filter(function (option) { return option.label && option.value; });
    }
    if (data.placeholder) result.placeholder = String(data.placeholder).slice(0, 150);
    if (data.minValues !== undefined || data.min_values !== undefined) result.minValues = Number(data.minValues ?? data.min_values) || 0;
    if (data.maxValues !== undefined || data.max_values !== undefined) result.maxValues = Number(data.maxValues ?? data.max_values) || 1;
    return result;
  }

  function normalizeRow(row) {
    const data = row || {};
    const components = (Array.isArray(data.components) ? data.components : [])
      .map(normalizeComponent)
      .filter(function (component) {
        return component.type !== 2 || component.url || component.customId || component.label || component.emoji;
      })
      .slice(0, 5);
    return components.length ? { type: Number(data.type || 1), components } : null;
  }

  function normalizeRows(rows) {
    return (Array.isArray(rows) ? rows : []).map(normalizeRow).filter(Boolean).slice(0, 5);
  }

  function emojiHtml(component = {}) {
    const emoji = component.emoji || {};
    if (emoji.id) {
      return '<img src="https://cdn.discordapp.com/emojis/' + escapeHtml(emoji.id) + '.' + (emoji.animated ? 'gif' : 'png') + '?size=32" alt="' + escapeHtml(emoji.name || '') + '">';
    }
    return emoji.name ? '<span>' + escapeHtml(emoji.name) + '</span>' : '';
  }

  function label(component = {}) {
    return String(component.label || component.placeholder || component.customId || component.url || 'Komponente').trim();
  }

  function renderPreview(rows, host) {
    if (!host) return;
    const importedRows = normalizeRows(rows);
    const importedHtml = importedRows.map(function (row) {
      const buttons = row.components.map(function (component) {
        const style = Number(component.style || 2);
        const styleClass = component.type !== 2 ? 'select' : style === 1 ? 'style-0' : style === 3 ? 'style-1' : style === 4 ? 'danger' : style === 5 ? 'link' : 'style-2';
        const suffix = component.type !== 2 && Array.isArray(component.options) ? ' · ' + component.options.length + ' Optionen' : '';
        return '<span class="function-button imported ' + styleClass + '">' + emojiHtml(component) + '<b>' + escapeHtml(label(component) + suffix) + '</b></span>';
      }).join('');
      return '<div class="preview-component-row">' + buttons + '</div>';
    }).join('');
    if (!importedHtml) return;
    if (host.id === 'preview-function-set') {
      host.insertAdjacentHTML('beforeend', importedHtml);
      host.hidden = false;
    } else {
      host.innerHTML = importedHtml;
      host.hidden = false;
    }
  }

  window.FHCCStudioComponents = {
    normalizeComponent,
    normalizeRow,
    normalizeRows,
    renderPreview
  };
})();
