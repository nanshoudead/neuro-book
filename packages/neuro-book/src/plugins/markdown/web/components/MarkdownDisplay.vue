<script setup lang="ts">
/** Markdown 展示器（同名 .md；docs/specs/ui/markdown-display.md）：编解码器读入后按 schema 生成页面元素，不建编辑器。 */
import {getSchema} from "@tiptap/core";
import type {Schema} from "@tiptap/pm/model";
import {inject, onBeforeUnmount, onMounted, ref, watch} from "vue";

import type {DisplayLocale} from "nbook/shared/localized-text";

import {classifyTarget} from "../../shared/targets";
import {DisplayRenderer} from "../display/renderer";
import type {DisplayActivation} from "../display/static-views";
import type {MarkdownLanguage} from "../language";
import {languageFor} from "../language-registry";
import "../parts/markdown.css";
import {syntaxCatalogKey} from "../syntax-catalog";
import type {ResolveAsset} from "./MarkdownImage.vue";

const props = withDefaults(defineProps<{text: string; locale: DisplayLocale; streaming?: boolean; resolveAsset?: ResolveAsset}>(), {streaming: false, resolveAsset: undefined});
const emit = defineEmits<{(e: "activate", activation: DisplayActivation): void}>();

const catalog = inject(syntaxCatalogKey, null);
if (catalog === null) throw new Error("MarkdownDisplay 要由 nbook.markdown 交出的组件挂上：缺少方言目录（syntaxCatalogKey）");

/** 每份语言一份 schema：同一时刻挂上的消息共用，编解码器按它缓存。 */
const schemas = new WeakMap<MarkdownLanguage, Schema>();
const schemaOf = (language: MarkdownLanguage): Schema => {
    let schema = schemas.get(language);
    if (schema === undefined) {
        schema = getSchema([...language.extensions]);
        schemas.set(language, schema);
    }
    return schema;
};

const root = ref<HTMLElement | null>(null);
let renderer: DisplayRenderer | null = null;
let frame: number | null = null;
let cursor: HTMLElement | null = null;

const placeCursor = (): void => {
    cursor?.remove();
    cursor = null;
    if (!props.streaming || renderer === null || root.value === null) return;
    const target = renderer.lastTextblock() ?? root.value;
    cursor = root.value.ownerDocument.createElement("span");
    cursor.className = "nb-markdown-display__cursor";
    cursor.setAttribute("aria-hidden", "true");
    target.append(cursor);
};

const flush = (): void => {
    frame = null;
    renderer?.update(props.text);
    placeCursor();
};

onMounted(() => {
    if (root.value === null) return;
    // 挂上时取定语言（docs/specs/workspace/markdown-syntaxes.md 输出 7）。
    const language = languageFor(catalog);
    const document = root.value.ownerDocument;
    renderer = new DisplayRenderer(root.value, language, schemaOf(language), {
        document,
        get locale() {
            return props.locale;
        },
        get resolveAsset() {
            return props.resolveAsset;
        },
        activate: (activation) => emit("activate", activation),
    });
    flush();
});

// 同一帧里多次改变只读入最后一次（输出 6）。
watch(() => props.text, () => {
    if (frame === null && renderer !== null) frame = requestAnimationFrame(flush);
});
watch(() => props.streaming, placeCursor);

onBeforeUnmount(() => {
    if (frame !== null) cancelAnimationFrame(frame);
    renderer?.destroy();
    renderer = null;
});

/** 点链接与引用小块：交给宿主，不自己跳转（输出 5）。提示块与 `<html>` 块的按钮、图片各自处理。 */
const onClick = (event: MouseEvent): void => {
    const anchor = (event.target as HTMLElement | null)?.closest("a[href]");
    if (anchor === null || anchor === undefined || !root.value?.contains(anchor)) return;
    event.preventDefault();
    const href = anchor.getAttribute("href") ?? "";
    const target = classifyTarget(href, null);
    emit("activate", target.kind === "work" || target.kind === "user" ? {kind: "reference", target: href} : {kind: "link", href});
};
</script>

<template>
    <div ref="root" class="nb-markdown nb-markdown-display" data-markdown-display @click="onClick"></div>
</template>

<style scoped>
.nb-markdown-display {
    --markdown-font-size: 13px;
    --markdown-line-height: 1.7;
    --markdown-block-gap: 8px;
    min-width: 0;
    overflow-wrap: anywhere;
    /* 长对话：看不见的消息不参与排版，拖动改宽度只排看得见的（输出 9）；`auto` 记住上一次显示的高度。 */
    content-visibility: auto;
    contain-intrinsic-size: auto 120px;
}

.nb-markdown-display :deep(.nb-markdown-display__cursor) {
    display: inline-block;
    width: 0.5em;
    height: 1em;
    margin-inline-start: 0.1em;
    vertical-align: text-bottom;
    background: var(--text-main);
    animation: nb-markdown-display-blink 1s steps(1) infinite;
}

@keyframes nb-markdown-display-blink {
    50% {
        opacity: 0;
    }
}

@media (prefers-reduced-motion: reduce) {
    .nb-markdown-display :deep(.nb-markdown-display__cursor) {
        animation: none;
    }
}
</style>
