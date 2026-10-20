<script setup lang="ts">
/**
 * 字段外壳（docs/specs/ui/forms.md“术语与参与者”、输出 4、14）：标签、必填标记、“默认”标记、警告图标、清除动作、
 * 说明，中间放控件。出错不在字段下插文字：控件标红，第一条错误与警告的文字只给读屏，看得见的文字在表单的问题汇总里。
 *
 * 外壳自己提供 nb-ui `Field` 的上下文（不用 `Field` 组件）：标题行上还要放“默认”、警告与清除，`Field` 的标题只有文字。
 * 组合控件（单选组、复选组、确认）用组形态：标题是带 id 的元素，控件读 `labelId` 写 `aria-labelledby`。
 */
import {NB_FIELD_CONTEXT_KEY} from "@notnotype/nb-ui/components";
import {computed, provide} from "vue";

const props = withDefaults(defineProps<{
    id: string;
    widget: string;
    label?: string;
    help?: string;
    required?: boolean;
    /** 组合控件：标题不是 `<label for>`。 */
    group?: boolean;
    /** 只有控件：标签由调用方画，`labelledby` 指向它。 */
    bare?: boolean;
    labelledby?: string;
    /** 控件与标题在同一行（开关）。 */
    inline?: boolean;
    errorText?: string;
    warnings?: ReadonlyArray<string>;
    /** 标题旁的标记：“默认：X”或“默认”。 */
    note?: string;
    clearLabel?: string;
}>(), {
    label: "",
    help: undefined,
    required: false,
    group: false,
    bare: false,
    labelledby: undefined,
    inline: false,
    errorText: undefined,
    warnings: () => [],
    note: undefined,
    clearLabel: undefined,
});

const emit = defineEmits<{(event: "clear"): void}>();

const labelId = computed(() => (props.bare ? props.labelledby : props.label ? `${props.id}-label` : undefined));
const helpId = computed(() => (props.help ? `${props.id}-help` : undefined));
const errorId = computed(() => (props.errorText ? `${props.id}-error` : undefined));
const warningId = computed(() => (props.warnings.length > 0 ? `${props.id}-warning` : undefined));
const ariaDescribedby = computed(() => [errorId.value, warningId.value, helpId.value].filter(Boolean).join(" ") || undefined);

provide(NB_FIELD_CONTEXT_KEY, {
    inputId: computed(() => props.id),
    labelId,
    descriptionId: helpId,
    errorId,
    ariaDescribedby,
    required: computed(() => props.required),
    invalid: computed(() => Boolean(props.errorText)),
});
</script>

<template>
    <div v-if="props.bare" class="nb-form-field nb-form-field--bare" :data-nb-widget="props.widget">
        <slot />
        <span v-if="errorId" :id="errorId" class="nb-form-sr-only">{{ props.errorText }}</span>
        <span v-if="warningId" :id="warningId" class="nb-form-sr-only">{{ props.warnings.join("；") }}</span>
    </div>
    <div v-else class="nb-form-field" :class="{'nb-form-field--inline': props.inline}" :data-nb-widget="props.widget">
        <div class="nb-form-field__head">
            <component
                :is="props.group ? 'span' : 'label'"
                v-if="props.label"
                :id="labelId"
                class="nb-form-field__label"
                :for="props.group ? undefined : props.id"
            >{{ props.label }}<span v-if="props.required" class="nb-form-field__required" aria-hidden="true">*</span></component>
            <span v-if="props.note" class="nb-form-field__note">{{ props.note }}</span>
            <span v-if="props.warnings.length > 0" class="nb-form-field__warning" :title="props.warnings.join('\n')" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
            </span>
            <div v-if="props.inline" class="nb-form-field__inline-control"><slot /></div>
            <button v-if="props.clearLabel" type="button" class="nb-form-field__clear" :aria-label="props.label ? `${props.clearLabel}：${props.label}` : props.clearLabel" @click="emit('clear')">{{ props.clearLabel }}</button>
        </div>
        <slot v-if="!props.inline" />
        <p v-if="helpId" :id="helpId" class="nb-form-field__help">{{ props.help }}</p>
        <span v-if="errorId" :id="errorId" class="nb-form-sr-only">{{ props.errorText }}</span>
        <span v-if="warningId" :id="warningId" class="nb-form-sr-only">{{ props.warnings.join("；") }}</span>
    </div>
</template>

<style scoped>
.nb-form-field {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: var(--space-3);
}

.nb-form-field__head {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: var(--space-4);
    row-gap: var(--space-2);
}

.nb-form-field--inline .nb-form-field__head {
    align-items: center;
}

.nb-form-field__label {
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    color: var(--text-main);
    overflow-wrap: anywhere;
}

.nb-form-field__required {
    margin-left: var(--space-2);
    color: var(--status-danger);
}

.nb-form-field__note {
    font-size: var(--text-xs);
    color: var(--text-muted);
}

.nb-form-field__warning {
    display: inline-flex;
    align-self: center;
    color: var(--status-warning);
}

.nb-form-field__clear {
    margin-left: auto;
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    padding: 0 var(--space-2);
    font: inherit;
    font-size: var(--text-xs);
    color: var(--text-muted);
    cursor: pointer;
}

.nb-form-field__clear:hover {
    color: var(--text-main);
}

.nb-form-field__clear:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
}

.nb-form-field__inline-control {
    display: flex;
    align-items: center;
}

.nb-form-field__help {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--text-muted);
    overflow-wrap: anywhere;
}

.nb-form-sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}
</style>
