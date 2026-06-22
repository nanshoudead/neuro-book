import type {
    WorldWorkbenchPreviewSlice,
    WorldWorkbenchPreviewSliceHealthFilter,
    WorldWorkbenchPreviewSliceReviewSummary,
    WorldWorkbenchPreviewSubjectFilterMode,
} from "nbook/app/components/novel-ide/world-engine/workbench-preview/world-engine-workbench-preview.types";

export type WorkbenchPreviewSliceFilterInput = {
    selectedSubjectIds: string[];
    slice: WorldWorkbenchPreviewSlice;
    sliceHealthFilter: WorldWorkbenchPreviewSliceHealthFilter;
    sliceKindFilter: string;
    sliceReviewSummary: WorldWorkbenchPreviewSliceReviewSummary | undefined;
    sliceSearch: string;
    subjectFilterMode: WorldWorkbenchPreviewSubjectFilterMode;
    metadataDraftCount?: number;
    valueDraftCount?: number;
};

/** 判断切片是否命中完整 Slice List 可见过滤。 */
export function matchesWorkbenchPreviewSliceFilter(input: WorkbenchPreviewSliceFilterInput): boolean {
    const keyword = input.sliceSearch.trim().toLowerCase();
    return matchesWorkbenchPreviewSubjectFilter(input.slice, input.selectedSubjectIds, input.subjectFilterMode)
        && matchesWorkbenchPreviewKindFilter(input.slice, input.sliceKindFilter)
        && matchesWorkbenchPreviewHealthFilter(input.slice, input.sliceHealthFilter, input.sliceReviewSummary, (input.valueDraftCount ?? 0) + (input.metadataDraftCount ?? 0))
        && matchesWorkbenchPreviewKeywordFilter(input.slice, keyword);
}

/** 判断切片是否命中 subject any/all 过滤。 */
export function matchesWorkbenchPreviewSubjectFilter(
    slice: WorldWorkbenchPreviewSlice,
    selectedSubjectIds: string[],
    subjectFilterMode: WorldWorkbenchPreviewSubjectFilterMode,
): boolean {
    if (!selectedSubjectIds.length) {
        return true;
    }
    const touched = new Set(slice.mutations.map((mutation) => mutation.subjectId));
    if (subjectFilterMode === "all") {
        return selectedSubjectIds.every((subjectId) => touched.has(subjectId));
    }
    return selectedSubjectIds.some((subjectId) => touched.has(subjectId));
}

/** 判断切片是否命中 kind 过滤。 */
export function matchesWorkbenchPreviewKindFilter(slice: WorldWorkbenchPreviewSlice, sliceKindFilter: string): boolean {
    return sliceKindFilter === "all" || slice.kind === sliceKindFilter;
}

/** 判断切片是否命中 open / done / clean 过滤。 */
export function matchesWorkbenchPreviewHealthFilter(
    slice: WorldWorkbenchPreviewSlice,
    sliceHealthFilter: WorldWorkbenchPreviewSliceHealthFilter,
    sliceReviewSummary: WorldWorkbenchPreviewSliceReviewSummary | undefined,
    draftCount = 0,
): boolean {
    if (sliceHealthFilter === "all") {
        return true;
    }
    if (sliceHealthFilter === "draft") {
        return draftCount > 0;
    }
    const total = sliceReviewSummary?.total ?? slice.issues?.length ?? 0;
    if (sliceHealthFilter === "clean") {
        return total === 0;
    }
    if (sliceHealthFilter === "done") {
        return total > 0 && (sliceReviewSummary?.open ?? total) === 0;
    }
    return (sliceReviewSummary?.open ?? total) > 0;
}

/** 判断切片是否命中搜索关键词。 */
export function matchesWorkbenchPreviewKeywordFilter(slice: WorldWorkbenchPreviewSlice, keyword: string): boolean {
    if (!keyword) {
        return true;
    }
    const mutationText = slice.mutations.map((mutation) => [mutation.subjectId, mutation.attr, mutation.op, "value" in mutation ? JSON.stringify(mutation.value) : ""].join(" ")).join(" ");
    return [slice.id, slice.time, slice.title, slice.summary, slice.kind, mutationText].join(" ").toLowerCase().includes(keyword);
}
