# 📖 DeepRead — Evidence-first reading for AI agents

English | [中文](README.zh.md)

> Turn long articles, books, PDFs, and document sets into traceable claims, evidence, confidence levels, knowledge maps, and review questions.

[![npm version](https://img.shields.io/npm/v/dsh-deepread)](https://www.npmjs.com/package/dsh-deepread)
[![GitHub release](https://img.shields.io/github/v/release/xiehuan123/dsh-deepread?display_name=tag)](https://github.com/xiehuan123/dsh-deepread/releases/latest)
[![Agent Skill](https://img.shields.io/badge/Agent%20Skill-Codex%20%7C%20Claude%20Code-6366f1)](./skills/dsh-deepread/SKILL.md)
[![Awesome DSH Plugin](https://beancookie.github.io/awesome-dsh-plugin/badge.svg)](https://beancookie.github.io/awesome-dsh-plugin)
[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

![DeepRead evidence-first reading workflow](assets/deepread-demo.svg)

DeepRead is available in two compatible forms:

- **Portable Agent Skill** for Codex, Claude Code, and other Agent Skills-compatible tools. Zero runtime dependencies; the agent follows the evidence-first reading workflow with its own file and web tools.
- **Full DeepSeek Harness plugin** with a `deepread` tool, browser UI, PDF extraction, background jobs, progress updates, batch comparison, cost preview, and HTML/XMind-compatible export.

## Quick start

### Portable Agent Skill

```sh
npx skills@latest add xiehuan123/dsh-deepread
```

Then ask your agent:

```text
Deep-read docs/architecture.pdf in knowledge-map mode.
For every important claim, show the supporting evidence and source location.
```

### Full DeepSeek Harness plugin

```sh
dsh plugin --profile web add dsh-deepread
```

Restart `dsh web`, then use the 📖 reading panel or call the `deepread` tool in chat.

## See it in action

The repository includes real, reproducible output rather than placeholder screenshots:

- [`deep` mode: Claude Code token optimization](examples/claude-code-token-optimization.md) — claims, evidence, argument flow, concepts, and critical questions.
- [`map` mode: fact-check knowledge map](examples/ad-fact-check-knowledge-map.md) — confidence levels, evidence pairing, data table, relation labels, Mermaid map, and recall questions.
- [`deep` mode: vivo Tauri architecture](examples/vivo-tauri-architecture.md) — architecture decisions, supporting data, and limitations.

DeepRead never silently upgrades a theme into a claim or fills missing support with invented evidence. If the source does not support a claim, the report says so.

## Features

| Capability | Details |
| --- | --- |
| 🎛️ Five modes | `quick` key takeaways · `deep` in-depth reading · `map` knowledge map · `feynman` Feynman technique (11-step loop + spaced repetition) · `book` whole-book reading (see the comparison below) |
| 🗺️ Knowledge-map mode | Core question / core conclusion / ten content categories (conclusion, sub-claim, mechanism, fact, data, case, hidden premise, objection, limitation, actionable advice) / every claim paired with evidence (unverifiable claims marked "no evidence provided in the original text") / key data table (value & unit, time range, sample, baseline, source, location) / eight relation labels (supports, refutes, causes, explains, depends on, exemplifies, contrasts, limits) / **four confidence levels** (author intent, original facts & data, reasonable inference, unverifiable) / Mermaid mindmap / XMind outline / 5 active-recall questions |
| 📥 Three inputs | WeChat article URLs (`mp.weixin.qq.com` stable links) · files (`.txt/.md/.html/.pdf`, PDF via a built-in pure-JS extractor with Chinese ToUnicode mapping, page markers, and object-stream/xref-stream support) · pasted text |
| 📤 Optional export | Displayed in-session by default; `export` accepts `md` / `mm` (FreeMind, importable by XMind) / `html` (editor-style web report with light/dark theme) / `all`, written to `deepread-output/` in the workspace |
| 🎨 Browser UI | `deepread` tool result card (four-color confidence legend, collapsible sections) + a 📖 shortcut button next to the input area that opens a card-style reading panel (link/path/text + mode/export selection + reading focus + one-click start) |
| 🔀 Batch compare | Pass 2-10 documents via `batch` (url/path/text each) to get per-document summaries plus a cross-document report: comparison matrix, conflicts, complementarity, and synthesis |
| 📍 Citations | Reports carry page/paragraph provenance: arguments, quotes, and a dedicated citation table locate claims back to `【第N页】` markers in the source |
| 🧮 Cost preview | `estimate: true` previews token spend, model-call count, and expected time per mode without calling the model (CJK≈0.6 tok/char heuristic; rate/latency defaults are picked per model family and can be overridden explicitly) |
| 📚 Recently read | The Web panel keeps a local history of recent reads with one-click re-read (localStorage, no server round-trip) |
| ⏳ Progress transparency | Long reads / big PDFs / batches become official background jobs: the label states segment count and budget; the progress stream pushes 「精读第 3/20 段…」 line by line; job_output polls progress and the final report, job_kill cancels |
| 🔍 Parse progress | Full PDF extraction moves inside the background job and streams **per page** — 「解析 PDF 中… 42%（10/24 页）」 — after a fast sampling preflight decides length (no more silent wait before the background job appears); batches stream per document — 「解析第 2/5 篇… / 精读第 2/5 篇… / 完成第 2/5 篇」 plus 「跨篇对比汇总中…」 |
| 🧮 Panel budget | The Web panel shows per-mode token + time hints above the mode chips (e.g. 深度精读 (≈38k token · ≈8分钟)), instantly for pasted text; calibrated by real model speed; links/file paths are fetched and estimated by the Host through a same-origin API (`POST /api/deepread/budget`) and the panel's 🔍 budget-preflight button shows a one-line result (≈N chars · ≈X token · ≈Y min) right inside the panel — no chat round-trip, no table |
| ⚡ Fast preflight | estimate mode samples the first 2 PDF pages and extrapolates by page count, so big PDF budgets come back in milliseconds |
| 🎯 Self-calibration | Real token/s measured from every model call feeds a rolling average persisted in storage — estimates converge to your actual provider speed; cold-start defaults are per model family (DeepSeek/Kimi/Qwen ≈100-110 tok/s, Claude ≈70, GPT ≈90) |

## Five modes compared

| Mode | Best for | Key output | Cost |
| --- | --- | --- | --- |
| `quick` | "What is this article about?" at a glance | One-line summary, core claim, argument structure, quotes, key concepts, critical questions | Single call, fastest |
| `deep` (default) | Reading one article carefully | Overview, core claim, argument structure (claim + evidence + verbatim quotes), argument flow, section highlights, quotes, key concepts, critical thinking | Long articles are auto-split, section-by-section + summary |
| `map` | Research, fact-checking before citing | Core question & conclusion, ten content categories, claim-evidence pairing, key data table (five elements), eight relations, four confidence levels, Mermaid mindmap, XMind outline, active-recall questions | Structured pipeline, multiple calls |
| `feynman` | Truly learning it and teaching it to others | 11-step loop: TOC → questions → per-chapter → claims/data/evidence → chapter mindmap → explain with the book closed → self-check gaps → correct against the source → merged mindmap → explain again → spaced review on days 1/3/7/14/30 | Longest output, most calls |
| `book` | Whole books / very long texts | Table of contents, chapter flow, a full-book summary assembled from per-part deep reads | Processed part by part |

One-line picker: in a hurry, `quick`; read one article thoroughly, `deep`; cite and fact-check, `map`; learn and remember, `feynman`; a whole book, `book`.

## Installation

### DeepSeek Harness (tool + Web UI, full functionality)

Requires **pnpm** on the machine (`dsh plugin` runs pnpm underneath to install plugins) and Node.js ≥ 22.

```sh
# From npm (prebuilt, no build authorization needed)
dsh plugin --profile web add dsh-deepread

# Pin a version
dsh plugin --profile web add dsh-deepread@^0.5.4

# From GitHub (source; build artifacts are committed)
dsh plugin --profile web add "github:xiehuan123/dsh-deepread#v0.5.4"
```

Restart `dsh web` for it to take effect. A 📖 shortcut button appears next to the input area; click it to open the card-style reading panel. You can also just say: "Read this article in knowledge-map mode: <content>".

> Tip: fetching WeChat article URLs needs an HTTP provider. If you see "web fetch service unavailable" after install, mount `@deepseek-ai/dsh-web-fetch-http` in the profile's `cordis.patch.yml` and give it a browser User-Agent (WeChat serves an anti-bot verification page).

### Codex / Claude Code (skill form, zero dependencies)

Install (pick one):

```bash
claude plugin install xiehuan123/dsh-deepread      # terminal command (Codex compatible)
/plugin install xiehuan123/dsh-deepread            # or the in-session slash command
npx skills@latest add xiehuan123/dsh-deepread      # or skills.sh
```

**Usage** (Codex / Claude Code):

1. **Trigger**: say something containing "deep-read / analyze / knowledge map / Feynman", e.g.
   - `Deep-read docs/architecture.md`
   - `Analyze this article in knowledge-map mode: <paste text>`
   - `Read this book with the Feynman technique and give me a review plan`
   - `Quickly summarize this WeChat article: https://mp.weixin.qq.com/s/xxxx`
2. **Mode**: the agent picks a mode automatically (default `deep`); it asks when unsure.
3. **Input**: file path / web link (WeChat articles are fetched directly; for anti-bot sites like Zhihu/Juejin, paste the text) / pasted text. PDFs work too (the agent extracts text per `SKILL.md`; scan-only PDFs should be OCR'd first).
4. **Output**: a Markdown report in the conversation by default; say "export html / mindmap / md" and it writes to `deepread-output/` in the workspace (`.md` report, `.mm` FreeMind mindmap [importable by XMind], `.html` web report).
5. **Knowledge-map mode**: output carries four confidence levels (author intent / original facts & data / reasonable inference / unverifiable), and every claim is paired with evidence — the original text lacking evidence is explicitly marked "no evidence provided in the original text".
6. **Feynman mode**: the full 11 steps (TOC → questions → per-chapter → claims/data/evidence → chapter mindmap → explain with the book closed → self-check gaps → correct against the source → merged mindmap → explain again → spaced review on days 1/3/7/14/30).

> Note: the Codex/Claude skill is the "methodology" form — the agent performs the analysis with its own tools; the DSH `deepread` is the "tool" form — the plugin runs the pipeline by calling the model directly. Output formats are identical and interchangeable (an exported `.md`/`.html` keeps working when handed to an agent on either host).

## Examples

```
Please deep-read this link: https://mp.weixin.qq.com/s/xxxx
Read book.pdf in knowledge-map mode and export html
Quickly summarize this article: <paste text>
```

## Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `url` | string | Stable WeChat article link (`mp.weixin.qq.com` only; for anti-bot sites, paste the text) |
| `path` | string | Workspace file path (`.txt/.md/.markdown/.html/.pdf`) |
| `text` | string | Pasted text |
| `depth` | enum | `quick` / `deep` (default) / `map` / `feynman` / `book` |
| `export` | enum | `none` (default, in-session only) / `md` / `mm` / `html` / `all` |
| `refresh` | boolean | `true` forces a re-fetch and cache refresh (default `false`: a cached URL reuses the stored full text without network access) |
| `focus` | string | Reader's angle of interest, e.g. "argumentation logic", "research methodology" |
| `language` | enum | `zh` / `en` / `auto` (default) |

## Repository layout

```
├── package.json            # dsh.bundle + dsh.client + dsh.skills
├── cordis.patch.yml        # inserts itself into the composition
├── index.mjs               # Node half: Cordis entry (deepread tool + PDF/HTML parsing + three export formats)
├── src/client/index.js     # Client source: result card + reading bar + reading panel (factory bundle)
├── scripts/build-client.mjs# bundles client source into the C6 factory artifact lib/client.js (do not edit by hand)
├── lib/client.js           # Client half (generated): __ModuleLoader__.load({ id, factory })
├── test/                   # smoke tests: Node tool pipeline + client factory-bundle contract
├── assets/                 # README and showcase visuals
├── skills/dsh-deepread/    # Codex / Claude Code compatible skill (SKILL.md + references + agents/openai.yaml)
├── plugin.json             # Agent Plugins-compatible root manifest
├── .claude-plugin/         # Claude Code plugin manifests (plugin.json + marketplace.json)
└── .codex-plugin/          # Codex plugin manifest (plugin.json)
```

The `@deepseek-ai/*` host packages (cordis / dsh-tools / schemastery / dsh-storage-domain) plus `zod` and `react`
are provided by the host profile and declared in `peerDependencies` (`*` means "follow the host version");
`dsh.client.inject` declares the client-side dependency edges (dsh-client-runtime provides slots/sessions,
dsh-client-ui-conversation provides conversation).

## Full-text cache

Fetched article full texts are persisted following the official storageDomain convention: the
`deepread_url_cache` domain (version 1, zod-schema validated, records hold `url`/`text`/`fetchedAt`),
stored under `$DSH_HOME/storages/` and surviving process restarts. Re-reading the same article in a
different mode (deep→map/feynman/book) reuses the cache without network access; when a fetch fails the
cache is used as a fallback and the report says so. Default TTL is 7 days with a cap of 200 entries
(expired entries are lazily removed on write). Profiles without storage mounted (e.g. a headless
composition without the web bundle) automatically degrade to an in-process cache.

## Plugin configuration (Config)

`timeoutMs` (default 900000), `chunkChars` (default 6000), `maxParts` (default 20),
`maxInputChars` (default 400000), `cacheEnabled` (default true), `cacheTtlHours` (default 168,
0 disables caching) can all be overridden in the cordis row, for example:

```yaml
- insert:
    - id: deepread
      name: dsh-deepread
      config:
        timeoutMs: 600000
        cacheTtlHours: 24
```

## Development

```sh
npm run build:client   # regenerate lib/client.js from src/client/index.js
npm test               # Node tool pipeline smoke + client factory-bundle contract tests
```

## License

MIT
