import fs from "node:fs/promises";
import {consola} from "consola";
import {useAgentHarness} from "nbook/server/agent/http";
import {closeAgentSqliteClient} from "nbook/server/agent/tools/sql-tool";
import {plotFacade} from "nbook/server/plot";
import {invalidateNovelListCache} from "nbook/server/utils/novel-chapter";
import {closeWorkspaceTreeIndex} from "nbook/server/workspace-files/project-workspace-index";
import {
    assertProjectWorkspaceDirectory,
    resolveProjectAbsolutePath,
} from "nbook/server/workspace-files/project-workspace";

type ProjectWorkspaceDeleteOptions = {
    /**
     * 归档与 Project 绑定的 Agent sessions。测试可注入临时 harness，运行时默认使用全局 harness。
     */
    archiveProjectSessions?: (projectPath: string, reason: string) => Promise<unknown>;
};

/**
 * 删除 Project Workspace。删除前统一释放当前进程里会占用 Project 目录的资源。
 */
export async function deleteProjectWorkspace(projectPath: string, options: ProjectWorkspaceDeleteOptions = {}): Promise<void> {
    const normalizedProjectPath = await assertProjectWorkspaceDirectory(projectPath);
    const projectRoot = resolveProjectAbsolutePath(normalizedProjectPath);
    const archiveProjectSessions = options.archiveProjectSessions
        ?? ((targetProjectPath, reason) => useAgentHarness().archiveSessionsByProjectPath(targetProjectPath, reason));

    await plotFacade.closeProject(normalizedProjectPath);
    await closeAgentSqliteClient(normalizedProjectPath);
    await closeWorkspaceTreeIndex(projectRoot);
    await fs.rm(projectRoot, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
    });
    try {
        await archiveProjectSessions(normalizedProjectPath, "project.deleted");
    } catch (error) {
        consola.warn({projectPath: normalizedProjectPath, error}, "删除 Project Workspace 后归档 Agent sessions 失败");
    } finally {
        invalidateNovelListCache();
    }
}
