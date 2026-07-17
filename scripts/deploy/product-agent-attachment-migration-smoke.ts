#!/usr/bin/env bun
import {createHash, randomUUID} from "node:crypto";
import {access, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";

type MigrationReport = {
    runId: string;
    mode: "dry-run" | "apply";
    status: "planned" | "complete";
    migratedSessions: number;
};

type RollbackReport = {
    runId: string;
    status: "not_started" | "rolled_back";
    restoredSessions: number;
};

if (!process.env.NEURO_BOOK_APPLICATION_ROOT?.trim() || !process.env.NEURO_BOOK_STATE_ROOT?.trim()) {
    throw new Error("Product Attachment migration smoke必须显式设置Application Root与State Root。" );
}

const runtimePaths = runtimePathsFromEnv();
const script = path.join(runtimePaths.applicationRoot, ".output", "server", "scripts", "db", "migrate-agent-attachments.ts");
await access(script);
const sessionId = 900_000_000 + process.pid;
const runId = `product-attachment-smoke-${process.pid}`;
const sessionPath = path.join(runtimePaths.workspaceRoot, ".nbook", "agent", "sessions", `${sessionId}.jsonl`);
const imageBytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from("product-attachment-migration-smoke", "utf8"),
]);
const imageHash = createHash("sha256").update(imageBytes).digest("hex");
const blobPath = path.join(
    runtimePaths.userNbookRoot,
    "agent",
    "attachments",
    "sha256",
    imageHash.slice(0, 2),
    imageHash.slice(2),
);
const runRoot = path.join(runtimePaths.userNbookRoot, "agent", "migrations", "attachment-v1", runId);
await mkdir(path.dirname(sessionPath), {recursive: true});
try {
    await access(sessionPath).then(() => {
        throw new Error(`Product Attachment migration smoke session已存在：${sessionPath}`);
    }).catch((error) => {
        if (error instanceof Error && error.message.startsWith("Product Attachment")) throw error;
    });
    const source = legacySession(sessionId, runtimePaths.workspaceRoot, imageBytes);
    await writeFile(sessionPath, source, {encoding: "utf8", flag: "wx"});

    const dryRun = await runMigration<MigrationReport>(["--dry-run", "--run-id", runId]);
    if (dryRun.runId !== runId || dryRun.mode !== "dry-run" || dryRun.status !== "planned" || dryRun.migratedSessions !== 1) {
        throw new Error("Product Attachment migration dry-run报告不符合预期。" );
    }
    if (await readFile(sessionPath, "utf8") !== source) {
        throw new Error("Product Attachment migration dry-run修改了session。" );
    }

    const applied = await runMigration<MigrationReport>(["--apply", "--run-id", runId]);
    if (applied.runId !== runId || applied.mode !== "apply" || applied.status !== "complete" || applied.migratedSessions !== 1) {
        throw new Error("Product Attachment migration apply报告不符合预期。" );
    }
    const migrated = await readFile(sessionPath, "utf8");
    if (migrated.includes('"type":"image"') || !migrated.includes(`sha256:${imageHash}`)) {
        throw new Error("Product Attachment migration没有把内联图片硬切为Attachment reference。" );
    }
    await access(blobPath);

    const rolledBack = await runMigration<RollbackReport>(["--rollback", runId]);
    if (rolledBack.runId !== runId || rolledBack.status !== "rolled_back" || rolledBack.restoredSessions !== 1) {
        throw new Error("Product Attachment migration rollback报告不符合预期。" );
    }
    if (await readFile(sessionPath, "utf8") !== source) {
        throw new Error("Product Attachment migration rollback没有按原始字节恢复session。" );
    }

    console.log(JSON.stringify({
        ok: true,
        runId,
        sessionId,
        dryRun: dryRun.status,
        apply: applied.status,
        rollback: rolledBack.status,
        sourceRestored: true,
    }, null, 2));
} finally {
    await rm(sessionPath, {force: true});
    await rm(runRoot, {recursive: true, force: true});
    await rm(blobPath, {force: true});
}

/** 调用Product内真实CLI并解析唯一JSON报告。 */
async function runMigration<TReport>(args: string[]): Promise<TReport> {
    const child = Bun.spawn({
        cmd: [process.execPath, script, ...args],
        cwd: runtimePaths.applicationRoot,
        env: {
            ...process.env,
            NEURO_BOOK_APPLICATION_ROOT: runtimePaths.applicationRoot,
            NEURO_BOOK_STATE_ROOT: runtimePaths.stateRoot,
        },
        stdout: "pipe",
        stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
    ]);
    if (exitCode !== 0) {
        throw new Error(`Product Attachment migration CLI失败（${exitCode}）：${stderr || stdout}`);
    }
    return JSON.parse(stdout) as TReport;
}

/** 构造runtime硬切前的Pi内联图片session。 */
function legacySession(id: number, workspaceRoot: string, bytes: Uint8Array): string {
    return [
        {
            kind: "header",
            metadata: {
                sessionId: id,
                profileKey: "leader.default",
                initial: {},
                workspaceRoot,
                workspaceKey: "global",
                createdAt: 1,
            },
        },
        {
            kind: "entry",
            entry: {
                id: randomUUID(),
                parentId: null,
                timestamp: 2,
                type: "message",
                message: {
                    role: "toolResult",
                    toolCallId: "read-image",
                    toolName: "read",
                    content: [
                        {type: "text", text: "Read image file [image/png]"},
                        {type: "image", mimeType: "image/png", data: Buffer.from(bytes).toString("base64")},
                    ],
                    details: {path: "reference/image.png"},
                    isError: false,
                    timestamp: 2,
                },
            },
        },
    ].map((record) => JSON.stringify(record)).join("\n") + "\n";
}
