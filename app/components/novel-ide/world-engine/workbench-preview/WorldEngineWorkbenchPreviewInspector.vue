<script setup lang="ts">
import {computed, reactive, ref, watch} from "vue";
import JsonViewer from "nbook/app/components/common/JsonViewer.vue";
import FormField from "nbook/app/components/common/form/FormField.vue";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect, {type SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import FormTextarea from "nbook/app/components/common/form/FormTextarea.vue";
import {useResizablePanel} from "nbook/app/composables/useResizablePanel";
import type {
    SubjectStateDto,
    WorldIssueDto,
} from "nbook/app/components/novel-ide/world-engine/world-engine-workbench.types";
import type {
    WorldWorkbenchPreviewMetadataDraftSummary,
    WorldWorkbenchPreviewSchema,
    WorldWorkbenchPreviewSlice,
    WorldWorkbenchPreviewSlicePatch,
    WorldWorkbenchPreviewSubject,
    WorldWorkbenchPreviewSubjectSystemSummary,
} from "nbook/app/components/novel-ide/world-engine/workbench-preview/world-engine-workbench-preview.types";

type MetadataDraftDiffRow = {
    draftValue: string;
    field: keyof WorldWorkbenchPreviewSlicePatch;
    label: string;
    originalValue: string;
};

const props = withDefaults(defineProps<{
    applyButtonLabel?: string;
    busy?: boolean;
    discardDraftSliceId?: string;
    discardDraftVersion?: number;
    focusedSubjectId: string;
    fullSnapshotError?: string;
    fullSnapshotIssues?: WorldIssueDto[] | null;
    fullSnapshotLoading?: boolean;
    fullSnapshotMode?: "local" | "remote";
    fullSnapshotSubjects?: SubjectStateDto[] | null;
    metadataStatusSuffix?: string;
    resetKey: number;
    schema: WorldWorkbenchPreviewSchema;
    slice: WorldWorkbenchPreviewSlice;
    subjectSystemSummaries?: WorldWorkbenchPreviewSubjectSystemSummary[];
    subjects: WorldWorkbenchPreviewSubject[];
    snapshotIssues?: WorldIssueDto[];
    snapshotSubjects: SubjectStateDto[];
    width: number;
}>(), {
    applyButtonLabel: "应用到预览",
    busy: false,
    discardDraftSliceId: "",
    discardDraftVersion: 0,
    fullSnapshotError: "",
    fullSnapshotIssues: null,
    fullSnapshotLoading: false,
    fullSnapshotMode: "local",
    fullSnapshotSubjects: null,
    metadataStatusSuffix: "mock 本地预览",
    snapshotIssues: () => [],
    subjectSystemSummaries: () => [],
});

const emit = defineEmits<{
    (e: "close"): void;
    (e: "focusSubject", subjectId: string): void;
    (e: "requestFullSnapshot"): void;
    (e: "updateMetadataDrafts", drafts: WorldWorkbenchPreviewMetadataDraftSummary[]): void;
    (e: "update:width", value: number): void;
    (e: "applyPatch", patch: WorldWorkbenchPreviewSlicePatch): void;
}>();

const showFullState = ref(false);
const resizeHandleRef = ref<HTMLElement | null>(null);
const {t} = useI18n();
const draft = reactive<WorldWorkbenchPreviewSlicePatch>({
    time: props.slice.time,
    title: props.slice.title,
    summary: props.slice.summary,
    kind: props.slice.kind,
});
const metadataDrafts = reactive<Record<string, WorldWorkbenchPreviewSlicePatch>>({});

const standardKindOptions: SelectOption[] = [
    {value: "init", label: "init"},
    {value: "event", label: "event"},
    {value: "backstory", label: "backstory"},
];

const subjectMap = computed(() => new Map(props.subjects.map((subject) => [subject.id, subject])));
const subjectSystemSummaryMap = computed(() => new Map(props.subjectSystemSummaries.map((summary) => [summary.subjectId, summary])));
const touchedSubjectIds = computed(() => Array.from(new Set(props.slice.mutations.map((mutation) => mutation.subjectId))));
const touchedSubjectSystemSummaries = computed(() => touchedSubjectIds.value
    .map((subjectId) => subjectSystemSummaryMap.value.get(subjectId))
    .filter((summary): summary is WorldWorkbenchPreviewSubjectSystemSummary => Boolean(summary)));
const fullSnapshotSource = computed(() => props.fullSnapshotMode === "remote" ? (props.fullSnapshotSubjects ?? []) : props.snapshotSubjects);
const visibleSnapshotIssues = computed(() => showFullState.value && props.fullSnapshotMode === "remote" ? (props.fullSnapshotIssues ?? []) : props.snapshotIssues);
const visibleSnapshotSubjects = computed(() => {
    if (showFullState.value) {
        return fullSnapshotSource.value;
    }
    const touched = new Set(touchedSubjectIds.value);
    return props.snapshotSubjects.filter((state) => touched.has(state.subjectId));
});
const rawSnapshotValue = computed(() => ({
    at: props.slice.time,
    scope: showFullState.value ? "world" : "touched-subjects",
    issues: visibleSnapshotIssues.value,
    subjects: visibleSnapshotSubjects.value,
}));
const kindOptions = computed<SelectOption[]>(() => {
    const options = [...standardKindOptions];
    const values = new Set(options.map((option) => option.value));
    for (const kind of [props.slice.kind, draft.kind]) {
        if (kind && !values.has(kind)) {
            options.push({value: kind, label: kind});
            values.add(kind);
        }
    }
    return options;
});
const metadataDraftDirty = computed(() => draft.time !== props.slice.time
    || draft.title !== props.slice.title
    || draft.summary !== props.slice.summary
    || draft.kind !== props.slice.kind);
const metadataDraftStatusLabel = computed(() => metadataDraftDirty.value ? "未应用修改" : "已同步");
const metadataStatusText = computed(() => `${metadataDraftStatusLabel.value} · ${props.metadataStatusSuffix}`);
const metadataDraftDiffRows = computed<MetadataDraftDiffRow[]>(() => {
    const rows: MetadataDraftDiffRow[] = [
        {field: "time", label: "time", originalValue: props.slice.time, draftValue: draft.time},
        {field: "kind", label: "kind", originalValue: props.slice.kind, draftValue: draft.kind},
        {field: "title", label: "title", originalValue: props.slice.title, draftValue: draft.title},
        {field: "summary", label: "summary", originalValue: props.slice.summary, draftValue: draft.summary},
    ];
    return rows.filter((row) => row.originalValue !== row.draftValue);
});
const metadataDraftSummaries = computed<WorldWorkbenchPreviewMetadataDraftSummary[]>(() => {
    const summaries = new Map<string, WorldWorkbenchPreviewMetadataDraftSummary>();
    for (const [sliceId, savedDraft] of Object.entries(metadataDrafts)) {
        summaries.set(sliceId, {
            draftKind: savedDraft.kind,
            draftSummary: savedDraft.summary,
            draftTime: savedDraft.time,
            draftTitle: savedDraft.title || sliceId,
            sliceId,
            sliceTitle: savedDraft.title || sliceId,
        });
    }
    if (metadataDraftDirty.value) {
        summaries.set(props.slice.id, {
            draftKind: draft.kind,
            draftSummary: draft.summary,
            draftTime: draft.time,
            draftTitle: draft.title || props.slice.title || props.slice.id,
            sliceId: props.slice.id,
            sliceTitle: draft.title || props.slice.title || props.slice.id,
        });
    }
    return [...summaries.values()];
});

/** 同步外部选中 slice 到 Inspector 草稿。 */
function syncDraft(): void {
    const savedDraft = metadataDrafts[props.slice.id];
    if (savedDraft && metadataPatchMatchesSlice(savedDraft, props.slice)) {
        delete metadataDrafts[props.slice.id];
        draft.time = props.slice.time;
        draft.title = props.slice.title;
        draft.summary = props.slice.summary;
        draft.kind = props.slice.kind;
        return;
    }
    draft.time = savedDraft?.time ?? props.slice.time;
    draft.title = savedDraft?.title ?? props.slice.title;
    draft.summary = savedDraft?.summary ?? props.slice.summary;
    draft.kind = savedDraft?.kind ?? props.slice.kind;
}

/** 判断已缓存草稿是否已经被外部 slice 成功应用。 */
function metadataPatchMatchesSlice(patch: WorldWorkbenchPreviewSlicePatch, slice: WorldWorkbenchPreviewSlice): boolean {
    return patch.time === slice.time && patch.title === slice.title && patch.summary === slice.summary && patch.kind === slice.kind;
}

/** 将当前表单草稿保存到指定 slice，避免切换 slice 时丢失未应用 metadata。 */
function persistMetadataDraft(sliceId: string, baseline: WorldWorkbenchPreviewSlicePatch): void {
    const dirty = draft.time !== baseline.time || draft.title !== baseline.title || draft.summary !== baseline.summary || draft.kind !== baseline.kind;
    if (!dirty) {
        delete metadataDrafts[sliceId];
        return;
    }
    metadataDrafts[sliceId] = {
        kind: draft.kind,
        summary: draft.summary,
        time: draft.time,
        title: draft.title,
    };
}

/** 提交 metadata 草稿；外部 slice 成功同步到新值后再自动清理草稿。 */
function applyPatch(): void {
    if (props.busy || !metadataDraftDirty.value) {
        return;
    }
    emit("applyPatch", {...draft});
}

/** 放弃 metadata 本地草稿，回到当前 slice 元信息。 */
function resetDraft(): void {
    if (props.busy) {
        return;
    }
    delete metadataDrafts[props.slice.id];
    syncDraft();
}

/** 重置 mock 世界时清空所有 metadata 草稿缓存。 */
function resetMetadataDrafts(): void {
    for (const sliceId of Object.keys(metadataDrafts)) {
        delete metadataDrafts[sliceId];
    }
    syncDraft();
}

/** 清理某个 slice 的内部 metadata 草稿；删除 slice 时由真实 Dialog 精确触发。 */
function discardMetadataDraftForSlice(sliceId: string): void {
    delete metadataDrafts[sliceId];
    if (props.slice.id === sliceId) {
        syncDraft();
    }
}

/** 切换完整世界状态；真实页面在首次展开时按需请求后端。 */
function toggleFullState(): void {
    const nextValue = !showFullState.value;
    showFullState.value = nextValue;
    if (nextValue && props.fullSnapshotMode === "remote" && !props.fullSnapshotSubjects?.length && !props.fullSnapshotLoading) {
        emit("requestFullSnapshot");
    }
}

function subjectSystemSyncLabel(summary: WorldWorkbenchPreviewSubjectSystemSummary): string {
    if (summary.syncStatus === "linked") {
        return "已连接";
    }
    if (summary.syncStatus === "pending-world-subject") {
        return "待接入";
    }
    return "孤儿";
}

function sourceStatusLabel(summary: WorldWorkbenchPreviewSubjectSystemSummary): string {
    const labels = summary.sourceStatuses.map((status) => `${status.source}:${status.status}`);
    return labels.length ? labels.join(" / ") : "-";
}

watch(() => [props.slice.id, props.slice.time, props.slice.title, props.slice.summary, props.slice.kind] as const, (_next, previous) => {
    const previousSliceId = previous?.[0];
    if (previousSliceId && previousSliceId !== props.slice.id) {
        persistMetadataDraft(previousSliceId, {
            time: previous[1],
            title: previous[2],
            summary: previous[3],
            kind: previous[4],
        });
    }
    syncDraft();
});
watch(metadataDraftSummaries, (drafts) => {
    emit("updateMetadataDrafts", drafts);
}, {immediate: true});
watch(() => props.resetKey, resetMetadataDrafts);
watch(() => [props.discardDraftSliceId, props.discardDraftVersion] as const, ([sliceId]) => {
    if (sliceId) {
        discardMetadataDraftForSlice(sliceId);
    }
});
watch(() => [props.slice.id, showFullState.value, props.fullSnapshotMode, props.fullSnapshotSubjects?.length ?? 0] as const, () => {
    if (showFullState.value && props.fullSnapshotMode === "remote" && !props.fullSnapshotSubjects?.length && !props.fullSnapshotLoading) {
        emit("requestFullSnapshot");
    }
});
const {isResizing, panelStyle} = useResizablePanel(resizeHandleRef, {
    size: computed(() => props.width),
    minSize: 300,
    maxSize: 560,
    edge: "left",
    enabled: true,
    syncDuringResize: true,
    onResize: (width) => emit("update:width", width),
    onResizeEnd: (width) => emit("update:width", width),
});
</script>

<template>
    <!-- World Engine 右侧 Inspector：元信息就地编辑 + State Snapshot -->
    <aside
        class="relative flex min-h-0 shrink-0 flex-col border-l border-[var(--we-border)] bg-[var(--we-bg-panel)] transition-[width] duration-200"
        :class="isResizing ? 'select-none transition-none' : ''"
        :style="panelStyle"
    >
        <!-- Inspector 宽度拖拽手柄 -->
        <div ref="resizeHandleRef" class="group absolute -left-1 top-0 z-20 h-full w-2 cursor-col-resize">
            <div class="ml-[3px] h-full w-[2px] bg-[var(--we-accent)] opacity-0 transition-opacity group-hover:opacity-100" :class="isResizing ? 'opacity-100' : ''"></div>
        </div>
        <div class="flex items-center justify-between gap-3 border-b border-[var(--we-border)] px-3 py-3">
            <div class="min-w-0">
                <div class="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--we-text-muted)]">{{ t("worldEngine.workbenchPreview.sliceContext") }}</div>
                <div class="mt-0.5 truncate text-[13px] font-semibold text-[var(--we-text-main)]">{{ props.slice.title || props.slice.id }}</div>
            </div>
            <button type="button" class="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--we-text-muted)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)]" title="关闭检查器" @click="emit('close')">
                <span class="i-lucide-panel-right-close h-3.5 w-3.5"></span>
            </button>
        </div>

        <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3 custom-scrollbar">
            <section class="rounded-md border border-[var(--we-border)] bg-[var(--we-bg-subtle)] p-3">
                <div class="mb-3 flex items-center justify-between gap-2">
                    <div class="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--we-text-muted)]">{{ t("worldEngine.workbenchPreview.metadata") }}</div>
                    <span class="rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)] px-2 py-1 text-[11px] text-[var(--we-text-secondary)]">{{ draft.kind }}</span>
                </div>
                <div class="grid grid-cols-[minmax(0,1fr)_112px] gap-2">
                    <FormField label="time">
                        <FormInput v-model="draft.time" :disabled="props.busy" />
                    </FormField>
                    <FormField label="kind">
                        <FormSelect v-model="draft.kind" :options="kindOptions" :disabled="props.busy" />
                    </FormField>
                </div>
                <FormField label="title">
                    <FormInput v-model="draft.title" :disabled="props.busy" />
                </FormField>
                <FormField label="summary">
                    <FormTextarea v-model="draft.summary" :rows="4" :disabled="props.busy" />
                </FormField>
                <div v-if="metadataDraftDiffRows.length" data-testid="metadata-draft-diff" class="mt-3 overflow-hidden rounded-md border border-amber-300 bg-[var(--we-warning-soft)]">
                    <div class="flex items-center justify-between gap-2 border-b border-amber-300 px-2.5 py-1.5">
                        <div class="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-[var(--we-warning)]">
                            <span class="i-lucide-git-compare-arrows h-3.5 w-3.5 shrink-0"></span>
                            <span>{{ t("worldEngine.workbenchPreview.metadataDraftDiff") }}</span>
                        </div>
                        <span class="rounded bg-[var(--we-bg-panel)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--we-warning)]">{{ t("worldEngine.workbenchPreview.fieldCount", {count: metadataDraftDiffRows.length}) }}</span>
                    </div>
                    <div class="grid grid-cols-[72px_minmax(0,1fr)_minmax(0,1fr)] border-b border-amber-200 bg-[var(--we-bg-panel)] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--we-text-muted)]">
                        <span>field</span>
                        <span>{{ t("worldEngine.workbenchPreview.applied") }}</span>
                        <span>{{ t("worldEngine.workbenchPreview.draft") }}</span>
                    </div>
                    <div class="divide-y divide-amber-200">
                        <div v-for="row in metadataDraftDiffRows" :key="`metadata-diff:${row.field}`" class="grid grid-cols-[72px_minmax(0,1fr)_minmax(0,1fr)] gap-2 px-2.5 py-1.5 text-[11px]">
                            <span class="font-mono text-[var(--we-warning)]">{{ row.label }}</span>
                            <span class="min-w-0 truncate font-mono text-[var(--we-text-muted)]" :title="row.originalValue">{{ row.originalValue || "-" }}</span>
                            <span class="min-w-0 truncate font-mono font-semibold text-[var(--we-text-main)]" :title="row.draftValue">{{ row.draftValue || "-" }}</span>
                        </div>
                    </div>
                </div>
                <div class="mt-3 flex items-center justify-between gap-2">
                    <span class="inline-flex min-w-0 items-center gap-1.5 text-[11px]" :class="metadataDraftDirty ? 'text-[var(--we-warning)]' : 'text-[var(--we-text-muted)]'">
                        <span :class="metadataDraftDirty ? 'i-lucide-pencil-line' : 'i-lucide-check'" class="h-3.5 w-3.5 shrink-0"></span>
                        <span class="truncate">{{ metadataStatusText }}</span>
                    </span>
                    <div class="flex shrink-0 items-center gap-1.5">
                        <button v-if="metadataDraftDirty" type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)] px-2.5 text-[12px] text-[var(--we-text-secondary)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)] disabled:cursor-not-allowed disabled:opacity-50" :disabled="props.busy" @click="resetDraft">
                            <span class="i-lucide-undo-2 h-3.5 w-3.5"></span>
                            还原
                        </button>
                        <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50" :class="metadataDraftDirty && !props.busy ? 'border-[var(--we-accent-border)] bg-[var(--we-accent)] text-white hover:bg-[var(--we-accent-strong)]' : 'border-[var(--we-border)] bg-[var(--we-bg-muted)] text-[var(--we-text-muted)]'" :disabled="props.busy || !metadataDraftDirty" @click="applyPatch">
                            <span :class="props.busy ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-check'" class="h-3.5 w-3.5"></span>
                            {{ props.applyButtonLabel }}
                        </button>
                    </div>
                </div>
            </section>

            <section class="order-4 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-muted)] p-3">
                <div class="mb-2 flex items-center justify-between gap-2">
                    <div class="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--we-text-muted)]">{{ t("worldEngine.workbenchPreview.touchedSubjects") }}</div>
                    <span class="text-[10px] text-[var(--we-text-muted)]">{{ touchedSubjectIds.length }}</span>
                </div>
                <div class="flex flex-wrap gap-1.5">
                    <button
                        v-for="subjectId in touchedSubjectIds"
                        :key="`inspector-subject:${subjectId}`"
                        type="button"
                        class="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors"
                        :class="props.focusedSubjectId === subjectId ? 'border-[var(--we-accent-border)] bg-[var(--we-accent-soft)] text-[var(--we-accent-strong)]' : 'border-[var(--we-border)] bg-[var(--we-bg-panel)] text-[var(--we-text-secondary)] hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)]'"
                        :title="`在审查工作台中查看 ${subjectMap.get(subjectId)?.name ?? subjectId}`"
                        @click="emit('focusSubject', subjectId)"
                    >
                        {{ subjectMap.get(subjectId)?.name ?? subjectId }}
                    </button>
                </div>
            </section>

            <section v-if="touchedSubjectSystemSummaries.length" data-testid="subject-system-summary" class="order-5 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)] p-3">
                <div class="mb-2 flex items-center justify-between gap-2">
                    <div>
                        <div class="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--we-text-muted)]">Subject System</div>
                        <div class="mt-0.5 text-[11px] text-[var(--we-text-muted)]">来自 simulation/subjects 的真实主体系统摘要</div>
                    </div>
                    <span class="rounded-full border border-[var(--we-accent-border)] bg-[var(--we-accent-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--we-accent-strong)]">path only</span>
                </div>
                <div class="divide-y divide-[var(--we-border)]">
                    <div v-for="summary in touchedSubjectSystemSummaries" :key="`subject-system:${summary.subjectId}`" class="py-2 first:pt-0 last:pb-0">
                        <div class="flex items-center justify-between gap-2">
                            <div class="min-w-0">
                                <div class="truncate text-[12px] font-semibold text-[var(--we-text-main)]">{{ subjectMap.get(summary.subjectId)?.name ?? summary.subjectId }}</div>
                                <div class="mt-0.5 truncate font-mono text-[10px] text-[var(--we-text-muted)]">{{ summary.sourcePath || summary.subjectId }}</div>
                            </div>
                            <div class="flex shrink-0 items-center gap-1">
                                <span class="rounded border px-1.5 py-0.5 text-[10px] font-medium" :class="summary.syncStatus === 'linked' ? 'border-[var(--we-accent-border)] bg-[var(--we-accent-soft)] text-[var(--we-accent-strong)]' : summary.syncStatus === 'pending-world-subject' ? 'border-amber-300 bg-[var(--we-warning-soft)] text-[var(--we-warning)]' : 'border-[var(--we-border)] bg-[var(--we-bg-muted)] text-[var(--we-text-muted)]'">{{ subjectSystemSyncLabel(summary) }}</span>
                                <span v-if="summary.eventCount !== null" class="rounded border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--we-text-muted)]">{{ summary.eventCount }} events</span>
                                <span v-if="summary.memoryCount !== null" class="rounded border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--we-text-muted)]">{{ summary.memoryCount }} memory</span>
                            </div>
                        </div>
                        <div class="mt-2 grid grid-cols-[82px_minmax(0,1fr)] gap-x-2 gap-y-1 text-[11px]">
                            <span class="text-[var(--we-text-muted)]">actor import</span>
                            <span class="min-w-0 truncate font-mono text-[var(--we-text-secondary)]" :title="summary.actorImportPath">{{ summary.actorImportPath || "-" }}</span>
                            <span class="text-[var(--we-text-muted)]">leader only</span>
                            <span class="min-w-0 truncate font-mono text-[var(--we-text-secondary)]" :title="summary.leaderOnlyPath">{{ summary.leaderOnlyPath || "-" }}</span>
                            <span class="text-[var(--we-text-muted)]">direct state</span>
                            <span class="min-w-0 truncate font-mono text-[var(--we-text-secondary)]" :title="summary.directStatePath">{{ summary.directStatePath || "-" }}</span>
                            <span class="text-[var(--we-text-muted)]">RAG</span>
                            <span class="min-w-0 truncate font-mono text-[var(--we-text-secondary)]" :title="summary.ragIndexSources.map((source) => `${source.label}: ${source.path}`).join('\n')">{{ summary.ragIndexSources.map((source) => source.label).join(" / ") || "-" }}</span>
                            <span class="text-[var(--we-text-muted)]">index</span>
                            <span class="min-w-0 truncate font-mono text-[var(--we-text-secondary)]" :title="sourceStatusLabel(summary)">{{ sourceStatusLabel(summary) }}</span>
                        </div>
                    </div>
                </div>
            </section>

            <section class="order-6 space-y-2 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)] p-3">
                <div class="flex items-center justify-between gap-2">
                    <div>
                        <div class="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--we-text-muted)]">{{ t("worldEngine.workbenchPreview.stateSnapshot") }}</div>
                        <div class="mt-0.5 text-[11px] text-[var(--we-text-muted)]">{{ showFullState ? "完整世界状态" : "当前切片触及主体" }}</div>
                    </div>
                    <button type="button" class="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-2 text-[11px] text-[var(--we-text-secondary)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)]" :aria-pressed="showFullState" @click="toggleFullState">
                        <span :class="props.fullSnapshotLoading && showFullState ? 'i-lucide-loader-2 animate-spin' : showFullState ? 'i-lucide-minimize-2' : 'i-lucide-expand'" class="h-3.5 w-3.5"></span>
                        {{ showFullState ? "只看触及主体" : "展开完整世界" }}
                    </button>
                </div>

                <div v-if="visibleSnapshotIssues.length" data-testid="snapshot-query-issues" class="space-y-1 rounded-md border border-[var(--we-danger-border)] bg-[var(--we-danger-soft)] px-2.5 py-2">
                    <div class="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--we-danger)]">
                        <span class="i-lucide-circle-alert h-3.5 w-3.5"></span>
                        State issues · {{ visibleSnapshotIssues.length }}
                    </div>
                    <div v-for="(issue, issueIndex) in visibleSnapshotIssues" :key="`snapshot-issue:${issue.sliceId ?? 'query'}:${issueIndex}:${issue.subjectId}:${issue.attr}:${issue.code}`" class="grid grid-cols-[112px_minmax(0,1fr)] gap-2 text-[11px] text-[var(--we-danger)]">
                        <span class="min-w-0 truncate font-mono font-semibold" :title="issue.code">{{ issue.code }}</span>
                        <span class="min-w-0 truncate" :title="issue.message">{{ subjectMap.get(issue.subjectId)?.name ?? issue.subjectId }} · {{ issue.attr }} · {{ issue.message }}</span>
                    </div>
                </div>

                <div class="max-h-[360px] space-y-2 overflow-y-auto pr-1 custom-scrollbar">
                    <div v-if="showFullState && props.fullSnapshotLoading" class="rounded-md border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-3 py-6 text-center text-[12px] text-[var(--we-text-muted)]">正在读取完整世界状态...</div>
                    <div v-else-if="showFullState && props.fullSnapshotError" class="rounded-md border border-[var(--we-danger)] bg-[var(--we-danger-soft)] px-3 py-3 text-[12px] text-[var(--we-danger)]">{{ props.fullSnapshotError }}</div>
                    <details v-for="state in visibleSnapshotSubjects" :key="`snapshot:${state.subjectId}`" class="overflow-hidden rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)]" :open="state.subjectId === props.focusedSubjectId">
                        <summary class="flex cursor-pointer items-center justify-between gap-2 bg-[var(--we-bg-subtle)] px-3 py-2">
                            <span class="min-w-0 truncate text-[12px] font-semibold text-[var(--we-text-main)]">{{ subjectMap.get(state.subjectId)?.name ?? state.subjectId }}</span>
                            <span class="shrink-0 rounded-full bg-[var(--we-bg-muted)] px-1.5 py-0.5 text-[10px] text-[var(--we-text-muted)]">{{ Object.keys(state.attrs).length }} attrs</span>
                        </summary>
                        <div class="border-t border-[var(--we-border)] px-3 py-2">
                            <JsonViewer :value="state.attrs" :main-menu-bar="false" :max-height="0" />
                        </div>
                    </details>
                </div>

                <details class="overflow-hidden rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)]">
                    <summary class="cursor-pointer bg-[var(--we-bg-subtle)] px-3 py-2 text-[12px] font-semibold text-[var(--we-text-secondary)]">{{ t("worldEngine.workbenchPreview.rawStateJson") }}</summary>
                    <div class="border-t border-[var(--we-border)] p-2">
                        <JsonViewer :value="rawSnapshotValue" :max-height="288" />
                    </div>
                </details>
            </section>
        </div>
    </aside>
</template>
