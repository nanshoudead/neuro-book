<script setup lang="ts">
/**
 * 字符串列表与对象列表（docs/specs/ui/forms.md 输出 19）：每项一行（字符串）或一张卡片（对象），右侧上移、下移、删除，
 * 末尾“添加”。身份、焦点落点、播报与分页在 `useList`。只读与展示态不给结构操作。
 */
import {Button, useFieldContext} from "@notnotype/nb-ui/components";
import {computed, useId, useTemplateRef} from "vue";

import {itemNode} from "../../model";
import {useList} from "../list";
import {messagesFor} from "../messages";
import NodeField from "../NodeField.vue";
import {issuesUnder, useFormScope} from "../scope";
import ListActions from "./ListActions.vue";
import ObjectControl from "./ObjectControl.vue";
import type {ControlProps} from "./control";

const props = defineProps<ControlProps>();
const emit = defineEmits<{(event: "update:modelValue", value: unknown): void}>();

const scope = useFormScope();
const field = useFieldContext();
const prefix = `nb-form-list-${useId()}`;
const root = useTemplateRef<HTMLElement>("root");
const messages = computed(() => messagesFor(props.locale));
const isObjectList = computed(() => props.node.kind === "object-list");
const editable = computed(() => scope.mode.value === "edit" && !props.readonly && !props.disabled);
const list = useList({
    node: () => props.node,
    value: () => props.modelValue,
    locale: () => props.locale,
    editable: () => editable.value,
    emit: (next) => emit("update:modelValue", next),
    root,
    blank: () => (isObjectList.value ? {} : ""),
});
const showActions = computed(() => scope.mode.value === "edit" && !props.readonly);

/** 项标题：`itemLabel` 指向的字段有文字时用它，否则“第 N 项”（输出 20）。 */
function title(value: unknown, index: number): string {
    const key = props.node.hints.itemLabel;
    const named = key !== undefined && value !== null && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
    return typeof named === "string" && named.trim() !== "" ? named : messages.value.item(index + 1);
}
const foldedIssues = computed(() => issuesUnder(scope.shownIssues.value, props.node.path).length);
</script>

<template>
    <div ref="root" class="nb-form-list" role="group" :aria-labelledby="field?.labelId.value">
        <p v-if="list.items.value.length === 0" class="nb-form-list__empty">{{ messages.noItems }}</p>
        <div v-else-if="list.folded.value" class="nb-form-list__folded">
            <span>{{ messages.items(list.items.value.length) }}</span>
            <span v-if="foldedIssues > 0" class="nb-form-list__issues">{{ messages.containsIssues(foldedIssues) }}</span>
            <button type="button" class="nb-form-list__link" :aria-expanded="false" @click="list.expanded.value = true">{{ messages.expand }}</button>
        </div>
        <ol v-else class="nb-form-list__items" :class="{'nb-form-list__items--cards': isObjectList}">
            <li
                v-for="entry in list.visible.value"
                :key="entry.id"
                class="nb-form-list__item"
                :data-nb-list-item="entry.id"
                @keydown="list.onItemKeydown($event, entry.index)"
            >
                <template v-if="isObjectList">
                    <div class="nb-form-list__head">
                        <span :id="`${prefix}-${entry.id}`" class="nb-form-list__title">{{ title(entry.value, entry.index) }}</span>
                        <span v-if="list.duplicates.value.has(entry.index)" class="nb-form-list__duplicate">{{ messages.duplicate }}</span>
                        <ListActions
                            v-if="showActions"
                            :index="entry.index"
                            :count="list.items.value.length"
                            :title="title(entry.value, entry.index)"
                            :disabled="!editable"
                            :can-remove="list.canRemove.value"
                            :locale="props.locale"
                            @move="(delta) => list.move(entry.index, delta)"
                            @remove="list.remove(entry.index)"
                        />
                    </div>
                    <div data-nb-list-body>
                        <ObjectControl v-bind="props" :node="itemNode(props.node, entry.index)!" :labelledby="`${prefix}-${entry.id}`" flat />
                    </div>
                </template>
                <template v-else>
                    <span :id="`${prefix}-${entry.id}`" class="nb-form-sr-only">{{ title(entry.value, entry.index) }}</span>
                    <div class="nb-form-list__row">
                        <div class="nb-form-list__value" data-nb-list-body>
                            <NodeField :node="itemNode(props.node, entry.index)!" bare :labelledby="`${prefix}-${entry.id}`" />
                        </div>
                        <span v-if="list.duplicates.value.has(entry.index)" class="nb-form-list__duplicate">{{ messages.duplicate }}</span>
                        <ListActions
                            v-if="showActions"
                            :index="entry.index"
                            :count="list.items.value.length"
                            :title="title(entry.value, entry.index)"
                            :disabled="!editable"
                            :can-remove="list.canRemove.value"
                            :locale="props.locale"
                            @move="(delta) => list.move(entry.index, delta)"
                            @remove="list.remove(entry.index)"
                        />
                    </div>
                </template>
            </li>
        </ol>
        <div v-if="list.expanded.value && list.pageCount.value > 1" class="nb-form-list__pager">
            <button type="button" class="nb-form-list__link" :disabled="list.page.value === 0" @click="list.page.value -= 1">{{ messages.previousPage }}</button>
            <span>{{ messages.page(list.page.value + 1, list.pageCount.value) }}</span>
            <button type="button" class="nb-form-list__link" :disabled="list.page.value >= list.pageCount.value - 1" @click="list.page.value += 1">{{ messages.nextPage }}</button>
        </div>
        <div v-if="showActions">
            <Button size="sm" variant="secondary" data-nb-list-add :disabled="!list.canAdd.value" @click="list.add()">{{ messages.add }}</Button>
        </div>
        <span class="nb-form-sr-only" aria-live="polite">{{ list.announcement.value }}</span>
    </div>
</template>

<style scoped>
.nb-form-list {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: var(--space-4);
}

.nb-form-list__empty,
.nb-form-list__folded {
    display: flex;
    margin: 0;
    align-items: center;
    gap: var(--space-4);
    font-size: var(--text-sm);
    color: var(--text-muted);
}

.nb-form-list__items {
    display: flex;
    margin: 0;
    padding: 0;
    flex-direction: column;
    gap: var(--space-3);
    list-style: none;
}

.nb-form-list__items--cards {
    gap: var(--space-5);
}

.nb-form-list__items--cards > .nb-form-list__item {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    border: var(--border-w) solid var(--divider);
    border-radius: var(--radius-panel);
    padding: var(--space-5) var(--space-6) var(--space-6);
}

.nb-form-list__head,
.nb-form-list__row {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: var(--space-4);
}

.nb-form-list__title {
    min-width: 0;
    flex: 1 1 auto;
    overflow: hidden;
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    color: var(--text-secondary);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.nb-form-list__value {
    min-width: 0;
    flex: 1 1 auto;
}

.nb-form-list__duplicate,
.nb-form-list__issues {
    flex: none;
    font-size: var(--text-xs);
    color: var(--status-danger);
}

.nb-form-list__pager {
    display: flex;
    align-items: center;
    gap: var(--space-5);
    font-size: var(--text-xs);
    color: var(--text-muted);
}

.nb-form-list__link {
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    padding: 0;
    font: inherit;
    font-size: var(--text-xs);
    color: var(--accent-main);
    cursor: pointer;
}

.nb-form-list__link:disabled {
    color: var(--text-muted);
    cursor: default;
}

.nb-form-list__link:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
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
