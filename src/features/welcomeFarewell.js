import { EmbedBuilder } from 'discord.js';

import { applyManagedRolePolicy } from '../runtime/managedRoleService.js';
import { isAllowedEmbedImageUrl, readLocalImage } from '../runtime/localImageStore.js';
import { quietLog, QUIET_LOG_SCOPE } from '../runtime/quietLog.js';

const postVerificationReconciles = new Map();
const postVerificationFingerprints = new Map();
const POST_VERIFICATION_CONCURRENCY = 4;

const postVerificationSettings = (conf = {}) => ({
  enabled: conf?.postVerificationRolesEnabled === true,
  unverifiedRoleId: String(conf?.verificationRoleId || '').trim(),
  roleIds: [...new Set((Array.isArray(conf?.postVerificationRoleIds) ? conf.postVerificationRoleIds : [])
    .map((entry) => String(entry?.id || entry || '').trim())
    .filter(Boolean))]
});

const postVerificationFingerprint = (conf = {}) => {
  const settings = postVerificationSettings(conf);
  return JSON.stringify({
    moduleEnabled: conf?.enabled !== false,
    enabled: settings.enabled,
    unverifiedRoleId: settings.unverifiedRoleId,
    roleIds: [...settings.roleIds].sort()
  });
};

function formatTemplate(template, guild, user, extras = {}) {
  const mention = user?.id ? `<@${user.id}>` : '';
  let text = String(Array.isArray(template) ? template.join('\n') : template || '')
    .replaceAll('{user}', mention)
    .replaceAll('{usermention}', mention)
    .replaceAll('${usermention}', mention)
    .replaceAll('{username}', user?.username || '')
    .replaceAll('{nickname}', user?.displayName || user?.globalName || user?.username || '')
    .replaceAll('${usernickname}', user?.displayName || user?.globalName || user?.username || '')
    .replaceAll('{guild}', guild?.name || 'Server');
  for (const [key, value] of Object.entries(extras || {})) {
    // Erst ${key} (mit Dollar-Präfix) ersetzen, sonst matcht {key} als Teilstring
    // von ${key} und hinterlässt ein störendes '$'.
    text = text.replaceAll('${' + key + '}', String(value ?? '')).replaceAll('{' + key + '}', String(value ?? ''));
  }
  return text;
}

const parseColor = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const normalized = String(value || '').trim().replace(/^#/, '');
  return /^[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized, 16) : 0x58b9ff;
};

const welcomeEmbeds = (template, guild, user, extras = {}) => {
  const sources = Array.isArray(template?.embeds) && template.embeds.length
    ? template.embeds
    : template?.embed && typeof template.embed === 'object' ? [template.embed] : [];
  return sources.slice(0, 10).map((source = {}) => {
    const embed = new EmbedBuilder().setColor(parseColor(source.color));
    const title = formatTemplate(source.title, guild, user, extras).slice(0, 256);
    const description = formatTemplate(source.description, guild, user, extras).slice(0, 4096);
    if (title) embed.setTitle(title);
    if (title && /^https?:\/\//i.test(String(source.url || ''))) embed.setURL(String(source.url));
    if (description) embed.setDescription(description);
    // Discord rendert in der Autor-Zeile KEINE Mentions – ein {user} dort würde
    // als roher Text (<@id>) erscheinen. Wie im Call-Moderation-Embed wird
    // {user}/{usermention} in der Autor-Zeile deshalb als Klarname ({nickname})
    // behandelt; echte Mentions gehören in Beschreibung/Felder. ${usermention}
    // wird zuerst ersetzt, damit kein störendes '$' übrig bleibt.
    const authorName = formatTemplate(String(source.authorName || source.author?.name || '')
      .replaceAll('${usermention}', '{nickname}')
      .replaceAll('{usermention}', '{nickname}')
      .replaceAll('{user}', '{nickname}'), guild, user, extras).slice(0, 256);
    const authorIcon = String(source.authorIconUrl || source.author?.icon_url || source.author?.iconURL || '');
    if (authorName) embed.setAuthor({ name: authorName, iconURL: /^https?:\/\//i.test(authorIcon) ? authorIcon : undefined });
    const imageUrl = String(source.imageUrl || source.image?.url || '');
    const thumbnailUrl = String(source.thumbnailUrl || source.thumbnail?.url || '');
    // Discord-CDN-URLs (cdn.discordapp.com) werden NIE ins Embed geschrieben –
    // das ergibt den hässlichen Link. Sie stammen aus früheren Uploads und
    // gehören als echter Anhang auf die Nachricht, nicht ins Embed.
    if (isAllowedEmbedImageUrl(imageUrl)) embed.setImage(imageUrl);
    if (isAllowedEmbedImageUrl(thumbnailUrl)) embed.setThumbnail(thumbnailUrl);
    const footerText = formatTemplate(source.footerText || source.footer?.text, guild, user, extras).slice(0, 2048);
    const footerIcon = String(source.footerIconUrl || source.footer?.icon_url || source.footer?.iconURL || '');
    if (footerText) embed.setFooter({ text: footerText, iconURL: /^https?:\/\//i.test(footerIcon) ? footerIcon : undefined });
    if (source.timestamp === true) embed.setTimestamp(new Date());
    const fields = (Array.isArray(source.fields) ? source.fields : []).slice(0, 25).map((field) => ({
      name: formatTemplate(field?.name, guild, user, extras).slice(0, 256) || '\u200b',
      value: formatTemplate(field?.value, guild, user, extras).slice(0, 1024) || '\u200b',
      inline: field?.inline === true
    }));
    if (fields.length) embed.addFields(fields);
    return embed;
  });
};

const buildWelcomePayload = async (guild, user, conf, extras = {}) => {
  const template = conf?.welcomeTemplate && typeof conf.welcomeTemplate === 'object' ? conf.welcomeTemplate : null;
  const embeds = welcomeEmbeds(template, guild, user, extras);
  const templateContent = template ? formatTemplate(template.content, guild, user, extras) : '';
  const fallbackContent = formatTemplate(conf?.welcomeMessage, guild, user, extras);
  // Außenbild: NIE als sichtbarer Link in den Nachrichtentext – stattdessen als
  // echter Discord-Anhang (Datei-Upload). Zuerst wird eine lokal gespeicherte
  // Studio-Datei (localAsset) verwendet, sonst eine URL heruntergeladen.
  // Schlägt beides fehl, wird die Nachricht ohne Bild gesendet (Welcome ist ein
  // Event, kein persistentes Panel).
  let files = null;
  const outsideAttachment = template?.outsideImageAttachment && typeof template.outsideImageAttachment === 'object'
    ? template.outsideImageAttachment
    : null;
  const outsideImageUrl = String(template?.outsideImageUrl || '').trim();
  if (outsideAttachment?.localAsset === true) {
    const local = await readLocalImage(outsideAttachment).catch(() => null);
    if (local?.buffer?.length) {
      files = [{ attachment: local.buffer, name: String(local.name || 'fallen-heaven-welcome.png') }];
    }
  } else if (/^https?:\/\//i.test(outsideImageUrl)) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(outsideImageUrl, { signal: controller.signal });
      if (response.ok) {
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length && buffer.length <= 25 * 1024 * 1024) {
          const safeName = String(template.outsideImageName || 'fallen-heaven-welcome.png').replace(/[^a-z0-9._-]/gi, '_').slice(-120);
          files = [{ attachment: buffer, name: safeName }];
        }
      }
    } catch (error) {
      files = null;
    } finally {
      clearTimeout(timeout);
    }
  }
  const content = [templateContent || (!embeds.length ? fallbackContent : '')]
    .filter(Boolean).join('\n').slice(0, 2000);
  return {
    content: content || undefined,
    embeds,
    files,
    allowedMentions: { parse: ['users'], roles: [], repliedUser: false }
  };
};

const refreshWelcomeAssetUrls = async (guild, template) => {
  const sourceChannelId = String(template?.sourceChannelId || '').trim();
  const sourceMessageId = String(template?.sourceMessageId || '').trim();
  if (!guild || !sourceChannelId || !sourceMessageId) return template;
  const channel = guild.channels.cache.get(sourceChannelId) || await guild.channels.fetch(sourceChannelId).catch(() => null);
  const sourceMessage = await channel?.messages?.fetch?.(sourceMessageId).catch(() => null);
  if (!sourceMessage) return template;
  const refreshed = JSON.parse(JSON.stringify(template || {}));
  const sources = Array.isArray(refreshed.embeds) ? refreshed.embeds : [];
  sources.forEach((embed, index) => {
    const live = sourceMessage.embeds?.[index];
    if (!live) return;
    if (live.image?.url) embed.imageUrl = live.image.url;
    if (live.thumbnail?.url) embed.thumbnailUrl = live.thumbnail.url;
    if (live.author?.iconURL) embed.authorIconUrl = live.author.iconURL;
    if (live.footer?.iconURL) embed.footerIconUrl = live.footer.iconURL;
  });
  const outsideImage = sourceMessage.attachments?.find?.((attachment) => /^image\//i.test(String(attachment.contentType || '')))?.url;
  if (outsideImage) refreshed.outsideImageUrl = outsideImage;
  return refreshed;
};

const send = async (guild, channelId, payload) => {
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  await channel.send(typeof payload === 'string'
    ? { content: payload, allowedMentions: { parse: ['users'], roles: [], repliedUser: false } }
    : payload)
    .catch((error) => quietLog(QUIET_LOG_SCOPE.welcomeFarewell, error, `Welcome/Farewell-Send fehlgeschlagen: Kanal ${channelId}`));
};

const verificationRoleWasRemoved = (oldMember, newMember, roleId) => {
  const resolvedRoleId = String(roleId || '').trim();
  if (!resolvedRoleId || !oldMember?.roles?.cache || !newMember?.roles?.cache) return false;
  return oldMember.roles.cache.has(resolvedRoleId) && !newMember.roles.cache.has(resolvedRoleId);
};

const missingPostVerificationRoles = (member, conf) => {
  const settings = postVerificationSettings(conf);
  if (!settings.enabled || !settings.unverifiedRoleId || !settings.roleIds.length || !member?.guild || member.user?.bot) return [];
  if (member.roles.cache.has(settings.unverifiedRoleId)) return [];
  return settings.roleIds.filter((roleId) => !member.roles.cache.has(roleId));
};

const assignPostVerificationRoles = async (member, conf, source = 'Rollenentzug') => {
  const roleIds = missingPostVerificationRoles(member, conf);
  if (!roleIds.length) return { changed: false, addedRoleIds: [], blocked: [] };
  const result = await applyManagedRolePolicy({
    member,
    addRoleIds: roleIds,
    reason: `Welcome-Modul · Rollen nach Verifizierung · ${source}`,
    verify: true,
    requireAll: false,
    skipFresh: true
  });
  if (result.blocked?.length) {
    quietLog(
      QUIET_LOG_SCOPE.welcomeFarewell,
      new Error(result.blocked.map((entry) => entry.reason).join(' ')),
      `Rollen nach Verifizierung teilweise blockiert: User ${member.id}`
    );
  }
  return result;
};

const reconcilePostVerificationRoles = async (guild, conf, source = 'Startabgleich') => {
  const settings = postVerificationSettings(conf);
  if (!guild || !settings.enabled || !settings.unverifiedRoleId || !settings.roleIds.length) {
    return { scanned: 0, eligible: 0, changed: 0, failed: 0 };
  }
  const fingerprint = postVerificationFingerprint(conf);
  const running = postVerificationReconciles.get(guild.id);
  if (running?.fingerprint === fingerprint) return running.promise;
  if (running?.promise) {
    await running.promise;
    return reconcilePostVerificationRoles(guild, conf, source);
  }

  const job = (async () => {
    await guild.members.fetch().catch((error) => {
      quietLog(QUIET_LOG_SCOPE.welcomeFarewell, error, `Mitglieder für Verifizierungsabgleich laden fehlgeschlagen: Server ${guild.id}`);
    });
    const members = [...guild.members.cache.values()];
    const candidates = members.filter((member) => missingPostVerificationRoles(member, conf).length > 0);
    let cursor = 0;
    let changed = 0;
    let failed = 0;
    const worker = async () => {
      while (cursor < candidates.length) {
        const member = candidates[cursor];
        cursor += 1;
        try {
          const result = await assignPostVerificationRoles(member, conf, source);
          if (result.changed) changed += 1;
        } catch (error) {
          failed += 1;
          quietLog(QUIET_LOG_SCOPE.welcomeFarewell, error, `Rollen nach Verifizierung fehlgeschlagen: User ${member.id}`);
        }
      }
    };
    await Promise.all(Array.from(
      { length: Math.min(POST_VERIFICATION_CONCURRENCY, candidates.length) },
      () => worker()
    ));
    return { scanned: members.length, eligible: candidates.length, changed, failed };
  })().finally(() => {
    if (postVerificationReconciles.get(guild.id)?.promise === job) postVerificationReconciles.delete(guild.id);
  });

  postVerificationReconciles.set(guild.id, { fingerprint, promise: job });
  return job;
};

const sendWelcome = async (member, conf) => {
  if (!conf?.welcomeEnabled || !member?.guild || member.user?.bot) return false;
  const templateUser = { ...member.user, displayName: member.displayName || member.user?.globalName || member.user?.username };
  const liveTemplate = await refreshWelcomeAssetUrls(member.guild, conf.welcomeTemplate);
  await send(member.guild, conf.welcomeChannelId, await buildWelcomePayload(member.guild, templateUser, { ...conf, welcomeTemplate: liveTemplate }));
  return true;
};

export const feature = {
  id: 'welcomeFarewell',
  name: 'Welcome/Farewell',
  commands: [],

  async onClientReady({ guild, cfg }) {
    const conf = cfg?.welcomeFarewell;
    postVerificationFingerprints.set(guild.id, postVerificationFingerprint(conf));
    if (!conf?.enabled) return;
    await reconcilePostVerificationRoles(guild, conf, 'Startabgleich');
  },

  async onGuildMemberAdd({ member, cfg }) {
    const conf = cfg?.welcomeFarewell;
    if (!conf?.enabled || !member?.guild) return;

    if (conf.welcomeEnabled && conf.welcomeAfterVerification !== true) {
      await sendWelcome(member, conf);
    }

    if (conf.autoRoleEnabled && conf.autoRoleName) {
      const configuredRole = String(conf.autoRoleName || '').trim();
      const role = member.guild.roles.cache.get(configuredRole)
        || member.guild.roles.cache.find((entry) => entry.name === configuredRole);
      if (role) {
        await applyManagedRolePolicy({
          member,
          addRoleIds: [role.id],
          reason: 'Welcome-Modul · ausgewählte Beitrittsrolle',
          verify: true,
          requireAll: true
        }).catch((error) => console.warn(`[welcomeFarewell] Rolle für ${member.user?.tag || member.id} nicht vergeben: ${error?.message || error}`));
      }
    }
  },

  async onGuildMemberUpdate({ oldMember, newMember, cfg }) {
    const conf = cfg?.welcomeFarewell;
    if (!conf?.enabled) return;
    if (!newMember?.guild || newMember.user?.bot) return;
    if (!verificationRoleWasRemoved(oldMember, newMember, conf.verificationRoleId)) return;

    if (conf.postVerificationRolesEnabled === true) {
      await assignPostVerificationRoles(newMember, conf, 'Unverified-Rolle entfernt')
        .catch((error) => quietLog(QUIET_LOG_SCOPE.welcomeFarewell, error, `Rollen nach Verifizierung fehlgeschlagen: User ${newMember.id}`));
    }
    if (conf.welcomeEnabled && conf.welcomeAfterVerification === true) await sendWelcome(newMember, conf);
  },

  async onConfigUpdate({ guild, cfg, patch }) {
    if (!patch || !Object.prototype.hasOwnProperty.call(patch, 'welcomeFarewell')) return;
    const conf = cfg?.welcomeFarewell;
    const fingerprint = postVerificationFingerprint(conf);
    if (postVerificationFingerprints.get(guild.id) === fingerprint) return;
    postVerificationFingerprints.set(guild.id, fingerprint);
    if (!conf?.enabled) return;
    await reconcilePostVerificationRoles(guild, conf, 'Konfigurationsabgleich');
  },

  async onGuildMemberRemove({ member, cfg }) {
    const conf = cfg?.welcomeFarewell;
    if (!conf?.enabled || !conf.farewellEnabled) return;
    await send(member.guild, conf.farewellChannelId, formatTemplate(conf.farewellMessage, member.guild, member.user));
  }
};

export const _welcomeFarewellInternals = {
  formatTemplate,
  buildWelcomePayload,
  welcomeEmbeds,
  refreshWelcomeAssetUrls,
  verificationRoleWasRemoved,
  postVerificationSettings,
  postVerificationFingerprint,
  missingPostVerificationRoles,
  assignPostVerificationRoles,
  reconcilePostVerificationRoles,
  sendWelcome
};
