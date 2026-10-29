/**
 * nb-form 自带的目录（docs/specs/ui/forms.md 输出 7、24，docs/specs/ui/i18n.md 的“目录与键”）。
 *
 * 防止迁移改错文字：`LEGACY_ZH`、`LEGACY_EN` 是迁移前（提交 452ae72bf 的 `src/vue/messages.ts`）两张表的原样，文字是
 * 函数。每个条目用样例参数调用旧函数，与目录经严格的最小实现翻译出的文字逐字相同；带数量的取 1 与 2、问题的码取
 * 各种参数（含缺参数）。目录里每个键（复数形归到不带后缀的键）都要被某个条目用到，旧表的每个条目都要有对照。以后有意
 * 改文字时，同一次改动里同步改这两张表。
 *
 * 仓库的目录检查（`scripts/ci/message-catalogs.ts`）只查 JSON 目录，这份 `.ts` 目录的键与占位符一致性由这里核对。
 */

import {describe, expect, it} from "bun:test";

import {flattenCatalog} from "@notnotype/nb-ui/text";
import type {TextRef} from "@notnotype/nb-ui/text";
import {createMinimalTranslator} from "@notnotype/nb-ui/text/minimal";

import {formRef, issueWording} from "./builtin-text";
import type {FormTextKey} from "./builtin-text";
import {NB_FORM_CATALOGS, NB_FORM_NAMESPACE, NB_FORM_SOURCE_LOCALE} from "./locales";
import {SCHEMA_ISSUE_CODES} from "./validate";

// 以下到 LEGACY_EN 结束是迁移前 src/vue/messages.ts 的原样。
interface Messages {
    readonly clear: string;
    readonly stale: string;
    readonly recommended: string;
    readonly default: string;
    readonly defaultValue: (value: string) => string;
    readonly yes: string;
    readonly no: string;
    readonly set: string;
    readonly unset: string;
    readonly loading: string;
    readonly noSource: string;
    readonly issueCount: (count: number) => string;
    readonly expand: string;
    readonly collapse: string;
    readonly copy: string;
    readonly copied: string;
    readonly copyFailed: string;
    readonly empty: string;
    readonly increment: string;
    readonly decrement: string;
    readonly clearInput: string;
    readonly noMatch: string;
    readonly warning: string;
    readonly required: string;
    readonly unit: (unit: string) => string;
    readonly fillIn: string;
    readonly copyOf: (label: string) => string;
    readonly expandOf: (label: string) => string;
    readonly collapseOf: (label: string) => string;
    readonly add: string;
    readonly remove: string;
    readonly moveUp: string;
    readonly moveDown: string;
    readonly item: (position: number) => string;
    readonly items: (count: number) => string;
    readonly noItems: string;
    readonly moved: (from: number, to: number) => string;
    readonly removed: (position: number) => string;
    readonly added: (position: number) => string;
    /** 增删排序被调用方退回（例如写入失败）。 */
    readonly notApplied: string;
    readonly containsIssues: (count: number) => string;
    readonly duplicate: string;
    readonly previousPage: string;
    readonly nextPage: string;
    readonly page: (current: number, total: number) => string;
    /** schema 问题按码写出；`params` 是 TypeBox 给的参数（`limit`、`format` 等）。没有的码用 `fallback`。 */
    readonly codes: Readonly<Record<string, (params: Readonly<Record<string, unknown>>) => string>>;
    readonly fallback: (code: string) => string;
}

const LEGACY_ZH: Messages = {
    clear: "清除",
    stale: "已不存在",
    recommended: "推荐",
    default: "默认",
    defaultValue: (value) => `默认：${value}`,
    yes: "是",
    no: "否",
    set: "已设置",
    unset: "未设置",
    loading: "加载中…",
    noSource: "没有选项来源",
    issueCount: (count) => `${String(count)} 个问题`,
    expand: "展开",
    collapse: "收起",
    copy: "复制",
    copied: "已复制",
    copyFailed: "复制失败",
    empty: "（空）",
    increment: "增加",
    decrement: "减少",
    clearInput: "清空输入",
    noMatch: "没有匹配的选项",
    warning: "警告",
    required: "必填",
    unit: (unit) => `单位：${unit}`,
    fillIn: "填写",
    copyOf: (label) => `复制：${label}`,
    expandOf: (label) => `展开：${label}`,
    collapseOf: (label) => `收起：${label}`,
    add: "添加",
    remove: "删除",
    moveUp: "上移",
    moveDown: "下移",
    item: (position) => `第 ${String(position)} 项`,
    items: (count) => `${String(count)} 项`,
    noItems: "还没有项",
    moved: (from, to) => `第 ${String(from)} 项移到第 ${String(to)} 位`,
    removed: (position) => `已删除第 ${String(position)} 项`,
    added: (position) => `已添加第 ${String(position)} 项`,
    notApplied: "刚才的改动没有生效",
    containsIssues: (count) => `含 ${String(count)} 个问题`,
    duplicate: "重复",
    previousPage: "上一页",
    nextPage: "下一页",
    page: (current, total) => `第 ${String(current)} / ${String(total)} 页`,
    codes: {
        "required": () => "必填",
        "type": () => "类型不对",
        "min-length": (params) => `至少 ${String(params.limit)} 个字符`,
        "max-length": (params) => `至多 ${String(params.limit)} 个字符`,
        "pattern": () => "格式不对",
        "format": () => "格式不对",
        "minimum": (params) => (params.comparison === ">" ? `必须大于 ${String(params.limit)}` : `不能小于 ${String(params.limit)}`),
        "maximum": (params) => (params.comparison === "<" ? `必须小于 ${String(params.limit)}` : `不能大于 ${String(params.limit)}`),
        "multiple-of": (params) => `必须是 ${String(params.multipleOf)} 的倍数`,
        "min-items": (params) => `至少 ${String(params.limit)} 项`,
        "max-items": (params) => `至多 ${String(params.limit)} 项`,
        "unique-items": () => "有重复的项",
        "not-in-choices": () => "不是可选的值",
        "no-match": () => "不符合任何一种写法",
        "unparseable": () => "无法解析",
        "read-only": () => "只读的内容不能改",
        "schema-error": () => "描述有误，无法校验",
        "contains": () => "缺少符合要求的项",
        "min-contains": (params) => `符合要求的项至少 ${String(params.limit ?? params.minContains ?? "")} 个`,
        "max-contains": (params) => `符合要求的项至多 ${String(params.limit ?? params.maxContains ?? "")} 个`,
        "min-properties": (params) => `至少填写 ${String(params.limit)} 项`,
        "max-properties": (params) => `至多填写 ${String(params.limit)} 项`,
        "dependent-required": () => "缺少与已填内容配套的项",
        "dependent-schemas": () => "与已填内容配套的部分不符合要求",
        "additional-property": (params) => (typeof params.key === "string" ? `不认识的项：${params.key}` : "有不认识的项"),
        "property-names": () => "有名称不合要求的项",
        "one-of": () => "必须恰好符合一种写法",
        "not": () => "写成了不允许的形式",
        "if-then": () => "不满足条件对应的要求",
    },
    fallback: (code) => `不符合要求（${code}）`,
};

const LEGACY_EN: Messages = {
    clear: "Clear",
    stale: "No longer available",
    recommended: "Recommended",
    default: "Default",
    defaultValue: (value) => `Default: ${value}`,
    yes: "Yes",
    no: "No",
    set: "Set",
    unset: "Not set",
    loading: "Loading…",
    noSource: "No option source",
    issueCount: (count) => (count === 1 ? "1 issue" : `${String(count)} issues`),
    expand: "Expand",
    collapse: "Collapse",
    copy: "Copy",
    copied: "Copied",
    copyFailed: "Copy failed",
    empty: "(empty)",
    increment: "Increase",
    decrement: "Decrease",
    clearInput: "Clear input",
    noMatch: "No matching options",
    warning: "Warning",
    required: "required",
    unit: (unit) => `Unit: ${unit}`,
    fillIn: "Fill in",
    copyOf: (label) => `Copy: ${label}`,
    expandOf: (label) => `Expand: ${label}`,
    collapseOf: (label) => `Collapse: ${label}`,
    add: "Add",
    remove: "Remove",
    moveUp: "Move up",
    moveDown: "Move down",
    item: (position) => `Item ${String(position)}`,
    items: (count) => (count === 1 ? "1 item" : `${String(count)} items`),
    noItems: "No items yet",
    moved: (from, to) => `Item ${String(from)} moved to position ${String(to)}`,
    removed: (position) => `Item ${String(position)} removed`,
    added: (position) => `Item ${String(position)} added`,
    notApplied: "The last change was not applied",
    containsIssues: (count) => (count === 1 ? "1 issue inside" : `${String(count)} issues inside`),
    duplicate: "Duplicate",
    previousPage: "Previous page",
    nextPage: "Next page",
    page: (current, total) => `Page ${String(current)} of ${String(total)}`,
    codes: {
        "required": () => "Required",
        "type": () => "Wrong type",
        "min-length": (params) => `At least ${String(params.limit)} characters`,
        "max-length": (params) => `At most ${String(params.limit)} characters`,
        "pattern": () => "Invalid format",
        "format": () => "Invalid format",
        "minimum": (params) => (params.comparison === ">" ? `Must be greater than ${String(params.limit)}` : `Must be at least ${String(params.limit)}`),
        "maximum": (params) => (params.comparison === "<" ? `Must be less than ${String(params.limit)}` : `Must be at most ${String(params.limit)}`),
        "multiple-of": (params) => `Must be a multiple of ${String(params.multipleOf)}`,
        "min-items": (params) => `At least ${String(params.limit)} items`,
        "max-items": (params) => `At most ${String(params.limit)} items`,
        "unique-items": () => "Contains duplicates",
        "not-in-choices": () => "Not one of the options",
        "no-match": () => "Does not match any allowed form",
        "unparseable": () => "Cannot be parsed",
        "read-only": () => "Read-only content cannot be changed",
        "schema-error": () => "The description is invalid and cannot be checked",
        "contains": () => "Missing a matching item",
        "min-contains": (params) => `At least ${String(params.limit ?? params.minContains ?? "")} matching items`,
        "max-contains": (params) => `At most ${String(params.limit ?? params.maxContains ?? "")} matching items`,
        "min-properties": (params) => `At least ${String(params.limit)} entries`,
        "max-properties": (params) => `At most ${String(params.limit)} entries`,
        "dependent-required": () => "Missing entries required by what is filled in",
        "dependent-schemas": () => "Does not meet the requirements of what is filled in",
        "additional-property": (params) => (typeof params.key === "string" ? `Unknown entry: ${params.key}` : "Has unknown entries"),
        "property-names": () => "Has entries with invalid names",
        "one-of": () => "Must match exactly one allowed form",
        "not": () => "Uses a form that is not allowed",
        "if-then": () => "Does not meet the conditional requirements",
    },
    fallback: (code) => `Invalid (${code})`,
};

const translator = createMinimalTranslator({catalogs: {[NB_FORM_NAMESPACE]: NB_FORM_CATALOGS}, strict: true});
const LEGACY: Readonly<Record<string, Messages>> = {"zh-CN": LEGACY_ZH, "en-US": LEGACY_EN};

type Case = readonly [field: keyof Messages, legacy: (messages: Messages) => string, ref: TextRef];

/** 旧表的每个文字条目（`codes`、`fallback` 另外对照）：样例参数下的旧写法与新的引用。 */
const CASES: ReadonlyArray<Case> = [
    ["clear", (m) => m.clear, formRef("clear")],
    ["stale", (m) => m.stale, formRef("stale")],
    ["recommended", (m) => m.recommended, formRef("recommended")],
    ["default", (m) => m.default, formRef("default")],
    ["defaultValue", (m) => m.defaultValue("12"), formRef("defaultValue", {value: "12"})],
    ["yes", (m) => m.yes, formRef("yes")],
    ["no", (m) => m.no, formRef("no")],
    ["set", (m) => m.set, formRef("set")],
    ["unset", (m) => m.unset, formRef("unset")],
    ["loading", (m) => m.loading, formRef("loading")],
    ["noSource", (m) => m.noSource, formRef("noSource")],
    ["issueCount", (m) => m.issueCount(1), formRef("issueCount", {count: 1})],
    ["issueCount", (m) => m.issueCount(2), formRef("issueCount", {count: 2})],
    ["expand", (m) => m.expand, formRef("expand")],
    ["collapse", (m) => m.collapse, formRef("collapse")],
    ["copy", (m) => m.copy, formRef("copy")],
    ["copied", (m) => m.copied, formRef("copied")],
    ["copyFailed", (m) => m.copyFailed, formRef("copyFailed")],
    ["empty", (m) => m.empty, formRef("empty")],
    ["increment", (m) => m.increment, formRef("increment")],
    ["decrement", (m) => m.decrement, formRef("decrement")],
    ["clearInput", (m) => m.clearInput, formRef("clearInput")],
    ["noMatch", (m) => m.noMatch, formRef("noMatch")],
    ["warning", (m) => m.warning, formRef("warning")],
    ["required", (m) => m.required, formRef("required")],
    ["unit", (m) => m.unit("px"), formRef("unit", {unit: "px"})],
    ["fillIn", (m) => m.fillIn, formRef("fillIn")],
    ["copyOf", (m) => m.copyOf("路径"), formRef("copyOf", {label: "路径"})],
    ["expandOf", (m) => m.expandOf("路径"), formRef("expandOf", {label: "路径"})],
    ["collapseOf", (m) => m.collapseOf("路径"), formRef("collapseOf", {label: "路径"})],
    ["add", (m) => m.add, formRef("add")],
    ["remove", (m) => m.remove, formRef("remove")],
    ["moveUp", (m) => m.moveUp, formRef("moveUp")],
    ["moveDown", (m) => m.moveDown, formRef("moveDown")],
    ["item", (m) => m.item(3), formRef("item", {position: 3})],
    ["items", (m) => m.items(1), formRef("items", {count: 1})],
    ["items", (m) => m.items(2), formRef("items", {count: 2})],
    ["noItems", (m) => m.noItems, formRef("noItems")],
    ["moved", (m) => m.moved(2, 1), formRef("moved", {from: 2, to: 1})],
    ["removed", (m) => m.removed(2), formRef("removed", {position: 2})],
    ["added", (m) => m.added(4), formRef("added", {position: 4})],
    ["notApplied", (m) => m.notApplied, formRef("notApplied")],
    ["containsIssues", (m) => m.containsIssues(1), formRef("containsIssues", {count: 1})],
    ["containsIssues", (m) => m.containsIssues(3), formRef("containsIssues", {count: 3})],
    ["duplicate", (m) => m.duplicate, formRef("duplicate")],
    ["previousPage", (m) => m.previousPage, formRef("previousPage")],
    ["nextPage", (m) => m.nextPage, formRef("nextPage")],
    ["page", (m) => m.page(2, 5), formRef("page", {current: 2, total: 5})],
];

/** 拼句子的键：样例参数与迁移前代码的中文写法（`${label}：${wording}`、`${wording}（${at}）`、`（必填）`、`；`）。 */
const FORMAT_ZH: ReadonlyArray<readonly [FormTextKey, Readonly<Record<string, string>>, string]> = [
    ["format.labelled", {label: "上移", text: "第 1 项"}, "上移：第 1 项"],
    ["format.labelPrefix", {label: "警告"}, "警告："],
    ["format.noted", {text: "不能为空", note: "/a/0"}, "不能为空（/a/0）"],
    ["format.note", {note: "必填"}, "（必填）"],
    ["format.clauseSeparator", {}, "；"],
];

/** 问题的参数样例：TypeBox 给的常见参数、两种比较、有无 `key`，以及缺参数（旧写法写出 `undefined`）。 */
const PARAMS: ReadonlyArray<Readonly<Record<string, unknown>>> = [
    {limit: 2},
    {limit: 5, comparison: ">"},
    {limit: 5, comparison: "<"},
    {limit: 5, comparison: ">="},
    {multipleOf: 3},
    {minContains: 4},
    {maxContains: 6},
    {key: "extra"},
    {},
];

const issue = (code: string, params: Readonly<Record<string, unknown>>) => ({path: [], code, params, severity: "error" as const, source: "schema" as const});

/** 目录的键，复数形归到不带后缀的键。 */
function keysOf(locale: string): Set<string> {
    return new Set(Object.keys(flattenCatalog(NB_FORM_CATALOGS[locale]!)).map((key) => key.replace(/_(?:zero|one|two|few|many|other)$/u, "")));
}

describe("nb-form 的目录", () => {
    it("命名空间与源语言", () => {
        expect(NB_FORM_NAMESPACE).toBe("nb-form");
        expect(NB_FORM_SOURCE_LOCALE).toBe("zh-CN");
        expect(formRef("add")).toEqual({kind: "text", ns: "nb-form", key: "add"});
    });

    it("两种语言的键相同；中文带数量的写 _other，英文写 _one 与 _other", () => {
        expect([...keysOf("en-US")].sort()).toEqual([...keysOf("zh-CN")].sort());
        const zh = Object.keys(flattenCatalog(NB_FORM_CATALOGS["zh-CN"]!)).filter((key) => /_(?:one|other)$/u.test(key));
        const en = Object.keys(flattenCatalog(NB_FORM_CATALOGS["en-US"]!)).filter((key) => /_(?:one|other)$/u.test(key));
        expect(zh.sort()).toEqual(["containsIssues_other", "issueCount_other", "items_other"]);
        expect(en.sort()).toEqual(["containsIssues_one", "containsIssues_other", "issueCount_one", "issueCount_other", "items_one", "items_other"]);
    });

    it("每个条目在样例参数下与迁移前的文字逐字相同", () => {
        for (const locale of ["zh-CN", "en-US"]) {
            for (const [field, legacy, ref] of CASES) {
                expect(translator.translate(ref, locale), `${locale} ${field} ${JSON.stringify(ref.params ?? {})}`).toBe(legacy(LEGACY[locale]!));
            }
        }
    });

    it("问题的每个码、每组参数与迁移前的写法逐字相同，没有写法的码用 fallback", () => {
        const codes = [...new Set([...Object.keys(LEGACY_ZH.codes), ...Object.keys(LEGACY_EN.codes), ...SCHEMA_ISSUE_CODES, "x-custom"])];
        for (const locale of ["zh-CN", "en-US"]) {
            const messages = LEGACY[locale]!;
            for (const code of codes) {
                for (const params of PARAMS) {
                    const expected = messages.codes[code]?.(params) ?? messages.fallback(code);
                    expect(translator.translate(issueWording(issue(code, params)), locale), `${locale} ${code} ${JSON.stringify(params)}`).toBe(expected);
                }
            }
        }
    });

    it("旧表的每个条目都有对照，目录的每个键都有条目用到", () => {
        const legacyFields = Object.keys(LEGACY_ZH).filter((field) => field !== "codes" && field !== "fallback");
        expect([...new Set(CASES.map(([field]): string => field))].sort()).toEqual(legacyFields.sort());
        const used = new Set(CASES.map(([, , ref]) => ref.key));
        for (const code of Object.keys(LEGACY_ZH.codes)) {
            for (const params of PARAMS) {
                const wording = issueWording(issue(code, params));
                if (typeof wording === "object" && "key" in wording) used.add(wording.key as string);
            }
        }
        used.add("fallback");
        used.add("listSeparator");
        for (const [key] of FORMAT_ZH) used.add(key);
        expect([...keysOf("zh-CN")].filter((key) => !used.has(key))).toEqual([]);
    });

    it("连接选项名字的分隔符（迁移前写在代码里：中文“、”，其余“, ”）", () => {
        expect(translator.translate(formRef("listSeparator"), "zh-CN")).toBe("、");
        expect(translator.translate(formRef("listSeparator"), "en-US")).toBe(", ");
    });

    it("拼句子的标点：中文与迁移前代码里写死的全角标点逐字相同，英文不出现全角标点", () => {
        for (const [key, params, legacyZh] of FORMAT_ZH) {
            expect(translator.translate(formRef(key, params), "zh-CN"), key).toBe(legacyZh);
            expect(translator.translate(formRef(key, params), "en-US"), key).not.toMatch(/[\u3000-\u303f\uff00-\uffef]/u);
        }
        expect(translator.translate(formRef("format.labelled", {label: "Move up", text: "Item 1"}), "en-US")).toBe("Move up: Item 1");
        expect(translator.translate(formRef("format.noted", {text: "x", note: "/a/0"}), "en-US")).toBe("x (/a/0)");
    });

    it("调用方的问题用它自己的文字", () => {
        expect(issueWording({...issue("taken", {}), source: "caller", message: {"zh-CN": "已被占用", "en-US": "Taken"}})).toEqual({"zh-CN": "已被占用", "en-US": "Taken"});
    });
});
