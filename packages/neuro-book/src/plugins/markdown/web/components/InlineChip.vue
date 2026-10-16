<script setup lang="ts">
/** 行内小块（同名 .md）：外观的判断在 `chip.ts`，与编辑器、展示器的普通 DOM 共用。 */
import {computed} from "vue";

import FileIcon from "nbook/ui/file-icons/FileIcon.vue";
import type {DisplayLocale} from "nbook/shared/localized-text";

import {chipView} from "../parts/chip";
import type {InlineChipKind} from "../parts/chip";

const props = withDefaults(defineProps<{
    kind: InlineChipKind;
    locale: DisplayLocale;
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

const view = computed(() => chipView({kind: props.kind, label: props.label, target: props.target, base: props.base, number: props.number, state: props.state, error: props.error, locale: props.locale}));

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
        <FileIcon v-else-if="'file' in view.icon" class="nb-chip__icon" :icon="view.icon.file" />
        <span v-else class="nb-chip__icon" :class="view.icon.className" aria-hidden="true"></span>
        <span class="nb-chip__label">{{ view.text }}</span>
    </span>
</template>
