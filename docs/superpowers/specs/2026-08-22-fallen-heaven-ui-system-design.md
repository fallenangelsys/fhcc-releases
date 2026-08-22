# FALLEN HEAVEN Control Center UI System

Date: 2026-08-22

## Purpose

Rebuild the complete Electron renderer as a distinctive, dense Discord administration client. The shell follows the actual DiscordBotClient spatial model: guild rail, contextual channel-like navigation, primary content surface, and optional right detail pane. It does not use a conventional administration dashboard as its central metaphor. All implementation, components, styling, assets, and product language remain original to FALLEN HEAVEN.

The redesign must solve three current failures together:

- Module-specific embed editing leaks controls from the free Embed Studio, including channel selection and bot sending.
- The renderer feels slow because a large shared script and overlapping CSS generations repeatedly render more UI than the active workflow needs.
- The visual system reads as a collection of dashboard templates instead of one coherent desktop product.

## Product Principles

### Dense, not crowded

The app is an operational Discord tool. It should expose relevant context without turning every value into a decorative card. Information is organized into persistent panes, compact rows, tables, channel trees, inspector areas, and focused editors.

### Complete capability, reorganized

The redesign preserves every currently supported user workflow. Features may move into clearer client-style locations, but they are not removed, hidden without a replacement, or reduced to read-only summaries. Where a feature is too large for one content surface, it receives channel-like subviews or a dedicated workspace while preserving shared server and module context.

### Context determines controls

A control appears only when it is valid for the current workflow. A module template editor can save a template and update its managed panel. It cannot choose an arbitrary channel, manage free drafts, or send an unrelated bot message. The free Embed Studio keeps those capabilities.

### FALLEN HEAVEN is a material system

The supplied key art at `E:\SSD NEW\Bilder\file_0000000050c871f4ae43434149bbd119.png` defines the palette and atmosphere, not a repeated poster background.

- Near-black graphite provides quiet working space.
- Cold silver and faint blue-violet edges communicate focus and hierarchy.
- Smoke texture appears only in identity surfaces, transitions, and selected empty states.
- The winged figure or halo may appear as a controlled, low-opacity crop in peripheral space.
- Red is reserved for destructive actions, real faults, and dangerous moderation states.
- The full PNG is never placed as a large standalone block inside the application.

### No generated-design mannerisms

- No decorative numbered sections such as `01`, `02`, or `03`.
- No invented navigation abbreviations. `FH` is allowed only as the real FALLEN HEAVEN mark.
- No gradient blobs, floating sections, nested card stacks, or oversized marketing headings.
- No generic statistic-card grid as the primary dashboard structure.
- Familiar actions use Lucide icons with tooltips; navigation uses icons and full labels.
- Motion communicates navigation, loading, saving, errors, or state changes. It is not ambient decoration in working views.

## Application Structure

### Server rail

A narrow first rail switches Discord servers and exposes global FALLEN HEAVEN areas plus account/help access. Server icons use real guild avatars. The active server uses a restrained halo-derived focus ring. This rail collapses to a compact mobile/window mode without replacing icons with text abbreviations.

### Primary navigation

The second pane behaves like Discord's channel list. It contains contextual categories and full labels for the selected product area. At the global level it exposes Overview, Server Management, Modules, Embed Studio, Skin Studio, Live Diagnostics, and System. Inside a module it changes to that module's actual capabilities. It also shows the selected server and compact live connection status. Sections may show meaningful counts only when actionable, such as unresolved diagnostics.

### Workspace

The central pane owns the active workflow. Its header contains breadcrumbs, page title, relevant actions, and optional command search. Views use split panes when comparison or preview is useful and full-width lists when scanning is the primary task.

### Context inspector

An optional right pane shows live events, selected-item properties, validation, or help specific to the active workflow. It must disappear when it has no useful content and collapse before the workspace becomes too narrow.

### Command search

`Ctrl+K` opens a fast local command palette for navigation, module lookup, server actions, and settings. Search indexing is built once from current navigation/config metadata and incrementally updated after server/config changes.

## View Designs

### Overview

The overview behaves like a server home/activity surface, not an analytics dashboard. Its contextual navigation exposes useful feeds such as Server Home, Recent Activity, Attention Required, and Scheduled Operations. The main surface shows a chronological operational feed and pinned server status. The optional right pane shows bot connection, current server identity, and upcoming scheduled work. Metrics appear only inside the relevant feed/detail context and link to their source view.

### Module browser

Modules are grouped as channel-like entries in the contextual navigation, with search and filters available above the list. Each entry shows icon, full name, readiness/enabled state, and actionable issue count. Selecting a module opens its workspace without discarding list scroll/filter state. A main-surface directory remains available for bulk comparison and activation, but it is a dense list rather than a card dashboard.

### Module workspace

Each module receives a local navigation derived from its actual capabilities, for example Settings, Call Groups, Panel Design, and Activity for Public Call. Shared module controls remain consistent, while unsupported tabs are not rendered.

Configuration is edited in sections with stable widths and compact field spacing. Save state is explicit: unchanged, changed, saving, saved, or failed. Navigating away with unsaved changes requires a decision.

### Module embed editor

The module editor is a dedicated template workflow, not the free studio with hidden controls.

- It receives a typed editing context describing module, template key, supported fields, placeholders, preview data, save handler, and optional managed-panel refresh behavior.
- It shows content controls in the left workspace and a Discord-accurate preview in the right workspace.
- The primary action is `Änderungen speichern` or a precise equivalent such as `Speichern und Panel aktualisieren`.
- It has no arbitrary target channel, draft library, JSON copy command, edit-existing-message command, or `Mit Bot senden` action.
- Failed persistence and failed Discord refresh are separate states. A saved design is never reported as lost because refresh failed.
- The preview updates incrementally and preserves focus, selection, scroll, and expanded sections.

### Free Embed Studio

The free studio remains the place for composing and sending standalone Discord content. It includes target channel/thread selection, drafts, message editing, JSON tools, forum options, components, reactions, and bot sending. Advanced groups load only when opened.

### Server management

Server management follows Discord's recognizable hierarchy: server context, channel/category tree, role hierarchy, member/content workspace, and a contextual inspector. Long lists use virtualization or pagination, stable keys, and preserved scroll position. Actions use menus and icon controls rather than rows of text buttons.

Its contextual navigation exposes all existing areas, including channel content and ordering, categories, roles and hierarchy, members, forum posts and threads, timeline/history, backups, and supported server actions. Selecting a channel or member updates the main surface and detail pane in place, matching the directness of a Discord client.

### Live diagnostics

Diagnostics prioritize current failures and timing over decorative health scores. Stream updates are batched before DOM rendering. Filtering, pause/resume, detail inspection, and copying diagnostic evidence are first-class controls.

### System and updates

System settings use compact grouped rows and explicit restart/update consequences. Release state, data paths, signing status, runtime versions, and service controls remain visible without exposing implementation noise to ordinary workflows.

## Capability Preservation Map

The migration must preserve and verify at least these existing surfaces:

- Authentication, session restore, server selection, window controls, theme, and startup/recovery states.
- Overview/server home, operational events, scheduled work, bot state, and actionable notices.
- Full module directory, enable/disable state, readiness blockers, every generated configuration field, and all module-specific actions.
- Every module-specific embed/template workflow, including managed panel refresh behavior and placeholder support.
- Free Embed Studio drafts, multi-embed editing, content, fields, images, outside attachments, target channels/threads/forums, tags, components, reactions, JSON tools, send, and existing-message editing.
- Server management for channels, categories, positions, roles, hierarchy, members, permissions, content history, forum threads/tags, pinned items, pagination, and timeline data.
- Skin Studio tools, palettes, file handling, direct painting, AI/layer functions currently exposed, and lazy-loaded 3D preview.
- Live diagnostics, filtering, access controls, timing/watchdog evidence, event streams, copy/export actions, and failure details.
- Backups, restore preview/confirmation, updates, release/runtime information, service controls, and local data paths.
- Toasts, dialogs, loading, empty, offline, permission, partial-data, dirty/saving/saved, and retry states across all routes.

Before an old route is removed, its controls and backend calls are mapped to the new route and covered by a parity test. A route is not complete merely because its primary happy path is visible.

### Login and startup

The key art is most visible here, but it remains integrated rather than displayed as a poster. Login controls occupy a quiet, high-contrast region protected from the artwork. Startup uses a static optimized image with a restrained CSS light/smoke transition; the 5.4 MB GIF is not part of the normal startup path.

## Component Architecture

### Shell components

- `AppShell`: window chrome, responsive pane layout, active server, and active route.
- `ServerRail`: guild switching and account/help actions.
- `PrimaryNavigation`: full-label product navigation.
- `WorkspaceHeader`: breadcrumbs, title, status, and relevant commands.
- `ContextInspector`: optional active-view details.
- `CommandPalette`: indexed navigation/actions with keyboard support.

### Shared interaction components

- `IconButton`, `MenuButton`, `SegmentedControl`, `Toggle`, `Field`, `Select`, `ColorSwatch`, `StatusDot`, `InlineNotice`, `SaveState`, `EmptyState`, `ConfirmDialog`, and `ToastRegion`.
- Components expose semantic states rather than accepting arbitrary visual combinations.
- Icons come from one bundled Lucide build and are not duplicated inline hundreds of times.

### Domain workspaces

Overview, Modules, Server Management, Studio, Skin Studio, Diagnostics, and System own their rendering and event binding. Shared app state is accessed through narrow selectors/events, not by rerendering the entire renderer.

### Embed editing core

One headless embed-document model handles Discord limits, fields, images, components, preview data, and serialization. Two separate shells consume it:

- `FreeEmbedStudioShell` enables send/draft/channel/message capabilities.
- `ModuleEmbedEditorShell` enables template save and optional managed refresh.

Capability flags are explicit and validated. DOM visibility is not used as the security or behavior boundary.

## State and Data Flow

1. Navigation selects a route and optional server/module/template context.
2. The route loads only its required data through existing local API endpoints.
3. Normalized view models are cached per guild and invalidated by config/server events.
4. UI edits update a local draft model and the smallest affected preview subtree.
5. Save validates locally, persists through the existing API, then runs optional live refresh.
6. Persistence and refresh results are displayed separately and recorded in diagnostics.
7. Successful saves update the cache and clear dirty state without reconstructing unrelated panes.

## Performance Contract

- Split `desktop/renderer/app.js` by route and lazy-load Studio, Skin Studio, Server Management, and Diagnostics code.
- Split CSS into tokens/shell/shared controls and route-specific styles. Remove superseded generations instead of layering new overrides indefinitely.
- Keep critical shell CSS small and preload only the primary local font weight and application icon.
- Never decode the full key art on views that do not render it. Provide optimized desktop and narrow-window variants.
- Use event delegation per workspace, abortable requests, and cleanup hooks for timers/listeners.
- Batch live diagnostic and message updates with `requestAnimationFrame` or a bounded interval.
- Avoid full `innerHTML` replacement while typing. Preview changes patch only affected nodes.
- Virtualize or page member, message, channel-content, and large module/event lists.
- Preserve current lazy loading for Three.js and skinview3d.
- Target route switch feedback under 100 ms, editor keystroke-to-preview p95 under 50 ms, and no long task above 200 ms during ordinary navigation on the development machine.

## Responsive Behavior

- Wide: server rail, primary navigation, workspace, and useful inspector.
- Medium: inspector becomes an on-demand drawer; workspace remains primary.
- Narrow desktop: primary navigation collapses to icons with tooltips while server rail remains available.
- Very narrow: only one navigation layer and one workspace layer are visible at once, with predictable back navigation.
- Fixed-format editors retain stable preview geometry and never allow controls or labels to overlap.

## Accessibility and Interaction Quality

- Full keyboard navigation, visible focus, semantic labels, and logical focus restoration after dialogs/routes.
- `prefers-reduced-motion` disables smoke/light transitions and large pane motion.
- Status is never communicated through color alone.
- Dark and light modes meet WCAG contrast requirements; key art never reduces text contrast.
- Destructive actions require precise language and confirmation proportional to impact.

## Error Handling

- Loading, empty, offline, partial-data, permission-denied, persistence-failed, and refresh-failed states receive distinct UI.
- Errors explain what failed and what the user can do next.
- Retry acts on the failed boundary only.
- Unsaved edits remain intact after API or Discord refresh errors.
- Renderer errors are captured by existing diagnostics with route and action context, excluding secrets.

## Verification

- Add smoke tests that prove module editor capabilities cannot expose free-studio sending controls.
- Add state tests for dirty, saving, saved, persistence failure, and refresh failure.
- Keep all existing release tests green throughout migration.
- Add Playwright coverage for navigation, module editing, responsive panes, keyboard focus, and route restoration.
- Capture desktop and narrow-window screenshots for every primary route and check for overlap/clipping.
- Measure startup resource load, route switch duration, long tasks, and embed preview latency before and after each migration phase.
- Validate that the packaged Electron app loads local assets without network font/style requests.

## Migration Strategy

The redesign is delivered as a controlled replacement rather than another CSS layer:

1. Establish tokens, Discord-client-style four-pane shell, navigation, icon system, routing boundaries, and performance instrumentation.
2. Build the headless embed model and separate free/module editor shells; migrate Public Call first as the reference module.
3. Migrate remaining module-specific editors and module browser/workspaces.
4. Rebuild Server Management and Diagnostics around list performance and contextual inspectors.
5. Migrate Overview, System, Login, and startup artwork.
6. Remove superseded CSS/JS paths after each route reaches parity and passes visual/behavioral tests.

No phase may leave duplicate controls active or route two implementations to the same save/send action.

Each phase maintains a checked capability matrix generated from current navigation items, module metadata, fixed UI controls, and route-specific smoke tests. The final migration gate requires zero unmapped existing controls unless the user explicitly approves their removal.

## Licensing Boundary

DiscordBotClient is used only as a behavioral and spatial reference. Its GPL-3.0 code, bundled Discord client code, Vencord code, trademarks, and visual assets are not copied. FALLEN HEAVEN keeps an independent implementation and identity. The app remains a bot administration control center and does not become a third-party Discord user/bot client.
