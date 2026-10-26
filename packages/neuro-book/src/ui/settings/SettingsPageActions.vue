<script setup lang="ts">
/**
 * 设置页面的页面级操作（同名 .md，docs/specs/settings/settings-window.md 输出 3、13）：默认插槽里的按钮画在窗口标题区的
 * 右侧，页面卸载时一起消失；这一层不能写时整体停用。
 */
import {computed} from "vue";

import {usePageChrome} from "./page-chrome";

// 根是 Teleport，Vue 接不住透传的 attrs：显式落在内容的 fieldset 上。
defineOptions({name: "SettingsPageActions", inheritAttrs: false});

const chrome = usePageChrome();
/** 标题区挂载之前（同一次渲染里它排在页面后面才拿到元素，见 `page-chrome.ts`）与没有通道时为 null：原位渲染。 */
const target = computed(() => chrome?.actionsTarget.value ?? null);
/** 没有通道（例如 Lab 单独渲染）时没有“层”可言，不停用。 */
const writable = computed(() => chrome === null || chrome.writable.value);

defineSlots<{default(): unknown}>();
</script>

<template>
    <!-- 目标还没有时 `disabled` 让内容留在原位；目标一到就移过去。内容在两处之间移动时不重建。 -->
    <Teleport :to="target" :disabled="target === null">
        <!-- 内容包在 fieldset 里：nb-ui 的按钮是原生按钮，随 fieldset 停用；层恢复时自动恢复。 -->
        <fieldset v-bind="$attrs" class="settings-page-actions" :disabled="!writable" data-settings-page-actions>
            <slot />
        </fieldset>
    </Teleport>
</template>

<style scoped>
/* fieldset 的默认描边、内边距与最小宽度全部去掉：它只是一个停用的作用域。 */
.settings-page-actions {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    border: 0;
}
</style>
