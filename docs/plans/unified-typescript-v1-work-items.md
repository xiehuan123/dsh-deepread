# dsh-deepread 1.0 实施工单

规格真源：[`../specs/unified-typescript-v1.md`](../specs/unified-typescript-v1.md)  
状态：Ready  
目标发布：`1.0.0-rc.1` → `1.0.0`

## 执行规则

- 按依赖顺序领取；前置工单未通过验收时，不开始依赖它的工单。
- 每个行为变更先写从公开接缝观察的失败测试，再写实现。
- 每个工单只修改列出的范围；发现规格缺口时先修订规格，不在代码里临时决定。
- `lib/` 是生成产物，只能通过构建命令更新。
- 不改变四个历史数据标识、`deepread` 工具名、现有工具参数默认值和结果结构。
- issue #1、#2 在最终 PR 合并前保持开放。

## 依赖图

```text
DR-100 基线与旧数据夹具
  ├─ DR-110 TypeScript Host 构建契约
  │    ├─ DR-120 Host 严格类型迁移
  │    │    ├─ DR-130 可选服务与 TUI/headless 激活
  │    │    └─ DR-140 v0.15 manifest 与发布包
  │    └─ DR-150 旧数据双向兼容
  └─ DR-160 Web client TypeScript 构建
       ├─ DR-170 面板开关（issue #1）
       ├─ DR-180 面板拖动（issue #1）
       └─ DR-190 主题与对比度（issue #2）

DR-130 + DR-140 + DR-150 + DR-170 + DR-180 + DR-190
  └─ DR-200 文档、版本与升级说明
       └─ DR-210 双宿主验收与预发布
            └─ DR-220 最终审查、PR 与关闭 issues
```

## DR-100：冻结 0.5.4 基线与兼容夹具

类型：测试基础设施  
优先级：P0  
前置：无

### 目标

在重构前固定当前公开行为和旧数据格式，使后续迁移可以证明“行为未变、数据可读”。

### 范围

- 记录 `0.5.4` 的工具 schema、默认配置和关键结果样例；
- 增加以下只读 fixture：
  - `dsh-deepread-history-v1`；
  - `dsh-deepread-calib`；
  - `deepread_url_cache` domain v1；
  - `deepread_stats` domain v1；
- 增加测试帮助函数，允许同一测试分别加载旧入口和新入口；
- 保存当前 `npm pack --dry-run` 文件清单作为迁移对照。

### 不做

- 不修改运行时代码；
- 不生成或改写用户真实存储。

### 验收

- 当前 `0.5.4` 在新增基线测试下全部通过；
- fixture 不包含真实用户数据、密钥或本机绝对路径；
- 测试明确断言四个持久化标识及其 version/table/key。

### 证据

- `npm test`；
- 基线快照/fixture diff。

## DR-110：建立 TypeScript Host 构建与包入口

类型：构建/打包  
优先级：P0  
前置：DR-100

### 目标

先建立可验证的 TypeScript ESM 发布骨架，不在本工单改变业务行为。

### 范围

- 新增严格模式 Host tsconfig；
- 将包根源码入口定位为 `src/index.ts`；
- 由 `tsc` 输出 `lib/types/index.js` 和 `lib/types/index.d.ts`；
- 更新 `main`、`types`、`exports["."]`、`files` 和 build/prepack scripts；
- Node engine 改为 `^22.19 || >=24`；
- 测试从发布入口导入插件，而不是复制仓库根 JavaScript 文件。

### 不做

- 不迁移全部业务实现；
- 不改 Web client；
- 不添加 v0.15 manifest。

### 验收

- `npm run build:host` 可从干净目录生成 JS 和声明；
- 发布入口只能导入预期公共面；
- `npm pack --dry-run` 不再依赖根目录 `index.mjs`；
- 无 `@ts-nocheck`、无大面积 `any` 逃逸。

### 证据

- Host build 测试；
- package exports 测试；
- TypeScript 类型检查。

## DR-120：迁移 Host 核心到严格 TypeScript

类型：重构  
优先级：P0  
前置：DR-110

### 目标

把现有 Node 工具实现完整迁移到严格 TypeScript，同时保持工具的公开行为。

### 范围

- 为 Config、输入、输出、阶段元数据、PDF 统计、缓存记录和校准记录建模；
- 将抓取、PDF、LLM JSON 解析、导出、预算估算拆成内部模块；
- 所有外部输入以 `unknown` 进入并经过 narrowing；
- 保持 `name = 'deepread'`、配置默认值、工具参数 schema 和结果结构；
- 保持现有 error/cancellation 语义。

### 建议子批次

1. 公共类型与配置；
2. 来源读取与缓存；
3. PDF/HTML/TXT 解析；
4. LLM 调用、校准与预算；
5. 五种模式和三种导出；
6. 工具注册和生命周期。

每个子批次必须保持测试绿色，不做一次性整文件替换后再补测试。

### 验收

- `strict` 类型检查零错误；
- 手写 Host 运行时代码全部为 `.ts`；
- 现有 Host 测试结果与 DR-100 基线一致；
- 不存在 `@ts-ignore`/`@ts-nocheck`，局部 `any` 必须有边界说明并经审查。

### 证据

- 全部 Host 单元/集成测试；
- 类型检查报告；
- 基线差异报告。

## DR-130：可选 Web 服务与 TUI/headless 激活

类型：兼容性  
优先级：P0  
前置：DR-120

### 目标

让同一 Host 插件在没有 `webServer` 的 dsh-TUI/headless 组合中正常激活。

### 范围

- 从硬依赖中移除 `webServer`；
- 在使用点软探测 `webServer`、`storageDomain`、`jobs`；
- 有 `webServer` 时注册预算 route，卸载时释放；
- 无 `webServer` 时仍注册 `deepread` 工具；
- 无 storage/jobs 时执行规格定义的降级路径。

### 验收

- 无 `webServer`：工具注册且可完成 pasted-text 精读；
- 有 `webServer`：`POST /api/deepread/budget` 注册且返回原结构；
- 服务晚到/卸载场景不泄漏旧 route、tool 或 domain handle；
- Web 专属失败不阻止 TUI/headless Host 激活。

### 证据

- 可选服务矩阵测试；
- lifecycle dispose 测试；
- headless smoke。

## DR-140：dsh-TUI v0.15 manifest 与发布包准入

类型：互操作/打包  
优先级：P0  
前置：DR-120

### 目标

提供诚实、可校验的 Community Consensus v0.15 Host manifest。

### 范围

- 新增根目录 `dsh-plugin.json`；
- 稳定 id：`io.github.xiehuan123.dsh-deepread`；
- Host entry 指向 `lib/types/index.js`，facet API 为 `v1alpha1`；
- contracts、permissions、contributes、subscriptions 只声明实际消费内容；
- package files 包含 manifest、patch、skill、声明和运行时产物；
- 用最新版 dsh-TUI admission validator 校验。

### 验收

- manifest 可解析并协商为 `compatible`；
- 不包含 client/worker facet、provides 或 services；
- manifest version、包版本和发布说明一致；
- `dsh plugin --profile dsh-tui add` 能从打包产物安装。

### 证据

- v0.15 admission 测试；
- `npm pack --dry-run` 文件清单；
- dsh-TUI `/plugins` 诊断输出。

## DR-150：0.5.4 历史数据双向兼容

类型：数据兼容  
优先级：P0  
前置：DR-100、DR-120

### 目标

证明 1.0 可以读取旧数据，并且紧急回滚到 0.5.4 时仍可读取 1.0 写出的 v1 数据。

### 范围

- 新 Host 读取旧 URL cache fixture；
- 新 Host 读取旧 stats fixture；
- 新 Web client 读取旧 history/calibration fixture；
- 1.0 写入后，用 0.5.4 reader 验证可读；
- 对损坏数据保持现有安全降级，不覆盖原始字节。

### 验收

- 四个数据面全部完成 old → new；
- domain v1 数据完成 new → old；
- 测试断言不会删除、重命名或自动升版；
- 任何格式变更必须阻止合并并先修订规格。

### 证据

- migration compatibility test suite；
- 数据标识静态门禁。

## DR-160：Web client 迁移到 TypeScript 官方模块构建

类型：Web 构建/重构  
优先级：P0  
前置：DR-100、DR-110

### 目标

把浏览器源码迁移为 TypeScript，并继续产出 DeepSeek Harness Web 当前 loader 可加载的 client module。

### 范围

- `src/client/index.js` 迁移为 `.ts`/`.tsx`；
- 为 slot props、结果记录、历史记录、预算结果和面板 store 建模；
- 使用当前 Harness 官方 Web client module 构建语义生成 `lib/client.js`；
- 保持 `exports["./client"]` 和 `dsh.client` 入口；
- browser face 不导入 Node-only 模块；
- slot 注册和卸载保持对称。

### 验收

- browser strict typecheck 零错误；
- 真实 loader 能加载产物并注册三个现有 slot；
- dispose 后无残留 slot、store listener 或 style；
- dsh-TUI v0.15 manifest 完全不声明该 browser entry。

### 证据

- client loader contract 测试；
- slot lifecycle 测试；
- browser dependency boundary 检查。

## DR-170：阅读按钮再次点击隐藏

类型：功能  
优先级：P1  
关联：issue #1  
前置：DR-160

### 目标

把阅读按钮改为稳定的开关，并统一按钮关闭与面板关闭按钮行为。

### 范围

- 关闭时点击打开；打开时点击关闭；
- 关闭按钮调用同一状态动作；
- 处理快速重复点击与 remount；
- 添加 `aria-expanded`/可访问名称等状态信息。

### 验收

- open → close → open 状态序列可从真实按钮观察；
- 页面中始终最多一个面板；
- remount/unload 后无旧 listener；
- 键盘激活与鼠标点击结果一致。

### 证据

- 组件交互测试；
- Web smoke。

## DR-180：面板 Pointer Events 拖动与视口约束

类型：功能  
优先级：P1  
关联：issue #1  
前置：DR-160、DR-170

### 目标

允许从标题栏拖动面板，并在所有结束路径保持安全边界和清洁生命周期。

### 范围

- header drag handle；
- pointer capture、move、up、cancel；
- close/input/content 不触发拖动；
- 视口 clamp 和 resize 后重新 clamp；
- 页面生命周期内保留位置，刷新不持久化；
- 拖动中提供合适 cursor/selection 行为。

### 验收

- mouse/touch/pen 的 pointer 流程均走同一实现；
- pointer cancel 后不再移动；
- 任意方向拖出视口均被约束；
- resize 缩小时标题栏仍可见；
- 关闭按钮点击不产生位置变化；
- dispose 后无 window listener。

### 证据

- pointer sequence 测试；
- resize/clamp 测试；
- 真实浏览器拖动 smoke。

## DR-190：宿主主题与对比度修复

类型：可访问性/视觉  
优先级：P1  
关联：issue #2  
前置：DR-160

### 目标

让面板完全跟随 Harness 宿主主题，并修复浅色/深色模式的低对比度区域。

### 范围

- 将背景、文字、边框、按钮、焦点、placeholder、历史条目、tag、置信度状态迁移到宿主语义 token；
- 删除插件主题用硬编码白/黑/rgba/红黄绿色；
- 增加 hover、disabled、focus-visible 状态；
- 保留置信度文字，不只依赖颜色；
- 禁止插件自己的 `prefers-color-scheme`。

### 验收

- 静态门禁找不到禁止色值和媒体主题分支；
- 宿主切换 light/dark 后无需 remount 即更新；
- 所有交互控件有键盘可见焦点；
- light/dark 截图中的输入框、按钮、历史和状态标签清晰可辨。

### 证据

- token contract 测试；
- light/dark 截图；
- 键盘导航 smoke。

## DR-200：版本、文档与升级/回滚说明

类型：文档/发布  
优先级：P1  
前置：DR-130、DR-140、DR-150、DR-170、DR-180、DR-190

### 目标

让安装者、维护者和社区收录方准确理解 1.0 的兼容范围和升级风险。

### 范围

- 版本改为 `1.0.0-rc.1`；
- 更新中英文 README 的入口、Node 要求、宿主矩阵和构建命令；
- 记录 dsh-TUI 最低版本、v0.15 manifest、Web client 可选性；
- 写升级、数据保留、origin/DSH_HOME 注意事项和 0.5.4 回滚步骤；
- 更新 AGENTS 与 Harness 集成知识文档；
- 准备 release notes 和社区收录链接更新说明。

### 验收

- 文档不再把整个插件称为旧构建协议；
- 所有路径、命令和包入口与实际产物一致；
- 明确“发布新版本不会删除历史数据”的条件与例外；
- README 明示 dsh-TUI 最低兼容版本。

### 证据

- 文档链接检查；
- pack 文件清单与 README 对照；
- release notes 审查。

## DR-210：双宿主验收与 1.0.0-rc.1 预发布门禁

类型：集成/发布  
优先级：P0  
前置：DR-200

### 目标

在真实 DeepSeek Harness Web、headless 与 dsh-TUI 中证明同一个 tarball 可用。

### 范围

- 从干净工作区构建并 `npm pack`；
- 只安装该 tarball，不引用源码路径；
- Harness Web：URL 精读、预算 route、面板开关、拖动、light/dark；
- Harness headless：无 webServer 激活并完成 pasted-text 精读；
- dsh-TUI：安装、`/plugins` 诊断、skill 发现、工具调用；
- 使用旧数据 fixture/副本完成升级 smoke；
- 验证回装 `0.5.4` 的读取路径。

### 验收

- 三宿主全部通过；
- 无启动警告、pending 插件、未知事件或未释放资源；
- pack 内容完整且不携带测试临时文件；
- 失败时不发布、不关闭 issue，并记录复现证据。

### 证据

- 命令输出和版本信息；
- Web light/dark 截图；
- dsh-TUI 真实 TTY 验收记录；
- tarball 文件清单与校验值。

## DR-220：最终双轴审查、PR 和 issue 关闭

类型：交付  
优先级：P0  
前置：DR-210

### 目标

把全部实现作为可审查、可回滚的变更交付，并在合并后关闭两个 issue。

### 范围

- Standards review：仓库规范、类型质量、生命周期、安全、打包；
- Spec review：逐条核对本规格和 DR 工单；
- 修复所有阻塞问题并重跑完整门禁；
- 提交、推送并创建 PR；
- PR 正文包含 `Closes #1` 与 `Closes #2`；
- 合并后确认两个 issue 状态为 closed；
- 只在授权与 token 可用时执行 `1.0.0-rc.1` 发布。

### 验收

- 两条审查均无阻塞问题；
- CI、pack、三宿主验收全部绿色；
- PR 已合并；
- #1、#2 已关闭且能追踪到合并 PR；
- release/tag/npm 发布状态与实际授权范围一致，不虚报成功。

### 证据

- review 报告；
- PR/merge URL；
- issue 状态；
- 若发布：tag、npm dist-tag 与安装 smoke。

## 建议提交边界

1. `test: freeze 0.5.4 compatibility baseline`（DR-100）
2. `build: add strict TypeScript host pipeline`（DR-110）
3. `refactor: migrate deepread host to TypeScript`（DR-120）
4. `fix: activate without web services`（DR-130）
5. `feat: add dsh-TUI v0.15 host manifest`（DR-140）
6. `test: guarantee legacy data compatibility`（DR-150）
7. `refactor: migrate web client to TypeScript`（DR-160）
8. `fix: toggle and drag the reading panel`（DR-170、DR-180，关闭 #1 的实现）
9. `fix: follow host theme tokens`（DR-190，关闭 #2 的实现）
10. `docs: prepare the 1.0 compatibility release`（DR-200）
11. `test: verify the release tarball across hosts`（DR-210）

提交信息不直接写 `Closes`；关闭关键词只放最终 PR，避免未合并提交提前形成误导关联。
