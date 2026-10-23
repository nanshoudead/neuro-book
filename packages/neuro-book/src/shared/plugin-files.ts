/**
 * 插件文件端点的地址（docs/specs/runtime/plugin-code-loading.md 输出 8）：服务端的端点与浏览器引导共用。
 *
 * 挂在宿主路由 `/api/runtime/` 下（`/api/<段>/` 的其它段按插件 id 分发给插件自己的路由）。地址带版本目录的内容摘要而不是
 * 版本号：同版本重装后摘要变了，旧地址 404，浏览器不会执行缓存里的旧代码，响应因此可以长期缓存。
 */

/** 相对 `/api/runtime/` 的路由；`*` 是插件目录里的相对路径。 */
export const PLUGIN_FILES_ROUTE = "/plugins/:plugin/files/:digest/*";

/** 一个插件的文件 URL 前缀，以 `/` 结尾；后面接插件目录里的相对路径（逐段编码）。 */
export function pluginFilesPrefix(plugin: string, digest: string): string {
    return `/api/runtime/plugins/${encodeURIComponent(plugin)}/files/${encodeURIComponent(digest)}/`;
}

/** 插件目录里的相对路径（清单里的 `main`、`style`）拼成完整 URL；路径逐段编码。 */
export function pluginFileUrl(prefix: string, path: string): string {
    return `${prefix}${path.split("/").map(encodeURIComponent).join("/")}`;
}
