import {isAbsolute, join} from "node:path";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";

export const WORKSPACE_CONTAINER_ROOT = "workspace";
export const WORKSPACE_NBOOK_ROOT = "workspace/.nbook";

/** 可持久化Workspace Root逻辑引用；绝对值表示明确外部Project Workspace。 */
export type WorkspaceRootRef = typeof WORKSPACE_CONTAINER_ROOT | typeof WORKSPACE_NBOOK_ROOT | AbsoluteFsPath;

/**
 * 校验并规范化Workspace Root逻辑引用。
 *
 * 未指定、`workspace`或与当前Project Path相同都归一为Workspace Root；任意其他
 * 相对路径没有稳定的跨安装语义，因此直接拒绝。
 */
export function normalizeWorkspaceRootRef(input: string | undefined, projectPath?: string): WorkspaceRootRef {
    const normalized = normalizeSlashPath(input);
    const normalizedProjectPath = normalizeSlashPath(projectPath);
    if (!normalized && normalizedProjectPath && isAbsolute(normalizedProjectPath)) {
        return absoluteFsPath(normalizedProjectPath);
    }
    const matchesManagedProject = Boolean(normalizedProjectPath
        && !isAbsolute(normalizedProjectPath)
        && normalized === normalizedProjectPath);
    if (!normalized || normalized === WORKSPACE_CONTAINER_ROOT || matchesManagedProject) {
        return WORKSPACE_CONTAINER_ROOT;
    }
    if (normalized === WORKSPACE_NBOOK_ROOT) {
        return WORKSPACE_NBOOK_ROOT;
    }
    if (isAbsolute(normalized)) {
        return absoluteFsPath(normalized);
    }
    throw new Error(`workspaceRoot只支持workspace、workspace/.nbook或绝对路径，收到：${normalized}`);
}

/**
 * 将逻辑引用解析为明确managed Workspace Root下的物理根。
 *
 * 本函数不读取cwd、State Root或进程环境；调用方必须在生产/测试Adapter先决定
 * managed Workspace Root。
 */
export function resolveWorkspaceRootRef(
    ref: WorkspaceRootRef,
    managedWorkspaceRoot: AbsoluteFsPath,
): AbsoluteFsPath {
    if (ref === WORKSPACE_CONTAINER_ROOT) {
        return managedWorkspaceRoot;
    }
    if (ref === WORKSPACE_NBOOK_ROOT) {
        return absoluteFsPath(join(managedWorkspaceRoot, ".nbook"));
    }
    return absoluteFsPath(ref);
}

/** 统一逻辑路径分隔符并移除尾斜杠。 */
function normalizeSlashPath(input: string | undefined): string {
    return input?.trim().replaceAll("\\", "/").replace(/\/+$/g, "") ?? "";
}
