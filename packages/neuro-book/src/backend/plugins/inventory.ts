/**
 * 插件管理的操作：列表、安装（含升级）、启用、禁用、卸载（docs/specs/runtime/plugin-install.md 输出 1–4、8、9）。
 *
 * 所有操作只写登记表与安装目录，在下一次启动生效；本次运行的插件集合是启动时确定的 `StartupPlugins`，列表拿它与
 * 登记表比较得出待生效变化。
 *
 * 安装先在 `.staging/<随机名>/` 里复制与核对（持这个准备目录自己的锁，别的进程启动回收时跳过它），再持登记表的写入锁
 * 重新核对、把准备目录改名为 `<id>/<版本>/`、写登记表：写登记表就是提交点。提交前任何失败都删掉准备目录与已改名的
 * 版本目录；替换待切换版本时，提交之后、仍持锁时删除被取代的版本目录（删不掉的留给下次启动回收）。
 */

import {randomUUID} from "node:crypto";
import {mkdir, realpath, rename, rm, stat} from "node:fs/promises";
import {join, relative, resolve, isAbsolute} from "node:path";

import type {DiagnosticInput} from "@notnotype/nb-runtime/diagnostics";
import type {PluginManifest} from "@notnotype/nb-runtime/plugin-manifest";
import {previewBlocked} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

import {holdLock} from "nbook/backend/locked-replace";
import type {BlockedPlugin, InstallPreview, PendingChange, PluginFailureCode, PluginList, PluginListItem} from "nbook/plugins/plugins/shared/contracts";
import {compareVersions, engineAccepts, pluginVersionSatisfies} from "nbook/shared/versions";

import {collectCopyRange, copyRange} from "./copy";
import {assertHeld, brief, byId, isLink, LockLost, ownedPath, readRecord, STAGING_DIR, withRecordLock, writeRecord} from "./record";
import type {PluginRecord, RecordEntry} from "./record";
import {installedManifest, missingEntries} from "./startup";
import type {StartupPlugins} from "./startup";

export type InventoryFailure = {readonly ok: false; readonly code: PluginFailureCode; readonly detail: string; readonly problems?: ReadonlyArray<string>};
export type InventoryResult<T> = {readonly ok: true; readonly value: T} | InventoryFailure;

export interface PluginInventory {
    list(): Promise<InventoryResult<PluginList>>;
    /** 只读：安装这个文件夹会是首次安装、升级还是降级；校验与 `install` 相同，但不复制、不写登记表。 */
    inspect(sourcePath: string): Promise<InventoryResult<InstallPreview>>;
    /** `sourcePath` 是服务端本地的插件文件夹；已安装另一版本时按升级处理。 */
    install(sourcePath: string): Promise<InventoryResult<PluginListItem>>;
    setEnabled(id: string, enabled: boolean): Promise<InventoryResult<PluginListItem>>;
    uninstall(id: string): Promise<InventoryResult<PluginListItem>>;
}

/** 服务端宿主提供（host 能力 `host.plugin-inventory`），`nbook.plugins` 的服务端入口经它实现远程服务。 */
export const pluginInventoryKey: ServiceKey<PluginInventory> = defineServiceKey<PluginInventory>("nbook/plugin-inventory");

export interface PluginInventoryOptions {
    /** `<State Root>/plugins`。 */
    readonly root: string;
    readonly productVersion: string;
    /** 本进程装配的内置插件；列表里标为内置，启停与卸载被拒绝。 */
    readonly builtin: ReadonlyArray<{readonly id: string; readonly version: string}>;
    readonly startup: StartupPlugins;
    readonly record: (input: DiagnosticInput) => void;
}

/** `prepare` 核对通过的安装源。 */
interface Prepared {
    readonly source: string;
    readonly manifest: PluginManifest;
    readonly raw: unknown;
    readonly files: ReadonlyArray<string> | null;
    /** 已安装的当前版本；没有安装为 null。 */
    readonly installed: string | null;
}

function failure(code: PluginFailureCode, detail: string, problems?: ReadonlyArray<string>): InventoryFailure {
    return {ok: false, code, detail, ...(problems === undefined ? {} : {problems})};
}

/** `inner` 等于 `outer` 或在它里面。两者都必须是真实路径。 */
function within(inner: string, outer: string): boolean {
    const path = relative(outer, inner);
    return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

/** 已安装的记录不接受这次安装的原因；没有为 null。 */
function conflict(entry: RecordEntry | undefined, id: string, version: string): InventoryFailure | null {
    if (entry === undefined) return null;
    if (entry.state === "uninstalling") return failure("uninstall-pending", `${id} 正在卸载，重启后再安装`);
    if (entry.version === version || entry.pendingVersion === version) return failure("already-installed", `${id}@${version} 已安装或等待重启后切换`);
    return null;
}

export function createPluginInventory(options: PluginInventoryOptions): PluginInventory {
    const root = resolve(options.root);
    const startupOf = new Map(options.startup.plugins.map((plugin) => [plugin.id, plugin]));
    const isBuiltin = (id: string): boolean => id.startsWith("nbook.") || options.builtin.some((plugin) => plugin.id === id);
    const reportLock = (event: string, error: unknown): void => {
        options.record({level: "warn", event: `plugins.${event}`, message: "插件登记表的写入锁出错", error});
    };
    // 同一进程内的操作串行，结果按请求顺序；跨进程的互斥靠登记表的写入锁。
    let queue: Promise<unknown> = Promise.resolve();
    const serial = <T>(task: () => Promise<T>): Promise<T> => {
        const next = queue.then(task, task);
        queue = next.catch(() => undefined);
        return next;
    };

    /**
     * 一个第三方插件的列表项：登记表是目标状态，本次启动的集合是本进程实际运行的状态，待生效变化是两者之差
     * （plugin-install 输出 9）。同一状态根的另一个服务端启动时会消费掉待切换版本与卸载记录，所以版本也按两者比较，
     * 不只看 `pendingVersion`。
     */
    function itemOf(id: string, entry: RecordEntry | undefined): PluginListItem {
        const atStartup = startupOf.get(id);
        const running = atStartup === undefined || atStartup.state === "uninstalling" ? null : atStartup;
        const pending: PendingChange[] = [];
        if (entry === undefined || entry.state === "uninstalling") {
            pending.push({kind: "uninstall"});
        } else {
            if (running === null) pending.push({kind: "install"});
            const target = entry.pendingVersion ?? entry.version;
            if (running !== null && target !== running.version) pending.push({kind: "upgrade", version: target});
            const before = running?.state ?? "enabled";
            if (before !== entry.state) pending.push({kind: entry.state === "enabled" ? "enable" : "disable"});
        }
        // 本次没有运行的插件，行上的版本是重启后要装上的版本。
        const version = running?.version ?? (entry === undefined ? atStartup?.version : entry.pendingVersion ?? entry.version) ?? "";
        return {
            id,
            version,
            source: "third-party",
            state: entry?.state ?? "uninstalling",
            pending,
            notLoaded: atStartup?.notLoaded ?? null,
        };
    }

    /** 持写入锁读改写登记表；`change` 返回 null 表示不用写。 */
    async function update(change: (record: PluginRecord) => InventoryResult<RecordEntry | null>, id: string): Promise<InventoryResult<PluginListItem>> {
        const locked = await withRecordLock(root, reportLock, async (lock): Promise<InventoryResult<PluginListItem>> => {
            const read = await readRecord(root);
            if (!read.ok) return failure("registry-failed", read.detail);
            const changed = change(read.record);
            if (!changed.ok) return changed;
            if (changed.value === null) return {ok: true, value: itemOf(id, read.record.plugins[id])};
            try {
                await writeRecord(root, {...read.record, plugins: {...read.record.plugins, [id]: changed.value}}, lock);
            } catch (error) {
                options.record({level: "error", event: "plugins.registry.write-failed", message: "写入插件登记表失败", data: {id}, error});
                return failure("registry-failed", `写入插件登记表失败：${brief(error)}`);
            }
            return {ok: true, value: itemOf(id, changed.value)};
        });
        return locked.ok ? locked.value : failure("registry-failed", locked.detail);
    }

    /** 安装前的核对，`inspect` 与 `install` 共用：源路径、清单、兼容、`files` 写法与登记表里的冲突。 */
    async function prepare(sourcePath: string): Promise<InventoryResult<Prepared>> {
        let source: string;
        try {
            source = await realpath(resolve(sourcePath));
            if (!(await stat(source)).isDirectory()) return failure("path-rejected", "安装源不是文件夹");
        } catch (error) {
            return failure("path-rejected", `安装源不存在或不可读：${brief(error)}`);
        }
        let realRoot: string;
        try {
            await mkdir(root, {recursive: true});
            realRoot = await realpath(root);
        } catch (error) {
            return failure("copy-failed", `无法创建插件目录：${brief(error)}`);
        }
        // 两个方向都拒绝：源在安装根里会把已安装的插件当安装源，安装根在源里会把准备目录复制进自己。
        if (within(source, realRoot) || within(realRoot, source)) return failure("path-rejected", "安装源不能与插件目录互相包含");

        const read = await installedManifest(source);
        if (!read.ok) {
            // 保留的出版者单独给出原因，先于清单的其余问题。
            if (publisherOf(read.raw) === "nbook") return failure("reserved-id", "第三方插件的 id 不能以 nbook. 开头");
            return failure(read.code, read.detail, read.problems);
        }
        const {manifest, raw} = read;
        if (!engineAccepts(options.productVersion, manifest.engines.neurobook)) {
            return failure("incompatible-engine", `插件要求 NeuroBook ${manifest.engines.neurobook}，当前是 ${options.productVersion}`);
        }
        const files = filesOf(raw);
        if (files === undefined) return failure("manifest-invalid", "package.json 的 files 必须是字符串数组", ["files：必须是字符串数组"]);

        // 不持锁的核对：免得白复制，也让确认界面先知道结果；提交时持锁再核对。
        const record = await readRecord(root);
        if (!record.ok) return failure("registry-failed", record.detail);
        const existing = record.record.plugins[manifest.id];
        const early = conflict(existing, manifest.id, manifest.version);
        if (early !== null) return early;
        return {ok: true, value: {source, manifest, raw, files, installed: existing?.version ?? null}};
    }

    async function inspect(sourcePath: string): Promise<InventoryResult<InstallPreview>> {
        const prepared = await prepare(sourcePath);
        if (!prepared.ok) return prepared;
        const {manifest, installed} = prepared.value;
        const relation = installed === null ? "install" : compareVersions(manifest.version, installed) > 0 ? "upgrade" : "downgrade";
        const preview = relation === "install" ? {blocked: [], unchecked: []} : await blockedAfter(manifest);
        return {ok: true, value: {id: manifest.id, version: manifest.version, installed, relation, ...preview}};
    }

    /**
     * 把 `next` 换进重启后生效的集合（启用的插件，有待切换版本的取那个版本），用内核的同一份推导与同一个 `satisfies`，
     * 列出比换之前多出来的受阻入口。读不了清单的插件不参与，列进 `unchecked`，预览照常给出。
     */
    async function blockedAfter(next: PluginManifest): Promise<{readonly blocked: BlockedPlugin[]; readonly unchecked: string[]}> {
        const record = await readRecord(root);
        if (!record.ok) return {blocked: [], unchecked: []};
        const current: PluginManifest[] = [];
        const unchecked: string[] = [];
        for (const [id, entry] of Object.entries(record.record.plugins)) {
            if (entry.state !== "enabled") continue;
            const read = await installedManifest(join(root, id, entry.pendingVersion ?? entry.version));
            if (read.ok) current.push(read.manifest);
            else if (id !== next.id) unchecked.push(id);
        }
        const after = [...current.filter((item) => item.id !== next.id), next];
        const locations = [...new Set([...current, next].flatMap((item) => item.entries.map((entry) => entry.location)))];
        const byPlugin = new Map<string, BlockedPlugin>();
        for (const location of locations) {
            const before = previewBlocked(current.map(previewDefinition), location, pluginVersionSatisfies);
            for (const [key, blocked] of previewBlocked(after.map(previewDefinition), location, pluginVersionSatisfies)) {
                if (blocked === null || (before.get(key) ?? null) !== null) continue;
                const [plugin, entry] = splitEntry(key);
                const known = byPlugin.get(plugin);
                const range = blocked.reason === "version-mismatch" ? blocked.range : undefined;
                const reason = blocked.reason === "version-mismatch" ? "version-mismatch" : "provider-blocked";
                if (known === undefined) byPlugin.set(plugin, {plugin, entries: [entry], reason, ...(range === undefined ? {} : {range})});
                else byPlugin.set(plugin, {...known, entries: [...known.entries, entry], ...(known.reason === "provider-blocked" && reason === "version-mismatch" ? {reason, ...(range === undefined ? {} : {range})} : {})});
            }
        }
        return {blocked: [...byPlugin.values()].sort((left, right) => (left.plugin < right.plugin ? -1 : 1)), unchecked: unchecked.sort()};
    }

    async function install(sourcePath: string): Promise<InventoryResult<PluginListItem>> {
        const prepared = await prepare(sourcePath);
        if (!prepared.ok) return prepared;
        const {source, manifest, raw, files} = prepared.value;

        const staging = join(root, STAGING_DIR, randomUUID());
        try {
            await mkdir(join(root, STAGING_DIR), {recursive: true});
        } catch (error) {
            return failure("copy-failed", `无法创建准备目录：${brief(error)}`);
        }
        const stagingLock = await holdLock(`${staging}.lock`, reportLock);
        if (!stagingLock.ok) return failure("copy-failed", `无法锁定准备目录：${stagingLock.detail}`);
        try {
            await mkdir(staging);
            const range = await collectCopyRange(source, files, raw);
            if (!range.ok) return failure(range.code, range.detail);
            const copied = await copyRange(source, staging, range.files);
            if (!copied.ok) return failure(copied.code, copied.detail);
            const missing = await missingEntries(staging, manifest);
            if (missing.length > 0) return failure("entry-missing", `复制范围里缺少入口文件：${missing.join("、")}`, missing);
            return await commit(manifest.id, manifest.version, staging);
        } catch (error) {
            options.record({level: "error", event: "plugins.install.failed", message: `安装 ${manifest.id}@${manifest.version} 失败`, error});
            return failure("copy-failed", `安装失败：${brief(error)}`);
        } finally {
            await rm(staging, {recursive: true, force: true}).catch((error: unknown) => {
                options.record({level: "warn", event: "plugins.cleanup.failed", message: "删除准备目录失败，下次启动回收", data: {path: staging}, error});
            });
            await stagingLock.lock.release();
        }
    }

    /**
     * 持锁提交：再核对一次、改名进安装目录、写登记表，提交之后在同一把锁里删除被取代的待切换版本。每一步删改之前核对仍
     * 持有锁；失去锁之后什么都不再删：接管者可能已经提交了同名目录，留下的残留由下次启动的回收处理。
     */
    async function commit(id: string, version: string, staging: string): Promise<InventoryResult<PluginListItem>> {
        const locked = await withRecordLock(root, reportLock, async (lock): Promise<InventoryResult<PluginListItem>> => {
            const read = await readRecord(root);
            if (!read.ok) return failure("registry-failed", read.detail);
            const existing = read.record.plugins[id];
            const late = conflict(existing, id, version);
            if (late !== null) return late;
            const target = ownedPath(root, id, version);
            try {
                await assertHeld(lock);
                await mkdir(ownedPath(root, id), {recursive: true});
                if (await isLink(ownedPath(root, id))) return failure("copy-failed", `安装目录里的 ${id} 是符号链接，不能往里面安装`);
                // 同名目录没有被登记表引用（上面核对过），是崩溃留下的残留。
                await assertHeld(lock);
                await rm(target, {recursive: true, force: true});
                await assertHeld(lock);
                await rename(staging, target);
            } catch (error) {
                if (error instanceof LockLost) return failure("registry-failed", error.message);
                return failure("copy-failed", `移入安装目录失败：${brief(error)}`);
            }
            const entry: RecordEntry = existing === undefined
                ? {version, pendingVersion: null, state: "enabled", deleteData: false}
                : {...existing, pendingVersion: version};
            try {
                await writeRecord(root, {...read.record, plugins: {...read.record.plugins, [id]: entry}}, lock);
            } catch (error) {
                options.record({level: "error", event: "plugins.registry.write-failed", message: "写入插件登记表失败，安装已撤回", data: {id, version}, error});
                if (!(error instanceof LockLost)) {
                    await assertHeld(lock).then(() => rm(target, {recursive: true, force: true})).catch((cleanup: unknown) => {
                        options.record({level: "warn", event: "plugins.cleanup.failed", message: "撤回安装目录失败，下次启动回收", data: {path: target}, error: cleanup});
                    });
                }
                return failure("registry-failed", `写入插件登记表失败：${brief(error)}`);
            }
            const replaced = existing?.pendingVersion ?? null;
            if (replaced !== null) {
                // 提交之后、释放锁之前删：释放之后别的进程可能重新装回这个版本、让登记表又引用它。
                await assertHeld(lock)
                    .then(() => rm(ownedPath(root, id, replaced), {recursive: true, force: true}))
                    .catch((error: unknown) => {
                        options.record({level: "warn", event: "plugins.cleanup.failed", message: "删除被取代的待切换版本失败，下次启动回收", data: {id, version: replaced}, error});
                    });
            }
            options.record({
                level: "info",
                event: existing === undefined ? "plugins.install.committed" : "plugins.upgrade.pending",
                message: existing === undefined ? `已安装 ${id}@${version}，下一次启动生效` : `${id} 将在下一次启动时切换到 ${version}`,
                data: {id, version, ...(existing === undefined ? {} : {from: existing.version, replacedPending: replaced})},
            });
            return {ok: true, value: itemOf(id, entry)};
        });
        return locked.ok ? locked.value : failure("registry-failed", locked.detail);
    }

    return {
        list: async () => {
            const read = await readRecord(root);
            if (!read.ok) return failure("registry-failed", read.detail);
            const builtin: PluginListItem[] = options.builtin
                .map((plugin): PluginListItem => ({id: plugin.id, version: plugin.version, source: "builtin", state: "enabled", pending: [], notLoaded: null}))
                .sort(byId);
            // 本次启动时还在、已被另一个服务端卸载掉记录的插件也列出：本进程里它仍在运行，重启后才没有。
            const ids = new Set([...Object.keys(read.record.plugins), ...startupOf.keys()]);
            const thirdParty = [...ids].map((id) => itemOf(id, read.record.plugins[id])).sort(byId);
            return {ok: true, value: {safeMode: options.startup.safeMode, plugins: [...builtin, ...thirdParty]}};
        },
        inspect: (sourcePath) => inspect(sourcePath),
        install: (sourcePath) => serial(async () => {
            const result = await install(sourcePath);
            if (!result.ok) options.record({level: "warn", event: "plugins.install.rejected", message: "安装没有完成", data: {source: sourcePath, code: result.code, detail: result.detail}});
            return result;
        }),
        setEnabled: (id, enabled) => serial(async () => {
            if (isBuiltin(id)) return failure("builtin-fixed", "内置插件不能启用或禁用");
            const state = enabled ? "enabled" : "disabled";
            const result = await update((record) => {
                const entry = record.plugins[id];
                if (entry === undefined) return failure("not-installed", `没有安装 ${id}`);
                if (entry.state === "uninstalling") return failure("uninstall-pending", `${id} 正在卸载，重启后再操作`);
                return {ok: true, value: entry.state === state ? null : {...entry, state}};
            }, id);
            if (result.ok) options.record({level: "info", event: `plugins.${enabled ? "enable" : "disable"}`, message: `${id} 将在下一次启动时${enabled ? "启用" : "禁用"}`, data: {id}});
            return result;
        }),
        uninstall: (id) => serial(async () => {
            if (isBuiltin(id)) return failure("builtin-fixed", "内置插件不能卸载");
            const result = await update((record) => {
                const entry = record.plugins[id];
                if (entry === undefined) return failure("not-installed", `没有安装 ${id}`);
                return {ok: true, value: entry.state === "uninstalling" ? null : {...entry, state: "uninstalling", deleteData: false}};
            }, id);
            if (result.ok) options.record({level: "info", event: "plugins.uninstall.pending", message: `${id} 将在下一次启动时卸载`, data: {id}});
            return result;
        }),
    };
}

function publisherOf(raw: unknown): unknown {
    return typeof raw === "object" && raw !== null && "publisher" in raw ? raw.publisher : undefined;
}

/** `files`：没有写为 null；写了但不是字符串数组为 undefined。 */
function filesOf(raw: unknown): ReadonlyArray<string> | null | undefined {
    if (typeof raw !== "object" || raw === null || !("files" in raw) || raw.files === undefined) return null;
    const files = raw.files;
    return Array.isArray(files) && files.every((item): item is string => typeof item === "string" && item.trim() !== "") ? files : undefined;
}

/** 预览用的定义：只有推导受阻要的东西（版本、版本要求、依赖与提供项），不会登记、不会激活。 */
function previewDefinition(manifest: PluginManifest): PluginDefinition {
    return {
        id: manifest.id,
        version: manifest.version,
        pluginVersions: manifest.pluginVersions,
        entries: manifest.entries.map((entry) => ({
            id: entry.id,
            location: entry.location,
            provides: entry.provides.map((id) => defineServiceKey(id)),
            dependencies: [...entry.requires.map((id) => ({key: defineServiceKey(id)})), ...entry.optional.map((id) => ({key: defineServiceKey(id), required: false}))],
            activate: () => ({}),
        })),
    };
}

/** 推导结果的键是 `<插件 id>/<入口 id>`；插件 id 不含 `/`。 */
function splitEntry(key: string): [string, string] {
    const slash = key.indexOf("/");
    return [key.slice(0, slash), key.slice(slash + 1)];
}

