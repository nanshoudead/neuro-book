<script setup lang="ts">
import {computed, ref, useTemplateRef} from "vue";
import SuggestionMenu from "../../../src/components/popup/SuggestionMenu.vue";
import {suggestionMenuOptions, suggestionOptionId, type SuggestionMenuGroup} from "../../../src/components/popup/suggestion-menu";
import FixtureShell from "./AcceptanceShell.vue";
import type {LabComponentDefinition} from "./definitions";

/**
 * SuggestionMenu 的验收夹具（w00029 t04，e2e/suggestion-menu.spec.ts）。宿主是一个文本框：焦点一直在它上面，上下键与回车
 * 由它处理，`aria-activedescendant` 用 `suggestionOptionId`。
 *
 * - `caret`：锚点是虚拟锚点，读一个可以被用例挪动的“光标”元素的矩形；用例改它的位置，看菜单逐帧跟上、上下翻转。
 * - `header`：锚点是文本框外框、与它同宽，顶部插槽放一个搜索框。
 * - `wide`：锚点比窗口还宽，看菜单收窄到可用宽度。
 */
const props = defineProps<{
    definition: LabComponentDefinition;
    sceneId: string;
}>();

const controls = ref<Record<string, string | boolean>>({});

const GROUPS: SuggestionMenuGroup[] = [
    {id: "chapters", label: "正文", items: Array.from({length: 12}, (_, index) => ({id: `chapter-${String(index + 1)}`, label: `第 ${String(index + 1)} 章`, iconClass: "i-lucide-file-text", hint: `正文/第${String(index + 1)}章.md`}))},
    {id: "settings", label: "设定", items: [
        {id: "clock", label: "钟表铺", iconClass: "i-lucide-map-pin", hint: "设定/地点/钟表铺.md"},
        {id: "locked", label: "（只读）旧设定", disabled: true},
        {id: "lin", label: "林雪", iconClass: "i-lucide-user", hint: "设定/人物/林雪.md"},
    ]},
];

const query = ref("");
const filtered = computed<SuggestionMenuGroup[]>(() => GROUPS.map((group) => ({...group, items: group.items.filter((item) => item.label.includes(query.value))})).filter((group) => group.items.length > 0));
const options = computed(() => suggestionMenuOptions(filtered.value));
const activeId = ref<string | null>("chapter-1");
const activeIndex = computed(() => options.value.findIndex((item) => item.id === activeId.value));
const chosen = ref<string[]>([]);

const MENU_ID = "fixture-suggestions";
const activeDescendant = computed(() => (activeIndex.value < 0 ? undefined : suggestionOptionId(MENU_ID, activeIndex.value)));

function onKeydown(event: KeyboardEvent): void {
    const count = options.value.length;
    if (count === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        activeId.value = options.value[(Math.max(activeIndex.value, 0) + step + count) % count]!.id;
    } else if (event.key === "Enter" && activeId.value !== null) {
        event.preventDefault();
        chosen.value = [...chosen.value, activeId.value];
    }
}

const caret = useTemplateRef<HTMLElement>("caret");
const open = ref(true);
const box = useTemplateRef<HTMLElement>("box");
const anchor = computed(() => {
    if (!open.value) return null;
    if (props.sceneId === "caret") {
        const element = caret.value;
        return element === null ? null : {getBoundingClientRect: () => element.getBoundingClientRect(), contextElement: element};
    }
    return box.value;
});
</script>

<template>
    <FixtureShell v-model:controls="controls" :definition="definition" :scene-id="sceneId">
        <div id="nb-lab-target" class="suggestion-stage">
            <div ref="box" class="suggestion-box" :class="{'suggestion-box--wide': props.sceneId === 'wide'}">
                <textarea
                    v-model="query"
                    data-fixture-input
                    role="combobox"
                    aria-expanded="true"
                    :aria-controls="MENU_ID"
                    :aria-activedescendant="activeDescendant"
                    rows="3"
                    class="suggestion-input"
                    @keydown="onKeydown"
                ></textarea>
            </div>
            <span ref="caret" data-fixture-caret class="suggestion-caret" aria-hidden="true"></span>
            <output data-fixture-chosen class="suggestion-chosen">{{ chosen.join(",") }}</output>
            <button type="button" data-fixture-toggle @click="open = !open">{{ open ? "关闭候选" : "打开候选" }}</button>
            <SuggestionMenu
                :id="MENU_ID"
                :groups="filtered"
                :active-id="activeId"
                :anchor="anchor"
                :match-anchor-width="props.sceneId !== 'caret'"
                label="候选"
                empty-text="没有匹配的候选"
                @highlight="activeId = $event"
                @select="chosen = [...chosen, $event]"
            >
                <template v-if="props.sceneId === 'header'" #header>
                    <input data-fixture-search class="suggestion-search" placeholder="搜索输入历史">
                </template>
            </SuggestionMenu>
        </div>
    </FixtureShell>
</template>

<style scoped>
.suggestion-stage {
    position: relative;
    min-height: 480px;
}

.suggestion-box {
    width: 360px;
    border: 1px solid var(--control-outline);
    border-radius: 8px;
}

.suggestion-box--wide {
    width: 2400px;
}

.suggestion-input {
    display: block;
    width: 100%;
    padding: 8px;
    border: none;
    background: transparent;
    color: var(--text-main);
    font-size: 13px;
    outline: none;
    resize: none;
}

/* 用例挪动的“光标”：改它的 top、left，菜单逐帧跟上。 */
.suggestion-caret {
    position: fixed;
    top: 200px;
    left: 200px;
    width: 1px;
    height: 16px;
    background: var(--text-main);
}

.suggestion-chosen {
    display: block;
    margin-top: 8px;
    font-size: 12px;
}

.suggestion-search {
    width: 100%;
    margin-bottom: 4px;
    padding: 4px 8px;
    border: 1px solid var(--control-outline);
    border-radius: 6px;
    background: transparent;
    color: var(--text-main);
    font-size: 12px;
}
</style>
