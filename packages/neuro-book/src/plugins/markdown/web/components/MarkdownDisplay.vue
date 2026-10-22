<script setup lang="ts">
/** Markdown 展示器（同名 .md；docs/specs/ui/markdown-display.md）：编解码器读入后按 schema 生成页面元素，不建编辑器。 */
import {inject, onBeforeUnmount, onMounted, ref, watch} from "vue";

import type {DisplayLocale} from "nbook/shared/localized-text";

import {classifyTarget, showsAsChip} from "../../shared/targets";
import {DisplayRenderer, schemaFor} from "../display/renderer";
import type {DisplayActivation} from "../display/static-views";
import {languageFor} from "../language-registry";
import {markdownReportKey} from "../parts/report";
import "../parts/markdown.css";
import {syntaxCatalogKey} from "../syntax-catalog";
import type {ResolveAsset} from "./MarkdownImage.vue";

const props = withDefaults(defineProps<{text: string; locale: DisplayLocale; streaming?: boolean; resolveAsset?: ResolveAsset}>(), {streaming: false, resolveAsset: undefined});
const emit = defineEmits<{(e: "activate", activation: DisplayActivation): void}>();

const catalog = inject(syntaxCatalogKey, null);
if (catalog === null) throw new Error("MarkdownDisplay 要由 nbook.markdown 交出的组件挂上：缺少方言目录（syntaxCatalogKey）");

const report = inject(markdownReportKey, () => undefined);

const root = ref<HTMLElement | null>(null);
let renderer: DisplayRenderer | null = null;
/** 组不成语言或建不起渲染器时为真：之后只按纯文字显示原文（“失败与恢复”）。 */
let plain = false;
let frame: number | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
/** 上一次读入很慢时，下一次读入不早于这个时刻（`performance.now()`）。 */
let resumeAt = 0;
let cursor: HTMLElement | null = null;

/** 读入超过这么久，下一次读入至少隔同样长：长回复流式时每帧整篇重读，不让它占满主线程（输出 6）。 */
const SLOW_READ_MS = 8;

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
    if (plain) {
        if (root.value !== null) {
            root.value.style.whiteSpace = "pre-wrap";
            root.value.textContent = props.text;
        }
        return;
    }
    const started = performance.now();
    renderer?.update(props.text);
    const cost = performance.now() - started;
    resumeAt = cost > SLOW_READ_MS ? performance.now() + cost : 0;
    placeCursor();
};

/** 排下一次读入：同一帧里多次改变只读入最后一次；上一次读入慢时先等一会儿。 */
const schedule = (): void => {
    if (frame !== null || timer !== null || (renderer === null && !plain)) return;
    const wait = resumeAt - performance.now();
    if (wait <= 0) {
        frame = requestAnimationFrame(flush);
        return;
    }
    timer = setTimeout(() => {
        timer = null;
        frame = requestAnimationFrame(flush);
    }, wait);
};

onMounted(() => {
    if (root.value === null) return;
    const document = root.value.ownerDocument;
    try {
        // 挂上时取定语言（docs/specs/workspace/markdown-syntaxes.md 输出 7）。
        const language = languageFor(catalog);
        renderer = new DisplayRenderer(root.value, language, schemaFor(language), {
            document,
            get locale() {
                return props.locale;
            },
            get resolveAsset() {
                return props.resolveAsset;
            },
            activate: (activation) => emit("activate", activation),
            report: (message, error) => report("markdown.display.block-failed", message, error),
        });
        flush();
    } catch (error) {
        renderer?.destroy();
        renderer = null;
        plain = true;
        report("markdown.display.failed", "展示器组不成语言，按纯文字显示原文", error);
        flush();
    }
});

watch(() => props.text, schedule);
watch(() => props.streaming, placeCursor);

onBeforeUnmount(() => {
    if (frame !== null) cancelAnimationFrame(frame);
    if (timer !== null) clearTimeout(timer);
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
    emit("activate", showsAsChip(target.kind) ? {kind: "reference", target: href} : {kind: "link", href});
};
</script>

<template>
    <div ref="root" class="nb-markdown nb-markdown-display" data-markdown-display @click="onClick"></div>
</template>

<style scoped>
.nb-markdown-display {
    --markdown-font-size: var(--text-sm);
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
