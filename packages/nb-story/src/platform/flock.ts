/**
 * 进程级的独占文件锁：`flock(LOCK_EX | LOCK_NB)`。拿到就一直持有，直到 release 或进程退出；进程怎么结束锁都会被
 * 内核放掉，所以没有“判旧再回收”的竞争。Node 没有 flock，这里经 bun:ffi 调 libc，只支持 Linux 与 macOS。
 *
 * 锁的是文件（inode）而不是路径名：锁文件一旦建好就不要删，删了再建是另一个 inode，新旧两把锁互不排他。
 */

import {dlopen, FFIType} from "bun:ffi";
import {closeSync, openSync} from "node:fs";

const LOCK_EX = 2;
const LOCK_NB = 4;

let flock: ((fd: number, operation: number) => number) | undefined;

function loadFlock(): (fd: number, operation: number) => number {
    if (flock) return flock;
    const library = process.platform === "darwin" ? "libSystem.B.dylib" : process.platform === "linux" ? "libc.so.6" : null;
    if (!library) throw new Error(`nbstory 不支持 ${process.platform}（独占锁要用 flock）`);
    const {symbols} = dlopen(library, {flock: {args: [FFIType.i32, FFIType.i32], returns: FFIType.i32}});
    flock = (fd, operation) => symbols.flock(fd, operation);
    return flock;
}

export interface FileLock {
    /** 关掉文件即放锁；之后这个对象不能再用，重复调用无事。 */
    release(): void;
}

/** 拿 `path` 上的锁（文件不存在就建）；已被别的持有者拿着时返回 null。同一进程里第二次拿同一个文件也拿不到。 */
export function tryLock(path: string): FileLock | null {
    const fd = openSync(path, "a");
    if (loadFlock()(fd, LOCK_EX | LOCK_NB) !== 0) {
        closeSync(fd);
        return null;
    }
    let released = false;
    return {
        release() {
            if (released) return;
            released = true;
            closeSync(fd);
        },
    };
}
