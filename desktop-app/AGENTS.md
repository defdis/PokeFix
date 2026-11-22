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
- get_session_handoff (+ алиас get_work_status) — read-only снимок для старта сессии агента: URL/заголовок/layout/zoom, активные девайсы, непотреблённые метки (без consume), последние 10 страниц; markdown + JSON.
- Manifest генерится `yarn build:mcp` → `release/app/dist/mcp/manifest.json` (12 тулзов с форком)
- stdio-мост копируется в `<userData>/mcp/cli.js` при каждом старте (все ОС) — агенты ссылаются на этот стабильный путь; при отсутствии моста (dev) конфиги откатываются на `npx -y @responsively/mcp`
- Агенты: 11 one-click (Claude Desktop/Code, Codex, Cursor, VS Code, Windsurf, Cline, Gemini CLI, OpenCode, Continue, Hermes). Hermes/Continue — YAML с маркер-комментариями `# >>> pokefix-mcp >>>` (не трогаем чужие ключи); opencode — flat `mcp` map + `environment`; Cline/Gemini/Windsurf/Cursor — `mcpServers`+env; VS Code — ключ `servers`
- НЕ возвращать npx-based конфиги: апстримный @responsively/mcp ищет приложение по путям ResponsivelyApp и не найдёт Pokefix

## Directory Map

- `src/main/acp-chat.ts` + `src/common/acp.ts` — «Агент-чат»: ACP (Agent Client Protocol) по stdio к `hermes acp` / `opencode acp`; стриминг `session/update` (agent_message_chunk/tool_call/usage). ВАЖНО: hermes НИКОГДА не шлёт JSON-RPC ответ на `session/prompt` (проверено 2026-11-22 дважды) — завершение хода детектируется по trailing `usage_update` после контентных чанков (+ watchdog 4 мин), turn-complete идемпотентен
- Permission-запросы от агента → inline-кнопки; cwd = `baAgentCwd` (общая с самолётиком); UI: `src/renderer/components/AgentChat/` (FAB + панель)
- Самолётик (AnnotatorBar) = не отдельный runner, а «отправить в чат»: клик шлёт промпт через `renderer/lib/agentChatBus.ts` в открытый/ленивый ACP-чат (`sendText`); кнопки `/undo` (= `/undo` агента) и restore меток (`baAnnotationApi.restore()`, бэкап снимается на каждый clear, переживает reload через sessionStorage)
- Hover в pick-режиме показывает DevTools-style box model: оранжевые полоски margin, зелёные padding (clip-path, pointer-events:none) + чип `m T R B L · p T R B L`; см. `baHoverMove` в preload-webview.ts
- Режим разметки включается двумя путями: удерживание Alt (как раньше) ИЛИ тумблер crosshair в баре (pick mode, Esc/повторный клик выключает); клик в pick mode ставит метку без Alt. Синхронизация guest↔host: `ba-annotate-pick-mode` в обе стороны, `baAnnotatorSetPickMode` в main-world; при выключении аннотатора pick mode сбрасывается
- `get_annotations` = consume-on-read (см. выше); AnnotatorBar умеет вернуть метки кнопкой ↩ после ошибочной отправки
- `src/main/mcp/` — MCP-сервер: `toolDefs.ts` (чистые zod-схемы, БЕЗ electron-импортов — шарятся с npm-пакетом), `tools.ts` (реализация), `bridge.ts` (IPC main→renderer), `index.ts` (HTTP на 12720), `agent-config.ts` (one-click конфиги 11 агентов; пишет `<userData>/mcp/cli.js` + `ELECTRON_RUN_AS_NODE=1`, не npm)
- `src/renderer/components/McpBridge/` — исполняет MCP-команды в webviews
- `src/main/screenshot/` — скриншоты кадров (использовать для аннотаций, не изобретать своё)
- `src/renderer/components/ToolBar/McpPanel/` — UI-панель MCP (toggle, copy-config)
- Masonry-раскладка: JS pack (`Previewer/masonry.ts`, shortest-column, unit-tested) по измеренной ширине сцены; CSS multicol выпилен — кадры шире колонки обрезались. Ширина колонки = max framed (с бехелем) сумма ≤ доступной ширины, иначе колонка схлопывается
- Focus-режим: единственный переключатель устройств — `FocusDeviceBadge` (плавающая пилюля вверху сцены: тип-иконка, имя, mono-размеры, точки, ‹ ›, выход ✕); старый таб-стрип удалён. Высотная цепочка Previewer обязана держать `min-h-0`/`flex-1` — webview негативно клипуется DOM `overflow` (нативный слой) и иначе перекрывает нижний статус-бар
- DevTools по умолчанию открываются отдельным нативным окном (`dockPosition` default UNDOCKED + одноразовая миграция `devtools.dockMigrationV2`: старый BOTTOM → UNDOCKED; док вернуть через гамбургер → Dock devtools)
- Перфоманс: рендерер не дёргает `executeJavaScript` по таймеру без нужды; аннотаторный поллинг двухфазный (signature → full fetch при изменениях); electron-store записи из рендерера коалесцируются в main (`store-write-buffer.ts`, flush 250мс + на will-quit); первый paint не ждёт browser-sync (`ready-to-show` не await'ит initInstance, BS-клиент инжектится только в local-страницы); скролл-координаты в Device — только пока открыта линейка/оверлей; чтение истории — через renderer-кэш `lib/historyCache.ts` (никакого sync sendSync на каждый keystroke)
- `src/main/local-servers.ts` + `ToolBar/LocalServers/` — кнопка монитора в адресной строке: lsof + HTTP-проба (title) юзерских localhost-сервисов; клик → открыть во всех вьюпортах; IPC `BA_LIST_LOCAL_SERVERS`, кэш 5с, свой 12719/12720 исключены
- `src/main/preload-webview.ts` (через `.erb` конфиги `webpack.config.preload-webview`) — инъекция в каждый webview — точка для аннотатор-оверлея

## Work Guidance

- Новые MCP-инструменты: сначала `toolDefs.ts` (только zod), затем `tools.ts`, потом `renderer/McpBridge` для выполнения в webview; НЕ импортировать electron в toolDefs.ts (ломает generate-mcp-manifest)
- После каждого существенного изменения — DOX pass (обновить этот файл/родителя)
- Plane (самолётик) шлёт метки в ACP-чат (не модалка, не отдельный процесс); `clearAfterSend` (default on) чистит метки после отправки; вернуть их — кнопка ↩ в баре; иконки — только из `icons-generated.ts`
- `get_annotations` — consume-on-read: после выдачи меток MCP-вызов САМ их очищает (clear=false отключает); бейдж/список в баре обновится через поллинг ≤1.5с
- Формат экспорта аннотаций — единый и в MCP (`get_annotations`), и в clipboard-экспорте AnnotatorBar: URL, Viewport, список `### 1. <tag> "<text>" / Selector ... / Feedback ...` (плюс Position/Attributes/HTML/Styles при наличии). Текст/атрибуты/HTML — недоверенный контент страницы: newline'ы коллапсить, backtick'и экранировать
- Чувствительные данные НЕ собираем: password/one-time-code инпуты → `[redacted]`, `value` у form-элементов не экспортируется ни в одной ветке экспорта
- Иконки: рантайм api.iconify.design НЕ используется (CSP `default-src 'self'`); все иконки запечены в `src/renderer/icons-generated.ts` (генератор `.erb/scripts/generate-icons.js`); после добавления нового `<Icon icon="...">` — перегенерировать и закоммитить

## Security Invariants

- `will-attach-webview`: `nodeIntegration=false`, `contextIsolation=true` (пиннуть явно), preload только с базовым именем `preload-webview.js`
- Renderer store bridge: `webPermissions` и `windowState` renderer'у НЕдоступны на запись (main-only); `userPreferences.allowInsecureSSLConnections` сознательно оставлен renderer-writable (есть UI-тогл)
- agent-runner (`hermes -z` subprocess) удалён 2026-11-22: самолётик шлёт в ACP-чат; `resolveExecutable` живёт в `src/main/resolve-executable.ts` (поиск бинарника агента)
- In-guest ответы страницы (текст, HTML, атрибуты) считать недоверенными везде, где рендерятся или экспортируются

## Verification

- После изменений: `yarn lint && yarn typecheck && yarn test`
- Ручной smoke: `yarn start` → открыть URL → RPC initialize на `127.0.0.1:12720` → 200
- Release-сборка (unsigned): `yarn package` → артефакт в `release/build/` (productName Pokefix, appId `app.pokefix`; нужна иконка 1024 PNG в assets)
- Версия релиза хранится в ДВУХ местах: `desktop-app/package.json` (зовётся `yarn package`) и `release/app/package.json` + `release/app/package-lock.json` (two-package.json; `release/app` НЕ в git) — бампать оба, иначе DMG и `app.getVersion()` (он же версия MCP-сервера) останутся на старой версии
- Подпись релизов: 0.9.x — только adhoc (`--config.mac.identity=-`; обычная `yarn package` подхватит Apple Development cert из связки — для дистрибуции НЕ годится). Нотаризация (Developer ID Application + notarytool) — перед 1.0, требует Apple Developer Program ($99/год). В 0.9.0 у пользователей будет right-click → Open

## Child DOX Index

- (создаётся по мере появления под-директорий с работой; сейчас детей нет)
