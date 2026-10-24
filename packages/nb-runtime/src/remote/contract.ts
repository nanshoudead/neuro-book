/**
 * 远程服务合同：放在插件的共享模块里，提供方与调用方引用同一份。合同在定义时就校验结构，写错的
 * 合同在模块加载时失败，而不是第一次调用时。行为合同见 docs/specs/runtime/plugin-channel.md。
 */

import type {Static, TSchema} from "typebox";

import type {ConsumerIdentity} from "../services/services";

import {KERNEL_CONTRACT_PREFIX, REMOTE_FAILURE_CODES, RESERVED_KEY_PREFIX} from "./protocol";
import type {RemoteCause, RemoteFailure, RemoteFailureCode, RemoteResult, RemoteTarget} from "./protocol";

/**
 * 提供方位置：哪种拓扑角色的实例提供这份合同。`client` 指浏览器、TUI 这类客户端实例；`any` 指每个
 * 实例各有一份（例如命令系统的跨实例执行）。它决定调用方能写哪些目标、能否省略 `.at()`。
 */
export type RemoteProviderLocation = "server" | "project" | "client" | "any";

const PROVIDER_LOCATIONS: ReadonlyArray<RemoteProviderLocation> = ["server", "project", "client", "any"];

/** 每种提供方位置可用的目标（runtime/plugin-channel.md 输出第 1 条）。 */
export type RemoteTargetFor<Provider extends RemoteProviderLocation> = Provider extends "server"
    ? "server"
    : Provider extends "project"
      ? "project" | {readonly project: string}
      : Provider extends "client"
        ? {readonly client: string}
        : RemoteTarget;

/** 目标是否落在合同的提供方位置上；类型检查之外的运行期核对，不符的调用不发出请求。 */
export function providerAccepts(provider: RemoteProviderLocation, target: RemoteTarget): boolean {
    switch (provider) {
        case "server":
            return target === "server";
        case "project":
            return target === "project" || (typeof target === "object" && "project" in target);
        case "client":
            return typeof target === "object" && "client" in target;
        case "any":
            return true;
    }
}

export interface RemoteMethodSpec {
    /** 对象 schema，多余字段被拒绝：没写 `additionalProperties` 时 `defineRemoteService` 补成 `false`，写了别的值报错。 */
    readonly input: TSchema;
    readonly output: TSchema;
    /** 写方法的请求帧发出后被中断时结果为 `unknown-outcome`，不自动重试。 */
    readonly effect: "read" | "write";
    /** 业务失败码 → 详情 schema；码不得与路由层失败码重名。提供方交出的详情按它核对，不符为 `provider-error`；没有详情的码写 `Type.Undefined()`。 */
    readonly errors?: Readonly<Record<string, TSchema>>;
}

export interface RemoteEventSpec {
    /** 订阅过滤参数；同样是对象 schema，`additionalProperties` 的规则同方法的 `input`。 */
    readonly filter: TSchema;
    readonly payload: TSchema;
}

export interface RemoteContract<
    Methods extends Readonly<Record<string, RemoteMethodSpec>> = Readonly<Record<string, RemoteMethodSpec>>,
    Events extends Readonly<Record<string, RemoteEventSpec>> = Readonly<Record<string, RemoteEventSpec>>,
    Provider extends RemoteProviderLocation = RemoteProviderLocation,
> {
    /** 以提供它的插件 id 加 `/` 开头，例如 `acme.files/files`。 */
    readonly id: string;
    /** 第一版按整数精确匹配。 */
    readonly version: number;
    readonly provider: Provider;
    /** 允许调用的实例种类（运行位置），例如 `["browser", "tui", "server"]`。 */
    readonly callers: ReadonlyArray<string>;
    readonly methods: Methods;
    readonly events: Events;
}

/**
 * 作者写的对象 schema 收紧成不许多余字段的一份：没写 `additionalProperties` 的补成 `false`（返回新对象，不改传进来的
 * schema；TypeBox 放在不可枚举键上的元数据一并带上），已经是 `false` 的原样返回；不是对象 schema、或写了别的值时返回 null。
 */
function strictObjectSchema(schema: TSchema): TSchema | null {
    const record = schema as unknown as {readonly type?: unknown; readonly additionalProperties?: unknown};
    if (record.type !== "object") return null;
    if (record.additionalProperties === false) return schema;
    if (record.additionalProperties !== undefined) return null;
    return Object.defineProperties({}, {...Object.getOwnPropertyDescriptors(schema), additionalProperties: {value: false, enumerable: true, writable: false, configurable: true}}) as TSchema;
}

/** 定义合同；结构不合法时抛 TypeError。 */
export function defineRemoteService<
    const Methods extends Readonly<Record<string, RemoteMethodSpec>>,
    const Provider extends RemoteProviderLocation,
    const Events extends Readonly<Record<string, RemoteEventSpec>> = Readonly<Record<never, RemoteEventSpec>>,
>(spec: {
    readonly id: string;
    readonly version: number;
    readonly provider: Provider;
    readonly callers: ReadonlyArray<string>;
    readonly methods: Methods;
    readonly events?: Events;
}): RemoteContract<Methods, Events, Provider> {
    const problems: string[] = [];
    const separator = spec.id.indexOf("/");
    if (separator <= 0 || separator === spec.id.length - 1) {
        problems.push(`合同 id 必须写作 <插件 id>/<名称>：${spec.id}`);
    }
    if (spec.id.startsWith(KERNEL_CONTRACT_PREFIX)) {
        problems.push(`合同 id 的前缀 ${KERNEL_CONTRACT_PREFIX} 留给内核：${spec.id}`);
    }
    if (!Number.isInteger(spec.version) || spec.version < 1) {
        problems.push(`版本必须是正整数：${String(spec.version)}`);
    }
    if (!PROVIDER_LOCATIONS.includes(spec.provider)) {
        problems.push(`provider 必须是 ${PROVIDER_LOCATIONS.join("、")} 之一：${String(spec.provider)}`);
    }
    if (spec.callers.length === 0 || spec.callers.some((caller) => caller.trim() === "") || new Set(spec.callers).size !== spec.callers.length) {
        problems.push("callers 必须是不重复的非空运行位置列表");
    }
    const methods: Record<string, RemoteMethodSpec> = {};
    const events: Record<string, RemoteEventSpec> = {};
    const names = new Set<string>();
    for (const [name, method] of Object.entries(spec.methods)) {
        // `events` 与 `at` 是客户端对象上的固定成员，方法不能与它们重名。
        if (name.trim() === "" || name.startsWith("$") || name === "events" || name === "at") {
            problems.push(`方法名不合法：${name}`);
        }
        names.add(name);
        const input = strictObjectSchema(method.input);
        if (input === null) {
            problems.push(`方法 ${name} 的 input 必须是对象 schema，additionalProperties 不写或写 false`);
        }
        methods[name] = input === null || input === method.input ? method : {...method, input};
        if (method.effect !== "read" && method.effect !== "write") {
            problems.push(`方法 ${name} 的 effect 必须是 read 或 write`);
        }
        for (const code of Object.keys(method.errors ?? {})) {
            if (code.trim() === "" || (REMOTE_FAILURE_CODES as ReadonlyArray<string>).includes(code)) {
                problems.push(`方法 ${name} 的业务失败码不合法或与路由层失败码重名：${code}`);
            }
        }
    }
    for (const [name, event] of Object.entries(spec.events ?? {})) {
        if (name.trim() === "" || name.startsWith(RESERVED_KEY_PREFIX) || names.has(name)) {
            problems.push(`事件名不合法或与方法重名：${name}`);
        }
        const filter = strictObjectSchema(event.filter);
        if (filter === null) {
            problems.push(`事件 ${name} 的 filter 必须是对象 schema，additionalProperties 不写或写 false`);
        }
        events[name] = filter === null || filter === event.filter ? event : {...event, filter};
    }
    if (problems.length > 0) {
        throw new TypeError(`远程服务合同 ${spec.id} 不合法：${problems.join("；")}`);
    }
    return Object.freeze({id: spec.id, version: spec.version, provider: spec.provider, callers: Object.freeze([...spec.callers]), methods: methods as Methods, events: events as Events});
}

/** 方法声明过的业务失败码。`errors` 是可选字段：宽类型的方法（`RemoteMethodSpec`）也得到 `string`，不是 never。 */
type BusinessCodes<Method extends RemoteMethodSpec> = NonNullable<Method["errors"]> extends Readonly<Record<string, TSchema>> ? keyof NonNullable<Method["errors"]> & string : never;

/** 一种失败的详情：schema 收 `undefined` 的码（没有详情）可以不写这一项，跨实例传过来时也没有这个键。 */
type DetailOf<Schema extends TSchema> = undefined extends Static<Schema> ? {readonly detail?: Static<Schema>} : {readonly detail: Static<Schema>};

/** 一种业务失败：码与按该码 schema 的详情。按码分布，`detail` 的类型随 `code` 收窄。 */
type BusinessFailure<Method extends RemoteMethodSpec> = {
    readonly [Code in BusinessCodes<Method>]: {readonly ok: false; readonly code: Code} & DetailOf<NonNullable<Method["errors"]>[Code]>;
}[BusinessCodes<Method>];

/** 提供方方法的返回：成功值，或合同声明过的业务失败。用 `ok(value)`、`fail(code, detail)` 构造，不用写 `as const`。 */
export type RemoteOutcome<Method extends RemoteMethodSpec> =
    | {readonly ok: true; readonly value: Static<Method["output"]>}
    | BusinessFailure<Method>;

/** 成功的结果。 */
export function ok<const T>(value: T): {readonly ok: true; readonly value: T} {
    return {ok: true, value};
}

/** 业务失败的结果；`detail` 按合同里这个码的 schema（没有详情的码不写）。 */
export function fail<const Code extends string>(code: Code): {readonly ok: false; readonly code: Code; readonly detail: undefined};
export function fail<const Code extends string, const Detail>(code: Code, detail: Detail): {readonly ok: false; readonly code: Code; readonly detail: Detail};
export function fail(code: string, detail?: unknown): {readonly ok: false; readonly code: string; readonly detail: unknown} {
    return {ok: false, code, detail};
}

export interface RemoteCallContext {
    /** 调用方中止、调用方入口停止、提供方入口停止任一触发即触发。 */
    readonly signal: AbortSignal;
}

/** 某个码的详情参数：没有详情的码（schema 收 `undefined`）可以不写。 */
type DetailArgs<Method extends RemoteMethodSpec, Code extends BusinessCodes<Method>> = undefined extends Static<NonNullable<Method["errors"]>[Code]> ? [detail?: Static<NonNullable<Method["errors"]>[Code]>] : [detail: Static<NonNullable<Method["errors"]>[Code]>];

/**
 * 方法实现收到的上下文：终止信号，加上按这个方法的合同定型的 `ok`、`fail`。码或详情写错时报错落在这一次 `fail(…)` 的参数上，
 * 第一行就写着能用的码；根入口的 `ok`、`fail` 留给写在方法外的辅助函数。
 */
export interface RemoteMethodContext<Method extends RemoteMethodSpec> extends RemoteCallContext {
    ok(value: Static<Method["output"]>): {readonly ok: true; readonly value: Static<Method["output"]>};
    fail<const Code extends BusinessCodes<Method>>(code: Code, ...detail: DetailArgs<Method, Code>): Extract<BusinessFailure<Method>, {readonly code: Code}>;
}

export interface RemoteSink<Payload> {
    next(payload: Payload): void;
}

/** 一个远程事件的提供方实现：每个订阅调用一次 `subscribe`。 */
export interface RemoteEventImplementation<Payload, Filter> {
    subscribe(filter: Filter, sink: RemoteSink<Payload>, context: RemoteCallContext): void | Promise<void>;
}

/** `eventSource` 的结果：本身就是事件的实现（放进 `events` 的那一项），另有 `emit` 推给此刻的订阅。 */
export interface EventSource<Payload, Filter = unknown> extends RemoteEventImplementation<Payload, Filter> {
    /** 推给此刻已登记、`match` 通过的订阅；订阅结束（调用方退订、任一方停止）后不再推给它。 */
    emit(payload: Payload): void;
    /** 此刻的订阅数。 */
    readonly size: number;
}

/**
 * 推事件的助手（docs/specs/runtime/plugin-channel.md 的“事件助手”）：管订阅集合，订阅在 `signal` 触发时移除，提供方只写
 * `emit(值)`。在激活函数或远程实现的工厂里创建，不在模块顶层：在工厂里创建时每个调用方一份，在激活函数里创建时所有调用方
 * 共享；模块顶层的对象会跨入口代次留下。
 *
 * 时序：先登记订阅，再调用 `onSubscribe`（推初始值、建这个订阅自己的资源都写在这里），所以初始值不会排在登记之前的
 * `emit` 之后漏掉。`onSubscribe` 抛错时撤销登记；订阅在 `subscribe` 结算前就已向调用方确认，所以它以 `provider-error` 结束。
 */
export function eventSource<Payload, Filter = unknown>(options: {
    readonly match?: (filter: Filter, payload: Payload) => boolean;
    readonly onSubscribe?: (filter: Filter, sink: RemoteSink<Payload>, context: RemoteCallContext) => void | Promise<void>;
} = {}): EventSource<Payload, Filter> {
    const subscribers = new Set<{readonly filter: Filter; readonly sink: RemoteSink<Payload>}>();
    return {
        async subscribe(filter, sink, context) {
            if (context.signal.aborted) return;
            const entry = {filter, sink};
            subscribers.add(entry);
            context.signal.addEventListener("abort", () => subscribers.delete(entry), {once: true});
            try {
                await options.onSubscribe?.(filter, sink, context);
            } catch (error) {
                subscribers.delete(entry);
                throw error;
            }
        },
        emit(payload) {
            for (const entry of [...subscribers]) {
                if (options.match === undefined || options.match(entry.filter, payload)) entry.sink.next(payload);
            }
        },
        get size() {
            return subscribers.size;
        },
    };
}

/** 提供方为某个调用方交出的实现；调用方身份已由按调用方门面的工厂收到。 */
export interface RemoteImplementation<Contract extends RemoteContract> {
    readonly methods: {
        readonly [Name in keyof Contract["methods"]]: (
            input: Static<Contract["methods"][Name]["input"]>,
            context: RemoteMethodContext<Contract["methods"][Name]>,
        ) => RemoteOutcome<Contract["methods"][Name]> | Promise<RemoteOutcome<Contract["methods"][Name]>>;
    };
    readonly events?: {
        /** 每个订阅调用一次 `subscribe`；`signal` 在订阅因任何原因结束时触发，过滤由这里完成。`eventSource` 给出的就是这一项。 */
        readonly [Name in keyof Contract["events"]]?: RemoteEventImplementation<Static<Contract["events"][Name]["payload"]>, Static<Contract["events"][Name]["filter"]>>;
    };
}

/** 交给提供方工厂的调用方身份；与 runtime.services 的按调用方门面同一身份。 */
export type RemoteConsumer = ConsumerIdentity;

export interface RemoteCallOptions {
    readonly signal?: AbortSignal;
    /** 毫秒；激活期间发出的调用取它与内核上限中较小的一个。 */
    readonly timeout?: number;
}

export interface RemoteSubscription {
    /** 结束订阅；幂等。 */
    release(): void;
}

export interface RemoteSubscribeOptions {
    /** 同一项目代次内重连后订阅已重建：调用方据此重取基线。 */
    readonly onResync?: () => void;
    /** 订阅因提供方停止、连接结束等原因结束；不包括调用方自己 release。 */
    readonly onEnd?: (reason: string) => void;
}

/**
 * `context.remote.use(合同)` 的结果。提供方位置能推出目标时（`server` 与 `project`），它本身就是发往
 * 缺省目标的客户端，`.at()` 可以省略；其余位置必须写 `.at(...)`。`at` 只接受该位置可用的目标。
 */
export type RemoteUse<Contract extends RemoteContract> = Contract["provider"] extends "server" | "project"
    ? RemoteClient<Contract> & {at(target: RemoteTargetFor<Contract["provider"]>): RemoteClient<Contract>}
    : {at(target: RemoteTargetFor<Contract["provider"]>): RemoteClient<Contract>};

/** `context.remote.lookup(合同, 目标?)` 的目标参数：写法与 `use(合同).at(目标)` 相同，`server`、`project` 合同可以省略。 */
export type LookupTarget<Contract extends RemoteContract> = Contract["provider"] extends "server" | "project"
    ? [target?: RemoteTargetFor<Contract["provider"]>]
    : [target: RemoteTargetFor<Contract["provider"]>];

/**
 * 调用方拿到的一个方法的结果：成功、运行时失败（`unavailable`、`timeout` 等，`detail` 是说明），或合同声明过的业务失败
 * （按码区分，`detail` 是该码 schema 的类型）。`if (!r.ok && r.code === "too-many") r.detail.max` 直接有类型。
 */
export type RemoteResultFor<Method extends RemoteMethodSpec> =
    | {readonly ok: true; readonly value: Static<Method["output"]>}
    | RemoteFailure<RemoteFailureCode>
    | (BusinessFailure<Method> & {readonly cause?: RemoteCause});

/** 调用方拿到的客户端：方法返回结构化结果，不抛业务失败。 */
export type RemoteClient<Contract extends RemoteContract> = {
    readonly [Name in keyof Contract["methods"]]: (
        input: Static<Contract["methods"][Name]["input"]>,
        options?: RemoteCallOptions,
    ) => Promise<RemoteResultFor<Contract["methods"][Name]>>;
} & {
    readonly events: {
        readonly [Name in keyof Contract["events"]]: {
            subscribe(
                filter: Static<Contract["events"][Name]["filter"]>,
                listener: (payload: Static<Contract["events"][Name]["payload"]>) => void,
                options?: RemoteSubscribeOptions,
            ): Promise<RemoteResult<RemoteSubscription>>;
        };
    };
};
