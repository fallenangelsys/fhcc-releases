/**
 * Discord Channel-Overwrite-Script: Owner-Only Channels
 * 
 * Setzt diese Kanäle auf Owner-Only:
 * - #👑 Owner-Talk (war ÖFFENTLICH!)
 * - #📗 Manage-Talk (war ÖFFENTLICH!)
 * - #📕 Admin-Talk (war ÖFFENTLICH!)
 * - #📘 Moderator-Talk (war ÖFFENTLICH!)
 * - #🔒 Moderator-Only
 * - #teamwarnlogs
 * - #carl-modlog, #carl-reports, #carl-joinleave, #carl-message, #carl-voice, #carl-server, #carl-member, #carl-default
 * - #yagpdb-bankick, #yagpdb-error, #yagpdb-mod
 * - #securitybot, #abwesenheitslogs, #galaxy-logs, #ticketlog, #aktivitätswarnung, #boost-log
 * 
 * VORSICHT: Dieses Script ändert ECHTE Discord-Berechtigungen!
 * Führe es NUR manuell aus und prüfe die Ausgabe.
 */

import { Client, PermissionFlagsBits, ChannelType } from 'discord.js';
import { readFileSync } from 'fs';
import path from 'path';

// --- Konfiguration ---
const GUILD_ID = '1276125977805721640';

// Owner-Rolle ID (aus Backup)
const OWNER_ROLE_ID = '1754862674981058652'; // Owner

// Kanäle die Owner-Only werden sollen
const OWNER_ONLY_CHANNELS = [
  // TEAM - Owner-Only
  '1533883529388359770', // 👑 owner-talk
  '1305884129098993746', // 📗 manage-talk
  '1305884502517747847', // 📕 admin-talk
  '1305884859734163476', // 📘 moderator-talk
  
  // ADMIN - Logs Owner-Only (Bot-Overwrites entfernen, Owner setzen)
  '1278088026563678209', // moderator-only
  '1305628773332422696', // teamwarnlogs
  '1306077159017943093', // carl-modlog
  '1306078069374717983', // carl-reports
  '1306078573093720165', // carl-joinleave
  '1306078652554805298', // carl-message
  '1306078721840775290', // carl-voice
  '1306078774793867285', // carl-server
  '1306078840266952794', // carl-member
  '1306078896286072923', // carl-default
  '1306102106897383435', // yagpdb-bankick
  '1306102475958255716', // yagpdb-error
  '1306102551644602388', // yagpdb-mod
  '1307687069614870579', // securitybot
  '1305629074856743044', // abwesenheitslogs
  '1305634546074652772', // galaxy-logs
  '1278082141133082736', // ticketlog
  '1278042958075003042', // aktivitätswarnung
  '1404532593575067690', // boost-log
];

// Diese Rollen sollen weiterhin Zugriff haben (Bots für Logging)
const KEEP_ACCESS_ROLE_IDS = [
  '1305076686030897192', // Fallen-Heaven (Bot)
  '1278040194825715785', // AutoMod-Rolle (oder ähnlich)
  '1526921868118851646', // Bot-Rolle für automod-warn
  '1306031634155573308', // Bot-Rolle für boost-log
];

const GUILD_ROLES_TO_BLOCK = [
  '1278031838291689567', // unverified / muted
  '1278072073184477246', // Jail / muted
];

// --- Hauptlogik ---

// Lies Token aus der laufenden App
const tokenPath = path.join(
  process.env.USERPROFILE,
  'AppData/Roaming/FALLEN HEAVEN Control Center/runtime/credentials/discord-bot-token.bin'
);

let token;
try {
  token = readFileSync(tokenPath, 'utf8').trim();
} catch {
  console.error('❌ Bot-Token nicht gefunden unter:', tokenPath);
  process.exit(1);
}

const client = new Client({ intents: [] });

client.once('ready', async () => {
  console.log(`✅ Verbunden als ${client.user.tag}\n`);
  
  const guild = await client.guilds.fetch(GUILD_ID);
  if (!guild) {
    console.error('❌ Guild nicht gefunden!');
    client.destroy();
    return;
  }

  let changed = 0;
  
  for (const channelId of OWNER_ONLY_CHANNELS) {
    try {
      const channel = await guild.channels.fetch(channelId);
      if (!channel) {
        console.log(`⚠️  #${channelId} nicht gefunden – übersprungen`);
        continue;
      }
      
      console.log(`🔧 Bearbeite #${channel.name}...`);
      
      // Alle bestehenden Overwrites beibehalten, aber @everyone deny setzen + Owner allow setzen
      const existingOverwrites = channel.permissionOverwrites.cache;
      const newOverwrites = [];
      
      for (const [id, ow] of existingOverwrites) {
        // Bot-Rollen: Zugriff beibehalten (sie brauchen das zum Loggen)
        if (KEEP_ACCESS_ROLE_IDS.includes(id)) {
          newOverwrites.push({
            id,
            type: 1, // Role
            allow: ow.allow,
            deny: ow.deny,
          });
        }
        // Alles andere: behalten wir bei (VIP-Rollen etc.)
        else {
          newOverwrites.push({
            id,
            type: ow.type,
            allow: ow.allow,
            deny: ow.deny,
          });
        }
      }
      
      // @everyone: VIEW_CHANNEL verweigern (falls nicht schon)
      const everyoneOverwrite = newOverwrites.find(o => o.id === GUILD_ID);
      const everyoneDeny = everyoneOverwrite ? BigInt(everyoneOverwrite.deny || '0') : 0n;
      if (!(everyoneDeny & PermissionFlagsBits.ViewChannel)) {
        if (everyoneOverwrite) {
          everyoneOverwrite.deny = String(everyoneDeny | PermissionFlagsBits.ViewChannel);
        } else {
          newOverwrites.push({
            id: GUILD_ID,
            type: 0, // Member (everyone)
            allow: '0',
            deny: String(PermissionFlagsBits.ViewChannel),
          });
        }
      }
      
      // Blockierte Rollen: Zugriff verweigern
      for (const blockRoleId of GUILD_ROLES_TO_BLOCK) {
        if (!newOverwrites.find(o => o.id === blockRoleId)) {
          newOverwrites.push({
            id: blockRoleId,
            type: 1,
            allow: '0',
            deny: String(PermissionFlagsBits.ViewChannel),
          });
        }
      }
      
      // Owner-Rolle: Full Access
      const ownerOverwrite = newOverwrites.find(o => o.id === OWNER_ROLE_ID);
      if (ownerOverwrite) {
        ownerOverwrite.allow = String(
          PermissionFlagsBits.ViewChannel |
          PermissionFlagsBits.SendMessages |
          PermissionFlagsBits.ReadMessageHistory |
          PermissionFlagsBits.MentionEveryone |
          PermissionFlagsBits.ManageMessages |
          PermissionFlagsBits.ManageChannels
        );
        ownerOverwrite.deny = '0';
      } else {
        newOverwrites.push({
          id: OWNER_ROLE_ID,
          type: 1,
          allow: String(
            PermissionFlagsBits.ViewChannel |
            PermissionFlagsBits.SendMessages |
            PermissionFlagsBits.ReadMessageHistory |
            PermissionFlagsBits.MentionEveryone |
            PermissionFlagsBits.ManageMessages |
            PermissionFlagsBits.ManageChannels
          ),
          deny: '0',
        });
      }
      
      await channel.permissionOverwrites.set(newOverwrites, 'Owner-Only Access Setup');
      console.log(`  ✅ #${channel.name} → Owner-Only gesetzt`);
      changed++;
      
    } catch (err) {
      console.error(`  ❌ #${channelId} Fehler: ${err.message}`);
    }
  }
  
  console.log(`\n📊 Fertig: ${changed}/${OWNER_ONLY_CHANNELS.length} Kanäle auf Owner-Only gesetzt.`);
  client.destroy();
});

client.login(token);
