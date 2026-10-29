<script setup lang="ts">
/**
 * 字符串列表与对象列表（docs/specs/ui/forms.md 输出 19）：每项一行（字符串）或一张卡片（对象），右侧上移、下移、删除，
 * 末尾“添加”。身份、焦点落点、播报与分页在 `useList`。只读与展示态不给结构操作。
 *
 * 组根读外壳的上下文：名字是字段标题，说明与第一条错误经 `aria-describedby`，出错时 `aria-invalid` 并描红（审查 S3
 * Sonnet 5）。字符串列表的每个输入框配一个看不见的 `<label for>`（“第 N 项”）：nb-ui 的单个控件靠 `<label for>`
 * 取名，`aria-labelledby` 传不进去（审查 S3 Sonnet 1）。
 */
import {Button, useFieldContext} from "@notnotype/nb-ui/components";
import {computed, useId, useTemplateRef} from "vue";

import {itemNode} from "../../model";
import {useList} from "../list";
import {useFormText} from "../text";
import NodeField from "../NodeField.vue";
import {itemTitle} from "../order";
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
const text = useFormText();
const isObjectList = computed(() => props.node.kind === "object-list");
const editable = computed(() => scope.editable(props.node) && !props.disabled);
const list = useList({
    node: () => props.node,
    value: () => props.modelValue,
    scope,
    editable: () => editable.value,
    emit: (next) => emit("update:modelValue", next),
    root,
    blank: () => (isObjectList.value ? {} : ""),
});
const showActions = computed(() => scope.mode.value === "edit" && !props.readonly);
const title = (value: unknown, index: number) => itemTitle(props.node, value, index, text);
const foldedIssues = computed(() => issuesUnder(scope.shownIssues.value, props.node.path));
const foldedHasError = computed(() => foldedIssues.value.some((issue) => issue.severity === "error"));
</script>

<template>
    <div
        ref="root"
        class="nb-form-list"
        :class="{'nb-form-list--invalid': props.invalid}"
        role="group"
        tabindex="-1"
        data-nb-focus-target
        :aria-labelledby="field?.labelId.value"
        :aria-describedby="field?.ariaDescribedby.value"
        :aria-invalid="props.invalid || undefined"
    >
        <p v-if="list.items.value.length === 0" class="nb-form-list__empty">{{ text.t('noItems') }}</p>
        <div v-else-if="list.folded.value" class="nb-form-list__folded">
            <span>{{ text.t('items', {count: list.items.value.length}) }}</span>
            <span v-if="foldedIssues.length > 0" class="nb-form-list__issues" :class="{'nb-form-list__issues--error': foldedHasError}">{{ text.t('containsIssues', {count: foldedIssues.length}) }}</span>
            <button type="button" class="nb-form-list__link" :aria-expanded="false" @click="list.expanded.value = true">{{ text.t('expand') }}</button>
        </div>
        <ol v-else class="nb-form-list__items" :class="{'nb-form-list__items--cards': isObjectList}">
            <li
                v-for="entry in list.visible.value"
                :key="entry.id"
                class="nb-form-list__item"
                :data-nb-list-item="entry.id"
                @keydown.capture="list.onItemKeydownCapture($event, entry.index)"
            >
                <template v-if="isObjectList">
                    <div class="nb-form-list__head">
                        <span :id="`${prefix}-${entry.id}`" class="nb-form-list__title">{{ title(entry.value, entry.index) }}</span>
                        <span v-if="list.duplicates.value.has(entry.index)" class="nb-form-list__duplicate">{{ text.t('duplicate') }}</span>
                        <ListActions
                            v-if="showActions"
                            :index="entry.index"
                            :count="list.items.value.length"
                            :title="title(entry.value, entry.index)"
                            :disabled="!editable"
                            :can-remove="list.canRemove.value"
                            @move="(delta) => list.move(entry.index, delta)"
                            @remove="list.remove(entry.index)"
                        />
                    </div>
                    <div data-nb-list-body>
                        <ObjectControl v-bind="props" widget="object" :node="itemNode(props.node, entry.index)!" :labelledby="`${prefix}-${entry.id}`" flat />
                    </div>
                </template>
                <template v-else>
                    <label :for="`${prefix}-${entry.id}-input`" class="nb-form-sr-only">{{ title(entry.value, entry.index) }}</label>
                    <div class="nb-form-list__row">
                        <div class="nb-form-list__value" data-nb-list-body>
                            <NodeField :id="`${prefix}-${entry.id}-input`" :node="itemNode(props.node, entry.index)!" bare />
                        </div>
                        <span v-if="list.duplicates.value.has(entry.index)" class="nb-form-list__duplicate">{{ text.t('duplicate') }}</span>
                        <ListActions
                            v-if="showActions"
                            :index="entry.index"
                            :count="list.items.value.length"
                            :title="title(entry.value, entry.index)"
                            :disabled="!editable"
                            :can-remove="list.canRemove.value"
                            @move="(delta) => list.move(entry.index, delta)"
                            @remove="list.remove(entry.index)"
                        />
                    </div>
                </template>
            </li>
        </ol>
        <div v-if="list.expanded.value && list.pageCount.value > 1" class="nb-form-list__pager">
            <button type="button" class="nb-form-list__link" :disabled="list.page.value === 0" @click="list.page.value -= 1">{{ text.t('previousPage') }}</button>
            <span>{{ text.t('page', {current: list.page.value + 1, total: list.pageCount.value}) }}</span>
            <button type="button" class="nb-form-list__link" :disabled="list.page.value >= list.pageCount.value - 1" @click="list.page.value += 1">{{ text.t('nextPage') }}</button>
        </div>
        <div v-if="showActions">
            <Button size="sm" variant="secondary" data-nb-list-add :disabled="!list.canAdd.value" @click="list.add()">{{ text.t('add') }}</Button>
        </div>
        <span class="nb-form-sr-only" aria-live="polite"><span :key="list.announcement.value.sequence">{{ list.announcement.value.text }}</span></span>
    </div>
</template>

<style scoped>
.nb-form-list {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: var(--space-4);
    border-radius: var(--radius-control);
}

.nb-form-list:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

/* 列表整体出错（条数不够、有重复）：左侧一条出错色的线，与对象的层级线同一位置。 */
.nb-form-list--invalid {
    border-left: 2px solid var(--status-danger);
    padding-left: var(--space-5);
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
.nb-form-list__issues--error {
    flex: none;
    font-size: var(--text-xs);
    color: var(--status-danger);
}

.nb-form-list__issues {
    flex: none;
    font-size: var(--text-xs);
    color: var(--status-warning);
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

/* `--focus-ring` 是一串 box-shadow，不能写进 outline（审查 S3 Sonnet 9）。 */
.nb-form-list__link:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
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
