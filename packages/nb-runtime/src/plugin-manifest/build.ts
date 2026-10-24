/**
 * 由代码定义生成清单（`package.json` 里本能力的字段），是读清单加 `definitionOf` 的反方向：第三方插件的构建预设用它写
 * `package.json`，内置插件的对齐测试用它证明代码定义能用清单表达。生成之后立刻按同一平台读一遍，调用方拿到的要么是
 * 读得回来的清单，要么是问题列表。
 *
 * 远程合同与贡献点的 schema 随清单发布，只能是纯 JSON Schema（`portabilityProblems`）：函数与 TypeBox 的非枚举标记进不了
 * JSON，静默丢掉会让外置的插件校验变宽。
 */

import type {RemoteContract, RemoteProviderLocation} from "../remote/remote";

import type {ContributionPointDefinition, PluginDefinition, PluginDescriptor, PluginEntryDefinition} from "../plugins/plugins";
import {isBuiltinId, portabilityProblems} from "../plugins/plugins";

import {readManifest} from "./read";
import type {ReadContext} from "./read";
import {byPath, contractSchemas, ENTRY_ID, ENTRY_ID_RULE, joinPath} from "./schema";
import type {ManifestContract, ManifestContributionPoint, ManifestProblem, PluginManifest} from "./schema";

/** 生成清单的输入：插件描述、它在各运行位置的代码定义与清单里只能由作者给的字段。 */
export interface ManifestSource {
    readonly descriptor: PluginDescriptor;
    /**
     * 各运行位置的插件定义。同一个定义对象可以出现多次（后端定义同时含服务端与项目入口，常被两个位置共用），按对象
     * 去重；入口按自己的 `location` 归位。
     */
    readonly definitions: ReadonlyArray<PluginDefinition>;
    /** 要求的宿主版本范围，写进 `engines.<平台的引擎键>`。 */
    readonly engine: string;
    readonly pluginVersions?: Readonly<Record<string, string>>;
    readonly displayName?: string;
    readonly description?: string;
    readonly license?: string;
    /** 入口的代码文件；缺省 `<入口 id>.js`。 */
    readonly mainOf?: (entry: PluginEntryDefinition) => string;
    /** 浏览器要加载的样式表；没有样式时不写。 */
    readonly style?: string;
}

export type ManifestBuildResult =
    | {readonly status: "valid"; readonly json: Record<string, unknown>; readonly manifest: PluginManifest}
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

/**
 * 生成并校验。这里先查代码定义特有、清单表达不了的问题，再把生成的清单按读清单的规则读一遍：
 * - 入口 id 在各运行位置之间重复（清单的 `entries` 以入口 id 为键）；
 * - 同一个贡献点在几个位置的 `implementation`、`schema` 或 `idPrefix` 不同；
 * - 合同或贡献点的 schema 进不了 JSON（`portabilityProblems`），或同一合同 id 对应内容不同的两个合同；
 * - 第三方插件的贡献点写了 `validate` 函数：函数进不了清单，宿主登记时没有代码可调（内置插件随产品代码装配，不受限）。
 */
export function buildManifest(source: ManifestSource, context: ReadContext): ManifestBuildResult {
    const {descriptor} = source;
    const {platform, builtin} = context;
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
        if (isBuiltinId(platform, contract.id)) return;
        const known = contracts.get(contract.id);
        if (known !== undefined) {
            if (known.contract !== contract && (known.json === "" || known.json !== jsonOf(contract))) add(`contracts.${contract.id}`, "同一合同 id 对应两份内容不同的合同");
            return;
        }
        const portable = contractSchemas(`contracts.${contract.id}`, contract).flatMap(([path, schema]) => portabilityProblems(schema).map((problem) => ({path: joinPath(path, problem.path), message: problem.message})));
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
    // 两份定义里是两个对象、带着同样不可移植的 schema 时，同一条问题只报一次。
    const reported = new Set<string>();
    const addOnce = (path: string, message: string): void => {
        const key = `${path}\n${message}`;
        if (reported.has(key)) return;
        reported.add(key);
        add(path, message);
    };
    for (const definition of definitions) {
        for (const point of definition.contributionPoints ?? []) {
            const known = points.get(point.id);
            // 两份定义共用同一个贡献点对象：已经查过。
            if (known?.source === point) continue;
            // 与读清单一样按写出的清单里的下标定位：清单的 contributionPoints 是数组。
            const index = [...points.keys()].indexOf(point.id);
            const at = `contributionPoints.${String(index === -1 ? points.size : index)}`;
            const portable = point.schema === undefined ? [] : portabilityProblems(point.schema);
            for (const problem of portable) addOnce(joinPath(`${at}.schema`, problem.path), problem.message);
            if (point.validate !== undefined && !builtin) {
                addOnce(at, "写了 validate 函数：函数进不了清单，宿主里不会运行；用 schema 与 idPrefix 写声明的规则，跨条目的规则放在接收者里");
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
    const json: Record<string, unknown> = {
        publisher: descriptor.id.slice(0, dot),
        name: descriptor.id.slice(dot + 1),
        version: descriptor.version,
        ...(source.displayName === undefined ? {} : {displayName: source.displayName}),
        ...(source.description === undefined ? {} : {description: source.description}),
        ...(source.license === undefined ? {} : {license: source.license}),
        engines: {[platform.engine]: source.engine},
        entries,
        contributes: descriptor.contributions ?? [],
        contributionPoints: [...points.values()].map((point) => point.json),
        activationEventPrefixes: [...new Set(definitions.flatMap((definition) => definition.activationEventPrefixes ?? []))],
        ...(source.pluginVersions === undefined || Object.keys(source.pluginVersions).length === 0 ? {} : {pluginVersions: {...source.pluginVersions}}),
        ...(contracts.size === 0 ? {} : {contracts: Object.fromEntries([...contracts.values()].map(({contract}) => [contract.id, contractJson(contract)]))}),
        ...(source.style === undefined ? {} : {style: source.style}),
    };
    const read = readManifest(json, context);
    return read.status === "valid" ? {status: "valid", json, manifest: read.manifest} : read;
}
