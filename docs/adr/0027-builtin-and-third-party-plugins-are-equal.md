---
schema: nbook.adr/v1
status: accepted
decided: 2026-10-17
superseded-by: null
---

# ADR 0027：内置插件与第三方插件能力相同，信任所有插件

- 日期：2026-10-17
- 决策者：开发者
- 关联工作：[w00027](../../.agents/works/w00027-plugin-platform/README.md)
- 相关文档：[`runtime.plugin-manifest`](../specs/runtime/plugin-manifest.md)、[`runtime.plugin-install`](../specs/runtime/plugin-install.md)、[`runtime.plugin-api`](../specs/runtime/plugin-api.md)、[`runtime.services`](../specs/runtime/services.md)、[`runtime.plugins`](../specs/runtime/plugins.md)
- 部分取代：[ADR 0022](0022-extensible-platform-and-plugin-trust.md) 决策 3 的第一条约束（“公开 API 全部异步、可序列化”）对同一实例内服务的要求，以及“后果”中“内置插件之间的内部服务不受此约束”隐含的“内部服务只给内置插件”；收窄 [ADR 0024](0024-multi-instance-runtime-topology.md) 中代理调用的“受控”含义

## 背景

w00027 开始让第三方插件真正可以安装。此前有两处按“内置还是第三方”区分插件：

- **代理允许清单**：只有装配方列出的内置插件（storage、settings、files）可以以调用方的身份发出远程调用（`remoteDelegates` 与 `context.remote.on`），第三方声明了也被拒绝。
- **同步服务只限内置插件**：ADR 0022 要求公开 API 异步、可序列化，好让以后把第三方插件移进独立进程或 worker 时只换传输层；同步调用、传对象引用的“内部服务”（命令服务、公开状态读取、配置的 `get`）因此只给内置插件依赖。按这条规则，第三方插件没有读配置、查询与执行命令的写法，而按第三方写法写的示例插件已经在用配置的同步读取。

开发者 2026-10-17 讨论过补一套插件权限：权限由拥有能力的插件定义，使用方在清单里声明，安装时告知，内核在自己经手的边界（远程调用、代理调用、敏感贡献点）核对。插件与宿主同进程运行，这套核对拦不住绕开内核的代码，只能防误用与告知；它要求内核、清单、安装界面与每个内置插件都改，而目前没有需要它的实际场景。开发者决定不做。

## 决策

1. **能力相同。** 内置插件与第三方插件使用同一套清单、登记、依赖、贡献与远程服务，能做的事相同。区别只有：内置插件的 id 以 `nbook.` 开头；随产品打包、默认启用、不经安装；版本等于产品版本。宿主适配器（[ADR 0026](0026-plugin-definitions-as-constants.md) 第 5 条的 `nbook.diagnostics`、`nbook.http`）是宿主的一部分，不在此列。
2. **信任所有插件，不设权限系统。** 删除代理允许清单：任何插件的入口都可以声明 `remoteDelegates` 并以调用方的身份调用。保留的两项核对不是授权，只检查身份对象的来源与寿命：身份必须是内核签发给本入口门面、且签发它的门面还没释放的（复制或伪造的对象被拒），合同必须写在入口的 `remoteDelegates` 里。
3. **内部服务对所有插件开放。** 任何插件都可以依赖同步调用、传对象引用的服务。“公开 API 异步、可序列化”只作为远程服务合同的写法：跨实例的调用本来就只能这样，同一实例里的服务可以同步。
4. **安装仍然告知完全信任**（ADR 0022 第 3 条不变）：安装确认界面说明插件可以访问全部作品、服务器与本机资源。

## 备选方案

- **插件权限系统**（见背景）：能告知用户插件做什么，以后加隔离时声明可以直接变成强制边界。但同进程下只能防误用，成本与 t03 一片相当，没有实际使用场景。不做；需要时另写 ADR。
- **保持同步服务只限内置**：保住“以后把第三方移进 worker 只换传输层”的路径，但第三方现在没有读配置、执行命令的写法，示例也写不成外置插件。不采用。

## 后果

- 插件之间的数据隔离只对守约插件成立，不是安全边界。提供按调用方门面的插件会收到每个调用方的身份；它在自己的 `remoteDelegates` 里声明任意合同，就能以这个身份调用，例如读写调用方在 `nbook.storage` 里的记录。完全信任下插件本来就能直接读写状态根里的文件，所以接受这一点；`storage.persistence` 的命名空间条目相应收窄。
- 依赖了内部服务的插件不能在不改写的前提下移进独立进程或 worker。以后按 ADR 0022 列出的条件重新评估信任模型、引入隔离时，需要新的 ADR 决定这些插件留在宿主进程，还是改用远程合同。
- 内核删除代理允许清单的选项与核对；宿主不再给出允许清单。代理调用的被拒原因只剩身份核对不过与合同未声明。
- 规范同步修改：`runtime.services` 输出 13 与委托被拒、`runtime.plugins` 的代理入口与输出 20、`runtime.plugin-channel` 的经代理调用、`runtime.application` 的应用清单、`runtime.plugin-manifest` 的 `remoteDelegates` 与清单无效条件、`runtime.plugin-api` 的选用规则、`workbench.commands`、`state.public-state`、`settings.configuration` 与 `workspace.markdown-syntaxes` 中“只给内置插件”的条目。
- 不改变的：`nbook.` 命名空间只给内置插件；安装确认、安全模式作为兜底；插件只经合同模块引用别的插件，不 import 宿主内部模块或别的插件的实现。

## 后续修订

- 2026-10-24（[w00027 t13](../../.agents/works/w00027-plugin-platform/tasks/t13-sdk-package-split/README.md)）：决策 1 的“id 以 `nbook.` 开头”改由平台档案给出（NeuroBook 保留 `nbook`，内核保留 `runtime`，诊断插件改名为 `runtime.diagnostics`）；另加一条区别：贡献点写 `idPrefix: "plugin"` 时，保留发布者的插件也可以只以发布者加 `.` 开头（内置插件的贡献常在别的内置插件名下），由内核统一核对（`runtime.plugins` 输出 15）。
