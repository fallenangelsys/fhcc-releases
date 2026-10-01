#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const tokenFile = path.join(process.env.USERPROFILE, 'AppData/Roaming/FALLEN HEAVEN Control Center/credentials/discord-bot-token.bin');

// Try to read the bot token
let token = '';
try {
  token = fs.readFileSync(tokenFile, 'utf8').trim();
} catch {
  console.error('Token nicht gefunden');
  process.exit(1);
}

const guildId = '1276125977805721640';

const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
  headers: { Authorization: `Bot ${token}` }
});

if (!res.ok) {
  console.error('API Fehler:', res.status, await res.text());
  process.exit(1);
}

const channels = await res.json();

// Filter categories (type 4)
const categories = channels.filter(c => c.type === 4).sort((a, b) => a.position - b.position);

for (const cat of categories) {
  const children = channels
    .filter(c => c.parent_id === cat.id)
    .sort((a, b) => a.position - b.position);
  
  console.log(`\n${cat.name.toUpperCase()}`);
  for (const ch of children) {
    console.log(`<#${ch.id}> ${ch.name}`);
  }
}
