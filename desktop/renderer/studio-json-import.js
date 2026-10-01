(function () {
  'use strict';

  const cloneValue = (value) => JSON.parse(JSON.stringify(value ?? null));

  function unwrap(value) {
    if (Array.isArray(value)) return { embeds: value };
    if (!value || typeof value !== 'object') return {};
    if (Array.isArray(value.messages) && value.messages.length) return unwrap(value.messages[0]?.data || value.messages[0]);
    if (value.message && typeof value.message === 'object') return unwrap(value.message);
    if (value.data && typeof value.data === 'object' && (value.data.content !== undefined || value.data.embed || value.data.embeds)) return unwrap(value.data);
    if (!value.embeds && !value.embed && (value.title !== undefined || value.description !== undefined || value.fields)) return { embeds: [value] };
    return value;
  }

  function colorValue(value) {
    if (Number.isInteger(value)) return '#' + Math.max(0, Math.min(0xffffff, value)).toString(16).padStart(6, '0');
    const text = String(value || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();
    if (/^[0-9a-f]{6}$/i.test(text)) return '#' + text.toLowerCase();
    return '#58b9ff';
  }

  function normalizeEmbed(value) {
    const embed = value && typeof value === 'object' ? value : {};
    const timestampValue = typeof embed.timestamp === 'string' ? embed.timestamp : String(embed.timestampValue || '');
    return {
      title: String(embed.title || ''),
      url: String(embed.url || ''),
      description: String(embed.description || ''),
      color: colorValue(embed.color),
      authorName: String(embed.authorName ?? embed.author?.name ?? ''),
      authorIconUrl: String(embed.authorIconUrl ?? embed.author?.icon_url ?? embed.author?.iconURL ?? ''),
      thumbnailUrl: String(embed.thumbnailUrl ?? embed.thumbnail?.url ?? ''),
      imageUrl: String(embed.imageUrl ?? embed.image?.url ?? ''),
      footerText: String(embed.footerText ?? embed.footer?.text ?? ''),
      footerIconUrl: String(embed.footerIconUrl ?? embed.footer?.icon_url ?? embed.footer?.iconURL ?? ''),
      timestamp: embed.timestamp !== false && (embed.timestamp === true || Boolean(timestampValue)),
      timestampValue,
      fields: (Array.isArray(embed.fields) ? embed.fields : []).slice(0, 25).map(function (field) {
        return { name: String(field?.name || ''), value: String(field?.value || ''), inline: field?.inline === true };
      })
    };
  }

  function parse(text) {
    let decoded;
    try {
      decoded = JSON.parse(String(text || '').replace(/^\uFEFF/, '').trim());
    } catch {
      throw new Error('Bitte gültiges JSON eingeben.');
    }
    const source = unwrap(decoded);
    const rawEmbeds = (Array.isArray(source.embeds) ? source.embeds : source.embed ? [source.embed] : []).filter((embed) => embed && typeof embed === 'object').slice(0, 10);
    const content = String(source.content || '');
    if (!rawEmbeds.length && !content.trim()) throw new Error('Das JSON enthält keinen Nachrichteninhalt oder Embed.');
    const embeds = rawEmbeds.map(normalizeEmbed);
    return {
      content,
      embeds,
      embed: embeds[0] || null,
      channelId: String(source.channelId || ''),
      outsideImageUrl: String(source.outsideImageUrl || ''),
      outsideImageName: String(source.outsideImageName || ''),
      outsideImageSize: Number(source.outsideImageSize || 0),
      outsideImageAttachment: source.outsideImageAttachment || null,
      componentSet: source.componentSet === 'heavenEconomy' ? 'heavenEconomy' : 'none',
      studioComponents: cloneValue(source.studioComponents || source.components || []),
      reactionRoles: cloneValue(source.reactionRoles || [])
    };
  }

  function merge(imported, current) {
    const previous = current && typeof current === 'object' ? cloneValue(current) : {};
    const next = { ...previous, ...cloneValue(imported) };
    next.specialTemplate = String(previous.specialTemplate || '');
    if (next.specialTemplate) {
      next.channelId = String(previous.channelId || '');
      next.componentSet = previous.componentSet || 'none';
      next.studioComponents = cloneValue(previous.studioComponents || []);
      next.reactionRoles = cloneValue(previous.reactionRoles || []);
      for (const key of ['activityRaceUsePeriodColor', 'section', 'workshopItemId', 'workshopItemTitle', 'workshopItemTokens', 'workshopAssetMode']) {
        if (Object.prototype.hasOwnProperty.call(previous, key)) next[key] = cloneValue(previous[key]);
      }
    } else if (!next.channelId) {
      next.channelId = String(previous.channelId || '');
    }
    next.embeds = (Array.isArray(imported.embeds) ? cloneValue(imported.embeds) : []).slice(0, 10);
    next.embed = next.embeds[0] || null;
    next.messageId = '';
    return next;
  }

  function create(context) {
    const button = document.getElementById('import-content');
    const dialog = document.getElementById('studio-json-import-dialog');
    const input = document.getElementById('studio-json-import-value');
    const status = document.getElementById('studio-json-import-status');
    const paste = document.getElementById('studio-json-import-paste');
    const apply = document.getElementById('studio-json-import-apply');
    if (!button || !dialog || !input || !apply) return null;
    const setStatus = function (message, error) {
      if (!status) return;
      status.textContent = message || '';
      status.dataset.state = error ? 'error' : 'ready';
    };
    button.addEventListener('click', function () {
      input.value = '';
      setStatus('', false);
      dialog.showModal();
      input.focus();
    });
    paste?.addEventListener('click', async function () {
      try {
        input.value = await navigator.clipboard.readText();
        setStatus(input.value.trim() ? 'JSON aus der Zwischenablage eingefügt.' : 'Die Zwischenablage ist leer.', !input.value.trim());
      } catch {
        setStatus('Zwischenablage nicht verfügbar. JSON kann direkt eingefügt werden.', true);
      }
    });
    apply.addEventListener('click', function () {
      try {
        const imported = parse(input.value);
        const template = merge(imported, context.currentStudioTemplate());
        const validation = context.renderStudioLimits(template);
        if (!validation.valid) throw new Error(validation.errors[0]);
        context.loadStudioTemplate(template);
        context.renderDrafts();
        dialog.close();
        context.toast(`${template.embeds.length} Embed${template.embeds.length === 1 ? '' : 's'} aus JSON geladen.`, 'success');
      } catch (error) {
        setStatus(String(error?.message || error), true);
      }
    });
    return { open: function () { button.click(); } };
  }

  window.FHCCStudioJsonImport = { unwrap, normalizeEmbed, parse, merge, create };
})();
