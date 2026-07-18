import {mkdtemp, readFile, readdir, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {applyJournaledApplicationMigrations, startInstallationApplication} from "#manager/migration-operation";
import {createOperation} from "#manager/operation";
import type {InstallationManifest} from "#manager/types";

const migrations = vi.hoisted(() => ({
    database: vi.fn(),
    plan: vi.fn(),
    apply: vi.fn(),
    rollback: vi.fn(),
    start: vi.fn(),
}));

vi.mock("#manager/app-commands", () => ({
    migrateDatabase: migrations.database,
    planAttachmentMigration: migrations.plan,
    applyAttachmentMigration: migrations.apply,
    rollbackAttachmentMigration: migrations.rollback,
    startApplication: migrations.start,
}));

const roots: string[] = [];

beforeEach(() => vi.clearAllMocks());
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true}))));

describe("Journaled application migration", () => {
    it("apply开始前已持久化固定runId，成功后推进applied", async () => {
        const {root, journal, manifest} = await fixture("migration-success");
        const sessions = attachmentSessions(3);
        migrations.plan.mockResolvedValue({runId: "migration-success-attachment", migratedSessions: 3, sessions});
        migrations.apply.mockImplementation(async () => {
            const saved = await savedJournal(root, "migration-success");
            expect(saved.attachmentMigration).toEqual({
                runId: "migration-success-attachment",
                state: "planned",
                migratedSessions: 3,
                sessions,
            });
            return {runId: "migration-success-attachment", migratedSessions: 3, sessions: sessions.map((session) => ({...session, backupPath: `${session.sourcePath}.backup`}))};
        });

        const result = await applyJournaledApplicationMigrations(root, manifest, journal);

        expect(migrations.database).toHaveBeenCalledWith(root, manifest, root);
        expect(migrations.apply).toHaveBeenCalledWith(root, manifest, "migration-success-attachment", root);
        expect(result.attachmentMigration?.state).toBe("applied");
        expect((await savedJournal(root, "migration-success")).attachmentMigration?.state).toBe("applied");
    });

    it("apply中断时journal保留planned供统一恢复", async () => {
        const {root, journal, manifest} = await fixture("migration-failure");
        migrations.plan.mockResolvedValue({runId: "migration-failure-attachment", migratedSessions: 1, sessions: attachmentSessions(1)});
        migrations.apply.mockRejectedValue(new Error("apply interrupted"));

        await expect(applyJournaledApplicationMigrations(root, manifest, journal)).rejects.toThrow("apply interrupted");

        expect((await savedJournal(root, "migration-failure")).attachmentMigration).toEqual({
            runId: "migration-failure-attachment",
            state: "planned",
            migratedSessions: 1,
            sessions: attachmentSessions(1),
        });
    });

    it("dry-run无变化时不增加journal组件", async () => {
        const {root, journal, manifest} = await fixture("migration-noop");
        migrations.plan.mockResolvedValue(null);

        const result = await applyJournaledApplicationMigrations(root, manifest, journal);

        expect(result.attachmentMigration).toBeUndefined();
        expect(migrations.apply).not.toHaveBeenCalled();
    });

    it("start在maintenance journal提交后才运行前台应用", async () => {
        const root = await mkdtemp(join(tmpdir(), "manager-start-migration-"));
        roots.push(root);
        const manifest = productManifest();
        migrations.plan.mockResolvedValue(null);

        await startInstallationApplication(root, manifest);

        expect(migrations.database).toHaveBeenCalledWith(root, manifest, root);
        expect(migrations.start).toHaveBeenCalledWith(root, manifest);
        expect(migrations.start.mock.invocationCallOrder[0]).toBeGreaterThan(migrations.plan.mock.invocationCallOrder[0]!);
        const operationFiles = await readdir(join(root, ".deploy", "operations"));
        expect(operationFiles).toHaveLength(1);
        const saved = JSON.parse(await readFile(join(root, ".deploy", "operations", operationFiles[0]!), "utf8")) as {phase: string; outcome: string};
        expect(saved).toMatchObject({phase: "committed", outcome: "success"});
    });
});

async function fixture(id: string) {
    const root = await mkdtemp(join(tmpdir(), "manager-migration-operation-"));
    roots.push(root);
    const manifest = productManifest();
    const journal = await createOperation({
        id,
        action: "update",
        root,
        createdPaths: [],
        backupRoot: join(root, ".deploy", "backups", id),
        previousManifest: manifest,
        nextManifest: manifest,
    });
    return {root, manifest, journal};
}

async function savedJournal(root: string, id: string) {
    return JSON.parse(await readFile(join(root, ".deploy", "operations", `${id}.json`), "utf8")) as {
        attachmentMigration?: {runId: string; state: string; migratedSessions: number};
    };
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

function attachmentSessions(count: number) {
    return Array.from({length: count}, (_, index) => ({
        sessionId: index + 1,
        sourcePath: `.nbook/agent/sessions/${index + 1}.jsonl`,
        sourceHash: "a".repeat(64),
        targetHash: "b".repeat(64),
    }));
}
