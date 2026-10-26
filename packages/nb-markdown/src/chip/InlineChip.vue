<script setup lang="ts">
/**
 * 行内小块（同名 .md）：外观的判断在 `chip.ts`，与编辑器、展示器的普通 DOM 共用。宿主的目标分类与文件图标经属性 `env` 给，
 * 不 inject：调用它的组件（PromptEditor 的节点视图、PromptTextView）从宿主取了再传下来。
 */
import {computed, ref, watchPostEffect} from "vue";

import type {MarkdownLocale} from "../locale";
import {chipView, defaultChipEnv, renderChipIcon} from "./chip";
import type {ChipEnv, InlineChipKind} from "./chip";

const props = withDefaults(defineProps<{
    kind: InlineChipKind;
    locale: MarkdownLocale;
    env?: ChipEnv;
    label?: string;
    target?: string;
    base?: string | null;
    number?: number | null;
    state?: "ready" | "uploading" | "failed";
    error?: string;
    highlighted?: boolean;
    selected?: boolean;
    interactive?: boolean;
}>(), {
    env: () => defaultChipEnv,
    label: "",
    target: "",
    base: null,
    number: null,
    state: "ready",
    error: "",
    highlighted: false,
    selected: false,
    interactive: false,
});

const emit = defineEmits<{
    (e: "activate"): void;
    (e: "hover", active: boolean): void;
}>();

const view = computed(() => chipView({kind: props.kind, label: props.label, target: props.target, base: props.base, number: props.number, state: props.state, error: props.error, locale: props.locale}, props.env));

/** 宿主画的图标（文件图标）是一个元素，渲染之后挂进这个不占位的 span；换了图标就换元素。 */
const iconHost = ref<HTMLElement | null>(null);
watchPostEffect(() => {
    const host = iconHost.value;
    const icon = view.value.icon;
    if (host === null || view.value.busy || !("render" in icon)) return;
    host.replaceChildren(renderChipIcon(host.ownerDocument, icon));
});

function onKeydown(event: KeyboardEvent): void {
    if (props.interactive && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        emit("activate");
    }
}
</script>

<template>
    <span
        class="nb-chip"
        :class="[view.tone, {'is-highlighted': props.highlighted, 'is-in-selection': props.selected}]"
        :data-inline-chip="props.kind"
        :title="view.title"
        :aria-label="view.title"
        :role="props.interactive ? 'button' : undefined"
        :tabindex="props.interactive ? 0 : undefined"
        @click="emit('activate')"
        @keydown="onKeydown"
        @mouseenter="emit('hover', true)"
        @mouseleave="emit('hover', false)"
    >
        <span v-if="view.busy" class="nb-chip__icon nb-chip__spinner i-lucide-loader-circle" aria-hidden="true"></span>
        <span v-else-if="'render' in view.icon" ref="iconHost" class="nb-chip__icon-host"></span>
        <span v-else class="nb-chip__icon" :class="view.icon.className" aria-hidden="true"></span>
        <span class="nb-chip__label">{{ view.text }}</span>
    </span>
</template>

<style scoped>
.nb-chip__icon-host {
    display: contents;
}
</style>
