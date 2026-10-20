<script setup lang="ts">
/**
 * 表单底部的问题汇总（docs/specs/ui/forms.md 输出 14）：一行“N 个问题”，展开列出每一条，点一条聚焦到它的字段。这一行
 * 一直占位，排版不因校验结果跳动。
 */
import {computed, ref, useId} from "vue";

import type {FormIssue} from "../validate";
import {issueText, messagesFor} from "./messages";
import {fieldLabel, fieldOrder, sortIssues} from "./order";
import {useFormScope} from "./scope";

const emit = defineEmits<{(event: "focus", issue: FormIssue): void}>();

const scope = useFormScope();
const listId = `nb-form-issues-${useId()}`;
const expanded = ref(false);
const locale = computed(() => scope.locale.value);
const issues = computed(() => sortIssues(scope.shownIssues.value, fieldOrder(scope.model.value.root)));
const hasError = computed(() => issues.value.some((issue) => issue.severity === "error"));
const entries = computed(() => issues.value.map((issue) => {
    const label = fieldLabel(scope.model.value.root, issue.path, locale.value);
    const text = issueText(issue, locale.value);
    return {issue, text: label ? `${label}：${text}` : text};
}));
</script>

<template>
    <div class="nb-form-summary" :data-nb-form-summary="issues.length > 0 ? (hasError ? 'error' : 'warning') : 'none'">
        <button
            v-if="issues.length > 0"
            type="button"
            class="nb-form-summary__toggle"
            :class="hasError ? 'nb-form-summary__toggle--error' : 'nb-form-summary__toggle--warning'"
            :aria-expanded="expanded"
            :aria-controls="listId"
            @click="expanded = !expanded"
        >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" /></svg>
            {{ messagesFor(locale).issueCount(issues.length) }}
        </button>
        <ul v-if="issues.length > 0 && expanded" :id="listId" class="nb-form-summary__list">
            <li v-for="(entry, index) in entries" :key="index">
                <button type="button" class="nb-form-summary__item" :data-severity="entry.issue.severity" @click="emit('focus', entry.issue)">{{ entry.text }}</button>
            </li>
        </ul>
    </div>
</template>

<style scoped>
.nb-form-summary {
    display: flex;
    min-height: calc(var(--text-sm) * var(--leading-ui));
    flex-direction: column;
    gap: var(--space-3);
}

.nb-form-summary__toggle,
.nb-form-summary__item {
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    padding: 0;
    font: inherit;
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
}

.nb-form-summary__toggle {
    display: inline-flex;
    align-self: flex-start;
    align-items: center;
    gap: var(--space-3);
}

.nb-form-summary__toggle--error {
    color: var(--status-danger);
}

.nb-form-summary__toggle--warning {
    color: var(--status-warning);
}

.nb-form-summary__list {
    display: flex;
    margin: 0;
    padding: 0;
    flex-direction: column;
    gap: var(--space-2);
    list-style: none;
}

.nb-form-summary__item {
    color: var(--text-main);
    overflow-wrap: anywhere;
}

.nb-form-summary__item:hover {
    text-decoration: underline;
}

.nb-form-summary__toggle:focus-visible,
.nb-form-summary__item:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
}
</style>
