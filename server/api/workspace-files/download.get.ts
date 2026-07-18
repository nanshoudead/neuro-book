import {createError, sendStream, setResponseHeader} from "h3";
import {
    createProjectWorkspaceZipStream,
    createWorkspaceZipStream,
    type WorkspaceArchive,
} from "nbook/server/workspace-files/workspace-archive";
import {
    USER_ASSETS_WORKSPACE_KIND,
    resolveWorkspaceFileTarget,
} from "nbook/server/workspace-files/novel-workspace";
import {assertProjectOpenForTarget} from "nbook/server/workspace-files/project-open-guard";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";

/**
 * 打包下载当前 Project Workspace；user-assets 入口打包 Workspace Root .nbook。
 */
export default defineEventHandler(async (event) => {
    const query = getQuery(event);
    const projectPath = typeof query.projectPath === "string" ? query.projectPath : undefined;
    const workspaceKind = query.workspaceKind === USER_ASSETS_WORKSPACE_KIND ? query.workspaceKind : undefined;
    if (workspaceKind !== USER_ASSETS_WORKSPACE_KIND && !projectPath?.trim()) {
        throw createError({statusCode: 400, message: "projectPath 不能为空"});
    }

    const target = await resolveWorkspaceFileTarget(runtimePathsFromEnv(), {projectPath, workspaceKind});
    assertProjectOpenForTarget(target);
    const archive = target.kind === "project-workspace"
        ? await createProjectWorkspaceZipStream(target.root)
        : await createWorkspaceZipStream(target.root);
    return sendArchive(event, archive);
});

/**
 * 发送当前挂载目标压缩包。
 */
function sendArchive(event: Parameters<typeof setResponseHeader>[0], archive: WorkspaceArchive) {
    const filename = encodeURIComponent(archive.filename);

    setResponseHeader(event, "Content-Type", "application/zip");
    setResponseHeader(event, "Content-Disposition", `attachment; filename="${archive.filename}"; filename*=UTF-8''${filename}`);
    return sendStream(event, archive.stream);
}
