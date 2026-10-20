/**
 * 编辑器区的设置项与它们所在的设置分区（docs/specs/workbench/editor.md 输出 52）。声明是纯数据：设置项与 list 分区都写在
 * 插件描述的顶层。
 */

import {Type} from "typebox";

import type {SettingsSectionDeclaration} from "nbook/plugins/settings/shared/contracts";
import {defineSetting, defineSettings} from "nbook/shared/settings";

export const EDITOR_SECTION = "nbook.editor";

export const EDITOR_SECTION_DECLARATION: SettingsSectionDeclaration = {
    title: {"zh-CN": "编辑器", "en-US": "Editor"},
    description: {"zh-CN": "标签栏与面包屑", "en-US": "Tabs and breadcrumbs"},
    icon: "i-lucide-square-pen",
    category: "app",
    order: 30,
    groups: [
        {id: "tabs", title: {"zh-CN": "标签", "en-US": "Tabs"}},
        {id: "code", title: {"zh-CN": "代码编辑器", "en-US": "Code Editor"}},
    ],
};

/** 预览标签页：关掉时单击打开也是常驻标签，已有的 preview 标签立即转正。 */
export const enablePreviewSetting = defineSetting({
    plugin: "nbook.editor",
    name: "enablePreview",
    schema: Type.Boolean(),
    default: true,
    title: {"zh-CN": "预览标签页", "en-US": "Preview Tabs"},
    description: {"zh-CN": "单击打开的文件先占一个可被替换的标签，编辑或双击后转为常驻", "en-US": "A single click opens a replaceable tab that becomes permanent once edited or double-clicked"},
    section: EDITOR_SECTION,
    group: "tabs",
    order: 10,
});

/** 多行标签：放不下时换行，固定标签单独一行；关掉时一行横向滚动。 */
export const wrapTabsSetting = defineSetting({
    plugin: "nbook.editor",
    name: "wrapTabs",
    schema: Type.Boolean(),
    default: true,
    title: {"zh-CN": "多行标签", "en-US": "Wrap Tabs"},
    description: {"zh-CN": "标签放不下时换行，固定的标签单独一行", "en-US": "Wrap tabs that do not fit; pinned tabs get a row of their own"},
    section: EDITOR_SECTION,
    group: "tabs",
    order: 20,
});

/** 面包屑：标签栏下面的路径与 Markdown 的标题。 */
export const breadcrumbsSetting = defineSetting({
    plugin: "nbook.editor",
    name: "breadcrumbs",
    schema: Type.Boolean(),
    default: true,
    title: {"zh-CN": "面包屑", "en-US": "Breadcrumbs"},
    description: {"zh-CN": "标签栏下面显示文件的路径与光标所在的标题", "en-US": "Show the file path and the current heading below the tabs"},
    section: EDITOR_SECTION,
    group: "tabs",
    order: 30,
});

/**
 * 源码编辑器（Monaco）的排版（settings-window 的“代码编辑器”小组）。Markdown 正文的排版不在这里。改动立即生效：编辑器
 * 不重建，缩进两项同时用到已打开的文件。
 */
export const {settings: codeSettings, contributions: codeSettingContributions} = defineSettings("nbook.editor", {
    "code.fontFamily": {
        schema: Type.String({maxLength: 200}),
        default: "",
        title: {"zh-CN": "字体", "en-US": "Font Family"},
        description: {"zh-CN": "CSS 的 font-family 写法；留空跟随主题的等宽字体", "en-US": "A CSS font-family list; leave empty to use the theme's monospace font"},
        section: EDITOR_SECTION, group: "code", order: 10,
    },
    "code.fontSize": {
        schema: Type.Integer({minimum: 8, maximum: 40}),
        default: 14,
        title: {"zh-CN": "字号", "en-US": "Font Size"},
        section: EDITOR_SECTION, group: "code", order: 20,
        ui: {unit: {"zh-CN": "像素", "en-US": "px"}},
    },
    "code.lineHeight": {
        schema: Type.Number({minimum: 0, maximum: 100}),
        default: 0,
        title: {"zh-CN": "行高", "en-US": "Line Height"},
        description: {"zh-CN": "0 按字号自动；小于 8 是字号的倍数，8 以上是像素", "en-US": "0 follows the font size; below 8 multiplies the font size, 8 and above is in pixels"},
        section: EDITOR_SECTION, group: "code", order: 30,
    },
    "code.tabSize": {
        schema: Type.Integer({minimum: 1, maximum: 8}),
        default: 4,
        title: {"zh-CN": "Tab 宽度", "en-US": "Tab Size"},
        description: {"zh-CN": "一级缩进占几个空格；推测缩进打开时，只在推测不出时用它", "en-US": "Spaces per indentation level; with indentation detection on, used only when nothing can be detected"},
        section: EDITOR_SECTION, group: "code", order: 40,
    },
    "code.detectIndentation": {
        schema: Type.Boolean(),
        default: true,
        title: {"zh-CN": "推测缩进", "en-US": "Detect Indentation"},
        description: {"zh-CN": "按文件内容推测用空格还是制表符、缩进几格；关掉时一律用上面的 Tab 宽度与空格", "en-US": "Guess spaces or tabs and the indentation size from the file; when off, always use the tab size above with spaces"},
        section: EDITOR_SECTION, group: "code", order: 50,
    },
    "code.lineNumbers": {
        schema: Type.Union([Type.Literal("on"), Type.Literal("off"), Type.Literal("relative")]),
        default: "on",
        title: {"zh-CN": "行号", "en-US": "Line Numbers"},
        choices: [
            {value: "on", title: {"zh-CN": "显示", "en-US": "On"}},
            {value: "off", title: {"zh-CN": "不显示", "en-US": "Off"}},
            {value: "relative", title: {"zh-CN": "相对", "en-US": "Relative"}},
        ],
        section: EDITOR_SECTION, group: "code", order: 60,
    },
    "code.minimap": {
        schema: Type.Boolean(),
        default: false,
        title: {"zh-CN": "缩略图", "en-US": "Minimap"},
        section: EDITOR_SECTION, group: "code", order: 70,
    },
    "code.wordWrap": {
        schema: Type.Boolean(),
        default: true,
        title: {"zh-CN": "自动换行", "en-US": "Word Wrap"},
        section: EDITOR_SECTION, group: "code", order: 80,
    },
});
