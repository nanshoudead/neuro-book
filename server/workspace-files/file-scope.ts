import path from "node:path";
import {
    absoluteFsPath,
    relativeFilePathInside,
    resolveContainedFilePath,
    type AbsoluteFsPath,
} from "nbook/server/runtime/paths/file-path";
import {
    normalizeProjectPath,
    projectSlug,
    resolveProjectWorkspaceRoot,
    type ProjectPath,
} from "nbook/server/workspace-files/project-path";

/** managed Project Workspace 使用的 File Scope。 */
export type ManagedProjectFileScope = Readonly<{
    kind: "managed-project";
    root: AbsoluteFsPath;
    workspaceRoot: AbsoluteFsPath;
    currentProjectPath: ProjectPath;
}>;

/** 未绑定具体 Project Workspace 的 Workspace Root File Scope。 */
export type WorkspaceFileScope = Readonly<{
    kind: "workspace";
    root: AbsoluteFsPath;
    workspaceRoot: AbsoluteFsPath;
    currentProjectPath: null;
}>;

/** Workspace Root `.nbook` 的 user-assets File Scope。 */
export type UserAssetsFileScope = Readonly<{
    kind: "user-assets";
    root: AbsoluteFsPath;
    workspaceRoot: null;
    currentProjectPath: null;
}>;

/** 用户明确选择的外部 Project Workspace File Scope。 */
export type ExternalProjectFileScope = Readonly<{
    kind: "external-project";
    root: AbsoluteFsPath;
    workspaceRoot: null;
    currentProjectPath: AbsoluteFsPath;
}>;

/**
 * 文件工具一次执行使用的物理范围。
 *
 * discriminated union 只允许四种真实运行形态，不能任意拼装 managed Workspace
 * Root、外部 Project Workspace 和当前 Project Path。
 */
export type FileScope =
    | ManagedProjectFileScope
    | WorkspaceFileScope
    | UserAssetsFileScope
    | ExternalProjectFileScope;

/** 创建 File Scope 所需的已规范化领域位置。 */
export type FileScopeInput =
    | Readonly<{kind: "managed-project"; workspaceRoot: AbsoluteFsPath; projectPath: ProjectPath}>
    | Readonly<{kind: "workspace"; workspaceRoot: AbsoluteFsPath}>
    | Readonly<{kind: "user-assets"; root: AbsoluteFsPath}>
    | Readonly<{kind: "external-project"; root: AbsoluteFsPath}>;

/** 普通相对 File Address 的解析结果。 */
export type ScopeRelativeFileAddress = Readonly<{
    kind: "scope-relative";
    absolutePath: AbsoluteFsPath;
    projectPath: ProjectPath | AbsoluteFsPath | null;
    relativePath: string;
}>;

/** 显式 `workspace/<project>/...` Project File Address 的解析结果。 */
export type ProjectFileAddress = Readonly<{
    kind: "project-address";
    absolutePath: AbsoluteFsPath;
    projectPath: ProjectPath;
    relativePath: string;
}>;

/** 明确绝对 File Address 的解析结果。 */
export type AbsoluteFileAddress =
    | Readonly<{
        kind: "absolute";
        absolutePath: AbsoluteFsPath;
        projectPath: null;
    }>
    | Readonly<{
        kind: "absolute";
        absolutePath: AbsoluteFsPath;
        /** 绝对地址仍落在当前 Project Workspace 内时保留其领域身份。 */
        projectPath: ProjectPath | AbsoluteFsPath;
        relativePath: string;
    }>;

/** 文件地址解析结果；地址种类决定调用方可使用的附加字段。 */
export type ResolvedFileAddress =
    | ScopeRelativeFileAddress
    | ProjectFileAddress
    | AbsoluteFileAddress;

/**
 * 从已规范化领域位置创建 File Scope。
 *
 * DTO、session 和 HTTP Adapter 必须在调用前完成字符串规范化；本 Module 不从 cwd
 * 或目录名反向猜测领域身份。
 */
export function createFileScope(input: FileScopeInput): FileScope {
    switch (input.kind) {
        case "managed-project":
            return {
                kind: input.kind,
                root: resolveProjectWorkspaceRoot(input.workspaceRoot, input.projectPath),
                workspaceRoot: input.workspaceRoot,
                currentProjectPath: input.projectPath,
            };
        case "workspace":
            return {
                kind: input.kind,
                root: input.workspaceRoot,
                workspaceRoot: input.workspaceRoot,
                currentProjectPath: null,
            };
        case "user-assets":
            return {
                kind: input.kind,
                root: input.root,
                workspaceRoot: null,
                currentProjectPath: null,
            };
        case "external-project":
            return {
                kind: input.kind,
                root: input.root,
                workspaceRoot: null,
                currentProjectPath: input.root,
            };
    }
}

/**
 * 解析统一 File Address。
 *
 * - 普通相对路径：限制在当前 File Scope 内。
 * - `workspace/<project>/...`：通过 Project Path 命名空间显式定位 managed Project。
 * - 绝对路径：保持绝对语义，是否允许访问由调用 Module 的 Interface 决定。
 */
export function resolveFileAddress(scope: FileScope, input: string): ResolvedFileAddress {
    const normalizedInput = input.trim().replaceAll("\\", "/");
    if (!normalizedInput) {
        throw new Error("文件地址不能为空");
    }
    if (path.isAbsolute(normalizedInput)) {
        const absolutePath = absoluteFsPath(normalizedInput);
        const relativePath = scope.currentProjectPath
            ? relativeFilePathInside(scope.root, absolutePath)
            : null;
        if (scope.currentProjectPath && relativePath !== null) {
            return {
                kind: "absolute",
                absolutePath,
                projectPath: scope.currentProjectPath,
                relativePath,
            };
        }
        return {
            kind: "absolute",
            absolutePath,
            projectPath: null,
        };
    }

    const segments = normalizedInput.split("/");
    if (segments[0] === "workspace") {
        if (scope.kind !== "workspace" && scope.kind !== "managed-project") {
            throw new Error(`${scope.kind === "external-project" ? "外部" : "user-assets"} File Scope不能解析managed Project File Address`);
        }
        if (segments.some((segment) => segment.length === 0) || segments.length < 3) {
            throw new Error("完整Project File Address必须使用workspace/<project>/<relative-path>");
        }
        const projectPath = normalizeProjectPath(`workspace/${segments[1]}`);
        const projectRoot = resolveProjectWorkspaceRoot(scope.workspaceRoot, projectPath);
        const absolutePath = resolveContainedFilePath(projectRoot, segments.slice(2).join("/"));
        const relativePath = relativeFilePathInside(projectRoot, absolutePath);
        if (!relativePath || relativePath === ".") {
            throw new Error("Project File Address必须指向Project Workspace内的文件或目录项");
        }
        return {
            kind: "project-address",
            absolutePath,
            projectPath,
            relativePath,
        };
    }

    if (scope.kind === "managed-project" && segments[0] === projectSlug(scope.currentProjectPath)) {
        throw new Error(`当前Project Workspace内请使用相对路径，不要重复添加${segments[0]}/前缀`);
    }

    const absolutePath = resolveContainedFilePath(scope.root, normalizedInput);
    const relativePath = relativeFilePathInside(scope.root, absolutePath);
    if (!relativePath) {
        throw new Error(`路径越过文件系统根：${input}`);
    }
    return {
        kind: "scope-relative",
        absolutePath,
        projectPath: scope.currentProjectPath,
        relativePath,
    };
}
