import {spawnSync} from "node:child_process";
import {existsSync} from "node:fs";
import {copyFile, mkdir, readdir, rm} from "node:fs/promises";
import {dirname, resolve, sep} from "node:path";

import type {ManuscriptPlan} from "#scripts/publish/manuscripts";
import type {PublishOptions} from "#scripts/publish/options";

const COMMIT_NAME = "NeuroBook";
const COMMIT_EMAIL = "neurobook@users.noreply.github.com";

/** 外部 Git 命令失败；保留原始退出码与 stderr，调用方据此判错退出。 */
export class GitCommandError extends Error {
    constructor(
        readonly args: readonly string[],
        readonly status: number | null,
        readonly stderr: string,
    ) {
        super(`git ${args.join(" ")} 失败（退出码 ${String(status)}）：${stderr.trim()}`);
        this.name = "GitCommandError";
    }
}

export type PublishOutcome = {
    /** 目标仓库是否真的产生了新提交。 */
    readonly changed: boolean;
    /** 新提交的完整哈希；没有变化时为 null。 */
    readonly commit: string | null;
    /** 相对目标分支原有内容新增的文件数。 */
    readonly added: number;
    /** 相对目标分支原有内容删掉的文件数；镜像语义下源里删除的章节会出现在这里。 */
    readonly removed: number;
};

/**
 * 用 HTTP Basic 头携带 PAT，并放进 `GIT_CONFIG_*` 环境变量。
 * 放进环境变量而不是 argv：argv 会出现在进程列表和 `ps` 输出里。
 */
export function authEnvironment(token: string | null): NodeJS.ProcessEnv {
    if (token === null) return {};
    const basic = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64");
    return {
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "http.extraHeader",
        GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
    };
}

type GitResult = {status: number | null; stdout: string; stderr: string};

function tryGit(cwd: string, args: readonly string[], env: NodeJS.ProcessEnv): GitResult {
    const result = spawnSync("git", [...args], {
        cwd,
        encoding: "utf8",
        env: {...process.env, ...env},
        stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error !== undefined) throw result.error;
    return {status: result.status, stdout: result.stdout, stderr: result.stderr};
}

function runGit(cwd: string, args: readonly string[], env: NodeJS.ProcessEnv): {stdout: string; stderr: string} {
    const result = tryGit(cwd, args, env);
    if (result.status !== 0) throw new GitCommandError(args, result.status, result.stderr);
    return {stdout: result.stdout, stderr: result.stderr};
}

/**
 * 把正文同步进目标仓库并推送。
 * 缓存 clone 完全由脚本管理：每次先对齐远端分支，再清空工作区重写，保证删除也能同步过去。
 */
export async function publishManuscripts(plan: ManuscriptPlan, options: PublishOptions): Promise<PublishOutcome> {
    assertSafeCacheDir(options);
    const environment = authEnvironment(options.token);
    const cacheDir = options.cacheDir;
    if (!existsSync(cacheDir)) {
        if (options.repoUrl === null) throw new Error("缺少目标仓库：传 --repo 或设置 NB_PUBLISH_REPO");
        await mkdir(dirname(cacheDir), {recursive: true});
        runGit(dirname(cacheDir), ["clone", "--quiet", options.repoUrl, cacheDir], environment);
    } else if (!existsSync(resolve(cacheDir, ".git"))) {
        throw new Error(`缓存目录已存在但不是 Git 仓库：${cacheDir}；请换 --cache 或删掉它`);
    }

    if (await hasRemoteBranch(cacheDir, options.branch, environment)) {
        runGit(cacheDir, ["fetch", "--quiet", "--prune", "origin", `+refs/heads/${options.branch}:refs/remotes/origin/${options.branch}`], environment);
        runGit(cacheDir, ["checkout", "--quiet", "--force", "-B", options.branch, `origin/${options.branch}`], environment);
    } else if (hasCommits(cacheDir, environment)) {
        // 目标分支还不存在，但仓库里有别的分支：发布仓库只放正文，不能把那条历史接进来。
        runGit(cacheDir, ["checkout", "--quiet", "--orphan", options.branch], environment);
        runGit(cacheDir, ["read-tree", "--empty"], environment);
    } else {
        // 空仓库还没有任何提交：HEAD 先指向一个尚未出生的分支，第一次提交会把它建出来。
        runGit(cacheDir, ["symbolic-ref", "HEAD", `refs/heads/${options.branch}`], environment);
    }

    // 清空工作区之前记下目标分支原有文件，报告才能说清“这次新增/删掉了多少”。
    const previous = new Set(runGit(cacheDir, ["ls-files"], environment).stdout.split("\n").filter((line) => line !== ""));
    await clearWorkingTree(cacheDir);
    for (const file of plan.files) {
        const target = resolve(cacheDir, file.targetPath);
        await mkdir(dirname(target), {recursive: true});
        await copyFile(file.sourcePath, target);
    }
    const next = new Set(plan.files.map((file) => file.targetPath));
    const added = [...next].filter((path) => !previous.has(path)).length;
    const removed = [...previous].filter((path) => !next.has(path)).length;

    runGit(cacheDir, ["add", "--all", "--", "."], environment);
    if (runGit(cacheDir, ["status", "--porcelain"], environment).stdout.trim() === "") {
        return {changed: false, commit: null, added: 0, removed: 0};
    }
    runGit(
        cacheDir,
        ["-c", `user.name=${COMMIT_NAME}`, "-c", `user.email=${COMMIT_EMAIL}`, "commit", "--quiet", "-m", commitMessage(plan)],
        environment,
    );
    const commit = runGit(cacheDir, ["rev-parse", "HEAD"], environment).stdout.trim();
    runGit(cacheDir, ["push", "--quiet", "origin", `HEAD:refs/heads/${options.branch}`], environment);
    return {changed: true, commit, added, removed};
}

function commitMessage(plan: ManuscriptPlan): string {
    const names = plan.workspaces.filter((workspace) => workspace.files.length > 0).map((workspace) => workspace.name);
    if (names.length === 0) return "正文同步：无正文";
    return `正文同步：${names.join("、")}`;
}

async function hasRemoteBranch(cacheDir: string, branch: string, environment: NodeJS.ProcessEnv): Promise<boolean> {
    return runGit(cacheDir, ["ls-remote", "--heads", "origin", branch], environment).stdout.trim() !== "";
}

function hasCommits(cacheDir: string, environment: NodeJS.ProcessEnv): boolean {
    return tryGit(cacheDir, ["rev-parse", "--verify", "--quiet", "HEAD"], environment).status === 0;
}

/**
 * 只允许清空受管理的缓存 clone：目标不能是仓库根，也不能是它的祖先目录，
 * 否则一个写错的 --cache 会删掉工作区里的源码。
 */
function assertSafeCacheDir(options: PublishOptions): void {
    const cacheDir = options.cacheDir;
    if (cacheDir === options.repoRoot || options.repoRoot.startsWith(`${cacheDir}${sep}`)) {
        throw new Error(`缓存目录不能是仓库根或它的祖先：${cacheDir}`);
    }
}

async function clearWorkingTree(root: string): Promise<void> {
    for (const entry of await readdir(root, {withFileTypes: true})) {
        if (entry.name === ".git") continue;
        await rm(resolve(root, entry.name), {recursive: true, force: true});
    }
}
