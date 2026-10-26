#!/usr/bin/env bun
import {planManuscripts, type ManuscriptPlan} from "#scripts/publish/manuscripts";
import {GitCommandError, publishManuscripts} from "#scripts/publish/git";
import {parsePublishArguments, UsageError, type PublishOptions} from "#scripts/publish/options";

/** 退出码是命令合同的一部分：0 成功或无变化，2 参数错误，3 Git 失败，4 没有可发布的工作空间。 */
const EXIT_OK = 0;
const EXIT_USAGE = 2;
const EXIT_GIT = 3;
const EXIT_NO_WORKSPACE = 4;

const SCHEMA = "nbook.publish-workspaces/v1";

const USAGE = `把每个工作空间的正文按工作空间名推送到目标仓库。

用法：
  bun scripts/publish/workspaces.ts --repo <git-url> [选项]

选项：
  --repo <url>       目标仓库；也可以设环境变量 NB_PUBLISH_REPO
  --branch <name>    目标分支，默认 main；也可以设 NB_PUBLISH_BRANCH
  --workspaces <dir> 工作空间根目录，默认 packages/neuro-book-legacy/data/workspace
  --workspace <name> 只发布这一个工作空间
  --layout <mode>    nested（默认）按 <工作空间>/manuscript/ 分组；root 只放一个作品的正文
  --cache <dir>      受管理的本地 clone，默认 .local/publish/workspaces
  --dry-run          只列出要发布的文件，不访问 Git 仓库
  --help             显示本说明

环境变量：
  NB_PUBLISH_TOKEN   GitHub PAT；只通过 GIT_CONFIG_* 注入 HTTP 头，不写进 argv

目标仓库布局：nested 是 <工作空间名>/manuscript/<正文相对路径>，一个仓库放多部作品；
root 是正文直接在仓库根，适合每部作品一个仓库（必须配合 --workspace）。只发布 manuscript/
下的 .md，reference/、lorebook/、upload/、.nbook/ 等目录不会出现；manuscript/_backup/ 也跳过。

示例：
  # 一个仓库放全部作品的正文
  NB_PUBLISH_REPO=https://github.com/<you>/<novels>.git NB_PUBLISH_TOKEN=<pat> \\
    bun run publish:workspaces

  # 每部作品一个仓库
  NB_PUBLISH_REPO=https://github.com/<you>/chi-nv-ai-li-nuo-manuscript.git NB_PUBLISH_TOKEN=<pat> \\
    bun run publish:workspaces --workspace chi-nv-ai-li-nuo --layout root
`;

type PublishReport = {
    readonly schema: typeof SCHEMA;
    readonly dryRun: boolean;
    readonly workspaceRoot: string;
    readonly repository: string | null;
    readonly branch: string;
    readonly layout: string;
    readonly workspace: string | null;
    readonly workspaces: readonly {readonly name: string; readonly files: number}[];
    readonly files: number;
    readonly changed: boolean | null;
    readonly commit: string | null;
    readonly added: number | null;
    readonly removed: number | null;
};

async function main(): Promise<number> {
    let options: PublishOptions;
    try {
        options = parsePublishArguments(process.argv.slice(2), process.env, import.meta.url);
    } catch (error) {
        if (!(error instanceof UsageError)) throw error;
        console.error(error.message);
        console.error(USAGE);
        return EXIT_USAGE;
    }
    if (options.help) {
        console.log(USAGE);
        return EXIT_OK;
    }
    if (!options.dryRun && options.repoUrl === null) {
        console.error("缺少目标仓库：传 --repo 或设置 NB_PUBLISH_REPO；只想看清单加 --dry-run");
        return EXIT_USAGE;
    }

    let plan: ManuscriptPlan;
    try {
        plan = await planManuscripts(options.workspaceRoot, {layout: options.layout, workspace: options.workspace});
    } catch (error) {
        if (error instanceof UsageError) {
            console.error(error.message);
            return EXIT_USAGE;
        }
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            console.error(`工作空间目录不存在：${options.workspaceRoot}`);
            return EXIT_NO_WORKSPACE;
        }
        throw error;
    }
    if (plan.workspaces.length === 0 || plan.files.length === 0) {
        console.error(`没有可发布的正文：${plan.workspaceRoot} 下没有工作空间，或它们都没有 manuscript/ 下的 .md`);
        return EXIT_NO_WORKSPACE;
    }

    const base = {
        schema: SCHEMA,
        dryRun: options.dryRun,
        workspaceRoot: plan.workspaceRoot,
        repository: options.repoUrl,
        branch: options.branch,
        layout: options.layout,
        workspace: options.workspace,
        workspaces: plan.workspaces.map((workspace) => ({name: workspace.name, files: workspace.files.length})),
        files: plan.files.length,
    } as const;
    if (options.dryRun) {
        printReport({...base, changed: null, commit: null, added: null, removed: null});
        return EXIT_OK;
    }

    console.error(`[publish] ${String(plan.workspaces.length)} 个工作空间，${String(plan.files.length)} 个正文文件 → ${options.repoUrl ?? ""}（${options.branch}）`);
    try {
        const outcome = await publishManuscripts(plan, options);
        printReport({...base, changed: outcome.changed, commit: outcome.commit, added: outcome.added, removed: outcome.removed});
        if (!outcome.changed) console.error("[publish] 正文没有变化，未产生提交");
        else console.error(`[publish] 新增 ${String(outcome.added)}，删除 ${String(outcome.removed)}`);
        return EXIT_OK;
    } catch (error) {
        if (error instanceof GitCommandError) {
            console.error(error.message);
            return EXIT_GIT;
        }
        console.error(error instanceof Error ? error.message : String(error));
        return EXIT_GIT;
    }
}

function printReport(report: PublishReport): void {
    console.log(JSON.stringify(report, null, 4));
}

process.exitCode = await main();
