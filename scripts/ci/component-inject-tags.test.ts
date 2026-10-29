import {execFile as execFileCallback} from "node:child_process";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {promisify} from "node:util";

import {afterAll, beforeAll, describe, expect, it} from "vitest";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {componentInjectFailures} from "#scripts/ci/component-inject-tags";

const execFile = promisify(execFileCallback);
const REPOSITORY = resolve(import.meta.dirname, "../..");
let tmp = "";
let cases = 0;

beforeAll(async () => {
    tmp = await createTestTmpRoot("scripts", "component-inject-tags");
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 在临时目录里搭一个 git 仓库（不提交，检查读未跟踪文件），写入这些文件。 */
async function repositoryWith(files: Readonly<Record<string, string>>): Promise<string> {
    cases += 1;
    const root = join(tmp, `case-${String(cases)}`);
    for (const [path, content] of Object.entries(files)) {
        await mkdir(dirname(join(root, path)), {recursive: true});
        await writeFile(join(root, path), content);
    }
    await execFile("git", ["init", "-q"], {cwd: root});
    return root;
}

const script = (body: string): string => `<script setup lang="ts">\n${body}\n</script>\n\n<template><div /></template>\n`;
const documented = (tags: string, body = ""): string => `---\n标签: ${tags}\n---\n\n# 组件\n\n${body}\n`;

async function runScript(repoRoot: string): Promise<{readonly status: number; readonly stderr: string}> {
    try {
        await execFile("bun", [join(REPOSITORY, "scripts/ci/component-inject-tags.ts"), "--repo-root", repoRoot], {cwd: REPOSITORY, encoding: "utf8"});
        return {status: 0, stderr: ""};
    } catch (error) {
        const result = error as {code?: number | string; stderr?: string};
        return {status: typeof result.code === "number" ? result.code : -1, stderr: result.stderr ?? ""};
    }
}

describe("组件文档的 state:inject 检查", () => {
    it("仓库里的组件通过", () => {
        expect(componentInjectFailures(REPOSITORY)).toEqual([]);
    });

    it("取翻译端口的各种写法都要求 state:inject；标了的通过", async () => {
        const root = await repositoryWith({
            "packages/a/src/UsesText.vue": script("const port = useText();"),
            "packages/a/src/UsesText.md": documented("[state:local]"),
            "packages/a/src/UsesPluginText.vue": script("const text = useProjectsText();"),
            "packages/a/src/UsesPluginText.md": documented("[]"),
            "packages/a/src/Injects.vue": script("const port = inject(TEXT_PORT_KEY, null);"),
            "packages/a/src/Injects.md": documented("[io:read]"),
            "packages/a/src/FormRoot.vue": script("const text = provideFormText(() => props.locale);"),
            "packages/a/src/FormRoot.md": documented("[state:local]"),
            "packages/a/src/AgentRoot.vue": script("const text = provideAgentText(() => props.locale);"),
            "packages/a/src/AgentRoot.md": documented("[]"),
            "packages/a/src/MarkdownRoot.vue": script("const text = provideMarkdownText(() => props.locale);"),
            "packages/a/src/MarkdownRoot.md": documented("[]"),
            "packages/a/src/Declared.vue": script("const text = useUiText();"),
            "packages/a/src/Declared.md": documented("[state:local, state:inject]"),
        });
        expect(componentInjectFailures(root)).toEqual([
            "packages/a/src/AgentRoot.md：packages/a/src/AgentRoot.vue 经 provideAgentText(…) 取注入的翻译端口，「标签」要含 state:inject",
            "packages/a/src/FormRoot.md：packages/a/src/FormRoot.vue 经 provideFormText(…) 取注入的翻译端口，「标签」要含 state:inject",
            "packages/a/src/Injects.md：packages/a/src/Injects.vue 经 inject(TEXT_PORT_KEY…) 取注入的翻译端口，「标签」要含 state:inject",
            "packages/a/src/MarkdownRoot.md：packages/a/src/MarkdownRoot.vue 经 provideMarkdownText(…) 取注入的翻译端口，「标签」要含 state:inject",
            "packages/a/src/UsesPluginText.md：packages/a/src/UsesPluginText.vue 经 useProjectsText(…) 取注入的翻译端口，「标签」要含 state:inject",
            "packages/a/src/UsesText.md：packages/a/src/UsesText.vue 经 useText(…) 取注入的翻译端口，「标签」要含 state:inject",
        ]);
    });

    it("只认 frontmatter 的「标签」：正文里写了 state:inject 不算；没有 frontmatter 也报", async () => {
        const root = await repositoryWith({
            "packages/a/src/InBody.vue": script("const port = useText();"),
            "packages/a/src/InBody.md": documented("[state:local]", "## 隐藏通道理由\n\n- `state:inject`：经 `useText()` 取翻译端口。"),
            "packages/a/src/NoFrontmatter.vue": script("const port = useText();"),
            "packages/a/src/NoFrontmatter.md": "# NoFrontmatter\n\n标签: [state:inject]\n",
        });
        expect(componentInjectFailures(root)).toEqual([
            "packages/a/src/InBody.md：packages/a/src/InBody.vue 经 useText(…) 取注入的翻译端口，「标签」要含 state:inject",
            "packages/a/src/NoFrontmatter.md：packages/a/src/NoFrontmatter.vue 经 useText(…) 取注入的翻译端口，文档要有 frontmatter 的「标签」数组并含 state:inject",
        ]);
    });

    it("不报：注释里提到的写法、没取端口的组件、只建端口不读注入的 provide…Text、没有同名文档的组件、旧应用", async () => {
        const root = await repositoryWith({
            "packages/a/src/Commented.vue": script("// 不用 useText()：文字由属性给出。\n/* inject(TEXT_PORT_KEY) 也不用 */\nconst label = \"文字\";"),
            "packages/a/src/Commented.md": documented("[]"),
            "packages/a/src/Plain.vue": script("const props = defineProps<{label: string}>();"),
            "packages/a/src/Plain.md": documented("[]"),
            "packages/a/src/LabFixture.vue": script("const port = provideProjectsText(props.scene);"),
            "packages/a/src/LabFixture.md": documented("[]"),
            "packages/a/src/Undocumented.vue": script("const port = useText();"),
            "packages/neuro-book-legacy/app/Old.vue": script("const port = useText();"),
            "packages/neuro-book-legacy/app/Old.md": documented("[]"),
        });
        expect(componentInjectFailures(root)).toEqual([]);
    });

    it("命令行：有问题时退出非零并逐条写出；通过时退出 0", async () => {
        const bad = await repositoryWith({
            "packages/a/src/UsesText.vue": script("const port = useText();"),
            "packages/a/src/UsesText.md": documented("[]"),
        });
        const failed = await runScript(bad);
        expect(failed.status).toBe(1);
        expect(failed.stderr).toContain("packages/a/src/UsesText.md：packages/a/src/UsesText.vue 经 useText(…) 取注入的翻译端口，「标签」要含 state:inject");

        const good = await repositoryWith({
            "packages/a/src/UsesText.vue": script("const port = useText();"),
            "packages/a/src/UsesText.md": documented("[state:inject]"),
        });
        expect(await runScript(good)).toEqual({status: 0, stderr: ""});
    });
});
