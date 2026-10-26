<script setup lang="ts">
import ModelPickerPopover from "nbook/app/components/novel-ide/model-picker/ModelPickerPopover.vue";
import type {ModelPickerModelItem, ModelPickerRoleItem} from "nbook/app/components/novel-ide/model-picker/model-picker.types";
import type {AgentSessionModelDraft} from "nbook/app/components/novel-ide/agent/agent-session-model-controls";
import type {EnabledModelOptionDto, ThinkingLevelDto} from "nbook/shared/dto/app-settings.dto";

const props = withDefaults(defineProps<{
    sessionModelSelectionValue: string | null;
    sessionThinkingResolvedLabel?: string;
    sessionModelDraft: AgentSessionModelDraft;
    selectableModels: EnabledModelOptionDto[];
    sessionModelSaving: boolean;
    sessionModelPopoverOpen?: boolean;
    readonly?: boolean;
    running?: boolean;
    loadingSession?: boolean;
    roles?: ModelPickerRoleItem[];
    showSpecialistInPicker?: boolean;
    size?: "default" | "sm";
    dropdownDirection?: "auto" | "down" | "up";
    rootClass?: string;
    popoverClass?: string;
}>(), {
    sessionThinkingResolvedLabel: "",
    sessionModelPopoverOpen: false,
    roles: () => [],
    showSpecialistInPicker: true,
    readonly: false,
    running: false,
    loadingSession: false,
    size: "sm",
    dropdownDirection: "auto",
    rootClass: "w-auto",
    popoverClass: "w-[360px]",
});

const emit = defineEmits<{
    (e: "update:sessionModelPopoverOpen", value: boolean): void;
    (e: "update:sessionModelDraft", value: AgentSessionModelDraft): void;
    (e: "update-session-model-selection", value: string | null): void;
    (e: "toggle-session-model-popover"): void;
    (e: "apply-session-model-settings"): void;
    (e: "update-session-thinking-level", value: ThinkingLevelDto | null): void;
    (e: "reset-session-model-settings"): void;
}>();

const controlsRef = ref<HTMLElement | null>(null);
const {t} = useI18n();

const actionDisabled = computed(() => props.readonly || props.running || props.loadingSession || props.sessionModelSaving);

/**
 * 更新当前 session 模型参数草稿。
 */
function updateSessionModelDraft(patch: Partial<AgentSessionModelDraft>): void {
    emit("update:sessionModelDraft", {
        ...props.sessionModelDraft,
        ...patch,
    });
}

const internalPickerOpen = ref(false);
const modelPickerOpen = computed({
    get: () => props.sessionModelPopoverOpen ?? internalPickerOpen.value,
    set: (val: boolean) => {
        internalPickerOpen.value = val;
        emit("update:sessionModelPopoverOpen", val);
    },
});

const pickerModels = computed<ModelPickerModelItem[]>(() => {
    return props.selectableModels.map((model) => {
        const separator = " / ";
        const splitAt = model.label.indexOf(separator);
        return {
            key: model.key,
            label: model.label,
            providerId: model.providerId,
            providerName: splitAt > 0 ? model.label.slice(0, splitAt) : undefined,
            modelId: model.modelId,
            input: model.input as ("text" | "image")[],
            contextWindowTokens: model.contextWindowTokens,
        };
    });
});

function handleModelSelect(value: string, item: ModelPickerRoleItem | ModelPickerModelItem): void {
    if ("modelKey" in item && item.modelKey) {
        emit("update-session-model-selection", item.modelKey);
    } else {
        emit("update-session-model-selection", value);
    }
}

function handleThinkingLevelUpdate(level: ThinkingLevelDto | null): void {
    updateSessionModelDraft({ reasoningEffort: level });
}

function handleThinkingLevelCommit(level: ThinkingLevelDto | null): void {
    updateSessionModelDraft({ reasoningEffort: level });
    emit("update-session-thinking-level", level);
}

const effectivePopoverClass = computed(() => {
    const list: string[] = [];
    if (props.dropdownDirection === "up") {
        list.push("-left-2");
    }
    if (props.popoverClass && props.popoverClass !== "w-[360px]") {
        list.push(props.popoverClass);
    }
    return list.join(" ");
});
</script>

<template>
    <!-- Agent Session 模型选择面板 -->
    <div ref="controlsRef" class="relative flex min-w-0 items-center" :class="props.rootClass">
        <ModelPickerPopover
            v-model:open="modelPickerOpen"
            :model-value="props.sessionModelSelectionValue"
            :roles="props.roles"
            :models="pickerModels"
            :show-specialist-in-picker="props.showSpecialistInPicker"
            :disabled="actionDisabled"
            :direction="props.dropdownDirection"
            :thinking-level="props.sessionModelDraft.reasoningEffort"
            trigger-class="w-full"
            :popover-class="effectivePopoverClass"
            @select="handleModelSelect"
            @update:thinking-level="handleThinkingLevelUpdate"
            @commit:thinking-level="handleThinkingLevelCommit"
        />
    </div>
</template>
