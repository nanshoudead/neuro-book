/**
 * nb-form 渲染层的场景（组件树里 `nb-form` 一组，docs/specs/ui/forms.md）。描述用 TypeBox 生成，输出是普通 JSON，
 * 可以在场景输入里直接改。组件经 `@notnotype/nb-form/vue` 的公开入口按名字取。
 */

import type {SchemaField, SchemaForm} from "@notnotype/nb-form/vue";
import {Type} from "typebox";
import type {Component} from "vue";

import type {LabFixture} from "./index";
import {defineSubjectFixture} from "./subject-fixture";

function nbFormSubject(name: "SchemaForm" | "SchemaField"): () => Promise<{default: Component}> {
    return async () => ({default: (await import("@notnotype/nb-form/vue"))[name] as Component});
}

/** 每种标量控件各一个：布尔、确认、2 项与 4 项与 20 项的单选、多选、数字、单行、多行。 */
const CONTROLS = Type.Object({
    enabled: Type.Boolean({title: "启用同步", description: "打开后每次保存都推送到远端"}),
    agreed: Type.Optional(Type.Boolean({title: "同意条款", "x-form": {widget: "confirm"}})),
    format: Type.Union([Type.Literal("openai"), Type.Literal("anthropic")], {title: "接口格式", "x-form": {choices: [{value: "openai", label: "OpenAI 兼容"}, {value: "anthropic", label: "Anthropic"}]}}),
    region: Type.Union([Type.Literal("cn"), Type.Literal("us"), Type.Literal("eu"), Type.Literal("jp")], {title: "地区", "x-form": {choices: [{value: "cn", label: "中国"}, {value: "us", label: "美国"}, {value: "eu", label: "欧洲"}, {value: "jp", label: "日本"}]}}),
    model: Type.Union(Array.from({length: 20}, (_, index) => Type.Literal(`model-${String(index + 1)}`)), {title: "模型", "x-form": {recommend: ["model-3"]}}),
    tags: Type.Array(Type.Union([Type.Literal("draft"), Type.Literal("review"), Type.Literal("final")]), {uniqueItems: true, title: "标签", "x-form": {choices: [{value: "draft", label: "草稿"}, {value: "review", label: "审阅", description: "需要另一人看过"}, {value: "final", label: "定稿"}]}}),
    timeout: Type.Integer({title: "超时", minimum: 1, maximum: 600, "x-form": {unit: "秒"}}),
    name: Type.String({title: "名称", minLength: 1, "x-form": {placeholder: "例如：本地模型"}}),
    notes: Type.Optional(Type.String({title: "备注", "x-form": {widget: "multiline", rows: 3}})),
});
const CONTROLS_VALUE = {enabled: true, format: "openai", region: "cn", model: "model-3", tags: ["draft"], timeout: 30, name: "本地模型"};

/** 缺值与默认：文字与数字写“默认：X”占位，选择类标题旁写默认，开关显示默认状态。 */
const DEFAULTS = Type.Object({
    host: Type.Optional(Type.String({title: "地址", default: "localhost"})),
    port: Type.Optional(Type.Integer({title: "端口", default: 8080})),
    mode: Type.Optional(Type.Union([Type.Literal("fast"), Type.Literal("safe")], {title: "模式", default: "safe", "x-form": {choices: [{value: "fast", label: "快速"}, {value: "safe", label: "稳妥"}]}})),
    beta: Type.Optional(Type.Boolean({title: "测试版功能", default: true})),
    proxy: Type.Union([Type.String(), Type.Null()], {title: "代理", description: "可为空：清除写 null"}),
});

/** 问题：schema 的错误、调用方的错误与警告，汇总按字段先后列出。 */
const ISSUES = Type.Object({
    name: Type.String({title: "名称", minLength: 3}),
    email: Type.String({title: "邮箱", format: "email"}),
    retries: Type.Integer({title: "重试次数", maximum: 5}),
    note: Type.Optional(Type.String({title: "说明"})),
});

/** 动态选项的三种状态与“已不存在”。 */
const OPTIONS = Type.Object({
    provider: Type.String({title: "服务商", "x-form": {options: "providers"}}),
    loading: Type.Optional(Type.String({title: "模型（加载中）", "x-form": {options: "models"}})),
    offline: Type.Optional(Type.String({title: "模型（不可用）", "x-form": {options: "offline"}})),
});
const OPTION_SOURCES = {
    providers: {status: "ready", items: [{value: "openai", label: "OpenAI", description: "官方接口"}, {value: "deepseek", label: "DeepSeek"}]},
    models: {status: "loading"},
    offline: {status: "unavailable", reason: "服务商没有返回模型列表"},
} as const;

/** 服务商连接的一部分：切换接口格式时代理显示与隐藏，填过的值保留。对象、列表与 JSON 字段随结构控件补上。 */
const CONNECTION = Type.Object({
    id: Type.Optional(Type.String({title: "ID", readOnly: true})),
    name: Type.String({title: "名称"}),
    baseUrl: Type.String({title: "API 地址", format: "uri"}),
    format: Type.Union([Type.Literal("openai"), Type.Literal("anthropic")], {title: "接口格式"}),
    proxy: Type.Optional(Type.String({title: "代理", description: "只在 OpenAI 兼容格式下使用", "x-form": {visibleWhen: {field: "format", schema: {const: "openai"}}}})),
    timeout: Type.Integer({title: "超时", minimum: 1, "x-form": {unit: "秒"}}),
    retries: Type.Integer({title: "重试", minimum: 0, maximum: 10}),
});
const CONNECTION_LAYOUT = {
    type: "column",
    items: [
        {type: "field", path: "/id"},
        {type: "field", path: "/name"},
        {type: "field", path: "/baseUrl"},
        {type: "field", path: "/format"},
        {type: "field", path: "/proxy"},
        {type: "row", items: [{type: "field", path: "/timeout"}, {type: "field", path: "/retries"}]},
    ],
} as const;

/** 审批展示：长路径与多行文字。 */
const APPROVAL = Type.Object({
    path: Type.String({title: "写入路径"}),
    content: Type.String({title: "内容", "x-form": {widget: "multiline"}}),
    overwrite: Type.Boolean({title: "覆盖已有文件"}),
    mode: Type.Union([Type.Literal("append"), Type.Literal("replace")], {title: "写入方式", "x-form": {choices: [{value: "append", label: "追加"}, {value: "replace", label: "替换"}]}}),
});
const APPROVAL_VALUE = {
    path: "/home/writer/novels/长夜行/第三卷：雪原/第二十七章 渡口的灯，以及没有说出口的那句话.md",
    content: Array.from({length: 12}, (_, index) => `第 ${String(index + 1)} 段：渡口的灯一盏接一盏亮起来，像有人在河对岸数着什么。`).join("\n"),
    overwrite: false,
    mode: "append",
};

export const nbFormFixtures: LabFixture[] = [
    defineSubjectFixture<typeof SchemaForm>({
        component: "SchemaForm",
        class: "w-full max-w-[560px]",
        events: ["update:modelValue", "draft-state", "focus-issue"],
        scenes: [
            {id: "controls", label: "每种标量控件", input: {props: {schema: CONTROLS, locale: "zh-CN"}, model: {modelValue: CONTROLS_VALUE}}},
            {id: "defaults", label: "缺值与默认", input: {props: {schema: DEFAULTS, locale: "zh-CN"}, model: {modelValue: {proxy: "http://127.0.0.1:7890"}}}},
            {
                id: "issues",
                label: "问题与汇总",
                input: {
                    props: {
                        schema: ISSUES,
                        locale: "zh-CN",
                        issues: [
                            {path: ["email"], code: "taken", params: {}, severity: "error", source: "caller", message: "这个邮箱已经注册过"},
                            {path: ["note"], code: "long", params: {}, severity: "warning", source: "caller", message: "说明偏长，列表里会被截断"},
                        ],
                    },
                    model: {modelValue: {name: "ab", email: "writer@example.com", retries: 8, note: "这一段说明写得比较长，用来演示警告"}},
                },
            },
            {id: "options", label: "动态选项", input: {props: {schema: OPTIONS, locale: "zh-CN", options: OPTION_SOURCES}, model: {modelValue: {provider: "anthropic"}}}},
            {id: "conditional", label: "服务商连接：条件显示与横排", input: {props: {schema: CONNECTION, layout: CONNECTION_LAYOUT, locale: "zh-CN"}, model: {modelValue: {id: "conn-01", name: "本地", baseUrl: "http://localhost:11434", format: "openai", timeout: 30, retries: 2}}}},
            {id: "readonly", label: "只读", input: {props: {schema: CONTROLS, locale: "zh-CN", readonly: true}, model: {modelValue: CONTROLS_VALUE}}},
            {id: "disabled", label: "停用", input: {props: {schema: CONTROLS, locale: "zh-CN", disabled: true}, model: {modelValue: CONTROLS_VALUE}}},
            {id: "view", label: "展示态（审批）", input: {props: {schema: APPROVAL, locale: "zh-CN", mode: "view"}, model: {modelValue: APPROVAL_VALUE}}},
            {id: "en", label: "English", input: {props: {schema: ISSUES, locale: "en-US"}, model: {modelValue: {name: "ab", email: "x", retries: 8}}}},
        ],
        subject: nbFormSubject("SchemaForm"),
    }),
    defineSubjectFixture<typeof SchemaField>({
        component: "SchemaField",
        class: "w-full max-w-[360px]",
        events: ["update:modelValue", "draft-state"],
        scenes: [
            {id: "number", label: "数字带单位", input: {props: {schema: Type.Integer({title: "字号", minimum: 8, maximum: 72, "x-form": {unit: "px"}}), locale: "zh-CN"}, model: {modelValue: 14}}},
            {id: "select", label: "下拉", input: {props: {schema: Type.Union([Type.Literal("system"), Type.Literal("light"), Type.Literal("dark"), Type.Literal("sepia")], {title: "主题"}), locale: "zh-CN"}, model: {modelValue: "dark"}}},
            {id: "bare", label: "只有控件（bare）", input: {props: {schema: Type.String({minLength: 1}), locale: "zh-CN", bare: true, id: "lab-schema-field-bare"}, model: {modelValue: "只画控件，标签由调用方给"}}},
        ],
        subject: nbFormSubject("SchemaField"),
    }),
];
