<script setup lang="ts">
import {ref} from "vue";
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
 * 右键菜单（全是普通按钮项）；`select`、`quick-pick` 各放一个，带说明的两行项与单行项混排。
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
const quickPickOpen = ref(props.sceneId === "quick-pick");
const quickPickQuery = ref("");
const quickPickActive = ref<string | null>("open");

const context = ref<{x: number; y: number} | null>(null);
function openContext(event: MouseEvent): void {
    context.value = {x: event.clientX, y: event.clientY};
}
</script>

<template>
    <FixtureShell v-model:controls="controls" :definition="definition" :scene-id="sceneId">
        <div v-if="props.sceneId === 'select'" id="nb-lab-target" class="popup-lists-stage">
            <Select v-model="format" :options="SELECT_OPTIONS" class="w-[220px]" data-fixture-select />
        </div>
        <div v-else-if="props.sceneId === 'quick-pick'" id="nb-lab-target" class="popup-lists-stage">
            <QuickPick
                v-model:open="quickPickOpen"
                v-model:query="quickPickQuery"
                v-model:active-id="quickPickActive"
                :items="QUICK_PICK_ITEMS"
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
            <ContextMenu :visible="context !== null" :x="context?.x ?? 0" :y="context?.y ?? 0" :items="CONTEXT_ITEMS" @close="context = null" />
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
