<script setup lang="ts">
/**
 * 左列表右详情（docs/specs/ui/forms.md 输出 20）：左边是项标题的列表，选中的那一项在右边展开成一组字段。列表项的选中区
 * 与操作按钮并列，不嵌套按钮。新增的项自动选中并聚焦详情；删除选中项后选中下一项。只挂载选中项的详情。窄时上下排。
 *
 * 选中项经表单上下文的 `selection` 记：`SchemaField` 的根可以由调用方用 `v-model:selected` 接管。
 */
import {Button, useFieldContext} from "@notnotype/nb-ui/components";
import {computed, useId, useTemplateRef, watch} from "vue";

import {itemNode} from "../../model";
import {toPointer} from "../../path";
import {useList} from "../list";
import {messagesFor} from "../messages";
import {issuesUnder, useFormScope} from "../scope";
import ListActions from "./ListActions.vue";
import ObjectControl from "./ObjectControl.vue";
import type {ControlProps} from "./control";

const props = defineProps<ControlProps>();
const emit = defineEmits<{(event: "update:modelValue", value: unknown): void}>();

const scope = useFormScope();
const field = useFieldContext();
const prefix = `nb-form-md-${useId()}`;
const root = useTemplateRef<HTMLElement>("root");
const messages = computed(() => messagesFor(props.locale));
const editable = computed(() => scope.mode.value === "edit" && !props.readonly && !props.disabled);
const showActions = computed(() => scope.mode.value === "edit" && !props.readonly);
const list = useList({
    node: () => props.node,
    value: () => props.modelValue,
    locale: () => props.locale,
    editable: () => editable.value,
    emit: (next) => emit("update:modelValue", next),
    root,
    blank: () => ({}),
});

const selection = computed(() => scope.selection(toPointer(props.node.path)));
const selected = computed(() => {
    const count = list.items.value.length;
    return count === 0 ? -1 : Math.min(Math.max(selection.value.get(), 0), count - 1);
});
const selectedEntry = computed(() => list.entries.value[selected.value]);

function title(value: unknown, index: number): string {
    const key = props.node.hints.itemLabel;
    const named = key !== undefined && value !== null && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
    return typeof named === "string" && named.trim() !== "" ? named : messages.value.item(index + 1);
}
const issueCount = (index: number) => issuesUnder(scope.shownIssues.value, [...props.node.path, index]).length;

const detail = () => root.value?.querySelector<HTMLElement>("[data-nb-detail]") ?? null;
const FOCUSABLE = "input:not([type='hidden']):not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex='0']";

function add(): void {
    const count = list.items.value.length;
    // 新项传回来时选中它；渲染出它的详情以后聚焦详情里的第一个控件。
    list.add({
        adopt: () => selection.value.set(count),
        focus: () => detail()?.querySelector<HTMLElement>(FOCUSABLE)?.focus(),
    });
}

/** 删掉选中项：选中留在同一位置（即下一项），没有下一项时由 `selected` 退到上一项；删掉前面的项，选中跟着原来那一项走。 */
function remove(index: number): void {
    const current = selected.value;
    list.remove(index, {adopt: () => {
        if (index < current) selection.value.set(current - 1);
    }});
}

function move(index: number, delta: -1 | 1): void {
    const current = selected.value;
    list.move(index, delta, {adopt: () => {
        if (index === current) selection.value.set(index + delta);
        else if (index + delta === current) selection.value.set(current - delta);
    }});
}

// 外部把列表换短了：选中项落回范围内（`selected` 已经夹住，这里把记下的值也改掉，免得以后变长时跳回去）。
watch(() => list.items.value.length, (count) => {
    if (selection.value.get() >= count && count > 0) selection.value.set(count - 1);
});
</script>

<template>
    <div ref="root" class="nb-form-md" role="group" :aria-labelledby="field?.labelId.value">
        <div class="nb-form-md__master">
            <p v-if="list.items.value.length === 0" class="nb-form-md__empty">{{ messages.noItems }}</p>
            <div v-else-if="list.folded.value" class="nb-form-md__empty">
                <span>{{ messages.items(list.items.value.length) }}</span>
                <button type="button" class="nb-form-md__link" :aria-expanded="false" @click="list.expanded.value = true">{{ messages.expand }}</button>
            </div>
            <ul v-else class="nb-form-md__items">
                <li
                    v-for="entry in list.visible.value"
                    :key="entry.id"
                    class="nb-form-md__item"
                    :class="{'nb-form-md__item--selected': entry.index === selected}"
                    :data-nb-list-item="entry.id"
                    @keydown="list.onItemKeydown($event, entry.index)"
                >
                    <button
                        type="button"
                        class="nb-form-md__select"
                        data-nb-list-action="select"
                        :aria-current="entry.index === selected ? 'true' : undefined"
                        :aria-controls="`${prefix}-detail`"
                        @click="selection.set(entry.index)"
                    >
                        <span class="nb-form-md__title">{{ title(entry.value, entry.index) }}</span>
                        <span v-if="list.duplicates.value.has(entry.index)" class="nb-form-md__mark">{{ messages.duplicate }}</span>
                        <span v-else-if="issueCount(entry.index) > 0" class="nb-form-md__mark">{{ messages.containsIssues(issueCount(entry.index)) }}</span>
                    </button>
                    <ListActions
                        v-if="showActions"
                        :index="entry.index"
                        :count="list.items.value.length"
                        :title="title(entry.value, entry.index)"
                        :disabled="!editable"
                        :can-remove="list.canRemove.value"
                        :locale="props.locale"
                        @move="(delta) => move(entry.index, delta)"
                        @remove="remove(entry.index)"
                    />
                </li>
            </ul>
            <div v-if="list.expanded.value && list.pageCount.value > 1" class="nb-form-md__pager">
                <button type="button" class="nb-form-md__link" :disabled="list.page.value === 0" @click="list.page.value -= 1">{{ messages.previousPage }}</button>
                <span>{{ messages.page(list.page.value + 1, list.pageCount.value) }}</span>
                <button type="button" class="nb-form-md__link" :disabled="list.page.value >= list.pageCount.value - 1" @click="list.page.value += 1">{{ messages.nextPage }}</button>
            </div>
            <div v-if="showActions">
                <Button size="sm" variant="secondary" data-nb-list-add :disabled="!list.canAdd.value" @click="add">{{ messages.add }}</Button>
            </div>
        </div>
        <div v-if="selectedEntry !== undefined" :id="`${prefix}-detail`" class="nb-form-md__detail" data-nb-detail>
            <div :id="`${prefix}-detail-title`" class="nb-form-md__detail-title">{{ title(selectedEntry.value, selectedEntry.index) }}</div>
            <ObjectControl :key="selectedEntry.id" v-bind="props" :node="itemNode(props.node, selectedEntry.index)!" :labelledby="`${prefix}-detail-title`" flat />
        </div>
        <span class="nb-form-sr-only" aria-live="polite">{{ list.announcement.value }}</span>
    </div>
</template>

<style scoped>
.nb-form-md {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-6);
}

.nb-form-md__master {
    display: flex;
    min-width: 160px;
    flex: 1 1 180px;
    flex-direction: column;
    gap: var(--space-4);
}

.nb-form-md__detail {
    display: flex;
    min-width: 240px;
    flex: 3 1 280px;
    flex-direction: column;
    gap: var(--space-5);
    border: var(--border-w) solid var(--divider);
    border-radius: var(--radius-panel);
    padding: var(--space-5) var(--space-6) var(--space-6);
}

.nb-form-md__detail-title {
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    color: var(--text-secondary);
}

.nb-form-md__items {
    display: flex;
    margin: 0;
    padding: 0;
    flex-direction: column;
    gap: var(--space-1);
    list-style: none;
}

.nb-form-md__item {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: var(--space-2);
    border-radius: var(--radius-control);
}

.nb-form-md__item--selected {
    background: color-mix(in srgb, var(--accent-main) 12%, transparent);
}

.nb-form-md__select {
    display: flex;
    min-width: 0;
    flex: 1 1 auto;
    align-items: center;
    gap: var(--space-4);
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    padding: var(--space-3) var(--space-4);
    font: inherit;
    font-size: var(--text-sm);
    color: var(--text-main);
    text-align: left;
    cursor: pointer;
}

.nb-form-md__select:focus-visible,
.nb-form-md__link:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
}

.nb-form-md__title {
    min-width: 0;
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.nb-form-md__mark {
    flex: none;
    font-size: var(--text-xs);
    color: var(--status-danger);
}

.nb-form-md__empty {
    display: flex;
    margin: 0;
    align-items: center;
    gap: var(--space-4);
    font-size: var(--text-sm);
    color: var(--text-muted);
}

.nb-form-md__pager {
    display: flex;
    align-items: center;
    gap: var(--space-5);
    font-size: var(--text-xs);
    color: var(--text-muted);
}

.nb-form-md__link {
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    padding: 0;
    font: inherit;
    font-size: var(--text-xs);
    color: var(--accent-main);
    cursor: pointer;
}

.nb-form-md__link:disabled {
    color: var(--text-muted);
    cursor: default;
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
