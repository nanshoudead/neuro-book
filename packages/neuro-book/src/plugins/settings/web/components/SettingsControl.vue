<script setup lang="ts">
/** 设置窗口通用列表的控件（同名 .md）：按控件描述画 nb-ui 控件；输入类保留草稿，离开或回车才提交。 */
import {Input, NumberInput, Select, SegmentedControl, Switch} from "@notnotype/nb-ui/components";
import type {SegmentedControlValue} from "@notnotype/nb-ui/components";
import {computed, ref, watch} from "vue";

import {localize} from "nbook/shared/localized-text";
import type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";

import type {SettingControl} from "../setting-controls";

defineOptions({name: "SettingsControl"});

const props = withDefaults(defineProps<{
    control: SettingControl;
    modelValue: unknown;
    disabled?: boolean;
    id?: string;
    label: string;
    locale: DisplayLocale;
}>(), {disabled: false, id: undefined});

const emit = defineEmits<{
    (event: "update:modelValue", value: unknown): void;
}>();

const TEXT = {
    fileOnly: {"zh-CN": "只能在设置文件里改", "en-US": "Can only be changed in the settings file"},
} satisfies Record<string, LocalizedText>;


const segmentedOptions = computed(() => (props.control.kind === "segmented" ? props.control.choices.map((choice) => ({value: choice.value as SegmentedControlValue, label: choice.label, disabled: props.disabled})) : []));
/** 下拉的值只能是字符串：用选项的序号作值，选中后换回字面量。 */
const selectOptions = computed(() => (props.control.kind === "select" ? props.control.choices.map((choice, index) => ({value: String(index), label: choice.label})) : []));
const selectValue = computed(() => (props.control.kind === "select" ? String(props.control.choices.findIndex((choice) => choice.value === props.modelValue)) : ""));

function onSelect(index: string): void {
    if (props.control.kind !== "select") return;
    const choice = props.control.choices[Number(index)];
    if (choice !== undefined && choice.value !== props.modelValue) emit("update:modelValue", choice.value);
}

// ── 输入类：草稿 ────────────────────────────────────────────────────────

const shown = (value: unknown): string => (typeof value === "string" || typeof value === "number" ? String(value) : "");
const draft = ref(shown(props.modelValue));
watch(() => props.modelValue, (value) => {
    draft.value = shown(value);
});

function commit(): void {
    if (props.disabled) return;
    const text = draft.value;
    if (props.control.kind === "number") {
        const trimmed = text.trim();
        const parsed = Number(trimmed);
        // 不能解析的原样交出去：写入路径按 schema 拒绝并发通知，控件回到实际值（输出 14）。
        const next = trimmed === "" ? props.modelValue : Number.isFinite(parsed) ? parsed : trimmed;
        if (next === props.modelValue) draft.value = shown(props.modelValue);
        else emit("update:modelValue", next);
        return;
    }
    if (props.control.kind === "text" && text !== props.modelValue) emit("update:modelValue", text);
}

/** 焦点离开整个控件才提交：点数字框的步进按钮时焦点还在控件里。 */
function onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && (event.currentTarget as HTMLElement).contains(next)) return;
    commit();
}

/** 只读显示的摘要上限：一屏读得完，再长的看设置文件。 */
const SUMMARY_LIMIT = 400;
const summary = computed(() => {
    const json = JSON.stringify(props.modelValue) ?? "";
    return json.length <= SUMMARY_LIMIT ? json : `${json.slice(0, SUMMARY_LIMIT - 1)}…`;
});
</script>

<template>
    <Switch
        v-if="control.kind === 'switch'"
        :id="id"
        class="settings-control"
        data-settings-control="switch"
        :model-value="modelValue === true"
        :disabled="disabled"
        :aria-label="label"
        @update:model-value="(value: boolean) => emit('update:modelValue', value)"
    />
    <SegmentedControl
        v-else-if="control.kind === 'segmented'"
        class="settings-control"
        data-settings-control="segmented"
        :model-value="modelValue as SegmentedControlValue"
        :options="segmentedOptions"
        :aria-label="label"
        @update:model-value="(value: SegmentedControlValue) => { if (value !== modelValue) emit('update:modelValue', value); }"
    />
    <div v-else-if="control.kind === 'select'" class="settings-control settings-control--select" data-settings-control="select">
        <Select :id="id" :model-value="selectValue" :options="selectOptions" :disabled="disabled" @update:model-value="onSelect" />
    </div>
    <div v-else-if="control.kind === 'number'" class="settings-control settings-control--number" data-settings-control="number" @focusout="onFocusOut">
        <NumberInput
            :id="id"
            v-model="draft"
            :disabled="disabled"
            :min="control.min === undefined ? undefined : String(control.min)"
            :max="control.max === undefined ? undefined : String(control.max)"
            :step="control.step === undefined ? (control.integer ? '1' : undefined) : String(control.step)"
            @submit="commit"
        />
    </div>
    <div v-else-if="control.kind === 'text'" class="settings-control settings-control--text" data-settings-control="text" @focusout="onFocusOut" @keydown.enter.prevent="commit">
        <Input :id="id" v-model="draft" :disabled="disabled" :minlength="control.minLength" :maxlength="control.maxLength" />
    </div>
    <div v-else class="settings-control settings-control--readonly" data-settings-control="readonly">
        <span class="settings-control__file-only">{{ localize(TEXT.fileOnly, locale) }}</span>
        <code class="settings-control__summary">{{ summary }}</code>
    </div>
</template>

<style scoped>
.settings-control {
    max-width: 100%;
}

.settings-control--select {
    width: 220px;
}

.settings-control--number {
    width: 120px;
}

.settings-control--text {
    width: 320px;
}

.settings-control--readonly {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: var(--space-2);
}

.settings-control__file-only {
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--text-muted);
}

.settings-control__summary {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--text-secondary);
    overflow-wrap: anywhere;
    white-space: pre-wrap;
}
</style>
