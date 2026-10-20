<script setup lang="ts">
import {computed, ref, useTemplateRef} from "vue";
import {SuggestionMenu, suggestionMenuOptions} from "@notnotype/nb-ui/components";

import LabFixtureControls from "../../LabFixtureControls.vue";
import {useLabSubject} from "../../lab-subject";
import type {LabFixtureProps} from "../../lab-subject";

const props = defineProps<LabFixtureProps>();
/*
 * 候选菜单总是挂在宿主的输入处旁边：这里的文本框扮演宿主，焦点留在它上面，上下键与回车由它处理。锚点不是可序列化的
 * 场景输入，由场景决定：`caret*` 场景贴着文本框里的一个假光标（`caret-bottom` 把它放在舞台底部，看往上翻），其余贴着
 * 文本框外框、与它同宽。
 */
const subject = useLabSubject<typeof SuggestionMenu>(() => props.input, ["select", "highlight"]);
const caretScene = computed(() => props.scene.startsWith("caret"));

const caret = useTemplateRef<HTMLElement>("caret");
const box = useTemplateRef<HTMLElement>("box");
const anchor = computed(() => {
    if (!caretScene.value) return box.value;
    const element = caret.value;
    return element === null ? null : {getBoundingClientRect: () => element.getBoundingClientRect(), contextElement: element};
});

const options = computed(() => suggestionMenuOptions(subject.bindings.value.groups ?? []));
function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const list = options.value;
    if (list.length === 0) return;
    event.preventDefault();
    const current = list.findIndex((item) => item.id === subject.bindings.value.activeId);
    const step = event.key === "ArrowDown" ? 1 : -1;
    subject.write("props", "activeId", list[(Math.max(current, 0) + step + list.length) % list.length]!.id);
}

const text = ref("把伏笔挪到 @第二");
</script>

<template>
    <div class="flex h-full w-full flex-col p-4" :class="props.scene === 'caret-bottom' ? 'justify-end' : 'justify-start'">
        <div ref="box" class="relative w-full max-w-[480px] rounded-[var(--radius-control)] border border-[var(--control-outline)] bg-[var(--bg-panel)] px-3 py-2">
            <textarea v-model="text" rows="2" class="block w-full resize-none bg-transparent text-[13px] leading-relaxed text-[var(--text-main)] outline-none" aria-label="输入框" @keydown="onKeydown"></textarea>
            <span v-if="caretScene" ref="caret" class="absolute left-[120px] top-[10px] h-4 w-px bg-[var(--text-main)]" aria-hidden="true"></span>
        </div>
        <SuggestionMenu
            v-bind="subject.bindings.value"
            :anchor="anchor"
            :match-anchor-width="!caretScene"
            data-lab-subject
            @highlight="subject.write('props', 'activeId', $event)"
        />
    </div>
    <LabFixtureControls>
        <span class="text-xs text-[var(--text-secondary)]">焦点在文本框里，上下键移动当前项</span>
    </LabFixtureControls>
</template>
