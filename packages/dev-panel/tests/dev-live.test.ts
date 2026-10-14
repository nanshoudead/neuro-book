import {afterEach, describe, expect, test} from "bun:test";
import {spawn, type ChildProcess} from "node:child_process";
import {randomUUID} from "node:crypto";
import {once} from "node:events";
import {existsSync, readFileSync} from "node:fs";
import {appendFile, readdir, readFile, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {setTimeout as sleep} from "node:timers/promises";
import {processAlive, processStartTicks, readProcStat} from "../src/core/procfs.js";
import {collectDescendants, parseProcRecord, PROCS_DIR, type ProcRecord} from "../src/core/procs.js";
import {SAMPLE_SILENT_REASON} from "../src/dev/sample.js";
import {cleanupFixtures, CLI_PATH, createFixture, run, type Fixture, type RunResult} from "./git-fixture.js";
import {startFakeClaude, type FakeClaude} from "./processes.js";

/**
 * t14 的 L4：真实进程、假开发脚本（`tests/fixtures/fake-dev.ts`，经临时 `package.json` 的 `scripts.dev` 由真实的 `bun run` 起），
 * 只在临时仓库里起，不碰真实仓库。场景 1 到 3 与设计审查 I6 的几条路径：监管进程被 SIGKILL、组长先退留下孙进程、另起会话的运行时、
 * 忽略 SIGTERM、仿 TaskStop 的整树信号。每条用例结束都按登记与 pid 文件核对进程都不在了。
 */

const FAKE_DEV = resolve(import.meta.dirname, "fixtures", "fake-dev.ts");
const SESSION_A = "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION_B = "bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const step of cleanups.splice(0).reverse()) await step();
    await cleanupFixtures();
});

async function until<T>(read: () => T | Promise<T>, ok: (value: T) => boolean, ms: number, what: string): Promise<T> {
    const started = Date.now();
    for (;;) {
        const value = await read();
        if (ok(value)) return value;
        if (Date.now() - started > ms) throw new Error(`${ms} 毫秒内没等到：${what}（最后 ${JSON.stringify(value)}）`);
        await sleep(50);
    }
}

type Setup = {fixture: Fixture; pidsFile: string; env: Record<string, string>};

/** 临时仓库里放一个 `apps/web`，`dev` 脚本跑假开发脚本；`FAKE_DEV_PIDS` 记下各角色的 pid。 */
async function setup(name: string, fakeEnv: Record<string, string> = {}): Promise<Setup> {
    const fixture = await createFixture(name);
    await fixture.write("apps/web/package.json", JSON.stringify({name: "web", private: true, scripts: {dev: `bun ${FAKE_DEV}`, other: `bun ${FAKE_DEV}`}}));
    const pidsFile = join(fixture.root, "pids.txt");
    await writeFile(pidsFile, "");
    const env = {FAKE_DEV_PIDS: pidsFile, ...fakeEnv};
    // 兜底：用例失败时按 pid 文件与登记收掉留下的进程（只发给自己起的、核对过启动时刻的）。
    cleanups.push(async () => {
        const pids = new Set<number>(readFileSync(pidsFile, "utf8").split("\n").filter(Boolean).map((line) => Number(line.split(" ")[1])));
        for (const record of await records(fixture)) {
            pids.add(record.supervisor.pid);
            if (record.pid) pids.add(record.pid);
        }
        for (const pid of pids) {
            try {
                process.kill(pid, "SIGKILL");
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
            }
        }
    });
    return {fixture, pidsFile, env};
}

async function records(fixture: Fixture): Promise<ProcRecord[]> {
    const dir = join(fixture.main, PROCS_DIR);
    if (!existsSync(dir)) return [];
    const result: ProcRecord[] = [];
    for (const name of (await readdir(dir)).filter((entry) => entry.endsWith(".json"))) {
        const record = parseProcRecord(JSON.parse(await readFile(join(dir, name), "utf8")));
        if (record) result.push(record);
    }
    return result;
}

function fakePids(pidsFile: string): Array<{role: string; pid: number}> {
    return readFileSync(pidsFile, "utf8").split("\n").filter(Boolean).map((line) => ({role: line.split(" ")[0]!, pid: Number(line.split(" ")[1])}));
}

function alivePids(pidsFile: string): number[] {
    return fakePids(pidsFile).filter((entry) => entry.role !== "term").map((entry) => entry.pid).filter((pid) => existsSync(`/proc/${pid}`) && !readFileSync(`/proc/${pid}/stat`, "utf8").includes(") Z "));
}

type Supervisor = {pid: number; out: string; lines(): string[]; exited: Promise<number | null>; child: ChildProcess | null};

/** 在后台起 `nbdev dev start`（stdout 写进文件）：给了 `claude` 就以它的子进程起（属主是那个会话），否则以认不出的调用者起。 */
async function startDev(setupValue: Setup, args: string[], claude: FakeClaude | null = null): Promise<Supervisor> {
    const out = join(setupValue.fixture.root, `dev-${randomUUID()}.out`);
    await writeFile(out, "");
    const command = `exec '${process.execPath}' '${CLI_PATH}' dev start --package apps/web ${args.join(" ")} > '${out}' 2>> '${out}.err'`;
    let pid: number;
    let child: ChildProcess | null = null;
    let exited: Promise<number | null>;
    if (claude) {
        pid = await claude.spawn("/bin/sh", ["-c", command], {cwd: setupValue.fixture.main, env: setupValue.env});
        exited = until(() => existsSync(`/proc/${pid}`) && !readFileSync(`/proc/${pid}/stat`, "utf8").includes(") Z "), (alive) => !alive, 60_000, "监管进程退出").then(() => null);
    } else {
        child = spawn("/bin/sh", ["-c", command], {cwd: setupValue.fixture.main, env: {...process.env, ...setupValue.env}, stdio: "ignore"});
        pid = child.pid!;
        exited = once(child, "exit").then(([code]) => code as number | null);
    }
    cleanups.push(async () => {
        if (existsSync(`/proc/${pid}`)) {
            try {
                process.kill(pid, "SIGKILL");
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
            }
        }
    });
    return {pid, out, child, exited, lines: () => readFileSync(out, "utf8").split("\n").filter(Boolean)};
}

async function readyLine(supervisor: Supervisor, ms = 20_000): Promise<string> {
    const lines = await until(() => supervisor.lines(), (all) => all.some((line) => line.startsWith("READY ") || line.startsWith("NOT_READY ")), ms, "READY 行");
    return lines.find((line) => line.startsWith("READY ") || line.startsWith("NOT_READY "))!;
}

async function cli(setupValue: Setup, args: string[], claude: FakeClaude | null = null): Promise<{exitCode: number; stdout: string; stderr: string}> {
    if (claude) return claude.cli(args, setupValue.fixture.main, setupValue.env);
    return setupValue.fixture.cli(args, setupValue.fixture.main, setupValue.env);
}

async function urlUp(url: string): Promise<boolean> {
    try {
        await fetch(url, {signal: AbortSignal.timeout(1_000)});
        return true;
    } catch (error) {
        if (error instanceof Error) return false;
        throw error;
    }
}

async function claudes(): Promise<{a: FakeClaude; b: FakeClaude}> {
    const a = await startFakeClaude(SESSION_A);
    const b = await startFakeClaude(SESSION_B);
    cleanups.push(async () => {
        await a.stop();
        await b.stop();
    });
    return {a, b};
}

describe("dev start 与复用（场景 1）", () => {
    test("A 起服务后 B 再起：B 立即拿到 reused、同一个地址与 runId，带属主；两个会话同时起只有一份", async () => {
        const s = await setup("dev-reuse");
        const {a, b} = await claudes();
        const first = await startDev(s, [], a);
        const ready = await readyLine(first);
        expect(ready).toMatch(/^READY http:\/\/127\.0\.0\.1:\d+\/ run=dev-\S+ owner=claude:aaaaaaaa/u);
        const [, url, runPart] = /^READY (\S+) (run=\S+)/u.exec(ready)!;
        const second = await cli(s, ["dev", "start", "--package", "apps/web", "--json"], b);
        expect(second.exitCode).toBe(0);
        const event = JSON.parse(second.stdout.trim().split("\n")[0]!) as Record<string, unknown>;
        expect(event).toMatchObject({event: "ready", url, runId: runPart!.slice(4), reused: true, owner: `claude:${SESSION_A}`});
        expect(second.stderr).toContain("reused_other_owner");
        expect((await records(s.fixture)).length).toBe(1);
        // 同一个会话同时起两份：锁里起服务、写好 pid 再放锁，第二份一定复用（设计审查 I2）。
        const stop = await cli(s, ["dev", "stop", "--package", "apps/web"], a);
        expect(stop.exitCode).toBe(0);
        await first.exited;
        const [x, y] = await Promise.all([startDev(s, [], a), startDev(s, [], b)]);
        const [lineX, lineY] = await Promise.all([readyLine(x), readyLine(y)]);
        expect(/run=(\S+)/u.exec(lineX)![1]).toBe(/run=(\S+)/u.exec(lineY)![1]!);
        expect([lineX, lineY].filter((line) => line.includes(" reused")).length).toBe(1);
        expect((await records(s.fixture)).filter((record) => record.endedAt === null).length).toBe(1);
    }, 90_000);

    test("就绪识别：w00017 式等 backend-ready；5xx 不算就绪；认不出时 NOT_READY、服务照留；就绪前退出是 dev_exited；--ready-pattern", async () => {
        const nbook = await setup("dev-ready-nbook", {FAKE_DEV_STYLE: "nbook", FAKE_DEV_BACKEND_MS: "1500"});
        const started = Date.now();
        const sup = await startDev(nbook, []);
        expect(await readyLine(sup)).toMatch(/^READY /u);
        expect(Date.now() - started).toBeGreaterThan(1_500);
        const log = readFileSync((await records(nbook.fixture))[0]!.logPath, "utf8");
        expect(log).toContain("[dev] backend-ready");
        process.kill(sup.pid, "SIGTERM");
        expect(await sup.exited).toBe(0);
        await until(() => alivePids(nbook.pidsFile), (alive) => alive.length === 0, 10_000, "收干净");

        const failing = await setup("dev-ready-500", {FAKE_DEV_STATUS: "500"});
        const bad = await startDev(failing, ["--ready-timeout", "3"]);
        expect(await readyLine(bad)).toMatch(/^NOT_READY \S+ run=\S+ status=500/u);
        expect(alivePids(failing.pidsFile).length).toBeGreaterThan(0);
        process.kill(bad.pid, "SIGTERM");
        await bad.exited;

        const early = await setup("dev-exited", {FAKE_DEV_EXIT_MS: "300", FAKE_DEV_READY_MS: "5000"});
        const gone = await startDev(early, []);
        expect(await gone.exited).toBe(1);
        expect(gone.lines().at(-1)).toMatch(/^EXITED 3 run=/u);

        const custom = await setup("dev-pattern", {FAKE_DEV_STYLE: "nbook", FAKE_DEV_BACKEND_MS: "60000"});
        const patterned = await startDev(custom, ["--ready-pattern", "'page-ready (\\S+)'"]);
        expect(await readyLine(patterned)).toMatch(/^READY http:\/\/127\.0\.0\.1:\d+\/ /u);
        process.kill(patterned.pid, "SIGTERM");
        await patterned.exited;
    }, 90_000);
});

describe("dev stop 与属主（场景 2）", () => {
    test("B 不带 --force 停不了 A 的服务（退出码 3，写明属主）；带 --force 停干净，A 的监管进程打 EXITED 以 0 退出；属主会话不在时不用 --force", async () => {
        const s = await setup("dev-owner");
        const {a, b} = await claudes();
        const sup = await startDev(s, [], a);
        const url = /^READY (\S+)/u.exec(await readyLine(sup))![1]!;
        const refused = await cli(s, ["dev", "stop", "--package", "apps/web", "--json"], b);
        expect(refused.exitCode).toBe(3);
        const envelope = JSON.parse(refused.stdout) as {errors: Array<{code: string; details: {owner: {key: string}}}>};
        expect(envelope.errors[0]).toMatchObject({code: "run_owned_by_other", details: {owner: {key: `claude:${SESSION_A}`}}});
        const forced = await cli(s, ["dev", "stop", "--package", "apps/web", "--force"], b);
        expect(forced.exitCode).toBe(0);
        await sup.exited;
        expect(sup.lines().at(-1)).toMatch(/^EXITED /u);
        expect(alivePids(s.pidsFile)).toEqual([]);
        expect(await urlUp(url)).toBe(false);
        expect((await records(s.fixture))[0]).toMatchObject({endedReason: "stopped", stoppedBy: `claude:${SESSION_B}（--force）`});

        // 属主会话不在了：不用 --force。
        const again = await startDev(s, [], a);
        await readyLine(again);
        await a.stop();
        const free = await cli(s, ["dev", "stop", "--package", "apps/web"], b);
        expect(free.exitCode).toBe(0);
        await until(() => alivePids(s.pidsFile), (alive) => alive.length === 0, 10_000, "收干净");
    }, 90_000);
});

/** 手写一份登记（监管进程、组长由测试给定）。 */
async function writeRecord(s: Setup, runId: string, fields: Record<string, unknown>): Promise<void> {
    await s.fixture.write(`${PROCS_DIR}/${runId}.json`, JSON.stringify({
        schema: "nbdev.proc/v1", runId, kind: "dev", checkout: s.fixture.main, checkoutKey: "main", package: "apps/web", script: "dev", argv: ["bun", "run", "dev"],
        readyPattern: null, workId: null, taskId: null, logPath: join(s.fixture.root, "x.log"), bootId: readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(),
        startedAt: new Date().toISOString(), startedBy: null, descendants: [], url: null, readyAt: null, lastProbeStatus: null, stoppingAt: null, stoppedBy: null,
        endedAt: null, endedReason: null, exitCode: null, signal: null, leftovers: null, leftoverPids: [], ...fields,
    }));
}

/** 一个自己是组长的 sleep（pid 等于组号）。 */
async function detachedSleep(): Promise<{pid: number; startTicks: string}> {
    const child = spawn("sleep", ["60"], {stdio: "ignore", detached: true});
    cleanups.push(async () => {
        child.kill("SIGKILL");
    });
    return {pid: child.pid!, startTicks: (await processStartTicks(child.pid!))!};
}

describe("复用的判据（t14 实现审查 I2）", () => {
    test("开发脚本已退、只剩孙进程（leader_exited）：不复用，先收掉残留（leftovers_stopped）再起新的", async () => {
        const s = await setup("dev-reuse-leftover", {FAKE_DEV_MODE: "leave"});
        const first = await startDev(s, []);
        const oldRun = /run=(\S+)/u.exec(await readyLine(first))![1]!;
        await until(async () => (await records(s.fixture))[0]!.descendants.length, (count) => count > 0, 10_000, "快照记下孙进程");
        const leftover = fakePids(s.pidsFile).find((entry) => entry.role === "sleep")!.pid;
        process.kill(first.pid, "SIGKILL");
        await first.exited;
        const orphan = async () => (JSON.parse((await cli(s, ["dev", "status", "--package", "apps/web", "--json"])).stdout) as {data: {runs: Array<{runId: string; state: string; reason: string}>}}).data.runs.find((run) => run.runId === oldRun)!;
        await until(orphan, (run) => run.state === "orphaned" && run.reason === "leader_exited", 10_000, "leader_exited");
        const second = await startDev(s, []);
        const line = await readyLine(second);
        expect(line).toMatch(/^READY /u);
        expect(line).not.toContain(" reused");
        expect(/run=(\S+)/u.exec(line)![1]).not.toBe(oldRun);
        expect(existsSync(`/proc/${leftover}`)).toBe(false);
        expect((await orphan()).state).toBe("ended");
        process.kill(second.pid, "SIGTERM");
        await second.exited;
        // 监管进程的警告在它退出时写 stderr。
        expect(readFileSync(`${second.out}.err`, "utf8")).toContain("leftovers_stopped");
        await until(() => alivePids(s.pidsFile), (alive) => alive.length === 0, 10_000, "收干净");
    }, 60_000);

    test("登记已就绪、地址连不上：dev start 报 dev_unresponsive（3），shot 不拿它的地址（5）；没人监管、地址连得上：复用并给 supervisor_gone，shot 拿它的地址", async () => {
        const s = await setup("dev-reuse-probe");
        await s.fixture.write("apps/web/package.json", JSON.stringify({name: "web", private: true, scripts: {dev: `bun ${FAKE_DEV}`, "lab:shot": "true"}}));
        const supervisor = await detachedSleep();
        const leader = await detachedSleep();
        const runId = "dev-20261013T000000Z-0000000d";
        await writeRecord(s, runId, {supervisor, pid: leader.pid, pgid: leader.pid, startTicks: leader.startTicks, url: "http://127.0.0.1:1/", readyAt: new Date().toISOString(), lastProbeStatus: 200});
        const dead = await cli(s, ["dev", "start", "--package", "apps/web", "--json"]);
        expect([dead.exitCode, (JSON.parse(dead.stdout) as {errors: Array<{code: string}>}).errors[0]?.code]).toEqual([3, "dev_unresponsive"]);
        const noShot = await cli(s, ["shot", "--package", "apps/web", "--json"]);
        expect([noShot.exitCode, (JSON.parse(noShot.stdout) as {errors: Array<{code: string}>}).errors[0]?.code]).toEqual([5, "dev_not_running"]);
        expect((await records(s.fixture)).length).toBe(1);

        const server = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: () => new Response("ok")});
        cleanups.push(async () => {
            await server.stop(true);
        });
        const url = `http://127.0.0.1:${server.port}/`;
        await writeRecord(s, runId, {supervisor: {pid: supervisor.pid, startTicks: `${supervisor.startTicks}0`}, pid: leader.pid, pgid: leader.pid, startTicks: leader.startTicks, url, readyAt: new Date().toISOString(), lastProbeStatus: 200});
        const reused = await cli(s, ["dev", "start", "--package", "apps/web", "--json"]);
        expect([reused.exitCode, JSON.parse(reused.stdout.trim().split("\n")[0]!)]).toEqual([0, expect.objectContaining({event: "ready", url, runId, reused: true})]);
        expect(reused.stderr).toContain("supervisor_gone");
        const shot = await cli(s, ["shot", "--package", "apps/web", "--json"]);
        expect([shot.exitCode, (JSON.parse(shot.stdout) as {data: {url: string}}).data.url]).toEqual([0, url]);
    }, 60_000);
});

describe("NOT_READY 之后（t14 实现审查 I3）", () => {
    test("服务比 --ready-timeout 晚就绪：先 NOT_READY，之后监管进程补写登记、再打 READY；dev status --wait-ready 拿得到", async () => {
        const s = await setup("dev-late-ready", {FAKE_DEV_READY_MS: "3500"});
        const sup = await startDev(s, ["--ready-timeout", "1"]);
        expect(await readyLine(sup)).toMatch(/^NOT_READY /u);
        const waited = await cli(s, ["dev", "status", "--package", "apps/web", "--wait-ready", "--timeout", "15", "--json"]);
        expect(waited.exitCode).toBe(0);
        const lines = await until(() => sup.lines(), (all) => all.some((line) => line.startsWith("READY ")), 10_000, "后来的 READY");
        expect(lines.findIndex((line) => line.startsWith("NOT_READY "))).toBeLessThan(lines.findIndex((line) => line.startsWith("READY ")));
        expect((await records(s.fixture))[0]).toMatchObject({url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/$/u), readyAt: expect.any(String)});
        process.kill(sup.pid, "SIGTERM");
        expect(await sup.exited).toBe(0);
        await until(() => alivePids(s.pidsFile), (alive) => alive.length === 0, 10_000, "收干净");
    }, 60_000);

    test("复用方认出就绪时把 url 与 readyAt 写回登记（监管进程不在、登记还没有 readyAt）", async () => {
        const s = await setup("dev-reuse-writeback");
        const server = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: () => new Response("ok")});
        cleanups.push(async () => {
            await server.stop(true);
        });
        const url = `http://127.0.0.1:${server.port}/`;
        const leader = await detachedSleep();
        const logPath = join(s.fixture.root, "late.log");
        await writeFile(logPath, `  \u001b[32m➜\u001b[39m Local:    \u001b[36m${url}\u001b[39m\n`);
        const runId = "dev-20261013T000000Z-0000000e";
        await writeRecord(s, runId, {logPath, supervisor: {pid: leader.pid, startTicks: `${leader.startTicks}0`}, pid: leader.pid, pgid: leader.pid, startTicks: leader.startTicks});
        const reused = await cli(s, ["dev", "start", "--package", "apps/web", "--json"]);
        expect([reused.exitCode, JSON.parse(reused.stdout.trim().split("\n")[0]!)]).toEqual([0, expect.objectContaining({event: "ready", url, reused: true})]);
        expect((await records(s.fixture))[0]).toMatchObject({url, readyAt: expect.any(String)});
    }, 30_000);
});

describe("复用中途对方退出（t14 实现审查 S1）", () => {
    test("复用一份还在 starting 的运行，它就绪前自己退出：复用方打 EXITED、以 1 退出，不等满 --ready-timeout", async () => {
        const s = await setup("dev-reuse-exit", {FAKE_DEV_EXIT_MS: "2500", FAKE_DEV_READY_MS: "60000"});
        const first = await startDev(s, []);
        await until(async () => (await records(s.fixture)).length, (count) => count === 1, 10_000, "A 的登记");
        const started = Date.now();
        const second = await cli(s, ["dev", "start", "--package", "apps/web", "--ready-timeout", "30", "--json"]);
        expect(Date.now() - started).toBeLessThan(10_000);
        expect([second.exitCode, JSON.parse(second.stdout.trim().split("\n")[0]!)]).toEqual([1, expect.objectContaining({event: "exited"})]);
        expect(second.stdout).not.toContain("not_ready");
        expect(await first.exited).toBe(1);
        await until(() => alivePids(s.pidsFile), (alive) => alive.length === 0, 10_000, "收干净");
    }, 60_000);
});

describe("停完核对不过（t14 实现审查 S2）", () => {
    test("还有进程收不掉：不写 endedAt，状态 orphaned、再 dev stop 还会去收；残留没了之后按 stopped 结束", async () => {
        const s = await setup("dev-stop-leftover");
        // 僵尸进程扛得过 SIGKILL（要等父进程收尸）：用它扮“停不掉的残留”。父进程 exec 成 sleep 60，不收尸。
        const parent = spawn("/bin/sh", ["-c", "sleep 0.1 & exec sleep 60"], {stdio: "ignore"});
        cleanups.push(async () => {
            parent.kill("SIGKILL");
        });
        const zombie = await until(async () => {
            for (const name of await readdir("/proc")) {
                if (!/^\d+$/u.test(name)) continue;
                const stat = await readProcStat(Number(name));
                if (stat && stat.ppid === parent.pid && readFileSync(`/proc/${name}/stat`, "utf8").includes(") Z ")) return stat;
            }
            return null;
        }, (found) => found !== null, 5_000, "僵尸进程");
        const runId = "dev-20261013T000000Z-0000000f";
        await writeRecord(s, runId, {supervisor: {pid: parent.pid, startTicks: "1"}, pid: parent.pid, pgid: null, startTicks: "1", descendants: [{pid: zombie!.pid, startTicks: zombie!.startTicks}]});
        const status = async () => (JSON.parse((await cli(s, ["dev", "status", "--package", "apps/web", "--json"])).stdout) as {data: {runs: Array<{state: string; reason: string}>}}).data.runs[0]!;
        const stop = await cli(s, ["dev", "stop", runId, "--grace", "1", "--json"]);
        expect([stop.exitCode, (JSON.parse(stop.stdout) as {errors: Array<{code: string; details: {leftoverPids: number[]}}>}).errors[0]]).toEqual([1, expect.objectContaining({code: "stop_incomplete", details: expect.objectContaining({leftoverPids: [zombie!.pid]})})]);
        expect((await records(s.fixture))[0]).toMatchObject({endedAt: null, endedReason: "stopped", leftoverPids: [zombie!.pid]});
        expect(await status()).toMatchObject({state: "orphaned", reason: "leader_exited"});
        expect((await cli(s, ["dev", "stop", runId, "--grace", "1", "--json"])).exitCode).toBe(1);
        parent.kill("SIGKILL");
        await until(() => existsSync(`/proc/${zombie!.pid}`), (present) => !present, 5_000, "僵尸被收尸");
        expect(await status()).toMatchObject({state: "ended", reason: "stopped"});
    }, 30_000);

    test("只是就绪地址上是别的服务：我们的进程都收掉了，报 stop_incomplete（urlResponding），登记照记为结束", async () => {
        const other = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: () => new Response("other")});
        cleanups.push(async () => {
            await other.stop(true);
        });
        const s = await setup("dev-stop-url", {FAKE_DEV_ANNOUNCE_URL: `http://127.0.0.1:${other.port}/`});
        const sup = await startDev(s, []);
        expect(await readyLine(sup)).toMatch(/^READY /u);
        const stop = await cli(s, ["dev", "stop", "--package", "apps/web", "--force", "--grace", "1", "--json"]);
        expect([stop.exitCode, (JSON.parse(stop.stdout) as {errors: Array<{code: string; details: Record<string, unknown>}>}).errors[0]]).toEqual([1, expect.objectContaining({code: "stop_incomplete", details: expect.objectContaining({leftoverPids: [], urlResponding: true})})]);
        await sup.exited;
        expect((await records(s.fixture))[0]).toMatchObject({endedAt: expect.any(String), endedReason: "stopped", leftoverPids: []});
        const again = await cli(s, ["dev", "stop", "--package", "apps/web", "--json"]);
        expect([again.exitCode, (JSON.parse(again.stdout) as {data: {skipped: Array<{reason: string}>}}).data.skipped.map((entry) => entry.reason)]).toEqual([0, ["stopped"]]);
        await until(() => alivePids(s.pidsFile), (alive) => alive.length === 0, 10_000, "收干净");
    }, 60_000);
});

describe("PID 复用与重启（场景 3）", () => {
    test("登记里的 pid 被复用：dev status 判 ended、dev stop 不发信号；bootId 变了判 rebooted", async () => {
        const s = await setup("dev-reuse-pid");
        const sleeper = spawn("sleep", ["60"], {stdio: "ignore"});
        cleanups.push(async () => {
            sleeper.kill("SIGKILL");
        });
        const ticks = (await processStartTicks(sleeper.pid!))!;
        const base: Record<string, unknown> = {
            schema: "nbdev.proc/v1", kind: "dev", checkout: s.fixture.main, checkoutKey: "main", package: "apps/web", script: "dev", argv: ["bun", "run", "dev"],
            readyPattern: null, workId: null, taskId: null, logPath: join(s.fixture.root, "x.log"), startedAt: new Date().toISOString(), startedBy: null,
            supervisor: {pid: sleeper.pid, startTicks: `${ticks}0`}, pid: sleeper.pid, pgid: sleeper.pid, startTicks: `${ticks}0`, descendants: [],
            url: null, readyAt: null, lastProbeStatus: null, stoppingAt: null, stoppedBy: null, endedAt: null, endedReason: null, exitCode: null, signal: null, leftovers: null, leftoverPids: [],
        };
        const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
        await s.fixture.write(`${PROCS_DIR}/dev-20261013T000000Z-0000000a.json`, JSON.stringify({...base, runId: "dev-20261013T000000Z-0000000a", bootId}));
        await s.fixture.write(`${PROCS_DIR}/dev-20261013T000000Z-0000000b.json`, JSON.stringify({...base, runId: "dev-20261013T000000Z-0000000b", bootId: "00000000-0000-0000-0000-000000000000"}));
        const status = await cli(s, ["dev", "status", "--package", "apps/web", "--json"]);
        const runs = (JSON.parse(status.stdout) as {data: {runs: Array<{runId: string; state: string; reason: string}>}}).data.runs;
        expect(runs.map((run) => [run.runId.slice(-1), run.state, run.reason]).sort()).toEqual([["a", "ended", "supervisor_killed"], ["b", "ended", "rebooted"]]);
        const stop = await cli(s, ["dev", "stop", "dev-20261013T000000Z-0000000a", "--json"]);
        expect(stop.exitCode).toBe(0);
        expect((JSON.parse(stop.stdout) as {data: {skipped: Array<{runId: string; reason: string}>}}).data.skipped).toEqual([{runId: "dev-20261013T000000Z-0000000a", reason: "supervisor_killed"}]);
        expect(await processAlive({pid: sleeper.pid!, startTicks: ticks})).toBe(true);
    }, 30_000);

    test("复用 pid 的进程本身是组长（detached，pid 等于组号）：判 ended，dev stop 不发信号，它仍活着（t14 实现审查 I1）", async () => {
        const s = await setup("dev-reuse-pgid");
        const leader = spawn("sleep", ["60"], {stdio: "ignore", detached: true});
        cleanups.push(async () => {
            leader.kill("SIGKILL");
        });
        const ticks = (await processStartTicks(leader.pid!))!;
        expect(readFileSync(`/proc/${leader.pid}/stat`, "utf8").split(") ")[1]!.split(" ")[2]).toBe(String(leader.pid));
        const runId = "dev-20261013T000000Z-0000000c";
        // TaskStop 之后的样子：只写了 stoppingAt，监管进程来不及写 endedAt；登记的组长、组号是现在这个无关组长的 pid。
        await s.fixture.write(`${PROCS_DIR}/${runId}.json`, JSON.stringify({
            schema: "nbdev.proc/v1", runId, kind: "dev", checkout: s.fixture.main, checkoutKey: "main", package: "apps/web", script: "dev", argv: ["bun", "run", "dev"],
            readyPattern: null, workId: null, taskId: null, logPath: join(s.fixture.root, "x.log"), bootId: readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(),
            startedAt: new Date().toISOString(), startedBy: null, supervisor: {pid: leader.pid, startTicks: `${ticks}0`}, pid: leader.pid, pgid: leader.pid, startTicks: `${ticks}0`, descendants: [],
            url: "http://127.0.0.1:1/", readyAt: new Date().toISOString(), lastProbeStatus: 200, stoppingAt: new Date().toISOString(), stoppedBy: "signal:SIGTERM",
            endedAt: null, endedReason: null, exitCode: null, signal: null, leftovers: null, leftoverPids: [],
        }));
        const status = await cli(s, ["dev", "status", "--package", "apps/web", "--json"]);
        expect((JSON.parse(status.stdout) as {data: {runs: Array<{state: string; reason: string; groupAlive: boolean}>}}).data.runs.map((run) => [run.state, run.reason, run.groupAlive])).toEqual([["ended", "stopped", false]]);
        const stop = await cli(s, ["dev", "stop", runId, "--json"]);
        expect([stop.exitCode, (JSON.parse(stop.stdout) as {data: {skipped: Array<{runId: string; reason: string}>}}).data.skipped]).toEqual([0, [{runId, reason: "stopped"}]]);
        expect(await processAlive({pid: leader.pid!, startTicks: ticks})).toBe(true);
    }, 30_000);
});

describe("收口的几条路径（设计审查 B1、I1、I6）", () => {
    test("监管进程被 SIGKILL：组长经 pdeathsig 收到 SIGTERM，10 秒内全部退出；状态判 ended", async () => {
        const s = await setup("dev-kill-supervisor");
        const sup = await startDev(s, []);
        await readyLine(sup);
        process.kill(sup.pid, "SIGKILL");
        await until(() => alivePids(s.pidsFile), (alive) => alive.length === 0, 10_000, "全部退出");
        const status = JSON.parse((await cli(s, ["dev", "status", "--package", "apps/web", "--json"])).stdout) as {data: {runs: Array<{state: string; reason: string}>}};
        expect(status.data.runs[0]).toMatchObject({state: "ended", reason: "supervisor_killed"});
    }, 60_000);

    test("组长先退、孙进程留在组里（leave）：监管进程被 SIGKILL 之后不是 ended 而是 orphaned（leader_exited），dev stop 不用 --force 就停干净", async () => {
        const s = await setup("dev-leftover", {FAKE_DEV_MODE: "leave"});
        const {a, b} = await claudes();
        const sup = await startDev(s, [], a);
        await readyLine(sup);
        await until(async () => (await records(s.fixture))[0]!.descendants.length, (count) => count > 0, 5_000, "快照");
        process.kill(sup.pid, "SIGKILL");
        // pdeathsig 让组长收到 SIGTERM：leave 模式下它不收孙进程就退出。
        const main = fakePids(s.pidsFile).find((entry) => entry.role === "main")!.pid;
        await until(() => existsSync(`/proc/${main}`), (alive) => !alive, 10_000, "组长退出");
        expect(alivePids(s.pidsFile).length).toBeGreaterThan(0);
        const status = JSON.parse((await cli(s, ["dev", "status", "--package", "apps/web", "--json"])).stdout) as {data: {runs: Array<{state: string; reason: string}>}};
        expect(status.data.runs[0]).toMatchObject({state: "orphaned", reason: "leader_exited"});
        const stop = await cli(s, ["dev", "stop", "--package", "apps/web"], b);
        expect(stop.exitCode).toBe(0);
        expect(alivePids(s.pidsFile)).toEqual([]);
    }, 60_000);

    test("组长自己退出、留下孙进程：监管进程补收，EXITED 带 leftovers，以 1（dev_exited）退出", async () => {
        const s = await setup("dev-self-exit", {FAKE_DEV_MODE: "leave", FAKE_DEV_EXIT_MS: "1500"});
        const sup = await startDev(s, []);
        await readyLine(sup);
        expect(await sup.exited).toBe(1);
        // 只留下孙进程 sleep：它既在进程组里又在快照里，只算一次（t14 实现审查 S4）。
        expect(sup.lines().at(-1)).toMatch(/^EXITED 3 run=\S+ leftovers=1$/u);
        expect(alivePids(s.pidsFile)).toEqual([]);
    }, 60_000);

    test("仿 master 的 owned-process（运行时在另一个会话、监督器不处理 SIGTERM）：dev stop 只给组长 SIGTERM，运行时也收到并退出，地址不再回应", async () => {
        const s = await setup("dev-owned", {FAKE_DEV_MODE: "owned"});
        const sup = await startDev(s, []);
        const url = /^READY (\S+)/u.exec(await readyLine(sup))![1]!;
        const runtime = fakePids(s.pidsFile).find((entry) => entry.role === "runtime")!.pid;
        const mainPid = fakePids(s.pidsFile).find((entry) => entry.role === "main")!.pid;
        expect((await readProcStat(runtime))!.pgrp).not.toBe((await readProcStat(mainPid))!.pgrp);
        // 起服务的是认不出的调用者、监管进程还在：要 --force（认不出的和认不出的不算同一个人）。
        expect((await cli(s, ["dev", "stop", "--package", "apps/web"])).exitCode).toBe(3);
        const stop = await cli(s, ["dev", "stop", "--package", "apps/web", "--force"]);
        expect(stop.exitCode).toBe(0);
        expect(alivePids(s.pidsFile)).toEqual([]);
        expect(fakePids(s.pidsFile).some((entry) => entry.role === "term" && entry.pid === runtime)).toBe(true);
        expect(await urlUp(url)).toBe(false);
        await sup.exited;
    }, 60_000);

    test("服务忽略 SIGTERM：宽限期到了 SIGKILL，停干净", async () => {
        const s = await setup("dev-ignore", {FAKE_DEV_MODE: "ignore"});
        const sup = await startDev(s, []);
        await readyLine(sup);
        const started = Date.now();
        const stop = await cli(s, ["dev", "stop", "--package", "apps/web", "--grace", "2", "--force"]);
        expect(stop.exitCode).toBe(0);
        expect(Date.now() - started).toBeGreaterThanOrEqual(2_000);
        expect(alivePids(s.pidsFile)).toEqual([]);
        await sup.exited;
    }, 60_000);

    test("仿 TaskStop：对监管进程的整棵树同时 SIGTERM，1.5 秒后整棵 SIGKILL；之后全部不在，登记判 ended", async () => {
        const s = await setup("dev-taskstop", {FAKE_DEV_MODE: "owned"});
        const sup = await startDev(s, []);
        await readyLine(sup);
        const supTicks = (await processStartTicks(sup.pid))!;
        const tree = [{pid: sup.pid, startTicks: supTicks}, ...await collectDescendants([{pid: sup.pid, startTicks: supTicks}], [])];
        for (const entry of tree) {
            try {
                process.kill(entry.pid, "SIGTERM");
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
            }
        }
        await sleep(1_500);
        for (const entry of tree) {
            if (await processAlive(entry)) process.kill(entry.pid, "SIGKILL");
        }
        await until(() => alivePids(s.pidsFile), (alive) => alive.length === 0, 5_000, "全部退出");
        const status = JSON.parse((await cli(s, ["dev", "status", "--package", "apps/web", "--json"])).stdout) as {data: {runs: Array<{state: string}>}};
        expect(status.data.runs[0]!.state).toBe("ended");
    }, 60_000);
});

/** `dev start --json` 的输出：stdout 每行一个事件，stderr 每行一条警告。 */
function events(stdout: string): Array<Record<string, unknown>> {
    return stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

function warningCodes(stderr: string): Array<{code: string; details?: Record<string, unknown>}> {
    return stderr.trim().split("\n").filter((line) => line.startsWith("{")).map((line) => (JSON.parse(line) as {warning: {code: string; details?: Record<string, unknown>}}).warning);
}

/** 流式命令（`dev start --json` 一行一个事件）不走 `fixture.cli`：它把整个 stdout 当一个 JSON 外壳解析。 */
function streamCli(setupValue: Setup, args: string[]): Promise<RunResult> {
    return run(process.execPath, [CLI_PATH, ...args], setupValue.fixture.main, undefined, 60_000, setupValue.env);
}

describe("dev start --sample（t18）", () => {
    test("应用收到 NBDEV_SAMPLE=1；READY 之后才到的结果打 SAMPLE，后端每重启一代有结果再打；sample-failed 与非同源的 open-path 打 SAMPLE_FAILED，服务照常；复用取最后一代", async () => {
        const s = await setup("dev-sample", {FAKE_DEV_STYLE: "nbook"});
        const feed = join(s.fixture.root, "feed.txt");
        const envOut = join(s.fixture.root, "env.json");
        Object.assign(s.env, {FAKE_DEV_FEED: feed, FAKE_DEV_ENV_OUT: envOut});
        await writeFile(feed, "");
        const sup = await startDev(s, ["--sample", "--sample-timeout", "30"]);
        const [, url, runId] = /^READY (\S+) run=(\S+)/u.exec(await readyLine(sup))!;
        expect(JSON.parse(readFileSync(envOut, "utf8"))).toEqual({NBDEV_SAMPLE: "1"});
        expect((await records(s.fixture))[0]!.sample).toBe(true);
        const sampleLines = () => sup.lines().filter((line) => line.startsWith("SAMPLE"));
        expect(sampleLines()).toEqual([]);

        await appendFile(feed, "[dev] open-path /?project=sample\n");
        await until(sampleLines, (all) => all.length === 1, 10_000, "第一代的 SAMPLE");
        await appendFile(feed, "[dev] backend-ready pid=2 http://127.0.0.1:1/\n[dev] sample-failed 登记表无效\n");
        await until(sampleLines, (all) => all.length === 2, 10_000, "第二代的 SAMPLE_FAILED");
        await appendFile(feed, "[dev] backend-ready pid=3 http://127.0.0.1:1/\n[dev] open-path //evil.example/x\n");
        await until(sampleLines, (all) => all.length === 3, 10_000, "第三代的 SAMPLE_FAILED");
        expect(sampleLines()).toEqual([
            `SAMPLE ${url}?project=sample run=${runId}`,
            `SAMPLE_FAILED 登记表无效 run=${runId}`,
            `SAMPLE_FAILED open-path 不是同源路径：//evil.example/x run=${runId}`,
        ]);

        // 复用：只报最后一行 backend-ready 之后的结果；参数相同不给 reused_with_different_options。
        const reused = await streamCli(s, ["dev", "start", "--package", "apps/web", "--sample", "--json"]);
        expect([reused.exitCode, events(reused.stdout)]).toEqual([0, [expect.objectContaining({event: "ready", runId, reused: true}), {event: "sample_failed", runId, reason: "open-path 不是同源路径：//evil.example/x"}]]);
        expect(warningCodes(reused.stderr).map((warning) => warning.code)).not.toContain("reused_with_different_options");
        // 复用时不带 --sample：只打 READY，--sample 与它起时不同。
        const plain = await streamCli(s, ["dev", "start", "--package", "apps/web", "--json"]);
        expect([plain.exitCode, events(plain.stdout).map((event) => event.event)]).toEqual([0, ["ready"]]);
        expect(warningCodes(plain.stderr).find((warning) => warning.code === "reused_with_different_options")?.details).toMatchObject({differences: ["sample"]});

        process.kill(sup.pid, "SIGTERM");
        expect(await sup.exited).toBe(0);
        expect(sup.lines().at(-1)).toMatch(/^EXITED /u);
        await until(() => alivePids(s.pidsFile), (alive) => alive.length === 0, 10_000, "收干净");
    }, 90_000);

    test("READY 之后到 --sample-timeout 没有结果打 SAMPLE_FAILED，服务照留；不带 --sample 时去掉调用者环境里的 NBDEV_SAMPLE；复用这样起的服务时带 --sample 立即 SAMPLE_FAILED", async () => {
        const s = await setup("dev-sample-silent", {FAKE_DEV_STYLE: "nbook"});
        const envOut = join(s.fixture.root, "env.json");
        s.env.FAKE_DEV_ENV_OUT = envOut;
        const silent = await startDev(s, ["--sample", "--sample-timeout", "1"]);
        const runId = /run=(\S+)/u.exec(await readyLine(silent))![1]!;
        const lines = await until(() => silent.lines(), (all) => all.some((line) => line.startsWith("SAMPLE_FAILED ")), 10_000, "SAMPLE_FAILED");
        expect(lines.filter((line) => line.startsWith("SAMPLE"))).toEqual([`SAMPLE_FAILED ${SAMPLE_SILENT_REASON} run=${runId}`]);
        expect(alivePids(s.pidsFile).length).toBeGreaterThan(0);
        process.kill(silent.pid, "SIGTERM");
        expect(await silent.exited).toBe(0);
        await until(() => alivePids(s.pidsFile), (alive) => alive.length === 0, 10_000, "收干净");

        s.env.NBDEV_SAMPLE = "1";
        const plain = await startDev(s, []);
        const plainRun = /run=(\S+)/u.exec(await readyLine(plain))![1]!;
        expect(JSON.parse(readFileSync(envOut, "utf8"))).toEqual({NBDEV_SAMPLE: null});
        expect((await records(s.fixture)).find((record) => record.runId === plainRun)!.sample).toBe(false);
        const reused = await streamCli(s, ["dev", "start", "--package", "apps/web", "--sample", "--json"]);
        expect([reused.exitCode, events(reused.stdout)]).toEqual([0, [expect.objectContaining({event: "ready", runId: plainRun, reused: true}), {event: "sample_failed", runId: plainRun, reason: "复用的服务起时没有带 --sample，应用没有准备样例"}]]);
        expect(warningCodes(reused.stderr).find((warning) => warning.code === "reused_with_different_options")?.details).toMatchObject({differences: ["sample"]});
        expect((await streamCli(s, ["dev", "start", "--package", "apps/web", "--sample-timeout", "5", "--json"])).exitCode).toBe(2);
        process.kill(plain.pid, "SIGTERM");
        expect(await plain.exited).toBe(0);
        await until(() => alivePids(s.pidsFile), (alive) => alive.length === 0, 10_000, "收干净");
    }, 90_000);

    test("复用：旧登记没有 sample 按 false；从日志末尾找最后一行 backend-ready 之后的结果，本代还没有就接着读", async () => {
        const s = await setup("dev-sample-reuse");
        const server = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: () => new Response("ok")});
        cleanups.push(async () => {
            await server.stop(true);
        });
        const url = `http://127.0.0.1:${server.port}/`;
        const leader = await detachedSleep();
        const logPath = join(s.fixture.root, "sample.log");
        await writeFile(logPath, `[dev] page-ready ${url}\n[dev] backend-ready pid=1 x\n[dev] open-path /old\n[dev] backend-ready pid=2 x\n[dev] open-path /new\n`);
        const runId = "dev-20261013T000000Z-00000010";
        const fields = {logPath, supervisor: {pid: leader.pid, startTicks: `${leader.startTicks}0`}, pid: leader.pid, pgid: leader.pid, startTicks: leader.startTicks, url, readyAt: new Date().toISOString(), lastProbeStatus: 200};
        await writeRecord(s, runId, fields);
        expect((await records(s.fixture))[0]!.sample).toBe(false);
        const old = await streamCli(s, ["dev", "start", "--package", "apps/web", "--json"]);
        expect([old.exitCode, events(old.stdout).map((event) => event.event)]).toEqual([0, ["ready"]]);
        expect(warningCodes(old.stderr).map((warning) => warning.code)).not.toContain("reused_with_different_options");

        await writeRecord(s, runId, {...fields, sample: true});
        const latest = await streamCli(s, ["dev", "start", "--package", "apps/web", "--sample", "--json"]);
        expect([latest.exitCode, events(latest.stdout)]).toEqual([0, [expect.objectContaining({event: "ready", runId}), {event: "sample", runId, url: `${url}new`}]]);

        await appendFile(logPath, "[dev] backend-ready pid=3 x\n");
        const waiting = await startDev(s, ["--sample", "--sample-timeout", "20", "--json"]);
        await until(() => waiting.lines(), (all) => all.length > 0, 10_000, "复用方的 ready 事件");
        await appendFile(logPath, "[dev] open-path /third\n");
        expect(await waiting.exited).toBe(0);
        expect(waiting.lines().map((line) => JSON.parse(line) as Record<string, unknown>)).toEqual([expect.objectContaining({event: "ready", runId}), {event: "sample", runId, url: `${url}third`}]);
    }, 60_000);
});
