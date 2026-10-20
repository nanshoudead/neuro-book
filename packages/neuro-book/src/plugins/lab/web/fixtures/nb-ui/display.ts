/** nb-ui 展示类（`display/`）与导航类（`navigation/`）的场景。 */

import type {Badge, Breadcrumb, EmptyState, Kbd, Progress, Skeleton, Spinner, Table, Tree} from "@notnotype/nb-ui/components";
import {h} from "vue";

import {Button as NbButton} from "@notnotype/nb-ui/components";

import type {LabFixture} from "../index";
import {defineSubjectFixture} from "../subject-fixture";
import {nbUiSubject} from "./shared";

const CHAPTER_ROWS = [
    {title: "第一章 灯塔", words: 3182, status: "已定稿", updated: "10-02"},
    {title: "第二章 雾中城", words: 4410, status: "修改中", updated: "10-05"},
    {title: "第三章 巡夜人", words: 2876, status: "草稿", updated: "10-08"},
    {title: "第四章 一个非常长的章节标题，用来看单元格放不下时怎样截断或换行", words: 512, status: "草稿", updated: "10-10"},
];
type ChapterRow = (typeof CHAPTER_ROWS)[number];
/**
 * `Table` 是泛型组件（`generic="Row"`），场景的类型推导只认组件构造器：按章节行实例化它的 props，
 * 拼成同形状的构造器类型。props 仍取自组件本身，Table 改了签名这里一起变。
 */
type ChapterTable = new () => {$props: Parameters<typeof Table<ChapterRow>>[0]};
const CHAPTER_COLUMNS = [
    {key: "title" as const, label: "章节"},
    {key: "words" as const, label: "字数", width: "80px", align: "right" as const},
    {key: "status" as const, label: "状态", width: "80px"},
    {key: "updated" as const, label: "修改", width: "64px", align: "center" as const},
];

const TREE_ITEMS = [
    {id: "outline", title: "大纲", iconClass: "i-lucide-list-tree", children: [
        {id: "act-1", title: "第一幕：雾港", children: [{id: "scene-1", title: "灯塔熄灭"}, {id: "scene-2", title: "巡夜人"}]},
        {id: "act-2", title: "第二幕：雪线", children: [{id: "scene-3", title: "渡口", disabled: true}]},
    ]},
    {id: "characters", title: "人物", iconClass: "i-lucide-users", children: [{id: "shen-yu", title: "沈屿"}, {id: "lin-wan", title: "林晚"}]},
];

export const displayFixtures: LabFixture[] = [
    defineSubjectFixture<typeof Badge>({
        component: "Badge",
        slotPresets: {default: () => "草稿"},
        scenes: [
            {id: "soft", label: "柔和", input: {props: {tone: "neutral", variant: "soft", size: "sm"}, slots: {default: true}}},
            {id: "accent", label: "强调、实心", input: {props: {tone: "accent", variant: "solid", size: "md"}, slots: {default: true}}},
            {id: "outline", label: "描边、带图标", input: {props: {tone: "success", variant: "outline", size: "sm", iconClass: "i-lucide-check"}, slots: {default: true}}},
            {id: "dot", label: "状态点", input: {props: {tone: "warning", variant: "soft", size: "sm", dot: true}, slots: {default: true}}},
            {id: "count", label: "计数", input: {props: {tone: "danger", variant: "solid", size: "sm", count: 128}, slots: {default: false}}},
        ],
        subject: nbUiSubject("Badge"),
    }),
    defineSubjectFixture<typeof EmptyState>({
        component: "EmptyState",
        class: "w-full",
        slotPresets: {action: () => h(NbButton, {size: "sm", iconClass: "i-lucide-plus"}, () => "新建作品")},
        scenes: [
            {id: "default", label: "图标、标题与操作", input: {props: {iconClass: "i-lucide-book-open", title: "书架上还没有作品", description: "新建一部作品，或把已有的目录加入书架。"}, slots: {action: true}}},
            {id: "plain", label: "只有说明", input: {props: {description: "没有匹配的结果"}, slots: {action: false}}},
        ],
        subject: nbUiSubject("EmptyState"),
    }),
    defineSubjectFixture<typeof Kbd>({
        component: "Kbd",
        slotPresets: {default: () => "Ctrl+Shift+P"},
        scenes: [
            {id: "md", label: "默认", input: {props: {size: "md"}, slots: {default: true}}},
            {id: "sm", label: "小号", input: {props: {size: "sm"}, slots: {default: true}}},
            {id: "lg", label: "大号", input: {props: {size: "lg"}, slots: {default: true}}},
        ],
        subject: nbUiSubject("Kbd"),
    }),
    defineSubjectFixture<typeof Progress>({
        component: "Progress",
        class: "w-full max-w-[360px]",
        scenes: [
            {id: "accent", label: "进行中", input: {props: {modelValue: 42, max: 100, tone: "accent", size: "md"}}},
            {id: "success", label: "完成", input: {props: {modelValue: 3000, max: 3000, tone: "success", size: "sm"}}},
            {id: "danger", label: "超出（危险色）", input: {props: {modelValue: 96, max: 100, tone: "danger", size: "lg"}}},
        ],
        subject: nbUiSubject("Progress"),
    }),
    defineSubjectFixture<typeof Skeleton>({
        component: "Skeleton",
        class: "w-full max-w-[360px]",
        scenes: [
            {id: "text", label: "一行文字", input: {props: {shape: "text", width: "80%"}}},
            {id: "block", label: "块", input: {props: {shape: "block", width: "100%", height: "120px"}}},
            {id: "circle", label: "圆", input: {props: {shape: "circle", width: "48px", height: "48px"}}},
        ],
        subject: nbUiSubject("Skeleton"),
    }),
    defineSubjectFixture<typeof Spinner>({
        component: "Spinner",
        scenes: [
            {id: "md", label: "默认", input: {props: {size: "md", label: "正在载入"}}},
            {id: "label", label: "显示文字", input: {props: {size: "sm", label: "正在载入章节", showLabel: true}}},
            {id: "lg", label: "大号", input: {props: {size: "lg", label: "正在载入"}}},
        ],
        subject: nbUiSubject("Spinner"),
    }),
    defineSubjectFixture<ChapterTable>({
        component: "Table",
        events: ["row-click"],
        class: "w-full",
        scenes: [
            {id: "default", label: "章节表", input: {props: {columns: CHAPTER_COLUMNS, rows: CHAPTER_ROWS, rowKey: "title", hoverable: true, density: "default"}}},
            {id: "compact", label: "紧凑", input: {props: {columns: CHAPTER_COLUMNS, rows: CHAPTER_ROWS, rowKey: "title", density: "compact"}}},
            {id: "loading", label: "加载中", input: {props: {columns: CHAPTER_COLUMNS, rows: [], loading: true}}},
            {id: "empty", label: "空表", input: {props: {columns: CHAPTER_COLUMNS, rows: [], emptyText: "这一卷还没有章节"}}},
        ],
        subject: nbUiSubject("Table"),
    }),
    defineSubjectFixture<typeof Breadcrumb>({
        component: "Breadcrumb",
        events: ["click"],
        scenes: [
            {id: "default", label: "三级", input: {props: {items: [{label: "长夜行", iconClass: "i-lucide-book"}, {label: "第二卷"}, {label: "第十七章 雪线", current: true}]}}},
            {id: "long", label: "很多级", input: {props: {items: ["manuscript", "第二卷", "上部", "雪线", "草稿", "第十七章 雪线（修订三）"].map((label, index, all) => ({label, current: index === all.length - 1}))}}},
        ],
        subject: nbUiSubject("Breadcrumb"),
    }),
    defineSubjectFixture<typeof Tree>({
        component: "Tree",
        events: ["select"],
        class: "h-full w-full",
        scenes: [
            {id: "card", label: "卡片面", input: {props: {items: TREE_ITEMS, surface: "card"}, model: {modelValue: "scene-2", expanded: ["outline", "act-1"]}}},
            {id: "plain", label: "平面、多选", input: {props: {items: TREE_ITEMS, surface: "plain", multiple: true}, model: {modelValue: ["shen-yu", "lin-wan"], expanded: ["characters"]}}},
            {id: "disabled", label: "禁用", input: {props: {items: TREE_ITEMS, surface: "card", disabled: true}, model: {modelValue: "act-1", expanded: ["outline"]}}},
        ],
        subject: nbUiSubject("Tree"),
    }),
];
