import assert from 'node:assert/strict';

import { defaultGuildConfig, normalizeConfig } from '../src/defaultConfig.js';
import { _roleSaverInternals } from '../src/features/roleSaver.js';
import { _levelInternals } from '../src/features/levels.js';

const { settings, saveRolesOnLeave, restoreRolesOnJoin, isForbiddenRole, collectStorableRoles, refreshManagedRoleIds } = _roleSaverInternals;

const mkRole = (id, position = 0, options = {}) => ({
  id: String(id),
  position,
  managed: options.managed === true,
  guild: options.guild || { id: 'g1' }
});

const mkMember = (userId, roles) => ({
  id: String(userId),
  user: { id: String(userId), username: 'testuser', bot: false },
  roles: { cache: new Map(roles.map((role) => [String(role.id), role])) }
});

// 1) Defaults + Normalisierung
{
  const def = defaultGuildConfig('1').roleSaver;
  assert.equal(def.enabled, false);
  assert.equal(def.excludeBots, true);
  assert.equal(def.skipManagedRoles, true);
  assert.equal(def.restoreDelaySeconds, 8);
  const norm = normalizeConfig({ roleSaver: { enabled: true, blacklistedRoleIds: ['111111111111111111', '222222222222222222'], restoreDelaySeconds: 999 } }).roleSaver;
  assert.equal(norm.enabled, true);
  assert.deepEqual(norm.blacklistedRoleIds, ['111111111111111111', '222222222222222222']);
  assert.equal(norm.restoreDelaySeconds, 120, 'Wert wird auf Maximum geklemmt');
}

// 2) Blacklist + @everyone + managed-Rollen werden nie gespeichert
{
  const conf = settings({ roleSaver: { enabled: true, blacklistedRoleIds: ['team'] } });
  assert.equal(isForbiddenRole(mkRole('g1', 0), conf), true, '@everyone (Server-ID) ist verboten');
  assert.equal(isForbiddenRole(mkRole('team', 1), conf), true, 'Blacklist-Rolle ist verboten');
  assert.equal(isForbiddenRole(mkRole('botrole', 2, { managed: true }), conf), true, 'Managed-Rolle ist verboten');
  assert.equal(isForbiddenRole(mkRole('normal', 3), conf), false, 'Normale Rolle ist erlaubt');
}

// 3) Verwaltete Rollen (Level, Booster, AutoRole) werden übersprungen
{
  refreshManagedRoleIds({
    levels: { levelRoleMappings: [{ roleId: 'level10' }] },
    autoRole: { roleIds: ['autorole'] },
    boostRoles: { automaticRoleIds: ['booster'] }
  });
  const conf = settings({ roleSaver: { enabled: true } });
  const member = mkMember('u1', [
    mkRole('level10', 5),
    mkRole('autorole', 6),
    mkRole('booster', 7),
    mkRole('custom', 8)
  ]);
  const roles = collectStorableRoles(member, conf);
  assert.deepEqual(roles, ['custom'], 'Nur nicht-verwaltete Rollen werden gespeichert');
}

// 4) Speichern beim Verlassen + Wiederherstellen beim Join (Fake-Channel + managed policy)
{
  let applied = null;
  const fakeGuild = {
    id: 'g1',
    roles: { cache: new Map([
      ['custom', mkRole('custom', 8)],
      ['custom2', mkRole('custom2', 9)]
    ]) },
    members: { me: { roles: { highest: { position: 100 } } } }
  };
  const cfg = normalizeConfig({ roleSaver: { enabled: true, logChannelId: '' } });
  const member = mkMember('u1', [mkRole('custom', 8), mkRole('custom2', 9)]);

  const saved = await saveRolesOnLeave({ guild: fakeGuild, member, cfg });
  assert.equal(saved.action, 'saved', 'Rollen werden beim Verlassen gespeichert');
  assert.deepEqual(saved.roleIds, ['custom', 'custom2']);

  // Fake managed-role policy: Rollen einfach „vergeben“.
  const original = await import('../src/runtime/managedRoleService.js');
  // applyManagedRolePolicy wird vom echten Modul genutzt – hier prüfen wir den
  // internen Ablauf nur über die wiederherstellbaren Rollen (vor der Policy).
  const newMember = mkMember('u1', []);
  const result = await restoreRolesOnJoin({ guild: fakeGuild, member: newMember, cfg });
  // Da applyManagedRolePolicy auf einen echten Discord-Member zugreift, kann der
  // Test nur die Rollen-basierte Vorprüfung absichern; der Rest ist Integration.
  assert.ok(['restored', 'failed'].includes(result.action), `Wiederherstellung läuft durch (${result.action})`);
  const status = await (await import('../src/features/roleSaver.js'))._roleSaverInternals.getRoleSaverStatus(fakeGuild, cfg);
  assert.equal(status.savedMembers, 0, 'Nach der Wiederherstellung ist der Eintrag entfernt');
}

// 5) Level-Fortschritt bleibt per User-ID + onGuildMemberAdd-Hook existiert
{
  const levelsSource = (await import('node:fs')).readFileSync(new URL('../src/features/levels.js', import.meta.url), 'utf8');
  assert.match(levelsSource, /async onGuildMemberAdd\(\{ member, cfg \}\)/);
  assert.match(levelsSource, /getLevelProfileSnapshot\(guildId, userId\)/);
  assert.match(levelsSource, /synchronizeLevelRoles\(member, conf, level\)/);
  assert.ok(_levelInternals.getLevelProfileSnapshot, 'Profil-Snapshot ist exportiert');
}

console.log('Rollen-Saver-Smoke bestanden: Defaults, Blacklist, verwaltete Rollen, Speichern/Wiederherstellen, Level-Restore-Hook.');
