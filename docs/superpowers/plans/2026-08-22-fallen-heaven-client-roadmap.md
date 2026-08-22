# FALLEN HEAVEN Bot Client and Control Center Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current dashboard-style renderer with an original Discord-client-style FALLEN HEAVEN bot client while preserving every current control-center capability.

**Architecture:** Deliver the product in independently releasable waves. Existing backend services and APIs remain authoritative; the renderer moves to a four-pane shell and focused route modules. New bot-client actions are added behind the same authenticated local API and permission checks.

**Tech Stack:** Electron 43, vanilla JavaScript/HTML/CSS, Express 5, discord.js 14, better-sqlite3, existing smoke-test scripts.

## Global Constraints

- Use only official Discord bot API and Gateway capabilities; never request or store a normal user token.
- Do not copy DiscordBotClient, Discord client, or Vencord GPL/proprietary source or assets.
- Preserve every existing renderer workflow until its replacement passes a capability-parity gate.
- The module template editor must never expose free-studio channel, draft, JSON, message-edit, or bot-send controls.
- Keep Three.js and skinview3d lazy-loaded.
- Use local assets and fonts only; no network font or stylesheet requests.
- Every wave keeps `npm run test:release` green before legacy paths are removed.

---

## Delivery Waves

### Wave A: Client foundation

Plan: `docs/superpowers/plans/2026-08-22-fallen-heaven-client-foundation.md`

Deliver a tested four-pane shell, route registry, capability manifest, guild/channel navigation, read-only message surface, contextual inspector, local key-art treatment, and baseline performance instrumentation. All current views remain reachable through compatibility routes.

Exit gate:

- Guild switch and channel switch preserve route/scroll state.
- Channel history renders from the existing keyset/page API.
- No existing fixed control or module field is unmapped.
- Shell works at wide, medium, and narrow Electron window sizes.

### Wave B: Bot messaging client

Backend responsibilities:

- Add authenticated endpoints for bot message send/reply, bot-owned edit/delete, reactions, pins, threads, forum posts, attachments, and supported polls/components.
- Normalize permission/ownership capabilities per channel and message.
- Reuse Discord REST rate-limit behavior and record action diagnostics.

Renderer responsibilities:

- Add message composer, reply/edit state, attachment queue, emoji/reaction controls, thread/forum surfaces, search/pagination, and optimistic states with rollback.
- Never render actions that the bot/API/permissions cannot perform.

Exit gate:

- A bot can browse, send, reply, edit its own content, delete with appropriate ownership/moderation rules, react, and work with supported threads/forums.
- API tests cover permission denied, rate limited, missing channel/message, attachment failure, and partial success.

### Wave C: Modules and embed workflows

Renderer responsibilities:

- Convert the module directory into channel-like contextual navigation and dedicated workspaces.
- Introduce one headless embed-document model with separate `FreeEmbedStudioShell` and `ModuleEmbedEditorShell` capability contracts.
- Migrate Public Call first, then every module-specific template workflow.

Exit gate:

- Public Call exposes only template save/panel refresh actions.
- Free Studio retains all drafts, targets, forum, components, reactions, JSON, sending, and existing-message editing.
- Every module metadata field counted by `ui-field-audit.mjs` is present and functional.

### Wave D: Server administration client

Renderer responsibilities:

- Move channels/categories, channel content, roles, members, permissions, forum, timeline, backups, and supported moderation into client-style subroutes and inspectors.
- Virtualize or paginate all large collections and preserve selection/scroll state.

Backend responsibilities:

- Fill missing bot-safe member, role, moderation, pin, reaction, and voice-state actions with explicit permission contracts.

Exit gate:

- Existing server-management smoke suites pass against new route modules.
- Destructive operations require accurate previews/confirmations and remain auditable.

### Wave E: Studios, diagnostics, system, and identity

- Migrate Skin Studio without changing its painting/AI/layer behavior or eager-loading 3D libraries.
- Rebuild Diagnostics as a batched live stream with filtering, pause, details, copy/export, and timing evidence.
- Rebuild System/Updates/Backup operational surfaces.
- Integrate optimized FALLEN HEAVEN key-art crops into login/start/empty states only.

Exit gate:

- All existing studio, diagnostics, update, packaged-app, and release tests pass.
- No key art or 3D dependency loads on routes that do not render it.

### Wave F: Legacy removal and release proof

- Remove superseded CSS generations and route code only after parity evidence exists.
- Split route JavaScript/CSS loading and measure startup, route switches, preview latency, and long tasks.
- Run visual overlap checks and packaged Electron verification at all target sizes.
- Update `PROJEKT-WISSEN.md` with architecture, migrations, commands, limitations, and final measurements.

Final exit gate:

- `npm run test:release`, packaged smoke, artifact audit, and visual/performance checks pass.
- Capability manifest reports zero unmapped legacy controls.
- No normal-user Discord feature or token path exists.

## Commit Policy

Each independently green task receives one focused conventional commit. Never stage unrelated user changes from the existing dirty worktree. Execution should begin in an isolated `codex/` worktree when possible and integrate only reviewed commits.
