---
schema: nbook.adr/v1
status: accepted
decided: 2026-10-24
superseded-by: null
---

# ADR 0030：内核与应用无关，第三方插件的通用管理暂留应用并按目录机检，作者材料留在应用包

- 日期：2026-10-24
- 决策者：开发者
- 关联工作：[w00027 t13](../../.agents/works/w00027-plugin-platform/tasks/t13-sdk-package-split/README.md)（架构设计见该 Task 的 [design.md](../../.agents/works/w00027-plugin-platform/tasks/t13-sdk-package-split/design.md)）
- 相关文档：[`monorepo-boundaries.md`](../modules/monorepo-boundaries.md)、[`runtime.plugin-manifest`](../specs/runtime/plugin-manifest.md)、[`runtime.plugins`](../specs/runtime/plugins.md)、[`runtime.plugin-api`](../specs/runtime/plugin-api.md)、[ADR 0027](0027-builtin-and-third-party-plugins-are-equal.md)

## 背景

w00027 t12 让外部视角的作者走了一遍插件开发，又做了一次可维护性审查。开发者据此提出一个思想实验：如果另一个应用也要做 NeuroBook 这样的插件模式，内核能不能直接用？当时不能：

- 内核里写死了 NeuroBook 的常量：清单里兼容版本的键 `engines.neurobook`、保留的发布者 `nbook`、内置插件 id 的前缀、诊断插件的 id。
- 第三方插件的安装、登记、装载、构建分散在应用的宿主与内置插件里，和 NeuroBook 专有的部分混在一起，同一条 id 规则写了好几份。
- 给作者的材料（作者命令、模板、作者文档、示例插件）放在应用的 `scripts/` 与 `examples/` 里；示例不随 SDK 分发，打包脚本用正则读 nb-ui 的源码生成文档。

开发者 2026-10-24 同意先做架构重设计，并定下设计里的 D0 到 D5 全部按推荐。眼下没有第二个应用，这个实验是用来检查内核的耦合程度。

## 决策

1. **内核与应用无关。** 应用的名字由宿主在装配时以平台档案传入：清单的引擎键与保留的发布者（`createManifestFormat`）、内核装配的 `platform`。内核自己保留发布者 `runtime`，自带的诊断插件叫 `runtime.diagnostics`。内核的非测试源码不出现应用名，由扫描测试守住；内核测试用另一份档案（`acme`）跑。
2. **第三方插件的通用管理暂留应用，放在 `src/plugin-platform/`。** 按 `shared`、`backend`、`web`、`build` 分目录，只依赖内核与列名的几个通用件，由应用的平台档案配置；不引用内置插件、NeuroBook 的合同与 SDK 入口，源码不出现 NeuroBook 的名字。这几条由架构测试守住，目录自己的测试用 `acme` 档案。内置插件 `nbook.plugins` 建在它上面。出现第二个使用插件模式的应用时，再把这个目录搬成包，档案就是它的配置接口。
3. **作者材料留在应用包的顶层目录 `plugin-sdk/`**，和 `src/`、`e2e/` 并列：作者命令、模板、作者文档、打包脚本、示例插件与场景测试。公开 API 的唯一入口是 `src/sdk/`；`plugin-sdk/` 只经它与 `src/plugin-platform/build/` 用应用，产品代码不引用 `plugin-sdk/`，由架构测试守住。打包产出可以安装的 tarball，带示例插件的源码。
4. **SDK 的版本等于产品版本**，随应用发布，兼容范围按 `engines.neurobook` 判断（[`runtime.plugin-api`](../specs/runtime/plugin-api.md) 的“兼容”）。

## 备选方案

- **SDK 与插件管理放进内核**：内核要依赖应用的合同与打包器，依赖成环，内核也就不再与应用无关。
- **做法 A，把内置插件的合同整个搬进 SDK 包**：要搬 36 个文件、改 751 处导入；内置插件被拆成两半，搬进去的内部实现看起来都像公开 API。
- **做法 B，每个内置插件一个包**：包的数量与装配复杂度大增，眼下没有对应的收益。
- **做法 C1，SDK 作为独立的工作区包，经应用的包导出引用应用**（开发者先同意过“拆成独立的 SDK 包”，设计审查后改判）：违反“领域包不得依赖应用”的治理规则，要开例外；作者拿到的类型声明要从应用源码打平，应用内部的路径别名会外泄进 SDK 包的配置；场景测试要装配真实的内置插件，测试设施要在 SDK 包里再复制一份；应用的装载 e2e 靠示例插件撑着，示例搬走覆盖就缩水；新包还要在根 workspaces、CI 选包与工作流里登记。换来的只是 `packages/` 下多一个包，而这个 SDK 本来就是 NeuroBook 专有的。
- **现在就抽通用插件管理包**：只有一个使用者，接口只会照着 NeuroBook 设计。先按目录独立、边界机检，抽包时只是搬家。
- **SDK 只给类型**（像 `@types/vscode`）：作者构建时要执行入口定义来生成清单，作者的测试也要执行它，离不开应用实现的构建期拷贝。改成只给类型是更大的方向变化，不做。

## 后果

- 依赖诊断服务的外置插件要按新 id 重新构建；SDK 还没发布，现在改代价最小。
- 内置插件的贡献 id 前缀也由内核统一核对：贡献点写 `idPrefix: "plugin"` 时，保留发布者的插件可以只以发布者加 `.` 开头（ADR 0027 的后续修订）。
- 要独立发布 SDK、给它独立的版本时，把 `plugin-sdk/` 整个搬出去，那时要解决的正是做法 C1 列出的几项。
- [ADR 0029](0029-workspace-packages-publish-source-to-npm.md) 把 nb-ui 与 nb-runtime 发到 npm 之后，SDK 可以改为依赖这两个包，而不是把它们的构建期实现打进 SDK；这件事随 SDK 的发布另行决定。
