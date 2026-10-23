<script setup lang="ts">
// 书里的“问答”页（docs/specs/story/viewer.md 的问答页，w00024 t13 决定 6 到 10、15 到 18）：对话列表在宽屏左栏、窄屏
// 顶栏的下拉；对话视图用 nb-agent-ui，数据经 qa/source.ts（一个对话一个）；出处与人名在右侧抽屉打开。
import {computed, onBeforeUnmount, provide, ref, shallowRef, watch, watchEffect} from "vue";
import {AlertDialog, Banner, Button, IconButton, Popover} from "@notnotype/nb-ui/components";
import {acceptSubmission, applyComposerAction, createAgentContext, createAgentViewRegistry, type AgentConversationContext, type AgentSessionListItem, type AgentViewAction, type ComposerView, type MessageView} from "@notnotype/nb-agent-ui";
import {AgentConversationView, AgentSessionList, builtinMessageActionsContribution, builtinRolesContribution} from "@notnotype/nb-agent-ui/vue";
import {provideMarkdownHost} from "@notnotype/nb-markdown/host";
import {PromptEditor, PromptTextView} from "@notnotype/nb-markdown/prompt";

import type {QaRunView, ViewerResult} from "../../contract/contract";
import {formatAt, useBook} from "../host/book";
import {StoryCallError, useStoryClient} from "../host/client";
import AnswerCard from "../qa/AnswerCard.vue";
import {REF_SCHEME} from "../qa/link-refs";
import {createNameResolver, QA_NAME_LOOKUP} from "../qa/names";
import {createQaSource, type QaSource, type QaSourceState} from "../qa/source";
import StoryMarkdown from "../qa/StoryMarkdown.vue";
import {storyToolsContribution} from "../qa/tools";
import {UNVERIFIED_REFS} from "../qa/turns";
import UnverifiedRefs from "../qa/UnverifiedRefs.vue";

const book = useBook();
const client = useStoryClient();

provideMarkdownHost({report: (event, message, error) => console.warn({event, error}, message)});

// nb-story 的 Agent 没有文件与命令工具：不登记内置工具（read 同名会冲突）与内置输入框命令（`/` 命令在这里没人处理）。
const registry = createAgentViewRegistry([
    builtinRolesContribution,
    builtinMessageActionsContribution,
    storyToolsContribution(AnswerCard),
    {source: "nb-story:qa-entries", entries: [{id: "nb-story.unverified-refs", customType: UNVERIFIED_REFS, component: UnverifiedRefs}]},
]);
const renderers = {markdown: StoryMarkdown, promptEditor: PromptEditor, promptTextView: PromptTextView};

const MODE_LABEL = {graph: "图当目录", full: "全读"} as const;
const MODES = [
    {key: "graph", label: "图当目录", icon: "i-lucide-network"},
    {key: "full", label: "全读", icon: "i-lucide-book-open"},
];

// ---- 人名（决定 16）：按查看器的位置与数据版本查，卡片经注入拿到 ----
const resolveName = createNameResolver(async name => {
    try {
        return (await client.call("entity.card", {book: book.bookId, at: book.at.value, entity: name})).id;
    } catch (error) {
        // 找不到、重名都是“不做成链接”；别的失败同样不做成链接，留一条诊断。
        if (!(error instanceof StoryCallError && (error.code === "entity_not_found" || error.code === "entity_ambiguous"))) console.warn({error, name}, "按名字查人物失败");
        return null;
    }
});
provide(QA_NAME_LOOKUP, who => resolveName(`${book.bookId}@${formatAt(book.at.value)}#${book.dataVersion.value}`, who));

// ---- 设置：没配置时输入框停用，给“去设置” ----
const configured = ref<boolean | null>(null);
void client.call("config.get", {}).then(
    result => (configured.value = result.state === "valid"),
    (error: unknown) => {
        console.warn({error}, "读问答配置失败");
        configured.value = false;
    },
);

// ---- 对话列表 ----
type Row = ViewerResult<"qa.list">["conversations"][number];
const rows = shallowRef<Row[]>([]);
const broken = shallowRef<ViewerResult<"qa.list">["broken"]>([]);
const listState = ref<"loading" | "ready" | "error">("loading");
const listError = ref<string | undefined>(undefined);
let listToken = 0;
async function loadList(): Promise<void> {
    const token = (listToken += 1);
    if (rows.value.length === 0) listState.value = "loading";
    try {
        const result = await client.call("qa.list", {book: book.bookId});
        if (token !== listToken) return;
        rows.value = result.conversations;
        broken.value = result.broken;
        listState.value = "ready";
    } catch (error) {
        if (token !== listToken) return;
        listState.value = "error";
        listError.value = error instanceof Error ? error.message : String(error);
    }
}
void loadList();
// 有对话在跑时每 5 秒重取一次列表（状态与时间会变）；都不在跑时不轮询。
const anyRunning = computed(() => rows.value.some(row => row.run?.state === "running"));
watchEffect(onCleanup => {
    if (!anyRunning.value) return;
    const timer = setInterval(() => void loadList(), 5000);
    onCleanup(() => clearInterval(timer));
});
// 列表的时间按 now 写，每分钟更新（过了午夜“今天”变“昨天”）。
const minute = ref(Date.now());
const minuteTimer = setInterval(() => (minute.value = Date.now()), 60_000);
onBeforeUnmount(() => clearInterval(minuteTimer));

function before(a: {chapter: number; paragraph?: number}, b: {chapter: number; paragraph?: number}): boolean {
    return a.chapter < b.chapter || (a.chapter === b.chapter && (a.paragraph ?? Number.POSITIVE_INFINITY) < (b.paragraph ?? Number.POSITIVE_INFINITY));
}
const items = computed<AgentSessionListItem[]>(() => [
    ...rows.value.map(row => ({
        id: row.id,
        title: row.question,
        description: `${row.turns === 0 ? "第 1 轮" : `${row.turns} 轮`} · ${MODE_LABEL[row.mode]} · 读到 ${formatAt(row.at)}`,
        updatedAt: Date.parse(row.updatedAt) || 0,
        status: row.run?.state === "running" ? ("running" as const) : row.status === "failed" ? ("error" as const) : row.status === "interrupted" ? ("interrupted" as const) : ("idle" as const),
        ...(before(book.at.value, row.at) ? {note: {text: `读到 ${formatAt(row.at)}，晚于你现在的位置`, icon: "i-lucide-eye"}} : {}),
    })),
    // 读不成的记录单列一行，只能删除（决定 18）。
    ...broken.value.map(item => ({id: item.id, title: "损坏的记录", description: item.problem, updatedAt: 0, status: "error" as const, note: {text: "只能删除"}})),
]);
const brokenIds = computed(() => new Set(broken.value.map(item => item.id)));

// ---- 选中的对话与它的数据源 ----
const selectedId = computed(() => book.qaConversation.value);
/** 正在发起一轮（qa.start 还没返回）。 */
const starting = ref(false);
/** 发起、停止或删除失败的原因，写在输入框上方；草稿不清。换对话时清掉。 */
const startError = ref<string | null>(null);
const sourceState = shallowRef<QaSourceState | null>(null);
let source: QaSource | null = null;
watch(
    selectedId,
    id => {
        source?.dispose();
        source = null;
        sourceState.value = null;
        startError.value = null;
        if (id === null || brokenIds.value.has(id)) return;
        source = createQaSource({client, book: book.bookId, conversation: id, onChange: state => (sourceState.value = state)});
        sourceState.value = source.state();
    },
    {immediate: true},
);
onBeforeUnmount(() => source?.dispose());

const run = computed<QaRunView | null>(() => sourceState.value?.run ?? null);
const running = computed(() => run.value?.state === "running");
const record = computed(() => sourceState.value?.record ?? null);
const title = computed(() => record.value?.turns[0]?.question ?? run.value?.question ?? "");
const conversationAt = computed(() => record.value?.at ?? run.value?.at ?? null);
const conversationMode = computed(() => record.value?.mode ?? run.value?.mode ?? null);

// ---- 输入框：草稿按对话各存一份 ----
// 换对话时交给视图的草稿总带一个新版本号：输入框只在版本变了时换内容（nb-agent-ui README 的“草稿”）。
const NEW = "";
const composers = new Map<string, ComposerView>();
const baseComposer = createAgentContext({}).composer;
/** 交给过视图的最大版本号：换对话时的新版本要大过它（受理发送时 acceptSubmission 在当前版本上加一）。 */
let shownVersion = baseComposer.draft.version;
function composerOf(id: string | null): ComposerView {
    const saved = composers.get(id ?? NEW) ?? {...baseComposer, modes: id === null ? MODES : [], mode: "graph"};
    shownVersion += 1;
    return {...saved, draft: {...saved.draft, version: shownVersion}};
}
const composer = shallowRef<ComposerView>(composerOf(selectedId.value));
watch(selectedId, id => (composer.value = composerOf(id)));
function setComposer(next: ComposerView): void {
    composers.set(selectedId.value ?? NEW, next);
    shownVersion = Math.max(shownVersion, next.draft.version);
    composer.value = next;
}

const removeOpen = ref(false);
const listOpen = ref(false);

const now = ref(Date.now());
watchEffect(onCleanup => {
    if (!running.value) return;
    const timer = setInterval(() => (now.value = Date.now()), 1000);
    onCleanup(() => clearInterval(timer));
});

const ctx = computed<AgentConversationContext>(() => {
    const state = sourceState.value;
    const id = selectedId.value;
    const canContinue = id === null || (state?.phase === "ready" && state.continuable.ok);
    return createAgentContext({
        session: id === null ? null : {id, title: title.value, summary: "", profileName: "问答", profileIcon: "i-lucide-messages-square", archived: false, summaryState: "idle"},
        availability:
            id !== null && state?.phase === "loading"
                ? {status: "loading", message: "", actions: []}
                : state?.phase === "failed"
                  ? {status: "load-error", message: state.error?.message ?? "读不到这个对话", actions: []}
                  : {status: "ready", message: "", actions: []},
        interaction: {canSend: configured.value === true && canContinue && !running.value && !starting.value, canStop: running.value},
        run: running.value || starting.value ? {status: "running", phase: ""} : {status: "idle", phase: ""},
        messages: state?.messages ?? ([] as MessageView[]),
        composer: composer.value,
        now: now.value,
    });
});

// ---- 操作 ----
function openTarget(target: string): void {
    if (target.startsWith(REF_SCHEME)) book.openSource(target.slice(REF_SCHEME.length));
    else if (target.startsWith("entity://")) book.openCard(target.slice("entity://".length));
}

async function submit(text: string): Promise<void> {
    const question = text.trim();
    if (question === "" || starting.value) return;
    const id = selectedId.value;
    starting.value = true;
    startError.value = null;
    try {
        const started = await client.call("qa.start", {
            book: book.bookId,
            question,
            ...(id === null ? {mode: composer.value.mode === "full" ? ("full" as const) : ("graph" as const), at: book.at.value} : {conversation: id}),
        });
        // 受理了才清空草稿；失败时草稿留着，原因写在输入框上方。新对话的草稿（含输入历史）带到这个对话下，模式只在新对话时可选。
        const accepted = acceptSubmission(composer.value, text);
        if (id === null) {
            composers.delete(NEW);
            composers.set(started.conversation, {...accepted, modes: []});
            book.qaConversation.value = started.conversation;
        } else {
            setComposer(accepted);
            source?.refresh();
        }
        void loadList();
    } catch (error) {
        startError.value = error instanceof Error ? error.message : String(error);
    } finally {
        starting.value = false;
    }
}

async function copy(text: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
    } catch (error) {
        console.warn({error}, "复制失败");
    }
}

/** 答案卡片复制成文字：结论、谁知道什么或分点、依据、说明与覆盖范围。 */
function answerText(args: unknown): string {
    const value = (args ?? {}) as {conclusion?: string; conclusionType?: string; knowledge?: {who: string; state: string; how: string; refs: string[]}[]; points?: {text: string; refs: string[]}[]; evidence?: string[]; explanation?: string; coverage?: string};
    const lines = [`结论（${value.conclusionType ?? ""}）：${value.conclusion ?? ""}`];
    for (const row of value.knowledge ?? []) lines.push(`- ${row.who}：${row.state}。${row.how}（${row.refs.join("、")}）`);
    for (const point of value.points ?? []) lines.push(`- ${point.text}（${point.refs.join("、")}）`);
    lines.push(`依据：${(value.evidence ?? []).join("、")}`, `说明：${value.explanation ?? ""}`, `覆盖范围：${value.coverage ?? ""}`);
    return lines.join("\n");
}

function handle(action: AgentViewAction): void {
    const next = applyComposerAction(composer.value, action);
    if (next !== null) {
        setComposer(next);
        return;
    }
    switch (action.type) {
        case "composer.submit":
            void submit(action.text);
            return;
        case "composer.stop":
            if (selectedId.value !== null) void client.call("qa.stop", {book: book.bookId, conversation: selectedId.value}).catch((error: unknown) => (startError.value = error instanceof Error ? error.message : String(error)));
            return;
        case "session.select":
            book.qaConversation.value = action.sessionId;
            listOpen.value = false;
            return;
        case "session.create":
            book.qaConversation.value = null;
            listOpen.value = false;
            return;
        case "sessions.refresh":
            void loadList();
            return;
        case "reference.open":
            openTarget(action.target);
            return;
        case "link.open":
            window.open(action.href, "_blank", "noopener,noreferrer");
            return;
        case "message.copy": {
            const message = ctx.value.messages.find(item => item.id === action.messageId);
            if (message?.kind === "assistant") void copy(message.text);
            else if (message?.kind === "user") void copy(message.blocks.map(block => (block.kind === "text" ? block.text : "")).join(""));
            return;
        }
        case "tool.copy": {
            const call = ctx.value.messages.flatMap(message => (message.kind === "assistant" ? message.toolCalls : [])).find(item => item.id === action.toolCallId);
            if (call !== undefined) void copy(call.name === "answer" ? answerText(call.args) : (call.result?.text ?? ""));
            return;
        }
        default:
            // 其余（附件、分支、改写历史……）这里不支持，视图也不会给入口。
            return;
    }
}

async function removeConversation(): Promise<void> {
    const id = selectedId.value;
    if (id === null) return;
    try {
        await client.call("qa.remove", {book: book.bookId, id});
        book.qaConversation.value = null;
    } catch (error) {
        startError.value = `删除失败：${error instanceof Error ? error.message : String(error)}`;
    }
    void loadList();
}

// ---- 版式 ----
const wide = computed(() => book.tier.value === "wide");
const behindViewer = computed(() => conversationAt.value !== null && before(book.at.value, conversationAt.value));
const aheadOfViewer = computed(() => conversationAt.value !== null && before(conversationAt.value, book.at.value));
const unsaved = computed(() => {
    const saved = run.value?.saved;
    return run.value?.state === "ended" && saved?.ok === false ? `这一轮没有保存（${saved.reason === "conflict" ? "这个对话在别处被改了或删了" : saved.reason === "book_not_found" ? "书被删了或换了一代" : (saved.message ?? saved.reason)}）` : null;
});
</script>

<template>
    <div class="qa-page" data-qa-page>
        <aside v-if="wide" class="qa-list">
            <AgentSessionList :items="items" :selected-id="selectedId" :state="listState" :error-message="listError" :now="minute" locale="zh-CN" :labels="{title: '对话', create: '新对话', empty: '还没有对话', untitled: '新对话'}" @action="handle" />
        </aside>
        <section class="qa-main">
            <header class="qa-bar">
                <Popover v-if="!wide" v-model:open="listOpen" align="start" content-class="w-[min(340px,92vw)] max-h-[60vh] overflow-y-auto p-0">
                    <template #trigger>
                        <button type="button" class="qa-switch" data-qa-switch>
                            <span class="i-lucide-messages-square shrink-0" />
                            <span class="truncate">{{ selectedId === null ? "新对话" : title || "对话" }}</span>
                            <span class="i-lucide-chevron-down shrink-0 text-[var(--text-muted)]" />
                        </button>
                    </template>
                    <AgentSessionList :items="items" :selected-id="selectedId" :state="listState" :error-message="listError" :now="minute" locale="zh-CN" :header="false" :labels="{empty: '还没有对话', untitled: '新对话'}" @action="handle" />
                </Popover>
                <template v-if="selectedId !== null && conversationAt !== null">
                    <span v-if="wide" class="qa-title" :title="title">{{ title }}</span>
                    <span class="qa-meta">读到 {{ formatAt(conversationAt) }}<template v-if="conversationMode"> · {{ MODE_LABEL[conversationMode] }}</template></span>
                    <span v-if="behindViewer" class="qa-warn" data-qa-ahead><span class="i-lucide-eye" />这个对话读到 {{ formatAt(conversationAt) }}，晚于你现在的位置 {{ formatAt(book.at.value) }}，答案可能含后文</span>
                    <span v-else-if="aheadOfViewer" class="qa-meta">早于你现在的位置 {{ formatAt(book.at.value) }}</span>
                </template>
                <span v-else-if="selectedId === null" class="qa-meta">新对话按你现在的位置 {{ formatAt(book.at.value) }} 回答</span>
                <span class="ml-auto" />
                <Button v-if="running" size="sm" variant="secondary" icon-class="i-lucide-square" data-qa-stop @click="handle({type: 'composer.stop'})">停止</Button>
                <AlertDialog
                    v-if="selectedId !== null"
                    v-model:open="removeOpen"
                    title="删除这个对话"
                    :description="running ? '这个对话正在回答，会先停下再删除。删除后不能恢复。' : '删除后不能恢复。'"
                    confirm-text="删除"
                    tone="danger"
                    @confirm="removeConversation"
                >
                    <template #trigger>
                        <IconButton size="sm" icon-class="i-lucide-trash-2" aria-label="删除这个对话" data-qa-remove />
                    </template>
                </AlertDialog>
                <IconButton v-if="!wide" size="sm" icon-class="i-lucide-square-pen" aria-label="新对话" @click="handle({type: 'session.create'})" />
            </header>

            <div v-if="configured === false || unsaved || sourceState?.detached || sourceState?.logProblem || (selectedId !== null && sourceState?.phase === 'ready' && !sourceState.continuable.ok && !running) || startError || brokenIds.has(selectedId ?? '')" class="qa-notices">
                <Banner v-if="configured === false" tone="warning" title="还没有配置问答用的模型" message="先在设置页填好模型，才能提问。">
                    <RouterLink to="/settings" class="qa-link">去设置</RouterLink>
                </Banner>
                <Banner v-if="brokenIds.has(selectedId ?? '')" tone="error" title="这份记录读不出来" message="只能删除。" />
                <Banner v-if="unsaved" tone="warning" :message="unsaved" data-qa-unsaved />
                <Banner v-if="sourceState?.detached" tone="warning" message="这个对话在别处（命令行）也续问了，这一轮基于较早的记录，结束后不会保存。" />
                <Banner v-if="sourceState?.logProblem" tone="info" :message="`过程没有保留（${sourceState.logProblem}），只显示每一轮的问题与结果。`" />
                <Banner v-else-if="selectedId !== null && sourceState?.phase === 'ready' && !sourceState.continuable.ok && !running" tone="info" :message="`不能续问：${sourceState.continuable.reason}`" />
                <Banner v-if="startError" tone="error" :message="startError" dismissible data-qa-start-error @dismiss="startError = null" />
            </div>

            <div class="qa-view">
                <AgentConversationView :ctx="ctx" :services="{}" :registry="registry" :renderers="renderers" locale="zh-CN" :header="false" process-disclosure="live" @action="handle" />
            </div>
        </section>
    </div>
</template>

<style scoped>
.qa-page { display: flex; height: 100%; min-height: 0; }
.qa-list { width: 280px; flex-shrink: 0; border-right: 1px solid var(--divider); background: var(--panel-surface); min-height: 0; }
.qa-main { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
.qa-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 10px; padding: 8px 16px; border-bottom: 1px solid var(--divider); font-size: var(--text-sm); }
.qa-title { font-weight: var(--weight-strong); color: var(--text-main); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 40%; }
.qa-meta { color: var(--text-muted); font-size: var(--text-xs); }
.qa-warn { display: inline-flex; align-items: center; gap: 4px; color: var(--status-warning); font-size: var(--text-xs); }
.qa-switch { display: flex; align-items: center; gap: 6px; max-width: 60vw; border-radius: var(--radius-control); padding: 2px 6px; font-weight: var(--weight-strong); }
.qa-switch:hover { background: var(--bg-hover); }
.qa-notices { display: flex; flex-direction: column; gap: 6px; padding: 8px 16px 0; }
.qa-link { color: var(--accent-text); }
.qa-view { flex: 1; min-height: 0; }
</style>
