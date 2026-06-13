<script setup lang="ts">
import Dialog from "nbook/app/components/common/Dialog.vue";

const props = defineProps<{
    modelValue: boolean;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
}>();

type TutorialQuestion = {
    id: string;
    label: string;
};

const tutorialQuestions: TutorialQuestion[] = [
    {id: "agent-mode", label: "什么时候切到 Agent 模式？"},
    {id: "first-chapter", label: "我该从哪里开始写第一章？"},
    {id: "lorebook", label: "世界书和剧本工作台怎么分工？"},
    {id: "rag", label: "RAG 入口能帮我看什么？"},
];

/**
 * 关闭教程 Agent 占位对话框。
 */
function closeDialog(): void {
    emit("update:modelValue", false);
}
</script>

<template>
    <Dialog :model-value="props.modelValue" title="教程 Agent" width="min(680px, calc(100vw - 32px))" :show-footer="false" overlay-type="blur" @update:model-value="emit('update:modelValue', $event)">
        <!-- 教程 Agent 预留内容 -->
        <div class="flex flex-col gap-4">
            <div class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-4 py-3">
                <div class="flex items-start gap-3">
                    <span class="i-lucide-bot h-5 w-5 shrink-0 text-[var(--accent-text)]"></span>
                    <div class="min-w-0">
                        <div class="text-sm font-semibold text-[var(--text-main)]">NeuroBook 教程向导</div>
                        <p class="mt-1 text-sm leading-6 text-[var(--text-secondary)]">这里会接入一个教程特化的 leader Agent，读取教程、参考文档和当前 Project 上下文，帮你理解界面并定位下一步。</p>
                    </div>
                </div>
            </div>

            <div class="grid gap-2 sm:grid-cols-2">
                <button v-for="question in tutorialQuestions" :key="question.id" type="button" class="flex min-h-10 items-center justify-between gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 text-left text-sm text-[var(--text-main)] opacity-70" disabled>
                    <span class="min-w-0 truncate">{{ question.label }}</span>
                    <span class="i-lucide-lock h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]"></span>
                </button>
            </div>

            <div class="rounded-lg border border-dashed border-[var(--border-color)] bg-transparent px-4 py-3">
                <div class="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">预留合同</div>
                <div class="mt-2 grid gap-2 text-xs leading-5 text-[var(--text-secondary)] sm:grid-cols-2">
                    <div class="flex gap-2">
                        <span class="i-lucide-file-search h-4 w-4 shrink-0 text-[var(--accent-text)]"></span>
                        <span>读取教程和参考文档。</span>
                    </div>
                    <div class="flex gap-2">
                        <span class="i-lucide-mouse-pointer-click h-4 w-4 shrink-0 text-[var(--accent-text)]"></span>
                        <span>后续可请求前端打开界面。</span>
                    </div>
                    <div class="flex gap-2">
                        <span class="i-lucide-folder-tree h-4 w-4 shrink-0 text-[var(--accent-text)]"></span>
                        <span>理解当前 Project Workspace 结构。</span>
                    </div>
                    <div class="flex gap-2">
                        <span class="i-lucide-message-square-text h-4 w-4 shrink-0 text-[var(--accent-text)]"></span>
                        <span>保持独立入口，不混入普通 session 列表。</span>
                    </div>
                </div>
            </div>

            <div class="flex items-center justify-between gap-3 border-t border-[var(--border-color)] pt-3">
                <div class="text-xs text-[var(--text-muted)]">真实教程 Agent 与界面动作会在后续接入。</div>
                <button type="button" class="inline-flex h-8 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-sm font-medium text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)]" @click="closeDialog">知道了</button>
            </div>
        </div>
    </Dialog>
</template>
