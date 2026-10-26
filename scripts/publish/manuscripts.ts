import {readdir, stat} from "node:fs/promises";
import {relative, resolve, sep} from "node:path";

/** 工作空间的识别标记：只有带它的目录才算一个作品。 */
const WORKSPACE_MARKER = "project.yaml";

/** 正文目录名；工作空间里的 `reference/`、`lorebook/`、`upload/` 等都不发布。 */
const MANUSCRIPT_DIRECTORY = "manuscript";

const MANUSCRIPT_EXTENSION = ".md";

/** 正文内部不发布的子目录：`_backup` 是编辑过程中的备份副本，不是正文本身。 */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set(["_backup"]);

/** 一个待发布文件：源文件，以及它在目标仓库里的路径。 */
export type PublishFile = {
    /** 目标仓库内的相对路径，分隔符固定为 `/`，第一段是工作空间名。 */
    readonly targetPath: string;
    /** 源文件的绝对路径。 */
    readonly sourcePath: string;
};

export type WorkspaceManuscript = {
    /** 工作空间名，也就是工作空间根目录下的目录名。 */
    readonly name: string;
    /** 该工作空间的正文文件；没有 `manuscript/` 时为空数组。 */
    readonly files: readonly PublishFile[];
};

export type ManuscriptPlan = {
    /** 工作空间根目录的绝对路径。 */
    readonly workspaceRoot: string;
    /** 按工作空间名排序的工作空间。 */
    readonly workspaces: readonly WorkspaceManuscript[];
    /** 所有工作空间的正文，顺序与 `workspaces` 一致。 */
    readonly files: readonly PublishFile[];
};

async function isFile(path: string): Promise<boolean> {
    const stats = await stat(path).catch(() => null);
    return stats?.isFile() ?? false;
}

/** 按 `project.yaml` 识别工作空间并按名字排序；空目录不算工作空间。 */
export async function discoverWorkspaces(workspaceRoot: string): Promise<string[]> {
    const entries = await readdir(workspaceRoot, {withFileTypes: true});
    const names: string[] = [];
    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        if (await isFile(resolve(workspaceRoot, entry.name, WORKSPACE_MARKER))) names.push(entry.name);
    }
    return names.sort((left, right) => left.localeCompare(right, "en"));
}

/** 收集一个工作空间 `manuscript/` 下的 `.md` 正文；目录不存在时返回空清单。 */
export async function collectWorkspaceManuscript(workspaceRoot: string, name: string): Promise<WorkspaceManuscript> {
    const manuscriptRoot = resolve(workspaceRoot, name, MANUSCRIPT_DIRECTORY);
    const files: PublishFile[] = [];
    await walkManuscript(manuscriptRoot, manuscriptRoot, name, files);
    files.sort((left, right) => left.targetPath.localeCompare(right.targetPath, "en"));
    return {name, files};
}

/** 一次收集全部工作空间；`workspaceRoot` 不存在时抛出，交给调用方报错。 */
export async function planManuscripts(workspaceRoot: string): Promise<ManuscriptPlan> {
    const names = await discoverWorkspaces(workspaceRoot);
    const workspaces: WorkspaceManuscript[] = [];
    for (const name of names) workspaces.push(await collectWorkspaceManuscript(workspaceRoot, name));
    return {workspaceRoot, workspaces, files: workspaces.flatMap((workspace) => workspace.files)};
}

async function walkManuscript(
    manuscriptRoot: string,
    directory: string,
    name: string,
    files: PublishFile[],
): Promise<void> {
    const entries = await readdir(directory, {withFileTypes: true}).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
    });
    if (entries === null) return;
    for (const entry of entries) {
        // 点开头的目录是运行时数据（`.nbook/`、`.agent/`），不是正文。
        if (entry.name.startsWith(".")) continue;
        const absolute = resolve(directory, entry.name);
        if (entry.isDirectory()) {
            if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
            await walkManuscript(manuscriptRoot, absolute, name, files);
            continue;
        }
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(MANUSCRIPT_EXTENSION)) continue;
        const relativePath = relative(manuscriptRoot, absolute).split(sep).join("/");
        files.push({targetPath: `${name}/${MANUSCRIPT_DIRECTORY}/${relativePath}`, sourcePath: absolute});
    }
}
