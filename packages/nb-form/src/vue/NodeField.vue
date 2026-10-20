<script setup lang="ts">
/**
 * 按字段树的一个节点画一个字段：外壳加控件（编辑态），或外壳加静态的值（展示态）。值、问题与选项都从表单的上下文
 * 取，提交经上下文改根值（docs/specs/ui/forms.md 输出 3）。
 *
 * 条件隐藏用 `v-show` 加 `inert`，不卸载：草稿与控件自己的状态在重新显示后还在（输出 13）。
 */
import type {Component} from "vue";
import {computed, onBeforeUnmount, onMounted, ref, useId, useTemplateRef, watch} from "vue";

import type {BuiltinWidget, FieldNode} from "../model";
import {toPointer} from "../path";
import {resolveText} from "../text";
import {isVisible} from "../visible";
import {choiceLabel, choiceState} from "./choices";
import BooleanControl from "./controls/BooleanControl.vue";
import ChoiceControl from "./controls/ChoiceControl.vue";
import type {DraftControl} from "./controls/control";
import MultiControl from "./controls/MultiControl.vue";
import NumberControl from "./controls/NumberControl.vue";
import TextControl from "./controls/TextControl.vue";
import FieldShell from "./FieldShell.vue";
import {issueText, messagesFor} from "./messages";
import {CLEAR, issuesAt, useFormScope} from "./scope";
import ViewValue from "./ViewValue.vue";

const props = withDefaults(defineProps<{
    node: FieldNode;
    /** 只画控件（`SchemaField` 的 `bare`）。 */
    bare?: boolean;
    id?: string;
    labelledby?: string;
}>(), {bare: false, id: undefined, labelledby: undefined});

/** 内建控件；结构控件（对象、列表、JSON）与自定义控件在后续切片接入。 */
const CONTROLS: Partial<Record<BuiltinWidget, Component>> = {
    "switch": BooleanControl,
    "confirm": BooleanControl,
    "radio-row": ChoiceControl,
    "radio": ChoiceControl,
    "select": ChoiceControl,
    "search-select": ChoiceControl,
    "checkboxes": MultiControl,
    "number": NumberControl,
    "text": TextControl,
    "multiline": TextControl,
    "secret": TextControl,
};
const CHOICE_WIDGETS: ReadonlySet<string> = new Set(["radio-row", "radio", "select", "search-select", "checkboxes"]);
/** 由几个控件组成：外壳用组形态，控件经 `aria-labelledby` 取名。 */
const GROUP_WIDGETS: ReadonlySet<string> = new Set(["radio-row", "radio", "checkboxes", "confirm"]);
const TEXT_KINDS: ReadonlySet<string> = new Set(["text", "multiline"]);

const scope = useFormScope();
const generatedId = `nb-form-${useId()}`;
const id = computed(() => props.id ?? generatedId);
const pointer = computed(() => toPointer(props.node.path));
const widget = computed(() => (typeof props.node.widget === "string" ? props.node.widget : props.node.widget.custom));
const locale = computed(() => scope.locale.value);
const messages = computed(() => messagesFor(locale.value));
const value = computed(() => scope.valueAt(props.node.path));
const visible = computed(() => isVisible(props.node, scope.rootValue()));

const choices = computed(() => {
    if (!CHOICE_WIDGETS.has(widget.value)) return undefined;
    const name = props.node.hints.options;
    return choiceState(props.node, value.value, name === undefined ? undefined : scope.source(name), locale.value);
});
const readonly = computed(() => scope.readonly.value || props.node.readOnly);
const disabled = computed(() => scope.disabled.value || (choices.value !== undefined && choices.value.status !== "ready"));

const shown = computed(() => issuesAt(scope.shownIssues.value, props.node.path));
const errorText = computed(() => {
    const first = shown.value.find((issue) => issue.severity === "error");
    return first === undefined ? undefined : issueText(first, locale.value);
});
const warnings = computed(() => [
    ...shown.value.filter((issue) => issue.severity === "warning").map((issue) => issueText(issue, locale.value)),
    ...(choices.value?.items.some((item) => item.stale) === true ? [messages.value.stale] : []),
]);

/** 缺值时标题旁的标记（输出 4）：选择类写“默认：X”，开关标“默认”。 */
const note = computed(() => {
    if (value.value !== undefined || props.node.schema.default === undefined) return undefined;
    if (widget.value === "switch") return messages.value.default;
    if (choices.value !== undefined && !Array.isArray(props.node.schema.default)) return messages.value.defaultValue(choiceLabel(choices.value, props.node.schema.default));
    if (widget.value === "confirm" && typeof props.node.schema.default === "boolean") return messages.value.defaultValue(props.node.schema.default ? messages.value.yes : messages.value.no);
    return undefined;
});
const clearable = computed(() => scope.mode.value === "edit" && !readonly.value && !disabled.value
    && (props.node.nullable ? value.value !== undefined && value.value !== null : !props.node.required && value.value !== undefined));
const help = computed(() => {
    const own = resolveText(props.node.help, locale.value);
    const reason = choices.value?.status === "unavailable" ? choices.value.reason : "";
    return [own, reason].filter(Boolean).join(" ");
});

/** 展示态的文字（输出 17）：密钥只说有没有设置，从不显示值。 */
const viewText = computed(() => {
    const current = value.value;
    if (props.node.writeOnly) return scope.meta.value[pointer.value]?.secret === "set" || (typeof current === "string" && current !== "") ? messages.value.set : messages.value.unset;
    if (current === undefined || current === null) return "";
    if (typeof current === "boolean") return current ? messages.value.yes : messages.value.no;
    if (choices.value !== undefined) {
        const state = choices.value;
        return Array.isArray(current) ? current.map((entry) => choiceLabel(state, entry)).join(locale.value === "zh-CN" ? "、" : ", ") : choiceLabel(state, current);
    }
    if (typeof current === "number") {
        const unit = resolveText(props.node.hints.unit, locale.value);
        return unit ? `${String(current)} ${unit}` : String(current);
    }
    return typeof current === "string" ? current : JSON.stringify(current, null, 2);
});
const viewEmpty = computed(() => !props.node.writeOnly && (value.value === undefined || value.value === null || value.value === ""));

const control = computed(() => (typeof props.node.widget === "string" ? CONTROLS[props.node.widget] : undefined));
const controlRef = ref<Partial<DraftControl> | null>(null);
const root = useTemplateRef<HTMLElement>("root");

function update(next: unknown): void {
    scope.update(props.node, next);
}

/** 聚焦字段的控件：带字段 id 的元素能聚焦就聚焦它，否则（单选组、复选组的根）聚焦组里当前的 Tab 停靠点。 */
function focus(): void {
    const element = root.value;
    if (element === null) return;
    const target = element.querySelector<HTMLElement>(`[id="${id.value.replaceAll("\"", "\\\"")}"]`);
    if (target !== null && target.tabIndex >= 0 && !target.hasAttribute("disabled")) {
        target.focus();
        return;
    }
    element.querySelector<HTMLElement>("[tabindex='0'], input:not([type='hidden']):not([disabled]), textarea:not([disabled]), button:not([disabled])")?.focus();
}

let unregister: (() => void) | undefined;
function registerHandle(): void {
    unregister?.();
    unregister = scope.register(pointer.value, {
        focus,
        commit: () => controlRef.value?.commit?.() ?? true,
        reset: () => controlRef.value?.reset?.(),
    });
}
onMounted(registerHandle);
watch(pointer, registerHandle);
onBeforeUnmount(() => unregister?.());

function onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && root.value?.contains(next)) return;
    scope.touch(pointer.value);
}
</script>

<template>
    <div v-show="visible" ref="root" class="nb-form-node" :inert="!visible || undefined" @focusout="onFocusOut">
        <FieldShell
            v-if="scope.mode.value === 'view'"
            :id="id"
            :widget="widget"
            :label="resolveText(props.node.label, locale)"
            :help="help"
            :bare="props.bare"
            :labelledby="props.labelledby"
            group
        >
            <ViewValue
                :text="viewText"
                :locale="locale"
                :empty="viewEmpty"
                :copyable="TEXT_KINDS.has(props.node.kind) && !props.node.writeOnly"
                :labelledby="props.bare ? props.labelledby : `${id}-label`"
            />
        </FieldShell>
        <FieldShell
            v-else-if="control !== undefined"
            :id="id"
            :widget="widget"
            :label="resolveText(props.node.label, locale)"
            :help="help"
            :required="props.node.required && props.node.path.length > 0"
            :group="GROUP_WIDGETS.has(widget)"
            :bare="props.bare"
            :labelledby="props.labelledby"
            :inline="widget === 'switch'"
            :error-text="errorText"
            :warnings="warnings"
            :note="note"
            :clear-label="clearable ? messages.clear : undefined"
            @clear="update(CLEAR)"
        >
            <component
                :is="control"
                ref="controlRef"
                :node="props.node"
                :model-value="value"
                :readonly="readonly"
                :disabled="disabled"
                :invalid="errorText !== undefined"
                :locale="locale"
                v-bind="choices === undefined ? {} : {choices}"
                @update:model-value="update"
            />
        </FieldShell>
    </div>
</template>

<style scoped>
.nb-form-node {
    min-width: 0;
}
</style>
