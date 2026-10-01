#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const backupDir = path.join(process.env.USERPROFILE, 'AppData/Roaming/FALLEN HEAVEN Control Center/runtime/data/server-backups/1276125977805721640');
const files = fs.readdirSync(backupDir).sort().reverse();
const data = JSON.parse(fs.readFileSync(path.join(backupDir, files[0]), 'utf8'));

console.log('=== BACKUP: ' + files[0] + ' ===\n');

// ── 1. ALLE ROLLEN ──
const roles = data.roles?.items || [];
console.log('═══════════════════════════════════════');
console.log('  ROLLEN (' + roles.length + ')');
console.log('═══════════════════════════════════════\n');

const sortedRoles = roles
  .filter(r => r.name !== '@everyone')
  .sort((a, b) => (b.position ?? 0) - (a.position ?? 0));

for (const role of sortedRoles) {
  const perms = role.permissions ? BigInt(role.permissions) : 0n;
  const flags = [];
  if (perms & (1n << 3n)) flags.push('ADMINISTRATOR');
  if (perms & (1n << 5n)) flags.push('MANAGE_GUILD');
  if (perms & (1n << 6n)) flags.push('MANAGE_CHANNELS');
  if (perms & (1n << 7n)) flags.push('MANAGE_MESSAGES');
  if (perms & (1n << 13n)) flags.push('MANAGE_ROLES');
  if (perms & (1n << 20n)) flags.push('BAN_MEMBERS');
  if (perms & (1n << 21n)) flags.push('KICK_MEMBERS');
  if (perms & (1n << 23n)) flags.push('MENTION_EVERYONE');
  if (perms & (1n << 26n)) flags.push('MANAGE_NICKNAMES');
  if (perms & (1n << 28n)) flags.push('MANAGE_EMOJIS');
  if (perms & (1n << 10n)) flags.push('READ_MESSAGES');
  if (perms & (1n << 11n)) flags.push('SEND_MESSAGES');
  if (perms & (1n << 12n)) flags.push('SEND_TTS_MESSAGES');
  if (perms & (1n << 14n)) flags.push('ADD_REACTIONS');
  if (perms & (1n << 15n)) flags.push('ATTACH_FILES');
  if (perms & (1n << 16n)) flags.push('READ_HISTORY');
  if (perms & (1n << 18n)) flags.push('USE_PUBLIC_THREADS');
  if (perms & (1n << 19n)) flags.push('USE_PRIVATE_THREADS');
  if (perms & (1n << 22n)) flags.push('CONNECT');
  if (perms & (1n << 24n)) flags.push('SPEAK');
  if (perms & (1n << 25n)) flags.push('USE_VAD');
  if (perms & (1n << 29n)) flags.push('CHANGE_NICKNAME');
  if (perms & (1n << 30n)) flags.push('USE_APP_COMMANDS');

  console.log((role.hoist ? '◆ ' : '◇ ') + role.name + ' (ID: ' + role.id + ')');
  console.log('  Position: ' + (role.position ?? '?') + ' | Farbe: ' + (role.color ? '#' + role.color.toString(16).padStart(6, '0') : 'keine'));
  console.log('  Members: ' + (role.memberCount ?? '?') + ' | Mentionable: ' + (role.mentionable ? 'ja' : 'nein'));
  console.log('  Permissions: ' + (flags.length ? flags.join(', ') : 'keine'));

  // Bitfield-Details
  const rawPerms = role.permissions ?? '0';
  console.log('  Raw: ' + rawPerms);
  console.log('');
}

// ── 2. @everyone ──
const everyone = data.roles?.everyone;
if (everyone) {
  const perms = everyone.permissions ? BigInt(everyone.permissions) : 0n;
  console.log('═══════════════════════════════════════');
  console.log('  @everyone');
  console.log('═══════════════════════════════════════');
  console.log('  Raw: ' + everyone.permissions);
  console.log('  Bitfield: ' + perms.toString());
  console.log('');
}

// ── 3. KATEGORIEN + CHANNEL-RECHTE ──
const channels = data.channels || [];
const categories = channels.filter(c => c.type === 4).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

console.log('═══════════════════════════════════════');
console.log('  KATEGORIEN & CHANNEL-RECHTE');
console.log('═══════════════════════════════════════\n');

for (const cat of categories) {
  const kids = channels.filter(c => c.parentId === cat.id).sort((a, b) => (a.rawPosition ?? a.position ?? 0) - (b.rawPosition ?? b.position ?? 0));

  console.log('┌─ ' + cat.name);
  if (cat.permissionOverwrites?.length) {
    for (const ow of cat.permissionOverwrites) {
      const allow = BigInt(ow.allow ?? '0');
      const deny = BigInt(ow.deny ?? '0');
      const perms = [];
      if (allow & (1n << 10n)) perms.push('+READ');
      if (deny & (1n << 10n)) perms.push('-READ');
      if (allow & (1n << 11n)) perms.push('+SEND');
      if (deny & (1n << 11n)) perms.push('-SEND');
      if (allow & (1n << 22n)) perms.push('+CONNECT');
      if (deny & (1n << 22n)) perms.push('-CONNECT');
      if (allow & (1n << 6n)) perms.push('+MANAGE_CHANNELS');
      if (deny & (1n << 6n)) perms.push('-MANAGE_CHANNELS');
      if (allow & (1n << 7n)) perms.push('+MANAGE_MESSAGES');
      if (deny & (1n << 7n)) perms.push('-MANAGE_MESSAGES');
      if (perms.length) {
        console.log('  │ ' + ow.id + ': ' + perms.join(', '));
      }
    }
  } else {
    console.log('  │ (keine Overwrites)');
  }

  for (const ch of kids) {
    const owCount = ch.permissionOverwrites?.length ?? 0;
    let extraPerms = [];
    if (owCount > 0) {
      for (const ow of ch.permissionOverwrites) {
        const allow = BigInt(ow.allow ?? '0');
        const deny = BigInt(ow.deny ?? '0');
        const p = [];
        if (allow & (1n << 11n)) p.push('+SEND');
        if (deny & (1n << 11n)) p.push('-SEND');
        if (allow & (1n << 22n)) p.push('+CONNECT');
        if (deny & (1n << 22n)) p.push('-CONNECT');
        if (allow & (1n << 6n)) p.push('+MNG_CH');
        if (deny & (1n << 6n)) p.push('-MNG_CH');
        if (p.length) extraPerms.push(ow.id + ':' + p.join('|'));
      }
    }
    console.log('  ├─ ' + ch.name + ' (' + ch.id + ')' + (extraPerms.length ? ' [' + extraPerms.join('; ') + ']' : ''));
  }
  console.log('  └─');
  console.log('');
}
