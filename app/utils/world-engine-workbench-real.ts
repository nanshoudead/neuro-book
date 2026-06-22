import type {
    SubjectStateDto,
    WorkbenchJsonValue,
    WorldIssueDto,
    WorldSliceDto,
    WorldSliceMutationDto,
    WorldSubjectDto,
} from "nbook/app/components/novel-ide/world-engine/world-engine-workbench.types";
import type {
    WorldWorkbenchPreviewIssueStatus,
    WorldWorkbenchPreviewMutationValuePatch,
    WorldWorkbenchPreviewReviewQueueItem,
    WorldWorkbenchPreviewSlice,
    WorldWorkbenchPreviewSubjectSystemPath,
    WorldWorkbenchPreviewSubjectSystemSummary,
} from "nbook/app/components/novel-ide/world-engine/workbench-preview/world-engine-workbench-preview.types";
import type {ProjectRagOverviewDto, ProjectRagSubjectSummaryDto} from "nbook/shared/dto/project-rag.dto";

export type WorldWorkbenchEditSliceBody = {
    time: string;
    title: string;
    summary: string;
    kind: string;
    mutations: WorldSliceMutationDto[];
};

export type WorldWorkbenchTransientIssue = {
    attr: string;
    code: WorldIssueDto["code"];
    issueIndex: number;
    key: string;
    message: string;
    sliceId: string;
    sliceTime: string;
    sliceTitle: string;
    subjectId: string;
};

export const worldWorkbenchSubjectSystemAttrs = [
    "sourcePath",
    "legacyKind",
    "controlledBy",
    "profile",
    "canonicalSource",
    "subjectFiles",
    "actorImportPath",
    "leaderOnlyPath",
    "directStatePath",
    "ragIndexSources",
    "eventCount",
    "memoryCount",
    "subjectSystemVersion",
];

const ignoredSubjectSystemIds = new Set(["sample-npc"]);

/** 将真实 API slice 规范成 Workbench 组件需要的强数组结构。 */
export function normalizeWorldWorkbenchSlices(slices: WorldSliceDto[]): WorldWorkbenchPreviewSlice[] {
    return slices.map((slice) => ({
        ...slice,
        issues: slice.issues ?? [],
        mutations: slice.mutations ?? [],
    }));
}

/** 把懒加载的 slice 合并进当前时间线，尽量保留可见时间顺序。 */
export function mergeWorldWorkbenchTimelineSlice(slices: WorldWorkbenchPreviewSlice[], loadedSlice: WorldWorkbenchPreviewSlice): WorldWorkbenchPreviewSlice[] {
    const withoutLoaded = slices.filter((slice) => slice.id !== loadedSlice.id);
    if (!loadedSlice.previousTime) {
        return [loadedSlice, ...withoutLoaded];
    }
    const previousIndex = withoutLoaded.findIndex((slice) => slice.time === loadedSlice.previousTime);
    if (previousIndex < 0) {
        return [...withoutLoaded, loadedSlice];
    }
    return [
        ...withoutLoaded.slice(0, previousIndex + 1),
        loadedSlice,
        ...withoutLoaded.slice(previousIndex + 1),
    ];
}

/** 构造 editSlice body：metadata 和 value patch 都必须保留完整 mutations。 */
export function buildWorldWorkbenchEditSliceBody(
    slice: WorldWorkbenchPreviewSlice,
    metadata: Partial<Pick<WorldWorkbenchPreviewSlice, "time" | "title" | "summary" | "kind">> = {},
    valuePatches: WorldWorkbenchPreviewMutationValuePatch[] = [],
): WorldWorkbenchEditSliceBody {
    const patchMap = new Map(valuePatches.map((patch) => [patch.mutationIndex, patch.value]));
    return {
        time: metadata.time ?? slice.time,
        title: metadata.title ?? slice.title,
        summary: metadata.summary ?? slice.summary,
        kind: metadata.kind ?? slice.kind,
        mutations: slice.mutations.map((mutation, index) => patchMap.has(index) ? {
            ...mutation,
            value: patchMap.get(index),
        } : {...mutation}),
    };
}

/** 从当前 state attrs 提取主体系统摘要；不读取 subject 源文件全文。 */
export function buildWorldWorkbenchSubjectSystemSummaries(subjects: SubjectStateDto[]): WorldWorkbenchPreviewSubjectSystemSummary[] {
    return subjects.map((subject) => ({
        actorImportPath: stringAttr(subject.attrs.actorImportPath),
        canonicalSource: stringAttr(subject.attrs.canonicalSource),
        controlledBy: stringAttr(subject.attrs.controlledBy),
        directStatePath: stringAttr(subject.attrs.directStatePath),
        displayName: "",
        eventCount: intAttr(subject.attrs.eventCount),
        leaderOnlyPath: stringAttr(subject.attrs.leaderOnlyPath),
        legacyKind: stringAttr(subject.attrs.legacyKind),
        memoryCount: intAttr(subject.attrs.memoryCount),
        mindFileExists: false,
        profile: stringAttr(subject.attrs.profile),
        ragIndexSources: objectPathEntries(subject.attrs.ragIndexSources),
        sourcePath: stringAttr(subject.attrs.sourcePath),
        sourceStatuses: [],
        stateFileExists: Boolean(stringAttr(subject.attrs.directStatePath)),
        subjectFileExists: Boolean(stringAttr(subject.attrs.leaderOnlyPath)),
        subjectFiles: objectPathEntries(subject.attrs.subjectFiles),
        subjectId: subject.subjectId,
        subjectSystemVersion: stringAttr(subject.attrs.subjectSystemVersion),
        syncStatus: "orphan-world-subject" as const,
        soulFileExists: Boolean(stringAttr(subject.attrs.actorImportPath)),
    })).filter((summary) => Boolean(summary.subjectFiles.length || summary.actorImportPath || summary.leaderOnlyPath || summary.ragIndexSources.length));
}

/** 从真实 simulation/subjects overview 构造主体系统摘要；这是 Workbench 的主体系统事实源。 */
export function buildWorldWorkbenchSubjectSystemSummariesFromRagOverview(input: {
    overview: ProjectRagOverviewDto;
    worldSubjects: WorldSubjectDto[];
}): WorldWorkbenchPreviewSubjectSystemSummary[] {
    const worldSubjectIds = new Set(input.worldSubjects.map((subject) => subject.id));
    return visibleRagSubjects(input.overview.subjects).map((subject) => ({
        actorImportPath: `${subject.subjectPath}/soul.md`,
        canonicalSource: subject.metadata.canonicalSource ?? "",
        controlledBy: subject.metadata.controlledBy ?? "",
        directStatePath: `${subject.subjectPath}/state.md`,
        displayName: subject.metadata.name ?? "",
        eventCount: subject.eventCount,
        leaderOnlyPath: `${subject.subjectPath}/subject.md`,
        legacyKind: subject.metadata.kind ?? "",
        memoryCount: subject.memoryCount,
        mindFileExists: subject.mindFileExists,
        profile: subject.metadata.profile ?? "",
        ragIndexSources: [
            {label: "events", path: `${subject.subjectPath}/events.jsonl`},
            {label: "memory", path: `${subject.subjectPath}/memory.jsonl`},
        ],
        sourcePath: subject.subjectPath,
        sourceStatuses: subject.sourceStatuses,
        stateFileExists: subject.stateFileExists,
        subjectFileExists: subject.subjectFileExists,
        subjectFiles: [
            {label: "subject", path: `${subject.subjectPath}/subject.md`},
            {label: "soul", path: `${subject.subjectPath}/soul.md`},
            {label: "mind", path: `${subject.subjectPath}/mind.md`},
            {label: "state", path: `${subject.subjectPath}/state.md`},
            {label: "events", path: `${subject.subjectPath}/events.jsonl`},
            {label: "memory", path: `${subject.subjectPath}/memory.jsonl`},
        ],
        subjectId: subject.metadata.id ?? subject.subjectId,
        subjectSystemVersion: "simulation-subjects-overview",
        syncStatus: worldSubjectIds.has(subject.metadata.id ?? subject.subjectId) ? "linked" : "pending-world-subject",
        soulFileExists: subject.soulFileExists,
    }));
}

/** 左栏 subject 列表以 World Engine subjects 为底，并补上尚未注册到 World Engine 的 simulation subjects。 */
export function mergeWorldWorkbenchSubjectsWithSubjectSystem(input: {
    overview: ProjectRagOverviewDto | null;
    worldSubjects: WorldSubjectDto[];
}): WorldSubjectDto[] {
    if (!input.overview) {
        return input.worldSubjects;
    }
    const merged = new Map(input.worldSubjects.map((subject) => [subject.id, {...subject}]));
    for (const subject of visibleRagSubjects(input.overview.subjects)) {
        const id = subject.metadata.id ?? subject.subjectId;
        const existing = merged.get(id);
        if (existing) {
            merged.set(id, {
                ...existing,
                name: subject.metadata.name ?? existing.name,
            });
            continue;
        }
        merged.set(id, {
            id,
            name: subject.metadata.name ?? id,
            type: "character",
        });
    }
    return [...merged.values()];
}

function visibleRagSubjects(subjects: ProjectRagSubjectSummaryDto[]): ProjectRagSubjectSummaryDto[] {
    return subjects.filter((subject) => !ignoredSubjectSystemIds.has(subject.subjectId));
}

/** 为真实持久 issue 构造稳定 key。 */
export function persistedWorldWorkbenchIssueKey(sliceId: string, identityOccurrence: number, issue: Pick<WorldIssueDto, "subjectId" | "attr" | "code" | "message">): string {
    return `persisted:${worldWorkbenchIssueIdentity({sliceId, ...issue})}:${identityOccurrence}`;
}

/** 用于 transient issue 去重的业务身份。 */
export function worldWorkbenchIssueIdentity(item: Pick<WorldWorkbenchReviewIssueSource, "sliceId" | "subjectId" | "attr" | "code" | "message">): string {
    return `${item.sliceId}:${item.subjectId}:${item.attr}:${item.code}:${item.message}`;
}

type WorldWorkbenchReviewIssueSource = {
    attr: string;
    code: WorldIssueDto["code"];
    identity: string;
    issueIndex: number;
    key: string;
    message: string;
    sliceId: string;
    sliceTime: string;
    sliceTitle: string;
    subjectId: string;
};

/** 合并持久 slice issue 和本次操作 transient issue，triage 只在前端会话态生效。 */
export function buildWorldWorkbenchReviewQueueItems(input: {
    slices: WorldWorkbenchPreviewSlice[];
    transientIssues: WorldWorkbenchTransientIssue[];
    triageStatus: Map<string, WorldWorkbenchPreviewIssueStatus>;
}): WorldWorkbenchPreviewReviewQueueItem[] {
    const persistedIdentityCounts = new Map<string, number>();
    const persisted = input.slices.flatMap((slice) => (slice.issues ?? []).map((issue, issueIndex): WorldWorkbenchReviewIssueSource => ({
        attr: issue.attr,
        code: issue.code,
        identity: worldWorkbenchIssueIdentity({...issue, sliceId: slice.id}),
        issueIndex,
        key: (() => {
            const identity = worldWorkbenchIssueIdentity({...issue, sliceId: slice.id});
            const occurrence = persistedIdentityCounts.get(identity) ?? 0;
            persistedIdentityCounts.set(identity, occurrence + 1);
            return persistedWorldWorkbenchIssueKey(slice.id, occurrence, issue);
        })(),
        message: issue.message,
        sliceId: slice.id,
        sliceTime: slice.time,
        sliceTitle: slice.title,
        subjectId: issue.subjectId,
    })));
    const persistedIdentities = new Set(persisted.map(worldWorkbenchIssueIdentity));
    const transient = input.transientIssues
        .filter((issue) => !persistedIdentities.has(worldWorkbenchIssueIdentity(issue)))
        .map((issue): WorldWorkbenchReviewIssueSource => ({
            ...issue,
            identity: worldWorkbenchIssueIdentity(issue),
        }));
    return [...persisted, ...transient].map((issue) => ({
        ...issue,
        status: input.triageStatus.get(issue.key) ?? input.triageStatus.get(issue.identity) ?? "open",
    }));
}

function stringAttr(value: WorkbenchJsonValue | undefined): string {
    return typeof value === "string" ? value : "";
}

function intAttr(value: WorkbenchJsonValue | undefined): number | null {
    return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function objectPathEntries(value: WorkbenchJsonValue | undefined): WorldWorkbenchPreviewSubjectSystemPath[] {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return [];
    }
    return Object.entries(value)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
        .map(([label, path]) => ({label, path}));
}
