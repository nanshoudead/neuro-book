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
import {sortIssues} from "./order";
import {createFormScope, provideFormScope} from "./scope";
import {provideFormText} from "./text";
import type {CommitMode, DraftState, FormMode, FormOptionSources} from "./scope";
import type {FormWidget} from "./widgets";

const props = withDefaults(defineProps<{
    schema: object;
    layout?: FormLayout;
    modelValue?: unknown;
    /** 没有宿主注入翻译端口时表单文字的语言（缺省 zh-CN）；有注入时以端口为准，这一项不起作用（`./text.ts`）。 */
    locale?: string;
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
    locale: undefined,
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
const text = provideFormText(() => props.locale);
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
    locale: () => text.locale.value,
    issues: () => props.issues,
    meta: () => props.meta,
    options: () => props.options,
    widgets: () => props.widgets,
});
provideFormScope(scope);

/**
 * 把焦点移到一条问题的字段上：目标在折叠的分组、折叠或别的页的列表、未选中的详情里时先打开它们（`scope.focusPath`）。
 * 焦点确实移过去了才发 `focus-issue`、返回 true（审查 S3 omp 8）。
 */
async function focusIssue(issue: FormIssue): Promise<boolean> {
    scope.revealAll();
    const moved = await scope.focusPath(issue.path);
    if (moved) emit("focus-issue", issue);
    return moved;
}

defineExpose({
    /** 提交所有可解析的草稿（一次发出一个根值），并显示全部问题；有草稿提交不了时返回 false。 */
    commit: (): boolean => scope.commitAll(),
    /** 丢掉草稿：给了路径只丢那个字段的。 */
    reset: (path?: FieldPath): void => scope.resetAll(path),
    /** 聚焦到路径上第一条问题的字段；焦点移过去了时 resolve 为 true。 */
    focusIssue(path: FieldPath): Promise<boolean> {
        const issue = scope.shownIssues.value.find((entry) => toPointer(entry.path) === toPointer(path)) ?? scope.issues.value.find((entry) => toPointer(entry.path) === toPointer(path));
        return issue === undefined ? Promise.resolve(false) : focusIssue(issue);
    },
    /** 聚焦到排在最前的问题（被条件隐藏的字段上的不算）；没有问题或去不了时 resolve 为 false。 */
    focusFirstIssue(): Promise<boolean> {
        scope.revealAll();
        const first = sortIssues(scope.shownIssues.value, model.value)[0];
        return first === undefined ? Promise.resolve(false) : focusIssue(first);
    },
});
</script>

<template>
    <div class="nb-form" role="group">
        <LayoutItem :layout="model.layout" />
        <IssueSummary v-if="props.summary" @focus="(issue) => void focusIssue(issue)" />
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
