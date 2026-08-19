# DR-210 acceptance evidence

Date: 2026-08-19 (Asia/Shanghai)

Scope: DR-210 only. No npm publish, tag, push, pull request, issue closure, or DR-220 work was performed.

## Isolation and versions

- Repository start: `30923c735d9b6f6c58b838a6da8056a2b42b789b`.
- Node: `v24.19.0` (all release gates and host runs).
- npm: `10.8.2`.
- DeepSeek Harness checkout: `0.1.0-rc.7` CLI at commit `99f6f02`.
- dsh-TUI: official npm package `@deepseek-harness-tui/dsh-tui@0.8.3` in a real PTY.
- The task used isolated `$DSH_HOME`, profile, workspace, XDG cache, and npm cache directories under one disposable `$TMP` root.
- No credential was copied from user configuration into the isolated profiles.

## Release-tarball installation

The candidate was built with Node 24, packed with `npm pack --json`, and installed into the Web, headless, and dsh-TUI profiles only through the resulting `.tgz`. The profile dependency rows resolved to that tarball; no repository source path was mounted as the plugin.

The final clean-worktree pack metadata, SHA-256, integrity, and exact file list are saved in `final-pack.json`, `final-pack.sha256`, and `final-pack-files.txt` after the final commit. A package-content guard confirms that `evidence/`, temporary profiles, caches, raw PTY captures, and other task files are absent from the tarball.

## Harness Web

Controlled in-app Browser evidence:

- The real Harness Web profile loaded the packaged `lib/client.js` entry.
- The 📖 button opened, closed, and reopened exactly one `#deepread-panel`; `aria-expanded` returned to `true`.
- Pasted text reached the public budget preflight route and returned: `约 47 字 · ≈4.6k token · ≈<1分钟`.
- A normal Pointer Events drag moved the panel rectangle from `(818, 56)` to `(508, 136)` and returned the title cursor to `grab`. The regression test first failed when the captured pointer left the title element, then passed after the minimal window-level Pointer Events fallback.
- Light and dark themes were selected through normal host UI controls. In dark mode the panel computed colors were `rgb(53, 54, 56)` foreground `rgb(249, 250, 251)` with the host semantic border.
- Browser console log collection returned an empty list.
- Screenshots: `web-light.jpg` and `web-dark.jpg`.

Blocked Web criterion: starting a deep-read session reached the host conversation, then failed with public error `MISSING_CREDENTIAL` for provider route `deepseek-official`. Therefore URL deep reading cannot be marked complete in this isolated, credential-free run.

## Harness headless

The real headless profile activated from the tarball with no `webServer`. A pasted-text request reached the model boundary and exited with:

`dsh: MISSING_CREDENTIAL: llm-deepseek: no API key for provider route "deepseek-official"`

The first sandboxed attempt also surfaced `EMFILE` from the sandbox file-watcher boundary; a bounded rerun outside that restriction produced the precise credential error above. No pasted-text deep-read result was generated, so headless is not accepted.

## dsh-TUI

The real PTY transcript is summarized in `tui-session.txt`.

- `/plugins` reported dsh-TUI `v0.8.3`, `facets: v1alpha1`, and an empty effect ledger.
- `/plugins check` on the installed public manifest reported `Negotiation decision: compatible` in the first PTY run.
- `/context` reported `Skills · 1` with `dsh-deepread` and `Tools · 26` with `deepread`.
- `/skills` still reported `Failed to load the skill list`, although `/context` proves the packaged skill is registered in the host registry.
- A normal pasted-text prompt requesting the `deepread` tool reached the model boundary and failed with `MISSING_CREDENTIAL`; the status reported `0 工具`.

The skill registration defect exposed by the first tarball was fixed test-first in this work item. Tool invocation itself remains blocked and dsh-TUI is not accepted.

## Upgrade and rollback

Public-entry compatibility tests used copies of the `0.5.4` fixtures and passed:

- stats: old to rc, rc to `0.5.4`, damaged input unchanged;
- URL cache: old to rc, rc to `0.5.4`, damaged input unchanged;
- Web local storage: `0.5.4` history/calibration read, damaged bytes degrade without writes.

A historical `0.5.4` source snapshot was packed as a real `dsh-deepread-0.5.4.tgz`, installed through `dsh plugin --profile web add`, and appeared as `id: deepread`, `name: dsh-deepread` in the composed Web profile. This proves the documented reinstallation path and public readers; it does not claim that the blocked rc cross-host smoke passed.

## Verdict

## Two-axis review

- Standards: passed; no hard standards violation and no actionable baseline smell.
- Spec: the first review found the real pointer-drag failure plus incomplete three-host calls, rollback-read evidence, and command/resource evidence. Pointer drag was fixed test-first and reverified in the controlled browser. The other three findings remain explicit blockers or evidence limitations.

DR-210 release gate: **blocked / do not publish**.

The tarball contract, public registration repair, Pointer Events drag, budget route, themes, compatibility fixtures, and rollback installation are verified. The three-host gate is not green because the isolated environment has no model credential for Web URL reading, headless pasted-text completion, or dsh-TUI tool invocation. No release action is authorized by this evidence.
