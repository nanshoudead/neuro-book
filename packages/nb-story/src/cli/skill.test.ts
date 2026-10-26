/**
 * `nbstory skill install`（docs/specs/story/cli-skill.md 输出 16、17，F4 到 F6）：在真实临时目录里跑真实命令。
 */

import {afterEach, describe, expect, test} from "bun:test";
import {chmod, lstat, mkdir, readdir, readFile, rm, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {CLI, runCli} from "../../testing/processes";
import {SKILL_SOURCE} from "./skill";

const roots: string[] = [];

afterEach(async () => {
    for (const root of roots.splice(0)) {
        await chmod(root, 0o700).catch(() => undefined);
        await rm(root, {recursive: true, force: true});
    }
});

async function tempRoot(): Promise<string> {
    const root = await createTestTmpRoot("nb-story-skill", "nb-story-skill-test");
    roots.push(root);
    return root;
}

async function install(args: readonly string[], env: Record<string, string> = {}): Promise<{code: number; body: {ok: boolean; data?: {path: string; state: string; leftover?: string}; error?: {code: string}}}> {
    const run = await runCli(["skill", "install", "--json", ...args], env);
    return {code: run.code, body: JSON.parse(run.stdout)};
}

async function sameAsPackage(dir: string): Promise<boolean> {
    const files = (await readdir(dir, {recursive: true})).sort();
    const expected = (await readdir(SKILL_SOURCE, {recursive: true})).sort();
    if (JSON.stringify(files) !== JSON.stringify(expected)) return false;
    for (const file of files) {
        if ((await lstat(join(dir, file))).isDirectory()) continue;
        if (!(await readFile(join(dir, file))).equals(await readFile(join(SKILL_SOURCE, file)))) return false;
    }
    return true;
}

describe("skill install", () => {
    test("装进 --dir：第一次装好，再装一次什么都不写", async () => {
        const root = await tempRoot();
        const parent = join(root, "skills", "nested");

        const first = await install(["--dir", parent]);
        expect(first).toEqual({code: 0, body: {ok: true, data: {path: join(parent, "nbstory"), state: "installed"}}});
        expect(await sameAsPackage(join(parent, "nbstory"))).toBe(true);

        const second = await install(["--dir", parent]);
        expect(second.body.data?.state).toBe("unchanged");
        expect(await readdir(parent)).toEqual(["nbstory"]);
    });

    test("目标内容不同：不带 --force 拒绝且不动它；带了换成随包的，多出的文件删掉，不留临时目录", async () => {
        const root = await tempRoot();
        const target = join(root, "nbstory");
        await mkdir(target);
        await writeFile(join(target, "SKILL.md"), "我自己改过\n");
        await writeFile(join(target, "notes.md"), "多出来的\n");

        const refused = await install(["--dir", root]);
        expect(refused.code).toBe(2);
        expect(refused.body.error?.code).toBe("skill_exists");
        expect(await readFile(join(target, "SKILL.md"), "utf8")).toBe("我自己改过\n");

        const forced = await install(["--dir", root, "--force"]);
        expect(forced.body.data?.state).toBe("replaced");
        expect(await sameAsPackage(target)).toBe(true);
        expect((await readdir(root)).filter(name => !name.startsWith(".nbook"))).toEqual(["nbstory"]);
    });

    test("--agent 按 $HOME 下的约定目录装：缺省 Claude Code，codex 装到 ~/.agents/skills", async () => {
        const home = await tempRoot();

        const claude = await install([], {HOME: home});
        const codex = await install(["--agent", "codex"], {HOME: home});

        expect(claude.body.data?.path).toBe(join(home, ".claude", "skills", "nbstory"));
        expect(codex.body.data?.path).toBe(join(home, ".agents", "skills", "nbstory"));
        expect(await sameAsPackage(join(home, ".agents", "skills", "nbstory"))).toBe(true);
    });

    test("HOME 为空或是相对路径时不装进当前目录：退出 1，提示用 --dir", async () => {
        const cwd = await tempRoot();
        const results = [];
        for (const home of ["", "relative-home"]) {
            const child = Bun.spawn(["bun", CLI, "skill", "install", "--json"], {cwd, stdout: "pipe", stderr: "pipe", env: {...process.env, HOME: home}});
            const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
            results.push({code, body: JSON.parse(stdout) as {error?: {code: string; message: string}}});
        }

        expect(results.map(result => [result.code, result.body.error?.code])).toEqual([[1, "skill_install_failed"], [1, "skill_install_failed"]]);
        expect(results[1]?.body.error?.message).toContain("--dir");
        // Bun 自己会在给它的 HOME 下建 .bun 缓存，所以只看有没有装出 Skill 目录。
        expect((await readdir(cwd, {recursive: true})).filter(path => path.includes(".claude"))).toEqual([]);
    });

    test("目标是符号链接或普通文件：拒绝，不跟随、不覆盖，带 --force 也一样", async () => {
        const root = await tempRoot();
        const real = join(root, "real");
        await mkdir(real);
        await mkdir(join(root, "link-parent"));
        await symlink(real, join(root, "link-parent", "nbstory"));
        await mkdir(join(root, "file-parent"));
        await writeFile(join(root, "file-parent", "nbstory"), "文件\n");

        const linked = await install(["--dir", join(root, "link-parent"), "--force"]);
        const filed = await install(["--dir", join(root, "file-parent"), "--force"]);

        expect([linked.code, linked.body.error?.code]).toEqual([2, "skill_target_invalid"]);
        expect([filed.code, filed.body.error?.code]).toEqual([2, "skill_target_invalid"]);
        expect(await readdir(real)).toEqual([]);
        expect(await readFile(join(root, "file-parent", "nbstory"), "utf8")).toBe("文件\n");
    });

    test("目标读不了时退出 1，--json 照样只有一份错误 JSON，目标不动", async () => {
        const root = await tempRoot();
        const target = join(root, "nbstory");
        await mkdir(target);
        await writeFile(join(target, "SKILL.md"), "旧的\n");
        await chmod(target, 0o000);

        const result = await install(["--dir", root, "--force"]);
        await chmod(target, 0o700);

        expect([result.code, result.body.error?.code]).toEqual([1, "skill_install_failed"]);
        expect(await readFile(join(target, "SKILL.md"), "utf8")).toBe("旧的\n");
    });

    test("新目录就位后删旧目录失败：替换算成功，data.leftover 给出留下的旧目录", async () => {
        const root = await tempRoot();
        const target = join(root, "nbstory");
        await mkdir(join(target, "local"), {recursive: true});
        await writeFile(join(target, "local", "note.md"), "删不掉\n");
        await chmod(join(target, "local"), 0o500);

        const result = await install(["--dir", root, "--force"]);
        const leftover = result.body.data?.leftover;
        if (leftover) await chmod(join(leftover, "local"), 0o700);

        expect([result.code, result.body.data?.state]).toEqual([0, "replaced"]);
        expect(await sameAsPackage(target)).toBe(true);
        expect(leftover?.startsWith(join(root, ".nbstory-skill-old-"))).toBe(true);
        expect(await readFile(join(leftover as string, "local", "note.md"), "utf8")).toBe("删不掉\n");
    });

    test("写不进去时退出 1，目标保持原样（原来没有的仍然没有，原来有的不变）", async () => {
        const root = await tempRoot();
        const empty = join(root, "empty");
        const existing = join(root, "existing");
        await mkdir(empty);
        await mkdir(join(existing, "nbstory"), {recursive: true});
        await writeFile(join(existing, "nbstory", "SKILL.md"), "旧的\n");
        await chmod(empty, 0o500);
        await chmod(existing, 0o500);

        const fresh = await install(["--dir", empty]);
        const replace = await install(["--dir", existing, "--force"]);
        await chmod(empty, 0o700);
        await chmod(existing, 0o700);

        expect([fresh.code, fresh.body.error?.code]).toEqual([1, "skill_install_failed"]);
        expect(await readdir(empty)).toEqual([]);
        expect([replace.code, replace.body.error?.code]).toEqual([1, "skill_install_failed"]);
        expect(await readdir(existing)).toEqual(["nbstory"]);
        expect(await readFile(join(existing, "nbstory", "SKILL.md"), "utf8")).toBe("旧的\n");
    });

    test("用法错误退出 2：--agent 与 --dir 同时给、不认识的 Agent、没有动作", async () => {
        const root = await tempRoot();

        const both = await runCli(["skill", "install", "--agent", "claude", "--dir", root]);
        const unknown = await runCli(["skill", "install", "--agent", "cursor"]);
        const missing = await runCli(["skill"]);

        expect([both.code, unknown.code, missing.code]).toEqual([2, 2, 2]);
        expect(both.stderr).toContain("--agent 与 --dir");
        expect(unknown.stderr).toContain("cursor");
        expect(await readdir(root)).not.toContain("nbstory");
    });
});
