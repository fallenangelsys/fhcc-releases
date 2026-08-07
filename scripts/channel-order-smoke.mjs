import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const source = fs.readFileSync(path.join(root, 'src', 'index.js'), 'utf8');
const start = source.indexOf("const dashboardOrderCollator =");
const end = source.indexOf("const DASHBOARD_CONFIG_CHANNEL_TYPES =");
if (start < 0 || end <= start) throw new Error('Kanal-Sortierlogik konnte nicht isoliert werden.');

const context = {
  Intl,
  BigInt,
  ChannelType: {
    GuildText: 0,
    GuildVoice: 2,
    GuildCategory: 4,
    GuildAnnouncement: 5,
    GuildStageVoice: 13,
    GuildForum: 15,
    GuildMedia: 16
  },
  THREAD_CHANNEL_TYPES: new Set([10, 11, 12])
};
vm.createContext(context);
vm.runInContext(`${source.slice(start, end)}\nglobalThis.sortForDashboard = withDashboardDisplayOrder;`, context);

const rows = [
  { id: '101', name: 'Root später', type: 2, rawPosition: 1, position: 1, parentId: null, isVoice: true },
  { id: '100', name: 'Root zuerst', type: 2, rawPosition: 0, position: 0, parentId: null, isVoice: true },
  { id: '200', name: 'TEAM', type: 4, rawPosition: 5, position: 5, parentId: null, isCategory: true },
  { id: '204', name: 'Voice Mitte', type: 2, rawPosition: 2, position: 2, parentId: '200', isVoice: true },
  { id: '205', name: 'Text Ende', type: 0, rawPosition: 3, position: 3, parentId: '200', isText: true },
  { id: '202', name: 'Text Anfang B', type: 0, rawPosition: 1, position: 1, parentId: '200', isText: true },
  { id: '201', name: 'Text Anfang A', type: 0, rawPosition: 1, position: 1, parentId: '200', isText: true }
];

const ordered = context.sortForDashboard(rows).map((entry) => entry.name);
const expected = ['Root zuerst', 'Root später', 'TEAM', 'Text Anfang A', 'Text Anfang B', 'Voice Mitte', 'Text Ende'];
if (JSON.stringify(ordered) !== JSON.stringify(expected)) {
  throw new Error(`Discord-Reihenfolge falsch. Erwartet ${JSON.stringify(expected)}, erhalten ${JSON.stringify(ordered)}.`);
}
console.log('Kanal-Reihenfolge-Smoke bestanden: Root-Block, Kategorien, gemischte Kanaltypen, Position und Snowflake-ID stimmen.');
