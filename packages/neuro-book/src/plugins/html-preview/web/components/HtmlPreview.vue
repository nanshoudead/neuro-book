<script setup lang="ts">
/** HTML 预览的控件（同名 .md）：正文拼成 `srcdoc` 放进沙箱 iframe，相对引用经预览令牌读作品里的文件。 */
import {Button} from "@notnotype/nb-ui/components";
import {computed, onBeforeUnmount, onMounted, ref, shallowRef, watch} from "vue";

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";

import type {EditorControlHandle, TextEditorBinding, ViewStateSlot} from "nbook/plugins/editor/shared/contracts";
import {formatText, localize} from "nbook/shared/localized-text";
import type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";

import type {PreviewAccess} from "../access";
import {composePreview, PREVIEW_DELAY_MS} from "../compose";

const props = defineProps<{binding: TextEditorBinding | null; host: ViewStateSlot; readonly: boolean; visible: boolean; label: string; locale: DisplayLocale; access: PreviewAccess; clock: RuntimeClock; network: (address: string) => boolean}>();
const emit = defineEmits<{(event: "ready", handle: EditorControlHandle | null): void; (event: "focus", focused: boolean): void}>();

const TEXT = {
    notProject: {"zh-CN": "只能预览作品里的文件。", "en-US": "Only files in the work can be previewed."},
    failed: {"zh-CN": "预览打不开：{reason}", "en-US": "The preview cannot be opened: {reason}"},
    retry: {"zh-CN": "重试", "en-US": "Retry"},
} satisfies Record<string, LocalizedText>;

const say = (key: keyof typeof TEXT, values: Readonly<Record<string, string>> = {}): string => localize(formatText(TEXT[key], values), props.locale);

const frame = ref<HTMLIFrameElement | null>(null);
/** 当前绑定的令牌；换绑定时作废。 */
const grant = shallowRef<{readonly binding: TextEditorBinding; readonly token: string; readonly base: string} | null>(null);
const problem = ref<string | null>(null);
/** 交给 iframe 的页面：可见、有令牌时才有；停手后才换成新正文。 */
const page = ref<string | null>(null);
let cancelTimer: (() => void) | null = null;
/** 申请令牌的次数：迟到的结果（期间换了绑定）作废。 */
let attempt = 0;

const pathOf = (address: string): string | null => (address.startsWith("project://") ? address.slice("project://".length) : null);

const compose = (): string | null => {
    const binding = props.binding;
    const current = grant.value;
    if (binding === null || current === null || current.binding !== binding) return null;
    const path = pathOf(binding.address.value);
    if (path === null) return null;
    return composePreview(binding.text.value, {base: current.base, path, network: props.network(binding.address.value)});
};

const release = (): void => {
    const current = grant.value;
    grant.value = null;
    if (current !== null) props.access.close(current.token);
};

const acquire = async (binding: TextEditorBinding): Promise<void> => {
    attempt += 1;
    const mine = attempt;
    problem.value = null;
    const result = await props.access.open();
    if (mine !== attempt || props.binding !== binding) {
        if (result.ok) props.access.close(result.token);
        return;
    }
    if (!result.ok) {
        problem.value = say("failed", {reason: result.reason});
        return;
    }
    grant.value = {binding, token: result.token, base: result.base};
    page.value = props.visible ? compose() : null;
};

/** 换绑定：作废旧令牌；新绑定可见时申请（第一次可见时才申请，输出 2）。 */
const sync = (): void => {
    const binding = props.binding;
    if (grant.value !== null && grant.value.binding !== binding) release();
    cancelTimer?.();
    cancelTimer = null;
    if (binding === null) {
        page.value = null;
        return;
    }
    if (pathOf(binding.address.value) === null) {
        problem.value = say("notProject");
        page.value = null;
        return;
    }
    if (!props.visible) {
        // 不可见时移除 iframe：被换下的页面不在后台运行脚本（输出 6）。
        page.value = null;
        return;
    }
    if (grant.value === null) {
        page.value = null;
        void acquire(binding);
        return;
    }
    page.value = compose();
};

watch(() => [props.binding, props.visible] as const, sync, {immediate: true, flush: "sync"});

// 正文变化：停手后重载；联网开关变化：立即重载。不可见时都不做，重新可见时按当时的正文重建。
watch(() => props.binding?.text.value, () => {
    if (!props.visible || grant.value === null) return;
    cancelTimer?.();
    cancelTimer = props.clock.schedule(() => {
        cancelTimer = null;
        page.value = compose();
    }, PREVIEW_DELAY_MS);
});
watch(() => (props.binding === null ? null : props.network(props.binding.address.value)), () => {
    if (props.visible && grant.value !== null) page.value = compose();
});

const handle: EditorControlHandle = {
    focus: () => frame.value?.focus(),
    flushPendingChange: () => undefined,
};

onMounted(() => emit("ready", handle));

onBeforeUnmount(() => {
    cancelTimer?.();
    attempt += 1;
    release();
    emit("ready", null);
});

const retry = (): void => {
    if (props.binding !== null) void acquire(props.binding);
};

const showRetry = computed(() => problem.value !== null && props.binding !== null && pathOf(props.binding.address.value) !== null);
</script>

<template>
    <div class="relative h-full w-full bg-[var(--panel-surface)]" data-html-preview @focusin="emit('focus', true)" @focusout="emit('focus', false)">
        <!-- 只给 allow-scripts：不同源（不透明源），拿不到应用的存储与接口（docs/specs/workbench/html-preview.md 输出 1）。 -->
        <iframe
            v-if="page !== null"
            ref="frame"
            :key="grant?.token"
            class="html-preview__frame"
            sandbox="allow-scripts"
            referrerpolicy="no-referrer"
            :title="label"
            :srcdoc="page"
            data-html-preview-frame
        ></iframe>
        <div v-else-if="problem !== null" class="flex flex-col items-start gap-2 p-6 text-sm" role="alert" data-html-preview-failure>
            <p>{{ problem }}</p>
            <Button v-if="showRetry" size="sm" variant="secondary" @click="retry">{{ say("retry") }}</Button>
        </div>
    </div>
</template>

<style scoped>
/* 预览的是一张普通网页：它自己不设背景时浏览器的缺省是白底，与在浏览器里直接打开一样。 */
.html-preview__frame {
    display: block;
    height: 100%;
    width: 100%;
    border: 0;
    background: #fff;
}
</style>
