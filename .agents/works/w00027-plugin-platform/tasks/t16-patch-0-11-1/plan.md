# t16 计划：0.11.1 补丁

## 1. Context

t15 发布 0.11.0 后的真实用户冒烟（[t15 evidences/p3-user-smoke.md](../t15-author-api-round2/evidences/p3-user-smoke.md)）找出 4 条缺陷与 9 条可改进。开发者 2026-10-27 定：新建章节、中文书名的短名、装插件后的重启入口先记下（Work README 后续事项），其余一次做完，用 autonomous-delivery 推进，审查只派一个 Sonnet，不用 omp。

本 Task 的范围（编号沿用冒烟记录）：

| 编号 | 内容 |
|---|---|
| 缺陷 2 | 从书架进作品（整页切换）时控制台报 error 与十几条 warn |
| 缺陷 3 | 作者构建每次打印 rolldown 的 `[PLUGIN_TIMINGS]` |
| 缺陷 4 | `nbook --help` 的说明列没对齐（中文两格宽） |
| 缺陷 5 | nb-story 的 typecheck 在 master 上坏了（w00024 t31 引入；归属上是 w00024 的，因只改一个文件、又让 CI 变红，按开发者“一次性做了”并入，记进待确认清单） |
| 改进 1 | 新建作品后直接打开它 |
| 改进 5 | Ctrl-C 停止时终端打印“已停止” |
| 改进 6 | 插件页的内置插件有名称与说明 |
| 改进 7 | npm 元数据（keywords、homepage、bugs，描述统一中文，应用包 README 去掉“Agent 会话”） |
| 改进 8 | README 写明没有“文档”目录时作品目录落在 `~/NeuroBook` |
| 改进 9 | 发布文档写明 `bun publish <tarball>` 的 `bin does not exist` 警告无害 |

收尾把产品版本改成 0.11.1；真正发布是远端写入，停下交开发者（与 0.11.0 一样经 `release:smoke`、`release:publish`）。

依据：[`workbench.bookshelf`](../../../../../docs/specs/workbench/bookshelf.md) 输出 11（新建）、[`runtime.cli`](../../../../../docs/specs/runtime/cli.md)、[`runtime.plugin-install`](../../../../../docs/specs/runtime/plugin-install.md)（插件页）。

## 2. 技术选型

| 问题 | 选用 | 理由；否决 |
|---|---|---|
| 终端里中文的显示宽度 | `Bun.stringWidth`（Bun 内置，认东亚宽字符与 ANSI 码），经 commander 14 的 `configureHelp({displayWidth})` | 已有；否决新增 `string-width` 依赖 |

## 3. 关键设计

### 3.1 整页切换不再报 error（缺陷 2）

- `src/plugins/workbench/web/plugin.ts` 的 `reportPart`：入口已停止（`context.signal.aborted`）时外壳与文档根的加载失败是页面正在离开，记 debug，不记 error；没停止时照旧 error。
- `packages/nb-runtime/src/diagnostics/store.ts` 的 `severityForPluginDiagnostic`：没有错误的撤回按原因分级，正常关闭的原因（`receiver-closed`、`scope-closed`、`activation-stopped`）记 debug；失败带来的撤回（`activation-failed`、`delivery-failed`）与带错误的撤回仍是 warn。插件诊断的 `reason` 字段已有，不改结构。
- 测试：`store.ts` 所在的诊断测试加一条“正常关闭的撤回记 debug、失败撤回记 warn”；`home-page.dom.test.ts` 或工作台插件测试加“入口停止后外壳加载失败不记 error”。

### 3.2 作者构建不打印 PLUGIN_TIMINGS（缺陷 3）

- `src/plugin-platform/build/build-plugin.ts` 的 `rolldownOptions` 加 `checks: {pluginTimings: false}`（与 `plugin-sdk/pack.ts` 一致），注释写原因：作者看不懂、不是他能处理的。
- 测试：`plugin-sdk/template.test.ts` 的构建一步断言标准输出与错误里没有 `PLUGIN_TIMINGS`。

### 3.3 帮助对齐（缺陷 4）

- `src/cli/main.ts` 的 `configureHelp` 加 `displayWidth: (text) => Bun.stringWidth(text)`。
- 测试：`src/cli/cli.test.ts` 的用法一组加“`--help` 每行说明的起始显示列相同”（按 `Bun.stringWidth` 量各行说明前缀）。

### 3.4 nb-story 的 typecheck（缺陷 5）

- `GraphLayout` 从 `src/web/graph/StoryNetwork.vue` 挪到一个 `.ts`（`src/web/graph/layout.ts`），`StoryNetwork.vue`、`relations-view.ts`、`RelationsPage.vue` 都从它导入；`StoryNetwork.vue` 再导出，外部写法不变。
- 验证：`packages/nb-story` 的 `bun run typecheck` 与 `bun run test`。

### 3.5 新建作品后打开（改进 1）

- `src/plugins/projects/web/components/BookshelfHost.vue` 的 `submitInfo`：新建成功、封面与作品目录写完之后调用 `props.page.open(outcome.id)`（与点卡片同一个打开动作，整页进入工作台）。编辑信息不变。“打开已有作品”不在范围内（开发者只提了新建）。
- Spec：bookshelf 输出 11 的“提交”改成“成功后作品出现在书架上，封面与作品目录写完后打开它”。
- 测试：`BookshelfPage.dom.test.ts` 或宿主的测试里新建成功后断言调用了打开；e2e 不新增（书架 e2e 覆盖整页打开）。

### 3.6 Ctrl-C 后打印已停止（改进 5）

- `src/cli/start.ts`：前台运行的服务端停止结束后，文本模式在标准错误写一行“NeuroBook 已停止。”；`--json` 不加输出（结果对象已经写过）。退出码不变。
- 测试：`cli.test.ts` 场景 2 的 SIGINT 断言标准错误含“已停止”。
- Spec：cli 的输出加这一句。

### 3.7 内置插件的名称与说明（改进 6）

- `src/plugins/plugins/web/builtin-names.ts`（新）：内置插件 id → `{name: LocalizedText, description: LocalizedText}`，中英两种。插件页对 `source: "builtin"` 且 `displayName` 为空的行用它填名称与说明；表里没有的 id 照旧只显示 id。
- 测试：`PluginsPage.dom.test.ts` 加一条“内置插件显示名称与说明，按界面语言”；架构测试或表本身的测试核对表里的 id 都在产品清单里（`productPlugins`），免得改名后表里留着旧 id。
- 前端改动，按 ui-development 的检查自看一遍（文字、间距沿用第三方插件那一行的样式）。

### 3.8 npm 元数据与文档（改进 7、8、9）

- `scripts/pack-app.ts` 与 `plugin-sdk/pack.ts` 的清单加 `keywords`（neurobook、writing、novel、markdown、bun 等；SDK 另加 plugin、sdk）、`homepage`（仓库地址加子目录的 README 锚）、`bugs`（Issues 地址）。描述：应用包取 `packages/neuro-book/package.json` 的 description，改成中文“NeuroBook：本地优先的长篇写作工作区（v2 预览版）”；SDK 保持中文。`pack-app.test.ts`、`plugin-sdk/pack.test.ts` 断言这三项。
- `scripts/app-package/README.md` 第一段去掉“Agent 会话”；它与根 README 两份写明“没有文档目录时放在 `~/NeuroBook`”。
- `docs/standards/repository-workflow.md` 发布步骤写一句：`bun publish <tarball>` 会按当前目录找 bin 打印 `bin … does not exist`，无害。

### 3.9 版本 0.11.1

- `packages/neuro-book/package.json` 与 `src/shared/product.ts` 改成 0.11.1。

## 4. Spec 与文档改动

- `docs/specs/workbench/bookshelf.md` 输出 11：新建成功后打开作品。
- `docs/specs/runtime/cli.md`：前台停止后在标准错误写“已停止”；帮助按显示宽度对齐不是合同，不写。
- 根 README 两份、应用包 README、repository-workflow（见 3.8）。

## 5. 切片

| 片 | 内容 | 自跑验证 |
|---|---|---|
| S1 | 3.2、3.3、3.6（命令行与构建预设） | `bun test src/cli`、`plugin-sdk/template.test.ts` |
| S2 | 3.1（整页切换的日志级别） | nb-runtime 诊断测试、工作台测试、主工作区里起 nbook 用 Playwright 复现“书架进作品”控制台没有 error |
| S3 | 3.5、3.7（书架新建后打开、插件页内置名称） | 书架与插件页的 DOM 测试，`bookshelf`、`plugins` e2e |
| S4 | 3.4（nb-story） | nb-story typecheck 与 test |
| S5 | 3.8、3.9（元数据、文档、版本） | `pack-app.test.ts`、`plugin-sdk/pack.test.ts`、`release:check`、`docs:check` |
| 收口 | 合入 master | 受影响测试、全量 e2e（负载低时），干净克隆里 `release:smoke`；实现审查派 Sonnet（不阻塞） |

## 6. 验收映射

| 判据 | 覆盖 |
|---|---|
| bookshelf 输出 11（新建后打开） | 书架 DOM 测试；`release:smoke` 的“页面打开书架”不受影响 |
| cli 停止后的提示 | `cli.test.ts` 场景 2 |
| 插件页内置名称 | `PluginsPage.dom.test.ts` |
| 整页切换没有 error | 诊断级别的单测 + 一次真实浏览器复现（证据写进 Task） |

## 7. 验证

本地按切片自跑；收口在主工作区或干净克隆里跑 `release:smoke`（[验证门禁](../../../../../docs/testing/README.md#验证门禁)：打包与发布的验证不在 `.worktree/` 下做）。发布 0.11.1 由开发者授权后执行。

## 8. 不做与风险

- 不做：新建章节、中文短名、插件重启入口（后续事项）；“打开已有作品”后是否也直接打开。
- 风险：撤回改成 debug 后，真有问题的撤回（例如交付失败）仍是 warn，不会被藏起来；只有三个正常关闭的原因降级。
