<script setup lang="ts">
/**
 * 对象字段：成员按属性顺序排成一组（docs/specs/ui/forms.md 输出 2）。成员各自是一个字段，值与提交都经表单的上下文，
 * 所以这里只排版。对象列表的每一项、左列表右详情的详情区也用它画（那时给了 `labelledby`，组名是项标题）。
 *
 * 可为 null 的对象值为 null 时不画成员：成员写不进 null（核心的 `setAt` 不穿过 null），先给一个“填写”把它设成空对象
 * （审查 S3 omp 4）。清除写回 null 后同样回到这里。
 *
 * 与 `NodeField` 互相引用（成员又可能是对象）：模板里的组件在渲染时才取，模块循环不影响。
 */
import {Button, useFieldContext} from "@notnotype/nb-ui/components";
import {computed} from "vue";

import {messagesFor} from "../messages";
import NodeField from "../NodeField.vue";
import {useFormScope} from "../scope";
import type {ControlProps} from "./control";

const props = defineProps<ControlProps & {
    /** 组的名字来源（列表项、详情区的标题）；没给时是外壳的标题。 */
    labelledby?: string;
    /** 不画左侧的层级线（列表项、详情区自己有边框）。 */
    flat?: boolean;
}>();
const emit = defineEmits<{(event: "update:modelValue", value: unknown): void}>();

const scope = useFormScope();
const field = useFieldContext();
/** 作为字段自己的控件时（不是列表项、详情区），组上带外壳的说明与出错（审查 S3 Sonnet 5）。 */
const own = computed(() => props.labelledby === undefined);
const unset = computed(() => props.node.nullable && props.modelValue === null);
</script>

<template>
    <div
        class="nb-form-object"
        :class="{'nb-form-object--flat': props.flat, 'nb-form-object--invalid': own && props.invalid}"
        role="group"
        :tabindex="own ? -1 : undefined"
        :data-nb-focus-target="own ? '' : undefined"
        :aria-labelledby="props.labelledby ?? field?.labelId.value"
        :aria-describedby="own ? field?.ariaDescribedby.value : undefined"
        :aria-invalid="own && props.invalid ? true : undefined"
    >
        <div v-if="unset">
            <Button v-if="scope.editable(props.node) && !props.disabled" size="sm" variant="secondary" @click="emit('update:modelValue', {})">{{ messagesFor(props.locale).fillIn }}</Button>
            <span v-else class="nb-form-object__empty">{{ messagesFor(props.locale).empty }}</span>
        </div>
        <NodeField v-for="child in unset ? [] : props.node.children" :key="String(child.path[child.path.length - 1])" :node="child" />
    </div>
</template>

<style scoped>
.nb-form-object {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: var(--space-6);
    border-left: var(--border-w) solid var(--divider);
    padding-left: var(--space-6);
}

.nb-form-object:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.nb-form-object--flat {
    border-left: 0;
    padding-left: 0;
}

.nb-form-object--invalid {
    border-left: 2px solid var(--status-danger);
}

.nb-form-object__empty {
    font-size: var(--text-sm);
    color: var(--text-muted);
}
</style>
