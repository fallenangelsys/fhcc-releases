import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { PermissionFlagsBits } from 'discord.js';
import { defaultGuildConfig, featureCards, normalizeConfig } from '../src/defaultConfig.js';
import { applyManagedRolePolicy, applyRoleChangesSequentially, getManagedRoleServiceSnapshot } from '../src/runtime/managedRoleService.js';
import { feature as autoRoleFeature } from '../src/features/autoRole.js';

const calls = [];
const rawMember = {
  roles: {
    remove: async (roles) => {
      calls.push(`remove:${roles.join(',')}`);
      return {
        roles: {
          add: async (added) => {
            calls.push(`add:${added.join(',')}`);
            return { id: 'fresh-member', roles: {} };
          }
        }
      };
    },
    add: async () => { throw new Error('Nach dem Entfernen darf kein veralteter Member verwendet werden.'); }
  }
};
const sequential = await applyRoleChangesSequentially({ member: rawMember, toRemove: ['old'], toAdd: ['new'], reason: 'Test' });
assert.equal(sequential.id, 'fresh-member');
assert.deepEqual(calls, ['remove:old', 'add:new']);

const roles = new Map([
  ['guild', { id: 'guild', name: '@everyone', position: 0, editable: false, managed: false }],
  ['role-a', { id: 'role-a', name: 'Member', position: 10, editable: true, managed: false }],
  ['role-high', { id: 'role-high', name: 'Owner', position: 120, editable: false, managed: false }]
]);
const memberRoleIds = new Set(['guild']);
let member;
const memberRoles = () => ({
  cache: { has: (id) => memberRoleIds.has(id) },
  add: async (ids) => { for (const id of ids) memberRoleIds.add(String(id)); return member; },
  remove: async (ids) => { for (const id of ids) memberRoleIds.delete(String(id)); return member; }
});
const guild = {
  id: 'guild',
  roles: { cache: roles },
  members: {
    me: { permissions: { has: (flag) => flag === PermissionFlagsBits.ManageRoles }, roles: { highest: { position: 100 } } },
    fetch: async () => member
  }
};
member = { id: 'member', guild, manageable: true, roles: memberRoles(), user: { bot: false } };
const result = await applyManagedRolePolicy({ member, addRoleIds: ['role-a'], reason: 'Smoke' });
assert.deepEqual(result.addedRoleIds, ['role-a']);
assert(memberRoleIds.has('role-a'));
await assert.rejects(() => applyManagedRolePolicy({ member, addRoleIds: ['role-high'], reason: 'Blockiert' }), /höchste Bot-Rolle/);
assert.equal(memberRoleIds.has('role-high'), false);
assert(getManagedRoleServiceSnapshot().completed >= 1);

const defaults = defaultGuildConfig('guild', 'Rollen-Test');
assert.equal(defaults.autoRole.reconcileOnStartup, false);
const config = normalizeConfig({ guildId: 'guild', autoRole: { assignmentDelaySeconds: 999, retryCount: 99, roleIds: 'a\na\nb' } });
assert.equal(config.autoRole.assignmentDelaySeconds, 120);
assert.equal(config.autoRole.retryCount, 5);
assert.deepEqual(config.autoRole.roleIds, ['a', 'b']);
assert.deepEqual(autoRoleFeature.commands, []);

const card = featureCards.find((entry) => entry.id === 'autoRole');
for (const key of ['autoRole.roleIds', 'autoRole.assignmentDelaySeconds', 'autoRole.retryCount', 'autoRole.reconcileOnStartup', 'autoRole.logChannelId']) {
  assert(card.fields.some((field) => field.key === key), `AutoRole-App-Feld ${key} fehlt.`);
}
assert.equal(card.fields.find((field) => field.key === 'autoRole.roleIds').type, 'multiRoleSelect');

for (const file of ['../src/features/autoRole.js', '../src/features/welcomeFarewell.js', '../src/features/boostRoles.js', '../src/features/serverTagTracker.js']) {
  const source = await fs.readFile(new URL(file, import.meta.url), 'utf8');
  assert(source.includes('managedRoleService.js'), `${file} verwendet den gemeinsamen Rollenservice nicht.`);
}

console.log('Managed-Role-Smoke bestanden: gemeinsame Queue, Hierarchieprüfung, frischer Member, AutoRole-Retries und direkte Rollenauswahl sind aktiv.');
