import { EmbedBuilder } from 'discord.js';

import { applyManagedRolePolicy } from '../runtime/managedRoleService.js';

const timers = new Map();
const scanJobs = new Map();
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const boundedInteger = (value, fallback, minimum, maximum) => {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
};
const settings = (cfg) => ({
  enabled: cfg?.autoRole?.enabled === true,
  excludeBots: cfg?.autoRole?.excludeBots !== false,
  roleIds: [...new Set((cfg?.autoRole?.roleIds || []).map(String).filter(Boolean))],
  assignmentDelaySeconds: boundedInteger(cfg?.autoRole?.assignmentDelaySeconds, 2, 0, 120),
  retryCount: boundedInteger(cfg?.autoRole?.retryCount, 3, 1, 5),
  reconcileOnStartup: cfg?.autoRole?.reconcileOnStartup === true,
  maxStartupAssignments: boundedInteger(cfg?.autoRole?.maxStartupAssignments, 100, 1, 1000),
  logChannelId: String(cfg?.autoRole?.logChannelId || '').trim()
});

const sendLog = async (guild, conf, title, description, color = 0x8b82ff) => {
  if (!conf.logChannelId) return;
  const channel = guild.channels.cache.get(conf.logChannelId) || await guild.channels.fetch(conf.logChannelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  await channel.send({ embeds: [new EmbedBuilder().setColor(color).setAuthor({ name: 'FALLEN HEAVEN · AUTOROLE' }).setTitle(title).setDescription(description).setTimestamp()], allowedMentions: { parse: [] } }).catch(() => null);
};

const assignRoles = async (member, conf, source) => {
  if (!conf.enabled || !conf.roleIds.length || !member?.guild || (conf.excludeBots && member.user?.bot)) return null;
  let lastError = null;
  for (let attempt = 1; attempt <= conf.retryCount; attempt += 1) {
    try {
      return await applyManagedRolePolicy({
        member,
        addRoleIds: conf.roleIds,
        reason: `AutoRole · ${source} · Versuch ${attempt}`,
        verify: true,
        requireAll: true
      });
    } catch (error) {
      lastError = error;
      if (attempt < conf.retryCount) await delay(750 * attempt);
    }
  }
  await sendLog(member.guild, conf, 'Rollenvergabe fehlgeschlagen', `<@${member.id}> · ${String(lastError?.message || lastError || 'Unbekannter Fehler').slice(0, 800)}`, 0xff6584);
  throw lastError;
};

const scheduleMember = (member, cfg, source = 'Beitritt') => {
  const conf = settings(cfg);
  if (!conf.enabled || !conf.roleIds.length || (conf.excludeBots && member.user?.bot)) return;
  const key = `${member.guild.id}:${member.id}`;
  clearTimeout(timers.get(key));
  const timer = setTimeout(() => {
    timers.delete(key);
    void assignRoles(member, conf, source).catch(() => null);
  }, conf.assignmentDelaySeconds * 1000);
  timer.unref?.();
  timers.set(key, timer);
};

const runStartupReconcile = async (guild, cfg) => {
  const conf = settings(cfg);
  if (!conf.enabled || !conf.reconcileOnStartup || !conf.roleIds.length || scanJobs.has(guild.id)) return;
  const job = (async () => {
    await guild.members.fetch().catch(() => null);
    let attemptedMembers = 0;
    let changedMembers = 0;
    let failedMembers = 0;
    for (const member of guild.members.cache.values()) {
      if (attemptedMembers >= conf.maxStartupAssignments) break;
      if (conf.excludeBots && member.user?.bot) continue;
      if (conf.roleIds.every((roleId) => member.roles.cache.has(roleId))) continue;
      attemptedMembers += 1;
      try {
        const result = await assignRoles(member, { ...conf, retryCount: 1 }, 'Startabgleich');
        if (result?.changed) changedMembers += 1;
      } catch {
        failedMembers += 1;
      }
      await delay(180);
    }
    await sendLog(guild, conf, 'Startabgleich abgeschlossen', `${attemptedMembers} geprüft · ${changedMembers} Mitglied(er) ergänzt · ${failedMembers} Fehler · Sicherheitslimit ${conf.maxStartupAssignments}.`, failedMembers ? 0xffbd59 : 0x55e6a5);
  })().finally(() => scanJobs.delete(guild.id));
  scanJobs.set(guild.id, job);
  return job;
};

export const feature = {
  id: 'autoRole',
  name: 'AutoRole',
  commands: [],
  async onClientReady({ guild, cfg }) {
    void runStartupReconcile(guild, cfg).catch(() => null);
  },
  async onGuildMemberAdd({ member, cfg }) {
    scheduleMember(member, cfg, 'Neues Mitglied');
  },
  async onConfigUpdate({ guild, cfg, patch }) {
    if (!patch || !Object.prototype.hasOwnProperty.call(patch, 'autoRole')) return;
    void runStartupReconcile(guild, cfg).catch(() => null);
  }
};

export const _autoRoleInternals = { settings, assignRoles };
