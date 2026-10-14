import {afterEach, describe, expect, test} from "bun:test";
import {existsSync, readFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {cleanupFixtures, createFixture} from "./git-fixture.js";

/** t14 的 `find` 与 `shot`（L3，临时仓库）。`shot` 用记下参数的假 `lab:shot`（`tests/fixtures/fake-lab-shot.ts`）；`shot --page`（t18）的假 `page:shot` 是同一个脚本。 */

const FAKE_SHOT = resolve(import.meta.dirname, "fixtures", "fake-lab-shot.ts");

afterEach(async () => {
    await cleanupFixtures();
});

describe("find", () => {
    test("记录与文件一起找；--name 只找文件名；--limit 截断时标出；--in 写错是用法错误", async () => {
        const fixture = await createFixture("find");
        await fixture.write("docs/notes.md", "seed 的说明\n另一行 seed\n");
        const all = await fixture.cli(["find", "seed", "--json"]);
        expect(all.exitCode).toBe(0);
        const data = all.json!.data as {records: Array<{kind: string; workId: string}>; hits: Array<{checkout: string; kind: string; path: string}>; truncated: boolean};
        expect(data.records.map((record) => record.kind)).toEqual(["work", "task"]);
        expect(data.hits.some((hit) => hit.kind === "content" && hit.path === "docs/notes.md")).toBe(true);
        const names = (await fixture.cli(["find", "notes", "--name", "--json"])).json!.data as {records: unknown[]; hits: Array<{kind: string}>};
        expect(names.records).toEqual([]);
        expect(names.hits.every((hit) => hit.kind === "name")).toBe(true);
        // --name 不跑内容搜索：内容命中再多也不算进条数与截断（t14 实现审查 S3）。
        await fixture.write("docs/zeta.md", "zeta\n".repeat(10));
        const onlyName = (await fixture.cli(["find", "zeta", "--name", "--limit", "5", "--json"])).json!.data as {hits: Array<{kind: string; path: string}>; checkouts: Array<{count: number; truncated: boolean}>; truncated: boolean};
        expect([onlyName.hits.map((hit) => [hit.kind, hit.path]), onlyName.truncated, onlyName.checkouts.map((entry) => [entry.count, entry.truncated])]).toEqual([[["name", "docs/zeta.md"]], false, [[1, false]]]);
        const limited = (await fixture.cli(["find", "seed", "--limit", "1", "--json"])).json!.data as {truncated: boolean};
        expect(limited.truncated).toBe(true);
        expect((await fixture.cli(["find", "seed", "--in", "nope", "--json"])).exitCode).toBe(2);
        expect((await fixture.cli(["find", "zzzz-no-such-word", "--json"])).exitCode).toBe(0);
    }, 60_000);
});

describe("shot", () => {
    test("包装地址、输出目录与 TMPDIR（/dev/shm，跑完删掉），不注入浏览器路径；参数原样交给 lab:shot", async () => {
        const fixture = await createFixture("shot");
        await fixture.write("apps/web/package.json", JSON.stringify({name: "web", private: true, scripts: {"lab:shot": `bun ${FAKE_SHOT}`}}));
        const result = await fixture.cli(["shot", "--package", "apps/web", "--url", "http://127.0.0.1:1/", "--work", "w00001", "--task", "t01", "--json", "--", "-c", "Foo", "--vp", "phone"]);
        expect([result.exitCode, result.json?.errors]).toEqual([0, []]);
        const data = result.json!.data as {outDir: string; files: string[]};
        expect(data.outDir.startsWith(join(fixture.main, ".local/agent/works/w00001-seed/tasks/t01-seed/shots/"))).toBe(true);
        expect(data.files).toEqual(["Foo-phone.png", "args.json"]);
        const recorded = JSON.parse(readFileSync(join(data.outDir, "args.json"), "utf8")) as {args: string[]; tmpdir: string; tmpdirExists: boolean};
        expect(recorded.args).toEqual(["--url", "http://127.0.0.1:1/", "--out", data.outDir, "-c", "Foo", "--vp", "phone"]);
        expect(recorded.tmpdir.startsWith("/dev/shm/nbdev-shot-")).toBe(true);
        expect(recorded.tmpdirExists).toBe(true);
        expect(existsSync(recorded.tmpdir)).toBe(false);
    }, 60_000);

    test("没有已就绪的服务又没给 --url 是 5；没有 lab:shot 是 3；lab:shot 失败是 1", async () => {
        const fixture = await createFixture("shot-errors");
        await fixture.write("apps/web/package.json", JSON.stringify({name: "web", private: true, scripts: {"lab:shot": `bun ${FAKE_SHOT}`}}));
        await fixture.write("apps/bare/package.json", JSON.stringify({name: "bare", private: true, scripts: {}}));
        const noRun = await fixture.cli(["shot", "--package", "apps/web", "--json"]);
        expect([noRun.exitCode, noRun.json?.errors[0]?.code]).toEqual([5, "dev_not_running"]);
        const noScript = await fixture.cli(["shot", "--package", "apps/bare", "--url", "http://127.0.0.1:1/", "--json"]);
        expect([noScript.exitCode, noScript.json?.errors[0]?.code]).toEqual([3, "shot_unavailable"]);
        const failing = await fixture.cli(["shot", "--package", "apps/web", "--url", "http://127.0.0.1:1/", "--json"], fixture.main, {FAKE_SHOT_FAIL: "1"});
        expect([failing.exitCode, failing.json?.errors[0]?.code]).toEqual([1, "shot_failed"]);
        // package.json 坏了：shot 与 dev start 都报带路径的 invalid_record，不改报成找不到脚本（t14 实现审查 S6）。
        await fixture.write("apps/broken/package.json", "{");
        for (const args of [["shot", "--package", "apps/broken", "--url", "http://127.0.0.1:1/"], ["dev", "start", "--package", "apps/broken"]]) {
            const broken = await fixture.cli([...args, "--json"]);
            expect([args[0], broken.exitCode, broken.json?.errors[0]?.code, String((broken.json?.errors[0]?.details as {path?: string} | undefined)?.path)]).toEqual([args[0], 1, "invalid_record", join(fixture.main, "apps/broken/package.json")]);
        }
        expect(failing.json?.errors[0]?.message).toContain("截图失败：假的");
    }, 60_000);

    test("--page 运行 page:shot：--url、--path、--out 在前，-- 之后的步骤参数原样、顺序不变；缺的脚本报 shot_unavailable，details.script 写明是哪个", async () => {
        const fixture = await createFixture("shot-page");
        await fixture.write("apps/web/package.json", JSON.stringify({name: "web", private: true, scripts: {"page:shot": `bun ${FAKE_SHOT}`}}));
        await fixture.write("apps/lab/package.json", JSON.stringify({name: "lab", private: true, scripts: {"lab:shot": `bun ${FAKE_SHOT}`}}));
        const steps = ["--click", "#a", "--wait-for", "#b", "--click", "#c"];
        const result = await fixture.cli(["shot", "--package", "apps/web", "--url", "http://127.0.0.1:1/", "--page", "/?project=sample", "--json", "--", ...steps]);
        expect([result.exitCode, result.json?.errors]).toEqual([0, []]);
        const data = result.json!.data as {outDir: string};
        expect(data.outDir.startsWith(join(fixture.main, ".local/agent/shots/"))).toBe(true);
        const recorded = JSON.parse(readFileSync(join(data.outDir, "args.json"), "utf8")) as {args: string[]; tmpdir: string};
        expect(recorded.args).toEqual(["--url", "http://127.0.0.1:1/", "--path", "/?project=sample", "--out", data.outDir, ...steps]);
        expect(recorded.tmpdir.startsWith("/dev/shm/nbdev-shot-")).toBe(true);

        const missingPage = await fixture.cli(["shot", "--package", "apps/lab", "--url", "http://127.0.0.1:1/", "--page", "/", "--json"]);
        expect([missingPage.exitCode, missingPage.json?.errors[0]?.code, missingPage.json?.errors[0]?.details?.script]).toEqual([3, "shot_unavailable", "page:shot"]);
        const missingLab = await fixture.cli(["shot", "--package", "apps/web", "--url", "http://127.0.0.1:1/", "--json"]);
        expect([missingLab.exitCode, missingLab.json?.errors[0]?.code, missingLab.json?.errors[0]?.details?.script]).toEqual([3, "shot_unavailable", "lab:shot"]);
    }, 60_000);
});
