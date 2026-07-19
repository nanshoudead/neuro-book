import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";

import {afterEach, describe, expect, it} from "vitest";
import {parse} from "yaml";

import {currentProductPlatform, PRODUCT_ASSET_NAMES} from "nbook/packages/neuro-book-manager/src/platform";
import {PRODUCT_PLATFORMS} from "nbook/packages/neuro-book-manager/src/types";
import {runCapture} from "nbook/scripts/utils/process.mjs";

const ROOT = resolve(import.meta.dirname, "..", "..");
const roots: string[] = [];

type WorkflowStep = {
    id?: string;
    if?: string;
    name?: string;
    run?: string;
    uses?: string;
    with?: {key?: string; path?: string; platforms?: string};
};

type WorkflowJob = {
    needs?: string | string[];
    "runs-on"?: string;
    steps: WorkflowStep[];
};

type ReleaseWorkflow = {
    concurrency?: {
        group?: string;
        "cancel-in-progress"?: string | boolean;
    };
    jobs: {
        preflight: WorkflowJob;
        "build-and-push": WorkflowJob;
        source: WorkflowJob;
        "product-linux": WorkflowJob;
        "product-linux-aarch64": WorkflowJob;
        "product-darwin-x64": WorkflowJob;
        "product-windows": WorkflowJob;
    };
};

type ProductWorkflow = {
    jobs: {
        product: WorkflowJob & {
            strategy: {
                matrix: {
                    include: Array<{platform: string; browser: string}>;
                };
            };
        };
    };
};

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Product Release宿主合同", () => {
    it("拒绝把当前.output包装成其他平台资产", async () => {
        const current = currentProductPlatform();
        const foreign = PRODUCT_PLATFORMS.find((platform) => platform !== current)!;
        const outputRoot = await mkdtemp(join(tmpdir(), "nbook-product-platform-"));
        roots.push(outputRoot);

        await expect(runCapture("bun", [
            "scripts/release/release-assets.ts",
            "product",
            "--platform", foreign,
            "--output", join(outputRoot, PRODUCT_ASSET_NAMES[foreign]),
        ], {cwd: ROOT})).rejects.toThrow(`当前宿主${current}不能包装${foreign}`);
    });

    it("在任何GHCR或资产构建前集中执行Release Preflight", async () => {
        const workflow = parse(await readFile(resolve(ROOT, ".github/workflows/release-container.yml"), "utf8")) as ReleaseWorkflow;
        expect(workflow.jobs.preflight.steps).toContainEqual(
            expect.objectContaining({run: "bun run manager:verify-public"}),
        );
        const preflightRun = workflow.jobs.preflight.steps.map(({run}) => run ?? "").join("\n");
        expect(preflightRun).toContain("bun run test:install");
        expect(preflightRun).toContain("bun run manager:test");
        expect(preflightRun).toContain("release-assets.test.ts");
        expect(workflow.jobs["build-and-push"].needs).toBe("preflight");
        expect(workflow.jobs.source.needs).toBe("preflight");
        expect(workflow.jobs["product-linux"].needs).toBe("preflight");
        expect(workflow.jobs["product-linux-aarch64"].needs).toBe("source");
        const productLinuxRun = workflow.jobs["product-linux"].steps.map(({run}) => run ?? "").join("\n");
        expect(productLinuxRun).not.toContain("bun run test:install");
        expect(productLinuxRun).not.toContain("bun run manager:test");
        const macosRun = workflow.jobs["product-darwin-x64"].steps.map(({run}) => run ?? "").join("\n");
        expect(macosRun).toContain("bun run test:install");
        expect(macosRun).toContain("bun run manager:test");
        const windowsRun = workflow.jobs["product-windows"].steps.map(({run}) => run ?? "").join("\n");
        expect(windowsRun).toContain("bun run manager:test");
    });

    it("Canary自动取消旧Release并精确缓存Windows依赖", async () => {
        const workflow = parse(await readFile(resolve(ROOT, ".github/workflows/release-container.yml"), "utf8")) as ReleaseWorkflow;
        expect(workflow.concurrency?.group).toContain("github.event.release.prerelease");
        expect(workflow.concurrency?.["cancel-in-progress"]).toContain("github.event.release.prerelease");
        const cache = workflow.jobs["product-windows"].steps.find(({uses}) => uses === "actions/cache@v4");
        expect(cache?.with?.path).toContain("node_modules");
        expect(cache?.with?.path).toContain("~/.bun/install/cache");
        expect(cache?.with?.key).toContain("steps.setup-bun.outputs.bun-version");
        expect(cache?.with?.key).toContain("hashFiles('bun.lock', 'package.json', 'packages/neuro-book-manager/package.json')");
        expect(workflow.jobs["product-windows"].steps).toContainEqual(expect.objectContaining({
            run: "bun install --frozen-lockfile --linker hoisted",
        }));
    });

    it("Linux AArch64 Product必须安装并执行真实浏览器smoke", async () => {
        const workflow = parse(await readFile(resolve(ROOT, ".github/workflows/product-platforms.yml"), "utf8")) as ProductWorkflow;
        const releaseWorkflow = parse(await readFile(resolve(ROOT, ".github/workflows/release-container.yml"), "utf8")) as ReleaseWorkflow;
        const linuxArm = workflow.jobs.product.strategy.matrix.include.find(({platform}) => platform === "linux-aarch64-glibc");
        expect(linuxArm?.browser).toBe("playwright");
        expect(workflow.jobs.product.steps).toContainEqual(
            expect.objectContaining({run: "bunx playwright-core install --with-deps chromium"}),
        );
        expect(releaseWorkflow.jobs["product-linux-aarch64"].steps).toContainEqual(
            expect.objectContaining({run: "bunx playwright-core install --with-deps chromium"}),
        );
        expect(releaseWorkflow.jobs["product-linux-aarch64"].steps.some(
            ({run}) => run?.includes("verify-posix-product.sh") && run.includes("playwright"),
        )).toBe(true);
    });

    it("GHCR同时构建并验收linux amd64、arm64与rootless Podman", async () => {
        const workflow = parse(await readFile(resolve(ROOT, ".github/workflows/release-container.yml"), "utf8")) as ReleaseWorkflow & {
            jobs: ReleaseWorkflow["jobs"] & {
                "publish-index": WorkflowJob;
                "verify-public-ghcr-amd64": WorkflowJob;
                "verify-public-ghcr-arm64": WorkflowJob;
                "verify-public-ghcr-podman": WorkflowJob;
                "verify-public-windows-data-reuse": WorkflowJob;
            };
        };
        const buildSteps = workflow.jobs["build-and-push"].steps.filter(({uses}) => uses === "docker/build-push-action@v6");
        expect(buildSteps).toHaveLength(2);
        for (const step of buildSteps) expect(step.with?.platforms).toBe("linux/amd64,linux/arm64");
        expect(workflow.jobs["verify-public-ghcr-arm64"]["runs-on"]).toBe("ubuntu-24.04-arm");
        expect(workflow.jobs["verify-public-ghcr-podman"].steps.some(({run}) => run?.includes("podman-compose"))).toBe(true);
        expect(workflow.jobs["verify-public-ghcr-podman"].steps.some(({run}) => run?.includes("verify-public-ghcr.sh") && run.includes("podman"))).toBe(true);
        expect(workflow.jobs["publish-index"].needs).toEqual([
            "verify-public-ghcr-amd64",
            "verify-public-ghcr-arm64",
            "verify-public-ghcr-podman",
            "verify-public-windows-data-reuse",
        ]);
    });

    it("Manifest v4首次发布只复用0.8.6完整data目录", async () => {
        const workflow = parse(await readFile(resolve(ROOT, ".github/workflows/release-container.yml"), "utf8")) as ReleaseWorkflow & {
            jobs: ReleaseWorkflow["jobs"] & {"verify-public-windows-data-reuse": WorkflowJob};
        };
        const run = workflow.jobs["verify-public-windows-data-reuse"].steps.map((step) => step.run ?? "").join("\n");
        expect(run).toContain("$oldManager --root $baselineRoot admin create");
        expect(run).toContain("Copy-Item -LiteralPath (Join-Path $baselineRoot \"data\")");
        expect(run).toContain("$candidateManifest.schemaVersion -ne 4");
        expect(run).not.toContain("--root $root update --channel");
    });
});
