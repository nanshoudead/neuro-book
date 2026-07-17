import {spawn} from "node:child_process";
import {join, resolve} from "node:path";
import {Type, type Static} from "typebox";
import {Value} from "typebox/value";

import {enableAuthentication, ensureStateFiles, loadStateEnv} from "#manager/config";
import {runDockerApplicationCommand, startDocker} from "#manager/docker";
import {pathExists} from "#manager/files";
import {commandAvailable, run, runCapture} from "#manager/process";
import {activateManagedTools} from "#manager/tools";
import type {InstallationManifest} from "#manager/types";
import {formatStateRootIntegrityWarning, inspectInstallationStateIntegrity, stateRootIntegrityFailed} from "#manager/state-integrity";

const MigrationSessionSchema = Type.Object({
    sessionId: Type.Union([Type.Integer(), Type.Null()]),
    sourcePath: Type.String({minLength: 1}),
    sourceHash: Type.String({pattern: "^[a-f0-9]{64}$"}),
    targetHash: Type.String({pattern: "^[a-f0-9]{64}$"}),
    images: Type.Integer({minimum: 0}),
    bytes: Type.Integer({minimum: 0}),
    status: Type.Union([Type.Literal("pending"), Type.Literal("verified")]),
    backupPath: Type.Optional(Type.String({minLength: 1})),
}, {additionalProperties: false});

const MigrationReportSchema = Type.Object({
    version: Type.Literal(1),
    runId: Type.String({minLength: 1}),
    mode: Type.Union([Type.Literal("dry-run"), Type.Literal("apply")]),
    status: Type.Union([Type.Literal("planned"), Type.Literal("complete")]),
    scannedSessions: Type.Integer({minimum: 0}),
    migratedSessions: Type.Integer({minimum: 0}),
    skippedSessions: Type.Integer({minimum: 0}),
    images: Type.Integer({minimum: 0}),
    uniqueAttachments: Type.Integer({minimum: 0}),
    bytes: Type.Integer({minimum: 0}),
    sessions: Type.Array(MigrationSessionSchema),
}, {additionalProperties: false});

const MigrationRollbackReportSchema = Type.Object({
    version: Type.Literal(1),
    runId: Type.String({minLength: 1}),
    status: Type.Union([Type.Literal("not_started"), Type.Literal("rolled_back")]),
    restoredSessions: Type.Integer({minimum: 0}),
}, {additionalProperties: false});

type MigrationReport = Static<typeof MigrationReportSchema>;

export type AttachmentMigrationSessionPlan = Pick<
    Static<typeof MigrationSessionSchema>,
    "sessionId" | "sourcePath" | "sourceHash" | "targetHash" | "backupPath"
>;

export type AttachmentMigrationPlan = {
    runId: string;
    migratedSessions: number;
    sessions: AttachmentMigrationSessionPlan[];
};

/** 启动当前安装。原生模式前台运行，Docker 模式后台运行。 */
export async function startApplication(root: string, manifest: InstallationManifest): Promise<void> {
    const stateRoot = resolve(root, manifest.stateRoot);
    await ensureStateFiles(stateRoot, 3000, manifest.profile !== "windows-portable");
    const stateIntegrity = await inspectInstallationStateIntegrity(root, stateRoot);
    if (stateRootIntegrityFailed(stateIntegrity)) {
        console.warn(`\n警告：${formatStateRootIntegrityWarning(stateIntegrity)}\n`);
    }
    activateManagedTools(root, manifest.components.tools);
    if (manifest.profile === "ghcr" || manifest.profile === "source-docker") {
        await startDocker(root, stateRoot, manifest.profile);
        return;
    }
    const env = await applicationEnvironment(root, stateRoot, manifest.profile === "source-dev");
    if (manifest.profile === "source-dev") {
        await run(resolveBun(root, manifest), ["run", "dev"], {cwd: root, env});
        return;
    }
    const entry = join(root, ".output", "server", "scripts", "deploy", "product-start.mjs");
    if (!await pathExists(entry)) {
        throw new Error("当前安装缺少 Product 启动入口，请先执行 neuro-book update --component product。");
    }
    const bun = resolveBun(root, manifest);
    if (manifest.profile === "windows-portable") {
        await runPortableForeground(bun, entry, root, env, Number(env.NUXT_PORT ?? env.PORT ?? "3000"));
        return;
    }
    await run(bun, [entry], {cwd: root, env});
}

/** 原生Product执行Prisma migration；容器与Source Dev由各自启动合同负责。 */
export async function migrateDatabase(root: string, manifest: InstallationManifest): Promise<void> {
    if (manifest.profile === "ghcr" || manifest.profile === "source-docker" || manifest.profile === "source-dev") return;
    const script = join(root, ".output", "server", "scripts", "db", "prisma-migrate.mjs");
    if (!await pathExists(script)) {
        throw new Error("Product 缺少数据库迁移脚本。");
    }
    const stateRoot = resolve(root, manifest.stateRoot);
    await run(resolveBun(root, manifest), [script, "--deploy"], {
        cwd: root,
        env: await applicationEnvironment(root, stateRoot, false),
    });
}

/** 只读规划Attachment hard cut；没有旧图片时返回null，缺脚本必须失败。 */
export async function planAttachmentMigration(
    root: string,
    manifest: InstallationManifest,
    runId: string,
): Promise<AttachmentMigrationPlan | null> {
    const script = attachmentMigrationScript(root, manifest);
    if (manifest.components.applicationRuntime.provider !== "container" && !await pathExists(script)) {
        throw new Error(`Product 缺少Attachment migration脚本：${script}`);
    }
    const report = await runAttachmentMigrationCommand(root, manifest, [script, "--dry-run", "--run-id", runId]);
    if (report.mode !== "dry-run" || report.status !== "planned" || report.runId !== runId) {
        throw new Error("Attachment migration dry-run返回了不一致的报告。");
    }
    return report.migratedSessions > 0
        ? {runId, migratedSessions: report.migratedSessions, sessions: migrationSessionPlans(report.sessions)}
        : null;
}

/** 使用预先写入Operation Journal的runId执行Attachment hard cut。 */
export async function applyAttachmentMigration(
    root: string,
    manifest: InstallationManifest,
    runId: string,
): Promise<AttachmentMigrationPlan> {
    const script = attachmentMigrationScript(root, manifest);
    const report = await runAttachmentMigrationCommand(root, manifest, [script, "--apply", "--run-id", runId]);
    if (report.mode !== "apply" || report.status !== "complete" || report.runId !== runId) {
        throw new Error("Attachment migration apply返回了不一致的报告。");
    }
    return {runId, migratedSessions: report.migratedSessions, sessions: migrationSessionPlans(report.sessions)};
}

/** 在恢复旧Product/Compose前撤销指定Attachment hard cut。 */
export async function rollbackAttachmentMigration(
    root: string,
    manifest: InstallationManifest,
    runId: string,
    allowNotStarted = false,
): Promise<void> {
    const script = attachmentMigrationScript(root, manifest);
    const output = await runApplicationCommand(root, manifest, [script, "--rollback", runId]);
    const value: unknown = JSON.parse(output);
    if (!Value.Check(MigrationRollbackReportSchema, value)) {
        throw new Error("Attachment migration rollback返回了无效报告。");
    }
    const report = value as Static<typeof MigrationRollbackReportSchema>;
    if (report.runId !== runId) throw new Error("Attachment migration rollback返回了错误runId。");
    if (report.status === "not_started" && !allowNotStarted) {
        throw new Error("Attachment migration已记录为applied，但rollback报告not_started；拒绝恢复旧Product。" );
    }
}

/** 创建或重置管理员。 */
export async function createAdmin(root: string, manifest: InstallationManifest, username?: string): Promise<void> {
    activateManagedTools(root, manifest.components.tools);
    const stateRoot = resolve(root, manifest.stateRoot);
    if (manifest.profile === "ghcr" || manifest.profile === "source-docker") {
        const compose = join(root, ".deploy", "docker-compose.generated.yml");
        const composeArgs = ["compose", "--env-file", join(stateRoot, ".env"), "-f", compose];
        const running = (await runCapture("docker", [...composeArgs, "ps", "--status", "running", "--services", "app"], {cwd: root})).trim();
        if (running !== "app") throw new Error("容器 app 尚未运行，请先执行 neuro-book start。" );
        await run("docker", [...composeArgs, "exec", "app", "bun", ".output/server/scripts/cli/create-admin.ts", ...(username ? [username] : [])], {cwd: root});
        return;
    }
    const productScript = join(root, ".output", "server", "scripts", "cli", "create-admin.ts");
    const args = username ? [productScript, username] : [productScript];
    if (await pathExists(productScript)) {
        await run(resolveBun(root, manifest), args, {cwd: root, env: await applicationEnvironment(root, stateRoot, false)});
        if (manifest.profile === "windows-portable") {
            await enableAuthentication(stateRoot);
            console.log("管理员创建成功，Windows Portable 鉴权已启用；请重启 NeuroBook。" );
        }
        return;
    }
    await run("bun", username ? ["run", "auth:create-admin", username] : ["run", "auth:create-admin"], {
        cwd: root,
        env: await applicationEnvironment(root, stateRoot, false),
    });
}

/** 生成状态/doctor 所需的命令版本。 */
export async function commandStatus(command: string): Promise<{available: boolean; version: string | null}> {
    const available = await commandAvailable(command);
    if (!available) {
        return {available: false, version: null};
    }
    const version = (await runCapture(command, ["--version"])).split(/\r?\n/u)[0]?.trim() ?? null;
    return {available: true, version};
}

export async function applicationEnvironment(root: string, stateRoot: string, development: boolean): Promise<NodeJS.ProcessEnv> {
    return {
        ...process.env,
        ...await loadStateEnv(stateRoot),
        NODE_ENV: development ? "development" : "production",
        NEURO_BOOK_STATE_ROOT: stateRoot,
        NEURO_BOOK_APPLICATION_ROOT: root,
    };
}

export function resolveBun(root: string, manifest: InstallationManifest): string {
    const runtime = manifest.components.applicationRuntime;
    if (runtime.provider === "managed") return resolve(root, runtime.path);
    if (runtime.provider === "system") return runtime.executable;
    throw new Error("Container Application Runtime 不能执行宿主 Product 命令。" );
}

/** 根据Profile选择Source或Product内的迁移脚本入口。 */
function attachmentMigrationScript(root: string, manifest: InstallationManifest): string {
    if (manifest.components.applicationRuntime.provider === "container") {
        return ".output/server/scripts/db/migrate-agent-attachments.ts";
    }
    return manifest.profile === "source-dev"
        ? join(root, "scripts", "db", "migrate-agent-attachments.ts")
        : join(root, ".output", "server", "scripts", "db", "migrate-agent-attachments.ts");
}

/** 执行并严格解析Attachment migration JSON报告。 */
async function runAttachmentMigrationCommand(
    root: string,
    manifest: InstallationManifest,
    args: string[],
): Promise<MigrationReport> {
    const output = await runApplicationCommand(root, manifest, args);
    const value: unknown = JSON.parse(output);
    if (!Value.Check(MigrationReportSchema, value)) {
        throw new Error("Attachment migration返回了无效报告。");
    }
    return value as MigrationReport;
}

/** 将CLI报告收敛为Operation Journal允许的可审计文件集合。 */
function migrationSessionPlans(sessions: MigrationReport["sessions"]): AttachmentMigrationSessionPlan[] {
    return sessions.map((session) => ({
        sessionId: session.sessionId,
        sourcePath: session.sourcePath,
        sourceHash: session.sourceHash,
        targetHash: session.targetHash,
        ...(session.backupPath ? {backupPath: session.backupPath} : {}),
    }));
}

/** 原生Profile使用Application Bun，容器Profile使用Compose一次性app容器。 */
async function runApplicationCommand(
    root: string,
    manifest: InstallationManifest,
    args: string[],
): Promise<string> {
    const stateRoot = resolve(root, manifest.stateRoot);
    if (manifest.components.applicationRuntime.provider === "container") {
        return runDockerApplicationCommand(root, stateRoot, ["bun", ...args]);
    }
    return runCapture(resolveBun(root, manifest), args, {
        cwd: root,
        env: await applicationEnvironment(root, stateRoot, manifest.profile === "source-dev"),
    });
}

async function runPortableForeground(bun: string, entry: string, root: string, env: NodeJS.ProcessEnv, port: number): Promise<void> {
    const child = spawn(bun, [entry], {cwd: root, env, stdio: "inherit", windowsHide: false});
    const exited = new Promise<void>((resolvePromise, rejectPromise) => {
        child.once("error", rejectPromise);
        child.once("exit", (code, signal) => {
            if (signal || code !== 0) rejectPromise(new Error(`NeuroBook 服务退出：${signal ?? code}`));
            else resolvePromise();
        });
    });
    const url = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 30_000;
    let opened = false;
    while (Date.now() < deadline && child.exitCode === null) {
        try {
            const response = await fetch(`${url}/api/app/version`, {signal: AbortSignal.timeout(1_000)});
            if (response.ok) {
                await run("cmd.exe", ["/c", "start", "", url], {cwd: root, stdio: "ignore"});
                opened = true;
                break;
            }
        } catch {
            // 服务启动期间连接失败属于预期状态。
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }
    if (!opened && child.exitCode === null) {
        child.kill();
        await exited.catch(() => undefined);
        throw new Error(`Windows Portable 启动后 30 秒内未通过健康检查：${url}`);
    }
    await exited;
}
