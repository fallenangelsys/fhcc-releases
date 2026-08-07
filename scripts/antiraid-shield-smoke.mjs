import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { defaultGuildConfig, featureCards, normalizeConfig } from '../src/defaultConfig.js';
import { feature, _antiraidInternals } from '../src/features/antiraid.js';

const { normalizeSettings, accountAgeDays, isEligible, cleanupState } = _antiraidInternals;

const defaults = defaultGuildConfig('guild-raid', 'Raid-Test');
assert.equal(defaults.antiraid.action, 'observe', 'Der Raid-Schutz muss sicher im Beobachtungsmodus starten.');
assert.deepEqual(feature.commands, [], 'Der Raid-Schutz darf keine Commands benötigen.');

const normalized = normalizeConfig({
  guildId: 'guild-raid',
  antiraid: {
    enabled: true,
    joinThreshold: 500,
    joinWindowSeconds: 1,
    shieldMinutes: 999,
    action: 'ban',
    recentAccountDays: -5,
    trustedUserIds: '123\n123\n456'
  }
});
assert.equal(normalized.antiraid.joinThreshold, 100);
assert.equal(normalized.antiraid.joinWindowSeconds, 5);
assert.equal(normalized.antiraid.shieldMinutes, 180);
assert.equal(normalized.antiraid.action, 'observe', 'Alte unsichere Kick-/Ban-Konfigurationen müssen auf Beobachten migriert werden.');
assert.equal(normalized.antiraid.recentAccountDays, 0);
assert.deepEqual(normalized.antiraid.trustedUserIds, ['123', '456']);
assert.equal(normalizeSettings({ antiraid: normalized.antiraid }).action, 'observe');

const now = Date.now();
assert(accountAgeDays({ createdTimestamp: now - 2 * 86_400_000 }, now) > 1.99);
const roleCache = new Map();
roleCache.some = function (predicate) { return [...this.values()].some(predicate); };
const member = {
  id: 'member-1',
  user: { bot: false, createdTimestamp: now - 2 * 86_400_000 },
  guild: { ownerId: 'owner-1' },
  roles: { cache: roleCache }
};
assert.equal(isEligible(member, { onlyRecentAccounts: true, recentAccountDays: 7, trustedUserIds: [], whitelistRoleIds: [] }, now), true);
assert.equal(isEligible(member, { onlyRecentAccounts: true, recentAccountDays: 1, trustedUserIds: [], whitelistRoleIds: [] }, now), false);

const state = { joins: [{ at: now - 20_000 }, { at: now - 2_000 }], shieldUntil: now - 1, affected: new Set(['member-1']) };
cleanupState(state, now, 10_000);
assert.equal(state.joins.length, 1);
assert.equal(state.affected.size, 0);

const definition = featureCards.find((entry) => entry.id === 'antiraid');
for (const key of ['antiraid.action', 'antiraid.shieldMinutes', 'antiraid.quarantineRoleId', 'antiraid.onlyRecentAccounts', 'antiraid.logChannelId']) {
  assert(definition.fields.some((field) => field.key === key), `App-Feld ${key} fehlt.`);
}

const source = await fs.readFile(new URL('../src/features/antiraid.js', import.meta.url), 'utf8');
assert(!/\bmember\.(?:kick|ban)\s*\(/.test(source), 'Der Raid-Schutz darf niemals automatisch kicken oder bannen.');
console.log('Raid-Schutz-Smoke bestanden: sicherer Beobachtungsmodus, begrenzte Werte, junge Konten, Vertrauenslisten und keine Auto-Kicks/Banns.');
