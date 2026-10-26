/**
 * 平台档案：内核里凡是“这是哪个应用”的事实都从这里来，内核自己不写任何应用的名字（docs/specs/runtime/plugin-manifest.md
 * 的平台档案）。宿主在装配时给出：清单的读写经 `createManifestFormat`，运行实例经应用清单的 `platform`（插件宿主据此放宽
 * 内置插件的贡献 id 前缀，runtime/plugins.md）。
 */

/** 内核自己的命名空间：内核自带插件（诊断）用它，任何平台都保留它。 */
export const RUNTIME_PUBLISHER = "runtime";

export interface PluginPlatform {
    /** 清单 `engines` 里的键，例如 `acme`。 */
    readonly engine: string;
    /** 保留给本应用内置插件的发布者，例如 `acme`；第三方插件不能用。`runtime` 总是保留，不必写。 */
    readonly reservedPublishers: ReadonlyArray<string>;
}

/** 发布者是否保留给内置插件（或内核）。只用到保留名单：内核装配不给平台档案时按空名单判断。 */
export function isReservedPublisher(platform: Pick<PluginPlatform, "reservedPublishers">, publisher: string): boolean {
    return publisher === RUNTIME_PUBLISHER || platform.reservedPublishers.includes(publisher);
}

/**
 * id 是否属于内置插件或内核：按第一个 `.` 之前的发布者段判断。插件 id（`acme.files`）、服务 id（`acme.files/files`）、
 * 合同 id 与贡献 id 都以插件 id 开头，同一个判断都适用。
 */
export function isBuiltinId(platform: Pick<PluginPlatform, "reservedPublishers">, id: string): boolean {
    const dot = id.indexOf(".");
    return dot > 0 && isReservedPublisher(platform, id.slice(0, dot));
}
