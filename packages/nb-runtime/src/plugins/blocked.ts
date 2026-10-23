/**
 * 根据入口位置、服务依赖与当前状态纯推导受阻；输入只含存活登记的快照。
 * 本模块不创建资源、不触发激活、不产生诊断，也不保留跨查询状态。
 */

import type {RuntimeLocation} from "../lifecycle/lifecycle";
import type {ServiceDependency, ServiceKey} from "../services/services";

import type {EntryBlocked, EntryRef, EntryStatus, PluginDefinition} from "./contracts";

export interface EntrySnapshot extends EntryRef {
    readonly location: RuntimeLocation;
    /** 所属插件的版本；没写版本的插件（内置插件的测试夹具）为 null，不参与版本核对。 */
    readonly pluginVersion: string | null;
    /** 所属插件的 `pluginVersions`。 */
    readonly pluginVersions: Readonly<Record<string, string>>;
    readonly provides: ReadonlyArray<ServiceKey<unknown>>;
    readonly dependencies: ReadonlyArray<ServiceDependency>;
    readonly status: EntryStatus;
}

export function entryIdentity(entry: EntryRef): string {
    return `${entry.plugin}/${entry.entry}`;
}

/** 版本范围的判断，由宿主注入（`PluginHostOptions.satisfies`）。 */
export type VersionCheck = (version: string, range: string) => boolean;

/**
 * 消费方对提供方插件版本的要求不满足时的受阻原因；同一插件内的依赖与没写范围的不核对。可选依赖用它决定不注入
 * （plugin-manifest.md 输出 8）。
 */
export function versionMismatch(consumer: EntrySnapshot, provider: EntrySnapshot, satisfies: VersionCheck | undefined): {readonly version: string; readonly range: string} | null {
    if (provider.plugin === consumer.plugin) return null;
    const range = consumer.pluginVersions[provider.plugin];
    if (range === undefined || provider.pluginVersion === null) return null;
    // 登记时已核对写了范围的定义必须有 satisfies；这里缺省只为纯推导的调用方。
    if (satisfies === undefined || satisfies(provider.pluginVersion, range)) return null;
    return {version: provider.pluginVersion, range};
}

/** 本地能力不归插件所有；提供项存在即满足本层可用性约束，初始化失败仍由 services 报告。 */
export function deriveBlocked(
    entries: ReadonlyArray<EntrySnapshot>,
    location: RuntimeLocation,
    localServices: ReadonlySet<string>,
    satisfies?: VersionCheck,
): ReadonlyMap<string, EntryBlocked | null> {
    const local = entries.filter((entry) => entry.location === location);
    const providers = new Map<string, EntrySnapshot>();
    const foreign = new Set<string>();
    for (const entry of entries) {
        for (const key of entry.provides) {
            if (entry.location === location) {
                providers.set(key.name, entry);
            } else {
                foreign.add(key.name);
            }
        }
    }
    const edges = new Map<EntrySnapshot, Array<{key: ServiceKey<unknown>; provider: EntrySnapshot}>>();
    for (const entry of local) {
        const dependencies = [];
        for (const dependency of entry.dependencies) {
            const provider = providers.get(dependency.key.name);
            if (dependency.required !== false && provider !== undefined && !localServices.has(dependency.key.name)) {
                dependencies.push({key: dependency.key, provider});
            }
        }
        edges.set(entry, dependencies);
    }

    // 强连通分量区分真正的环成员与依赖环的外部消费者。
    const indices = new Map<EntrySnapshot, number>();
    const low = new Map<EntrySnapshot, number>();
    const stack: EntrySnapshot[] = [];
    const stacked = new Set<EntrySnapshot>();
    const components = new Map<EntrySnapshot, ReadonlySet<EntrySnapshot>>();
    let index = 0;
    const visit = (entry: EntrySnapshot): void => {
        indices.set(entry, index);
        low.set(entry, index++);
        stack.push(entry);
        stacked.add(entry);
        for (const {provider} of edges.get(entry)!) {
            if (!indices.has(provider)) {
                visit(provider);
                low.set(entry, Math.min(low.get(entry)!, low.get(provider)!));
            } else if (stacked.has(provider)) {
                low.set(entry, Math.min(low.get(entry)!, indices.get(provider)!));
            }
        }
        if (low.get(entry) !== indices.get(entry)) {
            return;
        }
        const component = new Set<EntrySnapshot>();
        let member: EntrySnapshot;
        do {
            member = stack.pop()!;
            stacked.delete(member);
            component.add(member);
        } while (member !== entry);
        if (component.size > 1 || edges.get(entry)!.some(({provider}) => provider === entry)) {
            for (const item of component) {
                components.set(item, component);
            }
        }
    };
    for (const entry of local) {
        if (!indices.has(entry)) {
            visit(entry);
        }
    }

    const results = new Map<string, EntryBlocked | null>();
    const cycle = (entry: EntrySnapshot): EntryBlocked => {
        const component = components.get(entry)!;
        const path: EntrySnapshot[] = [entry];
        const seen = new Set<EntrySnapshot>(path);
        const find = (current: EntrySnapshot): ServiceKey<unknown> | null => {
            for (const {key, provider} of edges.get(current)!) {
                if (!component.has(provider)) {
                    continue;
                }
                if (provider === entry) {
                    path.push(entry);
                    return key;
                }
                if (!seen.has(provider)) {
                    seen.add(provider);
                    path.push(provider);
                    const found = find(provider);
                    if (found !== null) {
                        return current === entry ? key : found;
                    }
                    path.pop();
                }
            }
            return null;
        };
        const key = find(entry)!;
        return {reason: "dependency-cycle", key: key.name, path: path.map(entryIdentity)};
    };
    const compute = (entry: EntrySnapshot): EntryBlocked | null => {
        const id = entryIdentity(entry);
        if (results.has(id)) {
            return results.get(id)!;
        }
        if (components.has(entry)) {
            const blocked = cycle(entry);
            results.set(id, blocked);
            return blocked;
        }
        let blocked: EntryBlocked | null = null;
        for (const dependency of entry.dependencies) {
            if (dependency.required === false || localServices.has(dependency.key.name)) {
                continue;
            }
            const key = dependency.key.name;
            const provider = providers.get(dependency.key.name);
            const mismatch = provider === undefined ? null : versionMismatch(entry, provider, satisfies);
            if (provider === undefined) {
                blocked = {reason: foreign.has(dependency.key.name) ? "location-mismatch" : "missing-service", key, path: [id]};
            } else if (mismatch !== null) {
                blocked = {reason: "version-mismatch", key, path: [id, entryIdentity(provider)], ...mismatch};
            } else if (provider.status === "failed") {
                blocked = {reason: "provider-failed", key, path: [id, entryIdentity(provider)]};
            } else {
                const upstream = compute(provider);
                if (upstream !== null) {
                    blocked = {reason: "provider-blocked", key, path: [id, ...upstream.path]};
                }
            }
            if (blocked !== null) {
                break;
            }
        }
        results.set(id, blocked);
        return blocked;
    };
    for (const entry of entries) {
        if (entry.location === location) {
            compute(entry);
        } else {
            results.set(entryIdentity(entry), null);
        }
    }
    return results;
}

/**
 * 只按定义推导某个运行位置上各入口的受阻（不需要运行实例）：升级插件之前预览“重启后哪些入口会受阻”用，与宿主登记后的推导
 * 是同一个函数（plugin-install.md 输出 8.1）。`definitions` 之外提供的服务（宿主能力、没列进来的插件）都当作在场，所以只会
 * 推出这些定义之间的受阻：版本不符、提供方受阻、依赖环。全部入口按“已登记”推导。
 */
export function previewBlocked(definitions: ReadonlyArray<PluginDefinition>, location: RuntimeLocation, satisfies?: VersionCheck): ReadonlyMap<string, EntryBlocked | null> {
    const entries: EntrySnapshot[] = definitions.flatMap((definition) => definition.entries.map((entry) => ({
        plugin: definition.id,
        entry: entry.id,
        location: entry.location,
        pluginVersion: definition.version ?? null,
        pluginVersions: definition.pluginVersions ?? {},
        provides: entry.provides ?? [],
        dependencies: entry.dependencies ?? [],
        status: "registered" as const,
    })));
    const provided = new Set(entries.filter((entry) => entry.location === location).flatMap((entry) => entry.provides.map((key) => key.name)));
    const elsewhere = new Set(entries.flatMap((entry) => entry.dependencies.map((dependency) => dependency.key.name)).filter((key) => !provided.has(key)));
    return deriveBlocked(entries, location, elsewhere, satisfies);
}
