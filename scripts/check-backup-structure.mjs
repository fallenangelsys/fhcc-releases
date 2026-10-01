import { readFileSync, readdirSync } from 'fs';
import path from 'path';

const backupDir = path.join(process.env.USERPROFILE, 'AppData/Roaming/FALLEN HEAVEN Control Center/runtime/data/server-backups/1276125977805721640');
const files = readdirSync(backupDir).filter(f => f.endsWith('.json')).sort();
const latest = files[files.length - 1];
console.log('Backup:', latest);
const b = JSON.parse(readFileSync(path.join(backupDir, latest), 'utf8'));

// Show top-level structure
console.log('Top-level keys:', Object.keys(b));
if (b.roles) console.log('roles type:', typeof b.roles, Array.isArray(b.roles) ? 'array' : 'object');
if (b.channels) console.log('channels type:', typeof b.channels, Array.isArray(b.channels) ? 'array' : 'object');
if (b.guild) console.log('guild type:', typeof b.guild);
