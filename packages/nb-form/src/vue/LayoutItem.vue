<script setup lang="ts">
/**
 * 布局的一项（docs/specs/ui/forms.md“布局”）：字段、竖排、横排或分组。布局只排根上的字段；布局指向的字段不存在时
 * 什么也不画（`checkDescription` 另报）。
 */
import {computed} from "vue";

import {findNode} from "../model";
import type {FormLayout} from "../model";
import {resolveText} from "../text";
import NodeField from "./NodeField.vue";
import {useFormScope} from "./scope";

const props = defineProps<{layout: FormLayout}>();

const scope = useFormScope();
const node = computed(() => (props.layout.type === "field" ? findNode(scope.model.value.root, props.layout.path) : undefined));
</script>

<template>
    <NodeField v-if="props.layout.type === 'field' && node !== undefined" :node="node" />
    <section v-else-if="props.layout.type === 'group'" class="nb-form-group">
        <div class="nb-form-group__title">{{ resolveText(props.layout.label, scope.locale.value) }}</div>
        <div class="nb-form-column">
            <LayoutItem v-for="(item, index) in props.layout.items" :key="index" :layout="item" />
        </div>
    </section>
    <div v-else-if="props.layout.type === 'column' || props.layout.type === 'row'" :class="props.layout.type === 'row' ? 'nb-form-row' : 'nb-form-column'">
        <LayoutItem v-for="(item, index) in props.layout.items" :key="index" :layout="item" />
    </div>
</template>

<style scoped>
.nb-form-column {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: var(--space-6);
}

.nb-form-row {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-6);
}

.nb-form-row > * {
    min-width: 160px;
    flex: 1 1 0;
}

.nb-form-group {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: var(--space-5);
}

.nb-form-group__title {
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    color: var(--text-secondary);
}
</style>
