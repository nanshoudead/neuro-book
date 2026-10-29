/**
 * 贡献声明里的文字按约定取键（docs/specs/ui/i18n.md 的“约定键”）：宿主登记声明时，贡献点的 `complete` 用这里的
 * 补全函数给省略的必填文字字段补上约定键 `<短名>.<本地 id>.<字段>`，给没写命名空间的文字引用补上贡献方插件 id。
 * 补全只在这一处发生；各贡献点的短名与字段写在各自的 Spec 里。
 *
 * 补全是纯函数，不看目录：服务端、项目与浏览器三个位置登记同一份声明，结果必须一样，而内置插件的目录只在浏览器的构建里。
 * 键在目录里缺不缺由声明测试（`catalogKeyProblems`）与窗口的缺键诊断报告，不在登记时拒绝（文字不是功能）。
 */

import {flattenCatalog, isTextRef} from "@notnotype/nb-ui/text";
import type {Catalog, TextRef} from "@notnotype/nb-ui/text";

import type {ContributionDescriptor, PluginDefinition} from "@notnotype/nb-runtime/plugins";

/**
 * 声明里不是界面文字的字段：配置项的 schema 与默认值、命令的参数 schema 与命令引用的参数。它们的值由作者任意给，
 * 形状碰巧像文字引用时也不能改写。
 */
const OPAQUE_FIELDS: ReadonlySet<string> = new Set(["schema", "default", "args"]);

/** 一个列表字段：每一项用 `segment` 取它在键里的段，补 `fields` 里省略的字段。 */
export interface ConventionList {
    /** 这一项在键里的段；返回 null 的项不补（形状不对，交给贡献点的校验拒绝）。 */
    readonly segment: (item: Readonly<Record<string, unknown>>) => string | null;
    readonly fields: ReadonlyArray<string>;
}

/** 一个贡献点的约定：短名、必填的文字字段与列表字段。只补必填字段，可选字段省略就是没有（见 Spec）。 */
export interface ConventionRule {
    readonly name: string;
    readonly fields: ReadonlyArray<string>;
    readonly lists?: Readonly<Record<string, ConventionList>>;
    /** 本地 id 的取法；缺省按 `conventionLocalId`。配置项的键是 `<插件>/<名>`，本地 id 是名。 */
    readonly localId?: (plugin: string, id: string) => string;
}

/** 作者写下的声明：登记时补得上约定键的文字字段可以省略。 */
export type Written<Declaration, Fields extends keyof Declaration> = Omit<Declaration, Fields> & {readonly [Field in Fields]?: Declaration[Field]};

/** 贡献 id 以 `<插件 id>.` 开头时去掉这段前缀，否则用完整 id。 */
export function conventionLocalId(plugin: string, id: string): string {
    const prefix = `${plugin}.`;
    return id.startsWith(prefix) && id.length > prefix.length ? id.slice(prefix.length) : id;
}

/**
 * 贡献点的 `complete`：先给声明里没写命名空间的文字引用补上贡献方插件 id，再按约定补省略的必填字段。`rule` 为 null 的
 * 贡献点（菜单项这类没有约定键的）只补命名空间。认不出的形状原样返回，交给贡献点的 schema 与 validate 拒绝。
 */
export function conventionCompleter(rule: ConventionRule | null): (descriptor: Pick<ContributionDescriptor, "plugin" | "id" | "declaration">) => unknown {
    return (descriptor) => {
        const declaration = withTextNamespace(descriptor.declaration, descriptor.plugin);
        if (rule === null || !isRecord(declaration)) return declaration;
        const local = (rule.localId ?? conventionLocalId)(descriptor.plugin, descriptor.id);
        const reference = (...path: ReadonlyArray<string>): TextRef => ({kind: "text", ns: descriptor.plugin, key: [rule.name, local, ...path].join(".")});
        let completed = fillFields(declaration, rule.fields, (field) => reference(field));
        for (const [listField, list] of Object.entries(rule.lists ?? {})) {
            const items = completed[listField];
            if (!Array.isArray(items)) continue;
            let changed = false;
            const filled = items.map((item: unknown) => {
                if (!isRecord(item)) return item;
                const segment = list.segment(item);
                if (segment === null) return item;
                const next = fillFields(item, list.fields, (field) => reference(listField, segment, field));
                changed ||= next !== item;
                return next;
            });
            if (changed) completed = {...completed, [listField]: filled};
        }
        return completed;
    };
}

/** 给 `value` 里没写 `ns` 的文字引用补上 `ns`；不进 `OPAQUE_FIELDS`。没有改动的部分保持原对象。 */
export function withTextNamespace(value: unknown, ns: string): unknown {
    if (isTextRef(value)) return value.ns === undefined ? {...value, ns} : value;
    if (Array.isArray(value)) {
        const items = value.map((item: unknown) => withTextNamespace(item, ns));
        return items.some((item, index) => item !== value[index]) ? items : value;
    }
    if (!isRecord(value)) return value;
    let result: Record<string, unknown> | null = null;
    for (const [field, item] of Object.entries(value)) {
        if (OPAQUE_FIELDS.has(field)) continue;
        const next = withTextNamespace(item, ns);
        if (next !== item) (result ??= {...value})[field] = next;
    }
    return result ?? value;
}

/** 声明里的全部文字引用（不进 `OPAQUE_FIELDS`），按出现的先后。 */
export function textRefsOf(value: unknown): ReadonlyArray<TextRef> {
    if (isTextRef(value)) return [value];
    if (Array.isArray(value)) return value.flatMap((item: unknown) => textRefsOf(item));
    if (!isRecord(value)) return [];
    return Object.entries(value).flatMap(([field, item]) => (OPAQUE_FIELDS.has(field) ? [] : textRefsOf(item)));
}

/** 一个插件的目录：源语言与各语言的目录（同 `web/plugins.ts` 的 `BuiltinCatalogs`）。 */
export interface PluginCatalogs {
    readonly source: string;
    readonly catalogs: Readonly<Record<string, Catalog>>;
}

/** 声明测试报出的一条：哪个贡献的哪个引用在源语言目录里找不到。 */
export interface CatalogKeyProblem {
    readonly capability: string;
    readonly contribution: string;
    readonly ns: string;
    readonly key: string;
    /** `no-catalog`：命名空间没有目录；`missing-key`：源语言目录里没有这个键（复数键看 `_other`）。 */
    readonly reason: "no-catalog" | "missing-key";
}

/**
 * 声明测试（docs/specs/ui/i18n.md 的“约定键”）：按插件定义里的贡献点补全每条贡献的声明，核对补出的约定键与显式写的
 * 引用都在所属命名空间的源语言目录里。贡献点与贡献都从 `definitions` 里找，所以要传齐拥有者与贡献方的定义；找不到
 * 贡献点的贡献不补，只核对显式写的引用。命名空间不是插件 id 的引用（共享包的目录）不在这里核对。
 */
export function catalogKeyProblems(definitions: ReadonlyArray<PluginDefinition>, catalogs: Readonly<Record<string, PluginCatalogs>>): ReadonlyArray<CatalogKeyProblem> {
    const points = new Map(definitions.flatMap((definition) => (definition.contributionPoints ?? []).map((point) => [point.id, point] as const)));
    const plugins = new Set(definitions.map((definition) => definition.id));
    const flat = new Map<string, ReadonlySet<string>>();
    const keysOf = (ns: string): ReadonlySet<string> | null => {
        const entry = catalogs[ns];
        const source = entry?.catalogs[entry.source];
        if (source === undefined) return null;
        let keys = flat.get(ns);
        if (keys === undefined) {
            keys = new Set(Object.keys(flattenCatalog(source)));
            flat.set(ns, keys);
        }
        return keys;
    };
    const problems: CatalogKeyProblem[] = [];
    const seen = new Set<string>();
    for (const definition of definitions) {
        const contributions = [...(definition.contributions ?? []).map((contribution) => ({contribution, entry: null})), ...definition.entries.flatMap((entry) => (entry.contributions ?? []).map((contribution) => ({contribution, entry})))];
        for (const {contribution, entry} of contributions) {
            const point = points.get(contribution.capability);
            // 顶层声明三个位置都登记；补全不看运行位置，顶层声明这里按服务端给。
            const descriptor: ContributionDescriptor = {...contribution, plugin: definition.id, entry: entry?.id ?? null, location: entry?.location ?? "server"};
            const declaration = point?.complete === undefined ? withTextNamespace(contribution.declaration, definition.id) : point.complete(descriptor);
            for (const ref of textRefsOf(declaration)) {
                const ns = ref.ns ?? definition.id;
                if (!plugins.has(ns)) continue;
                const identity = `${contribution.capability}\n${contribution.id}\n${ns}\n${ref.key}`;
                if (seen.has(identity)) continue;
                seen.add(identity);
                const keys = keysOf(ns);
                if (keys === null) problems.push({capability: contribution.capability, contribution: contribution.id, ns, key: ref.key, reason: "no-catalog"});
                else if (!keys.has(ref.key) && !keys.has(`${ref.key}_other`)) problems.push({capability: contribution.capability, contribution: contribution.id, ns, key: ref.key, reason: "missing-key"});
            }
        }
    }
    return problems;
}

function fillFields(value: Readonly<Record<string, unknown>>, fields: ReadonlyArray<string>, reference: (field: string) => TextRef): Readonly<Record<string, unknown>> {
    const missing = fields.filter((field) => value[field] === undefined);
    if (missing.length === 0) return value;
    return {...value, ...Object.fromEntries(missing.map((field) => [field, reference(field)]))};
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
