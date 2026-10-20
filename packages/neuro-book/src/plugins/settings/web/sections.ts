/**
 * 设置分区注册表（docs/specs/settings/settings-window.md 输出 1–5）：两种输入分开，做法同工作台的视图注册表。
 *
 * - 分区目录：入口激活时从两个贡献点上已接受的声明取得，之后不变（当前是静态清单）：list 分区来自 `settings.sections`
 *   的顶层声明，只靠声明呈现，总是可用；page 分区来自 `settings.pages`，未交付实现的也在目录里，左栏不随交付先后跳动。
 *   同一 id 出现在两个点上时两条都不进目录（settings-window.md“分区声明”）。
 * - 交付句柄：接收者在 `published` 时记下句柄、`revoke` 时去掉。page 分区每次加载都经句柄的 `implementation()` 取实现，
 *   不缓存，撤回之后不会再用旧实现。
 *
 * 句柄之外的状态（入口受阻、激活失败、已停止）从宿主能力 `window.plugins` 查；它的变化通知不精确，所以交付状态每次
 * 都重新求，句柄优先：有仍 published 的句柄才是 `available`。
 *
 * page 分区交出的实现没有 `load()` 时，接收者记一条诊断，加载按失败处理，原位显示错误。
 */

import {shallowRef} from "@vue/reactivity";
import type {Component} from "vue";

import type {ContributionDescriptor, ContributionHandle, ContributionReceiver, EntryState, RevokeReason} from "@notnotype/nb-runtime/plugins";

import type {WindowPluginRetry, WindowPlugins} from "nbook/shared/host";

import type {SettingsPageDeclaration, SettingsSectionDeclaration} from "../shared/sections";
import type {SettingsPageImplementation} from "./contracts";

export type SettingsPageDelivery =
    | {readonly kind: "declared"}
    | {readonly kind: "entry-blocked"; readonly reason: string}
    | {readonly kind: "entry-failed"; readonly reason: string}
    | {readonly kind: "entry-stopped"; readonly reason: RevokeReason | "stopped"}
    | {readonly kind: "available"};

/** 一次加载的结果。stale：结果回来时句柄已撤回、换了或注册表已停止，这次结果作废，不算失败。 */
export type SettingsPageLoad =
    | {readonly status: "loaded"; readonly component: Component}
    | {readonly status: "failed"; readonly error: unknown}
    | {readonly status: "stale"};

/** 目录里的一个分区：已接受的声明与贡献它的插件；`kind` 是它来自哪个贡献点。 */
export type SettingsSectionEntry =
    | {readonly id: string; readonly plugin: string; readonly kind: "list"; readonly declaration: SettingsSectionDeclaration}
    | {readonly id: string; readonly plugin: string; readonly kind: "page"; readonly declaration: SettingsPageDeclaration};

type PageHandle = ContributionHandle<SettingsPageDeclaration, SettingsPageImplementation>;

function entryReason(state: EntryState): string {
    if (state.blocked !== null) return `${state.blocked.reason}：${state.blocked.key}`;
    return state.failure?.error?.message ?? state.failure?.reason ?? state.status;
}

function hasLoad(implementation: SettingsPageImplementation): boolean {
    return typeof (implementation as {readonly load?: unknown}).load === "function";
}

export class SettingsSectionRegistry {
    /** 按分区 id 的码元顺序；左栏的排法由设置窗口按声明的 `category`、`order` 定。 */
    readonly catalog: ReadonlyArray<SettingsSectionEntry>;
    readonly #entries: ReadonlyMap<string, SettingsSectionEntry>;
    /** page 分区所属的入口。 */
    readonly #pageEntries: ReadonlyMap<string, string | null>;
    readonly #plugins: WindowPlugins | null;
    readonly #report: (message: string) => void;
    readonly #handles = new Map<string, PageHandle>();
    readonly #revoked = new Map<string, RevokeReason>();
    /** 交付状态的响应式版本号：句柄或入口状态变了就加一，读交付状态的 computed 因此重算。 */
    readonly #version = shallowRef(0);
    #stopped = false;

    constructor(
        lists: ReadonlyArray<ContributionDescriptor<SettingsSectionDeclaration>>,
        pages: ReadonlyArray<ContributionDescriptor<SettingsPageDeclaration>>,
        plugins: WindowPlugins | null,
        report: (message: string) => void,
        signal: AbortSignal,
    ) {
        const pageIds = new Set(pages.map((descriptor) => descriptor.id));
        const clashing = new Set(lists.map((descriptor) => descriptor.id).filter((id) => pageIds.has(id)));
        for (const id of [...clashing].sort()) report(`分区 id ${id} 同时出现在 list 与 page 两个贡献点上，两者都不显示`);
        const entries: SettingsSectionEntry[] = [
            ...lists.filter((descriptor) => !clashing.has(descriptor.id)).map((descriptor) => ({id: descriptor.id, plugin: descriptor.plugin, kind: "list" as const, declaration: descriptor.declaration})),
            ...pages.filter((descriptor) => !clashing.has(descriptor.id)).map((descriptor) => ({id: descriptor.id, plugin: descriptor.plugin, kind: "page" as const, declaration: descriptor.declaration})),
        ];
        this.catalog = entries.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
        this.#entries = new Map(this.catalog.map((entry) => [entry.id, entry]));
        this.#pageEntries = new Map(pages.filter((descriptor) => !clashing.has(descriptor.id)).map((descriptor) => [descriptor.id, descriptor.entry]));
        this.#plugins = plugins;
        this.#report = report;
        const unsubscribe = plugins?.onChange(() => this.#bump());
        signal.addEventListener("abort", () => {
            this.#stopped = true;
            unsubscribe?.();
            this.#bump();
        }, {once: true});
    }

    /** 分区的交付状态；list 分区不需要交付，总是 `available`。在 computed 里读会随交付变化重算。 */
    delivery(sectionId: string): SettingsPageDelivery {
        void this.#version.value;
        const known = this.#entries.get(sectionId);
        if (known?.kind === "list") return {kind: "available"};
        if (this.#stopped) return {kind: "entry-stopped", reason: "receiver-closed"};
        const handle = this.#handles.get(sectionId);
        if (handle?.published === true) return {kind: "available"};
        // 句柄还在表里但已不 published：入口开始停止、撤回还在排队（接收者的串行锁）。按已停止呈现，不再拿它加载。
        if (handle !== undefined) return {kind: "entry-stopped", reason: "stopped"};
        const entry = this.#pageEntries.get(sectionId) ?? null;
        const state = known === undefined || entry === null ? null : this.#plugins?.entryState({plugin: known.plugin, entry}) ?? null;
        if (state?.status === "blocked") return {kind: "entry-blocked", reason: entryReason(state)};
        if (state?.status === "failed") return {kind: "entry-failed", reason: entryReason(state)};
        const revoked = this.#revoked.get(sectionId);
        if (revoked !== undefined) return {kind: "entry-stopped", reason: revoked};
        if (state?.status === "stopping" || state?.status === "closed") return {kind: "entry-stopped", reason: "stopped"};
        return {kind: "declared"};
    }

    /** `settings.pages` 的接收者；跨点撞名的 page 分区不在目录里，它的句柄不收。 */
    receiver(): ContributionReceiver<SettingsPageDeclaration, SettingsPageImplementation> {
        return {
            published: (handle) => {
                if (!this.#pageEntries.has(handle.id)) return;
                this.#handles.set(handle.id, handle);
                this.#revoked.delete(handle.id);
                if (!hasLoad(handle.implementation())) {
                    this.#report(`page 分区 ${handle.id} 交出的实现没有 load()，打开时按加载失败显示`);
                }
                this.#bump();
            },
            revoke: (handle, _prepared, reason) => {
                if (this.#handles.get(handle.id) !== handle) return;
                this.#handles.delete(handle.id);
                this.#revoked.set(handle.id, reason);
                this.#bump();
            },
        };
    }

    /** 加载 page 分区的组件定义一次。结果回来时句柄已不是当前句柄、已不处于 published，或注册表已停止，就作废这次结果。 */
    async load(sectionId: string): Promise<SettingsPageLoad> {
        const handle = this.#handles.get(sectionId);
        if (handle === undefined || this.#stopped) return {status: "stale"};
        try {
            const implementation = handle.implementation();
            if (!hasLoad(implementation)) return {status: "failed", error: new TypeError(`page 分区 ${sectionId} 交出的实现没有 load()`)};
            const component = await implementation.load();
            return this.#current(sectionId, handle) ? {status: "loaded", component} : {status: "stale"};
        } catch (error) {
            // implementation() 在撤回后抛 PluginStateError：那也是“已作废”，不是加载失败。
            return this.#current(sectionId, handle) ? {status: "failed", error} : {status: "stale"};
        }
    }

    /** 分区所属入口激活失败时，恢复并重新激活它；只经分区 id，拿不到别的入口。 */
    async retry(sectionId: string): Promise<WindowPluginRetry> {
        const known = this.#entries.get(sectionId);
        const entry = this.#pageEntries.get(sectionId) ?? null;
        if (known === undefined || entry === null) return {status: "failed", reason: `未登记的分区 ${sectionId}`};
        if (this.#plugins === null) return {status: "failed", reason: "宿主没有提供入口状态"};
        const result = await this.#plugins.retry({plugin: known.plugin, entry});
        this.#bump();
        return result;
    }

    #current(sectionId: string, handle: PageHandle): boolean {
        return !this.#stopped && this.#handles.get(sectionId) === handle && handle.published;
    }

    #bump(): void {
        this.#version.value += 1;
    }
}
