# Upgrade and rollback: `1.0.0`

[English](#english) | [中文](#中文)

## English

### Before upgrading

- Use Node.js `^22.19 || >=24` and record the profile name you are changing.
- Keep the profile on the same `DSH_HOME` if you want the Host cache and calibration to remain visible.
- Keep using the same browser origin if you want the Web reading history to remain visible. An origin is the complete protocol, domain, and port tuple.
- Do not clear storage or rename storage domains as part of the upgrade.

After `1.0.0` is published, install the stable release in a DeepSeek Harness profile with:

```sh
dsh plugin --profile <profile> add dsh-deepread@1.0.0
```

Use a Web-capable profile to load the optional browser client. A headless profile loads the Host tool and packaged skill but does not load `lib/client.js` or register the budget HTTP route. dsh-TUI `0.8.1` or newer admits the same package through its Host-only Community Consensus v0.15 `dsh-plugin.json`; it does not load the DeepSeek Harness Web client.

### What is retained

The `1.0.0` release keeps the four `0.5.4` persistence identities and record formats unchanged:

| Data | Stable identity | Retention condition |
| --- | --- | --- |
| Web recent reads | `localStorage['dsh-deepread-history-v1']` | Same browser origin; the existing 20-item behavior is unchanged |
| Web budget calibration | `localStorage['dsh-deepread-calib']` | Same browser origin |
| URL full-text cache | `deepread_url_cache` / version `1` / table `articles` | Same `DSH_HOME` and a composition with `storageDomain` |
| Host speed calibration | `deepread_stats` / version `1` / table `stats` / key `default` | Same `DSH_HOME` and a composition with `storageDomain` |

Publishing or installing the new version does not delete these values. The following environment changes can make retained data appear missing:

- Changing the Web origin (protocol, domain, or port) selects a different localStorage namespace; the old values remain under the old origin.
- Changing `DSH_HOME` selects a different storage directory; point the host back to the original value to see the original cache and calibration.
- Clearing site data in the browser can delete localStorage. That deletion is a browser action, not a plugin migration.
- A composition without `storageDomain` uses in-process cache and calibration. That fallback cannot retain data across process restarts because it was never persisted.

No automatic conversion or cleanup runs during upgrade. The compatibility tests prove both old-to-new and new-to-`0.5.4` reads for these v1 formats.

### Roll back to `0.5.4`

`0.5.4` is the last stable DeepSeek Harness Web package. It predates the Host-only v0.15 manifest and is not a dsh-TUI v0.15 rollback target.

For the DeepSeek Harness profile that previously ran `0.5.4`:

1. Stop the running host and keep the original `DSH_HOME` and profile configuration.
2. Restore the profile dependency with the supported plugin commands:

   ```sh
   dsh plugin --profile <profile> remove dsh-deepread
   dsh plugin --profile <profile> add dsh-deepread@0.5.4
   ```

3. Restart the profile. For Web history, open the original browser origin.
4. Confirm the `deepread` tool and, for Web, the reading panel are available before removing any backup.

Because all four identities and v1 record formats are unchanged, **no data conversion is required**. Do not delete `$DSH_HOME/storages` or clear browser site data as part of rollback.

## 中文

### 升级前

- 使用 Node.js `^22.19 || >=24`，并记下正在修改的 profile 名称。
- 希望继续看到 Host 缓存和校准时，保持同一个 `DSH_HOME`。
- 希望继续看到 Web 最近读过时，保持同一个浏览器 origin；origin 由协议、域名和端口共同决定。
- 升级过程中不要清理存储，也不要重命名 storage domain。

`1.0.0` 发布后，在 DeepSeek Harness profile 中使用以下命令安装 npm 正式版：

```sh
dsh plugin --profile <profile> add dsh-deepread@1.0.0
```

Web-capable profile 会加载可选浏览器 client；headless profile 只加载 Host 工具和打包 skill，不加载 `lib/client.js`，也不注册预算 HTTP route。dsh-TUI `0.8.1` 及以上版本通过 Host-only Community Consensus v0.15 `dsh-plugin.json` 接纳同一个包，不加载 DeepSeek Harness Web client。

### 数据保留条件与例外

`1.0.0` 保持 `0.5.4` 的四个持久化标识和记录格式不变：

| 数据 | 稳定标识 | 保留条件 |
| --- | --- | --- |
| Web 最近读过 | `localStorage['dsh-deepread-history-v1']` | 同一浏览器 origin；原有最多 20 条语义不变 |
| Web 预算校准 | `localStorage['dsh-deepread-calib']` | 同一浏览器 origin |
| URL 全文缓存 | `deepread_url_cache` / version `1` / table `articles` | 同一 `DSH_HOME`，且组合提供 `storageDomain` |
| Host 速度校准 | `deepread_stats` / version `1` / table `stats` / key `default` | 同一 `DSH_HOME`，且组合提供 `storageDomain` |

发布或安装新版本不会删除这些值。以下环境变化会造成“看似丢失”：

- Web origin 的协议、域名或端口变化后会进入另一套 localStorage 命名空间；旧值仍留在旧 origin。
- 更换 `DSH_HOME` 后会看到另一份存储目录；改回原值即可看到原缓存和校准。
- 浏览器“清除站点数据”会删除 localStorage；这是浏览器操作，不是插件升级迁移。
- 没有 `storageDomain` 的组合使用进程内缓存和校准；这些状态本来就不会跨进程重启持久化。

升级不会自动转换或清理数据。兼容性测试同时证明旧版写入可由新版读取、新版 v1 写入可由 `0.5.4` 读取。

### 回滚到 `0.5.4`

`0.5.4` 是最后一个稳定的 DeepSeek Harness Web 包；它早于 Host-only v0.15 manifest，不是 dsh-TUI v0.15 的回滚目标。

在原来运行 `0.5.4` 的 DeepSeek Harness profile 中：

1. 停止宿主，保留原 `DSH_HOME` 与 profile 配置。
2. 用受支持的插件命令恢复旧版依赖：

   ```sh
   dsh plugin --profile <profile> remove dsh-deepread
   dsh plugin --profile <profile> add dsh-deepread@0.5.4
   ```

3. 重启该 profile；如需 Web 历史，回到原浏览器 origin。
4. 删除任何备份前，先确认 `deepread` 工具与 Web 阅读面板可用。

四个标识和 v1 记录格式均未变化，**回滚无需数据转换**。回滚过程中不要删除 `$DSH_HOME/storages`，也不要清除浏览器站点数据。
