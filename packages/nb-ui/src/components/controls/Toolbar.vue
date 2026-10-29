<script setup lang="ts">
import {
    ToolbarRoot,
    ToolbarSeparator,
} from "reka-ui";
import {computed} from "vue";

import {useUiText} from "../../text-port";

const props = withDefaults(defineProps<{
    orientation?: "horizontal" | "vertical";
    ariaLabel?: string;
}>(), {
    orientation: "horizontal",
});

const text = useUiText();
const labelText = computed(() => props.ariaLabel ?? text("toolbar.label"));
</script>

<template>
    <ToolbarRoot
        :orientation="props.orientation"
        :aria-label="labelText"
        class="flex items-center gap-1 rounded-[var(--radius-control)] border border-[color-mix(in_srgb,var(--text-main)_10%,transparent)] bg-[var(--bg-panel)] p-1 shadow-sm select-none"
        :class="props.orientation === 'vertical' ? 'flex-col w-max' : 'flex-row w-max max-w-full overflow-x-auto'"
    >
        <slot />
    </ToolbarRoot>
</template>
