import type {
    SubjectStateDto,
    WorkbenchJsonValue,
    WorldSliceMutationDto,
} from "nbook/app/components/novel-ide/world-engine/world-engine-workbench.types";
import type {
    WorldWorkbenchPreviewMutationValuePatch,
    WorldWorkbenchPreviewSchema,
    WorldWorkbenchPreviewSlice,
    WorldWorkbenchPreviewSnapshot,
    WorldWorkbenchPreviewSubject,
} from "nbook/app/components/novel-ide/world-engine/workbench-preview/world-engine-workbench-preview.types";

type JsonObjectValue = Record<string, WorkbenchJsonValue>;

export type ApplyWorkbenchPreviewMutationPatchInput = {
    patch: WorldWorkbenchPreviewMutationValuePatch;
    schema: WorldWorkbenchPreviewSchema;
    slices: WorldWorkbenchPreviewSlice[];
    subjects: WorldWorkbenchPreviewSubject[];
};

export type ApplyWorkbenchPreviewMutationPatchResult = {
    label: string;
    slices: WorldWorkbenchPreviewSlice[];
    snapshots: WorldWorkbenchPreviewSnapshot[];
};

/** 更新 mock mutation value，并从 schema default 重新 reduce 出全部 snapshots。 */
export function applyWorkbenchPreviewMutationPatch(input: ApplyWorkbenchPreviewMutationPatchInput): ApplyWorkbenchPreviewMutationPatchResult | null {
    const targetSlice = input.slices.find((slice) => slice.id === input.patch.sliceId);
    const mutation = targetSlice?.mutations[input.patch.mutationIndex];
    if (!targetSlice || !mutation) {
        return null;
    }
    const nextSlices = input.slices.map((slice) => slice.id === input.patch.sliceId ? {
        ...slice,
        mutations: slice.mutations.map((item, index) => index === input.patch.mutationIndex ? {...item, value: input.patch.value} : item),
    } : slice);
    return {
        label: `${mutation.subjectId}.${mutation.attr}`,
        slices: nextSlices,
        snapshots: reduceWorkbenchPreviewSnapshots(nextSlices, input.subjects, input.schema),
    };
}

/** 从 subject 身份、schema default 和 slice mutations 构造每个 slice 时刻的 mock snapshot。 */
export function reduceWorkbenchPreviewSnapshots(slices: WorldWorkbenchPreviewSlice[], subjects: WorldWorkbenchPreviewSubject[], schema: WorldWorkbenchPreviewSchema): WorldWorkbenchPreviewSnapshot[] {
    const schemaTypeMap = new Map(schema.subjectTypes.map((subjectType) => [subjectType.type, subjectType]));
    const subjectStates = subjects.map<SubjectStateDto>((subject) => {
        const subjectType = schemaTypeMap.get(subject.type);
        const attrs: JsonObjectValue = {};
        for (const attr of subjectType?.attrs ?? []) {
            if (attr.default !== undefined) {
                attrs[attr.name] = cloneJsonValue(attr.default);
            }
        }
        return {
            subjectId: subject.id,
            type: subject.type,
            attrs,
        };
    });
    const subjectMap = new Map(subjectStates.map((subject) => [subject.subjectId, subject]));
    return slices.map((slice) => {
        for (const mutation of slice.mutations) {
            const subject = subjectMap.get(mutation.subjectId);
            if (subject) {
                applyMutationToSubject(subject, mutation);
            }
        }
        return {
            sliceId: slice.id,
            subjects: cloneSnapshotSubjects(subjectStates),
        };
    });
}

/** 深拷贝 snapshot subjects，避免重算时污染旧状态。 */
function cloneSnapshotSubjects(subjects: SubjectStateDto[]): SubjectStateDto[] {
    return JSON.parse(JSON.stringify(subjects)) as SubjectStateDto[];
}

/** 深拷贝 JSON 值，避免 schema default 的数组 / 对象被后续 mutation 共享污染。 */
function cloneJsonValue(value: WorkbenchJsonValue): WorkbenchJsonValue {
    return JSON.parse(JSON.stringify(value)) as WorkbenchJsonValue;
}

/** 在 mock snapshot subject 上应用一条 mutation。 */
function applyMutationToSubject(subject: SubjectStateDto, mutation: WorldSliceMutationDto): void {
    const value = mutation.value ?? "";
    const current = readAttrPath(subject.attrs, mutation.attr);
    if (mutation.op === "set") {
        writeAttrPath(subject.attrs, mutation.attr, value);
        return;
    }
    if (mutation.op === "unset") {
        deleteAttrPath(subject.attrs, mutation.attr);
        return;
    }
    if (mutation.op === "add") {
        writeAttrPath(subject.attrs, mutation.attr, typeof current === "number" && typeof value === "number" ? current + value : value);
        return;
    }
    if (mutation.op === "listAppend") {
        writeAttrPath(subject.attrs, mutation.attr, [...arrayValue(current), value]);
        return;
    }
    if (mutation.op === "collectionAdd") {
        const nextValues = arrayValue(current);
        if (!nextValues.some((item) => stableValueKey(item) === stableValueKey(value))) {
            nextValues.push(value);
        }
        writeAttrPath(subject.attrs, mutation.attr, nextValues);
        return;
    }
    if (mutation.op === "collectionRemove") {
        writeAttrPath(subject.attrs, mutation.attr, arrayValue(current).filter((item) => stableValueKey(item) !== stableValueKey(value)));
    }
}

/** 读取点分 attr 路径。 */
function readAttrPath(attrs: JsonObjectValue, attr: string): WorkbenchJsonValue | undefined {
    const parts = attr.split(".").filter(Boolean);
    let cursor: WorkbenchJsonValue | undefined = attrs;
    for (const part of parts) {
        if (!isJsonObject(cursor)) {
            return undefined;
        }
        cursor = cursor[part];
    }
    return cursor;
}

/** 写入点分 attr 路径。 */
function writeAttrPath(attrs: JsonObjectValue, attr: string, value: WorkbenchJsonValue): void {
    const parts = attr.split(".").filter(Boolean);
    if (!parts.length) {
        return;
    }
    let cursor: JsonObjectValue = attrs;
    for (let index = 0; index < parts.length - 1; index += 1) {
        const part = parts[index];
        if (!part) {
            continue;
        }
        const next = cursor[part];
        if (!isJsonObject(next)) {
            cursor[part] = {};
        }
        cursor = cursor[part] as JsonObjectValue;
    }
    const last = parts[parts.length - 1];
    if (last) {
        cursor[last] = value;
    }
}

/** 删除点分 attr 路径。 */
function deleteAttrPath(attrs: JsonObjectValue, attr: string): void {
    const parts = attr.split(".").filter(Boolean);
    if (!parts.length) {
        return;
    }
    let cursor: JsonObjectValue = attrs;
    for (let index = 0; index < parts.length - 1; index += 1) {
        const part = parts[index];
        const next = part ? cursor[part] : undefined;
        if (!isJsonObject(next)) {
            return;
        }
        cursor = next;
    }
    const last = parts[parts.length - 1];
    if (last) {
        delete cursor[last];
    }
}

/** 判断 JSON 值是否为可写入属性的对象。 */
function isJsonObject(value: WorkbenchJsonValue | undefined): value is JsonObjectValue {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** 将当前值安全视为数组，用于 list / collection 预览重算。 */
function arrayValue(value: WorkbenchJsonValue | undefined): WorkbenchJsonValue[] {
    return Array.isArray(value) ? [...value] : [];
}

/** collection 去重使用稳定 JSON 文本。 */
function stableValueKey(value: WorkbenchJsonValue): string {
    return JSON.stringify(value);
}
