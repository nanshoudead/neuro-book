<script setup lang="ts">
import {computed, nextTick, ref, useId} from "vue";
import {NodeViewWrapper, nodeViewProps} from "@tiptap/vue-3";
import {TextSelection} from "@tiptap/pm/state";
import {IconButton} from "@notnotype/nb-ui/components";
import {promptText} from "./prompt-labels";
import {selectionBesideBlock, type PromptNodeContext} from "./prompt-editor-extensions";
import {breaksPasteBlock, numberKey, PASTE_COLLAPSED_LINES, type PromptPasteBlockAttrs} from "./prompt-text";
import PromptPasteFrame from "./PromptPasteFrame.vue";

const props = defineProps(nodeViewProps);

const expanded = ref(false);
/** 文本框里还没写回的内容：有恰好是 `</paste>` 的一行，写回会让粘贴块提前结束。 */
const invalidDraft = ref<string | null>(null);
const areaRef = ref<HTMLTextAreaElement | null>(null);
const errorId = useId();

const context = computed(() => props.extension.options.context as PromptNodeContext);
const attrs = computed(() => props.node.attrs as PromptPasteBlockAttrs);
const lines = computed(() => attrs.value.content.split("\n"));
const collapsible = computed(() => lines.value.length > PASTE_COLLAPSED_LINES);
const clipped = computed(() => collapsible.value && !expanded.value);
const editable = computed(() => !context.value.readonly && !clipped.value);
const hoverKey = computed(() => numberKey("paste", attrs.value.number));
const highlighted = computed(() => context.value.highlighted === hoverKey.value);

/** 换成同样内容的普通文字，一行一个段落，不识别写法；光标落在末尾。 */
function convertToText(): void {
    const pos = props.getPos();
    if (typeof pos !== "number") {
        return;
    }
    const {state} = props.editor;
    const paragraph = state.schema.nodes.paragraph!;
    const paragraphs = lines.value.map((line) => paragraph.create(null, line ? state.schema.text(line) : null));
    const tr = state.tr.replaceWith(pos, pos + props.node.nodeSize, paragraphs);
    const end = pos + paragraphs.reduce((size, node) => size + node.nodeSize, 0) - 1;
    tr.setSelection(TextSelection.create(tr.doc, end));
    props.editor.view.dispatch(tr.scrollIntoView());
    props.editor.view.focus();
}

function remove(): void {
    props.deleteNode();
    props.editor.view.focus();
}

function onInput(event: Event): void {
    const value = (event.target as HTMLTextAreaElement).value;
    // 输入中长过 3 行也不能收起，否则文本框在手下消失。
    expanded.value = true;
    if (breaksPasteBlock(value)) {
        invalidDraft.value = value;
        return;
    }
    invalidDraft.value = null;
    writeContent(value);
}

function writeContent(content: string): void {
    const pos = props.getPos();
    if (typeof pos !== "number" || content === attrs.value.content) {
        return;
    }
    // 叶子节点的 setNodeMarkup 是一次带位置映射的替换，连续输入在撤销历史里合并成一步；只改属性的步骤不合并。
    props.editor.view.dispatch(props.editor.state.tr.setNodeMarkup(pos, undefined, {...props.node.attrs, content}));
}

function onKeydown(event: KeyboardEvent): void {
    if (event.isComposing) {
        return;
    }
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (mod && !event.altKey && (key === "z" || key === "y")) {
        event.preventDefault();
        void runHistory(key === "y" || event.shiftKey ? "redo" : "undo");
        return;
    }
    if (mod && event.key === "Enter") {
        event.preventDefault();
        context.value.submit();
        return;
    }
    if (event.key === "Escape") {
        event.preventDefault();
        leave("after");
        return;
    }
    if (mod || event.altKey || event.shiftKey) {
        return;
    }
    const area = event.currentTarget as HTMLTextAreaElement;
    if (area.selectionStart !== area.selectionEnd) {
        return;
    }
    if ((event.key === "ArrowUp" || event.key === "ArrowLeft") && area.selectionStart === 0) {
        event.preventDefault();
        leave("before");
    }
    else if ((event.key === "ArrowDown" || event.key === "ArrowRight") && area.selectionEnd === area.value.length) {
        event.preventDefault();
        leave("after");
    }
}

/** 文本框里的撤销重做走编辑器的历史；文本框自己的历史与编辑器对不上。 */
async function runHistory(kind: "undo" | "redo"): Promise<void> {
    const {editor} = props;
    const area = areaRef.value;
    const before = area?.value ?? "";
    invalidDraft.value = null;
    if (kind === "undo") {
        editor.commands.undo();
    }
    else {
        editor.commands.redo();
    }
    if (!area) {
        return;
    }
    // 撤销掉整个粘贴块时文本框随之消失，焦点回到正文。
    if (!area.isConnected) {
        if (!editor.isDestroyed) {
            editor.view.focus();
        }
        return;
    }
    await nextTick();
    const after = area.value;
    if (after !== before && document.activeElement === area) {
        const caret = changedEnd(before, after);
        area.setSelectionRange(caret, caret);
    }
}

/** 光标放到变化那一段的末尾，而不是文本框重设内容后默认的最末尾。 */
function changedEnd(before: string, after: string): number {
    let start = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) {
        start += 1;
    }
    let tail = 0;
    while (tail < before.length - start && tail < after.length - start && before[before.length - 1 - tail] === after[after.length - 1 - tail]) {
        tail += 1;
    }
    return after.length - tail;
}

function leave(side: "before" | "after"): void {
    const pos = props.getPos();
    if (typeof pos !== "number") {
        return;
    }
    const {view} = props.editor;
    view.dispatch(view.state.tr.setSelection(selectionBesideBlock(view.state.doc, pos, side)).scrollIntoView());
    view.focus();
}
</script>

<template>
    <NodeViewWrapper :data-prompt-paste="attrs.number">
        <PromptPasteFrame
            v-model:expanded="expanded"
            :locale="context.locale"
            :number="attrs.number"
            :content="attrs.content"
            :highlighted="highlighted"
            :selected="props.selected"
            :invalid="invalidDraft !== null"
            @hover="context.hover($event ? hoverKey : null)"
        >
            <template v-if="!context.readonly" #actions>
                <IconButton
                    size="sm"
                    icon-class="i-lucide-text"
                    :title="promptText(context.locale, 'pasteToText')"
                    :aria-label="promptText(context.locale, 'pasteToText')"
                    data-prompt-paste-action="to-text"
                    @click="convertToText"
                />
                <IconButton
                    size="sm"
                    variant="danger"
                    icon-class="i-lucide-trash-2"
                    :title="promptText(context.locale, 'pasteRemove')"
                    :aria-label="promptText(context.locale, 'pasteRemove')"
                    data-prompt-paste-action="remove"
                    @click="remove"
                />
            </template>
            <template v-if="editable" #body>
                <textarea
                    ref="areaRef"
                    class="prompt-paste__body prompt-paste__area"
                    :value="invalidDraft ?? attrs.content"
                    rows="1"
                    spellcheck="false"
                    :aria-label="promptText(context.locale, 'pasteEdit', {number: attrs.number})"
                    :aria-invalid="invalidDraft !== null"
                    :aria-describedby="invalidDraft !== null ? errorId : undefined"
                    data-prompt-paste-area
                    @input="onInput"
                    @keydown="onKeydown"
                    @blur="invalidDraft = null"
                />
                <p v-if="invalidDraft !== null" :id="errorId" class="prompt-paste__error" role="alert">
                    {{ promptText(context.locale, "pasteInvalidClose", {tag: "</paste>"}) }}
                </p>
            </template>
        </PromptPasteFrame>
    </NodeViewWrapper>
</template>

<style scoped>
/* 字体与间距来自外框给插槽里 .prompt-paste__body 的样式，这里只去掉文本框自己的外观。 */
.prompt-paste__area {
    display: block;
    box-sizing: border-box;
    width: 100%;
    border-right: 0;
    border-bottom: 0;
    border-left: 0;
    border-radius: 0 0 0.5rem 0.5rem;
    background: transparent;
    outline: none;
    resize: none;
    overflow: hidden;
    field-sizing: content;
    user-select: text;
}

.prompt-paste__error {
    margin: 0;
    padding: 0 0.6rem 0.4rem;
    color: var(--status-danger);
    font-size: var(--text-xs);
}
</style>
