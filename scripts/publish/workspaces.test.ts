import {spawnSync} from "node:child_process";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {afterAll, beforeAll, describe, expect, it} from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const entry = resolve(repoRoot, "scripts/publish/workspaces.ts");

let workspaceRoot: string;

function run(args: readonly string[]): {status: number | null; stdout: string; stderr: string} {
    const result = spawnSync("bun", [entry, ...args], {cwd: repoRoot, encoding: "utf8"});
    return {status: result.status, stdout: result.stdout, stderr: result.stderr};
}

beforeAll(async () => {
    workspaceRoot = await createTestTmpRoot("publish-cli", "发布命令");
    await mkdir(resolve(workspaceRoot, "alpha/manuscript/001-chapter"), {recursive: true});
    await writeFile(resolve(workspaceRoot, "alpha/project.yaml"), "kind: novel\n", "utf8");
    await writeFile(resolve(workspaceRoot, "alpha/manuscript/001-chapter/index.md"), "# 第一章\n", "utf8");
});

afterAll(async () => {
    await rm(workspaceRoot, {recursive: true, force: true});
});

describe("发布命令", () => {
    it("--dry-run 只输出清单，退出码 0", () => {
        const result = run(["--dry-run", "--workspaces", workspaceRoot]);

        expect(result.status).toBe(0);
        const report = JSON.parse(result.stdout) as {
            schema: string;
            dryRun: boolean;
            files: number;
            workspaces: {name: string; files: number}[];
        };
        expect(report.schema).toBe("nbook.publish-workspaces/v1");
        expect(report.dryRun).toBe(true);
        expect(report.files).toBe(1);
        expect(report.workspaces).toEqual([{name: "alpha", files: 1}]);
    });

    it("真实发布缺目标仓库时在写任何东西之前退出，退出码 2", () => {
        const result = run(["--workspaces", workspaceRoot]);

        expect(result.status).toBe(2);
        expect(result.stderr).toContain("缺少目标仓库");
    });

    it("未知参数退出码 2，不访问工作空间", () => {
        const result = run(["--dry-run", "--workspaces", workspaceRoot, "--bogus"]);

        expect(result.status).toBe(2);
        expect(result.stderr).toContain("未知参数：--bogus");
    });

    it("工作空间目录不存在时退出码 4", () => {
        const result = run(["--dry-run", "--workspaces", resolve(workspaceRoot, "missing")]);

        expect(result.status).toBe(4);
        expect(result.stderr).toContain("工作空间目录不存在");
    });
});
