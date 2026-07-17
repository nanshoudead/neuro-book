import {mkdtempSync} from "node:fs";
import {rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterAll} from "vitest";

/** Agent测试进程的日志必须隔离，不能通过默认cwd写入仓库Workspace Root。 */
const testLogRoot = mkdtempSync(join(tmpdir(), "neuro-book-vitest-logs-"));
const previousLogRoot = process.env.NEURO_BOOK_LOG_DIR;
process.env.NEURO_BOOK_LOG_DIR = testLogRoot;

afterAll(async () => {
    // 动态导入确保环境变量先于全局appLogger实例化；flush后再删除，避免异步写入重建目录。
    const {appLogger} = await import("nbook/server/app-logs/logger");
    await appLogger.flush();
    await rm(testLogRoot, {recursive: true, force: true});
    if (previousLogRoot === undefined) {
        delete process.env.NEURO_BOOK_LOG_DIR;
    } else {
        process.env.NEURO_BOOK_LOG_DIR = previousLogRoot;
    }
});
