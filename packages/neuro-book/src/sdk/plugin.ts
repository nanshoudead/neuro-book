/**
 * 作者 API 的框架部分：`definePlugin` 与各贡献助手共用的积木（docs/specs/runtime/plugin-api.md 的“作者 API”）。SDK 根入口
 * 服务端也加载，这里不能引用 Vue，也不引用内置插件：贡献助手按所属的内置插件放在各自的子路径（`settings-helpers.ts`、
 * `command-helpers.ts`、`workbench-helpers.ts`、`settings-browser-helpers.ts`），第一个参数是 `plugin`。
 *
 * 助手建在内核与内置插件已有的合同之上，产出的仍是内核的插件描述、插件定义与入口定义；内置插件不用它们。作者只写贡献的
 * 短名，id 由这里拼成 `<插件 id>.<短名>`，类型上是字面量：入口的激活产出按声明逐项核对，漏写、多写、换错助手都编译不过。
 */

import type {RuntimeLocation} from "@notnotype/nb-runtime/lifecycle";
import type {
    ActivationContext,
    ContributionDeclaration,
    ContributionPointDefinition,
    EntryOutputFor,
    ExtraOutputKeys,
    PluginDefinition,
    PluginDescriptor,
    PluginEntryDefinition,
} from "@notnotype/nb-runtime/plugins";
import {defineRemoteService} from "@notnotype/nb-runtime/remote";
import type {RemoteContract, RemoteEventSpec, RemoteMethodSpec, RemoteProviderLocation} from "@notnotype/nb-runtime/remote";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

import type {LocalizedText} from "nbook/shared/localized-text";

/** 界面文字：一个字符串时两种界面语言显示同一句。 */
export type Text = string | LocalizedText;

export function localizedText(text: Text): LocalizedText {
    return typeof text === "string" ? {"zh-CN": text, "en-US": text} : text;
}

declare const boundPoint: unique symbol;

/** 一项贡献的实现，带它的贡献点与 id：入口的激活产出写它，SDK 换成内核的 `{[贡献点]: {[id]: 实现}}`。 */
export interface BoundImplementation<Point extends string = string, Id extends string = string> {
    readonly capability: Point;
    readonly id: Id;
    readonly implementation: unknown;
    /** 只在类型上：不同贡献点、不同 id 的实现互不兼容，换错助手编译不过。 */
    readonly [boundPoint]?: readonly [Point, Id];
}

/** 要在入口里交实现的贡献助手。`where` 是能用它的运行位置：`browser` 的只能写进浏览器入口。 */
export interface ContributionHelper<Point extends string = string, Id extends string = string, Declaration = unknown> {
    readonly id: Id;
    readonly contribution: ContributionDeclaration<Declaration> & {readonly capability: Point; readonly id: Id};
    readonly where: "anywhere" | "browser";
    /** 交出这项贡献时入口要声明的激活事件（例如设置页的 `onSettingsPage:`）；`plugin.entry` 自动并入。 */
    readonly activationEvents: ReadonlyArray<string>;
    implement(...args: never[]): BoundImplementation<Point, Id>;
}

export function bound<Point extends string, Id extends string>(capability: Point, id: Id, implementation: unknown): BoundImplementation<Point, Id> {
    return {capability, id, implementation};
}

/** 贡献 id 的一段：小写字母开头，只含小写字母、数字与连字符（视图、状态栏条目、设置分区的规则）。 */
const SEGMENT = /^[a-z][a-z0-9-]*$/u;
/** 命令 id 的一段可以数字开头（`workbench.commands` 的规则）。 */
export const COMMAND_SEGMENT = /^[a-z0-9][a-z0-9-]*$/u;
const ID_MAX_LENGTH = 128;

/** 拼出贡献 id；短名不合这个贡献点的规则时加载即抛错，不留到登记时静默被拒。 */
export function contributionId<Id extends string, Name extends string>(plugin: Id, name: Name, noun: string, segment: RegExp = SEGMENT): `${Id}.${Name}` {
    const id = `${plugin}.${name}` as const;
    if (!name.split(".").every((part) => segment.test(part))) throw new TypeError(`${noun}的短名 ${name} 不合规则：以点分的段，每段${segment === COMMAND_SEGMENT ? "以小写字母或数字开头" : "以小写字母开头"}，只含小写字母、数字与连字符`);
    if (id.length > ID_MAX_LENGTH) throw new TypeError(`${noun} id ${id} 超过 ${String(ID_MAX_LENGTH)} 个字符`);
    return id;
}

type Helpers = Readonly<Record<string, ContributionHelper>>;

/** 激活上下文对作者收窄：没有 `scope`，入口停止时做的事用 `onStop`。运行时传进来的仍是内核的上下文。 */
export type AuthorActivationContext = Omit<ActivationContext, "scope">;

/** 激活产出：服务、远程服务、接收者照内核写；助手的贡献按声明的键逐项交实现；不经助手的贡献在 `rawContributions`。 */
export type AuthorEntryOutput<
    Provides extends ReadonlyArray<ServiceKey<unknown>>,
    Remote extends ReadonlyArray<RemoteContract>,
    Receives extends ReadonlyArray<string>,
    Raw extends ReadonlyArray<ContributionDeclaration>,
    Contributions extends Helpers,
> = Omit<EntryOutputFor<Provides, Remote, Receives, readonly []>, "contributions">
    & (Raw extends readonly [] ? {readonly rawContributions?: undefined} : {readonly rawContributions: EntryOutputFor<readonly [], readonly [], readonly [], Raw>["contributions"]})
    & (keyof Contributions extends never ? {readonly contributions?: undefined} : {readonly contributions: {readonly [Key in keyof Contributions]: ReturnType<Contributions[Key]["implement"]>}});

/** 实际产出里多写的接收者、原始贡献与助手的实现：每个问题成一个以它命名的属性，报错写成“缺少属性 多写的…”。 */
type ExtraAuthorKeys<Output, Receives extends ReadonlyArray<string>, Raw extends ReadonlyArray<ContributionDeclaration>, Contributions extends Helpers> =
    | ExtraOutputKeys<(Output extends {readonly receivers: infer Actual} ? {readonly receivers: Actual} : unknown) & (Output extends {readonly rawContributions: infer Actual} ? {readonly contributions: Actual} : unknown), Receives, Raw>
    | (Output extends {readonly contributions: infer Actual} ? `多写的贡献实现：${Exclude<Exclude<keyof Actual, symbol>, keyof Contributions> & string}` : never);

type NoExtraAuthorKeys<Output, Receives extends ReadonlyArray<string>, Raw extends ReadonlyArray<ContributionDeclaration>, Contributions extends Helpers> =
    [ExtraAuthorKeys<Output, Receives, Raw, Contributions>] extends [never] ? unknown : {readonly [Problem in ExtraAuthorKeys<Output, Receives, Raw, Contributions>]: never};

/** 只能在浏览器入口里用的助手写进别的位置的入口：那一项的类型变成以问题命名的字符串，编译不过。 */
type PlacedHelpers<Contributions extends Helpers, Location extends string> = {
    readonly [Key in keyof Contributions]: Contributions[Key]["where"] extends "browser" ? (Location extends "browser" ? Contributions[Key] : `只能写进浏览器入口：${Key & string}`) : Contributions[Key];
};

export interface AuthorEntry<
    Location extends RuntimeLocation,
    Contributions extends Helpers,
    Provides extends ReadonlyArray<ServiceKey<unknown>>,
    Remote extends ReadonlyArray<RemoteContract>,
    Receives extends ReadonlyArray<string>,
    Raw extends ReadonlyArray<ContributionDeclaration>,
    Output,
> {
    /** 缺省取运行位置名；入口 id 在一个插件里不能重复（不按位置分）。 */
    readonly id?: string;
    readonly location: Location;
    readonly activationEvents?: PluginEntryDefinition["activationEvents"];
    readonly dependencies?: PluginEntryDefinition["dependencies"];
    readonly provides?: Provides;
    readonly remoteProvides?: Remote;
    readonly remoteDelegates?: PluginEntryDefinition["remoteDelegates"];
    readonly receives?: Receives;
    /** 助手给出的贡献，键随作者取，激活产出的 `contributions` 用同样的键交实现。 */
    readonly contributions?: Contributions & PlacedHelpers<NoInfer<Contributions>, NoInfer<Location>>;
    /** 不经助手的贡献：内核的贡献声明，实现写在产出的 `rawContributions` 里。 */
    readonly rawContributions?: Raw;
    activate(context: AuthorActivationContext): Output | Promise<Output>;
}

export interface PluginBuilder<Id extends string> {
    readonly id: Id;
    readonly version: string;
    readonly locations: ReadonlyArray<RuntimeLocation>;
    /** 插件描述：`contributions` 收设置项、分区这类不要实现的声明（也收内核的贡献声明）。 */
    descriptor(contributions?: ReadonlyArray<{readonly contribution: ContributionDeclaration} | ContributionDeclaration>): PluginDescriptor;
    /**
     * 一个入口。激活产出的 `contributions` 按声明的键逐项交 `助手.implement(…)`：漏写、换错助手、多写编译不过；助手带的
     * 激活事件并进 `activationEvents`。服务、远程服务、接收者与 `rawContributions` 的核对同内核的 `defineEntry`。
     */
    entry<
        const Location extends RuntimeLocation,
        const Contributions extends Helpers = Readonly<Record<never, ContributionHelper>>,
        const Provides extends ReadonlyArray<ServiceKey<unknown>> = readonly [],
        const Remote extends ReadonlyArray<RemoteContract> = readonly [],
        const Receives extends ReadonlyArray<string> = readonly [],
        const Raw extends ReadonlyArray<ContributionDeclaration> = readonly [],
        const Output extends AuthorEntryOutput<Provides, Remote, Receives, Raw, Contributions> = AuthorEntryOutput<Provides, Remote, Receives, Raw, Contributions>,
    >(entry: AuthorEntry<Location, Contributions, Provides, Remote, Receives, Raw, Output> & NoExtraAuthorKeys<Output, NoInfer<Receives>, NoInfer<Raw>, NoInfer<Contributions>>): PluginEntryDefinition;
    /** 插件定义（入口模块导出它）；插件自己定义的贡献点写在 `contributionPoints`。入口 id 重复时抛错。 */
    definition(entries: ReadonlyArray<PluginEntryDefinition> | {
        readonly entries: ReadonlyArray<PluginEntryDefinition>;
        readonly contributionPoints?: ReadonlyArray<ContributionPointDefinition>;
        readonly activationEventPrefixes?: ReadonlyArray<string>;
    }): PluginDefinition;
}

/** 绑定插件 id 的作者 API；在插件描述的模块（`plugin.ts`）里调用一次，别的模块都从那里取它。 */
export function definePlugin<const Id extends string>(options: {readonly id: Id; readonly version: string; readonly locations: ReadonlyArray<RuntimeLocation>}): PluginBuilder<Id> {
    const plugin = options.id;
    return {
        id: plugin,
        version: options.version,
        locations: options.locations,
        descriptor(contributions = []) {
            return {
                id: plugin,
                version: options.version,
                locations: options.locations,
                contributions: contributions.map((item) => ("contribution" in item ? item.contribution : item)),
            };
        },
        entry(entry) {
            const {id, contributions, rawContributions, activate, activationEvents, ...rest} = entry as AuthorEntry<RuntimeLocation, Helpers, [], [], [], ReadonlyArray<ContributionDeclaration>, {readonly contributions?: Readonly<Record<string, BoundImplementation>>; readonly rawContributions?: Readonly<Record<string, Readonly<Record<string, unknown>>>>}>;
            const helpers = Object.values(contributions ?? {}) as ReadonlyArray<ContributionHelper>;
            const events = [...new Set([...(activationEvents ?? []), ...helpers.flatMap((helper) => helper.activationEvents)])];
            const definition: PluginEntryDefinition = {
                ...rest,
                id: id ?? entry.location,
                ...(events.length === 0 && activationEvents === undefined ? {} : {activationEvents: events}),
                contributions: [...helpers.map((helper) => helper.contribution), ...(rawContributions ?? [])],
                activate: async (context) => {
                    const {contributions: implemented, rawContributions: raw, ...output} = await activate(context);
                    const merged: Record<string, Record<string, unknown>> = {};
                    for (const [point, items] of Object.entries(raw ?? {})) merged[point] = {...items};
                    for (const item of Object.values(implemented ?? {})) (merged[item.capability] ??= {})[item.id] = item.implementation;
                    return {...output, ...(Object.keys(merged).length === 0 ? {} : {contributions: merged})};
                },
            };
            return definition;
        },
        definition(input) {
            const {entries, ...rest} = Array.isArray(input) ? {entries: input as ReadonlyArray<PluginEntryDefinition>} : input as {readonly entries: ReadonlyArray<PluginEntryDefinition>};
            const seen = new Set<string>();
            for (const entry of entries) {
                if (seen.has(entry.id)) throw new TypeError(`插件 ${plugin} 有两个入口 id 都是 ${entry.id}：入口 id 在一个插件里不能重复（不按运行位置分），给其中一个写 id`);
                seen.add(entry.id);
            }
            return {id: plugin, ...rest, entries};
        },
    };
}

/**
 * 本插件提供的远程服务合同：id 是 `<插件 id>/<name>`，不用手写插件 id；其余同 `defineRemoteService`（docs/specs/runtime/plugin-channel.md）。
 * 代理别的插件的合同、内置插件的合同仍用 `defineRemoteService` 写完整的 id。
 */
export function remoteService<
    const Id extends string,
    const Name extends string,
    const Methods extends Readonly<Record<string, RemoteMethodSpec>>,
    const Provider extends RemoteProviderLocation,
    const Events extends Readonly<Record<string, RemoteEventSpec>> = Readonly<Record<never, RemoteEventSpec>>,
>(plugin: PluginBuilder<Id>, spec: {
    readonly name: Name;
    readonly version: number;
    readonly provider: Provider;
    readonly callers: ReadonlyArray<string>;
    readonly methods: Methods;
    readonly events?: Events;
}): RemoteContract<Methods, Events, Provider> {
    const {name, ...rest} = spec;
    if (!SEGMENT.test(name)) throw new TypeError(`远程服务的短名 ${name} 不合规则：小写字母开头，只含小写字母、数字与连字符`);
    return defineRemoteService<Methods, Provider, Events>({...rest, id: `${plugin.id}/${name}`});
}
