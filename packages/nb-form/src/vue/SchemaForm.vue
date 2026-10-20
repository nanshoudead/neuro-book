<script setup lang="ts">
/**
 * 按描述画整张表单（docs/specs/ui/forms.md，接口见“输入与前置条件”）。表单不持有值：`v-model` 的值由调用方保管，每次
 * 提交发出一个新的根值（输出 3）。根是 `role="group"` 的容器，不是 `<form>`（输出 21）。同名 `.md` 写组件合同。
 */
import {computed} from "vue";

import {resolveForm} from "../model";
import type {FormLayout, JsonSchema} from "../model";
import {toPointer} from "../path";
import type {FieldPath} from "../path";
import type {FormIssue, FormMeta} from "../validate";
import IssueSummary from "./IssueSummary.vue";
import LayoutItem from "./LayoutItem.vue";
import {fieldOrder, nearestField, sortIssues} from "./order";
import {createFormScope, provideFormScope} from "./scope";
import type {CommitMode, DraftState, FormMode, FormOptionSources} from "./scope";
import type {FormWidget} from "./widgets";

const props = withDefaults(defineProps<{
    schema: object;
    layout?: FormLayout;
    modelValue?: unknown;
    locale: string;
    mode?: FormMode;
    readonly?: boolean;
    disabled?: boolean;
    /** 调用方的问题（跨字段、异步、服务端），与 schema 的问题一起显示（输出 9）。 */
    issues?: ReadonlyArray<FormIssue>;
    meta?: FormMeta;
    options?: FormOptionSources;
    /** 登记的自定义控件（`defineFormWidgets` 的结果，输出 22）。 */
    widgets?: ReadonlyArray<FormWidget>;
    commit?: CommitMode;
    /** 调用方写入被拒、值没变时加一：没有焦点的字段丢掉草稿、回到实际值（输出 16）。 */
    revision?: number;
    /** 底部的问题汇总；关掉时调用方用 `focus-issue` 与 `focusFirstIssue()` 放到自己的位置。 */
    summary?: boolean;
}>(), {
    layout: undefined,
    modelValue: undefined,
    mode: "edit",
    readonly: false,
    disabled: false,
    issues: () => [],
    meta: () => ({}),
    options: () => ({}),
    widgets: () => [],
    commit: "change",
    revision: 0,
    summary: true,
});

const emit = defineEmits<{
    (event: "update:modelValue", value: unknown): void;
    (event: "draft-state", state: DraftState): void;
    /** 表单因为一条问题把焦点移到了它的字段（点了汇总里的一条，或调用了 `focusIssue`、`focusFirstIssue`）。 */
    (event: "focus-issue", issue: FormIssue): void;
}>();

const model = computed(() => resolveForm(props.schema as JsonSchema, props.layout === undefined ? {} : {layout: props.layout}));
const scope = createFormScope({
    model: () => model.value,
    value: () => props.modelValue,
    emitRoot: (next) => emit("update:modelValue", next),
    emitDraft: (state) => emit("draft-state", state),
    mode: () => props.mode,
    readonly: () => props.readonly,
    disabled: () => props.disabled,
    commit: () => props.commit,
    revision: () => props.revision,
    locale: () => props.locale,
    issues: () => props.issues,
    meta: () => props.meta,
    options: () => props.options,
    widgets: () => props.widgets,
});
provideFormScope(scope);

function focusIssue(issue: FormIssue): void {
    scope.revealAll();
    const order = fieldOrder(model.value.root);
    scope.handle(toPointer(nearestField(order, issue.path)))?.focus();
    emit("focus-issue", issue);
}

defineExpose({
    /** 提交所有可解析的草稿（一次发出一个根值），并显示全部问题；有不可解析的草稿时返回 false。 */
    commit(): boolean {
        scope.revealAll();
        let parsed = true;
        scope.batch(() => {
            for (const handle of scope.handles()) if (!handle.commit()) parsed = false;
        });
        return parsed;
    },
    /** 丢掉草稿：给了路径只丢那个字段的。 */
    reset(path?: FieldPath): void {
        if (path === undefined) for (const handle of scope.handles()) handle.reset();
        else scope.handle(toPointer(path))?.reset();
    },
    /** 聚焦到路径上第一条问题的字段。 */
    focusIssue(path: FieldPath): void {
        const issue = scope.issues.value.find((entry) => toPointer(entry.path) === toPointer(path));
        if (issue !== undefined) focusIssue(issue);
    },
    /** 聚焦到排在最前的问题；没有问题时返回 false。 */
    focusFirstIssue(): boolean {
        const first = sortIssues(scope.issues.value, fieldOrder(model.value.root))[0];
        if (first === undefined) return false;
        focusIssue(first);
        return true;
    },
});
</script>

<template>
    <div class="nb-form" role="group">
        <LayoutItem :layout="model.layout" />
        <IssueSummary v-if="props.summary" @focus="focusIssue" />
    </div>
</template>

<style scoped>
.nb-form {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: var(--space-6);
}
</style>
