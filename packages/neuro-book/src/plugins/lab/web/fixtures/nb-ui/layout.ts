/** nb-ui 布局类（`layout/`）的场景。`GridRenderer` 的布局由宿主算出，在 `WorkbenchShellLayout` 的集成场景里观察。 */

import type {Collapsible, DropFeedbackOverlay, DropIndicator, DropIndicatorLabel, OverlayScrollbar, ScrollArea, Separator, Splitter} from "@notnotype/nb-ui/components";
import {h} from "vue";

import {Button as NbButton} from "@notnotype/nb-ui/components";

import {defineLabFixture} from "../index";
import type {LabFixture} from "../index";
import {defineSubjectFixture} from "../subject-fixture";
import {nbUiSubject} from "./shared";

const prose = (text: string) => () => h("p", {class: "text-sm leading-relaxed text-[var(--text-main)]"}, text);
const block = (label: string) => () => h("div", {class: "flex h-full w-full items-center justify-center text-sm text-[var(--text-secondary)]"}, label);
const LONG_TEXT = Array.from({length: 24}, (_, index) => `第 ${String(index + 1)} 段：港口的雾从傍晚开始漫上来，先是码头，再是灯塔的基座。`).join("\n");

export const layoutFixtures: LabFixture[] = [
    defineSubjectFixture<typeof Collapsible>({
        component: "Collapsible",
        class: "w-full max-w-[420px]",
        slotPresets: {trigger: () => h(NbButton, {variant: "ghost", size: "sm", iconClass: "i-lucide-chevrons-up-down"}, () => "修订说明"), default: prose("第三次修订：删掉了雾中城的两段环境描写，节奏更快。")},
        scenes: [
            {id: "open", label: "展开", input: {props: {}, model: {open: true}, slots: {trigger: true, default: true}}},
            {id: "closed", label: "收起", input: {props: {}, model: {open: false}, slots: {trigger: true, default: true}}},
            {id: "disabled", label: "禁用", input: {props: {disabled: true}, model: {open: false}, slots: {trigger: true, default: true}}},
        ],
        subject: nbUiSubject("Collapsible"),
    }),
    defineSubjectFixture<typeof DropFeedbackOverlay>({
        component: "DropFeedbackOverlay",
        class: "h-full w-full",
        scenes: [
            {id: "area", label: "半区落点", input: {props: {preview: {areaRect: {left: 80, top: 80, right: 400, bottom: 260}, entryRect: null, indicator: null, orientation: "vertical", armed: true}, label: "移到这里", iconClass: "i-lucide-move"}}},
            {id: "line", label: "插入线", input: {props: {preview: {areaRect: null, entryRect: null, indicator: {left: 80, top: 120, right: 360, bottom: 122}, orientation: "horizontal"}, label: "插入到第二章之前"}}},
            {id: "none", label: "没有落点", input: {props: {preview: null, label: ""}}},
        ],
        subject: nbUiSubject("DropFeedbackOverlay"),
    }),
    defineSubjectFixture<typeof DropIndicator>({
        component: "DropIndicator",
        class: "h-[160px] w-full max-w-[360px]",
        slotPresets: {default: () => "放到这里"},
        scenes: [
            {id: "area", label: "区域", input: {props: {variant: "area"}, slots: {default: true}}},
            {id: "entry", label: "条目", input: {props: {variant: "entry"}, slots: {default: true}}},
            {id: "line", label: "线", input: {props: {variant: "line"}, slots: {default: false}}},
        ],
        subject: nbUiSubject("DropIndicator"),
    }),
    defineSubjectFixture<typeof DropIndicatorLabel>({
        component: "DropIndicatorLabel",
        scenes: [
            {id: "default", label: "带图标", input: {props: {label: "新建容器（在侧栏）", iconClass: "i-lucide-plus"}}},
            {id: "long", label: "长文字", input: {props: {label: "移到「资源管理器」容器的末尾，并与大纲视图合并显示"}}},
        ],
        subject: nbUiSubject("DropIndicatorLabel"),
    }),
    defineLabFixture<typeof OverlayScrollbar>({
        component: "OverlayScrollbar",
        scenes: [
            {id: "long", label: "内容溢出：鼠标移入时出现", input: {props: {target: null}}},
            {id: "short", label: "内容不溢出：不画", input: {props: {target: null}}},
        ],
        load: async () => (await import("./OverlayScrollbarFixture.vue")).default,
    }),
    defineSubjectFixture<typeof ScrollArea>({
        component: "ScrollArea",
        class: "h-[280px] w-full max-w-[420px]",
        slotPresets: {default: () => h("div", {class: "whitespace-pre-line p-3 text-sm leading-relaxed"}, LONG_TEXT)},
        scenes: [
            {id: "hover", label: "悬停时显示滚动条", input: {props: {type: "hover", orientation: "vertical"}, slots: {default: true}}},
            {id: "always", label: "总是显示", input: {props: {type: "always", orientation: "vertical"}, slots: {default: true}}},
        ],
        subject: nbUiSubject("ScrollArea"),
    }),
    defineSubjectFixture<typeof Separator>({
        component: "Separator",
        class: "w-full max-w-[360px]",
        scenes: [
            {id: "horizontal", label: "横向", input: {props: {orientation: "horizontal", decorative: true}}},
            {id: "vertical", label: "纵向", input: {props: {orientation: "vertical", decorative: false}}},
        ],
        subject: nbUiSubject("Separator"),
    }),
    defineSubjectFixture<typeof Splitter>({
        component: "Splitter",
        // `gesture-update` 每次指针移动都发，会淹没事件页签，不记。
        events: ["layout", "gesture-start", "gesture-end", "gesture-cancel"],
        class: "h-full w-full",
        slotPresets: {"panel-outline": block("大纲"), "panel-editor": block("正文"), "panel-notes": block("批注")},
        scenes: [
            {id: "horizontal", label: "三栏横向", input: {props: {direction: "horizontal", panels: [{id: "outline", defaultSizePx: 220, minSizePx: 120, sizing: "fixed"}, {id: "editor", sizing: "weight"}, {id: "notes", defaultSizePx: 260, minSizePx: 160, sizing: "fixed"}]}, slots: {"panel-outline": true, "panel-editor": true, "panel-notes": true}}},
            {id: "vertical", label: "两栏纵向", input: {props: {direction: "vertical", panels: [{id: "editor", sizing: "weight"}, {id: "notes", defaultSizePx: 180, minSizePx: 80, sizing: "fixed"}]}, slots: {"panel-editor": true, "panel-notes": true}}},
            {id: "disabled", label: "禁用拖动", input: {props: {direction: "horizontal", disabled: true, panels: [{id: "outline", defaultSizePx: 220, sizing: "fixed"}, {id: "editor", sizing: "weight"}]}, slots: {"panel-outline": true, "panel-editor": true}}},
        ],
        subject: nbUiSubject("Splitter"),
    }),
];
