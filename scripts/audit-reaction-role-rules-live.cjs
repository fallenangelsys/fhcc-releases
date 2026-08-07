const fs = require('node:fs');
const path = require('node:path');
const { REST, Routes } = require('discord.js');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const workspace = path.resolve(__dirname, '..', 'data', 'reaction-role-rules.json');
const canonical = path.join(
  String(process.env.APPDATA || ''),
  'FALLEN HEAVEN Control Center',
  'runtime',
  'data',
  'reaction-role-rules.json'
);
const reportFile = path.resolve(__dirname, '..', 'runtime', 'reaction-role-live-audit.json');
const sha256 = (value) => require('node:crypto').createHash('sha256').update(value).digest('hex');

function read(file) {
  if (!fs.existsSync(file)) return [];
  const value = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  return Array.isArray(value.rules) ? value.rules : [];
}

function componentsOf(message) {
  return new Set((message.components || []).flatMap((row) => row.components || []).map((component) => String(component.custom_id || '')));
}

async function main() {
  const token = String(process.env.DISCORD_TOKEN || '').trim();
  if (!token) throw new Error('DISCORD_TOKEN fehlt.');
  const groups = new Map();
  for (const [origin, rules] of [['workspace', read(workspace)], ['appdata', read(canonical)]]) {
    for (const rule of rules) {
      const key = `${rule.guildId || ''}:${rule.channelId || ''}:${rule.messageId || ''}`;
      if (!groups.has(key)) groups.set(key, { origins: new Set(), rules: [] });
      groups.get(key).origins.add(origin);
      groups.get(key).rules.push(rule);
    }
  }
  const rest = new REST({ version: '10' }).setToken(token);
  const botUser = await rest.get(Routes.user('@me'));
  const roleIdsByGuild = new Map();
  const report = [];
  for (const [key, group] of groups) {
    const rule = group.rules[0];
    try {
      if (!roleIdsByGuild.has(String(rule.guildId))) {
        const roles = await rest.get(Routes.guildRoles(String(rule.guildId)));
        roleIdsByGuild.set(String(rule.guildId), new Set((roles || []).map((role) => String(role.id))));
      }
      const message = await rest.get(Routes.channelMessage(String(rule.channelId), String(rule.messageId)));
      const components = componentsOf(message);
      const botReactionKeys = new Set((message.reactions || [])
        .filter((reaction) => reaction.me)
        .map((reaction) => String(reaction.emoji?.id || reaction.emoji?.name || '')));
      const validRoles = roleIdsByGuild.get(String(rule.guildId));
      const validRules = group.rules.filter((entry) => {
        const controlExists = components.has(String(entry.componentId || '')) || botReactionKeys.has(String(entry.emojiKey || entry.emojiId || entry.emojiName || ''));
        return controlExists && validRoles.has(String(entry.roleId || ''));
      });
      const authorIsCurrentBot = String(message.author?.id || '') === String(botUser.id || '');
      const liveStatus = validRules.length === group.rules.length
        ? 'live'
        : validRules.length
          ? 'partial'
          : 'stale';
      report.push({
        key,
        origins: [...group.origins],
        rules: group.rules.length,
        validRules: validRules.length,
        exists: true,
        authorIsBot: Boolean(message.author?.bot),
        authorIsCurrentBot,
        components: components.size,
        botReactions: botReactionKeys.size,
        validComponentIds: validRules.map((entry) => String(entry.componentId || '')),
        status: liveStatus
      });
    } catch (error) {
      const httpStatus = Number(error?.status || 0);
      report.push({ key, origins: [...group.origins], rules: group.rules.length, validRules: 0, exists: false, status: httpStatus === 404 ? 'missing' : 'audit-error', httpStatus });
    }
  }
  const summary = report.reduce((result, entry) => {
    result[entry.status] = Number(result[entry.status] || 0) + 1;
    return result;
  }, {});
  const workspaceBuffer = fs.existsSync(workspace) ? fs.readFileSync(workspace) : Buffer.alloc(0);
  const canonicalBuffer = fs.existsSync(canonical) ? fs.readFileSync(canonical) : Buffer.alloc(0);
  const result = {
    ok: !report.some((entry) => entry.status === 'audit-error'),
    auditedAt: new Date().toISOString(),
    workspaceHash: sha256(workspaceBuffer),
    canonicalHash: sha256(canonicalBuffer),
    groups: report.length,
    summary,
    report
  };
  if (process.argv.includes('--save') && result.ok) {
    fs.mkdirSync(path.dirname(reportFile), { recursive: true });
    fs.writeFileSync(reportFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    result.savedTo = reportFile;
  } else if (process.argv.includes('--save') && !result.ok) {
    throw new Error('Live-Audit unvollständig: mindestens eine Discord-Abfrage ist fehlgeschlagen. Vorhandene Freigabe bleibt unverändert.');
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${String(error?.message || error)}\n`);
  process.exitCode = 1;
});
