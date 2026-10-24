/**
 * 第三方插件的样式表（docs/specs/runtime/plugin-code-loading.md 的样式）：窗口登记插件时就加入，清单里的声明（例如设置分区
 * 的图标）在入口激活前就要显示。加载失败只记诊断。
 */

import type {DiagnosticInput} from "@notnotype/nb-runtime/diagnostics";
import type {PluginManifest} from "@notnotype/nb-runtime/plugin-manifest";

import {pluginFileUrl} from "nbook/plugin-platform/shared/plugin-files";

import type {PluginDocument, PluginLink} from "./plugin-code";

export interface PluginStyleOptions {
    /** `<link>` 上标记插件 id 的 dataset 名（平台档案的 `styleDataset`）。 */
    readonly dataset: string;
    readonly record: (input: DiagnosticInput) => void;
}

/** 给每个带样式的插件加一个 `<link>`；没有页面文档时什么也不做。返回加上的链接，窗口结束时移除。 */
export function attachPluginStyles(plugins: ReadonlyArray<{readonly id: string; readonly manifest: PluginManifest; readonly files: string}>, document: PluginDocument | undefined, options: PluginStyleOptions): PluginLink[] {
    const links: PluginLink[] = [];
    if (document === undefined) return links;
    for (const plugin of plugins) {
        if (plugin.manifest.style === null) continue;
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = pluginFileUrl(plugin.files, plugin.manifest.style);
        link.dataset[options.dataset] = plugin.id;
        link.addEventListener("error", () => options.record({level: "warn", event: "browser-host.plugin.style-failed", message: `第三方插件 ${plugin.id} 的样式表加载失败`, data: {plugin: plugin.id, url: link.href}}));
        document.head.append(link);
        links.push(link);
    }
    return links;
}
