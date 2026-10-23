/**
 * 插件 SDK 的公开面：各运行位置通用的部分（docs/specs/runtime/plugin-api.md 的“SDK”）。只再导出已有实现，不写新逻辑。
 *
 * 第三方插件以 `@notnotype/nb-plugin-sdk` 导入它：仓库里经 tsconfig 与 Vite 的别名解析到这里，仓库外由 `build:sdk`
 * 生成的包提供类型与构建期的实现；插件运行时用的是宿主模块表里的这一份（plugin-code-loading.md 输出 2）。所以
 * 这里每导出一项都是 `engines.neurobook` 兼容范围内的承诺，增删要同时更新导出面快照（`sdk.test.ts`）。要 Vue 或 DOM 的
 * 放在 `browser.ts`。
 */

// 内核：入口、服务、远程服务与贡献。
export {defineEntry, provide, providePerConsumer} from "@notnotype/nb-runtime/plugins";
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
export {defineRemoteService, orThrow, provideRemote} from "@notnotype/nb-runtime/remote";
export type {RemoteContract, RemoteOutcome, RemoteResult, RemoteSink} from "@notnotype/nb-runtime/remote";
export {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
export type {DiagnosticsService} from "@notnotype/nb-runtime/diagnostics";
export type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";

// 宿主能力：宿主在每个运行实例给出的本地服务。名字带 host，免得与插件自己的服务键重名。
export {clockKey as hostClockKey, stateRootKey as hostStateRootKey} from "nbook/shared/host";
export type {StateRoot} from "nbook/shared/host";

// 内置插件的合同：设置（nbook.settings）。
export {displayLocale, SETTINGS_PAGES_POINT, settingsKey, settingsPageEvent} from "nbook/plugins/settings/shared/contracts";
export type {SettingsPageDeclaration} from "nbook/plugins/settings/shared/contracts";
export {defineSetting} from "nbook/shared/settings";
export type {SettingDefinition, SettingLayer, SettingsFailure, SettingsService, SettingWriteResult} from "nbook/shared/settings";

// 存储（nbook.storage）。
export {storageKey} from "nbook/plugins/storage/shared/contracts";
export {defineRecord} from "nbook/shared/storage";
export type {RecordDefinition, RecordHandle, StorageService} from "nbook/shared/storage";

// 命令（nbook.commands）。
export {COMMANDS_POINT} from "nbook/plugins/commands/shared/contracts";
export type {CommandDeclaration, CommandImplementation} from "nbook/plugins/commands/shared/contracts";

// 插件状态与公开状态（nbook.state）。
export {defineStore} from "nbook/shared/store/store";
export {definePublicState} from "nbook/shared/store/public";

// 多语言文字。
export {formatText, localize} from "nbook/shared/localized-text";
export type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";
