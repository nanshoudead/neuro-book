<script setup lang="ts">
/**
 * Markdown 里的一张图片（同名 .md）。不 inject 宿主：展示器的静态视图与编辑器的节点视图用 `render()` 把它挂到普通 DOM 上，
 * 那里没有应用上下文，inject 拿不到东西；要的都经属性给。
 */
import {computed, onBeforeUnmount, shallowRef, watch} from "vue";

import {say as sayText} from "../locale";
import type {MarkdownLocale, MarkdownText} from "../locale";

export type ResolveAsset = (src: string, signal: AbortSignal) => Promise<{url: string; release(): void} | null>;

const props = withDefaults(defineProps<{
    src: string;
    locale: MarkdownLocale;
    alt?: string;
    title?: string | null;
    resolveAsset?: ResolveAsset;
    refresh?: number;
    /** 不显示时的说明，`{name}` 是说明文字或地址；缺省“{name}（不显示）”。 */
    missing?: MarkdownText;
}>(), {alt: "", title: null, resolveAsset: undefined, refresh: 0, missing: undefined});

const emit = defineEmits<{(e: "activate"): void}>();

const TEXT = {
    image: {"zh-CN": "图片", "en-US": "Image"},
    none: {"zh-CN": "{name}（不显示）", "en-US": "{name} (not shown)"},
    failed: {"zh-CN": "{name} 读不出", "en-US": "Cannot read {name}"},
} satisfies Record<string, MarkdownText>;
const say = (key: keyof typeof TEXT, values: Readonly<Record<string, string>> = {}): string => sayText(key === "none" && props.missing !== undefined ? props.missing : TEXT[key], props.locale, values);

type Shown = {readonly kind: "loading"} | {readonly kind: "shown"; readonly url: string} | {readonly kind: "none"} | {readonly kind: "failed"};

const state = shallowRef<Shown>({kind: "loading"});
let release: (() => void) | null = null;
let controller: AbortController | null = null;

const dropCurrent = (): void => {
    controller?.abort();
    controller = null;
    release?.();
    release = null;
};

const load = (): void => {
    dropCurrent();
    const resolve = props.resolveAsset;
    if (resolve === undefined) {
        state.value = {kind: "none"};
        return;
    }
    const current = new AbortController();
    controller = current;
    state.value = {kind: "loading"};
    resolve(props.src, current.signal).then((result) => {
        if (current.signal.aborted) {
            result?.release();
            return;
        }
        controller = null;
        if (result === null) {
            state.value = {kind: "none"};
            return;
        }
        release = () => result.release();
        state.value = {kind: "shown", url: result.url};
    }, () => {
        if (!current.signal.aborted) state.value = {kind: "failed"};
    });
};

watch(() => [props.src, props.refresh, props.resolveAsset] as const, load, {immediate: true});
onBeforeUnmount(dropCurrent);

const name = computed(() => (props.alt === "" ? props.src : props.alt));
const tip = computed(() => props.title ?? (props.alt === "" ? undefined : props.alt));
</script>

<template>
    <span class="nb-markdown-image" data-markdown-image :data-state="state.kind">
        <img v-if="state.kind === 'shown'" class="nb-markdown-image__img" :src="state.url" :alt="props.alt" :title="tip" @error="state = {kind: 'failed'}" @click="emit('activate')" />
        <span v-else-if="state.kind === 'loading'" class="nb-markdown-image__placeholder">{{ props.alt === "" ? say("image") : props.alt }}</span>
        <span v-else class="nb-markdown-image__missing" :class="{'is-failed': state.kind === 'failed'}">
            <span class="i-lucide-image-off nb-markdown-image__icon" aria-hidden="true"></span>
            {{ state.kind === "failed" ? say("failed", {name}) : say("none", {name}) }}
        </span>
    </span>
</template>

<style scoped>
.nb-markdown-image {
    display: inline-block;
    max-width: 100%;
    vertical-align: bottom;
}

.nb-markdown-image__img {
    display: block;
    max-width: 100%;
    height: auto;
    cursor: pointer;
}

.nb-markdown-image__placeholder {
    display: inline-block;
    min-width: 6em;
    padding: 0 0.5em;
    border-radius: 0.3rem;
    background: var(--bg-subtle);
    color: var(--text-muted);
}

.nb-markdown-image__missing {
    display: inline-flex;
    align-items: center;
    gap: 0.25em;
    color: var(--text-muted);
}

.nb-markdown-image__missing.is-failed {
    color: var(--status-danger);
}

.nb-markdown-image__icon {
    width: 1em;
    height: 1em;
}
</style>
