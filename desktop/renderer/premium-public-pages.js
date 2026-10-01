(function premiumPublicPages() {
  'use strict';

  const icon = (name) => {
    const paths = {
      community: '<path d="M5 17a4 4 0 0 1 8 0M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm6 1a2.5 2.5 0 0 1 4 2v4M16 4.5a2.5 2.5 0 0 1 0 5"/>',
      members: '<circle cx="9" cy="7" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M17 8v6m-3-3h6"/>',
      shield: '<path d="M12 3 4.5 6v5c0 4.8 3.1 8 7.5 10 4.4-2 7.5-5.2 7.5-10V6L12 3Z"/><path d="m8.5 12 2.2 2.2 4.8-5"/>',
      logs: '<path d="M6 3h12v18H6zM9 7h6M9 11h6M9 15h4"/>',
      service: '<path d="M12 3v9M8.5 5a8 8 0 1 0 7 0"/>',
      embed: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 8h7M7 12h10M7 16h6"/>',
      thread: '<path d="M4 5h16M4 10h12M4 15h8M4 20h5"/>',
      editor: '<path d="m4 20 4.5-1 10-10-3.5-3.5-10 10L4 20Z"/><path d="m13.5 7 3.5 3.5"/>',
      system: '<path d="M4 18V9m5 9V5m5 13v-7m5 7V3"/>',
      support: '<path d="M5 15v-3a7 7 0 0 1 14 0v3M5 15H3v-4h2m14 4h2v-4h-2M9 19h6"/>'
    };
    return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (paths[name] || paths.community) + '</svg>';
  };

  const pages = {
    community: {
      group: 'COMMUNITY OS', title: 'Community\nControl.', lead: 'Eine vollständige Schaltzentrale für Struktur, Mitglieder und Serverwissen.',
      icon: 'community', layout: 'command', accent: '#65f0c2', stats: [['2.236', 'Mitglieder'], ['164', 'Kanäle'], ['Live', 'Serverindex']],
      features: [['Member Intelligence', 'Aktivität, Rollen und belegte Interessen in einem klaren Profil.'], ['Serverstruktur', 'Kanäle, Rollen, Themen und Inhalte direkt verwalten.'], ['Systemereignisse', 'Joins, Boosts und relevante Änderungen chronologisch erfassen.'], ['Vollindex', 'Der gesamte Serverindex bleibt durchsuchbar und lokal.']]
    },
    members: {
      group: 'MEMBER INTELLIGENCE', title: 'Menschen.\nNicht Zeilen.', lead: 'Verstehe Aktivität und Historie mit nachvollziehbaren Originalbelegen.',
      icon: 'members', layout: 'profile', accent: '#8ce8ff', stats: [['30 Tage', 'Aktivität'], ['Belegt', 'Interessen'], ['Privat', 'Lokale Daten']],
      features: [['Profil-Timeline', 'Account, Serverbeitritt, Boosts und Systemereignisse auf einer Zeitachse.'], ['Aktivitätsanalyse', 'Letzte Nachricht, aktive Tage und Kanäle ohne starre Tabellen.'], ['Belegsystem', 'Jede Aussage bleibt mit Nachricht, Kanal und Datum nachvollziehbar.'], ['Moderationskontext', 'Rollen, Notizen und Aktionen übersichtlich an einem Ort.']]
    },
    antiraid: {
      group: 'DEFENSE GRID', title: 'Ruhe bei\njedem Angriff.', lead: 'Erkennt ungewöhnliche Beitritte und reagiert abgestuft statt blind.',
      icon: 'shield', layout: 'defense', accent: '#ff8c9c', stats: [['Live', 'Join Radar'], ['4 Stufen', 'Reaktion'], ['0', 'Offene Risiken']],
      features: [['Join Radar', 'Beitrittswellen und neue Konten in Echtzeit bewerten.'], ['Adaptive Limits', 'Grenzen passen sich an echte Serveraktivität an.'], ['Sichere Aktionen', 'Erst begrenzen, dann prüfen und jede Maßnahme protokollieren.'], ['Recovery', 'Ausnahmen und Fehlalarme lassen sich sauber zurücknehmen.']]
    },
    moderation: {
      group: 'MODERATION DESK', title: 'Konsequent.\nNachvollziehbar.', lead: 'Moderationsaktionen mit Kontext, Belegen und klarer Verantwortlichkeit.',
      icon: 'shield', layout: 'defense', accent: '#ffc66d', stats: [['Live', 'Filter'], ['Belegt', 'Aktionen'], ['Owner', 'Kontrolle']],
      features: [['Fallakte', 'Warnungen, Timeouts und Notizen chronologisch bündeln.'], ['Kontextprüfung', 'Nachrichten vor und nach einem Vorfall berücksichtigen.'], ['Rollenaktionen', 'Sicher vergeben, entfernen und auf Hierarchie prüfen.'], ['Audit Trail', 'Wer, wann, warum und mit welchem Ergebnis bleibt sichtbar.']]
    },
    logs: {
      group: 'AUDIT STREAM', title: 'Nichts Wichtiges\ngeht verloren.', lead: 'Strukturierte Logs statt unübersichtlicher Textwände.',
      icon: 'logs', layout: 'audit', accent: '#9bb3ff', stats: [['Live', 'Ingestion'], ['Filter', 'Ereignisse'], ['30 Tage', 'Kontext']],
      features: [['Event Stream', 'Rollen, Mitglieder, Nachrichten und Service getrennt filtern.'], ['Systemereignisse', 'Boost-, Join- und Verlustmeldungen separat auswerten.'], ['Suche', 'Nach Nutzer, Kanal, Zeitraum und Ereignistyp finden.'], ['Export', 'Relevante Ausschnitte ohne geheime Konfiguration sichern.']]
    },
    permissions: {
      group: 'ACCESS CONTROL', title: 'Zugriff ohne\nÜberraschungen.', lead: 'Nur Owner, Administratoren oder Server-verwalten erhalten Konfigurationszugriff.',
      icon: 'shield', layout: 'defense', accent: '#72e7ff', stats: [['OAuth2', 'Discord'], ['3 Stufen', 'Zugriff'], ['Lokal', 'Sitzung']],
      features: [['Owner Gate', 'Serverauswahl zeigt ausschließlich wirklich berechtigte Server.'], ['Rollenprüfung', 'Discord-Berechtigungen werden sauber ausgewertet.'], ['Sitzungsschutz', 'Token bleiben geschützt und werden nicht in der UI offengelegt.'], ['Aktionsschutz', 'Kritische Aktionen verlangen eindeutige Bestätigung.']]
    },
    service: {
      group: 'BOT SERVICE', title: 'Starten. Stoppen.\nWirklich wissen.', lead: 'Ein zuverlässiger Prozessmanager mit Status, Logs und klarer Rückmeldung.',
      icon: 'service', layout: 'diagnostics', accent: '#67f0b8', stats: [['1 Prozess', 'Single Instance'], ['Live', 'Health'], ['Auto', 'Recovery']],
      features: [['Single Instance', 'Verhindert doppelte Bot-Prozesse und falsche Onlineanzeigen.'], ['Lifecycle', 'Start, Stopp und Neustart mit sichtbarem Fortschritt.'], ['Crash Report', 'Ursache, Exit-Code und letzte Logzeilen direkt anzeigen.'], ['Health Check', 'Discord, Datenbank und Hintergrundjobs getrennt überwachen.']]
    },
    embeds: {
      group: 'MESSAGE LAB', title: 'Discord Content.\nOhne Umwege.', lead: 'Mehrteilige Embeds gestalten, als Entwurf sichern und mit dem Bot senden.',
      icon: 'embed', layout: 'content', accent: '#5bc8ff', stats: [['10', 'Embeds'], ['Live', 'Preview'], ['Bot', 'Versand']],
      features: [['Live Preview', 'Nachricht, Bilder, Felder und Footer stabil nebeneinander bearbeiten.'], ['Kompletter Import', 'Bestehende Nachrichten mit allen Embeds und Medien übernehmen.'], ['Funktionssets', 'Bot-Systeme wie VIP & Coins direkt ans Embed hängen.'], ['Nachrichtenarchiv', 'Gesendete Inhalte später erneut öffnen und bearbeiten.']]
    },
    threads: {
      group: 'THREAD CONTROL', title: 'Gespräche sauber\nstrukturieren.', lead: 'Threads erstellen, verwalten und mit passenden Nachrichten starten.',
      icon: 'thread', layout: 'content', accent: '#a6a0ff', stats: [['Direkt', 'Erstellen'], ['Live', 'Kanäle'], ['Bot', 'Versand']],
      features: [['Thread Creator', 'Zielkanal, Name und Startnachricht in einem Ablauf.'], ['Aktive Threads', 'Status, Archivierung und letzte Aktivität überblicken.'], ['Embed Versand', 'Nachrichten und Embeds direkt in Threads senden.'], ['Berechtigungscheck', 'Vorher prüfen, ob der Bot wirklich schreiben kann.']]
    },
    templates: {
      group: 'CONTENT LIBRARY', title: 'Einmal bauen.\nImmer passend.', lead: 'Wiederverwendbare Vorlagen für Welcome, Level, Regeln und Ankündigungen.',
      icon: 'embed', layout: 'content', accent: '#f2a7ff', stats: [['Versioniert', 'Vorlagen'], ['Sofort', 'Preview'], ['Lokal', 'Gespeichert']],
      features: [['Template Sets', 'Einheitliche Designs pro Zweck und Serverbereich.'], ['Variablen', 'Nutzer, Kanal, Level und Serverdaten dynamisch einsetzen.'], ['Versionen', 'Änderungen nachvollziehen und frühere Fassungen wiederherstellen.'], ['Freigabe', 'Entwurf prüfen, testen und erst dann senden.']]
    },
    editor: {
      group: 'APP STUDIO', title: 'Deine App.\nDein System.', lead: 'Alle App-Seiten als vollständige Vorschau gestalten, nicht nur einzelne Textfelder.',
      icon: 'editor', layout: 'editor', accent: '#b79cff', stats: [['Alle', 'App-Seiten'], ['Live', 'Vorschau'], ['Undo', 'Historie']],
      features: [['Seitenmodus', 'Hauptmenü, Dashboard und Werkzeuge vollständig auswählen.'], ['Live Canvas', 'Große, echte Vorschau mit direkter Seitennavigation.'], ['Design Tokens', 'Farben, Dichte, Typografie und Hintergründe zentral steuern.'], ['Sichere Änderungen', 'Undo, Redo, Entwurf und Wiederherstellung vor dem Speichern.']]
    },
    system: {
      group: 'LIVE DIAGNOSE', title: 'Jeder Prozess.\nEin klares Bild.', lead: 'Leistung, Index, Jobs und Discord-Verbindung in einem belastbaren Diagnosezentrum.',
      icon: 'system', layout: 'diagnostics', accent: '#58e7c2', stats: [['90 Punkte', 'Live Verlauf'], ['SQLite', 'Index'], ['Priorisiert', 'Jobs']],
      features: [['Systemscore', 'Discord, Runtime, Jobs und Index getrennt bewerten.'], ['Job Manager', 'Aktive, wartende und fehlgeschlagene Aufgaben sichtbar machen.'], ['Index Health', 'Checkpoints, offene Backfills und nächste Aktualisierung anzeigen.'], ['Performance', 'RAM, CPU, Event-Loop, Ping und langsame Operationen verfolgen.']]
    },
    support: {
      group: 'SUPPORT CENTER', title: 'Probleme lösen.\nNicht suchen.', lead: 'Diagnose, Reparatur und Hilfe mit dem richtigen Kontext an einem Ort.',
      icon: 'support', layout: 'support', accent: '#ffcf70', stats: [['Lokal', 'Diagnose'], ['Direkt', 'Logs'], ['Sicher', 'Export']],
      features: [['Schnellprüfung', 'Verbindung, Prozess und Index automatisch testen.'], ['Reparaturaktionen', 'Gezielte Lösungen statt pauschalem Zurücksetzen.'], ['Support Paket', 'Relevante Logs ohne Tokens und Secrets exportieren.'], ['Recovery Guide', 'Schrittweise Wiederherstellung bei Login- oder Prozessproblemen.']]
    }
  };

  let layer = null;
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

  function closeMenus() {
    if (window.FHNavigation && typeof window.FHNavigation.closeAll === 'function') {
      window.FHNavigation.closeAll(true);
    }
    document.querySelectorAll('[aria-expanded="true"]').forEach((node) => node.setAttribute('aria-expanded', 'false'));
    document.body.classList.remove('fh-nav-expanded');
  }

  function closePage(updateHistory = true) {
    if (layer) layer.remove();
    layer = null;
    document.body.classList.remove('fh-premium-page-open');
    if (updateHistory && location.hash.startsWith('#/info/')) history.replaceState({}, '', location.pathname + location.search);
  }

  function login() {
    closePage(false);
    document.getElementById('public-discord-login')?.click();
  }

  function renderVisual(page) {
    if (page.layout === 'profile') return '<div class="fh-visual-profile"><div class="fh-profile-head"><span class="fh-avatar">FH</span><div><strong>Member Intelligence</strong><small>Belegte Serverhistorie</small></div><b>96%</b></div><div class="fh-profile-bars"><i style="--w:88%"></i><i style="--w:64%"></i><i style="--w:76%"></i></div><div class="fh-profile-timeline"><span></span><span></span><span></span><span></span></div></div>';
    if (page.layout === 'defense') return '<div class="fh-visual-defense"><div class="fh-radar-ring r1"></div><div class="fh-radar-ring r2"></div><div class="fh-radar-core">' + icon('shield') + '</div><span class="signal s1">JOIN · NORMAL</span><span class="signal s2">FILTER · AKTIV</span><span class="signal s3">RISIKO · 0</span></div>';
    if (page.layout === 'audit') return '<div class="fh-visual-audit"><header>LIVE EVENT STREAM <b>●</b></header><p><i></i><strong>Rolle aktualisiert</strong><small>vor 2 Sekunden</small></p><p><i></i><strong>Systemereignis erfasst</strong><small>vor 8 Sekunden</small></p><p><i></i><strong>Index-Checkpoint</strong><small>vor 14 Sekunden</small></p></div>';
    if (page.layout === 'content') return '<div class="fh-visual-embed"><header><span># preview</span><small>LIVE</small></header><div class="fh-discord-message"><span class="fh-avatar">FH</span><p><b>FALLEN HEAVEN <em>APP</em></b><small>Heute</small><i></i><strong>Willkommen in FALLEN HEAVEN</strong><span>Professionell gestaltet und direkt mit dem Bot gesendet.</span></p></div></div>';
    if (page.layout === 'editor') return '<div class="fh-visual-editor"><aside><i></i><i></i><i></i><i></i></aside><main><header><span>Live App Preview</span><b>100%</b></header><h3>DEIN SERVER.<br>DEINE WELT.</h3><div><i></i><i></i><i></i></div></main></div>';
    if (page.layout === 'diagnostics') return '<div class="fh-visual-system"><header><strong>Systemstatus</strong><b>94 / 100</b></header><svg viewBox="0 0 500 180" preserveAspectRatio="none"><path class="grid" d="M0 30H500M0 75H500M0 120H500M0 165H500"/><path class="line one" d="M0 132 C60 112 95 142 145 95 S235 120 290 64 S385 98 500 42"/><path class="line two" d="M0 150 C80 145 120 120 180 135 S280 95 340 115 S430 82 500 90"/></svg><footer><span>RAM</span><span>DISCORD</span><span>INDEX</span></footer></div>';
    if (page.layout === 'support') return '<div class="fh-visual-support"><div>' + icon('support') + '</div><p><strong>Discord Verbindung</strong><b>Bereit</b></p><p><strong>Bot-Prozess</strong><b>Bereit</b></p><p><strong>Serverindex</strong><b>Bereit</b></p></div>';
    return '<div class="fh-visual-command"><aside><span></span><span></span><span></span><span></span></aside><main><header><b>Community Overview</b><small>LIVE</small></header><div class="fh-command-metrics"><i></i><i></i><i></i></div><section><p></p><p></p><p></p><p></p></section></main></div>';
  }

  function openPage(key) {
    if (key === 'home') { closePage(); return; }
    const page = pages[key];
    if (!page) return;
    closePage(false);
    closeMenus();
    layer = document.createElement('div');
    layer.className = 'fh-premium-page-layer';
    layer.dataset.page = key;
    layer.style.setProperty('--page-accent', page.accent);
    const title = page.title.split('\n').map(esc).join('<br>');
    layer.innerHTML = '<div class="fh-page-atmosphere" aria-hidden="true"><i></i><i></i><i></i></div>' +
      '<main class="fh-premium-page layout-' + esc(page.layout) + '">' +
      '<header class="fh-page-top"><button type="button" class="fh-page-back" data-premium-back><span>←</span> Hauptmenü</button><div class="fh-page-brand">' + icon(page.icon) + '<span>FALLEN HEAVEN</span></div><button type="button" class="fh-page-login" data-premium-login>Dashboard Login</button></header>' +
      '<section class="fh-page-hero"><div class="fh-page-copy"><span class="fh-page-kicker">' + esc(page.group) + '</span><h1>' + title + '</h1><p>' + esc(page.lead) + '</p><div class="fh-page-actions"><button type="button" data-premium-login>Im Dashboard öffnen</button><button type="button" data-premium-scroll>Details ansehen</button></div></div><div class="fh-page-visual">' + renderVisual(page) + '</div></section>' +
      '<section class="fh-page-stats">' + page.stats.map((stat) => '<article><strong>' + esc(stat[0]) + '</strong><span>' + esc(stat[1]) + '</span></article>').join('') + '</section>' +
      '<section class="fh-page-details" data-premium-details><header><span>FUNKTIONEN</span><h2>Gebaut für echte Serverarbeit.</h2><p>Jeder Bereich hat einen eigenen Workflow, klare Zustände und nachvollziehbare Aktionen.</p></header><div class="fh-page-feature-grid">' + page.features.map((feature) => '<article><span class="fh-feature-signal">SYSTEM READY</span><div>' + icon(page.icon) + '</div><h3>' + esc(feature[0]) + '</h3><p>' + esc(feature[1]) + '</p></article>').join('') + '</div></section>' +
      '<section class="fh-page-workflow"><div><span>PRO WORKFLOW</span><h2>Verstehen. Entscheiden. Ausführen.</h2></div><ol><li><b>LIVE</b><strong>Live-Daten</strong><span>Aktuellen Zustand erfassen.</span></li><li><b>CHECK</b><strong>Klare Kontrolle</strong><span>Änderung vor Ausführung prüfen.</span></li><li><b>SAFE</b><strong>Nachvollziehbar</strong><span>Ergebnis und Historie sichern.</span></li></ol></section>' +
      '<footer class="fh-page-footer"><div><span>FALLEN HEAVEN CONTROL CENTER</span><h2>Bereit für deinen Server?</h2></div><button type="button" data-premium-login>Mit Discord anmelden</button></footer>' +
      '</main>';
    document.body.appendChild(layer);
    document.body.classList.add('fh-premium-page-open');
    layer.querySelectorAll('[data-premium-back]').forEach((button) => button.addEventListener('click', () => closePage()));
    layer.querySelectorAll('[data-premium-login]').forEach((button) => button.addEventListener('click', login));
    layer.querySelector('[data-premium-scroll]')?.addEventListener('click', () => layer.querySelector('[data-premium-details]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    layer.scrollTop = 0;
    history.replaceState({}, '', location.pathname + location.search + '#/info/' + key);
  }

  window.addEventListener('click', (event) => {
    const target = event.target.closest?.('[data-public-target]');
    if (!target || !document.body.classList.contains('public-home')) return;
    const key = target.dataset.publicTarget;
    if (key !== 'home' && !pages[key]) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openPage(key);
  }, true);

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && layer) closePage();
  });

  window.FHPremiumPages = { open: openPage, close: closePage, pages: Object.keys(pages) };
})();
