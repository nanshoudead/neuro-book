import {constants} from "node:fs";
import {
    access,
    copyFile,
    mkdir,
    open,
    readFile,
    readdir,
    rename,
    rm,
} from "node:fs/promises";
import {dirname, relative, resolve, sep} from "node:path";
import {createHash, randomUUID} from "node:crypto";
import {AttachmentStore} from "nbook/server/agent/attachments/attachment-store";
import {LocalAttachmentBlobAdapter} from "nbook/server/agent/attachments/local-attachment-blob-adapter";
import {AttachmentError} from "nbook/server/agent/attachments/types";
import {imageMimeType} from "nbook/server/agent/attachments/agent-attachment-codec";
import {ATTACHMENT_MIGRATION_LOCK_RELATIVE_PATH, AttachmentMigrationGate} from "nbook/server/agent/session/attachment-migration-gate";
import {decodeLegacySession} from "nbook/scripts/db/agent-attachment-v1/legacy-decoder";
import {
    checkpointManifest,
    loadManifest,
    transitionRun,
    transitionSession,
    writeInitialManifest,
} from "nbook/scripts/db/agent-attachment-v1/journal";
import type {
    AttachmentMigrationManifest,
    AttachmentMigrationReport,
    AttachmentMigrationRunStatus,
    AttachmentSessionPlan,
    AttachmentSessionMigrationState,
    AttachmentSessionMigrationStatus,
    RunAttachmentMigrationOptions,
    RunAttachmentRollbackOptions,
    AttachmentMigrationRollbackReport,
} from "nbook/scripts/db/agent-attachment-v1/types";
import {syncParentDirectories} from "nbook/scripts/db/agent-attachment-v1/durable-file";

const RUN_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

type MigrationLock = {
    version: 1;
    runId: string;
    pid: number;
    startedAt: string;
    manifestPath: string;
};

/**
 * 执行 Attachment v1 Workspace Root 迁移。
 *
 * dry-run 完整解析并转换所有 session，但不创建任何迁移或 blob 文件；apply
 * 在同一 preflight 通过后才取得独占 sentinel。恢复逻辑由同一入口的 resume 处理。
 */
export async function runAgentAttachmentMigration(options: RunAttachmentMigrationOptions): Promise<AttachmentMigrationReport> {
    const rootWorkspace = resolve(options.rootWorkspace);
    if (options.mode === "dry-run") {
        if (options.resume) {
            throw new Error("dry-run 不能使用 resume");
        }
        const runId = validatedRunId(options.runId ?? randomUUID());
        await assertLockAbsent(rootWorkspace);
        const plans = await planWorkspace(rootWorkspace);
        await verifyPreflightStorage(rootWorkspace, plans);
        return reportFromPlans(runId, "dry-run", "planned", plans);
    }
    const releaseRuntimeLease = await new AttachmentMigrationGate(rootWorkspace).acquireRuntimeLease();
    try {
        return options.resume
            ? await resumeApply(rootWorkspace, options)
            : await startApply(rootWorkspace, validatedRunId(options.runId ?? randomUUID()), options);
    } finally {
        await releaseRuntimeLease();
    }
}

/**
 * 回滚一次Attachment hard cut。
 *
 * Manager会在恢复旧Product前调用该入口。它先把中断的apply恢复到确定终态，再依据
 * migration manifest中的source/target hash幂等恢复每个已改变session。
 */
export async function rollbackAgentAttachmentMigration(
    options: RunAttachmentRollbackOptions,
): Promise<AttachmentMigrationRollbackReport> {
    const rootWorkspace = resolve(options.rootWorkspace);
    const runId = validatedRunId(options.runId);
    const paths = migrationPaths(rootWorkspace, runId);
    if (!await pathExists(paths.runRoot)) {
        await clearUnstartedRunLock(rootWorkspace, paths, runId);
        return {version: 1, runId, status: "not_started", restoredSessions: 0};
    }

    let manifest = await loadManifest(paths);
    if (!manifest) {
        await clearUnstartedRunLock(rootWorkspace, paths, runId);
        await rm(paths.runRoot, {recursive: true, force: true});
        return {version: 1, runId, status: "not_started", restoredSessions: 0};
    }
    const rollbackInProgress = manifest.status === "rollback_running"
        || manifest.status === "rolled_back"
        || manifest.status === "failed" && manifest.resumeStatus === "rollback_running";
    if (!rollbackInProgress && manifest.status !== "report_written") {
        await runAgentAttachmentMigration({
            rootWorkspace,
            mode: "apply",
            runId,
            resume: true,
        });
        manifest = await requiredManifest(paths);
    }

    const releaseRuntimeLease = await new AttachmentMigrationGate(rootWorkspace).acquireRuntimeLease();
    try {
        await ensureRollbackLock(rootWorkspace, paths, runId);
        manifest = await requiredManifest(paths);
        if (manifest.status === "rolled_back") {
            await rm(paths.lockPath, {force: true});
            return rollbackReport(manifest);
        }
        if (manifest.status === "failed") {
            if (manifest.resumeStatus !== "rollback_running") {
                throw new Error(`Attachment migration run ${runId}失败阶段不是rollback_running`);
            }
            await transitionRun(paths, manifest, "rollback_running");
        } else if (manifest.status === "report_written") {
            await transitionRun(paths, manifest, "rollback_running");
        }
        if (manifest.status !== "rollback_running") {
            throw new Error(`Attachment migration run ${runId}状态无法回滚：${manifest.status}`);
        }
        try {
            for (const session of manifest.sessions) {
                if (!session.changed) continue;
                await rollbackSession(rootWorkspace, paths, manifest, session, options.observer);
            }
            for (const session of manifest.sessions) {
                if (!session.changed) continue;
                await assertFileHash(
                    workspacePath(rootWorkspace, session.sourcePath),
                    session.sourceHash,
                    `${session.sourcePath}: rollback后的source hash无效`,
                );
            }
            await transitionRun(paths, manifest, "rolled_back");
            await checkpointManifest(paths, manifest);
            await rm(paths.lockPath, {force: true});
            return rollbackReport(manifest);
        } catch (error) {
            await recordFailure(paths, manifest, error).catch(() => undefined);
            throw error;
        }
    } finally {
        await releaseRuntimeLease();
    }
}

/** 新 apply 先做零写入 preflight，再独占 lock，并在 lock 内重扫消除竞态。 */
async function startApply(
    rootWorkspace: string,
    runId: string,
    options: RunAttachmentMigrationOptions,
): Promise<AttachmentMigrationReport> {
    const preflight = await planWorkspace(rootWorkspace);
    await verifyPreflightStorage(rootWorkspace, preflight);
    const paths = migrationPaths(rootWorkspace, runId);
    if (await pathExists(paths.runRoot)) {
        throw new Error(`migration run ${runId} 已存在；未完成任务请使用 --resume`);
    }
    await acquireLock(paths.lockPath, {
        version: 1,
        runId,
        pid: process.pid,
        startedAt: new Date().toISOString(),
        manifestPath: portableRelative(rootWorkspace, paths.manifestPath),
    });

    let manifest: AttachmentMigrationManifest | undefined;
    try {
        const lockedPlans = await planWorkspace(rootWorkspace);
        await verifyPreflightStorage(rootWorkspace, lockedPlans);
        manifest = createManifest(runId, lockedPlans, paths.runRootRelative);
        await writeInitialManifest(paths, manifest);
        return await executeManifest(rootWorkspace, paths, manifest, options);
    } catch (error) {
        if (manifest) {
            await recordFailure(paths, manifest, error).catch(() => undefined);
        }
        throw error;
    }
}

/** 显式 resume 只接受当前 sentinel 指向的 run，不覆盖未知迁移。 */
async function resumeApply(
    rootWorkspace: string,
    options: RunAttachmentMigrationOptions,
): Promise<AttachmentMigrationReport> {
    const lockPath = resolve(rootWorkspace, ATTACHMENT_MIGRATION_LOCK_RELATIVE_PATH);
    const lock = await readLock(lockPath);
    if (options.runId && options.runId !== lock.runId) {
        throw new Error(`当前 migration lock 属于 run ${lock.runId}，不能恢复 ${options.runId}`);
    }
    const runId = validatedRunId(lock.runId);
    const paths = migrationPaths(rootWorkspace, runId);
    if (lock.manifestPath !== portableRelative(rootWorkspace, paths.manifestPath)) {
        throw new Error("migration lock 的 manifestPath 与 runId 不一致");
    }
    let manifest = await loadManifest(paths);
    if (!manifest) {
        if (await pathExists(paths.journalPath)) {
            throw new Error("migration manifest 缺失但 journal 已存在；不能自动重建计划");
        }
        const plans = await planWorkspace(rootWorkspace);
        await verifyPreflightStorage(rootWorkspace, plans);
        manifest = createManifest(runId, plans, paths.runRootRelative);
        await writeInitialManifest(paths, manifest);
    }
    if (manifest.runId !== runId) {
        throw new Error("migration lock 与 manifest runId 不一致");
    }
    if (manifest.status === "failed") {
        if (!manifest.resumeStatus) {
            throw new Error("failed migration 缺少可恢复阶段");
        }
        await transitionRun(paths, manifest, manifest.resumeStatus);
    }
    try {
        return await executeManifest(rootWorkspace, paths, manifest, options);
    } catch (error) {
        await recordFailure(paths, manifest, error).catch(() => undefined);
        throw error;
    }
}

async function executeManifest(
    rootWorkspace: string,
    paths: ReturnType<typeof migrationPaths>,
    manifest: AttachmentMigrationManifest,
    options: RunAttachmentMigrationOptions,
): Promise<AttachmentMigrationReport> {
    const store = new AttachmentStore(new LocalAttachmentBlobAdapter(resolve(rootWorkspace, ".nbook", "agent", "attachments")));
    if (manifest.status === "running") {
        for (const session of manifest.sessions) {
            await executeSession(rootWorkspace, paths, manifest, session, store, options.observer);
        }
        await fullScan(rootWorkspace, manifest, store);
        await advanceRun(paths, manifest, "full_scan_verified", options.observer);
    }
    if (manifest.status === "full_scan_verified") {
        await advanceRun(paths, manifest, "complete", options.observer);
    }
    const report = reportFromManifest(manifest);
    if (manifest.status === "complete") {
        await writeDurableJson(paths.reportPath, report);
        await advanceRun(paths, manifest, "report_written", options.observer);
    }
    if (manifest.status !== "report_written") {
        throw new Error(`migration run 状态无法完成：${manifest.status}`);
    }
    // report 可由 manifest 确定性派生；恢复 report_written 时重写可修复缺失/半写报告。
    await writeDurableJson(paths.reportPath, report);
    await checkpointManifest(paths, manifest);
    await rm(paths.lockPath, {force: true});
    return report;
}

function createManifest(
    runId: string,
    plans: AttachmentSessionPlan[],
    runRootRelative: string,
): AttachmentMigrationManifest {
    const now = new Date().toISOString();
    return {
        version: 2,
        journalVersion: 1,
        runId,
        status: "running",
        appliedSeq: 0,
        startedAt: now,
        updatedAt: now,
        sessions: plans.map((plan) => ({
            sessionId: plan.sessionId,
            sourcePath: plan.sourcePath,
            backupPath: `${runRootRelative}/backups/${plan.sourcePath}.backup`,
            stagePath: `${runRootRelative}/stages/${plan.sourcePath}.stage`,
            rollbackPath: `${runRootRelative}/rollbacks/${plan.sourcePath}.rollback`,
            sourceHash: plan.sourceHash,
            targetHash: plan.targetHash,
            images: plan.images,
            bytes: plan.bytes,
            attachmentIds: plan.attachments.map((attachment) => attachment.ref.id),
            changed: plan.changed,
            status: plan.changed ? "pending" : "verified",
        })),
    };
}

function migrationPaths(rootWorkspace: string, runId: string) {
    const runRootRelative = `.nbook/agent/migrations/attachment-v1/${runId}`;
    const runRoot = resolve(rootWorkspace, ...runRootRelative.split("/"));
    return {
        rootWorkspace,
        runRoot,
        runRootRelative,
        lockPath: resolve(rootWorkspace, ATTACHMENT_MIGRATION_LOCK_RELATIVE_PATH),
        manifestPath: resolve(runRoot, "manifest.json"),
        journalPath: resolve(runRoot, "journal.jsonl"),
        reportPath: resolve(runRoot, "report.json"),
    };
}

async function acquireLock(path: string, lock: MigrationLock): Promise<void> {
    await mkdir(dirname(path), {recursive: true});
    const handle = await open(path, "wx").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "EEXIST") {
            throw new Error("Attachment migration lock 已存在；请检查状态并使用 --resume");
        }
        throw error;
    });
    try {
        await handle.writeFile(`${JSON.stringify(lock)}\n`, "utf8");
        await handle.sync();
    } finally {
        await handle.close();
    }
}

async function readLock(path: string): Promise<MigrationLock> {
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<MigrationLock>;
    if (value.version !== 1
        || typeof value.runId !== "string"
        || typeof value.pid !== "number"
        || typeof value.startedAt !== "string"
        || typeof value.manifestPath !== "string") {
        throw new Error("Attachment migration lock 内容无效；不能自动覆盖");
    }
    return value as MigrationLock;
}

async function executeSession(
    rootWorkspace: string,
    paths: ReturnType<typeof migrationPaths>,
    manifest: AttachmentMigrationManifest,
    session: AttachmentSessionMigrationState,
    store: AttachmentStore,
    observer: RunAttachmentMigrationOptions["observer"],
): Promise<void> {
    while (session.status !== "verified") {
        if (!session.changed && session.status === "pending") {
            const plan = await planFromPath(rootWorkspace, session.sourcePath);
            assertPlanHashes(session, plan);
            await verifyPlanRefs(plan, store, new Set());
            await advanceSession(paths, manifest, session, "verified", observer);
            continue;
        }
        if (session.status === "pending") {
            const sourcePath = workspacePath(rootWorkspace, session.sourcePath);
            const backupPath = workspacePath(rootWorkspace, session.backupPath);
            await assertFileHash(sourcePath, session.sourceHash, "迁移前 source 已变化");
            const backupHash = await optionalFileHash(backupPath);
            if (backupHash === null) {
                await mkdir(dirname(backupPath), {recursive: true});
                await copyFile(sourcePath, backupPath, constants.COPYFILE_EXCL);
                await syncFile(backupPath);
            } else if (backupHash !== session.sourceHash) {
                throw new Error(`${session.sourcePath}: 已存在 backup 与 source 不一致`);
            }
            await assertFileHash(backupPath, session.sourceHash, "backup hash 与 source 不一致");
            await advanceSession(paths, manifest, session, "backed_up", observer);
            continue;
        }
        if (session.status === "backed_up") {
            const plan = await planFromPath(rootWorkspace, session.backupPath);
            assertPlanHashes(session, plan);
            for (const attachment of plan.attachments) {
                const saved = await store.save({bytes: attachment.bytes, mimeType: attachment.ref.mimeType});
                if (saved.id !== attachment.ref.id || saved.bytes !== attachment.ref.bytes) {
                    throw new Error(`${session.sourcePath}: AttachmentStore 返回了不一致的引用`);
                }
                const loaded = await store.load(saved);
                if (imageMimeType(loaded) !== saved.mimeType) {
                    throw new Error(`${session.sourcePath}: Attachment hydration readiness 校验失败`);
                }
            }
            await verifyPlanRefs(plan, store, new Set(plan.attachments.map((item) => item.ref.id)));
            await advanceSession(paths, manifest, session, "attachments_written", observer);
            continue;
        }
        if (session.status === "attachments_written") {
            const plan = await planFromPath(rootWorkspace, session.backupPath);
            assertPlanHashes(session, plan);
            const stagePath = workspacePath(rootWorkspace, session.stagePath);
            const stageHash = await optionalFileHash(stagePath);
            if (stageHash === null) {
                await writeDurableText(stagePath, plan.targetText, true);
            } else if (stageHash !== session.targetHash) {
                throw new Error(`${session.sourcePath}: 已存在 stage 与目标计划不一致`);
            }
            const staged = await planFromPath(rootWorkspace, session.stagePath);
            if (staged.changed || staged.targetHash !== session.targetHash) {
                throw new Error(`${session.sourcePath}: stage 仍包含旧图片或 hash 不一致`);
            }
            await verifyPlanRefs(staged, store, new Set());
            await advanceSession(paths, manifest, session, "temp_verified", observer);
            continue;
        }
        if (session.status === "temp_verified") {
            await assertFileHash(workspacePath(rootWorkspace, session.stagePath), session.targetHash, "stage hash 无效");
            await advanceSession(paths, manifest, session, "publishing", observer);
            continue;
        }
        if (session.status === "publishing") {
            const recovered = await recoverPublishing(rootWorkspace, session);
            await advanceSession(paths, manifest, session, recovered === "published" ? "published" : "attachments_written", observer);
            continue;
        }
        if (session.status === "published") {
            const sourcePath = workspacePath(rootWorkspace, session.sourcePath);
            await assertFileHash(sourcePath, session.targetHash, "published JSONL hash 无效");
            const plan = await planFromPath(rootWorkspace, session.sourcePath);
            if (plan.changed) {
                throw new Error(`${session.sourcePath}: published JSONL 仍包含旧图片`);
            }
            await verifyPlanRefs(plan, store, new Set());
            await rm(workspacePath(rootWorkspace, session.rollbackPath), {force: true});
            await rm(workspacePath(rootWorkspace, session.stagePath), {force: true});
            await advanceSession(paths, manifest, session, "verified", observer);
        }
    }
}

/** 按现有WAL状态恢复一个session；磁盘hash使checkpoint写入前后的崩溃都可重入。 */
async function rollbackSession(
    rootWorkspace: string,
    paths: ReturnType<typeof migrationPaths>,
    manifest: AttachmentMigrationManifest,
    session: AttachmentSessionMigrationState,
    observer: RunAttachmentRollbackOptions["observer"],
): Promise<void> {
    while (session.status !== "rolled_back") {
        if (session.status === "verified") {
            await transitionSession(paths, manifest, session, "rollback_pending");
            await observer?.({sourcePath: session.sourcePath, status: "rollback_pending"});
            continue;
        }
        if (session.status === "rollback_pending") {
            const backupPath = workspacePath(rootWorkspace, session.backupPath);
            const stagePath = workspacePath(rootWorkspace, session.stagePath);
            await assertFileHash(backupPath, session.sourceHash, `${session.sourcePath}: rollback backup hash无效`);
            const stageHash = await optionalFileHash(stagePath);
            if (stageHash === null) {
                await mkdir(dirname(stagePath), {recursive: true});
                await copyFile(backupPath, stagePath, constants.COPYFILE_EXCL);
                await syncFile(stagePath);
            } else if (stageHash !== session.sourceHash) {
                throw new Error(`${session.sourcePath}: rollback stage内容无法识别`);
            }
            await transitionSession(paths, manifest, session, "rollback_publishing");
            await observer?.({sourcePath: session.sourcePath, status: "rollback_publishing"});
            continue;
        }
        if (session.status === "rollback_publishing") {
            await recoverRollbackPublishing(rootWorkspace, session);
            await transitionSession(paths, manifest, session, "rolled_back");
            await observer?.({sourcePath: session.sourcePath, status: "rolled_back"});
            continue;
        }
        throw new Error(`${session.sourcePath}: session状态无法回滚：${session.status}`);
    }
}

/** Windows两步替换的反向恢复；source/target hash是唯一可接受的磁盘身份。 */
async function recoverRollbackPublishing(
    rootWorkspace: string,
    session: AttachmentSessionMigrationState,
): Promise<void> {
    const original = workspacePath(rootWorkspace, session.sourcePath);
    const stage = workspacePath(rootWorkspace, session.stagePath);
    const rollback = workspacePath(rootWorkspace, session.rollbackPath);
    const originalHash = await optionalFileHash(original);
    const stageHash = await optionalFileHash(stage);
    const rollbackHash = await optionalFileHash(rollback);

    if (originalHash === session.sourceHash) {
        await rm(stage, {force: true});
        await rm(rollback, {force: true});
        return;
    }
    if (originalHash === session.targetHash) {
        if (stageHash !== session.sourceHash) {
            throw new Error(`${session.sourcePath}: rollback stage缺失或hash无效`);
        }
        if (rollbackHash !== null && rollbackHash !== session.targetHash) {
            throw new Error(`${session.sourcePath}: rollback临时文件内容无法识别`);
        }
        if (rollbackHash === session.targetHash) {
            await rm(rollback, {force: true});
        }
        await mkdir(dirname(rollback), {recursive: true});
        await renameDurable(original, rollback);
        await renameDurable(stage, original);
        await assertFileHash(original, session.sourceHash, `${session.sourcePath}: restored source hash无效`);
        await rm(rollback, {force: true});
        return;
    }
    if (originalHash === null && rollbackHash === session.targetHash && stageHash === session.sourceHash) {
        await renameDurable(stage, original);
        await assertFileHash(original, session.sourceHash, `${session.sourcePath}: crash recovery source hash无效`);
        await rm(rollback, {force: true});
        return;
    }
    throw new Error(`${session.sourcePath}: rollback publishing磁盘状态无法安全恢复`);
}

/** Windows 两步发布窗口恢复：优先确认已发布 target，其次继续 stage，最后恢复 source 重建 stage。 */
async function recoverPublishing(
    rootWorkspace: string,
    session: AttachmentSessionMigrationState,
): Promise<"published" | "rebuild_stage"> {
    const original = workspacePath(rootWorkspace, session.sourcePath);
    const stage = workspacePath(rootWorkspace, session.stagePath);
    const rollback = workspacePath(rootWorkspace, session.rollbackPath);
    const originalHash = await optionalFileHash(original);
    const stageHash = await optionalFileHash(stage);
    const rollbackHash = await optionalFileHash(rollback);

    if (originalHash === session.targetHash) {
        await rm(stage, {force: true});
        return "published";
    }
    if (originalHash === session.sourceHash) {
        if (stageHash !== session.targetHash) {
            return "rebuild_stage";
        }
        if (rollbackHash && rollbackHash !== session.sourceHash) {
            throw new Error(`${session.sourcePath}: rollback 内容无法识别`);
        }
        if (rollbackHash === session.sourceHash) {
            await rm(rollback, {force: true});
        }
        await mkdir(dirname(rollback), {recursive: true});
        await renameDurable(original, rollback);
        await renameDurable(stage, original);
        await assertFileHash(original, session.targetHash, "发布后的 original hash 无效");
        return "published";
    }
    if (originalHash === null && rollbackHash === session.sourceHash && stageHash === session.targetHash) {
        await renameDurable(stage, original);
        await assertFileHash(original, session.targetHash, "恢复发布后的 original hash 无效");
        return "published";
    }
    if (originalHash === null && rollbackHash === session.sourceHash && stageHash === null) {
        await mkdir(dirname(original), {recursive: true});
        await renameDurable(rollback, original);
        return "rebuild_stage";
    }
    throw new Error(`${session.sourcePath}: publishing 磁盘状态无法安全恢复`);
}

/** rollback复用同一个全局sentinel；同run残留lock表示上次回滚需继续。 */
async function ensureRollbackLock(
    rootWorkspace: string,
    paths: ReturnType<typeof migrationPaths>,
    runId: string,
): Promise<void> {
    const manifestPath = portableRelative(rootWorkspace, paths.manifestPath);
    if (await pathExists(paths.lockPath)) {
        const lock = await readLock(paths.lockPath);
        if (lock.runId !== runId || lock.manifestPath !== manifestPath) {
            throw new Error(`Attachment migration lock属于其他run：${lock.runId}`);
        }
        return;
    }
    await acquireLock(paths.lockPath, {
        version: 1,
        runId,
        pid: process.pid,
        startedAt: new Date().toISOString(),
        manifestPath,
    });
}

/** initial manifest落盘前没有任何session变化，同run lock可安全视为未开始并清理。 */
async function clearUnstartedRunLock(
    rootWorkspace: string,
    paths: ReturnType<typeof migrationPaths>,
    runId: string,
): Promise<void> {
    if (!await pathExists(paths.lockPath)) return;
    const lock = await readLock(paths.lockPath);
    const manifestPath = portableRelative(rootWorkspace, paths.manifestPath);
    if (lock.runId !== runId || lock.manifestPath !== manifestPath) {
        throw new Error(`Attachment migration lock属于其他run：${lock.runId}`);
    }
    await rm(paths.lockPath, {force: true});
}

/** 读取必须存在的migration manifest。 */
async function requiredManifest(
    paths: ReturnType<typeof migrationPaths>,
): Promise<AttachmentMigrationManifest> {
    const manifest = await loadManifest(paths);
    if (!manifest) {
        throw new Error("Attachment migration manifest缺失");
    }
    return manifest;
}

/** 从终态manifest生成Manager可稳定解析的有界回滚报告。 */
function rollbackReport(manifest: AttachmentMigrationManifest): AttachmentMigrationRollbackReport {
    return {
        version: 1,
        runId: manifest.runId,
        status: "rolled_back",
        restoredSessions: manifest.sessions.filter((session) => session.changed).length,
    };
}

/** 持久化 session delta 后通知测试/CLI observer。 */
async function advanceSession(
    paths: ReturnType<typeof migrationPaths>,
    manifest: AttachmentMigrationManifest,
    session: AttachmentSessionMigrationState,
    status: AttachmentSessionMigrationStatus,
    observer: RunAttachmentMigrationOptions["observer"],
): Promise<void> {
    await transitionSession(paths, manifest, session, status);
    await observer?.({kind: "session", sourcePath: session.sourcePath, status});
}

/** 持久化 run delta 后通知 observer；报告与 sentinel 的时序由这些阶段锁定。 */
async function advanceRun(
    paths: ReturnType<typeof migrationPaths>,
    manifest: AttachmentMigrationManifest,
    status: AttachmentMigrationRunStatus,
    observer: RunAttachmentMigrationOptions["observer"],
): Promise<void> {
    await transitionRun(paths, manifest, status);
    await observer?.({kind: "run", status});
}

/** 失败只追加一条有界 run delta，保留出错前阶段供显式 resume。 */
async function recordFailure(
    paths: ReturnType<typeof migrationPaths>,
    manifest: AttachmentMigrationManifest,
    error: unknown,
): Promise<void> {
    if (manifest.status === "failed" || manifest.status === "report_written") {
        return;
    }
    await transitionRun(paths, manifest, "failed", errorMessage(error));
}

async function fullScan(rootWorkspace: string, manifest: AttachmentMigrationManifest, store: AttachmentStore): Promise<void> {
    const plans = await planWorkspace(rootWorkspace);
    const actualPaths = plans.map((plan) => plan.sourcePath).sort();
    const expectedPaths = manifest.sessions.map((session) => session.sourcePath).sort();
    if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
        throw new Error("migration lock 内 session 文件集合发生变化");
    }
    for (const plan of plans) {
        if (plan.changed) {
            throw new Error(`${plan.sourcePath}: 全库复扫仍发现旧图片`);
        }
        await verifyPlanRefs(plan, store, new Set());
        const state = manifest.sessions.find((session) => session.sourcePath === plan.sourcePath);
        if (!state || state.status !== "verified" || plan.sourceHash !== state.targetHash) {
            throw new Error(`${plan.sourcePath}: manifest 与最终 JSONL 不一致`);
        }
    }
}

async function verifyPlanRefs(plan: AttachmentSessionPlan, store: AttachmentStore, newlyWritten: Set<string>): Promise<void> {
    for (const ref of plan.referencedAttachments) {
        if (newlyWritten.has(ref.id)) {
            continue;
        }
        const bytes = await store.load(ref);
        if (ref.mimeType.startsWith("image/") && imageMimeType(bytes) !== ref.mimeType) {
            throw new Error(`${plan.sourcePath}: Attachment 图片 MIME 校验失败`);
        }
    }
}

function assertPlanHashes(session: AttachmentSessionMigrationState, plan: AttachmentSessionPlan): void {
    if (plan.sourceHash !== session.sourceHash || plan.targetHash !== session.targetHash) {
        throw new Error(`${session.sourcePath}: backup/source 与 manifest 计划不一致`);
    }
}

async function planFromPath(rootWorkspace: string, relativePath: string): Promise<AttachmentSessionPlan> {
    const text = await readFile(workspacePath(rootWorkspace, relativePath), "utf8");
    return decodeLegacySession({sourcePath: relativePath, text});
}

/** 递归枚举当前 repository session 根下的 JSONL，旧分目录同样纳入硬切复扫。 */
async function planWorkspace(rootWorkspace: string): Promise<AttachmentSessionPlan[]> {
    const sessionsRoot = resolve(rootWorkspace, ".nbook", "agent", "sessions");
    const paths = await jsonlFiles(sessionsRoot);
    const plans: AttachmentSessionPlan[] = [];
    for (const path of paths) {
        const sourcePath = portableRelative(rootWorkspace, path);
        const text = await readFile(path, "utf8");
        const plan = decodeLegacySession({sourcePath, text});
        // Workspace preflight 只保留 hashes/ref/bytes；避免数百个 session 的完整 JSONL 字符串同时存活。
        plans.push({...plan, sourceText: "", targetText: ""});
    }
    return plans.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
}

/** dry-run 不尝试写探针；检查父目录权限和已存在 blob/引用的一致性。 */
async function verifyPreflightStorage(rootWorkspace: string, plans: AttachmentSessionPlan[]): Promise<void> {
    // 全新 Workspace Root 没有 Agent 目录，也没有任何历史 session 需要迁移。
    // dry-run 必须保持零写入，不能为了权限探针创建一个原本不存在的领域目录。
    if (plans.length === 0) return;
    const agentRoot = resolve(rootWorkspace, ".nbook", "agent");
    await access(agentRoot, constants.W_OK);
    const adapter = new LocalAttachmentBlobAdapter(resolve(agentRoot, "attachments"));
    const store = new AttachmentStore(adapter);
    const decoded = new Map(plans.flatMap((plan) => plan.attachments.map((attachment) => [attachment.ref.id, attachment])));

    for (const attachment of decoded.values()) {
        const existing = await adapter.get(attachmentKey(attachment.ref.id));
        if (existing && !sameBytes(existing, attachment.bytes)) {
            throw new AttachmentError("corrupt", "目标 Attachment 已存在但内容与迁移源不一致。");
        }
    }
    for (const plan of plans) {
        for (const ref of plan.referencedAttachments) {
            if (!decoded.has(ref.id)) {
                await store.load(ref);
            }
        }
    }
}

function reportFromPlans(
    runId: string,
    mode: "dry-run" | "apply",
    status: "planned" | "complete",
    plans: AttachmentSessionPlan[],
): AttachmentMigrationReport {
    const unique = new Set(plans.flatMap((plan) => plan.attachments.map((attachment) => attachment.ref.id)));
    return {
        version: 1,
        runId,
        mode,
        status,
        scannedSessions: plans.length,
        migratedSessions: plans.filter((plan) => plan.changed).length,
        skippedSessions: plans.filter((plan) => !plan.changed).length,
        images: plans.reduce((sum, plan) => sum + plan.images, 0),
        uniqueAttachments: unique.size,
        bytes: plans.reduce((sum, plan) => sum + plan.bytes, 0),
        sessions: plans.map((plan) => ({
            sessionId: plan.sessionId,
            sourcePath: plan.sourcePath,
            sourceHash: plan.sourceHash,
            targetHash: plan.targetHash,
            images: plan.images,
            bytes: plan.bytes,
            status: plan.changed ? "pending" : "verified",
        })),
    };
}

function reportFromManifest(manifest: AttachmentMigrationManifest): AttachmentMigrationReport {
    const unique = new Set(manifest.sessions.flatMap((session) => session.attachmentIds));
    return {
        version: 1,
        runId: manifest.runId,
        mode: "apply",
        status: "complete",
        scannedSessions: manifest.sessions.length,
        migratedSessions: manifest.sessions.filter((session) => session.changed).length,
        skippedSessions: manifest.sessions.filter((session) => !session.changed).length,
        images: manifest.sessions.reduce((sum, session) => sum + session.images, 0),
        uniqueAttachments: unique.size,
        bytes: manifest.sessions.reduce((sum, session) => sum + session.bytes, 0),
        sessions: manifest.sessions.map((session) => ({
            sessionId: session.sessionId,
            sourcePath: session.sourcePath,
            sourceHash: session.sourceHash,
            targetHash: session.targetHash,
            images: session.images,
            bytes: session.bytes,
            status: session.status,
            backupPath: session.backupPath,
        })),
    };
}

async function jsonlFiles(directory: string): Promise<string[]> {
    const entries = await readdir(directory, {withFileTypes: true}).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
            return [];
        }
        throw error;
    });
    const paths: string[] = [];
    for (const entry of entries) {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) {
            paths.push(...await jsonlFiles(path));
        } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
            paths.push(path);
        }
    }
    return paths;
}

function attachmentKey(id: string): string {
    const hash = id.slice("sha256:".length);
    return `sha256/${hash.slice(0, 2)}/${hash.slice(2)}`;
}

function portableRelative(root: string, path: string): string {
    return relative(root, path).split(sep).join("/");
}

function workspacePath(rootWorkspace: string, relativePath: string): string {
    const path = resolve(rootWorkspace, ...relativePath.split("/"));
    const relativePathCheck = relative(rootWorkspace, path);
    if (relativePathCheck.startsWith("..") || resolve(rootWorkspace, relativePathCheck) !== path) {
        throw new Error("migration manifest 包含越界路径");
    }
    return path;
}

async function assertFileHash(path: string, expected: string, message: string): Promise<void> {
    const actual = await optionalFileHash(path);
    if (actual !== expected) {
        throw new Error(`${message}：expected=${expected} actual=${actual ?? "missing"}`);
    }
}

async function optionalFileHash(path: string): Promise<string | null> {
    return readFile(path).then((bytes) => sha256(bytes)).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
            return null;
        }
        throw error;
    });
}

async function writeDurableText(path: string, text: string, exclusive = false): Promise<void> {
    await mkdir(dirname(path), {recursive: true});
    const handle = await open(path, exclusive ? "wx" : "w");
    try {
        await handle.writeFile(text, "utf8");
        await handle.sync();
    } finally {
        await handle.close();
    }
    await syncParentDirectories(path);
}

async function writeDurableJson(path: string, value: object): Promise<void> {
    await writeDurableText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(value: string | Uint8Array): string {
    return createHash("sha256").update(value).digest("hex");
}

function validatedRunId(value: string): string {
    if (!RUN_ID_PATTERN.test(value) || value === "." || value === "..") {
        throw new Error("migration runId 只能包含字母、数字、下划线和连字符");
    }
    return value;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function assertLockAbsent(rootWorkspace: string): Promise<void> {
    const lockPath = resolve(rootWorkspace, ATTACHMENT_MIGRATION_LOCK_RELATIVE_PATH);
    if (await pathExists(lockPath)) {
        throw new Error("Attachment migration lock 已存在；dry-run/新 apply 不能读取迁移中的 session");
    }
}

async function pathExists(path: string): Promise<boolean> {
    return access(path).then(() => true).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
            return false;
        }
        throw error;
    });
}

async function syncFile(path: string): Promise<void> {
    const handle = await open(path, "r+");
    try {
        await handle.sync();
    } finally {
        await handle.close();
    }
    await syncParentDirectories(path);
}

/** rename成功后同步源/目标父目录；跨目录发布同样获得确定的目录项持久性。 */
async function renameDurable(source: string, target: string): Promise<void> {
    await rename(source, target);
    await syncParentDirectories(source, target);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
    if (left.byteLength !== right.byteLength) {
        return false;
    }
    for (let index = 0; index < left.byteLength; index += 1) {
        if (left[index] !== right[index]) {
            return false;
        }
    }
    return true;
}
