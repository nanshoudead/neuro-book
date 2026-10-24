/**
 * 本次启动登记的一个第三方插件装在哪里、清单是什么：服务端在启动时定下（`startup.ts`），经 IPC 交给项目子进程，装载
 * 入口代码与文件端点都用它。清单交的是 `package.json` 的原始内容，接收方各自用同一个 `readPluginManifest` 再读一遍。
 */

import type {PluginManifest} from "@notnotype/nb-runtime/plugin-manifest";
import {Type} from "typebox";
import type {Static} from "typebox";

import {manifestFormat} from "nbook/plugin-platform-profile";

export const InstalledPluginSchema = Type.Object({
    id: Type.String({minLength: 1}),
    version: Type.String({minLength: 1}),
    /** 版本目录的绝对路径。服务端内部路径，不发给浏览器。 */
    root: Type.String({minLength: 1}),
    /** 版本目录全部文件的内容摘要：文件 URL 与浏览器引导的修订号都并入它，同版本重装也会变。 */
    digest: Type.String({minLength: 1}),
    /** `package.json` 的原始内容，服务端已校验过。 */
    manifest: Type.Unknown(),
}, {additionalProperties: false});

export type InstalledPlugin = Static<typeof InstalledPluginSchema>;

/** 读出清单；不合格（服务端与接收方的校验规则不一致，或内容被改过）时给出原因。 */
export function manifestOfInstalled(plugin: InstalledPlugin): {readonly ok: true; readonly manifest: PluginManifest} | {readonly ok: false; readonly detail: string} {
    const read = manifestFormat.read(plugin.manifest);
    if (read.status !== "valid") return {ok: false, detail: read.problems.map((problem) => `${problem.path}：${problem.message}`).join("；")};
    if (read.manifest.id !== plugin.id || read.manifest.version !== plugin.version) return {ok: false, detail: `清单是 ${read.manifest.id}@${read.manifest.version}`};
    return {ok: true, manifest: read.manifest};
}
