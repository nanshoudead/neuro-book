<script setup lang="ts">
import {computed, ref} from "vue";
import Button from "../../../src/components/controls/Button.vue";
import DropdownMenu from "../../../src/components/controls/DropdownMenu.vue";
import Menubar from "../../../src/components/controls/Menubar.vue";
import ContextMenu from "../../../src/components/feedback/ContextMenu.vue";
import type {ContextMenuItem} from "../../../src/components/feedback/context-menu.types";
import QuickPick, {type QuickPickItem} from "../../../src/components/feedback/QuickPick.vue";
import Select from "../../../src/components/form/Select.vue";
import FixtureShell from "./AcceptanceShell.vue";
import type {LabComponentDefinition} from "./definitions";

/**
 * 弹出列表的验收夹具（w00029 t04，e2e/popup-lists.spec.ts）：行高、字号、圆角、高亮与勾选列要在真实布局与真实指针下量，
 * happy-dom 没有布局也不产生指针移动。场景 `menus` 放菜单一族各一个：DropdownMenu（reka 的项加手工级联）、Menubar、
 * 右键菜单（全是普通按钮项）；`select`、`quick-pick` 各放一个，带说明的两行项与单行项混排；`long` 与 `quick-pick-long`
 * 是长列表与多级长级联，验截断、滑块与滚动。
 */
const props = defineProps<{
    definition: LabComponentDefinition;
    sceneId: string;
}>();

const controls = ref<Record<string, string | boolean>>({});

const DROPDOWN_ITEMS = [
    {label: "重命名", value: "rename", iconClass: "i-lucide-pencil", shortcut: "F2"},
    {label: "自动换行", value: "wrap", type: "checkbox" as const, checked: true, shortcut: "Alt+Z"},
    {label: "", value: "sep-1", separator: true},
    {label: "排序方式", value: "sort", children: [
        {label: "按名称", value: "sort-name", type: "radio" as const, checked: true, group: "sort"},
        {label: "按修改时间", value: "sort-mtime", type: "radio" as const, checked: false, group: "sort"},
    ]},
    {label: "删除", value: "delete", iconClass: "i-lucide-trash-2", tone: "danger" as const},
];

const MENUBAR_MENUS = [
    {id: "file", label: "文件", items: [
        {label: "新建章节", value: "new", shortcut: "Ctrl+N"},
        {label: "导出", value: "export", children: [
            {label: "Markdown", value: "export-md"},
            {label: "EPUB", value: "export-epub"},
        ]},
    ]},
];

const CONTEXT_ITEMS: ContextMenuItem[] = [
    {label: "新建", iconClass: "i-lucide-file-plus", shortcut: "Ctrl+N"},
    {label: "更多", children: [{label: "子一"}, {label: "子二"}]},
    {separator: true},
    {label: "删除", iconClass: "i-lucide-trash-2", tone: "danger"},
];

const SELECT_OPTIONS = [
    {label: "Markdown", value: "md", iconClass: "i-lucide-file-text"},
    {label: "纯文本", value: "txt", iconClass: "i-lucide-file", description: "不带格式，换行照原样保留"},
    {label: "PDF（暂不可用）", value: "pdf", iconClass: "i-lucide-file-x", disabled: true},
];
const format = ref("txt");

const QUICK_PICK_ITEMS: QuickPickItem[] = [
    {id: "open", label: "打开项目", iconClass: "i-lucide-folder-open", shortcut: "Ctrl+O"},
    {id: "chapter", label: "新建章节", iconClass: "i-lucide-file-plus", description: "在当前卷末尾"},
    {id: "export", label: "导出", iconClass: "i-lucide-download", disabled: true},
    {id: "settings", label: "设置", iconClass: "i-lucide-settings"},
];
const quickPickOpen = ref(props.sceneId === "quick-pick" || props.sceneId === "quick-pick-long");
const quickPickQuery = ref("");
const quickPickActive = ref<string | null>(props.sceneId === "quick-pick-long" ? "命令-1" : "open");

const numbered = (prefix: string, count: number): {label: string; value: string}[] =>
    Array.from({length: count}, (_, index) => ({label: `${prefix} ${String(index + 1)}`, value: `${prefix}-${String(index + 1)}`}));

/** 长列表：主菜单 30 多项、第一项展开 20 项的子菜单（其中第一项再展开 20 项）、第二项只展开 2 项。 */
const LONG_DROPDOWN_ITEMS = [
    {label: "长子菜单", value: "long", children: [{label: "更深", value: "deeper", children: numbered("孙项", 20)}, ...numbered("子项", 19)]},
    {label: "短子菜单", value: "short", children: numbered("短项", 2)},
    {label: "", value: "sep", separator: true},
    ...numbered("主项", 30),
];
const LONG_CONTEXT_ITEMS: ContextMenuItem[] = [
    {label: "长子菜单", children: numbered("子项", 20).map(({label}) => ({label}))},
    {label: "短子菜单", children: [{label: "短项 1"}, {label: "短项 2"}]},
    {separator: true},
    ...numbered("主项", 30).map(({label}) => ({label})),
];
const SHORT_DROPDOWN_ITEMS = numbered("项", 8);
/** 单行项与带说明的两行项混排：每 4 项有一项带说明。 */
const LONG_SELECT_OPTIONS = numbered("第", 30).map((option, index) => ({...option, label: `${option.label} 章`, description: index % 4 === 1 ? "带一行说明" : undefined}));
const longFormat = ref("第-20");

const QUICK_PICK_LONG: QuickPickItem[] = numbered("命令", 30).map(({label, value}) => ({id: value, label}));
const quickPickLongItems = computed(() => QUICK_PICK_LONG.filter((item) => item.label.includes(quickPickQuery.value)));

const context = ref<{x: number; y: number} | null>(null);
const contextItems = computed(() => (props.sceneId === "long" ? LONG_CONTEXT_ITEMS : CONTEXT_ITEMS));
function openContext(event: MouseEvent): void {
    context.value = {x: event.clientX, y: event.clientY};
}
</script>

<template>
    <FixtureShell v-model:controls="controls" :definition="definition" :scene-id="sceneId">
        <div v-if="props.sceneId === 'select'" id="nb-lab-target" class="popup-lists-stage">
            <Select v-model="format" :options="SELECT_OPTIONS" class="w-[220px]" data-fixture-select />
        </div>
        <div v-else-if="props.sceneId === 'long'" id="nb-lab-target" class="popup-lists-stage">
            <DropdownMenu :items="LONG_DROPDOWN_ITEMS" :content-props="{'data-fixture-long-dropdown': ''}">
                <Button variant="secondary" size="sm" data-fixture-long-dropdown-trigger>长下拉菜单</Button>
            </DropdownMenu>
            <DropdownMenu :items="SHORT_DROPDOWN_ITEMS" :content-props="{'data-fixture-short-dropdown': ''}">
                <Button variant="secondary" size="sm" data-fixture-short-dropdown-trigger>8 项</Button>
            </DropdownMenu>
            <Select v-model="longFormat" :options="LONG_SELECT_OPTIONS" class="w-[200px]" data-fixture-long-select />
            <div data-fixture-context-area class="popup-lists-context" @contextmenu.prevent="openContext">在这里右键</div>
            <ContextMenu :visible="context !== null" :x="context?.x ?? 0" :y="context?.y ?? 0" :items="contextItems" @close="context = null" />
        </div>
        <div v-else-if="props.sceneId === 'quick-pick' || props.sceneId === 'quick-pick-long'" id="nb-lab-target" class="popup-lists-stage">
            <QuickPick
                v-model:open="quickPickOpen"
                v-model:query="quickPickQuery"
                v-model:active-id="quickPickActive"
                :items="props.sceneId === 'quick-pick' ? QUICK_PICK_ITEMS : quickPickLongItems"
                title="命令"
                placeholder="输入命令"
                empty-text="没有匹配的命令"
                data-fixture-quick-pick
            />
        </div>
        <div v-else id="nb-lab-target" class="popup-lists-stage">
            <DropdownMenu :items="DROPDOWN_ITEMS" :content-props="{'data-fixture-dropdown': ''}">
                <Button variant="secondary" size="sm" data-fixture-dropdown-trigger>下拉菜单</Button>
            </DropdownMenu>
            <Menubar :menus="MENUBAR_MENUS" size="sm" data-fixture-menubar />
            <div data-fixture-context-area class="popup-lists-context" @contextmenu.prevent="openContext">在这里右键</div>
            <ContextMenu :visible="context !== null" :x="context?.x ?? 0" :y="context?.y ?? 0" :items="contextItems" @close="context = null" />
        </div>
    </FixtureShell>
</template>

<style scoped>
.popup-lists-stage {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 24px;
    min-height: 420px;
}

.popup-lists-context {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 240px;
    height: 120px;
    border: 1px dashed var(--divider);
    border-radius: 8px;
    color: var(--text-muted);
    font-size: 12px;
}
</style>
