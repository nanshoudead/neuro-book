<script setup lang="ts">
/**
 * 展示态里的一个值（docs/specs/ui/forms.md 输出 17）：可换行的静态文字，超长时折叠、可展开；文字类可以复制。只有展开
 * 与复制按钮是 Tab 停靠点。
 */
import {computed, ref, useId, watch} from "vue";

import {messagesFor} from "./messages";

/** 超过这么多行或这么多字时先折叠。 */
const FOLD_LINES = 6;
const FOLD_CHARS = 400;

const props = withDefaults(defineProps<{
    text: string;
    locale: string;
    /** 文字类的值：给复制按钮。 */
    copyable?: boolean;
    /** 没有值：显示占位，弱化。 */
    empty?: boolean;
    /** 字段的标签：按钮的读屏名称带上它（“复制：路径”），一张表单里几个“复制”才分得开。 */
    label?: string;
}>(), {copyable: false, empty: false, label: ""});

const contentId = `nb-form-view-${useId()}`;
const messages = computed(() => messagesFor(props.locale));
const foldable = computed(() => props.text.split("\n").length > FOLD_LINES || props.text.length > FOLD_CHARS);
const expanded = ref(false);
type CopyState = "idle" | "copied" | "failed";
const copyState = ref<CopyState>("idle");
watch(() => props.text, () => {
    copyState.value = "idle";
});

async function copy(): Promise<void> {
    try {
        await navigator.clipboard.writeText(props.text);
        copyState.value = "copied";
    } catch {
        // 剪贴板不可用（没有权限、不安全的上下文）：按钮与读屏都报“复制失败”，文字仍可以手动选中复制。
        copyState.value = "failed";
    }
}

const copyLabel = computed(() => (copyState.value === "copied" ? messages.value.copied : copyState.value === "failed" ? messages.value.copyFailed : messages.value.copy));
</script>

<template>
    <div class="nb-form-view" :style="{'--nb-form-fold-lines': FOLD_LINES}">
        <div
            :id="contentId"
            class="nb-form-view__text"
            :class="{'nb-form-view__text--folded': foldable && !expanded, 'nb-form-view__text--empty': props.empty}"
        >{{ props.empty ? messages.empty : props.text }}</div>
        <div v-if="!props.empty && (foldable || props.copyable)" class="nb-form-view__actions">
            <button
                v-if="foldable"
                type="button"
                class="nb-form-view__action"
                :aria-label="props.label ? (expanded ? messages.collapseOf(props.label) : messages.expandOf(props.label)) : undefined"
                :aria-expanded="expanded"
                :aria-controls="contentId"
                @click="expanded = !expanded"
            >
                {{ expanded ? messages.collapse : messages.expand }}
            </button>
            <button
                v-if="props.copyable"
                type="button"
                class="nb-form-view__action"
                :aria-label="props.label && copyState === 'idle' ? messages.copyOf(props.label) : undefined"
                @click="copy"
                @blur="copyState = 'idle'"
            >
                {{ copyLabel }}
            </button>
            <span class="nb-form-sr-only" aria-live="polite">{{ copyState === "idle" ? "" : copyLabel }}</span>
        </div>
    </div>
</template>

<style scoped>
.nb-form-view {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: var(--space-2);
}

.nb-form-view__text {
    font-size: var(--text-sm);
    line-height: var(--leading-ui);
    color: var(--text-main);
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    user-select: text;
}

.nb-form-view__text--folded {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: var(--nb-form-fold-lines);
}

.nb-form-view__text--empty {
    color: var(--text-muted);
}

.nb-form-view__actions {
    display: flex;
    gap: var(--space-4);
}

.nb-form-view__action {
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    padding: 0;
    font: inherit;
    font-size: var(--text-xs);
    color: var(--accent-main);
    cursor: pointer;
}

/* `--focus-ring` 是一串 box-shadow，不能写进 outline（审查 S3 Sonnet 9）。 */
.nb-form-view__action:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.nb-form-sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}
</style>
