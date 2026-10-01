import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const assert = (condition, message) => {
  if (!condition) {
    console.error(`✖ ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`✔ ${message}`);
  }
};

const indexHtml = read('desktop/renderer/index.html');
const appJs = read('desktop/renderer/app.js');
// Die Modul-Eingaben (Kanalauswahl inkl. Kategorie-Gruppierung) liegen seit der
// Renderer-Aufteilung in module-config-inputs.js. Die Assertion prüft deshalb
// beide Dateien – sonst bricht sie bei jedem Refactor ohne Produktfehler.
const moduleConfigInputs = read('desktop/renderer/module-config-inputs.js');
const mainJs = read('desktop/main.cjs');
const discordReferenceJs = read('desktop/renderer/discord-reference-v7.js');
const discordReferenceCss = read('desktop/renderer/ui-base.css');
const skinEditorJs = read('desktop/renderer/skin-editor.js');
const serverManagement = read('desktop/renderer/server-management.js');
const backend = read('src/index.js');
const sorting = read('src/dashboard/sorting.js');
const indexStore = read('src/serverIndexStore.js');
const qualityCss = read('desktop/renderer/ui-base.css');
const dashboardJs = read('src/dashboard.js');
const forumTimeline = read('src/dashboard/forumTimeline.js');
const pkg = JSON.parse(read('package.json'));

assert(indexHtml.includes('id="workspace-portal"'), 'Login-Folgeportal ist im Dashboard vorhanden');
assert(indexHtml.includes('data-workspace-open="minecraft"') && indexHtml.includes('data-workspace-open="discord"'), 'Minecraft/Discord-Bubbles sind verdrahtet');
assert(appJs.includes('renderWorkspacePortal') && appJs.includes('data-workspace-guild'), 'Portal rendert Serverkarten und Serverauswahl');
assert(serverManagement.includes('renderForumPostBrowser') && serverManagement.includes('data-forum-thread-id') && serverManagement.includes('data-forum-back'), 'Forum wird als Postliste mit Thread-Rücksprung gerendert');
assert(forumTimeline.includes('availableTags') && forumTimeline.includes('thread: {') && forumTimeline.includes('totalMessageSent'), 'Forum-Posts liefern Tags und Thread-Metadaten');
assert(sorting.includes('withDashboardDisplayOrder') && sorting.includes('displayOrder = ordered.length') && sorting.includes('compareDiscordIds'), 'Serververwaltung baut eine stabile Discord-Sidebar-Reihenfolge im Backend');
assert(sorting.includes('rootRows') && sorting.includes('for (const row of rootRows) pushRow(row)') && sorting.indexOf('for (const row of rootRows) pushRow(row)') < sorting.indexOf('for (const row of categoryRows)'), 'Root-Kanäle ohne Kategorie bleiben als eigener Block vor Kategorien');
assert(sorting.includes('compareDashboardChannelRows') && backend.includes('rawPosition: discordPosition(channel)') && sorting.includes('DASHBOARD_CONFIG_CHANNEL_TYPES'), 'Serververwaltung liefert Discord-Positionen und alle konfigurierbaren Kanaltypen');
assert(sorting.includes('compareDiscordRoleHierarchy') && backend.includes('.sort(compareDiscordRoleHierarchy)'), 'Serververwaltung sortiert Rollen nach Discord-Hierarchie');
assert(serverManagement.includes('topLevelChannels') && serverManagement.includes('childrenByParent') && serverManagement.includes('rootChannels'), 'Kanäle & Rollen trennen Root-Kanäle und Kategorie-Kinder sauber');
assert(serverManagement.includes('visibleRootChannels') && !serverManagement.includes('channel-category uncategorized') && serverManagement.indexOf('visibleRootChannels.length') < serverManagement.indexOf('categoryChannels.forEach'), 'UI rendert Root-Kanäle ohne künstliche Kategorie vor Kategorien');
assert(serverManagement.includes('compareCategoryChildren') && !serverManagement.includes('channelSidebarBucket') && sorting.includes('const compareDashboardCategoryChildren') && !sorting.match(/compareDashboardCategoryChildren[\s\S]{0,220}bucketDelta/), 'Kategorie-Kinder folgen ohne künstliche Text-/Voice-Gruppierung exakt der Discord-Position');
assert(serverManagement.includes('displayOrder') && serverManagement.includes('BigInt(leftId)'), 'UI übernimmt Backend-Displayorder und nutzt Discord-ID-Gleichstand');
assert(moduleConfigInputs.includes('groupedDiscordChannels') && appJs.includes('<optgroup label=') && appJs.includes('refreshModuleChannelResources'), 'Alle Modul-Kanalauswahlen zeigen Discord-Kategorien und aktualisieren neue Kanäle');
assert(dashboardJs.includes("fresh: String(req.query.fresh || '') === '1'") && backend.includes('await guild.channels.fetch()'), 'Kanalauswahl kann den aktuellen Discord-Stand statt eines alten Caches anfordern');
assert(serverManagement.includes('compareForumPosts') && serverManagement.includes('forum-post-pin') && forumTimeline.includes('compareDashboardForumPosts'), 'Angepinnte Forum-Posts werden oben sortiert und markiert');
assert(forumTimeline.includes('forumThreadArchiveCursor') && serverManagement.includes('data-load-all-forum-posts'), 'Forum-Posts können vollständig per Archiv-Cursor nachgeladen werden');
assert(pkg.build?.win?.icon === 'public/assets/fallen-heaven-app.ico' && pkg.build?.appId === 'de.fallenheaven.discordbot', 'Windows-App nutzt das FALLEN-HEAVEN-App-Icon im Build');
assert(backend.includes('enrichMemberIntelligenceWithBoostTimeline') && serverManagement.includes('boost_expired'), 'Boost-Ledger erweitert die Mitglieder-Timeline inklusive ausgelaufener Boosts');
assert(indexStore.includes('boost_expired') && indexStore.includes('boostet den Server nicht mehr'), 'Serverindex kennt Boost-Ende/Auslauf semantisch');
assert(qualityCss.includes('.workspace-portal') && qualityCss.includes('.forum-post-card') && qualityCss.includes('Hard light-mode contrast'), 'Neue UI und Light-Mode-Kontrastregeln sind geladen');
assert(qualityCss.includes('System + Live-Diagnose polish 10.0') && qualityCss.includes('.diagnostics-head button[data-diagnostics-refresh]') && qualityCss.includes('body[data-theme="light"] #system-view .page-head h1'), 'System und Live-Diagnose haben robuste Light-Mode-Kontraste');
assert(appJs.includes('authRestoring') && appJs.includes('WORKSPACE_RESTORE_TIMEOUT_MS') && appJs.includes('resetStaleDashboardSession') && appJs.includes("restoredSession === 'pending'"), 'Session-Restore hängt nach Neustart nicht mehr endlos im angemeldeten Zustand');
assert(appJs.includes('Discord-Login ist bestätigt, aber Serverdaten laden noch') && dashboardJs.includes('discordFetch') && dashboardJs.includes("dns.setDefaultResultOrder?.('ipv4first')"), 'Discord-Login bleibt robust bei kurzem DNS/API-Aussetzer');
assert(appJs.includes('discord-login-pending') && appJs.includes('Login erfolgreich. Discord liefert die Serverdaten noch nach.'), 'Manueller Login bleibt bei langsamen Discord-Daten nicht hängen');
assert(indexHtml.includes('id="preboot-screen"') && indexHtml.includes('body.auth-restoring .access-scene'), 'Start-Splash verhindert sichtbaren Auth-/Home-Flash');
assert(appJs.includes('selectedForumPostTagIds') && appJs.includes("'/thread/create' : '/embed/send'"), 'Embed Studio kann Forum-Posts mit aktuellem Embed erstellen');
assert(backend.includes('normalizeForumAppliedTags') && backend.includes('fetchThreadStarterMessage') && backend.includes('message: startPayload'), 'Backend erstellt Forum-Threads mit Embed-Startnachricht und Tags');
assert(indexHtml.includes('skin-3d-brush-dot') && skinEditorJs.includes('handleModelPointerDown'), 'Skin Studio unterstützt direktes 3D-Malen per Raycaster');
assert(indexHtml.includes('skin-editor.js?v=') && !indexHtml.includes('<script src="../../node_modules/three/build/three.min.js">'), 'three.js + skinview3d werden NICHT mehr beim App-Start geladen (Lazy-Load)');
assert(skinEditorJs.includes('loadViewerLibraries') && skinEditorJs.includes('../../node_modules/three/build/three.min.js') && skinEditorJs.includes('skinview3d/bundles/skinview3d.bundle.js'), '3D-Renderer wird erst beim ersten Öffnen des Skin Studios nachgeladen');
assert(appJs.includes("view === 'skin'") && appJs.includes('loadViewerLibraries'), 'Skin Studio lädt die 3D-Bibliotheken beim ersten Öffnen');
assert(skinEditorJs.includes('fallen-heaven-standard-skin.png') && skinEditorJs.includes('loadStandardSkinCanvas') && skinEditorJs.includes('createDefaultSkinLayers'), 'Skin Studio startet mit dem Fallen-Heaven-Standard-Skin (eigenes PNG statt Steve)');
assert(skinEditorJs.includes('skin-swatch-add') && skinEditorJs.includes('CUSTOM_PALETTE_KEY') && skinEditorJs.includes('addCurrentColorToPalette'), 'Skin Studio erlaubt eigene Palettenfarben (benutzerdefinierte Swatches)');
assert(skinEditorJs.includes('drawStarterBaseLayer') && skinEditorJs.includes('recipe.palette') && skinEditorJs.includes('CUSTOM_PALETTE_KEY'), 'Skin Studio nutzt die gewählten Studio-Farben für die Starter-Zeichnung');
assert(skinEditorJs.includes('updateViewerTexture') && skinEditorJs.includes('viewer.skinTexture.needsUpdate'), 'Skin Studio aktualisiert die 3D-Vorschau ohne kompletten Reload pro Pinselstrich');
assert(mainJs.includes('restoredDashboardSession') && mainJs.includes('if (!restoredDashboardSession) await clearProtectedDashboardSession();'), 'Stale Electron-Cookies werden nach PC-Neustart verworfen');
assert(discordReferenceJs.includes('pro-login-card') && discordReferenceJs.includes('pro-discord-button') && discordReferenceJs.includes('Verbinde Discord.'), 'Login nutzt professionellen Control-Center-Aufbau statt Legacy-Hero');
assert(discordReferenceCss.includes('Login rebuild 3.9.27') && discordReferenceCss.includes('.pro-discord-button') && discordReferenceCss.includes('.pro-preview-panel'), 'Login-Button und Preview-Panel sind final gestylt');
assert(serverManagement.includes('messageCounterIntervalMinutes') && serverManagement.includes('5 Minuten · Schnell') && serverManagement.includes('Minimum 5 Minuten'), 'Chat-Count-Kanalthema-Sync ist in der UI einstellbar');
assert(backend.includes('CHANNEL_TOPIC_SYNC_MIN_MS = 5 * 60_000') && backend.includes('extractDiscordRetryAfterMs') && backend.includes('syncIntervalMinutes'), 'Chat-Count-Sync nutzt 5-Minuten-Minimum und Discord-Retry-Backoff');
assert(serverManagement.includes('channel-pagination') && serverManagement.includes('data-channel-page') && serverManagement.includes('data-channel-load-next-page'), 'Kanalinhalt besitzt kompakte Seitennavigation mit automatischem Verlaufsnachladen');
assert(serverManagement.includes("page: String(page)") && serverManagement.includes("channelStorage === 'server-index-pages'"), 'Kanalinhalt springt direkt über den lokalen Serverindex statt Seiten seriell zu laden');
assert(backend.includes('getServerIndexChannelPage') && backend.includes('server-index-pages') && backend.includes('server-index-cursor'), 'Backend liefert Gesamtseiten, beliebige Indexseiten und den Keyset-Cursor (server-index-pages/-cursor) mit Discord-Rechteprüfung');
assert(serverManagement.includes('Array.isArray(data?.channels) ? data.channels : []') && serverManagement.includes('Array.isArray(source.events) ? source.events : []'), 'Teilweise Discord-Verwaltungsdaten können die Kanalansicht nicht mehr mit undefined.filter stoppen');
assert(serverManagement.includes('Array.isArray(currentManagement?.members) ? currentManagement.members : []') && !serverManagement.includes('Array.isArray(currentManagement?.members || [])'), 'Discord-Erwaehnungen bleiben auch ohne geladene Mitgliederliste sicher');
assert(serverManagement.includes('function renderDiscordPlainText(value)') && serverManagement.includes('output += renderDiscordPlainText(source.slice(cursor, match.index))') && !serverManagement.includes('return output\n      .replace'), 'Link-Erkennung veraendert keine bereits erzeugten Emoji-, GIF- oder Sticker-Tags');
assert(indexHtml.includes(`server-management.js?v=${pkg.version}`), 'Serververwaltung nutzt den aktuellen Cache-Buster');
assert(/^(3\.9\.\d+|4\.\d+\.\d+)$/.test(pkg.version), 'App-Version gehört zu einer gültigen FHCC-Releaseversion (3.9.x oder 4.x)');

if (process.exitCode) process.exit(process.exitCode);
console.log('Workspace/Forum/Timeline Smoke-Test abgeschlossen.');
