/**
 * 插件文件端点（docs/specs/runtime/plugin-code-loading.md 输出 8）：浏览器经它取第三方插件的入口代码、样式与静态资源。
 *
 * - 只服务本次启动登记的插件的当前版本目录，地址带内容摘要（`nbook/shared/plugin-files`）；摘要不是当前的为 404。
 * - 路径按原始 `pathname` 的 `/` 切段、逐段解码。明文的 `..` 与 `%2e%2e` 在到达这里之前已被 URL 规范化掉，能带进来的只有
 *   编码的分隔符（`%2F`、`%5C`）与 NUL：解码后的段含 `/`、`\`、NUL，或等于 `.`、`..`、空串时 400，不尝试纠正。
 * - 逐段 `lstat`，不跟随符号链接：安装时已拒绝链接，这里遇到也按不存在处理。
 * - 响应带 `Cross-Origin-Resource-Policy: same-origin` 与 `nosniff`：别的网页不能用 `<script>` 跨源加载来探测装了哪些插件。
 *   认证尚未实现（Spec 的 401 是 planned），服务端只监听回环地址并核对 `Host`。
 */

import {lstat} from "node:fs/promises";
import {join} from "node:path";

import type {InstalledPlugin} from "nbook/backend/plugins/installed";
import {errorResponse} from "nbook/plugins/http/backend/dispatch";
import type {HostRoute} from "nbook/plugins/http/backend/plugin";
import {PLUGIN_FILES_ROUTE} from "nbook/shared/plugin-files";

/** 分发器转交宿主路由时已去掉挂载前缀 `/api/runtime`（`dispatch.ts` 的 `forwardedRequest`）。 */
const PREFIX = "/plugins/";
const SECURITY_HEADERS = {"cross-origin-resource-policy": "same-origin", "x-content-type-options": "nosniff"} as const;

function failure(status: 400 | 404, message: string): Response {
    const response = errorResponse(status, status === 400 ? "bad-path" : "not-found", message);
    response.headers.set("cache-control", "no-store");
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
    return response;
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

/** 版本目录里的普通文件（逐段核对，不跟随符号链接）；不存在、是目录或经过链接时为 null。 */
async function regularFile(root: string, segments: ReadonlyArray<string>): Promise<string | null> {
    let path = root;
    for (const [index, segment] of segments.entries()) {
        path = join(path, segment);
        let info;
        try {
            info = await lstat(path);
        } catch {
            return null;
        }
        if (info.isSymbolicLink()) return null;
        if (index === segments.length - 1 ? !info.isFile() : !info.isDirectory()) return null;
    }
    return path;
}

export function createPluginFilesRoute(installed: ReadonlyArray<InstalledPlugin>): HostRoute {
    const byId = new Map(installed.map((plugin) => [plugin.id, plugin]));
    return {
        method: "GET",
        path: PLUGIN_FILES_ROUTE,
        handle: async (request) => {
            const pathname = new URL(request.url).pathname;
            const [pluginPart, filesPart, digestPart, ...rest] = pathname.slice(PREFIX.length).split("/");
            const head = decodeSegments([pluginPart ?? "", digestPart ?? ""]);
            const segments = decodeSegments(rest);
            if (head === null || filesPart !== "files" || segments === null || segments.length === 0) return failure(400, "插件文件的路径不合法");
            const [plugin, digest] = head as [string, string];
            const current = byId.get(plugin);
            if (current === undefined || current.digest !== digest) return failure(404, "没有这个插件文件：插件没有登记，或地址里的内容摘要不是当前的");
            const file = await regularFile(current.root, segments);
            if (file === null) return failure(404, "没有这个插件文件");
            const body = Bun.file(file);
            return new Response(body, {headers: {"content-type": body.type, "cache-control": "public, max-age=31536000, immutable", ...SECURITY_HEADERS}});
        },
    };
}
