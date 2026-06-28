import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {loadConfig} from "nbook/assets/workspace/.nbook/agent/skills/llmlint/src/config";
import {loadRules} from "nbook/assets/workspace/.nbook/agent/skills/llmlint/src/rules";
import {scanText} from "nbook/assets/workspace/.nbook/agent/skills/llmlint/src/scanner";

describe("llmlint", () => {
    const tempRoots: string[] = [];

    afterEach(async () => {
        await Promise.all(tempRoots.map((root) => rm(root, {recursive: true, force: true})));
        tempRoots.length = 0;
    });

    it("默认启用 anti-ai-slop preset 并加载 LLM rules", async () => {
        const {config} = await loadConfig({cwd: process.cwd()});
        const {staticRules, llmRules} = await loadRules(config);

        const issues = scanText("首先要分析问题，其次要制定方案，最后执行。", staticRules);

        expect(issues.some((issue) => issue.rule.id === "firstly-secondly")).toBe(true);
        expect(issues.find((issue) => issue.rule.id === "firstly-secondly")?.rule.level).toBe("high");
        expect(llmRules.map((rule) => rule.id)).toContain("mechanical-elevation-ending");
    });

    it("配置文件能关闭和改写规则级别", async () => {
        const root = await mkdtemp(join(tmpdir(), "llmlint-config-"));
        tempRoots.push(root);
        const configPath = join(root, "llmlint.config.ts");
        await writeFile(configPath, `export default {
    presets: ["anti-ai-slop"],
    rules: {
        "filler-word-actually": "off",
        "not-but-structure": "low",
    },
};
`, "utf-8");

        const {config} = await loadConfig({cwd: process.cwd(), configPath});
        const {staticRules} = await loadRules(config);
        const issues = scanText("其实不是因为天气不好，而是因为路况复杂。", staticRules);

        expect(issues.some((issue) => issue.rule.id === "filler-word-actually")).toBe(false);
        expect(issues.find((issue) => issue.rule.id === "not-but-structure")?.rule.level).toBe("low");
    });

    it("显式配置路径不存在时返回明确错误", async () => {
        await expect(loadConfig({
            cwd: process.cwd(),
            configPath: join(tmpdir(), "missing-llmlint.config.ts"),
        })).rejects.toThrow("配置文件不存在");
    });
});
