/**
 * 服务端启动时确定本次运行的第三方插件集合（docs/specs/runtime/plugin-install.md 的提交点表与“失败与恢复”）。
 *
 * 宿主在装配插件之前调用一次 `prepareInstalledPlugins`，得到的集合在进程生命期内不变：项目子进程与浏览器引导都用它，
 * 不再自己读登记表，所以同一次运行中后来打开的作品与窗口看到的集合相同。
 *
 * 持登记表的写入锁按顺序做三件事：先按登记表完成卸载中的删除与待切换版本的切换（切换的提交点是登记表改指新版本），
 * 再回收没有被 `version` 或 `pendingVersion` 引用的版本目录与 `.staging` 残留。别的进程正在准备的复制带着自己的锁，
 * 回收时跳过。删除失败只记诊断，下次启动重试。登记表读不了时不加载任何第三方插件，也不动任何文件：不知道哪些目录
 * 还被引用。拿不到锁时（别的进程长时间占着）只读不改。
 */

import {lstat, readdir, readFile, rm, unlink} from "node:fs/promises";
import {join} from "node:path";

import type {DiagnosticInput} from "@notnotype/nb-runtime/diagnostics";
import {descriptorOf, readPluginManifest} from "@notnotype/nb-runtime/plugin-manifest";
import type {PluginManifest} from "@notnotype/nb-runtime/plugin-manifest";
import type {PluginDescriptor} from "@notnotype/nb-runtime/plugins";
import {check} from "proper-lockfile";

import {errno, LOCK_STALE_MS} from "nbook/backend/locked-replace";
import type {HeldLock} from "nbook/backend/locked-replace";
import type {NotLoaded} from "nbook/plugins/plugins/shared/contracts";

import {assertHeld, brief, byId, isRecordTemporary, ownedPath, readRecord, STAGING_DIR, withRecordLock, writeRecord} from "./record";
import type {PluginRecord, RecordEntry} from "./record";
import {engineAccepts, npmVersions} from "./versions";

/** 清单文件的大小上限；正常的 `package.json` 远小于它。 */
export const MANIFEST_LIMIT = 1024 * 1024;

/** 本次启动时一个第三方插件的情况。 */
export interface StartupPlugin {
    readonly id: string;
    readonly version: string;
    readonly state: RecordEntry["state"];
    /** 登记了的插件的描述；禁用、卸载中、没有登记的为 null。 */
    readonly descriptor: PluginDescriptor | null;
    /** 没有登记（或只登记了顶层声明）的原因。 */
    readonly notLoaded: NotLoaded | null;
}

export interface StartupPlugins {
    readonly safeMode: boolean;
    /** 登记表读不了时的说明；此时没有第三方插件。 */
    readonly registryProblem: string | null;
    /** 登记表里的每个插件，按 id 排序。 */
    readonly plugins: ReadonlyArray<StartupPlugin>;
}

/** 安全模式的开关（plugin-install 的“输入与前置条件”）：值为 `1` 时本次启动不加载任何第三方插件。 */
export const SAFE_MODE_ENV = "NEURO_BOOK_SAFE_MODE";

export function safeModeOf(env: Readonly<Record<string, string | undefined>>): boolean {
    return env[SAFE_MODE_ENV] === "1";
}

/** 测试与不读安装目录的宿主用：没有第三方插件。 */
export const NO_INSTALLED_PLUGINS: StartupPlugins = {safeMode: false, registryProblem: null, plugins: []};

/** 本次运行登记的第三方插件描述。 */
export function loadedDescriptors(startup: StartupPlugins): PluginDescriptor[] {
    return startup.plugins.flatMap((plugin) => (plugin.descriptor === null ? [] : [plugin.descriptor]));
}

export interface PrepareOptions {
    /** `<State Root>/plugins`。 */
    readonly root: string;
    readonly productVersion: string;
    readonly safeMode: boolean;
}

export interface PreparedPlugins {
    readonly startup: StartupPlugins;
    /** 宿主的诊断存储建立之后再记的记录（准备在它之前进行）。 */
    readonly diagnostics: ReadonlyArray<DiagnosticInput>;
}

export async function prepareInstalledPlugins(options: PrepareOptions): Promise<PreparedPlugins> {
    const diagnostics: DiagnosticInput[] = [];
    const warn = (event: string, message: string, data?: unknown, error?: unknown): void => {
        diagnostics.push({level: "warn", event, message, ...(data === undefined ? {} : {data}), ...(error === undefined ? {} : {error})});
    };
    const info = (event: string, message: string, data: unknown): void => {
        diagnostics.push({level: "info", event, message, data});
    };

    const applied = await withRecordLock(options.root, (event, error) => warn(`plugins.${event}`, "插件登记表的写入锁出错", undefined, error), async (lock) => {
        const read = await readRecord(options.root);
        if (!read.ok) return read;
        const record = await applyPending(options.root, read.record, lock, info, warn);
        await reclaim(options.root, record, lock, warn).catch((error: unknown) => warn("plugins.cleanup.failed", "回收插件目录的残留没有完成，下次启动重试", undefined, error));
        return {ok: true as const, record};
    });
    let record: PluginRecord;
    if (applied.ok) {
        if (!applied.value.ok) return failed(options, applied.value.detail, diagnostics, warn);
        record = applied.value.record;
    } else {
        warn("plugins.startup.unlocked", "拿不到插件登记表的写入锁，本次启动不处理待生效变化、不回收残留", {detail: applied.detail});
        const read = await readRecord(options.root);
        if (!read.ok) return failed(options, read.detail, diagnostics, warn);
        record = read.record;
    }

    const plugins: StartupPlugin[] = [];
    for (const [id, entry] of Object.entries(record.plugins)) {
        const plugin = await startupPlugin(options, id, entry);
        if (plugin.notLoaded !== null && plugin.notLoaded.code !== "safe-mode") {
            warn("plugins.startup.not-loaded", `第三方插件 ${id}@${entry.version} 没有完整登记`, {id, version: entry.version, ...plugin.notLoaded});
        }
        plugins.push(plugin);
    }
    return {startup: {safeMode: options.safeMode, registryProblem: null, plugins: plugins.sort(byId)}, diagnostics};
}

function failed(options: PrepareOptions, detail: string, diagnostics: DiagnosticInput[], warn: (event: string, message: string, data?: unknown) => void): PreparedPlugins {
    warn("plugins.registry.invalid", "插件登记表不可用，本次启动不加载任何第三方插件", {detail});
    return {startup: {safeMode: options.safeMode, registryProblem: detail, plugins: []}, diagnostics};
}

/**
 * 完成卸载中的删除与待切换版本的切换，返回提交后的登记表。登记表写不进去（或中途失去了锁）时返回原表：切换没有
 * 提交，本次仍按旧版本；已删除的卸载目录在下次启动时再确认并移除记录。每次删除之前核对仍持有锁。
 */
async function applyPending(
    root: string,
    record: PluginRecord,
    lock: HeldLock,
    info: (event: string, message: string, data: unknown) => void,
    warn: (event: string, message: string, data?: unknown, error?: unknown) => void,
): Promise<PluginRecord> {
    const plugins: Record<string, RecordEntry> = {...record.plugins};
    const done: Array<() => void> = [];
    try {
        for (const [id, entry] of Object.entries(record.plugins)) {
            if (entry.state === "uninstalling") {
                await assertHeld(lock);
                try {
                    // 私有数据的删除（`deleteData`）本轮没有入口，总是保留。
                    await rm(ownedPath(root, id), {recursive: true, force: true});
                } catch (error) {
                    warn("plugins.uninstall.failed", `删除 ${id} 的安装目录失败，下次启动重试`, {id}, error);
                    continue;
                }
                delete plugins[id];
                done.push(() => info("plugins.uninstall.completed", `已卸载 ${id}`, {id, version: entry.version}));
            } else if (entry.pendingVersion !== null) {
                plugins[id] = {...entry, version: entry.pendingVersion, pendingVersion: null};
                done.push(() => info("plugins.upgrade.switched", `${id} 已切换到 ${entry.pendingVersion}`, {id, from: entry.version, to: entry.pendingVersion}));
            }
        }
        if (done.length === 0) return record;
        await writeRecord(root, {...record, plugins}, lock);
    } catch (error) {
        warn("plugins.startup.commit-failed", "处理待生效变化没有完成，留到下次启动", undefined, error);
        // 卸载中的插件本次照样不加载：它们的目录可能已经删了。
        return record;
    }
    for (const report of done) report();
    return {...record, plugins};
}

/** 回收没有被引用的版本目录、没有记录的插件目录、写登记表留下的临时文件与没有持锁的准备目录。 */
async function reclaim(root: string, record: PluginRecord, lock: HeldLock, warn: (event: string, message: string, data?: unknown, error?: unknown) => void): Promise<void> {
    // 失去锁时 `assertHeld` 抛出，整个回收停下：手里的登记表可能已经过时。
    const remove = async (path: string, recursive: boolean): Promise<void> => {
        await assertHeld(lock);
        try {
            if (recursive) await rm(path, {recursive: true, force: true});
            else await unlink(path);
        } catch (error) {
            warn("plugins.cleanup.failed", "回收插件目录的残留失败，下次启动重试", {path}, error);
        }
    };
    for (const {name, directory} of await entriesIn(root)) {
        if (isRecordTemporary(name)) {
            await remove(join(root, name), false);
            continue;
        }
        // 插件目录都是以 id 命名的目录；登记表、它的锁、准备目录与别的文件都不是。
        if (!directory || name.startsWith(".")) continue;
        const entry = record.plugins[name];
        if (entry === undefined) {
            await remove(ownedPath(root, name), true);
            continue;
        }
        // 卸载中的目录由下一次成功的卸载删除；它的版本都还算被引用。
        if (entry.state === "uninstalling") continue;
        for (const version of await namesIn(join(root, name))) {
            if (version !== entry.version && version !== entry.pendingVersion) await remove(ownedPath(root, name, version), true);
        }
    }
    const staging = join(root, STAGING_DIR);
    for (const name of await namesIn(staging)) {
        if (name.endsWith(".lock")) continue;
        const lockPath = join(staging, `${name}.lock`);
        let held: boolean;
        try {
            held = await check(lockPath, {realpath: false, lockfilePath: lockPath, stale: LOCK_STALE_MS});
        } catch (error) {
            warn("plugins.cleanup.failed", "核对准备目录的锁失败，跳过", {path: join(staging, name)}, error);
            continue;
        }
        if (!held) await remove(ownedPath(root, STAGING_DIR, name), true);
    }
}

async function namesIn(directory: string): Promise<string[]> {
    return (await entriesIn(directory)).map((entry) => entry.name);
}

async function entriesIn(directory: string): Promise<Array<{readonly name: string; readonly directory: boolean}>> {
    try {
        return (await readdir(directory, {withFileTypes: true})).map((entry) => ({name: entry.name, directory: entry.isDirectory()}));
    } catch (error) {
        if (errno(error) === "ENOENT" || errno(error) === "ENOTDIR") return [];
        throw error;
    }
}

/** 一个已安装插件在本次启动的情况：读清单、核对与登记表一致、兼容、入口文件都在。 */
async function startupPlugin(options: PrepareOptions, id: string, entry: RecordEntry): Promise<StartupPlugin> {
    const base = {id, version: entry.version, state: entry.state};
    if (entry.state !== "enabled") return {...base, descriptor: null, notLoaded: null};
    if (options.safeMode) return {...base, descriptor: null, notLoaded: {code: "safe-mode", detail: "安全模式下不加载第三方插件"}};
    const read = await installedManifest(join(options.root, id, entry.version));
    if (!read.ok) return {...base, descriptor: null, notLoaded: {code: "manifest-invalid", detail: read.detail}};
    const {manifest} = read;
    if (manifest.id !== id || manifest.version !== entry.version) {
        return {...base, descriptor: null, notLoaded: {code: "manifest-invalid", detail: `清单声明的是 ${manifest.id}@${manifest.version}`}};
    }
    if (!engineAccepts(options.productVersion, manifest.engines.neurobook)) {
        return {...base, descriptor: null, notLoaded: {code: "incompatible-engine", detail: `要求 NeuroBook ${manifest.engines.neurobook}，当前是 ${options.productVersion}`}};
    }
    const missing = await missingEntries(join(options.root, id, entry.version), manifest);
    if (missing.length > 0) return {...base, descriptor: null, notLoaded: {code: "manifest-invalid", detail: `入口文件不存在：${missing.join("、")}`}};
    // 入口代码的装载还没有实现（plugin-code-loading）：本次只登记顶层声明。
    const notLoaded: NotLoaded | null = manifest.entries.length === 0 ? null : {code: "entries-not-loaded", detail: "入口代码的装载尚未实现，本次只登记顶层声明"};
    return {...base, descriptor: descriptorOf(manifest), notLoaded};
}

export type ManifestFileRead =
    | {readonly ok: true; readonly raw: unknown; readonly manifest: PluginManifest}
    /** `raw` 是能解析出来时的 JSON，调用方据此给出比“清单无效”更具体的原因。 */
    | {readonly ok: false; readonly code: "manifest-invalid" | "path-rejected"; readonly detail: string; readonly problems?: ReadonlyArray<string>; readonly raw?: unknown};

/** 读插件文件夹根上的 `package.json` 并按第三方插件的规则校验清单；`package.json` 本身是符号链接时拒绝。 */
export async function installedManifest(directory: string): Promise<ManifestFileRead> {
    const file = join(directory, "package.json");
    let text: string;
    try {
        const info = await lstat(file);
        if (info.isSymbolicLink()) return {ok: false, code: "path-rejected", detail: "package.json 是符号链接"};
        if (!info.isFile()) return {ok: false, code: "manifest-invalid", detail: "插件文件夹根上没有 package.json"};
        if (info.size > MANIFEST_LIMIT) return {ok: false, code: "manifest-invalid", detail: `package.json 超过 ${String(MANIFEST_LIMIT)} 字节`};
        text = await readFile(file, "utf8");
    } catch (error) {
        return {ok: false, code: "manifest-invalid", detail: errno(error) === "ENOENT" ? "插件文件夹根上没有 package.json" : `读取 package.json 失败：${brief(error)}`};
    }
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return {ok: false, code: "manifest-invalid", detail: "package.json 不是合法 JSON"};
    }
    const read = readPluginManifest(raw, {versions: npmVersions});
    if (read.status !== "valid") {
        return {ok: false, code: "manifest-invalid", detail: "清单不符合 runtime.plugin-manifest", problems: read.problems.map((problem) => `${problem.path === "" ? "（根）" : problem.path}：${problem.message}`), raw};
    }
    return {ok: true, raw, manifest: read.manifest};
}

/** 清单里入口文件不是普通文件的那些 `main`。 */
export async function missingEntries(directory: string, manifest: PluginManifest): Promise<string[]> {
    const missing: string[] = [];
    for (const entry of manifest.entries) {
        try {
            if (!(await lstat(join(directory, entry.main))).isFile()) missing.push(entry.main);
        } catch {
            missing.push(entry.main);
        }
    }
    return missing;
}
