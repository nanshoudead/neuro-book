/**
 * 清单格式：一个平台的清单怎么读、怎么生成、哪些 id 属于内置。宿主在启动时按自己的平台档案建一次，安装、盘点、装载、
 * 构建预设与作者命令都用同一个对象，id 规则与内置判断只有这一份。
 */

import {isBuiltinId, isReservedPublisher} from "../plugins/plugins";
import type {PluginPlatform} from "../plugins/plugins";

import {buildManifest} from "./build";
import type {ManifestBuildResult, ManifestSource} from "./build";
import {readManifest} from "./read";
import {manifestSchema} from "./schema";
import type {ManifestReadResult, VersionSyntax} from "./schema";

export interface ManifestFormatOptions {
    /** 内置插件：允许保留发布者、`pluginVersions` 里的内置 id 与贡献点的 `validate` 函数。 */
    readonly builtin?: boolean;
}

export interface ManifestFormat {
    readonly platform: PluginPlatform;
    /** 读一份 `package.json` 的内容；不抛错，问题按字段路径排序。 */
    read(value: unknown, options?: ManifestFormatOptions): ManifestReadResult;
    /** 由代码定义生成清单，并按 `read` 校验过。 */
    build(source: ManifestSource, options?: ManifestFormatOptions): ManifestBuildResult;
    /** 发布者是否保留给内置插件或内核。 */
    isReservedPublisher(publisher: string): boolean;
    /** id（插件、服务、合同或贡献的 id）是否属于内置插件或内核。 */
    isBuiltinId(id: string): boolean;
}

export function createManifestFormat(platform: PluginPlatform, versions: VersionSyntax): ManifestFormat {
    const schema = manifestSchema(platform.engine);
    const context = (options: ManifestFormatOptions | undefined) => ({platform, versions, schema, builtin: options?.builtin === true});
    return {
        platform,
        read: (value, options) => readManifest(value, context(options)),
        build: (source, options) => buildManifest(source, context(options)),
        isReservedPublisher: (publisher) => isReservedPublisher(platform, publisher),
        isBuiltinId: (id) => isBuiltinId(platform, id),
    };
}
