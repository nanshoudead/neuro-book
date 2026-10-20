/**
 * 表单自己的文字（docs/specs/ui/forms.md 输出 24）与 schema 问题的写法（输出 7）。中英两份；其它语言取英文，与
 * `FormText` 的回退一致。
 */

import {FALLBACK_LOCALE, resolveText} from "../text";
import type {FormIssue} from "../validate";

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
    readonly containsIssues: (count: number) => string;
    readonly duplicate: string;
    readonly previousPage: string;
    readonly nextPage: string;
    readonly page: (current: number, total: number) => string;
    /** schema 问题按码写出；`params` 是 TypeBox 给的参数（`limit`、`format` 等）。没有的码用 `fallback`。 */
    readonly codes: Readonly<Record<string, (params: Readonly<Record<string, unknown>>) => string>>;
    readonly fallback: (code: string) => string;
}

const ZH: Messages = {
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

const EN: Messages = {
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

const TABLE: Readonly<Record<string, Messages>> = {"zh-CN": ZH, "en-US": EN};

export function messagesFor(locale: string): Messages {
    return TABLE[locale] ?? TABLE[FALLBACK_LOCALE]!;
}

/** 一条问题显示出来的文字：调用方的问题用它自己的文字，schema 的问题按码写。 */
export function issueText(issue: FormIssue, locale: string): string {
    if (issue.message !== undefined) return resolveText(issue.message, locale);
    const messages = messagesFor(locale);
    const text = messages.codes[issue.code]?.(issue.params) ?? messages.fallback(issue.code);
    // JSON 字段里的问题带着值里的位置（`/a/0`），不写出来用户找不到是哪一处。
    const at = issue.params.at;
    return typeof at === "string" && at !== "" ? `${text}（${at}）` : text;
}
