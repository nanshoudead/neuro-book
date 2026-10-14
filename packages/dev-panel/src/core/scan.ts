import {gitOutput, runGit, splitLines, splitNul} from "./git.js";
import {parseTaskId, parseWorkId, TASK_ID_PATTERN, taskNumberLabel, WORK_ID_PATTERN, workNumberLabel} from "./ids.js";
import {listTaskIds, listWorkIds} from "./records.js";
import type {Registry} from "./registry.js";
import {MASTER_REF, WORKS_ROOT, type CheckoutInfo} from "./repo.js";

/** 一个 id 出现的位置：主工作区或 linked worktree 的工作区（含未跟踪），或某个 ref 的已提交树。 */
export type IdLocation = {source: "main" | "worktree" | "ref"; checkout?: string; ref?: string; head?: string};

export type NumberScan = {
    /** Work id → 出现的位置。 */
    works: Map<string, IdLocation[]>;
    /** Work id → Task id → 出现的位置。Task 号按完整的 Work id 分别计数。 */
    tasks: Map<string, Map<string, IdLocation[]>>;
    registry: Registry;
};

export type ConflictId = {id: string; live: boolean; locations: IdLocation[]};
export type NumberConflict = {kind: "work" | "task"; label: string; workId?: string; ids: ConflictId[]; live: boolean};

function addLocation(map: Map<string, IdLocation[]>, id: string, location: IdLocation): void {
    const locations = map.get(id);
    if (locations) locations.push(location);
    else map.set(id, [location]);
}

function addTaskLocation(scan: NumberScan, workId: string, taskId: string, location: IdLocation): void {
    let tasks = scan.tasks.get(workId);
    if (!tasks) {
        tasks = new Map();
        scan.tasks.set(workId, tasks);
    }
    addLocation(tasks, taskId, location);
}

/**
 * 扫描已用的编号：各 checkout 的工作区（含未提交、未跟踪的目录），全部本地分支与远程跟踪分支的已提交树（不 fetch）。
 * ref 按 `.agents/works` 树对象去重后每棵树只列一次（本机 113 个 ref 去重成 23 棵树）。
 */
export async function scanNumbers(mainRoot: string, checkouts: readonly CheckoutInfo[], registry: Registry): Promise<NumberScan> {
    const scan: NumberScan = {works: new Map(), tasks: new Map(), registry};
    await Promise.all(checkouts.filter((checkout) => !checkout.prunable).map(async (checkout) => {
        const location: IdLocation = {source: checkout.isMain ? "main" : "worktree", checkout: checkout.root, head: checkout.head};
        for (const workId of await listWorkIds(checkout.root)) {
            addLocation(scan.works, workId, location);
            for (const taskId of await listTaskIds(checkout.root, workId)) addTaskLocation(scan, workId, taskId, location);
        }
    }));

    const refs = splitLines(await gitOutput(mainRoot, ["for-each-ref", "--format=%(objectname) %(refname)", "refs/heads", "refs/remotes"], {readOnly: true}))
        .map((line) => {
            const separator = line.indexOf(" ");
            return {sha: line.slice(0, separator), ref: line.slice(separator + 1)};
        });
    const commits = [...new Set(refs.map((ref) => ref.sha))];
    const checkOutput = await gitOutput(mainRoot, ["cat-file", "--batch-check"], {readOnly: true, input: commits.map((sha) => `${sha}:${WORKS_ROOT}\n`).join("")});
    const treeByCommit = new Map<string, string>();
    for (const [index, line] of splitLines(checkOutput).entries()) {
        const [oid, type] = line.split(" ");
        const commit = commits[index];
        if (commit && oid && type === "tree") treeByCommit.set(commit, oid);
    }
    const idsByTree = new Map<string, {works: string[]; tasks: Array<[string, string]>}>();
    await Promise.all([...new Set(treeByCommit.values())].map(async (tree) => {
        const works: string[] = [];
        const tasks: Array<[string, string]> = [];
        for (const path of splitNul(await gitOutput(mainRoot, ["ls-tree", "-r", "-d", "-z", "--name-only", tree], {readOnly: true}))) {
            const segments = path.split("/");
            if (segments.length === 1 && WORK_ID_PATTERN.test(segments[0] ?? "")) works.push(segments[0]!);
            else if (segments.length === 3 && segments[1] === "tasks" && WORK_ID_PATTERN.test(segments[0] ?? "") && TASK_ID_PATTERN.test(segments[2] ?? "")) {
                tasks.push([segments[0]!, segments[2]!]);
            }
        }
        idsByTree.set(tree, {works, tasks});
    }));
    for (const {sha, ref} of refs) {
        const tree = treeByCommit.get(sha);
        const ids = tree ? idsByTree.get(tree) : undefined;
        if (!ids) continue;
        const location: IdLocation = {source: "ref", ref, head: sha};
        for (const workId of ids.works) addLocation(scan.works, workId, location);
        for (const [workId, taskId] of ids.tasks) addTaskLocation(scan, workId, taskId, location);
    }
    return scan;
}

/** 扫描到的全部 id，供登记表补登：Work id → Task id 列表。 */
export function scannedIds(scan: NumberScan): Map<string, string[]> {
    const result = new Map<string, string[]>();
    for (const workId of scan.works.keys()) result.set(workId, []);
    for (const [workId, tasks] of scan.tasks) result.set(workId, [...tasks.keys()]);
    return result;
}

/** 下一个 Work 序号：所有来源（含登记表的三种状态）的最大值加一，不补空号。 */
export function nextWorkNumber(scan: NumberScan): number {
    let max = 0;
    for (const workId of [...scan.works.keys(), ...scan.registry.works.map((work) => work.workId)]) {
        max = Math.max(max, parseWorkId(workId)?.number ?? 0);
    }
    return max + 1;
}

export function nextTaskNumber(scan: NumberScan, workId: string): number {
    let max = 0;
    const registered = scan.registry.works.find((work) => work.workId === workId)?.tasks.map((task) => task.taskId) ?? [];
    for (const taskId of [...(scan.tasks.get(workId)?.keys() ?? []), ...registered]) {
        max = Math.max(max, parseTaskId(taskId)?.number ?? 0);
    }
    return max + 1;
}

/**
 * 判定一个 id 的某一处位置是不是 `master` 改名或删除后留下的旧副本：
 * 它在 `merge-base(该 HEAD, master)` 的树里存在，而在已提交的 `master` 里已不存在。
 */
class InheritanceChecker {
    private readonly mergeBases = new Map<string, Promise<string | null>>();

    constructor(private readonly mainRoot: string) {}

    private mergeBase(head: string): Promise<string | null> {
        let cached = this.mergeBases.get(head);
        if (!cached) {
            cached = runGit(this.mainRoot, ["merge-base", head, MASTER_REF], {readOnly: true}).then((result) => result.exitCode === 0 ? result.stdout.trim() : null);
            this.mergeBases.set(head, cached);
        }
        return cached;
    }

    private async exists(rev: string, path: string): Promise<boolean> {
        return (await runGit(this.mainRoot, ["cat-file", "-e", `${rev}:${path}`], {readOnly: true})).exitCode === 0;
    }

    async isLive(locations: readonly IdLocation[], path: string): Promise<boolean> {
        // 主工作区里有，或已提交的 master 里还有，就不可能是“master 改名或删除后留下的旧副本”。
        if (locations.some((location) => location.source === "main" || !location.head)) return true;
        if (await this.exists(MASTER_REF, path)) return true;
        for (const location of locations) {
            const base = await this.mergeBase(location.head!);
            if (!base || !await this.exists(base, path)) return true;
        }
        return false;
    }
}

function groupByNumber(ids: Iterable<string>, parse: (id: string) => {number: number} | null): Map<number, string[]> {
    const groups = new Map<number, string[]>();
    for (const id of ids) {
        const number = parse(id)?.number;
        if (number === undefined) continue;
        const group = groups.get(number);
        if (group) group.push(id);
        else groups.set(number, [id]);
    }
    return groups;
}

/** 一次领的号：Work 号（`w00023`），或某个 Work（完整 id）里的 Task 号（`t02`）。 */
export type ClaimedNumber = {kind: "work"; number: string} | {kind: "task"; workId: string; number: string};

/**
 * 把撞号分成与这次领号有关的和其余的：领号命令只报前者，其余的只给组数，完整列表看 `nbdev status`。
 * Task 撞号按完整 workId 加 Task 号匹配，不拿裸的 `t01` 与别的 Work 比。
 */
export function partitionConflicts(conflicts: readonly NumberConflict[], claimed: readonly ClaimedNumber[]): {related: NumberConflict[]; others: number} {
    const keys = new Set(claimed.map((entry) => entry.kind === "work" ? `work ${entry.number}` : `task ${entry.workId}/${entry.number}`));
    const related = conflicts.filter((conflict) => keys.has(`${conflict.kind} ${conflict.label}`));
    return {related, others: conflicts.length - related.length};
}

/**
 * 撞号：同一序号在工作区或 ref 里出现两个以上不同的 id。至少两个 id 不是旧副本时，这组撞号 `live`。
 * 登记表只保留号段，不作为撞号的位置；登记了但哪里都找不到的 id 列进 `registryOnly`。
 */
export async function findConflicts(mainRoot: string, scan: NumberScan): Promise<{conflicts: NumberConflict[]; registryOnly: string[]}> {
    const checker = new InheritanceChecker(mainRoot);
    const conflicts: NumberConflict[] = [];
    for (const [number, ids] of groupByNumber(scan.works.keys(), parseWorkId)) {
        if (ids.length < 2) continue;
        const entries = await Promise.all(ids.sort().map(async (id) => {
            const locations = scan.works.get(id) ?? [];
            return {id, locations, live: await checker.isLive(locations, `${WORKS_ROOT}/${id}`)};
        }));
        conflicts.push({kind: "work", label: workNumberLabel(number), ids: entries, live: entries.filter((entry) => entry.live).length >= 2});
    }
    for (const [workId, tasks] of [...scan.tasks].sort(([left], [right]) => left.localeCompare(right, "en"))) {
        for (const [number, ids] of groupByNumber(tasks.keys(), parseTaskId)) {
            if (ids.length < 2) continue;
            const entries = await Promise.all(ids.sort().map(async (id) => {
                const locations = tasks.get(id) ?? [];
                return {id, locations, live: await checker.isLive(locations, `${WORKS_ROOT}/${workId}/tasks/${id}`)};
            }));
            conflicts.push({kind: "task", label: `${workId}/${taskNumberLabel(number)}`, workId, ids: entries, live: entries.filter((entry) => entry.live).length >= 2});
        }
    }
    const registryOnly: string[] = [];
    for (const work of scan.registry.works) {
        if (!scan.works.has(work.workId) && !scan.tasks.has(work.workId)) registryOnly.push(work.workId);
        for (const task of work.tasks) {
            if (!scan.tasks.get(work.workId)?.has(task.taskId)) registryOnly.push(`${work.workId}/${task.taskId}`);
        }
    }
    return {conflicts, registryOnly: registryOnly.sort()};
}
