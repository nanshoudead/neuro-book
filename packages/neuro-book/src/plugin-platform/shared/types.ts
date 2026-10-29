/**
 * 插件管理交给界面的数据与失败码（docs/specs/runtime/plugin-install.md）：列表、待生效变化、没有登记的原因、安装预览。
 * 应用的插件管理界面用它们定义自己的远程合同，通用的安装与启动代码直接产出它们。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

/** 待生效变化：已写入登记表、下一次启动才生效（plugin-install 输出 9）。 */
export const PendingChangeSchema = Type.Union([
    Type.Object({kind: Type.Literal("install")}, {additionalProperties: false}),
    Type.Object({kind: Type.Literal("uninstall")}, {additionalProperties: false}),
    Type.Object({kind: Type.Literal("enable")}, {additionalProperties: false}),
    Type.Object({kind: Type.Literal("disable")}, {additionalProperties: false}),
    Type.Object({kind: Type.Literal("upgrade"), version: Type.String({minLength: 1})}, {additionalProperties: false}),
]);

export type PendingChange = Static<typeof PendingChangeSchema>;

/** 本次启动没有登记的原因（plugin-install 输出 1、6、7）：清单无效、入口文件缺失、安装目录读不了、不兼容、安全模式。 */
export const NotLoadedSchema = Type.Object({
    code: Type.Union([Type.Literal("manifest-invalid"), Type.Literal("entry-missing"), Type.Literal("unreadable"), Type.Literal("incompatible-engine"), Type.Literal("safe-mode")]),
    detail: Type.String(),
}, {additionalProperties: false});

export type NotLoaded = Static<typeof NotLoadedSchema>;

export const PluginListItemSchema = Type.Object({
    id: Type.String({minLength: 1}),
    /** 当前版本；内置插件是产品版本。 */
    version: Type.String({minLength: 1}),
    source: Type.Union([Type.Literal("builtin"), Type.Literal("third-party")]),
    /** 用户状态；内置插件恒为 `enabled`。 */
    state: Type.Union([Type.Literal("enabled"), Type.Literal("disabled"), Type.Literal("uninstalling")]),
    pending: Type.Array(PendingChangeSchema),
    /** 本次启动没有登记的原因；登记了为 null。 */
    notLoaded: Type.Union([NotLoadedSchema, Type.Null()]),
}, {additionalProperties: false});

export type PluginListItem = Static<typeof PluginListItemSchema>;

/**
 * 一个插件此刻在某个运行实例里的问题（plugin-install 的插件页）：入口激活失败、入口受阻、贡献被拒、消息目录没有取到。纯
 * JSON，按码给，界面按语言翻译固定的部分；`message` 是激活时抛出的错误消息，插件自己的文字（信任所有插件，不脱敏）。
 */
export const PluginProblemSchema = Type.Union([
    Type.Object({
        kind: Type.Literal("entry-failed"),
        plugin: Type.String({minLength: 1}),
        entry: Type.String({minLength: 1}),
        location: Type.String({minLength: 1}),
        /** 内核的激活阶段与原因，例如 `activate`、`activation-threw`。 */
        stage: Type.String({minLength: 1}),
        reason: Type.String({minLength: 1}),
        message: Type.Union([Type.String(), Type.Null()]),
    }, {additionalProperties: false}),
    Type.Object({
        kind: Type.Literal("entry-blocked"),
        plugin: Type.String({minLength: 1}),
        entry: Type.String({minLength: 1}),
        location: Type.String({minLength: 1}),
        reason: Type.Union([Type.Literal("missing-service"), Type.Literal("location-mismatch"), Type.Literal("provider-blocked"), Type.Literal("provider-failed"), Type.Literal("dependency-cycle"), Type.Literal("version-mismatch")]),
        /** 受阻牵涉的服务键或插件。 */
        key: Type.String(),
    }, {additionalProperties: false}),
    Type.Object({
        kind: Type.Literal("contribution-rejected"),
        plugin: Type.String({minLength: 1}),
        /** 顶层声明为 null。 */
        entry: Type.Union([Type.String({minLength: 1}), Type.Null()]),
        location: Type.String({minLength: 1}),
        capability: Type.String({minLength: 1}),
        id: Type.String({minLength: 1}),
        reason: Type.Union([Type.Literal("invalid-declaration"), Type.Literal("implementation-required"), Type.Literal("implementation-not-accepted"), Type.Literal("duplicate-contribution")]),
        detail: Type.Union([Type.String(), Type.Null()]),
    }, {additionalProperties: false}),
    /**
     * 窗口没有取到某种语言的目录（docs/specs/runtime/browser-host.md 的非致命目录问题）：只由窗口产生，插件照常登记，文字按
     * 回退链显示。`not-found` 端点 404（文件没了或摘要不是当前的）；`invalid` 取到了但不合目录规则；`fetch-failed` 连不上或
     * 端点出错。
     */
    Type.Object({
        kind: Type.Literal("catalog-unavailable"),
        plugin: Type.String({minLength: 1}),
        location: Type.String({minLength: 1}),
        locale: Type.String({minLength: 1}),
        reason: Type.Union([Type.Literal("not-found"), Type.Literal("invalid"), Type.Literal("fetch-failed")]),
        detail: Type.Union([Type.String(), Type.Null()]),
    }, {additionalProperties: false}),
]);

export type PluginProblem = Static<typeof PluginProblemSchema>;

/**
 * 列表里的一项：插件管理的条目加上给人看的名字、说明与此刻的问题。只有 `list` 返回它；安装、启停、卸载的结果下一次启动才
 * 生效，它们返回不带运行状态的 `PluginListItem`。
 */
export const PluginListEntrySchema = Type.Object({
    ...PluginListItemSchema.properties,
    /** 清单的显示名与说明；内置插件没有清单，为 null。 */
    displayName: Type.Union([Type.String(), Type.Null()]),
    description: Type.Union([Type.String(), Type.Null()]),
    /** 服务端实例里的问题（浏览器一侧的由窗口自己查）；按入口、贡献点与 id 排好。 */
    problems: Type.Array(PluginProblemSchema),
}, {additionalProperties: false});

export type PluginListEntry = Static<typeof PluginListEntrySchema>;

export const PluginListSchema = Type.Object({
    /** 本次启动是否为安全模式（plugin-install 输出 7）。 */
    safeMode: Type.Boolean(),
    /** 内置插件在前、第三方插件在后，各自按 id 排序；界面照这个顺序画。 */
    plugins: Type.Array(PluginListEntrySchema),
}, {additionalProperties: false});

export type PluginList = Static<typeof PluginListSchema>;

/**
 * 换版本之后、重启时会受阻的插件入口（plugin-install.md 输出 8.1）：版本不在别的插件 `pluginVersions` 的范围里，或经必需依赖
 * 传递受阻。只是说明，安装照常可以确认。
 */
export const BlockedPluginSchema = Type.Object({
    plugin: Type.String({minLength: 1}),
    entries: Type.Array(Type.String({minLength: 1})),
    /**
     * `version-mismatch` 版本不在范围里；`missing-service` 新版本不再在这个位置提供它要的服务；`dependency-cycle` 依赖成环；
     * `provider-blocked` 经别的插件传递受阻。
     */
    reason: Type.Union([Type.Literal("version-mismatch"), Type.Literal("missing-service"), Type.Literal("dependency-cycle"), Type.Literal("provider-blocked")]),
    /** `version-mismatch`：这个插件要求的版本范围。 */
    range: Type.Optional(Type.String({minLength: 1})),
    /** `missing-service`：不再提供的服务 id。 */
    service: Type.Optional(Type.String({minLength: 1})),
}, {additionalProperties: false});

export type BlockedPlugin = Static<typeof BlockedPluginSchema>;

/**
 * 安装前的预览（plugin-install 输出 8.1）：确认界面据此区分首次安装、升级与降级，降级时提示数据可能已被新版本迁移。
 * `installed` 是已安装的当前版本，没有安装为 null。
 */
export const InstallPreviewSchema = Type.Object({
    id: Type.String({minLength: 1}),
    version: Type.String({minLength: 1}),
    installed: Type.Union([Type.String({minLength: 1}), Type.Null()]),
    relation: Type.Union([Type.Literal("install"), Type.Literal("upgrade"), Type.Literal("downgrade")]),
    blocked: Type.Array(BlockedPluginSchema),
    /** 清单读不了、没参与预览的已安装插件。 */
    unchecked: Type.Array(Type.String({minLength: 1})),
}, {additionalProperties: false});

export type InstallPreview = Static<typeof InstallPreviewSchema>;

export const FailureDetail = Type.Object({detail: Type.String()}, {additionalProperties: false});
/** 清单或消息目录无效时另带逐条问题（`entries.ui.main：……`、`locales/en-US.json：menu.open：……`）。 */
export const ManifestFailureDetail = Type.Object({detail: Type.String(), problems: Type.Array(Type.String())}, {additionalProperties: false});

/**
 * 业务失败码与详情（plugin-install 的“失败与恢复”），按方法分组：安装与预览、启停与卸载各自只会返回自己那一组，调用方的
 * 联合类型里没有不可能的分支。
 */
export const installFailureDetails = {
    "manifest-invalid": ManifestFailureDetail,
    "catalog-invalid": ManifestFailureDetail,
    "incompatible-engine": FailureDetail,
    "already-installed": FailureDetail,
    "uninstall-pending": FailureDetail,
    "path-rejected": FailureDetail,
    "entry-missing": FailureDetail,
    "copy-failed": FailureDetail,
    "registry-failed": FailureDetail,
} as const;

export const manageFailureDetails = {
    "builtin-fixed": FailureDetail,
    "not-installed": FailureDetail,
    "uninstall-pending": FailureDetail,
    "registry-failed": FailureDetail,
} as const;

export type InstallFailureCode = keyof typeof installFailureDetails;
export type ManageFailureCode = keyof typeof manageFailureDetails;
export type PluginFailureCode = InstallFailureCode | ManageFailureCode;
