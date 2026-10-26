/**
 * 读清单：`package.json` 的内容经结构与字符串规则校验后，规范成 `PluginManifest`。不碰文件系统：入口文件是否存在、是否
 * 越出插件目录由安装器核对（runtime.plugin-install 输出 2）。
 */

import {Value} from "typebox/value";

import {isBuiltinId, isReservedPublisher, KERNEL_ACTIVATION_PREFIXES, portabilityProblems} from "../plugins/plugins";
import type {PluginPlatform} from "../plugins/plugins";

import {byPath, contractSchemas, ENTRY_ID, ENTRY_ID_RULE, ID_SEGMENT_RULE, isIdSegment, isInsidePath, isPluginId, joinPath, manifestSchema, restoreContract} from "./schema";
import type {ManifestEntry, ManifestInput, ManifestProblem, ManifestReadResult, VersionSyntax} from "./schema";

export interface ReadContext {
    readonly platform: PluginPlatform;
    readonly versions: VersionSyntax;
    readonly schema: ReturnType<typeof manifestSchema>;
    /** 内置插件：允许保留发布者与 `pluginVersions` 里的内置 id。 */
    readonly builtin: boolean;
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

function readList(value: ReadonlyArray<string> | undefined): ReadonlyArray<string> {
    return value ?? [];
}

/**
 * 读取一份清单。有任一问题时整份清单无效，调用方按 runtime.plugin-manifest 的失败规则不登记这个插件。问题按字段路径排序，
 * 同一输入总是同一结果。给不可信输入用：任何意外的异常都报成清单问题，不抛给调用方（读清单在服务端启动的路径上，抛出会
 * 让它起不来）。
 */
export function readManifest(value: unknown, context: ReadContext): ManifestReadResult {
    try {
        return read(value, context);
    } catch (error) {
        return {status: "invalid", problems: [{path: "", message: `读清单时出错：${error instanceof Error ? error.message : String(error)}`}]};
    }
}

function read(value: unknown, context: ReadContext): ManifestReadResult {
    const {platform, versions, schema, builtin} = context;
    if (!Value.Check(schema, value)) {
        const problems: ManifestProblem[] = [...Value.Errors(schema, value)].map((error) => ({
            path: fieldPath(error.instancePath, value),
            message: `${error.instancePath === "" ? "/" : error.instancePath}：${error.message}`,
        }));
        return {status: "invalid", problems: problems.sort(byPath)};
    }
    const input = value as ManifestInput;
    const engine = input.engines[platform.engine]!;
    const problems: ManifestProblem[] = [];
    const add = (path: string, message: string): void => {
        problems.push({path, message});
    };

    if (!isIdSegment(input.publisher)) add("publisher", `必须是${ID_SEGMENT_RULE}：${input.publisher}`);
    if (!isIdSegment(input.name)) add("name", `必须是${ID_SEGMENT_RULE}：${input.name}`);
    if (!versions.isVersion(input.version)) add("version", `必须是 semver：${input.version}`);
    if (!versions.isRange(engine)) add(`engines.${platform.engine}`, `必须是版本范围：${engine}`);
    const id = `${input.publisher}.${input.name}`;
    if (isReservedPublisher(platform, input.publisher) && !builtin) add("publisher", `第三方插件的 id 不能以 ${input.publisher}. 开头，它保留给内置插件：${id}`);

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
        if (isBuiltinId(platform, contractId)) add(at, "内置合同由宿主提供，不写进清单");
        for (const [path, schema] of contractSchemas(at, contract)) {
            for (const problem of portabilityProblems(schema)) add(joinPath(path, problem.path), problem.message);
        }
        // 结构规则（方法名、严格对象的入参、失败码）与代码里的合同同一套：交给 `defineRemoteService` 判断。
        try {
            restoreContract(contract);
        } catch (error) {
            add(at, error instanceof Error ? error.message : String(error));
        }
    }
    const referenced = (contractId: string, path: string): void => {
        if (!isBuiltinId(platform, contractId) && !Object.hasOwn(contracts, contractId)) add(path, `引用的合同不在 contracts 里：${contractId}`);
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
        if (!isPluginId(pluginId)) add(at, "键必须是插件 id");
        if (isBuiltinId(platform, pluginId) && !builtin) add(at, "不能约束内置插件的版本");
        if (!versions.isRange(range)) add(at, `必须是版本范围：${range}`);
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
            displayName: textOrNull(input.displayName),
            description: textOrNull(input.description),
            engine,
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

/** 给人看的文字：去掉首尾空白，空的为 null。 */
function textOrNull(value: string | undefined): string | null {
    const trimmed = value?.trim() ?? "";
    return trimmed === "" ? null : trimmed;
}
