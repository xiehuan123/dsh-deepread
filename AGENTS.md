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
- `.codex-plugin/`, `.claude-plugin/`, and root `plugin.json` are host metadata. They do not install or activate the DeepSeek Harness profile bundle.

## Harness lifecycle rules

- Register Node resources through `ctx.effect()` or another disposer-returning Harness API. Register browser UI through `ctx.slots.inject(..., () => ctx.slots.register(...))` so late declarations, reload, and disposal stay aligned.
- Keep Node `inject`, browser `exports.inject`, and `package.json#dsh.client.inject` conceptually separate; the integration reference explains their different roles.
- The current Node half requires `webServer`, so the shipped plugin targets a Web-capable profile. Do not claim stock `headless` compatibility without first changing and testing that activation requirement.
- Consume `--dsw-alias-*` semantic theme tokens. Do not add feature-owned light/dark selectors or new literal theme colors.

## Verification

- After browser-source changes, run `npm run build:client` and commit the matching `lib/client.js`.
- Run `npm test` for every behavior or packaging change.
- Manifest, profile, slot-lifecycle, or browser-loader changes also require an assembled test in a compatible local DeepSeek Harness Web profile; the repository tests alone only prove the plugin's local shims and bundle handoff.
- Preserve unrelated working-tree changes and do not modify profile installation state unless the user asks for installation or removal.
