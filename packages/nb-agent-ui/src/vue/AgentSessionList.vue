<script setup lang="ts">
/**
 * 会话列表（docs/specs/ui/agent-conversation-view.md“会话列表”）。挂在对话视图之外，宿主决定放在左栏、下拉还是弹窗里，
 * 所以不 inject：语言与数据都经属性给，发出的 action 与视图同一套，宿主可以交给同一个处理函数。不持有状态：选中由
 * `selectedId` 受控，放在下拉里时由宿主收到 action 后关下拉。
 */
import {Badge, Button, EmptyState, IconButton, ScrollArea, Spinner} from "@notnotype/nb-ui/components";

import {formatListTime} from "../format";
import {agentText} from "../messages";
import type {AgentLocale, AgentSessionListItem, AgentSessionListState, AgentViewAction} from "../types";

type LabelKey = "title" | "create" | "loading" | "empty" | "error" | "retry" | "untitled";

const props = withDefaults(defineProps<{
    items: readonly AgentSessionListItem[];
    selectedId: string | null;
    state?: AgentSessionListState;
    /** error 时的说明；缺省用包内文字。 */
    errorMessage?: string;
    /** 宿主给的当前时间；时间列按它写，宿主要定期更新（例如每分钟），否则过了午夜“今天”的行不会变成“昨天”。 */
    now: number;
    locale: AgentLocale;
    /** 是否显示标题行（标题与新建按钮）；放进宿主自有新建入口的下拉时传 false。 */
    header?: boolean;
    /** 覆盖包内文字：宿主把会话叫成别的（例如“对话”）时给整句，英文也由宿主给。 */
    labels?: Partial<Record<LabelKey, string>>;
}>(), {state: "ready", errorMessage: undefined, header: true, labels: () => ({})});

const emit = defineEmits<{action: [action: AgentViewAction]}>();

const DEFAULT_KEYS = {
    title: "sessions.title", create: "sessions.create", loading: "sessions.loading", empty: "sessions.empty",
    error: "sessions.error", retry: "sessions.retry", untitled: "header.untitled",
} as const;

function label(key: LabelKey): string {
    return props.labels[key] ?? agentText(props.locale, DEFAULT_KEYS[key]);
}
</script>

<template>
    <div class="acv-sessions">
        <div v-if="props.header" class="acv-sessions__head">
            <span class="acv-sessions__title">{{ label("title") }}</span>
            <IconButton size="sm" icon-class="i-lucide-square-pen" :aria-label="label('create')" :title="label('create')" data-session-create @click="emit('action', {type: 'session.create'})" />
        </div>
        <!-- 加载中、出错与空列表同一版式：居中的圆底图标加一句话，换状态时这块不跳。 -->
        <EmptyState v-if="props.state === 'loading'" :title="label('loading')" role="status">
            <template #icon><span aria-hidden="true"><Spinner size="md" /></span></template>
        </EmptyState>
        <EmptyState v-else-if="props.state === 'error'" icon-class="i-lucide-circle-alert acv-sessions__error-icon" :title="props.errorMessage ?? label('error')" role="alert">
            <template #action>
                <Button size="sm" variant="secondary" data-session-retry @click="emit('action', {type: 'sessions.refresh'})">{{ label("retry") }}</Button>
            </template>
        </EmptyState>
        <EmptyState v-else-if="props.items.length === 0" icon-class="i-lucide-messages-square" :title="label('empty')" />
        <ScrollArea v-else class="acv-sessions__scroll">
            <!-- list-style: none 时 Safari 会丢掉列表语义，role 写明。行占满列表宽度，外扩的焦点光晕会被滚动区裁掉，焦点画在行内（nb-ui 的内嵌焦点线）。 -->
            <ul role="list" class="acv-sessions__list">
                <li v-for="item in props.items" :key="item.id">
                    <button
                        type="button"
                        class="acv-sessions__row nb-ui-focus-ring-inset"
                        :aria-current="item.id === props.selectedId ? 'true' : undefined"
                        :data-session="item.id"
                        @click="emit('action', {type: 'session.select', sessionId: item.id})"
                    >
                        <span class="acv-sessions__line">
                            <span class="acv-sessions__name" :title="item.title === '' ? undefined : item.title">{{ item.title === "" ? label("untitled") : item.title }}</span>
                            <time class="acv-sessions__time" :datetime="new Date(item.updatedAt).toISOString()">{{ formatListTime(item.updatedAt, props.now, props.locale) }}</time>
                        </span>
                        <!-- 第二行总在：没有说明、状态与提醒的行也和别的行一样高（同一列表的行等高）。 -->
                        <span class="acv-sessions__line acv-sessions__meta">
                            <span class="acv-sessions__description">{{ item.description }}</span>
                            <span v-if="item.note" class="acv-sessions__note" :title="item.note.text">
                                <span :class="item.note.icon ?? 'i-lucide-circle-alert'" class="acv-sessions__note-icon" aria-hidden="true" /><span class="acv-sessions__note-text">{{ item.note.text }}</span>
                            </span>
                            <!-- 旁边已有文字，转圈不再报一遍（整行是按钮，名称由内容拼出）。 -->
                            <span v-if="item.status === 'running'" class="acv-sessions__running"><span aria-hidden="true"><Spinner size="sm" /></span>{{ agentText(props.locale, "sessions.running") }}</span>
                            <Badge v-else-if="item.status === 'interrupted'" size="sm" variant="soft">{{ agentText(props.locale, "sessions.interrupted") }}</Badge>
                            <Badge v-else-if="item.status === 'error'" size="sm" variant="soft" tone="danger">{{ agentText(props.locale, "sessions.failed") }}</Badge>
                        </span>
                    </button>
                </li>
            </ul>
        </ScrollArea>
    </div>
</template>

<style scoped>
.acv-sessions {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
}

.acv-sessions__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 8px 6px 12px;
}

.acv-sessions__title {
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    color: var(--text-main);
}

.acv-sessions :deep(.acv-sessions__error-icon) {
    color: var(--status-danger);
}

.acv-sessions__scroll {
    flex: 1;
    min-height: 0;
}

.acv-sessions__list {
    list-style: none;
    margin: 0;
    padding: 0 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.acv-sessions__row {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    min-width: 0;
    border-radius: var(--radius-control);
    padding: 7px 8px;
    text-align: left;
}

.acv-sessions__row:hover {
    background: var(--bg-hover);
}

.acv-sessions__row[aria-current="true"] {
    background: var(--accent-bg);
}

/* 同一列表的行等高：两行各给固定高度，内容有无、标记与转圈都不改变行高。第二行按其中最高的 Badge sm 定高（nb-ui Badge.vue）。 */
.acv-sessions__line {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
    height: calc(var(--text-sm) * var(--leading-ui));
    line-height: calc(var(--text-sm) * var(--leading-ui));
}

.acv-sessions__name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-sm);
    color: var(--text-main);
}

.acv-sessions__row[aria-current="true"] .acv-sessions__name {
    color: var(--accent-text);
}

.acv-sessions__time {
    flex-shrink: 0;
    font-size: var(--text-2xs);
    color: var(--text-muted);
}

.acv-sessions__meta {
    align-items: center;
    height: calc(var(--control-h-sm) * 0.68);
    line-height: normal;
    font-size: var(--text-xs);
    color: var(--text-muted);
}

/* 宽度不够时说明先收完，提醒再截断（见 nb-ui 自检清单“同行两段文字一段先收”）。 */
.acv-sessions__description {
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.acv-sessions__running {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    color: var(--accent-text);
}

.acv-sessions__note {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    font-size: var(--text-2xs);
    color: var(--status-warning);
}

.acv-sessions__note-icon {
    flex-shrink: 0;
}

.acv-sessions__note-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
</style>
