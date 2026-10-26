import {randomBytes} from "node:crypto";
import {chmod, mkdir, readdir, readFile, rename, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {setTimeout as sleep} from "node:timers/promises";
import {NbdevError, systemErrorCode, type Warning} from "./errors.js";
import {isIsoTime, isNullableString, isRecord} from "./json.js";
import {acquireDirectoryLock, agentPaths, type RecordsLock} from "./lock.js";
import {processAlive, readBootId, readProcStat, readProcStats, type ProcStat} from "./procfs.js";
import {AGENT_LOCAL_ROOT} from "./registry.js";

/**
 * 经 nbdev 起的进程的登记（t14）：主工作区 `.local/agent/run/procs/<runId>.json`（`nbdev.proc/v1`）。格式见 docs/file-formats.md。
 *
 * 一份运行由三样组成（t14 设计审查 B1、I1）：监管进程；`setsid` 起的组长（pid 等于组号）；从组长沿 ppid 收集到的后代快照，
 * 含另起进程组、另起会话的（master 的 `dev` 经 owned-process 把运行时放进另一个会话）。后代被收养到 PID 1 之后 ppid 链就断了，
 * 所以监管进程活着时要不断把快照记进登记。“还活着”与“停”都按这三样，不只看组长。
 */

export const PROC_SCHEMA = "nbdev.proc/v1";
export const PROCS_DIR = `${AGENT_LOCAL_ROOT}/run/procs`;
const PROCS_LOCK = `${AGENT_LOCAL_ROOT}/run/procs.lock`;
const MAX_DESCENDANTS = 256;

export type ProcRef = {pid: number; startTicks: string};
export type StartedBy = {key: string; agent: string; label: string | null; process: ProcRef | null};
export type ProcRecord = {
    schema: typeof PROC_SCHEMA;
    runId: string;
    kind: "dev";
    checkout: string;
    checkoutKey: string;
    package: string;
    script: string;
    argv: string[];
    readyPattern: string | null;
    /** 起时带了 `--sample`（应用收到 `NBDEV_SAMPLE=1`）；t18 之前的登记没有这个字段，按 false 读。 */
    sample: boolean;
    workId: string | null;
    taskId: string | null;
    logPath: string;
    bootId: string;
    startedAt: string;
    startedBy: StartedBy | null;
    supervisor: ProcRef;
    pid: number | null;
    pgid: number | null;
    startTicks: string | null;
    descendants: ProcRef[];
    url: string | null;
    readyAt: string | null;
    lastProbeStatus: number | null;
    stoppingAt: string | null;
    stoppedBy: string | null;
    endedAt: string | null;
    endedReason: string | null;
    exitCode: number | null;
    signal: string | null;
    leftovers: number | null;
    leftoverPids: number[];
};

export type RunState = "starting" | "running" | "orphaned" | "ended";
export type RunEvaluation = {state: RunState; reason: string | null; supervisorAlive: boolean; leaderAlive: boolean; groupAlive: boolean; aliveDescendants: ProcRef[]};

export function procsPaths(mainRoot: string): {dir: string; lockDir: string; tmpRoot: string} {
    return {dir: resolve(mainRoot, PROCS_DIR), lockDir: resolve(mainRoot, PROCS_LOCK), tmpRoot: agentPaths(mainRoot).tmpRoot};
}

/** `dev-<YYYYMMDDTHHMMSSZ>-<8 位十六进制>`：时间精确到秒再加随机尾巴，日志名带它，同一秒起两份也不会撞（设计审查 S3）。 */
export function newRunId(now: Date = new Date()): string {
    const stamp = now.toISOString().replace(/[-:]/gu, "").replace(/\.\d+Z$/u, "Z");
    return `dev-${stamp}-${randomBytes(4).toString("hex")}`;
}

export async function withProcsLock<T>(mainRoot: string, work: () => Promise<T>, waitMs = 30_000): Promise<T> {
    const {lockDir, tmpRoot} = procsPaths(mainRoot);
    await mkdir(resolve(lockDir, ".."), {recursive: true});
    const lock: RecordsLock = await acquireDirectoryLock(lockDir, tmpRoot, waitMs, "进程登记锁");
    try {
        return await work();
    } finally {
        await lock.release();
    }
}

function isProcRef(value: unknown): value is ProcRef {
    return isRecord(value) && Number.isInteger(value.pid) && typeof value.startTicks === "string";
}

function parseStartedBy(value: unknown): StartedBy | null {
    if (!isRecord(value) || typeof value.key !== "string" || typeof value.agent !== "string") return null;
    return {key: value.key, agent: value.agent, label: typeof value.label === "string" ? value.label : null, process: isProcRef(value.process) ? value.process : null};
}

/** 读一份登记；字段不对时回 null（调用方给警告、跳过）。 */
export function parseProcRecord(value: unknown): ProcRecord | null {
    if (!isRecord(value) || value.schema !== PROC_SCHEMA || typeof value.runId !== "string" || !/^dev-[0-9TZ]+-[0-9a-f]{8}$/u.test(value.runId)) return null;
    if (typeof value.checkout !== "string" || typeof value.package !== "string" || typeof value.script !== "string" || typeof value.logPath !== "string" || typeof value.bootId !== "string") return null;
    if (!isIsoTime(value.startedAt) || !isProcRef(value.supervisor)) return null;
    const nullableInt = (entry: unknown) => (Number.isInteger(entry) ? entry as number : null);
    return {
        schema: PROC_SCHEMA,
        runId: value.runId,
        kind: "dev",
        checkout: value.checkout,
        checkoutKey: typeof value.checkoutKey === "string" ? value.checkoutKey : "",
        package: value.package,
        script: value.script,
        argv: Array.isArray(value.argv) ? value.argv.filter((entry): entry is string => typeof entry === "string") : [],
        readyPattern: isNullableString(value.readyPattern) ? value.readyPattern : null,
        sample: value.sample === true,
        workId: isNullableString(value.workId) ? value.workId : null,
        taskId: isNullableString(value.taskId) ? value.taskId : null,
        logPath: value.logPath,
        bootId: value.bootId,
        startedAt: value.startedAt,
        startedBy: parseStartedBy(value.startedBy),
        supervisor: value.supervisor,
        pid: nullableInt(value.pid),
        pgid: nullableInt(value.pgid),
        startTicks: typeof value.startTicks === "string" ? value.startTicks : null,
        descendants: Array.isArray(value.descendants) ? value.descendants.filter(isProcRef) : [],
        url: isNullableString(value.url) ? value.url : null,
        readyAt: isIsoTime(value.readyAt) ? value.readyAt : null,
        lastProbeStatus: nullableInt(value.lastProbeStatus),
        stoppingAt: isIsoTime(value.stoppingAt) ? value.stoppingAt : null,
        stoppedBy: isNullableString(value.stoppedBy) ? value.stoppedBy : null,
        endedAt: isIsoTime(value.endedAt) ? value.endedAt : null,
        endedReason: isNullableString(value.endedReason) ? value.endedReason : null,
        exitCode: nullableInt(value.exitCode),
        signal: isNullableString(value.signal) ? value.signal : null,
        leftovers: nullableInt(value.leftovers),
        leftoverPids: Array.isArray(value.leftoverPids) ? value.leftoverPids.filter((entry): entry is number => Number.isInteger(entry)) : [],
    };
}

/** 全部登记；读不出的跳过并给 `unreadable_proc_record`。 */
export async function readProcRecords(mainRoot: string): Promise<{records: ProcRecord[]; warnings: Warning[]}> {
    const {dir} = procsPaths(mainRoot);
    let names: string[];
    try {
        names = await readdir(dir);
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT") return {records: [], warnings: []};
        throw error;
    }
    const records: ProcRecord[] = [];
    const warnings: Warning[] = [];
    for (const name of names.filter((entry) => entry.endsWith(".json")).sort()) {
        const path = join(dir, name);
        try {
            const record = parseProcRecord(JSON.parse(await readFile(path, "utf8")));
            if (record) records.push(record);
            else warnings.push({code: "unreadable_proc_record", message: `进程登记的格式不对，已跳过：${path}`, details: {path}});
        } catch (error) {
            if (systemErrorCode(error) === "ENOENT") continue;
            if (!(error instanceof SyntaxError)) throw error;
            warnings.push({code: "unreadable_proc_record", message: `进程登记不是合法 JSON，已跳过：${path}`, details: {path}});
        }
    }
    return {records, warnings};
}

export async function readProcRecord(mainRoot: string, runId: string): Promise<ProcRecord | null> {
    try {
        return parseProcRecord(JSON.parse(await readFile(join(procsPaths(mainRoot).dir, `${runId}.json`), "utf8")));
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT") return null;
        if (error instanceof SyntaxError) return null;
        throw error;
    }
}

/** 写一份登记（写临时文件再改名，目录 700、文件 600）。调用方持有 `withProcsLock`。 */
export async function writeProcRecord(mainRoot: string, record: ProcRecord): Promise<void> {
    const {dir, tmpRoot} = procsPaths(mainRoot);
    await mkdir(dir, {recursive: true, mode: 0o700});
    await chmod(dir, 0o700);
    await mkdir(tmpRoot, {recursive: true});
    const staging = join(tmpRoot, `proc-${record.runId}-${randomBytes(4).toString("hex")}.json`);
    await writeFile(staging, `${JSON.stringify(record, null, 4)}\n`, {mode: 0o600, flag: "wx"});
    await rename(staging, join(dir, `${record.runId}.json`));
}

/** 在锁里重读、改、写回：监管进程与 `dev stop` 都改同一份文件，各改各的字段（设计审查 S4）。读不到时返回 null，什么都不写。 */
export async function updateProcRecord(mainRoot: string, runId: string, mutate: (record: ProcRecord) => void, waitMs?: number): Promise<ProcRecord | null> {
    return withProcsLock(mainRoot, async () => {
        const record = await readProcRecord(mainRoot, runId);
        if (!record) return null;
        mutate(record);
        await writeProcRecord(mainRoot, record);
        return record;
    }, waitMs);
}

/** 这个号上有没有进程组（不管是谁的）。EPERM 是别的用户的组，不会是我们起的。 */
function anyGroupAt(pgid: number): boolean {
    try {
        process.kill(-pgid, 0);
        return true;
    } catch (error) {
        const code = systemErrorCode(error);
        if (code === "ESRCH" || code === "EPERM") return false;
        throw error;
    }
}

function leaderRef(record: ProcRecord): ProcRef | null {
    return record.pid !== null && record.startTicks !== null ? {pid: record.pid, startTicks: record.startTicks} : null;
}

/**
 * 登记的进程组还在、而且仍是我们那一组（t14 实现审查 I1）。我们的组还有成员时，Linux 不把这个号分给新进程；组空了以后号可以再分配，
 * 新进程再 `setsid` 就成了同号的另一组。所以：
 * - `/proc/<组号>` 在：是登记的组长本人（启动时刻对得上）才算，对不上说明号已被复用、我们的组早就空了；
 * - `/proc/<组号>` 不在、这个号上却有组：要有 `members` 里的进程（pid 与启动时刻都对得上）在这个组里，否则不算，只按快照判断。
 */
export async function ownGroupAlive(record: Pick<ProcRecord, "pgid" | "startTicks">, members: readonly ProcRef[]): Promise<boolean> {
    const pgid = record.pgid;
    if (pgid === null || pgid <= 1 || !anyGroupAt(pgid)) return false;
    const holder = await readProcStat(pgid);
    if (holder) return holder.startTicks === record.startTicks;
    for (const member of members) {
        const stat = await readProcStat(member.pid);
        if (stat && stat.startTicks === member.startTicks && stat.pgrp === pgid) return true;
    }
    return false;
}

/** 按“监管进程、组长、进程组、快照”四样判断状态（设计审查 I1、S1、I2）。 */
export async function evaluateRun(record: ProcRecord, bootId: string): Promise<RunEvaluation> {
    const dead: RunEvaluation = {state: "ended", reason: null, supervisorAlive: false, leaderAlive: false, groupAlive: false, aliveDescendants: []};
    if (record.bootId !== bootId) return {...dead, reason: "rebooted"};
    if (record.endedAt) return {...dead, reason: record.endedReason ?? "exited"};
    const supervisorAlive = await processAlive(record.supervisor);
    const leader = leaderRef(record);
    if (!leader) return supervisorAlive ? {...dead, state: "starting", supervisorAlive} : {...dead, reason: "never_started"};
    const leaderAlive = await processAlive(leader);
    const group = !leaderAlive && await ownGroupAlive(record, record.descendants);
    const aliveDescendants: ProcRef[] = [];
    for (const entry of record.descendants) if (await processAlive(entry)) aliveDescendants.push(entry);
    const anything = supervisorAlive || leaderAlive || group || aliveDescendants.length > 0;
    // 停完还有残留时登记先写了原因、没写 endedAt（t14 实现审查 S2）：残留后来自己没了，按写下的原因算。
    if (!anything) return {...dead, reason: record.endedReason ?? (record.stoppingAt ? "stopped" : "supervisor_killed")};
    if (!supervisorAlive) return {state: "orphaned", reason: leaderAlive ? "supervisor_gone" : "leader_exited", supervisorAlive, leaderAlive, groupAlive: group, aliveDescendants};
    return {state: record.readyAt ? "running" : "starting", reason: null, supervisorAlive, leaderAlive, groupAlive: group, aliveDescendants};
}

/**
 * 从根进程沿 ppid 收集后代（含另起进程组、另起会话的），并上已知快照里还活着的；每个记 pid 与启动时刻。
 * 快照里的进程也当作根继续往下收：它们可能已被收养到 PID 1，但它们自己的子进程仍挂在它们下面。
 * `group`：这个进程组里的进程也算（被收养后 ppid 链断了的组员）。只有调用方确知这个组是我们的才给：组长还在（启动时刻对得上），
 * 或监管进程刚给组长收了尸（组里还有进程时组号不会被复用）。
 */
export async function collectDescendants(roots: readonly ProcRef[], known: readonly ProcRef[], group: number | null = null): Promise<ProcRef[]> {
    const stats = await readProcStats();
    const members = group === null ? [] : stats.filter((stat) => stat.pgrp === group && stat.pid !== group).map((stat) => ({pid: stat.pid, startTicks: stat.startTicks}));
    const seeds = [...known, ...members];
    const byPid = new Map<number, ProcStat>(stats.map((stat) => [stat.pid, stat]));
    const children = new Map<number, ProcStat[]>();
    for (const stat of stats) {
        const list = children.get(stat.ppid) ?? [];
        list.push(stat);
        children.set(stat.ppid, list);
    }
    const result = new Map<number, ProcRef>();
    const queue: number[] = [];
    for (const root of [...roots, ...seeds]) {
        const stat = byPid.get(root.pid);
        if (!stat || stat.startTicks !== root.startTicks) continue;
        if (!roots.some((entry) => entry.pid === root.pid)) result.set(root.pid, root);
        queue.push(root.pid);
    }
    while (queue.length > 0 && result.size < MAX_DESCENDANTS) {
        const pid = queue.shift()!;
        for (const child of children.get(pid) ?? []) {
            if (result.has(child.pid) || roots.some((entry) => entry.pid === child.pid)) continue;
            result.set(child.pid, {pid: child.pid, startTicks: child.startTicks});
            queue.push(child.pid);
        }
    }
    return [...result.values()];
}

function signal(pid: number, name: NodeJS.Signals): boolean {
    try {
        process.kill(pid, name);
        return true;
    } catch (error) {
        const code = systemErrorCode(error);
        if (code === "ESRCH") return false;
        throw error;
    }
}

/** 核对启动时刻之后再发信号：pid 被复用时不碰别人的进程。 */
async function signalRef(ref: ProcRef, name: NodeJS.Signals): Promise<boolean> {
    return await processAlive(ref) && signal(ref.pid, name);
}

export type StopOutcome = {clean: boolean; leftoverPids: number[]; urlResponding: boolean; killed: number; snapshot: ProcRef[]};

/** 就绪地址还回不回应：连得上（任何 HTTP 回应）就是还在。 */
export async function urlResponds(url: string, timeoutMs = 1_000): Promise<boolean> {
    try {
        await fetch(url, {signal: AbortSignal.timeout(timeoutMs), redirect: "manual"});
        return true;
    } catch (error) {
        if (error instanceof Error) return false;
        throw error;
    }
}

/**
 * 停一份运行（设计审查 B1、I1）：
 * 1. 重收快照；
 * 2. 组长还在：只给组长发 SIGTERM，由 `bun run` 转给开发脚本、按它自己的顺序收口（master 的 source-dev 经 owned-process 收掉另一会话里的运行时）；
 *    组长已不在：给进程组与快照里还活着的进程各发 SIGTERM；
 * 3. 宽限期内每 250 毫秒重收一次后代，全部不在就结束；
 * 4. 到期对快照里仍活着、启动时刻对得上的进程逐个 SIGKILL，再对进程组 SIGKILL；
 * 5. 核对：快照与进程组都不在、就绪地址连不上，才算干净。
 * 只碰登记的组长、它的进程组与收集到的快照，每个都核对 pid 与启动时刻；从不按命令行文本找进程。
 */
export async function stopRunProcesses(record: ProcRecord, options: {graceMs: number}): Promise<StopOutcome> {
    const leader = leaderRef(record);
    const roots = leader ? [leader] : [];
    // 组长还在时组是我们的，组里的进程一并记进快照：组长退出之后，读者只凭快照里的组员认这个组（ownGroupAlive）。
    const collect = async (known: readonly ProcRef[]) => collectDescendants(roots, known, leader !== null && await processAlive(leader) ? record.pgid : null);
    let snapshot = await collect(record.descendants);
    const leaderAlive = leader !== null && await processAlive(leader);
    if (leaderAlive) signal(leader.pid, "SIGTERM");
    else {
        if (await ownGroupAlive(record, snapshot)) signal(-record.pgid!, "SIGTERM");
        for (const entry of snapshot) await signalRef(entry, "SIGTERM");
    }
    const anyAlive = async () => {
        if (leader && await processAlive(leader)) return true;
        if (await ownGroupAlive(record, snapshot)) return true;
        for (const entry of snapshot) if (await processAlive(entry)) return true;
        return false;
    };
    const deadline = Date.now() + options.graceMs;
    while (Date.now() < deadline) {
        snapshot = mergeRefs(snapshot, await collect(snapshot));
        if (!await anyAlive()) break;
        await sleep(250);
    }
    let killed = 0;
    if (await anyAlive()) {
        snapshot = mergeRefs(snapshot, await collect(snapshot));
        for (const entry of [...(leader ? [leader] : []), ...snapshot]) if (await signalRef(entry, "SIGKILL")) killed += 1;
        if (await ownGroupAlive(record, snapshot)) signal(-record.pgid!, "SIGKILL");
        for (let waited = 0; waited < 2_000 && await anyAlive(); waited += 100) await sleep(100);
    }
    const leftoverPids: number[] = [];
    if (leader && await processAlive(leader)) leftoverPids.push(leader.pid);
    for (const entry of snapshot) if (await processAlive(entry)) leftoverPids.push(entry.pid);
    const urlResponding = record.url !== null && await urlResponds(record.url);
    return {clean: leftoverPids.length === 0 && !await ownGroupAlive(record, snapshot) && !urlResponding, leftoverPids, urlResponding, killed, snapshot};
}

export function mergeRefs(a: readonly ProcRef[], b: readonly ProcRef[]): ProcRef[] {
    const map = new Map<string, ProcRef>();
    for (const entry of [...a, ...b]) map.set(`${entry.pid}:${entry.startTicks}`, entry);
    return [...map.values()].slice(0, MAX_DESCENDANTS);
}

export type RunView = ProcRecord & RunEvaluation;

/** `dev status` 与面板共用：全部登记加现算的状态。 */
export async function listProcRuns(mainRoot: string): Promise<{runs: RunView[]; warnings: Warning[]}> {
    const {records, warnings} = await readProcRecords(mainRoot);
    const bootId = await readBootId();
    const runs: RunView[] = [];
    for (const record of records) runs.push({...record, ...await evaluateRun(record, bootId)});
    return {runs, warnings};
}

export async function currentBootId(): Promise<string> {
    return readBootId();
}

export function assertRunId(runId: string): string {
    if (!/^dev-[0-9TZ]+-[0-9a-f]{8}$/u.test(runId)) throw new NbdevError("usage", `runId 的写法不对：${runId}`);
    return runId;
}
