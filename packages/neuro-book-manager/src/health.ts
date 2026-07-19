import {spawn} from "node:child_process";
import {copyFile} from "node:fs/promises";
import {createConnection} from "node:net";
import {dirname, join} from "node:path";

import {Database} from "bun:sqlite";

import {loadStateEnv, resolveStateDatabaseUrl} from "#manager/config";
import {ensureDirectory, pathExists} from "#manager/files";
import {resolveAppSqliteLocation} from "nbook/server/runtime/app-sqlite-location";

/** 更新原生 Product 前确认端口未被运行中的服务占用。 */
export async function assertNativeProductStopped(stateRoot: string): Promise<void> {
    const port = await statePort(stateRoot);
    if (await portOpen(port)) {
        throw new Error(`NeuroBook 仍在监听 127.0.0.1:${port}；请先退出服务后再更新。`);
    }
}

export type ApplicationDatabaseBackup = {
    configuredUrl: string;
    databasePath: string;
    backupPath: string;
    checkpoint: {busy: number; log: number; checkpointed: number};
};

export type ApplicationDatabaseBackupIntent = Omit<ApplicationDatabaseBackup, "checkpoint"> & {
    stateRoot: string;
};

/** checkpoint WAL 后备份 App SQLite；数据库尚未创建时返回 null。 */
export async function backupApplicationDatabase(
    stateRoot: string,
    backupRoot: string,
    onIntent?: (intent: ApplicationDatabaseBackupIntent) => Promise<void>,
): Promise<ApplicationDatabaseBackup | null> {
    const configuredUrl = await resolveStateDatabaseUrl(stateRoot);
    const databasePath = resolveAppSqliteLocation(configuredUrl, stateRoot).hostPath;
    if (!await pathExists(databasePath)) return null;
    const backupPath = join(backupRoot, "database", "app.sqlite");
    await onIntent?.({configuredUrl, databasePath, backupPath, stateRoot});
    try {
        const database = new Database(databasePath, {readwrite: true, create: false});
        let checkpoint: ApplicationDatabaseBackup["checkpoint"];
        try {
            const result = database.query<{busy: number; log: number; checkpointed: number}, []>("PRAGMA wal_checkpoint(TRUNCATE)").get();
            if (!result || result.busy !== 0 || result.checkpointed !== result.log) {
                throw new Error(`WAL checkpoint未完成：${JSON.stringify(result)}`);
            }
            checkpoint = result;
        } finally {
            database.close();
        }
        await ensureDirectory(dirname(backupPath));
        await copyFile(databasePath, backupPath);
        return {configuredUrl, databasePath, backupPath, checkpoint};
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`App SQLite备份失败：${databasePath}\n${message}`, {cause: error});
    }
}

/** 临时启动 Product，验证基础 HTTP 与版本接口后关闭进程。 */
export async function verifyNativeProduct(root: string, stateRoot: string, bun: string, expectedVersion: string): Promise<void> {
    const entry = join(root, ".output", "server", "index.mjs");
    if (!await pathExists(entry)) throw new Error("Product 健康检查缺少 .output/server/index.mjs。" );
    const port = await statePort(stateRoot);
    const child = spawn(bun, [entry], {
        cwd: root,
        env: {
            ...process.env,
            ...await loadStateEnv(stateRoot),
            HOST: "127.0.0.1",
            PORT: String(port),
            NUXT_PORT: String(port),
            NODE_ENV: "production",
            NEURO_BOOK_STATE_ROOT: stateRoot,
            NEURO_BOOK_APPLICATION_ROOT: root,
        },
        stdio: "ignore",
        windowsHide: true,
    });
    try {
        const deadline = Date.now() + 120_000;
        let lastError = "服务尚未响应";
        let nextProgressAt = Date.now() + 10_000;
        while (Date.now() < deadline) {
            if (child.exitCode !== null) throw new Error(`Product 健康检查进程提前退出：${child.exitCode}`);
            try {
                const response = await fetch(`http://127.0.0.1:${port}/api/app/version`, {signal: AbortSignal.timeout(1_000)});
                if (response.ok) {
                    const value = await response.json() as {versionLabel?: string};
                    const expected = expectedVersion.startsWith("v") ? expectedVersion : `v${expectedVersion}`;
                    if (value.versionLabel !== expected) throw new Error(`Product 版本接口返回 ${value.versionLabel ?? "<missing>"}，期望 ${expected}。`);
                    return;
                }
                lastError = `HTTP ${response.status}`;
            } catch (error) {
                lastError = error instanceof Error ? error.message : String(error);
            }
            if (Date.now() >= nextProgressAt) {
                console.log(`Product健康检查仍在等待：${lastError}`);
                nextProgressAt = Date.now() + 10_000;
            }
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
        }
        throw new Error(`Product HTTP 健康检查超时：${lastError}`);
    } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill();
        if (!await waitForProcessExit(child, 5_000)) {
            child.kill("SIGKILL");
            if (!await waitForProcessExit(child, 5_000)) {
                throw new Error("Product 健康检查进程无法停止；请先结束该进程再重试更新。" );
            }
        }
    }
}

/** 读取 State Root 端口。 */
export async function statePort(stateRoot: string): Promise<number> {
    const env = await loadStateEnv(stateRoot);
    const port = Number(env.NUXT_PORT ?? env.PORT ?? "3000");
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`State Root 端口非法：${env.NUXT_PORT ?? env.PORT}`);
    return port;
}

async function portOpen(port: number): Promise<boolean> {
    return new Promise<boolean>((resolvePromise) => {
        const socket = createConnection({host: "127.0.0.1", port});
        const finish = (value: boolean): void => {
            socket.destroy();
            resolvePromise(value);
        };
        socket.setTimeout(500);
        socket.once("connect", () => finish(true));
        socket.once("timeout", () => finish(false));
        socket.once("error", () => finish(false));
    });
}

/** 等待临时健康检查进程完全退出，确保其已释放Attachment runtime lease。 */
async function waitForProcessExit(child: ReturnType<typeof spawn>, timeoutMs: number): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) return true;
    return new Promise<boolean>((resolvePromise) => {
        const finish = (exited: boolean): void => {
            clearTimeout(timer);
            child.off("exit", onExit);
            resolvePromise(exited);
        };
        const onExit = (): void => finish(true);
        const timer = setTimeout(() => finish(false), timeoutMs);
        child.once("exit", onExit);
    });
}
