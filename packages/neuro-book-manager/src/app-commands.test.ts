import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {
    applyAttachmentMigration,
    planAttachmentMigration,
    rollbackAttachmentMigration,
} from "#manager/app-commands";
import type {InstallationManifest} from "#manager/types";

const processCommands = vi.hoisted(() => ({
    capture: vi.fn(),
    run: vi.fn(),
    available: vi.fn(),
}));
const docker = vi.hoisted(() => ({command: vi.fn(), start: vi.fn()}));

vi.mock("#manager/process", () => ({
    runCapture: processCommands.capture,
    run: processCommands.run,
    commandAvailable: processCommands.available,
}));
vi.mock("#manager/docker", () => ({
    runDockerApplicationCommand: docker.command,
    startDocker: docker.start,
}));

const roots: string[] = [];

beforeEach(() => vi.clearAllMocks());
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true}))));

describe("Application Attachment migration command", () => {
    it("原生Product严格解析dry-run并使用同一runId执行apply/rollback", async () => {
        const root = await nativeProductRoot();
        const manifest = productManifest();
        processCommands.capture.mockImplementation(async (_command: string, args: string[]) => {
            if (args.includes("--rollback")) return JSON.stringify(rollbackReport("operation-attachment"));
            return JSON.stringify(migrationReport(
                "operation-attachment",
                args.includes("--apply") ? "apply" : "dry-run",
                2,
            ));
        });

        const plan = await planAttachmentMigration(root, manifest, "operation-attachment");
        await applyAttachmentMigration(root, manifest, plan!.runId);
        await rollbackAttachmentMigration(root, manifest, plan!.runId);

        expect(plan).toMatchObject({runId: "operation-attachment", migratedSessions: 2});
        expect(plan?.sessions).toHaveLength(2);
        expect(processCommands.capture).toHaveBeenCalledTimes(3);
        expect(processCommands.capture.mock.calls[0]?.[0]).toBe("bun");
        expect(processCommands.capture.mock.calls[0]?.[1]).toEqual(expect.arrayContaining(["--dry-run", "--run-id", "operation-attachment"]));
        expect(processCommands.capture.mock.calls[1]?.[1]).toEqual(expect.arrayContaining(["--apply", "--run-id", "operation-attachment"]));
        expect(processCommands.capture.mock.calls[2]?.[1]).toEqual(expect.arrayContaining(["--rollback", "operation-attachment"]));
    });

    it("没有旧图片时不创建migration plan", async () => {
        const root = await nativeProductRoot();
        processCommands.capture.mockResolvedValue(JSON.stringify(migrationReport("no-change", "dry-run", 0)));

        await expect(planAttachmentMigration(root, productManifest(), "no-change")).resolves.toBeNull();
    });

    it("Product缺少migration脚本时fail closed", async () => {
        const root = await mkdtemp(join(tmpdir(), "manager-missing-migration-"));
        roots.push(root);

        await expect(planAttachmentMigration(root, productManifest(), "missing-script"))
            .rejects.toThrow("缺少Attachment migration脚本");
        expect(processCommands.capture).not.toHaveBeenCalled();
    });

    it("容器Profile通过Compose一次性app执行相同协议", async () => {
        const root = await mkdtemp(join(tmpdir(), "manager-container-migration-"));
        roots.push(root);
        docker.command.mockImplementation(async (_root: string, _stateRoot: string, args: string[]) => {
            if (args.includes("--rollback")) return JSON.stringify(rollbackReport("docker-attachment"));
            return JSON.stringify(migrationReport(
                "docker-attachment",
                args.includes("--apply") ? "apply" : "dry-run",
                1,
            ));
        });
        const manifest = dockerManifest();

        const plan = await planAttachmentMigration(root, manifest, "docker-attachment");
        await applyAttachmentMigration(root, manifest, plan!.runId);
        await rollbackAttachmentMigration(root, manifest, plan!.runId);

        expect(docker.command).toHaveBeenCalledTimes(3);
        expect(docker.command.mock.calls[0]?.[2]).toEqual([
            "bun",
            ".output/server/scripts/db/migrate-agent-attachments.ts",
            "--dry-run",
            "--run-id",
            "docker-attachment",
        ]);
    });

    it("拒绝错误runId与宽松JSON报告", async () => {
        const root = await nativeProductRoot();
        processCommands.capture.mockResolvedValueOnce(JSON.stringify(migrationReport("other-run", "dry-run", 1)));
        await expect(planAttachmentMigration(root, productManifest(), "expected-run"))
            .rejects.toThrow("不一致的报告");
        processCommands.capture.mockResolvedValueOnce(JSON.stringify({...migrationReport("expected-run", "dry-run", 1), extra: true}));
        await expect(planAttachmentMigration(root, productManifest(), "expected-run"))
            .rejects.toThrow("无效报告");
    });

    it("applied状态拒绝not_started，只有planned恢复允许", async () => {
        const root = await nativeProductRoot();
        processCommands.capture.mockResolvedValue(JSON.stringify(rollbackReport("rollback-run", "not_started")));

        await expect(rollbackAttachmentMigration(root, productManifest(), "rollback-run"))
            .rejects.toThrow("拒绝恢复旧Product");
        await expect(rollbackAttachmentMigration(root, productManifest(), "rollback-run", true))
            .resolves.toBeUndefined();
    });
});

async function nativeProductRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "manager-native-migration-"));
    roots.push(root);
    const script = join(root, ".output", "server", "scripts", "db", "migrate-agent-attachments.ts");
    await mkdir(join(script, ".."), {recursive: true});
    await writeFile(script, "", "utf8");
    return root;
}

function migrationReport(runId: string, mode: "dry-run" | "apply", migratedSessions: number) {
    return {
        version: 1,
        runId,
        mode,
        status: mode === "dry-run" ? "planned" : "complete",
        scannedSessions: migratedSessions,
        migratedSessions,
        skippedSessions: 0,
        images: migratedSessions,
        uniqueAttachments: migratedSessions,
        bytes: migratedSessions * 10,
        sessions: Array.from({length: migratedSessions}, (_, index) => ({
            sessionId: index + 1,
            sourcePath: `.nbook/agent/sessions/${String(index + 1)}.jsonl`,
            sourceHash: "a".repeat(64),
            targetHash: "b".repeat(64),
            images: 1,
            bytes: 10,
            status: mode === "dry-run" ? "pending" : "verified",
            ...(mode === "apply" ? {backupPath: `.nbook/agent/migrations/${String(index + 1)}.backup`} : {}),
        })),
    };
}

function rollbackReport(runId: string, status: "not_started" | "rolled_back" = "rolled_back") {
    return {version: 1, runId, status, restoredSessions: status === "rolled_back" ? 1 : 0};
}

function productManifest(): InstallationManifest {
    const revision = "a".repeat(40);
    return {
        schemaVersion: 3,
        profile: "product-bun",
        managerVersion: "0.1.0",
        appVersion: "0.8.0-canary.1",
        channel: "canary",
        sourceRevision: revision,
        stateRoot: ".",
        components: {
            source: {
                provider: "release",
                version: "0.8.0-canary.1",
                revision,
                path: ".",
                archiveSha256: "a".repeat(64),
                sourceUrl: "https://example.com/neuro-book-source.zip",
                license: "AGPL-3.0-only",
                redistribution: "test fixture",
                files: ["package.json"],
            },
            product: {
                provider: "release",
                version: "0.8.0-canary.1",
                revision,
                platform: "windows-x64",
                path: ".output",
                archiveSha256: "b".repeat(64),
                sourceUrl: "https://example.com/neuro-book-product-windows-x64.zip",
                license: "AGPL-3.0-only",
                redistribution: "test fixture",
            },
            manager: {provider: "managed", version: "0.1.0", path: ".runtime/manager/0.1.0/neuro-book.mjs", bundleSha256: "c".repeat(64)},
            managerRuntime: {provider: "system", version: "1.3.0", executable: "bun"},
            applicationRuntime: {provider: "system", version: "1.3.0", executable: "bun"},
            tools: {},
        },
        installedAt: "2026-07-16T00:00:00.000Z",
        updatedAt: "2026-07-16T00:00:00.000Z",
    };
}

function dockerManifest(): InstallationManifest {
    const revision = "b".repeat(40);
    return {
        schemaVersion: 3,
        profile: "ghcr",
        managerVersion: "0.1.0",
        appVersion: "0.8.0-canary.1",
        channel: "canary",
        sourceRevision: revision,
        stateRoot: ".",
        components: {
            source: {provider: "container", version: "0.8.0-canary.1", revision, path: "/app"},
            product: {provider: "container", version: "0.8.0-canary.1", revision, image: "ghcr.io/notnotype/neuro-book:test", digest: `sha256:${"d".repeat(64)}`},
            manager: {provider: "managed", version: "0.1.0", path: ".runtime/manager/0.1.0/neuro-book.mjs", bundleSha256: "c".repeat(64)},
            managerRuntime: {provider: "system", version: "1.3.0", executable: "bun"},
            applicationRuntime: {provider: "container", version: "0.8.0-canary.1"},
            tools: {rg: {provider: "container", version: "0.8.0-canary.1"}, git: {provider: "container", version: "0.8.0-canary.1"}, python: {provider: "container", version: "0.8.0-canary.1"}},
        },
        installedAt: "2026-07-16T00:00:00.000Z",
        updatedAt: "2026-07-16T00:00:00.000Z",
    };
}
