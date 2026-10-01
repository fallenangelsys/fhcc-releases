// Best-effort-Fehler sichtbar machen, ohne den Event-Loop zu belasten.
// Ersetzt stille `.catch(() => null)`-Stellen: Der Fehler wird mit Scope-Präfix
// auf stderr geloggt (landet im Supervisor-Log / Crash-Log), aber pro Scope
// auf eine Meldung pro Rate-Limit-Fenster begrenzt – wiederholte Fehler
// (z.B. ein gelöschtes Embed, das nicht mehr editierbar ist) erzeugen so
// keinen Log-Spam, bleiben aber nachvollziehbar.
const lastLoggedAt = new Map();
const RATE_LIMIT_MS = 10_000;

export const quietLog = (scope, error, detail = '') => {
  if (!error) return;
  const now = Date.now();
  const last = lastLoggedAt.get(scope) || 0;
  if (now - last < RATE_LIMIT_MS) return;
  lastLoggedAt.set(scope, now);
  const suffix = detail ? ` · ${String(detail).slice(0, 200)}` : '';
  console.warn(`[${scope}] ${error?.message || error}${suffix}`);
};

export const QUIET_LOG_SCOPE = {
  publicCallVote: 'public-call-vote',
  tempVoice: 'temp-voice',
  botUpdates: 'bot-updates',
  welcomeFarewell: 'welcome-farewell',
  memberVerify: 'member-verify',
  embedService: 'embed-service',
  boostRoles: 'boost-roles',
  activityRace: 'activity-race',
  levels: 'levels',
  counting: 'counting',
  heavenEconomy: 'heaven-economy',
  memberManagement: 'member-management',
  serverBackup: 'server-backup',
  serverContext: 'server-context',
  moderation: 'moderation'
};
