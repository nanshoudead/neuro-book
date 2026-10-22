<script setup lang="ts">
import {computed, nextTick, ref, watch} from "vue";
import {IconButton} from "@notnotype/nb-ui/components";
import type {
    PromptAttachmentKind,
    PromptEditorPortExpose,
    PromptMenu,
    PromptMenuContext,
    PromptToken,
} from "../../ports";
import type {AgentConversationContext, AgentConversationServices, AgentViewAction} from "../../types";
import {visibleEntries, type AgentViewRegistry} from "../../registry";
import {promptTokenOutcome} from "../../prompt-token-action";
import {commandMenu, nextMode, resolveSubmission} from "../../composer-actions";
import AgentModelPicker from "./AgentModelPicker.vue";
import AgentQueuedMessages from "./AgentQueuedMessages.vue";
import {useAgentRenderers, useAgentText} from "../host";
import type {PreviewImageRequest} from "../preview";

const props = defineProps<{
    ctx: AgentConversationContext;
    services: AgentConversationServices;
    registry: AgentViewRegistry;
}>();

const emit = defineEmits<{
    (e: "action", action: AgentViewAction): void;
    (e: "preview-image", image: PreviewImageRequest): void;
}>();

const {t, text, locale} = useAgentText();
const renderers = useAgentRenderers();


const editorRef = ref<PromptEditorPortExpose | null>(null);

/**
 * 对编辑器的调用。注入的编辑器可以是异步组件（`nbook.markdown` 的就是），加载完成前 ref 是 null：这期间的调用按顺序
 * 暂存，编辑器出现后补做，不让“聚焦”与“添加附件”选好的文件被悄悄丢掉。
 */
const pendingEditorCalls: Array<(editor: PromptEditorPortExpose) => void> = [];

function withEditor(call: (editor: PromptEditorPortExpose) => void): void {
    if (editorRef.value !== null) call(editorRef.value);
    else pendingEditorCalls.push(call);
}

watch(editorRef, (editor) => {
    if (editor === null) return;
    for (const call of pendingEditorCalls.splice(0)) call(editor);
});
const fileInputRef = ref<HTMLInputElement | null>(null);

const composer = computed(() => props.ctx.composer);
const running = computed(() => props.ctx.run.status !== "idle");
const readonly = computed(() => props.ctx.availability.status !== "ready" || !props.ctx.interaction.canSend);
const runtimeDisabled = computed(() => readonly.value || !props.ctx.interaction.canChangeRuntime);

// ─── 登记项 ─────────────────────────────────────────────────────────────

const commands = computed(() => visibleEntries(props.registry.list("commands"), props.ctx));
const commandNames = computed(() => commands.value.map((entry) => entry.name));
const triggers = computed(() => visibleEntries(props.registry.list("triggers"), props.ctx).map((entry) => entry.char));
const toolbarButtons = computed(() => visibleEntries(props.registry.list("toolbarButtons"), props.ctx));

/**
 * 编辑器在函数身份变化时按当前查询重新取菜单：宿主换了 resolveTriggerMenu、登记的命令或界面语言变了，
 * 这里都会给出新函数。
 */
const resolveMenu = computed(() => {
    const resolve = props.services.resolveTriggerMenu;
    const list = commands.value.map((entry) => ({
        id: entry.id,
        name: entry.name,
        description: text(entry.description),
        argsHint: entry.argsHint === undefined ? null : text(entry.argsHint),
    }));
    const labels = {title: t("composer.commandMenu.title"), empty: t("composer.commandMenu.empty")};
    return (context: PromptMenuContext): PromptMenu => context.trigger === "/" && context.atStart
        ? commandMenu(list, context.query, labels)
        : resolve(context);
});

// ─── 正文与发送 ─────────────────────────────────────────────────────────

/**
 * 被拒收时的说明；手动关闭、发送或宿主换了草稿时消失。不跟着 change 消失：附件就绪时编辑器把标签写回文字也会发出 change，
 * 提示会在用户读到之前就没了。
 */
const rejectNotice = ref<string | null>(null);

/** 编辑器最新的文字；宿主换草稿版本时以草稿为准。只用来决定发送按钮是不是停止。 */
const currentText = ref(composer.value.draft.text);

watch(() => composer.value.draft.version, () => {
    currentText.value = composer.value.draft.text;
    rejectNotice.value = null;
});

/**
 * 编辑器发出过、还没移除的附件。没就绪的附件不在文字里，这时发送附件就丢了，所以有它们时不能发送；
 * 就绪后编辑器把标签写回文字，宿主随后可以把它从 attachments 里去掉，这里也就不再记它。
 */
const liveAttachments = ref(new Set<string>());

const attachmentStates = computed(() => new Map(composer.value.attachments.map((item) => [item.localId, item])));

watch(attachmentStates, (states) => {
    const ready = [...liveAttachments.value].filter((localId) => states.get(localId)?.state === "ready");
    if (ready.length > 0) {
        liveAttachments.value = new Set([...liveAttachments.value].filter((localId) => !ready.includes(localId)));
    }
});

const blockedReason = computed(() => {
    const states = [...liveAttachments.value].map((localId) => attachmentStates.value.get(localId)?.state ?? "uploading");
    if (states.includes("failed")) {
        return t("composer.blockedFailed");
    }
    return states.includes("uploading") ? t("composer.blockedUploading") : null;
});

const showStop = computed(() => running.value && currentText.value.trim() === "" && props.ctx.interaction.canStop);
const sendDisabled = computed(() => readonly.value || currentText.value.trim() === "" || blockedReason.value !== null);

const sendTitle = computed(() => {
    if (showStop.value) {
        return t("composer.stop");
    }
    return blockedReason.value ?? (running.value ? t("composer.sendRunning") : t("composer.send"));
});

function onChange(value: string): void {
    currentText.value = value;
    emit("action", {type: "composer.draftChanged", text: value});
}

/** 发送后不清空：宿主受理后给出新版本的空草稿，发送失败时文字就不会丢。 */
function submit(mod: boolean): void {
    if (readonly.value || blockedReason.value !== null) {
        return;
    }
    const result = resolveSubmission({text: currentText.value, mod, running: running.value, commands: commandNames.value});
    if (result !== null) {
        rejectNotice.value = null;
    }
    if (result?.kind === "command") {
        emit("action", {type: "command.run", name: result.name, argsText: result.argsText});
    }
    else if (result?.kind === "message") {
        emit("action", {type: "composer.submit", text: result.text, delivery: result.delivery});
    }
}

function onPrimaryButton(): void {
    if (showStop.value) {
        emit("action", {type: "composer.stop"});
        return;
    }
    submit(false);
}

// ─── 运行设置 ───────────────────────────────────────────────────────────

const currentMode = computed(() => composer.value.modes.find((mode) => mode.key === composer.value.mode) ?? composer.value.modes[0] ?? null);
const modeIsDefault = computed(() => currentMode.value === null || currentMode.value.key === composer.value.modes[0]?.key);

function cycleMode(): void {
    if (runtimeDisabled.value) {
        return;
    }
    const next = nextMode(composer.value.modes, composer.value.mode);
    if (next !== null) {
        emit("action", {type: "mode.set", mode: next});
    }
}

// ─── 附件 ───────────────────────────────────────────────────────────────

const currentModel = computed(() => composer.value.models.find((model) => model.key === composer.value.modelKey) ?? null);
// 缺省的普通文本框收不了附件（host.ts 的 plainEditor）。
const acceptFiles = computed(() => props.ctx.interaction.canRegisterAttachments && !renderers.value.plainEditor);
const acceptImages = computed(() => acceptFiles.value && (currentModel.value?.supportsImages ?? false));


function onAttachmentAdd(payload: {localId: string; kind: PromptAttachmentKind; file: File}): void {
    liveAttachments.value = new Set(liveAttachments.value).add(payload.localId);
    emit("action", {type: "composer.attachmentAdded", localId: payload.localId, kind: payload.kind, file: payload.file});
}

function onAttachmentRemove(payload: {localId: string}): void {
    const next = new Set(liveAttachments.value);
    next.delete(payload.localId);
    liveAttachments.value = next;
    emit("action", {type: "composer.attachmentRemoved", localId: payload.localId});
}

function onAttachmentReject(payload: {kind: PromptAttachmentKind; count: number}): void {
    if (payload.kind === "file") {
        rejectNotice.value = t("composer.reject.file", {count: payload.count});
    }
    else {
        rejectNotice.value = acceptFiles.value
            ? t("composer.reject.imageModel", {count: payload.count})
            : t("composer.reject.imageSession", {count: payload.count});
    }
}

function chooseFiles(): void {
    fileInputRef.value?.click();
}

function onFilesChosen(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = [...input.files ?? []];
    // 清空后再选同一个文件也会触发 change。
    input.value = "";
    if (files.length > 0) {
        withEditor((editor) => {
            editor.insertFiles(files);
            editor.focus("end");
        });
    }
}

function resolveThumbnail(target: string): string | null {
    return props.services.resolveAttachmentUrl(target, "thumbnail");
}

function onTokenActivate(token: PromptToken): void {
    const outcome = promptTokenOutcome(token, (number) => t("imagePreview.image", {number}));
    if (outcome?.kind === "action") {
        emit("action", outcome.action);
    }
    else if (outcome?.kind === "preview") {
        emit("preview-image", outcome.image);
    }
}

// ─── 展开 ───────────────────────────────────────────────────────────────

const expanded = ref(false);

async function toggleExpanded(): Promise<void> {
    expanded.value = !expanded.value;
    await nextTick();
    withEditor((editor) => editor.focus("end"));
}

defineExpose({
    focus(): void {
        withEditor((editor) => editor.focus("end"));
    },
});
</script>

<template>
    <footer class="acv-composer" :class="{'is-expanded': expanded}" data-agent-composer>
        <AgentQueuedMessages :queued="composer.queued" />
        <p v-if="rejectNotice !== null" class="acv-composer__notice" role="status">
            <span class="i-lucide-info acv-composer__notice-icon" aria-hidden="true" />
            <span class="acv-composer__notice-text">{{ rejectNotice }}</span>
            <IconButton
                size="sm"
                icon-class="i-lucide-x"
                :title="t('composer.reject.dismiss')"
                :aria-label="t('composer.reject.dismiss')"
                @click="rejectNotice = null"
            />
        </p>
        <div class="acv-composer__frame" :class="{'is-readonly': readonly}">
            <div class="acv-composer__editor">
                <component
                    :is="renderers.promptEditor"
                    ref="editorRef"
                    :draft="composer.draft"
                    :locale="locale"
                    :placeholder="running ? t('composer.placeholderRunning') : t('composer.placeholder')"
                    :aria-label="t('composer.label')"
                    :readonly="readonly"
                    :enter-submits="!expanded"
                    :triggers="triggers"
                    :resolve-menu="resolveMenu"
                    :commands="commandNames"
                    :accept-images="acceptImages"
                    :accept-files="acceptFiles"
                    :attachments="composer.attachments"
                    :resolve-thumbnail="resolveThumbnail"
                    :paste-policy="composer.pastePolicy"
                    :recall="composer.recall"
                    :fill="expanded"
                    bare
                    @change="onChange"
                    @submit="submit($event.mod)"
                    @shift-tab="cycleMode"
                    @menu-open="emit('action', {type: 'menu.opened', trigger: $event.trigger})"
                    @token-activate="onTokenActivate"
                    @attachment-add="onAttachmentAdd"
                    @attachment-retry="emit('action', {type: 'composer.attachmentRetry', localId: $event.localId})"
                    @attachment-remove="onAttachmentRemove"
                    @attachment-reject="onAttachmentReject"
                />
            </div>
            <div class="acv-composer__toolbar">
                <div class="acv-composer__tools">
                    <IconButton
                        v-if="acceptFiles"
                        size="sm"
                        icon-class="i-lucide-paperclip"
                        :disabled="readonly"
                        :title="t('composer.attach')"
                        :aria-label="t('composer.attach')"
                        data-composer-action="attach"
                        @click="chooseFiles"
                    />
                    <input ref="fileInputRef" type="file" multiple class="acv-composer__file-input" tabindex="-1" aria-hidden="true" @change="onFilesChosen">
                    <button
                        v-if="currentMode !== null"
                        type="button"
                        class="acv-composer__chip acv-composer__mode"
                        :class="{'is-accent': !modeIsDefault}"
                        :disabled="runtimeDisabled || composer.modes.length < 2"
                        :title="t('composer.mode', {mode: currentMode.label})"
                        :aria-label="t('composer.mode', {mode: currentMode.label})"
                        data-composer-action="mode"
                        @click="cycleMode"
                    >
                        <span :class="currentMode.icon ?? 'i-lucide-circle-dot'" class="acv-composer__chip-icon" aria-hidden="true" />
                        <span class="acv-composer__mode-label">{{ currentMode.label }}</span>
                    </button>
                    <AgentModelPicker
                        :models="composer.models"
                        :model-key="composer.modelKey"
                        :thinking-levels="composer.thinkingLevels"
                        :thinking="composer.thinking"
                        :disabled="runtimeDisabled"
                        @select-model="emit('action', {type: 'model.set', modelKey: $event})"
                        @select-thinking="emit('action', {type: 'thinking.set', level: $event})"
                    />
                    <IconButton
                        v-for="button in toolbarButtons"
                        :key="button.id"
                        size="sm"
                        :icon-class="button.icon"
                        :disabled="readonly"
                        :title="text(button.label)"
                        :aria-label="text(button.label)"
                        :data-composer-toolbar="button.id"
                        @click="emit('action', button.action)"
                    />
                </div>
                <div class="acv-composer__send">
                    <IconButton
                        size="sm"
                        :icon-class="expanded ? 'i-lucide-minimize-2' : 'i-lucide-maximize-2'"
                        :title="expanded ? t('composer.collapse') : t('composer.expand')"
                        :aria-label="expanded ? t('composer.collapse') : t('composer.expand')"
                        :aria-pressed="expanded"
                        data-composer-action="expand"
                        @click="toggleExpanded"
                    />
                    <IconButton
                        class="acv-composer__primary"
                        :class="{'is-stop': showStop}"
                        :icon-class="showStop ? 'i-lucide-square' : 'i-lucide-arrow-up'"
                        size="sm"
                        :disabled="showStop ? false : sendDisabled"
                        :title="sendTitle"
                        :aria-label="sendTitle"
                        :data-composer-action="showStop ? 'stop' : 'send'"
                        @click="onPrimaryButton"
                    />
                </div>
            </div>
        </div>
    </footer>
</template>

<style scoped>
.acv-composer {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    gap: 6px;
    padding: 8px;
    border-top: var(--border-w) solid var(--border-color);
    container-type: inline-size;
}

/* 展开后占视图高度的大部分，消息流让出高度；百分比相对对话视图这一列。 */
.acv-composer.is-expanded {
    height: min(55%, 560px);
}

.acv-composer__notice {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 6px;
    margin: 0;
    padding-left: 8px;
    color: var(--text-muted);
    font-size: var(--text-xs);
}

.acv-composer__notice-icon {
    flex: none;
    width: 13px;
    height: 13px;
}

.acv-composer__notice-text {
    min-width: 0;
    flex: 1 1 auto;
}

.acv-composer__frame {
    display: flex;
    min-height: 0;
    flex-direction: column;
    border: var(--border-w) solid var(--border-color);
    border-radius: 10px;
    background: var(--bg-input);
    transition: border-color var(--motion-fast) var(--ease-standard);
}

.acv-composer.is-expanded .acv-composer__frame {
    flex: 1 1 auto;
}

.acv-composer__frame:focus-within {
    border-color: var(--focus-outline);
}

.acv-composer__frame.is-readonly {
    background: var(--bg-subtle);
}

.acv-composer__editor {
    min-height: 0;
    padding: 4px 4px 0;
}

.acv-composer.is-expanded .acv-composer__editor {
    flex: 1 1 auto;
}

.acv-composer__toolbar {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
    padding: 2px 6px 6px;
}

.acv-composer__tools {
    display: flex;
    min-width: 0;
    flex: 1 1 auto;
    align-items: center;
    gap: 2px;
}

.acv-composer__send {
    display: flex;
    flex: none;
    align-items: center;
    gap: 4px;
}

/* 发送是这一行唯一的主操作，用实心的强调色；停止用危险色。不可用时沿用 IconButton 的半透明。 */
.acv-composer__primary {
    background: var(--accent-main);
    color: var(--text-inverse);
}

.acv-composer__primary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent-main) 86%, var(--text-main));
    color: var(--text-inverse);
}

.acv-composer__primary.is-stop {
    background: var(--status-danger);
}

.acv-composer__primary.is-stop:hover {
    background: color-mix(in srgb, var(--status-danger) 86%, var(--text-main));
}

.acv-composer__file-input {
    display: none;
}

.acv-composer__chip {
    display: inline-flex;
    flex: none;
    height: 26px;
    align-items: center;
    gap: 4px;
    padding: 0 6px;
    border-radius: var(--radius-control);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    transition: background-color var(--motion-fast) var(--ease-standard), color var(--motion-fast) var(--ease-standard);
}

.acv-composer__chip:hover:not(:disabled) {
    background: color-mix(in srgb, var(--text-main) 10%, transparent);
    color: var(--text-main);
}

.acv-composer__chip:focus-visible {
    outline: 2px solid var(--focus-outline);
    outline-offset: 1px;
}

.acv-composer__chip:disabled {
    cursor: not-allowed;
    opacity: 0.5;
}

.acv-composer__chip.is-accent {
    background: var(--accent-bg);
    color: var(--accent-text);
}

.acv-composer__chip-icon {
    width: 13px;
    height: 13px;
}

/* 窄屏时模式按钮只留图标，给模型名留出位置。 */
@container (max-width: 420px) {
    .acv-composer__mode-label {
        display: none;
    }
}
</style>
