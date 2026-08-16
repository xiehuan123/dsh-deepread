# Example outputs / 示例输出

These are real DeepRead reports generated from three public articles. They show the exact report structure produced by the project rather than hand-written mockups.

以下是 DeepRead 从三篇公开文章生成的真实报告，用于展示各模式的实际输出结构，并非手写占位内容。

| File | Source | Mode | What it demonstrates |
| --- | --- | --- | --- |
| [claude-code-token-optimization.md](./claude-code-token-optimization.md) | Claude Code 省 Token 的工程链路 | `deep` 深度精读 | 摘要 / 核心论点 / 论证结构（含论据）/ 论证脉络 / 核心概念 / 金句 / 批判性思考 |
| [ad-fact-check-knowledge-map.md](./ad-fact-check-knowledge-map.md) | 「90% 传统开发人阵痛转型」一文 | `map` 知识地图 | 核心问题 / 核心结论 / 十类内容分类 / **四档置信度** / 关键数据表（五要素）/ 关系标注 / Mermaid 导图 / XMind 大纲 / 5 个主动回忆问题 |
| [vivo-tauri-architecture.md](./vivo-tauri-architecture.md) | vivo 大头贴 Tauri 2.0 桌面应用实践 | `deep` 深度精读 | 选型数据、8 大模块论证、金句与批判性思考 |

## Reproduce / 如何复现

**DSH tool form / DSH 工具形态**:

```
请用 deep 模式精读这个链接：https://mp.weixin.qq.com/s/IYIkYcxHgUYWe8VvNd1lnA
用知识地图模式精读：https://mp.weixin.qq.com/s/ziZz2hE634g7Z7wgfHxhwQ
```

**Codex / Claude Code skill form / Skill 形态**: ask `Analyze this article in knowledge-map mode` and provide the URL or source text.

> 三份样例均为当时抓取的原文分析结果；文章链接为微信公众号稳定链接（`mp.weixin.qq.com/s/<id>` 格式，无 tempkey）。如链接失效，把正文粘贴给任一形态的 DeepRead 即可得到同格式报告。
