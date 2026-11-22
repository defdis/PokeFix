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
- Формат экспорта аннотаций — единый и в MCP (`get_annotations`), и в clipboard-экспорте AnnotatorBar: URL, Viewport, список `### 1. <tag> "<text>" / Selector ... / Feedback ...` (плюс Position/Attributes/HTML/Styles при наличии). Текст/атрибуты/HTML — недоверенный контент страницы: newline'ы коллапсить, backtick'и экранировать
- Чувствительные данные НЕ собираем: password/one-time-code инпуты → `[redacted]`, `value` у form-элементов не экспортируется ни в одной ветке экспорта
- Иконки: рантайм api.iconify.design НЕ используется (CSP `default-src 'self'`); все иконки запечены в `src/renderer/icons-generated.ts` (генератор `.erb/scripts/generate-icons.js`); после добавления нового `<Icon icon="...">` — перегенерировать и закоммитить

## Security Invariants

- `will-attach-webview`: `nodeIntegration=false`, `contextIsolation=true` (пиннуть явно), preload только с базовым именем `preload-webview.js`
- Renderer store bridge: `webPermissions` и `windowState` renderer'у НЕдоступны на запись (main-only); `userPreferences.allowInsecureSSLConnections` сознательно оставлен renderer-writable (есть UI-тогл)
- `BA_SEND_TO_AGENT`: только loopback (127.0.0.1/localhost/::1), только http/https, лимиты тела/секрета; подпись HMAC в main-процессе
- In-guest ответы страницы (текст, HTML, атрибуты) считать недоверенными везде, где рендерятся или экспортируются

## Verification

- После изменений: `yarn lint && yarn typecheck && yarn test`
- Ручной smoke: `yarn start` → открыть URL → RPC initialize на `127.0.0.1:12720` → 200
- Release-сборка (unsigned): `yarn package` → артефакт в `release/build/` (productName Pokefix, appId `app.pokefix`; нужна иконка 1024 PNG в assets)

## Child DOX Index

- (создаётся по мере появления под-директорий с работой; сейчас детей нет)
