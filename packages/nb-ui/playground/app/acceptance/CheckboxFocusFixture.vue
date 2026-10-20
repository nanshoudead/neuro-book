<script setup lang="ts">
import {ref} from "vue";
import Checkbox from "../../../src/components/form/Checkbox.vue";
import FixtureShell from "./AcceptanceShell.vue";
import type {LabComponentDefinition} from "./definitions";

/**
 * Checkbox 聚焦不滚动外层容器的验收夹具（w00022 t17，e2e/checkbox.spec.ts）。
 *
 * 复现的是 dev-panel 遇到过的结构：Splitter 的一格（`relative overflow-hidden`）里放一个可滚动的列表，列表靠下放勾选框。
 * 格子要和 Splitter 的格子一样是定位上下文，列表不能是（不写 relative、transform 之类）：这样组件的 label 不定位时，
 * `sr-only` input 的包含块就是格子，聚焦它会滚格子。列表定位了，包含块停在列表上，组件没修时用例也会通过；
 * 格子不定位，包含块越过格子落到更外层，聚焦也不会滚格子（2026-10-14 在 Chrome 实测），同样复现不了。
 * 用例开头会核对这两层的 position。
 */
defineProps<{
    definition: LabComponentDefinition;
    sceneId: string;
}>();

const controls = ref<Record<string, string | boolean>>({});
const checked = ref(false);
// 勾选框前面的占位行，让它在列表没滚动时落在格子可见区之外。
const rows = Array.from({length: 16}, (_, index) => `占位行 ${index + 1}`);
</script>

<template>
    <FixtureShell v-model:controls="controls" :definition="definition" :scene-id="sceneId">
        <div id="nb-lab-target" data-fixture-cell class="checkbox-focus-cell">
            <div data-fixture-list class="checkbox-focus-list">
                <p v-for="row in rows" :key="row" class="checkbox-focus-row">{{ row }}</p>
                <Checkbox v-model="checked" label="列表底部的勾选框" />
            </div>
        </div>
    </FixtureShell>
</template>

<style scoped>
.checkbox-focus-cell {
    position: relative;
    height: 240px;
    overflow: hidden;
    border: 1px solid var(--border-color);
}

.checkbox-focus-list {
    height: 100%;
    overflow-y: auto;
    padding: var(--space-3);
}

.checkbox-focus-row {
    margin: 0;
    padding: var(--space-2) 0;
    color: var(--text-muted);
}
</style>
