# Pokefix (desktop-app)

Electron app for Pokefix — see the [repository root README](../README.md) for what
Pokefix is, the annotation workflow and MCP tools.

Forked from Responsively App (AGPL-3.0). Build instructions:

```bash
yarn install
yarn start       # dev (electronmon + webpack-dev-server)
yarn package     # production build → release/build/
```

Layout:

- `src/main` — main process: window, MCP server (`src/main/mcp`), preloads (`preload.ts`,
  `preload-webview.ts` — the annotation overlay), webview security (`webview-registry.ts`)
- `src/renderer` — React UI: annotator bar (`components/AnnotatorBar`), toolbar, MCP panel
- `src/common` — code shared between main and renderer (MCP protocol types, constants)
- `.erb/` — webpack configs and release scripts (from electron-react-boilerplate)

Verification before committing: `yarn lint && yarn typecheck && yarn test`.
See `../AGENTS.md` and `./AGENTS.md` for the repo contracts.
