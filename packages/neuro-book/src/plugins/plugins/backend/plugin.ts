/**
 * `nbook.plugins` 的服务端入口：把宿主的插件管理（`nbook/backend/plugins/inventory`）交给窗口，作为远程服务。
 *
 * 安装目录、登记表与本次启动的插件集合都归服务端宿主：宿主在装配插件之前就要确定集合，所以由它创建插件管理并作为宿主
 * 能力提供，本入口只做合同的输入输出与失败码映射。
 */

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {provideRemote} from "@notnotype/nb-runtime/remote";

import {pluginInventoryKey} from "nbook/backend/plugins/inventory";
import type {InventoryFailure} from "nbook/backend/plugins/inventory";

import {descriptor} from "../plugin";
import {pluginsRegistryContract} from "../shared/contracts";

/** 清单无效时带上出错的字段，其余码只带说明。 */
function refused(failure: InventoryFailure) {
    return failure.code === "manifest-invalid"
        ? {ok: false as const, code: failure.code, detail: {detail: failure.detail, problems: [...(failure.problems ?? [])]}}
        : {ok: false as const, code: failure.code, detail: {detail: failure.detail}};
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
                            return preview.ok ? {ok: true as const, value: preview.value} : refused(preview);
                        },
                        install: async ({path}) => {
                            const installed = await inventory.install(path);
                            return installed.ok ? {ok: true as const, value: {plugin: installed.value}} : refused(installed);
                        },
                        enable: async ({id}) => {
                            const enabled = await inventory.setEnabled(id, true);
                            return enabled.ok ? {ok: true as const, value: {plugin: enabled.value}} : refused(enabled);
                        },
                        disable: async ({id}) => {
                            const disabled = await inventory.setEnabled(id, false);
                            return disabled.ok ? {ok: true as const, value: {plugin: disabled.value}} : refused(disabled);
                        },
                        uninstall: async ({id}) => {
                            const removed = await inventory.uninstall(id);
                            return removed.ok ? {ok: true as const, value: {plugin: removed.value}} : refused(removed);
                        },
                    },
                }))],
            };
        },
    })],
};
