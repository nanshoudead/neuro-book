import type {AttachmentRef} from "nbook/shared/dto/agent-attachment.dto";

/** Attachment v1 迁移单个 session 的可恢复状态。 */
export type AttachmentSessionMigrationStatus =
    | "pending"
    | "backed_up"
    | "attachments_written"
    | "temp_verified"
    | "publishing"
    | "published"
    | "verified"
    | "rollback_pending"
    | "rollback_publishing"
    | "rolled_back";

/** 迁移全局阶段；report_written 表示报告已落盘，之后只剩释放 sentinel。 */
export type AttachmentMigrationRunStatus =
    | "running"
    | "failed"
    | "full_scan_verified"
    | "complete"
    | "report_written"
    | "rollback_running"
    | "rolled_back";

/** 一次迁移中的 session 持久化状态。路径均相对 Workspace Root。 */
export type AttachmentSessionMigrationState = {
    sessionId: number | null;
    sourcePath: string;
    backupPath: string;
    stagePath: string;
    rollbackPath: string;
    sourceHash: string;
    targetHash: string;
    images: number;
    bytes: number;
    attachmentIds: string[];
    changed: boolean;
    status: AttachmentSessionMigrationStatus;
};

/** 初始计划与最终 checkpoint；中间进度只写 delta WAL。 */
export type AttachmentMigrationManifest = {
    version: 2;
    journalVersion: 1;
    runId: string;
    status: AttachmentMigrationRunStatus;
    /** manifest snapshot 已包含的最后一条 WAL seq；初始计划为 0。 */
    appliedSeq: number;
    startedAt: string;
    updatedAt: string;
    sessions: AttachmentSessionMigrationState[];
    /** status=failed 时存在，表示 resume 应返回的先前阶段。 */
    resumeStatus?: Exclude<AttachmentMigrationRunStatus, "failed" | "report_written" | "rolled_back">;
    /** status=failed 时存在；内容有界，避免错误对象放大 WAL。 */
    error?: string;
};

/** 单个 session 的可恢复状态变化。 */
export type AttachmentSessionTransition = {
    version: 1;
    kind: "session_transition";
    seq: number;
    runId: string;
    at: string;
    sourcePath: string;
    from: AttachmentSessionMigrationStatus;
    to: AttachmentSessionMigrationStatus;
};

/** 全局迁移阶段变化。 */
export type AttachmentRunTransition = {
    version: 1;
    kind: "run_transition";
    seq: number;
    runId: string;
    at: string;
    from: AttachmentMigrationRunStatus;
    to: AttachmentMigrationRunStatus;
    /** 仅进入 failed 时存在。 */
    error?: string;
};

/** journal.jsonl 的唯一合法记录联合。 */
export type AttachmentMigrationJournalRecord = AttachmentSessionTransition | AttachmentRunTransition;

/** CLI 与集成测试消费的 machine-readable 报告。 */
export type AttachmentMigrationReport = {
    version: 1;
    runId: string;
    mode: "dry-run" | "apply";
    status: "planned" | "complete";
    scannedSessions: number;
    migratedSessions: number;
    skippedSessions: number;
    images: number;
    uniqueAttachments: number;
    bytes: number;
    sessions: Array<{
        sessionId: number | null;
        sourcePath: string;
        sourceHash: string;
        targetHash: string;
        images: number;
        bytes: number;
        status: AttachmentSessionMigrationStatus;
        /** dry-run 尚未建立 backup 时为空。 */
        backupPath?: string;
    }>;
};

/** Manager回滚Product前消费的Attachment hard cut回滚报告。 */
export type AttachmentMigrationRollbackReport = {
    version: 1;
    runId: string;
    status: "not_started" | "rolled_back";
    restoredSessions: number;
};

/** 迁移模块入口参数；observer 用于 CLI 进度和中断恢复集成测试。 */
export type RunAttachmentMigrationOptions = {
    rootWorkspace: string;
    mode: "dry-run" | "apply";
    runId?: string;
    resume?: boolean;
    observer?: (event:
        | {
            kind: "session";
            sourcePath: string;
            status: AttachmentSessionMigrationStatus;
        }
        | {
            kind: "run";
            status: AttachmentMigrationRunStatus;
        }
    ) => void | Promise<void>;
};

/** 根据既有migration run的不可变hash计划恢复旧session格式。 */
export type RunAttachmentRollbackOptions = {
    rootWorkspace: string;
    runId: string;
    observer?: (event: {
        sourcePath: string;
        status: "rollback_pending" | "rollback_publishing" | "rolled_back";
    }) => void | Promise<void>;
};

/** migration-only decoder 产出的待保存二进制。 */
export type DecodedAttachment = {
    ref: AttachmentRef;
    bytes: Uint8Array;
};

/** 单个 JSONL 文件的纯内存迁移计划。 */
export type AttachmentSessionPlan = {
    sessionId: number | null;
    sourcePath: string;
    sourceText: string;
    targetText: string;
    sourceHash: string;
    targetHash: string;
    images: number;
    bytes: number;
    changed: boolean;
    attachments: DecodedAttachment[];
    referencedAttachments: AttachmentRef[];
};
