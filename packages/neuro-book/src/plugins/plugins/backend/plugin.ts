/**
 * `nbook.plugins` 的服务端入口：把宿主的插件管理（`nbook/plugin-platform/backend/inventory`）交给窗口，作为远程服务。
 *
 * 安装目录、登记表与本次启动的插件集合都归服务端宿主：宿主在装配插件之前就要确定集合，所以由它创建插件管理并作为宿主
 * 能力提供，本入口只做合同的输入输出与失败码映射。
 */

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {provideRemote} from "@notnotype/nb-runtime/remote";

import {pluginInventoryKey} from "nbook/plugin-platform/backend/inventory";
import type {InventoryFailure} from "nbook/plugin-platform/backend/inventory";
import type {InstallFailureCode, ManageFailureCode} from "nbook/plugin-platform/shared/types";

import {descriptor} from "../plugin";
import {pluginsRegistryContract} from "../shared/contracts";

/** 安装与预览的失败：清单无效时带上出错的字段，其余码只带说明。 */
function refusedInstall(failure: InventoryFailure<InstallFailureCode>) {
    return failure.code === "manifest-invalid"
        ? {ok: false as const, code: failure.code, detail: {detail: failure.detail, problems: [...(failure.problems ?? [])]}}
        : {ok: false as const, code: failure.code, detail: {detail: failure.detail}};
}

/** 启停与卸载的失败：都只带说明。 */
function refusedManage(failure: InventoryFailure<ManageFailureCode>) {
    return {ok: false as const, code: failure.code, detail: {detail: failure.detail}};
}

export const pluginsBackendPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [defineEntry({
        id: "server",
        location: "server",
        // 依赖诊断：诊断先于其余插件激活（docs/specs/runtime/server-host.md）。
        dependencies: [{key: diagnosticsKey}, {key: pluginInventoryKey}],
        remoteProvides: [pluginsRegistryContract],
        activate: (context) => {
            const inventory = context.services.require(pluginInventoryKey);
            return {
                remote: [provideRemote(pluginsRegistryContract, () => ({
                    methods: {
                        list: async () => {
                            const listed = await inventory.list();
                            return listed.ok ? {ok: true as const, value: listed.value} : {ok: false as const, code: "registry-failed" as const, detail: {detail: listed.detail}};
                        },
                        inspect: async ({path}) => {
                            const preview = await inventory.inspect(path);
                            return preview.ok ? {ok: true as const, value: preview.value} : refusedInstall(preview);
                        },
                        install: async ({path}) => {
                            const installed = await inventory.install(path);
                            return installed.ok ? {ok: true as const, value: {plugin: installed.value}} : refusedInstall(installed);
                        },
                        enable: async ({id}) => {
                            const enabled = await inventory.setEnabled(id, true);
                            return enabled.ok ? {ok: true as const, value: {plugin: enabled.value}} : refusedManage(enabled);
                        },
                        disable: async ({id}) => {
                            const disabled = await inventory.setEnabled(id, false);
                            return disabled.ok ? {ok: true as const, value: {plugin: disabled.value}} : refusedManage(disabled);
                        },
                        uninstall: async ({id}) => {
                            const removed = await inventory.uninstall(id);
                            return removed.ok ? {ok: true as const, value: {plugin: removed.value}} : refusedManage(removed);
                        },
                    },
                }))],
            };
        },
    })],
};
