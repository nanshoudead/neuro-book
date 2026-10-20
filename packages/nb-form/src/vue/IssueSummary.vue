<script setup lang="ts">
/**
 * 表单底部的问题汇总（docs/specs/ui/forms.md 输出 14）：一行“N 个问题”，展开列出每一条，点一条聚焦到它的字段。这一行
 * 一直占位，排版不因校验结果跳动。错误与警告分得开：条目前有各自的图标与色调，读屏念“警告：”前缀。
 *
 * 问题数在调用方要求显示全部问题（`commit()`、`focusFirstIssue()`）之后经 `aria-live` 播报一次；平时不播报，免得
 * 每次输入都念。
 */
import {computed, ref, useId, watch} from "vue";

import type {FormIssue} from "../validate";
import {issueText, messagesFor} from "./messages";
import {fieldLabel, sortIssues} from "./order";
import {useFormScope} from "./scope";

const emit = defineEmits<{(event: "focus", issue: FormIssue): void}>();

const scope = useFormScope();
const listId = `nb-form-issues-${useId()}`;
const expanded = ref(false);
const locale = computed(() => scope.locale.value);
const messages = computed(() => messagesFor(locale.value));
const issues = computed(() => sortIssues(scope.shownIssues.value, scope.model.value));
const hasError = computed(() => issues.value.some((issue) => issue.severity === "error"));
const entries = computed(() => issues.value.map((issue) => {
    const label = fieldLabel(scope.model.value.root, scope.rootValue(), issue.path, locale.value);
    const text = issueText(issue, locale.value);
    return {issue, text: label ? `${label}：${text}` : text};
}));

const announcement = ref("");
watch(() => scope.revealCount.value, () => {
    announcement.value = messages.value.issueCount(issues.value.length);
});
</script>

<template>
    <div class="nb-form-summary" :data-nb-form-summary="issues.length > 0 ? (hasError ? 'error' : 'warning') : 'none'">
        <button
            v-if="issues.length > 0"
            type="button"
            class="nb-form-summary__toggle"
            :class="hasError ? 'nb-form-summary__toggle--error' : 'nb-form-summary__toggle--warning'"
            :aria-expanded="expanded"
            :aria-controls="expanded ? listId : undefined"
            @click="expanded = !expanded"
        >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" /></svg>
            {{ messages.issueCount(issues.length) }}
        </button>
        <ul v-if="issues.length > 0 && expanded" :id="listId" class="nb-form-summary__list">
            <li v-for="(entry, index) in entries" :key="index">
                <button type="button" class="nb-form-summary__item" :data-severity="entry.issue.severity" @click="emit('focus', entry.issue)">
                    <svg v-if="entry.issue.severity === 'warning'" class="nb-form-summary__mark" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
                    <svg v-else class="nb-form-summary__mark" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" /></svg>
                    <span v-if="entry.issue.severity === 'warning'" class="nb-form-sr-only">{{ messages.warning }}：</span>
                    <span class="nb-form-summary__text">{{ entry.text }}</span>
                </button>
            </li>
        </ul>
        <span class="nb-form-sr-only" aria-live="polite">{{ announcement }}</span>
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
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-3);
    color: var(--text-main);
    overflow-wrap: anywhere;
}

.nb-form-summary__mark {
    flex: none;
    align-self: center;
}

.nb-form-summary__item[data-severity="error"] .nb-form-summary__mark {
    color: var(--status-danger);
}

.nb-form-summary__item[data-severity="warning"] .nb-form-summary__mark {
    color: var(--status-warning);
}

.nb-form-summary__item:hover .nb-form-summary__text {
    text-decoration: underline;
}

/* `--focus-ring` 是一串 box-shadow，不能写进 outline（审查 S3 Sonnet 9）。 */
.nb-form-summary__toggle:focus-visible,
.nb-form-summary__item:focus-visible {
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
