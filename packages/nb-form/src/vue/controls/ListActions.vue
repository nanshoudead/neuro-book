<script setup lang="ts">
/**
 * 列表项的上移、下移、删除（docs/specs/ui/forms.md 输出 19）。图标按钮，读屏名称带上项的标题；按钮带
 * `data-nb-list-action`，增删排序后的焦点按它找“同类控件”。到了边界的按钮停用。
 */
import {useFormText} from "../text";

const props = defineProps<{
    index: number;
    count: number;
    title: string;
    disabled: boolean;
    canRemove: boolean;
}>();
const emit = defineEmits<{(event: "move", delta: -1 | 1): void; (event: "remove"): void}>();

const text = useFormText();
</script>

<template>
    <div class="nb-form-actions">
        <button
            type="button"
            class="nb-form-actions__button"
            data-nb-list-action="up"
            :aria-label="text.t('format.labelled', {label: text.t('moveUp'), text: props.title})"
            :title="text.t('moveUp')"
            :disabled="props.disabled || props.index === 0"
            @click="emit('move', -1)"
        >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6" /></svg>
        </button>
        <button
            type="button"
            class="nb-form-actions__button"
            data-nb-list-action="down"
            :aria-label="text.t('format.labelled', {label: text.t('moveDown'), text: props.title})"
            :title="text.t('moveDown')"
            :disabled="props.disabled || props.index >= props.count - 1"
            @click="emit('move', 1)"
        >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </button>
        <button
            type="button"
            class="nb-form-actions__button"
            data-nb-list-action="remove"
            :aria-label="text.t('format.labelled', {label: text.t('remove'), text: props.title})"
            :title="text.t('remove')"
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
    gap: var(--space-2);
}

/* 删除没有确认也没有撤销：与移动按钮隔开一段，免得点“下移”误中它（审查 S3 Sonnet 18）。 */
.nb-form-actions__button[data-nb-list-action="remove"] {
    margin-left: var(--space-3);
}

.nb-form-actions__button {
    display: inline-flex;
    width: 28px;
    height: 28px;
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
    color: color-mix(in srgb, var(--text-muted) 45%, transparent);
    cursor: default;
}

/* 触屏上放大到手指点得准的大小。 */
@media (pointer: coarse) {
    .nb-form-actions__button {
        width: 40px;
        height: 40px;
    }
}

.nb-form-actions__button:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}
</style>
