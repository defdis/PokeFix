# desktop-app

## Purpose

Electron-десктоп-приложение Responsively 2.0.0-beta.0. Multi-viewport браузер + встроенный MCP-сервер.
Здесь ведётся основная работа форка: встраивается аннотатор (markagent-стиль) и расширяются MCP-tools.

## Ownership

- Репо-форк: `~/dev/responsively-fork`, ветка `fork/annotator`.
- Верхний DOX (`../AGENTS.md`) — правила чтения/обновления; этот файл — локальный контракт этого каталога.

## Local Contracts

- Сборка: `yarn install` (Yarn 4 через corepack), `yarn build:main && yarn build:renderer && yarn build:mcp`
- Dev: `yarn start` (electronmon, MCP-сервер поднимается на `127.0.0.1:12720` автоматически)
- e2e: `yarn test:e2e` (playwright), unit: `yarn test` (vitest)
- Manifest генерится `yarn build:mcp` → `release/app/dist/mcp/manifest.json` (8 сток-тулз)

## Directory Map

- `src/main/mcp/` — MCP-сервер: `toolDefs.ts` (чистые zod-схемы, БЕЗ electron-импортов — шарятся с npm-пакетом), `tools.ts` (реализация), `bridge.ts` (IPC main→renderer), `index.ts` (HTTP на 12720), `agent-config.ts` (one-click конфиги агентов)
- `src/renderer/components/McpBridge/` — исполняет MCP-команды в webviews
- `src/main/screenshot/` — скриншоты кадров (использовать для аннотаций, не изобретать своё)
- `src/renderer/components/ToolBar/McpPanel/` — UI-панель MCP (toggle, copy-config)
- `src/main/preload-webview.ts` (через `.erb` конфиги `webpack.config.preload-webview`) — инъекция в каждый webview — точка для аннотатор-оверлея

## Work Guidance

- Новые MCP-инструменты: сначала `toolDefs.ts` (только zod), затем `tools.ts`, потом `renderer/McpBridge` для выполнения в webview; НЕ импортировать electron в toolDefs.ts (ломает generate-mcp-manifest)
- После каждого существенного изменения — DOX pass (обновить этот файл/родителя)
- Формат экспорта аннотаций — как в существующем pipeline фидбеков юзера: URL, Viewport, список `### 1. <tag> "<text>" / Selector ... / Feedback ...`

## Verification

- После изменений: `yarn lint && yarn typecheck && yarn test`
- Ручной smoke: `yarn start` → открыть URL → RPC initialize на `127.0.0.1:12720` → 200

## Child DOX Index

- (создаётся по мере появления под-директорий с работой; сейчас детей нет)
