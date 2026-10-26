import {mkdir, rm, writeFile} from "node:fs/promises";
import {resolve} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {afterAll, beforeAll, describe, expect, it} from "vitest";

import {discoverWorkspaces, planManuscripts} from "#scripts/publish/manuscripts";

let root: string;

async function writeUnder(base: string, relativePath: string, text: string): Promise<void> {
    const target = resolve(base, relativePath);
    await mkdir(resolve(target, ".."), {recursive: true});
    await writeFile(target, text, "utf8");
}

async function write(relativePath: string, text: string): Promise<void> {
    await writeUnder(root, relativePath, text);
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
    const nested = {layout: "nested", workspace: null, includeBackup: false} as const;

    it("只把带 project.yaml 的目录当工作空间，跳过点目录", async () => {
        expect(await discoverWorkspaces(root)).toEqual(["alpha", "beta"]);
    });

    it("只发布 manuscript 下的 .md，排除参考资料、设定、运行时数据、备份与非正文", async () => {
        const plan = await planManuscripts(root, nested);
        const alpha = plan.workspaces.find((workspace) => workspace.name === "alpha");

        expect(alpha?.files.map((file) => file.targetPath)).toEqual([
            "alpha/manuscript/001-volume/001-chapter/index.md",
            "alpha/manuscript/001-volume/002-chapter/index.md",
        ]);
    });

    it("--include-backup 把备份副本一起发布", async () => {
        const plan = await planManuscripts(root, {layout: "nested", workspace: "alpha", includeBackup: true});

        expect(plan.files.map((file) => file.targetPath)).toContain("alpha/manuscript/001-volume/_backup/index.md");
    });

    it("目标路径以工作空间名分段，并使用 / 分隔", async () => {
        const plan = await planManuscripts(root, nested);
        for (const file of plan.files) expect(file.targetPath).not.toContain("\\");
    });

    it("没有 manuscript 的工作空间保留在清单里，但不产出文件", async () => {
        const plan = await planManuscripts(root, nested);

        expect(plan.workspaces.map((workspace) => workspace.name)).toEqual(["alpha", "beta"]);
        expect(plan.workspaces.find((workspace) => workspace.name === "beta")?.files).toEqual([]);
    });

    it("root 布局把正文直接放在仓库根，适合每部作品一个仓库", async () => {
        const plan = await planManuscripts(root, {layout: "root", workspace: "alpha", includeBackup: false});

        expect(plan.files.map((file) => file.targetPath)).toEqual([
            "001-volume/001-chapter/index.md",
            "001-volume/002-chapter/index.md",
        ]);
    });

    it("root 布局有多个作品时拒绝发布，避免同名章节互相覆盖", async () => {
        const multi = await createTestTmpRoot("publish-root-multi", "root 布局拒绝多作品");
        try {
            await writeUnder(multi, "one/project.yaml", "kind: novel\n");
            await writeUnder(multi, "one/manuscript/index.md", "# 一\n");
            await writeUnder(multi, "two/project.yaml", "kind: novel\n");
            await writeUnder(multi, "two/manuscript/index.md", "# 二\n");

            await expect(planManuscripts(multi, {layout: "root", workspace: null, includeBackup: false})).rejects.toThrow("只能发布一个工作空间");
        } finally {
            await rm(multi, {recursive: true, force: true});
        }
    });

    it("root 布局只把有正文的作品算进来，没正文的作品不挡发布", async () => {
        const plan = await planManuscripts(root, {layout: "root", workspace: null, includeBackup: false});

        expect(plan.files.map((file) => file.targetPath)).toEqual([
            "001-volume/001-chapter/index.md",
            "001-volume/002-chapter/index.md",
        ]);
    });

    it("--workspace 只收集指定工作空间，名字不存在时报参数错误", async () => {
        const plan = await planManuscripts(root, {layout: "nested", workspace: "beta", includeBackup: false});

        expect(plan.workspaces.map((workspace) => workspace.name)).toEqual(["beta"]);
        await expect(planManuscripts(root, {layout: "nested", workspace: "missing", includeBackup: false})).rejects.toThrow("没有这个工作空间");
    });

    it("工作空间目录不存在时报 ENOENT，由命令入口转成退出码 4", async () => {
        await expect(planManuscripts(resolve(root, "missing"), nested)).rejects.toMatchObject({code: "ENOENT"});
    });
});
