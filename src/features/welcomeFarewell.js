import { EmbedBuilder } from 'discord.js';

import { applyManagedRolePolicy } from '../runtime/managedRoleService.js';

function formatTemplate(template, guild, user) {
  const mention = user?.id ? `<@${user.id}>` : '';
  return String(Array.isArray(template) ? template.join('\n') : template || '')
    .replaceAll('{user}', mention)
    .replaceAll('{usermention}', mention)
    .replaceAll('${usermention}', mention)
    .replaceAll('{username}', user?.username || '')
    .replaceAll('{nickname}', user?.displayName || user?.globalName || user?.username || '')
    .replaceAll('${usernickname}', user?.displayName || user?.globalName || user?.username || '')
    .replaceAll('{guild}', guild?.name || 'Server');
}

const parseColor = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const normalized = String(value || '').trim().replace(/^#/, '');
  return /^[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized, 16) : 0x58b9ff;
};

const welcomeEmbeds = (template, guild, user) => {
  const sources = Array.isArray(template?.embeds) && template.embeds.length
    ? template.embeds
    : template?.embed && typeof template.embed === 'object' ? [template.embed] : [];
  return sources.slice(0, 10).map((source = {}) => {
    const embed = new EmbedBuilder().setColor(parseColor(source.color));
    const title = formatTemplate(source.title, guild, user).slice(0, 256);
    const description = formatTemplate(source.description, guild, user).slice(0, 4096);
    if (title) embed.setTitle(title);
    if (title && /^https?:\/\//i.test(String(source.url || ''))) embed.setURL(String(source.url));
    if (description) embed.setDescription(description);
    const authorName = formatTemplate(source.authorName || source.author?.name, guild, user).slice(0, 256);
    const authorIcon = String(source.authorIconUrl || source.author?.icon_url || source.author?.iconURL || '');
    if (authorName) embed.setAuthor({ name: authorName, iconURL: /^https?:\/\//i.test(authorIcon) ? authorIcon : undefined });
    const imageUrl = String(source.imageUrl || source.image?.url || '');
    const thumbnailUrl = String(source.thumbnailUrl || source.thumbnail?.url || '');
    if (/^https?:\/\//i.test(imageUrl)) embed.setImage(imageUrl);
    if (/^https?:\/\//i.test(thumbnailUrl)) embed.setThumbnail(thumbnailUrl);
    const footerText = formatTemplate(source.footerText || source.footer?.text, guild, user).slice(0, 2048);
    const footerIcon = String(source.footerIconUrl || source.footer?.icon_url || source.footer?.iconURL || '');
    if (footerText) embed.setFooter({ text: footerText, iconURL: /^https?:\/\//i.test(footerIcon) ? footerIcon : undefined });
    if (source.timestamp === true) embed.setTimestamp(new Date());
    const fields = (Array.isArray(source.fields) ? source.fields : []).slice(0, 25).map((field) => ({
      name: formatTemplate(field?.name, guild, user).slice(0, 256) || '\u200b',
      value: formatTemplate(field?.value, guild, user).slice(0, 1024) || '\u200b',
      inline: field?.inline === true
    }));
    if (fields.length) embed.addFields(fields);
    return embed;
  });
};

const buildWelcomePayload = (guild, user, conf) => {
  const template = conf?.welcomeTemplate && typeof conf.welcomeTemplate === 'object' ? conf.welcomeTemplate : null;
  const embeds = welcomeEmbeds(template, guild, user);
  const templateContent = template ? formatTemplate(template.content, guild, user) : '';
  const fallbackContent = formatTemplate(conf?.welcomeMessage, guild, user);
  const outsideImageUrl = String(template?.outsideImageUrl || '').trim();
  const content = [templateContent || (!embeds.length ? fallbackContent : ''), /^https?:\/\//i.test(outsideImageUrl) ? outsideImageUrl : '']
    .filter(Boolean).join('\n').slice(0, 2000);
  return {
    content: content || undefined,
    embeds,
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
    : payload).catch(() => null);
};

const verificationRoleWasRemoved = (oldMember, newMember, roleId) => {
  const resolvedRoleId = String(roleId || '').trim();
  if (!resolvedRoleId || !oldMember?.roles?.cache || !newMember?.roles?.cache) return false;
  return oldMember.roles.cache.has(resolvedRoleId) && !newMember.roles.cache.has(resolvedRoleId);
};

const sendWelcome = async (member, conf) => {
  if (!conf?.welcomeEnabled || !member?.guild || member.user?.bot) return false;
  const templateUser = { ...member.user, displayName: member.displayName || member.user?.globalName || member.user?.username };
  const liveTemplate = await refreshWelcomeAssetUrls(member.guild, conf.welcomeTemplate);
  await send(member.guild, conf.welcomeChannelId, buildWelcomePayload(member.guild, templateUser, { ...conf, welcomeTemplate: liveTemplate }));
  return true;
};

export const feature = {
  id: 'welcomeFarewell',
  name: 'Welcome/Farewell',
  commands: [],

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
    if (!conf?.enabled || !conf.welcomeEnabled || conf.welcomeAfterVerification !== true) return;
    if (!newMember?.guild || newMember.user?.bot) return;
    if (!verificationRoleWasRemoved(oldMember, newMember, conf.verificationRoleId)) return;

    await sendWelcome(newMember, conf);
  },

  async onGuildMemberRemove({ member, cfg }) {
    const conf = cfg?.welcomeFarewell;
    if (!conf?.enabled || !conf.farewellEnabled) return;
    await send(member.guild, conf.farewellChannelId, formatTemplate(conf.farewellMessage, member.guild, member.user));
  }
};

export const _welcomeFarewellInternals = { formatTemplate, buildWelcomePayload, welcomeEmbeds, refreshWelcomeAssetUrls, verificationRoleWasRemoved, sendWelcome };
