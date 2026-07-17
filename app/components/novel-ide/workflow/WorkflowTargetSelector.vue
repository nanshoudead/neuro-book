<script setup lang="ts">
import {onClickOutside} from "@vueuse/core";

type TargetFileOption = {
    title: string;
    path: string;
};

const props = defineProps<{
    files: TargetFileOption[];
    modelValue: string;
    targetTitle: string;
    targetPath: string;
    touched: boolean;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
    (e: "follow-current"): void;
}>();

const {t} = useI18n();
const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);

const selectedIndex = computed(() => props.files.findIndex((file) => file.path === props.modelValue));

onClickOutside(rootRef, () => {
    open.value = false;
});

/** 生成下拉列表中用于快速辨认章节的标题与路径。 */
function optionTitle(file: TargetFileOption): string {
    return file.title.trim() || file.path;
}

/** 选择正文目标，并关闭浮层。 */
function selectTarget(path: string): void {
    emit("update:modelValue", path);
    open.value = false;
}
</script>

<template>
    <!-- 目标正文选择器：使用主题变量绘制，避免原生 select 弹层脱离 IDE 主题。 -->
    <section ref="rootRef" class="workflow-target-selector">
        <div class="mb-1.5 flex items-center justify-between gap-2">
            <span class="field-label">{{ t("ide.workflow.runner.targetFile") }}</span>
            <span class="target-mode" :class="touched ? 'target-mode--pinned' : 'target-mode--following'">
                <span :class="touched ? 'i-lucide-pin' : 'i-lucide-link'" class="h-3 w-3"></span>
                <span>{{ touched ? t("ide.workflow.runner.targetPinned") : t("ide.workflow.runner.targetFollowing") }}</span>
            </span>
        </div>

        <button
            type="button"
            class="target-trigger"
            :class="{'target-trigger--empty': !modelValue, 'target-trigger--open': open}"
            :aria-expanded="open"
            :title="targetPath || targetTitle"
            @click="open = !open"
            @keydown.esc="open = false"
        >
            <span class="target-trigger-icon i-lucide-file-text"></span>
            <span class="min-w-0 flex-1 text-left">
                <span class="block truncate text-xs font-medium text-[var(--text-main)]">{{ targetTitle }}</span>
                <span v-if="targetPath" class="mt-0.5 block truncate font-mono text-[10px] text-[var(--text-muted)]">{{ targetPath }}</span>
            </span>
            <span class="target-trigger-chevron i-lucide-chevron-down" :class="open ? 'rotate-180' : ''"></span>
        </button>

        <div v-if="open" class="target-menu" role="listbox">
            <button
                type="button"
                class="target-option target-option--placeholder"
                :class="!modelValue ? 'target-option--active' : ''"
                role="option"
                :aria-selected="!modelValue"
                @click="selectTarget('')"
            >
                <span class="i-lucide-circle h-3.5 w-3.5 shrink-0"></span>
                <span class="truncate">{{ t("ide.workflow.runner.selectTarget") }}</span>
            </button>

            <div v-if="files.length > 0" class="target-option-list">
                <button
                    v-for="(file, index) in files"
                    :key="file.path"
                    type="button"
                    class="target-option"
                    :class="index === selectedIndex ? 'target-option--active' : ''"
                    role="option"
                    :aria-selected="index === selectedIndex"
                    @click="selectTarget(file.path)"
                >
                    <span :class="index === selectedIndex ? 'i-lucide-check' : 'i-lucide-file-text'" class="h-3.5 w-3.5 shrink-0"></span>
                    <span class="min-w-0 flex-1">
                        <span class="block truncate text-xs font-medium">{{ optionTitle(file) }}</span>
                        <span class="mt-0.5 block truncate font-mono text-[10px] opacity-70">{{ file.path }}</span>
                    </span>
                </button>
            </div>
            <div v-else class="target-empty">{{ t("ide.workflow.runner.noTarget") }}</div>
        </div>

        <button v-if="touched" type="button" class="follow-target-button" @click="emit('follow-current')">
            <span class="i-lucide-link h-3.5 w-3.5"></span>
            <span>{{ t("ide.workflow.runner.followCurrent") }}</span>
        </button>
        <div v-else class="mt-2 text-[10px] leading-4 text-[var(--text-muted)]">{{ t("ide.workflow.runner.followCurrentHelp") }}</div>
    </section>
</template>

<style scoped>
.workflow-target-selector {
    position: relative;
}

.field-label {
    display: block;
    color: var(--text-muted);
    font-size: 10px;
    line-height: 16px;
}

.target-mode {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 9px;
}

.target-mode--following {
    color: var(--status-info);
}

.target-mode--pinned {
    color: var(--status-warning);
}

.target-trigger {
    position: relative;
    display: flex;
    width: 100%;
    min-height: 48px;
    align-items: center;
    gap: 8px;
    border: 1px solid var(--border-color);
    border-radius: 7px;
    background: var(--bg-input);
    padding: 7px 8px;
    color: var(--text-main);
    outline: none;
    transition: border-color 140ms ease, background 140ms ease, box-shadow 140ms ease;
}

.target-trigger:hover,
.target-trigger:focus-visible,
.target-trigger--open {
    border-color: var(--border-accent);
    background: var(--bg-hover);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-main) 18%, transparent);
}

.target-trigger--empty {
    border-color: var(--status-warning-border);
    background: var(--status-warning-bg);
}

.target-trigger-icon {
    width: 16px;
    height: 16px;
    flex: none;
    color: var(--accent-main);
}

.target-trigger-chevron {
    width: 14px;
    height: 14px;
    flex: none;
    color: var(--text-muted);
    transition: transform 140ms ease;
}

.target-menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    left: 0;
    z-index: 70;
    overflow: hidden;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-panel);
    box-shadow: 0 16px 40px color-mix(in srgb, var(--shadow-color) 16%, transparent);
}

.target-option-list {
    max-height: min(270px, 52vh);
    overflow: auto;
    padding: 3px;
}

.target-option {
    display: flex;
    width: 100%;
    min-width: 0;
    align-items: center;
    gap: 8px;
    border-radius: 6px;
    padding: 7px 8px;
    color: var(--text-secondary);
    text-align: left;
    transition: background 120ms ease, color 120ms ease;
}

.target-option:hover,
.target-option:focus-visible {
    background: var(--bg-hover);
    color: var(--text-main);
    outline: none;
}

.target-option--active {
    background: var(--accent-bg);
    color: var(--accent-text);
}

.target-option--placeholder {
    border-bottom: 1px solid var(--border-color);
    border-radius: 0;
}

.target-empty {
    padding: 18px 10px;
    color: var(--text-muted);
    font-size: 11px;
    text-align: center;
}

.follow-target-button {
    display: inline-flex;
    height: 24px;
    align-items: center;
    gap: 5px;
    margin-top: 6px;
    border-radius: 6px;
    padding: 0 6px;
    color: var(--text-secondary);
    font-size: 10px;
}

.follow-target-button:hover {
    background: var(--bg-hover);
    color: var(--text-main);
}
</style>
