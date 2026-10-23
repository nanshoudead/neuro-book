/**
 * 运行中的服务端对它在用的插件版本持租约（docs/specs/runtime/plugin-install.md 的“副作用与数据”）。
 *
 * 同一状态根可以同时跑几个服务端（docs/specs/runtime/projects.md）。服务端启动时会切换待生效的版本、回收不再登记的
 * 版本目录与已卸载插件的目录；入口代码按需装载、文件端点按需读文件，所以别的服务端正在用的版本目录不能删，否则它下一次
 * 激活入口会找不到文件。
 *
 * 布局：`<plugins>/.pins/<随机名>.json` 列出这个服务端在用的 `插件 id@版本`；同名的 `<随机名>.lock` 是 proper-lockfile 的
 * 锁目录，进程活着时一直持有、按间隔刷新，进程退出时释放，崩溃后过了 `PIN_STALE_MS` 视为残留。回收的一方只看锁还活着的
 * 租约。
 *
 * 时序：租约在 `prepareInstalledPlugins` 持登记表写入锁时、回收完成之后写下（先取锁、再写列表），回收也在同一把锁里读租约，
 * 所以回收的一方要么看到完整的租约，要么在这个服务端定下集合之前就做完了。项目子进程由同一个服务端启动，用的是它的集合，
 * 不另持租约。
 */

import {randomUUID} from "node:crypto";
import {mkdir, readdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {check} from "proper-lockfile";
import {Type} from "typebox";
import {Value} from "typebox/value";

import {errno, holdLock} from "nbook/backend/locked-replace";
import type {HeldLock} from "nbook/backend/locked-replace";

export const PINS_DIR = ".pins";

const PinSchema = Type.Object({pid: Type.Integer(), versions: Type.Array(Type.String({minLength: 1}))});

/**
 * 租约锁多久不刷新算残留。比登记表锁（`LOCK_STALE_MS`，一次短操作）长得多，因为判错的代价不对称：把崩溃进程的租约当活的，
 * 只是晚几分钟回收；把活进程的当残留，会删掉它正在用的代码。进程被调试器暂停、机器休眠超过这个时长仍会被判为残留，那时
 * 换个名字重写租约（`pinVersions`）。
 */
export const PIN_STALE_MS = 5 * 60_000;

/** 一个服务端在用的版本；进程退出时 proper-lockfile 也会放下锁，`release` 让同一进程里先后起的宿主（测试）各自收口。 */
export interface VersionPin {
    release(): Promise<void>;
}

export function pinKey(id: string, version: string): string {
    return `${id}@${version}`;
}

/**
 * 为这些版本写下租约。`report` 在宿主的整个寿命里都可能被调用：锁在运行中失效（被别的服务端当作残留删掉）时，租约换个名字
 * 重写，集合不变；失效到重写之间别的服务端可能已经回收了这些目录，这里只能报告。
 *
 * 写列表失败时先放下刚取得的锁再抛出：留着锁而没有列表，回收的一方会一直把它当作“读不了、仍在使用”，什么都不回收。
 */
export async function pinVersions(root: string, versions: ReadonlyArray<{readonly id: string; readonly version: string}>, report: (event: string, error: unknown) => void): Promise<VersionPin | null> {
    const directory = join(root, PINS_DIR);
    await mkdir(directory, {recursive: true});
    const list = JSON.stringify({pid: process.pid, versions: versions.map(({id, version}) => pinKey(id, version))});
    let current: {readonly file: string; readonly lock: HeldLock} | null = null;
    let released = false;

    const write = async (): Promise<{readonly file: string; readonly lock: HeldLock} | null> => {
        const name = randomUUID();
        const held = await holdLock(join(directory, `${name}.lock`), (event, error) => {
            report(event, error);
            if (event === "lock.compromised") void renew();
        }, {stale: PIN_STALE_MS});
        if (!held.ok) {
            report("pins.lock-failed", new Error(held.detail));
            return null;
        }
        const file = join(directory, `${name}.json`);
        try {
            // 先写临时文件再改名：读租约的一方只会看到完整的列表或没有列表。
            await writeFile(`${file}.tmp`, list);
            await rename(`${file}.tmp`, file);
        } catch (error) {
            await held.lock.release();
            await rm(`${file}.tmp`, {force: true}).catch((cleanup: unknown) => report("pins.cleanup-failed", cleanup));
            throw error;
        }
        return {file, lock: held.lock};
    };

    const renew = async (): Promise<void> => {
        if (released) return;
        const lost = current;
        try {
            current = await write();
            if (current !== null) report("pins.renewed", new Error("租约的锁曾经失效，已换名重写；失效期间别的服务端可能回收了在用的版本"));
        } catch (error) {
            current = null;
            report("pins.renew-failed", error);
        }
        if (lost !== null) await rm(lost.file, {force: true}).catch((error: unknown) => report("pins.cleanup-failed", error));
    };

    current = await write();
    if (current === null) return null;
    return {
        release: async () => {
            released = true;
            const held = current;
            current = null;
            if (held === null) return;
            await rm(held.file, {force: true});
            await held.lock.release();
        },
    };
}

/**
 * 锁还活着的租约里的全部版本（`pinKey`）；顺手删掉残留的租约（锁已失效的列表、没有列表的锁）。只在持登记表写入锁时调用。
 * 读不了的租约按“还在用”处理：宁可这次不回收，也不删别人的文件。
 */
export async function livePins(root: string, warn: (event: string, message: string, data?: unknown, error?: unknown) => void): Promise<{readonly pinned: ReadonlySet<string>; readonly unreadable: boolean}> {
    const directory = join(root, PINS_DIR);
    let names: string[];
    try {
        names = await readdir(directory);
    } catch (error) {
        if (errno(error) === "ENOENT") return {pinned: new Set(), unreadable: false};
        warn("plugins.pins.unreadable", "读不了插件版本的租约，本次不回收任何版本目录", {path: directory}, error);
        return {pinned: new Set(), unreadable: true};
    }
    const pinned = new Set<string>();
    let unreadable = false;
    for (const name of names) {
        if (!name.endsWith(".lock")) continue;
        const base = name.slice(0, -".lock".length);
        const lockPath = join(directory, name);
        const listPath = join(directory, `${base}.json`);
        let alive: boolean;
        try {
            alive = await check(lockPath, {realpath: false, lockfilePath: lockPath, stale: PIN_STALE_MS});
        } catch (error) {
            warn("plugins.pins.unreadable", "核对插件版本租约的锁失败，按仍在使用处理", {path: lockPath}, error);
            unreadable = true;
            continue;
        }
        if (!alive) {
            await removeResidue(listPath, warn);
            await removeResidue(lockPath, warn);
            continue;
        }
        try {
            const value: unknown = JSON.parse(await readFile(listPath, "utf8"));
            if (!Value.Check(PinSchema, value)) throw new Error("租约的结构不对");
            for (const key of value.versions) pinned.add(key);
        } catch (error) {
            // 锁活着、列表还没写完或读不了：这个服务端正在启动，或者文件坏了。都按仍在使用处理。
            if (errno(error) !== "ENOENT") warn("plugins.pins.unreadable", "读不了插件版本的租约，按仍在使用处理", {path: listPath}, error);
            unreadable = true;
        }
    }
    // 没有锁的列表是崩溃留下的：锁目录已被别人当残留删掉了。
    for (const name of names) {
        if (name.endsWith(".json") && !names.includes(`${name.slice(0, -".json".length)}.lock`)) await removeResidue(join(directory, name), warn);
    }
    return {pinned, unreadable};
}

/** 删残留的租约文件；删不掉只是留着，下次再试，不影响这次回收的判断。 */
async function removeResidue(path: string, warn: (event: string, message: string, data?: unknown, error?: unknown) => void): Promise<void> {
    await rm(path, {recursive: true, force: true}).catch((error: unknown) => warn("plugins.pins.cleanup-failed", "删除残留的插件版本租约失败，下次再试", {path}, error));
}
