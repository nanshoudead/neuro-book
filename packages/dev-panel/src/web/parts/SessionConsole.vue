<script setup lang="ts">
import {Badge, Button, FormTextarea} from "@notnotype/nb-ui/components";
import {computed, ref, watch} from "vue";
import {HERDR_STATUS_LABEL, relativeTime, shortSession} from "../host/format.js";

/** 一个会话的屏幕与贴在它下面的输入区（投递结果、能不能发、输入框、按键）；契约见同名 .md。 */
const props = withDefaults(defineProps<{
    session: {sessionKey: string; paneId: string; agent: string | null; status: string};
    screen: string | null;
    screenAt: string | null;
    disabledReason: string | null;
    pending: boolean;
    resetKey: number;
    /** 屏幕由插槽给（t12 的实时终端），不显示快照与“重读屏幕”。 */
    live?: boolean;
    /** 正在接管键盘：不给输入框（直接在终端里打），按钮单击即发。 */
    controlling?: boolean;
    /** 同一格 pane 换了会话、草稿留着时的一行提示（发出去会发给新会话）。 */
    sessionChange?: string | null;
}>(), {live: false, controlling: false, sessionChange: null});
const emit = defineEmits<{refresh: []; prompt: [text: string]; key: [key: string]}>();
/** 输入框里 Ctrl+Enter（Mac 上 ⌘+Enter）发送，Enter 换行。 */
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/u.test(navigator.platform);
const sendShortcut = isMac ? "⌘+Enter" : "Ctrl+Enter";
function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "Enter" || event.isComposing || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    send();
}

const MAX = 4000;
const draft = ref("");
watch(() => props.resetKey, () => {
    draft.value = "";
});
/** `hint` 是不接管时的说明（经接口发，要确认的键先给屏幕再确认）；`controlHint` 是接管中的说明（经终端连接，单击即发、不限速）。 */
/** `confirm`：不接管时要先给开发者看屏幕再发的键（与 host/session-console.ts 的 KEY_CONFIRM 一致）。 */
const KEYS: Array<{key: string; label: string; hint: string; controlHint: string; confirm: boolean}> = [
    {key: "up", label: "↑", hint: "上（翻历史、选上一项）", controlHint: "上（接管中，单击即发）", confirm: false},
    {key: "down", label: "↓", hint: "下（选下一项）", controlHint: "下（接管中，单击即发）", confirm: false},
    {key: "shift+tab", label: "Shift+Tab", hint: "切换权限模式（要确认）", controlHint: "切换权限模式（接管中，单击即发）", confirm: true},
    {key: "enter", label: "Enter", hint: "回车：会确认确认界面上的缺省项（要确认）", controlHint: "回车（接管中，单击即发）", confirm: true},
    {key: "esc", label: "Esc", hint: "打断这一轮（要确认）", controlHint: "打断这一轮（接管中，单击即发）", confirm: true},
    {key: "ctrl+c", label: "Ctrl+C", hint: "打断；连按两次 Claude 会退出，3 秒内只能按一次（要确认）", controlHint: "打断；连按两次 Claude 会退出（接管中，单击即发）", confirm: true},
    {key: "y", label: "y", hint: "回答确认界面（未核实是否有效，要确认）", controlHint: "y（接管中，单击即发）", confirm: true},
    {key: "n", label: "n", hint: "回答确认界面（未核实是否有效，要确认）", controlHint: "n（接管中，单击即发）", confirm: true},
];
const idle = computed(() => props.session.status === "idle" || props.session.status === "done");
/**
 * 不能发文字的原因。`line` 为真的单独占一行（整块不可用、等确认：要开发者去做点什么）；
 * 工作中这类只是“等一会儿”的写进禁用输入框的 placeholder（t17）：会话在工作与空闲之间来回时不多出、少掉一行，终端不跟着变高变矮。
 */
const promptBlocked = computed<{text: string; line: boolean} | null>(() => {
    if (props.disabledReason) return {text: props.disabledReason, line: true};
    if (props.session.status === "blocked") return {text: "会话在等确认：用下面的按键回应", line: true};
    if (props.session.status === "working") return {text: "会话在工作中：空闲之后才能发文字（不排队）", line: false};
    if (!idle.value) return {text: `会话状态是${HERDR_STATUS_LABEL[props.session.status] ?? props.session.status}：空闲之后才能发文字`, line: false};
    return null;
});
/** 输入框缺省只有一行：placeholder 要短到手机上一行放得下（原来那句“替你在它的输入框里打字并回车”写进了同名 .md 与读屏说明）。 */
const placeholder = computed(() => (promptBlocked.value ? promptBlocked.value.text : `发给这个会话的文字（${sendShortcut} 发送）`));
/** 输入框的行数只由草稿的换行数决定（1 到 4 行），聚焦、失焦不改布局。 */
const rows = computed(() => Math.min(4, Math.max(1, draft.value.split("\n").length)));
/** 字数只在接近上限（八成以上）时显示。 */
const showCount = computed(() => draft.value.length > MAX * 0.8);
const canSend = computed(() => promptBlocked.value === null && !props.pending && draft.value.trim() !== "" && draft.value.length <= MAX);
function send(): void {
    if (canSend.value) emit("prompt", draft.value);
}
</script>

<template>
    <section class="flex min-h-0 flex-1 flex-col" :aria-label="`会话 ${shortSession(session.sessionKey)} 的屏幕与输入`">
        <div v-if="!live" class="nbdev-term-snapshot-bar nbdev-small flex items-center gap-2 px-3 py-2">
            <span class="nbdev-secondary">屏幕快照<template v-if="screenAt"> · 读于 {{ relativeTime(screenAt) }}</template></span>
            <Button class="ml-auto" size="sm" variant="ghost" icon-class="i-lucide-rotate-cw" :disabled="pending || disabledReason !== null" @click="emit('refresh')">重读屏幕</Button>
        </div>
        <slot name="screen">
            <pre class="nbdev-pre min-h-0 flex-1 overflow-auto p-3" aria-label="屏幕末尾">{{ screen ?? "还没读到屏幕" }}</pre>
        </slot>
        <!-- 输入区贴在终端下面：结果、能不能发、输入框、按键一屏内都看得到（ux-b F3）。 -->
        <div class="nbdev-dock nbdev-divider flex shrink-0 flex-col gap-2 border-t px-3 py-2.5">
            <slot name="result" />
            <p v-if="sessionChange && !controlling" class="nbdev-warn nbdev-small" role="status">{{ sessionChange }}</p>
            <p v-if="controlling" class="nbdev-note">接管中输入框收起：直接在上面的终端里打字。15 分钟没有输入自动释放。</p>
            <p v-else-if="promptBlocked?.line" class="nbdev-note flex flex-wrap items-center gap-2">
                <Badge tone="neutral" variant="soft" size="sm">{{ HERDR_STATUS_LABEL[session.status] ?? session.status }}</Badge>{{ promptBlocked.text }}
            </p>
            <!-- 输入框独占一行；发送与字数在下面按键那一行的右端，右列不再比一行输入框高（t17）。 -->
            <FormTextarea v-if="!controlling" v-model="draft" :rows="rows" :maxlength="MAX" :disabled="promptBlocked !== null" :placeholder="placeholder" aria-label="发给会话的文字" aria-description="替你在这个会话的输入框里打字并回车" style="resize: none" @keydown="onKeydown" />
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <div class="flex min-w-0 flex-wrap items-center gap-1.5" role="group" aria-label="按键">
                    <span class="nbdev-note">按键{{ controlling ? "（接管中单击即发）" : "" }}：</span>
                    <Button v-for="entry in KEYS" :key="entry.key" size="sm" variant="secondary" :title="controlling ? entry.controlHint : entry.hint" :aria-label="controlling ? entry.controlHint : entry.hint" :disabled="pending || (disabledReason !== null && !controlling)" @click="emit('key', entry.key)">{{ entry.label }}<span v-if="!controlling && entry.confirm" class="nbdev-confirm-mark" aria-hidden="true">确认</span></Button>
                    <span v-if="!controlling" class="nbdev-caption nbdev-key-note">带“确认”的键先给你看屏幕再发</span>
                </div>
                <div v-if="!controlling" class="ml-auto flex items-center gap-2">
                    <span v-if="showCount" class="nbdev-caption nbdev-num" :class="{'nbdev-warn': draft.length >= MAX}">{{ draft.length }} / {{ MAX }}</span>
                    <Button size="sm" variant="primary" :disabled="!canSend" :loading="pending" :aria-keyshortcuts="isMac ? 'Meta+Enter' : 'Control+Enter'" @click="send">发送 <kbd class="nbdev-send-kbd">{{ sendShortcut }}</kbd></Button>
                </div>
            </div>
        </div>
    </section>
</template>

<style scoped>
.nbdev-dock, .nbdev-term-snapshot-bar {
    background: var(--panel-surface);
}
/* 按键那一行放不下说明时收起说明，发送按钮留在这一行的右端，不为一句说明多占一行（t17）；
   说明在各键的提示与读屏名里还有（“要确认”）。54rem 约是按键、说明与发送按钮排成一行要的宽度。 */
.nbdev-dock {
    container-type: inline-size;
}
@container (max-width: 54rem) {
    .nbdev-key-note {
        display: none;
    }
}
/* 再窄一些（中档的详情栏）时发送按钮里不写组合键：输入框的 placeholder 与按钮的 aria-keyshortcuts 里都有。 */
@container (max-width: 46rem) {
    .nbdev-send-kbd {
        display: none;
    }
}
.nbdev-send-kbd {
    margin-left: 0.25em;
    font-family: var(--font-mono);
    font-size: 0.85em;
    opacity: 0.85;
}
.nbdev-confirm-mark {
    margin-left: 0.25em;
    font-size: 0.75em;
    color: var(--status-warning);
}
</style>
