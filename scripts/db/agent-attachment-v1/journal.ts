import {mkdir, open, readFile, rename, rm} from "node:fs/promises";
import {dirname} from "node:path";
import type {
    AttachmentMigrationJournalRecord,
    AttachmentMigrationManifest,
    AttachmentMigrationRunStatus,
    AttachmentRunTransition,
    AttachmentSessionMigrationState,
    AttachmentSessionMigrationStatus,
    AttachmentSessionTransition,
} from "nbook/scripts/db/agent-attachment-v1/types";

const JOURNAL_BYTE_LIMIT = 8 * 1024 * 1024;
const JOURNAL_LINE_BYTE_LIMIT = 64 * 1024;
const ERROR_BYTE_LIMIT = 4096;
const RUN_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const ATTACHMENT_ID_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SESSION_STATUSES = new Set<AttachmentSessionMigrationStatus>([
    "pending",
    "backed_up",
    "attachments_written",
    "temp_verified",
    "publishing",
    "published",
    "verified",
    "rollback_pending",
    "rollback_publishing",
    "rolled_back",
]);
const RUN_STATUSES = new Set<AttachmentMigrationRunStatus>([
    "running",
    "failed",
    "full_scan_verified",
    "complete",
    "report_written",
    "rollback_running",
    "rolled_back",
]);
const SESSION_GRAPH: Record<AttachmentSessionMigrationStatus, readonly AttachmentSessionMigrationStatus[]> = {
    pending: ["backed_up"],
    backed_up: ["attachments_written"],
    attachments_written: ["temp_verified"],
    temp_verified: ["publishing"],
    publishing: ["published", "attachments_written"],
    published: ["verified"],
    verified: ["rollback_pending"],
    rollback_pending: ["rollback_publishing"],
    rollback_publishing: ["rolled_back"],
    rolled_back: [],
};

/** WAL 与 checkpoint 使用的迁移文件路径。 */
export type AttachmentMigrationJournalPaths = {
    runRoot: string;
    manifestPath: string;
    journalPath: string;
};

/** 原子写入只包含初始计划的 manifest；中间 session 进度不得重写它。 */
export async function writeInitialManifest(
    paths: AttachmentMigrationJournalPaths,
    manifest: AttachmentMigrationManifest,
): Promise<void> {
    if (manifest.appliedSeq !== 0 || manifest.status !== "running") {
        throw new Error("初始 migration manifest 状态无效");
    }
    await writeAtomicJson(paths.manifestPath, manifest, false);
}

/** 在终态写入一次 compact checkpoint，避免保留仅靠 WAL 才能解释的审计状态。 */
export async function checkpointManifest(
    paths: AttachmentMigrationJournalPaths,
    manifest: AttachmentMigrationManifest,
): Promise<void> {
    if (manifest.status !== "report_written" && manifest.status !== "rolled_back") {
        throw new Error("只有 report_written或rolled_back migration可以写最终checkpoint");
    }
    await writeAtomicJson(paths.manifestPath, manifest, true);
}

/** 读取 manifest，并严格回放连续 delta WAL；仅截断没有换行提交标记的尾记录。 */
export async function loadManifest(
    paths: AttachmentMigrationJournalPaths,
): Promise<AttachmentMigrationManifest | null> {
    const rawManifest = await readFile(paths.manifestPath, "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
            return null;
        }
        throw error;
    });
    if (rawManifest === null) {
        return null;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(rawManifest);
    } catch (error) {
        throw new Error(`migration manifest 损坏：${errorMessage(error)}`);
    }
    const checkpoint = parseManifest(parsed);
    const records = await readJournal(paths.journalPath);
    return replayJournal(checkpoint, records);
}

/** append+sync 一条 session delta，成功后再更新内存状态。 */
export async function transitionSession(
    paths: AttachmentMigrationJournalPaths,
    manifest: AttachmentMigrationManifest,
    session: AttachmentSessionMigrationState,
    to: AttachmentSessionMigrationStatus,
): Promise<void> {
    const record: AttachmentSessionTransition = {
        version: 1,
        kind: "session_transition",
        seq: manifest.appliedSeq + 1,
        runId: manifest.runId,
        at: new Date().toISOString(),
        sourcePath: session.sourcePath,
        from: session.status,
        to,
    };
    validateRecord(record);
    assertRecordTransition(manifest, record);
    await appendRecord(paths.journalPath, record);
    applyRecord(manifest, record);
}

/** append+sync 一条 run delta；进入 failed 时保存有界错误供显式 resume。 */
export async function transitionRun(
    paths: AttachmentMigrationJournalPaths,
    manifest: AttachmentMigrationManifest,
    to: AttachmentMigrationRunStatus,
    error?: string,
): Promise<void> {
    const record: AttachmentRunTransition = {
        version: 1,
        kind: "run_transition",
        seq: manifest.appliedSeq + 1,
        runId: manifest.runId,
        at: new Date().toISOString(),
        from: manifest.status,
        to,
        ...(to === "failed" ? {error: boundedText(error ?? "migration failed", ERROR_BYTE_LIMIT)} : {}),
    };
    validateRecord(record);
    assertRecordTransition(manifest, record);
    await appendRecord(paths.journalPath, record);
    applyRecord(manifest, record);
}

/** 将 checkpoint 还原为初始状态并回放 WAL，验证 seq、from/to 和状态图。 */
function replayJournal(
    checkpoint: AttachmentMigrationManifest,
    records: AttachmentMigrationJournalRecord[],
): AttachmentMigrationManifest {
    if (checkpoint.appliedSeq > records.length) {
        throw new Error("migration manifest appliedSeq 超出 journal");
    }
    const replay = initialState(checkpoint);
    let checkpointVerified = checkpoint.appliedSeq === 0;
    for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        if (!record || record.seq !== index + 1) {
            throw new Error(`migration journal seq 不连续：期望 ${String(index + 1)}`);
        }
        if (record.runId !== checkpoint.runId) {
            throw new Error(`migration journal 第 ${String(index + 1)} 条 runId 不一致`);
        }
        assertRecordTransition(replay, record);
        applyRecord(replay, record);
        if (record.seq === checkpoint.appliedSeq) {
            assertCheckpoint(checkpoint, replay);
            checkpointVerified = true;
        }
    }
    if (!checkpointVerified) {
        throw new Error("migration manifest checkpoint 无法由 journal 验证");
    }
    return replay;
}

/** 从 immutable plan 字段构造 WAL 的确定性初始状态。 */
function initialState(manifest: AttachmentMigrationManifest): AttachmentMigrationManifest {
    return {
        ...manifest,
        status: "running",
        appliedSeq: 0,
        updatedAt: manifest.startedAt,
        sessions: manifest.sessions.map((session) => ({
            ...session,
            status: session.changed ? "pending" : "verified",
        })),
        resumeStatus: undefined,
        error: undefined,
    };
}

/** 验证 checkpoint 与对应 seq 的回放状态完全一致。 */
function assertCheckpoint(checkpoint: AttachmentMigrationManifest, replay: AttachmentMigrationManifest): void {
    const checkpointState = {
        status: checkpoint.status,
        appliedSeq: checkpoint.appliedSeq,
        updatedAt: checkpoint.updatedAt,
        resumeStatus: checkpoint.resumeStatus,
        error: checkpoint.error,
        sessions: checkpoint.sessions.map((session) => [session.sourcePath, session.status]),
    };
    const replayState = {
        status: replay.status,
        appliedSeq: replay.appliedSeq,
        updatedAt: replay.updatedAt,
        resumeStatus: replay.resumeStatus,
        error: replay.error,
        sessions: replay.sessions.map((session) => [session.sourcePath, session.status]),
    };
    if (JSON.stringify(checkpointState) !== JSON.stringify(replayState)) {
        throw new Error("migration manifest checkpoint 与 journal 不一致");
    }
}

/** 验证 transition 与当前状态、sourcePath 所属 session 和状态图一致。 */
function assertRecordTransition(
    manifest: AttachmentMigrationManifest,
    record: AttachmentMigrationJournalRecord,
): void {
    if (record.kind === "session_transition") {
        if (manifest.status !== "running" && manifest.status !== "rollback_running") {
            throw new Error(`migration run=${manifest.status} 时不能推进 session`);
        }
        const session = manifest.sessions.find((item) => item.sourcePath === record.sourcePath);
        if (!session) {
            throw new Error(`migration journal sourcePath 不在 manifest：${record.sourcePath}`);
        }
        if (session.status !== record.from) {
            throw new Error(`${record.sourcePath}: migration journal from=${record.from}，当前为 ${session.status}`);
        }
        const rollbackTransition = record.from === "verified"
            || record.from === "rollback_pending"
            || record.from === "rollback_publishing";
        if (!session.changed
            || !SESSION_GRAPH[record.from].includes(record.to)
            || rollbackTransition !== (manifest.status === "rollback_running")) {
            throw new Error(`${record.sourcePath}: 非法 migration 状态转换 ${record.from} -> ${record.to}`);
        }
        return;
    }
    if (manifest.status !== record.from) {
        throw new Error(`migration run journal from=${record.from}，当前为 ${manifest.status}`);
    }
    if (record.to === "failed") {
        if (record.from === "failed" || record.from === "report_written" || record.from === "rolled_back" || !record.error) {
            throw new Error(`非法 migration run 状态转换 ${record.from} -> ${record.to}`);
        }
        return;
    }
    if (record.from === "failed") {
        if (!manifest.resumeStatus || record.to !== manifest.resumeStatus || record.error !== undefined) {
            throw new Error(`非法 migration resume 状态转换 failed -> ${record.to}`);
        }
        return;
    }
    const allowed = (record.from === "running" && record.to === "full_scan_verified")
        || (record.from === "full_scan_verified" && record.to === "complete")
        || (record.from === "complete" && record.to === "report_written")
        || (record.from === "report_written" && record.to === "rollback_running")
        || (record.from === "rollback_running" && record.to === "rolled_back");
    if (!allowed || record.error !== undefined) {
        throw new Error(`非法 migration run 状态转换 ${record.from} -> ${record.to}`);
    }
}

/** 将已持久化 record 应用到内存 manifest。 */
function applyRecord(manifest: AttachmentMigrationManifest, record: AttachmentMigrationJournalRecord): void {
    if (record.kind === "session_transition") {
        const session = manifest.sessions.find((item) => item.sourcePath === record.sourcePath);
        if (!session) {
            throw new Error(`migration journal sourcePath 不在 manifest：${record.sourcePath}`);
        }
        session.status = record.to;
    } else if (record.to === "failed") {
        manifest.resumeStatus = record.from as Exclude<AttachmentMigrationRunStatus, "failed" | "report_written" | "rolled_back">;
        manifest.error = record.error;
        manifest.status = "failed";
    } else {
        manifest.status = record.to;
        delete manifest.resumeStatus;
        delete manifest.error;
    }
    manifest.appliedSeq = record.seq;
    manifest.updatedAt = record.at;
}

/** 有界读取 WAL，并将没有换行提交标记的 crash tail 截断到最后完整记录。 */
async function readJournal(path: string): Promise<AttachmentMigrationJournalRecord[]> {
    const handle = await open(path, "r+").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
            return null;
        }
        throw error;
    });
    if (!handle) {
        return [];
    }
    try {
        const fileStat = await handle.stat();
        if (fileStat.size > JOURNAL_BYTE_LIMIT) {
            throw new Error(`migration journal 超过 ${String(JOURNAL_BYTE_LIMIT)} bytes 上限`);
        }
        let bytes = await handle.readFile();
        if (bytes.byteLength > 0 && bytes[bytes.byteLength - 1] !== 0x0a) {
            const lastNewline = bytes.lastIndexOf(0x0a);
            const committedBytes = lastNewline + 1;
            await handle.truncate(committedBytes);
            await handle.sync();
            bytes = bytes.subarray(0, committedBytes);
        }
        if (bytes.byteLength === 0) {
            return [];
        }
        let text: string;
        try {
            text = new TextDecoder("utf-8", {fatal: true}).decode(bytes);
        } catch (error) {
            throw new Error(`migration journal UTF-8 损坏：${errorMessage(error)}`);
        }
        const lines = text.slice(0, -1).split("\n");
        return lines.map((line, index) => parseJournalLine(line, index + 1));
    } finally {
        await handle.close();
    }
}

/** 解析一条具有换行提交标记的 WAL；任何完整坏行都拒绝恢复。 */
function parseJournalLine(line: string, lineNumber: number): AttachmentMigrationJournalRecord {
    if (!line || Buffer.byteLength(line, "utf8") > JOURNAL_LINE_BYTE_LIMIT) {
        throw new Error(`migration journal 第 ${String(lineNumber)} 条为空或超过行上限`);
    }
    let value: unknown;
    try {
        value = JSON.parse(line);
    } catch (error) {
        throw new Error(`migration journal 第 ${String(lineNumber)} 条损坏：${errorMessage(error)}`);
    }
    try {
        return validateRecord(value);
    } catch (error) {
        throw new Error(`migration journal 第 ${String(lineNumber)} 条无效：${errorMessage(error)}`);
    }
}

/** 严格解析单条 delta，不接受未知字段或弱类型。 */
function validateRecord(value: unknown): AttachmentMigrationJournalRecord {
    const record = objectValue(value, "migration journal record");
    const kind = record.kind;
    if (kind === "session_transition") {
        assertExactKeys(record, ["version", "kind", "seq", "runId", "at", "sourcePath", "from", "to"]);
        assertRecordBase(record);
        if (typeof record.sourcePath !== "string" || !record.sourcePath
            || !isSessionStatus(record.from) || !isSessionStatus(record.to)) {
            throw new Error("session transition 字段无效");
        }
        return record as AttachmentSessionTransition;
    }
    if (kind === "run_transition") {
        assertExactKeys(record, record.error === undefined
            ? ["version", "kind", "seq", "runId", "at", "from", "to"]
            : ["version", "kind", "seq", "runId", "at", "from", "to", "error"]);
        assertRecordBase(record);
        if (!isRunStatus(record.from) || !isRunStatus(record.to)
            || (record.error !== undefined && (typeof record.error !== "string" || !record.error))) {
            throw new Error("run transition 字段无效");
        }
        return record as AttachmentRunTransition;
    }
    throw new Error("journal kind 无效");
}

/** 校验 delta 的公共版本、序号、runId 与时间字段。 */
function assertRecordBase(record: {[key: string]: unknown}): void {
    if (record.version !== 1
        || !Number.isSafeInteger(record.seq) || (record.seq as number) < 1
        || typeof record.runId !== "string" || !RUN_ID_PATTERN.test(record.runId)
        || typeof record.at !== "string" || !record.at) {
        throw new Error("journal 公共字段无效");
    }
}

/** 严格解析 manifest checkpoint 和 immutable session plan 字段。 */
function parseManifest(value: unknown): AttachmentMigrationManifest {
    const manifest = objectValue(value, "migration manifest");
    assertExactKeys(manifest, [
        "version", "journalVersion", "runId", "status", "appliedSeq", "startedAt", "updatedAt", "sessions",
        ...(manifest.resumeStatus === undefined ? [] : ["resumeStatus"]),
        ...(manifest.error === undefined ? [] : ["error"]),
    ]);
    if (manifest.version !== 2 || manifest.journalVersion !== 1
        || typeof manifest.runId !== "string" || !RUN_ID_PATTERN.test(manifest.runId)
        || !isRunStatus(manifest.status)
        || !Number.isSafeInteger(manifest.appliedSeq) || (manifest.appliedSeq as number) < 0
        || typeof manifest.startedAt !== "string" || !manifest.startedAt
        || typeof manifest.updatedAt !== "string" || !manifest.updatedAt
        || !Array.isArray(manifest.sessions)) {
        throw new Error("migration manifest 公共字段无效");
    }
    const sessions = manifest.sessions.map((session) => parseSessionState(session));
    if (new Set(sessions.map((session) => session.sourcePath)).size !== sessions.length) {
        throw new Error("migration manifest sourcePath 重复");
    }
    if (manifest.status === "failed") {
        if (!isResumeStatus(manifest.resumeStatus) || typeof manifest.error !== "string" || !manifest.error) {
            throw new Error("failed migration manifest 缺少 resumeStatus/error");
        }
    } else if (manifest.resumeStatus !== undefined || manifest.error !== undefined) {
        throw new Error("非 failed migration manifest 不能包含 resumeStatus/error");
    }
    return {...manifest, sessions} as AttachmentMigrationManifest;
}

/** 严格解析单个 session 的 immutable plan 和 checkpoint status。 */
function parseSessionState(value: unknown): AttachmentSessionMigrationState {
    const session = objectValue(value, "migration session");
    assertExactKeys(session, [
        "sessionId", "sourcePath", "backupPath", "stagePath", "rollbackPath", "sourceHash", "targetHash",
        "images", "bytes", "attachmentIds", "changed", "status",
    ]);
    const validSessionId = session.sessionId === null
        || (Number.isSafeInteger(session.sessionId) && (session.sessionId as number) > 0);
    if (!validSessionId
        || typeof session.sourcePath !== "string" || !session.sourcePath
        || typeof session.backupPath !== "string" || !session.backupPath
        || typeof session.stagePath !== "string" || !session.stagePath
        || typeof session.rollbackPath !== "string" || !session.rollbackPath
        || typeof session.sourceHash !== "string" || !HASH_PATTERN.test(session.sourceHash)
        || typeof session.targetHash !== "string" || !HASH_PATTERN.test(session.targetHash)
        || !Number.isSafeInteger(session.images) || (session.images as number) < 0
        || !Number.isSafeInteger(session.bytes) || (session.bytes as number) < 0
        || !Array.isArray(session.attachmentIds)
        || !session.attachmentIds.every((id) => typeof id === "string" && ATTACHMENT_ID_PATTERN.test(id))
        || typeof session.changed !== "boolean"
        || !isSessionStatus(session.status)
        || (!session.changed && session.status !== "verified")) {
        throw new Error("migration session 字段无效");
    }
    return session as AttachmentSessionMigrationState;
}

/** append 并 sync 一条有界 WAL，禁止 journal 越过固定读写预算。 */
async function appendRecord(path: string, record: AttachmentMigrationJournalRecord): Promise<void> {
    const line = `${JSON.stringify(record)}\n`;
    const lineBytes = Buffer.byteLength(line, "utf8");
    if (lineBytes > JOURNAL_LINE_BYTE_LIMIT) {
        throw new Error("migration journal record 超过行上限");
    }
    await mkdir(dirname(path), {recursive: true});
    const handle = await open(path, "a+");
    try {
        const fileStat = await handle.stat();
        if (fileStat.size + lineBytes > JOURNAL_BYTE_LIMIT) {
            throw new Error(`migration journal 超过 ${String(JOURNAL_BYTE_LIMIT)} bytes 上限`);
        }
        await handle.writeFile(line, "utf8");
        await handle.sync();
    } finally {
        await handle.close();
    }
}

/** 用同目录 temp + rename 发布 JSON，避免 checkpoint 半写截断。 */
async function writeAtomicJson(path: string, value: object, replace: boolean): Promise<void> {
    await mkdir(dirname(path), {recursive: true});
    if (!replace) {
        await readFile(path).then(() => {
            throw new Error("migration manifest 已存在");
        }).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") {
                throw error;
            }
        });
    }
    const tempPath = `${path}.next`;
    // Workspace 迁移租约保证只有一个 writer；清理由上次 crash 留下的未发布 temp。
    await rm(tempPath, {force: true});
    const handle = await open(tempPath, "wx");
    try {
        await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
        await handle.sync();
    } finally {
        await handle.close();
    }
    try {
        await rename(tempPath, path);
    } finally {
        await rm(tempPath, {force: true});
    }
}

/** 限制 UTF-8 文本大小，避免多字节字符截成替换符。 */
function boundedText(value: string, maxBytes: number): string {
    const bytes = Buffer.from(value, "utf8");
    if (bytes.byteLength <= maxBytes) {
        return value;
    }
    return new TextDecoder("utf-8", {fatal: false}).decode(bytes.subarray(0, maxBytes)).replace(/\uFFFD$/u, "");
}

/** 断言对象只包含合同声明字段。 */
function assertExactKeys(value: {[key: string]: unknown}, keys: string[]): void {
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`字段集合无效：${actual.join(",")}`);
    }
}

/** 外部 JSON 必须先证明为普通对象。 */
function objectValue(value: unknown, label: string): {[key: string]: unknown} {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${label} 必须是对象`);
    }
    return value as {[key: string]: unknown};
}

/** 判断 session 状态字符串。 */
function isSessionStatus(value: unknown): value is AttachmentSessionMigrationStatus {
    return typeof value === "string" && SESSION_STATUSES.has(value as AttachmentSessionMigrationStatus);
}

/** 判断 run 状态字符串。 */
function isRunStatus(value: unknown): value is AttachmentMigrationRunStatus {
    return typeof value === "string" && RUN_STATUSES.has(value as AttachmentMigrationRunStatus);
}

/** 判断 failed 状态允许恢复到的阶段。 */
function isResumeStatus(value: unknown): value is Exclude<AttachmentMigrationRunStatus, "failed" | "report_written" | "rolled_back"> {
    return value === "running" || value === "full_scan_verified" || value === "complete" || value === "rollback_running";
}

/** 将未知错误收口为审计文本。 */
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
