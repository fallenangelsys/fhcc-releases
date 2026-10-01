import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.FALLEN_HEAVEN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-level-balance-'));

const { _levelInternals } = await import('../src/features/levels.js');
const { normalizeConfig, featureCards } = await import('../src/defaultConfig.js');

const baseLevels = {
  enabled: true,
  balanceVersion: 'progressive-v1',
  xpPerMessage: 5,
  xpPerMessageMin: 5,
  xpPerMessageMax: 5,
  cooldownSeconds: 0,
  minMessageLength: 2,
  maxXpPerDay: 0,
  ignoredChannelIds: [],
  excludedRoleIds: [],
  noXpRoleIds: [],
  voiceXpPerMinute: 1,
  voiceMinimumParticipants: 2,
  excludeDeafenedVoice: true,
  levelRoleMappings: ['1=101', '20=120', '110=210']
};

const member = {
  id: 'u1',
  roles: { cache: { some: () => false } }
};

const message = (content, overrides = {}) => ({
  id: `m-${Math.random()}`,
  guild: { id: 'g1' },
  guildId: 'g1',
  author: { id: 'u1', bot: false },
  member,
  channel: { id: 'c1', parentId: '' },
  channelId: 'c1',
  content,
  attachments: new Map(),
  stickers: new Map(),
  webhookId: null,
  ...overrides
});

// Progressive Balance V1 curve.
assert.equal(_levelInternals.xpForLevel(0), 0);
assert.equal(_levelInternals.xpForLevel(1), 300);
assert.equal(_levelInternals.xpForLevel(5), 2_700);
assert.equal(_levelInternals.xpForLevel(10), 8_400);
assert.equal(_levelInternals.xpForLevel(20), 28_800);
assert.equal(_levelInternals.xpForLevel(40), 129_600);
assert.equal(_levelInternals.xpForLevel(60), 326_400);
assert.equal(_levelInternals.xpForLevel(80), 619_200);
assert.equal(_levelInternals.xpForLevel(100), 1_008_000);
assert.equal(_levelInternals.xpForLevel(110), 1_238_400);
assert.equal(_levelInternals.levelFromXp(1_238_399, 110), 109);
assert.equal(_levelInternals.levelFromXp(1_238_400, 110), 110);
assert.equal(_levelInternals.levelFromXp(99_999_999, 110), 110, 'Lifetime-XP steigt weiter, sichtbares Level bleibt am Rollenmaximum');
assert.equal(_levelInternals.configuredMaxLevel({ levelRoleMappings: ['5=1', '110=2', '40=3'] }), 110);
assert.equal(_levelInternals.configuredMaxLevel({ levelRoleMappings: [] }), 110, 'Ohne Rollen bleibt Level 110 der Kompatibilitaetswert');
const maxProgress = _levelInternals.levelProgressSnapshot({ xp: 2_000_000 }, baseLevels);
assert.equal(maxProgress.level, 110);
assert.equal(maxProgress.nextLevel, 'MAX');
assert.equal(maxProgress.isMaxLevel, true);
assert.equal(maxProgress.progress, 1);
assert.equal(maxProgress.xpNeeded, 0);
assert.equal(maxProgress.levelSpan, 0);

// A running voice timer must observe config changes without a bot restart.
{
  const runtimeGuild = { id: 'g-runtime-config' };
  const firstCfg = { levels: { ...baseLevels, voiceXpPerMinute: 1 } };
  const secondCfg = { levels: { ...baseLevels, voiceXpPerMinute: 3 } };
  const firstRuntime = _levelInternals.ensureLevelRuntime(runtimeGuild, firstCfg);
  const updatedRuntime = _levelInternals.ensureLevelRuntime(runtimeGuild, secondCfg);
  assert.equal(updatedRuntime, firstRuntime);
  assert.equal(updatedRuntime.cfg, secondCfg, 'Die bestehende Voice-Runtime muss nach Config-Updates die neue Config halten.');
}

// Legacy guild settings migrate once to the approved no-limit preset.
const normalized = normalizeConfig({
  levels: {
    xpPerMessageMin: 6,
    xpPerMessageMax: 16,
    cooldownSeconds: 60,
    maxXpPerDay: 900,
    voiceXpPerMinute: 2,
    activityBonusEnabled: true,
    activityBonusPlace1: 100,
    activityBonusPlace2: 70,
    activityBonusPlace3: 40,
    activityBonusMaxPerDay: 150,
    tagBonusXpPerDay: 30,
    boostBonusEnabled: true,
    boostBonusXpPerBoost: 10,
    boostBonusMaxPerDay: 40
  }
});
assert.equal(normalized.levels.balanceVersion, 'progressive-v1');
assert.equal(normalized.levels.xpPerMessage, 5);
assert.equal(normalized.levels.xpPerMessageMin, 5);
assert.equal(normalized.levels.xpPerMessageMax, 5);
assert.equal(normalized.levels.cooldownSeconds, 0);
assert.equal(normalized.levels.maxXpPerDay, 0);
assert.equal(normalized.levels.voiceXpPerMinute, 1);
assert.equal(normalized.levels.activityBonusEnabled, false);
assert.equal(normalized.levels.activityBonusPlace1, 0);
assert.equal(normalized.levels.tagBonusXpPerDay, 0);
assert.equal(normalized.levels.boostBonusEnabled, false);
assert.equal(normalized.levels.boostBonusXpPerBoost, 0);

const levelFields = featureCards.find((entry) => entry.id === 'levels')?.fields || [];
assert.ok(levelFields.some((field) => field.key === 'levels.xpPerMessage'), 'UI zeigt genau einen festen Nachrichten-XP-Wert');
for (const obsoleteKey of [
  'levels.xpPerMessageMin',
  'levels.xpPerMessageMax',
  'levels.cooldownSeconds',
  'levels.maxXpPerDay',
  'levels.levelCurveBase',
  'levels.activityBonusPlace1',
  'levels.activityBonusMaxPerDay'
]) {
  assert.equal(levelFields.some((field) => field.key === obsoleteKey), false, `${obsoleteKey} ist nicht mehr als tote/irrefuehrende Einstellung sichtbar`);
}

// Every different legitimate message is eligible immediately; recent copies are not.
{
  const cfg = { levels: { ...baseLevels } };
  const profile = _levelInternals.normalizeProfile({});
  const first = _levelInternals.shouldAward(message('erste echte nachricht'), cfg, profile, 1_000);
  assert.equal(first.ok, true);
  _levelInternals.recordAwardedFingerprint(profile, first.fingerprint, 1_000);
  const second = _levelInternals.shouldAward(message('zweite echte nachricht'), cfg, profile, 1_001);
  assert.equal(second.ok, true, 'Kein Cooldown zwischen unterschiedlichen legitimen Nachrichten');
  _levelInternals.recordAwardedFingerprint(profile, second.fingerprint, 1_001);
  const duplicate = _levelInternals.shouldAward(message(' ERSTE   echte Nachricht '), cfg, profile, 1_002);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.reason, 'duplicate', 'Auch abwechselnder Copy-Paste wird in der Historie erkannt');
  const punctuationDuplicate = _levelInternals.shouldAward(message('zweite echte nachricht!!!'), cfg, profile, 1_003);
  assert.equal(punctuationDuplicate.reason, 'duplicate', 'Reine Satzzeichen-Änderungen umgehen den Duplikatschutz nicht');
}

// Attachments and stickers count without text; bots/webhooks remain excluded.
{
  const cfg = { levels: { ...baseLevels } };
  const profile = _levelInternals.normalizeProfile({});
  const attachment = message('', { attachments: new Map([['a1', { id: 'a1' }]]) });
  assert.equal(_levelInternals.shouldAward(attachment, cfg, profile, 2_000).ok, true);
  const sticker = message('', { stickers: new Map([['s1', { id: 's1' }]]) });
  assert.equal(_levelInternals.shouldAward(sticker, cfg, profile, 2_001).ok, true);
  assert.equal(_levelInternals.shouldAward(message('webhook text', { webhookId: 'w1' }), cfg, profile, 2_002).ok, false);
}

// Interval-based Voice accounting preserves valid remainders and never back-credits invalid time.
{
  const state = { lastSettledAt: 1_000, voiceXpRemainder: 0 };
  assert.equal(_levelInternals.settleVoiceAccrual(state, { now: 31_000, eligible: true, xpPerMinute: 1 }), 0);
  assert.equal(state.voiceXpRemainder, 0.5);
  assert.equal(_levelInternals.settleVoiceAccrual(state, { now: 61_000, eligible: true, xpPerMinute: 1 }), 1);
  assert.equal(state.voiceXpRemainder, 0);
}
{
  const state = { lastSettledAt: 1_000, voiceXpRemainder: 0 };
  assert.equal(_levelInternals.settleVoiceAccrual(state, { now: 901_000, eligible: false, xpPerMinute: 1 }), 0);
  assert.equal(state.lastSettledAt, 901_000, 'Auch ungueltige Zeit schiebt den Abrechnungsanker weiter');
  assert.equal(_levelInternals.settleVoiceAccrual(state, { now: 961_000, eligible: true, xpPerMinute: 1 }), 1);
}
{
  const state = { lastSettledAt: 61_000, voiceXpRemainder: 0 };
  assert.equal(_levelInternals.settleVoiceAccrual(state, { now: 60_000, eligible: true, xpPerMinute: 1 }), 0);
  assert.equal(state.lastSettledAt, 61_000, 'Ein verspäteter Tick darf den Abrechnungsanker nicht zurücksetzen');
}

// Existing XP is retained exactly while stale levels are allowed to move down.
{
  const users = {
    a: _levelInternals.normalizeProfile({ xp: 35_200, level: 40 }),
    b: _levelInternals.normalizeProfile({ xp: 250_800, level: 110 }),
    c: _levelInternals.normalizeProfile({ xp: 99_999_999, level: 200 })
  };
  const report = _levelInternals.migrateProfilesForBalance(users, { ...baseLevels });
  assert.equal(users.a.xp, 35_200);
  assert.equal(users.a.level, 22);
  assert.equal(users.b.xp, 250_800);
  assert.equal(users.b.level, 53);
  assert.equal(users.c.level, 110);
  assert.equal(report.profiles, 3);
  assert.equal(report.lowered, 3);
  assert.equal(report.xpRetained, 100_285_999);
  const second = _levelInternals.migrateProfilesForBalance(users, { ...baseLevels });
  assert.equal(second.lowered, 0, 'Ein zweiter Lauf ist idempotent');
  assert.equal(second.unchanged, 3);
}

// Legacy caps and passive bonus sources cannot influence Balance V1 awards.
{
  const guild = { id: 'g-no-limit' };
  const xpMember = { id: 'u-no-limit', guild };
  const conf = {
    ...baseLevels,
    maxXpPerDay: 5,
    activityBonusMaxPerDay: 999,
    tagBonusXpPerDay: 999,
    boostBonusMaxPerDay: 999
  };
  const cfg = { general: { timezone: 'Europe/Berlin' }, levels: conf };
  const first = await _levelInternals.awardXp({ guild, member: xpMember, cfg, conf, amount: 10, source: 'message', silent: true });
  const second = await _levelInternals.awardXp({ guild, member: xpMember, cfg, conf, amount: 10, source: 'message', silent: true });
  assert.equal(first.amount, 10);
  assert.equal(second.amount, 10, 'Ein Legacy-Tageslimit darf neue Aktivitaet nicht deckeln');
  const beforePassive = second.profile.xp;
  for (const source of ['bonus', 'tag-bonus', 'boost-bonus']) {
    const passive = await _levelInternals.awardXp({ guild, member: xpMember, cfg, conf, amount: 999, source, silent: true });
    assert.equal(passive.amount, 0, `${source} erzeugt keine Level-XP mehr`);
  }
  assert.equal(second.profile.xp, beforePassive);
}

// Startup migration persists the recalculated level and reconciles managed roles.
{
  const roleConf = {
    ...baseLevels,
    noXpRoleIds: ['999'],
    cumulativeRoleRewards: false,
    levelRoleMappings: ['1=101', '20=120', '40=140', '110=210'],
    announce: false
  };
  const guild = {
    id: 'g-role-sync',
    roles: {
      cache: new Map(['101', '120', '140', '210', '999'].map((id, index) => [id, {
        id,
        name: `role-${id}`,
        managed: false,
        editable: true,
        position: index + 1
      }]))
    },
    members: {
      me: { id: 'bot', permissions: { has: () => true }, roles: { highest: { position: 99 } } },
      cache: new Map(),
      fetch: async () => new Map([['u-role', roleMember], ['u-no-xp-role', noXpRoleMember]])
    }
  };
  const roleMember = {
    id: 'u-role',
    user: { id: 'u-role', bot: false, tag: 'RoleUser' },
    guild,
    manageable: true,
    roles: {
      cache: new Map([['140', { id: '140' }]]),
      add: async (ids) => {
        for (const id of ids) roleMember.roles.cache.set(String(id), { id: String(id) });
        return roleMember;
      },
      remove: async (ids) => {
        for (const id of ids) roleMember.roles.cache.delete(String(id));
        return roleMember;
      }
    }
  };
  const noXpRoleMember = {
    id: 'u-no-xp-role',
    user: { id: 'u-no-xp-role', bot: false, tag: 'NoXpRoleUser' },
    guild,
    manageable: true,
    roles: {
      cache: new Map([['999', { id: '999' }], ['140', { id: '140' }]]),
      add: async (ids) => {
        for (const id of ids) noXpRoleMember.roles.cache.set(String(id), { id: String(id) });
        return noXpRoleMember;
      },
      remove: async (ids) => {
        for (const id of ids) noXpRoleMember.roles.cache.delete(String(id));
        return noXpRoleMember;
      }
    }
  };
  guild.members.cache.set(roleMember.id, roleMember);
  guild.members.cache.set(noXpRoleMember.id, noXpRoleMember);

  const seedConf = { ...roleConf, levelRoleMappings: [] };
  const seeded = await _levelInternals.awardXp({
    guild,
    member: roleMember,
    cfg: { general: { timezone: 'Europe/Berlin' }, levels: seedConf },
    conf: seedConf,
    amount: 35_200,
    source: 'message',
    silent: true
  });
  seeded.profile.level = 40;
  const seededNoXp = await _levelInternals.awardXp({
    guild,
    member: noXpRoleMember,
    cfg: { general: { timezone: 'Europe/Berlin' }, levels: seedConf },
    conf: seedConf,
    amount: 35_200,
    source: 'message',
    silent: true
  });
  seededNoXp.profile.level = 40;

  const result = await _levelInternals.ensureBalanceMigration(
    guild,
    { general: { timezone: 'Europe/Berlin' }, levels: roleConf },
    { forceRoleSync: true }
  );
  const migrated = await _levelInternals.getLevelProfileSnapshot(guild.id, roleMember.id);
  assert.equal(migrated.xp, 35_200);
  assert.equal(migrated.level, 22);
  assert.equal(roleMember.roles.cache.has('140'), false, 'Alte Level-40-Rolle wird entfernt');
  assert.equal(roleMember.roles.cache.has('120'), true, 'Neue höchste passende Level-20-Rolle wird vergeben');
  assert.equal(noXpRoleMember.roles.cache.has('140'), false, 'NO-XP-Mitglied verliert veraltete Level-Rollen');
  assert.equal(noXpRoleMember.roles.cache.has('120'), false, 'NO-XP-Mitglied erhält keine neue Level-Rolle');
  assert.equal(noXpRoleMember.roles.cache.has('999'), true, 'NO-XP-Rolle selbst bleibt erhalten');
  assert.equal(result.roleSync.ok, true);
  assert.equal(result.roleSync.hadErrors, false);
}

console.log('leveling-balance-smoke: Balance V1, Chat, Voice und Migration sind gruen');
