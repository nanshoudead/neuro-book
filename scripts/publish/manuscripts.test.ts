import {mkdir, rm, writeFile} from "node:fs/promises";
import {resolve} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {afterAll, beforeAll, describe, expect, it} from "vitest";

import {discoverWorkspaces, planManuscripts} from "#scripts/publish/manuscripts";

let root: string;

async function write(relativePath: string, text: string): Promise<void> {
    const target = resolve(root, relativePath);
    await mkdir(resolve(target, ".."), {recursive: true});
    await writeFile(target, text, "utf8");
}

beforeAll(async () => {
    root = await createTestTmpRoot("publish-manuscripts", "正文收集");
    await write("alpha/project.yaml", "kind: novel\n");
    await write("alpha/manuscript/001-volume/001-chapter/index.md", "# 第一章\n");
    await write("alpha/manuscript/001-volume/002-chapter/index.md", "# 第二章\n");
    await write("alpha/manuscript/001-volume/_backup/index.md", "# 备份\n");
    await write("alpha/manuscript/cover.png", "not text");
    await write("alpha/reference/guide.md", "# 参考资料\n");
    await write("alpha/lorebook/index.md", "# 设定\n");
    await write("alpha/.nbook/history.sqlite", "binary");
    await write("beta/project.yaml", "kind: novel\n");
    await write("no-marker/notes.md", "# 不是工作空间\n");
    await write(".nbook/registry.json", "{}");
});

afterAll(async () => {
    await rm(root, {recursive: true, force: true});
});

describe("工作空间与正文收集", () => {
    it("只把带 project.yaml 的目录当工作空间，跳过点目录", async () => {
        expect(await discoverWorkspaces(root)).toEqual(["alpha", "beta"]);
    });

    it("只发布 manuscript 下的 .md，排除参考资料、设定、运行时数据、备份与非正文", async () => {
        const plan = await planManuscripts(root);
        const alpha = plan.workspaces.find((workspace) => workspace.name === "alpha");

        expect(alpha?.files.map((file) => file.targetPath)).toEqual([
            "alpha/manuscript/001-volume/001-chapter/index.md",
            "alpha/manuscript/001-volume/002-chapter/index.md",
        ]);
    });

    it("目标路径以工作空间名分段，并使用 / 分隔", async () => {
        const plan = await planManuscripts(root);
        for (const file of plan.files) expect(file.targetPath).not.toContain("\\");
    });

    it("没有 manuscript 的工作空间保留在清单里，但不产出文件", async () => {
        const plan = await planManuscripts(root);

        expect(plan.workspaces.map((workspace) => workspace.name)).toEqual(["alpha", "beta"]);
        expect(plan.workspaces.find((workspace) => workspace.name === "beta")?.files).toEqual([]);
    });

    it("工作空间目录不存在时报 ENOENT，由命令入口转成退出码 4", async () => {
        await expect(planManuscripts(resolve(root, "missing"))).rejects.toMatchObject({code: "ENOENT"});
    });
});
