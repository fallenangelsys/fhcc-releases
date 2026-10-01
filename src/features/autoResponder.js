const cooldownMap = new Map();
const claimedMessages = new Map();
const regexCache = new Map();

const normalize = (value, caseInsensitive = true) => {
  const text = String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  return caseInsensitive ? text.toLocaleLowerCase('de-DE') : text;
};

const parseRules = (rules) => (Array.isArray(rules) ? rules : [])
  .map((entry) => {
    if (!entry || typeof entry !== 'object') return null;
    const trigger = String(entry.trigger || '').trim();
    const response = String(entry.response || '').trim();
    if (!trigger || !response) return null;
    const mode = ['exact', 'startsWith', 'word', 'contains'].includes(entry.mode) ? entry.mode : 'word';
    return { trigger, response, mode };
  })
  .filter(Boolean);

const getWordRegex = (trigger) => {
  const cached = regexCache.get(trigger);
  if (cached) return cached;
  const escaped = trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}($|[^\\p{L}\\p{N}_])`, 'u');
  if (regexCache.size > 500) regexCache.clear();
  regexCache.set(trigger, regex);
  return regex;
};

const matchesRule = (content, trigger, mode) => {
  if (mode === 'exact') return content === trigger;
  if (mode === 'startsWith') return content === trigger || content.startsWith(`${trigger} `);
  if (mode === 'contains') return content.includes(trigger);
  return getWordRegex(trigger).test(content);
};

const formatResponse = (value, message) => String(value || '')
  .replaceAll('{user}', `<@${message.author.id}>`)
  .replaceAll('{username}', message.author.username || '')
  .replaceAll('{displayName}', message.member?.displayName || message.author.username || '')
  .replaceAll('{guild}', message.guild?.name || '')
  .replaceAll('{channel}', `<#${message.channelId}>`);

const claimMessage = (messageId) => {
  const now = Date.now();
  for (const [id, claimedAt] of claimedMessages) if (now - claimedAt > 10 * 60_000) claimedMessages.delete(id);
  if (!messageId || claimedMessages.has(messageId)) return false;
  claimedMessages.set(messageId, now);
  return true;
};

export const feature = {
  id: 'autoresponder',
  name: 'Auto Responder',
  commands: [],

  async onMessageCreate({ message, cfg }) {
    const conf = cfg?.autoresponder;
    if (!conf?.enabled || !message?.guild || message.author?.bot || !claimMessage(message.id)) return;
    const allowed = new Set((conf.channelIds || []).map(String));
    const ignored = new Set((conf.ignoredChannelIds || []).map(String));
    const channelId = String(message.channelId || '');
    const parentId = String(message.channel?.parentId || '');
    if ((allowed.size && !allowed.has(channelId) && !allowed.has(parentId)) || ignored.has(channelId) || ignored.has(parentId)) return;
    if (conf.mentionOnly && !message.mentions?.has?.(message.client.user)) return;

    const now = Date.now();
    // Veraltete Cooldown-Einträge entfernen – sonst wächst die Map im
    // Dauerbetrieb unbegrenzt (RAM-Leck). Nur die letzten 30 min sind relevant.
    for (const [staleKey, staleAt] of cooldownMap) {
      if (now - staleAt > 30 * 60_000) cooldownMap.delete(staleKey);
    }
    const key = `${message.guildId}:${message.author.id}`;
    const cooldownMs = Math.max(5, Number(conf.cooldownSeconds || 120)) * 1000;
    if (now - (cooldownMap.get(key) || 0) < cooldownMs) return;

    const caseInsensitive = conf.caseInsensitive !== false;
    const content = normalize(message.content, caseInsensitive);
    const match = parseRules(conf.rules).find((rule) => matchesRule(content, normalize(rule.trigger, caseInsensitive), rule.mode));
    if (!match) return;
    cooldownMap.set(key, now);
    if (conf.deleteCommand) await message.delete().catch(() => null);
    const response = formatResponse(match.response, message).slice(0, 2000);
    await message.channel.send({
      content: response,
      allowedMentions: conf.allowUserMention === true ? { users: [message.author.id], roles: [], parse: [] } : { users: [], roles: [], parse: [] }
    }).catch(() => null);
  }
};

export const _autoResponderInternals = { normalize, parseRules, matchesRule, formatResponse, claimMessage };
