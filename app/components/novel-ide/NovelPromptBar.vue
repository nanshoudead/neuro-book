<script setup lang="ts">
import Dropdown from "nbook/app/components/common/Dropdown.vue";
import type {DropdownItem} from "nbook/app/components/common/dropdown.types";
import ReferencePlainTextEditor from "nbook/app/components/common/form/ReferencePlainTextEditor.vue";
import {parseSelectionRefChip, type InlineEditReference, type InlineEditTask} from "nbook/app/utils/inline-editor-selection";

interface InlineTaskOption {
    id: InlineEditTask;
    label: string;
    iconClass: string;
    description: string;
}

const props = defineProps<{
    modelValue: string;
    loading: boolean;
    statusText: string;
    selectedModel: string;
    selectedReasoning: string;
    expanded: boolean;
    task: InlineEditTask;
    references: InlineEditReference[];
    currentPath: string;
    sessionLabel: string;
    editPreview: string;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
    (e: "update:expanded", value: boolean): void;
    (e: "update:task", value: InlineEditTask): void;
    (e: "send"): void;
    (e: "stop"): void;
    (e: "height-change", value: number): void;
    (e: "clear-reference", index: number): void;
    (e: "bind-session"): void;
    (e: "change-model"): void;
}>();

const rootRef = ref<HTMLDivElement | null>(null);
const editorRef = ref<InstanceType<typeof ReferencePlainTextEditor> | null>(null);
let resizeObserver: ResizeObserver | null = null;

const taskOptions: InlineTaskOption[] = [
    {id: "rewrite", label: "改写", iconClass: "i-lucide-refresh-cw", description: "重写表达，保留核心含义"},
    {id: "polish", label: "润色", iconClass: "i-lucide-sparkles", description: "改善文风、节奏和质感"},
    {id: "expand", label: "扩写", iconClass: "i-lucide-stretch-horizontal", description: "增加细节、动作和氛围"},
    {id: "condense", label: "缩写", iconClass: "i-lucide-shrink", description: "压缩啰嗦表达"},
    {id: "continue_after", label: "续写", iconClass: "i-lucide-forward", description: "在引用之后继续写"},
    {id: "bridge", label: "承接", iconClass: "i-lucide-git-compare-arrows", description: "承上启下，连接片段"},
];

const taskDropdownItems = computed<DropdownItem[]>(() => taskOptions.map((option) => ({
    label: option.label,
    value: option.id,
    iconClass: option.iconClass,
    active: option.id === props.task,
    rightIconClass: option.id === props.task ? "i-lucide-check" : undefined,
})));

const currentTask = computed(() => taskOptions.find((option) => option.id === props.task) ?? taskOptions[0]!);
const canSubmit = computed(() => props.loading || Boolean(props.modelValue.trim()) || props.references.length > 0 || Boolean(props.currentPath));

/**
 * 选择 Inline AI 任务。
 */
function selectTask(value: string): void {
    if (taskOptions.some((option) => option.id === value)) {
        emit("update:task", value as InlineEditTask);
    }
}

/**
 * 发送当前 PromptBar 的真实高度。
 */
const reportHeight = (): void => {
    emit("height-change", rootRef.value?.offsetHeight ?? 0);
};

/**
 * 切换 PromptBar 展开状态。
 */
const toggleExpanded = (): void => {
    emit("update:expanded", !props.expanded);
};

/**
 * 处理发送或停止。
 */
const submit = (): void => {
    if (props.loading) {
        emit("stop");
        return;
    }
    if (!canSubmit.value) {
        return;
    }
    emit("send");
};

/**
 * 读取 selection chip 的紧凑展示名。
 */
function referenceLabel(reference: InlineEditReference): string {
    return parseSelectionRefChip(reference.ref)?.label ?? reference.path;
}

/**
 * 读取引用定位状态。
 */
function referenceMatchLabel(reference: InlineEditReference): string {
    if (reference.match === "unique") {
        return "已定位";
    }
    if (reference.match === "ambiguous") {
        return "多处匹配";
    }
    return "未定位";
}

watch(() => props.expanded, async (expanded) => {
    await nextTick();
    reportHeight();
    if (expanded) {
        editorRef.value?.focus();
    }
}, {immediate: true});

watch(() => [props.modelValue, props.references.length, props.editPreview], async () => {
    await nextTick();
    reportHeight();
});

onMounted(async () => {
    await nextTick();
    reportHeight();

    if (rootRef.value) {
        resizeObserver = new ResizeObserver(() => {
            reportHeight();
        });
        resizeObserver.observe(rootRef.value);
    }
});

onBeforeUnmount(() => {
    resizeObserver?.disconnect();
    resizeObserver = null;
});
</script>

<template>
    <!-- 底部 Inline AI Prompt Bar -->
    <div ref="rootRef" class="ide-prompt-bar z-20 shrink-0 px-4">
        <div v-if="props.expanded" class="relative mx-auto w-full max-w-4xl pb-5 pt-7">
            <button
                class="absolute left-1/2 top-7 flex h-6 w-12 -translate-x-1/2 -translate-y-full items-center justify-center rounded-t-full border border-b-0 border-[var(--prompt-border)] bg-[var(--prompt-bg)] text-[var(--text-secondary)] shadow-sm transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                title="收起 Inline AI"
                @click="toggleExpanded"
            >
                <span class="i-lucide-chevron-down h-3.5 w-3.5"></span>
            </button>

            <div class="w-full overflow-hidden rounded-xl border border-[var(--prompt-border)] bg-[var(--prompt-bg)] shadow-2xl shadow-black/10 transition-all focus-within:border-[var(--accent-main)] focus-within:ring-1 focus-within:ring-[var(--accent-main)]">
                <!-- Inline AI 修改预览 -->
                <div v-if="props.editPreview" class="border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] px-4 py-2 text-xs text-[var(--text-secondary)]">
                    <div class="mb-1 flex items-center gap-2 font-medium text-[var(--text-main)]">
                        <span class="i-lucide-file-diff h-3.5 w-3.5 text-[var(--accent-text)]"></span>
                        <span>正在修改</span>
                    </div>
                    <div class="line-clamp-3 whitespace-pre-wrap leading-5">{{ props.editPreview }}</div>
                </div>

                <!-- Inline AI 引用区 -->
                <div class="border-b border-[var(--border-color)] px-4 py-2">
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="inline-flex items-center gap-1 text-xs font-medium text-[var(--text-secondary)]">
                            <span class="i-lucide-quote h-3.5 w-3.5"></span>
                            <span>引用</span>
                        </span>
                        <button
                            v-for="(reference, index) in props.references"
                            :key="`${reference.ref}:${String(index)}`"
                            type="button"
                            class="group inline-flex max-w-[18rem] items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-panel)] px-2.5 py-1 text-xs text-[var(--text-main)] transition-colors hover:border-rose-500/50 hover:text-rose-600"
                            :title="`${reference.ref} · ${referenceMatchLabel(reference)}`"
                            @click="emit('clear-reference', index)"
                        >
                            <span class="i-lucide-text-select h-3.5 w-3.5 text-[var(--accent-text)] group-hover:hidden"></span>
                            <span class="i-lucide-x hidden h-3.5 w-3.5 group-hover:inline-block"></span>
                            <span class="truncate">{{ referenceLabel(reference) }}</span>
                            <span class="shrink-0 text-[10px] text-[var(--text-muted)]">{{ referenceMatchLabel(reference) }}</span>
                        </button>
                        <span v-if="props.references.length === 0" class="text-xs text-[var(--text-muted)]">
                            未绑定选区，AI 将根据当前文件和要求判断修改范围
                        </span>
                    </div>
                </div>

                <ReferencePlainTextEditor
                    ref="editorRef"
                    :model-value="props.modelValue"
                    placeholder="输入编辑要求，例如：让这段更克制一点，减少解释，多用动作和环境表达情绪。"
                    :min-height="64"
                    :max-height="180"
                    borderless
                    submit-on-enter
                    enable-quick-triggers
                    @update:model-value="emit('update:modelValue', $event)"
                    @submit="submit"
                />

                <!-- Inline AI 控制区 -->
                <div class="flex items-center justify-between gap-3 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)] px-3 py-2">
                    <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                        <Dropdown :items="taskDropdownItems" root-class="relative inline-block" menu-class="left-0 bottom-full mb-1.5 w-40" compact @select="selectTask">
                            <button class="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" type="button" :title="currentTask.description">
                                <span :class="currentTask.iconClass" class="h-3.5 w-3.5 text-[var(--accent-text)]"></span>
                                <span>{{ currentTask.label }}</span>
                                <span class="i-lucide-chevron-up h-3 w-3 text-[var(--text-muted)]"></span>
                            </button>
                        </Dropdown>

                        <button class="inline-flex h-8 max-w-[12rem] items-center gap-1.5 rounded-md px-2.5 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" type="button" title="绑定 Inline AI Session" @click="emit('bind-session')">
                            <span class="i-lucide-message-square-more h-3.5 w-3.5 text-[var(--text-muted)]"></span>
                            <span class="truncate">{{ props.sessionLabel }}</span>
                        </button>

                        <button class="inline-flex h-8 max-w-[12rem] items-center gap-1.5 rounded-md px-2.5 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" type="button" title="切换模型" @click="emit('change-model')">
                            <span class="i-lucide-cpu h-3.5 w-3.5 text-[var(--text-muted)]"></span>
                            <span class="truncate">{{ props.selectedModel }}</span>
                        </button>

                        <span class="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs text-[var(--text-secondary)]" :title="`推理强度：${props.selectedReasoning}`">
                            <span class="i-lucide-brain h-3.5 w-3.5 text-[var(--text-muted)]"></span>
                            <span>{{ props.selectedReasoning }}</span>
                        </span>
                    </div>

                    <div class="flex items-center gap-3">
                        <div class="hidden text-right sm:block">
                            <div class="text-[10px] uppercase tracking-[0.24em] text-[var(--text-muted)]">INLINE AI</div>
                            <div class="max-w-[14rem] truncate text-xs text-[var(--text-secondary)]">{{ props.statusText }}</div>
                        </div>

                        <button
                            class="flex h-8 w-8 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-45"
                            :class="props.loading ? 'border-rose-500/50 bg-rose-500/10 text-rose-500' : 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)] hover:opacity-85'"
                            :disabled="!canSubmit"
                            :title="props.loading ? '停止' : '发送给 Inline AI'"
                            @click="submit"
                        >
                            <span v-if="props.loading" class="i-lucide-square h-3.5 w-3.5"></span>
                            <span v-else class="i-lucide-send h-3.5 w-3.5"></span>
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <div v-else class="flex justify-center">
            <button
                class="flex h-6 w-12 items-center justify-center rounded-t-full border border-b-0 border-[var(--prompt-border)] bg-[var(--prompt-bg)] text-[var(--text-secondary)] shadow-sm transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                title="展开 Inline AI"
                @click="toggleExpanded"
            >
                <span class="i-lucide-sparkles h-3.5 w-3.5"></span>
            </button>
        </div>
    </div>
</template>
