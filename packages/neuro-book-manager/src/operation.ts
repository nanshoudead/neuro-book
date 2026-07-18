import {copyFile, cp, readdir, rm} from "node:fs/promises";
import {join, resolve} from "node:path";

import {rollbackProduct, rollbackReleaseSource} from "#manager/component";
import {rollbackAttachmentMigration} from "#manager/app-commands";
import {removeDockerDeployment, removeDockerImage, startDocker} from "#manager/docker";
import {ensureDirectory, pathExists, readJson, removePath, safeTarget, writeJsonAtomic} from "#manager/files";
import {writeInstallationManifest} from "#manager/manifest-store";
import {installationPaths} from "#manager/paths";
import {installSourceDependencies} from "#manager/product";
import {runtimeExecutable, writeManagerWrapper, writeRuntimeWrapper} from "#manager/runtime";
import {repositoryRevision} from "#manager/git";
import {parseOperationJournal} from "#manager/schema";
import {writeManagedToolWrappers} from "#manager/tools";
import type {InstallationManifest, OperationJournal, OperationPhase} from "#manager/types";

/** 创建持久化 operation journal。 */
export async function createOperation(input: Omit<OperationJournal, "schemaVersion" | "phase" | "createdAt" | "updatedAt">): Promise<OperationJournal> {
    const now = new Date().toISOString();
    const journal: OperationJournal = {...input, schemaVersion: 2, phase: "planned", createdAt: now, updatedAt: now};
    await writeOperation(journal);
    return journal;
}

/** 原子更新 operation phase 与恢复信息。 */
export async function updateOperation(journal: OperationJournal, phase: OperationPhase, patch: Partial<OperationJournal> = {}): Promise<OperationJournal> {
    const next = {...journal, ...patch, phase, updatedAt: new Date().toISOString()};
    await writeOperation(next);
    return next;
}

/** 标记操作成功提交。 */
export async function commitOperation(journal: OperationJournal): Promise<OperationJournal> {
    return updateOperation(journal, "committed", {outcome: "success"});
}

/** 在 mutating command 开始前恢复上次未完成操作。 */
export async function recoverInterruptedOperations(root: string): Promise<void> {
    const paths = installationPaths(root);
    if (!await pathExists(paths.operations)) return;
    for (const entry of await readdir(paths.operations, {withFileTypes: true})) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const path = join(paths.operations, entry.name);
        const value = await readJson(path);
        if (!value || typeof value !== "object") throw new Error(`Operation journal 损坏：${path}`);
        if ("schemaVersion" in value && value.schemaVersion === 1) {
            if ("phase" in value && value.phase === "committed") continue;
            throw new Error(`发现未完成的Operation Journal v1，拒绝自动恢复：${path}\n请备份实例并人工核对Manifest、Product、数据库、Git和Compose状态。`);
        }
        const journal = parseOperationJournal(value, path);
        if (journal.root !== resolve(root)) throw new Error(`Operation journal 的 Installation Root 不匹配：${path}`);
        if (journal.phase === "committed") continue;
        if (journal.git) {
            const head = await repositoryRevision(root);
            if (head !== journal.git.previousRevision && head !== journal.git.targetRevision) {
                throw new Error(`Git HEAD既不是Operation的previous也不是target，拒绝自动恢复：${head}\nOperation：${path}`);
            }
            if (head === journal.git.targetRevision && journal.nextManifest && journal.phase === "healthy") {
                if (journal.nextManifest.profile === "source-dev" && !journal.git.dependenciesInstalled) {
                    const runtime = journal.nextManifest.components.applicationRuntime;
                    if (runtime.provider === "container") throw new Error("Source Dev 不能使用 container Application Runtime。" );
                    await installSourceDependencies(root, runtimeExecutable(root, runtime));
                    journal.git.dependenciesInstalled = true;
                    await updateOperation(journal, journal.phase, {git: journal.git});
                }
                if (journal.nextManifest.components.managerRuntime.provider === "managed") {
                    await writeRuntimeWrapper(root, journal.nextManifest.components.managerRuntime);
                }
                await writeManagedToolWrappers(root, journal.nextManifest.components.tools);
                await writeManagerWrapper(root, journal.nextManifest.components.manager, journal.nextManifest.components.managerRuntime);
                await writeInstallationManifest(paths.manifest, journal.nextManifest);
                await commitOperation(journal);
                continue;
            }
            if (head === journal.git.targetRevision) {
                throw new Error(`Git HEAD已到target，但Operation尚未到达healthy commit point，拒绝自动提交Manifest：${path}`);
            }
        }
        await rollbackOperation(journal);
    }
}

/** 按 journal 恢复当前操作；不会 reset Git。 */
export async function rollbackOperation(journal: OperationJournal): Promise<void> {
    const root = journal.root;
    const currentCompose = join(root, ".deploy", "docker-compose.generated.yml");
    const stateRoot = resolve(root, journal.previousManifest?.stateRoot ?? journal.nextManifest?.stateRoot ?? ".");
    // 新容器可能持有Attachment runtime lease；必须先停容器，rollback one-shot才能取得独占锁。
    if (journal.docker?.composeChanged && await pathExists(currentCompose)) {
        await removeDockerDeployment(requiredContainerEngine(journal), root, stateRoot);
    }
    if (journal.attachmentMigration && journal.attachmentMigration.state !== "rolled_back") {
        if (!journal.nextManifest) throw new Error("Attachment migration回滚缺少nextManifest。");
        await rollbackAttachmentMigration(
            root,
            journal.nextManifest,
            journal.attachmentMigration.runId,
            journal.attachmentMigration.state === "planned",
            journal.migrationRoot ?? root,
        );
        journal = await updateOperation(journal, journal.phase, {
            attachmentMigration: {...journal.attachmentMigration, state: "rolled_back"},
        });
    }
    const previousProduct = journal.previousManifest?.components.product;
    const nextProduct = journal.nextManifest?.components.product;
    const switched = ["switched", "migrated", "healthy"].includes(journal.phase);
    if (switched && nextProduct && nextProduct.provider !== "container" && JSON.stringify(nextProduct) !== JSON.stringify(previousProduct)) {
        await rollbackProduct(root, join(journal.backupRoot, "product"));
    }
    const previousSource = journal.previousManifest?.components.source;
    const nextSource = journal.nextManifest?.components.source;
    if (switched && nextSource?.provider === "release" && previousSource?.provider !== "git") {
        await rollbackReleaseSource(
            root,
            join(journal.backupRoot, "source"),
            previousSource?.provider === "release" ? previousSource.files : [],
            nextSource.files,
        );
    }
    if (journal.database && await pathExists(journal.database.backup)) {
        await ensureDirectory(resolve(journal.database.path, ".."));
        await rm(`${journal.database.path}-wal`, {force: true});
        await rm(`${journal.database.path}-shm`, {force: true});
        await copyFile(journal.database.backup, journal.database.path);
    }
    if (journal.docker?.previousCompose && await pathExists(journal.docker.previousCompose)) {
        await copyFile(journal.docker.previousCompose, currentCompose);
    } else if (journal.docker?.composeCreated) {
        await removePath(currentCompose);
    }
    if (journal.previousManifest && isDockerProfile(journal.previousManifest.profile) && journal.docker?.previousState === "running") {
        await startDocker(requiredContainerEngine(journal), root, resolve(root, journal.previousManifest.stateRoot), journal.previousManifest.profile, journal.previousManifest.appVersion);
    }
    if (journal.manager?.wrappersChanged) {
        const runtimeBin = join(root, ".runtime", "bin");
        await removePath(runtimeBin);
        if (journal.manager.wrapperBackup && await pathExists(journal.manager.wrapperBackup)) {
            await ensureDirectory(resolve(runtimeBin, ".."));
            await cp(journal.manager.wrapperBackup, runtimeBin, {recursive: true});
        }
    }
    for (const path of [...journal.createdPaths].reverse()) await removePath(safeTarget(root, path));
    let dockerImageCleanupError: string | undefined;
    if (journal.docker?.imageCreated) {
        try {
            await removeDockerImage(requiredContainerEngine(journal), root, journal.docker.imageCreated);
        } catch (error) {
            dockerImageCleanupError = error instanceof Error ? error.message : String(error);
        }
    }
    if (journal.previousManifest) await writeInstallationManifest(join(root, ".deploy", "installation.json"), journal.previousManifest);
    await updateOperation(journal, "committed", {
        outcome: "rolled-back",
        ...(journal.docker ? {docker: {...journal.docker, cleanupError: dockerImageCleanupError}} : {}),
    });
}

/** 在切换稳定 wrapper 前备份现有 `.runtime/bin`。 */
export async function backupRuntimeWrappers(root: string, backupRoot: string): Promise<string | undefined> {
    const runtimeBin = join(root, ".runtime", "bin");
    if (!await pathExists(runtimeBin)) return undefined;
    const backup = join(backupRoot, "runtime-bin");
    await removePath(backup);
    await ensureDirectory(resolve(backup, ".."));
    await cp(runtimeBin, backup, {recursive: true});
    return backup;
}

async function writeOperation(journal: OperationJournal): Promise<void> {
    const path = join(journal.root, ".deploy", "operations", `${journal.id}.json`);
    await writeJsonAtomic(path, journal);
}

/** Docker Profile回滚后必须恢复旧Compose对应的实例。 */
function isDockerProfile(profile: InstallationManifest["profile"]): profile is "ghcr" | "source-docker" {
    return profile === "ghcr" || profile === "source-docker";
}

/** 返回事务固定的Container Engine。 */
function requiredContainerEngine(journal: OperationJournal): NonNullable<OperationJournal["containerEngine"]> {
    if (!journal.containerEngine) throw new Error(`Operation ${journal.id}缺少Container Engine。`);
    return journal.containerEngine;
}
