import {afterEach, describe, expect, test} from "bun:test";
import {mkdir, readdir, readFile, rm, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {cleanupFixtures, createFixture, git, run, taskReadme, type Fixture} from "./git-fixture.js";

afterEach(cleanupFixtures);

async function snapshot(fixture: Fixture): Promise<string> {
    const status = await git(fixture.main, "status", "--porcelain", "--ignored", "-uall");
    const local = await readdir(join(fixture.main, ".local"), {recursive: true}).catch(() => []);
    return `${status}\n--\n${[...local].sort().join("\n")}`;
}

describe("命令行合同", () => {
    test("场景 1：在 worktree 里 work new，拿到所有来源最大值加一，README 在主工作区，master 多一个只含两个 README 的提交", async () => {
        const fixture = await createFixture("cli-work-new");
        const worktreeA = await fixture.addWorktree("w00001-a", "feat/a");
        const worktreeB = await fixture.addWorktree("w00001-b", "feat/b");
        // 主工作区里未跟踪的占号目录是所有来源里的最大号：扫描漏掉主工作区时会发出 w00010。
        await fixture.addWork("w00010-placeholder", ["t01-a"]);
        await fixture.addWork("w00006-branch-only", ["t01-a"], worktreeB);
        await fixture.commit("branch-only work", worktreeB);
        await git(fixture.main, "checkout", "--quiet", "-b", "remote-source");
        await fixture.write(".agents/works/w00008-remote/README.md", "x\n");
        await git(fixture.main, "add", ".agents/works/w00008-remote/README.md");
        await git(fixture.main, "commit", "--quiet", "-m", "remote");
        await git(fixture.main, "update-ref", "refs/remotes/origin/remote-source", "HEAD");
        await git(fixture.main, "checkout", "--quiet", "master");
        await git(fixture.main, "branch", "--quiet", "-D", "remote-source");
        const before = await git(fixture.main, "rev-parse", "HEAD");

        const result = await fixture.cli(["work", "new", "panel", "--title", "面板", "--goal", "做个面板。", "--task", "design", "--json"], worktreeA);
        expect(result.exitCode).toBe(0);
        expect(result.json).toMatchObject({schema: "nbdev.work-new/v1", ok: true, data: {workId: "w00011-panel", taskId: "t01-design", commit: {committed: true}}});
        expect(result.json?.data?.registryOnly).toEqual([]);
        expect(await readFile(join(fixture.main, ".agents/works/w00011-panel/README.md"), "utf8")).toContain("## 目标\n\n做个面板。");
        expect(await git(fixture.main, "rev-parse", "HEAD~1")).toBe(before);
        expect((await git(fixture.main, "show", "--name-only", "--format=", "HEAD")).split("\n").sort()).toEqual([
            ".agents/works/w00011-panel/README.md",
            ".agents/works/w00011-panel/tasks/t01-design/README.md",
        ]);
        expect(await readdir(join(worktreeA, ".agents/works"))).not.toContain("w00011-panel");
    });

    test("场景 2：task new 之后，主工作区暂存区里别人的改动仍在暂存区，没有进提交", async () => {
        const fixture = await createFixture("cli-staged");
        await fixture.write("other.txt", "别的会话\n");
        await git(fixture.main, "add", "other.txt");
        const result = await fixture.cli(["task", "new", "w00001", "next", "--title", "下一步", "--json"]);
        expect(result.exitCode).toBe(0);
        expect(result.json?.data).toMatchObject({taskId: "t02-next"});
        expect(result.json?.data?.registryOnly).toEqual([]);
        expect(await git(fixture.main, "diff", "--cached", "--name-only")).toBe("other.txt");
        expect(await git(fixture.main, "show", "--name-only", "--format=", "HEAD")).toBe(".agents/works/w00001-seed/tasks/t02-next/README.md");
    });

    test("场景 5：主工作区不是 master 时 work new 退出码 3，不写任何文件", async () => {
        const fixture = await createFixture("cli-not-master");
        await git(fixture.main, "checkout", "--quiet", "-b", "elsewhere");
        const before = await snapshot(fixture);
        const result = await fixture.cli(["work", "new", "x", "--title", "x", "--goal", "x", "--task", "y", "--json"]);
        expect(result.exitCode).toBe(3);
        expect(result.json).toMatchObject({ok: false, errors: [{code: "main_not_on_master"}]});
        expect(await snapshot(fixture)).toBe(before);
    });

    test("场景 6：已有一组 Work 撞号与一组 Task 撞号时 work new、task new 照常发号，只报涉及这次领号的撞号（没有），其余只给组数；status 与 registry import 仍列出两组", async () => {
        const fixture = await createFixture("cli-conflict");
        const worktree = await fixture.addWorktree("w00003-other", "feat/other");
        await fixture.addWork("w00003-mine", ["t01-a"]);
        await fixture.addWork("w00001-seed", ["t01-seed", "t02-mine"]);
        await fixture.commit("master allocates w00003 and w00001/t02");
        await fixture.addWork("w00003-theirs", ["t01-a"], worktree);
        await fixture.addWork("w00001-seed", ["t01-seed", "t02-theirs"], worktree);
        await fixture.commit("branch allocates the same numbers", worktree);
        const unrelated = (result: Awaited<ReturnType<Fixture["cli"]>>) => [result.exitCode, result.json?.data?.conflicts, result.json?.data?.otherConflicts, result.json?.warnings.some((warning) => warning.code === "number_conflicts")];

        const work = await fixture.cli(["work", "new", "next", "--title", "下一个", "--goal", "目标。", "--task", "a", "--json"]);
        expect(work.json?.data).toMatchObject({workId: "w00004-next"});
        expect(unrelated(work)).toEqual([0, [], 2, false]);
        const task = await fixture.cli(["task", "new", "w00001", "third", "--title", "第三个", "--json"]);
        expect(task.json?.data).toMatchObject({taskId: "t03-third"});
        expect(unrelated(task)).toEqual([0, [], 2, false]);
        const human = await fixture.cli(["task", "new", "w00001", "fourth", "--title", "第四个"]);
        expect(human.stdout).toContain("另有 2 组撞号与这次领号无关，见 nbdev status");

        // 收件箱里的撞号也带各个 id 与位置：首页据此写明原因。
        const status = await fixture.cli(["status", "--json"]);
        const inbox = (status.json?.data?.inbox as Array<{kind: string; label: string; ids?: Array<{id: string}>}>).filter((item) => item.kind === "number_conflict");
        expect(inbox.map((item) => [item.label, item.ids?.map((entry) => entry.id)])).toEqual([["w00003", ["w00003-mine", "w00003-theirs"]], ["w00001-seed/t02", ["t02-mine", "t02-theirs"]]]);
        const imported = await fixture.cli(["registry", "import", "--json"]);
        const conflicts = imported.json?.data?.conflicts as Array<{label: string; live: boolean; ids: Array<{id: string; locations: Array<{source: string}>}>}>;
        expect(conflicts.map((conflict) => [conflict.label, conflict.live, conflict.ids.map((entry) => entry.id)])).toEqual([["w00003", true, ["w00003-mine", "w00003-theirs"]], ["w00001-seed/t02", true, ["t02-mine", "t02-theirs"]]]);
        expect(conflicts[0]!.ids[1]!.locations.map((location) => location.source).sort()).toEqual(["ref", "worktree"]);
        expect(imported.json?.warnings.map((warning) => warning.code)).toContain("number_conflicts");
    });

    test("场景 7：分支上较新的 Work 标 branch（带分支名），只在 master 上的 Task 标 master；改分支上的记录退出码 3", async () => {
        const fixture = await createFixture("cli-branch-source");
        const worktree = await fixture.addWorktree("w00001-line", "feat/w00001");
        await fixture.write(".agents/works/w00001-seed/tasks/t01-seed/README.md", taskReadme("t01-seed", "status: active\n"), worktree);
        await fixture.commit("branch keeps records", worktree);
        const created = await fixture.cli(["task", "new", "w00001", "on-master", "--title", "在 master", "--json"]);
        expect(created.json?.data).toMatchObject({taskId: "t02-on-master"});

        const status = await fixture.cli(["status", "--work", "w00001", "--json"]);
        expect(status.exitCode).toBe(0);
        const work = (status.json?.data?.works as Array<Record<string, unknown>>)[0]!;
        expect(work).toMatchObject({source: "branch", branch: "feat/w00001", checkout: worktree});
        expect((work.tasks as Array<Record<string, unknown>>).map((task) => [task.taskId, task.source, task.branch])).toEqual([
            ["t01-seed", "branch", "feat/w00001"],
            ["t02-on-master", "master", "master"],
        ]);

        const refused = await fixture.cli(["task", "status", "w00001", "t01", "done", "--json"]);
        expect(refused.exitCode).toBe(3);
        expect(refused.json?.errors[0]).toMatchObject({code: "branch_maintained_record", details: {branch: "feat/w00001"}});
        const allowed = await fixture.cli(["task", "status", "w00001", "t02", "active", "--json"]);
        expect(allowed.exitCode).toBe(0);
        expect((await fixture.cli(["work", "status", "w00001", "done", "--json"])).exitCode).toBe(3);
    });

    test("场景 10：index.lock 被占 15 秒，退出码 1，committed: false，列出已写的文件", async () => {
        const fixture = await createFixture("cli-index-lock");
        const indexLock = join(fixture.main, ".git/index.lock");
        await writeFile(indexLock, "");
        const release = setTimeout(() => void rm(indexLock, {force: true}), 15_000);
        try {
            const result = await fixture.cli(["task", "new", "w00001", "blocked", "--title", "被挡", "--json"]);
            expect(result.exitCode).toBe(1);
            expect(result.json).toMatchObject({
                ok: false,
                data: {taskId: "t02-blocked", commit: {committed: false, reason: "git_lock_timeout", writtenPaths: [".agents/works/w00001-seed/tasks/t02-blocked/README.md"]}},
                errors: [{code: "commit_failed"}],
            });
        } finally {
            clearTimeout(release);
            await rm(indexLock, {force: true});
        }
    }, 30_000);

    test("status 只读：不取锁、不写任何文件", async () => {
        const fixture = await createFixture("cli-status-readonly");
        await fixture.addWorktree("w00001-x", "feat/x");
        const before = await snapshot(fixture);
        const result = await fixture.cli(["status", "--json"]);
        expect(result.exitCode).toBe(0);
        expect(result.json?.data).toMatchObject({nextWorkNumber: "w00002"});
        expect(await snapshot(fixture)).toBe(before);
        const human = await fixture.cli(["status", "--work", "w00001-seed"]);
        expect(human.stdout).toContain("t01-seed  未标  [master]");

        await git(fixture.main, "checkout", "--quiet", "-b", "elsewhere");
        const offMaster = await fixture.cli(["status", "--work", "w00001", "--json"]);
        const work = (offMaster.json?.data?.works as Array<{branch: string; tasks: Array<{branch: string}>}>)[0]!;
        expect([work.branch, work.tasks[0]?.branch]).toEqual(["elsewhere", "elsewhere"]);
        expect(offMaster.json?.warnings.map((warning) => warning.code)).toContain("main_not_on_master");
    });

    test("用法错误退出码 2，找不到仓库或对象退出码 5；help --json 也只输出一个 JSON 对象", async () => {
        const fixture = await createFixture("cli-usage");
        const help = await fixture.cli(["--help", "--json"]);
        expect([help.exitCode, help.json?.schema, typeof help.json?.data?.usage]).toEqual([0, "nbdev.cli/v1", "string"]);
        expect((await fixture.cli(["work", "new", "--json"])).json).toMatchObject({ok: false, errors: [{code: "usage"}]});
        expect((await fixture.cli(["frobnicate", "--json"])).exitCode).toBe(2);
        expect((await fixture.cli(["task", "new", "w00001", "Bad_Slug", "--title", "x", "--json"])).exitCode).toBe(2);
        expect((await fixture.cli(["task", "status", "w00001", "t01", "draft", "--json"])).exitCode).toBe(2);
        expect((await fixture.cli(["task", "new", "w00042", "x", "--title", "x", "--json"])).json).toMatchObject({errors: [{code: "work_not_found"}]});
        const outside = join(fixture.root, "outside");
        await mkdir(outside);
        const notRepo = await fixture.cli(["status", "--json"], outside);
        expect(notRepo.exitCode).toBe(5);
        expect(notRepo.json?.errors[0]?.code).toBe("repository_not_found");
    });

    test("install-shim 写入指定目录，shim 能运行；不覆盖别人的同名文件", async () => {
        const fixture = await createFixture("cli-shim");
        const binDir = join(fixture.root, "bin");
        const script = join(import.meta.dirname, "..", "src", "install-shim.ts");
        const target = join(import.meta.dirname, "..", "..", "..");
        const installed = await run(process.execPath, [script, "--bin-dir", binDir, "--target", target, "--json"], fixture.main);
        expect(installed.exitCode).toBe(0);
        const shim = await readFile(join(binDir, "nbdev"), "utf8");
        expect(shim).toContain("# nbdev shim");
        const viaShim = await run(join(binDir, "nbdev"), ["status", "--json"], fixture.main);
        expect(viaShim.exitCode).toBe(0);
        expect(JSON.parse(viaShim.stdout).data.mainRoot).toBe(fixture.main);

        await writeFile(join(binDir, "nbdev"), "#!/bin/sh\necho mine\n");
        const refused = await run(process.execPath, [script, "--bin-dir", binDir, "--target", target, "--json"], fixture.main);
        expect(refused.exitCode).toBe(3);
        expect(JSON.parse(refused.stdout).errors[0].code).toBe("shim_exists");

        for (const prepare of [
            async (path: string) => mkdir(path),
            async (path: string) => symlink(join(fixture.root, "missing-target"), path),
        ]) {
            await rm(join(binDir, "nbdev"), {recursive: true, force: true});
            await prepare(join(binDir, "nbdev"));
            const blocked = await run(process.execPath, [script, "--bin-dir", binDir, "--target", target, "--json"], fixture.main);
            expect([blocked.exitCode, JSON.parse(blocked.stdout).errors[0]?.code]).toEqual([3, "shim_exists"]);
        }
    });
});
