<script setup lang="ts">
/**
 * 设置文件视图（同名 .md，docs/specs/settings/settings-window.md 输出 23）：整份读写当前标签那一层的设置文件。读写经窗口
 * 模型给的路（`window.file(layer)`，远程合同的 `readText`、`writeText`），文本的修订号变了由 `watch` 通知。
 *
 * - 草稿与读出的原文分开记：有改动（草稿与原文不同）时算未保存，报给窗口的未保存保护；别处改了文件时，没有改动就重读，
 *   有改动就只提示，不覆盖这里的草稿。换标签就是换一个文件：丢掉草稿、重读（有改动时窗口先确认过）。
 * - 换行：`textarea.value` 总把换行归一成 `\n`，光标位置也按它算。草稿与原文都存归一后的文本，读到 CRLF 的文件时记下，
 *   保存时换回去，否则一次保存会改掉整个文件的换行。
 * - 只有第一次读时显示“正在读取”；之后的重读原地换文本，文本框不卸载，焦点与滚动位置不丢。
 * - 读取进行中收到的修订号先记下，读完再和读到的比：读取与事件在链路上可能乱序，读回来的可能已经过时。
 * - 文本事件的订阅随连接结束：这一层从“连不上”恢复时重新订阅，并重新核对一次（没有改动就重读，有改动就看修订号）。
 * - 行号：文本框不自动换行，一行文字就是一行行号，所以行号列是另画的一列（`aria-hidden`），垫在透明的文本框底下，跟着文本框的
 *   `scroll` 事件平移。不把两者放进同一个滚动容器：文本框要保持原生的 `textarea`（光标、选区、撤销栈、输入法都靠它），它的
 *   内容尺寸由浏览器管，外面套不了容器。同步用 `transform` 而不是给行号列设 `scrollTop`：横向滚动条占掉的高度会让文本框
 *   的最大 `scrollTop` 比行号列多一截，`scrollTop` 会被夹住，最后几行错位；`transform` 不受这个限制。两边用同一个整数行高。
 * - 出错行：保存被拒（`invalid-text`）与从层警告进来时，那一行在行号列与文本行上都垫一条危险色的淡底，底也在文本框底下，
 *   跟着同一次平移；改了文本就去掉（位置是那一刻的）。保存被拒的文字写在窗口的标题区右侧（经 `page-chrome` 的 `claimNote`），
 *   这里只留一份给读屏用的文字，接进文本框的 `aria-describedby`。
 * - 从层警告进来时窗口模型留着一个待定位的位置（输出 13）：第一次读完文件后取走、把光标放过去，只用一次；已经在这个视图里
 *   时（位置是后来才挂上的）就地定位。取走之后模型里没有了，之后的重读、换标签不会再跳。
 */
import {Button, Kbd, Spinner, Textarea} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";
import {computed, nextTick, onBeforeUnmount, ref, useId, watch} from "vue";

import {currentKeyPlatform} from "nbook/plugins/commands/shared/contracts";
import type {SettingLayer, SettingsFailure} from "nbook/shared/settings";
import {usePageChrome} from "nbook/ui/settings/page-chrome";
import SettingsSaveBar from "nbook/ui/settings/SettingsSaveBar.vue";
import {settingsFailureText} from "nbook/ui/settings/setting-text";

import type {LayerTextPosition} from "../../shared/layers";
import {useSettingsText} from "../text";
import {composing, isModKey} from "../keys";
import type {SettingsWindow} from "../settings-window";

defineOptions({name: "SettingsFileView"});

const props = defineProps<{
    window: SettingsWindow;
    layer: SettingLayer;
    /** 这一层的文件路径；用户层不带（状态根不发给浏览器）。 */
    path: string | null;
}>();

const port = useText();
const text = useSettingsText();

const textareaId = `settings-file-${useId()}`;
const hintId = `${textareaId}-hint`;
const errorId = `${textareaId}-error`;
/** 保存键的修饰键：macOS 是 Command，其它平台是 Ctrl（与 `isModKey` 同一个判断）。 */
const modKeyLabel = currentKeyPlatform() === "mac" ? "⌘" : "Ctrl";

type ViewState = {readonly kind: "loading"} | {readonly kind: "read-failed"; readonly detail: string} | {readonly kind: "ready"};

const root = ref<HTMLElement | null>(null);
const state = ref<ViewState>({kind: "loading"});
/** 读出或保存成功时的原文（换行归一成 `\n`）与它的修订号。 */
const base = ref("");
const revision = ref("");
const draft = ref("");
/** 文件原来用 CRLF 换行：保存时换回去。 */
let crlf = false;
const saving = ref(false);
const failure = ref<{readonly code: SettingsFailure; readonly message: string} | null>(null);
/** 出错的位置（保存被拒或从层警告进来）：那一行标出错底色；文本一改就去掉，位置只对那一刻的文本准。 */
const errorAt = ref<LayerTextPosition | null>(null);
/** 文本框纵向滚了多少：行号列与出错行的底跟着平移。 */
const scrollTop = ref(0);
/** 有改动时别处改了文件：只提示，等用户重新读取或仍然保存。 */
const changedElsewhere = ref(false);

const dirty = computed(() => state.value.kind === "ready" && draft.value !== base.value);
const unreachable = computed(() => props.window.layerNotice.value?.kind === "unavailable");
const chrome = usePageChrome();
const lineCount = computed(() => draft.value.split("\n").length);
/** 行号列至少留两位数的宽，行数涨到三位、四位时随之加宽。 */
const gutterDigits = computed(() => Math.max(2, String(lineCount.value).length));
/** 保存被拒的文字写在标题区右侧时，框里只留一份给读屏的文字；没有窗口通道时没有别处可写，照常显示。 */
const errorInHeading = computed(() => failure.value?.code === "invalid-text" && chrome !== null);
const describedby = computed(() => [hintId, failure.value === null ? null : errorId].filter((id) => id !== null).join(" "));

const textarea = (): HTMLTextAreaElement | null => root.value?.querySelector<HTMLTextAreaElement>("[data-settings-file-text]") ?? null;

/** 每次读都带一个序号：换了标签（换了文件）之后，前一次读的结果作废。 */
let readToken = 0;
let stopWatch: (() => void) | null = null;
/** 读取进行中收到的最新修订号；没有为 null。 */
let pendingRevision: string | null = null;

async function load(): Promise<void> {
    const token = (readToken += 1);
    const file = props.window.file(props.layer);
    if (file === undefined) return;
    if (state.value.kind !== "ready") state.value = {kind: "loading"};
    pendingRevision = null;
    reading = true;
    const result = await file.read().finally(() => {
        if (token === readToken) reading = false;
    });
    if (token !== readToken) return;
    failure.value = null;
    changedElsewhere.value = false;
    if (!result.ok) {
        state.value = {kind: "read-failed", detail: result.detail};
        return;
    }
    crlf = result.text.includes("\r\n");
    const normalized = result.text.replace(/\r\n/gu, "\n");
    const area = textarea();
    const scroll = area?.scrollTop ?? 0;
    base.value = normalized;
    draft.value = normalized;
    revision.value = result.revision;
    state.value = {kind: "ready"};
    // 原地换了文本：滚动位置留着（夹在新文本的范围里由浏览器做）。换了层时文本框是新建的、从顶上起；两种情况行号列都跟着
    // 文本框实际的滚动量，不留上一个文本框的。
    void nextTick(() => {
        const now = textarea();
        if (now !== null && now === area) now.scrollTop = scroll;
        scrollTop.value = now?.scrollTop ?? 0;
    });
    // 读的时候文件又变了：读回来的已经过时，再读一次；待定位的位置留给重读的最新文本。
    if (pendingRevision !== null && pendingRevision !== result.revision) {
        void load();
        return;
    }
    void locate();
}

/** 正在读：这时收到的修订号记下，读完再比。 */
let reading = false;

/** 收到别处的修订号：读取中先记下；没有改动就重读；有改动只提示。 */
function onRevision(next: string): void {
    if (reading) {
        pendingRevision = next;
        return;
    }
    if (next === revision.value || state.value.kind !== "ready") return;
    if (dirty.value) changedElsewhere.value = true;
    else void load();
}

function follow(): void {
    stopWatch?.();
    stopWatch = props.window.file(props.layer)?.watch(onRevision) ?? null;
}

watch(() => props.layer, () => {
    state.value = {kind: "loading"};
    follow();
    void load();
}, {immediate: true});
watch(dirty, (value) => props.window.fileDirty(value), {immediate: true});
// 位置是视图已经读完之后才挂上的（文件分区里再次定位）：就地定位；还在读时由 `load` 读完后取。
watch(() => props.window.fileLocation.value, (pending) => {
    if (pending !== null && state.value.kind === "ready") void locate();
});
// 连接恢复：文本事件的订阅已经随断开结束，重新订阅；订阅先推一次当前修订号，`onRevision` 据此核对。
watch(() => props.window.layerNotice.value?.kind === "unavailable", (unavailable, before) => {
    if (before === true && !unavailable) follow();
});
// 出错的位置是保存那一刻的；改了文本就不再准，标记随之去掉，下次保存再说。
watch(draft, () => {
    if (failure.value?.code === "invalid-text") failure.value = null;
    errorAt.value = null;
});
// 保存被拒的文字写到标题区右侧（输出 13）；失败消失或视图卸载时撤销这一次登记。
watch(() => (failure.value?.code === "invalid-text" ? failure.value.message : null), (message, _before, onCleanup) => {
    if (message === null || chrome === null) return;
    onCleanup(chrome.claimNote(message));
}, {immediate: true});
onBeforeUnmount(() => {
    readToken += 1;
    stopWatch?.();
    props.window.fileDirty(false);
});

/**
 * 取走窗口留着的定位并把光标放过去，行落在文本框中间；没有待定位的位置时什么也不做。文本框要等这一轮渲染之后才拿得到
 * （第一次读完时它刚从“正在读取”换出来）。
 */
async function locate(): Promise<void> {
    const position = props.window.takeFileLocation(props.layer);
    if (position === null) return;
    await nextTick();
    // 在 `await` 之后设：`load` 刚换过草稿，草稿的监听在这一轮渲染里已经跑完，不会把这一行的标记又清掉。
    errorAt.value = position;
    const area = textarea();
    if (area === null) return;
    const at = offsetOf(draft.value, position);
    area.focus();
    area.setSelectionRange(at, at);
    // 浏览器不保证光标可见：按行高把出错的那一行放到文本框中间。取不到行高（不是数）时留给浏览器。
    const lineHeight = Number.parseFloat(getComputedStyle(area).lineHeight);
    if (Number.isFinite(lineHeight)) area.scrollTop = Math.max(0, (position.line - 1) * lineHeight - area.clientHeight / 2);
}

/** 把行与列（从 1 起，列按 UTF-16 码元）换成归一后文本里的偏移。 */
function offsetOf(content: string, position: LayerTextPosition): number {
    let offset = 0;
    for (let line = 1; line < position.line; line += 1) {
        const next = content.indexOf("\n", offset);
        if (next === -1) return content.length;
        offset = next + 1;
    }
    return Math.min(offset + position.column - 1, content.length);
}

async function write(content: string, against: string): Promise<void> {
    const file = props.window.file(props.layer);
    if (file === undefined) return;
    saving.value = true;
    const token = readToken;
    try {
        const result = await file.write(crlf ? content.replace(/\n/gu, "\r\n") : content, against);
        if (token !== readToken) return;
        if (!result.ok) {
            if (result.code === "invalid-text" && result.position !== undefined) {
                failure.value = {code: result.code, message: text("file.invalidText", {line: result.position.line, column: result.position.column, detail: result.detail})};
                errorAt.value = result.position;
                // 把光标放到出错的地方，不用自己数行列。
                const at = offsetOf(content, result.position);
                const area = textarea();
                area?.focus();
                area?.setSelectionRange(at, at);
            } else {
                failure.value = {code: result.code, message: result.code === "conflict" ? text("file.conflict") : text("file.failed", {detail: settingsFailureText(result.code, result.detail, port)})};
            }
            return;
        }
        base.value = content;
        revision.value = result.revision;
        failure.value = null;
        changedElsewhere.value = false;
        // 保存后按钮停用，停用的按钮留不住焦点：放回文本框。
        textarea()?.focus();
    } finally {
        saving.value = false;
    }
}

async function save(): Promise<void> {
    if (saving.value || !dirty.value || unreachable.value) return;
    await write(draft.value, revision.value);
}

/** 冲突时用户选择盖掉别处的改动：拿当前的修订号再写一次（拿到之后又被改了，照常报冲突）。 */
async function saveAnyway(): Promise<void> {
    const file = props.window.file(props.layer);
    if (file === undefined || saving.value || unreachable.value) return;
    const fresh = await file.read();
    if (!fresh.ok) {
        failure.value = {code: fresh.code, message: text("file.failed", {detail: settingsFailureText(fresh.code, fresh.detail, port)})};
        return;
    }
    await write(draft.value, fresh.revision);
}

async function reread(): Promise<void> {
    await load();
    textarea()?.focus();
}

function discard(): void {
    draft.value = base.value;
    failure.value = null;
    changedElsewhere.value = false;
    textarea()?.focus();
}

function onScroll(event: Event): void {
    scrollTop.value = (event.target as HTMLTextAreaElement).scrollTop;
}

/** 刚按过 Esc：下一个 Tab 照常移焦点，不插空格（键盘用户离开文本框的出口）；再按一次 Esc 才交给窗口（关窗口）。 */
let escaped = false;

function onRootKeydown(event: KeyboardEvent): void {
    if (composing(event) || !isModKey(event, "KeyS")) return;
    event.preventDefault();
    void save();
}

function onKeydown(event: KeyboardEvent): void {
    if (composing(event)) return;
    if (event.key === "Escape") {
        // 第一次 Esc 只“放开 Tab”：拦下，窗口的 Esc 关闭看到已处理就不关。
        if (!escaped) event.preventDefault();
        escaped = true;
        return;
    }
    const plainTab = event.key === "Tab" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (!plainTab || escaped) {
        escaped = false;
        return;
    }
    const target = event.target as HTMLTextAreaElement;
    // 只读时、选中了一段时照常移焦点：插入会把选中的内容换掉。
    if (target.readOnly || target.selectionStart !== target.selectionEnd) return;
    event.preventDefault();
    // `insertText` 走浏览器的编辑，撤销栈留着，`input` 事件让草稿跟上；不支持时直接改草稿。
    if (document.execCommand?.("insertText", false, "  ") === true) return;
    const start = target.selectionStart;
    draft.value = `${draft.value.slice(0, start)}  ${draft.value.slice(start)}`;
    void nextTick(() => target.setSelectionRange(start + 2, start + 2));
}
</script>

<template>
    <div ref="root" class="settings-file" data-settings-file :data-settings-file-state="state.kind" @keydown="onRootKeydown">
        <code v-if="path !== null" class="settings-file__path" data-settings-file-path>{{ path }}</code>
        <div v-if="state.kind === 'loading'" class="settings-file__notice" role="status" aria-live="polite">
            <Spinner size="sm" />
            <span>{{ text("file.loading") }}</span>
        </div>
        <div v-else-if="state.kind === 'read-failed'" class="settings-file__notice settings-file__notice--error" role="alert">
            <span>{{ text("file.readFailed", {detail: state.detail}) }}</span>
            <Button size="sm" variant="secondary" @click="reread">{{ text("file.reread") }}</Button>
        </div>
        <template v-else>
            <label :for="textareaId" class="settings-file__visually-hidden">{{ text("file.label", {layer: text(layer === "user" ? "file.user" : "file.project")}) }}</label>
            <p v-if="changedElsewhere" class="settings-file__notice settings-file__notice--warning" role="status" data-settings-file-changed>
                <span>{{ text("file.changedElsewhere") }}</span>
                <Button size="sm" variant="secondary" @click="reread">{{ text("file.reread") }}</Button>
                <Button size="sm" variant="secondary" :disabled="saving || unreachable" @click="saveAnyway">{{ text("file.saveAnyway") }}</Button>
            </p>
            <p
                v-if="failure !== null"
                :id="errorId"
                class="settings-file__notice settings-file__notice--error"
                :class="{'settings-file__visually-hidden': errorInHeading}"
                :role="errorInHeading ? undefined : 'alert'"
                data-settings-file-error
            >
                <span>{{ failure.message }}</span>
                <template v-if="failure.code === 'conflict'">
                    <Button size="sm" variant="secondary" @click="reread">{{ text("file.reread") }}</Button>
                    <Button size="sm" variant="secondary" :disabled="saving || unreachable" @click="saveAnyway">{{ text("file.saveAnyway") }}</Button>
                </template>
            </p>
            <!-- 外框画在这一层：行号列与出错行的底垫在透明的文本框底下，文本框自己不再带描边与底色。聚焦、只读、出错的外观仍由 nb-ui 的控件基座按外框给。 -->
            <div class="settings-file__editor nb-ui-control" :class="{'nb-ui-control-invalid': errorAt !== null}" :style="{'--settings-file-digits': gutterDigits}" data-settings-file-editor>
                <div class="settings-file__layer" aria-hidden="true">
                    <div class="settings-file__lines" :style="{transform: `translateY(${-scrollTop}px)`}" data-settings-file-lines>
                        <div v-for="line in lineCount" :key="line" class="settings-file__line" :data-error="errorAt?.line === line ? '' : undefined" data-settings-file-line>
                            <span class="settings-file__number">{{ line }}</span>
                        </div>
                    </div>
                </div>
                <Textarea
                    :id="textareaId"
                    v-model="draft"
                    class="settings-file__text"
                    data-settings-file-text
                    :rows="6"
                    :readonly="unreachable"
                    :invalid="errorAt !== null"
                    spellcheck="false"
                    autocapitalize="off"
                    :aria-describedby="describedby"
                    @keydown="onKeydown"
                    @scroll="onScroll"
                />
            </div>
            <p :id="hintId" class="settings-file__keys" data-settings-file-keys>
                <span class="settings-file__key"><Kbd>Tab</Kbd>{{ text("file.tabKey") }}</span>
                <span class="settings-file__key"><Kbd>Esc</Kbd>{{ text("file.escThen") }}<Kbd>Tab</Kbd>{{ text("file.escTabKey") }}</span>
                <span class="settings-file__key"><Kbd>{{ modKeyLabel }}</Kbd><Kbd>S</Kbd>{{ text("file.saveKey") }}</span>
            </p>
            <!-- 保存栏在视图底部（视图占满窗口给的区域，栏不随内容滚走）：按钮一直在，没有改动时停用，焦点不会因为它消失而掉到页面上。连不上时与保存中一样停用。 -->
            <SettingsSaveBar :dirty="dirty" :busy="saving" :can-save="!unreachable" data-settings-file-actions @save="save" @discard="discard" />
        </template>
    </div>
</template>

<style scoped>
/* 占满窗口给的整块区域（fill）：文本框吃掉剩下的高度，保存栏在最下面。 */
.settings-file {
    display: flex;
    height: 100%;
    min-height: 0;
    box-sizing: border-box;
    flex-direction: column;
    gap: var(--space-3);
}

.settings-file__path {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--text-secondary);
    overflow-wrap: anywhere;
}

/* 给读屏用、不画出来的文字：文本框的名字，以及保存被拒的原因（可见的那份在窗口标题区右侧）。 */
.settings-file__visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    border: 0;
    clip-path: inset(50%);
    white-space: nowrap;
}

/*
 * 行号与文本框共用一个整数像素的行高：行号列是另画的，两边的行高差零点几像素，几十行之后就错开一整行。`round()` 不支持时
 * （旧浏览器）退回小数行高，仍然能用，只是长文件末尾可能差一点。
 */
.settings-file__editor {
    --settings-file-line: calc(var(--text-sm) * 1.6);
    --settings-file-pad: var(--space-4);
    /* 行号列的宽：位数个字宽，加上两边的空隙。 */
    --settings-file-gutter: calc(var(--settings-file-digits) * 1ch + var(--space-4) + var(--space-5));

    position: relative;
    display: flex;
    /* 随窗口高度伸缩；窗口很矮时至少留几行可编辑。文本框在这一行里被拉满高度（行内的 stretch），自己滚动。 */
    min-height: calc(6 * var(--settings-file-line) + 2 * var(--settings-file-pad));
    flex: 1 1 0;
    border-width: var(--border-w);
    border-style: solid;
    border-radius: var(--radius-control);
    background: var(--control-surface);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: var(--settings-file-line);
}

@supports (line-height: round(nearest, 1.6px, 1px)) {
    .settings-file__editor {
        --settings-file-line: round(nearest, calc(var(--text-sm) * 1.6), 1px);
    }
}

/* 垫在文本框底下的一层：不接收指针，行号与出错行的底在里面跟着文本框平移。 */
.settings-file__layer {
    position: absolute;
    inset: 0;
    overflow: hidden;
    /* 圆角随外框的内圆角：出错行的底是整行的矩形，不能越出外框的圆角；外框自己不设 overflow，免得裁掉里面控件的辉光。 */
    border-radius: calc(var(--radius-control) - var(--border-w));
    pointer-events: none;
}

.settings-file__lines {
    padding: var(--settings-file-pad) 0;
}

.settings-file__line {
    height: var(--settings-file-line);
    white-space: pre;
}

.settings-file__line[data-error] {
    background: color-mix(in srgb, var(--status-danger) 10%, transparent);
}

.settings-file__number {
    display: block;
    width: var(--settings-file-gutter);
    box-sizing: border-box;
    padding-right: var(--space-5);
    color: var(--text-muted);
    text-align: right;
    user-select: none;
}

.settings-file__line[data-error] .settings-file__number {
    color: var(--status-danger);
}

/* 文本框透明，躺在行号列右边：描边、底色与聚焦辉光都已经在外框上。nb-ui 的样式在层里，这里不分层，直接覆盖。 */
.settings-file__text {
    position: relative;
    min-width: 0;
    flex: 1 1 auto;
    width: auto;
    height: auto;
    margin-left: var(--settings-file-gutter);
    resize: none;
    padding: var(--settings-file-pad) var(--space-4) var(--settings-file-pad) 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    font: inherit;
    tab-size: 4;
    white-space: pre;
    overflow-wrap: normal;
}

.settings-file__keys {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-6);
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--text-muted);
}

.settings-file__key {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
}

.settings-file__notice {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--text-secondary);
}

.settings-file__notice--warning {
    color: var(--status-warning);
}

.settings-file__notice--error {
    color: var(--status-danger);
}
</style>
