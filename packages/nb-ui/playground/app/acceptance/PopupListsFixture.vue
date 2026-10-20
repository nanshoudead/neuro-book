<script setup lang="ts">
import {ref} from "vue";
import Button from "../../../src/components/controls/Button.vue";
import DropdownMenu from "../../../src/components/controls/DropdownMenu.vue";
import Menubar from "../../../src/components/controls/Menubar.vue";
import ContextMenu from "../../../src/components/feedback/ContextMenu.vue";
import type {ContextMenuItem} from "../../../src/components/feedback/context-menu.types";
import FixtureShell from "./AcceptanceShell.vue";
import type {LabComponentDefinition} from "./definitions";

/**
 * 弹出列表的验收夹具（w00029 t04，e2e/popup-lists.spec.ts）：行高、字号、圆角、高亮与勾选列要在真实布局与真实指针下量，
 * happy-dom 没有布局也不产生指针移动。菜单一族各放一个：DropdownMenu（reka 的项加手工级联）、Menubar、右键菜单（全是普通按钮项）。
 */
defineProps<{
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

const context = ref<{x: number; y: number} | null>(null);
function openContext(event: MouseEvent): void {
    context.value = {x: event.clientX, y: event.clientY};
}
</script>

<template>
    <FixtureShell v-model:controls="controls" :definition="definition" :scene-id="sceneId">
        <div id="nb-lab-target" class="popup-lists-stage">
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
