# DeepSeek Harness 插件集成参考

本文记录 `dsh-deepread` 与 DeepSeek Harness 的真实连接方式，供维护、排障和评审使用。它描述的是宿主集成，不重复精读业务逻辑。

## 已核对基线

- 上游仓库：`deepseek-ai/deepseek-harness`
- 本地上游路径：`/Users/xiehuan/Desktop/project/deepseek-harness`
- 核对版本：`0.1.0-rc.7`
- 核对提交：`99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`（2026-08-17）
- 本插件提交基线：`cbfffab353112180456a6c26ed83de092d54ac12`
- 核对日期：2026-08-18

上游仍处于预发布阶段。修改宿主接口相关代码前，应先在本地上游重新核对文档和源码，而不是把本文当成永久不变的 API 规范。

当前发布兼容基线还包括 dsh-TUI `0.8.1` / Community Consensus v0.15。包要求 Node.js `^22.19 || >=24`；同一个 tarball 在 Harness Web、Harness headless 与 dsh-TUI 中共享 Host 工具和 skill，浏览器 UI 只是 Harness Web 的可选入口。

## 一张图理解装载链路

```text
dsh plugin --profile web add <包>
  -> pnpm 把包写入 profile dependencies
  -> CLI 发现 package.json 的 dsh.bundle.patch
  -> 包名加入 profile 的 dsh.profile.bundles
  -> 启动时合并 cordis.patch.yml
  -> 加载 lib/types/index.js，执行 apply(ctx, config)
  -> 严格 TypeScript Host 模块注册工具、缓存、预算路由与生命周期资源
  -> 始终注册 deepread 工具；有 webServer 时注册 /api/deepread/budget

dsh web
  -> ClientModuleRegistry 扫描已激活包的 dsh.client
  -> 解析 exports["./client"] 为 lib/client.js
  -> 注入 window.__DSH_BOOT__ 客户端图
  -> 浏览器请求 /plugins/dsh-deepread/client.js?rev=<hash>
  -> bundle 调用 window.__ModuleLoader__.load({ id, factory })
  -> Cordis 执行浏览器 apply(ctx)
  -> 向三个宿主 slot 注册结果卡、入口按钮和浮层面板

dsh-TUI 0.8.1+
  -> 读取 Host-only dsh-plugin.json（manifestVersion 0.15）
  -> 从 lib/types/index.js 加载 deepread Host 工具
  -> 发现打包 skill；不读取 Harness Web client
```

profile 是安装与激活范围，不是插件源码目录。删除缓存不能代替 `dsh plugin --profile <name> remove dsh-deepread`。

## 三个身份不要混用

| 身份 | 当前值 | 用途 |
| --- | --- | --- |
| npm 包名 | `dsh-deepread` | profile 依赖、bundle 名、客户端图 id、卸载参数 |
| Cordis 插件名 | `deepread` | `lib/types/index.js` 导出的稳定运行时名称 |
| patch 行 id | `deepread` | `cordis.patch.yml` 中配置和覆盖这一实例的目标 |
| 工具名 | `deepread` | 模型调用、`tool.call.toolview` 的 keyed 分发键 |
| 客户端 bundle id | `dsh-deepread` | 必须匹配宿主客户端图中的包 id |

修改其中任意一个都要沿完整链路核对，不能只做字符串替换。

## 包清单如何连接宿主

[`package.json`](../package.json) 同时声明四类信息：

1. `dsh.bundle.patch` 指向 [`cordis.patch.yml`](../cordis.patch.yml)，使安装成功的依赖成为 profile patch 层。
2. `main`、`types` 与 `exports["."]` 指向 `lib/types/index.js` 及其声明，供 Cordis 和 Node ESM 消费者加载 Node half。
3. `dsh.client` 标记这是 Web 客户端包；`exports["./client"]` 指向生成的 [`lib/client.js`](../lib/client.js)。
4. `dsh.skills` 把共享 [`SKILL.md`](../skills/dsh-deepread/SKILL.md) 暴露给 Harness 的技能发现机制。
5. [`dsh-plugin.json`](../dsh-plugin.json) 是 dsh-TUI Community Consensus v0.15 的 Host-only 准入清单，Host entry 同样指向 `lib/types/index.js`；它不替代 Harness 的 bundle patch。

`files` 决定发布包实际包含什么。新增运行时文件、参考资料或生成产物后，必须同步检查它是否进入发布包。

### profile 层优先级

Harness 依次应用：

1. `dsh.profile.bundles` 中各 bundle 的 patch；
2. profile 自身的 `cordis.patch.yml`；
3. `$DSH_HOME/cordis.patch.yml`；
4. 命令行 `--patch` 覆盖层。

越后的层优先。patch 命中一行时会替换该行的整个 `config`，不是深度合并，所以用户覆盖配置时必须写全希望保留的字段。

## Node half

[`src/index.ts`](../src/index.ts) 是严格 TypeScript 公共入口，由 `tsc` 构建为 `lib/types/index.js` 和声明文件。Host 运行时按配置、缓存、来源解析、PDF、LLM、分析与导出边界拆分在 `src/host/`；生成的同构模块位于 `lib/types/host/`。发布包不包含或依赖 legacy Host JavaScript。

当前 Host 实现负责：

- 声明 `Config`；
- 注册 `deepread` 工具及其输入、运行中展示和结果渲染；
- 通过 `fs`、`llm`、`web`、`storageDomain`、`jobs` 等宿主能力完成读取、模型调用、缓存与后台任务；
- 在可选 `webServer` 出现时注册 `POST /api/deepread/budget`；
- 在插件释放时关闭已打开的 storage domain。

### Node `inject` 与可选服务

公共 Host 入口转发的 `inject` 是 Cordis 激活条件。当前硬依赖仅为工具执行所需的 `fs`、`llm`、`tools`、`web`、`agentDefaultModel` 与 `sandboxPolicy`。`webServer` 是可选服务：实现通过 `ctx.inject(['webServer'], ...)` 在服务可用期间注册并释放预算 route；stock `headless` 不提供它时，Host 工具仍然激活。

`storageDomain` 与 `jobs` 同样在使用点探测。前者缺失时 URL 缓存与速度校准退化为进程内状态；后者缺失或启动失败时长任务回到前台执行。不要把这三项重新加入硬依赖列表，否则会破坏 Harness headless 和 dsh-TUI 的 Host-only 激活。

### 生命周期要求

注册工具、路由、监听器、定时器和持久化句柄时，必须能随 Cordis fiber 一起释放。优先使用 `ctx.effect()`、`ctx.on()` 或返回 disposer 的 registry API。新增资源时要同时设计卸载与 HMR 路径。

## Browser half

浏览器入口是 [`src/client/index.ts`](../src/client/index.ts)，领域模型、localStorage 边界、面板 store 与视图分别位于同目录模块。[`tsdown.config.ts`](../tsdown.config.ts) 使用上游当前 `clientBundle` 相同的 browser/CJS 与 banner/intro/footer 语义生成 C6 factory bundle。`lib/client.js` 是可选的 DeepSeek Harness Web 入口，不是 dsh-TUI v0.15 client facet：

```js
window.__ModuleLoader__.load({
  id: 'dsh-deepread',
  factory: (require) => moduleExports,
})
```

宿主按 `dsh.client` 扫描包，解析 `exports["./client"]`，读取 bundle 内容计算 rev，并通过 `/plugins/<id>/client.js?rev=<hash>` 提供文件。bundle 必须在执行后注册与图中完全相同的 id；缺文件、id 不匹配、重复注册或 factory 内 `require()` 未进入宿主模块表都会响亮失败。

`lib/client.js` 与 `lib/client.js.map` 属于产物面，不能手改。浏览器修改流程固定为：

1. 修改 `src/client/**/*.ts`；
2. 运行 `npm run build:client`；
3. 检查并提交 `lib/client.js` 与 sourcemap；
4. 运行 `npm test`；
5. 对装载或 UI 生命周期变化，在真实 Harness Web profile 中验证。

上游的 `clientBundle` 预设没有作为已发布包暴露；上游文档明确要求 out-of-tree 插件自行复刻该构建。这里由 tsdown 负责模块转换和 factory 产物生成，不再把 JavaScript 源文本手工拼进 loader wrapper。升级 Harness 时仍须重新核对 `packages/client/tsdown.client.ts`、`ClientPluginHandoff` 和 factory `require` 规则。

## 三个 UI slot

浏览器 `apply` 通过 `ctx.slots.inject()` 等待宿主声明 slot，再通过 `slots.register()` 注册贡献：

| slot | 类型 | 本插件注册键 | 作用 |
| --- | --- | --- | --- |
| `tool.call.toolview` | keyed / session | `key: "deepread"` | 用精读结果卡替换通用工具卡 |
| `conversation.input.left` | list / session | `id: "deepread-composer"` | 输入区左侧的 📖 入口 |
| `shell.overlay` | list / root | `id: "deepread-panel"` | 根级精读浮层 |

`slots.inject` 很重要：宿主各包的 apply 顺序不受 `dsh.client.inject` 排序控制。slot 尚未声明时它会等待；声明出现后同步注册；声明坍塌或本插件卸载时，它会释放贡献；宿主重新声明后再注册。不要把它改成裸 `slots.register()`。

### 浏览器 `exports.inject`

浏览器 bundle 导出的 `inject = ['slots', 'sessions', 'conversation']` 是客户端 Cordis 服务激活条件：

- `slots` 用于 UI 组合；
- `sessions` 用于定位当前会话；
- `conversation` 用于写入并提交精读指令。

组件不应直接持有 `ctx`。当前面板通过 `shell.overlay` 注册项的 `inject` 回调接收普通 `submitDeepread` 函数，这符合宿主的 ctx discipline。

### `package.json#dsh.client.inject`

这里填写的是客户端包名依赖边，不是上面的服务名。上游当前把这些边用于预检展示和 HMR 图差异，它们不决定 bundle 激活顺序；真正的激活等待来自 Cordis 服务 `inject`，slot 声明等待来自 `ctx.slots.inject`。

## 样式与主题

Harness 的 `ui-theme` 统一拥有亮暗主题和 `--dsw-*` token，功能插件应只消费 `--dsw-alias-*` 语义变量：

- 不在功能 CSS 中自行添加 `prefers-color-scheme` 分支；
- 不复制宿主调色板；
- 颜色、边框、层级和文字使用语义 alias；
- 保留键盘焦点可见性和 reduced-motion 行为；
- 共享主题问题应先判断是本插件用了错误 token，还是上游 token 本身需要修正。

这直接适用于暗黑模式 issue：优先修复本插件的 token 选择和对比度，不新增与宿主竞争的独立主题状态。

## 三种 `inject` 的对照

| 位置 | 值的类型 | 决定什么 |
| --- | --- | --- |
| `lib/types/index.js` 转发的 `export const inject` | Node 服务名 | Node plugin 何时可激活 |
| browser bundle 的 `exports.inject` | 浏览器 Cordis 服务名 | browser plugin 何时可激活 |
| `package.json` 的 `dsh.client.inject` | 客户端 npm 包名 | 客户端图元数据；不负责执行排序 |

排障时先确认问题发生在哪一层，不要因为三处都叫 `inject` 就互相替换。

## 验证层级

### 仓库内快速验证

```sh
npm run typecheck:host
npm run typecheck:browser
npm run build
npm test
npm pack --dry-run --json
```

当前测试覆盖 Node 工具主路径、缓存、预算 API、PDF、后台进度、client C6 handoff、三个 slot 注册、v0.15 manifest、旧数据双向兼容与发布文档/tarball 契约。它们使用 shim 和伪造 ctx，不证明真实 profile 解析、真实 slot 声明生命周期、HMR、浏览器视觉效果或 dsh-TUI TTY 行为。

### 真实宿主验证

在明确获得安装授权后，从插件仓库运行：

```sh
dsh plugin --profile web add .
dsh --profile web --dump-config
dsh web
```

至少核对：

1. dump 中存在 `id: deepread` / `name: dsh-deepread`；
2. `/plugins/dsh-deepread/client.js` 返回 JavaScript，不是 SPA HTML；
3. 控制台没有 bundle id、factory `require` 或 slot declaration 错误；
4. 📖 按钮、浮层和 `deepread` 工具卡都出现；
5. `/api/deepread/budget` 可用；
6. reload/unload 后没有重复 slot、重复 style 或残留订阅。

验证完成后的可逆卸载：

```sh
dsh plugin --profile web remove dsh-deepread
dsh --profile web --dump-config
```

不要通过删除 pnpm 缓存、`node_modules` 单个目录或 profile 文件中的孤立一行代替卸载。

## 排障顺序

按链路从前往后查，避免在错误层修改代码：

1. **安装**：profile 的 `package.json` 是否真的依赖 `dsh-deepread`；
2. **bundle 发现**：安装包是否包含合法的 `dsh.bundle.patch`；
3. **配置合成**：`--dump-config` 是否出现 deepread 行，是否被后层覆盖；
4. **Node 激活**：所需服务是否存在，`apply` 是否执行，工具和预算路由是否注册；
5. **client 发现**：`dsh.client` 与 `exports["./client"]` 是否可解析，产物是否存在；
6. **bundle 到达**：浏览器是否成功请求 `/plugins/dsh-deepread/client.js?rev=...`；
7. **factory 注册**：`__ModuleLoader__.load` 的 id 是否为 `dsh-deepread`；
8. **模块实例化**：factory 的 `require('react')` 是否由宿主 module table 提供；
9. **Cordis 激活**：browser `exports.inject` 的服务是否就绪；
10. **slot 生命周期**：三个目标 slot 是否声明，注册键是否冲突；
11. **业务行为**：最后才查组件状态、提交回调、API 和模型流程。

## 当前维护关注项

以下是升级或处理相关 issue 时应优先复核的点，不代表它们现在一定导致故障：

1. **可选服务时序**：`webServer`、`storageDomain` 与 `jobs` 不得重新进入 Node 硬依赖；升级宿主时要复核 `ctx.inject` 的 late-add/dispose 行为和 headless 降级测试。
2. **out-of-tree tsdown 配置**：上游 preset 未发布，因此本仓库镜像其构建语义；协议变化仍需主动对照上游更新。
3. **面板开关状态归属**：入口是 session scope、浮层是 root scope，不能跨 scope 共享同一个 store handle。开关状态因此由 `apply` 内创建的单一 snapshot source 持有，并通过两个注册项的官方 `inject.hooks` 通道分别绑定为 `usePanelState`；两个按钮调用同一个 toggle action，声明折叠或插件卸载时由 slot renderer 释放订阅。
4. **主题契约**：当前文字、背景、边框、焦点和置信度状态都消费 `--dsw-alias-*` semantic tokens。升级宿主或调整样式时必须保持 `test/client-theme-contract.mjs` 绿色，并在真实 Web light/dark 主题下复核对比度。
5. **集成测试边界**：`test/client-lifecycle.mjs` 在可用的上游构建上运行真实 `ClientModuleSystem` 并验证 slot/snapshot 订阅/style 释放；完整 HMR 与视觉主题仍需在实际浏览器 profile 中复核。

## 上游事实来源

每次升级优先查看这些文件（路径相对 `deepseek-harness` 上游仓库）：

- `apps/cli/reference/README.md`：profile、plugin add/remove、层优先级、Web alias；
- `apps/cli/src/plugin.ts`：安装完成后的 bundle reconciliation；
- `packages/boot/app-boot/src/profile.ts`：bundle 解析和 profile composition；
- `docs/subsystems/client-modules.md`：客户端图、bundle route、HMR；
- `packages/client/modules/src/index.ts`：`dsh.client` 和 `exports["./client"]` 解析；
- `packages/client/modules/src/client/system.ts`：`__ModuleLoader__`、factory、module table；
- `packages/client/modules/src/client/manifest.ts`：C6 handoff 类型；
- `packages/client/ui-slots/README.md`：slot 声明、注册、store 和 disposal；
- `packages/client/AGENTS.md`：浏览器插件当前强制约束；
- `docs/web-styling.md`：主题和 semantic token 规则。

若本文与这些当前来源冲突，以当前上游来源为准，并在同一次插件改动中更新本文。
