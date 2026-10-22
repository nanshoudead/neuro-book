<script setup lang="ts">
import {computed} from "vue";
import {DropdownMenu} from "@notnotype/nb-ui/components";
import type {DropdownMenuItemData} from "@notnotype/nb-ui/components";
import {THINKING_LEVEL_KEYS} from "../../composer-actions";
import {useAgentText} from "../host";

const props = withDefaults(defineProps<{
    models: ReadonlyArray<{key: string; label: string; supportsImages: boolean}>;
    modelKey: string | null;
    thinkingLevels: readonly string[];
    thinking: string | null;
    disabled?: boolean;
}>(), {
    disabled: false,
});

const emit = defineEmits<{
    (e: "select-model", modelKey: string): void;
    (e: "select-thinking", level: string): void;
}>();

defineOptions({inheritAttrs: false});

const {t} = useAgentText();

const MODEL_PREFIX = "model:";
const THINKING_PREFIX = "thinking:";

function thinkingLabel(level: string): string {
    const key = THINKING_LEVEL_KEYS[level];
    return key === undefined ? level : t(key);
}

const noImageValues = computed(() => new Set(props.models.filter((model) => !model.supportsImages).map((model) => `${MODEL_PREFIX}${model.key}`)));

const currentModel = computed(() => props.models.find((model) => model.key === props.modelKey) ?? null);
const currentThinking = computed(() => props.thinking === null ? null : thinkingLabel(props.thinking));

const items = computed<DropdownMenuItemData[]>(() => {
    const models: DropdownMenuItemData[] = props.models.map((model) => ({
        value: `${MODEL_PREFIX}${model.key}`,
        label: model.label,
        type: "radio",
        group: "model",
        checked: model.key === props.modelKey,
        ...(model.supportsImages ? {} : {title: t("composer.model.noImages")}),
    }));
    if (props.thinkingLevels.length === 0) {
        return models;
    }
    return [
        ...models,
        {value: "sep-thinking", label: "", separator: true},
        {
            value: "thinking",
            label: currentThinking.value === null ? t("composer.model.thinking") : `${t("composer.model.thinking")} · ${currentThinking.value}`,
            iconClass: "i-lucide-brain",
            children: props.thinkingLevels.map((level) => ({
                value: `${THINKING_PREFIX}${level}`,
                label: thinkingLabel(level),
                type: "radio",
                group: "thinking",
                checked: level === props.thinking,
            })),
        },
    ];
});

function onSelect(value: string): void {
    if (value.startsWith(MODEL_PREFIX)) {
        emit("select-model", value.slice(MODEL_PREFIX.length));
    }
    else if (value.startsWith(THINKING_PREFIX)) {
        emit("select-thinking", value.slice(THINKING_PREFIX.length));
    }
}
</script>

<template>
    <DropdownMenu :items="items" root-class="acv-model-picker" side="top" :disabled="props.disabled" @select="onSelect">
        <button
            type="button"
            class="acv-model-picker__trigger"
            :disabled="props.disabled"
            :title="currentModel?.label ?? t('composer.model.none')"
            v-bind="$attrs"
            data-model-picker
        >
            <span class="i-lucide-cpu acv-model-picker__icon" aria-hidden="true" />
            <span class="acv-model-picker__model">{{ currentModel?.label ?? t("composer.model.none") }}</span>
            <span v-if="currentThinking !== null" class="acv-model-picker__thinking">· {{ currentThinking }}</span>
            <span class="i-lucide-chevrons-up-down acv-model-picker__chevron" aria-hidden="true" />
        </button>
        <!-- 不支持图片的模型在右侧标一个图标；DropdownMenu 的 rightIconClass 目前不渲染，所以用插槽画。 -->
        <template #item-right="{item}">
            <span v-if="noImageValues.has(item.value)" class="i-lucide-image-off acv-model-picker__no-images" aria-hidden="true" />
        </template>
    </DropdownMenu>
</template>

<style scoped>
:global(.acv-model-picker) {
    display: inline-flex;
    min-width: 0;
}

.acv-model-picker__trigger {
    display: inline-flex;
    min-width: 0;
    height: 26px;
    align-items: center;
    gap: 4px;
    padding: 0 6px;
    border-radius: var(--radius-control);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    transition: background-color var(--motion-fast) var(--ease-standard), color var(--motion-fast) var(--ease-standard);
}

.acv-model-picker__trigger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--text-main) 10%, transparent);
    color: var(--text-main);
}

.acv-model-picker__trigger:focus-visible {
    outline: 2px solid var(--focus-outline);
    outline-offset: 1px;
}

.acv-model-picker__trigger:disabled {
    cursor: not-allowed;
    opacity: 0.5;
}

.acv-model-picker__icon,
.acv-model-picker__chevron {
    flex: none;
    width: 13px;
    height: 13px;
}

.acv-model-picker__chevron {
    color: var(--text-muted);
}

.acv-model-picker__no-images {
    width: 14px;
    height: 14px;
    color: var(--text-muted);
}

.acv-model-picker__model {
    min-width: 0;
    max-width: 12em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.acv-model-picker__thinking {
    flex: none;
    color: var(--text-muted);
}
</style>
