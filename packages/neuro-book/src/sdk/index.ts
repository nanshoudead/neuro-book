/**
 * 插件 SDK 的根入口：插件框架（docs/specs/runtime/plugin-api.md 的“SDK”）：`definePlugin`、内核的入口、服务、远程服务与
 * 诊断、宿主能力与多语言文字。各内置插件的合同与助手按插件放在子路径（子路径表 `entries.ts`）。只再导出已有实现，不写新逻辑。
 *
 * 第三方插件以 `@notnotype/nb-plugin-sdk` 导入它：仓库里经 tsconfig 与 Vite 的别名解析到这里，仓库外由 `build:sdk`
 * 生成的包提供类型与构建期的实现；插件运行时用的是宿主模块表里的这一份（plugin-code-loading.md 输出 2）。所以
 * 这里每导出一项都是 `engines.neurobook` 兼容范围内的承诺，增删要同时更新导出面快照（`sdk.test.ts`）。服务端也加载这个
 * 入口，不能引用 Vue。
 */

// 作者 API 的框架：绑定插件 id 的 `definePlugin`。各内置插件的贡献助手在它们自己的子路径（`/settings`、`/commands`、
// `/workbench`、`/settings/browser`）。
export {definePlugin, remoteService} from "./plugin";
export type {AuthorActivationContext, AuthorEntry, AuthorEntryOutput, BoundImplementation, ContributionHelper, PluginBuilder, Text} from "./plugin";

// 内核：入口、服务、远程服务与贡献。
export {defineEntry, provideService, provideServicePerConsumer} from "@notnotype/nb-runtime/plugins";
export type {
    ActivationContext,
    ContributionDeclaration,
    ContributionDescriptor,
    ContributionHandle,
    ContributionPointDefinition,
    ContributionReceiver,
    PluginDefinition,
    PluginDescriptor,
    PluginEntryDefinition,
} from "@notnotype/nb-runtime/plugins";
export {defineServiceKey} from "@notnotype/nb-runtime/services";
export type {ServiceKey} from "@notnotype/nb-runtime/services";
export {defineRemoteService, eventSource, fail, ok, orThrow, provideRemote} from "@notnotype/nb-runtime/remote";
export type {EventSource, RemoteContract, RemoteOutcome, RemoteResult, RemoteResultFor, RemoteSink, RemoteSubscribeOptions, RemoteSubscription} from "@notnotype/nb-runtime/remote";
export {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
export type {DiagnosticsService} from "@notnotype/nb-runtime/diagnostics";
export type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";

// 宿主能力：宿主在每个运行实例给出的本地服务。名字带 host，免得与插件自己的服务键重名。
export {clockKey as hostClockKey, stateRootKey as hostStateRootKey} from "nbook/shared/host";
export type {StateRoot} from "nbook/shared/host";

// 多语言文字。`pluginText` 给代码里直接构造的文字引用绑定插件 id（声明里的引用由宿主登记时补命名空间）。
export {formatText, localize} from "nbook/shared/localized-text";
export {pluginText} from "nbook/shared/plugin-text";
export type {CatalogKey} from "nbook/shared/plugin-text";
export type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";
