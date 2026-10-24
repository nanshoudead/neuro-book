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

export const PluginListSchema = Type.Object({
    /** 本次启动是否为安全模式（plugin-install 输出 7）。 */
    safeMode: Type.Boolean(),
    /** 内置插件在前、第三方插件在后，各自按 id 排序；界面照这个顺序画。 */
    plugins: Type.Array(PluginListItemSchema),
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
/** 清单无效时另带出错的字段（`entries.ui.main：……`）。 */
export const ManifestFailureDetail = Type.Object({detail: Type.String(), problems: Type.Array(Type.String())}, {additionalProperties: false});

/**
 * 业务失败码与详情（plugin-install 的“失败与恢复”），按方法分组：安装与预览、启停与卸载各自只会返回自己那一组，调用方的
 * 联合类型里没有不可能的分支。
 */
export const installFailureDetails = {
    "manifest-invalid": ManifestFailureDetail,
    "incompatible-engine": FailureDetail,
    "already-installed": FailureDetail,
    "uninstall-pending": FailureDetail,
    "version-in-use": FailureDetail,
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
