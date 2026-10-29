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
 * 按需激活（输出 4）：窗口显示一个 page 分区时调 `activate`。触发前先看所属入口是否声明了 `onSettingsPage:<id>`：
 * 事件参数只是字符串，别的入口也可以声明同一个事件，触发结果非空不代表这个分区的入口会被激活。触发之后分区的状态只
 * 看它自己入口的状态与句柄，不等整个事件的结果（别的监听者可能一直不结束）。
 *
 * page 分区交出的实现没有 `load()` 时，接收者记一条诊断，加载按失败处理，原位显示错误。
 */

import {shallowRef} from "@vue/reactivity";
import type {Component} from "vue";

import type {ContributionDescriptor, ContributionHandle, ContributionReceiver, EntryState, RevokeReason, TriggerActivationResult} from "@notnotype/nb-runtime/plugins";

import type {WindowPluginRetry, WindowPlugins} from "nbook/shared/host";

import {settingsPageEvent} from "../shared/sections";
import type {SettingsPageDeclaration, SettingsSectionDeclaration} from "../shared/sections";
import type {SettingsPageImplementation} from "./contracts";

export type SettingsPageDelivery =
    | {readonly kind: "declared"}
    | {readonly kind: "entry-blocked"; readonly reason: string}
    | {readonly kind: "entry-failed"; readonly reason: string}
    | {readonly kind: "entry-stopped"; readonly reason: RevokeReason | "stopped"}
    /** 所属入口还没激活，且不会被 `onSettingsPage:<id>` 激活：没声明这个事件，或触发被拒。 */
    | {readonly kind: "entry-not-activatable"; readonly reason: string}
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
    if (state.blocked !== null) return `${state.blocked.reason}: ${state.blocked.key}`;
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
    readonly #trigger: ((event: string) => Promise<TriggerActivationResult>) | null;
    /** 本窗口试过按需激活、但不会激活所属入口的 page 分区与原因。 */
    readonly #notActivatable = new Map<string, string>();
    /** 交付状态的响应式版本号：句柄或入口状态变了就加一，读交付状态的 computed 因此重算。 */
    readonly #version = shallowRef(0);
    #stopped = false;

    constructor(
        lists: ReadonlyArray<ContributionDescriptor<SettingsSectionDeclaration>>,
        pages: ReadonlyArray<ContributionDescriptor<SettingsPageDeclaration>>,
        plugins: WindowPlugins | null,
        report: (message: string) => void,
        signal: AbortSignal,
        trigger: ((event: string) => Promise<TriggerActivationResult>) | null = null,
    ) {
        this.#trigger = trigger;
        const pageIds = new Set(pages.map((descriptor) => descriptor.id));
        const clashing = new Set(lists.map((descriptor) => descriptor.id).filter((id) => pageIds.has(id)));
        for (const id of [...clashing].sort()) report(`Section id ${id} appears on both the list and page contribution points; neither is shown`);
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
        const unreachable = this.#notActivatable.get(sectionId);
        if (unreachable !== undefined && state?.status === "registered") return {kind: "entry-not-activatable", reason: unreachable};
        return {kind: "declared"};
    }

    /**
     * 按需激活：所属入口处于“已登记、未激活”时触发 `onSettingsPage:<id>`。每次进入分区都可以调用；内核把同一代次的激活
     * 合并成一次。离开分区或关窗口不取消：激活照常完成，再进入时按当时的状态呈现。
     */
    activate(sectionId: string): void {
        const known = this.#entries.get(sectionId);
        const entry = this.#pageEntries.get(sectionId) ?? null;
        if (this.#stopped || known?.kind !== "page" || entry === null || this.#plugins === null) return;
        const ref = {plugin: known.plugin, entry};
        if (this.#plugins.entryState(ref)?.status !== "registered") return;
        const event = settingsPageEvent(sectionId);
        const unreachable = (reason: string): void => {
            if (this.#notActivatable.get(sectionId) !== reason) this.#report(`Page section ${sectionId} cannot be activated on demand: ${reason}`);
            this.#notActivatable.set(sectionId, reason);
            this.#bump();
        };
        if (!(this.#plugins.activationEvents(ref) ?? []).includes(event)) return unreachable(`Entry ${known.plugin}/${entry} does not declare ${event}`);
        if (this.#trigger === null) return unreachable("The window has no way to trigger activation events");
        this.#notActivatable.delete(sectionId);
        void this.#trigger(event).then((result) => {
            if (result.status === "rejected") unreachable(`Triggering ${event} was rejected (${result.reason})`);
            else this.#bump();
        }, (error: unknown) => unreachable(`Triggering ${event} failed: ${error instanceof Error ? error.message : String(error)}`));
    }

    /** `settings.pages` 的接收者；跨点撞名的 page 分区不在目录里，它的句柄不收。 */
    receiver(): ContributionReceiver<SettingsPageDeclaration, SettingsPageImplementation> {
        return {
            published: (handle) => {
                if (!this.#pageEntries.has(handle.id)) return;
                this.#handles.set(handle.id, handle);
                this.#revoked.delete(handle.id);
                if (!hasLoad(handle.implementation())) {
                    this.#report(`Page section ${handle.id} has an implementation without load(); opening it shows a load failure`);
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
            if (!hasLoad(implementation)) return {status: "failed", error: new TypeError(`Page section ${sectionId} has an implementation without load()`)};
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
        if (known === undefined || entry === null) return {status: "failed", reason: `Section ${sectionId} is not registered`};
        if (this.#plugins === null) return {status: "failed", reason: "The host does not provide entry states"};
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
