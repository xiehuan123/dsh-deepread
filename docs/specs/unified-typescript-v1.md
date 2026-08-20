# dsh-deepread 1.0 统一 TypeScript 升级规格

状态：Approved（2026-08-18，允许按工单进入开发）  
目标版本：`1.0.0`  
基线版本：`0.5.4`  
目标宿主：DeepSeek Harness `0.1.0-rc.7`、dsh-TUI `0.8.1` / Community Consensus `v0.15`

## 1. 背景

当前 `dsh-deepread` 是 JavaScript 双半插件：Node 入口提供 `deepread` 工具，Web 浏览器入口提供结果卡片和阅读面板。现状存在三类问题：

1. `webServer` 被声明为硬依赖，使没有 Web 服务的 TUI/headless 组合无法激活 Node 工具；
2. 源码和构建形态未对齐 dsh-TUI 当前的 TypeScript ESM 与 Community Consensus v0.15 插件契约；
3. Web 面板缺少再次点击隐藏、拖动和可靠的宿主主题适配，对应 issue #1、#2。

本升级属于公开入口、构建产物和宿主兼容面的系统性变更，因此采用主版本 `1.0.0`，并以本规格作为实现和验收真源。

## 2. 目标

### 2.1 必须实现

- 一个 npm 包、一套 TypeScript 源码，同时支持：
  - DeepSeek Harness Web：Node 工具 + Web 结果卡片/阅读面板；
  - DeepSeek Harness headless：Node 工具，不要求 Web 服务；
  - dsh-TUI：Node 工具 + 打包 skill，不要求或加载浏览器 UI。
- 包根是 TypeScript ESM Cordis 插件，构建到 `lib/types/index.js` 与声明文件。
- 提供符合 dsh-TUI Community Consensus v0.15 的 `dsh-plugin.json`，只声明 `facets.host`。
- `webServer`、`storageDomain`、`jobs` 等非核心能力按可选接缝探测，缺失时静默降级。
- 完成 issue #1：按钮开关、面板拖动、视口边界约束。
- 完成 issue #2：跟随宿主主题并改善浅色/深色模式对比度。
- 升级后读取并继续使用 `0.5.4` 已有的浏览历史、全文缓存和校准数据。

### 2.2 明确不做

- 不把正式 npm 插件改成 DeepSeek Harness 的进程内动态 Cordis package；动态 package 不跨重启，也不是正式插件发布机制。
- 不在 v0.15 manifest 中声明 `client` 或 `worker` facet；dsh-TUI v0.15 会拒绝这些 facet。
- 不为 dsh-TUI 新做全屏 scene 或 Web 面板的终端复刻；TUI 通过模型工具结果消费精读内容。
- 不在本版本中把 Web `localStorage` 历史迁移到 dsh-TUI `storage.local`，也不实现 Web/TUI 跨宿主同步历史。
- 不添加插件自己的手动明暗主题开关；主题权威属于宿主。
- 不持久化面板拖动坐标；刷新后回到默认位置。

## 3. 宿主兼容矩阵

| 宿主 | Node `deepread` 工具 | 浏览器面板 | 打包 skill | 预期降级 |
| --- | --- | --- | --- | --- |
| DeepSeek Harness Web `rc.7` | 必须 | 必须 | 必须 | 无 |
| DeepSeek Harness headless `rc.7` | 必须 | 不适用 | 必须 | 不注册预算 HTTP route |
| dsh-TUI `0.8.1` / v0.15 | 必须 | 不加载 | 必须 | 无 Web route、无浏览器 UI |
| 缺少 `storageDomain` 的自定义组合 | 必须 | 按 Web 能力决定 | 必须 | URL 缓存和校准退化为进程内状态 |

不支持 Node 22.19 以下版本。包的 `engines.node` 改为 `^22.19 || >=24`，与当前 dsh-TUI 插件规范一致。

## 4. 包与入口契约

### 4.1 Host 入口

- 源码：`src/index.ts`（可拆分内部模块，但包根只暴露稳定公共面）。
- 构建产物：`lib/types/index.js`、`lib/types/index.d.ts`。
- 包根导出：
  - `name = 'deepread'`
  - `type Config`
  - `Config` Schemastery schema
  - `apply(ctx, config)`
- `package.json.main`、`types` 与 `exports["."]` 必须指向上述产物。
- TypeScript 相对 import 使用 `.js` 后缀。
- 由 `tsc` 生成 Host 产物；发布包必须包含源码、声明和运行时代码。

### 4.2 dsh-TUI v0.15 manifest

根目录新增 `dsh-plugin.json`，满足以下不变量：

- `manifestVersion: "0.15"`；
- 稳定 id：`io.github.xiehuan123.dsh-deepread`；
- `facets.host.entry: "lib/types/index.js"`；
- `facets.host.apiVersion: "v1alpha1"`；
- 不出现 `facets.client`、`facets.worker`、`provides` 或 `services`；
- 只声明代码实际消费的 v0.15 contracts、permissions、subscriptions；本版本未消费 TUI 私有契约时保持空数组；
- `package.json.files` 必须包含 manifest。

`dsh-plugin.json` 用于 dsh-TUI 的准入和诊断，不替代 DeepSeek Harness Loader 的 `dsh.bundle.patch`。

### 4.3 Web client 入口

- 源码改为 TypeScript：`src/client/index.ts`（若引入 JSX 则使用 `.tsx`）。
- 产物继续由 `exports["./client"]` 暴露为 `lib/client.js`。
- 使用 DeepSeek Harness 当前官方 Web client module 加载契约和构建语义；不把该产物当作 dsh-TUI v0.15 client facet。
- Web client 的加载失败不得阻止 Host 工具在 TUI/headless 激活。
- 生成产物不可手改，源码和构建命令是唯一真源。

## 5. 服务依赖与降级

### 5.1 核心能力

工具执行所需的 Host 服务必须在激活时可用。实现应保留现有明确依赖，但不得把仅供 Web 展示或优化的服务设为硬依赖。

### 5.2 可选能力

| 服务 | 存在时 | 缺失时 |
| --- | --- | --- |
| `webServer` | 注册 `POST /api/deepread/budget` | 不注册 route；Host 工具照常可用 |
| `storageDomain` | 持久化全文缓存和模型速度校准 | 使用进程内缓存/校准 |
| `jobs` | 按现有策略报告后台进度 | 同步/普通工具执行，不因缺失失败 |

所有可选服务均在使用点探测，不进入会导致插件 pending 的硬依赖列表。卸载时通过 Cordis effect 释放 route、tool、domain handle 和浏览器 slot。

## 6. 历史数据兼容契约

升级不得重命名、升版、清空或隐式迁移以下标识：

| 数据 | 位置/标识 | 兼容要求 |
| --- | --- | --- |
| Web 最近读过 | `localStorage['dsh-deepread-history-v1']` | 新版本原样读取；保留最多 20 条的现有语义 |
| Web 预算校准 | `localStorage['dsh-deepread-calib']` | 新版本原样读取 |
| URL 全文缓存 | storage domain `deepread_url_cache`, version `1`, table `articles` | 保持 key 和 `{url,text,fetchedAt}` 记录结构 |
| Host 速度校准 | storage domain `deepread_stats`, version `1`, table `stats`, key `default` | 保持现有数值和时间字段 |

### 6.1 必须通过的迁移测试

1. 使用 `0.5.4` 格式的 localStorage fixture 启动新 client，历史记录仍可见并可再次精读；
2. 使用 `0.5.4` 格式的 `deepread_url_cache` fixture 启动新 Host，第一次调用即命中缓存且不联网；
3. 使用 `0.5.4` 格式的 `deepread_stats` fixture 启动新 Host，估算采用旧校准值；
4. 新版本写出的上述 v1 数据仍能被 `0.5.4` 读取，保证紧急降级可行。

### 6.2 用户环境导致的“看似丢失”

- Web 历史属于浏览器 origin；协议、域名或端口改变会切换 localStorage 命名空间，旧数据仍留在旧 origin。
- Host 缓存属于 `DSH_HOME`；更换 `DSH_HOME` 会看到另一份存储目录。
- 浏览器清理站点数据会删除 localStorage；这不属于插件升级迁移。

## 7. Issue #1 交互规格

### 7.1 开关

- 阅读按钮在关闭状态点击后打开面板；在打开状态再次点击后关闭面板。
- 面板右上角关闭按钮与再次点击阅读按钮产生相同结果。
- 重复快速点击不得产生多个面板实例或残留 slot。

### 7.2 拖动

- 仅面板标题栏的非交互区域可发起拖动；关闭按钮、输入框和内容区不得发起拖动。
- 使用 Pointer Events，同时支持鼠标、触控笔和触屏。
- 拖动期间捕获 pointer；结束或取消时释放并清理监听器。
- 面板始终至少完整保留标题栏并约束在当前视口内。
- 浏览器 resize 后重新约束位置。
- 关闭再打开可保留本次页面生命周期内的位置；刷新后不保证保留。
- 尊重文本选择和按钮点击，不以全局 `preventDefault` 破坏正常交互。

架构决策：对 Harness rc.7 的源码审计确认，`shell.overlay` 只提供挂载与生命周期，当前没有公共 draggable/floating-panel API。因此拖动限定在插件面板组件内，位置由 `apply` 作用域的临时状态持有；未来宿主提供公共能力时再替换。

## 8. Issue #2 主题与对比度规格

- 所有文字、背景、边框、焦点、按钮、标签和状态色使用 DeepSeek Harness 提供的语义 token。
- 不通过插件自己的 `prefers-color-scheme` 决定主题；宿主切换主题后组件自动跟随。
- 禁止用于主题表达的硬编码白色、黑色、半透明背景和置信度红黄绿色；仅非主题装饰在有明确理由时允许字面量。
- 输入框、placeholder、禁用态、hover、focus-visible、历史条目、置信度标签在宿主 light/dark 主题下均清晰可辨。
- 可操作元素必须具有键盘可见焦点；仅靠颜色表达的置信度必须同时保留文字标签。
- 自动化测试锁定语义 token 使用和禁止色值；真实 Web smoke 在两套宿主主题下截图/人工检查关键区域。

## 9. TypeScript 迁移约束

- 所有手写运行时代码改为 `.ts`/`.tsx`；生成的 `.js` 除外。
- 不允许以 `// @ts-nocheck` 作为最终状态。
- `strict` 开启；必要时在内部边界使用 `unknown` + narrowing，不用大面积 `any`。
- Host 与 browser 使用各自 tsconfig/compiler face，browser 代码不得导入 Node-only 模块。
- 对外 `Config`、工具参数/结果、持久化记录、浏览器 store 和 slot props 建立显式类型。
- 迁移过程允许分模块，但不得改变 `deepread` 工具名、现有参数默认值或输出数据结构，除非本规格另有规定。

## 10. 测试与发布门禁

以下门禁全部通过后才能合并、发布或关闭 issue：

1. TypeScript clean build，零类型错误；
2. 现有 Host 功能、PDF、缓存、校准、后台进度测试全部通过；
3. 新增无 `webServer` 激活测试；
4. 新增 v0.15 manifest 结构与 dsh-TUI admission 校验；
5. 新增旧数据双向兼容测试；
6. 新增 issue #1 的开关、拖动、pointer cancel、resize 边界测试；
7. 新增 issue #2 的 token/禁用硬编码色值测试；
8. Web client 产物可被真实 module loader 加载并完成 slot 注册/卸载；
9. `npm pack --dry-run` 验证入口、manifest、skill、声明和生成产物齐全；
10. 在本地 DeepSeek Harness Web 启动并完成一次 URL 精读；
11. 在最新版 dsh-TUI profile 启动并完成一次同样的 `deepread` 工具调用；
12. Standards 与 Spec 两条独立代码审查均无阻塞问题。

issue #1、#2 只在包含 `Closes #1` / `Closes #2` 的 PR 合并后关闭，不以“代码已写”代替完成。

## 11. 发布与回滚

### 11.1 发布前

- 保留并标记最后稳定版本 `0.5.4`；
- 发布说明明确 Node engine 提升、入口改为 `lib/types`、v0.15 manifest、三宿主支持和数据不迁移；
- 对 `$DSH_HOME/storages` 只读验证，不执行清理或改名；
- 先发 npm prerelease `1.0.0-rc.1`，完成 Web/TUI 双宿主 smoke 后再发布 `1.0.0`。

### 11.2 回滚

- 运行失败时重新安装 `dsh-deepread@0.5.4` 并恢复原 profile 引用；
- 因持久化域和 localStorage key 未改变，回滚不需要数据转换；
- 若 Web origin 改变，回滚后使用原 origin 即可看到旧历史。

## 12. 可追踪验收表

| 需求 | 主要证据 |
| --- | --- |
| 单包兼容 Web/TUI/headless | 三宿主 smoke + 可选 `webServer` 测试 |
| dsh-TUI v0.15 | manifest admission 校验 + 无 client/worker facet |
| TypeScript | strict build + 发布包仅含手写 TS 和生成 JS |
| 历史数据不受影响 | 四组旧 fixture 兼容测试 + 回滚读取测试 |
| issue #1 | 交互测试 + Web smoke |
| issue #2 | token 静态门禁 + light/dark Web smoke |
| 可发布 | pack 校验 + 双轴代码审查 + prerelease 验证 |

## 13. 实现前确认项

本规格默认采用以下产品决策：

1. 版本号升为 `1.0.0`，先发布 `1.0.0-rc.1`；
2. TUI 首版只提供 Host 工具与 skill，不新增原生 scene；
3. Web/TUI 历史暂不跨宿主同步；
4. 面板位置不跨刷新持久化；
5. v0.15 manifest 只声明 Host facet，不声明当前未消费的 TUI contracts。

这些决策确认后，实施必须逐条回填本规格中的测试证据；任何改变持久化标识、公开工具 schema 或宿主矩阵的实现，都必须先修改并重新确认本规格。
