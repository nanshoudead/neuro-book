<script setup lang="ts">
/**
 * 列表项的上移、下移、删除（docs/specs/ui/forms.md 输出 19）。图标按钮，读屏名称带上项的标题；按钮带
 * `data-nb-list-action`，增删排序后的焦点按它找“同类控件”。到了边界的按钮停用。
 */
import {computed} from "vue";

import {messagesFor} from "../messages";

const props = defineProps<{
    index: number;
    count: number;
    title: string;
    disabled: boolean;
    canRemove: boolean;
    locale: string;
}>();
const emit = defineEmits<{(event: "move", delta: -1 | 1): void; (event: "remove"): void}>();

const messages = computed(() => messagesFor(props.locale));
</script>

<template>
    <div class="nb-form-actions">
        <button
            type="button"
            class="nb-form-actions__button"
            data-nb-list-action="up"
            :aria-label="`${messages.moveUp}：${props.title}`"
            :title="messages.moveUp"
            :disabled="props.disabled || props.index === 0"
            @click="emit('move', -1)"
        >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6" /></svg>
        </button>
        <button
            type="button"
            class="nb-form-actions__button"
            data-nb-list-action="down"
            :aria-label="`${messages.moveDown}：${props.title}`"
            :title="messages.moveDown"
            :disabled="props.disabled || props.index >= props.count - 1"
            @click="emit('move', 1)"
        >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </button>
        <button
            type="button"
            class="nb-form-actions__button"
            data-nb-list-action="remove"
            :aria-label="`${messages.remove}：${props.title}`"
            :title="messages.remove"
            :disabled="props.disabled || !props.canRemove"
            @click="emit('remove')"
        >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
        </button>
    </div>
</template>

<style scoped>
.nb-form-actions {
    display: flex;
    flex: none;
    gap: var(--space-1);
}

.nb-form-actions__button {
    display: inline-flex;
    width: var(--control-h-sm, 24px);
    height: var(--control-h-sm, 24px);
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
}

.nb-form-actions__button:hover:not(:disabled) {
    background: color-mix(in srgb, var(--text-main) 8%, transparent);
    color: var(--text-main);
}

.nb-form-actions__button:disabled {
    opacity: 0.35;
    cursor: default;
}

.nb-form-actions__button:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
}
</style>
