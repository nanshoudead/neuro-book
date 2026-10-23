<script setup lang="ts">
/** 行内小块与待上传附件的节点视图（同名 .md）：外观是 `InlineChip`。 */
import {computed} from "vue";
import {NodeViewWrapper, nodeViewProps} from "@tiptap/vue-3";

import InlineChip from "../chip/InlineChip.vue";
import {useMarkdownHost} from "../host";

import type {PromptEditorToken} from "./prompt-editor.types";
import type {PromptNodeContext} from "./prompt-editor-extensions";
import {numberKey, PROMPT_PENDING_NODE, promptTokenFromAttrs, type PromptPendingAttrs, type PromptTokenAttrs} from "./prompt-text";

const props = defineProps(nodeViewProps);
/** 引用小块的目标分类与文件图标：TipTap 的 Vue 节点视图挂在 `EditorContent` 的应用上下文里，拿得到 PromptEditor 祖先提供的宿主。 */
const host = useMarkdownHost();

const context = computed(() => props.extension.options.context as PromptNodeContext);

type ChipInput = {
    kind: PromptTokenAttrs["kind"];
    label: string;
    target: string;
    number: number | null;
    state: "ready" | "uploading" | "failed";
    error: string;
    hoverKey: string | null;
    token: PromptEditorToken;
};

const chip = computed<ChipInput>(() => {
    if (props.node.type.name === PROMPT_PENDING_NODE) {
        return pendingChip(props.node.attrs as PromptPendingAttrs);
    }
    return tokenChip(props.node.attrs as PromptTokenAttrs);
});

const highlighted = computed(() => chip.value.hoverKey !== null && context.value.highlighted === chip.value.hoverKey);

function pendingChip(attrs: PromptPendingAttrs): ChipInput {
    const state = context.value.attachmentState(attrs.localId);
    const failed = state?.state === "failed";
    return {
        kind: attrs.kind,
        label: attrs.name,
        target: "",
        number: attrs.number,
        state: failed ? "failed" : "uploading",
        error: failed ? state.error : "",
        hoverKey: numberKey(attrs.kind, attrs.number),
        token: attrs.kind === "image"
            ? {kind: "image", number: attrs.number, target: null}
            : {kind: "file", number: attrs.number, name: attrs.name, target: null},
    };
}

function tokenChip(attrs: PromptTokenAttrs): ChipInput {
    return {
        kind: attrs.kind,
        label: attrs.label,
        target: attrs.target,
        number: attrs.number,
        state: "ready",
        error: "",
        hoverKey: attrs.kind === "image" || attrs.kind === "file" || attrs.kind === "paste" ? numberKey(attrs.kind, attrs.number ?? 0) : null,
        token: promptTokenFromAttrs(attrs),
    };
}

function hover(active: boolean): void {
    if (chip.value.hoverKey !== null) {
        context.value.hover(active ? chip.value.hoverKey : null);
    }
}
</script>

<template>
    <NodeViewWrapper as="span" class="prompt-token-node">
        <InlineChip
            :env="host.chips"
            :kind="chip.kind"
            :locale="context.locale"
            :label="chip.label"
            :target="chip.target"
            :number="chip.number"
            :state="chip.state"
            :error="chip.error"
            :highlighted="highlighted"
            :selected="props.selected"
            @activate="context.activate(chip.token)"
            @hover="hover"
        />
    </NodeViewWrapper>
</template>

<style scoped>
/*
 * 节点视图的根元素必须是与标签同宽的整块行内盒：普通的行内 span 会让 Chrome 把行尾标签右边的落点
 * 放进这个不可编辑元素里，从那里往回拖选不出选区（smoke 的 line-edges 覆盖）。宽度上限与标签一致，
 * 否则过长的名称在标签截断后，包装仍按全名占位。
 */
.prompt-token-node {
    display: inline-flex;
    max-width: min(100%, 16rem);
    vertical-align: baseline;
}
</style>
