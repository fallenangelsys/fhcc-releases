#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const backupDir = path.join(process.env.USERPROFILE, 'AppData/Roaming/FALLEN HEAVEN Control Center/runtime/data/server-backups/1276125977805721640');
const files = fs.readdirSync(backupDir).sort().reverse();
const latest = files[0];
const data = JSON.parse(fs.readFileSync(path.join(backupDir, latest), 'utf8'));

console.log('Backup:', latest);

const channels = data.channels || data.snapshot?.channels || [];
if (!channels.length) {
  console.log('Keine Channels im Backup. Keys:', Object.keys(data).slice(0, 20));
  process.exit(0);
}

const cats = channels.filter(c => c.type === 4).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

for (const cat of cats) {
  const kids = channels
    .filter(c => c.parent_id === cat.id)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  console.log(`\n${cat.name}`);
  for (const k of kids) {
    console.log(`<#${k.id}> ${k.name}`);
  }
}
