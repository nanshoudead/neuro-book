import path from "node:path";
import {
    absoluteFsPath,
    resolveContainedFilePath,
    type AbsoluteFsPath,
} from "nbook/server/runtime/paths/file-path";

declare const projectPathBrand: unique symbol;

/** 公开 Project Workspace 定位符，固定为 `workspace/<project-slug>`。 */
export type ProjectPath = string & {readonly [projectPathBrand]: "project-path"};

/** Project Path 不符合公开路径合同时抛出的领域错误。 */
export class InvalidProjectPathError extends Error {
    readonly statusCode = 400;

    constructor(message: string) {
        super(message);
        this.name = "InvalidProjectPathError";
    }
}

/**
 * 校验并规范化 Project Path。
 *
 * Project Path 是领域定位符，不是文件工具相对路径；它只能指向 Workspace Root
 * 下的一级 Project Workspace。
 */
export function normalizeProjectPath(input: string): ProjectPath {
    const normalized = input.replaceAll("\\", "/");
    const prefix = "workspace/";
    if (!normalized.startsWith(prefix)) {
        throw new InvalidProjectPathError("projectPath 必须形如 workspace/<project>");
    }
    const slug = normalized.slice(prefix.length);
    if (!slug || slug.includes("/")) {
        throw new InvalidProjectPathError("projectPath 必须形如 workspace/<project>");
    }
    if (slug === "." || slug === "..") {
        throw new InvalidProjectPathError("project slug 不能是 . 或 ..");
    }
    if (/[<>:"|?*\u0000-\u001F\u007F]/u.test(slug)) {
        throw new InvalidProjectPathError("project slug 包含跨平台文件名不允许的字符");
    }
    if (/[. ]$/u.test(slug)) {
        throw new InvalidProjectPathError("project slug 不能以点或空格结尾");
    }
    if (/^(?:con|prn|aux|nul|com[1-9\u00B9\u00B2\u00B3]|lpt[1-9\u00B9\u00B2\u00B3])(?:\..*)?$/iu.test(slug)) {
        throw new InvalidProjectPathError("project slug 不能使用Windows保留设备名");
    }
    return normalized as ProjectPath;
}

/** 返回 Project Path 中唯一的 Project Slug。 */
export function projectSlug(projectPath: ProjectPath): string {
    return projectPath.slice("workspace/".length);
}

/**
 * 将 managed Project Path 解析到明确 Workspace Root 内。
 *
 * 本函数不读取 cwd、State Root 或进程环境；调用方必须先决定实际 Workspace Root。
 */
export function resolveProjectWorkspaceRoot(
    workspaceRoot: AbsoluteFsPath,
    projectPath: ProjectPath,
): AbsoluteFsPath {
    return resolveContainedFilePath(workspaceRoot, projectSlug(projectPath));
}

/**
 * 在DTO/前端字符串seam解析Project Workspace物理根。
 *
 * managed值必须是Project Path；绝对值明确表示外部Project Workspace。两者都不
 * 依赖cwd，managed值只相对调用方给出的Workspace Root解析。
 */
export function resolveProjectWorkspaceInput(
    workspaceRoot: AbsoluteFsPath,
    input: string,
): AbsoluteFsPath {
    const normalized = input.trim();
    return path.isAbsolute(normalized)
        ? absoluteFsPath(normalized)
        : resolveProjectWorkspaceRoot(workspaceRoot, normalizeProjectPath(normalized));
}
