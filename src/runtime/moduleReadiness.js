const getByPath = (source, path) => String(path || '').split('.').reduce((value, part) => value?.[part], source);

const toList = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') return value.split(/\r?\n|,/).map((entry) => entry.trim()).filter(Boolean);
  return value === null || value === undefined ? [] : [value];
};

const hasValue = (value) => {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return String(value ?? '').trim().length > 0;
};

const roleIdsFromValue = (value) => {
  const ids = [];
  for (const entry of toList(value)) {
    if (entry && typeof entry === 'object') {
      const id = String(entry.roleId || entry.id || '').trim();
      if (id) ids.push(id);
      continue;
    }
    const text = String(entry || '').trim();
    const mapped = text.match(/(?:^|[:|=,;\s])(\d{15,22})(?:$|[:|=,;\s])/u)?.[1] || (/^\d{15,22}$/u.test(text) ? text : '');
    if (mapped) ids.push(mapped);
  }
  return [...new Set(ids)];
};

const channelIdsFromValue = (value) => [...new Set(toList(value).map((entry) => String(entry?.id || entry || '').trim()).filter(Boolean))];

const issue = (severity, code, message, fieldKey = '') => ({ severity, code, message, fieldKey });

const requireSetting = (issues, section, path, message, when = true) => {
  if (when && !hasValue(getByPath(section, path))) issues.push(issue('error', 'missing-setting', message, path));
};

const inspectConfiguredRequirements = (featureId, section, issues) => {
  switch (featureId) {
    case 'customRichPresence':
      requireSetting(issues, section, 'applicationId', 'Die Discord Application ID fehlt.', true);
      break;
    case 'welcomeFarewell':
      requireSetting(issues, section, 'welcomeChannelId', 'Für aktive Begrüßungen fehlt der Welcome-Kanal.', section.welcomeEnabled === true);
      requireSetting(issues, section, 'verificationRoleId', 'Für die Begrüßung nach Verifizierung fehlt die Unverified-Rolle.', section.welcomeEnabled === true && section.welcomeAfterVerification === true);
      requireSetting(issues, section, 'farewellChannelId', 'Für aktive Verabschiedungen fehlt der Farewell-Kanal.', section.farewellEnabled === true);
      requireSetting(issues, section, 'autoRoleName', 'Für die aktive Beitrittsrolle wurde keine Rolle ausgewählt.', section.autoRoleEnabled === true);
      break;
    case 'autoresponder':
      requireSetting(issues, section, 'rules', 'Mindestens eine Antwortregel ist erforderlich.');
      break;
    case 'aiChat':
      requireSetting(issues, section, 'channelId', 'Der AI-Chat-Kanal fehlt.');
      requireSetting(issues, section, 'model', 'Das Ollama-Modell fehlt.');
      requireSetting(issues, section, 'ollamaUrl', 'Die lokale Ollama-Adresse fehlt.');
      break;
    case 'tickets':
      requireSetting(issues, section, 'panelChannelId', 'Der Kanal für das Ticket-Panel fehlt.');
      requireSetting(issues, section, 'categoryId', 'Im Kanalmodus fehlt die Ticket-Kategorie.', section.useThreadMode !== true);
      if (!hasValue(section.supportRoleId)) issues.push(issue('warning', 'recommended-setting', 'Ohne Support-Rolle sehen nur ausdrücklich berechtigte Personen die Tickets.', 'supportRoleId'));
      break;
    case 'logging':
      requireSetting(issues, section, 'channelId', 'Der private Protokollkanal fehlt.');
      break;
    case 'forumCleaner':
      requireSetting(issues, section, 'channelIds', 'Wähle mindestens einen Forum- oder Media-Kanal aus.');
      if (section.dryRun === true) issues.push(issue('info', 'safe-mode', 'Der Prüfmodus ist aktiv: Es wird noch nichts gelöscht.', 'dryRun'));
      break;
    case 'steamWorkshop':
      requireSetting(issues, section, 'forumChannelId', 'Wähle das Forum für den Workshop-Katalog aus.');
      requireSetting(issues, section, 'workshopIds', 'Füge mindestens eine Steam-Workshop-ID hinzu.');
      requireSetting(issues, section, 'updateChannelId', 'Für aktive Update-Meldungen fehlt der Textkanal.', section.notifyOnUpdate === true);
      break;
    case 'emojiManager':
      requireSetting(issues, section, 'oldPrefix', 'Das bisherige Emoji-Präfix fehlt.');
      requireSetting(issues, section, 'newPrefix', 'Das neue Emoji-Präfix fehlt.');
      if (hasValue(section.oldPrefix) && String(section.oldPrefix) === String(section.newPrefix)) {
        issues.push(issue('error', 'same-prefix', 'Altes und neues Emoji-Präfix dürfen nicht identisch sein.', 'newPrefix'));
      }
      break;
    case 'voiceChatCleaner':
      requireSetting(issues, section, 'voiceChannelIds', 'Wähle mindestens einen Voice- oder Stage-Kanal aus.');
      if (section.dryRun === true) issues.push(issue('info', 'safe-mode', 'Der Prüfmodus ist aktiv: Chatnachrichten werden nur gezählt.', 'dryRun'));
      break;
    case 'autoRole':
      requireSetting(issues, section, 'roleIds', 'Wähle mindestens eine Beitrittsrolle aus.');
      break;
    case 'serverTagTracker':
      requireSetting(issues, section, 'roleIds', 'Wähle mindestens eine Server-Tag-Rolle aus.');
      if (section.monitorOnly === true) issues.push(issue('info', 'safe-mode', 'Der Beobachtungsmodus ist aktiv: Rollen werden noch nicht verändert.', 'monitorOnly'));
      break;
    case 'boostRoles':
      if (!hasValue(section.automaticRoleIds) && !hasValue(section.tierRoleMappings)) {
        issues.push(issue('error', 'missing-setting', 'Wähle mindestens eine Basis- oder Staffelrolle aus.', 'automaticRoleIds'));
      }
      break;
    case 'heavenEconomy':
      requireSetting(issues, section, 'panelChannelId', 'Der Kanal für das VIP- und Coin-Panel fehlt.');
      requireSetting(issues, section, 'vipRoleMappings', 'Mindestens eine VIP-Stufe muss einer Discord-Rolle zugeordnet sein.');
      break;
    case 'activityRace': {
      const roleFields = [
        'separatorRoleId',
        ...['daily', 'weekly', 'monthly'].flatMap((period) => ['Chat', 'Voice'].flatMap((metric) => [1, 2, 3].map((place) => `${period}${metric}${place === 1 ? '' : `Top${place}`}RoleId`)))
      ];
      if (roleFields.some((field) => !hasValue(section[field]))) {
        issues.push(issue('error', 'missing-setting', 'Das Rollenset der Aktivitäts-Liga für Platz 1 bis 3 ist noch nicht vollständig ausgewählt oder bestätigt.', 'dailyChatRoleId'));
      }
      break;
    }
    case 'moderation':
      if (String(section.mode || section.actionMode || 'observe') === 'enforce' && !hasValue(section.logChannelId)) {
        issues.push(issue('warning', 'recommended-setting', 'Im Durchsetzen-Modus wird ein privater Moderationskanal dringend empfohlen.', 'logChannelId'));
      }
      break;
    case 'antiraid':
      if (!hasValue(section.logChannelId)) issues.push(issue('warning', 'recommended-setting', 'Ohne privaten Protokollkanal sind Raid-Entscheidungen schwerer nachvollziehbar.', 'logChannelId'));
      requireSetting(issues, section, 'quarantineRoleId', 'Für die Aktion „Quarantäne“ fehlt die Quarantäne-Rolle.', section.action === 'quarantine');
      if (section.action === 'observe') issues.push(issue('info', 'safe-mode', 'Der sichere Beobachtungsmodus ist aktiv.', 'action'));
      break;
    default:
      break;
  }
};

const permissionRequirements = (featureId, section) => {
  const requirements = [];
  if (['welcomeFarewell', 'levels', 'activityRace', 'autoRole', 'serverTagTracker', 'boostRoles', 'heavenEconomy'].includes(featureId)) {
    requirements.push(['manageRoles', 'Dem Bot fehlt „Rollen verwalten“.']);
  }
  if (featureId === 'moderation' && (section.muteRoleId || section.actionMode === 'enforce')) requirements.push(['manageRoles', 'Dem Bot fehlt „Rollen verwalten“ für Moderationsrollen.']);
  if (featureId === 'antiraid' && section.action === 'quarantine') requirements.push(['manageRoles', 'Dem Bot fehlt „Rollen verwalten“ für die Quarantäne.']);
  if (featureId === 'forumCleaner' && section.dryRun !== true) requirements.push(['manageThreads', 'Dem Bot fehlt „Threads verwalten“ für die automatische Forenbereinigung.']);
  if (featureId === 'steamWorkshop') {
    requirements.push(['sendMessages', 'Dem Bot fehlt „Nachrichten senden“ für den Workshop-Katalog.']);
    if (section.pinPosts === true) requirements.push(['manageThreads', 'Dem Bot fehlt „Threads verwalten“ zum Anpinnen der Workshop-Posts.']);
  }
  if (featureId === 'voiceChatCleaner' && section.dryRun !== true) requirements.push(['manageMessages', 'Dem Bot fehlt „Nachrichten verwalten“ für die Voice-Chat-Bereinigung.']);
  if (featureId === 'emojiManager') requirements.push(['manageExpressions', 'Dem Bot fehlt „Ausdrücke verwalten“ für Emoji-Änderungen.']);
  if (featureId === 'tickets') {
    requirements.push(section.useThreadMode === true
      ? ['createPrivateThreads', 'Dem Bot fehlt „Private Threads erstellen“.']
      : ['manageChannels', 'Dem Bot fehlt „Kanäle verwalten“ für neue Ticket-Kanäle.']);
  }
  return requirements;
};

export const createModuleReadinessSnapshot = ({
  guildId = '',
  guildName = '',
  config = {},
  featureCards = [],
  channels = [],
  roles = [],
  capabilities = {},
  runtimeSnapshot = null
} = {}) => {
  const channelMap = new Map(channels.map((entry) => [String(entry.id || ''), entry]));
  const roleMap = new Map(roles.map((entry) => [String(entry.id || ''), entry]));
  const runtimeMap = new Map((runtimeSnapshot?.features || []).map((entry) => [String(entry.featureId || ''), entry]));

  const modules = featureCards.map((feature) => {
    const featureId = String(feature.id || '');
    const section = config?.[featureId] && typeof config[featureId] === 'object' ? config[featureId] : {};
    const enabled = section.enabled !== false;
    const issues = [];
    inspectConfiguredRequirements(featureId, section, issues);

    const configuredRoleIds = new Set();
    const configuredChannelIds = new Set();
    for (const field of feature.fields || []) {
      const type = String(field.type || '').toLocaleLowerCase('de-DE');
      const localKey = String(field.key || '').startsWith(`${featureId}.`) ? String(field.key).slice(featureId.length + 1) : field.key;
      const value = getByPath(section, localKey);
      if (type === 'roleselect' || type === 'multiroleselect' || type === 'rolemappingselect') {
        roleIdsFromValue(value).forEach((id) => configuredRoleIds.add(id));
      }
      if (type === 'channelselect' || type === 'multichannelselect') {
        channelIdsFromValue(value).forEach((id) => configuredChannelIds.add(id));
      }
    }

    for (const channelId of configuredChannelIds) {
      if (!channelMap.has(channelId)) issues.push(issue('error', 'missing-channel', `Der konfigurierte Kanal ${channelId} existiert nicht mehr auf dem Server.`));
    }
    for (const roleId of configuredRoleIds) {
      const role = roleMap.get(roleId);
      if (!role) issues.push(issue('error', 'missing-role', `Die konfigurierte Rolle ${roleId} existiert nicht mehr auf dem Server.`));
      else if (role.assignable === false) issues.push(issue('error', 'role-hierarchy', `Die Rolle „${role.name || roleId}“ liegt außerhalb der Bot-Rollenhierarchie.`));
    }

    for (const [capability, message] of permissionRequirements(featureId, section)) {
      if (capabilities?.[capability] === false) issues.push(issue('error', 'missing-permission', message));
    }

    const runtime = runtimeMap.get(featureId) || null;
    if (runtime?.lastError) issues.push(issue('warning', 'runtime-error', `Letzter Lauf: ${runtime.lastError}`));
    const errorCount = issues.filter((entry) => entry.severity === 'error').length;
    const warningCount = issues.filter((entry) => entry.severity === 'warning').length;
    const infoCount = issues.filter((entry) => entry.severity === 'info').length;
    const status = !enabled
      ? 'disabled'
      : Number(runtime?.running || 0) > 0
        ? 'running'
        : errorCount > 0
          ? 'blocked'
          : warningCount > 0
            ? 'attention'
            : 'ready';
    const score = enabled ? Math.max(0, 100 - (errorCount * 35) - (warningCount * 12)) : 0;

    return {
      id: featureId,
      title: String(feature.title || featureId),
      icon: String(feature.icon || 'FH'),
      enabled,
      canEnable: errorCount === 0,
      status,
      score,
      issueCounts: { error: errorCount, warning: warningCount, info: infoCount },
      issues,
      configuredResources: { channels: configuredChannelIds.size, roles: configuredRoleIds.size },
      runtime: runtime ? {
        queued: Number(runtime.queued || 0),
        running: Number(runtime.running || 0),
        completed: Number(runtime.completed || 0),
        failed: Number(runtime.failed || 0),
        lastHook: String(runtime.lastHook || ''),
        lastFinishedAt: runtime.lastFinishedAt || null,
        lastDurationMs: Number(runtime.lastDurationMs || 0)
      } : null
    };
  });

  const counts = {
    total: modules.length,
    enabled: modules.filter((entry) => entry.enabled).length,
    ready: modules.filter((entry) => ['ready', 'running'].includes(entry.status)).length,
    attention: modules.filter((entry) => entry.status === 'attention').length,
    blocked: modules.filter((entry) => entry.status === 'blocked').length,
    disabled: modules.filter((entry) => entry.status === 'disabled').length
  };

  return {
    version: 1,
    guildId: String(guildId || ''),
    guildName: String(guildName || ''),
    measuredAt: new Date().toISOString(),
    counts,
    score: counts.enabled ? Math.round(modules.filter((entry) => entry.enabled).reduce((sum, entry) => sum + entry.score, 0) / counts.enabled) : 100,
    modules
  };
};
