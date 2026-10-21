<script setup lang="ts">
/**
 * 按字段树的一个节点画一个字段：外壳加控件（编辑态），或外壳加静态的值（展示态）。值、问题与选项都从表单的上下文
 * 取，提交经上下文改根值（docs/specs/ui/forms.md 输出 3）。
 *
 * 条件隐藏用 `v-show` 加 `inert`，不卸载：草稿与控件自己的状态在重新显示后还在（输出 13）。对象与列表在展示态里照样
 * 画成结构，成员各自画成静态的值。
 */
import type {Component} from "vue";
import {computed, nextTick, onBeforeUnmount, onMounted, ref, useId, useTemplateRef} from "vue";

import type {BuiltinWidget, FieldNode} from "../model";
import {toPointer} from "../path";
import {resolveText} from "../text";
import {isVisible} from "../visible";
import {choiceLabel, choiceState} from "./choices";
import BooleanControl from "./controls/BooleanControl.vue";
import ChoiceControl from "./controls/ChoiceControl.vue";
import type {DraftControl} from "./controls/control";
import CustomControl from "./controls/CustomControl.vue";
import JsonControl from "./controls/JsonControl.vue";
import ListControl from "./controls/ListControl.vue";
import MasterDetailControl from "./controls/MasterDetailControl.vue";
import MultiControl from "./controls/MultiControl.vue";
import NumberControl from "./controls/NumberControl.vue";
import ObjectControl from "./controls/ObjectControl.vue";
import TextControl from "./controls/TextControl.vue";
import FieldShell from "./FieldShell.vue";
import {issueText, messagesFor} from "./messages";
import {CLEAR, issuesAt, stablePath, useFormScope} from "./scope";
import ViewValue from "./ViewValue.vue";
import {resolveWidget} from "./widgets";

const props = withDefaults(defineProps<{
    node: FieldNode;
    /** 只画控件（`SchemaField` 的 `bare`）。 */
    bare?: boolean;
    id?: string;
    labelledby?: string;
    describedby?: string;
}>(), {bare: false, id: undefined, labelledby: undefined, describedby: undefined});

const CONTROLS: Readonly<Record<BuiltinWidget, Component>> = {
    "switch": BooleanControl,
    "confirm": BooleanControl,
    "segmented": ChoiceControl,
    "radio-row": ChoiceControl,
    "radio": ChoiceControl,
    "select": ChoiceControl,
    "search-select": ChoiceControl,
    "checkboxes": MultiControl,
    "number": NumberControl,
    "text": TextControl,
    "multiline": TextControl,
    "secret": TextControl,
    "json": JsonControl,
    "object": ObjectControl,
    "string-list": ListControl,
    "object-list": ListControl,
    "master-detail": MasterDetailControl,
};
const CHOICE_WIDGETS: ReadonlySet<string> = new Set(["segmented", "radio-row", "radio", "select", "search-select", "checkboxes"]);
/** 由几个控件组成：外壳用组形态，控件经 `aria-labelledby` 取名。 */
const GROUP_WIDGETS: ReadonlySet<string> = new Set(["segmented", "radio-row", "radio", "checkboxes", "confirm", "object", "string-list", "object-list", "master-detail"]);
/** 展示态里仍画成结构的控件：成员各自是字段。 */
const STRUCTURE_WIDGETS: ReadonlySet<string> = new Set(["object", "string-list", "object-list", "master-detail"]);
const TEXT_KINDS: ReadonlySet<string> = new Set(["text", "multiline"]);

const scope = useFormScope();
/** 本字段在表单里的所有者 token：句柄与“碰过”跟着它，不跟着路径（见 `scope.ts` 模块头）。 */
const owner = Symbol("nb-form-field");
const generatedId = `nb-form-${useId()}`;
const id = computed(() => props.id ?? generatedId);
const pointer = computed(() => toPointer(props.node.path));
const resolved = computed(() => resolveWidget(props.node, scope.widgets.value));
/** 字段根上 `data-nb-widget` 的值：内建控件名，或自定义控件的登记名。 */
const widget = computed(() => ("builtin" in resolved.value ? resolved.value.builtin : resolved.value.custom.name));
const locale = computed(() => scope.locale.value);
const messages = computed(() => messagesFor(locale.value));
const value = computed(() => scope.valueAt(props.node.path));
const visible = computed(() => isVisible(props.node, scope.rootValue()));

const choices = computed(() => {
    if (!CHOICE_WIDGETS.has(widget.value)) return undefined;
    const name = props.node.hints.options;
    return choiceState(props.node, value.value, name === undefined ? undefined : scope.source(name), locale.value);
});
const readonly = computed(() => scope.readonly.value || props.node.readOnly || scope.mode.value === "view");
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

/** 缺值时标题旁的标记（输出 4）：选择类写“默认：X”（多选写全部默认项），开关标“默认”。 */
const note = computed(() => {
    const fallback = props.node.schema.default;
    if (value.value !== undefined || fallback === undefined) return undefined;
    if (widget.value === "switch") return messages.value.default;
    if (choices.value !== undefined) {
        const state = choices.value;
        const labels = Array.isArray(fallback) ? fallback.map((entry) => choiceLabel(state, entry)) : [choiceLabel(state, fallback)];
        return messages.value.defaultValue(labels.join(locale.value === "zh-CN" ? "、" : ", "));
    }
    if (widget.value === "confirm" && typeof props.node.schema.default === "boolean") return messages.value.defaultValue(props.node.schema.default ? messages.value.yes : messages.value.no);
    return undefined;
});
const clearable = computed(() => scope.editable(props.node) && !disabled.value
    && (props.node.nullable ? value.value !== undefined && value.value !== null : !props.node.required && value.value !== undefined));
const help = computed(() => resolveText(props.node.help, locale.value));
/** 动态选项不可用的原因：不是字段的说明，`bare` 时也要显示（输出 11）。 */
const status = computed(() => (choices.value?.status === "unavailable" ? choices.value.reason : ""));

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
/**
 * 展示态的“复制”只给多行、JSON 与长的文字（输出 17）：短值本来就能选中复制，每个短值一个按钮只会把 Tab 顺序拉长。
 */
const COPY_MIN_LENGTH = 40;
const copyable = computed(() => {
    if (props.node.writeOnly) return false;
    if (widget.value === "multiline" || props.node.kind === "json") return true;
    return TEXT_KINDS.has(props.node.kind) && (viewText.value.length >= COPY_MIN_LENGTH || viewText.value.includes("\n"));
});
const viewEmpty = computed(() => !props.node.writeOnly && (value.value === undefined || value.value === null || value.value === ""));

const control = computed<Component>(() => ("builtin" in resolved.value ? CONTROLS[resolved.value.builtin] : CustomControl));
// `bare` 的对象没有外壳的标题可挂，左侧的层级线也不画：它的成员直接排在调用方的标题下面（设置页的详情区）。
const controlProps = computed(() => ("custom" in resolved.value
    ? {custom: resolved.value.custom}
    : {
        widget: resolved.value.builtin,
        ...(choices.value === undefined ? {} : {choices: choices.value}),
        ...(props.bare && resolved.value.builtin === "object" ? {flat: true} : {}),
    }));
const unit = computed(() => (widget.value === "number" ? resolveText(props.node.hints.unit, locale.value) : ""));
const viewAsStructure = computed(() => STRUCTURE_WIDGETS.has(widget.value) && "builtin" in resolved.value);
const controlRef = ref<Partial<DraftControl> & {focus?: () => void} | null>(null);
const root = useTemplateRef<HTMLElement>("root");

function update(next: unknown): void {
    scope.update(props.node, next);
}

/**
 * 聚焦字段的控件：自定义控件用它暴露的 `focus()`；带字段 id 的元素能聚焦就聚焦它；结构控件（对象、列表）聚焦它们
 * 标了 `data-nb-focus-target` 的组根，读屏念出组名、说明与出错；否则（单选组、复选组）聚焦组里当前的 Tab 停靠点。
 * 不退到随便一个按钮上：列表里的第一个按钮是别的项的“下移”（审查 S3 Sonnet 2）。
 */
function focus(): boolean {
    const element = root.value;
    if (element === null) return false;
    if (controlRef.value?.focus !== undefined) controlRef.value.focus();
    else {
        const byId = element.querySelector<HTMLElement>(`[id="${id.value.replaceAll("\"", "\\\"")}"]`);
        const target = byId !== null && byId.tabIndex >= 0 && !byId.hasAttribute("disabled")
            ? byId
            : element.querySelector<HTMLElement>("[data-nb-focus-target]")
                ?? element.querySelector<HTMLElement>("[tabindex='0'], input:not([type='hidden']):not([disabled]), textarea:not([disabled])");
        target?.focus();
    }
    return element.contains(document.activeElement);
}

/** 清除以后“清除”按钮随值消失，焦点交给控件，不掉到页面上（审查 S3 Sonnet 4）。 */
function clear(): void {
    update(CLEAR);
    void nextTick(focus);
}

const path = stablePath(() => props.node.path);
onMounted(() => scope.register(owner, () => path.value, {
    focus,
    commit: () => controlRef.value?.commit?.() ?? true,
    reset: () => controlRef.value?.reset?.(),
}));
onBeforeUnmount(() => scope.unregister(owner));

function onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && root.value?.contains(next)) return;
    scope.touch(owner);
}
</script>

<template>
    <div v-show="visible" ref="root" class="nb-form-node" :data-nb-widget="widget" :inert="!visible || undefined" @focusout="onFocusOut">
        <FieldShell
            v-if="scope.mode.value === 'view' && !viewAsStructure"
            :id="id"
            :label="resolveText(props.node.label, locale)"
            :help="help"
            :status="status"
            :bare="props.bare"
            :labelledby="props.labelledby"
            :describedby="props.describedby"
            :locale="locale"
            group
        >
            <ViewValue
                :text="viewText"
                :locale="locale"
                :label="resolveText(props.node.label, locale)"
                :empty="viewEmpty"
                :copyable="copyable"
            />
        </FieldShell>
        <FieldShell
            v-else
            :id="id"
            :label="resolveText(props.node.label, locale)"
            :help="help"
            :status="status"
            :required="props.node.required && props.node.path.length > 0"
            :group="GROUP_WIDGETS.has(widget)"
            :bare="props.bare"
            :labelledby="props.labelledby"
            :describedby="props.describedby"
            :locale="locale"
            :inline="widget === 'switch'"
            :error-text="errorText"
            :warnings="warnings"
            :note="note"
            :unit="unit"
            :clear-label="clearable ? messages.clear : undefined"
            @clear="clear"
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
                v-bind="controlProps"
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
