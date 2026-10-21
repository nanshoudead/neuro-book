<script setup lang="ts">
/**
 * 设置文件视图（同名 .md，docs/specs/settings/settings-window.md 输出 23）：整份读写当前标签那一层的设置文件。读写经窗口
 * 模型给的路（`window.file(layer)`，远程合同的 `readText`、`writeText`），文本的修订号变了由 `watch` 通知。
 *
 * 草稿与读出的原文分开记：有改动（草稿与原文不同）时算未保存，报给窗口的未保存保护；别处改了文件时，没有改动就重读，
 * 有改动就只提示，不覆盖这里的草稿。换标签就是换一个文件：丢掉草稿、重读（有改动时窗口先确认过）。
 */
import {Button, Spinner, Textarea} from "@notnotype/nb-ui/components";
import {computed, nextTick, onBeforeUnmount, ref, useId, watch} from "vue";

import {formatText, localize} from "nbook/shared/localized-text";
import type {LocalizedText} from "nbook/shared/localized-text";
import type {SettingLayer, SettingsFailure} from "nbook/shared/settings";

import type {LayerTextPosition} from "../../shared/layers";
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
    loading: {"zh-CN": "正在读取设置文件", "en-US": "Reading the settings file"},
    readFailed: {"zh-CN": "读不了设置文件：{detail}", "en-US": "Could not read the settings file: {detail}"},
    reread: {"zh-CN": "重新读取", "en-US": "Read Again"},
    save: {"zh-CN": "保存", "en-US": "Save"},
    discard: {"zh-CN": "放弃改动", "en-US": "Discard Changes"},
    changedElsewhere: {"zh-CN": "文件在别处改过了；重新读取会丢掉这里的改动", "en-US": "The file was changed elsewhere; reading it again discards your changes here"},
    conflict: {"zh-CN": "没有保存：文件在别处改过了", "en-US": "Not saved: the file was changed elsewhere"},
    invalidText: {"zh-CN": "没有保存：第 {line} 行第 {column} 列：{detail}", "en-US": "Not saved: line {line}, column {column}: {detail}"},
    failed: {"zh-CN": "没有保存：{detail}", "en-US": "Not saved: {detail}"},
    readonly: {"zh-CN": "暂时连不上，不能保存", "en-US": "Temporarily unreachable; changes can't be saved"},
} satisfies Record<string, LocalizedText>;

const locale = props.window.locale;
const text = (template: LocalizedText, params: Readonly<Record<string, string | number>> = {}): string => localize(formatText(template, params), locale.value);

const textareaId = `settings-file-${useId()}`;
const errorId = `${textareaId}-error`;

type ViewState = {readonly kind: "loading"} | {readonly kind: "read-failed"; readonly detail: string} | {readonly kind: "ready"};

const state = ref<ViewState>({kind: "loading"});
/** 读出或保存成功时的原文与它的修订号。 */
const base = ref("");
const revision = ref("");
const draft = ref("");
const saving = ref(false);
const failure = ref<{readonly code: SettingsFailure; readonly message: string} | null>(null);
/** 有改动时别处改了文件：只提示，等用户重新读取。 */
const changedElsewhere = ref(false);

const dirty = computed(() => state.value.kind === "ready" && draft.value !== base.value);
const unreachable = computed(() => props.window.layerNotice.value?.kind === "unavailable");

/** 每次读都带一个序号：换了标签（换了文件）之后，前一次读的结果作废。 */
let readToken = 0;
let stopWatch: (() => void) | null = null;

async function load(): Promise<void> {
    const token = (readToken += 1);
    const file = props.window.file(props.layer);
    if (file === undefined) return;
    state.value = {kind: "loading"};
    const result = await file.read();
    if (token !== readToken) return;
    failure.value = null;
    changedElsewhere.value = false;
    if (!result.ok) {
        state.value = {kind: "read-failed", detail: result.detail};
        return;
    }
    base.value = result.text;
    draft.value = result.text;
    revision.value = result.revision;
    state.value = {kind: "ready"};
}

function follow(): void {
    stopWatch?.();
    stopWatch = props.window.file(props.layer)?.watch((next) => {
        if (next === revision.value || state.value.kind === "loading") return;
        if (dirty.value) changedElsewhere.value = true;
        else void load();
    }) ?? null;
}

watch(() => props.layer, () => {
    follow();
    void load();
}, {immediate: true});
watch(dirty, (value) => props.window.fileDirty(value), {immediate: true});
onBeforeUnmount(() => {
    readToken += 1;
    stopWatch?.();
    props.window.fileDirty(false);
});

function reasonOf(code: SettingsFailure, detail: string, position: LayerTextPosition | undefined): string {
    if (code === "conflict") return text(TEXT.conflict);
    if (code === "invalid-text" && position !== undefined) return text(TEXT.invalidText, {line: position.line, column: position.column, detail});
    return text(TEXT.failed, {detail});
}

async function save(): Promise<void> {
    const file = props.window.file(props.layer);
    if (file === undefined || saving.value || !dirty.value || unreachable.value) return;
    saving.value = true;
    const token = readToken;
    const content = draft.value;
    try {
        const result = await file.write(content, revision.value);
        if (token !== readToken) return;
        if (!result.ok) {
            failure.value = {code: result.code, message: reasonOf(result.code, result.detail, result.position)};
            return;
        }
        base.value = content;
        revision.value = result.revision;
        failure.value = null;
        changedElsewhere.value = false;
    } finally {
        saving.value = false;
    }
}

function discard(): void {
    draft.value = base.value;
    failure.value = null;
}

/** 刚按过 Esc：下一个 Tab 照常移焦点，不插空格（键盘用户离开文本框的出口）。 */
let escaped = false;

function onKeydown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
        return;
    }
    if (event.key === "Escape") {
        escaped = true;
        return;
    }
    if (event.key !== "Tab" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || escaped) {
        escaped = false;
        return;
    }
    const target = event.target as HTMLTextAreaElement;
    if (target.readOnly) return;
    event.preventDefault();
    const start = target.selectionStart;
    const end = target.selectionEnd;
    draft.value = `${draft.value.slice(0, start)}  ${draft.value.slice(end)}`;
    void nextTick(() => target.setSelectionRange(start + 2, start + 2));
}
</script>

<template>
    <div class="settings-file" data-settings-file :data-settings-file-state="state.kind">
        <code v-if="path !== null" class="settings-file__path" data-settings-file-path>{{ path }}</code>
        <div v-if="state.kind === 'loading'" class="settings-file__notice" role="status" aria-live="polite">
            <Spinner size="sm" />
            <span>{{ text(TEXT.loading) }}</span>
        </div>
        <div v-else-if="state.kind === 'read-failed'" class="settings-file__notice settings-file__notice--error" role="alert">
            <span>{{ text(TEXT.readFailed, {detail: state.detail}) }}</span>
            <Button size="sm" variant="secondary" @click="load">{{ text(TEXT.reread) }}</Button>
        </div>
        <template v-else>
            <label :for="textareaId" class="settings-file__label">{{ text(TEXT.label, {layer: text(layer === "user" ? TEXT.user : TEXT.project)}) }}</label>
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
                :aria-describedby="failure !== null ? errorId : undefined"
                @keydown="onKeydown"
            />
            <p v-if="unreachable" class="settings-file__notice">{{ text(TEXT.readonly) }}</p>
            <p v-if="changedElsewhere" class="settings-file__notice settings-file__notice--warning" role="status" data-settings-file-changed>
                <span>{{ text(TEXT.changedElsewhere) }}</span>
                <Button size="sm" variant="secondary" @click="load">{{ text(TEXT.reread) }}</Button>
            </p>
            <p v-if="failure !== null" :id="errorId" class="settings-file__notice settings-file__notice--error" role="alert" data-settings-file-error>
                <span>{{ failure.message }}</span>
                <Button v-if="failure.code === 'conflict'" size="sm" variant="secondary" @click="load">{{ text(TEXT.reread) }}</Button>
            </p>
            <div v-if="dirty" class="settings-file__actions" data-settings-file-actions>
                <Button size="sm" :disabled="saving || unreachable" @click="save">{{ text(TEXT.save) }}</Button>
                <Button size="sm" variant="secondary" :disabled="saving" @click="discard">{{ text(TEXT.discard) }}</Button>
            </div>
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

.settings-file__label {
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    line-height: var(--leading-ui);
    color: var(--text-secondary);
}

.settings-file__text {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    tab-size: 4;
    white-space: pre;
    overflow-wrap: normal;
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

.settings-file__actions {
    display: flex;
    gap: var(--space-3);
}
</style>
