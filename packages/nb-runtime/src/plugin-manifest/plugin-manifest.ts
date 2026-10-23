/**
 * runtime.plugin-manifest：把插件目录的 `package.json` 清单读成插件描述与各运行位置的插件定义。
 *
 * 只做结构与字符串规则校验，不碰文件系统：入口文件是否存在、是否越出插件目录由安装器核对
 * （runtime.plugin-install 输出 2）。内置插件不写清单文件，它的代码定义就是清单；应用侧的对齐测试把代码定义转成
 * 清单格式，经同一个 `readPluginManifest` 校验后转回比对。
 *
 * 版本与版本范围按 npm semver 的写法，校验由调用方经 `versions` 给出：内核的运行时依赖只有 TypeBox，而手写的近似语法
 * 会放过非法写法、拒绝合法写法（Bun 的 `semver.satisfies` 还把写错的范围当成匹配一切）。
 *
 * 贡献点与激活事件前缀按插件声明。第三方插件的定义在它有入口的每个运行位置都带上它们；内置插件的代码定义可以只在
 * 部分位置定义（例如校验函数只在那里用得到），对齐测试按插件汇总比较。
 *
 * 反方向的 `manifestOf` 把代码定义写成清单：第三方插件的构建预设用它生成 `package.json`，内置插件的对齐测试用它证明
 * 代码定义能用清单表达。远程合同与贡献点的 schema 随清单发布，只能是纯 JSON Schema（`portabilityProblems`）：函数与
 * TypeBox 的非枚举标记进不了 JSON，静默丢掉会让外置的插件校验变宽。
 *
 * 行为合同见 docs/specs/runtime/plugin-manifest.md。
 */

import {Type} from "typebox";
import type {Static, TSchema} from "typebox";
import {Value} from "typebox/value";

import type {RuntimeLocation} from "../lifecycle/lifecycle";
import {defineRemoteService} from "../remote/remote";
import type {RemoteContract, RemoteEventSpec, RemoteMethodSpec, RemoteProviderLocation} from "../remote/remote";
import {defineServiceKey} from "../services/services";

import type {
    ContributionDeclaration,
    ContributionPointDefinition,
    PluginDefinition,
    PluginDescriptor,
    PluginEntryDefinition,
} from "../plugins/plugins";
import {KERNEL_ACTIVATION_PREFIXES, portabilityProblems} from "../plugins/plugins";

/**
 * 一个小写的 id 段：字母开头，只含小写字母、数字与连字符。不许数字开头：视图、状态栏条目、菜单这些 id 以插件 id 为前缀、
 * 每段都要字母开头，插件 id 以数字开头时它派生的 id 全被登记校验拒绝。
 */
const ID_SEGMENT = /^[a-z][a-z0-9-]*$/u;

/** 插件 id 的一段（`publisher` 或 `name`）合不合规；作者工具生成插件目录前用它核对。 */
export function isIdSegment(value: string): boolean {
    return ID_SEGMENT.test(value);
}

const NonEmptyString = Type.String({minLength: 1});
const StringArray = Type.Array(NonEmptyString);

const ContributionSchema = Type.Object({
    capability: NonEmptyString,
    id: NonEmptyString,
    declaration: Type.Unknown(),
}, {additionalProperties: false});

const ContributionPointSchema = Type.Object({
    id: NonEmptyString,
    implementation: Type.Union([Type.Literal("required"), Type.Literal("none")]),
    /** 声明的结构，纯 JSON Schema；宿主登记时按它核对别的插件交来的声明，拥有者不必先激活。 */
    schema: Type.Optional(Type.Unknown()),
    /** `"plugin"`：贡献 id 要以贡献方插件 id 加 `.` 开头。 */
    idPrefix: Type.Optional(Type.Literal("plugin")),
}, {additionalProperties: false});

/** 远程合同的 JSON 形式：与 `defineRemoteService` 的参数相同，schema 是 JSON Schema。 */
const ContractSchema = Type.Object({
    id: NonEmptyString,
    version: Type.Integer({minimum: 1}),
    provider: Type.Union([Type.Literal("server"), Type.Literal("project"), Type.Literal("client"), Type.Literal("any")]),
    callers: StringArray,
    methods: Type.Record(Type.String(), Type.Object({
        input: Type.Unknown(),
        output: Type.Unknown(),
        effect: Type.Union([Type.Literal("read"), Type.Literal("write")]),
        errors: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    }, {additionalProperties: false})),
    events: Type.Record(Type.String(), Type.Object({filter: Type.Unknown(), payload: Type.Unknown()}, {additionalProperties: false})),
}, {additionalProperties: false});

const EntrySchema = Type.Object({
    location: NonEmptyString,
    main: NonEmptyString,
    requires: Type.Optional(StringArray),
    optional: Type.Optional(StringArray),
    provides: Type.Optional(StringArray),
    receives: Type.Optional(StringArray),
    activationEvents: Type.Optional(StringArray),
    remoteProvides: Type.Optional(StringArray),
    remoteDelegates: Type.Optional(StringArray),
    contributes: Type.Optional(Type.Array(ContributionSchema)),
}, {additionalProperties: false});

/** `package.json` 里与本能力有关的字段；其它 npm 字段照常存在，不在此校验。 */
const ManifestSchema = Type.Object({
    name: NonEmptyString,
    publisher: NonEmptyString,
    version: NonEmptyString,
    engines: Type.Object({neurobook: NonEmptyString}, {additionalProperties: true}),
    entries: Type.Optional(Type.Record(Type.String(), EntrySchema)),
    contributes: Type.Optional(Type.Array(ContributionSchema)),
    contributionPoints: Type.Optional(Type.Array(ContributionPointSchema)),
    activationEventPrefixes: Type.Optional(StringArray),
    pluginVersions: Type.Optional(Type.Record(Type.String(), NonEmptyString)),
    /** 浏览器要加载的样式表，相对插件目录，规则同入口的 `main`（runtime/plugin-code-loading.md 的样式）。 */
    style: Type.Optional(NonEmptyString),
    /** 入口的 `remoteProvides`、`remoteDelegates` 引用的合同，键是合同 id；`nbook.` 开头的内置合同由宿主提供，不写在这里。 */
    contracts: Type.Optional(Type.Record(Type.String(), ContractSchema)),
});

type ManifestInput = Static<typeof ManifestSchema>;

export interface ManifestContribution {
    readonly capability: string;
    readonly id: string;
    readonly declaration: unknown;
}

export interface ManifestContributionPoint {
    readonly id: string;
    readonly implementation: "required" | "none";
    /** JSON Schema；没写时只核对实现要求与重复。 */
    readonly schema?: unknown;
    readonly idPrefix?: "plugin";
}

/** 清单里的远程合同：`defineRemoteService` 的参数的 JSON 形式。 */
export type ManifestContract = Static<typeof ContractSchema>;

export interface ManifestEntry {
    readonly id: string;
    readonly location: RuntimeLocation;
    /** 相对插件目录的入口代码文件。 */
    readonly main: string;
    readonly requires: ReadonlyArray<string>;
    readonly optional: ReadonlyArray<string>;
    readonly provides: ReadonlyArray<string>;
    readonly receives: ReadonlyArray<string>;
    readonly activationEvents: ReadonlyArray<string>;
    readonly remoteProvides: ReadonlyArray<string>;
    readonly remoteDelegates: ReadonlyArray<string>;
    readonly contributes: ReadonlyArray<ManifestContribution>;
}

/** 规范化的清单：缺省数组已经填成空数组，字段名与 `package.json` 一致。 */
export interface PluginManifest {
    readonly id: string;
    readonly publisher: string;
    readonly name: string;
    readonly version: string;
    readonly engines: {readonly neurobook: string};
    /** 有入口的运行位置，按入口在清单里出现的顺序。 */
    readonly locations: ReadonlyArray<RuntimeLocation>;
    readonly entries: ReadonlyArray<ManifestEntry>;
    readonly contributes: ReadonlyArray<ManifestContribution>;
    readonly contributionPoints: ReadonlyArray<ManifestContributionPoint>;
    readonly activationEventPrefixes: ReadonlyArray<string>;
    readonly pluginVersions: Readonly<Record<string, string>>;
    readonly contracts: Readonly<Record<string, ManifestContract>>;
    /** 浏览器要加载的样式表，相对插件目录；没有为 null。 */
    readonly style: string | null;
}

export interface ManifestProblem {
    /** 相对 `package.json` 根的字段路径，例如 `entries.browser.main`；根上的问题为空字符串。 */
    readonly path: string;
    readonly message: string;
}

export type ManifestReadResult =
    | {readonly status: "valid"; readonly manifest: PluginManifest}
    | {readonly status: "invalid"; readonly problems: ReadonlyArray<ManifestProblem>};

/** 版本写法的校验，按 npm semver（应用侧用 `semver` 包的 `valid` 与 `validRange`）。 */
export interface VersionSyntax {
    isVersion(value: string): boolean;
    isRange(value: string): boolean;
}

export interface ReadManifestOptions {
    readonly versions: VersionSyntax;
    /** 内置插件：允许 `nbook.` 开头的 id 与 `pluginVersions` 里的内置 id。 */
    readonly builtin?: boolean;
}

/**
 * TypeBox 的实例路径（`/entries/browser/main`）转成清单字段路径（`entries.browser.main`）。TypeBox 不转义键里的 `/`，合同 id
 * （`example.notes/index`）在实例路径里会被切成两段：按清单里实际的合同 id 认回来，与语义问题的路径（`contracts.<合同 id>…`）
 * 写法一致。
 */
function fieldPath(instancePath: string, value: unknown): string {
    const contracts = typeof value === "object" && value !== null ? (value as {readonly contracts?: unknown}).contracts : undefined;
    if (instancePath.startsWith("/contracts/") && typeof contracts === "object" && contracts !== null) {
        const rest = instancePath.slice("/contracts/".length);
        const contractId = Object.keys(contracts).sort((left, right) => right.length - left.length).find((key) => rest === key || rest.startsWith(`${key}/`));
        if (contractId !== undefined) return ["contracts", contractId, ...rest.slice(contractId.length).split("/").filter((segment) => segment !== "")].join(".");
    }
    return instancePath.split("/").filter((segment) => segment !== "").join(".");
}

/** 入口 id 也是默认的代码文件名（`<入口 id>.js`），构建预设还用它命名中间文件：只许单个文件名段。 */
const ENTRY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;
const ENTRY_ID_RULE = "入口 id 只能含字母、数字、连字符与下划线，并以字母或数字开头";

function readList(value: ReadonlyArray<string> | undefined): ReadonlyArray<string> {
    return value ?? [];
}

function byPath(left: ManifestProblem, right: ManifestProblem): number {
    return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

/**
 * 读取一份清单。`value` 是 `JSON.parse` 之后的 `package.json` 内容；有任一问题时整份清单无效，
 * 调用方按 runtime.plugin-manifest 的失败规则不登记这个插件。问题按字段路径排序，同一输入总是同一结果。
 */
export function readPluginManifest(value: unknown, options: ReadManifestOptions): ManifestReadResult {
    // 给不可信输入用的校验器：任何意外的异常都报成清单问题，不抛给调用方（读清单在服务端启动的路径上，抛出会让它起不来）。
    try {
        return readManifest(value, options);
    } catch (error) {
        return {status: "invalid", problems: [{path: "", message: `读清单时出错：${error instanceof Error ? error.message : String(error)}`}]};
    }
}

function readManifest(value: unknown, options: ReadManifestOptions): ManifestReadResult {
    if (!Value.Check(ManifestSchema, value)) {
        const problems: ManifestProblem[] = [...Value.Errors(ManifestSchema, value)].map((error) => ({
            path: fieldPath(error.instancePath, value),
            message: `${error.instancePath === "" ? "/" : error.instancePath}：${error.message}`,
        }));
        return {status: "invalid", problems: problems.sort(byPath)};
    }
    const input = value as ManifestInput;
    const problems: ManifestProblem[] = [];
    const add = (path: string, message: string): void => {
        problems.push({path, message});
    };

    if (!ID_SEGMENT.test(input.publisher)) add("publisher", `必须是单个小写 id 段（字母开头，只含小写字母、数字与连字符）：${input.publisher}`);
    if (!ID_SEGMENT.test(input.name)) add("name", `必须是单个小写 id 段（字母开头，只含小写字母、数字与连字符）：${input.name}`);
    if (!options.versions.isVersion(input.version)) add("version", `必须是 semver：${input.version}`);
    if (!options.versions.isRange(input.engines.neurobook)) add("engines.neurobook", `必须是版本范围：${input.engines.neurobook}`);
    const id = `${input.publisher}.${input.name}`;
    if (id.startsWith("nbook.") && options.builtin !== true) add("publisher", `第三方插件的 id 不能以 nbook. 开头：${id}`);

    const points = new Set<string>();
    for (const [index, point] of (input.contributionPoints ?? []).entries()) {
        if (points.has(point.id)) add(`contributionPoints.${String(index)}.id`, `贡献点 id 重复：${point.id}`);
        points.add(point.id);
        if (point.schema !== undefined) {
            for (const problem of portabilityProblems(point.schema)) add(joinPath(`contributionPoints.${String(index)}.schema`, problem.path), problem.message);
        }
    }

    const contracts = input.contracts ?? {};
    for (const [contractId, contract] of Object.entries(contracts)) {
        const at = `contracts.${contractId}`;
        if (contract.id !== contractId) add(`${at}.id`, `与键不一致：${contract.id}`);
        if (contractId.startsWith("nbook.")) add(at, "内置合同由宿主提供，不写进清单");
        for (const [name, method] of Object.entries(contract.methods)) {
            const schemas: Array<[string, unknown]> = [["input", method.input], ["output", method.output], ...Object.entries(method.errors ?? {}).map(([code, schema]): [string, unknown] => [`errors.${code}`, schema])];
            for (const [field, schema] of schemas) {
                for (const problem of portabilityProblems(schema)) add(joinPath(`${at}.methods.${name}.${field}`, problem.path), problem.message);
            }
        }
        for (const [name, event] of Object.entries(contract.events)) {
            for (const [field, schema] of [["filter", event.filter], ["payload", event.payload]] as const) {
                for (const problem of portabilityProblems(schema)) add(joinPath(`${at}.events.${name}.${field}`, problem.path), problem.message);
            }
        }
        // 结构规则（方法名、严格对象的入参、失败码）与代码里的合同同一套：交给 `defineRemoteService` 判断。
        try {
            restoreContract(contract);
        } catch (error) {
            add(at, error instanceof Error ? error.message : String(error));
        }
    }
    const referenced = (contractId: string, path: string): void => {
        if (!contractId.startsWith("nbook.") && !Object.hasOwn(contracts, contractId)) add(path, `引用的合同不在 contracts 里：${contractId}`);
    };

    const seenPrefixes = new Set<string>();
    for (const [index, prefix] of (input.activationEventPrefixes ?? []).entries()) {
        const at = `activationEventPrefixes.${String(index)}`;
        if (prefix.includes(":")) add(at, `前缀不能含冒号：${prefix}`);
        if (prefix === "onStartup") add(at, "onStartup 由内核定义，不能声明为前缀");
        if (KERNEL_ACTIVATION_PREFIXES.includes(prefix)) add(at, `内核保留的前缀：${prefix}`);
        if (seenPrefixes.has(prefix)) add(at, `前缀重复：${prefix}`);
        seenPrefixes.add(prefix);
    }

    for (const [pluginId, range] of Object.entries(input.pluginVersions ?? {})) {
        const at = `pluginVersions.${pluginId}`;
        const segments = pluginId.split(".");
        if (segments.length !== 2 || !segments.every((segment) => ID_SEGMENT.test(segment))) add(at, "键必须是插件 id");
        if (pluginId.startsWith("nbook.") && options.builtin !== true) add(at, "不能约束内置插件的版本");
        if (!options.versions.isRange(range)) add(at, `必须是版本范围：${range}`);
    }

    const entries: ManifestEntry[] = [];
    // 服务属于运行实例：同一位置只能有一个入口提供某个 id，不同位置可以各自提供（plugin-manifest 场景 17）。
    const providersAt = new Map<string, string>();
    for (const [entryId, raw] of Object.entries(input.entries ?? {})) {
        const at = `entries.${entryId}`;
        if (!ENTRY_ID.test(entryId)) {
            add(at, `${ENTRY_ID_RULE}：${entryId}`);
            continue;
        }
        const main = raw.main;
        if (!isInsidePath(main)) add(`${at}.main`, `必须是相对插件目录、不含 .. 的路径：${main}`);
        const provides = readList(raw.provides);
        for (const serviceId of new Set(provides)) {
            if (!serviceId.startsWith(`${id}/`)) add(`${at}.provides`, `服务 id 必须以 ${id}/ 开头：${serviceId}`);
            if (serviceId === `${id}/channel`) add(`${at}.provides`, "服务名 channel 由内核保留");
            const other = providersAt.get(`${raw.location}\n${serviceId}`);
            if (other !== undefined) add(`${at}.provides`, `入口 ${other} 已在 ${raw.location} 提供 ${serviceId}`);
            providersAt.set(`${raw.location}\n${serviceId}`, entryId);
        }
        if (new Set(provides).size !== provides.length) add(`${at}.provides`, "服务 id 重复");
        const remoteProvides = readList(raw.remoteProvides);
        for (const contractId of remoteProvides) {
            if (!contractId.startsWith(`${id}/`)) add(`${at}.remoteProvides`, `合同 id 必须以 ${id}/ 开头：${contractId}`);
        }
        if (new Set(remoteProvides).size !== remoteProvides.length) add(`${at}.remoteProvides`, "合同 id 重复");
        for (const contractId of remoteProvides) referenced(contractId, `${at}.remoteProvides`);
        for (const contractId of readList(raw.remoteDelegates)) referenced(contractId, `${at}.remoteDelegates`);
        const receives = readList(raw.receives);
        for (const point of receives) {
            if (!points.has(point)) add(`${at}.receives`, `只能接收本插件在 contributionPoints 中定义的贡献点：${point}`);
        }
        entries.push({
            id: entryId,
            location: raw.location,
            main,
            requires: readList(raw.requires),
            optional: readList(raw.optional),
            provides,
            receives,
            activationEvents: readList(raw.activationEvents),
            remoteProvides,
            remoteDelegates: readList(raw.remoteDelegates),
            contributes: (raw.contributes ?? []).map((contribution) => ({...contribution})),
        });
    }

    if (input.style !== undefined && !isInsidePath(input.style)) add("style", `必须是相对插件目录、不含 .. 的路径：${input.style}`);

    if (problems.length > 0) return {status: "invalid", problems: problems.sort(byPath)};

    const locations: string[] = [];
    for (const entry of entries) {
        if (!locations.includes(entry.location)) locations.push(entry.location);
    }

    return {
        status: "valid",
        manifest: {
            id,
            publisher: input.publisher,
            name: input.name,
            version: input.version,
            engines: {neurobook: input.engines.neurobook},
            locations,
            entries,
            contributes: (input.contributes ?? []).map((contribution) => ({...contribution})),
            contributionPoints: (input.contributionPoints ?? []).map((point) => ({...point})),
            activationEventPrefixes: readList(input.activationEventPrefixes),
            pluginVersions: {...input.pluginVersions},
            contracts: {...contracts},
            style: input.style ?? null,
        },
    };
}

/** 相对插件目录、不越出它的路径：不以 `/` 开头，不含反斜杠、NUL、空段、`.` 与 `..`。 */
function isInsidePath(path: string): boolean {
    return !path.startsWith("/") && !path.includes("\\") && !path.includes("\0") && path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function joinPath(base: string, inner: string): string {
    return inner === "" ? base : `${base}.${inner}`;
}

/** 清单里的合同还原成合同对象；结构不合法时 `defineRemoteService` 抛出。 */
function restoreContract(contract: ManifestContract): RemoteContract {
    return defineRemoteService({
        id: contract.id,
        version: contract.version,
        provider: contract.provider,
        callers: contract.callers,
        methods: contract.methods as unknown as Readonly<Record<string, RemoteMethodSpec>>,
        events: contract.events as unknown as Readonly<Record<string, RemoteEventSpec>>,
    });
}

/** 清单对应的插件描述：有入口的运行位置与只有声明、不需要实现的顶层贡献。 */
export function descriptorOf(manifest: PluginManifest): PluginDescriptor {
    return {
        id: manifest.id,
        version: manifest.version,
        locations: manifest.locations,
        ...(manifest.contributes.length === 0 ? {} : {contributions: manifest.contributes.map((contribution): ContributionDeclaration => ({...contribution}))}),
    };
}

export interface DefinitionOptions {
    /** 入口的激活实现；代码装载未接入时缺省，激活会明确失败。 */
    readonly activateFor?: (entry: ManifestEntry) => PluginEntryDefinition["activate"];
    /**
     * 不在清单 `contracts` 里的合同 id（内置插件的合同）映射成合同对象；缺省时引用了它们的入口在映射时失败。清单里的
     * 合同由 `definitionOf` 自己还原，同一次调用里同一 id 得到同一个对象。
     */
    readonly contractOf?: (id: string) => NonNullable<PluginEntryDefinition["remoteProvides"]>[number];
}

/**
 * 某个运行位置的插件定义：本位置的入口，加上本插件拥有的激活事件前缀与贡献点。
 *
 * 顶层声明式贡献由插件描述携带，宿主经 `definitionAt` 并进定义（runtime/plugin-manifest.md 输出 11），这里不重复。
 */
export function definitionOf(manifest: PluginManifest, location: RuntimeLocation, options: DefinitionOptions = {}): PluginDefinition {
    // 内核要求入口声明的合同与激活产出的是同一个对象：同一位置的定义里，同一 id 只还原一次。
    const restored = new Map<string, RemoteContract>();
    const contractOf = (id: string): NonNullable<PluginEntryDefinition["remoteProvides"]>[number] => {
        const own = manifest.contracts[id];
        if (own !== undefined) {
            const known = restored.get(id) ?? restoreContract(own);
            restored.set(id, known);
            return known;
        }
        if (options.contractOf === undefined) throw new Error(`插件 ${manifest.id} 声明了远程服务或代理 ${id}，但没有提供合同映射`);
        return options.contractOf(id);
    };
    const entries: PluginEntryDefinition[] = [];
    for (const entry of manifest.entries) {
        if (entry.location !== location) continue;
        const remoteProvides = entry.remoteProvides.map(contractOf);
        const remoteDelegates = entry.remoteDelegates.map(contractOf);
        const dependencies = [
            ...entry.requires.map((serviceId) => ({key: defineServiceKey(serviceId)})),
            ...entry.optional.map((serviceId) => ({key: defineServiceKey(serviceId), required: false})),
        ];
        entries.push({
            id: entry.id,
            location,
            ...(entry.activationEvents.length === 0 ? {} : {activationEvents: entry.activationEvents}),
            ...(dependencies.length === 0 ? {} : {dependencies}),
            ...(entry.provides.length === 0 ? {} : {provides: entry.provides.map((serviceId) => defineServiceKey(serviceId))}),
            ...(entry.receives.length === 0 ? {} : {receives: entry.receives}),
            ...(remoteProvides.length === 0 ? {} : {remoteProvides}),
            ...(remoteDelegates.length === 0 ? {} : {remoteDelegates}),
            ...(entry.contributes.length === 0 ? {} : {contributions: entry.contributes.map((contribution): ContributionDeclaration => ({...contribution}))}),
            activate: options.activateFor?.(entry) ?? (() => {
                throw new Error(`插件 ${manifest.id} 的入口 ${entry.id} 还没有装载代码（runtime.plugin-code-loading）`);
            }),
        });
    }
    return {
        id: manifest.id,
        version: manifest.version,
        ...(Object.keys(manifest.pluginVersions).length === 0 ? {} : {pluginVersions: manifest.pluginVersions}),
        entries,
        ...(manifest.activationEventPrefixes.length === 0 ? {} : {activationEventPrefixes: manifest.activationEventPrefixes}),
        ...(manifest.contributionPoints.length === 0
            ? {}
            : {contributionPoints: manifest.contributionPoints.map(({id, implementation, schema, idPrefix}) => ({id, implementation, ...(schema === undefined ? {} : {schema: schema as TSchema}), ...(idPrefix === undefined ? {} : {idPrefix})}))}),
    };
}

/** `manifestOf` 的输入：插件描述、它在各运行位置的代码定义与清单里只能由作者给的字段。 */
export interface ManifestSource {
    readonly descriptor: PluginDescriptor;
    /**
     * 各运行位置的插件定义。同一个定义对象可以出现多次（后端定义同时含服务端与项目入口，常被两个位置共用），按对象
     * 去重；入口按自己的 `location` 归位。
     */
    readonly definitions: ReadonlyArray<PluginDefinition>;
    readonly engines: {readonly neurobook: string};
    readonly pluginVersions?: Readonly<Record<string, string>>;
    /** 入口的代码文件；缺省 `<入口 id>.js`。 */
    readonly mainOf?: (entry: PluginEntryDefinition) => string;
    /** 浏览器要加载的样式表；没有样式时不写。 */
    readonly style?: string;
}

export type ManifestBuildResult =
    | {readonly status: "valid"; readonly json: Record<string, unknown>}
    | {readonly status: "invalid"; readonly problems: ReadonlyArray<ManifestProblem>};

/** 远程合同写成清单里的 JSON；schema 原样拷贝，能不能拷由调用方先查过。 */
function contractJson(contract: RemoteContract): ManifestContract {
    const clone = (schema: unknown): unknown => JSON.parse(JSON.stringify(schema)) as unknown;
    return {
        id: contract.id,
        version: contract.version,
        provider: contract.provider as RemoteProviderLocation,
        callers: [...contract.callers],
        methods: Object.fromEntries(Object.entries(contract.methods).map(([name, method]) => [name, {
            input: clone(method.input),
            output: clone(method.output),
            effect: method.effect,
            ...(method.errors === undefined ? {} : {errors: Object.fromEntries(Object.entries(method.errors).map(([code, schema]) => [code, clone(schema)]))}),
        }])),
        events: Object.fromEntries(Object.entries(contract.events).map(([name, event]) => [name, {filter: clone(event.filter), payload: clone(event.payload)}])),
    };
}

/** 合同里每一份 schema 与它在清单里的字段路径。 */
function contractSchemas(contract: RemoteContract): Array<readonly [string, unknown]> {
    const at = `contracts.${contract.id}`;
    return [
        ...Object.entries(contract.methods).flatMap(([name, method]): Array<readonly [string, unknown]> => [
            [`${at}.methods.${name}.input`, method.input],
            [`${at}.methods.${name}.output`, method.output],
            ...Object.entries(method.errors ?? {}).map(([code, schema]) => [`${at}.methods.${name}.errors.${code}`, schema] as const),
        ]),
        ...Object.entries(contract.events).flatMap(([name, event]): Array<readonly [string, unknown]> => [
            [`${at}.events.${name}.filter`, event.filter],
            [`${at}.events.${name}.payload`, event.payload],
        ]),
    ];
}

/**
 * 把代码定义写成清单（`package.json` 里本能力的字段），是 `readPluginManifest` 加 `definitionOf` 的反方向。结果还要
 * 经 `readPluginManifest` 校验：这里只查代码定义特有、清单表达不了的问题：
 * - 入口 id 在各运行位置之间重复（清单的 `entries` 以入口 id 为键）；
 * - 同一个贡献点在几个位置的 `implementation`、`schema` 或 `idPrefix` 不同；
 * - 合同或贡献点的 schema 进不了 JSON（`portabilityProblems`），或同一合同 id 对应内容不同的两个合同；
 * - 第三方插件的贡献点写了 `validate` 函数：函数进不了清单，宿主登记时没有代码可调（内置插件随产品代码装配，不受限）。
 */
export function manifestOf(source: ManifestSource, options: {readonly builtin?: boolean} = {}): ManifestBuildResult {
    const {descriptor} = source;
    const problems: ManifestProblem[] = [];
    const add = (path: string, message: string): void => {
        problems.push({path, message});
    };
    const definitions = [...new Set(source.definitions)];
    for (const definition of definitions) {
        if (definition.id !== descriptor.id) add("", `定义的插件 id ${definition.id} 与描述 ${descriptor.id} 不一致`);
    }

    const contracts = new Map<string, {readonly contract: RemoteContract; readonly json: string}>();
    // JSON 表达不了的值（BigInt、循环引用）让序列化抛 TypeError：按“与登记的那份不同”处理，它自己的问题在第一次收集时已报出。
    const jsonOf = (contract: RemoteContract): string | null => {
        try {
            return JSON.stringify(contractJson(contract));
        } catch (error) {
            if (error instanceof TypeError) return null;
            throw error;
        }
    };
    const collect = (contract: RemoteContract): void => {
        if (contract.id.startsWith("nbook.")) return;
        const known = contracts.get(contract.id);
        if (known !== undefined) {
            if (known.contract !== contract && (known.json === "" || known.json !== jsonOf(contract))) add(`contracts.${contract.id}`, "同一合同 id 对应两份内容不同的合同");
            return;
        }
        const portable = contractSchemas(contract).flatMap(([path, schema]) => portabilityProblems(schema).map((problem) => ({path: joinPath(path, problem.path), message: problem.message})));
        problems.push(...portable);
        contracts.set(contract.id, {contract, json: portable.length === 0 ? JSON.stringify(contractJson(contract)) : ""});
    };

    const entries: Record<string, unknown> = {};
    const seen = new Map<string, PluginEntryDefinition>();
    for (const definition of definitions) {
        for (const entry of definition.entries) {
            const known = seen.get(entry.id);
            if (known !== undefined) {
                // 同一个入口对象经两份定义各出现一次（例如两张定义表共用后端入口）不算重复。
                if (known !== entry) add(`entries.${entry.id}`, "入口 id 在两个运行位置重复，清单以入口 id 为键");
                continue;
            }
            seen.set(entry.id, entry);
            if (!ENTRY_ID.test(entry.id)) add(`entries.${entry.id}`, `${ENTRY_ID_RULE}：${entry.id}`);
            const dependencies = entry.dependencies ?? [];
            for (const contract of [...(entry.remoteProvides ?? []), ...(entry.remoteDelegates ?? [])]) collect(contract);
            entries[entry.id] = {
                location: entry.location,
                main: source.mainOf?.(entry) ?? `${entry.id}.js`,
                requires: dependencies.filter((dependency) => dependency.required !== false).map((dependency) => dependency.key.name),
                optional: dependencies.filter((dependency) => dependency.required === false).map((dependency) => dependency.key.name),
                provides: (entry.provides ?? []).map((key) => key.name),
                receives: entry.receives ?? [],
                activationEvents: entry.activationEvents ?? [],
                remoteProvides: (entry.remoteProvides ?? []).map((contract) => contract.id),
                remoteDelegates: (entry.remoteDelegates ?? []).map((contract) => contract.id),
                contributes: entry.contributions ?? [],
            };
        }
    }

    // 每份定义里的贡献点先各自检查，再按 id 聚合：同一个贡献点出现在几个运行位置的定义里时，检查不能只轮到先出现的那一份，
    // 几份也不能按定义的先后取第一份。
    const points = new Map<string, {readonly source: ContributionPointDefinition; readonly json: ManifestContributionPoint; readonly schemaText: string | null}>();
    for (const definition of definitions) {
        for (const point of definition.contributionPoints ?? []) {
            const known = points.get(point.id);
            // 两份定义共用同一个贡献点对象：已经查过。
            if (known?.source === point) continue;
            // 与 readPluginManifest 一样按写出的清单里的下标定位：清单的 contributionPoints 是数组。
            const index = [...points.keys()].indexOf(point.id);
            const at = `contributionPoints.${String(index === -1 ? points.size : index)}`;
            const portable = point.schema === undefined ? [] : portabilityProblems(point.schema);
            for (const problem of portable) add(joinPath(`${at}.schema`, problem.path), problem.message);
            if (point.validate !== undefined && options.builtin !== true) {
                add(at, "写了 validate 函数：函数进不了清单，宿主里不会运行；用 schema 与 idPrefix 写声明的规则，跨条目的规则放在接收者里");
            }
            // 有问题的 schema 不序列化（清单本来就不会生成）：其中进不了 JSON 的值会让序列化抛错。
            const schemaText = point.schema === undefined || portable.length > 0 ? null : JSON.stringify(point.schema);
            if (known !== undefined) {
                if (known.json.implementation !== point.implementation) add(at, "两个运行位置的 implementation 不同");
                if (known.json.idPrefix !== point.idPrefix) add(at, "两个运行位置的 idPrefix 不同");
                if (portable.length === 0 && known.schemaText !== schemaText) add(at, "两个运行位置的 schema 不同");
                continue;
            }
            points.set(point.id, {
                source: point,
                schemaText,
                json: {
                    id: point.id,
                    implementation: point.implementation,
                    ...(schemaText === null ? {} : {schema: JSON.parse(schemaText) as unknown}),
                    ...(point.idPrefix === undefined ? {} : {idPrefix: point.idPrefix}),
                },
            });
        }
    }

    if (problems.length > 0) return {status: "invalid", problems: problems.sort(byPath)};
    const dot = descriptor.id.indexOf(".");
    return {
        status: "valid",
        json: {
            publisher: descriptor.id.slice(0, dot),
            name: descriptor.id.slice(dot + 1),
            version: descriptor.version,
            engines: {neurobook: source.engines.neurobook},
            entries,
            contributes: descriptor.contributions ?? [],
            contributionPoints: [...points.values()].map((point) => point.json),
            activationEventPrefixes: [...new Set(definitions.flatMap((definition) => definition.activationEventPrefixes ?? []))],
            ...(source.pluginVersions === undefined || Object.keys(source.pluginVersions).length === 0 ? {} : {pluginVersions: {...source.pluginVersions}}),
            ...(contracts.size === 0 ? {} : {contracts: Object.fromEntries([...contracts.values()].map(({contract}) => [contract.id, contractJson(contract)]))}),
            ...(source.style === undefined ? {} : {style: source.style}),
        },
    };
}
