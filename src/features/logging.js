import { AuditLogEvent, EmbedBuilder, PermissionFlagsBits } from 'discord.js';

const COLORS = {
  create: 0x55e6a5,
  update: 0x8b82ff,
  delete: 0xff6584,
  member: 0x55c8ff,
  voice: 0xf0b84b
};

const text = (value, maximum = 900) => {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '—';
  return normalized.length > maximum ? `${normalized.slice(0, maximum - 1)}…` : normalized;
};
const roleMentions = (ids) => ids.length ? ids.slice(0, 20).map((id) => `<@&${id}>`).join(', ') : '—';
const settings = (cfg) => cfg?.logging || {};
const ignoredChannel = (channelId, cfg) => {
  const conf = settings(cfg);
  return String(channelId || '') === String(conf.channelId || '') || (conf.ignoredChannelIds || []).map(String).includes(String(channelId || ''));
};

const recentAuditActor = async (guild, type, targetId) => {
  if (!guild?.members?.me?.permissions?.has?.(PermissionFlagsBits.ViewAuditLog)) return null;
  const logs = await guild.fetchAuditLogs({ type, limit: 6 }).catch(() => null);
  const now = Date.now();
  const entry = logs?.entries?.find?.((item) =>
    String(item.target?.id || item.targetId || '') === String(targetId || '')
    && Math.abs(now - Number(item.createdTimestamp || 0)) <= 15_000
  );
  return entry?.executor || null;
};

const sendLog = async ({ guild, cfg, title, summary = '', color = COLORS.update, fields = [], footer = '' }) => {
  const conf = settings(cfg);
  const channelId = String(conf.channelId || '').trim();
  if (!conf.enabled || !channelId) return;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: 'FALLEN HEAVEN · SERVERPROTOKOLL' })
    .setTitle(text(title, 250))
    .setTimestamp();
  if (summary) embed.setDescription(text(summary, 4000));
  if (fields.length) embed.addFields(fields.filter(Boolean).slice(0, 25).map((field) => ({
    name: text(field.name, 250),
    value: text(field.value, 1000),
    inline: Boolean(field.inline)
  })));
  if (footer) embed.setFooter({ text: text(footer, 2000) });
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
};

const actorField = (actor) => actor ? { name: 'Ausgeführt von', value: `${actor} · \`${actor.id}\``, inline: true } : null;
const messageEvidence = (message, cfg) => {
  const conf = settings(cfg);
  const fields = [
    { name: 'Mitglied', value: message.author ? `${message.author} · \`${message.author.id}\`` : 'Nicht im Cache', inline: true },
    { name: 'Kanal', value: `<#${message.channelId}>`, inline: true },
    { name: 'Nachricht', value: `\`${message.id || 'unbekannt'}\``, inline: true }
  ];
  if (conf.includeMessageContent === true) fields.push({ name: 'Inhalt', value: text(message.content || '(kein Text)', 1000) });
  fields.push({ name: 'Anhänge', value: String(message.attachments?.size || 0), inline: true });
  return fields;
};

export const feature = {
  id: 'logging',
  name: 'Serverprotokoll',
  commands: [],

  async onMessageDelete({ message, cfg }) {
    const conf = settings(cfg);
    if (!conf.enabled || !conf.logMessages || !message.guild || ignoredChannel(message.channelId, cfg)) return;
    await sendLog({
      guild: message.guild,
      cfg,
      title: 'Nachricht gelöscht',
      color: COLORS.delete,
      fields: messageEvidence(message, cfg),
      footer: conf.includeMessageContent === true ? 'Nachrichteninhalt wird nach deiner Einstellung protokolliert.' : 'Datensparsam: Nachrichteninhalt ist deaktiviert.'
    });
  },

  async onMessageBulkDelete({ messages, channel, cfg }) {
    const conf = settings(cfg);
    if (!conf.enabled || !conf.logMessages || !channel?.guild || ignoredChannel(channel.id, cfg)) return;
    await sendLog({ guild: channel.guild, cfg, title: 'Nachrichten gesammelt gelöscht', color: COLORS.delete, fields: [
      { name: 'Kanal', value: `<#${channel.id}>`, inline: true },
      { name: 'Anzahl', value: String(messages?.size || 0), inline: true }
    ], footer: 'Bulk-Logs speichern bewusst keine vollständigen Chat-Inhalte.' });
  },

  async onMessageUpdate({ oldMessage, newMessage, cfg }) {
    const conf = settings(cfg);
    if (!conf.enabled || !conf.logMessages || !newMessage.guild || ignoredChannel(newMessage.channelId, cfg)) return;
    const before = String(oldMessage?.content || '');
    const after = String(newMessage?.content || '');
    if (before === after) return;
    const fields = messageEvidence(newMessage, cfg);
    if (conf.includeMessageContent === true) fields.push(
      { name: 'Vorher', value: text(before || '(kein Text)', 1000) },
      { name: 'Nachher', value: text(after || '(kein Text)', 1000) }
    );
    await sendLog({ guild: newMessage.guild, cfg, title: 'Nachricht bearbeitet', color: COLORS.update, fields,
      footer: conf.includeMessageContent === true ? 'Inhalte werden gekürzt und lokal nicht zusätzlich gespeichert.' : 'Datensparsam: Nur Metadaten werden protokolliert.' });
  },

  async onGuildMemberAdd({ member, cfg }) {
    const conf = settings(cfg);
    if (!conf.enabled || !conf.logMembers) return;
    const ageDays = member.user?.createdTimestamp ? Math.floor((Date.now() - member.user.createdTimestamp) / 86_400_000) : null;
    await sendLog({ guild: member.guild, cfg, title: 'Mitglied beigetreten', color: COLORS.create, fields: [
      { name: 'Mitglied', value: `${member.user} · \`${member.id}\``, inline: true },
      { name: 'Kontoalter', value: ageDays === null ? 'Unbekannt' : `${ageDays} Tage`, inline: true },
      { name: 'Mitgliederstand', value: String(member.guild.memberCount || '—'), inline: true }
    ] });
  },

  async onGuildMemberRemove({ member, cfg }) {
    const conf = settings(cfg);
    if (!conf.enabled || !conf.logMembers) return;
    const actor = await recentAuditActor(member.guild, AuditLogEvent.MemberKick, member.id);
    await sendLog({ guild: member.guild, cfg, title: actor ? 'Mitglied entfernt' : 'Mitglied ausgetreten', color: COLORS.delete, fields: [
      { name: 'Mitglied', value: `${member.user?.tag || member.id} · \`${member.id}\``, inline: true },
      actorField(actor),
      { name: 'Rollen beim Austritt', value: roleMentions(member.roles?.cache?.filter?.((role) => role.id !== member.guild.id)?.map?.((role) => role.id) || []) }
    ] });
  },

  async onGuildMemberUpdate({ oldMember, newMember, cfg }) {
    const conf = settings(cfg);
    if (!conf.enabled) return;
    const fields = [{ name: 'Mitglied', value: `${newMember.user} · \`${newMember.id}\``, inline: true }];
    let changed = false;
    if (conf.logRoles) {
      const before = new Set(oldMember.roles.cache.keys());
      const after = new Set(newMember.roles.cache.keys());
      const gained = [...after].filter((id) => id !== newMember.guild.id && !before.has(id));
      const removed = [...before].filter((id) => id !== newMember.guild.id && !after.has(id));
      if (gained.length || removed.length) {
        changed = true;
        fields.push({ name: 'Hinzugefügt', value: roleMentions(gained) }, { name: 'Entfernt', value: roleMentions(removed) });
      }
    }
    if (conf.logMembers && oldMember.nickname !== newMember.nickname) {
      changed = true;
      fields.push({ name: 'Nickname', value: `${text(oldMember.nickname || 'Keiner', 400)} → ${text(newMember.nickname || 'Keiner', 400)}` });
    }
    if (conf.logModeration && Number(oldMember.communicationDisabledUntilTimestamp || 0) !== Number(newMember.communicationDisabledUntilTimestamp || 0)) {
      changed = true;
      const until = Number(newMember.communicationDisabledUntilTimestamp || 0);
      fields.push({ name: 'Timeout', value: until > Date.now() ? `Aktiv bis <t:${Math.floor(until / 1000)}:F>` : 'Aufgehoben' });
    }
    if (!changed) return;
    const actor = await recentAuditActor(newMember.guild, AuditLogEvent.MemberRoleUpdate, newMember.id)
      || await recentAuditActor(newMember.guild, AuditLogEvent.MemberUpdate, newMember.id);
    fields.push(actorField(actor));
    await sendLog({ guild: newMember.guild, cfg, title: 'Mitglied aktualisiert', color: COLORS.update, fields });
  },

  async onChannelCreate({ channel, cfg }) {
    const conf = settings(cfg);
    if (!conf.enabled || !conf.logChannels || ignoredChannel(channel.id, cfg)) return;
    const actor = await recentAuditActor(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
    await sendLog({ guild: channel.guild, cfg, title: 'Kanal erstellt', color: COLORS.create, fields: [
      { name: 'Kanal', value: `${channel} · \`${channel.id}\``, inline: true },
      { name: 'Typ', value: String(channel.type), inline: true }, actorField(actor)
    ] });
  },

  async onChannelDelete({ channel, cfg }) {
    const conf = settings(cfg);
    if (!conf.enabled || !conf.logChannels || ignoredChannel(channel.id, cfg)) return;
    const actor = await recentAuditActor(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
    await sendLog({ guild: channel.guild, cfg, title: 'Kanal gelöscht', color: COLORS.delete, fields: [
      { name: 'Kanal', value: `${text(channel.name)} · \`${channel.id}\``, inline: true }, actorField(actor)
    ] });
  },

  async onChannelUpdate({ oldChannel, newChannel, cfg }) {
    const conf = settings(cfg);
    if (!conf.enabled || !conf.logChannels || ignoredChannel(newChannel.id, cfg)) return;
    const changes = [];
    if (oldChannel.name !== newChannel.name) changes.push(`Name: **${text(oldChannel.name, 100)}** → **${text(newChannel.name, 100)}**`);
    if (oldChannel.parentId !== newChannel.parentId) changes.push(`Kategorie: ${oldChannel.parentId ? `<#${oldChannel.parentId}>` : 'Keine'} → ${newChannel.parentId ? `<#${newChannel.parentId}>` : 'Keine'}`);
    if (oldChannel.topic !== newChannel.topic) changes.push('Thema wurde geändert.');
    if (oldChannel.position !== newChannel.position) changes.push(`Position: ${oldChannel.position} → ${newChannel.position}`);
    if (!changes.length) return;
    const actor = await recentAuditActor(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id);
    await sendLog({ guild: newChannel.guild, cfg, title: 'Kanal aktualisiert', color: COLORS.update, summary: changes.join('\n'), fields: [
      { name: 'Kanal', value: `${newChannel} · \`${newChannel.id}\``, inline: true }, actorField(actor)
    ] });
  },

  async onRoleCreate({ role, cfg }) {
    const conf = settings(cfg);
    if (!conf.enabled || !conf.logRoles) return;
    const actor = await recentAuditActor(role.guild, AuditLogEvent.RoleCreate, role.id);
    await sendLog({ guild: role.guild, cfg, title: 'Rolle erstellt', color: COLORS.create, fields: [
      { name: 'Rolle', value: `${role} · \`${role.id}\``, inline: true }, actorField(actor)
    ] });
  },

  async onRoleDelete({ role, cfg }) {
    const conf = settings(cfg);
    if (!conf.enabled || !conf.logRoles) return;
    const actor = await recentAuditActor(role.guild, AuditLogEvent.RoleDelete, role.id);
    await sendLog({ guild: role.guild, cfg, title: 'Rolle gelöscht', color: COLORS.delete, fields: [
      { name: 'Rolle', value: `${text(role.name)} · \`${role.id}\``, inline: true }, actorField(actor)
    ] });
  },

  async onRoleUpdate({ oldRole, newRole, cfg }) {
    const conf = settings(cfg);
    if (!conf.enabled || !conf.logRoles) return;
    const changes = [];
    if (oldRole.name !== newRole.name) changes.push(`Name: **${text(oldRole.name, 100)}** → **${text(newRole.name, 100)}**`);
    if (oldRole.color !== newRole.color) changes.push(`Farbe: ${oldRole.hexColor} → ${newRole.hexColor}`);
    if (oldRole.position !== newRole.position) changes.push(`Position: ${oldRole.position} → ${newRole.position}`);
    if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) changes.push('Berechtigungen wurden geändert.');
    if (!changes.length) return;
    const actor = await recentAuditActor(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
    await sendLog({ guild: newRole.guild, cfg, title: 'Rolle aktualisiert', color: COLORS.update, summary: changes.join('\n'), fields: [
      { name: 'Rolle', value: `${newRole} · \`${newRole.id}\``, inline: true }, actorField(actor)
    ] });
  },

  async onVoiceStateUpdate({ oldState, newState, cfg }) {
    const conf = settings(cfg);
    if (!conf.enabled || !conf.logVoice || oldState.channelId === newState.channelId) return;
    const member = newState.member || oldState.member;
    const movement = !oldState.channelId ? `beigetreten: <#${newState.channelId}>`
      : !newState.channelId ? `verlassen: <#${oldState.channelId}>`
        : `verschoben: <#${oldState.channelId}> → <#${newState.channelId}>`;
    await sendLog({ guild: member.guild, cfg, title: 'Voice-Status geändert', color: COLORS.voice, fields: [
      { name: 'Mitglied', value: `${member.user} · \`${member.id}\``, inline: true },
      { name: 'Änderung', value: movement }
    ] });
  }
};

export const _loggingInternals = { text, roleMentions, ignoredChannel };
