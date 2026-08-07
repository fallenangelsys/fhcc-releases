(function () {
  'use strict';

  const api = window.fallenHeaven;
  const jobs = window.FallenHeavenJobs;
  const cache = new Map();
  const CACHE_MS = 30_000;
  const MANAGEMENT_REFRESH_MS = 30_000;
  const CHANNEL_DOM_LIMIT = 80;
  const CHANNEL_LIVE_REFRESH_MS = 2500;
  let activeTab = 'events';
  let memberTimer = null;
  let memberSyncTimer = null;
  let hasRenderedMembers = false;
  let currentManagement = null;
  let memberPage = 0;
  let memberPageSize = 25;
  let memberFilter = 'all';
  let memberSort = 'inactivity';
  let systemEventPageSize = 25;
  let systemEventPage = 0;
  let systemEventFilter = 'all';
  let systemEventRequestId = 0;
let selectedMember = null;
let pendingMemberAction = null;
  let selectedChannelId = '';
  let selectedChannelMeta = null;
  let selectedForumParentId = '';
  let channelRows = [];
  let channelBefore = '';
  let channelHasMore = false;
  let channelRefreshTimer = null;
  let channelLiveRefreshTimer = null;
  let channelRefreshInFlight = false;
  let channelRenderPending = false;
  let channelWindowStart = 0;
  let channelPage = 1;
  let channelTotalPages = 1;
  let channelTotalMessages = 0;
  let channelIndexComplete = false;
  let channelStorage = '';
  let channelLoadRequestId = 0;
  let roleLoadRequestId = 0;
  let memberIndexStatus = null;
  let memberAnalysisPollTimer = null;
  let memberRequestId = 0;
  let memberDetailRequestId = 0;
  let managementLoadInFlight = false;
  let managementLoadingGuildId = '';
  let managementRefreshQueued = false;
  let managementRenderFrame = 0;
  let boostActivityPreviewText = '';
  let boostActivityPreviewTimer = null;
  let boostActivityPreviewRequestId = 0;
  let boostBaselineQuery = '';
  let pendingBackupRestore = null;
  let vipEconomy = null;
  let selectedVipAccountId = '';
  let pendingVipUpdate = null;
  let vipSearchTimer = null;
  const memberIntelligenceTabs = new Map();

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const guildId = () => String($('#guild-select')?.value || '').trim();
  const safeString = (value, fallback = '') => String(value ?? fallback);
  const safeArray = (value) => Array.isArray(value) ? value : [];
  const safe = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const embedColor = (value) => {
    const raw = String(value ?? '').trim();
    if (/^#[0-9a-f]{3,8}$/i.test(raw)) return raw;
    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > 0 && numeric <= 0xffffff) {
      return '#' + numeric.toString(16).padStart(6, '0');
    }
    return '#5865f2';
  };
  const avatarSource = (entity = {}) => String(entity?.avatarUrl || entity?.avatar || entity?.fallbackAvatar || entity?.defaultAvatar || 'assets/fallen-heaven-icon.png');
  const date = (value, includeTime = true) => value ? new Intl.DateTimeFormat('de-DE', includeTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(new Date(value)) : 'Unbekannt';
  const forumPostPinned = (post) => Boolean(post?.pinned || post?.thread?.pinned);
  const forumPostTime = (post) => Date.parse(post?.createdAt || post?.thread?.createdAt || '') || 0;
  const sanitizeMediaUrl = (value) => String(value || '').trim();
  const mediaUrlBase = (value) => sanitizeMediaUrl(value).split('#')[0].split('?')[0].trim();
  const mediaExtension = (value) => (mediaUrlBase(value).match(/\.([a-z0-9]{2,8})$/i)?.[1] || '').toLowerCase();
  const attachmentContentType = (item = {}) => String(item?.contentType || item?.content_type || '').trim().toLowerCase();
  const shortDisplayUrl = (value, max = 96) => {
    const source = String(value || '').trim();
    if (!source) return '';
    const compact = (text) => {
      if (text.length <= max) return text;
      const head = Math.max(8, Math.floor(max * 0.6));
      const tail = Math.max(8, max - head - 3);
      return `${text.slice(0, head)}...${text.slice(-tail)}`;
    };
    try {
      const parsed = new URL(source);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
      const path = decodeURIComponent((parsed.pathname || '').replace(/\/+$/g, ''));
      const full = `${host}${path}${parsed.search || ''}`.trim();
      return compact(full);
    } catch (_error) {
      const plain = source.replace(/^https?:\/\//i, '').trim();
      return compact(plain);
    }
  };
  const mediaLinkTokenPattern = /(?:<|&lt;)?https?:\/\/[^\s<>"\]'\)}]+(?:\?[^\s<>"\]'\)}]+)?(?:>|&gt;)?/g;
  const decodeHtmlEntitiesInRenderedUrl = (value) => String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  const sanitizeTextUrl = (value) => {
    return String(value || '')
      .replace(/[)\],.;!?>]+$/g, '')
      .replace(/^["'`]+|["'`]+$/g, '')
      .trim();
  };
  const mediaCompareSignature = (value) => {
    const source = sanitizeMediaUrl(value);
    if (!source) return null;
    try {
      const parsed = new URL(source);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
      const path = decodeURIComponent(parsed.pathname || '').replace(/\/+$/, '').toLowerCase();
      const file = (path.split('/').pop() || '').toLowerCase();
      const ext = mediaExtension(file);
      const stem = file.replace(`.${ext}`, '');
      const compact = path.split('/').filter(Boolean).slice(-3).join('/').replace(/[^a-z0-9._-]/g, '');
      return {
        raw: mediaUrlBase(source).toLowerCase(),
        host,
        path,
        file,
        ext,
        stem: stem.replace(/[^a-z0-9_-]/g, ''),
        compact
      };
    } catch (_error) {
      const base = mediaUrlBase(source).toLowerCase();
      const file = (base.split('/').pop() || '').replace(/^#|[#?].*$/g, '');
      const ext = mediaExtension(file);
      const stem = file.replace(`.${ext}`, '');
      return {
        raw: base,
        host: '',
        path: base,
        file: file.replace(/[^a-z0-9._-]/g, ''),
        ext: ext,
        stem: stem.replace(/[^a-z0-9_-]/g, ''),
        compact: file.replace(/[^a-z0-9._-]/g, '')
      };
    }
  };
  const mediaLinkMatches = (left, right) => {
    const a = mediaCompareSignature(left);
    const b = mediaCompareSignature(right);
    if (!a || !b) return false;
    if (a.raw === b.raw) return true;
    if (a.ext && a.ext === b.ext && a.stem && a.stem === b.stem && a.stem.length > 4) return true;
    if (a.path === b.path && a.ext === b.ext) return true;
    if (a.host && b.host && a.host === b.host && a.compact && b.compact && a.compact.includes(b.compact)) return true;
    const compactA = String(a.compact || '').replace(/[^a-z0-9]/gi, '');
    const compactB = String(b.compact || '').replace(/[^a-z0-9]/gi, '');
    if (compactA && compactB && (compactA.includes(compactB) || compactB.includes(compactA)) && a.ext === b.ext && compactA.length > 6 && compactB.length > 6) return true;
    return false;
  };

  const textMediaUrls = (value) => {
    const urls = String(value || '').match(mediaLinkTokenPattern) || [];
    return urls.map((item) => mediaUrlBase(sanitizeTextUrl(decodeHtmlEntitiesInRenderedUrl(item))));
  };

  const isImageUrl = (value) => {
    const ext = mediaExtension(value);
    return /\.(?:png|jpe?g|webp|bmp|gif|gifv|avif|svg)$/i.test(`.${ext}`) || /\/gifs?\//i.test(mediaUrlBase(value));
  };
  const isVideoUrl = (value) => {
    const ext = mediaExtension(value);
    return /\.(?:mp4|webm|mov|m4v|mkv|m3u8)$/i.test(`.${ext}`) || /\/videos?\//i.test(mediaUrlBase(value));
  };
  const isAudioUrl = (value) => {
    const ext = mediaExtension(value);
    return /\.(?:mp3|ogg|wav|m4a|flac|aac)$/i.test(`.${ext}`);
  };
  const isGifUrl = (value, contentType = '') => {
    const normalizedType = String(contentType || '').toLowerCase();
    const ext = mediaExtension(value);
    const base = mediaUrlBase(value);
    return normalizedType.includes('gif') || ext === 'gif' || ext === 'gifv' || /\/gifs?\//i.test(base) || /(giphy|tenor\.com|media\.tenor\.com)/i.test(base);
  };
  const isDirectImageMediaUrl = (value) => {
    const source = sanitizeMediaUrl(value);
    const ext = mediaExtension(source);
    if (/^(?:png|jpe?g|webp|bmp|gif|avif|svg)$/i.test(ext)) return true;
    try {
      const parsed = new URL(source);
      const host = parsed.hostname.toLowerCase();
      const format = String(parsed.searchParams.get('format') || '').toLowerCase();
      if (/^(?:png|jpe?g|webp|gif|avif)$/i.test(format)) return true;
      return /^(?:media\.tenor\.com|media\d*\.giphy\.com|i\.giphy\.com|cdn\.discordapp\.com|media\.discordapp\.net)$/i.test(host)
        && !/^\/(?:view|search|gifs?)\//i.test(parsed.pathname);
    } catch (_error) {
      return false;
    }
  };
  const isImageAttachment = (item = {}) => {
    const type = attachmentContentType(item);
    return /^image\//i.test(type) || type === 'image' || isImageUrl(item?.url || '') || isGifUrl(item?.url || '', type);
  };
  const isVideoAttachment = (item = {}) => {
    const type = attachmentContentType(item);
    return /^video\//i.test(type) || type === 'video' || isVideoUrl(item?.url || '');
  };
  const isAudioAttachment = (item = {}) => {
    const type = attachmentContentType(item);
    return /^audio\//i.test(type) || type === 'audio' || isAudioUrl(item?.url || '');
  };
  const firstImageAttachmentUrl = (items = []) => (Array.isArray(items)
    ? items.find((item) => isImageAttachment(item))
    : null)?.url || '';
  const embedHasVisualBody = (embed = {}) => {
    const title = String(embed.title || '').trim();
    const description = String(embed.description || '').trim();
    const author = embed.author || {};
    const footer = embed.footer || {};
    const authorText = typeof author === 'object'
      ? String(author.name || author.username || '').trim()
      : String(author || '').trim();
    const footerText = typeof footer === 'object'
      ? String(footer.text || footer.content || '').trim()
      : String(footer || '').trim();
    const fields = Array.isArray(embed.fields) ? embed.fields : [];
    const hasMeaningfulField = fields.some((field) => String(field?.name || '').trim() || String(field?.value || '').trim());
    return Boolean(title || description || authorText || footerText || hasMeaningfulField);
  };

  const contentHasOnlyMediaLink = (content, links) => {
    const raw = String(content || '');
    const hasAnyMedia = links.size > 0;
    if (!hasAnyMedia) return false;
    const textAfterLinksRemoved = raw
      .replace(mediaLinkTokenPattern, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return textAfterLinksRemoved.length === 0;
  };
  const embedPrimaryMedia = (embed = {}) => {
    const candidates = [
      { url: embed.image, type: 'image' },
      { url: embed.video, type: 'video' },
      { url: embed.thumbnail, type: 'image' }
    ].filter((entry) => String(entry.url || '').trim());
    for (const entry of candidates) {
      if (isImageUrl(entry.url) || (entry.type === 'image' && isGifUrl(entry.url, attachmentContentType(entry)))) return { ...entry, kind: 'image', url: String(entry.url).trim() };
      if (entry.type === 'video' && isVideoUrl(entry.url)) return { ...entry, kind: 'video', url: String(entry.url).trim() };
    }
    return null;
  };
  const embedSourceUrls = (embed = {}) => {
    const provider = embed?.provider || {};
    const author = embed?.author || {};
    const footer = embed?.footer || {};
    const media = embed?.media || {};
    return [
      embed.url,
      embed.thumbnail,
      embed.image,
      embed.video,
      provider.url,
      provider.proxy_url,
      embed.proxy_url,
      media.url,
      media.proxy_url,
      author.icon_url,
      author.proxy_icon_url,
      footer.icon_url,
      footer.proxy_icon_url
    ].filter(Boolean);
  };

  const compareForumPosts = (left, right) => {
    const pinDelta = Number(forumPostPinned(right)) - Number(forumPostPinned(left));
    if (pinDelta) return pinDelta;
    const timeDelta = forumPostTime(right) - forumPostTime(left);
    if (timeDelta) return timeDelta;
    return String(left?.name || left?.id || '').localeCompare(String(right?.name || right?.id || ''), 'de', { sensitivity: 'base' });
  };
  const fail = (response, fallback) => response?.data?.error || response?.data?.message || fallback;
  const notify = (message, tone = 'info') => {
    if (typeof window.fallenHeavenNotify === 'function') window.fallenHeavenNotify(message, tone);
  };
  const isCommunityVisible = () => Boolean($('#community-view')?.classList.contains('active')) && document.visibilityState === 'visible';

  document.addEventListener('error', (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;
    const fallback = image.dataset.fallback;
    if (fallback && image.src !== fallback) {
      image.dataset.fallback = '';
      image.src = fallback;
      return;
    }
    if (!image.src.endsWith('/assets/fallen-heaven-icon.png')) image.src = 'assets/fallen-heaven-icon.png';
  }, true);

  function renderDiscordPlainText(value) {
    return safe(String(value || ''))
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(mediaLinkTokenPattern, (url) => {
        const clean = sanitizeTextUrl(decodeHtmlEntitiesInRenderedUrl(url));
        const raw = clean;
        if (!raw) return '';
        const withMedia = mediaUrlBase(raw);
        if (isDirectImageMediaUrl(withMedia)) {
          return `<a class="message-image-link" href="#" data-open-url="${safe(raw)}"><img class="message-image" src="${safe(raw)}" alt="GIF oder Bild" loading="lazy"></a>`;
        }
        if (isVideoUrl(withMedia)) {
          return `<div class="message-media"><video controls preload="metadata" src="${safe(raw)}"></video><a href="#" data-open-url="${safe(raw)}">${safe(shortDisplayUrl(raw, 130))}</a></div>`;
        }
        return `<a class="message-link" href="#" data-open-url="${safe(raw)}" title="${safe(raw)}">${safe(shortDisplayUrl(raw))}</a>`;
      });
  }

  function renderDiscordText(value, context) {
    const source = String(value || '');
    const tokenPattern = /<(a?):([A-Za-z0-9_~]+):(\d+)>|<#(\d+)>|<@!?(\d+)>|<@&(\d+)>|<\/([^:>]+):(\d+)>/g;
    const channels = new Map((currentManagement?.channels || []).map((channel) => [String(channel.id), channel]));
    const roles = new Map((currentManagement?.roles || []).map((role) => [String(role.id), role]));
    const mentionedUsers = new Map(
      (Array.isArray(context?.mentions) ? context.mentions : Array.isArray(context) ? context : [])
        .filter((item) => item && item.id)
        .map((member) => [String(member.id), member])
    );
    const managementMembers = new Map(
      (Array.isArray(currentManagement?.members) ? currentManagement.members : [])
        .filter((item) => item && (item.id || item.userId))
        .map((member) => [String(member.id || member.userId), member])
    );
    let output = '';
    let cursor = 0;
    let match;
    while ((match = tokenPattern.exec(source))) {
      output += renderDiscordPlainText(source.slice(cursor, match.index));
      if (match[3]) {
        const extension = match[1] === 'a' ? 'gif' : 'webp';
        output += `<img class="discord-custom-emoji" src="https://cdn.discordapp.com/emojis/${safe(match[3])}.${extension}?size=64&amp;quality=lossless" alt=":${safe(match[2])}:" title=":${safe(match[2])}:" loading="lazy">`;
      } else if (match[4]) {
        output += `<span class="discord-mention channel">#${safe(channels.get(String(match[4]))?.name || 'kanal')}</span>`;
      } else if (match[5]) {
        const mentionData = mentionedUsers.get(String(match[5])) || managementMembers.get(String(match[5]));
        const displayName = mentionData?.displayName || mentionData?.username || mentionData?.globalName || '';
        output += `<span class="discord-mention user">@${safe(displayName || 'Mitglied')}</span>`;
      } else if (match[6]) {
        output += `<span class="discord-mention role">@${safe(roles.get(String(match[6]))?.name || 'Rolle')}</span>`;
      } else if (match[7]) {
        output += `<span class="discord-command">/${safe(match[7])}</span>`;
      }
      cursor = tokenPattern.lastIndex;
    }
    output += renderDiscordPlainText(source.slice(cursor));
    return output;
  }

  function welcomeTemplateFromMessage(message) {
    const primaryMention = Array.isArray(message?.mentions) ? message.mentions[0] : null;
    const dynamicText = (value) => {
      let output = String(value || '');
      if (primaryMention?.id) output = output.replace(new RegExp('<@!?' + String(primaryMention.id).replace(/[^0-9]/g, '') + '>', 'g'), '{user}');
      const names = [primaryMention?.displayName, primaryMention?.username]
        .map((entry) => String(entry || '').trim()).filter((entry) => entry.length >= 2)
        .sort((left, right) => right.length - left.length);
      names.forEach((name) => { output = output.split(name).join('{nickname}'); });
      return output;
    };
    const outsideImage = firstImageAttachmentUrl(message?.attachments || []);
    const embeds = (message?.embeds || []).slice(0, 10).map((embed) => ({
      title: dynamicText(embed.title),
      url: embed.url || '',
      description: dynamicText(embed.description),
      color: embed.color || '#58b9ff',
      authorName: dynamicText(embed.author),
      authorIconUrl: embed.authorIcon || '',
      thumbnailUrl: embed.thumbnail || '',
      imageUrl: embed.image || '',
      footerText: dynamicText(embed.footer),
      footerIconUrl: embed.footerIcon || '',
      timestamp: Boolean(embed.timestamp),
      fields: (embed.fields || []).slice(0, 25).map((field) => ({
        name: dynamicText(field.name),
        value: dynamicText(field.value),
        inline: field.inline === true
      }))
    }));
    return {
      content: dynamicText(message?.content),
      outsideImageUrl: outsideImage,
      embeds,
      sourceChannelId: String(selectedChannelId || ''),
      sourceMessageId: String(message?.id || '')
    };
  }

  async function useMessageAsWelcome(message, button) {
    if (!message || !guildId()) return;
    if (!String(message.content || '').trim() && !(message.embeds || []).length && !(message.attachments || []).length) {
      notify('Diese Nachricht besitzt keinen kopierbaren Inhalt.', 'error');
      return;
    }
    const accepted = typeof window.fallenHeavenConfirm === 'function'
      ? await window.fallenHeavenConfirm({
        tone: 'primary',
        eyebrow: 'WELCOME-VORLAGE',
        title: 'Nachricht als Begrüßung übernehmen?',
        message: 'Text, Embeds, Bilder und Felder werden in das Welcome/Farewell-Modul kopiert. Die Discord-Nachricht selbst bleibt unverändert.',
        note: 'Die erste erwähnte Person und ihr Anzeigename werden automatisch in dynamische Mitglieder-Platzhalter umgewandelt.',
      metrics: [
          { label: 'Embeds', value: (message.embeds || []).length },
          { label: 'Bilder', value: (message.attachments || []).filter((item) => isImageAttachment(item)).length + (message.embeds || []).filter((embed) => embed.image).length }
        ],
        cancelLabel: 'Abbrechen',
        confirmLabel: 'Als Willkommen verwenden'
      })
      : false;
    if (!accepted) return;
    if (button) { button.disabled = true; button.textContent = 'Wird übernommen …'; }
    try {
      const response = await request(`/api/config/${encodeURIComponent(guildId())}`, {
        method: 'PUT',
        body: { welcomeFarewell: { welcomeTemplate: welcomeTemplateFromMessage(message) } }
      });
      if (typeof window.fallenHeavenApplyConfig === 'function') window.fallenHeavenApplyConfig(response.config);
      notify('Die Nachricht wurde als Willkommensvorlage gespeichert.', 'success');
    } catch (error) {
      notify(error?.message || 'Die Willkommensvorlage konnte nicht gespeichert werden.', 'error');
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Als Willkommen'; }
    }
  }

  async function request(path, options = {}) {
    const timeoutMs = Math.max(3000, Number(options.timeoutMs || 15000));
    const attempts = Math.max(1, Number(options.attempts || 4));
    let response;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      let timeout;
      response = await Promise.race([
        api.apiRequest({ path, method: options.method || 'GET', body: options.body, timeoutMs }),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Discord antwortet momentan zu langsam. Bitte erneut laden.')), timeoutMs);
        })
      ]).finally(() => clearTimeout(timeout));
      if (![0, 429, 502, 503, 504].includes(Number(response?.status || 0))) break;
      if (attempt + 1 < attempts) {
        const delay = Math.max(300, Math.min(1600, Number(response?.data?.retryAfterMs || 350 * (attempt + 1))));
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    if (!response?.ok) throw new Error(fail(response, 'Discord-Daten konnten nicht geladen werden.'));
    return response.data;
  }

  let managementRequestId = 0;

  function renderManagementProblem(message) {
    const detail = String(message || 'Discord-Daten konnten nicht geladen werden.');
    ['#community-events', '#community-channels', '#community-roles'].forEach((selector) => {
      const target = $(selector);
      if (!target) return;
      target.innerHTML = '';
      const empty = document.createElement('p');
      empty.className = 'community-empty';
      empty.textContent = detail;
      target.appendChild(empty);
    });
  }

  function showTab(name) {
    activeTab = name;
    $$('.community-tab').forEach((button) => button.classList.toggle('active', button.dataset.communityTab === name));
    $$('.community-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.communityPanel === name));
    if (name === 'members') {
      hasRenderedMembers = false;
      void loadMembers($('#member-search')?.value || '');
      if (selectedMember) scheduleMemberAnalysisPoll(selectedMember.id, selectedMember.intelligence?.analysis || {});
    } else {
      clearTimeout(memberAnalysisPollTimer);
      memberAnalysisPollTimer = null;
      if (currentManagement) scheduleActivePanelRender(currentManagement);
      if (name === 'system-events') void loadSystemEvents();
      if (name === 'backups') void loadServerBackups();
      if (name === 'vip') void loadVipEconomy();
    }
  }

  const coinNumber = (value) => Number(value || 0).toLocaleString('de-DE');

  function renderVipEconomy(data) {
    vipEconomy = data || {};
    const summary = vipEconomy.summary || {};
    const rows = Array.isArray(vipEconomy.rows) ? vipEconomy.rows : [];
    const tiers = Array.isArray(vipEconomy.tiers) ? vipEconomy.tiers : [];
    const coin = vipEconomy.coinEmoji || '🪙';
    const reconciliation = vipEconomy.reconciliation || {};
    const consistencyState = String(summary.boostConsistencyState || 'unknown');
    const consistencyLabel = consistencyState === 'synchronized' ? 'Synchron' : consistencyState === 'discord-pending' ? 'Discord aktualisiert' : consistencyState === 'mismatch' ? 'Pausiert' : 'Wird geprüft';
    $('#vip-count').textContent = String(summary.vipMembers || 0);
    $('#vip-account-count').textContent = String(vipEconomy.pagination?.total ?? rows.length);
    $('#vip-summary').innerHTML = [
      ['VIP-MITGLIEDER', summary.vipMembers || 0, `${summary.members || 0} Mitglieder`],
      ['COINS IM UMLAUF', `${coin} ${coinNumber(summary.totalBalance)}`, `${summary.accounts || 0} Konten`],
      ['AKTIVE BOOSTER', summary.activeBoosters || 0, `${summary.discordBoostCount || 0} Discord-Boosts`],
      ['BOOST-ABGLEICH', consistencyLabel, `${summary.pendingBoostMilestones || 0} offene Meilensteine`],
      ['TRANSAKTIONEN', summary.transactions || 0, 'Audit aktueller Mitglieder']
    ].map(([label, value, detail]) => `<article><span>${safe(label)}</span><strong>${safe(value)}</strong><small>${safe(detail)}</small></article>`).join('');
    const reconcileButton = $('#vip-reconcile');
    if (reconcileButton && !reconcileButton.disabled) {
      reconcileButton.title = reconciliation.finishedAt
        ? `Letzter Abgleich: ${date(reconciliation.finishedAt)} · ${reconciliation.creditedCoins || 0} Coins nachgetragen`
        : 'Prüft alle aktiven Booster und trägt ausschließlich eindeutig fehlende Meilensteine nach.';
    }

    const picker = $('#vip-member-select');
    const pickerValue = picker?.value || selectedVipAccountId;
    if (picker) {
      picker.innerHTML = `<option value="">Mitglied auswählen ...</option>${(vipEconomy.memberOptions || []).map((member) => `<option value="${safe(member.id)}">${safe(member.displayName)} · @${safe(member.username)}</option>`).join('')}`;
      if ([...picker.options].some((option) => option.value === pickerValue)) picker.value = pickerValue;
    }

    const list = $('#vip-account-list');
    if (list) list.innerHTML = rows.length ? rows.map((row) => `<button type="button" class="vip-account-row${selectedVipAccountId === row.id ? ' active' : ''}" data-vip-account="${safe(row.id)}"><img src="${safe(avatarSource(row))}" alt=""><span><b>${safe(row.displayName)}</b><small>@${safe(row.username || row.id)}${row.onServer ? '' : ' · nicht mehr auf dem Server'}</small></span><em>${safe(coin)} ${safe(coinNumber(row.account?.balance))}</em><strong>${safe(row.vip?.name || 'Kein VIP')}</strong></button>`).join('') : '<p class="community-empty">Keine passenden Konten gefunden.</p>';

    const transactions = Array.isArray(vipEconomy.transactions) ? vipEconomy.transactions : [];
    const ledger = $('#vip-ledger-list');
    if (ledger) ledger.innerHTML = transactions.length ? transactions.map((entry) => `<article><span><b>${safe(entry.subject?.displayName || entry.userId || 'Unbekannt')}</b><small>${safe(entry.type || 'Änderung')} · ${safe(date(entry.createdAt))}</small></span><strong class="${Number(entry.amount || 0) < 0 ? 'negative' : ''}">${Number(entry.amount || 0) > 0 ? '+' : ''}${safe(coinNumber(entry.amount || 0))}</strong><p>${safe(entry.reason || entry.note || 'Systemtransaktion')}</p></article>`).join('') : '<p class="community-empty">Noch keine Transaktionen vorhanden.</p>';

    if (selectedVipAccountId) {
      const selected = rows.find((row) => row.id === selectedVipAccountId);
      if (selected) renderVipAccountDetail(selected, tiers, coin);
      else if ($('#vip-account-detail')) $('#vip-account-detail').innerHTML = '<p class="community-empty">Das ausgewählte Konto liegt außerhalb des aktuellen Filters.</p>';
    }
  }

  function renderVipAccountDetail(row, tiers, coin) {
    selectedVipAccountId = row.id;
    const account = row.account || {};
    const rewarded = Array.isArray(account.rewardedBoostLevels) ? account.rewardedBoostLevels.join(', ') : '';
    const pendingLevels = Array.isArray(row.boostMilestones?.pendingLevels) ? row.boostMilestones.pendingLevels : [];
    const boostHealth = row.boostMilestones?.automaticCreditPaused
      ? '<div class="vip-boost-health paused"><b>Automatische Vergütung pausiert</b><span>Die Discord-Gesamtsumme und die persönlichen Belege widersprechen sich. Es werden keine Coins geraten oder verteilt.</span></div>'
      : pendingLevels.length
        ? `<div class="vip-boost-health pending"><b>${safe(pendingLevels.length)} bestätigte Meilenstein${pendingLevels.length === 1 ? '' : 'e'} offen</b><span>Stufen ${safe(pendingLevels.join(', '))} · ${safe(coinNumber(row.boostMilestones.pendingCoins || 0))} Coins werden beim Abgleich nachgetragen.</span></div>`
        : '<div class="vip-boost-health healthy"><b>Boost-Konto vollständig</b><span>Alle aktuell belegten Meilensteine sind bereits einmalig vergütet.</span></div>';
    $('#vip-account-detail').innerHTML = `<div class="vip-detail-head"><img src="${safe(avatarSource(row))}" alt=""><span><p class="eyebrow">VIP-KONTO</p><h3>${safe(row.displayName)}</h3><small>@${safe(row.username || row.id)} · ${row.onServer ? 'auf dem Server' : 'nicht mehr auf dem Server'}</small></span></div>${boostHealth}<form id="vip-account-form" data-vip-user="${safe(row.id)}" data-vip-revision="${safe(account.revision || 0)}"><label>Heaven Coins<input name="balance" type="number" min="0" max="10000000" value="${safe(account.balance || 0)}"></label><label>Persönlicher Boost-Rekord<input name="boostRecord" type="number" min="0" max="99" value="${safe(account.boostRecord || 0)}"></label><label>Bereits vergütete Boost-Stufen<input name="rewardedBoostLevels" value="${safe(rewarded)}" placeholder="1, 2, 3"></label><label>Aktive VIP-Rolle<select name="vipRoleId" ${row.onServer ? '' : 'disabled'}><option value="">Keine VIP-Rolle</option>${tiers.map((tier) => `<option value="${safe(tier.roleId)}" ${row.vip?.roleId === tier.roleId ? 'selected' : ''}>${safe(tier.name)} · ${safe(coinNumber(tier.price))} Coins</option>`).join('')}</select></label><label class="vip-reason">Nachvollziehbarer Änderungsgrund<textarea name="reason" minlength="3" maxlength="300" required placeholder="Warum wird dieses Konto geändert?"></textarea></label><div class="vip-account-facts"><span>Verdient <b>${safe(coin)} ${safe(coinNumber(account.earned))}</b></span><span>Ausgegeben <b>${safe(coin)} ${safe(coinNumber(account.spent))}</b></span><span>Aktiv <b>${safe(row.activeBoostCount || 0)} Boosts</b></span><span>Vergütet <b>${safe((account.rewardedBoostLevels || []).length)} Stufen</b></span></div><button class="button primary" type="submit">Änderung prüfen</button></form>`;
    $$('#vip-account-list [data-vip-account]').forEach((button) => button.classList.toggle('active', button.dataset.vipAccount === row.id));
  }

  async function loadVipEconomy(forceSync = false) {
    const id = guildId();
    if (!id) return;
    const query = encodeURIComponent($('#vip-search')?.value || '');
    const filter = encodeURIComponent($('#vip-filter')?.value || 'all');
    try {
      const data = await request(`/api/guild/${encodeURIComponent(id)}/heaven-economy?query=${query}&filter=${filter}&pageSize=100${forceSync ? '&sync=1' : ''}`, { timeoutMs: forceSync ? 60000 : 20000, attempts: 2 });
      renderVipEconomy(data.economy || {});
    } catch (error) {
      $('#vip-account-list').innerHTML = `<p class="community-empty">${safe(error.message)}</p>`;
      notify(error.message || 'VIP- und Coin-Daten konnten nicht geladen werden.', 'error');
    }
  }

  async function reconcileVipEconomy() {
    const button = $('#vip-reconcile');
    if (button) { button.disabled = true; button.textContent = 'Boosts werden geprüft ...'; }
    try {
      const response = await request(`/api/guild/${encodeURIComponent(guildId())}/heaven-economy/reconcile`, { method: 'POST', body: {}, timeoutMs: 120000, attempts: 1 });
      const result = response.result || {};
      if (result.status === 'paused') notify(result.message || 'Der Coin-Abgleich wurde aus Sicherheitsgründen pausiert.', 'info');
      else notify(`${coinNumber(result.checkedAccounts || 0)} Booster geprüft · ${coinNumber(result.creditedCoins || 0)} Coins sicher nachgetragen.`, 'success');
      await loadVipEconomy();
    } catch (error) {
      notify(error.message || 'VIP- und Coin-Abgleich fehlgeschlagen.', 'error');
    } finally {
      if (button) { button.disabled = false; button.textContent = 'VIP & Coins abgleichen'; }
    }
  }

  function stageVipUpdate(form) {
    if (!form?.reportValidity()) return;
    const rewardedBoostLevels = String(form.elements.rewardedBoostLevels.value || '').split(/[;,\s]+/).map(Number).filter((value) => Number.isInteger(value) && value > 0);
    pendingVipUpdate = {
      userId: form.dataset.vipUser,
      expectedRevision: Number(form.dataset.vipRevision || 0),
      balance: Number(form.elements.balance.value || 0),
      boostRecord: Number(form.elements.boostRecord.value || 0),
      rewardedBoostLevels,
      vipRoleId: String(form.elements.vipRoleId.value || ''),
      reason: String(form.elements.reason.value || '').trim()
    };
    const member = (vipEconomy?.rows || []).find((row) => row.id === pendingVipUpdate.userId);
    const role = (vipEconomy?.tiers || []).find((tier) => tier.roleId === pendingVipUpdate.vipRoleId);
    $('#vip-confirm-copy').innerHTML = `<strong>${safe(member?.displayName || pendingVipUpdate.userId)}</strong><br>${safe(coinNumber(pendingVipUpdate.balance))} Coins · Boost-Rekord ${safe(pendingVipUpdate.boostRecord)} · ${safe(role?.name || 'keine VIP-Rolle')}<br><small>Grund: ${safe(pendingVipUpdate.reason)}</small>`;
    $('#vip-confirm-dialog')?.showModal();
  }

  async function applyVipUpdate() {
    if (!pendingVipUpdate) return;
    const button = $('[data-vip-confirm-apply]');
    if (button) { button.disabled = true; button.textContent = 'Wird gespeichert ...'; }
    try {
      await request(`/api/guild/${encodeURIComponent(guildId())}/heaven-economy/account`, { method: 'PATCH', body: pendingVipUpdate, timeoutMs: 60000, attempts: 1 });
      $('#vip-confirm-dialog')?.close();
      pendingVipUpdate = null;
      notify('VIP-Konto wurde sicher aktualisiert.', 'success');
      await loadVipEconomy(true);
    } catch (error) {
      notify(error.message || 'VIP-Konto konnte nicht gespeichert werden.', 'error');
      if (/inzwischen geändert/i.test(error.message || '')) await loadVipEconomy(true);
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Änderung speichern'; }
    }
  }

  function setBackupBusy(isBusy) {
    ['#backup-create', '#backup-refresh'].forEach((selector) => {
      const button = $(selector);
      if (button) button.disabled = Boolean(isBusy);
    });
  }

  function renderServerBackups(backups) {
    const rows = Array.isArray(backups) ? backups : [];
    const list = $('#backup-list');
    const count = $('#backups-count');
    const health = $('#backup-health');
    const summary = $('#backup-summary');
    if (count) count.textContent = String(rows.length);
    if (health) health.textContent = rows.length ? 'Geschützt' : 'Noch ungesichert';
    if (summary) summary.textContent = rows.length
      ? `${rows.length} lokale Sicherung${rows.length === 1 ? '' : 'en'} verfügbar`
      : 'Noch kein Server-Backup vorhanden';
    if (!list) return;
    if (!rows.length) {
      list.innerHTML = '<p class="community-empty">Erstelle jetzt das erste sichere Struktur-Backup.</p>';
      return;
    }
    list.innerHTML = rows.slice(0, 30).map((backup) => {
      const stats = backup.stats || {};
      return `<article class="backup-row"><div><small>${safe(date(backup.createdAt || backup.updatedAt))}</small><h3>${safe(backup.guildName || 'Server-Backup')}</h3><p>${safe(stats.channelCount || 0)} Kanäle · ${safe(stats.roleCount || 0)} Rollen · ${safe(stats.emojiCount || 0)} Emojis · ${safe(stats.stickerCount || 0)} Sticker</p></div><button class="button secondary" type="button" data-backup-preview="${safe(backup.id)}">Vorschau & Restore</button></article>`;
    }).join('');
  }

  async function loadServerBackups() {
    const id = guildId();
    if (!id) return;
    setBackupBusy(true);
    const list = $('#backup-list');
    if (list) list.innerHTML = '<p class="community-empty">Backups werden geladen ...</p>';
    try {
      const data = await request(`/api/guild/${encodeURIComponent(id)}/server-backups`, { attempts: 2 });
      renderServerBackups(data.backups || []);
    } catch (error) {
      if (list) list.innerHTML = `<p class="community-empty">${safe(error.message)}</p>`;
      notify(error.message || 'Backups konnten nicht geladen werden.', 'error');
    } finally {
      setBackupBusy(false);
    }
  }

  async function createServerBackup() {
    const id = guildId();
    if (!id) return;
    setBackupBusy(true);
    try {
      const data = await request(`/api/guild/${encodeURIComponent(id)}/server-backups`, { method: 'POST', body: {}, timeoutMs: 60000, attempts: 1 });
      const stats = data.result?.stats || {};
      notify(`Backup gespeichert: ${stats.channelCount || 0} Kanäle und ${stats.roleCount || 0} Rollen.`, 'success');
      await loadServerBackups();
    } catch (error) {
      notify(error.message || 'Backup konnte nicht erstellt werden.', 'error');
    } finally {
      setBackupBusy(false);
    }
  }

  async function previewServerRestore(backupId) {
    const id = guildId();
    const dialog = $('#backup-restore-dialog');
    if (!id || !backupId || !dialog) return;
    try {
      const data = await request(`/api/guild/${encodeURIComponent(id)}/server-backups/${encodeURIComponent(backupId)}/preview-restore`, { method: 'POST', body: {}, timeoutMs: 30000, attempts: 1 });
      const preview = data.result || {};
      const missing = preview.missing || {};
      pendingBackupRestore = { backupId, preview };
      $('#backup-restore-preview').innerHTML = `<div class="backup-preview-grid"><article><span>Kanäle</span><strong>${safe(missing.channels || 0)}</strong><small>fehlen aktuell</small></article><article><span>Rollen</span><strong>${safe(missing.roles || 0)}</strong><small>fehlen aktuell</small></article><article><span>Emojis</span><strong>${safe(missing.emojis || 0)}</strong><small>fehlen aktuell</small></article><article><span>Sticker</span><strong>${safe(missing.stickers || 0)}</strong><small>fehlen aktuell</small></article></div><p>Stand: ${safe(date(preview.createdAt))}. Chat-Inhalte sind nicht enthalten. Zusätzliche aktuelle Kanäle und Rollen bleiben bestehen.</p>`;
      const ack = $('#backup-restore-ack');
      const confirm = $('#backup-restore-confirm');
      if (ack) ack.checked = false;
      if (confirm) confirm.disabled = true;
      dialog.showModal();
    } catch (error) {
      notify(error.message || 'Restore-Vorschau konnte nicht erstellt werden.', 'error');
    }
  }

  async function restoreServerBackup() {
    const id = guildId();
    const dialog = $('#backup-restore-dialog');
    const confirm = $('#backup-restore-confirm');
    if (!id || !pendingBackupRestore || !$('#backup-restore-ack')?.checked) return;
    if (confirm) { confirm.disabled = true; confirm.textContent = 'Restore läuft ...'; }
    const form = dialog?.querySelector('form');
    const enabled = (name) => Boolean(form?.elements?.[name]?.checked);
    try {
      const data = await request(`/api/guild/${encodeURIComponent(id)}/server-backups/${encodeURIComponent(pendingBackupRestore.backupId)}/restore`, {
        method: 'POST',
        timeoutMs: 120000,
        attempts: 1,
        body: { confirm: true, options: { restoreServerSettings: enabled('restoreServerSettings'), restoreRoles: enabled('restoreRoles'), restoreChannels: enabled('restoreChannels'), restoreEmojis: enabled('restoreEmojis'), restoreStickers: enabled('restoreStickers') } }
      });
      const result = data.result || {};
      dialog?.close();
      pendingBackupRestore = null;
      notify(`Restore abgeschlossen: ${result.errors?.length || 0} Fehler, ${result.warnings?.length || 0} Hinweise.`, result.errors?.length ? 'error' : 'success');
      cache.delete(id);
      await loadManagement(true);
      await loadServerBackups();
    } catch (error) {
      notify(error.message || 'Backup konnte nicht wiederhergestellt werden.', 'error');
    } finally {
      if (confirm) { confirm.textContent = 'Ausgewählte Bereiche wiederherstellen'; confirm.disabled = !$('#backup-restore-ack')?.checked; }
    }
  }

  function metric(label, value, detail) {
    return `<article class="community-metric"><span>${safe(label)}</span><strong>${safe(value)}</strong><small>${safe(detail)}</small></article>`;
  }

  function renderMetrics(data) {
    const guild = data?.guild || {};
    const channels = Array.isArray(data?.channels) ? data.channels : [];
    const roles = Array.isArray(data?.roles) ? data.roles : [];
    const events = Array.isArray(data?.events) ? data.events : [];
    $('#community-metrics').innerHTML = [
      metric('Mitglieder', guild.memberCount || 0, `${guild.onlineCount || 0} derzeit online`),
      metric('Kanäle', guild.channelCount || channels.length, `${channels.filter((item) => item?.isCategory).length} Kategorien`),
      metric('Rollen', guild.roleCount || roles.length, `${roles.filter((item) => item?.managed).length} verwaltet`),
      metric('Events', guild.eventCount || events.length, `${events.filter((item) => item?.status === 2).length} gerade aktiv`),
      metric('Boosts', guild.boostCount || 0, `Server-Tier ${guild.premiumTier || 0}`)
    ].join('');
    $('#events-count').textContent = guild.eventCount || 0;
    $('#channels-count').textContent = guild.channelCount || 0;
    $('#members-count').textContent = guild.memberCount || 0;
    $('#boosts-count').textContent = guild.boostCount || 0;
    $('#system-events-count').textContent = data.systemEvents?.summary?.total || 0;
  }

  function renderEvents(events) {
    const target = $('#community-events');
    if (!events.length) {
      target.innerHTML = '<p class="community-empty">Aktuell sind keine Server-Events geplant.</p>';
      return;
    }
    const status = { 1: 'Geplant', 2: 'Live', 3: 'Beendet', 4: 'Abgesagt' };
    target.innerHTML = events.map((event) => `<article class="event-card"><div class="event-card-top"><span class="privacy-chip">${safe(status[event.status] || 'Event')}</span><button class="event-open" data-open-url="${safe(event.url)}">In Discord öffnen ↗</button></div><h3>${safe(event.name)}</h3><p>${safe(event.description || event.location || 'Keine Beschreibung hinterlegt.')}</p><div class="event-meta"><span>${safe(date(event.scheduledStartAt))}</span><span>${safe(event.location || (event.channelId ? 'Discord-Kanal' : 'Server-Event'))}</span><span>${safe(event.userCount || 0)} interessiert</span></div></article>`).join('');
  }

  function renderSystemEvents(feed = {}) {
    const events = Array.isArray(feed.events) ? feed.events : [];
    const summary = feed.summary || {};
    const scan = feed.scan || {};
    const eventWindow = feed.window || {};
    const pagination = feed.pagination || {};
    const serverPaged = Number.isFinite(Number(pagination.page)) && Number.isFinite(Number(pagination.pageSize));
    const summaryTarget = $('#system-event-summary');
    const categories = summary.categories || {};
    if (summaryTarget) summaryTarget.innerHTML = [
      metric('Erfasst', eventWindow.truncated ? `${summary.total || events.length}+` : summary.total || 0, eventWindow.truncated ? `Neueste ${events.length.toLocaleString('de-DE')} Systemereignisse geladen` : scan.complete ? 'Gesamte verfügbare Historie indexiert' : `${Number(scan.scannedMessages || 0).toLocaleString('de-DE')} Nachrichten geprüft`),
      metric('Mitgliedschaft', categories.membership || 0, 'Beitritte und Mitgliedschaftsereignisse'),
      metric('Boosts', categories.boosts || 0, 'Boosts, Level und bestätigte Signale'),
      metric('Server & Kanäle', Number(categories.channel || 0) + Number(categories.stage || 0), 'Kanäle, Threads, Pins und Stage'),
      metric('Sicherheit & Abos', Number(categories.safety || 0) + Number(categories.subscriptions || 0), 'AutoMod, Incidents, Käufe und Abos')
    ].join('');

    const progressTarget = $('#system-event-progress');
    if (progressTarget) {
      const totalChannels = Math.max(0, Number(scan.totalChannels || 0));
      const completedChannels = Math.max(0, Number(scan.completedChannels || 0));
      const reportedProgress = Number(scan.progress);
      const channelProgress = totalChannels ? (completedChannels / totalChannels) * 100 : 0;
      const progress = scan.complete
        ? 100
        : Math.min(99.9, Math.max(
          scan.running ? 0.1 : 0,
          Number.isFinite(reportedProgress) ? reportedProgress : 0,
          channelProgress
        ));
      progressTarget.classList.toggle('complete', Boolean(scan.complete));
      progressTarget.innerHTML = `<div class="system-event-progress-head"><div><span>GESAMTFORTSCHRITT</span><strong>Discord-Systemhistorie</strong></div><b>${progress < 1 && progress > 0 ? '&lt;1' : Math.round(progress)}%</b></div><i><span style="width:${progress}%"></span></i><div class="system-event-progress-meta"><span><b>${Number(scan.scannedMessages || 0).toLocaleString('de-DE')}</b> Nachrichten geprüft</span><span><b>${Number(scan.foundEvents || summary.total || 0).toLocaleString('de-DE')}</b> Ereignisse erkannt</span><span><b>${completedChannels.toLocaleString('de-DE')} / ${totalChannels.toLocaleString('de-DE')}</b> Kanäle abgeschlossen</span></div>`;
    }

    const historyBadge = document.querySelector('#community-system-events-panel .privacy-chip');
    if (historyBadge) historyBadge.textContent = eventWindow.truncated
      ? `LETZTE ${Number(eventWindow.returned || events.length).toLocaleString('de-DE')} · INDEX LOKAL`
      : scan.complete
      ? 'GESAMTE HISTORIE · LOKAL'
      : scan.running
        ? `HISTORIE WIRD INDEXIERT · ${Number(scan.foundEvents || summary.total || 0).toLocaleString('de-DE')} GEFUNDEN`
        : 'HISTORIE UNVOLLSTÄNDIG · LOKAL';

    const renderFiltered = () => {
      const target = $('#system-event-feed');
      if (!target) return;
      const selected = serverPaged
        ? events
        : systemEventFilter === 'all'
          ? events
          : events.filter((entry) => String(entry.metadata?.category || 'other') === systemEventFilter);
      const selectedTotal = serverPaged ? Math.max(0, Number(pagination.total || 0)) : selected.length;
      const pageCount = serverPaged
        ? Math.max(1, Number(pagination.pageCount || 1))
        : Math.max(1, Math.ceil(selected.length / systemEventPageSize));
      systemEventPage = serverPaged
        ? Math.min(pageCount - 1, Math.max(0, Number(pagination.page || 0)))
        : Math.min(pageCount - 1, Math.max(0, systemEventPage));
      if (serverPaged) systemEventPageSize = Math.min(100, Math.max(10, Number(pagination.pageSize || 25)));
      const pageStart = serverPaged ? 0 : systemEventPage * systemEventPageSize;
      const visible = serverPaged ? selected : selected.slice(pageStart, pageStart + systemEventPageSize);
      const labels = { boost_started: 'Boost aktiv', boost_ended: 'Boost beendet', member_joined: 'Beigetreten', member_left: 'Verlassen' };

      target.innerHTML = selected.length ? `<div class="system-event-table"><div class="system-event-table-head"><span>Mitglied</span><span>Ereignis</span><span>Kanal</span><span>Zeitpunkt</span><span></span></div>${visible.map((entry) => {
        const member = entry.member || {};
        const displayName = member.displayName || member.globalName || member.username || entry.userName || (entry.userId ? `Mitglied ${entry.userId}` : 'Discord System');
        const secondaryName = member.username ? `@${member.username}` : member.globalName && member.globalName !== displayName ? member.globalName : 'Discord-Mitglied';
        const avatar = member.avatar || member.avatarUrl
          ? `<img src="${safe(avatarSource(member))}" alt="Avatar von ${safe(displayName)}" loading="lazy">`
          : `<span class="system-event-avatar-fallback">${safe(String(displayName).slice(0, 1).toUpperCase() || '?')}</span>`;
        const boostCount = entry.type === 'boost_started' ? Math.max(1, Number(entry.metadata?.boostCount || 1)) : 0;
        const eventText = entry.nativeText || entry.displayText || entry.text || 'Systemereignis';
        return `<article class="system-event-row ${safe(entry.metadata?.category || 'other')} ${safe(entry.type)}"><div class="system-event-identity">${avatar}<span><strong>${safe(displayName)}</strong><small>${safe(secondaryName)} · ${safe(entry.userId || 'System')}</small></span></div><div class="system-event-description"><b>${safe(eventText)}</b><small>${safe(entry.metadata?.label || labels[entry.type] || 'Discord-Systemnachricht')}</small></div><span class="system-event-channel">#${safe(entry.channelName || entry.channelId || 'Server')}</span><time>${safe(date(entry.ts || entry.createdAt))}</time>${entry.userId ? `<button type="button" class="system-event-open" data-system-member="${safe(entry.userId)}">Details ›</button>` : '<span></span>'}</article>`;
      }).join('')}</div><footer class="system-events-pager" aria-label="Seitennavigation der Systemereignisse"><span class="system-events-page-summary">Seite ${systemEventPage + 1} von ${pageCount} · ${selectedTotal.toLocaleString('de-DE')} Ereignisse</span><div class="system-events-page-controls"><label>Pro Seite<select data-system-event-page-size><option value="25" ${systemEventPageSize === 25 ? 'selected' : ''}>25</option><option value="50" ${systemEventPageSize === 50 ? 'selected' : ''}>50</option><option value="100" ${systemEventPageSize === 100 ? 'selected' : ''}>100</option></select></label><div class="system-events-page-actions"><button type="button" data-system-event-page="first" aria-label="Erste Seite" ${systemEventPage <= 0 ? 'disabled' : ''}>«</button><button type="button" data-system-event-page="previous" aria-label="Vorherige Seite" ${systemEventPage <= 0 ? 'disabled' : ''}>‹</button><span class="system-events-page-number">${systemEventPage + 1} / ${pageCount}</span><button type="button" data-system-event-page="next" aria-label="Nächste Seite" ${systemEventPage >= pageCount - 1 ? 'disabled' : ''}>›</button><button type="button" data-system-event-page="last" aria-label="Letzte Seite" ${systemEventPage >= pageCount - 1 ? 'disabled' : ''}>»</button></div></div></footer>` : '<p class="community-empty">Für diesen Filter wurden keine Systemereignisse erfasst.</p>';

      target.querySelectorAll('[data-system-event-page]').forEach((button) => button.addEventListener('click', () => {
        const action = button.dataset.systemEventPage;
        if (action === 'first') systemEventPage = 0;
        if (action === 'previous') systemEventPage = Math.max(0, systemEventPage - 1);
        if (action === 'next') systemEventPage = Math.min(pageCount - 1, systemEventPage + 1);
        if (action === 'last') systemEventPage = pageCount - 1;
        if (serverPaged) void loadSystemEvents();
        else renderFiltered();
      }));
      target.querySelector('[data-system-event-page-size]')?.addEventListener('change', (event) => {
        systemEventPageSize = Math.min(100, Math.max(10, Number(event.target.value || 25)));
        systemEventPage = 0;
        if (serverPaged) void loadSystemEvents();
        else renderFiltered();
      });
      target.querySelectorAll('[data-system-member]').forEach((button) => button.addEventListener('click', () => {
        showTab('members');
        loadMemberDetails(button.dataset.systemMember);
      }));
    };

    renderFiltered();
    $$('#system-event-filters [data-system-event-filter]').forEach((button) => {
      button.classList.toggle('active', button.dataset.systemEventFilter === systemEventFilter);
      button.onclick = () => {
        systemEventFilter = button.dataset.systemEventFilter || 'all';
        systemEventPage = 0;
        $$('#system-event-filters [data-system-event-filter]').forEach((item) => item.classList.toggle('active', item === button));
        if (serverPaged) void loadSystemEvents();
        else renderFiltered();
      };
    });
  }
  function channelSymbol(channel) {
    if (channel.isCategory) return '▾';
    if (channel.isForumLike) return channel.isMedia ? 'M' : 'F';
    if (channel.isThread) return '↳';
    if (channel.isVoice) return '◉';
    return '#';
  }

  function compareDiscordRows(left, right) {
    const leftDisplayOrder = Number(left?.displayOrder);
    const rightDisplayOrder = Number(right?.displayOrder);
    if (Number.isFinite(leftDisplayOrder) && Number.isFinite(rightDisplayOrder) && leftDisplayOrder !== rightDisplayOrder) {
      return leftDisplayOrder - rightDisplayOrder;
    }
    const leftPosition = Number(left?.rawPosition ?? left?.position ?? 0);
    const rightPosition = Number(right?.rawPosition ?? right?.position ?? 0);
    if (leftPosition !== rightPosition) return leftPosition - rightPosition;
    const leftId = String(left?.id || '');
    const rightId = String(right?.id || '');
    if (/^\d+$/.test(leftId) && /^\d+$/.test(rightId)) {
      const leftBig = BigInt(leftId);
      const rightBig = BigInt(rightId);
      if (leftBig !== rightBig) return leftBig < rightBig ? -1 : 1;
    } else if (leftId !== rightId) return leftId.localeCompare(rightId, 'en', { numeric: true });
    return String(left?.name || left?.id || '').localeCompare(String(right?.name || right?.id || ''), 'de', { numeric: true, sensitivity: 'base' });
  }

  function compareCategoryChildren(left, right) {
    return compareDiscordRows(left, right);
  }

  function discordChannelOptionGroups(channels) {
    const groups = [];
    const byKey = new Map();
    (channels || []).forEach((channel) => {
      const key = String(channel.categoryId || channel.parentId || 'root');
      if (!byKey.has(key)) {
        const group = {
          label: key === 'root' ? 'OHNE KATEGORIE' : String(channel.categoryName || 'KATEGORIE').toUpperCase(),
          channels: []
        };
        byKey.set(key, group);
        groups.push(group);
      }
      byKey.get(key).channels.push(channel);
    });
    return groups;
  }

  function renderStructure(data, query = '') {
    const needle = String(query || '').trim().toLowerCase();
    const allChannels = Array.isArray(data.channels) ? data.channels : [];
    const channels = allChannels.filter((channel = {}) => {
      const channelName = safeString(channel?.name, '');
      return !needle || channelName.toLowerCase().includes(needle);
    });
    const childrenByParent = new Map();
    allChannels
      .filter((channel = {}) => !channel.isCategory && channel.parentId)
      .sort(compareCategoryChildren)
      .forEach((channel) => {
        const key = String(channel.parentId || '');
        if (!childrenByParent.has(key)) childrenByParent.set(key, []);
        childrenByParent.get(key).push(channel);
      });
    const topLevelChannels = allChannels
      .filter((channel = {}) => channel.isCategory || !channel.parentId)
      .sort(compareDiscordRows);
    const rootChannels = topLevelChannels.filter((channel = {}) => !channel.isCategory && !channel.parentId);
    const categoryChannels = topLevelChannels.filter((channel = {}) => channel.isCategory);
    const rows = [];
    const channelButton = (channel) => {
      const currentChannel = channel || {};
      const canOpen = currentChannel.canOpen !== false && currentChannel.canRead && (currentChannel.isText || currentChannel.isThread || currentChannel.isForumLike);
      const label = currentChannel.isForumLike
        ? currentChannel.isMedia ? 'Media-Forum' : 'Forum'
        : currentChannel.isThread
          ? 'Thread'
          : currentChannel.isVoice
            ? 'Voice'
            : currentChannel.canRead
              ? 'Lesbar'
              : 'Gesperrt';
      return `<button class="channel-row${currentChannel.canRead ? '' : ' locked'}${currentChannel.isForumLike ? ' forum' : ''}" data-channel-id="${safe(currentChannel.id)}" ${canOpen ? '' : 'disabled'}><i>${channelSymbol(currentChannel)}</i><span>${safe(currentChannel.name)}</span><small>${safe(label)}</small></button>`;
    };
    const visibleRootChannels = rootChannels.filter((channel) => !needle || channels.some((entry) => entry.id === channel.id));
    if (visibleRootChannels.length) {
      visibleRootChannels.forEach((channel = {}) => rows.push(channelButton(channel)));
    }
    categoryChannels.forEach((entry) => {
      const categoryName = safeString(entry?.name, '');
      const categoryMatches = !needle || categoryName.toLowerCase().includes(needle);
      const children = (childrenByParent.get(String(entry?.id || '')) || [])
        .filter((channel = {}) => !needle || safeString(channel?.name, '').toLowerCase().includes(needle));
      if (!children.length && !categoryMatches) return;
      rows.push(`<div class="channel-category">${safe(categoryName)}</div>`);
      children.forEach((channel = {}) => rows.push(channelButton(channel)));
    });
    $('#community-channels').innerHTML = rows.join('') || '<p class="community-empty">Keine Kanäle gefunden.</p>';

    const roles = (Array.isArray(data.roles) ? data.roles : []).filter((role = {}) => !needle || safeString(role?.name, '').toLowerCase().includes(needle));
    $('#community-roles').innerHTML = roles.map((role = {}) => `<button type="button" class="role-row" data-role-id="${safe(role.id)}"><i style="background:${safe(role.color || '#8f93b8')}"></i><span><b>${safe(role.name)}</b><em>${role.managed ? 'Verwaltet' : role.mentionable ? 'Erwähnbar' : 'Eigene Rolle'}</em></span><small>${safe(role.memberCount || 0)} Mitglieder</small></button>`).join('') || '<p class="community-empty">Keine Rollen gefunden.</p>';
  }

  function mountChannelTopicEmojiControl(target) {
    const form = target?.querySelector('[data-channel-form]');
    const textarea = form?.elements?.topic;
    const label = textarea?.closest('label');
    if (!textarea || !label || label.querySelector('[data-channel-topic-emoji]')) return;
    label.classList.add('channel-topic-editor');
    const toolbar = document.createElement('span');
    toolbar.className = 'channel-topic-toolbar';
    toolbar.innerHTML = '<small>Bot- und Server-Emojis werden als gültige Discord-Mention eingefügt.</small><button type="button" data-channel-topic-emoji><svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"></circle><path d="M8.5 14.5c1.8 2 5.2 2 7 0M9 9.5h.01M15 9.5h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>Emoji auswählen</button>';
    label.appendChild(toolbar);
  }

  function channelWindowControls(start, end) {
    if (!channelRows.length) return { before: '', after: '' };
    const loadedPages = Math.max(1, Number(channelTotalPages || 1));
    const currentPage = Math.max(1, Math.min(loadedPages, Number(channelPage || 1)));
    const pageTokens = [];
    const visiblePages = new Set([1, loadedPages, currentPage - 1, currentPage, currentPage + 1]);
    let previousPage = 0;
    [...visiblePages]
      .filter((page) => page >= 1 && page <= loadedPages)
      .sort((left, right) => left - right)
      .forEach((page) => {
        if (previousPage && page - previousPage > 1) pageTokens.push('<span class="channel-page-gap" aria-hidden="true">…</span>');
        pageTokens.push(`<button type="button" class="channel-page-number${page === currentPage ? ' active' : ''}" data-channel-page="${page}" ${page === currentPage ? 'aria-current="page"' : ''}>${page.toLocaleString('de-DE')}</button>`);
        previousPage = page;
      });
    const canGoNewer = currentPage > 1;
    const canGoOlder = currentPage < loadedPages || channelHasMore;
    const nextAction = currentPage < loadedPages
      ? `data-channel-page="${currentPage + 1}"`
      : channelHasMore
        ? `data-channel-load-next-page="${safe(selectedChannelId)}"`
        : '';
    const indexState = channelStorage === 'server-index-pages'
      ? channelIndexComplete ? 'Index vollständig' : 'Index wird im Hintergrund ergänzt'
      : 'Discord-Liveverlauf';
    const pager = `<nav class="channel-pagination" aria-label="Nachrichtenseiten"><button type="button" class="channel-page-step" data-channel-page="${Math.max(1, currentPage - 1)}" ${canGoNewer ? '' : 'disabled'}><span aria-hidden="true">‹</span> Zurück</button><span class="channel-page-numbers">${pageTokens.join('')}</span><button type="button" class="channel-page-step" ${nextAction} ${canGoOlder ? '' : 'disabled'}>Weiter <span aria-hidden="true">›</span></button><small>Seite ${currentPage.toLocaleString('de-DE')} von ${loadedPages.toLocaleString('de-DE')}${channelHasMore ? '+' : ''} · ${Number(channelTotalMessages || channelRows.length).toLocaleString('de-DE')} Nachrichten · ${indexState}</small></nav>`;
    return { before: pager, after: pager };
  }

  function renderForumAdminCard() {
    if (!selectedChannelMeta) return '';
    const topicTemplate = selectedChannelMeta?.topic || '';
    const forumLabel = selectedChannelMeta?.isMedia ? 'Media-Forum' : 'Forum';
    const forumNote = `<section class="channel-counter-card full"><div class="channel-counter-head"><span><small>FORUM-STRUKTUR</small><b>Posts statt Textverlauf</b></span><span class="channel-counter-state">Discord-Forum</span></div><p>Dieser Bereich wird wie Discord gelesen: Forum auswählen, Post öffnen, danach erscheinen die Nachrichten im Thread. Dynamische Nachrichtenzähler bleiben normalen Textkanälen vorbehalten.</p></section>`;
    return selectedChannelMeta?.editable
      ? `<form class="channel-admin-card" data-channel-form="${safe(selectedChannelMeta.id)}"><div class="channel-admin-head"><span><small>${safe(forumLabel.toUpperCase())}-EINSTELLUNGEN</small><b>#${safe(selectedChannelMeta.name)}</b></span><em>LIVE MIT DISCORD</em></div><div class="channel-admin-grid"><label>Name<input name="name" maxlength="100" value="${safe(selectedChannelMeta.name)}"></label><label>Slowmode<select name="rateLimitPerUser">${[0,5,10,30,60,300,900,3600,21600].map((seconds) => `<option value="${seconds}" ${Number(selectedChannelMeta.rateLimitPerUser || 0) === seconds ? 'selected' : ''}>${seconds ? seconds < 60 ? `${seconds} Sekunden` : seconds < 3600 ? `${seconds / 60} Minuten` : `${seconds / 3600} Stunden` : 'Aus'}</option>`).join('')}</select></label><label class="full">Forum-Beschreibung<textarea name="topic" maxlength="1024" placeholder="Beschreibung für dieses Forum">${safe(topicTemplate)}</textarea></label>${forumNote}<label class="channel-nsfw"><input name="nsfw" type="checkbox" ${selectedChannelMeta.nsfw ? 'checked' : ''}><span>Als NSFW-Kanal markieren</span></label><button class="button primary" type="submit">Forum speichern</button></div></form>`
      : forumNote;
  }

  function renderForumPostBrowser() {
    const target = $('#channel-messages');
    if (!target) return;
    const posts = [...channelRows].sort(compareForumPosts);
    const forumLabel = selectedChannelMeta?.isMedia ? 'Media-Forum' : 'Forum';
      const postRows = posts.map((post) => {
        const image = (post.attachments || []).find((item) => isImageAttachment(item));
        const embed = (post.embeds || [])[0] || {};
        const preview = post.content || embed.description || embed.title || 'Dieser Forum-Post besitzt keine Textvorschau.';
      const tags = (post.tags || post.thread?.tags || []).slice(0, 4).map((tag) => `<span>${safe(tag.name || tag)}</span>`).join('');
      const messageCount = Number(post.thread?.messageCount || post.thread?.totalMessageSent || post.messageCount || 0);
      const replyCopy = messageCount ? `${messageCount.toLocaleString('de-DE')} Nachrichten` : 'Post öffnen';
      const pinned = forumPostPinned(post);
      const pinBadge = pinned ? '<span class="forum-post-pin"><i></i>Angepinnt</span>' : '';
      return `<button type="button" class="forum-post-card${pinned ? ' pinned' : ''}" data-forum-thread-id="${safe(post.id)}"><span class="forum-post-icon">${image ? `<img src="${safe(image.url)}" alt="" loading="lazy">` : '<i>FP</i>'}</span><span class="forum-post-copy"><small>${safe(forumLabel)} · ${safe(post.author?.displayName || 'Forum-Post')}${pinBadge}</small><b>${safe(post.thread?.name || post.name || post.content || 'Forum-Post')}</b><p>${renderDiscordText(String(preview).slice(0, 260), post)}</p>${tags ? `<em>${tags}</em>` : ''}</span><span class="forum-post-meta"><time>${safe(date(post.createdAt))}</time><strong>${safe(replyCopy)}</strong></span></button>`;
      }).join('');
    const older = channelHasMore
      ? `<div class="forum-load-actions"><button type="button" class="load-older forum-load-more" data-load-older="${safe(selectedChannelId)}">Ältere Forum-Posts laden</button><button type="button" class="load-older forum-load-all" data-load-all-forum-posts="${safe(selectedChannelId)}">Alle restlichen Posts laden</button></div>`
      : '<span class="history-start">Alle geladenen Forum-Posts erreicht</span>';
    target.innerHTML = `${renderForumAdminCard()}<section class="forum-post-browser"><header class="forum-post-head"><div><span>${safe(forumLabel.toUpperCase())}</span><h4>Forum-Posts</h4><p>Wie in Discord: erst den Post wählen, dann liest du die Nachrichten im Thread.</p></div><strong>${posts.length.toLocaleString('de-DE')}</strong></header><div class="forum-post-grid">${postRows || '<p class="community-empty">In diesem Forum wurden keine Posts gefunden.</p>'}</div>${older}</section>`;
    mountChannelTopicEmojiControl(target);
  }

  function renderChannelMessages() {
    const target = $('#channel-messages');
    const counter = selectedChannelMeta?.messageCounter || { enabled: false, template: '', preview: '', hasPlaceholder: false, lastError: '' };
    const topicTemplate = counter.template || selectedChannelMeta?.topic || '';
    const supportsCounter = selectedChannelMeta?.supportsMessageCounter !== false && !selectedChannelMeta?.isForumLike;
    const counterActive = supportsCounter && (counter.enabled || /\{chat\.count(?:\.[^}]+)?\}/i.test(topicTemplate));
    const nextCounterSync = counter.nextSyncAt ? new Date(counter.nextSyncAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
    const counterIntervalMinutes = Math.min(60, Math.max(5, Math.round(Number(counter.syncIntervalMinutes || (Number(counter.syncIntervalMs || 0) / 60000) || 10))));
    const counterIntervalOptions = [5, 10, 15, 30, 60].map((minutes) => `<option value="${minutes}" ${counterIntervalMinutes === minutes ? 'selected' : ''}>${minutes === 5 ? '5 Minuten · Schnell' : minutes === 10 ? '10 Minuten · empfohlen' : `${minutes} Minuten`}</option>`).join('');
    const counterIntervalText = counterIntervalMinutes === 5 ? 'alle 5 Minuten im Schnellmodus' : `alle ${counterIntervalMinutes} Minuten`;
    const counterStatus = counter.lastError
      ? `<span class="channel-counter-state error">${safe(counter.lastError)}</span>`
      : counter.syncPending
        ? `<span class="channel-counter-state live">Live gezählt · Discord-Sync${nextCounterSync ? ` ca. ${safe(nextCounterSync)}` : ' vorgemerkt'}</span>`
        : counterActive
          ? '<span class="channel-counter-state live">Live aktiv · synchron</span>'
          : '<span class="channel-counter-state">Nicht aktiv</span>';
    const variableChannels = discordChannelOptionGroups((currentManagement?.channels || [])
      .filter((item) => item.supportsMessageCounter !== false && item.isText && !item.isThread && !item.isForumLike))
      .map((group) => `<optgroup label="${safe(group.label)}">${group.channels.map((item) => `<option value="${safe(item.id)}">#${safe(item.name)}</option>`).join('')}</optgroup>`)
      .join('');
    const channelLabel = selectedChannelMeta?.isForumLike
      ? selectedChannelMeta.isMedia ? 'Media-Forum' : 'Forum'
      : selectedChannelMeta?.isThread ? 'Thread' : 'Textkanal';
    const counterSection = supportsCounter
      ? `<section class="channel-counter-card full"><div class="channel-counter-head"><span><small>DYNAMISCHES KANALTHEMA</small><b>Echte Nachrichtenzahl per Variable</b></span>${counterStatus}</div><p>Du gestaltest das Thema vollständig selbst. <strong>{chat.count}</strong> zählt diesen Kanal, <strong>{chat.count.#kanalname}</strong> bindet einen anderen Kanal ein. Die Zahl wird intern sofort erhöht; Discord bekommt das sichtbare Kanalthema gebündelt.</p><div class="channel-counter-controls"><label class="channel-counter-toggle"><input name="messageCounterEnabled" type="checkbox" ${counter.enabled ? 'checked' : ''}><span><b>Dynamische Vorlage aktivieren</b><small>Jeder referenzierte Kanal wird getrennt und dauerhaft gezählt.</small></span></label><label>Variable einfügen<select name="counterVariableChannel"><option value="">Diesen Kanal ({chat.count})</option>${variableChannels}</select></label><label>Discord-Sync-Intervall<select name="messageCounterIntervalMinutes">${counterIntervalOptions}</select><small>Minimum 5 Minuten. Kürzer blockt Discord Kanalthemen oft per Rate-Limit.</small></label><button class="button secondary channel-counter-insert" type="button" data-insert-counter-variable>Variable an Cursor einfügen</button></div><div class="channel-counter-example"><span>Discord-Vorschau</span><code>${safe(counter.preview || topicTemplate || 'Noch keine Vorlage')}</code><small>Aktualisierung ${safe(counterIntervalText)}; bei Discord-Rate-Limit wartet der Bot automatisch bis zum erlaubten Retry.</small></div></section>`
      : `<section class="channel-counter-card full"><div class="channel-counter-head"><span><small>FORUM-STRUKTUR</small><b>Posts statt Textverlauf</b></span><span class="channel-counter-state">Zähler nicht verfügbar</span></div><p>Dieser Bereich besteht aus Forum-Posts/Threads. Du kannst Name, Thema und Moderationsoptionen bearbeiten; der dynamische Nachrichtenzähler bleibt bei normalen Textkanälen.</p></section>`;
    const channelTools = selectedChannelMeta?.editable ? `<form class="channel-admin-card" data-channel-form="${safe(selectedChannelMeta.id)}"><div class="channel-admin-head"><span><small>${safe(channelLabel.toUpperCase())}-EINSTELLUNGEN</small><b>#${safe(selectedChannelMeta.name)}</b></span><em>LIVE MIT DISCORD</em></div><div class="channel-admin-grid"><label>Name<input name="name" maxlength="100" value="${safe(selectedChannelMeta.name)}"></label><label>Slowmode<select name="rateLimitPerUser">${[0,5,10,30,60,300,900,3600,21600].map((seconds) => `<option value="${seconds}" ${Number(selectedChannelMeta.rateLimitPerUser || 0) === seconds ? 'selected' : ''}>${seconds ? seconds < 60 ? `${seconds} Sekunden` : seconds < 3600 ? `${seconds / 60} Minuten` : `${seconds / 3600} Stunden` : 'Aus'}</option>`).join('')}</select></label><label class="full">Kanalthema-Vorlage<textarea name="topic" maxlength="1024" placeholder="${supportsCounter ? 'Zum Beispiel: {chat.count.#hauptchat} versendete Nachrichten' : 'Beschreibung für dieses Forum'}">${safe(topicTemplate)}</textarea></label>${counterSection}<label class="channel-nsfw"><input name="nsfw" type="checkbox" ${selectedChannelMeta.nsfw ? 'checked' : ''}><span>Als NSFW-Kanal markieren</span></label><button class="button primary" type="submit">Kanal speichern</button></div></form>` : '';
    channelWindowStart = 0;
    const currentPage = Math.max(1, Number(channelPage || 1));
    const channelWindowEnd = channelRows.length;
    const windowControls = channelWindowControls(channelWindowStart, channelWindowEnd);
    const rows = channelRows.slice(channelWindowStart, channelWindowEnd).map((rawMessage = {}) => {
      const message = rawMessage || {};
      const author = message?.author || {};
      const attachmentMediaUrls = new Set(
        (message.attachments || []).map((item) => mediaUrlBase(item?.url || '')).filter(Boolean)
      );
      const contentMediaUrls = new Set(textMediaUrls(message.content || '').filter(Boolean));
      const contentMediaSignatures = new Set(Array.from(contentMediaUrls).map((item) => (mediaCompareSignature(item) || {}).raw).filter(Boolean));
      const hasOnlyMediaLinksInContent = contentHasOnlyMediaLink(message.content || '', contentMediaUrls);
      const attachments = (message.attachments || []).map((item) => {
        const isImage = isImageAttachment(item);
        const isVideo = isVideoAttachment(item);
        const isAudio = isAudioAttachment(item);
        if (isImage) return `<a class="message-image-link" href="#" data-open-url="${safe(item.url)}"><img class="message-image" src="${safe(item.url)}" alt="${safe(item.name)}" loading="lazy"></a>`;
        if (isVideo) return `<div class="message-media"><video controls preload="metadata" src="${safe(item.url)}"></video><a href="#" data-open-url="${safe(item.url)}">${safe(item.name)}</a></div>`;
        if (isAudio) return `<div class="message-media audio"><audio controls preload="metadata" src="${safe(item.url)}"></audio><a href="#" data-open-url="${safe(item.url)}">${safe(item.name)}</a></div>`;
        return `<a href="#" data-open-url="${safe(item.url)}">${safe(item.name)}</a>`;
      }).join('');
      const embeds = (message.embeds || []).map((item, embedIndex) => {
        const media = embedPrimaryMedia(item);
        const isGifEmbed = media && media.kind === 'image' && isGifUrl(media.url);
        const hasVisualBody = embedHasVisualBody(item);
        const sourceUrls = embedSourceUrls(item);
        const isContentLinkedEmbed = sourceUrls.some((sourceUrl) => {
          const normalized = mediaUrlBase(sourceUrl || '');
          return Array.from(contentMediaUrls).some((contentUrl) => mediaLinkMatches(contentUrl, normalized));
        });
        const isSignatureLinkedEmbed = sourceUrls.some((sourceUrl) => {
          const sourceSig = (mediaCompareSignature(sourceUrl) || {}).raw;
          if (!sourceSig) return false;
          return contentMediaSignatures.has(sourceSig);
        });
        const hasAnyMediaSource = media
          ? Boolean(media.url || media.type)
          : sourceUrls.some((sourceUrl) => isImageUrl(sourceUrl) || isVideoUrl(sourceUrl) || isGifUrl(sourceUrl));
        const isLikelyLinkPreviewEmbed = !hasVisualBody
          && Boolean(media)
          && !String(item.title || '').trim()
          && !String(item.description || '').trim()
          && (!Array.isArray(item.fields) || item.fields.length === 0);
        const isDirectMediaPost = hasOnlyMediaLinksInContent && hasAnyMediaSource;
        if (((isContentLinkedEmbed || isSignatureLinkedEmbed) && isLikelyLinkPreviewEmbed) || isDirectMediaPost) {
          if (media && (isImageUrl(media.url) || isGifUrl(media.url))) {
            return `<a class="message-image-link" href="#" data-open-url="${safe(media.url)}"><img class="message-image" src="${safe(media.url)}" alt="GIF" loading="lazy"></a>`;
          }
          if (media && isVideoUrl(media.url)) {
            return `<div class="message-media"><video controls preload="metadata" src="${safe(media.url)}"></video><a href="#" data-open-url="${safe(media.url)}">GIF-Video öffnen</a></div>`;
          }
          return '';
        }
        const isDuplicate = media && attachmentMediaUrls.has(mediaUrlBase(media.url));
        if (!hasVisualBody && isGifEmbed && !isDuplicate) {
          return `<a class="message-image-link" href="#" data-open-url="${safe(media.url)}"><img class="message-image" src="${safe(media.url)}" alt="GIF" loading="lazy"></a>`;
        }
        if (!hasVisualBody && media && media.kind === 'video' && !isDuplicate) {
          return `<div class="message-media"><video controls preload="metadata" src="${safe(media.url)}"></video><a href="#" data-open-url="${safe(media.url)}">GIF-Video öffnen</a></div>`;
        }
        return `<div class="message-embed" style="--embed:${embedColor(item.color)}"><div class="message-embed-tools"><span>EMBED ${embedIndex + 1}</span><button type="button" data-copy-embed="${safe(message.id)}" data-embed-index="${embedIndex}">Im Studio öffnen</button></div>${item.author ? `<small>${safe(item.author)}</small>` : ''}${item.title ? `<b>${safe(item.title)}</b>` : ''}${item.description ? `<p>${renderDiscordText(item.description, message)}</p>` : ''}${(item.fields || []).map((field) => `<dl><dt>${safe(field.name)}</dt><dd>${renderDiscordText(field.value, message)}</dd></dl>`).join('')}${item.image ? `<img src="${safe(item.image)}" alt="" loading="lazy">` : ''}</div>`;
      }).join('');
      const reactions = (message.reactions || []).map((item) => `<span class="message-reaction">${renderDiscordText(item.emoji, message)} ${safe(item.count)}</span>`).join('');
      const stickers = (message.stickers || []).map((sticker = {}) => `<a class="message-sticker" href="#" data-open-url="${safe(sticker.url)}"><img src="${safe(sticker.url)}" data-fallback="${safe(sticker.previewUrl)}" alt="${safe(sticker.name)}" title="${safe(sticker.name)}" loading="lazy"></a>`).join('');
      const wholeEmbedAction = message?.embeds?.length ? `<button type="button" data-copy-all-embeds="${safe(message.id)}">Nachricht + Reaktionsrollen</button>` : '';
      const actions = `<div class="message-actions"><button type="button" data-copy-message="${safe(message.id)}">Kopieren</button><button type="button" data-use-welcome-message="${safe(message.id)}">Als Willkommen</button>${wholeEmbedAction}${Boolean(message.canEdit) ? `<button type="button" data-edit-message="${safe(message.id)}">Bearbeiten</button>` : ''}${Boolean(message.canDelete) ? `<button type="button" class="danger" data-delete-message="${safe(message.id)}">Löschen</button>` : ''}</div>`;
      const editor = Boolean(message.canEdit) ? `<form class="message-inline-editor" data-message-edit-form="${safe(message.id)}" hidden><textarea name="content" maxlength="2000">${safe(message.content || '')}</textarea><div><button type="button" data-cancel-message-edit="${safe(message.id)}">Abbrechen</button><button class="button primary" type="submit">Speichern</button></div></form>` : '';
      const authorDisplayName = String(author?.displayName || author?.username || author?.id || '').trim() || 'Discord-Mitglied';
      return `<article class="message-row" data-message-row="${safe(message.id)}"><img class="message-avatar" src="${safe(avatarSource(author))}" data-fallback="${safe(author?.fallbackAvatar || avatarSource(author))}" alt=""><div class="message-body"><div class="message-author"><b>${safe(authorDisplayName)}</b>${Boolean(author?.bot) ? '<span>BOT</span>' : ''}</div>${message.content ? `<p>${renderDiscordText(message.content, message)}</p>` : ''}${embeds}${attachments ? `<div class="message-attachments">${attachments}</div>` : ''}${stickers ? `<div class="message-stickers">${stickers}</div>` : ''}${reactions ? `<div class="message-reactions">${reactions}</div>` : ''}${editor}</div><div class="message-side"><time>${safe(date(message.createdAt))}</time>${actions}</div></article>`;
      }).join('');
    const backToForum = selectedChannelMeta?.isThread && selectedForumParentId
      ? `<button type="button" class="forum-thread-back" data-forum-back="${safe(selectedForumParentId)}">Zurück zu den Forum-Posts</button>`
      : '';
    const historyState = !channelHasMore && currentPage === Math.max(1, Number(channelTotalPages || 1))
      ? `<span class="history-start">${channelIndexComplete ? 'Vollständiger Index · Anfang des Verlaufs erreicht' : 'Aktuell älteste indexierte Seite erreicht'}</span>`
      : '';
    target.innerHTML = `${backToForum}${channelTools}${windowControls.before}${rows || '<p class="community-empty">In diesem Kanal wurden keine Nachrichten gefunden.</p>'}${windowControls.after}${historyState}`;
    mountChannelTopicEmojiControl(target);
  }

  function channelUiSnapshot() {
    const target = $('#channel-messages');
    if (!target) return null;
    const channelForm = target.querySelector('[data-channel-form]');
    const active = target.contains(document.activeElement) ? document.activeElement : null;
    const values = {};
    if (channelForm) {
      Array.from(channelForm.elements).forEach((element) => {
        if (!element.name) return;
        values[element.name] = element.type === 'checkbox' ? element.checked : element.value;
      });
    }
    return {
      scrollTop: target.scrollTop,
      nearBottom: target.scrollHeight - target.clientHeight - target.scrollTop < 90,
      channelValues: values,
      openEditors: Array.from(target.querySelectorAll('[data-message-edit-form]:not([hidden])')).map((form) => ({
        id: form.dataset.messageEditForm,
        value: form.elements.content?.value || ''
      })),
      active: active ? {
        scope: active.closest('[data-message-edit-form]')?.dataset.messageEditForm || (active.closest('[data-channel-form]') ? 'channel' : ''),
        name: active.name || '',
        start: Number.isFinite(active.selectionStart) ? active.selectionStart : null,
        end: Number.isFinite(active.selectionEnd) ? active.selectionEnd : null
      } : null
    };
  }

  function restoreChannelUi(snapshot) {
    if (!snapshot) return;
    const target = $('#channel-messages');
    if (!target) return;
    const channelForm = target.querySelector('[data-channel-form]');
    if (channelForm) {
      Object.entries(snapshot.channelValues || {}).forEach(([name, value]) => {
        const element = channelForm.elements[name];
        if (!element) return;
        if (element.type === 'checkbox') element.checked = Boolean(value);
        else element.value = value;
      });
    }
    (snapshot.openEditors || []).forEach((entry) => {
      const form = target.querySelector(`[data-message-edit-form="${CSS.escape(String(entry.id))}"]`);
      if (!form) return;
      form.hidden = false;
      if (form.elements.content) form.elements.content.value = entry.value;
    });
    if (snapshot.nearBottom) target.scrollTop = target.scrollHeight;
    else target.scrollTop = snapshot.scrollTop;
    if (snapshot.active?.name) {
      const scope = snapshot.active.scope === 'channel'
        ? target.querySelector('[data-channel-form]')
        : target.querySelector(`[data-message-edit-form="${CSS.escape(String(snapshot.active.scope || ''))}"]`);
      const element = scope?.elements?.[snapshot.active.name];
      if (element) {
        element.focus({ preventScroll: true });
        if (snapshot.active.start !== null && typeof element.setSelectionRange === 'function') {
          element.setSelectionRange(snapshot.active.start, snapshot.active.end);
        }
      }
    }
  }

  function commitChannelLiveRender() {
    const target = $('#channel-messages');
    if (!target) return;
    const editing = target.contains(document.activeElement) && document.activeElement.matches('input, textarea, select');
    if (editing) {
      channelRenderPending = true;
      return;
    }
    const snapshot = channelUiSnapshot();
    channelRenderPending = false;
    renderChannelMessages();
    restoreChannelUi(snapshot);
  }

  async function refreshSelectedChannelMessages(showLiveNotice = false) {
    if (channelRefreshInFlight || !isCommunityVisible() || !selectedChannelId || activeTab !== 'structure') return;
    if (selectedChannelMeta?.isForumLike && !selectedChannelMeta?.isThread) return;
    if (channelStorage === 'server-index-pages' && channelPage > 1) {
      const target = $('#channel-messages');
      if (showLiveNotice && target && !target.querySelector('.channel-new-message-notice')) {
        target.insertAdjacentHTML('afterbegin', '<button type="button" class="channel-new-message-notice" data-channel-jump-live>Neue Nachrichten verfügbar · Zur aktuellen Seite</button>');
      }
      return;
    }
    if (!channelRows.length) {
      await loadChannel(selectedChannelId, '', 1);
      return;
    }
    const lastId = channelRows[channelRows.length - 1]?.id;
    if (!lastId) return;
    const requestedGuildId = guildId();
    const requestedChannelId = selectedChannelId;
    channelRefreshInFlight = true;
    try {
      const data = await request(`/api/guild/${encodeURIComponent(requestedGuildId)}/channel/${encodeURIComponent(requestedChannelId)}/messages?limit=100&after=${encodeURIComponent(lastId)}`);
      if (requestedGuildId !== guildId() || requestedChannelId !== selectedChannelId) return;
      const known = new Set(channelRows.map((item) => item.id));
      const incoming = (Array.isArray(data.messages) ? data.messages : []).filter((item) => !known.has(item.id));
      if (!incoming.length) return;
      const wasAtLiveEdge = channelStorage === 'server-index-pages' ? channelPage === 1 : channelWindowStart + CHANNEL_DOM_LIMIT >= channelRows.length;
      channelRows = [...channelRows, ...incoming].slice(-CHANNEL_DOM_LIMIT);
      if (channelStorage === 'server-index-pages') {
        channelTotalMessages += incoming.length;
        channelTotalPages = Math.max(1, Math.ceil(channelTotalMessages / CHANNEL_DOM_LIMIT));
      } else {
        channelTotalMessages = channelRows.length;
        channelTotalPages = Math.max(1, Math.ceil(channelRows.length / CHANNEL_DOM_LIMIT));
      }
      if (wasAtLiveEdge) {
        channelWindowStart = Math.max(0, channelRows.length - CHANNEL_DOM_LIMIT);
        // Nur der Kanalreader wird aktualisiert. So bleiben Seitennummern,
        // Einstellungen und der Live-Stand konsistent, ohne die App-Seite neu zu laden.
        $('#channel-messages')?.querySelector('.channel-new-message-notice')?.remove();
        commitChannelLiveRender();
      } else {
        const target = $('#channel-messages');
        if (target && !target.querySelector('.channel-new-message-notice')) {
          target.insertAdjacentHTML('afterbegin', '<button type="button" class="channel-new-message-notice" data-channel-jump-live>Neue Nachrichten verfügbar · Zum Live-Stand</button>');
        }
      }
    } catch (_error) {
      // Der bestehende Verlauf bleibt bei einem kurzfristigen Discord-Fehler stabil sichtbar.
    } finally {
      channelRefreshInFlight = false;
    }
  }

  function scheduleChannelRefresh() {
    clearInterval(channelRefreshTimer);
    if (selectedChannelMeta?.isForumLike && !selectedChannelMeta?.isThread) {
      jobs.stop('channel-live-refresh');
      return;
    }
    jobs.upsert('channel-live-refresh', refreshSelectedChannelMessages, CHANNEL_LIVE_REFRESH_MS);
  }

  async function loadChannel(channelId, before = '', requestedPage = 1) {
    const id = guildId();
    if (!id || !channelId || !isCommunityVisible() || activeTab !== 'structure') return;
    const requestId = ++channelLoadRequestId;
    roleLoadRequestId += 1;
    const target = $('#channel-messages');
    const knownChannel = (currentManagement?.channels || []).find((channel) => String(channel.id) === String(channelId));
    const page = Math.max(1, Math.trunc(Number(requestedPage) || 1));
    const sameChannelPageNavigation = !before && String(selectedChannelId || '') === String(channelId) && Boolean(selectedChannelMeta) && !selectedChannelMeta?.isForumLike;
    if (!before) {
      selectedChannelId = channelId;
      if (knownChannel?.isForumLike) selectedForumParentId = channelId;
      else if (knownChannel && !knownChannel.isThread) selectedForumParentId = '';
      if (!sameChannelPageNavigation) {
        channelRows = [];
        channelWindowStart = 0;
        channelPage = 1;
        channelTotalPages = 1;
        channelTotalMessages = 0;
        channelIndexComplete = false;
        channelStorage = '';
        channelBefore = '';
        target.innerHTML = '<p class="community-empty">Kanalindex und Live-Stand werden geladen ...</p>';
      } else {
        target.classList.add('channel-page-loading');
      }
    }
    $$('.channel-row').forEach((row) => row.classList.toggle('active', row.dataset.channelId === channelId));
    $$('.role-row').forEach((row) => row.classList.remove('active'));
    try {
      const isForumRequest = Boolean(knownChannel?.isForumLike || selectedChannelMeta?.isForumLike && !selectedChannelMeta?.isThread);
      const query = new URLSearchParams({
        limit: isForumRequest ? '100' : String(CHANNEL_DOM_LIMIT),
        ...(!isForumRequest && !before ? { page: String(page) } : {}),
        ...(before ? { before } : {})
      });
      const data = await request(`/api/guild/${encodeURIComponent(id)}/channel/${encodeURIComponent(channelId)}/messages?${query}`);
      if (requestId !== channelLoadRequestId || id !== guildId() || String(channelId) !== String(selectedChannelId) || activeTab !== 'structure' || !isCommunityVisible()) return;
      selectedChannelMeta = data.channel;
      if (selectedChannelMeta?.isThread && selectedChannelMeta.parentId) selectedForumParentId = selectedChannelMeta.parentId;
      const isForumRoot = Boolean(selectedChannelMeta?.isForumLike && !selectedChannelMeta?.isThread && data.storage === 'forum-posts-live');
      $('#reader-kicker').textContent = isForumRoot ? 'FORUM-POSTS' : selectedChannelMeta?.isThread ? 'FORUM-POST' : 'KANAL-INHALT';
      $('#reader-mode').textContent = isForumRoot ? 'POSTS LIVE' : selectedChannelMeta?.isThread ? 'THREAD LIVE' : 'INDEX + LIVE';
      $('#reader-title').textContent = `#${data.channel.name}`;
      $('#reader-topic').innerHTML = renderDiscordText(data.channel.topic || (isForumRoot ? 'Wähle einen Forum-Post, um dessen Thread-Nachrichten zu lesen.' : 'Keine Kanalbeschreibung hinterlegt. Der Verlauf kann seitenweise bis zum Anfang geladen werden.'));
      const known = new Set(channelRows.map((item) => item.id));
      const incoming = (Array.isArray(data.messages) ? data.messages : []).filter((item) => !known.has(item.id));
      channelStorage = String(data.storage || '');
      if (data.pagination && channelStorage === 'server-index-pages') {
        channelRows = Array.isArray(data.messages) ? data.messages : [];
        channelPage = Math.max(1, Number(data.pagination.page || page));
        channelTotalPages = Math.max(1, Number(data.pagination.totalPages || 1));
        channelTotalMessages = Math.max(channelRows.length, Number(data.pagination.totalMessages || 0));
        channelIndexComplete = Boolean(data.pagination.complete);
        channelWindowStart = 0;
      } else {
        channelRows = before ? [...incoming, ...channelRows] : incoming;
        channelWindowStart = before
          ? Math.max(0, channelWindowStart - incoming.length)
          : Math.max(0, channelRows.length - CHANNEL_DOM_LIMIT);
        channelPage = Math.max(1, Math.ceil((channelRows.length - channelWindowStart) / CHANNEL_DOM_LIMIT));
        channelTotalPages = Math.max(1, Math.ceil(channelRows.length / CHANNEL_DOM_LIMIT));
        channelTotalMessages = channelRows.length;
        channelIndexComplete = false;
      }
      channelBefore = data.nextBefore || '';
      channelHasMore = Boolean(data.hasMore);
      if (isForumRoot) {
        renderForumPostBrowser();
        scheduleChannelRefresh();
        return;
      }
      renderChannelMessages();
      scheduleChannelRefresh();
    } catch (error) {
      if (requestId !== channelLoadRequestId || id !== guildId() || String(channelId) !== String(selectedChannelId)) return;
      target.innerHTML = `<p class="community-empty">${safe(error.message)}</p>`;
    } finally {
      target?.classList.remove('channel-page-loading');
    }
  }

  async function loadAllForumPosts(button) {
    if (!selectedChannelId || !selectedChannelMeta?.isForumLike || selectedChannelMeta?.isThread || !channelBefore || !channelHasMore) return;
    const channelId = selectedChannelId;
    const previousText = button?.textContent || 'Alle restlichen Posts laden';
    if (button) {
      button.disabled = true;
      button.textContent = 'Forum-Posts werden geladen ...';
    }
    let rounds = 0;
    let loaded = 0;
    const seenCursors = new Set();
    try {
      while (channelHasMore && channelBefore && selectedChannelId === channelId && rounds < 40) {
        const cursor = channelBefore;
        if (seenCursors.has(cursor)) break;
        seenCursors.add(cursor);
        const beforeCount = channelRows.length;
        await loadChannel(channelId, cursor);
        loaded += Math.max(0, channelRows.length - beforeCount);
        rounds += 1;
        if (button) button.textContent = `${loaded.toLocaleString('de-DE')} Posts geladen ...`;
        if (channelRows.length === beforeCount && channelBefore === cursor) break;
      }
      notify(channelHasMore ? 'Forum-Laden pausiert, weil Discord keine neue Seite geliefert hat.' : `Alle Forum-Posts geladen (${channelRows.length.toLocaleString('de-DE')}).`, channelHasMore ? 'warning' : 'success');
    } catch (error) {
      notify(error?.message || 'Forum-Posts konnten nicht vollständig geladen werden.', 'error');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = previousText;
      }
    }
  }

  async function loadRole(roleId) {
    const id = guildId();
    if (!id || !roleId || !isCommunityVisible() || activeTab !== 'structure') return;
    const requestId = ++roleLoadRequestId;
    channelLoadRequestId += 1;
    clearInterval(channelRefreshTimer);
    jobs.stop('channel-live-refresh');
    selectedChannelId = '';
    selectedChannelMeta = null;
    $$('.role-row').forEach((row) => row.classList.toggle('active', row.dataset.roleId === roleId));
    $$('.channel-row').forEach((row) => row.classList.remove('active'));
    $('#reader-kicker').textContent = 'ROLLENVERWALTUNG';
    $('#reader-mode').textContent = 'SICHERER EDITOR';
    $('#reader-title').textContent = 'Rolle wird geladen ...';
    $('#reader-topic').textContent = 'Berechtigungen und Rollenhierarchie werden geprüft.';
    $('#channel-messages').innerHTML = '<p class="community-empty">Rollendetails werden geladen ...</p>';
    try {
      const data = await request(`/api/guild/${encodeURIComponent(id)}/role/${encodeURIComponent(roleId)}`);
      if (requestId !== roleLoadRequestId || id !== guildId() || activeTab !== 'structure' || !isCommunityVisible()) return;
      const role = data.role || {};
      const permissions = safeArray(role.permissions);
      const members = safeArray(role.members);
      $('#reader-title').textContent = safe(role.name || 'Rolle');
      $('#reader-topic').textContent = `${safe(role.memberCount || 0)} Mitglieder · Position ${safe(role.position || 0)} · ${safe(permissions.length)} Berechtigungen`;
      $('#channel-messages').innerHTML = `<form class="role-editor" data-role-form="${safe(role.id)}"><label>Rollenname<input name="name" maxlength="100" value="${safe(role.name)}" ${role.editable ? '' : 'disabled'}></label><label>Farbe<input name="color" type="color" value="${safe(role.color || '#8f93b8')}" ${role.editable ? '' : 'disabled'}></label><label class="role-check"><input name="hoist" type="checkbox" ${role.hoist ? 'checked' : ''} ${role.editable ? '' : 'disabled'}><span>Separat in der Mitgliederliste anzeigen</span></label><label class="role-check"><input name="mentionable" type="checkbox" ${role.mentionable ? 'checked' : ''} ${role.editable ? '' : 'disabled'}><span>Rolle darf erwähnt werden</span></label><div class="role-permissions"><b>Berechtigungen</b><p>${permissions.map((item) => `<span>${safe(item)}</span>`).join('') || '<span>Keine</span>'}</p></div><div class="role-members"><b>Mitglieder mit dieser Rolle</b><div>${members.map((member = {}) => `<span><img src="${safe(avatarSource(member))}" alt="">${safe(member.displayName)}</span>`).join('') || '<small>Keine Mitglieder</small>'}</div></div>${role.editable ? '<button class="button primary" type="submit">Rolle speichern</button>' : '<p class="role-protected">Diese Rolle ist verwaltet, zu hoch oder durch Discord geschützt.</p>'}</form>`;
    } catch (error) {
      if (requestId !== roleLoadRequestId || id !== guildId() || activeTab !== 'structure') return;
      $('#channel-messages').innerHTML = `<p class="community-empty">${safe(error.message)}</p>`;
    }
  }

  function memberStatus(member) {
    if (!member) return `<span class="member-presence offline"><i></i>Offline</span>`;
    const labels = { online: 'Online', idle: 'Abwesend', dnd: 'Nicht stören', offline: 'Offline' };
    const value = member.status || 'offline';
    return `<span class="member-presence ${safe(value)}"><i></i>${safe(labels[value] || 'Offline')}</span>`;
  }

  function memberActivity(member) {
    if (!member) return '<small class="member-activity unknown" title="Datensatz wird nachgeladen">Datensatz unvollständig</small>';
    if (!member.lastMessageAt) {
      const progress = memberIndexStatus?.running ? `Serverindex läuft: ${memberIndexStatus.progress || 0}%` : 'Im vollständigen Serverindex wurde keine Nachricht gefunden.';
      return `<small class="member-activity unknown" title="${safe(progress)}">${safe(progress)}</small>`;
    }
    const elapsed = Math.max(0, Date.now() - new Date(member.lastMessageAt).getTime());
    const minutes = Math.floor(elapsed / 60_000);
    const label = minutes < 60 ? `vor ${Math.max(1, minutes)} Min.` : minutes < 1440 ? `vor ${Math.floor(minutes / 60)} Std.` : `vor ${Math.floor(minutes / 1440)} Tagen`;
    return `<small class="member-activity${minutes < 10 ? ' live' : ''}" title="${safe(date(member.lastMessageAt))}">Letzte Nachricht ${safe(label)}</small>`;
  }

  function renderMemberSummary(data) {
    const counts = data.counts || {};
    $('#member-summary').innerHTML = [
      ['Treffer', data.total || 0],
      ['Online', counts.online || 0],
      ['Booster', counts.boosters || 0],
      ['Timeouts', counts.timedOut || 0],
      ['Bot-Konten', counts.bots || 0],
      ['Index', data.indexStatus?.running ? `${data.indexStatus.progress || 0}%` : 'Bereit']
    ].map(([label, value]) => `<span><b>${safe(value)}</b>${safe(label)}</span>`).join('');
  }

  function renderMemberPagination(data) {
    const target = $('#member-pagination');
    const page = Number(data.page || 0);
    const pages = Math.max(1, Number(data.pageCount || 1));
    target.innerHTML = `<span>Seite <b>${page + 1}</b> von <b>${pages}</b> · ${safe(data.total || 0)} Treffer</span><div><button type="button" data-member-page="0" ${page <= 0 ? 'disabled' : ''}>«</button><button type="button" data-member-page="${page - 1}" ${page <= 0 ? 'disabled' : ''}>‹</button><button type="button" data-member-page="${page + 1}" ${page >= pages - 1 ? 'disabled' : ''}>›</button><button type="button" data-member-page="${pages - 1}" ${page >= pages - 1 ? 'disabled' : ''}>»</button></div>`;
  }

  async function loadMembers(query = '', sync = false) {
    const id = guildId();
    if (!id || !isCommunityVisible() || activeTab !== 'members') return;
    const requestId = ++memberRequestId;
    const target = $('#community-members');
    const syncButton = $('#member-sync');
    clearTimeout(memberSyncTimer);
    memberSyncTimer = null;
    if (!hasRenderedMembers) target.innerHTML = '<p class="community-empty">Mitglieder werden geladen ...</p>';
    target.setAttribute('aria-busy', 'true');
    if (sync && syncButton) {
      syncButton.disabled = true;
      syncButton.textContent = 'Discord wird abgeglichen ...';
    }
    try {
      // The first visit must paint the cached member list immediately. A full
      // Discord member fetch is only forced by the explicit sync button; the
      // backend still starts a non-blocking refresh when its cache is incomplete.
      const params = new URLSearchParams({ page: String(memberPage), pageSize: String(memberPageSize), query: String(query || ''), filter: memberFilter, sort: memberSort, sync: sync ? '1' : '0' });
      const data = await request(`/api/guild/${encodeURIComponent(id)}/members?${params}`);
      if (requestId !== memberRequestId || id !== guildId() || activeTab !== 'members' || !isCommunityVisible()) return;
      memberIndexStatus = data.indexStatus || null;
      memberPage = Number(data.page || 0);
      renderMemberSummary(data);
      renderMemberPagination(data);
      target.innerHTML = data.members.length ? data.members.map((member = {}) => {
        const safeMember = member || {};
        const roleColor = safe(safeMember.role?.color || '#8f93b8');
        const roleName = safe(safeMember.role?.name || 'Keine Rolle');
        const roleCount = Number(safeMember.roleCount || 0);
        return `<button type="button" class="member-table-row${selectedMember?.id === safeMember.id ? ' active' : ''}" data-member-id="${safe(safeMember.id)}"><span class="member-identity"><img src="${safe(avatarSource(safeMember))}" alt=""><span><b>${safe(safeMember.displayName)}</b><small>@${safe(safeMember.username)} · ${safe(safeMember.id)}</small></span></span><span>${memberStatus(safeMember)}${memberActivity(safeMember)}${safeMember.isBooster ? '<small class="member-badge booster">Booster</small>' : ''}${safeMember.timedOutUntil ? '<small class="member-badge timeout">Timeout</small>' : ''}</span><time>${safe(date(safeMember.joinedAt, false))}</time><span class="member-role-cell"><small class="member-role" style="background:${safe(roleColor)}22;color:${safe(roleColor)}">${roleName}</small><em>${safe(roleCount)} Rollen</em></span><strong>Details ›</strong></button>`;
      }).join('') : '<p class="community-empty">Keine passenden Mitglieder gefunden.</p>';
      hasRenderedMembers = true;
      if (data.syncingMembers && !data.cacheComplete) {
        $('#community-freshness').textContent = `${data.syncedMembers || 0} von ${data.guildMemberCount || 0} Mitgliedern bereit · Discord-Abgleich läuft im Hintergrund`;
        memberSyncTimer = setTimeout(() => loadMembers(query, false), 1200);
      }
    } catch (error) {
      if (requestId !== memberRequestId || id !== guildId() || activeTab !== 'members') return;
      target.innerHTML = `<div class="community-load-error"><strong>Mitglieder konnten nicht geladen werden</strong><p>${safe(error.message)}</p><button type="button" class="button secondary" data-member-retry>Erneut versuchen</button></div>`;
      target.querySelector('[data-member-retry]')?.addEventListener('click', () => loadMembers(query, false));
    } finally {
      if (requestId === memberRequestId) target.removeAttribute('aria-busy');
      if (sync && syncButton) {
        syncButton.disabled = false;
        syncButton.textContent = 'Mit Discord abgleichen';
      }
    }
  }

  function capabilityButton(action, label, enabled, extraClass = '') {
    return `<button type="button" class="button ${extraClass || 'secondary'}" data-member-action="${safe(action)}" ${enabled ? '' : 'disabled'}>${safe(label)}</button>`;
  }

  function confidenceMeta(score = 0) {
    const numeric = Number(score || 0);
    const value = Math.max(0, Math.min(100, Math.round(numeric > 0 && numeric <= 1 ? numeric * 100 : numeric)));
    if (value >= 95) return { label: 'Direkt belegt', tone: 'high', value };
    if (value >= 75) return { label: 'Gut belegt', tone: 'medium', value };
    if (value > 0) return { label: 'Unvollständig', tone: 'low', value };
    return { label: 'Noch keine Belege', tone: 'empty', value: 0 };
  }

  function memberTimelineIcon(type) {
    const icons = {
      account_created: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"></circle><path d="M5 21v-2a7 7 0 0 1 14 0v2"></path></svg>',
      member_joined: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 19v-1a5 5 0 0 0-5-5H6a5 5 0 0 0-5 5v1"></path><circle cx="8" cy="7" r="4"></circle><path d="M18 8v6m-3-3h6"></path></svg>',
      member_left: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 19v-1a5 5 0 0 0-5-5H5a5 5 0 0 0-5 5v1"></path><circle cx="7" cy="7" r="4"></circle><path d="M15 11h7m-3-3 3 3-3 3"></path></svg>',
      member_kicked: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 19v-1a5 5 0 0 0-5-5H5a5 5 0 0 0-5 5v1"></path><circle cx="7" cy="7" r="4"></circle><path d="m16 9 6 6m0-6-6 6"></path></svg>',
      member_banned: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="m6 6 12 12"></path></svg>',
      member_unbanned: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11V8a5 5 0 0 1 9.6-2"></path><rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="m9 16 2 2 4-4"></path></svg>',
      timeout_started: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg>',
      timeout_ended: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="m8 12 3 3 5-6"></path></svg>',
      boost_started: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.6 5.4L20 11l-5.4 2.6L12 19l-2.6-5.4L4 11l5.4-2.6L12 3Z"></path></svg>',
      boost_ended: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.6 5.4L20 11l-5.4 2.6L12 19l-2.6-5.4L4 11l5.4-2.6L12 3Z"></path><path d="m7 5 10 14"></path></svg>',
      boost_expired: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.6 5.4L20 11l-5.4 2.6L12 19l-2.6-5.4L4 11l5.4-2.6L12 3Z"></path><path d="M8 21h8M9 17h6"></path></svg>',
      system: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v3m0 12v3M3 12h3m12 0h3"></path><circle cx="12" cy="12" r="5"></circle></svg>'
    };
    return icons[type] || icons.system;
  }

  function renderMemberIntelligence(member) {
    const intelligence = member.intelligence || {};
    const analysis = intelligence.analysis || {};
    const recordedSystemTimeline = Array.isArray(intelligence.systemTimeline) ? intelligence.systemTimeline : [];
    const currentJoinTime = Date.parse(member.joinedAt || '');
    const hasCurrentJoinEvent = Number.isFinite(currentJoinTime) && recordedSystemTimeline.some((event) => event.type === 'member_joined' && Math.abs(Date.parse(event.createdAt || '') - currentJoinTime) < 60_000);
    const timelinePresentation = {
      account_created: { title: 'Discord-Account erstellt', text: 'Der Discord-Account wurde erstellt.', category: 'ACCOUNT', tone: 'account' },
      member_joined: { title: 'Dem Server beigetreten', text: 'Das Mitglied ist FALLEN HEAVEN beigetreten.', category: 'MITGLIEDSCHAFT', tone: 'positive' },
      member_left: { title: 'Server verlassen', text: 'Das Mitglied hat FALLEN HEAVEN verlassen.', category: 'MITGLIEDSCHAFT', tone: 'muted' },
      member_kicked: { title: 'Vom Server gekickt', text: 'Das Mitglied wurde durch eine Moderationsaktion entfernt.', category: 'MODERATION', tone: 'danger' },
      member_banned: { title: 'Vom Server gebannt', text: 'Das Mitglied wurde vom Server gebannt.', category: 'MODERATION', tone: 'danger' },
      member_unbanned: { title: 'Bann aufgehoben', text: 'Der Serverbann wurde aufgehoben.', category: 'MODERATION', tone: 'positive' },
      timeout_started: { title: 'Timeout erhalten', text: 'Das Mitglied wurde vorübergehend im Server eingeschränkt.', category: 'MODERATION', tone: 'warning' },
      timeout_ended: { title: 'Timeout beendet', text: 'Die vorübergehende Einschränkung wurde beendet.', category: 'MODERATION', tone: 'positive' },
      boost_started: { title: 'Server-Boost gestartet', text: 'Das Mitglied unterstützt den Server mit einem Boost.', category: 'SERVER BOOST', tone: 'boost' },
      boost_ended: { title: 'Server-Boost beendet', text: 'Der Server-Boost ist nicht mehr aktiv.', category: 'SERVER BOOST', tone: 'muted' },
      boost_expired: { title: 'Server-Boost ausgelaufen', text: 'Der Boost-Log meldet, dass ein Boost ausgelaufen ist.', category: 'SERVER BOOST', tone: 'muted' }
    };
    const systemTimelineEvents = [
      member.createdAt ? { type: 'account_created', createdAt: member.createdAt } : null,
      member.joinedAt && !hasCurrentJoinEvent ? { type: 'member_joined', createdAt: member.joinedAt } : null,
      ...recordedSystemTimeline.map((event) => {
        return { ...event };
      })
    ].filter(Boolean).sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
      .filter((event, index, rows) => index === rows.findIndex((candidate) => String(candidate.id || `${candidate.type}:${candidate.createdAt}`) === String(event.id || `${event.type}:${event.createdAt}`)));
    const systemTimelineRows = systemTimelineEvents.length ? systemTimelineEvents.map((event, index) => {
        const presentation = { ...(timelinePresentation[event.type] || { title: 'Discord-Systemereignis', text: 'Ein verifiziertes Serverereignis wurde erfasst.', category: 'SYSTEM', tone: 'system' }) };
        const source = String(event.source || event.metadata?.source || '');
        const sourceLabel = source === 'discord-audit-log' ? 'Durch Discord Audit-Log bestätigt' : source === 'discord-gateway' ? 'Durch Discord Gateway bestätigt' : '';
        if (!event.metadata) event.metadata = {};
        if (!event.metadata.reason && event.metadata.sourceLabel) event.metadata.reason = event.metadata.sourceLabel;
        presentation.title = String(event.title || presentation.title || '').trim();
        presentation.text = String(event.displayText || event.text || event.metadata?.text || presentation.text || '').trim();
        const reason = String(event.metadata?.reason || '').trim();
        const executor = String(event.metadata?.executorName || '').trim();
        return `<article class="intel-timeline-row system-only ${safe(event.type)} tone-${safe(presentation.tone)}" style="--intel-event-index:${index}"><span class="intel-timeline-marker">${memberTimelineIcon(event.type)}</span><div class="intel-timeline-card"><header><span class="intel-timeline-kind">${safe(presentation.category)}</span><time>${safe(date(event.createdAt))}</time></header><strong>${safe(presentation.title)}</strong><p>${safe(presentation.text)}</p>${executor || reason || sourceLabel ? `<footer>${executor ? `<span>Ausgeführt von <b>${safe(executor)}</b></span>` : ''}${reason ? `<span>Grund: <b>${safe(reason)}</b></span>` : ''}${sourceLabel ? `<span class="verified">${safe(sourceLabel)}</span>` : ''}</footer>` : ''}</div></article>`;
      }).join('') : '<p class="intel-empty">Noch keine System- oder Moderationsereignisse für dieses Mitglied erfasst.</p>';
    const introduction = intelligence.introduction || null;
    const insights = Array.isArray(intelligence.insights) ? intelligence.insights : [];
    const unclear = Array.isArray(intelligence.unclear) ? intelligence.unclear : [];
    const channels = Array.isArray(intelligence.channels) ? intelligence.channels : [];
    const evidence = Array.isArray(intelligence.evidence) ? intelligence.evidence : [];
    const links = Array.isArray(intelligence.links) ? intelligence.links : [];
    const media = Array.isArray(intelligence.media) ? intelligence.media : [];
    const overall = confidenceMeta(intelligence.overallConfidence);
    const analysisProgress = Math.max(0, Math.min(100, Number(analysis.progress ?? (intelligence.partial ? 85 : 100))));
    const maxChannelCount = Math.max(1, ...channels.map((channel) => Number(channel.count || 0)));
    const insightCards = insights.length ? insights.map((insight) => {
      const confidence = confidenceMeta(insight.confidence);
      const firstEvidence = insight.evidence?.[0];
      const contextRows = [...(firstEvidence?.contextBefore || []).map((item) => ({ ...item, position: 'Vorher' })), ...(firstEvidence?.contextAfter || []).map((item) => ({ ...item, position: 'Nachher' }))];
      const contextHtml = contextRows.length ? `<details class="intel-context"><summary>Gesprächskontext (${contextRows.length})</summary><div>${contextRows.map((item) => `<article><span>${safe(item.position)} · ${safe(date(item.createdAt))}</span><strong>${String(item.authorId) === String(member.id) ? 'Dieses Mitglied' : `Mitglied ${safe(String(item.authorId || '').slice(-6))}`}</strong><p>${safe(item.content || 'Nachricht ohne Text')}</p></article>`).join('')}</div></details>` : '';
      return `<article class="intel-insight verified"><div class="intel-insight-head"><span class="intel-kind">${safe(insight.category || 'Aussage')}</span><span class="intel-confidence ${confidence.tone}">${safe(confidence.label)} · ${confidence.value}%</span></div><strong>${safe(insight.value || 'Belegtes Signal')}</strong><p>${safe(insight.summary || firstEvidence?.content || '')}</p><div class="intel-evidence-actions">${firstEvidence?.jumpUrl ? `<a href="${safe(firstEvidence.jumpUrl)}" target="_blank" rel="noreferrer">Originalnachricht öffnen</a>` : ''}<span>Kontext vor & nach dem Beleg geprüft</span></div>${contextHtml}</article>`;
    }).join('') : '<div class="intel-empty">Noch keine eindeutigen persönlichen Aussagen gefunden. Es werden keine Interessen geraten.</div>';
    const introductionFields = Array.isArray(introduction?.fields) ? introduction.fields : [];
    const introductionCard = introductionFields.length ? `<section class="intel-introduction"><div class="intel-block-head"><div><span class="eyebrow">SELBSTAUSKUNFT</span><h4>Vorstellung des Mitglieds</h4></div><span>${introductionFields.length} direkt übernommene Felder</span></div><div class="intel-introduction-grid">${introductionFields.map((field) => `<div><span>${safe(field.label)}</span><strong>${safe(field.value)}</strong></div>`).join('')}</div>${introduction?.evidence?.jumpUrl ? `<a href="${safe(introduction.evidence.jumpUrl)}" target="_blank" rel="noreferrer">Originale Vorstellung öffnen</a>` : ''}<p>Diese Angaben stammen aus einer eigenen Vorstellung und werden nicht von der AI ergänzt oder interpretiert.</p></section>` : '';
    const unclearCards = unclear.length ? `<details class="intel-unclear"><summary><span>Unklare Signale</span><b>${unclear.length} nicht übernommen</b></summary><p>Diese Texte waren negiert, zeitbezogen oder sprachlich mehrdeutig. Sie sind ausdrücklich kein Bestandteil des Nutzerprofils.</p><div>${unclear.map((item) => `<article><span>NICHT ÜBERNOMMEN</span><strong>${safe(item.statement || 'Unklare Aussage')}</strong><small>${safe(item.reason || 'Nicht eindeutig belegbar.')}</small>${item.jumpUrl ? `<a href="${safe(item.jumpUrl)}" target="_blank" rel="noreferrer">Original prüfen</a>` : ''}</article>`).join('')}</div></details>` : '';
    const channelRows = channels.length ? channels.slice(0, 8).map((channel) => {
      const width = Math.max(6, Math.round((Number(channel.count || 0) / maxChannelCount) * 100));
      return `<div class="intel-channel"><div><span># ${safe(channel.channelName || channel.name || channel.channelId || channel.id || 'Kanal')}</span><b>${Number(channel.count || 0).toLocaleString('de-DE')}</b></div><i><span style="width:${width}%"></span></i></div>`;
    }).join('') : '<div class="intel-empty compact">Keine Kanalaktivität im verfügbaren Zeitraum.</div>';
    const evidenceRows = evidence.length ? evidence.slice(0, 12).map((item) => `<article class="intel-evidence"><div><strong># ${safe(item.channelName || item.channelId || 'Kanal')}</strong><time>${safe(date(item.createdAt))}</time></div><p>${safe(item.content || 'Nachricht ohne Textinhalt')}</p>${item.jumpUrl ? `<a href="${safe(item.jumpUrl)}" target="_blank" rel="noreferrer">In Discord ansehen</a>` : ''}</article>`).join('') : '<div class="intel-empty compact">Keine zitierbaren Belege vorhanden.</div>';
    const analysisStatus = `<section class="intel-analysis-status ${intelligence.partial ? 'partial' : 'complete'}" data-analysis-status><div class="intel-analysis-head"><div><span class="eyebrow">GESAMTFORTSCHRITT</span><strong>Gesamtanalyse des Nutzerindex</strong></div><b data-analysis-percent>${Math.round(analysisProgress)}%</b></div><i><span data-analysis-bar style="width:${analysisProgress}%"></span></i><div class="intel-analysis-metrics"><span><b data-analysis-processed>${Number(analysis.processedMessages ?? intelligence.analyzedMessages ?? 0).toLocaleString('de-DE')}</b> von <i data-analysis-total>${Number(analysis.totalMessages || 0).toLocaleString('de-DE')}</i> Nachrichten</span><span><b data-analysis-statements>${Number(analysis.verifiedStatements ?? insights.length).toLocaleString('de-DE')}</b> belegte Aussagen</span><span><b data-analysis-introduction>${Number(analysis.introductionFields ?? introductionFields.length).toLocaleString('de-DE')}</b> Vorstellungsfelder</span><span><b data-analysis-unclear>${Number(analysis.unclearSignals ?? unclear.length).toLocaleString('de-DE')}</b> unklare Signale</span><span><b data-analysis-context>${Number(analysis.contextualizedStatements ?? 0).toLocaleString('de-DE')}</b> Kontextfenster geprüft</span></div><p data-analysis-copy>Die Analyse läuft dauerhaft im Hintergrund. Das Profil bleibt dabei stabil und wird nicht neu aufgebaut.</p></section>`;
    const profileBadge = overall.value ? `<span class="intel-confidence ${overall.tone}">${safe(overall.label)} · ${overall.value}%</span>` : '<span class="intel-confidence empty">Keine Vermutungen</span>';
    return `<section class="member-intelligence"><div class="intel-title"><div><span class="eyebrow">USER INTELLIGENCE</span><h3>Belegtes Serverprofil</h3></div>${profileBadge}</div><nav class="intel-tabs" aria-label="Profilbereiche"><button type="button" class="active" data-intel-tab="overview">Übersicht</button><button type="button" data-intel-tab="interests">Aussagen</button><button type="button" data-intel-tab="activity">Aktivität</button><button type="button" data-intel-tab="timeline">Timeline</button><button type="button" data-intel-tab="data">Belege</button></nav><div class="intel-panel active" data-intel-panel="overview"><p class="intel-privacy">Nur öffentliche Servernachrichten und freiwillige Discord-Profildaten. Keine Direktnachrichten, keine sensiblen Ableitungen und keine erfundenen Ergänzungen.</p>${analysisStatus}<div class="intel-metrics"><div><strong>${Number(intelligence.analyzedMessages || 0).toLocaleString('de-DE')}</strong><span>Nachrichten analysiert</span></div><div><strong>${Number(intelligence.activeChannels || channels.length || 0).toLocaleString('de-DE')}</strong><span>aktive Kanäle</span></div><div><strong>${insights.length.toLocaleString('de-DE')}</strong><span>belegte Aussagen</span></div><div><strong>${(links.length + media.length).toLocaleString('de-DE')}</strong><span>Links & Medien</span></div></div>${intelligence.lastMessageAt ? `<p class="intel-last">Letzte erfasste Nachricht: <strong>${safe(date(intelligence.lastMessageAt))}</strong></p>` : ''}</div><div class="intel-panel" data-intel-panel="interests">${introductionCard}<div class="intel-block"><div class="intel-block-head"><h4>Verifizierte Interessen & Aussagen</h4><span>nur mit Originalnachweis</span></div><div class="intel-insights">${insightCards}</div></div>${unclearCards}</div><div class="intel-panel" data-intel-panel="activity"><div class="intel-block"><div class="intel-block-head"><h4>Aktivität nach Kanal</h4><span>indexierter Zeitraum</span></div><div class="intel-channels">${channelRows}</div></div></div><div class="intel-panel" data-intel-panel="timeline"><section class="intel-timeline-shell"><header class="intel-timeline-head"><div><span>MITGLIEDS-CHRONIK</span><h4>Verifizierte Ereignisse</h4><p>Profil-, Mitgliedschafts-, Boost- und Moderationsereignisse in zeitlicher Reihenfolge.</p></div><strong>${systemTimelineEvents.length}</strong></header><div class="intel-timeline">${systemTimelineRows}</div></section></div><div class="intel-panel" data-intel-panel="data"><div class="intel-data-actions"><button type="button" class="button secondary" data-intel-refresh>Neu analysieren</button><button type="button" class="button secondary" data-intel-export>Profil exportieren</button></div><p class="intel-privacy">Der Export enthält ausschließlich sichtbare öffentliche Serverdaten. Eine Neuanalyse liest den persistenten Index erneut und ersetzt keine Originalnachricht.</p><details class="intel-evidence-list" open><summary>Originalbelege (${evidence.length})</summary><div>${evidenceRows}</div></details></div>${intelligence.partial ? '<p class="intel-partial">Der Langzeitindex wird noch ergänzt. Bereits angezeigte Aussagen besitzen trotzdem einen direkten Originalbeleg.</p>' : ''}${intelligence.error ? `<p class="intel-error">${safe(intelligence.error)}</p>` : ''}</section>`;
  }

  function bindMemberIntelligence(member) {
    const scope = $('#member-detail');
    if (!scope) return;
    const memberKey = String(member.id || '');
    const activateTab = (tabName) => {
      const selectedTab = String(tabName || 'overview');
      scope.querySelectorAll('[data-intel-tab]').forEach((item) => item.classList.toggle('active', item.dataset.intelTab === selectedTab));
      scope.querySelectorAll('[data-intel-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.intelPanel === selectedTab));
    };
    activateTab(memberIntelligenceTabs.get(memberKey) || 'overview');
    scope.querySelectorAll('[data-intel-tab]').forEach((button) => {
      button.onclick = () => {
        memberIntelligenceTabs.set(memberKey, button.dataset.intelTab || 'overview');
        activateTab(button.dataset.intelTab);
      };
    });
    scope.querySelector('[data-intel-refresh]')?.addEventListener('click', () => loadMemberDetails(member.id, true));
    scope.querySelector('[data-intel-export]')?.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), member: { id: member.id, username: member.username, displayName: member.displayName, joinedAt: member.joinedAt, createdAt: member.createdAt, premiumSince: member.premiumSince }, intelligence: member.intelligence || {} }, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `fallen-heaven-user-${member.id}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  function renderMemberDetails(member) {
    selectedMember = member && typeof member === 'object' ? member : null;
    const safeMember = selectedMember || {};
    const roles = safeArray(safeMember.roles);
    const assignable = safeArray(safeMember.assignableRoles);
    const capabilities = safeMember.capabilities && typeof safeMember.capabilities === 'object' ? safeMember.capabilities : {};
    const safeRoleStyle = (role = {}) => {
      const color = String(role.color || '#8f93b8').trim() || '#8f93b8';
      return `--role:${safe(color)};background:${safe(color)}15;color:${safe(color)}`;
    };
    try {
      $('#member-detail').innerHTML = `<div class="member-profile-head"><img src="${safe(avatarSource(safeMember))}" alt=""><div><p class="eyebrow">MITGLIED-PROFIL</p><h3>${safe(safeMember.displayName || 'Mitglied')}</h3><span>@${safe(safeMember.username || 'unbekannt')} · ${safe(safeMember.id || '---')}</span></div>${memberStatus(safeMember)}</div><div class="member-facts"><span><small>Beigetreten</small><b>${safe(date(safeMember.joinedAt))}</b></span><span><small>Account erstellt</small><b>${safe(date(safeMember.createdAt))}</b></span><span><small>Server-Boost</small><b>${safeMember.premiumSince ? safe(date(safeMember.premiumSince, false)) : 'Nein'}</b></span><span><small>Timeout</small><b>${safeMember.timedOutUntil ? safe(date(safeMember.timedOutUntil)) : 'Nicht aktiv'}</b></span></div>${renderMemberIntelligence(safeMember)}<section class="member-role-manager"><div class="member-section-title"><h4>Rollen</h4><span>${safe(roles.length)}</span></div><div class="member-role-chips">${roles.length ? roles.map((role = {}) => `<span style="${safeRoleStyle(role)}"><i></i>${safe(role.name || 'Unbekannte Rolle')}${role.removable ? `<button type="button" data-remove-role="${safe(role.id)}" aria-label="Rolle entfernen">×</button>` : ''}</span>`).join('') : '<small>Keine zusätzlichen Rollen</small>'}</div>${capabilities.roles ? `<div class="member-role-add"><select id="member-role-select"><option value="">Rolle auswählen ...</option>${assignable.map((role = {}) => `<option value="${safe(role?.id)}">${safe(role?.name || 'Unbekannte Rolle')}</option>`).join('')}</select><button type="button" class="button secondary" data-member-action="addRole">Hinzufügen</button></div>` : '<p class="member-safety-note">Rollenänderungen sind durch Discord-Berechtigungen oder die Rollenhierarchie geschützt.</p>'}</section><section class="member-moderation"><div class="member-section-title"><h4>Moderation</h4><span>SICHER</span></div><label>Interner Grund<textarea id="member-action-reason" maxlength="400" placeholder="Grund für Audit-Log und Moderationsnachweis ..."></textarea></label><div class="member-timeout-row"><select id="member-timeout-duration"><option value="10">10 Minuten</option><option value="60">1 Stunde</option><option value="1440">1 Tag</option><option value="10080">7 Tage</option><option value="40320">28 Tage</option></select>${capabilityButton('timeout', 'Timeout setzen', capabilities.timeout)}</div><div class="member-action-grid">${capabilityButton('removeTimeout', 'Timeout entfernen', capabilities.timeout)}${capabilityButton('kick', 'Vom Server kicken', capabilities.kick, 'danger subtle')}${capabilityButton('ban', 'Mitglied bannen', capabilities.ban, 'danger')}</div><p class="member-safety-note">Owner, gleich- oder höhergestellte Rollen, verwaltete Rollen und Administrator-Rollen sind automatisch geschützt.</p></section>`;
      bindMemberIntelligence(safeMember);
      scheduleMemberAnalysisPoll(safeMember.id, safeMember.intelligence?.analysis);
    } catch (error) {
      $('#member-detail').innerHTML = `<p class="community-empty">Mitgliedsprofil konnte nicht geladen werden: ${safe(error?.message || 'Unbekannter Fehler')}</p>`;
    }
  }

  function updateMemberAnalysisProgress(intelligence = {}) {
    const analysis = intelligence.analysis || {};
    const scope = $('#member-detail [data-analysis-status]');
    if (!scope) return;
    const progress = Math.max(0, Math.min(100, Number(analysis.progress || 0)));
    scope.classList.toggle('partial', intelligence.partial !== false);
    scope.classList.toggle('complete', intelligence.partial === false);
    const setText = (selector, value) => { const node = scope.querySelector(selector); if (node) node.textContent = value; };
    setText('[data-analysis-percent]', `${Math.round(progress)}%`);
    setText('[data-analysis-processed]', Number(analysis.processedMessages || intelligence.analyzedMessages || 0).toLocaleString('de-DE'));
    setText('[data-analysis-total]', Number(analysis.totalMessages || 0).toLocaleString('de-DE'));
    setText('[data-analysis-statements]', Number(analysis.verifiedStatements || 0).toLocaleString('de-DE'));
    setText('[data-analysis-introduction]', Number(analysis.introductionFields || 0).toLocaleString('de-DE'));
    setText('[data-analysis-unclear]', Number(analysis.unclearSignals || 0).toLocaleString('de-DE'));
    setText('[data-analysis-context]', Number(analysis.contextualizedStatements || 0).toLocaleString('de-DE'));
    const bar = scope.querySelector('[data-analysis-bar]');
    if (bar) bar.style.width = `${progress}%`;
    const analyzedMetric = $('#member-detail .intel-metrics strong');
    if (analyzedMetric) analyzedMetric.textContent = Number(intelligence.analyzedMessages || analysis.processedMessages || 0).toLocaleString('de-DE');
  }

  function scheduleMemberAnalysisPoll(userId, analysis = {}) {
    clearTimeout(memberAnalysisPollTimer);
    memberAnalysisPollTimer = null;
    if (!['queued', 'running', 'stale'].includes(String(analysis.status || ''))) return;
    memberAnalysisPollTimer = window.setTimeout(async () => {
      if (!isCommunityVisible() || activeTab !== 'members' || String(selectedMember?.id || '') !== String(userId || '')) return;
      try {
        const data = await request(`/api/guild/${encodeURIComponent(guildId())}/member/${encodeURIComponent(userId)}/intelligence-status`, { timeoutMs: 8000 });
        if (String(selectedMember?.id || '') !== String(userId || '')) return;
        updateMemberAnalysisProgress(data.intelligence || {});
        scheduleMemberAnalysisPoll(userId, data.intelligence?.analysis || {});
      } catch { scheduleMemberAnalysisPoll(userId, analysis); }
    }, 2500);
  }

  async function loadMemberDetails(userId, refresh = false) {
    const id = guildId();
    if (!id || !userId || !isCommunityVisible() || activeTab !== 'members') return;
    const requestId = ++memberDetailRequestId;
    const switchesMember = String(selectedMember?.id || '') !== String(userId || '');
    if (switchesMember) {
      clearTimeout(memberAnalysisPollTimer);
      memberAnalysisPollTimer = null;
      $('#member-detail').innerHTML = '<p class="community-empty">Mitgliedsprofil wird geladen ...</p>';
    }
    try {
      const data = await request(`/api/guild/${encodeURIComponent(id)}/member/${encodeURIComponent(userId)}${refresh ? '?refresh=1' : ''}`, { timeoutMs: refresh ? 30000 : 15000 });
      if (requestId !== memberDetailRequestId || id !== guildId() || activeTab !== 'members' || !isCommunityVisible()) return;
      renderMemberDetails(data.member);
      $$('.member-table-row').forEach((row) => row.classList.toggle('active', row.dataset.memberId === userId));
    } catch (error) {
      if (requestId !== memberDetailRequestId || id !== guildId() || activeTab !== 'members') return;
      const transient = /zeitüberschreitung|zu langsam|econnreset|nicht erreichbar/i.test(String(error.message || ''));
      $('#member-detail').innerHTML = `<p class="community-empty">${safe(transient ? 'Das Profil wird im Hintergrund vorbereitet. Der Bot bleibt aktiv; die Ansicht lädt gleich erneut.' : error.message)}</p>`;
      if (transient && switchesMember) {
        clearTimeout(memberAnalysisPollTimer);
        memberAnalysisPollTimer = window.setTimeout(() => loadMemberDetails(userId, false), 3500);
      }
    }
  }

  function askMemberAction(action, title, payload = {}) {
    if (!selectedMember || typeof selectedMember !== 'object') return;
    if (!selectedMember.id) return;
    pendingMemberAction = { action, payload };
    $('#member-dialog-title').textContent = title;
    $('#member-dialog-copy').textContent = `${selectedMember.displayName} (${selectedMember.id}): Diese Aktion wird über Discord ausgeführt und im Audit-Log mit deinem Konto dokumentiert.`;
    $('#member-action-dialog').showModal();
  }

  async function executeMemberAction() {
    if (!selectedMember || !pendingMemberAction) return;
    const dialog = $('#member-action-dialog');
    const confirm = $('#member-dialog-confirm');
    confirm.disabled = true;
    confirm.textContent = 'Wird ausgeführt ...';
    try {
      const body = { action: pendingMemberAction.action, reason: $('#member-action-reason')?.value || '', minutes: Number($('#member-timeout-duration')?.value || 10), ...pendingMemberAction.payload };
      const data = await request(`/api/guild/${encodeURIComponent(guildId())}/member/${encodeURIComponent(selectedMember.id)}/action`, { method: 'POST', body });
      dialog.close();
      pendingMemberAction = null;
      if (data.result?.removed) {
        selectedMember = null;
        $('#member-detail').innerHTML = '<div class="member-detail-empty"><span>✓</span><h3>Aktion abgeschlossen</h3><p>Das Mitglied befindet sich nicht mehr auf dem Server.</p></div>';
      } else if (data.result?.member) {
        renderMemberDetails(data.result.member);
      }
      await loadMembers($('#member-search')?.value || '');
    } catch (error) {
      $('#member-dialog-copy').textContent = error.message;
    } finally {
      confirm.disabled = false;
      confirm.textContent = 'Verbindlich ausführen';
    }
  }

  function renderBoostBaselineEditor(status) {
    const editor = $('#boost-baseline-editor');
    const list = $('#boost-baseline-list');
    const health = $('#boost-baseline-health');
    const picker = $('#boost-baseline-member-add');
    if (!editor || !list || !health || !picker) return;
    const importedActivity = status.activityImport || null;
    const active = Array.isArray(status.active) ? status.active : [];
    editor.hidden = !importedActivity?.baselineCompletedAt;
    if (editor.hidden) return;

    const consistencyState = String(status.summary?.consistencyState || 'synchronized');
    const difference = Number(status.summary?.rawBoostCountDifference ?? status.summary?.boostCountDifference ?? 0);
    const countsMatch = consistencyState !== 'mismatch';
    health.className = `boost-baseline-health ${countsMatch ? 'ready' : 'warning'}`;
    health.textContent = consistencyState === 'discord-pending'
      ? 'DISCORD AKTUALISIERT NOCH'
      : countsMatch
        ? `SYNCHRON · ${status.summary?.discordBoostCount || 0} BOOSTS`
        : `FEHLER ${difference > 0 ? '+' : ''}${difference}`;

    const selectedValue = picker.value;
    picker.innerHTML = `<option value="">Aktiven Booster auswählen ...</option>${active
      .map((member) => `<option value="${safe(member.id)}">${safe(member.displayName)} · ${safe(member.boostCount)} Boost${Number(member.boostCount) === 1 ? '' : 's'}</option>`)
      .join('')}`;
    if (active.some((member) => String(member.id) === selectedValue)) picker.value = selectedValue;

    const query = boostBaselineQuery.trim().toLocaleLowerCase('de-DE');
    const visible = active.filter((member) => !query || `${member.displayName} ${member.username}`.toLocaleLowerCase('de-DE').includes(query));
    list.innerHTML = visible.length ? visible.map((member) => {
      const count = Math.max(1, Number(member.boostCount || 1));
      return `<article class="boost-baseline-row" data-boost-baseline-row="${safe(member.id)}"><img src="${safe(avatarSource(member))}" alt=""><span><b>${safe(member.displayName)}</b><small>@${safe(member.username)} · Discord aktiv</small></span><div class="boost-count-stepper"><button type="button" data-boost-step="-1" aria-label="Einen Boost abziehen">−</button><input type="number" min="1" max="99" step="1" value="${count}" data-boost-count="${safe(member.id)}" data-original-count="${count}" aria-label="Boost-Anzahl für ${safe(member.displayName)}"><button type="button" data-boost-step="1" aria-label="Einen Boost hinzufügen">+</button></div><button type="button" class="button primary boost-baseline-save" data-boost-baseline-save="${safe(member.id)}" disabled>Änderung speichern</button></article>`;
    }).join('') : '<p class="community-empty">Kein aktiver Booster passt zu dieser Suche.</p>';
  }

  function renderBoosts(data) {
    const boosts = data.boosts || { count: 0, tier: 0, boosters: [], status: {} };
    const status = boosts.status || {};
    const boostSummary = status.summary || {};
    const importedActivity = status.activityImport || null;
    const groups = {
      active: status.active || boosts.boosters || [],
      ended: status.ended || [],
      unclear: status.unclear || []
    };
    groups.active = [...groups.active].sort((a, b) => Number(b.boostCount || 1) - Number(a.boostCount || 1)
      || new Date(a.premiumSince || 0) - new Date(b.premiumSince || 0));
    const labels = { active: 'Aktive Booster', ended: 'Beendete Boosts', unclear: 'Unklare Datensätze', all: 'Alle Boost-Ereignisse' };
    let selected = $('#boost-filter-tabs .active')?.dataset.boostFilter || 'active';
    $('#boost-tier').textContent = `TIER ${boosts.tier || 0}`;
    $('#boost-summary').innerHTML = `<article><span>DISCORD BOOSTS</span><b>${safe(boostSummary.discordBoostCount ?? boosts.count ?? 0)}</b></article><article><span>AKTIVE BOOSTER</span><b>${safe(boostSummary.activeBoosterCount ?? groups.active.length)}</b></article><article><span>BERECHNETE BOOSTS</span><b>${safe(boostSummary.assignedBoostCount ?? groups.active.reduce((sum, member) => sum + Math.max(1, Number(member.boostCount || 0)), 0))}</b></article><article><span>SYSTEM-EVENTS</span><b>${safe((status.events || []).length)}</b></article><article><span>SERVER-TIER</span><b>${safe(boosts.tier || 0)}</b></article><article><span>BEENDET</span><b>${safe(groups.ended.length)}</b></article>`;
    const consistencyAlert = $('#boost-consistency-alert');
    if (consistencyAlert) {
      const discordCount = Number(boostSummary.discordBoostCount ?? boosts.count ?? 0);
      const calculatedCount = Number(boostSummary.assignedBoostCount ?? 0);
      const consistencyState = String(boostSummary.consistencyState || (calculatedCount === discordCount ? 'synchronized' : 'mismatch'));
      consistencyAlert.hidden = consistencyState === 'synchronized';
      consistencyAlert.classList.toggle('pending', consistencyState === 'discord-pending');
      consistencyAlert.innerHTML = consistencyState === 'synchronized'
        ? ''
        : consistencyState === 'discord-pending'
          ? `<span>↻</span><div><b>Discord aktualisiert die Gesamtzahl noch</b><p>Ein persönliches Boost-Ereignis ist bereits eindeutig zugeordnet. Die verzögerte Server-Gesamtzahl wird nicht als Differenz gewertet und verändert keine anderen Mitglieder.</p></div>`
          : `<span>!</span><div><b>Unmögliche Boost-Verteilung erkannt</b><p>Discord meldet <strong>${safe(discordCount)}</strong> aktive Boosts, die Summe der persönlichen Belege ergibt <strong>${safe(calculatedCount)}</strong>. Die App verteilt die Abweichung nicht auf Mitglieder; Staffelrollen und neue Coin-Meilensteine bleiben bis zur Korrektur gesperrt.</p></div>`;
    }
    const importResult = $('#boost-activity-result');
    if (importResult && importedActivity && !boostActivityPreviewText) {
      importResult.className = 'boost-activity-result success';
      importResult.textContent = `Zuletzt importiert: ${date(importedActivity.importedAt)} · ${importedActivity.matchedRows} zugeordnet · ${importedActivity.ignoredRows ?? importedActivity.unresolvedRows ?? 0} frühere Mitglieder ignoriert.`;
    }
    renderBoostBaselineEditor(status);

    const paint = () => {
      const entries = selected === 'all' ? [...groups.active, ...groups.ended, ...groups.unclear] : groups[selected] || [];
      $('#boost-list-title').textContent = labels[selected] || labels.active;
      $('#boost-list-count').textContent = String(entries.length);
      $('#community-boosters').innerHTML = entries.length ? entries.map((member) => {
        const statusCopy = selected === 'active' || member.nativeActive ? `Boostet seit ${date(member.premiumSince, false)}` : selected === 'ended' ? `Beendet ${date(member.updatedAt, false)}` : `Prüfung nötig · ${date(member.updatedAt, false)}`;
        const activeCount = Math.max(0, Number(member.boostCount || 0));
        const countCopy = member.nativeActive
          ? `${activeCount} aktiver ${activeCount === 1 ? 'Boost' : 'Boosts'} nach Aktivitätsabgleich`
          : 'Nicht aktiv';
        const action = member.nativeActive && importedActivity?.baselineCompletedAt
          ? `<button type="button" class="boost-count-action" data-boost-baseline-open="${safe(member.id)}">Basis bearbeiten</button>`
          : '';
        return `<article class="booster-card boost-${safe(selected)}"><img src="${safe(avatarSource(member))}" alt=""><div><b>${safe(member.displayName)}</b><small>@${safe(member.username)}</small><small>${safe(statusCopy)}</small><em>${safe(countCopy)}</em>${action}</div></article>`;
      }).join('') : `<p class="community-empty">Keine Einträge im Bereich „${safe(labels[selected] || labels.active)}“.</p>`;
      const events = (status.events || []).filter((event) => selected === 'all' || event.currentStatus === selected);
      $('#boost-events').innerHTML = events.length ? events.slice(0, 100).map((event) => `<article class="boost-event boost-${safe(event.currentStatus)}"><i></i><div><b>${event.type === 'ended' || event.type === 'expired' ? 'Boost beendet' : event.type === 'boost-info' ? 'Boost-Info bestätigt' : 'Discord-Systemboost'}</b><small>${safe(event.sourceLabel)} · <@${safe(event.userId)}></small><time>${safe(date(event.timestamp, false))}</time></div></article>`).join('') : '<p class="community-empty">Für diesen Filter sind keine Ereignisse vorhanden.</p>';
    };

    $$('#boost-filter-tabs button').forEach((button) => {
      button.onclick = () => {
        selected = button.dataset.boostFilter || 'active';
        $$('#boost-filter-tabs button').forEach((item) => item.classList.toggle('active', item === button));
        paint();
      };
    });
    paint();
  }

  function findBoostMember(userId) {
    const status = currentManagement?.boosts?.status || {};
    return [...(status.active || []), ...(status.ended || []), ...(status.unclear || [])]
      .find((member) => String(member.id) === String(userId));
  }

  async function verifyBoostCount(userId, button) {
    const member = findBoostMember(userId);
    if (!member?.nativeActive || !button) return;
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Discord wird geprüft ...';
    try {
      await request(`/api/guild/${encodeURIComponent(guildId())}/boost-role-verify`, {
        method: 'POST',
        timeoutMs: 60000,
        body: { userId: member.id }
      });
      cache.delete(guildId());
      await loadManagement(true);
    } catch (error) {
      notify(error.message || 'Die nativen Discord-Systemmeldungen konnten nicht bestätigt werden.', 'info');
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  function paintBoostActivityResult(result, applied = false) {
    const target = $('#boost-activity-result');
    if (!target) return;
    const unresolved = Array.isArray(result?.unresolved) ? result.unresolved : [];
    const missing = Array.isArray(result?.activeWithoutRows) ? result.activeWithoutRows : [];
    const details = [];
    if (unresolved.length) details.push(`Nicht mehr auf dem Server / ignoriert: ${unresolved.slice(0, 8).map((row) => row.rawName).join(', ')}${unresolved.length > 8 ? ' …' : ''}`);
    if (missing.length) details.push(`Aktive Booster ohne Zeile: ${missing.slice(0, 8).map((member) => member.displayName).join(', ')}${missing.length > 8 ? ' …' : ''}`);
    if (Number.isFinite(Number(result?.calculatedBoostCount)) && Number.isFinite(Number(result?.discordBoostCount))) {
      const difference = Number(result.boostCountDifference || 0);
      details.unshift(`Basis: ${result.calculatedBoostCount} · Discord: ${result.discordBoostCount} · Differenz: ${difference > 0 ? '+' : ''}${difference}`);
    }
    const headline = applied
      ? `Basis gespeichert: ${result.matchedRows} Zeilen wurden verrechnet und die Rollen synchronisiert.`
      : `Vorschau: ${result.matchedRows} von ${result.parsedRows} Zeilen eindeutig zugeordnet · ${result.ignoredRows ?? result.unresolvedRows ?? 0} frühere Mitglieder ignoriert · ${result.invalidRows} ungültig.`;
    target.className = `boost-activity-result${result.countsMatch === false || result.invalidRows ? ' warning' : ' success'}`;
    target.innerHTML = `<b>${safe(headline)}</b>${details.length ? `<br>${details.map(safe).join('<br>')}` : ''}`;
  }

  async function saveBoostBaselineMember(userId, button) {
    const input = $(`[data-boost-count="${CSS.escape(String(userId || ''))}"]`);
    if (!input || !button) return;
    const count = Number(input.value);
    if (!Number.isInteger(count) || count < 1 || count > 99) {
      notify('Bitte gib eine ganze Boost-Anzahl zwischen 1 und 99 ein.', 'info');
      input.focus();
      return;
    }
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Wird gespeichert ...';
    try {
      const response = await request(`/api/guild/${encodeURIComponent(guildId())}/boost-baseline-member`, {
        method: 'POST',
        timeoutMs: 90000,
        body: { userId, count }
      });
      const result = response.result || {};
      notify(result.countsMatch
        ? `${result.displayName}: ${result.count} Boosts gespeichert. Discord-Gesamtsumme stimmt.`
        : `${result.displayName}: ${result.count} Boosts gespeichert. Verbleibende Differenz: ${result.boostCountDifference > 0 ? '+' : ''}${result.boostCountDifference}.`,
      result.countsMatch ? 'success' : 'info');
      cache.delete(guildId());
      await loadManagement(true);
    } catch (error) {
      notify(error.message || 'Die Änderung konnte nicht gespeichert werden.', 'info');
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  function openBoostBaselineMember(userId) {
    const member = findBoostMember(userId);
    if (!member) return;
    boostBaselineQuery = member.displayName || member.username || '';
    const search = $('#boost-baseline-search');
    if (search) search.value = boostBaselineQuery;
    renderBoostBaselineEditor(currentManagement?.boosts?.status || {});
    const row = $(`[data-boost-baseline-row="${CSS.escape(String(userId || ''))}"]`);
    row?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    row?.querySelector('input')?.focus();
  }

  async function previewBoostActivity({ automatic = false } = {}) {
    const text = String($('#boost-activity-text')?.value || '').trim();
    const previewButton = $('#boost-activity-preview');
    const applyButton = $('#boost-activity-apply');
    if (!text) {
      if (!automatic) notify('Füge zuerst die Discord-Boost-Aktivitätszeilen ein.', 'info');
      return;
    }
    const requestId = ++boostActivityPreviewRequestId;
    previewButton.disabled = true;
    applyButton.disabled = true;
    try {
      const response = await request(`/api/guild/${encodeURIComponent(guildId())}/boost-activity-preview`, {
        method: 'POST',
        timeoutMs: 90000,
        body: { text }
      });
      const result = response.result || {};
      if (requestId !== boostActivityPreviewRequestId || String($('#boost-activity-text')?.value || '').trim() !== text) return;
      boostActivityPreviewText = text;
      applyButton.disabled = result.canApply !== true;
      paintBoostActivityResult(result, false);
    } catch (error) {
      if (requestId !== boostActivityPreviewRequestId) return;
      boostActivityPreviewText = '';
      notify(error.message || 'Die Aktivitätsliste konnte nicht geprüft werden.', 'info');
    } finally {
      if (requestId === boostActivityPreviewRequestId) previewButton.disabled = false;
    }
  }

  async function applyBoostActivity() {
    const text = String($('#boost-activity-text')?.value || '').trim();
    const previewButton = $('#boost-activity-preview');
    const applyButton = $('#boost-activity-apply');
    if (!text || text !== boostActivityPreviewText) {
      applyButton.disabled = true;
      notify('Die Liste wurde verändert. Bitte prüfe sie erneut.', 'info');
      return;
    }
    previewButton.disabled = true;
    applyButton.disabled = true;
    try {
      const response = await request(`/api/guild/${encodeURIComponent(guildId())}/boost-activity-import`, {
        method: 'POST',
        timeoutMs: 180000,
        body: { text }
      });
      boostActivityPreviewText = '';
      paintBoostActivityResult(response.result || {}, true);
      cache.delete(guildId());
      await loadManagement(true);
    } catch (error) {
      notify(error.message || 'Die Aktivitätsliste konnte nicht importiert werden.', 'info');
      applyButton.disabled = false;
    } finally {
      previewButton.disabled = false;
    }
  }

  function renderActivePanel(data) {
    if (!data) return;
    if (activeTab === 'events') renderEvents(data.events || []);
    else if (activeTab === 'structure') renderStructure(data, $('#channel-search')?.value || '');
    else if (activeTab === 'boosts') renderBoosts(data);
    else if (activeTab === 'system-events') renderSystemEvents(data.systemEvents || {});
  }

  function scheduleActivePanelRender(data) {
    if (managementRenderFrame) cancelAnimationFrame(managementRenderFrame);
    managementRenderFrame = requestAnimationFrame(() => {
      managementRenderFrame = 0;
      if (data !== currentManagement || !isCommunityVisible()) return;
      renderActivePanel(data);
    });
  }

  function render(data) {
    const source = data && typeof data === 'object' ? data : {};
    const normalized = {
      ...source,
      guild: source.guild && typeof source.guild === 'object' ? source.guild : {},
      channels: Array.isArray(source.channels) ? source.channels : [],
      roles: Array.isArray(source.roles) ? source.roles : [],
      events: Array.isArray(source.events) ? source.events : []
    };
    currentManagement = normalized;
    renderMetrics(normalized);
    scheduleActivePanelRender(normalized);
    $('#community-freshness').textContent = `Aktualisiert ${date(normalized.fetchedAt)}`;
  }

  async function loadSystemEvents(force = false) {
    const id = guildId();
    if (!id || !isCommunityVisible() || activeTab !== 'system-events') return;
    const requestId = ++systemEventRequestId;
    const target = $('#system-event-feed');
    if (target) target.setAttribute('aria-busy', 'true');
    const params = new URLSearchParams({
      page: String(systemEventPage),
      pageSize: String(systemEventPageSize),
      filter: systemEventFilter,
      refresh: force ? '1' : '0'
    });
    try {
      const response = await request(`/api/guild/${encodeURIComponent(id)}/system-events?${params}`, { timeoutMs: 30_000 });
      if (requestId !== systemEventRequestId || id !== guildId() || activeTab !== 'system-events') return;
      if (currentManagement) currentManagement.systemEvents = response.systemEvents;
      renderSystemEvents(response.systemEvents || {});
      const total = Number(response.systemEvents?.summary?.total || 0);
      const countTarget = $('#system-events-count');
      if (countTarget) countTarget.textContent = total.toLocaleString('de-DE');
      $('#community-freshness').textContent = `Systemereignisse aktualisiert ${date(new Date())}`;
    } catch (error) {
      if (requestId !== systemEventRequestId) return;
      notify(error.message || 'Systemereignisse konnten nicht geladen werden.', 'error');
      if (target) {
        target.innerHTML = `<div class="community-load-error"><strong>Systemereignisse konnten nicht geladen werden</strong><p>${safe(error.message || 'Discord antwortet momentan nicht.')}</p><button type="button" class="button secondary" data-system-events-retry>Erneut versuchen</button></div>`;
        target.querySelector('[data-system-events-retry]')?.addEventListener('click', () => loadSystemEvents(true));
      }
    } finally {
      if (requestId === systemEventRequestId && target) target.removeAttribute('aria-busy');
    }
  }

  async function loadManagement(force = false) {
    const id = guildId();
    if (!id) {
      $('#community-freshness').textContent = 'Bitte zuerst einen Server wählen';
      return;
    }
    if (!isCommunityVisible()) return;
    if (managementLoadInFlight) {
      managementRefreshQueued = managementRefreshQueued || managementLoadingGuildId !== id;
      return;
    }
    const cached = cache.get(id);
    if (!force && cached && Date.now() - cached.time < CACHE_MS) {
      render(cached.data);
      return;
    }
    const requestId = ++managementRequestId;
    managementLoadInFlight = true;
    managementLoadingGuildId = id;
    const refreshButton = $('#community-refresh');
    if (refreshButton) {
      refreshButton.disabled = true;
      refreshButton.setAttribute('aria-busy', 'true');
    }
    $('#community-freshness').textContent = 'Discord-Daten werden geladen ...';
    try {
      const response = await request(`/api/guild/${encodeURIComponent(id)}/management${force ? '?refresh=1' : ''}`, { timeoutMs: 15000 });
      if (requestId !== managementRequestId || id !== guildId()) return;
      cache.set(id, { time: Date.now(), data: response.management });
      render(response.management);
      if (activeTab === 'members') loadMembers($('#member-search')?.value || '');
    } catch (error) {
      if (requestId !== managementRequestId || id !== guildId()) return;
      if (cached?.data) {
        render(cached.data);
        $('#community-freshness').textContent = `${error.message} Gespeicherter Stand wird angezeigt.`;
      } else {
        $('#community-freshness').textContent = error.message;
        renderManagementProblem(error.message);
      }
    } finally {
      managementLoadInFlight = false;
      managementLoadingGuildId = '';
      if (requestId === managementRequestId && refreshButton) {
        refreshButton.disabled = false;
        refreshButton.removeAttribute('aria-busy');
      }
      if (managementRefreshQueued && isCommunityVisible()) {
        managementRefreshQueued = false;
        setTimeout(() => void loadManagement(true), 250);
      } else managementRefreshQueued = false;
    }
  }

  $$('.community-tab').forEach((button) => button.addEventListener('click', () => showTab(button.dataset.communityTab)));
  $('[data-view="community"]')?.addEventListener('click', () => setTimeout(() => void loadManagement(false), 0));
  jobs.upsert('community-management-refresh', async () => {
    if (activeTab === 'system-events' && isCommunityVisible()) await loadSystemEvents();
  }, MANAGEMENT_REFRESH_MS, { immediate: false, retryDelay: 10_000, maxBackoff: 120_000 });
  $('#community-refresh')?.addEventListener('click', () => activeTab === 'system-events' ? loadSystemEvents(true) : activeTab === 'vip' ? loadVipEconomy(true) : activeTab === 'backups' ? loadServerBackups() : loadManagement(true));
  $('#vip-reconcile')?.addEventListener('click', () => void reconcileVipEconomy());
  $('#vip-search')?.addEventListener('input', () => { clearTimeout(vipSearchTimer); vipSearchTimer = setTimeout(() => void loadVipEconomy(), 280); });
  $('#vip-filter')?.addEventListener('change', () => void loadVipEconomy());
  $('#vip-member-select')?.addEventListener('change', (event) => {
    selectedVipAccountId = event.target.value;
    const row = (vipEconomy?.rows || []).find((entry) => entry.id === selectedVipAccountId);
    if (row) renderVipAccountDetail(row, vipEconomy.tiers || [], vipEconomy.coinEmoji || '🪙');
  });
  $('#vip-account-list')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-vip-account]');
    if (!button) return;
    selectedVipAccountId = button.dataset.vipAccount;
    const row = (vipEconomy?.rows || []).find((entry) => entry.id === selectedVipAccountId);
    if (row) renderVipAccountDetail(row, vipEconomy.tiers || [], vipEconomy.coinEmoji || '🪙');
  });
  $('#vip-account-detail')?.addEventListener('submit', (event) => { event.preventDefault(); stageVipUpdate(event.target.closest('#vip-account-form')); });
  $('[data-vip-confirm-cancel]')?.addEventListener('click', () => { pendingVipUpdate = null; $('#vip-confirm-dialog')?.close(); });
  $('[data-vip-confirm-apply]')?.addEventListener('click', () => void applyVipUpdate());
  $('#backup-create')?.addEventListener('click', () => void createServerBackup());
  $('#backup-refresh')?.addEventListener('click', () => void loadServerBackups());
  $('#backup-list')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-backup-preview]');
    if (button) void previewServerRestore(button.dataset.backupPreview);
  });
  $('#backup-restore-ack')?.addEventListener('change', (event) => {
    const confirm = $('#backup-restore-confirm');
    if (confirm) confirm.disabled = !event.target.checked;
  });
  $('[data-backup-restore-cancel]')?.addEventListener('click', () => {
    pendingBackupRestore = null;
    $('#backup-restore-dialog')?.close();
  });
  $('#backup-restore-confirm')?.addEventListener('click', () => void restoreServerBackup());
  $('#community-boosters')?.addEventListener('click', (event) => {
    const baselineButton = event.target.closest('[data-boost-baseline-open]');
    if (baselineButton) {
      openBoostBaselineMember(baselineButton.dataset.boostBaselineOpen);
      return;
    }
    const verifyButton = event.target.closest('[data-boost-verify]');
    if (verifyButton) {
      void verifyBoostCount(verifyButton.dataset.boostVerify, verifyButton);
      return;
    }
  });
  $('#boost-baseline-list')?.addEventListener('click', (event) => {
    const stepButton = event.target.closest('[data-boost-step]');
    if (stepButton) {
      const row = stepButton.closest('[data-boost-baseline-row]');
      const input = row?.querySelector('[data-boost-count]');
      if (!input) return;
      input.value = String(Math.max(1, Math.min(99, Number(input.value || 1) + Number(stepButton.dataset.boostStep || 0))));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const saveButton = event.target.closest('[data-boost-baseline-save]');
    if (saveButton) void saveBoostBaselineMember(saveButton.dataset.boostBaselineSave, saveButton);
  });
  $('#boost-baseline-list')?.addEventListener('input', (event) => {
    const input = event.target.closest('[data-boost-count]');
    if (!input) return;
    const row = input.closest('[data-boost-baseline-row]');
    const saveButton = row?.querySelector('[data-boost-baseline-save]');
    if (saveButton) saveButton.disabled = Number(input.value) === Number(input.dataset.originalCount);
  });
  $('#boost-baseline-search')?.addEventListener('input', (event) => {
    boostBaselineQuery = String(event.target.value || '');
    renderBoostBaselineEditor(currentManagement?.boosts?.status || {});
  });
  $('#boost-baseline-member-open')?.addEventListener('click', () => {
    const userId = $('#boost-baseline-member-add')?.value || '';
    if (!userId) {
      notify('Wähle zuerst ein aktuell boostendes Mitglied aus.', 'info');
      return;
    }
    openBoostBaselineMember(userId);
  });
  $('#boost-activity-preview')?.addEventListener('click', () => {
    clearTimeout(boostActivityPreviewTimer);
    void previewBoostActivity();
  });
  $('#boost-activity-apply')?.addEventListener('click', () => void applyBoostActivity());
  $('#boost-activity-text')?.addEventListener('input', () => {
    clearTimeout(boostActivityPreviewTimer);
    boostActivityPreviewRequestId += 1;
    boostActivityPreviewText = '';
    const applyButton = $('#boost-activity-apply');
    if (applyButton) applyButton.disabled = true;
    const result = $('#boost-activity-result');
    const text = String($('#boost-activity-text')?.value || '').trim();
    if (result) {
      result.className = 'boost-activity-result';
      result.textContent = text ? 'Liste geändert · automatische Prüfung läuft …' : 'Noch keine Liste geprüft.';
    }
    if (text) boostActivityPreviewTimer = setTimeout(() => void previewBoostActivity({ automatic: true }), 900);
  });
  $('#guild-select')?.addEventListener('change', () => {
    clearTimeout(boostActivityPreviewTimer);
    boostActivityPreviewRequestId += 1;
    managementRequestId += 1;
    memberRequestId += 1;
    memberDetailRequestId += 1;
    channelLoadRequestId += 1;
    roleLoadRequestId += 1;
    currentManagement = null;
    hasRenderedMembers = false;
    boostActivityPreviewText = '';
    boostBaselineQuery = '';
    selectedMember = null;
    memberPage = 0;
    if (isCommunityVisible()) void loadManagement(true);
  });
  $('#channel-search')?.addEventListener('input', (event) => currentManagement && renderStructure(currentManagement, event.target.value));
  $('#member-search')?.addEventListener('input', (event) => { clearTimeout(memberTimer); memberPage = 0; memberTimer = setTimeout(() => loadMembers(event.target.value), 280); });
  $('#member-filter')?.addEventListener('change', (event) => { memberFilter = event.target.value; memberPage = 0; loadMembers($('#member-search')?.value || ''); });
  $('#member-sort')?.addEventListener('change', (event) => { memberSort = event.target.value; memberPage = 0; loadMembers($('#member-search')?.value || ''); });
  $('#member-page-size')?.addEventListener('change', (event) => { memberPageSize = Number(event.target.value || 25); memberPage = 0; loadMembers($('#member-search')?.value || ''); });
  $('#member-sync')?.addEventListener('click', () => loadMembers($('#member-search')?.value || '', true));
  $('#member-pagination')?.addEventListener('click', (event) => { const button = event.target.closest('[data-member-page]'); if (!button || button.disabled) return; memberPage = Math.max(0, Number(button.dataset.memberPage || 0)); loadMembers($('#member-search')?.value || ''); });
  $('#community-members')?.addEventListener('click', (event) => { const row = event.target.closest('[data-member-id]'); if (row) loadMemberDetails(row.dataset.memberId); });
  $('#member-detail')?.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove-role]');
    if (remove) { askMemberAction('removeRole', 'Rolle entfernen', { roleId: remove.dataset.removeRole }); return; }
    const button = event.target.closest('[data-member-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.memberAction;
    if (action === 'addRole') {
      const roleId = $('#member-role-select')?.value;
      if (roleId) askMemberAction('addRole', 'Rolle hinzufügen', { roleId });
      return;
    }
    const labels = { timeout: 'Timeout setzen', removeTimeout: 'Timeout entfernen', kick: 'Mitglied kicken', ban: 'Mitglied bannen' };
    askMemberAction(action, labels[action] || 'Aktion bestätigen');
  });
  $('#member-dialog-cancel')?.addEventListener('click', () => { pendingMemberAction = null; $('#member-action-dialog')?.close(); });
  $('#member-dialog-confirm')?.addEventListener('click', executeMemberAction);
  $('#community-channels')?.addEventListener('click', (event) => { const button = event.target.closest('[data-channel-id]'); if (button) loadChannel(button.dataset.channelId); });
  $('#community-roles')?.addEventListener('click', (event) => { const button = event.target.closest('[data-role-id]'); if (button) loadRole(button.dataset.roleId); });
  window.addEventListener('fallen-heaven:channel-live-update', (event) => {
    if (!selectedChannelId || String(event.detail?.channelId || '') !== String(selectedChannelId)) return;
    clearTimeout(channelLiveRefreshTimer);
    channelLiveRefreshTimer = setTimeout(() => refreshSelectedChannelMessages(true), 180);
  });
  window.addEventListener('fallen-heaven:channel-structure-update', (event) => {
    const events = Array.isArray(event.detail) ? event.detail : [];
    const id = guildId();
    if (!id || !events.some((item) => String(item?.guildId || '') === id)) return;
    cache.delete(id);
    if (isCommunityVisible()) void loadManagement(true);
  });
  $('#channel-messages')?.addEventListener('focusout', () => {
    if (!channelRenderPending) return;
    setTimeout(() => {
      const target = $('#channel-messages');
      if (!channelRenderPending || target?.contains(document.activeElement)) return;
      commitChannelLiveRender();
    }, 80);
  });
  $('#channel-messages')?.addEventListener('click', async (event) => {
    const forumBack = event.target.closest('[data-forum-back]');
    if (forumBack) {
      loadChannel(forumBack.dataset.forumBack);
      return;
    }
    const forumThread = event.target.closest('[data-forum-thread-id]');
    if (forumThread) {
      loadChannel(forumThread.dataset.forumThreadId);
      return;
    }
    const jumpLive = event.target.closest('[data-channel-jump-live]');
    if (jumpLive) {
      await loadChannel(selectedChannelId, '', 1);
      return;
    }
    const windowControl = event.target.closest('[data-channel-window]');
    if (windowControl) {
      channelWindowStart = windowControl.dataset.channelWindow === 'previous'
        ? Math.max(0, channelWindowStart - CHANNEL_DOM_LIMIT)
        : Math.min(Math.max(0, channelRows.length - 1), channelWindowStart + CHANNEL_DOM_LIMIT);
      renderChannelMessages();
      const target = $('#channel-messages');
      if (target) target.scrollTop = windowControl.dataset.channelWindow === 'previous' ? 0 : target.scrollHeight;
      return;
    }
    const pageControl = event.target.closest('[data-channel-page]');
    if (pageControl && !pageControl.disabled) {
      const page = Math.max(1, Math.min(Number(channelTotalPages || 1), Number(pageControl.dataset.channelPage) || 1));
      await loadChannel(selectedChannelId, '', page);
      const target = $('#channel-messages');
      if (target) target.scrollTop = 0;
      return;
    }
    const nextHistoryPage = event.target.closest('[data-channel-load-next-page]');
    if (nextHistoryPage && !nextHistoryPage.disabled && channelBefore) {
      const matchingButtons = Array.from(document.querySelectorAll('[data-channel-load-next-page]'));
      matchingButtons.forEach((button) => {
        button.disabled = true;
        button.classList.add('loading');
      });
      await loadChannel(nextHistoryPage.dataset.channelLoadNextPage, channelBefore);
      return;
    }
    const topicEmoji = event.target.closest('[data-channel-topic-emoji]');
    if (topicEmoji) {
      const textarea = topicEmoji.closest('[data-channel-form]')?.elements?.topic;
      if (textarea && typeof window.fallenHeavenOpenEmojiPicker === 'function') window.fallenHeavenOpenEmojiPicker(textarea);
      return;
    }
    const insertCounter = event.target.closest('[data-insert-counter-variable]');
    if (insertCounter) {
      const form = insertCounter.closest('[data-channel-form]');
      const textarea = form?.elements.topic;
      const reference = String(form?.elements.counterVariableChannel?.value || '');
      const variable = reference ? `{chat.count.${reference}}` : '{chat.count}';
      if (textarea) {
        const start = textarea.selectionStart ?? textarea.value.length;
        const end = textarea.selectionEnd ?? start;
        textarea.setRangeText(variable, start, end, 'end');
        textarea.focus();
      }
      return;
    }
    const loadAllForum = event.target.closest('[data-load-all-forum-posts]');
    if (loadAllForum && channelBefore) {
      await loadAllForumPosts(loadAllForum);
      return;
    }
    const older = event.target.closest('[data-load-older]');
    if (older && channelBefore) { loadChannel(older.dataset.loadOlder, channelBefore); return; }
    const copy = event.target.closest('[data-copy-message]');
    if (copy) {
      const message = channelRows.find((item) => item.id === copy.dataset.copyMessage);
      if (!message) return;
      try { await navigator.clipboard.writeText(message.content || JSON.stringify(message, null, 2)); toast('Nachricht wurde kopiert.', 'success'); } catch { toast('Nachricht konnte nicht kopiert werden.', 'error'); }
      return;
    }
    const useWelcome = event.target.closest('[data-use-welcome-message]');
    if (useWelcome) {
      const message = channelRows.find((item) => item.id === useWelcome.dataset.useWelcomeMessage);
      if (message) await useMessageAsWelcome(message, useWelcome);
      return;
    }
    const copyEmbed = event.target.closest('[data-copy-embed]');
    if (copyEmbed) {
      const message = channelRows.find((item) => item.id === copyEmbed.dataset.copyEmbed);
      const embed = message?.embeds?.[Number(copyEmbed.dataset.embedIndex || 0)];
      if (!message || !embed) return;
      state.activeStudioMessageId = message.canEdit && (message.embeds?.length || 0) === 1 ? message.id : '';
      const outsideImageUrl = firstImageAttachmentUrl(message?.attachments || []) || '';
      loadStudioTemplate({ channelId: selectedChannelId, content: message.content || '', embed: { title: embed.title || '', url: embed.url || '', description: embed.description || '', color: embed.color || '#5865f2', authorName: embed.author || '', authorIconUrl: embed.authorIcon || '', thumbnailUrl: embed.thumbnail || '', imageUrl: embed.image || '', outsideImageUrl, footerText: embed.footer || '', footerIconUrl: embed.footerIcon || '', timestamp: Boolean(embed.timestamp), timestampValue: embed.timestamp || '', fields: embed.fields || [] } });
      renderDrafts();
      setView('studio');
      toast(message.canEdit ? 'Bot-Embed wurde zum Bearbeiten ins Studio geladen.' : 'Embed wurde als neuer Studio-Entwurf übernommen.', 'success');
      return;
    }
    const copyAllEmbeds = event.target.closest('[data-copy-all-embeds]');
    if (copyAllEmbeds) {
      const message = channelRows.find((item) => item.id === copyAllEmbeds.dataset.copyAllEmbeds);
      if (!message?.embeds?.length) return;
      const outsideImage = firstImageAttachmentUrl(message?.attachments || []);
      const embeds = message.embeds.map((embed, index) => ({
        title: embed.title || '', url: embed.url || '', description: embed.description || '', color: embed.color || '#5865f2',
        authorName: embed.author || '', authorIconUrl: embed.authorIcon || '', thumbnailUrl: embed.thumbnail || '', imageUrl: embed.image || '',
        outsideImageUrl: index === 0 ? outsideImage : '', footerText: embed.footer || '', footerIconUrl: embed.footerIcon || '',
        timestamp: Boolean(embed.timestamp), timestampValue: embed.timestamp || '', fields: embed.fields || []
      }));
      const roleMentions = [];
      const reactionSource = [message.content || ''].concat(message.embeds.flatMap((embed) => [embed.title || '', embed.description || '', ...(embed.fields || []).flatMap((field) => [field.name || '', field.value || ''])])).join('\n');
      for (const match of reactionSource.matchAll(/<@&(\d+)>/g)) {
        if (!roleMentions.includes(match[1])) roleMentions.push(match[1]);
      }
      const group = `copied-message-${message.id}`;
      const reactionRoles = (message.reactions || []).map((reaction, index) => {
        const normalizedEmojiName = String(reaction.name || '').toLocaleLowerCase('de').replace(/[^a-z0-9äöüß]+/g, '');
        const matchingRole = state.moduleRoles.find((role) => {
          const normalizedRoleName = String(role.name || '').toLocaleLowerCase('de').replace(/[^a-z0-9äöüß]+/g, '');
          return normalizedEmojiName && normalizedRoleName && (normalizedRoleName.includes(normalizedEmojiName) || normalizedEmojiName.includes(normalizedRoleName));
        });
        return {
          emoji: reaction.emoji || reaction.identifier || reaction.name || '', emojiId: reaction.id || '', emojiName: reaction.name || '',
          animated: Boolean(reaction.animated), url: reaction.url || '', count: reaction.count || 0,
          roleId: roleMentions[index] || matchingRole?.id || '', exclusive: true, group
        };
      });
      state.activeStudioMessageId = message.canEdit ? message.id : '';
      loadStudioTemplate({ channelId: selectedChannelId, content: message.content || '', embed: embeds[0], embeds, reactionRoles });
      renderDrafts();
      setView('studio');
      const fieldCount = embeds.reduce((sum, embed) => sum + embed.fields.length, 0);
      const mapped = reactionRoles.filter((entry) => entry.roleId).length;
      toast(`${embeds.length} Embeds, alle Bilder und ${reactionRoles.length} Reaktionen wurden übernommen. ${mapped} Rollen konnten automatisch zugeordnet werden.`, 'success');
      return;
    }
    const edit = event.target.closest('[data-edit-message]');
    if (edit) { const form = $(`[data-message-edit-form="${edit.dataset.editMessage}"]`); if (form) { form.hidden = false; form.querySelector('textarea')?.focus(); } return; }
    const cancel = event.target.closest('[data-cancel-message-edit]');
    if (cancel) { const form = $(`[data-message-edit-form="${cancel.dataset.cancelMessageEdit}"]`); if (form) form.hidden = true; return; }
    const remove = event.target.closest('[data-delete-message]');
    if (remove) {
      if (remove.dataset.confirm !== '1') {
        remove.dataset.confirm = '1';
        remove.textContent = 'Wirklich löschen?';
        remove.classList.add('armed');
        setTimeout(() => { if (remove.isConnected) { remove.dataset.confirm = ''; remove.textContent = 'Löschen'; remove.classList.remove('armed'); } }, 4500);
        return;
      }
      remove.disabled = true;
      remove.textContent = 'Wird gelöscht ...';
      try {
        await request(`/api/guild/${encodeURIComponent(guildId())}/channel/${encodeURIComponent(selectedChannelId)}/message/${encodeURIComponent(remove.dataset.deleteMessage)}`, { method: 'DELETE' });
        channelRows = channelRows.filter((item) => item.id !== remove.dataset.deleteMessage);
        renderChannelMessages();
        toast('Nachricht wurde aus Discord gelöscht.', 'success');
      } catch (error) { remove.disabled = false; remove.textContent = error.message; }
    }
  });
  $('#channel-messages')?.addEventListener('submit', async (event) => {
    const channelForm = event.target.closest('[data-channel-form]');
    if (channelForm) {
      event.preventDefault();
      const button = channelForm.querySelector('button[type="submit"]');
      if (button) { button.disabled = true; button.textContent = 'Wird gespeichert ...'; }
      try {
        const topicTemplate = channelForm.elements.topic.value;
        const containsCounterVariable = /\{chat\.count(?:\.[^}]+)?\}/i.test(topicTemplate);
        const counterToggle = channelForm.elements.messageCounterEnabled;
        const body = {
          name: channelForm.elements.name.value,
          topic: topicTemplate,
          rateLimitPerUser: Number(channelForm.elements.rateLimitPerUser.value || 0),
          nsfw: channelForm.elements.nsfw.checked
        };
        if (counterToggle) {
          body.messageCounter = {
            enabled: counterToggle.checked || containsCounterVariable,
            template: topicTemplate,
            syncIntervalMinutes: Number(channelForm.elements.messageCounterIntervalMinutes?.value || 10)
          };
        }
        const data = await request(`/api/guild/${encodeURIComponent(guildId())}/channel/${encodeURIComponent(channelForm.dataset.channelForm)}`, { method: 'PATCH', body });
        selectedChannelMeta = data.channel;
        cache.delete(guildId());
        renderChannelMessages();
        toast(data.channel?.syncPending ? 'Gespeichert. Discord wird im Hintergrund synchronisiert.' : 'Kanaleinstellungen wurden mit Discord synchronisiert.', 'success');
      } catch (error) { if (button) { button.disabled = false; button.textContent = error.message; } }
      return;
    }
    const messageForm = event.target.closest('[data-message-edit-form]');
    if (messageForm) {
      event.preventDefault();
      const button = messageForm.querySelector('button[type="submit"]');
      if (button) { button.disabled = true; button.textContent = 'Wird gespeichert ...'; }
      try {
        const data = await request(`/api/guild/${encodeURIComponent(guildId())}/channel/${encodeURIComponent(selectedChannelId)}/message/${encodeURIComponent(messageForm.dataset.messageEditForm)}`, { method: 'PATCH', body: { content: messageForm.elements.content.value } });
        const message = channelRows.find((item) => item.id === messageForm.dataset.messageEditForm);
        if (message) { message.content = data.message.content; message.editedAt = data.message.editedAt; }
        renderChannelMessages();
        toast('Bot-Nachricht wurde in Discord bearbeitet.', 'success');
      } catch (error) { if (button) { button.disabled = false; button.textContent = error.message; } }
      return;
    }
    const form = event.target.closest('[data-role-form]');
    if (!form) return;
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    if (button) { button.disabled = true; button.textContent = 'Wird gespeichert ...'; }
    try {
      const body = { name: form.elements.name.value, color: form.elements.color.value, hoist: form.elements.hoist.checked, mentionable: form.elements.mentionable.checked };
      await request(`/api/guild/${encodeURIComponent(guildId())}/role/${encodeURIComponent(form.dataset.roleForm)}`, { method: 'PATCH', body });
      cache.delete(guildId());
      await loadManagement(true);
      await loadRole(form.dataset.roleForm);
    } catch (error) {
      if (button) { button.disabled = false; button.textContent = error.message; }
    }
  });
  document.addEventListener('click', (event) => { const target = event.target.closest('[data-open-url]'); if (target) { event.preventDefault(); api.openExternal(target.dataset.openUrl); } });
})();

