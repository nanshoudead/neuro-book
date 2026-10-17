<script setup lang="ts">
import AgentVisibleModelsEditor from "./AgentVisibleModelsEditor.vue";
import type {AgentVisibleModelDraft} from "nbook/app/components/novel-ide/settings/sections/providers/provider-settings-draft";
import type {EnabledModelOptionDto} from "nbook/shared/dto/app-settings.dto";

defineProps<{
    entries: AgentVisibleModelDraft[];
    models: EnabledModelOptionDto[];
    defaultModelKey: string | null;
    disabled?: boolean;
}>();

const emit = defineEmits<{
    (event: "update:entries", value: AgentVisibleModelDraft[]): void;
}>();

const {t} = useI18n();
</script>

<template>
    <section class="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <header class="flex flex-col gap-1">
            <h2 class="text-lg font-medium text-[var(--text-primary)]">{{ t("settings.section.agentVisibleModels.label") }}</h2>
            <p class="text-sm text-[var(--text-secondary)]">{{ t("settings.section.agentVisibleModels.description") }}</p>
        </header>
        <AgentVisibleModelsEditor
            :model-value="entries"
            :models="models"
            :default-model-key="defaultModelKey"
            :disabled="disabled"
            @update:model-value="emit('update:entries', $event)"
        />
    </section>
</template>
