/**
 * `nbook.plugins` 的远程服务合同（docs/specs/runtime/plugin-install.md）：列出插件，安装、启用、禁用与卸载第三方插件。
 *
 * 服务端拥有安装目录与登记表，窗口只经这份合同操作。所有操作都在下一次启动生效：插件集合在进程生命期内不变
 * （运行中即时生效归 docs/specs/runtime/plugin-hot-plug.md，尚未实现）。业务失败码照 Spec 的失败码表，窗口按码显示
 * 文字；`detail` 是补充说明，文件系统错误只带错误码（例如 `EACCES`），完整错误记在服务端诊断里。
 */

import {defineRemoteService} from "@notnotype/nb-runtime/remote";
import type {RemoteClient} from "@notnotype/nb-runtime/remote";
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

/** 本次启动没有登记的原因（plugin-install 输出 1、6、7）：清单无效、不兼容、安全模式。 */
export const NotLoadedSchema = Type.Object({
    code: Type.Union([Type.Literal("manifest-invalid"), Type.Literal("incompatible-engine"), Type.Literal("safe-mode")]),
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

const ListSchema = Type.Object({
    /** 本次启动是否为安全模式（plugin-install 输出 7）。 */
    safeMode: Type.Boolean(),
    /** 内置插件在前、第三方插件在后，各自按 id 排序；界面照这个顺序画。 */
    plugins: Type.Array(PluginListItemSchema),
}, {additionalProperties: false});

export type PluginList = Static<typeof ListSchema>;

/**
 * 安装前的预览（plugin-install 输出 8.1）：确认界面据此区分首次安装、升级与降级，降级时提示数据可能已被新版本迁移。
 * `installed` 是已安装的当前版本，没有安装为 null。
 */
/**
 * 换版本之后、重启时会受阻的插件入口（plugin-install.md 输出 8.1）：版本不在别的插件 `pluginVersions` 的范围里，或经必需依赖
 * 传递受阻。只是说明，安装照常可以确认。
 */
const BlockedPluginSchema = Type.Object({
    plugin: Type.String({minLength: 1}),
    entries: Type.Array(Type.String({minLength: 1})),
    reason: Type.Union([Type.Literal("version-mismatch"), Type.Literal("provider-blocked")]),
    /** `version-mismatch`：这个插件要求的版本范围。 */
    range: Type.Optional(Type.String({minLength: 1})),
}, {additionalProperties: false});

export type BlockedPlugin = Static<typeof BlockedPluginSchema>;

const InstallPreviewSchema = Type.Object({
    id: Type.String({minLength: 1}),
    version: Type.String({minLength: 1}),
    installed: Type.Union([Type.String({minLength: 1}), Type.Null()]),
    relation: Type.Union([Type.Literal("install"), Type.Literal("upgrade"), Type.Literal("downgrade")]),
    blocked: Type.Array(BlockedPluginSchema),
    /** 清单读不了、没参与预览的已安装插件。 */
    unchecked: Type.Array(Type.String({minLength: 1})),
}, {additionalProperties: false});

export type InstallPreview = Static<typeof InstallPreviewSchema>;

const IdInput = Type.Object({id: Type.String({minLength: 1})}, {additionalProperties: false});
const PathInput = Type.Object({path: Type.String({minLength: 1})}, {additionalProperties: false});
const One = Type.Object({plugin: PluginListItemSchema}, {additionalProperties: false});

const Detail = Type.Object({detail: Type.String()}, {additionalProperties: false});
/** 清单无效时另带出错的字段（`entries.ui.main：……`）。 */
const ManifestDetail = Type.Object({detail: Type.String(), problems: Type.Array(Type.String())}, {additionalProperties: false});

/** 每个业务失败码的详情（plugin-install 的“失败与恢复”）。 */
const errors = {
    "manifest-invalid": ManifestDetail,
    "reserved-id": Detail,
    "incompatible-engine": Detail,
    "already-installed": Detail,
    "uninstall-pending": Detail,
    "path-rejected": Detail,
    "entry-missing": Detail,
    "copy-failed": Detail,
    "not-installed": Detail,
    "builtin-fixed": Detail,
    "registry-failed": Detail,
} as const;

export type PluginFailureCode = keyof typeof errors;

export const pluginsRegistryContract = defineRemoteService({
    id: "nbook.plugins/registry",
    // 版本 2：安装预览带重启后受阻的插件。
    version: 2,
    provider: "server",
    callers: ["browser"],
    methods: {
        list: {input: Type.Object({}, {additionalProperties: false}), output: ListSchema, effect: "read", errors: {"registry-failed": Detail}},
        inspect: {input: PathInput, output: InstallPreviewSchema, effect: "read", errors},
        install: {input: PathInput, output: One, effect: "write", errors},
        enable: {input: IdInput, output: One, effect: "write", errors},
        disable: {input: IdInput, output: One, effect: "write", errors},
        uninstall: {input: IdInput, output: One, effect: "write", errors},
    },
});

/** 插件页用到的合同方法（浏览器入口经 `context.remote.use` 取得的客户端满足它）。 */
export type PluginsRegistry = Pick<RemoteClient<typeof pluginsRegistryContract>, "list" | "inspect" | "install" | "enable" | "disable" | "uninstall">;
