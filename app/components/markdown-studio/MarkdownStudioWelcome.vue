<script setup lang="ts">
import type {WorkspaceEditorTab, WorkspaceFileNode} from "nbook/app/stores/novel-ide";
import MarkdownStudioTutorialAgentDialog from "nbook/app/components/markdown-studio/MarkdownStudioTutorialAgentDialog.vue";

type WorkspaceMode = "novel" | "user-assets";

type WelcomeAction = {
    id: string;
    label: string;
    description: string;
    iconClass: string;
    primary?: boolean;
    action: () => void;
};

const props = withDefaults(defineProps<{
    node: WorkspaceFileNode | null;
    tabs?: WorkspaceEditorTab[];
    agentModeActive?: boolean;
    compact?: boolean;
    workspaceMode?: WorkspaceMode;
}>(), {
    tabs: () => [],
    agentModeActive: false,
    compact: false,
    workspaceMode: "novel",
});

const emit = defineEmits<{
    (e: "select-tab", path: string): void;
    (e: "open-path", path: string): void;
    (e: "open-files"): void;
    (e: "create-chapter"): void;
    (e: "create-markdown-file"): void;
    (e: "create-lorebook-entry"): void;
    (e: "open-agent-panel"): void;
    (e: "switch-agent-mode"): void;
    (e: "toggle-agent-surface"): void;
    (e: "open-bookshelf"): void;
    (e: "open-plot-workbench"): void;
    (e: "open-rag-inspector"): void;
    (e: "open-user-assets"): void;
    (e: "open-profile-workbench"): void;
}>();

const tutorialDialogOpen = ref(false);
const readonlyNode = computed(() => props.node !== null && !props.node.editable);
const visibleTabs = computed(() => props.tabs.slice(0, props.compact ? 3 : 5));

const startActions = computed<WelcomeAction[]>(() => {
    if (props.workspaceMode === "user-assets") {
        return [
            {
                id: "assets-files",
                label: "查看资产文件",
                description: "打开用户资产文件树。",
                iconClass: "i-lucide-folder-tree",
                primary: true,
                action: () => emit("open-files"),
            },
            {
                id: "profile-workbench",
                label: "Profile 工作台",
                description: "编辑用户级 Agent profile。",
                iconClass: "i-lucide-file-code-2",
                action: () => emit("open-profile-workbench"),
            },
            {
                id: "tutorial-agent",
                label: "询问教程 Agent",
                description: "从教程入口了解资产工作区。",
                iconClass: "i-lucide-message-circle-question",
                action: openTutorialDialog,
            },
        ];
    }

    return [
        {
            id: "chapter",
            label: "新建章节",
            description: "在 manuscript 下开始正文。",
            iconClass: "i-lucide-pen-line",
            primary: true,
            action: () => emit("create-chapter"),
        },
        {
            id: "lorebook",
            label: "新建世界书条目",
            description: "记录角色、地点或规则。",
            iconClass: "i-lucide-book-plus",
            action: () => emit("create-lorebook-entry"),
        },
        {
            id: "markdown",
            label: "新建 Markdown",
            description: "创建普通项目文档。",
            iconClass: "i-lucide-file-plus-2",
            action: () => emit("create-markdown-file"),
        },
        {
            id: "files",
            label: "打开文件树",
            description: "从 Project Workspace 选择文件。",
            iconClass: "i-lucide-folder-tree",
            action: () => emit("open-files"),
        },
    ];
});

const projectEntries = computed<WelcomeAction[]>(() => {
    if (props.workspaceMode === "user-assets") {
        return [
            {
                id: "assets-root",
                label: "用户资产",
                description: "skills、profiles、templates。",
                iconClass: "i-lucide-folder-cog",
                action: () => emit("open-files"),
            },
            {
                id: "assets-profile",
                label: "Profile",
                description: "打开 TSX Profile 工作台。",
                iconClass: "i-lucide-file-code-2",
                action: () => emit("open-profile-workbench"),
            },
        ];
    }

    return [
        {
            id: "manuscript",
            label: "manuscript",
            description: "章节正文和草稿。",
            iconClass: "i-lucide-book-open-text",
            action: () => emit("open-path", "manuscript/"),
        },
        {
            id: "lorebook-root",
            label: "lorebook",
            description: "世界观、角色、地点和规则。",
            iconClass: "i-lucide-library-big",
            action: () => emit("open-path", "lorebook/"),
        },
        {
            id: "manual",
            label: "manual",
            description: "项目手册和玩法说明。",
            iconClass: "i-lucide-book-marked",
            action: () => emit("open-path", "manual/README.md"),
        },
        {
            id: "simulation",
            label: "simulation",
            description: "世界运行态和 RP 记录。",
            iconClass: "i-lucide-orbit",
            action: () => emit("open-path", "simulation/"),
        },
        {
            id: "reference",
            label: "reference",
            description: "外部素材和导入归档。",
            iconClass: "i-lucide-archive",
            action: () => emit("open-path", "reference/"),
        },
        {
            id: "upload",
            label: "upload",
            description: "待整理的上传材料。",
            iconClass: "i-lucide-upload",
            action: () => emit("open-path", "upload/"),
        },
    ];
});

const headerActions = computed<WelcomeAction[]>(() => {
    if (props.workspaceMode === "user-assets") {
        return [
            {
                id: "profile",
                label: "Profile",
                description: "编辑用户级 profile。",
                iconClass: "i-lucide-file-code-2",
                action: () => emit("open-profile-workbench"),
            },
            {
                id: "agent",
                label: props.agentModeActive ? "Studio" : "Agent",
                description: props.agentModeActive ? "收起或展开右侧 Studio。" : "打开右侧 Agent 面板。",
                iconClass: props.agentModeActive ? "i-lucide-panel-right" : "i-lucide-bot",
                action: () => emit("toggle-agent-surface"),
            },
        ];
    }

    return [
        {
            id: "bookshelf",
            label: "书架",
            description: "管理和切换 Project。",
            iconClass: "i-lucide-library",
            action: () => emit("open-bookshelf"),
        },
        {
            id: "plot",
            label: "剧本工作台",
            description: "整理 Story / Thread / Scene / Plot。",
            iconClass: "i-lucide-panels-top-left",
            action: () => emit("open-plot-workbench"),
        },
        {
            id: "rag",
            label: "RAG",
            description: "查看项目记忆与检索。",
            iconClass: "i-lucide-brain-circuit",
            action: () => emit("open-rag-inspector"),
        },
        {
            id: "assets",
            label: "用户资产",
            description: "管理 skills、profiles、templates。",
            iconClass: "i-lucide-folder-cog",
            action: () => emit("open-user-assets"),
        },
        {
            id: "agent",
            label: props.agentModeActive ? "Studio" : "Agent",
            description: props.agentModeActive ? "收起或展开右侧 Studio。" : "打开右侧 Agent 面板。",
            iconClass: props.agentModeActive ? "i-lucide-panel-right" : "i-lucide-bot",
            action: () => emit("toggle-agent-surface"),
        },
    ];
});

/**
 * 打开教程 Agent 占位对话框。
 */
function openTutorialDialog(): void {
    tutorialDialogOpen.value = true;
}

/**
 * 根据标签编辑器类型显示对应图标。
 */
function tabIconClass(tab: WorkspaceEditorTab): string {
    if (tab.editorKind === "markdown") {
        return "i-lucide-file-text";
    }
    if (tab.editorKind === "monaco") {
        return "i-lucide-file-code-2";
    }
    return "i-lucide-file-question";
}
</script>

<template>
    <!-- Markdown Studio 新标签页 -->
    <section class="studio-welcome-root min-h-0 flex-1 overflow-y-auto bg-[var(--editor-canvas-bg)] px-6 py-6 custom-scrollbar">
        <div v-if="readonlyNode" class="studio-welcome-container mx-auto flex w-full max-w-[760px] flex-col gap-5">
            <!-- 不可编辑节点提示 -->
            <div class="flex items-start gap-4 border-b border-[var(--border-color)] pb-5">
                <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--accent-text)]">
                    <span class="i-lucide-lock-keyhole h-5 w-5"></span>
                </div>
                <div class="min-w-0 flex-1">
                    <h1 class="text-lg font-semibold text-[var(--text-main)]">此节点不可直接编辑</h1>
                    <p class="mt-1 text-sm leading-6 text-[var(--text-secondary)]">可以在文件树查看元信息，或选择 Markdown、txt、无扩展文本文件继续编辑。</p>
                </div>
            </div>

            <div class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-4 py-3 text-xs text-[var(--text-secondary)]">
                <div class="truncate font-mono text-[var(--text-main)]" :title="props.node?.path">{{ props.node?.path }}</div>
                <div class="mt-2 flex flex-wrap gap-2">
                    <span class="rounded-md border border-[var(--border-color)] px-2 py-1">editable: false</span>
                    <span class="rounded-md border border-[var(--border-color)] px-2 py-1">type: {{ props.node?.entryType || "-" }}</span>
                    <span class="rounded-md border border-[var(--border-color)] px-2 py-1">{{ props.node?.isDirectory ? "directory" : "file" }}</span>
                </div>
            </div>

            <div class="studio-starts-grid">
                <button type="button" class="flex min-h-14 items-center gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-4 py-3 text-left transition-colors hover:border-[var(--border-color-hover)] hover:bg-[var(--bg-hover)]" @click="emit('open-files')">
                    <span class="i-lucide-folder-tree h-5 w-5 shrink-0 text-[var(--accent-text)]"></span>
                    <span class="min-w-0">
                        <span class="block text-sm font-medium text-[var(--text-main)]">打开文件树</span>
                        <span class="block truncate text-xs text-[var(--text-secondary)]">定位这个节点或选择可编辑文件</span>
                    </span>
                </button>
                <button type="button" class="flex min-h-14 items-center gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-4 py-3 text-left transition-colors hover:border-[var(--border-color-hover)] hover:bg-[var(--bg-hover)]" @click="openTutorialDialog">
                    <span class="i-lucide-message-circle-question h-5 w-5 shrink-0 text-[var(--accent-text)]"></span>
                    <span class="min-w-0">
                        <span class="block text-sm font-medium text-[var(--text-main)]">询问教程 Agent</span>
                        <span class="block truncate text-xs text-[var(--text-secondary)]">了解这个节点该如何使用</span>
                    </span>
                </button>
            </div>
        </div>

        <div v-else class="studio-welcome-container mx-auto flex w-full flex-col" :class="{ 'is-compact': props.compact }">
            <!-- 新标签页头部 -->
            <div class="studio-header">
                <div class="min-w-0">
                    <div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-text)]">
                        <span class="i-lucide-sparkles h-3.5 w-3.5"></span>
                        <span>Markdown Studio</span>
                    </div>
                    <h1 class="mt-2 text-2xl font-semibold text-[var(--text-main)]">开始写作，或让 Agent 先整理方向</h1>
                    <p class="mt-2 max-w-[680px] text-sm leading-6 text-[var(--text-secondary)]">选择正文、世界书和项目素材；复杂规划交给 Agent 模式，当前 Studio 仍负责查看和编辑文件。</p>
                </div>
                <div class="flex flex-wrap gap-2 shrink-0">
                    <button type="button" class="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--accent-main)] bg-[var(--accent-bg)] px-3 text-sm font-medium text-[var(--accent-text)] transition-colors hover:bg-[var(--bg-hover)]" @click="emit('switch-agent-mode')">
                        <span class="i-lucide-bot h-4 w-4"></span>
                        <span>{{ props.agentModeActive ? "Agent 模式已打开" : "切到 Agent 模式" }}</span>
                    </button>
                    <button type="button" class="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-sm font-medium text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)]" @click="openTutorialDialog">
                        <span class="i-lucide-message-circle-question h-4 w-4 text-[var(--accent-text)]"></span>
                        <span>询问教程 Agent</span>
                    </button>
                </div>
            </div>

            <div class="studio-main-grid">
                <div class="studio-left-column">
                    <!-- 快速开始入口 -->
                    <section class="flex flex-col gap-3">
                        <div class="flex items-center justify-between gap-3">
                            <h2 class="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">开始</h2>
                        </div>
                        <div class="studio-starts-grid">
                            <button v-for="action in startActions" :key="action.id" type="button" class="group flex min-h-20 items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors" :class="action.primary ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] hover:bg-[var(--bg-hover)]' : 'border-[var(--border-color)] bg-[var(--bg-panel)] hover:border-[var(--border-color-hover)] hover:bg-[var(--bg-hover)]'" @click="action.action">
                                <span :class="action.iconClass" class="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent-text)]"></span>
                                <span class="min-w-0">
                                    <span class="block text-sm font-medium text-[var(--text-main)]">{{ action.label }}</span>
                                    <span class="mt-1 block text-xs leading-5 text-[var(--text-secondary)]">{{ action.description }}</span>
                                </span>
                            </button>
                        </div>
                    </section>

                    <!-- Agent 模式引导 -->
                    <section class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] p-4">
                        <div class="studio-agent-layout">
                            <div class="min-w-0 flex-1">
                                <div class="flex items-center gap-2 text-sm font-semibold text-[var(--text-main)]">
                                    <span class="i-lucide-bot h-4 w-4 text-[var(--accent-text)]"></span>
                                    <span>和 Agent 一起推进项目</span>
                                </div>
                                <div class="studio-agent-modes-grid">
                                    <div class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2">
                                        <div class="text-xs font-semibold text-[var(--text-main)]">IDE 模式</div>
                                        <div class="mt-1 text-xs leading-5 text-[var(--text-secondary)]">边写边问，Agent 在右侧辅助。</div>
                                    </div>
                                    <div class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2">
                                        <div class="text-xs font-semibold text-[var(--text-main)]">Agent 模式</div>
                                        <div class="mt-1 text-xs leading-5 text-[var(--text-secondary)]">规划、整理和长任务放到中间主工作区。</div>
                                    </div>
                                    <div class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2">
                                        <div class="text-xs font-semibold text-[var(--text-main)]">Studio</div>
                                        <div class="mt-1 text-xs leading-5 text-[var(--text-secondary)]">Agent 模式右侧仍能查看当前文件。</div>
                                    </div>
                                </div>
                            </div>
                            <div class="studio-agent-actions">
                                <button type="button" class="inline-flex h-8 items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-xs font-medium text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)]" @click="emit('open-agent-panel')">
                                    <span class="i-lucide-panel-right-open h-3.5 w-3.5 text-[var(--accent-text)]"></span>
                                    <span>打开 Agent</span>
                                </button>
                                <button type="button" class="inline-flex h-8 items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-xs font-medium text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)]" @click="emit('switch-agent-mode')">
                                    <span class="i-lucide-panels-top-left h-3.5 w-3.5 text-[var(--accent-text)]"></span>
                                    <span>Agent 模式</span>
                                </button>
                            </div>
                        </div>
                    </section>

                    <!-- 项目入口 -->
                    <section class="flex flex-col gap-3">
                        <h2 class="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">项目入口</h2>
                        <div class="studio-projects-grid">
                            <button v-for="entry in projectEntries" :key="entry.id" type="button" class="flex min-h-16 items-start gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-3 text-left transition-colors hover:border-[var(--border-color-hover)] hover:bg-[var(--bg-hover)]" @click="entry.action">
                                <span :class="entry.iconClass" class="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-text)]"></span>
                                <span class="min-w-0">
                                    <span class="block truncate text-sm font-medium text-[var(--text-main)]">{{ entry.label }}</span>
                                    <span class="mt-0.5 block text-xs leading-5 text-[var(--text-secondary)]">{{ entry.description }}</span>
                                </span>
                            </button>
                        </div>
                    </section>
                </div>

                <aside class="studio-right-column">
                    <!-- 继续编辑 -->
                    <section class="flex flex-col gap-3">
                        <h2 class="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">继续</h2>
                        <div v-if="visibleTabs.length > 0" class="flex flex-col gap-2">
                            <button v-for="tab in visibleTabs" :key="tab.path" type="button" class="flex min-h-11 items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 text-left transition-colors hover:border-[var(--border-color-hover)] hover:bg-[var(--bg-hover)]" :title="tab.path" @click="emit('select-tab', tab.path)">
                                <span :class="tabIconClass(tab)" class="h-4 w-4 shrink-0 text-[var(--accent-text)]"></span>
                                <span class="min-w-0 flex-1">
                                    <span class="block truncate text-sm font-medium text-[var(--text-main)]" :class="tab.preview ? 'italic' : ''">{{ tab.title }}</span>
                                    <span class="block truncate text-xs text-[var(--text-secondary)]">{{ tab.path }}</span>
                                </span>
                                <span v-if="tab.dirty" class="h-2 w-2 shrink-0 rounded-full bg-amber-500"></span>
                            </button>
                        </div>
                        <button v-else type="button" class="flex min-h-11 items-center gap-2 rounded-lg border border-dashed border-[var(--border-color)] bg-transparent px-3 text-left text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]" @click="emit('open-files')">
                            <span class="i-lucide-folder-open h-4 w-4 shrink-0 text-[var(--accent-text)]"></span>
                            <span>还没有打开的文件，从文件树选择一个入口。</span>
                        </button>
                    </section>

                    <!-- 顶部入口地图 -->
                    <section class="flex flex-col gap-3">
                        <h2 class="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">顶部入口</h2>
                        <div class="flex flex-col gap-2">
                            <button v-for="action in headerActions" :key="action.id" type="button" class="flex min-h-12 items-center gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 text-left transition-colors hover:border-[var(--border-color-hover)] hover:bg-[var(--bg-hover)]" @click="action.action">
                                <span :class="action.iconClass" class="h-4 w-4 shrink-0 text-[var(--accent-text)]"></span>
                                <span class="min-w-0 flex-1">
                                    <span class="block text-sm font-medium text-[var(--text-main)]">{{ action.label }}</span>
                                    <span class="block text-xs leading-5 text-[var(--text-secondary)]">{{ action.description }}</span>
                                </span>
                            </button>
                        </div>
                    </section>
                </aside>
            </div>
        </div>

        <MarkdownStudioTutorialAgentDialog v-model="tutorialDialogOpen" />
    </section>
</template>

<style scoped>
.studio-welcome-root {
    container-type: inline-size;
}

.studio-welcome-container {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
}

.studio-welcome-container.is-compact {
    max-width: 760px;
}
.studio-welcome-container:not(.is-compact) {
    max-width: 1120px;
}

/* Header */
.studio-header {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    border-bottom: 1px solid var(--border-color);
    padding-bottom: 1.25rem;
}

/* Main Layout Grid */
.studio-main-grid {
    display: grid;
    gap: 1.5rem;
    grid-template-columns: 1fr;
}

.studio-left-column {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    min-width: 0;
}

.studio-right-column {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    min-width: 0;
}

/* Sub-grids default (1 column) */
.studio-starts-grid {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: 1fr;
}

.studio-agent-layout {
    display: flex;
    flex-direction: column;
    gap: 1rem;
}

.studio-agent-modes-grid {
    margin-top: 0.75rem;
    display: grid;
    gap: 0.75rem;
    grid-template-columns: 1fr;
}

.studio-agent-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    flex-shrink: 0;
}

.studio-projects-grid {
    display: grid;
    gap: 0.5rem;
    grid-template-columns: 1fr;
}

/* Container Queries */

/* Medium Container Breakpoint: >= 560px */
@container (min-width: 560px) {
    .studio-header {
        flex-direction: row;
        align-items: flex-end;
        justify-content: space-between;
    }

    .studio-starts-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .studio-projects-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    
    .studio-agent-modes-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
    }
}

/* Large Container Breakpoint: >= 800px */
@container (min-width: 800px) {
    /* Main layout only becomes 2-column if not compact */
    .studio-welcome-container:not(.is-compact) .studio-main-grid {
        grid-template-columns: minmax(0, 1fr) 340px;
    }

    .studio-agent-layout {
        flex-direction: row;
        align-items: flex-start;
        justify-content: space-between;
    }

    .studio-agent-actions {
        max-width: 180px;
        flex-direction: column;
    }

    .studio-projects-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
    }
}
</style>
