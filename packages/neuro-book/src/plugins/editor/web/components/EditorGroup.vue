<script setup lang="ts">
/** 一个编辑组（同名 .md）：标签条、状态条、进度条与控件。 */
import {Button, Kbd} from "@notnotype/nb-ui/components";
import {computed, onBeforeUnmount, onMounted, ref} from "vue";
import type {Component} from "vue";

import type {DisplayLocale} from "nbook/shared/localized-text";
import NeuroBookMark from "nbook/ui/brand/NeuroBookMark.vue";
import TitleActions from "nbook/ui/menus/TitleActions.vue";
import {buttonBudget} from "nbook/ui/menus/title-actions";
import type {TitleActionsModel} from "nbook/ui/menus/title-actions";

import type {EditorArea, EditorControlHandle} from "../area";
import type {EditorState} from "../editor-registry";
import {BINARY_TAB_EDITOR} from "../editors";
import type {EmptyTip} from "../empty-tips";
import {EDITOR_TITLE_MAX_BUTTONS, EDITOR_TITLE_TAB_RESERVE} from "../title-actions";
import {pageIdOf} from "../pages";
import type {EditorPageSource} from "../pages";
import {editorText, nameOf} from "../messages";
import EditorTabBar from "./EditorTabBar.vue";
import type {TabItem} from "./EditorTabBar.vue";

const props = withDefaults(defineProps<{
    area: EditorArea;
    groupId: string;
    locale: DisplayLocale;
    /** 编辑器此刻的组件：不在、未交付或已交付（docs/specs/workbench/editor.md 输出 40）。 */
    control: (editor: string) => EditorState;
    pages?: EditorPageSource | null;
    /** 组里没有标签时显示的提示（已按可用性筛好）。 */
    emptyTips?: ReadonlyArray<EmptyTip>;
    /** 标签条右侧的标题动作：只有活动组拿到，别的组为 null（docs/specs/workbench/editor.md 输出 34）。 */
    titleActions?: EditorGroupTitleActions | null;
}>(), {pages: null, emptyTips: () => [], titleActions: null});

/** 点了空态里的一条提示：交出它的命令，由宿主执行（组件不执行命令）。点了标题动作：交出它的 key。 */
const emit = defineEmits<{(event: "run-tip", command: string): void; (event: "title-action", key: string): void}>();

/** 标签条一行的宽度：标题动作按它决定放几个按钮，标签条至少留一个截断标签的宽度（输出 34）。 */
const header = ref<HTMLElement | null>(null);
const headerWidth = ref<number | null>(null);
let observer: ResizeObserver | null = null;
onMounted(() => {
    const element = header.value;
    if (element === null || typeof ResizeObserver !== "function") return;
    observer = new ResizeObserver(() => {
        headerWidth.value = element.clientWidth > 0 ? element.clientWidth : null;
    });
    observer.observe(element);
});
onBeforeUnmount(() => observer?.disconnect());

const titleModel = computed((): TitleActionsModel | null => (props.titleActions === null ? null : props.titleActions.model(buttonBudget(headerWidth.value, EDITOR_TITLE_TAB_RESERVE, EDITOR_TITLE_MAX_BUTTONS))));
const hasTitleActions = computed(() => titleModel.value !== null && (titleModel.value.buttons.length > 0 || titleModel.value.menu.length > 0));

const group = computed(() => props.area.groups.groups.value.find((candidate) => candidate.id === props.groupId) ?? null);
const activeTab = computed(() => group.value?.tabs.find((tab) => tab.id === group.value?.active) ?? null);
const document = computed(() => props.area.documentOf(props.groupId));
/** 活动文件标签的文件条目：字节标签也有（删除、订阅结束的提示用它）。 */
const file = computed(() => props.area.fileOf(props.groupId));
const binding = computed(() => props.area.binding(props.groupId));
const active = computed(() => props.area.groups.activeGroup.value === props.groupId);

const tabs = computed((): TabItem[] => (group.value?.tabs ?? []).map((tab) => {
    const opened = props.area.documents.get(tab.address);
    // 页面标签（输出 33）按页面的标题显示；贡献方停了、标题取不到时显示页面 id。
    const page = pageIdOf(tab.address);
    const label = page === null ? nameOf(tab.address) : (props.pages?.title(page, props.locale) ?? page);
    return {id: tab.id, label, title: page === null ? tab.address : label, preview: tab.preview, dirty: opened?.dirty.value === true, active: tab.id === group.value?.active};
}));

type Banner = {readonly tone: "danger" | "warning" | "info"; readonly text: string; readonly actions: ReadonlyArray<{readonly id: string; readonly label: string; readonly run: () => void}>};

const banner = computed((): Banner | null => {
    const current = file.value;
    if (current === null) return null;
    const t = (key: Parameters<typeof editorText>[1], values?: Readonly<Record<string, string>>): string => editorText(props.locale, key, values);
    if (binding.value?.kind === "text" && binding.value.unresolved()) {
        return {tone: "warning", text: t("unresolved"), actions: [
            {id: "adopt", label: t("adopt"), run: () => props.area.resolve(props.groupId, "adopt-current")},
            {id: "keep", label: t("keep"), run: () => props.area.resolve(props.groupId, "keep-view")},
        ]};
    }
    if (current.conflict.value !== null) {
        return {tone: "danger", text: t("conflict"), actions: [
            {id: "reload", label: t("reload"), run: () => void props.area.revert()},
            {id: "overwrite", label: t("overwrite"), run: () => void props.area.overwrite()},
        ]};
    }
    if (current.ended.value !== null) return {tone: "danger", text: t("ended", {reason: current.ended.value}), actions: []};
    if (current.status.value === "deleted") return {tone: "warning", text: current.dirty.value ? t("deleted") : t("deletedClean"), actions: []};
    if (current.diskChanged.value) return {tone: "warning", text: t("diskChanged"), actions: [{id: "reload", label: t("reload"), run: () => void props.area.revert()}]};
    const problem = current.saveProblem.value;
    if (problem !== null) return {tone: "danger", text: problem.code === "unknown-outcome" ? t("saveUnknown") : t("saveFailed", {reason: problem.detail || problem.code}), actions: []};
    return null;
});

/** 读取失败：不是 UTF-8 文本时说明原因、不给重试（输出 37 第 3 步），其余给重试。 */
const failure = computed((): {readonly text: string; readonly retry: boolean} | null => {
    const current = document.value;
    if (current === null || current.status.value !== "failed") return null;
    if (current.failure.value?.code === "not-text") return {text: editorText(props.locale, "notText", {name: nameOf(current.target.value.path)}), retry: false};
    return {text: editorText(props.locale, "openFailed", {name: nameOf(current.target.value.path), reason: current.failure.value?.code ?? ""}), retry: true};
});

const onReady = (editor: string, handle: EditorControlHandle | null): void => props.area.registerHandle(props.groupId, editor, handle);

/**
 * 活动文件标签的编辑器不能渲染的原因：已知二进制（输出 37 第 1 步）、编辑器不在了、还没交付（输出 40）。能渲染为 null。
 */
const unavailable = computed((): "binary" | "gone" | "pending" | null => {
    const tab = activeTab.value;
    if (tab === null || tab.kind === "page") return null;
    if (tab.editor === BINARY_TAB_EDITOR) return "binary";
    const state = props.control(tab.editor).kind;
    return state === "ready" ? null : state;
});

/** 活动标签是页面时的页面 id；文件标签为 null。 */
const pageId = computed(() => (activeTab.value === null ? null : pageIdOf(activeTab.value.address)));
const pageComponent = computed(() => (pageId.value === null ? null : props.pages?.component(pageId.value) ?? null));

// 控件按编辑器各挂一个：换文档只换绑定，不重建控件；同组另一种控件停放（不卸载、不可见）。只挂已交付的编辑器。
const controls = computed((): Array<{readonly editor: string; readonly component: Component}> => {
    const present = new Set<string>();
    for (const tab of group.value?.tabs ?? []) if (tab.kind === "file" && tab.editor !== BINARY_TAB_EDITOR) present.add(tab.editor);
    return [...present].flatMap((editor) => {
        const state = props.control(editor);
        return state.kind === "ready" ? [{editor, component: state.component}] : [];
    });
});

export interface EditorGroupTitleActions {
    /** 拿到标题动作的组（活动组）。 */
    readonly group: string;
    /** 按组给出的按钮个数拼好的标题动作。 */
    readonly model: (maxButtons: number) => TitleActionsModel;
    /** “⋯”的菜单身份：活动组、活动标签与地址。 */
    readonly identity: string;
}
</script>

<template>
    <section
        class="flex h-full min-h-0 w-full min-w-0 flex-col bg-[var(--panel-surface)]"
        :class="active ? '' : 'opacity-[0.98]'"
        :aria-label="editorText(locale, 'areaLabel')"
        :data-editor-group="groupId"
        :data-editor-group-active="active ? '' : undefined"
        @focusin="area.focusGroup(groupId)"
        @pointerdown="area.focusGroup(groupId)"
    >
        <!-- 标签多时标签条自己横向滚动，标题动作固定在右侧、不随之滚动。 -->
        <div ref="header" class="editor-group__header">
            <EditorTabBar
                class="editor-group__tabs"
                :tabs="tabs"
                :label="editorText(locale, 'tabsLabel')"
                :close-label="(name: string) => editorText(locale, 'closeTab', {name})"
                :unsaved-label="editorText(locale, 'unsaved')"
                @activate="(id: string) => area.activate(id)"
                @pin="(id: string) => area.pin(id)"
                @close="(id: string) => void area.close(id)"
                @move="(id: string, delta: -1 | 1) => area.groups.move(id, delta)"
            />
            <TitleActions
                v-if="hasTitleActions"
                class="editor-group__title-actions"
                :model="titleModel!"
                :identity="titleActions!.identity"
                :more-label="editorText(locale, 'moreActions')"
                data-editor-title-actions
                @run="(key: string) => emit('title-action', key)"
            />
        </div>
        <div class="relative h-0.5 shrink-0 overflow-hidden" aria-hidden="true">
            <div v-if="area.progress(groupId)" class="editor-group__progress absolute inset-y-0 w-1/3 bg-[var(--accent-main)]" data-editor-progress></div>
        </div>
        <!-- 进度条本身只是装饰：同一时刻给读屏一句可播报的“正在读取”。 -->
        <p v-if="area.progress(groupId)" class="sr-only" role="status">{{ editorText(locale, "loading") }}</p>
        <div
            v-if="banner !== null"
            class="flex shrink-0 flex-wrap items-center gap-2 border-b border-[color:var(--divider)] px-3 py-1.5 text-xs"
            :class="banner.tone === 'danger' ? 'text-[var(--status-danger)]' : banner.tone === 'warning' ? 'text-[var(--status-warning)]' : 'text-[var(--text-secondary)]'"
            role="status"
            data-editor-banner
        >
            <span class="min-w-0 flex-1">{{ banner.text }}</span>
            <Button v-for="action in banner.actions" :key="action.id" size="sm" variant="secondary" :data-editor-banner-action="action.id" @click="action.run()">{{ action.label }}</Button>
        </div>
        <div class="relative min-h-0 flex-1" :aria-busy="area.progress(groupId) ? 'true' : undefined" data-editor-content>
            <div v-if="activeTab === null" class="editor-group__empty" data-editor-empty>
                <NeuroBookMark class="editor-group__mark" aria-hidden="true" />
                <div v-if="emptyTips.length > 0" class="editor-group__tips">
                    <button v-for="tip in emptyTips" :key="tip.command" type="button" class="editor-group__tip nb-ui-focus-ring" :data-editor-empty-tip="tip.command" @click="emit('run-tip', tip.command)">
                        <span class="editor-group__tip-label">{{ tip.label }}</span>
                        <span v-if="tip.keys !== null" class="editor-group__tip-keys"><Kbd v-for="key in tip.keys" :key="key">{{ key }}</Kbd></span>
                        <span v-else class="editor-group__tip-hint">{{ tip.hint }}</span>
                    </button>
                </div>
            </div>
            <div v-else-if="unavailable === 'binary' || unavailable === 'gone'" class="flex flex-col items-start gap-2 p-6 text-sm" role="alert" :data-editor-unavailable="unavailable">
                <p>{{ editorText(locale, unavailable === "binary" ? "binary" : "editorGone", {name: activeTab === null ? "" : nameOf(activeTab.address)}) }}</p>
                <Button v-if="unavailable === 'gone'" size="sm" variant="secondary" data-editor-reopen-default @click="area.reopenWithDefault()">{{ editorText(locale, "reopenDefault") }}</Button>
            </div>
            <!-- 编辑器还没交付：800 毫秒内空白，之后才说明（与读取的进度条同一规则，输出 6、40）。 -->
            <p v-else-if="unavailable === 'pending'" class="editor-group__pending" role="status" data-editor-pending>{{ editorText(locale, "editorLoading") }}</p>
            <div v-else-if="failure !== null" class="flex flex-col items-start gap-2 p-6 text-sm" role="alert" data-editor-failure>
                <p>{{ failure.text }}</p>
                <Button v-if="failure.retry" size="sm" variant="secondary" @click="document !== null && area.documents.retry(document)">{{ editorText(locale, "retry") }}</Button>
            </div>
            <!-- 页面标签：渲染页面贡献的组件；贡献方停了时说明，不显示别的。 -->
            <div v-if="pageId !== null" class="absolute inset-0 overflow-auto" :data-editor-page="pageId">
                <component :is="pageComponent" v-if="pageComponent !== null" :context="pages!.context" />
                <p v-else class="flex h-full items-center justify-center px-6 text-center text-[13px] text-[var(--text-muted)]" data-editor-page-missing>{{ editorText(locale, "pageMissing") }}</p>
            </div>
            <template v-for="mounted in controls" :key="mounted.editor">
                <div v-show="binding !== null && binding.editor === mounted.editor" class="absolute inset-0" :data-editor-kind="mounted.editor">
                    <component
                        :is="mounted.component"
                        :binding="binding !== null && binding.editor === mounted.editor ? binding : null"
                        :host="area.controlSlot(groupId, mounted.editor)"
                        :readonly="!area.viewWritable(groupId)"
                        :visible="binding !== null && binding.editor === mounted.editor"
                        :label="activeTab === null ? '' : nameOf(activeTab.address)"
                        @ready="(handle: EditorControlHandle | null) => onReady(mounted.editor, handle)"
                        @focus="(focused: boolean) => (area.focused.value = focused)"
                    />
                </div>
            </template>
        </div>
    </section>
</template>

<style scoped>
/* 标签条与标题动作一行：标签条占剩下的宽度、放不下时自己横向滚动，标题动作不收缩（docs/specs/workbench/editor.md 输出 34）。 */
.editor-group__header {
    display: flex;
    flex-shrink: 0;
    align-items: stretch;
    background: var(--panel-surface);
}

.editor-group__tabs {
    min-width: 0;
    flex: 1 1 auto;
}

.editor-group__title-actions {
    align-self: center;
    padding-inline: var(--space-1) var(--space-2);
}

/* 空态（docs/specs/workbench/editor.md 输出 32）：正中一个淡色的图形标志，下面几行提示，说明靠右、按键或位置靠左。 */
.editor-group__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 36px;
    height: 100%;
    padding: 24px;
    overflow: hidden;
}

/* 组被拆得很矮时标志先缩（宽随高），提示不被挤掉。 */
.editor-group__mark {
    flex: 0 1 132px;
    min-height: 32px;
    height: auto;
    color: color-mix(in srgb, var(--text-main) 9%, transparent);
}

.editor-group__tips {
    display: grid;
    grid-template-columns: auto auto;
    column-gap: 14px;
    row-gap: 2px;
    font-size: 13px;
}

/* 每行是一个按钮：跨两列并沿用外层的列（subgrid），两列在各行之间对齐，按钮本身仍可聚焦。 */
.editor-group__tip {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
    align-items: center;
    padding: 4px 8px;
    border-radius: var(--radius-control);
    color: var(--text-secondary);
    text-align: left;
}

.editor-group__tip:hover {
    background: var(--bg-hover);
}

.editor-group__tip-label {
    text-align: right;
}

.editor-group__tip-keys {
    display: flex;
    gap: 3px;
}

.editor-group__tip-hint {
    color: var(--text-muted);
}

.editor-group__pending {
    padding: 24px;
    font-size: 13px;
    color: var(--text-muted);
    opacity: 0;
    animation: editor-group-reveal 1ms linear 800ms forwards;
}

@keyframes editor-group-reveal {
    to {
        opacity: 1;
    }
}

.editor-group__progress {
    animation: editor-group-progress 1.2s var(--ease-standard) infinite;
}

@keyframes editor-group-progress {
    from {
        left: -33%;
    }

    to {
        left: 100%;
    }
}

@media (prefers-reduced-motion: reduce) {
    .editor-group__pending {
    padding: 24px;
    font-size: 13px;
    color: var(--text-muted);
    opacity: 0;
    animation: editor-group-reveal 1ms linear 800ms forwards;
}

@keyframes editor-group-reveal {
    to {
        opacity: 1;
    }
}

.editor-group__progress {
        animation: none;
        left: 0;
        width: 100%;
        opacity: 0.6;
    }
}
</style>
