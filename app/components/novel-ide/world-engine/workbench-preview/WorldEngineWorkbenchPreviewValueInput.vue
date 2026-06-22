<script setup lang="ts">
import {computed} from "vue";
import type {
    SubjectStateDto,
    WorkbenchJsonValue,
    WorldSliceMutationDto,
} from "nbook/app/components/novel-ide/world-engine/world-engine-workbench.types";
import {formatWorkbenchPreviewValue} from "nbook/app/utils/world-engine-workbench-preview-value";
import type {
    WorldWorkbenchPreviewSchema,
    WorldWorkbenchPreviewSubject,
} from "nbook/app/components/novel-ide/world-engine/workbench-preview/world-engine-workbench-preview.types";

type PreviewSchemaAttr = WorldWorkbenchPreviewSchema["subjectTypes"][number]["attrs"][number];
type ValueInputKind = "boolean" | "collectionItem" | "enum" | "json" | "number" | "ref" | "text";
type ValueOption = {
    label: string;
    value: string;
};

const props = defineProps<{
    modelValue: string;
    mutation: WorldSliceMutationDto;
    schema: WorldWorkbenchPreviewSchema;
    snapshotSubjects: SubjectStateDto[];
    subjects: WorldWorkbenchPreviewSubject[];
}>();

const emit = defineEmits<{
    (e: "submit"): void;
    (e: "update:modelValue", value: string): void;
}>();

const draft = computed({
    get: () => props.modelValue,
    set: (value: string) => emit("update:modelValue", value),
});
const attrSchema = computed(() => resolveAttrSchema(props.mutation));
const inputKind = computed<ValueInputKind>(() => resolveInputKind(props.mutation, attrSchema.value));
const refSubjects = computed(() => {
    const refType = refSubjectType(attrSchema.value?.type ?? attrSchema.value?.itemType);
    if (!refType) {
        return [];
    }
    return props.subjects.filter((subject) => subject.type === refType);
});
const enumOptions = computed(() => (attrSchema.value?.enum ?? []).map((value) => ({
    label: formatWorkbenchPreviewValue(value),
    value: formatWorkbenchPreviewValue(value),
})));
const collectionItemOptions = computed<ValueOption[]>(() => {
    const stateValue = props.snapshotSubjects.find((subject) => subject.subjectId === props.mutation.subjectId)?.attrs;
    const values = arrayValue(stateValue ? readAttrPath(stateValue, props.mutation.attr) : undefined);
    if (props.mutation.value !== undefined) {
        values.unshift(props.mutation.value);
    }
    const seen = new Set<string>();
    return values.flatMap((value) => {
        const optionValue = formatWorkbenchPreviewValue(value);
        if (seen.has(optionValue)) {
            return [];
        }
        seen.add(optionValue);
        return [{
            label: formatOptionLabel(optionValue),
            value: optionValue,
        }];
    });
});

/** 根据 mutation 的 subject type 和 attr path 找到对应 schema attr。 */
function resolveAttrSchema(mutation: WorldSliceMutationDto): PreviewSchemaAttr | null {
    const subject = props.subjects.find((item) => item.id === mutation.subjectId);
    const subjectType = props.schema.subjectTypes.find((item) => item.type === subject?.type);
    const [rootAttr, ...nestedAttrs] = mutation.attr.split(".").filter(Boolean);
    let attr = subjectType?.attrs.find((item) => item.name === rootAttr) ?? null;
    for (const nestedAttr of nestedAttrs) {
        const nextAttr = attr?.fields?.[nestedAttr] ?? null;
        if (!nextAttr) {
            break;
        }
        attr = nextAttr;
    }
    return attr;
}

/** 根据 schema attr 和当前 value 选择最贴近语义的编辑控件。 */
function resolveInputKind(mutation: WorldSliceMutationDto, attr: PreviewSchemaAttr | null): ValueInputKind {
    if (mutation.op === "collectionRemove") {
        return "collectionItem";
    }
    if (attr?.enum?.length) {
        return "enum";
    }
    if (attr?.kind === "object" && !attr.itemType) {
        return "json";
    }
    if (mutation.value && typeof mutation.value === "object") {
        return "json";
    }
    const valueType = attr?.type ?? attr?.itemType;
    if (valueType === "bool") {
        return "boolean";
    }
    if (valueType === "int" || valueType === "float" || typeof mutation.value === "number") {
        return "number";
    }
    if (refSubjectType(valueType)) {
        return "ref";
    }
    return "text";
}

/** 从 ref(location) 这类 schema type 中解析目标 subject type。 */
function refSubjectType(valueType: string | undefined): string {
    return valueType?.match(/^ref\((.+)\)$/)?.[1] ?? "";
}

/** 读取点分 attr 路径，用于从当前 snapshot 中找 collection 候选。 */
function readAttrPath(attrs: Record<string, WorkbenchJsonValue>, attr: string): WorkbenchJsonValue | undefined {
    const parts = attr.split(".").filter(Boolean);
    let cursor: WorkbenchJsonValue | undefined = attrs;
    for (const part of parts) {
        if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) {
            return undefined;
        }
        cursor = cursor[part];
    }
    return cursor;
}

/** 将 JSON 值安全视为数组。 */
function arrayValue(value: WorkbenchJsonValue | undefined): WorkbenchJsonValue[] {
    return Array.isArray(value) ? [...value] : [];
}

/** 给候选值补一层 subject name，方便用户识别 ref value。 */
function formatOptionLabel(value: string): string {
    const subjectId = value.match(/^subject:\/\/(.+)$/)?.[1];
    const subject = subjectId ? props.subjects.find((item) => item.id === subjectId) : null;
    return subject ? `${subject.name || subject.id} · ${subject.id}` : value;
}
</script>

<template>
    <!-- World Engine Workbench value 输入：按 schema 选择控件 -->
    <select
        v-if="inputKind === 'boolean'"
        v-model="draft"
        class="h-7 w-full min-w-0 rounded border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-2 font-mono text-[11px] text-[var(--we-text-main)] outline-none transition-colors focus:border-[var(--we-accent-border)] focus:bg-[var(--we-bg-panel)]"
        @keydown.enter.prevent="emit('submit')"
    >
        <option value="true">true</option>
        <option value="false">false</option>
    </select>
    <select
        v-else-if="inputKind === 'collectionItem'"
        v-model="draft"
        class="h-7 w-full min-w-0 rounded border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-2 font-mono text-[11px] text-[var(--we-text-main)] outline-none transition-colors focus:border-[var(--we-accent-border)] focus:bg-[var(--we-bg-panel)]"
        @keydown.enter.prevent="emit('submit')"
    >
        <option v-if="!collectionItemOptions.length" value="">无候选项</option>
        <option v-for="option in collectionItemOptions" :key="`value-collection:${props.mutation.subjectId}:${props.mutation.attr}:${option.value}`" :value="option.value">{{ option.label }}</option>
    </select>
    <select
        v-else-if="inputKind === 'ref'"
        v-model="draft"
        class="h-7 w-full min-w-0 rounded border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-2 font-mono text-[11px] text-[var(--we-text-main)] outline-none transition-colors focus:border-[var(--we-accent-border)] focus:bg-[var(--we-bg-panel)]"
        @keydown.enter.prevent="emit('submit')"
    >
        <option value="">空值</option>
        <option v-for="subject in refSubjects" :key="`value-ref:${props.mutation.subjectId}:${props.mutation.attr}:${subject.id}`" :value="`subject://${subject.id}`">
            {{ subject.name || subject.id }} · {{ subject.id }}
        </option>
    </select>
    <select
        v-else-if="inputKind === 'enum'"
        v-model="draft"
        class="h-7 w-full min-w-0 rounded border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-2 font-mono text-[11px] text-[var(--we-text-main)] outline-none transition-colors focus:border-[var(--we-accent-border)] focus:bg-[var(--we-bg-panel)]"
        @keydown.enter.prevent="emit('submit')"
    >
        <option v-for="option in enumOptions" :key="`value-enum:${props.mutation.subjectId}:${props.mutation.attr}:${option.value}`" :value="option.value">{{ option.label }}</option>
    </select>
    <input
        v-else-if="inputKind === 'number'"
        v-model="draft"
        class="h-7 w-full min-w-0 rounded border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-2 font-mono text-[11px] text-[var(--we-text-main)] outline-none transition-colors focus:border-[var(--we-accent-border)] focus:bg-[var(--we-bg-panel)]"
        :step="attrSchema?.type === 'float' ? '0.1' : '1'"
        :title="formatWorkbenchPreviewValue(props.mutation.value)"
        type="number"
        @keydown.enter.prevent="emit('submit')"
    >
    <textarea
        v-else-if="inputKind === 'json'"
        v-model="draft"
        class="min-h-16 w-full min-w-0 resize-y rounded border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-2 py-1.5 font-mono text-[11px] leading-5 text-[var(--we-text-main)] outline-none transition-colors focus:border-[var(--we-accent-border)] focus:bg-[var(--we-bg-panel)]"
        :title="formatWorkbenchPreviewValue(props.mutation.value)"
        @keydown.ctrl.enter.prevent="emit('submit')"
    ></textarea>
    <input
        v-else
        v-model="draft"
        class="h-7 w-full min-w-0 rounded border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-2 font-mono text-[11px] text-[var(--we-text-main)] outline-none transition-colors focus:border-[var(--we-accent-border)] focus:bg-[var(--we-bg-panel)]"
        :title="formatWorkbenchPreviewValue(props.mutation.value)"
        @keydown.enter.prevent="emit('submit')"
    >
</template>
