import {randomUUID} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {
    ATTACHMENT_MIGRATION_LOCK_RELATIVE_PATH,
    AttachmentMigrationGate,
    AttachmentMigrationInProgressError,
} from "nbook/server/agent/session/attachment-migration-gate";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";

describe("AttachmentMigrationGate", () => {
    let root: AbsoluteFsPath;

    beforeEach(() => {
        root = absoluteFsPath(resolve(".agent", "attachment-migration-gate-test", randomUUID()));
    });

    afterEach(async () => {
        await rm(root, {recursive: true, force: true});
    });

    it("没有 sentinel 时允许写入", async () => {
        const gate = new AttachmentMigrationGate(root);

        await expect(gate.assertWritable()).resolves.toBeUndefined();
        expect(gate.lockPath).toBe(join(root, ATTACHMENT_MIGRATION_LOCK_RELATIVE_PATH));
    });

    it("sentinel 存在时 fail closed，且不依赖 lock 内容", async () => {
        const gate = new AttachmentMigrationGate(root);
        await mkdir(gate.lockDirectory, {recursive: true});
        await writeFile(gate.lockPath, "not-json", "utf8");

        await expect(gate.assertWritable()).rejects.toBeInstanceOf(AttachmentMigrationInProgressError);
        await expect(gate.assertWritable()).rejects.toMatchObject({
            code: "ATTACHMENT_MIGRATION_IN_PROGRESS",
        });
    });

    it("sentinel 路径被目录占用时同样 fail closed", async () => {
        const gate = new AttachmentMigrationGate(root);
        await mkdir(gate.lockPath, {recursive: true});

        await expect(gate.assertWritable()).rejects.toBeInstanceOf(AttachmentMigrationInProgressError);
    });
});

describe("JsonlSessionRepository migration write gate", () => {
    let root: AbsoluteFsPath;
    let repo: JsonlSessionRepository;

    beforeEach(() => {
        root = absoluteFsPath(resolve(".agent", "attachment-migration-repo-test", randomUUID()));
        repo = new JsonlSessionRepository(root);
    });

    afterEach(async () => {
        await rm(root, {recursive: true, force: true});
    });

    async function createLock(): Promise<void> {
        const lockPath = join(root, ATTACHMENT_MIGRATION_LOCK_RELATIVE_PATH);
        await mkdir(join(root, ".nbook", "agent", "migrations"), {recursive: true});
        await writeFile(lockPath, "migration-running", "utf8");
    }

    it("createSession 在 nextSessionId 前被拦截，不创建 session 序列文件", async () => {
        await createLock();

        await expect(repo.createSession({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        })).rejects.toMatchObject({code: "ATTACHMENT_MIGRATION_IN_PROGRESS"});

        await expect(repo.listSessions()).resolves.toEqual([]);
        await expect(readFile(join(root, ".nbook", "agent", "session-seq.json"), "utf8"))
            .rejects.toMatchObject({code: "ENOENT"});
    });

    it("appendLine 在已有 session 上也拒绝新增 entry", async () => {
        const session = await repo.createSession({
            profileKey: "leader.default",
            initial: {},
            workspaceRoot: root,
        });
        const entriesBefore = session.entries;
        await createLock();

        await expect(repo.appendUserMessage(session.metadata.sessionId, "blocked")).rejects.toMatchObject({
            code: "ATTACHMENT_MIGRATION_IN_PROGRESS",
        });
        await expect(repo.readSession(session.metadata.sessionId)).resolves.toMatchObject({entries: entriesBefore});
    });
});
