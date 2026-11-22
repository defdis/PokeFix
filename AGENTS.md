# DOX framework

- DOX is highly performant AGENTS.md hierarchy installed here
- Agent must follow DOX instructions across any edits

## Core Contract

- AGENTS.md files are binding work contracts for their subtrees
- Work products, source materials, instructions, records, assets, and durable docs must stay understandable from the nearest applicable AGENTS.md plus every parent AGENTS.md above it

## Read Before Editing

1. Read the root AGENTS.md
2. Identify every file or folder you expect to touch
3. Walk from the repository root to each target path
4. Read every AGENTS.md found along each route
5. If a parent AGENTS.md lists a child AGENTS.md whose scope contains the path, read that child and continue from there
6. Use the nearest AGENTS.md as the local contract and parent docs for repo-wide rules
7. If docs conflict, the closer doc controls local work details, but no child doc may weaken DOX

Do not rely on memory. Re-read the applicable DOX chain in the current session before editing.

## Update After Editing

Every meaningful change requires a DOX pass before the task is done.

Update the closest owning AGENTS.md when a change affects:

- purpose, scope, ownership, or responsibilities
- durable structure, contracts, workflows, or operating rules
- required inputs, outputs, permissions, constraints, side effects, or artifacts
- user preferences about behavior, communication, process, organization, or quality
- AGENTS.md creation, deletion, move, rename, or index contents

Update parent docs when parent-level structure, ownership, workflow, or child index changes. Update child docs when parent changes alter local rules. Remove stale or contradictory text immediately. Small edits that do not change behavior or contracts may leave docs unchanged, but the DOX pass still must happen.

## Hierarchy

- Root AGENTS.md is the DOX rail: project-wide instructions, global preferences, durable workflow rules, and the top-level Child DOX Index
- Child AGENTS.md files own domain-specific instructions and their own Child DOX Index
- Each parent explains what its direct children cover and what stays owned by the parent
- The closer a doc is to the work, the more specific and practical it must be

## Child Doc Shape

- Create a child AGENTS.md when a folder becomes a durable boundary with its own purpose, rules, responsibilities, workflow, materials, or quality standards
- Work Guidance must reflect the current standards of the project or user instructions; if there are no specific standards or instructions yet, leave it empty
- Verification must reflect an existing check; if no verification framework exists yet, leave it empty and update it when one exists

Default section order:

- Purpose
- Ownership
- Local Contracts
- Work Guidance
- Verification
- Child DOX Index

## Style

- Keep docs concise, current, and operational
- Document stable contracts, not diary entries
- Put broad rules in parent docs and concrete details in child docs
- Prefer direct bullets with explicit names
- Do not duplicate rules across many files unless each scope needs a local version
- Delete stale notes instead of explaining history
- Trim obvious statements, repeated rules, misplaced detail, and warnings for risks that no longer exist

## Closeout

1. Re-check changed paths against the DOX chain
2. Update nearest owning docs and any affected parents or children
3. Refresh every affected Child DOX Index
4. Remove stale or contradictory text
5. Run existing verification when relevant
6. Report any docs intentionally left unchanged and why

## User Preferences

When the user requests a durable behavior change, record it here or in the relevant child AGENTS.md

## Child DOX Index

- `desktop-app/AGENTS.md` — основное Electron-приложение: MCP-сервер (src/main/mcp), renderer McpBridge, screenshot-сервис, preload-webview. Здесь идёт вся работа форка (аннотатор + новые MCP-tools).
- `responsively-mcp/AGENTS.md` — наружный npm-бутстрап `@responsively/mcp` (апстрим, пишет в апстрим-путей ResponsivelyApp — в форке НЕ используется для проводки конфигов; агентов подключаем через встроенный stdio-мост).
- `browser-extension/AGENTS.md` — Chrome-расширение helper; в v1 форка не трогается.

## Project Snapshot (fork)

- Что это: Pokefix — форк Responsively 2.0.0-beta.0 (`AGPL-3.0`, ветка `fork/annotator`, origin → github.com/defdis/PokeFix).
- Сделано: аннотатор (Annotate-кнопка + Alt+клик + note-поповер + AnnotatorBar снизу), MCP-tools `get_annotations`/`clear_annotations`, send-to-agent agent-runner-кнопка, one-click подключение 11 агентов (Claude Desktop/Code, Codex, Cursor, VS Code, Windsurf, Cline, Gemini CLI, OpenCode, Continue, Hermes) через встроенный stdio-мост (`<userData>/mcp/cli.js` + `ELECTRON_RUN_AS_NODE=1`).
- 2026-11-22, production-hardening pass: исправлены баги аннотатора (гонки clear, autofix-цикл поллинга, reload-потеря ввода, checkbox-снап-бэк), утечка секретов (password-поля редректируются из экспорта), `contextIsolation` pin, loopback-only webhook (позже заменён прямым agent-run), certificate-error host-match, openExternal allowlist, CSP `default-src`, store-bridge сужен (webPermissions — main-only), debug-логи вырезаны, кастомные macOS-иконки (824/1024 сетка), rebrand (appId `app.pokefix`, binary paths Pokefix, README/иконки/README-бейджи), апстрим-спонсорство выпилено, electron-updater отключён (нет своего feed'а).
- Осталось до релиза: проверить unsigned сборку (`yarn package`), GitHub Release на defdis/PokeFix (релиз — только по явному «го» от юзера); подпись/нотаризация невозможна без Developer ID; publish-*.yml удалены (апстрим-релизный путь закрыт), релиз — вручную через GitHub.
- 2026-11-22, вечер: иконки забандлены (`icons-generated.ts`, 93 шт.; api.iconify.design больше не дёргается; CSP `default-src 'self'`), postinstall-фикс (rimraf glob без .map → node-скрипт), лупбэк-webhook убран: кнопка самолётик теперь гоняет `hermes -z {prompt}` (или любой CLI-агент из ⚙-настроек: `baAgentCommand`/`baAgentCwd`) как дочерний процесс без shell, ответ показывается в модалке, метки чистятся после успеха. Релиз v1.0.0 собран (arm64+x64, adhoc, Gatekeeper-инструкции в release notes); GitHub Release ждёт gh-авторизацию юзера.
- 2026-11-22, ночь: агентный терминал-док внизу главного окна (xterm.js + node-pty, whitelist CLI: hermes/claude/codex/gemini/opencode), one-click Add на любой MCP-клиент (11 штук), встроенный stdio-мост вместо npm bootstrap; opencode end-to-end проверен (`mcp list` → 10 тулзов).
- 2026-11-22, поздно: one-click MCP-подключение любых агентов. agent-config.ts теперь без npx: пишет абсолютный путь `<userData>/mcp/cli.js` + app-binary как node (ELECTRON_RUN_AS_NODE=1) — работает без сети и без npm; мост копируется в userData при каждом старте (все платформы); hermes-webhook запись заменена на mcp_servers- stdio; opencode — flat `mcp` map с `environment`; Continue — yaml `mcpServers` list с маркерами `# >>> pokefix-mcp >>>`. Проверено на opencode (`mcp list` → connected, 10 тулзов).
- Формат экспорта аннотаций — как в фидбеках юзера (URL/Viewport/### 1. tag "text"/Selector/Feedback); редактировать синхронно в `commands.ts` (MCP) и `AnnotatorBar` (clipboard).
