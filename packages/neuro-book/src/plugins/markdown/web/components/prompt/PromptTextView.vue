<script setup lang="ts">
/** 已发送文字的静态显示（同名 .md；docs/specs/ui/prompt-editor.md 输出 14）：与 PromptEditor 同一套文字写法，不建编辑器。 */
import {computed, ref, watch} from "vue";

import type {DisplayLocale} from "nbook/shared/localized-text";

import type {PromptAttachmentCard, PromptEditorToken} from "./prompt-editor.types";
import {
    numberKey,
    parsePromptText,
    PROMPT_PASTE_BLOCK_NODE,
    PROMPT_TOKEN_NODE,
    promptTokenFromAttrs,
    type PromptNodeJSON,
    type PromptPasteBlockAttrs,
    type PromptTokenAttrs,
} from "./prompt-text";
import PromptAttachmentStrip from "./PromptAttachmentStrip.vue";
import PromptPasteFrame from "./PromptPasteFrame.vue";
import InlineChip from "../InlineChip.vue";

const props = withDefaults(defineProps<{
    text: string;
    locale: DisplayLocale;
    commands?: readonly string[];
    resolveThumbnail?: (target: string) => string | null;
}>(), {
    commands: () => [],
    resolveThumbnail: () => null,
});

const emit = defineEmits<{
    (e: "token-activate", token: PromptEditorToken): void;
}>();

type TokenPiece = {kind: "token"; attrs: PromptTokenAttrs; hoverKey: string | null};
type Piece = {kind: "text"; text: string} | TokenPiece;
type Block =
    | {kind: "line"; pieces: Piece[]}
    | {kind: "paste"; attrs: PromptPasteBlockAttrs; hoverKey: string};

function linkKey(attrs: PromptTokenAttrs): string | null {
    return attrs.kind === "image" || attrs.kind === "file" || attrs.kind === "paste" ? numberKey(attrs.kind, attrs.number ?? 0) : null;
}

function toPiece(node: PromptNodeJSON): Piece | null {
    if (node.type === "text") {
        return {kind: "text", text: node.text ?? ""};
    }
    if (node.type === PROMPT_TOKEN_NODE) {
        const attrs = node.attrs as unknown as PromptTokenAttrs;
        return {kind: "token", attrs, hoverKey: linkKey(attrs)};
    }
    return null;
}

const blocks = computed<Block[]>(() => (parsePromptText(props.text, {commands: props.commands}).content ?? []).map((node) => {
    if (node.type === PROMPT_PASTE_BLOCK_NODE) {
        const attrs = node.attrs as unknown as PromptPasteBlockAttrs;
        return {kind: "paste", attrs, hoverKey: numberKey("paste", attrs.number)};
    }
    return {kind: "line", pieces: (node.content ?? []).flatMap((child) => toPiece(child) ?? [])};
}));

/** 图片与文件标签，按出现顺序；卡片 id 是它在这个列表里的下标。 */
const attachmentTokens = computed(() => blocks.value.flatMap((block) => block.kind === "line"
    ? block.pieces.filter((piece): piece is TokenPiece => piece.kind === "token" && (piece.attrs.kind === "image" || piece.attrs.kind === "file"))
    : []));

const cards = computed<PromptAttachmentCard[]>(() => attachmentTokens.value.map((piece, index) => {
    const kind = piece.attrs.kind === "image" ? "image" : "file";
    return {
        id: String(index),
        hoverKey: piece.hoverKey ?? "",
        kind,
        number: piece.attrs.number ?? 0,
        name: piece.attrs.label,
        state: "ready",
        thumbnail: kind === "image" && piece.attrs.target !== "" ? props.resolveThumbnail(piece.attrs.target) : null,
    };
}));

const highlighted = ref<string | null>(null);
/** 展开的粘贴块，按块的下标记；换了文字后全部收起。 */
const expanded = ref(new Set<number>());

watch(() => props.text, () => {
    expanded.value = new Set();
    highlighted.value = null;
});

function setExpanded(index: number, value: boolean): void {
    const next = new Set(expanded.value);
    if (value) {
        next.add(index);
    }
    else {
        next.delete(index);
    }
    expanded.value = next;
}

function hover(key: string | null, active: boolean): void {
    if (key !== null) {
        highlighted.value = active ? key : null;
    }
}

function activateCard(id: string): void {
    const piece = attachmentTokens.value[Number(id)];
    if (piece) {
        emit("token-activate", promptTokenFromAttrs(piece.attrs));
    }
}
</script>

<template>
    <div class="prompt-text">
        <PromptAttachmentStrip
            :cards="cards"
            :locale="props.locale"
            :highlighted="highlighted"
            readonly
            class="prompt-text__strip"
            @activate="activateCard"
            @hover="highlighted = $event"
        />
        <template v-for="(block, index) in blocks" :key="index">
            <PromptPasteFrame
                v-if="block.kind === 'paste'"
                :locale="props.locale"
                :number="block.attrs.number"
                :content="block.attrs.content"
                :expanded="expanded.has(index)"
                :highlighted="highlighted === block.hoverKey"
                :data-prompt-paste="block.attrs.number"
                @update:expanded="setExpanded(index, $event)"
                @hover="hover(block.hoverKey, $event)"
            />
            <div v-else class="prompt-text__line">
                <template v-for="(piece, pieceIndex) in block.pieces" :key="pieceIndex">
                    <template v-if="piece.kind === 'text'">{{ piece.text }}</template>
                    <InlineChip
                        v-else
                        :kind="piece.attrs.kind"
                        :locale="props.locale"
                        :label="piece.attrs.label"
                        :target="piece.attrs.target"
                        :number="piece.attrs.number"
                        :highlighted="piece.hoverKey !== null && highlighted === piece.hoverKey"
                        interactive
                        @activate="emit('token-activate', promptTokenFromAttrs(piece.attrs))"
                        @hover="hover(piece.hoverKey, $event)"
                    />
                </template>
                <br v-if="block.pieces.length === 0">
            </div>
        </template>
    </div>
</template>

<style scoped>
.prompt-text {
    min-width: 0;
    overflow-wrap: anywhere;
}

.prompt-text__strip {
    margin-bottom: 0.4rem;
}

.prompt-text__line {
    white-space: pre-wrap;
}
</style>
