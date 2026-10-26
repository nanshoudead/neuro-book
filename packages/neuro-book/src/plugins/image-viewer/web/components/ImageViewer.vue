<script setup lang="ts">
/** 图片查看器的控件（同名 .md）：按字节绑定读取图片并显示，只看不改。 */
import {Button} from "@notnotype/nb-ui/components";
import {computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch} from "vue";

import type {BytesEditorBinding, EditorControlHandle, ViewStateSlot} from "nbook/plugins/editor/shared/contracts";
import {formatText, localize} from "nbook/shared/localized-text";
import type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";

const props = defineProps<{binding: BytesEditorBinding | null; host: ViewStateSlot; readonly: boolean; visible: boolean; label: string; locale: DisplayLocale}>();
const emit = defineEmits<{(event: "ready", handle: EditorControlHandle | null): void; (event: "focus", focused: boolean): void}>();

const TEXT = {
    loading: {"zh-CN": "正在读取…", "en-US": "Reading…"},
    retry: {"zh-CN": "重试", "en-US": "Retry"},
    "not-found": {"zh-CN": "{name} 不在了。", "en-US": "{name} no longer exists."},
    "generation-gone": {"zh-CN": "作品已经关闭，读不到 {name}。", "en-US": "The work is closed; {name} cannot be read."},
    "too-large": {"zh-CN": "{name} 太大，不能在这里显示。", "en-US": "{name} is too large to show here."},
    undecodable: {"zh-CN": "无法显示这个图片：{name}。", "en-US": "This image cannot be shown: {name}."},
    "no-project": {"zh-CN": "只能显示作品里的文件。", "en-US": "Only files in the work can be shown."},
    failed: {"zh-CN": "读不到 {name}（{reason}）。", "en-US": "Cannot read {name} ({reason})."},
} satisfies Record<string, LocalizedText>;

const say = (key: keyof typeof TEXT, values: Readonly<Record<string, string>> = {}): string => localize(formatText(TEXT[key], values), props.locale);

/** 比例的上下限（docs/specs/workbench/image-viewer.md 输出 4）。 */
const MIN_SCALE = 0.1;
const MAX_SCALE = 16;

/** 每个标签的视图状态，存在绑定的槽里：切走再切回保持比例与位置。 */
interface ViewState {
    mode: "fit" | "manual";
    scale: number;
    left: number;
    top: number;
}

const viewport = ref<HTMLElement | null>(null);
/** 正在显示的图：对象 URL 归这个控件，换图与卸载时撤销。 */
const shown = shallowRef<{readonly url: string; readonly width: number; readonly height: number; readonly bytes: number} | null>(null);
const phase = ref<"idle" | "loading" | "shown" | "failed">("idle");
const problem = ref<string | null>(null);
const view = ref<ViewState>({mode: "fit", scale: 1, left: 0, top: 0});
const box = ref({width: 0, height: 0});
let controller: AbortController | null = null;
let observer: ResizeObserver | null = null;

const replaceShown = (next: typeof shown.value): void => {
    const previous = shown.value;
    shown.value = next;
    if (previous !== null && previous.url !== next?.url) URL.revokeObjectURL(previous.url);
};

/** HTTP 状态对应的说明（docs/specs/workspace/files.md 的“按地址读取字节”）。 */
const problemOf = (status: number, name: string): string => {
    if (status === 404) return say("not-found", {name});
    if (status === 410) return say("generation-gone", {name});
    if (status === 413) return say("too-large", {name});
    return say("failed", {name, reason: String(status)});
};

/**
 * 读取并解码当前绑定的图片。新图解码完之前旧图留着；迟到的结果（期间换了绑定或又读了一次）丢弃，它的对象 URL 随即撤销。
 */
const load = async (): Promise<void> => {
    controller?.abort();
    const binding = props.binding;
    if (binding === null) {
        controller = null;
        phase.value = "idle";
        return;
    }
    const url = binding.url.value;
    if (url === null) {
        controller = null;
        replaceShown(null);
        problem.value = say("no-project");
        phase.value = "failed";
        return;
    }
    const current = new AbortController();
    controller = current;
    phase.value = "loading";
    try {
        const response = await fetch(url, {cache: "no-cache", signal: current.signal});
        if (!response.ok) {
            if (current.signal.aborted) return;
            replaceShown(null);
            problem.value = problemOf(response.status, props.label);
            phase.value = "failed";
            return;
        }
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const probe = new Image();
        probe.src = objectUrl;
        try {
            await probe.decode();
        } catch {
            URL.revokeObjectURL(objectUrl);
            if (current.signal.aborted) return;
            replaceShown(null);
            problem.value = say("undecodable", {name: props.label});
            phase.value = "failed";
            return;
        }
        if (current.signal.aborted) {
            URL.revokeObjectURL(objectUrl);
            return;
        }
        replaceShown({url: objectUrl, width: probe.naturalWidth, height: probe.naturalHeight, bytes: blob.size});
        problem.value = null;
        phase.value = "shown";
        await nextTick();
        if (viewport.value !== null) {
            viewport.value.scrollLeft = view.value.left;
            viewport.value.scrollTop = view.value.top;
        }
    } catch (error) {
        // 取消是换绑定或卸载造成的，不是失败。
        if (current.signal.aborted) return;
        replaceShown(null);
        problem.value = say("failed", {name: props.label, reason: error instanceof Error ? error.message : String(error)});
        phase.value = "failed";
    }
};

/** 换绑定：把旧标签的视图状态存回它的槽，从新标签的槽里取出（没有时从“适应”开始）。 */
watch(() => props.binding, (next, previous) => {
    if (previous !== undefined && previous !== null) {
        previous.slot.state = {...view.value, left: viewport.value?.scrollLeft ?? 0, top: viewport.value?.scrollTop ?? 0} satisfies ViewState;
    }
    const saved = next?.slot.state as ViewState | null | undefined;
    view.value = saved ?? {mode: "fit", scale: 1, left: 0, top: 0};
    if (next === null) replaceShown(null);
}, {flush: "sync"});

watch(() => [props.binding, props.binding?.url.value, props.binding?.version.value] as const, () => void load(), {immediate: true});

/** 适应时的比例：整张图放进内容区，只缩小不放大。 */
const fitScale = computed(() => {
    const image = shown.value;
    if (image === null || box.value.width === 0 || box.value.height === 0) return 1;
    return Math.min(1, box.value.width / image.width, box.value.height / image.height);
});
const scale = computed(() => (view.value.mode === "fit" ? fitScale.value : view.value.scale));

const clamp = (value: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));

/** 按比例因子缩放；`at` 是内容区里的一点（指针位置），缩放前后它下面还是图的同一处。 */
const zoom = (factor: number, at?: {readonly x: number; readonly y: number}): void => {
    const element = viewport.value;
    const before = scale.value;
    const after = clamp(before * factor);
    if (element === null || after === before) {
        view.value = {...view.value, mode: "manual", scale: after};
        return;
    }
    const anchor = at ?? {x: element.clientWidth / 2, y: element.clientHeight / 2};
    const contentX = (element.scrollLeft + anchor.x) / before;
    const contentY = (element.scrollTop + anchor.y) / before;
    view.value = {...view.value, mode: "manual", scale: after};
    void nextTick(() => {
        element.scrollLeft = contentX * after - anchor.x;
        element.scrollTop = contentY * after - anchor.y;
    });
};

const toggle = (): void => {
    view.value = view.value.mode === "fit" ? {...view.value, mode: "manual", scale: 1} : {...view.value, mode: "fit"};
};

const onWheel = (event: WheelEvent): void => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const rect = viewport.value?.getBoundingClientRect();
    zoom(Math.exp(-event.deltaY * 0.002), rect === undefined ? undefined : {x: event.clientX - rect.left, y: event.clientY - rect.top});
};

const onKeydown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey || shown.value === null) return;
    const action = ({"+": () => zoom(1.25), "=": () => zoom(1.25), "-": () => zoom(0.8), "0": () => (view.value = {...view.value, mode: "fit"}), "1": () => (view.value = {...view.value, mode: "manual", scale: 1})} as Record<string, () => void>)[event.key];
    if (action === undefined) return;
    event.preventDefault();
    action();
};

const sizeText = (bytes: number): string => {
    const format = (value: number): string => new Intl.NumberFormat(props.locale, {maximumFractionDigits: 1}).format(value);
    if (bytes < 1024) return `${format(bytes)} B`;
    if (bytes < 1024 * 1024) return `${format(bytes / 1024)} KB`;
    return `${format(bytes / (1024 * 1024))} MB`;
};

/** 状态栏显示的一行（docs/specs/workbench/image-viewer.md 输出 6）。 */
const status = computed((): string | null => {
    const image = shown.value;
    if (image === null || phase.value === "failed") return null;
    return `${String(image.width)} × ${String(image.height)} · ${sizeText(image.bytes)} · ${String(Math.round(scale.value * 100))}%`;
});

const handle: EditorControlHandle = {
    focus: () => viewport.value?.focus(),
    flushPendingChange: () => undefined,
    status,
};

onMounted(() => {
    const element = viewport.value;
    if (element !== null && typeof ResizeObserver === "function") {
        observer = new ResizeObserver(() => {
            box.value = {width: element.clientWidth, height: element.clientHeight};
        });
        observer.observe(element);
    }
    emit("ready", handle);
});

onBeforeUnmount(() => {
    controller?.abort();
    observer?.disconnect();
    if (props.binding !== null) props.binding.slot.state = {...view.value, left: viewport.value?.scrollLeft ?? 0, top: viewport.value?.scrollTop ?? 0} satisfies ViewState;
    replaceShown(null);
    emit("ready", null);
});
</script>

<template>
    <div
        ref="viewport"
        class="image-viewer nb-ui-focus-ring"
        tabindex="0"
        role="region"
        :aria-label="label"
        data-image-viewer
        :data-image-viewer-phase="phase"
        @focusin="emit('focus', true)"
        @focusout="emit('focus', false)"
        @wheel="onWheel"
        @keydown="onKeydown"
    >
        <div v-if="shown !== null && phase !== 'failed'" class="image-viewer__stage">
            <img
                class="image-viewer__image"
                :src="shown.url"
                :width="Math.round(shown.width * scale)"
                :height="Math.round(shown.height * scale)"
                :alt="label"
                draggable="false"
                :style="{cursor: view.mode === 'fit' ? 'zoom-in' : 'zoom-out'}"
                data-image-viewer-image
                @click="toggle"
            />
        </div>
        <p v-else-if="phase === 'loading'" class="image-viewer__pending" role="status">{{ say("loading") }}</p>
        <div v-else-if="phase === 'failed'" class="flex flex-col items-start gap-2 p-6 text-sm" role="alert" data-image-viewer-failure>
            <p>{{ problem }}</p>
            <Button v-if="binding?.url.value !== null" size="sm" variant="secondary" @click="load()">{{ say("retry") }}</Button>
        </div>
    </div>
</template>

<style scoped>
.image-viewer {
    height: 100%;
    width: 100%;
    overflow: auto;
    background: var(--panel-surface);
    outline: none;
}

/* 图比内容区小时居中；大时从左上角开始、可以滚动（`min-*` 让舞台至少撑满内容区，`margin: auto` 居中）。 */
.image-viewer__stage {
    display: flex;
    min-height: 100%;
    min-width: 100%;
    width: max-content;
    padding: 0;
}

/* 棋盘格：透明处可见，两种格色由正文色按比例混入面板底色，明暗两态都分得出。 */
.image-viewer__image {
    display: block;
    margin: auto;
    max-width: none;
    background-color: color-mix(in srgb, var(--text-main) 4%, var(--panel-surface));
    background-image:
        linear-gradient(45deg, color-mix(in srgb, var(--text-main) 10%, var(--panel-surface)) 25%, transparent 25%, transparent 75%, color-mix(in srgb, var(--text-main) 10%, var(--panel-surface)) 75%),
        linear-gradient(45deg, color-mix(in srgb, var(--text-main) 10%, var(--panel-surface)) 25%, transparent 25%, transparent 75%, color-mix(in srgb, var(--text-main) 10%, var(--panel-surface)) 75%);
    background-position: 0 0, 8px 8px;
    background-size: 16px 16px;
    image-rendering: auto;
}

.image-viewer__pending {
    padding: 24px;
    font-size: var(--text-sm);
    color: var(--text-muted);
    opacity: 0;
    animation: image-viewer-reveal 1ms linear 800ms forwards;
}

@keyframes image-viewer-reveal {
    to {
        opacity: 1;
    }
}
</style>
