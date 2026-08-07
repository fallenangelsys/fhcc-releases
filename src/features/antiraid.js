import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';

const guildStates = new Map();

const boundedInteger = (value, fallback, minimum, maximum) => {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
};

const normalizeSettings = (cfg) => {
  const conf = cfg?.antiraid || {};
  const requestedAction = String(conf.action || 'observe');
  return {
    enabled: conf.enabled === true,
    joinThreshold: boundedInteger(conf.joinThreshold, 10, 3, 100),
    joinWindowSeconds: boundedInteger(conf.joinWindowSeconds, 60, 5, 600),
    shieldMinutes: boundedInteger(conf.shieldMinutes, 10, 1, 180),
    action: ['observe', 'quarantine', 'timeout'].includes(requestedAction) ? requestedAction : 'observe',
    actionDurationMinutes: boundedInteger(conf.actionDurationMinutes, 15, 1, 40_320),
    recentAccountDays: boundedInteger(conf.recentAccountDays, 7, 0, 3650),
    onlyRecentAccounts: conf.onlyRecentAccounts === true,
    quarantineRoleId: String(conf.quarantineRoleId || '').trim(),
    whitelistRoleIds: [...new Set((conf.whitelistRoleIds || []).map(String).filter(Boolean))],
    trustedUserIds: [...new Set((conf.trustedUserIds || []).map(String).filter(Boolean))],
    logChannelId: String(conf.logChannelId || '').trim()
  };
};

const stateFor = (guildId) => {
  if (!guildStates.has(guildId)) guildStates.set(guildId, { joins: [], shieldUntil: 0, lastAlertAt: 0, affected: new Set() });
  return guildStates.get(guildId);
};

const accountAgeDays = (user, now = Date.now()) => {
  const created = Number(user?.createdTimestamp || user?.createdAt?.getTime?.() || 0);
  return created > 0 ? Math.max(0, (now - created) / 86_400_000) : Number.POSITIVE_INFINITY;
};

const isTrusted = (member, settings) => {
  if (!member || member.user?.bot || member.id === member.guild.ownerId) return true;
  if (settings.trustedUserIds.includes(String(member.id))) return true;
  return member.roles?.cache?.some?.((role) => settings.whitelistRoleIds.includes(String(role.id))) || false;
};

const isEligible = (member, settings, now = Date.now()) => {
  if (isTrusted(member, settings)) return false;
  return !settings.onlyRecentAccounts || accountAgeDays(member.user, now) <= settings.recentAccountDays;
};

const sendLog = async ({ guild, settings, title, description, color = 0xffbd59, fields = [] }) => {
  if (!settings.logChannelId) return;
  const channel = guild.channels.cache.get(settings.logChannelId) || await guild.channels.fetch(settings.logChannelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: 'FALLEN HEAVEN · RAID-SCHUTZ' })
    .setTitle(title)
    .setDescription(description)
    .addFields(fields)
    .setFooter({ text: 'Kein automatischer Kick oder Bann' })
    .setTimestamp();
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
};

const applyShieldAction = async (member, settings, reason) => {
  if (!isEligible(member, settings)) return { applied: false, action: 'ignored', reason: 'Vertrauensregel oder Kontenalter' };
  if (settings.action === 'observe') return { applied: false, action: 'observe' };

  let quarantineApplied = false;
  if (settings.quarantineRoleId) {
    const role = member.guild.roles.cache.get(settings.quarantineRoleId);
    if (role?.editable && !member.roles.cache.has(role.id)) {
      await member.roles.add(role, reason).then(() => { quarantineApplied = true; }).catch(() => null);
    }
  }

  if (settings.action === 'quarantine') {
    return quarantineApplied
      ? { applied: true, action: 'quarantine' }
      : { applied: false, action: 'quarantine', reason: 'Quarantäne-Rolle fehlt oder ist nicht verwaltbar.' };
  }

  const canTimeout = member.guild.members.me?.permissions?.has?.(PermissionFlagsBits.ModerateMembers);
  if (!canTimeout || !member.moderatable || typeof member.timeout !== 'function') {
    return { applied: quarantineApplied, action: quarantineApplied ? 'quarantine' : 'timeout', reason: 'Timeout ist wegen Berechtigungen oder Rollenhierarchie nicht möglich.' };
  }
  await member.timeout(settings.actionDurationMinutes * 60_000, reason);
  return { applied: true, action: 'timeout', minutes: settings.actionDurationMinutes, quarantineApplied };
};

const cleanupState = (state, now, windowMs) => {
  state.joins = state.joins.filter((entry) => now - entry.at <= windowMs);
  if (state.shieldUntil <= now) state.affected.clear();
};

export const feature = {
  id: 'antiraid',
  name: 'Raid-Schutz',
  commands: [],

  async onGuildMemberAdd({ member, cfg }) {
    const settings = normalizeSettings(cfg);
    if (!settings.enabled || !member?.guild || member.user?.bot) return;

    const now = Date.now();
    const windowMs = settings.joinWindowSeconds * 1000;
    const state = stateFor(member.guild.id);
    cleanupState(state, now, windowMs);
    state.joins.push({ at: now, member });

    const shieldWasActive = state.shieldUntil > now;
    const thresholdReached = state.joins.length >= settings.joinThreshold;
    if (!shieldWasActive && !thresholdReached) return;

    if (thresholdReached && !shieldWasActive) state.shieldUntil = now + settings.shieldMinutes * 60_000;
    const candidates = thresholdReached && !shieldWasActive ? state.joins.map((entry) => entry.member) : [member];
    const results = [];
    for (const candidate of candidates) {
      if (!candidate || state.affected.has(candidate.id)) continue;
      state.affected.add(candidate.id);
      const result = await applyShieldAction(candidate, settings, `Automatischer Raid-Schutz · ${state.joins.length} Beitritte in ${settings.joinWindowSeconds} Sekunden`)
        .catch((error) => ({ applied: false, action: settings.action, reason: error?.message || String(error) }));
      results.push({ memberId: candidate.id, ...result });
    }

    if (!shieldWasActive || now - state.lastAlertAt >= 60_000) {
      state.lastAlertAt = now;
      const applied = results.filter((result) => result.applied).length;
      const ignored = results.filter((result) => result.action === 'ignored').length;
      await sendLog({
        guild: member.guild,
        settings,
        title: shieldWasActive ? 'Weiterer Beitritt während Schutzphase' : 'Ungewöhnliche Beitrittswelle erkannt',
        description: `In ${settings.joinWindowSeconds} Sekunden wurden **${state.joins.length} Beitritte** erkannt. Die Schutzphase läuft bis <t:${Math.floor(state.shieldUntil / 1000)}:T>.`,
        color: settings.action === 'observe' ? 0x8b82ff : 0xff5d78,
        fields: [
          { name: 'Modus', value: settings.action === 'observe' ? 'Nur beobachten' : settings.action === 'quarantine' ? 'Quarantäne-Rolle' : 'Discord-Timeout', inline: true },
          { name: 'Angewendet', value: String(applied), inline: true },
          { name: 'Sicher ignoriert', value: String(ignored), inline: true }
        ]
      });
    }
  },

  async onConfigUpdate({ guild, patch }) {
    if (!patch || !Object.prototype.hasOwnProperty.call(patch, 'antiraid')) return;
    guildStates.delete(guild.id);
  }
};

export const _antiraidInternals = {
  normalizeSettings,
  accountAgeDays,
  isEligible,
  cleanupState
};
