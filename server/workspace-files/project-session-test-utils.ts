import {closeProject, openProject} from "nbook/server/workspace-files/project-session";
import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";

/**
 * 测试专用：按后台 job opener 打开 Project，会触发 openProject 的目录校验与一次性数据库初始化。
 */
export async function openProjectForTest(projectPath: string): Promise<void> {
    await openProject(resolveRuntimeWorkspaceRoot(), projectPath, {kind: "job", source: "test"});
}

/**
 * 测试专用：关闭 Project 会话并释放所有 Project 级资源。
 */
export async function closeProjectForTest(projectPath: string): Promise<void> {
    await closeProject(projectPath, "shutdown");
}
