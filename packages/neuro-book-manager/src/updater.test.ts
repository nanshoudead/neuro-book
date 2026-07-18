import {createHash} from "node:crypto";
import {mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";
import {readInstallationManifest} from "#manager/manifest-store";
import {installationPaths} from "#manager/paths";
import type {InstallationManifest, ReleaseManifest} from "#manager/types";
import {updateInstallation} from "#manager/updater";
import {planGitProfileUpdate, planReleaseProfileUpdate} from "#manager/update-planner";

const manifestStore = vi.hoisted(() => ({resolve: vi.fn()}));
vi.mock("#manager/manifest-store", async (importOriginal) => ({
    ...await importOriginal<typeof import("#manager/manifest-store")>(),
    resolveReleaseManifest: manifestStore.resolve,
}));

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const MANAGER_SOURCE = "console.log('manager');\n";
const MANAGER_SHA = createHash("sha256").update(MANAGER_SOURCE).digest("hex");
let root: string | null = null;

afterEach(async () => {
    manifestStore.resolve.mockReset();
    if (root) {
        await rm(root, {recursive: true, force: true});
        root = null;
    }
});

describe("Release Update预检", () => {
    it("应用、channel与Manager均一致时无副作用退出", async () => {
        root = await fixtureRoot();
        const manifest = productManifest();
        manifestStore.resolve.mockResolvedValue(releaseManifest());

        const result = await updateInstallation({root, manifest, managerExecutable: join(root, "manager-source.mjs")});

        expect(result).toEqual({manifest, changed: false, reason: "already-current"});
        await expect(stat(installationPaths(root).operations)).rejects.toMatchObject({code: "ENOENT"});
        await expect(stat(installationPaths(root).staging)).rejects.toMatchObject({code: "ENOENT"});
    });

    it("应用相同但Manager较新时只接管Manager", async () => {
        root = await fixtureRoot();
        const manifest = productManifest({managerVersion: "0.1.0-canary.18"});
        manifestStore.resolve.mockResolvedValue(releaseManifest());
        const source = join(root, "manager-source.mjs");
        await writeFile(source, MANAGER_SOURCE, "utf8");

        const result = await updateInstallation({root, manifest, managerExecutable: source});

        expect(result.changed).toBe(true);
        expect(result.manifest.appVersion).toBe(manifest.appVersion);
        expect(result.manifest.components.source).toEqual(manifest.components.source);
        expect(result.manifest.components.product).toEqual(manifest.components.product);
        expect(result.manifest.managerVersion).toBe("0.1.0-canary.19");
        expect((await readInstallationManifest(installationPaths(root).manifest))?.managerVersion).toBe("0.1.0-canary.19");
        await expect(stat(join(root, ".deploy", "backups"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("GHCR应用相同但Manager较新时不生成或切换Compose", async () => {
        const manifest = ghcrManifest({managerVersion: "0.1.0-canary.18"});
        const release = releaseManifest();

        const plan = planReleaseProfileUpdate(manifest, release, "canary", true);

        expect(plan.applicationChanged).toBe(false);
        expect(plan.managerChanged).toBe(true);
        expect([...plan.components]).toEqual([]);
        expect(plan.alreadyCurrent).toBe(false);
    });

    it("staging失败发生在停服务与数据库备份前，并清理本次staging", async () => {
        root = await fixtureRoot();
        const manifest = productManifest();
        const databasePath = join(root, "workspace", ".nbook", "neuro-book.sqlite");
        await mkdir(databasePath, {recursive: true});
        manifestStore.resolve.mockResolvedValue(releaseManifest({version: "0.8.7-canary.1", sourceRevision: "c".repeat(40), sha: SHA_B}));

        await expect(updateInstallation({root, manifest, managerExecutable: join(root, "manager-source.mjs")}))
            .rejects.toThrow("下载失败 404");

        const operations = await readdir(installationPaths(root).operations);
        expect(operations).toHaveLength(1);
        const journal = JSON.parse(await readFile(join(installationPaths(root).operations, operations[0]!), "utf8")) as {
            phase: string;
            outcome?: string;
            nextManifest: unknown;
        };
        expect(journal).toMatchObject({phase: "committed", outcome: "rolled-back", nextManifest: null});
        expect(await readdir(installationPaths(root).staging)).toEqual([]);
        expect(await stat(databasePath)).toBeTruthy();
    });

    it("checksum变化只保留真正变化的应用组件", () => {
        const manifest = productManifest();
        const release = releaseManifest({productSha: SHA_B});

        const plan = planReleaseProfileUpdate(manifest, release, "canary", false);

        expect([...plan.components]).toEqual(["source", "product"]);
        expect(plan.applicationChanged).toBe(true);
        expect(plan.alreadyCurrent).toBe(false);
    });
});

describe("Git Profile Update Planner", () => {
    it("Source Dev只更新Source，Source Product固定更新Source与Product", () => {
        const sourceDev = gitManifest("source-dev");
        const sourceProduct = gitManifest("source-product");

        expect([...planGitProfileUpdate(sourceDev, "2".repeat(40), "canary", false).components]).toEqual(["source"]);
        expect([...planGitProfileUpdate(sourceProduct, "2".repeat(40), "canary", false).components]).toEqual(["source", "product"]);
    });

    it("同revision、同channel且Manager未变化时无操作", () => {
        const manifest = gitManifest("source-dev");
        expect(planGitProfileUpdate(manifest, manifest.sourceRevision, manifest.channel, false).alreadyCurrent).toBe(true);
    });
});

async function fixtureRoot(): Promise<string> {
    const fixture = await mkdtemp(join(tmpdir(), "nbook-manager-update-"));
    await mkdir(join(fixture, ".deploy"), {recursive: true});
    await writeFile(join(fixture, "manager-source.mjs"), MANAGER_SOURCE, "utf8");
    return fixture;
}

function productManifest(overrides: {managerVersion?: string} = {}): InstallationManifest {
    return {
        schemaVersion: 4,
        profile: "product-bun",
        containerEngine: null,
        managerVersion: overrides.managerVersion ?? "0.1.0-canary.19",
        appVersion: "0.8.6-canary.1",
        channel: "canary",
        sourceRevision: "1".repeat(40),
        stateRoot: ".",
        components: {
            source: {
                provider: "release",
                version: "0.8.6-canary.1",
                revision: "1".repeat(40),
                path: ".",
                files: ["package.json"],
                archiveSha256: SHA_A,
                sourceUrl: "https://example.com/source.zip",
                license: "AGPL-3.0-only",
                redistribution: "test",
            },
            product: {
                provider: "release",
                version: "0.8.6-canary.1",
                revision: "1".repeat(40),
                path: ".output",
                platform: "windows-x64",
                archiveSha256: SHA_A,
                sourceUrl: "https://example.com/product.zip",
                license: "AGPL-3.0-only",
                redistribution: "test",
            },
            manager: {provider: "managed", version: overrides.managerVersion ?? "0.1.0-canary.19", path: ".runtime/manager/old/neuro-book.mjs", bundleSha256: MANAGER_SHA},
            managerRuntime: {provider: "system", version: "1.3.14", executable: process.execPath},
            applicationRuntime: {provider: "system", version: "1.3.14", executable: process.execPath},
            tools: {},
        },
        installedAt: "2026-07-17T00:00:00.000Z",
        updatedAt: "2026-07-17T00:00:00.000Z",
    };
}

function ghcrManifest(overrides: {managerVersion?: string} = {}): InstallationManifest {
    const manifest = productManifest(overrides);
    return {
        ...manifest,
        profile: "ghcr",
        stateRoot: ".",
        components: {
            source: {
                provider: "container",
                version: manifest.appVersion,
                revision: manifest.sourceRevision,
                path: "/app",
            },
            product: {
                provider: "container",
                version: manifest.appVersion,
                revision: manifest.sourceRevision,
                image: `ghcr.io/notnotype/neuro-book:v${manifest.appVersion}`,
                digest: `sha256:${SHA_A}`,
            },
            manager: manifest.components.manager,
            managerRuntime: manifest.components.managerRuntime,
            applicationRuntime: {provider: "container", version: manifest.appVersion},
            tools: {},
        },
    };
}

function gitManifest(profile: "source-dev" | "source-product"): InstallationManifest {
    const manifest = productManifest();
    return {
        ...manifest,
        profile,
        components: {
            ...manifest.components,
            source: {
                provider: "git",
                version: manifest.appVersion,
                revision: manifest.sourceRevision,
                path: ".",
                repository: "https://github.com/notnotype/neuro-book.git",
                branch: "master",
            },
            product: profile === "source-dev" ? undefined : {
                provider: "git",
                version: manifest.appVersion,
                revision: manifest.sourceRevision,
                path: ".output",
                platform: "windows-x64",
            },
        },
    };
}

function releaseManifest(overrides: {version?: string; sourceRevision?: string; sha?: string; productSha?: string} = {}): ReleaseManifest {
    const version = overrides.version ?? "0.8.6-canary.1";
    const sourceRevision = overrides.sourceRevision ?? "1".repeat(40);
    const sourceSha = overrides.sha ?? SHA_A;
    return {
        schemaVersion: 3,
        version,
        channel: "canary",
        sourceRevision,
        minManagerVersion: "0.1.0-canary.19",
        source: {url: "https://example.com/source.zip", sha256: sourceSha, bytes: 1},
        products: [{platform: "windows-x64", sourceRevision, url: "https://example.com/product.zip", sha256: overrides.productSha ?? sourceSha, bytes: 1}],
        windowsPortable: {url: "https://example.com/portable.zip", sha256: sourceSha, bytes: 1},
        ghcr: {ref: `ghcr.io/notnotype/neuro-book:v${version}`, digest: `sha256:${SHA_A}`, sourceRevision},
    };
}
