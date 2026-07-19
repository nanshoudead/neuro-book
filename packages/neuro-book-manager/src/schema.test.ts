import {describe, expect, it} from "vitest";

import {PRODUCT_ASSET_NAMES} from "#manager/platform";
import {parseInstallationManifest, parseOperationJournal, parseReleaseManifest, parseReleaseManifestEnvelope} from "#manager/schema";
import {PRODUCT_PLATFORMS} from "#manager/types";

const SHA = "a".repeat(64);
const REVISION = "b".repeat(40);

describe("Manager manifest schemas", () => {
    it("接受 Product Bun 的固定组件结构", () => {
        expect(parseInstallationManifest(productManifest()).profile).toBe("product-bun");
    });

    it("直接拒绝旧版Installation Manifest", () => {
        expect(() => parseInstallationManifest({...productManifest(), schemaVersion: 3})).toThrow("schema v4");
    });

    it("拒绝路径越界与 Source/Product revision 不一致", () => {
        const invalidPath = productManifest();
        invalidPath.components.manager.path = "../manager.mjs";
        expect(() => parseInstallationManifest(invalidPath)).toThrow("Installation Root");

        const mismatch = productManifest();
        mismatch.components.product.revision = "c".repeat(40);
        expect(() => parseInstallationManifest(mismatch)).toThrow("revision");
    });

    it("验证Release五平台完整且唯一", () => {
        const manifest = releaseManifest();
        expect(parseReleaseManifest(manifest).products[0]?.platform).toBe("windows-x64");
        manifest.products[manifest.products.length - 1] = {...manifest.products[0]!};
        expect(() => parseReleaseManifest(manifest)).toThrow("重复 Product 平台");
    });

    it("拒绝缺少任一平台或资产名错误的Release", () => {
        const missing = releaseManifest();
        missing.products = missing.products.filter((product) => product.platform !== "darwin-aarch64");
        expect(() => parseReleaseManifest(missing)).toThrow("缺少：darwin-aarch64");

        const wrongAsset = releaseManifest();
        wrongAsset.products[0] = {...wrongAsset.products[0]!, url: "https://example.com/product.zip"};
        expect(() => parseReleaseManifest(wrongAsset)).toThrow("资产名非法");
    });

    it("要求容器Profile持久化engine，非容器Profile必须为null", () => {
        expect(() => parseInstallationManifest({...productManifest(), containerEngine: "docker"})).toThrow("Container Engine");
        const container = dockerManifest();
        expect(parseInstallationManifest(container).containerEngine).toBe("podman");
        expect(() => parseInstallationManifest({...container, containerEngine: null})).toThrow("Container Engine");
    });

    it("Operation Journal v3固定并校验Manifest engine", () => {
        const manifest = dockerManifest();
        const journal = operationJournal(manifest);
        expect(parseOperationJournal(journal, "memory.json").containerEngine).toBe("podman");
        expect(() => parseOperationJournal({...journal, containerEngine: "docker"}, "memory.json")).toThrow("不一致");
        expect(() => parseOperationJournal({...journal, schemaVersion: 1}, "memory.json")).toThrow("不符合 schema");
    });

    it("可在严格payload解析前读取Release envelope", () => {
        expect(parseReleaseManifestEnvelope({schemaVersion: 99, minManagerVersion: "9.0.0", future: true})).toEqual({schemaVersion: 99, minManagerVersion: "9.0.0"});
    });
});

function productManifest() {
    return {
        schemaVersion: 4 as const,
        profile: "product-bun" as const,
        containerEngine: null,
        managerVersion: "0.1.0",
        appVersion: "0.8.0",
        channel: "stable" as const,
        sourceRevision: REVISION,
        stateRoot: "." as const,
        components: {
            source: {
                provider: "release" as const,
                version: "0.8.0",
                revision: REVISION,
                path: "." as const,
                files: ["package.json"],
                archiveSha256: SHA,
                sourceUrl: "https://example.com/source.zip",
                license: "AGPL-3.0-only",
                redistribution: "test",
            },
            product: {
                provider: "release" as const,
                version: "0.8.0",
                revision: REVISION,
                path: ".output" as const,
                platform: "windows-x64" as const,
                archiveSha256: SHA,
                sourceUrl: "https://example.com/product.zip",
                license: "AGPL-3.0-only",
                redistribution: "test",
            },
            manager: {provider: "managed" as const, version: "0.1.0", path: ".runtime/manager/0.1.0/neuro-book.mjs", bundleSha256: SHA},
            managerRuntime: {provider: "system" as const, version: "1.3.0", executable: "bun"},
            applicationRuntime: {provider: "system" as const, version: "1.3.0", executable: "bun"},
            tools: {},
        },
        installedAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
    };
}

function releaseManifest() {
    return {
        schemaVersion: 3 as const,
        version: "0.8.0",
        channel: "stable" as const,
        sourceRevision: REVISION,
        minManagerVersion: "0.1.0",
        source: {url: "https://example.com/source.zip", sha256: SHA, bytes: 1},
        products: PRODUCT_PLATFORMS.map((platform) => ({
            url: `https://example.com/${PRODUCT_ASSET_NAMES[platform]}`,
            sha256: SHA,
            bytes: 1,
            platform,
            sourceRevision: REVISION,
        })),
        windowsPortable: {url: "https://example.com/portable.zip", sha256: SHA, bytes: 1},
        ghcr: {ref: "ghcr.io/notnotype/neuro-book:v0.8.0", digest: `sha256:${SHA}`, sourceRevision: REVISION},
    };
}

function dockerManifest() {
    const manifest = productManifest();
    return {
        ...manifest,
        profile: "source-docker" as const,
        containerEngine: "podman" as const,
        components: {
            ...manifest.components,
            source: {provider: "git" as const, version: "0.8.0", revision: REVISION, path: "." as const, repository: "https://github.com/notnotype/neuro-book.git", branch: "master"},
            product: {provider: "container" as const, version: "0.8.0", revision: REVISION, image: "neuro-book-source:test"},
            applicationRuntime: {provider: "container" as const, version: "0.8.0"},
            tools: {
                rg: {provider: "container" as const, version: "source-docker"},
                git: {provider: "container" as const, version: "source-docker"},
                python: {provider: "container" as const, version: "source-docker"},
            },
        },
    };
}

function operationJournal(manifest: ReturnType<typeof dockerManifest>) {
    const now = "2026-07-16T00:00:00.000Z";
    return {
        schemaVersion: 3 as const,
        id: "operation",
        action: "update" as const,
        phase: "planned" as const,
        root: "C:/neuro-book",
        containerEngine: "podman" as const,
        effects: [],
        backupRoot: "C:/neuro-book/.deploy/backups/operation",
        previousManifest: manifest,
        nextManifest: manifest,
        createdAt: now,
        updatedAt: now,
    };
}
