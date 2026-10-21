/**
 * 选项提供者注册表（docs/specs/settings/settings-window.md“选项提供者”与输出 9）：把贡献点 `settings.choices` 上的提供者
 * 换成 nb-form 的选项源（`ui.forms` 输出 11），做法同 `sections.ts` 的 page 分区。
 *
 * - 目录：入口激活时从已接受的声明取得，之后不变；另加配置项声明里 `choices: {from}` 引用、却没有人提供的 id，它们
 *   一直是不可用。
 * - `sources` 在注册表的一生中是同一个对象，每个 id 一个 computed：设置窗口的通用列表与 page 页面拿到的都是它，交付
 *   换代时不用换映射。
 * - 交付句柄优先：有仍 published 的句柄就用它的选项；否则按所属入口的状态给加载中或不可用。`source()` 每个句柄只调
 *   一次；它给的 ref 或 getter 每次求值都包在 try 里并核对形状，提供者后来出错也只让这个源不可用，不会冒到表单里。
 * - 按需激活：读到一个所属入口“已登记、未激活”的源时，在 computed 之外触发 `onSettingsChoices:<id>`（同 page 分区：先
 *   核对所属入口声明了这个事件，触发之后只看它自己的入口与句柄）。
 */

import {computed, shallowRef, toValue} from "@vue/reactivity";
import type {ComputedRef} from "@vue/reactivity";
import type {MaybeRefOrGetter} from "vue";

import {isFormText} from "@notnotype/nb-form";
import type {OptionSource} from "@notnotype/nb-form";
import type {FormOptionSources} from "@notnotype/nb-form/vue";
import type {ContributionDescriptor, ContributionHandle, EntryState, TriggerActivationResult} from "@notnotype/nb-runtime/plugins";

import {formatText} from "nbook/shared/localized-text";
import type {LocalizedText} from "nbook/shared/localized-text";
import type {WindowPlugins} from "nbook/shared/host";

import {settingsChoicesEvent} from "../shared/sections";
import type {SettingsChoicesDeclaration} from "../shared/sections";
import type {SettingsChoicesImplementation} from "./contracts";

const TEXT = {
    missing: {"zh-CN": "没有选项提供者 {id}", "en-US": "There is no option provider {id}"},
    unavailable: {"zh-CN": "选项来源 {id} 不可用：{reason}", "en-US": "Option source {id} is unavailable: {reason}"},
    stopped: {"zh-CN": "选项来源 {id} 已停止", "en-US": "Option source {id} has stopped"},
    notActivatable: {"zh-CN": "插件没有声明打开设置时提供选项：{reason}", "en-US": "The plugin does not provide options when settings open: {reason}"},
    broken: {"zh-CN": "选项来源 {id} 出错：{reason}", "en-US": "Option source {id} failed: {reason}"},
} satisfies Record<string, LocalizedText>;

type ChoicesHandle = ContributionHandle<SettingsChoicesDeclaration, SettingsChoicesImplementation>;

/** 一次交付的 `source()` 结果；`problem` 是调用本身出的错。 */
type Provided = {readonly source: MaybeRefOrGetter<unknown>; readonly problem: null} | {readonly source: null; readonly problem: string};

function unavailable(template: LocalizedText, params: Readonly<Record<string, string>>): OptionSource {
    return {status: "unavailable", reason: formatText(template, params)};
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function entryReason(state: EntryState): string {
    if (state.blocked !== null) return `${state.blocked.reason}：${state.blocked.key}`;
    return state.failure?.error?.message ?? state.failure?.reason ?? state.status;
}

/** 选项源的形状（`ui.forms` 输出 11），值只能是字符串（配置项的动态选项只用在字符串上）；不合格时给出原因。 */
function shapeProblem(value: unknown): string | null {
    if (typeof value !== "object" || value === null) return "不是选项源";
    const source = value as Record<string, unknown>;
    if (source.status === "loading") return null;
    if (source.status === "unavailable") return isFormText(source.reason) ? null : "unavailable 缺少原因文字";
    if (source.status !== "ready") return `status 是 ${String(source.status)}`;
    if (!Array.isArray(source.items)) return "items 不是数组";
    for (const [index, item] of (source.items as ReadonlyArray<unknown>).entries()) {
        if (typeof item !== "object" || item === null) return `第 ${String(index + 1)} 项不是对象`;
        const fields = item as Record<string, unknown>;
        if (typeof fields.value !== "string") return `第 ${String(index + 1)} 项的 value 不是字符串`;
        if (!isFormText(fields.label)) return `第 ${String(index + 1)} 项的 label 不是文字`;
        if (fields.description !== undefined && !isFormText(fields.description)) return `第 ${String(index + 1)} 项的 description 不是文字`;
        if (fields.disabled !== undefined && typeof fields.disabled !== "boolean") return `第 ${String(index + 1)} 项的 disabled 不是布尔`;
    }
    return null;
}

export class ChoiceSourceRegistry {
    /** 全部选项源，按提供者 id；对象本身不变。 */
    readonly sources: FormOptionSources;
    /** 已接受的提供者所属的插件与入口。 */
    readonly #entries: ReadonlyMap<string, {readonly plugin: string; readonly entry: string | null}>;
    readonly #plugins: WindowPlugins | null;
    readonly #report: (message: string) => void;
    readonly #trigger: ((event: string) => Promise<TriggerActivationResult>) | null;
    readonly #handles = new Map<string, ChoicesHandle>();
    readonly #provided = new WeakMap<ChoicesHandle, Provided>();
    /** 已经记过的诊断（id、句柄代次与问题）：同一个问题只记一次，免得每次求值都记。 */
    readonly #reported = new Set<string>();
    /** 按需激活不会激活所属入口的提供者与原因。 */
    readonly #notActivatable = new Map<string, string>();
    /** 触发还没结算的提供者：不重复触发。 */
    readonly #triggering = new Set<string>();
    readonly #version = shallowRef(0);
    #stopped = false;

    constructor(
        providers: ReadonlyArray<ContributionDescriptor<SettingsChoicesDeclaration>>,
        referenced: Iterable<string>,
        plugins: WindowPlugins | null,
        report: (message: string) => void,
        signal: AbortSignal,
        trigger: ((event: string) => Promise<TriggerActivationResult>) | null = null,
    ) {
        this.#entries = new Map(providers.map((descriptor) => [descriptor.id, {plugin: descriptor.plugin, entry: descriptor.entry}]));
        this.#plugins = plugins;
        this.#report = report;
        this.#trigger = trigger;
        const ids = [...new Set([...this.#entries.keys(), ...referenced])].sort();
        this.sources = Object.freeze(Object.fromEntries(ids.map((id): [string, ComputedRef<OptionSource>] => [id, computed(() => this.#state(id))])));
        const unsubscribe = plugins?.onChange(() => this.#bump());
        signal.addEventListener("abort", () => {
            this.#stopped = true;
            unsubscribe?.();
            this.#bump();
        }, {once: true});
    }

    /** `settings.choices` 的接收者。 */
    receiver() {
        return {
            published: (handle: ChoicesHandle) => {
                this.#handles.set(handle.id, handle);
                this.#notActivatable.delete(handle.id);
                this.#bump();
            },
            revoke: (handle: ChoicesHandle) => {
                if (this.#handles.get(handle.id) !== handle) return;
                this.#handles.delete(handle.id);
                this.#notActivatable.delete(handle.id);
                this.#bump();
            },
        };
    }

    #state(id: string): OptionSource {
        void this.#version.value;
        const known = this.#entries.get(id);
        if (known === undefined) return unavailable(TEXT.missing, {id});
        if (this.#stopped) return unavailable(TEXT.stopped, {id});
        const handle = this.#handles.get(id);
        if (handle?.published === true) return this.#evaluate(id, handle);
        // 句柄还在表里但已不 published：入口开始停止、撤回还在排队。
        if (handle !== undefined) return unavailable(TEXT.stopped, {id});
        const state = known.entry === null ? null : this.#plugins?.entryState({plugin: known.plugin, entry: known.entry}) ?? null;
        if (state?.status === "blocked" || state?.status === "failed") return unavailable(TEXT.unavailable, {id, reason: entryReason(state)});
        if (state?.status === "stopping" || state?.status === "closed") return unavailable(TEXT.stopped, {id});
        // “不能按需激活”只对这一次登记成立：入口离开“已登记未激活”（激活、停止、重新登记）之后重新核对。
        if (state?.status !== "registered") this.#notActivatable.delete(id);
        const unreachable = this.#notActivatable.get(id);
        if (unreachable !== undefined && state?.status === "registered") return unavailable(TEXT.notActivatable, {reason: unreachable});
        // 不在 computed 里改状态：触发与它引起的版本号变化放到求值之后。
        if (state?.status === "registered") queueMicrotask(() => this.#activate(id));
        return {status: "loading"};
    }

    #evaluate(id: string, handle: ChoicesHandle): OptionSource {
        let provided = this.#provided.get(handle);
        if (provided === undefined) {
            try {
                const implementation = handle.implementation() as Partial<SettingsChoicesImplementation>;
                provided = typeof implementation.source === "function" ? {source: implementation.source(), problem: null} : {source: null, problem: "交出的实现没有 source()"};
            } catch (error) {
                provided = {source: null, problem: messageOf(error)};
            }
            this.#provided.set(handle, provided);
        }
        let problem = provided.problem;
        let value: unknown = null;
        if (provided.source !== null) {
            try {
                value = toValue(provided.source);
                problem = shapeProblem(value);
            } catch (error) {
                problem = messageOf(error);
            }
        }
        if (problem === null) return value as OptionSource;
        this.#once(`${id}\n${String(handle.generation)}\n${problem}`, `选项提供者 ${id} 出错：${problem}`);
        return unavailable(TEXT.broken, {id, reason: problem});
    }

    #activate(id: string): void {
        const known = this.#entries.get(id);
        if (this.#stopped || known === undefined || known.entry === null || this.#plugins === null || this.#triggering.has(id) || this.#notActivatable.has(id)) return;
        const ref = {plugin: known.plugin, entry: known.entry};
        if (this.#plugins.entryState(ref)?.status !== "registered") return;
        const event = settingsChoicesEvent(id);
        const unreachable = (reason: string): void => {
            this.#once(`${id}\nnot-activatable\n${reason}`, `选项提供者 ${id} 不能按需激活：${reason}`);
            this.#notActivatable.set(id, reason);
            this.#bump();
        };
        if (!(this.#plugins.activationEvents(ref) ?? []).includes(event)) return unreachable(`入口 ${known.plugin}/${known.entry} 没有声明 ${event}`);
        if (this.#trigger === null) return unreachable("窗口没有触发激活事件的出口");
        this.#triggering.add(id);
        void this.#trigger(event).then((result) => {
            this.#triggering.delete(id);
            if (result.status === "rejected") unreachable(`触发 ${event} 被拒（${result.reason}）`);
            else this.#bump();
        }, (error: unknown) => {
            this.#triggering.delete(id);
            unreachable(`触发 ${event} 出错：${messageOf(error)}`);
        });
    }

    #once(key: string, message: string): void {
        if (this.#reported.has(key)) return;
        this.#reported.add(key);
        this.#report(message);
    }

    #bump(): void {
        this.#version.value += 1;
    }
}
