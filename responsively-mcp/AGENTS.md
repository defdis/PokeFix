# responsively-mcp

## Purpose

Наружный npm-пакет `@responsively/mcp@1.0.0` (MIT) — тонкий бутстрап для подключения AI-агентов.
Реальной логики почти нет: сам находит установленное приложение (location-файл) и запускает
в-process bridge из тела приложения, version-locked к нему.

## Local Contracts

- Бридж ищется по env `RESPONSIVELY_APP_PATH` (кастом-инсталл), иначе автодетект.
- Порт MCP-сервера приложения: `RESPONSIVELY_MCP_PORT`, по умолчанию `12720`.
- Dev-override: `RESPONSIVELY_MCP_BRIDGE` = прямой путь к `cli.js`.

## Work Guidance

- Для форка пакет менять НЕ нужно: подключение Hermes идёт через
  `mcp_servers` в `~/.hermes/config.yaml` со старым нативным паттерном (см. `references/native-mcp` skill),
  либо напрямую HTTP-RPC на `127.0.0.1:12720/mcp` для отладки.
- Пересобирать после изменений форка: `yarn build:mcp` в `desktop-app/`.

## Verification

`npx -y @responsively/mcp` с запущенным приложением должен коннектиться и отдавать 8 тулз
(`get_app_state`, `navigate`, `list_devices`, `set_active_devices`, `screenshot`, `read_page`, `click`, `type_text`).
