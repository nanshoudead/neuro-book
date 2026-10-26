import {readdir, stat} from "node:fs/promises";
import {relative, resolve, sep} from "node:path";

import {UsageError} from "#scripts/publish/options";

/** 工作空间的识别标记：只有带它的目录才算一个作品。 */
const WORKSPACE_MARKER = "project.yaml";

/** 正文目录名；工作空间里的 `reference/`、`lorebook/`、`upload/` 等都不发布。 */
const MANUSCRIPT_DIRECTORY = "manuscript";

const MANUSCRIPT_EXTENSION = ".md";

/** 正文内部不发布的子目录：`_backup` 是编辑过程中的备份副本，不是正文本身。 */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set(["_backup"]);

/**
 * 目标仓库里的排布：
 * - `nested`：一个仓库装多个作品，路径是 `<工作空间>/manuscript/...`；
 * - `root`：一个仓库只装一个作品，正文直接在仓库根，适合每部作品一个仓库。
 */
export type PublishLayout = "nested" | "root";

export type PlanOptions = {
    readonly layout: PublishLayout;
    /** 只发布这个工作空间；null 表示全部。 */
    readonly workspace: string | null;
    /** 是否把 `_backup/` 里的备份副本也发布出去。 */
    readonly includeBackup: boolean;
};

/** 一个待发布文件：源文件，以及它在目标仓库里的路径。 */
export type PublishFile = {
    /** 目标仓库内的相对路径，分隔符固定为 `/`。 */
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
export async function collectWorkspaceManuscript(
    workspaceRoot: string,
    name: string,
    options: Pick<PlanOptions, "layout" | "includeBackup">,
): Promise<WorkspaceManuscript> {
    const manuscriptRoot = resolve(workspaceRoot, name, MANUSCRIPT_DIRECTORY);
    const files: PublishFile[] = [];
    await walkManuscript(manuscriptRoot, manuscriptRoot, name, options, files);
    files.sort((left, right) => left.targetPath.localeCompare(right.targetPath, "en"));
    return {name, files};
}

/** 一次收集选中的工作空间；工作空间根目录不存在时抛出 ENOENT，交给调用方报错。 */
export async function planManuscripts(workspaceRoot: string, options: PlanOptions): Promise<ManuscriptPlan> {
    const names = await selectWorkspaces(workspaceRoot, options.workspace);
    const workspaces: WorkspaceManuscript[] = [];
    for (const name of names) workspaces.push(await collectWorkspaceManuscript(workspaceRoot, name, options));
    const files = workspaces.flatMap((workspace) => workspace.files);
    if (options.layout === "root") assertSingleWorkspace(workspaces);
    return {workspaceRoot, workspaces, files};
}

async function selectWorkspaces(workspaceRoot: string, workspace: string | null): Promise<string[]> {
    const names = await discoverWorkspaces(workspaceRoot);
    if (workspace === null) return names;
    if (!names.includes(workspace)) throw new UsageError(`没有这个工作空间：${workspace}`);
    return [workspace];
}

/**
 * 根布局里所有正文平铺在一起，两个作品的文件会互相覆盖，
 * 所以在写任何文件之前就拒绝，而不是等到目标仓库里出现同名章节。
 */
function assertSingleWorkspace(workspaces: readonly WorkspaceManuscript[]): void {
    const publishing = workspaces.filter((workspace) => workspace.files.length > 0);
    if (publishing.length <= 1) return;
    const names = publishing.map((workspace) => workspace.name).join("、");
    throw new UsageError(`--layout root 只能发布一个工作空间（当前有 ${names}），请用 --workspace 指定`);
}

async function walkManuscript(
    manuscriptRoot: string,
    directory: string,
    name: string,
    options: Pick<PlanOptions, "layout" | "includeBackup">,
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
            if (!options.includeBackup && SKIPPED_DIRECTORIES.has(entry.name)) continue;
            await walkManuscript(manuscriptRoot, absolute, name, options, files);
            continue;
        }
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(MANUSCRIPT_EXTENSION)) continue;
        const relativePath = relative(manuscriptRoot, absolute).split(sep).join("/");
        const targetPath = options.layout === "nested" ? `${name}/${MANUSCRIPT_DIRECTORY}/${relativePath}` : relativePath;
        files.push({targetPath, sourcePath: absolute});
    }
}
