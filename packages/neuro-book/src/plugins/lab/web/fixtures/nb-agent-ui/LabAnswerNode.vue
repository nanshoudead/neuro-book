<script setup lang="ts">
/**
 * Lab 宿主登记的 `answer` 节点组件：nb-story 交答案的收尾工具在对话视图里的样子（参数形状见 docs/specs/story/qa.md
 * 输出 7）。它是“宿主组件”的活样例：从属性拿到这次调用与界面语言，点出处发 `reference.open`，由视图交给宿主。
 * 只画结论、结论类型与依据出处；表格与分点留给 nb-story 自己的组件。
 */
import {computed} from "vue";
import {argArray, argString} from "@notnotype/nb-agent-ui";
import type {HostComponentEmits, ToolComponentProps} from "@notnotype/nb-agent-ui";

const props = defineProps<ToolComponentProps>();
const emit = defineEmits<HostComponentEmits>();

const conclusion = computed(() => argString(props.call, "conclusion"));
const conclusionType = computed(() => argString(props.call, "conclusionType"));
/** 出处在样例里写成章节段号，例如 "37.12"。 */
const evidence = computed(() => argArray(props.call, "evidence").filter((ref): ref is string => typeof ref === "string"));
const evidenceLabel = computed(() => (props.locale === "en-US" ? "Sources" : "依据"));

function openRef(ref: string) {
    emit("action", {type: "reference.open", target: `paragraph://${ref}`});
}
</script>

<template>
    <div class="flex flex-col gap-1.5 rounded-[var(--radius-panel)] border border-[var(--border-color)] bg-[var(--bg-subtle)] px-3 py-2 text-[length:var(--text-sm)]" data-lab-answer>
        <p class="text-[var(--text-main)]">
            <span v-if="conclusionType" class="mr-1.5 rounded-[var(--radius-control)] border border-[var(--border-color)] px-1.5 text-[length:var(--text-2xs)] text-[var(--text-secondary)]">{{ conclusionType }}</span>
            {{ conclusion }}
        </p>
        <p v-if="evidence.length > 0" class="flex flex-wrap items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--text-muted)]">
            {{ evidenceLabel }}
            <button
                v-for="ref in evidence"
                :key="ref"
                type="button"
                class="rounded-[var(--radius-control)] px-1 text-[var(--accent-text)] hover:bg-[var(--bg-hover)]"
                data-answer-ref
                @click="openRef(ref)"
            >{{ ref }}</button>
        </p>
    </div>
</template>
