import {randomUUID} from "node:crypto";
import {join, resolve} from "node:path";
import {
    applyAttachmentMigration,
    migrateDatabase,
    planAttachmentMigration,
    startApplication,
} from "#manager/app-commands";
import {ensureStateFiles} from "#manager/config";
import {withInstallLock} from "#manager/lock";
import {commitOperation, createOperation, recoverInterruptedOperations, updateOperation} from "#manager/operation";
import {installationPaths} from "#manager/paths";
import type {InstallationManifest, OperationJournal} from "#manager/types";

/**
 * 在当前installation operation中执行数据库与Attachment数据迁移。
 *
 * Attachment runId必须先持久化再apply；这样apply任意阶段崩溃时，统一恢复入口
 * 都能先撤销session hard cut，再恢复旧Product、SQLite和Compose。
 */
export async function applyJournaledApplicationMigrations(
    root: string,
    manifest: InstallationManifest,
    journal: OperationJournal,
    applicationRoot = root,
): Promise<OperationJournal> {
    let next = applicationRoot === root
        ? journal
        : await updateOperation(journal, journal.phase, {migrationRoot: applicationRoot});
    await migrateDatabase(root, manifest, applicationRoot);
    const runId = `${journal.id}-attachment`;
    const plan = await planAttachmentMigration(root, manifest, runId, applicationRoot);
    if (!plan) return next;
    next = await updateOperation(next, next.phase, {
        attachmentMigration: {
            runId: plan.runId,
            state: "planned",
            migratedSessions: plan.migratedSessions,
            sessions: plan.sessions,
        },
    });
    const applied = await applyAttachmentMigration(root, manifest, plan.runId, applicationRoot);
    next = await updateOperation(next, next.phase, {
        attachmentMigration: {
            ...next.attachmentMigration!,
            state: "applied",
            migratedSessions: applied.migratedSessions,
            sessions: applied.sessions,
        },
    });
    return next;
}

/**
 * 恢复未完成操作并以maintenance journal执行启动前迁移，随后在锁外前台启动应用。
 * start不得直接改写Attachment session，否则崩溃时没有可恢复的runId与状态。
 */
export async function startInstallationApplication(
    root: string,
    manifest: InstallationManifest,
): Promise<void> {
    const paths = installationPaths(root, manifest.profile === "windows-portable");
    const stateRoot = resolve(paths.root, manifest.stateRoot);
    await ensureStateFiles(stateRoot, 3000, manifest.profile !== "windows-portable");
    await withInstallLock(join(paths.deploy, "install.lock"), async () => {
        await recoverInterruptedOperations(paths.root);
        const id = randomUUID();
        let journal = await createOperation({
            id,
            action: "update",
            root: paths.root,
            createdPaths: [],
            backupRoot: join(paths.backups, id),
            previousManifest: manifest,
            nextManifest: manifest,
        });
        try {
            journal = await applyJournaledApplicationMigrations(paths.root, manifest, journal);
            journal = await updateOperation(journal, "migrated");
            await commitOperation(journal);
        } catch (error) {
            await recoverInterruptedOperations(paths.root).catch(() => undefined);
            throw error;
        }
    });
    await startApplication(paths.root, manifest);
}
