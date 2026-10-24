/**
 * 插件 SDK 的公开面：各运行位置通用的部分（docs/specs/runtime/plugin-api.md 的“SDK”）。只再导出已有实现，不写新逻辑。
 *
 * 第三方插件以 `@notnotype/nb-plugin-sdk` 导入它：仓库里经 tsconfig 与 Vite 的别名解析到这里，仓库外由 `build:sdk`
 * 生成的包提供类型与构建期的实现；插件运行时用的是宿主模块表里的这一份（plugin-code-loading.md 输出 2）。所以
 * 这里每导出一项都是 `engines.neurobook` 兼容范围内的承诺，增删要同时更新导出面快照（`sdk.test.ts`）。要 Vue 或 DOM 的
 * 放在 `browser.ts`。
 */

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
export {defineRemoteService, fail, ok, orThrow, provideRemote} from "@notnotype/nb-runtime/remote";
export type {RemoteContract, RemoteOutcome, RemoteResult, RemoteSink, RemoteSubscribeOptions, RemoteSubscription} from "@notnotype/nb-runtime/remote";
export {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
export type {DiagnosticsService} from "@notnotype/nb-runtime/diagnostics";
export type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";

// 宿主能力：宿主在每个运行实例给出的本地服务。名字带 host，免得与插件自己的服务键重名。
export {clockKey as hostClockKey, stateRootKey as hostStateRootKey} from "nbook/shared/host";
export type {StateRoot} from "nbook/shared/host";

// 内置插件的合同：设置（nbook.settings）。
// 设置窗口左栏的分区：list 分区是向 `settings.sections` 的顶层声明，page 分区用 `/browser` 的 `settingsPageContribution`；
// 选项来源（`settings.choices`）给设置项的下拉列表供数据。
export {displayLocale, settingsKey} from "nbook/plugins/settings/shared/contracts";
export {SETTINGS_CHOICES_POINT, SETTINGS_PAGES_POINT, SETTINGS_SECTIONS_POINT, settingsChoicesEvent} from "nbook/plugins/settings/shared/sections";
export type {SettingsChoicesDeclaration, SettingsPageDeclaration, SettingsSectionCategory, SettingsSectionDeclaration} from "nbook/plugins/settings/shared/sections";
export {defineSetting} from "nbook/shared/settings";
export type {SettingDefinition, SettingLayer, SettingsFailure, SettingsService, SettingWriteResult} from "nbook/shared/settings";

// 存储（nbook.storage）。
export {storageKey} from "nbook/plugins/storage/shared/contracts";
export {defineRecord} from "nbook/shared/storage";
export type {RecordDefinition, RecordHandle, StorageService} from "nbook/shared/storage";

// 命令（nbook.commands）。
export {COMMANDS_POINT} from "nbook/plugins/commands/shared/contracts";
export type {CommandDeclaration, CommandImplementation} from "nbook/plugins/commands/shared/contracts";

// 工作台（nbook.workbench）：侧栏与面板的视图、状态栏条目。视图的实现用 `/browser` 的 `viewContribution`。
// 从叶子模块取，不经工作台合同的汇总模块：汇总模块连着首页、浮层、菜单这些不对外的部分（公开面闭包见 `surface.test.ts`）。
export {WORKBENCH_STATUSBAR_ITEMS_POINT} from "nbook/plugins/workbench/shared/items";
export type {ItemDeclaration} from "nbook/plugins/workbench/shared/items";
export {WORKBENCH_VIEWS_POINT} from "nbook/plugins/workbench/shared/views";
export type {ViewDeclaration, ViewLocation} from "nbook/plugins/workbench/shared/views";

// 插件状态与公开状态（nbook.state）。
export {defineStore} from "nbook/shared/store/store";
export {definePublicState} from "nbook/shared/store/public";

// 多语言文字。
export {formatText, localize} from "nbook/shared/localized-text";
export type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";
