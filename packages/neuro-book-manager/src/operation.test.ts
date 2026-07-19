import {mkdir, mkdtemp, readFile, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {removePath} from "#manager/files";
import {commitOperation, createOperation, pathCreateEffect, pathRetireEffect, recoverInterruptedOperations, updateOperation} from "#manager/operation";
import {currentProductPlatform} from "#manager/platform";
import {parseOperationJournal} from "#manager/schema";
import {sourceDockerImageName} from "#manager/source-docker-image";
import type {InstallationManifest} from "#manager/types";

const docker = vi.hoisted(() => ({
    removeDeployment: vi.fn(),
    removeImage: vi.fn(),
    start: vi.fn(),
}));
const attachmentMigration = vi.hoisted(() => ({rollback: vi.fn()}));
const git = vi.hoisted(() => ({revision: vi.fn(), removeMaterialized: vi.fn()}));

vi.mock("#manager/docker", () => ({
    removeDockerDeployment: docker.removeDeployment,
    removeDockerImage: docker.removeImage,
    startDocker: docker.start,
}));
vi.mock("#manager/app-commands", () => ({
    rollbackAttachmentMigration: attachmentMigration.rollback,
}));
vi.mock("#manager/git", () => ({
    repositoryRevision: git.revision,
    removeMaterializedRepository: git.removeMaterialized,
}));

const roots: string[] = [];
const JOURNAL_ROOT = join(tmpdir(), "neuro-book-operation-fixture");
const OUTSIDE_ROOT = join(tmpdir(), "neuro-book-operation-outside");

afterEach(async () => Promise.all(roots.splice(0).map((root) => removePath(root))));
beforeEach(() => {
    vi.clearAllMocks();
    git.revision.mockResolvedValue("a".repeat(40));
});

describe("Operation recovery", () => {
    it("拒绝越界受管路径", () => {
        const journal = operationJournal();
        expect(() => parseOperationJournal({...journal, effects: [{kind: "path-create", state: "planned", owner: "staging", path: "../outside"}]}, "memory.json")).toThrow("非根目录项");
        expect(() => parseOperationJournal({...journal, effects: [{kind: "path-retire", state: "planned", owner: "tool", path: "../outside"}]}, "memory.json")).toThrow("非根目录项");
        expect(() => parseOperationJournal({...journal, effects: [{kind: "path-create", state: "planned", owner: "staging", path: "."}]}, "memory.json")).toThrow("非根目录项");
        expect(() => parseOperationJournal({...journal, effects: [{kind: "path-retire", state: "planned", owner: "tool", path: "./"}]}, "memory.json")).toThrow("非根目录项");
        expect(() => parseOperationJournal({...journal, effects: [{kind: "path-create", state: "planned", owner: "runtime", path: ".runtime//bun"}]}, "memory.json")).toThrow("非根目录项");
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

    it("分别校验backup、SQLite、Compose、wrapper和Attachment路径合同", () => {
        const journal = {...operationJournal(), previousManifest: nativeManifest("1.0.0", "a".repeat(40))};
        const checkpoint = {busy: 0, log: 1, checkpointed: 1};
        expect(() => parseOperationJournal({...journal, backupRoot: OUTSIDE_ROOT}, "memory.json"))
            .toThrow("backupRoot越过允许根目录");
        expect(() => parseOperationJournal({...journal, effects: [{kind: "sqlite-backup", state: "planned", owner: "app-sqlite", configuredUrl: "file:./workspace/.nbook/neuro-book.sqlite", stateRoot: "workspace", hostPath: "workspace/.nbook/neuro-book.sqlite", backupPath: "C:/neuro-book/.deploy/backups/operation/database/app.sqlite", checkpoint}]}, "memory.json")).toThrow("绝对stateRoot/hostPath");
        const externalDatabase = join(OUTSIDE_ROOT, "neuro-book.sqlite");
        const externalDatabaseUrl = `file:${externalDatabase.replaceAll("\\", "/")}`;
        expect(() => parseOperationJournal({...journal, effects: [{kind: "sqlite-backup", state: "planned", owner: "app-sqlite", configuredUrl: externalDatabaseUrl, stateRoot: JOURNAL_ROOT, hostPath: externalDatabase, backupPath: join(OUTSIDE_ROOT, "app.sqlite"), checkpoint}]}, "memory.json")).toThrow("SQLite backup越过允许根目录");
        expect(() => parseOperationJournal({...journal, containerEngine: "docker", effects: [{kind: "compose", state: "planned", owner: "compose", previousState: "stopped", stopped: false, previousCompose: join(OUTSIDE_ROOT, "compose.yml"), created: false}]}, "memory.json")).toThrow("previousCompose越过允许根目录");
        expect(() => parseOperationJournal({...journal, effects: [{kind: "wrapper-switch", state: "planned", owner: "wrapper", previousState: "present", backupPath: join(OUTSIDE_ROOT, "runtime-bin")}]}, "memory.json")).toThrow("wrapper backup越过允许根目录");
        expect(() => parseOperationJournal({...journal, effects: [{kind: "wrapper-switch", state: "planned", owner: "wrapper", previousState: "present"}]}, "memory.json")).toThrow("必须预先记录backupPath");
        expect(() => parseOperationJournal({
            ...journal,
            nextManifest: nativeManifest("1.0.0", "a".repeat(40)),
            attachmentMigration: {
                runId: "operation-attachment",
                state: "planned",
                migratedSessions: 1,
                sessions: [{...attachmentSessions(1)[0]!, sourcePath: "../sessions/1.jsonl"}],
            },
        }, "memory.json")).toThrow("非根目录项");
        expect(() => parseOperationJournal({...journal, effects: [{kind: "sqlite-backup", state: "planned", owner: "app-sqlite", configuredUrl: externalDatabaseUrl, stateRoot: JOURNAL_ROOT, hostPath: externalDatabase, backupPath: join(JOURNAL_ROOT, ".deploy", "backups", "operation", "database", "app.sqlite"), checkpoint}]}, "memory.json")).not.toThrow();
    });

    it("拒绝退役nextManifest仍引用的受管资产目录", () => {
        const manifest = nativeManifestWithManagedRg("1.0.0", "a".repeat(40));
        expect(() => parseOperationJournal({
            ...operationJournal(),
            previousManifest: manifest,
            nextManifest: manifest,
            effects: [pathRetireEffect(".runtime/tools/rg/old")],
        }, "memory.json")).toThrow("仍包含nextManifest引用");
    });

    it("wrapper备份尚未原子提交时保留原目录，备份存在时恢复旧目录", async () => {
        const root = await operationRoot();
        const runtimeBin = join(root, ".runtime", "bin");
        const missingBackup = join(root, ".deploy", "backups", "wrapper-missing", "runtime-bin");
        await mkdir(runtimeBin, {recursive: true});
        await writeFile(join(runtimeBin, "neuro-book.cmd"), "old", "utf8");
        const interruptedBeforeBackup = await createOperation({
            id: "wrapper-missing",
            action: "update",
            root,
            containerEngine: null,
            backupRoot: join(root, ".deploy", "backups", "wrapper-missing"),
            previousManifest: null,
            nextManifest: null,
            effects: [{kind: "wrapper-switch", state: "planned", owner: "wrapper", previousState: "present", backupPath: missingBackup}],
        });
        await recoverInterruptedOperations(root);
        expect(await readFile(join(runtimeBin, "neuro-book.cmd"), "utf8")).toBe("old");

        const backupRoot = join(root, ".deploy", "backups", "wrapper-ready");
        const backupPath = join(backupRoot, "runtime-bin");
        await mkdir(backupPath, {recursive: true});
        await writeFile(join(backupPath, "neuro-book.cmd"), "old", "utf8");
        await writeFile(join(runtimeBin, "neuro-book.cmd"), "partial-new", "utf8");
        await createOperation({
            id: "wrapper-ready",
            action: "update",
            root,
            containerEngine: null,
            backupRoot,
            previousManifest: null,
            nextManifest: null,
            effects: [{kind: "wrapper-switch", state: "planned", owner: "wrapper", previousState: "present", backupPath}],
        });
        await recoverInterruptedOperations(root);
        expect(await readFile(join(runtimeBin, "neuro-book.cmd"), "utf8")).toBe("old");
        expect(interruptedBeforeBackup.effects).toContainEqual(expect.objectContaining({kind: "wrapper-switch"}));
    });

    it("成功提交后清理退役代次，已提交journal恢复时可幂等重试", async () => {
        const root = await operationRoot();
        const retired = join(root, ".runtime", "tools", "rg", "old");
        await mkdir(retired, {recursive: true});
        await writeFile(join(retired, "rg.exe"), "old", "utf8");
        const journal = await createOperation({
            id: "retired-cleanup",
            action: "update",
            root,
            containerEngine: null,
            effects: [pathRetireEffect(".runtime/tools/rg/old")],
            backupRoot: join(root, ".deploy", "backups", "retired-cleanup"),
            previousManifest: null,
            nextManifest: null,
        });

        await commitOperation(journal);
        await expect(stat(retired)).rejects.toMatchObject({code: "ENOENT"});

        await mkdir(retired, {recursive: true});
        const interrupted = await createOperation({
            id: "retired-cleanup-recovery",
            action: "update",
            root,
            containerEngine: null,
            effects: [pathRetireEffect(".runtime/tools/rg/old")],
            backupRoot: join(root, ".deploy", "backups", "retired-cleanup-recovery"),
            previousManifest: null,
            nextManifest: null,
        });
        await updateOperation(interrupted, "committed", {outcome: "success"});
        await recoverInterruptedOperations(root);
        await expect(stat(retired)).rejects.toMatchObject({code: "ENOENT"});
    });

    it("失败回滚保留退役代次，只清理本次backup和staging", async () => {
        const root = await operationRoot();
        const retired = join(root, ".runtime", "tools", "rg", "old");
        const staging = join(root, ".deploy", "staging", "rolled-back");
        const backup = join(root, ".deploy", "backups", "rolled-back");
        await mkdir(retired, {recursive: true});
        await mkdir(staging, {recursive: true});
        await mkdir(backup, {recursive: true});
        await writeFile(join(retired, "rg.exe"), "old", "utf8");
        const journal = await createOperation({
            id: "rolled-back-retired",
            action: "update",
            root,
            containerEngine: null,
            effects: [pathCreateEffect(".deploy/staging/rolled-back", "applied"), pathRetireEffect(".runtime/tools/rg/old")],
            backupRoot: backup,
            previousManifest: null,
            nextManifest: null,
        });

        await recoverInterruptedOperations(root);

        expect(await readFile(join(retired, "rg.exe"), "utf8")).toBe("old");
        await expect(stat(staging)).rejects.toMatchObject({code: "ENOENT"});
        await expect(stat(backup)).rejects.toMatchObject({code: "ENOENT"});
        const saved = JSON.parse(await readFile(join(root, ".deploy", "operations", "rolled-back-retired.json"), "utf8")) as {
            outcome: string;
            effects: Array<{kind: string; state: string; path?: string}>;
        };
        expect(saved.outcome).toBe("rolled-back");
        expect(saved.effects).toContainEqual(expect.objectContaining({kind: "path-retire", state: "planned", path: ".runtime/tools/rg/old"}));
    });

    it("拒绝嵌套 Manifest 损坏的 journal", () => {
        expect(() => parseOperationJournal({...operationJournal(), nextManifest: {}}, "memory.json")).toThrow("Operation journal 不符合 schema");
    });

    it("拒绝迁移脚本根越过Installation Root", () => {
        expect(() => parseOperationJournal({...operationJournal(), migrationRoot: OUTSIDE_ROOT}, "memory.json"))
            .toThrow("migrationRoot越过允许根目录");
    });

    it("已提交旧Journal作为审计记录跳过，未完成v1/v2拒绝自动恢复", async () => {
        const root = await operationRoot();
        const operations = join(root, ".deploy", "operations");
        await writeFile(join(operations, "committed-v1.json"), JSON.stringify({...operationJournal(), schemaVersion: 1, phase: "committed"}), "utf8");
        await writeFile(join(operations, "unfinished-v2.json"), JSON.stringify({...operationJournal(), schemaVersion: 2, phase: "staged"}), "utf8");

        await expect(recoverInterruptedOperations(root)).rejects.toThrow("未完成的Operation Journal v2");
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
            backupRoot: join(root, ".deploy", "backups", "git-target"),
            previousManifest: {...nextManifest, sourceRevision: "b".repeat(40), components: {
                ...nextManifest.components,
                source: {...nextManifest.components.source, revision: "b".repeat(40)},
                product: {...nextManifest.components.product!, revision: "b".repeat(40)},
            }},
            nextManifest,
            effects: [{kind: "git-fast-forward", state: "applied", owner: "source", previousRevision: "b".repeat(40), targetRevision: nextManifest.sourceRevision}],
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
        const created = join(root, ".runtime", "tools", "demo", "temporary");
        await mkdir(created, {recursive: true});
        await writeFile(join(created, "partial.txt"), "partial", "utf8");
        const journal = await createOperation({
            id: "interrupted",
            action: "install",
            root,
            containerEngine: null,
            effects: [pathCreateEffect(".runtime/tools/demo/temporary", "applied")],
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
            backupRoot: join(root, ".deploy", "backups", "validated-product"),
            previousManifest,
            nextManifest,
        });
        await updateOperation(journal, "validated");

        await recoverInterruptedOperations(root);

        expect(await readFile(join(root, ".output", "preserved.txt"), "utf8")).toBe("old-product");
    });

    it("Fresh Product在planned后完成rename但未记applied时删除新Product", async () => {
        const root = await operationRoot();
        await mkdir(join(root, ".output"), {recursive: true});
        await writeFile(join(root, ".output", "new.txt"), "new-product", "utf8");
        const journal = await createOperation({
            id: "fresh-product-switch-intent",
            action: "install",
            root,
            containerEngine: null,
            backupRoot: join(root, ".deploy", "backups", "fresh-product-switch-intent"),
            previousManifest: null,
            nextManifest: nativeManifest("1.0.0", "a".repeat(40)),
            effects: [{kind: "component-switch", state: "planned", owner: "product"}],
        });

        await recoverInterruptedOperations(root);

        await expect(stat(join(root, ".output"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("Fresh Git checkout只要开始物化就在失败恢复时按ownership清理", async () => {
        const root = await operationRoot();
        const journal = await createOperation({
            id: "fresh-checkout-intent",
            action: "install",
            root,
            containerEngine: null,
            backupRoot: join(root, ".deploy", "backups", "fresh-checkout-intent"),
            previousManifest: null,
            nextManifest: null,
            effects: [{kind: "git-checkout", state: "planned", owner: "source"}],
        });

        await recoverInterruptedOperations(root);

        expect(git.removeMaterialized).toHaveBeenCalledWith(root);
        const saved = JSON.parse(await readFile(join(root, ".deploy", "operations", "fresh-checkout-intent.json"), "utf8")) as {outcome: string};
        expect(saved.outcome).toBe("rolled-back");
    });

    it("Fresh Docker失败时移除容器、Compose和本地镜像", async () => {
        const root = await operationRoot();
        const compose = join(root, ".deploy", "docker-compose.generated.yml");
        const image = sourceDockerImageName("a".repeat(40), "fresh-docker");
        await writeFile(compose, "services: {}", "utf8");
        const journal = await createOperation({
            id: "fresh-docker",
            action: "install",
            root,
            containerEngine: "docker",
            backupRoot: join(root, ".deploy", "backups", "fresh-docker"),
            previousManifest: null,
            nextManifest: dockerManifest(root, image),
            effects: [
                {kind: "compose", state: "applied", owner: "compose", previousState: "missing", stopped: false, created: true},
                {kind: "docker-image", state: "applied", owner: "product", image},
            ],
        });
        await updateOperation(journal, "switched");

        await recoverInterruptedOperations(root);

        expect(docker.removeDeployment).toHaveBeenCalledOnce();
        expect(docker.removeImage).toHaveBeenCalledWith("docker", root, image);
        await expect(stat(compose)).rejects.toMatchObject({code: "ENOENT"});
    });

    it("Source Docker提交后只退役previousManifest证明的旧镜像且恢复不重复删除", async () => {
        const root = await operationRoot();
        const previousImage = "neuro-book-source:previous";
        const nextImage = sourceDockerImageName("a".repeat(40), "docker-image-retire");
        const journal = await createOperation({
            id: "docker-image-retire",
            action: "update",
            root,
            containerEngine: "docker",
            backupRoot: join(root, ".deploy", "backups", "docker-image-retire"),
            previousManifest: dockerManifest(root, previousImage),
            nextManifest: dockerManifest(root, nextImage),
            effects: [{kind: "docker-image", state: "applied", owner: "product", image: nextImage, previousImage}],
        });

        await commitOperation(journal);
        await recoverInterruptedOperations(root);

        expect(docker.removeImage).toHaveBeenCalledTimes(1);
        expect(docker.removeImage).toHaveBeenCalledWith("docker", root, previousImage);
        const saved = JSON.parse(await readFile(join(root, ".deploy", "operations", "docker-image-retire.json"), "utf8")) as {effects: Array<{kind: string; previousImageRetired?: boolean}>};
        expect(saved.effects).toContainEqual(expect.objectContaining({kind: "docker-image", previousImageRetired: true}));
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
            backupRoot: backup,
            previousManifest,
            nextManifest: {...previousManifest, appVersion: "1.0.1", updatedAt: "2026-07-13T00:00:00.000Z"},
            effects: [
                {kind: "compose", state: "applied", owner: "compose", previousState: "running", stopped: true, previousCompose, created: false},
                {kind: "sqlite-backup", state: "applied", owner: "app-sqlite", configuredUrl: "file:./workspace/.nbook/neuro-book.sqlite", stateRoot: root, hostPath: database, backupPath: databaseBackup, checkpoint: {busy: 0, log: 0, checkpointed: 0}},
            ],
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
            backupRoot: backup,
            previousManifest,
            nextManifest,
            effects: [{kind: "compose", state: "applied", owner: "compose", previousState: "running", stopped: true, previousCompose, created: false}],
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
            backupRoot: join(root, ".deploy", "backups", "attachment-rollback-failure"),
            previousManifest: manifest,
            nextManifest: manifest,
            effects: [{kind: "compose", state: "applied", owner: "compose", previousState: "running", stopped: true, created: false}],
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
        const image = sourceDockerImageName("a".repeat(40), "image-cleanup");
        docker.removeImage.mockRejectedValueOnce(new Error("image is in use"));
        const journal = await createOperation({
            id: "image-cleanup",
            action: "install",
            root,
            containerEngine: "docker",
            backupRoot: join(root, ".deploy", "backups", "image-cleanup"),
            previousManifest: null,
            nextManifest: dockerManifest(root, image),
            effects: [{kind: "docker-image", state: "applied", owner: "product", image}],
        });

        await recoverInterruptedOperations(root);

        const saved = JSON.parse(await readFile(join(root, ".deploy", "operations", "image-cleanup.json"), "utf8")) as {outcome: string; effects: Array<{kind: string; cleanupError?: string}>};
        expect(saved.outcome).toBe("rolled-back");
        expect(saved.effects).toContainEqual(expect.objectContaining({kind: "docker-image", cleanupError: "image is in use"}));
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
            backupRoot: backup,
            previousManifest,
            nextManifest: previousManifest,
            effects: [{kind: "compose", state: "applied", owner: "compose", previousState: "running", stopped: true, previousCompose, created: false}],
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

function dockerManifest(root: string, image = "neuro-book-source:test"): InstallationManifest {
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
            product: {provider: "container", version: "1.0.0", revision, image},
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
            product: {provider: "release", version, revision, path: ".output", platform: currentProductPlatform(), archiveSha256: "a".repeat(64), sourceUrl: "https://example.com/product.zip", license: "AGPL-3.0-only", redistribution: "test"},
            manager: {provider: "managed", version: "0.1.0", path: ".runtime/manager/0.1.0/neuro-book.mjs", bundleSha256: "a".repeat(64)},
            managerRuntime: {provider: "system", version: "1.3.0", executable: "bun"},
            applicationRuntime: {provider: "system", version: "1.3.0", executable: "bun"},
            tools: {},
        },
        installedAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
    };
}

function nativeManifestWithManagedRg(version: string, revision: string): InstallationManifest {
    const manifest = nativeManifest(version, revision);
    return {
        ...manifest,
        components: {
            ...manifest.components,
            tools: {
                rg: {
                    provider: "managed",
                    version: "old",
                    path: ".runtime/tools/rg/old/rg.exe",
                    archiveSha256: "a".repeat(64),
                    executableSha256: "b".repeat(64),
                    sourceUrl: "https://example.com/rg.zip",
                    license: "MIT",
                    redistribution: "test",
                },
            },
        },
    };
}

function operationJournal() {
    const now = "2026-07-12T00:00:00.000Z";
    return {
        schemaVersion: 3 as const,
        id: "operation",
        action: "update" as const,
        phase: "planned" as const,
        root: JOURNAL_ROOT,
        containerEngine: null,
        effects: [],
        backupRoot: join(JOURNAL_ROOT, ".deploy", "backups", "operation"),
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
