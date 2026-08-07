const DOMAIN_PROVIDER_MAP = Object.freeze({
  boosts: ['discord-live', 'boost-ledger', 'server-events', 'server-index'],
  activity: ['activity-race'],
  economy: ['heaven-economy'],
  levels: ['levels'],
  tickets: ['tickets'],
  'server-tag': ['server-tag'],
  member: ['member-intelligence', 'discord-live', 'server-index'],
  diagnostics: ['diagnostics'],
  modules: ['module-status'],
  server: ['discord-live', 'server-events', 'server-index'],
  conversation: []
});

const routeDomain = (route = {}) => {
  const type = String(route?.serverIntent?.type || '').toLocaleLowerCase('de-DE');
  if (type === 'boosts' || /boost/.test(type)) return 'boosts';
  if (/diagnos|app-status|live-status/.test(type)) return 'diagnostics';
  if (route?.memberId) return 'member';
  if (/activ|ranking|liga/.test(String(route?.instruction || ''))) return 'activity';
  if (route?.mode === 'server') return 'server';
  return route?.mode === 'web' ? 'web' : 'conversation';
};

export const createKnowledgeQueryPlan = ({ route = {}, availableProviderIds = [] } = {}) => {
  const domain = routeDomain(route);
  const preferred = DOMAIN_PROVIDER_MAP[domain] || [];
  const available = new Set(availableProviderIds.map(String));
  const providerIds = preferred.filter((id) => available.has(id));
  return Object.freeze({
    domain,
    providerIds,
    targetMemberId: String(route?.memberId || ''),
    targetChannelId: String(route?.targetChannelId || ''),
    requiresServerKnowledge: !['conversation', 'web'].includes(domain),
    createdAt: new Date().toISOString()
  });
};
