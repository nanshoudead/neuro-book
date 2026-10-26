import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

import {describe, expect, it} from "vitest";

import {parsePublishArguments, UsageError} from "#scripts/publish/options";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("发布参数", () => {
    it("默认读旧应用的工作空间、推 main，并对齐到仓库根", () => {
        const options = parsePublishArguments([], {}, import.meta.url);

        expect(options.repoRoot).toBe(repoRoot);
        expect(options.workspaceRoot).toBe(resolve(repoRoot, "packages/neuro-book-legacy/data/workspace"));
        expect(options.cacheDir).toBe(resolve(repoRoot, ".local/publish/workspaces"));
        expect(options.branch).toBe("main");
        expect(options.repoUrl).toBeNull();
        expect(options.token).toBeNull();
        expect(options.workspace).toBeNull();
        expect(options.layout).toBe("nested");
        expect(options.includeBackup).toBe(false);
        expect(options.dryRun).toBe(false);
    });

    it("从环境变量读仓库、令牌与分支，令牌不经过 argv", () => {
        const options = parsePublishArguments([], {
            NB_PUBLISH_REPO: "https://github.com/example/novels.git",
            NB_PUBLISH_TOKEN: "ghp_example",
            NB_PUBLISH_BRANCH: "novels",
        }, import.meta.url);

        expect(options.repoUrl).toBe("https://github.com/example/novels.git");
        expect(options.token).toBe("ghp_example");
        expect(options.branch).toBe("novels");
    });

    it("相对目录按仓库根解析，开关可放在任意位置", () => {
        const options = parsePublishArguments(
            ["--dry-run", "--workspaces", "other/workspace", "--cache", "tmp/cache", "--branch", "drafts", "--repo", "https://example.com/a.git"],
            {},
            import.meta.url,
        );

        expect(options.dryRun).toBe(true);
        expect(options.workspaceRoot).toBe(resolve(repoRoot, "other/workspace"));
        expect(options.cacheDir).toBe(resolve(repoRoot, "tmp/cache"));
        expect(options.branch).toBe("drafts");
        expect(options.repoUrl).toBe("https://example.com/a.git");
    });

    it("拒绝未知参数、缺值参数与空分支名，避免静默退回默认值", () => {
        expect(() => parsePublishArguments(["--reop", "x"], {}, import.meta.url)).toThrow(UsageError);
        expect(() => parsePublishArguments(["--repo"], {}, import.meta.url)).toThrow("参数缺少值：--repo");
        expect(() => parsePublishArguments(["--branch", "  "], {}, import.meta.url)).toThrow("分支名不能为空");
        expect(() => parsePublishArguments(["--layout", "flat"], {}, import.meta.url)).toThrow("--layout 只能是 nested 或 root");
    });

    it("--workspace 与 --layout、--include-backup 组合支持每部作品一个仓库", () => {
        const options = parsePublishArguments(
            ["--workspace", "chi-nv-ai-li-nuo", "--layout", "root", "--include-backup"],
            {},
            import.meta.url,
        );

        expect(options.workspace).toBe("chi-nv-ai-li-nuo");
        expect(options.layout).toBe("root");
        expect(options.includeBackup).toBe(true);
    });

    it("--help 只置位，不要求其它参数", () => {
        expect(parsePublishArguments(["--help"], {}, import.meta.url).help).toBe(true);
    });
});
