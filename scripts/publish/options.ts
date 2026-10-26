import {resolve} from "node:path";

import {defaultRepoRoot} from "#scripts/ci/agent-governance-contract";
import type {PublishLayout} from "#scripts/publish/manuscripts";

/** 默认读取旧应用的工作空间；新应用接入自己的 data 目录时用 `--workspaces` 覆盖。 */
const DEFAULT_WORKSPACE_ROOT = "packages/neuro-book-legacy/data/workspace";

/** 受管理的缓存 clone，不能指向主仓库。 */
const DEFAULT_CACHE_DIR = ".local/publish/workspaces";

/** 目标仓库与凭据只从环境变量读：token 一旦进了 argv 就会留在进程列表和 shell 历史里。 */
const REPOSITORY_ENV = "NB_PUBLISH_REPO";
const TOKEN_ENV = "NB_PUBLISH_TOKEN";
const BRANCH_ENV = "NB_PUBLISH_BRANCH";

const VALUE_FLAGS: ReadonlySet<string> = new Set([
    "--workspaces",
    "--workspace",
    "--cache",
    "--repo",
    "--branch",
    "--layout",
]);
const BOOLEAN_FLAGS: ReadonlySet<string> = new Set(["--dry-run", "--help", "--include-backup"]);

/** 参数错误；调用方打印 message 与用法并以 2 退出。 */
export class UsageError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "UsageError";
    }
}

export type PublishOptions = {
    /** 仓库根绝对路径，用来解析默认目录与防止误删缓存。 */
    readonly repoRoot: string;
    /** 工作空间根目录的绝对路径。 */
    readonly workspaceRoot: string;
    /** 目标仓库的本地 clone 绝对路径；脚本每次重建它的工作区。 */
    readonly cacheDir: string;
    /** 目标仓库地址；`--dry-run` 时可以为 null。 */
    readonly repoUrl: string | null;
    readonly branch: string;
    readonly token: string | null;
    /** 只发布这个工作空间；null 表示全部。 */
    readonly workspace: string | null;
    readonly layout: PublishLayout;
    /** 是否把 `manuscript/_backup/` 一起发布。 */
    readonly includeBackup: boolean;
    readonly dryRun: boolean;
    readonly help: boolean;
};

/**
 * 解析发布参数。
 * 没有默认值兜底的未知参数直接报错：拼错的 `--repo` 若被忽略，会推到一个意料之外的仓库。
 */
export function parsePublishArguments(
    args: readonly string[],
    env: NodeJS.ProcessEnv,
    moduleUrl: string,
): PublishOptions {
    const repoRoot = defaultRepoRoot(moduleUrl);
    let workspaceRoot = resolve(repoRoot, DEFAULT_WORKSPACE_ROOT);
    let cacheDir = resolve(repoRoot, DEFAULT_CACHE_DIR);
    let repoUrl = env[REPOSITORY_ENV]?.trim() || null;
    let branch = env[BRANCH_ENV]?.trim() || "main";
    let workspace: string | null = null;
    let layout: PublishLayout = "nested";
    let includeBackup = false;
    let dryRun = false;
    let help = false;
    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index] as string;
        if (argument === "--") continue;
        if (BOOLEAN_FLAGS.has(argument)) {
            if (argument === "--dry-run") dryRun = true;
            else if (argument === "--include-backup") includeBackup = true;
            else help = true;
            continue;
        }
        if (!VALUE_FLAGS.has(argument)) throw new UsageError(`未知参数：${argument}`);
        const value = args[index + 1];
        if (value === undefined || value.startsWith("--")) throw new UsageError(`参数缺少值：${argument}`);
        if (argument === "--workspaces") workspaceRoot = resolve(repoRoot, value);
        else if (argument === "--workspace") workspace = value.trim() === "" ? null : value;
        else if (argument === "--cache") cacheDir = resolve(repoRoot, value);
        else if (argument === "--repo") repoUrl = value;
        else if (argument === "--layout") layout = parseLayout(value);
        else {
            if (value.trim() === "") throw new UsageError("分支名不能为空：--branch");
            branch = value;
        }
        index += 1;
    }
    return {repoRoot, workspaceRoot, cacheDir, repoUrl, branch, token: env[TOKEN_ENV]?.trim() || null, workspace, layout, includeBackup, dryRun, help};
}

function parseLayout(value: string): PublishLayout {
    if (value !== "nested" && value !== "root") throw new UsageError(`--layout 只能是 nested 或 root：${value}`);
    return value;
}
