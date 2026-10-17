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
 * 行为合同见 docs/specs/runtime/plugin-manifest.md。
 */

import {Type} from "typebox";
import type {Static} from "typebox";
import {Value} from "typebox/value";

import type {RuntimeLocation} from "../lifecycle/lifecycle";
import {defineServiceKey} from "../services/services";

import type {
    ContributionDeclaration,
    PluginDefinition,
    PluginDescriptor,
    PluginEntryDefinition,
} from "../plugins/plugins";
import {KERNEL_ACTIVATION_PREFIXES} from "../plugins/plugins";

/** 一个小写的 id 段：字母或数字开头，只含小写字母、数字与连字符。 */
const ID_SEGMENT = /^[a-z0-9][a-z0-9-]*$/u;

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
}

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

/** TypeBox 的实例路径（`/entries/browser/main`）转成清单字段路径（`entries.browser.main`）。 */
function fieldPath(instancePath: string): string {
    return instancePath.split("/").filter((segment) => segment !== "").join(".");
}

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
    if (!Value.Check(ManifestSchema, value)) {
        const problems: ManifestProblem[] = [...Value.Errors(ManifestSchema, value)].map((error) => ({
            path: fieldPath(error.instancePath),
            message: `${error.instancePath === "" ? "/" : error.instancePath}：${error.message}`,
        }));
        return {status: "invalid", problems: problems.sort(byPath)};
    }
    const input = value as ManifestInput;
    const problems: ManifestProblem[] = [];
    const add = (path: string, message: string): void => {
        problems.push({path, message});
    };

    if (!ID_SEGMENT.test(input.publisher)) add("publisher", `必须是单个小写 id 段（字母或数字开头，只含小写字母、数字与连字符）：${input.publisher}`);
    if (!ID_SEGMENT.test(input.name)) add("name", `必须是单个小写 id 段（字母或数字开头，只含小写字母、数字与连字符）：${input.name}`);
    if (!options.versions.isVersion(input.version)) add("version", `必须是 semver：${input.version}`);
    if (!options.versions.isRange(input.engines.neurobook)) add("engines.neurobook", `必须是版本范围：${input.engines.neurobook}`);
    const id = `${input.publisher}.${input.name}`;
    if (id.startsWith("nbook.") && options.builtin !== true) add("publisher", `第三方插件的 id 不能以 nbook. 开头：${id}`);

    const points = new Set<string>();
    for (const [index, point] of (input.contributionPoints ?? []).entries()) {
        if (points.has(point.id)) add(`contributionPoints.${String(index)}.id`, `贡献点 id 重复：${point.id}`);
        points.add(point.id);
    }

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
        if (entryId.trim() === "") {
            add(at, "入口 id 不能为空");
            continue;
        }
        const main = raw.main;
        const segments = main.split("/");
        if (main.startsWith("/") || main.includes("\\") || main.includes("\0") || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
            add(`${at}.main`, `必须是相对插件目录、不含 .. 的路径：${main}`);
        }
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
        },
    };
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
    /** 把清单里的合同 id 映射成合同对象；缺省时声明了远程服务或代理的入口在映射时失败。 */
    readonly contractOf?: (id: string) => NonNullable<PluginEntryDefinition["remoteProvides"]>[number];
}

/**
 * 某个运行位置的插件定义：本位置的入口，加上本插件拥有的激活事件前缀与贡献点。
 *
 * 顶层声明式贡献由插件描述携带，宿主经 `definitionAt` 并进定义（runtime/plugin-manifest.md 输出 11），这里不重复。
 */
export function definitionOf(manifest: PluginManifest, location: RuntimeLocation, options: DefinitionOptions = {}): PluginDefinition {
    const contractOf = (id: string): NonNullable<PluginEntryDefinition["remoteProvides"]>[number] => {
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
        entries,
        ...(manifest.activationEventPrefixes.length === 0 ? {} : {activationEventPrefixes: manifest.activationEventPrefixes}),
        ...(manifest.contributionPoints.length === 0 ? {} : {contributionPoints: manifest.contributionPoints.map((point) => ({...point}))}),
    };
}
