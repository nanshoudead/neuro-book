/**
 * 清单的形状：`package.json` 里本能力字段的 TypeBox 模式、读出的规范化清单类型，以及读、写两个方向共用的小工具。
 *
 * 引擎键（`engines.<键>`）随应用不同，由平台档案给出（`platform.ts`），所以清单的顶层模式按键生成。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

import type {RuntimeLocation} from "../lifecycle/lifecycle";
import {defineRemoteService} from "../remote/remote";
import type {RemoteContract, RemoteEventSpec, RemoteMethodSpec} from "../remote/remote";

/**
 * 一个小写的 id 段：字母开头，只含小写字母、数字与连字符。不许数字开头：视图、状态栏条目、菜单这些 id 以插件 id 为前缀、
 * 每段都要字母开头，插件 id 以数字开头时它派生的 id 全被登记校验拒绝。
 */
const ID_SEGMENT = /^[a-z][a-z0-9-]*$/u;

/** id 段规则的说明，清单报错与作者工具的提示共用。 */
export const ID_SEGMENT_RULE = "单个小写 id 段：字母开头，只含小写字母、数字与连字符";

/** 插件 id 的一段（`publisher` 或 `name`）合不合规；作者工具生成插件目录前用它核对。 */
export function isIdSegment(value: string): boolean {
    return ID_SEGMENT.test(value);
}

/** 插件 id：两个 id 段，以 `.` 连接。 */
export function isPluginId(value: string): boolean {
    const segments = value.split(".");
    return segments.length === 2 && segments.every(isIdSegment);
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

/** 消息目录的语言：`source` 是源语言（回退链的第二级），必须在 `locales` 里；每种语言一份 `locales/<语言>.json`。 */
const L10nSchema = Type.Object({
    source: NonEmptyString,
    locales: Type.Array(NonEmptyString, {minItems: 1}),
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

/** `package.json` 里与本能力有关的字段；其它 npm 字段照常存在，不在此校验。`engines` 里只要求平台的引擎键。 */
export function manifestSchema(engine: string) {
    return Type.Object({
        name: NonEmptyString,
        publisher: NonEmptyString,
        version: NonEmptyString,
        /** 给人看的名字与一句说明（npm 的同名字段）；宿主的插件页显示它们。 */
        displayName: Type.Optional(Type.String()),
        description: Type.Optional(Type.String()),
        engines: Type.Object({[engine]: NonEmptyString}, {additionalProperties: true}),
        entries: Type.Optional(Type.Record(Type.String(), EntrySchema)),
        contributes: Type.Optional(Type.Array(ContributionSchema)),
        contributionPoints: Type.Optional(Type.Array(ContributionPointSchema)),
        activationEventPrefixes: Type.Optional(StringArray),
        pluginVersions: Type.Optional(Type.Record(Type.String(), NonEmptyString)),
        /** 浏览器要加载的样式表，相对插件目录，规则同入口的 `main`（runtime/plugin-code-loading.md 的样式）。 */
        style: Type.Optional(NonEmptyString),
        /** 入口的 `remoteProvides`、`remoteDelegates` 引用的合同，键是合同 id；内置合同由宿主提供，不写在这里。 */
        contracts: Type.Optional(Type.Record(Type.String(), ContractSchema)),
        /** 消息目录（runtime/plugin-manifest.md 的 `l10n`）；没有目录的插件不写。 */
        l10n: Type.Optional(L10nSchema),
    });
}

type ManifestSchema = ReturnType<typeof manifestSchema>;

/** 通过顶层模式之后的清单输入；引擎键的值另按平台取。 */
export type ManifestInput = Omit<Static<ManifestSchema>, "engines"> & {readonly engines: Readonly<Record<string, string>>};

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

/** 清单的 `l10n`：语言标签都是规范写法、不重复，源语言在列表里。 */
export type ManifestL10n = Static<typeof L10nSchema>;

/** 规范化的清单：缺省数组已经填成空数组，字段名与 `package.json` 一致。 */
export interface PluginManifest {
    readonly id: string;
    readonly publisher: string;
    readonly name: string;
    readonly version: string;
    /** 给人看的名字；没写或是空串为 null。 */
    readonly displayName: string | null;
    /** 一句说明；没写或是空串为 null。 */
    readonly description: string | null;
    /** `engines.<平台的引擎键>`：插件要求的宿主版本范围。 */
    readonly engine: string;
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
    /** 消息目录的语言；没有目录为 null。 */
    readonly l10n: ManifestL10n | null;
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

/** 入口 id 也是默认的代码文件名（`<入口 id>.js`），构建预设还用它命名中间文件：只许单个文件名段。 */
export const ENTRY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;
export const ENTRY_ID_RULE = "入口 id 只能含字母、数字、连字符与下划线，并以字母或数字开头";

export function byPath(left: ManifestProblem, right: ManifestProblem): number {
    return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

export function joinPath(base: string, inner: string): string {
    return inner === "" ? base : `${base}.${inner}`;
}

/** 相对插件目录、不越出它的路径：不以 `/` 开头，不含反斜杠、NUL、空段、`.` 与 `..`。 */
export function isInsidePath(path: string): boolean {
    return !path.startsWith("/") && !path.includes("\\") && !path.includes("\0") && path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/** 读、写两个方向都要逐个检查合同里的 schema：清单里的合同与代码里的合同共用这个形状。 */
interface ContractShape {
    readonly methods: Readonly<Record<string, {readonly input: unknown; readonly output: unknown; readonly errors?: Readonly<Record<string, unknown>> | undefined}>>;
    readonly events: Readonly<Record<string, {readonly filter: unknown; readonly payload: unknown}>>;
}

/** 合同里每一份 schema 与它在清单里的字段路径（`at` 是合同自己的路径，例如 `contracts.example.notes/index`）。 */
export function contractSchemas(at: string, contract: ContractShape): Array<readonly [string, unknown]> {
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

/** 清单里的合同还原成合同对象；结构不合法时 `defineRemoteService` 抛出。 */
export function restoreContract(contract: ManifestContract): RemoteContract {
    return defineRemoteService({
        id: contract.id,
        version: contract.version,
        provider: contract.provider,
        callers: contract.callers,
        methods: contract.methods as unknown as Readonly<Record<string, RemoteMethodSpec>>,
        events: contract.events as unknown as Readonly<Record<string, RemoteEventSpec>>,
    });
}
