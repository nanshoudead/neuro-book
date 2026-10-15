<script setup lang="ts">
/**
 * 图上选中一个点时浮在它旁边的小卡片（docs/specs/story/viewer.md 输出 27）：名字、类别、出场次数，以及打开人物卡
 * 或连线说明、只看周边。放在 StoryNetwork 的 `selected` 插槽里，位置由图组件跟着点走。
 */
import {Button, IconButton} from "@notnotype/nb-ui/components";

const props = defineProps<{
    label: string;
    /** 类别的中文名，例如“人物”“主线”。 */
    kind: string;
    /** 出场次数等一句补充；没有时不显示。 */
    detail?: string | null;
    /** 主按钮的文字：“打开人物卡”或“连线说明”。 */
    action: string;
    /** 右侧抽屉里已经开着它：主按钮改成“已在右侧打开”并禁用。 */
    opened?: boolean;
    neighborhood: boolean;
}>();
const emit = defineEmits<{open: []; neighborhood: [boolean]; close: []}>();
</script>

<template>
    <div class="node-popover" role="dialog" :aria-label="props.label" data-testid="node-popover" @pointerdown.stop @wheel.stop>
        <div class="flex items-start gap-2">
            <div class="min-w-0 flex-1">
                <div class="truncate font-[var(--weight-strong)]" data-testid="node-popover-name">{{ props.label }}</div>
                <div class="text-[length:var(--text-2xs)] text-[var(--text-muted)]">{{ props.kind }}<template v-if="props.detail"> · {{ props.detail }}</template></div>
            </div>
            <IconButton size="xs" icon-class="i-lucide-x" aria-label="取消选中" @click="emit('close')" />
        </div>
        <div class="mt-2 flex flex-wrap gap-1">
            <Button size="sm" variant="primary" :disabled="props.opened" data-testid="node-popover-open" @click="emit('open')">{{ props.opened ? "已在右侧打开" : props.action }}</Button>
            <Button size="sm" variant="secondary" :aria-pressed="props.neighborhood" @click="emit('neighborhood', !props.neighborhood)">{{ props.neighborhood ? "看全图" : "只看周边" }}</Button>
        </div>
    </div>
</template>

<style scoped>
.node-popover {
    width: 220px;
    padding: 8px 10px;
    border: var(--border-w, 1px) solid var(--border-color);
    border-radius: var(--radius-panel, 8px);
    background: var(--bg-panel);
    box-shadow: var(--shadow-panel);
    font-size: var(--text-sm);
    user-select: text;
}
</style>
