<script setup lang="ts">
import {ref} from "vue";
import Input from "../../../src/components/form/Input.vue";
import FixtureShell from "./AcceptanceShell.vue";
import type {LabComponentDefinition} from "./definitions";

/**
 * 出错输入框的边框验收夹具（w00030 t02，e2e/control-invalid.spec.ts）。
 *
 * 出错边框写在 styles.css 的 `.nb-ui-control.nb-ui-control-invalid`，悬停、聚焦时也要保持出错色；
 * 这是样式层的裁决（层内比特异性），单元测试没有样式引擎，只能在真实浏览器里读计算样式。
 * 放一个正常的输入框作对照，证明读到的出错色不是控件的默认边框色。
 */
defineProps<{
    definition: LabComponentDefinition;
    sceneId: string;
}>();

const controls = ref<Record<string, string | boolean>>({});
const invalidValue = ref("");
const normalValue = ref("");
</script>

<template>
    <FixtureShell v-model:controls="controls" :definition="definition" :scene-id="sceneId">
        <div id="nb-lab-target" class="flex w-64 flex-col gap-3">
            <Input v-model="invalidValue" invalid data-fixture-invalid aria-label="出错的输入框" />
            <Input v-model="normalValue" data-fixture-normal aria-label="正常的输入框" />
        </div>
    </FixtureShell>
</template>
