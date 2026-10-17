<script setup lang="ts">
import {computed} from "vue";
import {Button, FormInput} from "@notnotype/nb-ui/components";
import NovelIdeModelSelect from "nbook/app/components/novel-ide/settings/sections/providers/components/NovelIdeModelSelect.vue";
import type {AgentVisibleModelDraft} from "nbook/app/components/novel-ide/settings/sections/providers/provider-settings-draft";
import type {EnabledModelOptionDto} from "nbook/shared/dto/app-settings.dto";

const props = defineProps<{
    modelValue: AgentVisibleModelDraft[];
    models: EnabledModelOptionDto[];
    defaultModelKey: string | null;
    disabled?: boolean;
}>();

const emit = defineEmits<{
    (event: "update:modelValue", value: AgentVisibleModelDraft[]): void;
}>();

const {t} = useI18n();

const canAdd = computed(() => props.models.some((model) => !props.modelValue.some((entry) => entry.modelKey === model.key)));

const defaultModelLabel = computed(() => props.models.find((model) => model.key === props.defaultModelKey)?.label ?? props.defaultModelKey ?? "");

/**
 * 当前行可选的模型：其它行已经占用的键不再出现，当前行自己的键保留。
 */
function availableModels(modelKey: string): EnabledModelOptionDto[] {
    const used = new Set(props.modelValue.map((entry) => entry.modelKey).filter((key) => key !== modelKey));
    return props.models.filter((model) => !used.has(model.key));
}

function addEntry(): void {
    const model = props.models.find((item) => !props.modelValue.some((entry) => entry.modelKey === item.key));
    if (!model) {
        return;
    }
    emit("update:modelValue", [...props.modelValue, {modelKey: model.key, note: ""}]);
}

function updateEntry(index: number, patch: Partial<AgentVisibleModelDraft>): void {
    emit("update:modelValue", props.modelValue.map((entry, entryIndex) => entryIndex === index ? {...entry, ...patch} : entry));
}

function removeEntry(index: number): void {
    emit("update:modelValue", props.modelValue.filter((_, entryIndex) => entryIndex !== index));
}

function moveEntry(index: number, direction: -1 | 1): void {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= props.modelValue.length) {
        return;
    }
    const next = [...props.modelValue];
    const [entry] = next.splice(index, 1);
    if (!entry) {
        return;
    }
    next.splice(nextIndex, 0, entry);
    emit("update:modelValue", next);
}
</script>

<template>
    <section class="flex flex-col gap-3">
        <div class="flex items-center justify-end">
            <Button size="sm" variant="secondary" :disabled="disabled || !canAdd" @click="addEntry">
                {{ t("settings.panels.models.agentVisibleModelsAdd") }}
            </Button>
        </div>

        <p v-if="modelValue.length > 5" class="text-sm text-[var(--status-warning)]">
            {{ t("settings.panels.models.agentVisibleModelsOverLimit", {count: modelValue.length}) }}
        </p>

        <p v-if="modelValue.length === 0" class="text-sm text-[var(--text-secondary)]">
            {{ defaultModelLabel
                ? t("settings.panels.models.agentVisibleModelsEmptyDefault", {model: defaultModelLabel})
                : t("settings.panels.models.agentVisibleModelsEmptyUnavailable") }}
        </p>

        <div v-for="(entry, index) in modelValue" :key="`${entry.modelKey}:${index}`" class="grid grid-cols-1 items-center gap-2 rounded-md border border-[var(--border-color)] p-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto]">
            <NovelIdeModelSelect
                :model-value="entry.modelKey"
                :models="availableModels(entry.modelKey)"
                :placeholder="t('settings.panels.models.agentVisibleModelsSelect')"
                :disabled="disabled"
                @update:model-value="updateEntry(index, {modelKey: $event ?? ''})"
            />
            <FormInput
                :model-value="entry.note"
                :placeholder="t('settings.panels.models.agentVisibleModelsNotePlaceholder')"
                :disabled="disabled"
                @update:model-value="updateEntry(index, {note: String($event ?? '')})"
            />
            <div class="flex items-center gap-1">
                <Button size="sm" variant="ghost" :disabled="disabled || index === 0" :aria-label="t('settings.panels.models.agentVisibleModelsMoveUp')" @click="moveEntry(index, -1)">↑</Button>
                <Button size="sm" variant="ghost" :disabled="disabled || index === modelValue.length - 1" :aria-label="t('settings.panels.models.agentVisibleModelsMoveDown')" @click="moveEntry(index, 1)">↓</Button>
                <Button size="sm" variant="ghost" :disabled="disabled" :aria-label="t('settings.panels.models.agentVisibleModelsRemove')" @click="removeEntry(index)">×</Button>
            </div>
            <p v-if="entry.modelKey && !models.some((model) => model.key === entry.modelKey)" class="text-xs text-[var(--status-danger)] md:col-span-3">
                {{ t("settings.panels.models.agentVisibleModelsInvalid", {model: entry.modelKey}) }}
            </p>
        </div>
    </section>
</template>
