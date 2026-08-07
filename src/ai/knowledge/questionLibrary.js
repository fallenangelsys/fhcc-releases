/* ==========================================================================
   FH AI · QUESTION LIBRARY
   --------------------------------------------------------------------------
   Große, strukturierte Bibliothek für Server-Fragen im AI-Chat.

   Erkennt hunderte deutsche Formulierungen und beantwortet sie direkt aus
   dem Live-Server-Snapshot (buildServerSnapshot) bzw. dem Discord-Guild –
   ohne Umweg über das Sprachmodell. Die Bibliothek wird nach allen
   spezialisierten Intents geprüft und ergänzt diese gezielt um Kategorien,
   die bisher nur über den freien Sprachmodell-Pfad liefen oder ganz fehlten:

   • Server-Zweck / Konzept
   • Rekorde: ältestes/neuestes Mitglied, längster Booster
   • Boost-Ziel: wie viele Boosts bis zur nächsten Stufe
   • Rollen-Farben, Mitgliederzahl je Rolle
   • Kanal-Details: Slowmode, Thema, Erstellungsdatum
   • Kategorien- und Voice-Kanal-Verzeichnis
   • Serverzeit / Zeitzone
   • Discord-Features des Servers
   • Wann bin ich/ist X beigetreten

   Die Bibliothek ist bewusst ohne Importe aus aiChat.js gehalten (nur
   Standalone-Helper), damit sie keine zirkulären Abhängigkeiten erzeugt.

   Hinweis: Alle Erkennungs-Patterns nutzen die ae/oe/ue/ss-Transkription,
   weil normalizeLibraryText Umlaute vor dem Matching in diese Form wandelt.
   ========================================================================== */

const normalizeLibraryText = (value = '') => String(value || '')
  .normalize('NFKC')
  .replace(/<a?:[A-Za-z0-9_~]{2,32}:\d{15,22}>/g, ' ')
  .replace(/<#(\d{15,22})>/g, ' #kanal ')
  .replace(/<@!?(\d{15,22})>/g, ' @user ')
  .replace(/<@&(\d{15,22})>/g, ' @rolle ')
  .toLowerCase()
  .replace(/ä/g, 'ae')
  .replace(/ö/g, 'oe')
  .replace(/ü/g, 'ue')
  .replace(/ß/g, 'ss')
  .replace(/[.!?,;:]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const unicodeTimestamp = (value, style = 'F') => {
  const parsed = Date.parse(String(value || ''));
  if (!Number.isFinite(parsed)) return '';
  return `<t:${Math.floor(parsed / 1000)}:${style}>`;
};

const safeName = (value = '') => String(value || 'Mitglied')
  .replace(/([\\`*_{}\[\]()#+\-.!~|>])/g, '\\$1')
  .replace(/@/g, '@\u200b')
  .slice(0, 80);

const oldestMember = (snapshot = {}) => {
  const members = Array.isArray(snapshot.members) ? snapshot.members : [];
  const humans = members
    .filter((entry) => entry && String(entry.joinedAt || ''))
    .sort((left, right) => String(left.joinedAt).localeCompare(String(right.joinedAt)));
  return humans[0] || null;
};

const newestJoinedMember = (snapshot = {}) => {
  const members = Array.isArray(snapshot.joinedWeekMembers) && snapshot.joinedWeekMembers.length
    ? snapshot.joinedWeekMembers
    : (Array.isArray(snapshot.members) ? snapshot.members : []);
  return members
    .filter((entry) => entry && String(entry.joinedAt || ''))
    .sort((left, right) => String(right.joinedAt).localeCompare(String(left.joinedAt)))[0] || null;
};

const longestBooster = (snapshot = {}) => {
  const boosters = Array.isArray(snapshot.boosters) ? snapshot.boosters : [];
  return boosters.sort((left, right) => String(left.premiumSinceTimestamp || '').localeCompare(String(right.premiumSinceTimestamp || '')))[0] || null;
};

const BOOST_TIER_GOALS = [2, 7, 14, 30, 60];

const nextBoostGoal = (boostCount = 0) => {
  const count = Math.max(0, Number(boostCount) || 0);
  for (let index = 0; index < BOOST_TIER_GOALS.length; index += 1) {
    const goal = BOOST_TIER_GOALS[index];
    if (count < goal) return { nextTier: index + 1, goal, missing: Math.max(0, goal - count) };
  }
  return null;
};

const findRoleByNameOrMention = (guild, content = '') => {
  if (!guild?.roles?.cache) return null;
  const mention = String(content || '').match(/<@&(\d{15,22})>/);
  if (mention) {
    const role = guild.roles.cache.get(mention[1]);
    if (role) return role;
  }
  const raw = normalizeLibraryText(content)
    .replace(/^(?:wie viele mitglieder haben die rolle|wie viele member haben die rolle|wie viele leute haben die rolle|wer hat die rolle|welche farbe hat die rolle|was ist die farbe der rolle|wem gehoert die rolle)\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw || raw.length > 48) return null;
  const role = [...guild.roles.cache.values()]
    .filter((candidate) => candidate.id !== guild.id && !candidate.managed)
    .find((candidate) => normalizeLibraryText(candidate.name) === raw);
  return role || null;
};

const findChannelByNameOrMention = (guild, content = '') => {
  if (!guild?.channels?.cache) return null;
  const mention = String(content || '').match(/<#(\d{15,22})>/);
  if (mention) {
    const channel = guild.channels.cache.get(mention[1]);
    if (channel) return channel;
  }
  const raw = normalizeLibraryText(content)
    .replace(/^(?:wie hoch ist der slowmode|was ist das thema|was steht im thema|wann wurde der kanal erstellt|wann wurde der channel erstellt|wie alt ist der kanal|wie alt ist der channel|wie lange gibt es den kanal|wie lange gibt es den channel|seit wann gibt es den kanal|seit wann gibt es den channel|das thema von|der slowmode)\s*(?:von|im|in|des|der)?\s*(?:#)?/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw || raw.length > 40) return null;
  return [...guild.channels.cache.values()]
    .filter((candidate) => [0, 5, 15, 16].includes(candidate.type))
    .find((candidate) => normalizeLibraryText(candidate.name) === raw) || null;
};

// Menschlich lesbare Altersangabe (Jahre/Monate/Tage) aus einem ISO-Datum.
const humanAge = (isoValue = '', now = new Date()) => {
  const parsed = Date.parse(String(isoValue || ''));
  if (!Number.isFinite(parsed) || parsed > now.getTime()) return '';
  const start = new Date(parsed);
  let years = now.getFullYear() - start.getFullYear();
  let months = now.getMonth() - start.getMonth();
  let days = now.getDate() - start.getDate();
  if (days < 0) {
    months -= 1;
    days += new Date(now.getFullYear(), now.getMonth(), 0).getDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  const parts = [];
  if (years > 0) parts.push(`${years} ${years === 1 ? 'Jahr' : 'Jahre'}`);
  if (months > 0) parts.push(`${months} ${months === 1 ? 'Monat' : 'Monate'}`);
  if (days > 0 || !parts.length) parts.push(`${days} ${days === 1 ? 'Tag' : 'Tage'}`);
  return parts.join(', ');
};

const textChannels = (guild) => [...(guild?.channels?.cache?.values?.() || [])]
  .filter((candidate) => [0, 5, 15, 16].includes(candidate.type) && candidate.createdTimestamp);

const oldestChannel = (guild) => textChannels(guild)
  .sort((left, right) => Number(left.createdTimestamp || 0) - Number(right.createdTimestamp || 0))[0] || null;

const newestChannel = (guild) => textChannels(guild)
  .sort((left, right) => Number(right.createdTimestamp || 0) - Number(left.createdTimestamp || 0))[0] || null;

const ordinalPosition = (position = 0) => {
  if (position === 1) return 'erste';
  if (position === 2) return 'zweite';
  if (position === 3) return 'dritte';
  return `${position}.`;
};

const LIBRARY_ENTRIES = [
  {
    type: 'server-purpose',
    label: 'Server-Zweck',
    patterns: [
      /wof(?:ue|u)r ist (?:dieser|der|unser|euer) (?:discord[ -]?)?server(?: da)?$/,
      /was ist (?:der zweck|das ziel|der sinn|das konzept|die idee) (?:von|hinter|des) (?:diesem|dem|unserem|eurem)? ?(?:discord[ -]?)?server/,
      /was (?:kann|macht|macht man) man (?:hier|auf diesem server|auf dem server)/,
      /was ist (?:das|dieses|unser|euer) (?:server)?konzept/,
      /worum (?:geht es|dreht es sich) (?:hier|auf (?:diesem|dem|unserem) server)/,
      /was (?:ist|sind) (?:der sinn|die aufgabe) (?:von|des) (?:diesem|dem) server/
    ],
    build: ({ snapshot = {}, content = '' }) => {
      const description = String(snapshot.description || '').trim();
      const stats = [
        snapshot.memberCount ? `**${snapshot.memberCount} Mitglieder** (${snapshot.humanCount} Menschen, ${snapshot.botCount} Bots)` : '',
        snapshot.channelCount ? `**${snapshot.channelCount} Kanäle** (${snapshot.textChannelCount} Text/Forum, ${snapshot.voiceChannelCount} Voice)` : '',
        snapshot.roleCount ? `**${snapshot.roleCount} Rollen**` : '',
        snapshot.emojiCount ? `**${snapshot.emojiCount} Emojis**` : '',
        snapshot.boostCount ? `**${snapshot.boostCount} Boosts** auf Stufe ${snapshot.boostTier}` : ''
      ].filter(Boolean);
      const purpose = description
        ? `**${snapshot.name}** ist ein Server rund um: ${description.slice(0, 600)}`
        : `**${snapshot.name}** hat aktuell keine offizielle Serverbeschreibung hinterlegt.`;
      const context = /(?:fall|heaven|minecraft|game|zock|community)/i.test(String(content || ''))
        ? ''
        : '\nBei Fallen Heaven findest du außerdem Module wie Aktivitäts-Liga, VIP-/Coin-System, Leveling, Tickets und mehr – frag mich einfach nach Details.';
      return `${purpose}${stats.length ? `\nÜberblick: ${stats.join(' · ')}.` : ''}${context}`;
    }
  },
  {
    type: 'oldest-member',
    label: 'Ältestes Mitglied',
    patterns: [
      /wer ist (?:das )?aelteste (?:mitglied|member)/,
      /wer ist am laengsten (?:dabei|auf dem server|im server|mitglied)/,
      /wer war (?:als )?(?:der )?erste(?: auf dem server| hier)?$/,
      /wer ist (?:schon )?am laengsten hier/,
      /wer ist das aelteste mitglied auf dem server/,
      /welches mitglied ist am aeltesten/
    ],
    build: ({ snapshot = {} }) => {
      const oldest = oldestMember(snapshot);
      if (!oldest) return 'Aus den aktuell geladenen Mitgliedsdaten lässt sich das älteste Mitglied nicht sicher bestimmen.';
      const joined = unicodeTimestamp(oldest.joinedAt, 'D');
      const username = String(oldest.username || '').trim();
      const suffix = username && username.toLocaleLowerCase('de-DE') !== String(oldest.displayName || '').toLocaleLowerCase('de-DE')
        ? ` (\`${username.replace(/`/g, '´').slice(0, 32)}\`)`
        : '';
      return `Das am längsten dabei befindliche Mitglied ist **${safeName(oldest.displayName)}**${suffix}${joined ? ` – beigetreten am ${joined}` : ''}.`;
    }
  },
  {
    type: 'newest-member',
    label: 'Neuestes Mitglied',
    patterns: [
      /wer ist (?:das )?(?:neueste|neuesten|juengste|juengste) (?:mitglied|member)/,
      /wer ist (?:als |der |das )?(?:letzte|letzter|zuletzt) (?:beigetreten|gejoint|dazugekommen)/,
      /wer ist zuletzt (?:beigetreten|gejoint|gekommen|dazugekommen)/,
      /welches (?:mitglied|member) ist als letztes (?:beigetreten|gejoint)/,
      /wer kam als letztes (?:auf den server|dazu|hierher)/
    ],
    build: ({ snapshot = {} }) => {
      const newest = newestJoinedMember(snapshot);
      if (!newest) return 'Aus den aktuell geladenen Mitgliedsdaten lässt sich das neueste Mitglied nicht sicher bestimmen.';
      const joined = unicodeTimestamp(newest.joinedAt, 'R');
      return `Das zuletzt beigetretene Mitglied ist **${safeName(newest.displayName)}**${joined ? ` (${joined})` : ''}.`;
    }
  },
  {
    type: 'boost-goal',
    label: 'Boost-Ziel',
    patterns: [
      /wie viele boosts (?:brauchen wir|fehlen|noch|bis|fuer die naechste|fuer die naechste|bis zur naechsten|bis zur naechsten)/,
      /wann (?:erreichen wir|haben wir|kommen wir auf|sind wir bei) (?:die )?naechste (?:boost)?stufe/,
      /boosts bis (?:zur )?(?:stufe|tier|level) ?\d?/,
      /wie viele boosts fehlen bis/,
      /wie weit (?:sind wir|ist der server) (?:mit den )?boosts/,
      /boosts bis zur naechsten stufe/,
      /wann gibt es die naechste boost stufe/
    ],
    build: ({ snapshot = {} }) => {
      const count = Math.max(0, Number(snapshot.boostCount || 0));
      const tier = Math.max(0, Number(snapshot.boostTier || 0));
      const goal = nextBoostGoal(count);
      const boosterLine = snapshot.boosterCount
        ? `\nAktuell boosten **${snapshot.boosterCount} ${snapshot.boosterCount === 1 ? 'Mitglieder' : 'Mitglieder'}** den Server.`
        : '';
      if (!goal) {
        return `Der Server hat **${count} Boosts** und damit die höchste erreichbare Boost-Stufe (Stufe ${tier}) erreicht${boosterLine}.`;
      }
      const goalLine = `Aktuell hat der Server **${count} Boosts** und ist auf Stufe **${tier}**. Für die nächste Stufe (Stufe **${goal.nextTier}**, ${goal.goal} Boosts) fehlen noch **${goal.missing} ${goal.missing === 1 ? 'Boost' : 'Boosts'}**.`;
      return boosterLine ? `${goalLine}\n${boosterLine}` : goalLine;
    }
  },
  {
    type: 'longest-booster',
    label: 'Längster Booster',
    patterns: [
      /wer boosted (?:schon )?(?:am laengsten|am laengsten)/,
      /wer boostet am laengsten/,
      /(?:aeltester|aeltester) booster/,
      /wer ist (?:der )?aelteste booster/,
      /wer boosted schon am laengsten/
    ],
    build: ({ snapshot = {} }) => {
      const booster = longestBooster(snapshot);
      if (!booster) return 'Aktuell wurde noch kein aktiver Booster erkannt, der längere Zeit boosted.';
      const since = unicodeTimestamp(booster.premiumSinceTimestamp, 'D');
      return `**${safeName(booster.displayName)}** boostet am längsten${since ? ` (seit ${since})` : ''}.`;
    }
  },
  {
    type: 'role-color',
    label: 'Rollen-Farbe',
    patterns: [
      /welche farbe hat (?:die )?rolle/,
      /welche farbe hat die rolle @?/,
      /was ist die farbe (?:der|von) rolle/,
      /welche farbe hat (?:der|die|das) (?:rolle|role)/,
      /wie ist die farbe der rolle/
    ],
    build: ({ guild, content = '' }) => {
      const role = findRoleByNameOrMention(guild, content);
      if (!role) return '';
      const hex = `#${Number(role.color || 0).toString(16).padStart(6, '0').toUpperCase()}`;
      return `Die Rolle **${safeName(role.name)}** hat die Farbe **${hex}**${Number(role.color || 0) ? ` ${role.toString()}` : ''}.`;
    }
  },
  {
    type: 'role-member-count',
    label: 'Mitglieder je Rolle',
    patterns: [
      /wie viele (?:mitglieder|member|leute|user) (?:haben|tragen|besitzen|sind in) (?:die )?rolle/,
      /wie viele leute haben die rolle/,
      /wie viele member haben die rolle/,
      /wie viele user (?:haben|tragen) die rolle/,
      /wie viele personen haben die rolle/,
      /wie gross ist die rolle/,
      /wie viele mitglieder sind in der rolle/
    ],
    build: ({ guild, content = '' }) => {
      const role = findRoleByNameOrMention(guild, content);
      if (!role) return '';
      const count = Number(role.members?.size || 0);
      return `Die Rolle **${safeName(role.name)}** hat aktuell **${count} ${count === 1 ? 'Mitglied' : 'Mitglieder'}**.`;
    }
  },
  {
    type: 'channel-slowmode',
    label: 'Kanal-Slowmode',
    patterns: [
      /wie hoch ist (?:der )?(?:slowmode|langsammodus)/,
      /(?:slowmode|langsammodus) (?:im|in|im kanal|im channel)/,
      /wie lang ist der slowmode/,
      /welchen slowmode hat (?:der|die) (?:kanal|channel)/
    ],
    build: ({ guild, content = '' }) => {
      const channel = findChannelByNameOrMention(guild, content);
      if (!channel) return '';
      const seconds = Math.max(0, Number(channel.rateLimitPerUser || 0));
      if (!seconds) return `In <#${channel.id}> ist aktuell **kein Slowmode** aktiv.`;
      const human = seconds >= 3600
        ? `${(seconds / 3600).toLocaleString('de-DE', { maximumFractionDigits: 1 })} Stunden`
        : seconds >= 60
          ? `${Math.round(seconds / 60)} Minuten`
          : `${seconds} Sekunden`;
      return `In <#${channel.id}> gilt ein Slowmode von **${human}** (${seconds}s).`;
    }
  },
  {
    type: 'channel-topic',
    label: 'Kanal-Thema',
    patterns: [
      /was ist das thema (?:von|des|im|in|der)? ?(?:kanal|channel|#)/,
      /was steht (?:im|in|in dem) (?:them(?:a|e)|topic)/,
      /thema von (?:dem|der|dem) (?:kanal|channel)/,
      /was steht als thema/,
      /wie lautet das thema des kanals/,
      /welches thema hat der kanal/
    ],
    build: ({ guild, content = '' }) => {
      const channel = findChannelByNameOrMention(guild, content);
      if (!channel) return '';
      const topic = String(channel.topic || '').trim();
      return topic
        ? `Das Thema von <#${channel.id}>: ${topic.slice(0, 900)}`
        : `Für <#${channel.id}> ist aktuell kein Thema hinterlegt.`;
    }
  },
  {
    type: 'server-time',
    label: 'Serverzeit / Zeitzone',
    patterns: [
      /wie spaet ist es/,
      /welche uhrzeit (?:ist es|haben wir)/,
      /wie viel uhr (?:ist es|haben wir)/,
      /welche zeitzone/,
      /wie spaet ist es bei euch/,
      /welche zeit ist es auf dem server/
    ],
    build: ({ snapshot = {} }) => {
      const zone = String(snapshot.timezone || 'Europe/Berlin');
      let now = '';
      try {
        now = new Intl.DateTimeFormat('de-DE', { timeZone: zone, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date());
      } catch {
        now = new Date().toLocaleTimeString('de-DE');
      }
      return `Auf dem Server (Zeitzone **${zone}**) ist es gerade **${now} Uhr**.`;
    }
  },
  {
    type: 'server-features',
    label: 'Discord-Features',
    patterns: [
      /welche features hat (?:der|unser|der server)/,
      /ist der server (?:community|verifiziert|partner|discoverable)/,
      /hat der server (?:animated icon|banner|discoverable|community)/,
      /ist (?:dieser|der|unser) server verifiziert/,
      /welche discord features hat der server/
    ],
    build: ({ guild = {} }) => {
      const features = new Set(guild.features || []);
      const lines = [
        features.has('COMMUNITY') ? '• Community-Modus aktiv' : null,
        features.has('DISCOVERABLE') ? '• Über Discovery auffindbar' : null,
        features.has('VERIFIED') ? '• Offiziell verifiziert' : null,
        features.has('PARTNERED') ? '• Discord-Partner-Server' : null,
        features.has('ANIMATED_ICON') ? '• Animiertes Server-Icon' : null,
        features.has('BANNER') ? '• Server-Banner freigeschaltet' : null,
        features.has('INVITE_SPLASH') ? '• Einladungs-Splash' : null,
        features.has('NEW_THREAD_PERMISSIONS') ? '• Aktuelle Thread-Berechtigungen' : null,
        features.has('PRIVATE_THREADS') ? '• Private Threads' : null,
        features.has('SEVEN_DAY_THREAD_ARCHIVE') || features.has('THREE_DAY_THREAD_ARCHIVE') ? '• Erweiterte Thread-Archive' : null
      ].filter(Boolean);
      const name = String(guild.name || 'Der Server');
      if (!lines.length) return `${name} hat aktuell keine besonderen Discord-Features aktiviert (kein Community-Modus, keine Discovery, keine Verifizierung).`;
      return `${name} hat diese Discord-Features aktiv:\n${lines.join('\n')}`;
    }
  },
  {
    type: 'self-joined-date',
    label: 'Mein Beitrittsdatum',
    patterns: [
      /wann (?:bin ich|war ich|habe ich) (?:gejoint|beigetreten)/,
      /seit wann bin ich (?:dabei|hier|auf dem server|mitglied)/,
      /wann bin ich auf den server gekommen/,
      /wann bin ich dem server beigetreten/,
      /wie lange bin ich schon dabei/,
      /seit wann bin ich auf dem server/
    ],
    build: ({ snapshot = {}, message = null }) => {
      const userId = String(message?.author?.id || '');
      const members = Array.isArray(snapshot.members) ? snapshot.members : [];
      const entry = members.find((candidate) => String(candidate.id || '') === userId);
      if (!entry || !entry.joinedAt) return 'Ich kann dein Beitrittsdatum gerade nicht sicher aus den geladenen Mitgliedsdaten ablesen.';
      return `Du bist ${unicodeTimestamp(entry.joinedAt, 'R')} beigetreten (${unicodeTimestamp(entry.joinedAt, 'D')}).`;
    }
  },
  {
    type: 'category-list',
    label: 'Kategorien-Verzeichnis',
    patterns: [
      /welche kategorien gibt es/,
      /wie viele kategorien gibt es/,
      /welche kategorien hat der server/,
      /wie viele kategorien hat der server/,
      /welche kategorien (?:haben wir|gibt es) auf dem server/,
      /wie viele kategorien (?:haben wir|gibt es)/
    ],
    build: ({ guild = {}, snapshot = {} }) => {
      const categories = [...(guild.channels?.cache?.values?.() || [])]
        .filter((channel) => channel.type === 4)
        .sort((left, right) => Number(left.position || 0) - Number(right.position || 0));
      const total = Math.max(0, Number(snapshot.categoryCount || categories.length || 0));
      if (!categories.length) return `Der Server hat **${total} Kategorien** (noch nicht einzeln sichtbar).`;
      return `Der Server hat **${total} Kategorien**:\n${categories.map((category) => `• **${category.name}**`).join('\n')}`;
    }
  },
  {
    type: 'voice-channel-list',
    label: 'Voice-Kanäle',
    patterns: [
      /welche (?:voice|sprach)[ -]?kanaele gibt es/,
      /welche (?:voice|sprach)[ -]?kanaele (?:haben wir|gibt es) auf dem server/,
      /wie viele (?:voice|sprach)[ -]?kanaele gibt es/,
      /welche sprachkanaele gibt es/
    ],
    build: ({ guild = {}, snapshot = {} }) => {
      const voice = [...(guild.channels?.cache?.values?.() || [])]
        .filter((channel) => [2, 13].includes(channel.type))
        .sort((left, right) => Number(left.position || 0) - Number(right.position || 0));
      const total = Math.max(0, Number(snapshot.voiceChannelCount || voice.length || 0));
      if (!voice.length) return `Der Server hat **${total} Voice-Kanäle** (noch nicht einzeln sichtbar).`;
      return `Der Server hat **${total} Voice-Kanäle**:\n${voice.map((channel) => `• ${channel.type === 13 ? '🎭' : '🔊'} <#${channel.id}>`).join('\n')}`;
    }
  },
  {
    type: 'server-age',
    label: 'Server-Alter',
    patterns: [
      /wie lange gibt es (?:diesen|den|unseren|euren) (?:discord[ -]?)?server(?: schon)?$/,
      /wie lange existiert (?:dieser|der|unser) (?:discord[ -]?)?server/,
      /wie lange besteht (?:dieser|der|unser) (?:discord[ -]?)?server(?: schon)?/,
      /wie alt ist (?:dieser|der|unser) (?:discord[ -]?)?server/,
      /seit wann (?:gibt es|existiert|besteht) (?:dieser|der|unser|diesen|den) (?:discord[ -]?)?server/,
      /wann wurde (?:dieser|der|unser) (?:discord[ -]?)?server (?:erstellt|gegruendet|gegruendet worden)/,
      /wann ist (?:dieser|der|unser) (?:discord[ -]?)?server (?:entstanden|erstellt worden)/
    ],
    build: ({ snapshot = {} }) => {
      const created = String(snapshot.createdAt || '');
      if (!created) return '';
      const age = humanAge(created);
      return `Der Discord-Server **${snapshot.name}** existiert seit dem ${unicodeTimestamp(created, 'D')} – das sind **${age}**.`;
    }
  },
  {
    type: 'channel-age',
    label: 'Kanal-Alter',
    patterns: [
      /wie lange gibt es (?:den|diesen|unseren) (?:kanal|channel)(?: schon)?$/,
      /wie alt ist (?:der|dieser|unser) (?:kanal|channel)/,
      /seit wann (?:gibt es|existiert|besteht) (?:der|dieser|unser) (?:kanal|channel)/,
      /wann wurde (?:der|dieser|unser) (?:kanal|channel) (?:erstellt|gegruendet)/
    ],
    build: ({ guild, content = '' }) => {
      const channel = findChannelByNameOrMention(guild, content);
      if (!channel?.createdTimestamp) return '';
      const created = new Date(channel.createdTimestamp).toISOString();
      return `Der Kanal <#${channel.id}> wurde am ${unicodeTimestamp(created, 'D')} erstellt – er existiert seit **${humanAge(created)}**.`;
    }
  },
  {
    type: 'channel-oldest',
    label: 'Ältester Kanal',
    patterns: [
      /welcher (?:kanal|channel) ist (?:der |die )?(?:aelteste|am aeltesten)/,
      /welcher (?:kanal|channel) wurde (?:als erster|zuerst|am fruehesten) (?:erstellt|angelegt)/,
      /welcher (?:kanal|channel) existiert am laengsten/,
      /welcher (?:kanal|channel) ist am aeltesten/
    ],
    build: ({ guild = {} }) => {
      const channel = oldestChannel(guild);
      if (!channel) return '';
      const created = new Date(channel.createdTimestamp).toISOString();
      return `Der älteste Kanal ist <#${channel.id}> (**${channel.name}**), erstellt am ${unicodeTimestamp(created, 'D')} – existiert seit **${humanAge(created)}**.`;
    }
  },
  {
    type: 'channel-newest',
    label: 'Neuester Kanal',
    patterns: [
      /welcher (?:kanal|channel) ist (?:der |die )?neueste/,
      /welcher (?:kanal|channel) wurde (?:als letzter|zuletzt) (?:erstellt|angelegt)/,
      /welcher (?:kanal|channel) ist am juengsten/,
      /welcher (?:kanal|channel) existiert am kuerzesten/
    ],
    build: ({ guild = {} }) => {
      const channel = newestChannel(guild);
      if (!channel) return '';
      const created = new Date(channel.createdTimestamp).toISOString();
      return `Der neueste Kanal ist <#${channel.id}> (**${channel.name}**), erstellt am ${unicodeTimestamp(created, 'D')}.`;
    }
  },
  {
    type: 'member-join-position',
    label: 'Mein Beitrittsplatz',
    patterns: [
      /der wievielte (?:beitritt|join|member|mitglied) (?:bin ich|war ich)/,
      /wievielter (?:beitritt|join|member|mitglied) (?:bin ich|war ich)/,
      /wie viele (?:member|mitglieder|leute|personen) waren (?:vor mir|schon (?:vor|da) mir) (?:auf dem server|da|beigetreten)/,
      /wie viele (?:waren|sind) (?:schon )?vor mir (?:auf dem server|beigetreten|dabei)/,
      /wie viele (?:waren|sind) schon (?:auf dem server|hier) bevor ich kam/
    ],
    build: ({ snapshot = {}, message = null }) => {
      const userId = String(message?.author?.id || '');
      if (!userId) return '';
      const members = (Array.isArray(snapshot.members) ? snapshot.members : [])
        .filter((entry) => entry && String(entry.joinedAt || ''))
        .sort((left, right) => String(left.joinedAt).localeCompare(String(right.joinedAt)));
      if (!members.length) return '';
      const index = members.findIndex((entry) => String(entry.id || '') === userId);
      if (index < 0) return '';
      const position = index + 1;
      return `Du warst der/die **${ordinalPosition(position)} Mensch** auf dem Server – von den erfassten ${members.length} Menschen.`;
    }
  },
  {
    type: 'member-joined-date',
    label: 'Beitrittsdatum eines Mitglieds',
    patterns: [
      /wann (?:ist|war) (?:er|sie|es|dieses mitglied|der user|diese person) (?:gejoint|beigetreten)/,
      /seit wann ist (?:er|sie|diese person) (?:dabei|hier|auf dem server)/,
      /wann ist @user beigetreten/,
      /wann ist das mitglied beigetreten/
    ],
    build: ({ snapshot = {}, message = null, content = '' }) => {
      const mention = String(content || '').match(/<@!?(\d{15,22})>/);
      const targetId = mention ? mention[1] : '';
      const referenced = message?.mentions?.members?.first?.();
      const members = Array.isArray(snapshot.members) ? snapshot.members : [];
      const entry = targetId
        ? members.find((candidate) => String(candidate.id || '') === targetId)
        : referenced
          ? members.find((candidate) => String(candidate.id || '') === String(referenced.id))
          : null;
      if (!entry?.joinedAt) return 'Ich kann das Beitrittsdatum für dieses Mitglied gerade nicht sicher bestimmen. Erwähne die Person bitte direkt.';
      return `<@${entry.id}> ist ${unicodeTimestamp(entry.joinedAt, 'R')} beigetreten (${unicodeTimestamp(entry.joinedAt, 'D')}).`;
    }
  }
];

const matchQuestionLibraryIntentImpl = (content = '') => {
  const text = normalizeLibraryText(content);
  if (!text) return null;
  for (const entry of LIBRARY_ENTRIES) {
    if (entry.patterns.some((pattern) => pattern.test(text))) return entry.type;
  }
  return null;
};

const buildQuestionLibraryAnswerImpl = (type, context = {}) => {
  const entry = LIBRARY_ENTRIES.find((candidate) => candidate.type === type);
  if (!entry) return '';
  try {
    return String(entry.build(context) || '');
  } catch {
    return '';
  }
};

export const matchQuestionLibraryIntent = matchQuestionLibraryIntentImpl;
export const buildQuestionLibraryAnswer = buildQuestionLibraryAnswerImpl;

export const _questionLibraryInternals = {
  normalizeLibraryText,
  matchQuestionLibraryIntent: matchQuestionLibraryIntentImpl,
  buildQuestionLibraryAnswer: buildQuestionLibraryAnswerImpl,
  nextBoostGoal,
  LIBRARY_ENTRIES
};
