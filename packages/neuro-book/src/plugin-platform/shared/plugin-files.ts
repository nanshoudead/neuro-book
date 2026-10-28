/**
 * 插件文件端点与消息目录端点的地址（docs/specs/runtime/plugin-code-loading.md 输出 8 与目录端点）：服务端的端点、浏览器引导与
 * 窗口共用，拼与解都在这里。
 *
 * 端点挂在宿主给的前缀下（平台档案的 `filesMount`）。地址带版本目录的内容摘要而不是版本号：同版本重装后摘要变了，旧地址
 * 404，浏览器不会执行缓存里的旧代码，响应因此可以长期缓存。
 */

/** 相对挂载前缀的路由；`*` 是插件目录里的相对路径。 */
export const PLUGIN_FILES_ROUTE = "/plugins/:plugin/files/:digest/*";

/** 一个插件的文件 URL 前缀，以 `/` 结尾；后面接插件目录里的相对路径（逐段编码）。 */
export function pluginFilesPrefix(mount: string, plugin: string, digest: string): string {
    return `${mount}/plugins/${encodeURIComponent(plugin)}/files/${encodeURIComponent(digest)}/`;
}

/** 插件目录里的相对路径（清单里的 `main`、`style`）拼成完整 URL；路径逐段编码。 */
export function pluginFileUrl(prefix: string, path: string): string {
    return `${prefix}${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** 逐段解码；有段解码失败或不是合法的文件名段时为 null。 */
function decodeSegments(raw: ReadonlyArray<string>): string[] | null {
    const segments: string[] = [];
    for (const part of raw) {
        let segment: string;
        try {
            segment = decodeURIComponent(part);
        } catch (error) {
            if (error instanceof URIError) return null;
            throw error;
        }
        if (segment === "" || segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\") || segment.includes("\0")) return null;
        segments.push(segment);
    }
    return segments;
}

/**
 * 解开相对挂载前缀的路径（`/plugins/<插件 id>/files/<摘要>/<相对路径>`）。按原始路径的 `/` 切段、逐段解码：明文的 `..` 与
 * `%2e%2e` 在到达这里之前已被 URL 规范化掉，能带进来的只有编码的分隔符（`%2F`、`%5C`）与 NUL，解码后的段含 `/`、`\`、NUL，
 * 或等于 `.`、`..`、空串时为 null，不尝试纠正。
 */
export function parsePluginFilePath(pathname: string): {readonly plugin: string; readonly digest: string; readonly segments: ReadonlyArray<string>} | null {
    const prefix = "/plugins/";
    if (!pathname.startsWith(prefix)) return null;
    const [pluginPart, filesPart, digestPart, ...rest] = pathname.slice(prefix.length).split("/");
    const head = decodeSegments([pluginPart ?? "", digestPart ?? ""]);
    const segments = decodeSegments(rest);
    if (head === null || filesPart !== "files" || segments === null || segments.length === 0) return null;
    return {plugin: head[0]!, digest: head[1]!, segments};
}

/**
 * 消息目录端点的路由（docs/specs/runtime/plugin-code-loading.md 的目录端点）：与插件文件端点分开，只服务清单 `l10n.locales`
 * 列出的目录文件，不经入口代码的文件路由。服务的集合也不同：所有有效安装的插件，不只是在浏览器登记的。`:file` 是
 * `<语言>.json`。
 */
export const PLUGIN_CATALOGS_ROUTE = "/plugins/:plugin/catalogs/:digest/:file";

/** 一个插件的目录 URL 前缀，以 `/` 结尾；后面接 `<语言>.json`（`pluginCatalogUrl`）。 */
export function pluginCatalogsPrefix(mount: string, plugin: string, digest: string): string {
    return `${mount}/plugins/${encodeURIComponent(plugin)}/catalogs/${encodeURIComponent(digest)}/`;
}

/** 一种语言的目录 URL。 */
export function pluginCatalogUrl(prefix: string, locale: string): string {
    return `${prefix}${encodeURIComponent(locale)}.json`;
}

/** 解开相对挂载前缀的目录路径（`/plugins/<插件 id>/catalogs/<摘要>/<语言>.json`）；形状不对时为 null。语言是否列在清单里由调用方核对。 */
export function parsePluginCatalogPath(pathname: string): {readonly plugin: string; readonly digest: string; readonly locale: string} | null {
    const prefix = "/plugins/";
    if (!pathname.startsWith(prefix)) return null;
    const parts = pathname.slice(prefix.length).split("/");
    if (parts.length !== 4 || parts[1] !== "catalogs") return null;
    const decoded = decodeSegments([parts[0] ?? "", parts[2] ?? "", parts[3] ?? ""]);
    if (decoded === null || !decoded[2]!.endsWith(".json")) return null;
    const locale = decoded[2]!.slice(0, -".json".length);
    return locale === "" ? null : {plugin: decoded[0]!, digest: decoded[1]!, locale};
}
