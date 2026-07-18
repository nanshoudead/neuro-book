import {mkdir, mkdtemp, readFile, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {removePath} from "#manager/files";
import {createOperation, recoverInterruptedOperations, updateOperation} from "#manager/operation";
import {parseOperationJournal} from "#manager/schema";
import type {InstallationManifest} from "#manager/types";

const docker = vi.hoisted(() => ({
    removeDeployment: vi.fn(),
    removeImage: vi.fn(),
    start: vi.fn(),
}));
const attachmentMigration = vi.hoisted(() => ({rollback: vi.fn()}));
const git = vi.hoisted(() => ({revision: vi.fn()}));

vi.mock("#manager/docker", () => ({
    removeDockerDeployment: docker.removeDeployment,
    removeDockerImage: docker.removeImage,
    startDocker: docker.start,
}));
vi.mock("#manager/app-commands", () => ({
    rollbackAttachmentMigration: attachmentMigration.rollback,
}));
vi.mock("#manager/git", () => ({repositoryRevision: git.revision}));

const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => removePath(root))));
beforeEach(() => {
    vi.clearAllMocks();
    git.revision.mockResolvedValue("a".repeat(40));
});

describe("Operation recovery", () => {
    it("拒绝越界受管路径", () => {
        const journal = operationJournal();
        expect(() => parseOperationJournal({...journal, createdPaths: ["../outside"]}, "memory.json")).toThrow("Installation Root");
        expect(() => parseOperationJournal({
            ...journal,
            attachmentMigration: {
                runId: "operation-attachment",
                state: "planned",
                migratedSessions: 1,
                sessions: attachmentSessions(1),
            },
        }, "memory.json")).toThrow("缺少nextManifest");
    });

    it("拒绝嵌套 Manifest 损坏的 journal", () => {
        expect(() => parseOperationJournal({...operationJournal(), nextManifest: {}}, "memory.json")).toThrow("Operation journal 不符合 schema");
    });

    it("拒绝迁移脚本根越过Installation Root", () => {
        expect(() => parseOperationJournal({...operationJournal(), migrationRoot: "C:/outside"}, "memory.json"))
            .toThrow("migrationRoot越过Installation Root");
    });

    it("已提交v1作为审计记录跳过，未完成v1拒绝自动恢复", async () => {
        const root = await operationRoot();
        const operations = join(root, ".deploy", "operations");
        await writeFile(join(operations, "committed-v1.json"), JSON.stringify({...operationJournal(), schemaVersion: 1, phase: "committed"}), "utf8");
        await writeFile(join(operations, "unfinished-v1.json"), JSON.stringify({...operationJournal(), schemaVersion: 1, phase: "staged"}), "utf8");

        await expect(recoverInterruptedOperations(root)).rejects.toThrow("未完成的Operation Journal v1");
    });

    it("Git HEAD已到target时完成Manifest提交，不错误回滚", async () => {
        const root = await operationRoot();
        const nextManifest = dockerManifest(root);
        git.revision.mockResolvedValue(nextManifest.sourceRevision);
        const journal = await createOperation({
            id: "git-target",
            action: "update",
            root,
            containerEngine: "docker",
            createdPaths: [],
            backupRoot: join(root, ".deploy", "backups", "git-target"),
            previousManifest: {...nextManifest, sourceRevision: "b".repeat(40), components: {
                ...nextManifest.components,
                source: {...nextManifest.components.source, revision: "b".repeat(40)},
                product: {...nextManifest.components.product!, revision: "b".repeat(40)},
            }},
            nextManifest,
            git: {previousRevision: "b".repeat(40), targetRevision: nextManifest.sourceRevision},
        });
        await updateOperation(journal, "healthy");

        await recoverInterruptedOperations(root);

        const saved = JSON.parse(await readFile(join(root, ".deploy", "operations", "git-target.json"), "utf8")) as {phase: string; outcome: string};
        expect(saved).toMatchObject({phase: "committed", outcome: "success"});
        expect(docker.removeDeployment).not.toHaveBeenCalled();
    });

    it("commit point 前删除本次创建路径并保留 journal", async () => {
        const root = await mkdtemp(join(tmpdir(), "manager-operation-"));
        roots.push(root);
        const created = join(root, ".runtime", "temporary");
        await mkdir(created, {recursive: true});
        await writeFile(join(created, "partial.txt"), "partial", "utf8");
        const journal = await createOperation({
            id: "interrupted",
            action: "install",
            root,
            containerEngine: null,
            createdPaths: [".runtime/temporary"],
            backupRoot: join(root, ".deploy", "backups", "interrupted"),
            previousManifest: null,
            nextManifest: null,
        });
        await updateOperation(journal, "staged");

        await recoverInterruptedOperations(root);

        await expect(stat(created)).rejects.toMatchObject({code: "ENOENT"});
        expect(await stat(join(root, ".deploy", "operations", "interrupted.json"))).toBeTruthy();
    });

    it("validated阶段失败不会把尚未切换的旧Product当成新Product删除", async () => {
        const root = await operationRoot();
        await mkdir(join(root, ".output"), {recursive: true});
        await writeFile(join(root, ".output", "preserved.txt"), "old-product", "utf8");
        const previousManifest = nativeManifest("1.0.0", "a".repeat(40));
        const nextManifest = nativeManifest("1.0.1", "b".repeat(40));
        const journal = await createOperation({
            id: "validated-product",
            action: "update",
            root,
            containerEngine: null,
            createdPaths: [],
            backupRoot: join(root, ".deploy", "backups", "validated-product"),
            previousManifest,
            nextManifest,
        });
        await updateOperation(journal, "validated");

        await recoverInterruptedOperations(root);

        expect(await readFile(join(root, ".output", "preserved.txt"), "utf8")).toBe("old-product");
    });

    it("Fresh Docker失败时移除容器、Compose和本地镜像", async () => {
        const root = await operationRoot();
        const compose = join(root, ".deploy", "docker-compose.generated.yml");
        await writeFile(compose, "services: {}", "utf8");
        const journal = await createOperation({
            id: "fresh-docker",
            action: "install",
            root,
            containerEngine: "docker",
            createdPaths: [],
            backupRoot: join(root, ".deploy", "backups", "fresh-docker"),
            previousManifest: null,
            nextManifest: dockerManifest(root),
            docker: {previousState: "missing", stopped: false, composeChanged: true, composeCreated: true, imageCreated: "neuro-book-source:test"},
        });
        await updateOperation(journal, "switched");

        await recoverInterruptedOperations(root);

        expect(docker.removeDeployment).toHaveBeenCalledOnce();
        expect(docker.removeImage).toHaveBeenCalledWith("docker", root, "neuro-book-source:test");
        await expect(stat(compose)).rejects.toMatchObject({code: "ENOENT"});
    });

    it("Docker更新失败时恢复数据库、Compose并重启旧实例", async () => {
        const root = await operationRoot();
        const backup = join(root, ".deploy", "backups", "docker-update");
        const compose = join(root, ".deploy", "docker-compose.generated.yml");
        const previousCompose = join(backup, "docker-compose.generated.yml");
        const database = join(root, "workspace", ".nbook", "neuro-book.sqlite");
        const databaseBackup = join(backup, "neuro-book.sqlite");
        await mkdir(join(root, "workspace", ".nbook"), {recursive: true});
        await mkdir(backup, {recursive: true});
        await writeFile(compose, "image: new", "utf8");
        await writeFile(previousCompose, "image: old", "utf8");
        await writeFile(database, "new", "utf8");
        await writeFile(`${database}-wal`, "wal", "utf8");
        await writeFile(databaseBackup, "old", "utf8");
        const previousManifest = dockerManifest(root);
        const journal = await createOperation({
            id: "docker-update",
            action: "update",
            root,
            containerEngine: "docker",
            createdPaths: [],
            backupRoot: backup,
            previousManifest,
            nextManifest: {...previousManifest, appVersion: "1.0.1", updatedAt: "2026-07-13T00:00:00.000Z"},
            docker: {previousState: "running", stopped: true, previousCompose, composeChanged: true, composeCreated: false},
            database: {configuredUrl: "file:./workspace/.nbook/neuro-book.sqlite", path: database, backup: databaseBackup, checkpoint: {busy: 0, log: 0, checkpointed: 0}},
        });
        await updateOperation(journal, "migrated");

        await recoverInterruptedOperations(root);

        expect(docker.removeDeployment).toHaveBeenCalledOnce();
        expect(await readFile(database, "utf8")).toBe("old");
        await expect(stat(`${database}-wal`)).rejects.toMatchObject({code: "ENOENT"});
        expect(await readFile(compose, "utf8")).toBe("image: old");
        expect(docker.start).toHaveBeenCalledWith("docker", root, root, "source-docker", "1.0.0");
    });

    it("先停止新Docker部署释放runtime lease，再回滚Attachment并恢复旧Compose", async () => {
        const root = await operationRoot();
        const backup = join(root, ".deploy", "backups", "attachment-rollback");
        const compose = join(root, ".deploy", "docker-compose.generated.yml");
        const previousCompose = join(backup, "docker-compose.generated.yml");
        await mkdir(backup, {recursive: true});
        await writeFile(compose, "image: new", "utf8");
        await writeFile(previousCompose, "image: old", "utf8");
        const previousManifest = dockerManifest(root);
        const nextManifest = {...previousManifest, appVersion: "1.0.1", updatedAt: "2026-07-16T00:00:00.000Z"};
        const journal = await createOperation({
            id: "attachment-rollback",
            action: "update",
            root,
            containerEngine: "docker",
            createdPaths: [],
            backupRoot: backup,
            previousManifest,
            nextManifest,
            docker: {previousState: "running", stopped: true, previousCompose, composeChanged: true, composeCreated: false},
            attachmentMigration: {
                runId: "attachment-rollback-run",
                state: "applied",
                migratedSessions: 2,
                sessions: attachmentSessions(2),
            },
        });
        await updateOperation(journal, "migrated");

        await recoverInterruptedOperations(root);

        expect(attachmentMigration.rollback).toHaveBeenCalledWith(root, nextManifest, "attachment-rollback-run", false, root);
        expect(docker.removeDeployment.mock.invocationCallOrder[0]).toBeLessThan(attachmentMigration.rollback.mock.invocationCallOrder[0]!);
        const saved = JSON.parse(await readFile(join(root, ".deploy", "operations", "attachment-rollback.json"), "utf8")) as {
            attachmentMigration: {state: string};
            outcome: string;
        };
        expect(saved.attachmentMigration.state).toBe("rolled_back");
        expect(saved.outcome).toBe("rolled-back");
    });

    it("Attachment rollback失败时保持新部署停止并保留journal重试", async () => {
        const root = await operationRoot();
        const manifest = dockerManifest(root);
        await writeFile(join(root, ".deploy", "docker-compose.generated.yml"), "image: new", "utf8");
        attachmentMigration.rollback.mockRejectedValueOnce(new Error("rollback interrupted"));
        const journal = await createOperation({
            id: "attachment-rollback-failure",
            action: "update",
            root,
            containerEngine: "docker",
            createdPaths: [],
            backupRoot: join(root, ".deploy", "backups", "attachment-rollback-failure"),
            previousManifest: manifest,
            nextManifest: manifest,
            docker: {previousState: "running", stopped: true, composeChanged: true, composeCreated: false},
            attachmentMigration: {
                runId: "attachment-rollback-failure-run",
                state: "planned",
                migratedSessions: 1,
                sessions: attachmentSessions(1),
            },
        });
        await updateOperation(journal, "switched");

        await expect(recoverInterruptedOperations(root)).rejects.toThrow("rollback interrupted");

        expect(docker.removeDeployment).toHaveBeenCalledOnce();
        expect(attachmentMigration.rollback).toHaveBeenCalledWith(root, manifest, "attachment-rollback-failure-run", true, root);
        const saved = JSON.parse(await readFile(join(root, ".deploy", "operations", "attachment-rollback-failure.json"), "utf8")) as {
            attachmentMigration: {state: string};
            outcome?: string;
        };
        expect(saved.attachmentMigration.state).toBe("planned");
        expect(saved.outcome).toBeUndefined();
    });

    it("镜像清理失败时仍完成其他回滚并记录人工清理信息", async () => {
        const root = await operationRoot();
        docker.removeImage.mockRejectedValueOnce(new Error("image is in use"));
        const journal = await createOperation({
            id: "image-cleanup",
            action: "install",
            root,
            containerEngine: "docker",
            createdPaths: [],
            backupRoot: join(root, ".deploy", "backups", "image-cleanup"),
            previousManifest: null,
            nextManifest: dockerManifest(root),
            docker: {previousState: "missing", stopped: false, composeChanged: false, composeCreated: false, imageCreated: "neuro-book-source:test"},
        });

        await recoverInterruptedOperations(root);

        const saved = JSON.parse(await readFile(join(root, ".deploy", "operations", "image-cleanup.json"), "utf8")) as {outcome: string; docker: {cleanupError: string}};
        expect(saved).toMatchObject({outcome: "rolled-back", docker: {cleanupError: "image is in use"}});
    });

    it("旧Docker实例重启失败时保留未完成journal供下次继续恢复", async () => {
        const root = await operationRoot();
        const compose = join(root, ".deploy", "docker-compose.generated.yml");
        const backup = join(root, ".deploy", "backups", "restart-failure");
        const previousCompose = join(backup, "docker-compose.generated.yml");
        await mkdir(backup, {recursive: true});
        await writeFile(compose, "image: new", "utf8");
        await writeFile(previousCompose, "image: old", "utf8");
        docker.start.mockRejectedValueOnce(new Error("docker daemon unavailable"));
        const previousManifest = dockerManifest(root);
        const journal = await createOperation({
            id: "restart-failure",
            action: "update",
            root,
            containerEngine: "docker",
            createdPaths: [],
            backupRoot: backup,
            previousManifest,
            nextManifest: previousManifest,
            docker: {previousState: "running", stopped: true, previousCompose, composeChanged: true, composeCreated: false},
        });
        await updateOperation(journal, "switched");

        await expect(recoverInterruptedOperations(root)).rejects.toThrow("docker daemon unavailable");

        const saved = JSON.parse(await readFile(join(root, ".deploy", "operations", "restart-failure.json"), "utf8")) as {phase: string; outcome?: string};
        expect(saved.phase).toBe("switched");
        expect(saved.outcome).toBeUndefined();
    });
});

async function operationRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "manager-operation-"));
    roots.push(root);
    await mkdir(join(root, ".deploy", "operations"), {recursive: true});
    return root;
}

function dockerManifest(root: string): InstallationManifest {
    const revision = "a".repeat(40);
    return {
        schemaVersion: 4,
        profile: "source-docker",
        containerEngine: "docker",
        managerVersion: "0.1.0",
        appVersion: "1.0.0",
        channel: "canary",
        sourceRevision: revision,
        stateRoot: ".",
        components: {
            source: {provider: "git", version: "1.0.0", revision, path: ".", repository: "https://github.com/notnotype/neuro-book.git", branch: "master"},
            product: {provider: "container", version: "1.0.0", revision, image: "neuro-book-source:test"},
            manager: {provider: "managed", version: "0.1.0", path: ".runtime/manager/0.1.0/neuro-book.mjs", bundleSha256: "a".repeat(64)},
            managerRuntime: {provider: "system", version: "1.3.0", executable: "bun"},
            applicationRuntime: {provider: "container", version: "1.0.0"},
            tools: {rg: {provider: "container", version: "source-docker"}, git: {provider: "container", version: "source-docker"}, python: {provider: "container", version: "source-docker"}},
        },
        installedAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
    };
}

function nativeManifest(version: string, revision: string): InstallationManifest {
    return {
        schemaVersion: 4,
        profile: "product-bun",
        containerEngine: null,
        managerVersion: "0.1.0",
        appVersion: version,
        channel: "canary",
        sourceRevision: revision,
        stateRoot: ".",
        components: {
            source: {provider: "release", version, revision, path: ".", files: ["package.json"], archiveSha256: "a".repeat(64), sourceUrl: "https://example.com/source.zip", license: "AGPL-3.0-only", redistribution: "test"},
            product: {provider: "release", version, revision, path: ".output", platform: "windows-x64", archiveSha256: "a".repeat(64), sourceUrl: "https://example.com/product.zip", license: "AGPL-3.0-only", redistribution: "test"},
            manager: {provider: "managed", version: "0.1.0", path: ".runtime/manager/0.1.0/neuro-book.mjs", bundleSha256: "a".repeat(64)},
            managerRuntime: {provider: "system", version: "1.3.0", executable: "bun"},
            applicationRuntime: {provider: "system", version: "1.3.0", executable: "bun"},
            tools: {},
        },
        installedAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
    };
}

function operationJournal() {
    const now = "2026-07-12T00:00:00.000Z";
    return {
        schemaVersion: 2 as const,
        id: "operation",
        action: "update" as const,
        phase: "planned" as const,
        root: "C:/neuro-book",
        containerEngine: null,
        createdPaths: [],
        backupRoot: "C:/neuro-book/.deploy/backups/operation",
        previousManifest: null,
        nextManifest: null,
        createdAt: now,
        updatedAt: now,
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
