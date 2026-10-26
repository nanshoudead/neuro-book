/**
 * 进程级的独占文件锁。拿到就一直持有，直到 release 或进程退出；进程怎么结束锁都会被操作系统放掉，所以没有“判旧再
 * 回收”的竞争。Node 没有文件锁，这里经 bun:ffi 调系统接口：
 *
 * - Linux 与 macOS：libc 的 `flock(LOCK_EX | LOCK_NB)`；
 * - Windows：kernel32 的 `CreateFileW` 打开（允许别人读写删，只靠锁排他）再 `LockFileEx` 锁第一个字节
 *   （`LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY`）。锁跟着句柄走，同一进程用另一个句柄也拿不到。
 *
 * 锁的是文件（inode）而不是路径名：锁文件一旦建好就不要删，删了再建是另一个文件，新旧两把锁互不排他。
 */

import {dlopen, FFIType, ptr} from "bun:ffi";
import {closeSync, openSync} from "node:fs";

export interface FileLock {
    /** 关掉文件即放锁；之后这个对象不能再用，重复调用无事。 */
    release(): void;
}

/** 拿 `path` 上的锁（文件不存在就建）；已被别的持有者拿着时返回 null。同一进程里第二次拿同一个文件也拿不到。 */
export function tryLock(path: string): FileLock | null {
    return process.platform === "win32" ? tryLockWindows(path) : tryLockPosix(path);
}

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

function tryLockPosix(path: string): FileLock | null {
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

// Win32 常量。访问权限要按无符号数传：JS 的 `|` 得到有符号 32 位整数，`0x80000000 | 0x40000000` 是负数，
// 传进 u32 参数后 CreateFileW 拿到的权限不对，之后 LockFileEx 报 ERROR_ACCESS_DENIED（在 pc-notype 上实测）。
const GENERIC_READ_WRITE = (0x80000000 | 0x40000000) >>> 0;
const FILE_SHARE_READ_WRITE_DELETE = 0x1 | 0x2 | 0x4;
const OPEN_ALWAYS = 4;
const FILE_ATTRIBUTE_NORMAL = 0x80;
const LOCKFILE_FAIL_IMMEDIATELY = 0x1;
const LOCKFILE_EXCLUSIVE_LOCK = 0x2;
const INVALID_HANDLE_VALUE = -1n;
/** 别的句柄已锁住这一段（`ERROR_LOCK_VIOLATION`）；其它错误码不是“被占用”，照实报出。 */
const ERROR_LOCK_VIOLATION = 33;
/** x64 上 OVERLAPPED 的大小；全零表示从文件开头锁。 */
const OVERLAPPED_SIZE = 32;

type Kernel32 = {
    CreateFileW(name: ReturnType<typeof ptr>, access: number, share: number, security: null, disposition: number, flags: number, template: null): bigint;
    LockFileEx(handle: bigint, flags: number, reserved: number, low: number, high: number, overlapped: ReturnType<typeof ptr>): number;
    CloseHandle(handle: bigint): number;
    GetLastError(): number;
};

let kernel32: Kernel32 | undefined;

function loadKernel32(): Kernel32 {
    if (kernel32) return kernel32;
    const {symbols} = dlopen("kernel32.dll", {
        CreateFileW: {args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr], returns: FFIType.i64},
        LockFileEx: {args: [FFIType.i64, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.ptr], returns: FFIType.i32},
        CloseHandle: {args: [FFIType.i64], returns: FFIType.i32},
        GetLastError: {args: [], returns: FFIType.u32},
    });
    kernel32 = symbols as unknown as Kernel32;
    return kernel32;
}

function tryLockWindows(path: string): FileLock | null {
    const api = loadKernel32();
    const name = Buffer.from(`${path}\0`, "utf16le");
    const handle = api.CreateFileW(ptr(name), GENERIC_READ_WRITE, FILE_SHARE_READ_WRITE_DELETE, null, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, null);
    if (handle === INVALID_HANDLE_VALUE) throw new Error(`打不开锁文件 ${path}（Win32 错误 ${api.GetLastError()}）`);
    const overlapped = new Uint8Array(OVERLAPPED_SIZE);
    if (api.LockFileEx(handle, LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, ptr(overlapped)) === 0) {
        const code = api.GetLastError();
        api.CloseHandle(handle);
        if (code === ERROR_LOCK_VIOLATION) return null;
        throw new Error(`锁不上 ${path}（Win32 错误 ${code}）`);
    }
    let released = false;
    return {
        release() {
            if (released) return;
            released = true;
            api.CloseHandle(handle);
        },
    };
}
