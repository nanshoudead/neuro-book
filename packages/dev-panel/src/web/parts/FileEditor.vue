<script setup lang="ts">
import {Textarea, SegmentedControl} from "@notnotype/nb-ui/components";
import {computed, ref} from "vue";
import {countNonEmptyLines} from "../../core/text-rules.js";
import MarkdownView from "./MarkdownView.vue";

/**
 * Markdown 编辑器：组合 nb-ui 的 `Textarea`、`SegmentedControl` 与 `MarkdownView`（不改 nb-ui、不加编辑器依赖）。
 * 预览的 HTML 由页面用 `host/markdown.ts` 渲染后传进来；根级治理入口另显示非空行数与上限。
 */
const props = defineProps<{
    modelValue: string;
    /** 当前文本渲染出的预览（页面经 `renderMarkdown` 生成）。 */
    previewHtml: string;
    readonly: boolean;
    /** 治理检查的非空行上限；不是治理入口时为 null。 */
    lineLimit: number | null;
}>();
const emit = defineEmits<{"update:modelValue": [value: string]; navigate: [href: string]}>();

const mode = ref<"edit" | "preview">("edit");
const MODES = [{value: "edit", label: "编辑"}, {value: "preview", label: "预览"}];
const lines = computed(() => (props.lineLimit === null ? 0 : countNonEmptyLines(props.modelValue)));
</script>

<template>
    <div class="flex min-h-0 flex-col gap-2">
        <div class="flex flex-wrap items-center gap-3">
            <SegmentedControl :model-value="mode" :options="MODES" aria-label="编辑或预览" @update:model-value="(value) => (mode = value as 'edit' | 'preview')" />
            <span v-if="lineLimit !== null" class="nbdev-small" :class="lines > lineLimit ? 'nbdev-danger' : 'nbdev-secondary'">
                非空行 {{ lines }} / {{ lineLimit }}{{ lines > lineLimit ? "：超过治理检查的上限，提交后 master 过不了 governance:check" : "" }}
            </span>
        </div>
        <Textarea v-if="mode === 'edit'" :model-value="modelValue" :rows="28" :readonly="readonly" class="font-mono nbdev-body" aria-label="文件内容" @update:model-value="(value: string) => emit('update:modelValue', value)" />
        <div v-else class="min-h-[20rem] rounded-[var(--radius-panel)] p-4 nbdev-surface">
            <MarkdownView :html="previewHtml" @navigate="(href) => emit('navigate', href)" />
        </div>
    </div>
</template>
