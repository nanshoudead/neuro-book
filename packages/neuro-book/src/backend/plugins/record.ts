/**
 * 第三方插件的安装根与登记表（docs/specs/runtime/plugin-install.md 的“术语”“副作用与数据”）。
 *
 * 布局：`<State Root>/plugins/` 下有登记表 `plugins.json`、它的写入锁 `.plugins.json.lock`、准备中的复制
 * `.staging/<随机名>/`（各带自己的锁 `<随机名>.lock`），以及安装目录 `<插件 id>/<版本>/`。
 *
 * 同一状态根可以有多个服务端进程（docs/specs/runtime/projects.md 不加目录锁），所以登记表的读改写与版本目录的
 * 改名都在写入锁里做；锁是跨进程的（`nbook/backend/locked-replace` 的 `holdLock`）。只读的列表不取锁：登记表
 * 用临时文件改名替换，读者只会读到完整的旧表或新表。
 */

import {randomUUID} from "node:crypto";
import {mkdir, open, readFile, rename, unlink} from "node:fs/promises";
import {join} from "node:path";

import {Type} from "typebox";
import type {Static} from "typebox";
import {Value} from "typebox/value";

import {errno, holdLock} from "nbook/backend/locked-replace";
import type {HeldLock} from "nbook/backend/locked-replace";

export const RECORD_FILE = "plugins.json";
export const RECORD_SCHEMA = "nbook.plugins/v1";
export const STAGING_DIR = ".staging";
const LOCK_NAME = `.${RECORD_FILE}.lock`;

const EntrySchema = Type.Object({
    version: Type.String({minLength: 1}),
    /** 下一次启动要切换到的版本；没有为 null。 */
    pendingVersion: Type.Union([Type.String({minLength: 1}), Type.Null()]),
    state: Type.Union([Type.Literal("enabled"), Type.Literal("disabled"), Type.Literal("uninstalling")]),
    /** 卸载时是否同时删除私有数据；本轮不提供删除的选项，总是 false。 */
    deleteData: Type.Boolean(),
}, {additionalProperties: false});

const RecordSchema = Type.Object({
    schema: Type.Literal(RECORD_SCHEMA),
    plugins: Type.Record(Type.String(), EntrySchema),
}, {additionalProperties: false});

export type PluginRecord = Static<typeof RecordSchema>;
export type RecordEntry = PluginRecord["plugins"][string];

export const EMPTY_RECORD: PluginRecord = {schema: RECORD_SCHEMA, plugins: {}};

export type RecordRead = {readonly ok: true; readonly record: PluginRecord} | {readonly ok: false; readonly detail: string};

/** 读登记表：不存在视为空表；不是合法 JSON 或结构不符时整体不可用，调用方不得覆盖它。 */
export async function readRecord(root: string): Promise<RecordRead> {
    let text: string;
    try {
        text = await readFile(join(root, RECORD_FILE), "utf8");
    } catch (error) {
        if (errno(error) === "ENOENT") return {ok: true, record: EMPTY_RECORD};
        return {ok: false, detail: `读取插件登记表失败：${brief(error)}`};
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        return {ok: false, detail: "插件登记表不是合法 JSON"};
    }
    if (!Value.Check(RecordSchema, parsed)) {
        const first = [...Value.Errors(RecordSchema, parsed)][0];
        return {ok: false, detail: `插件登记表不符合 ${RECORD_SCHEMA}：${first === undefined ? "" : `${first.instancePath} ${first.message}`}`};
    }
    return {ok: true, record: parsed};
}

/** 原子替换登记表：写同目录的临时文件、落盘后改名。只在持有写入锁时调用。 */
export async function writeRecord(root: string, record: PluginRecord): Promise<void> {
    const temporary = join(root, `.${RECORD_FILE}.${randomUUID()}.tmp`);
    try {
        const handle = await open(temporary, "wx", 0o644);
        try {
            await handle.writeFile(`${JSON.stringify(record, null, 4)}\n`, "utf8");
            await handle.sync();
        } finally {
            await handle.close();
        }
        await rename(temporary, join(root, RECORD_FILE));
    } catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
    }
}

export type LockedResult<T> = {readonly ok: true; readonly value: T} | {readonly ok: false; readonly detail: string};

/**
 * 持写入锁执行 `task`。`task` 在提交（改名版本目录、写登记表）之前用 `lock.stillHeld()` 核对仍持有锁：锁被判为
 * 残留、被别的进程接管之后再提交会与接管者互相覆盖。
 */
export async function withRecordLock<T>(root: string, report: (event: string, error: unknown) => void, task: (lock: HeldLock) => Promise<T>): Promise<LockedResult<T>> {
    try {
        await mkdir(root, {recursive: true});
    } catch (error) {
        return {ok: false, detail: `无法创建插件目录：${brief(error)}`};
    }
    const held = await holdLock(join(root, LOCK_NAME), report);
    if (!held.ok) return {ok: false, detail: `插件登记表的写入锁：${held.detail}`};
    try {
        return {ok: true, value: await task(held.lock)};
    } finally {
        await held.lock.release();
    }
}

/**
 * 发给窗口的错误说明只带错误码（`EACCES`），不带 Node 错误原文里的路径与内部细节；完整错误由调用方记进诊断。
 */
export function brief(error: unknown): string {
    return errno(error) ?? (error instanceof Error ? error.name : "未知错误");
}

/** 列表与诊断按 id 排序，同一输入得到同一结果。 */
export function byId<T extends {readonly id: string}>(left: T, right: T): number {
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/** 写登记表时崩溃留下的临时文件；启动回收时删除。插件 id 不以 `.` 开头，安装根下以 `.` 开头的都不是插件目录。 */
export function isRecordTemporary(name: string): boolean {
    return name.startsWith(`.${RECORD_FILE}.`) && name.endsWith(".tmp");
}
