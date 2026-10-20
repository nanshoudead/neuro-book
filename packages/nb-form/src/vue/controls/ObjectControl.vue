<script setup lang="ts">
/**
 * 对象字段：成员按属性顺序排成一组（docs/specs/ui/forms.md 输出 2）。成员各自是一个字段，值与提交都经表单的上下文，
 * 所以这里只排版。对象列表的每一项、左列表右详情的详情区也用它画。
 *
 * 与 `NodeField` 互相引用（成员又可能是对象）：模板里的组件在渲染时才取，模块循环不影响。
 */
import {useFieldContext} from "@notnotype/nb-ui/components";

import NodeField from "../NodeField.vue";
import type {ControlProps} from "./control";

const props = defineProps<ControlProps & {
    /** 组的名字来源（外壳的标题、列表项的标题）。 */
    labelledby?: string;
    /** 不画左侧的层级线（列表项、详情区自己有边框）。 */
    flat?: boolean;
}>();

/** 没给 `labelledby` 时，组名是外壳的标题。 */
const field = useFieldContext();
</script>

<template>
    <div class="nb-form-object" :class="{'nb-form-object--flat': props.flat}" role="group" :aria-labelledby="props.labelledby ?? field?.labelId.value">
        <NodeField v-for="child in props.node.children" :key="String(child.path[child.path.length - 1])" :node="child" />
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

.nb-form-object--flat {
    border-left: 0;
    padding-left: 0;
}
</style>
