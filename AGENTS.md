# AGENTS.md

This repository is an out-of-tree plugin for DeepSeek Harness. Before changing plugin packaging, Cordis wiring, the browser client, or host-facing tests, read [`docs/deepseek-harness-integration.md`](docs/deepseek-harness-integration.md).

## Upstream authority

- The local upstream checkout is `/Users/xiehuan/Desktop/project/deepseek-harness`. Treat its documentation and current source as authoritative; do not infer Harness APIs from this plugin's compatibility shims.
- If the upstream checkout contains a usable `.codegraph/` index, use CodeGraph before text search. If CodeGraph reports that the index is unavailable, continue with upstream documentation and source.
- Do not edit the upstream checkout while working on this plugin unless the user explicitly requests an upstream change.

## Plugin identities and source files

- Keep these identities distinct: npm/client-module id `dsh-deepread`, Cordis plugin name and tool name `deepread`, and patch row id `deepread`.
- `src/index.ts` and `src/host/**/*.ts` are the Node-half sources. `src/client/**/*.ts` are the browser-half sources. `lib/types/**/*.js`, `lib/types/**/*.d.ts`, and `lib/client.js` are generated; never edit them directly.
- `package.json` owns `dsh.bundle`, `dsh.client`, `dsh.skills`, exports, dependencies, and packed files. `cordis.patch.yml` only mounts the Node half.
- `package.json`, the root package in `package-lock.json`, `dsh-plugin.json`, root `plugin.json`, `.claude-plugin/plugin.json`, and `.codex-plugin/plugin.json` are real version sources and must stay identical. The current dsh-TUI minimum is `0.8.1`, using the Host-only Community Consensus v0.15 manifest.
- The Web client is optional packaging: DeepSeek Harness Web loads `lib/client.js`; Harness headless and dsh-TUI load the Host entry and skill without loading browser UI.
- `.codex-plugin/`, `.claude-plugin/`, and root `plugin.json` are host metadata. They do not install or activate the DeepSeek Harness profile bundle.

## Release documentation

- [`docs/upgrade-and-rollback.md`](docs/upgrade-and-rollback.md) owns the data-retention conditions and the supported `0.5.4` rollback procedure.
- Versioned draft notes live under `docs/releases/`; community catalog metadata lives in [`docs/community-listing-update.md`](docs/community-listing-update.md). These files must be included by `package.json#files` when README links expose them to installers.
- Do not describe a draft tag, npm version, or cross-host smoke as published or complete before the corresponding release work item is actually run.

## Harness lifecycle rules

- Register Node resources through `ctx.effect()` or another disposer-returning Harness API. Register browser UI through `ctx.slots.inject(..., () => ctx.slots.register(...))` so late declarations, reload, and disposal stay aligned.
- Keep Node `inject`, browser `exports.inject`, and `package.json#dsh.client.inject` conceptually separate; the integration reference explains their different roles.
- `webServer`, `storageDomain`, and `jobs` are optional services discovered at their use sites. Keep the core Host tool activatable in stock `headless` and dsh-TUI compositions.
- Consume `--dsw-alias-*` semantic theme tokens. Do not add feature-owned light/dark selectors or new literal theme colors.

## Verification

- After browser-source changes, run `npm run build:client` and commit the matching `lib/client.js`.
- Run `npm test` for every behavior or packaging change. Release/documentation changes must keep `test/release-docs-contract.mjs` green, including its real `npm pack --dry-run --json` file-list check.
- Manifest, profile, slot-lifecycle, or browser-loader changes also require an assembled test in a compatible local DeepSeek Harness Web profile; the repository tests alone only prove the plugin's local shims and bundle handoff.
- Preserve unrelated working-tree changes and do not modify profile installation state unless the user asks for installation or removal.
