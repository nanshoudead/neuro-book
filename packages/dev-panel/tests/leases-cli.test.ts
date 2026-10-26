import {afterEach, describe, expect, test} from "bun:test";
import {randomUUID} from "node:crypto";
import {mkdir, readdir, readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {HERDR_READ_METHODS} from "../src/herdr/client.js";
import {claudePane, shellPane, startFakeHerdr, type FakeHerdr} from "./fake-herdr.js";
import {cleanupFixtures, createFixture, type CliEnvelope, type Fixture} from "./git-fixture.js";
import {spawnMarked, startFakeClaude, stopProcess, type FakeClaude, type MarkedChild} from "./processes.js";

const children: MarkedChild[] = [];
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const child of children.splice(0)) await stopProcess(child);
    for (const close of closers.splice(0)) await close();
    await cleanupFixtures();
});

/** 起一个扮成 Claude 主进程的子进程；nbdev 经它运行，`CLAUDE_PID` 才是 nbdev 的祖先。 */
async function claudeSession(): Promise<FakeClaude> {
    const host = await startFakeClaude(randomUUID());
    closers.push(() => host.stop());
    return host;
}

/** 起一个环境干净、与会话无关的子进程（例如普通 shell pane 里的开发服务）。 */
async function spawnProcess(command: string, args: string[], options: {cwd?: string; env?: Record<string, string>} = {}): Promise<MarkedChild> {
    const child = await spawnMarked(command, args, options);
    children.push(child);
    return child;
}

/** pane 缺省开在临时仓库的主工作区里：写标签前要核对 pane 的 cwd 在被操作的仓库里。 */
async function herdrFor(fixture: Fixture, panes: Parameters<typeof startFakeHerdr>[1]): Promise<FakeHerdr> {
    const fake = await startFakeHerdr(fixture.root, panes.map((pane) => ({cwd: fixture.main, ...pane})));
    closers.push(() => fake.close());
    return fake;
}

type LeaseJson = {leaseId: string; workId: string; taskId: string; state: string; stale: boolean; lastActivityAt: string; managed: boolean; session: {key: string; herdr: unknown; process: unknown}};

async function leaseList(fixture: Fixture, args: string[] = []): Promise<LeaseJson[]> {
    const result = await fixture.cli(["lease", "list", ...args, "--json"]);
    expect(result.exitCode).toBe(0);
    return (result.json?.data as {leases: LeaseJson[]}).leases;
}

function data<T>(envelope: CliEnvelope | null): T {
    return envelope?.data as T;
}

describe("租约命令（场景）", () => {
    test("场景 1：herdr 里的 Claude 会话 task new，租约记下会话与 pane，并给 pane 写 work、task 标签", async () => {
        const fixture = await createFixture("lease-s1");
        const claude = await claudeSession();
        const sessionId = claude.sessionId;
        const fake = await herdrFor(fixture, [claudePane("w9:p1", sessionId, {foreground_pids: [claude.pid]})]);
        const result = await claude.cli(["task", "new", "w00001", "lease", "--title", "租约", "--json"], fixture.main, {HERDR_PANE_ID: "w9:p1", HERDR_SOCKET_PATH: fake.socketPath});
        expect(result.exitCode).toBe(0);
        expect(data<{lease: LeaseJson}>(result.json).lease).toMatchObject({
            workId: "w00001-seed",
            taskId: "t02-lease",
            session: {key: `claude:${sessionId}`, herdr: {socketPath: fake.socketPath, paneId: "w9:p1", terminalId: "term_w9:p1"}, process: {pid: claude.pid}},
        });
        expect(fake.requests.filter((request) => request.method === "pane.report_metadata").map((request) => request.params)).toEqual([
            {pane_id: "w9:p1", source: "nbdev", tokens: {work: "w00001", task: "t02"}, ttl_ms: 86_400_000},
        ]);
        const registry = JSON.parse(await readFile(join(fixture.main, ".local/agent/registry.json"), "utf8"));
        expect(registry.works[0].tasks.find((task: {taskId: string}) => task.taskId === "t02-lease").by).toMatchObject({key: `claude:${sessionId}`});
    });

    test("--no-lease：work new、task new 不取得租约、不写 pane 标签，登记表的 by 仍记调用者；提交被钩子拒绝时同样不取", async () => {
        const fixture = await createFixture("lease-no-lease");
        const claude = await claudeSession();
        const fake = await herdrFor(fixture, [claudePane("w9:p1", claude.sessionId, {foreground_pids: [claude.pid]})]);
        const env = {HERDR_PANE_ID: "w9:p1", HERDR_SOCKET_PATH: fake.socketPath};
        const task = await claude.cli(["task", "new", "w00001", "quiet", "--title", "不取租约", "--no-lease", "--json"], fixture.main, env);
        const work = await claude.cli(["work", "new", "quiet", "--title", "不取租约", "--goal", "目标。", "--task", "first", "--no-lease", "--json"], fixture.main, env);
        expect([task.exitCode, data<{lease: unknown}>(task.json).lease, work.exitCode, data<{lease: unknown}>(work.json).lease]).toEqual([0, null, 0, null]);

        // 提交失败但号已领时，不带 --no-lease 会照样取得租约；带了就不取。
        await mkdir(join(fixture.main, ".git/hooks"), {recursive: true});
        await writeFile(join(fixture.main, ".git/hooks/pre-commit"), "#!/bin/sh\nexit 1\n", {mode: 0o755});
        const refused = await claude.cli(["task", "new", "w00001", "refused", "--title", "被钩子拒绝", "--no-lease", "--json"], fixture.main, env);
        expect([refused.exitCode, data<{commit: {reason?: string}; lease: unknown}>(refused.json).commit.reason, data<{lease: unknown}>(refused.json).lease]).toEqual([1, "git_failed", null]);

        expect(await leaseList(fixture, ["--all"])).toEqual([]);
        expect(fake.requests.filter((request) => request.method === "pane.report_metadata")).toEqual([]);
        const registry = JSON.parse(await readFile(join(fixture.main, ".local/agent/registry.json"), "utf8")) as {works: Array<{workId: string; by: {key?: string} | null; tasks: Array<{taskId: string; by: {key?: string} | null}>}>};
        const by = (workId: string, taskId: string) => registry.works.find((entry) => entry.workId === workId)?.tasks.find((entry) => entry.taskId === taskId)?.by?.key;
        expect([by("w00001-seed", "t02-quiet"), by("w00002-quiet", "t01-first"), by("w00001-seed", "t03-refused")]).toEqual([`claude:${claude.sessionId}`, `claude:${claude.sessionId}`, `claude:${claude.sessionId}`]);
    });

    test("场景 2：子代理里、会话派出的 omp -p 里运行，租约都记在父会话名下，只有一份", async () => {
        const fixture = await createFixture("lease-s2");
        const claude = await claudeSession();
        const sessionId = claude.sessionId;
        expect((await claude.cli(["task", "status", "w00001", "t01", "active", "--json"], fixture.main, {CLAUDE_CODE_CHILD_SESSION: "1"})).exitCode).toBe(0);
        expect((await claude.cli(["lease", "take", "w00001", "t01", "--json"], fixture.main, {OMPCODE: "1", CLAUDECODE: "1"})).exitCode).toBe(0);
        const leases = await leaseList(fixture);
        expect(leases.map((lease) => [lease.session.key, lease.taskId, lease.state])).toEqual([[`claude:${sessionId}`, "t01-seed", "valid"]]);
    });

    test("场景 3：没有 herdr 环境变量时 lease take --as review-bot，出现外部会话的租约；Task 已关闭时报 task_closed", async () => {
        const fixture = await createFixture("lease-s3");
        const taken = await fixture.cli(["lease", "take", "w00001", "t01", "--as", "review-bot", "--json"]);
        expect(taken.exitCode).toBe(0);
        expect(data<{lease: LeaseJson}>(taken.json).lease).toMatchObject({session: {key: "external:review-bot", herdr: null}});
        const missingWork = await fixture.cli(["lease", "list", "--work", "w00099", "--json"]);
        expect([missingWork.exitCode, missingWork.json?.errors[0]?.code]).toEqual([5, "work_not_found"]);
        const missingTask = await fixture.cli(["lease", "list", "--work", "w00001", "--task", "t09", "--json"]);
        expect([missingTask.exitCode, missingTask.json?.errors[0]?.code]).toEqual([5, "task_not_found"]);
        expect((await leaseList(fixture, ["--work", "w00001", "--task", "t01"])).map((lease) => lease.session.key)).toEqual(["external:review-bot"]);
        const unknown = await fixture.cli(["lease", "take", "w00001", "t01", "--json"]);
        expect([unknown.exitCode, unknown.json?.errors[0]?.code]).toEqual([2, "caller_unknown"]);
        expect((await fixture.cli(["task", "status", "w00001", "t01", "done", "--as", "review-bot", "--json"])).exitCode).toBe(0);
        const closed = await fixture.cli(["lease", "take", "w00001", "t01", "--as", "review-bot", "--json"]);
        expect([closed.exitCode, closed.json?.errors[0]?.code]).toEqual([3, "task_closed"]);
    });

    test("场景 4：最近活动 25 小时前失效、status 不再显示；3 小时前仍有效、淡化，status 带出最近活动", async () => {
        const fixture = await createFixture("lease-s4");
        expect((await fixture.cli(["lease", "take", "w00001", "t01", "--as", "bot", "--json"])).exitCode).toBe(0);
        const dir = join(fixture.main, ".local/agent/run/leases");
        const [file] = (await readdir(dir)).filter((name) => name.endsWith(".json"));
        const rewrite = async (hoursAgo: number) => {
            const lease = JSON.parse(await readFile(join(dir, file!), "utf8"));
            lease.lastActivityAt = new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
            await writeFile(join(dir, file!), JSON.stringify(lease));
        };
        await rewrite(25);
        expect((await leaseList(fixture)).map((lease) => lease.state)).toEqual(["expired"]);
        expect(data<{sessions: unknown[]}>((await fixture.cli(["status", "--json"])).json).sessions).toEqual([]);
        await rewrite(3);
        expect((await leaseList(fixture)).map((lease) => [lease.state, lease.stale])).toEqual([["valid", true]]);
        const status = data<{sessions: Array<{key: string; leases: Array<{lastActivityAt: string; stale: boolean}>}>; works: Array<{activeLeases: Array<{taskId: string; stale: boolean}>}>}>((await fixture.cli(["status", "--json"])).json);
        expect(status.sessions.map((session) => [session.key, session.leases[0]?.stale])).toEqual([["external:bot", true]]);
        expect(status.works[0]?.activeLeases).toEqual([expect.objectContaining({taskId: "t01-seed", stale: true})]);
    });

    test("场景 5：task status … done 释放这个 Task 的全部租约，不论哪个会话、由谁调用", async () => {
        const fixture = await createFixture("lease-s5");
        const claude = await claudeSession();
        const sessionId = claude.sessionId;
        await claude.cli(["lease", "take", "w00001", "t01", "--json"], fixture.main);
        await fixture.cli(["lease", "take", "w00001", "t01", "--as", "bob", "--json"]);
        const done = await fixture.cli(["task", "status", "w00001", "t01", "done", "--as", "carol", "--json"]);
        expect(done.exitCode).toBe(0);
        expect(data<{released: LeaseJson[]; lease: unknown}>(done.json).released.map((lease) => lease.session.key).sort()).toEqual([`claude:${sessionId}`, "external:bob"].sort());
        expect((await leaseList(fixture, ["--all"])).map((lease) => lease.state)).toEqual(["released", "released"]);
        expect(await leaseList(fixture)).toEqual([]);
    });

    test("场景 6：herdr 里找不到会话只是 managed: false；会话进程不在才失效", async () => {
        const fixture = await createFixture("lease-s6");
        const claude = await claudeSession();
        const sessionId = claude.sessionId;
        const fake = await herdrFor(fixture, [claudePane("w9:p1", sessionId, {foreground_pids: [claude.pid]})]);
        const env = {HERDR_PANE_ID: "w9:p1", HERDR_SOCKET_PATH: fake.socketPath};
        await claude.cli(["lease", "take", "w00001", "t01", "--json"], fixture.main, env);
        const listWith = async () => data<{leases: LeaseJson[]}>((await fixture.cli(["lease", "list", "--json"], fixture.main, {HERDR_SOCKET_PATH: fake.socketPath})).json).leases;
        expect((await listWith()).map((lease) => [lease.state, lease.managed])).toEqual([["valid", true]]);
        fake.panes.splice(0, 1, shellPane("w9:p1"));
        expect((await listWith()).map((lease) => [lease.state, lease.managed])).toEqual([["valid", false]]);
        await claude.stop();
        expect((await listWith()).map((lease) => lease.state)).toEqual(["session_gone"]);
    });

    test("场景 7：会话 idle 而它派出的进程还在跑，会话下另列运行；普通 shell pane 里的开发服务归无主；status 只调只读方法", async () => {
        const fixture = await createFixture("lease-s7");
        const claude = await claudeSession();
        const sessionId = claude.sessionId;
        const tool = await claude.spawn("sleep", ["61"], {cwd: fixture.main});
        const shell = await spawnProcess("sh", ["-c", "sleep 62; true"], {cwd: fixture.main, env: {HERDR_PANE_ID: "w9:pJ"}});
        const fake = await herdrFor(fixture, [claudePane("w9:p1", sessionId, {foreground_pids: [claude.pid]}), shellPane("w9:pJ", {shell_pid: shell.pid})]);
        fake.requests.length = 0;
        const status = await claude.cli(["status", "--json"], fixture.main, {HERDR_PANE_ID: "w9:p1", HERDR_SOCKET_PATH: fake.socketPath});
        expect(status.exitCode).toBe(0);
        const view = data<{caller: unknown; sessions: Array<{key: string; herdr: {status: string}; runs: Array<{pid: number}>}>; unownedRuns: Array<{paneId: string; command: string}>}>(status.json);
        expect(view.caller).toMatchObject({kind: "session", via: "claude-env", ref: {key: `claude:${sessionId}`}, herdr: {paneId: "w9:p1", managed: true}});
        expect(view.sessions).toEqual([expect.objectContaining({key: `claude:${sessionId}`, herdr: {paneId: "w9:p1", status: "idle"}, runs: [expect.objectContaining({pid: tool})]})]);
        expect(view.unownedRuns).toEqual([expect.objectContaining({paneId: "w9:pJ", command: "sleep 62"})]);
        expect(fake.requests.every((request) => HERDR_READ_METHODS.includes(request.method))).toBe(true);
        expect(status.stdout).not.toContain("pane.report_metadata");
    });

    test("场景 8：herdr 不在，命令照常完成、给一条警告，租约不记 herdr", async () => {
        const fixture = await createFixture("lease-s8");
        const claude = await claudeSession();
        const sessionId = claude.sessionId;
        const result = await claude.cli(["task", "status", "w00001", "t01", "active", "--json"], fixture.main, {HERDR_PANE_ID: "w9:p1"});
        expect(result.exitCode).toBe(0);
        expect(result.json?.warnings.map((warning) => warning.code)).toEqual(["herdr_unavailable"]);
        expect(data<{lease: LeaseJson}>(result.json).lease).toMatchObject({session: {key: `claude:${sessionId}`, herdr: null}});
    });

    test("只靠 HERDR_PANE_ID 认人、pane.process_info 不回应：task status 与 status 照常完成，身份按 pane 认，给 herdr_partial", async () => {
        const fixture = await createFixture("lease-process-info-hang");
        const fake = await herdrFor(fixture, [{pane_id: "w9:p3", terminal_id: "term_3", agent: "omp", agent_status: "working", agent_session: {agent: "omp", kind: "path", source: "herdr:omp", value: "/o.jsonl"}}]);
        fake.overrides["pane.process_info"] = "hang";
        const env = {HERDR_PANE_ID: "w9:p3", OMPCODE: "1", HERDR_SOCKET_PATH: fake.socketPath};
        const changed = await fixture.cli(["task", "status", "w00001", "t01", "active", "--json"], fixture.main, env);
        // 不知道会话进程，也就无法确认它在这格 pane 里：标签不写。
        expect([changed.exitCode, changed.json?.warnings.map((warning) => [warning.code, warning.details?.reason ?? null])]).toEqual([0, [["herdr_partial", null], ["herdr_tag_skipped", "caller_process_unknown"]]]);
        expect(data<{lease: LeaseJson}>(changed.json).lease).toMatchObject({session: {key: "omp:/o.jsonl", process: null}});
        const status = await fixture.cli(["status", "--json"], fixture.main, env);
        expect(status.exitCode).toBe(0);
        expect(status.json?.warnings.map((warning) => warning.code)).toContain("herdr_partial");
        expect(data<{caller: unknown}>(status.json).caller).toMatchObject({kind: "session", ref: {key: "omp:/o.jsonl"}, process: null});
    });

    test("pane 不是调用者的（herdr 记的是别的会话，或前台不是调用者的会话进程）：不写标签，给 herdr_tag_skipped", async () => {
        const fixture = await createFixture("lease-foreign-pane");
        const claude = await claudeSession();
        const other = await spawnProcess("sleep", ["60"]);
        const fake = await herdrFor(fixture, [
            claudePane("w9:pK", randomUUID(), {foreground_pids: [other.pid]}),
            claudePane("w9:p1", claude.sessionId, {foreground_pids: [other.pid]}),
        ]);
        for (const paneId of ["w9:pK", "w9:p1"]) {
            fake.requests.length = 0;
            const taken = await claude.cli(["lease", "take", "w00001", "t01", "--json"], fixture.main, {HERDR_PANE_ID: paneId, HERDR_SOCKET_PATH: fake.socketPath});
            expect(taken.exitCode).toBe(0);
            expect(taken.json?.warnings.map((warning) => [warning.code, warning.details?.reason])).toEqual([["herdr_tag_skipped", "caller_not_in_foreground"]]);
            expect(fake.requests.filter((request) => request.method === "pane.report_metadata")).toEqual([]);
        }
    });

    test("pane 开在别的仓库里（在临时仓库里运行 nbdev 的真实工作 pane）：不写标签，给 other_repository；前台进程在本仓库的 worktree 里照常写", async () => {
        const fixture = await createFixture("lease-other-repo");
        const worktree = await fixture.addWorktree("w00001-line", "feat/w00001");
        const claude = await claudeSession();
        const fake = await herdrFor(fixture, [claudePane("w9:p1", claude.sessionId, {foreground_pids: [claude.pid], cwd: fixture.root})]);
        const env = {HERDR_PANE_ID: "w9:p1", HERDR_SOCKET_PATH: fake.socketPath};
        const elsewhere = await claude.cli(["lease", "take", "w00001", "t01", "--json"], fixture.main, env);
        expect([elsewhere.exitCode, elsewhere.json?.warnings.map((warning) => [warning.code, warning.details?.reason])]).toEqual([0, [["herdr_tag_skipped", "other_repository"]]]);
        expect(fake.requests.filter((request) => request.method === "pane.report_metadata")).toEqual([]);
        fake.panes[0]!.foreground_cwd = `${worktree}/packages`;
        const inWorktree = await claude.cli(["lease", "take", "w00001", "t01", "--json"], fixture.main, env);
        expect([inWorktree.exitCode, inWorktree.json?.warnings]).toEqual([0, []]);
        expect(fake.requests.filter((request) => request.method === "pane.report_metadata").map((request) => request.params.tokens)).toEqual([{work: "w00001", task: "t01"}]);
    });

    test("release：只释放调用者自己的；释放的是 pane 标签当前指向的 Task 时改写成下一份，没有就清空", async () => {
        const fixture = await createFixture("lease-release");
        const claude = await claudeSession();
        const sessionId = claude.sessionId;
        const fake = await herdrFor(fixture, [claudePane("w9:p1", sessionId, {foreground_pids: [claude.pid]})]);
        const env = {HERDR_PANE_ID: "w9:p1", HERDR_SOCKET_PATH: fake.socketPath};
        await claude.cli(["task", "new", "w00001", "second", "--title", "第二个", "--json"], fixture.main, env);
        await claude.cli(["lease", "take", "w00001", "t01", "--json"], fixture.main, env);
        await fixture.cli(["lease", "take", "w00001", "t01", "--as", "other", "--json"]);
        fake.requests.length = 0;
        const released = await claude.cli(["release", "w00001", "t01", "--json"], fixture.main, env);
        expect(data<{released: LeaseJson[]}>(released.json).released.map((lease) => lease.session.key)).toEqual([`claude:${sessionId}`]);
        const tags = () => fake.requests.filter((request) => request.method === "pane.report_metadata").map((request) => request.params.tokens);
        expect(tags()).toEqual([{work: "w00001", task: "t02"}]);
        fake.requests.length = 0;
        expect((await claude.cli(["release", "--json"], fixture.main, env)).exitCode).toBe(0);
        expect(tags()).toEqual([{work: null, task: null}]);
        expect((await leaseList(fixture)).map((lease) => lease.session.key)).toEqual(["external:other"]);
    });

    test("task status … done 时，调用者 pane 的标签若指向这个 Task，改写成它的下一份租约，没有就清空", async () => {
        const fixture = await createFixture("lease-done-tags");
        const claude = await claudeSession();
        const sessionId = claude.sessionId;
        const fake = await herdrFor(fixture, [claudePane("w9:p1", sessionId, {foreground_pids: [claude.pid]})]);
        const env = {HERDR_PANE_ID: "w9:p1", HERDR_SOCKET_PATH: fake.socketPath};
        await claude.cli(["lease", "take", "w00001", "t01", "--json"], fixture.main, env);
        await claude.cli(["task", "new", "w00001", "second", "--title", "第二个", "--json"], fixture.main, env);
        const tags = () => fake.requests.filter((request) => request.method === "pane.report_metadata").map((request) => request.params.tokens);
        fake.requests.length = 0;
        expect((await claude.cli(["task", "status", "w00001", "t01", "done", "--json"], fixture.main, env)).exitCode).toBe(0);
        expect(tags()).toEqual([]);
        expect((await claude.cli(["task", "status", "w00001", "t02", "shelved", "--json"], fixture.main, env)).exitCode).toBe(0);
        expect(tags()).toEqual([{work: null, task: null}]);
    });
});
