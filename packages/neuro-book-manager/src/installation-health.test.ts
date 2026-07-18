import {createHash} from "node:crypto";
import {mkdtemp, mkdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {afterEach, describe, expect, it} from "vitest";

import {doctor} from "#manager/installation-health";
import {writeInstallationManifest} from "#manager/manifest-store";
import {installationPaths} from "#manager/paths";
import {currentProductPlatform} from "#manager/platform";
import {renderManagerWrapper} from "#manager/runtime";
import type {InstallationManifest} from "#manager/types";

const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true}))));

describe("Installation Health", () => {
    it("原生服务正常停止时doctor保持healthy并给出start warning", async () => {
        const {root, manifest} = await fixture();
        const report = await doctor(root, manifest);
        expect(report.healthy).toBe(true);
        expect(report.service.status).toBe("stopped");
        expect(report.checks).toContainEqual(expect.objectContaining({id: "service.application", status: "warn"}));
    });

    it("wrapper存在但内容指向旧组件时doctor失败", async () => {
        const {root, manifest} = await fixture();
        const wrapper = join(root, ".runtime", "bin", process.platform === "win32" ? "neuro-book.cmd" : "neuro-book");
        await writeFile(wrapper, "old-manager-wrapper\n", "utf8");
        const report = await doctor(root, manifest);
        expect(report.healthy).toBe(false);
        expect(report.checks).toContainEqual(expect.objectContaining({id: "manager.wrapper", status: "fail"}));
    });
});

async function fixture(): Promise<{root: string; manifest: InstallationManifest}> {
    const root = await mkdtemp(join(tmpdir(), "nbook-health-"));
    roots.push(root);
    const managerPath = join(root, ".runtime", "manager", "0.1.0", "neuro-book.mjs");
    const wrapperPath = join(root, ".runtime", "bin", process.platform === "win32" ? "neuro-book.cmd" : "neuro-book");
    await Promise.all([
        mkdir(join(root, ".deploy"), {recursive: true}),
        mkdir(join(root, ".runtime", "manager", "0.1.0"), {recursive: true}),
        mkdir(join(root, ".runtime", "bin"), {recursive: true}),
        mkdir(join(root, ".output", "server"), {recursive: true}),
        mkdir(join(root, "workspace", ".nbook"), {recursive: true}),
        mkdir(join(root, "logs"), {recursive: true}),
    ]);
    const bundle = "export default {}\n";
    await Promise.all([
        writeFile(managerPath, bundle, "utf8"),
        writeFile(join(root, ".output", "server", "index.mjs"), "export default {}\n", "utf8"),
        writeFile(join(root, "config.yaml"), "server: {}\n", "utf8"),
        writeFile(join(root, ".env"), "NUXT_PORT=19373\n", "utf8"),
    ]);
    const revision = "a".repeat(40);
    const manager = {provider: "managed" as const, version: "0.1.0", path: ".runtime/manager/0.1.0/neuro-book.mjs", bundleSha256: createHash("sha256").update(bundle).digest("hex")};
    const runtime = {provider: "system" as const, version: "1.3.0", executable: "bun"};
    await writeFile(wrapperPath, renderManagerWrapper(manager, runtime), "utf8");
    const now = new Date().toISOString();
    const asset = {archiveSha256: "b".repeat(64), sourceUrl: "https://example.com/asset.zip", license: "test", redistribution: "test"};
    const manifest: InstallationManifest = {
        schemaVersion: 4,
        profile: "product-bun",
        containerEngine: null,
        managerVersion: "0.1.0",
        appVersion: "1.0.0",
        channel: "canary",
        sourceRevision: revision,
        stateRoot: ".",
        components: {
            source: {provider: "release", version: "1.0.0", revision, path: ".", files: ["package.json"], ...asset},
            product: {provider: "release", version: "1.0.0", revision, path: ".output", platform: currentProductPlatform(), ...asset},
            manager,
            managerRuntime: runtime,
            applicationRuntime: runtime,
            tools: {},
        },
        installedAt: now,
        updatedAt: now,
    };
    await writeInstallationManifest(installationPaths(root).manifest, manifest);
    return {root, manifest};
}
