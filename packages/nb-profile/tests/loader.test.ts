import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {rm, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {loadProfile, profileFromModule, renderProfile} from "../src";

const fixtures = resolve(import.meta.dir, "fixtures");
let tmpRoot = "";

beforeAll(async () => {
    tmpRoot = await createTestTmpRoot("nb-profile", "loader");
});

afterAll(async () => {
    if (tmpRoot !== "") await rm(tmpRoot, {recursive: true, force: true});
});

describe("loadProfile", () => {
    test("加载 JSX fixture，按初始输入与生效工具集渲染", async () => {
        const {path, profile} = await loadProfile(join(fixtures, "hello.profile.tsx"));
        const history = [{role: "user", content: "历史消息"}];
        const initial = profile.parseInitial({name: "小风"});

        const withTimeline = renderProfile(profile.context({initial, tools: new Set(["builtin.read", "story.timeline"]), history}), {
            history,
            tools: new Set(["builtin.read", "story.timeline"]),
        });
        const without = renderProfile(profile.context({initial, tools: new Set(["builtin.read"]), history}), {history, tools: new Set(["builtin.read"])});

        expect(path.endsWith("hello.profile.tsx")).toBe(true);
        expect(profile.manifest).toMatchObject({key: "hello", version: "1"});
        expect(withTimeline.systemPrompt).toEqual(["你是 nb-profile 的测试助手，用户叫 小风。", "可以查时间线。"]);
        expect(without.systemPrompt).toEqual(["你是 nb-profile 的测试助手，用户叫 小风。"]);
        expect(without.messages).toEqual([{kind: "history", message: history[0]}]);
    });

    test("加载任意路径下的 TS fixture（不依赖包内目录）", async () => {
        const entry = pathToFileURL(resolve(import.meta.dir, "..", "src", "index.ts")).href;
        const fixturePath = join(tmpRoot, "temp.profile.ts");
        await writeFile(
            fixturePath,
            `import {defineProfile, ProfilePrompt, System} from ${JSON.stringify(entry)};\n` +
                `export default defineProfile({manifest: {key: "temp", version: "1", name: "临时", description: "临时目录"}, initialSchema: {}, tools: [], ` +
                `context: () => ProfilePrompt({children: [System({children: ["来自临时目录"]})]})});\n`,
            "utf-8",
        );

        const {profile} = await loadProfile(fixturePath);
        expect(renderProfile(profile.context({initial: {}, tools: new Set(), history: []}), {history: [], tools: new Set()}).systemPrompt).toEqual(["来自临时目录"]);
    });

    test("没有默认导出时抛错并带路径", async () => {
        await expect(loadProfile(join(fixtures, "no-default.profile.tsx"))).rejects.toThrow(/没有默认导出/u);
    });

    test("同形但不是 defineProfile 造出的对象报 profile_invalid（F4）", async () => {
        const fixturePath = join(tmpRoot, "forged.profile.ts");
        await writeFile(fixturePath, `export default {kind: "profile-definition", tools: [], context: () => null};\n`, "utf-8");
        let code = "";
        try {
            await loadProfile(fixturePath);
        } catch (error) {
            code = (error as {code?: string}).code ?? "";
        }
        expect(code).toBe("profile_invalid");
    });

    test("profileFromModule 拒绝不是 defineProfile 结果的默认导出", () => {
        expect(() => profileFromModule({default: {kind: "X"}}, "memory.profile.tsx")).toThrow(/不是 defineProfile/u);
        expect(() => profileFromModule({}, "memory.profile.tsx")).toThrow(/memory\.profile\.tsx/u);
    });
});
