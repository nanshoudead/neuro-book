import {open} from "node:fs/promises";
import {dirname} from "node:path";

/**
 * 将文件目录项同步到磁盘。
 *
 * POSIX需要在create/rename后fsync父目录，才能把进程崩溃恢复提升到断电后的目录项保证。
 * Windows不支持用Node稳定打开目录句柄，文件handle sync与原子rename仍由调用方负责。
 */
export async function syncParentDirectories(...paths: string[]): Promise<void> {
    if (process.platform === "win32") {
        return;
    }
    for (const directory of new Set(paths.map((path) => dirname(path)))) {
        const handle = await open(directory, "r");
        try {
            await handle.sync();
        } finally {
            await handle.close();
        }
    }
}
