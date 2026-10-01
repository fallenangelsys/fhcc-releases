#!/usr/bin/env node
/**
 * Rollen-Optimierung: Vorschläge für die Discord-Server-Rechte.
 * NICHT direkt ausführen – nur Vorschläge anzeigen!
 */
import fs from 'node:fs';
import path from 'node:path';

const backupDir = path.join(process.env.USERPROFILE, 'AppData/Roaming/FALLEN HEAVEN Control Center/runtime/data/server-backups/1276125977805721640');
const files = fs.readdirSync(backupDir).sort().reverse();
const data = JSON.parse(fs.readFileSync(path.join(backupDir, files[0]), 'utf8'));

const roles = data.roles?.items || [];
const everyone = data.roles?.everyone;

// Discord Permission Bits
const PERMS = {
  ADMINISTRATOR: 1n << 3n,
  MANAGE_GUILD: 1n << 5n,
  MANAGE_CHANNELS: 1n << 6n,
  MANAGE_MESSAGES: 1n << 7n,
  MENTION_EVERYONE: 1n << 13n,
  MANAGE_ROLES: 1n << 28n,
  BAN_MEMBERS: 1n << 20n,
  KICK_MEMBERS: 1n << 21n,
  MANAGE_NICKNAMES: 1n << 27n,
  READ_MESSAGES: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
};

function permName(bit) {
  const map = {
    3: 'ADMINISTRATOR', 5: 'MANAGE_GUILD', 6: 'MANAGE_CHANNELS',
    7: 'MANAGE_MESSAGES', 13: 'MENTION_EVERYONE', 20: 'BAN_MEMBERS',
    21: 'KICK_MEMBERS', 27: 'MANAGE_NICKNAMES', 28: 'MANAGE_ROLES',
    10: 'READ_MESSAGES', 11: 'SEND_MESSAGES', 22: 'CONNECT', 23: 'SPEAK',
  };
  return map[bit] || `BIT_${bit}`;
}

function getPerms(permissions) {
  const p = BigInt(permissions || '0');
  const result = [];
  for (let i = 0; i < 40; i++) {
    if (p & (1n << BigInt(i))) result.push(permName(i));
  }
  return result;
}

function buildPerms(flags) {
  let p = 0n;
  for (const f of flags) p |= PERMS[f] || 0n;
  return p.toString();
}

// ══════════════════════════════════════════════════════════════
//  EMPFOHLENE ROLLEN-HIERARCHIE
// ══════════════════════════════════════════════════════════════

const recommended = [
  {
    name: '👑 Owner',
    description: 'Nur du. Volle Kontrolle.',
    perms: ['ADMINISTRATOR'],
    position: 'Höchste Rolle',
    color: '#ffaf09',
  },
  {
    name: '🛡️ Admin',
    description: 'Server-Chef. Kann alles außer Owner-Rolle.',
    perms: ['MANAGE_GUILD', 'MANAGE_CHANNELS', 'MANAGE_MESSAGES', 'MANAGE_ROLES', 'BAN_MEMBERS', 'KICK_MEMBERS', 'MANAGE_NICKNAMES'],
    position: 'Unter Owner',
    color: '#ff4444',
  },
  {
    name: '📋 Moderator',
    description: 'Nachrichten verwalten, Leute kicken. Kein Bann, keine Rollen.',
    perms: ['MANAGE_MESSAGES', 'KICK_MEMBERS', 'MANAGE_NICKNAMES'],
    position: 'Unter Admin',
    color: '#16a3e8',
  },
  {
    name: '🛡️ Trial-Mod',
    description: 'Nachrichten löschen/locken. Lernstufe.',
    perms: ['MANAGE_MESSAGES'],
    position: 'Unter Moderator',
    color: '#16a3e8',
  },
  {
    name: '💬 Supporter',
    description: 'Nur im Support aktiv. Keine Admin-Rechte.',
    perms: [],
    position: 'Unter Trial-Mod',
    color: '#f6cd13',
  },
];

// ══════════════════════════════════════════════════════════════
  //  ANALYSE: Welche Rollen haben probleme?
  // ══════════════════════════════════════════════════════════════

console.log('═══════════════════════════════════════════════════════════');
console.log('  ROLLEN-OPTIMIERUNG VORSCHLAG');
console.log('═══════════════════════════════════════════════════════════\n');

// ── 1. EMPFOHLENE HIERARCHIE ──
console.log('📋 EMPFOHLENE ROLLEN-HIERARCHIE:\n');
for (const r of recommended) {
  console.log(`  ${r.name}`);
  console.log(`    Position: ${r.position}`);
  console.log(`    Farbe: ${r.color}`);
  console.log(`    Rechte: ${r.perms.length ? r.perms.join(', ') : 'KEINE (nur.member)'}`);
  console.log(`    Beschreibung: ${r.description}`);
  console.log('');
}

// ── 2. PROBLEM-ROLLEN ──
console.log('═══════════════════════════════════════════════════════════');
console.log('  AKTUELLE PROBLEM-ROLLEN');
console.log('═══════════════════════════════════════════════════════════\n');

const problems = [
  {
    role: 'Admin (1305620638505107488)',
    issue: 'Hat NUR MANAGE_NICKNAMES – das ist NICHT Admin!',
    fix: 'Auf MANAGE_GUILD + MANAGE_CHANNELS + MANAGE_MESSAGES + MANAGE_ROLES + BAN + KICK upgraden',
  },
  {
    role: 'Moderator (1305621442519634010)',
    issue: 'Hat NUR MANAGE_ROLES – kann nicht mal Nachrichten löschen!',
    fix: 'Auf MANAGE_MESSAGES + KICK_MEMBERS umstellen, MANAGE_ROLES entfernen',
  },
  {
    role: 'Trial-Mod (1305621474790342706)',
    issue: 'Hat KEINE Rechte – kann gar nichts',
    fix: 'MANAGE_MESSAGES hinzufügen',
  },
  {
    role: 'Supporter (1305145161709387856)',
    issue: 'Hat KEINE Rechte – kann gar nichts',
    fix: 'Entweder Rechte geben oder entfernen',
  },
  {
    role: 'Trial-Sup (1305619820586340383)',
    issue: 'Hat NUR CONNECT – sinnlos',
    fix: 'Entfernen oder mit Supporter zusammenlegen',
  },
  {
    role: 'Team (1305076686030897192)',
    issue: 'Hat VIELES + MENTION_EVERYONE – zu viel für eine allgemeine Team-Rolle',
    fix: 'Entfernen oder auf READ + SEND beschränken',
  },
];

for (const p of problems) {
  console.log(`  ❌ ${p.role}`);
  console.log(`     Problem: ${p.issue}`);
  console.log(`     Fix: ${p.fix}`);
  console.log('');
}

// ── 3. BOT-ROLLEN REDUZIEREN ──
console.log('═══════════════════════════════════════════════════════════');
console.log('  BOT-ROLLEN ZU VIEL RECHTE');
console.log('═══════════════════════════════════════════════════════════\n');

const botRoles = roles.filter(r => r.managed && r.permissions !== '0');
for (const bot of botRoles) {
  const perms = getPerms(bot.permissions);
  const hasAdmin = perms.includes('ADMINISTRATOR');
  console.log(`  ${hasAdmin ? '🔴' : '🟡'} ${bot.name} (${bot.id})`);
  console.log(`     Rechte: ${perms.join(', ')}`);
  if (hasAdmin) {
    console.log(`     → ADMIN ENTFERNEN! Bots brauchen das nicht.`);
  }
  console.log('');
}

// ── 4. CHANNEL-OVERWORKS VEREINFACHEN ──
console.log('═══════════════════════════════════════════════════════════');
console.log('  CHANNEL-OVERWRITE-VEREINFACHUNG');
console.log('═══════════════════════════════════════════════════════════\n');

const channels = data.channels || [];
const categories = channels.filter(c => c.type === 4);

for (const cat of categories) {
  const kids = channels.filter(c => c.parentId === cat.id);
  const allOverwrites = kids.flatMap(c => c.permissionOverwrites || []);
  
  // Zähle wie oft jede Rolle vorkommt
  const roleCounts = {};
  for (const ow of allOverwrites) {
    roleCounts[ow.id] = (roleCounts[ow.id] || 0) + 1;
  }
  
  // Finde Rollen die in ALLEN Channels vorkommen
  const always = Object.entries(roleCounts).filter(([, count]) => count === kids.length);
  
  if (always.length > 0) {
    console.log(`  📁 ${cat.name}`);
    console.log(`     ${always.length} Rollen in ALLEN ${kids.length} Channels → auf Kategorie verschieben!`);
    for (const [roleId] of always) {
      const role = roles.find(r => r.id === roleId);
      console.log(`       - ${role?.name || roleId}`);
    }
    console.log('');
  }
}

// ── 5. ZUSAMMENFASSUNG ──
console.log('═══════════════════════════════════════════════════════════');
console.log('  ZUSAMMENFASSUNG');
console.log('═══════════════════════════════════════════════════════════\n');
console.log('  1. Admin-Rolle: Zu wenig Rechte → upgraden');
console.log('  2. Moderator-Rolle: Falsche Rechte → MANAGE_ROLES entfernen');
console.log('  3. Trial-Mod + Supporter: Gar keine Rechte → Rechte geben');
console.log('  4. Trial-Sup: Sinnlos → entfernen oder zusammenlegen');
console.log('  5. Team-Rolle: Zu viel → reduzieren oder entfernen');
console.log('  6. Bots: Zu viele mit ADMIN → reduzieren');
console.log('  7. Channel-Overworks: Zu viele identische → auf Kategorie verschieben');
console.log('');
console.log('  NÄCHSTER SCHRITT: Änderungen in Discord manuell umsetzen');
console.log('  (oder Bot-API nutzen für automatisierte Änderungen)');
