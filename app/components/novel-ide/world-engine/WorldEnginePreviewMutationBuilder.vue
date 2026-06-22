<script setup lang="ts">
import {computed, watch} from "vue";
import {collectionRemoveValueOptions, type WorldMutationOp, type WorldPreviewSchemaAttr, type WorldPreviewStateSubject} from "nbook/app/utils/world-engine-preview";

type PreviewMutationBuilderModel = {
    subjectId: string;
    attr: string;
    op: WorldMutationOp;
    value: string;
};

type PreviewSubjectOption = {
    id: string;
    type: string;
};

const props = defineProps<{
    builder: PreviewMutationBuilderModel;
    subjects: PreviewSubjectOption[];
    subjectFormId: string;
    subjectTypeLabel: string;
    builderAttrs: WorldPreviewSchemaAttr[];
    builderOpOptions: WorldMutationOp[];
    valueHint: string;
    valueRequiresJsonObject: boolean;
    stateResult: WorldPreviewStateSubject[];
}>();

const emit = defineEmits<{
    (e: "update-builder-field", field: keyof PreviewMutationBuilderModel, value: string): void;
    (e: "add-builder-mutation", mode: "append" | "replace"): void;
}>();

/** 读取原生表单事件中的字符串值，让模板保持简洁。 */
function inputValue(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value;
}

const collectionValueOptions = computed<Array<{label: string; value: string; key: string}>>(() => {
    if (props.builder.op !== "collectionRemove") {
        return [];
    }
    return collectionRemoveValueOptions(props.stateResult, props.builder.subjectId, props.builder.attr);
});

watch(collectionValueOptions, (options) => {
    syncCollectionRemoveValue(options);
}, {immediate: true});

function syncCollectionRemoveValue(options: Array<{value: string}>): void {
    if (props.builder.op !== "collectionRemove" || !options.length) {
        return;
    }
    if (options.some((option) => option.value === props.builder.value)) {
        return;
    }
    emit("update-builder-field", "value", options[0]?.value ?? "");
}
</script>

<template>
    <!-- Preview Mutation Builder -->
    <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-3">
        <div class="mb-2 flex items-center justify-between gap-2">
            <div class="text-xs font-semibold text-[var(--text-secondary)]">Mutation Builder</div>
            <div class="flex min-w-0 items-center gap-2 text-[11px] text-[var(--text-muted)]">
                <span class="truncate">{{ subjectTypeLabel }}</span>
                <span class="shrink-0 rounded border border-[var(--border-color)] px-1.5 py-0.5 font-mono">{{ valueHint }}</span>
            </div>
        </div>
        <div class="grid grid-cols-2 gap-2">
            <select :value="builder.subjectId" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 text-xs outline-none focus:border-[var(--accent-main)]" @change="emit('update-builder-field', 'subjectId', inputValue($event))">
                <option :value="subjectFormId">{{ subjectFormId || "subject" }}</option>
                <option v-for="subject in subjects" :key="`builder:${subject.id}`" :value="subject.id">{{ subject.id }} · {{ subject.type }}</option>
            </select>
            <select :value="builder.attr" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 text-xs outline-none focus:border-[var(--accent-main)]" @change="emit('update-builder-field', 'attr', inputValue($event))">
                <option v-for="attr in builderAttrs" :key="`builder-attr:${attr.name}`" :value="attr.name">{{ attr.name }}</option>
            </select>
            <input :value="builder.attr" list="world-engine-preview-builder-attrs" class="col-span-2 h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 font-mono text-xs outline-none focus:border-[var(--accent-main)]" placeholder="attr path, e.g. memory.师门" @input="emit('update-builder-field', 'attr', inputValue($event))">
            <datalist id="world-engine-preview-builder-attrs">
                <option v-for="attr in builderAttrs" :key="`builder-attr-option:${attr.name}`" :value="attr.name"></option>
            </datalist>
            <select :value="builder.op" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 text-xs outline-none focus:border-[var(--accent-main)]" @change="emit('update-builder-field', 'op', inputValue($event))">
                <option v-for="op in builderOpOptions" :key="op" :value="op">{{ op }}</option>
            </select>
            <select v-if="builder.op === 'collectionRemove' && collectionValueOptions.length" :value="builder.value" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 text-xs outline-none focus:border-[var(--accent-main)]" title="从当前 State Query 结果中选择要移除的 collection 项" @change="emit('update-builder-field', 'value', inputValue($event))">
                <option v-for="option in collectionValueOptions" :key="option.key" :value="option.value">{{ option.label }}</option>
            </select>
            <textarea v-else-if="valueRequiresJsonObject" :value="builder.value" rows="4" class="col-span-2 min-h-[92px] resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 py-1.5 font-mono text-xs leading-5 outline-none focus:border-[var(--accent-main)]" placeholder="{&quot;key&quot;: &quot;value&quot;}" title="当前 value 必须是 JSON object" @input="emit('update-builder-field', 'value', inputValue($event))"></textarea>
            <input v-else :value="builder.value" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 text-xs outline-none focus:border-[var(--accent-main)] disabled:opacity-50" :disabled="builder.op === 'unset'" placeholder="value" @input="emit('update-builder-field', 'value', inputValue($event))">
        </div>
        <div class="mt-2 flex gap-2">
            <button type="button" class="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-[var(--border-color)] px-2 text-xs hover:bg-[var(--bg-hover)]" @click="emit('add-builder-mutation', 'append')">
                <span class="i-lucide-list-plus h-3.5 w-3.5"></span>
                追加
            </button>
            <button type="button" class="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-md border border-[var(--border-color)] px-2 text-xs hover:bg-[var(--bg-hover)]" @click="emit('add-builder-mutation', 'replace')">
                <span class="i-lucide-refresh-ccw h-3.5 w-3.5"></span>
                替换
            </button>
        </div>
    </div>
</template>
