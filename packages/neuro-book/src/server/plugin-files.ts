/**
 * 把插件文件端点（`plugin-platform/backend/plugin-files.ts`）挂到 `nbook.http` 的宿主路由上。分发器转交宿主路由时已去掉
 * 挂载前缀 `/api/runtime`（`dispatch.ts` 的 `forwardedRequest`），与平台档案的 `filesMount` 一致。
 */

import type {DiagnosticInput} from "@notnotype/nb-runtime/diagnostics";

import type {InstalledPlugin} from "nbook/plugin-platform/backend/installed";
import {pluginFileHandler} from "nbook/plugin-platform/backend/plugin-files";
import {PLUGIN_FILES_ROUTE} from "nbook/plugin-platform/shared/plugin-files";
import type {HostRoute} from "nbook/plugins/http/backend/plugin";

export function createPluginFilesRoute(installed: ReadonlyArray<InstalledPlugin>, record: (input: DiagnosticInput) => void): HostRoute {
    const handle = pluginFileHandler(installed, record);
    return {method: "GET", path: PLUGIN_FILES_ROUTE, handle: (request) => handle(new URL(request.url).pathname)};
}
