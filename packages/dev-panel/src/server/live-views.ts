import {checkoutNamedForTask} from "../core/checkouts.js";
import type {Warning} from "../core/errors.js";
import {runGit} from "../core/git.js";
import {MASTER_REF} from "../core/repo.js";
import type {GithubView, PrView} from "./github.js";
import type {PanelState} from "./state.js";

/**
 * 面板“现场”的三页（t14）：“在跑”、checkout、GitHub。合同见 docs/panel.md 的“现场”。
 * checkout 页的未提交与领先落后请求时现算、每个 checkout 留 10 秒：按 HEAD 与 index 的 mtime 缓存会漏掉没 `add` 的改动
 * （面板的 Git 读操作带 `--no-optional-locks`，`git status` 不回写 index，t14 设计审查 I3）。
 */

const CHECKOUT_TTL_MS = 10_000;
const PARALLEL = 4;
/**
 * 一个 checkout 的 git 调用最多等这么久（t15 阶段 4 第 4 批）：接口等全部 checkout 算完才回，没有它一个慢的（冷的大 worktree）
 * 会拖住整页。真实仓库上 `status -unormal` 是几十毫秒，冷的也在 1 秒内（2026-10-14 实测）。
 */
const CHECKOUT_TIMEOUT_MS = 3_000;
/** 文件清单每段最多这么多条。 */
const FILES_LIMIT = 300;

/** “在跑”：经 nbdev 起的（登记）、会话的运行、无主的运行；后两块已按登记的 pid 去重（`discoverRuns` 的排除集）。 */
export function runsView(state: PanelState): {data: unknown; warnings: Warning[]} {
    const activity = state.activity.part.value;
    return {
        data: {
            procs: (activity?.procs ?? []).map((run) => ({...run, checkoutKey: state.keyOf(run.checkout) ?? run.checkoutKey})),
            sessions: (activity?.activity.sessions ?? []).filter((session) => session.runs.length > 0).map((session) => ({key: session.key, agent: session.agent, label: session.label, alive: session.alive, runs: session.runs})),
            unownedRuns: activity?.activity.unownedRuns ?? [],
            // “经 nbdev 起的服务”的属主与会话运行的属主的标题（t17）；属主可能只剩进程登记、已不在活动里。
            sessionTitles: state.titlesFor([...(activity?.procs ?? []).map((run) => run.startedBy?.key), ...(activity?.activity.sessions ?? []).filter((session) => session.runs.length > 0).map((session) => session.key)]),
        },
        warnings: activity?.warnings ?? [],
    };
}

/**
 * 一个 checkout 的现算状态。`tracked` 是已跟踪文件的改动（含暂存），`untracked` 是未跟踪的条数（`-unormal`：未跟踪的目录算一条）；
 * `timedOut` 时这几个数都是 null（页面写“没算完”）。
 */
type CheckoutStatus = {tracked: number | null; untracked: number | null; ahead: number | null; behind: number | null; error: string | null; timedOut: boolean; at: string};

/** `git status --porcelain=v1 -z` 的一条：前两个字符是暂存区与工作区的状态，`??` 是未跟踪。 */
function statusEntries(stdout: string): Array<{code: string; path: string}> {
    return stdout.split("\0").filter((entry) => entry.length > 3).map((entry) => ({code: entry.slice(0, 2), path: entry.slice(3)}));
}

export class CheckoutStatusCache {
    private readonly cache = new Map<string, {key: string; status: CheckoutStatus; expires: number}>();

    constructor(private readonly timeoutMs = CHECKOUT_TIMEOUT_MS) {}

    private async compute(root: string, head: string): Promise<CheckoutStatus> {
        const options = {readOnly: true, timeoutMs: this.timeoutMs};
        const [status, counts] = await Promise.all([
            runGit(root, ["status", "--porcelain=v1", "-z", "-unormal", "--no-renames"], options),
            runGit(root, ["rev-list", "--left-right", "--count", `${MASTER_REF}...${head}`], options),
        ]);
        const at = new Date().toISOString();
        if (status.timedOut || counts.timedOut) return {tracked: null, untracked: null, ahead: null, behind: null, error: null, timedOut: true, at};
        if (status.exitCode !== 0) return {tracked: null, untracked: null, ahead: null, behind: null, error: status.stderr.trim().split("\n")[0] ?? "git status 失败", timedOut: false, at};
        const entries = statusEntries(status.stdout);
        const untracked = entries.filter((entry) => entry.code === "??").length;
        const match = /^(\d+)\s+(\d+)/u.exec(counts.stdout.trim());
        return {tracked: entries.length - untracked, untracked, behind: match ? Number(match[1]) : null, ahead: match ? Number(match[2]) : null, error: null, timedOut: false, at};
    }

    /** 一个 checkout 的文件清单：暂存、工作区、未跟踪三段，每段最多 `FILES_LIMIT` 条；同样限时，不缓存（点开时才取）。 */
    async files(root: string): Promise<{staged: Array<{path: string; code: string}>; unstaged: Array<{path: string; code: string}>; untracked: string[]; truncated: boolean; timedOut: boolean; error: string | null}> {
        const status = await runGit(root, ["status", "--porcelain=v1", "-z", "-unormal", "--no-renames"], {readOnly: true, timeoutMs: this.timeoutMs});
        if (status.timedOut) return {staged: [], unstaged: [], untracked: [], truncated: false, timedOut: true, error: null};
        if (status.exitCode !== 0) return {staged: [], unstaged: [], untracked: [], truncated: false, timedOut: false, error: status.stderr.trim().split("\n")[0] ?? "git status 失败"};
        const entries = statusEntries(status.stdout);
        const staged = entries.filter((entry) => entry.code !== "??" && entry.code[0] !== " ").map((entry) => ({path: entry.path, code: entry.code[0]!}));
        const unstaged = entries.filter((entry) => entry.code !== "??" && entry.code[1] !== " ").map((entry) => ({path: entry.path, code: entry.code[1]!}));
        const untracked = entries.filter((entry) => entry.code === "??").map((entry) => entry.path);
        const truncated = staged.length > FILES_LIMIT || unstaged.length > FILES_LIMIT || untracked.length > FILES_LIMIT;
        return {staged: staged.slice(0, FILES_LIMIT), unstaged: unstaged.slice(0, FILES_LIMIT), untracked: untracked.slice(0, FILES_LIMIT), truncated, timedOut: false, error: null};
    }

    /** 各 checkout 的状态：4 路并行，结果按 checkout 留 10 秒（HEAD 变了就重算）。 */
    async statuses(checkouts: ReadonlyArray<{root: string; head: string}>): Promise<Map<string, CheckoutStatus>> {
        const now = Date.now();
        const result = new Map<string, CheckoutStatus>();
        const queue = [...checkouts];
        const worker = async () => {
            for (let next = queue.shift(); next; next = queue.shift()) {
                const cached = this.cache.get(next.root);
                if (cached && cached.key === next.head && cached.expires > now) {
                    result.set(next.root, cached.status);
                    continue;
                }
                const status = await this.compute(next.root, next.head);
                this.cache.set(next.root, {key: next.head, status, expires: Date.now() + CHECKOUT_TTL_MS});
                result.set(next.root, status);
            }
        };
        await Promise.all(Array.from({length: PARALLEL}, worker));
        return result;
    }
}

/** checkout 页：分支、HEAD、是哪个 Work 的执行 worktree，加未提交、领先落后、在跑的服务、是哪些 Task 的 `home`（t14）。 */
export async function checkoutsView(state: PanelState, cache: CheckoutStatusCache): Promise<{data: unknown; warnings: Warning[]}> {
    const records = state.records.part.value;
    const executionOf = new Map<string, string[]>();
    for (const work of records?.records.works ?? []) {
        if (work.source !== "branch") continue;
        executionOf.set(work.checkout, [...(executionOf.get(work.checkout) ?? []), work.workId]);
    }
    const homes = new Map<string, Array<{workId: string; taskId: string}>>();
    for (const work of records?.transition.registry.works ?? []) {
        for (const task of work.tasks) if (task.home) homes.set(task.home, [...(homes.get(task.home) ?? []), {workId: work.workId, taskId: task.taskId}]);
    }
    const procs = state.activity.part.value?.procs ?? [];
    const checkouts = state.checkouts.filter((checkout) => !checkout.prunable);
    /** 这个 checkout 是哪些 Task 的：登记表的 `home`，加目录名认出的（`checkoutNamedForTask`，与 Task 执行 checkout 的第 2 条规则同一个判据）。 */
    const tasksOf = (root: string): Array<{workId: string; taskId: string}> => {
        const found = [...(homes.get(root) ?? [])];
        for (const work of records?.records.works ?? []) {
            for (const task of work.tasks) {
                if (checkoutNamedForTask(root, work.workId, task.taskId) && !found.some((entry) => entry.workId === work.workId && entry.taskId === task.taskId)) found.push({workId: work.workId, taskId: task.taskId});
            }
        }
        return found;
    };
    const statuses = await cache.statuses(checkouts);
    return {
        data: {
            checkouts: checkouts.map((checkout) => ({
                key: state.keyOf(checkout.root)!,
                root: checkout.root,
                branch: checkout.branch,
                head: checkout.head,
                isMain: checkout.isMain,
                executionOf: executionOf.get(checkout.root) ?? [],
                homeOf: homes.get(checkout.root) ?? [],
                tasks: checkout.isMain ? [] : tasksOf(checkout.root),
                runs: procs.filter((run) => run.checkout === checkout.root && run.state !== "ended").map((run) => ({runId: run.runId, package: run.package, script: run.script, state: run.state, url: run.url})),
                ...statuses.get(checkout.root)!,
            })),
        },
        warnings: [],
    };
}

/** 分支名 `<type>/<Work 编号>-<Task 编号>-…` 解析成面板里的 Task（找得到才给链接）。 */
function taskOfBranch(state: PanelState, branch: string): {workId: string; taskId: string} | null {
    const match = /^[a-z]+\/(w\d{5})-(t\d{2,3})-/u.exec(branch);
    if (!match) return null;
    for (const work of state.records.part.value?.records.works ?? []) {
        if (!work.workId.startsWith(`${match[1]}-`)) continue;
        const task = work.tasks.find((entry) => entry.taskId.startsWith(`${match[2]}-`));
        if (task) return {workId: work.workId, taskId: task.taskId};
    }
    return null;
}

export function githubView(state: PanelState, view: GithubView): {data: unknown; warnings: Warning[]} {
    return {data: {...view, prs: view.prs.map((pr: PrView) => ({...pr, task: taskOfBranch(state, pr.branch)}))}, warnings: []};
}
