/**
 * 升级预览（docs/specs/runtime/plugin-install.md 输出 8.1）：换一个版本之后，重启时会多出哪些受阻的插件入口。只读：扫一遍
 * 安装目录里重启后生效的清单，用内核的同一份受阻推导，不写登记表、不复制。
 */

import {join} from "node:path";

import type {PluginManifest} from "@notnotype/nb-runtime/plugin-manifest";
import {previewBlocked} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {defineServiceKey} from "@notnotype/nb-runtime/services";

import type {PlatformProfile} from "nbook/plugin-platform/shared/profile";
import type {BlockedPlugin} from "nbook/plugin-platform/shared/types";
import {pluginVersionSatisfies} from "nbook/plugin-platform/shared/versions";

import {readRecord} from "./record";
import {installedManifest} from "./version-dir";

/** 预览给出的原因：别的位置提供（`location-mismatch`）对用户来说也是“这里不再提供”；提供方失败在预览里推不出来。 */
function previewReason(reason: string): BlockedPlugin["reason"] {
    switch (reason) {
        case "version-mismatch":
        case "dependency-cycle":
            return reason;
        case "missing-service":
        case "location-mismatch":
            return "missing-service";
        default:
            return "provider-blocked";
    }
}

/** 同一插件几行原因的先后，越小越具体：版本不符与服务不再提供能直接指出原因，经别的插件传递受阻只说明“依赖的插件不可用”。 */
const REASON_RANK: Readonly<Record<BlockedPlugin["reason"], number>> = {"version-mismatch": 0, "missing-service": 1, "dependency-cycle": 2, "provider-blocked": 3};

/** 预览用的定义：只有推导受阻要的东西（版本、版本要求、依赖与提供项），不会登记、不会激活。 */
function previewDefinition(manifest: PluginManifest): PluginDefinition {
    return {
        id: manifest.id,
        version: manifest.version,
        pluginVersions: manifest.pluginVersions,
        entries: manifest.entries.map((entry) => ({
            id: entry.id,
            location: entry.location,
            provides: entry.provides.map((id) => defineServiceKey(id)),
            dependencies: [...entry.requires.map((id) => ({key: defineServiceKey(id)})), ...entry.optional.map((id) => ({key: defineServiceKey(id), required: false}))],
            activate: () => ({}),
        })),
    };
}

/** 推导结果的键是 `<插件 id>/<入口 id>`；插件 id 不含 `/`。 */
function splitEntry(key: string): [string, string] {
    const slash = key.indexOf("/");
    return [key.slice(0, slash), key.slice(slash + 1)];
}


/**
 * 把 `next` 换进重启后生效的集合（启用的插件，有待切换版本的取那个版本），用内核的同一份推导与同一个 `satisfies`，
 * 列出比换之前多出来的受阻入口。读不了清单的插件不参与，列进 `unchecked`，预览照常给出。
 */
export async function blockedAfter(root: string, profile: PlatformProfile, next: PluginManifest): Promise<{readonly blocked: BlockedPlugin[]; readonly unchecked: string[]}> {
    const record = await readRecord(root, profile);
    if (!record.ok) return {blocked: [], unchecked: []};
    // 禁用的插件升级后仍是禁用的，重启后不登记，依赖它的入口在升级前后一样受阻：没有新增的受阻。
    if (record.record.plugins[next.id]?.state === "disabled") return {blocked: [], unchecked: []};
    const current: PluginManifest[] = [];
    const unchecked: string[] = [];
    for (const [id, entry] of Object.entries(record.record.plugins)) {
        if (entry.state !== "enabled") continue;
        const version = entry.pendingVersion ?? entry.version;
        const read = await installedManifest(join(root, id, version), profile.format);
        // 与启动时一样核对目录里的清单就是登记的那个插件与版本：对不上的重启后不登记，不能参与推导。
        if (read.ok && read.manifest.id === id && read.manifest.version === version) current.push(read.manifest);
        else if (id !== next.id) unchecked.push(id);
    }
    const after = [...current.filter((item) => item.id !== next.id), next];
    const locations = [...new Set([...current, next].flatMap((item) => item.entries.map((entry) => entry.location)))];
    // 按插件与原因分组：同一插件的几个入口原因不同时各占一行，范围与服务 id 只跟着它自己的入口。
    const byPlugin = new Map<string, BlockedPlugin>();
    for (const location of locations) {
        const before = previewBlocked(current.map(previewDefinition), location, pluginVersionSatisfies);
        for (const [key, blocked] of previewBlocked(after.map(previewDefinition), location, pluginVersionSatisfies)) {
            if (blocked === null || (before.get(key) ?? null) !== null) continue;
            const [plugin, entry] = splitEntry(key);
            const reason = previewReason(blocked.reason);
            const detail: {readonly range?: string; readonly service?: string} = reason === "version-mismatch" && blocked.reason === "version-mismatch" ? {range: blocked.range} : reason === "missing-service" ? {service: blocked.key} : {};
            const group = `${plugin}\n${reason}\n${detail.range ?? detail.service ?? ""}`;
            const known = byPlugin.get(group);
            byPlugin.set(group, known === undefined ? {plugin, entries: [entry], reason, ...detail} : {...known, entries: [...known.entries, entry]});
        }
    }
    const order = (item: BlockedPlugin): string => `${item.plugin}\n${String(REASON_RANK[item.reason])}`;
    return {blocked: [...byPlugin.values()].sort((left, right) => (order(left) < order(right) ? -1 : 1)), unchecked: unchecked.sort()};
}
