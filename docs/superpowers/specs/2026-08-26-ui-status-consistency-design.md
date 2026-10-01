# UI status consistency and system-embed discoverability

Date: 2026-08-26
Release: 3.9.294

## Scope

This change repairs ambiguous module states, weak active controls, hidden access
to the Heaven Economy boost-milestone embed, and app-wide light-theme contrast.
It keeps the existing Obsidian/Aurora visual direction and does not change bot
module behavior or stored guild configuration.

## Root causes

1. The module count was rendered inside a bordered pill next to a primary
   button. Both elements therefore looked actionable, although the count was
   read-only.
2. The renderer never compared the enabled count with the catalog size. The
   `Alle aktivieren` action remained enabled and unchanged even when every
   module was already active.
3. Active module buttons only used a seven-percent green tint and a tiny dot.
   Later CSS layers also addressed `.module-toggle:checked`, although catalog
   toggles are buttons and can never match `:checked`.
4. Heaven Economy already supported four editable DM designs, including
   `boostMilestone`, but exposed them under the narrow label
   `VIP-DM-Benachrichtigungen`. The generic grouping and the position below
   unrelated controls made the editor difficult to discover.
5. The final light-theme section used impossible selectors such as
   `body[data-theme="light"] body.authenticated`. Dark text tokens therefore
   never replaced fixed light text from historical CSS layers. ID-specific
   legacy rules could additionally beat later generic fixes even when loaded
   earlier because both declarations used `!important`.
6. The visual audit rendered the module page without authenticated fixture
   cards and only tested the dark theme. It could detect overflow but never saw
   the reported active-state or light-theme defects.

## Behavior

- The module header shows `enabled / total` as a quiet status with a green
  signal, without a border or button surface.
- `Alle aktivieren` becomes `Alle aktiv` and disabled when all catalog modules
  are enabled. It remains actionable if at least one module is inactive.
- Every module toggle receives `aria-pressed`, `data-state`, and an active
  class. Enabled buttons use a bright green surface, border, glow, and check;
  inactive buttons remain neutral.
- Heaven Economy labels the area `Automatische Nachrichten & Embeds` and shows
  the exact command `Boost-Meilenstein-Embed bearbeiten`. It continues to use
  the existing `vipDm` studio, API route, placeholders, normalization, and DM
  delivery path.
- The final CSS layer defines real light Obsidian tokens and explicit contrast
  authority for page headings, metrics, module cards, community panels,
  dashboard cards, forms, and system panels. Discord message previews and the
  deliberately dark Skin Studio canvas are excluded.

## Verification

- `scripts/ui-status-consistency-smoke.mjs` guards status markup, all-enabled
  behavior, `aria-pressed`, active-button styling, valid theme selectors,
  light contrast authority, and the direct milestone editor action.
- `scripts/ui-visual-audit.py` now renders 42 screenshots: seven primary views,
  two themes, and three viewports. The module fixture includes three enabled
  cards and one inactive card with a `22 / 24` status.
- Existing Heaven Economy DM tests continue to verify design persistence,
  placeholder use, message deduplication, and the boost-milestone section.

