import { readFileSync, readdirSync } from 'fs';
import path from 'path';

const backupDir = path.join(process.env.USERPROFILE, 'AppData/Roaming/FALLEN HEAVEN Control Center/runtime/data/server-backups/1276125977805721640');
const files = readdirSync(backupDir).filter(f => f.endsWith('.json')).sort();
const latest = files[files.length - 1];
console.log('Backup:', latest, '\n');
const b = JSON.parse(readFileSync(path.join(backupDir, latest), 'utf8'));

const roles = b.roles;  // object { id: roleData }
const channels = b.channels;  // array
const guildId = b.guild?.id;

// Find key roles
const roleMap = {};
for (const [id, r] of Object.entries(roles)) {
  roleMap[id] = r;
}

const ownerRoleId = Object.entries(roles).find(([, r]) => r.name === 'Owner')?.[0];
const fhRoleId = Object.entries(roles).find(([, r]) => r.name === 'Fallen-Heaven')?.[0];
const everyoneId = guildId; // @everyone

console.log('=== ROLLEN (Position → Name → Globale Rechte) ===');
const sortedRoles = Object.entries(roles).filter(([, r]) => !r.managed).sort((a, b) => (b[1].position || 0) - (a[1].position || 0));
for (const [id, r] of sortedRoles) {
  const p = BigInt(r.permissions || '0');
  const flags = [];
  if (p & 0x8n) flags.push('ADMIN');
  if (p & 0x4n) flags.push('MANAGE_GUILD');
  if (p & 0x800n) flags.push('BAN');
  if (p & 0x2000n) flags.push('KICK');
  if (p & 0x20000000n) flags.push('MANAGE_MSG');
  if (p & 0x10000000n) flags.push('MANAGE_ROLES');
  if (p & 0x4000n) flags.push('MANAGE_CH');
  if (p & 0x200000n) flags.push('MENTION');
  const marker = id === ownerRoleId ? ' 👑' : id === fhRoleId ? ' 🤖' : '';
  console.log(`  [${String(r.position).padStart(2)}] ${r.name}${marker} → ${flags.join(', ') || 'keine'}`);
}

// Categorize channels
const categories = channels.filter(c => c.type === 4);
const catMap = {};
for (const cat of categories) {
  catMap[cat.id] = cat;
}

console.log('\n=== CHANNEL OVERWRITE-ANALYSE ===');
console.log('(🔴 = Owner-Only, 🟡 = Team-Only, 🟢 = Öffentlich)\n');

let ownerOnly = [];
let teamRestricted = [];
let publicChannels = [];

for (const ch of channels) {
  if (ch.type === 4) continue; // skip categories
  const ow = ch.permissionOverwrites || [];
  
  // Find if @everyone is denied VIEW_CHANNEL
  let everyoneDenied = false;
  let ownerAllowed = false;
  let ownerExplicit = false;
  const allowedRoles = [];
  const deniedRoles = [];
  
  for (const overwrite of ow) {
    const deny = BigInt(overwrite.deny || '0');
    const allow = BigInt(overwrite.allow || '0');
    const roleId = overwrite.id;
    const rName = roleMap[roleId]?.name || (roleId === everyoneId ? '@everyone' : roleId);
    
    if (roleId === everyoneId && (deny & 0x400n || deny & 0x80000n)) {
      everyoneDenied = true;
    }
    
    if (roleId === ownerRoleId) {
      ownerExplicit = true;
      if (allow & 0x400n || allow & 0x80000n) ownerAllowed = true;
    }
    
    if (allow & 0x400n || allow & 0x80000n) {
      allowedRoles.push(rName);
    }
    if (deny & 0x400n || deny & 0x80000n) {
      deniedRoles.push(rName);
    }
  }
  
  const parentName = catMap[ch.parentId]?.name || 'KEINE';
  const chName = ch.name;
  
  // Owner-only: @everyone denied + Owner allowed + no other roles allowed
  if (everyoneDenied && ownerExplicit && allowedRoles.length <= 1) {
    ownerOnly.push({ ch: chName, cat: parentName, allow: allowedRoles.join(', ') });
    console.log(`  🔴 #${chName} [${parentName}] → Owner-Only (${allowedRoles.join(', ')})`);
  }
  // Team restricted: @everyone denied + multiple roles allowed
  else if (everyoneDenied && allowedRoles.length > 1) {
    teamRestricted.push({ ch: chName, cat: parentName, allow: allowedRoles.join(', ') });
    console.log(`  🟡 #${chName} [${parentName}] → Team (${allowedRoles.join(', ')})`);
  }
  // Public
  else if (!everyoneDenied) {
    publicChannels.push({ ch: chName, cat: parentName });
    console.log(`  🟢 #${chName} [${parentName}] → Öffentlich`);
  }
  // Mixed
  else {
    console.log(`  ⚪ #${chName} [${parentName}] → Mix (denied: ${deniedRoles.join(', ')} | allowed: ${allowedRoles.join(', ')})`);
  }
}

console.log('\n=== ZUSAMMENFASSUNG ===');
console.log(`Owner-Only Channels: ${ownerOnly.length}`);
ownerOnly.forEach(c => console.log(`  - #${c.ch} [${c.cat}]`));
console.log(`\nTeam-Restricted Channels: ${teamRestricted.length}`);
teamRestricted.forEach(c => console.log(`  - #${c.ch} [${c.cat}] → ${c.allow}`));
console.log(`\nÖffentliche Channels: ${publicChannels.length}`);
