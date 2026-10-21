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
 */
import {Button, Spinner, Textarea} from "@notnotype/nb-ui/components";
import {computed, nextTick, onBeforeUnmount, ref, useId, watch} from "vue";

import {currentKeyPlatform} from "nbook/plugins/commands/shared/contracts";
import {formatText, localize} from "nbook/shared/localized-text";
import type {LocalizedText} from "nbook/shared/localized-text";
import type {SettingLayer, SettingsFailure} from "nbook/shared/settings";
import {settingsFailureText} from "nbook/ui/settings/setting-text";

import type {LayerTextPosition} from "../../shared/layers";
import {composing, isModKey} from "../keys";
import type {SettingsWindow} from "../settings-window";

defineOptions({name: "SettingsFileView"});

const props = defineProps<{
    window: SettingsWindow;
    layer: SettingLayer;
    /** 这一层的文件路径；用户层不带（状态根不发给浏览器）。 */
    path: string | null;
}>();

const TEXT = {
    label: {"zh-CN": "设置文件（{layer}）", "en-US": "Settings file ({layer})"},
    user: {"zh-CN": "用户", "en-US": "User"},
    project: {"zh-CN": "本作品", "en-US": "This Book"},
    hint: {"zh-CN": "Tab 插入两个空格；先按 Esc 再按 Tab 移到下一个控件；{save} 保存", "en-US": "Tab inserts two spaces; press Esc, then Tab, to move on; {save} saves"},
    loading: {"zh-CN": "正在读取设置文件", "en-US": "Reading the settings file"},
    readFailed: {"zh-CN": "读不了设置文件：{detail}", "en-US": "Could not read the settings file: {detail}"},
    reread: {"zh-CN": "重新读取", "en-US": "Read Again"},
    save: {"zh-CN": "保存", "en-US": "Save"},
    saveAnyway: {"zh-CN": "仍然保存", "en-US": "Save Anyway"},
    discard: {"zh-CN": "放弃改动", "en-US": "Discard Changes"},
    unsaved: {"zh-CN": "有没保存的改动", "en-US": "Unsaved changes"},
    changedElsewhere: {"zh-CN": "文件在别处改过了；“重新读取”会丢掉这里的改动，“仍然保存”会盖掉别处的改动", "en-US": "The file was changed elsewhere; reading it again discards your changes here, saving anyway overwrites the other changes"},
    conflict: {"zh-CN": "没有保存：文件在别处改过了；“重新读取”会丢掉这里的改动，“仍然保存”会盖掉别处的改动", "en-US": "Not saved: the file was changed elsewhere; reading it again discards your changes here, saving anyway overwrites the other changes"},
    invalidText: {"zh-CN": "没有保存：第 {line} 行第 {column} 列：{detail}", "en-US": "Not saved: line {line}, column {column}: {detail}"},
    failed: {"zh-CN": "没有保存：{detail}", "en-US": "Not saved: {detail}"},
} satisfies Record<string, LocalizedText>;

const locale = props.window.locale;
const text = (template: LocalizedText, params: Readonly<Record<string, string | number>> = {}): string => localize(formatText(template, params), locale.value);

const textareaId = `settings-file-${useId()}`;
const hintId = `${textareaId}-hint`;
const errorId = `${textareaId}-error`;
const saveKey = currentKeyPlatform() === "mac" ? "⌘S" : "Ctrl+S";

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
/** 有改动时别处改了文件：只提示，等用户重新读取或仍然保存。 */
const changedElsewhere = ref(false);

const dirty = computed(() => state.value.kind === "ready" && draft.value !== base.value);
const unreachable = computed(() => props.window.layerNotice.value?.kind === "unavailable");
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
    // 原地换了文本：滚动位置留着（夹在新文本的范围里由浏览器做）。
    if (area !== null) void nextTick(() => {
        area.scrollTop = scroll;
    });
    // 读的时候文件又变了：读回来的已经过时，再读一次。
    if (pendingRevision !== null && pendingRevision !== result.revision) void load();
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
// 连接恢复：文本事件的订阅已经随断开结束，重新订阅；订阅先推一次当前修订号，`onRevision` 据此核对。
watch(() => props.window.layerNotice.value?.kind === "unavailable", (unavailable, before) => {
    if (before === true && !unavailable) follow();
});
// 出错的位置是保存那一刻的；改了文本就不再准，标记随之去掉，下次保存再说。
watch(draft, () => {
    if (failure.value?.code === "invalid-text") failure.value = null;
});
onBeforeUnmount(() => {
    readToken += 1;
    stopWatch?.();
    props.window.fileDirty(false);
});

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
                failure.value = {code: result.code, message: text(TEXT.invalidText, {line: result.position.line, column: result.position.column, detail: result.detail})};
                // 把光标放到出错的地方，不用自己数行列。
                const at = offsetOf(content, result.position);
                const area = textarea();
                area?.focus();
                area?.setSelectionRange(at, at);
            } else {
                failure.value = {code: result.code, message: result.code === "conflict" ? text(TEXT.conflict) : text(TEXT.failed, {detail: settingsFailureText(result.code, result.detail, locale.value)})};
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
        failure.value = {code: fresh.code, message: text(TEXT.failed, {detail: settingsFailureText(fresh.code, fresh.detail, locale.value)})};
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
            <span>{{ text(TEXT.loading) }}</span>
        </div>
        <div v-else-if="state.kind === 'read-failed'" class="settings-file__notice settings-file__notice--error" role="alert">
            <span>{{ text(TEXT.readFailed, {detail: state.detail}) }}</span>
            <Button size="sm" variant="secondary" @click="reread">{{ text(TEXT.reread) }}</Button>
        </div>
        <template v-else>
            <!-- 操作行在文本框上面：文本框很长，放在下面时有改动也看不到按钮。按钮一直在，没有改动时停用，焦点不会因为它消失而掉到页面上。 -->
            <div class="settings-file__toolbar" data-settings-file-actions>
                <label :for="textareaId" class="settings-file__label">{{ text(TEXT.label, {layer: text(layer === "user" ? TEXT.user : TEXT.project)}) }}</label>
                <span v-if="dirty" class="settings-file__unsaved" data-settings-file-unsaved>{{ text(TEXT.unsaved) }}</span>
                <span class="settings-file__spacer" />
                <!-- 主按钮在最右，与 page 页面的草稿操作行同一顺序。 -->
                <Button size="sm" variant="secondary" :disabled="saving || !dirty" @click="discard">{{ text(TEXT.discard) }}</Button>
                <Button size="sm" :disabled="saving || unreachable || !dirty" @click="save">{{ text(TEXT.save) }}</Button>
            </div>
            <p v-if="changedElsewhere" class="settings-file__notice settings-file__notice--warning" role="status" data-settings-file-changed>
                <span>{{ text(TEXT.changedElsewhere) }}</span>
                <Button size="sm" variant="secondary" @click="reread">{{ text(TEXT.reread) }}</Button>
                <Button size="sm" variant="secondary" :disabled="saving || unreachable" @click="saveAnyway">{{ text(TEXT.saveAnyway) }}</Button>
            </p>
            <p v-if="failure !== null" :id="errorId" class="settings-file__notice settings-file__notice--error" role="alert" data-settings-file-error>
                <span>{{ failure.message }}</span>
                <template v-if="failure.code === 'conflict'">
                    <Button size="sm" variant="secondary" @click="reread">{{ text(TEXT.reread) }}</Button>
                    <Button size="sm" variant="secondary" :disabled="saving || unreachable" @click="saveAnyway">{{ text(TEXT.saveAnyway) }}</Button>
                </template>
            </p>
            <Textarea
                :id="textareaId"
                v-model="draft"
                class="settings-file__text"
                data-settings-file-text
                :rows="18"
                :readonly="unreachable"
                :invalid="failure?.code === 'invalid-text'"
                spellcheck="false"
                autocapitalize="off"
                :aria-describedby="describedby"
                @keydown="onKeydown"
            />
            <p :id="hintId" class="settings-file__hint">{{ text(TEXT.hint, {save: saveKey}) }}</p>
        </template>
    </div>
</template>

<style scoped>
.settings-file {
    display: flex;
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

.settings-file__toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
}

.settings-file__spacer {
    flex: 1;
}

.settings-file__label {
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    line-height: var(--leading-ui);
    color: var(--text-secondary);
}

.settings-file__unsaved {
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--status-warning);
}

.settings-file__text {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    tab-size: 4;
    white-space: pre;
    overflow-wrap: normal;
}

.settings-file__hint {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--text-muted);
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
