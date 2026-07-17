import path from "node:path";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import type {WorkspaceRootRef} from "nbook/server/workspace-files/workspace-root-ref";
import {createFileScope, type FileScope} from "nbook/server/workspace-files/file-scope";
import {normalizeProjectPath} from "nbook/server/workspace-files/project-path";
import {
    WORKSPACE_CONTAINER_ROOT,
    WORKSPACE_NBOOK_ROOT,
} from "nbook/server/workspace-files/workspace-root-ref";

/**
 * 将 session 的逻辑 Workspace Root 与 Project Path 投影为本次运行的 File Scope。
 *
 * 这里只选择物理 cwd 和 managed Workspace Root 命名空间；实际文件地址统一交给
 * `resolveFileAddress()`，不在 Agent 层实现第二套路径语法。
 */
export function resolveSessionFileScope(input: {
    workspaceRootRef: WorkspaceRootRef;
    workspaceFsRoot: AbsoluteFsPath;
    projectPath?: string;
}): FileScope {
    if (input.workspaceRootRef === WORKSPACE_CONTAINER_ROOT) {
        if (!input.projectPath) {
            return createFileScope({kind: "workspace", workspaceRoot: input.workspaceFsRoot});
        }
        if (path.isAbsolute(input.projectPath)) {
            throw new Error("managed Workspace Root不能绑定外部绝对Project Workspace");
        }
        return createFileScope({
            kind: "managed-project",
            workspaceRoot: input.workspaceFsRoot,
            projectPath: normalizeProjectPath(input.projectPath),
        });
    }

    if (input.workspaceRootRef === WORKSPACE_NBOOK_ROOT) {
        if (input.projectPath) {
            throw new Error("user-assets File Scope不能绑定Project Path");
        }
        return createFileScope({kind: "user-assets", root: input.workspaceFsRoot});
    }

    if (input.projectPath) {
        if (!path.isAbsolute(input.projectPath) || path.relative(input.workspaceRootRef, input.projectPath) !== "") {
            throw new Error("外部Project Workspace引用与Project Path不一致");
        }
    }
    return createFileScope({kind: "external-project", root: input.workspaceFsRoot});
}
