/**
 * 设置场景里示例插件的配置项、分区 id 与窗口的场景清单：“笔记”的项都没写分区（有一项指向不存在的分区），落到“其它”，
 * 覆盖通用列表的每种控件；“常用片段”“模型服务”的项指向自己的 page 分区，由页面画。单独放一个轻的模块：场景登记表在
 * Lab 启动时就加载，示例页面与场景数据也都引用它，场景数据本身要等选中场景才加载。
 */

import {Type} from "typebox";

import {defineSetting} from "nbook/shared/settings";

export const SNIPPETS_SECTION = "example.snippets.main";
export const MODELS_SECTION = "example.models.main";

export const notesSettings = {
    autosave: defineSetting({plugin: "example.notes", name: "autosave", schema: Type.Boolean(), default: true, title: {"zh-CN": "自动保存草稿", "en-US": "Autosave Drafts"}, description: {"zh-CN": "离开输入框时把草稿存到本地", "en-US": "Keep drafts locally when leaving a field"}}),
    interval: defineSetting({plugin: "example.notes", name: "interval", schema: Type.Integer({minimum: 5, maximum: 600}), default: 30, title: {"zh-CN": "保存间隔（秒）", "en-US": "Save Interval (s)"}, applies: "next-session"}),
    signature: defineSetting({plugin: "example.notes", name: "signature", schema: Type.String({maxLength: 40}), default: "", title: {"zh-CN": "落款", "en-US": "Signature"}, description: {"zh-CN": "导出笔记时附在末尾", "en-US": "Appended when exporting notes"}}),
    sort: defineSetting({
        plugin: "example.notes",
        name: "sort",
        schema: Type.Union([Type.Literal("title"), Type.Literal("modified"), Type.Literal("created"), Type.Literal("words")]),
        default: "modified",
        title: {"zh-CN": "排序", "en-US": "Sort By"},
        choices: [
            {value: "title", title: {"zh-CN": "按标题", "en-US": "Title"}},
            {value: "modified", title: {"zh-CN": "按修改时间", "en-US": "Last Modified"}},
            {value: "created", title: {"zh-CN": "按创建时间", "en-US": "Created"}},
            {value: "words", title: {"zh-CN": "按字数", "en-US": "Word Count"}},
        ],
    }),
    tags: defineSetting({plugin: "example.notes", name: "tags", schema: Type.Array(Type.String({minLength: 1})), default: ["人物", "地点", "伏笔"], title: {"zh-CN": "常用标签", "en-US": "Frequent Tags"}, applies: "restart"}),
    legacy: defineSetting({plugin: "example.notes", name: "legacy", schema: Type.Boolean(), default: false, title: {"zh-CN": "旧版目录结构", "en-US": "Legacy Layout"}, section: "example.missing"}),
};

/** page 分区自己画的项：通用列表不画它们。 */
export const snippetsSettings = {
    items: defineSetting({
        plugin: "example.snippets",
        name: "items",
        schema: Type.Array(Type.Object({
            name: Type.String({"x-form": {label: {"zh-CN": "名字", "en-US": "Name"}}}),
            text: Type.String({"x-form": {label: {"zh-CN": "内容", "en-US": "Text"}}}),
        }, {additionalProperties: false})),
        default: [],
        ui: {itemLabel: "name"},
        title: {"zh-CN": "片段", "en-US": "Snippets"},
        description: {"zh-CN": "在编辑器里输入名字即可插入", "en-US": "Type the name in the editor to insert"},
        section: SNIPPETS_SECTION,
    }),
    autoInsert: defineSetting({plugin: "example.snippets", name: "autoInsert", schema: Type.Boolean(), default: false, title: {"zh-CN": "输入名字后自动插入", "en-US": "Insert on Name"}, section: SNIPPETS_SECTION}),
};

export const modelsSettings = {
    effort: defineSetting({
        plugin: "example.models",
        name: "effort",
        schema: Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
        default: "medium",
        title: {"zh-CN": "推理强度", "en-US": "Reasoning Effort"},
        layers: ["user"],
        section: MODELS_SECTION,
        choices: [
            {value: "low", title: {"zh-CN": "低", "en-US": "Low"}},
            {value: "medium", title: {"zh-CN": "中", "en-US": "Medium"}},
            {value: "high", title: {"zh-CN": "高", "en-US": "High"}},
        ],
    }),
};

export type SettingsWindowSceneId =
    | "user" | "project" | "unbound" | "user-invalid" | "project-invalid" | "unreachable" | "write-failed" | "other"
    | "page-declared" | "page-blocked" | "page-failed" | "page-stopped" | "page-load-failed" | "page-column" | "page-fill";

export const SETTINGS_WINDOW_SCENES: ReadonlyArray<{readonly id: SettingsWindowSceneId; readonly label: string}> = [
    {id: "user", label: "用户标签：已修改、被本作品覆盖"},
    {id: "project", label: "本作品标签：沿用、单独设置、只能用户层的项"},
    {id: "unbound", label: "未绑定作品（没有标签）"},
    {id: "user-invalid", label: "用户层文件有错误"},
    {id: "project-invalid", label: "本作品层文件有错误（带路径）"},
    {id: "unreachable", label: "本作品层连不上"},
    {id: "write-failed", label: "写入失败（发通知、回到实际值）"},
    {id: "other", label: "“其它”分区：每种控件，含可编辑的字符串列表"},
    {id: "page-declared", label: "page 分区：入口还在启动"},
    {id: "page-blocked", label: "page 分区：入口受阻"},
    {id: "page-failed", label: "page 分区：入口激活失败（可重试）"},
    {id: "page-stopped", label: "page 分区：已撤回"},
    {id: "page-load-failed", label: "page 分区：加载失败（可重新加载）"},
    {id: "page-column", label: "page 分区：column 页面"},
    {id: "page-fill", label: "page 分区：fill 页面"},
];
