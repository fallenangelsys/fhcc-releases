import path from 'node:path';
import process from 'node:process';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';

import { atomicWriteJson, readJsonWithRecovery } from '../runtime/atomicJsonStore.js';

const DATA_ROOT = process.env.FALLEN_HEAVEN_DATA_DIR || path.join(process.cwd(), 'data');
const TICKET_FILE = path.join(DATA_ROOT, 'tickets.json');
const panelLocks = new Map();
let mutationQueue = Promise.resolve();

const emptyStore = () => ({ version: 2, guilds: {} });
const normalizeStore = (value) => {
  const store = value && typeof value === 'object' ? value : emptyStore();
  store.version = 2;
  store.guilds = store.guilds && typeof store.guilds === 'object' ? store.guilds : {};
  for (const guild of Object.values(store.guilds)) {
    guild.tickets = Array.isArray(guild?.tickets) ? guild.tickets.slice(-5000) : [];
    guild.panelMessageId = String(guild?.panelMessageId || '');
    guild.sequence = Math.max(0, Math.floor(Number(guild?.sequence || 0)));
  }
  return store;
};
const loadStore = async () => normalizeStore((await readJsonWithRecovery(TICKET_FILE, { fallback: emptyStore(), backupLimit: 5 })).value);

export const getTicketMemberSummary = async ({ guildId, userId, cfg } = {}) => {
  const resolvedGuildId = String(guildId || '');
  const resolvedUserId = String(userId || '');
  if (!resolvedGuildId || !resolvedUserId) return null;
  await mutationQueue.catch(() => null);
  const store = await loadStore();
  const rows = (store.guilds?.[resolvedGuildId]?.tickets || []).filter((ticket) => String(ticket.userId || '') === resolvedUserId);
  const open = [...rows].reverse().find((ticket) => ticket.status === 'open') || null;
  const conf = settings(cfg);
  return {
    enabled: conf.enabled,
    panelChannelId: conf.panelChannelId,
    openTicket: open ? { id: String(open.id || ''), channelId: String(open.channelId || ''), createdAt: String(open.createdAt || '') } : null,
    totalCount: rows.length,
    closedCount: rows.filter((ticket) => ticket.status === 'closed').length
  };
};
const mutateStore = (worker) => {
  const operation = mutationQueue.catch(() => {}).then(async () => {
    const store = await loadStore();
    const result = await worker(store);
    await atomicWriteJson(TICKET_FILE, store, { backupLimit: 5 });
    return result;
  });
  mutationQueue = operation.catch(() => null);
  return operation;
};
const settings = (cfg) => {
  const conf = cfg?.tickets || {};
  return {
    enabled: conf.enabled === true,
    panelChannelId: String(conf.panelChannelId || '').trim(),
    panelTitle: String(conf.panelTitle || 'FALLEN HEAVEN Support').trim().slice(0, 256),
    panelDescription: String(conf.panelDescription || 'Öffne hier vertraulich ein Support-Ticket.').trim().slice(0, 4000),
    panelButtonLabel: String(conf.panelButtonLabel || 'Ticket öffnen').trim().slice(0, 80),
    panelButtonEmoji: String(conf.panelButtonEmoji || '🎫').trim(),
    supportRoleId: String(conf.supportRoleId || '').trim(),
    categoryId: String(conf.categoryId || '').trim(),
    threadParentChannelId: String(conf.threadParentChannelId || '').trim(),
    useThreadMode: conf.useThreadMode === true,
    oneOpenPerUser: conf.oneOpenPerUser !== false,
    closeArchive: conf.closeArchive !== false,
    closeMessage: String(conf.closeMessage || 'Das Ticket wurde geschlossen.').slice(0, 1000),
    logChannelId: String(conf.logChannelId || '').trim()
  };
};
const safeChannelName = (value) => String(value || 'ticket')
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'ticket';
const panelComponents = (conf) => [new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('fh_ticket:open').setLabel(conf.panelButtonLabel || 'Ticket öffnen').setEmoji(conf.panelButtonEmoji || '🎫').setStyle(ButtonStyle.Primary)
)];
const panelEmbed = (conf) => new EmbedBuilder()
  .setColor(0x8b82ff)
  .setAuthor({ name: 'FALLEN HEAVEN · SUPPORT' })
  .setTitle(conf.panelTitle)
  .setDescription(conf.panelDescription)
  .addFields(
    { name: 'Vertraulich', value: 'Dein Anliegen wird nur für dich und das Support-Team geöffnet.', inline: true },
    { name: 'Ohne Commands', value: 'Klicke auf die Schaltfläche und beschreibe dein Anliegen.', inline: true }
  )
  .setFooter({ text: 'Keine Direktnachrichten · ein nachvollziehbarer Ticketverlauf' });

const ensurePanel = async (guild, cfg) => {
  const conf = settings(cfg);
  if (!conf.enabled || !conf.panelChannelId) return null;
  if (panelLocks.has(guild.id)) return panelLocks.get(guild.id);
  const operation = (async () => {
    const channel = guild.channels.cache.get(conf.panelChannelId) || await guild.channels.fetch(conf.panelChannelId).catch(() => null);
    if (!channel?.isTextBased?.() || channel.isThread?.()) throw new Error('Der Ticket-Panel-Kanal ist nicht verfügbar.');
    const store = await loadStore();
    const entry = store.guilds[guild.id] || {};
    let message = entry.panelMessageId ? await channel.messages.fetch(entry.panelMessageId).catch(() => null) : null;
    const payload = { embeds: [panelEmbed(conf)], components: panelComponents(conf), allowedMentions: { parse: [] } };
    if (message?.editable) await message.edit(payload);
    else message = await channel.send(payload);
    await mutateStore((latest) => {
      latest.guilds[guild.id] ||= { tickets: [], sequence: 0, panelMessageId: '' };
      latest.guilds[guild.id].panelMessageId = message.id;
      return message.id;
    });
    return message;
  })().finally(() => panelLocks.delete(guild.id));
  panelLocks.set(guild.id, operation);
  return operation;
};

const findOpenTicket = async (guildId, userId, guild) => {
  await mutationQueue.catch(() => null);
  const store = await loadStore();
  const rows = store.guilds?.[guildId]?.tickets || [];
  const record = [...rows].reverse().find((ticket) => ticket.userId === userId && ticket.status === 'open');
  if (!record) return null;
  const channel = guild.channels.cache.get(record.channelId) || await guild.channels.fetch(record.channelId).catch(() => null);
  if (channel) return { record, channel };
  await mutateStore((latest) => {
    const stale = latest.guilds?.[guildId]?.tickets?.find((ticket) => ticket.id === record.id);
    if (stale) stale.status = 'missing';
  });
  return null;
};

const ticketCloseComponents = () => [new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('fh_ticket:close').setLabel('Ticket schließen').setEmoji('🔒').setStyle(ButtonStyle.Danger)
)];
const supportRole = (guild, conf) => conf.supportRoleId ? guild.roles.cache.get(conf.supportRoleId) || null : null;

const createTicketChannel = async ({ guild, user, conf, sequence, topic }) => {
  const name = `ticket-${String(sequence).padStart(4, '0')}-${safeChannelName(user.username)}`.slice(0, 95);
  if (conf.useThreadMode) {
    const parentId = conf.threadParentChannelId || conf.panelChannelId;
    const parent = guild.channels.cache.get(parentId) || await guild.channels.fetch(parentId).catch(() => null);
    if (!parent?.threads?.create) throw new Error('Der ausgewählte Thread-Elternkanal unterstützt keine privaten Threads.');
    const thread = await parent.threads.create({ name, type: ChannelType.PrivateThread, invitable: false, reason: `Support-Ticket von ${user.tag}` });
    await thread.members.add(user.id);
    const role = supportRole(guild, conf);
    if (role) {
      await guild.members.fetch().catch(() => null);
      for (const member of [...role.members.values()].slice(0, 50)) await thread.members.add(member.id).catch(() => null);
    }
    return thread;
  }
  const overwrites = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
    { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] }
  ];
  if (conf.supportRoleId) overwrites.push({ id: conf.supportRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] });
  return guild.channels.create({ name, type: ChannelType.GuildText, parent: conf.categoryId || undefined, topic: `Support-Ticket · ${user.id} · ${topic}`.slice(0, 1024), permissionOverwrites: overwrites, reason: `Support-Ticket von ${user.tag}` });
};

const logTicket = async (guild, conf, title, record, actorId = '') => {
  if (!conf.logChannelId) return;
  const channel = guild.channels.cache.get(conf.logChannelId) || await guild.channels.fetch(conf.logChannelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  await channel.send({ embeds: [new EmbedBuilder().setColor(record.status === 'open' ? 0x55e6a5 : 0xffbd59).setAuthor({ name: 'FALLEN HEAVEN · TICKETS' }).setTitle(title).addFields(
    { name: 'Ticket', value: `\`${record.id}\``, inline: true },
    { name: 'Mitglied', value: `<@${record.userId}>`, inline: true },
    { name: 'Kanal', value: `<#${record.channelId}>`, inline: true },
    { name: 'Thema', value: String(record.topic || 'Ohne Thema').slice(0, 1000) },
    ...(actorId ? [{ name: 'Bearbeitet von', value: `<@${actorId}>`, inline: true }] : [])
  ).setTimestamp()], allowedMentions: { parse: [] } }).catch(() => null);
};

const createTicket = async (interaction, cfg) => {
  const conf = settings(cfg);
  const existing = conf.oneOpenPerUser ? await findOpenTicket(interaction.guildId, interaction.user.id, interaction.guild) : null;
  if (existing) {
    await interaction.reply({ content: `Du hast bereits ein offenes Ticket: ${existing.channel}`, flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const topic = interaction.fields.getTextInputValue('topic').trim().slice(0, 200);
  const details = interaction.fields.getTextInputValue('details').trim().slice(0, 3500);
  let record;
  const reservation = await mutateStore((store) => {
    const guild = store.guilds[interaction.guildId] ||= { tickets: [], sequence: 0, panelMessageId: '' };
    if (conf.oneOpenPerUser && guild.tickets.some((ticket) => ticket.userId === interaction.user.id && ['pending', 'open'].includes(ticket.status))) {
      throw new Error('Für dieses Mitglied wird bereits ein Ticket erstellt oder es ist noch offen.');
    }
    guild.sequence += 1;
    const pending = {
      id: `FH-${String(guild.sequence).padStart(5, '0')}`,
      status: 'pending',
      userId: interaction.user.id,
      channelId: '',
      topic,
      createdAt: new Date().toISOString(),
      closedAt: null,
      closedBy: null
    };
    guild.tickets.push(pending);
    return { sequence: guild.sequence, id: pending.id };
  }).catch(async (error) => {
    await interaction.editReply({ content: `Das Ticket konnte nicht reserviert werden: ${error?.message || error}` });
    return null;
  });
  if (!reservation) return;
  try {
    const channel = await createTicketChannel({ guild: interaction.guild, user: interaction.user, conf, sequence: reservation.sequence, topic });
    record = {
      id: reservation.id,
      status: 'open',
      userId: interaction.user.id,
      channelId: channel.id,
      topic,
      createdAt: new Date().toISOString(),
      closedAt: null,
      closedBy: null
    };
    await mutateStore((store) => {
      const current = store.guilds?.[interaction.guildId]?.tickets?.find((ticket) => ticket.id === reservation.id);
      if (!current) throw new Error('Ticket-Reservierung wurde nicht gefunden.');
      Object.assign(current, record);
      return current;
    });
    const embed = new EmbedBuilder().setColor(0x8b82ff).setAuthor({ name: `FALLEN HEAVEN · ${record.id}` }).setTitle(topic || 'Support-Anfrage').setDescription(details || 'Keine weiteren Details angegeben.').addFields(
      { name: 'Erstellt von', value: `${interaction.user}`, inline: true },
      { name: 'Status', value: 'Offen', inline: true }
    ).setFooter({ text: 'Nutze die Schaltfläche zum sicheren Schließen.' }).setTimestamp();
    await channel.send({ content: `${interaction.user}${conf.supportRoleId ? ` · <@&${conf.supportRoleId}>` : ''}`, embeds: [embed], components: ticketCloseComponents(), allowedMentions: { users: [interaction.user.id], roles: conf.supportRoleId ? [conf.supportRoleId] : [] } });
    await logTicket(interaction.guild, conf, 'Ticket geöffnet', record);
    await interaction.editReply({ content: `Dein Ticket wurde erstellt: ${channel}` });
  } catch (error) {
    await mutateStore((store) => {
      const current = store.guilds?.[interaction.guildId]?.tickets?.find((ticket) => ticket.id === reservation.id);
      if (current && current.status === 'pending') {
        current.status = 'failed';
        current.error = String(error?.message || error).slice(0, 500);
      }
    }).catch(() => null);
    await interaction.editReply({ content: `Das Ticket konnte nicht erstellt werden: ${error?.message || error}` });
  }
};

const closeTicket = async (interaction, cfg) => {
  const conf = settings(cfg);
  const store = await loadStore();
  let record = [...(store.guilds?.[interaction.guildId]?.tickets || [])].reverse().find((ticket) => ticket.channelId === interaction.channelId && ticket.status === 'open');
  if (!record) {
    await interaction.reply({ content: 'Dieser Kanal ist kein offenes Ticket.', flags: MessageFlags.Ephemeral });
    return;
  }
  const staff = interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageChannels)
    || (conf.supportRoleId && interaction.member?.roles?.cache?.has?.(conf.supportRoleId));
  if (interaction.user.id !== record.userId && !staff) {
    await interaction.reply({ content: 'Nur der Ersteller oder das Support-Team kann dieses Ticket schließen.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  record = await mutateStore((latest) => {
    const current = latest.guilds?.[interaction.guildId]?.tickets?.find((ticket) => ticket.id === record.id);
    if (!current || current.status !== 'open') throw new Error('Das Ticket wurde bereits geschlossen.');
    current.status = 'closed';
    current.closedAt = new Date().toISOString();
    current.closedBy = interaction.user.id;
    return current;
  });
  await interaction.channel.send({ content: conf.closeMessage, allowedMentions: { parse: [] } }).catch(() => null);
  if (interaction.channel.isThread?.()) {
    await interaction.channel.setLocked(true, `Ticket ${record.id} geschlossen`).catch(() => null);
    if (conf.closeArchive) await interaction.channel.setArchived(true, `Ticket ${record.id} geschlossen`).catch(() => null);
  } else {
    await interaction.channel.permissionOverwrites.edit(record.userId, { SendMessages: false }, { reason: `Ticket ${record.id} geschlossen` }).catch(() => null);
    await interaction.channel.setName(`geschlossen-${safeChannelName(interaction.channel.name).replace(/^ticket-/, '')}`.slice(0, 95), `Ticket ${record.id} geschlossen`).catch(() => null);
  }
  await logTicket(interaction.guild, conf, 'Ticket geschlossen', record, interaction.user.id);
  await interaction.editReply({ content: `Ticket ${record.id} wurde geschlossen.` });
};

export const feature = {
  id: 'tickets',
  name: 'Support-Tickets',
  commands: [],
  async onClientReady({ guild, cfg }) {
    await ensurePanel(guild, cfg).catch((error) => console.warn(`[tickets] Panel für ${guild.name} nicht bereit: ${error?.message || error}`));
  },
  async onConfigUpdate({ guild, cfg, patch }) {
    if (!patch || !Object.prototype.hasOwnProperty.call(patch, 'tickets')) return;
    await ensurePanel(guild, cfg).catch((error) => console.warn(`[tickets] Panel-Update fehlgeschlagen: ${error?.message || error}`));
  },
  async onAnyInteraction({ interaction, cfg }) {
    const conf = settings(cfg);
    if (!conf.enabled || !interaction.inGuild?.()) return;
    if (interaction.isButton?.() && interaction.customId === 'fh_ticket:open') {
      const modal = new ModalBuilder().setCustomId('fh_ticket:create').setTitle('Support-Ticket öffnen').addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('topic').setLabel('Worum geht es?').setStyle(TextInputStyle.Short).setMaxLength(200).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('details').setLabel('Beschreibe dein Anliegen').setStyle(TextInputStyle.Paragraph).setMaxLength(3500).setRequired(true))
      );
      await interaction.showModal(modal);
      return;
    }
    if (interaction.isModalSubmit?.() && interaction.customId === 'fh_ticket:create') {
      await createTicket(interaction, cfg);
      return;
    }
    if (interaction.isButton?.() && interaction.customId === 'fh_ticket:close') await closeTicket(interaction, cfg);
  }
};

export const _ticketInternals = { settings, safeChannelName, normalizeStore };
