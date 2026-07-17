import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import type {ProjectPath} from "nbook/server/workspace-files/project-path";

/**
 * Workspace文件操作目标。
 *
 * HTTP/CLI/进程Adapter必须先把逻辑Project Path与Workspace种类解析成这个类型；
 * 文件操作、tree index与History核心只消费已经确定的物理根，不再读取cwd或环境变量。
 */
export type WorkspaceFileTarget =
    | Readonly<{
        kind: "project-workspace";
        root: AbsoluteFsPath;
        projectPath: ProjectPath;
    }>
    | Readonly<{
        kind: "user-assets";
        root: AbsoluteFsPath;
    }>
    | Readonly<{
        kind: "workspace-root";
        root: AbsoluteFsPath;
    }>;

/** 返回目标在公开Workspace Interface中的逻辑标识。 */
export function workspaceFileTargetRef(target: WorkspaceFileTarget): string {
    if (target.kind === "project-workspace") {
        return target.projectPath;
    }
    return target.kind === "user-assets" ? "workspace/.nbook" : "workspace";
}
