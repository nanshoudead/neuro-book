import {assertProjectOpen} from "nbook/server/workspace-files/project-session";
import {
    assertRealPathContained,
    type AbsoluteFsPath,
} from "nbook/server/runtime/paths/file-path";
import {
    resolveFileAddress,
    type FileScope,
    type ResolvedFileAddress,
} from "nbook/server/workspace-files/file-scope";
import {resolveProjectWorkspaceRoot} from "nbook/server/workspace-files/project-path";

/** Agent 文件操作的能力种类；所有数据面操作都需要同一份授权结果。 */
export type AuthorizedFileOperation = "read" | "write" | "edit" | "apply_patch";

/** 已完成领域解析、Project 生命周期和真实路径检查的文件操作目标。 */
export type AuthorizedFileTarget = Readonly<{
    operation: AuthorizedFileOperation;
    address: ResolvedFileAddress;
    containmentRoot: AbsoluteFsPath;
}>;

/**
 * 授权一次文件操作。
 *
 * 调用方只提供 File Scope 和用户地址；本 Module 负责 Project open gate、规范化
 * File Address 以及目标/最近已存在父目录的真实路径 containment。写入不存在的
 * 文件时，检查会落到最近已存在父目录，因此不会为了授权而隐式 mkdir。
 */
export async function authorizeFileOperation(
    scope: FileScope,
    inputPath: string,
    operation: AuthorizedFileOperation,
): Promise<AuthorizedFileTarget> {
    if (scope.kind === "managed-project") {
        assertProjectOpen(scope.currentProjectPath);
    }
    const address = resolveFileAddress(scope, inputPath);
    if (address.kind === "project-address") {
        assertProjectOpen(address.projectPath);
    }
    if (scope.kind === "managed-project" && address.kind === "absolute" && address.projectPath === null) {
        throw new Error("managed Project中的绝对路径只能指向当前Project Workspace；跨Project请使用workspace/<project>/<relative-path>");
    }
    const containmentRoot = address.kind === "project-address"
        ? resolveProjectWorkspaceRoot(scope.workspaceRoot!, address.projectPath)
        : scope.root;
    await assertRealPathContained(containmentRoot, address.absolutePath);
    return {operation, address, containmentRoot};
}

/**
 * 授权受信任进程使用当前 File Scope 根作为 cwd。
 *
 * 本接口只验证 managed Project 已打开且 cwd 本身可信；它不限制命令随后可访问的
 * 文件。bash 是完整 Shell，明确不属于文件级 Authorized File Operation 承诺。
 */
export async function authorizeProcessCwd(
    scope: FileScope,
): Promise<Readonly<{root: AbsoluteFsPath}>> {
    if (scope.kind === "managed-project") {
        assertProjectOpen(scope.currentProjectPath);
    }
    await assertRealPathContained(scope.root, scope.root);
    return {root: scope.root};
}
