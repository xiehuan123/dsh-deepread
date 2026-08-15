# 📖 DeepRead 精读助手（dsh-deepread）

> 精读一本书或一篇文章：提取核心观点、论证结构与关键论据，输出「观点—证据—数据—关系」结构化报告。
> 官方 bundle 插件：Node half 注册 `deepread` 工具，client half 提供结果卡片与输入区精读条。

[![Awesome DSH Plugin](https://beancookie.github.io/awesome-dsh-plugin/badge.svg)](https://beancookie.github.io/awesome-dsh-plugin)
[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

## 功能

| 能力 | 说明 |
| --- | --- |
| 🎛️ 四种模式 | `quick` 快速抓要点 · `deep` 深度精读 · `map` 知识地图 · `book` 整本书分部分精读 |
| 🗺️ 知识地图模式 | 核心问题 / 核心结论 / 十类内容分类（核心结论、分论点、原因或作用机制、事实、数据、案例、隐含前提、反对意见、限制条件、可执行建议）/ 观点必配证据（无证据标注「原文未提供证据」）/ 关键数据表（数值与单位、时间范围、样本、比较基准、来源、位置）/ 八种关系标注（支持、反驳、导致、解释、取决于、举例、对比、限制）/ **四档置信度**（作者原意、原文事实与数据、合理推断、无法确认）/ Mermaid 思维导图 / XMind 大纲 / 5 个主动回忆问题 |
| 📥 三种输入 | 微信公众号链接（`mp.weixin.qq.com` 稳定链接）· 文件（`.txt/.md/.html/.pdf`，PDF 内置纯 JS 提取器，含中文 ToUnicode 映射与页码标记）· 粘贴文本 |
| 📤 可选导出 | 默认只在会话中展示；`export` 参数可选 `md` / `mm`（FreeMind，XMind 可导入）/ `html`（编辑风网页报告，深浅色自适应）/ `all`，写入工作区 `deepread-output/` |
| 🎨 浏览器 UI | `deepread` 工具结果卡片（置信度四色图例、折叠分区）+ 输入区精读条（链接/路径/正文 + 模式/导出选择 + 一键开始） |

## 安装

### DeepSeek Harness（工具 + Web UI，完整功能）

```sh
# git 源安装（构建产物已入库）
dsh plugin --profile web add "github:xiehuan123/dsh-deepread"
```

重启 dsh web 后生效。输入区上方出现「📖 精读」工具条，对话中也可直接说「用知识地图模式精读这篇文章：<内容>」。

### Codex / Claude Code（skill 形态，零依赖）

```bash
# Claude Code / Codex 官方插件方式
claude plugin install xiehuan123/dsh-deepread
# 或会话内：/plugin install xiehuan123/dsh-deepread
# 或 skills.sh
npx skills@latest add xiehuan123/dsh-deepread
```

安装后 Codex/Claude 直接可用：说「用费曼读书法精读这本书」即可触发 `deepread` skill——agent 会用自身的读文件/抓网页能力执行五种模式（知识地图模板与费曼 11 步见 `skills/deepread/references/`）。

## 使用示例

```
请用 deepread 精读这个链接：https://mp.weixin.qq.com/s/xxxx
用知识地图模式精读 book.pdf，导出 html
快速抓一下这篇文章的要点：<粘贴文本>
```

## 参数

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `url` | string | 微信公众号稳定链接（仅 mp.weixin.qq.com；知乎/掘金等反爬站点请粘贴正文） |
| `path` | string | 工作区文件路径（.txt/.md/.markdown/.html/.pdf） |
| `text` | string | 粘贴文本 |
| `depth` | enum | `quick` / `deep`（默认）/ `map` / `feynman` / `book` |
| `export` | enum | `none`（默认，仅会话展示）/ `md` / `mm` / `html` / `all` |
| `focus` | string | 读者关注角度，如「论证逻辑」「研究方法」 |
| `language` | enum | `zh` / `en` / `auto`（默认） |

## 仓库结构

```
├── package.json            # dsh.bundle + dsh.client + dsh.skills
├── cordis.patch.yml        # insert 挂载自身
├── index.mjs               # Node half：Cordis entry（deepread 工具 + PDF/HTML 解析 + 三格式导出）
├── lib/client.js           # Client half：__ModuleLoader__ 注册（结果卡片 + 输入区精读条）
├── skills/deepread/        # Codex / Claude Code 兼容 skill（SKILL.md + references）
└── .claude-plugin/         # Claude Code / Codex 插件清单（plugin.json + marketplace.json）
```

依赖 `@deepseek-ai/*` 官方包由 profile pnpm 闭包注入，不在 package.json 声明。

## License

MIT
