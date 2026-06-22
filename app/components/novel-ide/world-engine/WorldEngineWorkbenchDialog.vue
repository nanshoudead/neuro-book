<script setup lang="ts">
import {computed, nextTick, ref, shallowRef, watch} from "vue";
import Dialog from "nbook/app/components/common/Dialog.vue";
import WorldEngineMutationEditor from "nbook/app/components/novel-ide/world-engine/WorldEngineMutationEditor.vue";
import WorldEngineSubjectCreator from "nbook/app/components/novel-ide/world-engine/WorldEngineSubjectCreator.vue";
import WorldEngineWorkbenchPreviewInspector from "nbook/app/components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewInspector.vue";
import WorldEngineWorkbenchPreviewMutationEditor from "nbook/app/components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewMutationEditor.vue";
import WorldEngineWorkbenchPreviewSidebar from "nbook/app/components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewSidebar.vue";
import WorldEngineWorkbenchPreviewSliceList from "nbook/app/components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewSliceList.vue";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {isWorldWorkbenchSubjectSystemMaintenanceSlice} from "nbook/app/utils/world-engine-workbench-slice-classifier";
import {
    formatWorldEngineConflictMessage,
    previewDemoMutations,
    previewDemoSubjects,
    suggestNextPreviewTime,
    validatePreviewDemoSchema,
} from "nbook/app/utils/world-engine-preview";
import {
    matchesWorkbenchPreviewKeywordFilter,
    matchesWorkbenchPreviewKindFilter,
    matchesWorkbenchPreviewSubjectFilter,
} from "nbook/app/utils/world-engine-workbench-preview-filter";
import {
    buildWorldWorkbenchEditSliceBody,
    buildWorldWorkbenchReviewQueueItems,
    buildWorldWorkbenchSubjectSystemSummariesFromRagOverview,
    mergeWorldWorkbenchTimelineSlice,
    mergeWorldWorkbenchSubjectsWithSubjectSystem,
    normalizeWorldWorkbenchSlices,
    type WorldWorkbenchTransientIssue,
} from "nbook/app/utils/world-engine-workbench-real";
import type {ProjectRagOverviewDto} from "nbook/shared/dto/project-rag.dto";
import type {
    CreateSubjectResultDto,
    DeleteSliceResultDto,
    SliceWriteResultDto,
    SubjectStateDto,
    WorldIssueDto,
    WorldSchemaProjectionDto,
    WorldSliceDto,
    WorldSliceMutationDto,
    WorldStateDto,
    WorldStateQueryDto,
    WorldSubjectDto,
} from "nbook/app/components/novel-ide/world-engine/world-engine-workbench.types";
import type {
    WorldWorkbenchPreviewIssueStatus,
    WorldWorkbenchPreviewIssueTriagePatch,
    WorldWorkbenchPreviewIssueTriageState,
    WorldWorkbenchPreviewIssueTriageSummary,
    WorldWorkbenchPreviewMetadataDraftSummary,
    WorldWorkbenchPreviewMutationFocus,
    WorldWorkbenchPreviewMutationValuePatch,
    WorldWorkbenchPreviewReviewQueueItem,
    WorldWorkbenchPreviewReviewQueueMode,
    WorldWorkbenchPreviewSlice,
    WorldWorkbenchPreviewSliceHealthFilter,
    WorldWorkbenchPreviewSlicePatch,
    WorldWorkbenchPreviewSliceReviewSummary,
    WorldWorkbenchPreviewSubjectFilterMode,
    WorldWorkbenchPreviewSubjectStat,
    WorldWorkbenchPreviewSubjectSystemSummary,
    WorldWorkbenchPreviewValueDraftSummary,
} from "nbook/app/components/novel-ide/world-engine/workbench-preview/world-engine-workbench-preview.types";

const props = defineProps<{
    modelValue: boolean;
    projectPath: string;
    projectTitle: string;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "hasUnsavedDraftsChange", value: boolean): void;
    (e: "openWorkspacePath", path: string): void;
    (e: "savingChange", value: boolean): void;
}>();

const router = useRouter();
const {t} = useI18n();

const defaultSidebarWidth = 280;
const defaultInspectorWidth = 360;
const defaultMutationEditorHeight = 292;
const sliceLimit = 200;
const queryListLimit = 40;
const pendingSubjectTimelineNoticePrefix = "待接入 subject 暂无 World Engine 时间线";
const emptySchema: WorldSchemaProjectionDto = {
    subjectTypes: [],
    calendar: {
        format: "",
        examples: [],
    },
};
type EmptySliceAction = "create-subject" | "new-slice" | "seed-demo" | "sync-subject-system" | "";
type EmptySliceState = {
    action: EmptySliceAction;
    description: string;
    title: string;
};
type LoadWorldOptions = {
    autoSelectSlice?: boolean;
    preferredSliceId?: string;
    preferredSubjectIds?: string[];
};

const schema = shallowRef<WorldSchemaProjectionDto | null>(null);
const worldSubjects = ref<WorldSubjectDto[]>([]);
const subjects = ref<WorldSubjectDto[]>([]);
const slices = shallowRef<WorldWorkbenchPreviewSlice[]>([]);
const knownSliceTimes = ref<string[]>([]);
const selectedSliceId = ref("");
const selectedSubjectIds = ref<string[]>([]);
const subjectFilterMode = ref<WorldWorkbenchPreviewSubjectFilterMode>("any");
const sliceSearch = ref("");
const sliceKindFilter = ref("all");
const sliceHealthFilter = ref<WorldWorkbenchPreviewSliceHealthFilter>("all");
const focusedSubjectId = ref("");
const highlightedMutationFocus = ref<WorldWorkbenchPreviewMutationFocus | null>(null);
const issueTriageStates = ref<WorldWorkbenchPreviewIssueTriageState[]>([]);
const transientIssues = ref<WorldWorkbenchTransientIssue[]>([]);
const reviewQueueMode = ref<WorldWorkbenchPreviewReviewQueueMode>("open");
const sidebarCollapsed = ref(false);
const subjectCreatorOpen = ref(false);
const inspectorVisible = ref(true);
const mutationEditorCollapsed = ref(true);
const sliceComposerVisible = ref(false);
const sliceComposerDirty = ref(false);
const sliceComposerSaving = ref(false);
const sliceComposerEditorKey = ref(0);
const sliceComposerLoadKey = ref(0);
const sliceComposerNewKey = ref(0);
const sidebarWidth = ref(defaultSidebarWidth);
const inspectorWidth = ref(defaultInspectorWidth);
const mutationEditorHeight = ref(defaultMutationEditorHeight);
const resetVersion = ref(0);
const metadataDraftSummaries = ref<WorldWorkbenchPreviewMetadataDraftSummary[]>([]);
const valueDraftSummaries = ref<WorldWorkbenchPreviewValueDraftSummary[]>([]);
const draftDiscardSliceId = ref("");
const draftDiscardVersion = ref(0);
const subjectSystemSummaries = ref<WorldWorkbenchPreviewSubjectSystemSummary[]>([]);
const subjectSystemSyncTimeOverride = ref("");
const snapshotSubjects = shallowRef<SubjectStateDto[]>([]);
const previousSnapshotSubjects = shallowRef<SubjectStateDto[]>([]);
const snapshotIssues = ref<WorldIssueDto[]>([]);
const fullSnapshotSubjects = shallowRef<SubjectStateDto[] | null>(null);
const fullSnapshotIssues = ref<WorldIssueDto[] | null>(null);
const fullSnapshotError = ref("");
const loading = ref(false);
const timelineLoading = ref(false);
const snapshotLoading = ref(false);
const fullSnapshotLoading = ref(false);
const actionBusy = ref(false);
const error = ref("");
const notice = ref("");
let snapshotRequestId = 0;
let fullSnapshotRequestId = 0;
let timelineRequestId = 0;
let transientIssueSerial = 0;
let preserveMutationFocusOnSubjectFilterChange = false;

/** 显示 Workbench 错误，并清掉旧成功提示，避免作者同时看到互相冲突的状态。 */
function setWorkbenchError(message: string): void {
    error.value = message;
    if (message) {
        notice.value = "";
    }
}

/** 显示 Workbench 成功 / 提示，并清掉旧错误提示，避免连续操作后误判当前状态。 */
function setWorkbenchNotice(message: string): void {
    notice.value = message;
    if (message) {
        error.value = "";
    }
}

/** 保存请求飞行中阻止用户切换上下文或触发其它写入。 */
function blockSliceComposerSaving(message = "Slice Composer 正在保存，请稍候再切换工作台上下文。"): boolean {
    if (!sliceComposerSaving.value) {
        return false;
    }
    setWorkbenchNotice(message);
    return true;
}

const workbenchSchema = computed(() => schema.value ?? emptySchema);
const selectedSlice = computed(() => slices.value.find((slice) => slice.id === selectedSliceId.value) ?? null);
const selectedSliceIndex = computed(() => selectedSlice.value ? slices.value.findIndex((slice) => slice.id === selectedSlice.value?.id) : -1);
const subjectNameMap = computed(() => new Map(subjects.value.map((subject) => [subject.id, subject.name || subject.id])));
const worldSubjectIdSet = computed(() => new Set(worldSubjects.value.map((subject) => subject.id)));
const previewHref = computed(() => router.resolve(`/world-engine.preview?${new URLSearchParams({projectPath: props.projectPath}).toString()}`).href);
const issueTriageMap = computed(() => {
    const map = new Map<string, WorldWorkbenchPreviewIssueStatus>();
    for (const item of issueTriageStates.value) {
        map.set(item.key, item.status);
        if (item.identity) {
            map.set(item.identity, item.status);
        }
    }
    return map;
});
const reviewQueueItems = computed<WorldWorkbenchPreviewReviewQueueItem[]>(() => buildWorldWorkbenchReviewQueueItems({
    slices: slices.value,
    transientIssues: transientIssues.value,
    triageStatus: issueTriageMap.value,
}));
const reviewTriageSummary = computed<WorldWorkbenchPreviewIssueTriageSummary>(() => {
    let confirmed = 0;
    let ignored = 0;
    let open = 0;
    for (const item of reviewQueueItems.value) {
        if (item.status === "confirmed") {
            confirmed += 1;
        } else if (item.status === "ignored") {
            ignored += 1;
        } else {
            open += 1;
        }
    }
    return {confirmed, done: confirmed + ignored, ignored, open, total: reviewQueueItems.value.length};
});
const sliceReviewSummaries = computed<WorldWorkbenchPreviewSliceReviewSummary[]>(() => slices.value.map((slice) => {
    const items = reviewQueueItems.value.filter((item) => item.sliceId === slice.id);
    const confirmed = items.filter((item) => item.status === "confirmed").length;
    const ignored = items.filter((item) => item.status === "ignored").length;
    const open = items.filter((item) => item.status === "open").length;
    return {confirmed, done: confirmed + ignored, ignored, open, sliceId: slice.id, total: items.length};
}));
const subjectStats = computed<WorldWorkbenchPreviewSubjectStat[]>(() => {
    const statMap = new Map(subjects.value.map((subject) => [subject.id, {
        confirmedIssueCount: 0,
        doneIssueCount: 0,
        ignoredIssueCount: 0,
        issueCount: 0,
        latestKind: "",
        latestTime: "",
        mutationCount: 0,
        openIssueCount: 0,
        sliceCount: 0,
        subjectId: subject.id,
    }]));
    for (const slice of slices.value) {
        if (isWorldWorkbenchSubjectSystemMaintenanceSlice(slice)) {
            continue;
        }
        const touchedSubjectIds = new Set(slice.mutations.map((mutation) => mutation.subjectId));
        for (const subjectId of touchedSubjectIds) {
            const stat = statMap.get(subjectId);
            if (stat) {
                stat.sliceCount += 1;
                stat.latestTime = slice.time;
                stat.latestKind = slice.kind;
            }
        }
        for (const mutation of slice.mutations) {
            const stat = statMap.get(mutation.subjectId);
            if (stat) {
                stat.mutationCount += 1;
            }
        }
    }
    for (const item of reviewQueueItems.value) {
        const stat = statMap.get(item.subjectId);
        if (!stat) {
            continue;
        }
        stat.issueCount += 1;
        if (item.status === "confirmed") {
            stat.confirmedIssueCount += 1;
            stat.doneIssueCount += 1;
        } else if (item.status === "ignored") {
            stat.ignoredIssueCount += 1;
            stat.doneIssueCount += 1;
        } else {
            stat.openIssueCount += 1;
        }
    }
    return [...statMap.values()];
});
const currentReviewQueueIndex = computed(() => {
    const sliceId = selectedSlice.value?.id ?? "";
    const focus = highlightedMutationFocus.value;
    if (focus) {
        if (focus.issueKey) {
            const issueIndex = reviewQueueItems.value.findIndex((item) => item.key === focus.issueKey);
            if (issueIndex >= 0) {
                return issueIndex;
            }
        }
        const focusedIndex = reviewQueueItems.value.findIndex((item) => item.sliceId === sliceId && item.subjectId === focus.subjectId && item.attr === focus.attr);
        if (focusedIndex >= 0) {
            return focusedIndex;
        }
    }
    return reviewQueueItems.value.findIndex((item) => item.sliceId === sliceId);
});
const emptyReviewQueueItems = computed(() => reviewQueueItems.value.slice(0, 3));
const hiddenEmptyReviewItemCount = computed(() => Math.max(0, reviewQueueItems.value.length - emptyReviewQueueItems.value.length));
const metadataDraftSliceCount = computed(() => metadataDraftSummaries.value.length);
const valueDraftSliceCount = computed(() => new Set(valueDraftSummaries.value.map((draft) => draft.sliceId)).size);
const pendingSubjectSystemSummaries = computed(() => subjectSystemSummaries.value.filter((summary) => summary.syncStatus === "pending-world-subject"));
const subjectSystemDefaultSyncTime = computed(() => schema.value?.calendar.examples[0] ?? selectedSlice.value?.time ?? "");
const subjectSystemSyncTime = computed(() => subjectSystemSyncTimeOverride.value.trim() || subjectSystemDefaultSyncTime.value);
const workbenchBusy = computed(() => loading.value || timelineLoading.value || actionBusy.value || sliceComposerSaving.value || snapshotLoading.value || fullSnapshotLoading.value);
const workbenchActionBusy = computed(() => loading.value || actionBusy.value || sliceComposerSaving.value);
const syncStatusDotClass = computed(() => {
    if (error.value) {
        return "bg-[var(--we-danger)]";
    }
    if (workbenchBusy.value) {
        return "bg-[var(--we-warning)]";
    }
    return "bg-[var(--we-success)]";
});
const draftSliceIds = computed(() => collectDraftSliceIds());
const totalDraftSliceCount = computed(() => draftSliceIds.value.length);

/** 汇总当前会话里所有未应用草稿 slice，并优先按当前 timeline 顺序展示。 */
function collectDraftSliceIds(): string[] {
    const draftIds = new Set([
        ...metadataDraftSummaries.value.map((draft) => draft.sliceId),
        ...valueDraftSummaries.value.map((draft) => draft.sliceId),
    ].filter(Boolean));
    const timelineIds = slices.value
        .map((slice) => slice.id)
        .filter((sliceId) => {
            const matched = draftIds.has(sliceId);
            if (matched) {
                draftIds.delete(sliceId);
            }
            return matched;
        });
    return [...timelineIds, ...draftIds];
}
const draftSummaryTitle = computed(() => {
    const parts: string[] = [];
    if (metadataDraftSliceCount.value) {
        parts.push(`${metadataDraftSliceCount.value} metadata`);
    }
    if (valueDraftSliceCount.value) {
        parts.push(`${valueDraftSliceCount.value} value`);
    }
    return parts.length ? `查看未应用草稿：${parts.join(" / ")}` : "当前没有未应用草稿";
});
const inspectorButtonTitle = computed(() => {
    if (!metadataDraftSliceCount.value) {
        return inspectorVisible.value ? "隐藏检查器" : "打开检查器";
    }
    return inspectorVisible.value
        ? `隐藏检查器；${metadataDraftSliceCount.value} 个 metadata 草稿仍会保留`
        : `打开检查器处理 ${metadataDraftSliceCount.value} 个 metadata 草稿`;
});
const worldViewFilterParts = computed<string[]>(() => {
    const parts: string[] = [];
    if (selectedSubjectIds.value.length) {
        const label = selectedSubjectIds.value.map((subjectId) => subjectNameMap.value.get(subjectId) ?? subjectId).join(", ");
        const modeLabel = subjectFilterMode.value === "all" ? "全部 subject" : "任一 subject";
        parts.push(`${t("worldEngine.workbenchPreview.subjects")}(${modeLabel}) ${label}`);
    }
    if (sliceKindFilter.value !== "all") {
        parts.push(`kind ${sliceKindFilter.value}`);
    }
    if (sliceHealthFilter.value !== "all") {
        parts.push(`${t("worldEngine.workbenchPreview.status")} ${sliceHealthFilterLabel(sliceHealthFilter.value)}`);
    }
    if (sliceSearch.value.trim()) {
        parts.push(`${t("worldEngine.workbenchPreview.search")} ${shortFilterText(sliceSearch.value.trim())}`);
    }
    return parts;
});
const worldViewLabel = computed(() => worldViewFilterParts.value.length ? `当前视角：${worldViewFilterParts.value.join(" · ")}` : "整体世界视角");
const selectedSubjectLabel = computed(() => selectedSubjectIds.value.map((subjectId) => subjectNameMap.value.get(subjectId) ?? subjectId).join(", "));
const selectedRegisteredSubjectIds = computed(() => selectedSubjectIds.value.filter((subjectId) => worldSubjectIdSet.value.has(subjectId)));
const demoWorldSchemaError = computed(() => {
    if (!schema.value) {
        return "Schema 未加载，无法创建示例世界。";
    }
    return validatePreviewDemoSchema(schema.value.subjectTypes, worldSubjects.value);
});
const canSeedDemoWorld = computed(() => Boolean(schema.value) && !demoWorldSchemaError.value);
const demoWorldButtonTitle = computed(() => canSeedDemoWorld.value ? "创建内置示例 subject 和第一条事件 slice" : demoWorldSchemaError.value);
const emptySliceState = computed<EmptySliceState>(() => {
    const subjectLabel = selectedSubjectLabel.value;
    if (selectedSubjectIds.value.length && selectedSubjectIds.value.every((subjectId) => !worldSubjectIdSet.value.has(subjectId))) {
        return {
            action: pendingSubjectSystemSummaries.value.length ? "sync-subject-system" : "",
            description: subjectLabel
                ? `${subjectLabel} 暂无 World Engine 时间线。请先同步主体系统，或选择已注册 subject。`
                : "当前 subject 暂无 World Engine 时间线。请先同步主体系统，或选择已注册 subject。",
            title: "当前 subject 尚未接入 World Engine",
        };
    }
    if (selectedSubjectIds.value.length) {
        return {
            action: "new-slice",
            description: subjectLabel
                ? `${subjectLabel} 在当前视角下暂无 slice。可以新建 Slice 写入第一条变更，或清空 subject 过滤回到整体世界。`
                : "当前 subject 时间线暂无 slice。可以新建 Slice 写入第一条变更，或清空 subject 过滤回到整体世界。",
            title: "当前 subject 时间线暂无 slice",
        };
    }
    if (slices.value.length || worldViewFilterParts.value.length) {
        return {
            action: "new-slice",
            description: "可以选择一条 slice 继续检查，或新建 Slice 推演下一步。",
            title: "当前未选择 slice",
        };
    }
    if (pendingSubjectSystemSummaries.value.length) {
        return {
            action: "sync-subject-system",
            description: "可以先同步主体系统，把 simulation/subjects 注册为 World Engine subject，再开始写入第一条 slice。",
            title: "当前 Project 还没有 World Engine slice",
        };
    }
    if (!canSeedDemoWorld.value) {
        return {
            action: worldSubjects.value.length ? "new-slice" : "create-subject",
            description: worldSubjects.value.length
                ? `内置示例暂不可用：${demoWorldSchemaError.value} 可以直接新建 Slice 推演当前世界。`
                : `内置示例暂不可用：${demoWorldSchemaError.value} 请先创建 subject，再写入第一条 slice。`,
            title: "当前 Project 还没有 slice",
        };
    }
    return {
        action: "seed-demo",
        description: "可以先创建 subject，或写入示例世界后再回到这里检查时间线。",
        title: "当前 Project 还没有 slice",
    };
});
const sliceComposerRequestedSubjectId = computed(() => {
    if (focusedSubjectId.value && worldSubjectIdSet.value.has(focusedSubjectId.value)) {
        return focusedSubjectId.value;
    }
    return selectedRegisteredSubjectIds.value.at(-1) ?? focusedSubjectId.value ?? selectedSubjectIds.value.at(-1) ?? "";
});
const sliceComposerSubjectId = computed(() => {
    const requestedSubjectId = sliceComposerRequestedSubjectId.value;
    if (requestedSubjectId && worldSubjectIdSet.value.has(requestedSubjectId)) {
        return requestedSubjectId;
    }
    return worldSubjects.value[0]?.id ?? "world";
});
const sliceComposerUsedTimes = computed(() => [...new Set([...knownSliceTimes.value, ...sliceTimesFromSlices(slices.value)])]);

/** 从切片列表抽取非空时间字符串，供 Composer 避开已知 instant。 */
function sliceTimesFromSlices(sourceSlices: WorldWorkbenchPreviewSlice[]): string[] {
    return sourceSlices.map((slice) => slice.time.trim()).filter(Boolean);
}

/** 用完整 timeline 刷新已知时间窗口。 */
function replaceKnownSliceTimes(sourceSlices: WorldWorkbenchPreviewSlice[]): void {
    knownSliceTimes.value = sliceTimesFromSlices(sourceSlices);
}

/** 把局部 timeline 或懒加载切片并入已知时间窗口。 */
function mergeKnownSliceTimes(sourceSlices: WorldWorkbenchPreviewSlice[]): void {
    const existingTimes = new Set(knownSliceTimes.value);
    const nextTimes = sliceTimesFromSlices(sourceSlices).filter((time) => !existingTimes.has(time));
    knownSliceTimes.value = [...nextTimes, ...knownSliceTimes.value];
}

/** 读取当前 Project 的真实 World Engine 数据。 */
async function loadWorld(options: LoadWorldOptions = {}): Promise<void> {
    if (!props.projectPath) {
        resetWorkbenchSessionState();
        setWorkbenchError("当前没有 Project Workspace。");
        return;
    }
    loading.value = true;
    timelineRequestId += 1;
    timelineLoading.value = false;
    error.value = "";
    try {
        const query = projectQuery();
        const [nextSchema, nextSubjects, nextSlices, subjectSystemOverview] = await Promise.all([
            $fetch<WorldSchemaProjectionDto>("/api/projects/world-engine/schema", {query}),
            $fetch<WorldSubjectDto[]>("/api/projects/world-engine/subjects", {query}),
            $fetch<WorldSliceDto[]>("/api/projects/world-engine/slices", {query: {...query, limit: sliceLimit, withMutations: "true"}}),
            $fetch<ProjectRagOverviewDto>("/api/projects/rag/overview", {query}),
        ]);
        schema.value = nextSchema;
        worldSubjects.value = nextSubjects;
        subjects.value = mergeWorldWorkbenchSubjectsWithSubjectSystem({overview: subjectSystemOverview, worldSubjects: nextSubjects});
        const normalizedSlices = normalizeWorldWorkbenchSlices(nextSlices);
        slices.value = normalizedSlices;
        replaceKnownSliceTimes(normalizedSlices);
        subjectSystemSummaries.value = buildWorldWorkbenchSubjectSystemSummariesFromRagOverview({
            overview: subjectSystemOverview,
            worldSubjects: nextSubjects,
        });
        applyDefaults(options);
        await loadSelectedSliceSnapshots();
    } catch (loadError) {
        schema.value = null;
        worldSubjects.value = [];
        subjects.value = [];
        slices.value = [];
        knownSliceTimes.value = [];
        selectedSliceId.value = "";
        selectedSubjectIds.value = [];
        focusedSubjectId.value = "";
        subjectSystemSummaries.value = [];
        snapshotSubjects.value = [];
        previousSnapshotSubjects.value = [];
        snapshotIssues.value = [];
        fullSnapshotSubjects.value = null;
        fullSnapshotIssues.value = null;
        setWorkbenchError(resolveApiErrorMessage(loadError, "读取 World Engine 数据失败"));
    } finally {
        loading.value = false;
    }
}

/** 刷新基础数据；若作者正在 subject 视角，随后继续使用服务端 subject timeline。 */
async function refreshWorldForCurrentTimeline(options: LoadWorldOptions = {}): Promise<void> {
    const preferredSliceId = options.preferredSliceId ?? selectedSliceId.value;
    const preferredSubjectIds = options.preferredSubjectIds ?? selectedSubjectIds.value;
    await loadWorld({...options, preferredSliceId, preferredSubjectIds});
    if (!schema.value || !selectedSubjectIds.value.some((subjectId) => worldSubjectIdSet.value.has(subjectId))) {
        return;
    }
    await reloadTimelineForCurrentSubjectFilter({
        autoSelectSlice: options.autoSelectSlice,
        preferredSliceId,
        preferredSubjectIds: selectedSubjectIds.value,
    });
}

/** 只刷新 timeline slices，用于 subject 过滤后的真实时间线查询。 */
async function reloadTimelineForCurrentSubjectFilter(options: LoadWorldOptions = {}): Promise<void> {
    if (!props.modelValue || !props.projectPath || loading.value) {
        return;
    }
    const requestId = ++timelineRequestId;
    timelineLoading.value = true;
    error.value = "";
    try {
        const nextSlices = await $fetch<WorldSliceDto[]>("/api/projects/world-engine/slices", {
            query: {
                ...projectQuery(),
                limit: sliceLimit,
                withMutations: "true",
                ...sliceSubjectFilterQuery(),
            },
        });
        if (requestId !== timelineRequestId) {
            return;
        }
        const normalizedSlices = normalizeWorldWorkbenchSlices(nextSlices);
        slices.value = normalizedSlices;
        mergeKnownSliceTimes(normalizedSlices);
        applyDefaults({
            autoSelectSlice: options.autoSelectSlice,
            preferredSliceId: options.preferredSliceId ?? selectedSliceId.value,
            preferredSubjectIds: options.preferredSubjectIds ?? selectedSubjectIds.value,
        });
        await loadSelectedSliceSnapshots();
    } catch (timelineError) {
        if (requestId === timelineRequestId) {
            setWorkbenchError(resolveApiErrorMessage(timelineError, "刷新 subject 时间线失败"));
        }
    } finally {
        if (requestId === timelineRequestId) {
            timelineLoading.value = false;
        }
    }
}

/** 选中 slice 后读取触及主体的当前 / 前一切片状态。 */
async function loadSelectedSliceSnapshots(): Promise<void> {
    const slice = selectedSlice.value;
    const requestId = ++snapshotRequestId;
    fullSnapshotSubjects.value = null;
    fullSnapshotIssues.value = null;
    fullSnapshotError.value = "";
    if (!slice || !props.projectPath) {
        snapshotSubjects.value = [];
        previousSnapshotSubjects.value = [];
        snapshotIssues.value = [];
        return;
    }
    snapshotLoading.value = true;
    try {
        const snapshotSlice = slice.previousTime === undefined || !slice.mutations.length ? await loadSliceDetailForSnapshot(slice) : slice;
        if (requestId !== snapshotRequestId) {
            return;
        }
        const subjectIds = Array.from(new Set(snapshotSlice.mutations.map((mutation) => mutation.subjectId))).filter(Boolean);
        if (!subjectIds.length) {
            snapshotSubjects.value = [];
            previousSnapshotSubjects.value = [];
            snapshotIssues.value = [];
            return;
        }
        const previousSnapshotTime = snapshotSlice.previousTime ?? "";
        const [currentResult, previousResult] = await Promise.all([
            querySubjectsAt(subjectIds, snapshotSlice.time),
            previousSnapshotTime ? querySubjectsAt(subjectIds, previousSnapshotTime) : Promise.resolve({subjects: [], issues: []} satisfies WorldStateQueryDto),
        ]);
        if (requestId !== snapshotRequestId) {
            return;
        }
        snapshotSubjects.value = currentResult.subjects;
        previousSnapshotSubjects.value = previousResult.subjects;
        snapshotIssues.value = currentResult.issues;
    } catch (snapshotError) {
        if (requestId === snapshotRequestId) {
            snapshotSubjects.value = [];
            previousSnapshotSubjects.value = [];
            snapshotIssues.value = [];
            setWorkbenchError(resolveApiErrorMessage(snapshotError, "读取切片状态失败"));
        }
    } finally {
        if (requestId === snapshotRequestId) {
            snapshotLoading.value = false;
        }
    }
}

/** 按需读取 slice detail，确保 State Snapshot 使用真实全局 previousTime，而不是当前过滤列表的前一项。 */
async function loadSliceDetailForSnapshot(slice: WorldWorkbenchPreviewSlice): Promise<WorldWorkbenchPreviewSlice> {
    const result = await $fetch<WorldSliceDto>(`/api/projects/world-engine/slices/${encodeURIComponent(slice.id)}`, {
        query: projectQuery(),
    });
    const loadedSlice = normalizeWorldWorkbenchSlices([result])[0] ?? null;
    if (!loadedSlice) {
        return slice;
    }
    const existingIndex = slices.value.findIndex((item) => item.id === loadedSlice.id);
    slices.value = existingIndex >= 0
        ? slices.value.map((item, index) => index === existingIndex ? loadedSlice : item)
        : mergeWorldWorkbenchTimelineSlice(slices.value, loadedSlice);
    mergeKnownSliceTimes([loadedSlice]);
    return loadedSlice;
}

/** 按需读取当前 slice 的完整世界状态。 */
async function loadFullSnapshot(): Promise<void> {
    const slice = selectedSlice.value;
    if (!slice || !props.projectPath || fullSnapshotLoading.value) {
        return;
    }
    const requestId = ++fullSnapshotRequestId;
    fullSnapshotLoading.value = true;
    fullSnapshotError.value = "";
    try {
        const result = await $fetch<WorldStateDto>("/api/projects/world-engine/state", {
            query: {...projectQuery(), at: slice.time},
        });
        if (requestId === fullSnapshotRequestId && selectedSlice.value?.id === slice.id) {
            fullSnapshotSubjects.value = result.subjects;
            fullSnapshotIssues.value = result.issues;
        }
    } catch (fullError) {
        if (requestId === fullSnapshotRequestId) {
            fullSnapshotSubjects.value = null;
            fullSnapshotIssues.value = null;
            fullSnapshotError.value = resolveApiErrorMessage(fullError, "读取完整世界状态失败");
        }
    } finally {
        if (requestId === fullSnapshotRequestId) {
            fullSnapshotLoading.value = false;
        }
    }
}

/** 查询一批 subject 在指定时间的状态。 */
async function querySubjectsAt(subjectIds: string[], at: string): Promise<WorldStateQueryDto> {
    return $fetch<WorldStateQueryDto>("/api/projects/world-engine/state/query", {
        method: "POST",
        query: projectQuery(),
        body: {subjectIds, at, listLimit: queryListLimit},
    });
}

/** 保存 Inspector metadata 草稿到真实 slice。 */
async function saveMetadataPatch(patch: WorldWorkbenchPreviewSlicePatch): Promise<void> {
    const slice = selectedSlice.value;
    if (!slice) {
        return;
    }
    await saveSliceEdit(slice, buildWorldWorkbenchEditSliceBody(slice, patch), "已保存 slice 元信息");
}

/** 保存单条 mutation value 草稿。 */
async function saveMutationValuePatch(patch: WorldWorkbenchPreviewMutationValuePatch): Promise<void> {
    await saveMutationValuePatches([patch]);
}

/** 批量保存 mutation value 草稿，真实 API 只调用一次 editSlice。 */
async function saveMutationValuePatches(patches: WorldWorkbenchPreviewMutationValuePatch[]): Promise<void> {
    const slice = selectedSlice.value;
    const slicePatches = patches.filter((patch) => patch.sliceId === slice?.id);
    if (!slice || !slicePatches.length) {
        return;
    }
    await saveSliceEdit(slice, buildWorldWorkbenchEditSliceBody(slice, {}, slicePatches), `已保存 ${slicePatches.length} 个 mutation value`);
}

/** 调用真实 editSlice，并刷新 timeline / snapshot / issue。 */
async function saveSliceEdit(slice: WorldWorkbenchPreviewSlice, body: ReturnType<typeof buildWorldWorkbenchEditSliceBody>, successMessage: string): Promise<void> {
    actionBusy.value = true;
    error.value = "";
    try {
        const result = await $fetch<SliceWriteResultDto>(`/api/projects/world-engine/slices/${encodeURIComponent(slice.id)}/edit`, {
            method: "POST",
            query: projectQuery(),
            body,
        });
        setWorkbenchNotice(result.issues.length ? `${successMessage}，返回 ${result.issues.length} 个 issue。` : successMessage);
        clearFiltersIfSavedEditWouldBeHidden({
            ...slice,
            kind: body.kind,
            mutations: body.mutations,
            summary: body.summary,
            time: body.time,
            title: body.title,
        });
        await refreshWorldForCurrentTimeline({preferredSliceId: result.sliceId || slice.id});
        recordTransientIssues(result.issues, result.sliceId || slice.id);
    } catch (saveError) {
        setWorkbenchError(formatWorldEngineConflictMessage(resolveApiErrorMessage(saveError, "保存 slice 失败")));
    } finally {
        actionBusy.value = false;
    }
}

/** 保存编辑后保持当前 slice 可见，避免过滤器把刚保存的内容挡出主画布。 */
function clearFiltersIfSavedEditWouldBeHidden(editedSlice: WorldWorkbenchPreviewSlice): void {
    if (!matchesWorkbenchPreviewSubjectFilter(editedSlice, selectedSubjectIds.value, subjectFilterMode.value)) {
        selectedSubjectIds.value = [];
        subjectFilterMode.value = "any";
    }
    if (!matchesWorkbenchPreviewKindFilter(editedSlice, sliceKindFilter.value)) {
        sliceKindFilter.value = "all";
    }
    if (!matchesWorkbenchPreviewKeywordFilter(editedSlice, sliceSearch.value.trim().toLowerCase())) {
        sliceSearch.value = "";
    }
    if (sliceHealthFilter.value !== "all") {
        sliceHealthFilter.value = "all";
    }
}

/** 为当前 Project 创建一组真实示例数据。 */
async function seedDemoWorld(): Promise<void> {
    if (blockSliceComposerSaving("Slice Composer 正在保存，请稍候再创建示例世界。")) {
        return;
    }
    if (!props.projectPath || !schema.value) {
        setWorkbenchError("Schema 未加载，无法创建示例世界。");
        return;
    }
    const schemaError = demoWorldSchemaError.value;
    if (schemaError) {
        setWorkbenchError(schemaError);
        return;
    }
    const initTime = schema.value.calendar.examples[0] ?? "";
    if (!initTime) {
        setWorkbenchError("Calendar examples 为空，无法推导示例时间。");
        return;
    }
    actionBusy.value = true;
    error.value = "";
    try {
        const eventTime = suggestNextPreviewTime(schema.value.calendar.examples, [...slices.value.map((slice) => slice.time), initTime]);
        const subjectResult = await ensureDemoSubjects(initTime);
        const result = await $fetch<SliceWriteResultDto>("/api/projects/world-engine/slices", {
            method: "POST",
            query: projectQuery(),
            body: {
                time: eventTime,
                title: "示例：艾莉娜抵达王都",
                summary: "主 IDE World Engine 工作台生成的第一条事件切面。",
                kind: "event",
                mutations: previewDemoMutations(),
            },
        });
        const actionIssues = [...subjectResult.issues, ...result.issues];
        setWorkbenchNotice(actionIssues.length
            ? `已创建示例世界：新增 ${subjectResult.created.length} 个 subject，跳过 ${subjectResult.skipped.length} 个已存在 subject，返回 ${actionIssues.length} 个 issue。`
            : `已创建示例世界：新增 ${subjectResult.created.length} 个 subject，跳过 ${subjectResult.skipped.length} 个已存在 subject。`);
        await refreshWorldForCurrentTimeline({preferredSliceId: result.sliceId});
        focusedSubjectId.value = worldSubjects.value.some((subject) => subject.id === "erina") ? "erina" : focusedSubjectId.value;
        recordTransientIssues(actionIssues, result.sliceId);
    } catch (seedError) {
        setWorkbenchError(formatWorldEngineConflictMessage(resolveApiErrorMessage(seedError, "创建示例世界失败")));
    } finally {
        actionBusy.value = false;
    }
}

/** 创建 subject 后刷新当前工作台，并选中新 subject。 */
async function handleSubjectCreated(payload: {subject: WorldSubjectDto; issues: WorldIssueDto[]}): Promise<void> {
    setWorkbenchNotice(payload.issues.length ? `已创建 subject ${payload.subject.id}，返回 ${payload.issues.length} 个 issue。` : `已创建 subject ${payload.subject.id}`);
    selectedSubjectIds.value = [payload.subject.id];
    focusedSubjectId.value = payload.subject.id;
    await refreshWorldForCurrentTimeline({preferredSubjectIds: [payload.subject.id]});
    recordTransientIssues(payload.issues, selectedSlice.value?.id ?? "");
}

/** 把真实 simulation/subjects 中尚未注册的主体同步为 World Engine subject 身份。 */
async function syncPendingSubjectSystemSubjects(): Promise<void> {
    if (blockSliceComposerSaving("Slice Composer 正在保存，请稍候再同步主体系统。")) {
        return;
    }
    const pending = pendingSubjectSystemSummaries.value;
    const time = subjectSystemSyncTime.value.trim();
    if (!pending.length) {
        setWorkbenchNotice("当前没有待接入主体。");
        return;
    }
    if (!time) {
        setWorkbenchError("同步主体系统需要可解析的初始化时间。请先配置 world-engine/calendar.yaml examples。");
        return;
    }
    actionBusy.value = true;
    error.value = "";
    const created: string[] = [];
    const issues: WorldIssueDto[] = [];
    try {
        for (const summary of pending) {
            const subject = subjects.value.find((item) => item.id === summary.subjectId);
            const result = await $fetch<CreateSubjectResultDto>("/api/projects/world-engine/subjects", {
                method: "POST",
                query: projectQuery(),
                body: {
                    id: summary.subjectId,
                    type: subject?.type ?? "character",
                    name: subject?.name || summary.subjectId,
                    time,
                },
            });
            created.push(result.subjectId);
            issues.push(...result.issues);
        }
        setWorkbenchNotice(issues.length
            ? `已接入 ${created.length} 个主体系统 subject，返回 ${issues.length} 个 issue。`
            : `已接入 ${created.length} 个主体系统 subject。`);
        selectedSubjectIds.value = created;
        focusedSubjectId.value = created[0] ?? focusedSubjectId.value;
        await refreshWorldForCurrentTimeline({preferredSubjectIds: created});
        recordTransientIssues(issues, selectedSlice.value?.id ?? "");
    } catch (syncError) {
        const message = formatWorldEngineConflictMessage(resolveApiErrorMessage(syncError, "同步主体系统失败"));
        if (!created.length) {
            setWorkbenchError(message);
            return;
        }
        selectedSubjectIds.value = created;
        focusedSubjectId.value = created[0] ?? focusedSubjectId.value;
        await refreshWorldForCurrentTimeline({preferredSubjectIds: created});
        recordTransientIssues(issues, selectedSlice.value?.id ?? "");
        setWorkbenchError(`已接入 ${created.length} 个主体系统 subject，但后续同步失败：\n${message}`);
    } finally {
        actionBusy.value = false;
    }
}

/** 删除当前选中的 slice，并刷新真实 timeline。 */
async function deleteSelectedSlice(): Promise<void> {
    if (blockSliceComposerSaving("Slice Composer 正在保存，请稍候再删除 Slice。")) {
        return;
    }
    const slice = selectedSlice.value;
    if (!slice) {
        setWorkbenchError("请先选择一个 slice。");
        return;
    }
    if (import.meta.client && !window.confirm(`确定要删除 slice「${slice.title || slice.id}」吗？此操作不可恢复。`)) {
        return;
    }
    actionBusy.value = true;
    error.value = "";
    try {
        const nextDraftSliceId = firstRemainingDraftSliceId(slice.id);
        const result = await $fetch<DeleteSliceResultDto>(`/api/projects/world-engine/slices/${encodeURIComponent(slice.id)}`, {
            method: "DELETE",
            query: projectQuery(),
        });
        setWorkbenchNotice(result.issues.length ? `已删除 slice ${slice.id}，删后返回 ${result.issues.length} 个 issue。` : `已删除 slice ${slice.id}`);
        clearSessionStateForDeletedSlice(slice.id);
        if (nextDraftSliceId) {
            enterDraftViewForSlice(nextDraftSliceId);
        }
        await refreshWorldForCurrentTimeline({autoSelectSlice: false, preferredSliceId: nextDraftSliceId || undefined});
        if (nextDraftSliceId && selectedSliceId.value === nextDraftSliceId) {
            openDraftSurfacesForSlice(nextDraftSliceId);
        }
        recordTransientIssues(result.issues, slice.id, slice);
    } catch (deleteError) {
        setWorkbenchError(resolveApiErrorMessage(deleteError, "删除 slice 失败"));
    } finally {
        actionBusy.value = false;
    }
}

/** 返回删除当前 slice 后还需要保留的第一个草稿 slice。 */
function firstRemainingDraftSliceId(deletedSliceId: string): string {
    return draftSliceIds.value.find((sliceId) => sliceId !== deletedSliceId) ?? "";
}

/** 进入草稿视角并先选中指定 slice，避免删除当前 slice 时卸载编辑器丢掉其它草稿。 */
function enterDraftViewForSlice(sliceId: string): void {
    sliceSearch.value = "";
    sliceKindFilter.value = "all";
    sliceHealthFilter.value = "draft";
    selectedSubjectIds.value = [];
    subjectFilterMode.value = "any";
    selectedSliceId.value = sliceId;
    openDraftSurfacesForSlice(sliceId);
}

/** 删除 slice 后清理只属于该 slice 的前端会话态，避免 Drafts / Review / Snapshot 指向已删除记录。 */
function clearSessionStateForDeletedSlice(sliceId: string): void {
    discardSessionDraftsForSlice(sliceId);
    transientIssues.value = transientIssues.value.filter((issue) => issue.sliceId !== sliceId);
    highlightedMutationFocus.value = null;
    snapshotSubjects.value = [];
    previousSnapshotSubjects.value = [];
    snapshotIssues.value = [];
    fullSnapshotSubjects.value = null;
    fullSnapshotIssues.value = null;
    fullSnapshotError.value = "";
}

/** 清理某个 slice 的 metadata/value 会话草稿；Composer 整块保存后也复用，避免旧草稿覆盖新结果。 */
function discardSessionDraftsForSlice(sliceId: string): void {
    draftDiscardSliceId.value = sliceId;
    draftDiscardVersion.value += 1;
    metadataDraftSummaries.value = metadataDraftSummaries.value.filter((draft) => draft.sliceId !== sliceId);
    valueDraftSummaries.value = valueDraftSummaries.value.filter((draft) => draft.sliceId !== sliceId);
}

/** 确保示例 subject 存在。 */
async function ensureDemoSubjects(initTime: string): Promise<{created: string[]; skipped: string[]; issues: WorldIssueDto[]}> {
    const existingIds = new Set(worldSubjects.value.map((subject) => subject.id));
    const created: string[] = [];
    const skipped: string[] = [];
    const issues: WorldIssueDto[] = [];
    for (const seed of previewDemoSubjects()) {
        if (existingIds.has(seed.id)) {
            skipped.push(seed.id);
            continue;
        }
        const result = await $fetch<CreateSubjectResultDto>("/api/projects/world-engine/subjects", {
            method: "POST",
            query: projectQuery(),
            body: {id: seed.id, type: seed.type, name: seed.name, time: initTime},
        });
        existingIds.add(seed.id);
        created.push(result.subjectId);
        issues.push(...result.issues);
    }
    return {created, skipped, issues};
}

/** 把本次操作返回的 transient issue 加入当前会话 review queue。 */
function recordTransientIssues(issues: WorldIssueDto[], fallbackSliceId: string, fallbackSlice?: Pick<WorldWorkbenchPreviewSlice, "id" | "time" | "title">): void {
    if (!issues.length) {
        return;
    }
    const nextIssues = issues.map((issue, index): WorldWorkbenchTransientIssue => {
        const sliceId = issue.sliceId || fallbackSliceId || selectedSlice.value?.id || "";
        const slice = slices.value.find((item) => item.id === sliceId)
            ?? (fallbackSlice?.id === sliceId ? fallbackSlice : null)
            ?? (selectedSlice.value?.id === sliceId ? selectedSlice.value : null);
        const key = `transient:${transientIssueSerial++}:${sliceId}:${index}:${issue.subjectId}:${issue.attr}:${issue.code}`;
        return {
            attr: issue.attr,
            code: issue.code,
            issueIndex: index,
            key,
            message: issue.message,
            sliceId,
            sliceTime: slice?.time ?? "",
            sliceTitle: slice?.title ?? sliceId,
            subjectId: issue.subjectId,
        };
    });
    transientIssues.value = [
        ...transientIssues.value.filter((issue) => !nextIssues.some((nextIssue) => nextIssue.sliceId === issue.sliceId && nextIssue.subjectId === issue.subjectId && nextIssue.attr === issue.attr && nextIssue.code === issue.code)),
        ...nextIssues,
    ];
}

/** 选择新的切片，并让编辑器/Inspector 对齐当前上下文。 */
function selectSlice(sliceId: string): void {
    if (blockSliceComposerSaving()) {
        return;
    }
    selectedSliceId.value = sliceId;
    highlightedMutationFocus.value = null;
    alignFocusedSubject(slices.value.find((slice) => slice.id === sliceId));
    openDraftSurfacesForSlice(sliceId);
}

/** 从 draft 时间线定位 slice 时，自动打开真正处理草稿的面板。 */
function openDraftSurfacesForSlice(sliceId: string): void {
    if (sliceHealthFilter.value !== "draft") {
        return;
    }
    if (metadataDraftSummaries.value.some((draft) => draft.sliceId === sliceId)) {
        inspectorVisible.value = true;
    }
    if (valueDraftSummaries.value.some((draft) => draft.sliceId === sliceId)) {
        mutationEditorCollapsed.value = false;
    }
}

/** 将右侧 Inspector / 底部审查工作台的 subject 视角切到指定主体。 */
function focusSubject(subjectId: string): void {
    if (blockSliceComposerSaving()) {
        return;
    }
    focusedSubjectId.value = subjectId;
    highlightedMutationFocus.value = null;
    mutationEditorCollapsed.value = false;
}

/** 读取一个未加载的切面并放入当前 timeline，用于 Review Queue 精确定位。 */
async function loadSliceIntoTimeline(sliceId: string): Promise<WorldWorkbenchPreviewSlice | null> {
    if (!sliceId) {
        return null;
    }
    const existing = slices.value.find((slice) => slice.id === sliceId);
    if (existing) {
        return existing;
    }
    timelineLoading.value = true;
    error.value = "";
    try {
        const result = await $fetch<WorldSliceDto>(`/api/projects/world-engine/slices/${encodeURIComponent(sliceId)}`, {
            query: projectQuery(),
        });
        const loadedSlice = normalizeWorldWorkbenchSlices([result])[0] ?? null;
        if (!loadedSlice) {
            return null;
        }
        slices.value = mergeWorldWorkbenchTimelineSlice(slices.value, loadedSlice);
        mergeKnownSliceTimes([loadedSlice]);
        return loadedSlice;
    } catch (loadError) {
        setWorkbenchError(resolveApiErrorMessage(loadError, "读取 issue 所属 slice 失败"));
        return null;
    } finally {
        timelineLoading.value = false;
    }
}

/** 从 Review Queue 跳转并定位到指定 issue。 */
async function focusReviewIssue(item: WorldWorkbenchPreviewReviewQueueItem): Promise<void> {
    if (blockSliceComposerSaving()) {
        return;
    }
    const targetSlice = await loadSliceIntoTimeline(item.sliceId);
    if (!targetSlice) {
        setWorkbenchNotice(`Issue 所属 slice ${item.sliceId || "(未知)"} 当前未加载，无法定位到时间线。`);
        focusedSubjectId.value = item.subjectId;
        highlightedMutationFocus.value = null;
        mutationEditorCollapsed.value = false;
        return;
    }
    sliceSearch.value = "";
    sliceKindFilter.value = "all";
    sliceHealthFilter.value = "all";
    setSubjectFilterForReviewIssue(item.subjectId);
    await reloadTimelineForCurrentSubjectFilter({preferredSliceId: item.sliceId, preferredSubjectIds: [item.subjectId]});
    if (!slices.value.some((slice) => slice.id === targetSlice.id)) {
        slices.value = mergeWorldWorkbenchTimelineSlice(slices.value, targetSlice);
    }
    selectedSliceId.value = item.sliceId;
    focusedSubjectId.value = item.subjectId;
    highlightedMutationFocus.value = {attr: item.attr, issueKey: item.key, subjectId: item.subjectId};
    mutationEditorCollapsed.value = false;
}

/** Review Queue 自动切换 subject 过滤时保留 issue focus，避免 watcher 误清空刚定位的 issue。 */
function setSubjectFilterForReviewIssue(subjectId: string): void {
    const alreadySelected = selectedSubjectIds.value.length === 1 && selectedSubjectIds.value[0] === subjectId;
    if (!alreadySelected) {
        preserveMutationFocusOnSubjectFilterChange = true;
        selectedSubjectIds.value = [subjectId];
    }
    subjectFilterMode.value = "any";
}

function clearMutationFocus(): void {
    highlightedMutationFocus.value = null;
}

/** 当前 issue 被保存 / 刷新移除后，清掉旧高亮，避免底部审查区退化成误导性的 manual-focus。 */
function clearMissingReviewIssueFocus(): void {
    const focus = highlightedMutationFocus.value;
    if (!focus?.issueKey) {
        return;
    }
    if (!reviewQueueItems.value.some((item) => item.key === focus.issueKey)) {
        highlightedMutationFocus.value = null;
    }
}

function viewSubjectTimeline(subjectId: string): void {
    if (blockSliceComposerSaving()) {
        return;
    }
    void updateSelectedSubjectIdsForTimeline([subjectId]);
    focusSubject(subjectId);
}

function clearSubjectFilter(): void {
    if (blockSliceComposerSaving()) {
        return;
    }
    void updateSelectedSubjectIdsForTimeline([]);
}

function updateSliceSearchForTimeline(value: string): void {
    if (blockSliceComposerSaving()) {
        return;
    }
    sliceSearch.value = value;
}

function updateSliceKindFilterForTimeline(filter: string): void {
    if (blockSliceComposerSaving()) {
        return;
    }
    sliceKindFilter.value = filter;
}

function updateSliceHealthFilterForTimeline(filter: WorldWorkbenchPreviewSliceHealthFilter): void {
    if (blockSliceComposerSaving()) {
        return;
    }
    sliceHealthFilter.value = filter;
}

function removeSubjectFilter(subjectId: string): void {
    if (blockSliceComposerSaving()) {
        return;
    }
    void updateSelectedSubjectIdsForTimeline(selectedSubjectIds.value.filter((id) => id !== subjectId));
}

async function updateSelectedSubjectIdsForTimeline(subjectIds: string[]): Promise<void> {
    if (blockSliceComposerSaving()) {
        return;
    }
    if (!subjectIds.length && subjectFilterMode.value !== "any") {
        subjectFilterMode.value = "any";
    }
    const pendingSubjectIds = subjectIds.filter((subjectId) => !worldSubjectIdSet.value.has(subjectId));
    const registeredSubjectIds = subjectIds.filter((subjectId) => worldSubjectIdSet.value.has(subjectId));
    const switchedSubjectFilterMode = pendingSubjectIds.length > 0 && subjectFilterMode.value === "all";
    if (switchedSubjectFilterMode) {
        subjectFilterMode.value = "any";
    }
    if (pendingSubjectIds.length) {
        const labels = pendingSubjectIds.map((subjectId) => subjectNameMap.value.get(subjectId) ?? subjectId).join(", ");
        setWorkbenchNotice(switchedSubjectFilterMode
            ? `${pendingSubjectTimelineNoticePrefix}：${labels}。包含待接入 subject 时已切回“任一 subject”过滤；请先使用左侧“同步主体系统”，或选择已注册 subject。`
            : `${pendingSubjectTimelineNoticePrefix}：${labels}。请先使用左侧“同步主体系统”，或选择已注册 subject。`);
    } else if (notice.value.startsWith(pendingSubjectTimelineNoticePrefix)) {
        notice.value = "";
    }
    selectedSubjectIds.value = subjectIds;
    await reloadTimelineForCurrentSubjectFilter({preferredSubjectIds: subjectIds});
    if (subjectIds.length && !registeredSubjectIds.length) {
        selectedSliceId.value = "";
        focusedSubjectId.value = subjectIds.at(-1) ?? "";
        highlightedMutationFocus.value = null;
    }
}

async function updateSubjectFilterModeForTimeline(mode: WorldWorkbenchPreviewSubjectFilterMode): Promise<void> {
    if (blockSliceComposerSaving()) {
        return;
    }
    const pendingSubjectIds = selectedSubjectIds.value.filter((subjectId) => !worldSubjectIdSet.value.has(subjectId));
    if (mode === "all" && pendingSubjectIds.length) {
        const labels = pendingSubjectIds.map((subjectId) => subjectNameMap.value.get(subjectId) ?? subjectId).join(", ");
        subjectFilterMode.value = "any";
        setWorkbenchNotice(`${pendingSubjectTimelineNoticePrefix}：${labels}。待接入 subject 还没有 World Engine 切片，暂不能使用“全部 subject”过滤。`);
        return;
    }
    if (mode !== subjectFilterMode.value) {
        highlightedMutationFocus.value = null;
    }
    subjectFilterMode.value = mode;
    if (selectedSubjectIds.value.length) {
        await reloadTimelineForCurrentSubjectFilter({preferredSubjectIds: selectedSubjectIds.value});
    }
}

function openInspectorPanel(): void {
    inspectorVisible.value = true;
}

function expandMutationEditorPanel(): void {
    mutationEditorCollapsed.value = false;
}

function openSliceComposer(): void {
    if (blockSliceComposerSaving("Slice Composer 正在保存，请稍候再新建 Slice。")) {
        return;
    }
    const requestedSubjectId = sliceComposerRequestedSubjectId.value;
    if (requestedSubjectId && !worldSubjectIdSet.value.has(requestedSubjectId)) {
        const subjectName = subjectNameMap.value.get(requestedSubjectId) ?? requestedSubjectId;
        setWorkbenchNotice(`主体 ${subjectName} 尚未接入 World Engine。请先同步主体系统，或选择已注册 subject 后再新建 Slice。`);
        return;
    }
    if (!worldSubjects.value.length) {
        setWorkbenchNotice("当前 Project 还没有 World Engine subject。请先创建 subject 或同步主体系统。");
        return;
    }
    const wasVisible = sliceComposerVisible.value;
    if (!wasVisible) {
        sliceComposerDirty.value = false;
    }
    sliceComposerVisible.value = true;
    if (wasVisible) {
        sliceComposerNewKey.value += 1;
    }
}

/** 从空状态把作者带到左侧创建 Subject 面板。 */
function openSubjectCreatorPanel(): void {
    if (workbenchActionBusy.value) {
        return;
    }
    sidebarCollapsed.value = false;
    subjectCreatorOpen.value = true;
}

/** 同步原生 details 展开状态，保留用户手动折叠 / 展开选择。 */
function updateSubjectCreatorOpen(event: Event): void {
    subjectCreatorOpen.value = (event.currentTarget as HTMLDetailsElement | null)?.open ?? false;
}

async function openSelectedSliceComposer(): Promise<void> {
    if (blockSliceComposerSaving("Slice Composer 正在保存，请稍候再编辑其它 Slice。")) {
        return;
    }
    if (!selectedSlice.value) {
        setWorkbenchNotice("请先选择要编辑的 slice。");
        return;
    }
    if (!worldSubjects.value.length) {
        setWorkbenchNotice("当前 Project 还没有 World Engine subject。请先创建 subject 或同步主体系统。");
        return;
    }
    if (!sliceComposerVisible.value) {
        sliceComposerDirty.value = false;
    }
    sliceComposerVisible.value = true;
    await nextTick();
    sliceComposerLoadKey.value += 1;
}

function closeSliceComposer(): void {
    if (sliceComposerSaving.value) {
        setWorkbenchNotice("Slice Composer 正在保存，请稍候再关闭。");
        return;
    }
    if (sliceComposerDirty.value && import.meta.client && !window.confirm("当前 Slice Composer 有未保存草稿，确定关闭吗？")) {
        return;
    }
    sliceComposerVisible.value = false;
    sliceComposerDirty.value = false;
}

function requestWorkbenchClose(): void {
    if (sliceComposerSaving.value) {
        setWorkbenchNotice("Slice Composer 正在保存，请稍候再关闭 Workbench。");
        return;
    }
    const unsavedLabels = workbenchUnsavedDraftLabels();
    if (unsavedLabels.length && import.meta.client && !window.confirm(`当前 Workbench 有未保存内容：${unsavedLabels.join("、")}。确定关闭并放弃吗？`)) {
        return;
    }
    emit("update:modelValue", false);
}

/** 从 Workbench 打开 schema/calendar 源文件；有草稿时先沿用 Workbench 关闭确认。 */
function openWorkspacePathFromWorkbench(path: string): void {
    const targetPath = path.trim();
    if (!targetPath) {
        return;
    }
    if (sliceComposerSaving.value) {
        setWorkbenchNotice("Slice Composer 正在保存，请稍候再打开配置文件。");
        return;
    }
    const unsavedLabels = workbenchUnsavedDraftLabels();
    if (unsavedLabels.length && import.meta.client && !window.confirm(`当前 Workbench 有未保存内容：${unsavedLabels.join("、")}。打开配置文件会关闭 Workbench 并放弃这些会话草稿，确定继续吗？`)) {
        return;
    }
    emit("openWorkspacePath", targetPath);
    emit("update:modelValue", false);
}

/** 统一处理 Dialog 的 v-model 更新，避免直接关闭绕过 Workbench 草稿确认。 */
function handleWorkbenchModelUpdate(value: boolean): void {
    if (value) {
        emit("update:modelValue", true);
        return;
    }
    requestWorkbenchClose();
}

/** 汇总关闭 Workbench 时会丢弃的会话态草稿。 */
function workbenchUnsavedDraftLabels(): string[] {
    const labels: string[] = [];
    if (sliceComposerDirty.value) {
        labels.push("Slice Composer 草稿");
    }
    if (metadataDraftSummaries.value.length) {
        labels.push(`${metadataDraftSummaries.value.length} 个 metadata 草稿`);
    }
    if (valueDraftSliceCount.value) {
        labels.push(`${valueDraftSliceCount.value} 个 value 草稿`);
    }
    return labels;
}

/** Slice Composer 写入/编辑成功后回到真实时间线，并把 issues 接入当前会话审查队列。 */
async function handleSliceComposerSaved(payload: {result: SliceWriteResultDto; time: string; editing: boolean; continueAfterSave: boolean; contextSubjectId: string; mutations: WorldSliceMutationDto[]}): Promise<void> {
    const messagePrefix = payload.editing ? "已更新 slice" : "已写入 slice";
    const continueSuffix = payload.continueAfterSave ? "，已准备下一步草稿" : "";
    setWorkbenchNotice(payload.result.issues.length
        ? `${messagePrefix} ${payload.result.sliceId}，返回 ${payload.result.issues.length} 个 issue${continueSuffix}。`
        : `${messagePrefix} ${payload.result.sliceId}${continueSuffix}`);
    sliceComposerVisible.value = payload.continueAfterSave;
    sliceComposerDirty.value = false;
    sliceSearch.value = "";
    sliceKindFilter.value = "all";
    sliceHealthFilter.value = "all";
    clearSubjectFilterIfSavedSliceWouldBeHidden(payload.mutations);
    const continueSubjectId = payload.continueAfterSave ? payload.contextSubjectId : "";
    if (continueSubjectId && worldSubjectIdSet.value.has(continueSubjectId)) {
        focusedSubjectId.value = continueSubjectId;
    }
    if (payload.editing) {
        discardSessionDraftsForSlice(payload.result.sliceId);
    }
    await refreshWorldForCurrentTimeline({preferredSliceId: payload.result.sliceId});
    recordTransientIssues(payload.result.issues, payload.result.sliceId);
    if (!payload.continueAfterSave) {
        sliceComposerEditorKey.value += 1;
    }
}

/** 保存后的切片如果不命中当前 subject 过滤，先切回整体视角，避免时间线立刻跳走。 */
function clearSubjectFilterIfSavedSliceWouldBeHidden(mutations: WorldSliceMutationDto[]): void {
    if (!selectedSubjectIds.value.length) {
        return;
    }
    const touched = new Set(mutations.map((mutation) => mutation.subjectId));
    const visible = subjectFilterMode.value === "all"
        ? selectedSubjectIds.value.every((subjectId) => touched.has(subjectId))
        : selectedSubjectIds.value.some((subjectId) => touched.has(subjectId));
    if (visible) {
        return;
    }
    selectedSubjectIds.value = [];
    subjectFilterMode.value = "any";
}

/** 顶栏全局草稿入口：清掉阻挡过滤，进入 draft 时间线。 */
async function showAllDraftSlices(): Promise<void> {
    if (blockSliceComposerSaving("Slice Composer 正在保存，请稍候再查看草稿。")) {
        return;
    }
    const targetDraftSliceIds = draftSliceIds.value;
    sliceSearch.value = "";
    sliceKindFilter.value = "all";
    sliceHealthFilter.value = "draft";
    selectedSubjectIds.value = [];
    subjectFilterMode.value = "any";
    await reloadTimelineForCurrentSubjectFilter();
    for (const sliceId of targetDraftSliceIds) {
        if (!slices.value.some((slice) => slice.id === sliceId)) {
            await loadSliceIntoTimeline(sliceId);
        }
    }
    const firstDraftSliceId = targetDraftSliceIds.find((sliceId) => slices.value.some((slice) => slice.id === sliceId));
    if (firstDraftSliceId) {
        selectSlice(firstDraftSliceId);
        return;
    }
    setWorkbenchNotice("当前草稿所在 slice 未能重新载入，请刷新后再试。");
}

/** 更新前端会话态 issue triage；不回写后端。 */
function updateIssueTriage(patch: WorldWorkbenchPreviewIssueTriagePatch): void {
    issueTriageStates.value = [
        ...issueTriageStates.value.filter((item) => item.key !== patch.key),
        {identity: patch.identity, key: patch.key, status: patch.status, updatedAt: new Date().toISOString()},
    ];
    setWorkbenchNotice(`Issue 已标记为 ${issueStatusLabel(patch.status)}`);
}

/** 当前 focused subject 不属于 slice 时，回落到过滤 subject 或 slice 首个触及主体。 */
function alignFocusedSubject(slice: WorldWorkbenchPreviewSlice | undefined): void {
    if (!slice) {
        focusedSubjectId.value = "";
        return;
    }
    const touched = new Set(slice.mutations.map((mutation) => mutation.subjectId));
    if (focusedSubjectId.value && touched.has(focusedSubjectId.value)) {
        return;
    }
    for (let index = selectedSubjectIds.value.length - 1; index >= 0; index -= 1) {
        const subjectId = selectedSubjectIds.value[index];
        if (subjectId && touched.has(subjectId)) {
            focusedSubjectId.value = subjectId;
            return;
        }
    }
    focusedSubjectId.value = slice.mutations[0]?.subjectId ?? "";
}

function applyDefaults(options: {autoSelectSlice?: boolean; preferredSliceId?: string; preferredSubjectIds?: string[]} = {}): void {
    const subjectIdSet = new Set(subjects.value.map((subject) => subject.id));
    selectedSubjectIds.value = selectedSubjectIds.value.filter((subjectId) => subjectIdSet.has(subjectId));
    if (!selectedSubjectIds.value.length) {
        subjectFilterMode.value = "any";
    }
    const preferredSubjectIds = (options.preferredSubjectIds ?? []).filter((subjectId) => subjectIdSet.has(subjectId));
    const preferredSlice = slices.value.find((slice) => slice.id === options.preferredSliceId);
    const preferredSubjectSlice = latestSliceTouchingSubjects(preferredSubjectIds);
    const keptSlice = slices.value.find((slice) => slice.id === selectedSliceId.value);
    const keepEmptyPreferredSubjectView = preferredSubjectIds.length > 0 && !preferredSlice && !preferredSubjectSlice;
    const fallbackSlice = options.autoSelectSlice === false || keepEmptyPreferredSubjectView
        ? null
        : [...slices.value].reverse().find((slice) => !isWorldWorkbenchSubjectSystemMaintenanceSlice(slice)) ?? slices.value.at(-1) ?? null;
    const nextSlice = preferredSlice ?? preferredSubjectSlice ?? keptSlice ?? fallbackSlice;
    selectedSliceId.value = nextSlice?.id ?? "";
    if (!nextSlice && preferredSubjectIds.length) {
        focusedSubjectId.value = preferredSubjectIds.at(-1) ?? "";
        return;
    }
    alignFocusedSubject(nextSlice ?? undefined);
}

/** 创建 / 同步 subject 后，优先定位到刚生成或追加的初始化切片。 */
function latestSliceTouchingSubjects(subjectIds: string[]): WorldWorkbenchPreviewSlice | null {
    const preferredSubjectSet = new Set(subjectIds.filter(Boolean));
    if (!preferredSubjectSet.size) {
        return null;
    }
    return [...slices.value].reverse().find((slice) => slice.mutations.some((mutation) => preferredSubjectSet.has(mutation.subjectId))) ?? null;
}

/** 切换 Project 或关闭 Dialog 时清空会话态草稿和选择。 */
function resetWorkbenchSessionState(): void {
    schema.value = null;
    worldSubjects.value = [];
    subjects.value = [];
    slices.value = [];
    knownSliceTimes.value = [];
    selectedSliceId.value = "";
    selectedSubjectIds.value = [];
    subjectFilterMode.value = "any";
    sliceSearch.value = "";
    sliceKindFilter.value = "all";
    sliceHealthFilter.value = "all";
    focusedSubjectId.value = "";
    highlightedMutationFocus.value = null;
    issueTriageStates.value = [];
    transientIssues.value = [];
    reviewQueueMode.value = "open";
    subjectCreatorOpen.value = false;
    mutationEditorCollapsed.value = true;
    sliceComposerVisible.value = false;
    sliceComposerDirty.value = false;
    sliceComposerSaving.value = false;
    sliceComposerEditorKey.value += 1;
    sliceComposerLoadKey.value = 0;
    sliceComposerNewKey.value = 0;
    metadataDraftSummaries.value = [];
    valueDraftSummaries.value = [];
    draftDiscardSliceId.value = "";
    draftDiscardVersion.value = 0;
    subjectSystemSummaries.value = [];
    subjectSystemSyncTimeOverride.value = "";
    snapshotSubjects.value = [];
    previousSnapshotSubjects.value = [];
    snapshotIssues.value = [];
    fullSnapshotSubjects.value = null;
    fullSnapshotIssues.value = null;
    fullSnapshotError.value = "";
    notice.value = "";
    error.value = "";
    resetVersion.value += 1;
}

function projectQuery(): {projectPath: string} {
    return {projectPath: props.projectPath};
}

function sliceSubjectFilterQuery(): {subjectIds?: string; subjectMode?: WorldWorkbenchPreviewSubjectFilterMode} {
    const registeredSubjectIds = selectedSubjectIds.value.filter((subjectId) => worldSubjectIdSet.value.has(subjectId));
    if (!registeredSubjectIds.length) {
        return {};
    }
    return {
        subjectIds: registeredSubjectIds.join(","),
        subjectMode: subjectFilterMode.value,
    };
}

function openPreview(): void {
    if (import.meta.client) {
        window.open(previewHref.value, "_blank", "noopener,noreferrer");
    }
}

function sliceHealthFilterLabel(filter: WorldWorkbenchPreviewSliceHealthFilter): string {
    if (filter === "open") {
        return t("worldEngine.workbenchPreview.openIssues");
    }
    if (filter === "done") {
        return t("worldEngine.workbenchPreview.reviewDone");
    }
    if (filter === "clean") {
        return t("worldEngine.workbenchPreview.clean");
    }
    if (filter === "draft") {
        return t("worldEngine.workbenchPreview.drafts");
    }
    return t("worldEngine.workbenchPreview.all");
}

function shortFilterText(text: string): string {
    return text.length <= 18 ? text : `${text.slice(0, 18)}...`;
}

function issueStatusLabel(status: WorldWorkbenchPreviewIssueStatus): string {
    if (status === "confirmed") {
        return "已确认";
    }
    if (status === "ignored") {
        return "已忽略";
    }
    return "待处理";
}

function issueLevel(code: WorldWorkbenchPreviewReviewQueueItem["code"]): "A" | "E" {
    return code === "base-shifted" || code === "masked" ? "A" : "E";
}

watch(() => props.modelValue, (visible) => {
    if (visible) {
        void loadWorld();
    } else {
        resetWorkbenchSessionState();
    }
});

watch(() => props.projectPath, () => {
    resetWorkbenchSessionState();
    if (props.modelValue) {
        void loadWorld();
    }
});

watch(() => workbenchUnsavedDraftLabels().length > 0, (hasUnsavedDrafts) => {
    emit("hasUnsavedDraftsChange", hasUnsavedDrafts);
}, {immediate: true});

watch(() => sliceComposerSaving.value, (saving) => {
    emit("savingChange", saving);
}, {immediate: true});

watch(() => selectedSliceId.value, () => {
    if (props.modelValue) {
        void loadSelectedSliceSnapshots();
    }
});

watch(() => selectedSubjectIds.value.join("\u0000"), () => {
    if (!selectedSubjectIds.value.length) {
        highlightedMutationFocus.value = null;
        return;
    }
    focusedSubjectId.value = selectedSubjectIds.value[selectedSubjectIds.value.length - 1] ?? "";
    if (preserveMutationFocusOnSubjectFilterChange) {
        preserveMutationFocusOnSubjectFilterChange = false;
        return;
    }
    highlightedMutationFocus.value = null;
});

watch(() => reviewQueueItems.value.map((item) => item.key).join("\u0000"), clearMissingReviewIssueFocus);
</script>

<template>
    <Dialog
        :model-value="props.modelValue"
        size="full"
        overlay-type="blur"
        :show-footer="false"
        :close-on-overlay="false"
        :teleport-target="false"
        body-class="!gap-0 !overflow-hidden !p-0"
        @update:model-value="handleWorkbenchModelUpdate"
        @request-close="requestWorkbenchClose"
    >
        <template #header>
            <!-- World Engine 真实工作台顶部栏 -->
            <div class="world-engine-workbench-theme flex min-w-0 flex-1 items-center gap-3">
                <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[color-mix(in_srgb,var(--accent-main)_58%,var(--border-color))] bg-[color-mix(in_srgb,var(--accent-main)_18%,var(--bg-panel))] text-[12px] font-bold text-[var(--accent-main)]">WE</span>
                <div class="min-w-0">
                    <div class="text-[16px] font-semibold text-[var(--text-main)]">World Engine Workbench</div>
                    <div class="flex min-w-0 items-center gap-2 truncate text-[12px] text-[var(--text-muted)]">
                        <span class="truncate">{{ props.projectTitle || props.projectPath || "未选择 Project" }}</span>
                        <span v-if="workbenchSchema.calendar.format" class="hidden rounded-md border border-[var(--border-color)] px-1.5 py-0.5 text-[10px] md:inline">{{ workbenchSchema.calendar.format }}</span>
                        <span class="hidden truncate lg:inline">{{ worldViewLabel }}</span>
                    </div>
                </div>
                <div class="ml-auto flex items-center gap-2">
                    <span class="hidden items-center gap-1.5 rounded-md border border-[var(--border-color)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] md:inline-flex">
                        <span class="h-1.5 w-1.5 rounded-full" :class="syncStatusDotClass"></span>
                        {{ error ? "需要处理" : workbenchBusy ? "同步中" : "已同步" }}
                    </span>
                    <button
                        v-if="totalDraftSliceCount"
                        type="button"
                        data-testid="world-workbench-draft-summary"
                        class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] px-2.5 text-[12px] font-medium text-[var(--we-warning)] transition-colors hover:bg-[var(--we-bg-hover)] disabled:opacity-50"
                        :disabled="sliceComposerSaving"
                        :title="draftSummaryTitle"
                        @click="void showAllDraftSlices()"
                    >
                        <span class="i-lucide-list-todo h-3.5 w-3.5"></span>
                        {{ t("worldEngine.workbenchPreview.drafts") }}
                        <span class="rounded bg-[var(--we-bg-panel)] px-1.5 font-mono text-[10px]">{{ totalDraftSliceCount }}</span>
                    </button>
                    <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] px-3 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:opacity-50" :disabled="workbenchActionBusy" @click="void refreshWorldForCurrentTimeline()">
                        <span :class="loading ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-refresh-cw'" class="h-3.5 w-3.5"></span>
                        刷新
                    </button>
                    <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] px-3 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:opacity-50" :disabled="workbenchActionBusy || !schema" @click="openSliceComposer">
                        <span class="i-lucide-file-plus-2 h-3.5 w-3.5"></span>
                        新建 Slice
                    </button>
                    <button type="button" class="hidden h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] px-3 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:opacity-50 lg:inline-flex" :disabled="workbenchActionBusy || !schema || !selectedSlice" @click="void openSelectedSliceComposer()">
                        <span class="i-lucide-pencil h-3.5 w-3.5"></span>
                        编辑 Slice
                    </button>
                    <button type="button" class="hidden h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] px-3 text-[12px] text-[var(--text-secondary)] transition-colors hover:border-[var(--we-danger-border)] hover:bg-[var(--we-danger-soft)] hover:text-[var(--we-danger)] disabled:opacity-50 xl:inline-flex" :disabled="workbenchActionBusy || !selectedSlice" @click="void deleteSelectedSlice()">
                        <span :class="actionBusy ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-trash-2'" class="h-3.5 w-3.5"></span>
                        删除 Slice
                    </button>
                    <button type="button" class="hidden h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] px-3 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:opacity-50 md:inline-flex" :disabled="workbenchActionBusy || !canSeedDemoWorld" :title="demoWorldButtonTitle" @click="void seedDemoWorld()">
                        <span :class="actionBusy ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-sparkles'" class="h-3.5 w-3.5"></span>
                        示例世界
                    </button>
                    <button
                        type="button"
                        data-testid="world-workbench-inspector-toggle"
                        class="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[12px] transition-colors"
                        :class="metadataDraftSliceCount && !inspectorVisible ? 'border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] text-[var(--we-warning)] hover:bg-[var(--we-bg-hover)]' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                        :title="inspectorButtonTitle"
                        @click="inspectorVisible = !inspectorVisible"
                    >
                        <span :class="inspectorVisible ? 'i-lucide-panel-right-close' : 'i-lucide-panel-right-open'" class="h-3.5 w-3.5"></span>
                        {{ t("worldEngine.workbenchPreview.inspector") }}
                    </button>
                    <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] px-3 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="openPreview">
                        <span class="i-lucide-external-link h-3.5 w-3.5"></span>
                        Preview
                    </button>
                    <button type="button" class="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="requestWorkbenchClose">
                        <span class="i-lucide-x h-4 w-4"></span>
                    </button>
                </div>
            </div>
        </template>

        <!-- World Engine 真实工作台主体 -->
        <div class="world-engine-workbench-dialog world-engine-workbench-theme relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--we-bg-canvas)] text-[var(--we-text-main)]">
            <div v-if="error" class="border-b border-[var(--we-danger-border)] bg-[var(--we-danger-soft)] px-4 py-2 text-[13px] text-[var(--we-danger)]">{{ error }}</div>
            <div v-if="notice" class="border-b border-[var(--we-success-border)] bg-[var(--we-success-soft)] px-4 py-2 text-[13px] text-[var(--we-success)]">{{ notice }}</div>

            <div v-if="sliceComposerVisible" data-testid="world-slice-composer" class="absolute inset-3 z-30 flex min-h-0 flex-col overflow-hidden rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)] shadow-2xl">
                <div class="flex h-11 shrink-0 items-center justify-between border-b border-[var(--we-border)] px-4">
                    <div class="flex min-w-0 items-center gap-2">
                        <span class="i-lucide-file-plus-2 h-4 w-4 text-[var(--we-accent)]"></span>
                        <div class="truncate text-[13px] font-semibold text-[var(--we-text-main)]">新建 / 编辑 Slice</div>
                    </div>
                    <button type="button" class="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--we-text-muted)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)]" @click="closeSliceComposer">
                        <span class="i-lucide-x h-4 w-4"></span>
                    </button>
                </div>
                <div class="min-h-0 flex-1 overflow-auto">
                    <WorldEngineMutationEditor
                        :key="sliceComposerEditorKey"
                        :project-path="props.projectPath"
                        :schema="schema"
                        :subjects="worldSubjects"
                        :selected-subject-id="sliceComposerSubjectId"
                        :selected-slice="selectedSlice"
                        :load-slice-key="sliceComposerLoadKey"
                        :new-slice-key="sliceComposerNewKey"
                        :state-result="snapshotSubjects"
                        :used-times="sliceComposerUsedTimes"
                        :busy="workbenchActionBusy"
                        @dirty-change="sliceComposerDirty = $event"
                        @saving-change="sliceComposerSaving = $event"
                        @saved="void handleSliceComposerSaved($event)"
                        @error="setWorkbenchError"
                        @notice="setWorkbenchNotice"
                    />
                </div>
            </div>

            <div class="flex min-h-0 flex-1">
                <WorldEngineWorkbenchPreviewSidebar
                    :selected-subject-ids="selectedSubjectIds"
                    :collapsed="sidebarCollapsed"
                    :reset-key="resetVersion"
                    :schema="workbenchSchema"
                    :width="sidebarWidth"
                    :subject-stats="subjectStats"
                    :subject-system-summaries="subjectSystemSummaries"
                    :subjects="subjects"
                    :value-draft-summaries="valueDraftSummaries"
                    @update:selected-subject-ids="void updateSelectedSubjectIdsForTimeline($event)"
                    @update:width="sidebarWidth = $event"
                    @open-workspace-path="openWorkspacePathFromWorkbench"
                    @toggle-collapsed="sidebarCollapsed = !sidebarCollapsed"
                >
                    <template #actions>
                        <section v-if="pendingSubjectSystemSummaries.length" data-testid="subject-system-sync-panel" class="rounded-md border border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] p-2.5">
                            <div class="flex items-start justify-between gap-2">
                                <div class="min-w-0">
                                    <div class="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--we-warning)]">主体系统待接入</div>
                                    <div class="mt-1 text-[11px] text-[var(--we-text-secondary)]">{{ pendingSubjectSystemSummaries.length }} 个 simulation/subjects 主体还没有 World Engine subject 身份。</div>
                                </div>
                                <span class="rounded bg-[var(--we-bg-panel)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--we-warning)]">{{ pendingSubjectSystemSummaries.length }}</span>
                            </div>
                            <div class="mt-2 flex flex-wrap gap-1">
                                <span v-for="summary in pendingSubjectSystemSummaries.slice(0, 4)" :key="`pending-subject:${summary.subjectId}`" class="rounded border border-[var(--we-warning-border)] bg-[var(--we-bg-panel)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--we-warning)]">{{ summary.subjectId }}</span>
                                <span v-if="pendingSubjectSystemSummaries.length > 4" class="rounded border border-[var(--we-warning-border)] bg-[var(--we-bg-panel)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--we-warning)]">+{{ pendingSubjectSystemSummaries.length - 4 }}</span>
                            </div>
                            <div class="mt-2 rounded border border-[var(--we-warning-border)] bg-[var(--we-bg-panel)] p-2 text-[11px]">
                                <div class="mb-1 flex min-w-0 items-center justify-between gap-2">
                                    <span class="shrink-0 text-[var(--we-text-muted)]">初始化时间</span>
                                    <span class="min-w-0 truncate font-mono text-[var(--we-warning)]">{{ subjectSystemDefaultSyncTime || "未配置" }}</span>
                                </div>
                                <input v-model.trim="subjectSystemSyncTimeOverride" type="text" class="h-7 w-full rounded border border-[var(--we-border)] bg-[var(--we-bg-data)] px-2 font-mono text-[11px] text-[var(--we-text-main)] outline-none transition-colors placeholder:text-[var(--we-text-muted)] focus:border-[var(--we-warning-border)] disabled:opacity-50" :placeholder="subjectSystemDefaultSyncTime || '未配置'" :disabled="workbenchActionBusy" aria-label="同步主体系统初始化时间">
                            </div>
                            <button type="button" class="mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-[var(--we-warning-border)] bg-[var(--we-bg-panel)] px-2 text-[12px] font-medium text-[var(--we-warning)] transition-colors hover:bg-[var(--we-bg-hover)] disabled:opacity-50" :disabled="workbenchActionBusy || !subjectSystemSyncTime" @click="void syncPendingSubjectSystemSubjects()">
                                <span :class="actionBusy ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-link-2'" class="h-3.5 w-3.5"></span>
                                同步主体系统
                            </button>
                        </section>
                        <details class="rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)]" :open="subjectCreatorOpen" @toggle="updateSubjectCreatorOpen">
                            <summary class="cursor-pointer px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--we-text-secondary)]">创建 Subject</summary>
                            <WorldEngineSubjectCreator
                                :project-path="props.projectPath"
                                :schema="schema"
                                :busy="workbenchActionBusy"
                                @created="void handleSubjectCreated($event)"
                                @error="setWorkbenchError"
                                @notice="setWorkbenchNotice"
                            />
                        </details>
                    </template>
                </WorldEngineWorkbenchPreviewSidebar>

                <main class="flex min-w-0 flex-1 flex-col overflow-hidden">
                    <WorldEngineWorkbenchPreviewSliceList
                        :slices="slices"
                        :subjects="subjects"
                        :focused-subject-id="focusedSubjectId"
                        :reset-key="resetVersion"
                        :selected-slice-id="selectedSlice?.id ?? ''"
                        :selected-subject-ids="selectedSubjectIds"
                        :slice-health-filter="sliceHealthFilter"
                        :slice-kind-filter="sliceKindFilter"
                        :slice-review-summaries="sliceReviewSummaries"
                        :review-queue-items="reviewQueueItems"
                        :slice-search="sliceSearch"
                        :subject-filter-mode="subjectFilterMode"
                        :metadata-draft-summaries="metadataDraftSummaries"
                        :value-draft-summaries="valueDraftSummaries"
                        :open-draft-inspector="openInspectorPanel"
                        :expand-draft-editor="expandMutationEditorPanel"
                        :busy="workbenchActionBusy"
                        @clear-subject-filter="clearSubjectFilter"
                        @filter-subject="viewSubjectTimeline"
                        @focus-subject="focusSubject"
                        @focus-review-issue="void focusReviewIssue($event)"
                        @remove-subject-filter="removeSubjectFilter"
                        @select-slice="selectSlice"
                        @update-slice-health-filter="updateSliceHealthFilterForTimeline"
                        @update-slice-kind-filter="updateSliceKindFilterForTimeline"
                        @update-slice-search="updateSliceSearchForTimeline"
                        @update-subject-filter-mode="void updateSubjectFilterModeForTimeline($event)"
                    />
                    <WorldEngineWorkbenchPreviewMutationEditor
                        v-if="selectedSlice"
                        :busy="workbenchActionBusy"
                        :collapsed="mutationEditorCollapsed"
                        :discard-draft-slice-id="draftDiscardSliceId"
                        :discard-draft-version="draftDiscardVersion"
                        :height="mutationEditorHeight"
                        :focused-subject-id="focusedSubjectId"
                        :highlighted-mutation-focus="highlightedMutationFocus"
                        :current-review-queue-index="currentReviewQueueIndex"
                        :reset-key="resetVersion"
                        :review-queue-items="reviewQueueItems"
                        :review-queue-mode="reviewQueueMode"
                        :review-triage-summary="reviewTriageSummary"
                        :schema="workbenchSchema"
                        :selected-subject-ids="selectedSubjectIds"
                        :subject-filter-mode="subjectFilterMode"
                        :slice-health-filter="sliceHealthFilter"
                        :slice-kind-filter="sliceKindFilter"
                        :slice-review-summaries="sliceReviewSummaries"
                        :slice-search="sliceSearch"
                        :slice="selectedSlice"
                        :slices="slices"
                        :subjects="subjects"
                        :previous-snapshot-subjects="previousSnapshotSubjects"
                        :snapshot-subjects="snapshotSubjects"
                        @clear-mutation-focus="clearMutationFocus"
                        @focus-subject="focusSubject"
                        @focus-review-issue="void focusReviewIssue($event)"
                        @update-mutation-value="void saveMutationValuePatch($event)"
                        @update-mutation-values="void saveMutationValuePatches($event)"
                        @update-issue-triage="updateIssueTriage"
                        @update-value-drafts="valueDraftSummaries = $event"
                        @update-review-queue-mode="reviewQueueMode = $event"
                        @update:height="mutationEditorHeight = $event"
                        @toggle-collapsed="mutationEditorCollapsed = !mutationEditorCollapsed"
                        @select-slice="selectSlice"
                    />
                    <div v-else class="flex min-h-0 flex-1 items-center justify-center border-t border-[var(--we-border)] bg-[var(--we-bg-panel)] px-6 text-center">
                        <div class="max-w-xl">
                            <div class="text-[15px] font-semibold text-[var(--we-text-main)]">{{ emptySliceState.title }}</div>
                            <div class="mt-2 text-[13px] text-[var(--we-text-muted)]">{{ emptySliceState.description }}</div>
                            <div v-if="reviewQueueItems.length" data-testid="empty-slice-review-issues" class="mt-4 space-y-2 rounded-md border border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] p-2.5 text-left">
                                <div class="flex flex-wrap items-center justify-between gap-2">
                                    <div class="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-[var(--we-warning)]">
                                        <span class="i-lucide-circle-alert h-3.5 w-3.5 shrink-0"></span>
                                        <span>待处理 issues</span>
                                    </div>
                                    <span class="rounded bg-[var(--we-bg-panel)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--we-warning)]">{{ reviewTriageSummary.open }}/{{ reviewTriageSummary.total }}</span>
                                </div>
                                <button
                                    v-for="item in emptyReviewQueueItems"
                                    :key="`empty-review-issue:${item.key}`"
                                    type="button"
                                    class="grid w-full grid-cols-[28px_minmax(88px,0.65fr)_minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-[var(--we-warning-border)] bg-[var(--we-bg-panel)] px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-[var(--we-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--we-accent-border)]"
                                    :title="`${item.sliceTime || item.sliceId} · ${item.message}`"
                                    @click="void focusReviewIssue(item)"
                                >
                                    <span class="justify-self-start rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold" :class="issueLevel(item.code) === 'E' ? 'border-[var(--we-danger-border)] bg-[var(--we-danger-soft)] text-[var(--we-danger)]' : 'border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] text-[var(--we-warning)]'">{{ issueLevel(item.code) }}</span>
                                    <span class="min-w-0 truncate font-mono text-[var(--we-code-text)]">{{ item.code }}</span>
                                    <span class="min-w-0 truncate text-[var(--we-text-secondary)]">
                                        <span class="font-mono text-[var(--we-text-muted)]">{{ item.sliceTime || item.sliceId || "-" }}</span>
                                        · {{ subjectNameMap.get(item.subjectId) ?? item.subjectId }}
                                        <span class="font-mono text-[var(--we-text-muted)]">· {{ item.attr }}</span>
                                    </span>
                                    <span class="shrink-0 rounded border border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--we-warning)]">{{ issueStatusLabel(item.status) }}</span>
                                </button>
                                <div v-if="hiddenEmptyReviewItemCount" class="rounded-md border border-[var(--we-warning-border)] bg-[var(--we-bg-panel)] px-2 py-1 text-[11px] text-[var(--we-text-muted)]">+{{ hiddenEmptyReviewItemCount }} issues</div>
                            </div>
                            <div v-if="emptySliceState.action === 'seed-demo'" class="mt-4 flex flex-wrap items-center justify-center gap-2">
                                <button type="button" class="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)] px-3 text-[13px] text-[var(--we-text-main)] transition-colors hover:bg-[var(--we-bg-hover)] disabled:opacity-50" :disabled="workbenchActionBusy" @click="openSubjectCreatorPanel">
                                    <span class="i-lucide-user-plus h-4 w-4"></span>
                                    创建 Subject
                                </button>
                                <button type="button" class="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)] px-3 text-[13px] text-[var(--we-text-main)] transition-colors hover:bg-[var(--we-bg-hover)] disabled:opacity-50" :disabled="workbenchActionBusy || !canSeedDemoWorld" :title="demoWorldButtonTitle" @click="void seedDemoWorld()">
                                    <span :class="actionBusy ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-sparkles'" class="h-4 w-4"></span>
                                    一键示例世界
                                </button>
                            </div>
                            <button v-else-if="emptySliceState.action === 'create-subject'" type="button" class="mt-4 inline-flex h-9 items-center gap-2 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)] px-3 text-[13px] text-[var(--we-text-main)] transition-colors hover:bg-[var(--we-bg-hover)] disabled:opacity-50" :disabled="workbenchActionBusy" @click="openSubjectCreatorPanel">
                                <span class="i-lucide-user-plus h-4 w-4"></span>
                                创建 Subject
                            </button>
                            <button v-else-if="emptySliceState.action === 'sync-subject-system'" type="button" class="mt-4 inline-flex h-9 items-center gap-2 rounded-md border border-[var(--we-warning-border)] bg-[var(--we-bg-panel)] px-3 text-[13px] font-medium text-[var(--we-warning)] transition-colors hover:bg-[var(--we-bg-hover)] disabled:opacity-50" :disabled="workbenchActionBusy || !subjectSystemSyncTime" @click="void syncPendingSubjectSystemSubjects()">
                                <span :class="actionBusy ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-link-2'" class="h-4 w-4"></span>
                                同步主体系统
                            </button>
                            <div v-else-if="emptySliceState.action === 'new-slice'" class="mt-4 flex flex-wrap items-center justify-center gap-2">
                                <button type="button" class="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)] px-3 text-[13px] text-[var(--we-text-main)] transition-colors hover:bg-[var(--we-bg-hover)] disabled:opacity-50" :disabled="workbenchActionBusy || !schema" @click="openSliceComposer">
                                    <span class="i-lucide-file-plus-2 h-4 w-4"></span>
                                    新建 Slice
                                </button>
                                <button v-if="selectedSubjectIds.length" type="button" class="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--we-border)] px-3 text-[13px] text-[var(--we-text-secondary)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)] disabled:opacity-50" :disabled="workbenchActionBusy" @click="clearSubjectFilter">
                                    <span class="i-lucide-filter-x h-4 w-4"></span>
                                    清空 subject 过滤
                                </button>
                            </div>
                        </div>
                    </div>
                </main>

                <Transition name="world-inspector">
                    <WorldEngineWorkbenchPreviewInspector
                        v-if="selectedSlice"
                        v-show="inspectorVisible"
                        :apply-button-label="'保存到世界'"
                        :busy="workbenchActionBusy"
                        :discard-draft-slice-id="draftDiscardSliceId"
                        :discard-draft-version="draftDiscardVersion"
                        :metadata-status-suffix="'真实 API 会话草稿'"
                        :full-snapshot-mode="'remote'"
                        :full-snapshot-subjects="fullSnapshotSubjects"
                        :full-snapshot-issues="fullSnapshotIssues"
                        :full-snapshot-loading="fullSnapshotLoading"
                        :full-snapshot-error="fullSnapshotError"
                        :schema="workbenchSchema"
                        :focused-subject-id="focusedSubjectId"
                        :reset-key="resetVersion"
                        :slice="selectedSlice"
                        :subjects="subjects"
                        :subject-system-summaries="subjectSystemSummaries"
                        :snapshot-subjects="snapshotSubjects"
                        :snapshot-issues="snapshotIssues"
                        :width="inspectorWidth"
                        @close="inspectorVisible = false"
                        @focus-subject="focusSubject"
                        @request-full-snapshot="void loadFullSnapshot()"
                        @update-metadata-drafts="metadataDraftSummaries = $event"
                        @update:width="inspectorWidth = $event"
                        @apply-patch="void saveMetadataPatch($event)"
                    />
                </Transition>
                <aside v-if="selectedSlice && !inspectorVisible" data-testid="world-inspector-restore-rail" class="flex w-10 shrink-0 flex-col items-center border-l border-[var(--we-border)] bg-[var(--we-bg-panel)] py-2">
                    <button type="button" class="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--we-text-muted)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)]" title="展开检查器" @click="inspectorVisible = true">
                        <span class="i-lucide-panel-right-open h-4 w-4"></span>
                    </button>
                    <span class="mt-3 [writing-mode:vertical-rl] text-[11px] tracking-[0.16em] text-[var(--we-text-muted)]">{{ t("worldEngine.workbenchPreview.inspector") }}</span>
                </aside>
            </div>
        </div>
    </Dialog>
</template>

<style scoped>
.world-engine-workbench-theme {
    /* World Engine 语义色从 IDE 当前主题派生，避免覆盖 sepia / dark 等项目主题。 */
    --we-bg-canvas: var(--bg-main);
    --we-bg-panel: var(--bg-panel);
    --we-bg-subtle: var(--bg-sidebar);
    --we-bg-muted: color-mix(in srgb, var(--bg-sidebar) 78%, var(--bg-panel));
    --we-bg-hover: var(--bg-hover);
    --we-bg-active: var(--bg-active);
    --we-bg-data: color-mix(in srgb, var(--bg-panel) 82%, var(--bg-main));
    --we-border: var(--border-color);
    --we-border-strong: var(--border-color-hover);
    --we-text-main: var(--text-main);
    --we-text-secondary: var(--text-secondary);
    --we-text-muted: var(--text-muted);
    --we-accent: var(--accent-main);
    --we-accent-strong: var(--accent-text);
    --we-accent-soft: var(--accent-bg);
    --we-accent-border: color-mix(in srgb, var(--accent-main) 46%, var(--border-color));
    --we-info: var(--status-info);
    --we-info-border: var(--status-info-border);
    --we-info-soft: var(--status-info-bg);
    --we-success: var(--status-success);
    --we-success-border: var(--status-success-border);
    --we-success-soft: var(--status-success-bg);
    --we-warning: var(--status-warning);
    --we-warning-border: var(--status-warning-border);
    --we-warning-soft: var(--status-warning-bg);
    --we-danger: var(--status-danger);
    --we-danger-border: var(--status-danger-border);
    --we-danger-soft: var(--status-danger-bg);
    --we-code-bg: var(--source-bg);
    --we-code-text: var(--source-text);
}

.world-inspector-enter-active,
.world-inspector-leave-active {
    transition: margin-right 0.25s ease, transform 0.25s ease, opacity 0.25s ease;
}

.world-inspector-enter-from,
.world-inspector-leave-to {
    margin-right: -400px;
    transform: translateX(18px);
    opacity: 0;
}
</style>
