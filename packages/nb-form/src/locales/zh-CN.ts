/**
 * nb-form 自带的中文目录（命名空间 `nb-form`，源语言），写法见同目录的 `index.ts`。引用的键类型从这份推出
 * （`FormTextKey`，`../builtin-text.ts`），引用写不带复数后缀的键加参数 `count`。
 *
 * 带数量的键写成 `<键>_other`、不写不带后缀的键：中文只有 other 这一种复数形，写法与 nb-agent-ui 的目录一致。
 * `codes` 下按问题的码取（docs/specs/ui/forms.md 输出 7）；同一个码按参数有两种写法的，另一种写在 `<码>-exclusive`、
 * `<码>-unnamed` 这样的键里，由代码选键。
 */

import type {Catalog} from "@notnotype/nb-ui/text";

export default {
    clear: "清除",
    stale: "已不存在",
    recommended: "推荐",
    default: "默认",
    defaultValue: "默认：{{value}}",
    yes: "是",
    no: "否",
    set: "已设置",
    unset: "未设置",
    loading: "加载中…",
    noSource: "没有选项来源",
    issueCount_other: "{{count}} 个问题",
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
    unit: "单位：{{unit}}",
    fillIn: "填写",
    copyOf: "复制：{{label}}",
    expandOf: "展开：{{label}}",
    collapseOf: "收起：{{label}}",
    add: "添加",
    remove: "删除",
    moveUp: "上移",
    moveDown: "下移",
    item: "第 {{position}} 项",
    items_other: "{{count}} 项",
    noItems: "还没有项",
    moved: "第 {{from}} 项移到第 {{to}} 位",
    removed: "已删除第 {{position}} 项",
    added: "已添加第 {{position}} 项",
    notApplied: "刚才的改动没有生效",
    containsIssues_other: "含 {{count}} 个问题",
    duplicate: "重复",
    previousPage: "上一页",
    nextPage: "下一页",
    page: "第 {{current}} / {{total}} 页",
    /** 几个选项名字连起来（缺值时的“默认：A、B”、展示态里多选的值）。 */
    listSeparator: "、",
    /** 代码里拼句子用的标点（迁移前写死的全角标点）：英文目录用半角，由语言决定。 */
    format: {
        /** 字段名加一句话：问题汇总、`describeIssues`、按钮的读屏名。 */
        labelled: "{{label}}：{{text}}",
        /** 读屏前缀，后面紧跟另一个元素里的文字。 */
        labelPrefix: "{{label}}：",
        /** 一句话加括注：JSON 里的位置、已不存在的选项。 */
        noted: "{{text}}（{{note}}）",
        /** 只有括注，接在前一个元素的文字后面。 */
        note: "（{{note}}）",
        /** 几句话连起来（同一字段的几条警告）。 */
        clauseSeparator: "；",
    },
    codes: {
        "required": "必填",
        "type": "类型不对",
        "min-length": "至少 {{limit}} 个字符",
        "max-length": "至多 {{limit}} 个字符",
        "pattern": "格式不对",
        "format": "格式不对",
        "minimum": "不能小于 {{limit}}",
        "minimum-exclusive": "必须大于 {{limit}}",
        "maximum": "不能大于 {{limit}}",
        "maximum-exclusive": "必须小于 {{limit}}",
        "multiple-of": "必须是 {{multipleOf}} 的倍数",
        "min-items": "至少 {{limit}} 项",
        "max-items": "至多 {{limit}} 项",
        "unique-items": "有重复的项",
        "not-in-choices": "不是可选的值",
        "no-match": "不符合任何一种写法",
        "unparseable": "无法解析",
        "read-only": "只读的内容不能改",
        "schema-error": "描述有误，无法校验",
        "contains": "缺少符合要求的项",
        "min-contains": "符合要求的项至少 {{limit}} 个",
        "max-contains": "符合要求的项至多 {{limit}} 个",
        "min-properties": "至少填写 {{limit}} 项",
        "max-properties": "至多填写 {{limit}} 项",
        "dependent-required": "缺少与已填内容配套的项",
        "dependent-schemas": "与已填内容配套的部分不符合要求",
        "additional-property": "不认识的项：{{key}}",
        "additional-property-unnamed": "有不认识的项",
        "property-names": "有名称不合要求的项",
        "one-of": "必须恰好符合一种写法",
        "not": "写成了不允许的形式",
        "if-then": "不满足条件对应的要求",
    },
    /** 没有写法的码。 */
    fallback: "不符合要求（{{code}}）",
} satisfies Catalog;
