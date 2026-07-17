<script setup lang="ts">
import type {PublicAttachmentDto} from "nbook/shared/dto/agent-public-event.dto";
import {agentAttachmentUrl} from "nbook/app/components/novel-ide/agent/agent-attachment";

const props = defineProps<{
    sessionId?: number | null;
    entryId: string;
    contentIndex: number;
    attachment: PublicAttachmentDto;
}>();

type LoadState = "loading" | "loaded" | "error";
const INLINE_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const loadState = ref<LoadState>("loading");
const retryNonce = ref(0);
const canPreview = computed(() => INLINE_IMAGE_MIME_TYPES.has(props.attachment.mimeType.toLowerCase()));
const imageUrl = computed(() => {
    if (!canPreview.value) {
        return null;
    }
    const url = agentAttachmentUrl(props.sessionId, props.entryId, props.contentIndex);
    return url && retryNonce.value > 0 ? `${url}?retry=${String(retryNonce.value)}` : url;
});
const {t, locale} = useI18n();
const imageAlt = computed(() => props.attachment.name || t("agent.chat.attachmentAlt", {mimeType: props.attachment.mimeType}));
const bytesLabel = computed(() => `${new Intl.NumberFormat(locale.value).format(props.attachment.bytes)} B`);

watch(imageUrl, () => {
    loadState.value = "loading";
});

watch(() => [props.sessionId, props.entryId, props.contentIndex, props.attachment.mimeType, props.attachment.bytes, props.attachment.name], () => {
    retryNonce.value = 0;
    loadState.value = "loading";
});

/** 图片成功加载后移除占位态，但保留固定容器避免列表布局抖动。 */
const onLoad = (): void => {
    loadState.value = "loaded";
};

/** 单张图片失败只影响当前附件，不改变 Chat Flow 其他消息状态。 */
const onError = (): void => {
    loadState.value = "error";
};

/** 用户显式重试单张图片；query 只用于绕过失败的浏览器缓存，授权 locator 不变。 */
const retry = (): void => {
    loadState.value = "loading";
    retryNonce.value += 1;
};
</script>

<template>
    <figure class="w-full max-w-xl overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)]">
        <!-- 固定宽高比让 lazy 图片完成后不改变 Chat Flow 分页锚点。 -->
        <div class="relative aspect-video w-full">
        <div v-if="loadState === 'loading' && imageUrl" class="absolute inset-0 flex items-center justify-center text-[var(--text-muted)]" aria-hidden="true">
            <span class="i-lucide-image-down h-5 w-5 animate-pulse"></span>
        </div>
        <img
            v-if="imageUrl && loadState !== 'error'"
            :src="imageUrl"
            :alt="imageAlt"
            loading="lazy"
            decoding="async"
            class="absolute inset-0 block h-full w-full object-contain transition-opacity"
            :class="loadState === 'loaded' ? 'opacity-100' : 'opacity-0'"
            @load="onLoad"
            @error="onError"
        />
        <div v-if="loadState === 'error' || !imageUrl" class="absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 py-4 text-xs text-[var(--status-danger)]">
            <div class="flex items-center gap-2">
            <span class="i-lucide-image-off h-4 w-4 shrink-0"></span>
            <span>{{ imageUrl ? t("agent.chat.attachmentLoadFailed") : t("agent.chat.attachmentUnavailable") }}</span>
            </div>
            <button v-if="imageUrl" type="button" class="rounded border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 py-1 text-[var(--text-main)] hover:bg-[var(--bg-hover)]" @click="retry">{{ t("agent.chat.retry") }}</button>
        </div>
        </div>
        <figcaption class="flex items-center justify-between gap-2 border-t border-[var(--border-color)] px-2.5 py-1.5 text-[10px] text-[var(--text-muted)]">
            <span class="min-w-0 truncate" :title="imageAlt">{{ imageAlt }}</span>
            <span class="shrink-0 tabular-nums">{{ bytesLabel }}</span>
        </figcaption>
    </figure>
</template>
